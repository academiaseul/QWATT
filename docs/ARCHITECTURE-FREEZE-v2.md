# Architecture freeze v2 — Instawards sprint (SOW final v4)

**Status: DRAFT — pending sign-off by both founders.** Items marked **[DECIDE]** need a founder
decision before Day 3; until then the recommended default below is what the code assumes.
**Supersedes:** `docs/ARCHITECTURE-FREEZE.md` (written for SOW v3), which stays in the repo
unchanged as the record of what v3 froze. Everything in v1 not mentioned here still holds.
**Plan:** `docs/PHASE-0-BUILD-PLAN.md`.

**Rule (unchanged):** once signed, nothing below changes until day 30. A wrong call becomes a
documented deviation in the write-up, never a silent edit.

## Deviations from v1, and why

| # | v1 said | v2 says | Why |
|---|---|---|---|
| D-1 | Payment = `floor(energy_mwh / 1e9)` QWATT per batch (§1, §7) | **[DECIDE]** Fixed nominal payment of `0.0000001` QWATT per batch to a fixed team account | SOW v4 removes token issuance from scope and uses the asset as "the anchoring vehicle only". An energy-proportional payment reads as issuance. |
| D-2 | Source account = the existing distributor (treasury) | **[DECIDE]** A new dedicated anchoring account with a QWATT trustline and a small balance | Keeps the 42.7M treasury out of an off-team quorum; limits blast radius; matches "anchoring vehicle only". |
| D-3 | Rejected intervals go to the rejected ledger; nothing said about rejected batches | Every closed batch is **published** with a status. `accepted` batches may be anchored; `rejected` batches are published with reason codes and **never anchored** | SOW v4: "every batch, accepted or rejected, is published; only accepted batches are anchored". |
| D-4 | — | A batch is `rejected` when the proposer's own `verifyBatch` (the same function the verifier runs) fails on it. The chain advances through it so the defect stays visible in sequence | One verification implementation for both sides; a batch-level rejection is a defect signal, not a silent gap. |
| D-5 | — | A batch whose intervals were all rejected is still a valid `accepted` batch: `intervals: []`, `energy_mwh: 0`, `intervals_root` = SHA-256 of the empty string | Keeps the chain gapless through nights and faults, and anchors the fact that the gates refused something. |
| D-6 | `samples_root` optional | **[DECIDE]** Recommended: keep optional in schema 1.0.0 for this sprint, populate it from the CSV/simulator raw samples in the live run, and make it required in batch schema 1.1.0 at Instaward #2 | The SOW lists "Merkle root over raw samples" as a batch field; `raw_sha256` per interval already makes normalization auditable today. |
| D-7 | — | Reason codes outside the gate spec are registered in `protocol/reasons.json`; an unregistered code fails CI | The proposer, the verifier and the reconciliation page must agree on what every rejection means. |
| D-8 | Feed layout §5 | Adds `ledger/batches.jsonl` (one line per published batch: `batch_id`, `seq`, `sha256`, `status`, `reasons`) and `index.json.last_ts_start` | The batch ledger is how a reader lists the chain in order without directory listings; `last_ts_start` makes duplicate rejection survive restarts. |
| D-9 | Canonical JSON: integers only (policy) | `protocol/evidence.js` **enforces** it: any non-safe-integer number throws | `JSON.stringify(Infinity)` is `"null"`; a permissive serializer lets an overflow reach a hash. |
| D-10 | — | **[DECIDE]** The live run's "implausible ramp" fault is designed to trip G1 nameplate or G0 `plausibility.energy_power`, and is logged under that code | The dedicated ramp gate is deferred by SOW v4; the active engine runs G0–G3 only. Do not wire Phase-2 gates mid-sprint. |
| D-11 | License Apache-2.0 | **[DECIDE]** MIT (as the SOW states) or amend the SOW reference | The evidence links must not contradict the SOW. |

## Batch rules as implemented (`batch/`)

- **Closing:** every 12 judged intervals (accepted + rejected) or on restart.
- **Judging order at the door:** schema / integers (`ingest.schema_invalid`, `ingest.not_integer`) →
  spec version (`ingest.spec_mismatch`) → duplicate window (`ingest.duplicate_interval`) → earlier
  than the last judged window (`ingest.out_of_order`) → gates G0–G3.
- **Energy:** `energy_mwh` = Σ `min(a.mwh, b.mwh)` (or `a.mwh` with one meter) over accepted
  intervals, integer mWh. `cumulative_mwh` = previous + `energy_mwh`.
- **Hash:** `sha256` over the canonical batch with `sha256` removed. `intervals_root`: leaves are
  SHA-256 of each interval's canonical JSON; parent = SHA-256 of the two child hex strings; odd
  node pairs with itself. Pinned in `protocol/conformance/batch-cases.json`.
- **Verification** (`batch/verify.js`, shared by proposer and verifier): schema, versions, id,
  hash, root, chain or genesis, energy, cumulative, counts against the rejected ledger, window
  order, every contained interval re-judged (must accept), every gate-coded rejection re-judged
  (must reject), every reason registered.
- **Restart safety** (`batch/pipeline.js`): each judged line is appended with fsync before it
  counts; state is rebuilt from the feed, never from memory; open-window lines are restored and
  closed; a batch file written before a crash is adopted, not rebuilt.

## Transaction format (v1 §7, amended by D-1 and D-2)

Source: the anchoring account. One transaction per accepted batch, atomic:

1. `manageData` `qwatt.anchor.sha256` = batch `sha256` (64 ASCII hex bytes).
2. `manageData` `qwatt.cumulative_mwh` = decimal string of `cumulative_mwh`.
3. `payment` of the nominal amount (D-1) to the fixed team account.

Memo `QW#<seq>`. Base fee. Timebounds 24 h. Built deterministically from the published batch by
both proposer and verifier; the verifier signs only if its rebuilt transaction hash equals the
pending XDR's.

## Keys and thresholds (v1 §8, unchanged except the account)

Three signers, weight 1 each: proposer (gateway host), independent verifier (separate provider and
account, key generated on its host), third signer (off-team, **[DECIDE]** named at kickoff).
Thresholds low 1, medium 2, high 3; master weight 0 once the signers are set. Rehearsed on a
throwaway testnet account first (plan unit 1.6).

## Kickoff decisions log

| Decision | Owner | Status |
|---|---|---|
| Third signer named, public key received | Founders | open |
| Anchoring account (D-2) | Founders | open — default: new account |
| Payment amount (D-1) | Founders | open — default: 0.0000001 QWATT |
| Evidence-feed host | Founders | open |
| Verifier host and operator | Founders | open |
| License (D-11) | Founders | open |
| Day 1 date | Founders | open |
| Public PV dataset | Founders | open — scale test currently uses a deterministic synthetic month |
