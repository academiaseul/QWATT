#!/usr/bin/env node
/**
 * QWATT — SOW tests A–D and independence on the REAL anchoring account (Deliverable 3 evidence)
 * ---------------------------------------------------------------------------
 * Run once while ONE proposal is live and the verifier service is stopped
 * (docs/RUNBOOK.md, "Tests A–D and independence on the real account"), each test
 * where its key or its view is:
 *
 *   proposer host or anywhere:  node anchor/tests-abcd.js a --config /etc/qwatt/anchor.json --feed <public feed URL>   (or --feed-dir DIR)
 *   verifier host:              node anchor/tests-abcd.js b --config /etc/qwatt/anchor.json --feed <public feed URL> --sign-with-key qwatt-verifier
 *   verifier host:              node anchor/tests-abcd.js d --config /etc/qwatt/anchor.json --feed <public feed URL>
 *   verifier host:              node anchor/tests-abcd.js i --config /etc/qwatt/anchor.json --feed <public feed URL>
 *   after the verifier service anchored that proposal, anywhere:
 *                               node anchor/tests-abcd.js c --config /etc/qwatt/anchor.json [--proposer G… --verifier G…]
 *   then:                       node anchor/tests-abcd.js combine --out evidence/account/<G…>/abcd.json <abcd.json of each host>…
 *
 *   A  the PUBLISHED proposal (pending/<id>.xdr, the proposer's signature only), submitted unchanged → the
 *      network must refuse it. A needs no key.
 *   B  that same transaction body, re-signed by the verifier key alone → refused. Before it signs, B runs
 *      the verifier's own checks (the walk to the on-chain head, verifyBatch with the published raw lines,
 *      matchPending), so it signs nothing the verifier would refuse.
 *   C  the verifier service anchors that very proposal: the latest anchor, its signer keys by role
 *      (proposer + verifier) and its stellar.expert link.
 *   D  the published batch altered IN MEMORY after the proposer signed → the verifier refuses
 *      (verifier.hash_mismatch). Nothing is submitted and nothing is published.
 *   I  independence: the real verifier code reads the feed through a local proxy on the verifier host that
 *      withholds batches/<id>.json, and refuses (verifier.not_published); a signer that can never sign is
 *      all it is given. The batch is withheld from the verifier's only input path and the public feed is
 *      never touched (DV-7, recorded like D's in-memory alteration).
 *
 * A, B and C are one transaction body with one hash (Stellar hashes exclude signatures), so A and B are
 * cited by envelope and Horizon's answer, never by hash. A and B never enter a ledger: under 2/2/3 one
 * signature does not meet the low threshold and validation rejects it (tx_bad_auth), so they consume no
 * sequence number and do not disturb the proposal C anchors. Before submitting, each loads the account
 * and records its thresholds; A and B count as refused only when the account is at 2/2/3
 * (anchor/thresholds.js) and the network answered tx_bad_auth.
 *
 * Each run merges its result into one abcd.json (default evidence/abcd/abcd.json; the runbook always
 * passes --out) and writes the raw files beside it with their SHA-256 in index.json: A.envelope.xdr,
 * A.horizon.json, B.envelope.xdr, B.horizon.json, C.transaction.json, D.pending.xdr, I.pending.xdr,
 * I.refusals.jsonl. `combine` joins the files of the hosts into the one `ops/writeup.js --tests` reads.
 *
 * Keys are stellar-cli identities on their hosts (freeze v3, V3-8; anchor/signer.js): stellar-cli signs,
 * Node never reads a secret, and a secret in the environment is refused (exit 2).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('@stellar/stellar-sdk');
const E = require('../protocol/evidence');
const V = require('../batch/verify');
const T = require('./tx');
const C = require('./chain');
const { Feed } = require('../batch/feed');
const { makeFeedClient } = require('./feed-client');
const { loadConfig } = require('./proposer');
const { Verifier } = require('./verifier');
const { withholdingFeed } = require('./static-server');
const TH = require('./thresholds');
const SG = require('./signer');
const CAP = require('./capture');

const ROLES = ['proposer', 'verifier', 'third'];
const STEP = { a: 'A_proposer_alone', b: 'B_verifier_alone', c: 'C_proposer_plus_verifier', d: 'D_altered_after_proposer_signed', i: 'I_withheld_refused' };
const METHOD_I = 'the batch file is withheld from the verifier\'s only input path by a local proxy on the verifier host, and the real verifier code judges the live proposal; the public feed is never touched (DV-7)';
const nowS = () => Math.floor(Date.now() / 1000);

/**
 * A single-signature submission counts as refused only when the network answered
 * tx_bad_auth (no single key meets the low threshold) AND the account was loaded
 * at 2/2/3. tx_failed / op_bad_auth means one key alone met the low threshold.
 */
