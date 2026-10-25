/**
 * QWATT ops — watchdog tests (offline: the decisions are pure; observe() reads a log served on localhost)
 * Run: node ops/watch.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { decide, observe, POLICY } = require('./watch');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const NOW = Math.floor(Date.parse('2026-11-05T12:00:00Z') / 1000);
const iso = (secondsAgo, at = NOW) => new Date((at - secondsAgo) * 1000).toISOString();
/** Healthy observations as seen at time `at` (fresh relative to that moment). */
const healthy = (at = NOW) => ({ errors: [], run_live: true, last_anchor_at: iso(1800, at), feed_last_interval_at: iso(300, at), verifier_last_tick: iso(30, at), verifier_refusals: 0, reconcile_verdict: 'PENDING' });
const codes = (r) => r.alerts.map((a) => `${a.code}:${a.kind}`);

test('a healthy run raises nothing', () => {
  eq(decide(healthy(), {}, NOW).alerts.length, 0, 'no alerts');
});

test('no anchor for over 2 h during the run → NO_ANCHOR; outside the run → nothing', () => {
  const o = { ...healthy(), last_anchor_at: iso(POLICY.no_anchor_s + 60) };
  assert(codes(decide(o, {}, NOW)).includes('NO_ANCHOR:alert'), 'alert while live');
  eq(decide({ ...o, run_live: false }, {}, NOW).alerts.length, 0, 'quiet outside the run window');
});

test('a stalled pipeline, a silent verifier, a waiting batch and a BROKEN verdict each alert', () => {
  const o = { ...healthy(), feed_last_interval_at: iso(3600), verifier_last_tick: iso(1200), oldest_unanchored_batch: 'b-000010', oldest_unanchored_published_at: iso(3 * 3600), reconcile_verdict: 'BROKEN', reconcile_problems: ['x'] };
  const c = codes(decide(o, {}, NOW));
  for (const k of ['FEED_STALE:alert', 'VERIFIER_SILENT:alert', 'BACKLOG:alert', 'BROKEN:alert']) assert(c.includes(k), `${k} in ${c}`);
});

test('a condition alerts once, repeats after 6 h, and sends resolved when it clears', () => {
  const bad = (at) => ({ ...healthy(at), last_anchor_at: iso(3 * 3600) });   // last anchor stays fixed in the past
  const r1 = decide(bad(NOW), {}, NOW);
  const r2 = decide(bad(NOW + 600), r1.state, NOW + 600);
  eq(r2.alerts.length, 0, 'no repeat within 6 h');
  const t3 = NOW + POLICY.repeat_s + 1;
  const r3 = decide(bad(t3), r2.state, t3);
  assert(codes(r3).includes('NO_ANCHOR:repeat'), 'repeat after 6 h');
  const t4 = t3 + 60;
  const r4 = decide(healthy(t4), r3.state, t4);
  assert(codes(r4).includes('NO_ANCHOR:resolved'), 'resolved');
  eq(Object.keys(r4.state.active).length, 0, 'nothing active after recovery');
});

test('each new verifier refusal alerts once; the count is remembered', () => {
  const r1 = decide({ ...healthy(), verifier_refusals: 2 }, {}, NOW);
  assert(codes(r1).includes('NEW_REFUSAL:alert'), 'alert on new refusals');
  eq(decide({ ...healthy(NOW + 60), verifier_refusals: 2 }, r1.state, NOW + 60).alerts.length, 0, 'not again for the same refusals');
});

test('an unreadable source is itself an alert — silence is never treated as health', () => {
  const r = decide({ errors: ['Horizon (timeout)'], run_live: true }, {}, NOW);
  assert(codes(r).includes('SOURCE_DOWN:alert'), 'source down');
});

