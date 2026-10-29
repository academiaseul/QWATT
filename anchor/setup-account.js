#!/usr/bin/env node
/**
 * QWATT — set up the real 2-of-3 anchoring account from public keys only (plan unit 3.1; freeze v3, V3-4, V3-8)
 * ---------------------------------------------------------------------------
 * Testnet only. This tool never creates, reads or stores a secret. The holder of a
 * throwaway setup key signs with stellar-cli on their own computer, and the tool
 * re-derives everything it is asked to submit from the four public keys.
 *
 *   1. holder:  stellar keys generate qwatt-anchor-setup --network testnet --fund
 *               (Friendbot creates and funds the account; if it is down, retry later:
 *                node anchor/setup-account.js friendbot --account G…)
 *   2. build:   node anchor/setup-account.js build --account G… --proposer G… --verifier G… --third G… --out setup.xdr
 *   3. submit:  node anchor/setup-account.js submit setup.xdr --account G… --proposer G… --verifier G… --third G… \
 *                    --sign-with-key qwatt-anchor-setup --evidence evidence/account/<G…> --out anchor.json
 *               (--out only for the real account: without it, as in the backup drill, no public
 *               config is written and no funding step is printed)
 *   4. holder:  stellar keys rm qwatt-anchor-setup   (its weight is 0 now, so it can sign nothing)
 *   5. funding: node anchor/setup-account.js fund-xdr --account G… --out funding.xdr; the treasury holder
 *               checks, signs and submits it with stellar-cli on their own computer:
 *               node anchor/setup-account.js fund-submit funding.xdr --account G… --sign-with-key qwatt-treasury --evidence <dir>
 *               (it rebuilds the 1-QWATT payment from public values and refuses any other envelope
 *               before stellar-cli signs)
 *   6. check:   node anchor/setup-account.js --verify G… --proposer G… --verifier G… --third G… [--evidence <dir>]
 *
 * The stellar-cli forms in steps 1, 4 and 5 are to confirm with stellar-cli 28.1.0
 * (founder step 0).
 *
 * ONE atomic setup transaction adds the QWATT trustline, the three signers (weight
 * 1 each), thresholds low 2 / medium 2 / high 3 (thresholds.js) and master weight
 * 0. After it, no single key can send any transaction for the account: every
 * transaction needs the LOW threshold (2) for its fee and sequence, so the network
 * rejects a one-key transaction as tx_bad_auth, BumpSequence included. Anchoring
 * needs two of the three keys; changing signers or thresholds needs all three.
 *
 * `build` refuses an account that is not fresh (any signer, threshold or QWATT
 * trustline already set: a setup that already landed is caught here too).
 * `submit` rebuilds the transaction from the public keys and refuses an envelope
 * that differs (matchSetup, the same rebuild-and-compare idea as tx.js
 * matchPending), requires exactly one signature, the account key's, submits it
 * once and stores the envelopes, Horizon's answer and the account as evidence
 * (capture.js). A setup envelope that never expires, or is valid for more than
 * an hour, is refused too. `fund-submit` does the same for the treasury's
 * funding payment (matchFunding): exactly one payment of 1 QWATT from the
 * treasury to the account, nothing else, signed by the treasury key only. The account is always created with all three keys: at 2/2/3 a
 * signer can be added later only with all three signatures, so there is no
 * two-signer mode.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const S = require('@stellar/stellar-sdk');
const TH = require('./thresholds');
const C = require('./capture');

const DEFAULTS = {
  horizon_url: 'https://horizon-testnet.stellar.org',
  friendbot_url: 'https://friendbot.stellar.org',
  network_passphrase: S.Networks.TESTNET,
  asset_code: 'QWATT',
  asset_issuer: 'GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46',
  treasury: 'GCLS6EE5UNXFNK44SQGD4F3TYYFE7QCJX2QEXQ5E4TOQSAQBZUXTSOKW',
  funding_amount: '1',
  payment_amount: '0.0000001',
};

const MEMO = 'QWATT anchoring 2-of-3';
/** The setup transaction is valid for one hour; if signing takes longer, build again (the sequence is unchanged). */
const SETUP_WINDOW_S = 3600;
const CLOCK_SLACK_S = 300;
/** The funding transaction travels to the treasury holder: valid for 7 days. */
const FUNDING_WINDOW_S = 7 * 24 * 3600;
const FUNDING_MEMO = 'fund QWATT anchoring';

