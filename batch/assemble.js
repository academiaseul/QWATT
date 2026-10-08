/**
 * QWATT — batch assembler (Deliverable 2)
 * ---------------------------------------------------------------------------
 * Intervals in, judged ledger lines and hash-chained batches out.
 *
 *   judge(interval)  → one ledger line: accepted (with its basis energy) or
 *                      rejected (with registered reason codes). Duplicates and
 *                      out-of-order intervals are rejected here with ingest.*
 *                      codes, so the same window is never counted twice.
 *   close()          → the batch for the open window, self-verified with the
 *                      same verifyBatch the independent verifier runs.
 *
 * A window closes every `closeEvery` judged intervals (12 = one hour at 5 min,
 * docs/ARCHITECTURE-FREEZE.md §2) or when the caller closes it (shutdown,
 * restart). Rejected intervals never enter a batch; they are counted in it and
 * listed in the rejected ledger with the batch id.
 *
 * No I/O here; batch/pipeline.js persists lines and batches.
 */

'use strict';

const E = require('../protocol/evidence');
const V = require('./verify');

class BatchAssembler {
  /**
   * @param {object} o
   * @param {string} o.site_id
   * @param {string} o.node_id
   * @param {number} [o.closeEvery=12]
   * @param {object} [o.profile]  gate profile (default: spec profile `bench`)
   * @param {object} [o.state]    { seq, prev_hash, cumulative_mwh, last_ts_start } to resume a chain
   */
  constructor(o) {
    if (!o || !o.site_id || !o.node_id) throw new Error('BatchAssembler: site_id and node_id are required');
    this.site_id = o.site_id;
    this.node_id = o.node_id;
    this.closeEvery = o.closeEvery || 12;
    this.spec = o.spec || V.SPEC;
    this.profile = o.profile || this.spec.profiles.bench;
    const s = o.state || {};
    this.seq = s.seq ?? 0;
    this.prev_hash = s.prev_hash ?? E.ZERO_HASH;
    this.cumulative_mwh = s.cumulative_mwh ?? 0;
    this.last_ts_start = s.last_ts_start ?? null;   // ISO string of the latest in-order interval judged
    this.window = [];                               // ledger lines of the open window, in judgment order
  }

  get openBatchId() { return E.batchId(this.site_id, this.seq); }
  get full() { return this.window.length >= this.closeEvery; }

  state() {
    return { seq: this.seq, prev_hash: this.prev_hash, cumulative_mwh: this.cumulative_mwh, last_ts_start: this.last_ts_start };
  }

  /** Judge one interval record. @returns ledger line */
  judge(rec) {
    const line = { batch_id: this.openBatchId, verdict: 'reject', reasons: [], interval: rec };
    const errs = V.intervalErrors(rec);
    if (errs.length) {
      line.reasons = [errs.some((e) => /safe integer/.test(e)) ? 'ingest.not_integer' : 'ingest.schema_invalid'];
      line.detail = { errors: errs.slice(0, 5) };
    } else if (rec.spec_version !== this.spec.spec_version || rec.schema_version !== V.INTERVAL_SCHEMA_VERSION) {
      line.reasons = ['ingest.spec_mismatch'];
    } else if (this._seen(rec.ts_start)) {
      line.reasons = ['ingest.duplicate_interval'];
    } else if (this.last_ts_start != null && Date.parse(rec.ts_start) < Date.parse(this.last_ts_start)) {
      line.reasons = ['ingest.out_of_order'];
    } else {
      const v = V.GATES.evaluateInterval(rec, this.profile, this.spec);
      this.last_ts_start = rec.ts_start;
      if (v.verdict === 'accept') {
        line.verdict = 'accept';
        line.basis_mwh = E.basisMwh(rec);
      } else {
        line.reasons = v.failures.map((f) => f.code);
      }
    }
    this.window.push(line);
    return line;
  }

  /** Restore an already-persisted line into the open window (restart recovery). */
  restore(line) {
    if (line.batch_id !== this.openBatchId) throw new Error(`restore: line belongs to ${line.batch_id}, open batch is ${this.openBatchId}`);
    this.window.push(line);
    const inOrder = !(line.reasons || []).some((c) => c.startsWith('ingest.'));
    if (inOrder && (this.last_ts_start == null || Date.parse(line.interval.ts_start) > Date.parse(this.last_ts_start))) {
      this.last_ts_start = line.interval.ts_start;
    }
  }

  _seen(tsStart) {
    if (this.last_ts_start === tsStart) return true;
    return this.window.some((l) => l.interval && l.interval.ts_start === tsStart && !(l.reasons || []).some((c) => c.startsWith('ingest.')));
  }

  /**
   * Close the open window into a batch.
   * @returns {null | {batch:object, status:'accepted'|'rejected', reasons:string[], failures:Array}}
   */
  close() {
    if (this.window.length === 0) return null;
    const accepted = this.window.filter((l) => l.verdict === 'accept');
    const rejected = this.window.filter((l) => l.verdict !== 'accept');
    const timed = this.window.filter((l) => !(l.reasons || []).some((c) => c.startsWith('ingest.')));
    const bounds = (timed.length ? timed : this.window).map((l) => l.interval);
    const tsStart = bounds.reduce((m, r) => (Date.parse(r.ts_start) < Date.parse(m) ? r.ts_start : m), bounds[0].ts_start);
    const tsEnd = bounds.reduce((m, r) => (Date.parse(r.ts_end) > Date.parse(m) ? r.ts_end : m), bounds[0].ts_end);
    const intervals = accepted.map((l) => l.interval).sort((x, y) => Date.parse(x.ts_start) - Date.parse(y.ts_start));
    const energy = intervals.reduce((s, r) => s + E.basisMwh(r), 0);

    const batch = {
      batch_id: this.openBatchId,
      site_id: this.site_id,
      node_id: this.node_id,
      seq: this.seq,
      ts_start: tsStart,
      ts_end: tsEnd,
      spec_version: this.spec.spec_version,
      schema_version: V.INTERVAL_SCHEMA_VERSION,
      interval_count: this.window.length,
      accepted_count: accepted.length,
      rejected_count: rejected.length,
      intervals,
      intervals_root: E.merkleRoot(intervals),
      energy_mwh: energy,
      cumulative_mwh: this.cumulative_mwh + energy,
      prev_hash: this.prev_hash,
    };
    batch.sha256 = E.batchSha256(batch);

    const prev = this.seq === 0 ? null
      : { seq: this.seq - 1, sha256: this.prev_hash, cumulative_mwh: this.cumulative_mwh, site_id: this.site_id };
    const check = V.verifyBatch(batch, { prev, rejected, profile: this.profile, spec: this.spec });

    /* The chain advances through a batch-level rejection so the defect stays
       visible in sequence; it is published, never anchored. */
    this.seq += 1;
    this.prev_hash = batch.sha256;
    this.cumulative_mwh = batch.cumulative_mwh;
    this.window = [];

    return {
      batch,
      status: check.ok ? 'accepted' : 'rejected',
      reasons: [...new Set(check.failures.map((f) => f.code))],
      failures: check.failures,
    };
  }
}

module.exports = { BatchAssembler };
