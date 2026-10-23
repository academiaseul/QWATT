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

/* ── capture: envelopes in, Horizon's answer and links out (V3-8) ──────────── */

const { FakeHorizon } = require('./fake-horizon');
const clock = { now: () => Math.floor(Date.now() / 1000) };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
/** A 2/2/3 account on the fake network and a transaction for it signed by the given keys. */
async function signedFor(fake, account, ...keys) {
  const b = new S.TransactionBuilder(await fake.loadAccount(account), { fee: String(S.BASE_FEE), networkPassphrase: TESTNET });
  const tx = b.addOperation(S.Operation.manageData({ name: 'qwatt.anchor.sha256', value: 'c'.repeat(64) })).setTimeout(300).build();
  for (const k of keys) tx.sign(k);
  return tx;
}

test('readEnvelopeFile reads an envelope saved by Windows PowerShell (UTF-16LE with BOM) or by bash (UTF-8, trailing newline)', async () => {
  const C = require('./capture');
  const tx = sampleTx();
  tx.sign(S.Keypair.random());
  const xdr = tx.toEnvelope().toXDR('base64');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-envelope-'));
  const files = {
    'powershell.xdr': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${xdr}\r\n`, 'utf16le')]),
    'utf16be.xdr': Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(`${xdr}\r\n`, 'utf16le').swap16()]),
    'bash.xdr': Buffer.from(`${xdr}\n`, 'utf8'),
    'utf8-bom.xdr': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`\n${xdr}\n\n`, 'utf8')]),
  };
  for (const [n, b] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, n), b);
    const read = C.readEnvelopeFile(path.join(dir, n));
    assert(new S.Transaction(read, TESTNET).hash().equals(tx.hash()), `${n}: the same transaction`);
  }
  fs.writeFileSync(path.join(dir, 'junk.xdr'), 'not an envelope\n');
  let msg = '';
  try { C.readEnvelopeFile(path.join(dir, 'junk.xdr')); } catch (e) { msg = e.message; }
  assert(msg, 'a file without an envelope is refused');
});

test('capture.js submit prints the operations stellar-cli is about to sign, keeps the envelopes and the no-answer record when Horizon does not answer (exit 1, never retried); an unknown subcommand exits 2', async () => {
  const { spawnSync } = require('child_process');
  const capture = path.join(__dirname, 'capture.js');
  const log = freshLog();
  const issuer = S.Keypair.random().publicKey(), to = S.Keypair.random().publicKey();
  const tx = new S.TransactionBuilder(new S.Account(keyOf('qwatt-treasury').publicKey(), '41'), { fee: String(S.BASE_FEE), networkPassphrase: TESTNET })
    .addOperation(S.Operation.payment({ destination: to, asset: new S.Asset('QWATT', issuer), amount: '1' }))
    .addMemo(S.Memo.text('fund QWATT anchoring'))
    .setTimeout(3600)
    .build();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-capture-cli-'));
  const file = path.join(dir, 'funding.xdr');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${tx.toEnvelope().toXDR('base64')}\r\n`, 'utf16le')]));   // as PowerShell 5.1 writes it
  const ev = path.join(dir, 'ev');
  /* https on 127.0.0.1:9: nothing listens there, so Horizon never answers and nothing leaves this machine */
  const r = spawnSync(process.execPath, [capture, 'submit', file, '--name', 'funding', '--evidence', ev, '--sign-with-key', 'qwatt-treasury', '--stellar-bin', FIXTURE, '--horizon', 'https://127.0.0.1:9'], { encoding: 'utf8', env: { ...process.env }, timeout: 60000 });
  eq(r.status, 1, `no answer from Horizon: exit status (${r.stderr.trim()})`);
  const at = r.stdout.search(/payment 1(\.0+)? QWATT/), signedAt = r.stdout.indexOf('signed by');
  assert(at >= 0 && r.stdout.includes(to), `the payment, its amount and its destination are printed: ${r.stdout}`);
  assert(signedAt > at, `before stellar-cli signs: ${r.stdout}`);
  assert(/no answer/.test(r.stdout) && r.stdout.includes(tx.hash().toString('hex')), `the hash to check before sending anything again: ${r.stdout}`);
  const index = JSON.parse(fs.readFileSync(path.join(ev, 'index.json'), 'utf8'));
  for (const f of ['funding.xdr', 'funding.signed.xdr', 'funding.horizon.json']) eq(index.files[f], sha256(fs.readFileSync(path.join(ev, f))), `${f}: written, SHA-256 in index.json`);
  const record = JSON.parse(fs.readFileSync(path.join(ev, 'funding.horizon.json'), 'utf8'));
  eq(record.timeout, true, 'the no-answer record');
  eq(record.hash, tx.hash().toString('hex'), 'with the local hash');
  const signed = new S.Transaction(fs.readFileSync(path.join(ev, 'funding.signed.xdr'), 'utf8').trim(), TESTNET);
  eq(signed.signatures.length, 1, 'signed once');
  assert(verifies(keyOf('qwatt-treasury'), signed, signed.signatures[0]), 'by the qwatt-treasury identity');
  eq(log().filter((a) => a[0] === 'tx').length, 1, 'stellar-cli signed once');
  const u = spawnSync(process.execPath, [capture, 'frobnicate'], { encoding: 'utf8', env: { ...process.env }, timeout: 60000 });
  eq(u.status, 2, 'unknown subcommand: exit status');
  assert(/usage/.test(u.stderr), `prints the usage: ${u.stderr.trim()}`);
});

