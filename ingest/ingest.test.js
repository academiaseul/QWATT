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
const mk = (o = {}) => new IntervalBuilder(Object.assign({ site_id: 's', node_id: 'n', adapter: 'replay', dt_s: 300, meters: meters2, clock: 'replay' }, o));   // replay clock (V3-6)
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

/* The manufacturers' own worked examples, copied from the protocol documents cited in ingest/README.md
   ("Register-map sources"). They are documented frames, not frames captured from our hardware. */
const PZEM_DOC_REPLY = Buffer.from('010410' + '2710' + '0064' + '03e8' + '0000' + '0000' + '0000' + '0000' + '0000', 'hex');   // PZEM-003/017 §2.3 reply, without its CRC

test('documented example frames decode with the shipped maps (PZEM-003/017 §2.3 reply; EPEver v2.5 32-bit L/H example)', () => {
  const regs = [];
  for (let i = 3; i < PZEM_DOC_REPLY.length; i += 2) regs.push(PZEM_DOC_REPLY.readUInt16BE(i));
  const pz = RM.decode(RM.load('pzem-017'), [{ address: 0, regs }]);
  near(pz.voltage_v, 100, 1e-9, 'PZEM voltage 0x2710 → 100.00 V');
  near(pz.current_a, 1, 1e-9, 'PZEM current 0x0064 → 1.00 A');
  near(pz.power_w, 100, 1e-9, 'PZEM power 0x000003E8, low word first → 100.0 W');
  eq(pz.energy_wh, 0, 'PZEM energy 0 Wh'); eq(pz.alarm_high, 0, 'no high-voltage alarm'); eq(pz.alarm_low, 0, 'no low-voltage alarm');
  // EPEver v2.5, characteristic 5: 3000 at multiple 100 is L = 0x93E0 (lower address), H = 0x0004.
  const ep = RM.load('epever-tracer');
  near(RM.decodeField(ep.fields.power_w, [0x93e0, 0x0004], ep.fields.power_w.address), 3000, 1e-9, 'EPEver power_w type, word order and scale');
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

test('a meter that disconnects for 15 min and returns does not crash, and no energy is invented for the gap', () => {
  /* Regression: the returning meter's first sample used to integrate back into intervals that had
     already closed without it, throwing "arrived after that interval was closed". */
  const b = mk();
  const out = [];
  for (let s = 0; s <= 3600; s += 10) {
    const ts = T0 + s * 1000;
    out.push(...b.push('a', { ts, power_w: 100 }));
    if (s < 600 || s > 1500) out.push(...b.push('b', { ts, power_w: 99 }));   // B silent 600–1500 s
  }
  out.push(...(b.flush() || []));
  eq(out.length, 13, 'every interval of the hour closes (12 plus the one the final sample opens)');
  const gap = out.filter((r) => r.meters.b.samples === 0);
  assert(gap.length >= 2, `intervals fully inside the gap have no B samples (${gap.length})`);
  for (const r of gap) eq(r.meters.b.mwh, 0, `no B energy invented at ${r.ts_start}`);
  const after = out.find((r) => Date.parse(r.ts_start) >= T0 + 1800e3);
  assert(after.meters.b.mwh > 8000, 'B integrates normally once a full interval has passed since its return');
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

test('CSV: an empty power cell is a missing reading, never 0 W', async () => {
  const fs = require('fs'), os = require('os');
  const file = path.join(os.tmpdir(), `qwatt-blank-${process.pid}.csv`);
  const lines = ['ts,a_w,b_w'];
  for (let s = 0; s < 600; s += 10) lines.push(`${new Date(T0 + s * 1000).toISOString()},100,${s >= 300 ? '' : '99'}`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const b = mk(); const out = []; b.onInterval = (r) => out.push(r);
  await csv.replay({ file, ts_column: 'ts', meters: { a: { power_w: 'a_w' }, b: { power_w: 'b_w' } }, pace: 'fast' }, b);
  fs.unlinkSync(file);
  const second = out.find((r) => r.ts_start === new Date(T0 + 300000).toISOString());
  eq(second.meters.b.samples, 0, 'blank cells produced no samples');
  assert(second.meters.a.samples > 0, 'meter A unaffected');
});

/* ─────────────── receive time: clock_skew_s on every path (V3-6) ─────────────── */

test('V3-6: the builder stamps clock_skew_s = receive time − ts_end, from its clock when the interval closes', () => {
  let now = T0;
  const b = mk1({ clock: () => now });
  b.push('a', { ts: T0, power_w: 100 });
  now = T0 + 300000 + 42400;                     // the closing sample is received 42.4 s after ts_end
  const [r] = b.push('a', { ts: T0 + 300000, power_w: 100 });
  eq(r.clock_skew_s, 42, 'whole seconds, read when the interval closes');
  now = T0 + 600000 + 42600;                     // the next one 42.6 s after its ts_end
  const [r2] = b.push('a', { ts: T0 + 600000, power_w: 100 });
  eq(r2.clock_skew_s, 43, 'rounded to the nearest second (42.6 s → 43), not truncated');
  now = T0 + 720000;                             // shut down at 15:12:00, three minutes before the open interval ends
  const [p] = b.flush();
  eq(p.clock_skew_s, -180, 'a partial interval flushed early has a negative skew');
});

test('V3-6: in a replay the receive time is the replay clock, the latest sample timestamp pushed', () => {
  const b = mk(); const out = [];
  for (let t = 0; t <= 600000; t += 10000) for (const k of ['a', 'b']) out.push(...b.push(k, { ts: T0 + t, power_w: 100 }));
  eq(out.map((r) => r.clock_skew_s).join(','), '0,0', 'closed by the sample at each end');
  eq(b.flush()[0].clock_skew_s, -300, 'flushed at 15:10:00, five minutes before its end');
  const g = mk(); const lag = [];
  for (let t = 0; t <= 600000; t += 10000) lag.push(...g.push('a', { ts: T0 + t, power_w: 100 }));   // B never reports
  eq(lag.length, 1, 'one closed'); eq(lag[0].clock_skew_s, 300, 'closed by the one-interval grace at 15:10:00');
  /* the replay clock only moves forward: a lagging meter's older samples do not take it back */
  const f = mk(); const back = [];
  for (let t = 0; t <= 590000; t += 10000) back.push(...f.push('a', { ts: T0 + t, power_w: 100 }));   // a runs ahead to 15:09:50
  for (let t = 0; t <= 300000; t += 10000) back.push(...f.push('b', { ts: T0 + t, power_w: 100 }));   // b catches up to 15:05:00
  eq(back.length, 1, 'b closes 15:00');
  eq(back[0].clock_skew_s, 290, 'received at 15:09:50, the latest timestamp pushed, not 15:05:00, the last one pushed');
});

test('V3-6: G0 refuses a late interval on CSV input (real-time pace) and on Modbus input', async () => {
  const fs = require('fs'), os = require('os');
  const G = require('../assets/qwatt-gates.js'), SPEC = require('../assets/gates.generated.js');
  const codes = (r) => G.evaluateInterval(r, SPEC.profiles.bench, SPEC).failures.map((f) => f.code);
  const late = () => T0 + 300000 + 7501000;      // received 7501 s after ts_end; bench clock_max_skew_s is 7500
  const file = path.join(os.tmpdir(), `qwatt-skew-${process.pid}.csv`);
  fs.writeFileSync(file, ['ts,a_w,b_w', ...[299980, 299990, 300000].map((d) => `${new Date(T0 + d).toISOString()},100,99`)].join('\n') + '\n');
  const fromCsv = []; const cb = mk({ adapter: 'csv', clock: late }); cb.onInterval = (r) => fromCsv.push(r);
  await csv.replay({ file, ts_column: 'ts', meters: { a: { power_w: 'a_w' }, b: { power_w: 'b_w' } }, pace: 'realtime', flush: false }, cb);   // rows 10 ms apart: waits 20 ms
  fs.unlinkSync(file);
  eq(fromCsv.length, 1, 'CSV interval'); eq(fromCsv[0].clock_skew_s, 7501, 'CSV skew');
  assert(codes(fromCsv[0]).includes('plausibility.skew'), `CSV: G0 fires [${codes(fromCsv[0])}]`);
  const rtu = new modbus.ModbusRtu({ path: 'in-memory', timeoutMs: 1000 });
  rtu.port = fakeSerial(() => PZEM_DOC_REPLY);
  const mb = mk1({ adapter: 'modbus-rtu', register_map: 'pzem-017@1', clock: late, sample_s: 300 });   // polled every 5 min
  await modbus.pollOnce(rtu, RM.load('pzem-017'), mb, 'a', T0);
  const [rec] = await modbus.pollOnce(rtu, RM.load('pzem-017'), mb, 'a', T0 + 300000);
  eq(rec.clock_skew_s, 7501, 'Modbus skew');
  assert(codes(rec).includes('plausibility.skew'), `Modbus: G0 fires [${codes(rec)}]`);
});

test('V3-6: a builder needs a clock ("replay" or a function); a fast replay refuses a wall clock', async () => {
  const fs = require('fs'), os = require('os');
  const base = { site_id: 's', node_id: 'n', adapter: 'replay', meters: meters2 };
  const refuses = (o, re, w) => {
    let msg = '';
    try { new IntervalBuilder(Object.assign({}, base, o)); } catch (e) { msg = e.message; }
    assert(re.test(msg), `${w}: expected a refusal matching ${re}, got "${msg}"`);
  };
  refuses({}, /clock/, 'no clock');
  refuses({ clock: 'wall' }, /clock/, 'unknown clock');
  refuses({ clock: Date.now() }, /clock/, 'a timestamp is not a clock');
  const file = path.join(os.tmpdir(), `qwatt-wall-${process.pid}.csv`);
  fs.writeFileSync(file, `ts,a_w\n${new Date(T0).toISOString()},100\n`);
  const open = fs.createReadStream; let opened = 0;
  fs.createReadStream = (...a) => { opened++; return open.apply(fs, a); };   // csv.js reads through the same fs module
  const tryReplay = async (pace) => { try { await csv.replay({ file, ts_column: 'ts', meters: { a: { power_w: 'a_w' } }, pace }, mk1({ clock: () => Date.now() })); return ''; } catch (e) { return e.message; } };
  let fast, factor;
  try { fast = await tryReplay('fast'); factor = await tryReplay(60); } finally { fs.createReadStream = open; fs.unlinkSync(file); }
  assert(/replay/.test(fast) && /clock/.test(fast), `a fast replay on a wall clock is refused (got "${fast}")`);
  assert(/replay/.test(factor) && /clock/.test(factor), `an accelerated (×60) replay on a wall clock is refused (got "${factor}")`);
  eq(opened, 0, 'refused before the file is opened');
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

test('HTTP: /intervals writes RFC 3339 timestamps in canonical UTC, keeps the request hash in raw_sha256, and answers 400 off the grid (ingest.off_grid)', async () => {
  const { BatchAssembler } = require('../batch/assemble');
  const got = [];
  const srv = await httpAdapter.start({ port: 0, now: () => T0 + 1500000 }, mk(), (r) => got.push(r));
  const rec = (i, spell, dt = 300) => ({ spec_version: '1.0.0', schema_version: '1.1.0', site_id: 's', node_id: 'n', seq: i,
    ts_start: spell(new Date(T0 + i * 300000).toISOString()), ts_end: spell(new Date(T0 + i * 300000 + dt * 1000).toISOString()), dt_s: dt,
    meters: { a: { id: 'a', class: 'dc', mwh: 11800 }, b: { id: 'b', class: 'dc', mwh: 11600 } }, source: { adapter: 'http-json' } });
  const spellings = [(s) => s, (s) => s.replace('.000Z', 'Z'), (s) => s.replace('.000Z', '+00:00'),
    (s) => new Date(Date.parse(s) - 3 * H).toISOString().replace('Z', '-03:00')];   // Santiago local time, same instant
  const sent = spellings.map((spell, i) => rec(i, spell));
  for (const r of sent) eq((await httpAdapter.post(srv.port, '/intervals', r)).status, 202, r.ts_start);
  const offGrid = rec(4, (s) => new Date(Date.parse(s) + 60000).toISOString());   // a minute off the 300 s grid
  const off = await httpAdapter.post(srv.port, '/intervals', offGrid);
  await srv.close();
  eq(off.status, 400, 'off the grid'); eq(off.body.error, 'ingest.off_grid', 'named');
  eq(got.length, 4, 'four delivered');
  got.forEach((r, i) => {
    eq(r.ts_start, new Date(T0 + i * 300000).toISOString(), `ts_start ${i}`);
    eq(r.ts_end, new Date(T0 + (i + 1) * 300000).toISOString(), `ts_end ${i}`);
  });
  assert(got[0].source.raw_sha256 === undefined, 'a canonical record is delivered as sent');
  got.slice(1).forEach((r, i) => eq(r.source.raw_sha256, sha256(JSON.stringify(sent[i + 1])), `request hash ${i + 1}`));
  const a = new BatchAssembler({ site_id: 's', node_id: 'n' });
  got.forEach((r) => { const l = a.judge(r); eq(l.verdict, 'accept', `door: ${r.ts_start} [${l.reasons}]`); });
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

/** In-memory serial port for ModbusRtu: answers each request with reply(request) plus its CRC (or a wrong
    one) and delivers the bytes a few at a time, as a UART does. No `serialport` package, no hardware. */
function fakeSerial(reply, { badCrc = false, chunk = 3 } = {}) {
  const port = new (require('events').EventEmitter)();
  port.isOpen = true; port.close = () => { port.isOpen = false; }; port.written = [];
  port.write = (req) => {
    port.written.push(Buffer.from(req));
    const body = reply(req);
    const frame = Buffer.concat([body, Buffer.alloc(2)]);
    frame.writeUInt16LE(modbus.crc16(body) ^ (badCrc ? 0xffff : 0), body.length);
    let i = 0;
    const next = () => { if (i < frame.length) { port.emit('data', frame.subarray(i, i + chunk)); i += chunk; setImmediate(next); } };
    setImmediate(next);
  };
  return port;
}

test('Modbus RTU: request framing, chunked replies, exception codes and CRC mismatch through ModbusRtu on an in-memory port (no hardware)', async () => {
  const crypto = require('crypto');
  const pzem = RM.load('pzem-017');
  const rtu = new modbus.ModbusRtu({ path: 'in-memory', timeoutMs: 1000 });
  rtu.port = fakeSerial((req) => (req.readUInt16BE(2) === 0 && req.readUInt16BE(4) === 8 ? PZEM_DOC_REPLY : Buffer.from([req[0], req[1] | 0x80, 0x02])));
  const r = await rtu.read(1, 4, 0, 8);
  eq(rtu.port.written[0].toString('hex'), '010400000008f1cc', 'request: slave 1, function 4, 8 registers from 0x0000, CRC low byte first');
  eq(JSON.stringify(r.regs), JSON.stringify([0x2710, 0x0064, 0x03e8, 0, 0, 0, 0, 0]), 'registers of the documented reply');
  eq(r.raw.length, PZEM_DOC_REPLY.length + 2, 'raw is the whole reply frame, CRC included');
  let err = '';
  try { await rtu.read(1, 4, 500, 2); } catch (e) { err = e.message; }
  assert(/exception 2/.test(err), `exception 2 surfaced (${err})`);
  const bad = new modbus.ModbusRtu({ path: 'in-memory', timeoutMs: 1000 });
  bad.port = fakeSerial(() => PZEM_DOC_REPLY, { badCrc: true });
  err = '';
  try { await bad.read(1, 4, 0, 8); } catch (e) { err = e.message; }
  eq(err, 'Modbus RTU: CRC mismatch', 'a corrupted frame is refused');
  // the same pollOnce the TCP path uses, into an interval; its raw_sha256 is the poll's reply frame
  const b = mk1({ adapter: 'modbus-rtu', register_map: 'pzem-017@1' });
  await modbus.pollOnce(rtu, pzem, b, 'a', T0);
  const [rec] = await modbus.pollOnce(rtu, pzem, b, 'a', T0 + 300000);
  eq(rec.source.adapter, 'modbus-rtu', 'adapter'); eq(rec.meters.a.mwh, 8333, '100.0 W for 300 s');
  const frame = Buffer.concat([PZEM_DOC_REPLY, Buffer.alloc(2)]); frame.writeUInt16LE(modbus.crc16(PZEM_DOC_REPLY), PZEM_DOC_REPLY.length);
  eq(rec.source.raw_sha256, crypto.createHash('sha256').update(frame).digest('hex'), 'raw_sha256 = SHA-256 of the reply frame');
});

test('raw_sha256 is recomputable from the input alone: a CSV line once per meter it feeds, an HTTP /samples body once per sample', async () => {
  const fs = require('fs'), os = require('os'), crypto = require('crypto');
  const digest = (parts) => { const h = crypto.createHash('sha256'); parts.forEach((p) => h.update(p)); return h.digest('hex'); };
  const inside = (r, ts) => ts >= Date.parse(r.ts_start) && ts < Date.parse(r.ts_end);
  const file = path.join(os.tmpdir(), `qwatt-raw-${process.pid}.csv`);
  const lines = ['ts,a_w,b_w'];
  for (let s = 0; s < 900; s += 10) lines.push(`${new Date(T0 + s * 1000).toISOString()},${100 + (s % 7)},${s >= 400 && s < 500 ? '' : 99 + (s % 5)}`);   // B blank 400–490 s: no sample, so not hashed for B
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const cb = mk(); const fromCsv = []; cb.onInterval = (r) => fromCsv.push(r);
  await csv.replay({ file, ts_column: 'ts', meters: { a: { power_w: 'a_w' }, b: { power_w: 'b_w' } }, pace: 'fast' }, cb);
  fs.unlinkSync(file);
  eq(fromCsv.length, 3, 'three CSV intervals');
  for (const r of fromCsv) {
    const mine = lines.slice(1).filter((l) => inside(r, Date.parse(l.split(',')[0])));
    eq(r.source.raw_sha256, digest(mine.flatMap((l) => (l.endsWith(',') ? [l + '\n'] : [l + '\n', l + '\n']))), `CSV ${r.ts_start}`);
  }
  const fromHttp = [];
  const srv = await httpAdapter.start({ port: 0 }, mk(), (r) => fromHttp.push(r));
  const bodies = [];
  for (let s = 0; s < 630; s += 90) {   // 90 s per request, so some requests straddle an interval boundary
    const list = [];
    for (let t = s; t < s + 90; t += 10) list.push({ meter: 'a', ts: T0 + t * 1000, power_w: 100 }, { meter: 'b', ts: T0 + t * 1000, power_w: 99 });
    bodies.push({ list, raw: Buffer.from(JSON.stringify(list)) });
    eq((await httpAdapter.post(srv.port, '/samples', list)).status, 200, 'pushed');
  }
  await httpAdapter.post(srv.port, '/flush', {});
  await srv.close();
  eq(fromHttp.length, 3, 'three HTTP intervals');
  for (const r of fromHttp) {
    eq(r.source.raw_sha256, digest(bodies.flatMap(({ list, raw }) => list.filter((x) => inside(r, x.ts)).map(() => raw))), `HTTP ${r.ts_start}`);
  }
});

test('HTTP: GET /health answers ok with the next sequence number', async () => {
  const b = mk1();
  const srv = await httpAdapter.start({ port: 0 }, b);
  await httpAdapter.post(srv.port, '/samples', [{ meter: 'a', ts: T0, power_w: 100 }, { meter: 'a', ts: T0 + 300000, power_w: 100 }]);
  const health = await new Promise((resolve, reject) => require('http').get({ host: '127.0.0.1', port: srv.port, path: '/health' }, (res) => {
    let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s) }));
  }).on('error', reject));
  await srv.close();
  eq(health.status, 200, 'status'); eq(health.body.ok, true, 'ok'); eq(health.body.seq, 1, 'one interval closed, next seq 1');
});

test('CSV: a pace factor waits the scaled gap between rows; fast pace does not wait', async () => {
  const fs = require('fs'), os = require('os');
  const file = path.join(os.tmpdir(), `qwatt-pace-${process.pid}.csv`);
  const lines = ['ts,a_w'];
  for (let s = 0; s <= 540; s += 60) lines.push(`${new Date(T0 + s * 1000).toISOString()},100`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const time = async (pace) => { const t = Date.now(); await csv.replay({ file, ts_column: 'ts', meters: { a: { power_w: 'a_w' } }, pace }, mk1()); return Date.now() - t; };
  const paced = await time(1000), fast = await time('fast');
  fs.unlinkSync(file);
  assert(paced >= 450, `540 s of data at ×1000 waits about 540 ms (${paced} ms)`);
  assert(fast < paced, `fast pace is faster (${fast} ms vs ${paced} ms)`);
});

/** Run ingest/cli.js as a host would and collect the interval lines it prints. `done(records, stderr)` ends a
    long-running adapter (http, modbus) by killing it; csv exits on its own after its flush. */
function runCli(args, { done, onStderr } = {}) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'cli.js'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const recs = () => out.split('\n').slice(0, -1).map((l) => JSON.parse(l));   // complete lines only
    const timer = setTimeout(() => { p.kill(); reject(new Error(`ingest/cli.js ${args[0]} timed out; stderr: ${err.trim()}`)); }, 20000);
    p.stdout.on('data', (d) => { out += d; if (done && done(recs())) p.kill(); });
    p.stderr.on('data', (d) => { err += d; if (onStderr) onStderr(err); });
    p.on('exit', (code) => { clearTimeout(timer); resolve({ code, recs: recs(), err }); });
  });
}

test('V3-6: ingest/cli.js stamps clock_skew_s on every adapter it starts (csv fast and real time, http, modbus)', async () => {
  const fs = require('fs'), os = require('os');
  const file = path.join(os.tmpdir(), `qwatt-cli-${process.pid}.csv`);
  const within = (r, lo, hi, w) => assert(Number.isInteger(r.clock_skew_s) && r.clock_skew_s >= Math.floor(lo / 1000) - 1 && r.clock_skew_s <= Math.ceil(hi / 1000) + 1,
    `${w}: clock_skew_s ${r.clock_skew_s} outside [${Math.floor(lo / 1000) - 1}, ${Math.ceil(hi / 1000) + 1}]`);
  /* csv, fast pace: the replay clock */
  const rows = ['ts,a_w,b_w'];
  for (let s = 0; s <= 600; s += 10) rows.push(`${new Date(T0 + s * 1000).toISOString()},100,99`);
  fs.writeFileSync(file, rows.join('\n') + '\n');
  const fast = await runCli(['csv', '--file', file, '--a', 'a_w', '--b', 'b_w', '--pace', 'fast']);
  eq(fast.code, 0, `csv exit (${fast.err.trim()})`);
  eq(fast.recs.map((r) => r.clock_skew_s).join(','), '0,0,-300', 'csv fast: closed at each end, then flushed five minutes early');
  eq(fast.recs.map((r) => r.meters.a.mwh).join(','), '8333,8333,0', 'csv fast: 100 W integrated');
  /* csv, real-time pace: the wall clock (rows 10 ms apart, received now, weeks after they were measured) */
  fs.writeFileSync(file, ['ts,a_w,b_w', ...[299980, 299990, 300000].map((d) => `${new Date(T0 + d).toISOString()},100,99`)].join('\n') + '\n');
  const t1 = Date.now();
  const real = await runCli(['csv', '--file', file, '--a', 'a_w', '--b', 'b_w', '--pace', 'realtime']);
  const t2 = Date.now();
  /* csv, --pace 1: a factor of one is real time, so the wall clock too */
  const t3 = Date.now();
  const one = await runCli(['csv', '--file', file, '--a', 'a_w', '--b', 'b_w', '--pace', '1']);
  const t4 = Date.now();
  fs.unlinkSync(file);
  eq(real.code, 0, `csv realtime exit (${real.err.trim()})`);
  eq(real.recs.length, 2, 'csv realtime: one closed, one flushed');
  within(real.recs[0], t1 - (T0 + 300000), t2 - (T0 + 300000), 'csv realtime');
  eq(one.code, 0, `csv --pace 1 exit (${one.err.trim()})`);
  eq(one.recs.length, 2, 'csv --pace 1: one closed, one flushed');
  within(one.recs[0], t3 - (T0 + 300000), t4 - (T0 + 300000), 'csv --pace 1');
  /* http /samples: the wall clock against the node's timestamps */
  let posted = 0;
  const http = await runCli(['http', '--port', '0'], {
    onStderr: (err) => {
      const m = /listening on (\d+)/.exec(err);
      if (m && !posted) {
        posted = Date.now();
        httpAdapter.post(Number(m[1]), '/samples', ['a', 'b', 'a', 'b'].map((meter, i) => ({ meter, ts: T0 + (i >> 1) * 300000, power_w: 100 })))
          .catch(() => {});   // the gateway may be stopped before it answers: the printed interval is what counts
      }
    },
    done: (recs) => recs.length >= 1,
  });
  eq(http.recs.length, 1, 'http: one interval closed');
  within(http.recs[0], posted - (T0 + 300000), Date.now() - (T0 + 300000), 'http /samples');
  /* modbus: the gateway clock at poll time (one-second intervals, so the test is short) */
  const pzem = RM.load('pzem-017');
  const sim = await modbus.createSimulator({ provider: (uid, fc, addr, count) => {
    const block = RM.encode(pzem, { voltage_v: 100, current_a: 1, power_w: 100, energy_wh: 0, alarm_high: 0, alarm_low: 0 }).find((blk) => addr >= blk.address && addr + count <= blk.address + blk.regs.length);
    if (!block) throw Object.assign(new Error('address'), { code: 2 });
    return block.regs.slice(addr - block.address, addr - block.address + count);
  } });
  let mb;
  try { mb = await runCli(['modbus', '--a', `pzem-017@127.0.0.1:${sim.port}`, '--dt', '1', '--poll', '200'], { done: (recs) => recs.length >= 2 }); } finally { await sim.close(); }
  assert(mb.recs.length >= 2, `modbus: intervals closed (${mb.err.trim()})`);
  for (const r of mb.recs) assert(Number.isInteger(r.clock_skew_s) && Math.abs(r.clock_skew_s) <= 2, `modbus: closed by a poll just after its end (clock_skew_s ${r.clock_skew_s})`);
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
