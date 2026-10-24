/**
 * QWATT public accounts and evidence (respaldo.html): every project account read live from Horizon
 * testnet through QWATT_LIVE, and each 8 Oct rehearsal's published evidence compared with what the
 * account holds now. Read-only: nothing is signed or sent, no amounts, no memo other than QW#n,
 * no batch ids. The sweep of every key named in the evidence files runs only on the visitor's click.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE, L = root.QWATT_LIVE;
  if (!d || !S || !L) return;
  var C = L.CONFIG, R = C.REHEARSAL, A = C.AUGUST;
  var pair = S.pair, esc = S.esc, num = S.num, badge = S.badge;
  function $(id) { return d.getElementById(id); }

  /* ───────────── words (every es: has its en: on the same line) ───────────── */
  var T = {
    readAt: { es: 'Leído de Horizon testnet a las {t} · se vuelve a leer cada 60 s', en: 'Read from Horizon testnet at {t} · read again every 60 s' },
    exist: { es: 'existen ahora en Stellar testnet', en: 'exist now on Stellar testnet' },
    acctsSub: { es: '2 de agosto (stellar.toml) · 4 desechables del ensayo del 8 oct · la cuenta 2 de 3: en preparación (semana 2)', en: '2 from August (stellar.toml) · 4 throwaway accounts of the 8 Oct rehearsal · the 2-of-3 account: in preparation (week 2)' },
    signersSub: { es: 'agosto: una sola clave · ensayos del 8 oct: firmantes de peso 1, maestra en peso {w} · cuenta definitiva: 3 (objetivo)', en: 'August: a single key · 8 Oct rehearsals: weight-1 signers, master at weight {w} · real account: 3 (target)' },
    sinceSub: { es: 'en las 6 cuentas', en: 'on the 6 accounts' },
    zeroExp: { es: '✓ 0, COMO ESPERÁBAMOS', en: '✓ 0, AS EXPECTED' },
    zeroNo: { es: '✗ ESPERÁBAMOS 0', en: '✗ WE EXPECTED 0' },
    expOk: { es: '✓ COMO ESPERÁBAMOS', en: '✓ AS EXPECTED' },
    ledgerSub: { es: 'último ledger · frase de red de testnet ✓', en: 'latest ledger · testnet passphrase ✓' },
    kAddr: { es: 'Dirección pública', en: 'Public address' },
    kThr: { es: 'Umbrales bajo/medio/alto', en: 'Thresholds low/medium/high' },
    kSigners: { es: 'Firmantes con peso', en: 'Signers with weight' },
    kMaster: { es: 'Peso de la clave maestra', en: 'Master key weight' },
    kLast: { es: 'Última actividad', en: 'Last activity' },
    kSince: { es: 'Transacciones desde el 19 oct', en: 'Transactions since 19 Oct' },
    kOne: { es: '¿Una sola clave puede enviar una transacción?', en: 'Can a single key send a transaction?' },
    notSet: { es: 'no configurado', en: 'not set' },
    yes: { es: 'SÍ', en: 'YES' },
    no: { es: 'NO', en: 'NO' },
    earlier: { es: 'umbral bajo {l}: diseño anterior; la cuenta definitiva tendrá 2/2/3', en: 'low threshold {l}: earlier design; the real account will use 2/2/3' },
    augWhy: { es: 'una sola clave: por eso la cuenta de anclaje será otra', en: 'a single key: that is why the anchoring account will be a different one' },
    explorer: { es: 'Ver la cuenta en stellar.expert', en: 'View the account on stellar.expert' },
    noLink: { es: 'sin enlace al explorador (cuenta de agosto)', en: 'no explorer link (August account)' },
    sum: { es: '{n} de {m} comprobaciones coinciden', en: '{n} of {m} checks match' },
    match: { es: '✓ COINCIDE', en: '✓ MATCHES' },
    nomatch: { es: '✗ NO COINCIDE', en: '✗ DOES NOT MATCH' },
    evNone: { es: 'No pudimos leer el archivo de evidencia publicado; las cuentas de arriba siguen funcionando.', en: 'Could not read the published evidence file; the accounts above still work.' },
    cHead: { es: 'la huella que la cuenta guarda ahora es la última del archivo', en: 'the fingerprint the account holds now is the file\'s last one' },
    cHeadAn: { es: 'la huella que la cuenta guarda ahora es la del último anclaje', en: 'the fingerprint the account holds now is the last anchor\'s' },
    cTotal: { es: 'el total que la cuenta guarda ahora es el último total del archivo', en: 'the total the account holds now is the file\'s last total' },
    cCount: { es: 'el archivo declara {a} anclajes; Horizon lista {b}', en: 'the file declares {a} anchors; Horizon lists {b}' },
    cEnds: { es: 'la primera y la última transacción de anclaje son las del archivo', en: 'the first and the last anchoring transactions are the file\'s' },
    cCL: { es: 'QW#0 y QW#1 son las transacciones de las pruebas C y L del archivo', en: 'QW#0 and QW#1 are the transactions of tests C and L in the file' },
    cRecs: { es: 'cada lote anclado del archivo tiene en Horizon la misma huella y la misma transacción', en: 'every anchored batch in the file has the same fingerprint and transaction on Horizon' },
    cTxs: { es: 'las transacciones de anclaje son, en orden, las del archivo', en: 'the anchoring transactions are, in order, the file\'s' },
    kTotal: { es: 'Total que guarda la cuenta', en: 'Total the account holds' },
    kAnchors: { es: 'Anclajes (QW#n)', en: 'Anchors (QW#n)' },
    kHash: { es: 'Huella que guarda la cuenta', en: 'Fingerprint the account holds' },
    lastQW: { es: 'último {m} · {d}', en: 'last {m} · {d}' },
    assetNote: { es: 'El archivo no registra el total; lo mostramos tal como está en Horizon. Es un extracto con las claves públicas y los anclajes del ensayo; el registro completo está en el repositorio.', en: 'The file does not record the total; we show it as Horizon has it. It is an extract with the rehearsal\'s public keys and anchors; the full record is in the repository.' },
    assetFull: { es: 'Registro completo (trabajo previo)', en: 'Full record (prior work)' },
    sweepRun: { es: 'Leyendo {n} cuentas en Horizon testnet…', en: 'Reading {n} accounts on Horizon testnet…' },
    sweepSum: { es: '{n} de {m} cuentas existen y no cambiaron desde el 19 oct', en: '{n} of {m} accounts exist and have not changed since 19 Oct' },
    sweepCap: { es: 'Cada clave pública de los archivos de evidencia y de stellar.toml, leída ahora (sin montos)', en: 'Every public key in the evidence files and stellar.toml, read now (no amounts)' },
    thRole: { es: 'Rol', en: 'Role' },
    thKey: { es: 'Cuenta', en: 'Account' },
    thThr: { es: 'Umbrales', en: 'Thresholds' },
    thSig: { es: 'Firmantes con peso', en: 'Signers with weight' },
    thMod: { es: 'Última modificación', en: 'Last modified' },
    thSince: { es: '¿Sin cambios desde el 19 oct?', en: 'Unchanged since 19 Oct?' },
    unchanged: { es: '✓ SIN CAMBIOS', en: '✓ UNCHANGED' },
    changed: { es: '✗ CAMBIÓ', en: '✗ CHANGED' },
    missing: { es: 'no encontrada', en: 'not found' },
    signOnly: { es: '– SOLO FIRMA', en: '– SIGNS ONLY' },
    signOnlyWhy: { es: 'clave que solo firma: no tiene cuenta propia en testnet, y no la necesita', en: 'a key that only signs: it has no account of its own on testnet, and needs none' },
    sweepSign: { es: '{k} claves solo firman (no necesitan cuenta)', en: '{k} keys only sign (they need no account)' },
    fDress: { es: 'Ensayo acelerado', en: 'Accelerated rehearsal' },
    fAbcd: { es: 'Pruebas A–D', en: 'Tests A–D' },
    fE2e: { es: 'Extremo a extremo', en: 'End to end' },
    fAsset: { es: 'Ensayo con el activo', en: 'Asset rehearsal' },
    fAug: { es: 'stellar.toml (agosto)', en: 'stellar.toml (August)' },
    rAccount: { es: 'cuenta de anclaje del ensayo', en: 'rehearsal anchoring account' },
    rProposer: { es: 'proponente', en: 'proposer' },
    rVerifier: { es: 'verificador', en: 'verifier' },
    rThird: { es: 'tercer firmante', en: 'third signer' },
    rDest: { es: 'destino del pago marcador', en: 'marker-payment destination' },
    rOther: { es: 'cuenta del activo del ensayo', en: 'rehearsal asset account' },
    rAug1: { es: 'cuenta que creó el activo', en: 'account that created the asset' },
    rAug2: { es: 'destino fijo del pago marcador', en: 'fixed marker-payment destination' },
    allOk: { es: '✓ TODO COINCIDE', en: '✓ ALL MATCH' },
    someBad: { es: '✗ HAY DIFERENCIAS', en: '✗ DIFFERENCES FOUND' },
    sweepErr: { es: 'No pudimos leer todas las cuentas; vuelve a intentarlo en un minuto.', en: 'Could not read every account; try again in a minute.' }
  };

  var ACCTS = {
    dress: { g: R.dress.account, ev: R.dress.evidence, link: true },
    abcd: { g: R.abcd.account, ev: R.abcd.evidence, link: true },
    e2e: { g: R.e2e.account, ev: R.e2e.evidence, link: true },
    asset: { g: R.asset.account, ev: R.asset.evidence, link: true },
    aug1: { g: A.assetAccount, link: false },
    aug2: { g: A.markerDestination, link: false }
  };
  var IDS = ['dress', 'abcd', 'e2e', 'asset', 'aug1', 'aug2'];
  var REH = ['dress', 'abcd', 'e2e', 'asset'];
  var SINCE_TO = function () { return new Date(Date.now() + 86400000).toISOString(); };

  var st = { net: null, readAt: null, acct: {}, an: {}, ev: {}, err: null }, timer = null, sweep = null, netOk = null;

  /* ───────────── helpers ───────────── */
  function hhmm() { return S.fmtTime().slice(0, 5); }
  function errHTML(e) {
    var code = (e && e.code) || 'offline';
    var key = code === 'rate-limited' ? 'limited' : code === 'not-found' ? 'notFound' : code === 'wrong-network' ? 'wrongNet' : 'offline';
    return '<p class="q-err" role="status" data-kind="' + esc(code) + '">' + pair(key, { t: hhmm() }) + '</p>';
  }
  function loading() { return '<p class="q-loading"><span class="q-skel" aria-hidden="true"></span> ' + pair('reading') + '</p>'; }
  function vivo() { return badge('vivo', { t: S.fmtTime(st.readAt || undefined) }); }
  function ensayo() { return badge('ensayo', null, { es: S.SRC.ensayo.es + ' · leído ' + S.fmtTime(st.readAt || undefined), en: S.SRC.ensayo.en + ' · read ' + S.fmtTime(st.readAt || undefined) }); }
  function state(kind, words) { return '<span class="q-state" data-state="' + kind + '">' + pair(words) + '</span>'; }
  function thr(a) { return a.thresholds.low + '/' + a.thresholds.med + '/' + a.thresholds.high; }
  function weighted(a) { return a.signers.filter(function (s) { return s.weight > 0; }).length; }
  function newTab() { return '<span class="q-ext" aria-hidden="true">↗</span><span class="q-vh">' + pair('newTab') + '</span>'; }
  function guard() { if (!netOk) netOk = L.network().catch(function (e) { netOk = null; throw e; }); return netOk; }
  function soft(p) { return p.then(function (v) { return { v: v }; }, function (e) { return { e: e }; }); }

  /* ───────────── reading ───────────── */
  function read(fresh) {
    clearTimeout(timer);
    if (fresh) netOk = null;
    return guard().then(function (n) {
      st.net = n;
      var jobs = [];
      IDS.forEach(function (id) {
        var g = ACCTS[id].g;
        jobs.push(Promise.all([soft(L.account(g)), soft(L.txCount(g, C.SPRINT_START, SINCE_TO()))]).then(function (r) { st.acct[id] = { a: r[0].v || null, since: r[1].v || null, e: r[0].e || r[1].e || null }; }));
      });
      REH.forEach(function (id) {
        jobs.push(soft(L.anchors(ACCTS[id].g)).then(function (r) { st.an[id] = r.v || null; }));
        jobs.push(soft(L.evidence(ACCTS[id].ev)).then(function (r) { st.ev[id] = r.v || null; }));
      });
      return Promise.all(jobs);
    }).then(function () {
      st.err = null; st.readAt = new Date(); render();
      timer = setTimeout(function again() { if (d.hidden) { timer = setTimeout(again, 5000); return; } read(true); }, 60000);
    }, function (e) {
      st.err = e; render();
      if (e && e.code !== 'wrong-network') timer = setTimeout(function () { read(true); }, e && e.code === 'rate-limited' ? 60000 : 30000);
    });
  }

  /* ───────────── rendering: tiles ───────────── */
  function renderTiles() {
    var box = { a: $('tAccts'), s: $('tSigners'), x: $('tSince'), r: $('tRead') };
    if (!box.a) return;
    if (st.err && !st.readAt) { [box.a, box.s, box.x, box.r].forEach(function (b) { b.innerHTML = '<p class="q-tile-v q-dim">—</p>'; }); return; }
    if (!st.readAt) { [box.a, box.s, box.x, box.r].forEach(function (b) { b.innerHTML = loading(); }); return; }
    var have = IDS.filter(function (id) { return st.acct[id] && st.acct[id].a; });
    var exist = have.filter(function (id) { return st.acct[id].a.exists; }).length;
    box.a.innerHTML = '<p class="q-tile-v">' + num(exist + ' / ' + IDS.length, 'vivo') + '</p><p class="q-tile-s">' + pair(T.exist) + ' · ' + pair(T.acctsSub) + '</p>' + vivo();
    var aug = ['aug1', 'aug2'].map(function (id) { var x = st.acct[id]; return x && x.a && x.a.exists ? weighted(x.a) : null; }).filter(function (v) { return v != null; });
    var reh = REH.map(function (id) { var x = st.acct[id]; return x && x.a && x.a.exists ? x.a : null; }).filter(Boolean);
    var rehW1 = reh.map(function (a) { return a.signers.filter(function (s) { return s.key !== a.id && s.weight === 1; }).length; });
    var span = function (xs) { if (!xs.length) return '—'; var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs); return lo === hi ? String(lo) : lo + '–' + hi; };
    var mw = reh.length ? span(reh.map(function (a) { return a.masterWeight; })) : '—';
    box.s.innerHTML = '<p class="q-tile-v">' + num(span(aug), 'vivo') + ' <small>·</small> ' + num(span(rehW1), 'vivo') + '</p><p class="q-tile-s">' + pair(T.signersSub, { w: mw }) + '</p>' + vivo();
    var counts = IDS.map(function (id) { var x = st.acct[id]; return x && x.since ? x.since.count : null; });
    var known = counts.filter(function (c) { return c != null; });
    var total = known.reduce(function (a, b) { return a + b; }, 0);
    box.x.innerHTML = '<p class="q-tile-v">' + (known.length ? num(String(total), 'vivo') : '—') + '</p><p class="q-tile-s">' +
      (known.length === IDS.length ? (total === 0 ? state('ok', T.zeroExp) : state('fail', T.zeroNo)) + ' · ' : '') + pair(T.sinceSub) + '</p>' + vivo();
    box.r.innerHTML = '<p class="q-tile-v">' + num(S.fmtNum(st.net.latestLedger), 'vivo') + '</p><p class="q-tile-s">' + pair(T.ledgerSub) + '</p>' + vivo();
  }

  /* ───────────── rendering: one account card ───────────── */
  function kv(k, v) { return '<dt>' + pair(k) + '</dt><dd>' + v + '</dd>'; }
  function cardHTML(id) {
    var x = st.acct[id], conf = ACCTS[id];
    if (!x) return st.err ? errHTML(st.err) : loading();
    if (!x.a) return errHTML(x.e);
    var a = x.a;
    if (!a.exists) return '<dl class="q-dl">' + kv(T.kAddr, '<code translate="no">' + esc(S.shortKey(conf.g)) + '</code>') + '</dl>' + errHTML({ code: 'not-found' });
    var one = L.canOneKeySend(a);
    var last = x.since && x.since.last ? x.since.last : a.lastModified;
    var since = x.since ? x.since.count : null;
    var isReh = REH.indexOf(id) >= 0;
    var rows = kv(T.kAddr, '<code translate="no">' + esc(S.shortKey(conf.g)) + '</code>') +
      kv(T.kThr, num(thr(a), 'vivo')) +
      kv(T.kSigners, num(String(weighted(a)), 'vivo')) +
      kv(T.kMaster, num(String(a.masterWeight), 'vivo')) +
      kv({ es: 'home_domain', en: 'home_domain' }, a.homeDomain ? '<code translate="no">' + esc(a.homeDomain) + '</code>' : pair(T.notSet)) +
      kv(T.kLast, last ? esc(S.fmtDate(last)) : '—') +
      kv(T.kSince, since == null ? '—' : num(String(since), 'vivo') + ' ' + (since === 0 ? state('ok', T.expOk) : state('fail', T.zeroNo)));
    if (isReh) {
      var h = a.data['qwatt.anchor.sha256'], m = a.data['qwatt.cumulative_mwh'];
      if (h) rows += kv({ es: 'qwatt.anchor.sha256', en: 'qwatt.anchor.sha256' }, '<code translate="no">' + esc(S.shortHash(h)) + '</code>');
      if (m != null) rows += kv({ es: 'qwatt.cumulative_mwh', en: 'qwatt.cumulative_mwh' }, num(S.fmtNum(+m), 'ensayo') + ' mWh');
    }
    rows += kv(T.kOne, (one ? state('fail', T.yes) : state('ok', T.no)) + '<small class="q-dim">' + (isReh ? pair(T.earlier, { l: a.thresholds.low }) : pair(T.augWhy)) + '</small>');
    var link = conf.link ? '<p class="q-acard-link"><a class="q-link" href="' + esc(C.EXPLORER + '/account/' + conf.g) + '" target="_blank" rel="noopener">' + pair(T.explorer) + newTab() + '</a></p>'
      : '<p class="q-acard-link q-dim">' + pair(T.noLink) + '</p>';
    return '<dl class="q-dl">' + rows + '</dl>' + vivo() + (isReh ? ensayo() : '') + link + (x.e ? errHTML(x.e) : '');
  }
  function renderCards() {
    var cards = d.querySelectorAll('[data-acct]');
    for (var i = 0; i < cards.length; i++) {
      var slot = cards[i].querySelector('[data-acct-slot]');
      if (slot) slot.innerHTML = cardHTML(cards[i].getAttribute('data-acct'));
    }
  }

  /* ───────────── rendering: evidence vs Horizon ───────────── */
  function checksFor(id) {
    var x = st.acct[id], ev = st.ev[id], an = st.an[id];
    if (!x || !x.a || !x.a.exists || !ev || !an || !an.length) return null;
    var data = x.a.data, head = data['qwatt.anchor.sha256'], tot = data['qwatt.cumulative_mwh'];
    var last = an[an.length - 1], out = [];
    var eq = function (p, q) { return p != null && q != null && String(p) === String(q); };
    if (id === 'abcd') {
      var bs = ev.batches || [], steps = ev.steps || {};
      out.push({ ok: eq(head, ev.onchain_anchor_after), w: T.cHead });
      out.push({ ok: bs.length > 0 && eq(tot, bs[bs.length - 1].cumulative_mwh), w: T.cTotal });
      out.push({ ok: bs.length === an.length, w: T.cCount, v: { a: bs.length, b: an.length } });
      var sc = steps.C_proposer_plus_verifier, sl = steps.L_third_plus_verifier;
      out.push({ ok: !!(sc && sl && an[0] && an[1] && an[0].txHash === sc.hash && an[1].txHash === sl.hash), w: T.cCL });
    } else if (id === 'dress') {
      var sm = (ev.reconciliation || {}).summary || {};
      out.push({ ok: eq(tot, sm.anchored_cumulative_mwh), w: T.cTotal });
      out.push({ ok: +sm.anchor_transactions === an.length, w: T.cCount, v: { a: S.fmtNum(+sm.anchor_transactions), b: S.fmtNum(an.length) } });
      out.push({ ok: an[0].txHash === ev.first_tx && last.txHash === ev.last_tx, w: T.cEnds });
      out.push({ ok: eq(head, last.sha256), w: T.cHeadAn });
    } else if (id === 'e2e') {
      var f = ev.final || {}, recs = f.anchored_records || [];
      out.push({ ok: eq(head, f.onchain_anchor), w: T.cHead });
      out.push({ ok: eq(tot, f.onchain_cumulative_mwh), w: T.cTotal });
      out.push({ ok: recs.length === an.length, w: T.cCount, v: { a: recs.length, b: an.length } });
      var byTx = {}; an.forEach(function (q) { byTx[q.txHash] = q; });
      out.push({ ok: recs.length > 0 && recs.every(function (r) { return byTx[r.tx_hash] && byTx[r.tx_hash].sha256 === r.sha256; }), w: T.cRecs });
    } else if (id === 'asset') {
      var g = ev.anchoring || {}, txs = g.txs || [];
      out.push({ ok: +g.anchored === an.length, w: T.cCount, v: { a: g.anchored, b: an.length } });
      out.push({ ok: txs.length === an.length && txs.every(function (h, i) { return an[i].txHash === h; }), w: T.cTxs });
      out.push({ ok: eq(head, last.sha256), w: T.cHeadAn });
    }
    return out;
  }
  function evHTML(id) {
    var x = st.acct[id], an = st.an[id];
    if (!st.readAt) return st.err ? errHTML(st.err) : loading();
    if (!st.ev[id]) return '<p class="q-err" role="status">' + pair(T.evNone) + '</p>';
    if (!x || !x.a) return errHTML(x && x.e);
    if (!x.a.exists) return errHTML({ code: 'not-found' });
    var cks = checksFor(id);
    var data = x.a.data, last = an && an.length ? an[an.length - 1] : null;
    var facts = '<dl class="q-dl">' +
      kv(T.kAnchors, an ? num(S.fmtNum(an.length), 'ensayo') + (last && last.memoShown ? ' <small class="q-dim">' + pair(T.lastQW, { m: last.memoShown, d: S.fmtDate(last.createdAt) }) + '</small>' : '') : '—') +
      kv(T.kTotal, data['qwatt.cumulative_mwh'] != null ? num(S.fmtNum(+data['qwatt.cumulative_mwh']), 'ensayo') + ' mWh' : '—') +
      kv(T.kHash, data['qwatt.anchor.sha256'] ? '<code translate="no">' + esc(S.shortHash(data['qwatt.anchor.sha256'])) + '</code>' : '—') + '</dl>';
    var list = '';
    if (cks) {
      var okN = cks.filter(function (c) { return c.ok; }).length;
      list = '<p class="q-evsum">' + state(okN === cks.length ? 'ok' : 'fail', okN === cks.length ? T.allOk : T.someBad) + ' ' + pair(T.sum, { n: okN, m: cks.length }) + '</p><ul class="q-checks">' +
        cks.map(function (c) { return '<li>' + state(c.ok ? 'ok' : 'fail', c.ok ? T.match : T.nomatch) + pair(c.w, c.v) + '</li>'; }).join('') + '</ul>';
    } else if (!an) list = errHTML({ code: 'offline' });
    return list + facts + (id === 'asset' ? '<p class="q-note">' + pair(T.assetNote) + ' <a class="q-link" href="https://github.com/academiaseul/QWATT/blob/main/evidence/asset-rehearsal/asset-2026-10-08T22-03-53-216Z.json" target="_blank" rel="noopener">' + pair(T.assetFull) + newTab() + '</a></p>' : '') +
      badge('archivo', { p: ACCTS[id].ev }) + vivo() + ensayo();
  }
  function renderEvidence() {
    var cards = d.querySelectorAll('[data-ev]');
    for (var i = 0; i < cards.length; i++) {
      var slot = cards[i].querySelector('[data-ev-slot]');
      if (slot) slot.innerHTML = evHTML(cards[i].getAttribute('data-ev'));
    }
  }

  function render() {
    var line = $('rsRead');
    if (line) line.innerHTML = st.readAt ? pair(T.readAt, { t: S.fmtTime(st.readAt) }) : st.err ? errHTML(st.err) : pair('reading');
    renderTiles(); renderCards(); renderEvidence(); renderSweep();
  }

  /* ───────────── the sweep: every key in the evidence files (on click only) ───────────── */
  var ROLE = { account: T.rAccount, proposer: T.rProposer, verifier: T.rVerifier, third: T.rThird, destination: T.rDest };
  var FROM = { dress: T.fDress, abcd: T.fAbcd, e2e: T.fE2e, asset: T.fAsset };
  function sweepList() {
    var seen = {}, list = [];
    function add(g, from, role) { if (!L.isPublicKey(g) || seen[g]) return; seen[g] = 1; list.push({ g: g, from: from, role: role }); }
    add(A.assetAccount, T.fAug, T.rAug1); add(A.markerDestination, T.fAug, T.rAug2);
    REH.forEach(function (id) {
      var ev = st.ev[id]; if (!ev) return;
      if (id === 'asset') add(ACCTS.asset.g, FROM[id], T.rAccount);
      var pk = ev.public_keys || {};
      Object.keys(pk).forEach(function (k) { add(pk[k], FROM[id], ROLE[k] || T.rOther); });
    });
    return list;
  }
  function runSweep() {
    var btn = $('rsSweep');
    var go = function () {
      var list = sweepList();
      sweep = { list: list, rows: null, err: null };
      renderSweep();
      return Promise.all(list.map(function (x) { return soft(L.account(x.g)); })).then(function (r) {
        sweep.rows = r; sweep.at = new Date(); renderSweep();
      });
    };
    if (btn) btn.disabled = true;
    var need = REH.filter(function (id) { return !st.ev[id]; });
    Promise.all(need.map(function (id) { return soft(L.evidence(ACCTS[id].ev)).then(function (r) { st.ev[id] = r.v || null; }); }))
      .then(go).then(function () { if (btn) btn.disabled = false; }, function () { sweep = { err: true }; renderSweep(); if (btn) btn.disabled = false; });
  }
  function renderSweep() {
    var box = $('rsSweepOut');
    if (!box || !sweep) return;
    if (sweep.err) { box.innerHTML = '<p class="q-err" role="status">' + pair(T.sweepErr) + '</p>'; return; }
    if (!sweep.rows) { box.innerHTML = '<p class="q-loading"><span class="q-skel" aria-hidden="true"></span> ' + pair(T.sweepRun, { n: sweep.list.length }) + '</p>'; return; }
    var start = Date.parse(C.SPRINT_START), good = 0, signOnly = 0, bad = 0;
    var body = sweep.list.map(function (x, i) {
      var r = sweep.rows[i], a = r.v, cells;
      var signer = x.role === T.rProposer || x.role === T.rVerifier || x.role === T.rThird;
      if (!a) { bad++; cells = '<td colspan="4">' + errHTML(r.e) + '</td>'; }
      else if (!a.exists && signer) { signOnly++; cells = '<td colspan="3" class="q-dim">' + pair(T.signOnlyWhy) + '</td><td>' + state('na', T.signOnly) + '</td>'; }
      else if (!a.exists) { bad++; cells = '<td colspan="4">' + state('fail', T.missing) + '</td>'; }
      else {
        var mod = a.lastModified ? Date.parse(a.lastModified) : null;
        var same = mod != null && mod < start;
        if (same) good++; else bad++;
        cells = '<td>' + num(thr(a), 'vivo') + '</td><td class="q-c-sig">' + num(String(weighted(a)), 'vivo') + '</td><td class="q-c-mod">' + (a.lastModified ? esc(S.fmtDate(a.lastModified)) : '—') + '</td>' +
          '<td>' + (same ? state('ok', T.unchanged) : state('fail', T.changed)) + '</td>';
      }
      return '<tr><td>' + pair(x.role) + '<small class="q-dim q-sw-from">' + pair(x.from) + '</small></td><td><code translate="no">' + esc(S.shortKey(x.g)) + '</code></td>' + cells + '</tr>';
    }).join('');
    box.innerHTML = '<p class="q-evsum">' + (bad ? state('fail', T.someBad) : state('ok', T.unchanged)) + ' ' + pair(T.sweepSum, { n: good, m: good + bad }) +
      (signOnly ? ' · ' + pair(T.sweepSign, { k: signOnly }) : '') + '</p>' +
      '<div class="q-table-wrap"><table class="q-table q-sweep-t"><caption>' + pair(T.sweepCap) + '</caption><thead><tr>' +
      '<th scope="col">' + pair(T.thRole) + '</th><th scope="col">' + pair(T.thKey) + '</th><th scope="col">' + pair(T.thThr) + '</th>' +
      '<th scope="col" class="q-c-sig">' + pair(T.thSig) + '</th><th scope="col" class="q-c-mod">' + pair(T.thMod) + '</th><th scope="col">' + pair(T.thSince) + '</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      badge('vivo', { t: S.fmtTime(sweep.at) });
  }

  function start() {
    if (!$('tAccts')) return;
    var b = $('rsRefresh'); if (b) b.addEventListener('click', function () { read(true); });
    var s = $('rsSweep'); if (s) s.addEventListener('click', runSweep);
    S.onLang(render);
    L.ready().then(function () { render(); read(false); });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
