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
const { spawnSync } = require('child_process');
const S = require('@stellar/stellar-sdk');
const E = require('../protocol/evidence');
const V = require('../batch/verify');
const T = require('./tx');
const C = require('./chain');
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
function iv(i, o = {}) {
  const t = T0 + i * DT * 1000;
  const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
  return {
    spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION,
    site_id: 'rec', node_id: o.node_id ?? 'rec', seq: i,
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
function buildOn(w, b) { w.pipe.asm.prev = b; w.pipe.asm.prev_hash = b.sha256; w.pipe.asm.cumulative_mwh = b.cumulative_mwh; }

/** The next batch after `prev`, every derived field recomputed the way a forger would. */
function nextBatch(prev, intervals, o = {}) {
  const seq = prev.seq + 1, energy = intervals.reduce((s, r) => s + E.basisMwh(r), 0);
  const b = {
    batch_id: E.batchId(prev.site_id, seq), site_id: prev.site_id, node_id: prev.node_id, seq,
    ts_start: o.ts_start ?? intervals[0].ts_start, ts_end: o.ts_end ?? intervals[intervals.length - 1].ts_end,
    spec_version: prev.spec_version, schema_version: prev.schema_version,
    interval_count: intervals.length, accepted_count: intervals.length, rejected_count: 0,
    intervals, intervals_root: E.merkleRoot(intervals), energy_mwh: energy, cumulative_mwh: o.cumulative_mwh ?? prev.cumulative_mwh + energy, prev_hash: prev.sha256,
  };
  b.sha256 = E.batchSha256(b);
  return b;
}

/** A proposer that signs whatever it is told to: the pending anchor for `batch`, published next to the feed. */
async function propose(w, batch) {
  const head = await C.getHead(w.fake, w.cfg.anchor_account);
  const tx = T.buildAnchorTx(batch, w.cfg, T.proposalParams(head.sequence, w.clock.now()));
  tx.sign(w.keys.proposer);
  fs.mkdirSync(path.join(w.feedDir, 'pending'), { recursive: true });
  fs.writeFileSync(path.join(w.feedDir, 'pending', `${batch.batch_id}.xdr`), tx.toEnvelope().toXDR('base64') + '\n');
}

/** The honest proposer runs the verifier's walk over its own feed, so it blocks what the verifier would
    refuse, with the same code. Then a proposer that signs anyway publishes the proposal for `id`. */
async function blockedThenForced(w, id, code) {
  const r = await w.p.tick(w.clock.now());
  eq(r.action, 'blocked', 'the proposer runs the same walk and does not propose it');
  eq((r.reasons || [])[0], code, 'the proposer gives the verifier\'s reason');
  assert(!fs.existsSync(path.join(w.feedDir, 'pending', `${id}.xdr`)), 'nothing proposed');
  await propose(w, w.pipe.feed.readBatch(id));
}

/** A window of nothing but refused replays: an empty batch, the same total under any rule. */
function addEmptyBatch(w) { const last = w.pipe.feed.readBatch(w.pipe.head().latest_batch_id).intervals.slice(-1)[0]; for (let i = 0; i < 12; i++) w.pipe.push(last); }

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

test('a batch whose inherited total does not match the on-chain head: the proposer blocks it and the verifier refuses it (verifier.head_mismatch)', async () => {
  const w = await world();
  w.addBatches(3);
  await w.settle(w.p, w.v);
  w.invariant();                                                   // honest chain anchored; head = rec-000002
  const total = onchainTotal(w);
  const forged = forge(w, 'rec-000002', (b) => { b.cumulative_mwh += 1000000; });   // inflated, rehashed
  buildOn(w, forged);
  w.addBatches(1);                                                 // rec-000003 inherits the inflated total
  await blockedThenForced(w, 'rec-000003', 'verifier.head_mismatch');
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'refused', 'verifier refuses to co-sign');
  assert((r.reasons || []).includes('verifier.head_mismatch'), `reasons: ${JSON.stringify(r.reasons)}`);
  eq(w.fake.txs.length, 3, 'nothing new anchored');
  eq(onchainTotal(w), total, 'on-chain cumulative unchanged');
  await w.close();
});

test('a batch published as rejected carries the total forward unchanged: the walk passes through it and the on-chain total is the energy of accepted batches only (verifier.head_mismatch)', async () => {
  let w = await world();
  w.addBatches(1);
  await w.settle(w.p, w.v);                                        // head = rec-000000
  w.addBatches(1);
  const refused = forge(w, 'rec-000001', (b) => { b.cumulative_mwh -= b.energy_mwh; });   // published, never anchored, carries no energy
  markRejected(w, 1, ['batch.spec_mismatch'], refused.sha256);
  buildOn(w, refused);
  w.addBatches(1);
  await w.settle(w.p, w.v);
  w.invariant();                                                   // QW#0 then QW#2
  const [b0, b2] = ['rec-000000', 'rec-000002'].map((id) => w.pipe.feed.readBatch(id));
  eq(onchainTotal(w), String(b0.energy_mwh + b2.energy_mwh), 'on-chain total = energy of the accepted batches');
  assert(!fs.existsSync(path.join(w.stateDir, 'refusals.jsonl')), 'no refusal on an honest chain');
  await w.close();

  /* a refused batch that re-sends the anchored intervals and still adds their energy */
  w = await world();
  w.addBatches(1);
  await w.settle(w.p, w.v);
  const a0 = w.pipe.feed.readBatch('rec-000000');
  const a1 = nextBatch(a0, JSON.parse(JSON.stringify(a0.intervals)));
  w.pipe.feed.publish({ batch: a1, status: 'rejected', reasons: ['batch.interval_repeated'] });
  const a2 = nextBatch(a1, Array.from({ length: 12 }, (_, k) => iv(12 + k)));
  w.pipe.feed.publish({ batch: a2, status: 'accepted', reasons: [] });
  await propose(w, a2);
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'refused', 'refused');
  eq(r.reasons[0], 'verifier.head_mismatch', 'reason');
  eq(onchainTotal(w), String(a0.cumulative_mwh), 'the refused energy never reaches the chain');
  await w.close();
});

