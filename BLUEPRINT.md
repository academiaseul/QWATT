# QWATT — One-Page Blueprint

> The 25-phase transformation prompt, distilled against what actually exists. One page, kept current.
> Last updated: 2026-08-24 · Live: https://qwatt.org · Repo: github.com/academiaseul/QWATT

## Identity
**QWATT — The Clean Token.** An energy-verification protocol: measurable renewable production → verified events → public records on Stellar. 1 QWATT = 1 MWh under the protocol. Never marketed as a speculative cryptocurrency. Separate entity from Quorelia (integration partner only).

## The one page (index.html is the product)
HERO (Energía, verificada onchain) → PROTOCOL (diagram + 6 stages w/ status chips) → LIVE MARKET (real EPEX, 24H–5Y) → ONCHAIN (verify-it-yourself + Why Stellar + live trustlines) → QWATT-CLEAN (philosophy) → APPS (8 tools) → TOKENOMICS (labeled PLANNED) → ROADMAP → SECURITY → unified footer. The app pages are the proof, not marketing sprawl.

## Done ✓
- **Positioning & design**: infrastructure not crypto; terracotta/espresso system; ES/EN; motion (type/reveal) with reduced-motion support
- **Honesty system**: TESTNET / PROTOTIPO / PLANIFICADO / DEMO / EN VIVO chips site-wide — the moat
- **On-chain (testnet)**: real QWATT asset, genesis, atomic buys, PoG mining rig (crash-safe, idempotent PoG#id memos)
- **Oracles**: live EPEX day-ahead (aWATTar) + XLM/FX (CoinGecko), simulated fallback
- **SEO**: titles/descriptions/canonicals/OG/Twitter, JSON-LD (Org "alternateName: The Clean Token" + WebSite), sitemap, robots, custom 404, security headers
- **Docs**: whitepaper v2.0 (16 sections), terms/risks/glossary, pilot engineering page
- **Engineering**: git + GitHub, Vercel prod, deployment.json + one-command testnet-reset recovery, zero secrets in deployables

## Done since (2026-08-24)
- Day/night theme site-wide (bars, drawer, footers) · editorial drawer with status dots · Q-ring logo everywhere + favicon · contact form → Formspree (verified) · GA4 on all pages · privacy section in Términos · og-image.png + large cards · stellar.toml ORG_LOGO/image · Lighthouse: perf 79 / a11y 100 / bp 100 / seo 100 · launch kit ready (LinkedIn ES/EN, X thread ≤280/post, promo canvas)

## Next (priority order)
1. ⚠ **You — launch**: post LinkedIn ES (attach 1080×1080 promo PNG); Diego posts EN later the same day; X thread day 1
2. ⚠ **You — first real PoG event**: paste distributorSecret into mining-rig/config.json, start miner → QW-000001 appears in Explorer
3. ⚠ **You — Vercel dashboard (5 min)**: Settings → Domains → make `qwatt.org` primary (kills 560ms redirect, ~+9 perf); Settings → Git → connect `academiaseul/QWATT`
4. ⚠ **You — issuer**: set `home_domain=qwatt.org` (unlocks toml/logo in wallets + stellar.expert)
5. → SCF (Stellar Community Fund) application draft in docs/
6. → Pilot hardware (El Arrayán kit) — flips PROTOTIPO chips to PILOT
7. → Meter signing + Soroban verification contract; then QWATT-C mint/retire contract
8. ⚠ **Legal** review before any mainnet/commercial step

## Deliberately NOT doing (keep it simple)
/technology /developers /research /energy-blockchain etc. — thin pages hurt; whitepaper + GitHub + this repo already serve those audiences. Revisit only when the indexer gives them real content.

## Rules (non-negotiable)
No invented partners, customers, production, transactions, tokenomics, or certifications · DEMO never dressed as LIVE · no secrets client-side · no investment language · accuracy > hype.
