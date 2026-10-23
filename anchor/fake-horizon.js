/**
 * QWATT — in-memory Horizon for recovery tests (no network)
 * ---------------------------------------------------------------------------
 * Enforces what the real network enforces, for the one account under test:
 *
 *   - the source account must exist                              (tx_no_account)
 *   - sequence must be exactly account sequence + 1              (tx_bad_seq)
 *   - ledger time inside the timebounds                           (tx_too_early / tx_too_late)
 *   - Stellar's signature rules, verified cryptographically against the
 *     account's signers (the master key counts with its own weight, a key of
 *     weight 0 counts for nothing, and a threshold of 0 still needs one valid
 *     signature):
 *       · the transaction itself (fee and sequence) needs the source account's
 *         LOW threshold, or it is rejected as tx_bad_auth and nothing applies;
 *       · every operation needs its own level, checked before any operation
 *         applies, or the transaction is rejected as tx_failed with op_bad_auth
 *         on the first operation that falls short (the ones after it stay
 *         op_success, as Horizon shows them) and nothing applies.
 *     Levels: bumpSequence, allowTrust, setTrustLineFlags LOW; setOptions that
 *     changes a signer, a threshold or the master weight, and accountMerge HIGH;
 *     everything else (manageData, payment, changeTrust, other setOptions) MEDIUM.
 *   - on success: the operations apply (manageData, changeTrust, setOptions,
 *     bumpSequence; a payment is recorded but moves no balance), the sequence is
 *     consumed, and a transaction record with memo, ledger, signatures and
 *     envelope_xdr is appended; the answer carries hash, ledger, envelope_xdr and
 *     successful: true.
 *   - a refusal is answered as Horizon answers it: HTTP 400 with a problem JSON
 *     (type …/transaction_failed, title, status, extras.envelope_xdr,
 *     extras.result_codes, and extras.result_xdr for a transaction-level code).
 *
 * Without `account`, no account exists until `fund(id)` (what Friendbot does)
 * creates one the way the network does: master weight 1, thresholds 0/0/0, no
 * other signers. With `account`, it starts already configured: `signers` of
 * weight 1, master weight 0, and `thresholds` (default: anchor/thresholds.js).
 *
 * Fault injection (one-shot): `failNext = 'timeout-after'` applies the
 * transaction and then throws a network error (the classic Horizon 504 that
 * still landed); `'timeout-before'` throws without applying. `offline = true`
 * makes every call throw.
 */

'use strict';

const S = require('@stellar/stellar-sdk');
const { THRESHOLDS } = require('./thresholds');

/* the anchoring account's real thresholds (2/2/3) unless a test passes others */
const DEFAULT_THRESHOLDS = { ...THRESHOLDS };
const LOW_OPS = new Set(['bumpSequence', 'allowTrust', 'setTrustLineFlags']);
const HIGH_FIELDS = ['signer', 'masterWeight', 'lowThreshold', 'medThreshold', 'highThreshold'];
/* transaction-level result codes and their TransactionResult arms (result_xdr is built only for these) */
const TX_RESULT_ARMS = { tx_bad_auth: 'txBadAuth', tx_bad_seq: 'txBadSeq', tx_too_late: 'txTooLate', tx_too_early: 'txTooEarly', tx_no_account: 'txNoAccount' };

/** The threshold level Stellar requires for an operation: 'low', 'med' or 'high'. */
function levelOf(op) {
  if (LOW_OPS.has(op.type)) return 'low';
  if (op.type === 'accountMerge') return 'high';
  if (op.type === 'setOptions' && HIGH_FIELDS.some((f) => op[f] !== undefined && op[f] !== null)) return 'high';
  return 'med';
}

class FakeHorizon {
  /**
   * @param {object} o
   * @param {string} [o.account]        account id; omit to start with no account (see fund)
   * @param {string[]} [o.signers]      signer public keys, weight 1 each
   * @param {{low:number, med:number, high:number}} [o.thresholds]
   * @param {object} o.clock            { now(): unix seconds }
   * @param {string} [o.passphrase]
   */
  constructor(o) {
    this.account = o.account || null;
    this.signers = (o.signers || []).map((k) => ({ key: k, weight: 1, type: 'ed25519_public_key' }));
    this.masterWeight = 0;
    this.thresholds = { ...(o.thresholds || DEFAULT_THRESHOLDS) };
    this.clock = o.clock;
    this.passphrase = o.passphrase || S.Networks.TESTNET;
    this.sequence = 1000n;
    this.data = {};
    this.trustlines = [];
    this.txs = [];
    this.ledger = 100;
    this.failNext = null;
    this.offline = false;
    this.submissions = 0;
  }

  _guard() { if (this.offline) throw Object.assign(new Error('connect ECONNREFUSED (fake Horizon offline)'), { code: 'ECONNREFUSED' }); }

