/**
 * QWATT · verificacion.html, section 01 — the filter lab (moved out of main's inline script)
 * ---------------------------------------------------------------------------
 * The real gate engine (assets/gates.browser.js + assets/qwatt-gates.js, the files
 * the conformance suite runs in CI) on one simulated five-minute interval built from
 * the controls. Simulated input, a demo in the browser: nothing is sent to Stellar
 * testnet and nothing is stored. G2 says only above or below the profile threshold.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE;
  if (!d || !S) return;
  var pair = S.pair, esc = S.esc, num = S.num;
  var $ = function (id) { return d.getElementById(id); };

  /* ───────────────────────────── 01 · the filter lab ───────────────────────────── */

  var LAB = {
    honest: { hour: 12, a: 11.8, b: 11.6, dt: 300, skew: false }, shade: { hour: 12, a: 0.2, b: 0.2, dt: 300, skew: false },
    cap: { hour: 12, a: 22.0, b: 21.6, dt: 300, skew: false }, night: { hour: 23, a: 8.0, b: 7.9, dt: 300, skew: false },
    diverge: { hour: 12, a: 11.8, b: 6.0, dt: 300, skew: false }, dead: { hour: 12, a: 11.8, b: 0, dt: 300, skew: false },
    gap: { hour: 12, a: 11.8, b: 11.6, dt: 1200, skew: false }
  };
  /* G2 says only above or below the threshold: the degrees at a known time would hint at the reference location. */
  var G2 = {
    'elevation.ok': { es: 'Con generación, y el sol sobre el umbral del perfil.', en: 'Generating, with the sun above the profile threshold.' },
    'elevation.idle': { es: 'Sin generación que justificar.', en: 'No generation to justify.' },
    'elevation.night': { es: 'Generación reportada con el sol bajo el umbral del perfil: de noche.', en: 'Generation reported with the sun below the profile threshold: at night.' },
    'skipped.upstream': { es: 'No evaluada: un filtro anterior rechazó la entrada.', en: 'Not evaluated: an earlier filter rejected the input.' }
  };
  var LABW = {
    accepted: { es: 'ACEPTADO', en: 'ACCEPTED' }, rejected: { es: 'RECHAZADO', en: 'REJECTED' },
    pass: { es: '✓ PASA', en: '✓ PASSES' }, fail: { es: '✗ FALLA', en: '✗ FAILS' }, skip: { es: '– NO SE EVALÚA', en: '– NOT EVALUATED' },
    failed: { es: '{n} filtro(s) fallaron · no se anclaría', en: '{n} filter(s) failed · nothing would be anchored' }
  };
  function lab() {
    var SPEC = root.QWATT_GATES_SPEC, G = root.QWATT_GATES;
    var els = { hour: $('cHour'), a: $('cA'), b: $('cB'), dt: $('cDt'), skew: $('cSkew') };
    if (!SPEC || !G || !els.hour) return;
    var PR = SPEC.profiles.bench;
    var specv = $('specv');
    if (specv) specv.textContent = 'spec ' + SPEC.spec_version + ' · ' + String(SPEC.digest || '').slice(0, 8);
    var n1 = function (x, k) { var v = x.toFixed(k == null ? 1 : k); return S.lang() === 'en' ? v : v.replace('.', ','); };
    var INT = { dt: 1, dt_ts: 1, max_dt: 1, max_skew: 1, skew: 1, minutes: 1, nameplate: 1 };
    function fmt(v, k) {
      if (typeof v !== 'number') return String(v);
      if (INT[k]) return String(Math.round(v));
      if (k === 'diff' || k === 'tol') return n1(v, 2);
      if (k === 'ratio') return n1(v, 3);
      return n1(v);
    }
    /* A normalized interval (protocol/interval.schema.json) from the controls: hora de Chile (UTC−3) el 2026-09-20. */
    function interval() {
      var hour = +els.hour.value, A = +els.a.value, B = +els.b.value, dt = +els.dt.value;
      var start = new Date(Date.UTC(2026, 8, 20, hour + 3, 0, 0));
      return {
        spec_version: SPEC.spec_version, schema_version: G.INTERVAL_SCHEMA_VERSION, site_id: 'bench-demo', node_id: 'demo', seq: 1,
        ts_start: start.toISOString(), ts_end: new Date(start.getTime() + dt * 1000).toISOString(), dt_s: dt,
        meters: { a: { id: 'pzem-017', class: 'dc', mwh: Math.round(A * 1000) }, b: { id: 'epever', class: 'dc', mwh: Math.round(B * 1000) } },
        clock_skew_s: els.skew.checked ? PR.clock_max_skew_s + 1 : 0, source: { adapter: 'demo' }
      };
    }
    function draw() {
      var lg = S.lang();
      $('vHour').textContent = String(els.hour.value).padStart(2, '0') + ':00';
      $('vA').textContent = n1(+els.a.value) + ' Wh';
      $('vB').textContent = n1(+els.b.value) + ' Wh';
      $('vDt').textContent = els.dt.value + ' s';
      var res = G.evaluateInterval(interval(), PR, SPEC);
      var msgs = SPEC.messages[lg] || SPEC.messages.en;
      $('checks').innerHTML = res.checks.map(function (c) {
        var txt = c.id === 'elevation' ? S.t(G2[c.code] || G2['elevation.ok']) : G.format(msgs[c.code] || c.code, c.detail, fmt);
        var stt = c.status === 'pass' ? 'ok' : c.status === 'fail' ? 'fail' : 'na';
        var word = c.status === 'pass' ? LABW.pass : c.status === 'fail' ? LABW.fail : LABW.skip;
        return '<div class="q-gchk"><b translate="no">' + esc(c.label) + '</b><span class="q-state" data-state="' + stt + '">' + pair(word) + '</span><span>' + esc(txt) + '</span></div>';
      }).join('');
      var ok = res.verdict === 'accept';
      var basis = Math.min(+els.a.value, +els.b.value);
      $('verdict').className = 'q-verdict ' + (ok ? 'is-ok' : 'is-no');
      $('vTitle').innerHTML = pair(ok ? LABW.accepted : LABW.rejected);
      $('vBasis').innerHTML = ok
        ? '<span data-l="es">se anclaría · min(A,B) = ' + num(n1(basis), 'demo') + ' Wh</span><span data-l="en">would be anchored · min(A,B) = ' + num(n1(basis), 'demo') + ' Wh</span>'
        : pair(LABW.failed, { n: res.failures.length });
    }
    function press(btn) {
      var bs = d.querySelectorAll('#presets [data-p]');
      for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i] === btn ? 'true' : 'false');
    }
    Object.keys(els).forEach(function (k) { els[k].addEventListener('input', function () { press(null); draw(); }); });
    $('presets').addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-p]');
      if (!btn) return;
      var p = LAB[btn.getAttribute('data-p')];
      els.hour.value = p.hour; els.a.value = p.a; els.b.value = p.b; els.dt.value = p.dt; els.skew.checked = p.skew;
      press(btn); draw();
    });
    draw();
    S.onLang(draw);
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', lab); else lab();
}(typeof self !== 'undefined' ? self : this));
