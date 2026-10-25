#!/usr/bin/env node
/**
 * QWATT site — the protocol runs in the browser as the same code, with the same results
 * ---------------------------------------------------------------------------
 * verificacion.html re-derives published batches in the visitor's browser with
 * assets/qwatt-protocol.js, a generated wrapper around protocol/evidence.js,
 * protocol/schema-lite.js and batch/verify.js (DESIGN.md D-12, §9.2). These checks
 * prove, in Node and offline, that the wrapper cannot disagree with the modules it
 * wraps, and that the verification checklist built on it says what it should:
 *
 *   1. the pure-JavaScript SHA-256 and Buffer of protocol/browser-shim.js equal
 *      node:crypto and Node's Buffer on NIST vectors, a million "a" fed in uneven
 *      chunks, every length 0–300 and 2,000 seeded random inputs;
 *   2. the committed build equals a fresh build, loads in a bare context (no
 *      require, Buffer or crypto), and gives the Node modules' answers for
 *      canonical, merkleRoot, batchSha256 and verifyBatch on the conformance chain
 *      and on every batch of both sample feeds, tampered or not;
 *   3. assets/qwatt-verify-steps.js gives identical rows with the browser build and
 *      with the Node modules, the default case matches its pinned states, and each
 *      tamper mode turns red exactly the rows DESIGN §9.5 names;
 *   4. no row, change summary or provenance string carries a batch_id, site_id or
 *      node_id value (D-17), and assets/qwatt-feed.js hands renderers none either.
 *
 * Horizon is never called: row 10 gets trimmed real testnet responses from
 * ops/fixtures/abcd/horizon/ through assets/qwatt-live.js with fetch stubbed.
 * Run: node ops/protocol-browser.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const rel = (p) => path.join(ROOT, p);
const readLF = (p) => fs.readFileSync(rel(p), 'utf8').replace(/\r\n/g, '\n');
const exists = (p) => fs.existsSync(rel(p));

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(JSON.stringify(a) === JSON.stringify(b), `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function need(p) { if (!exists(p)) throw new Error(`${p} is missing (group D builds it)`); return require(rel(p)); }

const FEEDS = ['ensayo-8oct', 'muestra'];
const REHEARSAL_SHA = ['322923a411c146079b73269fe3135d9e6413a9dafdb07807567c8a119f35a245', '852314a2a11f86548e3f8b09c16aa2fd6ef82ae8e8641db5ef20a4bc2d0f5466'];
const ROLES = { proposer: 'GDO5EL2AB4A5REHWU7AG5FTZWLMBKOKBECZRJBJC4MXTB674XONKR3FI', verifier: 'GDWN3AOGMNUS2ZFRBEW3I2SYJMU67FUAFMTMCLAODTUUVRW7VSG5TG53', third: 'GDWVD7H2CKN3S2XZ756I7EITTQF2J3FBBFAMRL3RHBDRALEVOMNRF3I2' };
const ABCD_ACCOUNT = 'GAYA2PZSQJTHHXZPB2ZD6LO3C75GOLSI3T4PZNSSYOEL4FNWFK27CYET';
const HZ = 'https://horizon-testnet.stellar.org';

/* ───────────────────────────── helpers ───────────────────────────── */

/** Seeded PRNG (mulberry32), so every random input is the same on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const nodeSha = (data, enc) => nodeCrypto.createHash('sha256').update(data, enc).digest('hex');

/** The Node modules, in the shape of window.QWATT_PROTOCOL. */
function nodeApi() {
  const E = require(rel('protocol/evidence.js'));
  const V = require(rel('batch/verify.js'));
  const SL = require(rel('protocol/schema-lite.js'));
  return {
    evidence: E, verify: V, schemaLite: SL,
    schemas: { interval: require(rel('protocol/interval.schema.json')), batch: require(rel('protocol/batch.schema.json')) },
    reasons: require(rel('protocol/reasons.json')),
  };
}

/** Load the generated build in a context that has no require, no Buffer, no crypto and no process. */
function bareBuild(withGates = true) {
  const text = readLF('assets/qwatt-protocol.js');
  const ctx = { TextEncoder, TextDecoder, atob, btoa, console: { log() {}, warn() {}, error() {} } };
  if (withGates) {
    ctx.QWATT_GATES = require(rel('assets/qwatt-gates.js'));
    ctx.QWATT_GATES_SPEC = require(rel('assets/gates.browser.js'));   // the binding the pages load
  }
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(text, ctx, { filename: 'assets/qwatt-protocol.js' });
  return ctx;
}

/** fetch() over the committed files, as a static server would answer. */
function fileFetch(url) {
  const u = String(url);
  if (!u.startsWith('/')) return Promise.reject(new Error('fileFetch: only same-origin paths, got ' + u));
  const f = rel(u.split('?')[0].replace(/^\//, ''));
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => { throw new Error('404'); } });
  const body = fs.readFileSync(f);
  return Promise.resolve({ ok: true, status: 200, text: async () => body.toString('utf8'), json: async () => JSON.parse(body.toString('utf8')), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) });
}

