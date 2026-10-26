# What the founders need to provide, and when

Everything the code cannot do for itself. Day numbers are sprint days. Dates assume **Day 1 =
Monday 19 October 2026**; shift them if Day 1 moves. Status as of 2026-10-20.

## Prior work (before Day 1, not funded by the Instaward)

- [x] License: **MIT** (decided 2026-10-08).
- [x] Public PV dataset: **NREL PVDAQ NIST Ground, September 2017, CC BY 4.0** (`datasets/README.md`).
- [x] Working defaults adopted in `docs/ARCHITECTURE-FREEZE-v2.md`: nominal 0.0000001 QWATT payment,
      dedicated anchoring account, ramp fault on an existing gate.
- [x] Multisig, proposer, verifier, recovery and reconciliation built and proven on throwaway
      testnet accounts.

## Before the first push

| # | What | Who | Why |
|---|---|---|---|
| 1 | Day 1 fixed: **Monday 19 Oct 2026** (done) | Founders | Every date below hangs on it. |
| 2 | **OK to push** Diego's prior work (merged as `35a1e77`) to `github.com/academiaseul/QWATT` | Diego | The SOW evidence is the public repository; nothing is pushed until he says so. |

## By Day 3 (Wed 21 Oct)

| # | What | Who | Why |
|---|---|---|---|
| 3 | **Read and sign `docs/ARCHITECTURE-FREEZE-v2.md`** (both founders), or change any adopted default | Jay + Diego | After sign-off the design is frozen until Day 30. |

## By Tue 27 Oct (Day 9) — the two evidence repositories (freeze v3, V3-7)

Needed before the first anchor on the real account (V3-4). Step by step: `docs/RUNBOOK.md`,
one-time setup, step 5.

| # | What | Who | How |
|---|---|---|---|
| 7a | **Two public repositories**, `academiaseul/qwatt-evidence` (written only by the proposer host) and `academiaseul/qwatt-verifier-log` (written only by the verifier host), each a public history | Jay (owner of `academiaseul`) | Create both (Public, a README, the licence per decision D2; proposal: MIT). Edit README.md and LICENSE before the first publisher run; after it, only each host's publisher commits. On each, two branch rulesets: "public history" (no deletion, no force-push, linear history, no bypass) and "only the host key writes" (deploy keys bypass, everyone else restricted). |

## By Wed 28 Oct (Day 10) — their deploy keys

| # | What | Who | How |
|---|---|---|---|
| 7b | **One deploy key per repository** | each host's operator; Jay adds it | Each host generates its own deploy key (ed25519) and sends only the `.pub`; Jay adds it with write access to that one repository. The private key file never leaves its host. Then the smoke test and `node ops/evidence-audit.js` on a fresh clone. |

## By Day 15 (Mon 2 Nov) — latest Day 19 (Fri 6 Nov)

| # | What | Who | How |
|---|---|---|---|
| 4 | **Name the third signer**: someone outside the team (for example the chapter lead or another Stellar ambassador) | Founders | They create a Stellar keypair **on their own device** (Freighter wallet, or Stellar Laboratory → *Create account keypair*) and send **only the public key** (starts with `G`). They never send the secret. |
| 5 | Third signer agrees to be reachable Days 15–30 and to sign **one** test transaction | Third signer | Routine anchoring never needs them; they are the recovery key. The one test proves their key works. |
| 6 | **Fund the anchoring account with QWATT**: one payment of 1 QWATT from the treasury `GCLS6…OKW` to the new anchoring account, after it adds a QWATT trustline | Jay (treasury key holder) | Each batch pays 0.0000001 QWATT back to the treasury, so 1 QWATT covers 10 million batches. `node anchor/setup-account.js --proposer G… --verifier G… --third G…` creates and configures the account, then prints the **unsigned** funding transaction; Jay signs it in Stellar Laboratory (the tool never sees the treasury secret). Rehearsed end to end: `evidence/asset-rehearsal/`. |

> **Why Day 15 is firm:** at 2/2/3 the anchoring account requires all three signatures to change its
> signers, so it should be created with the third signer already in it. If the account has to be
> created before the third signer exists, it is not lost: it starts at the fallback, thresholds
> 2/2/2 with only the two team signers, and when the third signer is named the two team keys add
> them and raise the thresholds to 2/2/3 in one setOptions signed by both. The two-signer setup mode
> of `setup-account.js` comes in week 2; until then the fallback is done by hand following the
> runbook (`docs/RUNBOOK.md`, one-time setup, step 3).
>
> **Thresholds 2/2/3** (decided 21 Oct 2026; low 2, medium 2, high 3): no single key, the third
> signer's included, can send any transaction for the anchoring account; anchoring needs 2 of the
> 3 keys; changing signers or thresholds needs all 3. `setup-account.js --verify` checks it.

## By Day 18 (Thu 5 Nov)

| # | What | Who | How |
|---|---|---|---|
| 8 | **Verifier host**: an always-on machine that does **not** run the proposer, operated by Jay | Jay | A small VPS or a spare machine. Needs Node 20, outbound HTTPS and an NTP-synced clock. Its key is generated **on that machine**; send only the public key. |
| 9 | **Proposer host**: the machine that runs the pipeline, simulator and proposer for Days 20–30 | Diego | **Must be always-on.** A laptop or desktop that sleeps or shuts down will break the "seven consecutive days" evidence. Use a VPS or a machine that never sleeps. |
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
| 12 | **15-minute daily check**: open the reconciliation page (the page is redeployed in week 2; until then run `node anchor/reconcile-cli.js`), confirm the verdict is RECONCILED or PENDING, glance at the alert inbox | One founder per day |
| 13 | Do not touch either host's configuration. Fault injections run on their own schedule (`live/schedule.js`, published per run as `faults.json`) | Both |

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
| `qwatt-evidence` deploy key | proposer host, `/home/qwatt/.ssh/qwatt-evidence` (a file, never an env value) | anywhere else, the verifier host included |
| `qwatt-verifier-log` deploy key | verifier host, `/home/qwatt/.ssh/qwatt-verifier-log` (a file, never an env value) | anywhere else, the proposer host included |
