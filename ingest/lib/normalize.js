/**
 * QWATT ingest — normalization
 * ---------------------------------------------------------------------------
 * Turns a stream of timestamped meter samples into interval records that
 * satisfy protocol/interval.schema.json. Every adapter feeds an IntervalBuilder;
 * the builder owns grid alignment, integration, integer units and validation.
 * Adapters never construct records by hand.
 *
 *   const b = new IntervalBuilder({ site_id, node_id, dt_s: 300, adapter: 'modbus-tcp',
 *                                   meters: { a: { id, class, energy: 'integrate' }, b: {...} } });
 *   b.push('a', { ts, power_w, energy_wh }, rawPayload)   // → closed interval records, if any
 *   b.flush()                                             // → every open interval, on shutdown
 *
 * Energy per interval (docs/ARCHITECTURE-FREEZE.md §3):
 *   integrate — trapezoidal integral of power between consecutive samples, split
 *               exactly at grid boundaries so no energy leaks across intervals
 *   counter   — delta of the instrument's own cumulative energy register between
 *               the last reading of the previous interval and the last of this one
 *
 * Closing rule: an interval closes when EVERY meter has a sample at or after its
 * end — or, so a dead meter cannot stall the node forever, when any meter is a
 * full interval past it (the lagging meter then closes with what it had, and the
 * gates judge that). Units in the record are INTEGER milliwatt-hours and
 * milliwatts (freeze §1). No dependencies.
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
    const record = {
      spec_version: this.spec_version,
      schema_version: SCHEMA_VERSION,
      site_id: this.site_id,
      node_id: this.node_id,
      seq: this.seq++,
      ts_start: new Date(tsStart).toISOString(),
      ts_end: new Date(tsStart + this.dtMs).toISOString(),
      dt_s: this.dt_s,
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
