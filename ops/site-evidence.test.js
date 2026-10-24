#!/usr/bin/env node
/**
 * QWATT site — the evidence formats the verification and tests pages read (DESIGN §9.3, §12.5)
 * ---------------------------------------------------------------------------
 *   R-FEEDS  every evidence/feeds/<id>/ is a feed in the public layout with a valid
 *            site manifest feed.json (Appendix E): index.json, ledger/batches.jsonl,
 *            every batch file its ledger names, anchoring roles that are valid public
 *            keys, registered refusal codes with words in both languages, the 150 KB
 *            budget, and agreement with assets/status.json feeds.
 *   R-ABCD   every evidence/account/<G…>/ (none until week 2 publishes tests A–D on the
 *            real account) and the synthetic fixtures under ops/fixtures/abcd/:
 *            1 the directory is the account, on testnet (and, for real evidence, the
 *              account of status.json); 2 the steps and their fields; 3 index.json lists
 *            every raw file and each rehashes, nothing else sits there; 4 A and B are C's
 *            body (recomputed with assets/qwatt-envelope.js) and C's link is C's hash;
 *            5 only registered reason codes; 6 the file's verdict is the one
 *            assets/qwatt-tests.js computes from the files alone; 7 nothing shaped like
 *            a secret seed; 8 the NAV dot of pruebas.html follows the evidence.
 *            Deliberately broken copies of the fixture prove each rule refuses.
 *   Vectors  qwatt-envelope.js on the 8 Oct rehearsal envelopes (body hash, one
 *            signature each, Ed25519 by role); qwatt-tests.js on the fixture, on the 8 Oct
 *            worked example, on the page states of §12.1, and never echoing a field the
 *            page must not render.
 *
 * Node only, no network. Run: node ops/site-evidence.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const rel = (p) => path.join(ROOT, p);
const exists = (p) => fs.existsSync(rel(p));
const readJSON = (p) => JSON.parse(fs.readFileSync(rel(p), 'utf8'));
const sha = (b) => nodeCrypto.createHash('sha256').update(b).digest('hex');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(JSON.stringify(a) === JSON.stringify(b), `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function need(p) { if (!exists(p)) throw new Error(`${p} is missing (group D builds it)`); return require(rel(p)); }

const PASSPHRASE = 'Test SDF Network ; September 2015';
const REHEARSAL = 'evidence/rehearsal/rehearsal-2026-10-08T20-46-13-037Z.json';
const E2E = 'evidence/e2e/e2e-2026-10-08T20-50-44-831Z.json';
const C_HASH = '494e8d12cc3ab7b4f62a7f061a1e899c45e8b4553539346a0e71c8f5c525a8a1';
const STEP_KEYS = ['A_proposer_alone', 'B_verifier_alone', 'C_proposer_plus_verifier', 'D_altered_after_proposer_signed', 'I_withheld_refused'];
const RAW_FILES = ['A.envelope.xdr', 'A.horizon.json', 'B.envelope.xdr', 'B.horizon.json', 'C.transaction.json', 'D.pending.xdr', 'I.pending.xdr', 'I.refusals.jsonl', 'abcd.json'];
const HORIZON_CODES = { transaction: ['tx_bad_auth', 'tx_failed'], operations: ['op_bad_auth', 'op_success'] };
const SEED = new RegExp('\\b' + 'S' + '[A-Z2-7]{55}\\b');   // built here so no seed-shaped literal sits in the repository
const FORBIDDEN_KEYS = ['detail', 'refusal_log', 'refusals', 'method', 'horizon_response', 'stellar_cli_version', 'batch_id', 'withheld', 'forged_sha256', 'combined_from', 'verdict_detail'];

/* ───────────────────────────── helpers ───────────────────────────── */

