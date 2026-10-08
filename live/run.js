#!/usr/bin/env node
/**
 * QWATT — seven-day live run (Deliverable 4)
 * ---------------------------------------------------------------------------
 *   node live/run.js --feed feed --days 7 [--start now|<ISO>] [--seed 20261103] [--speed realtime|fast|<N>]
 *
 * SOW: "the full pipeline anchoring every interval through the multisig at
 * real-time pace, fed by the solar simulator and the CSV replay adapter."
 *
 *   simulator (live/simulator.js, faults from live/schedule.js)
 *     → one CSV per UTC day, published in the feed with its SHA-256   <feed>/samples/
 *     → CSV replay adapter at real-time pace                          ingest/adapters/csv.js
 *     → interval builder → gates → batch pipeline                     batch/pipeline.js
 *     → feed on disk, which the proposer signs and the verifier co-signs (separate processes)
 *
 * Before the first sample the run publishes <feed>/faults.json: the run's
 * parameters and every fault window, so a reviewer can match each injection
 * against the rejection ledger. A restart reads its parameters back from that
 * file and refuses different ones, so a run cannot quietly change seed or schedule.
 *
 * Restart rule: in real time the run resumes at "now". Minutes the runner was
 * down stay a visible gap; they are never backfilled at speed (that would fake
 * liveness). In fast mode (tests, rehearsals) it resumes where the feed ends.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sim = require('./simulator');
const S = require('./schedule');
const { IntervalBuilder } = require('../ingest/lib/normalize');
const csv = require('../ingest/adapters/csv');
const { Pipeline } = require('../batch/pipeline');

const SITE_ID = 'bench-santiago';
const NODE_ID = 'live-sim';
const DT_MS = 300 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Load or create the run definition (faults.json). */
function runDefinition(feedDir, o) {
  const file = path.join(feedDir, 'faults.json');
  if (fs.existsSync(file)) {
    const def = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const k of ['seed', 'days']) {
      if (o[k] != null && o[k] !== def[k]) throw new Error(`this feed's run was defined with ${k}=${def[k]}; refusing ${k}=${o[k]} (start a new feed for a new run)`);
    }
    return { ...def, faults: S.revive(def.faults), resumed: true };
  }
  const startMs = Math.ceil(o.startMs / DT_MS) * DT_MS;
  const def = {
    description: 'QWATT seven-day live run: simulated Phase 1 bench rig (150 Wp, two DC meters, Santiago) replayed through the CSV adapter at real-time pace. Each fault window below must appear in ledger/rejected.jsonl with one of its expected reasons.',
    site_id: SITE_ID,
    node_id: NODE_ID,
    seed: o.seed,
    days: o.days,
    run_start: new Date(startMs).toISOString(),
    run_end: new Date(startMs + o.days * 86400e3).toISOString(),
    sample_step_s: sim.STEP_S,
    interval_s: DT_MS / 1000,
    faults: S.buildSchedule(startMs, o.days).map(({ startMs: _a, endMs: _b, ...rest }) => rest),
    published_at: new Date().toISOString(),
  };
  fs.mkdirSync(feedDir, { recursive: true });
  writeAtomic(file, JSON.stringify(def, null, 2) + '\n');
  return { ...def, faults: S.revive(def.faults), resumed: false };
}

/**
 * Run (or resume) the live run.
 * @param {object} o
 * @param {string} o.feedDir
 * @param {number} [o.days=7]
 * @param {number} [o.startMs=now]
 * @param {number} [o.seed=20261103]
 * @param {'realtime'|'fast'|number} [o.speed='realtime']
 * @param {number} [o.stopAtMs]   stop early (tests: simulate a crash/restart)
 * @param {function} [o.log]
 */
