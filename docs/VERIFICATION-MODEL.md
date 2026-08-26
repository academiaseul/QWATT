# QWATT — Verification Model v1

> Spec, 2026-08-25. The formal model behind every QWATT attestation: what is claimed,
> who could lie, what stops them, and how a stranger re-checks the claim.
> This is the reference for implementing `oracle.js`; the executable form of §5 lives in
> `mining-rig/validators.js`.
> Companions: `docs/wattnode-architecture.svg` (hardware) · `LEGAL-NETBILLING.md` (what may be claimed) · `CLEAN-TOKEN-ARCHITECTURE.md` (attribute layer).

---

## 1. The claim

A QWATT attestation asserts exactly one thing:

> **Between `t₀` and `t₁`, an installation registered as `site` produced `E` watt-hours,
> as measured by two independent instruments whose readings are mutually consistent and
> consistent with the physics of that installation at that time and place — and this record
> has not been altered since `t₁`.**

Everything else people may want to infer — that the energy was renewable, that it was
delivered to a particular buyer, that it entitles anyone to anything — is a **contractual or
legal layer on top**, never a property of the attestation itself. §8 states the limits
explicitly, and they belong in any customer-facing description.

**Unit:** 1 QWATT = 1 MWh, fixed permanently by the genesis transaction memo
(`QWATT genesis 1QWATT=1MWh`, ledger 4,277,175). Attestations are recorded in Wh and
converted at payout.

## 2. Trust model — who can lie

| # | Adversary | Capability | Countered by |
|---|---|---|---|
| A1 | Remote attacker | Forges API calls / replays batches | Node signature, monotonic sequence, window non-overlap (V6) |
| A2 | Node operator (software) | Edits `miner.js`, inflates readings | Two-party minting (§6): treasury re-checks physics independently |
| A3 | Node operator (physical) | Feeds the meter from a bench supply or the grid | Sun witness (V4) + capacity cap (V1) + night gate (V2) |
| A4 | Site owner | Points a lamp at the witness cell | Ratio bounds — a lamp bright enough to fake 4.4 kWp is implausible and costs more than the energy; raises cost, does not make it impossible (§8) |
| A5 | Time attacker | Backdates the clock to "generate" at night | Hardware RTC cross-check (V6), monotonic sequence |
| A6 | Enclosure attacker | Opens the box, rewires the shunt | Tamper reed (V7): minting halts until signed re-arm |
| A7 | **The issuer (us)** | Mints QWATT with no generation behind it | **Only partially counterable.** Supply is public and every unit must trace to an anchored batch; a stranger can total the attested Wh and compare against issued QWATT (§7). This is the check that matters most for credibility, and it is why the treasury's minting rule must stay mechanical. |

The design principle throughout: **a compromised node should be a broken sensor, not a money
printer.** No single key, and no single instrument, can create supply on its own.

## 3. Measurement layer

| Ref | Instrument | Measures | Independence |
|---|---|---|---|
| **M1** | DC meter per MPPT (PZEM-017 + shunt on the bench) | DC Wh from the array | Separate silicon, separate bus from M2 |
| **M2** | Inverter Modbus register | AC Wh delivered | Vendor's own metering |
| **M3** | Shelly Pro 3EM + CTs | Grid import/export | Separate power path; bounds self-consumption |
| **M4** | Sun witness: 5 W reference cell + INA226 across a fixed 10 Ω load | Irradiance proxy (W/m² analogue) | Not in the power path at all — cannot be spoofed by manipulating the array |
| **M5** | Integrity flags: RTC, tamper reed, watchdog | State of the node itself | — |

M1 and M2 measure the *same* energy at different points in the chain, so their ratio is
bounded by inverter efficiency — that bound is the divergence check. M4 measures the *cause*
of that energy independently, which is what makes a fabricated M1/M2 pair detectable.

**Sampling:** every 10 s → batched every 5 min → attested hourly or at ≥1 kWh, whichever
comes first.

## 4. Evidence record

Each batch produces one canonical JSON record. Field order is fixed; the hash is
`SHA-256` over the canonical serialization (sorted keys, no whitespace, UTF-8).

