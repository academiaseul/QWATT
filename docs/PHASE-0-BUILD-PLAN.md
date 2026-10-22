# QWATT Phase 0 — Build plan

**Source:** `QWATT-Instawards-SOW-final-v4.docx` (Instaward, 30-day sprint, Stellar Testnet)
**Repository:** https://github.com/academiaseul/qwatt (Node, zero-dependency engine)
**Budget:** 131 founder engineering hours (USD 4,585 at USD 35/h). This plan allocates exactly 131 h.
**Baseline measured:** 2026-10-08, upstream `main` at `48a40d3`.

The sprint delivers a software pipeline: any meter → normalized interval → hash-chained evidence
batch → public evidence feed → anchored on Stellar only when a proposer and an independent verifier
both sign (2-of-3 multisig) → seven unattended days of live anchoring that anyone can reconcile from
Horizon. No hardware, no token issuance, no Soroban.

---

## 1. Where we start

`npm test` on upstream `main`: **82 tests pass**. That's 37 conformance tests against gate spec
1.0.0, 24 adversarial-validator tests and 21 ingestion tests. CI (`.github/workflows/conformance.yml`)
is green on every recent push.

| SOW item | State today | Evidence |
|---|---|---|
| D1 Modbus RTU/TCP adapter, register map as JSON | **Built** | `ingest/adapters/modbus.js`, `ingest/lib/registermap.js` |
| D1 HTTP/JSON push adapter | **Built** | `ingest/adapters/http.js` |
| D1 CSV / file replay adapter | **Built** | `ingest/adapters/csv.js` |
| D1 normalization to `interval.schema.json` | **Built** (schema v1.1.0, integer mWh) | `ingest/lib/normalize.js` |
| D1 reference maps PZEM-017 + EPEver Tracer | **Built** | `ingest/maps/*.json` |
| D1 raw-payload hashing | **Built** | `raw_sha256` in every interval |
| D1 byte-identical harness | **Built, passing** | `ingest/harness.js`: 24/24 intervals identical across csv/http/modbus |
| D2 `batch.schema.json` | **Defined** (v1.0.0) | `protocol/batch.schema.json` |
| D2 batch assembly, chain, ledgers, manifest, scale test | **Not started** | hashing + Merkle primitives exist only in `mining-rig/validators.js` |
| D3 multisig, proposer, verifier, tests A–D | **Not started** | design exists in `docs/ARCHITECTURE-FREEZE.md` (written for SOW v3) |
| D4 evidence feed, reconciliation page, live run | **Not started** | `proof.html` already reads Horizon and is a reusable starting point |

**Implication:** Deliverable 1 is about 90% done before Day 1. The plan spends that slack on the
sprint's biggest risk, Deliverable 3 (an independent verifier on a separate host plus an off-team
signer), rather than on polish.

---

## 2. Decisions needed before Day 1

These block the architecture freeze. Each has a recommendation; the founders decide.

1. **Name the third signer** (SOW: "held off-team, designated at kickoff"). They generate their key
   on their own device and send only the public key. The rest of the setup can't proceed without
   it. *Candidate to ask: the Chile chapter lead, or another Stellar ambassador.*
2. **Anchoring account.** The v3 freeze converts the existing distributor (treasury holding 42.7M
   QWATT) into the multisig account. *Recommend a new dedicated anchoring account* with a QWATT
   trustline and a small balance. That keeps the treasury out of an off-team quorum, limits the
   blast radius, and makes "anchoring vehicle only" literally true.
3. **Payment amount.** The v3 freeze pays `floor(energy_mwh / 1e9)` QWATT per batch, which is
   energy-proportional distribution. SOW v4 puts token issuance out of scope and uses the asset as
   the "anchoring vehicle only". *Recommend a fixed nominal payment* (0.0000001 QWATT to a fixed
   team account) so no reviewer can read the anchor as issuance.
4. **The "implausible ramp" fault vs the deferred ramp gate.** D4 requires an injected implausible
   ramp to appear in the rejection log with its reason. But SOW v4 defers wiring the Phase-2 gates
   (sun witness, ramp, integrity) into the spec, and the active engine (`assets/qwatt-gates.js`)
   runs only G0 plausibility, G1 nameplate, G2 elevation and G3 agreement. As things stand, a ramp
   injection either passes or gets caught by a different gate. *Recommend* designing the ramp
   injection so it trips a gate that exists: it exceeds nameplate × interval (G1), or its energy
   contradicts its mean power (G0 `plausibility.energy_power`). Log it under the gate that
   actually catches it, and have the write-up say plainly that the dedicated ramp gate ships in
   Instaward #2. Do **not** wire the ramp gate mid-sprint; that's out of scope.
