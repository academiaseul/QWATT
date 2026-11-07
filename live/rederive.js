#!/usr/bin/env node
/**
 * QWATT — re-derive a live run's energy from its published samples (F-02)
 * ---------------------------------------------------------------------------
 *   node live/rederive.js <feed-dir> [--json]
 *
 * verifyBatch ties an interval to its raw payloads by hash. It does not recompute the interval's energy
 * from them, so that check alone cannot tell a raised figure from a true one. This tool answers that
 * question offline, from the published feed alone: it replays samples/*.csv through the CSV adapter and
 * the IntervalBuilder the run itself used, then compares every interval in a published batch with what
 * the replay gives: each meter's mwh, samples and mw_mean, and source.raw_sha256. Equal raw hashes mean
 * the replay fed the interval exactly the rows the run fed it. A batch's energy is then recomputed from
 * the replayed intervals.
 *
 * Sessions. live/run.js starts a new builder each time it starts, and a real-time restart resumes at the
 * current time, never backfilling. A samples file that does not start where the last one ended marks
 * such a start, so the replay starts a new builder there too and drops whatever was open, as a crash
 * does. A session replays all of its files, since the crash time is not published and the row that
 * closes its last interval can lie past the next session's start. So where two sessions reach one slot
 * the later one wins: every interval after a restart came from the new builder. Rows a crashed run never
 * reached are in the published files all the same: the slots they make are in no batch, and are counted
 * as not_published.
 *
 * It runs on no host and nothing in the pipeline imports it. It reads the feed and writes nothing.
 * Exit 0 when every interval compared is equal. Exit 1 otherwise. Exit 2 when the folder is not a live
 * run's feed: the sample feeds under evidence/feeds use another adapter and publish no samples.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('../ingest/adapters/csv');
const { IntervalBuilder } = require('../ingest/lib/normalize');
const E = require('../protocol/evidence');
const { STEP_S } = require('./simulator');

const DT_S = 300;
const COLUMNS = { a: { power_w: 'a_w' }, b: { power_w: 'b_w' } };   // as live/run.js replays them

function readJsonl(f) {
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
}

/**
 * The run's sessions: consecutive manifest entries, each picking up where the last ended.
 * @returns {Array<{from:string, files:string[]}>}
 */
function sessionsOf(manifest) {
  const out = [];
  let cur = null, end = null;
  for (const m of manifest) {
    if (!cur || m.from !== end) { cur = { from: m.from, files: [] }; out.push(cur); }
    cur.files.push(m.file);
    end = m.to;
  }
  return out;
}

/** Every interval the published samples give, by ts_start. The last session to reach a slot wins. */
async function replaySamples(feedDir, sessions, template) {
  const derived = new Map();
  for (const [i, s] of sessions.entries()) {
    const builder = new IntervalBuilder({
      site_id: template.site_id, node_id: template.node_id, adapter: 'csv', dt_s: DT_S, clock: 'replay', sample_s: STEP_S,
      meters: { a: { id: template.meters.a.id, class: template.meters.a.class, energy: 'integrate' }, b: { id: template.meters.b.id, class: template.meters.b.class, energy: 'integrate' } },
      onInterval: (rec) => derived.set(rec.ts_start, rec),
    });
    for (const file of s.files) {
      await csv.replay({ file: path.join(feedDir, file), ts_column: 'ts', meters: COLUMNS, pace: 'fast', flush: false }, builder);
    }
    /* the run flushes at run_end only, so a session that ended on a crash keeps its open interval unclosed */
    if (i === sessions.length - 1) builder.flush();
  }
  return derived;
}

/** The fields that differ between a published interval and its replay. */
function differences(pub, der) {
  const out = [];
  const same = (field, a, b) => { if (a !== b) out.push({ field, published: a, rederived: b }); };
  for (const k of ['a', 'b']) {
    for (const f of ['mwh', 'samples', 'mw_mean']) same(`meters.${k}.${f}`, pub.meters[k] ? pub.meters[k][f] : undefined, der.meters[k] ? der.meters[k][f] : undefined);
  }
  same('source.raw_sha256', pub.source.raw_sha256, der.source.raw_sha256);
  return out;
}

