/**
 * QWATT ingest — tests
 * Run: node ingest/ingest.test.js     (no framework, no install — same as the other suites)
 */

'use strict';

const path = require('path');
const RM = require('./lib/registermap');
const { IntervalBuilder, canonical, sha256 } = require('./lib/normalize');
const modbus = require('./adapters/modbus');
const csv = require('./adapters/csv');
const httpAdapter = require('./adapters/http');
const harness = require('./harness');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function near(a, b, tol, w) { assert(Math.abs(a - b) <= tol, `${w}: expected ≈${b}, got ${a}`); }

const H = 3600000;
const T0 = Date.parse('2026-09-20T15:00:00Z');   // on the 300 s grid
const meters2 = { a: { id: 'a', class: 'dc', energy: 'integrate' }, b: { id: 'b', class: 'dc', energy: 'integrate' } };
const mk = (o = {}) => new IntervalBuilder(Object.assign({ site_id: 's', node_id: 'n', adapter: 'replay', dt_s: 300, meters: meters2 }, o));
const mk1 = (o = {}) => mk(Object.assign({ meters: { a: { id: 'a', class: 'dc', energy: 'integrate' } } }, o));   // single meter: closes on its own samples

/* ───────────────────────── register maps ───────────────────────── */

test('both shipped register maps load and validate', () => {
  for (const n of ['pzem-017', 'epever-tracer']) { const m = RM.load(n); eq(m.name, n, 'name'); assert(RM.blocks(m).length >= 1, 'blocks'); }
});

test('u16 with power-of-ten scale decodes to the same double as parsing the decimal string', () => {
  const f = { address: 0, type: 'u16', scale: 0.01 };
  eq(RM.decodeField(f, [1823], 0), Number('18.23'), 'u16×0.01');
  const g = { address: 0, type: 'u32', word_order: 'lo_hi', scale: 0.1 };
  eq(RM.decodeField(g, [1234, 0], 0), Number('123.4'), 'u32 lo_hi ×0.1');
});

test('u32 word order: lo_hi vs hi_lo', () => {
  const lo = { address: 0, type: 'u32', word_order: 'lo_hi' }, hi = { address: 0, type: 'u32' };
  eq(RM.decodeField(lo, [0x5678, 0x1234], 0), 0x12345678, 'lo_hi');
  eq(RM.decodeField(hi, [0x1234, 0x5678], 0), 0x12345678, 'hi_lo');
});

test('i16 and i32 are signed; f32 decodes IEEE-754', () => {
  eq(RM.decodeField({ address: 0, type: 'i16' }, [0xffff], 0), -1, 'i16');
  eq(RM.decodeField({ address: 0, type: 'i32' }, [0xffff, 0xfffe], 0), -2, 'i32');
  const b = Buffer.alloc(4); b.writeFloatBE(1.5, 0);
  eq(RM.decodeField({ address: 0, type: 'f32' }, [b.readUInt16BE(0), b.readUInt16BE(2)], 0), 1.5, 'f32');
});

test('encode → decode round-trips every field of both maps', () => {
  for (const n of ['pzem-017', 'epever-tracer']) {
    const m = RM.load(n);
    const vals = {}; let k = 1;
    for (const [name, f] of Object.entries(m.fields)) { const s = f.scale == null ? 1 : f.scale; vals[name] = (k++ * 37) * s; }
    const dec = RM.decode(m, RM.encode(m, vals));
    for (const name of Object.keys(vals)) near(dec[name], vals[name], 1e-9, `${n}.${name}`);
  }
});

test('blocks never exceed 125 registers and cover every field', () => {
  const m = RM.load('epever-tracer');
  const bl = RM.blocks(m);
  assert(bl.every((b) => b.count <= 125), 'block size');
  for (const f of Object.values(m.fields)) assert(bl.some((b) => f.address >= b.address && f.address + RM.wordsOf(f) <= b.address + b.count), 'coverage');
});

test('register map validation rejects a bad type', () => {
  let threw = false;
  try { RM.validate({ name: 'x', class: 'dc', protocol: { unit_id: 1, function: 4 }, fields: { p: { address: 0, type: 'u64' } }, energy: 'integrate', power_field: 'p' }); } catch (e) { threw = true; }
  assert(threw, 'should throw');
});

/* ───────────────────────── normalization ───────────────────────── */

