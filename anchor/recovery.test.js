/**
 * QWATT anchor — recovery tests (plan unit 3.6; SOW D4 "recovery logic in place before day 21")
 * Run: node anchor/recovery.test.js     (offline: in-memory Horizon, feed served on localhost)
 *
 * Every scenario ends with the same invariant check: each accepted batch is
 * anchored exactly once, in order, and the on-chain head is the last one.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('@stellar/stellar-sdk');
const E = require('../protocol/evidence');
const V = require('../batch/verify');
const { Pipeline } = require('../batch/pipeline');
const { Proposer } = require('./proposer');
const { Verifier } = require('./verifier');
const { FakeHorizon } = require('./fake-horizon');
const { serveDir } = require('./static-server');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const DT = 300, T0 = Date.parse('2026-09-20T15:00:00Z');
function iv(i) {
  const t = T0 + i * DT * 1000;
  const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
  return {
    spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION,
    site_id: 'rec', node_id: 'rec', seq: i,
    ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
    meters: { a: m('a', 100), b: m('b', 99) },
    source: { adapter: 'simulator', raw_sha256: E.sha256('rec-' + i) },
  };
}

/** A complete world: fake chain, feed on disk served on localhost, both services. */
async function world() {
  const keys = { account: S.Keypair.random(), proposer: S.Keypair.random(), verifier: S.Keypair.random(), third: S.Keypair.random(), dest: S.Keypair.random() };
  const clock = { t: Math.floor(Date.parse('2026-11-03T12:00:00Z') / 1000), now() { return this.t; } };
  const fake = new FakeHorizon({ account: keys.account.publicKey(), signers: [keys.proposer.publicKey(), keys.verifier.publicKey(), keys.third.publicKey()], clock });
  const cfg = { network_passphrase: S.Networks.TESTNET, horizon_url: 'http://fake', anchor_account: keys.account.publicKey(), asset_code: 'native', payment_destination: keys.dest.publicKey(), payment_amount: '0.0000001', base_fee: 100 };
  const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-rec-feed-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-rec-ver-'));
  const host = await serveDir(feedDir);
  const pipe = new Pipeline({ dir: feedDir, site_id: 'rec', node_id: 'rec' });
  let n = 0;
  const w = {
    keys, clock, fake, cfg, feedDir, stateDir, host, pipe,
    mkProposer: () => new Proposer({ feedDir, cfg, keypair: keys.proposer, server: fake }),
    mkVerifier: (o = {}) => new Verifier({ feedUrl: host.url, cfg, keypair: keys.verifier, stateDir, server: fake, ...o }),
    addBatches(k) { for (let i = 0; i < 12 * k; i++) pipe.push(iv(n++)); },
    accepted() { return pipe.feed.readLedger('batches').filter((e) => e.status === 'accepted'); },
    async settle(p, v, rounds = 40) {
      for (let r = 0; r < rounds; r++) {
        const a = await p.tick(clock.now()); const b = await v.tick(clock.now());
        clock.t += 30;
        if (a.action === 'idle' && b.action === 'idle') return;
      }
      throw new Error('did not settle');
    },
    /** Each accepted batch anchored exactly once, in order; head = last batch. */
    invariant() {
      const acc = this.accepted();
      const memos = fake.txs.map((t) => t.memo);
      eq(JSON.stringify(memos), JSON.stringify(acc.map((e) => `QW#${e.seq}`)), 'one anchor per accepted batch, in order');
      eq(Buffer.from(fake.data['qwatt.anchor.sha256'] || '', 'base64').toString(), acc[acc.length - 1].sha256, 'on-chain head = last batch');
    },
    close: () => host.close(),
  };
  w.p = w.mkProposer(); w.v = w.mkVerifier();
  return w;
}

/** Rewrite a published batch file and rehash it, so the forgery is internally consistent. */
function forge(w, id, mutate) {
  const f = path.join(w.feedDir, 'batches', `${id}.json`);
  const b = JSON.parse(fs.readFileSync(f, 'utf8'));
  mutate(b);
  b.sha256 = E.batchSha256(b);
  fs.writeFileSync(f, E.canonical(b) + '\n');
  return b;
}

