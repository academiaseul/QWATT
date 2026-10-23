/**
 * QWATT anchor — tests for the real-account A–D tool and the anchoring account's thresholds
 * (offline: fake Horizon applying Stellar's signature rules, Friendbot stand-in and feed on 127.0.0.1)
 * Run: node anchor/tests-abcd.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const S = require('@stellar/stellar-sdk');
const E = require('../protocol/evidence');
const V = require('../batch/verify');
const { Pipeline } = require('../batch/pipeline');
const { Proposer } = require('./proposer');
const { Verifier } = require('./verifier');
const { FakeHorizon } = require('./fake-horizon');
const { serveDir } = require('./static-server');
const X = require('./tests-abcd');
const SETUP = require('./setup-account');

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

const clock = { now: () => Math.floor(Date.now() / 1000) };
const newKeys = () => ({ account: S.Keypair.random(), proposer: S.Keypair.random(), verifier: S.Keypair.random(), third: S.Keypair.random(), dest: S.Keypair.random() });

/** A local stand-in for Friendbot on 127.0.0.1: it creates the account on the fake network. */
async function friendbotFor(fake) {
  const srv = http.createServer((req, res) => {
    try { fake.fund(new URL(req.url, 'http://127.0.0.1').searchParams.get('addr')); res.writeHead(200); res.end('{}'); }
    catch (e) { res.writeHead(400); res.end(e.message); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  hosts.push({ close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(() => r()); }) });
  return `http://127.0.0.1:${srv.address().port}/`;
}

/** The anchoring account exactly as setup-account.js configures it (its own transaction), on the fake network. */
async function configuredAccount() {
  const K = newKeys();
  const fake = new FakeHorizon({ clock });
  const o = { ...SETUP.DEFAULTS, friendbot_url: await friendbotFor(fake), proposer: K.proposer.publicKey(), verifier: K.verifier.publicKey(), third: K.third.publicKey() };
  const { account } = await SETUP.createAndConfigure(fake, o);
  return { K, fake, o, account };
}

/** Submit; the network's result codes, or null when it landed. */
async function codesOf(fake, tx) {
  try { await fake.submitTransaction(tx); return null; }
  catch (e) { const c = e && e.response && e.response.data && e.response.data.extras && e.response.data.extras.result_codes; if (!c) throw e; return c; }
}

/** A transaction for the account under test, signed by the given keys. */
async function txFor(fake, account, ops, ...signers) {
  const b = new S.TransactionBuilder(await fake.loadAccount(account), { fee: String(S.BASE_FEE), networkPassphrase: S.Networks.TESTNET });
  for (const op of ops) b.addOperation(op);
  const tx = b.setTimeout(300).build();
  for (const k of signers) tx.sign(k);
  return tx;
}

const INT64_MAX = '9223372036854775807';

/**
 * @param {object} [acct] an account from configuredAccount(); without it, a fake preconfigured with its default thresholds
 * @param {{low:number, med:number, high:number}} [thresholds] without acct: the fake account's thresholds instead of the default
 */
async function world(acct, thresholds) {
  const K = acct ? acct.K : newKeys();
  const account = acct ? acct.account : K.account.publicKey();
  const fake = acct ? acct.fake : new FakeHorizon({ account, signers: [K.proposer.publicKey(), K.verifier.publicKey(), K.third.publicKey()], thresholds, clock });
  const cfg = { network_passphrase: S.Networks.TESTNET, horizon_url: 'http://fake', anchor_account: account, asset_code: 'native', payment_destination: K.dest.publicKey(), payment_amount: '0.0000001', base_fee: 100 };
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

/** Run A, B, D and C against the world and merge them into one evidence file, as the four hosts would. */
async function fullEvidence(w) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-abcd-ev-')), 'abcd.json');
  X.merge(file, w.cfg.anchor_account, 'a', await X.testA({ feedDir: w.feedDir, cfg: w.cfg, keypair: w.K.proposer, server: w.fake }));
  X.merge(file, w.cfg.anchor_account, 'b', await X.testB({ feedUrl: w.host.url, cfg: w.cfg, keypair: w.K.verifier, server: w.fake }));
  await w.proposer.tick();
  X.merge(file, w.cfg.anchor_account, 'd', await X.testD({ feedUrl: w.host.url, cfg: w.cfg }));
  await w.verifier.tick();
  return X.merge(file, w.cfg.anchor_account, 'c', await X.testC({ cfg: w.cfg, server: w.fake }));
}

test('A–D on an account at 1/2/3: the evidence records thresholds that do not match 2/2/3, A and B are not counted as refused, and the verdict is FAIL', async () => {
  const w = await world(null, { low: 1, med: 2, high: 3 });
  const ev = await fullEvidence(w);
  for (const k of ['A_proposer_alone', 'B_verifier_alone']) {
    const s = ev.steps[k];
    eq(s.codes.transaction, 'tx_failed', `${k}: one signature meets low 1, so the transaction itself is authorized`);
    assert((s.codes.operations || []).includes('op_bad_auth'), `${k}: op_bad_auth on the anchor: ${JSON.stringify(s.codes)}`);
    eq(JSON.stringify(s.thresholds), JSON.stringify({ low_threshold: 1, med_threshold: 2, high_threshold: 3 }), `${k}: the account's thresholds, loaded first, are in the evidence`);
    eq(s.thresholds_match, false, `${k}: thresholds do not match 2/2/3`);
    eq(s.refused, false, `${k}: not counted as refused`);
  }
  eq(ev.verdict, 'FAIL', 'A–D verdict for a 1/2/3 account');
  await w.host.close();
});

test('A–D on an account at 2/2/3: A and B are refused as tx_bad_auth with the thresholds recorded as matching, and the verdict is PASS', async () => {
  const w = await world(null, { low: 2, med: 2, high: 3 });
  const ev = await fullEvidence(w);
  for (const k of ['A_proposer_alone', 'B_verifier_alone']) {
    const s = ev.steps[k];
    eq(JSON.stringify(s.codes), JSON.stringify({ transaction: 'tx_bad_auth' }), `${k}: codes`);
    eq(JSON.stringify(s.thresholds), JSON.stringify({ low_threshold: 2, med_threshold: 2, high_threshold: 3 }), `${k}: the account's thresholds, loaded first, are in the evidence`);
    eq(s.thresholds_match, true, `${k}: thresholds match 2/2/3`);
    eq(s.refused, true, `${k}: refused`);
  }
  eq(ev.verdict, 'PASS', 'A–D verdict for a 2/2/3 account');
  await w.host.close();
});

/* ── the anchoring account's thresholds (low 2 / medium 2 / high 3) ──────────
 * Every account below is configured by setup-account.js's own transaction, and
 * the fake network applies Stellar's signature rules (anchor/fake-horizon.js). */

test('the fake network applies Stellar\'s signature rules: under 1/2/3 one key alone can bump the sequence and void a co-signed anchor; under 2/2/3 one key alone cannot send anything', async () => {
  const K = newKeys(), account = K.account.publicKey();
  const signers = [K.proposer.publicKey(), K.verifier.publicKey(), K.third.publicKey()];
  const data = S.Operation.manageData({ name: 'qwatt.anchor.sha256', value: 'a'.repeat(64) });

  const old = new FakeHorizon({ account, signers, thresholds: { low: 1, med: 2, high: 3 }, clock });
  eq(JSON.stringify(await codesOf(old, await txFor(old, account, [data], K.third))), JSON.stringify({ transaction: 'tx_failed', operations: ['op_bad_auth'] }), '1/2/3: one key meets low, the anchor needs medium');
  const pending = await txFor(old, account, [data], K.proposer, K.verifier);           // a co-signed anchor, not yet submitted
  eq(await codesOf(old, await txFor(old, account, [S.Operation.bumpSequence({ bumpTo: INT64_MAX })], K.third)), null, '1/2/3: the third key alone bumps the sequence');
  eq(String(old.sequence), INT64_MAX, 'sequence at its maximum: the account can send nothing more');
  eq((await codesOf(old, pending)).transaction, 'tx_bad_seq', 'the co-signed anchor is void');

  const now = new FakeHorizon({ account, signers, thresholds: { low: 2, med: 2, high: 3 }, clock });
  eq(JSON.stringify(await codesOf(now, await txFor(now, account, [data], K.third))), JSON.stringify({ transaction: 'tx_bad_auth' }), '2/2/3: one key does not meet low');
  eq(await codesOf(now, await txFor(now, account, [data], K.proposer, K.verifier)), null, '2/2/3: two keys anchor');
});

test('the anchoring account is set up with thresholds 2/2/3 and setup --verify requires them', async () => {
  const a = await configuredAccount();
  const acct = await a.fake.loadAccount(a.account);
  eq(JSON.stringify(acct.thresholds), JSON.stringify({ low_threshold: 2, med_threshold: 2, high_threshold: 3 }), 'thresholds set by setup-account.js');
  eq(acct.signers.find((s) => s.key === a.account).weight, 0, 'master weight');
  eq(acct.signers.filter((s) => s.key !== a.account && s.weight === 1).length, 3, 'three signers of weight 1');
  a.fake.credit(a.o.asset_code, a.o.asset_issuer, a.o.funding_amount);                 // the treasury's funding payment
  const v = await SETUP.verifyAccount(a.fake, a.o, a.account);
  assert(v.ok, `--verify passes: ${JSON.stringify(v.checks)}`);
  assert(v.checks.some((c) => c.ok && c.name === 'thresholds 2/2/3'), `--verify names the 2/2/3 check: ${JSON.stringify(v.checks.map((c) => c.name))}`);
  a.fake.thresholds.low = 1;                                                            // the same account left at 1/2/3
  const w = await SETUP.verifyAccount(a.fake, a.o, a.account);
  eq(w.ok, false, '--verify refuses an account at 1/2/3');
  eq(JSON.stringify(w.checks.filter((c) => !c.ok).map((c) => c.name)), JSON.stringify(['thresholds 2/2/3']), 'only the thresholds check fails');
});

test('one key alone cannot send any transaction for the anchoring account: a BumpSequence signed by one key is rejected (tx_bad_auth) and the sequence does not move', async () => {
  const a = await configuredAccount();
  const kinds = {
    bumpSequence: () => S.Operation.bumpSequence({ bumpTo: INT64_MAX }),
    manageData: () => S.Operation.manageData({ name: 'qwatt.anchor.sha256', value: 'b'.repeat(64) }),
    payment: () => S.Operation.payment({ destination: a.K.dest.publicKey(), asset: S.Asset.native(), amount: '0.0000001' }),
  };
  for (const who of ['proposer', 'verifier', 'third']) {
    for (const [kind, op] of Object.entries(kinds)) {
      const seq0 = String(a.fake.sequence), n0 = a.fake.txs.length;
      const codes = await codesOf(a.fake, await txFor(a.fake, a.account, [op()], a.K[who]));
      eq(JSON.stringify(codes), JSON.stringify({ transaction: 'tx_bad_auth' }), `${kind} signed by the ${who} key alone`);
      eq(String(a.fake.sequence), seq0, `${kind} by the ${who} key: sequence unchanged`);
      eq(a.fake.txs.length, n0, `${kind} by the ${who} key: nothing landed`);
    }
  }
});

test('tests A and B are rejected with tx_bad_auth under 2/2/3', async () => {
  const w = await world(await configuredAccount());
  const seq0 = String(w.fake.sequence);
  const a = await X.testA({ feedDir: w.feedDir, cfg: w.cfg, keypair: w.K.proposer, server: w.fake });
  eq(JSON.stringify(a.codes), JSON.stringify({ transaction: 'tx_bad_auth' }), 'A: proposer alone');
  assert(a.refused, 'A recorded as refused');
  const b = await X.testB({ feedUrl: w.host.url, cfg: w.cfg, keypair: w.K.verifier, server: w.fake });
  eq(JSON.stringify(b.codes), JSON.stringify({ transaction: 'tx_bad_auth' }), 'B: verifier alone');
  assert(b.refused, 'B recorded as refused');
  eq(String(w.fake.sequence), seq0, 'sequence untouched');
  await w.host.close();
});

test('two keys still anchor a batch: proposer + verifier, then third signer + verifier', async () => {
  const w = await world(await configuredAccount());
  await w.proposer.tick();
  eq((await w.verifier.tick()).action, 'anchored', 'proposer + verifier');
  const viaThird = new Proposer({ feedDir: w.feedDir, cfg: w.cfg, keypair: w.K.third, server: w.fake });
  eq((await viaThird.tick()).action, 'proposed', 'the third signer proposes the next batch');
  eq((await w.verifier.tick()).action, 'anchored', 'third signer + verifier');
  const c = await X.testC({ cfg: w.cfg, server: w.fake });
  eq(c.signatures, 2, 'two signatures');
  eq(c.memo, 'QW#1', 'the second batch');
  await w.host.close();
});

test('changing signers still needs all three keys', async () => {
  const a = await configuredAccount();
  const add = () => S.Operation.setOptions({ signer: { ed25519PublicKey: S.Keypair.random().publicKey(), weight: 1 } });
  const lower = () => S.Operation.setOptions({ lowThreshold: 1 });
  for (const [x, y] of [['proposer', 'verifier'], ['proposer', 'third'], ['verifier', 'third']]) {
    for (const [what, op] of [['add a signer', add], ['change a threshold', lower]]) {
      const codes = await codesOf(a.fake, await txFor(a.fake, a.account, [op()], a.K[x], a.K[y]));
      eq(JSON.stringify(codes), JSON.stringify({ transaction: 'tx_failed', operations: ['op_bad_auth'] }), `${x} + ${y} cannot ${what}`);
    }
  }
  eq(a.fake.signers.length, 3, 'still three signers');
  eq(await codesOf(a.fake, await txFor(a.fake, a.account, [add()], a.K.proposer, a.K.verifier, a.K.third)), null, 'all three keys add a signer');
  eq(a.fake.signers.length, 4, 'the signer was added');
});

(async () => {
  console.log('\nanchor tests A–D (real-account tool) and the anchoring account\'s thresholds');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      ')); }
  }
  await Promise.all(hosts.map((h) => h.close().catch(() => {})));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
