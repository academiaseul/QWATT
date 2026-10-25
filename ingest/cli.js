#!/usr/bin/env node
/**
 * QWATT ingest — command line
 * ---------------------------------------------------------------------------
 * Runs one adapter and prints every closed interval as one JSON line on stdout,
 * so the output can be piped into the gateway (week 2) or into a file.
 *
 *   node ingest/cli.js modbus --a pzem-017@192.168.1.50:502 --b epever-tracer@192.168.1.51:502
 *   node ingest/cli.js modbus --a pzem-017@rtu:COM3 --b epever-tracer@rtu:COM4
 *   node ingest/cli.js csv --file day.csv --a a_w --b b_w [--ts ts] [--pace fast|realtime|60] [--sample-s 10]
 *   node ingest/cli.js http --port 8080 [--sample-s 10]
 *
 * Common: --site bench-santiago --node <id> --dt 300 --poll 5000 --seq0 0
 *
 * Sample period (V3-10): no energy is interpolated across a gap longer than three
 * sample periods. modbus takes it from --poll (ms); csv and http from --sample-s
 * (seconds, default 10): pass the input's real cadence, e.g. --sample-s 60 for
 * one-minute data, or every gap between its samples is treated as a dropout.
 * csv and http say so once on stderr, at the first gap longer than three periods
 * (the rule itself is the builder's and is unchanged).
 *
 * clock_skew_s (V3-6): modbus and http stamp it from this host's clock; csv at
 * real-time pace from this host's clock, and at fast or factor pace from the
 * replay clock (the latest sample timestamp read).
 */

'use strict';

const RM = require('./lib/registermap');
const { IntervalBuilder } = require('./lib/normalize');
const modbus = require('./adapters/modbus');
const csv = require('./adapters/csv');
const httpAdapter = require('./adapters/http');

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const log = (m) => process.stderr.write(`[ingest] ${m}\n`);

/** One stderr warning, the first time two consecutive samples of a meter are more than three sample periods
    apart (V3-10): nothing is integrated across such a gap, so input sparser than --sample-s says would count
    no energy without a word. The builder's rule is unchanged; this only reports it. */
function warnOnGaps(builder) {
  const push = builder.push.bind(builder), last = {};
  let warned = false;
  builder.push = (meter, sample, raw) => {
    const ts = sample != null ? sample.ts : NaN;
    if (!warned && Number.isFinite(ts) && last[meter] != null && ts - last[meter] > builder.maxGapMs) {
      warned = true;
      log(`warning: meter ${meter}: a gap of ${(ts - last[meter]) / 1000} s between samples is longer than 3 × --sample-s (${builder.sample_s} s), so no energy is counted across it; pass the input's cadence with --sample-s (said once)`);
    }
    if (Number.isFinite(ts)) last[meter] = ts;
    return push(meter, sample, raw);
  };
  return builder;
}

function parseDevice(spec) {
  // <map>@<host>[:<port>]  |  <map>@rtu:<serial path>
  const m = /^([^@]+)@(.+)$/.exec(spec || '');
  if (!m) throw new Error('device spec must be <map>@<host>[:port] or <map>@rtu:<path>: ' + spec);
  const map = RM.load(m[1]);
  if (m[2].startsWith('rtu:')) return { transport: 'rtu', map, serial: { path: m[2].slice(4) } };
  const [host, port] = m[2].split(':');
  return { transport: 'tcp', map, host, port: port ? Number(port) : 502 };
}

async function main() {
  if (!['modbus', 'csv', 'http'].includes(cmd)) { console.error('usage: node ingest/cli.js modbus|csv|http [options]'); process.exit(2); }
  const dt_s = Number(opt('dt', 300));
  const emit = (r) => process.stdout.write(JSON.stringify(r) + '\n');
  const meters = {};

  if (cmd === 'modbus') {
    const devs = {};
    for (const k of ['a', 'b']) if (opt(k)) { devs[k] = parseDevice(opt(k)); meters[k] = { id: `${devs[k].map.name}:${devs[k].map.protocol.unit_id}`, class: devs[k].map.class, energy: devs[k].map.energy }; }
    if (!devs.a) throw new Error('--a <map>@<host> is required');
    const builder = new IntervalBuilder({ site_id: opt('site', 'bench-santiago'), node_id: opt('node', 'cli'), adapter: devs.a.transport === 'rtu' ? 'modbus-rtu' : 'modbus-tcp', register_map: Object.values(devs).map((d) => `${d.map.name}@${d.map.protocol.unit_id}`).join('+'), dt_s, seq0: Number(opt('seq0', 0)), meters, onInterval: emit, clock: () => Date.now(), sample_s: Number(opt('poll', 5000)) / 1000 });
    const handles = [];
    for (const [k, d] of Object.entries(devs)) {
      log(`polling ${k}: ${d.map.name} via ${d.transport} ${d.host || d.serial.path}`);
      handles.push(await modbus.start(Object.assign({ meter: k, poll_ms: Number(opt('poll', 5000)) }, d), builder, log));
    }
    const stop = () => { handles.forEach((h) => h.stop()); builder.flush(); process.exit(0); };   // flush delivers through onInterval
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  }

  if (cmd === 'csv') {
    for (const k of ['a', 'b']) if (opt(k)) meters[k] = { id: `csv:${opt(k)}`, class: opt(k + '-class', 'dc'), energy: 'integrate' };
    if (!opt('file') || !meters.a) throw new Error('--file and --a <power column> are required');
    const cfg = { file: opt('file'), ts_column: opt('ts', 'ts'), meters: {}, pace: opt('pace', 'fast') };
    if (/^\d+$/.test(cfg.pace)) cfg.pace = Number(cfg.pace);
    const builder = new IntervalBuilder({ site_id: opt('site', 'bench-santiago'), node_id: opt('node', 'cli'), adapter: 'csv', dt_s, seq0: Number(opt('seq0', 0)), meters, onInterval: emit,
      clock: cfg.pace === 'realtime' || cfg.pace === 1 ? () => Date.now() : 'replay', sample_s: Number(opt('sample-s', 10)) });
    for (const k of Object.keys(meters)) cfg.meters[k] = { power_w: opt(k), energy_wh: opt(k + '-wh') };
    const r = await csv.replay(cfg, warnOnGaps(builder));
    log(`replayed ${r.rows} rows → ${r.intervals} intervals`);
  }

  if (cmd === 'http') {
    meters.a = { id: 'http:a', class: opt('a-class', 'dc'), energy: 'integrate' };
    meters.b = { id: 'http:b', class: opt('b-class', 'dc'), energy: 'integrate' };
    const builder = new IntervalBuilder({ site_id: opt('site', 'bench-santiago'), node_id: opt('node', 'cli'), adapter: 'http-json', dt_s, seq0: Number(opt('seq0', 0)), meters, clock: () => Date.now(), sample_s: Number(opt('sample-s', 10)) });
    const srv = await httpAdapter.start({ port: Number(opt('port', 8080)), host: opt('host', '127.0.0.1') }, warnOnGaps(builder), emit);
    log(`listening on ${srv.port} — POST /samples, POST /intervals, POST /flush, GET /health`);
  }
}

main().catch((e) => { log(e.message); process.exit(1); });