5. **Evidence-feed host.** The verifier must read only public URLs, never the proposer. *Recommend a
   public static host the proposer can write to but doesn't serve itself*, such as a public object
   bucket or a dedicated GitHub Pages branch. Deploy-per-batch on the main Vercel site is clumsy
   at hourly cadence.
6. **Verifier host.** Separate provider and separate account from the proposer (SOW). *Recommend*
   that the founder who doesn't run the proposer owns and operates the verifier host, so
   independence is organizational as well as technical.
7. **License.** SOW v4 says MIT; the repository has `LICENSE` = Apache-2.0. Align one to the other
   before the first evidence link goes out.
8. **Day 1.** SOW: "October 1st, 2026 or once received the funds". Fix the date. The calendar in
   §8 assumes Monday 12 October.
9. **Award amount.** The SOW requests USD 4,585; confirm the awarded figure and whether anything
   beyond the 131 h is expected.

---

## 3. Overview

| Phase | Days | SOW deliverable | Hours | Hard exit gate |
|---|---|---|---:|---|
| 1 — Re-freeze & close D1 | 1–7 | Meter-agnostic ingestion | 22 | Freeze v2 committed; D1 evidence in CI; multisig rehearsed on a throwaway account |
| 2 — Evidence batches & hash chain | 8–14 | Evidence batches & hash chain | 30 | Unbroken hash chain over one month of public PV data; batch conformance in CI |
| 3 — Multi-party authorization | 15–22 | Multi-party authorization | 45 | First 2-of-3 anchor live (target Day 21, **latest Day 23**); tests A–D published; recovery proven |
| 4 — Feed, reconciliation, live run | 23–30 | Evidence feed & seven-day live run | 34 | 7 × 24 h unattended anchoring; injected faults in the public rejection log; write-up |
| | | | **131** | |

Each phase follows the same loop: write the phase's acceptance check first, take a baseline, build,
then re-run the acceptance check and the full regression suite (`npm test`, never allowed to go red).

---

## 4. Phase 1 — Re-freeze and close Deliverable 1 (Days 1–7, 22 h)

**Goal:** the architecture matches SOW v4 and is frozen, Deliverable 1's evidence is collected, and
the riskiest Stellar mechanics (multisig) are proven on a throwaway account before anything depends
on them.

**Acceptance check, written first:** CI green, including the harness; `docs/ARCHITECTURE-FREEZE.md`
v2 committed with a "deviations from v3" section; two rehearsal transaction hashes recorded (one
rejected as under-signed, one accepted); the third signer's public key recorded in the freeze.

| ID | Unit | Done when | Dominant risk | h |
|---|---|---|---|---:|
| 1.1 | Kickoff decisions (§2) recorded and signed off by both founders | Decisions table committed in the freeze | Third signer not found in time | 2 |
| 1.2 | **Architecture freeze v2.** Amend the v3 freeze for v4: nominal payment, dedicated anchoring account, batch-level rejection semantics (rejected batches published, never anchored), `samples_root` required (the SOW lists "Merkle root over raw samples" as a batch field; the schema has it optional), test A–D definitions (below), feed layout for rejected batches and verifier refusals, the ramp decision | Freeze v2 committed; every change vs v3 listed with its reason | Re-opening settled design | 5 |
| 1.3 | **Reason-code registry** `protocol/reasons.json`: `gate.*`, `batch.*`, `verifier.*`, `ingest.*`, plus a test that every emitted code is registered | Test fails on an unregistered code | Codes drifting between proposer and verifier | 2 |
| 1.4 | **D1 close-out against v4 wording:** Modbus RTU path verified (`serialport` or RTU-over-TCP), map addresses confirmed against manuals, harness output saved as evidence | CI link + saved harness output | Serial native module on the gateway OS | 4 |
| 1.5 | License alignment (decision 7) | One license across the SOW, `LICENSE` and `package.json` | — | 0.5 |
| 1.6 | **Multisig rehearsal on a throwaway testnet account** (pulled forward from week 3): 3 signers × weight 1, thresholds low 1 / med 2 / high 3, master weight 0; submit `manageData` with one signature (expect `tx_bad_auth`), then with two (expect success). Script kept as `anchor/rehearse.js` (run 8 Oct 2026 at 1/2/3: one signature was refused as tx_failed/op_bad_auth; rehearse.js now sets 2/2/3 and expects tx_bad_auth) | Both transaction hashes recorded | Threshold or master-weight mistakes locking an account | 4 |
| 1.7 | **Public PV dataset:** one month, ≤ 5-min resolution, licence checked. If it has a single channel, document how the second meter channel is derived for the agreement gate | Dataset (or fetch script) + provenance note (URL, licence, SHA-256) committed | Licence or resolution unusable | 2.5 |
| 1.8 | **Verifier host provisioned:** separate provider and account, Node 20, NTP on, key generated *on the host*, public key recorded | Host reachable; key never left it | Same-provider shortcut weakening independence | 2 |

