/**
 * QWATT ops — write-up generator tests (offline: fetch is stubbed, nothing leaves the process)
 * Run: node ops/writeup.test.js
 *
 * The write-up states what the anchoring account's signature rules are. That
 * statement must come from the account as Horizon reports it, never from a
 * constant: these tests serve a stubbed account at 2/2/3 and at 1/2/3.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('./writeup');

/* the real fetch, kept before any test stubs it: the "Signed by" test talks to servers on 127.0.0.1 */
const realFetch = globalThis.fetch;
const LABEL = 'Simulated input · assurance A0 · Stellar testnet';

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const HORIZON = 'https://horizon.example.test';
const FEED = 'https://feed.example.test';
/* placeholder public keys: the generator only prints them */
const ACCOUNT = 'G' + 'A'.repeat(55);
const PROPOSER = 'G' + 'P'.repeat(55), VERIFIER = 'G' + 'V'.repeat(55), THIRD = 'G' + 'T'.repeat(55);

/** A Horizon account response as GET /accounts/<id> returns it (only the fields the write-up reads). */
function accountResponse({ low, med, high, master = 0, signers = [PROPOSER, VERIFIER, THIRD], types = {}, weights = {} }) {
  return {
    id: ACCOUNT, account_id: ACCOUNT,
    thresholds: { low_threshold: low, med_threshold: med, high_threshold: high },
    signers: [...signers.map((key) => ({ key, weight: weights[key] ?? 1, type: types[key] || 'ed25519_public_key' })), { key: ACCOUNT, weight: master, type: 'ed25519_public_key' }],
  };
}

/** Replace global fetch: an empty feed, no anchoring operations, and the given account (a 404 when it is null). Returns the URLs requested. */
function stubFetch(account) {
  const seen = [];
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (u.startsWith(FEED)) return reply(404, 'not found');
    if (u.startsWith(`${HORIZON}/accounts/${ACCOUNT}/operations`)) return reply(200, { _embedded: { records: [] }, _links: {} });
    if (u.split('?')[0] === `${HORIZON}/accounts/${ACCOUNT}`) return account ? reply(200, account) : reply(404, 'not found');
    return reply(404, 'not found');
  };
  return seen;
}

function opts(extra) {
  return { feed: FEED, account: ACCOUNT, horizon: HORIZON, feedDir: null, tests: null, title: 'test write-up', reconcileBase: 'https://example.test/reconcile.html', ...extra };
}
const accountLine = (md) => md.split('\n').filter((l) => l.includes('Anchoring account') || /2\/2\/3/.test(l)).join('\n');

test('an account at 2/2/3, master weight 0 and three signers of weight 1: the write-up prints the values loaded from Horizon and says no single key can send any transaction for it', async () => {
  const seen = stubFetch(accountResponse({ low: 2, med: 2, high: 3 }));
  const { markdown } = await build(opts());
  assert(seen.some((u) => u.split('?')[0] === `${HORIZON}/accounts/${ACCOUNT}`), `the account is loaded from Horizon: ${JSON.stringify(seen)}`);
  const line = accountLine(markdown);
  assert(line.includes('thresholds 2/2/3'), `loaded thresholds printed: ${line}`);
  assert(line.includes('master weight 0'), `master weight printed: ${line}`);
  for (const k of [PROPOSER, VERIFIER, THIRD]) assert(line.includes(k), `signer ${k.slice(0, 2)}… printed: ${line}`);
  assert(/No single key can send any transaction for it/.test(line), `the claim is made: ${line}`);
  assert(!line.includes('do not match'), `no mismatch line: ${line}`);
});

