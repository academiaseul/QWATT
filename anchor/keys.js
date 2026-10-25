#!/usr/bin/env node
/**
 * QWATT — keys check and backup drill (freeze v3, V3-8: keys without a browser)
 * ---------------------------------------------------------------------------
 *   node anchor/keys.js check --sign-with-key <identity> [--expect G…] [--account G… --config anchor.json] [--stellar-bin stellar]
 *   node anchor/keys.js drill-xdr --account G_D [--date YYYY-MM-DD] --out drill.xdr [--config anchor.json | --horizon URL]
 *   node anchor/keys.js drill-submit --account G_D --proposer G… --verifier G… --third G… --evidence <dir> <file>…
 *
 * check: resolves a stellar-cli identity on this machine, signs one throwaway
 *   transaction offline (it expired in 1970 and is never submitted), reports the
 *   stellar-cli version, and with --expect / --account confirms the key is the
 *   expected one and a weight-1 signer of the account. On POSIX it stats the
 *   identity file (metadata only, never opened) and warns when group or others
 *   can read it. Exit 0 when every requested check passes, 1 otherwise.
 *
 * drill: with high threshold 3 a lost key freezes the signer set, so each holder
 *   proves their offline backup once, before the real account exists. drill-xdr
 *   builds an UNSIGNED throwaway transaction for a throwaway account configured
 *   like the anchoring account (2/2/3, three weight-1 signers, master 0):
 *   manageData qwatt.backup_drill plus a setOptions on the high threshold, so it
 *   lands only with all three keys. Each holder restores their key from paper
 *   into a `-restored` stellar-cli identity, signs drill.xdr, removes the
 *   identity, and returns the one printed line. drill-submit merges the three
 *   envelopes (same transaction, signers of the account only), submits once with
 *   all three or names the missing role, and stores every envelope, Horizon's
 *   answer and drill.json as evidence.
 *
 * Public data only: keys, envelopes and signatures. The stellar-cli forms in the
 * runbook are to confirm with stellar-cli 28.1.0 (founder step 0).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('@stellar/stellar-sdk');
const TH = require('./thresholds');
const SG = require('./signer');
const C = require('./capture');

const ROLES = ['proposer', 'verifier', 'third'];
const PINNED_STELLAR_CLI = '28.1.0';
const DRILL_WINDOW_S = 7 * 24 * 3600;

/** Where stellar-cli keeps an identity on POSIX: ${XDG_CONFIG_HOME:-~/.config}/stellar/identity/<id>.toml (to confirm on 28.1.0). */
const identityFile = (id) => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'stellar', 'identity', `${id}.toml`);

/**
 * Is this stellar-cli identity usable here, and is it the key it should be?
 * @param {{signer:object, expect?:string, account?:string, server?:object}} o
 * @returns {Promise<{ok:boolean, identity:string|null, publicKey:string, stellar_cli_version:string|null, expect_match:boolean|null, is_signer:boolean|null, warnings:string[]}>}
 */
async function checkIdentity({ signer, expect, account, server }) {
  const warnings = [];
  await signer.init();
  await SG.selfTest(signer, signer.passphrase || S.Networks.TESTNET);     // throws SignerError when stellar-cli cannot sign offline
  const version = await signer.version();
  const r = { ok: true, identity: signer.identity || null, publicKey: signer.publicKey, stellar_cli_version: version, offline_signature: true, expect_match: null, is_signer: null, warnings };
  if (version && version !== PINNED_STELLAR_CLI) warnings.push(`stellar-cli ${version} is not the pinned ${PINNED_STELLAR_CLI}`);
  if (expect) {
    r.expect_match = signer.publicKey === expect;
    if (!r.expect_match) { r.ok = false; warnings.push(`the identity's key ${signer.publicKey} is not the expected ${expect}`); }
  }
  if (account) {
    const a = await server.loadAccount(account);
    const s = a.signers.find((x) => x.key === signer.publicKey && x.key !== account);
    r.is_signer = !!s && s.weight === 1;
    if (!r.is_signer) { r.ok = false; warnings.push(`${signer.publicKey} is not a weight-1 signer of ${account}`); }
  }
  if (process.platform !== 'win32' && signer.identity) {
    const f = identityFile(signer.identity);
    let st = null;
    try { st = fs.statSync(f); } catch (e) { warnings.push(`no identity file at ${f}; stellar-cli may keep it elsewhere (permissions not checked)`); }
    if (st && (st.mode & 0o077)) warnings.push(`${f} is readable by group or others (mode ${(st.mode & 0o777).toString(8)}): run chmod -R go-rwx on its stellar directory (directory 700, files 600; docs/RUNBOOK.md, setup step 2)`);
  }
  return r;
}

