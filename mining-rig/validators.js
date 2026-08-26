/**
 * QWATT — verification validators V1–V7
 * ---------------------------------------------------------------------------
 * The executable form of docs/VERIFICATION-MODEL.md §5.
 *
 * Runs in two places against the SAME site thresholds:
 *   1. on the node, before it signs a batch
 *   2. on the treasury co-signer, before it counter-signs
 * Both must pass. A batch that fails any check is recorded as rejected, with its
 * reason, and mints nothing. Rejections are kept and published — a verification
 * system that hides its rejections is not a verification system.
 *
 * No dependencies: this must run on a Raspberry Pi with a bare Node install.
 */

'use strict';

const crypto = require('crypto');

/* ─────────────────────────── site thresholds ─────────────────────────── */

/**
 * Per-site, not universal — a Santiago rooftop and a Patagonian one have
 * different plausible envelopes. Stored with the site record in the panel
 * registry so node and treasury validate against identical numbers.
 */
const DEFAULT_THRESHOLDS = {
  nameplateW: 4400,          // array nameplate (bench: 100)
  overIrradianceK: 1.15,     // V1 — cold clear-sky / cloud-edge margin
  nightElevationDeg: -0.833, // V2 — sun below horizon, incl. refraction
  nightToleranceFrac: 0.005, // V2 — meter noise allowance, fraction of nameplate
  inverterEffMin: 0.88,      // V3 — AC/DC ratio floor
  inverterEffMax: 1.0,       // V3 — AC can never exceed DC
  witnessRatioMin: 0.5,      // V4
  witnessRatioMax: 1.6,      // V4
  witnessDerate: 0.80,       // V4 — soiling, temperature, mismatch
  rampMaxWPerSample: null,   // V5 — defaults to nameplateW (100%/10 s)
  varianceFloor: 0.005,      // V5 — real irradiance is noisy; σ/μ below this is synthetic
  varianceMinSamples: 30,    // V5 — below this, skip the smoothness test
  rtcMaxDriftS: 60,          // V6
  maxGaps: 2,                // V7
};

/* ───────────────────────────── solar position ────────────────────────── */

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/**
 * Solar elevation in degrees (NOAA algorithm, simplified — accurate to ~0.1°,
 * far tighter than the horizon test needs).
 */
function solarElevationDeg(date, latDeg, lonDeg) {
  const d = date instanceof Date ? date : new Date(date);
  const julian = d.getTime() / 86400000 + 2440587.5;
  const n = julian - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;               // mean longitude
  const g = rad((357.528 + 0.9856003 * n) % 360);          // mean anomaly
  const lambda = rad(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)); // ecliptic longitude
  const epsilon = rad(23.439 - 0.0000004 * n);             // obliquity
  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));

  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  // equation of time, minutes
  const eot = 4 * deg(
    0.0000001 - 0.0334 * Math.sin(g) + 0.0000349 * Math.sin(2 * g)
  ) + 0.0;
  const solarTime = utcHours + lonDeg / 15 + eot / 60;
  const hourAngle = rad((solarTime - 12) * 15);

  const lat = rad(latDeg);
  const sinEl =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  return deg(Math.asin(Math.max(-1, Math.min(1, sinEl))));
}

/* ───────────────────────────── helpers ───────────────────────────────── */

const ok = (id, detail) => ({ id, pass: true, detail });
const fail = (id, reason, detail) => ({ id, pass: false, reason, detail });

function windowHours(batch) {
  const from = new Date(batch.window.from).getTime();
  const to = new Date(batch.window.to).getTime();
  return (to - from) / 3600000;
}

