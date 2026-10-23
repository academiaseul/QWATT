#!/usr/bin/env node
/**
 * QWATT — submit a signed envelope once and keep the network's answer as evidence (freeze v3, V3-4, V3-8)
 * ---------------------------------------------------------------------------
 *   node anchor/capture.js submit <file> --name <n> --evidence <dir> [--sign-with-key <identity>] [--stellar-bin stellar]
 *                                [--config anchor.json | --horizon URL]
 *   node anchor/capture.js account <G…> --evidence <dir> [--config anchor.json | --horizon URL]
 *
 * `submit` reads the envelope (a file written by bash, or by Windows PowerShell 5.1,
 * whose `>` writes UTF-16LE), prints what it is (source, every operation, memo,
 * validity) before anything signs, optionally has stellar-cli add one signature
 * (`--sign-with-key`, through anchor/signer.js), submits it ONCE and writes, under
 * <dir>: <n>.xdr (as given), <n>.signed.xdr (as submitted), <n>.horizon.json
 * (Horizon's answer verbatim, success or problem JSON), and index.json with the
 * SHA-256 of every file and the stellar.expert link. A timeout is never retried:
 * the hash is printed so it can be checked on Horizon before anything is sent
 * again. `account` stores the account as Horizon reports it (signers,
 * thresholds, balances). Testnet only; public data only.
 *
 * capture.js signs whatever envelope it is given. The treasury's funding payment
 * goes through `setup-account.js fund-submit`, which rebuilds it from public
 * values and refuses any other envelope before stellar-cli signs.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const S = require('@stellar/stellar-sdk');

const EXPLORER = 'https://stellar.expert/explorer/testnet';
const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const txLink = (hash) => `${EXPLORER}/tx/${hash}`;
const accountLink = (account) => `${EXPLORER}/account/${account}`;

/** The base64 envelope in a file: BOM stripped, UTF-16LE/BE decoded, first non-empty line, validated as XDR. */
function readEnvelopeFile(file) {
  const buf = fs.readFileSync(file);
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le');
  else if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1))); text = b.swap16().toString('utf16le'); }
  else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.subarray(3).toString('utf8');
  else text = buf.toString('utf8');
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!line || !/^[A-Za-z0-9+/]+={0,2}$/.test(line)) throw new Error(`${file}: no base64 transaction envelope on its first line`);
  try { S.xdr.TransactionEnvelope.fromXDR(line, 'base64'); } catch (e) { throw new Error(`${file}: not a transaction envelope (${e.message})`); }
  return line;
}

