#!/usr/bin/env node
/**
 * QWATT — verify a published evidence feed from its files alone
 * ---------------------------------------------------------------------------
 *   node batch/verify-cli.js <feed-dir> [--profile bench | --dataset <dataset.json>] [--verifier-log <dir|refusals.jsonl>] [--json]
 *
 * --verifier-log: the run's directory in a clone of qwatt-verifier-log (or its refusals.jsonl). A batch the
 * verifier refused is left out of the chain (V3-11): the next batch links past it, and only such a skip is
 * accepted. Without it, a skip is reported as a chain break.
 *
 * Walks ledger/batches.jsonl in order, loads each batch file, and re-derives
 * it with verifyBatch against the previous batch, the last batch published as
 * accepted (the floor: time, node and counted intervals), the rejected
 * ledger and the batch's raw lines (raw/<batch_id>.jsonl: samples_root
 * recomputed, every line tied to its interval; a missing file is
 * batch.raw_missing). It also checks that the index head matches the last batch
 * and that every interval-ledger line names a published batch.
 *
 * Exit 0: every batch published as "accepted" verifies, and every batch
 * published as "rejected" really fails and carries the previous total
 * forward unchanged (F6). Exit 1 otherwise.
 * This is the offline core the Deliverable 3 verifier service wraps.
 */

'use strict';

const path = require('path');
const { Feed } = require('./feed');
const V = require('./verify');
const E = require('../protocol/evidence');

/**
 * The batch ids a verifier log refused (V3-11): from its refusals.jsonl lines, every batch_id except one
 * refused only for verifier.walk_too_long (the rule of anchor/chain.js refusedIds, kept here so this CLI
 * needs nothing outside protocol/ and batch/).
 */
function refusedFromLines(lines) {
  const out = new Set();
  for (const l of lines || []) {
    if (!l || typeof l.batch_id !== 'string') continue;
    const rs = Array.isArray(l.reasons) ? l.reasons : [];
    if (rs.length && rs.every((r) => r === 'verifier.walk_too_long')) continue;
    out.add(l.batch_id);
  }
  return out;
}

function verifyFeed(dir, { profile, refused } = {}) {
  const R = refused instanceof Set ? refused : new Set(refused || []);
  const feed = new Feed(dir);
  const spec = V.SPEC;
  /* a profile is a spec profile name, or a full profile object (a dataset's derived profile) */
  const prof = profile && typeof profile === 'object' ? profile : (profile ? spec.profiles[profile] : spec.profiles.bench);
  if (!prof) throw new Error(`unknown profile ${profile}`);
  const listed = feed.readLedger('batches');
  const rejected = feed.readLedger('rejected');
  const accepted = feed.readLedger('accepted');
  const problems = [];
  const report = [];
  let prev = null, floor = null;
  const bySha = new Map();                                            // every batch read so far, by its hash

  listed.forEach((entry, i) => {
    if (entry.seq !== i) problems.push(`batches.jsonl line ${i + 1}: seq ${entry.seq}, expected ${i}`);
    if (!feed.hasBatch(entry.batch_id)) { problems.push(`${entry.batch_id}: listed but no batch file`); return; }
    const batch = feed.readBatch(entry.batch_id);
    /* V3-11: a batch is judged against the batch its link names; a link may skip only refused batches
       (verifyBatch, ctx.refused), and only a refused batch may be built on a refused one */
    const linked = batch.prev_hash === E.ZERO_HASH ? null : (bySha.get(batch.prev_hash) || prev);
    if (linked && R.has(linked.batch_id) && !R.has(entry.batch_id)) problems.push(`${entry.batch_id}: links to ${linked.batch_id}, which the verifier refused`);
    const res = V.verifyBatch(batch, { prev: linked, floor, rejected, raw: feed.readRaw(entry.batch_id), profile: prof, spec, status: entry.status, refused: R });
    bySha.set(batch.sha256, batch);
    const codes = res.failures.map((f) => f.code);
    if (batch.sha256 !== entry.sha256) problems.push(`${entry.batch_id}: ledger says ${entry.sha256.slice(0, 12)}…, file hashes to ${batch.sha256.slice(0, 12)}…`);
    if (entry.status === 'accepted' && !res.ok) problems.push(`${entry.batch_id}: published as accepted but fails ${codes.join(', ')}`);
    if (entry.status === 'rejected' && res.ok) problems.push(`${entry.batch_id}: published as rejected but verifies cleanly`);
    if (entry.status === 'rejected' && codes.includes('batch.cumulative_mismatch')) problems.push(`${entry.batch_id}: published as rejected but does not carry the previous total forward unchanged`);
    report.push({ batch_id: entry.batch_id, status: entry.status, ok: res.ok, failures: codes, energy_mwh: batch.energy_mwh });
    prev = batch;
    if (entry.status === 'accepted' && !R.has(entry.batch_id)) floor = batch;
  });

  /* interval lines may name a published batch, or the one batch still open */
  const known = new Set(listed.map((e) => e.batch_id));
  const isOpen = (id) => (prev ? id === E.batchId(prev.site_id, prev.seq + 1) : /-000000$/.test(id));
  const stray = [...accepted, ...rejected].find((l) => !known.has(l.batch_id) && !isOpen(l.batch_id));
  if (stray) problems.push(`ledger line names unpublished, non-open batch ${stray.batch_id}`);

  const idx = feed.readIndex();
  if (prev && (!idx || idx.head_sha256 !== prev.sha256 || idx.cumulative_mwh !== prev.cumulative_mwh)) {
    problems.push('index.json head does not match the last published batch');
  }

  return {
    ok: problems.length === 0,
    problems,
    batches: report.length,
    accepted_batches: report.filter((r) => r.status === 'accepted').length,
    rejected_batches: report.filter((r) => r.status === 'rejected').length,
    head_sha256: prev ? prev.sha256 : null,
    cumulative_mwh: prev ? prev.cumulative_mwh : 0,
    report,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const VALUED = new Set(['--profile', '--dataset', '--verifier-log']);
  const dir = args.find((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1]));
  if (!dir) { console.error('usage: node batch/verify-cli.js <feed-dir> [--profile bench] [--verifier-log <clone of the run in qwatt-verifier-log, or its refusals.jsonl>] [--json]'); process.exit(2); }
  const fs = require('fs');
  const pi = args.indexOf('--profile'), di = args.indexOf('--dataset'), li = args.indexOf('--verifier-log');
  const profile = di >= 0 ? JSON.parse(fs.readFileSync(args[di + 1], 'utf8')).profile : (pi >= 0 ? args[pi + 1] : undefined);
  /* V3-11: the verifier log of the run says which batches a link may skip */
  let refused;
  if (li >= 0) {
    let f = path.resolve(args[li + 1] || '');
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'refusals.jsonl');
    const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    refused = refusedFromLines(text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)));
  }
  const out = verifyFeed(path.resolve(dir), { profile, refused });
  if (args.includes('--json')) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`${out.batches} batches (${out.accepted_batches} accepted, ${out.rejected_batches} rejected) · cumulative ${out.cumulative_mwh} mWh · head ${out.head_sha256 || '—'}`);
    for (const p of out.problems) console.log('  ✗ ' + p);
    console.log(out.ok ? 'OK — every published batch re-derives from the feed' : 'FAILED');
  }
  process.exit(out.ok ? 0 : 1);
}

module.exports = { verifyFeed, refusedFromLines };
