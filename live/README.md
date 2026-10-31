# live/ — the seven-day live run (Deliverable 4)

SOW: *"the full pipeline anchoring every interval through the multisig at real-time pace, fed by
the solar simulator and the CSV replay adapter"*, with fault injections that *"must appear in the
public rejection log with its reason"*.

```
simulator.js ──► samples/<hour>.csv (+ SHA-256 in samples/manifest.jsonl), published once its time has passed
   ▲ faults from schedule.js (published first as faults.json)
   │
run.js ──► CSV replay adapter, real-time pace ──► interval builder ──► gates ──► batch pipeline ──► feed
                                                                                        │   (raw/<batch_id>.jsonl:
                                                                                        │    each batch's raw payloads)
                        proposer (anchor/proposer.js) signs ◄──────────────────────────┘
                        verifier (anchor/verifier.js, other host) co-signs from the public feed
audit.js ──► every fault refused for its reason · every 5-minute slot judged once · samples hash-intact
             · every raw payload is a published samples row
```

| File | Role |
|---|---|
| `simulator.js` | The Phase 1 bench rig as numbers: 150 Wp in Santiago, real sun position, deterministic clouds, two DC meters at their real resolutions, 10 s samples. A pure function of (seed, time), so any minute regenerates identically. |
| `schedule.js` | Eight injections, each of the four SOW kinds twice. Grid-aligned whole intervals, placed by solar position. |
| `run.js` | Runs or resumes the run. Publishes `faults.json` first; refuses a restart with a different seed or length. In real time it resumes at *now* (gaps stay visible, never backfilled) and replays no sample before its timestamp. Each samples file (one per UTC hour in real time, one per UTC day when accelerated) is written to `samples/` before its rows are replayed, so it is on the host's disk up to an hour ahead; `ops/publish-feed.js` publishes it and its manifest line only once the line's `to` has passed, so no sample is public before its time (V3-13c). `faults.json` carries the fixed label "Simulated input · assurance A0 · Stellar testnet", the commit of the code the run was started from (`code_commit`) and the three signer public keys (`anchoring.signers`), which the reconciliation reads to tell who signed each anchor. The run's `site_id` is the neutral `qwatt-chispa-01` (FD-14, set in `run.js`, not configurable), so every batch id is `qwatt-chispa-01-000000`, `qwatt-chispa-01-000001`, … and names no place: the reconciliation page shows them. A real-time run needs `--proposer G… --verifier G… --third G…` (public keys) and a git checkout (or `--code-commit`). A restart refuses a `faults.json` without the label or with other keys. It exits 0 at `run_end`, so `qwatt-live.service` (`Restart=on-failure`, V3-13a) leaves it stopped, and 2 when its signer keys are missing or malformed, which the unit does not restart (`RestartPreventExitStatus=2`). Any other error, including the refusals above, exits 1 and is restarted every 10 s. |
| `audit.js` | The acceptance check, from the published feed alone. Since V3-5 it also ties every payload in `raw/<batch_id>.jsonl` (what each batch's `samples_root` commits to) to a row of a published samples file, so nothing in `raw/` was made up. |
| `live.test.js` | Accelerated multi-day runs, crash/restart, tamper detection, the raw-payload audit, and what `faults.json` must carry (label, signer keys, code commit) (CI). |

| Fault | Injection | Expected reason |
|---|---|---|
| Shaded sensor | meter b reads 40% low, 20 min at high sun | `agreement.diverge` |
| Disconnected meter | meter b sends nothing, 20 min | `agreement.diverge` (b closes with 0 samples) |
| Night injection | 80 W claimed near solar midnight, 15 min | `elevation.night` |
| Implausible ramp | 0 → 400 W within one sample, 5 min | `nameplate.over` (dedicated ramp gate deferred to Instaward #2, freeze D-10) |

```bash
node live/run.js --feed feed --days 8 --start 2026-11-07T03:00:00Z --proposer G… --verifier G… --third G…   # the live run, real-time pace (W3-4)
node live/audit.js feed                                    # any time during or after the run
node live/run.js --feed /tmp/f --days 7 --speed fast       # the whole week in seconds (rehearsal)
```

## What the accelerated week shows (`--speed fast`, seed 20261103, start 2026-11-03T03:00Z)

- 2,016 of 2,016 five-minute intervals judged, 0 gaps; 168 hourly batches; the chain re-verifies.
- All 8 injections refused, each with its expected reason.
- 7 refusals outside the windows, all explained:
  - **2 are the leading edge of the night injections.** The first faulty sample forms a trapezoid
    with the last normal one, so a sliver of fault energy (0.11 Wh) falls in the preceding
    interval. Refusing it is correct.
  - **5 are dusk and dawn intervals with 0–11 mWh**, refused by G0's energy/power consistency
    check. That check uses a purely relative 10% tolerance, so quantization noise near zero trips
    it. The agreement gate already has an absolute deadband for exactly this. Candidate for spec
    1.1: an absolute floor on `energy_power_consistency`. Not changed now (spec frozen).

## Receive time: `clock_skew_s` (V3-6)

Every interval carries `clock_skew_s`, receive time − `ts_end` in whole seconds, stamped by the
interval builder when it closes the interval (`ingest/README.md`, *clock_skew_s*). Which clock gives
the receive time depends on the speed (`builderClock` in `run.js`):

- **Real time** (`--speed realtime`, the real run): the host clock. The value is how late the
  closing sample was replayed, normally 0–10 s. A runner that falls more than 7500 s behind the host
  clock gets `plausibility.skew` on every interval until it is restarted (`docs/RUNBOOK.md`,
  `FEED_STALE`).
- **Accelerated** (`--speed fast` or any number, 1 included, because like any replay it resumes
  where the feed ends): the replay clock, the latest sample timestamp replayed. In the accelerated
  week `clock_skew_s` is 0 except on the 8 disconnected-meter intervals (300: meter b is silent, so
  the one-interval grace closes them) and at the final flush (−10: the last interval is closed 10 s
  before its end). The verdict counts above are unchanged.