function isG(g) {
  const E = need('assets/qwatt-envelope.js');
  return !!E.publicKeyBytes(g);
}
function registeredCodes() {
  const reasons = readJSON('protocol/reasons.json').codes;
  const spec = require(rel('assets/gates.browser.js'));
  return new Set([...Object.keys(reasons), ...Object.keys(spec.messages.en)]);
}
function bilingual(o) { return o && typeof o.es === 'string' && o.es.trim() && typeof o.en === 'string' && o.en.trim(); }
function listDir(dir) {
  const out = {};
  (function walk(d, base) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name), k = base ? base + '/' + e.name : e.name;
      if (e.isDirectory()) walk(f, k); else out[k] = fs.readFileSync(f);
    }
  })(dir, '');
  return out;
}
/** The account setup an abcd.json declares (thresholds at submission, the keys that signed), in the shape of QWATT_LIVE.account. */
function declaredSetup(account, abcd) {
  const st = (abcd && abcd.steps) || {}, A = st.A_proposer_alone || {}, B = st.B_verifier_alone || {}, C = st.C_proposer_plus_verifier || {};
  const t = A.thresholds || B.thresholds || {};
  const keys = [...new Set([A.signer_public_key, B.signer_public_key].concat(C.signer_keys || []).filter(isG))];
  /* the file names the two team keys only; a third signer it does not name completes the declared 2-of-3 */
  while (keys.length < 3) keys.push('G' + 'A'.repeat(52) + 'WHF');   // the all-zero key: a placeholder, never a real signer
  return { exists: true, id: account, thresholds: { low: t.low_threshold, med: t.med_threshold, high: t.high_threshold }, masterWeight: 0,
    signers: [{ key: account, weight: 0 }].concat(keys.map((k) => ({ key: k, weight: 1 }))) };
}

function deps(extra = {}) {
  const E = need('assets/qwatt-envelope.js');
  return Object.assign({ sha256: async (b) => sha(b), envelope: E, signedBy: E.signedBy, horizonTx: null }, extra);
}

/* ═════════════════════════ R-FEEDS ═════════════════════════ */

