/* QWATT — set theme and language before the first paint (loaded blocking in <head>).
   Reads only the two UI preferences; never anything else. */
(function () {
  var html = document.documentElement;
  var theme = 'dark', lang = 'es';
  try {
    var t = window.localStorage.getItem('qwatt.theme');
    if (t === 'light' || t === 'dark') theme = t;
    var l = window.localStorage.getItem('wc-lang');
    if (l === 'en' || l === 'es') lang = l;
  } catch (e) { /* storage blocked: defaults */ }
  html.setAttribute('data-theme', theme);
  html.setAttribute('data-lang', lang);
  html.setAttribute('lang', lang);
  html.className += (html.className ? ' ' : '') + 'js';
}());
