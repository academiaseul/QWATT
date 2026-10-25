/**
 * QWATT · como-funciona.html — the diagram, operable by keyboard and touch (DESIGN §11.4)
 * ---------------------------------------------------------------------------
 * Every node of the SVG is a button: Enter or Space opens the detail panel and
 * moves focus to its heading, Escape closes it and returns focus to the node,
 * arrow keys move to the previous or next node (DOM order = flow order). The
 * panel's content is copied from the node's entry in the static list under the
 * figure, so the list, the panel and crawlers read the same words; plan item
 * titles come from assets/status.json. Nothing is fetched from anywhere else.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE, Q = root.QWATT_STATUS;
  if (!d || !S) return;
  var $ = function (id) { return d.getElementById(id); };
  var current = null;

  function nodes() { return Array.prototype.slice.call(d.querySelectorAll('.q-flowsvg .q-node')); }
  function entry(id) { return d.querySelector('.q-flowlist [data-node="' + id + '"]'); }

  function open(g) {
    var id = g.getAttribute('data-node'), li = entry(id), panel = $('q-node-panel');
    if (!li || !panel) return;
    nodes().forEach(function (n) { n.setAttribute('aria-expanded', n === g ? 'true' : 'false'); });
    $('qnpTitle').innerHTML = li.querySelector('h3').innerHTML;
    $('qnpChip').innerHTML = li.querySelector('.q-fl-h .q-chip').outerHTML;
    $('qnpSent').innerHTML = li.querySelector('.q-fl-s').innerHTML;
    $('qnpBody').innerHTML = li.querySelector('.q-fl-d').innerHTML;
    panel.hidden = false;
    current = g;
    $('qnpTitle').focus();
  }
  function close() {
    var panel = $('q-node-panel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    nodes().forEach(function (n) { n.setAttribute('aria-expanded', 'false'); });
    if (current) current.focus();
    current = null;
  }
  function titles() {
    var lg = S.lang();
    nodes().forEach(function (g) {
      var li = entry(g.getAttribute('data-node'));
      var t = g.querySelector('title');
      if (!li || !t) return;
      var h = li.querySelector('h3 [data-l="' + lg + '"]'), c = li.querySelector('.q-fl-h .q-chip [data-l="' + lg + '"]');
      t.textContent = li.querySelector('.q-fl-n').textContent + ' · ' + (h ? h.textContent : '') + ' · ' + (c ? c.textContent : '');
    });
  }
  function itemTitles() {
    if (!Q || !Q.load) return;
    Q.load().then(function () {
      var els = d.querySelectorAll('.q-item-t[data-item]');
      for (var i = 0; i < els.length; i++) {
        var it = Q.item(els[i].getAttribute('data-item'));
        if (it) els[i].innerHTML = S.pair(it.title);
      }
      if (current) open(current);
    }, function () { /* the ids and chips stay, without titles */ });
  }

  function start() {
    var fig = $('q-fig'), svg = d.querySelector('.q-flowsvg');
    if (!fig || !svg) return;
    fig.classList.add('is-js');
    svg.addEventListener('click', function (e) { var g = e.target.closest && e.target.closest('.q-node'); if (g) open(g); });
    svg.addEventListener('keydown', function (e) {
      var g = e.target.closest && e.target.closest('.q-node');
      if (!g) return;
      var list = nodes(), i = list.indexOf(g);
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); open(g); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); list[Math.min(list.length - 1, i + 1)].focus(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); list[Math.max(0, i - 1)].focus(); }
    });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && current) close(); });
    $('qnpClose').addEventListener('click', close);
    var tg = $('qFigToggle');
    tg.addEventListener('click', function () {
      var list = !fig.classList.contains('is-list');
      fig.classList.toggle('is-list', list);
      tg.setAttribute('aria-pressed', list ? 'true' : 'false');
      tg.innerHTML = S.pair(list ? { es: 'Ver como diagrama', en: 'Show as a diagram' } : { es: 'Ver como lista', en: 'Show as a list' });
      if (list) close();
    });
    titles();
    itemTitles();
    S.onLang(titles);
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
