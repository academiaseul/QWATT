/**
 * QWATT anchor — keys without a browser (freeze v3, V3-8): the services and tools sign through
 * stellar-cli on their own host, and Node never reads a secret.
 * Run: node anchor/keys.test.js     (offline: a fake stellar-cli, test-fixtures/fake-stellar-cli.js)
 *
 * Every test loads ./signer inside its own body, so a missing module fails each test on its own.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const S = require('@stellar/stellar-sdk');
const { derive } = require('./test-fixtures/fake-stellar-cli');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const FIXTURE = path.join(__dirname, 'test-fixtures', 'fake-stellar-cli.js');
const TESTNET = S.Networks.TESTNET;
const SECRET_RE = /S[A-Z2-7]{55}/;

/* one salt per run: the fake derives each identity's key from it; no secret string exists anywhere */
process.env.FAKE_STELLAR_SALT = crypto.randomBytes(16).toString('hex');
const keyOf = (id) => derive(process.env.FAKE_STELLAR_SALT, id);

/** A fresh, empty argv log for the fake stellar-cli; returns a reader. */
function freshLog() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-keys-')), 'argv.jsonl');
  process.env.FAKE_STELLAR_LOG = file;
  return () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
}

/** cliSigner over the fake stellar-cli, run with this Node. */
const fakeSigner = (identity, o = {}) => require('./signer').cliSigner({ identity, passphrase: TESTNET, command: process.execPath, commandArgs: [FIXTURE], ...o });

/** An offline transaction (never submitted). */
function sampleTx() {
  const src = new S.Account(S.Keypair.random().publicKey(), '41');
  return new S.TransactionBuilder(src, { fee: String(S.BASE_FEE), networkPassphrase: TESTNET })
    .addOperation(S.Operation.manageData({ name: 'qwatt.anchor.sha256', value: Buffer.from('a'.repeat(64), 'ascii') }))
    .addMemo(S.Memo.text('QW#0'))
    .setTimeout(300)
    .build();
}
const verifies = (kp, tx, sig) => kp.signatureHint().equals(sig.hint()) && kp.verify(tx.hash(), sig.signature());

async function rejects(p, cls, w) {
  let err = null;
  try { await p; } catch (e) { err = e; }
  assert(err, `${w}: expected a rejection, got a result`);
  assert(err instanceof cls, `${w}: expected ${cls.name}, got ${err && err.constructor && err.constructor.name}: ${err && err.message}`);
  return err;
}
function throwsSync(fn, cls, w) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert(err, `${w}: expected a throw`);
  assert(err instanceof cls, `${w}: expected ${cls.name}, got ${err && err.constructor && err.constructor.name}: ${err && err.message}`);
  return err;
}

test('cliSigner: stellar-cli signs, the identity name is the only key argument and the XDR goes in on stdin; the result is the same transaction with one more signature, from the identity\'s key', async () => {
  const log = freshLog();
  const proposer = await fakeSigner('qwatt-proposer').init();
  eq(proposer.kind, 'stellar-cli', 'kind');
  eq(proposer.publicKey, keyOf('qwatt-proposer').publicKey(), 'public key resolved through `stellar keys address`');
  const tx = sampleTx();
  const signed = await proposer.sign(tx);
  const calls = log();
  eq(JSON.stringify(calls.find((a) => a[0] === 'tx')), JSON.stringify(['tx', 'sign', '--sign-with-key', 'qwatt-proposer', '--network-passphrase', TESTNET]), 'tx sign argv: no file argument, so the XDR went in on stdin');
  eq(JSON.stringify(calls.find((a) => a[0] === 'keys')), JSON.stringify(['keys', 'address', 'qwatt-proposer']), 'the address lookup');
  for (const a of calls.flat()) {
    assert(!SECRET_RE.test(a), `no secret in argv: ${a}`);
    assert(a !== '--sign-with-lab' && a !== '--sign-with-ledger', `no browser or device signing: ${a}`);
  }
  assert(signed.hash().equals(tx.hash()), 'the same transaction');
  eq(signed.signatures.length, 1, 'one signature');
  assert(verifies(keyOf('qwatt-proposer'), signed, signed.signatures[0]), 'signed by the identity\'s key');

  const cosigned = await (await fakeSigner('qwatt-verifier').init()).sign(signed);
  eq(cosigned.signatures.length, 2, 'co-signed: two signatures');
  assert(cosigned.signatures[0].toXDR().equals(signed.signatures[0].toXDR()), 'the first signature is byte-identical');
  assert(verifies(keyOf('qwatt-verifier'), cosigned, cosigned.signatures[1]), 'the second is the verifier identity\'s');
});

