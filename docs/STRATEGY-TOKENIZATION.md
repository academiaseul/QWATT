# QWATT — Renewable-energy tokenization: assessment and sequencing

> Internal, 2026-08-26. Assessment of the four-layer / SPV strategy.
> Not legal advice — §6 lists what counsel must answer before anything here is built.
> Companions: `LEGAL-NETBILLING.md` · `VERIFICATION-MODEL.md` · `EXECUTIVE-AUDIT-2026-08-25.md`

---

## 1. Verdict

**The direction is right, and it is a better company than the token was.** Project finance for
renewable assets is a real, large, boring-in-a-good-way industry. The four-layer split is sound,
and the instinct to isolate investors in a per-project SPV — rather than letting them hold
something that ambiguously represents the whole group — is the single most sophisticated call in
the proposal. That is how project finance is structured everywhere, and it protects both sides.

Two things must be said just as plainly:

1. **Layer 3 changes QWATT's regulatory category.** Everything built so far was carefully *not*
   a security. Structuring investment products around project cash flows and issuing digital
   representations of them makes QWATT a securities issuer and, depending on structure, a
   regulated financial-services provider. That is a licensed business, not a pivot.
2. **The verification layer is what makes this defensible — not the tokenization.** See §3.
   Getting that backwards is how the plan fails.

## 2. What already maps

| Layer in the proposal | What exists today |
|---|---|
| **1 · Energy** | El Arrayán pilot in design; WattNode v1 architecture; the QW-PRO-001 bench |
| **2 · Data** | Verification model + V1–V7 validators (implemented, tested); Quorelia SCADA as the O&M / intelligence source |
| **3 · Financial** | **Nothing. This is the regulated gap.** |
| **4 · Blockchain** | Live testnet asset, atomic settlement, public Explorer, non-custodial wallet |

Layers 1, 2 and 4 are work already done. Layer 3 is the entire remaining lift, and it costs
money, time and counsel rather than engineering.

## 3. The strategic point that matters most

**Tokenization is a commodity. Verified production is not.**

Creating an SPV, issuing tokens against it and running a cap table on-chain is undifferentiated —
several platforms already do exactly this, in Chile and elsewhere. Competing there means
competing on fees against firms with more capital and existing licences.

What almost nobody has is the answer to the question every energy investor actually asks once a
plant is built: **"is this asset producing what the model promised, and how would I know?"**
P50/P90 estimates are claims. Monthly operator reports are claims. QWATT can offer tamper-evident,
physics-checked, independently re-verifiable production data straight from the meter — the same
evidence chain already specified and coded.

So the framing is not *"QWATT tokenizes energy projects"* but:

> **QWATT makes renewable-energy cash flows auditable at the meter — which is what makes them
> financeable.**

Tokenization then becomes the distribution mechanism for that credibility, rather than the
product itself.

## 4. The independence problem — name it before an investor does

If QWATT structures the investment, Quorelia operates the asset, and QWATT verifies the
production, then "independently verified" is false: one group is marking its own homework. This
is the credibility hole in the whole vision, and a sophisticated investor finds it in the first
meeting.

Mitigations, in increasing order of strength — the first three already exist:

1. **Open validators.** `validators.js` is public and dependency-free; anyone can re-run every
   check against published batches.
2. **Published rejections.** Rejected batches are kept and shown. A verifier that publishes only
   passes is doing marketing.
3. **Supply reconciliation.** Attested Wh must total to issued units (`VERIFICATION-MODEL.md` §7,
   step 7) — the check that audits us.
4. **Assurance level A4** — calibrated, sealed instruments and third-party commissioning sign-off.
5. **Structural separation** — verification governed by a party with no share in the project's
   upside, once revenue justifies it.

Investor-facing material must never claim more independence than the current assurance level
supports.

## 5. Corporate structure

The proposed shape is right:

```
QUORELIA SpA          energy technology · O&M · SCADA intelligence
      │
QWATT (entity TBD)    verification protocol · data · (later) financial platform
      │
Project SPV I, II…    one legal entity per asset — investors sit HERE, nowhere else
      │
Solar / BESS assets
```

Two refinements:

- **Per-project SPVs are cheap and standard** in Chile (SpA). Form one per asset; never pool
  assets into a single vehicle, because that reintroduces exactly the ambiguity the structure
  exists to remove.
- **What gets tokenized** is either SPV equity or a revenue-backed instrument — both are
  securities. There is no structure in which "the token isn't really a security" while it carries
  cash-flow rights, and attempting one is the fastest route to an enforcement problem.

## 6. The regulated route — what counsel must confirm

Under **Ley 21.521** and **NCG 502** (CMF, in force since February 2024), the relevant services
are entered in the *Registro de Prestadores de Servicios Financieros*, with per-service
authorisation, client-disclosure duties, corporate-governance and risk-management obligations,
and **capital and guarantee requirements**. Three viable paths:

| Path | What it means | Cost / speed |
|---|---|---|
| **A · Oferta privada** | First project placed privately with a limited number of qualified investors. No public advertising — so it **cannot be marketed on qwatt.org**. | Lowest. Realistic first deal. |
| **B · Partner with a licensed platform** | Someone else holds the crowdfunding / intermediation authorisation; QWATT supplies verification and the project. | Low. Revenue without a licence. |
| **C · Become a licensed platform** | QWATT registers as a *plataforma de financiamiento colectivo* and/or intermediary. | Highest — capital, governance, a compliance function. |

**Recommended order: B → A → C.** Path B earns revenue and credibility with no licence at all;
A does the first real deal under counsel; C only once deal flow justifies the compliance overhead.

### Questions for the lawyer

1. Exact perimeter of *oferta privada* for an SPV-backed instrument — investor count,
   qualification, and what constitutes prohibited public advertising (does the website naming the
   project break it?).
2. Whether tokenized SPV equity versus a revenue-backed note changes the registration path.
3. NCG 502 capital and guarantee figures for the crowdfunding-platform category.
4. Whether selling *verification data* to third-party platforms is itself a regulated service
   (assessment: no — it is a data service — but confirm before invoicing).
5. Tax treatment of SPV distributions to token holders, including withholding for foreign
   investors.
6. Whether QWATT verifying assets that Quorelia operates creates a conflict requiring disclosure
   or structural separation.

## 7. Sequencing

- **Now (unchanged).** First real PoG event; the bench; validators wired into the miner. None of
  this is regulated, and all of it is the foundation everything else sells.
- **Next — revenue with no licence.** Sell verification as a service: to installers, to funds
  holding operating assets, to platforms already tokenizing projects. This is Path B, needs no CMF
  authorisation, and it tests whether the market actually pays for verified production before any
  compliance money is spent.
- **Then — one real project.** El Arrayán or similar inside an SPV, financed via *oferta privada*
  with counsel, with verified production reported to those investors from day one. That is the
  reference deal everything later is sold on.
- **Later — the platform.** Only if deal flow justifies the licence.

## 8. What not to do

- Announce "tokenized energy investments" publicly before counsel signs off. A public offer of
  unregistered securities is the one mistake that ends a company rather than merely costing it
  time.
- Let the QWATT unit blur between *attestation of energy produced* (what it is today) and *a
  claim on project cash flows* (a security). If both exist they must be **different instruments
  with different names**.
- Market returns, yields or projections anywhere on qwatt.org while it remains a public,
  unregistered site.
