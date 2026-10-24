#!/usr/bin/env node
/**
 * QWATT — browser build of the protocol (DESIGN D-12, §9.2)
 * ---------------------------------------------------------------------------
 *   node protocol/build-browser.js            write assets/qwatt-protocol.js
 *   node protocol/build-browser.js --check    exit 1 if the committed file differs from a fresh build (CI)
 *
 * verificacion.html re-derives published batches in the visitor's browser. It must
 * run the repository's own code, not a copy that could drift, so this generator
 * wraps the CommonJS sources byte for byte, each as one module function:
 *
 *   protocol/evidence.js, protocol/schema-lite.js, batch/verify.js,
 *   protocol/interval.schema.json, protocol/batch.schema.json, protocol/reasons.json
 *
 * Their Node built-ins come from protocol/browser-shim.js (a synchronous SHA-256,
 * a minimal Buffer, POSIX path.join). The gate engine and the spec binding are
 * not embedded: they resolve to the globals of assets/qwatt-gates.js and
 * assets/gates.generated.js, which the page loads first, so the site keeps one
 * deployed copy of the gate engine.
 *
 * The build refuses a source that uses a built-in member the shim does not
 * provide, or requires a module that is not bundled; then it loads the fresh
 * bundle in a bare context (no require, no Buffer, no hashing module, no
 * process) and checks EMPTY_ROOT and the two 8 Oct rehearsal batch hashes that
 * are anchored on Stellar testnet. Output is deterministic: LF line endings, no
 * timestamp, no commit id, so the file changes only when a source changes.
 * Zero dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeHash = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = 'assets/qwatt-protocol.js';
const SHIM = 'protocol/browser-shim.js';
/* The embedded sources, in load order (api.sources keeps this order; the header sorts by path). */
const SOURCES = ['protocol/evidence.js', 'protocol/schema-lite.js', 'batch/verify.js',
  'protocol/interval.schema.json', 'protocol/batch.schema.json', 'protocol/reasons.json'];
/* Not embedded: resolved to page globals at first use. */
const EXTERNAL = { 'assets/qwatt-gates.js': 'QWATT_GATES', 'assets/gates.generated.js': 'QWATT_GATES_SPEC' };
const BUILTINS = ['crypto', 'path'];
const BUDGET = 100 * 1024;
const REHEARSAL = ['322923a411c146079b73269fe3135d9e6413a9dafdb07807567c8a119f35a245', '852314a2a11f86548e3f8b09c16aa2fd6ef82ae8e8641db5ef20a4bc2d0f5466'];

