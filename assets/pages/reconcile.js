/**
 * QWATT · reconcile.html — every anchor against its batch (V3-9.3)
 * ---------------------------------------------------------------------------
 * Reads Horizon first (the anchoring account, its signers and thresholds, then
 * every anchoring transaction with its signatures), then the evidence feed at one
 * commit (assets/qwatt-pin.js), through check() of assets/qwatt-reconcile.js: the
 * same code anchor/reconcile-cli.js and the write-up run. Every value that comes
 * from the feed or from Horizon is written with textContent, never as markup.
 * Spanish and English are both in the page (data-l pairs); the toggle shows one.
 *
 * Which feed: ?feed= and ?account= from the address (a shared link); without
 * them, the public run feed and the anchoring account that assets/status.json
 * names (feeds "corrida", anchor.account). Until both exist the page says so
 * plainly, reads nothing else and shows no result: there is no run data yet.
 * A link whose ?horizon= is not the public testnet Horizon never runs by itself.
 * Batch ids are shown (FD-14: the live run's site_id is the neutral qwatt-chispa-01).
 *
 * The script sends nothing to QWATT and keeps nothing in browser storage. A check
 * it runs is written into the page's address (history.replaceState), so a link
 * carries it; that address stays in the browser history and, like any address,
 * reaches the site when the page is loaded with it (reconcile.html and
 * terminos.html say so). QWATT_RECONCILE_PAGE.ready resolves to 'ran', 'waiting'
 * or 'idle' once the page has decided whether to run (and, when it ran by
 * itself, once that check is over).
 */
