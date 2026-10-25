/* GENERATED FILE — do not edit by hand. Generator: protocol/build-browser.js · shim: protocol/browser-shim.js
 * The repository's own protocol code for the browser (DESIGN D-12): each source below is embedded
 * byte for byte as one module function, so verificacion.html runs exactly what the verifier runs.
 * Sources (SHA-256 of the file bytes, LF line endings as stored in git):
 *   batch/verify.js                2a5afeb5853c54a7ec10d4fb875d7362135e66ff61b8223b4516183c8b9a1229
 *   protocol/batch.schema.json     3d1080f9bb1e07d0dcee63e049a79e9a7210ea4d8b3594cd04e906cd95fb4a35
 *   protocol/evidence.js           aac21d5ed59caa3ec558a2a2e5b4efa281e6be8a877afe250e5218da99e431fc
 *   protocol/interval.schema.json  1386c23d0f75ed09f4aa921913433ef6111bcd661b56af309bb09aa7fed01935
 *   protocol/reasons.json          d619be0adc270a94b5da65b35fcb2384a9991f197442ee1560194ba78bc4a146
 *   protocol/schema-lite.js        9704f6203bc0be350dbca44cb9d01160ae6dad60f9cb4f1a1b215d05f3eb3cd9
 *   protocol/browser-shim.js       0acd8489b626ccee234bdd432b1d101c2e8f6d76e87dc4f361f024d015c7f9ec  (the shim)
 * Loaded before this file, not embedded (the gate engine and the served spec binding):
 *   assets/qwatt-gates.js          7642446a2e733351256136a31790a6886bdfb13f94cad03751260201c677d22b
 *   assets/gates.browser.js        21b50b23f90a71011c2610362cfb5230075b6be6da676c3d76da9ab3a9286994
 * Load assets/gates.browser.js and assets/qwatt-gates.js first: the gate engine is not embedded.
 * CI: node protocol/build-browser.js --check   (fails if this file differs from a fresh build)
 */
