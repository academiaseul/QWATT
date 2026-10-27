/**
 * QWATT — evidence primitives (Deliverable 2)
 * ---------------------------------------------------------------------------
 * The one place batch hashing is defined: canonical JSON, SHA-256, the Merkle
 * root over intervals, samples_root over the raw payloads (batch schema 1.1.0,
 * rules R1–R4 in protocol/batch.schema.json), and the batch hash. The batch
 * assembler (proposer side), the verifier and the reconciliation page all derive
 * the same bytes from this.
 *
 * Unlike the permissive copies in ingest/lib/normalize.js and the rig's
 * validators.js, `canonical` here REFUSES any number that is not a
 * safe integer. JSON.stringify(Infinity) is "null" and JSON.parse('1e999') is
 * Infinity, so a permissive serializer lets an overflow reach a hash silently.
 * Evidence is integers only (docs/ARCHITECTURE-FREEZE.md §1); anything else is
 * a bug upstream and must stop the batch, not be hashed.
 *
 * Zero dependencies (node:crypto only).
 */

'use strict';

const crypto = require('crypto');

const ZERO_HASH = '0'.repeat(64);
/** Root of an empty interval list: SHA-256 of the empty string. */
const EMPTY_ROOT = crypto.createHash('sha256').update('', 'utf8').digest('hex');

class EvidenceError extends Error {}

/** Canonical JSON: sorted keys, no whitespace, undefined object members dropped, integers only. */
function canonical(value, path = '$') {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new EvidenceError(`${path}: ${value} is not a safe integer; evidence is integers only`);
      }
      return JSON.stringify(value);
    case 'object':
      if (Array.isArray(value)) {
        return '[' + value.map((v, i) => {
          if (v === undefined) throw new EvidenceError(`${path}[${i}]: undefined in array`);
          return canonical(v, `${path}[${i}]`);
        }).join(',') + ']';
      }
      return '{' + Object.keys(value).filter((k) => value[k] !== undefined).sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k], `${path}.${k}`)).join(',') + '}';
    default:
      throw new EvidenceError(`${path}: ${typeof value} cannot be serialized into evidence`);
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Merkle root per batch.schema.json: leaves are SHA-256 of each item's canonical
 * JSON; a parent is SHA-256 of the two child hex strings concatenated; an odd
 * node is paired with itself. The duplicated-leaf ambiguity of that rule
 * ([a,b,c] and [a,b,c,c] share a root) is closed at the batch level because
 * `accepted_count` and the full `intervals` array are inside the batch hash.
 */
function merkleRoot(items) {
  if (!Array.isArray(items)) throw new EvidenceError('merkleRoot: expected an array');
  return merkleFromLeaves(items.map((it) => sha256(canonical(it))));
}

/** The same rule over leaf hashes already computed (64-hex strings). No leaves: EMPTY_ROOT. */
function merkleFromLeaves(leaves) {
  if (!Array.isArray(leaves)) throw new EvidenceError('merkleFromLeaves: expected an array');
  if (leaves.length === 0) return EMPTY_ROOT;
  let level = leaves.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256(level[i] + (level[i + 1] ?? level[i])));
    level = next;
  }
  return level[0];
}

/* ── raw payloads and samples_root (batch schema 1.1.0, freeze v3 V3-5) ── */

/** Where an interval record carries its raw payloads: a symbol key, so never serialized, validated or hashed. */
const RAW = Symbol.for('qwatt.raw_payloads');
const rawPayloads = (rec) => (rec != null && typeof rec === 'object' && Array.isArray(rec[RAW]) ? rec[RAW] : null);