(function (root) {
  'use strict';
  var d = root.document;
  if (!d) return;
  var R = root.QWATT_RECONCILE, PIN = root.QWATT_PIN;
  var $ = function (id) { return d.getElementById(id); };

  var DEFAULT_HORIZON = 'https://horizon-testnet.stellar.org';
  var EXPLORER = 'https://stellar.expert/explorer/testnet';
  var ROLE_INPUTS = { proposer: 'proposerIn', verifier: 'verifierIn', third: 'thirdIn' };
  var G_KEY = /^G[A-Z2-7]{55}$/;

  /* ───────────────────────────── words ───────────────────────────── */

  var W = {
    RECONCILED: { es: 'CONCILIADO', en: 'RECONCILED' },
    PENDING: { es: 'PENDIENTE', en: 'PENDING' },
    BROKEN: { es: 'ROTO', en: 'BROKEN' }
  };
  var V = {
    RECONCILED: { es: 'Todo lo publicado y aceptado está anclado, y cada anclaje calza con el lote que nombra.', en: 'Everything published and accepted is anchored, and every anchor matches the batch it names.' },
    PENDING: { es: 'Todo cuadra hasta ahora; los lotes aceptados más nuevos todavía esperan su segunda firma. Es normal mientras la corrida avanza.', en: 'Everything checks out so far; the newest accepted batches are still waiting for their second signature. This is normal while the pipeline runs.' },
    BROKEN: { es: 'La cadena y el feed no coinciden. Cada problema encontrado está abajo.', en: 'The chain and the feed disagree. Each problem found is listed below.' }
  };
  var ROLE = {
    proposer: { es: 'proponente', en: 'proposer' }, verifier: { es: 'verificador', en: 'verifier' },
    third: { es: 'tercer firmante', en: 'third signer' }, 'unknown key': { es: 'clave desconocida', en: 'unknown key' }, 'no key': { es: 'ninguna clave', en: 'no key' }
  };
  var T = {
    problems: { es: 'Cada problema, tal como lo informa el código de conciliación (en inglés):', en: 'Each problem, as the reconciliation code reports it:' },
    pubS: { es: '{a} aceptados · {r} rechazados', en: '{a} accepted · {r} rejected' },
    unchecked: { es: 'firmas sin comprobar (sin roles de firmante)', en: 'signatures unchecked (no signer roles)' },
    sigs: { es: '{n} proponente + verificador · {s} suplente', en: '{n} proposer + verifier · {s} stand-in' },
    other: { es: '{n} otra pareja', en: '{n} other' },
    awaiting: { es: '{n} esperando', en: '{n} awaiting' },
    noneYet: { es: 'ninguno todavía', en: 'none yet' },
    onchain: { es: 'en la cadena: {k}', en: 'on-chain {k}' },
    reasonsN: { es: '{n} motivos distintos', en: '{n} distinct reasons' },
    fileMissing: { es: 'falta el archivo', en: 'file missing' },
    rejected: { es: 'rechazado', en: 'rejected' }, anchored: { es: 'anclado', en: 'anchored' },
    waiting: { es: 'esperando', en: 'awaiting' }, mismatch: { es: 'no calza', en: 'mismatch' },
    notYet: { es: 'todavía no', en: 'not yet' }, never: { es: 'nunca (rechazado)', en: 'never (rejected)' },
    ledger: { es: ' · ledger {l}', en: ' · ledger {l}' },
    normal: { es: 'proponente + verificador', en: 'proposer + verifier' },
    standIn: { es: 'suplente', en: 'stand-in' },
    standPair: { es: 'proponente + tercer firmante', en: 'proposer + third signer' },
    noSigs: { es: 'sin firmas', en: 'no signatures' },
    acctId: { es: 'Cuenta {id}, tal como {h} la devolvió al momento de esta comprobación.', en: 'Account {id}, as {h} returned it at the time of this check.' },
    thresholds: { es: 'Umbrales (bajo/medio/alto)', en: 'Thresholds (low/medium/high)' },
    master: { es: 'Peso de la clave maestra', en: 'Master weight' },
    notDeclared: { es: 'sin declarar', en: 'not declared' },
    acctOk: { es: 'Ninguna clave sola puede enviar una transacción de esta cuenta; anclar exige {m} de las {n} claves; cambiar firmantes o umbrales exige las {h}.', en: 'No single key can send any transaction for this account; anchoring needs {m} of the {n} keys; changing signers or thresholds needs all {h}.' },
    acctBad: { es: 'Esta cuenta no coincide con la configuración acordada; mira los problemas de arriba.', en: 'This account does not match the frozen setup; see the problems above.' },
    rolesFaults: { es: 'Roles según: el faults.json de la corrida', en: "Roles from: the run's faults.json" },
    rolesGiven: { es: 'Roles según: la dirección de esta página', en: "Roles from: this page's address" },
    rolesNone: { es: 'Roles según: ninguna fuente (el feed no declara roles y no se dieron), así que no se pudo comprobar ninguna firma', en: 'Roles from: nowhere (the feed declares none and none were given), so no signature could be checked' },
    noRefused: { es: 'Todavía no se ha rechazado ningún intervalo.', en: 'No interval has been refused yet.' },
    reasonsCap: { es: 'Intervalos rechazados, por motivo', en: 'Refused intervals, by reason' },
    reasonCode: { es: 'Código de motivo', en: 'Reason code' }, intervals: { es: 'Intervalos', en: 'Intervals' },
    reading: { es: 'Leyendo desde Horizon la cuenta de anclaje, sus firmantes y cada transacción de anclaje; después, descargando el feed de evidencia en su último commit…', en: 'Reading the anchoring account, its signers and every anchoring transaction from Horizon, then downloading the evidence feed at its latest commit…' },
    checked: { es: 'Se comprobaron {n} lotes, los firmantes y umbrales de la cuenta, y las firmas de {t} transacciones de anclaje a las {at} UTC · Horizon {h} · evidencia leída en {ev}.', en: "Checked {n} batches, the account's signers and thresholds, and the signatures on {t} anchoring transactions at {at} UTC · Horizon {h} · evidence read at {ev}." },
    noInput: { es: 'Escribe la URL de un feed de evidencia y una cuenta de anclaje (G…), y pulsa Conciliar.', en: 'Enter an evidence feed URL and an anchoring account (G…), then press Reconcile.' },
    waitHorizon: { es: 'Este enlace nombra un servidor Horizon que no es el Horizon público de Stellar testnet: {h}. La comprobación no parte sola: revisa el servidor en «Servidor Horizon y roles de firmante» y pulsa Conciliar.', en: 'This link names a Horizon server that is not the public Stellar testnet Horizon: {h}. The check does not start by itself: review the server under "Horizon server and signer roles", then press Reconcile.' },
    rateLimit: { es: 'No se pudo completar la comprobación: se alcanzó el límite anónimo de la API de GitHub (60 consultas por hora por dirección IP) al buscar el último commit de la evidencia. Se reinicia dentro de la hora: vuelve a intentarlo entonces, o usa node anchor/reconcile-cli.js, que no usa esa API.', en: "Could not complete the check: GitHub's anonymous API limit (60 requests an hour per address) was reached while finding the evidence's latest commit. It resets within the hour: try again then, or run node anchor/reconcile-cli.js, which does not use that API." },
    noEd: { es: 'Tu navegador no puede verificar firmas Ed25519 (WebCrypto), así que esta página no da veredicto. Usa un navegador actual, o node anchor/reconcile-cli.js.', en: 'This browser cannot verify Ed25519 signatures (WebCrypto), so this page gives no verdict. Use a current browser, or node anchor/reconcile-cli.js.' },
    failed: { es: 'No se pudo completar la comprobación: {m}. Revisa que la URL del feed sirva index.json y ledger/batches.jsonl, y que la cuenta sea una dirección G…. Este sitio solo lee de los servidores que nombran sus términos; para otro, usa node anchor/reconcile-cli.js.', en: 'Could not complete the check: {m}. Confirm the feed URL serves index.json and ledger/batches.jsonl, and the account is a G… address. This site only reads from the servers its terms name; for any other, use node anchor/reconcile-cli.js.' },
    noEngine: { es: 'Este navegador no cargó el código de conciliación. Usa un navegador actual, o node anchor/reconcile-cli.js.', en: 'This browser did not load the reconciliation code. Use a current browser, or node anchor/reconcile-cli.js.' },
    hzNote: { es: 'Leyendo un Horizon distinto del predeterminado: {h}. La cuenta, sus firmantes y cada firma de abajo son tan confiables como ese servidor; el Horizon público de Stellar testnet es horizon-testnet.stellar.org.', en: 'Reading a non-default Horizon: {h}. The account, its signers and every signature below are only as trustworthy as that server; the public Stellar testnet Horizon is horizon-testnet.stellar.org.' },
    runNone: { es: 'Todavía no hay un feed público de la corrida: el repositorio de evidencia y la cuenta de anclaje definitiva están en preparación (semana 2). Hasta entonces esta página no muestra datos de la corrida, ni inventa ninguno. Aquí puedes conciliar, con su cuenta, un feed publicado en este sitio o en un repositorio público de GitHub; para cualquier otro servidor, usa node anchor/reconcile-cli.js.', en: 'There is no public run feed yet: the evidence repository and the real anchoring account are in preparation (week 2). Until then this page shows no run data, and makes none up. Here you can reconcile a feed published on this site or in a public GitHub repository, with its account; for any other host, use node anchor/reconcile-cli.js.' },
    runSet: { es: 'El feed público de la corrida, según la configuración de este sitio: {f} · cuenta {a}.', en: 'The public run feed, as this site is configured: {f} · account {a}.' },
    fromLink: { es: 'El feed y la cuenta vienen de la dirección de esta página.', en: "The feed and the account come from this page's address." }
  };

  /* ───────────────────────────── helpers ───────────────────────────── */

  function fill(s, vars) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; }); }
  /** The value of a {name} for one language: a {es, en} pair or a plain string. */
  function pick(vars, lg) {
    var out = {};
    Object.keys(vars || {}).forEach(function (k) { var v = vars[k]; out[k] = v && typeof v === 'object' ? v[lg] : v; });
    return out;
  }
  /** Both languages into `node`, as a data-l pair (the toggle shows one); the same text twice is written once. */
  function put(node, o, vars) {
    node.textContent = '';
    var es = fill(o.es, pick(vars, 'es')), en = fill(o.en, pick(vars, 'en'));
    if (es === en) { node.textContent = es; return node; }
    var a = d.createElement('span'); a.setAttribute('data-l', 'es'); a.textContent = es;
    var b = d.createElement('span'); b.setAttribute('data-l', 'en'); b.textContent = en;
    node.appendChild(a); node.appendChild(b);
    return node;
  }
  function el(tag, cls, o, vars) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (o != null) { if (typeof o === 'string') n.textContent = o; else put(n, o, vars); }
    return n;
  }
  function num(n) { return { es: fmt(n, 'es-CL'), en: fmt(n, 'en-US') }; }
  function fmt(n, loc, opt) { try { return Number(n).toLocaleString(loc, opt); } catch (e) { return String(n); } }
  function wh(mwh) { var o = { minimumFractionDigits: 3, maximumFractionDigits: 3 }; return { es: fmt(mwh / 1000, 'es-CL', o), en: fmt(mwh / 1000, 'en-US', o) }; }
  function kwh(mwh) { var o = { maximumFractionDigits: 3 }; return { es: fmt(mwh / 1e6, 'es-CL', o) + ' kWh', en: fmt(mwh / 1e6, 'en-US', o) + ' kWh' }; }
  function short(h) { return h ? h.slice(0, 10) + '…' + h.slice(-6) : '—'; }
  function shortKey(g) { return g ? g.slice(0, 6) + '…' + g.slice(-4) : '—'; }
  function when(iso) { return iso ? String(iso).replace('T', ' ').replace(/:00\.000Z$|\.000Z$|Z$/, '') : '—'; }
  function isDefaultHorizon(h) { return String(h).trim().replace(/\/+$/, '') === DEFAULT_HORIZON; }
  /** The host a URL really names (user info and look-alike suffixes included), never a guess from its start. */
  function hostOf(u) { try { return new URL(u).host || String(u); } catch (e) { return String(u); } }
  function pairOf(signedBy) {
    var parts = String(signedBy || '').split('+').filter(Boolean);
    return { es: parts.map(function (p) { return (ROLE[p] || { es: p }).es; }).join('+'), en: parts.join('+') };
  }

  /* ───────────────────────────── rendering ───────────────────────────── */

  function verdictBox(rep) {
    var box = $('verdict');
    box.textContent = '';
    box.className = 'q-verdict ' + (rep.verdict === 'RECONCILED' ? 'v-ok' : rep.verdict === 'PENDING' ? 'v-pending' : 'v-broken');
    box.appendChild(el('p', 'v-word', W[rep.verdict]));
    var body = el('div', 'v-body');
    body.appendChild(el('p', null, V[rep.verdict]));
    if (rep.problems.length) {
      body.appendChild(el('p', 'v-intro', T.problems));
      var ul = el('ul');
      ul.setAttribute('lang', 'en');
      rep.problems.slice(0, 50).forEach(function (p) { ul.appendChild(el('li', null, p)); });
      body.appendChild(ul);
    }
    box.appendChild(body);
  }

  function render(rep, horizon) {
    var s = rep.summary;
    verdictBox(rep);
    put($('tPub'), num(s.published_batches));
    put($('tPubS'), T.pubS, { a: num(s.accepted_batches), r: num(s.rejected_batches) });
    put($('tAnc'), { es: fmt(s.anchored_batches, 'es-CL') + ' / ' + fmt(s.accepted_batches, 'es-CL'), en: fmt(s.anchored_batches, 'en-US') + ' / ' + fmt(s.accepted_batches, 'en-US') });
    var sig = s.signatures, sub = [];
    if (s.anchor_transactions && sig.unchecked === s.anchor_transactions) sub.push(T.unchecked);
    else if (s.anchor_transactions) {
      sub.push({ es: fill(T.sigs.es, { n: sig.normal, s: sig.stand_in }), en: fill(T.sigs.en, { n: sig.normal, s: sig.stand_in }) });
      if (sig.broken) sub.push({ es: fill(T.other.es, { n: sig.broken }), en: fill(T.other.en, { n: sig.broken }) });
    }
    if (s.awaiting_anchor.length) sub.push({ es: fill(T.awaiting.es, { n: s.awaiting_anchor.length }), en: fill(T.awaiting.en, { n: s.awaiting_anchor.length }) });
    put($('tAncS'), sub.length ? { es: sub.map(function (x) { return x.es; }).join(' · '), en: sub.map(function (x) { return x.en; }).join(' · ') } : T.noneYet);
    put($('tEn'), kwh(s.published_cumulative_mwh));
    put($('tEnS'), T.onchain, { k: kwh(s.anchored_cumulative_mwh) });
    put($('tRej'), num(s.rejected_intervals));
    put($('tRejS'), T.reasonsN, { n: Object.keys(s.rejected_by_reason).length });

    var tb = $('rows'); tb.textContent = '';
    /* a transaction is linked on the testnet explorer only when the public testnet Horizon was read */
    var linkTx = isDefaultHorizon(horizon);
    rep.rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', 'mono', String(r.seq)));
      var bid = el('td', 'mono', r.batch_id);   /* FD-14: the live run's batch ids are qwatt-chispa-01-NNNNNN */
      bid.setAttribute('translate', 'no');
      tr.appendChild(bid);
      tr.appendChild(r.file === 'missing' ? el('td', 'mono dim', T.fileMissing) : el('td', 'mono dim', ''));
      var st = el('td'), chip;
      if (r.status !== 'accepted') chip = el('span', 'chip c-rej', T.rejected);
      else if (r.anchor) chip = el('span', 'chip c-anch', T.anchored);
      else chip = el('span', 'chip c-wait', T.waiting);
      if (r.file_ok === false || r.chain_ok === false) chip = el('span', 'chip c-bad', T.mismatch);
      st.appendChild(chip); tr.appendChild(st);
      tr.appendChild(r.energy_mwh == null ? el('td', 'num mono', '—') : el('td', 'num mono', wh(r.energy_mwh)));
      tr.appendChild(el('td', r.file_ok ? 'ok' : 'no', r.file_ok ? '✓' : '✗'));
      tr.appendChild(el('td', r.chain_ok ? 'ok' : 'no', r.chain_ok ? '✓' : '✗'));
      var txc = el('td', 'mono');
      if (r.anchor) {
        if (linkTx && /^[0-9a-f]{64}$/.test(r.anchor.tx_hash)) {
          var a = el('a', null, short(r.anchor.tx_hash));
          a.href = EXPLORER + '/tx/' + r.anchor.tx_hash; a.target = '_blank'; a.rel = 'noopener';
          a.title = r.anchor.tx_hash;
          txc.appendChild(a);
        } else {
          var h = el('span', null, short(r.anchor.tx_hash)); h.title = r.anchor.tx_hash; txc.appendChild(h);
        }
        txc.appendChild(el('span', 'dim', T.ledger, { l: String(r.anchor.ledger) }));
      } else txc.appendChild(el('span', 'dim', r.status === 'accepted' ? T.notYet : T.never));
      tr.appendChild(txc);
      tr.appendChild(signedBy(r.anchor));
      tb.appendChild(tr);
      r._tr = tr;
    });
  }

  /** Who signed an anchor, from its signatures checked against the signer keys (freeze v3 §3). */
  function signedBy(a) {
    if (!a || a.mode === 'unchecked') return el('td', 'dim', '—');
    if (a.mode === 'normal') return el('td', 'ok', T.normal);
    if (a.mode === 'stand-in') {
      var td = el('td');
      td.appendChild(el('span', 'chip c-wait', T.standIn));
      td.appendChild(el('span', 'pair', T.standPair));
      return td;
    }
    var p = a.signed_by ? pairOf(a.signed_by) : T.noSigs;
    return el('td', 'no', { es: '✗ ' + p.es, en: '✗ ' + p.en });
  }

  /** The anchoring account as Horizon returned it, each value against the frozen setup (R.ACCOUNT_RULES). */
  function renderAccount(s, horizon) {
    var a = s.account, rules = R.ACCOUNT_RULES;
    var mark = function (ok) { return el('span', ok ? 'ok' : 'no', ok ? '✓' : '✗'); };
    put($('acctId'), T.acctId, { id: a.id, h: hostOf(horizon) });
    var grid = $('acctRules'); grid.textContent = '';
    var thOk = a.thresholds === rules.low + '/' + rules.med + '/' + rules.high;
    grid.appendChild(el('p', 'k', T.thresholds)); grid.appendChild(el('p', 'mono', a.thresholds || '—')); grid.appendChild(mark(thOk));
    grid.appendChild(el('p', 'k', T.master)); grid.appendChild(el('p', 'mono', a.master_weight == null ? '—' : String(a.master_weight))); grid.appendChild(mark(a.master_weight === rules.master_weight));
    var tb = $('acctSigners'); tb.textContent = '';
    (a.signers || []).forEach(function (g) {
      var tr = el('tr');
      var k = el('td', 'mono', shortKey(g.key)); k.title = g.key; k.setAttribute('translate', 'no');
      tr.appendChild(k);
      tr.appendChild(g.role ? el('td', null, ROLE[g.role]) : el('td', 'dim', T.notDeclared));
      tr.appendChild(el('td', 'num mono', String(g.weight)));
      tr.appendChild(el('td', 'mono dim', g.type || '—'));
      var td = el('td'); td.appendChild(mark(g.weight === rules.signer_weight && g.type === 'ed25519_public_key' && !!g.role)); tr.appendChild(td);
      tb.appendChild(tr);
    });
    if (a.ok) {
      var t = a.thresholds.split('/');
      put($('acctNote'), T.acctOk, { m: t[1], n: String(a.signers.length), h: t[2] });
    } else put($('acctNote'), T.acctBad);
    put($('acctRoles'), s.roles_source === 'faults.json' ? T.rolesFaults : s.roles_source === 'given' ? T.rolesGiven : T.rolesNone);
  }

  function renderReasons(s) {
    var box = $('reasons'); box.textContent = '';
    var entries = Object.keys(s.rejected_by_reason).map(function (k) { return [k, s.rejected_by_reason[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (!entries.length) { box.appendChild(el('p', 'q-empty', T.noRefused)); return; }
    var wrap = el('div', 'q-table-wrap');
    var t = el('table', 'q-table');
    t.appendChild(el('caption', null, T.reasonsCap));
    var th = el('thead'), hr = el('tr');
    var c1 = el('th', null, T.reasonCode); c1.setAttribute('scope', 'col');
    var c2 = el('th', 'num', T.intervals); c2.setAttribute('scope', 'col');
    hr.appendChild(c1); hr.appendChild(c2); th.appendChild(hr); t.appendChild(th);
    var body = el('tbody');
    entries.forEach(function (e) {
      var tr = el('tr');
      var code = el('td', 'mono', e[0]); code.setAttribute('translate', 'no');
      tr.appendChild(code); tr.appendChild(el('td', 'num mono', num(e[1])));
      body.appendChild(tr);
    });
    t.appendChild(body); wrap.appendChild(t); box.appendChild(wrap);
  }

  /** Each row's time window, from the batch file the check read. */
  function windows(feed, rep) {
    rep.rows.forEach(function (r) {
      var b = feed.batches[r.batch_id];
      if (b && r._tr) r._tr.children[2].textContent = when(b.ts_start) + ' → ' + when(b.ts_end).slice(11);
    });
  }

  /* ───────────────────────────── the check ───────────────────────────── */

  /** Who is who, only when all three keys are given (for a feed whose faults.json declares none). */
  function givenRoles() {
    var roles = {}, n = 0;
    Object.keys(ROLE_INPUTS).forEach(function (r) { var v = $(ROLE_INPUTS[r]).value.trim(); if (v) { roles[r] = v; n++; } });
    return n === 3 ? roles : null;
  }

  function showResult(on) {
    $('result').hidden = !on;
    $('noResult').hidden = on;
  }

  async function run() {
    var prog = $('progress');
    var feedUrl = $('feedIn').value.trim(), account = $('acctIn').value.trim(), horizon = $('horizonIn').value.trim() || DEFAULT_HORIZON;
    if (!feedUrl || !G_KEY.test(account)) { put(prog, T.noInput); return; }
    if (!R || typeof R.check !== 'function') { showResult(false); put(prog, T.noEngine); return; }
    var roles = givenRoles();
    var q = new URLSearchParams({ feed: feedUrl, account: account });
    if (!isDefaultHorizon(horizon)) q.set('horizon', horizon);
    if (roles) Object.keys(ROLE_INPUTS).forEach(function (r) { q.set(r, roles[r]); });
    if (root.history && root.history.replaceState) root.history.replaceState(null, '', '?' + q.toString());
    $('runBtn').disabled = true;
    put(prog, T.reading);
    try {
      /* Horizon first, then the feed at one commit (a GitHub feed is pinned through api.github.com).
         Signer roles from the run's faults.json, or from the three inputs when the feed declares none. */
      var res = await R.check({ feed: feedUrl, horizon: horizon, account: account, roles: roles });
      var rep = res.report;
      render(rep, horizon); renderAccount(rep.summary, horizon); windows(res.feed, rep); renderReasons(rep.summary);
      var note = $('horizonNote'), other = !isDefaultHorizon(horizon);
      if (other) put(note, T.hzNote, { h: hostOf(horizon) }); else note.textContent = '';
      note.hidden = !other;
      showResult(true);
      var read = (PIN && PIN.describe(feedUrl, res.feed.commit)) || res.feed.base;
      put(prog, T.checked, { n: String(rep.rows.length), t: String(rep.summary.anchor_transactions), at: new Date().toISOString().slice(11, 19), h: hostOf(horizon), ev: read });
    } catch (e) {
      showResult(false);   // a check that did not finish shows no verdict, not even an earlier one
      $('verdict').textContent = '';
      var msg = String(e && e.message || e);
      if (/api\.github\.com: HTTP (403|429)/.test(msg)) put(prog, T.rateLimit);
      else if (/Ed25519/.test(msg)) put(prog, T.noEd);
      else put(prog, T.failed, { m: msg });
    } finally {
      $('runBtn').disabled = false;
    }
  }

  /** The public run feed and its account, as assets/status.json names them; null until both exist. */
  async function runFeed() {
    try {
      var r = await root.fetch('/assets/status.json', { cache: 'no-store' });
      if (!r.ok) return null;
      var s = await r.json();
      var fd = (s.feeds || []).filter(function (f) { return f.id === 'corrida'; })[0];
      var acct = s.anchor && s.anchor.account;
      return fd && fd.base && G_KEY.test(acct || '') ? { feed: String(fd.base).replace(/\/+$/, ''), account: acct } : null;
    } catch (e) { return null; }
  }

  async function start() {
    var params = new URLSearchParams(root.location.search || '');
    var given = { feed: params.get('feed'), account: params.get('account') };
    if (given.feed) $('feedIn').value = given.feed;
    if (given.account) $('acctIn').value = given.account;
    if (params.get('horizon')) $('horizonIn').value = params.get('horizon');
    if (params.get('proposer')) $('proposerIn').value = params.get('proposer');
    if (params.get('verifier')) $('verifierIn').value = params.get('verifier');
    if (params.get('third')) $('thirdIn').value = params.get('third');
    $('runBtn').addEventListener('click', run);
    ['feedIn', 'acctIn', 'horizonIn', 'proposerIn', 'verifierIn', 'thirdIn'].forEach(function (id) {
      $(id).addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); run(); } });
    });

    var info = $('runFeed');
    if (given.feed && given.account) put(info, T.fromLink);
    else {
      var cfg = await runFeed();
      if (!cfg) { put(info, T.runNone); return 'idle'; }
      put(info, T.runSet, { f: cfg.feed, a: cfg.account });
      if (given.feed || given.account) return 'idle';   // half a link: the reader finishes it
      $('feedIn').value = cfg.feed; $('acctIn').value = cfg.account;
    }
    if (!isDefaultHorizon($('horizonIn').value)) {
      /* a link that names another Horizon: show it and wait for the reader's click */
      $('advOpts').open = true;
      put($('progress'), T.waitHorizon, { h: hostOf($('horizonIn').value) });
      return 'waiting';
    }
    await run();
    return 'ran';
  }

  root.QWATT_RECONCILE_PAGE = { ready: start() };
}(typeof self !== 'undefined' ? self : this));
