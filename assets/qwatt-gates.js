/**
 * QWATT — gate engine (shared)
 * ---------------------------------------------------------------------------
 * ONE implementation of the interval gates G0–G3, loaded unchanged by:
 *   • verificacion.html          (the public "try to break it" demo)
 *   • protocol/conformance.test.js (CI: every case in conformance/cases.json)
 *   • the mining rig / gateway    (via require)
 *
 * It contains no thresholds. Every number comes from the profile object passed
 * in, which comes from protocol/gates.spec.json through the generated binding.
 * If you are about to type a literal like 1.15 or 900 in here, stop: it belongs
 * in the spec.
 *
 * Pure functions, no dependencies, ES5-compatible so the demo page needs no
 * build step. Works as a classic <script> (window.QWATT_GATES) and as CommonJS.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QWATT_GATES = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ENGINE_VERSION = '1.0.0';

  /* ───────────────────────── solar position ───────────────────────── */

  var rad = function (d) { return d * Math.PI / 180; };
  var deg = function (r) { return r * 180 / Math.PI; };

  /**
   * Solar elevation in degrees at a UTC instant for a lat/lon.
   * NOAA-style simplified algorithm, ~0.1° accuracy — far tighter than the
   * horizon test needs. Identical to mining-rig/validators.js by construction:
   * the conformance suite pins its output for known instants.
   */
  function solarElevationDeg(when, latDeg, lonDeg) {
    var d = when instanceof Date ? when : new Date(when);
    var julian = d.getTime() / 86400000 + 2440587.5;
    var n = julian - 2451545.0;
    var L = (280.46 + 0.9856474 * n) % 360;
    var g = rad((357.528 + 0.9856003 * n) % 360);
    var lambda = rad(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
    var epsilon = rad(23.439 - 0.0000004 * n);
    var declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
    var utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    var eot = 4 * deg(0.0000001 - 0.0334 * Math.sin(g) + 0.0000349 * Math.sin(2 * g));
    var solarTime = utcHours + lonDeg / 15 + eot / 60;
    var hourAngle = rad((solarTime - 12) * 15);
    var lat = rad(latDeg);
    var sinEl = Math.sin(lat) * Math.sin(declination) +
      Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
    return deg(Math.asin(Math.max(-1, Math.min(1, sinEl))));
  }

  /* ───────────────────────────── helpers ──────────────────────────── */

  var isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  var round = function (v, dp) { var k = Math.pow(10, dp); return Math.round(v * k) / k; };
  /* Comparisons against a computed bound allow the spec's relative tolerance
     (numerics.boundary_rel_eps) so "exactly at the limit" gets one verdict in
     every language, whatever the floating-point evaluation order. */
  var lte = function (a, b, eps) { return a <= b + Math.abs(b) * eps; };
  var gte = function (a, b, eps) { return a >= b - Math.abs(b) * eps; };

  function check(id, label, status, code, detail) {
    return { id: id, label: label, status: status, code: code, detail: detail || {} };
  }

  /** Fill "{key}" placeholders from detail; fmt(value, key) decides presentation. */
  function format(template, detail, fmt) {
    return String(template).replace(/\{([a-z_]+)\}/g, function (m, k) {
      if (!(k in detail)) return m;
      return fmt ? fmt(detail[k], k) : String(detail[k]);
    });
  }

  /** Issuance arithmetic from the spec: floor, never round. */
  function mintFor(basisWh, spec) {
    var iss = spec.issuance;
    var kwh = basisWh / 1000;
    var k = Math.pow(10, iss.precision);
    var q = Math.floor(kwh * iss.qwatt_per_kwh * k + 1e-9) / k;   // 1e-9 absorbs binary noise below Stellar's 7 dp
    return { basis_wh: basisWh, kwh: kwh, qwatt: q, qwatt_str: q.toFixed(iss.precision) };
  }

  /* ─────────────────────────── the gates ──────────────────────────── */

  function gateLabel(spec, id) {
    for (var i = 0; i < spec.gates.length; i++) if (spec.gates[i].id === id) return spec.gates[i].label;
    return id;
  }

  /**
   * Evaluate one normalized interval (protocol/interval.schema.json) against a
   * profile from the spec.
   * @returns {{verdict:'accept'|'reject', spec_version:string, profile:string,
   *            checks:Array, failures:Array, mint:object|null}}
   */
  function evaluateInterval(rec, profile, spec) {
    var p = profile;
    var checks = [];
    var L = function (id) { return gateLabel(spec, id); };
    var eps = (spec.numerics && spec.numerics.boundary_rel_eps) || 0;

    /* ── G0 plausibility ─────────────────────────────────────────── */
    var t0 = Date.parse(rec.ts_start), t1 = Date.parse(rec.ts_end);
    var a = rec.meters && rec.meters.a, b = rec.meters && rec.meters.b;
    var bad = null;
    if (!isNum(t0)) bad = 'ts_start';
    else if (!isNum(t1)) bad = 'ts_end';
    else if (!a || !isNum(a.wh) || a.wh < 0) bad = 'meters.a.wh';
    else if (b && (!isNum(b.wh) || b.wh < 0)) bad = 'meters.b.wh';
    else if (a.w_mean != null && (!isNum(a.w_mean) || a.w_mean < 0)) bad = 'meters.a.w_mean';
    else if (b && b.w_mean != null && (!isNum(b.w_mean) || b.w_mean < 0)) bad = 'meters.b.w_mean';
    else if (!isNum(rec.dt_s) || rec.dt_s <= 0) bad = 'dt_s';
    else if (rec.clock_skew_s != null && !isNum(rec.clock_skew_s)) bad = 'clock_skew_s';

    if (bad) {
      checks.push(check('plausibility', L('plausibility'), 'fail', 'plausibility.nonfinite', { field: bad }));
      ['nameplate', 'elevation', 'agreement'].forEach(function (id) {
        checks.push(check(id, L(id), 'skip', 'skipped.upstream', {}));
      });
      return finish(rec, p, spec, checks, null);
    }

    var dtTs = (t1 - t0) / 1000;
    var dt = rec.dt_s;
    var hours = dt / 3600;
    var skew = rec.clock_skew_s == null ? 0 : Math.abs(rec.clock_skew_s);

    if (!(t1 > t0)) {
      checks.push(check('plausibility', L('plausibility'), 'fail', 'plausibility.order', { ts_start: rec.ts_start, ts_end: rec.ts_end }));
    } else if (Math.abs(dtTs - dt) > 1) {
      checks.push(check('plausibility', L('plausibility'), 'fail', 'plausibility.dt_mismatch', { dt: dt, dt_ts: dtTs }));
    } else if (dt > p.interval_max_dt_s) {
      checks.push(check('plausibility', L('plausibility'), 'fail', 'plausibility.dt', { dt: dt, max_dt: p.interval_max_dt_s }));
    } else if (skew > p.clock_max_skew_s) {
      checks.push(check('plausibility', L('plausibility'), 'fail', 'plausibility.skew', { skew: skew, max_skew: p.clock_max_skew_s }));
    } else {
      var ep = null;
      [a, b].forEach(function (m, i) {
        if (ep || !m || m.w_mean == null) return;
        var expected = m.w_mean * hours;
        var tol = p.energy_power_consistency_frac * Math.max(m.wh, expected);
        if (Math.abs(m.wh - expected) > tol) ep = { meter: i === 0 ? 'a' : 'b', wh: m.wh, expected: round(expected, 3), tol: round(tol, 3) };
      });
      checks.push(ep
        ? check('plausibility', L('plausibility'), 'fail', 'plausibility.energy_power', ep)
        : check('plausibility', L('plausibility'), 'pass', 'plausibility.ok', { dt: dt, skew: skew }));
    }

    var A = a.wh, B = b ? b.wh : null;
    var top = B == null ? A : Math.max(A, B);

    /* ── G1 nameplate ceiling ────────────────────────────────────── */
    var ceiling = p.nameplate_w * hours * p.ceiling_k;
    checks.push(lte(top, ceiling, eps)
      ? check('nameplate', L('nameplate'), 'pass', 'nameplate.ok', { ceiling: round(ceiling, 3), nameplate: p.nameplate_w, minutes: dt / 60, over: top })
      : check('nameplate', L('nameplate'), 'fail', 'nameplate.over', { ceiling: round(ceiling, 3), nameplate: p.nameplate_w, minutes: dt / 60, over: top }));

    /* ── G2 solar elevation ──────────────────────────────────────── */
    var floor = p.nameplate_w * hours * p.night_tolerance_frac;
    var generating = top > floor;
    var mid = new Date((t0 + t1) / 2);
    var el = Math.max(
      solarElevationDeg(new Date(t0), p.site.lat, p.site.lon),
      solarElevationDeg(mid, p.site.lat, p.site.lon),
      solarElevationDeg(new Date(t1), p.site.lat, p.site.lon)
    );
    var elD = { el: round(el, 2), min: p.elevation_min_deg, floor_wh: round(floor, 4), generating: generating };
    if (!generating) checks.push(check('elevation', L('elevation'), 'pass', 'elevation.idle', elD));
    else checks.push(gte(el, p.elevation_min_deg, eps)
      ? check('elevation', L('elevation'), 'pass', 'elevation.ok', elD)
      : check('elevation', L('elevation'), 'fail', 'elevation.night', elD));

    /* ── G3 meter agreement ──────────────────────────────────────── */
    var ag = p.agreement;
    if (B == null) {
      checks.push(ag.require_second_meter
        ? check('agreement', L('agreement'), 'fail', 'agreement.missing_meter', {})
        : check('agreement', L('agreement'), 'pass', 'agreement.single_meter', { assurance: 'A1' }));
    } else if (ag.mode === 'symmetric') {
      var diff = Math.abs(A - B);
      var tol = Math.max(ag.frac * Math.max(A, B), ag.deadband_w * hours);
      var d3 = { diff: round(diff, 4), tol: round(tol, 4), frac: ag.frac, deadband_w: ag.deadband_w };
      checks.push(lte(diff, tol, eps)
        ? check('agreement', L('agreement'), 'pass', 'agreement.ok', d3)
        : check('agreement', L('agreement'), 'fail', 'agreement.diverge', d3));
    } else if (ag.mode === 'ac_dc_ratio') {
      if (A <= 0) {
        checks.push(B <= 0
          ? check('agreement', L('agreement'), 'pass', 'agreement.ratio_ok', { ratio: 0, min: ag.ac_dc_min, max: ag.ac_dc_max })
          : check('agreement', L('agreement'), 'fail', 'agreement.ac_without_dc', { dc: A, ac: B }));
      } else {
        var ratio = B / A;
        var dr = { ratio: round(ratio, 4), min: ag.ac_dc_min, max: ag.ac_dc_max };
        if (!lte(ratio, ag.ac_dc_max, eps)) checks.push(check('agreement', L('agreement'), 'fail', 'agreement.ac_over_dc', dr));
        else if (!gte(ratio, ag.ac_dc_min, eps)) checks.push(check('agreement', L('agreement'), 'fail', 'agreement.eff_floor', dr));
        else checks.push(check('agreement', L('agreement'), 'pass', 'agreement.ratio_ok', dr));
      }
    } else {
      throw new Error('unknown agreement.mode: ' + ag.mode);
    }

    var basis = B == null ? A : Math.min(A, B);
    return finish(rec, p, spec, checks, basis);
  }

  function finish(rec, p, spec, checks, basisWh) {
    var failures = checks.filter(function (c) { return c.status === 'fail'; });
    var accepted = failures.length === 0 && basisWh != null;
    return {
      engine: ENGINE_VERSION,
      spec_version: spec.spec_version,
      spec_digest: spec.digest || null,
      profile: p.name,
      verdict: accepted ? 'accept' : 'reject',
      checks: checks,
      failures: failures.map(function (c) { return { id: c.id, label: c.label, code: c.code, detail: c.detail }; }),
      mint: accepted ? mintFor(basisWh, spec) : null
    };
  }

  return {
    ENGINE_VERSION: ENGINE_VERSION,
    solarElevationDeg: solarElevationDeg,
    evaluateInterval: evaluateInterval,
    mintFor: mintFor,
    format: format
  };
}));
