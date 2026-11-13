# qwatt-issuance · Status report

Fri 13 Nov 2026. Every result below was **run**, unless marked NOT TESTED.
Contract Wasm: 14,155 B, sha256 `94ab691868115134544eaa127f4dad09d523cd01cc5cccf5a55532768603d618`
(soroban-sdk 29.0.1, stellar-cli 28.1.0, rustc 1.97.0). The same hash was built twice and is
the one deployed in the local-network evidence.

**Where it ran:** this container, and a local standalone network (`stellar/quickstart --local`,
protocol 30). **Not on testnet. Not on mainnet.** Not audited.

## Legend
PASS = performed and passed · FAIL = performed and failed · NOT TESTED = planned or
needs something not available here · PARTIAL = part performed (says which).

## Phase 1 · Audit
| Item | Result |
|---|---|
| Repository audited (no prior Rust/Soroban code; Diego's Oct prototype not in repo) | PASS |
| Instaward #2 SOW (Drive, v1) read and compared | PASS. Discrepancies listed at the end. |
| SAC capabilities verified from `soroban-env-host 29.0.1` source (docs sites unreachable here) | PASS, then confirmed on the network (Phase 2) |

## Phase 2 · Mechanics spike (local network, `evidence/local/spike-run.json`)
| # | Criterion | Result |
|---|---|---|
| M1 | SAC admin of a classic asset can be set to a contract | PASS |
| M2 | Issuers locked afterwards (master weight 0, no signers) | PASS |
| M3 | Locked issuer cannot issue (classic payment → `txBadAuth`), cannot take admin back | PASS |
| M4 | Nobody but the contract can mint (issuer key, any other key) | PASS |
| M5 | Mint and burn of the same amount in one call; contract balance 0 after | PASS (4,120,000 stroops minted and burned, 1 tx) |
| M6 | Classic 2-of-3 account as governance source: 1 signature refused, 2 accepted | PASS |
| M7 | One-key relay refused, both keys accepted | PASS |
| M8 | Zero outstanding (both SAC balances 0, the only trustline 0) | PASS |
| R | 12/12 scripted refusals refused | PASS. **Caveat:** the "SAC transfer out of the contract" refusal failed on balance (`#10`), not on auth; the auth path is proven separately in-process (unit test). |
| — | Same spike on **testnet** (SOW wants local + testnet before the reset) | NOT TESTED (needs your approval) |

**Fallback needed?** No. Every mechanic held, so the SOW's fallback ("an issuer that stays
locked, still with no transfer path") is not triggered.

### Fees and resources
Local network, fee actually charged (stroops; 1 XLM = 10,000,000):

| Operation | Fee charged | CPU instructions | Write bytes |
|---|---|---|---|
| accrue | 14,360 | 2,629,084 | 640 |
| retire (mint + burn + record) | 262,839 | 1,363,400 | 1,088 |
| register_site (2-of-3 governance) | 208,762 | 743,159 | 488 |
| SAC set_admin | 3,786 | 213,189 | 484 |
| SAC deploy (each asset) | 51,711 | 177,793 | 488 |
| Wasm upload, first time | 10,505,032 | 13,007,200 | 14,256 |
| contract deploy, first run | 34,580,382 | 1,071,797 | 488 |
| contract deploy, second run (Wasm cached) | 209,272 | 1,071,018 | 488 |

In-process estimate on the Wasm (`target/conformance/cost-estimate.json`): accrue about
774k instructions, retire about 1.10M, 1–4 entries written. The SDK's fee **estimate**
(mainnet fee snapshot) is about 4.4–5.2M stroops. Most of that is rent for the test
harness's mock-auth nonces plus the SDK's deliberately high rent rate, so it is **not**
a fee forecast. Testnet and mainnet fees: NOT TESTED.

## Phase 3 · Contract
| Criterion | Result | Evidence |
|---|---|---|
| Site registration (governance only, class fixed, no duplicates) | PASS | A06, D03, E05 |
| Monotonic verified accrual (exact next seq, cumulative never decreases) | PASS | R01–R06, I06, P3 |
| Integer Wh accounting, floor never round, remainder carried | PASS | I02–I04, V03, P2 |
| Checked arithmetic (u64 seq overflow, u128, i64::MAX stroop cap) | PASS | V01–V06 |
| Role-based authorization (governance / two-key relay / responsible party) | PASS | A01–A10, P7 |
| Pause / freeze | PASS | P01–P04, F01–F04 |
| Unique statement commitments (global, domain-separated) | PASS | D01–D02, P6, KAT unit test |
| Non-overlapping consumed ranges | PASS | O01–O10, P5 |
| Retirement: mint and burn in one call, zero balance | PASS | I01, unit events test, P1, M5 |
| Explicit evidence levels; simulated never on live | PASS | E01–E06, D02 |
| Domain-separated hashes, identical in Rust and JS | PASS | known-answer unit test, transcripts |
| No transfer / approve / public mint / upgrade export | PASS | `check-interface.mjs` |

## Phase 4 · Conformance and properties
| Criterion | Result |
|---|---|
| ≥ 40 fixtures | PASS: 62 cases, 214 steps |
| Fixtures include replay, duplicate, overlap, overflow, unauthorized, contamination, frozen, invalid sequence | PASS |
| BigInt JS model meets every expectation | PASS |
| Rust contract (native) meets every expectation | PASS |
| Rust contract (**compiled Wasm**) meets every expectation | PASS |
| Transcripts identical, model vs native and model vs Wasm (incl. every digest and commitment) | PASS (byte-identical) |
| 1,000 random sequences (30,000 steps), model vs native, identical | PASS (16,032 refusals; 36 distinct operation/result pairs) |
| Random sequences on the Wasm | NOT TESTED in `run-all.sh` (native only, for time); the hand-written cases do run on Wasm |
| Property-based testing (proptest, 128 sequences, 7 invariants, shrinking) | PASS |
| Mutation check (10 planted bugs) | PASS after a fix: see below |

**Mutation check, honestly:** the first run (`evidence/local/mutation-run1.txt`) found
that an off-by-one mutant accepting a retirement starting at `retired − 1` (a 1 Wh double
claim) was **missed by every suite**. Boundary cases O09, O10 and R06 and a property-test
bias were added. The second run (`mutation-run2.txt`) catches **10/10** by the cases and
10/10 by the random differential; proptest alone catches 5/10 (it checks invariants, not
which refusal is correct).

## Phase 5 · Deliverables
| Item | Result |
|---|---|
| Threat model | PASS (`docs/THREAT-MODEL.md`; 19 threats, open ones named) |
| Reproducible local scripts (`run-all.sh`, `local-network.sh`, `local-spike.mjs`) | PASS: `run-all.sh` ran end to end here; `--network` path ran piece by piece |
| CI workflow (`.github/workflows/soroban-issuance.yml`) | NOT TESTED: written, never run on GitHub Actions |
| Transaction evidence | PASS, local network only (`evidence/local/spike-run.json`; hashes are local-network hashes, not viewable on any explorer) |

## Discrepancies with the Instaward #2 SOW (not changed silently)
1. **Timing.** The SOW says "the issuance contract itself does not exist yet; it is written
   during this sprint" (Day 1 = 7 Dec). This prototype now exists. Disclose it as prior
   work, or keep it unmerged: your decision.
2. **Anchoring marker.** Instaward #1 anchors pay a 1-stroop QWATT marker from an unlocked
   treasury. That can't coexist with locked issuers and zero supply for the new QWATT. The
   SOW must name the replacement.
3. **Upgrades.** The SOW mentions governance approving an upgrade. The prototype has no
   upgrade path, deliberately (an upgrade key could mint). Decision needed.
4. **Testnet spike** (SOW D1): NOT TESTED, needs your approval.
5. **Ranges are contiguous from 0.** A site's statements consume `[0,a)`, `[a,b)`, … in
   order. The SOW doesn't specify this, and it is the simplest way to make overlap
   impossible. Arbitrary non-contiguous ranges would need an interval index.
6. **Relay input.** Accrual takes the anchored `cumulative_mwh`. The two-key relay
   service itself (SOW D2) is not built.

## Not built (SOW items outside this prototype)
Token Policy v1; statement schemas (canonical JSON, salted commitments, Merkle rows);
ceremony XDR scripts; the relay service; event archive; Freighter retire page;
reconciliation v3 and proof page; stellar.toml; the three flows; outside review.
