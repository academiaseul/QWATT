# qwatt-issuance · Threat model (prototype)

Scope: `soroban/contracts/qwatt-issuance` as built on 13 Nov 2026, the two Stellar Asset
Contracts it administers (QWATT, QWA0SIM), the locked issuers, the classic 2-of-3
governance account and the two-key relay. Local network only. **Not audited.** This is a
prototype's self-review, written to be checked, not a security opinion.

## What must never happen (security goals)

| # | Goal | Enforced by | Evidence |
|---|---|---|---|
| G1 | A unit exists only inside one retirement (outstanding supply 0 at rest) | `retire` mints to itself and burns from itself in one call; balance checked 0 before and after; no other entry point mints | spike M5, M8; unit `retire_emits_one_mint_and_one_burn…`; P1 |
| G2 | Nobody but the contract can mint | SAC admin = contract (M1); issuers locked at master weight 0 (M2) | spike M1–M4 |
| G3 | A measured range is claimed at most once | contiguous ranges from 0 (`start == retired_wh`); `end ≤ accrued_wh` | cases O01–O10, I05, V04–V06; P5; differential |
| G4 | A statement is used at most once, across all sites and both assets | `Statement(hash)` persistent key, checked before any effect | D01–D02; P6 |
| G5 | Verified energy only grows from batches both relay keys signed | `accrue`: `proposer.require_auth()` and `verifier.require_auth()` | A01–A03, A08; spike M7; P7 |
| G6 | Verified energy is never invented | sequence exactly next (no replay, no gap); cumulative never decreases; floor, never round | R01–R06, I02–I04, V01–V03; P2–P3 |
| G7 | Simulated data never becomes live | class fixed at registration; A0 only on simulated sites, A1/A2 only on live; asset chosen by class | E01–E06, D02 |
| G8 | Emergency stop | `set_paused`, `set_frozen` (governance; freeze works while paused) | P01–P04, F01–F04 |
| G9 | No transfer path | no transfer/approve/mint/burn/upgrade export; SAC `transfer` from the contract needs the contract's own auth, which only its code gives | `check-interface.mjs`; unit `sac_transfer_out…` |

## Actors and trust

| Actor | Can | Cannot |
|---|---|---|
| Governance (classic 2-of-3, master 0, thresholds 2/2/3) | register sites, freeze, pause, rotate the relay | accrue, retire, mint, upgrade (no upgrade path exists) |
| Proposer + verifier (together) | accrue to any registered, unfrozen site | retire; accrue with one key; go backwards |
| Site responsible party | retire its own site's verified energy | retire another site's; exceed accrual; reuse a range or statement |
| Issuers | nothing after the lock | mint, set admin, pay (spike M3/M3b) |
| Anyone | read every site, statement and event; recompute every hash | anything else |

## Threats, mitigations, residual risk

| ID | Threat | Mitigation | Residual / status |
|---|---|---|---|
| T1 | **Relay collusion**: the two founders hold both relay keys and could accrue invented energy | Every accrual is public, carries the batch hash and extends a hash chain; reconciliation compares against the Instaward #1 published batches | **Open by design** (SOW D2 disclosed limit). Instaward #3 replaces the relay with an on-chain gate validator. |
| T2 | **Governance collusion**: founders hold 2 of 3 governance keys | Governance can't mint, accrue, retire or upgrade; worst case is registering a site with a chosen responsible party, freezing or pausing (all public) | Open. Registering a fake site still needs relay accruals (T1). |
| T3 | Replay of an old batch | `seq == next_seq` exactly | Closed (R01, R02, R06; mutant `replay-allowed` caught). |
| T4 | Double claim via overlapping ranges | contiguous-range rule | Closed. **A first test set missed an off-by-one mutant** (`start = retired − 1`); boundary cases O09/O10 and a property bias were added and it is now caught by cases, properties and differential. |
| T5 | Reused statement (same claim twice) | global statement key | Closed for byte-identical statements. **A trivially edited statement is a new hash**: uniqueness is per hash, the range rule is what prevents double counting. |
| T6 | Simulated batches entering QWATT | class/level check, asset by class | Closed in contract. Upstream: the relay must label levels honestly (T1). |
| T7 | Integer overflow / truncation | u64 seq with `checked_add`; u128 energy; `checked_mul`; cap at i64::MAX stroops; `overflow-checks = true` in release (enforced by stellar-cli) | Closed (V01–V06, random big-integer sequences). |
| T8 | Rounding creates energy | `floor(cumulative_mwh / 1000)` only | Closed (I02–I04; mutant `round-up` caught). |
| T9 | Classic-side issuance by the issuer | issuer locked (master 0, no signers) after `set_admin` | Closed on local network (M3: `txBadAuth`). The lock must be verified on the real network after the ceremony. |
| T10 | Ceremony order error: issuer locked **before** `set_admin` | — | **Operational risk**: the asset would have no usable admin, permanently. Ceremony script must set admin, verify `admin()`, then lock. Spike does it in this order. |
| T11 | Contract holds a balance (DoS: every `retire` returns `InvariantBroken`) | supply is zero, issuer locked, so no one can send units to it | Residual: only reachable if supply exists. Tested with a forced mint (unit test). Fails closed. |
| T12 | No upgrade path: a bug can't be patched | deliberate for the prototype; redeploy + new SAC admin impossible after the lock | **Decision needed**: the SOW mentions governance-approved upgrades. Adding `upgrade` makes governance able to replace the code (and so mint). Not added without your decision. |
| T13 | Storage expiry (TTL) erasing a statement or site, allowing reuse | persistent storage; TTL extended on every write; archived persistent entries are restored, not recreated | Residual: entries untouched for ~30 days archive and need a restore op before use; they are never "absent". Not tested on a network over time. |
| T14 | Front-running a retirement with the same statement hash | only the site's responsible party can retire that site | Residual: someone else's site could publish a copied statement hash first (G4 makes the original fail). Low impact: the record shows who retired what; statements should carry the site id. |
| T15 | Auth replay of signed entries | Soroban nonces and signature expiration (host) | Host-level; observed working in the spike. |
| T16 | Wrong network | spike refuses unless the passphrase is the standalone network | Closed for scripts. |
| T17 | Key exposure | no script reads, prints or stores a secret; spike keys are in-memory, random and discarded | Closed for this repo. Ceremony keys stay on holders' machines (SOW D2). |
| T18 | Supply chain | exact `soroban-sdk = "=29.0.1"`, `Cargo.lock`, `package-lock.json`; stellar-cli tarball pinned by sha256 in CI | Residual: dependencies not audited. |
| T19 | Anchoring marker vs zero supply | — | **Gap**: Instaward #1 anchors pay a 1-stroop QWATT marker from an unlocked treasury. Incompatible with G1/G2 for the new QWATT. The SOW must name the replacement (XLM marker or manageData only). |

## Assumptions

- The Stellar Asset Contract behaves as read in `soroban-env-host 29.0.1` (admin-only mint,
  `check_not_issuer` on mint/burn, `from.require_auth()` on burn/transfer) and as observed on
  the local network (protocol 30).
- The local network's behaviour for classic auth (thresholds, master weight 0) matches
  testnet. Not yet confirmed on testnet.
- Fees on testnet/mainnet differ from the local network's; see STATUS.md.