/** The transaction in plain words (source, sequence, every operation, memo, validity), printed before stellar-cli signs it. */
function describeTx(tx) {
  const asset = (a) => (!a ? '?' : a.isNative() ? 'XLM' : `${a.getCode()}:${a.getIssuer()}`);
  const fields = (op) => Object.entries(op).filter(([k, v]) => k !== 'type' && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === 'object' && v.getCode ? asset(v) : Buffer.isBuffer(v) ? JSON.stringify(v.toString()) : JSON.stringify(v)}`).join(' ');
  const line = (op) => {
    if (op.type === 'payment') return `payment ${op.amount} ${asset(op.asset)} → ${op.destination}${op.source ? ` (from ${op.source})` : ''}`;
    if (op.type === 'changeTrust') return `changeTrust ${op.line && op.line.getCode ? asset(op.line) : '?'} limit ${op.limit}`;
    return `${op.type} ${fields(op)}`;
  };
  const tb = tx.timeBounds;
  const memo = tx.memo && tx.memo.value != null ? JSON.stringify(tx.memo.value.toString()) : '(none)';
  return [
    `  source     ${tx.source}  sequence ${tx.sequence}  fee ${tx.fee} stroops`,
    ...tx.operations.map((op, i) => `  ${i + 1}. ${line(op)}`),
    `  memo       ${memo}`,
    `  valid      ${!tb || Number(tb.maxTime) === 0 ? 'NEVER EXPIRES' : `until ${new Date(Number(tb.maxTime) * 1000).toISOString()}`}`,
    `  hash       ${tx.hash().toString('hex')}  (${tx.signatures.length} signature(s) already on it)`,
  ];
}

/**
 * Submit once. Never retries.
 * @returns {Promise<{ok:true, hash, ledger, horizon_response} | {ok:false, hash, codes, horizon_response} | {ok:null, hash, detail}>}
 */
async function submitEnvelope(server, tx) {
  const hash = tx.hash().toString('hex');
  try {
    const res = await server.submitTransaction(tx);
    return { ok: true, hash: res.hash || hash, ledger: res.ledger ?? null, horizon_response: res };
  } catch (e) {
    const data = e && e.response && e.response.data;
    if (data && data.extras && data.extras.result_codes) return { ok: false, hash, codes: data.extras.result_codes, horizon_response: data };
    return { ok: null, hash, detail: (e && e.message) || String(e) };
  }
}

/**
 * Write evidence files under dir and record them in <dir>/index.json = { files: { relpath: sha256 }, links: { name: url } }.
 * @param {string} dir
 * @param {string} name     the link's name in index.json
 * @param {{files?:Object<string,string|Buffer>, link?:string}} o
 */
function writeEvidence(dir, name, { files = {}, link } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, 'index.json');
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};
  const out = { files: { ...(index.files || {}) }, links: { ...(index.links || {}) } };
  for (const [rel, content] of Object.entries(files)) {
    const parts = rel.split(/[\\/]/);
    if (path.isAbsolute(rel) || parts.includes('..') || rel === 'index.json') throw new Error(`evidence file must stay inside ${dir}: ${rel}`);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const file = path.join(dir, ...parts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    out.files[parts.join('/')] = sha256(buf);
  }
  if (link) out.links[name] = link;
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const next = { files: sorted(out.files), links: sorted(out.links) };
  fs.writeFileSync(indexFile, JSON.stringify(next, null, 2) + '\n');
  return next;
}

/** The account as Horizon reports it now, stored as account.json with its stellar.expert link. */
async function captureAccount(server, account, dir, { horizonUrl } = {}) {
  const a = await server.loadAccount(account);
  const doc = {
    id: a.id || a.account_id || account,
    sequence: String(a.sequence),
    thresholds: a.thresholds,
    signers: a.signers,
    balances: a.balances,
    captured_at: new Date().toISOString(),
    horizon_url: horizonUrl || (server.serverURL ? String(server.serverURL) : null),
  };
  writeEvidence(dir, 'account', { files: { 'account.json': JSON.stringify(doc, null, 2) + '\n' }, link: accountLink(account) });
  return doc;
}

function horizonFrom(opt, loadConfig) {
  if (opt('--horizon')) return { url: opt('--horizon'), passphrase: S.Networks.TESTNET };
  if (opt('--config')) { const cfg = loadConfig(opt('--config')); return { url: cfg.horizon_url, passphrase: cfg.network_passphrase }; }
  return { url: HORIZON_TESTNET, passphrase: S.Networks.TESTNET };
}

async function cli() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const usage = 'usage: node anchor/capture.js submit <file> --name <n> --evidence <dir> [--sign-with-key <identity>] [--stellar-bin stellar] [--config anchor.json | --horizon URL]\n'
    + '       node anchor/capture.js account <G…> --evidence <dir> [--config anchor.json | --horizon URL]';
  const [sub, target] = args;
  const dir = opt('--evidence');
  if (!['submit', 'account'].includes(sub) || !target || !dir) { console.error(usage); process.exit(2); }
  const { loadConfig } = require('./proposer');
  const h = horizonFrom(opt, loadConfig);
  const server = new S.Horizon.Server(h.url);

  if (sub === 'account') {
    if (!S.StrKey.isValidEd25519PublicKey(target)) { console.error('account: a G… public key is required'); process.exit(2); }
    const doc = await captureAccount(server, target, path.resolve(dir), { horizonUrl: h.url });
    console.log(`account ${doc.id}: ${doc.signers.length} signer entries, thresholds ${JSON.stringify(doc.thresholds)} → ${path.join(dir, 'account.json')}`);
    console.log(accountLink(target));
    return;
  }

  const name = opt('--name');
  if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) { console.error(`--name <n> is required (letters, digits, . _ -)\n${usage}`); process.exit(2); }
  const given = readEnvelopeFile(target);
  let tx = new S.Transaction(given, h.passphrase);
  console.log(`${args.includes('--sign-with-key') ? 'to sign with stellar-cli and submit once' : 'to submit once'}:`);
  for (const l of describeTx(tx)) console.log(l);
  if (args.includes('--sign-with-key')) {
    const SG = require('./signer');
    const env = SG.refuseEnvSecrets(['QWATT_PROPOSER_SECRET', 'QWATT_VERIFIER_SECRET']);
    if (env) { console.error(env); process.exit(2); }
    let signer;
    try { signer = await SG.signerFromArgs(args, h.passphrase).init(); } catch (e) { console.error(e.message); process.exit(2); }
    tx = await signer.sign(tx);
    console.log(`signed by ${signer.publicKey} (stellar-cli identity ${signer.identity})`);
  }
  const r = await submitEnvelope(server, tx);
  writeEvidence(path.resolve(dir), name, {
    files: {
      [`${name}.xdr`]: given + '\n',
      [`${name}.signed.xdr`]: tx.toEnvelope().toXDR('base64') + '\n',
      [`${name}.horizon.json`]: JSON.stringify(r.horizon_response ?? { timeout: true, hash: r.hash, detail: r.detail }, null, 2) + '\n',
    },
    link: r.ok ? txLink(r.hash) : undefined,
  });
  if (r.ok) console.log(`landed in ledger ${r.ledger}: ${txLink(r.hash)}`);
  else if (r.ok === false) console.log(`refused by the network: ${JSON.stringify(r.codes)} (Horizon's answer in ${name}.horizon.json)`);
  else console.log(`no answer (${r.detail}); check ${r.hash} on Horizon before sending anything again`);
  process.exitCode = r.ok ? 0 : 1;
}

if (require.main === module) cli().catch((e) => { console.error('capture failed:', e.message); process.exitCode = 1; });

module.exports = { readEnvelopeFile, describeTx, submitEnvelope, writeEvidence, captureAccount, txLink, accountLink, sha256, EXPLORER };
