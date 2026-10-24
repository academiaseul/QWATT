/**
 * QWATT ops — evidence publisher tests against local bare git remotes (offline: no network, no real keys)
 * Run: node ops/publish-feed.test.js
 *
 * Two repositories (docs/ARCHITECTURE-FREEZE-v3.md V3-7): qwatt-evidence (the proposer host's feed) and
 * qwatt-verifier-log (the verifier host's log), each a public history under <run>/ on main. Published
 * files are never rewritten except index.json, a pending envelope replaced for the same batch and the
 * verifier's status.json; .jsonl files only grow. ops/evidence-audit.js checks a whole history for that.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const PF = require('./publish-feed');
const { Pipeline } = require('../batch/pipeline');
const { verifyFeed } = require('../batch/verify-cli');
const E = require('../protocol/evidence');
const V = require('../batch/verify');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

/* V3-5 carries each interval's raw payloads out of band under this registered symbol (non-enumerable,
   so it never enters the record's canonical JSON). The pipeline's door requires them. */
const RAW = Symbol.for('qwatt.raw_payloads');
const DT = 300, T0 = Date.parse('2026-09-20T15:00:00Z');
const iv = (i) => {
  const t = T0 + i * DT * 1000;
  const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
  const rec = { spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION, site_id: 'pub', node_id: 'pub', seq: i,
    ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
    meters: { a: m('a', 100), b: m('b', 99) }, source: { adapter: 'simulator', raw_sha256: E.sha256('pub-' + i) } };
  return Object.defineProperty(rec, RAW, { value: [{ n: 1, utf8: 'pub-' + i }], enumerable: false, configurable: true });
};

const git = (args, o = {}) => execFileSync('git', args, { encoding: o.buf ? null : 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: o.env || process.env });
const gitOk = (args) => { try { git(args); return true; } catch (e) { return false; } };
const COMMIT_AS = ['-c', 'user.name=someone else', '-c', 'user.email=else@qwatt.invalid'];
const roots = [];

function bare(dir) { fs.mkdirSync(path.dirname(dir), { recursive: true }); git(['init', '--quiet', '--bare', dir]); return dir; }

/** A feed written by the real pipeline, and an empty bare remote named like the real repository. */
function setup(repo = 'qwatt-evidence') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-pub-'));
  roots.push(root);
  const remote = bare(path.join(root, `${repo}.git`));
  const feed = path.join(root, 'feed');
  const pipe = new Pipeline({ dir: feed, site_id: 'pub', node_id: 'pub' });
  const w = { root, remote, feed, pipe, n: 0, o: { kind: 'evidence', feed, run: 'run', remote, branch: 'main', work: path.join(root, 'work') } };
  w.add = (k) => { for (let i = 0; i < k; i++) pipe.push(iv(w.n++)); };
  w.f = (...p) => path.join(feed, ...p);
  return w;
}
const tree = (repo, ref = 'main') => { try { return git(['--git-dir', repo, 'ls-tree', '-r', '--name-only', ref]).split('\n').filter(Boolean); } catch (e) { return []; } };
const count = (repo, ref = 'main') => { try { return Number(git(['--git-dir', repo, 'rev-list', '--count', ref]).trim()); } catch (e) { return 0; } };
const head = (repo, ref = 'main') => { try { return git(['--git-dir', repo, 'rev-parse', ref]).trim(); } catch (e) { return null; } };
const show = (repo, p, ref = 'main') => git(['--git-dir', repo, 'show', `${ref}:${p}`], { buf: true });
/** A run file on the remote (a feed published at the branch root is read there, so a failure names the real defect). */
const showRun = (repo, rel) => (tree(repo).includes(`run/${rel}`) ? show(repo, `run/${rel}`) : show(repo, rel));
const throwsIntegrity = (fn) => {
  try { fn(); } catch (e) { assert(e.name === 'IntegrityError', `expected an IntegrityError, got ${e.name}: ${e.message.split('\n')[0]}`); return e; }
  throw new Error('expected an IntegrityError; the tick published instead');
};
const rewriteBatch = (w, id) => {
  const f = w.f('batches', `${id}.json`);
  const b = JSON.parse(fs.readFileSync(f, 'utf8'));
  b.energy_mwh += 1; b.cumulative_mwh += 1;                              // a forger edits a published batch …
  b.sha256 = E.batchSha256(b);                                          // … and rehashes it
  fs.writeFileSync(f, E.canonical(b) + '\n');
};
/** Every file under dir, with its SHA-256: a directory target's whole state. */
const dirState = (dir) => {
  const out = [];
  const walk = (rel) => { for (const n of fs.readdirSync(path.join(dir, rel)).sort()) { const r = rel ? `${rel}/${n}` : n; if (fs.statSync(path.join(dir, r)).isDirectory()) walk(r); else out.push(`${r} ${E.sha256(fs.readFileSync(path.join(dir, r)).toString('latin1'))}`); } };
  walk('');
  return out.join('\n');
};

/* A throwaway Stellar secret seed made in memory for this test only (never a real key, never funded):
   ed25519 seed → StrKey (version byte 18 << 3, CRC16-XModem little-endian, RFC 4648 base32). It is
   checksum-valid, so the publisher may validate checksums and still must block it. */
function crc16xmodem(buf) {
  let crc = 0;
  for (const b of buf) { crc ^= b << 8; for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
  return crc;
}
function base32(buf) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = ((val << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  return bits > 0 ? out + A[(val << (5 - bits)) & 31] : out;
}
function throwawaySeed() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const payload = Buffer.concat([Buffer.from([18 << 3]), privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32)]);
  const crc = crc16xmodem(payload);
  const seed = base32(Buffer.concat([payload, Buffer.from([crc & 0xff, crc >> 8])]));
  try { assert(require('../anchor/node_modules/@stellar/stellar-sdk').StrKey.isValidEd25519SecretSeed(seed), 'the throwaway seed is a valid StrKey seed'); }
  catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }               // the SDK cross-check runs where anchor/ deps are installed
  return seed;
}

test('the run is published under <run>/ on main of its own repository, with .gitattributes and .nojekyll at the root and bytes identical to the feed', () => {
  const w = setup();
  w.add(24);
  fs.writeFileSync(w.f('faults.json'), JSON.stringify({ description: 'test run', seed: 1 }, null, 2) + '\n');
  fs.mkdirSync(w.f('samples'));
  fs.writeFileSync(w.f('samples', '2026-09-20_150000.csv'), 'ts,a_w,b_w\n2026-09-20T15:00:00Z,100,99\n');
  fs.writeFileSync(w.f('samples', '2026-09-21_000000.csv'), 'ts,a_w,b_w\n');      // written, not yet in the manifest
  fs.writeFileSync(w.f('samples', 'manifest.jsonl'), JSON.stringify({ file: 'samples/2026-09-20_150000.csv', rows: 1 }) + '\n');
  PF.publishOnce(w.o);
  const files = tree(w.remote);
  for (const f of ['run/index.json', 'run/ledger/batches.jsonl', 'run/ledger/accepted.jsonl', 'run/batches/pub-000000.json', 'run/batches/pub-000001.json',
    'run/faults.json', 'run/samples/manifest.jsonl', 'run/samples/2026-09-20_150000.csv', '.gitattributes', '.nojekyll']) assert(files.includes(f), `${f} on main (${files.join(', ')})`);
  assert(!files.includes('index.json') && files.every((f) => f.startsWith('run/') || f === '.gitattributes' || f === '.nojekyll'), `nothing of the run at the root: ${files.join(', ')}`);
  assert(!files.includes('run/samples/2026-09-21_000000.csv'), 'a samples file the manifest does not list yet waits');
  assert(show(w.remote, 'run/batches/pub-000000.json').equals(fs.readFileSync(w.f('batches', 'pub-000000.json'))), 'published bytes identical to the feed');
  eq(show(w.remote, '.gitattributes').toString(), '* -text\n', '.gitattributes keeps bytes verbatim');
  const n = count(w.remote), h = head(w.remote);
  fs.rmSync(w.o.work, { recursive: true, force: true });                // host rebuilt: the worktree is cloned again
  w.add(12);
  PF.publishOnce(w.o);
  assert(count(w.remote) > n, 'history continued');
  assert(gitOk(['--git-dir', w.remote, 'merge-base', '--is-ancestor', h, 'main']), 'history not replaced: the old head is an ancestor');
  assert(show(w.remote, 'run/batches/pub-000002.json').equals(fs.readFileSync(w.f('batches', 'pub-000002.json'))), 'the new batch, bytes identical');
});