/** The pipeline builds its next batch on top of `b`, as a proposer that believes that file would. */
function buildOn(w, b) { w.pipe.asm.prev_hash = b.sha256; w.pipe.asm.cumulative_mwh = b.cumulative_mwh; }

/** Rewrite one batch-ledger line as a batch-level rejection: published, never anchored. */
function markRejected(w, seq, reasons, sha256) {
  const f = path.join(w.feedDir, 'ledger', 'batches.jsonl');
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const e of lines) if (e.seq === seq) Object.assign(e, { status: 'rejected', reasons }, sha256 ? { sha256 } : {});
  fs.writeFileSync(f, lines.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

const onchainTotal = (w) => Buffer.from(w.fake.data['qwatt.cumulative_mwh'] || '', 'base64').toString();

test('happy path: three batches anchored once each, in order', async () => {
  const w = await world();
  w.addBatches(3);
  await w.settle(w.p, w.v);
  w.invariant();
  eq(w.fake.submissions, 3, 'no extra submissions');
  await w.close();
});

test('submit times out but the transaction landed: recognised from the chain, never sent twice', async () => {
  const w = await world();
  w.addBatches(3);
  await w.p.tick(w.clock.now());
  w.fake.failNext = 'timeout-after';
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'submit_failed', 'the verifier saw a timeout');
  await w.settle(w.p, w.v);
  w.invariant();
  eq(w.fake.submissions, 3, 'the landed transaction was not resubmitted');
  await w.close();
});

test('submit times out and did not land: the same proposal is submitted again and anchors once', async () => {
  const w = await world();
  w.addBatches(2);
  await w.p.tick(w.clock.now());
  w.fake.failNext = 'timeout-before';
  eq((await w.v.tick(w.clock.now())).action, 'submit_failed', 'timeout');
  eq(w.fake.txs.length, 0, 'nothing landed');
  await w.settle(w.p, w.v);
  w.invariant();
  await w.close();
});

test('verifier offline while six batches accumulate: it catches up in order with no gap', async () => {
  const w = await world();
  w.addBatches(6);
  for (let i = 0; i < 5; i++) { await w.p.tick(w.clock.now()); w.clock.t += 600; }   // only the proposer runs
  eq(w.fake.txs.length, 0, 'one signature anchors nothing');
  await w.settle(w.p, w.v);
  w.invariant();
  await w.close();
});

test('verifier down for more than 24 h: the expired proposal is replaced, not refused', async () => {
  const w = await world();
  w.addBatches(1);
  eq((await w.p.tick(w.clock.now())).action, 'proposed', 'proposed');
  w.clock.t += 25 * 3600;
  const v1 = await w.v.tick(w.clock.now());
  eq(v1.action, 'wait', 'verifier waits on an expired proposal');
  eq((await w.p.tick(w.clock.now())).action, 'proposed', 'proposer re-proposes');
  eq((await w.v.tick(w.clock.now())).action, 'anchored', 'fresh proposal anchors');
  assert(!fs.existsSync(path.join(w.stateDir, 'refusals.jsonl')), 'expiry is not logged as a refusal');
  w.invariant();
  await w.close();
});

test('account sequence moved by another transaction: stale proposal waits, a fresh one anchors', async () => {
  const w = await world();
  w.addBatches(1);
  await w.p.tick(w.clock.now());
  w.fake.sequence += 1n;                                           // someone used the account
  eq((await w.v.tick(w.clock.now())).action, 'wait', 'verifier does not submit a stale sequence');
  eq((await w.p.tick(w.clock.now())).action, 'proposed', 'proposer rebuilds on the new sequence');
  eq((await w.v.tick(w.clock.now())).action, 'anchored', 'anchored');
  w.invariant();
  await w.close();
});

