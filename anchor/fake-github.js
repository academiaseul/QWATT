/**
 * QWATT — a fake GitHub over HTTP, for the pinned-read tests (no network; needs only git)
 * ---------------------------------------------------------------------------
 * The public evidence lives in GitHub repositories (freeze v3, V3-7). This
 * serves local bare repositories on 127.0.0.1 the way GitHub serves them to
 * anonymous readers, including the part that matters for consistency: the raw
 * CDN caches a branch path per URL (max-age=300), while a commit path is
 * immutable and always fresh.
 *
 *   GET /git/<o>/<r>.git/info/refs?service=git-upload-pack
 *        the smart-HTTP advertisement (`001e# service=git-upload-pack\n0000` plus
 *        `git upload-pack --stateless-rpc --advertise-refs <bare>`): every branch head
 *   GET /raw/<o>/<r>/<40-hex commit>/<path>     `git cat-file blob <commit>:<path>`, or 404; never cached
 *   GET /raw/<o>/<r>/<branch>/<path>            the same at the branch, from a per-URL cache filled
 *                                               on the first request and kept until expire()
 *   GET /api/repos/<o>/<r>/commits/<branch>     with Accept: application/vnd.github.sha, the head
 *                                               commit as 40 hex characters (JSON otherwise)
 *
 * fakeGithub({ repos: { 'acme/qwatt-evidence': bareDir, … }, onRequest? }) →
 *   { url, rawOrigin, gitOrigin, apiOrigin, requests, expire(rel?), failRefs(status|null), failRaw(status|null, rel?, times?), close() }
 *   requests   every request as { path, accept }, in arrival order
 *   expire()   drops the whole CDN cache; expire('run/ledger/batches.jsonl') drops that path in every
 *              repository and branch
 *   failRefs() answers every branch-head request (info/refs and the API) with that HTTP status
 *              (e.g. 429, a rate limit) until failRefs(null)
 *   failRaw()  answers every raw file request (a commit path or a branch path) with that HTTP status
 *              (403, 429, 5xx, or 404 for a CDN that does not hold a fresh commit yet) until failRaw(null); with
 *              rel ('run/raw/x.jsonl'), only the paths that end with it; with times, only that many
 *              requests. The failure is never cached: the next request after it is served.
 */

'use strict';

const http = require('http');
const { execFileSync } = require('child_process');

const SHA = /^[0-9a-f]{40}$/;

function fakeGithub({ repos, onRequest } = {}) {
  const cdn = new Map();                                             // branch-path URL → { status, body }
  const requests = [];
  let refsStatus = null;
  let rawFail = null;                                                // { status, rel } while failRaw() is set
  const git = (args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30 });
  const repoOf = (o, r) => (Object.prototype.hasOwnProperty.call(repos, `${o}/${r}`) ? repos[`${o}/${r}`] : null);

  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const entry = { path: u.pathname + u.search, accept: req.headers.accept || null };
    requests.push(entry);
    if (onRequest) onRequest(entry);
    const send = (code, body, headers = {}) => { res.writeHead(code, headers); res.end(body); };
    let m;

    /* github.com smart HTTP: anonymous, no CORS (as on github.com) */
    if ((m = /^\/git\/([^/]+)\/([^/]+)\.git\/info\/refs$/.exec(u.pathname))) {
      const bare = repoOf(m[1], m[2]);
      if (!bare || u.searchParams.get('service') !== 'git-upload-pack') return send(404, 'Not Found');
      if (refsStatus) return send(refsStatus, 'rate limited');
      const adv = git(['upload-pack', '--stateless-rpc', '--advertise-refs', bare]);
      return send(200, Buffer.concat([Buffer.from('001e# service=git-upload-pack\n0000'), adv]), { 'Content-Type': 'application/x-git-upload-pack-advertisement', 'Cache-Control': 'no-cache' });
    }

    /* raw.githubusercontent.com: CORS *, a commit path is fresh, a branch path is cached per URL */
    if ((m = /^\/raw\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(u.pathname))) {
      const [, o, r, ref, p] = m;
      if (rawFail && (!rawFail.rel || u.pathname.endsWith('/' + rawFail.rel))) {
        if (rawFail.times != null && --rawFail.times <= 0) { const st = rawFail.status; rawFail = null; return send(st, `${st}: refused by the test`, { 'Access-Control-Allow-Origin': '*' }); }
        return send(rawFail.status, `${rawFail.status}: refused by the test`, { 'Access-Control-Allow-Origin': '*' });
      }
      const bare = repoOf(o, r);
      const read = () => {
        if (!bare) return { status: 404, body: Buffer.from('404: Not Found') };
        try { return { status: 200, body: git(['--git-dir', bare, 'cat-file', 'blob', `${ref}:${decodeURIComponent(p)}`]) }; }
        catch (e) { return { status: 404, body: Buffer.from('404: Not Found') }; }
      };
      let hit;
      if (SHA.test(ref)) hit = read();
      else { hit = cdn.get(u.pathname); if (!hit) { hit = read(); cdn.set(u.pathname, hit); } }
      return send(hit.status, hit.body, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'max-age=300', 'Access-Control-Allow-Origin': '*' });
    }

    /* api.github.com: CORS * */
    if ((m = /^\/api\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)$/.exec(u.pathname))) {
      const bare = repoOf(m[1], m[2]);
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (!bare) return send(404, JSON.stringify({ message: 'Not Found' }), cors);
      if (refsStatus) return send(refsStatus, JSON.stringify({ message: 'API rate limit exceeded' }), cors);
      let sha;
      try { sha = git(['--git-dir', bare, 'rev-parse', '--verify', `refs/heads/${decodeURIComponent(m[3])}`]).toString().trim(); }
      catch (e) { return send(422, JSON.stringify({ message: 'No commit found' }), cors); }
      if (req.headers.accept === 'application/vnd.github.sha') return send(200, sha, { ...cors, 'Content-Type': 'application/vnd.github.sha; charset=utf-8' });
      return send(200, JSON.stringify({ sha, commit: {} }), { ...cors, 'Content-Type': 'application/json' });
    }

    return send(404, 'Not Found');
  });

  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${srv.address().port}`;
    resolve({
      url, rawOrigin: `${url}/raw`, gitOrigin: `${url}/git`, apiOrigin: `${url}/api`, requests, cdn,
      expire(rel) {
        if (rel == null) { cdn.clear(); return; }
        for (const k of [...cdn.keys()]) if (k.endsWith('/' + rel.replace(/^\/+/, ''))) cdn.delete(k);
      },
      failRefs(status) { refsStatus = status || null; },
      failRaw(status, rel, times) { rawFail = status ? { status, rel: rel ? rel.replace(/^\/+/, '') : null, times: times == null ? null : times } : null; },
      close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(() => r()); }),
    });
  }));
}

module.exports = { fakeGithub };
