# QWATT-Clean — architecture & go-to-market options

> Internal strategy document (not deployed to the website). Companion to whitepaper v2.0 §16.
> Status of everything in this document: **PLANNED / concept** unless marked otherwise.

## 1. The concept

QWATT already records **quantity**: 1 QWATT = 1 MWh under the protocol. QWATT-Clean adds the
**attribute**: proof that a specific MWh was renewable, when and where it was generated, and how
much grid carbon it displaced.

```
verified energy event
        │
        ├── 1 QWATT      (quantity record — exists today on testnet)
        └── 1 QWATT-C    (clean attribute — PLANNED)
                │  metadata: source, plant_id, hour, grid region,
                │  emission factor (kgCO2e/MWh), methodology version
                ▼
        transfer / sell to a company
                ▼
        RETIRE (burn) against the company's footprint
                ▼
        public retirement certificate (/proof page)
```

**The killer feature is retirement.** Traditional certificates suffer double counting — the same
green MWh claimed twice. An on-chain attribute burned at retirement *cannot* be claimed again, and
any auditor can verify it in seconds. That is the product: **double-counting-proof green claims**.

### Carbon math
`avoided_CO2e = energy_MWh × grid_emission_factor` — the factor is the displaced grid mix
(e.g. Chile's SEN hourly marginal factor). QWATT-C metadata stores the factor **and** methodology
version, so claims are recomputable and challengeable. An emission-factor oracle joins the price
and generation oracles.

### ⚠️ Regulatory boundary (hard rule)
QWATT-C starts as a **voluntary transparency instrument**. It is NOT a REC/GdO, carbon credit, or
subsidy-eligible certificate until a recognized scheme backs it. Path to official value:
1. Voluntary phase — companies buy/retire for transparent ESG evidence (legal today with honest labeling)
2. Homologation — align metadata + verification with I-REC / national scheme requirements
3. Registration — become or partner with an accredited issuer so QWATT-C maps 1:1 to recognized instruments
Never market QWATT-C as subsidy-eligible before step 3. Legal review gates every phase.

## 2. Technical architecture

```
LAYER                         COMPONENT                                    STATUS
─────                         ─────────                                    ──────
Generation                    PV kits / plants                             pilot in design
Measurement                   Modbus meter → QWATT Box gateway             prototype (software)
                              OR industrial: SCADA export module           planned
Verification oracle           reading integrity + plant identity + sig     planned
Emission-factor oracle        grid CO2 factor feed (hourly, per region)    planned
Attribute engine (Soroban)    mints QWATT-C 1:1 with verified events,      planned
                              enforces no-double-mint, handles retirement
Registry & marketplace        list / transfer / retire QWATT-C             planned
Proof pages                   /proof/{event} public certificates           planned (site ready)
```

Key contract invariants (Soroban):
- One QWATT-C per verified renewable event — minting requires the oracle's signed event, no exceptions
- Retirement is terminal: burned attributes emit a public retirement record naming the beneficiary
- Metadata is immutable once minted; corrections happen by retire-and-reissue with an audit trail

### SCADA integration (industrial tier)
For utility-scale plants, a single Modbus meter doesn't cut it — telemetry lives in SCADA. The
integration: a **certified export module** inside the SCADA layer signs generation batches
(plant ID, interval, MWh) and delivers them to the QWATT oracle. **Quorelia SCADA is the natural
first certified integration** — same team, government-grade infrastructure software.
Branding: per founder decision (2026-08-22), the Quorelia SCADA integration IS named publicly —
whitepaper §4 lists it as the first planned certified integration. The entities remain legally and
operationally separate; the public relationship is "integration partner", nothing more.

## 3. Product options — selling panels with QWATT installed

The hardware wedge is the **QWATT Box**: Modbus meter + gateway, preconfigured to mint from day one.

| # | Model | What the customer gets | Revenue | Best for |
|---|-------|------------------------|---------|----------|
| 1 | **Kit Directo** | Panels + microinverter + QWATT Box, customer owns all, earns attributes | Hardware margin (one-time) | Homes, early adopters |
| 2 | **Kit + SaaS** | Hardware near cost + monthly software (Pulse dashboard, verification, ESG reports) | Recurring SaaS | SMEs wanting reporting |
| 3 | **Zero-CAPEX / PPA-lite** | QWATT installs & owns the kit; host pays monthly below utility rate; QWATT keeps & sells the clean attributes | Energy margin + attribute sales | Hosts with roofs, no capital |
| 4 | **Retrofit (QWATT Box only)** | Meter + gateway added to an EXISTING solar install | Low-ticket hardware + SaaS | Biggest market: every roof already built |
| 5 | **Integrator / fleet** | Installers bundle the QWATT Box in their kits; SCADA module for industrial plants (Quorelia SCADA first) | Rev-share on attributes + integration license | Scale channel, B2B |

Recommended sequence: **4 → 2 → 5**. Retrofit is the cheapest proof of demand (no panel logistics),
SaaS builds recurring revenue, the integrator channel scales without owning installation crews.
Option 3 is the strongest long-term model but needs capital and energy-retail compliance.

## 4. Revenue lines (summary)

1. Hardware margin (QWATT Box, kits)
2. SaaS subscriptions (verification + ESG reporting)
3. Marketplace fee on QWATT-C transfers (%)
4. Retirement certificate fees (per claim, B2B)
5. SCADA integration licensing (industrial tier)
6. Float/spread on the QWATT quantity layer (existing model)

## 5. What to build next (in order)

1. Emission-factor oracle spec (source per region; Chile SEN first)
2. QWATT-C metadata schema + Soroban contract draft (mint/transfer/retire, no-double-mint)
3. QWATT Box bill of materials + provisioning flow (extends mining-rig/)
4. /proof/{event} public certificate page template
5. Legal memo: voluntary-claim wording per target jurisdiction, I-REC homologation path
6. One pilot retrofit customer (measure a real roof, retire the first real QWATT-C)

---
*Nothing in this document is a commercial offer. QWATT-C does not exist yet; all claims about
subsidy or certificate eligibility require the regulatory path in §1 before any public use.*
