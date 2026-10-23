/**
 * QWATT — reconciliation tests (Deliverable 4), offline
 * Run: node batch/reconcile.test.js
 *
 * The anchors here are what Horizon would return for an honest proposer +
 * verifier; each test then breaks one thing and expects the matching verdict.
 * Since V3-9 the reconciliation also reads the anchoring account (signers,
 * thresholds) and every anchor's signatures: the keys are throwaway Ed25519
 * keys made in memory with node:crypto, and Horizon is a fake on 127.0.0.1
 * (anchor/fake-horizon-http.js). Nothing here touches the network.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../protocol/evidence');
const V = require('./verify');
const R = require('../assets/qwatt-reconcile.js');
const TH = require('../anchor/thresholds');
const FH = require('../anchor/fake-horizon-http');
const { Pipeline } = require('./pipeline');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const LABEL = 'Simulated input · assurance A0 · Stellar testnet';
const DT = 300, T0 = Date.parse('2026-09-20T15:00:00Z');
function iv(i, bW = 99) {
  const t = T0 + i * DT * 1000;
  const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
  return {
    spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION,
    site_id: 'rc', node_id: 'rc', seq: i,
    ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
    meters: { a: m('a', 100), b: m('b', bW) },
    source: { adapter: 'simulator', raw_sha256: E.sha256('rc-' + i) },
  };
}

/* the anchoring account and its three signers: throwaway keys, made in memory for this run only */
const KEYS = { proposer: FH.throwawayKey(), verifier: FH.throwawayKey(), third: FH.throwawayKey() };
const OUTSIDER = FH.throwawayKey();
const ACCOUNT = FH.throwawayKey().G;
const ROLES = { proposer: KEYS.proposer.G, verifier: KEYS.verifier.G, third: KEYS.third.G };
const honestRecord = (over = {}) => FH.accountRecord({ account: ACCOUNT, signers: [ROLES.proposer, ROLES.verifier, ROLES.third], ...over });
/** What the reconciliation reads from Horizon besides the anchors: the account as it is now, and who is who. */
const chainFor = (over = {}) => ({ account: ACCOUNT, record: honestRecord(), roles: ROLES, ...over });
const sign = (who, txHash) => (who === 'outsider' ? OUTSIDER : KEYS[who]).sign(txHash);
/** The run's faults.json as live/run.js publishes it from week 2: the fixed label and who signs (public keys only). */
const runFile = (over = {}) => ({ description: 'reconcile test feed', label: LABEL, anchoring: { network: 'testnet', signers: ROLES }, faults: [], ...over });

/** A feed of `n` batches (one shaded-sensor fault in batch 1), with its faults.json, read back the way fetchFeed returns it. */
function makeFeed(n = 4) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-rc-'));
  const p = new Pipeline({ dir, site_id: 'rc', node_id: 'rc' });
  for (let i = 0; i < 12 * n; i++) p.push(i === 17 ? iv(i, 50) : iv(i));
  const run = runFile();
  fs.writeFileSync(path.join(dir, 'faults.json'), JSON.stringify(run, null, 2) + '\n');
  const listed = p.feed.readLedger('batches');
  const batches = Object.fromEntries(listed.map((e) => [e.batch_id, p.feed.readBatch(e.batch_id)]));
  return { dir, feed: { index: p.feed.readIndex(), run, listed, batches, rejected: p.feed.readLedger('rejected') } };
}

/** Honest anchors for the first k accepted batches, each signed by the proposer and the verifier over its transaction hash. */
function anchorsFor(feed, k, signers = ['proposer', 'verifier']) {
  return feed.listed.filter((e) => e.status === 'accepted').slice(0, k).map((e, i) => {
    const tx_hash = E.sha256('tx' + e.seq);
    return {
      tx_hash, ledger: 1000 + i, created_at: new Date(T0 + i * 3600e3).toISOString(),
      memo: `QW#${e.seq}`, sha256: e.sha256, cumulative_mwh: feed.batches[e.batch_id].cumulative_mwh,
      signatures: signers.map((w) => sign(w, tx_hash)),
    };
  });
}
const resign = (a, signers, over = {}) => ({ ...a, signatures: signers.map((w) => sign(w, over.signHash || a.tx_hash)) });

/** Serve a directory on 127.0.0.1 (the published feed); `onRequest` sees every request path as it arrives. */
async function serveDir(dir, onRequest) {
  const http = require('http');
  const srv = http.createServer((req, res) => {
    if (onRequest) onRequest(req.url);
    const f = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(() => r()); }) };
}

