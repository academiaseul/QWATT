/**
 * QWATT · pruebas.html — tests A–D, judged again in the browser (DESIGN §12)
 * ---------------------------------------------------------------------------
 * Section 3: the 8 Oct rehearsal file and the end-to-end rehearsal file (same
 * origin) go through assets/qwatt-tests.js worked(): A's and B's body hash
 * recomputed from their signed envelopes, every signature identified by Ed25519
 * (assets/qwatt-envelope.js), transaction C read live from Horizon testnet.
 * Section 2 and the page state: when assets/status.json names the real anchoring
 * account, the page first reads that account on Horizon testnet (it must exist),
 * then looks for evidence/account/<G…>/abcd.json and judges it with model(),
 * without reading the file's verdict: the file must describe that account, C must
 * come from it, and the 2/2/3 setup is judged from the account as read now. The
 * TESTNET label appears only when that verdict is PASS. GET only; nothing is
 * signed, sent or stored.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE;
  if (!d || !S) return;
  var pair = S.pair, esc = S.esc, num = S.num, badge = S.badge;
  var L = root.QWATT_LIVE, Q = root.QWATT_STATUS, T = root.QWATT_TESTS, E = root.QWATT_ENVELOPE;
  var EXPLORER = 'https://stellar.expert/explorer/testnet';
  var ACCOUNT_DIR = '/evidence/' + 'account/';
  var DEFAULTS = { abcd: '/evidence/rehearsal/rehearsal-2026-10-08T20-46-13-037Z.json', independence: '/evidence/e2e/e2e-2026-10-08T20-50-44-831Z.json' };
  var $ = function (id) { return d.getElementById(id); };

  var STATE = {
    ok: { es: 'CORRECTO', en: 'CORRECT' }, fail: { es: 'FALLA', en: 'FAILS' }, refused: { es: 'RECHAZADO, COMO SE ESPERABA', en: 'REFUSED, AS EXPECTED' },
    na: { es: 'NO APLICA', en: 'DOES NOT APPLY' }, wait: { es: 'COMPROBANDO…', en: 'CHECKING…' }, offline: { es: 'SIN CONEXIÓN · HORIZON TESTNET', en: 'OFFLINE · HORIZON TESTNET' }
  };
  var ICON = { ok: '✓', fail: '✗', refused: '⊘', na: '–', wait: '…', offline: '○' };
  var ROLE = { proposer: { es: 'el proponente', en: 'the proposer' }, verifier: { es: 'el verificador', en: 'the verifier' }, third: { es: 'la tercera clave', en: 'the third key' }, unknown: { es: 'una clave que no es firmante', en: 'a key that is not a signer' } };
  var STEP = {
    A: { es: 'A · el proponente solo', en: 'A · the proposer alone' }, B: { es: 'B · el verificador solo', en: 'B · the verifier alone' },
    C: { es: 'C · los dos', en: 'C · both' }, D: { es: 'D · lote alterado', en: 'D · altered batch' }, I: { es: 'Independencia', en: 'Independence' }
  };
  var W = {
    index: { es: 'El archivo {f} coincide con su índice (SHA-256)', en: 'The file {f} matches its index (SHA-256)' },
    indexBad: { es: 'El archivo {f} no coincide con su índice: no lo mostramos', en: 'The file {f} does not match its index: we do not show it' },
    body: { es: 'El cuerpo de la transacción es el de C:', en: 'The transaction body is C\'s:' },
    bodyBad: { es: 'El cuerpo recalculado no es el de C', en: 'The recomputed body is not C\'s' },
    oneSig: { es: 'Una firma', en: 'One signature' }, sigBy: { es: 'Firmada por {r}', en: 'Signed by {r}' },
    noEd: { es: 'Tu navegador no puede verificar firmas Ed25519', en: 'Your browser cannot verify Ed25519 signatures' },
    thr: { es: 'Umbrales de la cuenta al enviar: {t}', en: 'Account thresholds at submission: {t}' },
    thrLive: { es: 'Cuenta leída ahora: umbrales {t}, clave maestra peso {m}, {n} firmantes de peso 1 (el archivo dice {f})', en: 'Account read now: thresholds {t}, master key weight {m}, {n} signers of weight 1 (the file says {f})' },
    thrNoRead: { es: 'No pudimos leer la cuenta en Horizon testnet: los umbrales no se pueden juzgar', en: 'Could not read the account on Horizon testnet: the thresholds cannot be judged' },
    otherAcct: { es: 'La transacción C la envió otra cuenta ({g})', en: 'Transaction C was sent by another account ({g})' },
    acctOk: { es: 'El archivo describe la cuenta de anclaje configurada', en: 'The file describes the configured anchoring account' },
    acctBad: { es: 'El archivo describe otra cuenta ({g}), no la configurada', en: 'The file describes another account ({g}), not the configured one' },
    notFound: { es: 'Cuenta no encontrada en testnet: la cuenta 2 de 3 aún no existe', en: 'Account not found on testnet: the 2-of-3 account does not exist yet' },
    acctOffline: { es: 'No pudimos leer la cuenta en Horizon testnet ({t}). Reintentando en 30 s.', en: 'Could not read the account on Horizon testnet ({t}). Retrying in 30 s.' },
    thrEarlier: { es: 'Umbrales del ensayo: {t} (diseño anterior; la cuenta definitiva tendrá 2/2/3)', en: 'Rehearsal thresholds: {t} (earlier design; the real account will use 2/2/3)' },
    answer: { es: 'Respuesta de la red: {c}', en: 'Network answer: {c}' },
    onchain: { es: 'Está en Stellar testnet: ledger {l}, memo {m}', en: 'It is on Stellar testnet: ledger {l}, memo {m}' },
    onchainBad: { es: 'No coincide con lo que guarda Stellar testnet', en: 'It does not match what Stellar testnet keeps' },
    twoSigs: { es: 'Dos firmas: {r}', en: 'Two signatures: {r}' },
    link: { es: 'Ver en stellar.expert ↗', en: 'View on stellar.expert ↗' },
    reason: { es: 'Motivo registrado: {c}', en: 'Recorded reason: {c}' },
    notSent: { es: 'Nada enviado · nada firmado', en: 'Nothing submitted · nothing signed' },
    offline: { es: 'No pudimos leer Horizon testnet ({t}). Reintentando en 30 s.', en: 'Could not read Horizon testnet ({t}). Retrying in 30 s.' },
    ours: { es: 'Nuestro veredicto, calculado aquí sin leer el del archivo: ', en: 'Our verdict, computed here without reading the file\'s: ' },
    theirs: { es: 'Veredicto escrito en el archivo: ', en: 'Verdict written in the file: ' },
    disagree: { es: 'No coinciden: confía en el que puedes recalcular.', en: 'They disagree: trust the one you can recompute.' },
    L: { es: 'L · la tercera clave del ensayo y el verificador anclaron QW#1 (ledger {l}): en la cuenta definitiva la conciliación marcaría ROTO esa pareja.', en: 'L · the rehearsal\'s third key and the verifier anchored QW#1 (ledger {l}): on the real account reconciliation would mark that pair BROKEN.' },
    indep: { es: 'Independencia, después de publicar el lote: anclado (ledger {l}).', en: 'Independence, after the batch was published: anchored (ledger {l}).' },
    fileErr: { es: 'No pudimos leer el archivo de evidencia ({p}).', en: 'Could not read the evidence file ({p}).' },
    sum: { es: '{n} de {m} comprobaciones en vivo correctas', en: '{n} of {m} live checks correct' },
    planned: { es: 'En preparación (semana 2)', en: 'In preparation (week 2)' },
    created: { es: 'Cuenta creada; pruebas aún no publicadas', en: 'Account created; tests not published yet' },
    published: { es: 'Publicadas el {d} · veredicto del archivo: {v}', en: 'Published on {d} · verdict in the file: {v}' },
    unknownFmt: { es: 'Formato de evidencia no reconocido: no lo mostramos.', en: 'Unrecognised evidence format: we do not show it.' }
  };

  function stateHTML(s, words) { return '<span aria-hidden="true">' + (ICON[s] || '–') + '</span> ' + pair(words || STATE[s] || STATE.na); }
  function shortH(h) { return h ? '<span class="q-hash" translate="no" title="' + esc(h) + '">' + esc(h.slice(0, 8) + '…' + h.slice(-6)) + '</span>' : '—'; }
  function codes(list) { return (list || []).map(function (c) { return '<code>' + esc(c) + '</code>' + (T.REASONS[c] ? ' <span class="q-why-i">' + pair(T.REASONS[c]) + '</span>' : ''); }).join(' · '); }
  function roles(list) { return (list || []).map(function (r) { return pair(ROLE[r] || ROLE.unknown); }).join(' + '); }
  function subtle() { return (typeof self !== 'undefined' && self.crypto && self.crypto.subtle) || null; }
  function sha256(data) {
    var s = subtle();
    if (!s) return Promise.reject(new Error('no WebCrypto'));
    var bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return s.digest('SHA-256', bytes).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); });
  }
  function deps(extra) {
    var R = root.QWATT_RECONCILE;
    return Object.assign({ sha256: sha256, envelope: E, signedBy: (R && typeof R.signedBy === 'function' && R.signedBy) || (E && E.signedBy) || null,
      horizonTx: L ? function (h) { return L.tx(h); } : null }, extra || {});
  }

  /* one row of a step, in words */
  function rowText(r, earlier) {
    var v = r.vals || {};
    switch (r.id) {
      case 'index': return r.state === 'ok' ? pair(W.index, { f: v.file }) : pair(W.indexBad, { f: v.file });
      case 'body': return r.state === 'ok' ? pair(W.body) + ' ' + shortH(v.recomputed) : r.state === 'na' ? pair(W.noEd) : pair(W.bodyBad);
      case 'one-sig': return pair(W.oneSig) + ' (' + num(String(v.count), 'archivo') + ')';
      case 'signer': {
        var who = ROLE[v.role] || ROLE.unknown;
        return r.state === 'na' ? pair(W.noEd) : pair({ es: W.sigBy.es.replace('{r}', who.es), en: W.sigBy.en.replace('{r}', who.en) });
      }
      case 'thresholds':
        if (r.state === 'offline') return pair(W.thrNoRead);
        if (v.live) return pair(W.thrLive, { t: v.thresholds, m: String(v.masterWeight), n: String(v.signersW1), f: v.file || '—' });
        return pair(earlier ? W.thrEarlier : W.thr, { t: v.thresholds || '—' });
      case 'answer': return pair(W.answer, { c: '' }) + codes(v.codes);
      case 'onchain': return v.otherAccount ? pair(W.otherAcct, { g: S.shortKey(v.otherAccount) }) : r.state === 'offline' ? pair(W.offline, { t: S.fmtTime().slice(0, 5) }) : r.state === 'ok' ? pair(W.onchain, { l: S.fmtNum(v.ledger), m: v.memoShown || '—' }) + ' ' + badge(v.src === 'vivo' ? 'vivo' : 'archivo', { t: S.fmtTime(), p: 'C.transaction.json' }) : pair(W.onchainBad);
      case 'two-sigs': return r.state === 'na' ? pair(W.noEd) + ' (' + num(String(v.count || 0), 'vivo') + ')' : r.state === 'offline' ? '' : pair(W.twoSigs, { r: '' }) + roles(v.roles);
      case 'link': return v.url ? '<a class="q-link" href="' + esc(v.url) + '" target="_blank" rel="noopener">' + pair(W.link) + '<span class="q-vh">' + pair('newTab') + '</span></a>' : '—';
      case 'reason': return pair(W.reason, { c: '' }) + codes(v.codes);
      case 'not-submitted': return pair(W.notSent);
    }
    return esc(r.id);
  }
  function modelHTML(m, earlier) {
    var out = '';
    var ac = m.accountCheck;
    if (ac && ac.state !== 'na') out += '<p class="q-verdict-line"><span class="q-state" data-state="' + ac.state + '">' + stateHTML(ac.state) + '</span> ' + (ac.state === 'ok' ? pair(W.acctOk) : pair(W.acctBad, { g: S.shortKey(ac.vals.file) })) + '</p>';
    out += '<div class="q-steps-grid">';
    T.ORDER.forEach(function (k) {
      var s = m.steps[k];
      if (!s) return;
      out += '<article class="q-stepcard" data-state="' + s.state + '"><div class="q-stepcard-h"><h4>' + pair(STEP[k]) + '</h4><span class="q-state" data-state="' + s.state + '">' + stateHTML(s.state) + '</span></div><ul class="q-rows">' +
        s.rows.map(function (r) { return '<li><span class="q-state" data-state="' + r.state + '">' + stateHTML(r.state) + '</span><span>' + rowText(r, earlier) + '</span></li>'; }).join('') + '</ul></article>';
    });
    out += '</div>';
    var vw = T.VERDICT[m.verdict], fw = m.fileVerdict ? T.VERDICT[m.fileVerdict] : null;
    out += '<p class="q-verdict-line" data-v="' + m.verdict + '">' + pair(W.ours) + '<b>' + pair(vw) + '</b>' + (fw ? ' · ' + pair(W.theirs) + '<b>' + pair(fw) + '</b>' : '') + (fw && m.fileVerdict !== m.verdict ? ' <span class="q-codes">' + pair(W.disagree) + '</span>' : '') + '</p>';
    return out;
  }

  /* ───────────────────────────── section 3: the 8 Oct worked example ───────────────────────────── */

  var worked = { data: null, timer: null };
  function setLive(id, state, html) {
    var li = d.querySelector('#pLive [data-check="' + id + '"]'); if (!li) return;
    li.setAttribute('data-state', state);
    var s = li.querySelector('[data-slot="state"]'); s.setAttribute('data-state', state); s.innerHTML = stateHTML(state);
    li.querySelector('[data-slot="v"]').innerHTML = html || '';
  }
  function renderWorked() {
    var w = worked.data; if (!w) return;
    var A = w.steps.A, B = w.steps.B, C = w.steps.C;
    var row = function (s, id) { return s ? s.rows.filter(function (r) { return r.id === id; })[0] : null; };
    var bA = row(A, 'body'), bB = row(B, 'body');
    var bodyOk = bA && bB && bA.state === 'ok' && bB.state === 'ok';
    setLive('body', bA && bB && (bA.state === 'na' || bB.state === 'na') ? 'na' : bodyOk ? 'ok' : 'fail', bA ? shortH(bA.vals.recomputed) + ' ' + badge('recalculado', { f: 'qwatt-envelope.js · bodyHash' }) : '');
    var sA = row(A, 'signer'), sB = row(B, 'signer');
    setLive('sigA', sA ? sA.state : 'fail', sA && sA.state === 'na' ? pair(W.noEd) : sA && sA.vals.key ? '<span class="q-hash" translate="no">' + esc(S.shortKey(sA.vals.key)) + '</span>' : '');
    setLive('sigB', sB ? sB.state : 'fail', sB && sB.state === 'na' ? pair(W.noEd) : sB && sB.vals.key ? '<span class="q-hash" translate="no">' + esc(S.shortKey(sB.vals.key)) + '</span>' : '');
    var on = row(C, 'onchain'), two = row(C, 'two-sigs');
    var cState = !on ? 'fail' : on.state === 'offline' ? 'offline' : on.state === 'ok' && two && (two.state === 'ok' || two.state === 'na') ? two.state : 'fail';
    setLive('c', cState, on && on.state === 'ok' ? pair(W.onchain, { l: S.fmtNum(on.vals.ledger), m: on.vals.memoShown || '—' }) + ' · <a class="q-link" href="' + EXPLORER + '/tx/' + esc(on.vals.hash) + '" target="_blank" rel="noopener">' + pair(W.link) + '<span class="q-vh">' + pair('newTab') + '</span></a> ' + badge('vivo', { t: S.fmtTime() }) : on && on.state === 'offline' ? pair(W.offline, { t: S.fmtTime().slice(0, 5) }) : '');
    var lis = d.querySelectorAll('#pLive [data-check]'), okN = 0;
    for (var i = 0; i < lis.length; i++) if (lis[i].getAttribute('data-state') === 'ok') okN++;
    $('pSum').innerHTML = pair(W.sum, { n: okN, m: lis.length });
    $('pLive').setAttribute('aria-busy', 'false');
    var extra = '';
    if (w.L) extra += '<p class="q-vnote">' + pair(W.L, { l: S.fmtNum(w.L.ledger) }) + '</p>';
    if (w.independenceAfter) extra += '<p class="q-vnote">' + pair(W.indep, { l: S.fmtNum(w.independenceAfter.ledger) }) + '</p>';
    $('pWorked').innerHTML = modelHTML(w, true) + extra + badge('ensayo', null, { es: S.SRC.ensayo.es + ' · leído ' + S.fmtTime(), en: S.SRC.ensayo.en + ' · read ' + S.fmtTime() });
  }
  function runWorked(paths) {
    clearTimeout(worked.timer);
    Promise.all([L.evidence(paths.abcd), L.evidence(paths.independence)]).then(function (r) {
      return T.worked(r[0], r[1], deps());
    }).then(function (w) {
      worked.data = w; renderWorked();
      if (w.steps.C && w.steps.C.state === 'offline') worked.timer = setTimeout(function () { runWorked(paths); }, 30000);
    }, function () {
      $('pWorked').innerHTML = '<p class="q-err" role="status">' + pair(W.fileErr, { p: paths.abcd }) + '</p>';
    });
  }

  /* ───────────────────────────── section 2 and the page state: the real account ───────────────────────────── */

  function stateLine(chipSt, chipWords, words) {
    var el = d.querySelector('#pState [data-slot="state"]'); if (!el) return;
    el.innerHTML = S.chip(chipSt, chipWords) + ' ' + words;
  }
  function getText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
  }
  /** Signer roles from the public run feed (faults.json), when status.json configures it; otherwise null. */
  function runRoles(status) {
    var fd = status && (status.feeds || []).filter(function (f) { return f.id === 'corrida'; })[0];
    if (!fd || !fd.base || !root.QWATT_FEED) return Promise.resolve(null);
    return root.QWATT_FEED.open(fd.base, {}).then(function (f) { return f.run && f.run.signers ? f.run.signers : null; }, function () { return null; });
  }
  var PLANNED = { es: 'PLANIFICADO · SEMANA 2', en: 'PLANNED · WEEK 2' };
  function realAccount(account, status) {
    var dir = ACCOUNT_DIR + account + '/';
    var acct = null;
    L.account(account).then(function (a) {
      acct = a;
      if (!a.exists) { stateLine('planificado', PLANNED, pair(W.notFound)); return null; }
      return getText(dir + 'abcd.json');
    }, function () {
      stateLine('planificado', PLANNED, pair(W.acctOffline, { t: S.fmtTime().slice(0, 5) }));
      setTimeout(function () { realAccount(account, status); }, 30000);
      return null;
    }).then(function (text) {
      if (!acct || !acct.exists) return null;
      if (text == null) {
        stateLine('curso', { es: 'EN CURSO · SEMANA 2', en: 'IN PROGRESS · WEEK 2' }, pair(W.created));
        return null;
      }
      var abcd = JSON.parse(text);
      return getText(dir + 'index.json').then(function (it) {
        var index = it ? JSON.parse(it) : null;
        var names = index && index.files ? Object.keys(index.files) : [];
        return Promise.all([runRoles(status)].concat(names.map(function (n) { return getText(dir + n).then(function (t) { return [n, t]; }); }))).then(function (all) {
          var files = {};
          all.slice(1).forEach(function (p) { if (p[1] != null) files[p[0]] = p[1]; });
          return T.model(abcd, index, files, deps({ account: account, live: acct, roles: all[0] || undefined }));
        }).then(function (m) {
          /* TESTNET only when our own verdict is PASS for this account; the file's verdict never decides it */
          var ps = m.verdict === 'PASS' && m.accountCheck && m.accountCheck.state === 'ok' ? { state: 'testnet' } : { state: 'curso' };
          var at = (m.steps.C && m.steps.C.at) || (m.steps.A && m.steps.A.at) || '';
          var vw = T.VERDICT[abcd.verdict] || T.VERDICT.INCOMPLETE;
          var line = function (lg) { return W.published[lg].replace('{d}', at ? S.fmtDate(at, lg) : '—').replace('{v}', vw[lg]); };
          stateLine(ps.state === 'testnet' ? 'testnet' : 'curso', ps.state === 'testnet' ? null : { es: 'EN CURSO · SEMANA 2', en: 'IN PROGRESS · WEEK 2' },
            pair({ es: line('es'), en: line('en') }));
          var box = $('pReal'); box.hidden = false; box.innerHTML = modelHTML(m, false);
          T.ORDER.forEach(function (k) {
            var card = d.querySelector('.q-tcard[data-step="' + k + '"] [data-slot="line"]');
            if (card && m.steps[k]) card.innerHTML = '<span class="q-state" data-state="' + m.steps[k].state + '">' + stateHTML(m.steps[k].state) + '</span>';
          });
          /* the plan's PLANIFICADO chips give way to TESTNET once the tests are judged PASS here (no data-status-of: status.json no longer re-stamps them) */
          if (ps.state === 'testnet') {
            var chips = d.querySelectorAll('.q-tcard .q-chip[data-status-of], #h2plan ~ .q-chip[data-status-of]');
            for (var i = 0; i < chips.length; i++) { var t = d.createElement('span'); t.innerHTML = S.chip('testnet'); chips[i].parentNode.replaceChild(t.firstChild, chips[i]); }
          }
        });
      });
    }).catch(function () {
      var box = $('pReal'); box.hidden = false; box.innerHTML = '<p class="q-err" role="status">' + pair(W.unknownFmt) + '</p>';
    });
  }

  function start() {
    if (!L || !T || !E) return;
    var status = Q && Q.load ? Q.load().catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([L.ready(), status]).then(function (r) {
      var st = r[1];
      var paths = st && st.tests && st.tests.worked_example ? st.tests.worked_example : DEFAULTS;
      runWorked({ abcd: paths.abcd || DEFAULTS.abcd, independence: paths.independence || DEFAULTS.independence });
      var account = L.CONFIG.ANCHOR_ACCOUNT;
      if (account) realAccount(account, st);
    });
    S.onLang(renderWorked);
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
