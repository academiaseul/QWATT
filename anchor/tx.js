/**
 * QWATT — deterministic anchoring transaction (Deliverable 3)
 * ---------------------------------------------------------------------------
 * One transaction per accepted batch, three operations, atomic
 * (docs/ARCHITECTURE-FREEZE-v2.md, "Transaction format"):
 *
 *   1. manageData  qwatt.anchor.sha256   = batch sha256 (64 ASCII hex bytes)
 *   2. manageData  qwatt.cumulative_mwh  = decimal string of cumulative_mwh
 *   3. payment     nominal amount of the anchoring asset to a fixed account
 *   memo text QW#<seq> · base fee · timebounds ≤ 24 h
 *
 * Everything that matters is derived from the PUBLISHED batch plus public
 * config. Only three values are not evidence and come from the proposal: the
 * sequence number and the two timebounds. The verifier therefore rebuilds the
 * transaction from the batch it downloaded, borrows only those three values
 * from the pending XDR (checking the timebounds are sane), and signs only if
 * the rebuilt transaction hash equals the pending one. A proposer cannot get a
 * signature on anything the batch does not say.
 */

'use strict';

const S = require('@stellar/stellar-sdk');

const ANCHOR_KEY = 'qwatt.anchor.sha256';
const CUMULATIVE_KEY = 'qwatt.cumulative_mwh';
const MAX_WINDOW_S = 24 * 3600;

/**
 * @typedef {object} AnchorConfig
 * @property {string} network_passphrase
 * @property {string} anchor_account      G… the multisig anchoring account (transaction source)
 * @property {string} asset_code          anchoring vehicle asset (e.g. QWATT); "native" for XLM
 * @property {string} [asset_issuer]
 * @property {string} payment_destination G… fixed account receiving the nominal payment
 * @property {string} payment_amount      nominal amount, e.g. "0.0000001"
 * @property {number} [base_fee]          stroops, default 100
 */

function assetOf(cfg) {
  return cfg.asset_code === 'native' ? S.Asset.native() : new S.Asset(cfg.asset_code, cfg.asset_issuer);
}

function checkConfig(cfg) {
  for (const k of ['network_passphrase', 'anchor_account', 'asset_code', 'payment_destination', 'payment_amount']) {
    if (!cfg || !cfg[k]) throw new Error(`anchor config: ${k} is required`);
  }
  if (cfg.asset_code !== 'native' && !cfg.asset_issuer) throw new Error('anchor config: asset_issuer is required for a non-native asset');
  if (!S.StrKey.isValidEd25519PublicKey(cfg.anchor_account)) throw new Error('anchor config: anchor_account is not a G… key');
  if (!S.StrKey.isValidEd25519PublicKey(cfg.payment_destination)) throw new Error('anchor config: payment_destination is not a G… key');
}

/**
 * Build the unsigned anchoring transaction for a batch.
 * @param {object} batch           a published batch (batch.schema.json)
 * @param {AnchorConfig} cfg
 * @param {object} p
 * @param {string} p.sequence      the transaction's sequence number (account sequence + 1), decimal string
 * @param {number} p.minTime       unix seconds
 * @param {number} p.maxTime       unix seconds, ≤ minTime + 24 h
 * @returns {import('@stellar/stellar-sdk').Transaction}
 */
