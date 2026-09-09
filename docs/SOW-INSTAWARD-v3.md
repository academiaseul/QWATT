# Instawards Statement of Work (SOW)

### 30-Day Scoped Engagement

## 1. Project & Team Information

| Field | Value |
|---|---|
| **Project Name** | QWATT — The Clean Token |
| **Builder / Team** | Jae Hee (Jay) Kim, Diego Ostertag |
| **Primary Contact** | Jae Hee (Jay) Kim — jay@quorelia.org |
| **Ambassador Chapter** | Chile |
| **Ambassador Chapter Lead** | Bastian Koh |
| **Date Submitted** | September 2026 |
| **Suggested Sprint Start Date** | TBD |
| **Duration** | 30 days (4-week sprint) |

---

## 2. Instawards Overview & Intent

### 2.1 Purpose

This Instaward focuses on delivering a meter-agnostic verification engine for renewable energy generation, with multi-party authorization on Stellar Testnet.

Rather than building around one specific device, this sprint delivers a software layer that accepts the output of any standard energy meter — Modbus, HTTP/JSON or CSV — normalizes it to one record, runs it through open, versioned physics gates, and anchors the accepted evidence on Stellar through a 2-of-3 multisig in which an independent verifier re-runs every check from published data.

The result will be a fully demonstrable pilot where a reviewer with no access to the team can take any anchored batch, download its evidence, re-run the gates and confirm the on-chain hash — and where no single key, including the team’s, can write a record on its own.

This is a resubmission. Compared with the previous proposal it removes all hardware, the offtake agreement and token issuance from scope, and replaces single-operator anchoring with multi-party authorization.

---

## 3. Problem Statement & Objective

### Problem Being Addressed

QWATT already has the technical foundation for verifying solar generation: a versioned gate specification, a shared verification engine with a 29-case conformance suite, seven adversarial validators with 24 tests, and a live testnet asset. What it lacks is the path from a real meter to a record that someone outside the team can trust.

Today there is no integrated flow allowing:

- a standard meter of any brand to feed the engine without custom code
- an interval to be assembled into a hash-chained, publicly downloadable evidence batch
- an anchoring transaction to require a signature from a party the team does not control
- an outside reviewer to reconcile what is on-chain against what was published
- a rejected interval to be visible to anyone at all

Without this, QWATT cannot demonstrate that Stellar can carry independently verifiable energy records, or validate the verification model with real data.

---

### Objective

Within 30 days QWATT will deliver a reviewer-verifiable, meter-agnostic verification pipeline on Stellar Testnet.

Any Modbus, HTTP or CSV meter source will be able to feed the engine through configuration alone; every batch — accepted or rejected — will be published with its hash and reason; accepted batches will be anchored only when a proposer, an independent verifier and an off-team third signer agree; and a public reconciliation page will let anyone confirm the chain end-to-end from Horizon and the evidence feed.

---

## 4. Scope of Work

### Deliverable 1 (Week 1)

#### Meter-Agnostic Ingestion

Build:

- Modbus RTU/TCP adapter with the register map as configuration (JSON), not code
- HTTP/JSON push adapter
- CSV / file replay adapter
- Normalization to the versioned interval schema (interval.schema.json)
- Three reference register maps: PZEM-017, EPEver Tracer series, generic single-phase AC meter
- Raw-payload hashing so the normalization itself is auditable
- Adapter test harness: the same input through all three adapters yields byte-identical output

#### Why this matters

This is what makes the engine usable by any renewable installation: a new meter becomes a configuration file, and the verification logic never changes to accommodate hardware.

---

### Deliverable 2 (Week 2)

#### Evidence Batches & Hash Chain

Build:

- Batch assembly from accepted intervals: canonical JSON, SHA-256, prev_hash chain, Merkle root over raw samples
- Gate specification version stamped into every batch
- Accepted and rejected ledgers with reason codes (append-only JSONL)
- Evidence manifest format for public download
- Batch-level conformance cases added to the existing suite
- Phase-2 batch gates (sun witness, ramp, chain, integrity) wired to the generated spec bindings

#### Why this matters

A verifier that shows only its successes has demonstrated nothing. The chain makes every record tamper-evident, and the rejection ledger makes the checks falsifiable by anyone.

---

### Deliverable 3 (Week 3)

#### Multi-Party Authorization on Stellar

Build:

- Anchoring account configured with native Stellar multisig, medium threshold 2-of-3
- Proposer service: signs batches the engine accepted
- Independent verifier service on a separate host with a separate key: downloads the published batch, recomputes the hash, re-runs the gates and signs only on agreement — it never receives data from the proposer directly
- Third signer key held off-team, designated at kickoff
- One atomic transaction per batch: manageData evidence hash + manageData cumulative total + payment op, using the existing testnet asset as the anchoring vehicle only
- Negative tests: the proposer alone cannot anchor; a batch altered after the verifier’s read cannot anchor

#### Why this matters

Enforcement moves from policy to the ledger. No single key — including the team’s — can write a record, and the party that must agree re-derives its decision from public data.