/* ───────────────────────── week 1: feed ↔ anchors ───────────────────────── */

test('browser canonical JSON and SHA-256 are byte-identical to protocol/evidence.js', async () => {
  const { feed } = makeFeed(1);
  const b = feed.batches[feed.listed[0].batch_id];
  eq(R.canonical(b), E.canonical(b), 'canonical');
  eq(await R.batchSha256(b), E.batchSha256(b), 'batch hash');
  for (const bad of [1.5, Infinity, NaN]) { let threw = false; try { R.canonical({ x: bad }); } catch (e) { threw = true; } assert(threw, `refuses ${bad}`); }
});

test('everything anchored and matching → RECONCILED, with the rejection breakdown', async () => {
  const { feed } = makeFeed(4);
  const rep = await R.reconcile(feed, anchorsFor(feed, 4), chainFor());
  eq(rep.verdict, 'RECONCILED', rep.problems.join('; '));
  eq(rep.summary.anchored_batches, 4, 'anchored');
  eq(rep.summary.anchored_cumulative_mwh, rep.summary.published_cumulative_mwh, 'cumulative agrees');
  eq(rep.summary.rejected_by_reason['agreement.diverge'], 1, 'the shaded-sensor fault is counted');
});

test('only the newest batches awaiting anchor → PENDING, not broken', async () => {
  const { feed } = makeFeed(4);
  const rep = await R.reconcile(feed, anchorsFor(feed, 2), chainFor());
  eq(rep.verdict, 'PENDING', rep.problems.join('; '));
  eq(rep.summary.awaiting_anchor.length, 2, 'two awaiting');
});

test('a batch file edited after anchoring → BROKEN', async () => {
  const { feed } = makeFeed(3);
  const anchors = anchorsFor(feed, 3);
  const id = feed.listed[1].batch_id;
  feed.batches[id] = Object.assign({}, feed.batches[id], { energy_mwh: feed.batches[id].energy_mwh + 1 });
  const rep = await R.reconcile(feed, anchors, chainFor());
  eq(rep.verdict, 'BROKEN', 'verdict');
  assert(rep.problems.some((p) => p.includes(id) && /re-hash/.test(p)), rep.problems.join('; '));
});

test('a forged batch re-hashed and re-listed is still caught: its hash is not what was anchored', async () => {
  const { feed } = makeFeed(3);
  const anchors = anchorsFor(feed, 3);
  const last = feed.listed[2];
  const forged = JSON.parse(JSON.stringify(feed.batches[last.batch_id]));
  forged.intervals[0].meters.a.mwh += 500; forged.intervals[0].meters.b.mwh += 500;
  forged.energy_mwh = forged.intervals.reduce((s, r) => s + E.basisMwh(r), 0);
  forged.cumulative_mwh = feed.batches[feed.listed[1].batch_id].cumulative_mwh + forged.energy_mwh;
  forged.intervals_root = E.merkleRoot(forged.intervals);
  forged.sha256 = E.batchSha256(forged);
  feed.batches[last.batch_id] = forged;
  feed.listed[2] = Object.assign({}, last, { sha256: forged.sha256 });
  const rep = await R.reconcile(feed, anchors, chainFor());
  eq(rep.verdict, 'BROKEN', 'verdict');
  assert(rep.problems.some((p) => /not a published batch/.test(p)), rep.problems.join('; '));
});

test('an anchored batch after an unanchored one → BROKEN (gap)', async () => {
  const { feed } = makeFeed(3);
  const a = anchorsFor(feed, 3);
  const rep = await R.reconcile(feed, [a[0], a[2]], chainFor());
  eq(rep.verdict, 'BROKEN', 'verdict');
  assert(rep.problems.some((p) => /gap/.test(p)), rep.problems.join('; '));
});

test('wrong cumulative, wrong memo, or the same hash anchored twice → BROKEN', async () => {
  const { feed } = makeFeed(2);
  const base = anchorsFor(feed, 2);
  const cases = [
    [[base[0], Object.assign({}, base[1], { cumulative_mwh: 1 })], /cumulative/],
    [[base[0], Object.assign({}, base[1], { memo: 'QW#9' })], /memo/],
    [[base[0], base[1], Object.assign({}, base[1], { tx_hash: E.sha256('dup') })], /twice/],
  ];
  for (const [anchors, re] of cases) {
    const rep = await R.reconcile(feed, anchors, chainFor());
    eq(rep.verdict, 'BROKEN', String(re));
    assert(rep.problems.some((p) => re.test(p)), `${re}: ${rep.problems.join('; ')}`);
  }
});