test('a pending envelope reaches the remote only after its batch, in a later commit, and may be replaced for the same batch; one removed locally stays published', () => {
  const w = setup();
  w.add(12);
  PF.publishOnce(w.o);
  fs.mkdirSync(w.f('pending'), { recursive: true });
  fs.writeFileSync(w.f('pending', 'pub-000001.xdr'), 'XDR-FOR-AN-UNPUBLISHED-BATCH\n');
  fs.writeFileSync(w.f('pending', 'pub-000000.xdr'), 'XDR-FOR-BATCH-0\n');
  const r = PF.publishOnce(w.o);
  eq(JSON.stringify(r.phase2), JSON.stringify(['pending/pub-000000.xdr']), 'only the proposal whose batch is on the remote');
  assert(!tree(w.remote).includes('run/pending/pub-000001.xdr'), 'the unpublished batch\'s proposal is held back');
  w.add(12);                                                            // batch 1 now exists
  const r2 = PF.publishOnce(w.o);
  assert(r2.phase1.includes('batches/pub-000001.json'), 'batch 1 in phase 1');
  assert(r2.phase2.includes('pending/pub-000001.xdr'), 'its proposal follows in phase 2');
  for (const id of ['pub-000000', 'pub-000001']) {
    const added = git(['--git-dir', w.remote, 'log', '--format=%H', '--diff-filter=A', 'main', '--', `run/pending/${id}.xdr`]).trim();
    assert(added && gitOk(['--git-dir', w.remote, 'cat-file', '-e', `${added}^:run/batches/${id}.json`]), `${id}: the proposal's commit comes after one that already holds the batch`);
    assert(!gitOk(['--git-dir', w.remote, 'cat-file', '-e', `${added}^:run/pending/${id}.xdr`]), `${id}: the proposal is not in the batch's commit`);
  }
  fs.writeFileSync(w.f('pending', 'pub-000000.xdr'), 'XDR-FOR-BATCH-0-FRESH\n');   // a fresh proposal for the same batch
  const r3 = PF.publishOnce(w.o);
  eq(JSON.stringify(r3.phase2), JSON.stringify(['pending/pub-000000.xdr']), 'the replacement is published');
  eq(show(w.remote, 'run/pending/pub-000000.xdr').toString(), 'XDR-FOR-BATCH-0-FRESH\n', 'replaced bytes on the remote');
  fs.unlinkSync(w.f('pending', 'pub-000000.xdr'));                     // the proposer clears it after anchoring
  PF.publishOnce(w.o);
  assert(tree(w.remote).includes('run/pending/pub-000000.xdr'), 'a file removed locally stays published');
  const n = count(w.remote);
  PF.publishOnce(w.o);
  eq(count(w.remote), n, 'an idle tick makes no commit');
  /* the guard reads the remote, not the local worktree: with phase 1's push held back, the proposal waits */
  w.add(12);
  fs.writeFileSync(w.f('pending', 'pub-000002.xdr'), 'XDR-FOR-BATCH-2\n');
  const t = new PF.GitTarget({ remote: w.remote, branch: 'main', work: w.o.work, run: 'run', kind: 'evidence' });
  t.push = () => false;                                                 // as if the push had not reached the remote
  const r4 = PF.publishOnce({ kind: 'evidence', feed: w.feed, run: 'run', target: t });
  assert(r4.phase1.includes('batches/pub-000002.json') && fs.existsSync(path.join(w.o.work, 'run', 'batches', 'pub-000002.json')), 'batch 2 committed locally');
  eq(JSON.stringify(r4.phase2), '[]', 'its proposal waits until the batch is on the remote');
  assert(!fs.existsSync(path.join(w.o.work, 'run', 'pending', 'pub-000002.xdr')), 'not even written locally');
  const r5 = PF.publishOnce(w.o);                                       // the real push: retried, then phase 2
  eq(JSON.stringify(r5.phase2), JSON.stringify(['pending/pub-000002.xdr']), 'published once the batch is pushed');
  /* a deletion is never committed */
  const m = count(w.remote);
  fs.unlinkSync(path.join(w.o.work, 'run', 'pending', 'pub-000000.xdr'));   // gone from the worktree and from the feed
  const e = throwsIntegrity(() => PF.publishOnce(w.o));
  assert(e.problems.some((p) => p.includes('run/pending/pub-000000.xdr') && /deleted/.test(p)), JSON.stringify(e.problems));
  eq(count(w.remote), m, 'nothing pushed');
});

test('a published file is never rewritten: a changed batch file blocks the whole tick and nothing is pushed', () => {
  const w = setup();
  w.add(12);
  PF.publishOnce(w.o);
  const n = count(w.remote), h = head(w.remote), before = showRun(w.remote, 'batches/pub-000000.json');
  rewriteBatch(w, 'pub-000000');
  w.add(12);                                                            // and an honest new batch
  const e = throwsIntegrity(() => PF.publishOnce(w.o));
  assert(Array.isArray(e.problems) && e.problems.some((p) => p.includes('run/batches/pub-000000.json') && /rewritten/.test(p)), `problems name the batch: ${JSON.stringify(e.problems)}`);
  eq(count(w.remote), n, 'no commit pushed');
  eq(head(w.remote), h, 'remote head unchanged');
  assert(showRun(w.remote, 'batches/pub-000000.json').equals(before), 'published bytes unchanged');
  assert(!tree(w.remote).includes('run/batches/pub-000001.json'), 'the honest batch waits too: the whole tick is refused');
});

test('a .jsonl only grows: a ledger whose published bytes are not a prefix of the local file is refused', () => {
  const w = setup();
  w.add(12);
  PF.publishOnce(w.o);
  const n = count(w.remote), before = showRun(w.remote, 'ledger/accepted.jsonl');
  const f = w.f('ledger', 'accepted.jsonl');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').slice(1).join('\n'));   // first line removed
  const e = throwsIntegrity(() => PF.publishOnce(w.o));
  assert(e.problems.some((p) => p.includes('run/ledger/accepted.jsonl') && p.includes('does not extend its published bytes')), JSON.stringify(e.problems));
  eq(count(w.remote), n, 'no commit pushed');
  assert(showRun(w.remote, 'ledger/accepted.jsonl').equals(before), 'remote ledger unchanged');
});

test('a .jsonl is published up to its last complete line', () => {
  const w = setup();
  w.add(5); w.pipe.push(iv(4)); w.add(6);                               // a duplicate: one rejected line, batch 0 closes at 12 lines
  assert(fs.existsSync(w.f('ledger', 'rejected.jsonl')), 'a rejected line exists');
  fs.appendFileSync(w.f('ledger', 'rejected.jsonl'), '{"batch_id":"pub-000001","partial');   // the writer is mid-line
  PF.publishOnce(w.o);
  const pub = showRun(w.remote, 'ledger/rejected.jsonl').toString();
  assert(pub.endsWith('\n') && !pub.includes('partial'), `only complete lines published: ${JSON.stringify(pub.slice(-60))}`);
  fs.appendFileSync(w.f('ledger', 'rejected.jsonl'), '":1}\n');       // the line completes
  const r = PF.publishOnce(w.o);
  assert(r.phase1.includes('ledger/rejected.jsonl'), 'published as a grow');
  const pub2 = showRun(w.remote, 'ledger/rejected.jsonl').toString();
  assert(pub2.startsWith(pub) && pub2.endsWith('"partial":1}\n'), 'the completed line follows the published bytes');
});

test('only the run\'s layout is published, and a file that looks like a secret key blocks the tick', () => {
  const w = setup();
  w.add(12);
  fs.writeFileSync(w.f('anchor.json'), '{"anchor_account":"G..."}\n');
  fs.mkdirSync(w.f('notes'));
  fs.writeFileSync(w.f('notes', 'todo.txt'), 'todo\n');
  const r = PF.publishOnce(w.o);
  for (const s of ['anchor.json', 'notes/todo.txt']) assert(Array.isArray(r.skipped) && r.skipped.includes(s), `${s} listed as skipped: ${JSON.stringify(r.skipped)}`);
  const files = tree(w.remote);
  assert(!files.some((f) => /anchor\.json$|todo\.txt$/.test(f)), `stray files never reach the remote: ${files.join(', ')}`);
  const n = count(w.remote), h = head(w.remote);
  const seed = throwawaySeed();
  fs.mkdirSync(w.f('anchored'), { recursive: true });
  fs.writeFileSync(w.f('anchored', 'pub-000000.json'), JSON.stringify({ batch_id: 'pub-000000', note: seed }, null, 2) + '\n');
  const e = throwsIntegrity(() => PF.publishOnce(w.o));
  assert(e.problems.some((p) => p.includes('run/anchored/pub-000000.json') && p.includes('looks like a secret key')), JSON.stringify(e.problems));
  assert(!e.message.includes(seed) && !JSON.stringify(e.problems).includes(seed), 'the refusal names the file, never the secret');
  eq(count(w.remote), n, 'nothing pushed');
  eq(head(w.remote), h, 'remote unchanged');
  /* a private key in PEM form is refused the same way */
  fs.writeFileSync(w.f('anchored', 'pub-000000.json'), '{}\n');
  const pem = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
  fs.writeFileSync(w.f('faults.json'), JSON.stringify({ note: pem }) + '\n' + pem);
  const e2 = throwsIntegrity(() => PF.publishOnce(w.o));
  assert(e2.problems.some((p) => p.includes('run/faults.json') && p.includes('looks like a secret key')), JSON.stringify(e2.problems));
  eq(count(w.remote), n, 'still nothing pushed');
});

