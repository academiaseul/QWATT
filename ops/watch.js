#!/usr/bin/env node
/**
 * QWATT — live-run watchdog (plan unit 3.9)
 * ---------------------------------------------------------------------------
 *   node ops/watch.js --account G… --feed https://… [--verifier-log https://…/qwatt-verifier-log/main/<run>]
 *                     [--state ops-state] [--interval 300] [--once]
 *   QWATT_ALERT_WEBHOOK=https://ntfy.sh/<topic>   deliver alerts by HTTP POST (otherwise: console only)
 *
 * Independent of what it watches: it imports nothing from the pipeline or the
 * services and reads only public sources — Horizon, the published feed, and the
 * public verifier log (status.json for the heartbeat, refusals.jsonl for the
 * refusals, which only grows, so a verifier restart cannot reset the count). A
 * watchdog that shares code or a host with the thing it watches cannot detect
 * the failure that matters most: that thing silently not running.
 *
 * Conditions (thresholds in POLICY):
 *   NO_ANCHOR        no anchoring transaction for 2 h while the run is live
 *   FEED_STALE       the feed's newest judged interval is older than 30 min
 *   BACKLOG          an accepted batch has waited more than 2 h for its anchor
 *   VERIFIER_SILENT  the verifier's last tick, as its public log shows it, is older than 15 min
 *   NEW_REFUSAL      the verifier refused something (always worth a human look)
 *   BROKEN           reconciliation verdict is BROKEN
 *   SOURCE_DOWN      Horizon or the feed could not be read at all
 *
 * Each condition alerts once when it starts, repeats every 6 h while it lasts,
 * and sends a "resolved" note when it clears. Every run writes a heartbeat,
 * whatever the outcome: no heartbeat means the watchdog itself did not run.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const POLICY = {
  no_anchor_s: 2 * 3600,
  feed_stale_s: 30 * 60,
  backlog_s: 2 * 3600,
  /* status.json reaches the public log at most every 5 min (+1 min publisher interval, +30 s verifier
     tick), and raw.githubusercontent.com may serve a copy up to 5 min old: ~690 s for a healthy verifier */
  verifier_silent_s: 15 * 60,
  repeat_s: 6 * 3600,
};

/* ─────────────────────────── pure decisions ─────────────────────────── */

/**
 * @param {object} obs     observations (see observe())
 * @param {object} state   { active: {CODE: {since, last_sent}}, refusals_seen }
 * @param {number} nowS
 * @returns {{ alerts: Array<{code, kind:'alert'|'repeat'|'resolved', message}>, state }}
 */
function decide(obs, state, nowS, policy = POLICY) {
  const prev = state.active || {};
  const conditions = {};
  const age = (iso) => (iso ? nowS - Math.floor(Date.parse(iso) / 1000) : Infinity);

  if (obs.errors && obs.errors.length) conditions.SOURCE_DOWN = `cannot read: ${obs.errors.join('; ')}`;
  if (obs.run_live) {
    if (obs.last_anchor_at !== undefined && age(obs.last_anchor_at) > policy.no_anchor_s) {
      conditions.NO_ANCHOR = obs.last_anchor_at ? `no anchoring transaction since ${obs.last_anchor_at}` : 'no anchoring transaction yet';
    }
    if (obs.feed_last_interval_at !== undefined && age(obs.feed_last_interval_at) > policy.feed_stale_s) {
      conditions.FEED_STALE = `newest judged interval is from ${obs.feed_last_interval_at}: the pipeline may have stopped`;
    }
  }
  if (obs.oldest_unanchored_published_at && age(obs.oldest_unanchored_published_at) > policy.backlog_s) {
    conditions.BACKLOG = `accepted batch ${obs.oldest_unanchored_batch} has waited since ${obs.oldest_unanchored_published_at} for its second signature`;
  }
  if (obs.verifier_last_tick !== undefined && age(obs.verifier_last_tick) > policy.verifier_silent_s) {
    conditions.VERIFIER_SILENT = `the verifier log says the verifier last ticked at ${obs.verifier_last_tick} (the verifier or its log publisher is down)`;
  }
  if (obs.reconcile_verdict === 'BROKEN') conditions.BROKEN = `reconciliation BROKEN: ${(obs.reconcile_problems || []).slice(0, 3).join(' | ')}`;

  const alerts = [];
  const active = {};
  for (const [code, message] of Object.entries(conditions)) {
    const was = prev[code];
    if (!was) { alerts.push({ code, kind: 'alert', message }); active[code] = { since: nowS, last_sent: nowS }; }
    else if (nowS - was.last_sent >= policy.repeat_s) { alerts.push({ code, kind: 'repeat', message }); active[code] = { since: was.since, last_sent: nowS }; }
    else active[code] = was;
  }
  for (const code of Object.keys(prev)) {
    if (!conditions[code]) alerts.push({ code, kind: 'resolved', message: `${code} cleared after ${Math.round((nowS - prev[code].since) / 60)} min` });
  }

  /* refusals are events, not conditions: alert on each new one */
  const seen = state.refusals_seen || 0;
  const n = obs.verifier_refusals == null ? seen : obs.verifier_refusals;
  if (n > seen) alerts.push({ code: 'NEW_REFUSAL', kind: 'alert', message: `the verifier refused ${n - seen} proposal(s); see refusals.jsonl in the public verifier log` });

  return { alerts, state: { active, refusals_seen: Math.max(seen, n) } };
}

