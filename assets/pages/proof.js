/**
 * QWATT anchor explorer (proof.html, /proof/QW-<n>, /proof/tx-<hash>): every QW#n anchor of a project
 * account, read through QWATT_LIVE only and checked against the published rehearsal evidence.
 * Read-only: nothing is signed or sent, memos other than QW#n stay hidden, no amounts, no batch ids.
 * The real account comes from status.json (QWATT_LIVE.ready); while it is null its tab says so.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE, L = root.QWATT_LIVE;
  if (!d || !S || !L) return;
  var C = L.CONFIG, R = C.REHEARSAL;
  var pair = S.pair, esc = S.esc, num = S.num, badge = S.badge, chip = S.chip;
  function $(id) { return d.getElementById(id); }

  /* ───────────── words (every es: has its en: on the same line) ───────────── */
  var T = {
    real: { es: 'Cuenta de anclaje 2 de 3', en: '2-of-3 anchoring account' },
    dress: { es: 'Ensayo acelerado del 8 oct', en: '8 Oct accelerated rehearsal' },
    abcd: { es: 'Pruebas A–D del 8 oct', en: '8 Oct tests A–D' },
    e2e: { es: 'Ensayo de extremo a extremo del 8 oct', en: '8 Oct end-to-end rehearsal' },
    asset: { es: 'Ensayo con el activo del 8 oct', en: '8 Oct asset rehearsal' },
    august: { es: 'Cuentas de agosto 2026', en: 'August 2026 accounts' },
    dressTxt: { es: '48 horas simuladas en 4 min 18 s, en una cuenta desechable con umbrales 1/2/3, el diseño anterior. Un anclaje por cada hora simulada.', en: '48 simulated hours in 4 min 18 s, on a throwaway account with thresholds 1/2/3, the earlier design. One anchor per simulated hour.' },
    abcdTxt: { es: 'C (proponente + verificador) y L (tercer firmante + verificador) anclaron QW#0 y QW#1. A y B nunca entraron en un ledger, por eso no aparecen aquí: están en la consola.', en: 'C (proposer + verifier) and L (third signer + verifier) anchored QW#0 and QW#1. A and B never entered a ledger, so they are not listed here: see the console.' },
    e2eTxt: { es: 'Seis lotes, un reinicio del proponente y del verificador, y la prueba de independencia: un lote no publicado se rechaza; una vez publicado, se ancla.', en: 'Six batches, a restart of the proposer and the verifier, and the independence test: an unpublished batch is refused; once published, it is anchored.' },
    assetTxt: { es: 'Tres anclajes con el pago marcador fijo de 1 stroop del activo de un ensayo, en cuentas desechables.', en: 'Three anchors with the fixed 1-stroop marker payment of a rehearsal asset, on throwaway accounts.' },
    augustTxt: { es: 'Crearon el activo de testnet en el hackathon (trabajo previo). Una sola clave controla cada una: no son la cuenta de anclaje. Mostramos fechas y tipos, sin montos, sin memo y sin enlaces.', en: 'They created the testnet asset at the hackathon (prior work). One key controls each: they are not the anchoring account. We show dates and types, with no amounts, no memo and no links.' },
    realLive: { es: 'Leída ahora de Horizon. La conciliación con el feed público llega con la semana 2.', en: 'Read now from Horizon. Reconciliation with the public feed arrives with week 2.' },
    prior8: { es: 'TRABAJO PREVIO · 8 OCT', en: 'PRIOR WORK · 8 OCT' },
    priorAug: { es: 'TRABAJO PREVIO · AGO 2026', en: 'PRIOR WORK · AUG 2026' },
    kAnchor: { es: 'ANCLAJE', en: 'ANCHOR' },
    kConfig: { es: 'CONFIGURACIÓN', en: 'CONFIGURATION' },
    kPrior: { es: 'TRABAJO PREVIO', en: 'PRIOR WORK' },
    tAnchors: { es: 'Anclajes (QW#n)', en: 'Anchors (QW#n)' },
    tSigs: { es: 'Firmas por anclaje', en: 'Signatures per anchor' },
    tThr: { es: 'Umbrales de la cuenta', en: 'Account thresholds' },
    tSince: { es: 'Transacciones desde el 19 oct', en: 'Transactions since 19 Oct' },
    tEnergy: { es: 'Energía anclada', en: 'Anchored energy' },
    tTxs: { es: 'Transacciones', en: 'Transactions' },
    tSigners: { es: 'Firmantes con peso', en: 'Signers with weight' },
    last: { es: 'último {m} · {d}', en: 'last {m} · {d}' },
    sigAll: { es: '{n} de {m} anclajes con 2 firmas', en: '{n} of {m} anchors with 2 signatures' },
    earlier: { es: 'diseño anterior; la cuenta definitiva tendrá 2/2/3', en: 'earlier design; the real account will use 2/2/3' },
    w1: { es: '{n} firmantes de peso 1 · maestra en peso {w}', en: '{n} signers of weight 1 · master at weight {w}' },
    zeroExp: { es: '✓ 0, COMO ESPERÁBAMOS', en: '✓ 0, AS EXPECTED' },
    zeroNo: { es: '✗ ESPERÁBAMOS 0', en: '✗ WE EXPECTED 0' },
    since8: { es: 'cuenta desechable: no debe moverse', en: 'throwaway account: it must not move' },
    simKwh: { es: '≈ {k} kWh · entrada simulada', en: '≈ {k} kWh · simulated input' },
    oneKey: { es: 'una sola clave: ¿puede enviar una transacción? SÍ', en: 'a single key: can it send a transaction? YES' },
    xcHead: { es: 'Publicado = anclado', en: 'Published = anchored' },
    xcSeq: { es: 'la huella del lote {i} en el archivo de evidencia coincide con la anclada en QW#{i}', en: 'batch {i}\'s fingerprint in the evidence file matches the one anchored in QW#{i}' },
    xcTotal: { es: 'el total del archivo ({a} mWh) es el último total anclado', en: 'the file\'s total ({a} mWh) is the last anchored total' },
    xcHead2: { es: 'la huella que la cuenta guarda ahora es la del último anclaje', en: 'the fingerprint the account holds now is the last anchor\'s' },
    xcHeadEv: { es: 'y es la que el archivo declara como cabeza de la cadena', en: 'and it is the one the file declares as the chain head' },
    xcCount: { es: 'el archivo declara {a} anclajes; Horizon lista {b}', en: 'the file declares {a} anchors; Horizon lists {b}' },
    xcEnds: { es: 'la primera y la última transacción de anclaje son las del archivo', en: 'the first and the last anchoring transactions are the file\'s' },
    xcTx: { es: 'la transacción de QW#{i} es la que registra el archivo', en: 'QW#{i}\'s transaction is the one the file records' },
    xcSum: { es: '{n} de {m} comprobaciones coinciden', en: '{n} of {m} checks match' },
    xcNone: { es: 'No pudimos leer el archivo de evidencia publicado; el resto de la página sigue funcionando.', en: 'Could not read the published evidence file; the rest of the page still works.' },
    match: { es: '✓ COINCIDE', en: '✓ MATCHES' },
    nomatch: { es: '✗ NO COINCIDE', en: '✗ DOES NOT MATCH' },
    thType: { es: 'Tipo', en: 'Type' },
    thMemo: { es: 'Memo', en: 'Memo' },
    thHash: { es: 'Huella', en: 'Fingerprint' },
    thTotal: { es: 'Total (mWh)', en: 'Total (mWh)' },
    thSigs: { es: 'Firmas', en: 'Signatures' },
    thLedger: { es: 'Ledger', en: 'Ledger' },
    thDate: { es: 'Fecha', en: 'Date' },
    thOps: { es: 'Operaciones', en: 'Operations' },
    caption: { es: 'Transacciones de la cuenta, de la más nueva a la más antigua', en: 'The account\'s transactions, newest first' },
    capAug: { es: 'Transacciones de las cuentas de agosto (sin montos, memo oculto, sin enlaces)', en: 'Transactions of the August accounts (no amounts, memo hidden, no links)' },
    showing: { es: 'Mostrando {n} de {m}', en: 'Showing {n} of {m}' },
    showAll: { es: 'Ver las {m} transacciones', en: 'Show all {m} transactions' },
    openTx: { es: 'Ver detalle', en: 'Open details' },
    created: { es: 'creación de la cuenta', en: 'account creation' },
    setup: { es: 'firmantes y umbrales', en: 'signers and thresholds' },
    augCreate: { es: 'creación del activo de agosto 2026 (trabajo previo)', en: 'creation of the August 2026 asset (prior work)' },
    noLink: { es: 'sin enlace', en: 'no link' },
    augHash: { es: 'no mostrada (cuenta de agosto, trabajo previo)', en: 'not shown (August account, prior work)' },
    refresh: { es: 'Actualizar', en: 'Refresh' },
    explorer: { es: 'Ver la cuenta en stellar.expert', en: 'View the account on stellar.expert' },
    explorerTx: { es: 'Ver en stellar.expert', en: 'View on stellar.expert' },
    back: { es: '← Volver a la lista', en: '← Back to the list' },
    prev: { es: '← Anclaje anterior', en: '← Previous anchor' },
    next: { es: 'Anclaje siguiente →', en: 'Next anchor →' },
    dAnchor: { es: 'Anclaje {m}', en: 'Anchor {m}' },
    dConfig: { es: 'Configuración de la cuenta', en: 'Account configuration' },
    dTx: { es: 'Transacción leída de Horizon', en: 'Transaction read from Horizon' },
    dSub: { es: 'La cadena de evidencia de este registro, leída ahora de Horizon testnet. Entrada simulada · Stellar testnet.', en: 'The evidence chain of this record, read now from Horizon testnet. Simulated input · Stellar testnet.' },
    dOther: { es: 'No es una transacción de una cuenta del proyecto. Para cualquier cuenta o transacción, usa la consola.', en: 'This is not a transaction of a project account. For any account or transaction, use the console.' },
    toConsole: { es: 'Abrir la consola →', en: 'Open the console →' },
    kType: { es: 'Tipo', en: 'Type' },
    kMemo: { es: 'Memo', en: 'Memo' },
    kEnergy: { es: 'Energía de este anclaje', en: 'Energy of this anchor' },
    kSigs: { es: 'Firmas', en: 'Signatures' },
    kPair: { es: 'Pareja que firmó', en: 'Pair that signed' },
    kLedger: { es: 'Ledger', en: 'Ledger' },
    kDate: { es: 'Fecha', en: 'Date' },
    kAccount: { es: 'Cuenta', en: 'Account' },
    kTx: { es: 'Transacción', en: 'Transaction' },
    kOps: { es: 'Operaciones', en: 'Operations' },
    kResult: { es: 'Resultado', en: 'Result' },
    sigMed: { es: '{n} firmas de peso 1 · umbral medio de la cuenta: {m} (las operaciones de anclaje lo exigen)', en: '{n} signatures of weight 1 · account medium threshold: {m} (anchoring operations require it)' },
    pairPV: { es: 'proponente + verificador (según el archivo de evidencia)', en: 'proposer + verifier (per the evidence file)' },
    pairTV: { es: 'tercer firmante + verificador (según el archivo de evidencia). En la cuenta definitiva la conciliación llamará ROTA a esta pareja: no es una pareja acordada.', en: 'third signer + verifier (per the evidence file). On the real account reconciliation will call this pair BROKEN: it is not an agreed pair.' },
    ok: { es: '✓ EXITOSA', en: '✓ SUCCESSFUL' },
    bad: { es: '✗ FALLIDA', en: '✗ FAILED' },
    local: { es: '(hora local)', en: '(local time)' },
    payAnchor: { es: 'pago marcador fijo (monto no mostrado)', en: 'fixed marker payment (amount not shown)' },
    payOther: { es: 'pago (monto no mostrado)', en: 'payment (amount not shown)' },
    miss: { es: 'No encontramos ese anclaje en esta cuenta. Revisa el número o abre la lista.', en: 'That anchor is not on this account. Check the number or open the list.' },
    missTx: { es: 'No encontramos esa transacción en Stellar testnet (testnet se reinicia periódicamente).', en: 'That transaction is not on Stellar testnet (testnet is reset from time to time).' }
  };

  var TABS = {
    real: { t: T.real },
    dress: { t: T.dress, txt: T.dressTxt, acct: R.dress.account, ev: R.dress.evidence },
    abcd: { t: T.abcd, txt: T.abcdTxt, acct: R.abcd.account, ev: R.abcd.evidence },
    e2e: { t: T.e2e, txt: T.e2eTxt, acct: R.e2e.account, ev: R.e2e.evidence },
    asset: { t: T.asset, txt: T.assetTxt, acct: R.asset.account, ev: R.asset.evidence },
    august: { t: T.august, txt: T.augustTxt, accts: [C.AUGUST.assetAccount, C.AUGUST.markerDestination] }
  };
  var ORDER = ['real', 'dress', 'abcd', 'e2e', 'asset', 'august'];
  var AUGUST = [C.AUGUST.assetAccount, C.AUGUST.markerDestination];
  var PAGE_ROWS = 12;

  var cur = null, data = {}, timers = {}, showAll = {}, openRow = null, netOk = null;

  /* ───────────── small helpers ───────────── */
  function hhmm() { return S.fmtTime().slice(0, 5); }
  function errHTML(e) {
    var code = (e && e.code) || 'offline';
    var key = code === 'rate-limited' ? 'limited' : code === 'not-found' ? 'notFound' : code === 'wrong-network' ? 'wrongNet' : 'offline';
    return '<p class="q-err" role="status" data-kind="' + esc(code) + '">' + pair(key, { t: hhmm() }) + '</p>';
  }
  function loading() { return '<p class="q-loading"><span class="q-skel" aria-hidden="true"></span> ' + pair('reading') + '</p>'; }
  function vivo() { return badge('vivo', { t: S.fmtTime() }); }
  function ensayo() { return badge('ensayo', null, { es: S.SRC.ensayo.es + ' · leído ' + S.fmtTime(), en: S.SRC.ensayo.en + ' · read ' + S.fmtTime() }); }
  function st(kind, words) { return '<span class="q-state" data-state="' + kind + '">' + pair(words) + '</span>'; }
  function check(ok, words, vars) { return '<li>' + st(ok ? 'ok' : 'fail', ok ? T.match : T.nomatch) + pair(words, vars) + '</li>'; }
  function qwOf(m) { var x = /^QW#(\d+)$/.exec(m || ''); return x ? +x[1] : null; }
  function kwh(mwh) { var k = (mwh / 1e6).toFixed(3); return S.lang() === 'en' ? k : k.replace('.', ','); }
  function newTab() { return '<span class="q-ext" aria-hidden="true">↗</span><span class="q-vh">' + pair('newTab') + '</span>'; }
  function txLink(hash, text) { return '<a class="q-link" href="' + esc(C.EXPLORER + '/tx/' + hash) + '" target="_blank" rel="noopener">' + (text || pair(T.explorerTx)) + newTab() + '</a>'; }
  function acctLink(g) { return '<a class="q-link" href="' + esc(C.EXPLORER + '/account/' + g) + '" target="_blank" rel="noopener">' + pair(T.explorer) + newTab() + '</a>'; }
  function future() { return new Date(Date.now() + 86400000).toISOString(); }
  function defaultTab() { return C.ANCHOR_ACCOUNT ? 'real' : 'dress'; }
  function acctOf(id) { return id === 'real' ? C.ANCHOR_ACCOUNT : TABS[id].acct; }
  function tabOfAccount(g) { for (var i = 0; i < ORDER.length; i++) { if (g && acctOf(ORDER[i]) === g) return ORDER[i]; } return AUGUST.indexOf(g) >= 0 ? 'august' : null; }
  function guard() { if (!netOk) netOk = L.network().catch(function (e) { netOk = null; throw e; }); return netOk; }

  /* ───────────── the published evidence of each rehearsal, reduced to what we compare ───────────── */
  function adapt(id, ev) {
    var o = { bySeq: {}, count: null, total: null, head: null, first: null, lastTx: null, txList: null };
    if (!ev) return null;
    if (id === 'abcd') {
      var bs = ev.batches || [];
      bs.forEach(function (b, i) { o.bySeq[i] = { sha: b.sha256, cum: b.cumulative_mwh }; });
      var s = ev.steps || {};
      if (o.bySeq[0] && s.C_proposer_plus_verifier) { o.bySeq[0].tx = s.C_proposer_plus_verifier.hash; o.bySeq[0].pair = 'pv'; }
      if (o.bySeq[1] && s.L_third_plus_verifier) { o.bySeq[1].tx = s.L_third_plus_verifier.hash; o.bySeq[1].pair = 'tv'; }
      o.count = bs.length; o.total = bs.length ? bs[bs.length - 1].cumulative_mwh : null; o.head = ev.onchain_anchor_after || null;
    } else if (id === 'e2e') {
      var f = ev.final || {};
      (f.anchored_records || []).forEach(function (r) { o.bySeq[r.seq] = { sha: r.sha256, tx: r.tx_hash }; });
      o.count = (f.anchored_records || []).length; o.total = f.cumulative_mwh_feed; o.head = f.onchain_anchor || null;
    } else if (id === 'dress') {
      var sm = (ev.reconciliation || {}).summary || {};
      o.count = sm.anchor_transactions; o.total = sm.anchored_cumulative_mwh; o.first = ev.first_tx || null; o.lastTx = ev.last_tx || null;
    } else if (id === 'asset') {
      var an = ev.anchoring || {};
      o.txList = an.txs || []; o.count = an.anchored;
    }
    return o;
  }
  function crossChecks(id, dt) {
    var ev = adapt(id, dt.ev), an = dt.an || [];
    if (!ev || !an.length) return null;
    var out = [], last = an[an.length - 1];
    an.forEach(function (a, i) {
      var q = qwOf(a.memoShown), e = q != null ? ev.bySeq[q] : null;
      if (e && e.sha) out.push({ ok: e.sha === a.sha256 && (e.cum == null || +e.cum === +a.cumulativeMwh) && (!e.tx || e.tx === a.txHash), w: T.xcSeq, v: { i: q } });
      if (ev.txList && ev.txList[i]) out.push({ ok: ev.txList[i] === a.txHash, w: T.xcTx, v: { i: q != null ? q : i } });
    });
    if (ev.count != null) out.push({ ok: +ev.count === an.length, w: T.xcCount, v: { a: S.fmtNum(+ev.count), b: S.fmtNum(an.length) } });
    if (ev.total != null) out.push({ ok: +ev.total === +last.cumulativeMwh, w: T.xcTotal, v: { a: S.fmtNum(+ev.total) } });
    if (ev.first && ev.lastTx) out.push({ ok: an[0].txHash === ev.first && last.txHash === ev.lastTx, w: T.xcEnds, v: {} });
    var held = dt.a && dt.a.data ? dt.a.data['qwatt.anchor.sha256'] : null;
    if (held) out.push({ ok: held === last.sha256 && (!ev.head || ev.head === held), w: ev.head ? { es: T.xcHead2.es + ' ' + T.xcHeadEv.es, en: T.xcHead2.en + ' ' + T.xcHeadEv.en } : T.xcHead2, v: {} });
    return out;
  }

  /* ───────────── loading ───────────── */
  function load(id) {
    if (id === 'august') {
      return Promise.all([L.account(AUGUST[0]), L.account(AUGUST[1]), L.txs(AUGUST[0], { limit: 20 }), L.txs(AUGUST[1], { limit: 20 }),
        L.txCount(AUGUST[0], C.SPRINT_START, future()), L.txCount(AUGUST[1], C.SPRINT_START, future())]).then(function (r) {
        var seen = {}, txs = [];
        r[2].concat(r[3]).forEach(function (t) { if (!seen[t.hash]) { seen[t.hash] = 1; txs.push(t); } });
        txs.sort(function (a, b) { return b.ledger - a.ledger; });
        return { accts: [r[0], r[1]], txs: txs, since: (r[4].count || 0) + (r[5].count || 0) };
      });
    }
    var g = acctOf(id), t = TABS[id];
    if (!g) return Promise.resolve({ empty: true });
    return Promise.all([
      L.account(g), L.txs(g, { limit: 200 }), L.anchors(g).catch(function () { return null; }),
      L.txCount(g, C.SPRINT_START, future()).catch(function () { return null; }),
      t.ev ? L.evidence(t.ev).catch(function () { return null; }) : Promise.resolve(null)
    ]).then(function (r) { return { a: r[0], txs: r[1], an: r[2], since: r[3], ev: r[4] }; });
  }
  function fetchTab(id, fresh) {
    clearTimeout(timers[id]);
    var slot = data[id] || (data[id] = {});
    if (!slot.v && cur === id) renderBody();
    return guard().then(function () { return load(id); }).then(function (v) {
      slot.v = v; slot.err = null;
      if (cur === id) { renderBody(); routeDetail(false); }
      timers[id] = setTimeout(function again() { if (d.hidden) { timers[id] = setTimeout(again, 5000); return; } if (cur === id) fetchTab(id, true); }, 60000);
    }, function (e) {
      slot.err = e;
      if (cur === id) renderBody();
      if (e && e.code !== 'wrong-network') timers[id] = setTimeout(function () { if (cur === id) fetchTab(id, true); }, e && e.code === 'rate-limited' ? 60000 : 30000);
    });
  }

  /* ───────────── rendering: the panel of one account ───────────── */
  function tile(k, v, s, b) { return '<div class="q-tile"><p class="q-tile-k">' + pair(k) + '</p><p class="q-tile-v">' + v + '</p>' + (s ? '<p class="q-tile-s">' + s + '</p>' : '') + b + '</div>'; }
  function head(id, acct, chips) {
    var t = TABS[id];
    return '<div class="q-pp-head"><div><h3>' + pair(t.t) + '</h3>' + (t.txt ? '<p>' + pair(t.txt) + '</p>' : '') +
      (acct ? '<p class="q-pp-acct"><code translate="no">' + esc(S.shortKey(acct)) + '</code>' + (AUGUST.indexOf(acct) < 0 ? acctLink(acct) : '') + '</p>' : '') +
      '</div><div class="q-chips">' + chips + '<button type="button" class="q-btn is-small" data-pp-refresh>' + pair(T.refresh) + '</button></div></div>';
  }
  function kindLabel(k) { return '<span class="q-kind" data-k="' + k + '">' + pair(k === 'anchor' ? T.kAnchor : k === 'prior' ? T.kPrior : T.kConfig) + '</span>'; }
  function rowsOf(id, v) {
    var byHash = {};
    (v.an || []).forEach(function (a) { byHash[a.txHash] = a; });
    var g = acctOf(id);
    return v.txs.map(function (t) {
      var a = byHash[t.hash] || null;
      var q = qwOf(t.memoShown);
      return { t: t, a: a, qw: q, kind: a || q != null ? 'anchor' : 'config', note: a || q != null ? null : (t.sourceAccount && t.sourceAccount !== g ? T.created : T.setup) };
    });
  }
  function table(id, rows) {
    var all = showAll[id] || rows.length <= PAGE_ROWS + 3, shown = all ? rows : rows.slice(0, PAGE_ROWS);
    var body = shown.map(function (r) {
      var t = r.t, a = r.a, on = openRow && openRow.hash === t.hash;
      var label = r.qw != null ? 'QW#' + r.qw : null;
      var btn = '<button type="button" class="q-rowbtn" data-open="' + esc(t.hash) + '">' + (label ? '<span translate="no">' + esc(label) + '</span>' : pair(T.openTx)) + '</button>';
      return '<tr' + (on ? ' class="is-on"' : '') + '><td>' + kindLabel(r.kind) + (r.note ? '<br><small class="q-dim">' + pair(r.note) + '</small>' : '') + '</td>' +
        '<td>' + btn + '</td>' +
        '<td>' + (a ? '<code translate="no">' + esc(S.shortHash(a.sha256)) + '</code>' : '<span class="q-dim">—</span>') + '</td>' +
        '<td>' + (a && a.cumulativeMwh != null ? num(S.fmtNum(+a.cumulativeMwh), 'ensayo') : '<span class="q-dim">—</span>') + '</td>' +
        '<td class="q-c-sig">' + num(String(t.signatures.length), 'vivo') + '</td>' +
        '<td class="q-c-led">' + num(S.fmtNum(t.ledger), 'vivo') + '</td>' +
        '<td class="q-c-ops">' + num(String(t.ops), 'vivo') + '</td>' +
        '<td class="q-c-date">' + esc(S.fmtDate(t.createdAt)) + ' ' + esc(S.fmtTime(t.createdAt).slice(0, 5)) + '</td></tr>';
    }).join('');
    return '<div class="q-tbl-head"><p>' + pair(T.showing, { n: shown.length, m: rows.length }) + '</p></div>' +
      '<div class="q-table-wrap"><table class="q-table q-atable"><caption>' + pair(T.caption) + '</caption><thead><tr>' +
      '<th scope="col">' + pair(T.thType) + '</th><th scope="col">' + pair(T.thMemo) + '</th><th scope="col">' + pair(T.thHash) + '</th><th scope="col">' + pair(T.thTotal) + '</th>' +
      '<th scope="col" class="q-c-sig">' + pair(T.thSigs) + '</th><th scope="col" class="q-c-led">' + pair(T.thLedger) + '</th><th scope="col" class="q-c-ops">' + pair(T.thOps) + '</th><th scope="col" class="q-c-date">' + pair(T.thDate) + '</th></tr></thead><tbody>' +
      body + '</tbody></table></div>' +
      (all ? '' : '<p class="q-tbl-more"><button type="button" class="q-btn is-small" data-show-all>' + pair(T.showAll, { m: rows.length }) + '</button></p>') +
      vivo() + ensayo();
  }
  function rehearsalPanel(id, v) {
    var a = v.a;
    if (!a.exists) return head(id, acctOf(id), id === 'real' ? '' : chip('previo', T.prior8)) + errHTML({ code: 'not-found' });
    var rows = rowsOf(id, v), an = v.an || rows.filter(function (r) { return r.kind === 'anchor'; }).map(function (r) { return { txHash: r.t.hash, memoShown: r.t.memoShown, createdAt: r.t.createdAt }; }).reverse();
    var anchorTx = rows.filter(function (r) { return r.kind === 'anchor'; });
    var two = anchorTx.filter(function (r) { return r.t.signatures.length === 2; }).length;
    var sigs = anchorTx.map(function (r) { return r.t.signatures.length; });
    var sigTxt = sigs.length ? (Math.min.apply(null, sigs) === Math.max.apply(null, sigs) ? String(sigs[0]) : Math.min.apply(null, sigs) + '–' + Math.max.apply(null, sigs)) : '—';
    var lastA = an.length ? an[an.length - 1] : null;
    var w1 = a.signers.filter(function (s) { return s.key !== a.id && s.weight === 1; }).length;
    var since = v.since ? v.since.count : null;
    var tiles = '<div class="q-tiles">' +
      tile(T.tAnchors, num(S.fmtNum(an.length), 'ensayo'), lastA && lastA.memoShown ? pair(T.last, { m: lastA.memoShown, d: S.fmtDate(lastA.createdAt) }) : '', ensayo()) +
      tile(T.tSigs, num(sigTxt, 'vivo'), anchorTx.length ? pair(T.sigAll, { n: two, m: anchorTx.length }) : '', vivo()) +
      tile(T.tThr, num(a.thresholds.low + '/' + a.thresholds.med + '/' + a.thresholds.high, 'vivo'), pair(T.w1, { n: w1, w: a.masterWeight }) + (id === 'real' ? '' : ' · ' + pair(T.earlier)), vivo()) +
      tile(T.tSince, since == null ? '—' : num(String(since), 'vivo'), id === 'real' ? '' : (since === 0 ? st('ok', T.zeroExp) : since == null ? '' : st('fail', T.zeroNo)) + ' · ' + pair(T.since8), vivo()) +
      (lastA && lastA.cumulativeMwh != null ? tile(T.tEnergy, num(S.fmtNum(+lastA.cumulativeMwh), 'ensayo') + ' <small>mWh</small>', pair(T.simKwh, { k: kwh(+lastA.cumulativeMwh) }), ensayo()) : '') +
      '</div>';
    var xc = '';
    if (id !== 'real') {
      var cks = crossChecks(id, v);
      if (cks) {
        var okN = cks.filter(function (c) { return c.ok; }).length;
        xc = '<div class="q-xc"><h4>' + pair(T.xcHead) + ' · ' + pair(T.xcSum, { n: okN, m: cks.length }) + '</h4><ul class="q-checks">' +
          cks.map(function (c) { return check(c.ok, c.w, c.v); }).join('') + '</ul>' +
          badge('archivo', { p: TABS[id].ev }) + vivo() + '</div>';
      } else if (TABS[id].ev && !v.ev) xc = '<p class="q-err" role="status">' + pair(T.xcNone) + '</p>';
    } else {
      xc = '<p class="q-note">' + pair(T.realLive) + '</p>';
    }
    return head(id, acctOf(id), id === 'real' ? chip('testnet') : chip('previo', T.prior8)) + tiles + xc + table(id, rows);
  }
  function augustPanel(v) {
    var thr = v.accts.map(function (a) { return a.exists ? a.thresholds.low + '/' + a.thresholds.med + '/' + a.thresholds.high : '—'; });
    var sig = v.accts.map(function (a) { return a.exists ? String(a.signers.filter(function (s) { return s.weight > 0; }).length) : '—'; });
    var tiles = '<div class="q-tiles">' +
      tile(T.tTxs, num(String(v.txs.length), 'vivo'), '', vivo()) +
      tile(T.tThr, num(thr.join(' · '), 'vivo'), pair(T.oneKey), vivo()) +
      tile(T.tSigners, num(sig.join(' · '), 'vivo'), '', vivo()) +
      tile(T.tSince, num(String(v.since), 'vivo'), v.since === 0 ? st('ok', T.zeroExp) : st('fail', T.zeroNo), vivo()) + '</div>';
    var body = v.txs.map(function (t) {
      var note = t.ledger === C.AUGUST.creationLedger ? T.augCreate : T.created;
      return '<tr><td>' + kindLabel('prior') + '<br><small class="q-dim">' + pair(note) + '</small></td>' +
        '<td>' + pair('memoHidden') + '</td><td>' + num(String(t.signatures.length), 'vivo') + '</td><td class="q-c-led">' + num(S.fmtNum(t.ledger), 'vivo') + '</td>' +
        '<td class="q-c-ops">' + num(String(t.ops), 'vivo') + '</td><td class="q-c-date">' + esc(S.fmtDate(t.createdAt)) + '</td><td><span class="q-dim">' + pair(T.noLink) + '</span></td></tr>';
    }).join('');
    return head('august', null, chip('previo', T.priorAug)) + tiles +
      '<div class="q-table-wrap"><table class="q-table q-atable"><caption>' + pair(T.capAug) + '</caption><thead><tr><th scope="col">' + pair(T.thType) + '</th><th scope="col">' + pair(T.thMemo) + '</th>' +
      '<th scope="col">' + pair(T.thSigs) + '</th><th scope="col" class="q-c-led">' + pair(T.thLedger) + '</th><th scope="col" class="q-c-ops">' + pair(T.thOps) + '</th><th scope="col" class="q-c-date">' + pair(T.thDate) + '</th><th scope="col">' + pair(T.kTx) + '</th></tr></thead><tbody>' +
      body + '</tbody></table></div>' + vivo();
  }
  function renderBody() {
    var box = $('qpBody'), real = $('qpReal');
    if (!box) return;
    real.hidden = cur !== 'real';
    if (cur === 'real' && !C.ANCHOR_ACCOUNT) { box.hidden = true; return; }
    box.hidden = false;
    var slot = data[cur] || {};
    if (!slot.v) { box.innerHTML = slot.err ? errHTML(slot.err) : loading(); return; }
    var html = cur === 'august' ? augustPanel(slot.v) : rehearsalPanel(cur, slot.v);
    box.innerHTML = html + (slot.err ? errHTML(slot.err) : '');
  }

  /* ───────────── the detail of one transaction ───────────── */
  function findRow(id, hash) {
    var v = data[id] && data[id].v;
    if (!v || !v.txs) return null;
    var rows = rowsOf(id, v);
    for (var i = 0; i < rows.length; i++) if (rows[i].t.hash === hash) return { rows: rows, i: i, r: rows[i] };
    return null;
  }
  function opsHTML(ops, isAnchor) {
    return '<ol class="q-ops">' + ops.map(function (o, i) {
      var k = '<span class="q-op-n">op ' + (i + 1) + '</span> ';
      if (o.type === 'manage_data' && o.name === 'qwatt.anchor.sha256') return '<li>' + k + '<code translate="no">qwatt.anchor.sha256</code> = <code translate="no">' + esc(S.shortHash(o.value)) + '</code></li>';
      if (o.type === 'manage_data' && o.name === 'qwatt.cumulative_mwh') return '<li>' + k + '<code translate="no">qwatt.cumulative_mwh</code> = ' + num(S.fmtNum(+o.value), 'ensayo') + ' mWh</li>';
      if (o.type === 'manage_data') return '<li>' + k + '<code translate="no">manage_data</code> <code translate="no">' + esc(String(o.name || '').slice(0, 64)) + '</code></li>';
      if (o.type === 'payment') return '<li>' + k + pair(isAnchor ? T.payAnchor : T.payOther) + '</li>';
      return '<li>' + k + '<code translate="no">' + esc(o.type) + '</code></li>';
    }).join('') + '</ol>';
  }
  function kv(k, v) { return '<dt>' + pair(k) + '</dt><dd>' + v + '</dd>'; }
  function renderDetail(id, hash, t, ops) {
    var box = $('detalle');
    var f = id ? findRow(id, hash) : null;
    var r = f ? f.r : null, a = r && r.a;
    var q = qwOf(t.memoShown), isAnchor = !!a || q != null;
    var ev = id && data[id] && data[id].v ? adapt(id, data[id].v.ev) : null;
    var e = ev && q != null ? ev.bySeq[q] : null;
    var prevA = null, nextA = null;
    if (f && isAnchor) {
      for (var j = f.i + 1; j < f.rows.length; j++) if (f.rows[j].kind === 'anchor') { prevA = f.rows[j]; break; }
      for (var k = f.i - 1; k >= 0; k--) if (f.rows[k].kind === 'anchor') { nextA = f.rows[k]; break; }
    }
    var aug = AUGUST.indexOf(t.sourceAccount) >= 0;
    var acct = id ? acctOf(id) : t.sourceAccount;
    var acctData = id && data[id] && data[id].v ? data[id].v.a : null;
    var med = acctData && acctData.thresholds ? acctData.thresholds.med : null;
    var title = isAnchor ? pair(T.dAnchor, { m: 'QW#' + q }) : id ? pair(T.dConfig) : pair(T.dTx);
    var fl = d.querySelector('#como-leer .q-evflow');
    var flow = isAnchor && fl ? fl.outerHTML.replace(/ (aria-label|data-aria-en|data-aria-es)="[^"]*"/g, '').replace('<ol ', '<ol aria-hidden="true" ') : '';
    var energy = null;
    if (a && prevA && prevA.a && a.cumulativeMwh != null && prevA.a.cumulativeMwh != null) energy = +a.cumulativeMwh - +prevA.a.cumulativeMwh;
    else if (a && !prevA && a.cumulativeMwh != null && f) energy = +a.cumulativeMwh;
    var rows = kv(T.kType, kindLabel(isAnchor ? 'anchor' : aug ? 'prior' : 'config')) +
      kv(T.kMemo, t.memoShown ? '<span translate="no">' + esc(t.memoShown) + '</span>' : pair('memoHidden')) +
      (a ? kv({ es: 'qwatt.anchor.sha256', en: 'qwatt.anchor.sha256' }, '<span class="q-hash" translate="no">' + esc(a.sha256) + '</span><button type="button" class="q-btn is-small q-copy" data-copy="" data-copy-text="' + esc(a.sha256) + '">' + pair('copy') + '</button>') : '') +
      (a && a.cumulativeMwh != null ? kv({ es: 'qwatt.cumulative_mwh', en: 'qwatt.cumulative_mwh' }, num(S.fmtNum(+a.cumulativeMwh), 'ensayo') + ' mWh ' + ensayo()) : '') +
      (energy != null ? kv(T.kEnergy, num(S.fmtNum(energy), 'ensayo') + ' mWh ' + ensayo()) : '') +
      kv(T.kSigs, num(String(t.signatures.length), 'vivo') + (isAnchor && med != null ? ' · ' + pair(T.sigMed, { n: t.signatures.length, m: med }) : '')) +
      (e && e.pair ? kv(T.kPair, pair(e.pair === 'pv' ? T.pairPV : T.pairTV)) : '') +
      kv(T.kResult, st(t.ok ? 'ok' : 'fail', t.ok ? T.ok : T.bad)) +
      kv(T.kLedger, num(S.fmtNum(t.ledger), 'vivo')) +
      kv(T.kDate, esc(S.fmtDate(t.createdAt)) + ' · ' + esc(S.fmtTime(t.createdAt)) + ' ' + pair(T.local)) +
      (acct ? kv(T.kAccount, '<code translate="no">' + esc(S.shortKey(acct)) + '</code>') : '') +
      kv(T.kTx, aug ? pair(T.augHash) : '<span class="q-hash" translate="no">' + esc(t.hash) + '</span><br>' + txLink(t.hash)) +
      (e && e.sha && a ? kv(T.xcHead, st(e.sha === a.sha256 ? 'ok' : 'fail', e.sha === a.sha256 ? T.match : T.nomatch) + ' ' + pair(T.xcSeq, { i: q }) + badge('archivo', { p: TABS[id].ev })) : '') +
      kv(T.kOps, opsHTML(ops, isAnchor));
    box.innerHTML = '<h3 id="hDet">' + title + '</h3><p class="q-detail-sub">' + (id ? pair(TABS[id].t) + ' · ' : '') + pair(T.dSub) + '</p>' +
      (id ? '' : aug ? '<p class="q-note">' + pair(T.august) + ': ' + pair(T.augustTxt) + '</p>' : '<p class="q-note">' + pair(T.dOther) + ' <a class="q-link" href="/console.html">' + pair(T.toConsole) + '</a></p>') +
      flow + '<dl class="q-kv">' + rows + '</dl>' + vivo() +
      '<div class="q-detail-nav"><button type="button" class="q-btn is-small" data-back>' + pair(T.back) + '</button>' +
      (prevA ? '<button type="button" class="q-btn is-small" data-open="' + esc(prevA.t.hash) + '">' + pair(T.prev) + '</button>' : '') +
      (nextA ? '<button type="button" class="q-btn is-small" data-open="' + esc(nextA.t.hash) + '">' + pair(T.next) + '</button>' : '') + '</div>';
  }
  function showDetail(id, hash, focus) {
    var box = $('detalle');
    openRow = { tab: id, hash: hash };
    box.hidden = false;
    box.innerHTML = loading();
    Promise.all([L.tx(hash), L.ops(hash)]).then(function (r) {
      if (!openRow || openRow.hash !== hash) return;
      renderDetail(id, hash, r[0], r[1]);
      if (focus) { box.focus({ preventScroll: true }); box.scrollIntoView({ block: 'start' }); }
    }, function (e) {
      box.innerHTML = (e && e.code === 'not-found' ? '<p class="q-err" role="status">' + pair(T.missTx) + '</p>' : errHTML(e)) +
        '<div class="q-detail-nav"><button type="button" class="q-btn is-small" data-back>' + pair(T.back) + '</button></div>';
    });
    if (cur === id) renderBody();
  }
  function closeDetail() {
    var box = $('detalle');
    var was = openRow; openRow = null;
    box.hidden = true; box.innerHTML = '';
    renderBody();
    if (was) { var b = d.querySelector('[data-open="' + was.hash + '"]'); if (b) b.focus(); }
  }
  function miss() {
    var box = $('detalle');
    openRow = null;
    box.hidden = false;
    box.innerHTML = '<p class="q-err" role="status">' + pair(T.miss) + '</p><div class="q-detail-nav"><button type="button" class="q-btn is-small" data-back>' + pair(T.back) + '</button></div>';
  }

  /* ───────────── routing: /proof/QW-<n>, /proof/tx-<hash>, ?c=<tab>, ?id= on local servers ───────────── */
  var route = { tab: null, qw: null, tx: null }, routed = false;
  function parse() {
    var p = root.location.pathname, q = root.location.search;
    var m = /^\/proof\/(QW-(\d{1,9})|tx-([0-9a-f]{64}))\/?$/.exec(p) || /[?&]id=(QW-(\d{1,9})|tx-([0-9a-f]{64}))(?:&|$)/.exec(q);
    var c = /[?&]c=(real|dress|abcd|e2e|asset|august)(?:&|$)/.exec(q);
    return { tab: c ? c[1] : null, qw: m && m[2] != null ? +m[2] : null, tx: m && m[3] ? m[3] : null };
  }
  function local() { return /^\/proof\.html$/.test(root.location.pathname) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(root.location.hostname); }
  function urlFor(tab, row) {
    var c = tab && tab !== defaultTab() ? 'c=' + tab : '';
    if (!row) return '/proof.html' + (c ? '?' + c : '');
    var id = row.qw != null ? 'QW-' + row.qw : 'tx-' + row.t.hash;
    if (local()) return '/proof.html?id=' + id + (c ? '&' + c : '');
    return '/proof/' + id + (c ? '?' + c : '');
  }
  function push(url) { try { if (root.location.pathname + root.location.search !== url) root.history.pushState({ q: 1 }, '', url); } catch (e) { /* file:// or blocked */ } }
  function routeDetail(force) {
    if (routed && !force) return;
    if (route.qw == null && !route.tx) { routed = true; return; }
    if (route.tx) {
      var known = findRow(cur, route.tx);
      if (known || !data[cur] || !data[cur].v) { if (known) { routed = true; showDetail(cur, route.tx, true); } return; }
      routed = true;
      L.tx(route.tx).then(function (t) {
        var tab = tabOfAccount(t.sourceAccount);
        if (tab && tab !== 'august' && tab !== cur) { select(tab, false); routed = false; return; }
        showDetail(tab === cur ? cur : null, route.tx, true);
      }, function () { showDetail(null, route.tx, true); });
      return;
    }
    var v = data[cur] && data[cur].v;
    if (!v || !v.txs) return;
    routed = true;
    var rows = rowsOf(cur, v).filter(function (r) { return r.qw === route.qw; });
    if (rows.length) showDetail(cur, rows[0].t.hash, true); else miss();
  }

  /* ───────────── tabs ───────────── */
  function select(id, pushIt) {
    if (!TABS[id]) return;
    cur = id;
    var tabs = d.querySelectorAll('.q-tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-tab') === id;
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].setAttribute('tabindex', on ? '0' : '-1');
    }
    $('qpPanel').setAttribute('aria-labelledby', 'tab-' + id);
    if (openRow && openRow.tab !== id) { openRow = null; $('detalle').hidden = true; }
    if (pushIt) push(urlFor(id, null));
    renderBody();
    if (id !== 'real' || C.ANCHOR_ACCOUNT) fetchTab(id, false);
  }
  function wire() {
    var list = d.querySelector('.q-tabs');
    list.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.q-tab');
      if (b) { routed = true; select(b.getAttribute('data-tab'), true); }
    });
    list.addEventListener('keydown', function (e) {
      var keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
      if (!(e.key in keys)) return;
      e.preventDefault();
      var i = ORDER.indexOf(cur), k = keys[e.key];
      var n = k === 'first' ? 0 : k === 'last' ? ORDER.length - 1 : (i + k + ORDER.length) % ORDER.length;
      routed = true; select(ORDER[n], true);
      var t = $('tab-' + ORDER[n]); if (t) t.focus();
    });
    d.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : null;
      if (!t) return;
      var o = t.closest('[data-open]');
      if (o) {
        var f = findRow(cur, o.getAttribute('data-open'));
        if (f) { push(urlFor(cur, f.r)); showDetail(cur, f.r.t.hash, true); }
        return;
      }
      if (t.closest('[data-back]')) { push(urlFor(cur, null)); closeDetail(); return; }
      if (t.closest('[data-show-all]')) { showAll[cur] = true; renderBody(); return; }
      if (t.closest('[data-pp-refresh]')) { netOk = null; fetchTab(cur, true); }
    });
    root.addEventListener('popstate', function () {
      route = parse(); routed = false;
      var want = route.tab || defaultTab();
      if (want !== cur) select(want, false);
      if (route.qw == null && !route.tx) { if (openRow) closeDetail(); routed = true; } else routeDetail(true);
    });
    S.onLang(function () {
      renderBody();
      if (openRow) showDetail(openRow.tab, openRow.hash, false);
    });
  }

  function start() {
    if (!$('qpPanel')) return;
    wire();
    L.ready().then(function () {
      route = parse();
      if (C.ANCHOR_ACCOUNT) $('tab-real').querySelector('small').innerHTML = '<span translate="no">' + esc(S.shortKey(C.ANCHOR_ACCOUNT)) + '</span>';
      select(route.tab || defaultTab(), false);
      if (route.tab === 'real' && !C.ANCHOR_ACCOUNT && (route.qw != null || route.tx)) miss();
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