test('capture: a submitted envelope is stored with Horizon\'s full response and a stellar.expert link, listed in index.json with its SHA-256', async () => {
  const C = require('./capture');
  const K = { account: S.Keypair.random(), p: S.Keypair.random(), v: S.Keypair.random(), t: S.Keypair.random() };
  const account = K.account.publicKey();
  const fake = new FakeHorizon({ account, signers: [K.p.publicKey(), K.v.publicKey(), K.t.publicKey()], clock });
  const tx = await signedFor(fake, account, K.p, K.v);
  const r = await C.submitEnvelope(fake, tx);
  eq(r.ok, true, 'landed');
  eq(r.horizon_response.hash, tx.hash().toString('hex'), 'Horizon\'s answer, verbatim');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-capture-'));
  C.writeEvidence(dir, 'anchor', { files: { 'anchor.signed.xdr': tx.toEnvelope().toXDR('base64') + '\n', 'anchor.horizon.json': JSON.stringify(r.horizon_response, null, 2) + '\n' }, link: C.txLink(r.hash) });
  await C.captureAccount(fake, account, dir);
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  for (const f of ['anchor.signed.xdr', 'anchor.horizon.json', 'account.json']) eq(index.files[f], sha256(fs.readFileSync(path.join(dir, f))), `${f}: SHA-256 in index.json`);
  eq(index.links.anchor, 'https://stellar.expert/explorer/testnet/tx/' + r.hash, 'transaction link');
  eq(index.links.account, 'https://stellar.expert/explorer/testnet/account/' + account, 'account link');
  const acct = JSON.parse(fs.readFileSync(path.join(dir, 'account.json'), 'utf8'));
  eq(JSON.stringify(acct.thresholds), JSON.stringify({ low_threshold: 2, med_threshold: 2, high_threshold: 3 }), 'account.json: thresholds');
  eq(acct.signers.filter((s) => s.weight === 1).length, 3, 'account.json: three signers of weight 1');

  const refused = await C.submitEnvelope(fake, await signedFor(fake, account, K.p));
  eq(refused.ok, false, 'one signature is refused');
  eq(JSON.stringify(refused.codes), JSON.stringify({ transaction: 'tx_bad_auth' }), 'codes');
  eq(JSON.stringify(refused.horizon_response.extras.result_codes), JSON.stringify({ transaction: 'tx_bad_auth' }), 'Horizon\'s problem JSON, verbatim');

  const n0 = fake.submissions;
  fake.failNext = 'timeout-before';
  const late = await signedFor(fake, account, K.p, K.v);
  const t = await C.submitEnvelope(fake, late);
  eq(t.ok, null, 'a timeout is neither success nor refusal');
  eq(t.hash, late.hash().toString('hex'), 'the locally computed hash, to check on Horizon before sending anything again');
  eq(fake.submissions, n0 + 1, 'never retried');
});