function assertKey(k, name) {
  if (!k || !S.StrKey.isValidEd25519PublicKey(k)) throw new Error(`${name}: a valid G… public key is required`);
}

/** The account and three distinct signers, none of them the account itself. */
function checkKeys(o) {
  for (const n of ['account', 'proposer', 'verifier', 'third']) assertKey(o[n], n);
  if (new Set([o.proposer, o.verifier, o.third]).size !== 3) throw new Error('the three signers must be three different keys');
  for (const n of ['proposer', 'verifier', 'third']) {
    if (o[n] === o.account) throw new Error(`${n}: a signer cannot be the account itself (the setup sets its master weight to 0)`);
  }
}

/**
 * The setup transaction, built from public values only (pure).
 * @param {object} o           DEFAULTS plus account, proposer, verifier, third
 * @param {{accountId:string, sequence:string}} source   the account and its CURRENT sequence (the transaction uses +1)
 * @param {{minTime:number|string, maxTime:number|string}} timebounds
 */
function setupTxFor(o, source, timebounds) {
  const asset = new S.Asset(o.asset_code, o.asset_issuer);
  return new S.TransactionBuilder(new S.Account(source.accountId, String(source.sequence)), {
    fee: String(S.BASE_FEE), networkPassphrase: o.network_passphrase, timebounds: { minTime: timebounds.minTime, maxTime: timebounds.maxTime },
  })
    .addOperation(S.Operation.changeTrust({ asset }))
    .addOperation(S.Operation.setOptions({ signer: { ed25519PublicKey: o.proposer, weight: 1 } }))
    .addOperation(S.Operation.setOptions({ signer: { ed25519PublicKey: o.verifier, weight: 1 } }))
    .addOperation(S.Operation.setOptions({ signer: { ed25519PublicKey: o.third, weight: 1 } }))
    .addOperation(S.Operation.setOptions({ masterWeight: 0, ...TH.setOptionsFields() }))
    .addMemo(S.Memo.text(MEMO))
    .build();
}

/** Step 2: the UNSIGNED setup transaction for a fresh, funded account. */
async function buildSetupTx(server, o, nowS = Math.floor(Date.now() / 1000)) {
  checkKeys(o);
  const a = await server.loadAccount(o.account);
  const master = a.signers.find((s) => s.key === o.account);
  const others = a.signers.filter((s) => s.key !== o.account);
  const th = a.thresholds || {};
  const line = (a.balances || []).find((b) => b.asset_code === o.asset_code && b.asset_issuer === o.asset_issuer);
  const fresh = others.length === 0 && !!master && master.weight === 1 && !th.low_threshold && !th.med_threshold && !th.high_threshold && !line;
  if (!fresh) throw new Error(`${o.account} is not a fresh account (it already has signers, thresholds or a ${o.asset_code} trustline): run --verify`);
  const minTime = nowS - CLOCK_SLACK_S;
  return setupTxFor(o, { accountId: o.account, sequence: a.sequence }, { minTime, maxTime: minTime + SETUP_WINDOW_S });
}

/**
 * Is this envelope exactly the setup transaction for these public keys? Rebuilt from the
 * public keys with only the sequence and timebounds borrowed from the envelope.
 * @returns {{match:boolean, tx:object|null, detail:string|null}}
 */
