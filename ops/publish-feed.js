#!/usr/bin/env node
/**
 * QWATT — publish a run to its public repository (docs/ARCHITECTURE-FREEZE-v3.md, V3-7)
 * ---------------------------------------------------------------------------
 *   node ops/publish-feed.js --kind evidence|verifier-log --feed <dir> --run <name>
 *        (--remote <git URL> [--branch main] [--work <dir>] [--ssh-key <path>] | --dir <dir>)
 *        [--interval 120] [--once]
 *
 * Two repositories, written from two hosts that share no credential and no file:
 *
 *   --kind evidence       proposer host → academiaseul/qwatt-evidence, main, <run>/
 *                         index.json · faults.json · batches/<id>.json · raw/<id>.jsonl ·
 *                         samples/<name>.csv · samples/manifest.jsonl ·
 *                         ledger/{batches,accepted,rejected}.jsonl · pending/<id>.xdr · anchored/<id>.json
 *   --kind verifier-log   verifier host → academiaseul/qwatt-verifier-log, main, <run>/
 *                         decisions.jsonl · refusals.jsonl · status.json
 *
 * Each repository is a public history: anyone can clone it and check, with
 * ops/evidence-audit.js, that no commit rewrote or removed what an earlier one
 * published. The rules, checked before anything is written; any violation
 * refuses the whole tick and nothing is pushed:
 *   - only the layout above is published, under <run>/; anything else in --feed is skipped;
 *   - a published file is never rewritten, except index.json, a pending envelope replaced
 *     for the same batch, and the verifier's status.json (DV-8);
 *   - a ledger .jsonl only grows (its published bytes stay a prefix), and only up to its
 *     last complete line; raw/<id>.jsonl is written once, with its batch;
 *   - a file that looks like a secret key (a Stellar secret seed, a PEM private key) is
 *     never published.
 * File by file, with each field: protocol/FEED-FORMAT.md.
 *
 * Consistent snapshots. The pipeline writes raw file → batch file → batch-ledger line →
 * index.json (batch/feed.js); the publisher reads in the reverse order, index first, and
 * cuts every ledger at the head it read. Each commit is therefore a feed that
 * batch/verify-cli.js accepts, even when a batch closes during the tick.
 *
 * Two phases (evidence), so a proposal is never public before its batch:
 *   1. everything except pending/ → commit → push;
 *   2. pending/<id>.xdr only once batches/<id>.json is on the remote (and raw/<id>.jsonl,
 *      when the batch carries samples_root) → commit → push.
 * A push that failed is retried at the start of the next tick.
 *
 * Only this host writes the run. A push the remote rejects because its branch moved on is
 * retried once, on top of it, when every commit it gained is a single-parent commit that only
 * adds or edits README.md or LICENSE (the owner's documentation): this host's unpushed commits
 * are replayed there (they were never public). Any other outside commit, or a rewritten
 * remote history, refuses the tick (IntegrityError) and nothing is pushed.
 *
 * Deploy key: --ssh-key passes the key's path to ssh (IdentitiesOnly, BatchMode). This
 * program never opens, reads or stores the key. Each key lives only on its own host.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('../protocol/evidence');

const NAME = '[A-Za-z0-9._-]+';                         // no slash: temporary names (x.json.tmp-123) never match
const rx = (s) => new RegExp(`^(?:${s})$`);

const KINDS = {
  evidence: {
    repo: 'qwatt-evidence',
    author: { name: 'QWATT evidence publisher (proposer host)', email: 'evidence@qwatt.invalid' },
    twoPhase: true,
    layout: ['index\\.json', 'faults\\.json', `batches/${NAME}\\.json`, `raw/${NAME}\\.jsonl`, `samples/${NAME}\\.csv`, 'samples/manifest\\.jsonl',
      'ledger/(?:batches|accepted|rejected)\\.jsonl', `pending/${NAME}\\.xdr`, `anchored/${NAME}\\.json`].map(rx),
    mutable: ['index\\.json', `pending/${NAME}\\.xdr`].map(rx),
    growOnly: ['ledger/(?:batches|accepted|rejected)\\.jsonl', 'samples/manifest\\.jsonl'].map(rx),
  },
  'verifier-log': {
    repo: 'qwatt-verifier-log',
    author: { name: 'QWATT verifier log publisher (verifier host)', email: 'verifier-log@qwatt.invalid' },
    twoPhase: false,
    layout: ['decisions\\.jsonl', 'refusals\\.jsonl', 'status\\.json'].map(rx),
    mutable: [rx('status\\.json')],                       // DV-8: replaced on each publication
    growOnly: ['decisions\\.jsonl', 'refusals\\.jsonl'].map(rx),
  },
};
/** Written once at the repository root: serve bytes verbatim (no EOL conversion, no Jekyll). */
const ROOT_FILES = { '.gitattributes': '* -text\n', '.nojekyll': '' };
/** The repository's own documentation, kept by its owner: may be added or edited on the remote, never deleted. */
const REPO_FILES = ['README.md', 'LICENSE'];
/** In the publisher's worktree: the last commit it pushed. A remote that no longer holds it was rewritten. */
const PUSHED_REF = 'refs/qwatt/pushed';
const RUN_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SECRET_RE = /\bS[A-Z2-7]{55}\b|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const ID_RE = rx(NAME);
const NET_TIMEOUT_MS = 120e3;
const EMPTY = Buffer.alloc(0);

