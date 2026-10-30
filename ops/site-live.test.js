#!/usr/bin/env node
/**
 * QWATT site — the live helper and the status renderer, with Horizon stubbed
 * ---------------------------------------------------------------------------
 * assets/qwatt-live.js is the only way a page reads Stellar testnet. These tests
 * prove, offline, that what it hands to the page never carries an amount, a fee,
 * a memo that is not QW#n or a coin total; that it refuses another network; that it
 * counts week-1 transactions over the right window; and that the anchoring account
 * comes from assets/status.json only (DESIGN.md §6.3, §7.5, §10).
 * assets/qwatt-status.js: the week chip rule and the evidence-link allowlist.
 *
 * Fixtures: ops/fixtures/horizon/*.json, trimmed real responses read on 24 Oct 2026
 * (public testnet accounts; memo text and balances of the August accounts replaced).
 * Run: node ops/site-live.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FX = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'horizon', n), 'utf8'));

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(JSON.stringify(a) === JSON.stringify(b), `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const HZ = 'https://horizon-testnet.stellar.org';
const ABCD = 'GAYA2PZSQJTHHXZPB2ZD6LO3C75GOLSI3T4PZNSSYOEL4FNWFK27CYET';
const AUG = 'GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46';
const DIST = 'GCLS6EE5UNXFNK44SQGD4F3TYYFE7QCJX2QEXQ5E4TOQSAQBZUXTSOKW';
const TX_C = '494e8d12cc3ab7b4f62a7f061a1e899c45e8b4553539346a0e71c8f5c525a8a1';
/* A seed-shaped string, built at runtime so none sits in the repository. */
const SEEDLIKE = 'S' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.repeat(2).slice(0, 55);

/** StrKey of a public key from 32 bytes (version byte 6<<3, CRC16-XModem little-endian, base32). */
function encodeG(bytes) {
  const data = [6 << 3].concat(bytes);
  let crc = 0;
  for (const b of data) { crc ^= b << 8; for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
  const all = data.concat([crc & 255, crc >> 8]);
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0, out = '';
  for (const b of all) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += A[(val << (5 - bits)) & 31];
  return out;
}

/* ── a stubbed fetch: routes by URL, records every request ── */
function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function stub(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    for (const [pat, val] of routes) {
      if (typeof pat === 'string' ? String(url) === pat : pat.test(String(url))) {
        const v = typeof val === 'function' ? val(String(url)) : val;
        if (v instanceof Error) throw v;
        return v && v.status ? v : response(200, v);
      }
    }
    return response(404, FX('not-found.json'));
  };
  fn.calls = calls;
  return fn;
}
function load(fetchImpl) {
  const p = path.join(ROOT, 'assets', 'qwatt-live.js');
  delete require.cache[require.resolve(p)];
  global.fetch = fetchImpl || stub([]);
  const L = require(p);
  if (L._reset) L._reset();
  if (L.POLICY) L.POLICY.retryMs = 0;   // no real waiting in tests
  return L;
}
function deepKeys(o, out = []) {
  if (Array.isArray(o)) o.forEach((x) => deepKeys(x, out));
  else if (o && typeof o === 'object') for (const k of Object.keys(o)) { out.push(k); deepKeys(o[k], out); }
  return out;
}
const MONEYISH = /^(balance|balances|amount|limit|fee_charged|max_fee|total_coins|fee_pool|base_fee_in_stroops|base_reserve_in_stroops|buying_liabilities|selling_liabilities)$/;

/* ══════════════════════ pure helpers ══════════════════════ */

test('maskMemo shows only anchoring memos QW#n', () => {
  const L = load();
  eq(L.maskMemo('QW#12'), 'QW#12', 'QW#12');
  eq(L.maskMemo(FX('txs-august.json')._embedded.records[0].memo), null, 'the August creation memo');
  for (const m of ['', null, undefined, 'QW#', 'QW#1 ', 'qw#1', 'QW#1a', ' QW#1']) eq(L.maskMemo(m), null, JSON.stringify(m));
});

test('isPublicKey checks the StrKey checksum; secret keys are not public keys', () => {
  const L = load();
  assert(L.isPublicKey(ABCD), 'a valid G address');
  assert(L.isPublicKey(AUG), 'another valid G address');
  const flipped = ABCD.slice(0, 20) + (ABCD[20] === 'A' ? 'B' : 'A') + ABCD.slice(21);
  assert(!L.isPublicKey(flipped), 'one character changed fails the CRC');
  assert(!L.isPublicKey(SEEDLIKE), 'an S… string is not a public key');
  assert(!L.isPublicKey(ABCD.toLowerCase()), 'lower case');
  assert(!L.isPublicKey(ABCD.slice(1)), 'too short');
  assert(!L.isPublicKey(null) && !L.isPublicKey(42), 'non-strings');
});

