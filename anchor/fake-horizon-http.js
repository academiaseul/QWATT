/**
 * QWATT — a fake Horizon over HTTP, for the reconciliation tests (no network, no dependencies)
 * ---------------------------------------------------------------------------
 * The reconciliation (assets/qwatt-reconcile.js) reads Horizon's public REST API
 * with fetch, as a reviewer's browser does. This serves the three resources it
 * reads, for one account, on 127.0.0.1, shaped as Horizon shapes them:
 *
 *   GET /accounts/<id>                                     thresholds, signers (master included)
 *   GET /accounts/<id>/operations?order=asc&limit=N[&cursor=C]&join=transactions
 *        two manage_data records per anchor (qwatt.anchor.sha256, qwatt.cumulative_mwh), each with
 *        transaction_hash, transaction_successful, created_at and, with join=transactions, the
 *        embedded transaction resource (hash, ledger, memo_type, memo, successful, signatures)
 *   GET /transactions/<hash>                               the transaction resource
 *
 * Throwaway keys are made with node:crypto (Ed25519), never with real secrets:
 * throwawayKey() returns a G… address and a signer over a transaction hash.
 * anchor/fake-horizon.js stays the model of the network's rules (with the SDK);
 * FakeHorizon.restRecord() / restAnchors() feed this server in the e2e tests.
 */

'use strict';

const http = require('http');
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function crc16xmodem(bytes) {
  let crc = 0;
  for (const b of bytes) { crc ^= b << 8; for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
  return crc;
}
function base32(bytes) {
  let bits = 0, v = 0, out = '';
  for (const b of bytes) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(v << (5 - bits)) & 31];
  return out;
}
/** StrKey: version byte 6 << 3 ('G'), the 32-byte key, CRC16-XModem little-endian, base32. */
function gAddress(raw32) {
  const body = Buffer.concat([Buffer.from([6 << 3]), Buffer.from(raw32)]);
  const c = crc16xmodem(body);
  return base32(Buffer.concat([body, Buffer.from([c & 0xff, c >> 8])]));
}

/** A throwaway Ed25519 key: { G, sign(txHashHex) → base64 signature } (the payload Stellar signs is the tx hash). */
function throwawayKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return { G: gAddress(raw), sign: (hashHex) => crypto.sign(null, Buffer.from(hashHex, 'hex'), privateKey).toString('base64') };
}

/** GET /accounts/<id> as Horizon returns it (only what the reconciliation reads, plus the usual id fields). */
function accountRecord({ account, signers, thresholds = { low: 2, med: 2, high: 3 }, master = 0, weights = {}, types = {} }) {
  return {
    id: account, account_id: account, sequence: '4294967296000',
    thresholds: { low_threshold: thresholds.low, med_threshold: thresholds.med, high_threshold: thresholds.high },
    signers: [
      ...signers.map((key) => ({ weight: weights[key] ?? 1, key, type: types[key] || 'ed25519_public_key' })),
      { weight: master, key: account, type: 'ed25519_public_key' },
    ],
    data: {},
  };
}

/**
 * @param {object} s
 * @param {string} s.account
 * @param {() => object|null} s.record     the account resource, or null for 404
 * @param {() => object[]} s.anchors       oldest first: { tx_hash, ledger, created_at, memo, sha256, cumulative_mwh, signatures, successful? }
 * @param {boolean} [s.embedSignatures=true]  false: the joined transaction carries no signatures (forces GET /transactions/<hash>)
 * @param {(url:string) => void} [s.onRequest] called with every request path as it arrives (to order requests across servers)
 * @returns {Promise<{url:string, requests:string[], close:() => Promise<void>}>}
 */
async function serveHorizon(s) {
  const requests = [];
  const b64 = (str) => Buffer.from(String(str), 'ascii').toString('base64');
  const txResource = (a) => ({
    id: a.tx_hash, hash: a.tx_hash, ledger: a.ledger, created_at: a.created_at, successful: a.successful !== false,
    source_account: s.account, memo_type: a.memo == null ? 'none' : 'text', ...(a.memo == null ? {} : { memo: a.memo }),
    signatures: a.signatures || [],
  });
  const opsOf = () => {
    const out = [];
    s.anchors().forEach((a, i) => {
      for (const [name, value] of [['qwatt.anchor.sha256', a.sha256], ['qwatt.cumulative_mwh', String(a.cumulative_mwh)]]) {
        out.push({ id: String(out.length + 1), paging_token: String(out.length + 1), type: 'manage_data', type_i: 10, name, value: b64(value),
          source_account: s.account, transaction_hash: a.tx_hash, transaction_successful: a.successful !== false, created_at: a.created_at, _i: i });
      }
    });
    return out;
  };
  const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/hal+json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(body)); };
  const srv = http.createServer((req, res) => {
    requests.push(req.url);
    if (s.onRequest) s.onRequest(req.url);
    const u = new URL(req.url, 'http://127.0.0.1');
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'accounts' && parts[1] === s.account && parts.length === 2) {
      const r = s.record();
      return r ? send(res, 200, r) : send(res, 404, { status: 404, title: 'Resource Missing' });
    }
    if (parts[0] === 'accounts' && parts[1] === s.account && parts[2] === 'operations') {
      const limit = Number(u.searchParams.get('limit') || 10), cursor = Number(u.searchParams.get('cursor') || 0);
      const join = u.searchParams.get('join') === 'transactions';
      const anchors = s.anchors();
      const page = opsOf().filter((o) => Number(o.paging_token) > cursor).slice(0, limit).map(({ _i, ...o }) => {
        if (!join) return o;
        const t = txResource(anchors[_i]);
        if (s.embedSignatures === false) delete t.signatures;
        return { ...o, transaction: t };
      });
      const last = page.length ? page[page.length - 1].paging_token : String(cursor);
      const next = new URL(u.href); next.searchParams.set('cursor', last);
      return send(res, 200, { _links: { next: { href: `http://${req.headers.host}${next.pathname}${next.search}` } }, _embedded: { records: page } });
    }
    if (parts[0] === 'transactions' && parts.length === 2) {
      const a = s.anchors().find((x) => x.tx_hash === parts[1]);
      return a ? send(res, 200, txResource(a)) : send(res, 404, { status: 404 });
    }
    return send(res, 404, { status: 404, title: 'Resource Missing' });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${srv.address().port}`,
    requests,
    close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(() => r()); }),
  };
}

module.exports = { serveHorizon, accountRecord, throwawayKey, gAddress };