class IntegrityError extends Error {
  constructor(problems) { super(problems.join('; ')); this.name = 'IntegrityError'; this.problems = problems; }
}
/** The feed was caught between two of its writer's steps: publish nothing this tick. */
class FeedMidWrite extends Error {
  constructor(m) { super(m); this.name = 'FeedMidWrite'; }
}
class UsageError extends Error {
  constructor(m) { super(m); this.name = 'UsageError'; }
}

const kindOf = (kind) => { if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new UsageError(`unknown kind ${JSON.stringify(kind)} (evidence or verifier-log)`); return KINDS[kind]; };
const matches = (list, rel) => list.some((r) => r.test(rel));
const inLayout = (kind, rel) => matches(kindOf(kind).layout, rel);
/** The last line of a git error that says what happened (git's "hint:" lines are advice, never the reason). */
const lastReason = (text) => String(text || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^hint:/.test(l)).pop();
const firstLine = (e) => lastReason(e && e.stderr) || lastReason(e && e.message) || lastReason(e) || 'error';

/** The bytes up to and including the last '\n'. Every .jsonl is published only through this. */
function completeLines(buf) {
  const i = buf.lastIndexOf(0x0a);
  return i < 0 ? EMPTY : buf.subarray(0, i + 1);
}

/** Parse complete JSON lines, with the byte offset just after each. */
function jsonLines(buf, rel) {
  const out = [];
  let start = 0, n = 0;
  while (start < buf.length) {
    const nl = buf.indexOf(0x0a, start);
    const end = nl < 0 ? buf.length : nl + 1;
    n++;
    const text = buf.toString('utf8', start, nl < 0 ? buf.length : nl).trim();
    if (text) {
      let obj;
      try { obj = JSON.parse(text); } catch (e) { throw new IntegrityError([`feed ${rel} line ${n} is not JSON`]); }
      out.push({ obj, end });
    }
    start = end;
  }
  return out;
}

/** Read <dir>/<rel> only if every component is a real directory and the last a regular file (symlinks are never followed). */
function readRegular(dir, rel) {
  const parts = rel.split('/');
  let p = dir;
  for (let i = 0; i < parts.length; i++) {
    p = path.join(p, parts[i]);
    let st;
    try { st = fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; }
    if (i < parts.length - 1 ? !st.isDirectory() : !st.isFile()) return null;
  }
  return fs.readFileSync(p);
}