test('looksSecret recognizes an S… seed shape (the caller clears the field)', () => {
  const L = load();
  assert(L.looksSecret(SEEDLIKE), 'seed shape');
  assert(L.looksSecret('  ' + SEEDLIKE + '\n'), 'with whitespace around it');
  assert(!L.looksSecret(ABCD), 'a G address');
  assert(!L.looksSecret(TX_C), 'a transaction hash');
});

test('canOneKeySend: August 0/0/0 yes, rehearsal 1/2/3 yes, 2/2/3 with three weight-1 signers no', async () => {
  const L = load(stub([[`${HZ}/accounts/${AUG}`, FX('account-august.json')], [`${HZ}/accounts/${ABCD}`, FX('account-abcd.json')]]));
  const aug = await L.account(AUG);
  const reh = await L.account(ABCD);
  eq(L.canOneKeySend(aug), true, 'August account, one key');
  eq(L.canOneKeySend(reh), true, 'rehearsal 1/2/3');
  const real = { exists: true, thresholds: { low: 2, med: 2, high: 3 }, masterWeight: 0, signers: [{ key: 'GA', weight: 1 }, { key: 'GB', weight: 1 }, { key: 'GC', weight: 1 }, { key: 'GM', weight: 0 }] };
  eq(L.canOneKeySend(real), false, '2/2/3');
  eq(L.canOneKeySend({ exists: false }), null, 'unknown account');
});

test('check223 reads the target configuration item by item', async () => {
  const L = load(stub([[`${HZ}/accounts/${ABCD}`, FX('account-abcd.json')]]));
  const real = { exists: true, id: 'GM', thresholds: { low: 2, med: 2, high: 3 }, masterWeight: 0, signers: [{ key: 'GA', weight: 1 }, { key: 'GB', weight: 1 }, { key: 'GC', weight: 1 }, { key: 'GM', weight: 0 }] };
  eq(L.check223(real), { low2: true, med2: true, high3: true, threeSignersW1: true, masterZero: true }, '2/2/3');
  const reh = L.check223(await L.account(ABCD));
  eq(reh, { low2: false, med2: true, high3: true, threeSignersW1: true, masterZero: true }, 'rehearsal 1/2/3');
  const extra = Object.assign({}, real, { signers: real.signers.concat([{ key: 'GX', weight: 1 }]) });
  eq(L.check223(extra).threeSignersW1, false, 'a fourth signer');
});

test('weekOf: Chile-time sprint weeks, Monday 00:00 to Saturday 00:00', () => {
  const L = load();
  eq(L.weekOf('2026-10-19T02:59:59Z'), null, 'just before week 1');
  eq(L.weekOf('2026-10-19T03:00:00Z'), 1, 'week 1 starts');
  eq(L.weekOf('2026-10-24T02:59:59Z'), 1, 'Friday 23:59:59 Chile');
  eq(L.weekOf('2026-10-24T03:00:00Z'), null, 'the weekend');
  eq(L.weekOf('2026-10-26T03:00:00Z'), 2, 'week 2');
  eq(L.weekOf('2026-11-06T12:00:00Z'), 3, 'week 3');
  eq(L.weekOf('2026-11-10T12:00:00Z'), 'run', 'the counted run');
  eq(L.weekOf('nonsense'), null, 'not a date');
});

/* ══════════════════════ Horizon reads ══════════════════════ */

test('account() hands over no amount anywhere, and the trustline as a boolean', async () => {
  const L = load(stub([[`${HZ}/accounts/${ABCD}`, FX('account-abcd.json')], [`${HZ}/accounts/${DIST}`, FX('account-dist.json')], [`${HZ}/accounts/${AUG}`, FX('account-august.json')]]));
  for (const g of [ABCD, DIST, AUG]) {
    const a = await L.account(g);
    const bad = deepKeys(a).filter((k) => MONEYISH.test(k));
    eq(bad, [], `${g.slice(0, 6)}… money-like keys`);
    assert(!JSON.stringify(a).includes('1.0000000') && !JSON.stringify(a).includes('9999.'), 'no amount value leaks');
    eq(typeof a.hasQwattTrustline, 'boolean', 'trustline is a boolean');
  }
  const reh = await L.account(ABCD);
  eq(reh.thresholds, { low: 1, med: 2, high: 3 }, 'thresholds');
  eq(reh.masterWeight, 0, 'master weight');
  eq(reh.signers.filter((s) => s.weight === 1).length, 3, 'three weight-1 signers');
  eq(reh.data['qwatt.anchor.sha256'], '852314a2a11f86548e3f8b09c16aa2fd6ef82ae8e8641db5ef20a4bc2d0f5466', 'data decoded to ASCII');
  eq(reh.data['qwatt.cumulative_mwh'], '198000', 'cumulative decoded');
  eq((await L.account(DIST)).hasQwattTrustline, true, 'the August marker destination holds the trustline');
  eq((await L.account(AUG)).hasQwattTrustline, false, 'the account that created the asset does not');
  eq((await L.account(AUG)).homeDomain, null, 'home_domain not set');
});

