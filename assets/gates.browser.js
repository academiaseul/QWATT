/* GENERATED FILE — do not edit by hand.
 * Source: protocol/gates.spec.json  (spec_version 1.0.0, sha256 32dc1cf9a84eaa9b…)
 * Regenerate: npm run gen:gates   ·   CI verifies this file with: node protocol/gen.js --check
 * Target: assets/gates.browser.js
 */
(function (root) {
  var SPEC = {
    "spec_version": "1.0.0",
    "title": "QWATT verification gates",
    "binding": "browser",
    "binding_note": "Every value the gate engine reads for the profiles listed here, taken from protocol/gates.spec.json. digest is the SHA-256 of the full canonical spec.",
    "numerics": {
      "boundary_rel_eps": 1e-9
    },
    "profiles": {
      "bench": {
        "name": "Banco de pruebas — Fase 1",
        "nameplate_w": 150,
        "ceiling_k": 1.15,
        "interval_max_dt_s": 900,
        "clock_max_skew_s": 7500,
        "elevation_min_deg": -2,
        "night_tolerance_frac": 0.005,
        "energy_power_consistency_frac": 0.1,
        "agreement": {
          "mode": "symmetric",
          "require_second_meter": true,
          "frac": 0.05,
          "deadband_w": 2
        },
        "phase2": {
          "witness_ratio_min": 0.5,
          "witness_ratio_max": 1.6,
          "witness_derate": 0.8,
          "ramp_max_w_per_sample": null,
          "variance_floor": 0.005,
          "variance_min_samples": 30,
          "rtc_max_drift_s": 60,
          "max_gaps": 2
        },
        "site": {
          "lat": -33.45,
          "lon": -70.65
        }
      }
    },
    "gates": [
      {
        "id": "plausibility",
        "label": "G0",
        "validator": "V6",
        "phase": 1,
        "level": "interval",
        "title": {
          "es": "Verosimilitud",
          "en": "Plausibility"
        },
        "params": [
          "interval_max_dt_s",
          "clock_max_skew_s",
          "energy_power_consistency_frac"
        ]
      },
      {
        "id": "nameplate",
        "label": "G1",
        "validator": "V1",
        "phase": 1,
        "level": "interval",
        "title": {
          "es": "Techo de placa",
          "en": "Nameplate ceiling"
        },
        "params": [
          "nameplate_w",
          "ceiling_k"
        ]
      },
      {
        "id": "elevation",
        "label": "G2",
        "validator": "V2",
        "phase": 1,
        "level": "interval",
        "title": {
          "es": "Elevación solar",
          "en": "Solar elevation"
        },
        "params": [
          "elevation_min_deg",
          "night_tolerance_frac",
          "site.lat",
          "site.lon"
        ]
      },
      {
        "id": "agreement",
        "label": "G3",
        "validator": "V3",
        "phase": 1,
        "level": "interval",
        "title": {
          "es": "Concordancia de medidores",
          "en": "Meter agreement"
        },
        "params": [
          "agreement.mode",
          "agreement.require_second_meter",
          "agreement.frac",
          "agreement.deadband_w",
          "agreement.ac_dc_min",
          "agreement.ac_dc_max"
        ]
      },
      {
        "id": "witness",
        "label": "G4",
        "validator": "V4",
        "phase": 2,
        "level": "batch",
        "title": {
          "es": "Testigo solar",
          "en": "Sun witness"
        },
        "params": [
          "phase2.witness_ratio_min",
          "phase2.witness_ratio_max",
          "phase2.witness_derate",
          "night_tolerance_frac"
        ]
      },
      {
        "id": "ramp",
        "label": "G5",
        "validator": "V5",
        "phase": 2,
        "level": "batch",
        "title": {
          "es": "Rampa y plausibilidad",
          "en": "Ramp and plausibility"
        },
        "params": [
          "phase2.ramp_max_w_per_sample",
          "phase2.variance_floor",
          "phase2.variance_min_samples"
        ]
      },
      {
        "id": "chain",
        "label": "—",
        "validator": "V6",
        "phase": 2,
        "level": "batch",
        "title": {
          "es": "Cadena y reloj",
          "en": "Chain and clock"
        },
        "params": [
          "phase2.rtc_max_drift_s"
        ]
      },
      {
        "id": "integrity",
        "label": "G6",
        "validator": "V7",
        "phase": 2,
        "level": "batch",
        "title": {
          "es": "Integridad del nodo",
          "en": "Node integrity"
        },
        "params": [
          "phase2.max_gaps"
        ]
      }
    ],
    "messages": {
      "es": {
        "plausibility.ok": "Valores finitos, Δt {dt} s dentro de rango, reloj sincronizado.",
        "plausibility.nonfinite": "Valor no numérico o negativo en {field} — se rechaza antes de poder derrotar una comparación.",
        "plausibility.order": "ts_end no es posterior a ts_start — el intervalo no avanza en el tiempo.",
        "plausibility.dt_mismatch": "Δt declarado ({dt} s) no coincide con las marcas de tiempo ({dt_ts} s).",
        "plausibility.dt": "Δt de {dt} s supera el máximo de {max_dt} s: el intervalo no es utilizable.",
        "plausibility.skew": "Desfase de reloj de {skew} s sobre el máximo de {max_skew} s — sin tiempo confiable no hay reporte, por diseño.",
        "plausibility.energy_power": "Wh reportados ({wh}) no concuerdan con W × t ({expected} Wh) — tolerancia {tol} Wh.",
        "nameplate.ok": "Bajo el techo de placa ({ceiling} Wh para {nameplate} Wp en {minutes} min).",
        "nameplate.over": "{over} Wh supera el techo físico de {ceiling} Wh — un panel de {nameplate} Wp no puede producir eso.",
        "elevation.idle": "Sin generación que justificar (sol a {el}°).",
        "elevation.ok": "Sol a {el}° — sobre el umbral de {min}°.",
        "elevation.night": "Generación reportada con el sol a {el}°, bajo el umbral de {min}°.",
        "agreement.ok": "Los medidores concuerdan: |A−B| = {diff} Wh, tolerancia {tol} Wh.",
        "agreement.diverge": "Divergencia de {diff} Wh entre medidores (tolerancia {tol} Wh) — uno de los dos miente o está ciego.",
        "agreement.missing_meter": "Falta el segundo medidor — este perfil exige dos instrumentos independientes.",
        "agreement.single_meter": "Un solo medidor: aceptado con aseguramiento A1, sin contraste independiente.",
        "agreement.ratio_ok": "AC/DC = {ratio} dentro de la banda [{min}, {max}].",
        "agreement.ac_over_dc": "AC/DC = {ratio} supera {max} — un inversor no puede crear energía.",
        "agreement.eff_floor": "AC/DC = {ratio} bajo el piso de eficiencia {min}.",
        "agreement.ac_without_dc": "Energía AC reportada sin energía DC detrás.",
        "skipped.upstream": "No evaluada: una compuerta anterior rechazó la entrada."
      },
      "en": {
        "plausibility.ok": "Finite values, Δt {dt} s within range, clock in sync.",
        "plausibility.nonfinite": "Non-numeric or negative value in {field} — rejected before it can defeat a comparison.",
        "plausibility.order": "ts_end is not after ts_start — the interval does not move forward in time.",
        "plausibility.dt_mismatch": "Declared Δt ({dt} s) does not match the timestamps ({dt_ts} s).",
        "plausibility.dt": "Δt of {dt} s exceeds the maximum of {max_dt} s: the interval is unusable.",
        "plausibility.skew": "Clock skew of {skew} s above the maximum of {max_skew} s — no trustworthy time, no report, by design.",
        "plausibility.energy_power": "Reported Wh ({wh}) disagree with W × t ({expected} Wh) — tolerance {tol} Wh.",
        "nameplate.ok": "Under the nameplate ceiling ({ceiling} Wh for {nameplate} Wp in {minutes} min).",
        "nameplate.over": "{over} Wh exceeds the physical ceiling of {ceiling} Wh — a {nameplate} Wp panel cannot produce that.",
        "elevation.idle": "No generation to justify (sun at {el}°).",
        "elevation.ok": "Sun at {el}° — above the {min}° threshold.",
        "elevation.night": "Generation reported with the sun at {el}°, below the {min}° threshold.",
        "agreement.ok": "Meters agree: |A−B| = {diff} Wh, tolerance {tol} Wh.",
        "agreement.diverge": "Meters diverge by {diff} Wh (tolerance {tol} Wh) — one of them is lying or blind.",
        "agreement.missing_meter": "Second meter missing — this profile requires two independent instruments.",
        "agreement.single_meter": "Single meter: accepted at assurance A1, with no independent cross-check.",
        "agreement.ratio_ok": "AC/DC = {ratio} within the band [{min}, {max}].",
        "agreement.ac_over_dc": "AC/DC = {ratio} exceeds {max} — an inverter cannot create energy.",
        "agreement.eff_floor": "AC/DC = {ratio} below the efficiency floor {min}.",
        "agreement.ac_without_dc": "AC energy reported with no DC energy behind it.",
        "skipped.upstream": "Not evaluated: an earlier gate rejected the input."
      }
    },
    "digest": "32dc1cf9a84eaa9bf33c89dd31cf5a4901d694cfb8d137f5b1e6b106c5a963ce"
  };
  if (typeof module === 'object' && module.exports) module.exports = SPEC;
  else root.QWATT_GATES_SPEC = SPEC;
}(typeof self !== 'undefined' ? self : this));
