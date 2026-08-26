# QWATT — Executive Audit

> Internal, 25 August 2026. Written against the repository as it actually is, not as the deck describes it.
> Companion docs: `BLUEPRINT.md` (live plan) · `LEGAL-NETBILLING.md` (what we may legally do) · `FOUNDERS-REPORT-2026-08-24.md` (what exists).

---

## 0. The one finding that outranks the rest

The brief asks for "the financial infrastructure for real-world energy" — energy tokenization, settlement, marketplaces, RWA. **Chilean law does not currently permit QWATT to buy, sell, or settle electricity** (see `LEGAL-NETBILLING.md`): net billing is welded to the client↔distribuidora pair, there is no retail comercializador, and the wholesale market admits only participants with physical assets or real load.

So the target positioning must be **the verification and attestation layer**, not the settlement layer. That is not a downgrade — it is the only claim we can defend, it is the part nobody else sells as a product, and the brief's own §16/§17 demand exactly this discipline. Anything that implies QWATT settles energy today would be the single largest credibility risk in the project.

**Positioning, one sentence:** *QWATT turns metered renewable generation into public, independently verifiable records on Stellar — the proof layer for energy claims, not a market for energy.*

## 1. What QWATT currently is

A static, backend-free site (12 HTML pages) plus a live Stellar testnet asset and a crash-safe mining prototype. Everything renders client-side and reads Horizon and public price APIs directly from the browser. The honesty-label system (TESTNET / PROTOTIPO / PLANIFICADO / DEMO / EN VIVO) is applied consistently and is the project's most distinctive asset.

## 2. What it should become

Layer 2 of the energy stack — *energy intelligence and verification* — sold as a product, with Quorelia holding Layer 1 (physical assets, SCADA, O&M). Financialization (Layer 3+) stays labeled PLANNED until counsel clears it. Priority order: make one real PoG event exist → make the verification defensible against fraud → only then talk markets.

## 3. Current strengths (verified, not claimed)

| Strength | Evidence |
|---|---|
| Honest labeling applied everywhere | Status chips + drawer status dots across 12 pages |
| Real on-chain asset with atomic purchase | Genesis `1859e7e5…`, ledger 4,277,175, 3-op transaction |
| Real market data, not simulated | Live EPEX day-ahead incl. negative prices; CoinGecko FX |
| Verifiable-by-anyone Explorer | Reads Horizon directly, no backend to trust |
| Quality baseline | Lighthouse a11y 100 / best-practices 100 / SEO 100, perf 83 |
| No secrets in deployables | `.gitignore` / `.vercelignore` exclude rig config and keys |
| Architecture-first hardware design | WattNode v1: dual metering, sun witness, two-party minting |

## 4. Critical weaknesses

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **CRITICAL** | Wallet flow was dead — esm.sh serves a `stellar-wallets-kit` build whose `tweetnacl-util` dependency fails to resolve; `connect()` threw before opening the picker | **FIXED 25-ago** — deps vendored via esbuild into `assets/vendor/`, verified on production |
| 2 | **CRITICAL** | Zero real PoG events exist. Every generation claim is currently unexercised; the Explorer's empty state is the only honest thing standing between us and a false claim | OPEN — needs the distributor secret in `mining-rig/config.json` (founder-only) |
| 3 | **HIGH** | Secret keys are still pasted into `grid.html` (issuer + distributor) and `console.html` (restore flow) | OPEN — testnet-only admin tools; must be deleted before mainnet, not merely hidden |
| 4 | **HIGH** | Unit ambiguity: the site says **1 QWATT = 1 MWh** in 14 places; a draft toml proposed **1 kWh**. A public asset definition cannot be ambiguous | OPEN — founder decision required (§9) |
| 5 | **HIGH** | `is_asset_anchored` was proposed as `true` with commodity anchor + redemption instructions — a legal claim we cannot support | RESOLVED — kept `false`, with the reasoning recorded in the file |
| 6 | MEDIUM | `pay.html` invites pasting a secret key to import a wallet — safe on testnet, dangerous muscle memory | OPEN — add wallet-connect path, keep throwaway demo labeled |
| 7 | MEDIUM | No CSP header; wallet page previously loaded third-party runtime code | PARTLY FIXED — self-hosted now; CSP still to add |
| 8 | MEDIUM | `logo.png` is 731 KB and serves as both site logo and SEP-1 token image | OPEN — needs a 512×512 optimized variant |
| 9 | LOW | Perf 83 — remaining cost is Google Fonts + GA, both external | ACCEPTED |

## 5. Business model (unchanged by this audit, and it survives scrutiny)

Revenue today is **hardware + installation + the verification service**, not the token. Config B (3–5 kWp on-grid) carries 25–30% gross margin; Config C (hybrid, El Arrayán) sells resilience rather than payback. The defensible line is the data layer: in a fragmented Chilean market competing on price, nobody sells verification as a product. The token is the proof mechanism, never the revenue.

