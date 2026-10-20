/**
 * QWATT — reconciliation tests (Deliverable 4), offline
 * Run: node batch/reconcile.test.js
 *
 * The anchors here are what Horizon would return for an honest proposer +
 * verifier; each test then breaks one thing and expects the matching verdict.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../protocol/evidence');
const V = require('./verify');
const R = require('../assets/qwatt-reconcile.js');
const { Pipeline } = require('./pipeline');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const DT = 300, T0 = Date.parse('2026-09-20T15:00:00Z');
function iv(i, bW = 99) {
  const t = T0 + i * DT * 1000;
  const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
  return {
    spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION,
    site_id: 'rc', node_id: 'rc', seq: i,
    ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
    meters: { a: m('a', 100), b: m('b', bW) },
    source: { adapter: 'simulator', raw_sha256: E.sha256('rc-' + i) },
  };
}

/** A feed of `n` batches (one shaded-sensor fault in batch 1) read back the way fetchFeed returns it. */
function makeFeed(n = 4) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-rc-'));
  const p = new Pipeline({ dir, site_id: 'rc', node_id: 'rc' });
  for (let i = 0; i < 12 * n; i++) p.push(i === 17 ? iv(i, 50) : iv(i));
  const listed = p.feed.readLedger('batches');
  const batches = Object.fromEntries(listed.map((e) => [e.batch_id, p.feed.readBatch(e.batch_id)]));
  return { dir, feed: { index: p.feed.readIndex(), listed, batches, rejected: p.feed.readLedger('rejected') } };
}

/** Honest anchors for the first k accepted batches. */
function anchorsFor(feed, k) {
  return feed.listed.filter((e) => e.status === 'accepted').slice(0, k).map((e, i) => ({
    tx_hash: E.sha256('tx' + e.seq), ledger: 1000 + i, created_at: new Date(T0 + i * 3600e3).toISOString(),
    memo: `QW#${e.seq}`, sha256: e.sha256, cumulative_mwh: feed.batches[e.batch_id].cumulative_mwh,
  }));
}

test('browser canonical JSON and SHA-256 are byte-identical to protocol/evidence.js', async () => {
  const { feed } = makeFeed(1);
  const b = feed.batches[feed.listed[0].batch_id];
  eq(R.canonical(b), E.canonical(b), 'canonical');
  eq(await R.batchSha256(b), E.batchSha256(b), 'batch hash');
  for (const bad of [1.5, Infinity, NaN]) { let threw = false; try { R.canonical({ x: bad }); } catch (e) { threw = true; } assert(threw, `refuses ${bad}`); }
});

test('everything anchored and matching → RECONCILED, with the rejection breakdown', async () => {
  const { feed } = makeFeed(4);
  const rep = await R.reconcile(feed, anchorsFor(feed, 4));
  eq(rep.verdict, 'RECONCILED', rep.problems.join('; '));
  eq(rep.summary.anchored_batches, 4, 'anchored');
  eq(rep.summary.anchored_cumulative_mwh, rep.summary.published_cumulative_mwh, 'cumulative agrees');
  eq(rep.summary.rejected_by_reason['agreement.diverge'], 1, 'the shaded-sensor fault is counted');
});

test('only the newest batches awaiting anchor → PENDING, not broken', async () => {
  const { feed } = makeFeed(4);
  const rep = await R.reconcile(feed, anchorsFor(feed, 2));
  eq(rep.verdict, 'PENDING', rep.problems.join('; '));
  eq(rep.summary.awaiting_anchor.length, 2, 'two awaiting');
});

test('a batch file edited after anchoring → BROKEN', async () => {
  const { feed } = makeFeed(3);
  const anchors = anchorsFor(feed, 3);
  const id = feed.listed[1].batch_id;
  feed.batches[id] = Object.assign({}, feed.batches[id], { energy_mwh: feed.batches[id].energy_mwh + 1 });
  const rep = await R.reconcile(feed, anchors);
  eq(rep.verdict, 'BROKEN', 'verdict');
  assert(rep.problems.some((p) => p.includes(id) && /re-hash/.test(p)), rep.problems.join('; '));
});

