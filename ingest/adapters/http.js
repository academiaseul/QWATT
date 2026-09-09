/**
 * QWATT ingest — HTTP/JSON push adapter
 * ---------------------------------------------------------------------------
 * A node that already has a network connection pushes here instead of being
 * polled. Two doors:
 *
 *   POST /samples    { meter:'a', ts, power_w, energy_wh? }  or an array of them
 *                    → fed to the IntervalBuilder; response { closed: n }
 *   POST /intervals  a complete interval record (normalized at the node)
 *                    → validated against interval.schema.json; clock_skew_s stamped
 *                      by the gateway; response 202, or 400 with the schema errors
 *   POST /flush      close the open interval (end of a replay)
 *   GET  /health     { ok, seq }
 *
 * Every accepted interval is delivered through onInterval(record).
 * The raw payload hashed into an interval is the exact request body. No dependencies.
 */

'use strict';

const http = require('http');
const path = require('path');
const { validate } = require(path.join(__dirname, '..', '..', 'protocol', 'schema-lite.js'));
const SCHEMA = require(path.join(__dirname, '..', '..', 'protocol', 'interval.schema.json'));

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
