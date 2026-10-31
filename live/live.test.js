/**
 * QWATT live run — tests (Deliverable 4), offline, accelerated
 * Run: node live/live.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const sim = require('./simulator');
const S = require('./schedule');
const G = require('../assets/qwatt-gates.js');
const { runLive } = require('./run');
const { auditLive } = require('./audit');
const { verifyFeed } = require('../batch/verify-cli');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const START = Date.parse('2026-11-03T03:00:00Z');
const quiet = () => {};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-live-'));
const el = (t) => G.solarElevationDeg(new Date(t), sim.PROFILE.site.lat, sim.PROFILE.site.lon);

test('the simulator is a pure function of (seed, time): any minute regenerates identically', () => {
  const a = sim.csvFor(7, START + 3600e3 * 15, START + 3600e3 * 16);
  const b = sim.csvFor(7, START + 3600e3 * 15, START + 3600e3 * 16);
  eq(a, b, 'same seed, same window');
  assert(sim.csvFor(8, START + 3600e3 * 15, START + 3600e3 * 16) !== a, 'a different seed differs');
  const slice = sim.csvFor(7, START + 3600e3 * 15 + 600e3, START + 3600e3 * 15 + 660e3).split('\n').slice(1).join('\n');
  assert(a.includes(slice.trim()), 'a sub-window equals the same rows of the full window (restart-safe)');
});

test('physics: zero at night, never above the bench nameplate, meters within ~1% by day', () => {
  for (let t = START; t < START + 86400e3; t += 60e3) {
    const s = sim.sampleAt(20261103, t);
    if (el(t) <= 0) { eq(s.a, 0, `night a at ${new Date(t).toISOString()}`); continue; }
    assert(s.a <= sim.PROFILE.nameplate_w, `a ${s.a} over nameplate`);
    if (s.a > 20) assert(Math.abs(s.a - s.b) / s.a < 0.03, `meters diverge at ${new Date(t).toISOString()}: ${s.a} vs ${s.b}`);
  }
});

test('the schedule covers all four SOW fault kinds twice, grid-aligned, at physically meaningful times', () => {
  const f = S.buildSchedule(START, 7);
  eq(f.length, 8, 'eight injections');
  for (const k of Object.keys(S.EXPECT)) eq(f.filter((x) => x.kind === k).length, 2, `${k} twice`);
  for (const x of f) {
    eq(x.startMs % 300000, 0, `${x.id} aligned`);
    eq((x.endMs - x.startMs) % 300000, 0, `${x.id} whole intervals`);
    if (x.kind === 'night_injection') assert(el(x.startMs) < -30 && el(x.endMs) < -30, `${x.id} far below the −2° floor`);
    else assert(el(x.startMs) > 25, `${x.id} at high sun (${el(x.startMs).toFixed(1)}°)`);
  }
});

test('a full four-day run: every interval judged once, every fault refused for its reason, chain verified', async () => {
  const dir = tmp();
  await runLive({ feedDir: dir, days: 4, startMs: START, seed: 20261103, speed: 'fast', log: quiet });
  const a = auditLive(dir);
  assert(a.ok, a.problems.join('; '));
  eq(a.coverage.judged_slots, 4 * 288, 'coverage');
  eq(a.faults.length, 4, 'faults in four days');
  for (const f of a.faults) eq(f.status, 'refused as expected', f.id);
  const v = verifyFeed(dir);
  assert(v.ok, v.problems.join('; '));
  eq(v.batches, 4 * 24, 'hourly batches');
});

test('crash and restart mid-run (fast mode): no gap, no duplicate, same energy as an uninterrupted run', async () => {
  const one = tmp(), two = tmp();
  await runLive({ feedDir: one, days: 2, startMs: START, seed: 5, speed: 'fast', log: quiet });
  await runLive({ feedDir: two, days: 2, startMs: START, seed: 5, speed: 'fast', log: quiet, stopAtMs: START + 31 * 3600e3 + 137e3 });
  await runLive({ feedDir: two, days: 2, startMs: START, seed: 5, speed: 'fast', log: quiet });   // resumes
  const a = auditLive(two);
  assert(a.ok, a.problems.join('; '));
  eq(a.coverage.judged_slots, 2 * 288, 'complete');
  eq(a.coverage.duplicates.length, 0, 'no duplicates');
  const v = verifyFeed(two);
  assert(v.ok, v.problems.join('; '));
  eq(v.cumulative_mwh, verifyFeed(one).cumulative_mwh, 'same energy as the uninterrupted run');
});

test('V3-6: the simulator path stamps clock_skew_s from the replay clock in an accelerated run, from the wall clock in real time', async () => {
  const { builderClock } = require('./run');
  eq(typeof builderClock, 'function', 'live/run.js exports builderClock');
  eq(typeof builderClock('realtime'), 'function', 'real time reads a real clock');
  const before = Date.now(), read = builderClock('realtime')();
  assert(read >= before && read <= Date.now(), 'the real-time clock is the host clock');
  eq(builderClock('fast'), 'replay', 'fast');
  eq(builderClock(60), 'replay', 'accelerated ×60');
  eq(builderClock(1), 'replay', 'a numeric speed of 1 resumes like a replay, so it uses the replay clock');
  const dir = tmp();
  await runLive({ feedDir: dir, days: 3, startMs: START, seed: 20261103, speed: 'fast', log: quiet });
  const lines = ['accepted', 'rejected'].flatMap((n) => fs.readFileSync(path.join(dir, 'ledger', n + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  eq(lines.length, 3 * 288, 'every interval judged');
  const seen = {};
  for (const l of lines) { const k = l.interval.clock_skew_s; assert(Number.isInteger(k), `no clock_skew_s at ${l.interval.ts_start}`); seen[k] = (seen[k] || 0) + 1; }
  eq(JSON.stringify(seen), JSON.stringify({ 0: 859, 300: 4, '-10': 1 }), 'closed at its end; by the grace while meter b is disconnected; the final flush 10 s early');
});

test('a restarted run refuses to change its seed or length', async () => {
  const dir = tmp();
  await runLive({ feedDir: dir, days: 1, startMs: START, seed: 1, speed: 'fast', log: quiet, stopAtMs: START + 3600e3 });
  let threw = false;
  try { await runLive({ feedDir: dir, days: 1, startMs: START, seed: 2, speed: 'fast', log: quiet }); } catch (e) { threw = /seed/.test(e.message); }
  assert(threw, 'a different seed must be refused');
});

test('the audit catches a fault that was not refused, a gap, and an altered sample file', async () => {
  const dir = tmp();
  await runLive({ feedDir: dir, days: 2, startMs: START, seed: 20261103, speed: 'fast', log: quiet });
  const def = JSON.parse(fs.readFileSync(path.join(dir, 'faults.json'), 'utf8'));
  const f = def.faults[0];
  /* forge: move the fault's rejected lines into the accepted ledger, and drop one other slot entirely */
  const rejF = path.join(dir, 'ledger', 'rejected.jsonl'), accF = path.join(dir, 'ledger', 'accepted.jsonl');
  const rej = fs.readFileSync(rejF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const inside = (l) => Date.parse(l.interval.ts_start) >= Date.parse(f.start) && Date.parse(l.interval.ts_start) < Date.parse(f.end);
  fs.writeFileSync(rejF, rej.filter((l) => !inside(l)).map((l) => JSON.stringify(l)).join('\n') + '\n');
  const acc = fs.readFileSync(accF, 'utf8').split('\n').filter(Boolean);
  const moved = rej.filter(inside).map((l) => JSON.stringify({ ...l, verdict: 'accept', reasons: [] }));
  fs.writeFileSync(accF, [...acc.slice(0, 100), ...acc.slice(101), ...moved].join('\n') + '\n');
  const m = path.join(dir, 'samples', fs.readdirSync(path.join(dir, 'samples')).find((x) => x.endsWith('.csv')));
  fs.appendFileSync(m, '2099-01-01T00:00:00.000Z,1,1\n');
  const a = auditLive(dir);
  assert(!a.ok, 'must fail');
  assert(a.problems.some((p) => p.startsWith(f.id)), 'unrefused fault reported');
  assert(a.problems.some((p) => /never judged/.test(p)), 'gap reported');
  assert(a.problems.some((p) => /does not hash/.test(p)), 'altered sample file reported');
});

