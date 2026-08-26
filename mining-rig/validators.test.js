/**
 * QWATT — validator tests
 * ---------------------------------------------------------------------------
 * Each adversary in docs/VERIFICATION-MODEL.md §2 gets a test that proves the
 * corresponding check actually stops it. Run: node validators.test.js
 * No test framework — this must run on a bare Pi.
 */

'use strict';

const V = require('./validators');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertRejects(result, checkId) {
  assert(!result.accepted, 'expected the batch to be REJECTED, but it was accepted');
  assert(result.failures.some((f) => f.id === checkId),
    `expected ${checkId} to fail; failures were: ${result.failures.map((f) => f.id).join(', ') || '(none)'}`);
}

/* Santiago rooftop, 4.4 kWp — the El Arrayán pilot's geometry. */
const SITE = { lat: -33.35, lon: -70.52, thresholds: { nameplateW: 4400 } };

/** A well-formed, honest midday batch: 1 h, 2.4 kWh DC, sane AC and irradiance. */
function goodBatch(over = {}) {
  const samples = [];
  for (let i = 0; i < 360; i++) {
    // ~2400 W with realistic irradiance noise
    samples.push(2400 + Math.sin(i / 9) * 180 + (Math.random() - 0.5) * 120);
  }
  return {
    v: 1,
    site: 'sha256(site)',
    node: 'GNODE',
    seq: 42,
    window: { from: '2026-08-25T16:00:00Z', to: '2026-08-25T17:00:00Z' }, // ~12:00 local
    energy_wh: { m1_dc: 2400, m2_ac: 2304, m3_grid_wh: -1800 },
    witness: { mean_w_per_m2: 700, samples: 360, dark_samples: 0 },
    nameplate_w: 4400,
    integrity: { rtc_delta_s: 2, tamper: false, gaps: 0 },
    samples_w: samples,
    prev_hash: 'abc123',
    ...over,
  };
}
const CTX = { lastSeq: 41, lastWindowEnd: '2026-08-25T16:00:00Z', prevHash: 'abc123' };

console.log('\nQWATT validator suite\n');

console.log('baseline');
test('an honest batch is accepted at A2', () => {
  const r = V.verifyBatch(goodBatch(), SITE, CTX);
  assert(r.accepted, 'honest batch rejected: ' + JSON.stringify(r.failures));
  assert(r.level === 'A2', 'expected A2 (dual meter + witness), got ' + r.level);
});

console.log('\nV1 — nameplate capacity  [adversary A3: bench supply feeding the meter]');
test('rejects energy above what the array can physically produce', () => {
  // 4.4 kW × 1 h × 1.15 = 5060 Wh ceiling
  assertRejects(V.verifyBatch(goodBatch({ energy_wh: { m1_dc: 9000, m2_ac: 8600 } }), SITE, CTX), 'v1');
});
test('allows a cold clear-sky overirradiance spike below the margin', () => {
  const r = V.verifyBatch(goodBatch({
    energy_wh: { m1_dc: 4900, m2_ac: 4700 },
    witness: { mean_w_per_m2: 1300, samples: 360, dark_samples: 0 },
  }), SITE, CTX);
  assert(!r.failures.some((f) => f.id === 'v1'), 'legitimate overirradiance must not be rejected');
});

console.log('\nV2 — night gate  [adversary A5: generating after dark]');
test('rejects generation reported with the sun below the horizon', () => {
  const night = goodBatch({
    window: { from: '2026-08-26T04:00:00Z', to: '2026-08-26T05:00:00Z' }, // ~00:00 local
    witness: { mean_w_per_m2: 700, samples: 360, dark_samples: 0 },
  });
  assertRejects(V.verifyBatch(night, SITE, { ...CTX, lastWindowEnd: '2026-08-26T04:00:00Z' }), 'v2');
});
test('tolerates meter noise at night', () => {
  const night = goodBatch({
    window: { from: '2026-08-26T04:00:00Z', to: '2026-08-26T05:00:00Z' },
    energy_wh: { m1_dc: 5, m2_ac: 4 },
    witness: { mean_w_per_m2: 0, samples: 360, dark_samples: 360 },
    samples_w: null,
  });
  const r = V.verifyBatch(night, SITE, { ...CTX, lastWindowEnd: '2026-08-26T04:00:00Z' });
  assert(!r.failures.some((f) => f.id === 'v2'), 'small night-time noise must not fail V2');
});

console.log('\nV3 — meter divergence  [adversary A2: inflating one meter]');
test('rejects AC energy exceeding DC energy', () => {
  assertRejects(V.verifyBatch(goodBatch({ energy_wh: { m1_dc: 2400, m2_ac: 2600 } }), SITE, CTX), 'v3');
});
test('rejects meters that disagree beyond inverter efficiency', () => {
  assertRejects(V.verifyBatch(goodBatch({ energy_wh: { m1_dc: 2400, m2_ac: 1200 } }), SITE, CTX), 'v3');
});

