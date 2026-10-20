/**
 * QWATT ops — feed publisher tests against a local bare git remote (offline)
 * Run: node ops/publish-feed.test.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { publishOnce } = require('./publish-feed');
const { Pipeline } = require('../batch/pipeline');
const E = require('../protocol/evidence');
const V = require('../batch/verify');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const DT = 300, T0 = Date.parse('2026-09-20T15:00:00Z');
const iv = (i) => {
  const t = T0 + i * DT * 1000;
  const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
  return { spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION, site_id: 'pub', node_id: 'pub', seq: i,
    ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
    meters: { a: m('a', 100), b: m('b', 99) }, source: { adapter: 'simulator', raw_sha256: E.sha256('pub-' + i) } };
};

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-pub-'));
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--quiet', '--bare', remote]);
  const feed = path.join(root, 'feed');
  const pipe = new Pipeline({ dir: feed, site_id: 'pub', node_id: 'pub' });
  return { root, remote, feed, pipe, o: { feed, remote, branch: 'feed', work: path.join(root, 'work') } };
}
const lsRemote = (remote) => execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'feed'], { encoding: 'utf8' }).trim().split('\n');
const commits = (remote) => Number(execFileSync('git', ['--git-dir', remote, 'rev-list', '--count', 'feed'], { encoding: 'utf8' }).trim());

test('first publication creates the branch with the whole feed and .nojekyll', () => {
  const w = setup();
  for (let i = 0; i < 24; i++) w.pipe.push(iv(i));
  const r = publishOnce(w.o);
  assert(r.phase1.length >= 5, 'files published');
  const files = lsRemote(w.remote);
  for (const f of ['.nojekyll', 'index.json', 'ledger/batches.jsonl', 'batches/pub-000000.json', 'batches/pub-000001.json']) assert(files.includes(f), `${f} on the branch`);
});

test('a pending proposal is never published before its batch', () => {
  const w = setup();
  for (let i = 0; i < 12; i++) w.pipe.push(iv(i));
  publishOnce(w.o);
  fs.mkdirSync(path.join(w.feed, 'pending'), { recursive: true });
  fs.writeFileSync(path.join(w.feed, 'pending', 'pub-000001.xdr'), 'XDR-FOR-AN-UNPUBLISHED-BATCH\n');
  fs.writeFileSync(path.join(w.feed, 'pending', 'pub-000000.xdr'), 'XDR-FOR-BATCH-0\n');
  const r = publishOnce(w.o);
  eq(JSON.stringify(r.phase2), JSON.stringify(['pending/pub-000000.xdr']), 'only the proposal whose batch is public');
  assert(!lsRemote(w.remote).includes('pending/pub-000001.xdr'), 'unpublished batch\'s proposal held back');
  for (let i = 12; i < 24; i++) w.pipe.push(iv(i));                  // batch 1 now exists
  const r2 = publishOnce(w.o);
  assert(r2.phase1.includes('batches/pub-000001.json'), 'batch 1 published in phase 1');
  assert(r2.phase2.includes('pending/pub-000001.xdr'), 'its proposal follows in phase 2');
});

test('nothing changed → no commit; files removed locally stay published (append-only)', () => {
  const w = setup();
  for (let i = 0; i < 12; i++) w.pipe.push(iv(i));
  fs.mkdirSync(path.join(w.feed, 'pending'), { recursive: true });
  fs.writeFileSync(path.join(w.feed, 'pending', 'pub-000000.xdr'), 'XDR\n');
  publishOnce(w.o);
  const n = commits(w.remote);
  publishOnce(w.o);
  eq(commits(w.remote), n, 'idle tick makes no commit');
  fs.unlinkSync(path.join(w.feed, 'pending', 'pub-000000.xdr'));      // the proposer clears it after anchoring
  publishOnce(w.o);
  assert(lsRemote(w.remote).includes('pending/pub-000000.xdr'), 'still published');
});

test('a fresh worktree resumes against an existing branch without rewriting history', () => {
  const w = setup();
  for (let i = 0; i < 12; i++) w.pipe.push(iv(i));
  publishOnce(w.o);
  const n = commits(w.remote);
  fs.rmSync(w.o.work, { recursive: true, force: true });             // host rebuilt
  for (let i = 12; i < 24; i++) w.pipe.push(iv(i));
  publishOnce(w.o);
  assert(commits(w.remote) > n, 'history continued, not replaced');
  const bytes = execFileSync('git', ['--git-dir', w.remote, 'show', 'feed:batches/pub-000000.json'], { encoding: 'utf8' });
  eq(bytes, fs.readFileSync(path.join(w.feed, 'batches', 'pub-000000.json'), 'utf8'), 'published bytes identical to the feed (no EOL conversion)');
});

(async () => {
  console.log('\nops publish-feed');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message.split('\n')[0]); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
