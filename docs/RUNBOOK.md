# QWATT live run — operator runbook

For the people running Days 15–30. Commands assume the repository at `/opt/qwatt` on Linux hosts,
Node 20, and the systemd units in `ops/deploy/`. What the founders must provide first is in
`docs/FOUNDER-CHECKLIST.md`.

## The three machines

| Host | Runs | Holds | Must never |
|---|---|---|---|
| **Proposer host** (always on; a VPS, not a laptop) | `qwatt-live` · `qwatt-proposer` · `qwatt-publish` | proposer secret · the `qwatt-evidence` deploy key | hold the verifier secret or the `qwatt-verifier-log` deploy key |
| **Verifier host** (different provider, operated by the other founder) | `qwatt-verifier` · `qwatt-verifier-log` · `qwatt-watch` | verifier secret · the `qwatt-verifier-log` deploy key | be given any path or address of the proposer, or the `qwatt-evidence` deploy key |
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
   The tool sets three signers of weight 1, master weight 0 and thresholds **2/2/3** (low 2,
   medium 2, high 3; `anchor/thresholds.js`): no single key can send any transaction for the
   account (the network answers `tx_bad_auth`), anchoring needs 2 of the 3 keys, and changing
   signers or thresholds needs all 3.

   **Fallback, only if the account must exist before the third signer is named** (decision OD-1;
   the two-signer mode of `setup-account.js` comes in week 2, so until then this is done by hand,
   for example in Stellar Laboratory on testnet): build the same setup transaction the tool builds,
   with only the proposer and verifier signers (weight 1 each), master weight 0 and thresholds
   **2/2/2** (low 2, medium 2, high 2). Anchoring still needs both keys. When the third signer
   sends their public key, submit **one** `setOptions` that adds them with weight 1 and sets the
   high threshold to 3, signed by both the proposer and the verifier keys, then run step 4's
   `--verify` with `--third`: every check must pass, `thresholds 2/2/3` included.
4. **Jay signs the funding transaction** the tool printed (Stellar Laboratory → testnet → sign
   with the treasury key → submit). Then run
   `node anchor/setup-account.js --verify G… --proposer G… --verifier G… --third G…`;
   every check must pass, `thresholds 2/2/3` included.
