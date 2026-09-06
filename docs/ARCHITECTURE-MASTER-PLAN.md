# QWATT — Software Architecture Master Plan

> Engineering only. No positioning, no business model — those live in `INNOVATION-AUDIT.md`
> and `STRATEGY-TOKENIZATION.md`. Written 2026-09-05.
> Companions: `VERIFICATION-MODEL.md` (the protocol) · `EXECUTIVE-AUDIT-2026-08-25.md` (site state)

---

# Part A — Can QWATT verify an energy price index?

## A.1 The short answer

**No — and the distinction is worth more than a yes would be.**

QWATT verifies that a *physical event happened*, by checking measurements against physics at the
instrument. `PNRGINDEXM` is not a physical event. It is the IMF's **Global Price of Energy Index**
(2016 = 100, monthly, not seasonally adjusted, computed from benchmark prices for crude, gas and
coal) — a *computed statistic* published by a third party.

You cannot verify a statistic without its inputs. QWATT has no independent access to the
transactions the IMF aggregates, so any claim to "verify" the index would be exactly the kind of
overreach the verification model spends a whole section refusing.

## A.2 What QWATT *can* do, precisely

It can **witness** it: produce a tamper-evident, timestamped, hash-chained record asserting

> *at time `T`, source `U` returned value `V` for series `S`, period `P` — response digest `H`.*

That is an **oracle attestation**, not a verification. The honest word is **witnessed**, and it
belongs in a different trust class with a different name, a different ladder, and a hard rule
against promotion.

### The two data classes

| | **Class P — Attested Physical Event** | **Class W — Witnessed External Datum** |
|---|---|---|
| Claim | "This energy was produced" | "This is what the source said when asked" |
| Basis | Physics gates at two instruments | Transport integrity only |
| Ladder | A0 simulated → A4 audited | W0 ephemeral → W3 multi-operator |
| Can be wrong because | Instruments lie *and* physics disagrees | The source itself is wrong — undetectable here |
| Mints QWATT | Yes | **Never** |

**Hard invariant: a Class W datum can never become Class P.** More signatures raise confidence in
*transport*, never in the *truth of the underlying number*. Any code path that upgrades a W to a P
is a bug, and it should be a failing test, not a comment.

### The witness ladder

| Level | Definition | Detects |
|---|---|---|
| **W0** | Single fetch, not retained | Nothing — today's aWATTar/CoinGecko calls |
| **W1** | Single source, hash-chained, anchored on-chain | Later tampering with our own record |
| **W2** | ≥2 independent endpoints agreeing within tolerance | One source being wrong or compromised |
| **W3** | W2 + signatures from operators we do not control | Us being wrong or compromised |

W2 is deliberately the same idea as gate **G3** (meter agreement) applied to data sources instead
of instruments. That symmetry is not decoration — it means one mental model and one review
covers both halves of the system.

## A.3 The genuinely valuable thing here

Not pricing. **Revision detection.**

Economic series are revised quietly. `PNRGINDEXM` is monthly, sourced from the IMF's Primary
Commodity Prices release, and back-periods change. Almost nobody keeps a tamper-evident record of
what a series said *at the moment a decision was made against it*.

A W1 witness log gives that for free:

```
series PNRGINDEXM · period 2026-06
  witnessed 2026-07-20T12:00Z  value 118.4  digest 7c1a…
  witnessed 2026-08-20T12:00Z  value 121.9  digest 9f30…   ← revised, +2.95%
```

This is directly useful to QWATT itself: the **vintage-pricing invariant** requires proving what a
reference price was at origin, years later, against a counterparty with an incentive to dispute it.
It is also a small public good that costs about a dollar a year to run.

## A.4 The copyright constraint, and the neat way around it

FRED states the series is **copyrighted by the IMF; redistribution requires permission and
citation.** QWATT must not republish IMF values on a public page.

**Publish the commitment, not the value.** Anchor `sha256(series | period | value | retrieved_at | source_url)`.
The digest reveals nothing, and anyone with their own legitimate FRED access recomputes it and
verifies the claim. QWATT redistributes nothing and still proves everything.

This also generalises: it is how the protocol should handle any licensed or private data.

## A.5 Two things `PNRGINDEXM` must never be used for

1. **Per-interval settlement.** It is *monthly*; intervals are *5-minute*. Four orders of magnitude
   apart. Interpolating a monthly index down to five minutes fabricates precision.
2. **Pricing delivered electricity.** It tracks energy *commodities* — crude, gas, coal — not
   delivered power. Using it as a kWh price is a category error. **EPEX day-ahead stays the
   electricity reference**; `PNRGINDEXM` is only ever a long-horizon macro deflator for
   multi-year contract terms.

## A.6 Verdict

Build the witness subsystem — it is small, genuinely useful, and reuses machinery that exists.
Ship it as **"QWATT Witness"**, never as verification, and put the P-vs-W distinction on the public
page beside the assurance ladder. Being the project that publicly refuses to call witnessing
verification is worth more than the feature.

