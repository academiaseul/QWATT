#!/usr/bin/env node
/**
 * QWATT — the check from outside both hosts (freeze v3 V3-13b; plan W3-6)
 * ---------------------------------------------------------------------------
 *   QWATT_ANCHOR_ACCOUNT=G… QWATT_FEED_URL=https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/<run> \
 *   QWATT_VERIFIER_LOG_URL=https://raw.githubusercontent.com/academiaseul/qwatt-verifier-log/main/<run> \
 *   QWATT_ALERT_WEBHOOK=https://ntfy.sh/<private topic>  node ops/outside-check.js
 *
 * Runs on neither host: .github/workflows/outside-check.yml runs it on GitHub every 15 minutes, with the
 * settings as repository variables and the webhook as a secret. ops/watch.js runs on the verifier host,
 * so a verifier-host outage silences it; this check is the one that still speaks. It reads public data
 * only and imports nothing from the pipeline or the services:
 *
 *   NO_ANCHOR             no anchoring transaction (memo QW#<seq>) on Horizon for 90 minutes while the run is live
 *   PROPOSER_HOST_SILENT  no commit to the run's directory in qwatt-evidence for 30 minutes while the run is
 *                         live (75 from the start, until the first push): the proposer host publishes several
 *                         times an hour, so a repository that stops moving is that host's dead man's switch
 *   VERIFIER_HOST_SILENT  the same for qwatt-verifier-log (the verifier host replaces status.json every 5 min)
 *   VERIFIER_SILENT       the verifier's last tick, in its public status.json, is older than 15 minutes
 *   SOURCE_DOWN           Horizon, the feed, GitHub or the log could not be read: silence is never health
 *
 * The run is live between run_start and run_end of the run's faults.json. Outside it only SOURCE_DOWN
 * counts. Each problem is posted to the webhook, and counts as sent only on HTTP 2xx (ops/watch.js
 * deliver). Exit 1 when there is a problem or an alert was not sent, so the workflow run fails and GitHub
 * notifies the repository's owner as a second channel. Exit 0 when all is well, or when no account is
 * configured (a fork, or before the founders set the variables).
 */

'use strict';

const { deliver } = require('./watch');                         // the same 2xx rule as the watchdog

const POLICY = {
  no_anchor_s: 90 * 60,
  /* DV-11: nothing can be pushed before the first batch closes, about an hour after the start; from
     then on the repository moves every few minutes */
  first_push_s: 75 * 60,
  host_silent_s: 30 * 60,
  verifier_silent_s: 15 * 60,
};

/**
 * @param {{run_live:boolean, run_start?:string, last_anchor_at?:string|null, evidence_pushed_at?:string, log_pushed_at?:string,
 *          verifier_last_tick?:string, errors:string[]}} obs  undefined: not checked (not configured)
 * @param {number} nowS
 * @returns {Array<{code:string, message:string}>}
 */
function decideOutside(obs, nowS, policy = POLICY) {
  const out = [];
  const age = (iso) => (iso ? nowS - Math.floor(Date.parse(iso) / 1000) : Infinity);
  if (obs.errors && obs.errors.length) out.push({ code: 'SOURCE_DOWN', message: `cannot read: ${obs.errors.join('; ')}` });
  /* DV-11: armed ahead of its start, a verifier that stops is the one thing to know before the run needs it */
  if (obs.run_start && nowS * 1000 < Date.parse(obs.run_start) && obs.verifier_last_tick !== undefined && age(obs.verifier_last_tick) > policy.verifier_silent_s) {
    out.push({ code: 'VERIFIER_SILENT', message: `the verifier last ticked at ${obs.verifier_last_tick}, before the run has started` });
  }
  if (!obs.run_live) return out;
  /* DV-11: a run armed ahead of its start has no anchor and no recent push when it starts */
  const inRun = (iso) => Math.min(age(iso), age(obs.run_start));
  if (obs.last_anchor_at !== undefined && inRun(obs.last_anchor_at) > policy.no_anchor_s) {
    out.push({ code: 'NO_ANCHOR', message: obs.last_anchor_at ? `no anchoring transaction since ${obs.last_anchor_at}` : 'no anchoring transaction during the run' });
  }
  const evidenceLimit = age(obs.run_start) <= policy.first_push_s ? policy.first_push_s : policy.host_silent_s;
  if (obs.evidence_pushed_at !== undefined && inRun(obs.evidence_pushed_at) > evidenceLimit) {
    out.push({ code: 'PROPOSER_HOST_SILENT', message: `qwatt-evidence: no commit to the run since ${obs.evidence_pushed_at} (the proposer host or its publisher is down)` });
  }
  if (obs.log_pushed_at !== undefined && age(obs.log_pushed_at) > policy.host_silent_s) {
    out.push({ code: 'VERIFIER_HOST_SILENT', message: `qwatt-verifier-log: no commit to the run since ${obs.log_pushed_at} (the verifier host or its log publisher is down)` });
  }
  if (obs.verifier_last_tick !== undefined && age(obs.verifier_last_tick) > policy.verifier_silent_s) {
    out.push({ code: 'VERIFIER_SILENT', message: `the verifier last ticked at ${obs.verifier_last_tick}` });
  }
  return out;
}

