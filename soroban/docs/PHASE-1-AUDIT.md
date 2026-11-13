# QWATT · Soroban issuance prototype · Phase 1 audit

> Phase 1 deliverable, written at 18:50 UTC before Phases 2–5. The Docker blocker it records was resolved the same hour; current results are in STATUS.md.

Fri 13 Nov 2026, 18:50 UTC. Read-only audit: nothing was committed or deployed, and no repo file was changed. No public network was touched.

## Sources read

| Source | Where | Notes |
|---|---|---|
| Repository | `academiaseul/QWATT` `main` @ `4aa7a88` (342 commits) | All of it is JS (Node 24, zero-dependency engine). **No Rust or Soroban code.** |
| Instaward #1 evidence | `docs/ARCHITECTURE-FREEZE-v3.md`, `docs/GATES.md`, `protocol/`, `batch/`, `anchor/`, `evidence/`, the live run | Soroban is explicitly out of scope there (`PHASE-0-BUILD-PLAN.md`: "no token issuance, no Soroban"). |
| Instaward #2 SOW | Google Drive, "QWATT · Instawards SOW · Instaward #2 (v1)", modified 9 Nov 2026 | **Not in the repository.** |
| Prior Soroban work | `docs/PRIOR-WORK.md`: Diego's registry prototype `6bc1b34^..d6d85b2` on his `sprint-phase-0` branch | **Not in this repo, and not reachable from here.** The "issuance design drafted in October 2026" the SOW cites isn't in the repo either. |

## Tooling: verified by running it, not from memory

| Item | Result |
|---|---|
| Rust | rustc / cargo 1.97.0 |
| `wasm32v1-none` target | installed |
| soroban-sdk | **29.0.1** (latest stable on crates.io; 30.0.0-rc.1 is a release candidate, not used) |
| stellar-cli | 28.1.0 (scratchpad binary) |
| Contract build | `stellar contract build` built a probe contract to Wasm (382 B). The SDK **refuses** plain `cargo build` for the Wasm target ("requires stellar-cli v25.2.0+"), and the CLI **refuses** a release profile without `overflow-checks = true`. Both are now hard requirements of the build. |
| Local network | **Initially blocked** (no Docker daemon). **Resolved:** `dockerd` was installed but not running. Started it, pulled `stellar/quickstart:latest` and ran `--local --enable rpc`. RPC is healthy, passphrase `Standalone Network ; February 2017`, **protocol 30**, friendbot works. |
| CLI ↔ local network | Generated a local-only throwaway key (`probe1`, secret never printed, stored only in a scratchpad HOME), funded it, and deployed the native SAC. All succeeded. |
| Docs sites | developers.stellar.org and docs.rs are unreachable from this container. **APIs below were verified from the crate source** (soroban-sdk 29.0.1, soroban-env-host 29.0.1), not from documentation. |

## SAC capabilities (from host source, `soroban-env-host-29.0.1/src/builtin_contracts/stellar_asset_contract/contract.rs`)

| Question | Source evidence | Answer |
|---|---|---|
| Who is admin after deploying a classic asset's SAC? | `write_administrator(e, Address::from_account(e, &asset4.issuer))` at init (l.110/126) | The **issuer**. |
| Can the admin be a contract? | `set_admin(new_admin: Address)`: `admin.require_auth()`, then writes any `Address` (l.356–366) | **Yes.** The current admin (the issuer) must authorize it, so this has to happen **before** the issuer is locked. |
| Who can mint? | `mint`: `read_administrator(e)?.require_auth()` (l.337–343) | Only the admin. With a contract as admin, only that contract's own code. A contract authorizes its own address implicitly when it calls. |
| Can it mint/burn to/from the issuer? | `check_not_issuer` on `mint` (to) and `burn` (from) (l.56) | **No.** Mint into the contract's own C-address, then burn from it. |
| Burn auth | `burn(from)`: `from.require_auth()` (l.253–259) | The contract burns from itself. No allowance is needed. |
| Contract balances | `balance.rs` l.38–41: non-account balances need no trustline. Issuer AUTH flags still apply. | Works without a trustline. **Issuer must not set AUTH_REQUIRED**, or the contract's balance must be authorized first. |
| Fees / resources measurable? | `soroban-sdk` testutils `env.cost_estimate().resources()` / `.fee()` | Yes, in-process. But per its own doc, the fee uses a **hard-coded mainnet fee snapshot (2026-07-10)** and misses transaction size, so it's an estimate. The authoritative figures are from the local network's `simulateTransaction` and the actual fee charged. |

**Conclusion for the Phase 2 hypothesis:** mint-and-burn in one call by a contract admin, with an issuer that is locked afterwards, is **supported by the host code as read**. That is a reading, not a test. Phase 2 must prove it on the local network.

