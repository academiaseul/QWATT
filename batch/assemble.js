/**
 * QWATT — batch assembler (Deliverable 2)
 * ---------------------------------------------------------------------------
 * Intervals in, judged ledger lines and hash-chained batches out.
 *
 *   judge(interval)  → one ledger line: accepted (with its basis energy) or
 *                      rejected (with registered reason codes). Intervals from
 *                      another site or node, off-grid, duplicate, out-of-order
 *                      and overlapping intervals are rejected here with ingest.*
 *                      codes, so the same time is never counted twice and one
 *                      bad line never sinks a batch.
 *   close()          → the batch for the open window, self-verified with the
 *                      same verifyBatch the independent verifier runs.
 *
 * A window closes every `closeEvery` judged intervals (12 = one hour at 5 min,
 * docs/ARCHITECTURE-FREEZE.md §2) or when the caller closes it (shutdown,
 * restart). Rejected intervals never enter a batch; they are counted in it and
 * listed in the rejected ledger with the batch id.
 *
 * The door applies the verifier's rule. The floor is the last accepted batch:
 * a refused batch never moves it, so it never moves back. An interval must
 * start at or after the end of the latest interval that holds time here
 * (`last_ts_end`, resumed from the floor), and a batch window spans only the
 * intervals that hold time: accepted ones, and gate-refused ones no longer
 * than the profile's interval_max_dt_s. Lines refused at the door never set a
 * window; with nothing that holds time the window is zero-length at the floor
 * (the epoch before anything is accepted).
 *
 * No I/O here; batch/pipeline.js persists lines and batches.
 */

'use strict';

const E = require('../protocol/evidence');
const V = require('./verify');

const iso = (ms) => new Date(ms).toISOString();
const EPOCH = iso(0);   // the floor before anything is accepted: canonical, and on every grid
const refusedAtDoor = (l) => (l.reasons || []).some((c) => c.startsWith('ingest.'));

class BatchAssembler {
  /**
   * @param {object} o
   * @param {string} o.site_id
   * @param {string} o.node_id
   * @param {number} [o.closeEvery=12]
   * @param {object} [o.profile]  gate profile (default: spec profile `bench`)
   * @param {object} [o.state]    { seq, prev_hash, cumulative_mwh, last_ts_start, prev, floor } to resume a chain:
   *                              prev is the last published batch, floor the last accepted one (or null)
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
    this.prev = s.prev ?? null;                     // the last published batch, as published (verifyBatch rehashes it)
    this.floor = s.floor ?? null;                   // the last accepted batch: time, node and counted intervals start here
    this.last_ts_end = this.floor ? this.floor.ts_end : null;   // end of the latest interval that holds time
    this.window = [];                               // ledger lines of the open window, in judgment order
  }

  get openBatchId() { return E.batchId(this.site_id, this.seq); }
  get full() { return this.window.length >= this.closeEvery; }
  /** Where the next batch may start, and the node it must name: the floor's, set only by an accepted batch. */
  get prev_ts_end() { return this.floor ? this.floor.ts_end : null; }
  get prev_node_id() { return this.floor ? this.floor.node_id : null; }

  state() {
    return { seq: this.seq, prev_hash: this.prev_hash, cumulative_mwh: this.cumulative_mwh, last_ts_start: this.last_ts_start, prev: this.prev, floor: this.floor };
  }

