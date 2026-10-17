/**
 * QWATT anchor — tests for the real-account A–D tool (offline: fake Horizon, local feed)
 * Run: node anchor/tests-abcd.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const S = require('@stellar/stellar-sdk');
const E = require('../protocol/evidence');
const V = require('../batch/verify');
const { Pipeline } = require('../batch/pipeline');
const { Proposer } = require('./proposer');
const { Verifier } = require('./verifier');
const { FakeHorizon } = require('./fake-horizon');
const { serveDir } = require('./static-server');
const X = require('./tests-abcd');

let passed = 0, failed = 0;
const hosts = [];   // every test server, closed at the end even when a test fails
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const DT = 300, T0 = Date.parse('2026-09-20T15:00:00Z');
const iv = (i) => {
  const t = T0 + i * DT * 1000;
  const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
  return { spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION, site_id: 'abcd', node_id: 'abcd', seq: i,
    ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
    meters: { a: m('a', 100), b: m('b', 99) }, source: { adapter: 'simulator', raw_sha256: E.sha256('abcd-' + i) } };
};

async function world() {
  const K = { account: S.Keypair.random(), proposer: S.Keypair.random(), verifier: S.Keypair.random(), third: S.Keypair.random(), dest: S.Keypair.random() };
  const fake = new FakeHorizon({ account: K.account.publicKey(), signers: [K.proposer.publicKey(), K.verifier.publicKey(), K.third.publicKey()], clock: { now: () => Math.floor(Date.now() / 1000) } });
  const cfg = { network_passphrase: S.Networks.TESTNET, horizon_url: 'http://fake', anchor_account: K.account.publicKey(), asset_code: 'native', payment_destination: K.dest.publicKey(), payment_amount: '0.0000001', base_fee: 100 };
  const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-abcd-'));
  const pipe = new Pipeline({ dir: feedDir, site_id: 'abcd', node_id: 'abcd' });
  for (let i = 0; i < 36; i++) pipe.push(iv(i));
  const host = await serveDir(feedDir);
  hosts.push(host);
  const proposer = new Proposer({ feedDir, cfg, keypair: K.proposer, server: fake });
  const verifier = new Verifier({ feedUrl: host.url, cfg, keypair: K.verifier, stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-abcd-v-')), server: fake });
  return { K, fake, cfg, feedDir, host, proposer, verifier };
}
const tree = (dir) => {
  const h = crypto.createHash('sha256');
  const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else h.update(n).update(fs.readFileSync(p)); } };
  walk(dir);
  return h.digest('hex');
};

test('A: the proposer-signed transaction alone is refused by the network, and consumes nothing', async () => {
  const w = await world();
  const seq0 = w.fake.sequence;
  const r = await X.testA({ feedDir: w.feedDir, cfg: w.cfg, keypair: w.K.proposer, server: w.fake });
  assert(r.refused, `refused: ${JSON.stringify(r.codes)}`);
  eq(r.signatures, 1, 'one signature');
  eq(String(w.fake.sequence), String(seq0), 'sequence untouched');
  eq(w.fake.txs.length, 0, 'nothing landed');
  await w.host.close();
});

test('B: the verifier-signed transaction alone is refused by the network', async () => {
  const w = await world();
  const r = await X.testB({ feedUrl: w.host.url, cfg: w.cfg, keypair: w.K.verifier, server: w.fake });
  assert(r.refused, `refused: ${JSON.stringify(r.codes)}`);
  eq(w.fake.txs.length, 0, 'nothing landed');
  await w.host.close();
});

test('A and B do not disturb the running pipeline: it anchors normally right after', async () => {
  const w = await world();
  await X.testA({ feedDir: w.feedDir, cfg: w.cfg, keypair: w.K.proposer, server: w.fake });
  await X.testB({ feedUrl: w.host.url, cfg: w.cfg, keypair: w.K.verifier, server: w.fake });
  await w.proposer.tick();
  eq((await w.verifier.tick()).action, 'anchored', 'pipeline still anchors');
  await w.host.close();
});

test('C: finds the latest anchoring transaction and confirms two signatures', async () => {
  const w = await world();
  await w.proposer.tick(); await w.verifier.tick();
  const r = await X.testC({ cfg: w.cfg, server: w.fake });
  assert(r.ok, JSON.stringify(r));
  eq(r.signatures, 2, 'two signatures');
  eq(r.memo, 'QW#0', 'the first batch');
  await w.host.close();
});

test('D: an in-memory forgery is refused, and the published feed is not touched', async () => {
  const w = await world();
  await w.proposer.tick();                                             // a pending proposal exists in the feed
  const before = tree(w.feedDir);
  const r = await X.testD({ feedUrl: w.host.url, cfg: w.cfg });
  assert(r.refused, JSON.stringify(r));
  eq(r.reasons[0], 'verifier.hash_mismatch', 'reason');
  eq(tree(w.feedDir), before, 'feed byte-identical after the test');
  eq(w.fake.submissions, 0, 'nothing submitted');
  await w.host.close();
});

test('evidence merges per host into one file the write-up reads, with an overall verdict', async () => {
  const w = await world();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-abcd-ev-')), 'abcd.json');
  X.merge(file, w.cfg.anchor_account, 'a', await X.testA({ feedDir: w.feedDir, cfg: w.cfg, keypair: w.K.proposer, server: w.fake }));
  eq(JSON.parse(fs.readFileSync(file, 'utf8')).verdict, 'INCOMPLETE', 'partial');
  X.merge(file, w.cfg.anchor_account, 'b', await X.testB({ feedUrl: w.host.url, cfg: w.cfg, keypair: w.K.verifier, server: w.fake }));
  await w.proposer.tick();
  X.merge(file, w.cfg.anchor_account, 'd', await X.testD({ feedUrl: w.host.url, cfg: w.cfg }));
  await w.verifier.tick();
  const ev = X.merge(file, w.cfg.anchor_account, 'c', await X.testC({ cfg: w.cfg, server: w.fake }));
  eq(ev.verdict, 'PASS', 'all four');
  for (const k of ['A_proposer_alone', 'B_verifier_alone', 'C_proposer_plus_verifier', 'D_altered_after_proposer_signed']) assert(ev.steps[k], k);
  await w.host.close();
});

(async () => {
  console.log('\nanchor tests A–D (real-account tool)');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      ')); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
