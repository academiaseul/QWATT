/**
 * QWATT ops — the check from outside both hosts (freeze v3 V3-13b; plan W3-6).
 * Run: node ops/outside-check.test.js     (zero dependencies, no network: the decisions are pure)
 *
 * ops/outside-check.js runs on GitHub Actions every 15 minutes, on neither host, and reads public data
 * only: the last anchoring transaction on Horizon, the last commit of each evidence repository (each
 * host's publisher pushes several times an hour, so a repository that stops moving is that host's dead
 * man's switch) and the verifier's status.json. These tests hold its thresholds, its silence rule and
 * its workflow.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const NOW = Math.floor(Date.parse('2026-11-09T12:00:00Z') / 1000);
const ago = (s) => new Date((NOW - s) * 1000).toISOString();
const healthy = () => ({ run_live: true, last_anchor_at: ago(20 * 60), evidence_pushed_at: ago(4 * 60), log_pushed_at: ago(3 * 60), verifier_last_tick: ago(5 * 60), errors: [] });
const codes = (r) => r.map((p) => p.code).sort().join(',');

test('the module exists and imports nothing from the pipeline or the services', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ops/outside-check.js'), 'utf8');
  const reqs = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  for (const r of reqs) assert(!/(^|\/)(batch|anchor|live|ingest)\//.test(r) && !/\.\.\/(batch|anchor|live|ingest)/.test(r), `no pipeline or service import: ${r}`);
});

test('a healthy run raises nothing; outside the run only an unreadable source is a problem', () => {
  const O = require('./outside-check');
  eq(codes(O.decideOutside(healthy(), NOW)), '', 'healthy');
  const off = { ...healthy(), run_live: false, last_anchor_at: ago(10 * 3600), evidence_pushed_at: ago(10 * 3600) };
  eq(codes(O.decideOutside(off, NOW)), '', 'before or after the run, old anchors are not a problem');
  eq(codes(O.decideOutside({ ...off, errors: ['Horizon: HTTP 503'] }, NOW)), 'SOURCE_DOWN', 'but a source it cannot read is, always');
});

test('no anchor for 90 minutes during the run → NO_ANCHOR (89 minutes: nothing)', () => {
  const O = require('./outside-check');
  eq(O.POLICY.no_anchor_s, 90 * 60, '90 minutes');
  eq(codes(O.decideOutside({ ...healthy(), last_anchor_at: ago(89 * 60) }, NOW)), '', '89 minutes');
  eq(codes(O.decideOutside({ ...healthy(), last_anchor_at: ago(91 * 60) }, NOW)), 'NO_ANCHOR', '91 minutes');
  eq(codes(O.decideOutside({ ...healthy(), last_anchor_at: null }, NOW)), 'NO_ANCHOR', 'no anchor at all during the run');
});

test('DV-11: at the start of a run armed ahead of it, the anchor and the proposer host count from the run start: quiet for 90 and 75 minutes, then they alert', () => {
  const O = require('./outside-check');
  const armed = (s) => ({ ...healthy(), last_anchor_at: null, evidence_pushed_at: ago(36 * 3600), run_start: ago(s) });
  eq(codes(O.decideOutside(armed(60), NOW)), '', 'a minute in');
  eq(codes(O.decideOutside(armed(61 * 60), NOW)), '', 'an hour in: the publisher has nothing to push before the first batch');
  eq(codes(O.decideOutside(armed(76 * 60), NOW)), 'PROPOSER_HOST_SILENT', '76 minutes in, nothing pushed since it was armed');
  eq(codes(O.decideOutside({ ...armed(91 * 60), evidence_pushed_at: ago(60) }, NOW)), 'NO_ANCHOR', '91 minutes in, no anchor');
  eq(O.POLICY.first_push_s, 75 * 60, 'the wait for the first push');
  eq(codes(O.decideOutside({ ...armed(100 * 60), last_anchor_at: ago(20 * 60), evidence_pushed_at: ago(31 * 60) }, NOW)), 'PROPOSER_HOST_SILENT', 'after the first push the 30-minute limit is back: the repository moves every few minutes');
});

test('DV-11: observeOutside() reads run_start from the served faults.json, and a faults.json that is not there is a problem, never a quiet pass', async () => {
  const O = require('./outside-check');
  const os = require('os');
  const { serveDir } = require('../anchor/static-server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-outside-'));
  fs.mkdirSync(path.join(dir, 'run'));
  const start = '2026-11-09T03:00:00.000Z';
  fs.writeFileSync(path.join(dir, 'run', 'faults.json'), JSON.stringify({ run_start: start, run_end: '2026-11-16T03:00:00.000Z' }) + '\n');
  const srv = await serveDir(dir);
  let found, missing;
  try {
    found = await O.observeOutside({ account: 'GOUTSIDETEST', horizon: 'http://127.0.0.1:9', feed: srv.url + '/run' }, NOW);
    missing = await O.observeOutside({ account: 'GOUTSIDETEST', horizon: 'http://127.0.0.1:9', feed: srv.url + '/wrong-name' }, NOW);
  } finally { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  eq(found.run_start, start, 'run_start from faults.json');
  eq(found.run_live, true, 'live on 9 Nov at 12:00');
  assert(!found.errors.some((e) => /^faults\.json/.test(e)), `read: ${found.errors.join('; ')}`);
  assert(missing.errors.some((e) => /^faults\.json/.test(e)), `a wrong feed address is reported: ${missing.errors.join('; ')}`);
});

test('DV-11: before the start a verifier that stopped alerts, so a PC that went off on Sunday is known before the run needs it; after the run it does not', () => {
  const O = require('./outside-check');
  const armed = { run_live: false, run_start: new Date((NOW + 6 * 3600) * 1000).toISOString(), verifier_last_tick: ago(16 * 60), evidence_pushed_at: ago(36 * 3600), log_pushed_at: ago(16 * 60), errors: [] };
  eq(codes(O.decideOutside(armed, NOW)), 'VERIFIER_SILENT', 'silent for 16 minutes, 6 hours before the start');
  eq(codes(O.decideOutside({ ...armed, verifier_last_tick: ago(5 * 60) }, NOW)), '', 'ticking: nothing');
  eq(codes(O.decideOutside({ ...armed, run_start: ago(8 * 86400) }, NOW)), '', 'after the run: nothing');
});

test('a repository that stops moving is its host\'s dead man\'s switch: 30 minutes without a push from the proposer or the verifier host', () => {
  const O = require('./outside-check');
  eq(O.POLICY.host_silent_s, 30 * 60, '30 minutes');
  eq(codes(O.decideOutside({ ...healthy(), evidence_pushed_at: ago(29 * 60) }, NOW)), '', '29 minutes');
  eq(codes(O.decideOutside({ ...healthy(), evidence_pushed_at: ago(31 * 60) }, NOW)), 'PROPOSER_HOST_SILENT', 'the evidence repository: the proposer host');
  eq(codes(O.decideOutside({ ...healthy(), log_pushed_at: ago(31 * 60) }, NOW)), 'VERIFIER_HOST_SILENT', 'the verifier log: the verifier host');
  eq(codes(O.decideOutside({ ...healthy(), verifier_last_tick: ago(16 * 60) }, NOW)), 'VERIFIER_SILENT', 'a log that moves but a verifier that does not tick');
});

test('silence is never health: a value it could not read is a problem, not a pass', () => {
  const O = require('./outside-check');
  const r = O.decideOutside({ ...healthy(), evidence_pushed_at: undefined, errors: ['GitHub: HTTP 403'] }, NOW);
  assert(codes(r).includes('SOURCE_DOWN'), `an unread repository is SOURCE_DOWN: ${codes(r)}`);
});

test('without an account configured the check says so and exits 0, so a fork or an unconfigured repository is not a failing run', () => {
  const env = { ...process.env };
  for (const k of ['QWATT_ANCHOR_ACCOUNT', 'QWATT_FEED_URL', 'QWATT_VERIFIER_LOG_URL', 'QWATT_ALERT_WEBHOOK']) delete env[k];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'ops/outside-check.js')], { env, encoding: 'utf8', timeout: 20000 });
  eq(r.status, 0, `exit 0 (${r.stderr})`);
  assert(/not configured/.test(r.stdout + r.stderr), `it says it is not configured: ${r.stdout}${r.stderr}`);
});

test('the workflow runs every 15 minutes on GitHub, reads its settings from repository variables and the webhook from a secret, with read-only permissions', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/outside-check.yml'), 'utf8');
  assert(/cron:\s*['"]\*\/15 \* \* \* \*['"]/.test(wf), 'every 15 minutes');
  assert(/workflow_dispatch/.test(wf), 'and by hand');
  assert(/permissions:\s*\n\s*contents:\s*read/.test(wf), 'read-only permissions');
  assert(/vars\.QWATT_ANCHOR_ACCOUNT/.test(wf) && /vars\.QWATT_FEED_URL/.test(wf) && /vars\.QWATT_VERIFIER_LOG_URL/.test(wf), 'public settings as repository variables');
  assert(/secrets\.QWATT_ALERT_WEBHOOK/.test(wf), 'the webhook as a secret');
  assert(/node-version:\s*24\.14\.1/.test(wf), 'the pinned Node');
  assert(/node ops\/outside-check\.js/.test(wf), 'runs the check');
});

(async () => {
  console.log('\nops outside check (V3-13b)');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