---

# Part B — Master plan

## B.0 Current state, and the one problem that outranks the rest

| Component | Language | Repo | State |
|---|---|---|---|
| Website (14 pages) | HTML/JS, no build | `academiaseul/QWATT` | Live |
| Wallet module + vendored deps | JS (ESM) | `academiaseul/QWATT` | Live |
| `miner.js` + `validators.js` (V1–V7) | Node | `academiaseul/QWATT` | 24 tests passing |
| ESP32 firmware | C++ | `plantasolar/qwatt` | Per Build Book |
| Gateway `ingest`/`anchor`/`issuer` (G0–G3) | **Python** | `plantasolar/qwatt` | Per Build Book, 40 tests |
| Browser gate demo | JS, inline | `academiaseul/QWATT` | Live on `verificacion.html` |

### The problem

**The gate logic exists three times, in two languages, across two repositories.**

- Python `gateway/ingest.py` — G0–G3, production issuance path
- Node `mining-rig/validators.js` — V1–V7, tested, not wired to anything
- Inline JS in `verificacion.html` — a hand-written third copy for the demo

Three implementations drift. The failure mode is specific and bad: **the public demo eventually
shows behaviour the production gateway does not have**, on the one page whose entire purpose is
showing that the checks are real. That is the credibility of the project, lost to a copy-paste.

### The fix — one spec, generated bindings

```
protocol/gates.spec.json        ← SINGLE SOURCE OF TRUTH
   ├─ thresholds per site       (nameplate, ceiling k, elevation floor, agreement %, deadband, Δt max)
   ├─ gate definitions          (id, inputs, rule, failure message key)
   └─ version                   (semver — anchored in every batch)
        │
        ├── python: gateway/gates/_generated.py   ← generated, never hand-edited
        ├── node:   mining-rig/gates.generated.js ← generated
        └── web:    assets/gates.generated.js     ← generated, used by verificacion.html
```

- **Python stays canonical** for issuance: it is further along, has 40 hermetic tests, ruff and
  mypy clean, and reuses the audited `bess.kpi.energy` engine from the parent project.
- Node and browser copies become **generated artifacts**, checked in (no build step on deploy)
  and verified in CI by regenerating and diffing.
- A **conformance suite** — one JSON file of `{input, expected_verdict, expected_reason}` cases —
  runs against all three. Divergence fails the build.
- The spec version is written into every batch manifest, so an anchored event records which rules
  judged it.

**This is the highest-value engineering item in the plan.** Everything else is ordinary work.

## B.1 Target architecture

```
┌─ EDGE ─────────────────────────────────────────────────────────┐
│  ESP32 node        sample 5 s → interval 5 min → sign → POST   │
│                    (no gates here: sensors measure, not judge)  │
└──────────────────────────────┬─────────────────────────────────┘
                               │ HTTPS, outbound only
┌─ GATEWAY (Python) ───────────▼─────────────────────────────────┐
│  ingest      schema validate · dedupe · persist raw            │
│  gates       G0–G3 from the generated spec · fail closed       │
│  ledger      accepted.jsonl · rejected.jsonl · hash chain      │
│  anchor      canonical JSON → SHA-256 → batch manifest         │
│  issuer      intent record → atomic 3-op tx → confirm          │
│  witness     external series → W-ladder → separate chain       │
│  reconcile   issued − redeemed vs measured; non-zero exit      │
└──────────────────────────────┬─────────────────────────────────┘
                               │ Horizon
┌─ STELLAR ────────────────────▼─────────────────────────────────┐
│  manageData anchor.sha256 + manageData cumulative + payment    │
└──────────────────────────────┬─────────────────────────────────┘
                               │ read-only, public
┌─ WEB (static, no backend) ───▼─────────────────────────────────┐
│  verificacion  gates demo (generated spec)                     │
│  proof         Explorer — events from Horizon                  │
│  wallet        non-custodial signing                           │
│  reconciliation  recompute in the viewer's browser             │
└────────────────────────────────────────────────────────────────┘
```

**Module boundary rules**

1. **Sensors do not judge.** The node measures and signs; it never decides admissibility. Gate
   logic belongs where it can be re-run by a reviewer.
2. **The web tier is read-only.** It holds no secrets, calls no privileged endpoint, and can be
   fully reconstructed from public chain state. This is why the site has no backend, and that
   should stay a rule rather than an accident.
3. **The issuer is the only writer.** One process, one key, one code path to mint.
4. **Witness is a sibling of ingest, never a caller of issuer.** Class W must be structurally
   incapable of minting — enforced by module boundary, not by discipline.

## B.2 Interfaces to freeze early

Versioned and treated as contracts, because three implementations and a public verifier depend on them:

