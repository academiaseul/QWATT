#!/usr/bin/env node
/**
 * QWATT — verify a published evidence feed from its files alone
 * ---------------------------------------------------------------------------
 *   node batch/verify-cli.js <feed-dir> [--profile bench] [--json]
 *
 * Walks ledger/batches.jsonl in order, loads each batch file, and re-derives
 * it with verifyBatch against the previous batch and the rejected ledger. It
 * also checks that the index head matches the last batch and that every
 * interval-ledger line names a published batch.
 *
 * Exit 0: every batch published as "accepted" verifies, and every batch
 * published as "rejected" really fails. Exit 1 otherwise.
 * This is the offline core the Deliverable 3 verifier service wraps.
 */

'use strict';

const path = require('path');
const { Feed } = require('./feed');
const V = require('./verify');
const E = require('../protocol/evidence');

function verifyFeed(dir, { profile } = {}) {
  const feed = new Feed(dir);
  const spec = V.SPEC;
  const prof = profile ? spec.profiles[profile] : spec.profiles.bench;
  if (!prof) throw new Error(`unknown profile ${profile}`);
  const listed = feed.readLedger('batches');
  const rejected = feed.readLedger('rejected');
  const accepted = feed.readLedger('accepted');
  const problems = [];
  const report = [];
  let prev = null;

  listed.forEach((entry, i) => {
    if (entry.seq !== i) problems.push(`batches.jsonl line ${i + 1}: seq ${entry.seq}, expected ${i}`);
    if (!feed.hasBatch(entry.batch_id)) { problems.push(`${entry.batch_id}: listed but no batch file`); return; }
    const batch = feed.readBatch(entry.batch_id);
    const res = V.verifyBatch(batch, { prev, rejected, profile: prof, spec });
    if (batch.sha256 !== entry.sha256) problems.push(`${entry.batch_id}: ledger says ${entry.sha256.slice(0, 12)}…, file hashes to ${batch.sha256.slice(0, 12)}…`);
    if (entry.status === 'accepted' && !res.ok) problems.push(`${entry.batch_id}: published as accepted but fails ${res.failures.map((f) => f.code).join(', ')}`);
    if (entry.status === 'rejected' && res.ok) problems.push(`${entry.batch_id}: published as rejected but verifies cleanly`);
    report.push({ batch_id: entry.batch_id, status: entry.status, ok: res.ok, failures: res.failures.map((f) => f.code), energy_mwh: batch.energy_mwh });
    prev = batch;
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
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) { console.error('usage: node batch/verify-cli.js <feed-dir> [--profile bench] [--json]'); process.exit(2); }
  const pi = args.indexOf('--profile');
  const out = verifyFeed(path.resolve(dir), { profile: pi >= 0 ? args[pi + 1] : undefined });
  if (args.includes('--json')) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`${out.batches} batches (${out.accepted_batches} accepted, ${out.rejected_batches} rejected) · cumulative ${out.cumulative_mwh} mWh · head ${out.head_sha256 || '—'}`);
    for (const p of out.problems) console.log('  ✗ ' + p);
    console.log(out.ok ? 'OK — every published batch re-derives from the feed' : 'FAILED');
  }
  process.exit(out.ok ? 0 : 1);
}

module.exports = { verifyFeed };
