#!/usr/bin/env node
/**
 * QWATT — go-live preflight: everything that must be true before the live run starts
 * ---------------------------------------------------------------------------
 *   node ops/preflight.js --config /etc/qwatt/anchor.json --feed <public feed URL> \
 *        [--verifier-log https://raw.githubusercontent.com/academiaseul/qwatt-verifier-log/main/<run>] [--proposer G… --verifier G… --third G…] [--json]
 *
 * One red/green list, from public sources only (run it anywhere, including a laptop):
 *   runtime     Node ≥ 20, the Stellar SDK installed for anchor/
 *   clock       this machine within 120 s of the network (both services refuse to sign otherwise)
 *   account     every anchoring-account requirement (anchor/setup-account.js --verify)
 *   feed        index.json and the batch ledger reachable, readable cross-origin (CORS), and fresh
 *   verifier    its public log: status.json ticked within the watchdog's VERIFIER_SILENT threshold (15 minutes),
 *               refusals.jsonl counted (when given)
 *   reconcile   the reconciliation verdict is not BROKEN
 * Exit 0 only when every check that ran is green.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { POLICY } = require('./watch');                              // the same threshold as VERIFIER_SILENT

async function getRaw(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), cache: 'no-store', headers: { Origin: 'https://qwatt.org' } });
  return { status: r.status, cors: r.headers.get('access-control-allow-origin'), text: r.ok ? await r.text() : '' };
}

async function preflight(o) {
  const checks = [];
  const add = (group, name, ok, detail = '') => checks.push({ group, name, ok, detail });

  /* runtime */
  const major = Number(process.versions.node.split('.')[0]);
  add('runtime', `Node ${process.versions.node} (≥ 20)`, major >= 20);
  let S = null;
  try { S = require(path.join(__dirname, '..', 'anchor', 'node_modules', '@stellar', 'stellar-sdk')); add('runtime', 'Stellar SDK installed in anchor/', true); }
  catch (e) { add('runtime', 'Stellar SDK installed in anchor/', false, 'run: cd anchor && npm ci'); }

  /* config */
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(o.config, 'utf8')); add('config', `config readable (${o.config})`, true); }
  catch (e) { add('config', `config readable (${o.config})`, false, e.message); }
  if (cfg) {
    const pub = (k) => typeof cfg[k] === 'string' && /^G[A-Z2-7]{55}$/.test(cfg[k]);
    add('config', 'anchor_account and payment_destination are public keys', pub('anchor_account') && pub('payment_destination'));
    add('config', 'no secret in the config file', !/S[A-Z2-7]{55}/.test(JSON.stringify(cfg)), 'a secret key must never be in anchor.json');
  }
  /* the three signer keys: the flags, else anchor.json's signers by role (setup-account.js writes them) */
  const sig = (cfg && cfg.signers) || {};
  o = { ...o, proposer: o.proposer || sig.proposer, verifier: o.verifier || sig.verifier, third: o.third || sig.third };
  const horizon = (cfg && cfg.horizon_url) || 'https://horizon-testnet.stellar.org';

  /* clock */
  try {
    const page = JSON.parse((await getRaw(`${horizon}/ledgers?order=desc&limit=1`)).text);
    const skew = Math.floor(Date.now() / 1000) - Math.floor(Date.parse(page._embedded.records[0].closed_at) / 1000);
    add('clock', `local clock ${skew >= 0 ? '+' : ''}${skew}s vs the latest ledger (limit ±120 s)`, Math.abs(skew) <= 120);
  } catch (e) { add('clock', 'Horizon reachable for the clock check', false, e.message); }

  /* account */
  if (S && cfg && o.proposer && o.verifier && o.third) {
    try {
      const SA = require(path.join(__dirname, '..', 'anchor', 'setup-account'));
      const server = new S.Horizon.Server(horizon);
      const v = await SA.verifyAccount(server, { ...SA.DEFAULTS, ...cfg, treasury: cfg.payment_destination, proposer: o.proposer, verifier: o.verifier, third: o.third }, cfg.anchor_account);
      for (const c of v.checks) add('account', c.name, c.ok);
    } catch (e) { add('account', 'anchoring account readable', false, e.message); }
  } else if (cfg) {
    add('account', 'account checks (pass --proposer --verifier --third, or a config with signers, to run them)', null);
  }

  /* feed */
  if (o.feed) {
    const base = o.feed.replace(/\/+$/, '');
    try {
      const idx = await getRaw(`${base}/index.json`);
      add('feed', 'index.json reachable', idx.status === 200, idx.status === 404 ? 'not published yet: no batch has closed (first one closes within the hour)' : `HTTP ${idx.status}`);
      /* CORS is judged on a file that exists: a 404 carries no CORS header and would mislead */
      const probe = idx.status === 200 ? idx : await getRaw(`${base}/faults.json`);
      if (probe.status === 200) add('feed', 'readable cross-origin (CORS) — the reconciliation page needs it', probe.cors === '*' || probe.cors === 'https://qwatt.org', `access-control-allow-origin: ${probe.cors || 'missing'}`);
      else add('feed', 'CORS check (needs a published file)', null);
      if (idx.status === 200) {
        const j = JSON.parse(idx.text);
        const age = j.last_ts_start ? Math.round((Date.now() - Date.parse(j.last_ts_start)) / 60000) : null;
        add('feed', `newest judged interval ${age == null ? 'none yet' : age + ' min ago'} (fresh = under 30 min)`, age != null && age <= 30);
      }
      const bl = await getRaw(`${base}/ledger/batches.jsonl`);
      add('feed', 'batch ledger reachable', bl.status === 200 || bl.status === 404, bl.status === 404 ? 'not yet: no batch closed' : `HTTP ${bl.status}`);
    } catch (e) { add('feed', 'feed reachable', false, e.message); }
  }

  /* verifier */
  if (o.verifierLog) {
    const log = o.verifierLog.replace(/\/+$/, '');
    try {
      const st = JSON.parse((await getRaw(`${log}/status.json`)).text);
      const age = st.last_tick ? Math.round((Date.now() - Date.parse(st.last_tick)) / 1000) : null;
      add('verifier', `public log status.json: last tick ${age == null ? 'never' : age + ' s ago'} (under ${POLICY.verifier_silent_s} s)`, age != null && age <= POLICY.verifier_silent_s);
      const ref = await getRaw(`${log}/refusals.jsonl`);
      if (ref.status === 200 || ref.status === 404) add('verifier', `refusals so far (refusals.jsonl): ${ref.text.split('\n').filter((l) => l.trim()).length}`, true);
      else add('verifier', 'public log refusals.jsonl reachable', false, `HTTP ${ref.status}`);
    } catch (e) { add('verifier', 'public verifier log reachable', false, e.message); }
  }

  /* reconcile */
  if (o.feed && cfg) {
    try {
      const R = require(path.join(__dirname, '..', 'assets', 'qwatt-reconcile.js'));
      /* Horizon first (account, anchors and their signatures), then the feed; roles from the flags, else from faults.json */
      const roles = o.proposer && o.verifier && o.third ? { proposer: o.proposer, verifier: o.verifier, third: o.third } : null;
      const rep = (await R.check({ feed: o.feed, horizon, account: cfg.anchor_account, roles })).report;
      if (rep.summary.published_batches === 0) add('reconcile', 'nothing published yet to reconcile', null);
      else add('reconcile', `verdict ${rep.verdict} (${rep.summary.anchored_batches}/${rep.summary.accepted_batches} anchored)`, rep.verdict !== 'BROKEN', rep.problems.slice(0, 2).join(' | '));
    } catch (e) { add('reconcile', 'reconciliation ran', false, e.message); }
  }

  const ran = checks.filter((c) => c.ok !== null);
  return { ok: ran.length > 0 && ran.every((c) => c.ok), checks };
}

async function cli() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  if (args.includes('--verifier-status')) { console.error('--verifier-status was replaced by --verifier-log <public verifier log URL>/<run>'); process.exitCode = 2; return; }
  const o = { config: path.resolve(opt('--config', path.join(__dirname, '..', 'anchor', 'config.json'))), feed: opt('--feed'), verifierLog: opt('--verifier-log'), proposer: opt('--proposer'), verifier: opt('--verifier'), third: opt('--third') };
  const r = await preflight(o);
  if (args.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exitCode = r.ok ? 0 : 1; return; }
  let group = '';
  for (const c of r.checks) {
    if (c.group !== group) { group = c.group; console.log(`\n${group}`); }
    console.log(`  ${c.ok === null ? '·' : c.ok ? '✓' : '✗'} ${c.name}${c.detail && c.ok === false ? `  — ${c.detail}` : ''}`);
  }
  console.log(`\n${r.ok ? 'READY' : 'NOT READY'}`);
  process.exitCode = r.ok ? 0 : 1;
}

if (require.main === module) cli().catch((e) => { console.error('preflight failed to run:', e.message); process.exitCode = 1; });

module.exports = { preflight };
