/**
 * QWATT — signing through stellar-cli (freeze v3, V3-8: keys without a browser)
 * ---------------------------------------------------------------------------
 * Each key is generated with stellar-cli on the machine that uses it and stays
 * in stellar-cli's identity store there. The services and tools never read a
 * secret: they hand stellar-cli an unsigned or partly signed transaction and
 * get back the signed envelope,
 *
 *   stellar tx sign --sign-with-key <identity> --network-passphrase "<passphrase>"   (XDR on stdin)
 *
 * and accept it only if it is the same transaction, every earlier signature is
 * byte-identical, and exactly one signature was added, by the identity's key
 * (resolved once with `stellar keys address <identity>`). `--sign-with-key`
 * also accepts a raw secret or a seed phrase, so the identity is checked to be
 * a name before anything runs; a secret never enters argv. stellar-cli's browser
 * and hardware-device signing modes are never used.
 *
 * The three command forms used here (`keys address <id>`, `tx sign` with the XDR
 * on stdin and no RPC URL, `version --only-version`) are taken from stellar-cli's
 * published help; to confirm with stellar-cli 28.1.0 (founder step 0). The tests
 * run a fake stellar-cli (test-fixtures/fake-stellar-cli.js).
 *
 * keypairSigner wraps an in-memory Keypair, for the offline tests and the
 * throwaway-account rehearsals only.
 *
 * Depends only on the Stellar SDK and Node's child_process.
 */

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const S = require('@stellar/stellar-sdk');

class SignerError extends Error {}

const IDENTITY_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const NOT_A_NAME = '--sign-with-key takes a stellar-cli identity name, never a secret key or seed phrase';
const ENV_REFUSED = 'secrets in the environment are no longer accepted (freeze v3, V3-8): generate the key with stellar-cli on this machine and pass --sign-with-key <identity>';

/** For tests and the throwaway rehearsals only: signs in memory, in place. */
function keypairSigner(kp) {
  return {
    kind: 'keypair',
    publicKey: kp.publicKey(),
    async init() { return this; },
    async version() { return null; },
    async sign(tx) { tx.sign(kp); return tx; },
  };
}

/** The last non-empty line of a text (stellar-cli's error), never stdout. */
const lastLine = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '';

/** Run stellar-cli once: argv only (never a shell), input on stdin, stdout returned, never logged. */
function runCli(command, argv, { input = '', timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child, done = false, out = '', err = '';
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
      finish(reject, new SignerError(`stellar-cli timed out after ${timeoutMs} ms (${argv[0]} ${argv[1]})`));
    }, timeoutMs);
    try {
      child = spawn(command, argv, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return finish(reject, new SignerError(`cannot run ${command}: ${e.code || e.message}`));
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish(reject, new SignerError(`cannot run ${command}: ${e.code || e.message}`)));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, out);
      else finish(reject, new SignerError(`stellar-cli ${argv[0]} ${argv[1]} failed (exit ${code}): ${lastLine(err) || 'no error message'}`));
    });
    child.stdin.on('error', () => { /* the process exited before reading: its exit code says why */ });
    child.stdin.end(input);
  });
}

/**
 * Sign through stellar-cli.
 * @param {object} o
 * @param {string} o.identity        stellar-cli identity name (never a secret or a seed phrase)
 * @param {string} o.passphrase      the full network passphrase ("Test SDF Network ; September 2015"), never an alias
 * @param {string} [o.command]       the stellar-cli binary (default `stellar` on PATH)
 * @param {string[]} [o.commandArgs] arguments before stellar-cli's own (e.g. a script run by Node)
 * @param {number} [o.timeoutMs]
 */
function cliSigner({ identity, passphrase, command = 'stellar', commandArgs = [], timeoutMs = 20000 } = {}) {
  if (typeof identity !== 'string' || !IDENTITY_RE.test(identity) || S.StrKey.isValidEd25519SecretSeed(identity)) throw new SignerError(NOT_A_NAME);
  if (typeof passphrase !== 'string' || !passphrase.includes(';')) {
    throw new SignerError(`network passphrase ${JSON.stringify(passphrase)} is not a full Stellar network passphrase (e.g. "${S.Networks.TESTNET}"); an alias such as TESTNET would sign for another network`);
  }
  if (passphrase === S.Networks.PUBLIC) throw new SignerError('testnet only: this tool never signs for the public network');
  const cli = (argv, input) => runCli(command, [...commandArgs, ...argv], { input, timeoutMs });
  return {
    kind: 'stellar-cli',
    identity,
    passphrase,
    publicKey: null,
    async init() {
      const out = (await cli(['keys', 'address', identity])).trim();
      if (!S.StrKey.isValidEd25519PublicKey(out)) throw new SignerError(`stellar keys address ${identity} did not print a G… public key`);
      this.publicKey = out;
      return this;
    },
    async version() { return (await cli(['version', '--only-version'])).trim(); },
    async sign(tx) {
      if (!this.publicKey) await this.init();
      const before = tx.signatures.length;
      const out = await cli(['tx', 'sign', '--sign-with-key', identity, '--network-passphrase', passphrase], tx.toEnvelope().toXDR('base64') + '\n');
      let signed;
      try { signed = new S.Transaction(out.trim(), passphrase); } catch (e) { throw new SignerError('stellar-cli did not return a transaction envelope'); }
      if (!signed.hash().equals(tx.hash())) throw new SignerError('stellar-cli returned another transaction (its hash differs)');
      if (signed.signatures.length !== before + 1) throw new SignerError(`stellar-cli returned ${signed.signatures.length} signatures; expected ${before + 1}`);
      for (let i = 0; i < before; i++) {
        if (!signed.signatures[i].toXDR().equals(tx.signatures[i].toXDR())) throw new SignerError('stellar-cli changed a signature that was already on the transaction');
      }
      const kp = S.Keypair.fromPublicKey(this.publicKey), sig = signed.signatures[before];
      if (!sig.hint().equals(kp.signatureHint()) || !kp.verify(signed.hash(), sig.signature())) {
        throw new SignerError(`the new signature is not from ${identity} (${this.publicKey})`);
      }
      return signed;
    },
  };
}

