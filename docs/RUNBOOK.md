# QWATT live run — operator runbook

For the people running the hosts, from the week-2 setup (Tue 27 Oct) to Day 30. Commands assume
the repository at `/opt/qwatt` on Linux hosts, Node 20, and the systemd units in `ops/deploy/`.
What the founders must provide first is in `docs/FOUNDER-CHECKLIST.md`.

## The three machines

| Host | Runs | Holds | Must never |
|---|---|---|---|
| **Proposer host** (always on; a VPS, not a laptop) | `qwatt-live` · `qwatt-proposer` · `qwatt-publish` | stellar-cli identity `qwatt-proposer` (user `qwatt`) · the `qwatt-evidence` deploy key | hold the verifier key or the `qwatt-verifier-log` deploy key |
| **Verifier host** (different provider, operated by the other founder) | `qwatt-verifier` · `qwatt-verifier-log` · `qwatt-watch` | stellar-cli identity `qwatt-verifier` (user `qwatt`) · the `qwatt-verifier-log` deploy key | be given any path or address of the proposer, or the `qwatt-evidence` deploy key |
| **Third signer** (a person, off-team) | nothing | their key, a stellar-cli identity on their own computer (`docs/THIRD-SIGNER.md`) | send anyone their secret or their recovery words |

The watchdog runs on the verifier host so it survives a proposer outage. A watchdog that dies with
what it watches cannot report that it died.

No secret enters a browser, a chat, an env file or the repository (freeze v3, V3-8). Each key is
generated with **stellar-cli 28.1.0** on the machine that uses it and stays in that user's
stellar-cli identity store (`~qwatt/.config/stellar` on the hosts). The services ask stellar-cli to
sign (`--sign-with-key qwatt-proposer` / `qwatt-verifier` in the units) and never read a secret; a
`QWATT_*_SECRET` in the environment stops them. Each holder keeps one paper backup of their key's
24 recovery words, offline.

## One-time setup (week 2: Tue 27 – Thu 29 Oct)

The stellar-cli command forms on this page come from stellar-cli's published help and are **to
confirm with stellar-cli 28.1.0 (founder step 0)**: before the first host is set up, a founder runs
each form once on the pinned binary with a throwaway identity, removes the identity, and corrects
this page where a form differs.

1. **Both hosts (Tue 27 Oct):** install Node 20, `git clone` the repository into `/opt/qwatt` at a
   merged `main` commit, then `cd /opt/qwatt/anchor && npm ci`. Create the user `qwatt`
   (`useradd --create-home --shell /usr/sbin/nologin qwatt`) and run `timedatectl set-ntp true`.
   Install **stellar-cli 28.1.0** from the official `stellar/stellar-cli` release into
   `/usr/local/bin`, checking the release's SHA-256 before installing; `stellar version --only-version`
   must print `28.1.0`. Every host and every holder's computer uses that version (decision D-2).
2. **Keys, generated on the host that uses them, over SSH only** (never a provider's web console;
   to confirm with stellar-cli 28.1.0, founder step 0):
   - proposer host: `sudo -u qwatt -H stellar keys generate qwatt-proposer`;
     verifier host: `sudo -u qwatt -H stellar keys generate qwatt-verifier`;
   - `sudo chmod -R go-rwx ~qwatt/.config/stellar` (the directory 700, the identity files 600; to
     confirm with stellar-cli 28.1.0): the identity file is plain text, readable only by `qwatt`.
     Host snapshots and the provider's backups contain it; that is accepted on testnet;
   - `sudo -u qwatt -H stellar keys address qwatt-proposer` (or `qwatt-verifier`) prints the public
     key, `G…`. Send only that line to both founders;
   - paper backup, once: `sudo -u qwatt -H stellar keys secret qwatt-proposer --phrase` prints the
     24 recovery words. Write them on paper, keep the paper offline, then `clear` the terminal. Never
     photograph them, type them into a website or a wallet, paste them into a chat or send them;
   - check the identity: `sudo -u qwatt -H node /opt/qwatt/anchor/keys.js check --sign-with-key qwatt-proposer --expect G_P`
     on the proposer host, `sudo -u qwatt -H node /opt/qwatt/anchor/keys.js check --sign-with-key qwatt-verifier --expect G_V`
     on the verifier host. Each must print `OK` (it signs one throwaway transaction offline and
     never reads the identity file; it warns if the file is readable by others);
   - the third signer follows `docs/THIRD-SIGNER.md` on their own computer and sends only their
     public key. Both founders confirm its first and last four characters by voice.