test('cliSigner refuses a secret key or a seed phrase as --sign-with-key before running anything', async () => {
  const { SignerError } = require('./signer');
  const log = freshLog();
  const phrase = Array.from({ length: 24 }, (_, i) => ['abandon', 'ability', 'able', 'about', 'above', 'absent'][i % 6]).join(' ');
  for (const [what, identity] of [['a secret key', S.Keypair.random().secret()], ['a 24-word seed phrase', phrase], ['a flag', '--sign-with-lab'], ['nothing', '']]) {
    const e = throwsSync(() => fakeSigner(identity), SignerError, what);
    assert(/never a secret key or seed phrase/.test(e.message), `${what}: ${e.message}`);
    assert(!SECRET_RE.test(e.message), `${what}: the message does not repeat the secret`);
  }
  eq(log().length, 0, 'nothing was spawned');
});

test('cliSigner rejects what stellar-cli returns when it is another transaction, drops or changes an earlier signature, is signed by another key, or stellar-cli fails or hangs', async () => {
  const { SignerError } = require('./signer');
  freshLog();
  const other = S.Keypair.random();
  try {
    /* each misbehaviour is caught by its own check: the message says which */
    const why = { tamper: /another transaction/, strip: /signatures; expected/, replace: /changed a signature that was already on the transaction/, wrongkey: /is not from qwatt-verifier/, exit1: /simulated/, hang: /timed out/ };
    for (const mode of Object.keys(why)) {
      const tx = sampleTx();
      tx.sign(other);                                                   // an earlier signature that must survive
      const before = tx.toEnvelope().toXDR('base64');
      process.env.FAKE_STELLAR_MODE = mode;
      const t0 = Date.now();
      /* only the hang gets a short timeout: starting Node takes about a second on a loaded machine */
      const e = await rejects(fakeSigner('qwatt-verifier', mode === 'hang' ? { timeoutMs: 1000 } : {}).sign(tx), SignerError, mode);
      if (mode === 'hang') assert(Date.now() - t0 < 10000, `${mode}: answered within the timeout`);
      assert(why[mode].test(e.message), `${mode}: rejected for its own reason (${why[mode]}): ${e.message}`);
      eq(tx.toEnvelope().toXDR('base64'), before, `${mode}: the transaction handed in is unchanged`);
    }
    process.env.FAKE_STELLAR_MODE = 'unknown';
    const e = await rejects(fakeSigner('qwatt-verifier').init(), SignerError, 'an identity this user does not have');
    assert(/qwatt-verifier/.test(e.message), e.message);
  } finally { delete process.env.FAKE_STELLAR_MODE; }
});

test('keypairSigner gives the same envelope as tx.sign (throwaway rehearsals and tests keep working)', async () => {
  const { keypairSigner } = require('./signer');
  const kp = S.Keypair.random();
  const tx = sampleTx();
  const clone = new S.Transaction(tx.toEnvelope().toXDR('base64'), TESTNET);
  clone.sign(kp);
  const s = await keypairSigner(kp).init();
  eq(s.kind, 'keypair', 'kind');
  eq(s.publicKey, kp.publicKey(), 'public key');
  eq((await s.sign(tx)).toEnvelope().toXDR('base64'), clone.toEnvelope().toXDR('base64'), 'same envelope');
  eq(await s.version(), null, 'no stellar-cli version');
});

test('cliSigner takes the full network passphrase, never an alias such as TESTNET (anchor.json says TESTNET; the CLIs map it first), and never the public network', async () => {
  const { SignerError } = require('./signer');
  const log = freshLog();
  for (const p of ['TESTNET', 'testnet', '', undefined, S.Networks.PUBLIC]) {
    throwsSync(() => fakeSigner('qwatt-proposer', { passphrase: p }), SignerError, `passphrase ${JSON.stringify(p)}`);
  }
  eq(log().length, 0, 'nothing was spawned');
});