/** The account must be configured like the anchoring account: 2/2/3, master weight 0, exactly three weight-1 signers. */
function assertAnchorShaped(a, account) {
  if (!TH.matches(a.thresholds)) throw new Error(`${account} is not at thresholds ${TH.LABEL}: not configured like the anchoring account`);
  const master = a.signers.find((s) => s.key === account);
  if ((master ? master.weight : 0) !== 0) throw new Error(`${account}: master weight is not 0`);
  const others = a.signers.filter((s) => s.key !== account);
  if (others.length !== 3 || others.some((s) => s.weight !== 1)) throw new Error(`${account}: not exactly three signers of weight 1`);
}

/** The UNSIGNED drill transaction: valid for 7 days so it can travel to three holders; lands only with all three keys. */
async function buildDrillTx(server, account, date = new Date().toISOString().slice(0, 10), passphrase = S.Networks.TESTNET) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
  const a = await server.loadAccount(account);
  assertAnchorShaped(a, account);
  return new S.TransactionBuilder(a, { fee: String(S.BASE_FEE), networkPassphrase: passphrase })
    .addOperation(S.Operation.manageData({ name: 'qwatt.backup_drill', value: date }))
    .addOperation(S.Operation.setOptions({ highThreshold: TH.THRESHOLDS.high }))   // a HIGH-threshold operation that changes nothing
    .addMemo(S.Memo.text('QWATT backup drill'))
    .setTimeout(DRILL_WINDOW_S)
    .build();
}

const envelopeXdr = (e) => (typeof e === 'string' ? e.trim() : e.toEnvelope().toXDR('base64'));
/** The signer key behind a signature, or null. */
function keyOfSignature(hash, sig, keys) {
  return keys.find((k) => { const kp = S.Keypair.fromPublicKey(k); return kp.signatureHint().equals(sig.hint()) && kp.verify(hash, sig.signature()); }) || null;
}

/**
 * Merge separately signed envelopes of ONE transaction.
 * @returns {{tx:object, signedBy:string[]}}
 * @throws on an envelope for another transaction, or a signature from a key that is not a signer
 */
function mergeSignatures(passphrase, envelopes, signerKeys) {
  if (!envelopes || !envelopes.length) throw new Error('no envelope to merge');
  const txs = envelopes.map((e) => new S.Transaction(envelopeXdr(e), passphrase));
  const merged = new S.Transaction(txs[0].toEnvelope().toXDR('base64'), passphrase);
  merged.signatures.length = 0;
  const hash = merged.hash();
  const signedBy = [];
  for (const t of txs) {
    if (!t.hash().equals(hash)) throw new Error(`envelope for another transaction (${t.hash().toString('hex').slice(0, 12)}…, expected ${hash.toString('hex').slice(0, 12)}…)`);
    for (const sig of t.signatures) {
      const key = keyOfSignature(hash, sig, signerKeys);
      if (!key) throw new Error(`a signature (hint ${sig.hint().toString('hex')}) from a key which is not a signer of the account: that backup does not restore a signer key`);
      if (!signedBy.includes(key)) { signedBy.push(key); merged.signatures.push(sig); }
    }
  }
  return { tx: merged, signedBy };
}

/**
 * Merge, then submit once with all three roles, and store the evidence.
 * @param {{server:object, account:string, envelopes:(string|object)[], roles:{proposer:string, verifier:string, third:string}, evidenceDir?:string, passphrase?:string}} o
 */
async function submitDrill({ server, account, envelopes, roles, evidenceDir, passphrase = S.Networks.TESTNET }) {
  const a = await server.loadAccount(account);
  assertAnchorShaped(a, account);
  const signerKeys = a.signers.filter((s) => s.key !== account && s.weight > 0).map((s) => s.key);
  for (const role of ROLES) if (!signerKeys.includes(roles[role])) throw new Error(`the ${role} key ${roles[role]} is not a signer of ${account}`);
  const { tx, signedBy } = mergeSignatures(passphrase, envelopes, signerKeys);
  const signed_by = Object.fromEntries(ROLES.filter((r) => signedBy.includes(roles[r])).map((r) => [r, roles[r]]));
  const missing = ROLES.filter((r) => !signed_by[r]);
  if (missing.length) return { ok: false, missing, signed_by, submitted: false };

  const r = await C.submitEnvelope(server, tx);
  const result = { ...r, missing: [], signed_by, submitted: true };
  if (evidenceDir) {
    const unsigned = new S.Transaction(tx.toEnvelope().toXDR('base64'), passphrase);
    unsigned.signatures.length = 0;
    const files = { 'drill.unsigned.xdr': unsigned.toEnvelope().toXDR('base64') + '\n' };
    for (const e of envelopes) {
      const t = new S.Transaction(envelopeXdr(e), passphrase);
      const who = ROLES.filter((role) => t.signatures.some((sig) => keyOfSignature(t.hash(), sig, [roles[role]])));
      if (who.length) files[`drill.${who.join('+')}.xdr`] = envelopeXdr(e) + '\n';
    }
    files['drill.merged.xdr'] = tx.toEnvelope().toXDR('base64') + '\n';
    files['drill.horizon.json'] = JSON.stringify(r.horizon_response ?? { timeout: true, hash: r.hash, detail: r.detail }, null, 2) + '\n';
    files['drill.json'] = JSON.stringify({ account, tx_hash: r.hash, link: C.txLink(r.hash), signed_by, at: new Date().toISOString(), ok: r.ok === true }, null, 2) + '\n';
    C.writeEvidence(evidenceDir, 'drill', { files, link: r.ok ? C.txLink(r.hash) : undefined });
  }
  return result;
}

