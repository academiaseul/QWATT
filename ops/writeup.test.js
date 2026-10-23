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

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const HORIZON = 'https://horizon.example.test';
const FEED = 'https://feed.example.test';
/* placeholder public keys: the generator only prints them */
const ACCOUNT = 'G' + 'A'.repeat(55);
const PROPOSER = 'G' + 'P'.repeat(55), VERIFIER = 'G' + 'V'.repeat(55), THIRD = 'G' + 'T'.repeat(55);

/** A Horizon account response as GET /accounts/<id> returns it (only the fields the write-up reads). */
function accountResponse({ low, med, high, master = 0, signers = [PROPOSER, VERIFIER, THIRD], types = {} }) {
  return {
    id: ACCOUNT, account_id: ACCOUNT,
    thresholds: { low_threshold: low, med_threshold: med, high_threshold: high },
    signers: [...signers.map((key) => ({ key, weight: 1, type: types[key] || 'ed25519_public_key' })), { key: ACCOUNT, weight: master, type: 'ed25519_public_key' }],
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

test('an account at 1/2/3 (or at 2/2/3 with master weight 1): the write-up prints the real values, says they do not match 2/2/3, and does not claim that no single key can send a transaction', async () => {
  for (const [what, acct, label] of [
    ['1/2/3', accountResponse({ low: 1, med: 2, high: 3 }), 'thresholds 1/2/3'],
    ['master weight 1', accountResponse({ low: 2, med: 2, high: 3, master: 1 }), 'master weight 1'],
    ['two signers', accountResponse({ low: 2, med: 2, high: 3, signers: [PROPOSER, VERIFIER] }), 'thresholds 2/2/3'],
  ]) {
    stubFetch(acct);
    const line = accountLine((await build(opts())).markdown);
    assert(line.includes(label), `${what}: real values printed (${label}): ${line}`);
    assert(line.includes('do not match 2/2/3'), `${what}: mismatch stated: ${line}`);
    assert(!/no single key can send any transaction/i.test(line), `${what}: no claim: ${line}`);
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

test('V3-9: an account Horizon cannot return is printed as unreadable and makes the verdict BROKEN; the write-up is still written', async () => {
  stubFetch(null);
  const { markdown, report } = await build(opts());
  assert(/could not be loaded from Horizon/.test(markdown), markdown);
  assert(report.verdict === 'BROKEN' && report.problems.some((p) => /could not be read from Horizon/.test(p)), `verdict ${report.verdict}: ${report.problems.join('; ')}`);
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

(async () => {
  console.log('\nops write-up generator');
  const realFetch = globalThis.fetch;
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      ')); }
  }
  globalThis.fetch = realFetch;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
