# QWATT live run — operator runbook

For the people running Days 15–30. Commands assume the repository at `/opt/qwatt` on Linux hosts,
Node 20, and the systemd units in `ops/deploy/`. What the founders must provide first is in
`docs/FOUNDER-CHECKLIST.md`.

## The three machines

| Host | Runs | Holds | Must never |
|---|---|---|---|
| **Proposer host** (always on; a VPS, not a laptop) | `qwatt-live` · `qwatt-proposer` · `qwatt-publish` | proposer secret · feed deploy key | hold the verifier secret |
| **Verifier host** (different provider, operated by the other founder) | `qwatt-verifier` · `qwatt-watch` | verifier secret | be given any path or address of the proposer |
| **Third signer** (a person, off-team) | nothing | their key, on their own device | send anyone their secret |

The watchdog runs on the verifier host so it survives a proposer outage. A watchdog that dies with
what it watches cannot report that it died.

## One-time setup (Days 15–19)

1. **Both hosts:** install Node 20, `git clone` the repository into `/opt/qwatt`, then
   `cd /opt/qwatt/anchor && npm ci`. Create the user `qwatt` and run `timedatectl set-ntp true`.
2. **Verifier host:** generate the verifier key on the host itself and keep only its public key
   for the setup step:
   `node -e "const k=require('/opt/qwatt/anchor/node_modules/@stellar/stellar-sdk').Keypair.random();console.log(k.publicKey());console.error(k.secret())" 2>/etc/qwatt/verifier.secret`
   Then move the secret into `/etc/qwatt/verifier.env` as `QWATT_VERIFIER_SECRET=…` (chmod 600)
   and delete `verifier.secret`. Do the same on the proposer host for the proposer key.
3. **Create the anchoring account** (from any machine; it needs only public keys):
   `node anchor/setup-account.js --proposer G… --verifier G… --third G… --out anchor.json`.
   Copy `anchor.json` to `/etc/qwatt/anchor.json` on **both** hosts. It holds public values only.
4. **Jay signs the funding transaction** the tool printed (Stellar Laboratory → testnet → sign
   with the treasury key → submit). Then run
   `node anchor/setup-account.js --verify G… --proposer G… --verifier G… --third G…`;
   every check must pass.
5. **Feed host:** in the repository settings, GitHub Pages serves the `feed` branch at the root.
   Add the proposer host's deploy key with write access. Note the Pages URL (it is case-sensitive:
   check whether it is `…github.io/QWATT/` or `…/qwatt/`). That URL is `QWATT_FEED_URL`.
6. **Rehearse on the real account:** `node anchor/rehearse.js` produces tests A–D and the
   third-signer liveness check on a throwaway account. For the real account, the same sequence runs
   as the first proposals. Keep the evidence file for the write-up (`--tests`).
7. Install the units: `cp ops/deploy/*.service /etc/systemd/system/`, fill in `/etc/qwatt/*.env`
   from `ops/deploy/env.example`, then `systemctl daemon-reload`.

## Starting the run (Day 21, latest Day 23)

Start in this order, checking each before the next:

| Step | Host | Command | Check |
|---|---|---|---|
| 1 | verifier | `systemctl enable --now qwatt-verifier qwatt-watch` | `curl localhost:8090/status.json` shows `last_tick` within 1 min |
| 2 | proposer | `systemctl enable --now qwatt-live` | `feed/faults.json` exists; `journalctl -u qwatt-live` shows "replaying …" |
| 3 | proposer | `systemctl enable --now qwatt-publish` | `QWATT_FEED_URL/index.json` loads in a browser (Pages may take a few minutes) |
| 4 | proposer | `systemctl enable --now qwatt-proposer` | within an hour, the first batch shows **anchored** on the reconciliation page |

Reconciliation page:
`https://qwatt.org/reconcile.html?feed=<QWATT_FEED_URL>&account=<anchoring account>`.

## Daily check (15 minutes)

1. Reconciliation page: the verdict is **RECONCILED**, or **PENDING** with only the last one or two
   batches waiting.
2. `node live/audit.js /var/lib/qwatt/feed` on the proposer host: coverage has no gaps, and every
   fault that is due shows *refused as expected*.
3. Glance at the alert channel. No message is expected on a good day; the watchdog sends one only
   when something starts, repeats every 6 h, or clears.

## When an alert arrives