5. **The two evidence repositories** (freeze v3, V3-7; the repositories and their rulesets by
   Tue 27 Oct, the deploy keys by Wed 28 Oct, before the first anchor on the real account). Each is
   a public history written by one host only. What they hold, file by file: `protocol/FEED-FORMAT.md`.
   - Jay Kim (owner of `academiaseul`) creates `academiaseul/qwatt-evidence` and
     `academiaseul/qwatt-verifier-log` at github.com/new: Public, with a README (the agreed text),
     no .gitignore, the licence per decision D2 (proposal: MIT). Edit README.md and LICENSE now,
     before the first publisher run. After it, nobody but the host's publisher commits to either
     repository: the publisher replays its own unpushed commits on top of a commit that only edits
     README.md or LICENSE, and refuses anything else (*When the publisher refuses*, item 6).
   - On each repository, Settings → Rules → Rulesets → New branch ruleset, twice, both targeting the
     default branch: **(1) "public history"**: Active, empty bypass list, *Restrict deletions*,
     *Block force pushes*, *Require linear history*; **(2) "only the host key writes"**: Active,
     bypass list = *Deploy keys* (always), *Restrict updates*. They are separate because a bypass
     actor bypasses every rule of its ruleset, so the deploy key can push but never force-push or
     delete. If *Deploy keys* is not offered as a bypass actor, keep only (1) and say in the
     write-up that the owner account can also push.
   - Each deploy key is generated on its own host, as user `qwatt`, and only its `.pub` file is
     sent to Jay: `sudo -u qwatt mkdir -p -m 700 /home/qwatt/.ssh`, then on the proposer host
     `sudo -u qwatt ssh-keygen -t ed25519 -N "" -C "qwatt-evidence deploy key, proposer host" -f /home/qwatt/.ssh/qwatt-evidence`
     and on the verifier host
     `sudo -u qwatt ssh-keygen -t ed25519 -N "" -C "qwatt-verifier-log deploy key, verifier host" -f /home/qwatt/.ssh/qwatt-verifier-log`.
     The private file never leaves its host and is never pasted anywhere.
   - Jay adds each public key under Settings → Deploy keys → *Allow write access*: the proposer
     host's key on `qwatt-evidence` only, the verifier host's key on `qwatt-verifier-log` only.
   - On each host, pin GitHub's host key:
     `sudo -u qwatt sh -c 'ssh-keyscan -t ed25519 github.com >> /home/qwatt/.ssh/known_hosts'`; check
     `ssh-keygen -lf /home/qwatt/.ssh/known_hosts` against GitHub's published ED25519 fingerprint
     `SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`; then
     `sudo -u qwatt ssh -i /home/qwatt/.ssh/qwatt-evidence -o IdentitiesOnly=yes -T git@github.com`
     greets `Hi academiaseul/qwatt-evidence!` (exit status 1 is normal). The same with
     `qwatt-verifier-log` on the verifier host.
   - Run names: `QWATT_RUN=run` for the seven-day live run, `rehearsal-YYYY-MM-DD` for a rehearsal,
     the same in `publish.env` (proposer host) and `verifier-log.env` (verifier host). Each run
     starts with an empty feed directory and an empty verifier state directory.
     `QWATT_FEED_URL` is `https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/<run>`.
   - Optional: Settings → Pages on `qwatt-evidence` → Deploy from a branch → `main` / (root), so
     the github.io address opens in a browser. No service reads Pages.
   - Smoke test on the proposer host, with a run name and a feed directory of its own
     (`rehearsal-2026-10-28`, `/var/lib/qwatt/smoke-feed`; T1 keeps `rehearsal-2026-10-29`):
     `sudo -u qwatt node ops/publish-feed.js --kind evidence --feed /var/lib/qwatt/smoke-feed --run rehearsal-2026-10-28 --remote git@github.com:academiaseul/qwatt-evidence.git --work /var/lib/qwatt/evidence-repo --ssh-key /home/qwatt/.ssh/qwatt-evidence --once`
     exits 0. A published run name is never reused, because the public history is never
     rewritten: a T1 published under the smoke test's name would be refused (`PUBLISH REFUSED`).
     Any restart from an empty feed gets a new run name. Then, from any machine,
     `git clone https://github.com/academiaseul/qwatt-evidence && node ops/evidence-audit.js qwatt-evidence`
     prints `public history intact`.
6. **Rehearse on the real account:** `node anchor/rehearse.js` produces tests A–D and the
   third-signer liveness check on a throwaway account. For the real account, the same sequence runs
   as the first proposals. Keep the evidence file for the write-up (`--tests`).
7. Install the units: `cp ops/deploy/*.service /etc/systemd/system/`, fill in `/etc/qwatt/*.env`
   from `ops/deploy/env.example` (`publish.env` on the proposer host, `verifier-log.env` on the
   verifier host), then `systemctl daemon-reload`. `qwatt-publish` runs only on the proposer host,
   `qwatt-verifier-log` only on the verifier host. On the proposer host,
   `live.env` must hold `QWATT_PROPOSER_PUBLIC`, `QWATT_VERIFIER_PUBLIC` and `QWATT_THIRD_PUBLIC`
   (the three public keys from step 3, `G…` only, never a secret) before `qwatt-live` first
   starts: a real-time run will not start without them, and they are published in `faults.json`,
   which never changes (wrong keys mean a new feed). Set `QWATT_RUN_START` for the run being
   started (`now` for the week-2 rehearsal on Thu 29 Oct; the live run's own start time for the
   live run) and give each run an empty feed directory. `/opt/qwatt` must be a git checkout of the
   commit being run: the run publishes it as `code_commit`.

## Starting the run (Day 21, latest Day 23)

Start in this order, checking each before the next:

