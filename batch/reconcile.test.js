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
  const rec = {
    spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION,
    site_id: 'rc', node_id: 'rc', seq: i,
    ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
    meters: { a: m('a', 100), b: m('b', bW) },
    source: { adapter: 'simulator', raw_sha256: E.sha256('rc-' + i) },
  };
  return Object.defineProperty(rec, Symbol.for('qwatt.raw_payloads'), { value: [{ n: 1, utf8: 'rc-' + i }], enumerable: false, configurable: true });
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
    assert(ok.stdout.includes(`evidence read at ${host.url}\n`), `where the evidence was read (V3-7c; a feed that is not a repository is read as given): ${ok.stdout}`);
    const asJson = JSON.parse((await runCli([...base, '--json'])).stdout);
    eq(JSON.stringify(asJson.evidence), JSON.stringify({ base: host.url, commit: null }), '--json carries the base and the commit read (V3-7c)');
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

/* ───────────── week 2 (V3-7c): the feed read at one commit of the evidence repository ───────────── */

const { fakeGithub } = require('../anchor/fake-github');
const PF = require('../ops/publish-feed');
const gitOut = (args) => require('child_process').execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** makeFeed's pipeline and faults.json, published hour by hour by the real publisher to a local bare acme/qwatt-evidence behind a fake GitHub. */
async function githubFeed() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-rc-gh-'));
  const bare = path.join(root, 'qwatt-evidence.git');
  gitOut(['init', '--quiet', '--bare', bare]);
  const dir = path.join(root, 'feed');
  const p = new Pipeline({ dir, site_id: 'rc', node_id: 'rc' });
  const run = runFile();
  fs.writeFileSync(path.join(dir, 'faults.json'), JSON.stringify(run, null, 2) + '\n');
  const gh = await fakeGithub({ repos: { 'acme/qwatt-evidence': bare } });
  let n = 0;
  return {
    gh, bare, url: `${gh.rawOrigin}/acme/qwatt-evidence/main/run`,
    pin: { rawOrigin: gh.rawOrigin, gitOrigin: gh.gitOrigin, apiOrigin: gh.apiOrigin },
    add(hours) { for (let k = 0; k < 12 * hours; k++, n++) p.push(n === 17 ? iv(n, 50) : iv(n)); },
    publish: () => PF.publishOnce({ kind: 'evidence', feed: dir, run: 'run', remote: bare, branch: 'main', work: path.join(root, 'work') }),
    head: () => gitOut(['--git-dir', bare, 'rev-parse', 'main']),
    /** the feed as it is on the proposer's disk */
    local() {
      const listed = p.feed.readLedger('batches');
      return { index: p.feed.readIndex(), run, listed, batches: Object.fromEntries(listed.map((e) => [e.batch_id, p.feed.readBatch(e.batch_id)])), rejected: p.feed.readLedger('rejected') };
    },
  };
}

test('V3-7c: fetchFeed reads a GitHub feed at one commit after Horizon, so an anchor newer than the CDN copy is never BROKEN', async () => {
  const g = await githubFeed();
  let hz = null;
  try {
    g.add(1);
    g.publish();
    const primed = await (await fetch(`${g.url}/ledger/batches.jsonl`)).text();   // a reviewer's read: the CDN keeps this copy
    eq(primed.trim().split('\n').length, 1, 'the CDN copy holds batch 0 only');
    g.add(1);
    g.publish();
    const feed = g.local();
    eq(feed.listed.length, 2, 'two batches published');
    const anchors = anchorsFor(feed, 2);                                        // batch 1 is anchored after the CDN copy was made
    const got = await R.fetchFeed(g.url, { rawOrigin: g.gh.rawOrigin, gitOrigin: g.gh.gitOrigin, via: 'refs' });
    const rep = await R.reconcile(got, anchors, chainFor());
    eq(rep.verdict, 'RECONCILED', rep.problems.join('; '));
    eq(got.commit, g.head(), 'read at the head commit of main');
    eq(got.base, `${g.gh.rawOrigin}/acme/qwatt-evidence/${g.head()}/run`, 'every file from the commit path');
    eq(got.listed.length, 2, 'both batches, not the CDN copy');
    eq(got.run && got.run.label, LABEL, "the run's faults.json is read at the same commit");
    /* check(): Horizon first, then the feed pinned through feedOptions */
    const order = [];
    hz = await FH.serveHorizon({ account: ACCOUNT, record: () => honestRecord(), anchors: () => anchors, onRequest: () => order.push('horizon') });
    const mark = g.gh.requests.length;
    const res = await R.check({ feed: g.url, horizon: hz.url, account: ACCOUNT, feedOptions: { rawOrigin: g.gh.rawOrigin, gitOrigin: g.gh.gitOrigin, via: 'refs' } });
    eq(res.report.verdict, 'RECONCILED', res.report.problems.join('; '));
    eq(res.feed.commit, g.head(), 'check() returns the commit it read');
    const after = g.gh.requests.slice(mark).map((r) => r.path);
    assert(/info\/refs/.test(after[0] || ''), `the head commit is resolved first: ${after.join(' | ')}`);
    assert(after.slice(1).every((u) => u.startsWith(`/raw/acme/qwatt-evidence/${g.head()}/run/`)), `then every file at the commit: ${after.join(' | ')}`);
  } finally { if (hz) await hz.close(); await g.gh.close(); }
});