const authRefused = (codes, thresholdsMatch) => !!codes && codes.transaction === 'tx_bad_auth' && thresholdsMatch === true;

/** The account's thresholds as the network reports them, loaded before A or B submits. */
async function accountThresholds(server, account) {
  const acct = await server.loadAccount(account);
  return { thresholds: acct.thresholds, thresholds_match: TH.matches(acct.thresholds) };
}

/** Submit once and keep the network's answer verbatim (Horizon's problem JSON on a refusal). */
async function submitExpectRefusal(server, tx, th, cfg) {
  const base = { ...th, body_hash: tx.hash().toString('hex'), signatures: tx.signatures.length, envelope_xdr: tx.toEnvelope().toXDR('base64'), horizon_url: cfg.horizon_url || null, submitted_at: new Date().toISOString() };
  try {
    const res = await server.submitTransaction(tx);
    return { ...base, ok: true, refused: false, hash: res.hash, horizon_response: res };
  } catch (e) {
    const data = e && e.response && e.response.data;
    const codes = data && data.extras && data.extras.result_codes;
    if (!codes) throw e;
    return { ...base, ok: false, refused: authRefused(codes, th.thresholds_match), codes, horizon_response: data };
  }
}

/** The signer a test signs with: stellar-cli (signer), or an in-memory keypair in the offline tests. */
const signerOf = (signer, keypair) => signer || (keypair && SG.keypairSigner(keypair));
const verifies = (key, hash, sig) => { const kp = S.Keypair.fromPublicKey(key); return kp.signatureHint().equals(sig.hint()) && kp.verify(hash, sig.signature()); };

/** The feed as a test reads it: the public URL, or the proposer's local directory (A only). */
function feedOf({ feedUrl, feedDir }) {
  if (feedUrl) return makeFeedClient(feedUrl);
  if (!feedDir) throw new Error('--feed <public feed URL> (or, for A, --feed-dir DIR) is required');
  const f = new Feed(feedDir);
  return {
    async batches() { return f.readLedger('batches'); },
    async rejected() { return f.readLedger('rejected'); },
    async batch(id) { return f.hasBatch(id) ? f.readBatch(id) : null; },
    async pending(id) { const p = f.p('pending', `${id}.xdr`); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null; },
  };
}

/** The next batch to anchor and its published proposal, found as the verifier finds them. */
async function liveProposal(feed, server, cfg) {
  const listed = await feed.batches();
  const head = await C.getHead(server, cfg.anchor_account);
  const next = C.nextToAnchor(listed, C.anchoredPrefix(listed, head.anchor_sha256));
  return { head, next, pending: next ? await feed.pending(next.batch_id) : null };
}

function requireProposal(which, next, pending) {
  if (!next) throw new Error(`no batch awaiting anchor: run test ${which} while the pipeline is running`);
  if (!pending) throw new Error(`no published proposal for ${next.batch_id}: run test ${which} while a proposal is live and the verifier service is stopped`);
}

