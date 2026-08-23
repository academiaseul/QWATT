# QWATT — One-Page Blueprint

> The 25-phase transformation prompt, distilled against what actually exists. One page, kept current.
> Last updated: 2026-08-23 · Live: https://qwatt.org · Repo: github.com/academiaseul/QWATT

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

## Next (priority order)
1. ⚠ **You**: Vercel → Settings → Git → connect `academiaseul/QWATT` (auto-deploys on push)
2. ⚠ **You**: set `home_domain=qwatt.org` on issuer (needs your key; steps in README)
3. → **Event indexer + `/proof/QW-…` pages** — the prompt's "Explorer", the only new route worth building (real data only)
4. → Pilot hardware (El Arrayán kit) — flips PROTOTIPO chips to PILOT
5. → Analytics (pick: Vercel Analytics or Plausible), then Lighthouse run + fixes
6. → Meter signing + Soroban verification contract; then QWATT-C mint/retire contract
7. ⚠ **Legal** review before any mainnet/commercial step

## Deliberately NOT doing (keep it simple)
/technology /developers /research /energy-blockchain etc. — thin pages hurt; whitepaper + GitHub + this repo already serve those audiences. Revisit only when the indexer gives them real content.

## Rules (non-negotiable)
No invented partners, customers, production, transactions, tokenomics, or certifications · DEMO never dressed as LIVE · no secrets client-side · no investment language · accuracy > hype.