function matchSetup(xdr, o) {
  let tx;
  try { tx = new S.Transaction(typeof xdr === 'string' ? xdr : xdr.toEnvelope().toXDR('base64'), o.network_passphrase); } catch (e) { return { match: false, tx: null, detail: 'unparseable XDR: ' + e.message }; }
  try { checkKeys(o); } catch (e) { return { match: false, tx, detail: e.message }; }
  if (tx.source !== o.account) return { match: false, tx, detail: `the envelope's source ${tx.source} is not the account ${o.account}` };
  if (!tx.timeBounds) return { match: false, tx, detail: 'the envelope has no timebounds' };
  const minTime = Number(tx.timeBounds.minTime), maxTime = Number(tx.timeBounds.maxTime);
  if (maxTime === 0) return { match: false, tx, detail: 'the envelope never expires (maxTime 0): build it again' };
  if (maxTime - minTime > SETUP_WINDOW_S) return { match: false, tx, detail: `the envelope is valid for ${maxTime - minTime} s, more than the setup's ${SETUP_WINDOW_S} s: build it again` };
  const rebuilt = setupTxFor(o, { accountId: tx.source, sequence: (BigInt(tx.sequence) - 1n).toString() }, tx.timeBounds);
  const same = rebuilt.hash().equals(tx.hash());
  return { match: same, tx, detail: same ? null : 'the envelope is not the setup transaction for these public keys (the rebuilt transaction differs)' };
}

/** An envelope given as a Transaction, a base64 string or a file. */
function envelopeOf(input) {
  if (typeof input !== 'string') return input.toEnvelope().toXDR('base64');
  const t = input.trim();
  if (t.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(t)) return t;
  return C.readEnvelopeFile(input);
}

/**
 * Step 3: re-derive, sign with stellar-cli (optional: the envelope may already carry the signature),
 * check the one signature is the account key's, submit once and store the evidence.
 * @param {object} server
 * @param {object|string} input      the setup transaction: Transaction, base64 or a file
 * @param {object} o
 * @param {{signer?:object, evidenceDir?:string}} [x]
 */
async function submitSetup(server, input, o, { signer, evidenceDir } = {}) {
  const xdr = envelopeOf(input);
  const m = matchSetup(xdr, o);
  if (!m.match) throw new Error(`refusing to submit: ${m.detail}`);
  const unsigned = new S.Transaction(xdr, o.network_passphrase);
  unsigned.signatures.length = 0;
  let tx = m.tx;
  if (signer) {
    if (!signer.publicKey) await signer.init();
    if (signer.publicKey !== o.account) throw new Error(`the signing identity's key ${signer.publicKey} is not the account ${o.account}`);
    if (tx.signatures.length) throw new Error('the envelope is already signed; submit it without --sign-with-key');
    tx = await signer.sign(tx);
  }
  if (tx.signatures.length !== 1) throw new Error(`the setup transaction must carry exactly one signature, the account key's (it carries ${tx.signatures.length})`);
  const kp = S.Keypair.fromPublicKey(o.account), sig = tx.signatures[0];
  if (!sig.hint().equals(kp.signatureHint()) || !kp.verify(tx.hash(), sig.signature())) throw new Error('the signature is not the account key\'s');
  const r = await C.submitEnvelope(server, tx);
  if (evidenceDir) {
    C.writeEvidence(evidenceDir, 'setup', {
      files: {
        'setup.unsigned.xdr': unsigned.toEnvelope().toXDR('base64') + '\n',
        'setup.signed.xdr': tx.toEnvelope().toXDR('base64') + '\n',
        'setup.horizon.json': JSON.stringify(r.horizon_response ?? { timeout: true, hash: r.hash, detail: r.detail }, null, 2) + '\n',
      },
      link: r.ok ? C.txLink(r.hash) : undefined,
    });
    if (r.ok) await C.captureAccount(server, o.account, evidenceDir, { horizonUrl: o.horizon_url });
  }
  return r;
}

/** Friendbot, for a public key (the fallback for `stellar keys generate --fund`). Never another faucet. */
async function friendbot(o, account) {
  assertKey(account, 'account');
  const r = await fetch(`${(o && o.friendbot_url) || DEFAULTS.friendbot_url}?addr=${encodeURIComponent(account)}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}: retry later (never use another faucet)`);
  return true;
}

/**
 * The 1-QWATT funding transaction, built from public values only (pure): one payment of
 * o.funding_amount QWATT from the treasury to the account, memo "fund QWATT anchoring".
 * @param {{accountId:string, sequence:string}} source   the treasury and its CURRENT sequence
 */
