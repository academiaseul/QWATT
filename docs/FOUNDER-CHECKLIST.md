# What the founders need to provide, and when

Everything the code cannot do for itself. Day numbers are sprint days. Dates assume **Day 1 =
Monday 19 October 2026**; shift them if Day 1 moves. Status as of 2026-10-23 (week-2 plan).

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

## Week 2: by Tue 27 Oct (Day 9) — hosts and keys

The week-2 plan (freeze v3, V3-4 and V3-8): the hosts, stellar-cli and the keys come first, because
each key is generated on the machine that uses it. Every holder uses **stellar-cli 28.1.0**
(decision D-2); the exact command forms are confirmed once on that binary first (founder step 0,
Mon 26 Oct). Setup steps: `docs/RUNBOOK.md`, one-time setup. The two evidence repositories
(freeze v3, V3-7, items 7a and 7b) are needed before the first anchor on the real account (V3-4);
step by step: `docs/RUNBOOK.md`, one-time setup, step 7.

| # | What | Who | How |
|---|---|---|---|
| 4 | **Third signer's public key** (request Mon 26 Oct; key by Tue 27, latest Wed 28, the OD-2 target) | Founders, third signer | Third signer: confirmed in week 1. They generate their key with stellar-cli on their own computer (`docs/THIRD-SIGNER.md`) and send only the public key (starts with `G`); both founders confirm its first and last four characters by voice. They never send the secret or the recovery words. Key received: _date to record_. |
| 7a | **Two public repositories**, `academiaseul/qwatt-evidence` (written only by the proposer host) and `academiaseul/qwatt-verifier-log` (written only by the verifier host), each a public history | Jay (owner of `academiaseul`) | Create both (Public, a README, the licence per decision D2; proposal: MIT). Edit README.md and LICENSE before the first publisher run; after it, only each host's publisher commits. On each, two branch rulesets: "public history" (no deletion, no force-push, linear history, no bypass) and "only the host key writes" (deploy keys bypass, everyone else restricted). |
| 8 | **Verifier host**: an always-on machine that does **not** run the proposer, operated by Jay | Jay | A small VPS or a spare machine. Needs Node 20, outbound HTTPS, an NTP-synced clock and stellar-cli 28.1.0 on the PATH of user `qwatt`. Its key is generated **on that machine**, over SSH, as the stellar-cli identity `qwatt-verifier`; send only the public key. |
| 9 | **Proposer host**: the machine that runs the pipeline, simulator and proposer for Days 20–30 | Diego | **Must be always-on.** A laptop or desktop that sleeps or shuts down will break the "seven consecutive days" evidence. Use a VPS or a machine that never sleeps. Its key is generated on that machine, over SSH, as the stellar-cli identity `qwatt-proposer`. |

## Week 2: by Wed 28 Oct (Day 10) — backup drill and the real account

| # | What | Who | How |
|---|---|---|---|
| 5 | Third signer is reachable through Day 30, signs the **backup drill** once (a throwaway testnet transaction, V3-8c) and, in week 3, the stand-in drill (V3-13) | Third signer | Routine anchoring never needs them; they are the recovery key. The drill proves that their paper backup restores the key they sent. |
| 6 | **Fund the anchoring account with QWATT**: one payment of 1 QWATT from the treasury `GCLS6…OKW` to the new anchoring account, after it adds a QWATT trustline | Jay (treasury key holder) | Each batch pays 0.0000001 QWATT back to the treasury, so 1 QWATT covers 10 million batches. `node anchor/setup-account.js build` and `submit` set up the account from the three public keys (`docs/RUNBOOK.md`, setup step 4); `node anchor/setup-account.js fund-xdr --account G…` prints the **unsigned** funding transaction, and Jay checks, signs and submits it with stellar-cli on his own computer: `node anchor/setup-account.js fund-submit funding.xdr --account G… --sign-with-key qwatt-treasury --evidence evidence/account/G…`, which refuses any envelope that is not exactly that payment before stellar-cli signs (decision D-1). The tool never sees the treasury secret. Rehearsed end to end: `evidence/asset-rehearsal/`. |
| 7b | **One deploy key per repository** | each host's operator; Jay adds it | Each host generates its own deploy key (ed25519) and sends only the `.pub`; Jay adds it with write access to that one repository. The private key file never leaves its host. Then the smoke test and `node ops/evidence-audit.js` on a fresh clone. |

