/**
 * QWATT ingest — Deliverable 1 acceptance harness
 * ---------------------------------------------------------------------------
 * The SOW's acceptance test for meter-agnostic ingestion:
 *
 *   "the same input, delivered through all three adapters, produces
 *    byte-identical verification output"
 *
 * One synthetic two-hour solar morning on the bench (two DC meters, 10 s
 * samples) is delivered three ways — a CSV file replayed, HTTP pushes, and a
 * Modbus TCP simulator polled through the PZEM-017 and EPEver register maps —
 * and the resulting interval records must be byte-identical once the `source`
 * block (adapter name and raw-payload hash, which differ by construction) is
 * removed. The gate engine's verdict and mint for every interval must match too.
 *
 * Run: node ingest/harness.js        (exit 1 on any difference)
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { IntervalBuilder, canonical } = require('./lib/normalize');
const RM = require('./lib/registermap');
const modbus = require('./adapters/modbus');
const csv = require('./adapters/csv');
const httpAdapter = require('./adapters/http');
const G = require(path.join(__dirname, '..', 'assets', 'qwatt-gates.js'));
const SPEC = require(path.join(__dirname, '..', 'assets', 'gates.generated.js'));

/* ─────────────────────── deterministic synthetic day ─────────────────────── */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2 h from 15:00Z (12:00 Santiago) at 10 s; A quantized to 0.1 W (PZEM), B to 0.01 W (EPEver). */
function synthDay() {
  const rnd = mulberry32(20260920);
  const t0 = Date.parse('2026-09-20T15:00:00Z');
  const out = [];
  let ea = 0, eb = 0;
  for (let i = 0; i < 720; i++) {
    const ts = t0 + i * 10000;
    const x = i / 720;
    const cloud = 1 - 0.35 * Math.max(0, Math.sin(x * 9 * Math.PI)) * (rnd() > 0.7 ? 1 : 0.2);
    const base = 118 + 18 * Math.sin(x * Math.PI);                  // ~118–136 W, under the 150 Wp
    const a = Math.round((base * cloud + (rnd() - 0.5) * 4) * 10) / 10;
    const b = Math.round((a * 0.985 + (rnd() - 0.5) * 0.3) * 100) / 100;
    ea += a * 10 / 3600; eb += b * 10 / 3600;
    out.push({ ts, a: Math.max(0, a), b: Math.max(0, b), ea: Math.floor(ea), eb: Math.floor(eb / 10) * 10 });
  }
  return out;
}

const mkBuilder = (adapter, register_map) => new IntervalBuilder({
  site_id: 'bench-santiago', node_id: 'harness', adapter, register_map, dt_s: 300,
  meters: { a: { id: 'pzem-017:1', class: 'dc', energy: 'integrate' }, b: { id: 'epever-tracer:2', class: 'dc', energy: 'integrate' } },
});

/* ───────────────────────────── three paths ───────────────────────────── */