const HEX = /^(?:[0-9a-f]{2})*$/;
/** Bytes of one payload entry: { n, utf8 } or { n, hex }, n a whole number >= 1. Throws on anything else. */
function payloadBytes(p) {
  if (p == null || typeof p !== 'object' || Array.isArray(p) || !Number.isSafeInteger(p.n) || p.n < 1) throw new EvidenceError('raw payload entry needs a whole n >= 1');
  const keys = Object.keys(p).filter((k) => k !== 'n');
  if (keys.length === 1 && keys[0] === 'utf8' && typeof p.utf8 === 'string') return Buffer.from(p.utf8, 'utf8');
  if (keys.length === 1 && keys[0] === 'hex' && typeof p.hex === 'string' && HEX.test(p.hex)) return Buffer.from(p.hex, 'hex');
  throw new EvidenceError('raw payload entry needs exactly one of utf8 (a string) or hex (lowercase, whole bytes)');
}
const sha256Bytes = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** samples_root: merkleFromLeaves over SHA-256 of each payload's bytes, raw lines in file order, payloads in order. */
function samplesRoot(rawLines) {
  if (!Array.isArray(rawLines)) throw new EvidenceError('samplesRoot: expected an array of raw lines');
  const leaves = [];
  rawLines.forEach((l, i) => {
    if (l == null || !Array.isArray(l.payloads)) throw new EvidenceError(`raw line ${i}: payloads must be an array`);
    for (const p of l.payloads) leaves.push(sha256Bytes(payloadBytes(p)));
  });
  return merkleFromLeaves(leaves);
}

/** An implementation bound, not a rule: no interval's payload stream (bytes × n) is hashed past 1 GiB,
    so a non-empty payload published with an n near 2^53 is refused instead of hashed. Honest streams are far
    smaller. The work follows the bytes, not n: an empty entry adds nothing to the stream and is skipped
    whatever its n, and a repeated payload is hashed in blocks of about 64 KiB, not once per repeat. */
const MAX_RAW_STREAM_BYTES = 2 ** 30;
const RAW_HASH_BLOCK = 65536;

/** SHA-256 of the payload stream, each payload repeated n times: what source.raw_sha256 commits to. */
function rawStreamSha256(payloads) {
  const bytes = payloads.map(payloadBytes);
  const total = bytes.reduce((s, b, i) => s + b.length * payloads[i].n, 0);
  if (total > MAX_RAW_STREAM_BYTES) throw new EvidenceError(`raw payload stream of ${total} bytes is longer than ${MAX_RAW_STREAM_BYTES}`);
  const h = crypto.createHash('sha256');
  bytes.forEach((b, i) => {
    if (b.length === 0) return;                                        // n repeats of no bytes: nothing to hash
    const n = payloads[i].n;
    const reps = Math.min(n, Math.max(1, Math.floor(RAW_HASH_BLOCK / b.length)));
    const block = reps > 1 ? Buffer.alloc(reps * b.length, b) : b;     // the same bytes, reps times in a row
    let left = n;
    for (; left >= reps; left -= reps) h.update(block);
    if (left > 0) h.update(block.subarray(0, left * b.length));        // the last, shorter run
  });
  return h.digest('hex');
}

/** The batch hash: SHA-256 of the canonical batch with its own `sha256` field removed. */
function batchSha256(batch) {
  const { sha256: _omit, ...rest } = batch;
  return sha256(canonical(rest));
}

/** `<site_id>-<seq zero-padded to 6>` (batch.schema.json). */
function batchId(siteId, seq) {
  return `${siteId}-${String(seq).padStart(6, '0')}`;
}

/**
 * The energy an accepted interval vouches for, in integer mWh: the lower of the
 * two meters, or the single meter when the profile allows one (the counted energy).
 */
function basisMwh(interval) {
  const a = interval.meters.a.mwh;
  const b = interval.meters.b == null ? null : interval.meters.b.mwh;
  return b == null ? a : Math.min(a, b);
}

module.exports = {
  ZERO_HASH,
  EMPTY_ROOT,
  EvidenceError,
  canonical,
  sha256,
  merkleRoot,
  merkleFromLeaves,
  RAW,
  rawPayloads,
  payloadBytes,
  samplesRoot,
  rawStreamSha256,
  MAX_RAW_STREAM_BYTES,
  batchSha256,
  batchId,
  basisMwh,
};
