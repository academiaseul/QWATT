#!/usr/bin/env node
/**
 * QWATT — generate the public write-up from public data (plan unit 4.6)
 * ---------------------------------------------------------------------------
 *   node ops/writeup.js --feed <feed URL> --account G… [--feed-dir <local copy>] \
 *        [--tests evidence/rehearsal/<file>.json] [--title "…"] [--out WRITEUP.md]
 *
 * SOW D4: "Public write-up linking every transaction." Every number and every
 * hash below the narrative is generated here — from Horizon and the published
 * feed, through the same reconciliation code reconcile.html runs — never typed
 * by hand. A hand-copied table of 168 transaction hashes is where typos enter
 * evidence.
 *
 * Narrative sections are short and fixed; findings come from the freeze document.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const R = require('../assets/qwatt-reconcile.js');

const EXPLORER = 'https://stellar.expert/explorer/testnet';
const txl = (h) => `[\`${h.slice(0, 10)}…${h.slice(-6)}\`](${EXPLORER}/tx/${h})`;
const kwh = (mwh) => (mwh / 1e6).toLocaleString('en-US', { maximumFractionDigits: 3 });
const wh = (mwh) => (mwh / 1000).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function testsSection(file) {
  if (!file || !fs.existsSync(file)) return '_Tests A–D: evidence file not supplied (run `node anchor/rehearse.js` on the real account and pass `--tests`)._\n';
  const ev = JSON.parse(fs.readFileSync(file, 'utf8'));
  const s = ev.steps || {};
  const codes = (x) => (x && x.codes ? `\`${x.codes.transaction}\` / ops \`${(x.codes.operations || []).join(', ')}\`` : '—');
  const rows = [
    ['A', 'proposer signs alone', 'refused by the network', s.A_proposer_alone ? codes(s.A_proposer_alone) : '—', 'envelope in the evidence file (never landed in a ledger)'],
    ['B', 'verifier signs alone', 'refused by the network', s.B_verifier_alone ? codes(s.B_verifier_alone) : '—', 'envelope in the evidence file (never landed in a ledger)'],
    ['C', 'proposer + verifier', 'anchored', s.C_proposer_plus_verifier && s.C_proposer_plus_verifier.ok ? 'success' : '—', s.C_proposer_plus_verifier && s.C_proposer_plus_verifier.hash ? txl(s.C_proposer_plus_verifier.hash) : '—'],
    ['D', 'batch altered after the proposer signed', 'verifier refuses, nothing anchors', s.D_altered_after_proposer_signed ? `\`${(s.D_altered_after_proposer_signed.reasons || []).join(', ')}\`` : '—', 'no transaction (by design)'],
    ['L', 'third signer + verifier (liveness)', 'anchored', s.L_third_plus_verifier && s.L_third_plus_verifier.ok ? 'success' : '—', s.L_third_plus_verifier && s.L_third_plus_verifier.hash ? txl(s.L_third_plus_verifier.hash) : '—'],
  ];
  return [
    `Evidence file: \`${path.relative(process.cwd(), file).replace(/\\/g, '/')}\` · anchoring account [\`${ev.public_keys.account}\`](${EXPLORER}/account/${ev.public_keys.account})`,
    '',
    '| Test | Signatures | Expected | Network / verifier result | Transaction |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
    'A, B and C are the **same transaction body**: Stellar transaction hashes exclude signatures. The identical transaction was refused with one signature and accepted with two. A and B are therefore cited by envelope and result code, never by hash (their hash resolves to C).',
    '',
  ].join('\n');
}

function auditSection(feedDir) {
  if (!feedDir) return '_Fault audit: pass `--feed-dir` (a local copy of the feed) to include it._\n';
  const { auditLive } = require('../live/audit');
  const a = auditLive(feedDir);
  return [
    `Coverage: **${a.coverage.judged_slots} of ${a.coverage.expected_slots}** five-minute intervals judged · ${a.coverage.gaps.length} gap(s) · ${a.coverage.duplicates.length} duplicate(s). Audit verdict: **${a.ok ? 'OK' : 'FAILED'}**.`,
    '',
    '| Fault | Window (UTC) | Expected reason | Intervals refused | Status |',
    '|---|---|---|---|---|',
    ...a.faults.map((f) => `| ${f.id} | ${f.start.slice(0, 16).replace('T', ' ')} → ${f.end.slice(11, 16)} | \`${f.expect.join('` or `')}\` | ${f.refused}/${f.intervals} | ${f.status} |`),
    ...(a.problems.length ? ['', ...a.problems.map((p) => `- ✗ ${p}`)] : []),
    '',
  ].join('\n');
}

async function build(o) {
  const [feed, anchors] = await Promise.all([R.fetchFeed(o.feed), R.fetchAnchors(o.horizon, o.account)]);
  const rep = await R.reconcile(feed, anchors);
  const s = rep.summary;
  const now = new Date().toISOString();
  const recLink = `${o.reconcileBase}?feed=${encodeURIComponent(o.feed)}&account=${o.account}`;
  const anchoredRows = rep.rows.filter((r) => r.anchor);

  const lines = [
    `# ${o.title}`,
    '',
    `Generated ${now} from public data only: Horizon (\`${o.horizon}\`) and the evidence feed (\`${o.feed}\`). Reproduce: \`node ops/writeup.js --feed ${o.feed} --account ${o.account}\`.`,
    '',
    '## Result',
    '',
    `- Reconciliation verdict: **${rep.verdict}** — [run it yourself in the browser](${recLink}) or \`node anchor/reconcile-cli.js --feed ${o.feed} --account ${o.account}\`.`,
    `- **${s.published_batches}** batches published (${s.accepted_batches} accepted, ${s.rejected_batches} rejected) · **${s.anchored_batches}** anchored through 2-of-3 multisig in ${s.anchor_transactions} transactions.`,
    `- First anchor ${s.first_anchor_at || '—'} · last anchor ${s.last_anchor_at || '—'}.`,
    `- Energy anchored (cumulative): **${kwh(s.anchored_cumulative_mwh)} kWh** · published: ${kwh(s.published_cumulative_mwh)} kWh.`,
    `- Intervals refused by the gates: **${s.rejected_intervals}** — ${Object.entries(s.rejected_by_reason).map(([k, v]) => `\`${k}\` ×${v}`).join(', ') || 'none'}.`,
    `- Anchoring account: [\`${o.account}\`](${EXPLORER}/account/${o.account}) — three signers of weight 1, thresholds 1/2/3, master weight 0.`,
    ...(rep.problems.length ? ['', '**Reconciliation problems:**', ...rep.problems.map((p) => `- ${p}`)] : []),
    '',
    '## Multi-party authorization: tests A–D',
    '',
    testsSection(o.tests),
    '## Fault injections during the live run',
    '',
    auditSection(o.feedDir),
    '## Every anchoring transaction',
    '',
    'Each row: the batch, the hash recomputed from the published file (equal to the value the transaction carries in `qwatt.anchor.sha256`), and the transaction that anchored it.',
    '',
    '| Seq | Batch | Window (UTC) | Energy (Wh) | Refused intervals | Batch SHA-256 | Ledger | Transaction |',
    '|---:|---|---|---:|---:|---|---:|---|',
    ...anchoredRows.map((r) => {
      const b = feed.batches[r.batch_id];
      return `| ${r.seq} | \`${r.batch_id}\` | ${b.ts_start.slice(0, 16).replace('T', ' ')} → ${b.ts_end.slice(11, 16)} | ${wh(r.energy_mwh)} | ${r.rejected_count} | \`${r.recomputed_sha256.slice(0, 16)}…\` | ${r.anchor.ledger} | ${txl(r.anchor.tx_hash)} |`;
    }),
    ...(s.awaiting_anchor.length ? ['', `Awaiting anchor at generation time: ${s.awaiting_anchor.map((b) => `\`${b}\``).join(', ')}.`] : []),
    '',
    '## How to verify any row without trusting us',
    '',
    `1. Download \`${o.feed}/batches/<batch_id>.json\`.`,
    '2. Remove its `sha256` field, serialize with sorted keys and no whitespace (integers only), SHA-256 the UTF-8 bytes.',
    '3. Open the row\'s transaction: its `qwatt.anchor.sha256` data entry equals your hash, and it carries two signatures.',
    '4. Re-run the gates on every interval in the batch with `assets/qwatt-gates.js` and spec 1.0.0: each one is accepted. Each rejected interval in `ledger/rejected.jsonl` is refused for the reason it states.',
    '',
  ];
  return { markdown: lines.join('\n'), report: rep };
}

async function cli() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const o = {
    feed: opt('--feed'), account: opt('--account'),
    horizon: opt('--horizon', 'https://horizon-testnet.stellar.org'),
    feedDir: opt('--feed-dir') ? path.resolve(opt('--feed-dir')) : null,
    tests: opt('--tests') ? path.resolve(opt('--tests')) : null,
    title: opt('--title', 'QWATT — seven-day live run on Stellar Testnet'),
    reconcileBase: opt('--reconcile-page', 'https://qwatt.org/reconcile.html'),
  };
  if (!o.feed || !o.account) { console.error('usage: node ops/writeup.js --feed <URL> --account G… [--feed-dir dir] [--tests file] [--out WRITEUP.md]'); process.exit(2); }
  const { markdown, report } = await build(o);
  const out = path.resolve(opt('--out', 'WRITEUP.md'));
  fs.writeFileSync(out, markdown);
  console.log(`wrote ${out} · ${report.verdict} · ${report.summary.anchored_batches} transactions linked`);
}

if (require.main === module) cli().catch((e) => { console.error('writeup failed:', e.message); process.exitCode = 1; });

module.exports = { build };
