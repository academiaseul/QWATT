/**
 * QWATT — minimal read-only static file server for an evidence-feed directory.
 * Stands in for the public feed host in local runs and the end-to-end test.
 * GET only, no directory listings, no path traversal, no caching.
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

module.exports = { serveDir };
