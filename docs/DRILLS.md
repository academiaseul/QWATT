# Stand-in drill and kill tests (V3-13)

Both were **not done** before the Instaward #1 run (WRITEUP.md, "Findings recorded by the operators").
This is the plan to do them on the real hosts, on a **throwaway rehearsal account on Stellar testnet**,
never on an account a public run depends on.

- **Who:** Diego (proposer host), Jay (verifier host), the third signer (their own computer).
- **When:** one session of about 2 hours, week of 7–11 Dec 2026 (before the 16 Dec testnet reset),
  or after the reset with a new rehearsal account.
- **Where:** both hosts on the code of `main` at the commit named in the session. A rehearsal feed
  (`QWATT_RUN_NAME=drill-<date>`), a fresh 2/2/3 rehearsal account (RUNBOOK, setup steps 4–6), all three
  public keys in `anchor.json` (`signers.proposer`, `signers.verifier`, `signers.third`).
- **Evidence:** everything under `evidence/drills/<date>/`: the terminal output of each step, the
  reconciliation output at the end, and a filled-in copy of the checklist below. Public values only.

Rules: confirm by voice before stopping or starting any service, and say which run it serves
(Wed 11 Nov rule). Nothing here touches the run account `GDSE…4MDC` or its feed.

## 0. Baseline (10 min)

1. Both hosts: services running on the drill feed; `node ops/preflight.js` with no FAIL.
2. Let 2 batches anchor normally. **Expect:** reconcile `RECONCILED`, "Signed by" proposer + verifier.

## 1. Stand-in drill (20 min)

1. Jay: `systemctl stop qwatt-verifier qwatt-watch` on the verifier host (voice confirmation first).
2. Wait until the proposer publishes `pending/<next batch>.xdr` in the drill feed.
3. Third signer, on their own computer, with the `anchor.json` and feed URL the founders send:
   `node anchor/verifier.js --stand-in --feed <drill feed URL> --config anchor.json --sign-with-key qwatt-third --state ./stand-in-state`
4. **Expect:** it exits 0, the batch is anchored, and reconcile shows it as **STAND-IN** (proposer + third),
   still `RECONCILED`. The stand-in's decision line says role `stand-in`.
5. Jay: `systemctl start qwatt-verifier qwatt-watch`. **Expect:** the verifier resumes at the next batch,
   signs nothing twice, and the watchdog clears `VERIFIER_SILENT`.

## 2. Kill tests (60 min)

Each test: do it, wait, then run the reconciliation. **Every test passes only if** the result below
holds AND reconcile still says `RECONCILED`, with no batch anchored twice and no gap in the chain.

| # | Do | On | Expect |
|---|---|---|---|
| K1 | `systemctl kill -s SIGKILL qwatt-proposer` | proposer host | back within `RestartSec`; the next batch anchors once |
| K2 | `systemctl kill -s SIGKILL qwatt-verifier` | verifier host | back within `RestartSec`; it resumes from chain + feed, no double sign |
| K3 | `systemctl kill -s SIGKILL qwatt-live` and `qwatt-publish` | proposer host | both back; no sample published before its time; feed continues |
| K4 | `systemctl stop qwatt-verifier` and leave it down past one proposal's 60-minute window | verifier host | the expired proposal is replaced, not refused; anchors once after start |
| K5 | reboot the verifier host (or `wsl --shutdown` and reopen) | verifier host | services come back by themselves; no double sign |
| K6 | cut the network of the proposer host for 10 minutes | proposer host | nothing signed or written while offline; resumes in order |
| K7 | edit a published batch file in the drill feed after the proposer signed | drill feed | verifier refuses `verifier.hash_mismatch`, signs nothing; refusal logged once |
| K8 | stop both services for more than 90 minutes | both | the check from outside both hosts sends its alert, and it is accepted by the receiver |

`SIGKILL` is the crash case. A plain `systemctl stop`/`kill` (SIGTERM) is a clean stop and is **not**
restarted (V3-13a); K4 and K8 use that on purpose.

## 3. Close (10 min)

1. Final reconciliation of the drill account: save the output.
2. Fill in the checklist, commit `evidence/drills/<date>/` in a PR, and update WRITEUP's
   "Not done" line in the next changelog: done, with the date and the result of each step.

## Checklist

| Step | Result (PASS / FAIL / NOT DONE) | Time | Notes |
|---|---|---|---|
| 0 Baseline | | | |
| 1 Stand-in | | | |
| K1 | | | |
| K2 | | | |
| K3 | | | |
| K4 | | | |
| K5 | | | |
| K6 | | | |
| K7 | | | |
| K8 | | | |