async function getJson(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000), cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${new URL(url).host}: HTTP ${r.status}`);
  return r.json();
}

/** owner, repo, branch and run directory of a raw.githubusercontent.com URL, or null. */
function repoOf(url) {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+?)\/*$/.exec(url || '');
  return m ? { owner: m[1], repo: m[2], branch: m[3], dir: m[4] } : null;
}

/** When the run's directory in a repository last changed: the date of its newest commit. */
async function lastPush(url, token) {
  const p = repoOf(url);
  if (!p) throw new Error(`${url} is not a raw.githubusercontent.com address`);
  const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const list = await getJson(`https://api.github.com/repos/${p.owner}/${p.repo}/commits?sha=${encodeURIComponent(p.branch)}&path=${encodeURIComponent(p.dir)}&per_page=1`, headers);
  return list && list[0] ? list[0].commit.committer.date : null;
}

async function observeOutside(o, nowS) {
  const obs = { run_live: false, errors: [] };
  try {
    const page = await getJson(`${o.horizon}/accounts/${o.account}/transactions?order=desc&limit=50`);
    const t = page && page._embedded ? page._embedded.records.find((x) => x.successful !== false && x.memo_type === 'text' && /^QW#\d+$/.test(x.memo || '')) : null;
    obs.last_anchor_at = t ? t.created_at : null;
  } catch (e) { obs.errors.push(`Horizon (${e.message})`); }
  if (o.feed) {
    try {
      const run = await getJson(`${o.feed.replace(/\/+$/, '')}/faults.json`);
      obs.run_live = !!run && nowS * 1000 >= Date.parse(run.run_start) && nowS * 1000 < Date.parse(run.run_end);
      /* a wrong feed address answers 404 for every file: without this the whole check would pass silently */
      if (run) obs.run_start = run.run_start; else obs.errors.push('faults.json (not published)');
    } catch (e) { obs.errors.push(`faults.json (${e.message})`); }
    try { obs.evidence_pushed_at = await lastPush(o.feed, o.token); } catch (e) { obs.errors.push(`qwatt-evidence commits (${e.message})`); }
  }
  if (o.verifierLog) {
    try { obs.log_pushed_at = await lastPush(o.verifierLog, o.token); } catch (e) { obs.errors.push(`qwatt-verifier-log commits (${e.message})`); }
    try { const st = await getJson(`${o.verifierLog.replace(/\/+$/, '')}/status.json`); obs.verifier_last_tick = st ? st.last_tick : null; } catch (e) { obs.errors.push(`verifier status.json (${e.message})`); }
  }
  return obs;
}

async function cli() {
  const env = process.env;
  const o = {
    account: env.QWATT_ANCHOR_ACCOUNT, feed: env.QWATT_FEED_URL || null, verifierLog: env.QWATT_VERIFIER_LOG_URL || null,
    horizon: (env.QWATT_HORIZON || 'https://horizon-testnet.stellar.org').replace(/\/+$/, ''), token: env.GITHUB_TOKEN || null,
  };
  if (!o.account) { console.log('outside check not configured: set the repository variable QWATT_ANCHOR_ACCOUNT (and QWATT_FEED_URL, QWATT_VERIFIER_LOG_URL); nothing checked'); return; }
  const nowS = Math.floor(Date.now() / 1000);
  const obs = await observeOutside(o, nowS);
  const problems = decideOutside(obs, nowS);
  console.log(new Date(nowS * 1000).toISOString(), JSON.stringify(obs));
  if (!problems.length) { console.log('ok'); return; }
  const sent = await deliver(problems.map((p) => ({ ...p, kind: 'alert' })), env.QWATT_ALERT_WEBHOOK || null);
  if (!env.QWATT_ALERT_WEBHOOK) console.log('QWATT_ALERT_WEBHOOK not set: this failing run is the only alert');
  if (sent.some((s) => !s)) console.log('an alert was not sent (no HTTP 2xx)');
  process.exitCode = 1;
}

if (require.main === module) cli().catch((e) => { console.error('outside check failed:', e.message); process.exitCode = 1; });

module.exports = { decideOutside, observeOutside, repoOf, POLICY };