/* ───────────── week 2 (V3-9): the fixed label, who signs, and the code the run was started from ───────────── */

const LABEL = 'Simulated input · assurance A0 · Stellar testnet';
const FHH = require('../anchor/fake-horizon-http');   // throwaway in-memory keys only; no network
const SIGNERS = { proposer: FHH.throwawayKey().G, verifier: FHH.throwawayKey().G, third: FHH.throwawayKey().G };
const REPO = path.join(__dirname, '..');
const gitHead = () => require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
const run = require('./run');
const readDef = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'faults.json'), 'utf8'));
async function throwsLike(fn, re, what) {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert(err && re.test(err.message), `${what}: expected an error matching ${re}, got ${err ? JSON.stringify(err.message) : 'none'}`);
}

test('V3-9: faults.json carries the fixed label "Simulated input · assurance A0 · Stellar testnet" and the three signer roles it was given', async () => {
  const dir = tmp();
  await runLive({ feedDir: dir, days: 1, startMs: START, seed: 3, speed: 'fast', log: quiet, stopAtMs: START + 3600e3, signers: SIGNERS });
  const def = readDef(dir);
  eq(def.label, LABEL, 'label');
  eq(JSON.stringify(def.anchoring), JSON.stringify({ network: 'testnet', signers: SIGNERS }), 'anchoring');
  const keys = Object.keys(def);
  eq(keys.indexOf('label'), keys.indexOf('description') + 1, 'the label comes right after the description');
  assert(!/"S[A-Z2-7]{55}"/.test(JSON.stringify(def)), 'no secret key in faults.json');
});

