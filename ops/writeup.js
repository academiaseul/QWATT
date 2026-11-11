#!/usr/bin/env node
/**
 * QWATT — generate the public write-up from public data (plan unit 4.6)
 * ---------------------------------------------------------------------------
 *   node ops/writeup.js --feed <feed URL> --account G… [--feed-dir <local copy>] \
 *        [--proposer G… --verifier G… --third G…] \
 *        [--tests evidence/rehearsal/<file>.json] [--outages evidence/outages.json] [--title "…"] [--out WRITEUP.md]
 *
 * --outages: the operators' notes, a JSON array of { from, to, cause, kind? } with ISO times. Nothing
 * public records why an outage happened, so OD-8's causes come from here, and so does any outage neither
 * the feed nor the chain shows. The times of the others are still generated.
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
const PIN = require('../assets/qwatt-pin.js');
const TH = require('../anchor/thresholds');

const EXPLORER = 'https://stellar.expert/explorer/testnet';
const txl = (h) => `[\`${h.slice(0, 10)}…${h.slice(-6)}\`](${EXPLORER}/tx/${h})`;
const kwh = (mwh) => (mwh / 1e6).toLocaleString('en-US', { maximumFractionDigits: 3 });
const wh = (mwh) => (mwh / 1000).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const when = (t) => t.slice(0, 16).replace('T', ' ');
const span = (s) => { const m = Math.round(s / 60); return `${Math.floor(m / 60)} h ${m % 60} min`; };
/* the watchdog's VERIFIER_SILENT limit: a batch later than this waited for something */
const LATE_ANCHOR_S = 15 * 60;

function testsSection(file) {
  if (!file || !fs.existsSync(file)) return '_Tests A–D: evidence file not supplied (run `node anchor/tests-abcd.js` on the real account and pass `--tests`)._\n';
  const ev = JSON.parse(fs.readFileSync(file, 'utf8'));
  const s = ev.steps || {};
  /* under 2/2/3 a single signature is refused as tx_bad_auth with no operation codes: print " / ops" only when there are some */
  const codes = (x) => {
    if (!x || !x.codes) return '—';
    const ops = x.codes.operations || [];
    return `\`${x.codes.transaction}\`` + (ops.length ? ` / ops \`${ops.join(', ')}\`` : '');
  };
  const rows = [
    ['A', 'proposer signs alone', 'refused by the network', s.A_proposer_alone ? codes(s.A_proposer_alone) : '—', 'envelope and Horizon response in the evidence folder (never in a ledger)'],
    ['B', 'verifier signs alone', 'refused by the network', s.B_verifier_alone ? codes(s.B_verifier_alone) : '—', 'envelope and Horizon response in the evidence folder (never in a ledger)'],
    ['C', 'proposer + verifier', 'anchored', s.C_proposer_plus_verifier && s.C_proposer_plus_verifier.ok ? 'success' : '—', s.C_proposer_plus_verifier && s.C_proposer_plus_verifier.hash ? txl(s.C_proposer_plus_verifier.hash) : '—'],
    ['D', 'batch altered after the proposer signed', 'verifier refuses, nothing anchors', s.D_altered_after_proposer_signed ? `\`${(s.D_altered_after_proposer_signed.reasons || []).join(', ')}\`` : '—', 'no transaction (by design)'],
    ['I', 'independence: batch withheld from the verifier\'s only input path', 'verifier refuses, nothing anchors', s.I_withheld_refused ? `\`${(s.I_withheld_refused.reasons || []).join(', ')}\`` : '—', 'no transaction (by design)'],
    /* V3-13d (D6): the stand-in pair is always proposer + third signer */
    ['L', 'proposer + third signer (stand-in)', 'anchored', s.L_proposer_plus_third && s.L_proposer_plus_third.ok ? 'success' : '—', s.L_proposer_plus_third && s.L_proposer_plus_third.hash ? txl(s.L_proposer_plus_third.hash) : '—'],
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

function auditSection(a) {
  if (!a) return '_Fault audit: pass `--feed-dir` (a local copy of the feed) to include it._\n';
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

/**
 * OD-8, the anchoring outages the chain shows: consecutive batches anchored over LATE_ANCHOR_S after they
 * closed are one outage, from the first one closing to the anchor that cleared the backlog.
 * @param {object[]} rows      anchored rows of the reconciliation, in order
 * @param {object} batches     the feed's batches, by id
 */
function anchoringOutages(rows, batches) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    const closed = Date.parse(batches[r.batch_id].ts_end), anchored = Date.parse(r.anchor.created_at);
    if ((anchored - closed) / 1000 <= LATE_ANCHOR_S) { cur = null; continue; }
    if (!cur) { cur = { from: closed, to: anchored, batches: 0 }; out.push(cur); }
    cur.to = anchored;
    cur.batches++;
  }
  return out.map((o) => ({ from: new Date(o.from).toISOString(), to: new Date(o.to).toISOString(), seconds: (o.to - o.from) / 1000, batches: o.batches }));
}

/** The operators' notes (--outages), checked: a note with a bad time would silently match nothing. */
function readOutageNotes(file) {
  const notes = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(notes)) throw new Error(`${file}: expected a JSON array of { from, to, cause, kind? }`);
  notes.forEach((n, i) => {
    if (!(Date.parse(n.from) < Date.parse(n.to)) || !n.cause) throw new Error(`${file}, entry ${i + 1}: needs from, to (ISO times, from before to) and cause`);
  });
  return notes;
}