console.log('\nV4 — sun witness  [adversary A3/A4: fabricating generation]');
test('rejects energy reported while the reference cell stayed dark', () => {
  assertRejects(V.verifyBatch(goodBatch({
    witness: { mean_w_per_m2: 0, samples: 360, dark_samples: 360 },
  }), SITE, CTX), 'v4');
});
test('rejects energy far above what the measured irradiance supports', () => {
  assertRejects(V.verifyBatch(goodBatch({
    energy_wh: { m1_dc: 4800, m2_ac: 4600 },
    witness: { mean_w_per_m2: 150, samples: 360, dark_samples: 0 },
  }), SITE, CTX), 'v4');
});

console.log('\nV5 — plausibility  [adversary A2: synthetic power series]');
test('rejects an implausibly smooth series', () => {
  assertRejects(V.verifyBatch(goodBatch({
    samples_w: new Array(360).fill(2400), // a constant — no real array does this
  }), SITE, CTX), 'v5');
});
test('rejects impossible instantaneous jumps', () => {
  const s = new Array(360).fill(2400);
  s[100] = 0; s[101] = 12000;
  assertRejects(V.verifyBatch(goodBatch({ samples_w: s }), SITE, CTX), 'v5');
});

console.log('\nV6 — clock and replay  [adversaries A1/A5]');
test('rejects a replayed sequence number', () => {
  assertRejects(V.verifyBatch(goodBatch({ seq: 41 }), SITE, CTX), 'v6');
});
test('rejects a window overlapping one already attested', () => {
  assertRejects(V.verifyBatch(goodBatch({
    window: { from: '2026-08-25T15:30:00Z', to: '2026-08-25T17:00:00Z' },
  }), SITE, CTX), 'v6');
});
test('rejects a broken hash chain', () => {
  assertRejects(V.verifyBatch(goodBatch({ prev_hash: 'tampered' }), SITE, CTX), 'v6');
});
test('rejects clock drift beyond the RTC tolerance', () => {
  assertRejects(V.verifyBatch(goodBatch({
    integrity: { rtc_delta_s: 3600, tamper: false, gaps: 0 },
  }), SITE, CTX), 'v6');
});

console.log('\nV7 — tamper  [adversary A6: opening the enclosure]');
test('halts minting when the tamper flag is set', () => {
  assertRejects(V.verifyBatch(goodBatch({
    integrity: { rtc_delta_s: 1, tamper: true, gaps: 0 },
  }), SITE, CTX), 'v7');
});
test('rejects a batch with too many sampling gaps', () => {
  assertRejects(V.verifyBatch(goodBatch({
    integrity: { rtc_delta_s: 1, tamper: false, gaps: 9 },
  }), SITE, CTX), 'v7');
});

console.log('\nassurance levels');
test('a simulated batch never reaches acceptance', () => {
  const r = V.verifyBatch(goodBatch({ simulated: true }), SITE, CTX);
  assert(r.level === 'A0', 'expected A0, got ' + r.level);
  assert(!r.accepted, 'simulated data must never be attested as generation');
});
test('a single-meter bench batch degrades to A1, not failure', () => {
  const b = goodBatch();
  delete b.energy_wh.m2_ac;
  delete b.witness;
  const r = V.verifyBatch(b, SITE, CTX);
  assert(r.level === 'A1', 'expected A1, got ' + r.level);
  assert(r.accepted, 'a single-meter batch should still be accepted, at lower assurance');
  assert(r.checks.v3 === 'skipped' && r.checks.v4 === 'skipped', 'absent instruments must be skipped, not passed');
});
test('co-signature raises a dual-instrument batch to A3', () => {
  const r = V.verifyBatch(goodBatch(), SITE, { ...CTX, coSigned: true });
  assert(r.level === 'A3', 'expected A3, got ' + r.level);
});

console.log('\nevidence integrity');
test('canonical hashing is order-independent', () => {
  const a = { b: 2, a: 1, c: { y: 2, x: 1 } };
  const b = { c: { x: 1, y: 2 }, a: 1, b: 2 };
  assert(V.canonical(a) === V.canonical(b), 'key order must not change the hash');
});
test('editing any field changes the batch hash', () => {
  const h1 = V.batchHash(goodBatch({ samples_w: null }));
  const h2 = V.batchHash(goodBatch({ samples_w: null, energy_wh: { m1_dc: 2401, m2_ac: 2304 } }));
  assert(h1 !== h2, 'a changed reading must produce a different hash');
});
test('the sample Merkle root is stable and sensitive', () => {
  const r1 = V.sampleRoot([1, 2, 3, 4, 5]);
  const r2 = V.sampleRoot([1, 2, 3, 4, 5]);
  const r3 = V.sampleRoot([1, 2, 3, 4, 6]);
  assert(r1 === r2, 'root must be deterministic');
  assert(r1 !== r3, 'root must change when a sample changes');
});

console.log('\nsolar position');
test('midday in Santiago is high, midnight is below the horizon', () => {
  const noon = V.solarElevationDeg(new Date('2026-08-25T16:00:00Z'), -33.45, -70.66);
  const midnight = V.solarElevationDeg(new Date('2026-08-26T04:00:00Z'), -33.45, -70.66);
  assert(noon > 30, 'expected a high midday sun, got ' + noon.toFixed(1) + '°');
  assert(midnight < -0.833, 'expected the sun below the horizon, got ' + midnight.toFixed(1) + '°');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