/* ── keys check and the backup drill (V3-8c) ──────────────────────────────────
 * Each holder's offline backup is proved once by restoring it into a
 * `-restored` stellar-cli identity and co-signing a throwaway transaction with
 * a high-threshold operation, which lands only with all three keys. */

const SETUP = require('./setup-account');
const ROLES = ['proposer', 'verifier', 'third'];
/** The three holders' keys: the stellar-cli identities qwatt-proposer, qwatt-verifier and qwatt-third. */
const holders = () => Object.fromEntries(ROLES.map((r) => [r, keyOf(`qwatt-${r}`).publicKey()]));
/** A throwaway 2/2/3 account G_D on the fake network, set up the way the drill account is (setup-account.js build and submit). */
async function drillAccount() {
  const fake = new FakeHorizon({ clock });
  const D = keyOf('qwatt-drill-setup').publicKey();
  fake.fund(D);
  const roles = holders();
  const o = { ...SETUP.DEFAULTS, account: D, ...roles };
  const r = await SETUP.submitSetup(fake, await SETUP.buildSetupTx(fake, o), o, { signer: fakeSigner('qwatt-drill-setup') });
  assert(r.ok, `drill account set up: ${JSON.stringify(r)}`);
  return { fake, account: D, roles };
}
/** Each holder signs the drill transaction separately with the identity restored from their backup. */
async function restoredEnvelopes(xdr, roles = ROLES) {
  const out = {};
  for (const role of roles) out[role] = (await (await fakeSigner(`qwatt-${role}-restored`).init()).sign(new S.Transaction(xdr, TESTNET))).toEnvelope().toXDR('base64');
  return out;
}

