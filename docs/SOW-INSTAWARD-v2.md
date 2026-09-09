# QWATT — Statement of Work · Stellar Instawards (v2)

**Project:** Meter-agnostic verification engine with multi-party authorization on Stellar Testnet
**Team:** Jae Hee Kim · Diego Ostertag — Santiago, Chile
**Duration:** 30 days · **Budget:** USD 5,000 (USDC) · **Scope:** software only
**Repository:** github.com/academiaseul/QWATT (Apache-2.0) · **Live:** qwatt.org · qwatt.org/verificacion

---

## 1. What changed since v1

v1 was rejected for hardware in the budget, an unverified cost line, an offtake contract, a
30-day RWA-token scope, and a single-operator verification risk. Each is addressed, not
reworded.

| Reviewer concern | v2 response |
|---|---|
| **30% of budget on hardware** | **Zero hardware.** Budget is 100% engineering hours. Testing uses a solar simulator, replay of public PV generation data, and recorded fault fixtures. |
| **"Hardware line to be confirmed against a local quote"** | No external quotes exist in this budget. Every line is hours × rate per deliverable. |
| **RWA token issued and validated in 30 days** | **Token issuance is out of scope.** This sprint delivers the verification layer. The existing QWATT testnet asset is used only as a demonstration vehicle for anchoring; issuance semantics, redemption and any RWA claim are deferred to a follow-on grant (§8). |
| **Offtake contract = business development** | Removed. No commercial deliverables of any kind. |
| **Centralization of the oracle operator** | Single-signer anchoring is replaced with **Stellar-native 2-of-3 multisig**: a proposer, an independent verifier that re-runs every check from published data, and an off-team third signer. A record the verifier rejects cannot be anchored even if the team signs it. Every check is open-source and reproducible by anyone. |

## 2. Problem

Energy meters speak dozens of dialects — Modbus register maps differ per vendor, some devices
only export CSV, others push JSON. Every "verified generation" project today re-implements
ingestion for its own hardware, keeps its verification logic private, and lets one operator
decide what gets recorded. The result is data nobody outside the team can check.

## 3. What this sprint builds

A software layer that turns **any standard meter's output** into **independently verifiable,
multi-party-authorized records on Stellar** — with the checks published, the rejections
published, and no single key able to write.

```
any meter ──adapter──▶ interval.schema.json ──▶ gates (versioned spec) ──▶ batch + hash
     ▲                                                                        │
     │ Modbus RTU/TCP · HTTP/JSON · CSV replay                                │
     │                                                                        ▼
     └──── anyone re-runs the same gates on the published batch ◀──── Stellar Testnet
                                                              2-of-3 multisig: proposer
                                                              + independent verifier
                                                              + third signer
```

Built on shipped, open-source work: the V1–V7 validator suite with 24 adversarial tests
(`mining-rig/validators.js`), the verification model, the public gate demo at
qwatt.org/verificacion, and the live testnet asset.

## 4. Deliverables

### D1 · Meter-agnostic ingestion layer — 25 h
- Modbus RTU/TCP adapter where the **register map is configuration, not code**: a new meter
  is supported by adding a JSON file, never by editing the engine.
- HTTP/JSON push adapter and CSV/file replay adapter.
- All adapters normalize to a versioned `interval.schema.json` (timestamp, Δt, Wh, W, meter id,
  instrument class).
- Ships with three example register maps as configs (PZEM-017, EPEver Tracer series, one
  generic single-phase AC meter).
- **Acceptance:** the same input, delivered through all three adapters, produces byte-identical
  verification output.

### D2 · Single-source gate specification + conformance suite — 20 h
- `gates.spec.json`: every threshold and rule (nameplate ceiling, solar-elevation gate, meter
  agreement, plausibility bounds) in one versioned file.
- Generated bindings for the engine and for the public browser demo — the demo runs the
  generated code, not a hand-written copy.
- Conformance suite: one fixture file of `{input, expected verdict, reason}` cases executed
  against every binding in CI. Divergence fails the build.
- The spec version is written into every anchored batch, so each record states which rules
  judged it.
- **Acceptance:** 100% conformance across bindings; existing 24 adversarial tests pass
  unchanged against the generated engine.

