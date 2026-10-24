#!/usr/bin/env node
/**
 * QWATT — audit the public history of an evidence repository (docs/ARCHITECTURE-FREEZE-v3.md, V3-7)
 * ---------------------------------------------------------------------------
 *   node ops/evidence-audit.js <clone or bare repo> [--kind evidence|verifier-log] [--branch main]
 *                              [--since <commit>] [--recorded <decisions.jsonl>] [--json]
 *
 * Needs git and Node only (no npm dependency, no network). Replays every commit of the
 * branch, in order, against the rules ops/publish-feed.js publishes by:
 *   - one parent per commit (a merge commit is named);
 *   - an added path is README.md, LICENSE, .gitattributes, .nojekyll, or <run>/<file> in the
 *     kind's layout; an added .jsonl ends with a complete line;
 *   - a modified path is index.json, a pending envelope or status.json (replaced), a ledger
 *     .jsonl that only grew (the old bytes are its prefix and it ends with '\n'), or README.md
 *     and LICENSE (the repository's own documentation, edited by its owner); anything else
 *     modified is "rewritten";
 *   - nothing is deleted, and nothing changes type;
 *   - pending/<id>.xdr is added only in a commit after the one that published
 *     batches/<id>.json (and raw/<id>.jsonl, once the batch carries samples_root).
 * --since <commit> (a head recorded earlier, e.g. in the write-up) must still be in the
 * history: a force-push that removed it is reported.
 * --recorded <decisions.jsonl> (the verifier's public log, V3-7c): every evidence commit the
 * verifier judged (each line's non-null feed_commit) must still be in the history of the
 * branch; one that is not is reported as "commit <c> the verifier judged is not in this history".
 * A commit this clone does not hold at all is reported as "not in this clone" instead: the clone
 * may be older than the log (clone the verifier log first, then the evidence, and re-run); if a
 * clone taken after the log still lacks it, the history was rewritten.
 *
 * Exit 0: "<n> commits · public history intact". Exit 1: the problems. Exit 2: usage.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { KINDS, ROOT_FILES, REPO_FILES, RUN_RE } = require('./publish-feed');

const CHUNK_BYTES = 64 << 20;

const matches = (list, rel) => list.some((r) => r.test(rel));

function gitIn(dir) {
  const g = (args, o = {}) => execFileSync('git', ['-C', dir, ...args], {
    encoding: o.buf ? null : 'utf8', input: o.input, stdio: [o.input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30,
  });
  g.ok = (args) => { try { g(args); return true; } catch (e) { return false; } };
  return g;
}

/** Blob contents for a list of ids, one `git cat-file --batch` call. */
function loadBlobs(g, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const buf = g(['cat-file', '--batch'], { input: ids.join('\n') + '\n', buf: true });
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    const [id, type, size] = buf.toString('utf8', pos, nl).split(' ');
    if (type === 'missing') { pos = nl + 1; continue; }
    const n = Number(size);
    out.set(id, buf.subarray(nl + 1, nl + 1 + n));
    pos = nl + 1 + n + 1;
  }
  return out;
}

/**
 * @param {string} gitDir  a clone or a bare repository
 * @param {{kind?: string, branch?: string, since?: string, recorded?: string}} [o]   recorded: a decisions.jsonl path
 * @returns {{ok: boolean, commits: number, problems: string[]}}
 */