---

### Deliverable 4 (Week 4)

#### Public Evidence Feed, Reconciliation & Real-Data Validation

Build:

- Public evidence feed: every batch, accepted and rejected, with hash and reason
- Browser reconciliation page reading Horizon: anchored hashes ↔ published batches, cumulative totals, sequence gaps
- Replay of at least 30 days of a public PV generation dataset through the full pipeline on testnet
- Replay of induced-fault fixtures (shaded sensor, disconnected meter, night injection, implausible ramp) — each must be rejected and logged
- End-to-end QA
- Public write-up linking every transaction
- Demo video

#### Why this matters

Rather than asking reviewers to trust screenshots, the sprint ends with a page that recomputes the truth in the visitor’s browser and a rejection log that proves the gates bite.

---

## Out of Scope

To maintain an achievable 30-day scope, the following items are explicitly excluded:

- Hardware of any kind (no meters, panels, boards or field installation)
- Token issuance, redemption or any real-world-asset claim
- Soroban smart contracts
- Mainnet deployment
- Commercial or offtake agreements
- Energy trading or energy sales of any kind
- Legal or corporate structuring
- SCADA or monitoring-platform integrations
- Marketing and community campaigns
- KYC or identity verification

---

### 4.2 Deliverable-Aligned Budget Request

**Requested Budget: USD $3,500**

The request is deliberately below the Instawards maximum. Both founders develop full time for the sprint, the gate specification and conformance suite are already shipped, and no hardware is needed. The award funds approximately 70 engineering hours at USD 35/h plus the operating items below; the remaining founder time is contributed.

#### Operational & Core Team (70%)

- Protocol & verification engineering
- Meter adapter development (Modbus, HTTP, CSV)
- Stellar integration (multisig, transactions, Horizon)
- Independent verifier service
- QA, conformance & adversarial testing
- Technical documentation & write-up

#### Technology & Operations (30%)

- Independent verifier hosting on a provider separate from the proposer
- CI and repository infrastructure
- Public PV dataset acquisition and processing
- AI-assisted development
- Demo & video production
- Documentation

---

## 5. 30-Day Execution Plan

### Week 1

Modbus adapter with register-map configs  
HTTP/JSON and CSV adapters  
Schema normalization  
Three reference register maps  
Adapter harness  

**Expected Output**

Any of the three adapters feeds the engine and produces byte-identical verification output for the same input.

---

### Week 2

Batch assembly and hash chain  
Accepted and rejected ledgers  
Evidence manifest  
Batch-level conformance  
Phase-2 gates on the spec  

**Expected Output**

Intervals become hash-chained evidence batches, with rejections recorded and published with reasons.

---

### Week 3

Multisig account setup  
Proposer service  
Independent verifier service  
Third signer onboarding  
Atomic anchoring transaction  
Negative tests  

**Expected Output**

The first 2-of-3 anchored batch on Stellar Testnet, with linked transactions proving a single signer cannot anchor.

---

### Week 4

Evidence feed  
Reconciliation page  
30-day public dataset replay  
Fault-fixture replay  
QA  
Write-up and demo video  

**Expected Output**

Complete public verification pipeline with a non-empty rejection log and a reconciliation page anyone can run.

---

## 6. Evidence of Completion

### Deliverable 1

**Evidence**

- Public GitHub repository
- Three register-map configuration files
- Adapter harness output showing identical results across adapters
- CI run

---

### Deliverable 2

**Evidence**

- Sample evidence batches and manifests
- Accepted and rejected ledgers with reason codes
- Conformance suite run (CI link)

---

### Deliverable 3

**Evidence**

- Multisig account on stellar.expert showing the three signers and thresholds
- Stellar Testnet transaction hashes of anchored batches
- Transaction attempts demonstrating single-signer rejection
- Independent verifier logs

---

### Deliverable 4

**Evidence**

- Live reconciliation page URL
- Public evidence feed URL
- Replay write-up linking every transaction
- Rejection log from fault fixtures
- End-to-end demonstration video

---

## Evidence Verification Checklist

| Deliverable | Evidence Present | Partial | Missing |
|---|:---:|:---:|:---:|
| Meter-Agnostic Ingestion | ☐ | ☐ | ☐ |
| Evidence Batches & Hash Chain | ☐ | ☐ | ☐ |
| Multi-Party Authorization | ☐ | ☐ | ☐ |
| Evidence Feed & Validation | ☐ | ☐ | ☐ |

---

## 7. Next-Step Alignment

Following this Instaward, QWATT will be positioned to pursue the remaining layers in separate, independently scoped grants: a second Instaward for issuance semantics on testnet (min(A,B) tokenization, floor-never-round accounting, double-mint protection, burn on redemption); a third Instaward moving the independent verifier into a Soroban contract, so the team is no longer an operator in the authorization path; and an SCF Build Award for the physical pilot (dual-metered rooftop), assurance audit, legal structure and mainnet readiness. Each stage has its own acceptance criteria and none depends on approval of the next.

---
