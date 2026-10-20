# What the founders need to provide, and when

Everything the code cannot do for itself. Day numbers are sprint days. Dates assume **Day 1 =
Monday 19 October 2026**; shift them if Day 1 moves. Status as of 2026-10-08.

## Trabajo previo (antes del Día 1, no financiado)

- [x] License: **MIT** (decided 2026-10-08).
- [x] Public PV dataset: **NREL PVDAQ NIST Ground, September 2017, CC BY 4.0** (`datasets/README.md`).
- [x] Working defaults adopted in `docs/ARCHITECTURE-FREEZE-v2.md`: nominal 0.0000001 QWATT payment,
      dedicated anchoring account, ramp fault on an existing gate.
- [x] Multisig, proposer, verifier, recovery and reconciliation built and proven on throwaway
      testnet accounts.

## Now, before Day 1

| # | What | Who | Why |
|---|---|---|---|
| 1 | **Fix the Day 1 date** and tell the chapter lead | Founders | SOW: "October 1st, 2026 or once received the funds". Every date below hangs on it. |
| 2 | **OK to push** branch `sprint/phase-0` to `github.com/academiaseul/qwatt` | Diego | The SOW evidence is the public repository; CI only runs on GitHub. Nothing is pushed until you say so. |

## By Day 3 (Wed 21 Oct)

| # | What | Who | Why |
|---|---|---|---|
| 3 | **Read and sign `docs/ARCHITECTURE-FREEZE-v2.md`** (both founders), or change any adopted default | Jay + Diego | After sign-off the design is frozen until Day 30. |

## By Day 15 (Mon 2 Nov) — latest Day 19 (Fri 6 Nov)

| # | What | Who | How |
|---|---|---|---|
| 4 | **Name the third signer**: someone outside the team (for example the chapter lead or another Stellar ambassador) | Founders | They create a Stellar keypair **on their own device** (Freighter wallet, or Stellar Laboratory → *Create account keypair*) and send **only the public key** (starts with `G`). They never send the secret. |
| 5 | Third signer agrees to be reachable Days 15–30 and to sign **one** test transaction | Third signer | Routine anchoring never needs them; they are the recovery key. The one test proves their key works. |
| 6 | **Fund the anchoring account with QWATT**: one payment of 1 QWATT from the treasury `GCLS6…OKW` to the new anchoring account, after it adds a QWATT trustline | Jay (treasury key holder) | Each batch pays 0.0000001 QWATT back to the treasury, so 1 QWATT covers 10 million batches. `node anchor/setup-account.js --proposer G… --verifier G… --third G…` creates and configures the account, then prints the **unsigned** funding transaction; Jay signs it in Stellar Laboratory (the tool never sees the treasury secret). Rehearsed end to end: `evidence/asset-rehearsal/`. |

> **Why Day 15 is firm:** the anchoring account requires all three signatures to change its signers.
> If it is created before the third signer exists, it cannot be fixed later; it would have to be
> replaced.

## By Day 18 (Thu 5 Nov)

| # | What | Who | How |
|---|---|---|---|
| 7 | **Evidence-feed host.** Recommended: GitHub Pages serving a `feed` branch of the repository | Repo admin | Settings → Pages → source: branch `feed`. Free and public, with no new account. The proposer host then needs push access to that one branch (a deploy key), stored only on that host. |
| 8 | **Verifier host**: an always-on machine that does **not** run the proposer, operated by Jay | Jay | A small VPS or a spare machine. Needs Node 20, outbound HTTPS and an NTP-synced clock. Its key is generated **on that machine**; send only the public key. |
| 9 | **Proposer host**: the machine that runs the pipeline, simulator and proposer for Days 20–30 | Diego | **Must be always-on.** A laptop or desktop that sleeps or shuts down will break the "seven consecutive days" evidence. Earlier history shows this machine powers off overnight, so use a VPS or a machine that never sleeps. |
| 10 | **Alert recipient**: an email address that gets "no anchor for 2 hours" alerts during the live run | Founders | Someone who will act on it within hours, Days 20–30. |

## By Day 19 (Fri 6 Nov) — freeze

| # | What | Who |
|---|---|---|
| 11 | **Go / no-go for the live run** after the first 2-of-3 anchor on the real account. Target: first anchor by **Fri 6 Nov (Day 19)**, the freeze date. | Founders |

## Days 20–27 (Sat 7 Nov – Sun 15 Nov 00:00) — the seven-day live run

The live run starts **Sat 7 Nov (Day 20)**. The counted seven-day window runs from
**Sun 8 Nov 00:00 America/Santiago (03:00 UTC)** to **Sun 15 Nov 00:00 America/Santiago
(03:00 UTC)**, that is Days 21–27.

| # | What | Who |
|---|---|---|
| 12 | **15-minute daily check**: open the reconciliation page, confirm the verdict is RECONCILED or PENDING, glance at the alert inbox | One founder per day |
| 13 | Do not touch either host's configuration. Fault injections run on their own schedule (`live/schedule.json`) | Both |

## By Day 30 (Tue 17 Nov)

| # | What | Who |
|---|---|---|
| 14 | **Demo video** | Founders |
| 15 | **Review the write-up** and the SOW §6 evidence checklist, then submit | Founders |

## Secrets: where each one lives

| Secret | Lives only on | Never |
|---|---|---|
| Proposer key | proposer host, environment variable `QWATT_PROPOSER_SECRET` | in the repo, a chat or a browser |
| Verifier key | verifier host, `QWATT_VERIFIER_SECRET` | on the proposer host |
| Third-signer key | the third signer's own device | with the team |
| Treasury key | Jay | used for one transfer only (item 6) |
| Feed deploy key | proposer host | anywhere else |