test('V3-7c: in a browser (both scripts loaded as classic <script>s, as reconcile.html loads them, pin first) a GitHub feed is pinned through the commits API and read at that commit', async () => {
  const vm = require('vm');
  const html = fs.readFileSync(path.join(__dirname, '..', 'reconcile.html'), 'utf8');
  const pinAt = html.indexOf('<script src="assets/qwatt-pin.js"></script>'), recAt = html.indexOf('<script src="assets/qwatt-reconcile.js"></script>');
  assert(pinAt >= 0 && recAt > pinAt, 'reconcile.html loads assets/qwatt-pin.js before assets/qwatt-reconcile.js');
  assert(/evidence read at/.test(html), 'the page says which commit it read');
  const SHA = 'feed'.repeat(10);
  const seen = [];
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => body });
  const win = {
    document: {}, URL, TextEncoder, crypto: globalThis.crypto, atob, AbortSignal,
    fetch: async (url, init) => {
      const u = String(url);
      seen.push({ u, accept: init && init.headers && init.headers.Accept });
      if (u === 'https://api.github.com/repos/acme/qwatt-evidence/commits/main') return reply(200, SHA + '\n');
      return reply(404, '404: Not Found');
    },
  };
  win.window = win; win.self = win;
  const ctx = vm.createContext(win);
  for (const f of ['qwatt-pin.js', 'qwatt-reconcile.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8'), ctx, { filename: f });
  assert(win.QWATT_PIN && win.QWATT_RECONCILE, 'both load as classic scripts (window.QWATT_PIN, window.QWATT_RECONCILE)');
  const got = await win.QWATT_RECONCILE.fetchFeed('https://academiaseul.github.io/qwatt-evidence/run'.replace('academiaseul', 'acme'));
  eq(got.commit, SHA, 'the commit from the API');
  eq(seen[0].u, 'https://api.github.com/repos/acme/qwatt-evidence/commits/main', 'a browser asks the commits API first (info/refs has no CORS)');
  eq(seen[0].accept, 'application/vnd.github.sha', 'for the bare sha');
  assert(seen.slice(1).length > 0 && seen.slice(1).every((x) => x.u.startsWith(`https://raw.githubusercontent.com/acme/qwatt-evidence/${SHA}/run/`)), `then every file from raw at the commit, never Pages: ${seen.map((x) => x.u).join(' | ')}`);
});

test('V3-7c: pinBase: a raw branch URL resolves to its head commit, a commit URL and any other host stay as given, a github.io project URL maps to its repository, and the browser path asks the API', async () => {
  const PIN = require('../assets/qwatt-pin.js');
  const g = await githubFeed();
  try {
    g.add(1);
    g.publish();
    const head = g.head();
    const atHead = `${g.gh.rawOrigin}/acme/qwatt-evidence/${head}/run`;
    const viaRefs = await PIN.pinBase(g.url, g.pin);
    eq(viaRefs.commit, head, 'a branch URL resolves to its head commit');
    eq(viaRefs.base, atHead, 'and reads from the commit path');
    assert(g.gh.requests.some((r) => r.path === '/git/acme/qwatt-evidence.git/info/refs?service=git-upload-pack'), 'in Node it asks info/refs by default');
    const n = g.gh.requests.length;
    eq(JSON.stringify(await PIN.pinBase(atHead + '/', g.pin)), JSON.stringify({ base: atHead, commit: head }), 'a URL that names a commit is kept');
    eq(g.gh.requests.length, n, 'and costs no request');
    eq(JSON.stringify(await PIN.pinBase('http://127.0.0.1:1/feed', g.pin)), JSON.stringify({ base: 'http://127.0.0.1:1/feed', commit: null }), 'any other host is read as given');
    eq(JSON.stringify(PIN.parse('https://academiaseul.github.io/qwatt-evidence/run')), JSON.stringify({ owner: 'academiaseul', repo: 'qwatt-evidence', ref: 'main', dir: 'run' }), 'the freeze §7 github.io URL is its repository');
    eq(JSON.stringify(PIN.parse('https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/run')), JSON.stringify({ owner: 'academiaseul', repo: 'qwatt-evidence', ref: 'main', dir: 'run' }), 'the raw URL');
    eq(PIN.parse('https://example.org/qwatt-evidence/run'), null, 'another host is not a repository');
    const pages = await PIN.pinBase('https://acme.github.io/qwatt-evidence/run', g.pin);
    eq(pages.base, atHead, 'a github.io project URL is read from the repository at its head commit, never from Pages');
    const viaApi = await PIN.pinBase(g.url, { ...g.pin, via: 'api' });
    eq(viaApi.commit, head, 'the browser path resolves the same commit');
    const api = g.gh.requests.filter((r) => r.path.startsWith('/api/')).pop();
    eq(api && api.path, '/api/repos/acme/qwatt-evidence/commits/main', 'through the commits API');
    eq(api && api.accept, 'application/vnd.github.sha', 'asking for the bare sha');
    eq(PIN.describe(g.url, head, g.pin), `acme/qwatt-evidence@${head.slice(0, 7)}`, 'described as owner/repo@sha7');
    g.gh.failRefs(429);
    for (const via of ['refs', 'api']) {
      let err = null;
      try { await PIN.pinBase(g.url, { ...g.pin, via }); } catch (e) { err = e; }
      assert(err && /HTTP 429/.test(err.message), `${via}: a 429 rejects: ${err && err.message}`);
    }
    g.gh.failRefs(null);
    let missing = null;
    try { await PIN.pinBase(`${g.gh.rawOrigin}/acme/qwatt-evidence/no-such-branch/run`, g.pin); } catch (e) { missing = e; }
    assert(missing && /no-such-branch/.test(missing.message), `a branch that does not exist rejects: ${missing && missing.message}`);
  } finally { await g.gh.close(); }
});