function buildAnchorTx(batch, cfg, p) {
  checkConfig(cfg);
  if (!/^[0-9a-f]{64}$/.test(batch.sha256)) throw new Error('batch.sha256 is not 64 lowercase hex');
  if (!Number.isSafeInteger(batch.cumulative_mwh) || batch.cumulative_mwh < 0) throw new Error('batch.cumulative_mwh must be a non-negative integer');
  if (!(p.maxTime > p.minTime) || p.maxTime - p.minTime > MAX_WINDOW_S) throw new Error('timebounds must be a window of at most 24 h');

  const source = new S.Account(cfg.anchor_account, (BigInt(p.sequence) - 1n).toString());
  return new S.TransactionBuilder(source, {
    fee: String(cfg.base_fee || S.BASE_FEE),
    networkPassphrase: cfg.network_passphrase,
    timebounds: { minTime: p.minTime, maxTime: p.maxTime },
  })
    .addOperation(S.Operation.manageData({ name: ANCHOR_KEY, value: Buffer.from(batch.sha256, 'ascii') }))
    .addOperation(S.Operation.manageData({ name: CUMULATIVE_KEY, value: Buffer.from(String(batch.cumulative_mwh), 'ascii') }))
    .addOperation(S.Operation.payment({ destination: cfg.payment_destination, asset: assetOf(cfg), amount: cfg.payment_amount }))
    .addMemo(S.Memo.text(`QW#${batch.seq}`))
    .build();
}

/** Five minutes of slack below "now", so a proposer clock running slightly fast still yields a valid transaction. */
const CLOCK_SLACK_S = 300;

/** Proposal parameters for a fresh transaction: next sequence, a 24 h window starting now (minus slack). */
function proposalParams(accountSequence, nowS = Math.floor(Date.now() / 1000)) {
  const minTime = nowS - CLOCK_SLACK_S;
  return { sequence: (BigInt(accountSequence) + 1n).toString(), minTime, maxTime: minTime + MAX_WINDOW_S };
}

/**
 * Verifier side: does the pending transaction say exactly what the published batch says?
 * @param {string} pendingXdr   envelope XDR from the feed (may already carry the proposer's signature)
 * @param {object} batch        the batch as downloaded from the feed and verified
 * @param {AnchorConfig} cfg
 * @param {number} [nowS]
 * @returns {{match:boolean, reasons:string[], tx:object|null, hash:string|null}}
 */
function matchPending(pendingXdr, batch, cfg, nowS = Math.floor(Date.now() / 1000)) {
  let pending;
  try {
    pending = new S.Transaction(pendingXdr, cfg.network_passphrase);
  } catch (e) {
    return { match: false, reasons: ['verifier.tx_mismatch'], tx: null, hash: null, detail: 'unparseable XDR: ' + e.message };
  }
  const tb = pending.timeBounds || {};
  const minTime = Number(tb.minTime || 0), maxTime = Number(tb.maxTime || 0);
  const reasons = [];
  let detail = null;
  if (!(maxTime > nowS)) { reasons.push('verifier.tx_mismatch'); detail = 'pending transaction expired'; }
  else if (maxTime - Math.max(minTime, nowS) > MAX_WINDOW_S) { reasons.push('verifier.tx_mismatch'); detail = 'timebounds wider than 24 h'; }
  if (reasons.length) return { match: false, reasons, tx: null, hash: null, detail };

  /* the anchor value is checked on its own first so a stale/altered batch gets the precise reason */
  const op0 = pending.operations[0];
  if (!op0 || op0.type !== 'manageData' || op0.name !== ANCHOR_KEY || !op0.value || op0.value.toString('ascii') !== batch.sha256) {
    return { match: false, reasons: ['verifier.hash_mismatch'], tx: null, hash: null, detail: 'pending anchor ≠ hash of the published batch' };
  }

  let rebuilt;
  try {
    rebuilt = buildAnchorTx(batch, cfg, { sequence: pending.sequence, minTime, maxTime });
  } catch (e) {
    return { match: false, reasons: ['verifier.tx_mismatch'], tx: null, hash: null, detail: e.message };
  }
  const same = rebuilt.hash().equals(pending.hash());
  return {
    match: same,
    reasons: same ? [] : ['verifier.tx_mismatch'],
    tx: same ? pending : null,
    hash: same ? pending.hash().toString('hex') : null,
    detail: same ? null : 'rebuilt transaction differs from the pending one',
  };
}

module.exports = { buildAnchorTx, proposalParams, matchPending, checkConfig, ANCHOR_KEY, CUMULATIVE_KEY, MAX_WINDOW_S };
