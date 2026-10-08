/**
 * QWATT ops — watchdog decision tests (pure, offline)
 * Run: node ops/watch.test.js
 */

'use strict';

const { decide, POLICY } = require('./watch');

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

(async () => {
  console.log('\nops watch');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
