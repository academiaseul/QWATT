/**
 * QWATT ingest — HTTP/JSON push adapter
 * ---------------------------------------------------------------------------
 * A node that already has a network connection pushes here instead of being
 * polled. Two doors:
 *
 *   POST /samples    { meter:'a', ts, power_w, energy_wh? }  or an array of them
 *                    → fed to the IntervalBuilder; response { closed: n }
 *   POST /intervals  a complete interval record (normalized at the node)
 *                    → validated against interval.schema.json; ts_start / ts_end
 *                      rewritten from any RFC 3339 spelling to canonical UTC
 *                      (Date#toISOString: the same instant, one spelling), with
 *                      the request body's hash kept in source.raw_sha256 when a
 *                      spelling changed; clock_skew_s stamped by the gateway;
 *                      response 202, or 400 with the schema errors or
 *                      ingest.off_grid when the record is off its dt_s grid
 *   POST /flush      close the open interval (end of a replay)
 *   GET  /health     { ok, seq }
 *
 * Every accepted interval is delivered through onInterval(record).
 * For POST /samples, each sample's raw payload is the exact request body it arrived
 * in, so a body carrying n samples of one interval enters that interval's
 * raw_sha256 n times (ingest/README.md, "raw_sha256"). No dependencies.
 */

'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { validate } = require(path.join(__dirname, '..', '..', 'protocol', 'schema-lite.js'));
const SCHEMA = require(path.join(__dirname, '..', '..', 'protocol', 'interval.schema.json'));
const { offGrid } = require(path.join(__dirname, '..', '..', 'batch', 'verify.js'));

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Canonical UTC for an RFC 3339 timestamp, or null when it is not one or would lose more than its spelling. */
function canonicalTs(s) {
  const up = typeof s === 'string' ? s.toUpperCase() : '';
  const m = RFC3339.exec(up);
  if (!m || (m[1] && /[1-9]/.test(m[1].slice(4)))) return null;   // below a millisecond would be rounding, not spelling
  const t = Date.parse(up);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

/**
 * start({ port, host, now }, builder, onInterval) → { port, close }
 * `now` is injectable for deterministic clock_skew_s in tests.
 */
function start(config, builder, onInterval) {
  const now = config.now || (() => Date.now());
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, seq: builder.seq });
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      const raw = await readBody(req);
      if (req.url === '/flush') {
        const recs = builder.flush() || [];
        if (onInterval) recs.forEach(onInterval);
        return send(res, 200, { closed: recs.length });
      }
      let body;
      try { body = JSON.parse(raw.toString('utf8')); } catch (e) { return send(res, 400, { error: 'invalid JSON' }); }
      if (req.url === '/samples') {
        const list = Array.isArray(body) ? body : [body];
        let closed = 0;
        for (const s of list) {
          if (!s || !['a', 'b'].includes(s.meter)) return send(res, 400, { error: 'meter must be "a" or "b"' });
          const recs = builder.push(s.meter, { ts: s.ts, power_w: s.power_w, energy_wh: s.energy_wh }, raw);
          closed += recs.length;
          if (onInterval) recs.forEach(onInterval);
        }
        return send(res, 200, { closed });
      }
      if (req.url === '/intervals') {
        const errs = validate(body, SCHEMA);
        if (errs.length) return send(res, 400, { error: 'schema', details: errs });
        /* one spelling per instant, as the door and the verifier compare them; the request hash makes the rewrite auditable */
        const ts = { ts_start: canonicalTs(body.ts_start), ts_end: canonicalTs(body.ts_end) };
        const bad = Object.keys(ts).filter((k) => ts[k] == null);
        if (bad.length) return send(res, 400, { error: 'schema', details: bad.map((k) => `${k}: not an RFC 3339 date-time with an offset`) });
        if (ts.ts_start !== body.ts_start || ts.ts_end !== body.ts_end) {
          Object.assign(body, ts);
          body.source = Object.assign({}, body.source, { raw_sha256: crypto.createHash('sha256').update(raw).digest('hex') });
        }
        const why = offGrid(body);
        if (why) return send(res, 400, { error: 'ingest.off_grid', detail: why });
        body.clock_skew_s = Math.round((now() - Date.parse(body.ts_end)) / 1000);
        if (onInterval) onInterval(body);
        return send(res, 202, { accepted: true, seq: body.seq, clock_skew_s: body.clock_skew_s });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(config.port || 0, config.host || '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** Tiny client for tests and the harness. */
function post(port, urlPath, body) {
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

module.exports = { start, post };