(function (root) {
  'use strict';

  /* ──── protocol/browser-shim.js (verbatim) ──── */
  var SHIM = (function () {
    var module = { exports: {} };
/**
 * QWATT — the three Node built-ins the protocol sources use, for the browser build
 * ---------------------------------------------------------------------------
 * protocol/build-browser.js embeds protocol/evidence.js, protocol/schema-lite.js
 * and batch/verify.js byte for byte into assets/qwatt-protocol.js (DESIGN D-12,
 * §9.2). Those sources call require('crypto'), require('path') and, from week 2,
 * Buffer. In the browser they get exactly this, and nothing else:
 *
 *   hash.createHash('sha256') → { update(data, enc), digest('hex') }
 *       data is a string (UTF-8; enc must be 'utf8' or absent) or a Uint8Array.
 *       Incremental, 64-byte blocks, pure JavaScript and synchronous, because
 *       verifyBatch is synchronous and the browser's own SHA-256 is not.
 *       Any other algorithm or encoding throws.
 *   Buffer   a Uint8Array subclass: from(string, 'utf8'|'hex'|'base64'),
 *            from(bytes), alloc(size, fill), isBuffer; instance subarray,
 *            toString('hex'|'utf8'|'base64'), equals.
 *   path     join(...parts) and normalize(p), POSIX only.
 *
 * The build refuses a source that uses a member not listed here, and
 * ops/protocol-browser.test.js holds the hash to Node's on NIST vectors, a
 * million "a" in uneven chunks and thousands of seeded inputs.
 * Loads in Node (module.exports) for those tests. Zero dependencies, ES2017.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QWATT_BROWSER_SHIM = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ───────────────────────────── UTF-8 ───────────────────────────── */

  function utf8Bytes(s) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } else c = 0xfffd;
      } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
  function utf8Text(bytes) {
    if (typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(bytes);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += '%' + (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return decodeURIComponent(s);
  }

  /* ───────────────────────────── SHA-256 ───────────────────────────── */

  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function Sha256() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.block = new Uint8Array(64);
    this.used = 0;          // bytes waiting in this.block
    this.total = 0;         // bytes hashed so far (fits a double far beyond any batch)
    this.w = new Uint32Array(64);
    this.done = false;
  }
  Sha256.prototype._compress = function (b, off) {
    var w = this.w, h = this.h, i;
    for (i = 0; i < 16; i++) w[i] = (b[off + 4 * i] << 24) | (b[off + 4 * i + 1] << 16) | (b[off + 4 * i + 2] << 8) | b[off + 4 * i + 3];
    for (i = 16; i < 64; i++) {
      var x = w[i - 15], y = w[i - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    var a = h[0], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7], bb = h[1];
    for (i = 0; i < 64; i++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & bb) ^ (a & c) ^ (bb & c);
      var t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  };
  Sha256.prototype.update = function (data, enc) {
    if (this.done) throw new Error('hash: update() after digest()');
    var bytes;
    if (typeof data === 'string') {
      if (enc !== undefined && enc !== 'utf8' && enc !== 'utf-8') throw new Error('hash: only utf8 strings are supported, got ' + enc);
      bytes = utf8Bytes(data);
    } else if (data instanceof Uint8Array) {
      if (enc !== undefined) throw new Error('hash: an encoding applies only to strings');
      bytes = data;
    } else throw new Error('hash: update() takes a string or a Uint8Array');
    var i = 0, n = bytes.length;
    this.total += n;
    if (this.used) {
      while (i < n && this.used < 64) this.block[this.used++] = bytes[i++];
      if (this.used === 64) { this._compress(this.block, 0); this.used = 0; }
    }
    while (n - i >= 64) { this._compress(bytes, i); i += 64; }
    while (i < n) this.block[this.used++] = bytes[i++];
    return this;
  };
  Sha256.prototype.digest = function (enc) {
    if (enc !== 'hex') throw new Error('hash: only digest("hex") is supported');
    if (this.done) throw new Error('hash: digest() called twice');
    this.done = true;
    var bits = this.total * 8;
    var pad = new Uint8Array(((this.used + 9 + 63) >> 6 << 6) - this.used);
    pad[0] = 0x80;
    var hi = Math.floor(bits / 4294967296), lo = bits >>> 0;
    var L = pad.length;
    pad[L - 8] = hi >>> 24; pad[L - 7] = (hi >>> 16) & 255; pad[L - 6] = (hi >>> 8) & 255; pad[L - 5] = hi & 255;
    pad[L - 4] = lo >>> 24; pad[L - 3] = (lo >>> 16) & 255; pad[L - 2] = (lo >>> 8) & 255; pad[L - 1] = lo & 255;
    this.done = false; this.total -= pad.length;   // padding is not message
    this.update(pad);
    this.done = true;
    var out = '';
    for (var j = 0; j < 8; j++) out += ('0000000' + (this.h[j] >>> 0).toString(16)).slice(-8);
    return out;
  };

  var hash = {
    createHash: function (alg) {
      if (alg !== 'sha256') throw new Error('hash: only sha256 is bundled, got ' + alg);
      return new Sha256();
    }
  };

  /* ───────────────────────────── Buffer ───────────────────────────── */

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64Encode(bytes) {
    var out = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    var rest = bytes.length - i;
    if (rest === 1) { var a = bytes[i] << 16; out += B64[a >> 18] + B64[(a >> 12) & 63] + '=='; }
    else if (rest === 2) { var b = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64[b >> 18] + B64[(b >> 12) & 63] + B64[(b >> 6) & 63] + '='; }
    return out;
  }
  function b64Decode(s) {
    s = String(s).replace(/[\s=]+$/g, '').replace(/\s+/g, '');
    if (/[^A-Za-z0-9+/]/.test(s) || s.length % 4 === 1) throw new Error('Buffer: invalid base64');
    var out = new Uint8Array(Math.floor(s.length * 3 / 4)), bits = 0, val = 0, j = 0;
    for (var i = 0; i < s.length; i++) {
      val = (val << 6) | B64.indexOf(s[i]); bits += 6;
      if (bits >= 8) { bits -= 8; out[j++] = (val >> bits) & 255; }
    }
    return out;
  }

  class Buffer extends Uint8Array {
    static from(value, enc) {
      if (typeof value === 'string') {
        if (enc === undefined || enc === 'utf8' || enc === 'utf-8') return Buffer._of(utf8Bytes(value));
        if (enc === 'hex') {
          if (value.length % 2 || /[^0-9a-fA-F]/.test(value)) throw new Error('Buffer: invalid hex string');
          var h = new Buffer(value.length / 2);
          for (var i = 0; i < h.length; i++) h[i] = parseInt(value.substr(2 * i, 2), 16);
          return h;
        }
        if (enc === 'base64') return Buffer._of(b64Decode(value));
        throw new Error('Buffer: encoding ' + enc + ' is not bundled');
      }
      if (value instanceof Uint8Array || Array.isArray(value)) return Buffer._of(value);
      throw new Error('Buffer: from() takes a string, a Uint8Array or an array of bytes');
    }
    static _of(bytes) { var b = new Buffer(bytes.length); b.set(bytes); return b; }
    static alloc(size, fill) {
      var b = new Buffer(size);
      if (typeof fill === 'number') b.fill(fill & 255);
      else if (fill != null) {
        var f = typeof fill === 'string' ? utf8Bytes(fill) : fill;
        if (!f.length) throw new Error('Buffer: empty fill');
        for (var i = 0; i < size; i++) b[i] = f[i % f.length];
      }
      return b;
    }
    static isBuffer(x) { return x instanceof Buffer; }
    toString(enc) {
      if (enc === undefined || enc === 'utf8' || enc === 'utf-8') return utf8Text(this);
      if (enc === 'hex') { var s = ''; for (var i = 0; i < this.length; i++) s += (this[i] < 16 ? '0' : '') + this[i].toString(16); return s; }
      if (enc === 'base64') return b64Encode(this);
      throw new Error('Buffer: encoding ' + enc + ' is not bundled');
    }
    equals(other) {
      if (!(other instanceof Uint8Array) || other.length !== this.length) return false;
      for (var i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
      return true;
    }
  }

  /* ───────────────────────────── path ───────────────────────────── */

  function normalize(p) {
    var abs = p.charAt(0) === '/', out = [];
    p.split('/').forEach(function (seg) {
      if (!seg || seg === '.') return;
      if (seg === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..'); return; }
      out.push(seg);
    });
    var s = (abs ? '/' : '') + out.join('/');
    return s || (abs ? '/' : '.');
  }
  var path = {
    sep: '/',
    join: function () { return normalize(Array.prototype.slice.call(arguments).filter(function (x) { return x !== ''; }).join('/')); },
    normalize: normalize
  };

  /* What the build checks a source against: anything else is refused. */
  var PROVIDES = {
    hash: ['createHash'],
    Buffer: ['from', 'alloc', 'isBuffer'],
    path: ['join', 'normalize'],
    digest: ['hex'],
    updateEncodings: ['utf8']
  };

  return { hash: hash, Buffer: Buffer, path: path, PROVIDES: PROVIDES };
}));
    return module.exports;
  })();

  var MODULES = {
  "protocol/evidence.js": function (module, exports, require, __filename, __dirname, Buffer) {
/* ──── protocol/evidence.js (verbatim) ──── */
/**
 * QWATT — evidence primitives (Deliverable 2)
 * ---------------------------------------------------------------------------
 * The one place batch hashing is defined: canonical JSON, SHA-256, the Merkle
 * root over intervals, and the batch hash. The batch assembler (proposer side),
 * the verifier and the reconciliation page all derive the same bytes from this.
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
  batchSha256,
  batchId,
  basisMwh,
};
  },
  "protocol/schema-lite.js": function (module, exports, require, __filename, __dirname, Buffer) {
/* ──── protocol/schema-lite.js (verbatim) ──── */
/**
 * QWATT — minimal JSON Schema checker
 * ---------------------------------------------------------------------------
 * Enough of draft 2020-12 to validate protocol/interval.schema.json without a
 * dependency: type, required, properties, additionalProperties, enum, minimum,
 * minLength, pattern, format:date-time, oneOf, $ref into $defs.
 * Zero dependencies so it runs on a bare Pi and in CI without an install step.
 */

'use strict';

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(want, v) {
  const t = typeOf(v);
  if (want === 'number') return t === 'number' || t === 'integer';
  if (want === 'integer') return t === 'integer';
  return t === want;
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error('only local $ref supported: ' + ref);
  return ref.slice(2).split('/').reduce((o, k) => o[k], root);
}

/** @returns {string[]} list of errors, empty when valid */
function validate(value, schema, root = schema, path = '$') {
  const errs = [];
  if (schema.$ref) return validate(value, resolveRef(schema.$ref, root), root, path);

  if (schema.oneOf) {
    const hits = schema.oneOf.filter((s) => validate(value, s, root, path).length === 0).length;
    if (hits !== 1) errs.push(`${path}: matches ${hits} of oneOf, expected exactly 1`);
    return errs;
  }

  if (schema.type && !typeMatches(schema.type, value)) {
    errs.push(`${path}: expected ${schema.type}, got ${typeOf(value)}`);
    return errs;
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errs.push(`${path}: not finite`);
    if (schema.minimum != null && value < schema.minimum) errs.push(`${path}: ${value} < minimum ${schema.minimum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errs.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: does not match /${schema.pattern}/`);
    if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) errs.push(`${path}: not a date-time`);
  }
  if (typeOf(value) === 'object') {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${path}: missing required "${k}"`);
    const props = schema.properties || {};
    for (const k of Object.keys(value)) {
      if (props[k]) errs.push(...validate(value[k], props[k], root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unexpected property "${k}"`);
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => errs.push(...validate(v, schema.items, root, `${path}[${i}]`)));
  }
  return errs;
}

