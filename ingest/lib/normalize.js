/**
 * QWATT ingest — normalization
 * ---------------------------------------------------------------------------
 * Turns a stream of timestamped meter samples into interval records that
 * satisfy protocol/interval.schema.json. Every adapter feeds an IntervalBuilder;
 * the builder owns grid alignment, integration, integer units and validation.
 * Adapters never construct records by hand.
 *
 *   const b = new IntervalBuilder({ site_id, node_id, dt_s: 300, adapter: 'modbus-tcp',
 *                                   clock: () => Date.now(),     // or 'replay'
 *                                   sample_s: 5,                 // the meters' sample period, s
 *                                   meters: { a: { id, class, energy: 'integrate' }, b: {...} } });
 *   b.push('a', { ts, power_w, energy_wh }, rawPayload)   // → closed interval records, if any
 *   b.flush()                                             // → every open interval, on shutdown
 *
 * Energy per interval (docs/ARCHITECTURE-FREEZE.md §3):
 *   integrate — trapezoidal integral of power between consecutive samples of one
 *               meter no more than three sample periods (sample_s) apart, split
 *               exactly at grid boundaries so no energy leaks across intervals; a
 *               longer gap contributes nothing (V3-10)
 *   counter   — delta of the instrument's own cumulative energy register between
 *               the last reading of the previous interval and the last of this one
 *
 * Closing rule: an interval closes when EVERY meter has a sample at or after its
 * end — or, so a dead meter cannot stall the node forever, when any meter is a
 * full interval past it (the lagging meter then closes with what it had, and the
 * gates judge that). Units in the record are INTEGER milliwatt-hours and
 * milliwatts (freeze §1).
 *
 * Receive time (V3-6): every record carries clock_skew_s = receive time − ts_end,
 * in whole seconds, stamped when the interval closes. The receive time comes from
 * the builder's clock: a function (a real clock, read once per closed interval:
 * the gateway's clock on a live path) or 'replay' (the latest sample timestamp
 * pushed so far, for a replay faster than real time). An interval flushed before
 * its end (shutdown, end of file) gets a negative value; G0 judges the magnitude.
 * No dependencies.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');
const { validate } = require(path.join(__dirname, '..', '..', 'protocol', 'schema-lite.js'));
const SCHEMA = require(path.join(__dirname, '..', '..', 'protocol', 'interval.schema.json'));
const SPEC = require(path.join(__dirname, '..', '..', 'assets', 'gates.generated.js'));

const SCHEMA_VERSION = SCHEMA['x-schema-version'];

class IntervalBuilder {
  constructor(opts) {
    if (!opts || !opts.site_id || !opts.node_id || !opts.adapter || !opts.meters || !opts.meters.a) {
      throw new Error('IntervalBuilder: site_id, node_id, adapter and meters.a are required');
    }
    this.site_id = opts.site_id;
    this.node_id = opts.node_id;
    this.adapter = opts.adapter;
    this.register_map = opts.register_map || undefined;
    this.dt_s = opts.dt_s || 300;
    this.dtMs = this.dt_s * 1000;
    this.seq = opts.seq0 || 0;
    this.spec_version = opts.spec_version || SPEC.spec_version;
    this.onInterval = opts.onInterval || null;
    /* V3-6: where the receive time for clock_skew_s comes from. 'replay' = the latest sample
       timestamp pushed (a replay faster than real time); a function = a real clock, read when an
       interval closes. */
    if (opts.clock !== 'replay' && typeof opts.clock !== 'function') throw new Error('IntervalBuilder: clock must be "replay" or a function returning ms since the epoch (V3-6)');
    this.clock = opts.clock;
    this.replayMs = -Infinity;
    /* V3-10: the meters' sample period, in seconds (fractions allowed). No energy is interpolated
       across a gap longer than three of them. */
    if (!(typeof opts.sample_s === 'number' && Number.isFinite(opts.sample_s) && opts.sample_s > 0)) {
      throw new Error('IntervalBuilder: sample_s, the sample period in seconds, must be a positive number (V3-10)');
    }
    this.sample_s = opts.sample_s;
    this.maxGapMs = Math.round(3 * opts.sample_s * 1000);
    this.meters = {};
    for (const k of ['a', 'b']) {
      const m = opts.meters[k];
      if (!m) continue;
      if (!['integrate', 'counter'].includes(m.energy)) throw new Error(`meter ${k}: energy must be integrate|counter`);
      this.meters[k] = { id: m.id, class: m.class, energy: m.energy, last: null, lastCounterAtClose: null };
    }
    this.buckets = new Map();     // k → { k, acc: { a: {mwh, wsum, n, counterEnd}, b }, raw: Hash }
    this.lastClosedK = -Infinity;
  }

  gridIndex(tsMs) { return Math.floor(tsMs / this.dtMs); }

  _bucket(k) {
    if (k <= this.lastClosedK) throw new Error(`sample for interval ${k} arrived after that interval was closed (out of order)`);
    let b = this.buckets.get(k);
    if (!b) {
      const acc = {};
      for (const m of Object.keys(this.meters)) acc[m] = { mwh: 0, wsum: 0, n: 0, counterEnd: null };
      b = { k, acc, raw: crypto.createHash('sha256') };
      this.buckets.set(k, b);
    }
    return b;
  }

  _addEnergy(k, meterKey, t0, p0, t1, p1) {
    if (t1 <= t0) return;
    this._bucket(k).acc[meterKey].mwh += ((p0 + p1) / 2) * ((t1 - t0) / 3600000) * 1000;
  }

  /**
   * Push one sample for meter 'a' or 'b'.
   * sample = { ts (ms since epoch), power_w (number), energy_wh (cumulative, optional) }
   * raw = Buffer|string payload the sample came from (hashed into raw_sha256)
   * @returns {Array} interval records closed by this sample, in order
   */
  push(meterKey, sample, raw) {
    const m = this.meters[meterKey];
    if (!m) throw new Error(`unknown meter ${meterKey}`);
    if (!Number.isFinite(sample.ts) || !Number.isFinite(sample.power_w)) throw new Error('sample needs finite ts and power_w');
    if (m.energy === 'counter' && !Number.isFinite(sample.energy_wh)) throw new Error(`meter ${meterKey} is counter-based; sample needs energy_wh`);
    if (m.last && sample.ts < m.last.ts) throw new Error(`meter ${meterKey}: sample ts ${sample.ts} is before the previous ${m.last.ts} (out of order)`);

    const k = this.gridIndex(sample.ts);
    const b = this._bucket(k);
    if (raw != null) b.raw.update(typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw);
    if (sample.ts > this.replayMs) this.replayMs = sample.ts;   // the replay clock: only forward, only accepted samples

    /* A dropout stays a dropout (V3-10). After a gap longer than three sample periods between two
       samples of this meter, wherever it starts (on or off the grid, inside or across a boundary),
       or one that outlived intervals already closed without this meter (B-1: integrating back into
       them would throw), integration restarts at this sample: nothing is booked for the gap, in any
       interval. The intervals the gap spans still get a bucket, so they close as records (0 samples,
       0 mWh for this meter) instead of being skipped. */
    if (m.energy === 'integrate' && m.last &&
        (sample.ts - m.last.ts > this.maxGapMs || this.gridIndex(m.last.ts) <= this.lastClosedK)) {
      for (let kk = Math.max(this.gridIndex(m.last.ts), this.lastClosedK + 1); kk < k; kk++) this._bucket(kk);
      m.last = null;
    }

    if (m.energy === 'integrate' && m.last) {
      let t0 = m.last.ts, p0 = m.last.power_w;
      const t1 = sample.ts, p1 = sample.power_w;
      let kk = this.gridIndex(t0);
      while (kk < k) {
        const tb = (kk + 1) * this.dtMs;
        const pb = p0 + (p1 - p0) * ((tb - t0) / (t1 - t0));
        this._addEnergy(kk, meterKey, t0, p0, tb, pb);
        t0 = tb; p0 = pb; kk++;
      }
      this._addEnergy(k, meterKey, t0, p0, t1, p1);
    }
    const acc = b.acc[meterKey];
    acc.wsum += sample.power_w;
    acc.n += 1;
    if (m.energy === 'counter') acc.counterEnd = sample.energy_wh;
    m.last = { ts: sample.ts, power_w: sample.power_w, energy_wh: sample.energy_wh };

    return this._closeReady();
  }

  /** Close every bucket whose end all meters have passed (or that any meter is a full interval past). */
  _closeReady() {
    const ms = Object.values(this.meters);
    const lasts = ms.map((m) => (m.last ? m.last.ts : -Infinity));
    const allAtLeast = Math.min(...lasts), anyAtLeast = Math.max(...lasts);
    const closed = [];
    for (const k of [...this.buckets.keys()].sort((x, y) => x - y)) {
      const end = (k + 1) * this.dtMs;
      if (allAtLeast >= end || anyAtLeast >= end + this.dtMs) closed.push(this._close(k));
      else break;   // buckets close strictly in order
    }
    return closed;
  }

  _close(k) {
    const c = this.buckets.get(k);
    this.buckets.delete(k);
    this.lastClosedK = k;
    const meters = {};
    for (const [key, m] of Object.entries(this.meters)) {
      const a = c.acc[key];
      let mwh;
      if (m.energy === 'integrate') {
        mwh = Math.max(0, Math.round(a.mwh));
      } else {
        const start = m.lastCounterAtClose;
        mwh = (a.counterEnd == null || start == null) ? 0 : Math.max(0, Math.round((a.counterEnd - start) * 1000));
        if (a.counterEnd != null) m.lastCounterAtClose = a.counterEnd;
      }
      const rec = { id: m.id, class: m.class, mwh, samples: a.n };
      if (a.n > 0) rec.mw_mean = Math.max(0, Math.round((a.wsum / a.n) * 1000));
      meters[key] = rec;
    }
    const tsStart = k * this.dtMs;
    const receivedMs = this.clock === 'replay' ? this.replayMs : this.clock();
    if (!Number.isFinite(receivedMs)) throw new Error('IntervalBuilder: the clock gave no finite receive time');
    const record = {
      spec_version: this.spec_version,
      schema_version: SCHEMA_VERSION,
      site_id: this.site_id,
      node_id: this.node_id,
      seq: this.seq++,
      ts_start: new Date(tsStart).toISOString(),
      ts_end: new Date(tsStart + this.dtMs).toISOString(),
      dt_s: this.dt_s,
      clock_skew_s: Math.round((receivedMs - (tsStart + this.dtMs)) / 1000) || 0,   // V3-6; || 0 folds -0 into 0
      meters,
      source: { adapter: this.adapter, raw_sha256: c.raw.digest('hex') },
    };
    if (this.register_map) record.source.register_map = this.register_map;
    const errs = validate(record, SCHEMA);
    if (errs.length) throw new Error('normalization produced an invalid record: ' + errs.join('; '));
    if (this.onInterval) this.onInterval(record);
    return record;
  }

  /** Close every open interval (partial — samples so far), in order. Use on shutdown or end of file. */
  flush() {
    const out = [];
    for (const k of [...this.buckets.keys()].sort((x, y) => x - y)) out.push(this._close(k));
    return out.length ? out : null;
  }
}

/** Canonical JSON — identical to validators.js / gen.js. Kept here so adapters have no cross-dependency. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

module.exports = { IntervalBuilder, canonical, sha256, SCHEMA_VERSION };
