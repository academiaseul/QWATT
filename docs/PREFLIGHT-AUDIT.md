# QWATT — Instawards pre-flight audit

**Date:** 2026-09-09 · **Commit audited:** `dfdcb24` · **Purpose:** answer, from the repository rather
than the SOW, whether the 30-day sprint in `docs/SOW-INSTAWARD-v3.md` is deliverable. Every claim
below was checked by running code or querying Horizon on the audit date.

---

## 1. The ten pre-flight questions

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Does the verification engine actually run? | **Yes.** | `assets/qwatt-gates.js` (231 lines, zero dependencies, no literals) runs in Node and in the browser. Live at qwatt.org/verificacion with the badge `spec 1.0.0 · 056f1b51`; every preset verdict matches the conformance fixtures. |
| 2 | Are the 29 conformance cases automated? | **Yes.** | `node protocol/conformance.test.js` → 35 checks green (29 cases + 6 binding checks). Runs under `npm test` and in `.github/workflows/conformance.yml`, no install step. |
| 3 | Are the 24 adversarial tests automated? | **Yes.** | `node mining-rig/validators.test.js` → 24/24, one per adversary in `docs/VERIFICATION-MODEL.md`. Runs under `npm test`. |
| 4 | What is the current interval schema? | **Formal and closed.** Batch schema: **not yet.** | `protocol/interval.schema.json`: `spec_version, site_id, node_id, seq, ts_start, ts_end, dt_s, meters{a,b}{id,class,wh,w_mean?,samples?}, clock_skew_s?, source{adapter,register_map?,raw_sha256?}`, `additionalProperties:false`. Validated by `protocol/schema-lite.js`. A batch today is an ad-hoc object shape used by the validator tests (`v, site, node, seq, window, energy_wh, witness, samples_w, integrity, prev_hash`). |
| 5 | Is the Stellar asset functional? | **Yes, live on testnet.** | Horizon on 2026-09-09: QWATT / `GDN6IW…BLT46` — supply 42,700,000, 2 authorized trustlines. Distributor `GCLS6E…SOKW` holds 42,700,000, **1 signer, thresholds 0/0/0** (no multisig configured). |
| 6 | How much multisig code exists? | **None.** | `git grep setOptions\|signer\|threshold` finds only a sentence in `backup.html`. `manageData` is used nowhere. `miner.js` builds single-operation payment transactions with a memo. The vendored SDK 13.1.0 and account plumbing (`miner.js`, `redeploy-testnet.js`) exist. |
| 7 | Can the engine accept arbitrary JSON? | **Any record that satisfies the interval schema.** Adapters: **mostly missing.** | Unknown fields are rejected by design (case `bench-unknown-field`). `miner.js` has a dependency-free Modbus TCP reader (`readModbusRegisters`, fixed registers, one read per call). No register-map loader, no RTU/serial, no HTTP push, no CSV replay. |
| 8 | How difficult is canonicalization? | **Done for JS. One decision pending for other languages.** | `canonical()` (sorted keys, no whitespace, `undefined` dropped) in `validators.js` and `gen.js`; `batchHash()`; `sampleRoot()` Merkle. Number serialization follows JavaScript `JSON.stringify`; a Python binding must match it. **Recommendation for the architecture freeze:** store energies in batches as integer milliwatt-hours so no float ever reaches the hash. |
| 9 | Production-ish or prototype? | **Verifier layer: early production. Rig: prototype.** | Spec + engine + conformance + generated bindings + CI are deterministic and tested. `miner.js` is a single process with file state, one transaction type, and restart-only recovery. Relevant code totals ≈2,650 lines. |
| 10 | Can two independent environments reproduce the same hash? | **Yes.** | Same canonical batch (409 bytes, includes `Ñandú — ✓`): Node `crypto` → `6cd45997852cb6d9…`; Windows `certutil` (CNG) → `6cd45997852cb6d9…`. Identical. The browser and Node also run the same engine file and agree on every conformance case. |

**Verdict on the SOW's claims:** true as written. The reviewer's 8/10 holds; the codebase is not
"mostly prototypes". What does not exist yet is exactly what the SOW says it will build: adapters,
batch assembly and ledgers, multisig, the independent verifier, the feed, the reconciliation page,
and the reliability work for a seven-day run.

---

## 2. Requirement by requirement

Hours are engineering estimates for two people who know this codebase. "Exists" is the fraction of
the requirement already met by code in the repository.