test('Horizon unreachable: nothing is signed or written, and work resumes when it returns', async () => {
  const w = await world();
  w.addBatches(2);
  w.fake.offline = true;
  let threw = false;
  try { await w.p.tick(w.clock.now()); } catch (e) { threw = true; }
  assert(threw, 'proposer tick fails loudly (the CLI logs and retries)');
  eq((await w.v.tick(w.clock.now())).action, 'error', 'verifier reports an error');
  assert(!fs.existsSync(path.join(w.feedDir, 'pending')) || fs.readdirSync(path.join(w.feedDir, 'pending')).length === 0, 'no proposal written');
  w.fake.offline = false;
  await w.settle(w.p, w.v);
  w.invariant();
  await w.close();
});

test('public feed unreachable: the verifier signs nothing and says why', async () => {
  const w = await world();
  w.addBatches(1);
  await w.p.tick(w.clock.now());
  await w.host.close();
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'error', 'error');
  eq(r.reason, 'verifier.feed_unavailable', 'reason');
  eq(w.fake.txs.length, 0, 'nothing anchored');
});

test('clock check: a host clock 10 minutes off the network refuses to sign', async () => {
  const w = await world();
  w.addBatches(1);
  await w.p.tick(w.clock.now());
  const r = await w.v.tick(w.clock.now() + 600);
  eq(r.action, 'wait', 'waits');
  assert(/clock/.test(r.reason), r.reason);
  eq((await w.p.tick(w.clock.now() - 600)).action, 'wait', 'proposer also refuses with a skewed clock');
  await w.close();
});

test('both services restarted mid-flight resume from chain and feed without duplicates', async () => {
  const w = await world();
  w.addBatches(4);
  await w.p.tick(w.clock.now()); await w.v.tick(w.clock.now());
  await w.p.tick(w.clock.now());                                   // a live proposal is outstanding
  const p2 = w.mkProposer(), v2 = w.mkVerifier();                  // restart both
  await w.settle(p2, v2);
  w.invariant();
  eq(w.fake.submissions, 4, 'no duplicate submissions across the restart');
  await w.close();
});

test('a batch the verifier refused is never retried with the same proposal, and the refusal is logged once', async () => {
  const w = await world();
  w.addBatches(1);
  await w.p.tick(w.clock.now());
  const f = path.join(w.feedDir, 'batches', 'rec-000000.json');
  const orig = fs.readFileSync(f, 'utf8');
  const b = JSON.parse(orig); b.energy_mwh += 1; b.sha256 = E.batchSha256(b);
  fs.writeFileSync(f, E.canonical(b) + '\n');
  eq((await w.v.tick(w.clock.now())).action, 'refused', 'refused');
  eq((await w.v.tick(w.clock.now())).action, 'refused', 'still refused');
  const lines = fs.readFileSync(path.join(w.stateDir, 'refusals.jsonl'), 'utf8').split('\n').filter(Boolean);
  eq(lines.length, 1, 'logged once');
  eq(w.fake.txs.length, 0, 'nothing anchored while the feed is wrong');
  fs.writeFileSync(f, orig);
  await w.settle(w.p, w.v);
  w.invariant();
  await w.close();
});

/* ── S1 · the inherited total: what a batch inherits must lead back to the on-chain head ── */

test('verifier refuses a batch whose inherited total does not match the on-chain head (verifier.head_mismatch)', async () => {
  const w = await world();
  w.addBatches(3);
  await w.settle(w.p, w.v);
  w.invariant();                                                   // honest chain anchored; head = rec-000002
  const total = onchainTotal(w);
  const forged = forge(w, 'rec-000002', (b) => { b.cumulative_mwh += 1000000; });   // inflated, rehashed
  buildOn(w, forged);
  w.addBatches(1);                                                 // rec-000003 inherits the inflated total
  eq((await w.p.tick(w.clock.now())).action, 'proposed', 'the new batch is proposed');
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'refused', 'verifier refuses to co-sign');
  assert((r.reasons || []).includes('verifier.head_mismatch'), `reasons: ${JSON.stringify(r.reasons)}`);
  eq(w.fake.txs.length, 3, 'nothing new anchored');
  eq(onchainTotal(w), total, 'on-chain cumulative unchanged');
  await w.close();
});