test('a forged batch re-hashed and re-listed is still caught: its hash is not what was anchored', async () => {
  const { feed } = makeFeed(3);
  const anchors = anchorsFor(feed, 3);
  const last = feed.listed[2];
  const forged = JSON.parse(JSON.stringify(feed.batches[last.batch_id]));
  forged.intervals[0].meters.a.mwh += 500; forged.intervals[0].meters.b.mwh += 500;
  forged.energy_mwh = forged.intervals.reduce((s, r) => s + E.basisMwh(r), 0);
  forged.cumulative_mwh = feed.batches[feed.listed[1].batch_id].cumulative_mwh + forged.energy_mwh;
  forged.intervals_root = E.merkleRoot(forged.intervals);
  forged.sha256 = E.batchSha256(forged);
  feed.batches[last.batch_id] = forged;
  feed.listed[2] = Object.assign({}, last, { sha256: forged.sha256 });
  const rep = await R.reconcile(feed, anchors);
  eq(rep.verdict, 'BROKEN', 'verdict');
  assert(rep.problems.some((p) => /not a published batch/.test(p)), rep.problems.join('; '));
});

test('an anchored batch after an unanchored one → BROKEN (gap)', async () => {
  const { feed } = makeFeed(3);
  const a = anchorsFor(feed, 3);
  const rep = await R.reconcile(feed, [a[0], a[2]]);
  eq(rep.verdict, 'BROKEN', 'verdict');
  assert(rep.problems.some((p) => /gap/.test(p)), rep.problems.join('; '));
});

test('wrong cumulative, wrong memo, or the same hash anchored twice → BROKEN', async () => {
  const { feed } = makeFeed(2);
  const base = anchorsFor(feed, 2);
  const cases = [
    [[base[0], Object.assign({}, base[1], { cumulative_mwh: 1 })], /cumulative/],
    [[base[0], Object.assign({}, base[1], { memo: 'QW#9' })], /memo/],
    [[base[0], base[1], Object.assign({}, base[1], { tx_hash: E.sha256('dup') })], /twice/],
  ];
  for (const [anchors, re] of cases) {
    const rep = await R.reconcile(feed, anchors);
    eq(rep.verdict, 'BROKEN', String(re));
    assert(rep.problems.some((p) => re.test(p)), `${re}: ${rep.problems.join('; ')}`);
  }
});

test('a broken chain link in the feed → BROKEN', async () => {
  const { feed } = makeFeed(3);
  const id = feed.listed[2].batch_id;
  const b = Object.assign({}, feed.batches[id], { prev_hash: 'e'.repeat(64) });
  b.sha256 = E.batchSha256(b);
  feed.batches[id] = b; feed.listed[2] = Object.assign({}, feed.listed[2], { sha256: b.sha256 });
  const rep = await R.reconcile(feed, anchorsFor(feed, 2));
  eq(rep.verdict, 'BROKEN', 'verdict');
  assert(rep.problems.some((p) => /chain/.test(p)), rep.problems.join('; '));
});

test('fetchFeed reads a served feed exactly as published', async () => {
  const { dir, feed } = makeFeed(2);
  const http = require('http');
  const srv = http.createServer((req, res) => {
    const f = path.join(dir, decodeURIComponent(req.url));
    if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const got = await R.fetchFeed(`http://127.0.0.1:${srv.address().port}`);
  srv.closeAllConnections();
  await new Promise((r) => srv.close(r));
  eq(got.listed.length, feed.listed.length, 'listed');
  eq(got.rejected.length, feed.rejected.length, 'rejected');
  eq((await R.reconcile(got, anchorsFor(got, 2))).verdict, 'RECONCILED', 'reconciles');
});

(async () => {
  console.log('\nreconcile');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;   // not process.exit(): fetch keep-alive sockets must close first (libuv assert on Windows)
})();
