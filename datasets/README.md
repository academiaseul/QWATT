# datasets/ — public PV data for the Deliverable 2 scale test

## pvdaq-4902-2017-09 — NIST Ground, September 2017

| | |
|---|---|
| Source | NREL, *Photovoltaic Data Acquisition (PVDAQ) Public Datasets*, OEDI Data Lake, DOI [10.25984/1846021](https://dx.doi.org/10.25984/1846021) |
| Licence | **CC BY 4.0.** Attribution: *Data: National Renewable Energy Laboratory (NREL), PVDAQ, CC BY 4.0. Converted by QWATT.* |
| System | 4902 `NIST_Ground_1`, NIST campus, Gaithersburg MD (39.1319, −77.2141), 270.7 kWp, ground mount 20° tilt, one 260 kW central inverter |
| Resolution | 1 minute, 43,178 rows (22 minutes absent in the source; kept as gaps). Each absent minute is one missing sample: 120 s between samples, within the scale run's three-period dropout limit (180 s at `sample_s` 60, V3-10), so it is still integrated. Findings 1–2 below are unchanged. |
| Meter a (DC) | `dc_power_inv_14538` — inverter-reported DC power |
| Meter b (AC) | `ac_power_meter_1864_5` — separate AC revenue meter |
| Reproduce | `node batch/datasets/pvdaq.js` → identical CSV; SHA-256 of every source file and of the output in `provenance.json` |
| Scale test | `node batch/scale.js --dataset datasets/pvdaq-4902-2017-09/dataset.json` → `evidence/scale/scale-pvdaq-4902-2017-09.json` |

**Why this system.** It is one of the few PVDAQ systems with two genuinely independent power
instruments at minute resolution: the inverter's own DC measurement and a separate AC revenue meter.
That is the spec's `ac_dc_ratio` agreement mode (DC before the inverter, AC after it). NIST's arrays
are research installations with documented instrumentation, and 2014–2018 is fully published.

**Timezone.** Timestamps are local standard time, UTC−5 with no daylight saving. This was
established from the data, not assumed. With UTC−5, generation starts at +0.5° solar elevation and
ends at −1.1°. With UTC−4 it would start 11° below the horizon.

**Gate profile.** The frozen spec (1.0.0) has no profile for this site, so `dataset.json` carries a
profile derived from the spec's `rooftop` rules, with this array's nameplate and coordinates. It is
recorded in full next to the data it judges.

## Findings worth stating in the write-up

1. **The scale test passes.** 8,640 intervals became 720 batches. The chain re-verifies end to end,
   and a second run from scratch produces the identical head hash.
2. **The gates bite on real instruments.** 6,648 intervals were accepted (28.19 MWh) and 1,992 were
   refused:

   | Reason | Intervals |
   |---|---:|
   | `agreement.eff_floor` | 1,942 |
   | `plausibility.energy_power` | 306 |
   | `agreement.ac_over_dc` | 20 |
   | `elevation.night` | 13 |

   (Intervals can carry more than one reason, so these sum to more than 1,992.)

3. **Most refusals are a profile mismatch, not bad data, and the threshold was deliberately not
   tuned.** The `rooftop` floor (AC/DC ≥ 0.88) was set for a 4.4 kWp residential inverter. This
   2010-era central inverter, metered after the transformer, runs at a daily median AC/DC near 0.90
   with a tail down to about 0.80 at partial load. That puts about 20% of the DC energy under the
   floor. Lowering the floor after seeing the data would be tuning the gate to pass. The honest
   reading is the spec's own principle: thresholds are per site, and a utility-scale chain needs its
   own profile. That belongs in a spec version bump, which is out of this sprint's freeze.
4. **A third instrument is available.** The seven combiner-box DC shunts (`shuntpdc_kw_avg_1…7`)
   sum to a steady about 5.5% below the inverter's DC. It is a candidate symmetric DC/DC pairing
   (the bench's shunt-meter-plus-telemetry design) once that offset is understood.