test('the walk to the on-chain head passes through a published-but-unanchored batch, and the next accepted batch anchors', async () => {
  const w = await world();
  w.addBatches(1);
  await w.settle(w.p, w.v);                                        // head = rec-000000
  w.addBatches(2);
  markRejected(w, 1, ['batch.spec_mismatch']);                     // rec-000001 published, never anchored
  await w.settle(w.p, w.v);
  w.invariant();                                                   // QW#0 then QW#2
  /* current semantics: the unanchored batch stays in the hash chain and its energy in the running total */
  const b2 = JSON.parse(fs.readFileSync(path.join(w.feedDir, 'batches', 'rec-000002.json'), 'utf8'));
  eq(onchainTotal(w), String(b2.cumulative_mwh), 'on-chain total = total of the anchored batch');
  assert(!fs.existsSync(path.join(w.stateDir, 'refusals.jsonl')), 'no refusal on an honest chain');
  await w.close();
});

test('a walk longer than the bound is refused, never signed, and anchors once within it (verifier.head_mismatch)', async () => {
  const w = await world();
  w.addBatches(1);
  await w.settle(w.p, w.v);
  w.addBatches(2);
  markRejected(w, 1, ['batch.spec_mismatch']);                     // rec-000002 is two batches from the head
  eq((await w.p.tick(w.clock.now())).action, 'proposed', 'proposed');
  const r = await w.mkVerifier({ maxWalk: 1 }).tick(w.clock.now());
  eq(r.action, 'refused', 'refused beyond the bound');
  eq(r.reasons[0], 'verifier.head_mismatch', 'reason');
  assert(/more than 1 /.test(r.detail), r.detail);
  eq(w.fake.txs.length, 1, 'nothing anchored beyond the bound');
  await w.settle(w.p, w.v);                                        // the default bound reaches the head
  w.invariant();
  await w.close();
});

test('genesis: with nothing anchored yet, an inherited total that does not start from zero is refused (verifier.head_mismatch)', async () => {
  const w = await world();
  w.addBatches(1);
  const forged = forge(w, 'rec-000000', (b) => { b.cumulative_mwh += 1000000; });
  markRejected(w, 0, ['batch.cumulative_mismatch'], forged.sha256);   // never anchored itself
  buildOn(w, forged);
  w.addBatches(1);                                                 // rec-000001, the first accepted batch
  eq((await w.p.tick(w.clock.now())).action, 'proposed', 'proposed');
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'refused', 'refused');
  eq(r.reasons[0], 'verifier.head_mismatch', 'reason');
  eq(w.fake.txs.length, 0, 'nothing anchored');
  await w.close();
});

test('a published chain that never reaches the on-chain head is refused even when every total adds up (verifier.head_mismatch)', async () => {
  const w = await world();
  w.addBatches(2);
  await w.settle(w.p, w.v);                                        // head = rec-000001
  /* same site, node, window and total, other evidence: another hash. A fork that renames the
     node is already stopped before signing by batch.site_mismatch (S2), so here the evidence differs. */
  const fork = forge(w, 'rec-000001', (b) => {
    b.intervals[0].source.raw_sha256 = E.sha256('elsewhere');
    b.intervals_root = E.merkleRoot(b.intervals);
  });
  buildOn(w, fork);
  w.addBatches(1);
  eq((await w.p.tick(w.clock.now())).action, 'proposed', 'proposed');
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'refused', 'refused');
  eq(r.reasons[0], 'verifier.head_mismatch', 'reason');
  assert(/without meeting the on-chain head/.test(r.detail), r.detail);
  eq(w.fake.txs.length, 2, 'nothing new anchored');
  await w.close();
});

test('an on-chain anchor without its cumulative is missing data: the verifier signs nothing (verifier.head_mismatch)', async () => {
  const w = await world();
  w.addBatches(1);
  await w.settle(w.p, w.v);
  delete w.fake.data['qwatt.cumulative_mwh'];
  w.addBatches(1);
  eq((await w.p.tick(w.clock.now())).action, 'proposed', 'proposed');
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'refused', 'refused');
  eq(r.reasons[0], 'verifier.head_mismatch', 'reason');
  eq(w.fake.txs.length, 1, 'nothing new anchored');
  await w.close();
});

(async () => {
  console.log('\nanchor recovery');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      ')); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
