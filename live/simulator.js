/**
 * QWATT — live-run solar simulator (Deliverable 4)
 * ---------------------------------------------------------------------------
 * The Phase 1 bench rig as numbers: 150 Wp facing north at 30° on a Santiago
 * balcony, two independent DC meters (meter a = PZEM-017 resolution 0.1 W,
 * meter b = EPEver telemetry resolution 0.01 W), sampled every 10 s.
 *
 * Stateless and deterministic: the sample at any instant is a pure function of
 * (seed, timestamp). Any minute of the seven-day run can be regenerated and
 * audited on its own, and a restart reproduces exactly the samples it would
 * have produced. Clouds come from hashed value noise, not a random-number
 * stream, for the same reason.
 *
 * Faults (live/schedule.js) are applied here, so the anomaly enters through the
 * same CSV → adapter → gates path a real meter fault would.
 */

'use strict';

const path = require('path');
const G = require(path.join(__dirname, '..', 'assets', 'qwatt-gates.js'));
const SPEC = require(path.join(__dirname, '..', 'assets', 'gates.generated.js'));

const PROFILE = SPEC.profiles.bench;
const STEP_S = 10;

/** 32-bit integer hash → [0, 1). Deterministic noise without state. */
function hash01(...ints) {
  let h = 0x811c9dc5;
  for (const v of ints) {
    let x = Math.floor(v) | 0;
    for (let i = 0; i < 4; i++) { h ^= x & 0xff; h = Math.imul(h, 0x01000193); x >>>= 8; }
  }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth noise in [0,1) over time: value noise on `periodS` knots, cosine-interpolated. */
function smoothNoise(seed, channel, tS, periodS) {
  const k = Math.floor(tS / periodS), f = (tS - k * periodS) / periodS;
  const a = hash01(seed, channel, k), b = hash01(seed, channel, k + 1);
  const w = (1 - Math.cos(f * Math.PI)) / 2;
  return a * (1 - w) + b * w;
}

/** Fraction of clear-sky output reaching the panel at time t (1 = clear). */
function cloudFactor(seed, tS) {
  const day = Math.floor(tS / 86400);
  const cloudiness = hash01(seed, 7, day);                       // some days are clear, some overcast
  const passing = smoothNoise(seed, 11, tS, 600);                 // cloud passages, ~10 min scale
  const thin = smoothNoise(seed, 13, tS, 90);                     // fast flicker
  const cover = cloudiness * (0.45 * passing + 0.15 * thin) + (cloudiness > 0.85 ? 0.35 : 0);
  return Math.max(0.12, Math.min(1, 1 - cover));
}

/** True (fault-free) power at t, before meter error. */
function truePower(seed, tMs) {
  const el = G.solarElevationDeg(new Date(tMs), PROFILE.site.lat, PROFILE.site.lon);
  if (el <= 0) return 0;
  const clear = PROFILE.nameplate_w * 0.82 * Math.pow(Math.sin(el * Math.PI / 180), 1.1);
  return clear * cloudFactor(seed, tMs / 1000);
}

/**
 * Both meters' readings at t, with any active fault applied.
 * @returns {{ts:number, a:number, b:number|null, fault:string|null}}  b === null means meter b is disconnected
 */
function sampleAt(seed, tMs, faults = []) {
  const tS = Math.floor(tMs / 1000);
  const p = truePower(seed, tMs);
  let a = p * (1 + (hash01(seed, 21, tS) - 0.5) * 0.006);
  let b = p * (0.99 + (hash01(seed, 23, tS) - 0.5) * 0.004);
  let fault = null;
  for (const f of faults) {
    if (tMs < f.startMs || tMs >= f.endMs) continue;
    fault = f.id;
    if (f.kind === 'shaded_sensor') b = b * f.factor;
    else if (f.kind === 'disconnected_meter') b = null;
    else if (f.kind === 'night_injection') { a = f.watts; b = f.watts * 0.99; }
    else if (f.kind === 'implausible_ramp') { a = f.watts; b = f.watts * 0.99; }
  }
  return {
    ts: tMs,
    a: Math.max(0, Math.round(a * 10) / 10),
    b: b == null ? null : Math.max(0, Math.round(b * 100) / 100),
    fault,
  };
}

/** CSV text (ts,a_w,b_w) for [fromMs, toMs) at STEP_S; an empty b cell is a disconnected meter. */
function csvFor(seed, fromMs, toMs, faults = []) {
  const first = Math.ceil(fromMs / (STEP_S * 1000)) * STEP_S * 1000;
  const out = ['ts,a_w,b_w'];
  for (let t = first; t < toMs; t += STEP_S * 1000) {
    const s = sampleAt(seed, t, faults);
    out.push(`${new Date(t).toISOString()},${s.a.toFixed(1)},${s.b == null ? '' : s.b.toFixed(2)}`);
  }
  return out.join('\n') + '\n';
}

module.exports = { sampleAt, csvFor, truePower, cloudFactor, hash01, PROFILE, STEP_S };
