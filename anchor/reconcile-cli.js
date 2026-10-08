#!/usr/bin/env node
/**
 * QWATT — reconcile the public feed against the chain, from the command line
 * ---------------------------------------------------------------------------
 *   node anchor/reconcile-cli.js --feed <base URL> --account G… [--horizon URL] [--json]
 *
 * Runs exactly the logic reconcile.html runs in a reviewer's browser
 * (assets/qwatt-reconcile.js) — this is the Deliverable 4 acceptance check.
 * No dependencies. Exit 0: RECONCILED or PENDING. Exit 1: BROKEN.
 */

'use strict';

const path = require('path');
const R = require(path.join(__dirname, '..', 'assets', 'qwatt-reconcile.js'));

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const feedUrl = opt('--feed'), account = opt('--account');
  const horizon = opt('--horizon', 'https://horizon-testnet.stellar.org');
  if (!feedUrl || !account) { console.error('usage: node anchor/reconcile-cli.js --feed <base URL> --account G… [--horizon URL] [--json]'); process.exit(2); }

  const [feed, anchors] = await Promise.all([R.fetchFeed(feedUrl), R.fetchAnchors(horizon, account)]);
  const rep = await R.reconcile(feed, anchors);
  if (args.includes('--json')) { console.log(JSON.stringify(rep, null, 2)); process.exit(rep.verdict === 'BROKEN' ? 1 : 0); }

  const s = rep.summary;
  console.log(`${rep.verdict}`);
  console.log(`  published ${s.published_batches} batches (${s.accepted_batches} accepted, ${s.rejected_batches} rejected) · anchored ${s.anchored_batches} in ${s.anchor_transactions} transactions`);
  console.log(`  cumulative published ${s.published_cumulative_mwh} mWh · anchored ${s.anchored_cumulative_mwh} mWh · last anchored ${s.last_anchored_batch || '—'}`);
  console.log(`  rejected intervals ${s.rejected_intervals}${Object.keys(s.rejected_by_reason).length ? ' · ' + Object.entries(s.rejected_by_reason).map(([k, v]) => `${k} ×${v}`).join(', ') : ''}`);
  if (s.awaiting_anchor.length) console.log(`  awaiting anchor: ${s.awaiting_anchor.join(', ')}`);
  for (const p of rep.problems) console.log('  ✗ ' + p);
  process.exit(rep.verdict === 'BROKEN' ? 1 : 0);
}

main().catch((e) => { console.error('reconcile failed:', e.message); process.exit(1); });