| Contract | Consumers | Rule |
|---|---|---|
| `interval.schema.json` | firmware → gateway | Additive changes only within a major version |
| `batch.manifest.json` | gateway → chain → any verifier | **Canonical JSON**: sorted keys, no whitespace, UTF-8. Byte-identical or the hash is worthless |
| `gates.spec.json` | all three gate impls | Semver; version recorded in every batch |
| `witness.record.json` | witness → chain | Separate namespace: `qwatt.witness.*`, never `qwatt.anchor.*` |
| on-chain keys | everything | `qwatt.anchor.sha256`, `qwatt.cumulative_kwh`, `qwatt.witness.<series>` |

## B.3 Testing strategy

| Layer | Approach | Gate for merge |
|---|---|---|
| Gate logic | Shared conformance suite across Python/Node/web | 100% of cases, all three impls |
| Adversarial | One test per adversary in `VERIFICATION-MODEL.md` §2 | All must reject |
| Canonicalisation | Property test: key order and whitespace never change the digest | Must hold |
| Issuance | Simulated Horizon: timeout, conflict, partial failure, double-submit | No double mint under any ordering |
| Reconciliation | Property test: issued ≤ measured, always | Must hold |
| Firmware | Host-side unit tests for framing and Modbus parsing | Compiles + tests pass |
| Web | Existing browser checks + Lighthouse budget | No a11y or contrast regressions |

**The one test that matters most:** replay the induced-fault drill recordings — real captured
data from shading a sensor, unplugging a bus, injecting at night — as fixtures. Fixtures from
real faults are worth more than any synthetic case, and they turn the drill into a permanent
regression suite.

## B.4 Security architecture

| Concern | Rule |
|---|---|
| Node key | On device, signs evidence only. Cannot mint alone. |
| Treasury key | Vault/HSM on the co-signer. **Never** on a node, never in a browser, never in the repo. |
| Browser | Non-custodial only. Delete every pasted-secret input in `console.html` and `grid.html` before mainnet — they are the last ones. |
| Transport | Node is outbound-only; accepts no inbound connections. |
| Dependencies | Vendored and pinned (already done for the wallet). No CDN in any signing path. |
| CSP | Add headers; the rest of the security stack is already in place. |
| Replay | Monotonic sequence + non-overlapping windows + `prev_hash` — enforced in code, covered by tests. |
| Double-mint | Intent record precedes submit; timeout recovers by searching for the anchor hash. |

## B.5 Observability

Minimum viable, because an unobserved gateway that silently stops is indistinguishable from a
site with no generation:

- **Heartbeat**: last accepted interval age. Alert above 30 minutes of daylight silence.
- **Rejection rate** by gate id. A sudden G3 spike means a meter is dying, not that fraud began.
- **Chain lag**: local ledger height vs Horizon. Refuse to issue when behind.
- **Reconciliation drift**: `issued − measured`, computed daily, alerting on any non-zero.
- Structured JSON logs, one line per interval decision, with the gate verdicts inline.

**Absence of signal is never evidence of health** — the night-zeros rule applies to monitoring too.

## B.6 Phased plan

| Phase | Scope | Exit criterion |
|---|---|---|
| **0 · Unify** | `gates.spec.json` + generators + conformance suite; retire the hand-written browser copy | Three impls agree on every conformance case |
| **1 · First event** | Distributor secret → miner → `QW-000001`; wire `validators.js` into `miner.js` | A real event, A1-labelled, visible in the Explorer |
| **2 · Rig** | ESP32 + dual meters + gateway per Build Book; drill fixtures captured | Non-empty rejection log with reasons; A2 |
| **3 · Witness** | W-ladder, FRED/IMF at W1→W2, digest-only anchoring, revision detection | Two sources agreeing; a detected revision |
| **4 · Co-sign** | Treasury co-signer service, vaulted key, independent re-check | No single key can mint; A3 |
| **5 · Harden** | CSP, delete pasted-secret paths, CI with the conformance gate, observability | Clean adversarial review; mainnet-ready checklist |

Phases 0 and 1 are independent of hardware and can start immediately. Phase 3 is genuinely small
once phase 0 exists — it is the same chain-and-anchor machinery pointed at a different input class.

## B.7 Decisions still open

1. **MWh vs kWh.** The genesis memo says `1 QWATT = 1 MWh`, immutably; the Build Book says kWh.
   Blocks `issuer.py`. Recommendation stands: keep MWh, solve readability with display units.
2. **One repo or two.** Two repos with a shared spec is workable, but the spec must then be a
   versioned package rather than a copied file. Merging into one is simpler if nothing external
   depends on `plantasolar/qwatt`.
3. **Python or Node as canonical.** Recommendation: Python for issuance (further along, audited
   energy engine, 40 tests). Node keeps the browser and rig-simulation roles.
4. **Witness anchoring cadence.** Monthly series does not need daily anchoring; weekly is enough
   to catch revisions without noise.