/**
 * OD-8: every outage, of any length, with its times and cause; the limit applies to each, not to their sum.
 * @param {object} audit       live/audit.js auditLive()
 * @param {object[]} anchoring anchoringOutages()
 * @param {object[]} notes     readOutageNotes()
 */
function outagesSection(audit, anchoring, notes) {
  const { continuityOf } = require('../live/audit');
  const c = audit.coverage;
  const overlaps = (a, b) => Date.parse(a.from) < Date.parse(b.to) && Date.parse(a.to) > Date.parse(b.from);
  const found = [
    ...c.gaps.map((g) => ({ ...g, kind: g.trailing ? 'proposer host: the run did not come back' : 'proposer host: nothing judged' })),
    ...anchoring.map((o) => ({ ...o, kind: `anchoring: ${o.batches} batch(es) waited` })),
  ];
  const rows = [
    ...found.map((o) => ({ ...o, cause: notes.filter((n) => overlaps(n, o)).map((n) => n.cause).join('; ') || null })),
    ...notes.filter((n) => !found.some((o) => overlaps(n, o))).map((n) => ({ ...n, kind: n.kind || 'from the operators\' notes', seconds: (Date.parse(n.to) - Date.parse(n.from)) / 1000 })),
  ].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  const cont = continuityOf(rows, Date.parse(audit.run.start), Date.parse(c.judged_until));
  const effect = (r) => (r.trailing ? 'ends the run early' : r.seconds > cont.limit_s ? 'breaks the run: over 2 hours' : 'within the 2-hour limit');
  const cell = (t) => String(t).replace(/\s+/g, ' ').replace(/\|/g, '\\|');
  const unnamed = rows.filter((r) => !r.cause).length;
  const { from, to, seconds } = cont.longest;
  const verdict = !c.over ? '_The run is still going: this list is as of generation time._'
    : c.complete && cont.seven_days ? `**Seven consecutive days: met.** ${rows.length ? 'Every outage is within the 2-hour limit.' : 'No outage.'}`
      : `**Seven consecutive days: not met.** Longest continuous stretch: ${when(from)} → ${when(to)} UTC, ${span(seconds)}.`;
  return [
    `Every outage, of any length, with its times and cause. Gaps come from the audit above, anchoring outages from the chain (a batch anchored more than ${LATE_ANCHOR_S / 60} minutes after it closed), and causes, with anything neither shows, from the operators' notes. The 2-hour limit applies to each outage, not to their sum.`,
    '',
    verdict,
    ...(rows.length ? [
      '',
      '| From (UTC) | To (UTC) | Length | Kind | Cause | Effect |',
      '|---|---|---:|---|---|---|',
      ...rows.map((r) => `| ${when(r.from)} | ${when(r.to)} | ${span(r.seconds)} | ${cell(r.kind)} | ${r.cause ? cell(r.cause) : '**not recorded**'} | ${effect(r)} |`),
    ] : []),
    ...(unnamed ? ['', `**${unnamed} outage(s) have no cause recorded.** OD-8 requires one: add it to the notes passed with \`--outages\`.`] : []),
    '',
  ].join('\n');
}

/**
 * The anchoring account's line, from the values Horizon returned, never from a constant.
 * The "no single key" sentence is printed only when the account really is 2/2/3 with
 * master weight 0 and exactly three ed25519 signers of weight 1 (a preauth_tx or sha256_hash
 * signer lets a transaction through without any key; the reconciliation reads it as BROKEN).
 */
