#!/usr/bin/env node
/**
 * QWATT — seven-day live run (Deliverable 4)
 * ---------------------------------------------------------------------------
 *   node live/run.js --feed feed --days 8 [--start now|<ISO>] [--seed 20261103] [--speed realtime|fast|<N>]
 *        [--proposer G… --verifier G… --third G…] [--code-commit <40-hex commit>]
 *
 * --days is the run length from run_start, a whole number of days. The live run (W3-4) lasts 8:
 * from Sat 7 Nov 03:00 UTC, one soak day, then the seven counted days to run_end
 * 2026-11-15T03:00:00Z. qwatt-live passes QWATT_RUN_DAYS from /etc/qwatt/live.env; a length that
 * is not a whole number of days (an unset QWATT_RUN_DAYS arrives as "") exits 2 before anything is
 * written.
 *
 * SOW: "the full pipeline anchoring every interval through the multisig at
 * real-time pace, fed by the solar simulator and the CSV replay adapter."
 *
 *   simulator (live/simulator.js, faults from live/schedule.js)
 *     → one CSV per UTC hour (per UTC day when accelerated), with     <feed>/samples/
 *       its SHA-256 in samples/manifest.jsonl; ops/publish-feed.js publishes each
 *       only once its `to` has passed (V3-13c: no sample before its time)
 *     → CSV replay adapter at real-time pace                          ingest/adapters/csv.js
 *     → interval builder → gates → batch pipeline                     batch/pipeline.js
 *     → feed on disk, which the proposer signs and the verifier co-signs (separate processes)
 *
 * Before the first sample the run publishes <feed>/faults.json: the run's
 * parameters and every fault window, so a reviewer can match each injection
 * against the rejection ledger. A restart reads its parameters back from that
 * file and refuses different ones, so a run cannot quietly change seed or schedule.
 *
 * faults.json also carries the fixed label "Simulated input · assurance A0 ·
 * Stellar testnet" (freeze v3 V3-9), the commit of the code the run was started
 * from (`code_commit`, freeze v3 §7: "the frozen commit, named in the feed") and,
 * for every real-time run, the three signer public keys (`anchoring.signers`:
 * proposer, verifier, third), which the reconciliation uses to tell normal
 * anchors from STAND-IN and BROKEN ones. A real-time run does not start without
 * the three keys or without a code commit. A restart refuses a faults.json
 * without the label or one that names other keys. The file never changes:
 * other keys, or another label, mean a new feed.
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
const R = require('../assets/qwatt-reconcile.js');

/* FD-14 (name chosen 27 Oct): a neutral site name. It is in faults.json, index.json and every batch id
   (qwatt-chispa-01-000000, …), which the reconciliation page shows, so it names no place. */
const SITE_ID = 'qwatt-chispa-01';
const NODE_ID = 'live-sim';
const DT_MS = 300 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * V3-13c: where the samples file that starts at `cur` ends, never past `stop`. Real time: the next whole
 * UTC hour. The file is written before its rows are replayed, and ops/publish-feed.js publishes it (and
 * its manifest line) only once its `to` has passed, so it is held at most an hour and an hourly batch's
 * raw payloads go public with the samples they came from (live/audit.js check 4). Accelerated runs: the
 * end of the UTC day.
 */
