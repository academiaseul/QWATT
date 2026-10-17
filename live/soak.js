#!/usr/bin/env node
/**
 * QWATT — real-time soak test on Stellar testnet (throwaway accounts)
 * ---------------------------------------------------------------------------
 *   node live/soak.js [--hours 3]       (needs `npm install` in anchor/)
 *
 * Every earlier run was accelerated. This one runs the live run at REAL-TIME
 * pace for hours, with the proposer and verifier anchoring each hourly batch on
 * a throwaway 2-of-3 account, and samples what only time reveals:
 *   - pacing drift: how far the newest judged interval lags the wall clock;
 *   - memory growth of the process;
 *   - Horizon errors / rate limiting across hundreds of calls.
 * At the end: live-run audit + reconciliation → evidence/soak/soak-<time>.json.
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
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[soak]', ...a);

async function main() {
  const args = process.argv.slice(2);
  const hours = Number(args[args.indexOf('--hours') + 1]) || 3;
  const t0 = Date.now();
  const K = { account: S.Keypair.random(), proposer: S.Keypair.random(), verifier: S.Keypair.random(), third: S.Keypair.random(), dest: S.Keypair.random() };
  const pub = Object.fromEntries(Object.entries(K).map(([k, v]) => [k, v.publicKey()]));
  for (const p of [pub.account, pub.dest]) { const r = await fetch(`https://friendbot.stellar.org?addr=${p}`); if (!r.ok) throw new Error('friendbot ' + r.status); }
  const acct = await server.loadAccount(pub.account);
  const b = new S.TransactionBuilder(acct, { fee: String(S.BASE_FEE), networkPassphrase: S.Networks.TESTNET });
  for (const s of [pub.proposer, pub.verifier, pub.third]) b.addOperation(S.Operation.setOptions({ signer: { ed25519PublicKey: s, weight: 1 } }));
  b.addOperation(S.Operation.setOptions({ masterWeight: 0, lowThreshold: 1, medThreshold: 2, highThreshold: 3 }));
  const setup = b.setTimeout(300).build(); setup.sign(K.account);
  await server.submitTransaction(setup);

  const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-soak-feed-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-soak-ver-'));
  const host = await serveDir(feedDir);
  log(`account ${pub.account} · feed ${feedDir} · ${hours} h at real-time pace`);

  const cfg = { network_passphrase: S.Networks.TESTNET, horizon_url: HORIZON, anchor_account: pub.account, asset_code: 'native', payment_destination: pub.dest, payment_amount: '0.0000001', base_fee: Number(S.BASE_FEE) };
  const samples = [];
  const errors = [];
  let anchored = 0;
  const live = runLive({ feedDir, days: hours / 24, startMs: Date.now(), seed: 20261017, speed: 'realtime', log: () => {} });

  let proposer = null, verifier = null;
  const tick = async () => {
    if (!fs.existsSync(path.join(feedDir, 'ledger', 'batches.jsonl'))) return;
    proposer = proposer || new Proposer({ feedDir, cfg, keypair: K.proposer, server });
    verifier = verifier || new Verifier({ feedUrl: host.url, cfg, keypair: K.verifier, stateDir, server });
    const p = await proposer.tick().catch((e) => ({ action: 'error', detail: e.message }));
    const v = await verifier.tick();
    if (v.action === 'anchored') { anchored++; log(`anchored ${v.batch_id}`); }
    for (const x of [p, v]) if (x.action === 'error' || x.action === 'submit_failed') { errors.push({ at: new Date().toISOString(), ...x }); log('error:', x.detail || JSON.stringify(x.codes)); }
  };
  const sample = () => {
    const idx = fs.existsSync(path.join(feedDir, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(feedDir, 'index.json'), 'utf8')) : null;
    const acc = path.join(feedDir, 'ledger', 'accepted.jsonl'), rej = path.join(feedDir, 'ledger', 'rejected.jsonl');
    const lines = [acc, rej].filter(fs.existsSync).flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    const lastEnd = lines.length ? Math.max(...lines.map((l) => Date.parse(l.interval.ts_end))) : null;
    const s = { at: new Date().toISOString(), lag_s: lastEnd ? Math.round((Date.now() - lastEnd) / 1000) : null, intervals: lines.length, batches: idx ? idx.latest_seq + 1 : 0, anchored, rss_mb: Math.round(process.memoryUsage().rss / 1e6), heap_mb: Math.round(process.memoryUsage().heapUsed / 1e6) };
    samples.push(s);
    log(`intervals ${s.intervals} · batches ${s.batches} · anchored ${anchored} · lag ${s.lag_s}s · rss ${s.rss_mb} MB`);
  };
  const ti = setInterval(tick, 30000);
  const si = setInterval(sample, 600000);
  sample();

  await live;
  log('live run finished; settling anchors…');
  for (let i = 0; i < 20; i++) { await tick(); const rec = await R.reconcile(await R.fetchFeed(host.url), await R.fetchAnchors(HORIZON, pub.account)); if (rec.verdict === 'RECONCILED') break; await new Promise((r) => setTimeout(r, 15000)); }
  clearInterval(ti); clearInterval(si); sample();

  const audit = auditLive(feedDir);
  const rec = await R.reconcile(await R.fetchFeed(host.url), await R.fetchAnchors(HORIZON, pub.account));
  await host.close();
  const lags = samples.map((s) => s.lag_s).filter((x) => x != null);
  const ev = {
    started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(), hours, public_keys: pub,
    audit: { ok: audit.ok, coverage: audit.coverage, problems: audit.problems },
    reconciliation: { verdict: rec.verdict, summary: rec.summary, problems: rec.problems },
    anchored, errors, samples,
    findings: { max_lag_s: Math.max(...lags), rss_first_mb: samples[0].rss_mb, rss_last_mb: samples[samples.length - 1].rss_mb },
  };
  ev.verdict = audit.ok && rec.verdict === 'RECONCILED' ? 'PASS' : 'FAIL';
  const out = path.join(__dirname, '..', 'evidence', 'soak');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `soak-${ev.started_at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(ev, null, 2) + '\n');
  log(`verdict ${ev.verdict} · ${audit.coverage.judged_slots} intervals · ${anchored} anchored · max lag ${ev.findings.max_lag_s}s · rss ${ev.findings.rss_first_mb}→${ev.findings.rss_last_mb} MB → ${path.relative(process.cwd(), file)}`);
  process.exitCode = ev.verdict === 'PASS' ? 0 : 1;
}

main().catch((e) => { console.error('[soak] error:', e.stack || e.message); process.exitCode = 1; });
