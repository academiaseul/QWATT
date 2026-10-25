/**
 * QWATT — a test preload that records every attempt to open, read, copy or move a file of
 * stellar-cli's identity store (any path containing `stellar/identity`). For tests only.
 * ---------------------------------------------------------------------------
 *   node --require anchor/test-fixtures/fs-guard.js …
 *
 * It wraps the fs functions before any other module loads, so code that binds them at load
 * time (`const { readFileSync } = require('fs')`) is seen too. Metadata calls (stat, access)
 * are allowed. On exit it writes one line to stderr: FS_GUARD {"touched":[…]}.
 */

'use strict';

const fs = require('fs');

const touched = [];
const isIdentity = (p) => {
  try {
    const s = p instanceof URL ? p.pathname : Buffer.isBuffer(p) ? p.toString() : typeof p === 'string' ? p : '';
    return s.replace(/\\/g, '/').includes('stellar/identity');
  } catch (e) { return false; }
};
function wrap(obj, name, label) {
  const orig = obj[name];
  if (typeof orig !== 'function') return;
  obj[name] = function guarded(p, ...rest) {
    if (isIdentity(p)) touched.push(`${label} ${String(p)}`);
    return orig.call(this, p, ...rest);
  };
}

for (const n of ['open', 'openSync', 'openAsBlob', 'readFile', 'readFileSync', 'createReadStream', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'rename', 'renameSync', 'link', 'linkSync', 'symlink', 'symlinkSync']) wrap(fs, n, `fs.${n}`);
for (const n of ['open', 'readFile', 'copyFile', 'cp', 'rename', 'link', 'symlink']) wrap(fs.promises, n, `fs.promises.${n}`);

process.on('exit', () => { process.stderr.write(`FS_GUARD ${JSON.stringify({ touched })}\n`); });
