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
