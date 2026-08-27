# QWATT — Innovation Audit

> Internal, 2026-08-26. Written to be ruthless, including about the brief that commissioned it.
> No code changed. Companions: `VERIFICATION-MODEL.md` · `LEGAL-NETBILLING.md` · `STRATEGY-TOKENIZATION.md` · `EXECUTIVE-AUDIT-2026-08-25.md`

---

## 0. Three findings that reorder everything else

**a) The proposed positioning fails its own test.** The brief suggests *"an open protocol connecting verified real-world energy events with programmable digital financial infrastructure."* Three of those words are not true today: **open** (one team, one issuer, one node — nobody else can run one), **protocol** (there is no second implementation, no spec anyone has adopted), and **programmable** (Soroban is not used; nothing is programmable yet). §14 of the brief forbids false decentralization claims. That sentence is one. It would be caught by exactly the skeptical judge §19 asks us to imagine.

**b) The innovation is not tokenization, verification, or energy events.** All three exist elsewhere. The genuinely novel mechanism is narrower and stronger: **QWATT is built so that its own claims can be proven false.** Physics gates that fail closed, thresholds published, validators open, and — the part nobody else does — **the rejection log is a deliverable, not a secret.**

**c) The scorecard in §20 contains a category QWATT should deliberately lose.** "Decentralization credibility: 10" is unreachable for a single-operator metering system, and chasing it produces precisely the fake claims §14 bans. The honest substitute is **independent verifiability**, where QWATT can legitimately score at the top. Recommendation: replace the category rather than fake the score.

---

## 1. What QWATT is

### One sentence

> **QWATT turns a claim about generated energy into a falsifiable one — physics-checked at the meter, rejections published, settled on Stellar in the same transaction that records the evidence.**

### Why it needs to exist

Every green-energy claim in circulation today rests on a measurement someone else took and nobody re-checks. Certificates are issued annually against self-reported production; a corporate buyer claiming 24/7 carbon-free power cannot show the hour it happened; a PPA host paying per kWh must trust a meter their counterparty owns; and the carbon market has already demonstrated what happens to an asset class whose verification is weak. The data that would settle these questions exists — meters produce it every few seconds — but it dies inside private systems, unaudited and unauditable. QWATT closes that gap at the only place it can be closed honestly: at the instrument, in the moment, against the physics of that site at that time, with the result anchored where nobody can revise it afterwards.

### Why not just a database?

Mostly it *could* be. A database plus published hashes plus a notary gets you most of the integrity story, and pretending otherwise is the standard blockchain-project dishonesty. Two things a database genuinely cannot do:

1. **Atomicity between evidence and money.** The evidence anchor and the payment are *the same transaction*. You cannot have one without the other, ever, by construction. In a database-plus-payment-rail architecture these are two systems that drift, and reconciling them is a permanent operational tax.
2. **No trusted timestamp authority.** A database's timestamp is asserted by its owner — who is the party making the claim.

If those two properties don't matter to a use case, that use case shouldn't be on-chain. We say so.

### Why blockchain, precisely?

Only for the anchor and the settlement. Measurement, validation, batching and storage are ordinary engineering and stay off-chain. **On-chain: the evidence hash, the cumulative total, the payment — three operations, one atomic transaction.** Everything else off-chain. Any expansion of that list needs to justify itself against this same test.

### Why Stellar?

- **Multi-operation atomic transactions** are the exact primitive the model needs: `manageData` (anchor) + `manageData` (cumulative) + `payment`, all-or-nothing. This is the strongest reason and it is architectural, not preferential.
- **Native assets without contracts** — issuance carries no smart-contract risk surface. For a system whose entire pitch is *fewer things to trust*, a contract-free issuance path is a feature.
- **Fee economics decide feasibility.** At 5-minute intervals, one site produces ~105,000 intervals a year. At Ethereum gas, per-interval anchoring is economically impossible; at ~$0.00001 per operation it costs about a dollar per site-year. This is not a preference — it determines whether the design exists at all.
- **Honest limits:** Soroban is *not* needed yet and we should not pretend otherwise. It becomes necessary for QWATT-C retire/burn semantics, not before. Solana would also be cheap enough; Stellar wins on native assets and the atomic-multi-op shape, not on speed.

### What makes QWATT different

Everyone else publishes their successes. **QWATT publishes its refusals.** The induced-fault drill — shade a sensor, unplug a bus, inject current at night — is a shipped deliverable whose output is a rejection log with reasons. A verification system that has never shown you a rejection has not demonstrated that it verifies anything.

---

## 2. The Energy Event primitive — accept, with one correction

