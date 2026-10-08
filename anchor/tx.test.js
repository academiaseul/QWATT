/**
 * QWATT anchor — transaction builder tests (offline, no network)
 * Run: node anchor/tx.test.js     (needs `npm install` inside anchor/ for the Stellar SDK)
 */

'use strict';

const S = require('@stellar/stellar-sdk');
const E = require('../protocol/evidence');
const { BatchAssembler } = require('../batch/assemble');
const V = require('../batch/verify');
const T = require('./tx');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const T0 = Date.parse('2026-09-20T15:00:00Z');
const NOW = Math.floor(Date.parse('2026-10-20T12:00:00Z') / 1000);
const DT = 300;

function iv(i) {
  const t = T0 + i * DT * 1000;
  const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
  return {
    spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION,
    site_id: 'bench-santiago', node_id: 'test-node', seq: i,
    ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
    meters: { a: m('pzem-017:1', 100), b: m('epever-tracer:2', 99) },
    source: { adapter: 'simulator', raw_sha256: E.sha256('raw-' + i) },
  };
}

function batches(n = 2) {
  const a = new BatchAssembler({ site_id: 'bench-santiago', node_id: 'test-node' });
  const out = [];
  for (let b = 0; b < n; b++) { for (let i = 0; i < 12; i++) a.judge(iv(b * 12 + i)); out.push(a.close().batch); }
  return out;
}

const proposer = S.Keypair.random();
const cfg = {
  network_passphrase: S.Networks.TESTNET,
  anchor_account: S.Keypair.random().publicKey(),
  asset_code: 'QWATT',
  asset_issuer: 'GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46',
  payment_destination: S.Keypair.random().publicKey(),
  payment_amount: '0.0000001',
  base_fee: 100,
};
const params = () => T.proposalParams('123456789', NOW);
const propose = (batch, c = cfg, p = params()) => { const tx = T.buildAnchorTx(batch, c, p); tx.sign(proposer); return tx.toEnvelope().toXDR('base64'); };

test('the same batch and parameters always build the same transaction hash', () => {
  const [b] = batches(1);
  const h1 = T.buildAnchorTx(b, cfg, params()).hash().toString('hex');
  const h2 = T.buildAnchorTx(JSON.parse(JSON.stringify(b)), cfg, params()).hash().toString('hex');
  eq(h1, h2, 'deterministic');
});

test('three atomic operations: anchor hash, cumulative total, nominal payment; memo QW#<seq>', () => {
  const [, b1] = batches(2);
  const tx = T.buildAnchorTx(b1, cfg, params());
  eq(tx.operations.length, 3, 'operation count');
  const [o0, o1, o2] = tx.operations;
  eq(o0.type, 'manageData', 'op0'); eq(o0.name, T.ANCHOR_KEY, 'op0 name'); eq(o0.value.toString('ascii'), b1.sha256, 'op0 value');
  eq(o0.value.length, 64, 'anchor fits the 64-byte manageData value');
  eq(o1.name, T.CUMULATIVE_KEY, 'op1 name'); eq(o1.value.toString('ascii'), String(b1.cumulative_mwh), 'op1 value');
  eq(o2.type, 'payment', 'op2'); eq(o2.amount, '0.0000001', 'nominal amount'); eq(o2.asset.code, 'QWATT', 'asset');
  eq(o2.destination, cfg.payment_destination, 'destination');
  eq(tx.memo.value.toString(), 'QW#1', 'memo');
  eq(tx.sequence, '123456790', 'sequence = account sequence + 1');
  eq(tx.source, cfg.anchor_account, 'source is the anchoring account');
});

test('Test C path: the verifier rebuilds the proposal from the published batch and it matches', () => {
  const [b] = batches(1);
  const xdr = propose(b);
  const m = T.matchPending(xdr, b, cfg, NOW);
  assert(m.match, `expected a match: ${m.detail}`);
  eq(m.tx.signatures.length, 1, 'proposer signature preserved for the verifier to add to');
});

test('Test D: evidence altered after the proposer signed → verifier.hash_mismatch, nothing to sign', () => {
  const [b] = batches(1);
  const xdr = propose(b);
  const altered = JSON.parse(JSON.stringify(b));
  altered.intervals[0].meters.a.mwh += 100; altered.intervals[0].meters.b.mwh += 100;
  altered.energy_mwh = altered.intervals.reduce((s, r) => s + E.basisMwh(r), 0);
  altered.cumulative_mwh = altered.energy_mwh;
  altered.intervals_root = E.merkleRoot(altered.intervals);
  altered.sha256 = E.batchSha256(altered);                    // the forger even re-hashes
  assert(V.verifyBatch(altered, { prev: null }).ok, 'the altered batch is internally consistent');
  const m = T.matchPending(xdr, altered, cfg, NOW);
  assert(!m.match, 'must not match');
  eq(m.reasons[0], 'verifier.hash_mismatch', 'reason');
});