test('every commit a stranger clones verifies: a batch closed by the pipeline mid-tick never yields a ledger line without its file or an index behind the ledger', () => {
  const w = setup();
  w.add(12);
  PF.publishOnce(w.o);
  w.add(5);                                                             // interval lines of the open batch
  const ledger = path.resolve(w.f('ledger', 'batches.jsonl'));
  const orig = { read: fs.readFileSync, copy: fs.copyFileSync, dir: fs.readdirSync };
  let armed = true, fired = false;
  /* the pipeline runs concurrently: it closes a batch the moment the publisher reads the batch ledger */
  const hook = (src) => { if (armed && typeof src === 'string' && path.resolve(src) === ledger) { armed = false; fired = true; w.add(12); } };
  fs.readFileSync = function (src, ...a) { hook(src); return orig.read.call(fs, src, ...a); };
  fs.copyFileSync = function (src, ...a) { hook(src); return orig.copy.call(fs, src, ...a); };
  fs.readdirSync = function (...a) { const r = orig.dir.apply(fs, a); return Array.isArray(r) && r.every((x) => typeof x === 'string') ? [...r].sort() : r; };   // alphabetical, as NTFS/APFS
  try { PF.publishOnce(w.o); } finally { Object.assign(fs, { readFileSync: orig.read, copyFileSync: orig.copy, readdirSync: orig.dir }); }
  assert(fired, 'the race was exercised: a batch closed while the publisher read the ledger');
  PF.publishOnce(w.o);                                                  // the next tick catches up
  const commits = git(['--git-dir', w.remote, 'rev-list', '--reverse', 'main']).trim().split('\n');
  assert(commits.length >= 3, `three or more commits (${commits.length})`);
  const idx = path.join(w.root, 'index.tmp');
  for (const c of commits) {
    const files = tree(w.remote, c);
    const sub = files.some((f) => f.startsWith('run/')) ? 'run' : '.';   // (a feed published at the branch root is checked there)
    const dir = path.join(w.root, 'co-' + c.slice(0, 7));
    fs.mkdirSync(dir);
    git(['--git-dir', w.remote, '--work-tree', dir, 'checkout', c, '--', sub], { env: { ...process.env, GIT_INDEX_FILE: idx } });
    const out = verifyFeed(path.join(dir, sub));
    assert(out.ok, `commit ${c.slice(0, 7)} fails verification: ${out.problems.join(' | ')}`);
    /* V3-5: a batch that carries samples_root is published in the same commit as its raw lines */
    for (const f of files.filter((p) => /^run\/batches\/.+\.json$/.test(p))) {
      if ('samples_root' in JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) assert(files.includes(f.replace(/^run\/batches\/(.+)\.json$/, 'run/raw/$1.jsonl')), `${c.slice(0, 7)}: ${f} without its raw file`);
    }
  }
  assert(tree(w.remote).includes('run/batches/pub-000001.json'), 'the batch closed mid-tick is published on a later tick');
});

test('a push that failed is retried on the next tick even when nothing new arrived', () => {
  const w = setup();
  w.add(12);
  PF.publishOnce(w.o);                                                  // tick 1
  w.add(12);
  const away = w.remote + '.away';
  fs.renameSync(w.remote, away);                                        // the remote is unreachable
  let threw = false;
  try { PF.publishOnce(w.o); } catch (e) { threw = true; }              // tick 2
  assert(threw, 'tick 2 reports the failed push');
  fs.renameSync(away, w.remote);
  PF.publishOnce(w.o);                                                  // tick 3: nothing new locally
  eq(git(['-C', w.o.work, 'rev-list', '--count', 'origin/main..HEAD']).trim(), '0', 'no commit stranded by the failed push');
  assert(tree(w.remote).includes('run/batches/pub-000001.json'), 'the batch reached the remote');
});

test('a worktree cloned from another repository is refused, and each kind refuses the other kind\'s repository', () => {
  const w = setup();
  w.add(12);
  PF.publishOnce(w.o);
  const other = bare(path.join(w.root, 'elsewhere', 'qwatt-evidence.git'));
  let e = null;
  try { PF.publishOnce({ ...w.o, remote: other }); } catch (x) { e = x; }
  assert(e && /belongs to/.test(e.message), `refused: ${e && e.message}`);
  eq(count(other), 0, 'the other repository stays empty');
  const log = bare(path.join(w.root, 'qwatt-verifier-log.git'));
  for (const [kind, remote] of [['evidence', log], ['verifier-log', w.remote]]) {
    const work = path.join(w.root, `work-${kind}`);
    const before = count(remote);
    let x = null;
    try { PF.publishOnce({ kind, feed: w.feed, run: 'run', remote, branch: 'main', work }); } catch (y) { x = y; }
    assert(x && /qwatt-(evidence|verifier-log)/.test(x.message), `${kind} refuses ${path.basename(remote)}: ${x && x.message}`);
    assert(!fs.existsSync(work), `${kind}: refused before any git call (no worktree created)`);
    eq(count(remote), before, `${kind}: nothing pushed to ${path.basename(remote)}`);
  }
});

test('the verifier log publishes only decisions.jsonl, refusals.jsonl and status.json under <run>/; status.json may change, the .jsonl files only grow', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-vlog-'));
  roots.push(root);
  const remote = bare(path.join(root, 'qwatt-verifier-log.git'));
  const state = path.join(root, 'state');
  fs.mkdirSync(state);
  const status = (tick) => JSON.stringify({ started_at: '2026-10-28T10:00:00.000Z', last_tick: tick, last_result: { action: 'idle' }, feed: 'https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/run', signed: 1, refused: 1 }, null, 2) + '\n';
  fs.writeFileSync(path.join(state, 'decisions.jsonl'), '{"batch_id":"b-000000","decision":"signed"}\n{"batch_id":"b-000001","decision":"refused"}\n');
  fs.writeFileSync(path.join(state, 'refusals.jsonl'), '{"batch_id":"b-000001","reasons":["verifier.hash_mismatch"]}\n');
  fs.writeFileSync(path.join(state, 'status.json'), status('2026-10-28T10:00:30.000Z'));
  fs.writeFileSync(path.join(state, 'notes.txt'), 'operator notes\n');
  const o = { kind: 'verifier-log', feed: state, run: 'run', remote, branch: 'main', work: path.join(root, 'work') };
  const r = PF.publishOnce(o);
  eq(tree(remote).join(','), '.gitattributes,.nojekyll,run/decisions.jsonl,run/refusals.jsonl,run/status.json', 'exactly the log under run/');
  assert(r.skipped.includes('notes.txt'), 'notes.txt skipped');
  eq(JSON.stringify(r.phase2), '[]', 'no second phase for the log');
  fs.writeFileSync(path.join(state, 'status.json'), status('2026-10-28T10:01:00.000Z'));
  PF.publishOnce(o);
  eq(show(remote, 'run/status.json').toString(), status('2026-10-28T10:01:00.000Z'), 'a changed status.json is published');
  const n = count(remote);
  fs.writeFileSync(path.join(state, 'decisions.jsonl'), '{"batch_id":"b-000000","decision":"refused"}\n{"batch_id":"b-000001","decision":"refused"}\n');
  const e = throwsIntegrity(() => PF.publishOnce(o));
  assert(e.problems.some((p) => p.includes('run/decisions.jsonl')), JSON.stringify(e.problems));
  eq(count(remote), n, 'nothing pushed');
});

