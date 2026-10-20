/**
 * QWATT — reconciliation (shared: reconcile.html, anchor/reconcile-cli.js, tests)
 * ---------------------------------------------------------------------------
 * Confirms, from public data only, that what is anchored on Stellar is exactly
 * what was published in the evidence feed:
 *
 *   - every batch file re-hashes (SHA-256 of canonical JSON) to its ledger entry;
 *   - the hash chain is unbroken (prev_hash = previous batch's sha256, seq contiguous);
 *   - every anchoring transaction carries the hash of a published, accepted batch,
 *     and the cumulative total that batch states;
 *   - every batch's cumulative total is the energy of the accepted batches up to
 *     it: a batch published as rejected carries the total forward unchanged, so
 *     the on-chain total never includes refused energy;
 *   - accepted batches are anchored in order with no gap; rejected batches never are;
 *   - nothing anchored is missing from the feed.
 *
 * Verdict: RECONCILED (everything published and accepted is anchored and matches),
 * PENDING (only the newest accepted batches await anchoring — normal while the
 * pipeline runs), BROKEN (any mismatch, gap, or unexplained anchor).
 *
 * Zero dependencies. SHA-256 comes from WebCrypto (browsers, Node ≥ 19).
 * ES2017, loads as a classic <script> (window.QWATT_RECONCILE) or via require.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QWATT_RECONCILE = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ANCHOR_KEY = 'qwatt.anchor.sha256';
  var CUMULATIVE_KEY = 'qwatt.cumulative_mwh';

  /** Canonical JSON, integers only — byte-identical to protocol/evidence.js (held equal by tests). */
  function canonical(value, path) {
    path = path || '$';
    if (value === null) return 'null';
    var t = typeof value;
    if (t === 'string' || t === 'boolean') return JSON.stringify(value);
    if (t === 'number') {
      if (!Number.isSafeInteger(value)) throw new Error(path + ': ' + value + ' is not a safe integer; evidence is integers only');
      return JSON.stringify(value);
    }
    if (t === 'object') {
      if (Array.isArray(value)) {
        return '[' + value.map(function (v, i) {
          if (v === undefined) throw new Error(path + '[' + i + ']: undefined in array');
          return canonical(v, path + '[' + i + ']');
        }).join(',') + ']';
      }
      return '{' + Object.keys(value).filter(function (k) { return value[k] !== undefined; }).sort()
        .map(function (k) { return JSON.stringify(k) + ':' + canonical(value[k], path + '.' + k); }).join(',') + '}';
    }
    throw new Error(path + ': ' + t + ' cannot be serialized into evidence');
  }

  function subtle() {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) || (typeof self !== 'undefined' && self.crypto);
    if (!c || !c.subtle) throw new Error('WebCrypto (crypto.subtle) is required');
    return c.subtle;
  }

  async function sha256Hex(str) {
    var buf = await subtle().digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  async function batchSha256(batch) {
    var rest = {};
    Object.keys(batch).forEach(function (k) { if (k !== 'sha256') rest[k] = batch[k]; });
    return sha256Hex(canonical(rest));
  }

  function b64ascii(b64) {
    if (b64 == null) return null;
    if (typeof atob === 'function') return atob(b64);
    return Buffer.from(b64, 'base64').toString('ascii');   // Node without atob
  }

  /* ───────────────────────────── fetching ───────────────────────────── */

  async function getText(url, timeoutMs) {
    var opt = { cache: 'no-store' };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opt.signal = AbortSignal.timeout(timeoutMs || 20000);
    var r = await fetch(url, opt);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
    return r.text();
  }
  function jsonl(text) { return text == null ? [] : text.split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); }); }

  /** Everything published in the feed: index, batch ledger, every batch file, rejected ledger. */
  async function fetchFeed(baseUrl) {
    var base = String(baseUrl).replace(/\/+$/, '');
    var idx = await getText(base + '/index.json');
    var listed = jsonl(await getText(base + '/ledger/batches.jsonl'));
    var rejected = jsonl(await getText(base + '/ledger/rejected.jsonl'));
    var batches = {};
    for (var i = 0; i < listed.length; i++) {
      var t = await getText(base + '/batches/' + encodeURIComponent(listed[i].batch_id) + '.json');
      batches[listed[i].batch_id] = t == null ? null : JSON.parse(t);
    }
    return { index: idx == null ? null : JSON.parse(idx), listed: listed, batches: batches, rejected: rejected };
  }

  /**
   * Every anchoring transaction of the account, oldest first, from Horizon's
   * public REST API: one entry per transaction carrying a qwatt.anchor.sha256 manageData.
   */
  async function fetchAnchors(horizonUrl, account) {
    var base = String(horizonUrl).replace(/\/+$/, '');
    var url = base + '/accounts/' + encodeURIComponent(account) + '/operations?order=asc&limit=200&join=transactions';
    var byTx = {}, order = [];
    for (var guard = 0; url && guard < 500; guard++) {
      var page = JSON.parse(await getText(url));
      var recs = page._embedded.records;
      if (!recs.length) break;
      recs.forEach(function (op) {
        if (op.type !== 'manage_data' || !op.transaction_successful) return;
        if (op.name !== ANCHOR_KEY && op.name !== CUMULATIVE_KEY) return;
        var tx = op.transaction || {};
        if (!byTx[op.transaction_hash]) {
          byTx[op.transaction_hash] = { tx_hash: op.transaction_hash, ledger: tx.ledger, created_at: op.created_at, memo: tx.memo_type === 'text' ? tx.memo : null };
          order.push(op.transaction_hash);
        }
        var v = b64ascii(op.value);
        if (op.name === ANCHOR_KEY) byTx[op.transaction_hash].sha256 = v;
        else byTx[op.transaction_hash].cumulative_mwh = v == null ? null : Number(v);
      });
      url = page._links && page._links.next && page._links.next.href;
    }
    return order.map(function (h) { return byTx[h]; }).filter(function (a) { return a.sha256; });
  }

  /* ───────────────────────────── reconciling ───────────────────────────── */

  /**
   * @param {{listed:object[], batches:object, rejected:object[]}} feed
   * @param {object[]} anchors   oldest first: { tx_hash, ledger, created_at, memo, sha256, cumulative_mwh }
   */
  async function reconcile(feed, anchors) {
    var problems = [];
    var rows = [];
    var bySha = {};
    anchors.forEach(function (a, i) {
      if (bySha[a.sha256]) problems.push('batch hash ' + a.sha256.slice(0, 12) + '… anchored twice (' + bySha[a.sha256].tx_hash.slice(0, 10) + '…, ' + a.tx_hash.slice(0, 10) + '…)');
      else bySha[a.sha256] = Object.assign({ order: i }, a);
    });

    var prev = null, lastAnchoredIdx = -1, firstUnanchoredAccepted = -1, published = {}, acceptedEnergy = 0;
    for (var i = 0; i < feed.listed.length; i++) {
      var e = feed.listed[i], b = feed.batches[e.batch_id];
      var row = { batch_id: e.batch_id, seq: e.seq, status: e.status, reasons: e.reasons || [], ledger_sha256: e.sha256 };
      if (e.seq !== i) problems.push(e.batch_id + ': seq ' + e.seq + ' at position ' + i + ' (sequence gap)');
      if (!b) { problems.push(e.batch_id + ': listed but the batch file is missing'); row.file = 'missing'; rows.push(row); continue; }
      var recomputed;
      try { recomputed = await batchSha256(b); } catch (err) { recomputed = null; problems.push(e.batch_id + ': ' + err.message); }
      row.recomputed_sha256 = recomputed;
      row.file_ok = recomputed === b.sha256 && b.sha256 === e.sha256;
      if (!row.file_ok) problems.push(e.batch_id + ': file does not re-hash to its ledger entry');
      var link = prev == null ? '0'.repeat(64) : prev.sha256;
      row.chain_ok = b.prev_hash === link && (prev == null ? b.seq === 0 : b.seq === prev.seq + 1);
      if (!row.chain_ok) problems.push(e.batch_id + ': prev_hash does not continue the chain');
      row.energy_mwh = b.energy_mwh; row.cumulative_mwh = b.cumulative_mwh;
      if (e.status === 'accepted') acceptedEnergy += b.energy_mwh;
      row.total_ok = b.cumulative_mwh === acceptedEnergy;
      if (!row.total_ok) problems.push(e.batch_id + ': cumulative ' + b.cumulative_mwh + ' ≠ ' + acceptedEnergy + ', the energy of the accepted batches up to it (a rejected batch adds none)');
      row.accepted_count = b.accepted_count; row.rejected_count = b.rejected_count;
      published[b.sha256] = true;

      var a = bySha[b.sha256];
      if (a) {
        row.anchor = { tx_hash: a.tx_hash, ledger: a.ledger, created_at: a.created_at, memo: a.memo };
        if (e.status !== 'accepted') problems.push(e.batch_id + ': published as rejected but anchored in ' + a.tx_hash.slice(0, 10) + '…');
        if (a.cumulative_mwh !== b.cumulative_mwh) problems.push(e.batch_id + ': anchored cumulative ' + a.cumulative_mwh + ' ≠ batch ' + b.cumulative_mwh);
        if (a.memo != null && a.memo !== 'QW#' + b.seq) problems.push(e.batch_id + ': anchor memo ' + a.memo + ' ≠ QW#' + b.seq);
        if (firstUnanchoredAccepted >= 0) problems.push(e.batch_id + ' is anchored but earlier accepted batch ' + feed.listed[firstUnanchoredAccepted].batch_id + ' is not (gap)');
        lastAnchoredIdx = i;
      } else if (e.status === 'accepted' && firstUnanchoredAccepted < 0) {
        firstUnanchoredAccepted = i;
      }
      rows.push(row);
      prev = b;
    }

    anchors.forEach(function (a) {
      if (!published[a.sha256]) problems.push('anchor ' + a.tx_hash.slice(0, 10) + '… carries ' + a.sha256.slice(0, 12) + '…, which is not a published batch');
    });

    var reasons = {};
    (feed.rejected || []).forEach(function (l) { (l.reasons || []).forEach(function (c) { reasons[c] = (reasons[c] || 0) + 1; }); });

    var accepted = rows.filter(function (r) { return r.status === 'accepted'; });
    var anchoredRows = rows.filter(function (r) { return r.anchor; });
    var unanchored = accepted.filter(function (r) { return !r.anchor; });
    var lastAnchor = anchors.length ? anchors[anchors.length - 1] : null;
    var lastAnchoredRow = anchoredRows.length ? anchoredRows[anchoredRows.length - 1] : null;

    var verdict = problems.length ? 'BROKEN' : (unanchored.length ? 'PENDING' : 'RECONCILED');
    return {
      verdict: verdict,
      problems: problems,
      rows: rows,
      summary: {
        published_batches: rows.length,
        accepted_batches: accepted.length,
        rejected_batches: rows.length - accepted.length,
        anchored_batches: anchoredRows.length,
        awaiting_anchor: unanchored.map(function (r) { return r.batch_id; }),
        anchor_transactions: anchors.length,
        published_cumulative_mwh: prev ? prev.cumulative_mwh : 0,
        anchored_cumulative_mwh: lastAnchor ? lastAnchor.cumulative_mwh : 0,
        last_anchored_batch: lastAnchoredRow ? lastAnchoredRow.batch_id : null,
        rejected_intervals: (feed.rejected || []).length,
        rejected_by_reason: reasons,
        first_anchor_at: anchors.length ? anchors[0].created_at : null,
        last_anchor_at: lastAnchor ? lastAnchor.created_at : null,
      },
    };
  }

  return { canonical: canonical, sha256Hex: sha256Hex, batchSha256: batchSha256, fetchFeed: fetchFeed, fetchAnchors: fetchAnchors, reconcile: reconcile, ANCHOR_KEY: ANCHOR_KEY, CUMULATIVE_KEY: CUMULATIVE_KEY };
}));
