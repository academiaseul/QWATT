# protocol/ — the verification spec and its conformance suite

The gate logic used to exist three times: a Python gateway, `mining-rig/validators.js`, and a
hand-written copy inside `verificacion.html`. Three copies drift, and the copy that drifts
first is the public demo — the one page whose purpose is showing the checks are real.

This directory makes that impossible.

| File | Role |
|---|---|
| `gates.spec.json` | **Single source of truth.** Every threshold, every gate, every failure message, in one versioned file. |
| `interval.schema.json` | The normalized record every ingestion adapter emits and the only shape the engine accepts. A new meter is a register map that produces this — never an engine change. |
| `batch.schema.json` | The evidence batch, schema 1.1.0: the accepted intervals, `intervals_root`, `samples_root` over the raw payloads (required since 1.1.0; rules R1–R4 in its description; the payloads are published at `raw/<batch_id>.jsonl`), energy, cumulative total and chain link. |
| `evidence.js` | Canonical JSON (integers only), SHA-256, the Merkle roots, the batch hash and id: the one definition of the batch hash rules. |
| `reasons.json` | Registry 1.1.0 of every non-gate reason code a ledger can carry (`ingest.*`, `batch.*`, `verifier.*`), with `ingest.raw_missing`, `ingest.raw_mismatch`, `batch.samples_root_mismatch`, `batch.raw_mismatch` and `batch.raw_missing` added in 1.1.0. |
| `conformance/batch-cases.json` | Pinned hashes of a three-batch chain (`intervals_root`, `samples_root`, `sha256`) and `samples_root` vectors (raw lines in, root out). Regenerated only by `node batch/batch.test.js --write`. |
| `gen.js` | Generates the bindings: `assets/gates.generated.js` (browser + CommonJS), `mining-rig/gates.generated.js`, `docs/GATES.md`. `--check` fails if any is stale. |
| `conformance/cases.json` | Fixtures: input interval, profile, expected verdict, the **exact** set of failing gates, reason codes, mint string, pinned numeric internals. |
| `conformance.test.js` | Runs the suite against the shared engine, checks the schema, checks the bindings are current and identical, checks `validators.js` reads the spec, and that every reason code has a message in every language. |
| `schema-lite.js` | Just enough JSON Schema to validate the record with no dependency. |
| `FEED-FORMAT.md` | The public evidence feed and the verifier log as published (freeze v3, V3-7): every file under `<run>/`, its fields, and whether it is written once, grows only or is replaced; the rules each commit keeps and how to check them. |

The engine itself lives at `assets/qwatt-gates.js` because the demo page loads it directly.
It contains no numbers. If you are about to type `1.15` or `900` into it, stop — that belongs
in the spec.

```bash
npm run gen:gates    # after editing gates.spec.json
npm test             # gen --check · conformance · validators — no install needed
```

## Adding a rule

1. Edit `gates.spec.json`: the parameter (with unit and meaning), the gate entry, the messages
   in `es` and `en`. Bump `spec_version`.
2. Implement it in `assets/qwatt-gates.js` reading only from the profile object.
3. Add at least one accepting and one rejecting case to `conformance/cases.json`.
4. `npm run gen:gates && npm test`.

The spec version is written into every verdict and every anchored batch, so an on-chain record
states which rules judged it.

## Profiles

Thresholds are per site, not universal — a Santiago balcony and a Patagonian roof have
different plausible envelopes. `bench` is the Phase 1 rig (150 Wp, two DC meters, 5-minute
intervals). `rooftop` is the residential pilot geometry (4.4 kWp, DC meter before the inverter
and AC meter after it). The rule is shared; the numbers are not. `cases.json` includes the same
twilight instant accepted under one profile and rejected under the other to prove that.
