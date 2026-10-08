# Architecture freeze v2 — Instawards sprint (SOW final v4)

**Status: DRAFT — pending sign-off by both founders.** Decisions marked **[ADOPTED]** are working
decisions taken 2026-10-08 so the build could proceed; they stay reversible until sign-off. The
few items still open are in the decisions log at the end, each with a deadline and a stand-in.
**Supersedes:** `docs/ARCHITECTURE-FREEZE.md` (written for SOW v3), which stays in the repo
unchanged as the record of what v3 froze. Everything in v1 not mentioned here still holds.
**Plan:** `docs/PHASE-0-BUILD-PLAN.md`.

**Rule (unchanged):** once signed, nothing below changes until day 30. A wrong call becomes a
documented deviation in the write-up, never a silent edit.

## Deviations from v1, and why

| # | v1 said | v2 says | Why |
|---|---|---|---|
| D-1 | Payment = `floor(energy_mwh / 1e9)` QWATT per batch (§1, §7) | **[ADOPTED]** Fixed nominal payment of `0.0000001` QWATT per batch to a fixed team account | SOW v4 removes token issuance from scope and uses the asset as "the anchoring vehicle only". An energy-proportional payment reads as issuance. |
| D-2 | Source account = the existing distributor (treasury) | **[ADOPTED]** A new dedicated anchoring account with a QWATT trustline and a small balance | Keeps the 42.7M treasury out of an off-team quorum; limits blast radius; matches "anchoring vehicle only". |
| D-3 | Rejected intervals go to the rejected ledger; nothing said about rejected batches | Every closed batch is **published** with a status. `accepted` batches may be anchored; `rejected` batches are published with reason codes and **never anchored** | SOW v4: "every batch, accepted or rejected, is published; only accepted batches are anchored". |
| D-4 | — | A batch is `rejected` when the proposer's own `verifyBatch` (the same function the verifier runs) fails on it. The chain advances through it so the defect stays visible in sequence | One verification implementation for both sides; a batch-level rejection is a defect signal, not a silent gap. |
| D-5 | — | A batch whose intervals were all rejected is still a valid `accepted` batch: `intervals: []`, `energy_mwh: 0`, `intervals_root` = SHA-256 of the empty string | Keeps the chain gapless through nights and faults, and anchors the fact that the gates refused something. |
| D-6 | `samples_root` optional | **[ADOPTED]** Keep optional in schema 1.0.0 for this sprint, populate it from the CSV/simulator raw samples in the live run, and make it required in batch schema 1.1.0 at Instaward #2 | The SOW lists "Merkle root over raw samples" as a batch field; `raw_sha256` per interval already makes normalization auditable today. |
| D-7 | — | Reason codes outside the gate spec are registered in `protocol/reasons.json`; an unregistered code fails CI | The proposer, the verifier and the reconciliation page must agree on what every rejection means. |
| D-8 | Feed layout §5 | Adds `ledger/batches.jsonl` (one line per published batch: `batch_id`, `seq`, `sha256`, `status`, `reasons`) and `index.json.last_ts_start` | The batch ledger is how a reader lists the chain in order without directory listings; `last_ts_start` makes duplicate rejection survive restarts. |
| D-9 | Canonical JSON: integers only (policy) | `protocol/evidence.js` **enforces** it: any non-safe-integer number throws | `JSON.stringify(Infinity)` is `"null"`; a permissive serializer lets an overflow reach a hash. |
| D-10 | — | **[ADOPTED]** The live run's "implausible ramp" fault is designed to trip G1 nameplate or G0 `plausibility.energy_power`, and is logged under that code | The dedicated ramp gate is deferred by SOW v4; the active engine runs G0–G3 only. Do not wire Phase-2 gates mid-sprint. |
| D-11 | License Apache-2.0 | **Decided 2026-10-08: MIT**, as the SOW states. `LICENSE` and every `package.json` updated; dependencies keep their own licences (the Stellar SDK is Apache-2.0, compatible) | The evidence links must not contradict the SOW. Only the two founders have committed to the repo, so relicensing is theirs to make. |

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
account, key generated on its host), third signer (off-team, named before the real account is created — see the decisions log).
Thresholds low 1, medium 2, high 3; master weight 0 once the signers are set. Rehearsed on a
throwaway testnet account first (plan unit 1.6).

## Rehearsal findings (plan units 1.6 and 3.8, testnet, 2026-10-08)

Evidence: `evidence/rehearsal/rehearsal-2026-10-08T20-46-13-037Z.json` (`node anchor/rehearse.js`,
throwaway account, verdict PASS). Two facts the write-up must reflect:

- **A single signature is refused as `tx_failed` / `op_bad_auth`, not `tx_bad_auth`.** One weight-1
  signature meets the LOW threshold (the transaction is authorized to exist) but the `manageData`
  anchor needs MEDIUM 2, so that operation fails and the transaction applies nothing. Validation
  rejects it before a ledger: the same sequence number is used successfully by C afterwards.
- **A, B and C share one transaction hash.** Stellar transaction hashes exclude signatures, so the
  refused single-signature attempts are byte-for-byte the transaction that later succeeded. Never
  cite A or B by hash (the link resolves to C). Their evidence is the signed envelope and the
  result codes, and the comparison is itself the demonstration: the identical transaction refused
  with one signature, accepted with two.

## Decisions log

Nothing below blocks work before Day 15. Until each is resolved the build runs on the stand-in.

| Decision | Status | Needed by | Stand-in until then |
|---|---|---|---|
| License (D-11) | **decided: MIT** | — | — |
| Payment amount (D-1) | adopted: 0.0000001 QWATT | sign-off | — |
| Anchoring account (D-2) | adopted: new dedicated account | Day 15 (plan 3.1) | throwaway testnet accounts (rehearsal, e2e) |
| Ramp fault (D-10), `samples_root` (D-6) | adopted as above | sign-off | — |
| **Third signer** named, public key received | open | **Day 15**, latest Day 19 | throwaway key. The real account must not be created without it: with high threshold 3, adding a signer later needs all three existing keys |
| **Evidence-feed host** | open — recommended: a `feed` branch of this repository on GitHub Pages (free, public, no new account) | Day 18 | `anchor/static-server.js` serving the feed locally |
| **Verifier host and operator** | open — any always-on machine that does not run the proposer, operated by the other founder | Day 18 | verifier runs locally against the local feed URL |
| **Public PV dataset** | open | Day 14 (D2 evidence) | deterministic synthetic month (`batch/scale.js`) |
| Day 1 date | open | — | the plan's day numbers stay relative |