/** Every path under dir, with lstat: regular files, and anything else (symlinks, devices) apart. */
function walk(dir) {
  const files = [], odd = [];
  const go = (rel) => {
    let names;
    try { names = fs.readdirSync(rel ? path.join(dir, rel) : dir); } catch (e) { return; }
    for (const name of names) {
      const r = rel ? `${rel}/${name}` : name;
      let st;
      try { st = fs.lstatSync(path.join(dir, r)); } catch (e) { continue; }   // removed meanwhile
      if (st.isDirectory()) go(r);
      else if (st.isFile()) files.push(r);
      else odd.push(r);
    }
  };
  go('');
  return { files, odd };
}

const carriesSamplesRoot = (buf) => { try { return 'samples_root' in JSON.parse(buf.toString('utf8')); } catch (e) { return true; } };

/**
 * What may be published this tick, read in the reverse of the writer's order.
 * @returns {{files: Map<string, Buffer>, pending: Map<string, Buffer>, skipped: string[], head: string|null}}
 */
function snapshot(kind, dir) {
  const K = kindOf(kind);
  const files = new Map(), pending = new Map();
  const read = (rel) => (matches(K.layout, rel) ? readRegular(dir, rel) : null);
  let head = null;

  if (kind === 'evidence') {
    /* (a) the head; without it only faults.json and the samples are eligible */
    const idxBuf = read('index.json');
    let listed = [];
    if (idxBuf) {
      let index;
      try { index = JSON.parse(idxBuf.toString('utf8')); } catch (e) { throw new FeedMidWrite('index.json does not parse'); }
      head = index.latest_batch_id;
      /* (b) the batch ledger, cut at the head index.json names */
      const bl = completeLines(read('ledger/batches.jsonl') || EMPTY);
      let cut = 0, last = null;
      for (const l of jsonLines(bl, 'ledger/batches.jsonl')) {
        if (!(l.obj.seq <= index.latest_seq)) break;
        if (typeof l.obj.batch_id !== 'string' || !ID_RE.test(l.obj.batch_id)) throw new IntegrityError([`feed ledger/batches.jsonl lists an invalid batch id ${JSON.stringify(l.obj.batch_id)}`]);
        listed.push(l.obj.batch_id); last = l.obj; cut = l.end;
      }
      if (!last || last.batch_id !== index.latest_batch_id) throw new FeedMidWrite(`ledger/batches.jsonl does not end at index.json's head ${index.latest_batch_id}`);
      files.set('index.json', idxBuf);
      files.set('ledger/batches.jsonl', bl.subarray(0, cut));
      /* (c) interval lines: listed batches, then the open one; cut before anything later */
      const known = new Set(listed);
      const open = E.batchId(index.site_id, index.latest_seq + 1);
      for (const k of ['accepted', 'rejected']) {
        const rel = `ledger/${k}.jsonl`;
        const buf = completeLines(read(rel) || EMPTY);
        let end = 0;
        for (const l of jsonLines(buf, rel)) { if (!known.has(l.obj.batch_id) && l.obj.batch_id !== open) break; end = l.end; }
        if (end > 0) files.set(rel, buf.subarray(0, end));
      }
    }
    /* (d) the samples manifest, and only the files it lists */
    const man = completeLines(read('samples/manifest.jsonl') || EMPTY);
    if (man.length) {
      files.set('samples/manifest.jsonl', man);
      for (const l of jsonLines(man, 'samples/manifest.jsonl')) {
        const rel = typeof l.obj.file === 'string' ? l.obj.file : '';
        if (!/^samples\//.test(rel) || !matches(K.layout, rel)) continue;
        const b = read(rel);
        if (!b) throw new FeedMidWrite(`samples/manifest.jsonl lists ${rel}, which is not there`);
        files.set(rel, b);
      }
    }
    /* (e) the run definition */
    const faults = read('faults.json');
    if (faults) files.set('faults.json', faults);
    /* (f) each listed batch, its raw lines (required once a batch carries samples_root) and its anchor record; (g) its proposal */
    for (const id of listed) {
      const b = read(`batches/${id}.json`);
      if (!b) throw new FeedMidWrite(`${id} is listed, but batches/${id}.json is not there`);
      files.set(`batches/${id}.json`, b);
      const raw = completeLines(read(`raw/${id}.jsonl`) || EMPTY);
      if (raw.length) files.set(`raw/${id}.jsonl`, raw);
      else if (carriesSamplesRoot(b)) throw new FeedMidWrite(`${id} carries samples_root, but raw/${id}.jsonl is not there`);
      const anchored = read(`anchored/${id}.json`);
      if (anchored) files.set(`anchored/${id}.json`, anchored);
      const pend = read(`pending/${id}.xdr`);
      if (pend) pending.set(`pending/${id}.xdr`, pend);
    }
  } else {
    for (const rel of ['decisions.jsonl', 'refusals.jsonl']) {
      const c = completeLines(read(rel) || EMPTY);
      if (c.length) files.set(rel, c);
    }
    const st = read('status.json');
    if (st) { try { JSON.parse(st.toString('utf8')); files.set('status.json', st); } catch (e) { /* being replaced: next tick */ } }
  }

  /* everything else: outside the layout → skipped; in the layout but not yet eligible → waits */
  const { files: all, odd } = walk(dir);
  const skipped = [];
  for (const rel of all) {
    if (files.has(rel) || pending.has(rel) || matches(K.layout, rel)) continue;
    if (!path.basename(rel).includes('.tmp-')) skipped.push(rel);
  }
  for (const rel of odd) skipped.push(`${rel} (not a regular file)`);
  return { files, pending, skipped, head };
}

/** Check every file against what the target already holds. @returns {{writes, problems}} */
function check(files, target, kind) {
  const K = kindOf(kind);
  const writes = [], problems = [];
  for (const [rel, buf] of files) {
    const at = `${target.run}/${rel}`;
    const published = target.published(rel);
    if (published && published.equals(buf)) continue;
    if (SECRET_RE.test(buf.toString('latin1'))) { problems.push(`${at}: looks like a secret key; never published`); continue; }
    if (!published) writes.push({ rel, buf, action: 'add' });
    else if (matches(K.mutable, rel)) writes.push({ rel, buf, action: 'replace' });
    else if (matches(K.growOnly, rel)) {
      if (buf.length > published.length && buf.subarray(0, published.length).equals(published)) writes.push({ rel, buf, action: 'grow' });
      else problems.push(`${at}: does not extend its published bytes`);
    } else problems.push(`${at}: published file would be rewritten`);
  }
  return { writes, problems };
}

/** Collect every violation first; throw IntegrityError (writing nothing) if there is any. */
function plan(files, target, kind) {
  const { writes, problems } = check(files, target, kind);
  if (problems.length) throw new IntegrityError(problems);
  return writes;
}

const isUrl = (s) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^[^/\\@]+@[^/\\:]+:/.test(s);
function sameRemote(a, b) {
  if (a === b) return true;
  if (isUrl(a) || isUrl(b)) return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
  const norm = (p) => { const r = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, ''); return process.platform === 'win32' ? r.toLowerCase() : r; };
  return norm(a) === norm(b);
}
const repoName = (remote) => String(remote).replace(/[\\/]+$/, '').split(/[\\/:]/).pop().replace(/\.git$/i, '').toLowerCase();