| Alert | Likely cause | Do |
|---|---|---|
| `VERIFIER_SILENT` | verifier host down or process crashed | `systemctl status qwatt-verifier`; restart it. Batches wait as *published, not anchored* and catch up in order on their own. Nothing to repair. |
| `BACKLOG` | verifier is up but not signing | Check the verifier's `/refusals.jsonl`. A refusal means it found a real mismatch: **do not** work around it; see `NEW_REFUSAL`. With no refusal, check `journalctl -u qwatt-proposer` for `blocked`: the proposer runs the verifier's checks first and does not propose what the verifier would refuse. `blocked` with `verifier.walk_too_long`: see *A long run of rejected batches* below. |
| `NEW_REFUSAL` | the verifier refused a proposal | Read the reason. `verifier.not_published` is usually feed lag and resolves itself. `verifier.hash_mismatch`, `verifier.head_mismatch` or `batch.*` means the published evidence and the proposal disagree: stop `qwatt-proposer`, investigate, and record it in the write-up. `verifier.walk_too_long` is not a disagreement: see *A long run of rejected batches* below. |
| `FEED_STALE` | the live run stopped | `systemctl status qwatt-live`. Restart it. The minutes it was down stay a visible gap; they are never backfilled. Note the gap for the write-up. |
| `NO_ANCHOR` | proposer, publisher or Horizon problem | Check `qwatt-proposer` and `qwatt-publish` logs, then `https://status.stellar.org`. |
| `BROKEN` | the chain and the feed disagree | Treat as an incident. Do not edit any published file. Capture the reconciliation output and investigate. |
| `SOURCE_DOWN` | Horizon or the feed host unreachable | Usually transient. If Horizon is down, nothing can anchor; it resumes by itself when Horizon returns. |

## A long run of rejected batches (`verifier.walk_too_long`)

**When you see it.** `journalctl -u qwatt-proposer` shows `blocked` with `verifier.walk_too_long`,
or a `NEW_REFUSAL` carries that code; `BACKLOG` and `NO_ANCHOR` follow. More than 168 batches
(one week of hourly batches) published as rejected lie between the on-chain head and the next
accepted batch. Before it signs, the verifier walks back from that batch to the on-chain head, and
the proposer runs the same walk over its own feed before it proposes. Both stop at 168 batches, so
the check never finishes and nothing anchors again until the bound is raised. Nothing is known to
be wrong: this code never means a forged chain (that is `verifier.head_mismatch`).

**Why it happens: a node_id change.** Every batch is judged against the last accepted batch,
including its `node_id`. If `qwatt-live` is restarted with another `node_id` (a re-flashed
device, an edited config), every later batch is published as rejected with `batch.site_mismatch`,
not only the first, until the `node_id` is put back. A week of that is longer than the walk.

**Do:**

1. Fix the cause first. Read the reasons of the rejected batches in
   `/var/lib/qwatt/feed/ledger/batches.jsonl`. For `batch.site_mismatch`, put back the
   `node_id` the chain started with and restart `qwatt-live`. Do not raise the bound while
   batches are still being rejected.
2. Work out the bound: the seq of the blocked batch (in the proposer's log) minus the seq of the
   last anchored batch (reconciliation page). Use that number, or a little more, as `N`.
3. Add `--max-walk N` to the `ExecStart` line of **both** `qwatt-proposer` (proposer host) and
   `qwatt-verifier` (verifier host; agree it with the founder who runs that host), then
   `systemctl daemon-reload` and restart both. Raising only one side is not enough: the proposer
   still blocks, or the verifier still refuses.
4. Wait for the batch to show **anchored** on the reconciliation page. Then remove the flag from
   both units and restart them; from then on the walk is short again.
5. Record the gap, the cause and the bound used in the write-up.

Raising the bound is safe: it only changes how far back the services read. Every batch on the way
is still downloaded once, rehashed, linked to the next one and re-added, and a chain that does not
lead to the on-chain head is still refused. The cost is one download per batch per tick on the
verifier host while the flag is set.

## Testnet reset during the run

The feed is off-chain and complete, so a reset loses no evidence.

1. Stop `qwatt-proposer` and `qwatt-verifier`; leave `qwatt-live` and `qwatt-publish` running.
2. Re-create the anchoring account (setup steps 3–4) and update `/etc/qwatt/anchor.json` on both
   hosts.
3. Start both services again. With an empty chain they anchor every published batch from seq 0, in
   order, automatically.
4. Record the reset and the re-anchoring in the write-up; the old transaction links die with the
   old testnet.

## Closing the run (Day 30)

1. Let the run end on its own: `qwatt-live` stops after 7 × 24 h and closes the last batch.
2. Leave proposer and verifier running until the reconciliation page says **RECONCILED**.
3. Run the final audit: `node live/audit.js /var/lib/qwatt/feed --json > evidence/live-audit.json`.
4. Generate the write-up:
   `node ops/writeup.js --feed <QWATT_FEED_URL> --account G… --feed-dir /var/lib/qwatt/feed --tests evidence/rehearsal/<file>.json --out WRITEUP.md`.
5. Stop the services. The feed branch and the chain remain as the permanent public record.