3. **Backup drill, before the account is created:** each holder proves that their paper backup
   restores the same key by co-signing one throwaway testnet transaction. See *Backup drill (once,
   before the freeze)* below. Do not create the real account until the drill has landed.
4. **Create the anchoring account**, only once all three public keys exist. If the third signer's
   public key has not arrived, do not create the account; tell both founders. The account is always
   created with all three keys (OD-2: the third signer is confirmed). On the computer of the founder
   who creates it, with stellar-cli (to confirm with stellar-cli 28.1.0, founder step 0):
   ```bash
   stellar keys generate qwatt-anchor-setup --network testnet --fund     # Friendbot creates and funds it
   G_A=$(stellar keys address qwatt-anchor-setup)
   node anchor/setup-account.js build --account $G_A --proposer G… --verifier G… --third G… --out setup.xdr
   node anchor/setup-account.js submit setup.xdr --account $G_A --proposer G… --verifier G… --third G… \
        --sign-with-key qwatt-anchor-setup --evidence evidence/account/$G_A --out anchor.json
   stellar keys rm qwatt-anchor-setup                                    # weight 0 now: it can sign nothing
   ```
   If Friendbot is down, retry later with `node anchor/setup-account.js friendbot --account $G_A`;
   never use another faucet. `build` refuses an account that is not fresh. `submit` rebuilds the
   transaction from the four public keys and refuses any other envelope, then stores the envelopes,
   Horizon's answer and the account in `evidence/account/<G_A>/` with their SHA-256 in `index.json`.
   If `submit` gets no answer, check the printed hash on stellar.expert before doing anything else.
   The setup transaction sets three signers of weight 1, master weight 0 and thresholds **2/2/3**
   (low 2, medium 2, high 3; `anchor/thresholds.js`): no single key can send any transaction for the
   account (the network answers `tx_bad_auth`), anchoring needs 2 of the 3 keys, and changing
   signers or thresholds needs all 3.
5. **Jay funds it from the treasury, with stellar-cli on his own computer:**
   `node anchor/setup-account.js fund-xdr --account $G_A --out funding.xdr`, then
   `node anchor/setup-account.js fund-submit funding.xdr --account $G_A --sign-with-key qwatt-treasury --evidence evidence/account/$G_A`.
   `fund-submit` rebuilds the payment from public values and refuses any other envelope (another
   amount, destination or asset, an extra operation, no expiry) before stellar-cli signs, and prints
   the transaction it is about to sign. Never sign a funding envelope any other way.
   The treasury key is a stellar-cli identity on that computer, added once with the interactive
   `stellar keys add qwatt-treasury` prompt, never in argv, a chat or a browser (decision D-1; to
   confirm with stellar-cli 28.1.0, founder step 0).
6. **Verify and copy the config:**
   `node anchor/setup-account.js --verify $G_A --proposer G… --verifier G… --third G… --evidence evidence/account/$G_A`;
   every check must pass, `thresholds 2/2/3` included. Copy `anchor.json` (public values only, each
   signer by role) to `/etc/qwatt/anchor.json` on **both** hosts. Each service checks at start that
   its stellar-cli identity is the key `anchor.json` names for its role. On each host,
   `sudo -u qwatt -H node /opt/qwatt/anchor/keys.js check --sign-with-key qwatt-proposer --account $G_A --config /etc/qwatt/anchor.json`
   (verifier host: `qwatt-verifier`) must report a signer of weight 1.
