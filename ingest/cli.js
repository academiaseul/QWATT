#!/usr/bin/env node
/**
 * QWATT ingest — command line
 * ---------------------------------------------------------------------------
 * Runs one adapter and prints every closed interval as one JSON line on stdout,
 * so the output can be piped into the gateway (week 2) or into a file.
 *
 *   node ingest/cli.js modbus --a pzem-017@192.168.1.50:502 --b epever-tracer@192.168.1.51:502
 *   node ingest/cli.js modbus --a pzem-017@rtu:COM3 --b epever-tracer@rtu:COM4
 *   node ingest/cli.js csv --file day.csv --a a_w --b b_w [--ts ts] [--pace fast|realtime|60]
 *   node ingest/cli.js http --port 8080
 *
 * Common: --site bench-santiago --node <id> --dt 300 --poll 5000 --seq0 0
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
    const builder = new IntervalBuilder({ site_id: opt('site', 'bench-santiago'), node_id: opt('node', 'cli'), adapter: devs.a.transport === 'rtu' ? 'modbus-rtu' : 'modbus-tcp', register_map: Object.values(devs).map((d) => `${d.map.name}@${d.map.protocol.unit_id}`).join('+'), dt_s, seq0: Number(opt('seq0', 0)), meters, onInterval: emit });
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
    const builder = new IntervalBuilder({ site_id: opt('site', 'bench-santiago'), node_id: opt('node', 'cli'), adapter: 'csv', dt_s, seq0: Number(opt('seq0', 0)), meters, onInterval: emit });
    const cfg = { file: opt('file'), ts_column: opt('ts', 'ts'), meters: {}, pace: opt('pace', 'fast') };
    if (/^\d+$/.test(cfg.pace)) cfg.pace = Number(cfg.pace);
    for (const k of Object.keys(meters)) cfg.meters[k] = { power_w: opt(k), energy_wh: opt(k + '-wh') };
    const r = await csv.replay(cfg, builder);
    log(`replayed ${r.rows} rows → ${r.intervals} intervals`);
  }

  if (cmd === 'http') {
    meters.a = { id: 'http:a', class: opt('a-class', 'dc'), energy: 'integrate' };
    meters.b = { id: 'http:b', class: opt('b-class', 'dc'), energy: 'integrate' };
    const builder = new IntervalBuilder({ site_id: opt('site', 'bench-santiago'), node_id: opt('node', 'cli'), adapter: 'http-json', dt_s, seq0: Number(opt('seq0', 0)), meters });
    const srv = await httpAdapter.start({ port: Number(opt('port', 8080)), host: opt('host', '127.0.0.1') }, builder, emit);
    log(`listening on ${srv.port} — POST /samples, POST /intervals, POST /flush, GET /health`);
  }
}

main().catch((e) => { log(e.message); process.exit(1); });