test('account() of a missing account says so instead of throwing', async () => {
  const L = load(stub([]));
  const a = await L.account(ABCD);
  eq(a.exists, false, 'exists:false');
});

test('ledgers() drops coins, fees and reserves', async () => {
  const L = load(stub([[/\/ledgers\?order=desc&limit=5$/, FX('ledgers.json')]]));
  const ls = await L.ledgers(5);
  eq(ls.length, 5, 'five ledgers');
  eq(deepKeys(ls).filter((k) => MONEYISH.test(k)), [], 'no coin or fee keys');
  for (const l of ls) assert(Number.isInteger(l.sequence) && typeof l.closedAt === 'string' && Number.isInteger(l.ops), 'sequence, closedAt, ops');
  assert(ls[0].sequence > ls[1].sequence, 'newest first');
});

test('network() refuses another network', async () => {
  const L = load(stub([[`${HZ}/`, FX('root.json')]]));
  const n = await L.network();
  eq(n.ok, true, 'testnet passphrase accepted');
  assert(n.latestLedger > 5000000, 'latest ledger');
  const other = Object.assign({}, FX('root.json'), { network_passphrase: 'Public Global Stellar Network ; September 2015' });
  const L2 = load(stub([[`${HZ}/`, other]]));
  let err = null; try { await L2.network(); } catch (e) { err = e; }
  assert(err && err.code === 'wrong-network', 'throws wrong-network');
});

test('txCount() pages back until the window starts and counts only inside it', async () => {
  const mk = (iso, i) => ({ id: 'h' + i, hash: 'h' + i, created_at: iso, successful: true, ledger: 1000 + i, operation_count: 1, signatures: ['x'], memo_type: 'none', paging_token: String(i) });
  /* Horizon pages hold 200 records; a shorter page is the last one. */
  const filler = (from, n, iso) => Array.from({ length: n }, (_, k) => mk(iso, from + k));
  const page1 = { _links: { next: { href: `${HZ}/accounts/${ABCD}/transactions?cursor=3&limit=200&order=desc` } },
    _embedded: { records: [mk('2026-10-25T10:00:00Z', 1), mk('2026-10-23T23:00:00Z', 2), mk('2026-10-20T12:00:00Z', 3)].concat(filler(10, 197, '2026-10-20T11:00:00Z')) } };
  const page2 = { _links: { next: { href: `${HZ}/accounts/${ABCD}/transactions?cursor=6&limit=200&order=desc` } },
    _embedded: { records: [mk('2026-10-19T03:00:00Z', 4), mk('2026-10-19T02:59:59Z', 5)].concat(filler(300, 198, '2026-10-08T20:46:47Z')) } };
  const page3 = { _embedded: { records: [mk('2026-10-01T00:00:00Z', 7)] } };
  const f = stub([[/cursor=3&/, page2], [/cursor=6&/, page3], [/\/transactions\?order=desc&limit=200$/, page1]]);
  const L = load(f);
  const r = await L.txCount(ABCD, '2026-10-19T03:00:00Z', '2026-10-24T03:00:00Z');
  eq(r.count, 2 + 197 + 1, 'inside week 1: two named, 197 more on page 1, and the one exactly at the start');
  eq(r.last, '2026-10-25T10:00:00Z', 'newest transaction overall');
  eq(f.calls.some((u) => /cursor=6&/.test(u)), false, 'stops once a page reaches before the window');
  const L2 = load(stub([]));
  eq(await L2.txCount(ABCD, '2026-10-19T03:00:00Z', '2026-10-24T03:00:00Z'), { count: 0, last: null, notFound: true }, 'missing account');
});