| Step | Host | Command | Check |
|---|---|---|---|
| 1 | verifier | `systemctl enable --now qwatt-verifier qwatt-verifier-log qwatt-watch` | `curl localhost:8090/status.json` shows `last_tick` within 1 min |
| 2 | proposer | `systemctl enable --now qwatt-live` | `feed/faults.json` exists, with `label` = "Simulated input · assurance A0 · Stellar testnet", `anchoring.signers` = the three public keys from setup step 3 and `code_commit` = `git -C /opt/qwatt rev-parse HEAD`; `journalctl -u qwatt-live` shows "replaying …" |
| 3 | proposer | `systemctl enable --now qwatt-publish` | `https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/<run>/index.json` (`<run>` = `QWATT_RUN`, `run` for the live run) loads (the CDN may lag up to 5 minutes); `journalctl -u qwatt-publish` shows `published …` |
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
4. History audit, from any machine with this repository, on a fresh clone of each public
   repository: `git clone https://github.com/academiaseul/qwatt-evidence /tmp/qe && node ops/evidence-audit.js /tmp/qe --since <yesterday's head>`
   and `git clone https://github.com/academiaseul/qwatt-verifier-log /tmp/qv && node ops/evidence-audit.js /tmp/qv --kind verifier-log --since <yesterday's head>`.
   Both must print `public history intact`. Note today's heads (`git -C /tmp/qe rev-parse HEAD`,
   the same for `/tmp/qv`) for tomorrow's check and the write-up.

## When an alert arrives

| Alert | Likely cause | Do |
|---|---|---|
| `VERIFIER_SILENT` | verifier host down or process crashed | `systemctl status qwatt-verifier`; restart it. Batches wait as *published, not anchored* and catch up in order on their own. Nothing to repair. |
| `BACKLOG` | verifier is up but not signing | Check the verifier's `/refusals.jsonl`. A refusal means it found a real mismatch: **do not** work around it; see `NEW_REFUSAL`. With no refusal, check `journalctl -u qwatt-proposer` for `blocked`: the proposer runs the verifier's checks first and does not propose what the verifier would refuse. `blocked` with `verifier.walk_too_long`: see *A long run of rejected batches* below. |
| `NEW_REFUSAL` | the verifier refused a proposal | Read the reason. `verifier.not_published` is usually feed lag and resolves itself. `verifier.hash_mismatch`, `verifier.head_mismatch` or `batch.*` means the published evidence and the proposal disagree: stop `qwatt-proposer`, investigate, and record it in the write-up. `verifier.walk_too_long` is not a disagreement: see *A long run of rejected batches* below. |
| `FEED_STALE` | the live run stopped, or nothing new reaches the public repository | `systemctl status qwatt-live`. Restart it. The minutes it was down stay a visible gap; they are never backfilled. Note the gap for the write-up. A runner that is alive but has fallen more than 7500 s behind the host clock (stalled process, suspended VM) gets `plausibility.skew` on every interval, because each interval's `clock_skew_s` is read from the host clock (V3-6): restart it the same way; it resumes at *now*. If `qwatt-live` is fine, check `journalctl -u qwatt-publish`: see *When the publisher refuses* below. |
| `NO_ANCHOR` | proposer, publisher or Horizon problem | Check `qwatt-proposer` and `qwatt-publish` logs (`PUBLISH REFUSED`: see below), then `https://status.stellar.org`. |
| `BROKEN` | the chain and the feed disagree, or the account or an anchor's signatures break §3 | Treat as an incident. Do not edit any published file. Capture the reconciliation output (`node anchor/reconcile-cli.js --feed <QWATT_FEED_URL> --account <anchoring account>`) and investigate. The problem lines name what was read from Horizon: an account deviation (for example `thresholds 1/2/3`, `master weight 1`, `4 signer(s)`), a signature pair other than proposer + verifier or proposer + third (for example `signed by verifier+third`), a missing or different fixed label in `faults.json`, or signer roles missing or not matching the account. A STAND-IN anchor (proposer + third) is reported but is not BROKEN. |
| `SOURCE_DOWN` | Horizon or the feed host unreachable | Usually transient. If Horizon is down, nothing can anchor; it resumes by itself when Horizon returns. |

## When the publisher refuses (`PUBLISH REFUSED`)