test('verifier log: a change to status.json alone is committed at most every --status-every seconds (exactly at the boundary), a new decision is committed at once, and a state directory from another run is refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-vlog-'));
  roots.push(root);
  const remote = bare(path.join(root, 'qwatt-verifier-log.git'));
  const state = path.join(root, 'state');
  fs.mkdirSync(state);
  const T = Date.parse('2026-10-28T10:00:00Z');
  const clock = { t: T };
  const status = (s, feed = 'https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/run') => JSON.stringify({ started_at: new Date(T).toISOString(), last_tick: new Date(T + s * 1000).toISOString(), last_result: { action: 'idle' }, feed, signed: 1, refused: 0 }, null, 2) + '\n';
  const at = (s, write = true) => { clock.t = T + s * 1000; if (write) fs.writeFileSync(path.join(state, 'status.json'), status(s)); };
  fs.writeFileSync(path.join(state, 'decisions.jsonl'), '{"batch_id":"b-000000","decision":"signed"}\n');
  const o = { kind: 'verifier-log', feed: state, run: 'run', remote, branch: 'main', work: path.join(root, 'work'), statusEvery: 300, now: () => clock.t };
  at(0); PF.publishOnce(o);
  eq(count(remote), 1, 't=0: first publication');
  at(60);
  const r60 = PF.publishOnce(o);
  eq(count(remote), 1, 't=60: a status change alone waits');
  assert(!r60.phase1.includes('status.json'), 'not written');
  eq(show(remote, 'run/status.json').toString(), status(0), 'the remote keeps the last committed status');
  at(120);
  fs.appendFileSync(path.join(state, 'decisions.jsonl'), '{"batch_id":"b-000001","decision":"signed"}\n');
  PF.publishOnce(o);
  eq(count(remote), 2, 't=120: a new decision commits at once');
  eq(git(['--git-dir', remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'main']).trim().split('\n').join(','), 'run/decisions.jsonl,run/status.json', 'together with the current status');
  eq(show(remote, 'run/status.json').toString(), status(120), 'current status published');
  at(400); PF.publishOnce(o);
  eq(count(remote), 2, 't=400: 280 s after the last status commit, it waits');
  at(419); PF.publishOnce(o);
  eq(count(remote), 2, 't=419: 299 s after, it still waits');
  at(420); PF.publishOnce(o);
  eq(count(remote), 3, 't=420: exactly 300 s after, it commits');
  eq(show(remote, 'run/status.json').toString(), status(420), 'the status at t=420');
  /* a state directory that judged another run is refused, even one whose name ends like this run's */
  clock.t = T + 900e3;
  for (const other of ['rehearsal-2026-10-27', 'rerun']) {
    fs.writeFileSync(path.join(state, 'status.json'), status(900, `https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/${other}`));
    const e = throwsIntegrity(() => PF.publishOnce(o));
    assert(e.problems.some((p) => p.includes('run/status.json') && p.includes(`/main/${other}`)), `${other}: ${JSON.stringify(e.problems)}`);
    eq(count(remote), 3, `${other}: nothing pushed`);
  }
  /* the CLI takes --status-every for the verifier log only */
  fs.writeFileSync(path.join(state, 'status.json'), status(900));
  const cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'publish-feed.js'), ...args], { encoding: 'utf8', timeout: 120e3 });
  const out = path.join(root, 'site');
  eq(cli('--kind', 'verifier-log', '--feed', state, '--run', 'run', '--dir', out, '--status-every', '300', '--once').status, 0, '--status-every with the verifier log');
  eq(cli('--kind', 'evidence', '--feed', state, '--run', 'run', '--dir', out, '--status-every', '300', '--once').status, 2, '--status-every with evidence is a usage error');
});

test('a local-directory target applies the same rules (tests and local runs)', () => {
  const w = setup();
  w.add(12);
  const out = path.join(w.root, 'site');
  PF.publishOnce({ kind: 'evidence', feed: w.feed, run: 'run', target: new PF.DirTarget({ dir: out, run: 'run' }) });
  assert(fs.readFileSync(path.join(out, 'run', 'index.json')).equals(fs.readFileSync(w.f('index.json'))), 'dir/run/index.json');
  assert(fs.readFileSync(path.join(out, 'run', 'batches', 'pub-000000.json')).equals(fs.readFileSync(w.f('batches', 'pub-000000.json'))), 'dir/run/batches/pub-000000.json');
  const before = dirState(out);
  rewriteBatch(w, 'pub-000000');
  w.add(12);
  throwsIntegrity(() => PF.publishOnce({ kind: 'evidence', feed: w.feed, run: 'run', dir: out }));
  eq(dirState(out), before, 'the directory is unchanged');
});

test('forward-compatible with V3-5: a listed batch that carries samples_root is published only with its raw file, and its proposal only once both are on the remote', () => {
  const w = setup();
  w.add(12);
  const f = w.f('batches', 'pub-000000.json');
  const b = JSON.parse(fs.readFileSync(f, 'utf8'));
  b.samples_root = E.sha256('raw lines');                               // the publisher reads only the field's presence
  fs.writeFileSync(f, E.canonical(b) + '\n');
  fs.rmSync(w.f('raw', 'pub-000000.jsonl'), { force: true });          // once V3-5 lands the pipeline writes it: as if it were lost
  fs.mkdirSync(w.f('pending'), { recursive: true });
  fs.writeFileSync(w.f('pending', 'pub-000000.xdr'), 'XDR\n');
  const r = PF.publishOnce(w.o);
  assert(r.waited, 'the tick waits for the raw file');
  eq(JSON.stringify([r.phase1, r.phase2]), '[[],[]]', 'nothing published');
  eq(count(w.remote), 0, 'nothing pushed');
  fs.mkdirSync(w.f('raw'), { recursive: true });
  fs.writeFileSync(w.f('raw', 'pub-000000.jsonl'), Array.from({ length: 12 }, (_, i) => E.canonical({ payloads: [{ n: 1, utf8: 'pub-' + i }], seq: i, verdict: 'accept' }) + '\n').join(''));
  const r2 = PF.publishOnce(w.o);
  assert(r2.phase1.includes('raw/pub-000000.jsonl') && r2.phase1.includes('batches/pub-000000.json'), `batch and raw in phase 1: ${r2.phase1}`);
  eq(JSON.stringify(r2.phase2), JSON.stringify(['pending/pub-000000.xdr']), 'then the proposal');
  const addedBatch = git(['--git-dir', w.remote, 'log', '--format=%H', '--diff-filter=A', 'main', '--', 'run/batches/pub-000000.json']).trim();
  const addedRaw = git(['--git-dir', w.remote, 'log', '--format=%H', '--diff-filter=A', 'main', '--', 'run/raw/pub-000000.jsonl']).trim();
  eq(addedRaw, addedBatch, 'the raw file lands in the batch\'s commit');
  fs.appendFileSync(w.f('raw', 'pub-000000.jsonl'), E.canonical({ payloads: [], seq: 99, verdict: 'accept' }) + '\n');
  const e = throwsIntegrity(() => PF.publishOnce(w.o));
  assert(e.problems.some((p) => p.includes('run/raw/pub-000000.jsonl')), `a published raw file is write-once: ${JSON.stringify(e.problems)}`);
  /* phase 2 also needs the raw file on the remote, not only the batch */
  const w2 = setup();
  w2.add(12);
  const f2 = w2.f('batches', 'pub-000000.json');
  fs.writeFileSync(f2, E.canonical({ ...JSON.parse(fs.readFileSync(f2, 'utf8')), samples_root: E.sha256('x') }) + '\n');
  fs.mkdirSync(w2.f('raw'), { recursive: true });
  fs.writeFileSync(w2.f('raw', 'pub-000000.jsonl'), '{"payloads":[]}\n');
  fs.mkdirSync(w2.f('pending'));
  fs.writeFileSync(w2.f('pending', 'pub-000000.xdr'), 'XDR\n');
  const inner = new PF.DirTarget({ dir: path.join(w2.root, 'site'), run: 'run' });
  const target = Object.create(inner);
  target.isPushed = (rel) => !rel.startsWith('raw/') && inner.isPushed(rel);   // the batch is out, its raw file not yet
  const r3 = PF.publishOnce({ kind: 'evidence', feed: w2.feed, run: 'run', target });
  eq(JSON.stringify(r3.phase2), '[]', 'the proposal waits for the raw file on the remote');
});

/* V3-5's publisher test, carried onto this publisher at integration: the pipeline itself writes the
   raw file and the batch's samples_root (nothing hand-made), and the published copy re-derives. */