async function cli() {
  const args = process.argv.slice(2);
  const VALUED = new Set(['--sign-with-key', '--stellar-bin', '--expect', '--account', '--config', '--horizon', '--date', '--out', '--proposer', '--verifier', '--third', '--evidence']);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const positional = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && VALUED.has(all[i - 1])));
  const usage = [
    'usage: node anchor/keys.js check --sign-with-key <identity> [--expect G…] [--account G… --config anchor.json] [--stellar-bin stellar]',
    '       node anchor/keys.js drill-xdr --account G… [--date YYYY-MM-DD] --out drill.xdr [--config anchor.json | --horizon URL]',
    '       node anchor/keys.js drill-submit --account G… --proposer G… --verifier G… --third G… --evidence <dir> <file>…',
  ].join('\n');
  const { loadConfig } = require('./proposer');
  const cfg = opt('--config') ? loadConfig(opt('--config')) : null;
  const passphrase = cfg ? cfg.network_passphrase : S.Networks.TESTNET;
  const horizon = opt('--horizon') || (cfg && cfg.horizon_url) || 'https://horizon-testnet.stellar.org';
  const server = new S.Horizon.Server(horizon);

  const sub = args[0];
  if (sub === 'check') {
    const env = SG.refuseEnvSecrets(['QWATT_PROPOSER_SECRET', 'QWATT_VERIFIER_SECRET']);
    if (env) { console.error(env); process.exit(2); }
    let signer;
    try { signer = SG.signerFromArgs(args, passphrase); } catch (e) { console.error(`${e.message}\n${usage}`); process.exit(2); }
    let r;
    try { r = await checkIdentity({ signer, expect: opt('--expect'), account: opt('--account'), server }); } catch (e) { console.error(`NOT OK: ${e.message}`); process.exit(1); }
    console.log(`identity     ${r.identity}`);
    console.log(`public key   ${r.publicKey}`);
    console.log(`stellar-cli  ${r.stellar_cli_version}`);
    console.log('offline signature  ok (a throwaway transaction, never submitted)');
    if (r.expect_match !== null) console.log(`--expect     ${r.expect_match ? 'matches' : 'DOES NOT MATCH'}`);
    if (r.is_signer !== null) console.log(`--account    ${r.is_signer ? 'a signer of weight 1' : 'NOT a signer of weight 1'}`);
    for (const w of r.warnings) console.log(`warning: ${w}`);
    console.log(r.ok ? 'OK' : 'NOT OK');
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  if (sub === 'drill-xdr') {
    const account = opt('--account'), out = opt('--out');
    if (!account || !out) { console.error(usage); process.exit(2); }
    const tx = await buildDrillTx(server, account, opt('--date'), passphrase);
    fs.writeFileSync(path.resolve(out), tx.toEnvelope().toXDR('base64') + '\n');
    console.log(`UNSIGNED drill transaction for ${account} → ${path.resolve(out)}`);
    console.log(`  hash ${tx.hash().toString('hex')} · valid until ${new Date(Number(tx.timeBounds.maxTime) * 1000).toISOString()}`);
    console.log('  send it (public data) to the three holders; each signs it with the identity restored from their backup and returns the printed line');
    return;
  }
  if (sub === 'drill-submit') {
    const account = opt('--account'), evidence = opt('--evidence');
    const roles = { proposer: opt('--proposer'), verifier: opt('--verifier'), third: opt('--third') };
    if (!account || !evidence || ROLES.some((r) => !roles[r]) || !positional.length) { console.error(usage); process.exit(2); }
    const envelopes = positional.map((f) => C.readEnvelopeFile(f));
    const r = await submitDrill({ server, account, envelopes, roles, evidenceDir: path.resolve(evidence), passphrase });
    if (r.ok) console.log(`backup drill landed, signed by ${Object.keys(r.signed_by).join(', ')}: ${C.txLink(r.hash)}`);
    else if (r.submitted === false) console.log(`not submitted: missing ${r.missing.join(', ')}. That holder repeats their step.`);
    else if (r.ok === false) console.log(`refused by the network: ${JSON.stringify(r.codes)}`);
    else console.log(`no answer (${r.detail}); check ${r.hash} on Horizon before sending anything again`);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  console.error(usage);
  process.exit(2);
}

if (require.main === module) cli().catch((e) => { console.error('keys failed:', e.message); process.exitCode = 1; });

module.exports = { checkIdentity, buildDrillTx, mergeSignatures, submitDrill, identityFile, PINNED_STELLAR_CLI, ROLES };