**Test A–D definitions (for 1.2).** SOW wording for D is "evidence altered after the verifier's
read". Make it testable as: *the published batch file is altered after the proposer signed the
pending XDR; the verifier recomputes a different hash, refuses with `verifier.hash_mismatch`, and
nothing anchors.* A: proposer signs alone → network rejects. B: verifier signs alone → network
rejects. C: both sign → anchored. Independence test: a batch the proposer holds but hasn't
published can't be signed, because the verifier has no input path to it.

---

## 5. Phase 2 — Evidence batches and hash chain (Days 8–14, 30 h)

**Goal:** intervals become hash-chained, publicly downloadable evidence batches, with every
rejection recorded with a reason code.

**Acceptance check, written first (unit 2.1):** batch conformance cases fail before the assembler
exists and pass after; the one-month scale replay produces an unbroken chain, run twice with an
identical head hash.

| ID | Unit | Done when | Dominant risk | h |
|---|---|---|---|---:|
| 2.1 | **Batch conformance cases first:** genesis `prev_hash` = 64 zeros; chain link; `intervals_root`; `samples_root`; `energy_mwh` = Σ intervals; `cumulative_mwh` arithmetic; integers only, refusing non-safe integers and `Infinity` (`JSON.parse('1e999')` yields `Infinity`); tampering with any field changes `sha256` | Cases committed, failing as expected | Cases that only test the happy path | 4 |
| 2.2 | **Batch assembler** `batch/assemble.js`: close every 12 intervals or on restart (freeze §2); canonical JSON; SHA-256; `prev_hash`; Merkle roots. Move `canonical`, `batchHash` and `sampleRoot` out of `mining-rig/validators.js` into one shared module, so there is a single implementation, the same way the gates have a single spec | 2.1 cases pass | Two hash implementations silently diverging | 6 |
| 2.3 | **Accepted / rejected ledgers**: append-only JSONL with reason codes and batch id; restart-safe (resume `seq` from the last published batch, never from memory) | Kill-and-restart test resumes the chain without a gap or a duplicate | State lost on crash | 4 |
| 2.4 | **Batch-level rejection:** a batch failing batch-level checks is published with its reason and never queued for anchoring | Test: rejected batch present in the feed, absent from the anchoring queue | Rejections silently dropped | 3 |
| 2.5 | **Evidence manifest + local feed writer:** `index.json`, `batches/`, `ledger/`, manifests, mirroring freeze §5 | Feed directory validates against the schemas | Layout drifting from what the verifier expects | 4 |
| 2.6 | **Scale test:** one month of public PV data through the CSV adapter at fast pace (≈ 8,640 intervals → ≈ 720 batches) | Output committed: head hash, counts, wall time, identical on a second run | Non-determinism (key order, float leakage) | 5 |
| 2.7 | **Offline re-verification CLI** `verify-batch`: given only a feed directory, recompute every hash, root, link and total, and re-run the gates. This is the core the Phase 3 verifier service wraps | CLI re-derives all ≈ 720 scale-test batches identically | Verifier logic forked from proposer logic | 4 |

---

## 6. Phase 3 — Multi-party authorization (Days 15–22, 45 h)

**Goal:** accepted batches anchor on Stellar only when the proposer and an independent verifier both
sign, the verifier's sole input is the public feed, and the pipeline survives restarts, timeouts and
an absent signer. The pipeline is left running.

**Acceptance check, written first:** a script that runs tests A–D plus the independence test
against testnet and asserts the four expected outcomes. A recovery test set: kill the proposer
mid-submit; simulate a Horizon timeout; take the verifier offline for an hour and confirm it catches
up without double-anchoring.

