/**
 * QWATT ingest — Modbus adapter (TCP, and RTU when `serialport` is installed)
 * ---------------------------------------------------------------------------
 * Polls one device described by a register map, decodes the fields and pushes
 * samples into an IntervalBuilder. The register map is the only thing that
 * differs between meters. Also ships a Modbus TCP *simulator* so the adapter
 * can be tested end-to-end in CI with no hardware.
 *
 * Usage (see cli.js):
 *   const { ModbusTcp, pollOnce, start } = require('./adapters/modbus');
 *   const client = new ModbusTcp({ host, port });  await client.connect();
 *   await pollOnce(client, map, builder, 'a', Date.now());
 *
 * No dependencies for TCP. RTU requires `npm i serialport` on the gateway.
 */

'use strict';

const net = require('net');
const RM = require('../lib/registermap');

/* ───────────────────────── framing helpers ───────────────────────── */

function crc16(buf) {
  let crc = 0xffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xa001) : (crc >>> 1);
  }
  return crc;
}

const EXCEPTIONS = { 1: 'illegal function', 2: 'illegal data address', 3: 'illegal data value', 4: 'server device failure', 6: 'server busy' };

/* ───────────────────────────── TCP client ────────────────────────── */

class ModbusTcp {
  constructor({ host, port = 502, timeoutMs = 3000 }) {
    this.host = host; this.port = port; this.timeoutMs = timeoutMs;
    this.sock = null; this.buf = Buffer.alloc(0); this.tid = 0; this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const s = net.connect({ host: this.host, port: this.port });
      s.setNoDelay(true);
      s.once('connect', () => { this.sock = s; resolve(this); });
      s.once('error', (e) => { if (!this.sock) reject(e); else for (const p of this.pending.values()) p.reject(e); });
      s.on('close', () => { this.sock = null; for (const p of this.pending.values()) p.reject(new Error('Modbus TCP: connection closed')); this.pending.clear(); });
      s.on('data', (d) => this._onData(d));
    });
  }

  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 6) {
      const len = this.buf.readUInt16BE(4);
      if (this.buf.length < 6 + len) return;
      const frame = this.buf.subarray(0, 6 + len);
      this.buf = this.buf.subarray(6 + len);
      const tid = frame.readUInt16BE(0);
      const p = this.pending.get(tid);
      if (!p) continue;
      this.pending.delete(tid);
      clearTimeout(p.timer);
      const fc = frame[7];
      if (fc & 0x80) { p.reject(new Error(`Modbus exception ${frame[8]} (${EXCEPTIONS[frame[8]] || '?'})`)); continue; }
      const n = frame[8];
      const regs = [];
      for (let i = 0; i < n / 2; i++) regs.push(frame.readUInt16BE(9 + i * 2));
      p.resolve({ regs, raw: Buffer.from(frame) });
    }
  }

  /** Read `count` registers with function 3 or 4. Resolves { regs, raw }. */
  read(unitId, fc, address, count) {
    if (!this.sock) return Promise.reject(new Error('Modbus TCP: not connected'));
    const tid = (this.tid = (this.tid + 1) & 0xffff);
    const req = Buffer.alloc(12);
    req.writeUInt16BE(tid, 0); req.writeUInt16BE(0, 2); req.writeUInt16BE(6, 4); req[6] = unitId;
    req[7] = fc; req.writeUInt16BE(address, 8); req.writeUInt16BE(count, 10);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(tid); reject(new Error(`Modbus timeout: no reply from ${this.host}:${this.port}`)); }, this.timeoutMs);
      this.pending.set(tid, { resolve, reject, timer });
      this.sock.write(req);
    });
  }

  close() { if (this.sock) this.sock.destroy(); this.sock = null; }
}

/* ───────────────────────────── RTU client ────────────────────────── */

/** RTU over a serial port. Requires the `serialport` package on the gateway. Untested without hardware. */
class ModbusRtu {
  constructor({ path, baud = 9600, dataBits = 8, parity = 'none', stopBits = 1, timeoutMs = 1000 }) {
    Object.assign(this, { path, baud, dataBits, parity, stopBits, timeoutMs });
    this.port = null; this.queue = Promise.resolve();
  }

  async connect() {
    let SerialPort;
    try { ({ SerialPort } = require('serialport')); }
    catch (e) { throw new Error('Modbus RTU needs the `serialport` package (npm i serialport), or use an RTU-over-TCP gateway with the tcp transport'); }
    const p = { none: 'none', N: 'none', even: 'even', E: 'even', odd: 'odd', O: 'odd' }[this.parity] || 'none';
    this.port = new SerialPort({ path: this.path, baudRate: this.baud, dataBits: this.dataBits, parity: p, stopBits: this.stopBits, autoOpen: false });
    await new Promise((res, rej) => this.port.open((e) => (e ? rej(e) : res())));
    return this;
  }