  /** What Friendbot does: create the account, master weight 1, thresholds 0/0/0, no other signers. */
  fund(id) {
    if (this.account) throw new Error('fake Horizon models one account, and it already exists');
    this.account = id;
    this.signers = [];
    this.masterWeight = 1;
    this.thresholds = { low: 0, med: 0, high: 0 };
    this.sequence = BigInt(this.ledger) << 32n;
    this.data = {};
    this.trustlines = [];
  }

  /** Test helper standing in for a payment received (e.g. the treasury's funding transaction). */
  credit(code, issuer, amount) {
    const line = this.trustlines.find((l) => l.asset_code === code && l.asset_issuer === issuer);
    if (!line) throw new Error(`no ${code} trustline`);
    line.balance = (Number(line.balance) + Number(amount)).toFixed(7);
  }

  async loadAccount(id) {
    this._guard();
    if (!this.account || id !== this.account) throw new Error('unknown account');
    return {
      id: this.account,
      account_id: this.account,
      sequence: this.sequence.toString(),
      data_attr: { ...this.data },
      thresholds: { low_threshold: this.thresholds.low, med_threshold: this.thresholds.med, high_threshold: this.thresholds.high },
      signers: [...this.signers.map((s) => ({ ...s })), { key: this.account, weight: this.masterWeight, type: 'ed25519_public_key' }],
      balances: [...this.trustlines.map((l) => ({ ...l })), { asset_type: 'native', balance: '10000.0000000' }],
      // what TransactionBuilder needs from an account, as on Horizon's AccountResponse
      accountId() { return this.account_id; },
      sequenceNumber() { return this.sequence; },
      incrementSequenceNumber() { this.sequence = (BigInt(this.sequence) + 1n).toString(); },
    };
  }

  _reject(codes, tx) {
    const e = new Error('Request failed with status code 400');
    const extras = { envelope_xdr: tx.toEnvelope().toXDR('base64'), result_codes: codes };
    const arm = TX_RESULT_ARMS[codes.transaction];
    if (arm && !codes.operations) {
      extras.result_xdr = new S.xdr.TransactionResult({
        feeCharged: S.xdr.Int64.fromString('0'), result: S.xdr.TransactionResultResult[arm](), ext: new S.xdr.TransactionResultExt(0),
      }).toXDR('base64');
    }
    e.response = { status: 400, data: { type: 'https://stellar.org/horizon-errors/transaction_failed', title: 'Transaction Failed', status: 400, extras } };
    throw e;
  }

  /** Total weight of the distinct account signers (master included) whose signatures are valid. */
  _weight(tx) {
    const hash = tx.hash();
    const all = [...this.signers, { key: this.account, weight: this.masterWeight }].filter((s) => s.weight > 0);
    let w = 0;
    const used = new Set();
    for (const sig of tx.signatures) {
      const hint = sig.hint();
      for (const s of all) {
        if (used.has(s.key)) continue;
        const kp = S.Keypair.fromPublicKey(s.key);
        if (kp.signatureHint().equals(hint) && kp.verify(hash, sig.signature())) { w += s.weight; used.add(s.key); break; }
      }
    }
    return w;
  }

  /** Stellar: authorized when the weight meets the threshold and at least one valid signature counts. */
  _meets(weight, level) { return weight >= Math.max(this.thresholds[level], 1); }

  _apply(op) {
    switch (op.type) {
      case 'manageData':
        if (op.value === null || op.value === undefined) delete this.data[op.name];
        else this.data[op.name] = op.value.toString('base64');
        break;
      case 'changeTrust': {
        const code = op.line.getCode(), issuer = op.line.getIssuer();
        const i = this.trustlines.findIndex((l) => l.asset_code === code && l.asset_issuer === issuer);
        if (Number(op.limit) === 0) { if (i >= 0) this.trustlines.splice(i, 1); }
        else if (i < 0) this.trustlines.push({ asset_type: code.length > 4 ? 'credit_alphanum12' : 'credit_alphanum4', asset_code: code, asset_issuer: issuer, balance: '0.0000000', limit: op.limit });
        break;
      }
      case 'setOptions':
        if (op.masterWeight !== undefined) this.masterWeight = op.masterWeight;
        if (op.lowThreshold !== undefined) this.thresholds.low = op.lowThreshold;
        if (op.medThreshold !== undefined) this.thresholds.med = op.medThreshold;
        if (op.highThreshold !== undefined) this.thresholds.high = op.highThreshold;
        if (op.signer && op.signer.ed25519PublicKey) {
          const key = op.signer.ed25519PublicKey;
          this.signers = this.signers.filter((s) => s.key !== key);
          if (op.signer.weight > 0) this.signers.push({ key, weight: op.signer.weight, type: 'ed25519_public_key' });
        }
        break;
      case 'bumpSequence':
        if (BigInt(op.bumpTo) > this.sequence) this.sequence = BigInt(op.bumpTo);
        break;
      default:
        break;   // payment: recorded with the transaction; balances are not modelled
    }
  }

