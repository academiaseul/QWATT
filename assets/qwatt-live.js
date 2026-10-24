/**
 * QWATT — live testnet reader (read-only)
 * ---------------------------------------------------------------------------
 * The only way a qwatt.org page reads Stellar testnet. Plain fetch()/EventSource
 * to https://horizon-testnet.stellar.org, public G… addresses only. It never signs,
 * never sends, never stores, and hands renderers plain objects that carry no amount,
 * no fee, no coin total and no memo other than an anchoring memo QW#n.
 *
 * It does not touch the page (no DOM): pages and assets/live-widgets.js render.
 * Visibility: the page calls pause()/resume(); polling stops while paused.
 *
 * The anchoring account is never written here: ready() reads it from
 * assets/status.json (anchor.account), and it stays null until week 2 sets a
 * public address there. The week windows below are offline fallbacks only; ready()
 * replaces them from status.json, and ops/site.test.js fails if they disagree.
 *
 * UMD: window.QWATT_LIVE in the browser, require() in Node (ops/site-live.test.js).
 * Zero dependencies, ES2017.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.QWATT_LIVE = factory(root);
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* The real global object at call time (window, or globalThis in Node tests). */
  function G0() { return typeof globalThis !== 'undefined' ? globalThis : root; }

  var SIM_DEFAULT = { es: 'Entrada simulada · Stellar testnet', en: 'Simulated input · Stellar testnet' };

  var CONFIG = {
    HORIZON: 'https://horizon-testnet.stellar.org',
    PASSPHRASE: 'Test SDF Network ; September 2015',
    EXPLORER: 'https://stellar.expert/explorer/testnet',
    ANCHOR_ACCOUNT: null,
    SPRINT_START: '2026-10-19T03:00:00Z',
    WEEKS: [
      { n: 1, from: '2026-10-19T03:00:00Z', to: '2026-10-24T03:00:00Z' },
      { n: 2, from: '2026-10-26T03:00:00Z', to: '2026-10-31T03:00:00Z' },
      { n: 3, from: '2026-11-02T03:00:00Z', to: '2026-11-07T03:00:00Z' }
    ],
    RUN: { from: '2026-11-08T03:00:00Z', to: '2026-11-15T03:00:00Z' },
    AUGUST: {
      assetAccount: 'GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46',
      markerDestination: 'GCLS6EE5UNXFNK44SQGD4F3TYYFE7QCJX2QEXQ5E4TOQSAQBZUXTSOKW',
      creationLedger: 4277175,
      creationDate: '2026-08-22'
    },
    REHEARSAL: {
      abcd: { account: 'GAYA2PZSQJTHHXZPB2ZD6LO3C75GOLSI3T4PZNSSYOEL4FNWFK27CYET', evidence: '/evidence/rehearsal/rehearsal-2026-10-08T20-46-13-037Z.json',
        testC: '494e8d12cc3ab7b4f62a7f061a1e899c45e8b4553539346a0e71c8f5c525a8a1', testL: '9851ba7ec2743b6e7a4e22e5da9915e1dd7c499ccfdfe4e216a02365a3758715' },
      dress: { account: 'GB2QTJRIMRGJDBAJ2PI7PQ74ZNVVXCRDOBKAZA6ZASRYCSTNNRXMX3HU', evidence: '/evidence/dress-rehearsal/dress-2026-10-08T21-37-32-889Z.json' },
      e2e: { account: 'GCTBRUGQRYNGH7OMRMMQU46NAQNB2AURIWG7D66ADTQDWJC6D2N5O6FO', evidence: '/evidence/e2e/e2e-2026-10-08T20-50-44-831Z.json' },
      asset: { account: 'GCBKRNIPS4IVV2X7ZWR6DBMDNNTRQ53HXNRIQIIVNORCBMTSPK52L5AB', evidence: '/evidence/asset-rehearsal/anchors.json' }   // public keys and anchors only; the full record stays in the repository
    },
    SCALE: '/evidence/scale/scale-pvdaq-4902-2017-09.json',
    SIM_LABEL: null
  };
  /* Accounts that are never accepted as the anchoring account (August + 8 Oct rehearsal). */
  var PRIOR = [CONFIG.AUGUST.assetAccount, CONFIG.AUGUST.markerDestination,
    CONFIG.REHEARSAL.abcd.account, CONFIG.REHEARSAL.dress.account, CONFIG.REHEARSAL.e2e.account, CONFIG.REHEARSAL.asset.account];

  var POLICY = { timeoutMs: 8000, retryMs: 1500, maxInFlight: 4, ttlMs: 30000, backoff429Ms: 60000, pollMs: 6000 };

  /* ───────────────────────────── state ───────────────────────────── */

  var cache = {};          // url → { at, promise }
  var inFlight = 0, queue = [];
  var backoffUntil = 0;
  var paused = false;
  var readyPromise = null;

  function _reset() {
    cache = {}; inFlight = 0; queue = []; backoffUntil = 0; paused = false; readyPromise = null;
    CONFIG.ANCHOR_ACCOUNT = null; CONFIG.SIM_LABEL = null;
  }
  function now() { return Date.now(); }
  function err(code, message) { var e = new Error(message || code); e.code = code; return e; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ───────────────────────────── pure helpers ───────────────────────────── */

  function maskMemo(m) { return typeof m === 'string' && /^QW#\d+$/.test(m) ? m : null; }

  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function crc16(bytes) {
    var crc = 0;
    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 8;
      for (var k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc;
  }
  /** A public Stellar address: G + 55 base32, version byte 6<<3, CRC16-XModem checksum. */
  function isPublicKey(s) {
    if (typeof s !== 'string' || !/^G[A-Z2-7]{55}$/.test(s)) return false;
    var bits = 0, val = 0, out = [];
    for (var i = 0; i < s.length; i++) {
      val = (val << 5) | B32.indexOf(s[i]); bits += 5;
      if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    if (out.length !== 35 || out[0] !== (6 << 3)) return false;
    var c = crc16(out.slice(0, 33));
    return out[33] === (c & 255) && out[34] === (c >> 8);
  }
  /** The shape of a secret seed. The caller clears the field at once and never sends it. */
  function looksSecret(s) { return typeof s === 'string' && /^S[A-Z2-7]{55}$/.test(s.trim()); }

  function canOneKeySend(a) {
    if (!a || !a.exists) return null;
    var need = Math.max(a.thresholds.low, 1);
    return a.signers.some(function (s) { return s.weight >= need; });
  }
  function check223(a) {
    var others = (a.signers || []).filter(function (s) { return s.key !== a.id && s.weight > 0; });
    return {
      low2: a.thresholds.low === 2, med2: a.thresholds.med === 2, high3: a.thresholds.high === 3,
      threeSignersW1: others.length === 3 && others.every(function (s) { return s.weight === 1; }),
      masterZero: a.masterWeight === 0
    };
  }
  function weekOf(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    for (var i = 0; i < CONFIG.WEEKS.length; i++) {
      var w = CONFIG.WEEKS[i];
      if (t >= Date.parse(w.from) && t < Date.parse(w.to)) return w.n;
    }
    if (t >= Date.parse(CONFIG.RUN.from) && t < Date.parse(CONFIG.RUN.to)) return 'run';
    return null;
  }
  function decodeData(b64) {
    if (b64 == null) return null;
    try {
      if (typeof atob === 'function') return atob(b64);
      return Buffer.from(b64, 'base64').toString('latin1');
    } catch (e) { return null; }
  }

  /* ───────────────────────────── requests ───────────────────────────── */

  function slot() {
    if (inFlight < POLICY.maxInFlight) { inFlight++; return Promise.resolve(); }
    return new Promise(function (r) { queue.push(r); });
  }
  function release() { var next = queue.shift(); if (next) next(); else inFlight--; }

  function once(url) {
    var opt = { headers: { Accept: 'application/json' } };
    var timer = null;
    if (typeof AbortController === 'function') {
      var ac = new AbortController();
      opt.signal = ac.signal;
      timer = setTimeout(function () { ac.abort(); }, POLICY.timeoutMs);
    }
    return G0().fetch(url, opt).then(function (r) {
      if (timer) clearTimeout(timer);
      return r;
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  /** GET one Horizon path or same-origin URL with timeout, one retry, a 4-request cap and a 30 s cache. */
  function get(url, opts) {
    opts = opts || {};
    var hit = cache[url];
    if (hit && !opts.fresh && now() - hit.at < POLICY.ttlMs) return hit.promise;
    if (now() < backoffUntil) return Promise.reject(err('rate-limited', 'Horizon rate limit: backing off'));
    var p = slot().then(function () {
      var attempt = function (n) {
        return once(url).then(function (r) {
          if (r.status === 429) { backoffUntil = now() + POLICY.backoff429Ms; throw err('rate-limited', 'HTTP 429'); }
          if (r.status === 404) throw err('not-found', 'HTTP 404');
          if (r.status >= 500 && n === 0) return sleep(POLICY.retryMs).then(function () { return attempt(1); });
          if (!r.ok) throw err('http', 'HTTP ' + r.status);
          return r.json();
        }, function (e) {
          if (n === 0) return sleep(POLICY.retryMs).then(function () { return attempt(1); });
          throw err('offline', String(e && e.message || e));
        });
      };
      return attempt(0);
    }).then(function (v) { release(); return v; }, function (e) { release(); delete cache[url]; throw e; });
    cache[url] = { at: now(), promise: p };
    return p;
  }
  function hz(path, opts) { return get(CONFIG.HORIZON + path, opts); }
  function sameHorizon(href) { return typeof href === 'string' && href.indexOf(CONFIG.HORIZON + '/') === 0; }

  /* ───────────────────────────── status.json ───────────────────────────── */

  function iso03(day, addDays) {
    var t = new Date(day + 'T03:00:00Z');
    t.setUTCDate(t.getUTCDate() + (addDays || 0));
    return t.toISOString().replace('.000Z', 'Z');
  }
  function applyStatus(S) {
    var acct = S && S.anchor ? S.anchor.account : null;
    CONFIG.ANCHOR_ACCOUNT = isPublicKey(acct) && PRIOR.indexOf(acct) < 0 ? acct : null;
    var sim = S && S.labels && S.labels.sim;
    CONFIG.SIM_LABEL = sim && sim.es && sim.en ? { es: sim.es, en: sim.en } : SIM_DEFAULT;
    if (S && Array.isArray(S.weeks)) {
      var w = S.weeks.filter(function (x) { return x.n >= 1 && x.n <= 3 && x.from && x.to; })
        .map(function (x) { return { n: x.n, from: iso03(x.from, 0), to: iso03(x.to, 1) }; });
      if (w.length) CONFIG.WEEKS = w;
    }
    if (S && S.sprint) {
      if (S.sprint.run && S.sprint.run.from && S.sprint.run.to) CONFIG.RUN = { from: S.sprint.run.from, to: S.sprint.run.to };
      if (S.sprint.day1) CONFIG.SPRINT_START = iso03(S.sprint.day1, 0);
    }
  }
  /** Loads assets/status.json once and fills ANCHOR_ACCOUNT, SIM_LABEL, WEEKS, RUN. Never rejects. */
  function ready() {
    if (readyPromise) return readyPromise;
    var S = G0().QWATT_STATUS;
    var src = S && typeof S.load === 'function' ? S.load() : get('/assets/status.json');
    readyPromise = Promise.resolve(src).then(function (s) { applyStatus(s); return CONFIG; }, function () {
      CONFIG.ANCHOR_ACCOUNT = null; CONFIG.SIM_LABEL = SIM_DEFAULT; return CONFIG;
    });
    return readyPromise;
  }

  /* ───────────────────────────── reads ───────────────────────────── */

  function network() {
    return hz('/', { fresh: true }).then(function (r) {
      if (r.network_passphrase !== CONFIG.PASSPHRASE) throw err('wrong-network', 'unexpected network passphrase');
      return { ok: true, latestLedger: r.history_latest_ledger, closedAt: r.history_latest_ledger_closed_at || null, protocol: r.current_protocol_version || null };
    });
  }
  function slimLedger(l) {
    return { sequence: l.sequence, closedAt: l.closed_at, ops: l.operation_count, okTx: l.successful_transaction_count,
      failTx: l.failed_transaction_count, protocol: l.protocol_version };
  }
  function ledgers(n) {
    n = Math.max(1, Math.min(200, n | 0 || 20));
    return hz('/ledgers?order=desc&limit=' + n).then(function (r) { return r._embedded.records.map(slimLedger); });
  }
  /** EventSource on /ledgers (new ledgers as they close); polling of / as the fallback. */
  function streamLedgers(cb, onState) {
    var stopped = false, es = null, timer = null;
    var state = function (s) { if (onState) try { onState(s); } catch (e) { /* renderer problem */ } };
    function poll() {
      if (stopped) return;
      if (!paused) {
        network().then(function (n) { if (!stopped) { state('poll'); cb({ sequence: n.latestLedger, closedAt: n.closedAt }); } },
          function (e) { state(e.code || 'offline'); });
      }
      timer = setTimeout(poll, POLICY.pollMs);
    }
    var ES = G0().EventSource;
    if (typeof ES === 'function') {
      try {
        es = new ES(CONFIG.HORIZON + '/ledgers?cursor=now');
        es.onmessage = function (ev) {
          if (stopped || paused) return;
          try { state('stream'); cb(slimLedger(JSON.parse(ev.data))); } catch (e) { /* ignore a bad frame */ }
        };
        es.onerror = function () { if (es && es.readyState === 2) { es = null; state('poll'); poll(); } };
      } catch (e) { es = null; }
    }
    if (!es) poll();
    return function stop() { stopped = true; if (es) es.close(); if (timer) clearTimeout(timer); };
  }

  function account(G) {
    if (!isPublicKey(G)) return Promise.reject(err('bad-address', 'not a public address'));
    return hz('/accounts/' + G).then(function (a) {
      var data = {};
      Object.keys(a.data || {}).forEach(function (k) { data[k] = decodeData(a.data[k]); });
      var master = (a.signers || []).filter(function (s) { return s.key === G; })[0];
      var lines = a.balances || [];
      return {
        exists: true, id: G,
        signers: (a.signers || []).map(function (s) { return { key: s.key, weight: s.weight }; }),
        masterWeight: master ? master.weight : 0,
        thresholds: { low: a.thresholds.low_threshold, med: a.thresholds.med_threshold, high: a.thresholds.high_threshold },
        flags: a.flags || {},
        homeDomain: a.home_domain || null,
        data: data,
        lastModified: a.last_modified_time || null,
        lastModifiedLedger: a.last_modified_ledger || null,
        hasQwattTrustline: lines.some(function (b) { return b.asset_code === 'QWATT' && b.asset_issuer === CONFIG.AUGUST.assetAccount; })
      };
    }, function (e) { if (e.code === 'not-found') return { exists: false, id: G }; throw e; });
  }

  function slimTx(t) {
    return { hash: t.hash, ledger: t.ledger, createdAt: t.created_at, ok: !!t.successful,
      signatures: (t.signatures || []).slice(), ops: t.operation_count, memoShown: t.memo_type === 'text' ? maskMemo(t.memo) : null,
      sourceAccount: t.source_account || null };
  }
  /** Count of transactions with created_at in [from, to), newest first, paging back until older than from. */
  function txCount(G, from, to) {
    var tFrom = Date.parse(from), tTo = Date.parse(to);
    var count = 0, last = null, pages = 0;
    function page(url) {
      return get(url).then(function (r) {
        var recs = r._embedded ? r._embedded.records : [];
        var done = !recs.length;
        recs.forEach(function (t) {
          var c = Date.parse(t.created_at);
          if (last == null) last = t.created_at;
          if (c >= tFrom && c < tTo) count++;
          if (c < tFrom) done = true;
        });
        var next = r._links && r._links.next && r._links.next.href;
        if (done || !next || !sameHorizon(next) || ++pages >= 20 || recs.length < 200) return { count: count, last: last, notFound: false };
        return page(next);
      });
    }
    if (!isPublicKey(G)) return Promise.reject(err('bad-address'));
    return page(CONFIG.HORIZON + '/accounts/' + G + '/transactions?order=desc&limit=200').catch(function (e) {
      if (e.code === 'not-found') return { count: 0, last: null, notFound: true };
      throw e;
    });
  }
  function txs(G, o) {
    var limit = Math.max(1, Math.min(200, (o && o.limit) | 0 || 10));
    if (!isPublicKey(G)) return Promise.reject(err('bad-address'));
    return hz('/accounts/' + G + '/transactions?order=desc&limit=' + limit).then(function (r) { return r._embedded.records.map(slimTx); });
  }
  function tx(hash) {
    if (!/^[0-9a-f]{64}$/.test(hash)) return Promise.reject(err('bad-hash'));
    return hz('/transactions/' + hash).then(slimTx);
  }
  function ops(hash) {
    if (!/^[0-9a-f]{64}$/.test(hash)) return Promise.reject(err('bad-hash'));
    return hz('/transactions/' + hash + '/operations').then(function (r) {
      return r._embedded.records.map(function (o) {
        if (o.type === 'manage_data') return { type: 'manage_data', name: o.name, value: decodeData(o.value) };
        if (o.type === 'payment') return { type: 'payment', marker: true };
        return { type: o.type };
      });
    });
  }
  /** Every anchoring transaction of an account, oldest first (the shared reconciliation reader). */
  function anchors(G) {
    var R = G0().QWATT_RECONCILE;
    if (!R || typeof R.fetchAnchors !== 'function') return Promise.reject(err('missing', 'assets/qwatt-reconcile.js is not loaded'));
    if (!isPublicKey(G)) return Promise.reject(err('bad-address'));
    var key = 'anchors:' + G;
    var hit = cache[key];
    if (hit && now() - hit.at < POLICY.ttlMs) return hit.promise;
    var p = R.fetchAnchors(CONFIG.HORIZON, G).then(function (list) {
      return list.map(function (a) {
        return { txHash: a.tx_hash, ledger: a.ledger, createdAt: a.created_at, sha256: a.sha256, cumulativeMwh: a.cumulative_mwh, memoShown: maskMemo(a.memo) };
      });
    }, function (e) { delete cache[key]; throw err('offline', String(e && e.message || e)); });
    cache[key] = { at: now(), promise: p };
    return p;
  }
  /** Same-origin evidence JSON (cached). */
  function evidence(path) {
    if (typeof path !== 'string' || !/^\/(evidence|assets)\/[\w./-]+\.json$/.test(path) || path.indexOf('..') >= 0) return Promise.reject(err('bad-path'));
    return get(path);
  }

  return {
    CONFIG: CONFIG, POLICY: POLICY,
    ready: ready, network: network, streamLedgers: streamLedgers, ledgers: ledgers, account: account,
    txCount: txCount, txs: txs, tx: tx, ops: ops, anchors: anchors, evidence: evidence,
    maskMemo: maskMemo, canOneKeySend: canOneKeySend, check223: check223, isPublicKey: isPublicKey,
    looksSecret: looksSecret, weekOf: weekOf, decodeData: decodeData,
    pause: function () { paused = true; }, resume: function () { paused = false; }, isPaused: function () { return paused; },
    _reset: _reset
  };
}));
