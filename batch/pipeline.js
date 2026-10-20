/**
 * QWATT — restart-safe batch pipeline (Deliverable 2; recovery for Deliverable 4)
 * ---------------------------------------------------------------------------
 * Wires the assembler to the on-disk feed so that a crash at any instant loses
 * nothing and duplicates nothing:
 *
 *   - every judged interval is appended to its ledger (fsync) BEFORE it counts;
 *   - on start, state comes from the feed, never from memory: the head batch in
 *     index.json gives seq / prev_hash / cumulative, and ledger lines that name
 *     the not-yet-published batch are restored as the open window;
 *   - a restored window is closed immediately ("a batch closes … when the node
 *     restarts", docs/ARCHITECTURE-FREEZE.md §2);
 *   - if the crash fell between writing a batch file and updating the index,
 *     the existing file is adopted rather than a second batch built.
 */

'use strict';

const { BatchAssembler } = require('./assemble');
const { Feed } = require('./feed');
const V = require('./verify');

class Pipeline {
  /**
   * @param {object} o
   * @param {string} o.dir         feed directory
   * @param {string} o.site_id
   * @param {string} o.node_id
   * @param {number} [o.closeEvery=12]
   * @param {object} [o.profile]
   * @param {function} [o.onBatch]  called with each published { batch, status, reasons }
   */
  constructor(o) {
    this.feed = new Feed(o.dir);
    this.onBatch = o.onBatch || null;
    this.recovered = [];
    const idx = this.feed.readIndex();
    if (idx && idx.site_id !== o.site_id) throw new Error(`feed belongs to site ${idx.site_id}, not ${o.site_id}`);
    /* the previous batch is the head; the floor is the last batch published as accepted up to it */
    const head = idx ? this.feed.readBatch(idx.latest_batch_id) : null;
    const lastAccepted = idx ? this.feed.readLedger('batches').filter((e) => e.seq <= idx.latest_seq && e.status === 'accepted').pop() : null;
    const state = idx
      ? { seq: idx.latest_seq + 1, prev_hash: idx.head_sha256, cumulative_mwh: idx.cumulative_mwh, last_ts_start: idx.last_ts_start,
          prev: head, floor: lastAccepted ? this.feed.readBatch(lastAccepted.batch_id) : null }
      : undefined;
    this.asm = new BatchAssembler({ site_id: o.site_id, node_id: o.node_id, closeEvery: o.closeEvery, profile: o.profile, state });
    this._recover();
  }

  _recover() {
    const openId = this.asm.openBatchId;

    /* crash between batch file and index: adopt the file that is already public */
    if (this.feed.hasBatch(openId)) {
      const batch = this.feed.readBatch(openId);
      const rejected = this.feed.readLedger('rejected');
      const ctx = { prev: this.asm.prev, floor: this.asm.floor, rejected, profile: this.asm.profile };
      const ok = V.verifyBatch(batch, ctx).ok;
      /* a refused batch was written with the total carried forward (F6): its reasons are judged that way */
      const check = ok ? { failures: [] } : V.verifyBatch(batch, { ...ctx, status: 'rejected' });
      for (const l of [...this.feed.readLedger('accepted'), ...rejected]) if (l.batch_id === openId) this.asm.restore(l);
      this.asm.advance(batch, ok);
      const closed = { batch, status: ok ? 'accepted' : 'rejected', reasons: [...new Set(check.failures.map((f) => f.code))] };
      this.feed.publish(closed, { last_ts_start: this.asm.last_ts_start });
      this.recovered.push(closed);
      if (this.onBatch) this.onBatch(closed);
      return this._recover();
    }

    /* lines judged but not yet batched: restore them and close on restart */
    const open = [...this.feed.readLedger('accepted'), ...this.feed.readLedger('rejected')].filter((l) => l.batch_id === openId);
    if (open.length) {
      open.sort((x, y) => Date.parse(x.interval.ts_start) - Date.parse(y.interval.ts_start));
      for (const l of open) this.asm.restore(l);
      this.recovered.push(this.close());
    }
  }

  /** Judge and persist one interval; closes the window when it is full. @returns the ledger line */
  push(rec) {
    const line = this.asm.judge(rec);
    this.feed.appendInterval(line);
    if (this.asm.full) this.close();
    return line;
  }

  /** Close and publish the open window (no-op when empty). */
  close() {
    const closed = this.asm.close();
    if (!closed) return null;
    this.feed.publish(closed, { last_ts_start: this.asm.last_ts_start });
    if (this.onBatch) this.onBatch(closed);
    return closed;
  }

  head() { return this.feed.readIndex(); }
}

module.exports = { Pipeline };