**When you see it.** `journalctl -u qwatt-publish` (or `-u qwatt-verifier-log` on the verifier
host) shows `PUBLISH REFUSED (nothing pushed): …`; `FEED_STALE` or `NO_ANCHOR` follow, because
nothing new reaches the public repository. The refusal is deliberate: a local file disagrees
with what is already public, or someone else wrote to the repository, and the publisher stops
rather than publish the change.

**Never** edit, force-push or delete anything in the public repositories to get past it. The
history audit shows any such change, and the published copy is the record.

**Do** (paths for the proposer host; on the verifier host use `/var/lib/qwatt/verifier-log-repo`
and `/var/lib/qwatt/verifier`):

1. Read the problem. Each names `<run>/<path>` and one of: *published file would be rewritten*,
   *does not extend its published bytes*, *looks like a secret key; never published*,
   *would be deleted* or *outside the run's layout*; or it names the repository and a commit
   *not made by this host*.
2. A rewritten or shrunk file: compare the local file with the published copy,
   `git -C /var/lib/qwatt/evidence-repo show HEAD:run/<path> | diff - /var/lib/qwatt/feed/<path>`,
   and find out why the local copy changed (an edit, a restore from an old backup, a disk fault).
   Stop the service that writes the file (`qwatt-live` for batches and ledgers, `qwatt-proposer`
   for `anchored/`), restore the local file from the published copy
   (`git -C /var/lib/qwatt/evidence-repo show HEAD:run/<path> > /var/lib/qwatt/feed/<path>`), start
   the service again and check that the next tick publishes. Record the cause and the restore in
   the write-up.
3. A secret key: nothing was pushed. Stop the service that wrote it, remove the key from the file,
   and tell both founders at once: that key is treated as exposed on the host.
4. *would be deleted*: put the file back in the worktree,
   `git -C /var/lib/qwatt/evidence-repo checkout -- run/<path>`.
5. *outside the run's layout*: a stray file in the worktree; remove it from
   `/var/lib/qwatt/evidence-repo/run/`.
6. *… not made by this host; only README.md and LICENSE edits are replayed*: someone pushed to
   the repository from elsewhere (a commit that does more than add or edit README.md or LICENSE,
   a merge, or a rewritten history). This host's commits wait, unpushed. Do not force-push. Look at what
   landed: `sudo -u qwatt git -C /var/lib/qwatt/evidence-repo fetch origin`, then
   `git -C /var/lib/qwatt/evidence-repo log --stat HEAD..origin/main`; run the history audit on a
   fresh clone (daily checks, step 4) and tell both founders. The outside commit stays in the
   public history and the audit names it: record it in the write-up. Once both founders agree to
   continue on top of it, `sudo -u qwatt git -C /var/lib/qwatt/evidence-repo rebase origin/main`
   replays this host's commits there, and the next tick pushes them.

## A host rebuilt from scratch

The publisher's worktree (`/var/lib/qwatt/evidence-repo`, `/var/lib/qwatt/verifier-log-repo`)
can be lost: the next tick clones it again and the history continues. The feed directory and the
verifier state directory cannot: started empty, they would produce files that do not extend what
is already public, and the publisher refuses them (correct, but the run stops until someone acts).

1. Generate a new deploy key on the new host (setup step 5); Jay adds it and deletes the old one
   from the repository's deploy keys.
2. Before starting `qwatt-live` and `qwatt-proposer`, restore the feed from the published copy:
   `git clone https://github.com/academiaseul/qwatt-evidence /tmp/qe && cp -a /tmp/qe/run/. /var/lib/qwatt/feed/ && chown -R qwatt: /var/lib/qwatt/feed`;
   then `node batch/verify-cli.js /var/lib/qwatt/feed` must print `OK`.
3. On a rebuilt verifier host, before starting `qwatt-verifier`, restore its state the same way
   from `qwatt-verifier-log` into `/var/lib/qwatt/verifier`.
4. Start the services, and record the rebuild and the minutes the host was down in the write-up.

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
5. Stop the services. The two repositories and the chain remain as the public history. After the
   write-up is submitted, Jay may archive both repositories (Settings → Archive this repository).
