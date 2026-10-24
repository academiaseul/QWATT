/**
 * QWATT — read a Stellar transaction envelope just enough to check it (DESIGN §12.4)
 * ---------------------------------------------------------------------------
 * For a base64 TransactionEnvelope of type ENVELOPE_TYPE_TX (2) the signature list
 * is the tail: uint32 n, then n × (4-byte hint, uint32 length 64, 64 bytes). So the
 * transaction body is bytes[4 : len − 4 − 72n], with n the one value in 0…20 for
 * which every length field fits. From that:
 *
 *   bodyHash(xdr, passphrase) → Promise<hex>   SHA-256( SHA-256(passphrase) ‖ 00000002 ‖ body ),
 *                                              the transaction hash Stellar computes (signatures excluded)
 *   signatures(xdr)           → [{ hint, signature }]   hint hex, signature base64
 *   signedBy(G, sig, txHash)  → Promise<true|false|null>  Ed25519 check of one signature over the
 *                               transaction hash with a public G… key; null when this browser
 *                               cannot verify Ed25519 (the page then shows only the count)
 *
 * It never parses operations, never builds anything and never signs: it reads public
 * envelopes and public keys only. Fee-bump (5) and v0 (0) envelopes come back as
 * { unsupported: true }. SHA-256 and Ed25519 come from the browser's WebCrypto
 * (Node's in tests). UMD: window.QWATT_ENVELOPE. Zero dependencies, ES2017.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.QWATT_ENVELOPE = factory(root);
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  function subtle() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto.subtle;
    if (typeof self !== 'undefined' && self.crypto && self.crypto.subtle) return self.crypto.subtle;
    return null;
  }
  function b64decode(s) {
    s = String(s).replace(/\s+/g, '').replace(/=+$/, '');
    if (/[^A-Za-z0-9+/]/.test(s) || s.length % 4 === 1) throw new Error('envelope: not base64');
    var out = new Uint8Array(Math.floor(s.length * 3 / 4)), bits = 0, val = 0, j = 0;
    for (var i = 0; i < s.length; i++) { val = (val << 6) | B64.indexOf(s[i]); bits += 6; if (bits >= 8) { bits -= 8; out[j++] = (val >> bits) & 255; } }
    return out;
  }
  function b64encode(bytes) {
    var out = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) { var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]; out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]; }
    if (bytes.length - i === 1) { var a = bytes[i] << 16; out += B64[a >> 18] + B64[(a >> 12) & 63] + '=='; }
    else if (bytes.length - i === 2) { var b = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64[b >> 18] + B64[(b >> 12) & 63] + B64[(b >> 6) & 63] + '='; }
    return out;
  }
  function hex(bytes) { return Array.prototype.map.call(bytes, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function fromHex(h) { var o = new Uint8Array(h.length / 2); for (var i = 0; i < o.length; i++) o[i] = parseInt(h.substr(2 * i, 2), 16); return o; }
  function u32(b, i) { return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; }

  /** { type, body, signatures } for a v1 envelope; { unsupported: true, type } for fee-bump or v0. */
  function decode(xdr) {
    var bytes = b64decode(xdr);
    if (bytes.length < 8) throw new Error('envelope: too short');
    var type = u32(bytes, 0);
    if (type !== 2) return { unsupported: true, type: type };
    var found = -1;
    for (var n = 0; n <= 20; n++) {
      var start = bytes.length - 4 - 72 * n;
      if (start < 8) break;
      if (u32(bytes, start) !== n) continue;
      var fits = true;
      for (var k = 0; k < n; k++) if (u32(bytes, start + 4 + 72 * k + 4) !== 64) { fits = false; break; }
      if (fits) { if (found >= 0) throw new Error('envelope: ambiguous signature list'); found = n; }
    }
    if (found < 0) throw new Error('envelope: no signature list found');
    var s0 = bytes.length - 4 - 72 * found;
    var sigs = [];
    for (var j = 0; j < found; j++) {
      var o = s0 + 4 + 72 * j;
      sigs.push({ hint: hex(bytes.subarray(o, o + 4)), signature: b64encode(bytes.subarray(o + 8, o + 72)) });
    }
    return { type: 2, body: bytes.subarray(4, s0), signatures: sigs };
  }
  function signatures(xdr) { var d = decode(xdr); return d.unsupported ? d : d.signatures; }

  function utf8(s) { return typeof TextEncoder === 'function' ? new TextEncoder().encode(s) : new Uint8Array(unescape(encodeURIComponent(s)).split('').map(function (c) { return c.charCodeAt(0); })); }
  function bodyHash(xdr, passphrase) {
    var s = subtle();
    if (!s) return Promise.reject(new Error('envelope: this browser has no WebCrypto SHA-256'));
    var d;
    try { d = decode(xdr); } catch (e) { return Promise.reject(e); }
    if (d.unsupported) return Promise.resolve(null);
    return s.digest('SHA-256', utf8(passphrase)).then(function (netId) {
      var msg = new Uint8Array(32 + 4 + d.body.length);
      msg.set(new Uint8Array(netId), 0);
      msg.set([0, 0, 0, 2], 32);
      msg.set(d.body, 36);
      return s.digest('SHA-256', msg);
    }).then(function (h) { return hex(new Uint8Array(h)); });
  }

  /* ── public keys (StrKey G…, version byte 6 << 3, CRC16-XModem) ── */
  function crc16(bytes) {
    var c = 0;
    for (var i = 0; i < bytes.length; i++) { c ^= bytes[i] << 8; for (var k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
    return c;
  }
  /** The 32 raw bytes of a public G… address, or null when it is not one. */
  function publicKeyBytes(g) {
    if (typeof g !== 'string' || !/^G[A-Z2-7]{55}$/.test(g)) return null;
    var out = [], bits = 0, val = 0;
    for (var i = 0; i < g.length; i++) { val = (val << 5) | B32.indexOf(g[i]); bits += 5; if (bits >= 8) { bits -= 8; out.push((val >> bits) & 255); } }
    if (out.length !== 35 || out[0] !== 6 << 3) return null;
    var body = out.slice(0, 33), c = crc16(body);
    if ((c & 255) !== out[33] || (c >> 8) !== out[34]) return null;
    return new Uint8Array(out.slice(1, 33));
  }

  var edSupport = null;
  /** Does this browser verify Ed25519 through WebCrypto? (cached) */
  function hasEd25519() {
    if (edSupport) return edSupport;
    var s = subtle();
    if (!s) { edSupport = Promise.resolve(false); return edSupport; }
    edSupport = Promise.resolve().then(function () { return s.importKey('raw', new Uint8Array(32).fill(1), { name: 'Ed25519' }, false, ['verify']); })
      .then(function () { return true; }, function () { return false; });
    return edSupport;
  }
  /** Did the holder of public key G produce this signature over the transaction hash? null: cannot tell here. */
  function signedBy(g, signatureB64, txHashHex) {
    var key = publicKeyBytes(g);
    if (!key || !/^[0-9a-f]{64}$/.test(txHashHex || '')) return Promise.resolve(false);
    var sig;
    try { sig = b64decode(signatureB64); } catch (e) { return Promise.resolve(false); }
    if (sig.length !== 64) return Promise.resolve(false);
    return hasEd25519().then(function (ok) {
      if (!ok) return null;
      var s = subtle();
      return s.importKey('raw', key, { name: 'Ed25519' }, false, ['verify'])
        .then(function (k) { return s.verify({ name: 'Ed25519' }, k, sig, fromHex(txHashHex)); })
        .then(function (v) { return !!v; }, function () { return null; });
    });
  }

  return { decode: decode, signatures: signatures, bodyHash: bodyHash, signedBy: signedBy, hasEd25519: hasEd25519, publicKeyBytes: publicKeyBytes };
}));
