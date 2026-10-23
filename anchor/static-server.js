/**
 * QWATT — minimal read-only static file server for an evidence-feed directory.
 * Stands in for the public feed host in local runs and the end-to-end test.
 * GET only, no directory listings, no path traversal, no caching.
 *
 * withholdingFeed: a GET-only proxy on 127.0.0.1 in front of a feed URL that
 * answers 404 for one path and forwards everything else unchanged. Test I
 * (anchor/tests-abcd.js) points the real verifier code at it, so one batch is
 * withheld from the verifier's only input path while the public feed is never
 * touched.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const TYPES = { '.json': 'application/json', '.jsonl': 'application/x-ndjson', '.xdr': 'text/plain', '.html': 'text/html', '.csv': 'text/csv' };

function serveDir(dir, port = 0, host = '127.0.0.1') {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({
    url: `http://${host}:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  })));
}

if (require.main === module) {
  const dir = process.argv[2] || 'feed';
  const port = Number(process.argv[3] || 8080);
  serveDir(dir, port, '0.0.0.0').then((s) => console.log(`serving ${path.resolve(dir)} read-only at ${s.url.replace('0.0.0.0', 'localhost')}`));
}

/**
 * @param {string} feedUrl    the feed to forward to
 * @param {string} withheld   the one path answered 404, e.g. 'batches/<id>.json'
 * @returns {Promise<{url:string, withheld:string, requests:string[], close:() => Promise<void>}>}
 */
function withholdingFeed(feedUrl, withheld, host = '127.0.0.1') {
  const base = String(feedUrl).replace(/\/+$/, '');
  const norm = (p) => '/' + decodeURIComponent(p).replace(/\/{2,}/g, '/').replace(/^\/+/, '');
  const hidden = norm(withheld);
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    let rel;
    try { rel = norm(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
    requests.push(rel);
    if (rel === hidden) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end(); }
    try {
      const r = await fetch(base + rel, { cache: 'no-store' });
      const body = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (e) { res.writeHead(502); res.end(); }
  });
  return new Promise((resolve) => server.listen(0, host, () => resolve({
    url: `http://${host}:${server.address().port}`,
    withheld: hidden,
    requests,
    close: () => new Promise((r) => { if (server.closeAllConnections) server.closeAllConnections(); server.close(() => r()); }),
  })));
}

module.exports = { serveDir, withholdingFeed };
