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

test('a repository that stops moving is its host\'s dead man\'s switch: 30 minutes without a push from the proposer or the verifier host', () => {
  const O = require('./outside-check');
  eq(O.POLICY.host_silent_s, 30 * 60, '30 minutes');
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