The brief's schema treats verification as binary (`VERIFIED`). That is the weak version, and it is how carbon markets got into trouble: a binary stamp hides how much evidence sits behind it.

The strong version carries **its own assurance level and its own doubts**:

```
QWATT ENERGY EVENT
  event_id        QW-EVT-000001
  site            sha256(lat|lon|installer)      coordinates private, verifiable
  window          2026-09-20T14:00Z → 14:05Z
  energy_wh       11.6                            min(meter_A, meter_B) — never the max
  instruments     A: PZEM-017   B: EPEver Tracer1210AN
  gates           G0 pass · G1 pass · G2 pass · G3 pass
  assurance       A2 · CORROBORATED               from instruments present, not from outcome
  prev_hash       9c02…                           append-only chain
  hash            4ae8…                           anchored in the issuing tx
  status          SETTLED  → tx a91f…
```

Three properties that make it defensible rather than decorative:

- **`min(A,B)`** — a meter fault can understate, never overstate. The system's failure mode is losing revenue, not inventing it.
- **Assurance level, not a checkmark.** A0 simulated → A4 audited. Derived from which instruments exist, never from whether the result was convenient. A0 can never be attested as generation; that is enforced in code.
- **Rejections are first-class objects** with the same schema and a reason. They are published.

**Verdict: make it central.** It is the protocol's atomic unit, it is already implemented, and it is legally careful — it asserts a measurement, never ownership.

---

## 3. Physical / data / verified / represented / settled

Mandatory per §4, and already true in the code. The public site must carry the same separation:

| Layer | What it is | Where it lives | What it does **not** claim |
|---|---|---|---|
| **Physical energy** | Electrons | The array | — |
| **Energy data** | Meter readings | Node, off-chain | Nothing yet |
| **Verified event** | Data that survived the gates | Node + published feed | Not renewable-certified, not owned |
| **Digital representation** | QWATT units | Stellar | Not electricity, not a security, not a REC |
| **Settlement** | Payment | Stellar, same tx | Not a legally enforceable energy delivery |

The last column is the one that keeps the company out of trouble, and it belongs on the website, not just in this file.

---

## 4. White space

| What exists | Why it leaves room |
|---|---|
| **I-RECs / RECs** | Annual granularity, self-reported production, no physics check. Cannot support hourly matching. |
| **Carbon credits** | Reputationally damaged *precisely* because verification was weak and unauditable. |
| **Energy tokenization / RWA platforms** | Tokenize the asset or its revenue; verification of production is assumed, not performed. Commodity layer. |
| **P2P energy trading (Powerledger, WePower, SunExchange…)** | Most stalled on regulation, not technology — retail energy supply is licensed almost everywhere. |
| **SCADA / monitoring vendors** | Excellent data, entirely private. The reader must trust the operator. |
| **24/7 CFE accounting initiatives** | Demand hourly-matched proof that today's instruments cannot supply. |

> **Most systems ask you to trust the measurement. QWATT makes the measurement refutable — and publishes what it refused.**

The unsolved problem is not *recording* energy. It is **making a production claim cheap to disprove.** That is where QWATT sits.

---

## 5. Decentralization — the honest answer

**QWATT is not decentralized, and should stop implying it will be.** One issuer, one node, one team, one treasury key.

What is *actually* achievable, and stronger:

| Question | Honest answer |
|---|---|
| What must be decentralized? | **Nothing.** What must be *reproducible* is the verification. |
| What can stay centralized? | Issuance, the node, the treasury — provided every step is externally recomputable. |
| Who verifies energy? | The node, then the treasury independently, then **anyone**, from published data and open validators. |
| Who controls protocol changes? | The team. Say so. |
| What stops one organisation controlling it? | Today: nothing. What stops it *lying* is that supply reconciliation is public. |

**Recommendation: never use the word decentralized. Use *independently verifiable*.** It is true, it is checkable, and it is the harder claim to earn.

The unavoidable conflict — QWATT verifying assets Quorelia operates — is disclosed in `STRATEGY-TOKENIZATION.md` §4 and must be disclosed publicly too. Mitigations that already exist: open validators, published rejections, supply reconciliation.

---

## 6. Primary user — pick one

Not producers (they want savings, not attestation). Not financial institutions (need scale first). Not developers (there is no protocol to build on yet).

> **Beachhead: the counterparty to a behind-the-meter energy contract — the host being invoiced per kWh by a system they do not own.**

They have the problem *today*, it is contractual rather than regulatory, and it needs no licence: a bill they can verify without trusting the seller. This is the one relationship where verified metering is worth money immediately, and it is the ESCO/PPA structure identified as legally viable in `LEGAL-NETBILLING.md`.

