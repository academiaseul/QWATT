/**
 * QWATT ops — key policy (freeze v3, V3-8): no secret in an env file, the repository or a browser.
 * Run: node ops/keys-policy.test.js     (zero dependencies: reads the working tree only)
 *
 * Each key is generated with stellar-cli on the machine that uses it, and the services ask
 * stellar-cli to sign (anchor/signer.js). These checks keep the old paths from coming back:
 * a secret read from the environment, an env template with a secret line, stellar-cli's
 * local config committed by mistake, or a secret seed anywhere in the tracked files.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const filesIn = (dir, keep) => (exists(dir) ? fs.readdirSync(path.join(ROOT, dir)).filter((n) => fs.statSync(path.join(ROOT, dir, n)).isFile() && keep(n)).map((n) => `${dir}/${n}`) : []);
/** "file:line: text" for every line of `files` that matches `re`. */
function hits(files, re) {
  const out = [];
  for (const f of files) read(f).split(/\r?\n/).forEach((l, i) => { if (re.test(l)) out.push(`${f}:${i + 1}: ${l.trim().slice(0, 100)}`); });
  return out;
}

/* ── Stellar StrKey, checked in plain JS: base32, version byte, CRC16-XModem ── */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const VERSION_SEED = 18 << 3, VERSION_ACCOUNT = 6 << 3;
function b32decode(s) {
  let bits = 0, val = 0;
  const out = [];
  for (const c of s) {
    const i = B32.indexOf(c);
    if (i < 0) return null;
    val = ((val << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = ((val << 8) | b) & 0xffff; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return bits ? out + B32[(val << (5 - bits)) & 31] : out;
}
function crc16xmodem(buf) {
  let crc = 0;
  for (const b of buf) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
/** True only for a checksum-valid S… secret seed (not a G… key, not 56 letters that merely look like one). */
function isSecretSeed(s) {
  if (!/^S[A-Z2-7]{55}$/.test(s)) return false;
  const raw = b32decode(s);
  if (!raw || raw.length !== 35 || raw[0] !== VERSION_SEED) return false;
  const crc = crc16xmodem(raw.subarray(0, 33));
  return raw[33] === (crc & 255) && raw[34] === (crc >> 8);
}
/** A StrKey for 32 bytes under a version byte (used to make a throwaway seed in memory, never written). */
function strKey(version, bytes) {
  const body = Buffer.concat([Buffer.from([version]), bytes]);
  const crc = crc16xmodem(body);
  return b32encode(Buffer.concat([body, Buffer.from([crc & 255, crc >> 8])]));
}
/** Every checksum-valid secret seed in a text. */
const seedsIn = (text) => (text.match(/S[A-Z2-7]{55}/g) || []).filter(isSecretSeed);

/** Tracked files (git ls-files), or a walk of the tree without node_modules and .git when git is unavailable. */
function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  } catch (e) {
    const out = [];
    const walk = (rel) => {
      for (const n of fs.readdirSync(path.join(ROOT, rel))) {
        if (n === 'node_modules' || n === '.git') continue;
        const r = rel ? `${rel}/${n}` : n;
        const st = fs.lstatSync(path.join(ROOT, r));
        if (st.isDirectory()) walk(r); else if (st.isFile()) out.push(r);
      }
    };
    walk('');
    return out;
  }
}

/* service, tool and script code (tests and test fixtures excluded: they hold throwaway in-memory keys) */
const isCode = (n) => n.endsWith('.js') && !n.endsWith('.test.js');
const codeFiles = () => [...filesIn('anchor', isCode), ...filesIn('ops', isCode), ...filesIn('live', isCode)];

test('no service, test tool, unit or env template takes a Stellar secret from the environment', () => {
  const code = hits(codeFiles(), /\bfromSecret\s*\(|\bfromRawEd25519Seed\s*\(|process\.env\s*(\.\s*\w*SECRET|\[[^\]]*secret)/i);
  eq(code.length, 0, `code that reads a secret (stellar-cli signs instead): ${JSON.stringify(code, null, 1)}`);
  const docs = hits([...filesIn('anchor', (n) => n.endsWith('.js')), 'anchor/README.md', ...filesIn('ops/deploy', () => true)], /QWATT_(PROPOSER|VERIFIER)_SECRET\s*=/);
  eq(docs.length, 0, `a secret named as an environment variable: ${JSON.stringify(docs, null, 1)}`);
});

test('the proposer and verifier units sign with their stellar-cli identity and load no secret file', () => {
  const p = read('ops/deploy/qwatt-proposer.service'), v = read('ops/deploy/qwatt-verifier.service');
  assert(/^ExecStart=.*anchor\/proposer\.js .*--sign-with-key qwatt-proposer\b/m.test(p), 'proposer ExecStart passes --sign-with-key qwatt-proposer');
  assert(/^ExecStart=.*anchor\/verifier\.js .*--sign-with-key qwatt-verifier\b/m.test(v), 'verifier ExecStart passes --sign-with-key qwatt-verifier');
  assert(!/^EnvironmentFile=.*proposer\.env/m.test(p), 'the proposer has no env file: there is nothing secret to load');
  assert(/no secret ever goes into an env file/.test(read('ops/deploy/env.example')), 'env.example says so');
});

test('.gitignore keeps stellar-cli\'s local config (.stellar/) out of git', () => {
  const lines = read('.gitignore').split(/\r?\n/).map((l) => l.trim());
  assert(lines.includes('.stellar/'), '.stellar/ is ignored (older stellar-cli releases write identities to ./.stellar/)');
});

test('no tracked text file holds a valid Stellar secret seed (checksum-verified; a regression guard)', () => {
  /* the detector first: a throwaway seed made in memory is found, a G… key and a corrupted seed are not */
  const seed = strKey(VERSION_SEED, crypto.randomBytes(32));
  assert(isSecretSeed(seed), 'a checksum-valid seed is detected');
  eq(seedsIn(`x ${seed} y`).length, 1, 'found inside text');
  const flip = seed.slice(0, 20) + (seed[20] === 'A' ? 'B' : 'A') + seed.slice(21);
  assert(!isSecretSeed(flip), 'a seed with a broken checksum is not a seed');
  assert(!isSecretSeed(strKey(VERSION_ACCOUNT, crypto.randomBytes(32))), 'a G… public key is not a seed');
  assert(!isSecretSeed('S' + 'A'.repeat(55)), '56 letters that look like a seed are not one');
  const found = [];
  for (const f of trackedFiles()) {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f), 'latin1'); } catch (e) { continue; }
    if (seedsIn(text).length) found.push(f);
  }
  eq(found.length, 0, `tracked files holding a secret seed: ${JSON.stringify(found)}`);
});

/* ── operator docs (V3-8b, DOC-OD2) ─────────────────────────────────────────── */

/** The pinned stellar-cli release (decision D-2): every holder and host uses it. */
const STELLAR_CLI_PIN = 'stellar-cli 28.1.0';
const OPERATOR_DOCS = ['docs/RUNBOOK.md', 'docs/FOUNDER-CHECKLIST.md', ...(exists('docs/THIRD-SIGNER.md') ? ['docs/THIRD-SIGNER.md'] : [])];
const BROWSER_RE = /laboratory\.stellar\.org|lab\.stellar\.org|sign-with-lab|Stellar Laboratory|Freighter/i;

test('no tool or operator doc sends a key holder to a browser', () => {
  const opsCode = [];
  const walk = (dir) => { for (const n of fs.readdirSync(path.join(ROOT, dir))) { const r = `${dir}/${n}`; if (fs.statSync(path.join(ROOT, r)).isDirectory()) walk(r); else if (isCode(n)) opsCode.push(r); } };
  walk('ops');
  const files = [...filesIn('anchor', isCode), 'anchor/README.md', ...opsCode, ...filesIn('ops/deploy', () => true), ...OPERATOR_DOCS];
  const found = hits(files, BROWSER_RE);
  eq(found.length, 0, `a browser or wallet signing path: ${JSON.stringify(found, null, 1)}`);
});

test('operator docs name the pinned stellar-cli version and keep secrets out of env files', () => {
  assert(read('docs/RUNBOOK.md').includes(STELLAR_CLI_PIN), `the runbook names ${STELLAR_CLI_PIN}`);
  const env = hits(['docs/RUNBOOK.md', 'docs/FOUNDER-CHECKLIST.md'], /QWATT_(PROPOSER|VERIFIER)_SECRET/);
  eq(env.length, 0, `a secret in an environment variable: ${JSON.stringify(env, null, 1)}`);
  const docs = [...filesIn('docs', (n) => n.endsWith('.md')), 'anchor/README.md', 'README.md'];
  const inline = hits(docs, /--sign-with-key\s+["']?S[A-Z2-7]{10,}/);
  eq(inline.length, 0, `a secret passed to --sign-with-key: ${JSON.stringify(inline)}`);
});

test('the treasury holder funds the account only through setup-account.js fund-submit, which checks the envelope before stellar-cli signs', () => {
  for (const f of ['docs/RUNBOOK.md', 'docs/FOUNDER-CHECKLIST.md']) {
    assert(/setup-account\.js fund-submit funding\.xdr --account [^`]*--sign-with-key qwatt-treasury/.test(read(f)), `${f} sends the treasury holder to fund-submit`);
    const unchecked = hits([f], /capture\.js submit funding|stellar tx sign[^|]*qwatt-treasury/);
    eq(unchecked.length, 0, `${f}: a path that signs the funding envelope without checking it: ${JSON.stringify(unchecked)}`);
  }
});

test('the runbook and founder checklist no longer describe a 2/2/2 two-signer fallback', () => {
  /* the freeze documents are excluded: they are the signed record (the founders add a dated note there) */
  const found = hits(['docs/RUNBOOK.md', 'docs/FOUNDER-CHECKLIST.md'], /2\/2\/2/);
  eq(found.length, 0, `2/2/2 fallback text: ${JSON.stringify(found, null, 1)}`);
});

test('the runbook and founder checklist follow the week-2 plan: hosts, keys and the third signer\'s public key by Wed 28 Oct, not Days 15–19', () => {
  const runbook = read('docs/RUNBOOK.md'), checklist = read('docs/FOUNDER-CHECKLIST.md');
  assert(!/Days 15[–-]19/.test(runbook), 'the runbook\'s one-time setup is no longer dated Days 15–19');
  assert(!/^## By Day 1[58]\b/m.test(checklist), 'the checklist no longer puts the hosts and the third signer at Days 15–18');
  assert(/^##.*\b(Tue 27|Wed 28) Oct\b/m.test(checklist), 'the checklist has a week-2 deadline');
  const row4 = checklist.split(/\r?\n/).find((l) => /^\| 4 \|/.test(l)) || '';
  assert(/THIRD-SIGNER\.md/.test(row4) && /stellar-cli/.test(row4), `row 4 points the third signer to docs/THIRD-SIGNER.md: ${row4}`);
});

test('the third signer\'s brief exists, names no one, uses stellar-cli and sends only the public key', () => {
  assert(exists('docs/THIRD-SIGNER.md'), 'docs/THIRD-SIGNER.md exists (checklist row 4 points to it)');
  const t = read('docs/THIRD-SIGNER.md');
  for (const s of [STELLAR_CLI_PIN, 'stellar keys generate qwatt-third', 'stellar keys address qwatt-third', 'proposer + third']) assert(t.includes(s), `the brief says ${s}`);
  assert(/only (the|that|your) (public key|G… line)/i.test(t), 'only the public key is sent');
  assert(!/\b(Jay|Diego|Kim|Ostertag)\b/.test(t), 'no name in it: it is sent to the off-team signer, who stays unnamed');
  eq(seedsIn(t).length, 0, 'no secret seed');
});

test('the runbook has the backup drill (V3-8c): restored identities sign a throwaway transaction with keys.js before the real account exists, and each host runs keys.js check, with the identity store closed to others', () => {
  const runbook = read('docs/RUNBOOK.md');
  const at = runbook.search(/^## Backup drill \(once, before the freeze\)/m);
  assert(at >= 0, 'section "Backup drill (once, before the freeze)"');
  const drill = runbook.slice(at, runbook.indexOf('\n## ', at + 1) < 0 ? undefined : runbook.indexOf('\n## ', at + 1));
  for (const s of ['keys.js drill-xdr', 'keys.js drill-submit', '-restored', 'stellar keys rm', 'stellar.expert']) assert(drill.includes(s), `the drill section says ${s}`);
  assert(/keys\.js check --sign-with-key qwatt-proposer/.test(runbook) && /keys\.js check --sign-with-key qwatt-verifier/.test(runbook), 'each host checks its identity with keys.js check');
  assert(exists('anchor/keys.js'), 'anchor/keys.js exists');
  assert(/chmod -R go-rwx ~qwatt\/\.config\/stellar/.test(runbook), 'the identity store is closed to group and others, its files included (directory 700, files 600, as keys.js check expects)');
});

(async () => {
  console.log('\nkey policy (V3-8)');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