/** QWATT_LIVE with Horizon answered from ops/fixtures (trimmed real testnet responses). */
function liveFromFixtures() {
  const FXA = (n) => JSON.parse(fs.readFileSync(rel('ops/fixtures/abcd/horizon/' + n), 'utf8'));
  const FXH = (n) => JSON.parse(fs.readFileSync(rel('ops/fixtures/horizon/' + n), 'utf8'));
  const routes = [
    [new RegExp('^' + HZ + '/accounts/' + ABCD_ACCOUNT + '/operations\\?'), () => FXA('ops-abcd.json')],
    [new RegExp('^' + HZ + '/accounts/' + ABCD_ACCOUNT + '$'), () => FXH('account-abcd.json')],
    [new RegExp('^' + HZ + '/transactions/494e8d12[0-9a-f]+$'), () => FXA('tx-c.json')],
    [new RegExp('^' + HZ + '/transactions/9851ba7e[0-9a-f]+$'), () => FXA('tx-l.json')],
    [new RegExp('^' + HZ + '/$'), () => FXH('root.json')],
  ];
  const stub = (url) => {
    const r = routes.find(([re]) => re.test(String(url)));
    if (!r) return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
    const body = r[1]();
    return Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  };
  for (const k of ['qwatt-live.js', 'qwatt-reconcile.js']) delete require.cache[require.resolve(rel('assets/' + k))];
  globalThis.fetch = stub;
  globalThis.QWATT_RECONCILE = require(rel('assets/qwatt-reconcile.js'));
  const L = require(rel('assets/qwatt-live.js'));
  L._reset();
  return L;
}

/** Everything the page gathers for one batch: the feed (same origin) and, when anchored, Stellar testnet. */
async function inputFor(F, feedId, seq, opts = {}) {
  const feed = await F.open('/evidence/feeds/' + feedId + '/', { fetch: fileFetch });
  const input = await feed.input(seq);
  if (opts.stellar) input.stellar = opts.stellar;
  return { feed, input };
}

async function stellarFor(L, manifest) {
  const A = manifest.anchoring;
  const anchors = await L.anchors(A.account);
  const txs = {};
  for (const a of anchors) txs[a.txHash] = await L.tx(a.txHash);
  const account = await L.account(A.account);
  return { state: 'ok', anchors, txs, account, roles: A.signers };
}

function deps(P, opts = {}) {
  const E = exists('assets/qwatt-envelope.js') ? require(rel('assets/qwatt-envelope.js')) : null;
  return { P, webcrypto: opts.noWebcrypto ? null : nodeCrypto.webcrypto.subtle, signedBy: opts.noEd25519 ? null : (E && E.signedBy) || null };
}

const states = (rows) => rows.map((r) => r.n + ':' + r.state).join(' ');
const red = (rows) => rows.filter((r) => r.state === 'fail').map((r) => r.n);
const codesOf = (rows) => { const r9 = rows.find((r) => r.n === 9); return r9 && Array.isArray(r9.codes) ? r9.codes.slice().sort() : []; };
/* semver a >= b */
const vgte = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return true; };
/* DESIGN FD-13: under an engine whose batch schema is 1.1.0 or later, a batch without samples_root (the 8 Oct
   rehearsal, schema 1.0.0) gets no full engine verdict: row 9 does not apply, every other row is still judged. */
const ENGINE_SCHEMA = require(rel('batch/verify.js')).BATCH_SCHEMA_VERSION;
const fd13 = (obj) => !Object.prototype.hasOwnProperty.call(obj, 'samples_root') && vgte(ENGINE_SCHEMA, '1.1.0');

/** Every batch_id / site_id / node_id value in a feed directory. */
function idValues(feedId) {
  const dir = rel('evidence/feeds/' + feedId);
  const ids = { batch: new Set(), exact: new Set() };
  const add = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(add); return; }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'batch_id' && typeof v === 'string') ids.batch.add(v);
      else if ((k === 'site_id' || k === 'node_id' || k === 'latest_batch_id') && typeof v === 'string') ids.exact.add(v);
      else add(v);
    }
  };
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.jsonl$/.test(e.name)) fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).forEach((l) => add(JSON.parse(l)));
      else if (/\.json$/.test(e.name) && e.name !== 'feed.json') add(JSON.parse(fs.readFileSync(f, 'utf8')));
    }
  })(dir);
  return ids;
}
/** Fails when any string or key in `out` carries an id value or an id key name. */
function noIds(out, ids, where) {
  (function walk(o, p) {
    if (typeof o === 'string') {
      for (const b of ids.batch) assert(!o.includes(b), `${where}: ${p} carries the batch id ${b}`);
      assert(!ids.exact.has(o), `${where}: ${p} is the id value "${o}"`);
      assert(!/\b(batch_id|site_id|node_id)\b/.test(o), `${where}: ${p} names an id field`);
      return;
    }
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      assert(!['batch_id', 'site_id', 'node_id', 'latest_batch_id'].includes(k), `${where}: key ${p}.${k}`);
      walk(v, p + '.' + k);
    }
  })(out, '$');
}

/* ═════════════════════════ 1. the shim ═════════════════════════ */

