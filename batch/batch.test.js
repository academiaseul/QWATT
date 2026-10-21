/**
 * QWATT batch — tests (Deliverable 2)
 * Run: node batch/batch.test.js            (no framework, no install — same as the other suites)
 *      node batch/batch.test.js --write    regenerate protocol/conformance/batch-cases.json
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../protocol/evidence');
const V = require('./verify');
const { BatchAssembler } = require('./assemble');
const { Pipeline } = require('./pipeline');
const { verifyFeed } = require('./verify-cli');
const { Feed } = require('./feed');
const REASONS = require('../protocol/reasons.json');

const FIXTURE = path.join(__dirname, '..', 'protocol', 'conformance', 'batch-cases.json');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function throws(fn, re, w) {
  try { fn(); } catch (e) { assert(!re || re.test(e.message), `${w}: wrong error ${e.message}`); return; }
  throw new Error(`${w}: expected a throw`);
}
const codesOf = (res) => res.failures.map((f) => f.code);
const has = (res, code, w) => assert(codesOf(res).includes(code), `${w}: expected ${code}, got [${codesOf(res).join(', ')}]`);

const T0 = Date.parse('2026-09-20T15:00:00Z');          // midday Santiago, on the 300 s grid
const T_NIGHT = Date.parse('2026-09-20T05:00:00Z');     // 02:00 Santiago
const DT = 300;
const emitted = new Set();                              // every reason code any test produced

/** A bench interval that passes G0–G3: ~100 W on both meters, mean power consistent with energy. */
function iv(i, o = {}) {
  const t = (o.t0 ?? T0) + i * DT * 1000;
  const aW = o.aW ?? 100, bW = o.bW ?? 99;
  const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
  return {
    spec_version: V.SPEC.spec_version,
    schema_version: V.INTERVAL_SCHEMA_VERSION,
    site_id: 'bench-santiago',
    node_id: 'test-node',
    seq: o.seq ?? i,
    ts_start: new Date(t).toISOString(),
    ts_end: new Date(t + DT * 1000).toISOString(),
    dt_s: DT,
    meters: { a: m('pzem-017:1', aW), b: bW == null ? null : m('epever-tracer:2', bW) },
    source: { adapter: 'simulator', raw_sha256: E.sha256('raw-' + i) },
  };
}

const mkAsm = (o = {}) => new BatchAssembler(Object.assign({ site_id: 'bench-santiago', node_id: 'test-node' }, o));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-feed-'));
const mkPipe = (dir, o = {}) => new Pipeline(Object.assign({ dir, site_id: 'bench-santiago', node_id: 'test-node' }, o));
const record = (lines) => { for (const l of lines) for (const c of l.reasons || []) emitted.add(c); };

/* ───────────────────────── evidence primitives ───────────────────────── */

test('canonical refuses every non-integer number', () => {
  for (const bad of [1.5, Infinity, -Infinity, NaN, 2 ** 53, JSON.parse('1e999')]) {
    throws(() => E.canonical({ x: bad }), /safe integer/, `value ${bad}`);
  }
  throws(() => E.canonical({ f() {} }), /cannot be serialized/, 'function');
  throws(() => E.canonical([1, undefined]), /undefined/, 'undefined in array');
});

test('canonical agrees byte for byte with the ingest and validator copies on integer evidence', () => {
  const N = require('../ingest/lib/normalize');
  const VAL = require('../mining-rig/validators');
  const rec = iv(3);
  eq(E.canonical(rec), N.canonical(rec), 'normalize.canonical');
  eq(E.canonical(rec), VAL.canonical(rec), 'validators.canonical');
  eq(E.canonical({ b: 1, a: { d: 2, c: undefined } }), '{"a":{"d":2},"b":1}', 'sorted, undefined dropped');
});

test('Merkle root: empty, single, odd duplication, order-sensitive', () => {
  eq(E.merkleRoot([]), E.EMPTY_ROOT, 'empty');
  const [x, y, z] = [iv(0), iv(1), iv(2)];
  const h = (r) => E.sha256(E.canonical(r));
  eq(E.merkleRoot([x]), h(x), 'single leaf');
  const l = E.sha256(h(x) + h(y)), r = E.sha256(h(z) + h(z));
  eq(E.merkleRoot([x, y, z]), E.sha256(l + r), 'odd node pairs with itself');
  assert(E.merkleRoot([y, x, z]) !== E.merkleRoot([x, y, z]), 'order matters');
});

/* ───────────────────────────── assembler ───────────────────────────── */