test('txCount() never follows a next link to another host', async () => {
  const page1 = { _links: { next: { href: 'https://example.org/next' } }, _embedded: { records: [{ id: 'a', hash: 'a', created_at: '2026-10-20T00:00:00Z', successful: true, signatures: [], operation_count: 1 }] } };
  const f = stub([[/transactions\?order=desc&limit=200$/, page1]]);
  const L = load(f);
  await L.txCount(ABCD, '2026-10-01T00:00:00Z', '2026-10-24T03:00:00Z');
  eq(f.calls.some((u) => u.startsWith('https://example.org')), false, 'no request outside Horizon testnet');
});

test('tx() returns the signatures and the masked memo, never the fee', async () => {
  const L = load(stub([[`${HZ}/transactions/${TX_C}`, FX('tx-c.json')]]));
  const t = await L.tx(TX_C);
  eq(t.memoShown, 'QW#0', 'memo QW#0 shown');
  eq(t.ledger, 5093764, 'ledger');
  eq(Array.isArray(t.signatures) && t.signatures.length, 2, 'two signatures');
  eq(t.ok, true, 'successful');
  eq(deepKeys(t).filter((k) => MONEYISH.test(k) || k === 'memo'), [], 'no fee and no raw memo');
});

test('txs() masks every memo that is not QW#n', async () => {
  const L = load(stub([[/\/accounts\/GDN6[A-Z0-9]+\/transactions\?order=desc&limit=3$/, FX('txs-august.json')]]));
  const ts = await L.txs(AUG, { limit: 3 });
  eq(ts.map((t) => t.memoShown), [null, null], 'both hidden');
  eq(deepKeys(ts).filter((k) => k === 'memo' || MONEYISH.test(k)), [], 'no memo or fee key');
});

test('ops() decodes manageData and hides the payment amount', async () => {
  const L = load(stub([[`${HZ}/transactions/${TX_C}/operations`, FX('ops-c.json')]]));
  const ops = await L.ops(TX_C);
  eq(ops.length, 3, 'three operations');
  eq(ops[0], { type: 'manage_data', name: 'qwatt.anchor.sha256', value: '322923a411c146079b73269fe3135d9e6413a9dafdb07807567c8a119f35a245' }, 'op 1');
  eq(ops[1], { type: 'manage_data', name: 'qwatt.cumulative_mwh', value: '99000' }, 'op 2');
  eq(ops[2], { type: 'payment', marker: true }, 'op 3: the fixed marker payment, no amount');
  assert(!JSON.stringify(ops).includes('0.0000001'), 'the amount never appears');
});

test('request policy: 429 backs off, a failure is retried once, then reported offline', async () => {
  let n = 0;
  const L = load(stub([[`${HZ}/`, () => response(429, {})]]));
  let err = null; try { await L.network(); } catch (e) { err = e; }
  assert(err && err.code === 'rate-limited', '429 → rate-limited');
  err = null; try { await L.ledgers(5); } catch (e) { err = e; }
  assert(err && err.code === 'rate-limited', 'still backing off for the next 60 s');
  const L2 = load(stub([[`${HZ}/`, () => { n++; return n === 1 ? new Error('socket hang up') : FX('root.json'); }]]));
  eq((await L2.network()).ok, true, 'a single failure is retried');
  const L3 = load(stub([[`${HZ}/`, () => new Error('offline')]]));
  err = null; try { await L3.network(); } catch (e) { err = e; }
  assert(err && err.code === 'offline', 'two failures → offline');
});

test('evidence() reads same-origin evidence only', async () => {
  const L = load(stub([['/evidence/rehearsal/x.json', { ok: 1 }]]));
  eq(await L.evidence('/evidence/rehearsal/x.json'), { ok: 1 }, 'same-origin JSON');
  let err = null; try { await L.evidence('https://example.org/x.json'); } catch (e) { err = e; }
  assert(err, 'an absolute URL is refused');
});

/* ══════════════════════ status.json → CONFIG ══════════════════════ */

test('ready(): anchor.account null stays null; a valid G… is taken; a failed read keeps null and the built-in label', async () => {
  const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'status.json'), 'utf8'));
  let L = load(stub([['/assets/status.json', S]]));
  await L.ready();
  eq(L.CONFIG.ANCHOR_ACCOUNT, null, 'null while week 2 has not created the account');
  eq(L.CONFIG.SIM_LABEL, S.labels.sim, 'simulated-input label from status.json');
  const G = encodeG(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255));
  const S2 = JSON.parse(JSON.stringify(S)); S2.anchor.account = G;
  L = load(stub([['/assets/status.json', S2]]));
  await L.ready();
  assert(L.isPublicKey(G), 'the generated address is a valid StrKey');
  eq(L.CONFIG.ANCHOR_ACCOUNT, G, 'a valid public key is taken');
  const S3 = JSON.parse(JSON.stringify(S)); S3.anchor.account = ABCD;
  L = load(stub([['/assets/status.json', S3]]));
  await L.ready();
  eq(L.CONFIG.ANCHOR_ACCOUNT, null, 'a rehearsal account is never taken as the anchoring account');
  L = load(stub([['/assets/status.json', () => new Error('offline')]]));
  await L.ready();
  eq(L.CONFIG.ANCHOR_ACCOUNT, null, 'fetch failure → null');
  eq(L.CONFIG.SIM_LABEL, { es: 'Entrada simulada · Stellar testnet', en: 'Simulated input · Stellar testnet' }, 'built-in label');
});