test('backup drill: a throwaway transaction with a high-threshold operation lands only when the three restored keys, each signing separately, are merged; two of three is not submitted and the result names the missing role', async () => {
  const K = require('./keys');
  freshLog();
  const d = await drillAccount();
  const unsigned = await K.buildDrillTx(d.fake, d.account, '2026-10-28');
  eq(unsigned.signatures.length, 0, 'drill-xdr is unsigned');
  eq(unsigned.memo.value.toString(), 'QWATT backup drill', 'memo');
  eq(JSON.stringify(unsigned.operations.map((op) => op.type)), JSON.stringify(['manageData', 'setOptions']), 'manageData + setOptions');
  eq(unsigned.operations[1].highThreshold, 3, 'a high-threshold operation (it leaves high at 3)');
  const xdr = unsigned.toEnvelope().toXDR('base64');
  const env = await restoredEnvelopes(xdr);
  for (const role of ROLES) {
    const t = new S.Transaction(env[role], TESTNET);
    eq(t.signatures.length, 1, `${role}: one signature`);
    assert(S.Keypair.fromPublicKey(d.roles[role]).verify(t.hash(), t.signatures[0].signature()), `${role}: the restored identity holds the key that was sent`);
  }
  /* the network side: two of the three keys do not meet the high threshold */
  const twoOnly = K.mergeSignatures(TESTNET, [env.proposer, env.verifier], Object.values(d.roles)).tx;
  let codes = null;
  try { await d.fake.submitTransaction(twoOnly); } catch (e) { codes = e.response.data.extras.result_codes; }
  eq(JSON.stringify(codes), JSON.stringify({ transaction: 'tx_failed', operations: ['op_success', 'op_bad_auth'] }), 'two keys: refused, nothing applies');
  const n0 = d.fake.submissions, txs0 = d.fake.txs.length;
  const two = await K.submitDrill({ server: d.fake, account: d.account, envelopes: [env.proposer, env.verifier], roles: d.roles, evidenceDir: fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-drill-')) });
  eq(two.ok, false, 'two of three: not ok');
  eq(JSON.stringify(two.missing), JSON.stringify(['third']), 'the missing role is named');
  eq(d.fake.submissions, n0, 'two of three is never submitted');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-drill-'));
  const all = await K.submitDrill({ server: d.fake, account: d.account, envelopes: [env.third, env.proposer, env.verifier, env.proposer], roles: d.roles, evidenceDir: dir });
  eq(all.ok, true, `three of three lands: ${JSON.stringify(all.codes || all.detail || null)}`);
  eq(d.fake.txs.length, txs0 + 1, 'one more transaction on the ledger');
  const landed = d.fake.txs[d.fake.txs.length - 1];
  eq(landed.memo, 'QWATT backup drill', 'the drill landed');
  eq(landed.signatures.length, 3, 'three signatures, duplicates dropped');
  const drill = JSON.parse(fs.readFileSync(path.join(dir, 'drill.json'), 'utf8'));
  eq(JSON.stringify(drill.signed_by), JSON.stringify(d.roles), 'drill.json: signed by the three roles');
  eq(drill.account, d.account, 'drill.json: account');
  eq(drill.link, 'https://stellar.expert/explorer/testnet/tx/' + drill.tx_hash, 'drill.json: stellar.expert link');
  eq(drill.ok, true, 'drill.json: ok');
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  for (const f of ['drill.unsigned.xdr', 'drill.proposer.xdr', 'drill.verifier.xdr', 'drill.third.xdr', 'drill.merged.xdr', 'drill.horizon.json', 'drill.json']) {
    eq(index.files[f], sha256(fs.readFileSync(path.join(dir, f))), `${f}: SHA-256 in index.json`);
  }
});

test('drill merge refuses an envelope for another transaction and a signature from a key that is not a signer; a backup that restores another key is caught before anything is sent', async () => {
  const K = require('./keys');
  freshLog();
  const d = await drillAccount();
  const signers = Object.values(d.roles);
  const xdr = (await K.buildDrillTx(d.fake, d.account, '2026-10-28')).toEnvelope().toXDR('base64');
  const other = (await K.buildDrillTx(d.fake, d.account, '2026-10-29')).toEnvelope().toXDR('base64');
  const env = await restoredEnvelopes(xdr);
  const [envOther] = Object.values(await restoredEnvelopes(other, ['third']));
  let m = '';
  try { K.mergeSignatures(TESTNET, [env.proposer, envOther], signers); } catch (e) { m = e.message; }
  assert(/another transaction/.test(m), `an envelope for another transaction: ${m}`);
  const stranger = new S.Transaction(xdr, TESTNET);
  stranger.sign(S.Keypair.random());
  m = '';
  try { K.mergeSignatures(TESTNET, [env.proposer, stranger.toEnvelope().toXDR('base64')], signers); } catch (e) { m = e.message; }
  assert(/not a signer/.test(m), `a signature from a key that is not a signer: ${m}`);
  let bad;
  try { process.env.FAKE_STELLAR_MODE = 'badbackup'; bad = await restoredEnvelopes(xdr, ['third']); } finally { delete process.env.FAKE_STELLAR_MODE; }
  const n0 = d.fake.submissions;
  m = '';
  try { await K.submitDrill({ server: d.fake, account: d.account, envelopes: [env.proposer, env.verifier, bad.third], roles: d.roles }); } catch (e) { m = e.message; }
  assert(/not a signer/.test(m), `the third signer's backup restores another key: ${m}`);
  eq(d.fake.submissions, n0, 'nothing submitted');
});

test('drill-xdr refuses an account that is not configured like the anchoring account', async () => {
  const K = require('./keys');
  const keys = ROLES.map(() => S.Keypair.random().publicKey());
  const cases = {
    'thresholds 1/2/3': (a) => new FakeHorizon({ account: a, signers: keys, thresholds: { low: 1, med: 2, high: 3 }, clock }),
    'two signers': (a) => new FakeHorizon({ account: a, signers: keys.slice(0, 2), clock }),
    'a fresh account (master weight 1)': (a) => { const f = new FakeHorizon({ clock }); f.fund(a); return f; },
  };
  for (const [what, mk] of Object.entries(cases)) {
    const a = S.Keypair.random().publicKey();
    let m = '';
    try { await K.buildDrillTx(mk(a), a, '2026-10-28'); } catch (e) { m = e.message; }
    assert(m, `${what}: refused`);
  }
});

test('keys check: resolves the identity through stellar-cli, signs offline, matches --expect and reports whether the key is a weight-1 signer of --account', async () => {
  const K = require('./keys');
  const log = freshLog();
  const roles = holders();
  const account = S.Keypair.random().publicKey();
  const fake = new FakeHorizon({ account, signers: Object.values(roles), clock });
  const ok = await K.checkIdentity({ signer: fakeSigner('qwatt-proposer'), expect: roles.proposer, account, server: fake });
  eq(ok.ok, true, `the proposer identity checks out: ${JSON.stringify(ok.warnings)}`);
  eq(ok.publicKey, roles.proposer, 'public key');
  eq(ok.is_signer, true, 'a weight-1 signer of the account');
  eq(ok.stellar_cli_version, '28.1.0', 'stellar-cli version');
  assert(log().some((a) => a[0] === 'tx' && a[1] === 'sign'), 'it signed offline');
  const wrong = await K.checkIdentity({ signer: fakeSigner('qwatt-proposer'), expect: roles.verifier });
  eq(wrong.ok, false, 'a wrong --expect fails');
  const stranger = await K.checkIdentity({ signer: fakeSigner('qwatt-stranger'), account, server: fake });
  eq(stranger.is_signer, false, 'an identity that is not a signer');
  eq(stranger.ok, false, 'and the check fails');
  eq(fake.submissions, 0, 'nothing submitted');
  /* the CLI, as the runbook runs it on a host */
  const run = (expect) => require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'keys.js'), 'check', '--sign-with-key', 'qwatt-proposer', '--expect', expect, '--stellar-bin', FIXTURE], { encoding: 'utf8', env: { ...process.env }, timeout: 60000 });
  const good = run(roles.proposer), bad = run(roles.verifier);
  eq(good.status, 0, `keys.js check exits 0: ${good.stderr}`);
  assert(/\bOK\b/.test(good.stdout), `prints OK: ${good.stdout}`);
  eq(bad.status, 1, `keys.js check with a wrong --expect exits 1: ${bad.stderr}`);
});

