/**
 * QWATT — batch verification (Deliverable 2, reused by the Deliverable 3 verifier)
 * ---------------------------------------------------------------------------
 * `verifyBatch` re-derives everything a batch claims from the batch itself, the
 * previous published batch, the last accepted batch (the floor), and the
 * rejected-ledger lines that name it:
 *
 *   schema · versions · batch_id · sha256 · intervals_root · chain (prev_hash,
 *   seq, genesis; the previous batch and the floor rehashed) · energy ·
 *   cumulative · counts · same site and node as the floor · time (canonical
 *   timestamps, every interval on its dt_s grid, no interval repeated or
 *   overlapping, within the batch or with the floor) · every contained
 *   interval re-judged by the gates (must accept) · every gate-based rejection
 *   re-judged (must reject) · every reason code registered · when the raw
 *   lines are given (raw/<batch_id>.jsonl): samples_root recomputed from them,
 *   one line per judged interval in time order, each accepted and gate-refused
 *   interval's payloads hashing to its source.raw_sha256 (V3-5)
 *
 * The floor is the last batch published as accepted. A batch published as
 * rejected is never anchored, so its window, node and intervals never become
 * the floor, and it carries the previous cumulative forward unchanged: its
 * energy never enters the total (F6).
 *
 * The proposer runs it on its own batch before publishing (a failure publishes
 * the batch as rejected and it is never anchored). The independent verifier
 * runs the same function on what it downloaded from the public feed. One
 * implementation, so the two sides cannot drift.
 *
 * Pure: no I/O. Returns every failure found, not just the first.
 */

'use strict';

const path = require('path');
const E = require('../protocol/evidence');
const { validate } = require('../protocol/schema-lite');

const ROOT = path.join(__dirname, '..');
const GATES = require(path.join(ROOT, 'assets', 'qwatt-gates.js'));
const SPEC = require(path.join(ROOT, 'assets', 'gates.generated.js'));
const INTERVAL_SCHEMA = require(path.join(ROOT, 'protocol', 'interval.schema.json'));
const BATCH_SCHEMA = require(path.join(ROOT, 'protocol', 'batch.schema.json'));
const REASONS = require(path.join(ROOT, 'protocol', 'reasons.json'));

const INTERVAL_SCHEMA_VERSION = INTERVAL_SCHEMA['x-schema-version'];
const BATCH_SCHEMA_VERSION = BATCH_SCHEMA['x-schema-version'];

/* schema-lite resolves local $ref only; the batch schema points at the interval
   schema by file, so the two are validated separately. */
const BATCH_SCHEMA_LOCAL = JSON.parse(JSON.stringify(BATCH_SCHEMA));
BATCH_SCHEMA_LOCAL.properties.intervals.items = {};

function isRegistered(code, spec = SPEC) {
  return Object.prototype.hasOwnProperty.call(REASONS.codes, code) ||
    Object.prototype.hasOwnProperty.call(spec.messages.en, code);
}

const isGateCode = (code) => /^(plausibility|nameplate|elevation|agreement)\./.test(code);

/** One spelling per instant: exactly what Date#toISOString writes (UTC, milliseconds, `Z`). */
const isCanonicalTs = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s)) && new Date(Date.parse(s)).toISOString() === s;

/**
 * Why an interval is off its time grid, or null. On the grid: both timestamps
 * canonical, ts_start a multiple of dt_s from the epoch, ts_end exactly dt_s
 * later. Each window then has one start and one spelling, so the same energy
 * cannot pass as two different intervals. The assembler refuses these at the
 * door (ingest.off_grid); the verifier refuses a batch carrying one.
 */
function offGrid(rec) {
  if (!isCanonicalTs(rec.ts_start) || !isCanonicalTs(rec.ts_end)) return 'timestamps are not canonical';
  const s = Date.parse(rec.ts_start), dtMs = rec.dt_s * 1000;
  if (s % dtMs !== 0) return `ts_start is not a multiple of ${rec.dt_s} s`;
  if (Date.parse(rec.ts_end) - s !== dtMs) return `ts_end is not ts_start + ${rec.dt_s} s`;
  return null;
}