test('a pending proposal is published only once its batch and its raw file are both in the published tree (the pipeline\'s own raw file and samples_root)', () => {
  const w = setup();
  w.add(12);
  const raw = w.f('raw', 'pub-000000.jsonl');
  assert(fs.existsSync(raw), 'the pipeline wrote the raw file');
  const keep = fs.readFileSync(raw);
  const batch = JSON.parse(fs.readFileSync(w.f('batches', 'pub-000000.json'), 'utf8'));
  eq(batch.samples_root, E.samplesRoot(keep.toString('utf8').trim().split('\n').map((l) => JSON.parse(l))), 'the batch\'s samples_root is the root of its raw file');
  fs.unlinkSync(raw);                                                   // as if the tick listed raw/ before the file landed
  fs.mkdirSync(w.f('pending'), { recursive: true });
  fs.writeFileSync(w.f('pending', 'pub-000000.xdr'), 'XDR\n');
  const r = PF.publishOnce(w.o);
  eq(r.phase2.length, 0, 'held back without its raw file');
  assert(!tree(w.remote).some((p) => p === 'run/batches/pub-000000.json' || p === 'run/pending/pub-000000.xdr'), `neither the batch nor its proposal on the remote: ${tree(w.remote).join(', ')}`);
  fs.writeFileSync(raw, keep);
  const r2 = PF.publishOnce(w.o);
  assert(r2.phase1.includes('raw/pub-000000.jsonl') && r2.phase1.includes('batches/pub-000000.json'), `the raw file with its batch in phase 1: ${r2.phase1}`);
  eq(JSON.stringify(r2.phase2), JSON.stringify(['pending/pub-000000.xdr']), 'then the proposal');
  assert(show(w.remote, 'run/raw/pub-000000.jsonl').equals(keep), 'the raw file published byte for byte');
  const clone = path.join(w.root, 'clone');
  git(['clone', '--quiet', '--branch', 'main', w.remote, clone]);
  const out = verifyFeed(path.join(clone, 'run'));
  assert(out.ok, `the published run re-derives, samples_root included: ${out.problems.join(' | ')}`);
});

test('the history audit passes the publisher\'s history and names every rewrite, deletion, shrink, merge and early proposal; --since catches a force-push', () => {
  const A = require('./evidence-audit');
  const w = setup();
  w.add(12);
  PF.publishOnce(w.o);
  fs.mkdirSync(w.f('pending'), { recursive: true });
  fs.writeFileSync(w.f('pending', 'pub-000000.xdr'), 'XDR-0\n');
  PF.publishOnce(w.o);
  w.add(12);
  fs.writeFileSync(w.f('pending', 'pub-000000.xdr'), 'XDR-0-FRESH\n');
  PF.publishOnce(w.o);
  const honest = A.auditHistory(w.remote, { kind: 'evidence' });
  assert(honest.ok, `honest history passes: ${honest.problems.join(' | ')}`);
  eq(honest.commits, count(w.remote), 'every commit audited');
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'evidence-audit.js'), w.remote], { encoding: 'utf8' });
  eq(cli.status, 0, `CLI exit on an honest history (${cli.stderr})`);
  assert(/public history intact/.test(cli.stdout), cli.stdout);
  const recorded = head(w.remote);

  /* someone with push access commits by hand from another clone */
  const clone = path.join(w.root, 'clone');
  git(['clone', '--quiet', '--branch', 'main', w.remote, clone]);
  const cf = (...p) => path.join(clone, 'run', ...p);
  fs.writeFileSync(cf('batches', 'pub-000000.json'), fs.readFileSync(cf('batches', 'pub-000000.json'), 'utf8').replace('"energy_mwh":', '"energy_mwh":1'));
  fs.unlinkSync(cf('pending', 'pub-000000.xdr'));
  fs.writeFileSync(cf('ledger', 'accepted.jsonl'), fs.readFileSync(cf('ledger', 'accepted.jsonl'), 'utf8').split('\n').slice(1).join('\n'));
  fs.writeFileSync(cf('pending', 'pub-000009.xdr'), 'XDR-9\n');
  git(['-C', clone, 'add', '-A']);
  git(['-C', clone, ...COMMIT_AS, 'commit', '--quiet', '-m', 'tidy up']);
  git(['-C', clone, 'push', '--quiet', 'origin', 'main']);
  const bad = A.auditHistory(w.remote, { kind: 'evidence' });
  assert(!bad.ok, 'tampering is found');
  eq(bad.problems.length, 4, `exactly four problems: ${bad.problems.join(' | ')}`);
  for (const re of [/run\/batches\/pub-000000\.json.*rewritten/, /run\/pending\/pub-000000\.xdr.*deleted/, /run\/ledger\/accepted\.jsonl.*does not extend/, /run\/pending\/pub-000009\.xdr.*before its batch/]) {
    assert(bad.problems.some((p) => re.test(p)), `${re} in ${bad.problems.join(' | ')}`);
  }
  eq(spawnSync(process.execPath, [path.join(__dirname, 'evidence-audit.js'), w.remote], { encoding: 'utf8' }).status, 1, 'CLI exit 1 on a tampered history');
  const tamperedHead = head(w.remote);

  /* a merge commit is named too */
  git(['-C', clone, 'reset', '--quiet', '--hard', recorded]);
  git(['-C', clone, 'checkout', '--quiet', '-b', 'side']);
  fs.writeFileSync(path.join(clone, 'README.md'), 'side\n');
  git(['-C', clone, 'add', '-A']);
  git(['-C', clone, ...COMMIT_AS, 'commit', '--quiet', '-m', 'side']);
  git(['-C', clone, 'checkout', '--quiet', 'main']);
  git(['-C', clone, ...COMMIT_AS, 'merge', '--quiet', '--no-ff', '-m', 'merge side', 'side']);
  git(['-C', clone, 'push', '--quiet', '--force', 'origin', 'main']);    // also drops the tampering commit: a force-push
  const merged = A.auditHistory(w.remote, { kind: 'evidence' });
  assert(merged.problems.some((p) => /merge commit/.test(p)), `merge named: ${merged.problems.join(' | ')}`);
  /* a .jsonl added mid-line, and a file outside the layout */
  fs.writeFileSync(cf('ledger', 'rejected.jsonl'), '{"batch_id":"pub-000002"');
  fs.writeFileSync(cf('notes.txt'), 'n\n');
  git(['-C', clone, 'add', '-A']);
  git(['-C', clone, ...COMMIT_AS, 'commit', '--quiet', '-m', 'more']);
  git(['-C', clone, 'push', '--quiet', 'origin', 'main']);
  const more = A.auditHistory(w.remote, { kind: 'evidence' }).problems;
  assert(more.some((p) => /run\/ledger\/rejected\.jsonl.*ends mid-line/.test(p)) && more.some((p) => /run\/notes\.txt.*outside the layout/.test(p)), `mid-line and stray file named: ${more.join(' | ')}`);

  /* --since: the head recorded before the force-push is no longer in the history */
  const since = A.auditHistory(w.remote, { kind: 'evidence', since: tamperedHead });
  assert(since.problems.some((p) => /history rewritten|not in this history/.test(p)), `force-push caught: ${since.problems.join(' | ')}`);
  const fresh = path.join(w.root, 'fresh');
  git(['clone', '--quiet', '--no-local', '--branch', 'main', w.remote, fresh]);                // as over the network: reachable objects only
  const gone = A.auditHistory(fresh, { kind: 'evidence', since: tamperedHead });
  assert(gone.problems.some((p) => /not in this history/.test(p)), `a fresh clone does not hold the rewritten head: ${gone.problems.join(' | ')}`);
  assert(A.auditHistory(w.remote, { kind: 'evidence', since: recorded }).problems.every((p) => !/history rewritten|not in this history/.test(p)), 'an ancestor recorded earlier is fine');
});

