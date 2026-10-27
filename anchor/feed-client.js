/**
 * QWATT — read the PUBLIC evidence feed over HTTP(S)
 * ---------------------------------------------------------------------------
 * The verifier's only input path. It takes a base URL and nothing else: no
 * proposer address, no shared directory, no side channel. Anything it signs
 * it first downloaded from the same URLs any reviewer uses.
 *
 * Read at one commit (freeze v3 V3-7, decision D7). When the base URL names a
 * GitHub repository (raw.githubusercontent.com/<owner>/<repo>/<branch>/<run>,
 * or the github.io address of the same repository), snapshot() resolves the
 * branch to its head commit from the anonymous info/refs endpoint
 * (assets/qwatt-pin.js) and every file is then read at that commit. One tick
 * therefore judges one version of the evidence, never a fresh batch ledger
 * next to a stale CDN copy of the rejected ledger. Files read at a commit are
 * kept in memory (up to 5,000: the content at a commit never changes), so an
 * idle tick costs one info/refs request. A 404 is never kept: just after a
 * push, raw.githubusercontent.com can answer 404 for a file the commit holds,
 * so a 404 at a commit is read once more (after notFoundRetryMs, 2 s) and, if
 * it stays, returned as missing for this read only. Any other URL (a
 * local server, a test feed) is read as given, with no memory.
 *
 * Failing to resolve the head, or an HTTP error other than 404 (403, 429, 5xx),
 * throws FeedUnavailable: the verifier reports verifier.feed_unavailable, a wait,
 * never a refusal.
 */

'use strict';

const PIN = require('../assets/qwatt-pin.js');

class FeedUnavailable extends Error {}

const MEMO_MAX = 5000;

/**
 * @param {string} baseUrl
 * @param {{timeoutMs?:number, notFoundRetryMs?:number, pin?:object}} [o]   pin: assets/qwatt-pin.js options (rawOrigin, gitOrigin, …; via defaults to 'refs')
 * @returns {{snapshot:() => Promise<{base:string, commit:string|null}>, get:(rel:string) => Promise<string|null>, base:string, commit:string|null}}
 */
function makeReader(baseUrl, { timeoutMs = 15000, notFoundRetryMs = 2000, pin = {} } = {}) {
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('feed base URL must be http(s)://');
  const configured = baseUrl.replace(/\/+$/, '');
  let cur = null;                                                     // { base, commit } of the last snapshot
  const memo = new Map();                                             // URL at a commit → text (never a 404)

  async function snapshot() {
    try { cur = await PIN.pinBase(configured, { timeoutMs, via: 'refs', ...pin }); }
    catch (e) { throw new FeedUnavailable(`head commit of ${configured}: ${e.message}`); }
    return { base: cur.base, commit: cur.commit };
  }

  async function get(rel) {
    if (!cur) await snapshot();                                       // the first read takes a snapshot
    const url = `${cur.base}/${rel}`;
    if (cur.commit && memo.has(url)) return memo.get(url);
    let text = await read(url, rel);
    if (text == null && cur.commit) {
      /* a 404 at a commit can be the CDN not holding a fresh push yet: read once more, never remember it */
      if (notFoundRetryMs > 0) await new Promise((res) => setTimeout(res, notFoundRetryMs));
      text = await read(url, rel);
    }
    if (text != null && cur.commit) {
      if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
      memo.set(url, text);
    }
    return text;
  }

  /** The file's text, or null for a 404; any other failure is FeedUnavailable (a wait). */
  async function read(url, rel) {
    let r;
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    } catch (e) {
      throw new FeedUnavailable(`${rel}: ${e.message}`);
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new FeedUnavailable(`${rel}: HTTP ${r.status}`);
    return r.text();
  }

  return {
    snapshot, get,
    get base() { return cur ? cur.base : configured; },
    get commit() { return cur ? cur.commit : null; },
  };
}

const jsonl = (text) => (text == null ? [] : text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)));
const json = (text) => (text == null ? null : JSON.parse(text));

/**
 * The evidence feed. The readers are plain properties (tests replace them); snapshot() pins the
 * next reads to the head commit, and `base` / `commit` say what is being read.
 */
function makeFeedClient(baseUrl, opts = {}) {
  const rd = makeReader(baseUrl, opts);
  const c = {
    snapshot: () => rd.snapshot(),
    async index() { return json(await rd.get('index.json')); },
    async batches() { return jsonl(await rd.get('ledger/batches.jsonl')); },
    async rejected() { return jsonl(await rd.get('ledger/rejected.jsonl')); },
    async batch(id) { return json(await rd.get(`batches/${id}.json`)); },
    /** The batch's raw lines (raw/<id>.jsonl), or null when that file is not published. */
    async raw(id) { const t = await rd.get(`raw/${id}.jsonl`); return t == null ? null : jsonl(t); },
    async pending(id) { const t = await rd.get(`pending/${id}.xdr`); return t == null ? null : t.trim(); },
  };
  Object.defineProperty(c, 'base', { get: () => rd.base, enumerable: true });
  Object.defineProperty(c, 'commit', { get: () => rd.commit, enumerable: true });
  return c;
}

/**
 * The verifier's public log (academiaseul/qwatt-verifier-log/<run>/) read at one commit: the reader
 * V3-11's proposer uses for the verifier's decisions. Not wired to any service in week 2.
 */
function makeVerifierLogClient(baseUrl, opts = {}) {
  const rd = makeReader(baseUrl, opts);
  const c = {
    snapshot: () => rd.snapshot(),
    async status() { return json(await rd.get('status.json')); },
    async decisions() { return jsonl(await rd.get('decisions.jsonl')); },
    async refusals() { return jsonl(await rd.get('refusals.jsonl')); },
  };
  Object.defineProperty(c, 'base', { get: () => rd.base, enumerable: true });
  Object.defineProperty(c, 'commit', { get: () => rd.commit, enumerable: true });
  return c;
}

module.exports = { makeFeedClient, makeVerifierLogClient, makeReader, FeedUnavailable };
