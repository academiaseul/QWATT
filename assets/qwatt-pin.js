/**
 * QWATT — read a public evidence repository at one commit (freeze v3, V3-7; decision D7)
 * ---------------------------------------------------------------------------
 * The evidence and the verifier log are GitHub repositories. Read through a
 * branch URL, raw.githubusercontent.com caches every file separately for up
 * to 5 minutes, so one reader can get a fresh batch ledger next to a stale
 * rejected ledger and judge two different versions of the evidence as one.
 * Pinning fixes that: resolve the branch to its head commit once, then read
 * every file at that commit, where its content can never change.
 *
 *   parse(baseUrl, o?)     → { owner, repo, ref, dir } or null
 *       <rawOrigin>/<owner>/<repo>/<ref>/<dir…>
 *       https://<owner>.github.io/<repo>/<dir…>   (ref = o.branch || 'main': the freeze §7 Pages URL
 *                                                  is read from the repository, never from Pages)
 *       anything else → null (read as given: a local server, a test feed)
 *   headCommit(p, o?)      → the 40-hex head commit of p.ref
 *       via 'refs' (Node default): GET <gitOrigin>/<owner>/<repo>.git/info/refs?service=git-upload-pack,
 *         the anonymous smart-HTTP advertisement, which carries only commit ids (no CORS, so not in a browser)
 *       via 'api' (browser default): GET <apiOrigin>/repos/<owner>/<repo>/commits/<ref> with
 *         Accept: application/vnd.github.sha (CORS *; 60 requests an hour per address, unauthenticated)
 *       a non-2xx answer throws "<host>: HTTP <status>"; timeout o.timeoutMs (15 s)
 *   pinBase(baseUrl, o?)   → { base, commit }
 *       not a repository URL → { base: the URL as given, commit: null }; a ref that is already a
 *       commit → kept; otherwise <rawOrigin>/<owner>/<repo>/<commit>/<dir>
 *   describe(baseUrl, commit, o?) → "<owner>/<repo>@<sha7>", or null
 *
 * Options: rawOrigin (https://raw.githubusercontent.com), gitOrigin (https://github.com),
 * apiOrigin (https://api.github.com), via, branch, timeoutMs.
 *
 * Zero dependencies, ES2017; loads as a classic <script> (window.QWATT_PIN) or via require.
 * assets/qwatt-reconcile.js uses it for every feed it reads.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QWATT_PIN = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = { rawOrigin: 'https://raw.githubusercontent.com', gitOrigin: 'https://github.com', apiOrigin: 'https://api.github.com', timeoutMs: 15000 };
  var SHA = /^[0-9a-f]{40}$/;
  var OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  var NAME = /^[A-Za-z0-9._-]+$/;

  function options(o) {
    var out = {}, k;
    for (k in DEFAULTS) out[k] = DEFAULTS[k];
    if (o) for (k in o) if (o[k] != null) out[k] = o[k];
    return out;
  }
  function trim(s) { return String(s).replace(/\/+$/, ''); }
  function isBrowser() { return typeof window !== 'undefined' && typeof window.document !== 'undefined'; }

  /** The repository, ref and directory a feed URL names, or null when it names none. */
  function parse(baseUrl, o) {
    o = options(o);
    var b = trim(baseUrl), raw = trim(o.rawOrigin) + '/', parts, m;
    if (b.indexOf(raw) === 0) {
      parts = b.slice(raw.length).split('/');
      if (parts.length < 3 || !OWNER.test(parts[0]) || !NAME.test(parts[1]) || !NAME.test(parts[2])) return null;
      return { owner: parts[0], repo: parts[1], ref: parts[2], dir: parts.slice(3).join('/') };
    }
    m = /^https:\/\/([A-Za-z0-9-]+)\.github\.io\/([^/?#]+)(?:\/([^?#]*))?$/.exec(b);
    if (m && OWNER.test(m[1]) && NAME.test(m[2])) {
      var branch = o.branch || 'main';
      if (!NAME.test(branch)) return null;
      return { owner: m[1], repo: m[2], ref: branch, dir: trim(m[3] || '') };
    }
    return null;
  }

  async function get(url, o, headers) {
    var init = { cache: 'no-store' };
    if (headers) init.headers = headers;
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(o.timeoutMs);
    var r = await fetch(url, init);
    if (!r.ok) throw new Error(new URL(url).host + ': HTTP ' + r.status);
    return r.text();
  }

  /** The head commit of p.ref, from the anonymous info/refs advertisement or the commits API. */
  async function headCommit(p, o) {
    o = options(o);
    if (!p || !NAME.test(p.ref)) throw new Error('headCommit: a repository and a branch name are required');
    var via = o.via || (isBrowser() ? 'api' : 'refs');
    var what = p.owner + '/' + p.repo + ' ' + p.ref;
    if (via === 'api') {
      var sha = (await get(trim(o.apiOrigin) + '/repos/' + p.owner + '/' + p.repo + '/commits/' + encodeURIComponent(p.ref), o, { Accept: 'application/vnd.github.sha' })).trim();
      if (!SHA.test(sha)) throw new Error(what + ': the commits API did not return a commit id');
      return sha;
    }
    if (via !== 'refs') throw new Error('headCommit: via must be "refs" or "api"');
    var adv = await get(trim(o.gitOrigin) + '/' + p.owner + '/' + p.repo + '.git/info/refs?service=git-upload-pack', o);
    var re = new RegExp('([0-9a-f]{40}) refs/heads/' + p.ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\u0000|\\n)');
    var m = re.exec(adv);
    if (!m) throw new Error(what + ': no such branch in the repository');
    return m[1];
  }

  /** The feed's base URL at one commit: { base, commit }, commit null when the URL is not a repository. */
  async function pinBase(baseUrl, o) {
    o = options(o);
    var p = parse(baseUrl, o);
    if (!p) return { base: trim(baseUrl), commit: null };
    var commit = SHA.test(p.ref) ? p.ref : await headCommit(p, o);
    return { base: trim(o.rawOrigin) + '/' + p.owner + '/' + p.repo + '/' + commit + (p.dir ? '/' + p.dir : ''), commit: commit };
  }

  /** "<owner>/<repo>@<sha7>" for a pinned read, or null (no commit, or not a repository URL). */
  function describe(baseUrl, commit, o) {
    var p = parse(baseUrl, o);
    return p && commit && SHA.test(commit) ? p.owner + '/' + p.repo + '@' + commit.slice(0, 7) : null;
  }

  return { parse: parse, headCommit: headCommit, pinBase: pinBase, describe: describe, DEFAULTS: DEFAULTS };
}));
