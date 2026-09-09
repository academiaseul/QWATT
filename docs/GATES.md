# QWATT verification gates — spec 1.0.0

> GENERATED from `protocol/gates.spec.json` (sha256 `056f1b512e353bbe…`). Do not edit; run `npm run gen:gates`.

Single source of truth for every threshold and rule that decides whether a metered energy interval is accepted. Every implementation (browser demo, Node validators, Python gateway) reads its parameters from the bindings generated from this file and is held to protocol/conformance/cases.json. The spec_version is written into every anchored batch so each on-chain record states which rules judged it. Edit this file, then run `npm run gen:gates`; never edit a generated binding by hand.

## Issuance

- **Unit:** 1 QWATT = 1 MWh — Fixed by the immutable genesis memo `QWATT genesis 1QWATT=1MWh`. Display units may say kWh; the ratio never changes.
- **Basis:** `min(A,B)` — With two meters the lower reading is the only one both instruments vouch for. With one meter (profiles that allow it) the basis is that meter, at assurance A1.
- **Rounding:** floor, 7 decimals (Stellar precision). `qwatt_per_kwh = 0.001`

## Gates

| Gate | Validator | Phase | Level | Rule | Stops |
|---|---|---|---|---|---|
| **G0** Plausibility (`plausibility`) | V6 | 1 | interval | all numeric fields finite and ≥ 0; ts_end > ts_start; dt_s matches the timestamps within 1 s; dt_s ≤ interval_max_dt_s; clock_skew_s ≤ clock_max_skew_s; if w_mean is present, |wh − w_mean·h| ≤ energy_power_consistency_frac × max(wh, w_mean·h) | garbage input that would defeat every other check |
| **G1** Nameplate ceiling (`nameplate`) | V1 | 1 | interval | max(A, B) ≤ nameplate_w × hours × ceiling_k — if ANY meter exceeds the ceiling the interval is rejected | feeding the meter from a bench supply |
| **G2** Solar elevation (`elevation`) | V2 | 1 | interval | generating := max(A, B) > nameplate_w × hours × night_tolerance_frac; if generating, the solar elevation at the site (max over interval start, midpoint, end; NOAA algorithm) must be ≥ elevation_min_deg | reporting energy at night |
| **G3** Meter agreement (`agreement`) | V3 | 1 | interval | symmetric: |A − B| ≤ max(frac × max(A,B), deadband_w × hours). ac_dc_ratio: B/A ∈ [ac_dc_min, ac_dc_max] (A = DC, B = AC); if A ≤ 0 then B must be ≤ 0. If B is absent: reject when require_second_meter, else pass at assurance A1 | tampering with a single instrument |
| **G4** Sun witness (`witness`) | V4 | 2 | batch | energy ÷ (irradiance/1000 × nameplate_w × witness_derate × hours) ∈ [witness_ratio_min, witness_ratio_max]; energy with a dark witness for the whole window is rejected outright | fabricating a mutually consistent M1/M2 pair |
| **G5** Ramp and plausibility (`ramp`) | V5 | 2 | batch | no step between consecutive samples > ramp_max_w_per_sample (default nameplate_w); with ≥ variance_min_samples active samples, σ/μ must be ≥ variance_floor | synthetic series that are too smooth, or impossible jumps |
| **—** Chain and clock (`chain`) | V6 | 2 | batch | |rtc_delta_s| ≤ rtc_max_drift_s; seq strictly increasing; windows never overlap an attested window; prev_hash links to the previous batch | replaying an already-attested batch |
| **G6** Node integrity (`integrity`) | V7 | 2 | batch | tamper flag clear; sampling gaps ≤ max_gaps | opening the enclosure or unplugging sensors |

## Profiles