/* ───────────── week 2 (V3-9.3): the reconciliation page on the site ───────────── */

const PAGE = path.join(__dirname, '..', 'reconcile.html');
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * A minimal DOM for reconcile.html. The page's markup (HTML comments, scripts and styles left out) is parsed
 * into a tree of elements and text, so textContent reads static and script-made text alike, in document
 * order; children holds the elements only, as in a browser. Every element with an id is reachable through
 * getElementById, with its static value and hidden attribute; any other id is null, so a script that uses
 * an id the page lacks throws. innerHTML throws.
 */
function pageDom(html, query) {
  class El {
    constructor(tag) { Object.assign(this, { tagName: String(tag).toUpperCase(), id: '', nodes: [], className: '', attrs: {}, listeners: {}, hidden: false, value: '', disabled: false, title: '' }); }
    get children() { return this.nodes.filter((n) => typeof n !== 'string'); }
    get textContent() { return this.nodes.map((n) => (typeof n === 'string' ? n : n.textContent)).join(''); }
    set textContent(t) { this.nodes = [String(t)]; }
    get innerHTML() { throw new Error('reconcile.html reads innerHTML'); }
    set innerHTML(v) { throw new Error('reconcile.html writes innerHTML: ' + String(v).slice(0, 60)); }
    appendChild(c) { this.nodes.push(c); c.parentNode = this; return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    requestSubmit() { const ev = { preventDefault() {} }; this.submitted = Promise.all((this.listeners.submit || []).map((f) => f.call(this, ev))); }
    /** every descendant element, depth first */
    all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  }
  const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const VOID = new Set(['input', 'br', 'meta', 'link', 'img', 'hr', 'source', 'wbr']);
  const root = new El('#document');
  const stack = [root];
  const byId = {};
  const token = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/([a-z0-9]+)\s*>|<!doctype[^>]*>|<([a-z0-9]+)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/gi;
  for (const m of html.matchAll(token)) {
    if (m[2]) {
      const tag = m[2].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName.toLowerCase() === tag) { stack.length = i; break; }
    } else if (m[3]) {
      const e = new El(m[3]);
      for (const a of (m[4] || '').matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
        const k = a[1].toLowerCase(), v = decode(a[2] ?? a[3] ?? a[4] ?? '');
        e.attrs[k] = v;
        if (k === 'id') { e.id = v; byId[v] = e; }
        if (k === 'class') e.className = v;
        if (k === 'value') e.value = v;
        if (k === 'hidden') e.hidden = true;
      }
      stack[stack.length - 1].appendChild(e);
      if (!VOID.has(m[3].toLowerCase()) && !/\/\s*$/.test(m[4] || '')) stack.push(e);
    } else if (m[5]) stack[stack.length - 1].nodes.push(decode(m[5]));
  }
  const replaced = [];
  const doc = {
    documentElement: byId.__html || new El('html'),
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => new El(tag),
    querySelector: () => new El('meta'),
  };
  return { byId, replaced, doc, location: { search: query ? '?' + query : '' }, history: { replaceState: (s, t, url) => replaced.push(url) } };
}

/** The element with that id in the page DOM; a missing one fails with its name. */
function need(dom, id) { const e = dom.byId[id]; if (!e) throw new Error(`reconcile.html has no #${id}`); return e; }

/**
 * Run reconcile.html's scripts, in page order, in a fresh context with that DOM; resolves once its check has
 * finished. dom.autoRan says whether the page started the check by itself; when it did not, click (the
 * default) presses Reconcile as a reader would. fetch replaces the page's fetch (to route the public
 * hosts to local fakes: the tests never touch the network).
 */