test('a batch published as rejected with an earlier window never lowers the floor: the verifier will not anchor the same intervals twice (batch.interval_repeated)', async () => {
  const w = await world();
  w.addBatches(1);
  await w.settle(w.p, w.v);                                        // head = rec-000000
  const b0 = w.pipe.feed.readBatch('rec-000000');
  const hourBefore = new Date(T0 - 3600e3).toISOString();
  const b1 = nextBatch(b0, [], { ts_start: hourBefore, ts_end: hourBefore });   // empty, an hour before rec-000000: really refused
  w.pipe.feed.publish({ batch: b1, status: 'rejected', reasons: ['batch.interval_overlap'] });
  const b2 = nextBatch(b1, JSON.parse(JSON.stringify(b0.intervals)));            // rec-000000's intervals again
  w.pipe.feed.publish({ batch: b2, status: 'accepted', reasons: [] });
  eq((await w.p.tick(w.clock.now())).action, 'blocked', 'the proposer does not propose it');
  await propose(w, b2);                                            // a proposer that signs anyway
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'refused', 'refused');
  assert((r.reasons || []).includes('batch.interval_repeated'), JSON.stringify(r.reasons));
  eq(w.fake.txs.length, 1, 'rec-000000 anchored once, never twice');
  await w.close();
});