7. **The two evidence repositories** (freeze v3, V3-7; the repositories and their rulesets by
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
     starts with an empty feed directory and an empty verifier state directory. A run name, once
     published, is taken for good (the public history is never rewritten), so a rehearsal never uses
     `run`. `ops/deploy/env.example` carries the placeholder `rehearsal-YYYY-MM-DD`, which is not a
     valid run name: `qwatt-publish` and `qwatt-verifier-log` exit 2 until it is replaced, in both
     env files and in every URL below.
     `QWATT_FEED_URL` is `https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/<run>`
     (`verifier.env` and `watch.env`) and `QWATT_VERIFIER_LOG_URL` is
     `https://raw.githubusercontent.com/academiaseul/qwatt-verifier-log/main/<run>` (`watch.env`).
     Every reader resolves the branch in that URL to its head commit (the verifier on each tick,
     the watchdog on each observation, the reconciliation on each run), from the anonymous
     `https://github.com/academiaseul/<repository>.git/info/refs`, and reads every file at that
     commit, never file by file from the CDN (freeze v3 V3-7, decision D7). The freeze §7 address
     `https://academiaseul.github.io/qwatt-evidence/<run>` is read the same way, from the repository.
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
8. **Tests A–D and independence on the real account,** once, with the first live proposal: see the
   section of that name below. Its `abcd.json` is the evidence file for the write-up (`--tests`).
   (`node anchor/rehearse.js` remains the throwaway-account rehearsal of 8 Oct.)
9. Install the units: `cp ops/deploy/*.service /etc/systemd/system/`, fill in `/etc/qwatt/*.env`
   from `ops/deploy/env.example` (public values only, with the run name chosen in step 7;
   `publish.env` on the proposer host, `verifier-log.env` on the verifier host), then
   `systemctl daemon-reload`. `qwatt-publish` runs
   only on the proposer host, `qwatt-verifier-log` only on the verifier host. `stellar` must be on
   user `qwatt`'s PATH (`/usr/local/bin`) and the identity in that user's home, or the service
   exits 2 at start. On the proposer host,
   `live.env` must hold `QWATT_PROPOSER_PUBLIC`, `QWATT_VERIFIER_PUBLIC` and `QWATT_THIRD_PUBLIC`
   (the three public keys from step 2, `G…` only, never a secret) before `qwatt-live` first
   starts: a real-time run will not start without them, and they are published in `faults.json`,
   which never changes (wrong keys mean a new feed). Set `QWATT_RUN_START` for the run being
   started (`now` for the week-2 rehearsal on Thu 29 Oct; the live run's own start time for the
   live run) and give each run an empty feed directory. `/opt/qwatt` must be a git checkout of the
   commit being run: the run publishes it as `code_commit`.
   When a unit file changes in this repository, copy it again, `systemctl daemon-reload` and restart
   that service: editing only its env file is not enough. For example `qwatt-watch.service` now passes
   `--verifier-log`, and `ops/watch.js` and `ops/preflight.js` exit 2 on the retired `--verifier-status`.

## Backup drill (once, before the freeze)

With high threshold 3, one lost key freezes the signer set (freeze v3 §3). So each holder proves
once, before the real account is created (Wed 28 Oct), that their paper backup restores their key.
The drill uses a throwaway account `G_D` set up exactly like the anchoring account (2/2/3, the same
three signer keys, master weight 0) and one throwaway transaction: `manageData qwatt.backup_drill`
plus a `setOptions` on the high threshold, so it lands only with all three keys. Everything
exchanged is public: envelopes, signatures and public keys. The evidence goes to
`evidence/backup-drill/<G_D>/`. The stellar-cli forms are to confirm with stellar-cli 28.1.0
(founder step 0). `G_P`, `G_V`, `G_T` are the three public keys.

| Step | Who, where | Do |
|---|---|---|
| D1 | Jay, own computer | `stellar keys generate qwatt-drill-setup --network testnet --fund`; `G_D=$(stellar keys address qwatt-drill-setup)`. If Friendbot fails: `node anchor/setup-account.js friendbot --account $G_D`. |
| D2 | Jay, own computer | `node anchor/setup-account.js build --account $G_D --proposer G_P --verifier G_V --third G_T --out drill-setup.xdr`, then `node anchor/setup-account.js submit drill-setup.xdr --sign-with-key qwatt-drill-setup --account $G_D --proposer G_P --verifier G_V --third G_T --evidence evidence/backup-drill/$G_D`, then `stellar keys rm qwatt-drill-setup`. No `--out`: the drill account gets no `anchor.json` and no funding (only the real account's setup, step 4, writes the config). This also rehearses the account setup. |
| D3 | Jay | `node anchor/keys.js drill-xdr --account $G_D --out drill.xdr`; send `drill.xdr` (public) to Diego and the third signer. It is valid for 7 days. |
| D4 | Diego, proposer host, his own login user over SSH | `stellar keys add qwatt-proposer-restored` and type the 24 words from paper at the interactive prompt, never on the command line; `stellar keys address qwatt-proposer-restored` must print `G_P`; `stellar tx sign drill.xdr --sign-with-key qwatt-proposer-restored --network testnet` and send the printed line to Jay as `drill.proposer.xdr`; then `stellar keys rm qwatt-proposer-restored`. |
| D5 | Jay, verifier host | The same with the verifier backup (`qwatt-verifier-restored`, `G_V`) → `drill.verifier.xdr`. |
| D6 | Third signer, own computer | The same with their backup (`docs/THIRD-SIGNER.md`, step 5) → `drill.third.xdr`, sent by email. |
| D7 | Jay, own computer | `node anchor/keys.js drill-submit --account $G_D --proposer G_P --verifier G_V --third G_T --evidence evidence/backup-drill/$G_D drill.proposer.xdr drill.verifier.xdr drill.third.xdr` must print a stellar.expert link. |

If D7 names a missing role, that holder repeats their step. If a signature comes from a key that is
not a signer, that backup restores a different key: the holder generates a new key and the drill is
repeated, BEFORE the real account is created (afterwards the signer set could not change without
that lost key). Each `-restored` identity is removed right after signing, so the secret stays only
where it already was.

## Tests A–D and independence on the real account

Once, on the week-2 account, right after setup (Thu 29 Oct; Fri 30 is the buffer). A, B, D and I
must run while the SAME proposal is live (its window is 24 h; 60 minutes once V3-11 lands) and the
verifier service is stopped; C is the verifier service then anchoring that very proposal. A, B and C
are therefore one transaction body with one hash, and the verdict checks it. `$FEED` is the public
feed URL and `<G_A>` the anchoring account. Every file written is public data.

| Step | Who, where | Do |
|---|---|---|
| T1 | Diego, proposer host; Jay, verifier host | Proposer host: in `/etc/qwatt/live.env` set `QWATT_RUN_START=now` (this week-2 run starts at once, as `ops/deploy/env.example` has it; the live run's November start is set only at the freeze, on a fresh feed; a restart keeps the start recorded in `faults.json`) and the three public keys `QWATT_PROPOSER_PUBLIC`, `QWATT_VERIFIER_PUBLIC` and `QWATT_THIRD_PUBLIC` (setup step 9). Set `QWATT_RUN` to a rehearsal name, for example `rehearsal-2026-10-29` (never the live run's `run`), in `/etc/qwatt/publish.env` and, on the verifier host, in `/etc/qwatt/verifier-log.env`; `QWATT_FEED_URL` and `QWATT_VERIFIER_LOG_URL` name that run (setup step 7). Start from an EMPTY `/var/lib/qwatt/feed` (the account starts at genesis). Verifier host: start from an EMPTY `/var/lib/qwatt/verifier` (no state from an earlier run carries over). Then, with the updated units (`--sign-with-key`), on the proposer host: `systemctl daemon-reload && systemctl enable --now qwatt-live qwatt-publish`. |
| T2 | Jay, verifier host | `systemctl stop qwatt-verifier qwatt-watch`. They stay stopped until T8 (the watchdog would otherwise alert `VERIFIER_SILENT`). |
| T3 | Diego, proposer host | `systemctl enable --now qwatt-proposer`, then wait for `journalctl -u qwatt-proposer` to show `"action":"proposed"` (the first batch closes about 60 min after the start at real-time pace). `curl -sf $FEED/pending/<batch_id>.xdr` must return it publicly. |
| T4 | Diego, proposer host or own computer | `node anchor/tests-abcd.js a --config /etc/qwatt/anchor.json --feed $FEED --out ~/abcd-A/abcd.json` must report refused `tx_bad_auth`. It needs no key: it submits the published proposal as it is. |
| T5 | Jay, verifier host | `sudo -u qwatt -H node /opt/qwatt/anchor/tests-abcd.js b --config /etc/qwatt/anchor.json --feed $FEED --sign-with-key qwatt-verifier --out /home/qwatt/abcd-V/abcd.json` must report refused `tx_bad_auth`. B first runs the verifier's own checks and signs nothing they would refuse. |
| T6 | Jay, verifier host | `sudo -u qwatt -H node /opt/qwatt/anchor/tests-abcd.js d --config /etc/qwatt/anchor.json --feed $FEED --out /home/qwatt/abcd-V/abcd.json` must report refused `verifier.hash_mismatch`, with nothing submitted. |
| T7 | Jay, verifier host | `sudo -u qwatt -H node /opt/qwatt/anchor/tests-abcd.js i --config /etc/qwatt/anchor.json --feed $FEED --out /home/qwatt/abcd-V/abcd.json` must report refused `verifier.not_published`, with nothing signed or submitted. The batch is withheld from the verifier's only input path by a local proxy on this host, which forwards every other file from the evidence commit I resolved after Horizon (recorded as `feed_commit`); the public feed is never touched (DV-7). |
| T8 | Jay, verifier host | `systemctl enable --now qwatt-verifier qwatt-verifier-log qwatt-watch`. Within 30 s, `curl -s localhost:8090/status.json` must show `last_result.action` `anchored`. |
| T9 | Either founder, any machine | `node anchor/tests-abcd.js c --config anchor.json --out ~/abcd-C/abcd.json` must report ok, pair `proposer+verifier`, and a stellar.expert link. |
| T10 | Jay, own computer | Copy the three folders (public data), then `node anchor/tests-abcd.js combine --out evidence/account/<G_A>/abcd.json ~/abcd-A/abcd.json ~/abcd-V/abcd.json ~/abcd-C/abcd.json`: verdict PASS. It copies the raw A, B, C, D and I files beside it, each with its SHA-256 in `index.json`. Then `node anchor/capture.js account <G_A> --evidence evidence/account/<G_A>` (a final snapshot after C). |
| T11 | Jay | Open the evidence PR. |
| T12 | Both | Leave the week-2 account as it is. At the code freeze (Fri 6 Nov, OD-5) the run account is set up the same way (setup steps 4–6) with the same three public keys: no new keys and no new drill. After a testnet reset the keys survive; only the accounts are re-created. |

If the proposal expires or is replaced between T4 and T7, the hashes no longer match and the verdict
says FAIL: start again from T3 with the next proposal. A verdict of FAIL or INCOMPLETE is recorded as
it is, never edited.

## Starting the run (Day 21, latest Day 23)

Start in this order, checking each before the next:

| Step | Host | Command | Check |
|---|---|---|---|
| 1 | verifier | `systemctl enable --now qwatt-verifier qwatt-verifier-log qwatt-watch` | `curl localhost:8090/status.json` shows `last_tick` within 1 min (port 8090 answers on the verifier host only); within 6 min `https://raw.githubusercontent.com/academiaseul/qwatt-verifier-log/main/<run>/status.json` shows it too (the CDN may lag up to 5 minutes more) |
| 2 | proposer | `systemctl enable --now qwatt-live` | `feed/faults.json` exists, with `label` = "Simulated input · assurance A0 · Stellar testnet", `anchoring.signers` = the three public keys from setup step 2 and `code_commit` = `git -C /opt/qwatt rev-parse HEAD`; `journalctl -u qwatt-live` shows "replaying …" |
| 3 | proposer | `systemctl enable --now qwatt-publish` | `https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/<run>/index.json` (`<run>` = `QWATT_RUN`, `run` for the live run) loads (the CDN may lag up to 5 minutes); `journalctl -u qwatt-publish` shows `published …` |
| 4 | proposer | `systemctl enable --now qwatt-proposer` | within an hour, the first batch shows **anchored** on the reconciliation page |

Reconciliation page:
`https://qwatt.org/reconcile.html?feed=<QWATT_FEED_URL>&account=<anchoring account>`.
It reads Horizon first, then the evidence at the branch's head commit (in a browser through
`api.github.com`, 60 requests an hour per address), and names that commit:
`evidence read at academiaseul/qwatt-evidence@<sha7>`. `node anchor/reconcile-cli.js`, the write-up and
the preflight name it the same way.

## Daily check (15 minutes)

1. Reconciliation page: the verdict is **RECONCILED**, or **PENDING** with only the last one or two
   batches waiting.
2. `node live/audit.js /var/lib/qwatt/feed` on the proposer host: coverage has no gaps, every
   fault that is due shows *refused as expected*, and the `raw:` line counts the raw payloads, each
   tied to a row of a published samples file (any that is not is listed as a problem).
3. Glance at the alert channel. No message is expected on a good day; the watchdog sends one only
   when something starts, repeats every 6 h, or clears.
4. History audit, from any machine with this repository, on a fresh clone of each public
   repository, the verifier log first and the evidence second:
   `git clone https://github.com/academiaseul/qwatt-verifier-log /tmp/qv && node ops/evidence-audit.js /tmp/qv --kind verifier-log --since <yesterday's head>`
   and then `git clone https://github.com/academiaseul/qwatt-evidence /tmp/qe && node ops/evidence-audit.js /tmp/qe --since <yesterday's head>`.
   Both must print `public history intact`. Note today's heads (`git -C /tmp/qe rev-parse HEAD`,
   the same for `/tmp/qv`) for tomorrow's check and the write-up.
   Then check that every evidence commit the verifier judged is still public:
   `node ops/evidence-audit.js /tmp/qe --recorded /tmp/qv/<run>/decisions.jsonl` (each decision line
   names its `feed_commit`). Keep the clone order: the evidence clone must be at least as new as the
   log, because a decision logged between the two clones names an evidence commit that an older
   evidence clone does not hold. A commit missing from the clone is reported as
   `commit <c> the verifier judged is not in this clone`: clone both again in this order and re-run.
   If an evidence clone taken after the log still lacks it, or the report is
   `commit <c> the verifier judged is not in this history`, the public history was rewritten: treat
   it as `BROKEN` below.