/**
 * The CLIs' signer: `--sign-with-key <identity>` (required) and `--stellar-bin <path>` (optional;
 * a .js file is run with this Node, which is how the tests run the fake stellar-cli).
 * @param {string[]} args
 * @param {string} passphrase   the config's passphrase AFTER loadConfig mapped TESTNET to the full one
 */
function signerFromArgs(args, passphrase) {
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null && !String(args[i + 1]).startsWith('--') ? args[i + 1] : null; };
  const identity = opt('--sign-with-key');
  if (!identity) throw new SignerError('--sign-with-key <identity> is required: the stellar-cli identity on this machine that holds this role\'s key');
  const bin = opt('--stellar-bin') || 'stellar';
  const js = /\.[cm]?js$/i.test(bin);
  return cliSigner({ identity, passphrase, command: js ? process.execPath : bin, commandArgs: js ? [path.resolve(bin)] : [] });
}

/** A message when any of the named environment variables is set (the CLI exits 2 with it), or null. */
function refuseEnvSecrets(names) {
  const set = names.filter((n) => process.env[n] !== undefined);
  return set.length ? `${set.join(', ')} is set: ${ENV_REFUSED}` : null;
}

/**
 * The signer's key must be the public config's signer for its role (anchor.json `signers`),
 * so a swapped identity stops the service at start instead of failing on the network.
 * @returns {string|null} the reason it is not, or null
 */
function roleMismatch(cfg, role, publicKey) {
  const want = cfg && cfg.signers && cfg.signers[role];
  if (!want) return `the anchor config names no signers.${role}; regenerate it with anchor/setup-account.js, which records each signer's role`;
  if (want !== publicKey) return `the stellar-cli identity's key ${publicKey} is not the config's signers.${role} ${want}; use the identity that holds the ${role} key on this machine`;
  return null;
}

/**
 * One throwaway transaction signed offline: source = the signer's own key, sequence 1, one
 * manageData qwatt.key_check, timebounds that expired in 1970 so it can never be submitted.
 * Proves stellar-cli can sign for this identity without a network. Returns the signed transaction.
 */
async function selfTest(signer, passphrase) {
  if (!signer.publicKey) await signer.init();
  const tx = new S.TransactionBuilder(new S.Account(signer.publicKey, '0'), { fee: String(S.BASE_FEE), networkPassphrase: passphrase, timebounds: { minTime: 0, maxTime: 1 } })
    .addOperation(S.Operation.manageData({ name: 'qwatt.key_check', value: 'never submitted' }))
    .build();
  return signer.sign(tx);
}

/**
 * The start-up sequence every signing CLI runs, in this order and before any network call:
 * refuse secrets in the environment, require --sign-with-key, resolve the identity, check its
 * role in the public config, and sign one throwaway transaction offline.
 * @returns {Promise<{signer?:object, error?:string}>} error is the message to print before exiting 2
 */
async function signerForRole({ args, cfg, role, envNames }) {
  const env = refuseEnvSecrets(envNames);
  if (env) return { error: env };
  let signer;
  try { signer = signerFromArgs(args, cfg.network_passphrase); } catch (e) { return { error: e.message }; }
  try { await signer.init(); } catch (e) {
    if (/^cannot run /.test(e.message)) return { error: `stellar-cli is not installed or not on this user's PATH (${e.message}); install the pinned release or pass --stellar-bin <path>` };
    return { error: `stellar-cli identity ${signer.identity} not found for this user; generate it on this machine as this user (${e.message})` };
  }
  const wrong = roleMismatch(cfg, role, signer.publicKey);
  if (wrong) return { error: wrong };
  try { await selfTest(signer, cfg.network_passphrase); } catch (e) { return { error: `stellar-cli cannot sign offline for ${signer.identity}: ${e.message}` }; }
  return { signer };
}

module.exports = { SignerError, keypairSigner, cliSigner, signerFromArgs, refuseEnvSecrets, roleMismatch, selfTest, signerForRole, IDENTITY_RE };