test('the verifier downloads each earlier batch once and judges the batch against that same rehashed copy (verifier.head_mismatch)', async () => {
  const w = await world();
  w.addBatches(1);
  await w.settle(w.p, w.v);
  const b0 = w.pipe.feed.readBatch('rec-000000');
  const b1 = nextBatch(b0, JSON.parse(JSON.stringify(b0.intervals)));
  w.pipe.feed.publish({ batch: b1, status: 'accepted', reasons: [] });
  await propose(w, b1);
  /* a feed host that serves a rewritten rec-000000 (ends in 1970, no intervals) on the first request only */
  const rewritten = Object.assign(JSON.parse(JSON.stringify(b0)), { ts_end: '1970-01-01T00:00:00.000Z', intervals: [] });
  const real = w.v.feed.batch.bind(w.v.feed);
  let served = 0;
  w.v.feed.batch = async (id) => (id === 'rec-000000' && served++ === 0 ? rewritten : real(id));
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'refused', 'refused');
  eq(r.reasons[0], 'verifier.head_mismatch', 'reason');
  eq(served, 1, 'rec-000000 downloaded once');
  eq(w.fake.txs.length, 1, 'the same intervals are never anchored twice');
  await w.close();
});

test('a walk longer than the bound has its own code: the proposer blocks, the verifier refuses and never signs, and both anchor once within it (verifier.walk_too_long)', async () => {
  const w = await world();
  w.addBatches(1);
  await w.settle(w.p, w.v);
  addEmptyBatch(w);
  w.addBatches(1);
  markRejected(w, 1, ['batch.spec_mismatch']);                     // rec-000002 is two batches from the head
  const short = new Proposer({ feedDir: w.feedDir, cfg: w.cfg, keypair: w.keys.proposer, server: w.fake, maxWalk: 1 });
  const pb = await short.tick(w.clock.now());
  eq(pb.action, 'blocked', 'a proposer bounded at 1 does not propose');
  eq((pb.reasons || [])[0], 'verifier.walk_too_long', 'proposer reason');
  assert(!fs.existsSync(path.join(w.feedDir, 'pending', 'rec-000002.xdr')), 'nothing proposed beyond the bound');
  eq((await w.p.tick(w.clock.now())).action, 'proposed', 'proposed within the default bound');
  const r = await w.mkVerifier({ maxWalk: 1 }).tick(w.clock.now());
  eq(r.action, 'refused', 'refused beyond the bound');
  eq(r.reasons[0], 'verifier.walk_too_long', 'reason');
  assert(/more than 1 /.test(r.detail), r.detail);
  eq(w.fake.txs.length, 1, 'nothing anchored beyond the bound');
  await w.settle(w.p, w.v);                                        // the default bound reaches the head
  w.invariant();
  await w.close();
});

test('genesis: with nothing anchored yet, an inherited total that does not start from zero is blocked by the proposer and refused by the verifier (verifier.head_mismatch)', async () => {
  const w = await world();
  w.addBatches(1);
  const forged = forge(w, 'rec-000000', (b) => { b.cumulative_mwh += 1000000; });
  markRejected(w, 0, ['batch.cumulative_mismatch'], forged.sha256);   // never anchored itself
  buildOn(w, forged);
  w.addBatches(1);                                                 // rec-000001, the first accepted batch
  await blockedThenForced(w, 'rec-000001', 'verifier.head_mismatch');
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'refused', 'refused');
  eq(r.reasons[0], 'verifier.head_mismatch', 'reason');
  eq(w.fake.txs.length, 0, 'nothing anchored');
  await w.close();
});

test('a published chain that never reaches the on-chain head is blocked by the proposer and refused by the verifier even when every total adds up (verifier.head_mismatch)', async () => {
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
  await blockedThenForced(w, 'rec-000002', 'verifier.head_mismatch');
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'refused', 'refused');
  eq(r.reasons[0], 'verifier.head_mismatch', 'reason');
  assert(/without meeting the on-chain head/.test(r.detail), r.detail);
  eq(w.fake.txs.length, 2, 'nothing new anchored');
  await w.close();
});

test('an on-chain anchor without its cumulative is missing data: the proposer proposes nothing and the verifier signs nothing (verifier.head_mismatch)', async () => {
  const w = await world();
  w.addBatches(1);
  await w.settle(w.p, w.v);
  delete w.fake.data['qwatt.cumulative_mwh'];
  w.addBatches(1);
  await blockedThenForced(w, 'rec-000001', 'verifier.head_mismatch');
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'refused', 'refused');
  eq(r.reasons[0], 'verifier.head_mismatch', 'reason');
  eq(w.fake.txs.length, 1, 'nothing new anchored');
  await w.close();
});