function auditHistory(gitDir, { kind = 'evidence', branch = 'main', since, recorded } = {}) {
  const K = KINDS[kind];
  if (!K) throw new Error(`unknown kind ${JSON.stringify(kind)} (evidence or verifier-log)`);
  if (recorded != null && kind !== 'evidence') throw new Error('--recorded names evidence commits: audit the evidence repository (--kind evidence)');
  const g = gitIn(gitDir);
  const problems = [];

  if (since) {
    if (!g.ok(['cat-file', '-e', `${since}^{commit}`])) problems.push(`--since ${since}: not in this history (rewritten, or fetch first)`);
    else if (!g.ok(['merge-base', '--is-ancestor', since, branch])) problems.push(`--since ${since}: history rewritten since ${since}`);
  }
  if (recorded != null) {
    for (const c of recordedCommits(recorded)) {
      if (!/^[0-9a-f]{40}$/.test(c)) problems.push(`--recorded: feed_commit ${JSON.stringify(c)} is not a commit id`);
      else if (!g.ok(['cat-file', '-e', `${c}^{commit}`])) problems.push(`commit ${c} the verifier judged is not in this clone: clone the evidence again, after the verifier log, and re-run; if it is still missing, the history was rewritten`);
      else if (!g.ok(['merge-base', '--is-ancestor', c, branch])) problems.push(`commit ${c} the verifier judged is not in this history`);
    }
  }

  const revs = g(['rev-list', '--reverse', '--parents', branch]).trim().split('\n').filter(Boolean).map((l) => l.split(' '));
  /* every single-parent (or root) commit's diff, in one call */
  const linear = revs.filter(([, ...p]) => p.length <= 1);
  const diffs = new Map();
  if (linear.length) {
    const raw = g(['diff-tree', '--stdin', '-r', '--root', '--no-renames', '--raw', '--no-abbrev', '-z'], { input: linear.map((r) => r.join(' ')).join('\n') + '\n' });
    const tok = raw.split('\0');
    let cur = null;
    for (let i = 0; i < tok.length; i++) {
      const t = tok[i];
      if (!t) continue;
      if (t[0] === ':') {
        const [sm, dm, s, d, st] = t.slice(1).split(' ');
        diffs.get(cur).push({ sm, dm, s, d, st, p: tok[++i] });
      } else { cur = t.trim(); diffs.set(cur, []); }
    }
  }

  const splitRun = (p) => {
    const i = p.indexOf('/');
    if (i < 0) return null;
    const run = p.slice(0, i), rel = p.slice(i + 1);
    return RUN_RE.test(run) && matches(K.layout, rel) ? { run, rel } : null;
  };

  /* pass 1: replay the tree; every rule that needs no file content */
  const tree = new Map();                                              // path → blob id, as of the commit being checked
  const checks = [];
  for (const [c, ...parents] of revs) {
    const short = c.slice(0, 7);
    if (parents.length > 1) {
      problems.push(`${short}: merge commit`);
      tree.clear();
      for (const line of g(['ls-tree', '-r', '-z', c]).split('\0').filter(Boolean)) { const [meta, p] = line.split('\t'); tree.set(p, meta.split(' ')[2]); }
      continue;
    }
    const entries = diffs.get(c) || [];
    for (const e of entries) {
      const where = `${short} ${e.p}`;
      if (e.st === 'D') { problems.push(`${where}: deleted`); continue; }
      if (e.st !== 'A' && e.st !== 'M') { problems.push(`${where}: changed type`); continue; }
      if (e.dm !== '100644' && e.dm !== '100755') { problems.push(`${where}: not a regular file`); continue; }
      if (REPO_FILES.includes(e.p)) continue;
      if (Object.prototype.hasOwnProperty.call(ROOT_FILES, e.p)) { if (e.st === 'M') problems.push(`${where}: rewritten`); continue; }
      const rp = splitRun(e.p);
      if (!rp) { problems.push(`${where}: outside the layout`); continue; }
      if (e.st === 'A') {
        if (rp.rel.endsWith('.jsonl')) checks.push({ type: 'complete', where, path: e.p, id: e.d });
        const m = /^pending\/(.+)\.xdr$/.exec(rp.rel);
        if (m) {
          const b = `${rp.run}/batches/${m[1]}.json`;
          if (!tree.has(b)) problems.push(`${where}: proposal published before its batch`);
          else checks.push({ type: 'raw', where, id: tree.get(b), rawBefore: tree.has(`${rp.run}/raw/${m[1]}.jsonl`) });
        }
      } else if (matches(K.mutable, rp.rel)) {
        /* replaced, as the layout allows */
      } else if (matches(K.growOnly, rp.rel)) {
        checks.push({ type: 'grow', where, path: e.p, old: e.s, id: e.d });
      } else problems.push(`${where}: rewritten`);
    }
    for (const e of entries) { if (e.st === 'D') tree.delete(e.p); else tree.set(e.p, e.d); }
  }

  /* pass 2: content rules, reading each blob once, in chunks */
  const last = new Map();
  for (const ch of checks) {
    if (ch.type === 'grow') ch.needOld = last.get(ch.path) !== ch.old;
    if (ch.type !== 'raw') last.set(ch.path, ch.id);
  }
  const needs = (ch) => (ch.type === 'grow' && ch.needOld ? [ch.old, ch.id] : [ch.id]);
  const unique = [...new Set(checks.flatMap(needs))];
  const sizes = new Map();
  if (unique.length) {
    for (const l of g(['cat-file', '--batch-check'], { input: unique.join('\n') + '\n' }).split('\n').filter(Boolean)) { const [id, , size] = l.split(' '); sizes.set(id, Number(size) || 0); }
  }
  const lastBuf = new Map();                                           // path → {id, buf}: the previous version of each .jsonl
  for (let i = 0; i < checks.length;) {
    let j = i, total = 0;
    const want = new Set();
    while (j < checks.length && (j === i || total < CHUNK_BYTES)) { for (const id of needs(checks[j])) if (!want.has(id)) { want.add(id); total += sizes.get(id) || 0; } j++; }
    const blobs = loadBlobs(g, [...want]);
    for (let k = i; k < j; k++) {
      const ch = checks[k];
      const buf = blobs.get(ch.id);
      if (!buf) { problems.push(`${ch.where}: blob ${ch.id.slice(0, 7)} missing`); continue; }
      if (ch.type === 'complete') {
        if (!buf.length || buf[buf.length - 1] !== 0x0a) problems.push(`${ch.where}: ends mid-line`);
      } else if (ch.type === 'grow') {
        const prev = lastBuf.get(ch.path);
        const old = prev && prev.id === ch.old ? prev.buf : blobs.get(ch.old);
        if (!old) problems.push(`${ch.where}: blob ${ch.old.slice(0, 7)} missing`);
        else if (!(buf.length > old.length && buf.subarray(0, old.length).equals(old))) problems.push(`${ch.where}: does not extend its published bytes`);
        else if (buf[buf.length - 1] !== 0x0a) problems.push(`${ch.where}: ends mid-line`);
      } else if (ch.type === 'raw') {
        let root = true;
        try { root = 'samples_root' in JSON.parse(buf.toString('utf8')); } catch (e) { /* unreadable batch: treat as needing its raw file */ }
        if (root && !ch.rawBefore) problems.push(`${ch.where}: proposal published before its raw file`);
      }
      if (ch.type !== 'raw') lastBuf.set(ch.path, { id: ch.id, buf });
    }
    i = j;
  }

  return { ok: problems.length === 0, commits: revs.length, problems };
}