  async submitTransaction(tx) {
    this._guard();
    this.submissions++;
    const mode = this.failNext; this.failNext = null;
    if (mode === 'timeout-before') throw Object.assign(new Error('timeout of 60000ms exceeded (fake, did not land)'), { code: 'ECONNABORTED' });
    if (!this.account || tx.source !== this.account) this._reject({ transaction: 'tx_no_account' }, tx);
    if (BigInt(tx.sequence) !== this.sequence + 1n) this._reject({ transaction: 'tx_bad_seq' }, tx);
    const now = this.clock.now();
    const tb = tx.timeBounds || { minTime: '0', maxTime: '0' };
    if (Number(tb.minTime) > now) this._reject({ transaction: 'tx_too_early' }, tx);
    if (Number(tb.maxTime) !== 0 && Number(tb.maxTime) < now) this._reject({ transaction: 'tx_too_late' }, tx);
    const weight = this._weight(tx);
    if (!this._meets(weight, 'low')) this._reject({ transaction: 'tx_bad_auth' }, tx);
    const short = tx.operations.findIndex((op) => !this._meets(weight, levelOf(op)));
    if (short >= 0) this._reject({ transaction: 'tx_failed', operations: tx.operations.map((op, i) => (i === short ? 'op_bad_auth' : 'op_success')) }, tx);

    this.sequence = BigInt(tx.sequence);
    for (const op of tx.operations) this._apply(op);
    this.ledger += 1;
    const hash = tx.hash().toString('hex');
    const memo = tx.memo && tx.memo.value !== null && tx.memo.value !== undefined ? tx.memo.value.toString() : undefined;
    const envelope_xdr = tx.toEnvelope().toXDR('base64');
    this.txs.push({ hash, successful: true, memo_type: tx.memo ? tx.memo.type : 'none', memo, ledger_attr: this.ledger, created_at: new Date(now * 1000).toISOString(), signatures: tx.signatures.map((x) => x.signature().toString('base64')), envelope_xdr,
      data: tx.operations.filter((op) => op.type === 'manageData').map((op) => ({ name: op.name, value: op.value == null ? null : op.value.toString('ascii') })) });
    if (mode === 'timeout-after') throw Object.assign(new Error('timeout of 60000ms exceeded (fake, but it landed)'), { code: 'ECONNABORTED' });
    return { hash, ledger: this.ledger, envelope_xdr, successful: true };
  }

  transactions() {
    const self = this;
    let desc = false, limit = 10;
    const q = {
      forAccount() { return q; },
      order(o) { desc = o === 'desc'; return q; },
      limit(n) { limit = n; return q; },
      async call() {
        self._guard();
        const all = desc ? [...self.txs].reverse() : [...self.txs];
        const page = (start) => ({ records: all.slice(start, start + limit), next: async () => page(start + limit) });
        return page(0);
      },
    };
    return q;
  }

  /** GET /accounts/<id> as Horizon's REST API returns it (served by fake-horizon-http.js), or null before the account exists. */
  restRecord() {
    if (!this.account) return null;
    return {
      id: this.account, account_id: this.account, sequence: this.sequence.toString(),
      thresholds: { low_threshold: this.thresholds.low, med_threshold: this.thresholds.med, high_threshold: this.thresholds.high },
      signers: [...this.signers.map((s) => ({ weight: s.weight, key: s.key, type: s.type || 'ed25519_public_key' })), { weight: this.masterWeight, key: this.account, type: 'ed25519_public_key' }],
      data: { ...this.data },
    };
  }

  /** Every landed transaction that wrote qwatt.anchor.sha256, oldest first, in the shape fake-horizon-http.js serves. */
  restAnchors() {
    const val = (t, n) => { const d = (t.data || []).find((x) => x.name === n); return d ? d.value : null; };
    return this.txs.filter((t) => t.successful && val(t, 'qwatt.anchor.sha256') != null).map((t) => ({
      tx_hash: t.hash, ledger: t.ledger_attr, created_at: t.created_at, memo: t.memo_type === 'text' ? t.memo : null,
      sha256: val(t, 'qwatt.anchor.sha256'), cumulative_mwh: Number(val(t, 'qwatt.cumulative_mwh')), signatures: t.signatures,
    }));
  }

  ledgers() {
    const self = this;
    const q = {
      order() { return q; },
      limit() { return q; },
      async call() { self._guard(); return { records: [{ sequence: self.ledger, closed_at: new Date(self.clock.now() * 1000).toISOString() }] }; },
    };
    return q;
  }
}

module.exports = { FakeHorizon, levelOf, DEFAULT_THRESHOLDS };
