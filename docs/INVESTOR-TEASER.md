# QWATT — The Clean Token
### Investor teaser · Stellar ecosystem · August 2026

> One line: **QWATT turns measured renewable energy into verifiable on-chain records — and sells the
> solar installations that generate them.**

## The problem

Green energy has a proof gap. Claims are cheap, certificates arrive months late with coarse
granularity, and double counting is a structural flaw of the current system. Meanwhile the evidence —
meter data — is generated every second and dies inside private systems. Electricity bills in Chile
rose over 50% since 2024 with regulated increases scheduled through 2035, and prolonged blackouts
turned home batteries from luxury into insurance. Demand for solar is surging; trust in green claims
is not.

## What we built (working today, honestly labeled)

- **qwatt.org** — a bilingual protocol site with a live energy dashboard reading the *real* European
  power market (EPEX day-ahead, 24H to 5-year views), an interactive protocol architecture, and a
  status-label system (TESTNET / PROTOTYPE / PLANNED / DEMO / LIVE) on every claim. Accuracy is the moat.
- **A real asset on Stellar testnet** — QWATT, 42.7M issued at genesis, atomic 3-operation purchases,
  every transaction public.
- **Proof-of-Generation mining (prototype)** — a bridge that reads a Modbus energy meter, integrates
  kWh, and pays 0.001 QWATT per verified kWh with the spot price attested in each transaction memo
  (`PoG#42:12.40kWh@173.44/MWh`). Crash-safe, idempotent.
- **QWATT Explorer** — a public on-chain event browser (qwatt.org/proof) with per-event evidence
  chains at shareable URLs. No backend: it reads Horizon directly, so every number is verifiable by
  construction.
- **WattNode v1 spec** — hardened field hardware: dual metering, a physical "sun witness" reference
  cell, secure element, and **two-party minting** (the node signs evidence; the treasury co-signs only
  after its own physics check). A compromised node is a broken sensor, not a money printer.
- **Sound token economics by design** — the vintage-pricing invariant: a QWATT is valued at the price
  attested at its origin event, never at current spot. Solar mints cheap at noon; without this rule,
  night-time redemption would drain any treasury. Time-shifting belongs to batteries, not token rules.

## The business model — a flywheel, not a token sale

**Layer 1 (revenue now): solar installation in Chile.** Three named products for Región
Metropolitana: Solar Base (3–5 kWp on-grid, 25–30% gross margin), Solar + Respaldo (hybrid +
battery — sold as blackout insurance, the margin engine), Solar Negocio (SME 10–30 kWp, 3.5–4 year
payback). Year-1 plan: 30 installations, ~CLP 41M gross margin. Every install can include the
verification kit — the only offer in the market with on-chain proof.

**Layer 2 (the differentiator): the protocol.** Monitoring SaaS, verified-generation records, and —
once homologated — **QWATT-C**, the clean attribute token: one per verified renewable MWh, retired
(burned) on claim so the same green MWh can never be counted twice. Target buyers: companies that
need provable ESG evidence, not declarations.

**The flywheel:** installations fund the protocol → the protocol differentiates the installations →
every verified roof grows the base that makes clean attributes real.

## Why Stellar

~5-second settlement, ~$0.00001 fees, native assets without contract risk, and on-chain memos as
attestation fields — the exact primitives an energy-event ledger needs. Path: SCF application in
preparation (Tranche 0: legal review · Tranche 2: 10–20 prosumers with real meters). First physical
pilot (hybrid 4.4 kWp + storage, Lo Barnechea, Chile) is specified and costed.

## The full stack — from generation to sale

QWATT is not just a token layer; the same team covers the entire chain:

```
GENERATION                MONITORING & OPERATIONS         SALE & SETTLEMENT
QWATT solar kits          Quorelia SCADA                  Net billing (CLP)
on-grid 3–5 kWp           real-time telemetry             + on-chain QWATT records
hybrid + storage    →     reporting & alarms        →     + future QWATT-C
WattNode verification     operations dashboard            attribute marketplace
```

Generation hardware we install, an industrial-grade SCADA monitoring and reporting system we
already build (Quorelia SCADA — critical-infrastructure software), and a settlement layer on
Stellar. Install it, operate it, verify it, monetize it — one architecture, end to end.
*(QWATT↔Quorelia SCADA integration: in design.)*

## Team

**Jay & Diego — co-founders.** Shared roles across the whole company: both engineer, both design,
both sell, both build the protocol. Built from a Stellar × AI Studio Build Challenge project into
the platform above in under two weeks, in public.

## Status & honesty

Everything runs on Stellar **testnet**. Nothing here is an offer of securities or investment advice;
QWATT is not for sale. QWATT-C is planned architecture — a voluntary transparency instrument, not a
REC or carbon credit unless expressly homologated. Legal review precedes any mainnet or commercial
step. What we're looking for: SCF support, pilot partners with roofs, and conversations with
Stellar-aligned investors who value *verified* over *promised*.

**See it yourself — don't trust it, verify it: [qwatt.org](https://qwatt.org) · [Explorer](https://qwatt.org/proof.html) · [Whitepaper](https://qwatt.org/whitepaper.html) · [GitHub](https://github.com/academiaseul/QWATT)**