| ID | Unit | Done when | Dominant risk | h |
|---|---|---|---|---:|
| 3.1 | **Anchoring account live** per freeze v2: trustline, nominal balance, 3 signers, thresholds 2/2/3 (amended 21 Oct 2026, was 1/2/3), master weight 0 | Visible on stellar.expert with signers and thresholds (D3 evidence) | Misconfigured thresholds | 3 |
| 3.2 | **Deterministic transaction builder** (shared): batch → envelope with `manageData qwatt.anchor.sha256`, `manageData` cumulative total, nominal payment, memo `QW#<seq>`, 24 h timebounds. The verifier rebuilds the transaction **from the batch** and signs only if its hash equals the pending XDR's hash, so it never trusts the proposer's envelope | Proposer and verifier builders produce byte-identical XDR in tests | Envelope fields the verifier doesn't re-derive | 5 |
| 3.3 | **Proposer service:** accepted batch → publish to feed → build → sign → publish `pending/<id>.xdr` | Batches appear in the public feed before any pending XDR | Signing before publishing (breaks the independence property) | 6 |
| 3.4 | **Verifier service** on the separate host: poll the feed index → fetch batch → `verify-batch` → rebuild the transaction → compare → sign → submit; publish refusals as `verifier.<check>`. No proposer address is configured anywhere on that host | Independence test passes; refusals visible in the feed | A convenience shortcut to the proposer | 8 |
| 3.5 | **Feed host live** (decision 5) and the proposer's publish step | Reviewer can download any batch by URL | Caching delays the verifier into timebound expiry | 3 |
| 3.6 | **Recovery logic, done before Day 21** (SOW D4): restart-safe state; on a Horizon timeout, search for the anchor hash before resubmitting, because a timed-out transaction can still land; sequence refresh and retry; duplicate-interval rejection; clock checks against `clock_max_skew_s`; expired timebounds → rebuild; verifier or signer unavailable → batches stay *published but unanchored* and catch up later. No automatic substitution of a different signer | Recovery test set passes | Double-anchoring on retry | 8 |
| 3.7 | **Tests A–D + independence test** run and published, each transaction linked | Five linked results, failures with their network result codes | — | 4 |
| 3.8 | **Third-signer liveness:** the third signer co-signs one transaction on the throwaway account, proving the key works before it's ever needed for recovery | One linked transaction | Off-team signer unreachable when needed | 2 |
| 3.9 | **First live 2-of-3 anchor + integration freeze (Days 21–22):** heartbeat on both hosts, alert when no anchor for 2 h, operator runbook (restart, catch-up, testnet-reset replay) | First anchored live batch linked; runbook committed | Missing the Day 23 hard stop | 6 |

**Days 21–22 are an integration freeze:** no new features, only reliability, recovery and
documentation.

---

## 7. Phase 4 — Evidence feed, reconciliation and the seven-day live run (Days 23–30, 34 h)

**Goal:** seven consecutive days of unattended anchoring at real-time pace, a reconciliation page
anyone can run, and a rejection log that proves the gates bite.

**Rule for this phase:** the architecture stays untouched. Everything built here is *read-only*
relative to the running pipeline (page, write-up, QA). A defect fix during the run is allowed only
as a documented deviation.

**Acceptance check, written first:** a reconciliation script (the same logic the page runs) that,
from Horizon plus the feed, confirms every anchored hash matches its published batch, the chain has
no gaps, totals add up, and every scheduled fault appears in the rejection log with its reason.

| ID | Unit | Done when | Dominant risk | h |
|---|---|---|---|---:|
| 4.1 | **Live run starts** (Day 23, 7 × 24 h): solar simulator and CSV replay at real-time pace; 15-minute daily check routine | Seven consecutive days of anchored transactions | Host downtime breaking "consecutive" | 4 |
| 4.2 | **Reconciliation page** (browser, reads Horizon + feed): recompute each batch's SHA-256 in the browser (SubtleCrypto), anchored ↔ published, cumulative totals, sequence gaps, rejected counts. Start from `proof.html` | Page URL works for someone with no team access | Page trusting a field it should recompute | 10 |
| 4.3 | **Public evidence feed URL** with an index page | URL listed in the write-up | — | 2 |
| 4.4 | **Fault injections during the live run**, spread across days with UTC times logged: shaded sensor → G3 agreement; disconnected meter → G3 (second meter required); night injection → G2 elevation; implausible ramp → G1 or G0 per decision 4 | Each fault in the public rejection log with its reason, and no anchor for it | A fault caught by the "wrong" gate without saying so | 4 |
| 4.5 | **End-to-end QA as a reviewer:** someone outside the team (the third signer is a good fit) follows only the write-up and verifies one batch end to end | Their notes committed | Instructions that only work for us | 4 |
| 4.6 | **Write-up linking every transaction**, with the transaction table **generated from the feed**, not hand-assembled | Write-up published; every hash links to stellar.expert | Hand-copied hashes with typos | 6 |
| 4.7 | Evidence checklist (SOW §6) completed and submission assembled | Every row marked Present with a link | — | 2 |
| 4.8 | Incident buffer for the live run | Unused hours are reported, not reallocated to features | — | 2 |
| — | Demo video (SOW: produced on contributed founder time, outside the 131 h) | Video linked | — | 0 |