async function rederive(feedDir, { now = Date.now() } = {}) {
  const manifest = readJsonl(path.join(feedDir, 'samples', 'manifest.jsonl'));
  if (!manifest.length) throw new Error(`no samples/manifest.jsonl with entries at ${feedDir}: not a live run's feed`);
  const def = JSON.parse(fs.readFileSync(path.join(feedDir, 'faults.json'), 'utf8'));
  const listed = readJsonl(path.join(feedDir, 'ledger', 'batches.jsonl'));
  const rejected = readJsonl(path.join(feedDir, 'ledger', 'rejected.jsonl')).filter((l) => !(l.reasons || []).some((c) => c.startsWith('ingest.')));
  const batches = listed.map((e) => ({ entry: e, batch: JSON.parse(fs.readFileSync(path.join(feedDir, 'batches', `${e.batch_id}.json`), 'utf8')) }));

  const judged = batches.flatMap(({ entry, batch }) => [
    ...batch.intervals.map((rec) => ({ rec, batch_id: entry.batch_id })),
    ...rejected.filter((l) => l.batch_id === entry.batch_id).map((l) => ({ rec: l.interval, batch_id: entry.batch_id })),
  ]);
  if (!judged.length) return { ok: true, problems: [], sessions: 0, batches: 0, intervals: { compared: 0, equal: 0, pending: 0, not_published: 0 }, energy: { published_mwh: 0, rederived_mwh: 0 }, mismatches: [] };
  const template = judged[0].rec;
  if (template.source.adapter !== 'csv') throw new Error(`this feed's adapter is ${template.source.adapter}, so it is not a live run: only the CSV adapter's rows can be replayed from samples`);

  const sessions = sessionsOf(manifest);
  const derived = await replaySamples(feedDir, sessions, template);
  const covered = Math.max(...manifest.map((m) => Date.parse(m.to)));
  const over = now >= Date.parse(def.run_end);

  const problems = [], mismatches = [];
  let equal = 0, pending = 0;
  const seen = new Set();
  for (const { rec, batch_id } of judged) {
    seen.add(rec.ts_start);
    const der = derived.get(rec.ts_start);
    if (!der) {
      if (!over && Date.parse(rec.ts_end) > covered) { pending++; continue; }
      problems.push(`${rec.ts_start} (${batch_id}): no published samples give this interval`);
      continue;
    }
    const diff = differences(rec, der);
    if (!diff.length) { equal++; continue; }
    mismatches.push({ ts_start: rec.ts_start, batch_id, differences: diff });
    problems.push(`${rec.ts_start} (${batch_id}): ${diff.map((d) => `${d.field} published ${d.published}, re-derived ${d.rederived}`).join('; ')}`);
  }

  /* the energy, recomputed: each accepted batch's own intervals, by the rule the batch uses, from the replay */
  let publishedMwh = 0, rederivedMwh = 0;
  for (const { entry, batch } of batches) {
    if (entry.status !== 'accepted') continue;                        // a rejected batch adds nothing (F6)
    for (const rec of batch.intervals) {
      publishedMwh += E.basisMwh(rec);
      const der = derived.get(rec.ts_start);
      if (der) rederivedMwh += E.basisMwh(der);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    sessions: sessions.length,
    batches: batches.length,
    intervals: { compared: equal + mismatches.length, equal, pending, not_published: [...derived.keys()].filter((k) => !seen.has(k)).length },
    energy: { published_mwh: publishedMwh, rederived_mwh: rederivedMwh },
    mismatches,
  };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node live/rederive.js <feed-dir> [--json]'); process.exit(2); }
  rederive(path.resolve(dir)).then((r) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`${r.intervals.equal} of ${r.intervals.compared} intervals in ${r.batches} batches equal what the published samples give · ${r.sessions} session(s) · ${r.intervals.pending} pending · ${r.intervals.not_published} replayed but never published`);
      console.log(`energy in accepted batches: published ${r.energy.published_mwh} mWh · re-derived ${r.energy.rederived_mwh} mWh`);
      for (const p of r.problems.slice(0, 20)) console.log(`  ✗ ${p}`);
      if (r.problems.length > 20) console.log(`  … and ${r.problems.length - 20} more`);
      console.log(r.ok ? 'OK' : 'FAILED');
    }
    process.exitCode = r.ok ? 0 : 1;
  }).catch((e) => { console.error(e.message); process.exit(2); });
}

module.exports = { rederive, sessionsOf };
