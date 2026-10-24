/**
 * QWATT — live testnet widgets
 * ---------------------------------------------------------------------------
 * Declarative: every element with data-widget="<name>" is mounted on load.
 * Each widget reads Stellar testnet through QWATT_LIVE only (read-only, public
 * addresses), shows a skeleton while it reads, one of four plain error states
 * when it cannot, and a source badge next to every number. Nothing is signed,
 * sent or stored. Re-renders on language change; pauses while the tab is hidden.
 *
 * Widgets: ledger-livecard, ledger-chart, week-tx, anchor-slot, account-card,
 * rehearsal-match, rehearsal-energy, tx-anatomy, tests-abcd.
 */
(function (root) {
  'use strict';
  var d = root.document;
  var S = root.QWATT_SITE, L = root.QWATT_LIVE;
  if (!d || !S || !L) return;
  var C = L.CONFIG;
  var pair = S.pair, esc = S.esc, num = S.num, badge = S.badge;

  var mounted = [];
  var netCheck = null;
  function guard() { if (!netCheck) netCheck = L.network().catch(function (e) { netCheck = null; throw e; }); return netCheck; }

  function hhmm() { return S.fmtTime().slice(0, 5); }
  function errHTML(e) {
    var code = (e && e.code) || 'offline';
    var key = code === 'rate-limited' ? 'limited' : code === 'not-found' ? 'notFound' : code === 'wrong-network' ? 'wrongNet' : 'offline';
    return '<p class="q-err" role="status" data-kind="' + esc(code) + '">' + pair(key, { t: hhmm() }) + '</p>';
  }
  function loadingHTML() { return '<p class="q-fallback is-loading"><span class="q-skel" aria-hidden="true"></span> ' + pair('reading') + '</p>'; }
  function vivo() { return badge('vivo', { t: S.fmtTime() }); }
  function ensayo() {
    return badge('ensayo', null, { es: S.SRC.ensayo.es + ' · leído ' + S.fmtTime(), en: S.SRC.ensayo.en + ' · read ' + S.fmtTime() });
  }
  function state(kind, words) { return '<span class="q-state" data-state="' + kind + '">' + pair(words) + '</span>'; }
  var W = {
    match: { es: '✓ COINCIDE', en: '✓ MATCHES' }, nomatch: { es: '✗ NO COINCIDE', en: '✗ DOES NOT MATCH' },
    ok: { es: '✓ CORRECTO', en: '✓ CORRECT' }, fail: { es: '✗ FALLA', en: '✗ FAILS' }, goal: { es: '○ OBJETIVO', en: '○ TARGET' },
    planned: { es: '○ EN PREPARACIÓN (SEMANA 2)', en: '○ IN PREPARATION (WEEK 2)' }
  };
  function slot(el) { return el.querySelector('[data-slot]') || el; }
  function accountFrom(attr) {
    if (!attr) return null;
    if (/^G[A-Z2-7]{55}$/.test(attr)) return attr;
    var v = attr.split('.').reduce(function (o, k) { return o && o[k]; }, C);
    return typeof v === 'string' ? v : v && v.account;
  }

  /* A widget = { el, run(fresh) → Promise, render() }. run() fetches, render() draws the last data. */
  function widget(el, fetcher, draw, opts) {
    opts = opts || {};
    var w = { el: el, data: null, error: null, timer: null };
    w.render = function () {
      var out = slot(el);
      if (w.error) { out.innerHTML = (w.data ? draw(w.data) : '') + errHTML(w.error); return; }
      if (!w.data) { out.innerHTML = loadingHTML(); return; }
      out.innerHTML = draw(w.data);
    };
    w.run = function (fresh) {
      clearTimeout(w.timer);
      if (!w.data) w.render();
      var net = opts.needsNet && !opts.needsNet() ? Promise.resolve() : guard();
      return net.then(function () { return fetcher(fresh); }).then(function (data) {
        w.data = data; w.error = null; w.render();
        if (opts.every) w.timer = setTimeout(function again() { if (d.hidden) { w.timer = setTimeout(again, 5000); return; } w.run(true); }, opts.every);
      }, function (e) {
        w.error = e; w.render();
        if (e && e.code === 'wrong-network') return;
        w.timer = setTimeout(function () { w.run(true); }, e && e.code === 'rate-limited' ? 60000 : 30000);
      });
    };
    mounted.push(w);
    return w;
  }

  /* ───────────────────────── ledger-livecard ───────────────────────── */
  function ledgerLivecard(el) {
    var w = { el: el, seq: null, closedAt: null, gaps: [], error: null, mode: null, stop: null };
    function spark() {
      if (w.gaps.length < 2) return '';
      var max = Math.max.apply(null, w.gaps.concat([8])), n = w.gaps.length, wd = 220, ht = 34;
      var pts = w.gaps.map(function (g, i) { return (i * wd / (n - 1)).toFixed(1) + ',' + (ht - (g / max) * (ht - 4) - 2).toFixed(1); }).join(' ');
      return '<svg class="q-spark" viewBox="0 0 ' + wd + ' ' + ht + '" aria-hidden="true" preserveAspectRatio="none"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
    }
    function avg() { return w.gaps.length ? w.gaps.reduce(function (a, b) { return a + b; }, 0) / w.gaps.length : null; }
    w.render = function () {
      var out = slot(el);
      if (w.error && w.error.code === 'wrong-network') { out.innerHTML = errHTML(w.error); return; }
      if (w.seq == null) { out.innerHTML = (w.error ? errHTML(w.error) : loadingHTML()) + '<p class="q-lc-anchor">' + anchorLine() + '</p>'; return; }
      var a = avg();
      out.innerHTML =
        '<p class="q-lc-label">' + pair({ es: 'Último ledger', en: 'Latest ledger' }) + '</p>' +
        '<p class="q-lc-big">' + num(S.fmtNum(w.seq), 'vivo') + '</p>' +
        '<p class="q-lc-sub">' + pair({ es: 'cerrado ', en: 'closed ' }) + '<span data-ago="' + esc(w.closedAt || '') + '">' + pair('agoS', { n: 0 }) + '</span> · ' +
          pair({ es: 'frase de red de testnet ✓', en: 'testnet passphrase ✓' }) + '</p>' +
        spark() +
        (a ? '<p class="q-lc-sub">' + pair({ es: 'cierre promedio de los últimos {n} ledgers: ', en: 'average close of the last {n} ledgers: ' }, { n: w.gaps.length }) + num(a.toFixed(1).replace('.', S.lang() === 'en' ? '.' : ','), 'vivo') + ' s</p>' : '') +
        vivo() + (w.error ? errHTML(w.error) : '') +
        '<p class="q-lc-anchor">' + anchorLine() + '</p>';
    };
    function push(l) {
      if (w.closedAt && l.closedAt && l.sequence > w.seq) {
        var g = (Date.parse(l.closedAt) - Date.parse(w.closedAt)) / 1000 / Math.max(1, l.sequence - w.seq);
        if (g > 0 && g < 120) { w.gaps.push(g); if (w.gaps.length > 20) w.gaps.shift(); }
      }
      if (w.seq == null || l.sequence >= w.seq) { w.seq = l.sequence; w.closedAt = l.closedAt; }
      w.error = null; w.render();
    }
    w.run = function () {
      if (w.stop) w.stop();
      w.render();
      guard().then(function () { return L.ledgers(21); }).then(function (ls) {
        ls = ls.slice().reverse();
        w.gaps = [];
        for (var i = 1; i < ls.length; i++) w.gaps.push((Date.parse(ls[i].closedAt) - Date.parse(ls[i - 1].closedAt)) / 1000);
        var last = ls[ls.length - 1]; w.seq = last.sequence; w.closedAt = last.closedAt; w.render();
        w.stop = L.streamLedgers(push, function (s) { if (s !== 'stream' && s !== 'poll') { w.error = { code: s }; w.render(); } });
      }, function (e) { w.error = e; w.render(); if (e.code !== 'wrong-network') setTimeout(w.run, e.code === 'rate-limited' ? 60000 : 30000); });
    };
    mounted.push(w);
    return w;
  }
  function anchorLine() {
    if (!C.ANCHOR_ACCOUNT) return pair({ es: 'Cuenta de anclaje 2 de 3: en preparación (semana 2)', en: '2-of-3 anchoring account: in preparation (week 2)' });
    return pair({ es: 'Cuenta de anclaje 2 de 3: ', en: '2-of-3 anchoring account: ' }) + '<span translate="no">' + esc(S.shortKey(C.ANCHOR_ACCOUNT)) + '</span>';
  }

  /* ───────────────────────── week-tx ───────────────────────── */
  function coreAccounts() {
    return [C.AUGUST.assetAccount, C.AUGUST.markerDestination, C.REHEARSAL.abcd.account, C.REHEARSAL.e2e.account, C.REHEARSAL.dress.account, C.REHEARSAL.asset.account];
  }
  function weekTx(el) {
    var n = +(el.getAttribute('data-week') || 1);
    var compact = el.hasAttribute('data-compact');
    return widget(el, function () {
      var wk = C.WEEKS.filter(function (x) { return x.n === n; })[0];
      var after = wk.to, nowIso = new Date(Date.now() + 86400000).toISOString();
      return Promise.all(coreAccounts().map(function (g) {
        return Promise.all([L.txCount(g, wk.from, wk.to), L.txCount(g, after, nowIso)]).then(function (r) { return { g: g, week: r[0], since: r[1] }; });
      }));
    }, function (rows) {
      var total = rows.reduce(function (a, r) { return a + r.week.count; }, 0);
      var since = rows.reduce(function (a, r) { return a + r.since.count; }, 0);
      var st = total === 0 ? state('ok', { es: '✓ 0, COMO ESPERÁBAMOS', en: '✓ 0, AS EXPECTED' }) : state('fail', { es: '✗ ESPERÁBAMOS 0', en: '✗ WE EXPECTED 0' });
      if (compact) {
        return '<p class="q-hl-live">' + pair({ es: 'Leído ahora en las 6 cuentas: ', en: 'Read now on the 6 accounts: ' }) + num(String(total), 'vivo') +
          pair({ es: ' transacciones entre el lun 19 y el vie 23 oct', en: ' transactions from Mon 19 to Fri 23 Oct' }) + ' ' + st + '</p>' + vivo();
      }
      var list = rows.map(function (r) {
        return '<li><span translate="no">' + esc(S.shortKey(r.g)) + '</span> · ' + num(String(r.week.count), 'vivo') + ' · ' +
          (r.week.notFound ? pair('notFound') : pair({ es: 'última: ', en: 'last: ' }) + (r.week.last ? esc(S.fmtDate(r.week.last)) : '—')) + '</li>';
      }).join('');
      return '<p class="q-tile-v">' + num(String(total), 'vivo') + '</p>' +
        '<p class="q-tile-s">' + st + ' · ' + pair({ es: 'desde el 24 oct: ', en: 'since 24 Oct: ' }) + num(String(since), 'vivo') + '</p>' + vivo() +
        '<details class="q-more"><summary>' + pair({ es: 'Cuentas revisadas (6)', en: 'Accounts checked (6)' }) + '</summary>' +
        '<p class="q-note">' + pair({ es: 'Las dos cuentas de agosto y las cuatro cuentas desechables del ensayo del 8 oct.', en: 'The two August accounts and the four throwaway accounts of the 8 Oct rehearsal.' }) + '</p>' +
        '<ul class="q-mini">' + list + '</ul></details>';
    }, { every: 60000 });
  }

  /* ───────────────────────── anchor-slot ───────────────────────── */
  function anchorSlot(el) {
    var compact = el.hasAttribute('data-compact');
    return widget(el, function () {
      if (!C.ANCHOR_ACCOUNT) return Promise.resolve({ planned: true });
      return L.account(C.ANCHOR_ACCOUNT).then(function (a) { return { a: a }; });
    }, function (r) {
      if (r.planned) {
        if (compact) return '<p>' + anchorLine() + '</p>' + badge('plan');
        return '<p class="q-tile-v q-plan">' + pair({ es: 'en preparación (semana 2)', en: 'in preparation (week 2)' }) + '</p>' +
          '<ul class="q-checks">' +
          '<li>' + state('goal', W.goal) + pair({ es: 'umbrales 2/2/3', en: 'thresholds 2/2/3' }) + '</li>' +
          '<li>' + state('goal', W.goal) + pair({ es: 'tres firmantes de peso 1', en: 'three signers of weight 1' }) + '</li>' +
          '<li>' + state('goal', W.goal) + pair({ es: 'clave con que se creó la cuenta en peso 0', en: 'the key that created the account at weight 0' }) + '</li></ul>' +
          badge('plan');
      }
      var a = r.a;
      if (!a.exists) return errHTML({ code: 'not-found' });
      var c = L.check223(a);
      var row = function (ok, words) { return '<li>' + state(ok ? 'ok' : 'fail', ok ? W.ok : W.fail) + pair(words) + '</li>'; };
      var w1 = a.signers.filter(function (s) { return s.key !== a.id && s.weight === 1; }).length;
      return '<p class="q-tile-s">' + pair({ es: 'Umbrales leídos ahora: ', en: 'Thresholds read now: ' }) + num(a.thresholds.low + '/' + a.thresholds.med + '/' + a.thresholds.high, 'vivo') +
        ' · ' + pair({ es: 'firmantes de peso 1: ', en: 'signers of weight 1: ' }) + num(String(w1), 'vivo') + ' · ' + pair({ es: 'clave maestra: peso ', en: 'master key: weight ' }) + num(String(a.masterWeight), 'vivo') + '</p>' +
        '<ul class="q-checks">' + row(c.low2 && c.med2 && c.high3, { es: 'umbrales 2/2/3', en: 'thresholds 2/2/3' }) + row(c.threeSignersW1, { es: 'tres firmantes de peso 1', en: 'three signers of weight 1' }) +
        row(c.masterZero, { es: 'clave maestra en peso 0', en: 'master key at weight 0' }) + '</ul>' + vivo();
    }, { every: 60000, needsNet: function () { return !!C.ANCHOR_ACCOUNT; } });
  }

  /* ───────────────────────── account-card ───────────────────────── */
  function accountCard(el) {
    var g = accountFrom(el.getAttribute('data-account'));
    return widget(el, function () {
      return Promise.all([L.account(g), L.txs(g, { limit: 1 }).catch(function () { return []; })]).then(function (r) { return { a: r[0], last: r[1][0] || null }; });
    }, function (r) {
      var a = r.a;
      if (!a.exists) return errHTML({ code: 'not-found' });
      var one = L.canOneKeySend(a);
      return '<dl class="q-dl">' +
        '<dt>' + pair({ es: 'Dirección pública', en: 'Public address' }) + '</dt><dd><code translate="no">' + esc(S.shortKey(g)) + '</code></dd>' +
        '<dt>' + pair({ es: 'Umbrales bajo/medio/alto', en: 'Thresholds low/medium/high' }) + '</dt><dd>' + num(a.thresholds.low + '/' + a.thresholds.med + '/' + a.thresholds.high, 'vivo') + '</dd>' +
        '<dt>' + pair({ es: 'Firmantes con peso', en: 'Signers with weight' }) + '</dt><dd>' + num(String(a.signers.filter(function (s) { return s.weight > 0; }).length), 'vivo') + '</dd>' +
        '<dt>' + pair({ es: 'Peso de la clave maestra', en: 'Master key weight' }) + '</dt><dd>' + num(String(a.masterWeight), 'vivo') + '</dd>' +
        '<dt translate="no">home_domain</dt><dd>' + (a.homeDomain ? '<code translate="no">' + esc(a.homeDomain) + '</code>' : pair({ es: 'no configurado', en: 'not set' })) + '</dd>' +
        '<dt>' + pair({ es: 'Última transacción', en: 'Last transaction' }) + '</dt><dd>' + (r.last ? esc(S.fmtDate(r.last.createdAt)) : '—') + '</dd>' +
        '<dt>' + pair({ es: '¿Una sola clave puede enviar una transacción?', en: 'Can a single key send a transaction?' }) + '</dt><dd>' +
          (one ? state('fail', { es: 'SÍ', en: 'YES' }) : state('ok', { es: 'NO', en: 'NO' })) + '</dd></dl>' + vivo();
    }, { every: 60000 });
  }

  /* ───────────────────────── rehearsal-match ───────────────────────── */
  function rehearsalMatch(el) {
    var R = C.REHEARSAL.abcd;
    return widget(el, function () {
      return Promise.all([L.account(R.account), L.evidence(R.evidence)]).then(function (r) { return { a: r[0], ev: r[1] }; });
    }, function (r) {
      var a = r.a, ev = r.ev;
      if (!a.exists) return errHTML({ code: 'not-found' });
      var onHash = a.data['qwatt.anchor.sha256'], onTotal = a.data['qwatt.cumulative_mwh'];
      var lastBatch = (ev.batches || [])[(ev.batches || []).length - 1] || {};
      var hashOk = onHash && onHash === ev.onchain_anchor_after;
      var totalOk = onTotal != null && String(lastBatch.cumulative_mwh) === String(onTotal);
      var w1 = a.signers.filter(function (s) { return s.key !== a.id && s.weight === 1; }).length;
      return '<ul class="q-checks">' +
        '<li>' + state(hashOk ? 'ok' : 'fail', hashOk ? W.match : W.nomatch) + pair({ es: 'huella ', en: 'fingerprint ' }) + '<code translate="no">' + esc(S.shortHash(onHash)) + '</code></li>' +
        '<li>' + state(totalOk ? 'ok' : 'fail', totalOk ? W.match : W.nomatch) + pair({ es: 'total ', en: 'total ' }) + num(S.fmtNum(+onTotal), 'ensayo') + ' mWh</li></ul>' +
        '<p class="q-tile-s">' + pair({ es: 'Umbrales del ensayo leídos ahora: ', en: 'Rehearsal thresholds read now: ' }) + num(a.thresholds.low + '/' + a.thresholds.med + '/' + a.thresholds.high, 'vivo') +
        ' · ' + num(String(w1), 'vivo') + pair({ es: ' firmantes de peso 1 · maestra en peso ', en: ' signers of weight 1 · master at weight ' }) + num(String(a.masterWeight), 'vivo') +
        pair({ es: ' (diseño anterior; la cuenta definitiva tendrá 2/2/3)', en: ' (earlier design; the real account will use 2/2/3)' }) + '</p>' + ensayo();
    }, { every: 60000 });
  }

  /* ───────────────────────── rehearsal-energy ───────────────────────── */
  function rehearsalEnergy(el) {
    var key = el.getAttribute('data-rehearsal') || 'dress';
    var R = C.REHEARSAL[key];
    return widget(el, function () {
      return Promise.all([L.account(R.account), L.anchors(R.account).catch(function () { return null; })]).then(function (r) { return { a: r[0], an: r[1] }; });
    }, function (r) {
      if (!r.a.exists) return errHTML({ code: 'not-found' });
      var mwh = +r.a.data['qwatt.cumulative_mwh'];
      var kwh = (mwh / 1e6).toFixed(2);
      var last = r.an && r.an.length ? r.an[r.an.length - 1] : null;
      return '<p class="q-tile-v">' + num(S.fmtNum(mwh), 'ensayo') + ' <small>mWh</small></p>' +
        '<p class="q-tile-s">≈ ' + num(S.lang() === 'en' ? kwh : kwh.replace('.', ','), 'ensayo') + ' kWh · ' +
        (r.an ? num(String(r.an.length), 'ensayo') + pair({ es: ' anclajes', en: ' anchors' }) + (last && last.memoShown ? ' · ' + pair({ es: 'último ', en: 'last ' }) + '<span translate="no">' + esc(last.memoShown) + '</span> · ' + esc(S.fmtDate(last.createdAt)) : '') : '') + '</p>' + ensayo();
    }, { every: 120000 });
  }

  /* ───────────────────────── tx-anatomy ───────────────────────── */
  function txAnatomy(el) {
    var ref = el.getAttribute('data-tx') || 'testC';
    var hash = /^[0-9a-f]{64}$/.test(ref) ? ref : C.REHEARSAL.abcd[ref];
    return widget(el, function () {
      return Promise.all([L.tx(hash), L.ops(hash)]).then(function (r) { return { t: r[0], ops: r[1] }; });
    }, function (r) {
      var t = r.t;
      var rows = r.ops.map(function (o, i) {
        var k = '<span class="q-op-n">op ' + (i + 1) + '</span> ';
        if (o.type === 'manage_data' && o.name === 'qwatt.anchor.sha256') return '<li>' + k + '<code translate="no">qwatt.anchor.sha256</code> = <code translate="no">' + esc(S.shortHash(o.value)) + '</code></li>';
        if (o.type === 'manage_data' && o.name === 'qwatt.cumulative_mwh') return '<li>' + k + '<code translate="no">qwatt.cumulative_mwh</code> = ' + num(S.fmtNum(+o.value), 'ensayo') + ' mWh</li>';
        if (o.type === 'payment') return '<li>' + k + pair('marker') + '</li>';
        return '<li>' + k + '<code translate="no">' + esc(o.type) + '</code></li>';
      }).join('');
      return '<ul class="q-checks">' +
        '<li>' + state(t.ok ? 'ok' : 'fail', t.ok ? { es: '✓ EXITOSA', en: '✓ SUCCESSFUL' } : { es: '✗ FALLIDA', en: '✗ FAILED' }) +
          pair({ es: 'ledger ', en: 'ledger ' }) + num(S.fmtNum(t.ledger), 'vivo') + ' · ' + esc(S.fmtDate(t.createdAt)) + '</li>' +
        '<li>' + (t.signatures.length >= 2 ? state('ok', { es: '✓ DOS FIRMAS', en: '✓ TWO SIGNATURES' }) : state('fail', { es: '✗ UNA FIRMA', en: '✗ ONE SIGNATURE' })) + num(String(t.signatures.length), 'vivo') + pair({ es: ' firmas · memo ', en: ' signatures · memo ' }) +
          (t.memoShown ? '<span translate="no">' + esc(t.memoShown) + '</span>' : pair('memoHidden')) + '</li></ul>' +
        '<ol class="q-ops">' + rows + '</ol>' +
        '<p class="q-tile-s"><a class="q-link" href="' + esc(C.EXPLORER + '/tx/' + t.hash) + '" target="_blank" rel="noopener">' + pair({ es: 'Ver en stellar.expert', en: 'View on stellar.expert' }) +
          '<span class="q-ext" aria-hidden="true">↗</span><span class="q-vh">' + pair('newTab') + '</span></a></p>' + ensayo();
    });
  }

  /* ───────────────────────── tests-abcd (compact) ───────────────────────── */
  function testsAbcd(el) {
    var R = C.REHEARSAL.abcd;
    return widget(el, function () { return L.evidence(R.evidence); }, function (ev) {
      var s = ev.steps || {};
      var row = function (k, label, ok, words) { return s[k] ? '<li>' + state(ok ? 'ok' : 'fail', words) + pair(label) + '</li>' : ''; };
      var refused = function (x) { return x && (x.ok === false || x.refused === true); };
      return '<ul class="q-checks">' +
        row('A_proposer_alone', { es: 'A · el proponente solo: nunca entró a un ledger', en: 'A · proposer alone: never entered a ledger' }, refused(s.A_proposer_alone), { es: '⊘ RECHAZADA', en: '⊘ REFUSED' }) +
        row('B_verifier_alone', { es: 'B · el verificador solo: nunca entró a un ledger', en: 'B · verifier alone: never entered a ledger' }, refused(s.B_verifier_alone), { es: '⊘ RECHAZADA', en: '⊘ REFUSED' }) +
        row('C_proposer_plus_verifier', { es: 'C · los dos: anclada en QW#0', en: 'C · both: anchored as QW#0' }, s.C_proposer_plus_verifier && s.C_proposer_plus_verifier.ok, { es: '✓ ANCLADA', en: '✓ ANCHORED' }) +
        row('D_altered_after_proposer_signed', { es: 'D · lote alterado: el verificador lo rechazó (verifier.hash_mismatch)', en: 'D · altered batch: the verifier refused it (verifier.hash_mismatch)' }, refused(s.D_altered_after_proposer_signed), { es: '⊘ RECHAZADO', en: '⊘ REFUSED' }) +
        '</ul>' + badge('ensayo');
    }, { needsNet: function () { return false; } });
  }

  /* ───────────────────────── ledger-chart ───────────────────────── */
  function ledgerChart(el) {
    var n = +(el.getAttribute('data-n') || 50);
    var w = widget(el, function () { return L.ledgers(200); }, draw, { every: 60000 });
    function draw(all) {
      var ls = all.slice(0, n + 1).reverse();
      var pts = [];
      for (var i = 1; i < ls.length; i++) pts.push({ seq: ls[i].sequence, s: (Date.parse(ls[i].closedAt) - Date.parse(ls[i - 1].closedAt)) / 1000, ops: ls[i].ops, at: ls[i].closedAt });
      if (!pts.length) return loadingHTML();
      var avg = pts.reduce(function (a, p) { return a + p.s; }, 0) / pts.length;
      var maxS = Math.max.apply(null, pts.map(function (p) { return p.s; }).concat([8]));
      var maxO = Math.max.apply(null, pts.map(function (p) { return p.ops; }).concat([1]));
      var W0 = 960, H0 = 220, pad = 28, bw = (W0 - pad) / pts.length;
      var x = function (i) { return pad + i * bw + bw / 2; };
      var yS = function (s) { return H0 - 18 - (s / maxS) * (H0 - 36); };
      var bars = pts.map(function (p, i) { var h = (p.ops / maxO) * (H0 - 36) * 0.55; return '<rect class="q-ch-bar" x="' + (x(i) - bw * 0.35).toFixed(1) + '" y="' + (H0 - 18 - h).toFixed(1) + '" width="' + Math.max(1, bw * 0.7).toFixed(1) + '" height="' + h.toFixed(1) + '"/>'; }).join('');
      var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + yS(p.s).toFixed(1); }).join(' ');
      var grid = [0, 5, 10].filter(function (v) { return v <= maxS; }).map(function (v) { return '<line class="q-ch-grid" x1="' + pad + '" x2="' + W0 + '" y1="' + yS(v).toFixed(1) + '" y2="' + yS(v).toFixed(1) + '"/><text class="q-ch-lab" x="2" y="' + (yS(v) + 3).toFixed(1) + '">' + v + 's</text>'; }).join('');
      var avgS = avg.toFixed(1);
      var hits = pts.map(function (p, i) { return '<rect class="q-ch-hit" x="' + (x(i) - bw / 2).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + H0 + '" data-i="' + i + '"/>'; }).join('');
      el._pts = pts;
      var rows = pts.slice(-20).reverse().map(function (p) { return '<tr><td>' + num(S.fmtNum(p.seq), 'vivo') + '</td><td>' + num(p.s.toFixed(1), 'vivo') + '</td><td>' + num(String(p.ops), 'vivo') + '</td><td>' + esc(S.fmtTime(p.at)) + '</td></tr>'; }).join('');
      return '<div class="q-ch-box"><svg class="q-chart" viewBox="0 0 ' + W0 + ' ' + H0 + '" role="img" aria-label="' + esc(S.t({ es: 'Segundos entre ledgers y operaciones por ledger', en: 'Seconds between ledgers and operations per ledger' })) + '">' +
        grid + bars + '<path class="q-ch-line" d="' + line + '"/>' + hits + '</svg><div class="q-ch-tip" hidden></div></div>' +
        '<p class="q-tile-s">' + pair({ es: 'cierre promedio medido ahora: ', en: 'average close measured now: ' }) + num(S.lang() === 'en' ? avgS : avgS.replace('.', ','), 'vivo') + ' s · ' +
        pair({ es: 'últimos {n} ledgers', en: 'last {n} ledgers' }, { n: pts.length }) + '</p>' + vivo() +
        '<details class="q-more"><summary>' + pair({ es: 'Ver los últimos 20 como tabla', en: 'Show the last 20 as a table' }) + '</summary><div class="q-table-wrap"><table class="q-table">' +
        '<caption>' + pair({ es: 'Últimos ledgers de Stellar testnet', en: 'Latest Stellar testnet ledgers' }) + '</caption><thead><tr><th scope="col">' + pair({ es: 'Ledger', en: 'Ledger' }) + '</th><th scope="col">' + pair({ es: 'Segundos', en: 'Seconds' }) +
        '</th><th scope="col">' + pair({ es: 'Operaciones', en: 'Operations' }) + '</th><th scope="col">' + pair({ es: 'Hora', en: 'Time' }) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>';
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-n]');
      if (!b || b === el) return;
      n = +b.getAttribute('data-n');
      var bs = el.querySelectorAll('button[data-n]');
      for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i] === b ? 'true' : 'false');
      w.render();
    });
    el.addEventListener('mousemove', function (e) {
      var hit = e.target.closest && e.target.closest('.q-ch-hit');
      var tip = el.querySelector('.q-ch-tip');
      if (!tip) return;
      if (!hit || !el._pts) { tip.hidden = true; return; }
      var p = el._pts[+hit.getAttribute('data-i')];
      tip.innerHTML = pair({ es: 'Ledger {q} · {s} s · {o} operaciones · {t}', en: 'Ledger {q} · {s} s · {o} operations · {t}' }, { q: S.fmtNum(p.seq), s: p.s.toFixed(1), o: p.ops, t: S.fmtTime(p.at) });
      var box = el.querySelector('.q-ch-box').getBoundingClientRect();
      tip.style.left = Math.min(box.width - 180, Math.max(0, e.clientX - box.left + 10)) + 'px';
      tip.style.top = Math.max(0, e.clientY - box.top - 40) + 'px';
      tip.hidden = false;
    });
    el.addEventListener('mouseleave', function () { var tip = el.querySelector('.q-ch-tip'); if (tip) tip.hidden = true; });
    return w;
  }

  var REGISTRY = {
    'ledger-livecard': ledgerLivecard, 'ledger-chart': ledgerChart, 'week-tx': weekTx, 'anchor-slot': anchorSlot,
    'account-card': accountCard, 'rehearsal-match': rehearsalMatch, 'rehearsal-energy': rehearsalEnergy,
    'tx-anatomy': txAnatomy, 'tests-abcd': testsAbcd
  };

  function start() {
    var els = d.querySelectorAll('[data-widget]');
    if (!els.length) return;
    L.ready().then(function () {
      for (var i = 0; i < els.length; i++) {
        var f = REGISTRY[els[i].getAttribute('data-widget')];
        if (f) f(els[i]).run(false);
      }
    });
    d.addEventListener('visibilitychange', function () {
      if (d.hidden) L.pause(); else { L.resume(); }
      var p = d.querySelectorAll('[data-paused-note]');
      for (var j = 0; j < p.length; j++) p[j].hidden = !d.hidden;
    });
    d.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-refresh]');
      if (!b) return;
      netCheck = null;
      mounted.forEach(function (w) { if (w.run) w.run(true); });
    });
    S.onLang(function () { mounted.forEach(function (w) { if (w.render) w.render(); }); });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();

  root.QWATT_WIDGETS = { mount: function (el) { var f = REGISTRY[el.getAttribute('data-widget')]; if (f) f(el).run(false); } };
}(typeof self !== 'undefined' ? self : this));
