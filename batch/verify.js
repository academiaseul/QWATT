/**
 * QWATT — batch verification (Deliverable 2, reused by the Deliverable 3 verifier)
 * ---------------------------------------------------------------------------
 * `verifyBatch` re-derives everything a batch claims from the batch itself, the
 * previous published batch, and the rejected-ledger lines that name it:
 *
 *   schema · versions · batch_id · sha256 · intervals_root · chain (prev_hash,
 *   seq, genesis) · energy · cumulative · counts · window order · every
 *   contained interval re-judged by the gates (must accept) · every gate-based
 *   rejection re-judged (must reject) · every reason code registered
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

/** Schema + integer-only check of one interval. @returns {string[]} errors */
function intervalErrors(rec) {
  const errs = validate(rec, INTERVAL_SCHEMA);
  try { E.canonical(rec); } catch (e) { errs.push(e.message); }
  return errs;
}

/**
 * @param {object} batch           the batch as published
 * @param {object} ctx
 * @param {object|null} ctx.prev   previous published batch (null for the genesis batch)
 * @param {object[]} [ctx.rejected] rejected-ledger lines; only those naming this batch are used
 * @param {object} [ctx.profile]   gate profile (default: spec profile `bench`)
 * @param {object} [ctx.spec]      generated spec binding
 * @returns {{ok:boolean, failures:Array<{code:string, detail:object}>}}
 */
function verifyBatch(batch, ctx = {}) {
  const spec = ctx.spec || SPEC;
  const profile = ctx.profile || spec.profiles.bench;
  const prev = ctx.prev || null;
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

  /* chain */
  if (prev == null) {
    if (batch.seq !== 0 || batch.prev_hash !== E.ZERO_HASH) fail('batch.genesis_invalid', { seq: batch.seq, prev_hash: batch.prev_hash });
  } else if (batch.seq !== prev.seq + 1 || batch.prev_hash !== prev.sha256 || batch.site_id !== prev.site_id) {
    fail('batch.chain_break', { seq: batch.seq, prev_seq: prev.seq, prev_hash: batch.prev_hash, expected: prev.sha256 });
  }

  /* arithmetic */
  const energy = batch.intervals.reduce((s, r) => s + E.basisMwh(r), 0);
  if (energy !== batch.energy_mwh) fail('batch.energy_mismatch', { claimed: batch.energy_mwh, recomputed: energy });
  const cumulative = (prev ? prev.cumulative_mwh : 0) + batch.energy_mwh;
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

  /* window: contained intervals strictly ordered and inside [ts_start, ts_end] */
  const w0 = Date.parse(batch.ts_start), w1 = Date.parse(batch.ts_end);
  let last = -Infinity;
  for (const r of batch.intervals) {
    const s = Date.parse(r.ts_start), e = Date.parse(r.ts_end);
    if (!(s > last) || s < w0 || e > w1) { fail('batch.window_mismatch', { interval_seq: r.seq, ts_start: r.ts_start }); break; }
    last = s;
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

module.exports = {
  verifyBatch,
  intervalErrors,
  isRegistered,
  isGateCode,
  INTERVAL_SCHEMA_VERSION,
  BATCH_SCHEMA_VERSION,
  SPEC,
  GATES,
};
