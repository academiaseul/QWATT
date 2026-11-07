/**
 * QWATT ops — watchdog tests (offline: the decisions are pure; observe() reads a log served on localhost)
 * Run: node ops/watch.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { decide, observe, POLICY } = require('./watch');
const W = require('./watch');

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

test('V3-7c: observe() reads the feed and the verifier log each at one commit: a CDN copy of status.json older than the log raises nothing, and a head that cannot be read is SOURCE_DOWN', async () => {
  const { execFileSync } = require('child_process');
  const { fakeGithub } = require('../anchor/fake-github');
  const PF = require('./publish-feed');
  const { Pipeline } = require('../batch/pipeline');
  const E = require('../protocol/evidence');
  const V = require('../batch/verify');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-watch-gh-'));
  const ev = path.join(root, 'qwatt-evidence.git'), lg = path.join(root, 'qwatt-verifier-log.git');
  for (const b of [ev, lg]) execFileSync('git', ['init', '--quiet', '--bare', b], { stdio: 'ignore' });
  /* a feed from the real pipeline, and a verifier state directory, each published by the real publisher */
  const feedDir = path.join(root, 'feed');
  const pipe = new Pipeline({ dir: feedDir, site_id: 'wt', node_id: 'wt' });
  const T0 = Date.parse('2026-11-05T10:00:00Z'), DT = 300;
  for (let i = 0; i < 12; i++) {
    const t = T0 + i * DT * 1000;
    const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
    const rec = { spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION, site_id: 'wt', node_id: 'wt', seq: i, ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
      meters: { a: m('a', 100), b: m('b', 99) }, source: { adapter: 'simulator', raw_sha256: E.sha256('wt-' + i) } };
    pipe.push(Object.defineProperty(rec, Symbol.for('qwatt.raw_payloads'), { value: [{ n: 1, utf8: 'wt-' + i }], enumerable: false }));
  }
  PF.publishOnce({ kind: 'evidence', feed: feedDir, run: 'run', remote: ev, branch: 'main', work: path.join(root, 'ev-work') });
  const state = path.join(root, 'state');
  fs.mkdirSync(state);
  const status = (lastTick, refused) => fs.writeFileSync(path.join(state, 'status.json'), JSON.stringify({ started_at: iso(7200), last_tick: lastTick, last_result: { action: 'idle' }, feed: 'https://raw.githubusercontent.com/acme/qwatt-evidence/main/run', signed: 0, refused }, null, 2) + '\n');
  const publishLog = () => PF.publishOnce({ kind: 'verifier-log', feed: state, run: 'run', remote: lg, branch: 'main', work: path.join(root, 'lg-work') });
  status(iso(3600), 0);
  fs.writeFileSync(path.join(state, 'decisions.jsonl'), '');
  fs.writeFileSync(path.join(state, 'refusals.jsonl'), '');
  publishLog();
  const gh = await fakeGithub({ repos: { 'acme/qwatt-evidence': ev, 'acme/qwatt-verifier-log': lg } });
  const o = { feed: `${gh.rawOrigin}/acme/qwatt-evidence/main/run`, verifierLog: `${gh.rawOrigin}/acme/qwatt-verifier-log/main/run`, horizon: 'http://127.0.0.1:9', account: 'GWATCHTEST', pin: { rawOrigin: gh.rawOrigin, gitOrigin: gh.gitOrigin } };
  try {
    await (await fetch(`${o.verifierLog}/status.json`)).text();          // a reader of the branch path: the CDN keeps the hour-old status
    status(iso(30), 1);
    fs.writeFileSync(path.join(state, 'decisions.jsonl'), '{"batch_id":"wt-000000","decision":"refused","reasons":["verifier.hash_mismatch"]}\n');
    fs.writeFileSync(path.join(state, 'refusals.jsonl'), '{"batch_id":"wt-000000","reasons":["verifier.hash_mismatch"]}\n');
    publishLog();
    const logHead = execFileSync('git', ['--git-dir', lg, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
    const evHead = execFileSync('git', ['--git-dir', ev, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
    const obs = await observe(o, NOW);
    eq(obs.verifier_last_tick, iso(30), 'the heartbeat at the head commit of the log, not the CDN copy');
    eq(obs.verifier_refusals, 1, 'the refusal at the same commit');
    eq(obs.verifier_log_read_at, `${gh.rawOrigin}/acme/qwatt-verifier-log/${logHead}/run`, 'the log was read at its head commit');
    eq(obs.feed_read_at, `${gh.rawOrigin}/acme/qwatt-evidence/${evHead}/run`, 'the feed was read at its head commit');
    assert(!obs.errors.some((e) => /^(feed|verifier log) \(/.test(e)), `both read: ${obs.errors.join('; ')}`);
    assert(!decide(obs, {}, NOW).alerts.some((a) => a.code === 'VERIFIER_SILENT'), 'no VERIFIER_SILENT from a stale CDN copy');
    gh.failRefs(429);
    const down = await observe(o, NOW);
    assert(down.errors.some((e) => /^feed \(.*HTTP 429/.test(e)) && down.errors.some((e) => /^verifier log \(.*HTTP 429/.test(e)), `an unreadable head is an unreadable source: ${down.errors.join('; ')}`);
    assert(decide(down, {}, NOW).alerts.some((a) => a.code === 'SOURCE_DOWN'), 'SOURCE_DOWN');
  } finally { await gh.close(); try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
});

test('VERIFIER_SILENT keeps its 15-minute margin: a status 690 s old is not silent; 901 s is', () => {
  const silent = (age) => decide({ ...healthy(), verifier_last_tick: iso(age) }, {}, NOW).alerts.some((a) => a.code === 'VERIFIER_SILENT');
  eq(silent(690), false, '690 s: inside the margin (a healthy log read at its head commit is at most about 390 s old)');
  eq(silent(901), true, '901 s: silent');
});

test('V3-7c: a BROKEN alert names where the evidence was read (the reconciliation\'s read_at, kept by observe())', async () => {
  const { serveDir } = require('../anchor/static-server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-watch-rec-'));
  fs.mkdirSync(path.join(dir, 'run'));
  const srv = await serveDir(dir);
  let obs;
  try {
    obs = await observe({ feed: srv.url + '/run', horizon: 'http://127.0.0.1:9', account: 'GWATCHTEST', reconcile: async () => ({ verdict: 'BROKEN', problems: ['anchor QW#3 carries a hash that is not a published batch'], read_at: 'acme/qwatt-evidence@abc1234' }) }, NOW);
  } finally { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  eq(obs.reconcile_verdict, 'BROKEN', 'the verdict observed');
  eq(obs.reconcile_read_at, 'acme/qwatt-evidence@abc1234', 'observe() keeps where the reconciliation read the evidence');
  const broken = decide({ ...healthy(), reconcile_verdict: obs.reconcile_verdict, reconcile_problems: obs.reconcile_problems, reconcile_read_at: obs.reconcile_read_at }, {}, NOW).alerts.find((a) => a.code === 'BROKEN');
  assert(broken && broken.message.includes('reconciliation BROKEN (evidence read at acme/qwatt-evidence@abc1234): anchor QW#3'), `the alert names the commit judged: ${broken && broken.message}`);
  const plain = decide({ ...healthy(), reconcile_verdict: 'BROKEN', reconcile_problems: ['x'] }, {}, NOW).alerts.find((a) => a.code === 'BROKEN');
  assert(plain && plain.message.includes('reconciliation BROKEN: x'), `without a read_at the message is unchanged: ${plain && plain.message}`);
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

/* ── V3-13b: 90 minutes without an anchor; an alert counts as sent only on HTTP 2xx ── */

/** A webhook on 127.0.0.1 that answers each POST with the next status of `statuses` (then 200), recording bodies. */
async function webhook(statuses) {
  const http = require('http');
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push(b); res.writeHead(statuses.length ? statuses.shift() : 200); res.end(); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/topic`, got, close: () => new Promise((r) => srv.close(r)) };
}

test('V3-13b: NO_ANCHOR fires after 90 minutes without an anchor during the run, not 2 h', () => {
  eq(POLICY.no_anchor_s, 90 * 60, 'the threshold is 90 minutes');
  assert(!codes(decide({ ...healthy(), last_anchor_at: iso(85 * 60) }, {}, NOW)).includes('NO_ANCHOR:alert'), '85 minutes: quiet');
  assert(codes(decide({ ...healthy(), last_anchor_at: iso(91 * 60) }, {}, NOW)).includes('NO_ANCHOR:alert'), '91 minutes: NO_ANCHOR');
});

test('DV-11: a run armed ahead of its start has only faults.json public: no feed error before the start or in its first 90 minutes; a feed still empty after that is one', async () => {
  const { serveDir } = require('../anchor/static-server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-watch-armed-'));
  fs.mkdirSync(path.join(dir, 'run'));
  const START = NOW + 36 * 3600;
  const at = (s) => new Date(s * 1000).toISOString();
  fs.writeFileSync(path.join(dir, 'run', 'faults.json'), JSON.stringify({ run_start: at(START), run_end: at(START + 7 * 86400) }) + '\n');
  const srv = await serveDir(dir);
  let before, first, after;
  const o = { feed: srv.url + '/run', horizon: 'http://127.0.0.1:9', account: 'GWATCHTEST' };
  try {
    before = await observe(o, NOW);
    first = await observe(o, START + 60 * 60);
    after = await observe(o, START + POLICY.no_anchor_s + 60);
  } finally { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  const feedErrors = (x) => x.errors.filter((e) => /^feed/.test(e));
  eq(feedErrors(before).length, 0, `armed: ${before.errors.join('; ')}`);
  eq(before.run_live, false, 'not live before the start');
  eq(before.run_start, at(START), 'observe() keeps the run start');
  eq(feedErrors(first).length, 0, `an hour in, before the first batch: ${first.errors.join('; ')}`);
  eq(first.run_live, true, 'live from the start');
  eq(feedErrors(after).length, 1, 'still no index.json after 90 minutes: the source is down');
});

test('DV-11: NO_ANCHOR counts from the run start, so an account last used days before the start does not alert at the start; 90 minutes in, it does', () => {
  const started = (s) => ({ ...healthy(), feed_last_interval_at: undefined, last_anchor_at: iso(3 * 86400), run_start: iso(s) });
  assert(!codes(decide(started(60), {}, NOW)).includes('NO_ANCHOR:alert'), 'a minute into the run: quiet');
  assert(!codes(decide({ ...started(60), last_anchor_at: null }, {}, NOW)).includes('NO_ANCHOR:alert'), 'an account with no transaction, a minute in: quiet');
  assert(codes(decide(started(91 * 60), {}, NOW)).includes('NO_ANCHOR:alert'), '91 minutes in: NO_ANCHOR');
});

test('V3-13b: deliver() reports each alert as sent only when the webhook answers 2xx', async () => {
  const hook = await webhook([500, 200, 404]);
  try {
    const alerts = [{ code: 'A', kind: 'alert', message: 'a' }, { code: 'B', kind: 'alert', message: 'b' }, { code: 'C', kind: 'alert', message: 'c' }];
    const sent = await W.deliver(alerts, hook.url, () => {});
    eq(JSON.stringify(sent), JSON.stringify([false, true, false]), '500 and 404 are not sent; 200 is');
    eq(hook.got.length, 3, 'all three were posted');
    eq(JSON.stringify(await W.deliver(alerts, 'http://127.0.0.1:1/nowhere', () => {})), JSON.stringify([false, false, false]), 'a webhook that cannot be reached sends nothing');
    eq(JSON.stringify(await W.deliver(alerts, null, () => {})), JSON.stringify([true, true, true]), 'with no webhook the console is the channel (local runs)');
  } finally { await hook.close(); }
});

test('V3-13b: an alert the webhook did not take is sent again on the next tick, and a resolved one too', () => {
  const bad = { ...healthy(), last_anchor_at: iso(3 * 3600) };
  const r1 = decide(bad, {}, NOW);
  const kept = W.keepUnsent({}, r1.state, r1.alerts, r1.alerts.map(() => false));
  eq(JSON.stringify(kept.active), '{}', 'NO_ANCHOR is not recorded as alerted while its delivery failed');
  const r2 = decide({ ...bad }, kept, NOW + 30);
  assert(codes(r2).includes('NO_ANCHOR:alert'), 'so the next tick alerts again');
  const ok = W.keepUnsent(kept, r2.state, r2.alerts, r2.alerts.map(() => true));
  const r3 = decide(healthy(NOW + 60), ok, NOW + 60);
  assert(codes(r3).includes('NO_ANCHOR:resolved'), 'resolved');
  const stillActive = W.keepUnsent(ok, r3.state, r3.alerts, r3.alerts.map(() => false));
  assert(stillActive.active.NO_ANCHOR, 'a resolved alert that was not delivered keeps the condition active');
  assert(codes(decide(healthy(NOW + 90), stillActive, NOW + 90)).includes('NO_ANCHOR:resolved'), 'so resolved is sent again');
  const ref = decide({ ...healthy(), verifier_refusals: 3 }, {}, NOW);
  eq(W.keepUnsent({}, ref.state, ref.alerts, [false]).refusals_seen || 0, 0, 'a NEW_REFUSAL not delivered is not counted as seen');
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