/** Each kind refuses the other kind's repository, before any git command. */
function checkRemoteKind(kind, remote) {
  for (const [other, K] of Object.entries(KINDS)) {
    if (other !== kind && repoName(remote) === K.repo) throw new UsageError(`kind ${kind} never publishes to ${K.repo}, the ${other} repository (${remote})`);
  }
}

/** The run's directory on a branch of a git remote, through a private worktree. */
class GitTarget {
  constructor({ remote, branch = 'main', work, run, sshKey, kind = 'evidence' }) {
    Object.assign(this, { remote, branch, work: path.resolve(work), run, sshKey, kind, K: kindOf(kind) });
    this.env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    if (sshKey) this.env.GIT_SSH_COMMAND = `ssh -i "${sshKey}" -o IdentitiesOnly=yes -o BatchMode=yes`;   // the path only; never opened here
  }

  git(args, o = {}) {
    return execFileSync('git', args, { cwd: o.cwd || this.work, env: this.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: o.timeout, maxBuffer: 64 << 20 });
  }

  ok(args) { try { this.git(args); return true; } catch (e) { return false; } }

  open() {
    if (!fs.existsSync(path.join(this.work, '.git'))) {
      const parent = path.dirname(this.work);
      fs.mkdirSync(parent, { recursive: true });
      let has;
      try { has = this.git(['ls-remote', '--heads', this.remote, `refs/heads/${this.branch}`], { cwd: parent, timeout: NET_TIMEOUT_MS }).trim().length > 0; }
      catch (e) { throw new Error(`cannot reach ${this.remote}: ${firstLine(e)}`); }
      if (has) {
        this.git(['clone', '--quiet', '-c', 'core.autocrlf=false', '--single-branch', '--branch', this.branch, this.remote, this.work], { cwd: parent, timeout: NET_TIMEOUT_MS });
      } else {
        fs.mkdirSync(this.work, { recursive: true });
        this.git(['init', '--quiet']);
        this.git(['checkout', '--quiet', '--orphan', this.branch]);
        this.git(['remote', 'add', 'origin', this.remote]);
      }
    }
    const url = this.git(['remote', 'get-url', 'origin']).trim();
    if (!sameRemote(url, this.remote)) throw new Error(`worktree ${this.work} belongs to ${url}, not ${this.remote}`);
    for (const [k, v] of [['user.name', this.K.author.name], ['user.email', this.K.author.email], ['core.autocrlf', 'false'], ['gc.auto', '256']]) this.git(['config', k, v]);
    for (const [f, text] of Object.entries(ROOT_FILES)) if (!fs.existsSync(path.join(this.work, f))) fs.writeFileSync(path.join(this.work, f), text);
    fs.mkdirSync(path.join(this.work, this.run), { recursive: true });
  }

