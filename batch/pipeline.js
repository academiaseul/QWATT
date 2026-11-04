/**
 * QWATT — restart-safe batch pipeline (Deliverable 2; recovery for Deliverable 4)
 * ---------------------------------------------------------------------------
 * Wires the assembler to the on-disk feed so that a crash at any instant loses
 * nothing and duplicates nothing:
 *
 *   - every judged interval is appended to its ledger (fsync) BEFORE it counts,
 *     with the raw payloads it came with (V3-5), so a restart can republish them;
 *   - on start, state comes from the feed, never from memory: the head batch in
 *     index.json gives seq / prev_hash / cumulative, and ledger lines that name
 *     the not-yet-published batch are restored as the open window;
 *   - a restored window is closed immediately ("a batch closes … when the node
 *     restarts", docs/ARCHITECTURE-FREEZE.md §2);
 *   - a batch the verifier refused is left out of the chain (V3-11): before each
 *     close, the batch ids the verifier refused (o.refused) are read, and if the
 *     chain being extended contains one, the next batch links to the parent of the
 *     oldest such batch and carries its total, leaving out what was built on it. That
 *     needs no memory: a restart reads the refusals again;
 *   - if the crash fell between writing a batch file and updating the index,
 *     the existing file is adopted rather than a second batch built. A restored
 *     window is sorted in the raw-file order (windowOrder), so a batch closed
 *     after a crash publishes the same raw/<batch_id>.jsonl as one without.
 */

'use strict';

const { BatchAssembler, windowOrder } = require('./assemble');
const { Feed } = require('./feed');
const V = require('./verify');
const E = require('../protocol/evidence');

class Pipeline {
  /**
   * @param {object} o
   * @param {string} o.dir         feed directory
   * @param {string} o.site_id
   * @param {string} o.node_id
   * @param {number} [o.closeEvery=12]
   * @param {object} [o.profile]
   * @param {function} [o.onBatch]  called with each published { batch, status, reasons }
   * @param {function} [o.refused]  () => batch ids the verifier refused (V3-11; on the proposer host, the file the
   *                                proposer writes from the public verifier log)
   */
  constructor(o) {
    this.feed = new Feed(o.dir);
    this.onBatch = o.onBatch || null;
    this.refusedSource = o.refused || null;
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
      this._relink();                                               // V3-11: the batch was built on the same base
      const ctx = { prev: this.asm.prev, floor: this.asm.floor, rejected, raw: this.feed.readRaw(openId), profile: this.asm.profile, refused: this.asm.refused };
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
      open.sort(windowOrder);
      for (const l of open) this.asm.restore(l);
      this.recovered.push(this.close());
    }
  }

  /** Judge and persist one interval; closes the window when it is full. @returns the ledger line */
  push(rec, raw) {
    const line = raw === undefined ? this.asm.judge(rec) : this.asm.judge(rec, raw);
    this.feed.appendInterval(line);
    if (this.asm.full) this.close();
    return line;
  }

  /**
   * V3-11: if the chain the next batch would extend contains a batch the verifier refused, link the next
   * batch to the parent of the oldest such batch instead, with its total. The link skips every batch after
   * that parent: each refused or built on a refused one.
   */
  _relink() {
    if (!this.refusedSource || !this.asm.prev) return;
    const R = new Set(this.refusedSource() || []);
    this.asm.refused = R;
    if (!R.size) return;
    const seqs = [...R].map((id) => Number(/-(\d{6})$/.exec(id) ? /-(\d{6})$/.exec(id)[1] : NaN)).filter(Number.isSafeInteger);
    if (!seqs.length) return;
    const low = Math.min(...seqs);
    /* the batch a link names: at seq − 1, or earlier past a gap left by an earlier relink */
    const parentOf = (b) => {
      if (b.prev_hash === E.ZERO_HASH) return null;
      for (let s = b.seq - 1; s >= 0; s--) {
        const id = E.batchId(b.site_id, s);
        if (!this.feed.hasBatch(id)) return null;
        const c = this.feed.readBatch(id);
        if (c.sha256 === b.prev_hash) return c;
      }
      return null;
    };
    let oldest = null;
    for (let b = this.asm.prev; b && b.seq >= low; b = parentOf(b)) if (R.has(b.batch_id)) oldest = b;
    if (!oldest) return;
    const base = parentOf(oldest), gap = [];
    for (let s = base ? base.seq + 1 : 0; s < this.asm.seq; s++) gap.push(this.feed.readBatch(E.batchId(this.asm.site_id, s)));
    this.asm.rebase(base, V.leftOut(gap, R));
  }

  /** Close and publish the open window (no-op when empty). */
  close() {
    if (this.asm.window.length) this._relink();
    const closed = this.asm.close();
    if (!closed) return null;
    this.feed.publish(closed, { last_ts_start: this.asm.last_ts_start });
    if (this.onBatch) this.onBatch(closed);
    return closed;
  }

  head() { return this.feed.readIndex(); }
}

module.exports = { Pipeline };