test('V3-9: faults.json names the code commit the run was started from (freeze v3 §7: "the frozen commit, named in the feed")', async () => {
  const dir = tmp();
  await runLive({ feedDir: dir, days: 1, startMs: START, seed: 3, speed: 'fast', log: quiet, stopAtMs: START + 3600e3, signers: SIGNERS });
  const inCheckout = fs.existsSync(path.join(REPO, '.git'));   // a ZIP or `git archive` copy has no .git: the commit is then null
  eq(readDef(dir).code_commit, inCheckout ? gitHead() : null, 'code_commit = HEAD of this checkout');
  const given = 'f'.repeat(40), other = tmp();
  await runLive({ feedDir: other, days: 1, startMs: START, seed: 3, speed: 'fast', log: quiet, stopAtMs: START + 3600e3, codeCommit: given });
  eq(readDef(other).code_commit, given, 'an explicit commit is recorded as given');
  await throwsLike(() => runLive({ feedDir: tmp(), days: 1, startMs: START, seed: 3, speed: 'fast', log: quiet, stopAtMs: START + 3600e3, codeCommit: 'v1.0' }), /40/, 'a commit that is not 40 hex characters');
  /* a real-time run publishes which code it runs: from outside a checkout, with no commit given, it does not start */
  const s = Date.now() - 2 * 86400e3, nowhere = tmp();
  await throwsLike(() => runLive({ feedDir: nowhere, days: 1, startMs: s, seed: 3, speed: 'realtime', log: quiet, stopAtMs: s + 3600e3, signers: SIGNERS, repoDir: tmp() }), /commit/, 'real time without a code commit');
  assert(!fs.existsSync(path.join(nowhere, 'faults.json')), 'nothing is published when the run refuses to start');
});

