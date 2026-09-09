# Architecture freeze — Instawards sprint, days 1–3

**Frozen:** 2026-09-09 · **Sprint:** `docs/SOW-INSTAWARD-v3.md` · **Rule:** nothing below changes
until day 30. If something here turns out to be wrong, the fix is a documented deviation in the
write-up, not a silent edit.

## 1. Units and numbers

- **Energy in evidence is an integer in milliwatt-hours (`mwh`).** Power is an integer in
  milliwatts (`mw_mean`). Time is integer seconds. No floating-point value is ever serialized into
  anything that gets hashed. The gate engine converts to watt-hours internally; the spec's
  thresholds stay in the units the spec states.
- **Issuance:** 1 QWATT = 1 MWh = 1,000,000,000 mWh. Payment amount = floor(energy_mwh / 1e9, 7 dp).
- **Canonical JSON:** keys sorted, no whitespace, `undefined` dropped, UTF-8. Integers only, so
  every language serializes the same bytes. Hash = SHA-256 of those bytes, lowercase hex.

## 2. Records

| Record | Schema | Hashed? |
|---|---|---|
| Interval (adapter output, engine input) | `protocol/interval.schema.json` v1.1.0 | Yes, inside a batch |
| Batch (evidence unit, anchored) | `protocol/batch.schema.json` v1.0.0 | Yes — `sha256` over the canonical batch without its own `sha256` |
| Ledger line (accepted / rejected) | append-only JSONL, one interval + verdict per line | No — the batch is the evidence |

**Batch definition.** `batch_id`, `site_id`, `node_id`, `seq`, `ts_start`, `ts_end`,
`spec_version`, `schema_version`, `interval_count`, `accepted_count`, `rejected_count`,
`intervals` (the accepted interval records, in order), `intervals_root` (Merkle root over the
canonical JSON of each interval), `samples_root` (optional, Merkle root over raw power samples when
the node retains them), `energy_mwh` (this batch), `cumulative_mwh` (since genesis, after this
batch), `prev_hash` (64 hex, or 64 zeros for the genesis batch), `sha256`.

A batch closes every **12 intervals** (one hour at 5-minute intervals) or when the node restarts,
whichever comes first. Rejected intervals never enter a batch; they go to the rejected ledger and
the batch's `rejected_count`.

## 3. Adapter interface

Every adapter is a Node module exporting `start(config, emit)` where `emit(interval)` receives a
record that already satisfies the interval schema. Adapters own protocol, decoding and time
alignment. They do not judge.

- **Grid alignment:** intervals start on multiples of `dt_s` from the Unix epoch, UTC.
- **Energy per interval:** if the instrument exposes a cumulative energy counter, energy is the
  counter delta (the meter's own integration). Otherwise energy is the trapezoidal integral of
  sampled power. The register map says which.
- **`raw_sha256`:** hash of the raw payload the interval was derived from (register frames, the
  JSON body, or the CSV rows), so normalization itself can be audited.
- **Register maps** (`ingest/maps/*.json`) describe a Modbus device: unit id, function code,
  serial parameters, and one entry per field with address, word count, type, word order and scale.
  Adding a meter is adding a file.
- Adapters: `modbus` (TCP; RTU when a serial port is configured), `http` (POST of a full interval
  or of raw samples), `csv` (file replay at real-time or fast pace).

## 4. Verification

- Engine: `assets/qwatt-gates.js` with thresholds from `assets/gates.generated.js`. Version
  `1.0.0`, digest `056f1b51…`. Unchanged for the sprint.
- Every verdict carries `spec_version`; every batch carries `spec_version` and `schema_version`.

## 5. Evidence feed layout

```
<feed>/index.json                      latest batch id, cumulative_mwh, spec/schema versions
<feed>/batches/<batch_id>.json         the batch (accepted intervals inside)
<feed>/ledger/accepted.jsonl           one line per accepted interval, with batch id
<feed>/ledger/rejected.jsonl           one line per rejected interval, with reason codes
<feed>/pending/<batch_id>.xdr          proposer-signed transaction awaiting the second signature
<feed>/anchored/<batch_id>.json        transaction hash, ledger, signers, timestamp
```

Static files. The verifier and any reviewer read the same URLs; nobody reads from the proposer.

## 6. Verifier interface

`verify(batch_id)` → fetch `batches/<id>.json` from the feed; recompute `sha256`; recompute
`intervals_root`; check `prev_hash` against the previous batch; re-run the gates on every interval
with the generated spec; check `energy_mwh` and `cumulative_mwh` arithmetic; then fetch
`pending/<id>.xdr`, confirm its `manageData` values equal the recomputed hash and cumulative total,
sign, and submit. Any mismatch: refuse, and publish the refusal to `ledger/rejected.jsonl` with
reason `verifier.<check>`. The verifier holds no other input path.

## 7. Transaction format

Source account: the distributor. One transaction per batch, three operations, atomic:

1. `manageData` name `qwatt.anchor.sha256`, value = the batch `sha256` as 64 ASCII hex bytes.
2. `manageData` name `qwatt.cumulative_mwh`, value = decimal string.
3. `payment` QWATT from distributor to the site wallet, amount per §1.

Memo: text `QW#<seq>`. Fee: base. Timebounds: 24 h, so an unsigned transaction expires.

## 8. Keys and thresholds

| Key | Holder | Weight |
|---|---|---|
| Proposer (existing distributor key) | gateway host | 1 |
| Independent verifier | separate provider, separate account | 1 |
| Third signer | off-team, named at kickoff | 1 |

Thresholds: low 1, **medium 2**, high 3. Payments and `manageData` are medium, so two signatures.
Changing signers is high, so all three. Rehearsed on a throwaway testnet account before touching
the distributor. Secrets never enter the repository, a browser, or a chat.

## 9. Out of the freeze

Phase-2 batch gates, Soroban, token issuance semantics, hardware, mainnet. Listed so nobody
re-opens them on day 15.