function accountSection(account, acct) {
  const head = `- Anchoring account: [\`${account}\`](${EXPLORER}/account/${account})`;
  if (!acct || acct.error || !acct.thresholds || !Array.isArray(acct.signers)) {
    return [`${head}: could not be loaded from Horizon (${(acct && acct.error) || 'no thresholds or signers in the response'}), so its signature rules are not stated here.`];
  }
  const t = acct.thresholds;
  const master = acct.signers.find((s) => s.key === account);
  const masterWeight = master ? master.weight : 0;
  const others = acct.signers.filter((s) => s.key !== account);
  const ed25519 = (s) => s.type === 'ed25519_public_key';
  const values = `thresholds ${t.low_threshold}/${t.med_threshold}/${t.high_threshold} (low/medium/high), master weight ${masterWeight}, ` +
    `${others.length} signer(s): ${others.map((s) => `\`${s.key}\` weight ${s.weight}${ed25519(s) ? '' : ` (a ${s.type || 'untyped'} signer)`}`).join(', ') || 'none'}`;
  const ok = TH.matches(t) && masterWeight === 0 && others.length === 3 && others.every((s) => s.weight === 1 && ed25519(s));
  if (ok) return [`${head} — as loaded from Horizon at generation time: ${values}. No single key can send any transaction for it, anchoring needs ${t.med_threshold} of the ${others.length} keys, changing signers needs all ${t.high_threshold}.`];
  return [
    `${head} — as loaded from Horizon at generation time: ${values}.`,
    `- ✗ These values do not match ${TH.LABEL} (thresholds low ${TH.THRESHOLDS.low} / medium ${TH.THRESHOLDS.med} / high ${TH.THRESHOLDS.high}, master weight 0, exactly three ed25519 signers of weight 1).`,
  ];
}

async function build(o) {
  /* Horizon first (the account, then every anchor with its signatures), then the feed: the order R.check
     uses, so an anchor newer than the feed copy cannot read as BROKEN. Unlike R.check, an account that
     cannot be read is printed below (and makes the verdict BROKEN) instead of stopping the write-up. */
  const acct = await R.fetchAccount(o.horizon, o.account).catch((e) => ({ error: e.message }));
  const anchors = await R.fetchAnchors(o.horizon, o.account);
  /* at one commit of the evidence repository, resolved after Horizon (V3-7c); the write-up names it */
  const feed = await R.fetchFeed(o.feed, o.feedOptions);
  /* V3-11: the verifier log of the same run says which skipped links are refusals */
  /* as R.check: a log given explicitly must be readable; a derived one that cannot be read means no refusals */
  const logUrl = o.verifierLog || R.verifierLogFor(o.feed);
  let log = null;
  if (logUrl) { try { log = await R.fetchRefusals(logUrl, o.feedOptions); } catch (e) { if (o.verifierLog) throw e; } }
  const rep = await R.reconcile(feed, anchors, { account: o.account, record: acct.error ? null : acct, record_error: acct.error || null, roles: o.roles || null, refused: log ? log.refused : [] });
  const s = rep.summary;
  const now = new Date().toISOString();
  const recLink = `${o.reconcileBase}?feed=${encodeURIComponent(o.feed)}&account=${o.account}`;
  const anchoredRows = rep.rows.filter((r) => r.anchor);
  const audit = o.feedDir ? require('../live/audit').auditLive(o.feedDir) : null;
  const readAt = feed.commit ? `\`${PIN.describe(o.feed, feed.commit, o.feedOptions)}\` (commit \`${feed.commit}\`)` : `\`${feed.base}\` (not a repository, so not pinned to a commit)`;

  /* who signed each anchor, from its signatures checked against the signer keys (V3-9) */
  const signedBy = (a) => (a.mode === 'normal' ? 'proposer + verifier' : a.mode === 'stand-in' ? 'proposer + third signer (stand-in)' : `✗ ${a.signed_by || 'unchecked'}`);
  const sig = s.signatures;
  /* two-of-three signing is claimed only for an account read from Horizon that matches 2/2/3, and only
     for signatures that were checked against declared signer roles */
  const counted = `- **${s.published_batches}** batches published (${s.accepted_batches} accepted, ${s.rejected_batches} rejected) · **${s.anchored_batches}** anchored in ${s.anchor_transactions} transactions`;
  const unchecked = `${sig.unchecked} unchecked (no signer roles; see problems)`;
  const anchoredLine = s.account.thresholds == null
    ? `${counted}. The account could not be read from Horizon (below), so no multisig claim is made.`
    : !s.account.ok
      ? `${counted}. The account does not match ${TH.LABEL} as loaded from Horizon (below), so no multisig claim is made.`
      : s.anchor_transactions && sig.unchecked === s.anchor_transactions
        ? `${counted}, ${unchecked}, so no multisig claim is made.`
        : `${counted}, each with two of the account's three signer keys as read from Horizon: ${sig.normal} proposer + verifier, ${sig.stand_in} proposer + third signer (stand-in)${sig.broken ? `, ${sig.broken} with another pair (see problems)` : ''}${sig.unchecked ? `, ${unchecked}` : ''}.`;

  const lines = [
    `# ${o.title}`,
    '',
    `_${R.INPUT_LABEL}_`,
    '',
    `Generated ${now} from public data only: Horizon (\`${o.horizon}\`) and the evidence feed (\`${o.feed}\`), evidence read at ${readAt}. Reproduce: \`node ops/writeup.js --feed ${o.feed} --account ${o.account}\`.`,
    '',
    '## Result',
    '',
    `- Reconciliation verdict: **${rep.verdict}** — [run it yourself in the browser](${recLink}) or \`node anchor/reconcile-cli.js --feed ${o.feed} --account ${o.account}\`.`,
    anchoredLine,
    ...(s.stand_in_batches.length ? [`- Stand-in anchors (third signer in place of the verifier): ${s.stand_in_batches.map((b) => `\`${b}\``).join(', ')}.`] : []),
    `- First anchor ${s.first_anchor_at || '—'} · last anchor ${s.last_anchor_at || '—'}.`,
    `- Energy anchored (cumulative): **${kwh(s.anchored_cumulative_mwh)} kWh** · published: ${kwh(s.published_cumulative_mwh)} kWh · _${R.INPUT_LABEL}_.`,
    `- Intervals refused by the gates: **${s.rejected_intervals}** — ${Object.entries(s.rejected_by_reason).map(([k, v]) => `\`${k}\` ×${v}`).join(', ') || 'none'}.`,
    ...accountSection(o.account, acct),
    ...(rep.problems.length ? ['', '**Reconciliation problems:**', ...rep.problems.map((p) => `- ${p}`)] : []),
    '',
    '## Multi-party authorization: tests A–D',
    '',
    testsSection(o.tests),
    '## Fault injections during the live run',
    '',
    auditSection(audit),
    '## Outages (OD-8)',
    '',
    audit ? outagesSection(audit, anchoringOutages(anchoredRows, feed.batches), o.outages || []) : '_Outages: pass `--feed-dir` (a local copy of the feed) to include them._\n',
    '## Every anchoring transaction',
    '',
    `Each row: the batch, the hash recomputed from the published file (equal to the value the transaction carries in \`qwatt.anchor.sha256\`), and the transaction that anchored it. Energy: _${R.INPUT_LABEL}_.`,
    '',
    '| Seq | Batch | Window (UTC) | Energy (Wh) | Refused intervals | Batch SHA-256 | Ledger | Transaction | Signed by |',
    '|---:|---|---|---:|---:|---|---:|---|---|',
    ...anchoredRows.map((r) => {
      const b = feed.batches[r.batch_id];
      return `| ${r.seq} | \`${r.batch_id}\` | ${b.ts_start.slice(0, 16).replace('T', ' ')} → ${b.ts_end.slice(11, 16)} | ${wh(r.energy_mwh)} | ${r.rejected_count} | \`${r.recomputed_sha256.slice(0, 16)}…\` | ${r.anchor.ledger} | ${txl(r.anchor.tx_hash)} | ${signedBy(r.anchor)} |`;
    }),
    ...(s.awaiting_anchor.length ? ['', `Awaiting anchor at generation time: ${s.awaiting_anchor.map((b) => `\`${b}\``).join(', ')}.`] : []),
    '',
    '## How to verify any row without trusting us',
    '',
    `1. Download \`${o.feed}/batches/<batch_id>.json\`.`,
    '2. Remove its `sha256` field, serialize with sorted keys and no whitespace (integers only), SHA-256 the UTF-8 bytes.',
    '3. Open the row\'s transaction: its `qwatt.anchor.sha256` data entry equals your hash, and its two signatures verify against the signer keys in the run\'s `faults.json` (`anchoring.signers`): proposer + verifier, or proposer + third signer when the third signer stood in.',
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
    outages: opt('--outages') ? readOutageNotes(path.resolve(opt('--outages'))) : [],
    title: opt('--title', 'QWATT — seven-day live run on Stellar Testnet'),
    reconcileBase: opt('--reconcile-page', 'https://qwatt.org/reconcile.html'),
  };
  if (!o.feed || !o.account) { console.error('usage: node ops/writeup.js --feed <URL> --account G… [--proposer G… --verifier G… --third G…] [--feed-dir dir] [--tests file] [--outages file] [--out WRITEUP.md]'); process.exit(2); }
  /* who is who: from the run's faults.json, or given here for a feed that does not declare it (all three or none) */
  const given = R.ROLE_NAMES.filter((r) => opt('--' + r));
  if (given.length && given.length !== 3) { console.error('pass --proposer, --verifier and --third together (public keys)'); process.exit(2); }
  o.roles = given.length ? { proposer: opt('--proposer'), verifier: opt('--verifier'), third: opt('--third') } : null;
  const { markdown, report } = await build(o);
  const out = path.resolve(opt('--out', 'WRITEUP.md'));
  fs.writeFileSync(out, markdown);
  console.log(`wrote ${out} · ${report.verdict} · ${report.summary.anchored_batches} transactions linked`);
}

if (require.main === module) cli().catch((e) => { console.error('writeup failed:', e.message); process.exitCode = 1; });

module.exports = { build, accountSection, anchoringOutages, outagesSection, readOutageNotes };
