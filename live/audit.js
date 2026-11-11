#!/usr/bin/env node
/**
 * QWATT — audit a live-run feed (Deliverable 4 acceptance)
 * ---------------------------------------------------------------------------
 *   node live/audit.js <feed-dir> [--expected live/expected-run.json] [--json]
 *
 * From the published feed alone:
 *   1. every scheduled fault (faults.json): each 5-minute interval fully inside
 *      its window is in ledger/rejected.jsonl with one of the expected reasons,
 *      and none of them was accepted;
 *   2. coverage: every 5-minute slot from the run start is judged exactly once
 *      (accepted or rejected), up to the last judged slot while the run is going
 *      and up to run_end once it is over. Gaps (the runner was down) and duplicates
 *      are listed. By OD-8 a gap of at most 2 hours keeps the run continuous and
 *      is no problem; a longer one is, and so is a run that stopped before run_end
 *      or has been silent for over 2 hours;
 *   3. raw samples: every published samples/*.csv hashes to its manifest entry;
 *   4. raw payloads: every payload entry in every raw/<batch_id>.jsonl (V3-5) is,
 *      byte for byte, a data row of one of those files plus "\n", the way the
 *      CSV replay adapter read it. So nothing a batch's samples_root commits to
 *      was made up: it came from the published samples. Only this direction is
 *      checked; a samples row need not appear in raw/ (the run's last open hour);
 *   5. with --expected (OD-9, live/expected.js): every slot judged was refused, or not, with the reasons
 *      listed before the run started. A slot not judged yet, or in a gap, is not compared.
 * Exit 0 when all hold, 1 otherwise.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DT_MS = 300 * 1000;
const OD8_LIMIT_S = 2 * 3600;                                         // OD-8: for each outage, not their sum
const SEVEN_DAYS_S = 7 * 86400;

const iso = (ms) => new Date(ms).toISOString();

function readJsonl(f) {
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
}

/** OD-9: the run's judged slots against the refusals listed in advance. @returns the summary for the report */
function compareExpected(def, bySlot, expected, problems) {
  if (expected.seed !== def.seed || expected.days !== def.days || expected.run_start !== def.run_start) {
    problems.push(`the expected list is for another run (seed ${expected.seed}, ${expected.days} days from ${expected.run_start})`);
    return { listed: expected.refused.length, matching: 0, not_judged: 0 };
  }
  const key = (rs) => [...rs].sort().join(',');
  const listed = new Map(expected.refused.map((r) => [Date.parse(r.ts_start), r]));
  let matching = 0, notJudged = 0;
  for (const [at, r] of listed) {
    const lines = bySlot.get(at);
    if (!lines) { notJudged++; continue; }
    const refused = lines.find((l) => !l.ok);
    if (!refused) problems.push(`${r.ts_start}: expected refusal (${r.reasons.join(', ')}), but the slot was accepted`);
    else if (key(refused.reasons) !== key(r.reasons)) problems.push(`${r.ts_start}: refused with reasons ${key(refused.reasons)}, expected ${key(r.reasons)}`);
    else matching++;
  }
  for (const [at, lines] of bySlot) {
    const refused = lines.find((l) => !l.ok);
    if (refused && !listed.has(at)) problems.push(`${refused.interval.ts_start}: refused (${key(refused.reasons)}), not in the expected list`);
  }
  return { listed: expected.refused.length, matching, not_judged: notJudged };
}

/**
 * OD-8: the run split at every gap over the limit. A trailing gap never splits it: the run did not come
 * back, so the last stretch simply ends at coveredEnd.
 * @returns {{limit_s:number, continuous:boolean, longest:{from:string,to:string,seconds:number}, seven_days:boolean}}
 */
function continuityOf(gaps, runStart, coveredEnd) {
  const breaks = gaps.filter((g) => !g.trailing && g.seconds > OD8_LIMIT_S).sort((x, y) => Date.parse(x.from) - Date.parse(y.from));
  const stretches = [];
  let from = runStart;
  for (const g of breaks) { stretches.push([from, Date.parse(g.from)]); from = Math.max(from, Date.parse(g.to)); }   // the write-up's outages may overlap
  stretches.push([from, coveredEnd]);
  const [a, b] = stretches.reduce((best, s) => (s[1] - s[0] > best[1] - best[0] ? s : best));
  const seconds = Math.max(0, (b - a) / 1000);
  return { limit_s: OD8_LIMIT_S, continuous: breaks.length === 0, longest: { from: iso(a), to: iso(Math.max(a, b)), seconds }, seven_days: seconds >= SEVEN_DAYS_S };
}