function fundingTxFor(o, source, account, timebounds) {
  return new S.TransactionBuilder(new S.Account(source.accountId, String(source.sequence)), {
    fee: String(S.BASE_FEE), networkPassphrase: o.network_passphrase, timebounds: { minTime: timebounds.minTime, maxTime: timebounds.maxTime },
  })
    .addOperation(S.Operation.payment({ destination: account, asset: new S.Asset(o.asset_code, o.asset_issuer), amount: o.funding_amount }))
    .addMemo(S.Memo.text(FUNDING_MEMO))
    .build();
}

/** Step 5: the unsigned 1-QWATT funding transaction, for the treasury holder to check and sign (valid 7 days). */
async function fundingXdr(server, o, account, nowS = Math.floor(Date.now() / 1000)) {
  assertKey(account, 'account');
  const t = await server.loadAccount(o.treasury);
  return fundingTxFor(o, { accountId: o.treasury, sequence: t.sequence }, account, { minTime: 0, maxTime: nowS + FUNDING_WINDOW_S }).toEnvelope().toXDR('base64');
}

/**
 * Is this envelope exactly the funding transaction for this account? Rebuilt from public values
 * with only the sequence and timebounds borrowed from the envelope, so another amount, asset,
 * destination or source, or any extra operation, does not match.
 * @returns {{match:boolean, tx:object|null, detail:string|null}}
 */
function matchFunding(xdr, o, account, nowS = Math.floor(Date.now() / 1000)) {
  let tx;
  try { tx = new S.Transaction(typeof xdr === 'string' ? xdr : xdr.toEnvelope().toXDR('base64'), o.network_passphrase); } catch (e) { return { match: false, tx: null, detail: 'unparseable XDR: ' + e.message }; }
  try { assertKey(account, 'account'); assertKey(o.treasury, 'treasury'); } catch (e) { return { match: false, tx, detail: e.message }; }
  if (tx.source !== o.treasury) return { match: false, tx, detail: `the envelope's source ${tx.source} is not the treasury ${o.treasury}` };
  const maxTime = tx.timeBounds ? Number(tx.timeBounds.maxTime) : 0;
  if (maxTime === 0) return { match: false, tx, detail: 'the envelope never expires (maxTime 0): make it again with fund-xdr' };
  if (maxTime > nowS + FUNDING_WINDOW_S + CLOCK_SLACK_S) return { match: false, tx, detail: `the envelope is valid until ${new Date(maxTime * 1000).toISOString()}, longer than fund-xdr's 7 days` };
  const rebuilt = fundingTxFor(o, { accountId: tx.source, sequence: (BigInt(tx.sequence) - 1n).toString() }, account, tx.timeBounds);
  const same = rebuilt.hash().equals(tx.hash());
  return { match: same, tx, detail: same ? null : `the envelope is not the funding transaction (one payment of ${o.funding_amount} ${o.asset_code} from the treasury to ${account}, nothing else): the rebuilt transaction differs` };
}

/**
 * Step 5, treasury side: check the envelope (matchFunding) BEFORE anything signs, have the treasury's
 * stellar-cli identity add the one signature, submit once and store the evidence.
 * @param {{signer?:object, evidenceDir?:string}} [x]   without signer, the envelope must already carry the treasury's signature
 */