test('an account at 1/2/3 (or at 2/2/3 with master weight 1, two signers, or a signer of weight 2): the write-up prints the real values, says they do not match 2/2/3, and does not claim that no single key can send a transaction', async () => {
  for (const [what, acct, label] of [
    ['1/2/3', accountResponse({ low: 1, med: 2, high: 3 }), 'thresholds 1/2/3'],
    ['master weight 1', accountResponse({ low: 2, med: 2, high: 3, master: 1 }), 'master weight 1'],
    ['two signers', accountResponse({ low: 2, med: 2, high: 3, signers: [PROPOSER, VERIFIER] }), 'thresholds 2/2/3'],
    ['a third signer of weight 2', accountResponse({ low: 2, med: 2, high: 3, weights: { [THIRD]: 2 } }), `\`${THIRD}\` weight 2`],
  ]) {
    stubFetch(acct);
    const md = (await build(opts())).markdown;
    const line = accountLine(md);
    assert(line.includes(label), `${what}: real values printed (${label}): ${line}`);
    assert(line.includes('- ✗ These values do not match 2/2/3'), `${what}: mismatch stated, marked ✗: ${line}`);
    assert(!/no single key can send any transaction/i.test(line), `${what}: no claim: ${line}`);
    const res = resultSection(md).join('\n');
    assert(res.includes('The account does not match 2/2/3 as loaded from Horizon (below), so no multisig claim is made.'), `${what}: the result line makes no multisig claim: ${res}`);
  }
});

test('tests A–D table: a refusal with no operation codes (tx_bad_auth under 2/2/3) prints no " / ops" part; one with operation codes still prints them', async () => {
  stubFetch(accountResponse({ low: 2, med: 2, high: 3 }));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-writeup-')), 'abcd.json');
  fs.writeFileSync(file, JSON.stringify({
    network: 'testnet', public_keys: { account: ACCOUNT },
    steps: {
      A_proposer_alone: { ok: false, refused: true, codes: { transaction: 'tx_bad_auth' } },
      B_verifier_alone: { ok: false, refused: false, codes: { transaction: 'tx_failed', operations: ['op_bad_auth', 'op_success'] } },
    },
  }));
  const md = (await build(opts({ tests: file }))).markdown;
  const row = (t) => md.split('\n').find((l) => l.startsWith(`| ${t} |`)) || '';
  assert(row('A').includes('`tx_bad_auth`'), `A shows its code: ${row('A')}`);
  assert(!row('A').includes('/ ops'), `A has no operations part: ${row('A')}`);
  assert(row('B').includes('`tx_failed` / ops `op_bad_auth, op_success`'), `B keeps its operation codes: ${row('B')}`);
});

test('V3-9: the write-up reads Horizon first (the account, then every anchor), then the feed, as the reconciliation does: an anchor newer than the feed copy cannot read as BROKEN', async () => {
  const seen = stubFetch(accountResponse({ low: 2, med: 2, high: 3 }));
  await build(opts());
  const firstFeed = seen.findIndex((u) => u.startsWith(FEED));
  const lastHorizon = seen.map((u) => u.startsWith(HORIZON)).lastIndexOf(true);
  assert(lastHorizon >= 0 && firstFeed > lastHorizon, `every Horizon read precedes the first feed read: ${JSON.stringify(seen)}`);
});

test('V3-9: an account Horizon cannot return is printed as unreadable and makes the verdict BROKEN; the write-up is still written, and its result line says the account could not be read (not that it does not match)', async () => {
  stubFetch(null);
  const { markdown, report } = await build(opts());
  assert(/could not be loaded from Horizon/.test(markdown), markdown);
  assert(report.verdict === 'BROKEN' && report.problems.some((p) => /could not be read from Horizon/.test(p)), `verdict ${report.verdict}: ${report.problems.join('; ')}`);
  const res = resultSection(markdown).join('\n');
  assert(res.includes('The account could not be read from Horizon (below), so no multisig claim is made.'), `the result line: ${res}`);
  assert(!/does not match/.test(res), `an unreadable account is not called a mismatch: ${res}`);
});

test('V3-9: a preauth_tx or sha256_hash signer (which lets a transaction through without any key): the write-up prints its type, says the values do not match 2/2/3, and does not claim that no single key can send a transaction', async () => {
  for (const type of ['preauth_tx', 'sha256_hash']) {
    stubFetch(accountResponse({ low: 2, med: 2, high: 3, types: { [THIRD]: type } }));
    const { markdown, report } = await build(opts());
    const line = accountLine(markdown);
    assert(!/no single key can send any transaction/i.test(line), `${type}: no claim next to a BROKEN account: ${line}`);
    assert(line.includes('do not match 2/2/3'), `${type}: mismatch stated: ${line}`);
    assert(line.includes(type), `${type}: the signer type is printed: ${line}`);
    assert(report.verdict === 'BROKEN' && report.problems.some((p) => p.includes(type)), `${type}: the reconciliation agrees: ${report.problems.join('; ')}`);
  }
});