function auditLive(feedDir, { expected, now = Date.now() } = {}) {
  const def = JSON.parse(fs.readFileSync(path.join(feedDir, 'faults.json'), 'utf8'));
  const accepted = readJsonl(path.join(feedDir, 'ledger', 'accepted.jsonl'));
  const rejected = readJsonl(path.join(feedDir, 'ledger', 'rejected.jsonl'));
  const problems = [];

  /* judged slots, ignoring ingest-level duplicates/out-of-order lines (they are re-sends of a slot) */
  const isIngest = (l) => (l.reasons || []).some((c) => c.startsWith('ingest.'));
  const judged = [...accepted.map((l) => ({ ...l, ok: true })), ...rejected.filter((l) => !isIngest(l)).map((l) => ({ ...l, ok: false }))];
  const bySlot = new Map();
  for (const l of judged) {
    const k = Date.parse(l.interval.ts_start);
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push(l);
  }

  /* 1. faults */
  const faults = def.faults.map((f) => {
    const s = Date.parse(f.start), e = Date.parse(f.end);
    const slots = [];
    for (let t = s; t + DT_MS <= e; t += DT_MS) slots.push(t);
    const seen = slots.map((t) => (bySlot.get(t) || [])[0]).filter(Boolean);
    const refused = seen.filter((l) => !l.ok && (l.reasons || []).some((c) => f.expect.includes(c)));
    const acceptedInside = seen.filter((l) => l.ok);
    const codes = {};
    for (const l of seen) for (const c of (l.reasons || [])) codes[c] = (codes[c] || 0) + 1;
    const due = s + DT_MS <= now || seen.length > 0;
    const status = !due ? 'not yet due'
      : seen.length < slots.length ? 'incomplete'
        : refused.length === slots.length && acceptedInside.length === 0 ? 'refused as expected' : 'NOT REFUSED';
    if (status === 'NOT REFUSED') problems.push(`${f.id}: ${acceptedInside.length} faulty interval(s) accepted or refused for the wrong reason (${JSON.stringify(codes)})`);
    return { id: f.id, kind: f.kind, start: f.start, end: f.end, expect: f.expect, intervals: slots.length, judged: seen.length, refused: refused.length, accepted: acceptedInside.length, codes, status };
  });

  /* 2. coverage */
  const keys = [...bySlot.keys()].sort((a, b) => a - b);
  const runStart = Date.parse(def.run_start), runEnd = Date.parse(def.run_end);
  const over = now >= runEnd;
  const lastJudged = keys.length ? keys[keys.length - 1] : runStart - DT_MS;
  const last = over ? Math.max(lastJudged, runEnd - DT_MS) : lastJudged;   // once it is over, every slot of the run is due
  const gaps = [];
  let gapStart = null;
  const closeGap = (end, extra) => {
    gaps.push({ from: iso(gapStart), to: iso(end), intervals: (end - gapStart) / DT_MS, seconds: (end - gapStart) / 1000, ...extra });
    gapStart = null;
  };
  for (let t = runStart; t <= last; t += DT_MS) {
    const has = bySlot.has(t);
    if (!has && gapStart == null) gapStart = t;
    if (has && gapStart != null) closeGap(t);
  }
  if (gapStart != null) closeGap(last + DT_MS, { trailing: true });
  for (const g of gaps) {
    if (g.trailing) problems.push(`the run stopped early: ${g.intervals} interval(s) never judged from ${g.from} to run_end ${g.to}`);
    else if (g.seconds > OD8_LIMIT_S) problems.push(`${g.intervals} interval(s) never judged from ${g.from} to ${g.to}: over the 2-hour limit, this outage breaks the run (OD-8)`);
  }
  const judgedUntil = lastJudged + DT_MS;
  if (!over && now - judgedUntil > OD8_LIMIT_S * 1000) problems.push(`nothing judged since ${iso(judgedUntil)}: over the 2-hour limit (OD-8), and the run is not over`);
  const duplicates = keys.filter((k) => bySlot.get(k).length > 1).map((k) => iso(k));
  if (duplicates.length) problems.push(`${duplicates.length} slot(s) judged more than once`);

  /* 3. raw samples */
  const manifest = readJsonl(path.join(feedDir, 'samples', 'manifest.jsonl'));
  for (const m of manifest) {
    const f = path.join(feedDir, m.file);
    if (!fs.existsSync(f)) { problems.push(`${m.file}: listed in the manifest but missing`); continue; }
    const h = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    if (h !== m.sha256) problems.push(`${m.file}: does not hash to its manifest entry`);
  }

  /* 4. raw payloads: what each batch's samples_root commits to came from the published samples */
  const rows = new Set();
  for (const m of manifest) {
    const f = path.join(feedDir, m.file);
    if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/).slice(1)) if (l.trim()) rows.add(l + '\n');   // as readline hands each row to the adapter
  }
  const rawDir = path.join(feedDir, 'raw');
  const rawFiles = fs.existsSync(rawDir) ? fs.readdirSync(rawDir).filter((n) => n.endsWith('.jsonl')).sort() : [];
  let payloads = 0;
  const strays = [];
  for (const name of rawFiles) {
    for (const line of readJsonl(path.join(rawDir, name))) {
      for (const p of line.payloads || []) { payloads++; if (typeof p.utf8 !== 'string' || !rows.has(p.utf8)) strays.push(`raw/${name} ${line.ts_start}`); }
    }
  }
  if (strays.length) problems.push(`${strays.length} raw payload(s) not a row of a published samples file (first: ${strays[0]})`);

  const expectedSummary = expected ? compareExpected(def, bySlot, expected, problems) : null;

  const expectedSlots = keys.length || over ? (last - runStart) / DT_MS + 1 : 0;
  return {
    ok: problems.length === 0,
    problems,
    run: { start: def.run_start, end: def.run_end, seed: def.seed },
    coverage: {
      judged_slots: keys.length, expected_slots: expectedSlots, over, complete: over && !gaps.some((g) => g.trailing), gaps, duplicates, accepted: accepted.length, rejected: rejected.length,
      judged_until: iso(keys.length ? judgedUntil : runStart),
      continuity: continuityOf(gaps, runStart, keys.length ? judgedUntil : runStart),
    },
    faults,
    samples: { files: manifest.length },
    raw: { files: rawFiles.length, payloads },
    expected: expectedSummary,
  };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node live/audit.js <feed-dir> [--expected live/expected-run.json] [--json]'); process.exit(2); }
  const ei = process.argv.indexOf('--expected');
  const r = auditLive(path.resolve(dir), { expected: ei >= 0 ? JSON.parse(fs.readFileSync(path.resolve(process.argv[ei + 1]), 'utf8')) : null });
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`live run ${r.run.start} → ${r.run.end}`);
    console.log(`  coverage: ${r.coverage.judged_slots}/${r.coverage.expected_slots} intervals judged · ${r.coverage.accepted} accepted · ${r.coverage.rejected} rejected · ${r.coverage.gaps.length} gaps · ${r.coverage.complete ? 'run complete' : 'run not complete'}`);
    for (const g of r.coverage.gaps) console.log(`  gap ${g.from.slice(0, 16)}Z → ${g.to.slice(0, 16)}Z  ${g.seconds / 60} min${g.trailing ? '  to run_end' : g.seconds > OD8_LIMIT_S ? '  over the 2-hour limit' : '  within the 2-hour limit: list it in the write-up'}`);
    if (r.coverage.gaps.length) console.log(`  longest continuous stretch: ${r.coverage.continuity.longest.from.slice(0, 16)}Z → ${r.coverage.continuity.longest.to.slice(0, 16)}Z`);
    console.log(`  raw: ${r.raw.payloads} payload(s) in ${r.raw.files} raw file(s), each checked against the ${r.samples.files} published samples file(s)`);
    for (const f of r.faults) console.log(`  ${f.id.padEnd(24)} ${f.start.slice(0, 16)}Z  ${String(f.refused).padStart(2)}/${f.intervals} refused  ${f.status}  ${Object.keys(f.codes).join(', ')}`);
    if (r.expected) console.log(`  expected refusals: ${r.expected.matching}/${r.expected.listed} match · ${r.expected.not_judged} not judged`);
    for (const p of r.problems) console.log('  ✗ ' + p);
    console.log(r.ok ? 'OK' : 'FAILED');
  }
  process.exitCode = r.ok ? 0 : 1;
}

module.exports = { auditLive, continuityOf };
