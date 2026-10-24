/**
 * QWATT home page: the copper waveform behind the hero (decorative), the mini
 * "try to fool the verifier" lab (the real gate engine, simulated input, sends
 * nothing) and the filter of the "every idea" index.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE;
  if (!d || !S) return;
  var pair = S.pair, esc = S.esc;
  var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ───────────── waveform (aria-hidden, paused when off screen or reduced motion) ───────────── */
  function wave() {
    var cv = d.getElementById('qWave');
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d'), ph = 0, on = true, raf = 0;
    function size() { var r = cv.parentElement.getBoundingClientRect(), k = root.devicePixelRatio || 1; cv.width = r.width * k; cv.height = r.height * k; }
    function colour() { return root.getComputedStyle(d.documentElement).getPropertyValue('--copper').trim() || '#d08a57'; }
    function draw() {
      var w = cv.width, h = cv.height, k = root.devicePixelRatio || 1, c = colour();
      ctx.clearRect(0, 0, w, h);
      for (var l = 0; l < 3; l++) {
        ctx.beginPath();
        var amp = h * 0.05 * (1 + l * 0.6), yc = h * (0.66 + l * 0.09), f = 0.0035 / k * (1 + l * 0.3);
        for (var x = 0; x <= w; x += 6 * k) {
          var y = yc + Math.sin(x * f + ph * (1 + l * 0.35)) * amp * Math.sin(x / w * Math.PI);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = c; ctx.globalAlpha = [0.22, 0.11, 0.08][l]; ctx.lineWidth = 1.5 * k; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ph += 0.012;
      if (!reduced && on && !d.hidden) raf = root.requestAnimationFrame(draw);
    }
    size(); draw();
    root.addEventListener('resize', function () { size(); if (reduced) draw(); });
    root.addEventListener('qwatt-theme', function () { if (reduced) draw(); });
    if ('IntersectionObserver' in root && !reduced) {
      new root.IntersectionObserver(function (es) {
        on = es[0].isIntersecting;
        if (on) { root.cancelAnimationFrame(raf); raf = root.requestAnimationFrame(draw); }
      }).observe(cv);
    }
    d.addEventListener('visibilitychange', function () { if (!d.hidden && on && !reduced) { root.cancelAnimationFrame(raf); raf = root.requestAnimationFrame(draw); } });
  }

  /* ───────────── mini lab: three attempts against the real gate engine ───────────── */
  var PRESETS = {
    honest: { ts: '2026-09-20T16:30:00Z', a: 9800, b: 9650, title: { es: 'Intervalo honesto', en: 'Honest interval' } },
    night: { ts: '2026-09-20T06:00:00Z', a: 8000, b: 7900, title: { es: 'Generar de noche', en: 'Generate at night' } },
    covered: { ts: '2026-09-20T16:30:00Z', a: 9800, b: 1200, title: { es: 'Sensor tapado', en: 'Covered sensor' } }
  };
  var current = 'honest';
  var ELEVATION = {
    'elevation.ok': { es: 'El sol está sobre el umbral del perfil.', en: 'The sun is above the profile threshold.' },
    'elevation.idle': { es: 'Sin generación que justificar.', en: 'No generation to justify.' },
    'elevation.night': { es: 'Generación reportada con el sol bajo el umbral del perfil: de noche.', en: 'Generation reported with the sun below the profile threshold: at night.' },
    'skipped.upstream': { es: 'No evaluada: una compuerta anterior rechazó la entrada.', en: 'Not evaluated: an earlier gate rejected the input.' }
  };
  function interval(p) {
    var end = new Date(Date.parse(p.ts) + 300000).toISOString().replace('.000Z', 'Z');
    return { ts_start: p.ts, ts_end: end, dt_s: 300, meters: { a: { mwh: p.a }, b: { mwh: p.b } } };
  }
  function wh(mwh) { var v = (mwh / 1000).toFixed(2); return S.lang() === 'en' ? v : v.replace('.', ','); }
  function renderLab() {
    var out = d.getElementById('labOut');
    var G = root.QWATT_GATES, SPEC = root.QWATT_GATES_SPEC;
    if (!out || !G || !SPEC) return;
    var p = PRESETS[current];
    var res = G.evaluateInterval(interval(p), SPEC.profiles.bench, SPEC);
    var lg = S.lang();
    var titles = {};
    (SPEC.gates || []).forEach(function (g) { titles[g.id] = g.title; });
    var gates = res.checks.map(function (c) {
      /* G2 says only above / below the threshold: the degrees at a known time would hint at the reference location. */
      var msg = c.id === 'elevation' ? S.t(ELEVATION[c.code] || ELEVATION['elevation.ok'])
        : SPEC.messages && SPEC.messages[lg] && SPEC.messages[lg][c.code] ? G.format(SPEC.messages[lg][c.code], c.detail) : c.code;
      var t = titles[c.id] || { es: c.id, en: c.id };
      var st = c.status === 'pass' ? '<span class="q-state" data-state="ok">' + pair({ es: '✓ PASA', en: '✓ PASSES' }) + '</span>'
        : c.status === 'fail' ? '<span class="q-state" data-state="fail">' + pair({ es: '✗ FALLA', en: '✗ FAILS' }) + '</span>'
          : '<span class="q-state" data-state="na">' + pair({ es: '– NO SE EVALÚA', en: '– NOT EVALUATED' }) + '</span>';
      return '<li><b translate="no">' + esc(c.label || c.id) + '</b><span>' + pair(t) + ' · ' + st + '<br>' + esc(msg) + '</span></li>';
    }).join('');
    var basis = Math.min(p.a, p.b);
    var verdict = res.verdict === 'accept'
      ? '<p class="q-verdict" data-v="accept"><span data-l="es">ACEPTADO · se anclaría min(A,B) = ' + S.num(wh(basis), 'demo') + ' Wh</span>' +
        '<span data-l="en">ACCEPTED · min(A,B) = ' + S.num(wh(basis), 'demo') + ' Wh would be anchored</span></p>'
      : '<p class="q-verdict" data-v="reject">' + pair({ es: 'RECHAZADO · {n} filtro(s) fallaron · no se anclaría', en: 'REJECTED · {n} filter(s) failed · nothing would be anchored' }, { n: res.failures.length }) + '</p>';
    out.innerHTML = verdict +
      '<p class="q-meters">' + pair({ es: 'Medidor A: ', en: 'Meter A: ' }) + S.num(wh(p.a), 'demo') + ' Wh · ' + pair({ es: 'Medidor B: ', en: 'Meter B: ' }) + S.num(wh(p.b), 'demo') + ' Wh · ' +
      pair({ es: '5 minutos desde las ', en: '5 minutes from ' }) + esc(p.ts.slice(11, 16)) + ' UTC</p>' +
      '<ul class="q-gates">' + gates + '</ul>' + S.badge('demo');
    var bs = d.querySelectorAll('[data-preset]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-preset') === current ? 'true' : 'false');
  }
  function lab() {
    var box = d.getElementById('labPresets');
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-preset]');
      if (!b) return;
      current = b.getAttribute('data-preset');
      renderLab();
    });
    renderLab();
    S.onLang(renderLab);
  }

  /* ───────────── "every idea" filter ───────────── */
  function ideas() {
    var bar = d.getElementById('ideaFilters');
    if (!bar) return;
    var cards = d.querySelectorAll('.q-idea[data-tags]');
    var btns = bar.querySelectorAll('[data-filter]');
    for (var i = 0; i < btns.length; i++) {
      var f = btns[i].getAttribute('data-filter'), n = 0;
      for (var j = 0; j < cards.length; j++) if (f === 'all' || (' ' + cards[j].getAttribute('data-tags') + ' ').indexOf(' ' + f + ' ') >= 0) n++;
      var c = btns[i].querySelector('.q-count'); if (c) c.textContent = '(' + n + ')';
    }
    bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-filter]');
      if (!b) return;
      var f = b.getAttribute('data-filter');
      for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', btns[i] === b ? 'true' : 'false');
      for (var j = 0; j < cards.length; j++) cards[j].hidden = !(f === 'all' || (' ' + cards[j].getAttribute('data-tags') + ' ').indexOf(' ' + f + ' ') >= 0);
    });
  }

  function start() { wave(); lab(); ideas(); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
