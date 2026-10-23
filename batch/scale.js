#!/usr/bin/env node
/**
 * QWATT — Deliverable 2 scale test
 * ---------------------------------------------------------------------------
 * One month of samples → CSV adapter → interval builder → batch pipeline →
 * feed on disk, then the whole feed is re-derived by verify-cli. Run twice from
 * scratch, the head hash must be identical (determinism).
 *
 *   node batch/scale.js                               synthetic month (default)
 *   node batch/scale.js --dataset datasets/pvdaq-4902-2017-09/dataset.json   a public dataset (batch/datasets/pvdaq.js)
 *   node batch/scale.js --csv month.csv --a a_w --b b_w [--ts ts]
 *   node batch/scale.js --out out/scale --json
 *
 * The synthetic month is a stand-in until the public PV dataset is chosen
 * (plan unit 1.7): Santiago clear-sky shape from the shared solar-position
 * function, deterministic cloud passages, two DC meters ~1% apart, 60 s
 * samples. Exit 1 if the chain does not verify or the two runs disagree.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { IntervalBuilder } = require('../ingest/lib/normalize');
const csv = require('../ingest/adapters/csv');
const { Pipeline } = require('./pipeline');
const { verifyFeed } = require('./verify-cli');
const V = require('./verify');

const SITE = V.SPEC.profiles.bench.site;
const NAMEPLATE_W = V.SPEC.profiles.bench.nameplate_w;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 30 days from 2026-09-01T00:00Z at 60 s, written as a CSV the real adapter replays. */
function writeSyntheticMonth(file, { days = 30, stepS = 60 } = {}) {
  const rnd = mulberry32(20260901);
  const t0 = Date.parse('2026-09-01T00:00:00Z');
  const n = days * 86400 / stepS;
  const out = fs.createWriteStream(file);
  out.write('ts,a_w,b_w\n');
  let cloud = 1;
  for (let i = 0; i < n; i++) {
    const ts = t0 + i * stepS * 1000;
    const el = V.GATES.solarElevationDeg(new Date(ts), SITE.lat, SITE.lon);
    if (rnd() < 0.004) cloud = 0.35 + 0.5 * rnd();          // a cloud arrives
    else if (rnd() < 0.02) cloud = 1;                        // and leaves
    const clear = el > 0 ? 0.82 * NAMEPLATE_W * Math.sin(el * Math.PI / 180) : 0;
    const a = Math.max(0, Math.round(clear * cloud * 10) / 10);
    const b = Math.max(0, Math.round(a * (0.99 + (rnd() - 0.5) * 0.004) * 100) / 100);
    out.write(`${new Date(ts).toISOString()},${a.toFixed(1)},${b.toFixed(2)}\n`);
  }
  return new Promise((resolve) => out.end(resolve));
}

const BENCH_RUN = {
  site_id: 'bench-santiago',
  profile: undefined,                                   // spec profile "bench"
  meters: { a: { id: 'pzem-017:1', class: 'dc' }, b: { id: 'epever-tracer:2', class: 'dc' } },
};

async function runOnce(csvFile, cols, feedDir, run = BENCH_RUN) {
  fs.rmSync(feedDir, { recursive: true, force: true });
  const pipe = new Pipeline({ dir: feedDir, site_id: run.site_id, node_id: 'scale', profile: run.profile });
  const builder = new IntervalBuilder({
    site_id: run.site_id, node_id: 'scale', adapter: 'csv', dt_s: 300, clock: 'replay',   // V3-6: a fast replay's receive time is the replayed time
    meters: { a: { ...run.meters.a, energy: 'integrate' }, b: { ...run.meters.b, energy: 'integrate' } },
    onInterval: (rec) => pipe.push(rec),
  });
  const t = Date.now();
  const { rows, intervals } = await csv.replay({ file: csvFile, ts_column: cols.ts, meters: { a: { power_w: cols.a }, b: { power_w: cols.b } }, pace: 'fast' }, builder);
  pipe.close();
  return { rows, intervals, ms: Date.now() - t, verify: verifyFeed(feedDir, { profile: run.profile }) };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const out = path.resolve(opt('--out', path.join(os.tmpdir(), 'qwatt-scale')));
  fs.mkdirSync(out, { recursive: true });

  let csvFile = opt('--csv', null);
  let cols = { ts: opt('--ts', 'ts'), a: opt('--a', 'a_w'), b: opt('--b', 'b_w') };
  let source = csvFile ? path.basename(csvFile) : 'synthetic month (Santiago clear sky + clouds, 60 s)';
  let run = BENCH_RUN;
  const dsFile = opt('--dataset', null);
  if (dsFile) {
    const ds = JSON.parse(fs.readFileSync(dsFile, 'utf8'));
    csvFile = path.join(path.dirname(path.resolve(dsFile)), ds.csv);
    cols = { ts: ds.ts_column, a: ds.meters.a.column, b: ds.meters.b.column };
    run = { site_id: ds.site_id, profile: ds.profile, meters: { a: { id: ds.meters.a.id, class: ds.meters.a.class }, b: { id: ds.meters.b.id, class: ds.meters.b.class } } };
    source = `${ds.title} · ${ds.licence}`;
  }
  if (!csvFile) { csvFile = path.join(out, 'synthetic-month.csv'); await writeSyntheticMonth(csvFile); }

  const r1 = await runOnce(csvFile, cols, path.join(out, 'feed-run1'), run);
  const r2 = await runOnce(csvFile, cols, path.join(out, 'feed-run2'), run);
  const v = r1.verify;
  const summary = {
    source,
    rows: r1.rows,
    intervals: r1.intervals,
    batches: v.batches,
    accepted_batches: v.accepted_batches,
    rejected_batches: v.rejected_batches,
    cumulative_mwh: v.cumulative_mwh,
    head_sha256: v.head_sha256,
    chain_verified: v.ok,
    deterministic: r1.verify.head_sha256 === r2.verify.head_sha256,
    wall_ms_per_run: r1.ms,
    problems: v.problems,
  };
  if (args.includes('--json')) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`scale: ${summary.source}`);
    console.log(`  ${summary.rows} rows → ${summary.intervals} intervals → ${summary.batches} batches (${summary.rejected_batches} rejected) in ${summary.wall_ms_per_run} ms`);
    console.log(`  cumulative ${summary.cumulative_mwh} mWh · head ${summary.head_sha256}`);
    console.log(`  chain ${summary.chain_verified ? 'VERIFIED' : 'BROKEN'} · second run ${summary.deterministic ? 'IDENTICAL' : 'DIFFERENT'}`);
    for (const p of summary.problems) console.log('  ✗ ' + p);
  }
  process.exit(summary.chain_verified && summary.deterministic ? 0 : 1);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { writeSyntheticMonth };