test('V3-9: a resumed run refuses a faults.json without the fixed label, and refuses other signer keys', async () => {
  const dir = tmp();
  const o = { feedDir: dir, days: 1, startMs: START, seed: 3, speed: 'fast', log: quiet, stopAtMs: START + 3600e3 };
  await runLive({ ...o, signers: SIGNERS });
  await throwsLike(() => runLive({ ...o, signers: { ...SIGNERS, verifier: SIGNERS.third, third: SIGNERS.verifier } }), /signer keys/, 'verifier and third swapped');
  await runLive({ ...o, stopAtMs: START + 2 * 3600e3, signers: SIGNERS });   // the same keys resume
  const def = readDef(dir);
  delete def.label;
  fs.writeFileSync(path.join(dir, 'faults.json'), JSON.stringify(def, null, 2) + '\n');
  await throwsLike(() => runLive({ ...o, signers: SIGNERS }), /fixed label/, 'a faults.json without the label');
  fs.writeFileSync(path.join(dir, 'faults.json'), JSON.stringify({ ...def, label: 'Simulated input · Stellar testnet' }, null, 2) + '\n');
  await throwsLike(() => runLive({ ...o, signers: SIGNERS }), /fixed label/, 'a faults.json with the week-1 label');
});

test('V3-9: a real-time run will not start without the three signer roles, and refuses a bad or repeated key', async () => {
  const s = Date.now() - 2 * 86400e3;
  const rt = (dir, signers) => runLive({ feedDir: dir, days: 1, startMs: s, seed: 3, speed: 'realtime', log: quiet, stopAtMs: s + 3600e3, signers });
  const none = tmp();
  await throwsLike(() => rt(none, undefined), /--proposer/, 'no signers');
  assert(!fs.existsSync(path.join(none, 'faults.json')), 'no faults.json is written');
  await throwsLike(() => rt(tmp(), { ...SIGNERS, proposer: 'GBAD' }), /proposer/, 'a proposer key that is not a G… address');
  await throwsLike(() => rt(tmp(), { ...SIGNERS, verifier: SIGNERS.proposer }), /different keys/, 'one key in two roles');
  await throwsLike(() => rt(tmp(), { ...SIGNERS, third: SIGNERS.verifier }), /different keys/, 'verifier and third the same key');
  const flipped = SIGNERS.third.slice(0, 55) + (SIGNERS.third[55] === 'A' ? 'B' : 'A');
  await throwsLike(() => rt(tmp(), { ...SIGNERS, third: flipped }), /third/, 'a third key with a wrong checksum');
  assert(typeof run.signersArg === 'function', 'signersArg is exported');
  await throwsLike(() => run.signersArg(['--proposer', SIGNERS.proposer]), /together/, 'one role flag alone');
  eq(run.signersArg([]), null, 'no role flags');
  eq(JSON.stringify(run.signersArg(['--proposer', SIGNERS.proposer, '--verifier', SIGNERS.verifier, '--third', SIGNERS.third])), JSON.stringify(SIGNERS), 'all three flags');
});

test('V3-9: a run\'s feed reconciles with what its faults.json publishes: label present, roles read from it, proposer + verifier anchors normal', async () => {
  const R = require('../assets/qwatt-reconcile.js');
  const E = require('../protocol/evidence');
  const { Feed } = require('../batch/feed');
  const K = { proposer: FHH.throwawayKey(), verifier: FHH.throwawayKey(), third: FHH.throwawayKey() };
  const roles = { proposer: K.proposer.G, verifier: K.verifier.G, third: K.third.G };
  const account = FHH.throwawayKey().G;
  const dir = tmp();
  await runLive({ feedDir: dir, days: 1, startMs: START, seed: 3, speed: 'fast', log: quiet, stopAtMs: START + 6 * 3600e3, signers: roles });
  /* the feed exactly as fetchFeed returns it, read from disk */
  const f = new Feed(dir);
  const listed = f.readLedger('batches');
  const feed = { index: f.readIndex(), run: readDef(dir), listed, batches: Object.fromEntries(listed.map((e) => [e.batch_id, f.readBatch(e.batch_id)])), rejected: f.readLedger('rejected') };
  const anchors = listed.filter((e) => e.status === 'accepted').map((e, i) => {
    const h = E.sha256('live-tx' + e.seq);
    return { tx_hash: h, ledger: 100 + i, created_at: new Date(START + i * 3600e3).toISOString(), memo: `QW#${e.seq}`, sha256: e.sha256,
      cumulative_mwh: feed.batches[e.batch_id].cumulative_mwh, signatures: [K.proposer.sign(h), K.verifier.sign(h)] };
  });
  assert(anchors.length >= 3, `a few anchored batches (${anchors.length})`);
  const record = FHH.accountRecord({ account, signers: [roles.proposer, roles.verifier, roles.third] });
  const rep = await R.reconcile(feed, anchors, { account, record, roles: null });
  eq(rep.verdict, 'RECONCILED', rep.problems.join('; '));
  eq(rep.summary.label_in_feed, true, 'the label is in faults.json');
  eq(rep.summary.roles_source, 'faults.json', 'roles read from faults.json');
  eq(rep.summary.signatures.normal, anchors.length, 'every anchor is proposer + verifier');
});

