# Quorelia / QWATT — project log

> Everything done on this project so far, in order. Testnet demo for the
> **Stellar × AI Studio Build Challenge**. Last updated: 2026-08-22.
>
> **Entity note (2026-08-22):** QWATT was split from Quorelia into a fully
> independent project — no shared branding, links, or operation. Quorelia serves
> government clients; QWATT is a standalone renewable-energy blockchain demo with
> its own earth-tone identity. Mentions of Quorelia below are historical.

## What QWATT is

QWATT is a Stellar asset pegged narratively to energy: **1 QWATT = 1 MWh**. On Stellar,
an asset is a code + issuer account; "minting" is simply the issuer paying tokens out.
The whole 42.7M supply was minted in one atomic genesis transaction to the distributor
(treasury), which sells and pays out QWATT at the oracle price. There is no smart
contract yet — purchases are atomic 3-operation transactions (trustline → XLM payment →
QWATT payment) with the electricity price attested in each memo.

## Timeline

### 2026-08-20 — WattCoin born (hackathon)
- Original site built at the Stellar Builder Night / AI Studio Build Challenge.
- First asset **WATT** issued on Stellar testnet (42.7M supply, issuer `GBZH3PHY…`).
  That deployment is now orphaned — superseded by QWATT below.

### 2026-08-21 — real market data
- Replaced the simulated price oracle on all live pages with **real EPEX day-ahead spot
  prices** (Germany) via the aWATTar API, converted EUR→USD; **live XLM/USD** via
  CoinGecko. Simulated demand curve kept as automatic offline fallback.
- Landing page chart now plots the actual last 24 h of electricity prices (hourly).
- Note discovered along the way: European midday solar routinely drives the spot price
  to **zero or negative** — the pages and the miner handle 0/negative prices correctly.

### 2026-08-22 — Quorelia rebrand + QWATT + mining rig
- **Rebrand**: WattCoin → **Quorelia** (company), WATT → **QWATT** (token) across all
  pages, memos, metadata. App names: Quorelia Grid, QWATT Pay, Quorelia Proof
  (respaldo), Quorelia Pulse (red).
- **QWATT deployed on testnet** (fresh genesis, alphanum12 asset):
  - Issuer: `GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46`
  - Distributor/treasury: `GCLS6EE5UNXFNK44SQGD4F3TYYFE7QCJX2QEXQ5E4TOQSAQBZUXTSOKW`
  - Supply: 42,700,000 QWATT · genesis tx `1859e7e5…` · ledger 4,277,175
  - Memo: `QWATT genesis 1QWATT=1MWh`
  - [Asset on stellar.expert](https://stellar.expert/explorer/testnet/asset/QWATT-GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46)
- **Key safety**: genesis/restore keys now auto-save to browser localStorage and prefill
  the console/grid connect forms. Secret keys are held by the founder only — never in
  the repo, never shared.
- **Mining rig built** (`mining-rig/`): proof-of-generation bridge in Node.
  - Reads solar generation from a **Modbus TCP** energy meter (built-in raw client,
    no drivers) or from a built-in accelerated **solar simulator**.
  - Integrates kWh and pays **0.001 QWATT per kWh** (1 QWATT = 1 MWh) from the
    distributor treasury to the rig's auto-created wallet.
  - Every payout carries an on-chain proof-of-generation memo:
    `PoG:<kWh>kWh@<USD>/MWh` with the live EPEX price.
  - Tested end-to-end in simulate + dry-run mode; the rig wallet (`GCFW7R…`) is live on
    testnet with a QWATT trustline. Live payouts start once the distributor secret is
    pasted into `mining-rig/config.json` (gitignored).
  - Hardware plan for the first battery-less panel kit (panel → grid-tie microinverter →
    Modbus kWh meter → RS-485 gateway → miner) documented in `mining-rig/README.md`.
- **Deployment prep for qwatt.org via Vercel**: `vercel.json` (CORS for stellar.toml),
  `.vercelignore` (keeps mining-rig secrets off the deploy), SEP-1
  `.well-known/stellar.toml` pointing at `https://qwatt.org`, README deploy guide.

## Current on-chain state (testnet)

| Item | Value |
|---|---|
| Asset | `QWATT` (alphanum12) |
| Issuer | `GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46` |
| Distributor | `GCLS6EE5UNXFNK44SQGD4F3TYYFE7QCJX2QEXQ5E4TOQSAQBZUXTSOKW` |
| Supply | 42,700,000 QWATT (all in treasury) |
| Trustlines | 2 (treasury + mining rig wallet) |
| Genesis | tx `1859e7e5…`, ledger 4,277,175, 2026-08-22 |

## Site map

| Page | Role |
|---|---|
| `index.html` | Landing: live dashboard (real EPEX prices), tokenomics, roadmap, ES/EN |
| `console.html` | Genesis/restore console + atomic QWATT purchases |
| `grid.html` | Quorelia Grid: generators, marketplace, solar panels paid in QWATT |
| `respaldo.html` | Quorelia Proof: live proof-of-reserves from Horizon |
| `pay.html` | QWATT Pay: testnet XLM payments |
| `red.html` | Quorelia Pulse: live network view |
| `piloto.html` / `whitepaper.html` / `backup.html` | Solar pilot, whitepaper, key backup tool |
| `mining-rig/` | Proof-of-generation miner (not deployed to the website) |

## Business model (agreed direction)

QWATT is pegged, so revenue comes from **flow and float**, not token appreciation:
1. **Float yield** — reserves backing circulating QWATT earn interest (stablecoin model).
2. **Exchange spread** — small +/− margin around the oracle price at the treasury window.
3. **Marketplace fees** — commission on Quorelia Grid energy sales and bill payments.
Demand thesis: energy-price hedging and saving in kWh units (data centers, fleets,
factories, households pre-buying cheap solar hours).

## Still to do

- [ ] Founder saves the issuer/distributor secret keys from the genesis console
- [ ] Buy `qwatt.org` and deploy via Vercel (`npx vercel --prod`, then attach domain)
- [ ] Set `home_domain = qwatt.org` on the issuer (Stellar Lab, Set Options)
- [ ] Paste distributor secret into `mining-rig/config.json` → first live PoG payouts
- [ ] Order the panel kit hardware (list in `mining-rig/README.md`)
- [ ] Later: Soroban contract for automated mint/burn peg + signed meter readings;
      mainnet + regulatory review before any real money

---
*Testnet demonstration only. Prices are market data or simulations; nothing here is
investment advice or an offer.*
