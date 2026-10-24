/**
 * QWATT Grid (PROTOTIPO): a simulated installation in the browser.
 *
 * An accelerated solar day (1 real minute = 1 simulated day, 288 five-minute
 * intervals) produces two meter readings per interval. Each interval goes through
 * the real gate engine (assets/qwatt-gates.js with the bench profile of
 * assets/gates.browser.js, only the nameplate changed to the chosen size).
 * Accepted intervals form a local batch whose SHA-256 fingerprint is computed by
 * WebCrypto over its canonical JSON. Nothing is sent anywhere, nothing is stored,
 * no key exists on this page. The only network reads are public, read-only
 * Horizon testnet queries through assets/qwatt-live.js (the "Registro" tab).
 *
 * The sun follows the engine's own solar position for the reference profile on a
 * day of equal night and day, normalized to that day's peak and centred on solar
 * noon, so the page shows neither degrees nor clock times (they would hint at the
 * reference location).
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE, G = root.QWATT_GATES, SPEC = root.QWATT_GATES_SPEC, L = root.QWATT_LIVE;
  if (!d || !S) return;
  var pair = S.pair, esc = S.esc;
  function $(id) { return d.getElementById(id); }
  function lg() { return S.lang(); }
  function dec(v, n) { var s = v.toFixed(n); return lg() === 'en' ? s : s.replace('.', ','); }
  function whOf(mwh) { return dec(mwh / 1000, 2); }

  /* ═════════════════════════════ tabs ═════════════════════════════ */
  function tabs() {
    var list = d.querySelector('.q-tabs');
    if (!list) return;
    var bs = list.querySelectorAll('[role="tab"]');
    function show(id, focus) {
      for (var i = 0; i < bs.length; i++) {
        var on = bs[i].id === id;
        bs[i].setAttribute('aria-selected', on ? 'true' : 'false');
        bs[i].setAttribute('tabindex', on ? '0' : '-1');
        var p = $(bs[i].getAttribute('aria-controls'));
        if (p) p.hidden = !on;
        if (on && focus) bs[i].focus();
      }
    }
    list.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[role="tab"]'); if (b) show(b.id); });
    list.addEventListener('keydown', function (e) {
      var i = Array.prototype.indexOf.call(bs, d.activeElement);
      if (i < 0) return;
      var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : null;
      if (j == null) return;
      e.preventDefault();
      show(bs[(j + bs.length) % bs.length].id, true);
    });
    d.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#tab-"]');
      if (!a) return;
      e.preventDefault();
      var id = a.getAttribute('href').slice(1);
      show(id, true);
      var t = $(id); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start' });
    });
    var h = (root.location.hash || '').slice(1);
    show(h && $(h) && $(h).getAttribute('role') === 'tab' ? h : bs[0].id);
  }

  /* ═════════════════════════════ simulation ═════════════════════════════ */
  var SLOTS = 288, DAY_MS = 60000, SLOT_MS = DAY_MS / SLOTS, STEP_S = 300;
  var REF_DAY = Date.UTC(2026, 8, 20);           /* a day of (almost) equal night and day everywhere */
  var ZERO = new Array(65).join('0');
  var sim = {
    ready: false, on: false, kw: 5, k: 0, acc: 0, rej: 0, codes: {}, open: [], openRej: [], openE: 0,
    seq: 1, prev: ZERO, cum: 0, batches: [], rows: [], log: [], fault: null, start: 0, peak: 1, carry: 0, last: null, lastRes: null
  };

  function profile(kw) {
    var base = SPEC.profiles.bench, p = {};
    for (var key in base) if (Object.prototype.hasOwnProperty.call(base, key)) p[key] = base[key];
    p.nameplate_w = kw * 1000;
    return p;
  }
  var probeProfile = null;
  function iso(ms) { return new Date(ms).toISOString().replace('.000Z', 'Z'); }
  function rec(ms, a, b) { return { ts_start: iso(ms), ts_end: iso(ms + STEP_S * 1000), dt_s: STEP_S, meters: { a: { mwh: a }, b: { mwh: b } } }; }
  /* Sun height for an interval, from the engine's own G2 check (never shown in degrees). */
  function sunSin(ms) {
    var r = G.evaluateInterval(rec(ms, 1000000, 1000000), probeProfile, SPEC);
    for (var i = 0; i < r.checks.length; i++) if (r.checks[i].id === 'elevation' && r.checks[i].detail && typeof r.checks[i].detail.el === 'number') {
      return Math.sin(r.checks[i].detail.el * Math.PI / 180);
    }
    return 0;
  }
  function init() {
    if (!G || !SPEC || !SPEC.profiles || !SPEC.profiles.bench) return false;
    probeProfile = profile(1000000);
    var best = -2, bestSlot = 0;
    for (var s = 0; s < SLOTS; s++) { var v = sunSin(REF_DAY + s * STEP_S * 1000); if (v > best) { best = v; bestSlot = s; } }
    sim.peak = best > 0 ? best : 1;
    sim.start = REF_DAY + (bestSlot - SLOTS / 2) * STEP_S * 1000;   /* simulated day 1 starts at solar midnight */
    sim.ready = true;
    return true;
  }
  function irrAt(k) { return Math.max(0, Math.min(1, sunSin(sim.start + k * STEP_S * 1000) / sim.peak)); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  var FAULTS = {
    covered: { es: 'Tapar el medidor B', en: 'Cover meter B', when: { es: 'se aplica en la próxima lectura con sol', en: 'applies to the next reading with sun' } },
    inflate: { es: 'Inflar la lectura', en: 'Inflate the reading', when: { es: 'se aplica en la próxima lectura', en: 'applies to the next reading' } },
    night: { es: 'Reportar generación de noche', en: 'Report generation at night', when: { es: 'se aplica en la próxima lectura de noche', en: 'applies to the next reading at night' } }
  };

  function step() {
    var k = sim.k, ms = sim.start + k * STEP_S * 1000, irr = irrAt(k), p = profile(sim.kw);
    var hours = STEP_S / 3600;
    var wh = sim.kw * 1000 * irr * 0.8 * hours * rnd(0.96, 1.04);
    var a = Math.round(wh * 1000), b = Math.round(a * (1 + rnd(-0.01, 0.01)));
    var used = null;
    if (sim.fault === 'covered' && a > 2000) { b = Math.round(a * 0.12); used = 'covered'; }
    else if (sim.fault === 'inflate') { a = Math.round(p.nameplate_w * hours * p.ceiling_k * 1.8 * 1000); b = Math.round(a * 0.995); used = 'inflate'; }
    else if (sim.fault === 'night' && irr === 0) { a = Math.round(p.nameplate_w * hours * 0.25 * 1000); b = Math.round(a * 0.995); used = 'night'; }
    if (used) { sim.fault = null; renderFaults(); }
    var r = rec(ms, a, b);
    var res = G.evaluateInterval(r, p, SPEC);
    var ok = res.verdict === 'accept';
    var n = k + 1, basis = Math.min(a, b);
    var marks = {};
    res.checks.forEach(function (c) { marks[c.id] = c.status; });
    var codes = res.failures.map(function (f) { return f.code; });
    if (ok) { sim.acc++; sim.open.push(r); sim.openE += basis; }
    else { sim.rej++; codes.forEach(function (c) { sim.codes[c] = (sim.codes[c] || 0) + 1; }); sim.openRej.push({ n: n, codes: codes }); }
    sim.last = { n: n, a: a, b: b, ok: ok, res: res, used: used, irr: irr, basis: basis };
    sim.rows.unshift({ n: n, a: a, b: b, m: marks, ok: ok, codes: codes, used: used });
    if (sim.rows.length > 12) sim.rows.pop();
    if (!ok) addLog('ko', { es: 'Lectura #' + n + ' rechazada · ' + codes.join(', ') + (used ? ' · engaño: ' + FAULTS[used].es : ''), en: 'Reading #' + n + ' rejected · ' + codes.join(', ') + (used ? ' · attempt: ' + FAULTS[used].en : '') });
    else if (basis > 0 && n % 12 === 0) addLog('ok', { es: 'Lectura #' + n + ' aceptada · min(A,B) = ' + whOf(basis) + ' Wh', en: 'Reading #' + n + ' accepted · min(A,B) = ' + whOf(basis) + ' Wh' });
    sim.k++;
  }

  function addLog(kind, text) {
    sim.log.unshift({ kind: kind, text: text, t: S.fmtTime() });
    if (sim.log.length > 80) sim.log.pop();
    logDirty = true;
  }

  /* ── rendering ── */
  var logDirty = true;
  function gateMark(st) {
    if (st === 'pass') return '<span class="q-ok">✓</span>';
    if (st === 'fail') return '<span class="q-ko">✗</span>';
    return '<span class="q-na">–</span>';
  }
  var G2TEXT = {
    'elevation.ok': { es: 'El sol está sobre el umbral del perfil.', en: 'The sun is above the profile threshold.' },
    'elevation.idle': { es: 'Sin generación que justificar.', en: 'No generation to justify.' },
    'elevation.night': { es: 'Generación reportada con el sol bajo el umbral del perfil: de noche.', en: 'Generation reported with the sun below the profile threshold: at night.' },
    'skipped.upstream': { es: 'No evaluada: una compuerta anterior rechazó la entrada.', en: 'Not evaluated: an earlier gate rejected the input.' }
  };
  function gateMsg(c) {
    if (c.id === 'elevation') return S.t(G2TEXT[c.code] || G2TEXT['elevation.ok']);
    var m = SPEC.messages && SPEC.messages[lg()] && SPEC.messages[lg()][c.code];
    return m ? G.format(m, c.detail) : c.code;
  }
  function gateTitle(id) {
    for (var i = 0; i < SPEC.gates.length; i++) if (SPEC.gates[i].id === id) return SPEC.gates[i].title || { es: id, en: id };
    return { es: id, en: id };
  }
  function renderLast() {
    var out = $('gLast');
    if (!out) return;
    var x = sim.last;
    if (!x) {
      out.innerHTML = '<p class="q-note">' + pair({ es: 'La última lectura aparece aquí cuando enciendes la instalación simulada.', en: 'The latest reading shows here once you switch the simulated installation on.' }) + '</p>';
      return;
    }
    var gates = x.res.checks.map(function (c) {
      var st = c.status === 'pass' ? '<span class="q-state" data-state="ok">' + pair({ es: '✓ PASA', en: '✓ PASSES' }) + '</span>'
        : c.status === 'fail' ? '<span class="q-state" data-state="fail">' + pair({ es: '✗ FALLA', en: '✗ FAILS' }) + '</span>'
          : '<span class="q-state" data-state="na">' + pair({ es: '– NO SE EVALÚA', en: '– NOT EVALUATED' }) + '</span>';
      return '<li><b translate="no">' + esc(c.label || c.id) + '</b><span>' + pair(gateTitle(c.id)) + ' · ' + st + '<br>' + esc(gateMsg(c)) + '</span></li>';
    }).join('');
    var verdict = x.ok
      ? '<p class="q-verdict" data-v="accept"><span data-l="es">ACEPTADO · entra al lote min(A,B) = ' + S.num(whOf(x.basis), 'demo') + ' Wh</span><span data-l="en">ACCEPTED · min(A,B) = ' + S.num(whOf(x.basis), 'demo') + ' Wh goes into the batch</span></p>'
      : '<p class="q-verdict" data-v="reject">' + pair({ es: 'RECHAZADO · {n} filtro(s) fallaron · no suma energía', en: 'REJECTED · {n} filter(s) failed · adds no energy' }, { n: x.res.failures.length }) + '</p>';
    out.innerHTML = verdict +
      '<p class="q-meters"><span>' + pair({ es: 'Lectura #', en: 'Reading #' }) + S.num(String(x.n), 'demo') + '</span><span>' + pair({ es: 'Medidor A: ', en: 'Meter A: ' }) + S.num(whOf(x.a), 'demo') + ' Wh</span><span>' +
      pair({ es: 'Medidor B: ', en: 'Meter B: ' }) + S.num(whOf(x.b), 'demo') + ' Wh</span>' + (x.used ? '<span>' + pair({ es: 'engaño: ' + FAULTS[x.used].es, en: 'attempt: ' + FAULTS[x.used].en }) + '</span>' : '') + '</p>' +
      '<ul class="q-gates">' + gates + '</ul>' + S.badge('demo');
  }
  function renderSun() {
    var f = (sim.k % SLOTS) / SLOTS, irr = sim.ready ? irrAt(Math.max(0, sim.k - 1)) : 0;
    var fill = $('gSunFill'), pos = $('gSunPos'), ic = $('gSunIc');
    if (fill) fill.style.width = (f * 100).toFixed(2) + '%';
    if (pos) pos.style.left = 'calc(' + (f * 100).toFixed(2) + '% - 1px)';
    if (ic) ic.classList.toggle('is-night', irr === 0);
    var day = $('gDay'); if (day) day.textContent = String(Math.floor(sim.k / SLOTS) + 1);
    var el = $('gIrr');
    if (el) el.innerHTML = pair({ es: 'Irradiancia simulada: ', en: 'Simulated irradiance: ' }) + S.num(Math.round(irr * 100) + ' %', 'demo') + (irr === 0 ? ' · ' + pair({ es: 'de noche', en: 'night' }) : '');
  }
  function renderCounters() {
    var set = function (id, v) { var e = $(id); if (e) e.textContent = v; };
    set('gAcc', S.fmtNum(sim.acc)); set('gRej', S.fmtNum(sim.rej)); set('gEnergy', S.fmtNum(sim.openE));
    var keys = Object.keys(sim.codes);
    var c = $('gCodes');
    if (c) c.innerHTML = keys.length ? keys.map(function (k) { return '<code translate="no">' + esc(k) + '</code> ×' + S.num(String(sim.codes[k]), 'demo'); }).join(' · ') : pair({ es: 'ninguno todavía', en: 'none yet' });
    var ek = $('gEnergyKwh');
    if (ek) ek.innerHTML = pair({ es: 'lote abierto #' + sim.seq + ' · ≈ ', en: 'open batch #' + sim.seq + ' · ≈ ' }) + S.num(dec(sim.openE / 1e6, 3), 'demo') + ' kWh · ' + pair({ es: 'se cuenta el menor de los dos medidores', en: 'the lower of the two meters counts' });
    set('gOpenSeq', '#' + sim.seq); set('gOpenN', S.fmtNum(sim.open.length)); set('gOpenR', S.fmtNum(sim.openRej.length)); set('gOpenE', S.fmtNum(sim.openE));
    set('gPrev', sim.prev.slice(0, 10) + '…' + sim.prev.slice(-6));
  }
  function renderRows() {
    var tb = $('gRows');
    if (!tb || !sim.rows.length) return;
    tb.innerHTML = sim.rows.map(function (r) {
      return '<tr' + (r.ok ? '' : ' class="is-rej"') + '><td>#' + S.num(String(r.n), 'demo') + '</td><td>' + S.num(whOf(r.a), 'demo') + '</td><td>' + S.num(whOf(r.b), 'demo') + '</td>' +
        '<td>' + gateMark(r.m.plausibility) + '</td><td>' + gateMark(r.m.nameplate) + '</td><td>' + gateMark(r.m.elevation) + '</td><td>' + gateMark(r.m.agreement) + '</td><td>' +
        (r.ok ? '<span class="q-ok">' + pair({ es: 'aceptado', en: 'accepted' }) + '</span>' : '<span class="q-ko">' + pair({ es: 'rechazado', en: 'rejected' }) + '</span> <code translate="no">' + esc(r.codes.join(', ')) + '</code>') + '</td></tr>';
    }).join('');
  }
  function renderLog() {
    var ol = $('gLog');
    if (!ol || !logDirty) return;
    logDirty = false;
    if (!sim.log.length) return;
    ol.innerHTML = sim.log.map(function (x) {
      return '<li class="is-' + x.kind + '"><span class="q-t">' + esc(x.t) + '</span><b>' + pair(x.text) + '</b></li>';
    }).join('');
  }
  function renderFaults() {
    var bs = d.querySelectorAll('#gFaults [data-fault]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-fault') === sim.fault ? 'true' : 'false');
    var n = $('gFaultNote');
    if (!n) return;
    n.innerHTML = sim.fault ? pair({ es: 'Armado: ' + FAULTS[sim.fault].es + ' · ' + FAULTS[sim.fault].when.es + (sim.on ? '' : ' (enciende la instalación)'), en: 'Armed: ' + FAULTS[sim.fault].en + ' · ' + FAULTS[sim.fault].when.en + (sim.on ? '' : ' (switch the installation on)') })
      : pair({ es: 'Sin engaño armado.', en: 'No attempt armed.' });
  }
  function renderRun() {
    var b = $('gRun'), n = $('gRunNote');
    if (b) {
      b.setAttribute('aria-pressed', sim.on ? 'true' : 'false');
      b.classList.toggle('is-primary', !sim.on); b.classList.toggle('is-on', sim.on);
      b.innerHTML = sim.on ? pair({ es: 'Pausar la instalación simulada', en: 'Pause the simulated installation' }) : pair({ es: sim.k ? 'Reanudar la instalación simulada' : 'Encender la instalación simulada', en: sim.k ? 'Resume the simulated installation' : 'Switch on the simulated installation' });
    }
    if (n) n.innerHTML = sim.on ? pair({ es: 'Encendida: un día simulado por minuto; se pausa sola si cambias de pestaña.', en: 'On: one simulated day per minute; it pauses by itself if you switch tabs.' })
      : pair({ es: sim.k ? 'En pausa.' : 'Apagada. Al encenderla corre un día cada minuto; se pausa sola si cambias de pestaña.', en: sim.k ? 'Paused.' : 'Off. Once on, one day runs every minute; it pauses by itself if you switch tabs.' });
  }
  function renderAll() { renderSun(); renderCounters(); renderRows(); renderLast(); logDirty = true; renderLog(); renderFaults(); renderRun(); renderChain(); }

  /* ── the loop: ~4.8 intervals per real second, only while on and visible ── */
  var timer = null, lastT = 0;
  function tick() {
    var now = Date.now(), dt = Math.min(1000, now - lastT);
    lastT = now;
    if (!sim.on || d.hidden) return;
    sim.carry += dt;
    var n = 0;
    while (sim.carry >= SLOT_MS && n < 12) { sim.carry -= SLOT_MS; step(); n++; }
    if (n) { renderSun(); renderCounters(); renderRows(); renderLast(); renderLog(); }
  }
  function setOn(on) {
    sim.on = on;
    if (on && !timer) { lastT = Date.now(); timer = root.setInterval(tick, 250); }
    if (!on && timer) { root.clearInterval(timer); timer = null; }
    addLog('batch', on ? { es: 'Instalación simulada de ' + sim.kw + ' kW encendida', en: 'Simulated ' + sim.kw + ' kW installation switched on' } : { es: 'Instalación simulada en pausa', en: 'Simulated installation paused' });
    renderRun(); renderFaults(); renderLog();
  }

  /* ── local batch: canonical JSON → SHA-256 (WebCrypto) ── */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }
  function hex(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2); return s; }
  var closing = false;
  function closeBatch() {
    var out = $('gHash');
    var sub = self.crypto && self.crypto.subtle;
    if (!sub || !root.TextEncoder) { out.innerHTML = '<p class="q-err">' + pair({ es: 'Tu navegador no ofrece SHA-256 (WebCrypto) en esta página; usa un navegador actual.', en: 'Your browser does not offer SHA-256 (WebCrypto) on this page; use a current browser.' }) + '</p>'; return; }
    if (closing) return;
    if (!sim.open.length && !sim.openRej.length) { out.innerHTML = '<p class="q-note">' + pair({ es: 'El lote está vacío: enciende la instalación simulada y espera algunas lecturas.', en: 'The batch is empty: switch the simulated installation on and wait for a few readings.' }) + '</p>'; return; }
    closing = true;
    var cum = sim.cum + sim.openE;
    var doc = { format: 'qwatt-grid-demo/1', seq: sim.seq, prev_sha256: sim.prev, intervals: sim.open, refused: sim.openRej, energy_mwh: sim.openE, cumulative_mwh: cum };
    var json = canon(doc);
    sub.digest('SHA-256', new root.TextEncoder().encode(json)).then(function (buf) {
      var h = hex(buf);
      sim.batches.unshift({ seq: sim.seq, n: sim.open.length, r: sim.openRej.length, e: sim.openE, cum: cum, sha: h, prev: sim.prev, bytes: json.length });
      addLog('batch', { es: 'Lote #' + sim.seq + ' cerrado · ' + sim.open.length + ' intervalos · huella ' + h.slice(0, 8) + '…', en: 'Batch #' + sim.seq + ' closed · ' + sim.open.length + ' intervals · fingerprint ' + h.slice(0, 8) + '…' });
      sim.prev = h; sim.cum = cum; sim.seq++; sim.open = []; sim.openRej = []; sim.openE = 0;
      closing = false;
      renderCounters(); renderChain(); renderLog();
    }, function () {
      closing = false;
      out.innerHTML = '<p class="q-err">' + pair({ es: 'No se pudo calcular la huella en este navegador.', en: 'The fingerprint could not be computed in this browser.' }) + '</p>';
    });
  }
  function renderChain() {
    var out = $('gHash'), ol = $('gChain');
    if (!out || !ol) return;
    var b = sim.batches[0];
    if (!b) { ol.innerHTML = ''; return; }
    out.innerHTML = '<p class="q-k">' + pair({ es: 'Huella SHA-256 del lote #' + b.seq, en: 'SHA-256 fingerprint of batch #' + b.seq }) + '</p><code translate="no">' + esc(b.sha) + '</code>' +
      '<p class="q-note">' + pair({ es: 'Calculada por tu navegador sobre ' + S.fmtNum(b.bytes) + ' bytes de JSON canónico. Total acumulado: ', en: 'Computed by your browser over ' + S.fmtNum(b.bytes) + ' bytes of canonical JSON. Running total: ' }) + S.num(S.fmtNum(b.cum), 'demo') + ' mWh</p>' + S.badge('demo');
    ol.innerHTML = sim.batches.slice(0, 8).map(function (x) {
      return '<li><b>' + pair({ es: 'Lote #' + x.seq, en: 'Batch #' + x.seq }) + '</b> · ' + S.num(String(x.n), 'demo') + pair({ es: ' aceptados · ', en: ' accepted · ' }) + S.num(String(x.r), 'demo') + pair({ es: ' rechazados · ', en: ' rejected · ' }) +
        S.num(S.fmtNum(x.e), 'demo') + ' mWh<br>' + pair({ es: 'huella ', en: 'fingerprint ' }) + '<code translate="no">' + esc(x.sha.slice(0, 16)) + '…</code> · ' + pair({ es: 'apunta a ', en: 'points to ' }) + '<code translate="no">' + esc(x.prev.slice(0, 8)) + '…</code></li>';
    }).join('');
  }

  /* ── controls ── */
  function controls() {
    var size = $('gSize');
    if (size) size.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-kw]');
      if (!b) return;
      sim.kw = +b.getAttribute('data-kw');
      var bs = size.querySelectorAll('[data-kw]');
      for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i] === b ? 'true' : 'false');
      addLog('batch', { es: 'Tamaño de la instalación simulada: ' + sim.kw + ' kW (techo de placa del filtro G1)', en: 'Simulated installation size: ' + sim.kw + ' kW (nameplate ceiling of filter G1)' });
      renderLog();
    });
    var run = $('gRun');
    if (run) run.addEventListener('click', function () { if (sim.ready) setOn(!sim.on); });
    var f = $('gFaults');
    if (f) f.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-fault]');
      if (!b) return;
      var k = b.getAttribute('data-fault');
      sim.fault = sim.fault === k ? null : k;
      renderFaults();
    });
    var c = $('gClose');
    if (c) c.addEventListener('click', closeBatch);
  }

  /* ═════════════════ public, read-only: testnet log and scale file ═════════════════ */
  function chainTx() {
    var out = $('gChainTx');
    if (!out || !L) return;
    var C = L.CONFIG, g = C.REHEARSAL.dress.account;
    var data = null, error = null;
    function draw() {
      if (error && !data) {
        out.innerHTML = '<p class="q-err" role="status">' + pair(error.code === 'rate-limited' ? 'limited' : 'offline', { t: S.fmtTime().slice(0, 5) }) + '</p>';
        return;
      }
      if (!data) { out.innerHTML = '<p class="q-note"><span class="q-skel" aria-hidden="true"></span> ' + pair('reading') + '</p>'; return; }
      out.innerHTML = '<ul class="q-txl">' + data.map(function (t) {
        return '<li><b translate="no">' + (t.memoShown ? esc(t.memoShown) : '') + '</b>' + (t.memoShown ? '' : pair('memoHidden')) + ' · ' + esc(S.fmtDate(t.createdAt)) + ' ' + esc(S.fmtTime(t.createdAt)) + ' · ' +
          S.num(String(t.signatures.length), 'vivo') + pair({ es: ' firmas · ', en: ' signatures · ' }) + S.num(String(t.ops), 'vivo') + pair({ es: ' operaciones', en: ' operations' }) +
          (t.memoShown ? ' · <a class="q-link" href="' + esc(C.EXPLORER + '/tx/' + t.hash) + '" target="_blank" rel="noopener">' + pair({ es: 'ver', en: 'view' }) + '<span class="q-ext" aria-hidden="true">↗</span><span class="q-vh">' + pair('newTab') + '</span></a>' : '') + '</li>';
      }).join('') + '</ul>' + S.badge('vivo', { t: S.fmtTime() }) +
        '<p class="q-note">' + pair({ es: 'Cuenta desechable del ensayo del 8 oct; entrada simulada. Este sitio solo lee: no firma ni envía nada.', en: 'Throwaway account of the 8 Oct rehearsal; simulated input. This site only reads: it signs and sends nothing.' }) + '</p>';
    }
    function run() {
      draw();
      L.ready().then(function () { return L.network(); }).then(function () { return L.txs(g, { limit: 8 }); }).then(function (list) { data = list; error = null; draw(); }, function (e) {
        error = e || { code: 'offline' }; draw();
        if (!(e && e.code === 'wrong-network')) root.setTimeout(run, e && e.code === 'rate-limited' ? 60000 : 30000);
      });
    }
    run();
    S.onLang(draw);
  }
  function scale() {
    var box = $('gScale');
    if (!box || !L) return;
    L.evidence(L.CONFIG.SCALE).then(function (j) {
      var put = function (k, v) { var e = box.querySelector('[data-k="' + k + '"]'); if (e) e.textContent = v; };
      if (typeof j.intervals === 'number') put('intervals', S.fmtNum(j.intervals));
      if (typeof j.batches === 'number') put('batches', S.fmtNum(j.batches));
      if (typeof j.rejected_batches === 'number') put('rejected_batches', S.fmtNum(j.rejected_batches));
      if (typeof j.head_sha256 === 'string') put('head', j.head_sha256.slice(0, 8) + '…' + j.head_sha256.slice(-7));
    }, function () { /* the static figures stay */ });
  }

  function start() {
    tabs();
    if (init()) { controls(); renderAll(); }
    else {
      var out = $('gLast');
      if (out) out.innerHTML = '<p class="q-err">' + pair({ es: 'No se pudo cargar el motor de filtros (assets/qwatt-gates.js).', en: 'The filter engine could not be loaded (assets/qwatt-gates.js).' }) + '</p>';
    }
    chainTx();
    scale();
    S.onLang(renderAll);
    d.addEventListener('visibilitychange', function () { lastT = Date.now(); });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
