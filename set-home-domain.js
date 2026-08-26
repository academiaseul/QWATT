#!/usr/bin/env node
/**
 * QWATT — set home_domain on the issuer (and optionally the treasury).
 * ----------------------------------------------------------------------------
 * This is what makes wallets and explorers discover /.well-known/stellar.toml
 * and show "QWATT · qwatt.org" instead of "unknown asset" (SEP-1 §Discovery).
 *
 * Run ONCE, locally, on the machine where the secret lives:
 *
 *   npm i @stellar/stellar-sdk
 *   ISSUER_SECRET=S... node set-home-domain.js
 *   ISSUER_SECRET=S... DISTRIBUTOR_SECRET=S... node set-home-domain.js   # both
 *
 * Never commit this with a key in it. Never paste the secret as a CLI argument
 * (argv lands in your shell history); use the environment variable.
 *
 * Safety: the script derives the public key from the secret you supply and
 * refuses to sign unless it matches EXPECT.issuer / EXPECT.distributor below.
 * A wrong paste aborts instead of rewriting some other account's home domain.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

/* ───────────────────────────── configuration ───────────────────────────── */

const CONFIG = {
  HOME_DOMAIN: 'qwatt.org',                        // no https://, no trailing slash
  HORIZON: 'https://horizon-testnet.stellar.org',
  NETWORK: StellarSdk.Networks.TESTNET,
  EXPLORER: 'https://stellar.expert/explorer/testnet',
  BASE_FEE: '10000',
};

// The accounts this script is allowed to touch. Update both at mainnet genesis.
const EXPECT = {
  issuer: 'GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46',
  distributor: 'GCLS6EE5UNXFNK44SQGD4F3TYYFE7QCJX2QEXQ5E4TOQSAQBZUXTSOKW',
};

/* ─────────────────────────────── helpers ───────────────────────────────── */

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  ok: s => `\x1b[32m${s}\x1b[0m`,
  warn: s => `\x1b[33m${s}\x1b[0m`,
  err: s => `\x1b[31m${s}\x1b[0m`,
};

const ServerCtor = StellarSdk.Horizon?.Server || StellarSdk.Server;
const server = new ServerCtor(CONFIG.HORIZON);

function resultCodes(e) {
  const codes = e?.response?.data?.extras?.result_codes;
  if (!codes) return e?.message || String(e);
  const ops = Array.isArray(codes.operations) ? codes.operations.join(', ') : '';
  return [codes.transaction, ops].filter(Boolean).join(' / ');
}

async function setHomeDomain(label, secret, expectedPublic) {
  let kp;
  try {
    kp = StellarSdk.Keypair.fromSecret(secret.trim());
  } catch {
    throw new Error(`${label}: that is not a valid Stellar secret key (should start with S).`);
  }

  const pub = kp.publicKey();
  if (pub !== expectedPublic) {
    throw new Error(
      `${label}: refusing to sign.\n` +
      `      secret provided belongs to  ${pub}\n` +
      `      but this script expects     ${expectedPublic}\n` +
      `      If you re-ran genesis, update EXPECT in this file first.`
    );
  }

  console.log(`\n${c.bold(label)}  ${c.dim(pub)}`);

  const account = await server.loadAccount(pub);
  const current = account.home_domain;
  if (current === CONFIG.HOME_DOMAIN) {
    console.log(`  ${c.ok('✓')} home_domain already set to ${CONFIG.HOME_DOMAIN} — nothing to do.`);
    return null;
  }
  if (current) console.log(`  ${c.warn('!')} replacing existing home_domain: ${current}`);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: CONFIG.BASE_FEE,
    networkPassphrase: CONFIG.NETWORK,
  })
    .addOperation(StellarSdk.Operation.setOptions({ homeDomain: CONFIG.HOME_DOMAIN }))
    .setTimeout(120)
    .build();

  tx.sign(kp);

  try {
    const res = await server.submitTransaction(tx);
    console.log(`  ${c.ok('✓')} home_domain = ${CONFIG.HOME_DOMAIN}`);
    console.log(`  ${c.dim(`${CONFIG.EXPLORER}/tx/${res.hash}`)}`);
    return res.hash;
  } catch (e) {
    throw new Error(`${label}: submission failed — ${resultCodes(e)}`);
  }
}

/* ──────────────────────────────── main ─────────────────────────────────── */

async function main() {
  const issuerSecret = process.env.ISSUER_SECRET;
  const distributorSecret = process.env.DISTRIBUTOR_SECRET;

  if (!issuerSecret) {
    console.error(
      `\n${c.err('ISSUER_SECRET is not set.')}\n\n` +
      `  ISSUER_SECRET=S... node set-home-domain.js\n` +
      `  ${c.dim('(add DISTRIBUTOR_SECRET=S... to tag the treasury too)')}\n\n` +
      `  ${c.dim('Pass it as an environment variable, never as an argument —')}\n` +
      `  ${c.dim('command-line arguments are written to your shell history.')}\n`
    );
    process.exit(1);
  }

  console.log(`${c.bold('QWATT — set home_domain')}`);
  console.log(c.dim(`  domain:  ${CONFIG.HOME_DOMAIN}`));
  console.log(c.dim(`  horizon: ${CONFIG.HORIZON}`));

  await setHomeDomain('issuer     ', issuerSecret, EXPECT.issuer);
  if (distributorSecret) {
    await setHomeDomain('distributor', distributorSecret, EXPECT.distributor);
  } else {
    console.log(`\n${c.dim('distributor  skipped (DISTRIBUTOR_SECRET not set)')}`);
  }

  console.log(`\n${c.bold('Next:')}`);
  console.log(`  1. Confirm the toml is readable:  curl -sI https://${CONFIG.HOME_DOMAIN}/.well-known/stellar.toml | grep -i access-control`);
  console.log(`  2. Check the asset page picks up the metadata (may take a few minutes):`);
  console.log(`     ${CONFIG.EXPLORER}/asset/QWATT-${EXPECT.issuer}\n`);
}

main().catch(e => {
  console.error(`\n${c.err('✗ ' + e.message)}\n`);
  process.exit(1);
});