/* ───────────── week 2 (V3-9.3, FD-14): batch ids on screen need a site_id that names no place ───────────── */

test('FD-14: the live run\'s site_id is the neutral qwatt-chispa-01, so faults.json, index.json and every batch id carry it and no place name', async () => {
  eq(run.SITE_ID, 'qwatt-chispa-01', 'live/run.js SITE_ID');
  const { Feed } = require('../batch/feed');
  const dir = tmp();
  await runLive({ feedDir: dir, days: 1, startMs: START, seed: 3, speed: 'fast', log: quiet, stopAtMs: START + 3 * 3600e3, signers: SIGNERS });
  eq(readDef(dir).site_id, 'qwatt-chispa-01', 'faults.json site_id');
  assert(!/santiago/i.test(readDef(dir).description || ''), `the published run description names no city: ${readDef(dir).description}`);
  const f = new Feed(dir);
  eq(f.readIndex().site_id, 'qwatt-chispa-01', 'index.json site_id');
  const listed = f.readLedger('batches');
  assert(listed.length >= 2, `a few batches (${listed.length})`);
  listed.forEach((e) => eq(e.batch_id, 'qwatt-chispa-01-' + String(e.seq).padStart(6, '0'), `batch ${e.seq} id`));
  const names = fs.readdirSync(path.join(dir, 'batches')).concat(fs.existsSync(path.join(dir, 'raw')) ? fs.readdirSync(path.join(dir, 'raw')) : []);
  assert(names.length > 0 && names.every((n) => n.startsWith('qwatt-chispa-01-')), `every batch and raw file is named after the neutral site: ${names.join(' ')}`);
  assert(!/santiago/i.test(names.join(' ')), 'no public file name names the bench city');
});