test('the history audit also names a proposal published before its raw file or with its batch, a raw file that changed, a deleted README.md, a rewritten .nojekyll and a symlink; README.md and LICENSE may be added and edited', () => {
  const A = require('./evidence-audit');
  const w = setup();
  w.add(12);
  PF.publishOnce(w.o);
  const clone = path.join(w.root, 'clone');
  git(['clone', '--quiet', '--branch', 'main', w.remote, clone]);
  const cf = (...p) => path.join(clone, ...p);
  const commit = (msg, stage = true) => {
    if (stage) git(['-C', clone, 'add', '-A']);
    git(['-C', clone, ...COMMIT_AS, 'commit', '--quiet', '-m', msg]);
    git(['-C', clone, 'push', '--quiet', 'origin', 'main']);
  };
  /* the owner's documentation: added, then edited (as the web UI does) */
  fs.writeFileSync(cf('README.md'), '# qwatt-evidence\n');
  fs.writeFileSync(cf('LICENSE'), 'MIT License\n');
  commit('Initial documentation');
  fs.writeFileSync(cf('README.md'), '# qwatt-evidence\n\nThe public history of the QWATT run.\n');
  commit('Update README.md');
  let r = A.auditHistory(w.remote, { kind: 'evidence' });
  assert(r.ok, `README.md and LICENSE may be added and edited: ${r.problems.join(' | ')}`);
  /* published by hand, by the rules: a batch that carries samples_root (its raw file not out yet), and another batch's raw file */
  const batch = JSON.parse(fs.readFileSync(cf('run', 'batches', 'pub-000000.json'), 'utf8'));
  fs.writeFileSync(cf('run', 'batches', 'pub-000009.json'), E.canonical({ ...batch, batch_id: 'pub-000009', samples_root: E.sha256('raw lines') }) + '\n');
  fs.mkdirSync(cf('run', 'raw'), { recursive: true });
  fs.writeFileSync(cf('run', 'raw', 'pub-000008.jsonl'), '{"payloads":[],"seq":96}\n');
  commit('batches');
  r = A.auditHistory(w.remote, { kind: 'evidence' });
  assert(r.ok, `adds inside the layout pass: ${r.problems.join(' | ')}`);
  /* one commit, six violations */
  fs.mkdirSync(cf('run', 'pending'), { recursive: true });
  fs.writeFileSync(cf('run', 'pending', 'pub-000009.xdr'), 'XDR-9\n');                       // its batch is out; its raw file only comes in this commit
  fs.writeFileSync(cf('run', 'raw', 'pub-000009.jsonl'), '{"payloads":[],"seq":108}\n');
  fs.appendFileSync(cf('run', 'raw', 'pub-000008.jsonl'), '{"payloads":[],"seq":97}\n');      // a raw file is written once, never grown
  fs.unlinkSync(cf('README.md'));
  fs.writeFileSync(cf('.nojekyll'), 'x\n');
  fs.writeFileSync(cf('run', 'batches', 'pub-000006.json'), E.canonical({ ...batch, batch_id: 'pub-000006' }) + '\n');
  fs.writeFileSync(cf('run', 'pending', 'pub-000006.xdr'), 'XDR-6\n');                       // in the same commit as its batch
  git(['-C', clone, 'add', '-A']);
  fs.writeFileSync(path.join(w.root, 'link-target'), 'batches/pub-000000.json');
  const blob = git(['-C', clone, 'hash-object', '-w', path.join(w.root, 'link-target')]).trim();
  git(['-C', clone, 'update-index', '--add', '--cacheinfo', `120000,${blob},run/batches/pub-000007.json`]);   // a symlink, staged without the filesystem
  commit('tidy up', false);
  r = A.auditHistory(w.remote, { kind: 'evidence' });
  const expected = [/run\/pending\/pub-000009\.xdr: proposal published before its raw file/, /run\/raw\/pub-000008\.jsonl: rewritten/, / README\.md: deleted/,
    / \.nojekyll: rewritten/, /run\/batches\/pub-000007\.json: not a regular file/, /run\/pending\/pub-000006\.xdr: proposal published before its batch/];
  eq(r.problems.length, expected.length, `exactly ${expected.length} problems: ${r.problems.join(' | ')}`);
  for (const re of expected) assert(r.problems.some((p) => re.test(p)), `${re} in ${r.problems.join(' | ')}`);
});