**Not provable in-process:** the classic side of "locked issuer" (master weight 0 stops a classic `payment` from the issuer). That needs a real network, so it goes on the local quickstart.

## Reusable from Instaward #1

- `protocol/evidence.js`: `canonical()` JSON, `sha256`, and the Merkle root. Reusable for statement commitments and the JS reference model's hashing. It is **not domain-separated** today, so new tags are needed.
- `protocol/reasons.json` / the `gates.spec.json` → generated-bindings pattern. Reuse the pattern for issuance reason codes.
- `protocol/conformance/cases.json` + `conformance.test.js`. Reuse the same "one case file, every implementation held to it" pattern for `issuance-cases.json`.
- Batch semantics: `cumulative_mwh` is an integer **milli-watt-hour** running total of **accepted** batches only (V3-3), and `seq` is strictly increasing. This is exactly the monotonic input accrual needs: `verified_wh = floor(cumulative_mwh / 1000)`, so remainders are never rounded up and never lost.
- `.github/workflows/conformance.yml` shape. The Rust job must be a **separate** workflow, because the existing one is "no install step, zero dependencies" by design.
- `anchor/` unsigned-XDR / sign-on-own-machine discipline, for the later ceremony scripts.

## Discrepancies and decisions

1. **SOW timing (the main issue).** SOW #2 §2 says: *"The issuance contract itself does not exist yet; it is written during this sprint"*. Day 1 is Mon 7 Dec, and the sprint "starts only after [the #1] report is accepted". It budgets 140 funded hours, mostly for this contract. Building it now and pushing it to the public repo would make that sentence false. It would also have to be disclosed as prior work, and a reviewer could fairly ask why the hours are funded. This is not a technical blocker, but it is the SOW's boundary. **Needs your decision.**
2. **Marker payment vs. zero supply.** Instaward #1 anchors pay a 1-stroop `QWATT:GC5F…` marker from a treasury whose key Jay holds (DV-10, D-1). SOW #2 has QWATT administered only by the contract, from locked issuers, with zero outstanding supply. It also says the legacy asset is never re-created. A post-reset anchoring account **cannot keep a QWATT marker payment** (that would need a held balance and an unlocked issuer). The SOW says the anchoring account "is set up again" but doesn't say what replaces the marker. This is a gap to close in the SOW or Token Policy, for example an XLM marker or manageData only.
3. **Unit scale.** 1 QWATT = 1 MWh, and the SAC uses 7 decimals. So **1 Wh = 10 stroops** (not 10,000), and 1 stroop = 0.1 Wh. The SOW example holds: 412,000 Wh = 0.412 QWATT = 4,120,000 stroops. Mint/burn amount = `wh × 10`, checked.
4. **Flooring cases are in mWh.** The SOW's 999 / 1,000 / 1,001 mWh cases need mWh input with Wh flooring. Your brief says "integer Wh accounting". Both hold if the contract takes the anchored `cumulative_mwh` and derives Wh by floor.
5. **min(A,B)** is in the SOW (D1) but not in your brief. I would add it as a case family (claimed ≤ verified).
6. **Two assets** (QWATT live, QWA0SIM simulated): "simulated-to-live contamination" maps to the evidence level per site and per asset. A simulated batch on QWATT must be refused.
7. **Two-key relay** (D2): "role-based authorization" for accrual must be **proposer AND verifier**, not either one. A one-key relay must be refused.
8. **Testnet spike.** The SOW wants the spike "on a local network and on testnet, before the reset". Your brief forbids testnet without approval, so **testnet stays NOT TESTED** until you approve it.
9. **Interface check** (D1): no `transfer`, no public `mint`, no `approve` in the contract spec. Easy to check in CI from `stellar contract info interface`.
10. **CI.** A new workflow is a repo change. It goes in a PR for Diego and you to review, like everything else. It doesn't touch the live run (the hosts run the frozen commit `9ee4646`).
11. **Diego's prototype** isn't available. Nothing from it is reused. If he wants it compared, he would need to share the branch.

## Status of the brief's phases

| Phase | Status |
|---|---|
| 1 Audit | **DONE** (this note). |
| 2 Mechanics spike | NOT STARTED. Waiting on decision 1. |
| 3 Contract | NOT STARTED. |
| 4 ≥ 40 fixtures + BigInt model + property tests | NOT STARTED. |
| 5 Threat model, scripts, CI, evidence, status | NOT STARTED. |

## Local environment state (scratchpad only)

- `dockerd` running; container `qwatt-local` (stellar/quickstart, local, protocol 30) on `localhost:8000`.
- `scratchpad/sdkprobe/`: probe crate and a throwaway `probe1` local key. Neither is in the repo.
