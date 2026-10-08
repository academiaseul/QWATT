#!/usr/bin/env node
/**
 * QWATT — dress rehearsal of the whole live-run chain on Stellar testnet
 * ---------------------------------------------------------------------------
 *   node live/dress-rehearsal.js [--days 2]      (needs `npm install` in anchor/)
 *
 * Everything the seven-day run will do, compressed: the live run (simulator →
 * CSV replay → gates → batches, with its scheduled faults) at fast pace; the
 * real proposer and verifier anchoring every batch through a THROWAWAY 2-of-3
 * account; then the reconciliation check (the logic reconcile.html runs) and
 * the live-run audit over the result. Evidence to evidence/dress-rehearsal/.
 * Secret keys exist only in this process.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require(path.join(__dirname, '..', 'anchor', 'node_modules', '@stellar', 'stellar-sdk'));
const { runLive } = require('./run');
const { auditLive } = require('./audit');
const { Proposer } = require('../anchor/proposer');
const { Verifier } = require('../anchor/verifier');
const { serveDir } = require('../anchor/static-server');
const R = require('../assets/qwatt-reconcile.js');

const HORIZON = 'https://horizon-testnet.stellar.org';
const server = new S.Horizon.Server(HORIZON);
const log = (...a) => console.log('[dress]', ...a);

async function friendbot(pub) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(pub)}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}`);
}

async function main() {
  const args = process.argv.slice(2);
  const days = Number((args[args.indexOf('--days') + 1]) || 2) || 2;
  const t0 = Date.now();
  const keys = { account: S.Keypair.random(), proposer: S.Keypair.random(), verifier: S.Keypair.random(), third: S.Keypair.random(), destination: S.Keypair.random() };
  const pub = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v.publicKey()]));

  log('throwaway 2-of-3 account…');
  await friendbot(pub.account); await friendbot(pub.destination);
  let acct = await server.loadAccount(pub.account);
  const b = new S.TransactionBuilder(acct, { fee: String(S.BASE_FEE), networkPassphrase: S.Networks.TESTNET });
  for (const s of [pub.proposer, pub.verifier, pub.third]) b.addOperation(S.Operation.setOptions({ signer: { ed25519PublicKey: s, weight: 1 } }));
  b.addOperation(S.Operation.setOptions({ masterWeight: 0, lowThreshold: 1, medThreshold: 2, highThreshold: 3 }));
  const setup = b.setTimeout(300).build(); setup.sign(keys.account);
  const setupHash = (await server.submitTransaction(setup)).hash;

  const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-dress-feed-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-dress-verifier-'));
  log(`live run, ${days} days at fast pace → ${feedDir}`);
  await runLive({ feedDir, days, startMs: Date.parse('2026-11-03T03:00:00Z'), seed: 20261103, speed: 'fast', log: () => {} });
  const audit = auditLive(feedDir);
  log(`audit: ${audit.coverage.judged_slots}/${audit.coverage.expected_slots} intervals, faults ${audit.faults.map((f) => f.status).join(' / ')}`);

  const host = await serveDir(feedDir);
  const cfg = { network_passphrase: S.Networks.TESTNET, horizon_url: HORIZON, anchor_account: pub.account, asset_code: 'native', payment_destination: pub.destination, payment_amount: '0.0000001', base_fee: Number(S.BASE_FEE) };
  const proposer = new Proposer({ feedDir, cfg, keypair: keys.proposer, server });
  const verifier = new Verifier({ feedUrl: host.url, cfg, keypair: keys.verifier, stateDir, server });

  const total = JSON.parse(fs.readFileSync(path.join(feedDir, 'index.json'), 'utf8')).latest_seq + 1;
  let anchored = 0, idle = 0, errors = 0;
  for (let round = 0; round < total * 4 && idle < 2; round++) {
    const p = await proposer.tick().catch((e) => ({ action: 'error', detail: e.message }));
    const v = await verifier.tick();
    if (v.action === 'anchored') { anchored++; if (anchored % 6 === 0 || anchored === total) log(`anchored ${anchored}/${total}`); }
    if (p.action === 'error' || v.action === 'error' || v.action === 'submit_failed') { errors++; log('transient:', p.detail || v.detail || JSON.stringify(v.codes)); }
    idle = p.action === 'idle' && v.action === 'idle' ? idle + 1 : 0;
  }

  const [feed, anchors] = await Promise.all([R.fetchFeed(host.url), R.fetchAnchors(HORIZON, pub.account)]);
  const rec = await R.reconcile(feed, anchors);
  await host.close();
  log(`reconciliation: ${rec.verdict} · ${rec.summary.anchored_batches}/${rec.summary.accepted_batches} anchored · ${rec.summary.rejected_intervals} intervals refused`);

  const ev = {
    started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(), wall_s: Math.round((Date.now() - t0) / 1000),
    network: 'testnet', public_keys: pub, setup_tx: setupHash, days,
    live_audit: { ok: audit.ok, coverage: { judged: audit.coverage.judged_slots, expected: audit.coverage.expected_slots, gaps: audit.coverage.gaps.length }, faults: audit.faults },
    anchoring: { batches: total, anchored, transient_errors: errors },
    reconciliation: { verdict: rec.verdict, summary: rec.summary, problems: rec.problems },
    first_tx: anchors[0] ? anchors[0].tx_hash : null, last_tx: anchors.length ? anchors[anchors.length - 1].tx_hash : null,
  };
  ev.verdict = audit.ok && rec.verdict === 'RECONCILED' && anchored === total ? 'PASS' : 'FAIL';
  const out = path.join(__dirname, '..', 'evidence', 'dress-rehearsal');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `dress-${ev.started_at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(ev, null, 2) + '\n');
  log(`verdict ${ev.verdict} in ${ev.wall_s}s → ${path.relative(process.cwd(), file)}`);
  process.exitCode = ev.verdict === 'PASS' ? 0 : 1;
}

main().catch((e) => { console.error('[dress] error:', e.stack || e.message); process.exitCode = 1; });
