#!/usr/bin/env node
/**
 * QWATT — create and configure the real 2-of-3 anchoring account (plan unit 3.1)
 * ---------------------------------------------------------------------------
 *   node anchor/setup-account.js --proposer G… --verifier G… --third G… [--out anchor/config.json]
 *   node anchor/setup-account.js --verify G…            re-check an existing anchoring account
 *
 * Testnet only. In one run:
 *   1. a fresh account is created and funded with test XLM (Friendbot);
 *   2. ONE atomic, master-signed transaction adds the QWATT trustline, the three
 *      signers (weight 1 each), thresholds low 1 / medium 2 / high 3, and sets the
 *      master key's weight to 0 — after it, no single key can do anything that matters,
 *      and changing signers needs all three;
 *   3. it prints the UNSIGNED funding transaction (1 QWATT from the treasury to the
 *      new account) for the treasury key holder to sign themselves — this tool never
 *      sees the treasury secret;
 *   4. it verifies the result on Horizon and writes the public config the proposer
 *      and verifier read.
 *
 * The master secret exists only in this process for step 2 and is discarded: once
 * its weight is 0 it is useless, so there is nothing to store or leak.
 *
 * Refuses to run without all three signer keys: with high threshold 3, a signer
 * cannot be added later without the signatures of all existing ones.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const S = require('@stellar/stellar-sdk');

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

function assertKey(k, name) {
  if (!k || !S.StrKey.isValidEd25519PublicKey(k)) throw new Error(`${name}: a valid G… public key is required`);
}

/** Steps 1–2. @returns {{account:string, setup_tx:string}} */
async function createAndConfigure(server, o) {
  for (const n of ['proposer', 'verifier', 'third']) assertKey(o[n], n);
  if (new Set([o.proposer, o.verifier, o.third]).size !== 3) throw new Error('the three signers must be three different keys');
  const master = S.Keypair.random();
  const r = await fetch(`${o.friendbot_url}?addr=${encodeURIComponent(master.publicKey())}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}`);
  const acct = await server.loadAccount(master.publicKey());
  const asset = new S.Asset(o.asset_code, o.asset_issuer);
  const tx = new S.TransactionBuilder(acct, { fee: String(S.BASE_FEE), networkPassphrase: o.network_passphrase })
    .addOperation(S.Operation.changeTrust({ asset }))
    .addOperation(S.Operation.setOptions({ signer: { ed25519PublicKey: o.proposer, weight: 1 } }))
    .addOperation(S.Operation.setOptions({ signer: { ed25519PublicKey: o.verifier, weight: 1 } }))
    .addOperation(S.Operation.setOptions({ signer: { ed25519PublicKey: o.third, weight: 1 } }))
    .addOperation(S.Operation.setOptions({ masterWeight: 0, lowThreshold: 1, medThreshold: 2, highThreshold: 3 }))
    .addMemo(S.Memo.text('QWATT anchoring 2-of-3'))
    .setTimeout(300)
    .build();
  tx.sign(master);
  const res = await server.submitTransaction(tx);
  return { account: master.publicKey(), setup_tx: res.hash };
}

/** Step 3: the unsigned 1-QWATT funding transaction, for the treasury holder to sign. */
async function fundingXdr(server, o, account) {
  const t = await server.loadAccount(o.treasury);
  return new S.TransactionBuilder(t, { fee: String(S.BASE_FEE), networkPassphrase: o.network_passphrase })
    .addOperation(S.Operation.payment({ destination: account, asset: new S.Asset(o.asset_code, o.asset_issuer), amount: o.funding_amount }))
    .addMemo(S.Memo.text('fund QWATT anchoring'))
    .setTimeout(7 * 24 * 3600)
    .build()
    .toEnvelope().toXDR('base64');
}

/** Step 4: everything the freeze requires, checked on Horizon. @returns {{ok:boolean, checks:object[]}} */
async function verifyAccount(server, o, account) {
  const a = await server.loadAccount(account);
  const weights = Object.fromEntries(a.signers.map((s) => [s.key, s.weight]));
  const line = a.balances.find((b) => b.asset_code === o.asset_code && b.asset_issuer === o.asset_issuer);
  const checks = [
    ['thresholds 1/2/3', a.thresholds.low_threshold === 1 && a.thresholds.med_threshold === 2 && a.thresholds.high_threshold === 3],
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
  };
}

async function cli() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const o = { ...DEFAULTS, proposer: opt('--proposer'), verifier: opt('--verifier'), third: opt('--third') };
  const server = new S.Horizon.Server(o.horizon_url);

  const existing = opt('--verify');
  if (existing) {
    const v = await verifyAccount(server, o, existing);
    for (const c of v.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}`);
    console.log(v.ok ? 'anchoring account OK' : 'anchoring account NOT ready');
    process.exitCode = v.ok ? 0 : 1;
    return;
  }

  const { account, setup_tx } = await createAndConfigure(server, o);
  console.log(`anchoring account ${account}`);
  console.log(`  configured in ${setup_tx} (trustline, three signers, thresholds 1/2/3, master weight 0)`);
  const out = path.resolve(opt('--out', path.join(__dirname, 'config.json')));
  fs.writeFileSync(out, JSON.stringify(configFor(o, account), null, 2) + '\n');
  console.log(`  public config written to ${out}`);
  console.log('\nNEXT — the treasury key holder signs and submits this funding transaction (1 QWATT):');
  console.log('  open https://laboratory.stellar.org → Sign transaction (testnet), paste, sign with the treasury key, submit\n');
  console.log(await fundingXdr(server, o, account));
  console.log(`\nthen check:  node anchor/setup-account.js --verify ${account} --proposer ${o.proposer} --verifier ${o.verifier} --third ${o.third}`);
}

if (require.main === module) cli().catch((e) => { console.error('setup failed:', e.message); process.exitCode = 1; });

module.exports = { createAndConfigure, fundingXdr, verifyAccount, configFor, DEFAULTS };