test('the watchdog reads the heartbeat and the refusals from the public verifier log, so a verifier restart cannot hide a new refusal', async () => {
  const { serveDir } = require('../anchor/static-server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-watch-log-'));
  fs.mkdirSync(path.join(dir, 'run'));
  const T = iso(45);
  /* the verifier restarted: its status says refused 0, while its persistent refusals.jsonl holds two lines */
  fs.writeFileSync(path.join(dir, 'run', 'status.json'), JSON.stringify({ started_at: iso(50), last_tick: T, last_result: { action: 'idle' }, feed: 'https://example.invalid/run', signed: 0, refused: 0 }) + '\n');
  fs.writeFileSync(path.join(dir, 'run', 'refusals.jsonl'), '{"batch_id":"w-000003","reasons":["verifier.hash_mismatch"]}\n{"batch_id":"w-000004","reasons":["verifier.hash_mismatch"]}\n');
  const srv = await serveDir(dir);
  let obs, down;
  try {
    obs = await observe({ verifierLog: srv.url + '/run', feed: srv.url + '/run', horizon: 'http://127.0.0.1:9', account: 'GWATCHTEST' }, NOW);
    down = await observe({ verifierLog: srv.url + '/missing', feed: srv.url + '/run', horizon: 'http://127.0.0.1:9', account: 'GWATCHTEST' }, NOW);
  } finally { await srv.close(); }
  eq(obs.verifier_refusals, 2, 'refusals counted from the persistent refusals.jsonl');
  eq(obs.verifier_last_tick, T, 'heartbeat from status.json');
  assert(!obs.errors.some((e) => /verifier/.test(e)), `the log was read: ${obs.errors.join('; ')}`);
  assert(down.errors.some((e) => /^verifier log \(/.test(e)), `an unreadable log is an error named after it: ${down.errors.join('; ')}`);
  const r = decide({ ...healthy(), verifier_refusals: obs.verifier_refusals }, { refusals_seen: 0 }, NOW);
  const refusal = r.alerts.find((a) => a.code === 'NEW_REFUSAL');
  assert(refusal && /verifier log/.test(refusal.message), `NEW_REFUSAL points to the public verifier log: ${refusal && refusal.message}`);
  const silent = decide({ ...healthy(), verifier_last_tick: iso(1200) }, {}, NOW).alerts.find((a) => a.code === 'VERIFIER_SILENT');
  assert(silent && /verifier log says/.test(silent.message), `VERIFIER_SILENT names its source: ${silent && silent.message}`);
});

test('early in a run the verifier log has status.json but no refusals.jsonl yet: no refusals and no error', async () => {
  const { serveDir } = require('../anchor/static-server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-watch-log-'));
  fs.mkdirSync(path.join(dir, 'run'));
  fs.writeFileSync(path.join(dir, 'run', 'status.json'), JSON.stringify({ started_at: iso(50), last_tick: iso(20), last_result: { action: 'idle' }, feed: 'https://example.invalid/run', signed: 0, refused: 0 }) + '\n');
  const srv = await serveDir(dir);
  let obs;
  try { obs = await observe({ verifierLog: srv.url + '/run', feed: srv.url + '/run', horizon: 'http://127.0.0.1:9', account: 'GWATCHTEST' }, NOW); }
  finally { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  eq(obs.verifier_refusals, 0, 'a refusals.jsonl not published yet counts as none');
  eq(obs.verifier_last_tick, iso(20), 'heartbeat read');
  assert(!obs.errors.some((e) => /verifier/.test(e)), `no verifier error: ${obs.errors.join('; ')}`);
});

test('VERIFIER_SILENT allows for the raw CDN: a status 690 s old (status commits up to 360 s apart, a 30 s tick, 300 s of CDN cache) is not silent; 901 s is', () => {
  const silent = (age) => decide({ ...healthy(), verifier_last_tick: iso(age) }, {}, NOW).alerts.some((a) => a.code === 'VERIFIER_SILENT');
  eq(silent(690), false, '690 s: the worst lag of a healthy verifier log read through raw.githubusercontent.com');
  eq(silent(901), true, '901 s: silent');
});

test('the retired --verifier-status flag is a usage error (exit 2) in the watchdog and the preflight, so an old unit file cannot run without watching the verifier', () => {
  const { spawnSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-watch-cli-'));
  const cfg = path.join(dir, 'anchor.json');                            // public values only, every address on localhost
  fs.writeFileSync(cfg, JSON.stringify({ horizon_url: 'http://127.0.0.1:9', anchor_account: 'G' + 'A'.repeat(55), payment_destination: 'G' + 'B'.repeat(55) }));
  const env = { ...process.env };
  delete env.QWATT_ALERT_WEBHOOK;                                       // offline: no alert is delivered anywhere
  const run = (script, args) => spawnSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: 'utf8', env, timeout: 120e3 });
  const old = 'http://127.0.0.1:9/status.json';
  try {
    const w = run('watch.js', ['--account', 'GWATCHTEST', '--feed', 'http://127.0.0.1:9/run', '--horizon', 'http://127.0.0.1:9', '--verifier-status', old, '--state', path.join(dir, 'state'), '--once']);
    eq(w.status, 2, 'watch.js --verifier-status');
    assert(/--verifier-status was replaced by --verifier-log/.test(w.stderr), `the watchdog names the replacement: ${w.stderr}`);
    const p = run('preflight.js', ['--config', cfg, '--feed', 'http://127.0.0.1:9/run', '--verifier-status', old]);
    eq(p.status, 2, 'preflight.js --verifier-status');
    assert(/--verifier-status was replaced by --verifier-log/.test(p.stderr), `the preflight names the replacement: ${p.stderr}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

(async () => {
  console.log('\nops watch');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