## When an alert arrives

| Alert | Likely cause | Do |
|---|---|---|
| `VERIFIER_SILENT` | the verifier's `status.json` in its public log is over 15 minutes old: the verifier host is down, `qwatt-verifier` crashed, or `qwatt-verifier-log` stopped publishing its log. (A healthy log can read up to about 6.5 minutes old: published at most every 5 minutes, plus the publisher's interval and the verifier's tick. The watchdog reads the log at its head commit, so the CDN cache adds nothing; a person opening the branch URL may still see a copy up to 5 minutes older.) | `systemctl status qwatt-verifier qwatt-verifier-log`; restart whichever stopped (`journalctl -u qwatt-verifier-log` for `PUBLISH REFUSED`: see below). Batches wait as *published, not anchored* and catch up in order on their own. Nothing to repair. |
| `BACKLOG` | verifier is up but not signing | Read `refusals.jsonl` in the public verifier log (`https://raw.githubusercontent.com/academiaseul/qwatt-verifier-log/main/<run>/refusals.jsonl`; on the verifier host also `curl localhost:8090/refusals.jsonl`). A refusal means it found a real mismatch: **do not** work around it; see `NEW_REFUSAL`. With no refusal, check `journalctl -u qwatt-proposer` for `blocked`: the proposer runs the verifier's checks first and does not propose what the verifier would refuse. `blocked` with `verifier.walk_too_long`: see *A long run of rejected batches* below. `journalctl -u qwatt-verifier` shows reason `signer`, or either service exits 2 at start and systemd restarts it in a loop: stellar-cli missing or identity not found for user qwatt (check with `sudo -u qwatt -H stellar keys address qwatt-verifier`, or `qwatt-proposer`). |
| `NEW_REFUSAL` | the verifier refused a proposal | Read the reason in `refusals.jsonl` of the public verifier log (the same refusal is a `refused` line in `decisions.jsonl`). `verifier.not_published` and `batch.raw_missing` are no longer feed lag: the verifier reads the evidence at one commit taken after Horizon, so at that commit a proposal was public without its batch or its raw file, which the publisher never does. Treat either as a publication defect: stop `qwatt-proposer`, check `journalctl -u qwatt-publish` and run `node ops/evidence-audit.js` on a fresh clone of `qwatt-evidence`. The decision line names the commit judged (`feed_commit`): `https://github.com/academiaseul/qwatt-evidence/tree/<feed_commit>/<run>` shows exactly what the verifier saw. `verifier.hash_mismatch`, `verifier.head_mismatch` or any other `batch.*` code means the published evidence and the proposal disagree: stop `qwatt-proposer`, investigate, and record it in the write-up. `verifier.walk_too_long` is not a disagreement: see *A long run of rejected batches* below. |
| `FEED_STALE` | the live run stopped, or nothing new reaches the public repository | `systemctl status qwatt-live`. Restart it. The minutes it was down stay a visible gap; they are never backfilled. Note the gap for the write-up. A runner that is alive but has fallen more than 7500 s behind the host clock (stalled process, suspended VM) gets `plausibility.skew` on every interval, because each interval's `clock_skew_s` is read from the host clock (V3-6): restart it the same way; it resumes at *now*. If `qwatt-live` is fine, check `journalctl -u qwatt-publish`: see *When the publisher refuses* below. |
| `NO_ANCHOR` | proposer, publisher or Horizon problem | Check `qwatt-proposer` and `qwatt-publish` logs (`PUBLISH REFUSED`: see below), then `https://status.stellar.org`. |
| `BROKEN` | the chain and the feed disagree, or the account or an anchor's signatures break §3 | Treat as an incident. Do not edit any published file. Capture the reconciliation output (`node anchor/reconcile-cli.js --feed <QWATT_FEED_URL> --account <anchoring account>`, which names the evidence commit it read) and investigate. The problem lines name what was read from Horizon: an account deviation (for example `thresholds 1/2/3`, `master weight 1`, `4 signer(s)`), a signature pair other than proposer + verifier or proposer + third (for example `signed by verifier+third`), a missing or different fixed label in `faults.json`, or signer roles missing or not matching the account. A STAND-IN anchor (proposer + third) is reported but is not BROKEN. |
| `SOURCE_DOWN` | Horizon or the feed host unreachable, or GitHub refused the head-commit lookup or a file read at that commit (`info/refs` or `raw.githubusercontent.com` answering HTTP 403 or 429: an anonymous rate limit; or 5xx) | Usually transient. If Horizon is down, nothing can anchor; it resumes by itself when Horizon returns. While GitHub refuses the lookup or a file read the verifier waits (`verifier.feed_unavailable` in `journalctl -u qwatt-verifier`), signs nothing and refuses nothing; an idle tick costs one lookup, so if it persists, raise the verifier's `--interval` from 30 to 60 in `qwatt-verifier.service`. |

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
   *would be deleted*, *outside the run's layout* or, on the verifier host, *this state directory
   judged … not the run …*; or it names the repository and a commit *not made by this host*.
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
7. *this state directory judged … not the run …*: the verifier's `status.json` names the feed of
   another run (the state directory was reused, or `QWATT_FEED_URL` and `QWATT_RUN` disagree).
   Each run has its own state directory: fix `verifier.env` / `verifier-log.env` so they name the
   same run, or give the new run an empty `/var/lib/qwatt/verifier`.

