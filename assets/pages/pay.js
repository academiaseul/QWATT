/**
 * QWATT · pay.html — "Cómo se confirma una transacción"
 * ---------------------------------------------------------------------------
 * The network live: latest ledger, average close interval, successful and failed
 * transactions per ledger, protocol version, and a stream of ledgers as they close
 * (QWATT_LIVE.streamLedgers). Then the life of one real anchoring transaction
 * (test C of the 8 Oct rehearsal), with steps 5 and 6 read now from Horizon and
 * each signature identified in the browser: Ed25519 over the transaction hash,
 * checked with WebCrypto against the public keys of the published evidence file.
 * Read-only. Never shows fees, coin totals or amounts.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE, L = root.QWATT_LIVE;
  if (!d || !S || !L) return;
  var C = L.CONFIG, pair = S.pair, esc = S.esc, num = S.num, badge = S.badge;

  var T = {
    closed: { es: 'cerrado ', en: 'closed ' },
    avgOf: { es: 'en los últimos {n} ledgers, medido ahora', en: 'over the last {n} ledgers, measured now' },
    lastLedger: { es: 'en el último ledger · promedio de {n}: {ok} y {f}', en: 'in the latest ledger · average of {n}: {ok} and {f}' },
    okFail: { es: '{ok} exitosas · {f} fallidas', en: '{ok} successful · {f} failed' },
    proto: { es: 'la versión de las reglas de la red en el último ledger', en: 'the version of the network rules in the latest ledger' },
    streamSrc: { es: 'En vivo · Stellar testnet · última fila {t}', en: 'Live · Stellar testnet · latest row {t}' },
    pollNote: { es: 'Sin transmisión en vivo: consultamos cada 6 s (solo número y hora del ledger).', en: 'No live stream: we poll every 6 s (ledger number and time only).' },
    batch: { es: 'Lote #0 del ensayo · huella {h} · total {m} mWh', en: 'Rehearsal batch #0 · fingerprint {h} · total {m} mWh' },
    ab: { es: 'Prueba A: {a} firma · {ac}. Prueba B: {b} firma · {bc}. Con 1/2/3 una firma alcanzaba el umbral bajo y la red rechazó la operación de anclaje; con 2/2/3 responderá tx_bad_auth.', en: 'Test A: {a} signature · {ac}. Test B: {b} signature · {bc}. Under 1/2/3 one signature met the low threshold and the network refused the anchoring operation; under 2/2/3 it will answer tx_bad_auth.' },
    dRow: { es: 'Prueba D: {r} · nada enviado', en: 'Test D: {r} · nothing submitted' },
    ledger: { es: 'Prueba C (QW#0) entró en el ledger {l}, el {d} a las {t} UTC.', en: 'Test C (QW#0) entered ledger {l}, on {d} at {t} UTC.' },
    next: { es: 'La prueba L (QW#1) entró en el ledger siguiente, {l}, {s} s después.', en: 'Test L (QW#1) entered the next ledger, {l}, {s} s later.' },
    nextGap: { es: 'La prueba L (QW#1) entró en el ledger {l}, {s} s después.', en: 'Test L (QW#1) entered ledger {l}, {s} s later.' },
    sigValid: { es: '✓ FIRMA VÁLIDA', en: '✓ VALID SIGNATURE' },
    sigUnknown: { es: '✗ NO ES DE UN FIRMANTE', en: '✗ NOT A SIGNER' },
    proposer: { es: 'el proponente del ensayo', en: 'the rehearsal proposer' },
    verifier: { es: 'el verificador del ensayo', en: 'the rehearsal verifier' },
    third: { es: 'el tercer firmante del ensayo (clave desechable)', en: 'the rehearsal third signer (throwaway key)' },
    sigCount: { es: ' firmas en Stellar testnet', en: ' signatures on Stellar testnet' },
    sigHow: { es: 'Comprobado en tu navegador: Ed25519 sobre la huella de la transacción, con WebCrypto, contra las claves públicas del archivo de evidencia.', en: 'Checked in your browser: Ed25519 over the transaction hash, with WebCrypto, against the public keys in the evidence file.' },
    noEd: { es: 'Tu navegador no puede verificar firmas Ed25519; mostramos cuántas firmas tiene. Usa un navegador actual o node anchor/reconcile-cli.js.', en: 'Your browser cannot verify Ed25519 signatures; we show how many there are. Use a current browser or node anchor/reconcile-cli.js.' },
    sigShort: { es: 'Firmaron: {who}', en: 'Signed by: {who}' },
    and: { es: ' y ', en: ' and ' }
  };
  var ROLE_WORDS = { proposer: T.proposer, verifier: T.verifier, third: T.third };

  function state(kind, words) { return '<span class="q-state" data-state="' + kind + '">' + pair(words) + '</span>'; }
  function hhmm() { return S.fmtTime().slice(0, 5); }
  function errHTML(e) {
    var code = (e && e.code) || 'offline';
    var key = code === 'rate-limited' ? 'limited' : code === 'not-found' ? 'notFound' : code === 'wrong-network' ? 'wrongNet' : 'offline';
    return '<p class="q-err" role="status" data-kind="' + esc(code) + '">' + pair(key, { t: hhmm() }) + '</p>';
  }
  function loadingHTML() { return '<p class="q-fallback is-loading"><span class="q-skel" aria-hidden="true"></span> ' + pair('reading') + '</p>'; }
  function vivo() { return badge('vivo', { t: S.fmtTime() }); }
  function dec(x, n) { var s = x.toFixed(n); return S.lang() === 'en' ? s : s.replace('.', ','); }
  function utc(iso) { return iso ? iso.slice(11, 19) : '—'; }
  /** Like pair(), but the {vars} are ready-made HTML (numbers with their source, codes). */
  function tpl(o, vars) {
    var f = function (s) { return esc(s).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }); };
    return '<span data-l="es">' + f(o.es) + '</span><span data-l="en">' + f(o.en) + '</span>';
  }
  function code(s) { return '<code translate="no">' + esc(s) + '</code>'; }

  /* ───────────── the network live ───────────── */
  var net = { ls: [], polled: false, error: null, stop: null, retry: null };
  function slot(name) { var t = d.getElementById('pTiles'); return t && t.querySelector('[data-slot="' + name + '"]'); }
  function gaps() {
    var out = [];
    for (var i = 1; i < net.ls.length; i++) {
      var g = (Date.parse(net.ls[i - 1].closedAt) - Date.parse(net.ls[i].closedAt)) / 1000 / Math.max(1, net.ls[i - 1].sequence - net.ls[i].sequence);
      if (g > 0 && g < 120) out.push(g);
    }
    return out;
  }
  function renderNet() {
    var s = { seq: slot('seq'), avg: slot('avg'), tx: slot('tx'), proto: slot('proto') };
    var body = d.getElementById('pStream');
    if (!net.ls.length) {
      var h = net.error ? errHTML(net.error) : loadingHTML();
      Object.keys(s).forEach(function (k) { if (s[k]) s[k].innerHTML = h; });
      if (body && net.error) body.innerHTML = '<tr><td colspan="6">' + errHTML(net.error) + '</td></tr>';
      return;
    }
    var top = net.ls[0], gs = gaps();
    var avg = gs.length ? gs.reduce(function (a, b) { return a + b; }, 0) / gs.length : null;
    var full = net.ls.filter(function (l) { return l.okTx != null; });
    var okAvg = full.length ? full.reduce(function (a, l) { return a + l.okTx; }, 0) / full.length : null;
    var fAvg = full.length ? full.reduce(function (a, l) { return a + l.failTx; }, 0) / full.length : null;
    var err = net.error ? errHTML(net.error) : '';
    if (s.seq) s.seq.innerHTML = '<p class="q-tile-v">' + num(S.fmtNum(top.sequence), 'vivo') + '</p><p class="q-tile-s">' + pair(T.closed) +
      '<span data-ago="' + esc(top.closedAt || '') + '">' + pair('agoS', { n: 0 }) + '</span></p>' + vivo() + err;
    if (s.avg) s.avg.innerHTML = avg ? '<p class="q-tile-v">' + num(dec(avg, 1), 'vivo') + ' <small>s</small></p><p class="q-tile-s">' + pair(T.avgOf, { n: gs.length + 1 }) + '</p>' + vivo() : loadingHTML();
    var last = full[0];
    if (s.tx) s.tx.innerHTML = last ? '<p class="q-tile-v">' + num(String(last.okTx), 'vivo') + ' <small>/</small> ' + num(String(last.failTx), 'vivo') + '</p><p class="q-tile-s">' +
      pair(T.lastLedger, { n: full.length, ok: dec(okAvg, 1), f: dec(fAvg, 1) }) + '</p>' + vivo() : loadingHTML();
    var pv = (full[0] || {}).protocol;
    if (s.proto) s.proto.innerHTML = pv != null ? '<p class="q-tile-v">' + num(String(pv), 'vivo') + '</p><p class="q-tile-s">' + pair(T.proto) + '</p>' + vivo() : loadingHTML();
    if (body) {
      body.innerHTML = net.ls.slice(0, 10).map(function (l, i) {
        var nx = net.ls[i + 1];
        var g = nx ? (Date.parse(l.closedAt) - Date.parse(nx.closedAt)) / 1000 : null;
        var cell = function (v) { return v == null ? '—' : num(String(v), 'vivo'); };
        return '<tr' + (i === 0 && net.fresh ? ' class="is-new"' : '') + '><td>' + num(S.fmtNum(l.sequence), 'vivo') + '</td><td>' + esc(S.fmtTime(l.closedAt)) + '</td><td>' +
          (g != null && g > 0 && g < 120 ? num(dec(g, 1), 'vivo') : '—') + '</td><td>' + cell(l.okTx) + '</td><td>' + cell(l.failTx) + '</td><td>' + cell(l.ops) + '</td></tr>';
      }).join('');
    }
    var src = d.getElementById('pStreamSrc');
    if (src) src.innerHTML = pair(T.streamSrc, { t: S.fmtTime(top.closedAt) }) + (net.polled ? ' · ' + pair(T.pollNote) : '');
  }
  function push(l) {
    if (!l || l.sequence == null) return;
    if (net.ls.length && l.sequence <= net.ls[0].sequence) return;
    net.ls.unshift({ sequence: l.sequence, closedAt: l.closedAt, ops: l.ops, okTx: l.okTx, failTx: l.failTx, protocol: l.protocol });
    if (net.ls.length > 40) net.ls.length = 40;
    net.error = null; net.fresh = true; renderNet();
  }
  function startNet() {
    clearTimeout(net.retry);
    if (net.stop) { net.stop(); net.stop = null; }
    L.ready().then(function () { return L.network(); }).then(function () { return L.ledgers(20); }).then(function (ls) {
      net.ls = ls.slice(); net.error = null; net.fresh = false; renderNet();
      net.stop = L.streamLedgers(push, function (st) {
        if (st === 'poll') net.polled = true;
        else if (st === 'stream') net.polled = false;
        else { net.error = { code: st }; renderNet(); }
      });
    }, function (e) {
      net.error = e; renderNet();
      if (e && e.code === 'wrong-network') return;
      net.retry = setTimeout(startNet, e && e.code === 'rate-limited' ? 60000 : 30000);
    });
  }

  /* ───────────── Ed25519, in the browser ───────────── */
  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function pubBytes(g) {   // G… StrKey → the 32-byte public key (version byte and checksum dropped)
    var bits = 0, val = 0, out = [];
    for (var i = 0; i < g.length; i++) { val = (val << 5) | B32.indexOf(g[i]); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
    return new Uint8Array(out.slice(1, 33));
  }
  function hexBytes(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function b64Bytes(s) { var b = root.atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  var edSupport = null;
  function subtle() { return self.crypto && self.crypto.subtle ? self.crypto.subtle : null; }
  function keyFor(g) { return subtle().importKey('raw', pubBytes(g), { name: 'Ed25519' }, false, ['verify']); }
  function hasEd25519(anyKey) {
    if (edSupport) return edSupport;
    edSupport = !subtle() ? Promise.resolve(false) : keyFor(anyKey).then(function () { return true; }, function () { return false; });
    return edSupport;
  }
  /** For each signature of a transaction, the role whose key verifies it (or null). */
  function identify(t, roles) {
    var names = Object.keys(roles);
    return hasEd25519(roles[names[0]]).then(function (ok) {
      if (!ok) return null;
      var msg = hexBytes(t.hash);
      return Promise.all(names.map(function (n) { return keyFor(roles[n]).then(function (k) { return { n: n, k: k }; }); })).then(function (keys) {
        return Promise.all(t.signatures.map(function (sig) {
          var sb = b64Bytes(sig);
          return Promise.all(keys.map(function (x) { return subtle().verify({ name: 'Ed25519' }, x.k, sb, msg).then(function (v) { return v ? x.n : null; }, function () { return null; }); }))
            .then(function (hits) { return hits.filter(Boolean)[0] || null; });
        }));
      });
    });
  }
  function whoHTML(t, found, roles) {
    var count = num(String(t.signatures.length), 'vivo') + pair(T.sigCount);
    if (!found) return '<p class="q-tile-s">' + count + '</p><p class="q-note">' + pair(T.noEd) + '</p>';
    return '<ul class="q-checks">' + found.map(function (n) {
      return '<li>' + (n ? state('ok', T.sigValid) + pair(ROLE_WORDS[n]) + ' <code translate="no">' + esc(S.shortKey(roles[n])) + '</code>' : state('fail', T.sigUnknown)) + '</li>';
    }).join('') + '</ul><p class="q-tile-s">' + count + '</p><p class="q-note">' + pair(T.sigHow) + '</p>' + vivo();
  }

  /* ───────────── the life of test C ───────────── */
  var life = { retry: null };
  function fill(name, html) { var el = d.querySelector('[data-fill="' + name + '"]'); if (el) el.innerHTML = html; }
  function who(name, html) { var el = d.querySelector('[data-who="' + name + '"]'); if (el) el.innerHTML = html; }
  function codesOf(st) {
    if (!st || !st.codes) return '—';
    var c = st.codes;
    return [c.transaction].concat((c.operations || []).filter(function (x) { return x !== 'op_success'; })).filter(Boolean).join(' / ');
  }
  function runLife() {
    clearTimeout(life.retry);
    var R = C.REHEARSAL.abcd;
    var evP = L.ready().then(function () { return L.evidence(R.evidence); });
    evP.then(function (ev) {
      var b0 = (ev.batches || [])[0] || {};
      var src = badge('archivo', { p: R.evidence.replace(/^\//, '') });
      fill('batch', tpl(T.batch, { h: code(S.shortHash(b0.sha256)), m: num(S.fmtNum(b0.cumulative_mwh), 'ensayo') }) + badge('ensayo') + src);
      var s = ev.steps || {}, A = s.A_proposer_alone || {}, B = s.B_verifier_alone || {}, D = s.D_altered_after_proposer_signed || {};
      fill('ab', state('ok', { es: '⊘ RECHAZADAS, COMO SE ESPERABA', en: '⊘ REFUSED, AS EXPECTED' }) + ' ' + tpl(T.ab, { a: num(String(A.signatures), 'archivo'), ac: code(codesOf(A)), b: num(String(B.signatures), 'archivo'), bc: code(codesOf(B)) }) + src);
      var reasons = (D.reasons || []).filter(function (r) { return /^[a-z]+\.[a-z_]+$/.test(r); }).join(', ');
      fill('d', state('ok', { es: '⊘ RECHAZADO, COMO SE ESPERABA', en: '⊘ REFUSED, AS EXPECTED' }) + ' ' + tpl(T.dRow, { r: code(reasons || '—') }) + src);
    }, function () { /* steps 1–3 keep their static text */ });

    L.ready().then(function () { return L.network(); }).then(function () {
      return Promise.all([L.tx(R.testC), L.tx(R.testL), evP.catch(function () { return null; })]);
    }).then(function (r) {
      var c = r[0], l = r[1], ev = r[2];
      var gap = Math.round((Date.parse(l.createdAt) - Date.parse(c.createdAt)) / 1000);
      fill('ledger', tpl(T.ledger, { l: num(S.fmtNum(c.ledger), 'vivo'), d: esc(S.fmtDate(c.createdAt)), t: num(utc(c.createdAt), 'vivo') }) + ' ' +
        tpl(l.ledger === c.ledger + 1 ? T.next : T.nextGap, { l: num(S.fmtNum(l.ledger), 'vivo'), s: num(String(gap), 'vivo') }) + vivo());
      var pk = ev && ev.public_keys ? ev.public_keys : null;
      var roles = pk ? { proposer: pk.proposer, verifier: pk.verifier, third: pk.third } : null;
      if (!roles || !roles.proposer) { fill('sigs', num(String(c.signatures.length), 'vivo') + pair(T.sigCount) + vivo()); return; }
      return Promise.all([identify(c, roles), identify(l, roles)]).then(function (ids) {
        who('testC', whoHTML(c, ids[0], roles));
        who('testL', whoHTML(l, ids[1], roles));
        if (ids[0]) {
          var names = ids[0].filter(Boolean).map(function (n) { return ROLE_WORDS[n]; });
          var signed = {
            es: T.sigShort.es.replace('{who}', names.map(function (w) { return w.es; }).join(T.and.es)),
            en: T.sigShort.en.replace('{who}', names.map(function (w) { return w.en; }).join(T.and.en))
          };
          fill('sigs', state('ok', T.sigValid) + ' ' + pair(signed) + vivo());
        } else {
          fill('sigs', num(String(c.signatures.length), 'vivo') + pair(T.sigCount) + '<span class="q-note">' + pair(T.noEd) + '</span>');
        }
      }, function () {   // the signature check is extra: if it cannot run, show the count and say why
        fill('sigs', num(String(c.signatures.length), 'vivo') + pair(T.sigCount) + '<span class="q-note">' + pair(T.noEd) + '</span>');
      });
    }).catch(function (e) {
      fill('ledger', errHTML(e));
      if (e && e.code === 'wrong-network') return;
      life.retry = setTimeout(runLife, e && e.code === 'rate-limited' ? 60000 : 30000);
    });
  }

  /* ───────────── walk through the steps ───────────── */
  var playing = null;
  function play() {
    var steps = d.querySelectorAll('#pLife .q-step');
    clearTimeout(playing);
    for (var j = 0; j < steps.length; j++) steps[j].classList.remove('is-on');
    var i = 0;
    (function next() {
      if (i > 0) steps[i - 1].classList.remove('is-on');
      if (i >= steps.length) return;
      steps[i].classList.add('is-on');
      i++;
      playing = setTimeout(next, 1400);
    })();
  }

  function start() {
    startNet();
    runLife();
    d.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('#pPlay')) { play(); return; }
      if (e.target.closest && e.target.closest('[data-refresh]')) { startNet(); runLife(); }
    });
    S.onLang(function () { renderNet(); });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