```json
{
  "v": 1,
  "site": "sha256(lat|lon|installer)",
  "node": "GNODE…",
  "seq": 42,
  "window": { "from": "2026-08-25T14:00:00Z", "to": "2026-08-25T15:00:00Z" },
  "energy_wh": { "m1_dc": 1250.4, "m2_ac": 1211.9, "m3_grid_wh": -880.2 },
  "witness": { "mean_w_per_m2": 641.7, "samples": 360, "dark_samples": 0 },
  "nameplate_w": 4400,
  "integrity": { "rtc_delta_s": 2, "tamper": false, "gaps": 0 },
  "checks": { "v1": "pass", "v2": "pass", "v3": "pass", "v4": "pass", "v5": "pass", "v6": "pass", "v7": "pass" },
  "sample_root": "b7f1…",
  "prev_hash": "9c02…",
  "hash": "4ae8…"
}
```

Two properties matter:

- **`prev_hash` chains the batches.** Removing or editing a past batch breaks every hash after
  it, so the record is append-only in practice, not just by convention.
- **`sample_root` is a Merkle root over the raw 10-second samples.** The batch stays small
  enough to anchor, while any individual sample can still be proven to belong to it later.

**Anchoring — one atomic Stellar transaction, three operations:**

1. `manageData` `meter:<t₁>` = `hash` — pins the evidence
2. `manageData` `panel:total_kwh` = running total — public cumulative
3. `payment` of `E/1000` QWATT from treasury to the node wallet
   with memo `PoG#<seq>:<kWh>kWh@<price>/MWh` (28-byte limit enforced)

All three commit or none do. The memo carries the attested spot price, which is what makes the
vintage-pricing invariant enforceable later: the price is fixed at origin, on-chain, forever.

## 5. The validator suite

Every check runs on the node **before** signing, and independently on the treasury
co-signer **before** counter-signing. Both must pass. Any failure ⇒ the batch is recorded as
`rejected` with its reason and **no QWATT is minted** — rejected batches are kept and published,
because a verification system that hides its rejections is not a verification system.

| ID | Check | Rule | Default |
|---|---|---|---|
| **V1** | Nameplate capacity | `E_batch ≤ P_nameplate × Δt × k` | `k = 1.15` (cold clear-sky / cloud-edge overirradiance) |
| **V2** | Night gate | If solar elevation `< -0.833°`, require `E ≈ 0` | tolerance `≤ 0.5%` of nameplate |
| **V3** | Meter divergence | `E_ac / E_dc ∈ [η_min, 1.0]` | `η_min = 0.88` (inverter efficiency floor) |
| **V4** | Witness correlation | Expected `P ≈ (G/1000) × P_nameplate × derate`; ratio within bounds, **and** `E > 0` requires `dark_samples < 100%` | ratio `∈ [0.5, 1.6]`, derate `0.80` |
| **V5** | Ramp / plausibility | Per-sample `|ΔP| ≤ P_nameplate` per 10 s, **and** reject implausibly smooth series (real irradiance is noisy) | variance floor `σ/μ ≥ 0.005` over ≥30 samples |
| **V6** | Clock & replay | `|t_system − t_RTC| ≤ 60 s`; `seq` strictly increasing; window must not overlap any attested window | — |
| **V7** | Tamper & integrity | `tamper = false`, watchdog healthy, sample gaps below threshold | `gaps ≤ 2` per batch |

Thresholds are **per-site configuration**, not universal constants — a Santiago rooftop and a
Patagonian one have different plausible envelopes. They are stored in the panel registry with
the site record, so the treasury validates against the same numbers the node used, and any
change to them is itself a registry event.

**V2 note:** solar elevation is computed from site coordinates and UTC time (NOAA solar
position algorithm). The node holds real coordinates locally; only their hash is published, so
the site's exact location stays private while remaining verifiable by anyone who knows it.

## 6. Two-party minting

```
node: builds batch → runs V1–V7 → signs hash with PANEL key → outbox
      ↓ (HTTPS, outbound only — the node never accepts inbound connections)
treasury co-signer: verifies node signature → re-runs V1–V7 against the SAME registry
                    thresholds → applies fleet-level caps → adds second signature → submits
```

The treasury's re-check is deliberately **not** a rubber stamp: it recomputes the physics from
the batch's own numbers. If the node's software were replaced entirely, its batches would still
have to survive an independent physics check to mint anything.

The distributor key lives in a vault on the co-signer and **never** exists on a node. This is
also why the browser wallet path deliberately excludes minting: user-side actions (trustlines,
payments, retirement) belong in a wallet; issuance belongs to the co-signer.