function chunkEnd(cur, stop, speed) {
  const span = speed === 'realtime' ? 3600e3 : 86400e3;
  return Math.min(Math.floor(cur / span) * span + span, stop);
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * How faults.json describes the run: the speed actually used, never "real-time" for an accelerated run.
 * The live run lasts 8 days (W3-4): one soak day from run_start, then the seven counted days, so it is
 * the seven-day live run after a one-day soak, never an "8-day live run". It is written once.
 */
function describeRun(days, speed) {
  const rig = 'simulated Phase 1 bench rig (150 Wp, two DC meters)';
  const then = 'Each fault window below must appear in ledger/rejected.jsonl with one of its expected reasons.';
  if (speed === 'realtime') {
    const what = days === 7 ? 'seven-day live run'
      : days === 8 ? 'seven-day live run after a one-day soak (run_start to run_end is 8 days; the seven counted days begin one day after run_start)'
        : `${days}-day live run`;
    return `QWATT ${what}: ${rig} replayed through the CSV adapter at real-time pace. ${then}`;
  }
  const pace = speed === 'fast' ? 'as fast as possible (fast mode)' : `at ${speed}× real-time speed`;
  return `QWATT accelerated rehearsal, ${days} simulated day(s), not real time: ${rig} replayed through the CSV adapter ${pace}. ${then}`;
}

/** W3-4: --days <n>, the run length, a whole number of days (1 or more). systemd passes an unset QWATT_RUN_DAYS as "". */
function daysArg(text) {
  if (!/^[1-9][0-9]*$/.test(String(text))) {
    throw new Error(`--days: the run length is a whole number of days (the live run: 8), got ${JSON.stringify(text)}; on the proposer host set QWATT_RUN_DAYS in /etc/qwatt/live.env`);
  }
  return Number(text);
}

/** V3-6: receive time for clock_skew_s. Real time reads the host clock; fast and every numeric speed
    (1 included: like any replay it resumes where the feed ends) use the replay clock. */
const builderClock = (speed) => (speed === 'realtime' ? () => Date.now() : 'replay');

/**
 * The three signer public keys of a run ({ proposer, verifier, third }), checked: each a valid
 * G… address (checksum included) and all three different. null/undefined → null.
 */
function checkSigners(s) {
  if (s == null) return null;
  for (const role of R.ROLE_NAMES) {
    if (R.publicKeyBytes(s[role]) === null) throw new Error(`signers.${role}: a valid G… public key is required`);
  }
  if (new Set(R.ROLE_NAMES.map((r) => s[r])).size !== 3) throw new Error('the proposer, verifier and third signer must be three different keys');
  return { proposer: s.proposer, verifier: s.verifier, third: s.third };
}

/** --proposer G… --verifier G… --third G…: all three (checked) or none (null). */
function signersArg(args) {
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const given = R.ROLE_NAMES.filter((r) => opt(`--${r}`) !== undefined);
  if (!given.length) return null;
  if (given.length !== 3) throw new Error('pass --proposer, --verifier and --third together (public keys)');
  return checkSigners({ proposer: opt('--proposer'), verifier: opt('--verifier'), third: opt('--third') });
}

const COMMIT = /^[0-9a-f]{40}$/;
/**
 * The commit checked out in `repoDir` (HEAD), read from the .git files so that it needs neither the
 * git binary nor git's ownership checks (the service runs as another user than the one that
 * cloned); `git rev-parse HEAD` is only the fallback. null when it is not a checkout.
 * Local modifications are not detected: deploy a clean checkout of the frozen commit.
 */
function codeCommit(repoDir) {
  const read = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch (e) { return null; } };
  try {
    let gitDir = path.join(repoDir, '.git');
    if (fs.statSync(gitDir).isFile()) {   // a worktree or submodule: ".git" names the real directory
      const m = /^gitdir:\s*(.+)$/m.exec(read(gitDir) || '');
      if (!m) return null;
      gitDir = path.resolve(repoDir, m[1].trim());
    }
    const common = read(path.join(gitDir, 'commondir'));
    const commonDir = common ? path.resolve(gitDir, common) : gitDir;
    const head = read(path.join(gitDir, 'HEAD')) || '';
    if (COMMIT.test(head)) return head;   // detached, e.g. `git checkout <tag>`
    const ref = /^ref:\s*(\S+)$/.exec(head);
    if (ref) {
      for (const d of [gitDir, commonDir]) { const v = read(path.join(d, ref[1])); if (v && COMMIT.test(v)) return v; }
      const packed = read(path.join(commonDir, 'packed-refs')) || '';
      const line = packed.split('\n').find((l) => l.endsWith(` ${ref[1]}`));
      if (line && COMMIT.test(line.slice(0, 40))) return line.slice(0, 40);
    }
  } catch (e) { return null; }
  try {
    const out = require('child_process').execFileSync('git', ['-c', 'safe.directory=*', '-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return COMMIT.test(out) ? out : null;
  } catch (e) { return null; }
}

/** Load or create the run definition (faults.json). */
function runDefinition(feedDir, o) {
  const file = path.join(feedDir, 'faults.json');
  if (fs.existsSync(file)) {
    const def = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const k of ['seed', 'days']) {
      if (o[k] != null && o[k] !== def[k]) throw new Error(`this feed's run was defined with ${k}=${def[k]}; refusing ${k}=${o[k]} (start a new feed for a new run)`);
    }
    if (def.label !== R.INPUT_LABEL) throw new Error(`this feed's run was published without the fixed label "${R.INPUT_LABEL}"; start a new feed for a new run`);
    if (o.signers && JSON.stringify((def.anchoring && def.anchoring.signers) || null) !== JSON.stringify(o.signers)) {
      throw new Error("this feed's run was defined with other signer keys (anchoring.signers); refusing them (start a new feed for a new run)");
    }
    return { ...def, faults: S.revive(def.faults), resumed: true };
  }
  /* checked before anything is written: a refused run publishes nothing */
  if (o.speed === 'realtime' && !o.signers) throw new Error('a real-time run publishes who signs: pass --proposer, --verifier and --third (public keys)');
  if (o.speed === 'realtime' && !o.codeCommit) throw new Error('a real-time run names the code it runs (code_commit, freeze v3 §7): start it from a git checkout of the frozen commit, or pass --code-commit <40-hex commit>');
  const startMs = Math.ceil(o.startMs / DT_MS) * DT_MS;
  const def = {
    description: describeRun(o.days, o.speed),
    label: R.INPUT_LABEL,
    site_id: SITE_ID,
    node_id: NODE_ID,
    ...(o.signers ? { anchoring: { network: 'testnet', signers: { proposer: o.signers.proposer, verifier: o.signers.verifier, third: o.signers.third } } } : {}),
    code_commit: o.codeCommit || null,
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
 * @param {number} [o.days=7]       the run length in days (the live run: 8, W3-4; live/soak.js passes a fraction)
 * @param {number} [o.startMs=now]
 * @param {number} [o.seed=20261103]
 * @param {'realtime'|'fast'|number} [o.speed='realtime']
 * @param {number} [o.stopAtMs]   stop early (tests: simulate a crash/restart)
 * @param {{proposer:string, verifier:string, third:string}} [o.signers]   public keys; required for a real-time run
 * @param {string} [o.codeCommit]  the commit the run is started from; default: HEAD of the checkout at `o.repoDir`
 * @param {string} [o.repoDir]     the checkout to name (default: this repository)
 * @param {function} [o.log]
 */
async function runLive(o) {
  const log = o.log || ((...a) => console.log('[live]', ...a));
  const speed = o.speed ?? 'realtime';
  if (o.codeCommit != null && !COMMIT.test(o.codeCommit)) throw new Error(`code commit: a 40-hex commit id is required, got ${JSON.stringify(o.codeCommit)}`);
  const days = o.days ?? 7;
  /* the CLI takes whole days (daysArg); runLive also takes a fraction of a day, as live/soak.js passes --hours / 24 */
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) throw new Error(`days: the run length is a positive number of days, got ${JSON.stringify(days)}`);
  const commit = o.codeCommit || codeCommit(o.repoDir || path.join(__dirname, '..'));
  const def = runDefinition(o.feedDir, { seed: o.seed ?? 20261103, days, startMs: o.startMs ?? Date.now(), speed, signers: checkSigners(o.signers), codeCommit: commit });
  if (def.resumed && commit && def.code_commit && commit !== def.code_commit) {
    log(`note: this code is ${commit}, the run was started from ${def.code_commit} (faults.json code_commit); after the code freeze that is a numbered deviation for the write-up`);
  }
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
    site_id: def.site_id, node_id: def.node_id, adapter: 'csv', dt_s: DT_MS / 1000, clock: builderClock(speed), sample_s: sim.STEP_S,
    meters: { a: { id: 'pzem-017:1', class: 'dc', energy: 'integrate' }, b: { id: 'epever-tracer:2', class: 'dc', energy: 'integrate' } },
    onInterval: (rec) => { pipe.push(rec); intervals++; },
  });

  for (let cur = from; cur < stop;) {
    const end = chunkEnd(cur, stop, speed);
    const text = sim.csvFor(def.seed, cur, end, def.faults);
    const name = `${new Date(cur).toISOString().slice(0, 10)}_${new Date(cur).toISOString().slice(11, 19).replace(/:/g, '')}.csv`;
    const file = path.join(samplesDir, name);
    writeAtomic(file, text);
    fs.appendFileSync(path.join(samplesDir, 'manifest.jsonl'), JSON.stringify({ file: `samples/${name}`, from: new Date(cur).toISOString(), to: new Date(end).toISOString(), rows: text.split('\n').length - 2, sha256: sha(text) }) + '\n');
    /* real time replays no sample before its timestamp (the run start is rounded up to the grid). The file
       above is on disk before its rows' time but not public: the publisher holds it and its manifest line
       until `to` has passed (V3-13c) */
    if (speed === 'realtime' && cur > Date.now()) await new Promise((r) => setTimeout(r, cur - Date.now()));
    log(`replaying ${name} (${new Date(cur).toISOString()} → ${new Date(end).toISOString()})`);
    await csv.replay({ file, ts_column: 'ts', meters: { a: { power_w: 'a_w' }, b: { power_w: 'b_w' } }, pace: speed === 'fast' ? 'fast' : speed, flush: false }, builder);
    cur = end;
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
  let signers, days;
  try { days = daysArg(opt('--days', '7')); signers = signersArg(args); } catch (e) { console.error(e.message); process.exit(2); }
  await runLive({
    feedDir: path.resolve(opt('--feed', 'feed')),
    days,
    seed: Number(opt('--seed', 20261103)),
    startMs: startArg === 'now' ? Date.now() : Date.parse(startArg),
    speed: sp === 'realtime' || sp === 'fast' ? sp : Number(sp),
    signers,
    codeCommit: opt('--code-commit'),
  });
}

if (require.main === module) cli().catch((e) => { console.error('[live] stopped:', e.message); process.exit(1); });

module.exports = { runLive, SITE_ID, builderClock, checkSigners, signersArg, daysArg, codeCommit, chunkEnd };