async function runLive(o) {
  const log = o.log || ((...a) => console.log('[live]', ...a));
  const speed = o.speed ?? 'realtime';
  const def = runDefinition(o.feedDir, { seed: o.seed ?? 20261103, days: o.days ?? 7, startMs: o.startMs ?? Date.now() });
  const runStart = Date.parse(def.run_start), runEnd = Date.parse(def.run_end);
  const pipe = new Pipeline({ dir: o.feedDir, site_id: def.site_id, node_id: def.node_id });
  const samplesDir = path.join(o.feedDir, 'samples');
  fs.mkdirSync(samplesDir, { recursive: true });

  /* where to begin: real time resumes at now (gaps stay gaps); fast resumes where the feed ends */
  const head = pipe.head();
  const fedUntil = head && head.last_ts_start ? Date.parse(head.last_ts_start) + DT_MS : runStart;
  let from = speed === 'realtime' ? Math.max(runStart, Date.now()) : Math.max(runStart, fedUntil);
  from = Math.ceil(from / (sim.STEP_S * 1000)) * sim.STEP_S * 1000;
  const stop = Math.min(runEnd, o.stopAtMs ?? Infinity);
  log(`${def.resumed ? 'resuming' : 'starting'} run ${def.run_start} → ${def.run_end} · ${def.faults.length} faults scheduled · from ${new Date(from).toISOString()} · speed ${speed}`);

  let intervals = 0;
  const builder = new IntervalBuilder({
    site_id: def.site_id, node_id: def.node_id, adapter: 'csv', dt_s: DT_MS / 1000,
    meters: { a: { id: 'pzem-017:1', class: 'dc', energy: 'integrate' }, b: { id: 'epever-tracer:2', class: 'dc', energy: 'integrate' } },
    onInterval: (rec) => { pipe.push(rec); intervals++; },
  });

  for (let cur = from; cur < stop;) {
    const dayEnd = Math.floor(cur / 86400e3) * 86400e3 + 86400e3;
    const chunkEnd = Math.min(dayEnd, stop);
    const text = sim.csvFor(def.seed, cur, chunkEnd, def.faults);
    const name = `${new Date(cur).toISOString().slice(0, 10)}_${new Date(cur).toISOString().slice(11, 19).replace(/:/g, '')}.csv`;
    const file = path.join(samplesDir, name);
    writeAtomic(file, text);
    fs.appendFileSync(path.join(samplesDir, 'manifest.jsonl'), JSON.stringify({ file: `samples/${name}`, from: new Date(cur).toISOString(), to: new Date(chunkEnd).toISOString(), rows: text.split('\n').length - 2, sha256: sha(text) }) + '\n');
    /* real time never emits a sample before its timestamp (the run start is rounded up to the grid) */
    if (speed === 'realtime' && cur > Date.now()) await new Promise((r) => setTimeout(r, cur - Date.now()));
    log(`replaying ${name} (${new Date(cur).toISOString()} → ${new Date(chunkEnd).toISOString()})`);
    await csv.replay({ file, ts_column: 'ts', meters: { a: { power_w: 'a_w' }, b: { power_w: 'b_w' } }, pace: speed === 'fast' ? 'fast' : speed, flush: false }, builder);
    cur = chunkEnd;
  }

  if (stop >= runEnd) {
    builder.flush();
    pipe.close();
    log(`run complete · ${intervals} intervals this session`);
  } else {
    log(`stopped early at ${new Date(stop).toISOString()} · ${intervals} intervals this session`);
  }
  return { def, intervals, head: pipe.head() };
}

async function cli() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const sp = opt('--speed', 'realtime');
  const startArg = opt('--start', 'now');
  await runLive({
    feedDir: path.resolve(opt('--feed', 'feed')),
    days: Number(opt('--days', 7)),
    seed: Number(opt('--seed', 20261103)),
    startMs: startArg === 'now' ? Date.now() : Date.parse(startArg),
    speed: sp === 'realtime' || sp === 'fast' ? sp : Number(sp),
  });
}

if (require.main === module) cli().catch((e) => { console.error('[live] stopped:', e.message); process.exit(1); });

module.exports = { runLive, SITE_ID };