> **Why all three keys come first:** the account is created with all three keys at once. At 2/2/3 a
> signer can only be added or replaced with all three signatures, so the third signer's key must be
> in it from the start; there is no two-signer mode. If the third signer's key is late, the account
> waits and both founders decide what to do; the drill, the account and tests A–D move day for day.
>
> **Thresholds 2/2/3** (decided 21 Oct 2026; low 2, medium 2, high 3): no single key, the third
> signer's included, can send any transaction for the anchoring account; anchoring needs 2 of the
> 3 keys; changing signers or thresholds needs all 3. `setup-account.js --verify` checks it.

## By Day 19 (Fri 6 Nov) — freeze

| # | What | Who |
|---|---|---|
| 10 | **Alert recipient**: an email address that gets "no anchor for 2 hours" alerts during the live run; someone who will act on it within hours, Days 20–30 | Founders |
| 11 | **Go / no-go for the live run.** The first 2-of-3 anchor on the week-2 account is planned for Thu 29 Oct (tests A–D, V3-4); the run uses its own account, created at the freeze with the same three public keys (OD-5). Decide by **Fri 6 Nov (Day 19)**, the freeze date. | Founders |

## Days 20–27 (Sat 7 Nov – Sun 15 Nov 00:00) — the seven-day live run

The live run starts **Sat 7 Nov (Day 20)**. The counted seven-day window runs from
**Sun 8 Nov 00:00 America/Santiago (03:00 UTC)** to **Sun 15 Nov 00:00 America/Santiago
(03:00 UTC)**, that is Days 21–27.

| # | What | Who |
|---|---|---|
| 12 | **15-minute daily check**: open `https://qwatt.org/reconcile.html?feed=…&account=…` (or the page alone, once `assets/status.json` names the run feed and the account). The verdict must be RECONCILED or PENDING (in Spanish CONCILIADO or PENDIENTE), the account panel ("Anchoring account, as read from Horizon") must be all ✓, and "Signed by" must read proposer + verifier. A stand-in (proposer + third signer) should appear only during a verifier outage; note it for the write-up. Glance at the alert inbox. Without a current browser, `node anchor/reconcile-cli.js` gives the same result | One founder per day |
| 13 | Do not touch either host's configuration. Fault injections run on their own schedule (`live/schedule.js`, published per run as `faults.json`) | Both |

## By Day 30 (Tue 17 Nov)

| # | What | Who |
|---|---|---|
| 14 | **Demo video** | Founders |
| 15 | **Review the write-up** and the SOW §6 evidence checklist, then submit | Founders |

## Secrets: where each one lives

| Secret | Lives only on | Never |
|---|---|---|
| Proposer key | stellar-cli identity `qwatt-proposer` of user `qwatt` on the proposer host, plus one paper backup held by its operator | in the repo, a chat, a browser or an env file |
| Verifier key | stellar-cli identity `qwatt-verifier` of user `qwatt` on the verifier host, plus one paper backup held by its operator | on the proposer host, in a browser or an env file |
| Third-signer key | their own computer (a stellar-cli identity), plus their own paper backup | with the team |
| Treasury key | Jay, signing with stellar-cli on his own computer (decision D-1) | used for one transfer only (item 6); never in a browser |
| `qwatt-evidence` deploy key | proposer host, `/home/qwatt/.ssh/qwatt-evidence` (a file, never an env value) | anywhere else, the verifier host included |
| `qwatt-verifier-log` deploy key | verifier host, `/home/qwatt/.ssh/qwatt-verifier-log` (a file, never an env value) | anywhere else, the proposer host included |

Prior-work tools outside V3-8: `mining-rig/miner.js` (its distributor key from its own local
config) and `set-home-domain.js` (issuer and distributor keys from the environment) predate Day 1
and take no part in the live run or the anchoring account. Whether they move to stellar-cli as
well is the founders' decision.