### D3 · Multi-party authorization on Stellar — 25 h
- Anchoring account configured with native multisig, medium threshold **2-of-3**:
  - **Proposer** — the verification engine, signs batches it accepted.
  - **Independent verifier** — a separate service holding a separate key. It downloads the
    *published* batch, recomputes the canonical hash and re-runs the gates from
    `gates.spec.json`, and signs only on agreement. It never receives data from the proposer
    directly.
  - **Third signer** — held off-team, designated at kickoff.
- One atomic transaction per batch: `manageData` evidence hash + `manageData` cumulative
  total (+ a payment op against the existing testnet asset as the anchoring vehicle only).
- **Acceptance:** with the proposer alone, nothing anchors. With a batch altered after the
  verifier's read, nothing anchors. Both demonstrated with fixtures and linked transactions.

### D4 · Public evidence feed + browser reconciliation — 15 h
- Every batch — **accepted and rejected** — published as canonical JSON with its hash and
  rejection reason.
- Reconciliation page recomputes, in the visitor's browser from Horizon: anchored hashes ↔
  published batches, cumulative totals, and gaps in sequence.
- **Acceptance:** a reviewer with no access to the team verifies any anchored batch end-to-end
  from public artifacts alone.

### D5 · Real-data validation without hardware — 15 h
- Replay ≥30 days of a public PV generation dataset through D1→D4 on testnet.
- Replay the induced-fault fixtures (shaded sensor, disconnected meter, night injection,
  implausible ramp) — every one must be rejected and logged.
- Public write-up linking every transaction.
- **Acceptance:** non-empty rejection log with reasons; every accepted interval traceable to an
  anchored transaction; solar-elevation gate pinned in tests to Santiago's real values.

## 5. Budget — USD 5,000

| Deliverable | Hours |
|---|---:|
| D1 · Ingestion layer | 25 |
| D2 · Gate spec + conformance | 20 |
| D3 · Multisig + independent verifier | 25 |
| D4 · Evidence feed + reconciliation | 15 |
| D5 · Validation + write-up | 15 |
| **Total** | **100 h × USD 50** |

No hardware, hosting beyond free tiers, marketing, legal, audit, or prior work. Testnet fees are
zero. Hours are those funded; the team contributes additional time at its own cost.

## 6. Security posture

- **No single key can write.** Enforced by Stellar multisig, not by policy.
- **No hidden logic.** Gates are open-source, versioned, and reproducible; the version is on-chain.
- **Rejections are public.** A verifier that shows only successes has demonstrated nothing.
- **Adversarial coverage.** One test per attack in the trust model; drill fixtures become permanent regressions.
- **Honest limits.** The team operates the proposer and verifier services. This design does not claim decentralization; it claims that every record is independently verifiable and that authorization requires a party outside the team. Removing the team from operations entirely is the on-chain verifier of the follow-on grant (§8).

## 7. Out of scope

Hardware of any kind · token issuance, redemption or any RWA claim · Soroban contracts ·
commercial agreements · mainnet · marketing.

## 8. Next steps — the grant path

| Stage | Scope | Funding |
|---|---|---|
| **This sprint** | Verification engine, multisig anchoring, public evidence | Instaward 1 |
| **Instaward 2** | Issuance semantics on testnet: `min(A,B)` tokenization, floor-never-round, cumulative accounting, double-mint protection, burn on redemption | Instaward |
| **Instaward 3** | Soroban verification contract: the independent verifier becomes an on-chain contract rather than a service; QWATT-C retire semantics | Instaward |
| **SCF Build** | Physical pilot (dual-metered rooftop), assurance-level audit, legal structure, mainnet readiness | SCF |

Each stage is a separate submission with its own acceptance criteria; none depends on approval
of the next.

## 9. Milestones

| Day | Checkpoint |
|---|---|
| 7 | D1 adapters + schema; three register-map configs merged |
| 14 | D2 spec, generated bindings, conformance green in CI |
| 21 | D3 multisig live on testnet; first 2-of-3 anchored batch; negative tests linked |
| 28 | D4 feed + reconciliation page live; D5 replay complete |
| 30 | Write-up published; all links in the final report |