  /** Does this judged line hold time? Accepted, or refused by a gate while no longer than the profile allows. */
  _holdsTime(line) {
    if (line.verdict === 'accept') return true;
    return !refusedAtDoor(line) && line.interval.dt_s <= this.profile.interval_max_dt_s;
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
    } else if (rec.site_id !== this.site_id || rec.node_id !== this.node_id) {
      line.reasons = ['ingest.site_mismatch'];
    } else if (V.offGrid(rec)) {
      line.reasons = ['ingest.off_grid'];
      line.detail = { why: V.offGrid(rec) };
    } else if (this._seen(rec.ts_start)) {
      line.reasons = ['ingest.duplicate_interval'];
    } else if (this.last_ts_start != null && Date.parse(rec.ts_start) < Date.parse(this.last_ts_start)) {
      line.reasons = ['ingest.out_of_order'];
    } else if (this.last_ts_end != null && Date.parse(rec.ts_start) < Date.parse(this.last_ts_end)) {
      line.reasons = ['ingest.overlap'];
      line.detail = { after: this.last_ts_end };
    } else {
      const v = V.GATES.evaluateInterval(rec, this.profile, this.spec);
      this.last_ts_start = rec.ts_start;
      if (v.verdict === 'accept') {
        line.verdict = 'accept';
        line.basis_mwh = E.basisMwh(rec);
      } else {
        line.reasons = v.failures.map((f) => f.code);
      }
      if (this._holdsTime(line)) this.last_ts_end = rec.ts_end;
    }
    this.window.push(line);
    return line;
  }

  /** Restore an already-persisted line into the open window (restart recovery). */
  restore(line) {
    if (line.batch_id !== this.openBatchId) throw new Error(`restore: line belongs to ${line.batch_id}, open batch is ${this.openBatchId}`);
    this.window.push(line);
    const inOrder = !refusedAtDoor(line);
    if (inOrder && (this.last_ts_start == null || Date.parse(line.interval.ts_start) > Date.parse(this.last_ts_start))) {
      this.last_ts_start = line.interval.ts_start;
    }
    if (this._holdsTime(line) && (this.last_ts_end == null || Date.parse(line.interval.ts_end) > Date.parse(this.last_ts_end))) {
      this.last_ts_end = line.interval.ts_end;
    }
  }

  _seen(tsStart) {
    if (this.last_ts_start === tsStart) return true;
    return this.window.some((l) => l.interval && l.interval.ts_start === tsStart && !refusedAtDoor(l));
  }

  /**
   * Move the chain past a published batch. Only an accepted batch becomes the
   * floor; verifyBatch has checked that it starts at or after the old floor,
   * so the floor never moves back.
   */
  advance(batch, accepted) {
    this.seq = batch.seq + 1;
    this.prev = batch;
    this.prev_hash = batch.sha256;
    this.cumulative_mwh = batch.cumulative_mwh;
    if (accepted) this.floor = batch;
    this.window = [];
  }

  /**
   * Close the open window into a batch.
   * @returns {null | {batch:object, status:'accepted'|'rejected', reasons:string[], failures:Array}}
   */
  close() {
    if (this.window.length === 0) return null;
    const accepted = this.window.filter((l) => l.verdict === 'accept');
    const rejected = this.window.filter((l) => l.verdict !== 'accept');
    /* the window spans the time these lines hold; with none, zero length at the floor */
    const held = this.window.filter((l) => this._holdsTime(l)).map((l) => l.interval);
    const floorEnd = this.floor ? this.floor.ts_end : EPOCH;
    const tsStart = held.length ? iso(Math.min(...held.map((r) => Date.parse(r.ts_start)))) : floorEnd;
    const tsEnd = held.length ? iso(Math.max(...held.map((r) => Date.parse(r.ts_end)))) : floorEnd;
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

    const check = V.verifyBatch(batch, { prev: this.prev, floor: this.floor, rejected, profile: this.profile, spec: this.spec });

    /* The chain advances through a batch-level rejection so the defect stays
       visible in sequence; it is published, never anchored, and carries the
       previous total forward unchanged (F6). */
    if (!check.ok) {
      batch.cumulative_mwh = this.cumulative_mwh;
      batch.sha256 = E.batchSha256(batch);
    }
    this.advance(batch, check.ok);

    return {
      batch,
      status: check.ok ? 'accepted' : 'rejected',
      reasons: [...new Set(check.failures.map((f) => f.code))],
      failures: check.failures,
    };
  }
}

module.exports = { BatchAssembler };