test('V3-9: roles given to the write-up (--proposer/--verifier/--third) reach the reconciliation', async () => {
  const FHH = require('../anchor/fake-horizon-http');   // zero dependencies: valid G… keys, in memory
  const roles = { proposer: FHH.throwawayKey().G, verifier: FHH.throwawayKey().G, third: FHH.throwawayKey().G };
  stubFetch(accountResponse({ low: 2, med: 2, high: 3 }));
  const { report } = await build(opts({ roles }));
  assert(report.summary.roles_source === 'given', `roles source: ${report.summary.roles_source}`);
  assert(JSON.stringify(report.summary.roles) === JSON.stringify(roles), `the roles as given: ${JSON.stringify(report.summary.roles)}`);
});

test('V3-7c: a feed in a GitHub repository is read at one commit resolved after Horizon, every file at that commit, and the write-up names it', async () => {
  const SHA = 'c0ffee'.repeat(6) + 'beef';                       // the head commit the stubbed info/refs advertises
  const GH_FEED = 'https://raw.githubusercontent.com/acme/qwatt-evidence/main/run';
  const seen = [];
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => body });
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (u === 'https://github.com/acme/qwatt-evidence.git/info/refs?service=git-upload-pack') {
      return reply(200, `001e# service=git-upload-pack\n0000015b${SHA} HEAD\0multi_ack symref=HEAD:refs/heads/main\n003f${SHA} refs/heads/main\n0000`);
    }
    if (u.startsWith('https://raw.githubusercontent.com/')) return reply(404, '404: Not Found');
    if (u.startsWith(`${HORIZON}/accounts/${ACCOUNT}/operations`)) return reply(200, { _embedded: { records: [] }, _links: {} });
    if (u.split('?')[0] === `${HORIZON}/accounts/${ACCOUNT}`) return reply(200, accountResponse({ low: 2, med: 2, high: 3 }));
    return reply(404, 'not found');
  };
  const { markdown } = await build(opts({ feed: GH_FEED }));
  const refs = seen.findIndex((u) => u.includes('/info/refs'));
  const lastHorizon = seen.map((u) => u.startsWith(HORIZON)).lastIndexOf(true);
  assert(refs > lastHorizon && lastHorizon >= 0, `Horizon first, then the head commit: ${JSON.stringify(seen)}`);
  const raw = seen.filter((u) => u.startsWith('https://raw.githubusercontent.com/'));
  assert(raw.length > 0 && raw.every((u) => u.startsWith(`https://raw.githubusercontent.com/acme/qwatt-evidence/${SHA}/run/`)), `every file at the commit: ${JSON.stringify(raw)}`);
  assert(markdown.includes(`evidence read at \`acme/qwatt-evidence@${SHA.slice(0, 7)}\` (commit \`${SHA}\`)`), `the write-up names the commit: ${markdown.split('\n')[2]}`);
  stubFetch(accountResponse({ low: 2, med: 2, high: 3 }));
  assert((await build(opts())).markdown.includes(`evidence read at \`${FEED}\` (not a repository`), 'a feed that is not a repository is named as read');
});