test('after the first publication each file keeps its rule: the samples manifest grows, faults.json and anchored records are written once, grown and replaced files are scanned for secrets, the log publishes only whole lines and a status.json that parses, and the commit guard refuses a stray or rewritten file in the worktree', () => {
  const w = setup();
  w.add(12);
  fs.writeFileSync(w.f('faults.json'), JSON.stringify({ description: 'test run', seed: 1 }, null, 2) + '\n');
  fs.mkdirSync(w.f('samples'));
  fs.writeFileSync(w.f('samples', '2026-09-20_150000.csv'), 'ts,a_w,b_w\n2026-09-20T15:00:00Z,100,99\n');
  fs.writeFileSync(w.f('samples', 'manifest.jsonl'), JSON.stringify({ file: 'samples/2026-09-20_150000.csv', rows: 1 }) + '\n');
  fs.mkdirSync(w.f('anchored'));
  fs.writeFileSync(w.f('anchored', 'pub-000000.json'), JSON.stringify({ batch_id: 'pub-000000', tx_hash: 'a'.repeat(64) }, null, 2) + '\n');
  PF.publishOnce(w.o);
  for (const rel of ['faults.json', 'anchored/pub-000000.json', 'samples/manifest.jsonl']) assert(tree(w.remote).includes(`run/${rel}`), `${rel} published`);
  /* (a) the next day: a new CSV and its manifest line, published as a grow */
  fs.writeFileSync(w.f('samples', '2026-09-21_000000.csv'), 'ts,a_w,b_w\n');
  fs.appendFileSync(w.f('samples', 'manifest.jsonl'), JSON.stringify({ file: 'samples/2026-09-21_000000.csv', rows: 0 }) + '\n');
  const ra = PF.publishOnce(w.o);
  eq(JSON.stringify([...ra.phase1].sort()), JSON.stringify(['samples/2026-09-21_000000.csv', 'samples/manifest.jsonl']), 'the manifest grows with the file it lists');
  assert(showRun(w.remote, 'samples/manifest.jsonl').equals(fs.readFileSync(w.f('samples', 'manifest.jsonl'))), 'the grown manifest on the remote');
  /* (b) written once: faults.json and an anchored record */
  for (const [rel, from, to] of [['faults.json', 'test run', 'another run'], ['anchored/pub-000000.json', 'a'.repeat(64), 'b'.repeat(64)]]) {
    const f = w.f(...rel.split('/'));
    const orig = fs.readFileSync(f, 'utf8');
    fs.writeFileSync(f, orig.replace(from, to));
    const h = head(w.remote);
    const e = throwsIntegrity(() => PF.publishOnce(w.o));
    assert(e.problems.some((p) => p.includes(`run/${rel}`) && /published file would be rewritten/.test(p)), `${rel} is written once: ${JSON.stringify(e.problems)}`);
    eq(head(w.remote), h, `${rel}: nothing pushed`);
    fs.writeFileSync(f, orig);
  }
  /* (c) the secret scan covers a file that grows (an interval line of the open batch) … */
  const seed = throwawaySeed();
  const acc = w.f('ledger', 'accepted.jsonl');
  const accOrig = fs.readFileSync(acc);
  fs.appendFileSync(acc, JSON.stringify({ batch_id: 'pub-000001', verdict: 'accept', note: seed }) + '\n');
  let h = head(w.remote);
  let e = throwsIntegrity(() => PF.publishOnce(w.o));
  assert(e.problems.some((p) => p.includes('run/ledger/accepted.jsonl') && p.includes('looks like a secret key')), `a grown ledger is scanned: ${JSON.stringify(e.problems)}`);
  assert(!e.message.includes(seed) && !JSON.stringify(e.problems).includes(seed), 'the refusal never echoes the secret');
  eq(head(w.remote), h, 'nothing pushed');
  fs.writeFileSync(acc, accOrig);
  /* … and a replaced one: the verifier's status.json, already published */
  const lroot = path.join(w.root, 'log');
  const lremote = bare(path.join(lroot, 'qwatt-verifier-log.git'));
  const state = path.join(lroot, 'state');
  fs.mkdirSync(state);
  const status = (detail) => JSON.stringify({ started_at: '2026-10-28T10:00:00.000Z', last_tick: '2026-10-28T10:00:30.000Z', last_result: { action: 'error', reason: 'internal', detail }, feed: 'https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/run', signed: 1, refused: 0 }, null, 2) + '\n';
  fs.writeFileSync(path.join(state, 'decisions.jsonl'), '{"batch_id":"b-000000","decision":"signed"}\n');
  fs.writeFileSync(path.join(state, 'status.json'), status(null));
  const lo = { kind: 'verifier-log', feed: state, run: 'run', remote: lremote, branch: 'main', work: path.join(lroot, 'work') };
  PF.publishOnce(lo);
  const lh = head(lremote), lstatus = show(lremote, 'run/status.json');
  fs.writeFileSync(path.join(state, 'status.json'), status(`cannot use key ${seed}`));
  e = throwsIntegrity(() => PF.publishOnce(lo));
  assert(e.problems.some((p) => p.includes('run/status.json') && p.includes('looks like a secret key')), `a replaced status.json is scanned: ${JSON.stringify(e.problems)}`);
  assert(!e.message.includes(seed), 'the refusal never echoes the secret');
  eq(head(lremote), lh, 'nothing pushed to the log');
  /* (d) the log: only whole lines, and only a status.json that parses */
  fs.appendFileSync(path.join(state, 'decisions.jsonl'), '{"batch_id":"b-000001","decision":"sig');               // the verifier is mid-line
  fs.writeFileSync(path.join(state, 'status.json'), '{"started_at":"2026-10-28T10:00:00.000Z","last_t');          // and mid-write
  PF.publishOnce(lo);
  eq(show(lremote, 'run/decisions.jsonl').toString(), '{"batch_id":"b-000000","decision":"signed"}\n', 'only the whole lines of decisions.jsonl');
  assert(show(lremote, 'run/status.json').equals(lstatus), 'a status.json that does not parse waits');
  eq(head(lremote), lh, 'nothing to commit yet');
  /* (e) the commit guard: a stray file under the worktree's run/, and a root file rewritten there */
  fs.writeFileSync(path.join(w.o.work, 'run', 'notes.txt'), 'operator notes\n');
  fs.writeFileSync(path.join(w.o.work, '.nojekyll'), 'x\n');
  h = head(w.remote);
  e = throwsIntegrity(() => PF.publishOnce(w.o));
  assert(e.problems.some((p) => p.startsWith('run/notes.txt') && /outside the run's layout/.test(p)), `a stray file is refused: ${JSON.stringify(e.problems)}`);
  assert(e.problems.some((p) => p.startsWith('.nojekyll') && /would be rewritten/.test(p)), `a rewritten root file is refused: ${JSON.stringify(e.problems)}`);
  eq(head(w.remote), h, 'nothing pushed');
  fs.unlinkSync(path.join(w.o.work, 'run', 'notes.txt'));
  git(['-C', w.o.work, 'checkout', '--', '.nojekyll']);
  PF.publishOnce(w.o);
  eq(head(w.remote), h, 'once both are gone, an idle tick');
});

test('a README.md or LICENSE edit on the remote never stops the publisher: its unpushed commits are replayed on top; any other outside commit, a merge or a rewritten history refuses every tick and nothing is pushed', () => {
  const ownerCommit = (dir, msg, push = true) => {
    git(['-C', dir, 'add', '-A']);
    git(['-C', dir, ...COMMIT_AS, 'commit', '--quiet', '-m', msg]);
    if (push) git(['-C', dir, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  };
  const ownerSync = (dir) => { git(['-C', dir, 'fetch', '--quiet', 'origin', 'main']); git(['-C', dir, 'reset', '--quiet', '--hard', 'FETCH_HEAD']); };
  /* the owner creates the repository with a README and a licence (as github.com/new does) before the first tick */
  const world = () => {
    const v = setup();
    v.owner = path.join(v.root, 'owner');
    git(['clone', '--quiet', v.remote, v.owner]);
    fs.writeFileSync(path.join(v.owner, 'README.md'), '# qwatt-evidence\n');
    fs.writeFileSync(path.join(v.owner, 'LICENSE'), 'MIT License\n');
    ownerCommit(v.owner, 'Initial commit');
    v.add(12);
    PF.publishOnce(v.o);
    assert(tree(v.remote).includes('run/batches/pub-000000.json'), 'the first tick publishes on top of the initial commit');
    ownerSync(v.owner);
    return v;
  };
  /* the owner edits README.md in the web UI while the run goes on */
  const w = world();
  const owner = w.owner;
  const text = '# qwatt-evidence\n\nThe public history of the QWATT run.\n';
  fs.writeFileSync(path.join(owner, 'README.md'), text);
  ownerCommit(owner, 'Update README.md');
  const edited = head(w.remote);
  w.add(12);
  fs.mkdirSync(w.f('pending'), { recursive: true });
  fs.writeFileSync(w.f('pending', 'pub-000001.xdr'), 'XDR-1\n');
  const r = PF.publishOnce(w.o);
  assert(r.pushed && r.phase1.includes('batches/pub-000001.json'), `the batch is published after the README edit: ${JSON.stringify(r)}`);
  eq(JSON.stringify(r.phase2), JSON.stringify(['pending/pub-000001.xdr']), 'and its proposal, in the same tick');
  assert(gitOk(['--git-dir', w.remote, 'merge-base', '--is-ancestor', edited, 'main']), 'the README edit stays in the history');
  eq(show(w.remote, 'README.md').toString(), text, 'the edited README.md is kept');
  eq(git(['--git-dir', w.remote, 'rev-list', '--merges', '--count', 'main']).trim(), '0', 'no merge commit: the history stays linear');
  eq(git(['-C', w.o.work, 'rev-list', '--count', 'origin/main..HEAD']).trim(), '0', 'nothing left unpushed');
  const audit = require('./evidence-audit').auditHistory(w.remote, { kind: 'evidence' });
  assert(audit.ok, `the history audits as intact: ${audit.problems.join(' | ')}`);
  /* anything else from outside stops it, tick after tick, and says why */
  const cases = [
    ['a file under run/', /changes run\/notes\.txt/, (o) => { fs.writeFileSync(path.join(o, 'run', 'notes.txt'), 'notes\n'); ownerCommit(o, 'notes'); }],
    ['README.md deleted', /deletes README\.md/, (o) => { fs.unlinkSync(path.join(o, 'README.md')); ownerCommit(o, 'Delete README.md'); }],
    ['a merge commit', /merge commit/, (o) => {
      git(['-C', o, 'checkout', '--quiet', '-b', 'side']);
      fs.writeFileSync(path.join(o, 'LICENSE'), 'MIT License (side)\n');
      ownerCommit(o, 'side', false);
      git(['-C', o, 'checkout', '--quiet', '-']);
      git(['-C', o, ...COMMIT_AS, 'merge', '--quiet', '--no-ff', '-m', 'merge side', 'side']);
      git(['-C', o, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    }],
    ['a rewritten history', /history was rewritten/, (o) => {
      git(['-C', o, 'reset', '--quiet', '--hard', 'HEAD~1']);               // drops the publisher's last commit …
      fs.writeFileSync(path.join(o, 'README.md'), '# rewritten\n');
      ownerCommit(o, 'Update README.md', false);                          // … under a commit that only edits README.md
      git(['-C', o, 'push', '--quiet', '--force', 'origin', 'HEAD:refs/heads/main']);
    }],
  ];
  for (const [name, re, outsideCommit] of cases) {
    const v = world();
    v.add(12);
    PF.publishOnce(v.o);                                                  // a second publisher commit, already public
    ownerSync(v.owner);
    outsideCommit(v.owner);
    const outside = head(v.remote);
    v.add(12);
    for (let t = 1; t <= 2; t++) {                                       // the second tick starts with what the first fetched
      let e;
      try { e = throwsIntegrity(() => PF.publishOnce(v.o)); } catch (x) { throw new Error(`${name}, tick ${t}: ${x.message}`); }
      const p = e.problems.join(' | ');
      assert(/not made by this host/.test(p) && re.test(p), `${name}, tick ${t}: ${p}`);
      eq(head(v.remote), outside, `${name}, tick ${t}: nothing pushed`);
    }
    assert(!tree(v.remote).includes('run/batches/pub-000002.json'), `${name}: the new batch waits`);
  }
  /* a push that fails for another reason is reported by git's reason, never by its "hint:" advice */
  const rejected = ['To qwatt-evidence.git', ' ! [rejected]        HEAD -> main (fetch first)', "error: failed to push some refs to 'qwatt-evidence.git'",
    'hint: Updates were rejected because the remote contains work that you do not', "hint: See the 'Note about fast-forwards' in 'git push --help' for details.", ''].join('\n');
  eq(PF.firstLine({ stderr: rejected }), "error: failed to push some refs to 'qwatt-evidence.git'", 'the line reported for a rejected push');
});

test('V3-7c: the audit checks that every evidence commit the verifier recorded is still in the public history (--recorded)', () => {
  const A = require('./evidence-audit');
  const w = setup();
  w.add(12);
  PF.publishOnce(w.o);
  const older = head(w.remote);
  w.add(12);
  PF.publishOnce(w.o);
  const judged = head(w.remote);
  /* the verifier's decisions.jsonl: each line names the evidence commit it judged (null for a feed that is not a repository) */
  const file = path.join(w.root, 'decisions.jsonl');
  fs.writeFileSync(file, [
    { at: '2026-10-29T12:00:00.000Z', batch_id: 'pub-000000', seq: 0, decision: 'signed', pending_tx_hash: 'a'.repeat(64), reasons: [], detail: null, feed_commit: older },
    { at: '2026-10-29T12:05:00.000Z', batch_id: 'pub-000001', seq: 1, decision: 'signed', pending_tx_hash: 'b'.repeat(64), reasons: [], detail: null, feed_commit: judged },
    { at: '2026-10-29T12:06:00.000Z', batch_id: 'local-000000', seq: 0, decision: 'refused', pending_tx_hash: null, reasons: ['verifier.not_published'], detail: null, feed_commit: null },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  eq(A.auditHistory(w.remote, { kind: 'evidence', recorded: file }).ok, true, 'every recorded commit is in the history');

  /* someone with push access force-pushes the older commit: the commit the verifier judged is gone */
  const clone = path.join(w.root, 'clone');
  git(['clone', '--quiet', '--branch', 'main', w.remote, clone]);
  git(['-C', clone, 'reset', '--quiet', '--hard', older]);
  git(['-C', clone, 'push', '--quiet', '--force', 'origin', 'main']);
  const bad = A.auditHistory(w.remote, { kind: 'evidence', recorded: file });
  assert(!bad.ok, 'a force-push that removed a judged commit is found');
  assert(bad.problems.some((p) => p.includes(judged) && /the verifier judged is not in this history/.test(p)), `the problem names the commit: ${bad.problems.join(' | ')}`);
  assert(!bad.problems.some((p) => p.includes(older)), `the commit still there is not named: ${bad.problems.join(' | ')}`);
  const fresh = path.join(w.root, 'fresh');
  git(['clone', '--quiet', '--no-local', '--branch', 'main', w.remote, fresh]);                 // as over the network: the object is gone too
  assert(A.auditHistory(fresh, { kind: 'evidence', recorded: file }).problems.some((p) => p.includes(judged)), 'a fresh clone reports it too');

  const cli = spawnSync(process.execPath, [path.join(__dirname, 'evidence-audit.js'), w.remote, '--recorded', file], { encoding: 'utf8' });
  eq(cli.status, 1, `CLI exit 1 (${cli.stderr})`);
  assert(cli.stdout.includes(judged), cli.stdout);
  eq(spawnSync(process.execPath, [path.join(__dirname, 'evidence-audit.js'), w.remote, '--recorded'], { encoding: 'utf8' }).status, 2, '--recorded without a file is a usage error');
  eq(spawnSync(process.execPath, [path.join(__dirname, 'evidence-audit.js'), w.remote, '--recorded', path.join(w.root, 'no-such.jsonl')], { encoding: 'utf8' }).status, 2, 'an unreadable --recorded file is a usage error, never a pass');
});

test('V3-7c: --recorded on an evidence clone older than the verifier log says to clone again, never that the history was rewritten; the daily check clones the verifier log first, then the evidence', () => {
  const A = require('./evidence-audit');
  const w = setup();
  w.add(12);
  PF.publishOnce(w.o);
  const stale = path.join(w.root, 'stale');
  git(['clone', '--quiet', '--no-local', '--branch', 'main', w.remote, stale]);       // the evidence is cloned first …
  w.add(12);
  PF.publishOnce(w.o);
  const judged = head(w.remote);                                                       // … then the verifier judges a newer commit and logs it
  const file = path.join(w.root, 'decisions.jsonl');
  fs.writeFileSync(file, JSON.stringify({ at: '2026-10-29T12:05:00.000Z', batch_id: 'pub-000001', seq: 1, decision: 'signed', pending_tx_hash: 'c'.repeat(64), reasons: [], detail: null, feed_commit: judged }) + '\n');
  const r = A.auditHistory(stale, { kind: 'evidence', recorded: file });
  assert(!r.ok, 'a judged commit the clone does not have is still reported');
  assert(r.problems.some((p) => p.includes(judged) && /is not in this clone/.test(p) && /clone the evidence again/.test(p)), `it says the clone is behind and what to do: ${r.problems.join(' | ')}`);
  assert(!r.problems.some((p) => /is not in this history/.test(p)), `no false "history rewritten" alarm: ${r.problems.join(' | ')}`);
  git(['-C', stale, 'pull', '--quiet', '--ff-only']);
  eq(A.auditHistory(stale, { kind: 'evidence', recorded: file }).ok, true, 'once the clone is as new as the log: intact');

  /* RUNBOOK, daily check 4: a clone of the evidence taken after the clone of the log holds every commit the log names */
  const rb = fs.readFileSync(path.join(__dirname, '..', 'docs', 'RUNBOOK.md'), 'utf8');
  const at = rb.indexOf('## Daily check');
  const sec = rb.slice(at, rb.indexOf('\n## ', at + 1));
  const qv = sec.indexOf('git clone https://github.com/academiaseul/qwatt-verifier-log /tmp/qv');
  const qe = sec.indexOf('git clone https://github.com/academiaseul/qwatt-evidence /tmp/qe');
  const rec = sec.indexOf('--recorded /tmp/qv/');
  assert(at >= 0 && qv >= 0 && qe >= 0 && rec >= 0, 'the daily check clones both repositories and runs --recorded');
  assert(qv < qe && qe < rec, 'the verifier log is cloned before the evidence, and --recorded runs after both');
});

test('the CLI requires --kind, --run and exactly one of --remote/--dir; a bad run name, or a refusal under --once, exits non-zero', () => {
  const w = setup();
  w.add(12);
  const out = path.join(w.root, 'site');
  const cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'publish-feed.js'), ...args], { encoding: 'utf8', timeout: 120e3 });
  eq(cli('--kind', 'evidence', '--feed', w.feed, '--run', '../x', '--remote', w.remote, '--once').status, 2, '--run ../x');
  eq(cli('--kind', 'evidence', '--feed', w.feed, '--run', 'run', '--remote', w.remote, '--dir', out, '--once').status, 2, 'both --remote and --dir');
  eq(cli('--kind', 'other', '--feed', w.feed, '--run', 'run', '--remote', w.remote, '--once').status, 2, '--kind other');
  eq(cli('--feed', w.feed, '--run', 'run', '--remote', w.remote, '--once').status, 2, 'no --kind');
  eq(cli('--kind', 'evidence', '--feed', w.feed, '--remote', w.remote, '--once').status, 2, 'no --run');
  eq(count(w.remote), 0, 'no usage error published anything');
  eq(cli('--kind', 'evidence', '--feed', w.feed, '--run', 'run', '--dir', out, '--once').status, 0, 'a good tick exits 0');
  rewriteBatch(w, 'pub-000000');
  const r = cli('--kind', 'evidence', '--feed', w.feed, '--run', 'run', '--dir', out, '--once');
  eq(r.status, 1, 'a refusal under --once exits 1');
  assert(/PUBLISH REFUSED \(nothing pushed\)/.test(r.stderr) && r.stderr.includes('run/batches/pub-000000.json'), `refusal reported on stderr: ${r.stderr}`);
});

test('the deploy template makes the operator choose the run name: QWATT_RUN is a rehearsal placeholder the publisher refuses until it is replaced, never the live run\'s `run`, and every URL carries the same name', () => {
  const tpl = fs.readFileSync(path.join(__dirname, 'deploy', 'env.example'), 'utf8').replace(/\r\n/g, '\n');
  const values = (k) => tpl.split('\n').filter((l) => l.startsWith(`${k}=`)).map((l) => l.slice(k.length + 1));
  const runs = values('QWATT_RUN');
  eq(runs.length, 2, 'QWATT_RUN in publish.env and in verifier-log.env');
  for (const v of runs) {
    assert(v !== 'run', 'the template never defaults to the live run\'s name: a rehearsal published as `run` takes that directory for good (the public history is never rewritten)');
    eq(v, 'rehearsal-YYYY-MM-DD', 'the placeholder names the rehearsal pattern (V3-7 D1)');
    assert(!PF.RUN_RE.test(v), `the placeholder is not a valid run name, so a template copied unchanged cannot publish: ${v}`);
  }
  const w = setup();
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'publish-feed.js'), '--kind', 'evidence', '--feed', w.feed, '--run', runs[0], '--dir', path.join(w.root, 'site'), '--once'], { encoding: 'utf8', timeout: 60e3 });
  eq(cli.status, 2, `qwatt-publish with the placeholder exits 2 at start (${cli.stderr.trim()})`);
  const urls = [...values('QWATT_FEED_URL'), ...values('QWATT_VERIFIER_LOG_URL')];
  eq(urls.length, 3, 'the feed URL in verifier.env and watch.env, the log URL in watch.env');
  for (const u of urls) assert(u.endsWith(`/main/${runs[0]}`), `the URL names the same run: ${u}`);
  assert(/public history is never rewritten/.test(tpl) && /`run` is only for the seven-day live run/.test(tpl) && /rehearsal-2026-10-29/.test(tpl), 'the comment says why: run vs rehearsal, and a published name can never be reused');
  const rb = fs.readFileSync(path.join(__dirname, '..', 'docs', 'RUNBOOK.md'), 'utf8');
  assert(/env\.example` carries the placeholder `rehearsal-YYYY-MM-DD`/.test(rb), 'the RUNBOOK says what the template carries');
});

(async () => {
  console.log('\nops publish-feed');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message.split('\n')[0]); }
  }
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
