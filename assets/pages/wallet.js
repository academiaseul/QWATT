/**
 * QWATT · wallet.html — "Cuentas y firmas: quién puede firmar qué"
 * ---------------------------------------------------------------------------
 * Reads three public testnet accounts (the two August accounts and the 8 Oct
 * rehearsal account) through QWATT_LIVE, and the anchoring-account slot from
 * assets/status.json. Shows signers, thresholds, home_domain, QWATT trustline
 * yes/no, last transaction and the count since 19 Oct; computes how many keys
 * each kind of transaction needs; and a local picker that applies the planned
 * 2/2/3 rules. Read-only: nothing is signed, sent or stored. No amounts, ever.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE, L = root.QWATT_LIVE;
  if (!d || !S || !L) return;
  var C = L.CONFIG, pair = S.pair, esc = S.esc, num = S.num, badge = S.badge;

  var T = {
    addr: { es: 'Dirección pública', en: 'Public address' },
    signers: { es: 'Firmantes con peso', en: 'Signers with weight' },
    master: { es: 'Clave maestra', en: 'Master key' },
    weight: { es: 'peso', en: 'weight' },
    masterOff: { es: 'peso 0: desactivada', en: 'weight 0: switched off' },
    thresholds: { es: 'Umbrales bajo/medio/alto', en: 'Thresholds low/medium/high' },
    notSet: { es: 'no configurado', en: 'not set' },
    trust: { es: 'Línea de confianza QWATT', en: 'QWATT trustline' },
    yesW: { es: 'sí', en: 'yes' },
    noW: { es: 'no', en: 'no' },
    lastTx: { es: 'Última transacción', en: 'Last transaction' },
    since: { es: 'Transacciones desde el 19 oct', en: 'Transactions since 19 Oct' },
    oneKey: { es: '¿Una sola clave puede enviar una transacción?', en: 'Can a single key send a transaction?' },
    itself: { es: 'la cuenta misma (clave maestra)', en: 'the account itself (master key)' },
    proposer: { es: 'proponente del ensayo', en: 'rehearsal proposer' },
    verifier: { es: 'verificador del ensayo', en: 'rehearsal verifier' },
    third: { es: 'tercer firmante del ensayo (clave desechable)', en: 'rehearsal third signer (throwaway key)' },
    explorer: { es: 'Ver la cuenta en stellar.expert', en: 'View the account on stellar.expert' },
    yes: { es: 'SÍ', en: 'YES' },
    no: { es: 'NO', en: 'NO' },
    augShort: { es: 'Cuentas de agosto', en: 'August accounts' },
    rehShort: { es: 'Ensayo 8 oct', en: '8 Oct rehearsal' },
    ancShort: { es: 'Cuenta de anclaje 2 de 3', en: '2-of-3 anchoring account' },
    augSmall: { es: 'umbrales {t} · {n} clave con peso', en: 'thresholds {t} · {n} key with weight' },
    rehSmall: { es: 'umbrales {t} · basta una clave para el umbral bajo', en: 'thresholds {t} · one key meets the low threshold' },
    ancSmall: { es: 'objetivo 2/2/3 · en preparación (semana 2)', en: 'target 2/2/3 · in preparation (week 2)' },
    ancLive: { es: 'umbrales leídos ahora: {t}', en: 'thresholds read now: {t}' },
    goal: { es: '○ OBJETIVO', en: '○ TARGET' },
    ok: { es: '✓ CORRECTO', en: '✓ CORRECT' },
    fail: { es: '✗ FALLA', en: '✗ FAILS' },
    goalNo: { es: '○ OBJETIVO: NO', en: '○ TARGET: NO' },
    c223: { es: 'umbrales 2/2/3', en: 'thresholds 2/2/3' },
    cMaster: { es: 'clave maestra en peso 0', en: 'master key at weight 0' },
    cThree: { es: 'exactamente tres firmantes de peso 1', en: 'exactly three signers of weight 1' },
    cRoles: { es: 'el proponente, el verificador y el firmante externo, entre los firmantes', en: 'the proposer, the verifier and the outside signer among the signers' },
    cTrust: { es: 'línea de confianza QWATT (para el pago marcador)', en: 'QWATT trustline (for the marker payment)' },
    cRolesLater: { es: 'firmantes por rol: se comprobarán con las claves públicas del feed (semana 2)', en: 'signers by role: checked against the feed\'s public keys (week 2)' },
    plan: { es: 'en preparación (semana 2)', en: 'in preparation (week 2)' },
    keys: { es: '{n} de {m}', en: '{n} of {m}' },
    keysOne: { es: '1 clave', en: '1 key' },
    keysMany: { es: '{n} claves', en: '{n} keys' },
    keysNone: { es: 'imposible', en: 'impossible' },
    thLabel: { es: 'umbral {t}', en: 'threshold {t}' },
    verdictYes: { es: 'Una sola clave puede enviar una transacción de umbral bajo (por ejemplo, subir el número de secuencia): SÍ. Por eso el 21 oct elegimos 2/2/3 para la cuenta definitiva.', en: 'A single key can send a low-threshold transaction (for example, bumping the sequence number): YES. That is why on 21 Oct we chose 2/2/3 for the real account.' },
    verdictNo: { es: 'Una sola clave puede enviar una transacción de umbral bajo: NO, según lo leído ahora (la cuenta cambió desde el ensayo).', en: 'A single key can send a low-threshold transaction: NO, as read now (the account changed since the rehearsal).' },
    offline: { es: 'No pudimos leer Horizon testnet ({t}). Reintentando en 30 s.', en: 'Could not read Horizon testnet ({t}). Retrying in 30 s.' }
  };

  function state(kind, words) { return '<span class="q-state" data-state="' + kind + '">' + pair(words) + '</span>'; }
  function hhmm() { return S.fmtTime().slice(0, 5); }
  function errHTML(e) {
    var code = (e && e.code) || 'offline';
    var key = code === 'rate-limited' ? 'limited' : code === 'not-found' ? 'notFound' : code === 'wrong-network' ? 'wrongNet' : 'offline';
    return '<p class="q-err" role="status" data-kind="' + esc(code) + '">' + pair(key, { t: hhmm() }) + '</p>';
  }
  function loadingHTML() { return '<p class="q-fallback is-loading"><span class="q-skel" aria-hidden="true"></span> ' + pair('reading') + '</p>'; }
  function vivo() { return badge('vivo', { t: S.fmtTime() }); }
  function thr(a) { return a.thresholds.low + '/' + a.thresholds.med + '/' + a.thresholds.high; }
  function accountKey(path) {
    var v = path.split('.').reduce(function (o, k) { return o && o[k]; }, C);
    return typeof v === 'string' ? v : v && v.account;
  }
  function tomorrow() { return new Date(Date.now() + 86400000).toISOString(); }

  /** Fewest signers whose weights add up to the threshold (a threshold of 0 still needs one signer). */
  function keysNeeded(a, t) {
    var need = Math.max(t, 1);
    var ws = a.signers.map(function (s) { return s.weight; }).filter(function (w) { return w > 0; }).sort(function (x, y) { return y - x; });
    var sum = 0;
    for (var i = 0; i < ws.length; i++) { sum += ws[i]; if (sum >= need) return i + 1; }
    return null;
  }

  var state0 = { accts: {}, roles: {}, anchor: null, target: { low: 2, med: 2, high: 3 }, error: null, timer: null };

  function readAccount(g) {
    return Promise.all([
      L.account(g),
      L.txs(g, { limit: 1 }).catch(function () { return []; }),
      L.txCount(g, C.SPRINT_START, tomorrow()).catch(function () { return null; })
    ]).then(function (r) { return { g: g, a: r[0], last: r[1][0] || null, since: r[2] }; });
  }

  /* ───────────── account card ───────────── */
  function signersHTML(r) {
    var a = r.a;
    var list = a.signers.filter(function (s) { return s.weight > 0; }).map(function (s) {
      var role = s.key === a.id ? T.itself : state0.roles[s.key] || null;
      return '<li><code translate="no">' + esc(S.shortKey(s.key)) + '</code> · ' + pair(T.weight) + ' ' + num(String(s.weight), 'vivo') +
        (role ? '<span class="q-role">' + pair(role) + '</span>' : '') + '</li>';
    }).join('');
    return '<ul class="q-signers">' + list + '</ul>';
  }
  function cardHTML(r, el) {
    var a = r.a;
    if (!a.exists) return errHTML({ code: 'not-found' });
    var one = L.canOneKeySend(a);
    var link = el.hasAttribute('data-explorer')
      ? ' <a class="q-link" href="' + esc(C.EXPLORER + '/account/' + r.g) + '" target="_blank" rel="noopener">' + pair(T.explorer) + '<span class="q-ext" aria-hidden="true">↗</span><span class="q-vh">' + pair('newTab') + '</span></a>' : '';
    return '<p class="q-key-line"><code translate="no">' + esc(S.shortKey(r.g)) + '</code>' +
      '<button type="button" class="q-btn is-small" data-copy="" data-copy-text="' + esc(r.g) + '">' + pair('copy') + '</button>' + link + '</p>' +
      '<dl class="q-dl">' +
      '<dt>' + pair(T.signers) + '</dt><dd>' + signersHTML(r) + '</dd>' +
      '<dt>' + pair(T.master) + '</dt><dd>' + (a.masterWeight === 0 ? pair(T.masterOff) : pair(T.weight) + ' ' + num(String(a.masterWeight), 'vivo')) + '</dd>' +
      '<dt>' + pair(T.thresholds) + '</dt><dd>' + num(thr(a), 'vivo') + '</dd>' +
      '<dt translate="no">home_domain</dt><dd>' + (a.homeDomain ? '<code translate="no">' + esc(a.homeDomain) + '</code>' : pair(T.notSet)) + '</dd>' +
      '<dt>' + pair(T.trust) + '</dt><dd>' + pair(a.hasQwattTrustline ? T.yesW : T.noW) + '</dd>' +
      '<dt>' + pair(T.lastTx) + '</dt><dd>' + (r.last ? esc(S.fmtDate(r.last.createdAt)) : '—') + '</dd>' +
      '<dt>' + pair(T.since) + '</dt><dd>' + (r.since ? num(String(r.since.count), 'vivo') : '—') + '</dd>' +
      '<dt>' + pair(T.oneKey) + '</dt><dd>' + (one ? state('fail', T.yes) : state('ok', T.no)) + '</dd>' +
      '</dl>' + vivo();
  }

  /* ───────────── anchoring account ───────────── */
  function anchorHTML() {
    if (!C.ANCHOR_ACCOUNT) {
      var goal = function (w) { return '<li>' + state('goal', T.goal) + pair(w) + '</li>'; };
      return '<p class="q-tile-v q-plan">' + pair(T.plan) + '</p><ul class="q-checks">' +
        goal(T.c223) + goal(T.cMaster) + goal(T.cThree) + goal(T.cRoles) + goal(T.cTrust) + '</ul>' + badge('plan');
    }
    var r = state0.anchor;
    if (!r) return loadingHTML();
    var a = r.a;
    if (!a.exists) return errHTML({ code: 'not-found' });
    var c = L.check223(a);
    var row = function (ok, w) { return '<li>' + state(ok ? 'ok' : 'fail', ok ? T.ok : T.fail) + pair(w) + '</li>'; };
    return '<p class="q-key-line"><code translate="no">' + esc(S.shortKey(r.g)) + '</code><button type="button" class="q-btn is-small" data-copy="" data-copy-text="' + esc(r.g) + '">' + pair('copy') + '</button></p>' +
      '<ul class="q-checks">' + row(c.low2 && c.med2 && c.high3, T.c223) + row(c.masterZero, T.cMaster) + row(c.threeSignersW1, T.cThree) +
      row(a.hasQwattTrustline, T.cTrust) + '<li>' + state('goal', T.goal) + pair(T.cRolesLater) + '</li></ul>' +
      '<p class="q-tile-s">' + pair(T.ancLive, { t: thr(a) }) + '</p>' + vivo();
  }

  /* ───────────── hero: the short answer ───────────── */
  function shortHTML() {
    var A = state0.accts;
    var aug = A['AUGUST.assetAccount'], mk = A['AUGUST.markerDestination'], reh = A['REHEARSAL.abcd'];
    if (state0.error && !aug) return errHTML(state0.error) + '<p class="q-lc-anchor">' + pair(T.ancShort) + ': ' + pair(T.plan) + '</p>';
    if (!aug || !reh) return loadingHTML();
    var augOne = aug.a.exists && L.canOneKeySend(aug.a) && (!mk || !mk.a.exists || L.canOneKeySend(mk.a));
    var augKeys = aug.a.exists ? aug.a.signers.filter(function (s) { return s.weight > 0; }).length : 0;
    var rehOne = reh.a.exists && L.canOneKeySend(reh.a);
    var anc;
    if (C.ANCHOR_ACCOUNT && state0.anchor && state0.anchor.a.exists) {
      var one = L.canOneKeySend(state0.anchor.a);
      anc = '<li><span class="q-sk">' + pair(T.ancShort) + '<small>' + pair(T.ancLive, { t: thr(state0.anchor.a) }) + '</small></span>' + (one ? state('fail', T.yes) : state('ok', T.no)) + '</li>';
    } else {
      anc = '<li><span class="q-sk">' + pair(T.ancShort) + '<small>' + pair(T.ancSmall) + '</small></span>' + state('goal', T.goalNo) + '</li>';
    }
    return '<ul class="q-short">' +
      '<li><span class="q-sk">' + pair(T.augShort) + '<small>' + (aug.a.exists ? pair(T.augSmall, { t: thr(aug.a), n: augKeys }) : pair('notFound')) + '</small></span>' + (augOne ? state('fail', T.yes) : state('ok', T.no)) + '</li>' +
      '<li><span class="q-sk">' + pair(T.rehShort) + '<small>' + (reh.a.exists ? pair(T.rehSmall, { t: thr(reh.a) }) : pair('notFound')) + '</small></span>' + (rehOne ? state('fail', T.yes) : state('ok', T.no)) + '</li>' +
      anc + '</ul>' + vivo() + (state0.error ? errHTML(state0.error) : '');
  }

  /* ───────────── keys table ───────────── */
  function cell(a, t) {
    if (!a || !a.exists) return '—';
    var n = keysNeeded(a, t);
    if (n == null) return pair(T.keysNone);
    var total = a.signers.filter(function (s) { return s.weight > 0; }).length;
    return num(String(n), 'vivo') + ' <small>' + pair(n === 1 ? T.keysOne : T.keysMany, { n: n }) + (total > 1 ? ' · ' + pair(T.keys, { n: n, m: total }) : '') + ' · ' + pair(T.thLabel, { t: t }) + '</small>';
  }
  function fillKeys() {
    var tb = d.getElementById('wKeys'); if (!tb) return;
    var A = state0.accts, aug = A['AUGUST.assetAccount'], reh = A['REHEARSAL.abcd'];
    var th = state0.target;
    ['low', 'med', 'high'].forEach(function (k) {
      var row = tb.querySelector('tr[data-row="' + k + '"]'); if (!row) return;
      if (aug) row.querySelector('[data-col="aug"]').innerHTML = cell(aug.a, aug.a.exists ? aug.a.thresholds[k] : 0);
      if (reh) row.querySelector('[data-col="reh"]').innerHTML = cell(reh.a, reh.a.exists ? reh.a.thresholds[k] : 0);
      var anc = state0.anchor && state0.anchor.a.exists ? state0.anchor.a : null;
      row.querySelector('[data-col="plan"]').innerHTML = anc ? cell(anc, anc.thresholds[k])
        : num(String(th[k]), 'plan') + ' <small>' + pair(T.keys, { n: th[k], m: 3 }) + ' · ' + pair(T.thLabel, { t: th[k] }) + '</small>';
    });
  }

  function render() {
    var cards = d.querySelectorAll('[data-acct]');
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i], k = el.getAttribute('data-acct'), slot = el.querySelector('[data-slot]');
      if (!slot) continue;
      if (k === 'anchor') { slot.innerHTML = anchorHTML(); continue; }
      var r = state0.accts[k];
      slot.innerHTML = r ? cardHTML(r, el) + (state0.error ? errHTML(state0.error) : '') : state0.error ? errHTML(state0.error) : loadingHTML();
    }
    var reh = state0.accts['REHEARSAL.abcd'], v = d.getElementById('wRehearsalVerdict');
    if (v && reh && reh.a.exists) v.innerHTML = pair(L.canOneKeySend(reh.a) ? T.verdictYes : T.verdictNo);
    var sh = d.getElementById('wShort'); if (sh) sh.innerHTML = shortHTML();
    fillKeys();
  }

  function load() {
    clearTimeout(state0.timer);
    var keys = ['AUGUST.assetAccount', 'AUGUST.markerDestination', 'REHEARSAL.abcd'];
    return L.ready().then(function () {
      var Q = root.QWATT_STATUS;
      if (Q && Q.load) Q.load().then(function (s) { if (s && s.anchor && s.anchor.target) { state0.target = s.anchor.target; fillKeys(); } }, function () { /* keep the built-in target */ });
      return L.network();
    }).then(function () {
      var ev = L.evidence(C.REHEARSAL.abcd.evidence).then(function (e) {
        var pk = (e && e.public_keys) || {};
        if (pk.proposer) state0.roles[pk.proposer] = T.proposer;
        if (pk.verifier) state0.roles[pk.verifier] = T.verifier;
        if (pk.third) state0.roles[pk.third] = T.third;
      }, function () { /* roles stay unnamed */ });
      var reads = keys.map(function (k) { return readAccount(accountKey(k)).then(function (r) { state0.accts[k] = r; }); });
      if (C.ANCHOR_ACCOUNT) reads.push(readAccount(C.ANCHOR_ACCOUNT).then(function (r) { state0.anchor = r; }));
      return Promise.all(reads.concat([ev]));
    }).then(function () {
      state0.error = null; render();
      state0.timer = setTimeout(function again() { if (d.hidden) { state0.timer = setTimeout(again, 5000); return; } load(); }, 60000);
    }, function (e) {
      state0.error = e || { code: 'offline' }; render();
      if (e && e.code === 'wrong-network') return;
      state0.timer = setTimeout(load, e && e.code === 'rate-limited' ? 60000 : 30000);
    });
  }

  /* ───────────── picker: the planned 2/2/3 rules, applied locally ───────────── */
  var P = {
    none: { es: 'Ninguna firma: la red no acepta la transacción.', en: 'No signature: the network does not accept the transaction.' },
    send: { es: 'Enviar cualquier transacción de la cuenta (umbral bajo {t})', en: 'Send any transaction for the account (low threshold {t})' },
    anchor: { es: 'Anclar: huella, total y pago marcador (umbral medio {t})', en: 'Anchor: fingerprint, total and marker payment (medium threshold {t})' },
    change: { es: 'Cambiar firmantes o umbrales (umbral alto {t})', en: 'Change signers or thresholds (high threshold {t})' },
    accepted: { es: '✓ LA RED LO ACEPTA', en: '✓ THE NETWORK ACCEPTS' },
    txBad: { es: '⊘ RECHAZADA · tx_bad_auth', en: '⊘ REFUSED · tx_bad_auth' },
    opBad: { es: '⊘ RECHAZADA · op_bad_auth', en: '⊘ REFUSED · op_bad_auth' },
    normal: { es: 'Conciliación: NORMAL. Proponente + verificador anclan; es lo normal.', en: 'Reconciliation: NORMAL. Proposer + verifier anchor; this is the normal case.' },
    standin: { es: 'Conciliación: SUPLENTE. Proponente + firmante externo anclan cuando el verificador está caído.', en: 'Reconciliation: STAND-IN. Proposer + outside signer anchor when the verifier is down.' },
    broken: { es: 'Conciliación: ROTO. La red lo acepta, pero no es una pareja acordada.', en: 'Reconciliation: BROKEN. The network accepts it, but it is not an agreed pair.' },
    all3: { es: 'Las tres juntas pueden cambiar los firmantes y los umbrales. Nadie más.', en: 'All three together can change the signers and the thresholds. Nobody else can.' },
    one: { es: 'Una clave sola, cualquiera de las tres: no puede anclar y ni siquiera puede subir el número de secuencia.', en: 'One key alone, any of the three: it cannot anchor and cannot even bump the sequence number.' }
  };
  function pick() {
    var out = d.getElementById('wPickOut'); if (!out) return;
    var on = Array.prototype.filter.call(d.querySelectorAll('.q-key'), function (b) { return b.getAttribute('aria-pressed') === 'true'; }).map(function (b) { return b.getAttribute('data-key'); });
    var n = on.length, th = state0.target;
    var lowOk = n >= th.low, medOk = n >= th.med, highOk = n >= th.high;
    var row = function (ok, okWords, badWords, label) { return '<li>' + state(ok ? 'ok' : 'fail', ok ? okWords : badWords) + pair(label.w, label.v) + '</li>'; };
    var html = '<ul class="q-checks">';
    if (!n) html += '<li>' + state('fail', P.txBad) + pair(P.none) + '</li>';
    else {
      html += row(lowOk, P.accepted, P.txBad, { w: P.send, v: { t: th.low } });
      html += row(lowOk && medOk, P.accepted, lowOk ? P.opBad : P.txBad, { w: P.anchor, v: { t: th.med } });
      html += row(lowOk && highOk, P.accepted, lowOk ? P.opBad : P.txBad, { w: P.change, v: { t: th.high } });
    }
    html += '</ul>';
    var note = null;
    if (n === 1) note = P.one;
    else if (n === 2) note = on.indexOf('p') >= 0 && on.indexOf('v') >= 0 ? P.normal : on.indexOf('p') >= 0 && on.indexOf('x') >= 0 ? P.standin : P.broken;
    else if (n === 3) note = P.all3;
    out.innerHTML = html + (note ? '<p class="q-note">' + pair(note) + '</p>' : '');
  }

  function start() {
    render();
    load();
    pick();
    d.addEventListener('click', function (e) {
      var k = e.target.closest && e.target.closest('.q-key');
      if (k) { k.setAttribute('aria-pressed', k.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); pick(); return; }
      if (e.target.closest && e.target.closest('#wRefresh')) load();
    });
    d.addEventListener('visibilitychange', function () {
      if (d.hidden) L.pause(); else L.resume();
      var p = d.querySelectorAll('[data-paused-note]');
      for (var j = 0; j < p.length; j++) p[j].hidden = !d.hidden;
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
