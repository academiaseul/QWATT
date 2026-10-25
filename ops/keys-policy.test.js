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

(async () => {
  console.log('\nkey policy (V3-8)');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
