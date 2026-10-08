#!/usr/bin/env node
/**
 * QWATT — 2-of-3 multisig rehearsal on a THROWAWAY testnet account (plan units 1.6 and 3.8)
 * ---------------------------------------------------------------------------
 *   node anchor/rehearse.js            run against Stellar testnet, write evidence/rehearsal/*.json
 *
 * Creates five fresh random keys (account master, proposer, verifier, third
 * signer, payment destination), funds the account and the destination with
 * Friendbot, configures native multisig exactly as the freeze specifies
 * (three signers × weight 1, thresholds 1/2/3, master weight 0), then submits
 * a real anchoring transaction for a real batch:
 *
 *   A  proposer signs alone             → must be rejected by the network
 *   B  verifier signs alone             → must be rejected by the network
 *   C  proposer + verifier              → must be accepted
 *   L  third signer + verifier (next batch) → must be accepted (third-key liveness)
 *   D  batch altered after the proposer signed → the verifier refuses (no submission)
 *
 * Throwaway by design: secret keys live only in this process and are never
 * written, logged or printed. The evidence file holds public keys, envelopes,
 * transaction hashes and network result codes. Nothing here touches the real
 * QWATT issuer or treasury. The payment uses native XLM, since the throwaway
 * account holds no QWATT.
 *
 * Notes for the write-up, learned from the first live run:
 *   - One weight-1 signature meets the LOW threshold, so the transaction itself
 *     is authorized; the manageData anchor needs MEDIUM (2), so Horizon answers
 *     tx_failed with op_bad_auth on that operation and nothing applies.
 *   - A, B and C have the SAME transaction hash: Stellar hashes exclude
 *     signatures. A and B never enter a ledger (C later succeeds on the same
 *     sequence), so never cite their hash; it resolves to C. Their evidence is
 *     the signed envelope plus the result codes.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const S = require('@stellar/stellar-sdk');
const E = require('../protocol/evidence');
const V = require('../batch/verify');
const { BatchAssembler } = require('../batch/assemble');
const T = require('./tx');

const HORIZON = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const OUT = path.join(__dirname, '..', 'evidence', 'rehearsal');

const server = new S.Horizon.Server(HORIZON);
const log = (...a) => console.log('[rehearse]', ...a);
const link = (h) => `https://stellar.expert/explorer/testnet/tx/${h}`;

async function friendbot(pub) {
  const r = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(pub)}`);
  if (!r.ok) throw new Error(`friendbot ${r.status} for ${pub.slice(0, 6)}…`);
}

/** Submit; return { ok, hash, codes } without throwing on a network rejection. */
async function submit(tx) {
  try {
    const res = await server.submitTransaction(tx);
    return { ok: true, hash: res.hash, ledger: res.ledger, codes: null };
  } catch (e) {
    const extras = e && e.response && e.response.data && e.response.data.extras;
    if (!extras) throw e;
    return { ok: false, body_hash: tx.hash().toString('hex'), signatures: tx.signatures.length, codes: extras.result_codes };
  }
}

/** Two consecutive real batches from a deterministic midday on the bench profile. */
function makeBatches() {
  const T0 = Date.parse('2026-09-20T15:00:00Z'), DT = 300;
  const iv = (i) => {
    const t = T0 + i * DT * 1000;
    const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
    return {
      spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION,
      site_id: 'rehearsal', node_id: 'rehearsal', seq: i,
      ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
      meters: { a: m('pzem-017:1', 100), b: m('epever-tracer:2', 99) },
      source: { adapter: 'simulator', raw_sha256: E.sha256('rehearsal-' + i) },
    };
  };
  const a = new BatchAssembler({ site_id: 'rehearsal', node_id: 'rehearsal' });
  const out = [];
  for (let b = 0; b < 2; b++) { for (let i = 0; i < 12; i++) a.judge(iv(b * 12 + i)); out.push(a.close().batch); }
  return out;
}

