/**
 * QWATT verification console (console.html), read-only. Step 1 looks up any public G… address or
 * transaction hash on Horizon testnet through QWATT_LIVE; step 2 lays out tests A–D of the 8 Oct
 * rehearsal from the published evidence file. Nothing here creates accounts, signs, sends or stores:
 * input shaped like a secret seed is cleared at once, never sent, logged or kept, and the read log
 * lives only in this tab's memory. No amounts, no memo other than QW#n, no batch ids.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE, L = root.QWATT_LIVE;
  if (!d || !S || !L) return;
  var C = L.CONFIG, R = C.REHEARSAL, A = C.AUGUST;
  var pair = S.pair, esc = S.esc, num = S.num, badge = S.badge, chip = S.chip;
  function $(id) { return d.getElementById(id); }

  /* ───────────── words (every es: has its en: on the same line) ───────────── */
  var T = {
    netA: { es: 'Stellar testnet · ledger', en: 'Stellar testnet · ledger' },
    netB: { es: '· {d} · solo Stellar testnet · QWATT no tiene precio', en: '· {d} · Stellar testnet only · QWATT has no price' },
    netOff: { es: 'Stellar testnet · sin conexión con Horizon ({t}) · reintentando · QWATT no tiene precio', en: 'Stellar testnet · no connection to Horizon ({t}) · retrying · QWATT has no price' },
    invalid: { es: 'No es una dirección pública válida (revisamos su suma de control).', en: 'Not a valid public address (we check its checksum).' },
    empty: { es: 'Escribe una dirección pública G… o una huella de transacción de 64 caracteres.', en: 'Type a public G… address or a 64-character transaction hash.' },
    realPlan: { es: 'Cuenta de anclaje real 2 de 3: en preparación (semana 2). Cuando exista, este botón la consultará y comprobará umbrales 2/2/3, tres firmantes de peso 1 y la clave maestra en peso 0.', en: 'Real 2-of-3 anchoring account: in preparation (week 2). Once it exists, this button will look it up and check thresholds 2/2/3, three signers of weight 1 and the master key at weight 0.' },
    hAcct: { es: 'Cuenta', en: 'Account' },
    hTx: { es: 'Transacción', en: 'Transaction' },
    hTxAug: { es: 'Transacción de una cuenta de agosto (trabajo previo)', en: 'Transaction of an August account (prior work)' },
    kThr: { es: 'Umbrales', en: 'Thresholds' },
    kThrSub: { es: 'bajo / medio / alto', en: 'low / medium / high' },
    kSigners: { es: 'Firmantes (clave, peso)', en: 'Signers (key, weight)' },
    kMaster: { es: 'Clave maestra', en: 'Master key' },
    kData: { es: 'Datos de la cuenta (decodificados)', en: 'Account data (decoded)' },
    kHome: { es: 'home_domain', en: 'home_domain' },
    kMod: { es: 'Última modificación', en: 'Last modified' },
    kOne: { es: '¿Una sola clave puede enviar una transacción?', en: 'Can a single key send a transaction?' },
    kOk: { es: 'Éxito', en: 'Success' },
    kLedger: { es: 'Ledger', en: 'Ledger' },
    kDate: { es: 'Fecha', en: 'Date' },
    kSigs: { es: 'Firmas', en: 'Signatures' },
    kMemo: { es: 'Memo', en: 'Memo' },
    kOps: { es: 'Operaciones', en: 'Operations' },
    kSource: { es: 'Cuenta de origen', en: 'Source account' },
    kHash: { es: 'Huella', en: 'Hash' },
    weightW: { es: 'peso', en: 'weight' },
    sig1: { es: 'firma', en: 'signature' },
    sigN2: { es: 'firmas', en: 'signatures' },
    op1: { es: 'operación', en: 'operation' },
    opN: { es: 'operaciones', en: 'operations' },
    memoShort: { es: 'memo oculto', en: 'memo hidden' },
    masterTag: { es: 'clave maestra', en: 'master key' },
    noData: { es: 'ninguno', en: 'none' },
    notSet: { es: 'no configurado', en: 'not set' },
    yes: { es: 'SÍ', en: 'YES' },
    no: { es: 'NO', en: 'NO' },
    oneYes: { es: 'una firma de peso {w} ya alcanza el umbral bajo {l}', en: 'one signature of weight {w} already reaches the low threshold {l}' },
    oneNo: { es: 'ninguna firma sola alcanza el umbral bajo {l}', en: 'no single signature reaches the low threshold {l}' },
    okTx: { es: '✓ EXITOSA', en: '✓ SUCCESSFUL' },
    badTx: { es: '✗ FALLIDA', en: '✗ FAILED' },
    local: { es: '(hora local)', en: '(local time)' },
    payAnchor: { es: 'pago marcador fijo (monto no mostrado)', en: 'fixed marker payment (amount not shown)' },
    payOther: { es: 'pago (monto no mostrado)', en: 'payment (amount not shown)' },
    dataPublic: { es: 'texto público de la cuenta, no verificado por QWATT', en: 'the account\'s public text, not checked by QWATT' },
    lookIt: { es: 'Consultar', en: 'Look up' },
    lastTxs: { es: 'Últimas transacciones de la cuenta', en: 'The account\'s latest transactions' },
    noTxs: { es: 'Sin transacciones.', en: 'No transactions.' },
    explorerAcct: { es: 'Ver la cuenta en stellar.expert', en: 'View the account on stellar.expert' },
    explorerTx: { es: 'Ver en stellar.expert', en: 'View on stellar.expert' },
    augNoLink: { es: 'Cuenta de agosto (trabajo previo): sin enlace al explorador.', en: 'August account (prior work): no explorer link.' },
    augHash: { es: 'no mostrada (cuenta de agosto, trabajo previo)', en: 'not shown (August account, prior work)' },
    yours: { es: 'Cuenta agregada por ti, no es de QWATT.', en: 'Account added by you, not a QWATT account.' },
    yoursTx: { es: 'Transacción consultada por ti; no es necesariamente de QWATT.', en: 'Transaction looked up by you; not necessarily a QWATT one.' },
    target: { es: 'Objetivo de la cuenta definitiva', en: 'Target of the real account' },
    c223: { es: 'umbrales 2/2/3', en: 'thresholds 2/2/3' },
    cW1: { es: 'tres firmantes de peso 1', en: 'three signers of weight 1' },
    cM0: { es: 'clave maestra en peso 0', en: 'master key at weight 0' },
    ok: { es: '✓ CORRECTO', en: '✓ CORRECT' },
    fail: { es: '✗ FALLA', en: '✗ FAILS' },
    testC: { es: 'Prueba C del ensayo del 8 oct: el proponente y el verificador firmaron; quedó anclada como QW#0.', en: 'Test C of the 8 Oct rehearsal: the proposer and the verifier signed; it was anchored as QW#0.' },
    testL: { es: 'Prueba L del ensayo del 8 oct: el tercer firmante y el verificador firmaron; quedó anclada como QW#1.', en: 'Test L of the 8 Oct rehearsal: the third signer and the verifier signed; it was anchored as QW#1.' },
    logAcct: { es: '[{t}] Horizon: cuenta {g} · umbrales {l}/{m}/{h} · {n} firmantes de peso 1 · maestra {w}', en: '[{t}] Horizon: account {g} · thresholds {l}/{m}/{h} · {n} signers of weight 1 · master {w}' },
    logMissing: { es: '[{t}] Horizon: cuenta {g} · no encontrada en testnet', en: '[{t}] Horizon: account {g} · not found on testnet' },
    logTx: { es: '[{t}] Horizon: transacción {h} · ledger {n} · {s} firmas · exitosa', en: '[{t}] Horizon: transaction {h} · ledger {n} · {s} signatures · successful' },
    logTxBad: { es: '[{t}] Horizon: transacción {h} · ledger {n} · {s} firmas · fallida', en: '[{t}] Horizon: transaction {h} · ledger {n} · {s} signatures · failed' },
    logTxAug: { es: '[{t}] Horizon: transacción de una cuenta de agosto · ledger {n} · {s} firmas', en: '[{t}] Horizon: transaction of an August account · ledger {n} · {s} signatures' },
    logErr: { es: '[{t}] Horizon no respondió ({c})', en: '[{t}] Horizon did not answer ({c})' },
    logInvalid: { es: '[{t}] Entrada rechazada: no es una dirección pública ni una huella válida', en: '[{t}] Input refused: not a valid public address or hash' },
    logSecret: { es: '[{t}] Se borró una entrada con forma de clave secreta: no se envió ni se guardó', en: '[{t}] An input shaped like a secret key was cleared: it was not sent or stored' },
    logReady: { es: '— consola lista · solo lectura —', en: '— console ready · read-only —' },
    roleAccount: { es: 'cuenta de anclaje del ensayo', en: 'rehearsal anchoring account' },
    roleProposer: { es: 'proponente del ensayo', en: 'rehearsal proposer' },
    roleVerifier: { es: 'verificador del ensayo', en: 'rehearsal verifier' },
    roleThird: { es: 'tercer firmante del ensayo', en: 'rehearsal third signer' },
    roleDest: { es: 'destino del pago marcador del ensayo', en: 'rehearsal marker-payment destination' },
    roleOther: { es: 'cuenta del activo del ensayo', en: 'rehearsal asset account' },
    nDress: { es: 'Ensayo acelerado 8 oct · cuenta desechable', en: 'Accelerated rehearsal 8 Oct · throwaway account' },
    nAbcd: { es: 'Pruebas A–D 8 oct · cuenta desechable', en: 'Tests A–D 8 Oct · throwaway account' },
    nE2e: { es: 'Ensayo de extremo a extremo 8 oct', en: 'End-to-end rehearsal 8 Oct' },
    nAsset: { es: 'Ensayo con el activo 8 oct', en: 'Asset rehearsal 8 Oct' },
    nAug1: { es: 'Cuenta de agosto que creó el activo (trabajo previo)', en: 'August account that created the asset (prior work)' },
    nAug2: { es: 'Cuenta de agosto, destino fijo del pago marcador (trabajo previo)', en: 'August account, fixed marker-payment destination (prior work)' },
    nReal: { es: 'Cuenta de anclaje 2 de 3', en: '2-of-3 anchoring account' },
    prior8: { es: 'TRABAJO PREVIO · 8 OCT', en: 'PRIOR WORK · 8 OCT' },
    priorAug: { es: 'TRABAJO PREVIO · AGO 2026', en: 'PRIOR WORK · AUG 2026' },
    stCap: { es: 'Pruebas A–D y L del ensayo del 8 oct, según el archivo de evidencia publicado', en: 'Tests A–D and L of the 8 Oct rehearsal, per the published evidence file' },
    thTest: { es: 'Prueba', en: 'Test' },
    thWho: { es: 'Quién firmó', en: 'Who signed' },
    thExp: { es: 'Esperado', en: 'Expected' },
    thRes: { es: 'Resultado en el archivo', en: 'Result in the file' },
    thEv: { es: 'Evidencia', en: 'Evidence' },
    wA: { es: 'el proponente solo', en: 'the proposer alone' },
    wB: { es: 'el verificador solo', en: 'the verifier alone' },
    wC: { es: 'proponente + verificador', en: 'proposer + verifier' },
    wD: { es: 'el proponente, sobre un lote alterado después de su firma', en: 'the proposer, over a batch altered after signing' },
    wL: { es: 'tercer firmante + verificador', en: 'third signer + verifier' },
    eRej: { es: 'la red la rechaza', en: 'the network refuses it' },
    eAnch: { es: 'anclada', en: 'anchored' },
    eVer: { es: 'el verificador la rechaza; no se envía nada', en: 'the verifier refuses it; nothing is sent' },
    refused: { es: 'RECHAZADA, COMO SE ESPERABA', en: 'REFUSED, AS EXPECTED' },
    notRefused: { es: '✗ NO FUE RECHAZADA', en: '✗ NOT REFUSED' },
    anchored: { es: '✓ ANCLADA', en: '✓ ANCHORED' },
    notAnch: { es: '✗ NO ANCLADA', en: '✗ NOT ANCHORED' },
    sameBody: { es: 'mismo cuerpo de transacción que C', en: 'same transaction body as C' },
    otherBody: { es: 'cuerpo distinto de C', en: 'a body different from C' },
    noLedger: { es: 'sobre firmado y respuesta de la red; nunca entró a un ledger', en: 'signed envelope and the network\'s answer; it never entered a ledger' },
    nothingSent: { es: 'no se envió nada', en: 'nothing was sent' },
    qw: { es: '{m} · ledger ', en: '{m} · ledger ' },
    stErr: { es: 'No pudimos leer el archivo de evidencia publicado ({p}).', en: 'Could not read the published evidence file ({p}).' }
  };

  var KNOWN = {};
  KNOWN[R.dress.account] = { n: T.nDress, c: 'previo8', link: true, reh: true };
  KNOWN[R.abcd.account] = { n: T.nAbcd, c: 'previo8', link: true, reh: true };
  KNOWN[R.e2e.account] = { n: T.nE2e, c: 'previo8', link: true, reh: true };
  KNOWN[R.asset.account] = { n: T.nAsset, c: 'previo8', link: true, reh: true };
  KNOWN[A.assetAccount] = { n: T.nAug1, c: 'previoAug', link: false, aug: true };
  KNOWN[A.markerDestination] = { n: T.nAug2, c: 'previoAug', link: false, aug: true };
  var ROLE = { account: T.roleAccount, proposer: T.roleProposer, verifier: T.roleVerifier, third: T.roleThird, destination: T.roleDest };
  var ROLES = {};    // signer key → role words, filled from the published evidence files
  var log = [], current = null, seq = 0;

  /* ───────────── helpers ───────────── */
  function hhmm() { return S.fmtTime().slice(0, 5); }
  function errHTML(e) {
    var code = (e && e.code) || 'offline';
    var key = code === 'rate-limited' ? 'limited' : code === 'not-found' ? 'notFound' : code === 'wrong-network' ? 'wrongNet' : 'offline';
    return '<p class="q-err" role="status" data-kind="' + esc(code) + '">' + pair(key, { t: hhmm() }) + '</p>';
  }
  function loading() { return '<p class="q-loading"><span class="q-skel" aria-hidden="true"></span> ' + pair('reading') + '</p>'; }
  function vivo(at) { return badge('vivo', { t: S.fmtTime(at) }); }
  function ensayo(at) { return badge('ensayo', null, { es: S.SRC.ensayo.es + ' · leído ' + S.fmtTime(at), en: S.SRC.ensayo.en + ' · read ' + S.fmtTime(at) }); }
  function state(kind, words) { return '<span class="q-state" data-state="' + kind + '">' + pair(words) + '</span>'; }
  function refusedState() { return '<span class="q-state" data-state="refused"><i aria-hidden="true">⊘</i> ' + pair(T.refused) + '</span>'; }
  function kv(k, v) { return '<dt>' + pair(k) + '</dt><dd>' + v + '</dd>'; }
  function newTab() { return '<span class="q-ext" aria-hidden="true">↗</span><span class="q-vh">' + pair('newTab') + '</span>'; }
  function ext(href, words) { return '<a class="q-link" href="' + esc(href) + '" target="_blank" rel="noopener">' + pair(words) + newTab() + '</a>'; }
  function chipFor(k) { return k === 'previoAug' ? chip('previo', T.priorAug) : k === 'previo8' ? chip('previo', T.prior8) : chip(k); }
  function printable(s) { return String(s == null ? '' : s).replace(/[^\x20-\x7e -ÿ]/g, '·').slice(0, 64); }
  function isAug(g) { return g === A.assetAccount || g === A.markerDestination; }
  function lookBtn(q) { return '<button type="button" class="q-btn is-small" data-q="' + esc(q) + '">' + pair(T.lookIt) + '</button>'; }

  /* An input shaped like a secret seed, anywhere in the field: cleared at once, never kept. */
  function secretish(v) {
    if (typeof v !== 'string' || !v) return false;
    return L.looksSecret(v) || /S[A-Z2-7]{55}/.test(v.replace(/\s+/g, '').toUpperCase());
  }

  /* ───────────── read log (memory only) ───────────── */
  function addLog(words, vars) { log.unshift({ w: words, v: vars }); if (log.length > 40) log.pop(); renderLog(); }
  function renderLog() {
    var ol = $('qcLog'); if (!ol) return;
    ol.innerHTML = log.map(function (x) { return '<li>' + pair(x.w, x.v) + '</li>'; }).join('') + '<li class="q-dim">' + pair(T.logReady) + '</li>';
  }

  /* ───────────── network bar ───────────── */
  var netTimer = null;
  function netTick() {
    clearTimeout(netTimer);
    var box = $('qcNetIn');
    if (!box) return;
    if (d.hidden) { netTimer = setTimeout(netTick, 5000); return; }
    L.network().then(function (n) {
      var at = new Date();
      box.innerHTML = pair(T.netA) + ' ' + num(S.fmtNum(n.latestLedger), 'vivo') + ' ' + pair(T.netB, { d: n.closedAt ? S.fmtDate(n.closedAt) + ' ' + S.fmtTime(n.closedAt).slice(0, 5) : '—' }) + ' ' + vivo(at);
      netTimer = setTimeout(netTick, 10000);
    }, function (e) {
      box.innerHTML = e && e.code === 'wrong-network' ? pair('wrongNet') : pair(T.netOff, { t: hhmm() });
      if (!e || e.code !== 'wrong-network') netTimer = setTimeout(netTick, 30000);
    });
  }

  /* ───────────── step 1: the lookup ───────────── */
  function out(html, focus) {
    var box = $('qcOut'); if (!box) return;
    box.innerHTML = html;
    if (focus) { try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); } }
  }
  function warnSecret() {
    var w = $('qcWarn'); if (w) w.hidden = false;
    addLog(T.logSecret, { t: hhmm() });
  }
  function lookup(raw) {
    var w = $('qcWarn');
    var v = String(raw == null ? '' : raw).trim();
    if (secretish(v)) { var i = $('qcInput'); if (i) i.value = ''; warnSecret(); return; }
    if (w) w.hidden = true;
    if (!v) { current = null; out('<p class="q-err" role="status">' + pair(T.empty) + '</p>'); return; }
    if (/^[0-9a-fA-F]{64}$/.test(v)) { current = { k: 'tx', v: v.toLowerCase() }; return showTx(current.v); }
    if (/^G[A-Z2-7]{55}$/.test(v) && L.isPublicKey(v)) { current = { k: 'acct', v: v }; return showAccount(v); }
    current = null;
    out('<p class="q-err" role="status">' + pair(T.invalid) + '</p>');
    addLog(T.logInvalid, { t: hhmm() });
  }
  function rerender() { if (current && current.data) (current.k === 'acct' ? renderAccount : renderTx)(current.data); }

  function showAccount(g) {
    var my = ++seq;
    out(loading());
    L.network().then(function () {
      return Promise.all([L.account(g), L.txs(g, { limit: 5 }).catch(function () { return null; })]);
    }).then(function (r) {
      if (my !== seq) return;
      var a = r[0];
      current.data = { g: g, a: a, txs: r[1], at: new Date() };
      if (!a.exists) addLog(T.logMissing, { t: hhmm(), g: S.shortKey(g) });
      else addLog(T.logAcct, { t: hhmm(), g: S.shortKey(g), l: a.thresholds.low, m: a.thresholds.med, h: a.thresholds.high, n: a.signers.filter(function (s) { return s.key !== g && s.weight === 1; }).length, w: a.masterWeight });
      renderAccount(current.data, true);
    }, function (e) {
      if (my !== seq) return;
      out(errHTML(e));
      addLog(T.logErr, { t: hhmm(), c: (e && e.code) || 'offline' });
    });
  }
  function dataRows(a, reh, at) {
    var keys = Object.keys(a.data || {}).sort();
    if (!keys.length) return pair(T.noData);
    return '<ul class="q-cdata">' + keys.slice(0, 12).map(function (k) {
      var v = a.data[k];
      var shown;
      if (k === 'qwatt.anchor.sha256' && /^[0-9a-f]{64}$/.test(v || '')) shown = '<code class="q-hash" translate="no">' + esc(v) + '</code>';
      else if (k === 'qwatt.cumulative_mwh' && /^\d+$/.test(v || '')) shown = num(S.fmtNum(+v), reh ? 'ensayo' : 'vivo') + ' mWh';
      else shown = '<code translate="no">' + esc(printable(v)) + '</code> <small class="q-dim">' + pair(T.dataPublic) + '</small>';
      return '<li><code translate="no">' + esc(printable(k)) + '</code> = ' + shown + '</li>';
    }).join('') + '</ul>' + (reh && (a.data['qwatt.cumulative_mwh'] != null) ? ensayo(at) : '');
  }
  function renderAccount(x, focus) {
    var g = x.g, a = x.a, kn = KNOWN[g] || null, real = C.ANCHOR_ACCOUNT && g === C.ANCHOR_ACCOUNT;
    var head = '<div class="q-res-head"><h3>' + pair(T.hAcct) + ' <code translate="no">' + esc(S.shortKey(g)) + '</code></h3><span class="q-chips">' +
      (real ? chip('testnet', T.nReal) : kn ? chipFor(kn.c) : '') + '</span></div>' +
      '<p class="q-res-key"><code class="q-hash" translate="no">' + esc(g) + '</code> <button type="button" class="q-btn is-small" data-copy="" data-copy-text="' + esc(g) + '">' + pair('copy') + '</button></p>' +
      '<p class="q-res-who">' + (real ? pair(T.nReal) : kn ? pair(kn.n) : ROLES[g] ? pair(ROLES[g]) : pair(T.yours)) + '</p>';
    if (!a.exists) { out(head + errHTML({ code: 'not-found' }), focus); return; }
    var one = L.canOneKeySend(a);
    var maxW = Math.max.apply(null, a.signers.map(function (s) { return s.weight; }).concat([0]));
    var signers = '<ul class="q-csig">' + a.signers.slice().sort(function (p, q) { return q.weight - p.weight; }).map(function (s) {
      var tag = s.key === g ? ' <small class="q-dim">' + pair(T.masterTag) + '</small>' : ROLES[s.key] ? ' <small class="q-dim">' + pair(ROLES[s.key]) + '</small>' : '';
      return '<li><code translate="no">' + esc(S.shortKey(s.key)) + '</code> · ' + pair(T.weightW) + ' ' + num(String(s.weight), 'vivo') + tag + '</li>';
    }).join('') + '</ul>';
    var rows = kv(T.kThr, num(a.thresholds.low + '/' + a.thresholds.med + '/' + a.thresholds.high, 'vivo') + ' <small class="q-dim">' + pair(T.kThrSub) + '</small>') +
      kv(T.kSigners, signers) +
      kv(T.kMaster, pair(T.weightW) + ' ' + num(String(a.masterWeight), 'vivo')) +
      kv(T.kData, dataRows(a, kn && kn.reh, x.at)) +
      kv(T.kHome, a.homeDomain ? '<code translate="no">' + esc(printable(a.homeDomain)) + '</code>' : pair(T.notSet)) +
      kv(T.kMod, a.lastModified ? esc(S.fmtDate(a.lastModified)) + ' · ' + esc(S.fmtTime(a.lastModified).slice(0, 5)) + ' ' + pair(T.local) : '—') +
      kv(T.kOne, (one ? state('fail', T.yes) : state('ok', T.no)) + ' <small class="q-dim">' + (one ? pair(T.oneYes, { w: maxW, l: a.thresholds.low }) : pair(T.oneNo, { l: a.thresholds.low })) + '</small>');
    var target = '';
    if (real) {
      var c = L.check223(a);
      var row = function (ok, w) { return '<li>' + state(ok ? 'ok' : 'fail', ok ? T.ok : T.fail) + pair(w) + '</li>'; };
      target = '<h4 class="q-res-sub">' + pair(T.target) + '</h4><ul class="q-checks">' + row(c.low2 && c.med2 && c.high3, T.c223) + row(c.threeSignersW1, T.cW1) + row(c.masterZero, T.cM0) + '</ul>';
    }
    var txs = '';
    if (x.txs) {
      txs = '<h4 class="q-res-sub">' + pair(T.lastTxs) + '</h4>' + (x.txs.length ? '<ul class="q-ctx">' + x.txs.map(function (t) {
        return '<li><span>' + (t.memoShown ? '<span translate="no">' + esc(t.memoShown) + '</span>' : '<span class="q-dim">' + pair(T.memoShort) + '</span>') + '</span>' +
          '<span>' + num(String(t.signatures.length), 'vivo') + ' ' + pair(t.signatures.length === 1 ? T.sig1 : T.sigN2) + ' · ' + num(String(t.ops), 'vivo') + ' ' + pair(t.ops === 1 ? T.op1 : T.opN) + ' · ' + esc(S.fmtDate(t.createdAt)) + ' · ' + (t.ok ? state('ok', T.okTx) : state('fail', T.badTx)) + '</span>' +
          (isAug(g) ? '' : lookBtn(t.hash)) + '</li>';
      }).join('') + '</ul>' : '<p class="q-dim">' + pair(T.noTxs) + '</p>');
    }
    var link = isAug(g) ? '<p class="q-note">' + pair(T.augNoLink) + '</p>' : '<p class="q-res-link">' + ext(C.EXPLORER + '/account/' + g, T.explorerAcct) + '</p>';
    out(head + '<dl class="q-kv">' + rows + '</dl>' + target + txs + vivo(x.at) + link, focus);
  }

  function showTx(hash) {
    var my = ++seq;
    out(loading());
    L.network().then(function () { return Promise.all([L.tx(hash), L.ops(hash)]); }).then(function (r) {
      if (my !== seq) return;
      var t = r[0];
      current.data = { t: t, ops: r[1], at: new Date() };
      if (isAug(t.sourceAccount)) addLog(T.logTxAug, { t: hhmm(), n: S.fmtNum(t.ledger), s: t.signatures.length });
      else addLog(t.ok ? T.logTx : T.logTxBad, { t: hhmm(), h: S.shortHash(t.hash), n: S.fmtNum(t.ledger), s: t.signatures.length });
      renderTx(current.data, true);
    }, function (e) {
      if (my !== seq) return;
      out(e && e.code === 'not-found' ? '<p class="q-err" role="status">' + pair({ es: 'No encontramos esa transacción en Stellar testnet (testnet se reinicia periódicamente).', en: 'That transaction is not on Stellar testnet (testnet is reset from time to time).' }) + '</p>' : errHTML(e));
      addLog(T.logErr, { t: hhmm(), c: (e && e.code) || 'offline' });
    });
  }
  function opsHTML(ops, isAnchor, reh, at) {
    return '<ol class="q-ops">' + ops.map(function (o, i) {
      var k = '<span class="q-op-n">op ' + (i + 1) + '</span> ';
      if (o.type === 'manage_data' && o.name === 'qwatt.anchor.sha256') return '<li>' + k + '<code translate="no">qwatt.anchor.sha256</code> = <code class="q-hash" translate="no">' + esc(printable(o.value)) + '</code></li>';
      if (o.type === 'manage_data' && o.name === 'qwatt.cumulative_mwh' && /^\d+$/.test(o.value || '')) return '<li>' + k + '<code translate="no">qwatt.cumulative_mwh</code> = ' + num(S.fmtNum(+o.value), reh ? 'ensayo' : 'vivo') + ' mWh' + (reh ? ensayo(at) : '') + '</li>';
      if (o.type === 'manage_data') return '<li>' + k + '<code translate="no">manage_data</code> <code translate="no">' + esc(printable(o.name)) + '</code></li>';
      if (o.type === 'payment') return '<li>' + k + pair(isAnchor ? T.payAnchor : T.payOther) + '</li>';
      return '<li>' + k + '<code translate="no">' + esc(printable(o.type)) + '</code></li>';
    }).join('') + '</ol>';
  }
  function renderTx(x, focus) {
    var t = x.t, ops = x.ops, aug = isAug(t.sourceAccount), kn = KNOWN[t.sourceAccount] || null;
    var isAnchor = !!t.memoShown && ops.some(function (o) { return o.type === 'manage_data' && o.name === 'qwatt.anchor.sha256'; });
    var note = t.hash === R.abcd.testC ? T.testC : t.hash === R.abcd.testL ? T.testL : null;
    var head = '<div class="q-res-head"><h3>' + (aug ? pair(T.hTxAug) : pair(T.hTx) + ' <code translate="no">' + esc(S.shortHash(t.hash)) + '</code>') + '</h3><span class="q-chips">' +
      (aug ? chip('previo', T.priorAug) : kn ? chipFor(kn.c) : '') + '</span></div>' +
      (note ? '<p class="q-res-who">' + pair(note) + '</p>' : kn ? '<p class="q-res-who">' + pair(kn.n) + '</p>' : '<p class="q-res-who">' + pair(T.yoursTx) + '</p>');
    var rows = kv(T.kOk, t.ok ? state('ok', T.okTx) : state('fail', T.badTx)) +
      kv(T.kLedger, num(S.fmtNum(t.ledger), 'vivo')) +
      kv(T.kDate, esc(S.fmtDate(t.createdAt)) + ' · ' + esc(S.fmtTime(t.createdAt)) + ' ' + pair(T.local)) +
      kv(T.kSigs, num(String(t.signatures.length), 'vivo')) +
      kv(T.kMemo, t.memoShown ? '<span translate="no">' + esc(t.memoShown) + '</span>' : pair('memoHidden')) +
      kv(T.kOps, opsHTML(ops, isAnchor, kn && kn.reh, x.at)) +
      kv(T.kSource, t.sourceAccount ? '<code translate="no">' + esc(S.shortKey(t.sourceAccount)) + '</code> ' + lookBtn(t.sourceAccount) : '—') +
      kv(T.kHash, aug ? pair(T.augHash) : '<code class="q-hash" translate="no">' + esc(t.hash) + '</code>');
    var link = aug ? '<p class="q-note">' + pair(T.augNoLink) + '</p>' : '<p class="q-res-link">' + ext(C.EXPLORER + '/tx/' + t.hash, T.explorerTx) + '</p>';
    out(head + '<dl class="q-kv">' + rows + '</dl>' + vivo(x.at) + link, focus);
  }

  /* ───────────── step 2: tests A–D from the published file ───────────── */
  var steps = { ev: null, err: null };
  function renderSteps() {
    var box = $('qcSteps'); if (!box) return;
    if (steps.err) { box.innerHTML = '<p class="q-err" role="status">' + pair(T.stErr, { p: R.abcd.evidence }) + '</p>'; return; }
    if (!steps.ev) { box.innerHTML = loading(); return; }
    var s = steps.ev.steps || {}, c = s.C_proposer_plus_verifier || {};
    var refusedNet = function (x) { return x && x.ok === false; };
    var code = function (x) { var cs = (x && x.codes) || {}; var op = (cs.operations || []).filter(function (o) { return o !== 'op_success'; })[0]; return [cs.transaction, op].filter(Boolean).join(' / '); };
    function row(id, k, who, exp, res, evid) { return s[k] ? '<tr><th scope="row" translate="no">' + id + '</th><td>' + pair(who) + '</td><td>' + pair(exp) + '</td><td>' + res + '</td><td>' + evid + '</td></tr>' : ''; }
    function netRow(id, k, who) {
      var x = s[k];
      if (!x) return '';
      var res = (refusedNet(x) ? refusedState() : state('fail', T.notRefused)) + ' <code translate="no">' + esc(code(x)) + '</code> · ' + num(String(x.signatures), 'archivo') + ' ' + pair(x.signatures === 1 ? T.sig1 : T.sigN2);
      var same = x.body_hash && c.hash && x.body_hash === c.hash;
      var evid = pair(T.noLedger) + '<br>' + state(same ? 'ok' : 'fail', same ? { es: '✓', en: '✓' } : { es: '✗', en: '✗' }) + ' ' + pair(same ? T.sameBody : T.otherBody) + ' <code translate="no">' + esc(S.shortHash(x.body_hash)) + '</code>';
      return row(id, k, who, T.eRej, res, evid);
    }
    function chainRow(id, k, who, memo) {
      var x = s[k];
      if (!x) return '';
      var res = (x.ok ? state('ok', T.anchored) : state('fail', T.notAnch)) + ' ' + pair(T.qw, { m: memo }) + num(S.fmtNum(x.ledger), 'archivo');
      var evid = x.hash ? lookBtn(x.hash) + ' ' + ext(C.EXPLORER + '/tx/' + x.hash, T.explorerTx) : '';
      return row(id, k, who, T.eAnch, res, evid);
    }
    var dx = s.D_altered_after_proposer_signed;
    var dRow = dx ? row('D', 'D_altered_after_proposer_signed', T.wD, T.eVer,
      (dx.refused ? refusedState() : state('fail', T.notRefused)) + ' <code translate="no">' + esc(((dx.reasons || [])[0]) || '') + '</code>', pair(T.nothingSent)) : '';
    box.innerHTML = '<div class="q-table-wrap"><table class="q-table q-stable"><caption>' + pair(T.stCap) + '</caption><thead><tr>' +
      '<th scope="col">' + pair(T.thTest) + '</th><th scope="col">' + pair(T.thWho) + '</th><th scope="col">' + pair(T.thExp) + '</th><th scope="col">' + pair(T.thRes) + '</th><th scope="col">' + pair(T.thEv) + '</th></tr></thead><tbody>' +
      netRow('A', 'A_proposer_alone', T.wA) + netRow('B', 'B_verifier_alone', T.wB) + chainRow('C', 'C_proposer_plus_verifier', T.wC, 'QW#0') + dRow + chainRow('L', 'L_third_plus_verifier', T.wL, 'QW#1') +
      '</tbody></table></div>' + badge('archivo', { p: R.abcd.evidence }) + badge('ensayo');
  }

  /* Signer roles from the four published evidence files (public keys only). */
  function loadRoles() {
    var files = [R.abcd.evidence, R.dress.evidence, R.e2e.evidence, R.asset.evidence];
    files.forEach(function (p, i) {
      L.evidence(p).then(function (ev) {
        if (i === 0) { steps.ev = ev; renderSteps(); }
        var pk = ev.public_keys || {};
        Object.keys(pk).forEach(function (k) { if (L.isPublicKey(pk[k]) && !KNOWN[pk[k]]) ROLES[pk[k]] = ROLE[k] || T.roleOther; });
        rerender();
      }, function () { if (i === 0) { steps.err = true; renderSteps(); } });
    });
  }

  /* ───────────── wiring ───────────── */
  function preset(p) {
    var input = $('qcInput');
    if (p === 'real') {
      if (!C.ANCHOR_ACCOUNT) { current = null; out('<p class="q-plan-note">' + chip('planificado') + ' ' + pair(T.realPlan) + '</p>' + badge('plan')); return; }
      if (input) input.value = C.ANCHOR_ACCOUNT;
      return lookup(C.ANCHOR_ACCOUNT);
    }
    var v = p === 'abcd' ? R.abcd.account : R.abcd[p];
    if (input) input.value = v;
    lookup(v);
  }
  function start() {
    var input = $('qcInput'), go = $('qcGo');
    if (!input || !go) return;
    input.addEventListener('input', function () { if (secretish(input.value)) { input.value = ''; warnSecret(); } });
    input.addEventListener('paste', function (e) {
      var txt = e.clipboardData && e.clipboardData.getData ? e.clipboardData.getData('text') : '';
      if (secretish(txt)) { e.preventDefault(); input.value = ''; warnSecret(); }
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); lookup(input.value); } });
    go.addEventListener('click', function () { lookup(input.value); });
    d.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target : null; if (!t) return;
      var p = t.closest('[data-preset]');
      if (p) { preset(p.getAttribute('data-preset')); return; }
      var q = t.closest('[data-q]');
      if (q) { input.value = q.getAttribute('data-q'); lookup(input.value); var top = $('consulta'); if (top && top.scrollIntoView) top.scrollIntoView({ block: 'start' }); }
    });
    var clr = $('qcClear'); if (clr) clr.addEventListener('click', function () { log = []; renderLog(); });
    S.onLang(function () { renderLog(); renderSteps(); rerender(); });
    renderLog(); renderSteps();
    L.ready().then(function () {
      var rb = d.querySelector('[data-preset="real"]');
      if (rb && C.ANCHOR_ACCOUNT) { rb.removeAttribute('aria-disabled'); rb.classList.remove('is-plan'); }
      netTick(); loadRoles();
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
