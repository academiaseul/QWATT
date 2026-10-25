/**
 * QWATT · verificacion.html — re-derive a published batch in the browser (DESIGN §9.6)
 * ---------------------------------------------------------------------------
 * Gathers one batch through assets/qwatt-feed.js (same origin), reads its anchor,
 * signatures and account on Stellar testnet through assets/qwatt-live.js and
 * assets/qwatt-reconcile.js (GET only), hands everything to the pure checklist of
 * assets/qwatt-verify-steps.js with the repository's own protocol build, and draws
 * the ten rows. The tamper panel changes one byte in memory. The filter lab of
 * section 01 is assets/pages/verificacion-lab.js. Nothing is sent, nothing is stored.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE;
  if (!d || !S) return;
  var pair = S.pair, esc = S.esc, num = S.num, badge = S.badge;
  var L = root.QWATT_LIVE, Q = root.QWATT_STATUS;
  var EXPLORER = 'https://stellar.expert/explorer/testnet';
  var DEFAULT_FEEDS = { 'ensayo-8oct': '/evidence/feeds/ensayo-8oct/', muestra: '/evidence/feeds/muestra/' };
  var $ = function (id) { return d.getElementById(id); };

  /* ───────────────────────────── words ───────────────────────────── */

  var W = {
    ok: { es: 'CORRECTO', en: 'CORRECT' }, match: { es: 'COINCIDE', en: 'MATCHES' },
    fail: { es: 'FALLA', en: 'FAILS' }, nomatch: { es: 'NO COINCIDE', en: 'DOES NOT MATCH' },
    na: { es: 'NO APLICA', en: 'DOES NOT APPLY' }, wait: { es: 'COMPROBANDO…', en: 'CHECKING…' },
    pending: { es: 'PENDIENTE DE ANCLAJE', en: 'AWAITING ANCHOR' }, offline: { es: 'SIN CONEXIÓN · HORIZON TESTNET', en: 'OFFLINE · HORIZON TESTNET' },
    planned: { es: 'EN PREPARACIÓN (SEMANA 2)', en: 'IN PREPARATION (WEEK 2)' },
    asPub: { es: 'RECHAZADO CON MOTIVO, COMO SE PUBLICÓ', en: 'REFUSED WITH A REASON, AS PUBLISHED' },
    never: { es: 'NUNCA SE ANCLA', en: 'NEVER ANCHORED' }
  };
  var ICON = { ok: '✓', fail: '✗', na: '–', wait: '…', offline: '○', planned: '○' };
  var NA = {
    'schema-1.0.0': { es: 'lote de esquema 1.0.0, anterior a samples_root (semana 2)', en: 'schema 1.0.0 batch, from before samples_root (week 2)' },
    engine: { es: 'este motor aún no calcula samples_root (semana 2)', en: 'this engine does not compute samples_root yet (week 2)' },
    'too-big': { es: 'demasiado grande para un navegador; usa node batch/verify-cli.js', en: 'too large for a browser; use node batch/verify-cli.js' },
    fd13: { es: 'el motor actual exige samples_root (esquema 1.1.0, semana 2) y este lote es de esquema 1.0.0. Las demás comprobaciones usan el mismo código.', en: 'the current engine requires samples_root (schema 1.1.0, week 2) and this batch is schema 1.0.0. Every other check uses the same code.' },
    'not-anchored': { es: 'este feed no está anclado (a propósito: no enviamos transacciones)', en: 'this feed is not anchored (on purpose: we send no transactions)' }
  };
  var ROLE = {
    proposer: { es: 'el proponente', en: 'the proposer' }, verifier: { es: 'el verificador independiente', en: 'the independent verifier' },
    third: { es: 'el firmante externo al equipo', en: 'the signer from outside the team' }, thirdTrial: { es: 'la tercera clave del ensayo (desechable)', en: 'the third rehearsal key (throwaway)' }, unknown: { es: 'una clave que no es firmante', en: 'a key that is not a signer' }
  };
  var T = {
    sum: { es: '{n} de {m} comprobaciones correctas · {k} no aplican · {f} fallan', en: '{n} of {m} checks correct · {k} do not apply · {f} fail' },
    sumWait: { es: ' · {w} esperando a Stellar testnet', en: ' · {w} waiting for Stellar testnet' },
    batch: { es: 'Lote #{seq} · {when} UTC · {st}', en: 'Batch #{seq} · {when} UTC · {st}' },
    accepted: { es: 'aceptado', en: 'accepted' }, rejected: { es: 'rechazado', en: 'refused' },
    feedErr: { es: 'No pudimos descargar el feed ({url}). Puedes clonarlo y comprobarlo con node batch/verify-cli.js.', en: 'Could not download the feed ({url}). You can clone it and check it with node batch/verify-cli.js.' },
    noEngine: { es: 'Este navegador no cargó el código de verificación. Usa un navegador actual, o la sección B.', en: 'This browser did not load the verification code. Use a current browser, or section B.' },
    fileSha: { es: 'SHA-256 del archivo, calculado por tu navegador: ', en: 'SHA-256 of the file, computed by your browser: ' },
    declared: { es: 'declarada en el lote', en: 'declared in the batch' }, register: { es: 'en el registro público', en: 'in the public register' },
    recomputed: { es: 'recalculada (código del repositorio)', en: 'recomputed (repository code)' }, web: { es: 'recalculada (WebCrypto, tu navegador)', en: 'recomputed (WebCrypto, your browser)' },
    noWeb: { es: 'tu navegador no tiene WebCrypto: segunda opinión no aplica', en: 'your browser has no WebCrypto: second opinion does not apply' },
    schema: { es: 'Esquema del lote {s} · motor {e} · {n} intervalos con su esquema · solo números enteros', en: 'Batch schema {s} · engine {e} · {n} intervals with their schema · integers only' },
    samples: { es: 'Falta samples_root, como corresponde a un lote de esquema 1.0.0; no cuenta en contra del lote.', en: 'samples_root is missing, as expected for a schema 1.0.0 batch; it does not count against the batch.' },
    ivAll: { es: '{n} intervalos: cada uno pasa G0–G3 y está en su grilla de 5 minutos. Suma de min(A,B): ', en: '{n} intervals: each passes G0–G3 and sits on its 5-minute grid. Sum of min(A,B): ' },
    ivBad: { es: 'Intervalos que no pasan: ', en: 'Intervals that do not pass: ' },
    ivTable: { es: 'Ver los {n} intervalos', en: 'Show the {n} intervals' },
    rootDecl: { es: 'declarada', en: 'declared' }, rootRe: { es: 'recalculada', en: 'recomputed' },
    chain: { es: 'Recorrimos {n} lote(s) hacia atrás y cada uno vuelve a dar su huella; el primero apunta a 64 ceros.', en: 'We walked {n} batch(es) back and each one rehashes; the first points to 64 zeros.' },
    chainFirst: { es: 'Es el primer lote: apunta a 64 ceros.', en: 'It is the first batch: it points to 64 zeros.' },
    chainBroken: { es: 'La cadena se corta en el lote #{s}.', en: 'The chain breaks at batch #{s}.' },
    nextOk: { es: 'El lote siguiente (#{s}) apunta a la huella de este.', en: 'The next batch (#{s}) points to this one\'s fingerprint.' },
    nextBad: { es: 'El lote siguiente (#{s}) ya no apunta a este.', en: 'The next batch (#{s}) no longer points to this one.' },
    noNext: { es: 'Aún no hay un lote siguiente publicado.', en: 'No next batch is published yet.' },
    engineOk: { es: 'verifyBatch: CORRECTO, sin fallas.', en: 'verifyBatch: CORRECT, no failures.' },
    engineCodes: { es: 'verifyBatch devuelve: ', en: 'verifyBatch returns: ' },
    engineRej: { es: 'Publicado como rechazado con {c}; verifyBatch da lo mismo.', en: 'Published as refused with {c}; verifyBatch gives the same.' },
    anchorAt: { es: 'Anclado en la transacción {m}, ledger ', en: 'Anchored in transaction {m}, ledger ' },
    hashEq: { es: 'Huella anclada = huella recalculada de este lote', en: 'Anchored fingerprint = this batch\'s recomputed fingerprint' },
    hashNe: { es: 'La huella anclada no es la de este lote', en: 'The anchored fingerprint is not this batch\'s' },
    totalEq: { es: 'Total anclado = total del lote: ', en: 'Anchored total = batch total: ' },
    totalNe: { es: 'El total anclado no es el del lote: ', en: 'The anchored total is not the batch\'s: ' },
    signed: { es: 'Firmaron: ', en: 'Signed by: ' },
    stand: { es: 'El ensayo comprobó a propósito esta pareja; en la cuenta definitiva la conciliación la marcaría ROTO, porque no es una pareja acordada (acuerdo v3, §3).', en: 'The rehearsal checked this pair on purpose; on the real account reconciliation would mark it BROKEN, because it is not an agreed pair (freeze v3 §3).' },
    noEd: { es: 'Tu navegador no puede verificar firmas Ed25519; mostramos cuántas firmas tiene ({n}). Usa un navegador actual o node anchor/reconcile-cli.js.', en: 'Your browser cannot verify Ed25519 signatures; we show how many there are ({n}). Use a current browser or node anchor/reconcile-cli.js.' },
    thr: { es: 'Umbrales de la cuenta leídos ahora: ', en: 'Account thresholds read now: ' },
    thrSig: { es: ' · firmantes de peso 1: ', en: ' · signers of weight 1: ' }, thrMaster: { es: ' · clave maestra: peso ', en: ' · master key: weight ' },
    rehearsal: { es: 'Ensayo con umbrales 1/2/3 (diseño anterior); la cuenta definitiva tendrá 2/2/3.', en: 'Rehearsal with thresholds 1/2/3 (earlier design); the real account will use 2/2/3.' },
    pendingTxt: { es: 'Este lote aceptado aún no tiene ancla: pendiente de anclaje.', en: 'This accepted batch has no anchor yet: awaiting anchor.' },
    neverTxt: { es: 'Un lote rechazado nunca se ancla, y ninguna transacción de la cuenta lleva su huella.', en: 'A refused batch is never anchored, and no transaction of the account carries its fingerprint.' },
    neverBad: { es: 'Una transacción de la cuenta lleva la huella de este lote rechazado.', en: 'A transaction of the account carries this refused batch\'s fingerprint.' },
    offlineTxt: { es: 'Sin conexión con Horizon testnet: las comprobaciones del lote siguen funcionando; la comparación con Stellar testnet se reintenta en 30 s.', en: 'No connection to Horizon testnet: the batch checks still work; the comparison with Stellar testnet retries in 30 s.' },
    wrongNet: { es: 'La red respondió con otra frase de red; no mostramos nada.', en: 'The network answered with another passphrase; nothing is shown.' },
    plannedTxt: { es: 'La cuenta definitiva está en preparación (semana 2).', en: 'The real account is in preparation (week 2).' },
    viewTx: { es: 'Ver en stellar.expert ↗', en: 'View on stellar.expert ↗' },
    changed: { es: 'Cambiaste 1 byte · {f}: {a} → {b} · se pusieron en rojo: ', en: 'You changed 1 byte · {f}: {a} → {b} · turned red: ' },
    changedRaw: { es: ' · las lecturas crudas están fuera de la huella del lote; las ata samples_root, por eso la fila 6 sigue en verde.', en: ' · raw readings are outside the batch fingerprint; samples_root binds them, which is why row 6 stays green.' },
    noneRed: { es: 'ninguna', en: 'none' },
    forgerAnchoredNext: { es: 'Todas las huellas del lote vuelven a cuadrar, pero el lote ya no es el anclado: la huella en Stellar testnet no coincide, y el lote siguiente ya no apunta a este. Por eso anclamos.', en: 'Every fingerprint inside the batch adds up again, but it is no longer the anchored batch: the fingerprint on Stellar testnet does not match, and the next batch no longer points to this one. That is why we anchor.' },
    forgerAnchoredLast: { es: 'Todas las huellas del lote vuelven a cuadrar, pero el lote ya no es el anclado: la huella en Stellar testnet no coincide. Por eso anclamos.', en: 'Every fingerprint inside the batch adds up again, but it is no longer the anchored batch: the fingerprint on Stellar testnet does not match. That is why we anchor.' },
    forgerUnanchored: { es: 'Todas las huellas del lote vuelven a cuadrar, y el lote siguiente ya no apunta a este. En un feed anclado, además, la huella en Stellar testnet no coincidiría.', en: 'Every fingerprint inside the batch adds up again, and the next batch no longer points to this one. On an anchored feed, the fingerprint on Stellar testnet would not match either.' },
    forgerNewest: { es: 'Aquí no se pone nada en rojo: el lote es coherente consigo mismo, no hay un lote siguiente y nadie lo ancló. Un lote sin ancla se puede reemplazar sin que se note. Por eso cada lote aceptado se ancla en Stellar testnet.', en: 'Nothing turns red here: the batch is consistent with itself, there is no next batch and nobody anchored it. An unanchored batch can be replaced unnoticed. That is why every accepted batch is anchored on Stellar testnet.' },
    forgerNight: { es: ' Además, esta energía cae antes de que salga el sol: el filtro G2 la rechaza.', en: ' Also, this energy falls before sunrise: filter G2 refuses it.' },
    forgerWhat: { es: 'El falsificador sumó 1.000 mWh a los dos medidores del intervalo #{i} ({a} → {b}) y recalculó la energía, el total, la raíz y la huella.', en: 'The forger added 1,000 mWh to both meters of interval #{i} ({a} → {b}) and recomputed the energy, the total, the root and the fingerprint.' },
    rawOff: { es: 'Este modo necesita un lote de esquema 1.1.0 con sus lecturas crudas (semana 2).', en: 'This mode needs a schema 1.1.0 batch with its raw readings (week 2).' },
    tabSeq: { es: 'Intervalo', en: 'Interval' }, tabStart: { es: 'Inicio (UTC)', en: 'Start (UTC)' }, tabBasis: { es: 'Base', en: 'Basis' }, tabLeaf: { es: 'Hoja', en: 'Leaf' },
    tabBatch: { es: 'Lote', en: 'Batch' }, tabStatus: { es: 'Estado', en: 'Status' }, tabEnergy: { es: 'Energía', en: 'Energy' },
    ivDecl: { es: 'Declarada en el lote: ', en: 'Declared in the batch: ' }, ivDeclBad: { es: ' · no es la suma de los intervalos', en: ' · not the sum of the intervals' },
    rawNoPayload: { es: 'Ninguna lectura cruda de este lote trae bytes que cambiar.', en: 'No raw reading in this batch carries bytes to change.' },
    noIntervals: { es: 'Este lote no tiene intervalos aceptados que cambiar.', en: 'This batch has no accepted intervals to change.' },
    forgerAnchoredOffline: { es: 'Todas las huellas del lote vuelven a cuadrar. Ahora no pudimos leer Stellar testnet; cuando vuelva la conexión, la fila 10 se pondrá en rojo: la huella anclada no es la de este lote.', en: 'Every fingerprint inside the batch adds up again. We could not read Stellar testnet just now; when the connection returns, row 10 will turn red: the anchored fingerprint is not this batch\'s.' },
    tabExp: { es: 'Total esperado', en: 'Expected total' }, tabDecl: { es: 'Total declarado', en: 'Declared total' },
    capIv: { es: 'Intervalos del lote, en milivatios-hora', en: 'The batch\'s intervals, in milliwatt-hours' }, capTot: { es: 'Total acumulado, lote por lote', en: 'Running total, batch by batch' },
    corridaOn: { es: 'Leído ahora desde {h}.', en: 'Read now from {h}.' }
  };
  var FILE_SRC = { es: 'Leído del archivo publicado · lote #{s} · SHA-256 {h}', en: 'Read from the published file · batch #{s} · SHA-256 {h}' };
  var MONTHS = { es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };

  function t(o, vars) { return S.t(o, vars); }
  function st(kind, words, extra) {
    var icon = ICON[kind] || '–';
    var w = words || W[kind] || W.na;
    return '<span aria-hidden="true">' + icon + '</span> ' + pair(extra ? { es: w.es + ' · ' + extra.es, en: w.en + ' · ' + extra.en } : w);
  }
  function short(h) { return h ? '<span class="q-hash" translate="no" title="' + esc(h) + '">' + esc(h.slice(0, 8) + '…' + h.slice(-6)) + '</span>' : '—'; }
  function full(h) { return h ? '<span class="q-hash" translate="no">' + esc(h) + '</span>' : '—'; }
  function n(v, src) { return num(S.fmtNum(v), src); }
  function when(iso, lg) {
    var dt = new Date(iso); if (!isFinite(dt)) return '—';
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return dt.getUTCDate() + ' ' + MONTHS[lg][dt.getUTCMonth()] + ' ' + dt.getUTCFullYear() + ', ' + p(dt.getUTCHours()) + ':' + p(dt.getUTCMinutes());
  }
  function hhmm(iso) { var dt = new Date(iso); var p = function (x) { return (x < 10 ? '0' : '') + x; }; return p(dt.getUTCHours()) + ':' + p(dt.getUTCMinutes()); }
  function simBadge() {
    var lab = L && L.CONFIG && L.CONFIG.SIM_LABEL;
    return badge('sim', null, lab && lab.es ? lab : null);
  }
  function webSubtle() { return (typeof self !== 'undefined' && self.crypto && self.crypto.subtle) || null; }
  function deps() {
    var R = root.QWATT_RECONCILE, E = root.QWATT_ENVELOPE;
    return { P: root.QWATT_PROTOCOL, webcrypto: webSubtle(), signedBy: (R && typeof R.signedBy === 'function' && R.signedBy) || (E && E.signedBy) || null };
  }

  /* ───────────────────────────── state ───────────────────────────── */

  var cur = { id: 'ensayo-8oct', feed: null, seq: null, input: null, base: null, rows: null, change: null, mode: null, stellar: null, stellarFor: null, timer: null, metas: {} };
  var bases = Object.assign({}, DEFAULT_FEEDS), corrida = null;

  function setBusy(on) { var ol = $('vRows'); if (ol) ol.setAttribute('aria-busy', on ? 'true' : 'false'); }
  function feedError(url) {
    var p = $('vFeedErr'); if (!p) return;
    p.hidden = false; p.innerHTML = pair(T.feedErr, { url: url });
  }

  /* ───────────────────────────── rows ───────────────────────────── */

  function title(n) { var h = d.querySelector('.q-vrow[data-row="' + n + '"] h4 [data-l="' + S.lang() + '"]'); return h ? h.textContent : '#' + n; }

  function vals(r, input) {
    var b = input.batch, obj = b.obj, seq = obj.seq;
    switch (r.id) {
      case 'download':
        return '<p>' + pair(T.fileSha) + (r.fileSha256 ? full(r.fileSha256) : pair(T.noWeb)) + '</p>' +
          '<dl class="q-kv"><dt>' + pair(T.declared) + '</dt><dd>' + short(r.declared) + '</dd><dt>' + pair(T.register) + '</dt><dd>' + short(r.ledger) + '</dd></dl>' +
          badge('archivo', { s: seq, h: (r.declared || '').slice(0, 8) }, FILE_SRC);
      case 'format':
        return '<p>' + pair(T.schema, { s: r.schema, e: r.engine, n: (obj.intervals || []).length }) + '</p>' + (r.samplesNote ? '<p class="q-vnote">' + pair(T.samples) + '</p>' : '') +
          (r.errors.length ? '<p class="q-codes">' + r.errors.map(esc).join('<br>') + '</p>' : '');
      case 'intervals': {
        var sum = r.table.reduce(function (s, x) { return s + (x.basis || 0); }, 0);
        var head = r.failed.length ? '<p>' + pair(T.ivBad) + '<span class="q-codes">#' + r.failed.join(', #') + '</span></p>'
          : '<p>' + pair(T.ivAll, { n: r.count }) + n(sum, 'recalculado') + ' mWh</p>';
        /* the batch's own energy_mwh next to the recomputed sum, so a changed total is visible here too */
        if (r.declaredEnergy != null) head += '<p' + (r.energyMatch === false ? ' class="is-bad"' : '') + '>' + pair(T.ivDecl) + n(r.declaredEnergy, 'archivo') + ' mWh' + (r.energyMatch === false ? '<span class="q-codes">' + pair(T.ivDeclBad) + '</span>' : '') + '</p>';
        var rows = r.table.map(function (x) {
          var bad = x.verdict !== 'accept' || !x.onGrid;
          return '<tr><td>#' + x.seq + '</td><td' + (x.onGrid ? '' : ' class="is-bad"') + '>' + esc(hhmm(x.ts)) + '</td><td>' + n(x.a, 'archivo') + '</td><td>' + n(x.b, 'archivo') + '</td><td>' + n(x.basis, 'recalculado') + '</td><td' + (bad ? ' class="is-bad"' : '') + '>' + short(x.leaf) + (x.codes.length ? ' <span class="q-codes">' + x.codes.map(esc).join(', ') + '</span>' : '') + '</td></tr>';
        }).join('');
        return head + '<details><summary>' + pair(T.ivTable, { n: r.count }) + '</summary><div class="q-mtab-wrap"><table class="q-mtab"><caption>' + pair(T.capIv) + '</caption><thead><tr><th scope="col">' + pair(T.tabSeq) + '</th><th scope="col">' + pair(T.tabStart) + '</th><th scope="col">A</th><th scope="col">B</th><th scope="col">' + pair(T.tabBasis) + '</th><th scope="col">' + pair(T.tabLeaf) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>' +
          badge('recalculado', { f: 'evaluateInterval, basisMwh' }) + simBadge();
      }
      case 'root':
        return '<dl class="q-kv"><dt>' + pair(T.rootDecl) + '</dt><dd>' + short(r.declared) + '</dd><dt>' + pair(T.rootRe) + '</dt><dd>' + short(r.recomputed) + '</dd></dl>' + badge('recalculado', { f: 'merkleRoot' });
      case 'raw':
        return r.state === 'na' ? '' : '<dl class="q-kv"><dt>' + pair(T.rootDecl) + '</dt><dd>' + short(r.declared) + '</dd><dt>' + pair(T.rootRe) + '</dt><dd>' + short(r.recomputed) + '</dd></dl>' + badge('recalculado', { f: 'samplesRoot' });
      case 'fingerprint':
        return '<dl class="q-kv"><dt>' + pair(T.recomputed) + '</dt><dd>' + short(r.recomputed) + '</dd><dt>' + pair(T.web) + '</dt><dd>' + (r.webcrypto ? short(r.webcrypto) : pair(T.noWeb)) + '</dd><dt>' + pair(T.declared) + '</dt><dd>' + short(r.declared) + '</dd><dt>' + pair(T.register) + '</dt><dd>' + short(r.ledger) + '</dd></dl>' +
          '<details><summary>SHA-256</summary><p>' + full(r.recomputed) + '</p></details>' + badge('recalculado', { f: 'batchSha256' });
      case 'chain': {
        var a = r.walked ? pair(T.chain, { n: r.walked }) : (r.genesis ? pair(T.chainFirst) : '');
        var brk = r.brokenAt != null ? ' <span class="q-codes">' + pair(T.chainBroken, { s: r.brokenAt }) + '</span>' : '';
        var nx = r.next ? (r.next.link ? pair(T.nextOk, { s: r.next.seq }) : '<span class="q-codes">' + pair(T.nextBad, { s: r.next.seq }) + '</span>') : pair(T.noNext);
        return '<p>' + a + brk + '</p><p>' + nx + '</p>' + badge('recalculado', { f: 'batchSha256, prev_hash' });
      }
      case 'total': {
        var rows2 = r.table.map(function (x) {
          return '<tr><td>#' + x.seq + '</td><td>' + pair(x.status === 'rejected' ? T.rejected : T.accepted) + '</td><td>' + n(x.energy, 'archivo') + '</td><td>' + n(x.expected, 'recalculado') + '</td><td' + (x.ok ? '' : ' class="is-bad"') + '>' + n(x.declared, 'archivo') + '</td></tr>';
        }).join('');
        return '<div class="q-mtab-wrap"><table class="q-mtab"><caption>' + pair(T.capTot) + '</caption><thead><tr><th scope="col">' + pair(T.tabBatch) + '</th><th scope="col">' + pair(T.tabStatus) + '</th><th scope="col">' + pair(T.tabEnergy) + ' (<span class="q-unit" translate="no">mWh</span>)</th><th scope="col">' + pair(T.tabExp) + '</th><th scope="col">' + pair(T.tabDecl) + '</th></tr></thead><tbody>' + rows2 + '</tbody></table></div>' + simBadge();
      }
      case 'engine':
        if (r.state === 'na') return '';
        if (r.asPublished === 'rejected') return '<p>' + pair(T.engineRej, { c: (r.codes || []).join(', ') }) + '</p>' + (r.state === 'fail' ? '<p class="q-codes">' + esc((r.codes || []).join(', ')) + '</p>' : '');
        return r.ok ? '<p>' + pair(T.engineOk) + '</p>' : '<p>' + pair(T.engineCodes) + '<span class="q-codes">' + esc((r.codes || []).join(', ')) + '</span></p>';
      case 'stellar': return stellarVals(r);
    }
    return '';
  }

  function stellarVals(r) {
    if (r.state === 'na') return '';
    if (r.state === 'offline') return '<p>' + pair(cur.stellar && cur.stellar.code === 'wrong-network' ? T.wrongNet : T.offlineTxt) + '</p>';
    if (r.state === 'planned') return '<p>' + pair(T.plannedTxt) + '</p>' + badge('plan');
    if (r.state === 'wait' && !r.why) return '';
    var thr = r.account ? '<p>' + pair(T.thr) + num(r.account.thresholds, 'vivo') + pair(T.thrSig) + n(r.account.signersW1, 'vivo') + pair(T.thrMaster) + n(r.account.masterWeight, 'vivo') + '</p>' +
      (r.account.thresholds === '1/2/3' ? '<p class="q-vnote">' + pair(T.rehearsal) + '</p>' : '') : '';
    if (r.why === 'pending') return '<p>' + pair(T.pendingTxt) + '</p>' + thr + badge('vivo', { t: S.fmtTime() });
    if (r.why === 'never-anchored') return '<p>' + pair(r.state === 'ok' ? T.neverTxt : T.neverBad) + '</p>' + thr + badge('vivo', { t: S.fmtTime() });
    var a = r.anchor;
    if (!a) return thr;
    var out = '<p>' + pair(T.anchorAt, { m: a.memoShown || '—' }) + n(a.ledger, 'vivo') + ' · ' + esc(when(a.createdAt, S.lang())) + ' UTC · <a class="q-link" href="' + EXPLORER + '/tx/' + esc(a.txHash) + '" target="_blank" rel="noopener">' + pair(T.viewTx) + '<span class="q-vh">' + pair('newTab') + '</span></a></p>';
    out += '<p>' + (a.hashMatch ? pair(T.hashEq) : '<span class="q-codes">' + pair(T.hashNe) + '</span>') + ' · ' + short(a.sha256) + '</p>';
    out += '<p>' + (a.totalMatch ? pair(T.totalEq) : '<span class="q-codes">' + pair(T.totalNe) + '</span>') + n(a.cumulativeMwh, 'vivo') + ' mWh</p>';
    if (r.noEd25519) out += '<p class="q-vnote">' + pair(T.noEd, { n: r.signatureCount }) + '</p>';
    else if (r.signers) {
      var trial = cur.feed && cur.feed.manifest && cur.feed.manifest.prior;
      out += '<p>' + pair(T.signed) + r.signers.map(function (s) { return pair(s === 'third' && trial ? ROLE.thirdTrial : ROLE[s] || ROLE.unknown); }).join(' + ') + '</p>';
      if (r.pair === 'third+verifier') out += '<p class="q-vnote">' + pair(T.stand) + '</p>';
    }
    return out + thr + badge('vivo', { t: S.fmtTime() }) + simBadge();
  }

  function stateWords(r) {
    if (r.id === 'raw' && r.state === 'na') return st('na', null, NA[r.why] || NA['schema-1.0.0']);
    if (r.id === 'engine' && r.state === 'na') return st('na', null, NA.fd13);
    if (r.id === 'stellar' && r.state === 'na') return st('na', null, NA[r.why] || NA['not-anchored']);
    if (r.id === 'stellar' && r.state === 'wait' && r.why === 'pending') return st('wait', W.pending);
    if (r.id === 'stellar' && r.state === 'ok' && r.why === 'never-anchored') return st('ok', W.never);
    if (r.id === 'engine' && r.state === 'ok' && r.asPublished === 'rejected') return st('ok', W.asPub);
    var matchRow = ['download', 'root', 'fingerprint', 'stellar'].indexOf(r.id) >= 0;
    if (r.state === 'ok') return st('ok', matchRow ? W.match : W.ok);
    if (r.state === 'fail') return st('fail', matchRow ? W.nomatch : W.fail);
    return st(r.state);
  }

  function render() {
    var rows = cur.rows, input = cur.tin || cur.input;
    if (!rows || !input) return;
    rows.forEach(function (r) {
      var li = d.querySelector('.q-vrow[data-row="' + r.n + '"]');
      if (!li) return;
      li.setAttribute('data-state', r.state);
      var s = li.querySelector('[data-slot="state"]');
      s.setAttribute('data-state', r.state === 'planned' ? 'planned' : r.state);
      s.innerHTML = stateWords(r);
      li.querySelector('[data-slot="vals"]').innerHTML = vals(r, input);
    });
    var sm = root.QWATT_VERIFY_STEPS.summary(rows);
    var sumEl = $('vSum');
    if (sumEl) sumEl.innerHTML = pair(T.sum, { n: sm.ok, m: sm.total, k: sm.na, f: sm.fail }) + (sm.wait + sm.offline ? pair(T.sumWait, { w: sm.wait + sm.offline }) : '');
    renderTamper();
  }
  function waitRows() {
    var lis = d.querySelectorAll('.q-vrow');
    for (var i = 0; i < lis.length; i++) {
      lis[i].setAttribute('data-state', 'wait');
      var s = lis[i].querySelector('[data-slot="state"]'); s.setAttribute('data-state', 'wait'); s.innerHTML = st('wait');
    }
  }

  /* ───────────────────────────── running ───────────────────────────── */

  function runOn(input) {
    var St = root.QWATT_VERIFY_STEPS;
    input.stellar = cur.feed && cur.feed.anchored ? (cur.stellarFor === cur.id && cur.stellar ? cur.stellar : { state: 'wait' }) : undefined;
    input.requireTarget = cur.id === 'corrida';
    return St.run(input, deps());
  }
  function rerun() {
    if (!cur.input) return Promise.resolve();
    var St = root.QWATT_VERIFY_STEPS;
    var jobs = [runOn(cur.input)];
    if (cur.mode) { var tt = St.tamper(cur.input, cur.mode, deps()); if (!tt.disabled) { cur.tin = tt.input; cur.change = tt.change; jobs.push(runOn(tt.input)); } }
    return Promise.all(jobs).then(function (r) { cur.base = r[0]; cur.rows = r[1] || r[0]; if (!r[1]) cur.tin = null; render(); });
  }
  function check() {
    var sel = $('vBatch');
    if (!cur.feed || !sel || sel.value === '') return;
    var seq = +sel.value;
    cur.seq = seq; cur.mode = null; cur.change = null; cur.tin = null;
    setBusy(true); waitRows();
    cur.feed.input(seq).then(function (input) {
      cur.input = input;
      return rerun();
    }).then(function () { setBusy(false); modes(); if (cur.feed.anchored) loadStellar(); }, function (e) {
      setBusy(false); feedError(cur.feed.base + ' · ' + (e && e.message || e));
    });
  }

  function loadStellar() {
    var acct = cur.feed.account, id = cur.id;
    if (cur.stellarFor === id && cur.stellar && cur.stellar.state === 'ok') return;
    clearTimeout(cur.timer);
    if (!L || !root.QWATT_RECONCILE) { cur.stellar = { state: 'offline' }; cur.stellarFor = id; rerun(); return; }
    var anchors;
    L.network().then(function () { return L.anchors(acct); }).then(function (list) {
      anchors = list;
      return Promise.all(list.map(function (a) { return L.tx(a.txHash); }));
    }).then(function (txs) {
      var map = {};
      txs.forEach(function (x) { map[x.hash] = x; });
      return L.account(acct).then(function (account) { return { state: 'ok', anchors: anchors, txs: map, account: account, roles: cur.feed.roles }; });
    }).then(function (s) {
      if (cur.id !== id) return;
      cur.stellar = s; cur.stellarFor = id; rerun();
    }, function (e) {
      if (cur.id !== id) return;
      cur.stellar = { state: 'offline', code: e && e.code }; cur.stellarFor = id; rerun();
      if (!(e && e.code === 'wrong-network')) cur.timer = setTimeout(function () { if (cur.id === id) { cur.stellar = null; loadStellar(); } }, 30000);
    });
  }

  /* ───────────────────────────── sources and batches ───────────────────────────── */

  function options() {
    var sel = $('vBatch'); if (!sel || !cur.feed) return;
    var lg = S.lang(), keep = sel.value;
    sel.innerHTML = cur.feed.entries.map(function (e) {
      var m = cur.metas[cur.id + ':' + e.seq];
      var w = m ? when(m.ts, lg) + '–' + hhmm(m.te) : '…';
      return '<option value="' + e.seq + '">' + esc(S.t(T.batch, { seq: e.seq, when: w, st: S.t(e.status === 'rejected' ? T.rejected : T.accepted) })) + '</option>';
    }).join('');
    if (keep !== '' && cur.feed.entries[+keep]) sel.value = keep;
  }
  function selectFeed(id) {
    var base = id === 'corrida' ? corrida && corrida.base : bases[id];
    if (!base) return;
    cur.id = id; cur.feed = null; cur.input = null; cur.rows = null;
    var p = $('vFeedErr'); if (p) p.hidden = true;
    setBusy(true); waitRows();
    root.QWATT_FEED.open(base, id === 'corrida' ? { account: corrida.account } : {}).then(function (feed) {
      if (cur.id !== id) return null;
      cur.feed = feed;
      var last = feed.entries.length - 1;
      var from = Math.max(0, feed.entries.length - root.QWATT_FEED.WALK);
      return Promise.all(feed.entries.slice(from).map(function (e) {
        return feed.batch(e.seq).then(function (b) { cur.metas[id + ':' + e.seq] = { ts: b.obj.ts_start, te: b.obj.ts_end }; });
      })).then(function () { options(); $('vBatch').value = String(last); check(); });
    }).catch(function () { setBusy(false); feedError(base); });
  }
  function configureCorrida(status) {
    var fd = status && (status.feeds || []).filter(function (f) { return f.id === 'corrida'; })[0];
    (status && status.feeds || []).forEach(function (f) { if (f.base && f.id !== 'corrida') bases[f.id] = f.base; });
    var acct = status && status.anchor && status.anchor.account;
    if (!fd || !fd.base || !acct) return;
    corrida = { base: fd.base, account: acct };
    var card = d.querySelector('.q-srcard[data-feed="corrida"]');
    if (!card) return;
    card.classList.remove('is-off');
    card.querySelector('input').disabled = false;
    var host = (/^https:\/\/([^/]+)\//.exec(fd.base) || [])[1] || fd.base;
    card.querySelector('[data-slot="corrida-chip"]').innerHTML = S.chip('testnet');
    card.querySelector('[data-slot="corrida-note"]').innerHTML = pair(T.corridaOn, { h: host });
  }

  /* ───────────────────────────── tamper ───────────────────────────── */

  /* Why the raw mode cannot run on the current batch, or null: it asks the same tamper() the click runs. */
  var rawWhyMemo = { input: null, why: null };
  function rawWhy() {
    if (!cur.input) return null;
    if (rawWhyMemo.input !== cur.input) {
      var rt = root.QWATT_VERIFY_STEPS.tamper(cur.input, 'raw', deps());
      rawWhyMemo = { input: cur.input, why: rt && !rt.disabled ? null : (rt && rt.why === 'no-payload' ? T.rawNoPayload : T.rawOff) };
    }
    return rawWhyMemo.why;
  }
  function modes() {
    var bs = d.querySelectorAll('#vModes [data-mode]');
    var why = rawWhy();
    for (var i = 0; i < bs.length; i++) {
      var m = bs[i].getAttribute('data-mode');
      var dis = m === 'raw' && cur.input && why;
      bs[i].disabled = !cur.input || !!dis;
      bs[i].setAttribute('aria-pressed', cur.mode === m ? 'true' : 'false');
      if (dis) bs[i].title = S.t(why); else bs[i].removeAttribute('title');
    }
    var r = $('vRestore'); if (r) r.hidden = !cur.mode;
  }
  function renderTamper() {
    var out = $('vTamperOut'); if (!out) return;
    var why = rawWhy();
    if (!cur.mode || !cur.change || !cur.rows) { out.innerHTML = why ? '<span class="is-why">' + pair(why) + '</span>' : ''; modes(); return; }
    var St = root.QWATT_VERIFY_STEPS;
    var red = St.compare(cur.base, cur.rows);
    var list = red.length ? red.map(function (k) { return '<b>' + k + ' · ' + esc(title(k)) + '</b>'; }).join(', ') : pair(T.noneRed);
    var c = cur.change, html;
    if (c.forged) {
      var kase = St.forgerCase(cur.tin || cur.input);
      var night = cur.rows[2] && cur.rows[2].state === 'fail';
      /* the anchored explanation claims a Stellar comparison: only when row 10 actually turned red */
      var stellarRed = cur.rows[9] && cur.rows[9].state === 'fail';
      var msg = kase === 'anchored' ? (!stellarRed ? T.forgerAnchoredOffline : cur.input.next ? T.forgerAnchoredNext : T.forgerAnchoredLast) : kase === 'unanchored' ? T.forgerUnanchored : T.forgerNewest;
      html = pair(T.forgerWhat, { i: c.interval, a: c.before, b: c.after }) + ' ' + pair(msg) + (night ? pair(T.forgerNight) : '') + (red.length ? '<br>' + pair({ es: 'Se pusieron en rojo: ', en: 'Turned red: ' }) + list : '');
    } else {
      html = pair(T.changed, { f: c.field + (c.pos != null ? '[' + c.pos + ']' : ''), a: c.before, b: c.after }) + list + (cur.mode === 'raw' ? pair(T.changedRaw) : '');
    }
    out.innerHTML = html;
    modes();
  }
  function tamper(mode) {
    if (!cur.input) return;
    var tt = root.QWATT_VERIFY_STEPS.tamper(cur.input, mode, deps());
    if (tt.disabled) {
      cur.mode = null; cur.change = null; cur.tin = null; renderTamper();
      var why = mode !== 'raw' ? T.noIntervals : tt.why === 'no-payload' ? T.rawNoPayload : T.rawOff;
      var out = $('vTamperOut'); if (out) out.innerHTML = '<span class="is-why">' + pair(why) + '</span>';
      return;
    }
    cur.mode = mode;
    rerun();
  }

  /* ───────────────────────────── provenance ───────────────────────────── */

  function provenance() {
    var P = root.QWATT_PROTOCOL, ul = $('vProv');
    if (!P || !ul) return;
    ul.innerHTML = root.QWATT_VERIFY_STEPS.provenance(P).map(function (s) {
      return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener"><code>' + esc(s.path) + '</code><span class="q-ext" aria-hidden="true">↗</span><span class="q-vh">' + pair('newTab') + '</span></a> ' + full(s.sha256) + '</li>';
    }).join('');
  }

  /* ───────────────────────────── start ───────────────────────────── */

  function start() {
    var ready = root.QWATT_PROTOCOL && root.QWATT_FEED && root.QWATT_VERIFY_STEPS;
    if (!ready) { var p = $('vFeedErr'); if (p) { p.hidden = false; p.innerHTML = pair(T.noEngine); } return; }
    provenance();
    d.querySelector('.q-srcs').addEventListener('change', function (e) { if (e.target && e.target.name === 'vsrc') selectFeed(e.target.value); });
    $('vRun').addEventListener('click', check);
    $('vBatch').addEventListener('change', check);
    $('vModes').addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-mode]'); if (b && !b.disabled) tamper(b.getAttribute('data-mode')); });
    $('vRestore').addEventListener('click', function () { cur.mode = null; cur.change = null; cur.tin = null; rerun(); });
    S.onLang(function () { options(); render(); });
    var status = Q && Q.load ? Q.load().catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([L ? L.ready() : null, status]).then(function (r) { configureCorrida(r[1]); }, function () { return null; }).then(function () {
      var checked = d.querySelector('.q-srcs input:checked');
      selectFeed(checked ? checked.value : 'ensayo-8oct');
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