test('a window closes every 12 intervals; genesis prev_hash is 64 zeros', () => {
  const a = mkAsm();
  for (let i = 0; i < 11; i++) a.judge(iv(i));
  assert(!a.full, 'not full at 11');
  a.judge(iv(11));
  assert(a.full, 'full at 12');
  const { batch, status } = a.close();
  eq(status, 'accepted', 'status');
  eq(batch.seq, 0, 'seq');
  eq(batch.prev_hash, E.ZERO_HASH, 'genesis prev_hash');
  eq(batch.batch_id, 'bench-santiago-000000', 'batch_id');
  eq(batch.accepted_count, 12, 'accepted');
  eq(batch.ts_start, iv(0).ts_start, 'window start');
  eq(batch.ts_end, iv(11).ts_end, 'window end');
});

test('chain links, energy is the sum of min(A,B), cumulative carries across batches', () => {
  const a = mkAsm();
  for (let i = 0; i < 12; i++) a.judge(iv(i, { aW: 100, bW: 98 }));
  const b0 = a.close().batch;
  for (let i = 12; i < 24; i++) a.judge(iv(i, { aW: 97, bW: 100 }));
  const b1 = a.close().batch;
  eq(b0.energy_mwh, 12 * Math.round(98000 * DT / 3600), 'b0 basis = meter B');
  eq(b1.energy_mwh, 12 * Math.round(97000 * DT / 3600), 'b1 basis = meter A');
  eq(b1.prev_hash, b0.sha256, 'prev_hash links');
  eq(b1.seq, 1, 'seq increments');
  eq(b1.cumulative_mwh, b0.energy_mwh + b1.energy_mwh, 'cumulative');
  assert(V.verifyBatch(b1, { prev: b0 }).ok, 'b1 verifies against b0');
});

test('a night interval is rejected by the elevation gate, counted, and kept out of the batch', () => {
  const b = mkAsm();
  const lines = [];
  for (let i = 0; i < 12; i++) lines.push(b.judge(iv(i, { t0: T_NIGHT })));   // 100 W claimed at 02:00
  record(lines);
  eq(lines[0].verdict, 'reject', 'night verdict');
  assert(lines[0].reasons.includes('elevation.night'), `night reasons ${lines[0].reasons}`);
  eq(lines[0].batch_id, 'bench-santiago-000000', 'rejected line names its batch');
  const closed = b.close();
  eq(closed.batch.rejected_count, 12, 'all night intervals rejected');
  eq(closed.batch.accepted_count, 0, 'none accepted');
  eq(closed.batch.energy_mwh, 0, 'no energy');
  eq(closed.batch.intervals_root, E.EMPTY_ROOT, 'empty root');
  eq(closed.status, 'accepted', 'an all-rejected batch is still a valid record');
  assert(V.verifyBatch(closed.batch, { prev: null, rejected: lines }).ok, 'verifies with its rejected lines');
});

test('duplicate and out-of-order intervals are rejected with ingest codes and never double-count', () => {
  const a = mkAsm();
  a.judge(iv(0)); a.judge(iv(1));
  const dup = a.judge(iv(1));
  const late = a.judge(iv(0, { seq: 50 }));
  const dupWin = a.judge(iv(0));
  record([dup, late, dupWin]);
  eq(dup.reasons[0], 'ingest.duplicate_interval', 'repeat of the latest');
  eq(dupWin.reasons[0], 'ingest.duplicate_interval', 'repeat of an earlier window member');
  a.judge(iv(3));
  const ooo = a.judge(iv(2));
  record([ooo]);
  eq(ooo.reasons[0], 'ingest.out_of_order', 'late interval');
  const closed = a.close();
  eq(closed.batch.accepted_count, 3, 'only intervals 0, 1, 3 count');
  eq(closed.status, 'accepted', 'batch verifies with ingest rejections in it');
});

test('schema-invalid and non-integer intervals are rejected at the door', () => {
  const a = mkAsm();
  const bad = iv(0); delete bad.dt_s;
  const flt = iv(1); flt.meters.a.mwh = 8333.5;
  const spec = iv(2); spec.spec_version = '9.9.9';
  const l1 = a.judge(bad), l2 = a.judge(flt), l3 = a.judge(spec);
  record([l1, l2, l3]);
  eq(l1.reasons[0], 'ingest.schema_invalid', 'missing field');
  assert(['ingest.not_integer', 'ingest.schema_invalid'].includes(l2.reasons[0]), `float → ${l2.reasons}`);
  eq(l3.reasons[0], 'ingest.spec_mismatch', 'foreign spec version');
});