async function submitFunding(server, input, o, account, { signer, evidenceDir } = {}) {
  const xdr = envelopeOf(input);
  const m = matchFunding(xdr, o, account);
  if (!m.match) throw new Error(`refusing to sign or submit: ${m.detail}`);
  const unsigned = new S.Transaction(xdr, o.network_passphrase);
  unsigned.signatures.length = 0;
  let tx = m.tx;
  if (signer) {
    if (tx.signatures.length) throw new Error('the envelope is already signed; submit it without --sign-with-key');
    if (!signer.publicKey) await signer.init();
    if (signer.publicKey !== o.treasury) throw new Error(`refusing to sign: the signing identity's key ${signer.publicKey} is not the treasury ${o.treasury}`);
    tx = await signer.sign(tx);
  }
  if (tx.signatures.length !== 1) throw new Error(`the funding transaction must carry exactly one signature, the treasury key's (it carries ${tx.signatures.length})`);
  const kp = S.Keypair.fromPublicKey(o.treasury), sig = tx.signatures[0];
  if (!sig.hint().equals(kp.signatureHint()) || !kp.verify(tx.hash(), sig.signature())) throw new Error('the signature is not the treasury key\'s');
  const r = await C.submitEnvelope(server, tx);
  if (evidenceDir) {
    C.writeEvidence(evidenceDir, 'funding', {
      files: {
        'funding.unsigned.xdr': unsigned.toEnvelope().toXDR('base64') + '\n',
        'funding.signed.xdr': tx.toEnvelope().toXDR('base64') + '\n',
        'funding.horizon.json': JSON.stringify(r.horizon_response ?? { timeout: true, hash: r.hash, detail: r.detail }, null, 2) + '\n',
      },
      link: r.ok ? C.txLink(r.hash) : undefined,
    });
  }
  return r;
}

/** What the treasury holder runs, with stellar-cli on their own computer. Never a browser, never an unchecked envelope. */
function fundingInstructions(account, file = 'funding.xdr', evidenceDir = `evidence/account/${account}`) {
  return [
    'the treasury key holder checks, signs and submits it with stellar-cli on their own computer, in one step;',
    'it refuses any envelope that is not exactly this payment before stellar-cli signs:',
    `  node anchor/setup-account.js fund-submit ${file} --account ${account} --sign-with-key qwatt-treasury --evidence ${evidenceDir}`,
    '(the treasury key is the stellar-cli identity qwatt-treasury; stellar-cli forms to confirm with stellar-cli 28.1.0, founder step 0)',
  ];
}

/** Step 6: everything the freeze requires, checked on Horizon. @returns {{ok:boolean, checks:object[]}} */
async function verifyAccount(server, o, account) {
  const a = await server.loadAccount(account);
  const weights = Object.fromEntries(a.signers.map((s) => [s.key, s.weight]));
  const line = a.balances.find((b) => b.asset_code === o.asset_code && b.asset_issuer === o.asset_issuer);
  const checks = [
    [`thresholds ${TH.LABEL}`, TH.matches(a.thresholds)],
    ['master weight 0', (weights[account] ?? 0) === 0],
    ['exactly three signers of weight 1', a.signers.filter((s) => s.key !== account && s.weight === 1).length === 3 && a.signers.filter((s) => s.key !== account).length === 3],
    ['proposer is a signer', weights[o.proposer] === 1],
    ['verifier is a signer', weights[o.verifier] === 1],
    ['third signer is a signer', weights[o.third] === 1],
    [`${o.asset_code} trustline`, !!line],
    [`${o.asset_code} balance covers payments`, !!line && Number(line.balance) >= Number(o.payment_amount)],
  ].map(([name, ok]) => ({ name, ok }));
  return { ok: checks.every((c) => c.ok), checks, balance: line ? line.balance : null };
}

/**
 * What `submit` prints and writes once the setup landed. The public config (anchor.json) and the
 * funding step belong to the real account only, so they need --out: the backup drill's throwaway
 * account and rehearsals pass none, and never replace the config the services read.
 * @returns {{lines:string[], config:{file:string, json:object}|null}}
 */
function afterSetup(o, r, { out, identity = 'qwatt-anchor-setup' } = {}) {
  const config = out ? { file: path.resolve(out), json: configFor(o, o.account) } : null;
  const lines = [
    `anchoring account ${o.account} configured in ${r.hash} (ledger ${r.ledger})`,
    `  ${C.txLink(r.hash)}`,
    '  no single key can send any transaction for it; anchoring needs 2 of the 3 keys; changing signers needs all 3',
    config ? `  public config written to ${config.file}` : '  no --out, so no anchor.json: a drill or rehearsal account never replaces the services\' config',
    '',
    `NEXT — remove the setup identity (weight 0 now): stellar keys rm ${identity}`,
  ];
  if (config) lines.push(`then the funding transaction: node anchor/setup-account.js fund-xdr --account ${o.account} --out funding.xdr`);
  return { lines, config };
}

