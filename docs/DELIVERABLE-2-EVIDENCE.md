# Deliverable 2 evidence · evidence batches and hash chain

**Every Deliverable 2 build item is built and tested. On public `main`, judged intervals become evidence batches in canonical JSON with integers only, each hashed with SHA-256 and chained to the one before by `prev_hash`. Every batch is published with its accepted and rejected ledgers, and only accepted batches are anchored. One month of public PV data (NREL PVDAQ, 8,640 intervals) becomes 720 batches whose chain re-verifies end to end and comes out identical on a second run.** [CI run #257](https://github.com/academiaseul/QWATT/actions/runs/42599535094) at `9ee4646`, the commit the live run started from (tag `code-freeze`), runs all of it, and [`evidence/scale/scale-pvdaq-4902-2017-09.json`](../evidence/scale/scale-pvdaq-4902-2017-09.json) is the scale-test output that CI reproduces. Since Tue 10 Nov 03:00 UTC the live run publishes its batches and ledgers in this format. What still needs a founder decision is listed at the end.

- **Date:** Tue 10 Nov 2026 (Day 23), the live run's first day. The feed, chain and CI facts below were read from the public repositories, the GitHub API and Horizon testnet between 20:50 and 21:06 UTC (17:50–18:06 Chile time).
- **SOW:** Deliverable 2 as written in SOW final v4 (September 2026): §4 Scope, §5 Week 2 and §6 Evidence of Completion.
  - That text is not in the repository. The quotations below are from it.
  - `docs/PHASE-0-BUILD-PLAN.md` §5, written from v4, splits the same work into units 2.1 to 2.7.
- **Calendar:** Day 1 is Mon 19 Oct 2026, and Chile time is UTC−3 for the whole sprint.
  - **Prior work, not funded:** the batch layer and the scale test: `8b112aa` (8 Oct 2026: evidence batches, hash chain, freeze v2 draft) and `604ed77` (8 Oct: the NREL PVDAQ dataset), merged into `main` on 20 Oct by `35a1e77`. See [`docs/PRIOR-WORK.md`](PRIOR-WORK.md).
  - **Built in the sprint:** the changes in weeks 1 to 3 listed under "Changed during the sprint", among them the `samples_root` field the SOW asks for (week 2).
- **Commits:** read from `main` at `4e56a1f` (10 Nov, after [PR #67](https://github.com/academiaseul/QWATT/pull/67)). No Deliverable 2 file differs from `9ee4646`: `git diff --stat 9ee4646 4e56a1f -- batch protocol datasets evidence/scale evidence/feeds ops/sample-feeds.js package.json .github` prints nothing.
- **Scope:** Stellar testnet only. All input is simulated or historical, at assurance A0. The QWATT testnet asset is used only as the anchoring vehicle. QWATT is not electricity, a security, a renewable energy certificate (REC) or a carbon credit.

> **Resumen.** El Entregable 2 (lotes de evidencia y cadena de hashes) está construido y probado. Cada lote es JSON canónico, solo con enteros, lleva su SHA-256 y el hash del lote anterior (`prev_hash`). Todo lote se publica, aceptado o rechazado, junto con los registros de intervalos aceptados y rechazados y sus códigos de motivo; solo los lotes aceptados se anclan en Stellar testnet. La prueba de escala pasa un mes de datos públicos de NREL (8.640 intervalos) a 720 lotes: la cadena se verifica completa y una segunda corrida da el mismo hash final. El CI está en verde en `9ee4646`, el commit de la corrida en vivo (corrida #257). Desde el martes 10 a las 00:00 hora de Chile, la corrida publica sus lotes en este formato, y su primer rechazo (al amanecer, como estaba previsto) ya está en el registro público.
>
> Lo pendiente está al final. Lo principal, de los fundadores:
> - decidir cómo se describe que los casos de conformidad de lotes corren en `batch/batch.test.js` y no en `protocol/conformance.test.js`;
> - corregir en `protocol/FEED-FORMAT.md` la duración de la corrida (dice 8 días con un día de prueba; la corrida dura 7);
> - acordar la redacción pública del primer anclaje en una cuenta 2/2/3 (7 nov) y de la detención del verificador del lunes 9.
>
> Todo es simulado o histórico y solo en Stellar testnet.

## Build items (SOW §4, Deliverable 2)

| SOW requirement | Status | Evidence |
|---|---|---|
| "Batch definition (batch.schema.json): batch id, start and end timestamps, interval count, accepted and rejected interval counts, schema version, gate specification version, previous batch hash, Merkle root over raw samples, cumulative energy, and the SHA-256 of the canonical JSON" | Built. Batch schema 1.1.0; every field the SOW names is required. | [`protocol/batch.schema.json`](../protocol/batch.schema.json) (`x-schema-version` 1.1.0, `additionalProperties: false`). SOW field → schema field: batch id → `batch_id` (`<site_id>-<seq padded to 6>`); start and end → `ts_start`, `ts_end`; interval count → `interval_count`; accepted and rejected counts → `accepted_count`, `rejected_count`; schema version → `schema_version` (of the interval records); gate specification version → `spec_version`; previous batch hash → `prev_hash` (64 zeros for the first batch); Merkle root over raw samples → `samples_root`, required since 1.1.0 (V3-5); cumulative energy → `cumulative_mwh`; SHA-256 of the canonical JSON → `sha256`. The schema adds `site_id`, `node_id`, `seq`, `intervals` (the accepted records), `intervals_root` and `energy_mwh`. `batch/verify.js` `verifyBatch` checks each field (`batch.schema_invalid`, `batch.id_mismatch`, `batch.spec_mismatch`, `batch.count_mismatch`, `batch.window_mismatch`, …). Test: "a closed batch carries samples_root over one raw line per judged interval, and batch schema 1.1.0 requires it". |
| "Batch assembly: intervals → canonical JSON → SHA-256 → prev_hash chain; energies stored as integers so no floating-point value ever reaches a hash" | Built | `protocol/evidence.js` is the one definition of the hash rules: `canonical` (sorted keys, no whitespace; any number that is not a safe integer throws, so `1.5` or `Infinity` never reaches a hash), `merkleRoot`, `samplesRoot` and `batchSha256` (SHA-256 of the canonical batch without its own `sha256`). `batch/assemble.js` `BatchAssembler` judges each interval (ingest checks, then gates G0–G3) and closes a batch every 12 judged intervals or on restart, with `prev_hash` set to the previous batch's `sha256`. Energies are integer mWh: `protocol/interval.schema.json` has no `number` field (conformance test "no floating-point field survives in the interval schema"), and `energy_mwh` sums the lower of the two meters (`basisMwh`). Tests in `batch/batch.test.js`: "canonical refuses every non-integer number", "a window closes every 12 intervals; genesis prev_hash is 64 zeros", "chain links, energy is the sum of min(A,B), cumulative carries across batches", "every tampering is caught — even when the attacker recomputes sha256", "the same input always produces the same head hash". |
| "Publication and anchoring are distinct: every batch, accepted or rejected, is published; only accepted batches are anchored on Stellar" | Built | `batch/assemble.js` `close()` checks each new batch with `verifyBatch`, the function the independent verifier runs, and marks it `accepted` or `rejected` with its reasons. `batch/pipeline.js` publishes it either way through `batch/feed.js`, to `batches/<batch_id>.json` and `ledger/batches.jsonl`. The proposer takes only `accepted` entries (`anchor/chain.js` `nextToAnchor`, called from `anchor/proposer.js` `tick`). A rejected batch carries the previous `cumulative_mwh` unchanged, so the anchored total is the energy of accepted batches only (V3-3). Rules: freeze v2 D-3 and D-5, freeze v3 §4. Tests: "a refused batch carries the total forward unchanged and never moves the floor; only accepted batches add energy (batch.cumulative_mismatch)" (`batch/batch.test.js`) and "a batch published as rejected carries the total forward unchanged: the walk passes through it and the on-chain total is the energy of accepted batches only (verifier.head_mismatch)" (`anchor/recovery.test.js`). In the sample feed, batch 6 is published as rejected (`batch.site_mismatch`) and keeps batch 5's total, 192,283 mWh. |
| "Accepted and rejected ledgers with reason codes (append-only JSONL)" | Built | `batch/feed.js` appends one line per judged interval to `ledger/accepted.jsonl` or `ledger/rejected.jsonl`, and one line per batch to `ledger/batches.jsonl`. Each line is written with `fsync` and never rewritten. A rejected line carries `reasons`: gate codes are registered in `protocol/gates.spec.json`, every other code in [`protocol/reasons.json`](../protocol/reasons.json) (registry 1.1.0: 10 `ingest.*`, 21 `batch.*`, 7 `verifier.*`). Test: "every reason code the batch layer emitted is registered"; an unregistered code fails it. In the public repositories, `ops/publish-feed.js` checks that every `.jsonl` only grows before each push, and `ops/evidence-audit.js` checks it over the whole history. |
| "Evidence manifest format for public download" | Built | [`protocol/FEED-FORMAT.md`](../protocol/FEED-FORMAT.md) is the format. It lists every path in `qwatt-evidence/<run>/` and `qwatt-verifier-log/<run>/`, who writes it, what it holds, and whether it is written once, replaced or only grows. In each feed, `index.json` names the head (`latest_batch_id`, `head_sha256`, `cumulative_mwh`, versions), `ledger/batches.jsonl` lists the chain in order, and `raw/<batch_id>.jsonl` holds the raw payloads behind `samples_root`. The live run adds `faults.json` (the run definition, published before the first sample) and `samples/manifest.jsonl` (SHA-256 of each samples file). The two sample feeds add `feed.json` (label, anchoring, expected refusals), written by `ops/sample-feeds.js`. |
| "Batch-level conformance cases added to the existing suite" | Built. They run in `npm test` and in CI's `gates` job, through `batch/batch.test.js` (see decision 1). | [`protocol/conformance/batch-cases.json`](../protocol/conformance/batch-cases.json), next to the gate cases in `protocol/conformance/cases.json`. It pins the `intervals_root`, `samples_root`, `energy_mwh`, `cumulative_mwh`, `prev_hash` and `sha256` of a three-batch chain, the empty root, and five `samples_root` vectors; its description says any implementation of `protocol/evidence.js` "in any language must reproduce these exactly". `batch/batch.test.js` holds them in "pinned fixture: batch hashes are reproducible across implementations", with 44 other batch tests: tampering, chain breaks, restart, determinism and raw payloads. `ops/protocol-browser.test.js` checks that the browser build of the same code gives the same results on these vectors. |
| "Scale test: one month of a public PV dataset (historical data — the replay runs in minutes) pushed through the batch pipeline to exercise chaining across thousands of intervals" | Built, passing | `batch/scale.js --dataset datasets/pvdaq-4902-2017-09/dataset.json`. The data: NREL PVDAQ system 4902 (`NIST_Ground_1`), September 2017, CC BY 4.0 (DOI 10.25984/1846021), 1-minute readings from two separate instruments, the inverter's DC power and an AC revenue meter. 43,178 rows go through the CSV adapter and the batch pipeline: 8,640 intervals, 720 batches. `batch/verify-cli.js` then re-derives the whole feed from its files, and the run is repeated from scratch; the head must be the same. Output: `chain VERIFIED · second run IDENTICAL`, and with `--expect`, `evidence scale-pvdaq-4902-2017-09.json REPRODUCED`. The data is pinned: `datasets/pvdaq-4902-2017-09/provenance.json` holds the SHA-256 of each of the 30 daily source files and of the CSV (`fc51d15b…`), and `dataset.json` hashes to `835814d9…`, the value freeze v3 §1 pins. |

## Week 2 plan and expected output (SOW §5)

| SOW requirement | Status | Evidence |
|---|---|---|
| "Batch assembly and hash chain; accepted and rejected ledgers; evidence manifest; batch-level conformance; historical scale test (runs in minutes)." | Built (prior work, changed in weeks 1 to 3) | See the build table. In week 2 itself, `samples_root` became required (V3-5, [PR #24](https://github.com/academiaseul/QWATT/pull/24), merged 27 Oct), and the scale test was re-run on it: its head is now `99e22999…`, replacing `cb3d1050…` (freeze v3 §9, note of Sat 31 Oct). |
| Expected output: "intervals become hash-chained evidence batches, with rejections recorded and published with reasons." | Met | In the sample feed and the scale test (above). In public since Tue 10 Nov: the live run's feed has 17 batches chained from genesis, each re-derived by `batch/verify-cli.js`, and its first refused interval published with its reason. See "The live run's first day". |

## Evidence of completion (SOW §6, Deliverable 2)

| SOW evidence | Status | Where |
|---|---|---|
| Sample evidence batches and manifests | Done | **In the repository:** [`evidence/feeds/muestra/`](../evidence/feeds/muestra/), a simulated day (20 Sep 2026, 06:00–14:00 Chile time) built by the repository's own code with deliberate faults, not anchored. It has 8 batches (7 accepted, 1 rejected), with `feed.json`, `index.json`, `batches/`, `raw/` and `ledger/`. `node batch/verify-cli.js evidence/feeds/muestra` prints `8 batches (7 accepted, 1 rejected) · cumulative 287814 mWh · head 31d63334…` and `OK — every published batch re-derives from the feed`. **In public:** [`academiaseul/qwatt-evidence`](https://github.com/academiaseul/qwatt-evidence), folders `run/` (the live run), `rehearsal-2026-11-07/` (24 batches) and `rehearsal-2026-11-09/` (1 batch). Each re-derives with `verify-cli`. |
| Accepted and rejected ledgers with reason codes | Done | **Sample:** `evidence/feeds/muestra/ledger/`. `rejected.jsonl` has the five planned interval refusals (`elevation.night`, `ingest.off_grid`, `agreement.diverge`, `nameplate.over`, `ingest.duplicate_interval`), and `batches.jsonl` has batch 6 `rejected` with `batch.site_mismatch`. `ops/sample-feeds.js --check` requires each one to be there. **Live:** [`run/ledger/rejected.jsonl`](https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/run/ledger/rejected.jsonl). Its first line is the interval 09:45–09:50 UTC on 10 Nov, refused with `plausibility.energy_power`. |
| Scale-test output: an unbroken hash chain over one month of historical intervals | Done | [`evidence/scale/scale-pvdaq-4902-2017-09.json`](../evidence/scale/scale-pvdaq-4902-2017-09.json), SHA-256 `e405b5fa30b87275555bc62c09831045292032b1584105b0310cc094738b848c`: 43,178 rows, 8,640 intervals, 720 batches (720 accepted), `cumulative_mwh` 28,188,051,204, head `99e229992a2d9b4588d7abb807e159e37b01d9edda3908f58eb8d3d43e1790c3`, `chain_verified: true`, `deterministic: true`, `problems: []`. CI step 9 reproduces it on every run of the workflow. It was reproduced again for this page (Node 24.14.1, 16.6 s per run; the file records 18.1 s). |
| Conformance suite run (CI link) | Done | [Run #257](https://github.com/academiaseul/QWATT/actions/runs/42599535094) on `main`: push of `9ee4646`, 9 Nov 2026 10:15 UTC, success. In job [`gates`](https://github.com/academiaseul/QWATT/actions/runs/42599535094/job/129100286620), all success: step 5 "Conformance suite (shared engine, schema, bindings)", step 8 "Batch conformance (Deliverable 2) — hash chain, tamper suite, restart safety", step 9 "Scale test (Deliverable 2) — NREL PVDAQ NIST Ground, Sept 2017 (CC BY 4.0), chain verified, deterministic, reproduces the committed evidence" and step 27 "Sample feeds are current and re-derive (evidence/feeds: the anchored 8 Oct batches and the sample day)". Latest on `main`: [run #262](https://github.com/academiaseul/QWATT/actions/runs/42881226249) on `4e56a1f`, 10 Nov 19:02 UTC, success. The workflow, `.github/workflows/conformance.yml`, runs on pushes to `main` and `semana-2/**` and on pull requests. |

**SOW §6 checklist.** Every evidence line for "Evidence Batches & Hash Chain" is in place, so this page reads it as PRESENT. The reviewer marks the checklist.

## The live run's first day

The live run started on Tue 10 Nov 2026 at 00:00 Chile time (03:00 UTC) from `9ee4646`, the `code_commit` in [`run/faults.json`](https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/run/faults.json). It ends on Tue 17 Nov at 00:00 Chile time (03:00 UTC). Read from `qwatt-evidence` at commit `1ed200d` (20:56 UTC):

- **17 batches,** `qwatt-chispa-01-000000` to `000016`, all accepted and chained from genesis. `node batch/verify-cli.js` re-derives every one: head `3254f8c0…`, `cumulative_mwh` 620,035.
- **All 17 anchored** on the run account [`GDSEQAD3…4MDC`](https://horizon-testnet.stellar.org/accounts/GDSEQAD3B5YTX3TYA6L3U65X6IGAGET67OHQFMKNC4O5AJFVEIVL4MDC) (thresholds 2/2/3, three signers of weight 1, master weight 0), memos `QW#0` to `QW#16`:
  - from QW#0, [`31b72314…`](https://horizon-testnet.stellar.org/transactions/31b723146869494fdb21ee613d55f1f5ba090d562afc6b7bce4c1072d2890856) (ledger 5,651,924, 04:01 UTC);
  - to QW#16, [`70e3f820…`](https://horizon-testnet.stellar.org/transactions/70e3f82048cc2390997e533b7bc0d650b7bc98e8a3b500cbde66d25314d695ea) (ledger 5,663,449, 20:01 UTC).

  The account's `qwatt.anchor.sha256` and `qwatt.cumulative_mwh`, read on Horizon, equal that head and its total.
- **The first refusal.** The interval 09:45–09:50 UTC (06:45 Chile time, at dawn) is in `run/ledger/rejected.jsonl` with `plausibility.energy_power` (1 mWh on each meter).
  - It was public at 09:50:46 UTC (`qwatt-evidence` commit `6690ded`), before its batch closed.
  - `live/expected-run.json` listed it before the run as the first of 30 expected refusals. It is the dawn and dusk case B-3 of freeze v2 (see "Known limitations").
- **Its batch was anchored without it.** `qwatt-chispa-01-000006` (09:00–10:00 UTC) judged 12 intervals: 11 accepted and 1 rejected. The rejected one is counted in `rejected_count` and is not in `intervals`. QW#6, [`61f01701…`](https://horizon-testnet.stellar.org/transactions/61f01701ef70f6ef3d4f5ae70e8aafee9123cdec3185eab7ba771b974cfb95fb) (ledger 5,656,245), writes the batch hash `6b436b9d…` and the total 230 mWh. Publication and anchoring stay apart on the live chain.
- **The audit.** `node live/audit.js <clone>/run --expected live/expected-run.json` reports:
  - 215 of 215 intervals judged, no gap;
  - 6,120 raw payloads in 17 raw files, each one a row of a published samples file;
  - 1 of 30 expected refusals matched, 29 not judged yet.

  The eight faults fall on Wed 11 to Mon 16 Nov. Their appearance in the rejection log is Deliverable 4 evidence.

**The first anchor on a 2/2/3 account with the sprint's three keys** came in the rehearsal of Sat 7 Nov: [`13457b4b…`](https://horizon-testnet.stellar.org/transactions/13457b4b27fbfbe0743c6ff3664c0f89427bf3659f683df522799ff3fe14a9a8), ledger 5,614,274, 23:43 UTC, memo `QW#0`, on the rehearsal account `GBITY…HFC2`. It anchors batch `6f448901…` of `qwatt-evidence/rehearsal-2026-11-07/`, whose 24 batches re-derive with `verify-cli`.

## Changed during the sprint

**Week 1 (19–23 Oct).** Merged on 21 Oct as [PR #7](https://github.com/academiaseul/QWATT/pull/7), [PR #5](https://github.com/academiaseul/QWATT/pull/5), [PR #1](https://github.com/academiaseul/QWATT/pull/1) (tests) and [PR #8](https://github.com/academiaseul/QWATT/pull/8) (fix):
- **V3-1 (S1):** before co-signing, the verifier walks back from the batch to the on-chain head, rehashing each batch and re-adding the totals.
- **V3-2 (S2):** checks across batches. Timestamps must be canonical and on the 5-minute grid, no interval may repeat or overlap another, and all must come from one site and node. New codes: `batch.interval_repeated`, `batch.interval_overlap`, `batch.interval_off_grid`, `batch.site_mismatch`, `batch.window_mismatch`, and `ingest.off_grid` at the door.
- **V3-3 and DV-1 to DV-5:**
  - a rejected batch carries no energy;
  - the floor is the last accepted batch;
  - nothing is read from an earlier batch before it rehashes;
  - the door applies the verifier's rules (`ingest.site_mismatch`, `ingest.overlap`);
  - the walk is bounded and has its own code (`verifier.walk_too_long`).

**Week 2 (26–30 Oct).**
- **V3-5 and DV-6, `samples_root` required** (batch schema 1.1.0; [PR #24](https://github.com/academiaseul/QWATT/pull/24), merged 27 Oct). The raw payloads are published at `raw/<batch_id>.jsonl` and every reader recomputes the root. The scale test was re-run: head `cb3d1050…` → `99e22999…`.
- **V3-5b:** the live-run audit ties every raw payload to a row of a published samples file ([PR #28](https://github.com/academiaseul/QWATT/pull/28)).
- **V3-10:** no energy across a meter dropout longer than three sample periods ([PR #20](https://github.com/academiaseul/QWATT/pull/20)).
- **V3-7a and V3-7c:** the publisher for the two public repositories, its rules and the history audit ([PR #19](https://github.com/academiaseul/QWATT/pull/19)); readers pinned to one commit of the evidence ([PR #29](https://github.com/academiaseul/QWATT/pull/29)).
- **CI:** every suite step runs even after an earlier one fails ([PR #13](https://github.com/academiaseul/QWATT/pull/13)); Node 24.14.1, the version both hosts run ([PR #34](https://github.com/academiaseul/QWATT/pull/34)).

**Week 3 (2–6 Nov).**
- **V3-12:** an interval refused for its time moves no watermark ([PR #39](https://github.com/academiaseul/QWATT/pull/39), merged Sat 31 Oct).
- **V3-11:** a verifier refusal is final. `verify-cli` and the reconciliation accept a link that skips a batch only where the verifier log refused it ([PR #43](https://github.com/academiaseul/QWATT/pull/43); `34a8bc3`; [PR #51](https://github.com/academiaseul/QWATT/pull/51)).

**Test results.** `npm test` passes on `4e56a1f` (Node 24.14.1, on Windows, 3 min 37 s). Within it:
- `node batch/batch.test.js`: 45 passed, 0 failed;
- `node protocol/conformance.test.js`: 40 passed;
- `node ops/protocol-browser.test.js`: 29 passed;
- `node ops/site-evidence.test.js`: 13 passed.

## Deviations that touch Deliverable 2

All are approved and recorded in [`docs/ARCHITECTURE-FREEZE-v3.md`](ARCHITECTURE-FREEZE-v3.md); none is new on this page.

- **V3-5 and DV-6 · `samples_root`.** Freeze v2 (D-6) kept `samples_root` optional for this sprint. Freeze v3 made it required (V3-5), because the SOW lists it as a batch field. As built (DV-6):
  - the leaves are the raw payload bytes (a CSV row, an HTTP body, or one Modbus poll's reply frames), grouped in runs with a count `n`;
  - raw lines go in time order, accepted before refused at a tie, unreadable last;
  - the exemption for a record posted whole applies only to `http-json`.

  Both founders approved it (25 and 27 Oct). Rules R1–R4 are in `protocol/batch.schema.json` and `ingest/README.md`.
- **V3-3 · a rejected batch carries no energy.** Under freeze v2, a rejected batch's energy entered the total.
- **Scale-test head.** It was `cb3d1050…` before V3-5 and is `99e22999…` after it (status note of Sat 31 Oct). The committed file and CI use the new head.

One reading of the SOW is still open; it is not a freeze deviation (decision 1).

## Known limitations

- **No hardware; simulated or historical input only.** The live run is fed by the deterministic simulator through the CSV adapter, and carries the label "Simulated input · assurance A0 · Stellar testnet". The scale test replays historical public data. Neither shows that any installation produced energy or that any meter is accurate.
- **The scale test refuses 1,992 of 8,640 intervals** (6,648 accepted). By reason:
  - `agreement.eff_floor`: 1,942;
  - `plausibility.energy_power`: 306;
  - `agreement.ac_over_dc`: 20;
  - `elevation.night`: 13.

  An interval can carry more than one reason. These were counted again for this page from the scale feed. The gate profile is derived from the spec's `rooftop` profile, and its AC/DC floor of 0.88 was not tuned to this utility-scale inverter (finding B-4, `datasets/README.md`). All 720 batches are accepted: refused intervals stay out of the batches, not out of the chain.
- **Dawn and dusk.** `plausibility.energy_power` has no absolute floor, so intervals of a few mWh at dawn and dusk are refused on rounding (finding B-3, a candidate for spec 1.1; the spec is frozen). `live/expected-run.json` expects 4 of them in the run; the first is the 06:45 refusal above.
- **The 8 Oct sample feed predates batch schema 1.1.0.** `evidence/feeds/ensayo-8oct/` holds the two batches anchored on 8 Oct 2026: prior work, on the throwaway account `GAYA…CYET` at thresholds 1/2/3.
  - Their anchors: QW#0 [`494e8d12…`](https://horizon-testnet.stellar.org/transactions/494e8d12cc3ab7b4f62a7f061a1e899c45e8b4553539346a0e71c8f5c525a8a1) (ledger 5,093,764) and QW#1 [`9851ba7e…`](https://horizon-testnet.stellar.org/transactions/9851ba7ec2743b6e7a4e22e5da9915e1dd7c499ccfdfe4e216a02365a3758715) (ledger 5,093,765).
  - They have no `samples_root`, so `node batch/verify-cli.js evidence/feeds/ensayo-8oct` exits 1 with `batch.schema_invalid` on both.
  - `ops/sample-feeds.js --check` allows exactly that difference (FD-13), and checks that both batches still hash to the anchored `322923a4…` and `852314a2…`.
- **No node-rotation rule.** Since DV-1, a changed `node_id` makes every later batch rejected with `batch.site_mismatch` until it is put back. The walk to the on-chain head stops at 168 batches (`verifier.walk_too_long`, DV-5).
- **DV-6 sub-decisions.** R1 does not refuse a zero-length payload, and R3's "readable" timestamp is whatever `Date.parse` accepts. Both only change the order of odd refused lines (decision 3).
- **Reading the public feed.**
  - `raw.githubusercontent.com` is a CDN copy that can lag up to 5 minutes, so two files read a few minutes apart can come from different commits. A clone gives one commit.
  - The interval ledgers also carry the lines of the window still open, so they can run up to an hour ahead of `index.json` (`ops/publish-feed.js`). `verify-cli` accepts that.
- **`protocol/FEED-FORMAT.md` is out of date on the run length.** Its `faults.json` row says the live run has `days` 8: one soak day, then seven counted days. Since DV-11 and DV-12 the run has 7 days and no soak day, and `run/faults.json` says `"days": 7` (decision 2).

## Outside Deliverable 2: items disclosed for the run

From the freeze v3 status note of Tue 10 Nov 2026 ([PR #67](https://github.com/academiaseul/QWATT/pull/67), merged 10 Nov 19:02 UTC as `4e56a1f`), with the cause of the first item corrected by the note of Wed 11 Nov 2026 ([PR #70](https://github.com/academiaseul/QWATT/pull/70), awaiting approval). None of them changes a batch, a ledger line or a hash.

- **The verifier was not running before the start.** It was stopped on Mon 9 Nov from 19:30:04 to 20:18:16 Chile time (22:30–23:18 UTC).
  - The run started at 00:00 Chile time on Tue 10 Nov, so no batch waited on it.
  - Cause: a manual stop on the verifier host, by mistake. The note of Wed 11 Nov ([PR #70](https://github.com/academiaseul/QWATT/pull/70)) corrects the Tue 10 note, which said the cause was not established.
  - The watchdog raised `VERIFIER_SILENT` at 20:18:19 and cleared it at 20:23:23.
- **25 rehearsal decisions at the top of the run's verifier log.** `run/decisions.jsonl` in `qwatt-verifier-log` begins with 24 decisions from `rehearsal-2026-11-07` and 1 from `rehearsal-2026-11-09`.
  - The verifier's state directory was not emptied when the run was armed: the command used deleted nothing.
  - Signing is not affected. The run's own decisions start at 04:00 UTC on 10 Nov.
  - The log only grows, so the 25 lines stay.
- **Not done before go:** the stand-in drill and the kill tests (V3-13). Restart behaviour rests on the unit settings, the recovery tests in CI and the earlier rehearsals.

## Needs a founder decision

1. **Where the batch conformance cases run.** The SOW says "added to the existing suite".
   - As built, they sit in `protocol/conformance/` next to the gate cases, and they run in `npm test` and in CI's `gates` job (step 8), through `batch/batch.test.js`.
   - `protocol/conformance.test.js` does not load `batch-cases.json`.
   - The code is frozen while the run lasts. Describe it as built in the write-up (suggested), or plan a loader in `protocol/conformance.test.js` after 17 Nov.
2. **Correct `protocol/FEED-FORMAT.md`:** `days` is 7, with no soak day (DV-12). It is a document, not code; decide whether it goes in now as a documented fix or after the run.
3. **DV-6's open sub-decision.** DV-6 said to revisit R3's "readable" timestamp in week 3. No status note records that it was. Record "kept as built" in a status note or in the write-up.
4. **Public wording of two facts.**
   - **"First 2-of-3 anchor."** On 8 Oct 2026 two batches were already anchored with two signatures on a three-signer account, but at thresholds 1/2/3 (`494e8d12…`, `9851ba7e…`). Proposed wording for `13457b4b…` (7 Nov): "the first anchor on a 2/2/3 account with the sprint's three keys". Avoid "the first 2-of-3 anchor ever".
   - **The verifier stop of Mon 9 Nov.** Merge the correcting status note ([PR #70](https://github.com/academiaseul/QWATT/pull/70)) before this document, so that public text states the cause only after the freeze record does.
5. **Credit.** The batch layer and the scale test are prior work (8 Oct; `docs/PRIOR-WORK.md`). Public text should say so, as it does for Deliverable 1. The sprint's own Deliverable 2 work is under "Changed during the sprint".
6. **The §6 checklist.** Confirm PRESENT for "Evidence Batches & Hash Chain".

## Reproduce

```bash
git clone https://github.com/academiaseul/QWATT.git && cd QWATT
git checkout code-freeze                        # 9ee4646, the commit the live run started from
npm test                                        # every suite, no install (3 min 37 s on Windows)
npm run test:batch                              # batch tests and the pinned fixture: 45 passed, 0 failed
npm run scale                                   # the PVDAQ month, run twice; exit 1 unless it reproduces evidence/scale/scale-pvdaq-4902-2017-09.json
npm run verify:feed -- evidence/feeds/muestra   # "8 batches (7 accepted, 1 rejected) …", then "OK — every published batch re-derives from the feed"
npm run test:compruebalo                        # the sample feeds regenerate byte for byte; the browser build equals Node on the vectors
npm run dataset:fetch                           # optional, downloads from NREL and rewrites datasets/pvdaq-4902-2017-09/;
                                                # compare the CSV's SHA-256 with provenance.json (not re-run for this page)

# the live run's public feed, read at one commit
git clone https://github.com/academiaseul/qwatt-evidence.git ../qwatt-evidence
git clone https://github.com/academiaseul/qwatt-verifier-log.git ../qwatt-verifier-log
npm run verify:feed -- ../qwatt-evidence/run --verifier-log ../qwatt-verifier-log/run
npm run audit:evidence -- ../qwatt-evidence     # "<n> commits · public history intact"
node live/audit.js ../qwatt-evidence/run --expected live/expected-run.json

# one batch by hand: its hash, then its anchor (tx_hash is in run/anchored/<batch_id>.json)
node -e "console.log(require('./protocol/evidence').batchSha256(require('../qwatt-evidence/run/batches/qwatt-chispa-01-000006.json')))"
curl -s "https://horizon-testnet.stellar.org/transactions/61f01701ef70f6ef3d4f5ae70e8aafee9123cdec3185eab7ba771b974cfb95fb/operations" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s)._embedded.records.filter(o=>o.type==='manage_data').forEach(o=>console.log(o.name,Buffer.from(o.value,'base64').toString())))"
```