function stats(values) {
  const n = values.length;
  if (!n) return { n: 0, mean: 0, sd: 0, cv: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  return { n, mean, sd, cv: mean > 0 ? sd / mean : 0 };
}

/* ───────────────────────────── V1 – V7 ───────────────────────────────── */

/** V1 — nameplate capacity. An array cannot exceed its own physics. */
function v1Capacity(batch, t) {
  const hours = windowHours(batch);
  const maxWh = t.nameplateW * hours * t.overIrradianceK;
  const wh = batch.energy_wh.m1_dc;
  const detail = { wh, maxWh: +maxWh.toFixed(1), hours: +hours.toFixed(4) };
  return wh <= maxWh
    ? ok('v1', detail)
    : fail('v1', `energy ${wh} Wh exceeds physical maximum ${maxWh.toFixed(1)} Wh`, detail);
}

/** V2 — night gate. No sun, no generation. */
function v2Night(batch, t, site) {
  if (site.lat == null || site.lon == null) {
    return fail('v2', 'site coordinates unavailable — cannot evaluate the night gate', {});
  }
  const from = new Date(batch.window.from);
  const to = new Date(batch.window.to);
  const mid = new Date((from.getTime() + to.getTime()) / 2);
  const elevations = [from, mid, to].map((d) => solarElevationDeg(d, site.lat, site.lon));
  const maxEl = Math.max(...elevations);
  const isNight = maxEl < t.nightElevationDeg;
  const wh = batch.energy_wh.m1_dc;
  const allowance = t.nameplateW * windowHours(batch) * t.nightToleranceFrac;
  const detail = { maxElevationDeg: +maxEl.toFixed(2), isNight, wh, allowanceWh: +allowance.toFixed(2) };
  if (!isNight) return ok('v2', detail);
  return wh <= allowance
    ? ok('v2', detail)
    : fail('v2', `${wh} Wh reported with the sun below the horizon (${maxEl.toFixed(2)}°)`, detail);
}

/** V3 — meter divergence. Two instruments, one physical quantity. */
function v3Divergence(batch, t) {
  const dc = batch.energy_wh.m1_dc;
  const ac = batch.energy_wh.m2_ac;
  if (ac == null) return { id: 'v3', pass: true, skipped: 'no second meter (assurance A1)', detail: { dc } };
  if (dc <= 0) {
    return ac <= 0
      ? ok('v3', { dc, ac })
      : fail('v3', 'AC energy reported with no DC energy behind it', { dc, ac });
  }
  const ratio = ac / dc;
  const detail = { dc, ac, ratio: +ratio.toFixed(4), band: [t.inverterEffMin, t.inverterEffMax] };
  if (ratio > t.inverterEffMax) {
    return fail('v3', `AC/DC ratio ${ratio.toFixed(3)} exceeds 1.0 — an inverter cannot create energy`, detail);
  }
  return ratio >= t.inverterEffMin
    ? ok('v3', detail)
    : fail('v3', `AC/DC ratio ${ratio.toFixed(3)} below the inverter efficiency floor ${t.inverterEffMin}`, detail);
}

/**
 * V4 — sun witness. The witness is outside the power path, so it cannot be
 * spoofed by manipulating the array. Its job is to make a fabricated M1/M2
 * pair detectable.
 */
function v4Witness(batch, t) {
  const w = batch.witness;
  if (!w) return { id: 'v4', pass: true, skipped: 'no witness fitted (assurance A1)', detail: {} };
  const wh = batch.energy_wh.m1_dc;
  const hours = windowHours(batch);

  // Hard gate first: energy reported while the witness saw only darkness.
  if (wh > t.nameplateW * hours * t.nightToleranceFrac &&
      w.dark_samples != null && w.samples > 0 && w.dark_samples >= w.samples) {
    return fail('v4', `${wh} Wh reported while the reference cell was dark for the whole window`,
      { wh, darkSamples: w.dark_samples, samples: w.samples });
  }

  const irradiance = w.mean_w_per_m2;
  if (irradiance == null || irradiance <= 0) {
    return wh <= t.nameplateW * hours * t.nightToleranceFrac
      ? ok('v4', { irradiance, wh })
      : fail('v4', 'energy reported with zero measured irradiance', { irradiance, wh });
  }

  const expectedWh = (irradiance / 1000) * t.nameplateW * t.witnessDerate * hours;
  const ratio = expectedWh > 0 ? wh / expectedWh : Infinity;
  const detail = {
    irradiance, wh, expectedWh: +expectedWh.toFixed(1),
    ratio: +ratio.toFixed(3), band: [t.witnessRatioMin, t.witnessRatioMax],
  };
  return ratio >= t.witnessRatioMin && ratio <= t.witnessRatioMax
    ? ok('v4', detail)
    : fail('v4', `measured energy is ${ratio.toFixed(2)}× what the irradiance supports`, detail);
}

/**
 * V5 — ramp and plausibility. Two failure modes: physically impossible jumps,
 * and series too smooth to be real. Genuine irradiance always carries noise;
 * a synthetic constant does not.
 */
function v5Plausibility(batch, t) {
  const samples = batch.samples_w;
  if (!Array.isArray(samples) || samples.length < 2) {
    return { id: 'v5', pass: true, skipped: 'no sample series supplied', detail: {} };
  }
  const rampMax = t.rampMaxWPerSample ?? t.nameplateW;
  for (let i = 1; i < samples.length; i++) {
    const delta = Math.abs(samples[i] - samples[i - 1]);
    if (delta > rampMax) {
      return fail('v5', `power jumped ${delta.toFixed(0)} W between consecutive samples (max ${rampMax})`,
        { index: i, delta: +delta.toFixed(1), rampMax });
    }
  }
  const active = samples.filter((s) => s > t.nameplateW * 0.02);
  const s = stats(active);
  const detail = { samples: samples.length, activeSamples: s.n, cv: +s.cv.toFixed(5), floor: t.varianceFloor };
  if (s.n >= t.varianceMinSamples && s.cv < t.varianceFloor) {
    return fail('v5', `power series is implausibly smooth (cv ${s.cv.toFixed(5)} < ${t.varianceFloor}) — real irradiance is noisy`, detail);
  }
  return ok('v5', detail);
}

/** V6 — clock integrity and replay protection. */
function v6Clock(batch, t, ctx) {
  const drift = Math.abs(batch.integrity?.rtc_delta_s ?? 0);
  if (drift > t.rtcMaxDriftS) {
    return fail('v6', `system clock differs from the hardware RTC by ${drift}s (max ${t.rtcMaxDriftS}s)`, { drift });
  }
  const from = new Date(batch.window.from).getTime();
  const to = new Date(batch.window.to).getTime();
  if (!(to > from)) return fail('v6', 'batch window does not move forward in time', { from, to });

  const prevSeq = ctx?.lastSeq ?? -1;
  if (batch.seq <= prevSeq) {
    return fail('v6', `sequence ${batch.seq} is not greater than the last attested ${prevSeq} — replay`, { seq: batch.seq, prevSeq });
  }
  const prevEnd = ctx?.lastWindowEnd ? new Date(ctx.lastWindowEnd).getTime() : null;
  if (prevEnd !== null && from < prevEnd) {
    return fail('v6', 'batch window overlaps a window already attested', { from: batch.window.from, prevEnd: ctx.lastWindowEnd });
  }
  if (ctx?.prevHash && batch.prev_hash !== ctx.prevHash) {
    return fail('v6', 'prev_hash does not link to the previous batch — the chain is broken', { expected: ctx.prevHash, got: batch.prev_hash });
  }
  return ok('v6', { drift, seq: batch.seq });
}

/** V7 — tamper and node integrity. */
function v7Integrity(batch, t) {
  const i = batch.integrity || {};
  if (i.tamper === true) {
    return fail('v7', 'enclosure tamper flag is set — minting halted until a signed re-arm', { tamper: true });
  }
  const gaps = i.gaps ?? 0;
  if (gaps > t.maxGaps) {
    return fail('v7', `${gaps} sampling gaps in the window (max ${t.maxGaps})`, { gaps, maxGaps: t.maxGaps });
  }
  return ok('v7', { tamper: false, gaps });
}

/* ─────────────────────────── batch evaluation ────────────────────────── */

/** Canonical JSON: sorted keys, no whitespace — hash inputs must be byte-identical. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

/** Hash of a batch record, excluding the hash field itself. */
function batchHash(batch) {
  const { hash, ...rest } = batch;
  return crypto.createHash('sha256').update(canonical(rest), 'utf8').digest('hex');
}

/** Merkle root over the raw sample series, so any one sample stays provable later. */
function sampleRoot(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  let level = samples.map((s) =>
    crypto.createHash('sha256').update(String(s), 'utf8').digest('hex'));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = level[i + 1] ?? a; // odd node duplicates
      next.push(crypto.createHash('sha256').update(a + b, 'utf8').digest('hex'));
    }
    level = next;
  }
  return level[0];
}