/* ─────────────────────────── observation ─────────────────────────── */

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
  if (!r.ok) throw new Error(`${new URL(url).host}${new URL(url).pathname}: HTTP ${r.status}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
  if (r.status === 404) return '';
  if (!r.ok) throw new Error(`${new URL(url).host}${new URL(url).pathname}: HTTP ${r.status}`);
  return r.text();
}

async function observe(o, nowS) {
  const obs = { errors: [] };
  const feed = o.feed.replace(/\/+$/, '');
  try {
    const faults = await getJson(`${feed}/faults.json`).catch(() => null);
    obs.run_live = faults ? nowS * 1000 >= Date.parse(faults.run_start) && nowS * 1000 < Date.parse(faults.run_end) : !!o.assumeLive;
    const idx = await getJson(`${feed}/index.json`);
    obs.feed_last_interval_at = idx.last_ts_start || null;
    const listed = (await getText(`${feed}/ledger/batches.jsonl`)).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const anchoredDir = new Set();
    for (const e of listed.slice(-50)) {
      if (e.status !== 'accepted') continue;
      const a = await getText(`${feed}/anchored/${e.batch_id}.json`).catch(() => '');
      if (a) anchoredDir.add(e.batch_id);
    }
    const waiting = listed.slice(-50).filter((e) => e.status === 'accepted' && !anchoredDir.has(e.batch_id));
    if (waiting.length) {
      const b = await getJson(`${feed}/batches/${waiting[0].batch_id}.json`);
      obs.oldest_unanchored_batch = waiting[0].batch_id;
      obs.oldest_unanchored_published_at = b.ts_end;                 // a batch is published when its window closes
    }
  } catch (e) { obs.errors.push(`feed (${e.message})`); }

  try {
    const page = await getJson(`${o.horizon.replace(/\/+$/, '')}/accounts/${o.account}/transactions?order=desc&limit=1`);
    const t = page._embedded.records[0];
    obs.last_anchor_at = t ? t.created_at : null;
  } catch (e) { obs.errors.push(`Horizon (${e.message})`); }

  if (o.verifierLog) {
    const log = o.verifierLog.replace(/\/+$/, '');
    try {
      const st = await getJson(`${log}/status.json`);
      obs.verifier_last_tick = st.last_tick;
      /* the persistent count: refusals.jsonl only grows, while status counters restart with the process */
      obs.verifier_refusals = (await getText(`${log}/refusals.jsonl`)).split('\n').filter((l) => l.trim()).length;
    } catch (e) { obs.errors.push(`verifier log (${e.message})`); }
  }

  if (o.reconcile) {
    try {
      const rep = await o.reconcile();
      obs.reconcile_verdict = rep.verdict;
      obs.reconcile_problems = rep.problems;
    } catch (e) { obs.errors.push(`reconcile (${e.message})`); }
  }
  return obs;
}

/* ─────────────────────────── delivery ─────────────────────────── */

async function deliver(alerts, webhook, log = console.log) {
  for (const a of alerts) {
    const line = `[QWATT ${a.kind.toUpperCase()}] ${a.code}: ${a.message}`;
    log(line);
    if (!webhook) continue;
    try {
      await fetch(webhook, { method: 'POST', body: line, headers: { Title: `QWATT ${a.code}`, Priority: a.kind === 'resolved' ? 'default' : 'high', Tags: a.kind === 'resolved' ? 'white_check_mark' : 'warning' }, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      log(`  (webhook delivery failed: ${e.message}; the alert stays in the state file)`);
    }
  }
}

async function tick(o) {
  const nowS = Math.floor(Date.now() / 1000);
  fs.mkdirSync(o.stateDir, { recursive: true });
  const stateFile = path.join(o.stateDir, 'watch-state.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  const obs = await observe(o, nowS);
  const { alerts, state: next } = decide(obs, state, nowS);
  await deliver(alerts, process.env.QWATT_ALERT_WEBHOOK);
  fs.writeFileSync(stateFile, JSON.stringify(next, null, 2) + '\n');
  fs.writeFileSync(path.join(o.stateDir, 'heartbeat.json'), JSON.stringify({ at: new Date(nowS * 1000).toISOString(), observations: obs, active: Object.keys(next.active) }, null, 2) + '\n');
  return { obs, alerts };
}

async function cli() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  if (args.includes('--verifier-status')) { console.error('--verifier-status was replaced by --verifier-log <public verifier log URL>/<run> (copy the new qwatt-watch.service)'); process.exit(2); }
  const o = {
    account: opt('--account'),
    feed: opt('--feed'),
    horizon: opt('--horizon', 'https://horizon-testnet.stellar.org'),
    verifierLog: opt('--verifier-log'),
    stateDir: path.resolve(opt('--state', 'ops-state')),
  };
  if (!o.account || !o.feed) { console.error('usage: node ops/watch.js --account G… --feed <public feed URL> [--verifier-log <public verifier log URL>/<run>]'); process.exit(2); }
  const R = require('../assets/qwatt-reconcile.js');
  /* Horizon first, then the feed; signer roles from the run's faults.json. A Horizon or feed error
     throws, and observe() reports it as an unreadable source (SOURCE_DOWN), never as BROKEN. */
  o.reconcile = async () => (await R.check({ feed: o.feed, horizon: o.horizon, account: o.account })).report;
  if (!process.env.QWATT_ALERT_WEBHOOK) console.log('QWATT_ALERT_WEBHOOK not set: alerts go to this console only');
  const run = async () => { try { const r = await tick(o); if (!r.alerts.length) console.log(new Date().toISOString(), 'ok', JSON.stringify({ last_anchor_at: r.obs.last_anchor_at, feed: r.obs.feed_last_interval_at })); } catch (e) { console.error(new Date().toISOString(), 'watch tick failed:', e.message); } };
  await run();
  if (!args.includes('--once')) setInterval(run, Number(opt('--interval', 300)) * 1000);
}

if (require.main === module) cli();

module.exports = { decide, observe, deliver, POLICY };