test('keys check never reads the identity file: it only stats it, and on POSIX warns when others can read it (run in a fresh process whose fs is guarded before any module loads)', async () => {
  const { spawnSync } = require('child_process');
  freshLog();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-xdg-'));
  const idFile = path.join(home, 'stellar', 'identity', 'qwatt-proposer.toml');
  fs.mkdirSync(path.dirname(idFile), { recursive: true });
  fs.writeFileSync(idFile, '# a stand-in identity file: keys.js must never open it\n');
  fs.chmodSync(idFile, 0o644);
  /* the guard is preloaded, so fs functions a module binds when it loads are guarded too */
  const GUARD = path.join(__dirname, 'test-fixtures', 'fs-guard.js');
  const inGuardedNode = (script) => {
    const r = spawnSync(process.execPath, ['--require', GUARD, '-e', script], { cwd: __dirname, encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: home }, timeout: 60000 });
    const line = (r.stderr || '').split(/\r?\n/).find((l) => l.startsWith('FS_GUARD ')) || '';
    let touched = null;
    try { touched = JSON.parse(line.slice('FS_GUARD '.length)).touched; } catch (e) { /* no guard line: the child did not run */ }
    return { ...r, touched };
  };
  /* the guard itself: a read through a binding taken at load time is caught */
  const control = inGuardedNode(`const { readFileSync: rfs } = require('fs'); rfs(${JSON.stringify(idFile)}, 'utf8');`);
  eq(control.touched ? control.touched.length : null, 1, `control: the guard sees a read of the identity file through a binding taken at load time (${control.stderr.trim()})`);
  const check = inGuardedNode([
    `const K = require(${JSON.stringify(path.join(__dirname, 'keys.js'))});`,
    `const { cliSigner } = require(${JSON.stringify(path.join(__dirname, 'signer.js'))});`,
    `K.checkIdentity({ signer: cliSigner({ identity: 'qwatt-proposer', passphrase: ${JSON.stringify(TESTNET)}, command: process.execPath, commandArgs: [${JSON.stringify(FIXTURE)}] }) })`,
    '  .then((r) => process.stdout.write(JSON.stringify(r)), (e) => { process.stderr.write(`CHECK FAILED ${e.message}\\n`); process.exitCode = 1; });',
  ].join('\n'));
  eq(check.status, 0, `checkIdentity ran: ${check.stderr.trim()}`);
  assert(Array.isArray(check.touched), `the guard reported: ${check.stderr.trim()}`);
  eq(check.touched.length, 0, `the identity file was opened, read, copied or moved: ${JSON.stringify(check.touched)}`);
  const r = JSON.parse(check.stdout);
  eq(r.ok, true, 'the check itself passes');
  eq(r.publicKey, keyOf('qwatt-proposer').publicKey(), 'the identity\'s key');
  if (process.platform !== 'win32') assert(r.warnings.some((w) => /readable by group or others/.test(w)), `a 644 identity file is reported: ${JSON.stringify(r.warnings)}`);
});