/**
 * Run V1–V7 over a batch.
 * @returns {{accepted:boolean, level:string, checks:object, failures:array, hash:string}}
 */
function verifyBatch(batch, site = {}, ctx = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...(site.thresholds || {}) };
  const results = [
    v1Capacity(batch, t),
    v2Night(batch, t, site),
    v3Divergence(batch, t),
    v4Witness(batch, t),
    v5Plausibility(batch, t),
    v6Clock(batch, t, ctx),
    v7Integrity(batch, t),
  ];
  const failures = results.filter((r) => !r.pass);
  const checks = {};
  for (const r of results) checks[r.id] = r.skipped ? 'skipped' : (r.pass ? 'pass' : 'fail');

  // Assurance level is a property of the INSTRUMENTS present, never of the outcome.
  const hasSecondMeter = batch.energy_wh?.m2_ac != null;
  const hasWitness = !!batch.witness;
  let level = 'A1';
  if (batch.simulated) level = 'A0';
  else if (hasSecondMeter && hasWitness) level = ctx.coSigned ? 'A3' : 'A2';

  return {
    accepted: failures.length === 0 && level !== 'A0',
    level,
    checks,
    failures: failures.map((f) => ({ id: f.id, reason: f.reason, detail: f.detail })),
    hash: batchHash(batch),
  };
}

module.exports = {
  DEFAULT_THRESHOLDS,
  solarElevationDeg,
  canonical,
  batchHash,
  sampleRoot,
  verifyBatch,
  _checks: { v1Capacity, v2Night, v3Divergence, v4Witness, v5Plausibility, v6Clock, v7Integrity },
};