### Deliverable 1 — Meter-agnostic ingestion (≈ 38 h)

| Requirement | Exists | To build | Hours | Risk |
|---|---|---|---|---|
| Modbus adapter, register map as config | 30 % — TCP reader in `miner.js`, fixed registers | Register-map JSON loader (address, type, scale, endianness), RTU via serial or RTU-over-TCP gateway, unit-id handling | 18 | RTU serial on Windows/Pi (native module). Mitigation: TCP is the primary path; RTU documented and tested on the Pi only. |
| HTTP/JSON push adapter | 0 % | Small Node HTTP endpoint, schema validation at the door, `raw_sha256` | 4 | Low |
| CSV / file replay adapter | 0 % | Column map config, pacing (real-time or fast), dedupe | 4 | Low |
| Normalization to `interval.schema.json` | 90 % — schema + validator exist | Adapter output plumbing | 3 | Low |
| Two register maps (PZEM-017, EPEver Tracer) | 0 % — register tables known | Two JSON files + unit tests against captured frames | 4 | Low |
| Raw-payload hashing | 0 % — field exists in schema | One function | 1 | Low |
| Adapter harness: byte-identical output | 0 % | Feed one fixture through all three, diff canonical output | 4 | Low |

### Deliverable 2 — Evidence batches & hash chain (≈ 33 h)

| Requirement | Exists | To build | Hours | Risk |
|---|---|---|---|---|
| Batch definition (`batch.schema.json`) | 0 % — ad-hoc shape in tests | Fields per SOW: id, start/end, interval count, accepted/rejected counts, schema version, spec version, prev hash, Merkle root, cumulative energy, sha256 | 4 | Decide integer mWh at the freeze |
| Batch assembly | 60 % — `canonical`, `batchHash`, `sampleRoot` | Assembler that closes a batch on a schedule, links `prev_hash`, persists | 10 | Low |
| Accepted / rejected ledgers (JSONL) | 0 % | Append-only writers, reason codes from the engine | 4 | Low |
| Evidence manifest format | 0 % | One JSON per batch with links to raw intervals | 3 | Low |
| Batch-level conformance cases | 20 % — gate tests exist, chain tests do not | Tamper a batch, tamper an interval, break the chain, reorder — each must be detected | 6 | Low |
| Historical scale test | 0 % | Choose a public PV dataset, map to CSV replay, run one month in fast mode | 6 | Dataset licence — use an open one (NREL PVDAQ or Open Power System Data) |

### Deliverable 3 — Multi-party authorization (≈ 47 h)

| Requirement | Exists | To build | Hours | Risk |
|---|---|---|---|---|
| Multisig account (2-of-3, medium threshold) | 0 % — thresholds are 0/0/0 today | `setOptions` with two added signers, weights 1/1/1, thresholds low 1 / med 2 / high 3 | 4 | Locking yourself out — rehearse on a throwaway account first |
| Proposer service | 20 % — `miner.js` builds and submits transactions | Build the 3-op transaction, sign with proposer key, publish batch + partially signed XDR | 10 | Low |
| Independent verifier service | 0 % — engine is reusable as-is | Separate host, separate key; fetch **only** from the public feed; recompute hash; re-run gates from `gates.generated.js`; sign the XDR only on agreement; submit | 16 | The heart of the sprint. Must not share a filesystem, process or key with the proposer. |
| Third signer onboarding | 0 % | Key ceremony with an off-team holder, signing procedure doc, availability agreement | 3 | **External dependency — the one blocker that is not engineering.** |
| Atomic 3-op transaction | 0 % | `manageData qwatt.anchor.sha256` (64 hex chars = 64 bytes, the manageData limit) + `manageData qwatt.cumulative_kwh` + payment | 6 | Low |
| Negative tests A–D with links | 0 % | Scripted, published, linked from the write-up | 6 | Low |
| Verifier-independence acceptance test | 0 % | Unpublished batch → verifier cannot sign | 2 | Low |

### Deliverable 4 — Feed, reconciliation, seven-day run (≈ 66 h)