async function runPage(query, { crypto = globalThis.crypto, click = true, fetch: pageFetch = (...a) => fetch(...a) } = {}) {
  const vm = require('vm');
  const html = fs.readFileSync(PAGE, 'utf8');
  const dom = pageDom(html, query);
  const win = {
    document: dom.doc, location: dom.location, history: dom.history,
    localStorage: { getItem: () => null, setItem() {} },
    URL, URLSearchParams, TextEncoder, AbortSignal, atob, crypto, fetch: pageFetch, console,
  };
  win.window = win; win.self = win;
  const ctx = vm.createContext(win);
  for (const m of html.matchAll(/<script(?:\s+src="([^"]+)")?\s*>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(m[1] ? fs.readFileSync(path.join(__dirname, '..', m[1]), 'utf8') : m[2], ctx, { filename: m[1] || 'reconcile.html inline' });
  }
  const form = dom.byId.srcForm;
  dom.autoRan = !!(form && form.submitted);
  if (form && !form.submitted && click) form.requestSubmit();
  if (form && form.submitted) await form.submitted;
  return dom;
}

/** Press Reconcile on a page already loaded: returns the progress text while the check runs, then waits for it. */
async function clickReconcile(dom) {
  const form = need(dom, 'srcForm');
  form.requestSubmit();
  const during = need(dom, 'progress').textContent;
  await form.submitted;
  return during;
}

/** A fetch for the page that sends the public testnet Horizon to a local fake, answers api.github.com itself when api is given, and passes everything else on. */
const routed = (hzUrl, api) => async (url, init) => {
  const u = String(url);
  if (api && u.startsWith('https://api.github.com/')) return api(u);
  return fetch(u.startsWith(DEFAULT_HORIZON) ? hzUrl + u.slice(DEFAULT_HORIZON.length) : u, init);
};
const DEFAULT_HORIZON = 'https://horizon-testnet.stellar.org';
/** The ✓/✗ mark of a row of #acctRules (label, value, mark), by its label. */
function ruleMark(dom, label) {
  const cells = need(dom, 'acctRules').children;
  const i = cells.findIndex((c) => c.textContent === label);
  if (i < 0) throw new Error(`#acctRules has no row "${label}": ${need(dom, 'acctRules').textContent}`);
  return cells[i + 2];
}
/** The row of #acctSigners for a signer key (its first cell carries the full key in title). */
function signerRow(dom, key) {
  const row = need(dom, 'acctSigners').children.find((tr) => tr.children[0] && tr.children[0].title === key);
  if (!row) throw new Error(`no signer row for ${key.slice(0, 6)}…: ${need(dom, 'acctSigners').textContent}`);
  return row;
}
const lastCell = (tr) => tr.children[tr.children.length - 1];

/**
 * A feed of three batches on 127.0.0.1 and a Horizon whose anchors are signed proposer + verifier, except batch 2
 * (proposer + third, a stand-in). edit(anchors) may change the anchors (e.g. re-sign one with another pair).
 * The Horizon is not the public one, so the page waits for a click (runPage clicks by default).
 */
async function pageWorld({ record = () => honestRecord(), run = runFile(), edit = null } = {}) {
  const { dir, feed } = makeFeed(3);
  fs.writeFileSync(path.join(dir, 'faults.json'), JSON.stringify(run) + '\n');
  const anchors = anchorsFor(feed, 3);
  anchors[2] = resign(anchors[2], ['proposer', 'third']);
  if (edit) edit(anchors);
  const host = await serveDir(dir);
  const hz = await FH.serveHorizon({ account: ACCOUNT, record, anchors: () => anchors });
  const q = (extra = '') => `feed=${encodeURIComponent(host.url)}&account=${ACCOUNT}&horizon=${encodeURIComponent(hz.url)}${extra}`;
  return { feed, host, hz, q, close: async () => { await hz.close(); await host.close(); } };
}

test('V3-9: reconcile.html shows the fixed A0 label, hard-codes no "2 of 3", and runs check()', async () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  const page = stripComments(html);
  assert(html.includes(LABEL), 'the fixed label is on the page');
  assert(!html.includes('Simulated input · Stellar testnet'), 'the week-1 label is gone');
  assert(!/2 of 3|2-of-3/.test(html), 'no hard-coded "2 of 3": the page states what Horizon returned');
  assert(/R\.check\(/.test(page), 'the page runs R.check (feed, account, signatures), outside any comment');
  assert(/params\.get\('proposer'\)/.test(page), 'the page reads ?proposer= (and the other roles) from its address');
  const label = /<p\b[^>]*\bid="inputLabel"[^>]*>([^<]*)<\/p>/.exec(page);
  eq(label && label[1].trim(), LABEL, '#inputLabel, a static element outside any comment, holds the fixed label');
  assert(label.index < page.indexOf('<section'), '#inputLabel sits at the top, before the first section');
  assert((page.match(/Simulated input · assurance A0 · Stellar testnet/g) || []).length >= 3, 'the label at the top, next to the energy figure and in the batches note');
  assert(/<th[^>]*>Signed by<\/th>/.test(page), 'the batches table has a "Signed by" column');
  assert(!/innerHTML/.test(page), 'the page never uses innerHTML');
  assert(/id="acctPanel"/.test(page), 'the account panel exists');
});

