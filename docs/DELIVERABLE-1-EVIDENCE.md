# Deliverable 1 evidence · meter-agnostic ingestion

**Every Deliverable 1 build item is built and tested. On public `main`, the CSV, HTTP and Modbus adapters turn the same simulated input into byte-identical interval records, and the gate engine gives them identical verdicts: 24 of 24 intervals accepted on every path.** [CI run #30](https://github.com/academiaseul/QWATT/actions/runs/39593847463) at `c1ae630` shows it, and [`evidence/harness/harness-c1ae630.txt`](../evidence/harness/harness-c1ae630.txt) saves the same output from a clean export of that commit. What still needs the bench hardware or a founder decision is listed at the end.

- **Date:** Fri 23 Oct 2026 (Day 5).
- **SOW:** Deliverable 1 as written in `docs/SOW-INSTAWARD-v3.md` (§4 Scope, §5 Week 1, §6 Evidence of Completion), as that file stood at `2bb5496`.
  - That file is no longer tracked: it was superseded by SOW final v4 (September 2026), which is not in the repository.
  - `docs/PHASE-0-BUILD-PLAN.md` §1, written from v4, lists the same seven build items.
- **Calendar:** the ingestion code is prior work (`98b281a`, 9 Sep 2026; see `docs/PRIOR-WORK.md`). Sprint Day 1 is Mon 19 Oct 2026. This page and the changes under "Closed on 23 Oct" were made on branch `claude/lucid-heisenberg-4tjuer` and rebuilt onto `main` (`c1ae630`) in branch `semana-1/d1-cierre`.

> **Resumen.** El Entregable 1 (ingesta independiente del medidor) está construido y probado. En `main`, CSV, HTTP y Modbus producen registros idénticos byte a byte con la misma entrada simulada, y el motor los acepta igual (24 de 24). La salida de la prueba de aceptación quedó guardada en `evidence/harness/` y el CI está en verde (corrida #30).
>
> Lo pendiente está al final. Lo principal:
> - en el banco de pruebas, una lectura en vivo de dos registros de batería del EPEver (0x3104 y 0x3105) y la configuración del PZEM-017;
> - de los fundadores, confirmar la redacción de la SOW v4 y decidir la desviación D1-1.
>
> Todo es simulado y solo en Stellar testnet.

## Build items (SOW §4, Deliverable 1)

| SOW requirement | Status | Evidence |
|---|---|---|
| Modbus RTU/TCP adapter with the register map as configuration (JSON), not code | Built. TCP is tested against a simulator; RTU framing is tested without hardware. | `ingest/adapters/modbus.js` (`ModbusTcp`, `ModbusRtu`, `pollOnce`, `start`, `createSimulator`). Maps are loaded and decoded by `ingest/lib/registermap.js`. Tests: "Modbus TCP: client reads the simulator, exception codes surface as errors", and "Modbus RTU: request framing, chunked replies, exception codes and CRC mismatch through ModbusRtu on an in-memory port (no hardware)", which also runs `pollOnce` over RTU into an interval. CLI: `node ingest/cli.js modbus --a pzem-017@host:502`. |
| HTTP/JSON push adapter | Built | `ingest/adapters/http.js` serves `POST /samples`, `POST /intervals`, `POST /flush` and `GET /health`. Test: "HTTP: /intervals accepts a valid record, stamps clock_skew_s, rejects an invalid one". The harness pushes every sample through `/samples`. In week 1, DV-4 (`8385da3`, [PR #8](https://github.com/academiaseul/QWATT/pull/8)) added canonical UTC timestamps on `POST /intervals` and 400 `ingest.off_grid`, with their own test. |
| CSV / file replay adapter | Built | `ingest/adapters/csv.js`: quoted fields; epoch s/ms or ISO timestamps; fast, real-time or factor pace. Test: "CSV: quoted fields, epoch and ISO timestamps". It is also the harness CSV path. `00a25ff` (8 Oct, prior work) reads a blank power cell as a missing reading rather than 0 W, with its own test. |
| Normalization to the versioned interval schema (`interval.schema.json`) | Built | `ingest/lib/normalize.js` `IntervalBuilder`: grid alignment; trapezoidal integration split at boundaries, or counter deltas; integer mWh and mW. Every record is validated against `protocol/interval.schema.json` v1.1.0 before it leaves, and `_close` throws otherwise. Tests cover schema validity and integer-only output, the boundary split, energy conservation, counter mode, gaps and out-of-order samples. `00a25ff` also lets a meter that returns after a 15-minute gap resume without throwing. |
| Two reference register maps: PZEM-017 and EPEver Tracer | Built. Checked against the manufacturers' documents, except two EPEver battery fields. | `ingest/maps/pzem-017.json` and `ingest/maps/epever-tracer.json`. Sources, hashes and status for each field are in `ingest/README.md`, "Register-map sources". Test "documented example frames decode with the shipped maps": the PZEM §2.3 reply decodes to the document's 100.00 V, 1.00 A, 100.0 W and 0 Wh, and EPEver's 32-bit example decodes to 3000. |
| Raw-payload hashing so the normalization itself is auditable | Built. The exact rule is now written down and recomputed in tests. | Every record carries `source.raw_sha256`; the exact rule is in `ingest/README.md`, "raw_sha256". Tests: "raw_sha256 depends on the raw payload, not on the decoded values", and "raw_sha256 is recomputable from the input alone…" for CSV and HTTP. The RTU test recomputes the hash from the reply frame. |
| Adapter test harness: the same input through all three adapters yields byte-identical output | Built, passing | `ingest/harness.js`: 720 samples × 2 meters give 24 intervals per path. Records are compared as canonical JSON with `source` removed; the adapter name, raw hash and register map differ by design. Verdicts are compared by verdict, mint and failure ids. Output line: `harness: 720 samples × 2 meters → 24 intervals per path · 24/24 accepted · 240.9 Wh basis · BYTE-IDENTICAL across csv, http, modbus`. |

## Week 1 plan and expected output (SOW §5)

| SOW requirement | Status | Evidence |
|---|---|---|
| Days 1–3: architecture freeze — schemas, batch definition, hash rules, adapter and verifier interfaces, transaction format | Agreed | Freeze v3 reads "AGREED by both founders on Wed 21 Oct 2026 (Day 3)". It is in [`docs/ARCHITECTURE-FREEZE-v3.md`](ARCHITECTURE-FREEZE-v3.md) (`b304ddb`). It amends freeze v2 (`docs/ARCHITECTURE-FREEZE-v2.md`) and v1 (`docs/ARCHITECTURE-FREEZE.md`, 9 Sep). The adapter interface as built differs from v1 §3; see deviation D1-1. |
| Days 4–7: Modbus adapter with register-map configs, HTTP/JSON and CSV adapters, schema normalization, two reference register maps, adapter harness | Built (prior work) | See the build table above. |
| Expected output: "Any of the three adapters feeds the engine and produces byte-identical verification output for the same input." | Met | The harness feeds each path's records to the gate engine (`assets/qwatt-gates.js`, spec 1.0.0, `bench` profile). Every path gets 24/24 accepted, with identical verdict, mint and failure ids. |

## Evidence of completion (SOW §6, Deliverable 1)

| SOW evidence | Status | Where |
|---|---|---|
| Public GitHub repository | Done | https://github.com/academiaseul/QWATT. `gh api repos/academiaseul/QWATT` returned `"private": false, "visibility": "public"` on 23 Oct 2026. |
| Two register-map configuration files | Done | [`pzem-017.json`](https://github.com/academiaseul/QWATT/blob/c1ae63081e353bc3ddeb8feb48a90cdf42f0919e/ingest/maps/pzem-017.json) and [`epever-tracer.json`](https://github.com/academiaseul/QWATT/blob/c1ae63081e353bc3ddeb8feb48a90cdf42f0919e/ingest/maps/epever-tracer.json) at `c1ae630`, unchanged since `98b281a`. |
| Adapter harness output showing identical results across adapters | Done | [`evidence/harness/harness-c1ae630.txt`](../evidence/harness/harness-c1ae630.txt), SHA-256 `9bad987602e8b08ee63990e8bb0115e0eb602f6730054ce326fc6b969937384d`. It is written by `node ingest/capture-evidence.js c1ae630`, which runs the five local checks on a `git archive` of `c1ae630` and saves their output unedited, with the commit, the capture time and the Node version. That run used v22.22.0; CI uses Node 20. |
| CI run | Done | [Run #30](https://github.com/academiaseul/QWATT/actions/runs/39593847463) on `main`: push of `c1ae630`, 21 Oct 2026 11:41 UTC, success. Step 7, "Ingestion tests + Deliverable 1 acceptance harness" ([job 119201188370](https://github.com/academiaseul/QWATT/actions/runs/39593847463/job/119201188370)), runs `node ingest/ingest.test.js`, harness included. The workflow runs on pushes to `main` and on pull requests. |

## Closed on 23 Oct

- **Saved harness output and its generator:** `ingest/capture-evidence.js` and `evidence/harness/`.
- **RTU framing test** on an in-memory serial port.
  - `ingest/adapters/modbus.js` no longer says "Untested without hardware".
  - Its error hint now names a protocol-converting gateway. A bridge that forwards raw RTU frames over TCP does not work with the `tcp` transport.
- **Register maps checked against five documents.** The sources, file hashes and open items are in `ingest/README.md`.
  - No map field was changed. No field contradicts the current documents.
  - The two fields that are not confirmed (EPEver 0x3104 and 0x3105) are listed differently by different documents. Only a live read settles that.
- **The `raw_sha256` rule is written down** and recomputed in tests:
  - a CSV line is hashed once per meter it feeds (a blank power cell is no sample);
  - an HTTP body is hashed once per sample it carries;
  - a Modbus poll contributes its reply frames.

  The CSV and HTTP adapter comments that said otherwise are corrected.
- **The harness input is described by its actual hours:** two simulated hours, 12:00–14:00 Santiago (`ingest/harness.js`, `ingest/README.md`).
- **Two tests for paths that had none:** `GET /health`, and CSV replay at a pace factor.
- **The week-1 section of `CHANGELOG.md`.**

**Test results.** `node ingest/ingest.test.js` gives 29 passed, 0 failed (24 at `c1ae630`, before the five new tests). Every other suite is unchanged and passes.

## Deviation D1-1 · adapter interface as built

**What freeze v1 §3 says:** "Every adapter is a Node module exporting `start(config, emit)` where `emit(interval)` receives a record that already satisfies the interval schema."

**What was built:**
- `modbus.start(config, builder, log)`
- `http.start(config, builder, onInterval)`
- `csv.replay(config, builder)`

Records reach the caller through the `IntervalBuilder`'s `onInterval`, and through `http.start`'s `onInterval` callback. Every record is validated against the interval schema before it is delivered, so the guarantee §3 states holds; only the signature differs. Freezes v2 and v3 do not change the adapter interface, so v1 §3 still holds.

The freeze rule asks for deviations to be documented in the write-up, so it is recorded here. The three signatures were not changed because the harness, the CLI and `main`'s tests call them as they are. The founders decide whether the sprint write-up adopts this deviation or asks for thin `start(config, emit)` wrappers.

## Known limitations

- **No hardware, simulated input only.** The harness generates its input from a fixed seed (mulberry32, 20260920): 10 s samples from 2026-09-20 15:00 to 17:00 UTC, which is 12:00–14:00 America/Santiago. Its Modbus path polls a local Modbus TCP simulator. This shows that the three adapters agree. It does not show that any installation produced energy or that any meter is accurate.
- **Modbus RTU** needs the `serialport` package on the gateway. It is not a dependency, and `connect()` says so when it is missing. Framing is tested, but no physical device has been read through it. With the `tcp` transport, only gateways that convert RTU to Modbus TCP work.
- **Register maps.**
  - **PZEM-017:** every field matches PZ1. The bench still has to settle the default unit id, the current-range register 0x0003 against the fitted shunt, and the 5 V power source.
  - **EPEver:** 0x3104 and 0x3105 are not confirmed. They share the PV-power read block, so a refusal from the controller would lose PV power on every poll.
  - **Documents:** the ones read are third-party copies, because the manufacturer sites were unreachable; their hashes are recorded. The documented-frame test decodes the manufacturers' worked examples, not frames captured from our devices.
- **Raw payloads were not stored in week 1,** so only someone holding the original input could recompute `raw_sha256`. Closed in week 2 by V3-5: every interval now carries its raw payloads, the feed publishes them at `raw/<batch_id>.jsonl`, and every batch commits to them with `samples_root` (batch schema 1.1.0; `ingest/README.md`, *samples_root*).
- **Comparison scope.** The harness compares verdict, mint and failure ids, not the full verdict object. It excludes `source` from the record comparison by design.

## Needs a founder decision

1. **Confirm the SOW wording.** SOW final v4 is not in the repository. Confirm that its Deliverable 1 lists the same four evidence items as v3 §6.
2. **EPEver battery registers.** On the bench controller, read 0x3100 × 6 and 0x331A. If 0x3104/0x3105 are refused or disagree, approve moving or dropping those two fields. Optionally, ask EPEver support for the "XTRA, TRIRON, TracerAN Series Controller Communication Instruction".
3. **PZEM-017 bench settings.** Check the unit id, check that register 0x0003 matches the fitted shunt, and provide a separate 5 V power source over 100 mA (PZ1 §5).
4. **Deviation D1-1.** Adopt it in the write-up, or ask for the wrappers.
5. **Public wording.** Public text should call the ingestion prior work (9 Sep), as `docs/PRIOR-WORK.md` does. Confirming who did what is the founders' call, since every week-1 non-merge commit on `main` is authored by `academiaseul` (the PR merges are by "Jay", with the same address).
6. **Repository visibility: nothing to decide.** The SOW asks for a public GitHub repository, and it is public, so the "Repository is private" blocker in the 9 Sep pre-flight audit (`8749adc`; no longer tracked since `772b8f3`) no longer applies. One optional repository setting: the GitHub description still reads "QWATT Crypto", and could be changed to match the README.

## Reproduce

```bash
git clone https://github.com/academiaseul/QWATT.git && cd QWATT     # main
node ingest/harness.js                     # the acceptance line; exit 1 on any difference
node ingest/ingest.test.js                 # unit tests + harness (29; 24 at c1ae630)
node ingest/capture-evidence.js c1ae630    # regenerates the evidence file; only the header's command, capture time and Node version differ
```
