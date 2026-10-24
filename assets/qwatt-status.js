/**
 * QWATT — the sprint plan from one data file (assets/status.json)
 * ---------------------------------------------------------------------------
 * One loader and one set of renderers for the plan: the week-1 highlights, the
 * week-2 plan, the sprint route and calendar, the roadmap, and the status chips
 * of the "how it works" pieces. The same renderers run in two places:
 *   - Node, in ops/site-sync.js, which stamps static HTML into every page (so
 *     crawlers and readers without JavaScript see the same plan), and
 *   - the browser, which only recomputes what depends on today's date (the week
 *     chips) and never rewrites stamped text.
 * Every renderer escapes text, emits Spanish/English pairs (data-l), never emits
 * an inline style or script, and refuses evidence links outside the allowed forms.
 *
 * UMD: window.QWATT_STATUS in the browser, require() in Node. Zero dependencies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(true);
  else root.QWATT_STATUS = factory(false);
}(typeof self !== 'undefined' ? self : this, function (IN_NODE) {
  'use strict';

  var S = null, loading = null;

  /* ───────────────────────────── chips ───────────────────────────── */

  var WORDS = {
    testnet: ['TESTNET', 'TESTNET'], prototipo: ['PROTOTIPO', 'PROTOTYPE'], planificado: ['PLANIFICADO', 'PLANNED'],
    previo: ['TRABAJO PREVIO', 'PRIOR WORK'], hecho: ['HECHO', 'DONE'], curso: ['EN CURSO', 'IN PROGRESS'],
    vigente: ['VIGENTE', 'IN FORCE'], descartada: ['DESCARTADA', 'DROPPED'], info: ['INFO', 'INFO'],
    abierto: ['ABIERTO · DECISIÓN PENDIENTE', 'OPEN · DECISION PENDING'], fuera: ['FUERA DEL SPRINT', 'OUTSIDE THE SPRINT']
  };
  var STATUS_CHIP = { prior: 'previo', done: 'hecho', in_progress: 'curso', planned: 'planificado', open: 'abierto', out_of_scope: 'fuera', dropped: 'descartada' };

  function weekWord(n) {
    if (n >= 1 && n <= 3) return [' · SEMANA ' + n, ' · WEEK ' + n];
    if (n === 4) return [' · CORRIDA', ' · RUN'];
    return ['', ''];
  }
  /** status (item status or chip name) [+ week] → { st, es, en } (DESIGN §3.1). */
  function chip(status, week) {
    var st = STATUS_CHIP[status] || status;
    var w = WORDS[st];
    if (!w) throw new Error('qwatt-status: unknown status ' + status);
    var suffix = (st === 'hecho' || st === 'curso') && week != null ? weekWord(week) : ['', ''];
    return { st: st, es: w[0] + suffix[0], en: w[1] + suffix[1] };
  }

  /* ───────────────────────────── data access ───────────────────────────── */

  function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach(function (k) { deepFreeze(o[k]); }); } return o; }
  function init(status) {
    if (!status || status.version !== 1 || !Array.isArray(status.weeks) || !Array.isArray(status.items) || !Array.isArray(status.nodes) || !status.anchor) {
      throw new Error('qwatt-status: status.json has an unexpected shape');
    }
    S = deepFreeze(status);
    return S;
  }
  function need() { if (!S) throw new Error('qwatt-status: init() or load() first'); return S; }
  function load(url) {
    if (S) return Promise.resolve(S);
    if (!loading) {
      loading = fetch(url || '/assets/status.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(init, function (e) { loading = null; throw e; });
    }
    return loading;
  }
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function item(id) { return find(need().items, id); }
  function node(id) { return find(need().nodes, id); }
  function deliverable(id) { return find(need().deliverables || [], id); }
  function week(n) { var w = need().weeks; for (var i = 0; i < w.length; i++) if (w[i].n === +n) return w[i]; return null; }
  function anchorAccount() { return need().anchor.account || null; }
  function feeds() { return (need().feeds || []).filter(function (f) { return f.base; }); }

  function day(now) {
    if (typeof now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(now)) return now;
    var d = now ? new Date(now) : new Date();
    var cl = new Date(d.getTime() - 3 * 3600 * 1000);   // Chile time, UTC−3 during the sprint
    return cl.toISOString().slice(0, 10);
  }
  /** §3.1: changelog → hecho; dates contain today, or an item in progress → curso; later → planificado. */
  function weekState(w, now) {
    if (!w) return null;
    if (w.n === 0) return 'previo';
    if (w.changelog) return 'hecho';
    var d = day(now);
    var busy = need().items.some(function (i) { return i.week === w.n && i.status === 'in_progress'; });
    if (busy || d >= w.from) return 'curso';
    return 'planificado';
  }
  function weekChip(w, now) {
    var st = weekState(w, now);
    return chip(st, (st === 'hecho' || st === 'curso') ? w.n : null);
  }
  /** "item:ID" | "node:ID" | "week:N" → { st, es, en } or null. */
  function chipFor(ref, now) {
    var m = /^(item|node|week):(.+)$/.exec(ref || '');
    if (!m || !S) return null;
    if (m[1] === 'item') { var it = item(m[2]); return it ? chip(it.status, it.week) : null; }
    if (m[1] === 'node') { var nd = node(m[2]); return nd ? chip(nd.status) : null; }
    var w = week(m[2]); return w ? weekChip(w, now) : null;
  }

  /* ───────────────────────────── HTML helpers ───────────────────────────── */

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pair(o, tag) {
    tag = tag || 'span';
    return '<' + tag + ' data-l="es">' + esc(o.es) + '</' + tag + '><' + tag + ' data-l="en">' + esc(o.en) + '</' + tag + '>';
  }
  function chipHTML(c, ref) {
    return '<span class="q-chip" data-st="' + c.st + '"' + (ref ? ' data-status-of="' + esc(ref) + '"' : '') + '><span data-l="es">' + esc(c.es) + '</span><span data-l="en">' + esc(c.en) + '</span></span>';
  }
  var NEWTAB = '<span class="q-ext" aria-hidden="true">↗</span><span class="q-vh"><span data-l="es">(abre en una pestaña nueva)</span><span data-l="en">(opens in a new tab)</span></span>';
  var MONTHS = { es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
  function fmtDay(iso, lang) { var p = iso.split('-'); return (+p[2]) + ' ' + MONTHS[lang][+p[1] - 1]; }
  function fmtRange(from, to, lang) {
    var a = from.split('-'), b = to.split('-');
    if (a[1] === b[1]) return (+a[2]) + '–' + (+b[2]) + ' ' + MONTHS[lang][+a[1] - 1];
    return fmtDay(from, lang) + ' – ' + fmtDay(to, lang);
  }
  function rangePair(from, to) { return { es: fmtRange(from, to, 'es'), en: fmtRange(from, to, 'en') }; }

  /* ───────────────────────────── evidence links ───────────────────────────── */

  var EVIDENCE = {
    pr: /^https:\/\/github\.com\/academiaseul\/QWATT\/pull\/(\d+)$/,
    commit: /^https:\/\/github\.com\/academiaseul\/QWATT\/commit\/([0-9a-f]{7,40})$/,
    run: /^https:\/\/github\.com\/academiaseul\/QWATT\/actions\/runs\/(\d+)$/,
    release: /^https:\/\/github\.com\/academiaseul\/QWATT\/releases\/tag\/([A-Za-z0-9._-]+)$/,
    compare: /^https:\/\/github\.com\/academiaseul\/QWATT\/compare\/([A-Za-z0-9._-]+\.\.\.[A-Za-z0-9._-]+)$/,
    doc: /^https:\/\/github\.com\/academiaseul\/QWATT\/(?:blob|tree)\/main\/([A-Za-z0-9._\/-]+)$/,
    site: /^\/([A-Za-z0-9._\/-]*)$/,
    video: /^https:\/\/youtube\.com\/shorts\/4PBe8vSmcwM$/,
    post: /^https:\/\/x\.com\/ch1ngukim\/status\/2113590210952921290$/
  };
  function refuse(msg) { if (IN_NODE) throw new Error('qwatt-status: ' + msg); return ''; }
  /** One evidence link, or nothing (browser) / an exception (Node) when the URL is not an allowed form. */
  function evidenceLink(e) {
    var re = e && EVIDENCE[e.kind];
    if (!re) return refuse('unknown evidence kind ' + (e && e.kind));
    var m = re.exec(e.url || '');
    if (!m) return refuse('evidence URL outside the allowed patterns: ' + e.url);
    var label;
    if (e.kind === 'pr') label = '<span translate="no">PR #' + m[1] + '</span>';
    else if (e.kind === 'commit') label = '<span translate="no">commit ' + esc(m[1].slice(0, 7)) + '</span>';
    else if (e.kind === 'release') label = '<span translate="no">release ' + esc(m[1]) + '</span>';
    else if (e.kind === 'compare') label = '<span translate="no">' + esc(m[1].replace('...', '…')) + '</span>';
    else if (e.kind === 'doc' || e.kind === 'site') label = '<span translate="no">' + esc(m[1].split('/').pop() || '/') + '</span>';
    else if (e.kind === 'run') {
      var id = m[1].slice(-4);
      var res = e.result === 'red' ? { es: ' · en rojo antes', en: ' · red before' } : e.result === 'green' ? { es: ' · en verde después', en: ' · green after' } : null;
      label = pair({ es: 'CI …' + id + (res ? res.es : ''), en: 'CI …' + id + (res ? res.en : '') });
    } else if (e.kind === 'video') label = pair({ es: 'Video (2:56)', en: 'Video (2:56)' });
    else label = pair({ es: 'Post en X', en: 'Post on X' });
    var cls = 'q-ev q-ev-' + e.kind + (e.result ? ' is-' + e.result : '');
    if (e.kind === 'site') return '<a class="' + cls + '" href="' + esc(e.url) + '">' + label + '</a>';
    return '<a class="' + cls + '" href="' + esc(e.url) + '" target="_blank" rel="noopener">' + label + NEWTAB + '</a>';
  }
  function evidenceList(list) {
    if (!list || !list.length) return '';
    var out = list.map(evidenceLink).filter(Boolean);
    return out.length ? '<ul class="q-ev-list">' + out.map(function (a) { return '<li>' + a + '</li>'; }).join('') + '</ul>' : '';
  }

  /* ───────────────────────────── renderers ───────────────────────────── */

  var FALLBACK = '<p class="q-fallback">' + pair({ es: 'Este dato se lee en vivo desde Horizon testnet al abrir la página.', en: 'This value is read live from Horizon testnet when the page opens.' }) + '</p>';

  function labelChip(label, statusChip) {
    if (!label || label === 'info' || label === statusChip.st) return '';
    return chipHTML(chip(label));
  }
  function highlightCard(h, w) {
    var sc = chip(h.status, w.n);
    var live = h.live === 'week-tx'
      ? '<div class="q-live-slot" data-widget="week-tx" data-week="' + w.n + '" data-set="core" data-compact="1">' + FALLBACK + '</div>' : '';
    var src = h.status === 'done' || h.status === 'prior'
      ? '<p class="q-src" data-src="dato">' + pair({ es: 'Dato del repositorio · ' + fmtDay(w.to, 'es'), en: 'Repository fact · ' + fmtDay(w.to, 'en') }) + '</p>' : '';
    return '<article class="q-card q-hl" id="hl-' + esc(h.id) + '">' +
      '<div class="q-head"><h3>' + pair(h.title) + '</h3><span class="q-chips">' + chipHTML(sc) + labelChip(h.label, sc) + '</span></div>' +
      '<p>' + pair(h.text) + '</p>' + live + src + evidenceList(h.evidence) + '</article>';
  }
  function itemCard(it) {
    var sc = chip(it.status, it.week);
    var src = it.status === 'planned' || it.status === 'in_progress'
      ? '<p class="q-src" data-src="plan">' + pair({ es: 'en preparación (semana ' + it.week + ')', en: 'in preparation (week ' + it.week + ')' }) + '</p>' : '';
    return '<article class="q-card q-item" id="item-' + esc(it.id) + '">' +
      '<div class="q-head"><h3>' + pair(it.title) + '</h3><span class="q-chips">' + chipHTML(sc, 'item:' + it.id) + labelChip(it.label, sc) + '</span></div>' +
      '<p>' + pair(it.summary) + '</p>' + src + evidenceList(it.evidence) + '</article>';
  }
  /** The highlights of week n (a week with a changelog), or its plan items. */
  function weekBlock(n) {
    var w = week(n);
    if (!w) throw new Error('qwatt-status: no week ' + n);
    var cards = (w.highlights && w.highlights.length)
      ? w.highlights.map(function (h) { return highlightCard(h, w); })
      : need().items.filter(function (i) { return i.week === w.n; }).map(itemCard);
    return '<div class="q-cards q-weekblock" data-week="' + w.n + '">\n' + cards.join('\n') + '\n</div>';
  }
  /** The sprint route: prior work → weeks → counted run. */
  function route(now) {
    var steps = need().weeks.map(function (w) {
      var ref = 'week:' + w.n;
      return '<li class="q-route-step" data-week="' + w.n + '">' +
        '<p class="q-route-when">' + pair(rangePair(w.from, w.to)) + '</p>' +
        '<h3>' + pair(w.title) + '</h3>' + chipHTML(weekChip(w, now || S.updated), ref) +
        '<p>' + pair(w.summary) + '</p></li>';
    });
    return '<ol class="q-route">\n' + steps.join('\n') + '\n</ol>';
  }
  /** The calendar strip: Day 1 → weeks → code freeze → counted run → Day 30. */
  function calendar(now) {
    var sp = need().sprint;
    var cells = ['<li class="q-cal-mark"><p class="q-cal-k">' + pair({ es: 'Día 1', en: 'Day 1' }) + '</p><p class="q-cal-d">' + pair({ es: fmtDay(sp.day1, 'es'), en: fmtDay(sp.day1, 'en') }) + '</p></li>'];
    need().weeks.filter(function (w) { return w.n >= 1; }).forEach(function (w) {
      var fz = w.n === 3 && sp.code_freeze;
      var extra = fz ? { es: ' · congelación del código ' + fmtDay(sp.code_freeze, 'es'), en: ' · code freeze ' + fmtDay(sp.code_freeze, 'en') } : null;
      cells.push('<li class="q-cal-week" data-week="' + w.n + '"><p class="q-cal-k">' + pair(w.title) + '</p>' +
        '<p class="q-cal-d">' + pair({ es: fmtRange(w.from, w.to, 'es') + (extra ? extra.es : ''), en: fmtRange(w.from, w.to, 'en') + (extra ? extra.en : '') }) + '</p>' +
        chipHTML(weekChip(w, now || S.updated), 'week:' + w.n) + '</li>');
    });
    cells.push('<li class="q-cal-mark"><p class="q-cal-k">' + pair({ es: 'Día 30', en: 'Day 30' }) + '</p><p class="q-cal-d">' + pair({ es: fmtDay(sp.day30, 'es'), en: fmtDay(sp.day30, 'en') }) + '</p></li>');
    return '<ol class="q-cal">\n' + cells.join('\n') + '\n</ol>';
  }
  /** The roadmap: deliverables with counts, and every item with status, label and evidence (hoja-de-ruta.html). */
  function roadmap(now) {
    var s = need();
    var count = function (ids) {
      var c = { done: 0, in_progress: 0, planned: 0, open: 0, prior: 0 };
      ids.forEach(function (id) { var it = item(id); if (it && c[it.status] != null) c[it.status]++; });
      return c;
    };
    var dels = (s.deliverables || []).map(function (d) {
      var c = count(d.items);
      var seg = ['prior', 'done', 'in_progress', 'planned', 'open'].filter(function (k) { return c[k]; }).map(function (k) {
        var ch = chip(k);
        return '<li class="q-seg" data-st="' + ch.st + '" data-n="' + c[k] + '">' + pair({ es: c[k] + ' · ' + ch.es.toLowerCase(), en: c[k] + ' · ' + ch.en.toLowerCase() }) + '</li>';
      }).join('');
      return '<article class="q-card q-del" id="' + esc(d.id) + '"><h3>' + pair(d.title) + '</h3><p>' + pair(d.summary) + '</p><ul class="q-segs">' + seg + '</ul></article>';
    }).join('\n');
    var rows = s.items.map(function (it) {
      var sc = chip(it.status, it.week);
      var wk = it.week == null ? { es: '—', en: '—' } : it.week === 0 ? { es: 'previo', en: 'prior' } : it.week === 4 ? { es: 'corrida', en: 'run' } : { es: 'semana ' + it.week, en: 'week ' + it.week };
      return '<tr id="' + esc(it.id) + '" data-status="' + it.status + '" data-deliverable="' + esc(it.deliverable || '') + '">' +
        '<th scope="row"><span translate="no">' + esc(it.id) + '</span></th>' +
        '<td><p class="q-row-t">' + pair(it.title) + '</p><p class="q-row-s">' + pair(it.summary) + '</p></td>' +
        '<td>' + pair(wk) + '</td><td>' + chipHTML(sc, 'item:' + it.id) + '</td><td>' + chipHTML(chip(it.label)) + '</td>' +
        '<td>' + (evidenceList(it.evidence) || pair({ es: 'sin enlace todavía', en: 'no link yet' })) + '</td></tr>';
    }).join('\n');
    return '<div class="q-roadmap">' + calendar(now) + '<div class="q-cards q-dels">' + dels + '</div>' +
      '<div class="q-table-wrap"><table class="q-table q-items"><caption>' + pair({ es: 'Todos los puntos del plan', en: 'Every plan item' }) + '</caption>' +
      '<thead><tr><th scope="col">' + pair({ es: 'Punto', en: 'Item' }) + '</th><th scope="col">' + pair({ es: 'Qué es', en: 'What it is' }) + '</th><th scope="col">' + pair({ es: 'Semana', en: 'Week' }) + '</th>' +
      '<th scope="col">' + pair({ es: 'Estado', en: 'Status' }) + '</th><th scope="col">' + pair({ es: 'Rótulo', en: 'Label' }) + '</th><th scope="col">' + pair({ es: 'Evidencia', en: 'Evidence' }) + '</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  /** Browser: refresh the chips whose value depends on today (week chips); stamped text is never rewritten otherwise. */
  function applyStatusOf(rootEl, now) {
    if (!S || !rootEl || !rootEl.querySelectorAll) return;
    var els = rootEl.querySelectorAll('[data-status-of]');
    for (var i = 0; i < els.length; i++) {
      var c = chipFor(els[i].getAttribute('data-status-of'), now);
      if (!c) continue;
      els[i].setAttribute('data-st', c.st);
      var es = els[i].querySelector('[data-l="es"]'), en = els[i].querySelector('[data-l="en"]');
      if (es) es.textContent = c.es;
      if (en) en.textContent = c.en;
    }
  }

  return {
    load: load, init: init, item: item, week: week, node: node, deliverable: deliverable,
    weekState: weekState, chip: chip, chipFor: chipFor, anchorAccount: anchorAccount, feeds: feeds,
    applyStatusOf: applyStatusOf, fmtDay: fmtDay, fmtRange: fmtRange,
    render: { weekBlock: weekBlock, route: route, calendar: calendar, roadmap: roadmap, evidenceLink: evidenceLink, evidenceList: evidenceList, chip: chipHTML, pair: pair, esc: esc },
    EVIDENCE: EVIDENCE
  };
}));
