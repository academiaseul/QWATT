/**
 * QWATT ingest — CSV / file replay adapter
 * ---------------------------------------------------------------------------
 * Replays a CSV of timestamped samples through an IntervalBuilder, at fast or
 * real-time pace. This is how historical datasets, SCADA exports and the
 * seven-day live run's feed enter the pipeline.
 *
 *   config = {
 *     file: 'samples.csv',
 *     ts_column: 'ts',                       // ISO 8601 or epoch ms
 *     meters: { a: { power_w: 'a_w', energy_wh: 'a_wh' }, b: { power_w: 'b_w' } },
 *     pace: 'fast' | 'realtime' | <speed factor, e.g. 60>
 *   }
 *   await replay(config, builder)   → { rows, intervals }
 *
 * The raw payload hashed into each interval is the exact CSV line. No dependencies.
 */

'use strict';

const fs = require('fs');
const readline = require('readline');

/** Split one CSV line; handles double-quoted fields with doubled quotes. */
function splitLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseTs(v) {
  if (/^\d+(\.\d+)?$/.test(v)) { const n = Number(v); return n < 1e11 ? n * 1000 : n; }   // epoch s or ms
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new Error('unparseable timestamp: ' + v);
  return t;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function replay(config, builder) {
  const rl = readline.createInterface({ input: fs.createReadStream(config.file, 'utf8'), crlfDelay: Infinity });
  let header = null, rows = 0, intervals = 0, prevTs = null;
  const speed = config.pace === 'realtime' ? 1 : (typeof config.pace === 'number' ? config.pace : 0);
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) { header = splitLine(line).map((h) => h.trim()); continue; }
    const cells = splitLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] === undefined ? '' : cells[i].trim(); });
    const ts = parseTs(row[config.ts_column || 'ts']);
    if (speed > 0 && prevTs !== null && ts > prevTs) await sleep((ts - prevTs) / speed);
    prevTs = ts;
    for (const [key, cols] of Object.entries(config.meters)) {
      const sample = { ts, power_w: Number(row[cols.power_w]) };
      if (cols.energy_wh && row[cols.energy_wh] !== '') sample.energy_wh = Number(row[cols.energy_wh]);
      intervals += builder.push(key, sample, line + '\n').length;
    }
    rows++;
  }
  if (config.flush !== false) { const fl = builder.flush(); if (fl) intervals += fl.length; }
  return { rows, intervals };
}

module.exports = { replay, splitLine, parseTs };
