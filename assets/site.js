/**
 * QWATT — shared site chrome
 * ---------------------------------------------------------------------------
 * One navigation (the drawer, rendered here from NAV), the day/night and ES/EN
 * toggles, label chips, source badges, number and time formatting, reveal on
 * scroll, the typing eyebrow and copy buttons. Every page loads it; no page
 * carries its own drawer, theme block or footer script.
 *
 * Storage: only 'qwatt.theme', 'qwatt.drawer' and 'wc-lang' (UI preferences).
 * In Node (ops/site.test.js) it exports NAV and the dictionaries without touching
 * any page. UMD: window.QWATT_SITE in the browser.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.QWATT_SITE = api; api._boot(); }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* ═══════════════════════ NAV (DESIGN Appendix C) ═══════════════════════
   * pending: true = the page may be missing or not yet deployed on this branch;
   * INTEGRATE removes every flag. Dots: testnet, prototipo, planificado, none. */
  var NAV = [
    { group: { es: 'Sprint', en: 'Sprint' }, items: [
      { id: 'index', href: '/', file: 'index.html', status: 'mixto', parts: ['testnet', 'prototipo', 'planificado'], dot: 'none',
        es: 'Inicio', en: 'Home',
        sub: [['#sprint', 'Sprint', 'Sprint'], ['#semana1', 'Semana 1', 'Week 1'], ['#semana2', 'Semana 2', 'Week 2'], ['#vivo', 'En vivo', 'Live'],
          ['#como', 'Cómo funciona', 'How it works'], ['#ideas', 'Todas las ideas', 'All ideas'], ['#enlaces', 'Enlaces', 'Links']] },
      { id: 'hoja-de-ruta', href: '/hoja-de-ruta.html', file: 'hoja-de-ruta.html', status: 'mixto', parts: ['testnet', 'prototipo', 'planificado'], dot: 'none',
        es: 'Hoja de ruta', en: 'Roadmap' },
      { id: 'release', href: 'https://github.com/academiaseul/QWATT/releases/tag/semana-1', ext: true, es: 'Semana 1 (release)', en: 'Week 1 (release)' },
      { id: 'changelog', href: 'https://github.com/academiaseul/QWATT/blob/main/CHANGELOG.es.md', hrefEn: 'https://github.com/academiaseul/QWATT/blob/main/CHANGELOG.md', ext: true, es: 'Registro de cambios', en: 'Changelog' }] },
    { group: { es: 'Compruébalo tú', en: 'Check it yourself' }, items: [
      { id: 'verificacion', href: '/verificacion.html', file: 'verificacion.html', status: 'mixto', parts: ['testnet', 'prototipo', 'planificado'], dot: 'testnet',
        es: 'Compruébalo tú · vuelve a derivar un lote', en: 'Check it yourself · re-derive a batch' },
      { id: 'como-funciona', href: '/como-funciona.html', file: 'como-funciona.html', status: 'mixto', parts: ['testnet', 'prototipo', 'planificado'], dot: 'none',
        es: 'Cómo funciona', en: 'How it works' },
      { id: 'pruebas', href: '/pruebas.html', file: 'pruebas.html', status: 'mixto', parts: ['planificado', 'testnet'], dot: 'planificado',
        es: 'La red dice que no · pruebas A–D', en: 'The network says no · tests A–D' },
      { id: 'proof', href: '/proof.html', file: 'proof.html', status: 'testnet', parts: ['testnet'], dot: 'testnet', es: 'Explorador de anclajes', en: 'Anchor explorer' },
      { id: 'respaldo', href: '/respaldo.html', file: 'respaldo.html', status: 'mixto', parts: ['testnet', 'prototipo', 'planificado'], dot: 'testnet', es: 'Cuentas públicas y evidencia', en: 'Public accounts and evidence' },
      { id: 'reconcile', href: null, status: 'planificado', parts: ['planificado'], dot: 'planificado', es: 'Conciliación · en preparación (semana 2)', en: 'Reconciliation · in preparation (week 2)' }] },
    { group: { es: 'Stellar testnet en vivo', en: 'Live on Stellar testnet' }, items: [
      { id: 'red', href: '/red.html', file: 'red.html', status: 'testnet', parts: ['testnet'], dot: 'testnet', es: 'Pulse · actividad', en: 'Pulse · activity' },
      { id: 'console', href: '/console.html', file: 'console.html', status: 'testnet', parts: ['testnet'], dot: 'testnet', es: 'Consola (solo lectura)', en: 'Console (read-only)' },
      { id: 'wallet', href: '/wallet.html', file: 'wallet.html', status: 'testnet', parts: ['testnet'], dot: 'testnet', es: 'Cuentas y firmas', en: 'Accounts and signatures' },
      { id: 'pay', href: '/pay.html', file: 'pay.html', status: 'testnet', parts: ['testnet'], dot: 'testnet', es: 'Cómo se confirma una transacción', en: 'How a transaction is confirmed' }] },
    { group: { es: 'Prototipos', en: 'Prototypes' }, items: [
      { id: 'grid', href: '/grid.html', file: 'grid.html', status: 'prototipo', parts: ['prototipo'], dot: 'prototipo', es: 'Grid · instalación simulada', en: 'Grid · simulated installation' }] },
    { group: { es: 'Planificado', en: 'Planned' }, items: [
      { id: 'piloto', href: '/piloto.html', file: 'piloto.html', status: 'planificado', parts: ['planificado'], dot: 'planificado', es: 'Piloto solar', en: 'Solar pilot' },
      { id: 'backup', href: '/backup.html', file: 'backup.html', status: 'planificado', parts: ['planificado'], dot: 'planificado', es: 'Custodia de claves', en: 'Key custody' }] },
    { group: { es: 'Documentos', en: 'Documents' }, items: [
      { id: 'whitepaper', href: '/whitepaper.html', file: 'whitepaper.html', status: 'mixto', parts: ['testnet', 'prototipo', 'planificado'], dot: 'none', es: 'Documento técnico v3', en: 'Technical paper v3' },
      { id: 'terminos', href: '/terminos.html', file: 'terminos.html', status: 'info', parts: [], dot: 'none', es: 'Términos, límites y privacidad', en: 'Terms, limits and privacy' }] },
    { group: { es: 'Enlaces', en: 'Links' }, items: [
      { id: 'github', href: 'https://github.com/academiaseul/QWATT', ext: true, es: 'GitHub', en: 'GitHub' },
      { id: 'video', href: 'https://youtube.com/shorts/4PBe8vSmcwM', ext: true, es: 'Video (2:56)', en: 'Video (2:56)' },
      { id: 'xpost', href: 'https://x.com/ch1ngukim/status/2113590210952921290', ext: true, es: 'Post en X', en: 'Post on X' },
      { id: 'youtube', href: 'https://www.youtube.com/@qwatt.energy', ext: true, es: 'YouTube @qwatt.energy', en: 'YouTube @qwatt.energy' },
      { id: 'x', href: 'https://x.com/ch1ngukim', ext: true, es: 'X @ch1ngukim', en: 'X @ch1ngukim' }] }
  ];
  // 404.html: body data-page="404" data-status="info" data-parts="" (no NAV entry).

  var DISCLAIMER_ES = 'QWATT es un proyecto en desarrollo que opera solo en Stellar testnet. QWATT no es electricidad, ni una inversión, ni un valor o instrumento financiero, ni un certificado de energía renovable (REC), ni un crédito de carbono. No tiene precio y no se vende.';
  var DISCLAIMER_EN = 'QWATT is a project in development that runs only on Stellar testnet. QWATT is not electricity, not an investment, not a security or financial instrument, not a renewable energy certificate (REC), and not a carbon credit. It has no price and is not for sale.';

  /* Label chips (DESIGN §3.1) and source badges (§3.4). */
  var STATUS = {
    testnet: { es: 'TESTNET', en: 'TESTNET' }, prototipo: { es: 'PROTOTIPO', en: 'PROTOTYPE' }, planificado: { es: 'PLANIFICADO', en: 'PLANNED' },
    previo: { es: 'TRABAJO PREVIO', en: 'PRIOR WORK' }, hecho: { es: 'HECHO', en: 'DONE' }, curso: { es: 'EN CURSO', en: 'IN PROGRESS' },
    vigente: { es: 'VIGENTE', en: 'IN FORCE' }, descartada: { es: 'DESCARTADA', en: 'DROPPED' }, info: { es: 'INFO', en: 'INFO' }
  };
  var SRC = {
    vivo: { es: 'En vivo · Stellar testnet · leído {t}', en: 'Live · Stellar testnet · read {t}' },
    sim: { es: 'Entrada simulada · Stellar testnet', en: 'Simulated input · Stellar testnet' },
    ensayo: { es: 'Entrada simulada · Stellar testnet · ensayo 8 oct · cuenta desechable', en: 'Simulated input · Stellar testnet · 8 Oct rehearsal · throwaway account' },
    demo: { es: 'Entrada simulada · demo local, no envía nada', en: 'Simulated input · local demo, sends nothing' },
    publico: { es: 'Datos públicos NREL PVDAQ · no son mediciones nuestras', en: 'Public NREL PVDAQ data · not our measurements' },
    dato: { es: 'Dato del repositorio · {d}', en: 'Repository fact · {d}' },
    plan: { es: 'en preparación (semana 2)', en: 'in preparation (week 2)' },
    recalculado: { es: 'Recalculado en tu navegador con el código del repositorio · {f}', en: 'Recomputed in your browser with the repository\'s code · {f}' },
    archivo: { es: 'Leído del archivo publicado · {p}', en: 'Read from the published file · {p}' }
  };
  /* Markup for a number with its source (literal per kind, so the static check can read it). */
  var NUM_OPEN = {
    vivo: '<span class="q-num" data-src="vivo">', sim: '<span class="q-num" data-src="sim">', ensayo: '<span class="q-num" data-src="ensayo">',
    demo: '<span class="q-num" data-src="demo">', publico: '<span class="q-num" data-src="publico">', dato: '<span class="q-num" data-src="dato">',
    plan: '<span class="q-num" data-src="plan">', recalculado: '<span class="q-num" data-src="recalculado">', archivo: '<span class="q-num" data-src="archivo">'
  };

  var LINKS = {
    repo: 'https://github.com/academiaseul/QWATT',
    changelogEs: 'https://github.com/academiaseul/QWATT/blob/main/CHANGELOG.es.md',
    changelogEn: 'https://github.com/academiaseul/QWATT/blob/main/CHANGELOG.md',
    release: 'https://github.com/academiaseul/QWATT/releases/tag/semana-1',
    video: 'https://youtube.com/shorts/4PBe8vSmcwM',
    xpost: 'https://x.com/ch1ngukim/status/2113590210952921290',
    youtube: 'https://www.youtube.com/@qwatt.energy',
    x: 'https://x.com/ch1ngukim'
  };

  /* Interface strings. Every es: has its en: on the same line (checked by ops/site.test.js). */
  var STR = {
    openMenu: { es: 'Abrir menú', en: 'Open menu' },
    closeMenu: { es: 'Cerrar menú', en: 'Close menu' },
    siteMenu: { es: 'Menú del sitio', en: 'Site menu' },
    dayMode: { es: 'Modo día', en: 'Day mode' },
    nightMode: { es: 'Modo noche', en: 'Night mode' },
    newTab: { es: '(abre en una pestaña nueva)', en: '(opens in a new tab)' },
    legend: { es: 'Leyenda', en: 'Legend' },
    dotTestnet: { es: 'testnet en vivo', en: 'live on testnet' },
    dotPrototipo: { es: 'prototipo, entrada simulada', en: 'prototype, simulated input' },
    dotPlanificado: { es: 'planificado', en: 'planned' },
    footNet: { es: 'SOLO STELLAR TESTNET', en: 'STELLAR TESTNET ONLY' },
    current: { es: 'página actual', en: 'current page' },
    notYet: { es: 'sin enlace todavía', en: 'no link yet' },
    reading: { es: 'Leyendo Horizon testnet…', en: 'Reading Horizon testnet…' },
    offline: { es: 'No pudimos leer Horizon testnet ({t}). Reintentando en 30 s.', en: 'Could not read Horizon testnet ({t}). Retrying in 30 s.' },
    limited: { es: 'Horizon limitó las consultas; reintentamos en 60 s.', en: 'Horizon rate-limited us; retrying in 60 s.' },
    notFound: { es: 'Cuenta no encontrada en testnet (testnet se reinicia periódicamente).', en: 'Account not found on testnet (testnet is reset from time to time).' },
    wrongNet: { es: 'La red respondió con otra frase de red; no mostramos nada.', en: 'The network answered with another passphrase; nothing is shown.' },
    memoHidden: { es: 'memo oculto (solo mostramos memos de anclaje QW#n)', en: 'memo hidden (only anchoring memos QW#n are shown)' },
    marker: { es: 'pago marcador fijo (monto no mostrado)', en: 'fixed marker payment (amount not shown)' },
    refresh: { es: 'Actualizar', en: 'Refresh' },
    paused: { es: 'Pausado mientras la pestaña no está visible', en: 'Paused while the tab is hidden' },
    copied: { es: 'Copiado', en: 'Copied' },
    copy: { es: 'Copiar', en: 'Copy' },
    agoS: { es: 'hace {n} s', en: '{n} s ago' },
    agoM: { es: 'hace {n} min', en: '{n} min ago' },
    yes: { es: 'SÍ', en: 'YES' },
    no: { es: 'NO', en: 'NO' }
  };

  /* ═══════════════════════ helpers (Node and browser) ═══════════════════════ */

  function doc() { return root.document || null; }
  function lang() { var d = doc(); return d && d.documentElement.getAttribute('data-lang') === 'en' ? 'en' : 'es'; }
  function fill(s, vars) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; }); }
  function t(key, vars, lg) {
    var o = typeof key === 'string' ? STR[key] : key;
    if (!o) return String(key);
    return fill(o[lg || lang()], vars);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /** Both languages inline: <span data-l="es">…</span><span data-l="en">…</span>. */
  function pair(o, vars) {
    var p = typeof o === 'string' ? STR[o] : o;
    return '<span data-l="es">' + esc(fill(p.es, vars)) + '</span><span data-l="en">' + esc(fill(p.en, vars)) + '</span>';
  }
  function num(text, src) { if (!NUM_OPEN[src]) throw new Error('unknown source ' + src); return NUM_OPEN[src] + esc(text) + '</span>'; }
  function badge(src, vars, label) {
    var o = label || SRC[src];
    return '<span class="q-src" data-src="' + src + '">' + pair(o, vars) + '</span>';
  }
  function chip(st, text) {
    var w = text || STATUS[st];
    return '<span class="q-chip" data-st="' + st + '">' + pair(w) + '</span>';
  }
  function fmtNum(n, lg) {
    if (n == null || !isFinite(n)) return '—';
    try { return new Intl.NumberFormat((lg || lang()) === 'en' ? 'en-US' : 'es-CL').format(n); } catch (e) { return String(n); }
  }
  function fmtTime(d) {
    d = d ? new Date(d) : new Date();
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  var MON = { es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
  function fmtDate(iso, lg) {
    var d = new Date(iso); if (!isFinite(d)) return '—';
    lg = lg || lang();
    return d.getDate() + ' ' + MON[lg][d.getMonth()] + ' ' + d.getFullYear();
  }
  function shortKey(g) { return g ? g.slice(0, 4) + '…' + g.slice(-4) : '—'; }
  function shortHash(h) { return h ? h.slice(0, 8) + '…' + h.slice(-6) : '—'; }

  var langListeners = [];
  function onLang(cb) { langListeners.push(cb); }

  var api = {
    NAV: NAV, STATUS: STATUS, SRC: SRC, STR: STR, LINKS: LINKS, DISCLAIMER_ES: DISCLAIMER_ES, DISCLAIMER_EN: DISCLAIMER_EN,
    t: t, lang: lang, esc: esc, pair: pair, num: num, badge: badge, chip: chip, fmtNum: fmtNum, fmtTime: fmtTime, fmtDate: fmtDate,
    shortKey: shortKey, shortHash: shortHash, onLang: onLang, _boot: boot
  };

  /* ═══════════════════════ browser ═══════════════════════ */

  var QM = '<svg class="qm" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="21" fill="none" stroke="var(--qlogo-ink)" stroke-width="7" stroke-dasharray="5.5 22 104.4"/><path d="M3 -17L-8 3L-2 3L-4 17L8 -3L2 -3Z" fill="var(--qlogo-bolt)" transform="translate(46 46) rotate(-45) scale(.92)"/></svg>';

  function store(key, val) {
    try { if (val === undefined) { if (key === 'qwatt.theme') return root.localStorage.getItem('qwatt.theme'); if (key === 'qwatt.drawer') return root.localStorage.getItem('qwatt.drawer'); return root.localStorage.getItem('wc-lang'); }
      if (key === 'qwatt.theme') root.localStorage.setItem('qwatt.theme', val);
      else if (key === 'qwatt.drawer') root.localStorage.setItem('qwatt.drawer', val);
      else root.localStorage.setItem('wc-lang', val);
    } catch (e) { return null; }
    return null;
  }

  function currentId() {
    var p = (root.location && root.location.pathname) || '/';
    if (p === '/' || /\/index\.html$/.test(p)) return 'index';
    if (/^\/proof\//.test(p)) return 'proof';
    var hit = null;
    NAV.forEach(function (g) { g.items.forEach(function (e) { if (e.href && e.href !== '/' && p === e.href) hit = e.id; }); });
    return hit;
  }

  function drawerHTML() {
    var cur = currentId();
    var out = '<div class="q-d-head"><a class="q-d-brand" href="/">' + QM + '<span translate="no">QWATT</span></a>' +
      '<button type="button" class="q-d-x" id="qdClose" aria-label="' + esc(t('closeMenu', null, 'es')) + '" data-aria-en="' + esc(t('closeMenu', null, 'en')) + '"><span aria-hidden="true">✕</span></button></div>' +
      '<nav class="q-d-nav" aria-label="' + esc(t('siteMenu', null, 'es')) + '" data-aria-en="' + esc(t('siteMenu', null, 'en')) + '">';
    NAV.forEach(function (g) {
      out += '<p class="q-d-title">' + pair(g.group) + '</p><ul class="q-d-list">';
      g.items.forEach(function (e, i) {
        var n = (i < 9 ? '0' : '') + (i + 1);
        var dot = e.dot && e.dot !== 'none'
          ? '<span class="q-dot" data-dot="' + e.dot + '" title="' + esc(t(dotKey(e.dot), null)) + '"><span class="q-vh">' + pair(dotKey(e.dot)) + '</span></span>' : '';
        var label = '<span class="q-d-n" aria-hidden="true">' + n + '</span><span class="q-d-l">' + pair(e) + '</span>';
        if (e.href === null) {
          out += '<li><span class="q-d-link is-off" aria-disabled="true">' + label + dot + '</span></li>';
          return;
        }
        var on = e.id === cur;
        if (e.ext) {
          out += '<li><a class="q-d-link is-ext" href="' + esc(e.href) + '"' + (e.hrefEn ? ' data-href-en="' + esc(e.hrefEn) + '"' : '') +
            ' target="_blank" rel="noopener">' + label + '<span class="q-ext" aria-hidden="true">↗</span><span class="q-vh">' + pair('newTab') + '</span></a></li>';
          return;
        }
        out += '<li><a class="q-d-link' + (on ? ' is-on' : '') + '" href="' + esc(e.href) + '"' + (on ? ' aria-current="page"' : '') + '>' + label + dot + '</a>';
        if (on && e.sub) {
          out += '<ul class="q-d-sub">' + e.sub.map(function (s) {
            return '<li><a class="q-d-sublink" href="' + s[0] + '" data-spy="' + s[0].slice(1) + '">' + pair({ es: s[1], en: s[2] }) + '</a></li>';
          }).join('') + '</ul>';
        }
        out += '</li>';
      });
      out += '</ul>';
    });
    out += '</nav><div class="q-d-legend"><p class="q-d-title">' + pair('legend') + '</p><ul>' +
      ['testnet', 'prototipo', 'planificado'].map(function (d) { return '<li><span class="q-dot" data-dot="' + d + '" aria-hidden="true"></span>' + pair(dotKey(d)) + '</li>'; }).join('') +
      '</ul></div><p class="q-d-foot"><span class="q-net-dot" aria-hidden="true"></span>' + pair('footNet') + '</p>';
    return out;
  }
  function dotKey(d) { return d === 'testnet' ? 'dotTestnet' : d === 'prototipo' ? 'dotPrototipo' : 'dotPlanificado'; }

  function applyLang(lg, save) {
    var d = doc(); var html = d.documentElement;
    html.setAttribute('data-lang', lg);
    html.setAttribute('lang', lg);
    if (!html.hasAttribute('data-title-es')) html.setAttribute('data-title-es', d.title);
    d.title = lg === 'en' ? (html.getAttribute('data-title-en') || d.title) : html.getAttribute('data-title-es');
    var els = d.querySelectorAll('[data-aria-en]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.hasAttribute('data-aria-es')) el.setAttribute('data-aria-es', el.getAttribute('aria-label') || '');
      el.setAttribute('aria-label', lg === 'en' ? el.getAttribute('data-aria-en') : el.getAttribute('data-aria-es'));
    }
    var links = d.querySelectorAll('a[data-href-en]');
    for (var j = 0; j < links.length; j++) {
      var a = links[j];
      if (!a.hasAttribute('data-href-es')) a.setAttribute('data-href-es', a.getAttribute('href'));
      a.setAttribute('href', lg === 'en' ? a.getAttribute('data-href-en') : a.getAttribute('data-href-es'));
    }
    var bs = d.querySelectorAll('.q-lang-b');
    for (var k = 0; k < bs.length; k++) bs[k].setAttribute('aria-pressed', bs[k].getAttribute('data-lang') === lg ? 'true' : 'false');
    syncTheme();
    if (save) store('wc-lang', lg);
    langListeners.forEach(function (cb) { try { cb(lg); } catch (e) { /* a widget's problem */ } });
  }

  function syncTheme() {
    var d = doc(); var th = d.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    var b = d.getElementById('qTheme');
    if (b) {
      var key = th === 'light' ? 'nightMode' : 'dayMode';
      b.setAttribute('data-aria-es', t(key, null, 'es'));
      b.setAttribute('data-aria-en', t(key, null, 'en'));
      b.setAttribute('aria-label', t(key));
      var i = b.querySelector('.q-theme-i'); if (i) i.textContent = th === 'light' ? '☾' : '☀';
    }
    var m = d.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', th === 'light' ? '#faf8f2' : '#16100a');
  }
  function toggleTheme() {
    var html = doc().documentElement;
    var next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', next);
    store('qwatt.theme', next);
    syncTheme();
    try { root.dispatchEvent(new Event('qwatt-theme')); } catch (e) { /* old browser */ }
  }

  /* ── drawer: docked at ≥ 1000 px, modal below ── */
  var lastFocus = null;
  function wideMQ() { return root.matchMedia ? root.matchMedia('(min-width: 1000px)') : { matches: false }; }
  function setDrawer(open, opts) {
    opts = opts || {};
    var d = doc(), html = d.documentElement;
    var dr = d.getElementById('qdrawer'), ov = d.getElementById('qdOverlay'), btn = d.getElementById('qdOpen');
    if (!dr) return;
    var wide = wideMQ().matches;
    html.classList.toggle('qd-open', open);
    html.classList.toggle('qd-docked', open && wide);
    dr.classList.toggle('is-open', open);
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && !wide) {
      dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'true');
      if (ov) ov.hidden = false;
      lastFocus = d.activeElement;
      var first = dr.querySelector('.q-d-link.is-on') || dr.querySelector('a, button');
      if (first && !opts.silent) setTimeout(function () { first.focus(); }, 30);
    } else {
      dr.removeAttribute('role'); dr.removeAttribute('aria-modal');
      if (ov) ov.hidden = true;
      if (!open && lastFocus && !opts.silent && lastFocus.focus) { lastFocus.focus(); lastFocus = null; }
    }
    if (wide && !opts.silent) store('qwatt.drawer', open ? '1' : '0');
  }
  function trapFocus(e) {
    var d = doc(), dr = d.getElementById('qdrawer');
    if (!dr || !dr.classList.contains('is-open') || wideMQ().matches) return;
    if (e.key === 'Escape') { setDrawer(false); return; }
    if (e.key !== 'Tab') return;
    var f = dr.querySelectorAll('a[href], button:not([disabled])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function scrollSpy() {
    var d = doc(); if (!('IntersectionObserver' in root)) return;
    var links = d.querySelectorAll('.q-d-sublink[data-spy]');
    if (!links.length) return;
    var map = {};
    for (var i = 0; i < links.length; i++) map[links[i].getAttribute('data-spy')] = links[i];
    var io = new root.IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        for (var k in map) map[k].classList.remove('is-on');
        if (map[en.target.id]) map[en.target.id].classList.add('is-on');
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    Object.keys(map).forEach(function (id) { var s = d.getElementById(id); if (s) io.observe(s); });
  }

  function reduced() { return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function reveal() {
    var d = doc(); var els = d.querySelectorAll('.q-rv');
    if (!els.length) return;
    if (reduced() || !('IntersectionObserver' in root)) { for (var i = 0; i < els.length; i++) els[i].classList.add('in'); return; }
    var io = new root.IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    for (var j = 0; j < els.length; j++) io.observe(els[j]);
  }
  /* The eyebrow is "typed" once, in the active language. */
  function typeEyebrow() {
    if (reduced()) return;
    var d = doc(); var el = d.querySelector('.q-type');
    if (!el) return;
    var span = el.querySelector('[data-l="' + lang() + '"]');
    if (!span || span.getAttribute('data-typed')) return;
    var full = span.textContent; span.setAttribute('data-typed', '1');
    span.textContent = ''; var i = 0;
    el.classList.add('is-typing');
    (function step() {
      i += Math.random() < 0.25 ? 2 : 1;
      span.textContent = full.slice(0, i);
      if (i < full.length) setTimeout(step, 14 + Math.random() * 22);
      else setTimeout(function () { el.classList.remove('is-typing'); }, 1200);
    })();
  }
  function copyButtons() {
    var d = doc();
    d.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-copy]');
      if (!b) return;
      var src = d.getElementById(b.getAttribute('data-copy'));
      var text = src ? src.textContent.trim() : b.getAttribute('data-copy-text');
      if (!text || !root.navigator || !root.navigator.clipboard) return;
      root.navigator.clipboard.writeText(text).then(function () {
        var was = b.getAttribute('data-was') || b.innerHTML;
        b.setAttribute('data-was', was);
        b.innerHTML = pair('copied');
        setTimeout(function () { b.innerHTML = was; }, 1400);
      }, function () { /* clipboard blocked: nothing to do */ });
    });
  }
  /* "hace 12 s": every element with data-ago="<ISO>" is refreshed each second. */
  function relClock() {
    var d = doc();
    setInterval(function () {
      var els = d.querySelectorAll('[data-ago]');
      for (var i = 0; i < els.length; i++) {
        var s = Math.max(0, Math.round((Date.now() - Date.parse(els[i].getAttribute('data-ago'))) / 1000));
        if (!isFinite(s)) continue;
        els[i].innerHTML = s < 120 ? pair('agoS', { n: s }) : pair('agoM', { n: Math.round(s / 60) });
      }
    }, 1000);
  }

  function boot() {
    var d = doc(); if (!d) return;
    var start = function () {
      var dr = d.getElementById('qdrawer');
      if (dr) { dr.innerHTML = drawerHTML(); dr.hidden = false; }
      var btn = d.getElementById('qdOpen');
      if (btn) btn.addEventListener('click', function () { setDrawer(!dr.classList.contains('is-open')); });
      var x = d.getElementById('qdClose'); if (x) x.addEventListener('click', function () { setDrawer(false); });
      var ov = d.getElementById('qdOverlay'); if (ov) ov.addEventListener('click', function () { setDrawer(false); });
      if (dr) dr.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a.q-d-sublink');
        if (a && !wideMQ().matches) setDrawer(false, { silent: true });
      });
      d.addEventListener('keydown', trapFocus);
      var mq = wideMQ();
      if (mq.addEventListener) mq.addEventListener('change', function () { if (dr && dr.classList.contains('is-open')) setDrawer(true, { silent: true }); });
      if (mq.matches && store('qwatt.drawer') === '1') setDrawer(true, { silent: true });
      var th = d.getElementById('qTheme'); if (th) th.addEventListener('click', toggleTheme);
      var ls = d.querySelectorAll('.q-lang-b');
      for (var i = 0; i < ls.length; i++) ls[i].addEventListener('click', function () { applyLang(this.getAttribute('data-lang'), true); typeEyebrow(); });
      applyLang(lang(), false);
      scrollSpy(); reveal(); typeEyebrow(); copyButtons(); relClock();
      var S = root.QWATT_STATUS;
      if (S && S.load) S.load().then(function () { S.applyStatusOf(d); }, function () { /* stamped chips stay as they are */ });
    };
    var started = false;
    var once = function () { if (!started) { started = true; start(); } };
    /* Deferred scripts run before DOMContentLoaded: wait for it, so every module (status, live) is loaded. */
    if (d.readyState === 'complete') once(); else { d.addEventListener('DOMContentLoaded', once); root.addEventListener('load', once); }
  }

  return api;
}));