/**
 * The evidence commits a verifier log names: every non-null feed_commit of its decisions.jsonl, once
 * each, in order. A trailing line that does not parse (being written) is ignored; any other is an error.
 */
function recordedCommits(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const out = [];
  lines.forEach((l, i) => {
    let d;
    try { d = JSON.parse(l); } catch (e) { if (i < lines.length - 1) throw new Error(`${file} line ${i + 1} is not JSON`); return; }
    if (d && d.feed_commit != null && !out.includes(d.feed_commit)) out.push(d.feed_commit);
  });
  return out;
}

function cli() {
  const args = process.argv.slice(2);
  const usage = 'usage: node ops/evidence-audit.js <clone or bare repo> [--kind evidence|verifier-log] [--branch main] [--since <commit>] [--recorded <decisions.jsonl>] [--json]';
  const o = {};
  let dir = null, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') json = true;
    else if (['--kind', '--branch', '--since', '--recorded'].includes(a)) { const v = args[++i]; if (v == null) { console.error(usage); process.exit(2); } o[a.slice(2)] = v; }
    else if (a.startsWith('--') || dir) { console.error(usage); process.exit(2); }
    else dir = a;
  }
  if (!dir) { console.error(usage); process.exit(2); }
  if (o.kind && !KINDS[o.kind]) { console.error(`unknown kind ${o.kind}\n${usage}`); process.exit(2); }
  if (o.recorded != null) {
    if (o.kind && o.kind !== 'evidence') { console.error('--recorded names evidence commits: audit the evidence repository (--kind evidence)'); process.exit(2); }
    try { recordedCommits(o.recorded); } catch (e) { console.error(`cannot read --recorded ${o.recorded}: ${e.message}\n${usage}`); process.exit(2); }
  }
  let r;
  try { r = auditHistory(path.resolve(dir), o); } catch (e) { console.error(`cannot read ${dir}: ${String(e.stderr || e.message).trim().split('\n').pop()}`); process.exit(2); }
  if (json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const p of r.problems) console.log('  ✗ ' + p);
    console.log(r.ok ? `${r.commits} commits · public history intact` : `${r.commits} commits · ${r.problems.length} problem(s)`);
  }
  process.exitCode = r.ok ? 0 : 1;
}

if (require.main === module) cli();

module.exports = { auditHistory };
