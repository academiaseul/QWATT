/**
 * QWATT — evidence primitives (Deliverable 2)
 * ---------------------------------------------------------------------------
 * The one place batch hashing is defined: canonical JSON, SHA-256, the Merkle
 * root over intervals, and the batch hash. The batch assembler (proposer side),
 * the verifier and the reconciliation page all derive the same bytes from this.
 *
 * Unlike the permissive copies in ingest/lib/normalize.js and
 * mining-rig/validators.js, `canonical` here REFUSES any number that is not a
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
  if (items.length === 0) return EMPTY_ROOT;
  let level = items.map((it) => sha256(canonical(it)));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256(level[i] + (level[i + 1] ?? level[i])));
    level = next;
  }
  return level[0];
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
 * two meters, or the single meter when the profile allows one (spec issuance.basis).
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
  batchSha256,
  batchId,
  basisMwh,
};