test('a broken chain link in the feed → BROKEN', async () => {
  const { feed } = makeFeed(3);
  const id = feed.listed[2].batch_id;
  const b = Object.assign({}, feed.batches[id], { prev_hash: 'e'.repeat(64) });
  b.sha256 = E.batchSha256(b);
  feed.batches[id] = b; feed.listed[2] = Object.assign({}, feed.listed[2], { sha256: b.sha256 });
  const rep = await R.reconcile(feed, anchorsFor(feed, 2), chainFor());
  eq(rep.verdict, 'BROKEN', 'verdict');
  assert(rep.problems.some((p) => /chain/.test(p)), rep.problems.join('; '));
});

test('the on-chain cumulative is the energy of accepted batches only: a refused batch that adds its energy is BROKEN, one that carries the total forward reconciles', async () => {
  const { feed } = makeFeed(1);
  const b0 = feed.batches[feed.listed[0].batch_id];
  const next = (prev, intervals, cumulative) => {
    const energy = intervals.reduce((s, r) => s + E.basisMwh(r), 0);
    const b = {
      batch_id: E.batchId(prev.site_id, prev.seq + 1), site_id: prev.site_id, node_id: prev.node_id, seq: prev.seq + 1,
      ts_start: intervals[0].ts_start, ts_end: intervals[intervals.length - 1].ts_end, spec_version: prev.spec_version, schema_version: prev.schema_version,
      interval_count: intervals.length, accepted_count: intervals.length, rejected_count: 0, intervals, intervals_root: E.merkleRoot(intervals),
      energy_mwh: energy, cumulative_mwh: cumulative ?? prev.cumulative_mwh + energy, prev_hash: prev.sha256,
    };
    b.sha256 = E.batchSha256(b);
    return b;
  };
  const withRefused = (carry) => {
    const f = JSON.parse(JSON.stringify(feed));
    const refused = next(b0, b0.intervals, carry ? b0.cumulative_mwh : undefined);   // batch 0 re-sent: refused
    const after = next(refused, Array.from({ length: 12 }, (_, k) => iv(12 + k)));
    for (const [b, status] of [[refused, 'rejected'], [after, 'accepted']]) {
      f.listed.push({ batch_id: b.batch_id, seq: b.seq, sha256: b.sha256, status, reasons: status === 'rejected' ? ['batch.interval_repeated'] : [] });
      f.batches[b.batch_id] = b;
    }
    return { f, after };
  };
  const ok = withRefused(true);
  const rep = await R.reconcile(ok.f, anchorsFor(ok.f, 2), chainFor());
  eq(rep.verdict, 'RECONCILED', rep.problems.join('; '));
  eq(rep.summary.anchored_cumulative_mwh, b0.energy_mwh + ok.after.energy_mwh, 'anchored total = energy of accepted batches');
  const bad = withRefused(false);
  const rep2 = await R.reconcile(bad.f, anchorsFor(bad.f, 2), chainFor());
  eq(rep2.verdict, 'BROKEN', 'a refused batch that adds its energy');
  assert(rep2.problems.some((p) => /accepted/.test(p) && p.includes(bad.f.listed[1].batch_id)), rep2.problems.join('; '));
});

test('fetchFeed reads a served feed exactly as published', async () => {
  const { dir, feed } = makeFeed(2);
  const host = await serveDir(dir);
  let got;
  try { got = await R.fetchFeed(host.url); } finally { await host.close(); }
  eq(got.listed.length, feed.listed.length, 'listed');
  eq(got.rejected.length, feed.rejected.length, 'rejected');
  eq((await R.reconcile(got, anchorsFor(got, 2), chainFor())).verdict, 'RECONCILED', 'reconciles');
});

/* ───────────── week 2 (V3-9): fixed label, account rules and signatures read from Horizon ───────────── */

