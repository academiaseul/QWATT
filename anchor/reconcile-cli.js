#!/usr/bin/env node
/**
 * QWATT — reconcile the public feed against the chain, from the command line
 * ---------------------------------------------------------------------------
 *   node anchor/reconcile-cli.js --feed <base URL> --account G… [--horizon URL]
 *        [--proposer G… --verifier G… --third G…] [--json]
 *
 * Runs exactly the logic reconcile.html runs in a reviewer's browser
 * (assets/qwatt-reconcile.js) — this is the Deliverable 4 acceptance check.
 * It reads Horizon first (the anchoring account's signers and thresholds, then
 * every anchoring transaction with its signatures), then the feed.
 *
 * Who is who (the three signer public keys) comes from the run's faults.json
 * (`anchoring.signers`). --proposer, --verifier and --third (all three or none)
 * are only for a feed that does not declare them; if both exist they must agree.
 *
 * No dependencies. Exit 0: RECONCILED or PENDING. Exit 1: BROKEN, or the check
 * could not run (Horizon or the feed unreadable, no Ed25519 in this Node).
 * Exit 2: usage.
 */

'use strict';

const path = require('path');
const R = require(path.join(__dirname, '..', 'assets', 'qwatt-reconcile.js'));

const USAGE = 'usage: node anchor/reconcile-cli.js --feed <base URL> --account G… [--horizon URL] [--proposer G… --verifier G… --third G…] [--json]';

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const feedUrl = opt('--feed'), account = opt('--account');
  const horizon = opt('--horizon', 'https://horizon-testnet.stellar.org');
  if (!feedUrl || !account) { console.error(USAGE); process.exitCode = 2; return; }
  const given = R.ROLE_NAMES.filter((r) => opt('--' + r));
  if (given.length && given.length !== 3) { console.error('pass --proposer, --verifier and --third together (public keys)'); process.exitCode = 2; return; }
  const roles = given.length ? { proposer: opt('--proposer'), verifier: opt('--verifier'), third: opt('--third') } : null;

  const { report: rep } = await R.check({ feed: feedUrl, horizon, account, roles });
  /* process.exitCode, never process.exit(): fetch keep-alive sockets must close first (libuv assert on Windows) */
  process.exitCode = rep.verdict === 'BROKEN' ? 1 : 0;
  if (args.includes('--json')) { console.log(JSON.stringify(rep, null, 2)); return; }

  const s = rep.summary, a = s.account, sig = s.signatures;
  const src = s.roles_source === 'given' ? ' · roles given on the command line' : s.roles_source === 'faults.json' ? " · roles from the run's faults.json" : '';
  console.log(`${rep.verdict}`);
  console.log(`  ${R.INPUT_LABEL}`);
  console.log(`  account ${a.id} · thresholds ${a.thresholds || '?'} · master weight ${a.master_weight == null ? '?' : a.master_weight} · ${a.signers ? a.signers.length : '?'} signer(s) ${a.ok ? '✓ as freeze v3 §3 requires' : '✗'}`);
  console.log(`  signatures: ${sig.normal} proposer+verifier · ${sig.stand_in} stand-in (proposer+third) · ${sig.broken} other${sig.unchecked ? ` · ${sig.unchecked} unchecked (no signer roles)` : ''}${src}`);
  console.log(`  published ${s.published_batches} batches (${s.accepted_batches} accepted, ${s.rejected_batches} rejected) · anchored ${s.anchored_batches} in ${s.anchor_transactions} transactions`);
  console.log(`  cumulative published ${s.published_cumulative_mwh} mWh · anchored ${s.anchored_cumulative_mwh} mWh · last anchored ${s.last_anchored_batch || '—'}`);
  console.log(`  rejected intervals ${s.rejected_intervals}${Object.keys(s.rejected_by_reason).length ? ' · ' + Object.entries(s.rejected_by_reason).map(([k, v]) => `${k} ×${v}`).join(', ') : ''}`);
  if (s.stand_in_batches.length) console.log(`  stand-in (third signer in place of the verifier): ${s.stand_in_batches.join(', ')}`);
  if (s.awaiting_anchor.length) console.log(`  awaiting anchor: ${s.awaiting_anchor.join(', ')}`);
  for (const p of rep.problems) console.log('  ✗ ' + p);
}

main().catch((e) => { console.error('reconcile failed:', e.message); process.exitCode = 1; });