**Why anyone would hold QWATT:** they should not be encouraged to. Under the vintage-pricing invariant it is an attestation record, not an instrument to hold for gain — and saying otherwise creates CMF exposure under Ley 21.521.

## 6. Target customers

1. **Homeowners / SMEs with roofs** (Lo Barnechea, El Arrayán, Chicureo) — buy kit + monitoring; QWATT is the trust layer on their own generation.
2. **Installers** — bundle the QWATT Box; rev-share on attributes.
3. **Corporates needing hourly-matched green claims** — the QWATT-C buyer, once the attribute layer exists.
4. **The Stellar ecosystem** — a physical, auditable use case; the Instawards/SCF path.

## 7–10. Architecture: current → target

**Current (honest):** browser → Horizon + aWATTar/CoinGecko. No backend, no database, no auth. The miner is a local Node process holding the distributor key.

**Target, and why each layer earns its place:**

```
Meters (M1–M4)  →  WattNode gateway  →  validators (7 checks)  →  signed batch
      →  treasury co-signer (physics re-check, key in Vault)
      →  ONE atomic Stellar tx: evidence hash + cumulative total + QWATT payment
      →  Explorer / Proof / Pulse (anyone re-verifies)
```

**Why Stellar rather than a database:** the claim being made is *"this generation happened and nobody edited the record afterwards."* A database owned by the party making the claim cannot establish that; a public ledger with a memo-anchored evidence hash can, for $0.00001 per operation and ~5s finality. Where a ledger adds nothing — dashboards, time-series, forecasting — we deliberately use ordinary tooling. **Soroban is not needed yet**: native assets, memos, and multi-sig cover today's requirements; contracts become necessary only for QWATT-C mint/retire semantics.

**Financial architecture:** the vintage-pricing invariant is the load-bearing rule — QWATT is valued at the attested price of its origin event, never at redemption-time spot. Without it, mint-at-noon/redeem-at-night drains the treasury. Time-shifting value belongs to batteries, not to the token.

## 11. Security

Fixed today: third-party runtime code removed from the signing surface; non-custodial signing available with no key ever touching the page.
Still open: pasted-secret admin flows (#3), no CSP (#7), and — the discipline that matters most — **issuer and distributor keys must never enter a browser**, on any network, for any reason.

## 12–13. SEO / UX

SEO is essentially done (canonicals, OG with branded image, JSON-LD, sitemap, robots, 404, security headers). UX is coherent: one persistent drawer, day/night across every surface, status dots, reduced-motion respected. The remaining UX gap was the wallet being an orphan page in a foreign design language — closed today.

## 14. Differentiation

Energy-tokenization projects generally start from the token and reverse into a story about electrons. QWATT starts from the meter: dual instruments, a physics check, a sun witness, tamper flags, and two-party minting so a compromised node is a broken sensor rather than a money printer. The moat is not the token; it is **the evidence chain plus the willingness to label what isn't real yet.**

## 15. MVP definition

> One real rooftop, measured by two independent instruments, producing verified events that a stranger can re-check on stellar.expert — with every unverified claim labeled as such.

Not a marketplace. Not a settlement rail. Not a stablecoin integration.

## 16. Roadmap

- **P0** — first real PoG event; delete pasted-secret paths before mainnet; keep the unit definition unambiguous.
- **P1** — WattNode v0 bench (QW-PRO-001) → validators → node signing; wallet-connect path on `pay.html`; CSP; optimized token image.
- **P2** — QWATT-C mint/retire (Soroban); indexer behind the Explorer; SCADA integration via Quorelia; hourly-matching reports for corporates.
- **P3** — anything resembling a market, an on/off ramp, or a stablecoin integration. Not before counsel.

## 17–18. Structure

The site structure already matches the brief's recommendation (problem → model → why Stellar → real energy → platform → transparency → roadmap). **No restructure is warranted**; thin new pages would hurt. The dashboard's rule stands: real data and simulated data never share a frame without labels.

## 19. What should be removed

Pasted-secret inputs (before mainnet, unconditionally) · any language implying the token represents electricity, a security, or a return · the `wallet-demo` framing now that it is a product page · `[COMPLETAR]` placeholders in anything published (done).

## 20. What to build next

1. The distributor secret → **`QW-000001`**. Everything else is theatre until a real photon produces a real record.
2. The bench (stages 0–1), which doubles as week 1 of the Instaward sprint.
3. Node signing + the 7 validators — the part that makes verification *defensible* rather than merely *present*.

---

### Open decision for the founders

**Is 1 QWATT one MWh or one kWh?** The site, whitepaper, deck, teaser and proposal all say **MWh** (14 places). A draft SEP-1 file proposed **kWh**, which would suit per-installation granularity (a 4.4 kWp roof produces ~18 kWh/day — meaningful units) but contradicts every published artifact. Changing it means reissuing the asset and rewriting every document; keeping MWh means the miner's 0.001 QWATT/kWh rate stays as is. **Recommendation: keep MWh** — it is published, consistent, and the granularity problem is solved by decimals, not by redefinition.