test('the audit ties every published raw payload to a row of a published samples file, on accepted and refused lines alike', async () => {
  const dir = tmp();
  await runLive({ feedDir: dir, days: 2, startMs: START, seed: 20261103, speed: 'fast', log: quiet });   // two days: the first fault, F01, is on day 2
  const a = auditLive(dir);
  assert(a.ok, a.problems.join('; '));
  assert(a.raw, 'the audit reports the raw payloads it checked');
  const rawDir = path.join(dir, 'raw');
  const files = fs.readdirSync(rawDir).filter((n) => n.endsWith('.jsonl')).sort();
  const read = (f) => fs.readFileSync(path.join(rawDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const entries = files.reduce((s, f) => s + read(f).reduce((t, l) => t + l.payloads.length, 0), 0);   // counted here, independently
  assert(files.length > 0 && entries > 0, 'the run published raw payloads');
  eq(a.raw.files, files.length, 'every raw file audited');
  eq(a.raw.payloads, entries, 'every payload entry audited, not only the first of each file');
  const forge = (line) => {   // one payload in the middle of the line becomes a reading that is in no published samples row
    const p = line.payloads[Math.floor(line.payloads.length / 2)];
    const was = p.utf8;
    p.utf8 = was.replace(/^([^,]*),[^,]*,/, '$1,149.9,');
    assert(p.utf8 !== was, 'the payload was edited');
  };
  /* a line in the middle of the LAST raw file */
  const last = files[files.length - 1];
  const lastText = fs.readFileSync(path.join(rawDir, last), 'utf8');
  const lines = read(last);
  const line = lines[Math.floor(lines.length / 2)];
  forge(line);
  fs.writeFileSync(path.join(rawDir, last), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const b = auditLive(dir);
  assert(!b.ok, 'must fail');
  assert(b.problems.some((x) => /1 raw payload\(s\) not a row of a published samples file/.test(x) && x.includes(`raw/${last} ${line.ts_start}`)),
    `the forged payload is reported with its file and interval: ${b.problems.join('; ')}`);
  fs.writeFileSync(path.join(rawDir, last), lastText);
  assert(auditLive(dir).ok, 'restored');
  /* the same on a line the gates refused: its payloads are in samples_root too, and nothing else checks them against the samples */
  const refused = files.map((f) => ({ f, ls: read(f) })).map(({ f, ls }) => ({ f, ls, l: ls.find((l) => l.verdict === 'reject' && l.payloads.length > 0) })).find((x) => x.l);
  assert(refused, 'the run published a refused line with its payloads');
  forge(refused.l);
  fs.writeFileSync(path.join(rawDir, refused.f), refused.ls.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const c = auditLive(dir);
  assert(!c.ok, 'must fail on a refused line');
  assert(c.problems.some((x) => /1 raw payload\(s\) not a row of a published samples file/.test(x) && x.includes(`raw/${refused.f} ${refused.l.ts_start}`)),
    `the forged payload of the refused line is reported with its file and interval: ${c.problems.join('; ')}`);
});

/* ───────────── week 3 (W3-4): the run length, one soak day then the seven counted days ───────────── */

const RUN_START = '2026-11-07T03:00:00Z';   // Sat 7 Nov 03:00 UTC (freeze v3 V3-14)
const COUNTED = { from: Date.parse('2026-11-08T03:00:00Z'), to: Date.parse('2026-11-15T03:00:00Z') };   // Sun 8 to Sun 15, 03:00 UTC

test('W3-4: an 8-day run from Sat 7 Nov 03:00 UTC ends Sun 15 Nov 03:00 UTC, when the counted window closes; its faults stay on Sun 8 - Fri 13; faults.json calls it the seven-day live run after a one-day soak, naming no city', async () => {
  const s = Date.parse(RUN_START);
  /* the schedule does not move with the extra day: day offsets 1-6 from the start day, the same eight windows as a 7-day run */
  eq(JSON.stringify(S.buildSchedule(s, 8)), JSON.stringify(S.buildSchedule(s, 7)), 'the 8-day schedule is the 7-day one');
  const dir = tmp();
  await runLive({ feedDir: dir, days: 8, startMs: s, seed: 20261103, speed: 'realtime', log: quiet, stopAtMs: s, signers: SIGNERS, codeCommit: 'f'.repeat(40) });
  const def = readDef(dir);
  eq(def.days, 8, 'days');
  eq(def.run_start, '2026-11-07T03:00:00.000Z', 'run_start');
  eq(def.run_end, '2026-11-15T03:00:00.000Z', 'run_end: the counted window closes then');
  eq(def.faults.length, 8, 'all eight injections');
  for (const f of def.faults) {
    assert(Date.parse(f.start) >= COUNTED.from && Date.parse(f.end) <= COUNTED.to, `${f.id} inside the counted window: ${f.start}`);
    assert(f.start.slice(0, 10) >= '2026-11-08' && f.end.slice(0, 10) <= '2026-11-13', `${f.id} on Sun 8 - Fri 13: ${f.start} → ${f.end}`);
  }
  assert(/seven-day live run after a one-day soak/.test(def.description), `the description reads as the seven-day live run after a one-day soak: ${def.description}`);
  assert(!/\b8-day\b|eight-day/i.test(def.description), `never an "8-day live run": ${def.description}`);
  assert(!/santiago/i.test(def.description), `the published run description names no city: ${def.description}`);
  /* a 7-day real-time run keeps its description */
  const seven = tmp();
  await runLive({ feedDir: seven, days: 7, startMs: s, seed: 20261103, speed: 'realtime', log: quiet, stopAtMs: s, signers: SIGNERS, codeCommit: 'f'.repeat(40) });
  assert(/^QWATT seven-day live run: /.test(readDef(seven).description), `a 7-day real-time run is still "QWATT seven-day live run": ${readDef(seven).description}`);
});

test('W3-4: a run length that is not a whole number of days is refused before anything is published (an unset QWATT_RUN_DAYS reaches the CLI as --days "")', async () => {
  const { spawnSync } = require('child_process');
  for (const d of ['', '0', '-1', '7.5', 'eight']) {
    const dir = tmp();
    const r = spawnSync(process.execPath, [path.join(__dirname, 'run.js'), '--feed', dir, '--days', d, '--start', RUN_START, '--speed', 'fast', '--code-commit', 'f'.repeat(40)], { encoding: 'utf8', timeout: 60e3 });
    eq(r.status, 2, `--days ${JSON.stringify(d)} exits 2 at start (${(r.stderr || '').trim()})`);
    assert(/--days/.test(r.stderr), `the message names --days: ${r.stderr}`);
    assert(!fs.existsSync(path.join(dir, 'faults.json')), `--days ${JSON.stringify(d)}: no faults.json`);
  }
  const none = tmp();
  await throwsLike(() => runLive({ feedDir: none, days: 0, startMs: START, seed: 3, speed: 'fast', log: quiet }), /days/, 'runLive with 0 days');
  assert(!fs.existsSync(path.join(none, 'faults.json')), 'runLive with 0 days publishes nothing');
});

test('W3-4: runLive itself still takes a fraction of a day, as live/soak.js passes --hours / 24 (its default --hours 3); only the CLI wants whole days', async () => {
  const dir = tmp();
  await runLive({ feedDir: dir, days: 3 / 24, startMs: START, seed: 20261017, speed: 'fast', log: quiet });
  eq(readDef(dir).run_end, new Date(START + 3 * 3600e3).toISOString(), 'a 3-hour run (days 3/24) ends three hours after its start');
});

test('V3-13a: the CLI exits 0 at run_end (its unit, Restart=on-failure, leaves it stopped) and 2 on a start it refuses (not restarted: RestartPreventExitStatus=2)', async () => {
  const { spawnSync } = require('child_process');
  const dir = tmp(), start = new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10) + 'T00:00:00Z';
  const keys = ['--proposer', SIGNERS.proposer, '--verifier', SIGNERS.verifier, '--third', SIGNERS.third];
  const cli = (k) => spawnSync(process.execPath, [path.join(__dirname, 'run.js'), '--feed', dir, '--days', '1', '--speed', 'fast', '--start', start, '--code-commit', 'f'.repeat(40), ...k], { encoding: 'utf8' });
  const end = cli(keys);
  eq(end.status, 0, `exit status at run_end (${end.stderr.trim()})`);
  assert(/run complete · 288 intervals/.test(end.stdout), `it ran to run_end: ${end.stdout.trim().split('\n').pop()}`);
  const batches = fs.readdirSync(path.join(dir, 'batches')).length;
  const again = cli(keys);   /* what Restart=always did 10 s after run_end, for as long as the host ran */
  eq(again.status, 0, 'exit status when started again after run_end');
  assert(/run complete · 0 intervals/.test(again.stdout), 'a start after run_end replays nothing');
  eq(fs.readdirSync(path.join(dir, 'batches')).length, batches, 'a start after run_end adds no batch');
  const refused = cli(keys.slice(0, 4));
  eq(refused.status, 2, `a start it refuses (two of the three signer keys) exits 2 (${refused.stderr.trim()})`);
});

(async () => {
  console.log('\nlive run');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