/** Does a published batch hash to its own sha256 field? */
function rehashes(b) {
  try { return E.batchSha256(b) === b.sha256; } catch (e) { return false; }
}

const RAW_HASH = /^[0-9a-f]{64}$/;

/**
 * Do these raw payloads account for this interval (batch.schema.json R2)? True when the interval
 * names no source.raw_sha256, or when the payload stream (each payload's bytes n times) hashes to
 * it. One exemption: a record posted whole to POST /intervals (source.adapter 'http-json') that
 * kept the node's own raw_sha256, whose frames the gateway never saw. Its one payload (n 1, utf8)
 * must then be that record as posted: the same canonical JSON apart from the clock_skew_s the
 * gateway stamps. Any other interval cannot pass off its own JSON as its raw payload.
 */
function rawBound(payloads, rec) {
  const want = rec && rec.source && rec.source.raw_sha256;
  if (!RAW_HASH.test(want || '')) return true;
  if (E.rawStreamSha256(payloads) === want) return true;
  if (rec.source.adapter === 'http-json' && payloads.length === 1 && payloads[0].n === 1 && typeof payloads[0].utf8 === 'string') {
    try {
      const b = JSON.parse(payloads[0].utf8);
      if (b == null || typeof b !== 'object' || Array.isArray(b)) return false;
      return E.canonical(Object.assign({}, b, { clock_skew_s: rec.clock_skew_s })) === E.canonical(rec);
    } catch (e) { return false; }
  }
  return false;
}

/** Why an interval's raw payloads cannot be counted, or null. The door and verifyBatch apply the same rule. */
function rawProblem(payloads, rec) {
  if (!Array.isArray(payloads) || payloads.length === 0) return { missing: true, why: 'no raw payload' };
  try { if (!rawBound(payloads, rec)) return { missing: false, why: 'the raw payloads do not hash to source.raw_sha256' }; }
  catch (e) { return { missing: false, why: e.message }; }
  return null;
}

/** The raw line a judged ledger line publishes in raw/<batch_id>.jsonl. */
function rawLine(l) {
  const r = l.interval != null && typeof l.interval === 'object' ? l.interval : {};
  return {
    payloads: Array.isArray(l.raw) ? l.raw : [],
    seq: Number.isSafeInteger(r.seq) ? r.seq : null,
    ts_start: typeof r.ts_start === 'string' ? r.ts_start : null,
    verdict: l.verdict === 'accept' ? 'accept' : 'reject',
  };
}
const rawKey = (seq, ts) => `${Number.isSafeInteger(seq) ? seq : null}|${typeof ts === 'string' ? ts : null}`;

/**
 * The order of raw lines in raw/<batch_id>.jsonl (R3), on their published fields only: by
 * Date.parse(ts_start), an unreadable or missing one last, then an accepted line before a refused
 * one at the same start. Ties keep judgment order (the sort is stable), which a verifier cannot
 * see, so it checks only that consecutive lines never go backwards under this comparator.
 */
function rawOrder(x, y) {
  const t = (l) => { const v = typeof l.ts_start === 'string' ? Date.parse(l.ts_start) : NaN; return Number.isFinite(v) ? v : Infinity; };
  const tx = t(x), ty = t(y);
  if (tx !== ty) return tx < ty ? -1 : 1;
  return (x.verdict === 'accept' ? 0 : 1) - (y.verdict === 'accept' ? 0 : 1);
}

/** Schema + integer-only check of one interval. @returns {string[]} errors */
function intervalErrors(rec) {
  const errs = validate(rec, INTERVAL_SCHEMA);
  try { E.canonical(rec); } catch (e) { errs.push(e.message); }
  return errs;
}