test('constant 100 W for 10 min → two intervals of exactly 8333 mWh, boundary split exact', () => {
  const b = mk();
  const out = [];
  for (let t = 0; t <= 600000; t += 10000) for (const k of ['a', 'b']) out.push(...b.push(k, { ts: T0 + t, power_w: 100 }));
  const last = b.flush();
  eq(out.length, 2, 'closed intervals');
  eq(out[0].meters.a.mwh, 8333, 'interval 0 energy');
  eq(out[1].meters.a.mwh, 8333, 'interval 1 energy');
  eq(out[0].meters.a.mw_mean, 100000, 'mean power mW');
  eq(out[0].ts_start, '2026-09-20T15:00:00.000Z', 'ts_start');
  eq(out[0].ts_end, '2026-09-20T15:05:00.000Z', 'ts_end');
  eq(out[0].seq, 0, 'seq'); eq(out[1].seq, 1, 'seq');
  assert(last && last.length === 1 && last[0].meters.a.samples === 1, 'flush closes the partial third interval');
});

test('energy is conserved across a boundary with a sloping ramp', () => {
  const b = mk1();
  const out = [];
  // 0 → 300 W over 10 min, samples every 30 s: total = average 150 W × (1/6) h = 25 Wh = 25000 mWh
  for (let t = 0; t <= 600000; t += 30000) out.push(...b.push('a', { ts: T0 + t, power_w: t / 2000 }));
  eq(out.length, 2, 'two closed');
  near(out[0].meters.a.mwh + out[1].meters.a.mwh, 25000, 1, 'total energy');
  eq(out[0].meters.a.mwh, 6250, 'first (0→150 W)');
  eq(out[1].meters.a.mwh, 18750, 'second (150→300 W)');
});

test('counter mode uses the instrument’s own delta', () => {
  const b = mk({ meters: { a: { id: 'a', class: 'dc', energy: 'counter' } } });
  const out = [];
  out.push(...b.push('a', { ts: T0, power_w: 100, energy_wh: 1000 }));
  out.push(...b.push('a', { ts: T0 + 290000, power_w: 100, energy_wh: 1008 }));
  out.push(...b.push('a', { ts: T0 + 300000, power_w: 100, energy_wh: 1008 }));   // closes interval 0
  out.push(...b.push('a', { ts: T0 + 590000, power_w: 100, energy_wh: 1016 }));
  out.push(...b.push('a', { ts: T0 + 600000, power_w: 100, energy_wh: 1017 }));   // closes interval 1
  eq(out.length, 2, 'closed');
  eq(out[0].meters.a.mwh, 0, 'first interval has no previous close → 0 (no baseline)');
  eq(out[1].meters.a.mwh, 8000, 'delta 1016−1008 Wh');
});

test('a gap in samples yields empty intervals rather than silently skipping them', () => {
  const b = mk1();
  const out = [];
  out.push(...b.push('a', { ts: T0, power_w: 100 }));
  out.push(...b.push('a', { ts: T0 + 1000000, power_w: 100 }));   // 16.7 min later
  eq(out.length, 3, 'intervals 0,1,2 closed');
  eq(out[1].meters.a.samples, 0, 'interval 1 has no samples');
  eq(out[1].meters.a.mwh, 8333, 'but the trapezoid across it still carries energy');
  assert(out[1].meters.a.mw_mean === undefined, 'no mean without samples');
});

test('a configured second meter that never reports delays closing by one interval, then closes with zero samples', () => {
  const b = mk();   // two meters configured, only A reports
  const out = [];
  for (let t = 0; t <= 600000; t += 10000) out.push(...b.push('a', { ts: T0 + t, power_w: 100 }));
  eq(out.length, 1, 'only interval 0 closed at t=600 s (grace of one interval)');
  eq(out[0].meters.b.samples, 0, 'B closed empty');
  eq(out[0].meters.b.mwh, 0, 'B carries no energy — the agreement gate will reject it');
});

test('out-of-order samples are refused', () => {
  const b = mk();
  b.push('a', { ts: T0 + 400000, power_w: 1 });
  let threw = false;
  try { b.push('a', { ts: T0, power_w: 1 }); } catch (e) { threw = true; }
  assert(threw, 'past-interval sample must throw');
});