  published(rel) {
    try { return fs.readFileSync(path.join(this.work, this.run, rel)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }

  isPushed(rel) { return this.ok(['cat-file', '-e', `refs/remotes/origin/${this.branch}:${this.run}/${rel}`]); }

  write(rel, buf) {
    const file = path.join(this.work, this.run, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = path.join(this.work, '.git', `qwatt-publish.tmp-${process.pid}`);   // outside the tree: a crash never leaves a stray file to commit
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
  }

  /** Stage the run and the root files; refuse a deletion or anything outside the layout. @returns number of files committed */
  commit(message) {
    this.git(['add', '-A', '--', this.run, ...Object.keys(ROOT_FILES)]);
    const out = this.git(['diff', '--cached', '--name-status', '--no-renames', '-z']).split('\0').filter(Boolean);
    const problems = [];
    let n = 0;
    for (let i = 0; i + 1 < out.length; i += 2) {
      const st = out[i], p = out[i + 1];
      n++;
      const rel = p.startsWith(`${this.run}/`) ? p.slice(this.run.length + 1) : null;
      if (st === 'D') problems.push(`${p}: would be deleted`);
      else if (Object.prototype.hasOwnProperty.call(ROOT_FILES, p)) { if (st !== 'A') problems.push(`${p}: would be rewritten`); }
      else if (rel == null || !matches(this.K.layout, rel)) problems.push(`${p}: outside the run's layout`);
      else if (st === 'M' && !matches(this.K.mutable, rel) && !matches(this.K.growOnly, rel)) problems.push(`${p}: published file would be rewritten`);
      else if (st !== 'A' && st !== 'M') problems.push(`${p}: changed type`);
    }
    if (problems.length) { this.git(['reset', '-q']); throw new IntegrityError(problems); }
    if (!n) return 0;
    this.git(['commit', '--quiet', '-m', typeof message === 'function' ? message(n) : message]);
    return n;
  }

  /** Push when the branch is not on the remote yet or HEAD is ahead of it. @returns whether a push happened */
  push() {
    if (!this.ok(['rev-parse', '-q', '--verify', 'HEAD'])) return false;
    const tracking = `refs/remotes/origin/${this.branch}`;
    if (this.ok(['rev-parse', '-q', '--verify', tracking]) && this.git(['rev-list', '--count', `${tracking}..HEAD`]).trim() === '0') return false;
    const push = () => {
      this.git(['push', '--quiet', 'origin', `HEAD:refs/heads/${this.branch}`], { timeout: NET_TIMEOUT_MS });   // also moves the remote-tracking ref
      this.git(['update-ref', PUSHED_REF, 'HEAD']);
    };
    try { push(); return true; }
    catch (e) { if (!this.catchUp()) throw new Error(`push to ${this.remote} failed: ${firstLine(e)}`); }
    try { push(); } catch (e) { throw new Error(`push to ${this.remote} failed: ${firstLine(e)}`); }
    return true;
  }

  /**
   * The push was rejected: has the remote branch moved on? Fetch it. When every commit it gained is a
   * single-parent commit that only adds or edits README.md or LICENSE, replay this host's unpushed
   * commits on top (a rebase; they were never public). Anything else refuses (IntegrityError), and so
   * does a remote that no longer holds what this worktree last pushed (a rewritten history), on
   * every later tick too.
   * @returns {boolean} true once rebased; false when the remote gained nothing (the push failed for another reason)
   */
  catchUp() {
    const tracking = `refs/remotes/origin/${this.branch}`;
    const known = [tracking, PUSHED_REF].filter((r) => this.ok(['rev-parse', '-q', '--verify', r])).map((r) => this.git(['rev-parse', r]).trim());
    try { this.git(['fetch', '--quiet', 'origin', `+refs/heads/${this.branch}:${tracking}`], { timeout: NET_TIMEOUT_MS }); } catch (e) { return false; }
    if (!this.ok(['rev-parse', '-q', '--verify', tracking])) return false;
    const gained = this.git(['rev-list', '--reverse', '--parents', `HEAD..${tracking}`]).trim().split('\n').filter(Boolean).map((l) => l.split(' '));
    if (!gained.length) return false;
    const refuse = (why) => new IntegrityError([`${this.remote} ${this.branch}: ${why}, not made by this host; only README.md and LICENSE edits are replayed, so nothing is pushed`]);
    if (known.some((c) => !this.ok(['merge-base', '--is-ancestor', c, tracking]))) throw refuse('the remote history was rewritten');
    for (const [c, ...parents] of gained) {
      if (parents.length > 1) throw refuse(`merge commit ${c.slice(0, 7)}`);
      const ch = this.git(['diff-tree', '--root', '-r', '--no-commit-id', '--name-status', '--no-renames', '-z', c]).split('\0').filter(Boolean);
      for (let i = 0; i + 1 < ch.length; i += 2) {
        if (!REPO_FILES.includes(ch[i + 1]) || (ch[i] !== 'A' && ch[i] !== 'M')) throw refuse(`commit ${c.slice(0, 7)} ${ch[i] === 'D' ? 'deletes' : 'changes'} ${ch[i + 1]}`);
      }
    }
    /* --autostash: a crashed tick may have left written, uncommitted files; they are committed on this tick */
    try { this.git(['rebase', '--quiet', '--autostash', tracking]); }
    catch (e) { this.ok(['rebase', '--abort']); throw refuse(`cannot replay this host's commits on top of ${tracking} (${firstLine(e)})`); }
    return true;
  }
}

/** The same API over <dir>/<run>/, for tests and local runs: atomic writes, no history. */
class DirTarget {
  constructor({ dir, run }) { this.dir = path.resolve(dir); this.run = run; this.dirty = 0; }
  open() { fs.mkdirSync(path.join(this.dir, this.run), { recursive: true }); }
  published(rel) {
    try { return fs.readFileSync(path.join(this.dir, this.run, rel)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  isPushed(rel) { return fs.existsSync(path.join(this.dir, this.run, rel)); }
  write(rel, buf) {
    const file = path.join(this.dir, this.run, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
    this.dirty++;
  }
  commit() { const n = this.dirty; this.dirty = 0; return n; }
  push() { return false; }
}

/**
 * One publication tick.
 * @param {object} o  {kind='evidence', feed, run, remote|dir|target, branch='main', work, sshKey, now=Date.now}
 * @returns {{phase1: string[], phase2: string[], skipped: string[], pushed: boolean, waited?: string}}
 */
function publishOnce(o) {
  const kind = o.kind || 'evidence';
  const K = kindOf(kind);
  if (typeof o.run !== 'string' || !RUN_RE.test(o.run)) throw new UsageError(`run must match ${RUN_RE} (got ${JSON.stringify(o.run)})`);
  if (['remote', 'dir', 'target'].filter((k) => o[k] != null).length !== 1) throw new UsageError('give exactly one of remote, dir or target');
  if (!o.feed) throw new UsageError('feed directory is required');
  if (o.remote != null) checkRemoteKind(kind, o.remote);
  const target = o.target || (o.dir != null
    ? new DirTarget({ dir: o.dir, run: o.run })
    : new GitTarget({ remote: o.remote, branch: o.branch || 'main', work: o.work || path.join('ops-state', `${kind}-repo`), run: o.run, sshKey: o.sshKey, kind }));
  const at = new Date((o.now || Date.now)()).toISOString();

  target.open();
  let pushed = target.push();                                          // a push that failed on an earlier tick

  let snap;
  try { snap = snapshot(kind, o.feed); } catch (e) {
    if (e instanceof FeedMidWrite) return { phase1: [], phase2: [], skipped: [], pushed, waited: e.message };
    throw e;
  }
  /* every violation, proposals included, before anything is written */
  const p1 = check(snap.files, target, kind), p2 = check(snap.pending, target, kind);
  if (p1.problems.length || p2.problems.length) throw new IntegrityError([...p1.problems, ...p2.problems]);

  /* phase 1: everything except proposals */
  for (const w of p1.writes) target.write(w.rel, w.buf);
  const phase1 = p1.writes.map((w) => w.rel);
  const msg1 = kind === 'evidence'
    ? (n) => `feed ${at} · head ${snap.head || '—'} · ${n} file(s)`
    : () => `log ${at} · ${phase1.join(', ') || 'root files'}`;
  if (target.commit(msg1)) pushed = target.push() || pushed;

  /* phase 2: a proposal only once its batch (and its raw lines) are on the remote */
  let phase2 = [];
  if (K.twoPhase) {
    const ready = new Map();
    for (const [rel, buf] of snap.pending) {
      const id = rel.slice('pending/'.length, -'.xdr'.length);
      if (!target.isPushed(`batches/${id}.json`)) continue;
      if (carriesSamplesRoot(target.published(`batches/${id}.json`) || EMPTY) && !target.isPushed(`raw/${id}.jsonl`)) continue;
      ready.set(rel, buf);
    }
    const writes = plan(ready, target, kind);
    for (const w of writes) target.write(w.rel, w.buf);
    phase2 = writes.map((w) => w.rel);
    if (target.commit(() => `proposal ${at} · ${phase2.map((r) => path.basename(r, '.xdr')).join(', ')}`)) pushed = target.push() || pushed;
  }
  return { phase1, phase2, skipped: snap.skipped, pushed };
}

const USAGE = 'usage: node ops/publish-feed.js --kind evidence|verifier-log --feed <dir> --run <name> (--remote <git URL> [--branch main] [--work <dir>] [--ssh-key <path>] | --dir <dir>) [--interval 120] [--once]';

/** Parse and validate the command line; throws UsageError (exit 2) before any git command. */
function parseArgs(argv) {
  const VALUES = ['--kind', '--feed', '--run', '--remote', '--branch', '--work', '--ssh-key', '--dir', '--interval'];
  const a = {};
  let once = false;
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--once') { once = true; continue; }
    if (!VALUES.includes(k)) throw new UsageError(`unknown argument ${k}`);
    const v = argv[++i];
    if (v == null || v.startsWith('--')) throw new UsageError(`${k} needs a value`);
    a[k] = v;
  }
  if (!a['--kind']) throw new UsageError('--kind evidence|verifier-log is required');
  const kind = a['--kind'];
  kindOf(kind);
  if (!a['--feed']) throw new UsageError('--feed <dir> is required');
  if (!a['--run'] || !RUN_RE.test(a['--run'])) throw new UsageError(`--run <name> is required and must match ${RUN_RE}`);
  if ((a['--remote'] != null) === (a['--dir'] != null)) throw new UsageError('give exactly one of --remote or --dir');
  if (a['--dir'] != null && ['--branch', '--work', '--ssh-key'].some((k) => a[k] != null)) throw new UsageError('--branch, --work and --ssh-key go with --remote');
  const interval = Number(a['--interval'] ?? 120);
  if (!(interval > 0)) throw new UsageError('--interval must be a positive number of seconds');
  if (a['--remote'] != null) checkRemoteKind(kind, a['--remote']);
  return {
    kind, feed: path.resolve(a['--feed']), run: a['--run'],
    remote: a['--remote'], branch: a['--branch'] || 'main', work: path.resolve(a['--work'] || path.join('ops-state', `${kind}-repo`)), sshKey: a['--ssh-key'],
    dir: a['--dir'] != null ? path.resolve(a['--dir']) : undefined,
    interval, once,
  };
}

function cli() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); console.error(USAGE); process.exit(2); }
  const reported = new Set();
  const tick = () => {
    const at = new Date().toISOString();
    try {
      const r = publishOnce(o);
      const fresh = r.skipped.filter((s) => !reported.has(s));
      for (const s of fresh) reported.add(s);
      if (fresh.length) console.log(at, `skipped (outside the layout, never published): ${fresh.join(', ')}`);
      if (r.waited) console.log(at, `feed mid-write, nothing published this tick: ${r.waited}`);
      else if (r.phase1.length || r.phase2.length) console.log(at, `published ${r.phase1.length} file(s)` + (r.phase2.length ? ` + ${r.phase2.length} proposal(s)` : '') + ` to ${o.run}/`);
      else if (r.pushed) console.log(at, 'published: pushed a commit left from an earlier tick');
      return 0;
    } catch (e) {
      if (e instanceof IntegrityError) console.error(at, `PUBLISH REFUSED (nothing pushed): ${e.problems.join('; ')}`);
      else console.error(at, `publish failed (will retry): ${firstLine(e)}`);
      return 1;
    }
  };
  if (o.once) { process.exitCode = tick(); return; }
  tick();
  setInterval(tick, o.interval * 1000);
}

if (require.main === module) cli();

module.exports = {
  publishOnce, snapshot, plan, GitTarget, DirTarget, IntegrityError, FeedMidWrite, UsageError, KINDS,
  ROOT_FILES, REPO_FILES, RUN_RE, SECRET_RE, inLayout, completeLines, parseArgs, sameRemote, firstLine,
};