test('the drill account\'s setup writes no public config: setup submit writes anchor.json and prints the funding step only with --out (the real account)', async () => {
  const o = { ...SETUP.DEFAULTS, account: keyOf('qwatt-drill-setup').publicKey(), ...holders() };
  const landed = { ok: true, hash: 'ab'.repeat(32), ledger: 7 };
  const drill = SETUP.afterSetup(o, landed, { identity: 'qwatt-drill-setup' });
  eq(drill.config, null, 'without --out: no config to write (it would replace the anchor.json the services read)');
  const text = drill.lines.join('\n');
  assert(!/fund-xdr|config written/.test(text), `no funding step and no config for the drill: ${text}`);
  assert(/stellar keys rm qwatt-drill-setup/.test(text), `the setup identity to remove is the one that signed: ${text}`);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-setup-out-')), 'anchor.json');
  const real = SETUP.afterSetup(o, landed, { out, identity: 'qwatt-anchor-setup' });
  eq(real.config && real.config.file, path.resolve(out), '--out: the config goes there');
  eq(JSON.stringify(real.config.json.signers), JSON.stringify(holders()), 'signers by role');
  assert(/fund-xdr --account/.test(real.lines.join('\n')), `the real account's next step is the funding: ${real.lines.join('\n')}`);
});

test('keys.js CLI: an unknown subcommand, drill-xdr without --out and drill-submit without envelopes print the usage and exit 2', async () => {
  const { spawnSync } = require('child_process');
  const R = holders(), G = S.Keypair.random().publicKey();
  const cases = {
    'an unknown subcommand': ['frobnicate'],
    'drill-xdr without --out': ['drill-xdr', '--account', G],
    'drill-submit without envelopes': ['drill-submit', '--account', G, '--proposer', R.proposer, '--verifier', R.verifier, '--third', R.third, '--evidence', fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-drill-cli-'))],
  };
  for (const [what, args] of Object.entries(cases)) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'keys.js'), ...args, '--horizon', 'https://127.0.0.1:9'], { encoding: 'utf8', env: { ...process.env }, timeout: 60000 });
    eq(r.status, 2, `${what}: exit status (${(r.stderr || '').trim().split('\n')[0]})`);
    assert(/usage/.test(r.stderr), `${what}: prints the usage`);
  }
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