/** The public config the proposer and verifier read: public values only, each signer by role. */
function configFor(o, account) {
  return {
    network_passphrase: 'TESTNET',
    horizon_url: o.horizon_url,
    anchor_account: account,
    asset_code: o.asset_code,
    asset_issuer: o.asset_issuer,
    payment_destination: o.treasury,
    payment_amount: o.payment_amount,
    base_fee: Number(S.BASE_FEE),
    signers: { proposer: o.proposer, verifier: o.verifier, third: o.third },
  };
}

const USAGE = [
  'usage: node anchor/setup-account.js build     --account G… --proposer G… --verifier G… --third G… [--out setup.xdr]',
  '       node anchor/setup-account.js submit <file> --account G… --proposer G… --verifier G… --third G… [--sign-with-key <identity>] --evidence <dir> [--out anchor.json]',
  '         (--out only for the real account: it writes the public config; the backup drill passes none)',
  '       node anchor/setup-account.js fund-xdr  --account G… [--out funding.xdr]',
  '       node anchor/setup-account.js fund-submit <file> --account G… --sign-with-key qwatt-treasury --evidence <dir>',
  '       node anchor/setup-account.js friendbot --account G…',
  '       node anchor/setup-account.js config    --account G… --proposer G… --verifier G… --third G… --out anchor.json',
  '       node anchor/setup-account.js --verify G… --proposer G… --verifier G… --third G… [--evidence <dir>]',
  '  (each also takes --horizon URL; default: the testnet Horizon)',
].join('\n');

