/**
 * QWATT · hoja-de-ruta.html — filters for the plan table (DESIGN §10.6)
 * ---------------------------------------------------------------------------
 * The calendar, the four deliverables and every item are stamped into the page
 * from assets/status.json by ops/site-sync.js, so the page reads completely
 * without JavaScript. Here: a filter bar by status and by deliverable
 * (combinable, buttons with aria-pressed and counts), the empty-filter line, and
 * the open-decisions list refreshed from status.json. Nothing is fetched except
 * assets/status.json; nothing is stored.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE, Q = root.QWATT_STATUS;
  if (!d || !S) return;
  var pair = S.pair;

  var STATUS = [
    ['all', { es: 'Todos', en: 'All' }], ['done', { es: 'Hecho', en: 'Done' }], ['in_progress', { es: 'En curso', en: 'In progress' }],
    ['planned', { es: 'Planificado', en: 'Planned' }], ['open', { es: 'Abierto', en: 'Open' }], ['prior', { es: 'Trabajo previo', en: 'Prior work' }]
  ];
  var DELIV = [
    ['all', { es: 'Todas las entregas', en: 'All deliverables' }], ['D1', { es: 'Entrega 1', en: 'Deliverable 1' }], ['D2', { es: 'Entrega 2', en: 'Deliverable 2' }],
    ['D3', { es: 'Entrega 3', en: 'Deliverable 3' }], ['D4', { es: 'Entrega 4', en: 'Deliverable 4' }]
  ];
  var LABEL = { status: { es: 'Filtrar por estado', en: 'Filter by status' }, deliv: { es: 'Filtrar por entrega', en: 'Filter by deliverable' } };
  var sel = { status: 'all', deliv: 'all' };

  function rows() { return Array.prototype.slice.call(d.querySelectorAll('.q-items tbody tr')); }
  function group(kind, list) {
    var rs = rows();
    var attr = kind === 'status' ? 'data-status' : 'data-deliverable';
    return '<div class="q-fgroup" role="group" aria-label="' + S.esc(LABEL[kind][S.lang()]) + '" data-aria-es="' + S.esc(LABEL[kind].es) + '" data-aria-en="' + S.esc(LABEL[kind].en) + '">' +
      list.map(function (o) {
        var n = o[0] === 'all' ? rs.length : rs.filter(function (r) { return r.getAttribute(attr) === o[0]; }).length;
        return '<button type="button" class="q-btn is-small" data-f="' + kind + '" data-v="' + o[0] + '" aria-pressed="' + (sel[kind] === o[0] ? 'true' : 'false') + '">' +
          pair(o[1]) + ' <span class="q-count">(' + n + ')</span></button>';
      }).join('') + '</div>';
  }
  function apply() {
    var shown = 0;
    rows().forEach(function (r) {
      var ok = (sel.status === 'all' || r.getAttribute('data-status') === sel.status) && (sel.deliv === 'all' || r.getAttribute('data-deliverable') === sel.deliv);
      r.hidden = !ok;
      if (ok) shown++;
    });
    var e = d.getElementById('rEmpty'); if (e) e.hidden = shown > 0;
    var bs = d.querySelectorAll('#rFilters [data-f]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', sel[bs[i].getAttribute('data-f')] === bs[i].getAttribute('data-v') ? 'true' : 'false');
  }
  function filters() {
    var wrap = d.querySelector('.q-roadmap .q-table-wrap');
    if (!wrap) return;
    var bar = d.createElement('div');
    bar.className = 'q-filters';
    bar.id = 'rFilters';
    bar.innerHTML = group('status', STATUS) + group('deliv', DELIV);
    wrap.parentNode.insertBefore(bar, wrap);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-f]');
      if (!b) return;
      sel[b.getAttribute('data-f')] = b.getAttribute('data-v');
      apply();
    });
    apply();
  }
  function openList() {
    if (!Q || !Q.load) return;
    Q.load().then(function (st) {
      var ul = d.getElementById('rOpen');
      if (!ul) return;
      var open = st.items.filter(function (it) { return it.status === 'open'; });
      ul.innerHTML = open.map(function (it) {
        return '<li><a href="#' + S.esc(it.id) + '"><span translate="no">' + S.esc(it.id) + '</span></a> ' + Q.render.chip(Q.chip(it.status, it.week), 'item:' + it.id) + ' <span>' + pair(it.title) + '</span></li>';
      }).join('');
    }, function () { /* the stamped list stays */ });
  }

  function start() { filters(); openList(); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
