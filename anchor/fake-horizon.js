/**
 * QWATT — in-memory Horizon for recovery tests (no network)
 * ---------------------------------------------------------------------------
 * Enforces what the real network enforced in the live rehearsal, for the one
 * anchoring account under test:
 *
 *   - sequence must be exactly account sequence + 1            (tx_bad_seq)
 *   - ledger time inside the timebounds                         (tx_too_early / tx_too_late)
 *   - signature weight ≥ medium threshold for manageData/payment (tx_failed / op_bad_auth),
 *     verified cryptographically against the configured signers
 *   - on success: manageData applied, sequence consumed, a transaction record
 *     with memo and ledger appended
 *
 * Fault injection (one-shot): `failNext = 'timeout-after'` applies the
 * transaction and then throws a network error (the classic Horizon 504 that
 * still landed); `'timeout-before'` throws without applying. `offline = true`
 * makes every call throw.
 */

'use strict';

const S = require('@stellar/stellar-sdk');

class FakeHorizon {
  /**
   * @param {object} o
   * @param {string} o.account          anchoring account id
   * @param {string[]} o.signers        signer public keys, weight 1 each
   * @param {object} o.clock            { now(): unix seconds }
   * @param {string} [o.passphrase]
   */
  constructor(o) {
    this.account = o.account;
    this.signers = o.signers.map((k) => ({ key: k, weight: 1, type: 'ed25519_public_key' }));
    this.clock = o.clock;
    this.passphrase = o.passphrase || S.Networks.TESTNET;
    this.sequence = 1000n;
    this.data = {};
    this.txs = [];
    this.ledger = 100;
    this.failNext = null;
    this.offline = false;
    this.submissions = 0;
  }

  _guard() { if (this.offline) throw Object.assign(new Error('connect ECONNREFUSED (fake Horizon offline)'), { code: 'ECONNREFUSED' }); }

  async loadAccount(id) {
    this._guard();
    if (id !== this.account) throw new Error('unknown account');
    return {
      sequence: this.sequence.toString(),
      data_attr: { ...this.data },
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
      signers: [...this.signers, { key: this.account, weight: 0, type: 'ed25519_public_key' }],
    };
  }

  _reject(codes) {
    const e = new Error('Request failed with status code 400');
    e.response = { status: 400, data: { extras: { result_codes: codes } } };
    throw e;
  }

  _weight(tx) {
    const hash = tx.hash();
    let w = 0;
    const used = new Set();
    for (const sig of tx.signatures) {
      const hint = sig.hint();
      for (const s of this.signers) {
        if (used.has(s.key)) continue;
        const kp = S.Keypair.fromPublicKey(s.key);
        if (kp.signatureHint().equals(hint) && kp.verify(hash, sig.signature())) { w += s.weight; used.add(s.key); break; }
      }
    }
    return w;
  }

  async submitTransaction(tx) {
    this._guard();
    this.submissions++;
    const mode = this.failNext; this.failNext = null;
    if (mode === 'timeout-before') throw Object.assign(new Error('timeout of 60000ms exceeded (fake, did not land)'), { code: 'ECONNABORTED' });
    if (tx.source !== this.account) this._reject({ transaction: 'tx_failed', operations: ['op_bad_auth'] });
    if (BigInt(tx.sequence) !== this.sequence + 1n) this._reject({ transaction: 'tx_bad_seq' });
    const now = this.clock.now();
    const tb = tx.timeBounds || { minTime: '0', maxTime: '0' };
    if (Number(tb.minTime) > now) this._reject({ transaction: 'tx_too_early' });
    if (Number(tb.maxTime) !== 0 && Number(tb.maxTime) < now) this._reject({ transaction: 'tx_too_late' });
    if (this._weight(tx) < 2) this._reject({ transaction: 'tx_failed', operations: tx.operations.map((op, i) => (i === 0 ? 'op_bad_auth' : 'op_success')) });

    for (const op of tx.operations) if (op.type === 'manageData') this.data[op.name] = op.value.toString('base64');
    this.sequence += 1n;
    this.ledger += 1;
    const hash = tx.hash().toString('hex');
    this.txs.push({ hash, successful: true, memo_type: 'text', memo: tx.memo.value.toString(), ledger_attr: this.ledger, created_at: new Date(now * 1000).toISOString(), signatures: tx.signatures.map((x) => x.signature().toString('base64')) });
    if (mode === 'timeout-after') throw Object.assign(new Error('timeout of 60000ms exceeded (fake, but it landed)'), { code: 'ECONNABORTED' });
    return { hash, ledger: this.ledger };
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

module.exports = { FakeHorizon };
