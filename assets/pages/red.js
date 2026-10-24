/**
 * QWATT Pulse (TESTNET): read-only activity of every project account on Stellar testnet.
 *
 * - Transactions per sprint week (Mon 00:00 to Sat 00:00, Chile time, from status.json
 *   through QWATT_LIVE.CONFIG.WEEKS), weekend transactions apart, over the two August
 *   accounts of stellar.toml and every public key of the four 8 Oct evidence files.
 * - Published evidence vs Horizon: each evidence file (same origin) compared with what
 *   the account holds now on Stellar testnet.
 * - A feed of anchors (memo QW#n only; every other memo stays hidden), filterable by period.
 * - A watch list for any public G… address the visitor types, kept in memory only. An
 *   input shaped like a secret key is cleared at once, never read further or stored.
 * - The independence test from the published end-to-end evidence.
 *
 * Every read goes through assets/qwatt-live.js (Horizon testnet only, no SDK, no signing).
 * Explorer links only for the rehearsal accounts and their transactions (never the
 * August accounts). Refresh every 60 s while the tab is visible.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE, L = root.QWATT_LIVE;
  if (!d || !S || !L) return;
  var pair = S.pair, esc = S.esc, C = L.CONFIG;
  function $(id) { return d.getElementById(id); }
  function hhmm() { return S.fmtTime().slice(0, 5); }
  function vivo() { return S.badge('vivo', { t: S.fmtTime() }); }
  function state(kind, words) { return '<span class="q-state" data-state="' + kind + '">' + pair(words) + '</span>'; }
  function errP(e) {
    var code = (e && e.code) || 'offline';
    var key = code === 'rate-limited' ? 'limited' : code === 'not-found' ? 'notFound' : code === 'wrong-network' ? 'wrongNet' : 'offline';
    return '<p class="q-err" role="status" data-kind="' + esc(code) + '">' + pair(key, { t: hhmm() }) + '</p>';
  }
  function loading() { return '<p class="q-note"><span class="q-skel" aria-hidden="true"></span> ' + pair('reading') + '</p>'; }
  function newTab() { return '<span class="q-ext" aria-hidden="true">↗</span><span class="q-vh">' + pair('newTab') + '</span>'; }

  var REH = {
    abcd: { es: 'Ensayo de las pruebas A–D', en: 'Tests A–D rehearsal' },
    dress: { es: 'Ensayo acelerado', en: 'Accelerated rehearsal' },
    e2e: { es: 'Ensayo de punta a punta', en: 'End-to-end rehearsal' },
    asset: { es: 'Ensayo del activo de testnet', en: 'Testnet asset rehearsal' }
  };
  var ROLE = {
    account: { es: 'cuenta de anclaje del ensayo', en: 'rehearsal anchoring account' },
    proposer: { es: 'clave del proponente', en: 'proposer key' },
    verifier: { es: 'clave del verificador', en: 'verifier key' },
    third: { es: 'tercera clave', en: 'third key' },
    destination: { es: 'destino del pago marcador', en: 'marker payment destination' },
    other: { es: 'otra cuenta del ensayo', en: 'other rehearsal account' }
  };
  var AUG = { es: 'Cuenta de agosto (activo de testnet, solo vehículo de anclaje)', en: 'August account (testnet asset, anchoring vehicle only)' };
  var AUG2 = { es: 'Cuenta de agosto, destino del pago marcador', en: 'August account, marker payment destination' };
  function isAugust(g) { return g === C.AUGUST.assetAccount || g === C.AUGUST.markerDestination; }
  function txLink(t, g) {
    if (isAugust(g) || isAugust(t.sourceAccount)) return '';   /* never link August transactions (D-10) */
    return '<a class="q-link" href="' + esc(C.EXPLORER + '/tx/' + t.hash) + '" target="_blank" rel="noopener">' + pair({ es: 'ver', en: 'view' }) + newTab() + '</a>';
  }

  /* ═════════════════ the accounts: stellar.toml + the four evidence files ═════════════════ */
  var evidence = {};      // key → parsed file
  var accounts = [];      // { g, label:{es,en}, reh, signer }
  /* roles whose keys only sign: they have no account of their own, so they are read with /accounts?signer= (never a 404) */
  var SIGNING = { proposer: true, verifier: true, third: true };
  function loadEvidence() {
    var keys = Object.keys(REH);
    return Promise.all(keys.map(function (k) {
      return L.evidence(C.REHEARSAL[k].evidence).then(function (j) { evidence[k] = j; }, function () { evidence[k] = null; });
    })).then(function () {
      var seen = {};
      var add = function (g, label, reh, signer) { if (!seen[g] && L.isPublicKey(g)) { seen[g] = true; accounts.push({ g: g, label: label, reh: reh || null, signer: !!signer }); } };
      add(C.AUGUST.assetAccount, AUG, null);
      add(C.AUGUST.markerDestination, AUG2, null);
      keys.forEach(function (k) {
        add(C.REHEARSAL[k].account, { es: REH[k].es + ' · ' + ROLE.account.es, en: REH[k].en + ' · ' + ROLE.account.en }, k);
        var pk = evidence[k] && evidence[k].public_keys;
        if (pk) Object.keys(pk).forEach(function (role) {
          var r = ROLE[role] || ROLE.other;
          add(pk[role], { es: REH[k].es + ' · ' + r.es, en: REH[k].en + ' · ' + r.en }, k, SIGNING[role]);
        });
      });
      if (C.ANCHOR_ACCOUNT) add(C.ANCHOR_ACCOUNT, { es: 'Cuenta de anclaje 2 de 3', en: '2-of-3 anchoring account' }, null);
    });
  }

  /* ═════════════════ transactions per sprint week ═════════════════ */
  function periods() {
    var W = C.WEEKS, far = '2100-01-01T00:00:00Z';
    var w = function (n) { return W.filter(function (x) { return x.n === n; })[0]; };
    var w1 = w(1), w2 = w(2), w3 = w(3);
    return [
      { id: 'w1', kind: 'week', es: 'Semana 1 · lun 19 – vie 23 oct', en: 'Week 1 · Mon 19 – Fri 23 Oct', from: w1.from, to: w1.to, expect0: true },
      { id: 'w2', kind: 'week', es: 'Semana 2 · lun 26 – vie 30 oct', en: 'Week 2 · Mon 26 – Fri 30 Oct', from: w2.from, to: w2.to },
      { id: 'w3', kind: 'week', es: 'Semana 3 · lun 2 – vie 6 nov', en: 'Week 3 · Mon 2 – Fri 6 Nov', from: w3.from, to: w3.to },
      { id: 'run', kind: 'week', es: 'Corrida contada · dom 8 – dom 15 nov', en: 'Counted run · Sun 8 – Sun 15 Nov', from: C.RUN.from, to: C.RUN.to },
      { id: 'off', kind: 'gaps', es: 'Fuera de semana (fines de semana del sprint)', en: 'Outside the weeks (sprint weekends)',
        gaps: [[w1.to, w2.from], [w2.to, w3.from], [w3.to, C.RUN.from], [C.RUN.to, far]] }
    ];
  }
  var weekData = null, weekErr = null;
  function countAll() {
    var now = Date.now(), ps = periods(), soon = new Date(now + 86400000).toISOString();
    var jobs = [];
    accounts.forEach(function (a) {
      if (a.signer) jobs.push(L.signerOf(a.g).then(function (list) { a.signsFor = list; }));
      else jobs.push(L.txCount(a.g, C.SPRINT_START, soon).then(function (r) { a.since = r.count; a.last = r.last; a.notFound = r.notFound; }));
    });
    var counted = function () { return accounts.filter(function (a) { return !a.signer && !a.notFound; }); };
    return Promise.all(jobs).then(function () {
      return Promise.all(ps.map(function (p) {
        var wins = p.kind === 'gaps' ? p.gaps : [[p.from, p.to]];
        wins = wins.filter(function (x) { return Date.parse(x[0]) <= now; });
        p.started = !!wins.length;
        p.ended = p.kind === 'week' && Date.parse(p.to) <= now;
        if (!wins.length) { p.count = null; return null; }
        return Promise.all(counted().map(function (a) {
          return Promise.all(wins.map(function (x) { return L.txCount(a.g, x[0], x[1]); })).then(function (rs) { return rs.reduce(function (s, r) { return s + r.count; }, 0); });
        })).then(function (cs) { p.count = cs.reduce(function (s, c) { return s + c; }, 0); });
      })).then(function () { return ps; });
    });
  }
  /* After a testnet reset the core accounts are gone and every count reads 0: that 0 proves nothing, so say so. */
  function coreMissing() {
    var core = [C.AUGUST.assetAccount, C.AUGUST.markerDestination].concat(Object.keys(REH).map(function (k) { return C.REHEARSAL[k].account; }));
    return accounts.filter(function (a) { return a.notFound && core.indexOf(a.g) >= 0; }).length;
  }
  function weekState(p) {
    var miss = coreMissing();
    if (miss && p.started) return state('na', { es: '? NO VERIFICABLE · ' + miss + ' cuenta(s) no existen en testnet', en: '? NOT VERIFIABLE · ' + miss + ' account(s) not on testnet' });
    if (p.kind === 'gaps') return p.started ? state('na', { es: 'APARTE', en: 'COUNTED APART' }) : state('planned', { es: '○ AÚN NO EMPIEZA', en: '○ NOT STARTED YET' });
    if (!p.started) return state('planned', { es: '○ AÚN NO EMPIEZA', en: '○ NOT STARTED YET' });
    if (!p.ended) return state('planned', { es: '… EN CURSO', en: '… IN PROGRESS' });
    if (p.expect0) return p.count === 0 ? state('ok', { es: '✓ 0, A PROPÓSITO', en: '✓ 0, ON PURPOSE' }) : state('fail', { es: '✗ ESPERÁBAMOS 0', en: '✗ WE EXPECTED 0' });
    return state('ok', { es: '✓ TERMINADA', en: '✓ FINISHED' });
  }
  function renderWeeks() {
    var tb = $('rWeeks'), tile = $('rWeekTile'), src = $('rWeeksSrc');
    var ts = tile && tile.querySelector('[data-slot]');
    if (weekErr && !weekData) {
      if (tb) tb.innerHTML = '<tr><td colspan="3">' + errP(weekErr) + '</td></tr>';
      if (ts) ts.innerHTML = errP(weekErr);
      return;
    }
    if (!weekData) {
      if (tb) tb.innerHTML = '<tr><td colspan="3">' + loading() + '</td></tr>';
      if (ts) ts.innerHTML = loading();
      return;
    }
    if (tb) tb.innerHTML = weekData.map(function (p) {
      return '<tr><th scope="row">' + pair(p) + '</th><td>' + weekState(p) + '</td><td>' + (p.count == null ? '<span class="q-dim">—</span>' : S.num(S.fmtNum(p.count), 'vivo')) + '</td></tr>';
    }).join('');
    if (src) src.innerHTML = vivo() + (weekErr ? errP(weekErr) : '');
    var w1 = weekData[0];
    if (ts) ts.innerHTML = '<p class="q-tile-v">' + S.num(S.fmtNum(w1.count), 'vivo') + ' <small>' + pair({ es: 'en la semana 1', en: 'in week 1' }) + '</small></p>' +
      '<p class="q-tile-s">' + weekState(w1) + '</p>' +
      '<ul class="q-mini">' + weekData.slice(1).map(function (p) {
        return '<li>' + pair({ es: p.es.split(' · ')[0], en: p.en.split(' · ')[0] }) + ': ' + (p.count == null ? pair({ es: 'aún no empieza', en: 'not started yet' }) : S.num(S.fmtNum(p.count), 'vivo')) + '</li>';
      }).join('') + '</ul>' + vivo() + (weekErr ? errP(weekErr) : '');
    var n = $('rAcctN'); if (n) n.textContent = '(' + accounts.length + ')';
    var at = $('rAccts');
    if (at) at.innerHTML = accounts.map(function (a) {
      var cnt = a.signer
        ? (a.signsFor == null ? '—' : a.signsFor.length
          ? pair({ es: 'clave firmante · firma en ', en: 'signing key · signs for ' }) + a.signsFor.map(function (x) { return '<code translate="no">' + esc(S.shortKey(x)) + '</code>'; }).join(', ')
          : pair({ es: 'clave firmante · hoy no firma en ninguna cuenta de testnet', en: 'signing key · signs for no testnet account today' }))
        : a.notFound ? pair({ es: 'no existe en testnet', en: 'not on testnet' }) : a.since == null ? '—' : S.num(String(a.since), 'vivo');
      return '<tr><td><code translate="no">' + esc(S.shortKey(a.g)) + '</code></td><td>' + pair(a.label) + '</td><td>' + cnt + '</td><td>' + (a.last ? S.datePair(a.last) : '—') + '</td></tr>';
    }).join('');
  }

  /* ═════════════════ published evidence vs Horizon ═════════════════ */
  var evRows = null, evErr = null;
  function anchorsOf(list) { return list.filter(function (t) { return !!t.memoShown && t.ok; }); }
  function compareAll(txsBy) {
    var rows = [];
    var get = function (k) { return L.account(C.REHEARSAL[k].account); };
    return Promise.all(['abcd', 'dress', 'e2e', 'asset'].map(get)).then(function (acc) {
      var A = { abcd: acc[0], dress: acc[1], e2e: acc[2], asset: acc[3] };
      var ev = evidence;
      var hashRow = function (k, fileHash) {
        var on = A[k].exists ? A[k].data['qwatt.anchor.sha256'] : null;
        rows.push({ k: k, what: { es: 'huella anclada (qwatt.anchor.sha256)', en: 'anchored fingerprint (qwatt.anchor.sha256)' }, file: fileHash ? '<code translate="no">' + esc(S.shortHash(fileHash)) + '</code>' : '—',
          hz: on ? '<code translate="no">' + esc(S.shortHash(on)) + '</code>' : '—', ok: !!on && on === fileHash });
      };
      var totalRow = function (k, fileTotal) {
        var on = A[k].exists ? A[k].data['qwatt.cumulative_mwh'] : null;
        rows.push({ k: k, what: { es: 'total acumulado (mWh)', en: 'running total (mWh)' }, file: fileTotal != null ? S.num(S.fmtNum(+fileTotal), 'ensayo') : '—',
          hz: on != null ? S.num(S.fmtNum(+on), 'vivo') : '—', ok: on != null && fileTotal != null && String(on) === String(fileTotal) });
      };
      if (ev.abcd) {
        var bs = ev.abcd.batches || [];
        hashRow('abcd', ev.abcd.onchain_anchor_after);
        totalRow('abcd', bs.length ? bs[bs.length - 1].cumulative_mwh : null);
      }
      if (ev.dress) {
        var sum = ev.dress.reconciliation && ev.dress.reconciliation.summary;
        totalRow('dress', sum ? sum.anchored_cumulative_mwh : null);
        var fileN = ev.dress.anchoring ? ev.dress.anchoring.anchored : null, hzN = anchorsOf(txsBy.dress || []).length;
        rows.push({ k: 'dress', what: { es: 'anclajes QW#n', en: 'QW#n anchors' }, file: fileN != null ? S.num(String(fileN), 'ensayo') : '—', hz: S.num(String(hzN), 'vivo'), ok: fileN === hzN });
      }
      if (ev.e2e && ev.e2e.final) {
        hashRow('e2e', ev.e2e.final.onchain_anchor);
        totalRow('e2e', ev.e2e.final.onchain_cumulative_mwh);
      }
      if (ev.asset && ev.asset.anchoring) {
        var want = ev.asset.anchoring.txs || [], have = {};
        anchorsOf(txsBy.asset || []).forEach(function (t) { have[t.hash] = true; });
        var found = want.filter(function (h) { return have[h]; }).length;
        rows.push({ k: 'asset', what: { es: 'transacciones de anclaje listadas en el archivo', en: 'anchoring transactions listed in the file' }, file: S.num(String(want.length), 'ensayo'),
          hz: S.num(String(found), 'vivo') + pair({ es: ' encontradas', en: ' found' }), ok: want.length > 0 && found === want.length });
        var onT = A.asset.exists ? A.asset.data['qwatt.cumulative_mwh'] : null;
        if (onT != null) rows.push({ k: 'asset', what: { es: 'total acumulado (mWh)', en: 'running total (mWh)' }, file: pair({ es: 'el archivo no lo publica', en: 'not in the file' }), hz: S.num(S.fmtNum(+onT), 'vivo'), na: true });
      }
      return rows;
    });
  }
  var H = {
    what: { es: 'Qué se compara', en: 'What is compared' }, file: { es: 'Archivo publicado', en: 'Published file' },
    hz: { es: 'Horizon ahora', en: 'Horizon now' }, res: { es: 'Resultado', en: 'Result' }
  };
  function renderEv() {
    var tb = $('rEv'), tile = $('rEvTile'), src = $('rEvSrc');
    var ts = tile && tile.querySelector('[data-slot]');
    if (evErr && !evRows) { if (tb) tb.innerHTML = '<tr><td colspan="5">' + errP(evErr) + '</td></tr>'; if (ts) ts.innerHTML = errP(evErr); return; }
    if (!evRows) { if (tb) tb.innerHTML = '<tr><td colspan="5">' + loading() + '</td></tr>'; if (ts) ts.innerHTML = loading(); return; }
    if (tb) tb.innerHTML = evRows.map(function (r) {
      var st = r.na ? state('na', { es: '– SOLO EN HORIZON', en: '– HORIZON ONLY' }) : r.ok ? state('ok', { es: '✓ COINCIDE', en: '✓ MATCHES' }) : state('fail', { es: '✗ NO COINCIDE', en: '✗ DOES NOT MATCH' });
      return '<tr><th scope="row">' + pair(REH[r.k]) + '</th><td data-h="' + esc(S.t(H.what)) + '">' + pair(r.what) + '</td><td data-h="' + esc(S.t(H.file)) + '">' + r.file + '</td><td data-h="' + esc(S.t(H.hz)) + '">' + r.hz + '</td><td data-h="' + esc(S.t(H.res)) + '">' + st + '</td></tr>';
    }).join('');
    if (src) src.innerHTML = '<p class="q-src" data-src="ensayo">' + pair({ es: 'Archivo: entrada simulada · Stellar testnet · ensayo 8 oct · cuenta desechable', en: 'File: simulated input · Stellar testnet · 8 Oct rehearsal · throwaway account' }) + '</p>' + vivo() + (evErr ? errP(evErr) : '');
    var checks = evRows.filter(function (r) { return !r.na; });
    var okN = checks.filter(function (r) { return r.ok; }).length;
    var accOk = {}; checks.forEach(function (r) { accOk[r.k] = (accOk[r.k] !== false) && r.ok; });
    var accN = Object.keys(accOk).length, accGood = Object.keys(accOk).filter(function (k) { return accOk[k]; }).length;
    if (ts) ts.innerHTML = '<p class="q-tile-v">' + S.num(accGood + '/' + accN, 'vivo') + ' <small>' + pair({ es: 'cuentas coinciden', en: 'accounts match' }) + '</small></p>' +
      '<p class="q-tile-s">' + (okN === checks.length ? state('ok', { es: '✓ COINCIDE', en: '✓ MATCHES' }) : state('fail', { es: '✗ NO COINCIDE', en: '✗ DOES NOT MATCH' })) + ' ' +
      S.num(okN + '/' + checks.length, 'vivo') + pair({ es: ' comprobaciones · detalle abajo', en: ' checks · details below' }) + '</p>' + vivo();
  }

  /* ═════════════════ feed of anchors ═════════════════ */
  var feed = null, feedErr = null, period = 'all', showAll = false;
  function inPeriod(t) {
    if (period === 'all') return true;
    var ms = Date.parse(t.createdAt);
    if (period === 'prior') return ms < Date.parse(C.SPRINT_START);
    var n = +period.slice(1);
    var w = C.WEEKS.filter(function (x) { return x.n === n; })[0];
    return !!w && ms >= Date.parse(w.from) && ms < Date.parse(w.to);
  }
  function renderFeed() {
    var out = $('rFeed');
    if (!out) return;
    if (feedErr && !feed) { out.innerHTML = errP(feedErr); return; }
    if (!feed) { out.innerHTML = loading(); return; }
    var list = feed.filter(inPeriod);
    if (!list.length) {
      out.innerHTML = '<p class="q-empty">' + pair({ es: 'Sin transacciones en este período. Semana 1: 0 transacciones en testnet, a propósito.', en: 'No transactions in this period. Week 1: 0 testnet transactions, on purpose.' }) + '</p>' + vivo();
      return;
    }
    var shown = showAll ? list : list.slice(0, 12);
    out.innerHTML = '<ol class="q-rows">' + shown.map(function (t) {
      var n = t.memoShown.slice(3);
      return '<li><b>' + pair({ es: 'Anclaje #' + n, en: 'Anchor #' + n }) + '</b><span class="q-dim" translate="no">' + esc(t.memoShown) + '</span>' +
        '<span>' + S.datePair(t.createdAt) + ' ' + esc(S.fmtTime(t.createdAt)) + '</span>' +
        '<span>' + S.num(String(t.signatures.length), 'ensayo') + pair({ es: ' firmas', en: ' signatures' }) + ' · ' + S.num(String(t.ops), 'ensayo') + pair({ es: ' operaciones', en: ' operations' }) + '</span>' +
        '<span class="q-tag-s">' + pair(REH[t.reh]) + '</span>' + txLink(t, t.acct) + '</li>';
    }).join('') + '</ol>' +
      (list.length > 12 ? '<p><button type="button" class="q-btn is-small" id="rFeedMore">' + (showAll ? pair({ es: 'Mostrar solo los 12 más nuevos', en: 'Show only the newest 12' }) : pair({ es: 'Mostrar los {n}', en: 'Show all {n}' }, { n: list.length })) + '</button></p>' : '') +
      S.badge('ensayo', null, { es: S.SRC.ensayo.es + ' · leído ' + S.fmtTime(), en: S.SRC.ensayo.en + ' · read ' + S.fmtTime() });
  }
  var augLast = null, augErr = null;
  function renderAug() {
    var el = $('rAugLast');
    if (!el) return;
    if (augErr && !augLast) { el.innerHTML = errP(augErr); return; }
    if (!augLast) { el.innerHTML = loading(); return; }
    el.innerHTML = pair({ es: 'última actividad ', en: 'last activity ' }) + S.datePair(augLast.createdAt) + ' · ' + vivo();
  }

  /* ═════════════════ watch list (memory only) ═════════════════ */
  var watched = [];   // { g, a, txs, err }
  function msg(o, kind) { var m = $('rWatchMsg'); if (m) { m.innerHTML = o ? pair(o) : ''; m.setAttribute('data-kind', kind || ''); } }
  function projectLabel(g) {
    for (var i = 0; i < accounts.length; i++) if (accounts[i].g === g) return accounts[i].label;
    return null;
  }
  function addWatch(g) {
    if (!L.isPublicKey(g)) { msg({ es: 'Eso no es una dirección pública válida de Stellar (G…, 56 caracteres, con su suma de control).', en: 'That is not a valid public Stellar address (G…, 56 characters, with its checksum).' }, 'bad'); return; }
    for (var i = 0; i < watched.length; i++) if (watched[i].g === g) { msg({ es: 'Ya la estás observando.', en: 'You are already watching it.' }); return; }
    if (watched.length >= 6) watched.pop();
    var w = { g: g, a: null, txs: null, err: null };
    watched.unshift(w);
    msg(null);
    renderWatch();
    readWatch(w);
  }
  function readWatch(w) {
    return Promise.all([L.account(w.g), L.txs(w.g, { limit: 5 }).catch(function (e) { if (e && e.code === 'not-found') return []; throw e; })])
      .then(function (r) { w.a = r[0]; w.txs = r[1]; w.err = null; renderWatch(); }, function (e) { w.err = e; renderWatch(); });
  }
  function renderWatch() {
    var out = $('rWatched');
    if (!out) return;
    if (!watched.length) { out.innerHTML = '<p class="q-empty">' + pair({ es: 'Todavía no observas ninguna cuenta.', en: 'You are not watching any account yet.' }) + '</p>'; return; }
    out.innerHTML = watched.map(function (w, i) {
      var label = projectLabel(w.g);
      var head = '<div class="q-wcard-h"><b>' + (label ? pair(label) : pair({ es: 'Cuenta agregada por ti, no es de QWATT', en: 'Account added by you, not a QWATT account' })) + '</b>' +
        '<button type="button" class="q-btn is-small" data-unwatch="' + i + '">' + pair({ es: 'Quitar', en: 'Remove' }) + '</button></div>' +
        '<code translate="no">' + esc(w.g) + '</code>';
      var body;
      if (w.err && !w.a) body = errP(w.err);
      else if (!w.a) body = loading();
      else if (!w.a.exists) body = errP({ code: 'not-found' });
      else {
        var rows = (w.txs || []).map(function (t) {
          return '<li><span>' + S.datePair(t.createdAt) + ' ' + esc(S.fmtTime(t.createdAt)) + '</span>' +
            '<span>' + (t.ok ? state('ok', { es: '✓ EXITOSA', en: '✓ SUCCESSFUL' }) : state('fail', { es: '✗ FALLIDA', en: '✗ FAILED' })) + '</span>' +
            '<span>' + (t.memoShown ? pair({ es: 'anclaje ', en: 'anchor ' }) + '<b translate="no">' + esc(t.memoShown) + '</b>' : pair({ es: 'otra transacción · ', en: 'other transaction · ' }) + pair('memoHidden')) + '</span>' +
            '<span>' + S.num(String(t.signatures.length), 'vivo') + pair({ es: ' firmas · ', en: ' signatures · ' }) + S.num(String(t.ops), 'vivo') + pair({ es: ' operaciones', en: ' operations' }) + '</span>' + txLink(t, w.g) + '</li>';
        }).join('');
        body = '<p class="q-tile-s">' + pair({ es: 'Umbrales ', en: 'Thresholds ' }) + S.num(w.a.thresholds.low + '/' + w.a.thresholds.med + '/' + w.a.thresholds.high, 'vivo') + ' · ' +
          pair({ es: '¿Una sola clave puede enviar una transacción? ', en: 'Can a single key send a transaction? ' }) + (L.canOneKeySend(w.a) ? state('fail', { es: 'SÍ', en: 'YES' }) : state('ok', { es: 'NO', en: 'NO' })) + '</p>' +
          (rows ? '<ol class="q-rows is-small">' + rows + '</ol>' : '<p class="q-empty">' + pair({ es: 'Sin transacciones.', en: 'No transactions.' }) + '</p>') + vivo();
      }
      return '<article class="q-wcard">' + head + body + '</article>';
    }).join('');
  }
  function watchUI() {
    var inp = $('rWatchIn'), add = $('rWatchAdd'), quick = $('rQuick'), box = $('rWatched');
    if (!inp || !add) return;
    var guard = function () {
      var v = inp.value.trim();
      if (L.looksSecret(v) || (/^S/.test(v) && v.length >= 50)) {
        inp.value = '';
        msg({ es: 'Eso parecía una clave secreta (empieza con S). La borramos sin leerla ni guardarla. Nunca la pegues en una página web: esta página solo necesita direcciones públicas G….', en: 'That looked like a secret key (it starts with S). We cleared it without reading or storing it. Never paste one into a web page: this page only needs public G… addresses.' }, 'warn');
        return false;
      }
      return true;
    };
    inp.addEventListener('input', guard);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (guard()) addWatch(inp.value.trim().toUpperCase()); } });
    add.addEventListener('click', function () { if (guard()) addWatch(inp.value.trim().toUpperCase()); });
    if (quick) quick.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-quick]'); if (b) addWatch(C.REHEARSAL[b.getAttribute('data-quick')].account); });
    if (box) box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-unwatch]');
      if (!b) return;
      watched.splice(+b.getAttribute('data-unwatch'), 1);
      renderWatch();
    });
    renderWatch();
  }

  /* ═════════════════ independence test (published e2e evidence) ═════════════════ */
  function renderIndep() {
    var el = $('rIndep'), out = el && el.querySelector('[data-slot]');
    if (!out) return;
    var sc = evidence.e2e && evidence.e2e.scenarios;
    if (!sc) { out.innerHTML = evidence.e2e === null ? '<p class="q-err">' + pair({ es: 'No pudimos leer el archivo de evidencia publicado.', en: 'Could not read the published evidence file.' }) + '</p>' : loading(); return; }
    var un = sc.independence_unpublished && sc.independence_unpublished.verifier;
    var pub = sc.independence_after_publication && sc.independence_after_publication.verifier;
    var reasons = un && Array.isArray(un.reasons) ? un.reasons : [];
    out.innerHTML = '<ul class="q-checks">' +
      '<li>' + (un && un.action === 'refused' ? state('ok', { es: '⊘ RECHAZADO, COMO SE ESPERABA', en: '⊘ REFUSED, AS EXPECTED' }) : state('fail', { es: '✗ FALLA', en: '✗ FAILS' })) +
        pair({ es: 'un lote que nunca se publicó: el verificador se niega a cofirmar ', en: 'a batch that was never published: the verifier refuses to co-sign ' }) + '<code translate="no">' + esc(reasons.join(', ')) + '</code></li>' +
      '<li>' + (pub && pub.action === 'anchored' ? state('ok', { es: '✓ ANCLADO', en: '✓ ANCHORED' }) : state('fail', { es: '✗ FALLA', en: '✗ FAILS' })) +
        pair({ es: 'el mismo lote, ya publicado: anclado en el ledger ', en: 'the same batch, once published: anchored in ledger ' }) + (pub && pub.ledger ? S.num(S.fmtNum(pub.ledger), 'ensayo') : '—') +
        (pub && /^[0-9a-f]{64}$/.test(pub.tx_hash || '') ? ' · <a class="q-link" href="' + esc(C.EXPLORER + '/tx/' + pub.tx_hash) + '" target="_blank" rel="noopener">' + pair({ es: 'ver', en: 'view' }) + newTab() + '</a>' : '') + '</li></ul>' +
      S.badge('ensayo');
  }

  /* ═════════════════ refresh loop ═════════════════ */
  var timer = null, busy = false;
  function refresh() {
    if (busy) return;
    busy = true;
    clearTimeout(timer);
    var txsBy = {};
    var net = L.network();
    var feedJob = net.then(function () {
      return Promise.all(Object.keys(REH).map(function (k) {
        return L.txs(C.REHEARSAL[k].account, { limit: 200 }).then(function (list) { txsBy[k] = list; }, function (e) { if (e && e.code === 'not-found') txsBy[k] = []; else throw e; });
      }));
    }).then(function () {
      var all = [];
      Object.keys(txsBy).forEach(function (k) { anchorsOf(txsBy[k]).forEach(function (t) { t.reh = k; t.acct = C.REHEARSAL[k].account; all.push(t); }); });
      all.sort(function (a, b) { return Date.parse(b.createdAt) - Date.parse(a.createdAt); });
      feed = all; feedErr = null; renderFeed();
    }, function (e) { feedErr = e; renderFeed(); throw e; });
    var weekJob = net.then(countAll).then(function (ps) { weekData = ps; weekErr = null; renderWeeks(); }, function (e) { weekErr = e; renderWeeks(); throw e; });
    var evJob = feedJob.then(function () { return compareAll(txsBy); }).then(function (rows) { evRows = rows; evErr = null; renderEv(); }, function (e) { evErr = e; renderEv(); throw e; });
    var augJob = net.then(function () { return L.txs(C.AUGUST.assetAccount, { limit: 1 }); }).then(function (l) { augLast = l[0] || null; augErr = null; renderAug(); }, function (e) { augErr = e; renderAug(); throw e; });
    var watchJob = Promise.all(watched.map(readWatch));
    Promise.all([feedJob, weekJob, evJob, augJob, watchJob]).then(function () {
      busy = false;
      timer = setTimeout(function again() { if (d.hidden) { timer = setTimeout(again, 5000); return; } refresh(); }, 60000);
    }, function (e) {
      busy = false;
      if (e && e.code === 'wrong-network') return;
      timer = setTimeout(refresh, e && e.code === 'rate-limited' ? 60000 : 30000);
    });
  }

  function renderAll() { renderWeeks(); renderEv(); renderFeed(); renderAug(); renderWatch(); renderIndep(); }
  function start() {
    var bar = $('rPeriods');
    if (bar) bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-period]');
      if (!b) return;
      period = b.getAttribute('data-period'); showAll = false;
      var bs = bar.querySelectorAll('[data-period]');
      for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i] === b ? 'true' : 'false');
      renderFeed();
    });
    var fo = $('rFeed');
    if (fo) fo.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('#rFeedMore')) { showAll = !showAll; renderFeed(); } });
    d.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-refresh]')) refresh(); });
    watchUI();
    renderAll();
    L.ready().then(loadEvidence).then(function () { renderIndep(); refresh(); });
    S.onLang(renderAll);
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