test('signerFromArgs: --sign-with-key is required, the network passphrase passed in is the one stellar-cli gets, and a .js --stellar-bin runs with this Node', async () => {
  const { signerFromArgs, SignerError } = require('./signer');
  const e = throwsSync(() => signerFromArgs(['--feed', 'x'], TESTNET), SignerError, 'missing --sign-with-key');
  assert(/--sign-with-key/.test(e.message), e.message);
  throwsSync(() => signerFromArgs(['--sign-with-key'], TESTNET), SignerError, '--sign-with-key without a value');
  throwsSync(() => signerFromArgs(['--sign-with-key', '--once'], TESTNET), SignerError, '--sign-with-key followed by another flag');
  const log = freshLog();
  const s = signerFromArgs(['--sign-with-key', 'qwatt-verifier', '--stellar-bin', FIXTURE], TESTNET);
  await s.init();
  eq(s.publicKey, keyOf('qwatt-verifier').publicKey(), 'the fake ran as stellar-cli');
  await s.sign(sampleTx());
  eq(JSON.stringify(log().find((a) => a[0] === 'tx')), JSON.stringify(['tx', 'sign', '--sign-with-key', 'qwatt-verifier', '--network-passphrase', TESTNET]), 'argv');
});

test('refuseEnvSecrets names the variable and the way out; roleMismatch requires the identity\'s key to be the config\'s signer for that role', async () => {
  const { refuseEnvSecrets, roleMismatch } = require('./signer');
  const saved = process.env.QWATT_TEST_ONLY_SECRET;
  try {
    delete process.env.QWATT_TEST_ONLY_SECRET;
    eq(refuseEnvSecrets(['QWATT_TEST_ONLY_SECRET']), null, 'unset: nothing to refuse');
    process.env.QWATT_TEST_ONLY_SECRET = 'set';
    const msg = refuseEnvSecrets(['QWATT_TEST_ONLY_SECRET']);
    assert(/no longer accepted/.test(msg) && /--sign-with-key/.test(msg) && /QWATT_TEST_ONLY_SECRET/.test(msg), msg);
  } finally { if (saved === undefined) delete process.env.QWATT_TEST_ONLY_SECRET; else process.env.QWATT_TEST_ONLY_SECRET = saved; }
  const P = S.Keypair.random().publicKey(), V = S.Keypair.random().publicKey();
  assert(/signers\.proposer/.test(roleMismatch({}, 'proposer', P) || ''), 'a config without signers is refused');
  assert(/signers\.verifier/.test(roleMismatch({ signers: { proposer: P } }, 'verifier', V) || ''), 'a config without that role is refused');
  const m = roleMismatch({ signers: { proposer: P, verifier: V } }, 'proposer', V);
  assert(m && m.includes(V) && m.includes(P), `a swapped identity is refused with both keys named: ${m}`);
  eq(roleMismatch({ signers: { proposer: P, verifier: V } }, 'proposer', P), null, 'the right key');
});

test('selfTest: at start a service signs one throwaway transaction that can never be valid, so a stellar-cli that cannot sign offline stops it at once', async () => {
  const { selfTest, SignerError } = require('./signer');
  const log = freshLog();
  const s = await fakeSigner('qwatt-proposer').init();
  const probe = await selfTest(s, TESTNET);
  eq(probe.source, s.publicKey, 'the probe is for the identity\'s own key');
  eq(probe.signatures.length, 1, 'signed once');
  eq(probe.timeBounds.maxTime, '1', 'expired since 1970: it can never be submitted');
  eq(probe.operations[0].name, 'qwatt.key_check', 'one manageData');
  assert(log().some((a) => a[0] === 'tx'), 'stellar-cli was asked to sign');
  try {
    process.env.FAKE_STELLAR_MODE = 'wrongkey';
    await rejects(selfTest(s, TESTNET), SignerError, 'a signature from another key');
  } finally { delete process.env.FAKE_STELLAR_MODE; }
});

(async () => {
  console.log('\nanchor keys: signing through stellar-cli (V3-8)');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      ')); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