/**
 * @param {object} batch           the batch as published
 * @param {object} ctx
 * @param {object|null} ctx.prev   previous published batch (null for the genesis batch); it must rehash
 * @param {object|null} [ctx.floor] last batch published as accepted before this one (null: none yet);
 *                                 it must rehash. Defaults to prev, which is right only when prev was accepted.
 * @param {string} [ctx.status]    'accepted' (default) or 'rejected': how the batch is published. A
 *                                 rejected batch carries the previous cumulative forward unchanged (F6).
 * @param {object[]} [ctx.rejected] rejected-ledger lines; only those naming this batch are used
 * @param {object[]|null} [ctx.raw] the batch's raw lines (raw/<batch_id>.jsonl, parsed); null: the file is
 *                                 not published (batch.raw_missing); undefined: not checked
 * @param {object} [ctx.profile]   gate profile (default: spec profile `bench`)
 * @param {object} [ctx.spec]      generated spec binding
 * @returns {{ok:boolean, failures:Array<{code:string, detail:object}>}}
 */
function verifyBatch(batch, ctx = {}) {
  const spec = ctx.spec || SPEC;
  const profile = ctx.profile || spec.profiles.bench;
  const prev = ctx.prev || null;
  const floor = ctx.floor === undefined ? prev : ctx.floor;
  const failures = [];
  const fail = (code, detail = {}) => failures.push({ code, detail });

  /* schema and integers first: nothing below is meaningful on a malformed batch */
  const schemaErrs = validate(batch, BATCH_SCHEMA_LOCAL);
  if (Array.isArray(batch.intervals)) {
    batch.intervals.forEach((rec, i) => intervalErrors(rec).forEach((e) => schemaErrs.push(`intervals[${i}]: ${e}`)));
  }
  try { E.canonical(batch); } catch (e) { schemaErrs.push(e.message); }
  if (schemaErrs.length) {
    fail('batch.schema_invalid', { errors: schemaErrs.slice(0, 10) });
    return { ok: false, failures };
  }

  if (batch.batch_id !== E.batchId(batch.site_id, batch.seq)) {
    fail('batch.id_mismatch', { batch_id: batch.batch_id, expected: E.batchId(batch.site_id, batch.seq) });
  }

  if (batch.spec_version !== spec.spec_version || batch.schema_version !== INTERVAL_SCHEMA_VERSION ||
      batch.intervals.some((r) => r.spec_version !== batch.spec_version || r.schema_version !== batch.schema_version)) {
    fail('batch.spec_mismatch', { spec_version: batch.spec_version, schema_version: batch.schema_version, engine_spec: spec.spec_version });
  }

  const recomputed = E.batchSha256(batch);
  if (recomputed !== batch.sha256) fail('batch.hash_mismatch', { claimed: batch.sha256, recomputed });

  const root = E.merkleRoot(batch.intervals);
  if (root !== batch.intervals_root) fail('batch.root_mismatch', { claimed: batch.intervals_root, recomputed: root });

  /* chain: nothing is read from the previous batch or the floor before it rehashes */
  if (prev == null) {
    if (batch.seq !== 0 || batch.prev_hash !== E.ZERO_HASH) fail('batch.genesis_invalid', { seq: batch.seq, prev_hash: batch.prev_hash });
  } else if (!rehashes(prev)) {
    fail('batch.chain_break', { prev_seq: prev.seq, why: 'the previous batch does not rehash to its sha256' });
  } else if (batch.seq !== prev.seq + 1 || batch.prev_hash !== prev.sha256 || batch.site_id !== prev.site_id) {
    fail('batch.chain_break', { seq: batch.seq, prev_seq: prev.seq, prev_hash: batch.prev_hash, expected: prev.sha256 });
  }
  if (floor != null && floor !== prev && !rehashes(floor)) {
    fail('batch.chain_break', { floor_seq: floor.seq, why: 'the last accepted batch does not rehash to its sha256' });
  }

  /* arithmetic: an accepted batch adds its energy; a refused one carries the total forward (F6) */
  const energy = batch.intervals.reduce((s, r) => s + E.basisMwh(r), 0);
  if (energy !== batch.energy_mwh) fail('batch.energy_mismatch', { claimed: batch.energy_mwh, recomputed: energy });
  const cumulative = (prev ? prev.cumulative_mwh : 0) + (ctx.status === 'rejected' ? 0 : batch.energy_mwh);
  if (cumulative !== batch.cumulative_mwh) fail('batch.cumulative_mismatch', { claimed: batch.cumulative_mwh, recomputed: cumulative });

  /* counts, including the rejected ledger when supplied */
  const mine = (ctx.rejected || []).filter((l) => l.batch_id === batch.batch_id);
  const countsOk = batch.accepted_count === batch.intervals.length &&
    batch.interval_count === batch.accepted_count + batch.rejected_count &&
    (ctx.rejected == null || mine.length === batch.rejected_count);
  if (!countsOk) {
    fail('batch.count_mismatch', {
      interval_count: batch.interval_count, accepted_count: batch.accepted_count, rejected_count: batch.rejected_count,
      intervals: batch.intervals.length, rejected_lines: ctx.rejected == null ? null : mine.length,
    });
  }

  /* raw payloads: samples_root recomputed from the published lines, one line per judged interval,
     accepted lines in the order of the batch's intervals, each accounting for its interval */
  if (ctx.raw === null) fail('batch.raw_missing', { batch_id: batch.batch_id });
  else if (ctx.raw !== undefined) checkRaw(batch, ctx.raw, ctx.rejected == null ? null : mine, fail);

  /* installation: every interval from the batch's site and node, the batch from the floor's */
  const foreign = batch.intervals.find((r) => r.site_id !== batch.site_id || r.node_id !== batch.node_id);
  if (foreign) fail('batch.site_mismatch', { interval_seq: foreign.seq, site_id: foreign.site_id, node_id: foreign.node_id });
  if (floor != null && (batch.site_id !== floor.site_id || batch.node_id !== floor.node_id)) {
    fail('batch.site_mismatch', { site_id: batch.site_id, node_id: batch.node_id, chain_site_id: floor.site_id, chain_node_id: floor.node_id });
  }

  /* time: canonical window, every interval on its grid and inside [ts_start, ts_end],
     each starting at or after the previous one's end, the first at or after the
     floor's end. Gaps are allowed; the same energy twice is not. */
  const w0 = Date.parse(batch.ts_start), w1 = Date.parse(batch.ts_end);
  if (!isCanonicalTs(batch.ts_start) || !isCanonicalTs(batch.ts_end) || !(w1 >= w0)) {
    fail('batch.window_mismatch', { ts_start: batch.ts_start, ts_end: batch.ts_end });
  }
  for (const r of batch.intervals) {
    const why = offGrid(r);
    if (why) fail('batch.interval_off_grid', { interval_seq: r.seq, ts_start: r.ts_start, ts_end: r.ts_end, dt_s: r.dt_s, why });
  }
  let lastEnd = floor == null ? -Infinity : Date.parse(floor.ts_end), lastEndTs = floor == null ? null : floor.ts_end;
  if (floor != null && !(w0 >= lastEnd)) fail('batch.interval_overlap', { ts_start: batch.ts_start, floor_ts_end: floor.ts_end });
  const counted = new Set((floor != null && Array.isArray(floor.intervals) ? floor.intervals : []).map((r) => Date.parse(r.ts_start)));
  for (const r of batch.intervals) {
    const s = Date.parse(r.ts_start), e = Date.parse(r.ts_end);
    if (s < w0 || e > w1) { fail('batch.window_mismatch', { interval_seq: r.seq, ts_start: r.ts_start }); break; }
    if (counted.has(s)) { fail('batch.interval_repeated', { interval_seq: r.seq, ts_start: r.ts_start }); break; }
    if (!(s >= lastEnd)) { fail('batch.interval_overlap', { interval_seq: r.seq, ts_start: r.ts_start, after: lastEndTs }); break; }
    counted.add(s);
    lastEnd = e; lastEndTs = r.ts_end;
  }

  /* re-judge every contained interval: each must pass the gates as the spec stands */
  for (const r of batch.intervals) {
    const v = GATES.evaluateInterval(r, profile, spec);
    if (v.verdict !== 'accept') fail('batch.interval_rejected', { interval_seq: r.seq, codes: v.failures.map((f) => f.code) });
  }

  /* re-judge every rejection that names a gate: it must actually fail */
  for (const line of mine) {
    const unregistered = (line.reasons || []).filter((c) => !isRegistered(c, spec));
    if (unregistered.length) fail('batch.unregistered_reason', { interval_seq: line.interval && line.interval.seq, codes: unregistered });
    const reasons = line.reasons || [];
    if (reasons.length > 0 && reasons.every(isGateCode)) {
      const v = GATES.evaluateInterval(line.interval, profile, spec);
      if (v.verdict === 'accept') fail('batch.rejection_unproven', { interval_seq: line.interval.seq, reasons });
    } else if (reasons.length === 0) {
      fail('batch.rejection_unproven', { interval_seq: line.interval && line.interval.seq, reasons });
    }
  }

  return { ok: failures.length === 0, failures };
}