## A host rebuilt from scratch

The publisher's worktree (`/var/lib/qwatt/evidence-repo`, `/var/lib/qwatt/verifier-log-repo`)
can be lost: the next tick clones it again and the history continues. The feed directory and the
verifier state directory cannot: started empty, they would produce files that do not extend what
is already public, and the publisher refuses them (correct, but the run stops until someone acts).

1. Generate a new deploy key on the new host (setup step 7); Jay adds it and deletes the old one
   from the repository's deploy keys.
2. Before starting `qwatt-live` and `qwatt-proposer`, restore the feed from the published copy:
   `git clone https://github.com/academiaseul/qwatt-evidence /tmp/qe && cp -a /tmp/qe/run/. /var/lib/qwatt/feed/ && chown -R qwatt: /var/lib/qwatt/feed`;
   then `node batch/verify-cli.js /var/lib/qwatt/feed` must print `OK`.
3. On a rebuilt verifier host, before starting `qwatt-verifier`, restore its log from the published
   copy, so its counts continue and nothing it publishes rewrites what is public:
   `git clone https://github.com/academiaseul/qwatt-verifier-log /tmp/qv && cp /tmp/qv/run/decisions.jsonl /tmp/qv/run/refusals.jsonl /var/lib/qwatt/verifier/ && chown -R qwatt: /var/lib/qwatt/verifier`
   (`status.json` is rewritten on the first tick).
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
2. Re-create the anchoring account: repeat setup steps 4–6 with the same three public keys (keys
   survive a reset, accounts do not), and update `/etc/qwatt/anchor.json` on both hosts.
3. Start both services again. With an empty chain they anchor every published batch from seq 0, in
   order, automatically.
4. Record the reset and the re-anchoring in the write-up; the old transaction links die with the
   old testnet.

## Closing the run (Day 30)

1. Let the run end on its own: `qwatt-live` stops after 7 × 24 h and closes the last batch.
2. Leave proposer and verifier running until the reconciliation page says **RECONCILED**.
3. Run the final audit: `node live/audit.js /var/lib/qwatt/feed --json > evidence/live-audit.json`.
4. Generate the write-up:
   `node ops/writeup.js --feed <QWATT_FEED_URL> --account G… --feed-dir /var/lib/qwatt/feed --tests evidence/account/<G_A>/abcd.json --out WRITEUP.md`.
5. Stop the services. The two repositories and the chain remain as the public history. After the
   write-up is submitted, Jay may archive both repositories (Settings → Archive this repository).