module.exports = { validate };
  },
  "batch/verify.js": function (module, exports, require, __filename, __dirname, Buffer) {
/* ──── batch/verify.js (verbatim) ──── */
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
 *   re-judged (must reject) · every reason code registered
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

module.exports = {
  verifyBatch,
  intervalErrors,
  isRegistered,
  isGateCode,
  offGrid,
  INTERVAL_SCHEMA_VERSION,
  BATCH_SCHEMA_VERSION,
  SPEC,
  GATES,
};
  },
  "protocol/interval.schema.json": function (module, exports, require, __filename, __dirname, Buffer) {
/* ──── protocol/interval.schema.json (verbatim) ──── */
module.exports = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://qwatt.org/protocol/interval.schema.json",
  "x-schema-version": "1.1.0",
  "title": "QWATT normalized interval record",
  "description": "What every ingestion adapter (Modbus RTU/TCP, HTTP/JSON push, CSV replay) emits, and the only shape the gate engine accepts. A meter is supported by writing a register map that produces this — never by editing the engine. Every numeric field is an integer (milliwatt-hours, milliwatts, seconds) so the canonical JSON hashes identically in every language; see docs/ARCHITECTURE-FREEZE.md §1. v1.1.0 replaced the floating-point `wh`/`w_mean` of v1.0.0 with integer `mwh`/`mw_mean`.",
  "type": "object",
  "required": ["spec_version", "schema_version", "site_id", "node_id", "seq", "ts_start", "ts_end", "dt_s", "meters", "source"],
  "additionalProperties": false,
  "properties": {
    "spec_version": { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$", "description": "gates.spec.json version the node was configured with." },
    "schema_version": { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$", "description": "This schema's version (x-schema-version)." },
    "site_id": { "type": "string", "minLength": 1, "description": "Registered site identifier (hash or slug)." },
    "node_id": { "type": "string", "minLength": 1, "description": "Node identity — the public key of the node's signing key once nodes sign." },
    "seq": { "type": "integer", "minimum": 0, "description": "Strictly increasing per node. Replay protection." },
    "ts_start": { "type": "string", "format": "date-time", "description": "Interval start in canonical UTC, exactly as Date#toISOString writes it (YYYY-MM-DDTHH:mm:ss.sssZ), a multiple of dt_s from the epoch. One spelling per instant: the assembler refuses any other (ingest.off_grid); the HTTP gateway rewrites any other RFC 3339 spelling of the same instant to this form and keeps the request hash in source.raw_sha256." },
    "ts_end": { "type": "string", "format": "date-time", "description": "Interval end in the same canonical UTC form, exactly ts_start + dt_s." },
    "dt_s": { "type": "integer", "minimum": 1, "description": "Interval length in seconds. Must equal ts_end − ts_start within 1 s." },
    "clock_skew_s": { "type": "integer", "description": "Gateway receive time − ts_end, whole seconds. Filled in by the gateway, absent at the node." },
    "meters": {
      "type": "object",
      "required": ["a"],
      "additionalProperties": false,
      "properties": {
        "a": { "$ref": "#/$defs/meter" },
        "b": { "oneOf": [ { "$ref": "#/$defs/meter" }, { "type": "null" } ] }
      },
      "description": "Two independent instruments. In symmetric profiles both measure the same DC quantity. In ac_dc_ratio profiles `a` is DC before the inverter and `b` is AC after it."
    },
    "source": {
      "type": "object",
      "required": ["adapter"],
      "additionalProperties": false,
      "properties": {
        "adapter": { "type": "string", "enum": ["modbus-rtu", "modbus-tcp", "http-json", "csv", "replay", "simulator", "demo"] },
        "register_map": { "type": "string", "description": "Name of the register-map config that produced this record, e.g. `pzem-017@1`." },
        "raw_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$", "description": "Hash of the raw adapter payload, kept so the normalization itself is auditable." }
      }
    }
  },
  "$defs": {
    "meter": {
      "type": "object",
      "required": ["id", "class", "mwh"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "minLength": 1, "description": "Instrument identity, e.g. `pzem-017:0x01`." },
        "class": { "type": "string", "enum": ["dc", "ac"] },
        "mwh": { "type": "integer", "minimum": 0, "description": "Energy over the interval, milliwatt-hours." },
        "mw_mean": { "type": "integer", "minimum": 0, "description": "Mean power over the interval, milliwatts. Optional; enables the energy/power consistency check." },
        "samples": { "type": "integer", "minimum": 0, "description": "Number of raw samples integrated into mwh." }
      }
    }
  }
};
  },
  "protocol/batch.schema.json": function (module, exports, require, __filename, __dirname, Buffer) {
/* ──── protocol/batch.schema.json (verbatim) ──── */
module.exports = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://qwatt.org/protocol/batch.schema.json",
  "x-schema-version": "1.0.0",
  "title": "QWATT evidence batch",
  "description": "The unit of evidence that gets published and, when accepted, anchored on Stellar. Contains the accepted interval records it vouches for. `sha256` is computed over the canonical JSON of the batch with `sha256` removed. All energies are integers in milliwatt-hours so the canonical bytes are identical in every language. Defined in docs/ARCHITECTURE-FREEZE.md §2.",
  "type": "object",
  "required": ["batch_id", "site_id", "node_id", "seq", "ts_start", "ts_end", "spec_version", "schema_version", "interval_count", "accepted_count", "rejected_count", "intervals", "intervals_root", "energy_mwh", "cumulative_mwh", "prev_hash", "sha256"],
  "additionalProperties": false,
  "properties": {
    "batch_id": { "type": "string", "pattern": "^[A-Za-z0-9_.-]+-[0-9]{6}$", "description": "`<site_id>-<seq zero-padded to 6>`." },
    "site_id": { "type": "string", "minLength": 1 },
    "node_id": { "type": "string", "minLength": 1 },
    "seq": { "type": "integer", "minimum": 0, "description": "Batch sequence per site, strictly increasing." },
    "ts_start": { "type": "string", "format": "date-time" },
    "ts_end": { "type": "string", "format": "date-time" },
    "spec_version": { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$", "description": "gates.spec.json version that judged every interval in this batch." },
    "schema_version": { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$", "description": "interval.schema.json version of the contained records." },
    "interval_count": { "type": "integer", "minimum": 0, "description": "Intervals judged in this window, accepted + rejected." },
    "accepted_count": { "type": "integer", "minimum": 0 },
    "rejected_count": { "type": "integer", "minimum": 0 },
    "intervals": { "type": "array", "items": { "$ref": "interval.schema.json" }, "description": "The accepted interval records, in sequence order. Rejected intervals are in the rejected ledger, never here." },
    "intervals_root": { "type": "string", "pattern": "^[0-9a-f]{64}$", "description": "Merkle root (SHA-256, odd node duplicated) over the canonical JSON of each interval." },
    "samples_root": { "type": "string", "pattern": "^[0-9a-f]{64}$", "description": "Optional Merkle root over raw power samples, when the node retains them." },
    "energy_mwh": { "type": "integer", "minimum": 0, "description": "Sum over accepted intervals of the counted energy (min of the two meters, or the single meter), milliwatt-hours." },
    "cumulative_mwh": { "type": "integer", "minimum": 0, "description": "Site total since genesis, after this batch." },
    "prev_hash": { "type": "string", "pattern": "^[0-9a-f]{64}$", "description": "sha256 of the previous batch, or 64 zeros for the first." },
    "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
  }
};
  },
  "protocol/reasons.json": function (module, exports, require, __filename, __dirname, Buffer) {
/* ──── protocol/reasons.json (verbatim) ──── */
module.exports = {
  "registry_version": "1.0.0",
  "description": "Every reason code that can appear in a published ledger, other than the gate codes (plausibility.*, nameplate.*, elevation.*, agreement.*), which are registered with their messages in gates.spec.json. A code that is emitted but not listed here fails the test suite, so the proposer, the verifier and the reconciliation page can never disagree on what a rejection means.",
  "codes": {
    "ingest.duplicate_interval": "An interval for this window was already judged; the repeat is recorded and never counted twice.",
    "ingest.out_of_order": "The interval starts before the last judged interval; late data is recorded, never inserted into a closed window.",
    "ingest.overlap": "The interval starts before the latest interval judged here ends (a change of dt_s, or an interval inside another); it is recorded, never counted, and the batch it falls in is unaffected.",
    "ingest.site_mismatch": "The interval names a site_id or node_id other than the one this gateway assembles; it is recorded, never counted, and the batch it falls in is unaffected.",
    "ingest.off_grid": "The interval's timestamps are not canonical UTC (YYYY-MM-DDTHH:mm:ss.sssZ), its ts_start is not a multiple of dt_s from the epoch, or its ts_end is not ts_start + dt_s; it is recorded, never counted.",
    "ingest.spec_mismatch": "The node judged this interval under a different gate-spec version than the engine running here.",
    "ingest.schema_invalid": "The record does not validate against interval.schema.json.",
    "ingest.not_integer": "A numeric field is not a safe integer; evidence is integers only.",

    "batch.schema_invalid": "The batch does not validate against batch.schema.json.",
    "batch.id_mismatch": "batch_id is not <site_id>-<seq padded to 6>.",
    "batch.hash_mismatch": "sha256 does not equal the hash of the canonical batch.",
    "batch.root_mismatch": "intervals_root does not equal the Merkle root of the contained intervals.",
    "batch.chain_break": "prev_hash or seq does not continue the previous published batch, or the previous batch or the last accepted one does not rehash to its own sha256.",
    "batch.genesis_invalid": "The first batch must have seq 0 and prev_hash of 64 zeros.",
    "batch.energy_mismatch": "energy_mwh is not the sum of the intervals' basis energy.",
    "batch.cumulative_mismatch": "cumulative_mwh is not the previous total plus energy_mwh; for a batch published as rejected, it is not the previous total unchanged (a refused batch carries no energy into the total).",
    "batch.count_mismatch": "accepted_count, rejected_count and interval_count do not agree with the batch and the rejected ledger.",
    "batch.window_mismatch": "ts_start or ts_end is not a canonical UTC timestamp, ts_end is before ts_start, or an interval lies outside [ts_start, ts_end].",
    "batch.interval_repeated": "An interval starts at the same instant as one this batch or the last accepted batch already counted; the same energy is never counted twice.",
    "batch.interval_overlap": "An interval starts before the previous interval ends, or the batch starts before the last accepted batch ends. A batch published as rejected never moves that point. Gaps are allowed; overlaps are not.",
    "batch.interval_off_grid": "A contained interval's timestamps are not canonical UTC (YYYY-MM-DDTHH:mm:ss.sssZ), its ts_start is not a multiple of dt_s from the epoch, or its ts_end is not ts_start + dt_s.",
    "batch.site_mismatch": "The batch, or an interval inside it, names a site_id or node_id other than the chain's (the last accepted batch's).",
    "batch.interval_rejected": "An interval inside the batch fails the gates when re-run.",
    "batch.rejection_unproven": "A rejected-ledger line for this batch passes the gates when re-run and carries no ingest reason.",
    "batch.unregistered_reason": "A ledger line carries a reason code that is not registered.",
    "batch.spec_mismatch": "The batch or a contained interval names a different spec or schema version.",

    "verifier.feed_unavailable": "The verifier could not read the published batch from the public feed.",
    "verifier.not_published": "The pending transaction refers to a batch that is not in the public feed.",
    "verifier.tx_mismatch": "The pending transaction is not byte-identical to the one the verifier rebuilt from the published batch.",
    "verifier.hash_mismatch": "The published batch no longer hashes to the value in the pending transaction.",
    "verifier.head_mismatch": "Walking back from the batch through the published chain, rehashing every batch and re-adding every total (a batch never anchored carries the total forward unchanged), does not end at the on-chain anchor with the on-chain cumulative_mwh.",
    "verifier.walk_too_long": "The walk back to the on-chain head stopped at its bound (168 published batches by default) before reaching the head. The check did not finish; nothing is known to be wrong. The usual cause is a long run of batches published as rejected, such as a node_id changed by mistake. The proposer blocks with the same code; operators raise the bound with --max-walk on both services."
  }
};
  }
  };
  var EXTERNAL = {"assets/qwatt-gates.js":"QWATT_GATES","assets/gates.generated.js":"QWATT_GATES_SPEC"};
  /* Node built-ins, by their node: names. */
  var BUILTIN = { 'node:crypto': SHIM.hash, 'node:path': SHIM.path };
  var cache = {};

  /* require(): built-ins from the shim; './x' and '../x' against the caller's directory (adding .js);
     '/repo/…' paths (from path.join(__dirname, …)) stripped of '/repo/'; the gate engine and the spec
     binding from page globals; anything else throws. Modules are cached. */
  function resolve(fromDir, id) {
    var key = id.indexOf('node:') === 0 ? id : 'node:' + id;
    if (BUILTIN[key]) return { builtin: BUILTIN[key] };
    var p = id;
    if (p.indexOf('/repo/') === 0) p = p.slice(6);
    else if (/^\.\.?\//.test(p)) p = SHIM.path.normalize('/repo/' + fromDir + '/' + p).replace(/^\/repo\//, '');
    else throw new Error('qwatt-protocol: ' + id + ' is not bundled');
    if (MODULES[p]) return { id: p };
    if (MODULES[p + '.js']) return { id: p + '.js' };
    if (EXTERNAL[p]) return { external: p };
    throw new Error('qwatt-protocol: ' + id + ' is not bundled');
  }
  function req(id) {
    if (cache[id]) return cache[id].exports;
    var dir = id.split('/').slice(0, -1).join('/');
    var module = { exports: {} };
    cache[id] = module;
    var local = function (x) {
      var r = resolve(dir, x);
      if (r.builtin) return r.builtin;
      if (r.external) {
        var g = root[EXTERNAL[r.external]];
        if (!g) throw new Error('qwatt-protocol: load ' + r.external + ' before qwatt-protocol.js');
        return g;
      }
      return req(r.id);
    };
    try { MODULES[id].call(module.exports, module, module.exports, local, '/repo/' + id, '/repo/' + dir, SHIM.Buffer); }
    catch (e) { delete cache[id]; throw e; }
    return module.exports;
  }

  if (!root.QWATT_GATES) throw new Error('qwatt-protocol: load assets/qwatt-gates.js before qwatt-protocol.js');
  if (!root.QWATT_GATES_SPEC) throw new Error('qwatt-protocol: load assets/gates.browser.js before qwatt-protocol.js');
  var interval = req('protocol/interval.schema.json'), batch = req('protocol/batch.schema.json'), reasons = req('protocol/reasons.json');
  var api = {
    evidence: req('protocol/evidence.js'),
    verify: req('batch/verify.js'),
    schemaLite: req('protocol/schema-lite.js'),
    schemas: { interval: interval, batch: batch },
    reasons: reasons,
    versions: { spec: root.QWATT_GATES_SPEC.spec_version, interval_schema: interval['x-schema-version'], batch_schema: batch['x-schema-version'], reasons_registry: reasons.registry_version },
    sources: [
    { path: "protocol/evidence.js", sha256: "aac21d5ed59caa3ec558a2a2e5b4efa281e6be8a877afe250e5218da99e431fc", bytes: 3937 },
    { path: "protocol/schema-lite.js", sha256: "9704f6203bc0be350dbca44cb9d01160ae6dad60f9cb4f1a1b215d05f3eb3cd9", bytes: 3019 },
    { path: "batch/verify.js", sha256: "2a5afeb5853c54a7ec10d4fb875d7362135e66ff61b8223b4516183c8b9a1229", bytes: 12232 },
    { path: "protocol/interval.schema.json", sha256: "1386c23d0f75ed09f4aa921913433ef6111bcd661b56af309bb09aa7fed01935", bytes: 4230 },
    { path: "protocol/batch.schema.json", sha256: "3d1080f9bb1e07d0dcee63e049a79e9a7210ea4d8b3594cd04e906cd95fb4a35", bytes: 3006 },
    { path: "protocol/reasons.json", sha256: "d619be0adc270a94b5da65b35fcb2384a9991f197442ee1560194ba78bc4a146", bytes: 5202 }
    ],
    shim: { path: "protocol/browser-shim.js", sha256: "0acd8489b626ccee234bdd432b1d101c2e8f6d76e87dc4f361f024d015c7f9ec" },
    external: [{"path":"assets/qwatt-gates.js","sha256":"7642446a2e733351256136a31790a6886bdfb13f94cad03751260201c677d22b"},{"path":"assets/gates.browser.js","sha256":"21b50b23f90a71011c2610362cfb5230075b6be6da676c3d76da9ab3a9286994"}],
    sha256Impl: 'protocol/browser-shim.js (pure JavaScript, synchronous)'
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.QWATT_PROTOCOL = api;
}(typeof self !== 'undefined' ? self : this));
