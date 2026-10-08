/**
 * QWATT — fault-injection schedule for the seven-day live run (Deliverable 4)
 * ---------------------------------------------------------------------------
 * SOW: "Fault injections during the live run (shaded sensor, disconnected meter,
 * night injection, implausible ramp) — each must appear in the public rejection
 * log with its reason."
 *
 * Each kind runs twice (once in the first half of the week, once in the second).
 * Windows are aligned to the 5-minute grid and last whole intervals, so every
 * interval inside a window is purely faulty and must be refused. Daytime faults
 * are placed by solar position (high sun, real generation to disturb); the night
 * injection near solar midnight, when the sun is far below the −2° floor.
 *
 * Expected reasons (docs/ARCHITECTURE-FREEZE-v2.md, D-10):
 *   shaded_sensor       meter b reads 40% low        → agreement.diverge
 *   disconnected_meter  meter b sends nothing        → agreement.diverge (b closes with 0 samples)
 *   night_injection     80 W claimed at 02:00–03:00  → elevation.night
 *   implausible_ramp    0→400 W within one sample    → nameplate.over (150 Wp × 1.15 ceiling;
 *                       the dedicated ramp gate is deferred to Instaward #2, so the write-up
 *                       names the gate that actually refused it)
 *
 * The schedule is published in the feed (faults.json) before the run starts,
 * so a reviewer can match each window against the rejection ledger.
 */

'use strict';

const sim = require('./simulator');
const G = require('../assets/qwatt-gates.js');

const DT_MS = 300 * 1000;
const EXPECT = {
  shaded_sensor: ['agreement.diverge'],
  disconnected_meter: ['agreement.diverge', 'agreement.missing_meter'],
  night_injection: ['elevation.night'],
  implausible_ramp: ['nameplate.over'],
};

const el = (tMs) => G.solarElevationDeg(new Date(tMs), sim.PROFILE.site.lat, sim.PROFILE.site.lon);

/** The grid-aligned instant of the day (UTC day starting at dayMs) where elevation is max (noon) or min (midnight). */
function solarExtreme(dayMs, want) {
  let best = dayMs, bestEl = want === 'max' ? -Infinity : Infinity;
  for (let t = dayMs; t < dayMs + 86400e3; t += DT_MS) {
    const e = el(t);
    if (want === 'max' ? e > bestEl : e < bestEl) { best = t; bestEl = e; }
  }
  return best;
}

/**
 * @param {number} startMs   run start
 * @param {number} days      run length (7 for the SOW run)
 * @returns {object[]} faults: { id, kind, startMs, endMs, start, end, expect, ...params }
 */
function buildSchedule(startMs, days = 7) {
  const day0 = Math.floor(startMs / 86400e3) * 86400e3;
  const plan = [
    // [day offset, kind, anchor, minutes from anchor, duration min, params]
    [1, 'shaded_sensor', 'max', -30, 20, { factor: 0.6 }],
    [2, 'disconnected_meter', 'max', -90, 20, {}],
    [3, 'night_injection', 'min', 0, 15, { watts: 80 }],
    [3, 'implausible_ramp', 'max', 60, 5, { watts: 400 }],
    [4, 'shaded_sensor', 'max', 45, 20, { factor: 0.6 }],
    [5, 'disconnected_meter', 'max', 30, 20, {}],
    [5, 'night_injection', 'min', 15, 15, { watts: 80 }],
    [6, 'implausible_ramp', 'max', -60, 5, { watts: 400 }],
  ];
  const out = [];
  plan.forEach(([d, kind, anchor, offMin, durMin, params], i) => {
    if (d >= days) return;
    const s = solarExtreme(day0 + d * 86400e3, anchor) + offMin * 60e3;
    const startAligned = Math.round(s / DT_MS) * DT_MS;
    if (startAligned < startMs + DT_MS) return;                    // never inject before the run is up
    const endAligned = startAligned + durMin * 60e3;
    out.push({
      id: `F${String(i + 1).padStart(2, '0')}-${kind}`,
      kind,
      startMs: startAligned,
      endMs: endAligned,
      start: new Date(startAligned).toISOString(),
      end: new Date(endAligned).toISOString(),
      expect: EXPECT[kind],
      solar_elevation_at_start_deg: Math.round(el(startAligned) * 10) / 10,
      ...params,
    });
  });
  return out;
}

/** Revive a published schedule (ISO strings) into the shape the simulator uses. */
function revive(list) {
  return list.map((f) => ({ ...f, startMs: Date.parse(f.start), endMs: Date.parse(f.end) }));
}

module.exports = { buildSchedule, revive, EXPECT };