async function cli() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const o = { ...DEFAULTS, horizon_url: opt('--horizon', DEFAULTS.horizon_url), account: opt('--account'), proposer: opt('--proposer'), verifier: opt('--verifier'), third: opt('--third') };
  const server = new S.Horizon.Server(o.horizon_url);
  const roles = `--proposer ${o.proposer || 'G…'} --verifier ${o.verifier || 'G…'} --third ${o.third || 'G…'}`;

  const existing = opt('--verify');
  if (existing) {
    const v = await verifyAccount(server, o, existing);
    for (const c of v.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}`);
    console.log(v.ok ? 'anchoring account OK' : 'anchoring account NOT ready');
    if (opt('--evidence')) { await C.captureAccount(server, existing, path.resolve(opt('--evidence')), { horizonUrl: o.horizon_url }); console.log(`  account captured in ${opt('--evidence')}`); }
    process.exitCode = v.ok ? 0 : 1;
    return;
  }

  const sub = args[0];
  if (sub === 'build') {
    const tx = await buildSetupTx(server, o);
    const out = path.resolve(opt('--out', 'setup.xdr'));
    fs.writeFileSync(out, tx.toEnvelope().toXDR('base64') + '\n');
    console.log(`UNSIGNED setup transaction for ${o.account} → ${out}`);
    console.log(`  hash ${tx.hash().toString('hex')} · valid until ${new Date(Number(tx.timeBounds.maxTime) * 1000).toISOString()}`);
    console.log('  trustline, three signers of weight 1, thresholds 2/2/3, master weight 0 — one transaction');
    console.log('\nNEXT — the holder of the setup identity signs and submits it (stellar-cli on their own computer):');
    console.log(`  node anchor/setup-account.js submit ${path.basename(out)} --account ${o.account} ${roles} --sign-with-key qwatt-anchor-setup --evidence evidence/account/${o.account} --out anchor.json`);
    return;
  }
  if (sub === 'submit') {
    const file = args[1];
    const evidenceDir = opt('--evidence');
    if (!file || file.startsWith('--') || !evidenceDir) { console.error(USAGE); process.exit(2); }
    let signer;
    if (args.includes('--sign-with-key')) {
      const SG = require('./signer');
      try { signer = SG.signerFromArgs(args, o.network_passphrase); } catch (e) { console.error(e.message); process.exit(2); }
    }
    const r = await submitSetup(server, file, o, { signer, evidenceDir: path.resolve(evidenceDir) });
    if (r.ok) {
      const a = afterSetup(o, r, { out: opt('--out'), identity: opt('--sign-with-key', 'qwatt-anchor-setup') });
      if (a.config) fs.writeFileSync(a.config.file, JSON.stringify(a.config.json, null, 2) + '\n');
      for (const l of a.lines) console.log(l);
    } else if (r.ok === false) {
      console.log(`refused by the network: ${JSON.stringify(r.codes)} (Horizon's answer in ${path.join(evidenceDir, 'setup.horizon.json')})`);
    } else {
      console.log(`no answer (${r.detail}); check ${r.hash} on Horizon before sending anything again (build refuses an account that is already set up)`);
    }
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  if (sub === 'fund-xdr') {
    assertKey(o.account, 'account');
    const out = path.resolve(opt('--out', 'funding.xdr'));
    fs.writeFileSync(out, (await fundingXdr(server, o, o.account)) + '\n');
    console.log(`UNSIGNED funding transaction (${o.funding_amount} ${o.asset_code} from the treasury to ${o.account}) → ${out}`);
    for (const l of fundingInstructions(o.account, path.basename(out))) console.log(l);
    console.log(`then check: node anchor/setup-account.js --verify ${o.account} ${roles}`);
    return;
  }
  if (sub === 'fund-submit') {
    const file = args[1];
    const evidenceDir = opt('--evidence');
    if (!file || file.startsWith('--') || !evidenceDir || !args.includes('--sign-with-key')) { console.error(USAGE); process.exit(2); }
    const xdr = C.readEnvelopeFile(file);
    const m = matchFunding(xdr, o, o.account);
    if (!m.match) throw new Error(`refusing to sign or submit: ${m.detail}`);
    console.log(`checked: exactly the funding transaction (${o.funding_amount} ${o.asset_code} from the treasury to ${o.account}); to sign with stellar-cli and submit once:`);
    for (const l of C.describeTx(m.tx)) console.log(l);
    const SG = require('./signer');
    const env = SG.refuseEnvSecrets(['QWATT_PROPOSER_SECRET', 'QWATT_VERIFIER_SECRET']);
    if (env) { console.error(env); process.exit(2); }
    let signer;
    try { signer = await SG.signerFromArgs(args, o.network_passphrase).init(); } catch (e) { console.error(e.message); process.exit(2); }
    const r = await submitFunding(server, xdr, o, o.account, { signer, evidenceDir: path.resolve(evidenceDir) });
    if (r.ok) {
      console.log(`funded ${o.account} with ${o.funding_amount} ${o.asset_code}: ${C.txLink(r.hash)}`);
      console.log(`then check: node anchor/setup-account.js --verify ${o.account} ${roles}`);
    } else if (r.ok === false) {
      console.log(`refused by the network: ${JSON.stringify(r.codes)} (Horizon's answer in ${path.join(evidenceDir, 'funding.horizon.json')})`);
    } else {
      console.log(`no answer (${r.detail}); check ${r.hash} on Horizon before sending anything again`);
    }
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  if (sub === 'friendbot') {
    await friendbot(o, o.account);
    console.log(`funded ${o.account} with test XLM (Friendbot)`);
    return;
  }
  if (sub === 'config') {
    checkKeys(o);
    const out = opt('--out');
    if (!out) { console.error(USAGE); process.exit(2); }
    fs.writeFileSync(path.resolve(out), JSON.stringify(configFor(o, o.account), null, 2) + '\n');
    console.log(`public config written to ${path.resolve(out)}`);
    return;
  }
  console.error(USAGE);
  process.exit(2);
}

if (require.main === module) cli().catch((e) => { console.error('setup failed:', e.message); process.exitCode = 1; });

module.exports = { setupTxFor, buildSetupTx, matchSetup, submitSetup, afterSetup, friendbot, fundingTxFor, fundingXdr, matchFunding, submitFunding, fundingInstructions, verifyAccount, configFor, checkKeys, DEFAULTS, SETUP_WINDOW_S, FUNDING_WINDOW_S };