---

## 8. Critical path, calendar and risks

**Critical path:** third signer named (Day 1) → freeze v2 (Day 3) → batch assembler (≈ Day 10) →
verifier service + recovery on the separate host (≈ Day 20) → first live anchor (target Day 21,
**hard stop Day 23**) → live run (Days 23–30). Any slip past Day 23 eats into the seven days, and
seven consecutive days can't be staged after the fact.

**Example calendar, with Day 1 = Monday 12 October:**

| Phase | Dates |
|---|---|
| 1 | Mon 12 Oct – Sun 18 Oct |
| 2 | Mon 19 Oct – Sun 25 Oct |
| 3 | Mon 26 Oct – Mon 2 Nov (Day 21 = Sun 1 Nov) |
| 4 | Tue 3 Nov – Tue 10 Nov (live run) |

Day 21 falls on a Sunday. Aim for the first live anchor by **Friday 30 October (Day 19)** so the
weekend is buffer, not schedule.

| Risk | Likelihood | Mitigation |
|---|---|---|
| Testnet reset during the live run (`PROGRESS.md`: "~quarterly") | Low–medium | Check SDF's announced reset schedule at kickoff; the feed is off-chain, so batches can be re-anchored from it; `mining-rig/redeploy-testnet.js` and the runbook replay procedure |
| Verifier host downtime breaks consecutive anchoring | Medium | Process supervisor, heartbeat alert at 2 h, catch-up anchoring; a late anchor still covers its interval, and the gap stays visible on the reconciliation page |
| Third signer unavailable or slow | Medium | Named at kickoff; liveness proven in 3.8; only needed for recovery and signer changes, not for normal anchoring |
| Horizon timeouts / rate limits | Medium | 3.6: anchor-hash lookup before every retry; backoff |
| Scope creep (ramp gate, Soroban, issuance semantics) | Medium | Freeze v2 §"Out of the freeze"; each is a named item in a later Instaward |
| Clock skew on either host | Low | NTP on both; `clock_max_skew_s` enforced; skew stamped in every interval |

---

## 9. Running the sprint with agents

- **Eval-first, per phase.** Each phase begins with its acceptance check (written above) and a
  baseline run. The regression eval is the full `npm test` suite, 82 tests today, growing every
  phase, and it runs in CI on every push.
- **Unit size.** Each unit above is a half-day to a day of founder time. When handing a unit to an
  agent, split it further into tasks that are each independently verifiable, carry a single risk,
  and have a clear done condition.
- **Model routing (tier and effort):**

| Work | Tier | Effort |
|---|---|---|
| Freeze v2, verifier independence design, recovery logic (3.6), adversarial review at the end of each phase | Opus | high–xhigh |
| Batch assembler, transaction builder, services, reconciliation page | Sonnet | medium–high |
| Reason-code registry, fixtures, write-up table generation, dataset conversion | Haiku | low |

  Escalate effort before tier, and only when a lower setting fails with a clear reasoning gap.
- **Review focus for agent-written code:** invariants (integers only, single hash
  implementation, publish-before-sign), error boundaries (Horizon, feed host), key handling
  (secrets never in the repo, a browser or a chat), and coupling between proposer and verifier. Lint
  and formatting are left to tooling.
- **Session strategy:** one working session per phase; start fresh at each phase boundary; compact
  only after an exit gate passes.
- **Cost discipline:** record model, effort, tokens, retries and wall time per unit in a short
  sprint log. That gives the write-up honest numbers on AI-assisted engineering.

---

## 10. Prior art from the September prototype

`plantasolar/qwatt/` is a Python prototype built against the earlier hardware-and-issuance SOW. It
is **superseded**: different stack, and both hardware and issuance are now out of scope. Do not
port the code. Its adversarial review findings do transfer directly to unit 3.6 and are worth
reusing as test cases:

1. A Horizon timeout can still land a transaction, so look up the anchor hash before resubmitting.
2. Record the intent before submitting, so a crash between submit and bookkeeping can be resolved
   against the chain.
3. Resolve pending intents *before* selecting the next batch. The prototype's second review found a
   double-anchor caused by building the batch first.
4. Deduplicate intervals by timestamp, and compute any watermark as the maximum timestamp, not the
   last arrival.
5. Bound interval length and clock skew at ingestion; reject non-finite numbers at the parse boundary.