Second wave, once volume exists: corporate buyers needing hourly-matched attribute claims.

### The core transaction

```
Host consumes verified kWh  →  gates pass  →  event anchored + QWATT issued
   →  monthly invoice denominated in attested measurements
   →  host settles  →  QWATT returns to issuer and burns
```

- **Initiates:** the node, automatically, every interval.
- **Verified:** that the energy existed, by physics, twice.
- **Recorded:** hash + cumulative total + payment, atomically.
- **QWATT earns:** the energy margin and the verification service — never a token spread.
- **The host gains:** a bill they can audit without trusting the seller.

---

## 7. Token economics — one job only

QWATT's function is **unit of account for a bilateral contract**. It is the denomination in which attested energy is invoiced and settled between two parties who both hold the proof.

It is deliberately **not**: an investment, a governance token, collateral, a fee token, or anything with a market price. The vintage-pricing invariant exists to make speculation structurally pointless — value is fixed at the attested price of origin, never at redemption-time spot. That invariant is simultaneously the economic defence and the regulatory one.

**1 QWATT = 1 MWh**, fixed permanently by the genesis memo. *(Open conflict: the Build Book says 1 kWh. Must be resolved before `issuer.py` is written — see §11.)*

---

## 8. Feature decisions

The user should understand QWATT in 30 seconds. Today there are ten named surfaces.

| Surface | Decision | Why |
|---|---|---|
| **Verification** | **KEEP — make it the centrepiece** | The only page carrying the actual innovation |
| **Explorer** | **KEEP** | The transparency claim, made checkable |
| **Wallet** | **KEEP** | The only real user-facing surface; non-custodial |
| **Whitepaper** | **KEEP** | Depth for the reader who wants it |
| **Reservas (respaldo)** | **MERGE → Explorer** | Reserves are a view of chain state, not a product |
| **Pulse (red)** | **MERGE → Explorer** | Same data, different framing |
| **Pay** | **MERGE → Wallet** | Two payment surfaces is one too many |
| **Piloto** | **KEEP, reframe** | A deployment, not an application |
| **Grid** | **HIDE** | A simulator presented as a product; 511 KB; invites "is this real?" |
| **Console** | **HIDE, then REMOVE** | Dev tool that still accepts pasted secret keys — must not survive to mainnet |
| **Backup** | **HIDE** | Implementation detail |
| **QWATT-Clean** | **HIDE until it exists** | PLANNED, and costs comprehension now |
| **Tokenomics section** | **DEMOTE** | Supply figures high on the page invite the speculative reading |

**Ten surfaces → four**: Protocol (home) · Verification · Explorer · Wallet. Everything else lives under Docs or inside those four. Nothing is deleted from the repo.

---

## 9. The 60-second Golden Path

One page, one flow, no navigation choices:

```
1  An interval arrives            11.6 Wh · two meters · 14:03 · Santiago
2  Watch the gates run            G0 G1 G2 G3 — live, ~2 s
3  Try to break it                one click: "generate at night" → REJECTED, with the reason
4  Watch it settle                anchor + cumulative + payment, one atomic tx
5  Inspect it yourself            stellar.expert link, opens in a new tab
6  Recompute the hash             the batch JSON, the digest, and the two matching
```

**Step 3 is the whole demo.** Anyone can show a green checkmark; almost nobody hands the judge a lever labelled *break this*.

**Non-negotiable honesty constraint:** demo events are assurance **A0** and must be visibly labelled as such. The code already refuses to attest A0 as generation — the Golden Path must not create an exception. Once `QW-000001` exists, step 5 points at a real transaction and the demo stops being a simulation.

---

## 10. Judge test — 90 seconds, honest answers

| Question | Today | After this audit's changes |
|---|---|---|
| Do I understand what it is? | Partly — ten surfaces | Yes — four, one story |
| Do I understand the problem? | Yes | Yes |
| Why blockchain? | Implied | Yes — atomicity of evidence and money |
| Why Stellar? | Stated as speed | Yes — multi-op atomicity + fee economics |
| Do I understand the innovation? | **No** — reads as tokenization | Yes — falsifiability, published rejections |
| Can I see it works? | **No** — zero real events | Only once `QW-000001` exists |
| Technically credible? | Yes | Yes |
| Economically plausible? | Partly | Yes — verified billing, named beachhead |
| Legally aware? | Yes, unusually | Yes |
| Different from other projects? | Not obviously | Yes |
| Would I remember it tomorrow? | Probably not | *"The one that let me try to break it."* |