## 7. How a stranger verifies — the whole point

1. Open the payment transaction on stellar.expert. Read the memo: `PoG#42:1.250kWh@78.91/MWh`.
2. Read the `manageData` entry `meter:<t₁>` from the same transaction — that's the evidence hash.
3. Fetch the batch record for `seq=42` from the node's published evidence feed.
4. Recompute `SHA-256` over the canonical JSON. It must equal the anchored hash.
5. Re-run V1–V7 yourself against the batch's own numbers — every threshold is public.
6. Verify `prev_hash` links to `seq=41`, and that `seq` has no gaps.
7. **Supply reconciliation:** total the attested Wh across all batches and compare against
   QWATT issued since genesis. They must agree, or the issuer is minting unbacked supply.

Step 7 is the one that audits *us*, and it is the reason the Explorer must keep showing an
honest empty state until step 1 is possible.

## 8. What an attestation does NOT prove

Stated plainly, because the credibility of everything above depends on not overselling it:

- **Not that the energy was renewable.** It proves the generation profile matched solar physics
  at that place and time. That is strong evidence, not a fuel certificate.
- **Not that the meter is attached to that array.** Binding instrument to installation is a
  *physical* commissioning act (sealed enclosure, photographs, installer signature), not a
  cryptographic one. Assurance level A4 (§9) is where that gets independent sign-off.
- **Not delivery, ownership, or entitlement.** Who owns the energy and who may claim it are
  contract questions.
- **Not a REC, a carbon credit, or a subsidy title.** QWATT-C is a voluntary transparency
  instrument unless and until formally homologated.
- **Not unforgeable by a determined operator with physical access.** The model raises the cost
  of a convincing forgery above the value of the energy forged, and makes cheap forgeries
  detectable. That is the honest security claim; anyone promising more is selling something.

## 9. Assurance levels

Not every attestation deserves equal trust. Each event carries its level, and the site must
display it — this is the honesty-label system applied to the physics.

| Level | Setup | Checks active | What it means |
|---|---|---|---|
| **A0 · SIMULATED** | Solar simulator, no hardware | none | Demonstration only. **Never** anchored as generation. |
| **A1 · MEASURED** | One instrument (bench stage 1) | V1, V2, V5, V6 | Real photons, single witness. "Measured, not corroborated." |
| **A2 · CORROBORATED** | Dual meter + sun witness (bench stage 2 / WattNode v0) | V1–V7 | Two independent instruments agreeing with physics. |
| **A3 · CO-SIGNED** | A2 + treasury co-signature, vaulted key (WattNode v1) | V1–V7 ×2 | No single party can mint. **Target for the pilot.** |
| **A4 · AUDITED** | A3 + calibrated, sealed meters, third-party commissioning | V1–V7 ×2 + certificates | The level a corporate ESG buyer can rely on. |

Today the protocol sits at **A0**. The bench reaches **A1** in stage 1 and **A2** in stage 2;
the El Arrayán pilot targets **A3**. No claim above the current level appears anywhere public.

## 10. Why this is the product

Verification is the part with no substitute. Panels are a commodity, installation is a
commodity, monitoring dashboards are given away free. What nobody in the Chilean market sells
is *a kWh number a second party can check without trusting the first*.

That capability is what makes three separate revenue lines possible:

- **PPA / ESCO billing** — the host is invoiced on measurements they can independently verify,
  which removes the structural trust problem in every energy-service contract.
- **Corporate attribute buyers** — hourly-matched, physics-checked generation records are what
  24/7 carbon-free accounting actually requires, and what flat annual certificates cannot give.
- **Fleet operators and installers** — the WattNode as a product, with verification as a
  subscription.

The token is not the product. The **evidence chain** is the product; QWATT is how it settles.

---

## Implementation status

| Piece | State |
|---|---|
| Batch/sample structure, hash chain | **Spec'd here** — not yet in `miner.js` |
| V1–V7 validators | **`mining-rig/validators.js`** — implemented with tests |
| Node signing (PANEL key) | Planned — Instaward sprint P2 |
| Treasury co-signer service | Planned — Instaward sprint P2/P3 |
| Evidence feed (published batches) | Planned — needed for §7 step 3 |
| Assurance level on-chain + in the Explorer | Planned |

Next implementation step: wire `validators.js` into `miner.js` so that the bench's first real
event is A1-labelled and rejects everything it should.