  read(unitId, fc, address, count) {
    const run = () => new Promise((resolve, reject) => {
      const req = Buffer.alloc(8);
      req[0] = unitId; req[1] = fc; req.writeUInt16BE(address, 2); req.writeUInt16BE(count, 4);
      req.writeUInt16LE(crc16(req.subarray(0, 6)), 6);
      const want = 5 + count * 2;
      let acc = Buffer.alloc(0);
      const done = (err, val) => { clearTimeout(timer); this.port.off('data', onData); err ? reject(err) : resolve(val); };
      const onData = (d) => {
        acc = Buffer.concat([acc, d]);
        if (acc.length >= 5 && (acc[1] & 0x80)) return done(new Error(`Modbus exception ${acc[2]} (${EXCEPTIONS[acc[2]] || '?'})`));
        if (acc.length < want) return;
        const frame = acc.subarray(0, want);
        if (crc16(frame.subarray(0, want - 2)) !== frame.readUInt16LE(want - 2)) return done(new Error('Modbus RTU: CRC mismatch'));
        const regs = [];
        for (let i = 0; i < count; i++) regs.push(frame.readUInt16BE(3 + i * 2));
        done(null, { regs, raw: Buffer.from(frame) });
      };
      const timer = setTimeout(() => done(new Error(`Modbus RTU timeout on ${this.path}`)), this.timeoutMs);
      this.port.on('data', onData);
      this.port.write(req);
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  close() { if (this.port && this.port.isOpen) this.port.close(); }
}

/* ───────────────────────────── polling ───────────────────────────── */

/**
 * One poll of one device: read every block of the map, decode, push one sample.
 * `tsMs` is injected so replays and tests are deterministic.
 * @returns {Array} interval records closed by this sample
 */
async function pollOnce(client, map, builder, meterKey, tsMs) {
  const reads = [];
  const raws = [];
  for (const b of RM.blocks(map)) {
    const r = await client.read(map.protocol.unit_id, map.protocol.function, b.address, b.count);
    reads.push({ address: b.address, regs: r.regs });
    raws.push(r.raw);
  }
  const v = RM.decode(map, reads);
  const sample = { ts: tsMs, power_w: v[map.power_field || 'power_w'] };
  const cf = map.counter_field || 'energy_wh';
  if (v[cf] != null) sample.energy_wh = v[cf];
  return builder.push(meterKey, sample, Buffer.concat(raws));
}

/**
 * Continuous polling. config = { transport:'tcp'|'rtu', host, port, serial:{path,...}, map, meter, poll_ms }
 * Emits closed intervals through builder.onInterval. Returns { stop }.
 */
async function start(config, builder, log = () => {}) {
  const map = typeof config.map === 'string' ? RM.load(config.map) : config.map;
  const client = config.transport === 'rtu'
    ? new ModbusRtu(Object.assign({ path: config.serial && config.serial.path }, mapSerial(map), config.serial || {}))
    : new ModbusTcp({ host: config.host, port: config.port || 502, timeoutMs: config.timeout_ms });
  await client.connect();
  let running = true, failures = 0;
  const tick = async () => {
    if (!running) return;
    try { await pollOnce(client, map, builder, config.meter || 'a', Date.now()); failures = 0; }
    catch (e) { failures++; log(`poll error (${failures}): ${e.message}`); if (failures >= 5 && client.connect) { try { client.close(); await client.connect(); failures = 0; } catch (_) {} } }
    if (running) setTimeout(tick, config.poll_ms || 5000);
  };
  tick();
  return { stop() { running = false; client.close(); } };
}

function mapSerial(map) {
  const s = (map.protocol && map.protocol.serial) || {};
  return { baud: s.baud, dataBits: s.data_bits, parity: s.parity, stopBits: s.stop_bits };
}

/* ───────────────────────────── simulator ─────────────────────────── */

/**
 * Minimal Modbus TCP server for tests and the harness.
 * provider(unitId, fc, address, count) → number[] (length count) — or throw to answer exception 2.
 * Resolves { port, close }.
 */
function createSimulator({ port = 0, provider }) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 6) {
          const len = buf.readUInt16BE(4);
          if (buf.length < 6 + len) return;
          const frame = buf.subarray(0, 6 + len);
          buf = buf.subarray(6 + len);
          const tid = frame.readUInt16BE(0), uid = frame[6], fc = frame[7];
          const addr = frame.readUInt16BE(8), count = frame.readUInt16BE(10);
          let res;
          try {
            if (fc !== 3 && fc !== 4) throw Object.assign(new Error('illegal function'), { code: 1 });
            const regs = provider(uid, fc, addr, count);
            if (!Array.isArray(regs) || regs.length !== count) throw Object.assign(new Error('bad provider'), { code: 2 });
            res = Buffer.alloc(9 + count * 2);
            res.writeUInt16BE(tid, 0); res.writeUInt16BE(0, 2); res.writeUInt16BE(3 + count * 2, 4); res[6] = uid; res[7] = fc; res[8] = count * 2;
            regs.forEach((r, i) => res.writeUInt16BE(r & 0xffff, 9 + i * 2));
          } catch (e) {
            res = Buffer.alloc(9);
            res.writeUInt16BE(tid, 0); res.writeUInt16BE(0, 2); res.writeUInt16BE(3, 4); res[6] = uid; res[7] = fc | 0x80; res[8] = e.code || 2;
          }
          sock.write(res);
        }
      });
      sock.on('error', () => {});
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
  });
}

module.exports = { ModbusTcp, ModbusRtu, pollOnce, start, createSimulator, crc16 };