/** A — submit the published proposal, proposer signature only, unchanged. No key needed. */
async function testA({ feedUrl, feedDir, cfg, server, now = nowS() }) {
  const feed = feedOf({ feedUrl, feedDir });
  const th = await accountThresholds(server, cfg.anchor_account);   // loaded first: the evidence records what the account was
  const { next, pending } = await liveProposal(feed, server, cfg);
  requireProposal('A', next, pending);
  const batch = await feed.batch(next.batch_id);
  if (!batch) throw new Error(`${next.batch_id} is not published`);
  const tx = new S.Transaction(pending, cfg.network_passphrase);
  if (tx.signatures.length !== 1) throw new Error(`A submits the published proposal, which must carry exactly one signature (it carries ${tx.signatures.length})`);
  const proposerKey = cfg.signers && cfg.signers.proposer;
  if (proposerKey && !verifies(proposerKey, tx.hash(), tx.signatures[0])) throw new Error(`the published proposal is not signed by the config's signers.proposer ${proposerKey}`);
  const m = T.matchPending(pending, batch, cfg, now);
  if (!m.match) throw new Error(`A submits only the genuine proposal for the published batch (${m.reasons.join(', ')}: ${m.detail})`);
  const r = await submitExpectRefusal(server, tx, th, cfg);
  return { ...r, envelope_xdr: pending, batch_id: next.batch_id, signer_public_key: proposerKey || null, signed_by: 'proposer service via stellar-cli (the published proposal, unchanged)', expect: 'refused' };
}

/** B — the published body, re-signed by the verifier key alone, after the verifier's own checks. */
async function testB({ feedUrl, cfg, signer, keypair, server, maxWalk, now = nowS() }) {
  const feed = makeFeedClient(feedUrl);
  const th = await accountThresholds(server, cfg.anchor_account);   // loaded first: the evidence records what the account was
  const { head, next, pending } = await liveProposal(feed, server, cfg);
  requireProposal('B', next, pending);
  const refuse = (reasons, detail) => Object.assign(new Error(`B signs only what the verifier would co-sign: refused (${reasons.join(', ')})${detail ? `: ${detail}` : ''}; nothing signed or submitted`), { reasons });
  /* the verifier's checks, in the verifier's order (anchor/verifier.js _tick) */
  const batch = await feed.batch(next.batch_id);
  if (batch == null) throw refuse(['verifier.not_published'], `${next.batch_id} is not in the public feed`);
  if (batch.sha256 !== next.sha256) throw refuse(['verifier.hash_mismatch'], 'batch file differs from the batch ledger entry');
  const walk = await C.walkToHead(batch, head, (id) => feed.batch(id), { maxSteps: maxWalk == null ? C.MAX_WALK_BATCHES : C.checkMaxWalk(maxWalk) });
  if (!walk.ok) throw refuse([walk.code], walk.detail);
  const check = V.verifyBatch(batch, { prev: walk.prev, floor: walk.floor, rejected: await feed.rejected(), raw: await feed.raw(next.batch_id) });
  if (!check.ok) throw refuse([...new Set(check.failures.map((f) => f.code))], 'batch does not re-derive');
  const m = T.matchPending(pending, batch, cfg, now);
  if (!m.match) throw Object.assign(new Error(`B signs only the published proposal for the published batch (${m.reasons.join(', ')}: ${m.detail}); nothing signed or submitted`), { reasons: m.reasons });

  const s = signerOf(signer, keypair);
  if (!s) throw new Error('test B needs the verifier key: --sign-with-key qwatt-verifier');
  await s.init();
  const verifierKey = cfg.signers && cfg.signers.verifier;
  if (verifierKey && s.publicKey !== verifierKey) throw new Error(`B signs with the verifier key: ${s.publicKey} is not the config's signers.verifier ${verifierKey}`);
  const body = new S.Transaction(pending, cfg.network_passphrase);
  body.signatures.length = 0;                                        // the same body, without the proposer's signature
  const tx = await s.sign(body);
  const r = await submitExpectRefusal(server, tx, th, cfg);
  return { ...r, batch_id: next.batch_id, signer_public_key: s.publicKey, signed_by: 'verifier key alone, re-signing the published body', stellar_cli_version: await s.version(), expect: 'refused' };
}

