/**
 * QWATT · backup.html — "Custodia de claves: 2 de 3, sin navegador"
 * ---------------------------------------------------------------------------
 * One job (DESIGN FD-6, exception E3 of ops/site.test.js): when the visitor
 * clicks the button, remove from this browser the two testnet keys that the
 * August 2026 tools may have left in local storage. It never reads them, never
 * checks whether they were there, never sends anything. Nothing runs until the
 * click. The anchoring-account slot on this page is the shared anchor-slot widget.
 */
(function (root) {
  'use strict';
  var d = root.document, S = root.QWATT_SITE;
  if (!d || !S) return;

  var T = {
    done: { es: 'Listo: si este navegador guardaba claves de agosto, ya no están. No las leímos ni las enviamos.', en: 'Done: if this browser kept August keys, they are gone. We did not read or send them.' },
    blocked: { es: 'Este navegador no deja tocar su almacenamiento local (modo privado o bloqueo); no había nada que borrar desde aquí.', en: 'This browser does not allow access to its local storage (private mode or blocked); there was nothing to delete from here.' }
  };

  function purge() {
    var ok = true;
    try {
      localStorage.removeItem('qwatt.issuerSecret');
      localStorage.removeItem('qwatt.distSecret');
    } catch (e) { ok = false; }
    var out = d.getElementById('bPurgeOut');
    if (out) out.innerHTML = S.pair(ok ? T.done : T.blocked);
  }

  function start() {
    var b = d.getElementById('bPurge');
    if (b) b.addEventListener('click', purge);
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
}(typeof self !== 'undefined' ? self : this));