/* ── the walk bound: a long run of batch-level rejections is a liveness problem, not tampering ── */

test('past the walk bound (a node_id wrong for a week, then put back) the proposer blocks with the verifier\'s code instead of proposing what the verifier refuses forever; --max-walk on both sides lets it anchor (verifier.walk_too_long)', async () => {
  const w = await world();
  w.addBatches(1);
  await w.settle(w.p, w.v);                                        // head = rec-000000
  const N = C.MAX_WALK_BATCHES;
  /* restarted with a wrong node_id: every batch is judged against the last accepted one and published as rejected */
  const wrong = new Pipeline({ dir: w.feedDir, site_id: 'rec', node_id: 'rec-new' });
  for (let i = 12; i < 12 + 12 * N; i++) wrong.push(iv(i, { node_id: 'rec-new' }));
  const right = new Pipeline({ dir: w.feedDir, site_id: 'rec', node_id: 'rec' });   // the identity put back
  for (let i = 12 + 12 * N; i < 24 + 12 * N; i++) right.push(iv(i));
  const led = right.feed.readLedger('batches');
  eq(led.filter((e) => e.status === 'rejected').length, N, 'batches published as rejected');
  const tail = led[led.length - 1];
  eq(tail.status, 'accepted', 'the batch after them is accepted');
  const pendingFile = path.join(w.feedDir, 'pending', `${tail.batch_id}.xdr`);

  const pr = await w.p.tick(w.clock.now());
  eq(pr.action, 'blocked', 'the proposer runs the verifier\'s walk and does not propose');
  eq((pr.reasons || [])[0], 'verifier.walk_too_long', 'its own code, not a tampering code');
  assert(!fs.existsSync(pendingFile), 'nothing proposed');
  await propose(w, right.feed.readBatch(tail.batch_id));          // a proposer that signs anyway
  const r = await w.v.tick(w.clock.now());
  eq(r.action, 'refused', 'the verifier refuses');
  eq((r.reasons || [])[0], 'verifier.walk_too_long', 'the same code on both sides');
  assert(/--max-walk/.test(r.detail || ''), `the refusal names the way out: ${r.detail}`);
  eq(w.fake.txs.length, 1, 'never signed beyond the bound');
  fs.unlinkSync(pendingFile);

  /* the operator's way out: N rejected batches and the head are N + 1 downloads */
  const proposerAt = (n) => new Proposer({ feedDir: w.feedDir, cfg: w.cfg, keypair: w.keys.proposer, server: w.fake, maxWalk: n });
  eq((await proposerAt(N).tick(w.clock.now())).action, 'blocked', `max walk ${N} is one batch short`);
  eq((await proposerAt(N + 1).tick(w.clock.now())).action, 'proposed', `max walk ${N + 1} proposes`);
  eq((await w.mkVerifier({ maxWalk: N + 1 }).tick(w.clock.now())).action, 'anchored', 'and the verifier with the same bound signs');
  const [b0, bt] = ['rec-000000', tail.batch_id].map((id) => right.feed.readBatch(id));
  eq(JSON.stringify(w.fake.txs.map((t) => t.memo)), JSON.stringify(['QW#0', `QW#${tail.seq}`]), 'each accepted batch anchored once');
  eq(onchainTotal(w), String(b0.energy_mwh + bt.energy_mwh), 'on-chain total = energy of the anchored batches');
  await w.close();
});