test('V3-9: the site serves the reconciliation page again: .vercelignore lists neither reconcile.html nor its scripts', async () => {
  const lines = fs.readFileSync(path.join(__dirname, '..', '.vercelignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const p of ['reconcile.html', 'assets', 'assets/qwatt-reconcile.js', 'assets/qwatt-pin.js', '/reconcile.html', 'assets/*', '*.html']) assert(!lines.includes(p), `.vercelignore still excludes ${p} from the site`);
  assert(lines.includes('assets/vendor'), 'assets/vendor stays excluded');
  const html = fs.readFileSync(PAGE, 'utf8');
  for (const m of html.matchAll(/<script\s+src="([^"]+)"/g)) assert(fs.existsSync(path.join(__dirname, '..', m[1])) && !lines.some((l) => m[1] === l || m[1].startsWith(l.replace(/\/?$/, '/'))), `the page's script ${m[1]} is served`);
});

test('V3-9: the page, run against Horizon and a feed: account panel all ✓ with the sentence built from the values, roles from faults.json, "Signed by" per anchor (proposer + verifier, or a stand-in), tiles and progress from the report', async () => {
  const w = await pageWorld();
  try {
    const dom = await runPage(w.q());
    const $ = (id) => need(dom, id);
    eq($('result').hidden, false, `the result is shown (progress: ${$('progress').textContent})`);
    assert(/^RECONCILED/.test($('verdict').textContent), `verdict: ${$('verdict').textContent}`);
    eq($('tAnc').textContent, '3 / 3', 'anchored / accepted');
    assert($('tAncS').textContent.includes('2 proposer + verifier · 1 stand-in'), `tile sub-line: ${$('tAncS').textContent}`);
    const acct = $('acctPanel').textContent;
    for (const s of ['Anchoring account, as read from Horizon', 'Thresholds (low/medium/high)', '2/2/3', 'Master weight', "Roles from: the run's faults.json",
      'No single key can send any transaction for this account; anchoring needs 2 of the 3 keys; changing signers or thresholds needs all 3.']) assert(acct.includes(s), `account panel has "${s}": ${acct}`);
    assert(!acct.includes('✗'), `nothing fails §3: ${acct}`);
    for (const r of ['proposer', 'verifier', 'third']) assert(acct.includes(ROLES[r].slice(0, 6)) && acct.includes(r), `the ${r} row: ${acct}`);
    const rows = $('rows').children;
    eq(rows.length, 3, 'three batch rows');
    const signed = (i) => rows[i].children[rows[i].children.length - 1];
    eq(signed(0).textContent, 'proposer + verifier', 'batch 0 signed by');
    eq(signed(0).className, 'ok', 'normal is ok');
    const chip = signed(2).all().find((e) => /\bchip\b/.test(e.className));
    assert(chip && /\bc-wait\b/.test(chip.className) && chip.textContent === 'stand-in', `batch 2: a stand-in chip: ${signed(2).textContent}`);
    assert(signed(2).textContent.includes('proposer + third signer'), `batch 2 names the pair: ${signed(2).textContent}`);
    const prog = $('progress').textContent;
    assert(/^Checked 3 batches, the account's signers and thresholds, and the signatures on 3 anchoring transactions at \d\d:\d\d:\d\d UTC/.test(prog), `progress: ${prog}`);
    assert(prog.includes(`evidence read at ${w.host.url}`), `the progress line names what was read (V3-7c): ${prog}`);
    const hzHost = new URL(w.hz.url).host;
    assert(prog.includes(`Horizon ${hzHost}`), `the progress line names the Horizon server read: ${prog}`);
    assert($('acctId').textContent.includes(`as ${hzHost} returned it`), `the account line names the server: ${$('acctId').textContent}`);
    eq($('horizonNote').hidden, false, 'a Horizon other than the public testnet one is named on the result');
    assert($('horizonNote').textContent.includes(`Reading a non-default Horizon: ${hzHost}`), `the notice: ${$('horizonNote').textContent}`);
    for (const r of ['proposer', 'verifier', 'third']) eq(lastCell(signerRow(dom, ROLES[r])).textContent, '✓', `the ${r} row passes §3`);
    eq(ruleMark(dom, 'Thresholds (low/medium/high)').textContent, '✓', 'thresholds ✓');
    eq(ruleMark(dom, 'Master weight').textContent, '✓', 'master weight ✓');
    eq(dom.replaced.length, 1, 'the address is rewritten once');
    assert(!/proposer=|verifier=|third=/.test(dom.replaced[0]), `no role parameters when none were given: ${dom.replaced[0]}`);
  } finally { await w.close(); }
});

test('V3-9: the page against an account at 1/2/3 shows the value read with ✗, says it does not match the frozen setup, makes no "no single key" claim, and the verdict is BROKEN', async () => {
  const w = await pageWorld({ record: () => honestRecord({ thresholds: { low: 1, med: 2, high: 3 } }) });
  try {
    const dom = await runPage(w.q());
    const acct = need(dom, 'acctPanel').textContent;
    assert(/^BROKEN/.test(need(dom, 'verdict').textContent), need(dom, 'verdict').textContent);
    assert(acct.includes('1/2/3') && acct.includes('✗'), `the thresholds as read, failing: ${acct}`);
    const th = ruleMark(dom, 'Thresholds (low/medium/high)');
    eq(th.textContent, '✗', 'the thresholds row fails');
    eq(th.className, 'no', 'shown as a failure');
    eq(ruleMark(dom, 'Master weight').textContent, '✓', 'the master weight (0) still passes');
    assert(acct.includes('This account does not match the frozen setup; see the problems above.'), acct);
    assert(!/no single key/i.test(acct), `no claim: ${acct}`);
  } finally { await w.close(); }
});

test('V3-9: roles given in the address (for a feed whose faults.json declares none) fill the three inputs, are used and written back; the panel says where they came from', async () => {
  const w = await pageWorld({ run: runFile({ anchoring: undefined }) });
  try {
    const roles = `&proposer=${ROLES.proposer}&verifier=${ROLES.verifier}&third=${ROLES.third}`;
    const dom = await runPage(w.q(roles));
    eq(need(dom, 'proposerIn').value, ROLES.proposer, 'proposer input');
    eq(need(dom, 'verifierIn').value, ROLES.verifier, 'verifier input');
    eq(need(dom, 'thirdIn').value, ROLES.third, 'third input');
    assert(/^RECONCILED/.test(need(dom, 'verdict').textContent), `${need(dom, 'verdict').textContent} ${need(dom, 'progress').textContent}`);
    assert(need(dom, 'acctPanel').textContent.includes("Roles from: this page's address"), need(dom, 'acctPanel').textContent);
    const url = dom.replaced[0] || '';
    for (const r of ['proposer', 'verifier', 'third']) assert(url.includes(`${r}=${ROLES[r]}`), `${r} written back: ${url}`);
    /* two of three is not a role set: nothing is written back and nothing is used */
    const two = await runPage(w.q(`&proposer=${ROLES.proposer}&verifier=${ROLES.verifier}`));
    assert(!/proposer=|verifier=/.test(two.replaced[0] || ''), `two roles are not written back: ${two.replaced[0]}`);
    assert(/^BROKEN/.test(need(two, 'verdict').textContent) && /signer roles are not declared/.test(need(two, 'verdict').textContent), `two roles are not used: ${need(two, 'verdict').textContent}`);
  } finally { await w.close(); }
});

test('V3-9: a browser without WebCrypto Ed25519 gets no verdict from the page, only a message that points to reconcile-cli', async () => {
  const w = await pageWorld();
  const real = globalThis.crypto.subtle;
  const noEd25519 = { subtle: {
    digest: (...a) => real.digest(...a),
    verify: (...a) => real.verify(...a),
    importKey: async () => { const e = new Error('Unrecognized algorithm name'); e.name = 'NotSupportedError'; throw e; },
  } };
  try {
    const dom = await runPage(w.q(), { crypto: noEd25519 });
    eq(need(dom, 'result').hidden, true, 'no result is shown');
    eq(need(dom, 'verdict').textContent, '', 'no verdict');
    const prog = need(dom, 'progress').textContent;
    assert(/cannot verify Ed25519/.test(prog) && /reconcile-cli/.test(prog), `the message points to the CLI: ${prog}`);
  } finally { await w.close(); }
});

test('V3-9.3: the account panel fails what breaks §3, row by row: master weight 1 shows ✗ on that row, a signer of weight 2 shows ✗ on that signer\'s row, and the verdict is BROKEN with no "no single key" claim', async () => {
  for (const [what, record, check] of [
    ['master weight 1', () => honestRecord({ master: 1 }), (dom) => {
      const m = ruleMark(dom, 'Master weight');
      eq(m.textContent, '✗', 'the master-weight row fails');
      eq(m.className, 'no', 'shown as a failure');
      eq(ruleMark(dom, 'Thresholds (low/medium/high)').textContent, '✓', 'the thresholds (2/2/3) still pass');
      for (const r of ['proposer', 'verifier', 'third']) eq(lastCell(signerRow(dom, ROLES[r])).textContent, '✓', `the ${r} row still passes`);
    }],
    ['third signer of weight 2', () => honestRecord({ weights: { [ROLES.third]: 2 } }), (dom) => {
      const third = signerRow(dom, ROLES.third);
      eq(third.children[2].textContent, '2', 'the weight as read');
      eq(lastCell(third).textContent, '✗', "the third signer's row fails");
      eq(lastCell(third).children[0].className, 'no', 'shown as a failure');
      for (const r of ['proposer', 'verifier']) eq(lastCell(signerRow(dom, ROLES[r])).textContent, '✓', `the ${r} row still passes`);
      eq(ruleMark(dom, 'Master weight').textContent, '✓', 'the master weight (0) still passes');
    }],
  ]) {
    const w = await pageWorld({ record });
    try {
      const dom = await runPage(w.q());
      assert(/^BROKEN/.test(need(dom, 'verdict').textContent), `${what}: verdict ${need(dom, 'verdict').textContent} (${need(dom, 'progress').textContent})`);
      check(dom);
      const acct = need(dom, 'acctPanel').textContent;
      assert(acct.includes('This account does not match the frozen setup; see the problems above.'), `${what}: ${acct}`);
      assert(!/no single key/i.test(acct), `${what}: no claim: ${acct}`);
    } finally { await w.close(); }
  }
});

test('V3-9.3: an anchor signed by another pair (verifier + third) is shown as ✗ with that pair in "Signed by", counted as other in the tile, and the verdict is BROKEN; the stand-in next to it stays a stand-in', async () => {
  const w = await pageWorld({ edit: (a) => { a[1] = resign(a[1], ['verifier', 'third']); } });
  try {
    const dom = await runPage(w.q());
    assert(/^BROKEN/.test(need(dom, 'verdict').textContent), `verdict: ${need(dom, 'verdict').textContent}`);
    const rows = need(dom, 'rows').children;
    const bad = lastCell(rows[1]);
    eq(bad.className, 'no', 'the pair is shown as a failure');
    assert(bad.textContent.startsWith('✗ ') && /verifier/.test(bad.textContent) && /third/.test(bad.textContent), `it names the pair: ${bad.textContent}`);
    assert(!bad.textContent.includes('proposer'), `not a pair with the proposer: ${bad.textContent}`);
    eq(lastCell(rows[0]).textContent, 'proposer + verifier', 'batch 0 is still normal');
    eq(lastCell(rows[0]).className, 'ok', 'and ok');
    assert(lastCell(rows[2]).textContent.includes('proposer + third signer') && !lastCell(rows[2]).textContent.includes('✗'), `batch 2 is still a stand-in: ${lastCell(rows[2]).textContent}`);
    assert(need(dom, 'tAncS').textContent.includes('1 proposer + verifier · 1 stand-in · 1 other'), `tile sub-line: ${need(dom, 'tAncS').textContent}`);
  } finally { await w.close(); }
});

test('V3-9.3: a link that names a Horizon other than the public testnet one does not run by itself; once the reader presses Reconcile, every result names that server in a visible notice above the verdict, in the account line and in the progress line', async () => {
  const w = await pageWorld();
  try {
    const host = new URL(w.hz.url).host;
    const dom = await runPage(w.q(), { click: false });
    eq(dom.autoRan, false, 'the check does not start by itself');
    eq(w.hz.requests.length, 0, 'nothing is read from that server before the click');
    eq(need(dom, 'result').hidden, true, 'no result yet');
    eq(need(dom, 'horizonIn').value, w.hz.url, 'the server from the link is in the Horizon input');
    eq(need(dom, 'advOpts').open, true, 'the Horizon input is shown, not folded away');
    const waiting = need(dom, 'progress').textContent;
    assert(waiting.includes(host) && /not the public Stellar testnet Horizon/.test(waiting) && /press Reconcile/.test(waiting), `the page says why it waits: ${waiting}`);
    eq(dom.replaced.length, 0, 'the address is not rewritten before the click');

    const during = await clickReconcile(dom);
    eq(during, 'Reading the anchoring account, its signers and every anchoring transaction from Horizon, then downloading the evidence feed at its latest commit…', 'the progress text in the order of the reads');
    assert(w.hz.requests.length > 0, 'the click runs the check');
    assert(/^RECONCILED/.test(need(dom, 'verdict').textContent), need(dom, 'verdict').textContent);
    const note = need(dom, 'horizonNote');
    eq(note.hidden, false, 'the notice is shown');
    assert(note.textContent.startsWith(`Reading a non-default Horizon: ${host}.`), `the notice names the server: ${note.textContent}`);
    assert(/only as trustworthy as that server/.test(note.textContent) && note.textContent.includes('horizon-testnet.stellar.org'), `and says what that means: ${note.textContent}`);
    const inResult = need(dom, 'result').all();
    assert(inResult.indexOf(note) >= 0 && inResult.indexOf(note) < inResult.indexOf(need(dom, 'verdict')), 'the notice is part of the result, above the verdict');
    assert(need(dom, 'acctId').textContent.includes(`as ${host} returned it`), need(dom, 'acctId').textContent);
    assert(need(dom, 'progress').textContent.includes(`Horizon ${host}`), need(dom, 'progress').textContent);
    assert(dom.replaced[0].includes('horizon=' + encodeURIComponent(w.hz.url)), `the server stays in the address: ${dom.replaced[0]}`);
    await clickReconcile(dom);
    eq(note.hidden, false, 'a second check names it again');
  } finally { await w.close(); }
});

test('V3-9.3: a look-alike of the public testnet Horizon (another host that starts with its name, or its name as user info before another host) is a non-default server: the link does not run by itself, and the waiting line and the notice name the host the page really reads', async () => {
  for (const lookalike of [`${DEFAULT_HORIZON}.evil.example`, `${DEFAULT_HORIZON}@evil.example`]) {
    const w = await pageWorld();
    try {
      const host = new URL(lookalike).host;                   // horizon-testnet.stellar.org.evil.example, evil.example
      const reads = [];
      /* the look-alike is served by the local fake Horizon; the public Horizon and anything else off 127.0.0.1 is never read */
      const pageFetch = async (url, init) => {
        const u = String(url);
        if (u.startsWith(lookalike + '/')) { reads.push(u); return fetch(w.hz.url + u.slice(lookalike.length), init); }
        if (!u.startsWith('http://127.0.0.1:')) throw new Error(`no network in tests: ${u}`);
        return fetch(u, init);
      };
      const dom = await runPage(`feed=${encodeURIComponent(w.host.url)}&account=${ACCOUNT}&horizon=${encodeURIComponent(lookalike)}`, { click: false, fetch: pageFetch });
      eq(dom.autoRan, false, `${lookalike}: the check does not start by itself`);
      eq(reads.length + w.hz.requests.length, 0, `${lookalike}: nothing is read before the click`);
      eq(need(dom, 'result').hidden, true, `${lookalike}: no result yet`);
      eq(need(dom, 'advOpts').open, true, `${lookalike}: the Horizon input is shown, not folded away`);
      const waiting = need(dom, 'progress').textContent;
      assert(/not the public Stellar testnet Horizon/.test(waiting) && waiting.includes(`Horizon: ${host}.`) && /press Reconcile/.test(waiting), `${lookalike}: the page says why it waits and names the host it would read: ${waiting}`);
      await clickReconcile(dom);
      assert(reads.length > 0, `${lookalike}: the click reads the server the link names`);
      const note = need(dom, 'horizonNote');
      eq(note.hidden, false, `${lookalike}: the notice is shown`);
      assert(note.textContent.startsWith(`Reading a non-default Horizon: ${host}.`), `${lookalike}: the notice names the host read: ${note.textContent}`);
      assert(need(dom, 'acctId').textContent.includes(`as ${host} returned it`), `${lookalike}: ${need(dom, 'acctId').textContent}`);
      assert(!need(dom, 'acctId').textContent.includes('as horizon-testnet.stellar.org returned it'), `${lookalike}: never passed off as the public Horizon: ${need(dom, 'acctId').textContent}`);
      assert(dom.replaced[0].includes('horizon=' + encodeURIComponent(lookalike)), `${lookalike}: the server stays in the address: ${dom.replaced[0]}`);
    } finally { await w.close(); }
  }
});

test('V3-9.3: with no ?horizon= (or the public testnet Horizon named exactly) the page runs by itself against horizon-testnet.stellar.org and shows no notice', async () => {
  const w = await pageWorld();
  try {
    const base = `feed=${encodeURIComponent(w.host.url)}&account=${ACCOUNT}`;
    for (const query of [base, `${base}&horizon=${encodeURIComponent(DEFAULT_HORIZON)}`, `${base}&horizon=${encodeURIComponent(DEFAULT_HORIZON + '/')}`]) {
      const dom = await runPage(query, { click: false, fetch: routed(w.hz.url) });
      eq(dom.autoRan, true, `it runs by itself (${query})`);
      assert(/^RECONCILED/.test(need(dom, 'verdict').textContent), `${need(dom, 'verdict').textContent} ${need(dom, 'progress').textContent}`);
      eq(need(dom, 'horizonNote').hidden, true, 'no notice for the public testnet Horizon');
      eq(need(dom, 'horizonNote').textContent, '', 'and no text');
      assert(need(dom, 'acctId').textContent.includes('as horizon-testnet.stellar.org returned it'), need(dom, 'acctId').textContent);
      assert(need(dom, 'progress').textContent.includes('Horizon horizon-testnet.stellar.org'), need(dom, 'progress').textContent);
      assert(!/horizon=/.test(dom.replaced[0]), `the default is not written into the address: ${dom.replaced[0]}`);
    }
  } finally { await w.close(); }
});

test('V3-9.3: when api.github.com refuses the commit lookup (HTTP 403 or 429), the page says it is GitHub\'s anonymous rate limit and when to retry, not that the feed URL is wrong', async () => {
  const w = await pageWorld();
  try {
    const feed = 'https://raw.githubusercontent.com/acme/qwatt-evidence/main/run';
    const query = `feed=${encodeURIComponent(feed)}&account=${ACCOUNT}`;
    for (const status of [403, 429]) {
      const dom = await runPage(query, { fetch: routed(w.hz.url, async () => new Response('rate limit exceeded', { status })) });
      const prog = need(dom, 'progress').textContent;
      eq(need(dom, 'result').hidden, true, `${status}: no result`);
      assert(prog.includes("GitHub's anonymous API limit") && /60 requests an hour/.test(prog), `${status}: names the limit: ${prog}`);
      assert(/try again/i.test(prog) && /within the hour|in an hour/.test(prog), `${status}: says when to retry: ${prog}`);
      assert(/reconcile-cli/.test(prog), `${status}: points to the CLI: ${prog}`);
      assert(!/Confirm the feed URL/.test(prog), `${status}: does not blame the feed URL: ${prog}`);
    }
    /* any other failure keeps the general message */
    const other = await runPage(query, { fetch: routed(w.hz.url, async () => new Response('boom', { status: 500 })) });
    assert(/Confirm the feed URL/.test(need(other, 'progress').textContent) && !/anonymous API limit/.test(need(other, 'progress').textContent), need(other, 'progress').textContent);
  } finally { await w.close(); }
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
