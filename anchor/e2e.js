#!/usr/bin/env node
/**
 * QWATT — end-to-end 2-of-3 anchoring on Stellar testnet (Deliverable 3 acceptance)
 * ---------------------------------------------------------------------------
 *   node anchor/e2e.js         throwaway accounts; writes evidence/e2e/e2e-<time>.json
 *
 * The full path, with real services and the real network:
 *
 *   batch pipeline → feed dir ──served read-only over HTTP──► verifier (URL only)
 *                        ▲                                        │
 *                    proposer (signs, writes pending/*.xdr)        └─ co-signs + submits
 *
 * Scenarios, each recorded:
 *   1. a chain of batches (one carrying a shaded-sensor fault) anchored one by one;
 *   2. both services are replaced by fresh instances mid-run (restart) and resume from chain + feed;
 *   3. independence: a batch listed but not published, with a proposer-signed
 *      transaction for it → verifier refuses (verifier.not_published); once the
 *      file is published the same proposal is verified and anchored;
 *   4. test D through the feed: batch file and ledger entry forged after the
 *      proposer signed → verifier refuses (verifier.hash_mismatch); restored → anchored;
 *   5. the final feed re-derives with verify-cli and the on-chain head equals the last batch.
 *
 * Secret keys exist only in this process. Nothing touches the real issuer or treasury.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('@stellar/stellar-sdk');
const E = require('../protocol/evidence');
const V = require('../batch/verify');
const { Pipeline } = require('../batch/pipeline');
const { verifyFeed } = require('../batch/verify-cli');
const T = require('./tx');
const C = require('./chain');
const { Proposer } = require('./proposer');
const { Verifier } = require('./verifier');
const { serveDir } = require('./static-server');

const HORIZON = 'https://horizon-testnet.stellar.org';
const server = new S.Horizon.Server(HORIZON);
const OUT = path.join(__dirname, '..', 'evidence', 'e2e');
const log = (...a) => console.log('[e2e]', ...a);

async function friendbot(pub) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(pub)}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}`);
}

async function setupMultisig(master, signers) {
  const acct = await server.loadAccount(master.publicKey());
  const b = new S.TransactionBuilder(acct, { fee: String(S.BASE_FEE), networkPassphrase: S.Networks.TESTNET });
  for (const s of signers) b.addOperation(S.Operation.setOptions({ signer: { ed25519PublicKey: s, weight: 1 } }));
  b.addOperation(S.Operation.setOptions({ masterWeight: 0, lowThreshold: 1, medThreshold: 2, highThreshold: 3 }));
  const tx = b.setTimeout(300).build();
  tx.sign(master);
  return (await server.submitTransaction(tx)).hash;
}

const T0 = Date.parse('2026-09-20T15:00:00Z'), DT = 300;
function iv(i, bW = 99) {
  const t = T0 + i * DT * 1000;
  const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
  return {
    spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION,
    site_id: 'e2e-bench', node_id: 'e2e', seq: i,
    ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
    meters: { a: m('pzem-017:1', 100), b: m('epever-tracer:2', bW) },
    source: { adapter: 'simulator', raw_sha256: E.sha256('e2e-' + i) },
  };
}

async function main() {
  const keys = { account: S.Keypair.random(), proposer: S.Keypair.random(), verifier: S.Keypair.random(), third: S.Keypair.random(), destination: S.Keypair.random() };
  const pub = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v.publicKey()]));
  const ev = { started_at: new Date().toISOString(), network: 'testnet', public_keys: pub, scenarios: {}, ticks: [] };

  log('funding and configuring a throwaway 2-of-3 anchoring account…');
  await friendbot(pub.account); await friendbot(pub.destination);
  ev.setup_tx = await setupMultisig(keys.account, [pub.proposer, pub.verifier, pub.third]);

  const cfg = {
    network_passphrase: S.Networks.TESTNET, horizon_url: HORIZON, anchor_account: pub.account,
    asset_code: 'native', payment_destination: pub.destination, payment_amount: '0.0000001', base_fee: Number(S.BASE_FEE),
  };

  const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-e2e-feed-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-e2e-verifier-'));
  const host = await serveDir(feedDir);
  const pipe = new Pipeline({ dir: feedDir, site_id: 'e2e-bench', node_id: 'e2e' });

  /* 1. four batches; the fourth carries a shaded-sensor fault (meter B reads 40% low) */
  for (let i = 0; i < 48; i++) pipe.push(i === 40 ? iv(i, 60) : iv(i));
  const rejectedLines = pipe.feed.readLedger('rejected');
  ev.scenarios.fault_rejections = rejectedLines.map((l) => ({ batch_id: l.batch_id, reasons: l.reasons }));

  let proposer = new Proposer({ feedDir, cfg, keypair: keys.proposer, server });
  let verifier = new Verifier({ feedUrl: host.url, cfg, keypair: keys.verifier, stateDir, server });

  const step = async (label) => {
    const p = await proposer.tick(); const v = await verifier.tick();
    ev.ticks.push({ label, proposer: p, verifier: v });
    log(label, '| proposer:', p.action, p.batch_id || '', '| verifier:', v.action, v.batch_id || '', v.reasons ? JSON.stringify(v.reasons) : '');
    return { p, v };
  };

  for (let n = 0; n < 2; n++) await step(`chain ${n}`);

  /* 2. restart both services mid-run */
  proposer = new Proposer({ feedDir, cfg, keypair: keys.proposer, server });
  verifier = new Verifier({ feedUrl: host.url, cfg, keypair: keys.verifier, stateDir, server });
  ev.scenarios.restart = 'fresh proposer and verifier instances created after two anchors';
  for (let n = 2; n < 6; n++) { const { p, v } = await step(`chain ${n} (after restart)`); if (p.action === 'idle' && v.action === 'idle') break; }

  /* 3. independence: next batch listed, file withheld, proposer-signed tx placed in the feed */
  for (let i = 48; i < 60; i++) pipe.push(iv(i));
  const listed = pipe.feed.readLedger('batches');
  const held = listed[listed.length - 1];
  const heldFile = pipe.feed.batchPath(held.batch_id);
  const heldText = fs.readFileSync(heldFile, 'utf8');
  fs.unlinkSync(heldFile);
  const head = await C.getHead(server, pub.account);
  const leaked = T.buildAnchorTx(JSON.parse(heldText), cfg, T.proposalParams(head.sequence));
  leaked.sign(keys.proposer);
  fs.mkdirSync(path.join(feedDir, 'pending'), { recursive: true });
  fs.writeFileSync(path.join(feedDir, 'pending', `${held.batch_id}.xdr`), leaked.toEnvelope().toXDR('base64') + '\n');
  const ind = await verifier.tick();
  ev.scenarios.independence_unpublished = { batch_id: held.batch_id, verifier: ind };
  log('independence (unpublished):', ind.action, JSON.stringify(ind.reasons || []));
  fs.writeFileSync(heldFile, heldText);                                    // publish it
  const ind2 = await verifier.tick();
  ev.scenarios.independence_after_publication = { batch_id: held.batch_id, verifier: ind2 };
  log('independence (published):', ind2.action, ind2.tx_hash ? ind2.tx_hash.slice(0, 16) + '…' : '');

  /* 4. test D through the feed: forge file + ledger entry after the proposer signed */
  for (let i = 60; i < 72; i++) pipe.push(iv(i));
  await proposer.tick();                                                    // records anchors, proposes the new batch
  const lst = pipe.feed.readLedger('batches');
  const target = lst[lst.length - 1];
  const tFile = pipe.feed.batchPath(target.batch_id);
  const origFile = fs.readFileSync(tFile, 'utf8');
  const bl = path.join(feedDir, 'ledger', 'batches.jsonl');
  const origLedger = fs.readFileSync(bl, 'utf8');
  const prevBatch = JSON.parse(fs.readFileSync(pipe.feed.batchPath(lst[lst.length - 2].batch_id), 'utf8'));
  const forged = JSON.parse(origFile);
  forged.intervals[0].meters.a.mwh += 900; forged.intervals[0].meters.b.mwh += 900;
  forged.energy_mwh = forged.intervals.reduce((s, r) => s + E.basisMwh(r), 0);
  forged.cumulative_mwh = prevBatch.cumulative_mwh + forged.energy_mwh;
  forged.intervals_root = E.merkleRoot(forged.intervals);
  forged.sha256 = E.batchSha256(forged);
  fs.writeFileSync(tFile, E.canonical(forged) + '\n');
  fs.writeFileSync(bl, origLedger.replace(target.sha256, forged.sha256));
  const dV = await verifier.tick();
  ev.scenarios.test_D_forged_after_signing = { batch_id: target.batch_id, forged_sha256: forged.sha256, verifier: dV };
  log('test D (forged):', dV.action, JSON.stringify(dV.reasons || []));
  fs.writeFileSync(tFile, origFile); fs.writeFileSync(bl, origLedger);     // restore the truth
  const dV2 = await verifier.tick();
  ev.scenarios.test_D_after_restore = { batch_id: target.batch_id, verifier: dV2 };
  log('test D (restored):', dV2.action);

  /* 5. settle and reconcile */
  for (let n = 0; n < 3; n++) { const { p, v } = await step(`settle ${n}`); if (p.action === 'idle' && v.action === 'idle') break; }
  const final = await C.getHead(server, pub.account);
  const vf = verifyFeed(feedDir);
  const lastAccepted = pipe.feed.readLedger('batches').filter((e) => e.status === 'accepted').pop();
  ev.final = {
    feed_verified: vf.ok, feed_problems: vf.problems, batches: vf.batches, cumulative_mwh_feed: vf.cumulative_mwh,
    onchain_anchor: final.anchor_sha256, onchain_cumulative_mwh: final.cumulative_mwh,
    head_matches_last_batch: final.anchor_sha256 === lastAccepted.sha256,
    anchored_records: fs.readdirSync(path.join(feedDir, 'anchored')).map((f) => JSON.parse(fs.readFileSync(path.join(feedDir, 'anchored', f), 'utf8'))),
    refusals: fs.existsSync(path.join(stateDir, 'refusals.jsonl')) ? fs.readFileSync(path.join(stateDir, 'refusals.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [],
  };

  const pass = vf.ok && ev.final.head_matches_last_batch && final.cumulative_mwh === vf.cumulative_mwh &&
    ind.action === 'refused' && (ind.reasons || []).includes('verifier.not_published') && ind2.action === 'anchored' &&
    dV.action === 'refused' && (dV.reasons || []).includes('verifier.hash_mismatch') && dV2.action === 'anchored';
  ev.verdict = pass ? 'PASS' : 'FAIL';
  ev.finished_at = new Date().toISOString();
  await host.close();

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `e2e-${ev.started_at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(ev, null, 2) + '\n');
  log(`feed ${vf.ok ? 'verified' : 'BROKEN'} · ${vf.batches} batches · on-chain head ${ev.final.head_matches_last_batch ? '=' : '≠'} last batch · cumulative ${final.cumulative_mwh} mWh`);
  log(`verdict ${ev.verdict} → ${path.relative(process.cwd(), file)}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('[e2e] error:', e.stack || e.message); process.exit(1); });
