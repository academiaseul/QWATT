#!/usr/bin/env node
/**
 * QWATT — publish the evidence feed to a git branch served as static files
 * ---------------------------------------------------------------------------
 *   node ops/publish-feed.js --feed feed --remote git@github.com:academiaseul/qwatt.git
 *                            [--branch feed] [--work ops-state/feed-worktree] [--interval 120] [--once]
 *
 * Recommended host (docs/FOUNDER-CHECKLIST.md item 7): GitHub Pages serving the
 * `feed` branch. Free, public, and the commit history of the branch is itself an
 * append-only, timestamped record of what was published when.
 *
 * Two phases per tick, so a pending transaction is never public before its batch:
 *   1. copy everything except pending/ → commit → push;
 *   2. copy pending/<id>.xdr only for batches already in the published tree → commit → push.
 *
 * Never deletes from the published branch: evidence is append-only, and a file
 * the proposer later removes locally (a pending proposal that got anchored)
 * stays in history and in the tree. The verifier ignores pending files for
 * batches the chain has already anchored.
 *
 * Push credentials (a deploy key with write access to this one branch) live
 * only on the proposer host, in its git/ssh configuration. Nothing here reads
 * or stores them.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Clone the branch into `work`, or create it as an orphan if the remote does not have it yet. */
function ensureWorktree(o) {
  if (fs.existsSync(path.join(o.work, '.git'))) return;
  fs.mkdirSync(path.dirname(o.work), { recursive: true });
  let hasBranch = false;
  try { hasBranch = git(process.cwd(), 'ls-remote', '--heads', o.remote, o.branch).length > 0; } catch (e) { throw new Error(`cannot reach remote: ${e.message.split('\n')[0]}`); }
  if (hasBranch) {
    execFileSync('git', ['clone', '--quiet', '--single-branch', '--branch', o.branch, o.remote, o.work], { stdio: 'pipe' });
  } else {
    fs.mkdirSync(o.work, { recursive: true });
    git(o.work, 'init', '--quiet');
    git(o.work, 'checkout', '--quiet', '--orphan', o.branch);
    git(o.work, 'remote', 'add', 'origin', o.remote);
  }
  git(o.work, 'config', 'user.name', o.authorName || 'QWATT feed publisher');
  git(o.work, 'config', 'user.email', o.authorEmail || 'feed@qwatt.invalid');
  git(o.work, 'config', 'core.autocrlf', 'false');
  /* GitHub Pages: serve files verbatim, no Jekyll processing */
  fs.writeFileSync(path.join(o.work, '.nojekyll'), '');
  fs.writeFileSync(path.join(o.work, '.gitattributes'), '* -text\n');
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function* walk(dir, rel = '') {
  for (const name of fs.readdirSync(path.join(dir, rel))) {
    if (name.includes('.tmp-')) continue;                    // a file being written atomically
    const r = rel ? `${rel}/${name}` : name;
    const st = fs.statSync(path.join(dir, r));
    if (st.isDirectory()) yield* walk(dir, r);
    else yield r;
  }
}

/** Copy new or changed files matching `filter` into the worktree. @returns {string[]} copied paths */
function sync(feedDir, work, filter) {
  const copied = [];
  for (const rel of walk(feedDir)) {
    if (!filter(rel)) continue;
    const src = path.join(feedDir, rel), dst = path.join(work, rel);
    if (fs.existsSync(dst) && sha(dst) === sha(src)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied.push(rel);
  }
  return copied;
}

function commitAndPush(o, message) {
  git(o.work, 'add', '-A');
  if (!git(o.work, 'status', '--porcelain')) return false;
  git(o.work, 'commit', '--quiet', '-m', message);
  git(o.work, 'push', '--quiet', 'origin', `HEAD:refs/heads/${o.branch}`);
  return true;
}

/** One publication tick. @returns {{phase1:string[], phase2:string[]}} */
function publishOnce(o) {
  ensureWorktree(o);
  const now = new Date().toISOString();
  const idx = fs.existsSync(path.join(o.feed, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(o.feed, 'index.json'), 'utf8')) : {};

  const phase1 = sync(o.feed, o.work, (rel) => !rel.startsWith('pending/'));
  if (phase1.length) commitAndPush(o, `feed ${now} · head ${idx.latest_batch_id || '—'} · ${phase1.length} file(s)`);

  const phase2 = sync(o.feed, o.work, (rel) => {
    const m = /^pending\/(.+)\.xdr$/.exec(rel);
    return !!m && fs.existsSync(path.join(o.work, 'batches', `${m[1]}.json`));
  });
  if (phase2.length) commitAndPush(o, `proposal ${now} · ${phase2.map((p) => path.basename(p, '.xdr')).join(', ')}`);
  return { phase1, phase2 };
}

function cli() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const o = {
    feed: path.resolve(opt('--feed', 'feed')),
    remote: opt('--remote'),
    branch: opt('--branch', 'feed'),
    work: path.resolve(opt('--work', path.join('ops-state', 'feed-worktree'))),
  };
  if (!o.remote) { console.error('--remote <git URL> is required'); process.exit(2); }
  const run = () => {
    try {
      const r = publishOnce(o);
      if (r.phase1.length || r.phase2.length) console.log(new Date().toISOString(), `published ${r.phase1.length} file(s)` + (r.phase2.length ? ` + ${r.phase2.length} proposal(s)` : ''));
    } catch (e) { console.error(new Date().toISOString(), 'publish failed (will retry):', e.message.split('\n')[0]); }
  };
  run();
  if (!args.includes('--once')) setInterval(run, Number(opt('--interval', 120)) * 1000);
}

if (require.main === module) cli();

module.exports = { publishOnce, sync };