test('shim: SHA-256 equals node:crypto on NIST vectors and multi-byte UTF-8', () => {
  const S = need('protocol/browser-shim.js');
  const h = (d, enc) => S.hash.createHash('sha256').update(d, enc).digest('hex');
  const vectors = ['', 'abc', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
    'Energía solar medida · verificable por cualquiera ✓', '日本語のテキスト', '𝄞 emoji 🌞⚡ and a lone é', 'a\u0000b￿'];
  for (const v of vectors) eq(h(v), nodeSha(v, 'utf8'), JSON.stringify(v).slice(0, 40));
  eq(h('abc', 'utf8'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'NIST "abc"');
  eq(h('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', 'NIST 448-bit');
});

test('shim: one million "a" fed in uneven chunks, and every length 0–300 of a seeded byte stream', () => {
  const S = need('protocol/browser-shim.js');
  const hh = S.hash.createHash('sha256');
  const r = rng(7);
  let left = 1000000;
  while (left > 0) { const n = Math.min(left, 1 + Math.floor(r() * 9000)); hh.update('a'.repeat(n)); left -= n; }
  eq(hh.digest('hex'), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0', 'one million "a"');
  const bytes = new Uint8Array(300); for (let i = 0; i < 300; i++) bytes[i] = Math.floor(r() * 256);
  for (let n = 0; n <= 300; n++) {
    const part = bytes.subarray(0, n);
    eq(S.hash.createHash('sha256').update(part).digest('hex'), nodeSha(Buffer.from(part)), `length ${n}`);
  }
});

test('shim: 2,000 seeded random strings and byte arrays, fed whole and in pieces', () => {
  const S = need('protocol/browser-shim.js');
  const r = rng(2026);
  const alphabet = 'abcXYZ019 ·áéñ✓€𝄞🌞\n\t"\\{}';
  for (let i = 0; i < 2000; i++) {
    if (i % 2) {
      const n = Math.floor(r() * 400), b = new Uint8Array(n);
      for (let j = 0; j < n; j++) b[j] = Math.floor(r() * 256);
      const cut = Math.floor(r() * (n + 1));
      eq(S.hash.createHash('sha256').update(b.subarray(0, cut)).update(b.subarray(cut)).digest('hex'), nodeSha(Buffer.from(b)), `bytes #${i}`);
    } else {
      let s = ''; const n = Math.floor(r() * 120);
      for (let j = 0; j < n; j++) s += Array.from(alphabet)[Math.floor(r() * Array.from(alphabet).length)];
      eq(S.hash.createHash('sha256').update(s, 'utf8').digest('hex'), nodeSha(s, 'utf8'), `string #${i}`);
    }
  }
});

test('shim: Buffer does what the protocol sources ask of it, and nothing else', () => {
  const { Buffer: B } = need('protocol/browser-shim.js');
  const s = 'QWATT · Energía ✓ 🌞';
  eq(B.from(s, 'utf8').toString('hex'), Buffer.from(s, 'utf8').toString('hex'), 'from utf8 → hex');
  eq(B.from(s).toString('utf8'), s, 'utf8 round trip');
  eq(B.from('00ff10ab', 'hex').toString('hex'), '00ff10ab', 'hex round trip');
  eq(B.from('UVcjMA==', 'base64').toString('utf8'), 'QW#0', 'base64 → utf8');
  eq(B.from('QW#0', 'utf8').toString('base64'), 'UVcjMA==', 'utf8 → base64');
  const b = B.from([1, 2, 3]);
  assert(b instanceof Uint8Array && B.isBuffer(b) && !B.isBuffer(new Uint8Array(1)), 'Uint8Array subclass, isBuffer');
  assert(B.isBuffer(b.subarray(1)), 'subarray keeps the subclass');
  eq(Array.from(B.alloc(7, B.from([9, 8]))), [9, 8, 9, 8, 9, 8, 9], 'alloc repeats the fill bytes');
  eq(Array.from(B.alloc(3, 5)), [5, 5, 5], 'alloc with a number');
  eq(Array.from(B.alloc(2)), [0, 0], 'alloc zero-filled');
  assert(B.from('ab', 'hex').equals(B.from([0xab])), 'equals');
  let threw = false; try { B.from('x', 'latin1'); } catch (e) { threw = true; } assert(threw, 'an unsupported encoding throws');
  threw = false; try { B.from('abc', 'hex'); } catch (e) { threw = true; } assert(threw, 'odd-length hex throws');
});

test('shim: only SHA-256, and only utf8 strings or bytes; path.join is POSIX', () => {
  const S = need('protocol/browser-shim.js');
  let threw = false; try { S.hash.createHash('md5'); } catch (e) { threw = true; } assert(threw, 'md5 throws');
  threw = false; try { S.hash.createHash('sha256').update('x', 'hex'); } catch (e) { threw = true; } assert(threw, 'update(…, hex) throws');
  threw = false; try { S.hash.createHash('sha256').digest('base64'); } catch (e) { threw = true; } assert(threw, 'digest(base64) throws');
  eq(S.path.join('/repo/batch', '..'), '/repo', 'join ..');
  eq(S.path.join('/repo', 'assets', 'qwatt-gates.js'), '/repo/assets/qwatt-gates.js', 'join parts');
  eq(S.path.normalize('/repo/./protocol//x/../evidence.js'), '/repo/protocol/evidence.js', 'normalize');
});

/* ═════════════════════════ 2. the build ═════════════════════════ */

test('build: assets/qwatt-protocol.js equals a fresh build of the sources', () => {
  const B = need('protocol/build-browser.js');
  assert(exists('assets/qwatt-protocol.js'), 'assets/qwatt-protocol.js is missing: run node protocol/build-browser.js');
  const fresh = B.build(ROOT);
  const lines = readLF('assets/qwatt-protocol.js').split('\n'), want = fresh.text.split('\n');
  const i = lines.findIndex((l, k) => l !== want[k]);
  assert(i < 0 && lines.length === want.length, `first difference at line ${i + 1}: run node protocol/build-browser.js`);
});

test('build: the header and api.sources name every embedded source with the SHA-256 of its bytes as stored in git', () => {
  const ctx = bareBuild();
  const P = ctx.QWATT_PROTOCOL;
  const want = ['protocol/evidence.js', 'protocol/schema-lite.js', 'batch/verify.js', 'protocol/interval.schema.json', 'protocol/batch.schema.json', 'protocol/reasons.json'];
  eq(P.sources.map((s) => s.path), want, 'sources');
  const head = readLF('assets/qwatt-protocol.js').split('\n').slice(0, 20).join('\n');
  for (const s of P.sources) {
    const lf = readLF(s.path);
    eq(s.sha256, nodeSha(lf, 'utf8'), s.path + ' sha256');
    eq(s.bytes, Buffer.byteLength(lf), s.path + ' bytes');
    assert(head.includes(s.sha256), `header lists ${s.path} ${s.sha256.slice(0, 8)}…`);
  }
  const text = readLF('assets/qwatt-protocol.js');
  for (const s of want.filter((p) => /\.js$/.test(p))) assert(text.includes(readLF(s)), `${s} is embedded byte for byte`);
});

test('build: runs in a bare context with no require, Buffer, crypto or process', () => {
  const ctx = bareBuild();
  for (const g of ['require', 'Buffer', 'process', 'module']) assert(!(g in ctx) || ctx[g] === undefined, `${g} leaked into the context`);
  const P = ctx.QWATT_PROTOCOL;
  assert(P && P.evidence && P.verify && P.schemaLite && P.reasons, 'QWATT_PROTOCOL exposes evidence, verify, schemaLite, reasons');
  eq(P.evidence.EMPTY_ROOT, nodeSha('', 'utf8'), 'EMPTY_ROOT');
  eq(P.evidence.EMPTY_ROOT, require(rel('protocol/conformance/batch-cases.json')).empty_root, 'EMPTY_ROOT = batch-cases.json');
  eq(P.versions.batch_schema, require(rel('protocol/batch.schema.json'))['x-schema-version'], 'versions.batch_schema');
  eq(P.versions.interval_schema, require(rel('protocol/interval.schema.json'))['x-schema-version'], 'versions.interval_schema');
  eq(P.versions.spec, require(rel('assets/gates.browser.js')).spec_version, 'versions.spec');
  assert(!('Buffer' in ctx) && !('QWATT_SHIM' in ctx), 'the build defines no global Buffer');
});

test('build: without the gate engine it says which file to load first', () => {
  let msg = '';
  try { const ctx = bareBuild(false); void ctx.QWATT_PROTOCOL.verify.SPEC; } catch (e) { msg = e.message; }
  assert(/load assets\/qwatt-gates\.js before qwatt-protocol\.js/.test(msg), 'expected "load assets/qwatt-gates.js before qwatt-protocol.js", got: ' + msg);
});

test('build: canonical, merkleRoot and batchSha256 equal Node on the conformance chain and its pinned hashes', () => {
  const P = bareBuild().QWATT_PROTOCOL, N = nodeApi();
  const cases = require(rel('protocol/conformance/batch-cases.json'));
  const { BatchAssembler } = require(rel('batch/assemble.js'));
  const site = cases.batches[0].batch_id.replace(/-\d{6}$/, '');
  const T0 = Date.parse('2026-09-20T15:00:00Z'), DT = 300;
  const iv = (i, aW = 100, bW = 99) => {
    const t = T0 + i * DT * 1000;
    const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
    return { spec_version: N.verify.SPEC.spec_version, schema_version: N.verify.INTERVAL_SCHEMA_VERSION, site_id: site, node_id: 'test-node', seq: i,
      ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
      meters: { a: m('pzem-017:1', aW), b: m('epever-tracer:2', bW) }, source: { adapter: 'simulator', raw_sha256: N.evidence.sha256('raw-' + i) } };
  };
  const a = new BatchAssembler({ site_id: site, node_id: 'test-node' });
  const chain = [];
  const raw = (i) => [{ n: 1, utf8: 'raw-' + i }];   // the payload of interval i (batch-cases.json); a 1.0.0 assembler ignores it
  for (let b = 0; b < 3; b++) { for (let i = 0; i < 12; i++) { const k = b * 12 + i; a.judge(i === 5 ? iv(k, 100, 60) : iv(k), raw(k)); } chain.push(a.close().batch); }
  chain.forEach((b, i) => {
    eq(b.sha256, cases.batches[i].sha256, `Node reproduces pinned batch ${i}`);
    eq(P.evidence.canonical(b), N.evidence.canonical(b), `canonical #${i}`);
    eq(P.evidence.merkleRoot(b.intervals), b.intervals_root, `merkleRoot #${i}`);
    eq(P.evidence.batchSha256(b), cases.batches[i].sha256, `batchSha256 #${i}`);
    eq(P.verify.verifyBatch(b, { prev: chain[i - 1] || null }), N.verify.verifyBatch(b, { prev: chain[i - 1] || null }), `verifyBatch #${i}`);
  });
});

test('build: every batch of both sample feeds hashes and verifies exactly as in Node, with its real context', async () => {
  const P = bareBuild().QWATT_PROTOCOL, N = nodeApi();
  const F = need('assets/qwatt-feed.js');
  for (const id of FEEDS) {
    const feed = await F.open('/evidence/feeds/' + id + '/', { fetch: fileFetch });
    assert(feed.entries.length > 0, id + ': no batches');
    for (const e of feed.entries) {
      const input = await feed.input(e.seq);
      const b = input.batch.obj;
      eq(P.evidence.canonical(b), N.evidence.canonical(b), `${id} #${e.seq} canonical`);
      eq(P.evidence.merkleRoot(b.intervals), N.evidence.merkleRoot(b.intervals), `${id} #${e.seq} merkleRoot`);
      eq(P.evidence.batchSha256(b), b.sha256, `${id} #${e.seq} batchSha256`);
      const ctx = { prev: input.context.prev, floor: input.context.floor, rejected: input.rejected, status: e.status };
      eq(P.verify.verifyBatch(b, ctx), N.verify.verifyBatch(b, ctx), `${id} #${e.seq} verifyBatch`);
    }
  }
});

test('build: the rehearsal feed is the anchored data (322923a4… and 852314a2…)', async () => {
  const F = need('assets/qwatt-feed.js');
  const feed = await F.open('/evidence/feeds/ensayo-8oct/', { fetch: fileFetch });
  eq(feed.entries.map((e) => e.sha256), REHEARSAL_SHA, 'ledger hashes');
  const P = bareBuild().QWATT_PROTOCOL;
  for (const e of feed.entries) eq(P.evidence.batchSha256((await feed.batch(e.seq)).obj), REHEARSAL_SHA[e.seq], 'recomputed #' + e.seq);
});

test('build: under 100 KB, unminified (no line over 5,000 characters), no SDK markers', () => {
  const t = readLF('assets/qwatt-protocol.js');
  assert(Buffer.byteLength(t) <= 100 * 1024, `qwatt-protocol.js is ${Buffer.byteLength(t)} bytes`);
  t.split('\n').forEach((l, i) => assert(l.length <= 5000, `line ${i + 1} has ${l.length} characters`));
  for (const mk of ['eval(', 'new Function(', 'StellarSdk', '__webpack_require__']) assert(!t.includes(mk), 'contains ' + mk);
});

/* ═════════════════════════ 3. feed reader and checklist ═════════════════════════ */

test('feed reader: entries, index, refusals and the manifest carry no batch_id, site_id or node_id', async () => {
  const F = need('assets/qwatt-feed.js');
  for (const id of FEEDS) {
    const ids = idValues(id);
    const feed = await F.open('/evidence/feeds/' + id + '/', { fetch: fileFetch });
    noIds({ entries: feed.entries, index: feed.index, manifest: feed.manifest, run: feed.run }, ids, id + ' open()');
    for (const e of feed.entries) {
      noIds(await feed.refusals(e.seq), ids, `${id} refusals(${e.seq})`);
      const input = await feed.input(e.seq);
      noIds({ seq: input.seq, status: input.status, reasons: input.reasons, statuses: input.statuses, anchored: input.anchored }, ids, `${id} input(${e.seq}) summary`);
    }
  }
});

test('feed reader: a missing feed or file is an error the page can name, never a crash', async () => {
  const F = need('assets/qwatt-feed.js');
  let err = null;
  try { await F.open('/evidence/feeds/no-such-feed/', { fetch: fileFetch }); } catch (e) { err = e; }
  assert(err && err.code === 'feed-missing', 'open() of a missing feed rejects with code feed-missing');
  const feed = await F.open('/evidence/feeds/ensayo-8oct/', { fetch: fileFetch });
  eq(await feed.raw(0), null, 'raw() of a 1.0.0 feed without raw files is null');
});

test('steps: browser build and Node modules give identical rows for every batch of both feeds', async () => {
  const St = need('assets/qwatt-verify-steps.js'), F = need('assets/qwatt-feed.js');
  const Pb = bareBuild().QWATT_PROTOCOL, Pn = nodeApi();
  for (const id of FEEDS) {
    const feed = await F.open('/evidence/feeds/' + id + '/', { fetch: fileFetch });
    for (const e of feed.entries) {
      const input = await feed.input(e.seq);
      const a = await St.run(input, deps(Pb)), b = await St.run(input, deps(Pn));
      eq(a, b, `${id} #${e.seq}`);
      eq(a.map((r) => r.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], `${id} #${e.seq} ten rows in order`);
    }
  }
});

test('steps: the default case (8 Oct rehearsal, batch #1) matches its pinned states', async () => {
  const St = need('assets/qwatt-verify-steps.js'), F = need('assets/qwatt-feed.js');
  const L = liveFromFixtures();
  const P = bareBuild().QWATT_PROTOCOL;
  const { feed, input } = await inputFor(F, 'ensayo-8oct', 1);
  input.stellar = await stellarFor(L, feed.manifest);
  const rows = await St.run(input, deps(P));
  eq(states(rows), '1:ok 2:ok 3:ok 4:ok 5:na 6:ok 7:ok 8:ok ' + (fd13(input.batch.obj) ? '9:na' : '9:ok') + ' 10:ok', 'rows');
  const r10 = rows.find((r) => r.n === 10);
  eq(r10.anchor && r10.anchor.memoShown, 'QW#1', 'anchor memo (masked to QW#n)');
  eq(r10.anchor && r10.anchor.ledger, 5093765, 'anchor ledger');
  eq((r10.signers || []).slice().sort(), ['third', 'verifier'], 'signers identified by Ed25519 (test L)');
  eq(r10.thresholds, '1/2/3', 'thresholds read now');
  assert(r10.pair === 'third+verifier', 'pair named, so the page can say what reconciliation would call it');
  const r6 = rows.find((r) => r.n === 6);
  eq(r6.recomputed, REHEARSAL_SHA[1], 'row 6 recomputed fingerprint');
  eq(r6.webcrypto, REHEARSAL_SHA[1], 'row 6 WebCrypto fingerprint');
  const s = St.summary(rows);
  eq([s.ok, s.na, s.fail, s.total], fd13(input.batch.obj) ? [8, 2, 0, 10] : [9, 1, 0, 10], 'summary');
});

test('steps: QW#0 is proposer + verifier (test C); a browser without Ed25519 shows the count, not a guess', async () => {
  const St = need('assets/qwatt-verify-steps.js'), F = need('assets/qwatt-feed.js');
  const L = liveFromFixtures();
  const P = nodeApi();
  const { feed, input } = await inputFor(F, 'ensayo-8oct', 0);
  input.stellar = await stellarFor(L, feed.manifest);
  let r10 = (await St.run(input, deps(P))).find((r) => r.n === 10);
  eq(r10.state, 'ok', 'QW#0 row state');
  eq((r10.signers || []).slice().sort(), ['proposer', 'verifier'], 'QW#0 signers');
  r10 = (await St.run(input, deps(P, { noEd25519: true }))).find((r) => r.n === 10);
  eq(r10.state, 'ok', 'without Ed25519 the anchor still matches');
  eq(r10.signers, null, 'without Ed25519 no roles are claimed');
  eq(r10.signatureCount, 2, 'the signature count is shown instead');
  assert(r10.noEd25519 === true, 'and the row says why');
});

test('steps: Horizon offline → row 10 offline, rows 1–9 unchanged; an unanchored feed → row 10 does not apply', async () => {
  const St = need('assets/qwatt-verify-steps.js'), F = need('assets/qwatt-feed.js');
  const P = nodeApi();
  const { input } = await inputFor(F, 'ensayo-8oct', 1);
  const wait = await St.run(Object.assign({}, input, { stellar: { state: 'wait' } }), deps(P));
  const off = await St.run(Object.assign({}, input, { stellar: { state: 'offline' } }), deps(P));
  eq(states(off).replace('10:offline', ''), states(wait).replace('10:wait', ''), 'rows 1–9 do not depend on Horizon');
  eq(off[9].state, 'offline', 'row 10 offline');
  const m = await inputFor(F, 'muestra', 2);
  eq((await St.run(m.input, deps(P)))[9].state, 'na', 'muestra is not anchored');
  const noWc = await St.run(Object.assign({}, input, { stellar: { state: 'wait' } }), deps(P, { noWebcrypto: true }));
  eq(noWc[5].state, 'ok', 'without WebCrypto row 6 still judges with the repository code');
  eq(noWc[5].webcrypto, null, 'and shows the second computation as not applicable');
});

test('steps: a batch published as refused is "refused with a reason, as published" and carries the total forward', async () => {
  const St = need('assets/qwatt-verify-steps.js'), F = need('assets/qwatt-feed.js');
  const P = nodeApi();
  const feed = await F.open('/evidence/feeds/muestra/', { fetch: fileFetch });
  const refused = feed.entries.filter((e) => e.status === 'rejected');
  eq(refused.map((e) => e.seq), [6], 'muestra publishes batch 6 as refused');
  eq(refused[0].reasons, ['batch.site_mismatch'], 'with batch.site_mismatch');
  const rows = await St.run(await feed.input(6), deps(P));
  eq(rows[8].state, 'ok', 'row 9 judges the refusal as published');
  assert(rows[8].asPublished === 'rejected', 'row 9 knows it reads a refused batch');
  eq(rows[7].state, 'ok', 'row 8: the total is carried forward');
  const t = rows[7].table;
  const r6 = t.find((x) => x.seq === 6), r5 = t.find((x) => x.seq === 5);
  eq(r6.expected, r5.expected, 'row 8: batch 6 adds nothing');
});

test('steps: every batch of both feeds is all green apart from rows that do not apply', async () => {
  const St = need('assets/qwatt-verify-steps.js'), F = need('assets/qwatt-feed.js');
  const P = nodeApi();
  for (const id of FEEDS) {
    const feed = await F.open('/evidence/feeds/' + id + '/', { fetch: fileFetch });
    for (const e of feed.entries) {
      const rows = await St.run(await feed.input(e.seq), deps(P));
      eq(red(rows), [], `${id} #${e.seq} has red rows: ${states(rows)}`);
    }
  }
});

/* The tamper table of DESIGN §9.5: rows that must turn red, plus 7 when a later batch exists and 10 when the feed is anchored. */
const TAMPER = {
  energy: { rows: [4, 6, 9], codes: ['batch.hash_mismatch', 'batch.root_mismatch'], seven: true },
  prev: { rows: [6, 7, 9], codes: ['batch.chain_break', 'batch.hash_mismatch'], seven: false },
  total: { rows: [6, 8, 9], codes: ['batch.cumulative_mismatch', 'batch.hash_mismatch'], seven: true },
  time: { rows: [3, 4, 6, 9], codes: ['batch.hash_mismatch', 'batch.interval_off_grid', 'batch.root_mismatch'], seven: true },
  forger: { rows: [], codes: [], seven: true },
};

test('steps: tamper table — each mode turns red exactly the rows of DESIGN §9.5, on every batch of both feeds', async () => {
  const St = need('assets/qwatt-verify-steps.js'), F = need('assets/qwatt-feed.js');
  const L = liveFromFixtures();
  const P = nodeApi();
  for (const id of FEEDS) {
    const feed = await F.open('/evidence/feeds/' + id + '/', { fetch: fileFetch });
    const stellar = feed.manifest.anchoring ? await stellarFor(L, feed.manifest) : null;
    for (const e of feed.entries) {
      const input = await feed.input(e.seq);
      if (stellar) input.stellar = stellar;
      const base = await St.run(input, deps(P));
      const hasNext = !!input.next;
      /* batch schema 1.1.0 (week 2): samples_root binds the raw lines by interval start, so a changed time also breaks row 5 */
      const is11 = Object.prototype.hasOwnProperty.call(input.batch.obj, 'samples_root');
      for (const [mode, want] of Object.entries(TAMPER)) {
        const t = St.tamper(input, mode, deps(P));
        assert(!t.disabled, `${id} #${e.seq} ${mode} is available`);
        const rows = await St.run(t.input, deps(P));
        let expect = want.rows.slice();
        if (mode === 'time' && is11) expect.push(5);
        const noVerdict = fd13(input.batch.obj);
        if (want.seven && hasNext) expect.push(7);
        if (input.anchored && e.status === 'accepted') expect.push(10);
        /* a forgery that adds energy at night is caught by the filters too: allowed only where the batch has no daylight */
        const nightForgery = mode === 'forger' && rows[2].state === 'fail';
        if (nightForgery) expect.push(3, 9);
        if (e.status === 'rejected' && mode !== 'forger') expect = expect.filter((n) => n !== 8 || mode === 'total');
        if (noVerdict) expect = expect.filter((n) => n !== 9);
        expect = [...new Set(expect)].sort((x, y) => x - y);
        eq(red(rows), expect, `${id} #${e.seq} (${e.status}) ${mode}`);
        /* the first batch has no previous one: a changed prev_hash breaks the genesis rule instead of a link */
        const codes = mode === 'prev' && e.seq === 0 ? want.codes.map((c) => (c === 'batch.chain_break' ? 'batch.genesis_invalid' : c)) : want.codes;
        if (!noVerdict) for (const c of codes) assert(codesOf(rows).includes(c), `${id} #${e.seq} ${mode}: row 9 codes ${codesOf(rows)} lack ${c}`);
        eq(St.compare(base, rows), expect, `${id} #${e.seq} ${mode} compare()`);
        assert(t.change && typeof t.change.field === 'string' && t.change.before !== t.change.after, `${id} #${e.seq} ${mode}: change summary`);
        if (mode !== 'forger') assert(t.change.bytes === 1, `${id} #${e.seq} ${mode}: one byte changed`);
      }
      const raw = St.tamper(input, 'raw', deps(P));
      if (!is11) assert(raw.disabled === true && raw.why, `${id} #${e.seq}: raw mode is disabled on a schema 1.0.0 batch`);
      else {
        assert(!raw.disabled && raw.change.bytes === 1, `${id} #${e.seq}: raw mode changes one byte of a raw reading`);
        const rr = red(await St.run(raw.input, deps(P)));
        assert(rr.includes(5) && rr.includes(9) && !rr.includes(6), `${id} #${e.seq} raw: rows 5 and 9 red, row 6 green; got ${rr}`);
      }
    }
  }
});

test('steps: the raw mode finds a payload with bytes from the middle outward, utf8 or hex (Modbus frames), and changes one hex digit', () => {
  const St = need('assets/qwatt-verify-steps.js');
  const P = nodeApi();
  const mk = (payloads) => ({ batch: { text: '{}', obj: { samples_root: '0'.repeat(64), intervals: [] }, ledgerSha256: null }, raw: payloads.map((p, i) => ({ payloads: p, seq: i, ts_start: null, verdict: 'accept' })) });
  const hex = St.tamper(mk([[{ n: 1, hex: '' }], [{ n: 1, hex: '' }], [{ n: 1, hex: '01030a0b0c' }]]), 'raw', { P });
  assert(!hex.disabled && hex.change.enc === 'hex', 'a hex payload is changed');
  const pl = hex.input.raw[2].payloads[0].hex;
  assert(/^(?:[0-9a-f]{2})+$/.test(pl) && pl.length === 10 && pl !== '01030a0b0c', 'still lowercase whole bytes, one digit changed: ' + pl);
  eq([...pl].filter((c, i) => c !== '01030a0b0c'[i]).length, 1, 'one hex digit');
  const utf = St.tamper(mk([[{ n: 1, utf8: 'a,b\n' }]]), 'raw', { P });
  assert(!utf.disabled && utf.change.enc === 'utf8' && utf.change.bytes === 1, 'a utf8 payload is changed');
  const none = St.tamper(mk([[], [{ n: 3, utf8: '' }]]), 'raw', { P });
  eq(none.disabled && none.why, 'no-payload', 'no payload with bytes: disabled with the reason');
});

test('feed: a rejected-ledger line naming a batch that declares no refusals reaches verifyBatch (row 9 red), as for the verifier', async () => {
  const F = need('assets/qwatt-feed.js'), St = need('assets/qwatt-verify-steps.js');
  const P = nodeApi();
  const base = '/evidence/feeds/muestra/';
  const b1 = JSON.parse(readLF('evidence/feeds/muestra/batches/muestra-sim-000001.json'));
  assert(b1.rejected_count === 0, 'muestra #1 declares no refusals');
  const line = JSON.stringify({ batch_id: b1.batch_id, verdict: 'reject', reasons: ['agreement.diverge'], interval: b1.intervals[0] }) + '\n';
  const published = readLF('evidence/feeds/muestra/ledger/rejected.jsonl');
  const fetchWith = (url) => (String(url) === base + 'ledger/rejected.jsonl'
    ? Promise.resolve({ ok: true, status: 200, text: async () => published + line, json: async () => { throw new Error('jsonl'); } })
    : fileFetch(url));
  const feed = await F.open(base, { fetch: fetchWith });
  const input = await feed.input(1);
  eq(input.rejected.length, 1, 'the line naming the batch is read although rejected_count is 0');
  const rows = await St.run(input, deps(P));
  eq(rows[8].state, 'fail', 'row 9 (verifyBatch) refuses the batch');
  assert(rows[8].codes.includes('batch.count_mismatch'), 'with batch.count_mismatch: ' + rows[8].codes);
  const clean = await (await F.open(base, { fetch: fileFetch })).input(1);
  eq(clean.rejected, [], 'the published ledger names nothing for this batch');
  const ens = await (await F.open('/evidence/feeds/ensayo-8oct/', { fetch: fileFetch })).input(1);
  eq(ens.rejected, [], 'the rehearsal feed publishes an empty refusal ledger');
});

test('steps: every tamper mode gives identical rows and verifyBatch results with the browser build and the Node modules', async () => {
  const St = need('assets/qwatt-verify-steps.js'), F = need('assets/qwatt-feed.js');
  const Pb = bareBuild().QWATT_PROTOCOL, Pn = nodeApi();
  for (const id of FEEDS) {
    const feed = await F.open('/evidence/feeds/' + id + '/', { fetch: fileFetch });
    for (const e of feed.entries) {
      const input = await feed.input(e.seq);
      for (const mode of Object.keys(TAMPER)) {
        const tb = St.tamper(input, mode, deps(Pb)), tn = St.tamper(input, mode, deps(Pn));
        eq(tb.change, tn.change, `${id} #${e.seq} ${mode} change`);
        eq(tb.input.batch.text, tn.input.batch.text, `${id} #${e.seq} ${mode} altered bytes`);
        const ctx = { prev: input.context.prev, floor: input.context.floor, rejected: input.rejected, status: e.status };
        eq(Pb.verify.verifyBatch(tb.input.batch.obj, ctx), Pn.verify.verifyBatch(tn.input.batch.obj, ctx), `${id} #${e.seq} ${mode} verifyBatch`);
        eq(await St.run(tb.input, deps(Pb)), await St.run(tn.input, deps(Pn)), `${id} #${e.seq} ${mode} rows`);
      }
    }
  }
});

test('steps: the careful forger keeps every internal check green on the rehearsal and is caught by the anchor', async () => {
  const St = need('assets/qwatt-verify-steps.js'), F = need('assets/qwatt-feed.js');
  const L = liveFromFixtures();
  const P = nodeApi();
  const { feed, input } = await inputFor(F, 'ensayo-8oct', 0);
  input.stellar = await stellarFor(L, feed.manifest);
  const t = St.tamper(input, 'forger', deps(P));
  const rows = await St.run(t.input, deps(P));
  eq(red(rows), [7, 10], 'only the chain (batch #1 no longer links) and the anchor');
  eq(rows[8].state, fd13(input.batch.obj) ? 'na' : 'ok', 'verifyBatch accepts the forgery: it is consistent with itself');
  assert(/interval|intervals/.test(t.change.field) && t.change.forged === true, 'the change says it is a forgery of an interval');
  const last = await inputFor(F, 'muestra', 7);
  const t2 = St.tamper(last.input, 'forger', deps(P));
  const rows2 = await St.run(t2.input, deps(P));
  eq(red(rows2), [], 'the newest batch of an unanchored feed: nothing turns red (that is why we anchor)');
  eq(St.forgerCase(last.input, rows2), 'newest-unanchored', 'and the page is told which explanation applies');
});

test('steps: no row, change summary or provenance string carries a batch_id, site_id or node_id value', async () => {
  const St = need('assets/qwatt-verify-steps.js'), F = need('assets/qwatt-feed.js');
  const L = liveFromFixtures();
  const P = bareBuild().QWATT_PROTOCOL;
  noIds(St.provenance(P), { batch: new Set(), exact: new Set() }, 'provenance');
  for (const id of FEEDS) {
    const ids = idValues(id);
    const feed = await F.open('/evidence/feeds/' + id + '/', { fetch: fileFetch });
    const stellar = feed.manifest.anchoring ? await stellarFor(L, feed.manifest) : null;
    for (const e of feed.entries) {
      const input = await feed.input(e.seq);
      if (stellar) input.stellar = stellar;
      noIds(await St.run(input, deps(P)), ids, `${id} #${e.seq} rows`);
      for (const mode of Object.keys(TAMPER)) {
        const t = St.tamper(input, mode, deps(P));
        noIds(t.change, ids, `${id} #${e.seq} ${mode} change`);
        noIds(await St.run(t.input, deps(P)), ids, `${id} #${e.seq} ${mode} rows`);
      }
    }
  }
});

test('steps: run() never touches the network or the page (it is handed everything)', async () => {
  const St = need('assets/qwatt-verify-steps.js'), F = need('assets/qwatt-feed.js');
  const P = nodeApi();
  const { input } = await inputFor(F, 'muestra', 3);
  const saved = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('run() called fetch'); };
  try { await St.run(input, deps(P)); } finally { globalThis.fetch = saved; }
  const src = readLF('assets/qwatt-verify-steps.js');
  assert(!/\bfetch\s*\(|\bdocument\b|XMLHttpRequest/.test(src), 'qwatt-verify-steps.js contains no fetch and no DOM access');
});

test('steps: provenance lists every file that ran (embedded sources, the shim, the gate engine and its binding) with SHA-256 and GitHub links', () => {
  const St = need('assets/qwatt-verify-steps.js');
  const P = bareBuild().QWATT_PROTOCOL;
  const pv = St.provenance(P);
  eq(pv.map((s) => s.path), P.sources.map((s) => s.path).concat(['protocol/browser-shim.js', 'assets/qwatt-gates.js', 'assets/gates.browser.js']), 'paths');
  for (const s of pv) {
    assert(/^[0-9a-f]{64}$/.test(s.sha256), s.path + ' sha256');
    eq(s.url, 'https://github.com/academiaseul/QWATT/blob/main/' + s.path, s.path + ' url');
  }
  /* the hashes the page lists are those of the files it loads */
  const nodeSha = (p) => require('crypto').createHash('sha256').update(require('fs').readFileSync(rel(p), 'utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  for (const s of pv.slice(P.sources.length)) eq(s.sha256, nodeSha(s.path), s.path + ' sha256 equals the file');
});

/* ═════════════════════════ run ═════════════════════════ */

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + String(e && e.message || e).split('\n').join('\n      ')); }
  }
  console.log(`\nprotocol browser build: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
