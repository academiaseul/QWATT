#!/usr/bin/env node
/**
 * QWATT — rehearsal of the real account setup with a NON-NATIVE asset (testnet, throwaway)
 * ---------------------------------------------------------------------------
 *   node anchor/asset-rehearsal.js        → evidence/asset-rehearsal/*.json
 *
 * Every earlier rehearsal paid the nominal amount in native XLM. The real run pays
 * in QWATT, which adds trustlines, an issuer and a treasury. This run reproduces
 * that whole shape on throwaway accounts:
 *
 *   stand-in issuer mints "QWATT" to a stand-in treasury
 *   setup-account.js creates the 2-of-3 anchoring account (trustline, signers, thresholds, master 0)
 *   the "treasury" signs the 1-QWATT funding transaction it is handed (as Jay will)
 *   setup-account.js --verify passes every check
 *   proposer + verifier anchor three batches, each paying 0.0000001 QWATT to the treasury
 *   the treasury balance rises by exactly 3 × 0.0000001; reconciliation is RECONCILED
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('@stellar/stellar-sdk');
const E = require('../protocol/evidence');
const V = require('../batch/verify');
const { Pipeline } = require('../batch/pipeline');
const SA = require('./setup-account');
const { Proposer } = require('./proposer');
const { Verifier } = require('./verifier');
const { serveDir } = require('./static-server');
const R = require('../assets/qwatt-reconcile.js');

const HORIZON = SA.DEFAULTS.horizon_url;
const server = new S.Horizon.Server(HORIZON);
const log = (...a) => console.log('[asset]', ...a);
const fund = async (pub) => { const r = await fetch(`${SA.DEFAULTS.friendbot_url}?addr=${pub}`); if (!r.ok) throw new Error('friendbot ' + r.status); };
const balanceOf = async (acct, code, issuer) => {
  const a = await server.loadAccount(acct);
  const b = a.balances.find((x) => x.asset_code === code && x.asset_issuer === issuer);
  return b ? b.balance : null;
};

async function main() {
  const t0 = Date.now();
  const K = { issuer: S.Keypair.random(), treasury: S.Keypair.random(), proposer: S.Keypair.random(), verifier: S.Keypair.random(), third: S.Keypair.random() };
  const pub = Object.fromEntries(Object.entries(K).map(([k, v]) => [k, v.publicKey()]));
  const ev = { started_at: new Date(t0).toISOString(), network: 'testnet', public_keys: pub, steps: {} };

  log('stand-in issuer and treasury, minting 1000 QWATT…');
  await fund(pub.issuer); await fund(pub.treasury);
  const asset = new S.Asset('QWATT', pub.issuer);
  let t = await server.loadAccount(pub.treasury);
  let tx = new S.TransactionBuilder(t, { fee: String(S.BASE_FEE), networkPassphrase: S.Networks.TESTNET })
    .addOperation(S.Operation.changeTrust({ asset }))
    .addOperation(S.Operation.payment({ source: pub.issuer, destination: pub.treasury, asset, amount: '1000' }))
    .setTimeout(300).build();
  tx.sign(K.treasury, K.issuer);
  ev.steps.mint = (await server.submitTransaction(tx)).hash;

  const o = { ...SA.DEFAULTS, asset_issuer: pub.issuer, treasury: pub.treasury, proposer: pub.proposer, verifier: pub.verifier, third: pub.third };

  log('setup-account: create + configure…');
  const { account, setup_tx } = await SA.createAndConfigure(server, o);
  ev.anchoring_account = account; ev.steps.setup = setup_tx;
  const before = await SA.verifyAccount(server, o, account);
  ev.steps.verify_before_funding = before.checks;
  log(`  before funding: ${before.checks.filter((c) => !c.ok).map((c) => c.name).join(', ') || 'all ok'} (balance check must fail until funded)`);

  log('treasury signs the funding transaction it was handed…');
  const xdr = await SA.fundingXdr(server, o, account);
  const ftx = new S.Transaction(xdr, S.Networks.TESTNET);
  if (ftx.operations[0].destination !== account || ftx.operations[0].amount !== '1.0000000') throw new Error('funding transaction is not what it claims');
  ftx.sign(K.treasury);
  ev.steps.funding = (await server.submitTransaction(ftx)).hash;

  const after = await SA.verifyAccount(server, o, account);
  ev.steps.verify_after_funding = after.checks;
  log(`  verify: ${after.ok ? 'every check passes' : 'FAILED ' + after.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`);
  if (!after.ok) throw new Error('anchoring account not ready');

  /* anchor three batches paying in the asset */
  const T0 = Date.parse('2026-09-20T15:00:00Z'), DT = 300;
  const iv = (i) => {
    const ts = T0 + i * DT * 1000;
    const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
    return { spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION, site_id: 'asset-rehearsal', node_id: 'ar', seq: i,
      ts_start: new Date(ts).toISOString(), ts_end: new Date(ts + DT * 1000).toISOString(), dt_s: DT,
      meters: { a: m('a', 100), b: m('b', 99) }, source: { adapter: 'simulator', raw_sha256: E.sha256('ar-' + i) } };
  };
  const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-asset-feed-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-asset-ver-'));
  const pipe = new Pipeline({ dir: feedDir, site_id: 'asset-rehearsal', node_id: 'ar' });
  for (let i = 0; i < 36; i++) pipe.push(iv(i));
  const host = await serveDir(feedDir);
  const cfg = { ...SA.configFor(o, account), network_passphrase: S.Networks.TESTNET };
  const proposer = new Proposer({ feedDir, cfg, keypair: K.proposer, server });
  const verifier = new Verifier({ feedUrl: host.url, cfg, keypair: K.verifier, stateDir, server });
  const tBefore = await balanceOf(pub.treasury, 'QWATT', pub.issuer);
  const anchored = [];
  for (let r = 0; r < 12; r++) {
    const p = await proposer.tick(); const v = await verifier.tick();
    if (v.action === 'anchored') { anchored.push(v.tx_hash); log(`  anchored ${v.batch_id} in ${v.tx_hash.slice(0, 16)}…`); }
    if (p.action === 'idle' && v.action === 'idle') break;
  }
  const tAfter = await balanceOf(pub.treasury, 'QWATT', pub.issuer);
  const delta = Math.round((Number(tAfter) - Number(tBefore)) * 1e7);
  const rec = await R.reconcile(await R.fetchFeed(host.url), await R.fetchAnchors(HORIZON, account));
  await host.close();

  ev.anchoring = { batches: 3, anchored: anchored.length, txs: anchored, treasury_before: tBefore, treasury_after: tAfter, treasury_delta_stroops: delta };
  ev.reconciliation = { verdict: rec.verdict, problems: rec.problems };
  ev.verdict = anchored.length === 3 && delta === 3 && rec.verdict === 'RECONCILED' && after.ok ? 'PASS' : 'FAIL';
  ev.finished_at = new Date().toISOString();
  log(`treasury +${delta} stroops of QWATT (expected 3) · reconciliation ${rec.verdict}`);

  const out = path.join(__dirname, '..', 'evidence', 'asset-rehearsal');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `asset-${ev.started_at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(ev, null, 2) + '\n');
  log(`verdict ${ev.verdict} → ${path.relative(process.cwd(), file)}`);
  process.exitCode = ev.verdict === 'PASS' ? 0 : 1;
}

main().catch((e) => { console.error('[asset] error:', e.stack || e.message); process.exitCode = 1; });
