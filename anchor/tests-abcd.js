#!/usr/bin/env node
/**
 * QWATT — SOW tests A–D on the REAL anchoring account (Deliverable 3 evidence)
 * ---------------------------------------------------------------------------
 * The keys live on different hosts by design, so each test runs where its key is:
 *
 *   proposer host:  QWATT_PROPOSER_SECRET=S… node anchor/tests-abcd.js a --config /etc/qwatt/anchor.json --feed-dir /var/lib/qwatt/feed
 *   verifier host:  QWATT_VERIFIER_SECRET=S… node anchor/tests-abcd.js b --config /etc/qwatt/anchor.json --feed <public feed URL>
 *   verifier host:                           node anchor/tests-abcd.js d --config /etc/qwatt/anchor.json --feed <public feed URL>
 *   anywhere:                                node anchor/tests-abcd.js c --config /etc/qwatt/anchor.json
 *
 *   A  the pending proposal, proposer signature only, submitted → the network must refuse it
 *   B  the same transaction rebuilt from the published batch, verifier signature only → refused
 *   C  the latest anchoring transaction carries two signatures (the normal pipeline is test C)
 *   D  the published batch altered IN MEMORY after the proposer signed → the verifier refuses.
 *      Nothing is submitted and nothing is published: the public feed is never touched.
 *
 * A and B never enter a ledger (validation rejects them), so they consume no
 * sequence number and do not disturb the running pipeline. Each run merges its
 * result into evidence/abcd/abcd.json, the format `ops/writeup.js --tests` reads.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const S = require('@stellar/stellar-sdk');
const E = require('../protocol/evidence');
const T = require('./tx');
const C = require('./chain');
const { Feed } = require('../batch/feed');
const { makeFeedClient } = require('./feed-client');
const { loadConfig } = require('./proposer');

const authRefused = (codes) => !!codes && (codes.transaction === 'tx_bad_auth' || (codes.transaction === 'tx_failed' && (codes.operations || []).includes('op_bad_auth')));

async function submitExpectRefusal(server, tx) {
  try {
    const res = await server.submitTransaction(tx);
    return { ok: true, hash: res.hash, refused: false };
  } catch (e) {
    const codes = e && e.response && e.response.data && e.response.data.extras && e.response.data.extras.result_codes;
    if (!codes) throw e;
    return { ok: false, refused: authRefused(codes), codes, body_hash: tx.hash().toString('hex'), signatures: tx.signatures.length };
  }
}

/** A — proposer host: submit the proposer-signed pending transaction alone. */
async function testA({ feedDir, cfg, keypair, server }) {
  const feed = new Feed(feedDir);
  const listed = feed.readLedger('batches');
  const head = await C.getHead(server, cfg.anchor_account);
  const next = C.nextToAnchor(listed, C.anchoredPrefix(listed, head.anchor_sha256));
  if (!next) throw new Error('no batch awaiting anchor: run test A while the pipeline is running');
  const batch = feed.readBatch(next.batch_id);
  const tx = T.buildAnchorTx(batch, cfg, T.proposalParams(head.sequence));
  tx.sign(keypair);
  const r = await submitExpectRefusal(server, tx);
  return { ...r, batch_id: next.batch_id, expect: 'refused', envelope_xdr: tx.toEnvelope().toXDR('base64') };
}

/** B — verifier host: rebuild from the published batch, sign with the verifier key only, submit. */
async function testB({ feedUrl, cfg, keypair, server }) {
  const feed = makeFeedClient(feedUrl);
  const listed = await feed.batches();
  const head = await C.getHead(server, cfg.anchor_account);
  const next = C.nextToAnchor(listed, C.anchoredPrefix(listed, head.anchor_sha256));
  if (!next) throw new Error('no batch awaiting anchor: run test B while the pipeline is running');
  const batch = await feed.batch(next.batch_id);
  const tx = T.buildAnchorTx(batch, cfg, T.proposalParams(head.sequence));
  tx.sign(keypair);
  const r = await submitExpectRefusal(server, tx);
  return { ...r, batch_id: next.batch_id, expect: 'refused', envelope_xdr: tx.toEnvelope().toXDR('base64') };
}