test('a proposer cannot get a signature on any field the batch does not say', () => {
  const [b] = batches(1);
  const lies = [
    ['cumulative', () => propose(Object.assign({}, b, { cumulative_mwh: b.cumulative_mwh + 1 }))],
    ['destination', () => propose(b, Object.assign({}, cfg, { payment_destination: S.Keypair.random().publicKey() }))],
    ['amount', () => propose(b, Object.assign({}, cfg, { payment_amount: '1000' }))],
    ['memo seq', () => propose(Object.assign({}, b, { seq: 99 }))],
    ['fee', () => propose(b, Object.assign({}, cfg, { base_fee: 100000 }))],
  ];
  for (const [what, mk] of lies) {
    const m = T.matchPending(mk(), b, cfg, NOW);
    assert(!m.match, `${what}: must not match`);
    eq(m.reasons[0], 'verifier.tx_mismatch', `${what}: reason`);
  }
});

test('expired, over-wide and unparseable proposals are refused', () => {
  const [b] = batches(1);
  const expired = propose(b, cfg, { sequence: '1', minTime: NOW - 3600, maxTime: NOW - 1 });
  eq(T.matchPending(expired, b, cfg, NOW).match, false, 'expired');
  const tx = new S.TransactionBuilder(new S.Account(cfg.anchor_account, '0'), { fee: '100', networkPassphrase: cfg.network_passphrase, timebounds: { minTime: 0, maxTime: NOW + 3 * 86400 } })
    .addOperation(S.Operation.manageData({ name: T.ANCHOR_KEY, value: Buffer.from(b.sha256, 'ascii') })).build();
  eq(T.matchPending(tx.toEnvelope().toXDR('base64'), b, cfg, NOW).match, false, 'three-day window');
  const junk = T.matchPending('not-xdr', b, cfg, NOW);
  eq(junk.match, false, 'junk'); eq(junk.reasons[0], 'verifier.tx_mismatch', 'junk reason');
  let threw = false;
  try { T.buildAnchorTx(b, cfg, { sequence: '1', minTime: 0, maxTime: 2 * 86400 }); } catch (e) { threw = true; }
  assert(threw, 'builder refuses a window wider than 24 h');
});

test('config is validated before anything is built', () => {
  const [b] = batches(1);
  for (const k of ['anchor_account', 'payment_destination', 'asset_issuer', 'network_passphrase']) {
    const c = Object.assign({}, cfg); delete c[k];
    let threw = false; try { T.buildAnchorTx(b, c, params()); } catch (e) { threw = true; }
    assert(threw, `missing ${k} must throw`);
  }
});

test('anchored prefix: the on-chain head pins exactly which batches are anchored', () => {
  const C = require('./chain');
  const L = [
    { batch_id: 'b-000000', seq: 0, sha256: 'a'.repeat(64), status: 'accepted' },
    { batch_id: 'b-000001', seq: 1, sha256: 'b'.repeat(64), status: 'rejected' },
    { batch_id: 'b-000002', seq: 2, sha256: 'c'.repeat(64), status: 'accepted' },
  ];
  eq(C.anchoredPrefix(L, null), 0, 'nothing anchored');
  eq(C.nextToAnchor(L, 0).batch_id, 'b-000000', 'first accepted');
  eq(C.anchoredPrefix(L, 'a'.repeat(64)), 1, 'head at batch 0');
  eq(C.nextToAnchor(L, 1).batch_id, 'b-000002', 'a rejected batch is skipped, never anchored');
  eq(C.nextToAnchor(L, 3), null, 'idle at the end');
  let threw = false; try { C.anchoredPrefix(L, 'f'.repeat(64)); } catch (e) { threw = true; }
  assert(threw, 'an on-chain anchor that is not a published batch is an alarm');
  threw = false; try { C.anchoredPrefix(L, 'b'.repeat(64)); } catch (e) { threw = true; }
  assert(threw, 'an anchor pointing at a rejected batch is an alarm');
});

(async () => {
  console.log('\nanchor tx');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
