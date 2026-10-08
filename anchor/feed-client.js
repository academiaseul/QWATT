/**
 * QWATT — read the PUBLIC evidence feed over HTTP(S)
 * ---------------------------------------------------------------------------
 * The verifier's only input path. It takes a base URL and nothing else: no
 * proposer address, no shared directory, no side channel. Anything it signs
 * it first downloaded from the same URLs any reviewer uses.
 */

'use strict';

class FeedUnavailable extends Error {}

function makeFeedClient(baseUrl, { timeoutMs = 15000 } = {}) {
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('feed base URL must be http(s)://');
  const base = baseUrl.replace(/\/+$/, '');

  async function get(rel) {
    let r;
    try {
      r = await fetch(`${base}/${rel}`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    } catch (e) {
      throw new FeedUnavailable(`${rel}: ${e.message}`);
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new FeedUnavailable(`${rel}: HTTP ${r.status}`);
    return r.text();
  }

  const jsonl = (text) => (text == null ? [] : text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)));

  return {
    base,
    async index() { const t = await get('index.json'); return t == null ? null : JSON.parse(t); },
    async batches() { return jsonl(await get('ledger/batches.jsonl')); },
    async rejected() { return jsonl(await get('ledger/rejected.jsonl')); },
    async batch(id) { const t = await get(`batches/${id}.json`); return t == null ? null : JSON.parse(t); },
    async pending(id) { const t = await get(`pending/${id}.xdr`); return t == null ? null : t.trim(); },
  };
}

module.exports = { makeFeedClient, FeedUnavailable };
