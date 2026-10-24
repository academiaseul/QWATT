/**
 * QWATT — evidence feed reader for the verification page (read-only)
 * ---------------------------------------------------------------------------
 * Reads a feed in the public layout of batch/feed.js (index.json,
 * ledger/batches.jsonl, ledger/rejected.jsonl, batches/<id>.json and, from batch
 * schema 1.1.0, raw/<id>.jsonl), from this site or from the configured feed host.
 * GET only, cache: 'no-store', 15 s timeout. It never touches the page.
 *
 * This is the only page module that knows batch and site identifiers (DESIGN
 * D-17): it maps "Lote #seq" to file names internally. What it hands to
 * renderers (entries, index, manifest, refusals, summaries) carries no batch,
 * site or node id; the raw batch objects it also returns are meant only for the
 * protocol functions of assets/qwatt-protocol.js, and the checklist never reads
 * those keys (ops/site.test.js R-FIELDS, ops/protocol-browser.test.js).
 *
 *   open(base, { fetch, account }) → Promise<feed>   (code 'feed-missing' / 'offline' on failure)
 *   feed.entries        [{ seq, status, reasons, sha256 }]
 *   feed.index          { latest_seq, head_sha256, cumulative_mwh, spec_version, schema_version, last_ts_start }
 *   feed.manifest       feed.json of a sample feed, or null
 *   feed.run            { label, signers, network } from a public feed's faults.json, or null
 *   feed.anchored, feed.account, feed.roles
 *   feed.batch(seq)     { text, obj, ledgerSha256 }
 *   feed.raw(seq)       parsed raw lines, or null (no samples_root, or not published)
 *   feed.rejectedFor(seq), feed.refusals(seq), feed.context(seq), feed.input(seq)
 *
 * UMD: window.QWATT_FEED in the browser, require() in Node. Zero dependencies, ES2017.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.QWATT_FEED = factory(root);
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var TIMEOUT_MS = 15000;
  var WALK = 24;            // a long public feed is walked back this many batches (sample feeds: to genesis)
  var ID_KEYS = ['batch_id', 'site_id', 'node_id', 'latest_batch_id'];

  function err(code, message) { var e = new Error(message || code); e.code = code; return e; }
  function G0() { return typeof globalThis !== 'undefined' ? globalThis : root; }

  function getter(fetchFn) {
    var f = fetchFn || (G0().fetch ? G0().fetch.bind(G0()) : null);
    if (!f) throw err('offline', 'no fetch available');
    return function (url) {
      var opt = { cache: 'no-store', headers: { Accept: 'application/json, text/plain' } };
      var timer = null;
      if (typeof AbortController === 'function') {
        var ac = new AbortController();
        opt.signal = ac.signal;
        timer = setTimeout(function () { ac.abort(); }, TIMEOUT_MS);
      }
      return Promise.resolve(f(url, opt)).then(function (r) {
        if (timer) clearTimeout(timer);
        if (r.status === 404) return null;
        if (!r.ok) throw err('http', 'HTTP ' + r.status + ' for ' + url);
        return r.text();
      }, function (e) { if (timer) clearTimeout(timer); throw err('offline', String(e && e.message || e)); });
    };
  }
  function jsonl(text) {
    return text == null ? [] : text.split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); });
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  /** A copy without identifier keys, for anything a renderer may show. */
  function strip(o) {
    if (Array.isArray(o)) return o.map(strip);
    if (!o || typeof o !== 'object') return o;
    var out = {};
    Object.keys(o).forEach(function (k) { if (ID_KEYS.indexOf(k) < 0) out[k] = strip(o[k]); });
    return out;
  }

  function open(base, opts) {
    opts = opts || {};
    if (typeof base !== 'string' || !/\/$/.test(base) || base.indexOf('..') >= 0) return Promise.reject(err('bad-base', 'a feed base ends with /'));
    var get = getter(opts.fetch);
    var sameOrigin = base.charAt(0) === '/';
    var cache = { batch: {}, raw: {}, rejected: null };
    var ids = {};            // seq → batch file id (private)

    return Promise.all([
      get(base + 'index.json'),
      get(base + 'ledger/batches.jsonl'),
      sameOrigin ? get(base + 'feed.json') : get(base + 'faults.json')
    ]).then(function (r) {
      if (r[0] == null || r[1] == null) throw err('feed-missing', 'no feed at ' + base);
      var index = JSON.parse(r[0]);
      var listed = jsonl(r[1]);
      var extra = r[2] == null ? null : JSON.parse(r[2]);
      var entries = listed.map(function (l, i) {
        if (l.seq !== i) throw err('feed-invalid', 'ledger/batches.jsonl line ' + (i + 1) + ' has seq ' + l.seq);
        ids[l.seq] = l.batch_id;
        return { seq: l.seq, status: l.status, reasons: (l.reasons || []).slice(), sha256: l.sha256 };
      });
      var manifest = sameOrigin && extra ? strip(extra) : null;
      var run = !sameOrigin && extra ? {
        label: extra.label || null,
        signers: extra.anchoring && extra.anchoring.signers ? strip(extra.anchoring.signers) : null,
        network: extra.anchoring && extra.anchoring.network || null
      } : null;
      var account = opts.account || (manifest && manifest.anchoring && manifest.anchoring.account) || null;
      var roles = (manifest && manifest.anchoring && manifest.anchoring.signers) || (run && run.signers) || null;

      function entry(seq) {
        var e = entries[seq];
        if (!e) throw err('no-batch', 'no batch #' + seq + ' in this feed');
        return e;
      }
      function batch(seq) {
        var e = entry(seq);
        if (cache.batch[seq]) return cache.batch[seq];
        var p = get(base + 'batches/' + encodeURIComponent(ids[seq]) + '.json').then(function (text) {
          if (text == null) throw err('batch-missing', 'batch #' + seq + ' is listed but its file is not published');
          return { text: text, obj: JSON.parse(text), ledgerSha256: e.sha256 };
        });
        p.catch(function () { delete cache.batch[seq]; });
        cache.batch[seq] = p;
        return p;
      }
      /** Fresh copies, so a tampered input never changes the cached file. */
      function batchCopy(seq) { return batch(seq).then(function (b) { return { text: b.text, obj: clone(b.obj), ledgerSha256: b.ledgerSha256 }; }); }
      function raw(seq) {
        return batch(seq).then(function (b) {
          if (!('samples_root' in b.obj)) return null;
          if (!cache.raw[seq]) cache.raw[seq] = get(base + 'raw/' + encodeURIComponent(ids[seq]) + '.jsonl').then(function (t) { return t == null ? null : { text: t, lines: jsonl(t) }; });
          return cache.raw[seq];
        });
      }
      function rejectedAll() {
        if (!cache.rejected) cache.rejected = get(base + 'ledger/rejected.jsonl').then(jsonl);
        return cache.rejected;
      }
      /** The rejected-ledger lines that name batch #seq, as the protocol reads them. */
      function rejectedFor(seq) {
        return batch(seq).then(function (b) {
          if (!b.obj.rejected_count) return [];
          return rejectedAll().then(function (all) { return all.filter(function (l) { return l.batch_id === ids[seq]; }); });
        });
      }
      /** The same lines for the screen: interval seq, start time and reason codes only. */
      function refusals(seq) {
        return rejectedFor(seq).then(function (ls) {
          return ls.map(function (l) {
            return { seq: l.interval && typeof l.interval.seq === 'number' ? l.interval.seq : null, ts: l.interval && typeof l.interval.ts_start === 'string' ? l.interval.ts_start : null, reasons: (l.reasons || []).slice() };
          });
        });
      }
      /** The previous published batch and the last accepted one before it (both rehashed by the protocol, never trusted). */
      function context(seq) {
        entry(seq);
        var floorSeq = -1;
        for (var i = seq - 1; i >= 0; i--) if (entries[i].status === 'accepted') { floorSeq = i; break; }
        return Promise.all([seq > 0 ? batchCopy(seq - 1) : null, floorSeq >= 0 ? batchCopy(floorSeq) : null]).then(function (r) {
          return { prev: r[0] ? r[0].obj : null, floor: r[1] ? r[1].obj : null };
        });
      }
      /** Everything the checklist needs for batch #seq, gathered without judging anything. */
      function input(seq) {
        var e = entry(seq);
        var from = sameOrigin ? 0 : Math.max(0, seq - WALK);
        var earlier = [];
        for (var i = from; i < seq; i++) earlier.push(i);
        var hasNext = seq + 1 < entries.length;
        return Promise.all([
          batchCopy(seq), context(seq), rejectedFor(seq), raw(seq), refusals(seq),
          Promise.all(earlier.map(function (s) { return batchCopy(s).then(function (b) { return b.obj; }); })),
          hasNext ? batchCopy(seq + 1).then(function (b) { return b.obj; }) : null
        ]).then(function (r) {
          return {
            seq: seq, status: e.status, reasons: e.reasons.slice(),
            statuses: entries.slice(from, seq + 2).map(function (x) { return { seq: x.seq, status: x.status }; }),
            anchored: !!account,
            batch: r[0], context: r[1], rejected: r[2], raw: r[3] ? r[3].lines : (r[3] === null && r[0].obj && 'samples_root' in r[0].obj ? null : undefined),
            rawBytes: r[3] ? r[3].text.length : 0,
            refusals: r[4], chain: r[5], next: r[6], walkedToGenesis: from === 0
          };
        });
      }

      return {
        base: base, sameOrigin: sameOrigin,
        index: { latest_seq: index.latest_seq, head_sha256: index.head_sha256, cumulative_mwh: index.cumulative_mwh,
          spec_version: index.spec_version, schema_version: index.schema_version, last_ts_start: index.last_ts_start || null },
        entries: entries, manifest: manifest, run: run,
        anchored: !!account, account: account, roles: roles,
        batch: batchCopy, raw: raw, rejectedFor: rejectedFor, refusals: refusals, context: context, input: input
      };
    });
  }

  return { open: open, WALK: WALK };
}));