test('--max-walk: both CLIs read it, and anything but a whole number of batches (at least 1) stops them before they start', async () => {
  eq(C.maxWalkArg(['--feed', 'x', '--max-walk', '300']), 300, 'parsed');
  eq(C.maxWalkArg(['--feed', 'x']), undefined, 'absent: the default bound applies');
  for (const bad of [['--max-walk', '0'], ['--max-walk', '-5'], ['--max-walk', '1.5'], ['--max-walk', 'abc'], ['--max-walk']]) {
    let msg = '';
    try { C.maxWalkArg(bad); } catch (e) { msg = e.message; }
    assert(/--max-walk/.test(msg), `${bad.join(' ')} is refused`);
  }
  const env = { ...process.env };
  delete env.QWATT_PROPOSER_SECRET; delete env.QWATT_VERIFIER_SECRET;
  for (const cli of ['proposer.js', 'verifier.js']) {
    const r = spawnSync(process.execPath, [path.join(__dirname, cli), '--feed', 'http://127.0.0.1:9', '--max-walk', 'abc', '--once'], { env, encoding: 'utf8', timeout: 30000 });
    eq(r.status, 2, `${cli} exits 2`);
    assert(/--max-walk/.test(r.stderr), `${cli} names the flag: ${r.stderr.trim()}`);
  }
});

/* ── a lagging Horizon: the stale-read guarantee is the sequence check plus Stellar's sequence rule ── */

test('a lagging Horizon head: whatever the verifier co-signs on a stale head carries a stale sequence, the network refuses it (tx_bad_seq), and nothing is counted twice', async () => {
  const w = await world();
  w.addBatches(1);
  await w.settle(w.p, w.v);                                        // head = rec-000000
  w.addBatches(1);
  eq((await w.p.tick(w.clock.now())).action, 'proposed', 'rec-000001 proposed');
  const pendingFile = path.join(w.feedDir, 'pending', 'rec-000001.xdr');
  const pendingXdr = fs.readFileSync(pendingFile, 'utf8');
  const snapshot = JSON.parse(JSON.stringify(await w.fake.loadAccount(w.cfg.anchor_account)));
  eq((await w.v.tick(w.clock.now())).action, 'anchored', 'rec-000001 anchored');
  const before = w.fake.submissions;
  /* a Horizon that keeps serving the account as it was before rec-000001 landed */
  const stale = Object.create(w.fake);
  stale.loadAccount = async () => JSON.parse(JSON.stringify(snapshot));
  /* 1. the old proposal, still on the feed */
  fs.writeFileSync(pendingFile, pendingXdr);
  const r1 = await w.mkVerifier({ server: stale }).tick(w.clock.now());
  /* 2. a sibling of rec-000001 that re-counts its time, served through a feed that rewrites its ledger line */
  const [b0, b1] = ['rec-000000', 'rec-000001'].map((id) => w.pipe.feed.readBatch(id));
  const sib = nextBatch(b0, JSON.parse(JSON.stringify(b1.intervals)).map((r) => Object.assign(r, { source: { ...r.source, raw_sha256: E.sha256('stale-' + r.seq) } })));
  const staleHead = await C.getHead(stale, w.cfg.anchor_account);
  const tx = T.buildAnchorTx(sib, w.cfg, T.proposalParams(staleHead.sequence, w.clock.now()));
  tx.sign(w.keys.proposer);
  fs.writeFileSync(pendingFile, tx.toEnvelope().toXDR('base64') + '\n');
  const v2 = w.mkVerifier({ server: stale });
  v2.feed.batch = async (id) => (id === 'rec-000001' ? JSON.parse(JSON.stringify(sib)) : w.pipe.feed.readBatch(id));
  v2.feed.batches = async () => w.pipe.feed.readLedger('batches').map((e) => (e.batch_id === 'rec-000001' ? { ...e, sha256: sib.sha256 } : e));
  const r2 = await v2.tick(w.clock.now());
  for (const [n, r] of [['the old proposal', r1], ['the sibling', r2]]) {
    assert(r.action !== 'anchored', `${n}: ${r.action}`);
    if (r.action === 'submit_failed') assert(/tx_bad_seq/.test(JSON.stringify(r.codes)), `${n}: ${JSON.stringify(r.codes)}`);
  }
  assert(stale.submissions - before <= 2, 'at most one submission each');
  eq(w.fake.txs.length, 2, 'still two anchors');
  w.invariant();
  eq(onchainTotal(w), String(b0.energy_mwh + b1.energy_mwh), 'on-chain total = energy of the anchored batches, nothing counted twice');
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
