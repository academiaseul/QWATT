#!/usr/bin/env node
/**
 * QWATT — a stand-in for stellar-cli, for tests only (no network, no secret anywhere)
 * ---------------------------------------------------------------------------
 * Emulates the three stellar-cli commands the anchoring tools run:
 *
 *   keys address <id>            (also: keys public-key <id>)   prints the identity's G… key
 *   tx sign --sign-with-key <id> --network-passphrase <p> [file] signs the XDR from the file, or
 *                                                                from stdin when no file is given
 *   version --only-version                                      prints 28.1.0
 *
 * Keys are derived, never stored: an identity's key is
 *   Keypair.fromRawEd25519Seed(sha256(FAKE_STELLAR_SALT + ':' + id))
 * so no secret string appears in the environment, in argv or in a file. A test
 * derives the same key with `derive()` to check a signature.
 *
 * FAKE_STELLAR_LOG   append each argv as one JSON line (what the tools asked stellar-cli to do)
 * FAKE_STELLAR_MODE  misbehave on `tx sign`:
 *                      tamper   sign another transaction (the fee is changed)
 *                      strip    drop the signatures already on the envelope, then sign
 *                      replace  swap the first signature already on the envelope for
 *                               another key's (the count stays right), then sign
 *                      wrongkey sign with a key that is not the identity's
 *                      exit1    print an error and exit 1
 *                      hang     never answer
 *                    or on `keys address`:
 *                      unknown  the identity does not exist for this user (exit 1)
 *
 * Run it as `node anchor/test-fixtures/fake-stellar-cli.js …`, or pass the file
 * as --stellar-bin to a tool (a .js stellar-bin is run with the current Node).
 */

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const S = require('@stellar/stellar-sdk');

const VERSION = '28.1.0';

/** The key a fake identity stands for. */
function derive(salt, id) {
  return S.Keypair.fromRawEd25519Seed(crypto.createHash('sha256').update(`${salt || ''}:${id}`).digest());
}

function fail(msg, code = 1) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}

function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { s += d; });
    process.stdin.on('end', () => resolve(s));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (process.env.FAKE_STELLAR_LOG) fs.appendFileSync(process.env.FAKE_STELLAR_LOG, JSON.stringify(argv) + '\n');
  const mode = process.env.FAKE_STELLAR_MODE || '';
  const salt = process.env.FAKE_STELLAR_SALT || '';
  const [cmd, sub] = argv;

  if (cmd === 'version' && argv.includes('--only-version')) { process.stdout.write(VERSION + '\n'); return; }

  if (cmd === 'keys' && (sub === 'address' || sub === 'public-key')) {
    const id = argv[2];
    if (!id) fail('the following required arguments were not provided: <NAME>', 2);
    if (mode === 'unknown') fail(`Failed to find config identity for ${id}`);
    process.stdout.write(derive(salt, id).publicKey() + '\n');
    return;
  }

  if (cmd === 'tx' && sub === 'sign') {
    let id = null, passphrase = null, file = null;
    for (let i = 2; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--sign-with-key') id = argv[++i];
      else if (a === '--network-passphrase') passphrase = argv[++i];
      else if (a === '--network') { const n = argv[++i]; passphrase = n === 'testnet' ? S.Networks.TESTNET : null; if (!passphrase) fail(`unknown network ${n}`); }
      else if (a.startsWith('--')) fail(`unexpected argument '${a}'`, 2);
      else file = a;
    }
    if (!id) fail('no signer: pass --sign-with-key', 2);
    if (!passphrase) fail('no network passphrase', 2);
    if (mode === 'hang') { setInterval(() => {}, 1000); return; }
    if (mode === 'exit1') fail('transaction signing failed (simulated)');
    const xdr = (file ? fs.readFileSync(file, 'utf8') : await readStdin()).trim();
    let env;
    try { env = S.xdr.TransactionEnvelope.fromXDR(xdr, 'base64'); } catch (e) { fail('invalid transaction XDR'); }
    if (mode === 'tamper') { const t = env.v1().tx(); t.fee(t.fee() + 1); }
    const tx = new S.Transaction(env, passphrase);
    if (mode === 'replace' && tx.signatures.length) tx.signatures[0] = derive(salt, `${id}:other`).signDecorated(tx.hash());
    if (mode === 'strip') tx.signatures.length = 0;
    tx.sign(derive(salt, mode === 'wrongkey' ? `${id}:another-key` : id));
    process.stdout.write(tx.toEnvelope().toXDR('base64') + '\n');
    return;
  }

  fail(`unrecognized subcommand '${argv.join(' ')}'`, 2);
}

if (require.main === module) main();

module.exports = { derive, VERSION };