async function viaCsv(samples) {
  const file = path.join(os.tmpdir(), 'qwatt-harness-' + process.pid + '.csv');
  const lines = ['ts,a_w,a_wh,b_w,b_wh'];
  for (const s of samples) lines.push(`${new Date(s.ts).toISOString()},${s.a.toFixed(1)},${s.ea},${s.b.toFixed(2)},${s.eb}`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const out = [];
  const b = mkBuilder('csv');
  b.onInterval = (r) => out.push(r);
  await csv.replay({ file, ts_column: 'ts', meters: { a: { power_w: 'a_w', energy_wh: 'a_wh' }, b: { power_w: 'b_w', energy_wh: 'b_wh' } }, pace: 'fast' }, b);
  fs.unlinkSync(file);
  return out;
}

async function viaHttp(samples) {
  const out = [];
  const b = mkBuilder('http-json');
  const srv = await httpAdapter.start({ port: 0 }, b, (r) => out.push(r));
  for (let i = 0; i < samples.length; i += 60) {
    const chunk = [];
    for (const s of samples.slice(i, i + 60)) {
      chunk.push({ meter: 'a', ts: s.ts, power_w: s.a, energy_wh: s.ea });
      chunk.push({ meter: 'b', ts: s.ts, power_w: s.b, energy_wh: s.eb });
    }
    const r = await httpAdapter.post(srv.port, '/samples', chunk);
    if (r.status !== 200) throw new Error('http push failed: ' + JSON.stringify(r.body));
  }
  await httpAdapter.post(srv.port, '/flush', {});
  await srv.close();
  return out;
}

async function viaModbus(samples) {
  const pzem = RM.load('pzem-017'), epever = RM.load('epever-tracer');
  epever.protocol.unit_id = 2;                        // two devices on one simulated bus
  let cur = samples[0];
  const provider = (uid, fc, addr, count) => {
    const map = uid === 1 ? pzem : epever;
    const vals = uid === 1
      ? { voltage_v: 18.2, current_a: cur.a / 18.2, power_w: cur.a, energy_wh: cur.ea, alarm_high: 0, alarm_low: 0 }
      : { voltage_v: 18.2, current_a: cur.b / 18.2, power_w: cur.b, battery_voltage_v: 12.8, battery_current_a: 0, energy_today_wh: cur.eb, energy_total_wh: cur.eb };
    const block = RM.encode(map, vals).find((blk) => addr >= blk.address && addr + count <= blk.address + blk.regs.length);
    if (!block) throw Object.assign(new Error('address'), { code: 2 });
    return block.regs.slice(addr - block.address, addr - block.address + count);
  };
  const sim = await modbus.createSimulator({ provider });
  const client = new modbus.ModbusTcp({ host: '127.0.0.1', port: sim.port });
  await client.connect();
  const out = [];
  const b = mkBuilder('modbus-tcp', 'pzem-017@1+epever-tracer@2');
  b.onInterval = (r) => out.push(r);
  for (const s of samples) {
    cur = s;
    await modbus.pollOnce(client, pzem, b, 'a', s.ts);
    await modbus.pollOnce(client, epever, b, 'b', s.ts);
  }
  b.flush();
  client.close();
  await sim.close();
  return out;
}

/* ───────────────────────────── comparison ───────────────────────────── */

const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.source; return canonical(c); };

async function run() {
  const samples = synthDay();
  const [A, B, C] = await Promise.all([viaCsv(samples), viaHttp(samples), viaModbus(samples)]);
  const n = A.length;
  let diffs = 0;
  if (B.length !== n || C.length !== n) { console.error(`interval counts differ: csv ${n}, http ${B.length}, modbus ${C.length}`); diffs++; }
  for (let i = 0; i < Math.min(n, B.length, C.length); i++) {
    const a = strip(A[i]), b = strip(B[i]), c = strip(C[i]);
    if (a !== b || a !== c) { diffs++; console.error(`interval ${i}: records differ\n  csv    ${a}\n  http   ${b}\n  modbus ${c}`); continue; }
    const va = G.evaluateInterval(A[i], SPEC.profiles.bench, SPEC), vb = G.evaluateInterval(B[i], SPEC.profiles.bench, SPEC), vc = G.evaluateInterval(C[i], SPEC.profiles.bench, SPEC);
    const key = (v) => v.verdict + '|' + (v.mint ? v.mint.qwatt_str : '-') + '|' + v.failures.map((f) => f.id).join(',');
    if (key(va) !== key(vb) || key(va) !== key(vc)) { diffs++; console.error(`interval ${i}: verdicts differ ${key(va)} ${key(vb)} ${key(vc)}`); }
  }
  const accepted = A.filter((r) => G.evaluateInterval(r, SPEC.profiles.bench, SPEC).verdict === 'accept').length;
  const energy = A.reduce((s, r) => s + Math.min(r.meters.a.mwh, r.meters.b.mwh), 0);
  console.log(`harness: ${samples.length} samples × 2 meters → ${n} intervals per path · ${accepted}/${n} accepted · ${(energy / 1000).toFixed(1)} Wh basis · ${diffs === 0 ? 'BYTE-IDENTICAL across csv, http, modbus' : diffs + ' DIFFERENCES'}`);
  return diffs;
}

if (require.main === module) {
  run().then((d) => process.exit(d ? 1 : 0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run, synthDay };