function checkFeed(id) {
  const problems = [];
  const base = `evidence/feeds/${id}`;
  const p = (m) => problems.push(`${base}: ${m}`);
  if (!exists(base + '/feed.json')) { p('no feed.json (site manifest, Appendix E)'); return problems; }
  let m;
  try { m = readJSON(base + '/feed.json'); } catch (e) { p('feed.json does not parse: ' + e.message); return problems; }
  if (m.id !== id) p(`feed.json id "${m.id}" is not the directory name`);
  if (!bilingual(m.title)) p('title needs es and en');
  if (!['testnet', 'prototipo', 'planificado'].includes(m.label)) p('label ∈ testnet|prototipo|planificado');
  if (typeof m.prior !== 'boolean') p('prior is a boolean');
  if (!/^\d+\.\d+\.\d+$/.test(m.batch_schema || '')) p('batch_schema is a version');
  if (!bilingual(m.source)) p('source needs es and en');
  if (m.generated_by !== 'ops/sample-feeds.js') p('generated_by is ops/sample-feeds.js');
  if (m.anchoring !== null) {
    const a = m.anchoring || {};
    if (a.network !== 'testnet') p('anchoring.network is testnet');
    if (!isG(a.account)) p('anchoring.account is not a valid public key');
    if (!/^\d\/\d\/\d$/.test(a.thresholds || '')) p('anchoring.thresholds like "1/2/3"');
    for (const r of ['proposer', 'verifier', 'third']) if (!a.signers || !isG(a.signers[r])) p(`anchoring.signers.${r} is not a valid public key`);
    if (!a.evidence || !exists(String(a.evidence).replace(/^\//, ''))) p('anchoring.evidence names a file that does not exist');
  }
  const ex = m.expected || {};
  if (!Number.isInteger(ex.batches)) p('expected.batches is an integer');
  if (ex.sha256 && !(Array.isArray(ex.sha256) && ex.sha256.every((h) => /^[0-9a-f]{64}$/.test(h)))) p('expected.sha256 is a list of SHA-256 hex');
  const codes = registeredCodes();
  for (const r of ex.refusals || []) {
    if (!codes.has(r.code)) p(`expected refusal code ${r.code} is not registered`);
    if (!bilingual(r.why)) p(`expected refusal ${r.code} needs why.es and why.en`);
    if (!(Number.isInteger(r.seq) || Number.isInteger(r.batch))) p(`expected refusal ${r.code} names an interval seq or a batch`);
  }
  for (const f of ['index.json', 'ledger/batches.jsonl']) if (!exists(`${base}/${f}`)) p(`${f} is missing`);
  if (problems.length) return problems;
  const lines = fs.readFileSync(rel(base + '/ledger/batches.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  lines.forEach((l, i) => {
    if (l.seq !== i) p(`ledger/batches.jsonl line ${i + 1}: seq ${l.seq}`);
    if (!exists(`${base}/batches/${l.batch_id}.json`)) p(`ledger names batch #${l.seq} but its file is not published`);
    if (!['accepted', 'rejected'].includes(l.status)) p(`batch #${l.seq}: status ${l.status}`);
  });
  if (lines.length !== ex.batches) p(`${lines.length} batches in the ledger, feed.json expects ${ex.batches}`);
  if (ex.sha256 && JSON.stringify(lines.map((l) => l.sha256)) !== JSON.stringify(ex.sha256)) p('ledger hashes differ from expected.sha256');
  const size = Object.values(listDir(rel(base))).reduce((s, b) => s + b.length, 0);
  if (size > 150 * 1024) p(`${size} bytes, over the 150 KB budget`);
  const S = readJSON('assets/status.json');
  const fd = (S.feeds || []).find((f) => f.id === id);
  if (!fd) p('not listed in assets/status.json feeds');
  else {
    if (fd.base !== `/${base}/`) p(`status.json base ${fd.base} is not /${base}/`);
    if (fd.label !== m.label || fd.prior !== m.prior) p('label/prior differ from assets/status.json');
  }
  return problems;
}

test('R-FEEDS: both sample feeds exist, with a valid manifest, every listed batch published, within budget', () => {
  assert(exists('evidence/feeds'), 'evidence/feeds/ is missing: run node ops/sample-feeds.js');
  const ids = fs.readdirSync(rel('evidence/feeds'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  eq(ids, ['ensayo-8oct', 'muestra'], 'feed directories');
  const problems = ids.flatMap(checkFeed);
  assert(!problems.length, problems.join('\n'));
});

test('R-FEEDS: every same-origin feed of status.json has a feed directory, and the rehearsal feed is the anchored data', () => {
  const S = readJSON('assets/status.json');
  for (const f of S.feeds || []) if (f.base && f.base.startsWith('/')) assert(exists(f.base.replace(/^\//, '') + 'index.json'), `${f.id}: ${f.base}index.json is missing`);
  const lines = fs.readFileSync(rel('evidence/feeds/ensayo-8oct/ledger/batches.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const reh = readJSON(REHEARSAL);
  eq(lines.map((l) => l.sha256), reh.batches.map((b) => b.sha256), 'ensayo-8oct ledger = rehearsal evidence batches');
  eq(lines[lines.length - 1].sha256, reh.onchain_anchor_after, 'the head is what the rehearsal account still holds');
});

/* ═════════════════════════ R-ABCD ═════════════════════════ */

/**
 * @param {string} name     directory name (the account)
 * @param {object} files    { filename: Buffer } of that directory
 * @param {object} opts     { real: boolean, statusAccount }
 * @returns {Promise<Array<{rule, msg}>>}
 */
async function checkAbcd(name, files, opts = {}) {
  const out = [];
  const p = (rule, msg) => out.push({ rule, msg: `${name}: ${msg}` });
  const text = (f) => (files[f] == null ? null : files[f].toString('utf8'));
  let abcd = null, index = null;
  try { abcd = JSON.parse(text('abcd.json')); } catch (e) { p(2, 'abcd.json missing or unreadable'); return out; }
  try { index = JSON.parse(text('index.json')); } catch (e) { p(3, 'index.json missing or unreadable'); }
  /* 1 */
  if (!isG(name)) p(1, 'the directory name is not a valid public key');
  if (!abcd.public_keys || abcd.public_keys.account !== name) p(1, 'public_keys.account is not the directory name');
  if (opts.real && opts.statusAccount !== name) p(1, 'the account is not assets/status.json anchor.account');
  if (abcd.network !== 'testnet') p(1, 'network is not testnet');
  /* 2 */
  const steps = abcd.steps || {};
  for (const k of Object.keys(steps)) if (!STEP_KEYS.includes(k)) p(2, `unknown step ${k}`);
  const has = (s, fields, k) => fields.forEach((f) => { const v = f.split('.').reduce((o, x) => (o == null ? o : o[x]), s); if (v === undefined) p(2, `${k} lacks ${f}`); });
  for (const k of ['A_proposer_alone', 'B_verifier_alone']) if (steps[k]) has(steps[k], ['refused', 'codes.transaction', 'thresholds', 'thresholds_match', 'body_hash', 'signatures', 'envelope_xdr'], k);
  const C = steps.C_proposer_plus_verifier;
  if (C) {
    has(C, ['ok', 'hash', 'ledger', 'memo', 'signatures', 'signer_keys', 'pair', 'link'], 'C');
    if (C.memo !== undefined && !/^QW#\d+$/.test(C.memo)) p(2, 'C memo is not QW#n');
  }
  for (const k of ['D_altered_after_proposer_signed', 'I_withheld_refused']) if (steps[k]) {
    has(steps[k], ['refused', 'reasons', 'submitted'], k);
    if (steps[k].submitted !== false) p(2, `${k} must record submitted: false`);
  }
  if (!['PASS', 'FAIL', 'INCOMPLETE'].includes(abcd.verdict)) p(2, 'verdict ∈ PASS|FAIL|INCOMPLETE');
  /* 3 */
  if (index) {
    const listed = Object.keys(index.files || {});
    for (const f of Object.keys(files)) {
      if (f === 'index.json') continue;
      if (!RAW_FILES.includes(f)) p(3, `${f} does not belong in a tests A–D directory`);
      if (!listed.includes(f)) p(3, `${f} is not listed in index.json`);
    }
    for (const f of listed) {
      if (files[f] == null) { p(3, `index.json lists ${f}, which is missing`); continue; }
      const bytes = opts.lf ? Buffer.from(files[f].toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : files[f];
      if (sha(bytes) !== index.files[f]) p(3, `${f} does not rehash to its index.json entry`);
    }
  }
  /* 4 */
  const E = need('assets/qwatt-envelope.js');
  for (const k of ['A_proposer_alone', 'B_verifier_alone']) {
    const s = steps[k]; if (!s) continue;
    const file = text(k[0] + '.envelope.xdr');
    const xdr = file != null ? file.split(/\r?\n/).find((l) => l.trim()) : s.envelope_xdr;
    let h = null;
    try { h = await E.bodyHash(xdr, PASSPHRASE); } catch (e) { h = null; }
    if (!h || h !== s.body_hash) p(4, `${k[0]}: the body hash recomputed from its envelope is not the recorded one`);
    if (C && h !== C.hash) p(4, `${k[0]}: its body is not C's transaction (${C.hash})`);
  }
  if (C && C.link !== 'https://stellar.expert/explorer/testnet/tx/' + C.hash) p(4, 'C link is not the stellar.expert page of C\'s hash');
  /* 5 */
  const codes = registeredCodes();
  for (const k of Object.keys(steps)) {
    const s = steps[k];
    for (const c of s.reasons || []) if (!codes.has(c)) p(5, `${k}: reason ${c} is not registered`);
    if (s.codes) {
      if (s.codes.transaction != null && !HORIZON_CODES.transaction.includes(s.codes.transaction)) p(5, `${k}: ${s.codes.transaction} is not a known Horizon code`);
      for (const c of s.codes.operations || []) if (!HORIZON_CODES.operations.includes(c)) p(5, `${k}: ${c} is not a known Horizon code`);
    }
  }
  /* 6 */
  try {
    const T = need('assets/qwatt-tests.js');
    const fileMap = {};
    for (const [f, b] of Object.entries(files)) fileMap[f] = opts.lf ? Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : b;
    /* the page reads the account live; this offline format check lets the setup the file declares stand in for it,
       so rule 6 asks only whether the files reproduce the file's verdict for the directory's account */
    const mdl = await T.model(abcd, index, Object.fromEntries(Object.entries(fileMap).map(([f, b]) => [f, f.endsWith('.json') || f.endsWith('.xdr') || f.endsWith('.jsonl') ? b.toString('utf8') : b])), deps({ account: name, live: declaredSetup(name, abcd) }));
    if (mdl.verdict !== abcd.verdict) p(6, `the file says ${abcd.verdict}, the files themselves give ${mdl.verdict}`);
  } catch (e) { p(6, 'qwatt-tests.js could not judge the files: ' + e.message); }
  /* 7 */
  for (const [f, b] of Object.entries(files)) if (SEED.test(b.toString('utf8'))) p(7, `${f} holds a string shaped like a secret seed`);
  return out;
}

function abcdDirs() {
  const out = [];
  if (exists('evidence/account')) for (const e of fs.readdirSync(rel('evidence/account'), { withFileTypes: true })) if (e.isDirectory()) out.push({ name: e.name, dir: rel('evidence/account/' + e.name), real: true });
  return out;
}
function fixtureDirs() {
  return fs.readdirSync(rel('ops/fixtures/abcd'), { withFileTypes: true }).filter((e) => e.isDirectory() && /^G[A-Z2-7]{55}$/.test(e.name)).map((e) => ({ name: e.name, dir: rel('ops/fixtures/abcd/' + e.name), real: false }));
}

test('R-ABCD: every published tests A–D directory passes rules 1–7 (none until week 2) and none exists before the account', async () => {
  const S = readJSON('assets/status.json');
  const dirs = abcdDirs();
  if (!S.anchor.account) eq(dirs.map((d) => d.name), [], 'no evidence/account/ directory while anchor.account is null');
  for (const d of dirs) {
    const probs = await checkAbcd(d.name, listDir(d.dir), { real: true, statusAccount: S.anchor.account });
    assert(!probs.length, probs.map((x) => `rule ${x.rule}: ${x.msg}`).join('\n'));
  }
});

test('R-ABCD: the synthetic fixture (week-2 format, Appendix F) passes every rule', async () => {
  const fx = fixtureDirs();
  assert(fx.length >= 1, 'ops/fixtures/abcd/<G…>/ is missing');
  for (const d of fx) {
    const probs = await checkAbcd(d.name, listDir(d.dir), { lf: true });
    assert(!probs.length, probs.map((x) => `rule ${x.rule}: ${x.msg}`).join('\n'));
  }
});

test('R-ABCD: deliberately broken copies of the fixture are refused, each by the rule it breaks', async () => {
  const d = fixtureDirs()[0];
  const base = listDir(d.dir);
  const lf = (b) => Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  const reindex = (files) => {
    const idx = JSON.parse(files['index.json'].toString('utf8'));
    for (const f of Object.keys(idx.files)) if (files[f]) idx.files[f] = sha(lf(files[f]));
    files['index.json'] = Buffer.from(JSON.stringify(idx, null, 2) + '\n');
    return files;
  };
  const withAbcd = (fn) => { const files = Object.assign({}, base); const a = JSON.parse(files['abcd.json'].toString('utf8')); fn(a); files['abcd.json'] = Buffer.from(JSON.stringify(a, null, 2) + '\n'); return reindex(files); };
  const seed = 'S' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const cases = [
    ['one byte of A.envelope.xdr changed', 3, () => { const f = Object.assign({}, base); const t = f['A.envelope.xdr'].toString('utf8'); f['A.envelope.xdr'] = Buffer.from(t.slice(0, 40) + (t[40] === 'A' ? 'B' : 'A') + t.slice(41)); return f; }],
    ['an extra file in the directory', 3, () => Object.assign({}, base, { 'notes.txt': Buffer.from('x') })],
    ['a hand-edited verdict', 6, () => withAbcd((a) => { a.verdict = 'FAIL'; })],
    ['an unregistered reason code', 5, () => withAbcd((a) => { a.steps.D_altered_after_proposer_signed.reasons = ['verifier.made_up']; })],
    ['C links another transaction', 4, () => withAbcd((a) => { a.steps.C_proposer_plus_verifier.link = 'https://stellar.expert/explorer/testnet/tx/' + 'a'.repeat(64); })],
    ['A recorded with another body hash', 4, () => withAbcd((a) => { a.steps.A_proposer_alone.body_hash = 'b'.repeat(64); })],
    ['a missing field', 2, () => withAbcd((a) => { delete a.steps.C_proposer_plus_verifier.signer_keys; })],
    ['D says it was submitted', 2, () => withAbcd((a) => { a.steps.D_altered_after_proposer_signed.submitted = true; })],
    ['another network', 1, () => withAbcd((a) => { a.network = 'public'; })],
    ['a seed-shaped string', 7, () => withAbcd((a) => { a.verdict_detail = [seed]; })],
  ];
  for (const [what, rule, make] of cases) {
    const probs = await checkAbcd(d.name, make(), { lf: true });
    assert(probs.some((x) => x.rule === rule), `${what}: rule ${rule} did not refuse it (got ${JSON.stringify(probs.map((x) => x.rule))})`);
  }
  const wrongDir = await checkAbcd('GC5ULQZ2ZRZOHPFHHOZKGXVE3VK4V4FN7IRVVSR7XXWHIEC7DZYVHQBU', base, { lf: true });
  assert(wrongDir.some((x) => x.rule === 1), 'a directory named after another account: rule 1');
  const real = await checkAbcd(d.name, base, { lf: true, real: true, statusAccount: null });
  assert(real.some((x) => x.rule === 1), 'real evidence for an account that is not status.json anchor.account: rule 1');
});

test('R-ABCD 8: the pruebas.html menu dot is testnet only when the real account\'s abcd.json is published', () => {
  const NAV = require(rel('assets/site.js')).NAV.flatMap((g) => g.items || []);
  const S = readJSON('assets/status.json');
  const e = NAV.find((x) => x.id === 'pruebas');
  assert(e, 'NAV has a pruebas entry');
  const want = S.anchor.account && exists(`evidence/account/${S.anchor.account}/abcd.json`) ? 'testnet' : 'planificado';
  eq(e.dot, want, 'pruebas dot');
});

/* ═════════════════════════ qwatt-envelope.js ═════════════════════════ */

test('envelope: the rehearsal A and B envelopes give C\'s hash, one signature each, by the proposer and the verifier', async () => {
  const E = need('assets/qwatt-envelope.js');
  const reh = readJSON(REHEARSAL);
  const k = reh.public_keys;
  for (const [step, signer, other] of [['A_proposer_alone', k.proposer, k.verifier], ['B_verifier_alone', k.verifier, k.proposer]]) {
    const s = reh.steps[step];
    const h = await E.bodyHash(s.envelope_xdr, PASSPHRASE);
    eq(h, s.body_hash, step + ' body hash');
    eq(h, C_HASH, step + ' is C\'s body');
    const sigs = E.signatures(s.envelope_xdr);
    eq(sigs.length, 1, step + ' signatures');
    assert(/^[0-9a-f]{8}$/.test(sigs[0].hint), step + ' hint');
    eq(await E.signedBy(signer, sigs[0].signature, h), true, step + ' verifies for its signer');
    eq(await E.signedBy(other, sigs[0].signature, h), false, step + ' does not verify for the other key');
    eq(await E.signedBy(k.third, sigs[0].signature, h), false, step + ' does not verify for the third key');
  }
});

test('envelope: fee-bump and v0 envelopes are reported unsupported, garbage is refused, keys are checked', async () => {
  const E = need('assets/qwatt-envelope.js');
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  eq(E.decode(b64([0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0])).unsupported, true, 'fee-bump');
  eq(E.decode(b64([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).unsupported, true, 'v0');
  let threw = false; try { E.decode('not base64 at all!'); } catch (e) { threw = true; } assert(threw, 'garbage throws');
  threw = false; try { E.decode(b64([0, 0, 0, 2, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9])); } catch (e) { threw = true; } assert(threw, 'no signature list throws');
  const k = readJSON(REHEARSAL).public_keys.proposer;
  eq(E.publicKeyBytes(k).length, 32, 'a valid G… gives 32 bytes');
  eq(E.publicKeyBytes(k.slice(0, 10) + (k[10] === 'A' ? 'B' : 'A') + k.slice(11)), null, 'one changed character fails the checksum');
  eq(await E.signedBy(k, 'AAAA', C_HASH), false, 'a short signature is false, not an error');
});

/* ═════════════════════════ qwatt-tests.js ═════════════════════════ */

function fixtureFiles() {
  const d = fixtureDirs()[0];
  const files = {};
  for (const [f, b] of Object.entries(listDir(d.dir))) files[f] = b.toString('utf8').replace(/\r\n/g, '\n');
  return { name: d.name, files, abcd: JSON.parse(files['abcd.json']), index: JSON.parse(files['index.json']) };
}
function noForbidden(out, where, banned) {
  (function walk(o, p) {
    if (typeof o === 'string') { for (const b of banned) assert(!o.includes(b), `${where}: ${p} carries "${b}"`); return; }
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) { assert(!FORBIDDEN_KEYS.includes(k), `${where}: key ${p}.${k} is never rendered`); walk(v, p + '.' + k); }
  })(out, '$');
}

/** The fixture's account as Horizon would show it under the frozen setup: 2/2/3, master 0, three signers of weight 1. */
function liveOk(fx, over = {}) {
  const s = fx.abcd.steps;
  return Object.assign({ exists: true, id: fx.name, thresholds: { low: 2, med: 2, high: 3 }, masterWeight: 0,
    signers: [{ key: fx.name, weight: 0 }, { key: s.A_proposer_alone.signer_public_key, weight: 1 }, { key: s.B_verifier_alone.signer_public_key, weight: 1 }, { key: 'GDWVD7H2CKN3S2XZ756I7EITTQF2J3FBBFAMRL3RHBDRALEVOMNRF3I2', weight: 1 }] }, over);
}

test('tests model: the fixture, judged from its files and the account read live, PASSES and agrees with the file; nothing forbidden comes out', async () => {
  const T = need('assets/qwatt-tests.js');
  const fx = fixtureFiles();
  const m = await T.model(fx.abcd, fx.index, fx.files, deps({ account: fx.name, live: liveOk(fx) }));
  eq(m.verdict, 'PASS', 'verdict');
  eq(m.accountCheck.state, 'ok', 'the file describes the configured account');
  eq(m.fileVerdict, 'PASS', 'file verdict');
  eq(m.agree, true, 'agree');
  eq(Object.keys(m.steps), ['A', 'B', 'C', 'D', 'I'], 'five steps');
  for (const k of ['A', 'B', 'D', 'I']) eq(m.steps[k].state, 'refused', k + ' refused, as expected');
  eq(m.steps.C.state, 'ok', 'C anchored');
  const body = m.steps.A.rows.find((r) => r.id === 'body');
  eq(body.vals.recomputed, C_HASH, 'A body = C');
  const two = m.steps.C.rows.find((r) => r.id === 'two-sigs');
  eq(two.vals.pair, 'proposer+verifier', 'C pair');
  noForbidden(m, 'model', ['fixture-0000', 'fixture/abcd', '{"reasons"']);
});

test('tests model: a missing step is INCOMPLETE, a failing one FAILS, and a disagreeing file verdict is reported', async () => {
  const T = need('assets/qwatt-tests.js');
  const fx = fixtureFiles();
  const noI = JSON.parse(JSON.stringify(fx.abcd)); delete noI.steps.I_withheld_refused;
  const live = deps({ account: fx.name, live: liveOk(fx) });
  eq((await T.model(noI, fx.index, fx.files, live)).verdict, 'INCOMPLETE', 'missing I');
  const oneKey = JSON.parse(JSON.stringify(fx.abcd)); oneKey.steps.A_proposer_alone.codes = { transaction: 'tx_failed', operations: ['op_bad_auth'] }; oneKey.steps.A_proposer_alone.refused = false;
  const m = await T.model(oneKey, fx.index, fx.files, live);
  eq(m.verdict, 'FAIL', 'one key met the low threshold (tx_failed): FAIL under 2/2/3');
  eq(m.agree, false, 'and the file verdict PASS disagrees');
  const noEd = await T.model(fx.abcd, fx.index, fx.files, deps({ signedBy: null, account: fx.name, live: liveOk(fx) }));
  eq(noEd.steps.A.rows.find((r) => r.id === 'signer').state, 'na', 'without Ed25519 the signer row does not apply');
});

test('tests model: never PASS for evidence that is not the configured account\'s, whose C came from elsewhere, or whose account is not 2/2/3 now', async () => {
  const T = need('assets/qwatt-tests.js');
  const fx = fixtureFiles();
  const OTHER = 'GC5ULQZ2ZRZOHPFHHOZKGXVE3VK4V4FN7IRVVSR7XXWHIEC7DZYVHQBU';
  /* the file names OTHER (configured), but transaction C was sent by the 8 Oct rehearsal account */
  const renamed = JSON.parse(JSON.stringify(fx.abcd)); renamed.public_keys.account = OTHER;
  const m1 = await T.model(renamed, fx.index, fx.files, deps({ account: OTHER, live: liveOk(fx, { id: OTHER }) }));
  eq(m1.verdict, 'FAIL', 'C from another account: FAIL');
  eq(m1.steps.C.rows.find((r) => r.id === 'onchain').state, 'fail', 'C onchain row fails');
  eq(m1.steps.C.rows.find((r) => r.id === 'onchain').vals.otherAccount, fx.name, 'and names the account C came from');
  /* the file describes another account than the configured one */
  const m2 = await T.model(fx.abcd, fx.index, fx.files, deps({ account: OTHER, live: liveOk(fx) }));
  eq(m2.accountCheck.state, 'fail', 'account row fails');
  eq(m2.verdict, 'FAIL', 'evidence for another account: FAIL');
  /* thresholds as read now are 1/2/3 (the file still says 2/2/3) */
  const m3 = await T.model(fx.abcd, fx.index, fx.files, deps({ account: fx.name, live: liveOk(fx, { thresholds: { low: 1, med: 2, high: 3 } }) }));
  eq(m3.steps.A.rows.find((r) => r.id === 'thresholds').state, 'fail', 'thresholds judged from the live account');
  eq(m3.verdict, 'FAIL', 'one key could send: FAIL');
  /* the proposer that signed A is not a signer of the account now */
  const m4 = await T.model(fx.abcd, fx.index, fx.files, deps({ account: fx.name, live: liveOk(fx, { signers: [{ key: fx.name, weight: 0 }, { key: OTHER, weight: 1 }, { key: fx.abcd.steps.B_verifier_alone.signer_public_key, weight: 1 }, { key: 'GDWVD7H2CKN3S2XZ756I7EITTQF2J3FBBFAMRL3RHBDRALEVOMNRF3I2', weight: 1 }] }) }));
  eq(m4.verdict, 'FAIL', 'a proposer key that does not sign for the account: FAIL');
  /* no account read (Horizon offline) and no configured account: never PASS */
  eq((await T.model(fx.abcd, fx.index, fx.files, deps({ account: fx.name }))).verdict, 'INCOMPLETE', 'no live read: INCOMPLETE');
  eq((await T.model(fx.abcd, fx.index, fx.files, deps({ live: liveOk(fx) }))).verdict, 'INCOMPLETE', 'no configured account: INCOMPLETE');
});

test('tests model: the 8 Oct worked example (1/2/3) — A and B refused as tx_failed/op_bad_auth, C by proposer + verifier, D and I refused', async () => {
  const T = need('assets/qwatt-tests.js');
  const reh = readJSON(REHEARSAL), e2e = readJSON(E2E);
  const tx = readJSON('ops/fixtures/abcd/horizon/tx-c.json');
  const horizonTx = async (h) => (h === tx.hash ? { hash: tx.hash, ledger: tx.ledger, ok: tx.successful, memoShown: 'QW#0', signatures: tx.signatures, sourceAccount: tx.source_account } : null);
  const w = await T.worked(reh, e2e, deps({ horizonTx }));
  eq(w.verdict, 'PASS', 'worked verdict');
  eq(w.thresholds, '1/2/3', 'earlier design');
  for (const k of ['A', 'B']) {
    eq(w.steps[k].state, 'refused', k);
    const ans = w.steps[k].rows.find((r) => r.id === 'answer');
    eq(ans.vals.codes, ['tx_failed', 'op_bad_auth'], k + ' codes');
    eq(ans.vals.earlier, true, k + ' flagged as the earlier design');
  }
  const two = w.steps.C.rows.find((r) => r.id === 'two-sigs');
  eq(two.vals.pair, 'proposer+verifier', 'C signed by proposer + verifier (checked against Horizon\'s signatures)');
  eq(w.steps.C.rows.find((r) => r.id === 'onchain').vals.ledger, 5093764, 'C ledger');
  eq(w.steps.D.state, 'refused', 'D');
  eq(w.steps.I.state, 'refused', 'I (end-to-end rehearsal, unpublished batch)');
  eq(w.L && w.L.ledger, 5093765, 'L, third signer + verifier');
  eq(w.independenceAfter && w.independenceAfter.ledger, 5093822, 'anchored after publication');
  noForbidden(w, 'worked', ['e2e-bench', 'rehearsal-0000', 'pending transaction names']);
  const off = await T.worked(reh, e2e, deps({ horizonTx: async () => { throw new Error('offline'); } }));
  eq(off.steps.C.state, 'offline', 'Horizon offline: C cannot be checked live');
  eq(off.verdict, 'INCOMPLETE', 'and the verdict says so');
});

test('tests page states (§12.1): planned → in progress → published', () => {
  const T = need('assets/qwatt-tests.js');
  eq(T.pageState(null, null).state, 'planificado', 'no account');
  eq(T.pageState('GC5ULQZ2ZRZOHPFHHOZKGXVE3VK4V4FN7IRVVSR7XXWHIEC7DZYVHQBU', null), { state: 'curso', section2: false, line: 'account-no-tests' }, 'account, no evidence');
  eq(T.pageState('GC5ULQZ2ZRZOHPFHHOZKGXVE3VK4V4FN7IRVVSR7XXWHIEC7DZYVHQBU', { verdict: 'INCOMPLETE' }).state, 'curso', 'incomplete evidence');
  eq(T.pageState('GC5ULQZ2ZRZOHPFHHOZKGXVE3VK4V4FN7IRVVSR7XXWHIEC7DZYVHQBU', { verdict: 'PASS' }).state, 'testnet', 'published');
  for (const c of Object.keys(T.REASONS)) assert(bilingual(T.REASONS[c]), c + ' has words in both languages');
});

/* ═════════════════════════ run ═════════════════════════ */

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + String(e && e.message || e).split('\n').join('\n      ')); }
  }
  console.log(`\nsite evidence formats: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