test('ready(): week windows derived from status.json equal the offline fallbacks', async () => {
  const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'status.json'), 'utf8'));
  const L0 = load();
  const fallback = JSON.parse(JSON.stringify({ W: L0.CONFIG.WEEKS, R: L0.CONFIG.RUN, S: L0.CONFIG.SPRINT_START }));
  const L = load(stub([['/assets/status.json', S]]));
  await L.ready();
  eq({ W: L.CONFIG.WEEKS, R: L.CONFIG.RUN, S: L.CONFIG.SPRINT_START }, fallback, 'same windows');
});

/* ══════════════════════ assets/qwatt-status.js ══════════════════════ */

function loadStatus() {
  const p = path.join(ROOT, 'assets', 'qwatt-status.js');
  delete require.cache[require.resolve(p)];
  const Q = require(p);
  Q.init(JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'status.json'), 'utf8')));
  return Q;
}

test('weekState: week 3 is planned on Sun 1 Nov and in progress from Mon 2 Nov; weeks 1 and 2 are done', () => {
  const Q = loadStatus();
  eq(Q.weekState(Q.week(3), '2026-11-01'), 'planificado', '1 Nov');
  eq(Q.weekState(Q.week(3), '2026-11-02'), 'curso', '2 Nov');
  eq(Q.weekState(Q.week(1), '2026-10-24'), 'hecho', 'week 1 has its changelog');
  eq(Q.weekState(Q.week(2), '2026-10-30'), 'hecho', 'week 2 has its changelog');
  eq(Q.weekState(Q.week(0), '2026-10-24'), 'previo', 'prior work');
  eq(Q.weekState(Q.week(4), '2026-11-02'), 'planificado', 'the run later');
});

test('render.evidenceLink refuses a URL outside the evidence patterns', () => {
  const Q = loadStatus();
  const ok = Q.render.evidenceLink({ kind: 'pr', url: 'https://github.com/academiaseul/QWATT/pull/9' });
  assert(/href="https:\/\/github\.com\/academiaseul\/QWATT\/pull\/9"/.test(ok) && /rel="noopener"/.test(ok), 'a PR link renders');
  for (const bad of [{ kind: 'pr', url: 'https://github.com/someone/else/pull/9' }, { kind: 'run', url: 'https://example.org/actions/runs/1' }, { kind: 'doc', url: 'javascript:alert(1)' }, { kind: 'nope', url: 'https://github.com/academiaseul/QWATT' }]) {
    let threw = false; try { Q.render.evidenceLink(bad); } catch (e) { threw = true; }
    assert(threw, 'refused: ' + bad.url);
  }
});

test('chips: status → chip words, and a week chip computed from the date given', () => {
  const Q = loadStatus();
  eq(Q.chip('done', 1).st, 'hecho', 'done → hecho');
  assert(/SEMANA 1/.test(Q.chip('done', 1).es) && /WEEK 1/.test(Q.chip('done', 1).en), 'HECHO · SEMANA 1 / DONE · WEEK 1');
  eq(Q.chip('planned').st, 'planificado', 'planned');
  eq(Q.chip('out_of_scope').st, 'fuera', 'out of scope');
  eq(Q.chipFor('node:cualquiera', '2026-10-24').st, 'testnet', 'node chip');
  eq(Q.chipFor('item:V3-4', '2026-10-30').st, 'curso', 'item chip (V3-4 in progress)');
  eq(Q.chipFor('item:V3-11', '2026-10-30').st, 'planificado', 'item chip (V3-11 planned)');
  eq(Q.chipFor('week:3', '2026-11-02').st, 'curso', 'week chip by date');
  eq(Q.chipFor('item:NOPE', '2026-10-24'), null, 'unknown reference');
});

/* ══════════════════════ run ══════════════════════ */

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log(`  ✓ ${t.name}`); } catch (e) { failed++; console.log(`  ✗ ${t.name}\n      ${e && e.message ? e.message : e}`); }
  }
  console.log(`\nsite live helper: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
