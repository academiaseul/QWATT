#!/usr/bin/env node
/**
 * QWATT — audit a live-run feed (Deliverable 4 acceptance)
 * ---------------------------------------------------------------------------
 *   node live/audit.js <feed-dir> [--json]
 *
 * From the published feed alone:
 *   1. every scheduled fault (faults.json): each 5-minute interval fully inside
 *      its window is in ledger/rejected.jsonl with one of the expected reasons,
 *      and none of them was accepted;
 *   2. coverage: every 5-minute slot from the run start to the last judged slot
 *      is judged exactly once (accepted or rejected). Gaps — the runner was
 *      down — and duplicates are listed;
 *   3. raw samples: every published samples/*.csv hashes to its manifest entry.
 * Exit 0 when all hold, 1 otherwise.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DT_MS = 300 * 1000;

function readJsonl(f) {
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
}

function auditLive(feedDir) {
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
    const due = s + DT_MS <= Date.now() || seen.length > 0;
    const status = !due ? 'not yet due'
      : seen.length < slots.length ? 'incomplete'
        : refused.length === slots.length && acceptedInside.length === 0 ? 'refused as expected' : 'NOT REFUSED';
    if (status === 'NOT REFUSED') problems.push(`${f.id}: ${acceptedInside.length} faulty interval(s) accepted or refused for the wrong reason (${JSON.stringify(codes)})`);
    return { id: f.id, kind: f.kind, start: f.start, end: f.end, expect: f.expect, intervals: slots.length, judged: seen.length, refused: refused.length, accepted: acceptedInside.length, codes, status };
  });

  /* 2. coverage */
  const keys = [...bySlot.keys()].sort((a, b) => a - b);
  const runStart = Date.parse(def.run_start);
  const last = keys.length ? keys[keys.length - 1] : runStart - DT_MS;
  const gaps = [];
  let gapStart = null;
  for (let t = runStart; t <= last; t += DT_MS) {
    const has = bySlot.has(t);
    if (!has && gapStart == null) gapStart = t;
    if (has && gapStart != null) { gaps.push({ from: new Date(gapStart).toISOString(), to: new Date(t).toISOString(), intervals: (t - gapStart) / DT_MS }); gapStart = null; }
  }
  const duplicates = keys.filter((k) => bySlot.get(k).length > 1).map((k) => new Date(k).toISOString());
  if (gaps.length) problems.push(`${gaps.reduce((s, g) => s + g.intervals, 0)} interval(s) never judged, in ${gaps.length} gap(s)`);
  if (duplicates.length) problems.push(`${duplicates.length} slot(s) judged more than once`);

  /* 3. raw samples */
  const manifest = readJsonl(path.join(feedDir, 'samples', 'manifest.jsonl'));
  for (const m of manifest) {
    const f = path.join(feedDir, m.file);
    if (!fs.existsSync(f)) { problems.push(`${m.file}: listed in the manifest but missing`); continue; }
    const h = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    if (h !== m.sha256) problems.push(`${m.file}: does not hash to its manifest entry`);
  }

  const expectedSlots = keys.length ? (last - runStart) / DT_MS + 1 : 0;
  return {
    ok: problems.length === 0,
    problems,
    run: { start: def.run_start, end: def.run_end, seed: def.seed },
    coverage: { judged_slots: keys.length, expected_slots: expectedSlots, gaps, duplicates, accepted: accepted.length, rejected: rejected.length },
    faults,
    samples: { files: manifest.length },
  };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node live/audit.js <feed-dir> [--json]'); process.exit(2); }
  const r = auditLive(path.resolve(dir));
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`live run ${r.run.start} → ${r.run.end}`);
    console.log(`  coverage: ${r.coverage.judged_slots}/${r.coverage.expected_slots} intervals judged · ${r.coverage.accepted} accepted · ${r.coverage.rejected} rejected · ${r.coverage.gaps.length} gaps`);
    for (const f of r.faults) console.log(`  ${f.id.padEnd(24)} ${f.start.slice(0, 16)}Z  ${String(f.refused).padStart(2)}/${f.intervals} refused  ${f.status}  ${Object.keys(f.codes).join(', ')}`);
    for (const p of r.problems) console.log('  ✗ ' + p);
    console.log(r.ok ? 'OK' : 'FAILED');
  }
  process.exitCode = r.ok ? 0 : 1;
}

module.exports = { auditLive };
