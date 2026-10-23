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
 *   - nothing anchored is missing from the feed;
 *   - the anchoring account is read from Horizon and must be thresholds 2/2/3
 *     (low/medium/high), master weight 0 and exactly three ed25519 signers of
 *     weight 1 (freeze v3 §3);
 *   - each anchoring transaction's signatures are verified (Ed25519 over the
 *     transaction hash, which is what Stellar signs) against the signer keys:
 *     proposer + verifier is normal, proposer + third signer is STAND-IN,
 *     anything else is BROKEN. Who is who comes from the run's faults.json
 *     (`anchoring.signers`) or is given explicitly; both must name signers of
 *     the account, and must agree when both exist;
 *   - the feed publishes faults.json, and it carries the fixed label
 *     "Simulated input · assurance A0 · Stellar testnet".
 *
 * Verdict: RECONCILED (everything published and accepted is anchored and matches),
 * PENDING (only the newest accepted batches await anchoring — normal while the
 * pipeline runs), BROKEN (any mismatch, gap, unexplained anchor, account rule or
 * signature pair outside §3). STAND-IN alone is reported, not a problem.
 *
 * Read order (check): Horizon first (the account, then every anchor with its
 * signatures), then the feed. A batch is published before it is signed, so a
 * feed read after Horizon holds every anchored batch; an anchor missing from it
 * is a real defect, not a stale copy. A Horizon or feed error fails the check
 * (it throws): it is never a verdict.
 *
 * Zero dependencies. SHA-256 and Ed25519 come from WebCrypto: Ed25519 needs
 * Node 20 or a current browser (Chrome 137+, Firefox 129+, Safari 17+). Without
 * it the check fails closed, with no verdict and a message naming
 * anchor/reconcile-cli.js. ES2017, loads as a classic <script>
 * (window.QWATT_RECONCILE) or via require.
 *
 * API: check({ feed, horizon, account, roles?, feedOptions? }) → { report, feed,
 * anchors, account }; reconcile(feed, anchors, chain) with chain = { account,
 * record, record_error?, roles? } (two arguments throw); fetchFeed(base, opt?)
 * → { index, run, listed, batches, rejected }, where `run` is faults.json and
 * `opt` is { timeoutMs } (check passes its feedOptions through, which is where
 * pinned reads add their options); fetchAnchors; fetchAccount.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QWATT_RECONCILE = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ANCHOR_KEY = 'qwatt.anchor.sha256';
  var CUMULATIVE_KEY = 'qwatt.cumulative_mwh';

  /** The fixed label (freeze v3, V3-9 and §6): next to every energy figure, in faults.json, the page and the write-up. */
  var INPUT_LABEL = 'Simulated input · assurance A0 · Stellar testnet';
  /** The anchoring account as freeze v3 §3 requires it; held equal to anchor/thresholds.js by batch/reconcile.test.js. */
  var ACCOUNT_RULES = Object.freeze({ low: 2, med: 2, high: 3, master_weight: 0, signers: 3, signer_weight: 1 });
  var ROLE_NAMES = ['proposer', 'verifier', 'third'];

  /* ─────────────────────── public keys and signatures ─────────────────────── */

  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function crc16xmodem(bytes) {
    var crc = 0;
    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 8;
      for (var k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc;
  }

  /** The 32 raw bytes of a G… address (StrKey: version byte 6<<3, key, CRC16-XModem), or null when it is not one. */
  function publicKeyBytes(g) {
    if (typeof g !== 'string' || !/^G[A-Z2-7]{55}$/.test(g)) return null;
    var out = [], bits = 0, v = 0;
    for (var i = 0; i < g.length; i++) {
      v = (v << 5) | B32.indexOf(g[i]); bits += 5;
      if (bits >= 8) { out.push((v >>> (bits - 8)) & 0xff); bits -= 8; v &= (1 << bits) - 1; }
    }
    if (out.length !== 35 || out[0] !== (6 << 3)) return null;
    if (crc16xmodem(out.slice(0, 33)) !== (out[33] | (out[34] << 8))) return null;
    return new Uint8Array(out.slice(1, 33));
  }

  function b64bytes(b64) {
    if (typeof atob === 'function') { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  function hexbytes(hex) {
    if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) return null;
    var u = new Uint8Array(32); for (var i = 0; i < 32; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16); return u;
  }

  var NO_ED25519 = 'this browser cannot verify Ed25519 signatures (WebCrypto); use a current browser, or node anchor/reconcile-cli.js';
  var keyCache = {};
  /**
   * True when `sigB64` is G's Ed25519 signature over the transaction hash (what Stellar signs).
   * An invalid key, hash or signature is false. A runtime without WebCrypto Ed25519 throws:
   * the check then fails closed, with no verdict, instead of calling every signature unknown.
   */
  async function signedBy(g, sigB64, txHashHex) {
    var pub = publicKeyBytes(g), msg = hexbytes(txHashHex), sig;
    if (!pub || !msg || typeof sigB64 !== 'string') return false;
    try { sig = b64bytes(sigB64); } catch (e) { return false; }
    if (sig.length !== 64) return false;
    var s = subtle();   // no WebCrypto at all throws here, outside the catch below
    if (!keyCache[g]) {
      try { keyCache[g] = await s.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']); }
      catch (e) {
        if (e && e.name === 'NotSupportedError') throw new Error(NO_ED25519);
        return false;
      }
    }
    try { return await s.verify({ name: 'Ed25519' }, keyCache[g], sig, msg); }
    catch (e) {
      if (e && e.name === 'NotSupportedError') throw new Error(NO_ED25519);
      return false;
    }
  }

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

  /**
   * Everything published in the feed: index, the run's faults.json (`run`, null when the feed
   * has none), batch ledger, every batch file, rejected ledger.
   * @param {string} baseUrl
   * @param {{timeoutMs?:number}} [opt]   per-request timeout (default 20 s)
   */
  async function fetchFeed(baseUrl, opt) {
    var base = String(baseUrl).replace(/\/+$/, '');
    var ms = opt && opt.timeoutMs;
    var idx = await getText(base + '/index.json', ms);
    var run = await getText(base + '/faults.json', ms);
    var listed = jsonl(await getText(base + '/ledger/batches.jsonl', ms));
    var rejected = jsonl(await getText(base + '/ledger/rejected.jsonl', ms));
    var batches = {};
    for (var i = 0; i < listed.length; i++) {
      var t = await getText(base + '/batches/' + encodeURIComponent(listed[i].batch_id) + '.json', ms);
      batches[listed[i].batch_id] = t == null ? null : JSON.parse(t);
    }
    return { index: idx == null ? null : JSON.parse(idx), run: run == null ? null : JSON.parse(run), listed: listed, batches: batches, rejected: rejected };
  }

  /** The account as Horizon reports it now (GET /accounts/<id>): thresholds and signers, master key included. */
  async function fetchAccount(horizonUrl, account) {
    var t = await getText(String(horizonUrl).replace(/\/+$/, '') + '/accounts/' + encodeURIComponent(account));
    if (t == null) throw new Error('account ' + account + ' not found on Horizon');
    return JSON.parse(t);
  }

  /**
   * Every anchoring transaction of the account, oldest first, from Horizon's
   * public REST API: one entry per transaction carrying a qwatt.anchor.sha256 manageData,
   * with the transaction's signatures (from the join, or from /transactions/<hash>).
   */
  async function fetchAnchors(horizonUrl, account) {
    var base = String(horizonUrl).replace(/\/+$/, '');
    var url = base + '/accounts/' + encodeURIComponent(account) + '/operations?order=asc&limit=200&join=transactions';
    var byTx = {}, order = [];
    for (var guard = 0; url && guard < 500; guard++) {
      var text = await getText(url);
      if (text == null) throw new Error(guard === 0 ? 'account ' + account + ' not found on Horizon' : url + ': HTTP 404');
      var page = JSON.parse(text);
      var recs = page._embedded.records;
      if (!recs.length) break;
      recs.forEach(function (op) {
        if (op.type !== 'manage_data' || !op.transaction_successful) return;
        if (op.name !== ANCHOR_KEY && op.name !== CUMULATIVE_KEY) return;
        var tx = op.transaction || {};
        if (!byTx[op.transaction_hash]) {
          byTx[op.transaction_hash] = { tx_hash: op.transaction_hash, ledger: tx.ledger, created_at: op.created_at, memo: tx.memo_type === 'text' ? tx.memo : null,
            signatures: Array.isArray(tx.signatures) ? tx.signatures.slice() : null };
          order.push(op.transaction_hash);
        }
        var v = b64ascii(op.value);
        if (op.name === ANCHOR_KEY) byTx[op.transaction_hash].sha256 = v;
        else byTx[op.transaction_hash].cumulative_mwh = v == null ? null : Number(v);
      });
      /* follow the next page only on the same Horizon: a link to any other host ends the walk */
      var nx = page._links && page._links.next && page._links.next.href;
      url = typeof nx === 'string' && nx.indexOf(base + '/') === 0 ? nx : null;
    }
    var out = order.map(function (h) { return byTx[h]; }).filter(function (a) { return a.sha256; });
    /* the join normally carries each transaction's signatures; when it does not, read the transaction itself */
    for (var j = 0; j < out.length; j++) {
      if (out[j].signatures) continue;
      var t = await getText(base + '/transactions/' + encodeURIComponent(out[j].tx_hash));
      var rec = t == null ? null : JSON.parse(t);
      out[j].signatures = rec && Array.isArray(rec.signatures) ? rec.signatures.slice() : null;
      if (rec && out[j].ledger == null) out[j].ledger = rec.ledger;
      if (rec && out[j].memo == null && rec.memo_type === 'text') out[j].memo = rec.memo;
    }
    return out;
  }

  /**
   * Everything public in one call, Horizon first: the account, then every anchor with its
   * signatures, then the feed (with faults.json). Not in parallel: a batch is published before
   * it is signed, so a feed read after Horizon holds every anchored batch, and an anchor missing
   * from it is a defect, never a stale copy. Nothing is caught: a Horizon or feed error rejects,
   * which is a failed check, never a verdict.
   * @param {{feed:string, horizon:string, account:string, roles?:{proposer:string, verifier:string, third:string}|null, feedOptions?:object}} o
   * @returns {Promise<{report:object, feed:object, anchors:object[], account:object}>}
   */
  async function check(o) {
    var record = await fetchAccount(o.horizon, o.account);
    var anchors = await fetchAnchors(o.horizon, o.account);
    var feed = await fetchFeed(o.feed, o.feedOptions);
    var report = await reconcile(feed, anchors, { account: o.account, record: record, roles: o.roles || null });
    return { report: report, feed: feed, anchors: anchors, account: record };
  }

  /* ───────────────────────────── the account (§3) ───────────────────────────── */

  function checkAccount(account, record, recordError) {
    var problems = [];
    if (!record || !record.thresholds || !Array.isArray(record.signers)) {
      return { id: account, ok: false, thresholds: null, master_weight: null, signers: null,
        problems: ['anchoring account ' + account + ' could not be read from Horizon' + (recordError ? ' (' + recordError + ')' : '') + ': signers and thresholds unchecked'] };
    }
    var t = record.thresholds;
    var th = t.low_threshold + '/' + t.med_threshold + '/' + t.high_threshold;
    var req = ACCOUNT_RULES.low + '/' + ACCOUNT_RULES.med + '/' + ACCOUNT_RULES.high;
    if (th !== req) problems.push('anchoring account: thresholds ' + th + ' (low/medium/high); required ' + req);
    var master = record.signers.filter(function (s) { return s.key === account; })[0];
    var mw = master ? master.weight : 0;
    if (mw !== ACCOUNT_RULES.master_weight) problems.push('anchoring account: master weight ' + mw + '; required ' + ACCOUNT_RULES.master_weight);
    var others = record.signers.filter(function (s) { return s.key !== account; });
    if (others.length !== ACCOUNT_RULES.signers) problems.push('anchoring account: ' + others.length + ' signer(s) besides the master key; required exactly ' + ACCOUNT_RULES.signers + ' of weight ' + ACCOUNT_RULES.signer_weight);
    others.forEach(function (s) {
      /* a preauth_tx or sha256_hash signer would let a transaction through without any key */
      if (s.type !== 'ed25519_public_key') problems.push('anchoring account: signer ' + s.key + ' is a ' + (s.type || 'untyped') + ' signer; only ed25519 keys are allowed');
      if (s.weight !== ACCOUNT_RULES.signer_weight) problems.push('anchoring account: signer ' + s.key + ' has weight ' + s.weight + '; required ' + ACCOUNT_RULES.signer_weight);
    });
    return { id: account, ok: problems.length === 0, thresholds: th, master_weight: mw,
      signers: others.map(function (s) { return { key: s.key, weight: s.weight, type: s.type || null, role: null }; }), problems: problems };
  }

  /** Who is who: given roles, or the run's faults.json `anchoring.signers`; checked against the account's signers. */
  function resolveRoles(feed, given, acct, problems) {
    var declared = feed.run && feed.run.anchoring && feed.run.anchoring.signers ? feed.run.anchoring.signers : null;
    if (given && declared && ROLE_NAMES.some(function (r) { return given[r] !== declared[r]; })) problems.push("signer roles given differ from the run's faults.json (anchoring.signers)");
    var roles = given || declared;
    if (!roles) { problems.push("signer roles are not declared: the run's faults.json has no anchoring.signers and none were given (proposer, verifier, third)"); return { roles: null, source: null }; }
    var bad = ROLE_NAMES.filter(function (r) { return !publicKeyBytes(roles[r]); });
    bad.forEach(function (r) { problems.push('signer roles: the ' + r + ' is not a valid G… public key'); });
    if (bad.length) return { roles: null, source: null };
    if (new Set(ROLE_NAMES.map(function (r) { return roles[r]; })).size !== 3) problems.push('signer roles: proposer, verifier and third signer must be three different keys');
    if (acct.signers) {
      ROLE_NAMES.forEach(function (r) {
        var s = acct.signers.filter(function (x) { return x.key === roles[r]; })[0];
        if (s) s.role = r; else problems.push('signer roles: the ' + r + ' key ' + roles[r] + ' is not a signer of the anchoring account');
      });
    }
    return { roles: roles, source: given ? 'given' : 'faults.json' };
  }

  /** The roles whose keys made an anchor's signatures, in role order ('unknown key' for none), and what that pair means (§3). */
  async function classify(anchor, roles) {
    if (!Array.isArray(anchor.signatures)) return { signed_by: null, mode: 'broken', why: 'Horizon returned no signatures' };
    var who = [];
    for (var i = 0; i < anchor.signatures.length; i++) {
      var found = 'unknown key';
      for (var r = 0; r < ROLE_NAMES.length; r++) {
        if (await signedBy(roles[ROLE_NAMES[r]], anchor.signatures[i], anchor.tx_hash)) { found = ROLE_NAMES[r]; break; }
      }
      who.push(found);
    }
    var rank = function (n) { var k = ROLE_NAMES.indexOf(n); return k < 0 ? 9 : k; };
    who.sort(function (a, b) { return rank(a) - rank(b); });
    var s = who.join('+');
    return { signed_by: s || 'no key', mode: s === 'proposer+verifier' ? 'normal' : s === 'proposer+third' ? 'stand-in' : 'broken' };
  }

  /* ───────────────────────────── reconciling ───────────────────────────── */

  /**
   * @param {{run?:object|null, listed:object[], batches:object, rejected:object[]}} feed   as fetchFeed returns it (`run` = faults.json)
   * @param {object[]} anchors   oldest first: { tx_hash, ledger, created_at, memo, sha256, cumulative_mwh, signatures }
   * @param {{account:string, record:object|null, record_error?:string|null, roles?:object|null}} chain
   *        what Horizon says about the anchoring account (GET /accounts/<id>, or null when it could not be
   *        read) and, optionally, who is who; required, because the verdict depends on it
   */
  async function reconcile(feed, anchors, chain) {
    if (!chain || typeof chain.account !== 'string') throw new TypeError('reconcile(feed, anchors, chain): chain { account, record, roles } is required; the verdict needs the anchoring account read from Horizon (freeze v3 V3-9)');
    var problems = [];
    var rows = [];

    /* §3 and V3-9: the account's rules and who is who, read from Horizon and the run's faults.json, never assumed */
    var acct = checkAccount(chain.account, chain.record, chain.record_error);
    var head = acct.problems.slice();
    var who = resolveRoles(feed, chain.roles || null, acct, head);
    /* the fixed label is published with the run, in faults.json; a feed without one cannot show it */
    var labelInFeed = feed.run == null ? null : feed.run.label === INPUT_LABEL;
    if (labelInFeed === null) head.push('the feed publishes no faults.json, so it does not carry the fixed label "' + INPUT_LABEL + '"');
    if (labelInFeed === false) head.push('faults.json does not carry the fixed label "' + INPUT_LABEL + '" (it has ' + JSON.stringify(feed.run.label === undefined ? null : feed.run.label) + ')');
    var cls = {}, counts = { normal: 0, stand_in: 0, broken: 0, unchecked: 0 };
    for (var c = 0; c < anchors.length; c++) {
      var k = who.roles ? await classify(anchors[c], who.roles) : { signed_by: null, mode: 'unchecked' };
      cls[anchors[c].tx_hash] = k;
      counts[k.mode === 'stand-in' ? 'stand_in' : k.mode]++;
    }
    problems.push.apply(problems, head);
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
        var k2 = cls[a.tx_hash] || { signed_by: null, mode: 'unchecked' };
        row.anchor = { tx_hash: a.tx_hash, ledger: a.ledger, created_at: a.created_at, memo: a.memo, signed_by: k2.signed_by, mode: k2.mode };
        if (k2.mode === 'broken') problems.push(e.batch_id + ': anchor ' + a.tx_hash.slice(0, 10) + '… ' + (k2.why || 'signed by ' + k2.signed_by + '; only proposer+verifier (normal) or proposer+third (stand-in) may anchor'));
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
        label: INPUT_LABEL,
        label_in_feed: labelInFeed,
        account: { id: acct.id, ok: acct.ok, thresholds: acct.thresholds, master_weight: acct.master_weight, signers: acct.signers },
        roles: who.roles, roles_source: who.source,
        signatures: counts,
        stand_in_batches: rows.filter(function (r) { return r.anchor && r.anchor.mode === 'stand-in'; }).map(function (r) { return r.batch_id; }),
      },
    };
  }

  return { canonical: canonical, sha256Hex: sha256Hex, batchSha256: batchSha256, fetchFeed: fetchFeed, fetchAnchors: fetchAnchors, fetchAccount: fetchAccount, check: check, reconcile: reconcile,
    publicKeyBytes: publicKeyBytes, signedBy: signedBy, INPUT_LABEL: INPUT_LABEL, ACCOUNT_RULES: ACCOUNT_RULES, ROLE_NAMES: ROLE_NAMES, ANCHOR_KEY: ANCHOR_KEY, CUMULATIVE_KEY: CUMULATIVE_KEY };
}));