test('tests table has the independence row and points to tests-abcd.js, not rehearse.js', async () => {
  stubFetch(accountResponse({ low: 2, med: 2, high: 3 }));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-writeup-')), 'abcd.json');
  fs.writeFileSync(file, JSON.stringify({
    network: 'testnet', public_keys: { account: ACCOUNT },
    steps: {
      A_proposer_alone: { ok: false, refused: true, codes: { transaction: 'tx_bad_auth' } },
      I_withheld_refused: { ok: true, refused: true, reasons: ['verifier.not_published'], submitted: false },
    },
  }));
  const md = (await build(opts({ tests: file }))).markdown;
  const row = (t) => md.split('\n').find((l) => l.startsWith(`| ${t} |`)) || '';
  assert(row('I').includes('`verifier.not_published`'), `I shows the verifier's code: ${row('I')}`);
  assert(/withheld from the verifier's only input path/.test(row('I')), `I says what was done, not "unpublished": ${row('I')}`);
  assert(!/unpublished/i.test(row('I')), `no "unpublished" wording: ${row('I')}`);
  assert(/Horizon response in the evidence folder/.test(row('A')), `A's evidence column: ${row('A')}`);
  const missing = (await build(opts({ tests: path.join(os.tmpdir(), 'qwatt-no-such-abcd.json') }))).markdown;
  assert(missing.includes('anchor/tests-abcd.js'), 'the hint names anchor/tests-abcd.js');
  assert(!missing.includes('rehearse.js'), 'and not rehearse.js');
});

/* ───────────── V3-9.3: the fixed label, the result line from Horizon, and who signed each anchor ───────────── */

const resultSection = (md) => { const l = md.split('\n'); const i = l.indexOf('## Result'); const j = l.findIndex((x, k) => k > i && x.startsWith('## ')); return l.slice(i, j < 0 ? l.length : j); };

test('V3-9: the write-up carries the fixed label "Simulated input · assurance A0 · Stellar testnet" under the title and next to every energy figure; the week-1 label is gone', async () => {
  stubFetch(accountResponse({ low: 2, med: 2, high: 3 }));
  const md = (await build(opts())).markdown;
  assert(md.split('\n')[0] === '# test write-up', `the title first: ${md.split('\n')[0]}`);
  assert(md.split('\n')[2] === '_' + LABEL + '_', `the label right under the title: ${JSON.stringify(md.split('\n').slice(0, 4))}`);
  const energy = md.split('\n').filter((l) => /kWh|Energy:/.test(l));
  assert(energy.length >= 2, `energy lines found: ${energy.length}`);
  for (const l of energy) assert(l.includes(LABEL), `an energy figure without the label: ${l}`);
  assert(!md.includes('Simulated input · Stellar testnet'), 'the week-1 label is gone');
});

test('V3-9: the result section states two-of-three signing only from what Horizon returned: an account at 1/2/3 gets no "2-of-3" claim', async () => {
  stubFetch(accountResponse({ low: 1, med: 2, high: 3 }));
  const res = resultSection((await build(opts())).markdown);
  assert(!res.some((l) => /2-of-3|2 of 3/.test(l)), `no multisig claim in the result: ${res.join('\n')}`);
  assert(res.some((l) => l.includes('no multisig claim')), `and it says so: ${res.join('\n')}`);
});

/**
 * A served feed of one batch per hour, each anchored on a fake Horizon (throwaway in-memory keys; the
 * placeholder G… keys above are not valid StrKeys), signed by the pair pairs[i]. run: faults.json overrides.
 */
async function signedFeed(pairs, run = {}) {
  globalThis.fetch = realFetch;
  const FHH = require('../anchor/fake-horizon-http');
  const E = require('../protocol/evidence');
  const V = require('../batch/verify');
  const { Pipeline } = require('../batch/pipeline');
  const http = require('http');
  const K = { proposer: FHH.throwawayKey(), verifier: FHH.throwawayKey(), third: FHH.throwawayKey() };
  const account = FHH.throwawayKey().G;
  const roles = { proposer: K.proposer.G, verifier: K.verifier.G, third: K.third.G };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-writeup-feed-'));
  const pipe = new Pipeline({ dir, site_id: 'wu', node_id: 'wu' });
  const T0 = Date.parse('2026-09-20T15:00:00Z'), DT = 300;
  for (let i = 0; i < 12 * pairs.length; i++) {
    const t = T0 + i * DT * 1000;
    const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
    const rec = { spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION, site_id: 'wu', node_id: 'wu', seq: i, ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
      meters: { a: m('a', 100), b: m('b', 99) }, source: { adapter: 'simulator', raw_sha256: E.sha256('wu-' + i) } };
    pipe.push(Object.defineProperty(rec, Symbol.for('qwatt.raw_payloads'), { value: [{ n: 1, utf8: 'wu-' + i }], enumerable: false }));
  }
  fs.writeFileSync(path.join(dir, 'faults.json'), JSON.stringify({ description: 'write-up test feed', label: LABEL, anchoring: { network: 'testnet', signers: roles }, faults: [], ...run }) + '\n');
  const listed = pipe.feed.readLedger('batches');
  if (listed.length !== pairs.length) throw new Error(`setup: expected ${pairs.length} batches, got ${listed.length}`);
  const anchors = listed.map((e, i) => {
    const tx_hash = E.sha256('wu-tx' + i);
    return { tx_hash, ledger: 2000 + i, created_at: new Date(T0 + (i + 1) * 3600e3).toISOString(), memo: `QW#${e.seq}`, sha256: e.sha256, cumulative_mwh: pipe.feed.readBatch(e.batch_id).cumulative_mwh, signatures: pairs[i].map((r) => K[r].sign(tx_hash)) };
  });
  const srv = http.createServer((req, res) => {
    const f = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const feed = `http://127.0.0.1:${srv.address().port}`;
  const hz = await FHH.serveHorizon({ account, record: () => FHH.accountRecord({ account, signers: [roles.proposer, roles.verifier, roles.third] }), anchors: () => anchors });
  return {
    listed, build: () => build(opts({ feed, horizon: hz.url, account })),
    close: async () => { await hz.close(); await new Promise((r) => { srv.closeAllConnections(); srv.close(() => r()); }); },
  };
}

test('V3-9: every anchoring-transaction row says who signed it, from the signatures: proposer + verifier, proposer + third signer (stand-in), or ✗ with any other pair (verifier + third), which the result line counts as another pair', async () => {
  const PV = ['proposer', 'verifier'];
  const w = await signedFeed([PV, PV, ['proposer', 'third'], ['verifier', 'third']]);
  try {
    const { markdown, report } = await w.build();
    if (report.verdict !== 'BROKEN' || report.problems.length !== 1 || !report.problems[0].includes(w.listed[3].batch_id)) throw new Error(`setup: ${report.verdict} ${report.problems.join('; ')}`);
    const lines = markdown.split('\n');
    const header = lines.find((l) => l.startsWith('| Seq |')) || '';
    assert(header.endsWith('| Signed by |'), `the table's last column is "Signed by": ${header}`);
    const row = (seq) => lines.find((l) => l.startsWith(`| ${seq} |`)) || '';
    const signedBy = (seq) => { const c = row(seq).split('|').map((x) => x.trim()).filter(Boolean); return c[c.length - 1] || ''; };
    eq(signedBy(0), 'proposer + verifier', 'row 0');
    eq(signedBy(1), 'proposer + verifier', 'row 1');
    eq(signedBy(2), 'proposer + third signer (stand-in)', 'row 2');
    assert(signedBy(3).startsWith('✗ ') && /verifier/.test(signedBy(3)) && /third/.test(signedBy(3)) && !/proposer/.test(signedBy(3)), `row 3 is ✗ with its pair: ${row(3)}`);
    const res = resultSection(markdown).join('\n');
    assert(res.includes('1 proposer + third signer (stand-in)'), `the result counts the stand-in: ${res}`);
    assert(res.includes('2 proposer + verifier'), `and the normal anchors: ${res}`);
    assert(res.includes('1 with another pair (see problems)'), `and the anchor with another pair: ${res}`);
    assert(res.includes(`Stand-in anchors (third signer in place of the verifier): \`${w.listed[2].batch_id}\``), `and names the stand-in batch: ${res}`);
    assert(/each with two of the account's three signer keys as read from Horizon/.test(res), `the multisig statement comes from Horizon: ${res}`);
    assert(res.includes('**Reconciliation problems:**') && res.includes(w.listed[3].batch_id), `the problem is listed: ${res}`);
    assert(/its two signatures verify against the signer keys in the run's `faults\.json`/.test(markdown), 'step 3 says how to check the signatures');
  } finally { await w.close(); }
});

test('V3-9.3: with no signer roles (a faults.json that declares none, none given), the result line keeps the unchecked count and makes no claim that each anchor carries two of the three signer keys', async () => {
  const PV = ['proposer', 'verifier'];
  const w = await signedFeed([PV, PV], { anchoring: undefined });
  try {
    const { markdown, report } = await w.build();
    eq(report.summary.signatures.unchecked, 2, 'setup: both anchors unchecked');
    const res = resultSection(markdown).join('\n');
    const line = resultSection(markdown).find((l) => /anchored in 2 transactions/.test(l)) || '';
    assert(line.includes('2 unchecked (no signer roles; see problems)'), `the unchecked count: ${line}`);
    assert(!/each with two of the account's three signer keys/.test(line), `no claim the signatures were not checked for: ${line}`);
    assert(/no multisig claim is made/.test(line), `and it says so: ${line}`);
    assert(res.includes('**Reconciliation problems:**'), res);
  } finally { await w.close(); }
});

(async () => {
  console.log('\nops write-up generator');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      ')); }
  }
  globalThis.fetch = realFetch;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