async function main() {
  const keys = {
    account: S.Keypair.random(),
    proposer: S.Keypair.random(),
    verifier: S.Keypair.random(),
    third: S.Keypair.random(),
    destination: S.Keypair.random(),
  };
  const pub = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v.publicKey()]));
  const evidence = { started_at: new Date().toISOString(), network: 'testnet', horizon: HORIZON, public_keys: pub, steps: {} };
  const record = (name, data) => { evidence.steps[name] = data; log(name, data.ok === false ? 'REJECTED' : 'ok', data.hash ? data.hash.slice(0, 16) + '…' : '', data.codes ? JSON.stringify(data.codes) : ''); };

  log('funding throwaway account and payment destination via Friendbot…');
  await friendbot(pub.account);
  await friendbot(pub.destination);

  /* multisig: three signers × 1, thresholds 1/2/3, master 0 — one transaction, master-signed */
  let acct = await server.loadAccount(pub.account);
  const setup = new S.TransactionBuilder(acct, { fee: String(S.BASE_FEE), networkPassphrase: S.Networks.TESTNET })
    .addOperation(S.Operation.setOptions({ signer: { ed25519PublicKey: pub.proposer, weight: 1 } }))
    .addOperation(S.Operation.setOptions({ signer: { ed25519PublicKey: pub.verifier, weight: 1 } }))
    .addOperation(S.Operation.setOptions({ signer: { ed25519PublicKey: pub.third, weight: 1 } }))
    .addOperation(S.Operation.setOptions({ masterWeight: 0, lowThreshold: 1, medThreshold: 2, highThreshold: 3 }))
    .setTimeout(300).build();
  setup.sign(keys.account);
  const rs = await submit(setup);
  record('setup', { ...rs, link: rs.ok ? link(rs.hash) : null });
  if (!rs.ok) throw new Error('multisig setup failed');

  acct = await server.loadAccount(pub.account);
  const signerTable = acct.signers.map((s) => ({ key: s.key, weight: s.weight }));
  evidence.account_after_setup = { thresholds: acct.thresholds, signers: signerTable };
  const t = acct.thresholds;
  if (t.low_threshold !== 1 || t.med_threshold !== 2 || t.high_threshold !== 3) throw new Error('thresholds not as specified');

  const cfg = {
    network_passphrase: S.Networks.TESTNET,
    anchor_account: pub.account,
    asset_code: 'native',
    payment_destination: pub.destination,
    payment_amount: '0.0000001',
    base_fee: Number(S.BASE_FEE),
  };
  const [b0, b1] = makeBatches();
  evidence.batches = [b0, b1].map((b) => ({ batch_id: b.batch_id, sha256: b.sha256, cumulative_mwh: b.cumulative_mwh }));

  /* A, B, C share one proposal: a rejected-at-validation transaction does not consume the sequence */
  const p0 = T.proposalParams(acct.sequence);
  const signedBy = (batch, params, ...signers) => {
    const tx = T.buildAnchorTx(batch, cfg, params);
    for (const k of signers) tx.sign(k);
    return tx;
  };

  const txA = signedBy(b0, p0, keys.proposer);
  const rA = await submit(txA);
  record('A_proposer_alone', { ...rA, expect: 'rejected', envelope_xdr: txA.toEnvelope().toXDR('base64') });

  const txB = signedBy(b0, p0, keys.verifier);
  const rB = await submit(txB);
  record('B_verifier_alone', { ...rB, expect: 'rejected', envelope_xdr: txB.toEnvelope().toXDR('base64') });

  /* C goes through the real verifier path: proposer signs and "publishes", verifier rebuilds and matches */
  const pendingC = signedBy(b0, p0, keys.proposer).toEnvelope().toXDR('base64');
  const mC = T.matchPending(pendingC, b0, cfg);
  if (!mC.match) throw new Error('verifier did not match its own rehearsal proposal: ' + mC.detail);
  mC.tx.sign(keys.verifier);
  const rC = await submit(mC.tx);
  record('C_proposer_plus_verifier', { ...rC, expect: 'accepted', link: rC.ok ? link(rC.hash) : null });

  /* D: published batch altered after the proposer signed — verifier refuses, nothing is submitted */
  acct = await server.loadAccount(pub.account);
  const p1 = T.proposalParams(acct.sequence);
  const pendingD = signedBy(b1, p1, keys.proposer).toEnvelope().toXDR('base64');
  const forged = JSON.parse(JSON.stringify(b1));
  forged.intervals[0].meters.a.mwh += 500; forged.intervals[0].meters.b.mwh += 500;
  forged.energy_mwh = forged.intervals.reduce((s, r) => s + E.basisMwh(r), 0);
  forged.cumulative_mwh = b0.cumulative_mwh + forged.energy_mwh;
  forged.intervals_root = E.merkleRoot(forged.intervals);
  forged.sha256 = E.batchSha256(forged);
  const mD = T.matchPending(pendingD, forged, cfg);
  record('D_altered_after_proposer_signed', { ok: !mD.match, refused: !mD.match, reasons: mD.reasons, detail: mD.detail, expect: 'verifier refuses; nothing submitted' });

  /* L: third signer + verifier anchor the genuine next batch — the off-team key works */
  const txL = signedBy(b1, p1, keys.third, keys.verifier);
  const rL = await submit(txL);
  record('L_third_plus_verifier', { ...rL, expect: 'accepted', link: rL.ok ? link(rL.hash) : null });

  /* on-chain state after: the anchor value equals the last anchored batch hash */
  acct = await server.loadAccount(pub.account);
  const onchain = Buffer.from(acct.data_attr[T.ANCHOR_KEY] || '', 'base64').toString('ascii');
  evidence.onchain_anchor_after = onchain;

  /* an auth refusal is tx_bad_auth, or tx_failed carrying op_bad_auth (one signature meets low, not medium) */
  const authRefused = (r) => !r.ok && !!r.codes && (r.codes.transaction === 'tx_bad_auth' ||
    (r.codes.transaction === 'tx_failed' && (r.codes.operations || []).includes('op_bad_auth')));
  const sameBody = rA.body_hash === rC.hash && rB.body_hash === rC.hash;
  evidence.note = 'A, B and C are the same transaction body (signatures are not hashed): refused with one signature, accepted with two. A and B never entered a ledger.';
  const pass = authRefused(rA) && authRefused(rB) && rC.ok && sameBody && !mD.match && rL.ok && onchain === b1.sha256;
  evidence.verdict = pass ? 'PASS' : 'FAIL';
  evidence.finished_at = new Date().toISOString();

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `rehearsal-${evidence.started_at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n');
  log(`verdict ${evidence.verdict} → ${path.relative(process.cwd(), file)}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('[rehearse] error:', e.message); process.exit(1); });