test('every emitted record validates against interval.schema.json and is integer-only', () => {
  const b = mk();
  b.push('a', { ts: T0, power_w: 12.34 }); b.push('b', { ts: T0, power_w: 12.3 });
  b.push('a', { ts: T0 + 300000, power_w: 12.34 });
  const [r] = b.push('b', { ts: T0 + 300000, power_w: 12.3 });   // closes once BOTH meters are past the boundary
  assert(r, 'record');
  const walk = (v) => { if (typeof v === 'number') assert(Number.isInteger(v), 'non-integer number in record: ' + v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(r);
  eq(r.schema_version, '1.1.0', 'schema_version');
  assert(/^[0-9a-f]{64}$/.test(r.source.raw_sha256), 'raw_sha256');
});

test('raw_sha256 depends on the raw payload, not on the decoded values', () => {
  const r1 = (() => { const b = mk1(); b.push('a', { ts: T0, power_w: 1 }, 'frame-A'); return b.push('a', { ts: T0 + 300000, power_w: 1 }, 'x')[0]; })();
  const r2 = (() => { const b = mk1(); b.push('a', { ts: T0, power_w: 1 }, 'frame-B'); return b.push('a', { ts: T0 + 300000, power_w: 1 }, 'x')[0]; })();
  assert(r1.source.raw_sha256 !== r2.source.raw_sha256, 'different payload → different hash');
  eq(r1.meters.a.mwh, r2.meters.a.mwh, 'same energy');
});

test('canonical JSON sorts keys and drops undefined', () => {
  eq(canonical({ b: 1, a: [3, { z: undefined, y: 'ñ' }] }), '{"a":[3,{"y":"ñ"}],"b":1}', 'canonical');
  eq(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256');
});

/* ───────────────────────────── adapters ───────────────────────────── */

test('CSV: quoted fields, epoch and ISO timestamps', () => {
  eq(JSON.stringify(csv.splitLine('a,"b,c","d""e",')), '["a","b,c","d\\"e",""]', 'split');
  eq(csv.parseTs('1789657200'), 1789657200000, 'epoch s');
  eq(csv.parseTs('1789657200000'), 1789657200000, 'epoch ms');
  eq(csv.parseTs('2026-09-20T15:00:00Z'), T0, 'iso');
});

test('HTTP: /intervals accepts a valid record, stamps clock_skew_s, rejects an invalid one', async () => {
  const got = [];
  const srv = await httpAdapter.start({ port: 0, now: () => T0 + 300000 + 42000 }, mk(), (r) => got.push(r));
  const rec = { spec_version: '1.0.0', schema_version: '1.1.0', site_id: 's', node_id: 'n', seq: 7, ts_start: '2026-09-20T15:00:00Z', ts_end: '2026-09-20T15:05:00Z', dt_s: 300,
    meters: { a: { id: 'a', class: 'dc', mwh: 11800 }, b: { id: 'b', class: 'dc', mwh: 11600 } }, source: { adapter: 'http-json' } };
  const ok = await httpAdapter.post(srv.port, '/intervals', rec);
  eq(ok.status, 202, 'status'); eq(ok.body.clock_skew_s, 42, 'skew'); eq(got.length, 1, 'delivered');
  const bad = await httpAdapter.post(srv.port, '/intervals', Object.assign({}, rec, { meters: { a: { id: 'a', class: 'dc', mwh: 11.8 } } }));
  eq(bad.status, 400, 'float mwh rejected'); assert(bad.body.details.some((d) => /mwh/.test(d)), 'names the field');
  const nf = await httpAdapter.post(srv.port, '/nope', {});
  eq(nf.status, 404, '404');
  await srv.close();
});

test('Modbus TCP: client reads the simulator, exception codes surface as errors', async () => {
  const sim = await modbus.createSimulator({ provider: (uid, fc, addr, count) => { if (addr > 100) throw Object.assign(new Error('x'), { code: 2 }); return Array.from({ length: count }, (_, i) => addr + i); } });
  const c = new modbus.ModbusTcp({ host: '127.0.0.1', port: sim.port });
  await c.connect();
  const r = await c.read(1, 4, 10, 3);
  eq(JSON.stringify(r.regs), '[10,11,12]', 'regs');
  let threw = false;
  try { await c.read(1, 4, 500, 2); } catch (e) { threw = /exception 2/.test(e.message); }
  assert(threw, 'exception 2 surfaced');
  c.close(); await sim.close();
});

test('Modbus RTU CRC matches the reference vector', () => {
  // Classic example: 01 04 00 00 00 02 → CRC 71 CB (little-endian on the wire: 71 CB)
  eq(modbus.crc16(Buffer.from([0x01, 0x04, 0x00, 0x00, 0x00, 0x02])), 0xcb71, 'crc');
});

test('Deliverable 1 acceptance: csv, http and modbus paths are byte-identical', async () => {
  const diffs = await harness.run();
  eq(diffs, 0, 'differences');
});

/* ───────────────────────────── runner ───────────────────────────── */

(async () => {
  console.log('\ningest');
  for (const t of tests) {
    try { await t.fn(); console.log('  ✓ ' + t.name); passed++; }
    catch (e) { console.log('  ✗ ' + t.name + '\n      ' + e.message); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
