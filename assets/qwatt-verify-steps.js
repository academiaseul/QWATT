/**
 * QWATT — the verification checklist, as a pure function (DESIGN §9.5)
 * ---------------------------------------------------------------------------
 * run(input, deps) → Promise<rows>: ten checks of one published batch, each with
 * a state (ok, fail, na, wait, offline, planned) and the values it compared.
 * Every check calls the repository's own protocol code (deps.P =
 * window.QWATT_PROTOCOL, the generated browser build, or the Node modules in
 * tests), plus the browser's own SHA-256 (deps.webcrypto) as a second opinion
 * and Ed25519 signature checks (deps.signedBy) when the browser has them.
 *
 * It never fetches and never touches the page: assets/pages/verificacion.js
 * gathers the input through assets/qwatt-feed.js and assets/qwatt-live.js, so the
 * same function runs in ops/protocol-browser.test.js with fixtures. Rows carry
 * numbers, hashes, codes and interval sequence numbers only: no identifier of a
 * batch, site or node ever reaches a row (DESIGN D-17).
 *
 * tamper(input, mode, deps) changes one byte of the batch in memory (or, for the
 * careful forger, recomputes every fingerprint) and returns the altered input and
 * a summary that names the field and the two values only.
 *
 * UMD: window.QWATT_VERIFY_STEPS in the browser, require() in Node. ES2017.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QWATT_VERIFY_STEPS = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ZERO = '0000000000000000000000000000000000000000000000000000000000000000';
  var RAW_BROWSER_MAX = 64 * 1024 * 1024;
  var GITHUB = 'https://github.com/academiaseul/QWATT/blob/main/';
  var MODES = ['energy', 'raw', 'prev', 'total', 'time', 'forger'];
  var ID_WORDS = /\b(batch_id|site_id|node_id|latest_batch_id)\b/g;

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(''); }
  function utf8(s) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s);
    return new Uint8Array(unescape(encodeURIComponent(s)).split('').map(function (c) { return c.charCodeAt(0); }));
  }
  function webSha(deps, text) {
    if (!deps.webcrypto) return Promise.resolve(null);
    return Promise.resolve(deps.webcrypto.digest('SHA-256', utf8(text))).then(hex, function () { return null; });
  }
  function clean(s) { return String(s).replace(ID_WORDS, '…'); }
  function uniq(a) { var o = []; a.forEach(function (x) { if (o.indexOf(x) < 0) o.push(x); }); return o; }
  function sameSet(a, b) { a = uniq(a).sort(); b = uniq(b).sort(); return JSON.stringify(a) === JSON.stringify(b); }
  function vless(a, b) {   // semver a < b
    var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (var i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
    return false;
  }
  function withoutHash(obj) { var r = {}; Object.keys(obj).forEach(function (k) { if (k !== 'sha256') r[k] = obj[k]; }); return r; }
  function safeHash(P, b) { try { return P.evidence.batchSha256(b); } catch (e) { return null; } }

  /* ───────────────────────────── the ten rows ───────────────────────────── */

  function run(input, deps) {
    var P = deps.P;
    var b = input.batch, obj = b.obj;
    var engine = P.versions ? P.versions.batch_schema : P.verify.BATCH_SCHEMA_VERSION;
    var hasSamples = obj && Object.prototype.hasOwnProperty.call(obj, 'samples_root');
    var schema = hasSamples ? '1.1.0' : '1.0.0';
    var fd13 = !hasSamples && !vless(engine, '1.1.0');
    var ctx = { prev: input.context.prev, floor: input.context.floor, rejected: input.rejected || [], status: input.status };
    if (hasSamples) ctx.raw = input.raw;
    var verdict;
    try { verdict = P.verify.verifyBatch(obj, ctx); } catch (e) { verdict = { ok: false, failures: [{ code: 'batch.schema_invalid', detail: { errors: [e.message] } }] }; }
    var codes = uniq(verdict.failures.map(function (f) { return f.code; }));
    var recomputed = safeHash(P, obj);
    var rows = [];

    /* 1 · download: the file parses and its fingerprint field is the register's */
    var r1 = webSha(deps, b.text).then(function (fileSha) {
      return { n: 1, id: 'download', state: obj && obj.sha256 === b.ledgerSha256 ? 'ok' : 'fail', fileSha256: fileSha, declared: obj ? obj.sha256 : null, ledger: b.ledgerSha256 };
    });

    /* 2 · format: schema, integers only, every interval's schema */
    var errors = [];
    verdict.failures.filter(function (f) { return f.code === 'batch.schema_invalid'; }).forEach(function (f) { (f.detail && f.detail.errors || []).forEach(function (e) { errors.push(clean(e)); }); });
    (obj.intervals || []).forEach(function (rec, i) { P.verify.intervalErrors(rec).forEach(function (e) { errors.push('intervals[' + i + ']: ' + clean(e)); }); });
    try { P.evidence.canonical(obj); } catch (e) { errors.push(clean(e.message)); }
    errors = uniq(errors);
    var onlySamples = fd13 && errors.length > 0 && errors.every(function (e) { return /samples_root/.test(e); });
    var r2 = { n: 2, id: 'format', state: errors.length === 0 || onlySamples ? 'ok' : 'fail', schema: schema, engine: engine, errors: errors.slice(0, 10), samplesNote: onlySamples };

    /* 3 · each interval: canonical leaf, basis, gates G0–G3 re-run, on its grid */
    var spec = P.verify.SPEC, profile = spec.profiles.bench;
    var table = (obj.intervals || []).map(function (rec) {
      var v = P.verify.GATES.evaluateInterval(rec, profile, spec);
      var grid = P.verify.offGrid(rec);
      var leaf = null;
      try { leaf = P.evidence.sha256(P.evidence.canonical(rec)); } catch (e) { leaf = null; }
      return { seq: rec.seq, ts: rec.ts_start, a: rec.meters && rec.meters.a ? rec.meters.a.mwh : null, b: rec.meters && rec.meters.b ? rec.meters.b.mwh : null,
        basis: P.evidence.basisMwh(rec), leaf: leaf, verdict: v.verdict, codes: v.failures.map(function (f) { return f.code; }), onGrid: !grid };
    });
    var bad = table.filter(function (t) { return t.verdict !== 'accept' || !t.onGrid || !t.leaf; }).map(function (t) { return t.seq; });
    var sumBasis = table.reduce(function (s, t) { return s + (typeof t.basis === 'number' ? t.basis : 0); }, 0);
    var r3 = { n: 3, id: 'intervals', state: bad.length ? 'fail' : 'ok', count: table.length, failed: bad, table: table,
      sumBasis: sumBasis, declaredEnergy: obj.energy_mwh, energyMatch: sumBasis === obj.energy_mwh };

    /* 4 · interval root */
    var root = null;
    try { root = P.evidence.merkleRoot(obj.intervals || []); } catch (e) { root = null; }
    var r4 = { n: 4, id: 'root', state: root && root === obj.intervals_root ? 'ok' : 'fail', declared: obj.intervals_root, recomputed: root };

    /* 5 · raw readings (samples_root, batch schema 1.1.0) */
    var r5;
    if (!hasSamples) r5 = { n: 5, id: 'raw', state: 'na', why: 'schema-1.0.0' };
    else if (typeof P.evidence.samplesRoot !== 'function') r5 = { n: 5, id: 'raw', state: 'na', why: 'engine' };
    else if ((input.rawBytes || 0) > RAW_BROWSER_MAX) r5 = { n: 5, id: 'raw', state: 'na', why: 'too-big' };
    else if (input.raw == null) r5 = { n: 5, id: 'raw', state: 'fail', why: 'missing', declared: obj.samples_root, recomputed: null };
    else {
      var sr = null;
      try { sr = P.evidence.samplesRoot(input.raw); } catch (e) { sr = null; }
      var rawCodes = codes.filter(function (c) { return /samples_root|raw/.test(c); });
      r5 = { n: 5, id: 'raw', state: sr === obj.samples_root && !rawCodes.length ? 'ok' : 'fail', declared: obj.samples_root, recomputed: sr, codes: rawCodes };
    }

    /* 6 · batch fingerprint: the repository's code and the browser's own SHA-256 */
    var canon = null;
    try { canon = P.evidence.canonical(withoutHash(obj)); } catch (e) { canon = null; }
    var r6 = (canon == null ? Promise.resolve(null) : webSha(deps, canon)).then(function (web) {
      var ok = recomputed && recomputed === obj.sha256 && recomputed === b.ledgerSha256 && (web == null || web === recomputed);
      return { n: 6, id: 'fingerprint', state: ok ? 'ok' : 'fail', declared: obj.sha256, ledger: b.ledgerSha256, recomputed: recomputed, webcrypto: web };
    });

    /* 7 · chain: every earlier batch rehashes and links, back to genesis (or the walk limit); the next one names this one */
    var chain = input.chain || [];
    var links = [], chainOk = true, brokenAt = null;
    var prevHash = null;
    chain.forEach(function (c, i) {
      var h = safeHash(P, c);
      var rehash = h != null && h === c.sha256;
      var link = i === 0 ? (c.seq === 0 ? c.prev_hash === ZERO : true) : c.prev_hash === prevHash;
      if (!(rehash && link)) { chainOk = false; if (brokenAt == null) brokenAt = c.seq; }
      links.push({ seq: c.seq, rehash: rehash, link: link });
      prevHash = h;
    });
    var selfLink = chain.length ? obj.prev_hash === prevHash : (obj.seq === 0 ? obj.prev_hash === ZERO : true);
    if (!selfLink) { chainOk = false; if (brokenAt == null) brokenAt = obj.seq; }
    links.push({ seq: obj.seq, rehash: recomputed === obj.sha256, link: selfLink, selected: true });
    var next = null;
    if (input.next) {
      next = { seq: input.next.seq, link: input.next.prev_hash === recomputed };
      if (!next.link) chainOk = false;
    }
    var genesis = chain.length ? chain[0].seq === 0 : obj.seq === 0;
    var r7 = { n: 7, id: 'chain', state: chainOk ? 'ok' : 'fail', walked: chain.length, genesis: genesis, links: links, next: next, brokenAt: brokenAt };

    /* 8 · running total: accepted batches add their energy, refused ones carry the total forward */
    var statusOf = {};
    (input.statuses || []).forEach(function (s) { statusOf[s.seq] = s.status; });
    statusOf[obj.seq] = input.status;
    var walk = chain.concat([obj]);
    var expected = null, totalOk = true;
    var ttable = walk.map(function (c, i) {
      var st = statusOf[c.seq] || 'accepted';
      if (i === 0) expected = c.seq === 0 ? (st === 'accepted' ? c.energy_mwh : 0) : c.cumulative_mwh;
      else expected = expected + (st === 'accepted' ? c.energy_mwh : 0);
      var ok = c.cumulative_mwh === expected;
      if (!ok) totalOk = false;
      return { seq: c.seq, status: st, energy: c.energy_mwh, expected: expected, declared: c.cumulative_mwh, ok: ok };
    });
    var r8 = { n: 8, id: 'total', state: totalOk ? 'ok' : 'fail', table: ttable };

    /* 9 · engine verdict: verifyBatch, the function the verifier runs before co-signing */
    var r9;
    if (fd13 && codes.length && codes.every(function (c) { return c === 'batch.schema_invalid' || c === 'batch.raw_missing'; })) {
      r9 = { n: 9, id: 'engine', state: 'na', why: 'fd13', ok: false, codes: codes, asPublished: input.status, engine: engine };
    } else if (input.status === 'rejected') {
      r9 = { n: 9, id: 'engine', state: !verdict.ok && sameSet(codes, input.reasons || []) ? 'ok' : 'fail', ok: verdict.ok, codes: codes, asPublished: 'rejected', ledgerReasons: (input.reasons || []).slice(), engine: engine };
    } else {
      r9 = { n: 9, id: 'engine', state: verdict.ok ? 'ok' : 'fail', ok: verdict.ok, codes: codes, asPublished: 'accepted', engine: engine };
    }

    /* 10 · on Stellar testnet: the anchor, its signers, the account read now */
    var r10 = stellarRow(input, deps, obj, recomputed);

    return Promise.all([r1, r2, r3, r4, r5, r6, r7, r8, r9, r10]).then(function (all) { rows = all; return rows; });
  }

  function stellarRow(input, deps, obj, recomputed) {
    var base = { n: 10, id: 'stellar' };
    function out(o) { return Object.assign({}, base, o); }
    if (!input.anchored) return Promise.resolve(out({ state: 'na', why: 'not-anchored' }));
    var st = input.stellar;
    if (!st || st.state === 'wait') return Promise.resolve(out({ state: 'wait' }));
    if (st.state === 'offline') return Promise.resolve(out({ state: 'offline' }));
    if (st.state === 'planned') return Promise.resolve(out({ state: 'planned' }));
    var anchors = st.anchors || [];
    var bySeq = anchors.filter(function (a) { return a.memoShown === 'QW#' + obj.seq; })[0] || null;
    var byHash = anchors.filter(function (a) { return recomputed && a.sha256 === recomputed; })[0] || null;
    var acct = st.account && st.account.exists ? st.account : null;
    var account = acct ? {
      thresholds: acct.thresholds.low + '/' + acct.thresholds.med + '/' + acct.thresholds.high,
      signersW1: acct.signers.filter(function (s) { return s.key !== acct.id && s.weight === 1; }).length,
      masterWeight: acct.masterWeight
    } : null;
    var thresholds = account ? account.thresholds : null;
    if (input.status === 'rejected') {
      return Promise.resolve(out({ state: byHash ? 'fail' : 'ok', why: 'never-anchored', anchors: anchors.length, thresholds: thresholds, account: account }));
    }
    var a = bySeq || byHash;
    if (!a) return Promise.resolve(out({ state: 'wait', why: 'pending', anchors: anchors.length, thresholds: thresholds, account: account }));
    var anchor = { memoShown: a.memoShown, ledger: a.ledger, createdAt: a.createdAt, txHash: a.txHash, sha256: a.sha256, cumulativeMwh: a.cumulativeMwh,
      hashMatch: a.sha256 === recomputed, totalMatch: a.cumulativeMwh === obj.cumulative_mwh };
    var tx = st.txs && st.txs[a.txHash];
    var sigs = tx && Array.isArray(tx.signatures) ? tx.signatures : [];
    var roles = st.roles || {};
    var names = Object.keys(roles);
    var signedBy = deps.signedBy;
    var checks = signedBy ? sigs.map(function (sig) {
      return Promise.all(names.map(function (name) {
        return Promise.resolve(signedBy(roles[name], sig, a.txHash)).then(function (v) { return v; }, function () { return null; });
      })).then(function (res) {
        if (res.some(function (v) { return v === null; })) return { unsupported: true };
        var i = res.indexOf(true);
        return { role: i >= 0 ? names[i] : 'unknown' };
      });
    }) : [];
    return Promise.all(checks).then(function (matched) {
      var noEd = !signedBy || matched.some(function (m) { return m.unsupported; });
      var signers = noEd ? null : uniq(matched.map(function (m) { return m.role; }));
      var known = signers ? signers.filter(function (s) { return s !== 'unknown'; }) : null;
      var signOk = noEd || (known.length >= 2 && known.length === signers.length);
      var targetOk = true, target = null;
      if (input.requireTarget && acct) {
        target = { low2: acct.thresholds.low === 2, med2: acct.thresholds.med === 2, high3: acct.thresholds.high === 3,
          threeSignersW1: account.signersW1 === 3, masterZero: acct.masterWeight === 0 };
        targetOk = target.low2 && target.med2 && target.high3 && target.threeSignersW1 && target.masterZero;
      }
      var ok = anchor.hashMatch && anchor.totalMatch && signOk && targetOk;
      return out({
        state: ok ? 'ok' : 'fail', anchor: anchor, signatureCount: sigs.length, signers: signers,
        pair: known ? known.slice().sort().join('+') : null, noEd25519: noEd, thresholds: thresholds, account: account, target: target
      });
    });
  }

  /* ───────────────────────────── tampering ───────────────────────────── */

  function middle(list, pred) {
    var idx = [];
    list.forEach(function (x, i) { if (pred(x)) idx.push(i); });
    if (!idx.length) return Math.floor(list.length / 2);
    return idx[Math.floor(idx.length / 2)];
  }
  function bumpLastDigit(n) { var s = String(n), d = (+s.slice(-1) + 1) % 10; return +(s.slice(0, -1) + d); }
  function textOf(P, obj) { return P.evidence.canonical(obj) + '\n'; }
  function diffBytes(a, b) {
    if (a.length !== b.length) return Math.abs(a.length - b.length) + 1;
    var n = 0; for (var i = 0; i < a.length; i++) if (a.charCodeAt(i) !== b.charCodeAt(i)) n++;
    return n;
  }

  /** The payload the raw mode changes: from the middle line outward, the first one with bytes (utf8 or hex). */
  function rawTarget(raw) {
    var mid = Math.floor(raw.length / 2);
    for (var d = 0; d <= raw.length; d++) {
      var tries = d === 0 ? [mid] : [mid - d, mid + d];
      for (var t = 0; t < tries.length; t++) {
        var li = tries[t], line = raw[li];
        if (li < 0 || li >= raw.length || !line || !Array.isArray(line.payloads)) continue;
        for (var p = 0; p < line.payloads.length; p++) {
          var pl = line.payloads[p];
          if (pl && typeof pl.utf8 === 'string' && pl.utf8.length) return { line: li, p: p, enc: 'utf8' };
          if (pl && typeof pl.hex === 'string' && pl.hex.length >= 2) return { line: li, p: p, enc: 'hex' };
        }
      }
    }
    return null;
  }

  /** @returns {{ input, change } | { disabled: true, why }} */
  function tamper(input, mode, deps) {
    var P = deps.P;
    var obj = JSON.parse(JSON.stringify(input.batch.obj));
    var origText = textOf(P, input.batch.obj);
    var change = null, ledger = input.batch.ledgerSha256;
    var ivs = obj.intervals || [];
    var k = middle(ivs, function (r) { return P.evidence.basisMwh(r) > 0; });
    if (mode === 'raw') {
      if (!Object.prototype.hasOwnProperty.call(obj, 'samples_root') || !Array.isArray(input.raw) || !input.raw.length) {
        return { disabled: true, why: 'schema-1.0.0' };
      }
      var raw = JSON.parse(JSON.stringify(input.raw));
      var hit = rawTarget(raw);
      if (!hit) return { disabled: true, why: 'no-payload' };
      var pl = raw[hit.line].payloads[hit.p], at, c, nc;
      if (hit.enc === 'utf8') {
        at = Math.floor(pl.utf8.length / 2); c = pl.utf8.charAt(at); nc = c === 'x' ? 'y' : 'x';
        pl.utf8 = pl.utf8.slice(0, at) + nc + pl.utf8.slice(at + 1);
      } else {
        /* hex (Modbus frames): one hex digit of one byte, kept lowercase and whole bytes */
        at = Math.floor(pl.hex.length / 2); c = pl.hex.charAt(at); nc = c === 'f' ? '0' : (parseInt(c, 16) + 1).toString(16);
        pl.hex = pl.hex.slice(0, at) + nc + pl.hex.slice(at + 1);
      }
      var tin = Object.assign({}, input, { raw: raw });
      return { input: tin, change: { field: 'raw[' + hit.line + '].payloads[' + hit.p + ']', enc: hit.enc, pos: at, before: c, after: nc, bytes: 1 } };
    }
    if (mode === 'energy') {
      if (!ivs.length) return { disabled: true, why: 'no-intervals' };
      var m = ivs[k].meters, which = m.b != null && m.b.mwh <= m.a.mwh ? 'b' : 'a';
      var before = m[which].mwh;
      m[which].mwh = bumpLastDigit(before);
      change = { field: 'intervals[' + k + '].meters.' + which + '.mwh', before: String(before), after: String(m[which].mwh), interval: ivs[k].seq };
    } else if (mode === 'prev') {
      var pos = 31, ch = obj.prev_hash.charAt(pos), nch = ch === 'f' ? '0' : (parseInt(ch, 16) + 1).toString(16);
      obj.prev_hash = obj.prev_hash.slice(0, pos) + nch + obj.prev_hash.slice(pos + 1);
      change = { field: 'prev_hash', pos: pos, before: ch, after: nch };
    } else if (mode === 'total') {
      var t0 = obj.cumulative_mwh;
      obj.cumulative_mwh = bumpLastDigit(t0);
      change = { field: 'cumulative_mwh', before: String(t0), after: String(obj.cumulative_mwh) };
    } else if (mode === 'time') {
      if (!ivs.length) return { disabled: true, why: 'no-intervals' };
      var ts = ivs[k].ts_start, p = 15, d = ts.charAt(p), nd = String((+d + 1) % 10);   // the units digit of the minutes
      ivs[k].ts_start = ts.slice(0, p) + nd + ts.slice(p + 1);
      change = { field: 'intervals[' + k + '].ts_start', pos: p, before: d, after: nd, interval: ivs[k].seq };
    } else if (mode === 'forger') {
      if (!ivs.length) return { disabled: true, why: 'no-intervals' };
      var mm = ivs[0].meters, was = 'A ' + mm.a.mwh + (mm.b ? ' · B ' + mm.b.mwh : '');
      /* a careful forger keeps each record consistent: +1000 mWh on both meters, and the mean power to match */
      var dw = Math.round(1000 * 3600 / (ivs[0].dt_s || 300));
      mm.a.mwh += 1000; if (mm.a.mw_mean != null) mm.a.mw_mean += dw;
      if (mm.b) { mm.b.mwh += 1000; if (mm.b.mw_mean != null) mm.b.mw_mean += dw; }
      obj.energy_mwh = ivs.reduce(function (s, r) { return s + P.evidence.basisMwh(r); }, 0);
      var prevTotal = input.context.prev ? input.context.prev.cumulative_mwh : 0;
      obj.cumulative_mwh = prevTotal + (input.status === 'rejected' ? 0 : obj.energy_mwh);
      obj.intervals_root = P.evidence.merkleRoot(ivs);
      obj.sha256 = P.evidence.batchSha256(obj);
      ledger = obj.sha256;     // the forger rewrites the register line too: it is their own feed
      change = { field: 'intervals[0].meters', before: was, after: 'A ' + mm.a.mwh + (mm.b ? ' · B ' + mm.b.mwh : ''), forged: true, interval: ivs[0].seq,
        recomputed: ['energy_mwh', 'cumulative_mwh', 'intervals_root', 'sha256'] };
    } else throw new Error('qwatt-verify-steps: unknown tamper mode ' + mode);
    var text = textOf(P, obj);
    change.bytes = diffBytes(origText, text);
    var out = Object.assign({}, input, { batch: { text: text, obj: obj, ledgerSha256: ledger } });
    return { input: out, change: change };
  }

  /* ───────────────────────────── summaries ───────────────────────────── */

  function summary(rows) {
    var s = { ok: 0, fail: 0, na: 0, wait: 0, offline: 0, planned: 0, refused: 0, total: rows.length };
    rows.forEach(function (r) { if (s[r.state] != null) s[r.state]++; });
    return s;
  }
  /** Rows that are red now and were not red before the change. */
  function compare(before, after) {
    var was = {};
    before.forEach(function (r) { was[r.n] = r.state; });
    return after.filter(function (r) { return r.state === 'fail' && was[r.n] !== 'fail'; }).map(function (r) { return r.n; }).sort(function (a, b) { return a - b; });
  }
  /** Which explanation the careful forger's result needs (copy in DESIGN §5.2). */
  function forgerCase(input) {
    if (input.anchored) return 'anchored';
    return input.next ? 'unanchored' : 'newest-unanchored';
  }
  /** The code that ran: each embedded source, the SHA-256 shim and the gate engine with its spec binding
      (loaded before the build), each with its SHA-256 and its file on GitHub. */
  function provenance(P) {
    var out = (P.sources || []).map(function (s) { return { path: s.path, sha256: s.sha256, bytes: s.bytes, url: GITHUB + s.path }; });
    if (P.shim && P.shim.path) out.push({ path: P.shim.path, sha256: P.shim.sha256, url: GITHUB + P.shim.path, role: 'shim' });
    (P.external || []).forEach(function (x) { out.push({ path: x.path, sha256: x.sha256, url: GITHUB + x.path, role: 'external' }); });
    return out;
  }

  return { run: run, tamper: tamper, summary: summary, compare: compare, forgerCase: forgerCase, provenance: provenance, MODES: MODES, ZERO: ZERO };
}));