| Requirement | Exists | To build | Hours | Risk |
|---|---|---|---|---|
| Public evidence feed | 0 % | Static publication of batches, ledgers, manifests (Vercel or object storage), index file | 8 | Low |
| Reconciliation page | 40 % — `proof.html` already reads distributor transactions from Horizon | Read `manage_data` from transactions, fetch feed, recompute hashes and cumulative totals in the browser, flag gaps | 14 | Low |
| Recovery logic before day 21 | 30 % — `state.json`, idempotent PoG memos | Restart-safe state, Horizon timeouts + retries with backoff, duplicate-interval rejection, clock sanity, verifier/signer unavailability without data loss | 16 | **Highest operational risk.** |
| Seven-day live run | 0 % | Deployment, health checks, alerting, daily evidence snapshots | 8 + 7 days wall time | Testnet reset window — see blockers |
| Fault injections | 50 % — fixtures exist in tests | Injection tool that feeds fixtures into the live adapter path | 4 | Low |
| End-to-end QA | 0 % | — | 8 | — |
| Write-up + short video | 0 % | — | 8 | — |

**Total ≈ 184 h of build, plus ≈ 8 h architecture freeze and ≈ 10 h buffer → ≈ 200 h.**
The SOW's 70 funded hours are a fraction of that, which the SOW now states explicitly.

---

## 3. Blockers, ranked

1. **Third signer.** Without an off-team key holder by day 10, deliverable 3 cannot meet its own
   acceptance criteria. Ask Joaquín / Stellar Barrio this week. Fallback: any Stellar community
   member who is not a founder. Last resort, stated honestly in the write-up: a founder-held key in
   separate custody — weaker, and the SOW would need to say so.
2. **Repository is private.** Evidence for every deliverable begins with "public GitHub
   repository". Anonymous requests return 404 today. No secrets are tracked; the history is clean.
   Founder decision.
3. **Testnet reset.** Stellar resets testnet periodically. A reset between day 14 and day 30 wipes
   the asset, the multisig account and the anchored transactions. Check the published reset date
   before day 1; if it falls inside the sprint, schedule the live run after it and note it in the
   plan. `mining-rig/redeploy-testnet.js` already automates recovery.
4. **Verifier hosting.** It must run on a provider the proposer does not use. A free-tier VM is
   enough; the account should be created before day 13.
5. **Modbus RTU on the dev machines.** Native serial modules are fragile on Windows. Keep TCP as the
   primary path for the sprint; prove RTU on the Pi with the USB-RS485 dongle only.
6. **Number canonicalization across languages.** Decide integer milliwatt-hours in batches at the
   freeze so a future Python binding cannot disagree on a float.

---

## 4. Thirty-day plan, day by day

Two tracks run in parallel. Both founders share roles; the split is by track, not by person.

| Days | Track A — evidence path | Track B — authorization path | Gate |
|---|---|---|---|
| 1–3 | **Architecture freeze.** `batch.schema.json`, integer mWh, adapter interface, evidence layout, feed URL scheme | **Architecture freeze.** Verifier interface, transaction format, signer weights/thresholds, key custody plan | Freeze document committed. No code before this. |
| 4–7 | Register-map loader, Modbus TCP, HTTP push, CSV replay, two register maps, harness | Rehearse multisig on a throwaway testnet account; create verifier host + key; draft third-signer procedure | Harness shows byte-identical output across three adapters |
| 8–12 | Batch assembler, ledgers, manifest, chain conformance cases, historical scale test | 3-op transaction builder; proposer service publishes batch + partial XDR | One month of history chained without a break; tampering detected |
| 13–17 | Public feed publication; start reconciliation page | **Independent verifier**: fetch from feed only, recompute, re-run gates, sign on agreement | Verifier signs an honest batch and refuses a tampered one, from the public URL only |
| 18–20 | Reconciliation page complete; fault-injection tool | Multisig live on the real distributor; tests A–D published with links | First 2-of-3 anchored batch |
| 21–22 | **Integration freeze.** Recovery logic, retries, restart tests, kill-the-verifier tests | Same | No new features after day 22 |
| 23–30 | **Seven-day live run.** Monitor, inject faults on schedule, snapshot evidence daily | Same | Seven consecutive days anchored; rejection log non-empty; write-up and video |

---

## 5. Probability of delivery

| Condition | Full SOW delivered | Deliverables 1–3 + shortened live run |
|---|---|---|
| Third signer secured by day 10, freeze discipline held, no testnet reset in window | **≈ 75 %** | ≈ 90 % |
| Third signer secured late (after day 17) | ≈ 55 % | ≈ 85 % |
| No off-team signer at all | ≈ 30 % (acceptance criterion unmet) | ≈ 70 % |

The engineering is ordinary. The three things that decide the outcome are not engineering: name
the third signer, make the repository public, and stop adding features on day 22.