Two "no"s today. One is content architecture — fixable this week. One needs the distributor secret.

---

## 11. Scorecard — measured honestly

| Category | Now | Achievable | What moves it |
|---|---:|---:|---|
| Problem significance | 9 | 10 | State the falsifiability problem, not the tokenization one |
| Originality | 6 | 9 | Lead with published rejections; stop leading with a token |
| Technical innovation | 8 | 9 | Gates + assurance ladder + evidence chain are already real |
| Energy-sector relevance | 9 | 10 | Real hardware, real physics, real market data |
| Stellar relevance | 7 | 10 | Argue atomicity and fee economics, not speed |
| Real-world applicability | 5 | 9 | **Needs one real event.** Nothing else moves this |
| Economic utility | 6 | 9 | Name the beachhead and the verified invoice |
| ~~Decentralization credibility~~ → **Independent verifiability** | 7 | 10 | Category replaced deliberately — see §0(c) |
| Differentiation | 5 | 9 | The white-space sentence, everywhere |
| Demonstrability | 6 | 10 | The Golden Path with the *break this* lever |

**Overall now ≈ 6.8. Achievable ≈ 9.5** — and the single biggest lever is not design, code, or copy. It is one real Proof-of-Generation event.

---

## 12. The pitches

### One sentence (17 words)
> QWATT makes energy claims falsifiable: physics-checked at the meter, rejections published, evidence and payment settled atomically on Stellar.

### 30 seconds (68 words)
> Every green-energy claim rests on a measurement nobody re-checks. QWATT checks it at the instrument: two independent meters, four physics gates that fail closed, and a rejection log we publish rather than hide. Verified intervals anchor their evidence and settle payment in a single atomic Stellar transaction — so the record and the money cannot diverge. Don't trust the number. Try to break it.

### 2 minutes (238 words)
> Energy has a proof problem. Certificates are issued annually against self-reported production. A company claiming round-the-clock clean power cannot show you the hour. A building paying per kilowatt-hour must trust a meter its supplier owns. The carbon market already showed what happens to an asset class when verification is weak.
>
> The evidence exists — meters generate it every few seconds — but it dies inside private systems where nobody can audit it.
>
> QWATT verifies it where verification is still possible: at the instrument, in the moment. Two independent meters watch the same energy. Four gates check it against physics — a 150-watt panel cannot exceed its own ceiling, cannot generate with the sun below the horizon, and two meters that disagree by more than five percent are not both telling the truth. The gates fail closed. Every rejection is logged with its reason and published, because a verifier that only shows you its successes hasn't demonstrated anything.
>
> Verified intervals then do something only a ledger allows: the evidence hash, the running total, and the payment commit in one atomic Stellar transaction. The record and the money cannot drift apart, and no one has to trust our timestamp. At Stellar's fees this costs about a dollar per site per year — which is why the design is possible at all.
>
> Every threshold is public and every validator is open. You can recompute our claims, and you can watch us refuse a fabricated one.
>
> Don't trust it. Try to break it.

---

## 13. Roadmap to a genuine 9.5

| # | Change | Effort | Score effect |
|---|---|---|---|
| 1 | **First real PoG event** (`QW-000001`) | 15 min, founder | Applicability 5→9. Nothing else does this |
| 2 | Rewrite the home page around falsifiability; demote tokenomics and supply | 1 day | Originality, differentiation |
| 3 | Golden Path page with the *break this* lever | 1 day | Demonstrability 6→10 |
| 4 | Collapse ten surfaces to four | ½ day | Comprehension in 30 s |
| 5 | English on Verification, Whitepaper, Explorer | 1 day | Every category, for this audience |
| 6 | "Why Stellar" rewritten as atomicity + fee economics | 2 h | Stellar relevance 7→10 |
| 7 | Replace every "decentralized" with "independently verifiable" | 1 h | Credibility |
| 8 | Resolve MWh vs kWh | decision | Blocks `issuer.py` |

Items 2–7 are mine. Item 1 is yours, and it gates the value of all the others.

---

## 14. What this audit refuses to recommend

- Calling QWATT a **protocol** before a second party can run a node.
- Calling it **open** or **decentralized** while one team holds every key.
- Adding **Soroban** to look sophisticated. It earns its place at QWATT-C retire semantics, not before.
- An **energy marketplace**, an on/off ramp, or anything tradeable — legally unavailable (`LEGAL-NETBILLING.md`) and strategically a distraction.
- Building the **financial layer** before one real event exists. A verification protocol with nothing verified is a slide deck.