/** C — the latest anchoring transaction: which keys signed it, by role, and its link. */
async function testC({ cfg, server, roles }) {
  const page = await server.transactions().forAccount(cfg.anchor_account).order('desc').limit(20).call();
  const t = page.records.find((x) => x.successful && x.memo_type === 'text' && /^QW#\d+$/.test(x.memo));
  if (!t) throw new Error('no anchoring transaction found yet');
  const acct = await server.loadAccount(cfg.anchor_account);
  const keys = acct.signers.filter((s) => s.key !== cfg.anchor_account).map((s) => s.key);
  const hash = Buffer.from(t.hash, 'hex');
  const signer_keys = [];
  for (const b64 of t.signatures || []) {
    const sig = Buffer.from(b64, 'base64');
    const k = keys.find((key) => S.Keypair.fromPublicKey(key).verify(hash, sig));
    if (k && !signer_keys.includes(k)) signer_keys.push(k);
  }
  const R = { ...(cfg.signers || {}) };
  for (const r of ROLES) if (roles && roles[r]) R[r] = roles[r];
  const roleOf = (k) => ROLES.find((r) => R[r] === k) || 'unknown';
  const pair = signer_keys.map(roleOf).sort((a, b) => ROLES.indexOf(a) - ROLES.indexOf(b)).join('+');
  const sigs = (t.signatures || []).length;
  return {
    ok: signer_keys.length === 2 && pair === 'proposer+verifier',
    hash: t.hash, ledger: t.ledger_attr ?? t.ledger, memo: t.memo, signatures: sigs, signer_keys, pair,
    link: CAP.txLink(t.hash), envelope_xdr: t.envelope_xdr || null, transaction: t,
    expect: 'anchored with two signatures: proposer + verifier',
  };
}

/** D — verifier host, in memory only: alter the published batch after the proposer signed. */
async function testD({ feedUrl, cfg }) {
  const feed = makeFeedClient(feedUrl);
  const listed = await feed.batches();
  for (let i = listed.length - 1; i >= 0; i--) {
    const e = listed[i];
    if (e.status !== 'accepted') continue;
    const pending = await feed.pending(e.batch_id);
    if (!pending) continue;
    const batch = await feed.batch(e.batch_id);
    const forged = JSON.parse(JSON.stringify(batch));
    if (!forged.intervals.length) continue;
    forged.intervals[0].meters.a.mwh += 1000;
    if (forged.intervals[0].meters.b) forged.intervals[0].meters.b.mwh += 1000;
    forged.energy_mwh = forged.intervals.reduce((s, r) => s + E.basisMwh(r), 0);
    forged.cumulative_mwh = batch.cumulative_mwh - batch.energy_mwh + forged.energy_mwh;
    forged.intervals_root = E.merkleRoot(forged.intervals);
    forged.sha256 = E.batchSha256(forged);
    const ptx = new S.Transaction(pending, cfg.network_passphrase);
    const m = T.matchPending(pending, forged, cfg, Math.min(nowS(), Number(ptx.timeBounds.maxTime) - 1));
    return {
      ok: !m.match, refused: !m.match, reasons: m.reasons, detail: m.detail, batch_id: e.batch_id, forged_sha256: forged.sha256,
      pending_envelope_xdr: pending, pending_tx_hash: ptx.hash().toString('hex'), submitted: false,
      expect: 'verifier refuses; nothing submitted, nothing published',
    };
  }
  throw new Error('no published pending proposal with intervals to test against');
}

/** Given to the verifier in test I: it can never sign, whatever happens. */
const neverSigner = Object.freeze({
  kind: 'none', identity: null, publicKey: null,
  async init() { return this; }, async version() { return null; },
  async sign() { throw new SG.SignerError('test I never signs'); },
});

/** I — independence: the real verifier, with the live proposal's batch withheld from its only input path. */
async function testI({ feedUrl, cfg, server, now = nowS() }) {
  const feed = makeFeedClient(feedUrl);
  const base = { refused: false, reasons: [], submitted: false, method: METHOD_I, expect: 'verifier refuses (verifier.not_published); nothing signed or submitted' };
  const { next, pending } = await liveProposal(feed, server, cfg);
  const notLive = (why) => ({ ...base, ok: false, batch_id: next ? next.batch_id : null, detail: `${why}: run I while a live proposal is pending and the verifier service is stopped` });
  if (!next || !pending) return notLive('no live proposal');
  let ptx = null;
  try { ptx = new S.Transaction(pending, cfg.network_passphrase); } catch (e) { /* unparseable: the verifier judges it */ }
  if (ptx && ptx.timeBounds && Number(ptx.timeBounds.maxTime) !== 0 && Number(ptx.timeBounds.maxTime) <= now) return notLive('the pending proposal has expired');
  const proxy = await withholdingFeed(feedUrl, `batches/${next.batch_id}.json`);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-test-i-'));
  let r;
  try {
    r = await new Verifier({ feedUrl: proxy.url, cfg, signer: neverSigner, stateDir, server }).tick(now);
  } finally { await proxy.close(); }
  const refusalLog = path.join(stateDir, 'refusals.jsonl');
  const refused = r.action === 'refused';
  return {
    ...base,
    ok: refused && (r.reasons || []).includes('verifier.not_published'),
    refused, reasons: r.reasons || [], action: r.action, detail: r.detail || r.reason || null,
    batch_id: next.batch_id, withheld: proxy.withheld,
    pending_envelope_xdr: pending, pending_tx_hash: ptx ? ptx.hash().toString('hex') : null,
    refusal_log: refusalLog, refusals: fs.existsSync(refusalLog) ? fs.readFileSync(refusalLog, 'utf8') : '',
  };
}

/**
 * The overall verdict. PASS needs A and B refused as tx_bad_auth on an account at 2/2/3, C anchored by
 * proposer + verifier, D refused with verifier.hash_mismatch, I refused with verifier.not_published, and
 * A, B and C one transaction body. INCOMPLETE while a step is missing.
 * @returns {{verdict:'PASS'|'FAIL'|'INCOMPLETE', detail:string[]}}
 */
function verdictOf(steps) {
  const s = steps || {};
  const A = s.A_proposer_alone, B = s.B_verifier_alone, Cs = s.C_proposer_plus_verifier, D = s.D_altered_after_proposer_signed, I = s.I_withheld_refused;
  const detail = [];
  if (A && !(A.refused && A.thresholds_match === true)) detail.push('A was not refused as tx_bad_auth on an account at 2/2/3');
  if (B && !(B.refused && B.thresholds_match === true)) detail.push('B was not refused as tx_bad_auth on an account at 2/2/3');
  if (Cs && !Cs.ok) detail.push(`C is not an anchor signed by proposer + verifier (${Cs.pair || 'signers unknown'})`);
  if (D && !(D.refused && (D.reasons || []).includes('verifier.hash_mismatch'))) detail.push('D was not refused with verifier.hash_mismatch');
  if (I && !(I.refused && (I.reasons || []).includes('verifier.not_published'))) detail.push('I was not refused with verifier.not_published');
  if (A && B && Cs && !(A.body_hash && A.body_hash === B.body_hash && A.body_hash === Cs.hash)) detail.push('A, B and C are not one transaction body (their hashes differ)');
  const missing = Object.values(STEP).filter((k) => !s[k]);
  if (missing.length) return { verdict: 'INCOMPLETE', detail: [...missing.map((k) => `${k} not run yet`), ...detail] };
  return { verdict: detail.length ? 'FAIL' : 'PASS', detail };
}

/** The raw files a step leaves beside abcd.json. */
function rawFiles(which, r) {
  const f = {};
  const L = which.toUpperCase();
  if ((which === 'a' || which === 'b') && r.envelope_xdr) f[`${L}.envelope.xdr`] = r.envelope_xdr + '\n';
  if ((which === 'a' || which === 'b') && r.horizon_response) f[`${L}.horizon.json`] = JSON.stringify(r.horizon_response, null, 2) + '\n';
  if (which === 'c' && r.transaction) f['C.transaction.json'] = JSON.stringify(r.transaction, null, 2) + '\n';
  if ((which === 'd' || which === 'i') && r.pending_envelope_xdr) f[`${L}.pending.xdr`] = r.pending_envelope_xdr + '\n';
  if (which === 'i' && r.refusals != null) f['I.refusals.jsonl'] = r.refusals;
  return f;
}

function writeVerdict(ev) {
  const v = verdictOf(ev.steps);
  ev.verdict = v.verdict;
  ev.verdict_detail = v.detail;
  return ev;
}

/** Merge one step's result into the evidence file and write its raw files beside it (index.json with SHA-256). */
function merge(file, account, which, result) {
  if (!STEP[which]) throw new Error(`unknown step ${which}`);
  const ev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { network: 'testnet', public_keys: { account }, steps: {} };
  if (ev.public_keys.account && ev.public_keys.account !== account) throw new Error(`${file} holds evidence for ${ev.public_keys.account}, not ${account}`);
  ev.public_keys.account = account;
  const { transaction, ...step } = result;                          // the Horizon record goes to C.transaction.json
  ev.steps[STEP[which]] = { ...step, at: new Date().toISOString() };
  writeVerdict(ev);
  CAP.writeEvidence(path.dirname(path.resolve(file)), 'abcd', { files: { ...rawFiles(which, result), [path.basename(file)]: JSON.stringify(ev, null, 2) + '\n' } });
  return ev;
}

/**
 * Join the evidence files written on the hosts into one, with their raw files beside it. All inputs must
 * be for the same account; a step recorded twice with different content is refused. The verdict is recomputed.
 */
function combine(outFile, inFiles) {
  if (!inFiles || !inFiles.length) throw new Error('combine: no input files');
  let account = null;
  const steps = {}, raw = {}, rawSha = {};
  for (const f of inFiles) {
    const ev = JSON.parse(fs.readFileSync(f, 'utf8'));
    const acct = ev.public_keys && ev.public_keys.account;
    if (!acct) throw new Error(`${f}: no public_keys.account`);
    if (account && acct !== account) throw new Error(`${f} is evidence for account ${acct}, not ${account}`);
    account = acct;
    for (const [k, v] of Object.entries(ev.steps || {})) {
      if (steps[k] && JSON.stringify(steps[k]) !== JSON.stringify(v)) throw new Error(`${k} is recorded twice with different content (${f}); keep one run of each step`);
      steps[k] = v;
    }
    const dir = path.dirname(path.resolve(f));
    const indexFile = path.join(dir, 'index.json');
    if (!fs.existsSync(indexFile)) continue;
    for (const [rel, sha] of Object.entries(JSON.parse(fs.readFileSync(indexFile, 'utf8')).files || {})) {
      if (!/^[ABCDI]\.[a-z.]+$/.test(rel)) continue;                 // the raw files of the steps only
      const buf = fs.readFileSync(path.join(dir, rel));
      if (CAP.sha256(buf) !== sha) throw new Error(`${path.join(dir, rel)} does not match the SHA-256 in its index.json`);
      if (rawSha[rel] && rawSha[rel] !== sha) throw new Error(`${rel} differs between the inputs`);
      rawSha[rel] = sha;
      raw[rel] = buf;
    }
  }
  const ev = writeVerdict({ network: 'testnet', public_keys: { account }, steps, combined_from: inFiles.map((f) => `${path.basename(path.dirname(path.resolve(f)))}/${path.basename(f)}`) });
  CAP.writeEvidence(path.dirname(path.resolve(outFile)), 'abcd', { files: { ...raw, [path.basename(outFile)]: JSON.stringify(ev, null, 2) + '\n' } });
  return ev;
}

async function cli() {
  const args = process.argv.slice(2);
  const which = (args[0] || '').toLowerCase();
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const usage = [
    'usage: node anchor/tests-abcd.js a --config anchor.json --feed URL | --feed-dir DIR [--out FILE]',
    '       node anchor/tests-abcd.js b --config anchor.json --feed URL --sign-with-key qwatt-verifier [--stellar-bin stellar] [--max-walk N] [--out FILE]',
    '       node anchor/tests-abcd.js c --config anchor.json [--proposer G… --verifier G…] [--out FILE]',
    '       node anchor/tests-abcd.js d --config anchor.json --feed URL [--out FILE]',
    '       node anchor/tests-abcd.js i --config anchor.json --feed URL [--out FILE]',
    '       node anchor/tests-abcd.js combine --out FILE IN…',
  ].join('\n');
  if (which !== 'combine' && !STEP[which]) { console.error(usage); process.exit(2); }
  const env = SG.refuseEnvSecrets(['QWATT_PROPOSER_SECRET', 'QWATT_VERIFIER_SECRET']);
  if (env) { console.error(env); process.exit(2); }

  if (which === 'combine') {
    const out = opt('--out');
    const inputs = args.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--out');
    if (!out || !inputs.length) { console.error(usage); process.exit(2); }
    const ev = combine(path.resolve(out), inputs.map((f) => path.resolve(f)));
    for (const k of Object.values(STEP)) console.log(`  ${ev.steps[k] ? '✓' : '·'} ${k}`);
    for (const d of ev.verdict_detail) console.log(`  - ${d}`);
    console.log(`A–D and independence evidence verdict: ${ev.verdict} → ${path.resolve(out)}`);
    process.exitCode = ev.verdict === 'PASS' ? 0 : 1;
    return;
  }

  if (which === 'b' && !args.includes('--sign-with-key')) { console.error(`--sign-with-key <identity> is required: test B runs on the verifier host and signs as its stellar-cli identity (qwatt-verifier)\n${usage}`); process.exit(2); }
  let maxWalk;
  try { maxWalk = C.maxWalkArg(args); } catch (e) { console.error(e.message); process.exit(2); }
  const cfg = loadConfig(opt('--config', path.join(__dirname, 'config.json')));
  let signer = null;
  if (which === 'b') {
    const r = await SG.signerForRole({ args, cfg, role: 'verifier', envNames: ['QWATT_PROPOSER_SECRET', 'QWATT_VERIFIER_SECRET'] });
    if (r.error) { console.error(`${r.error}\n${usage}`); process.exit(2); }
    signer = r.signer;
  }
  const feedUrl = opt('--feed'), feedDir = opt('--feed-dir') ? path.resolve(opt('--feed-dir')) : null;
  if (['b', 'd', 'i'].includes(which) && !feedUrl) { console.error(`--feed <public feed URL> is required for test ${which.toUpperCase()}\n${usage}`); process.exit(2); }
  if (which === 'a' && !feedUrl && !feedDir) { console.error(`--feed <public feed URL> or --feed-dir DIR is required for test A\n${usage}`); process.exit(2); }
  const server = new S.Horizon.Server(cfg.horizon_url);
  const roles = { proposer: opt('--proposer'), verifier: opt('--verifier') };
  const run = {
    a: () => testA({ feedUrl, feedDir, cfg, server }),
    b: () => testB({ feedUrl, cfg, signer, server, maxWalk }),
    c: () => testC({ cfg, server, roles }),
    d: () => testD({ feedUrl, cfg }),
    i: () => testI({ feedUrl, cfg, server }),
  }[which];
  const result = await run();
  const out = path.resolve(opt('--out', path.join(__dirname, '..', 'evidence', 'abcd', 'abcd.json')));
  const ev = merge(out, cfg.anchor_account, which, result);
  const { envelope_xdr, horizon_response, transaction, refusals, pending_envelope_xdr, ...brief } = result;
  console.log(`test ${which.toUpperCase()}: ${JSON.stringify(brief)}`);
  console.log(`evidence verdict so far: ${ev.verdict} → ${out}`);
}

if (require.main === module) cli().catch((e) => { console.error('test failed to run:', e.message); process.exitCode = 1; });

module.exports = { testA, testB, testC, testD, testI, merge, combine, verdictOf, authRefused, accountThresholds, STEP, METHOD_I };