| Parameter | Unit | `bench` | `rooftop` | Meaning |
|---|---|---:|---:|---|
| `nameplate_w` | W | 150 | 4400 | Array nameplate (STC). The physical ceiling every other check is scaled from. |
| `ceiling_k` | ratio | 1.15 | 1.15 | Over-irradiance margin above nameplate: cold clear-sky and cloud-edge enhancement. 1.15 = 15 % headroom. |
| `interval_max_dt_s` | s | 900 | 3600 | Longest interval the gateway will judge. Longer intervals hide too much inside one number. |
| `clock_max_skew_s` | s | 7500 | 7500 | Maximum difference between the node's reported ts_end and the gateway's receive time. Without trustworthy time there is no report, by design. |
| `elevation_min_deg` | deg | -2 | -0.833 | Generation reported with the sun below this elevation is rejected. −0.833° is geometric sunset including refraction; −2.0° adds a margin for horizon and diffuse twilight. |
| `night_tolerance_frac` | fraction of nameplate·h | 0.005 | 0.005 | Meter noise allowance: energy at or below nameplate_w × hours × this fraction counts as 'not generating' and never triggers the elevation gate. |
| `energy_power_consistency_frac` | ratio | 0.1 | 0.1 | When a mean power is reported alongside energy, |Wh − W·h| must be within this fraction of the larger of the two. PROVISIONAL: reconcile with gateway/ingest.py before mainnet. *(provisional)* |
| `agreement.mode` | enum | symmetric | ac_dc_ratio | symmetric — two instruments of the same class measuring the same quantity (|A−B| bound). ac_dc_ratio — meter A is DC before an inverter, meter B is AC after it (efficiency band). |
| `agreement.require_second_meter` | bool | true | false | If true, an interval with a single meter is rejected rather than accepted at assurance A1. |
| `agreement.frac` | ratio | 0.05 | — | symmetric mode: |A−B| ≤ frac × max(A,B) … |
| `agreement.deadband_w` | W | 2 | — | symmetric mode: … or ≤ deadband_w × hours, whichever is larger. Stops sub-watt noise from failing an honest near-zero interval. |
| `agreement.ac_dc_min` | ratio | — | 0.88 | ac_dc_ratio mode: AC/DC below this is a faulty or lying instrument. |
| `agreement.ac_dc_max` | ratio | — | 1 | ac_dc_ratio mode: AC/DC above this is impossible — an inverter cannot create energy. |
| `phase2.witness_ratio_min` | ratio | 0.5 | 0.5 | Measured energy ÷ energy the reference cell's irradiance supports — lower bound. |
| `phase2.witness_ratio_max` | ratio | 1.6 | 1.6 | Upper bound of the same ratio. |
| `phase2.witness_derate` | ratio | 0.8 | 0.8 | Soiling, temperature and mismatch derate applied to the irradiance-implied energy. |
| `phase2.ramp_max_w_per_sample` | W | null | null | Largest step between consecutive power samples; null = nameplate_w. |
| `phase2.variance_floor` | ratio | 0.005 | 0.005 | σ/μ of the active power series below this is synthetic — real irradiance is noisy. |
| `phase2.variance_min_samples` | count | 30 | 30 | Below this many active samples the smoothness test is skipped. |
| `phase2.rtc_max_drift_s` | s | 60 | 60 | Maximum difference between the node's system clock and its hardware RTC. |
| `phase2.max_gaps` | count | 2 | 2 | Maximum missing samples tolerated inside one batch. |
| `site.lat`, `site.lon` | deg | -33.45, -70.65 | -33.35, -70.52 | Site coordinates for the solar-elevation gate. |

- **`bench`** — Banco de pruebas — Fase 1: 150 Wp · 12 V · two DC meters (PZEM-017 + EPEver Tracer) · 5-minute intervals · Santiago balcony facing north 30°
- **`rooftop`** — Techo El Arrayán — piloto: 4.4 kWp · DC meter before the inverter, AC meter after it · 1-hour batches · Santiago rooftop

## Conformance

Every binding is run against `protocol/conformance/cases.json` in CI (`npm test`). A case states the input interval, the profile, the expected verdict and the exact set of gates expected to fail. Divergence between implementations fails the build.