const readLF = (root, p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const sha = (s) => nodeHash.createHash('sha256').update(s, 'utf8').digest('hex');

/* ───────────────────────────── source scan ───────────────────────────── */

/** Every built-in member, encoding and module a source asks for, checked against the shim and the module table. */
function scan(id, text, shim) {
  const P = shim.PROVIDES;
  const problems = [];
  if (!/\.js$/.test(id)) return problems;
  /* the local name a source gives the hashing module (const crypto = require('crypto') → crypto) */
  const hashNames = [...text.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"](?:node:)?crypto['"]\s*\)/g)].map((m) => m[1]);
  for (const n of hashNames) {
    for (const m of text.matchAll(new RegExp('\\b' + n + '\\.(\\w+)', 'g'))) if (!P.hash.includes(m[1])) problems.push(`${id}: ${n}.${m[1]} is not provided by ${SHIM}`);
  }
  for (const m of text.matchAll(/\bBuffer\.(\w+)/g)) if (!P.Buffer.includes(m[1])) problems.push(`${id}: Buffer.${m[1]} is not provided by ${SHIM}`);
  for (const m of text.matchAll(/\bBuffer\.from\([^)]*?,\s*['"]([\w-]+)['"]\s*\)/g)) if (!['utf8', 'hex', 'base64'].includes(m[1])) problems.push(`${id}: Buffer.from(…, '${m[1]}') is not provided`);
  for (const m of text.matchAll(/\.digest\(\s*['"]?(\w*)['"]?\s*\)/g)) if (!P.digest.includes(m[1])) problems.push(`${id}: digest('${m[1]}') is not provided`);
  for (const m of text.matchAll(/\.update\([^()]*?,\s*['"]([\w-]+)['"]\s*\)/g)) if (!P.updateEncodings.includes(m[1])) problems.push(`${id}: update(…, '${m[1]}') is not provided`);
  const pathNames = [...text.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"](?:node:)?path['"]\s*\)/g)].map((m) => m[1]);
  for (const n of pathNames) {
    for (const m of text.matchAll(new RegExp('\\b' + n + '\\.(\\w+)', 'g'))) if (!P.path.includes(m[1])) problems.push(`${id}: ${n}.${m[1]} is not provided by ${SHIM}`);
  }
  /* require('x') with a literal id */
  const dir = path.posix.dirname(id);
  for (const m of text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const r = m[1].replace(/^node:/, '');
    if (BUILTINS.includes(r)) continue;
    if (!/^\.\.?\//.test(r)) { problems.push(`${id}: require('${m[1]}') is not bundled`); continue; }
    const p = path.posix.normalize(path.posix.join(dir, r));
    if (!SOURCES.includes(p) && !SOURCES.includes(p + '.js') && !EXTERNAL[p] && !EXTERNAL[p + '.js']) problems.push(`${id}: require('${m[1]}') → ${p} is not bundled`);
  }
  /* require(path.join(ROOT|__dirname, 'a', 'b')) with literal parts */
  const rootVars = { __dirname: dir };
  for (const m of text.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*\w+\.join\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)/g)) rootVars[m[1]] = path.posix.normalize(path.posix.join(dir, m[2]));
  for (const m of text.matchAll(/\brequire\(\s*\w+\.join\(\s*(\w+)\s*,\s*((?:['"][^'"]+['"]\s*,?\s*)+)\)\s*\)/g)) {
    const base = rootVars[m[1]];
    if (base == null) { problems.push(`${id}: require(path.join(${m[1]}, …)) cannot be resolved statically`); continue; }
    const parts = [...m[2].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    const p = path.posix.normalize(path.posix.join(base, ...parts)).replace(/^\.\//, '');
    if (!SOURCES.includes(p) && !EXTERNAL[p]) problems.push(`${id}: require(${p}) is not bundled`);
  }
  const dynamic = text.match(/\brequire\(\s*(?!['"]|\w+\.join\()/g);
  if (dynamic) problems.push(`${id}: a require() with a computed argument cannot be bundled`);
  return problems;
}

/* ───────────────────────────── the bundle ───────────────────────────── */

function build(root = ROOT) {
  const shimText = readLF(root, SHIM);
  delete require.cache[require.resolve(path.join(root, SHIM))];
  const shim = require(path.join(root, SHIM));
  const sources = SOURCES.map((p) => {
    const text = readLF(root, p);
    return { path: p, text, sha256: sha(text), bytes: Buffer.byteLength(text) };
  });
  const problems = sources.flatMap((s) => scan(s.path, s.text, shim));
  if (problems.length) { const e = new Error('build-browser: a source asks for something the shim does not provide:\n  ' + problems.join('\n  ')); e.problems = problems; throw e; }

  const width = Math.max(...SOURCES.map((p) => p.length)) + 2;
  const head = [
    '/* GENERATED FILE — do not edit by hand. Generator: protocol/build-browser.js · shim: protocol/browser-shim.js',
    ' * The repository\'s own protocol code for the browser (DESIGN D-12): each source below is embedded',
    ' * byte for byte as one module function, so verificacion.html runs exactly what the verifier runs.',
    ' * Sources (SHA-256 of the file bytes, LF line endings as stored in git):',
    ...sources.slice().sort((a, b) => (a.path < b.path ? -1 : 1)).map((s) => ' *   ' + s.path.padEnd(width) + s.sha256),
    ' *   ' + SHIM.padEnd(width) + sha(shimText) + '  (the shim)',
    ' * Load assets/gates.generated.js and assets/qwatt-gates.js first: the gate engine is not embedded.',
    ' * CI: node protocol/build-browser.js --check   (fails if this file differs from a fresh build)',
    ' */',
  ];
  const mods = sources.map((s) => {
    const body = /\.json$/.test(s.path)
      ? 'module.exports = ' + s.text.replace(/\n+$/, '') + ';\n'
      : s.text.replace(/\n*$/, '\n');
    return '  ' + JSON.stringify(s.path) + ': function (module, exports, require, __filename, __dirname, Buffer) {\n' +
      '/* ──── ' + s.path + ' (verbatim) ──── */\n' + body + '  }';
  });
  const meta = sources.map((s) => '    { path: ' + JSON.stringify(s.path) + ', sha256: ' + JSON.stringify(s.sha256) + ', bytes: ' + s.bytes + ' }');
  const text = [
    ...head,
    '(function (root) {',
    '  \'use strict\';',
    '',
    '  /* ──── protocol/browser-shim.js (verbatim) ──── */',
    '  var SHIM = (function () {',
    '    var module = { exports: {} };',
    shimText.replace(/\n+$/, ''),
    '    return module.exports;',
    '  })();',
    '',
    '  var MODULES = {',
    mods.join(',\n'),
    '  };',
    '  var EXTERNAL = ' + JSON.stringify(EXTERNAL) + ';',
    '  /* Node built-ins, by their node: names. */',
    '  var BUILTIN = { \'node:crypto\': SHIM.hash, \'node:path\': SHIM.path };',
    '  var cache = {};',
    '',
    '  /* require(): built-ins from the shim; \'./x\' and \'../x\' against the caller\'s directory (adding .js);',
    '     \'/repo/…\' paths (from path.join(__dirname, …)) stripped of \'/repo/\'; the gate engine and the spec',
    '     binding from page globals; anything else throws. Modules are cached. */',
    '  function resolve(fromDir, id) {',
    '    var key = id.indexOf(\'node:\') === 0 ? id : \'node:\' + id;',
    '    if (BUILTIN[key]) return { builtin: BUILTIN[key] };',
    '    var p = id;',
    '    if (p.indexOf(\'/repo/\') === 0) p = p.slice(6);',
    '    else if (/^\\.\\.?\\//.test(p)) p = SHIM.path.normalize(\'/repo/\' + fromDir + \'/\' + p).replace(/^\\/repo\\//, \'\');',
    '    else throw new Error(\'qwatt-protocol: \' + id + \' is not bundled\');',
    '    if (MODULES[p]) return { id: p };',
    '    if (MODULES[p + \'.js\']) return { id: p + \'.js\' };',
    '    if (EXTERNAL[p]) return { external: p };',
    '    throw new Error(\'qwatt-protocol: \' + id + \' is not bundled\');',
    '  }',
    '  function req(id) {',
    '    if (cache[id]) return cache[id].exports;',
    '    var dir = id.split(\'/\').slice(0, -1).join(\'/\');',
    '    var module = { exports: {} };',
    '    cache[id] = module;',
    '    var local = function (x) {',
    '      var r = resolve(dir, x);',
    '      if (r.builtin) return r.builtin;',
    '      if (r.external) {',
    '        var g = root[EXTERNAL[r.external]];',
    '        if (!g) throw new Error(\'qwatt-protocol: load \' + r.external + \' before qwatt-protocol.js\');',
    '        return g;',
    '      }',
    '      return req(r.id);',
    '    };',
    '    try { MODULES[id].call(module.exports, module, module.exports, local, \'/repo/\' + id, \'/repo/\' + dir, SHIM.Buffer); }',
    '    catch (e) { delete cache[id]; throw e; }',
    '    return module.exports;',
    '  }',
    '',
    '  if (!root.QWATT_GATES) throw new Error(\'qwatt-protocol: load assets/qwatt-gates.js before qwatt-protocol.js\');',
    '  if (!root.QWATT_GATES_SPEC) throw new Error(\'qwatt-protocol: load assets/gates.generated.js before qwatt-protocol.js\');',
    '  var interval = req(\'protocol/interval.schema.json\'), batch = req(\'protocol/batch.schema.json\'), reasons = req(\'protocol/reasons.json\');',
    '  var api = {',
    '    evidence: req(\'protocol/evidence.js\'),',
    '    verify: req(\'batch/verify.js\'),',
    '    schemaLite: req(\'protocol/schema-lite.js\'),',
    '    schemas: { interval: interval, batch: batch },',
    '    reasons: reasons,',
    '    versions: { spec: root.QWATT_GATES_SPEC.spec_version, interval_schema: interval[\'x-schema-version\'], batch_schema: batch[\'x-schema-version\'], reasons_registry: reasons.registry_version },',
    '    sources: [',
    meta.join(',\n'),
    '    ],',
    '    shim: { path: ' + JSON.stringify(SHIM) + ', sha256: ' + JSON.stringify(sha(shimText)) + ' },',
    '    sha256Impl: \'protocol/browser-shim.js (pure JavaScript, synchronous)\'',
    '  };',
    '  if (typeof module === \'object\' && module.exports) module.exports = api; else root.QWATT_PROTOCOL = api;',
    '}(typeof self !== \'undefined\' ? self : this));',
    '',
  ].join('\n');
  return { text, sources: sources.map(({ path: p, sha256, bytes }) => ({ path: p, sha256, bytes })) };
}

/* ───────────────────────────── smoke test ───────────────────────────── */

/** The two 8 Oct rehearsal batches, built in Node with the repository's assembler (the inputs of anchor/rehearse.js). */
function rehearsalBatches(root) {
  const E = require(path.join(root, 'protocol/evidence.js'));
  const V = require(path.join(root, 'batch/verify.js'));
  const { BatchAssembler } = require(path.join(root, 'batch/assemble.js'));
  const T0 = Date.parse('2026-09-20T15:00:00Z'), DT = 300;
  const iv = (i) => {
    const t = T0 + i * DT * 1000;
    const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
    return { spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION, site_id: 'rehearsal', node_id: 'rehearsal', seq: i,
      ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
      meters: { a: m('pzem-017:1', 100), b: m('epever-tracer:2', 99) }, source: { adapter: 'simulator', raw_sha256: E.sha256('rehearsal-' + i) } };
  };
  const a = new BatchAssembler({ site_id: 'rehearsal', node_id: 'rehearsal' });
  const out = [];
  for (let b = 0; b < 2; b++) { for (let i = 0; i < 12; i++) a.judge(iv(b * 12 + i)); out.push(a.close().batch); }
  return out;
}

function smoke(text, root = ROOT) {
  const ctx = { TextEncoder, TextDecoder, atob, btoa, console: { log() {}, warn() {}, error() {} } };
  ctx.QWATT_GATES = require(path.join(root, 'assets/qwatt-gates.js'));
  ctx.QWATT_GATES_SPEC = require(path.join(root, 'assets/gates.generated.js'));
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(text, ctx, { filename: OUT });
  const P = ctx.QWATT_PROTOCOL;
  if (!P || !P.evidence || !P.verify) throw new Error('smoke: the bundle did not define QWATT_PROTOCOL');
  if (P.evidence.EMPTY_ROOT !== sha('')) throw new Error('smoke: EMPTY_ROOT differs from SHA-256 of the empty string');
  const batches = rehearsalBatches(root);
  batches.forEach((b, i) => {
    const got = P.evidence.batchSha256(JSON.parse(JSON.stringify(b)));
    if (got !== REHEARSAL[i]) throw new Error(`smoke: rehearsal batch ${i} hashes to ${got}, anchored ${REHEARSAL[i]}`);
    const v = P.verify.verifyBatch(JSON.parse(JSON.stringify(b)), { prev: i ? JSON.parse(JSON.stringify(batches[i - 1])) : null });
    if (!v.ok) throw new Error(`smoke: rehearsal batch ${i} does not verify in the bundle: ${v.failures.map((f) => f.code).join(', ')}`);
  });
  return P;
}

/* ───────────────────────────── CLI ───────────────────────────── */

if (require.main === module) {
  const check = process.argv.includes('--check');
  let fresh;
  try { fresh = build(ROOT); smoke(fresh.text); } catch (e) { console.error(e.message); process.exit(1); }
  const size = Buffer.byteLength(fresh.text);
  if (size > BUDGET) { console.error(`build-browser: ${OUT} would be ${size} bytes, over the ${BUDGET}-byte budget (DESIGN §13.4)`); process.exit(1); }
  const outFile = path.join(ROOT, OUT);
  if (check) {
    if (!fs.existsSync(outFile)) { console.error(`build-browser --check: ${OUT} is missing → run node protocol/build-browser.js`); process.exit(1); }
    const have = readLF(ROOT, OUT).split('\n'), want = fresh.text.split('\n');
    const i = have.findIndex((l, k) => l !== want[k]);
    if (i >= 0 || have.length !== want.length) {
      const n = i >= 0 ? i : Math.min(have.length, want.length);
      console.error(`build-browser --check: ${OUT} differs from a fresh build at line ${n + 1}\n  committed: ${JSON.stringify((have[n] || '').slice(0, 100))}\n  fresh:     ${JSON.stringify((want[n] || '').slice(0, 100))}\n  → run node protocol/build-browser.js and commit the result`);
      process.exit(1);
    }
    console.log(`build-browser --check: ${OUT} equals a fresh build of ${SOURCES.length} sources (${size} bytes); bundle smoke test passed (EMPTY_ROOT, rehearsal 322923a4… and 852314a2…)`);
  } else {
    fs.writeFileSync(outFile, fresh.text);
    console.log(`build-browser: wrote ${OUT} (${size} bytes) from ${SOURCES.join(', ')}`);
  }
}

module.exports = { build, smoke, scan, SOURCES, EXTERNAL, OUT };
