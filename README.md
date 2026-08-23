# ⚡ QWATT

Demo from the **Stellar × AI Studio Build Challenge**: a digital asset that tracks the spot
price of one megawatt-hour of electricity (**1 QWATT = 1 MWh**), issued for real on the
**Stellar testnet** on August 22, 2026.

- Issuer: `GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46`
- Distributor: `GCLS6EE5UNXFNK44SQGD4F3TYYFE7QCJX2QEXQ5E4TOQSAQBZUXTSOKW`
- Supply: 42,700,000 QWATT — [view on stellar.expert](https://stellar.expert/explorer/testnet/asset/QWATT-GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46)

## Pages

| Page | What it does |
|---|---|
| `index.html` | Landing page: live QWATT dashboard, tokenomics, roadmap (ES/EN) |
| `console.html` | Onchain console: deploy (genesis) or restore QWATT, buy with atomic 3-op transactions |
| `grid.html` | QWATT Grid: energy ecosystem — generators, marketplace, solar panels paid in QWATT |
| `respaldo.html` | Live proof-of-backing: reads reserves from Horizon every 15 s |
| `pay.html` | QWATT Pay: generic testnet XLM payments demo |
| `piloto.html`, `red.html`, `whitepaper.html`, `backup.html` | Pilot narrative, network view, whitepaper, backup |

Everything is static HTML — no build step, no backend. The Stellar SDK is inlined.

## Live data sources

The price oracle uses **real market data**, fetched client-side, with an automatic fallback
to a simulated demand curve when offline:

- **Electricity spot price**: EPEX day-ahead (Germany), EUR/MWh, via the free
  [aWATTar API](https://www.awattar.de/services/api) — no key required.
- **XLM/USD and EUR→USD**: [CoinGecko simple price API](https://docs.coingecko.com/) — no key required.

Both refresh every 5 minutes.

## Run locally

```bash
npx -y serve -l 3000 .
```

Then open http://localhost:3000. (Opening `index.html` directly from disk also works;
the live-data fetches still run.)

## Deploy — Vercel + qwatt.org

The site is pure static files (`vercel.json` adds the CORS header SEP-1 requires for
`stellar.toml`; `.vercelignore` keeps `mining-rig/` and its secrets off the deployment).

```bash
npx -y vercel login
```

```bash
npx -y vercel --prod
```

Accept the defaults (no build command, output directory `.`). The first deploy gives you a
`*.vercel.app` URL. Then attach the domain:

1. Buy `qwatt.org` at any registrar (Namecheap, Porkbun, Cloudflare, …).
2. Vercel dashboard → the project → **Settings → Domains** → add `qwatt.org`
   (and `www.qwatt.org`). Vercel shows the DNS records to set at the registrar —
   an `A` record to `76.76.21.21` or nameserver delegation; either works.
3. Wait for DNS + the automatic HTTPS certificate, then verify
   `https://qwatt.org/.well-known/stellar.toml` loads.

(Alternatives: GitHub Pages or Netlify also work — the `_headers` file covers Netlify's
CORS config.)

## After deploying: link the asset to qwatt.org (SEP-1)

1. `.well-known/stellar.toml` already declares `https://qwatt.org` as the org URL.
2. Set `home_domain` on the **issuer** account so explorers/wallets discover the file:
   open [Stellar Lab (testnet) → Build Transaction](https://lab.stellar.org/transaction/build?$=network$id=testnet),
   source account = issuer, add a **Set Options** operation with
   *Home Domain* = `qwatt.org` (no `https://`), then sign with the **issuer secret key**
   and submit. After that, stellar.expert shows QWATT with your name/description instead
   of "unknown asset".

## ⚠️ Operational notes

- **Never commit or publish the issuer/distributor secret keys.** The site only needs
  the public addresses; secrets are pasted into `console.html`/`grid.html` at runtime only.
- **Stellar testnet resets periodically** (roughly quarterly). A reset wipes the asset.
  To recover: run a new genesis in `console.html`, save the new secret keys, then update
  the issuer/distributor addresses in `index.html` (Onchain section), `respaldo.html`
  (`ISSUER`/`DIST` constants), and `.well-known/stellar.toml`.
- This is a demonstration project on testnet only. Prices shown are market data or
  simulations; nothing here is investment advice or an offer.