function checkRaw(batch, raw, mine, fail) {
  const bad = (why, detail = {}) => fail('batch.raw_mismatch', Object.assign({ why }, detail));
  if (!Array.isArray(raw) || raw.some((l) => l == null || typeof l !== 'object' || !Array.isArray(l.payloads))) return bad('raw lines are not objects with a payloads array');
  let root;
  try { root = E.samplesRoot(raw); } catch (e) { return bad(e.message); }
  if (root !== batch.samples_root) fail('batch.samples_root_mismatch', { claimed: batch.samples_root, recomputed: root });
  if (raw.length !== batch.interval_count) bad('one raw line per judged interval', { lines: raw.length, interval_count: batch.interval_count });
  for (let i = 1; i < raw.length; i++) {
    if (rawOrder(raw[i - 1], raw[i]) > 0) { bad('raw lines not in time order (R3)', { line: i, ts_start: raw[i].ts_start }); break; }
  }
  const acc = raw.filter((l) => l.verdict === 'accept'), rej = raw.filter((l) => l.verdict !== 'accept');
  if (acc.length !== batch.intervals.length) bad('one accepted raw line per interval in the batch', { lines: acc.length, intervals: batch.intervals.length });
  else {
    for (let j = 0; j < acc.length; j++) {
      const r = batch.intervals[j];
      if (acc[j].seq !== r.seq || acc[j].ts_start !== r.ts_start) { bad('accepted raw lines out of step with the intervals', { interval_seq: r.seq, line_seq: acc[j].seq }); break; }
      const p = rawProblem(acc[j].payloads, r);
      if (p) { bad(p.why, { interval_seq: r.seq }); break; }
    }
  }
  if (rej.length !== batch.rejected_count) bad('one raw line per rejected interval', { lines: rej.length, rejected_count: batch.rejected_count });
  else if (mine) {
    /* each rejected-ledger line has its raw line (same seq and ts_start, taken in turn). A line the
       gates refused passed the door's raw check first, so its payloads must account for it; a line
       refused at the door (ingest.*) publishes whatever came with it, unchecked */
    const left = rej.slice();
    for (const line of mine) {
      const r = line.interval || {};
      const k = left.findIndex((l) => rawKey(l.seq, l.ts_start) === rawKey(r.seq, r.ts_start));
      if (k < 0) { bad('a rejected interval has no raw line', { interval_seq: r.seq }); break; }
      const [l] = left.splice(k, 1);
      const atDoor = (line.reasons || []).some((c) => c.startsWith('ingest.'));
      const p = atDoor ? null : rawProblem(l.payloads, r);
      if (p) { bad(`a gate-refused interval: ${p.why}`, { interval_seq: r.seq }); break; }
    }
  }
}

module.exports = {
  verifyBatch,
  rawBound,
  rawProblem,
  rawLine,
  rawOrder,
  intervalErrors,
  isRegistered,
  isGateCode,
  offGrid,
  INTERVAL_SCHEMA_VERSION,
  BATCH_SCHEMA_VERSION,
  SPEC,
  GATES,
};
