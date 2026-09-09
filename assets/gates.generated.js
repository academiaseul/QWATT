/* GENERATED FILE — do not edit by hand.
 * Source: protocol/gates.spec.json  (spec_version 1.0.0, sha256 056f1b512e353bbe…)
 * Regenerate: npm run gen:gates   ·   CI verifies this file with: node protocol/gen.js --check
 * Target: assets/gates.generated.js
 */
(function (root) {
  var SPEC = {
    "spec_version": "1.0.0",
    "title": "QWATT verification gates",
    "description": "Single source of truth for every threshold and rule that decides whether a metered energy interval is accepted. Every implementation (browser demo, Node validators, Python gateway) reads its parameters from the bindings generated from this file and is held to protocol/conformance/cases.json. The spec_version is written into every anchored batch so each on-chain record states which rules judged it. Edit this file, then run `npm run gen:gates`; never edit a generated binding by hand.",
    "source": "https://github.com/academiaseul/QWATT/blob/main/protocol/gates.spec.json",
    "numerics": {
      "boundary_rel_eps": 1e-9,
      "note": "Every ≤ comparison against a computed bound (ceiling, agreement tolerance, efficiency band) allows this relative tolerance, so an interval exactly at a limit gets the same verdict in every language regardless of floating-point evaluation order. 1e-9 is far below any instrument's resolution."
    },
    "issuance": {
      "unit": "1 QWATT = 1 MWh",
      "unit_note": "Fixed by the immutable genesis memo `QWATT genesis 1QWATT=1MWh`. Display units may say kWh; the ratio never changes.",
      "qwatt_per_kwh": 0.001,
      "precision": 7,
      "rounding": "floor",
      "basis": "min(A,B)",
      "basis_note": "With two meters the lower reading is the only one both instruments vouch for. With one meter (profiles that allow it) the basis is that meter, at assurance A1."
    },
    "parameters": {
      "nameplate_w": {
        "unit": "W",
        "description": "Array nameplate (STC). The physical ceiling every other check is scaled from."
      },
      "ceiling_k": {
        "unit": "ratio",
        "description": "Over-irradiance margin above nameplate: cold clear-sky and cloud-edge enhancement. 1.15 = 15 % headroom."
      },
      "interval_max_dt_s": {
        "unit": "s",
        "description": "Longest interval the gateway will judge. Longer intervals hide too much inside one number."
      },
      "clock_max_skew_s": {
        "unit": "s",
        "description": "Maximum difference between the node's reported ts_end and the gateway's receive time. Without trustworthy time there is no report, by design."
      },
      "elevation_min_deg": {
        "unit": "deg",
        "description": "Generation reported with the sun below this elevation is rejected. −0.833° is geometric sunset including refraction; −2.0° adds a margin for horizon and diffuse twilight."
      },
      "night_tolerance_frac": {
        "unit": "fraction of nameplate·h",
        "description": "Meter noise allowance: energy at or below nameplate_w × hours × this fraction counts as 'not generating' and never triggers the elevation gate."
      },
      "energy_power_consistency_frac": {
        "unit": "ratio",
        "description": "When a mean power is reported alongside energy, |Wh − W·h| must be within this fraction of the larger of the two. PROVISIONAL: reconcile with gateway/ingest.py before mainnet.",
        "provisional": true
      },
      "agreement.mode": {
        "unit": "enum",
        "description": "symmetric — two instruments of the same class measuring the same quantity (|A−B| bound). ac_dc_ratio — meter A is DC before an inverter, meter B is AC after it (efficiency band)."
      },
      "agreement.require_second_meter": {
        "unit": "bool",
        "description": "If true, an interval with a single meter is rejected rather than accepted at assurance A1."
      },
      "agreement.frac": {
        "unit": "ratio",
        "description": "symmetric mode: |A−B| ≤ frac × max(A,B) …"
      },
      "agreement.deadband_w": {
        "unit": "W",
        "description": "symmetric mode: … or ≤ deadband_w × hours, whichever is larger. Stops sub-watt noise from failing an honest near-zero interval."
      },
      "agreement.ac_dc_min": {
        "unit": "ratio",
        "description": "ac_dc_ratio mode: AC/DC below this is a faulty or lying instrument."
      },
      "agreement.ac_dc_max": {
        "unit": "ratio",
        "description": "ac_dc_ratio mode: AC/DC above this is impossible — an inverter cannot create energy."
      },
      "phase2.witness_ratio_min": {
        "unit": "ratio",
        "description": "Measured energy ÷ energy the reference cell's irradiance supports — lower bound."
      },
      "phase2.witness_ratio_max": {
        "unit": "ratio",
        "description": "Upper bound of the same ratio."
      },
      "phase2.witness_derate": {
        "unit": "ratio",
        "description": "Soiling, temperature and mismatch derate applied to the irradiance-implied energy."
      },
      "phase2.ramp_max_w_per_sample": {
        "unit": "W",
        "description": "Largest step between consecutive power samples; null = nameplate_w."
      },
      "phase2.variance_floor": {
        "unit": "ratio",
        "description": "σ/μ of the active power series below this is synthetic — real irradiance is noisy."
      },
      "phase2.variance_min_samples": {
        "unit": "count",
        "description": "Below this many active samples the smoothness test is skipped."
      },
      "phase2.rtc_max_drift_s": {
        "unit": "s",
        "description": "Maximum difference between the node's system clock and its hardware RTC."
      },
      "phase2.max_gaps": {
        "unit": "count",
        "description": "Maximum missing samples tolerated inside one batch."
      }
    },
    "profiles": {
      "bench": {
        "name": "Banco de pruebas — Fase 1",
        "description": "150 Wp · 12 V · two DC meters (PZEM-017 + EPEver Tracer) · 5-minute intervals · Santiago balcony facing north 30°",
        "site": {
          "lat": -33.45,
          "lon": -70.65,
          "tz": "America/Santiago"
        },
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
        }
      },
      "rooftop": {
        "name": "Techo El Arrayán — piloto",
        "description": "4.4 kWp · DC meter before the inverter, AC meter after it · 1-hour batches · Santiago rooftop",
        "site": {
          "lat": -33.35,
          "lon": -70.52,
          "tz": "America/Santiago"
        },
        "nameplate_w": 4400,
        "ceiling_k": 1.15,
        "interval_max_dt_s": 3600,
        "clock_max_skew_s": 7500,
        "elevation_min_deg": -0.833,
        "night_tolerance_frac": 0.005,
        "energy_power_consistency_frac": 0.1,
        "agreement": {
          "mode": "ac_dc_ratio",
          "require_second_meter": false,
          "ac_dc_min": 0.88,
          "ac_dc_max": 1
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
        "rule": "all numeric fields finite and ≥ 0; ts_end > ts_start; dt_s matches the timestamps within 1 s; dt_s ≤ interval_max_dt_s; clock_skew_s ≤ clock_max_skew_s; if w_mean is present, |wh − w_mean·h| ≤ energy_power_consistency_frac × max(wh, w_mean·h)",
        "params": [
          "interval_max_dt_s",
          "clock_max_skew_s",
          "energy_power_consistency_frac"
        ],
        "stops": {
          "es": "datos basura que anularían los otros controles",
          "en": "garbage input that would defeat every other check"
        },
        "on_fail": "if a value is non-finite, downstream gates are skipped — a NaN must never reach a comparison"
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
        "rule": "max(A, B) ≤ nameplate_w × hours × ceiling_k — if ANY meter exceeds the ceiling the interval is rejected",
        "params": [
          "nameplate_w",
          "ceiling_k"
        ],
        "stops": {
          "es": "alimentar el medidor desde una fuente de banco",
          "en": "feeding the meter from a bench supply"
        }
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
        "rule": "generating := max(A, B) > nameplate_w × hours × night_tolerance_frac; if generating, the solar elevation at the site (max over interval start, midpoint, end; NOAA algorithm) must be ≥ elevation_min_deg",
        "params": [
          "elevation_min_deg",
          "night_tolerance_frac",
          "site.lat",
          "site.lon"
        ],
        "stops": {
          "es": "reportar energía de noche",
          "en": "reporting energy at night"
        }
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
        "rule": "symmetric: |A − B| ≤ max(frac × max(A,B), deadband_w × hours). ac_dc_ratio: B/A ∈ [ac_dc_min, ac_dc_max] (A = DC, B = AC); if A ≤ 0 then B must be ≤ 0. If B is absent: reject when require_second_meter, else pass at assurance A1",
        "params": [
          "agreement.mode",
          "agreement.require_second_meter",
          "agreement.frac",
          "agreement.deadband_w",
          "agreement.ac_dc_min",
          "agreement.ac_dc_max"
        ],
        "stops": {
          "es": "manipular un solo instrumento",
          "en": "tampering with a single instrument"
        }
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
        "rule": "energy ÷ (irradiance/1000 × nameplate_w × witness_derate × hours) ∈ [witness_ratio_min, witness_ratio_max]; energy with a dark witness for the whole window is rejected outright",
        "params": [
          "phase2.witness_ratio_min",
          "phase2.witness_ratio_max",
          "phase2.witness_derate",
          "night_tolerance_frac"
        ],
        "stops": {
          "es": "fabricar un par M1/M2 coherente entre sí",
          "en": "fabricating a mutually consistent M1/M2 pair"
        }
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
        "rule": "no step between consecutive samples > ramp_max_w_per_sample (default nameplate_w); with ≥ variance_min_samples active samples, σ/μ must be ≥ variance_floor",
        "params": [
          "phase2.ramp_max_w_per_sample",
          "phase2.variance_floor",
          "phase2.variance_min_samples"
        ],
        "stops": {
          "es": "series sintéticas demasiado lisas o saltos imposibles",
          "en": "synthetic series that are too smooth, or impossible jumps"
        }
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
        "rule": "|rtc_delta_s| ≤ rtc_max_drift_s; seq strictly increasing; windows never overlap an attested window; prev_hash links to the previous batch",
        "params": [
          "phase2.rtc_max_drift_s"
        ],
        "stops": {
          "es": "repetir un lote ya atestiguado",
          "en": "replaying an already-attested batch"
        }
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
        "rule": "tamper flag clear; sampling gaps ≤ max_gaps",
        "params": [
          "phase2.max_gaps"
        ],
        "stops": {
          "es": "abrir la caja o desconectar sensores",
          "en": "opening the enclosure or unplugging sensors"
        }
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
    "digest": "056f1b512e353bbe27b9a0b8d1f0e79b1b84737d5a500c10f5560d5bf806f933"
  };
  if (typeof module === 'object' && module.exports) module.exports = SPEC;
  else root.QWATT_GATES_SPEC = SPEC;
}(typeof self !== 'undefined' ? self : this));