/* ───────────────────── tampering, with and without re-hashing ───────────────────── */

function chain3() {
  const a = mkAsm();
  const out = [];
  const rejected = [];
  for (let b = 0; b < 3; b++) {
    for (let i = 0; i < 12; i++) {
      const n = b * 12 + i;
      const line = a.judge(i === 5 ? iv(n, { aW: 100, bW: 60 }) : iv(n));   // one divergent interval per batch
      if (line.verdict !== 'accept') rejected.push(line);
    }
    out.push(a.close().batch);
  }
  record(rejected);
  return { batches: out, rejected };
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const rehash = (b) => { b.sha256 = E.batchSha256(b); return b; };

test('an untouched three-batch chain verifies, including its rejected lines', () => {
  const { batches, rejected } = chain3();
  batches.forEach((b, i) => {
    const res = V.verifyBatch(b, { prev: batches[i - 1] || null, rejected });
    assert(res.ok, `batch ${i}: ${codesOf(res)}`);
    eq(b.rejected_count, 1, `batch ${i} rejected count`);
  });
});

test('every tampering is caught — even when the attacker recomputes sha256', () => {
  const { batches, rejected } = chain3();
  const [b0, b1] = batches;
  const ctx = { prev: b0, rejected };
  const cases = [
    ['energy edited', (b) => { b.energy_mwh += 1; }, 'batch.energy_mismatch'],
    ['cumulative edited', (b) => { b.cumulative_mwh += 1000; }, 'batch.cumulative_mismatch'],
    ['interval energy edited', (b) => { b.intervals[0].meters.a.mwh += 50; b.intervals[0].meters.b.mwh += 50; }, 'batch.root_mismatch'],
    ['interval dropped', (b) => { b.intervals.pop(); }, 'batch.root_mismatch'],
    ['prev_hash rewritten', (b) => { b.prev_hash = 'f'.repeat(64); }, 'batch.chain_break'],
    ['seq rewritten', (b) => { b.seq = 7; }, 'batch.id_mismatch'],
    ['rejected count hidden', (b) => { b.rejected_count = 0; b.interval_count -= 1; }, 'batch.count_mismatch'],
    ['spec version swapped', (b) => { b.spec_version = '0.9.0'; }, 'batch.spec_mismatch'],
  ];
  for (const [name, mutate, code] of cases) {
    const raw = clone(b1); mutate(raw);
    has(V.verifyBatch(raw, ctx), 'batch.hash_mismatch', `${name} (no rehash)`);
    const re = rehash(clone(raw));
    has(V.verifyBatch(re, ctx), code, `${name} (rehashed)`);
  }
});

test('a rejection that the gates would accept, or an unregistered reason, is caught', () => {
  const { batches, rejected } = chain3();
  const b1 = batches[1];
  const forged = rejected.map((l) => (l.batch_id === b1.batch_id ? Object.assign(clone(l), { interval: iv(l.interval.seq) }) : l));
  has(V.verifyBatch(b1, { prev: batches[0], rejected: forged }), 'batch.rejection_unproven', 'forged rejection');
  const unreg = rejected.map((l) => (l.batch_id === b1.batch_id ? Object.assign(clone(l), { reasons: ['made.up'] }) : l));
  has(V.verifyBatch(b1, { prev: batches[0], rejected: unreg }), 'batch.unregistered_reason', 'unregistered code');
  has(V.verifyBatch(b1, { prev: batches[0], rejected: rejected.filter((l) => l.batch_id !== b1.batch_id) }), 'batch.count_mismatch', 'missing ledger line');
});

test('a batch smuggling a gate-failing interval is caught on re-judgment', () => {
  const { batches } = chain3();
  const b = clone(batches[0]);
  b.intervals[0] = iv(0, { aW: 400, bW: 400 });   // over the 150 Wp nameplate ceiling
  b.energy_mwh = b.intervals.reduce((s, r) => s + E.basisMwh(r), 0);
  b.cumulative_mwh = b.energy_mwh;
  b.intervals_root = E.merkleRoot(b.intervals);
  has(V.verifyBatch(rehash(b), { prev: null }), 'batch.interval_rejected', 'nameplate breach inside a batch');
});

/* ──────────────── the same energy, twice: across batches (S2) ──────────────── */

/** An otherwise valid batch after `prev`, every derived field recomputed the way a forger would. */
function nextBatch(prev, intervals, o = {}) {
  const site = o.site_id ?? prev.site_id, seq = prev.seq + 1;
  const first = intervals.reduce((m, r) => (Date.parse(r.ts_start) < Date.parse(m.ts_start) ? r : m), intervals[0]);
  const last = intervals.reduce((m, r) => (Date.parse(r.ts_end) > Date.parse(m.ts_end) ? r : m), intervals[0]);
  const energy = intervals.reduce((s, r) => s + E.basisMwh(r), 0);
  return rehash({
    batch_id: E.batchId(site, seq), site_id: site, node_id: o.node_id ?? prev.node_id, seq,
    ts_start: o.ts_start ?? first.ts_start, ts_end: o.ts_end ?? last.ts_end,
    spec_version: prev.spec_version, schema_version: prev.schema_version,
    interval_count: intervals.length, accepted_count: intervals.length, rejected_count: 0,
    intervals, intervals_root: E.merkleRoot(intervals),
    energy_mwh: energy, cumulative_mwh: prev.cumulative_mwh + energy, prev_hash: prev.sha256,
  });
}

/** The chain's middle batch as head, fresh intervals for what comes after it, and proof that an honest next batch verifies. */
function afterB1() {
  const { batches: [, b1] } = chain3();
  const fresh = (from, n) => Array.from({ length: n }, (_, k) => iv(from + k));
  const check = (b) => { const res = V.verifyBatch(b, { prev: b1, rejected: [] }); codesOf(res).forEach((c) => emitted.add(c)); return res; };
  const honest = check(nextBatch(b1, fresh(24, 12)));
  assert(honest.ok, `an honest next batch must verify: ${codesOf(honest)}`);
  return { b1, fresh, check };
}

test('rejects a repeated interval (batch.interval_repeated)', () => {
  const { b1, fresh, check } = afterB1();
  has(check(nextBatch(b1, clone(b1.intervals))), 'batch.interval_repeated', 'the previous batch re-sent as the next one');
  has(check(nextBatch(b1, [clone(b1.intervals[10]), ...fresh(24, 11)])), 'batch.interval_repeated', 'one counted interval slipped in front');
  const twice = fresh(24, 12); twice[6] = clone(twice[5]);
  has(check(nextBatch(b1, twice)), 'batch.interval_repeated', 'the same interval twice in one batch');
  const respelled = clone(b1.intervals[10]);
  respelled.ts_start = respelled.ts_start.replace('.000Z', 'Z'); respelled.ts_end = respelled.ts_end.replace('.000Z', 'Z');
  has(check(nextBatch(b1, [respelled, ...fresh(24, 11)])), 'batch.interval_repeated', 'a counted interval re-spelled so its hash differs');
});

test('rejects an overlapping interval (batch.interval_overlap)', () => {
  const { b1, fresh, check } = afterB1();
  has(check(nextBatch(b1, fresh(24, 12), { ts_start: b1.intervals[10].ts_start })), 'batch.interval_overlap', 'the window reaches back into the previous batch');
  has(check(nextBatch(b1, [iv(17), ...fresh(24, 11)])), 'batch.interval_overlap', 'a slot the previous batch already judged and refused');
  const swapped = fresh(24, 12); [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
  has(check(nextBatch(b1, swapped)), 'batch.interval_overlap', 'an interval that starts before the one before it ends');
  /* gaps stay allowed: a missing interval is simply not counted */
  const gap = check(nextBatch(b1, [...fresh(26, 4), ...fresh(32, 4)]));
  assert(gap.ok, `a gap is not an overlap: ${codesOf(gap)}`);
  /* a node replaying its last half hour after a batch closed: refused at the door, and the batch that records the refusals is valid */
  const a = mkAsm();
  for (let i = 0; i < 12; i++) a.judge(iv(i));
  a.close();
  const replay = [];
  for (let i = 6; i < 12; i++) replay.push(a.judge(iv(i)));
  record(replay);
  const closed = a.close();
  eq(closed.status, 'accepted', `a window of refused replays is still a valid record [${closed.reasons}]`);
});

test('rejects an interval off the 5-minute grid (batch.interval_off_grid)', () => {
  const { b1, fresh, check } = afterB1();
  const at = (t) => new Date(t).toISOString();
  const probes = [
    ['a minute off the grid', (r) => Object.assign(clone(r), { ts_start: at(Date.parse(r.ts_start) + 60e3), ts_end: at(Date.parse(r.ts_end) + 60e3) })],
    ['ending a second past the grid', (r) => Object.assign(clone(r), { ts_end: at(Date.parse(r.ts_end) + 1000) })],
    ['an on-grid instant spelled another way', (r) => Object.assign(clone(r), { ts_start: r.ts_start.replace('.000Z', 'Z'), ts_end: r.ts_end.replace('.000Z', '+00:00') })],
  ];
  for (const [name, bend] of probes) {
    const ivs = fresh(24, 12); ivs[11] = bend(ivs[11]);
    has(check(nextBatch(b1, ivs)), 'batch.interval_off_grid', name);
    const line = mkAsm().judge(bend(iv(35)));
    record([line]);
    eq(line.reasons[0], 'ingest.off_grid', `${name}: refused at the door`);
  }
});

test('rejects a batch from another installation (batch.site_mismatch)', () => {
  const { b1, fresh, check } = afterB1();
  const as = (r, ids) => Object.assign(clone(r), ids);
  const oneForeign = (ids) => { const ivs = fresh(24, 12); ivs[6] = as(ivs[6], ids); return ivs; };
  has(check(nextBatch(b1, oneForeign({ node_id: 'other-node' }))), 'batch.site_mismatch', 'an interval from another node');
  has(check(nextBatch(b1, oneForeign({ site_id: 'other-site' }))), 'batch.site_mismatch', 'an interval from another site');
  has(check(nextBatch(b1, fresh(24, 12).map((r) => as(r, { node_id: 'other-node' })), { node_id: 'other-node' })), 'batch.site_mismatch', 'the next batch from another node');
  has(check(nextBatch(b1, fresh(24, 12).map((r) => as(r, { site_id: 'other-site' })), { site_id: 'other-site' })), 'batch.site_mismatch', 'the next batch from another site');
});

/* ──────── review of S1/S2: the floor, refused batches and the door ──────── */

const at = (min) => T0 + min * 60e3;
/** An interval of `dt` seconds starting `min` minutes after T0. */
const ivAt = (min, dt = DT, o = {}) => {
  const r = iv(0, o), m = (x) => ({ ...x, mwh: Math.round(x.mw_mean * dt / 3600) });
  return Object.assign(r, { seq: o.seq ?? 1000 + min, ts_start: new Date(at(min)).toISOString(), ts_end: new Date(at(min) + dt * 1000).toISOString(), dt_s: dt,
    meters: { a: m(r.meters.a), b: m(r.meters.b) }, source: { adapter: 'simulator', raw_sha256: E.sha256(`raw-at-${min}-${dt}`) } });
};
/** Accepted-batch spans claimed by more than one batch: the same energy counted twice. */
function claimedTwice(dir) {
  const feed = new Feed(dir);
  const spans = [];
  for (const e of feed.readLedger('batches').filter((x) => x.status === 'accepted')) {
    for (const r of feed.readBatch(e.batch_id).intervals) spans.push({ seq: e.seq, s: Date.parse(r.ts_start), e: Date.parse(r.ts_end) });
  }
  return spans.filter((x, i) => spans.some((y, j) => j > i && y.seq !== x.seq && Math.min(x.e, y.e) > Math.max(x.s, y.s)));
}

test('a batch published as rejected never becomes the floor: an accepted batch re-sent after it is refused (batch.interval_repeated)', () => {
  const dir = tmpDir();
  const p = mkPipe(dir);
  for (let i = 0; i < 12; i++) p.push(iv(i));
  const b0 = p.feed.readBatch('bench-santiago-000000');
  /* a refused, empty batch whose window lies an hour before b0, then b0's own intervals again */
  const hourBefore = new Date(T0 - 3600e3).toISOString();
  const b1 = nextBatch(b0, [], { ts_start: hourBefore, ts_end: hourBefore });
  p.feed.publish({ batch: b1, status: 'rejected', reasons: ['batch.interval_overlap'] });
  const b2 = nextBatch(b1, clone(b0.intervals));
  const res = V.verifyBatch(b2, { prev: b1, floor: b0, rejected: [] });
  codesOf(res).forEach((c) => emitted.add(c));
  has(res, 'batch.interval_repeated', 'judged against the last accepted batch, not the refused one');
  p.feed.publish({ batch: b2, status: 'accepted', reasons: [] });
  const out = verifyFeed(dir);
  assert(!out.ok && out.problems.some((x) => x.includes(b2.batch_id)), `verify-cli must refuse ${b2.batch_id}: ${out.problems.join('; ')}`);
});

test('the previous batch is rehashed before its time, node or intervals are read (batch.chain_break)', () => {
  const { batches: [b0] } = chain3();
  const b1 = nextBatch(b0, clone(b0.intervals));
  const rewritten = Object.assign(clone(b0), { ts_end: '1970-01-01T00:00:00.000Z', intervals: [] });   // sha256 field kept
  const res = V.verifyBatch(b1, { prev: rewritten, rejected: [] });
  has(res, 'batch.chain_break', 'a previous batch that does not rehash');
});

test('a refused batch carries the total forward unchanged and never moves the floor; only accepted batches add energy (batch.cumulative_mismatch)', () => {
  const a = mkAsm();
  for (let i = 0; i < 12; i++) a.judge(iv(i));
  const b0 = a.close().batch;
  /* a defect the door did not catch: a line from another node slipped into the window */
  for (let i = 12; i < 23; i++) a.judge(iv(i));
  a.window.push({ batch_id: a.openBatchId, verdict: 'accept', reasons: [], interval: Object.assign(iv(23), { node_id: 'other-node' }), basis_mwh: E.basisMwh(iv(23)) });
  const refused = a.close();
  eq(refused.status, 'rejected', 'refused at batch level');
  assert(refused.batch.energy_mwh > 0, 'it holds energy');
  eq(refused.batch.cumulative_mwh, b0.cumulative_mwh, 'cumulative carried forward unchanged');
  eq(a.prev_ts_end, b0.ts_end, 'the floor stays at the last accepted batch');
  const asRejected = V.verifyBatch(refused.batch, { prev: b0, status: 'rejected' });
  assert(!codesOf(asRejected).includes('batch.cumulative_mismatch'), `carried total: ${codesOf(asRejected)}`);
  for (let i = 24; i < 36; i++) a.judge(iv(i));
  const next = a.close();
  eq(next.status, 'accepted', `the next batch [${next.reasons}]`);
  eq(next.batch.cumulative_mwh, b0.energy_mwh + next.batch.energy_mwh, 'the total is the energy of accepted batches only');
  /* a batch published as rejected that still adds its energy is caught */
  const dir = tmpDir();
  const p = mkPipe(dir);
  for (let i = 0; i < 12; i++) p.push(iv(i));
  const c0 = p.feed.readBatch('bench-santiago-000000');
  const c1 = nextBatch(c0, [clone(c0.intervals[11]), ...Array.from({ length: 11 }, (_, k) => iv(12 + k))]);   // really fails: interval_repeated
  const res = V.verifyBatch(c1, { prev: c0, status: 'rejected' });
  codesOf(res).forEach((c) => emitted.add(c));
  has(res, 'batch.cumulative_mismatch', 'a refused batch that adds its energy');
  p.feed.publish({ batch: c1, status: 'rejected', reasons: ['batch.interval_repeated'] });
  const out = verifyFeed(dir);
  assert(!out.ok && out.problems.some((x) => x.includes(c1.batch_id)), `verify-cli: ${out.problems.join('; ')}`);
});

test('a change of dt_s is refused interval by interval at the door, never a whole batch, and nothing is counted twice (ingest.overlap)', () => {
  /* one overlapping interval inside a window: only that line is refused */
  const a = mkAsm();
  for (let i = 0; i < 9; i++) a.judge(iv(i));
  a.judge(ivAt(45, 900));                                          // 15:45–16:00
  const inside = a.judge(ivAt(50));                                // 15:50, after the last start, inside the last span
  record([inside]);
  eq(inside.reasons[0], 'ingest.overlap', 'the overlapping line');
  a.judge(ivAt(60));
  const closed = a.close();
  eq(closed.status, 'accepted', `the batch survives [${closed.reasons}]`);
  eq(closed.batch.accepted_count, 11, 'every honest line counted');
  /* honest pipeline: 900 s, then 60 s inside it, then 300 s again */
  const dir = tmpDir();
  const p = mkPipe(dir);
  for (let i = 0; i < 11; i++) p.push(iv(i));
  p.push(ivAt(60, 900));                                           // 16:00–16:15 closes batch 0
  const tiny = [];
  for (let k = 0; k < 12; k++) tiny.push(p.push(ivAt(61, 60, { seq: 2000 + k })));
  record(tiny);
  eq(tiny[0].reasons[0], 'ingest.overlap', '16:01 starts inside 16:00–16:15');
  for (let i = 0; i < 12; i++) p.push(ivAt(65 + i * 5));
  const out = verifyFeed(dir);
  assert(out.ok, out.problems.join('; '));
  eq(out.rejected_batches, 0, 'no batch lost');
  eq(claimedTwice(dir).length, 0, 'no span claimed by two accepted batches');
});

test('an interval from another site or node is refused at the door and the batch survives (ingest.site_mismatch)', () => {
  const a = mkAsm();
  for (let i = 0; i < 10; i++) a.judge(iv(i));
  const stray = a.judge(Object.assign(iv(10), { node_id: 'stray-node' }));
  const other = a.judge(Object.assign(iv(11), { site_id: 'other-site' }));
  record([stray, other]);
  eq(stray.reasons[0], 'ingest.site_mismatch', 'another node');
  eq(other.reasons[0], 'ingest.site_mismatch', 'another site');
  const closed = a.close();
  eq(closed.status, 'accepted', `the batch survives [${closed.reasons}]`);
});

test('a node change is judged against the last accepted batch, so every later batch is refused, not only the first (batch.site_mismatch)', () => {
  const dir = tmpDir();
  let p = mkPipe(dir);
  for (let i = 0; i < 12; i++) p.push(iv(i));
  p = mkPipe(dir, { node_id: 'node-2' });                          // the node replaced, same feed
  for (let i = 12; i < 48; i++) p.push(Object.assign(iv(i), { node_id: 'node-2' }));
  const st = p.feed.readLedger('batches');
  const after = st.filter((e) => e.seq >= 1);
  assert(after.length === 3 && after.every((e) => e.status === 'rejected' && e.reasons.includes('batch.site_mismatch')), JSON.stringify(st.map((e) => [e.seq, e.status, e.reasons])));
  eq(verifyFeed(dir).cumulative_mwh, 12 * Math.round(99000 * DT / 3600), 'no energy from the other node');
});

test('a batch window comes only from intervals that hold time: refused lines and spans longer than the gates allow never set it (batch.interval_overlap, batch.window_mismatch)', () => {
  /* a gate-refused 3600 s interval (bench allows 900 s) does not stretch the window */
  let dir = tmpDir(), p = mkPipe(dir);
  for (let i = 0; i < 11; i++) p.push(iv(i));
  const bogus = p.push(ivAt(60, 3600));
  record([bogus]);
  for (let i = 0; i < 24; i++) p.push(ivAt(65 + i * 5));
  let st = p.feed.readLedger('batches');
  eq(p.feed.readBatch(st[0].batch_id).ts_end, iv(10).ts_end, 'batch 0 ends with its last accepted interval');
  assert(st.every((e) => e.status === 'accepted'), JSON.stringify(st.map((e) => [e.seq, e.status, e.reasons])));
  /* a first window of nothing but refused lines, some spelled another way: canonical, zero-length, on every grid */
  dir = tmpDir(); p = mkPipe(dir);
  for (let i = 0; i < 12; i++) {
    const r = ivAt(1 + i * 5);                                     // off the 300 s grid
    if (i % 2) { r.ts_start = r.ts_start.replace('.000Z', 'Z'); r.ts_end = r.ts_end.replace('.000Z', '+00:00'); }
    p.push(r);
  }
  for (let i = 0; i < 24; i++) p.push(iv(1 + i));
  st = p.feed.readLedger('batches');
  const g = p.feed.readBatch(st[0].batch_id);
  eq(g.ts_start, '1970-01-01T00:00:00.000Z', 'genesis window start');
  eq(g.ts_end, g.ts_start, 'zero-length');
  assert(st.every((e) => e.status === 'accepted'), JSON.stringify(st.map((e) => [e.seq, e.status, e.reasons])));
  assert(verifyFeed(dir).ok, 'the feed verifies');
});

/* ───────────────────────── pipeline: restart safety ───────────────────────── */

test('restart mid-window: persisted lines are restored and closed as a batch, nothing lost', () => {
  const dir = tmpDir();
  const p1 = mkPipe(dir);
  for (let i = 0; i < 7; i++) p1.push(iv(i));
  eq(p1.head(), null, 'nothing published yet');
  const p2 = mkPipe(dir);                                      // "crash" and restart
  eq(p2.recovered.length, 1, 'one batch closed on restart');
  eq(p2.recovered[0].batch.accepted_count, 7, 'all 7 intervals kept');
  for (let i = 7; i < 19; i++) p2.push(iv(i));
  const out = verifyFeed(dir);
  assert(out.ok, out.problems.join('; '));
  eq(out.batches, 2, 'batches');
  eq(out.cumulative_mwh, 19 * Math.round(99000 * DT / 3600), 'every interval counted once');
});

test('crash between writing a batch file and the index: the public file is adopted, not rebuilt', () => {
  const dir = tmpDir();
  const p1 = mkPipe(dir);
  for (let i = 0; i < 12; i++) p1.push(iv(i));
  const idx0 = fs.readFileSync(path.join(dir, 'index.json'), 'utf8');
  const bl0 = fs.readFileSync(path.join(dir, 'ledger', 'batches.jsonl'), 'utf8');
  for (let i = 12; i < 24; i++) p1.push(iv(i));
  const head1 = p1.head().head_sha256;
  fs.writeFileSync(path.join(dir, 'index.json'), idx0);      // the index never got the second batch
  fs.writeFileSync(path.join(dir, 'ledger', 'batches.jsonl'), bl0);
  const p2 = mkPipe(dir);
  eq(p2.recovered.length, 1, 'adopted one batch');
  eq(p2.head().head_sha256, head1, 'same head as before the crash');
  p2.push(iv(24));
  const out = verifyFeed(dir);
  assert(out.ok, out.problems.join('; '));
  eq(out.batches, 2, 'no duplicate batch');
});

test('a duplicate replayed after a restart is still rejected', () => {
  const dir = tmpDir();
  const p1 = mkPipe(dir);
  for (let i = 0; i < 12; i++) p1.push(iv(i));
  const p2 = mkPipe(dir);
  const line = p2.push(iv(11));
  record([line]);
  eq(line.reasons[0], 'ingest.duplicate_interval', 'restart does not reopen the door');
});

test('the same input always produces the same head hash', () => {
  const heads = [tmpDir(), tmpDir()].map((dir) => {
    const p = mkPipe(dir);
    for (let i = 0; i < 30; i++) p.push(i % 7 === 3 ? iv(i, { bW: 70 }) : iv(i));
    p.close();
    return p.head().head_sha256;
  });
  eq(heads[0], heads[1], 'deterministic');
});

test('verify-cli catches a batch file edited on disk after publication', () => {
  const dir = tmpDir();
  const p = mkPipe(dir);
  for (let i = 0; i < 24; i++) p.push(iv(i));
  const f = path.join(dir, 'batches', 'bench-santiago-000000.json');
  const b = JSON.parse(fs.readFileSync(f, 'utf8'));
  b.energy_mwh += 1;
  fs.writeFileSync(f, E.canonical(b) + '\n');
  const out = verifyFeed(dir);
  assert(!out.ok, 'tampered feed must fail');
  assert(out.problems.some((x) => /bench-santiago-000000/.test(x)), out.problems.join('; '));
});

/* ───────────────────────── registry and pinned fixture ───────────────────────── */

test('every reason code the batch layer emitted is registered', () => {
  const missing = [...emitted].filter((c) => !V.isRegistered(c));
  assert(emitted.size >= 5, `only ${emitted.size} codes exercised`);
  assert(missing.length === 0, `unregistered: ${missing.join(', ')}`);
  for (const c of Object.keys(REASONS.codes)) assert(/^(ingest|batch|verifier)\.[a-z_]+$/.test(c), `bad code name ${c}`);
});

function fixture() {
  const { batches } = chain3();
  return {
    description: 'Pinned batch hashes for a deterministic three-batch bench chain (one divergent interval per batch). Any implementation of protocol/evidence.js in any language must reproduce these exactly. Regenerate with: node batch/batch.test.js --write',
    spec_version: V.SPEC.spec_version,
    interval_schema_version: V.INTERVAL_SCHEMA_VERSION,
    batch_schema_version: V.BATCH_SCHEMA_VERSION,
    empty_root: E.EMPTY_ROOT,
    batches: batches.map((b) => ({ batch_id: b.batch_id, intervals_root: b.intervals_root, energy_mwh: b.energy_mwh, cumulative_mwh: b.cumulative_mwh, prev_hash: b.prev_hash, sha256: b.sha256 })),
  };
}

test('pinned fixture: batch hashes are reproducible across implementations', () => {
  const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const got = fixture();
  eq(JSON.stringify(got.batches), JSON.stringify(want.batches), 'batch hashes');
  eq(got.empty_root, want.empty_root, 'empty root');
});

/* ───────────────────────────── runner ───────────────────────────── */

if (process.argv.includes('--write')) {
  fs.writeFileSync(FIXTURE, JSON.stringify(fixture(), null, 2) + '\n');
  console.log('wrote ' + path.relative(process.cwd(), FIXTURE));
  process.exit(0);
}

(async () => {
  console.log('\nbatch');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
