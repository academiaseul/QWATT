/**
 * QWATT ingest — register maps
 * ---------------------------------------------------------------------------
 * A register map is a JSON file (ingest/maps/*.json) that describes how to read
 * one Modbus device: which unit id, which function code, which serial settings,
 * and for each field where it lives and how to decode it. Supporting a new
 * meter means adding a file here — the adapter and the engine never change.
 *
 *   {
 *     "name": "pzem-017", "version": 1, "class": "dc",
 *     "protocol": { "unit_id": 1, "function": 4,
 *                   "serial": { "baud": 9600, "data_bits": 8, "parity": "N", "stop_bits": 2 } },
 *     "fields": {
 *       "voltage_v": { "address": 0, "words": 1, "type": "u16", "scale": 0.01 },
 *       "power_w":   { "address": 2, "words": 2, "type": "u32", "word_order": "lo_hi", "scale": 0.1 }
 *     },
 *     "energy": "integrate" | "counter",   // how interval energy is derived
 *     "power_field": "power_w", "counter_field": "energy_wh"
 *   }
 *
 * Types: u16 i16 u32 i32 f32. word_order: "hi_lo" (default, big-endian words)
 * or "lo_hi" (low word first — PZEM and EPEver do this).
 * No dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_BLOCK = 125;   // Modbus limit on registers per read

/** Load and validate a map by name (from ingest/maps) or by path. */
function load(nameOrPath) {
  const p = nameOrPath.endsWith('.json') ? nameOrPath : path.join(__dirname, '..', 'maps', nameOrPath + '.json');
  const map = JSON.parse(fs.readFileSync(p, 'utf8'));
  validate(map);
  return map;
}

function validate(map) {
  const need = (c, m) => { if (!c) throw new Error('register map ' + (map.name || '?') + ': ' + m); };
  need(typeof map.name === 'string' && map.name, 'name required');
  need(map.class === 'dc' || map.class === 'ac', 'class must be dc or ac');
  need(map.protocol && Number.isInteger(map.protocol.unit_id), 'protocol.unit_id required');
  need([3, 4].includes(map.protocol.function), 'protocol.function must be 3 (holding) or 4 (input)');
  need(map.fields && Object.keys(map.fields).length, 'fields required');
  for (const [k, f] of Object.entries(map.fields)) {
    need(Number.isInteger(f.address) && f.address >= 0, `field ${k}: address`);
    need(['u16', 'i16', 'u32', 'i32', 'f32'].includes(f.type), `field ${k}: type`);
    const words = f.type === 'u16' || f.type === 'i16' ? 1 : 2;
    need((f.words || words) === words, `field ${k}: ${f.type} is ${words} word(s)`);
    need(!f.word_order || ['hi_lo', 'lo_hi'].includes(f.word_order), `field ${k}: word_order`);
    need(f.scale == null || (typeof f.scale === 'number' && f.scale > 0), `field ${k}: scale`);
  }
  need(['integrate', 'counter'].includes(map.energy), 'energy must be "integrate" or "counter"');
  need(map.fields[map.power_field || 'power_w'], 'power_field must name a field');
  if (map.energy === 'counter') need(map.fields[map.counter_field || 'energy_wh'], 'counter_field must name a field');
}

function wordsOf(f) { return f.type === 'u16' || f.type === 'i16' ? 1 : 2; }

/** Contiguous read blocks covering every field, each ≤ 125 registers. */
function blocks(map) {
  const spans = Object.values(map.fields).map((f) => [f.address, f.address + wordsOf(f) - 1]).sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = null;
  for (const [lo, hi] of spans) {
    if (cur && hi - cur.address + 1 <= MAX_BLOCK) cur.count = Math.max(cur.count, hi - cur.address + 1);
    else { cur = { address: lo, count: hi - lo + 1 }; out.push(cur); }
  }
  return out;
}

/** Decode one field from a register array that starts at `base`. */
function decodeField(f, regs, base) {
  const i = f.address - base;
  if (i < 0 || i + wordsOf(f) > regs.length) throw new Error(`field at ${f.address} outside block starting ${base}`);
  const scale = f.scale == null ? 1 : f.scale;
  if (f.type === 'u16') return regs[i] * scale;
  if (f.type === 'i16') return ((regs[i] << 16) >> 16) * scale;
  const [w0, w1] = f.word_order === 'lo_hi' ? [regs[i + 1], regs[i]] : [regs[i], regs[i + 1]];   // w0 = high word
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(w0, 0); buf.writeUInt16BE(w1, 2);
  if (f.type === 'u32') return buf.readUInt32BE(0) * scale;
  if (f.type === 'i32') return buf.readInt32BE(0) * scale;
  return buf.readFloatBE(0) * scale;   // f32
}

/**
 * Decode every field of the map from a set of read blocks:
 * reads = [{ address, regs: number[] }]. Returns { field: value }.
 */
function decode(map, reads) {
  const out = {};
  for (const [name, f] of Object.entries(map.fields)) {
    const r = reads.find((x) => f.address >= x.address && f.address + wordsOf(f) <= x.address + x.regs.length);
    if (!r) throw new Error(`no read block covers field ${name} @${f.address}`);
    out[name] = decodeField(f, r.regs, r.address);
  }
  return out;
}

/** Inverse of decode, for simulators and tests: values → register words per block. */
function encode(map, values) {
  return blocks(map).map((b) => {
    const regs = new Array(b.count).fill(0);
    for (const [name, f] of Object.entries(map.fields)) {
      if (f.address < b.address || f.address + wordsOf(f) > b.address + b.count) continue;
      const v = values[name];
      if (v == null) continue;
      const scale = f.scale == null ? 1 : f.scale;
      const raw = Math.round(v / scale);
      const i = f.address - b.address;
      if (f.type === 'u16') regs[i] = raw & 0xffff;
      else if (f.type === 'i16') regs[i] = raw & 0xffff;
      else {
        const buf = Buffer.alloc(4);
        if (f.type === 'u32') buf.writeUInt32BE(raw >>> 0, 0);
        else if (f.type === 'i32') buf.writeInt32BE(raw, 0);
        else buf.writeFloatBE(v / scale, 0);
        const hi = buf.readUInt16BE(0), lo = buf.readUInt16BE(2);
        if (f.word_order === 'lo_hi') { regs[i] = lo; regs[i + 1] = hi; } else { regs[i] = hi; regs[i + 1] = lo; }
      }
    }
    return { address: b.address, regs };
  });
}

module.exports = { load, validate, blocks, decode, decodeField, encode, wordsOf };