/** C — the most recent anchoring transaction, with its signature count. */
async function testC({ cfg, server }) {
  const page = await server.transactions().forAccount(cfg.anchor_account).order('desc').limit(20).call();
  const t = page.records.find((x) => x.successful && x.memo_type === 'text' && /^QW#\d+$/.test(x.memo));
  if (!t) throw new Error('no anchoring transaction found yet');
  const sigs = (t.signatures || []).length;
  return { ok: sigs >= 2, hash: t.hash, ledger: t.ledger_attr ?? t.ledger, memo: t.memo, signatures: sigs, expect: 'anchored with two signatures' };
}

/** D — verifier host, in memory only: alter the published batch after the proposer signed. */
async function testD({ feedUrl, cfg }) {
  const feed = makeFeedClient(feedUrl);
  const listed = await feed.batches();
  for (let i = listed.length - 1; i >= 0; i--) {
    const e = listed[i];
    if (e.status !== 'accepted') continue;
    const pending = await feed.pending(e.batch_id);
    if (!pending) continue;
    const batch = await feed.batch(e.batch_id);
    const forged = JSON.parse(JSON.stringify(batch));
    if (!forged.intervals.length) continue;
    forged.intervals[0].meters.a.mwh += 1000;
    if (forged.intervals[0].meters.b) forged.intervals[0].meters.b.mwh += 1000;
    forged.energy_mwh = forged.intervals.reduce((s, r) => s + E.basisMwh(r), 0);
    forged.cumulative_mwh = batch.cumulative_mwh - batch.energy_mwh + forged.energy_mwh;
    forged.intervals_root = E.merkleRoot(forged.intervals);
    forged.sha256 = E.batchSha256(forged);
    const tb = new S.Transaction(pending, cfg.network_passphrase).timeBounds;
    const m = T.matchPending(pending, forged, cfg, Math.min(Math.floor(Date.now() / 1000), Number(tb.maxTime) - 1));
    return { ok: !m.match, refused: !m.match, reasons: m.reasons, detail: m.detail, batch_id: e.batch_id, forged_sha256: forged.sha256, expect: 'verifier refuses; nothing submitted, nothing published' };
  }
  throw new Error('no published pending proposal with intervals to test against');
}

const STEP = { a: 'A_proposer_alone', b: 'B_verifier_alone', c: 'C_proposer_plus_verifier', d: 'D_altered_after_proposer_signed' };

function merge(file, account, which, result) {
  const ev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { network: 'testnet', public_keys: { account }, steps: {} };
  ev.public_keys.account = account;
  ev.steps[STEP[which]] = { ...result, at: new Date().toISOString() };
  const s = ev.steps;
  ev.verdict = s.A_proposer_alone && s.B_verifier_alone && s.C_proposer_plus_verifier && s.D_altered_after_proposer_signed
    ? (s.A_proposer_alone.refused && s.B_verifier_alone.refused && s.C_proposer_plus_verifier.ok && s.D_altered_after_proposer_signed.refused ? 'PASS' : 'FAIL')
    : 'INCOMPLETE';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ev, null, 2) + '\n');
  return ev;
}

async function cli() {
  const args = process.argv.slice(2);
  const which = (args[0] || '').toLowerCase();
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  if (!STEP[which]) { console.error('usage: node anchor/tests-abcd.js a|b|c|d --config anchor.json [--feed URL | --feed-dir DIR] [--out evidence/abcd/abcd.json]'); process.exit(2); }
  const cfg = loadConfig(opt('--config', path.join(__dirname, 'config.json')));
  const server = new S.Horizon.Server(cfg.horizon_url);
  const secretFor = { a: 'QWATT_PROPOSER_SECRET', b: 'QWATT_VERIFIER_SECRET' }[which];
  if (secretFor && !process.env[secretFor]) { console.error(`${secretFor} is not set; test ${which.toUpperCase()} runs on the host that holds that key`); process.exit(2); }
  const keypair = secretFor ? S.Keypair.fromSecret(process.env[secretFor]) : null;
  const run = { a: () => testA({ feedDir: path.resolve(opt('--feed-dir', 'feed')), cfg, keypair, server }), b: () => testB({ feedUrl: opt('--feed'), cfg, keypair, server }), c: () => testC({ cfg, server }), d: () => testD({ feedUrl: opt('--feed'), cfg }) }[which];
  const result = await run();
  const ev = merge(path.resolve(opt('--out', path.join(__dirname, '..', 'evidence', 'abcd', 'abcd.json'))), cfg.anchor_account, which, result);
  console.log(`test ${which.toUpperCase()}: ${JSON.stringify({ ...result, envelope_xdr: undefined })}`);
  console.log(`A–D evidence verdict so far: ${ev.verdict}`);
}

if (require.main === module) cli().catch((e) => { console.error('test failed to run:', e.message); process.exitCode = 1; });

module.exports = { testA, testB, testC, testD, merge, authRefused };