const { promisify } = require('util');
const execFileP = promisify(require('child_process').execFile);
/** Run anchor/reconcile-cli.js without blocking this process (the fake servers live here): { code, stdout, stderr }. */
async function runCli(args, nodeArgs = []) {
  try {
    const r = await execFileP(process.execPath, [...nodeArgs, path.join(__dirname, '..', 'anchor', 'reconcile-cli.js'), ...args], { timeout: 60000 });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    if (typeof e.code !== 'number') throw e;
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

test('V3-9: the fixed label is "Simulated input · assurance A0 · Stellar testnet", and the account rules mirror anchor/thresholds.js', async () => {
  eq(R.INPUT_LABEL, LABEL, 'R.INPUT_LABEL');
  const rules = R.ACCOUNT_RULES || {};
  eq(JSON.stringify(rules), JSON.stringify({ low: TH.THRESHOLDS.low, med: TH.THRESHOLDS.med, high: TH.THRESHOLDS.high, master_weight: 0, signers: 3, signer_weight: 1 }), 'R.ACCOUNT_RULES');
  eq(JSON.stringify(R.ROLE_NAMES), JSON.stringify(['proposer', 'verifier', 'third']), 'R.ROLE_NAMES');
});

test('V3-9: publicKeyBytes decodes a G… address to its 32 bytes and refuses a wrong checksum, a secret-key prefix or junk', async () => {
  assert(typeof R.publicKeyBytes === 'function', 'R.publicKeyBytes is exported');
  const k = FH.throwawayKey();
  const raw = R.publicKeyBytes(k.G);
  eq(raw && raw.length, 32, 'decoded length');
  eq(FH.gAddress(Buffer.from(raw)), k.G, 'the 32 bytes re-encode to the same address');
  const flipped = k.G.slice(0, 55) + (k.G[55] === 'A' ? 'B' : 'A');
  eq(R.publicKeyBytes(flipped), null, 'checksum');
  eq(R.publicKeyBytes('S' + k.G.slice(1)), null, 'S… prefix');
  eq(R.publicKeyBytes('G123'), null, 'junk');
  eq(R.publicKeyBytes(null), null, 'null');
});

test('V3-9: reconcile refuses to judge without the account read from Horizon (two arguments throw)', async () => {
  const { feed } = makeFeed(1);
  let threw = false;
  try { await R.reconcile(feed, anchorsFor(feed, 1)); } catch (e) { threw = /account/.test(e.message); }
  assert(threw, 'reconcile(feed, anchors) must throw: the verdict needs signers, thresholds and signatures');
});

test('V3-9: honest account and proposer + verifier on every anchor → RECONCILED, every anchor normal, the account rules reported as read', async () => {
  const { feed } = makeFeed(3);
  const rep = await R.reconcile(feed, anchorsFor(feed, 3), chainFor());
  eq(rep.verdict, 'RECONCILED', rep.problems.join('; '));
  const sig = rep.summary.signatures || {};
  eq(sig.normal, 3, 'normal'); eq(sig.stand_in, 0, 'stand-in'); eq(sig.broken, 0, 'broken'); eq(sig.unchecked, 0, 'unchecked');
  for (const r of rep.rows.filter((x) => x.anchor)) { eq(r.anchor.signed_by, 'proposer+verifier', r.batch_id); eq(r.anchor.mode, 'normal', r.batch_id); }
  const a = rep.summary.account || {};
  eq(a.id, ACCOUNT, 'account id'); eq(a.ok, true, 'account ok'); eq(a.thresholds, '2/2/3', 'thresholds as read'); eq(a.master_weight, 0, 'master weight as read');
  eq((a.signers || []).map((s) => s.role).sort().join(','), 'proposer,third,verifier', 'roles');
  eq(rep.summary.label, LABEL, 'label in the report');
  eq(rep.summary.label_in_feed, true, 'faults.json carries the label');
  eq(JSON.stringify(rep.summary.stand_in_batches), '[]', 'no stand-in');
});

test('V3-9: proposer + third signer is STAND-IN: it still reconciles, and that anchor is reported as stand-in', async () => {
  const { feed } = makeFeed(3);
  const anchors = anchorsFor(feed, 3);
  anchors[1] = resign(anchors[1], ['third', 'proposer']);   // signature order does not matter
  const rep = await R.reconcile(feed, anchors, chainFor());
  eq(rep.verdict, 'RECONCILED', rep.problems.join('; '));
  eq((rep.summary.signatures || {}).stand_in, 1, 'one stand-in');
  eq((rep.summary.signatures || {}).normal, 2, 'two normal');
  eq(JSON.stringify(rep.summary.stand_in_batches), JSON.stringify([feed.listed[1].batch_id]), 'which batch');
  const row = rep.rows.find((r) => r.batch_id === feed.listed[1].batch_id);
  eq(row.anchor.mode, 'stand-in', 'row mode'); eq(row.anchor.signed_by, 'proposer+third', 'row signers');
});

test('V3-9: any other signature set is BROKEN: verifier + third, one signature, all three, one key twice, a key that is not a signer, a signature over another transaction', async () => {
  const { feed } = makeFeed(2);
  const id = feed.listed[1].batch_id;
  const cases = [
    [['verifier', 'third'], /signed by verifier\+third;/],
    [['proposer'], /signed by proposer;/],
    [['proposer', 'verifier', 'third'], /signed by proposer\+verifier\+third;/],
    [['proposer', 'proposer'], /signed by proposer\+proposer;/],
    [['proposer', 'outsider'], /signed by proposer\+unknown key;/],
  ];
  for (const [signers, re] of cases) {
    const anchors = anchorsFor(feed, 2);
    anchors[1] = resign(anchors[1], signers);
    const rep = await R.reconcile(feed, anchors, chainFor());
    eq(rep.verdict, 'BROKEN', signers.join('+'));
    assert(rep.problems.some((p) => re.test(p) && p.includes(id)), `${re}: ${rep.problems.join('; ')}`);
    eq(rep.summary.signatures.broken, 1, `${signers.join('+')}: one broken anchor`);
    eq(rep.rows.find((r) => r.batch_id === id).anchor.mode, 'broken', `${signers.join('+')}: row mode`);
  }
  /* the verifier's signature over a different transaction does not count for this one */
  const anchors = anchorsFor(feed, 2);
  anchors[1] = { ...anchors[1], signatures: [sign('proposer', anchors[1].tx_hash), sign('verifier', E.sha256('another transaction'))] };
  const rep = await R.reconcile(feed, anchors, chainFor());
  eq(rep.verdict, 'BROKEN', 'signature over another hash');
  assert(rep.problems.some((p) => /signed by proposer\+unknown key/.test(p) && p.includes(id)), rep.problems.join('; '));
  /* Horizon returned no signatures at all */
  const bare = anchorsFor(feed, 2).map(({ signatures, ...a }) => a);
  const rep2 = await R.reconcile(feed, bare, chainFor());
  eq(rep2.verdict, 'BROKEN', 'no signatures returned');
  assert(rep2.problems.some((p) => /Horizon returned no signatures/.test(p)), rep2.problems.join('; '));
});

test('V3-9: the account must be 2/2/3, master weight 0, exactly three ed25519 signers of weight 1 — anything else is BROKEN, and the problem names it', async () => {
  const { feed } = makeFeed(2);
  const P = ROLES.proposer, Vk = ROLES.verifier, Tk = ROLES.third;
  const cases = [
    [honestRecord({ thresholds: { low: 1, med: 2, high: 3 } }), /thresholds 1\/2\/3/],
    [honestRecord({ thresholds: { low: 2, med: 1, high: 3 } }), /thresholds 2\/1\/3/],
    [honestRecord({ types: { [Tk]: 'sha256_hash' } }), /sha256_hash/],
    [honestRecord({ thresholds: { low: 2, med: 2, high: 2 }, signers: [P, Vk] }), /thresholds 2\/2\/2/],
    [honestRecord({ thresholds: { low: 2, med: 2, high: 2 }, signers: [P, Vk] }), /2 signer\(s\)/],
    [honestRecord({ master: 1 }), /master weight 1/],
    [honestRecord({ signers: [P, Vk, Tk, OUTSIDER.G] }), /4 signer\(s\)/],
    [honestRecord({ weights: { [Vk]: 2 } }), /weight 2/],
    [honestRecord({ types: { [Tk]: 'preauth_tx' } }), /preauth_tx/],
    [null, /could not be read from Horizon/],
  ];
  for (const [record, re] of cases) {
    const rep = await R.reconcile(feed, anchorsFor(feed, 2), chainFor({ record }));
    eq(rep.verdict, 'BROKEN', String(re));
    assert(rep.problems.some((p) => re.test(p)), `${re}: ${rep.problems.join('; ')}`);
    eq((rep.summary.account || {}).ok, false, `${re}: account not ok`);
  }
});

test('V3-9: signer roles come from the run\'s faults.json; roles given that differ from it, roles that are not the account\'s signers, bad or repeated keys, or no roles at all → BROKEN', async () => {
  const { feed } = makeFeed(2);   // its faults.json declares ROLES
  const anchors = anchorsFor(feed, 2);
  const r0 = await R.reconcile(feed, anchors, chainFor({ roles: null }));
  eq(r0.verdict, 'RECONCILED', r0.problems.join('; '));
  eq(r0.summary.roles_source, 'faults.json', 'roles read from faults.json');
  eq(JSON.stringify(r0.summary.roles), JSON.stringify(ROLES), 'the roles as declared');
  const swapped = { proposer: ROLES.proposer, verifier: ROLES.third, third: ROLES.verifier };
  const r1 = await R.reconcile(feed, anchors, chainFor({ roles: swapped }));
  eq(r1.verdict, 'BROKEN', 'given roles differ from faults.json');
  assert(r1.problems.some((p) => /differ from the run's faults\.json/.test(p)), r1.problems.join('; '));
  const undeclared = { ...feed, run: runFile({ anchoring: undefined }) };
  const given = await R.reconcile(undeclared, anchors, chainFor());
  eq(given.verdict, 'RECONCILED', `roles given for a feed that declares none: ${given.problems.join('; ')}`);
  eq(given.summary.roles_source, 'given', 'roles source');
  const r2 = await R.reconcile(undeclared, anchors, chainFor({ roles: { ...ROLES, third: OUTSIDER.G } }));
  eq(r2.verdict, 'BROKEN', 'a role key that is not a signer');
  assert(r2.problems.some((p) => /the third key G\w+ is not a signer of the anchoring account/.test(p)), r2.problems.join('; '));
  const r3 = await R.reconcile(undeclared, anchors, chainFor({ roles: null }));
  eq(r3.verdict, 'BROKEN', 'no roles anywhere');
  assert(r3.problems.some((p) => /signer roles are not declared/.test(p)), r3.problems.join('; '));
  eq(r3.summary.signatures.unchecked, 2, 'no roles: the anchors stay unchecked');
  const r4 = await R.reconcile(undeclared, anchors, chainFor({ roles: { ...ROLES, proposer: 'GBAD' } }));
  eq(r4.verdict, 'BROKEN', 'a role that is not a G… key');
  assert(r4.problems.some((p) => /the proposer is not a valid G… public key/.test(p)), r4.problems.join('; '));
  const r5 = await R.reconcile(undeclared, anchors, chainFor({ roles: { ...ROLES, verifier: ROLES.proposer } }));
  eq(r5.verdict, 'BROKEN', 'one key in two roles');
  assert(r5.problems.some((p) => /three different keys/.test(p)), r5.problems.join('; '));
});

test('V3-9: a published faults.json without the fixed label, or with another one, is BROKEN', async () => {
  const { feed } = makeFeed(1);
  for (const label of [undefined, 'Measured input · assurance A1 · Stellar testnet', 'Simulated input · Stellar testnet', 'Simulated input · assurance A1 · Stellar testnet', 'Simulated input · assurance A0 · Stellar testnet ']) {
    const rep = await R.reconcile({ ...feed, run: runFile({ label }) }, anchorsFor(feed, 1), chainFor({ roles: null }));
    eq(rep.verdict, 'BROKEN', String(label));
    assert(rep.problems.some((p) => /fixed label/.test(p)), rep.problems.join('; '));
    eq(rep.summary.label_in_feed, false, `${label}: label_in_feed`);
  }
});

test('V3-9: a feed that publishes no faults.json is BROKEN even when the roles are given: the fixed label is not in the feed', async () => {
  const { feed } = makeFeed(1);
  const rep = await R.reconcile({ ...feed, run: null }, anchorsFor(feed, 1), chainFor());
  eq(rep.verdict, 'BROKEN', 'no faults.json');
  assert(rep.problems.some((p) => /faults\.json/.test(p) && /fixed label/.test(p)), rep.problems.join('; '));
  eq(rep.summary.label_in_feed, null, 'label_in_feed is null without faults.json');
  eq(rep.summary.signatures.normal, 1, 'the signatures are still checked');
});

test('V3-9: check() reads Horizon first (the account, then every anchor with its signatures), then the feed with faults.json, and nothing else', async () => {
  const { dir, feed } = makeFeed(2);
  const timeline = [];
  const host = await serveDir(dir, (u) => timeline.push('feed ' + u));
  const anchors = anchorsFor(feed, 2);
  try {
    for (const embedSignatures of [true, false]) {
      timeline.length = 0;
      const hz = await FH.serveHorizon({ account: ACCOUNT, record: () => honestRecord(), anchors: () => anchors, embedSignatures, onRequest: (u) => timeline.push('horizon ' + u) });
      try {
        assert(typeof R.check === 'function', 'R.check is exported');
        const res = await R.check({ feed: host.url, horizon: hz.url, account: ACCOUNT });
        const report = res.report;
        eq(report.verdict, 'RECONCILED', report.problems.join('; '));
        eq(report.summary.signatures.normal, 2, 'signatures read and classified');
        eq(report.summary.label_in_feed, true, 'faults.json read and carries the label');
        eq(report.summary.roles_source, 'faults.json', 'roles from the published faults.json');
        eq(res.anchors.length, 2, 'the anchors are returned');
        eq(res.account.id, ACCOUNT, 'the account record is returned');
        eq(res.feed.run.label, LABEL, 'the feed is returned with its faults.json');
        assert(hz.requests.includes(`/accounts/${ACCOUNT}`), `account read: ${hz.requests.join(' ')}`);
        assert(hz.requests.some((u) => u.startsWith(`/accounts/${ACCOUNT}/operations`) && /join=transactions/.test(u)), 'operations joined with transactions');
        const other = hz.requests.filter((u) => !u.startsWith(`/accounts/${ACCOUNT}`) && !u.startsWith('/transactions/'));
        eq(other.length, 0, `no other Horizon request: ${other.join(' ')}`);
        if (!embedSignatures) assert(hz.requests.some((u) => u.startsWith('/transactions/')), 'falls back to /transactions/<hash> when the join carries no signatures');
        /* Horizon first: an anchor newer than the feed copy can then only mean a batch anchored before it was published (freeze v3 V3-7c) */
        eq(timeline[0], `horizon /accounts/${ACCOUNT}`, 'the account is read first');
        assert(String(timeline[1]).startsWith(`horizon /accounts/${ACCOUNT}/operations`), `then the anchors: ${timeline.join(' | ')}`);
        const firstFeed = timeline.findIndex((x) => x.startsWith('feed '));
        const lastHorizon = timeline.map((x) => x.startsWith('horizon ')).lastIndexOf(true);
        assert(firstFeed > lastHorizon && lastHorizon >= 0, `every Horizon read precedes the first feed read: ${timeline.join(' | ')}`);
        assert(timeline.includes('feed /faults.json'), `faults.json read: ${timeline.join(' | ')}`);
      } finally { await hz.close(); }
    }
    /* a Horizon that does not know the account fails the check: no verdict, never BROKEN */
    const missing = await FH.serveHorizon({ account: OUTSIDER.G, record: () => null, anchors: () => [] });
    try {
      let err = null;
      try { await R.check({ feed: host.url, horizon: missing.url, account: ACCOUNT }); } catch (e) { err = e; }
      assert(err && new RegExp(`account ${ACCOUNT} not found on Horizon`).test(err.message), `rejects without a verdict: ${err && err.message}`);
    } finally { await missing.close(); }
    /* the account resource unreadable while its operations are still served (a merged account): still no verdict */
    const noAccount = await FH.serveHorizon({ account: ACCOUNT, record: () => null, anchors: () => anchors });
    try {
      let err = null, res = null;
      try { res = await R.check({ feed: host.url, horizon: noAccount.url, account: ACCOUNT }); } catch (e) { err = e; }
      eq(res, null, 'no report when only the account read fails');
      assert(err && /not found on Horizon/.test(err.message), `rejects without a verdict: ${err && err.message}`);
    } finally { await noAccount.close(); }
  } finally { await host.close(); }   // every server closes even when an assertion fails, or the run never exits
});

test('V3-9: reconcile-cli prints the fixed label, the account as read and the signature counts, exits 1 on BROKEN, and refuses one or two of the three role flags', async () => {
  const { dir, feed } = makeFeed(2);
  const anchors = anchorsFor(feed, 2);
  anchors[1] = resign(anchors[1], ['proposer', 'third']);
  const host = await serveDir(dir);
  const hz = await FH.serveHorizon({ account: ACCOUNT, record: () => honestRecord(), anchors: () => anchors });
  try {
    const base = ['--feed', host.url, '--account', ACCOUNT, '--horizon', hz.url];
    const ok = await runCli([...base, '--proposer', ROLES.proposer, '--verifier', ROLES.verifier, '--third', ROLES.third]);
    assert(ok.stdout.includes(LABEL), `the fixed label: ${ok.stdout}`);
    assert(/^RECONCILED/m.test(ok.stdout), ok.stdout);
    assert(ok.stdout.includes(`account ${ACCOUNT} · thresholds 2/2/3 · master weight 0 · 3 signer(s) ✓`), `the account as read: ${ok.stdout}`);
    assert(ok.stdout.includes('signatures: 1 proposer+verifier · 1 stand-in (proposer+third) · 0 other · roles given on the command line'), `signature counts: ${ok.stdout}`);
    eq(ok.code, 0, `exit code (${ok.stderr})`);
    const fromFile = await runCli(base);
    eq(fromFile.code, 0, `no role flags: roles from faults.json (${fromFile.stderr})`);
    assert(fromFile.stdout.includes("roles from the run's faults.json"), fromFile.stdout);
    const one = await runCli([...base, '--proposer', ROLES.proposer]);
    eq(one.code, 2, `one role flag alone: ${one.stdout}${one.stderr}`);
    assert(/--proposer, --verifier and --third together/.test(one.stderr), one.stderr);
    eq((await runCli([...base, '--proposer', ROLES.proposer, '--verifier', ROLES.verifier])).code, 2, 'two role flags');
    anchors[1] = resign(anchors[1], ['verifier', 'third']);
    const broken = await runCli(base);
    eq(broken.code, 1, `BROKEN exits 1: ${broken.stdout}`);
    assert(/^BROKEN/m.test(broken.stdout) && /signed by verifier\+third/.test(broken.stdout), broken.stdout);
  } finally { await hz.close(); await host.close(); }
});

test('V3-9: a runtime without WebCrypto Ed25519 fails closed: check() rejects with no verdict, and reconcile-cli exits non-zero and prints none', async () => {
  /* fresh keys: no Ed25519 key of this run has been imported yet, so verification must reach importKey */
  const k = { proposer: FH.throwawayKey(), verifier: FH.throwawayKey(), third: FH.throwawayKey() };
  const roles = { proposer: k.proposer.G, verifier: k.verifier.G, third: k.third.G };
  const account = FH.throwawayKey().G;
  const { dir, feed } = makeFeed(1);
  fs.writeFileSync(path.join(dir, 'faults.json'), JSON.stringify(runFile({ anchoring: { network: 'testnet', signers: roles } })));
  const anchors = anchorsFor(feed, 1).map((a) => ({ ...a, signatures: [k.proposer.sign(a.tx_hash), k.verifier.sign(a.tx_hash)] }));
  const host = await serveDir(dir);
  const hz = await FH.serveHorizon({ account, record: () => FH.accountRecord({ account, signers: [roles.proposer, roles.verifier, roles.third] }), anchors: () => anchors });
  /* what a browser without Ed25519 does: importKey rejects with NotSupportedError */
  const noEd25519 = async () => { const e = new Error('Unrecognized algorithm name'); e.name = 'NotSupportedError'; throw e; };
  const stub = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-rc-noed25519-')), 'no-ed25519.js');
  fs.writeFileSync(stub, `globalThis.crypto.subtle.importKey = ${noEd25519.toString()};\n`);
  const subtle = globalThis.crypto.subtle;
  try {
    let err = null, res = null;
    subtle.importKey = noEd25519;   // an own property over SubtleCrypto.prototype.importKey, deleted below
    try { res = await R.check({ feed: host.url, horizon: hz.url, account }); } catch (e) { err = e; } finally { delete subtle.importKey; }
    eq(res, null, 'no report');
    assert(err && /cannot verify Ed25519 signatures \(WebCrypto\)/.test(err.message), `the reason is stated: ${err && err.message}`);
    const cli = await runCli(['--feed', host.url, '--account', account, '--horizon', hz.url], ['--require', stub]);
    assert(cli.code !== 0, `reconcile-cli exits non-zero: ${cli.code} ${cli.stdout}`);
    assert(/cannot verify Ed25519/.test(cli.stderr), `stderr names the reason: ${cli.stderr}`);
    assert(!/RECONCILED|PENDING|BROKEN/.test(cli.stdout), `no verdict printed: ${cli.stdout}`);
    /* with Ed25519 back, the same feed and account reconcile: the refusal above was the missing algorithm */
    eq((await R.check({ feed: host.url, horizon: hz.url, account })).report.verdict, 'RECONCILED', 'Ed25519 restored');
  } finally { delete subtle.importKey; await hz.close(); await host.close(); }
});

(async () => {
  console.log('\nreconcile');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;   // not process.exit(): fetch keep-alive sockets must close first (libuv assert on Windows)
})();
