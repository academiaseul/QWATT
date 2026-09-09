/**
 * QWATT — conformance runner
 * ---------------------------------------------------------------------------
 * Holds every binding of protocol/gates.spec.json to conformance/cases.json:
 *
 *   1. the generated bindings on disk are current (gen.js --check)
 *   2. both bindings carry the same spec digest
 *   3. mining-rig/validators.js takes its thresholds from the spec, not literals
 *   4. the shared engine (assets/qwatt-gates.js — the file the demo page loads)
 *      and validators.js compute identical solar elevations
 *   5. every reason code the engine can emit has a message in every language
 *   6. every case: schema verdict, gate verdict, exact failing set, reason
 *      codes, mint string, pinned numeric details
 *
 * Run: node protocol/conformance.test.js   (no dependencies, no install step)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SPEC = require(path.join(ROOT, 'assets', 'gates.generated.js'));
const RIG_SPEC = require(path.join(ROOT, 'mining-rig', 'gates.generated.js'));
const G = require(path.join(ROOT, 'assets', 'qwatt-gates.js'));
const V = require(path.join(ROOT, 'mining-rig', 'validators.js'));
const { validate } = require('./schema-lite');
const schema = require('./interval.schema.json');
const suite = require('./conformance/cases.json');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, what) { assert(a === b, `${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function merge(base, over) {
  const out = Object.assign({}, base);
  for (const k of Object.keys(over)) {
    out[k] = isPlainObject(base[k]) && isPlainObject(over[k]) ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

console.log('\nBindings');

test('generated bindings are current (gen.js --check)', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'gen.js'), '--check'], { encoding: 'utf8' });
  assert(r.status === 0, (r.stdout + r.stderr).trim());
});

test('browser and rig bindings carry the same spec', () => {
  eq(RIG_SPEC.digest, SPEC.digest, 'digest');
  eq(RIG_SPEC.spec_version, SPEC.spec_version, 'spec_version');
  eq(suite.spec_version, SPEC.spec_version, 'suite spec_version');
});

test('validators.js thresholds come from the spec (rooftop profile)', () => {
  const p = SPEC.profiles.rooftop, T = V.DEFAULT_THRESHOLDS;
  const pairs = [
    ['nameplateW', p.nameplate_w], ['overIrradianceK', p.ceiling_k],
    ['nightElevationDeg', p.elevation_min_deg], ['nightToleranceFrac', p.night_tolerance_frac],
    ['inverterEffMin', p.agreement.ac_dc_min], ['inverterEffMax', p.agreement.ac_dc_max],
    ['witnessRatioMin', p.phase2.witness_ratio_min], ['witnessRatioMax', p.phase2.witness_ratio_max],
    ['witnessDerate', p.phase2.witness_derate], ['rampMaxWPerSample', p.phase2.ramp_max_w_per_sample],
    ['varianceFloor', p.phase2.variance_floor], ['varianceMinSamples', p.phase2.variance_min_samples],
    ['rtcMaxDriftS', p.phase2.rtc_max_drift_s], ['maxGaps', p.phase2.max_gaps],
  ];
  for (const [k, v] of pairs) eq(T[k], v, k);
  eq(V.SPEC_VERSION, SPEC.spec_version, 'validators SPEC_VERSION');
});

test('solar elevation: shared engine and validators.js agree to 1e-9°', () => {
  const instants = ['2026-09-20T15:00:00Z', '2026-09-20T22:38:00Z', '2026-09-21T02:00:00Z', '2026-08-25T16:30:00Z', '2026-12-21T16:00:00Z', '2026-06-21T16:00:00Z'];
  for (const iso of instants) for (const [lat, lon] of [[-33.45, -70.65], [-33.35, -70.52], [51.5, 0]]) {
    const a = G.solarElevationDeg(new Date(iso), lat, lon), b = V.solarElevationDeg(new Date(iso), lat, lon);
    assert(Math.abs(a - b) < 1e-9, `${iso} @${lat},${lon}: ${a} vs ${b}`);
  }
});

test('every reason code the engine can emit has a message in every language', () => {
  const src = fs.readFileSync(path.join(ROOT, 'assets', 'qwatt-gates.js'), 'utf8');
  const codes = new Set();
  for (const m of src.matchAll(/'((?:plausibility|nameplate|elevation|agreement|skipped)\.[a-z_]+)'/g)) codes.add(m[1]);
  assert(codes.size >= 15, `only ${codes.size} codes found in engine source`);
  for (const lang of Object.keys(SPEC.messages)) {
    const missing = [...codes].filter((c) => !SPEC.messages[lang][c]);
    assert(missing.length === 0, `messages.${lang} missing: ${missing.join(', ')}`);
  }
});

test('every gate id referenced by the engine exists in the spec', () => {
  const ids = new Set(SPEC.gates.map((g) => g.id));
  for (const id of ['plausibility', 'nameplate', 'elevation', 'agreement']) assert(ids.has(id), `spec lacks gate "${id}"`);
});

test('engine, schema file and fixtures agree on the interval schema version', () => {
  eq(G.INTERVAL_SCHEMA_VERSION, schema['x-schema-version'], 'engine INTERVAL_SCHEMA_VERSION');
  for (const name of Object.keys(suite.defaults)) eq(suite.defaults[name].schema_version, schema['x-schema-version'], `defaults.${name}.schema_version`);
});

test('no floating-point field survives in the interval schema', () => {
  const src = JSON.stringify(schema);
  assert(!/"type":\s*"number"/.test(src), 'interval.schema.json still declares a "number" field — evidence must be integer-only (freeze §1)');
});

console.log('\nConformance cases (' + suite.cases.length + ')');

const TOL = 0.05;
for (const c of suite.cases) {
  test(`${c.id} — ${c.description}`, () => {
    const rec = merge(suite.defaults[c.profile], c.input);
    const profile = SPEC.profiles[c.profile];
    assert(profile, `unknown profile ${c.profile}`);

    const errs = validate(rec, schema);
    const wantValid = c.expect.schema_valid !== false;
    assert((errs.length === 0) === wantValid,
      wantValid ? `schema rejected a valid input: ${errs.join('; ')}` : 'schema accepted an input it must reject');

    const res = G.evaluateInterval(rec, profile, SPEC);
    eq(res.spec_version, SPEC.spec_version, 'result spec_version');
    eq(res.verdict, c.expect.verdict, 'verdict');

    const got = res.failures.map((f) => f.id).sort().join(',');
    const want = [...c.expect.fail].sort().join(',');
    eq(got, want, 'failing gates');

    for (const [id, code] of Object.entries(c.expect.codes || {})) {
      const chk = res.checks.find((x) => x.id === id);
      assert(chk, `no check "${id}" in result`);
      eq(chk.code, code, `${id} code`);
    }
    if (c.expect.mint !== undefined) {
      assert(res.mint, 'expected a mint, got none');
      eq(res.mint.qwatt_str, c.expect.mint, 'mint');
    } else if (c.expect.verdict === 'reject') {
      assert(res.mint === null, 'a rejected interval must not mint');
    }
    for (const [id, det] of Object.entries(c.expect.details || {})) {
      const chk = res.checks.find((x) => x.id === id);
      for (const [k, v] of Object.entries(det)) {
        const g = chk.detail[k];
        assert(typeof g === 'number' && Math.abs(g - v) <= TOL, `${id}.${k}: expected ≈${v}, got ${g}`);
      }
    }
  });
}

console.log(`\n${passed} passed, ${failed} failed  ·  spec ${SPEC.spec_version} ${SPEC.digest.slice(0, 16)}…\n`);
process.exit(failed ? 1 : 0);
