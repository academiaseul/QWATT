#!/usr/bin/env node
/**
 * QWATT — fetch one month of an NREL PVDAQ system and convert it for the scale test
 * ---------------------------------------------------------------------------
 *   node batch/datasets/pvdaq.js                      the default dataset (below)
 *   node batch/datasets/pvdaq.js --system 4902 --month 2017-09 --a <col> --b <col> --utc-offset -5 --out <dir>
 *
 * Source: NREL "Photovoltaic Data Acquisition (PVDAQ) Public Datasets",
 * OEDI Data Lake, CC BY 4.0, DOI 10.25984/1846021. Daily CSVs per system are
 * read over plain HTTPS from https://oedi-data-lake.s3.amazonaws.com/pvdaq/csv/.
 *
 * DEFAULT DATASET — system 4902 "NIST_Ground_1", Gaithersburg MD, 270.7 kWp,
 * 1-minute data, September 2017:
 *   meter a (DC) = dc_power_inv_14538     inverter-reported DC power, kW
 *   meter b (AC) = ac_power_meter_1864_5  separate AC revenue meter, kW
 * Two independent instruments, DC before the inverter and AC after it — the
 * spec's ac_dc_ratio agreement mode (the rooftop profile's design).
 *
 * Conversion rules (deterministic; recorded in provenance.json):
 *   - timestamps are local STANDARD time (no DST): UTC = local − utc_offset.
 *     Established from the data itself: with UTC−5, generation starts at
 *     +0.5° solar elevation and ends at −1.1°; with UTC−4 it would start 11°
 *     below the horizon.
 *   - kW × 1000 → W; values written with at most 1 decimal.
 *   - negative readings (inverter standby draw at night) are written as 0 W:
 *     they are consumption, never generation.
 *   - a row with either meter blank is DROPPED, never written as zero, so a
 *     data gap stays a gap (the interval builder emits empty intervals).
 *
 * Outputs in --out: pvdaq-<system>-<month>.csv, provenance.json (source URL and
 * SHA-256 of every daily file, output SHA-256, rules), dataset.json (what
 * batch/scale.js --dataset needs: site, derived gate profile, meters).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const V = require('../verify');

const BASE = 'https://oedi-data-lake.s3.amazonaws.com/pvdaq/csv';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const DEFAULT = {
  system: 4902,
  name: 'NIST_Ground_1',
  month: '2017-09',
  a: 'dc_power_inv_14538',
  b: 'ac_power_meter_1864_5',
  utc_offset: -5,
  unit_scale: 1000,
  nameplate_w: 270700,
  lat: 39.1319,
  lon: -77.2141,
};

async function getText(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (r.status === 404) return null;
    if (r.ok) return r.text();
    if (attempt === 3) throw new Error(`${url}: HTTP ${r.status}`);
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const cfg = {
    ...DEFAULT,
    system: Number(opt('--system', DEFAULT.system)),
    month: opt('--month', DEFAULT.month),
    a: opt('--a', DEFAULT.a),
    b: opt('--b', DEFAULT.b),
    utc_offset: Number(opt('--utc-offset', DEFAULT.utc_offset)),
  };
  const out = path.resolve(opt('--out', path.join(__dirname, '..', '..', 'datasets', `pvdaq-${cfg.system}-${cfg.month}`)));
  fs.mkdirSync(out, { recursive: true });

  const [Y, M] = cfg.month.split('-').map(Number);
  const days = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const sources = [];
  const lines = ['ts,a_w,b_w'];
  let rows = 0, dropped = 0, clamped = 0, missingDays = 0;

  for (let d = 1; d <= days; d++) {
    const url = `${BASE}/pvdata/system_id=${cfg.system}/year=${Y}/month=${M}/day=${d}/system_${cfg.system}__date_${Y}_${String(M).padStart(2, '0')}_${String(d).padStart(2, '0')}.csv`;
    const text = await getText(url);
    if (text == null) { missingDays++; sources.push({ url, sha256: null, note: 'not published' }); continue; }
    sources.push({ url, sha256: sha(text) });
    const L = text.trim().split(/\r?\n/);
    const h = L[0].split(',');
    const ia = h.indexOf(cfg.a), ib = h.indexOf(cfg.b);
    if (ia < 0 || ib < 0) throw new Error(`${url}: columns ${cfg.a} / ${cfg.b} not found`);
    for (const line of L.slice(1)) {
      const c = line.split(',');
      if (c[ia] === '' || c[ib] === '' || c[ia] == null || c[ib] == null) { dropped++; continue; }
      const local = Date.parse(c[0].replace(' ', 'T') + 'Z');
      if (!Number.isFinite(local)) { dropped++; continue; }
      const ts = new Date(local - cfg.utc_offset * 3600e3).toISOString();
      let a = Number(c[ia]) * cfg.unit_scale, b = Number(c[ib]) * cfg.unit_scale;
      if (!Number.isFinite(a) || !Number.isFinite(b)) { dropped++; continue; }
      if (a < 0) { a = 0; clamped++; }
      if (b < 0) { b = 0; clamped++; }
      lines.push(`${ts},${Math.round(a * 10) / 10},${Math.round(b * 10) / 10}`);
      rows++;
    }
    process.stdout.write(`\r  ${cfg.month}-${String(d).padStart(2, '0')}  ${rows} rows`);
  }
  process.stdout.write('\n');

  const csvName = `pvdaq-${cfg.system}-${cfg.month}.csv`;
  const csvText = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(out, csvName), csvText);

  /* Gate profile for this site: the spec's rooftop rules (DC before the inverter, AC after),
     with this array's nameplate and coordinates. Not part of gates.spec.json 1.0.0 — the spec
     is frozen for the sprint — so it is recorded here, in full, next to the data it judges. */
  const base = V.SPEC.profiles.rooftop;
  const profile = JSON.parse(JSON.stringify(base));
  profile.name = `PVDAQ ${cfg.system} ${cfg.name} (derived from spec ${V.SPEC.spec_version} profile "rooftop")`;
  profile.description = `${cfg.nameplate_w / 1000} kWp · inverter DC (a) vs AC revenue meter (b) · scale-test profile, not part of the frozen spec`;
  profile.site = { lat: cfg.lat, lon: cfg.lon, tz: `UTC${cfg.utc_offset}` };
  profile.nameplate_w = cfg.nameplate_w;

  const dataset = {
    title: `NREL PVDAQ system ${cfg.system} (${cfg.name}), ${cfg.month}`,
    licence: 'CC BY 4.0 — NREL, Photovoltaic Data Acquisition (PVDAQ) Public Datasets, DOI 10.25984/1846021',
    csv: csvName,
    ts_column: 'ts',
    site_id: `pvdaq-${cfg.system}`,
    meters: { a: { column: 'a_w', id: `pvdaq-${cfg.system}:${cfg.a}`, class: 'dc' }, b: { column: 'b_w', id: `pvdaq-${cfg.system}:${cfg.b}`, class: 'ac' } },
    profile,
  };
  fs.writeFileSync(path.join(out, 'dataset.json'), JSON.stringify(dataset, null, 2) + '\n');

  const provenance = {
    source: 'NREL PVDAQ via the OEDI Data Lake (public HTTPS, no account)',
    licence: dataset.licence,
    attribution: 'Data: National Renewable Energy Laboratory (NREL), PVDAQ, CC BY 4.0. Converted by QWATT.',
    config: cfg,
    rules: [
      `timestamps are local standard time; UTC = local − (${cfg.utc_offset}) h`,
      `values × ${cfg.unit_scale} (kW → W), rounded to 0.1 W`,
      'negative readings (standby draw) written as 0 W',
      'rows with a blank meter value dropped, never zero-filled',
    ],
    counts: { days, missing_days: missingDays, rows_written: rows, rows_dropped: dropped, values_clamped_to_zero: clamped },
    output: { file: csvName, sha256: sha(csvText) },
    sources,
    converted_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), out)}: ${rows} rows (${dropped} dropped, ${clamped} clamped, ${missingDays} days missing) · csv sha256 ${provenance.output.sha256.slice(0, 16)}…`);
}

main().catch((e) => { console.error('pvdaq fetch failed:', e.message); process.exit(1); });
