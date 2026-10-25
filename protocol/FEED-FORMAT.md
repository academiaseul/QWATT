# The public evidence feed: format and rules

What anyone can download to check a QWATT run (SOW Deliverable 2, the evidence manifest format for
public download). Two public repositories, each written by one host only (freeze v3, V3-7):

| Repository | Written from | Published by |
|---|---|---|
| `academiaseul/qwatt-evidence` | the proposer host | `ops/publish-feed.js --kind evidence` (`qwatt-publish.service`) |
| `academiaseul/qwatt-verifier-log` | the verifier host | `ops/publish-feed.js --kind verifier-log` (`qwatt-verifier-log.service`) |

Each run lives under `<run>/` on branch `main`: `run` for the seven-day live run,
`rehearsal-YYYY-MM-DD` for a rehearsal. The repository root holds `.gitattributes` (`* -text`: the
bytes are served exactly as written), `.nojekyll`, and the owner's `README.md` and `LICENSE`. Read
the files from a clone, or over HTTPS at
`https://raw.githubusercontent.com/academiaseul/<repository>/main/<run>/<path>` (a CDN copy, which
can lag up to 5 minutes).

## `qwatt-evidence/<run>/`

| Path | Written by | Content | Once published |
|---|---|---|---|
| `index.json` | pipeline (`batch/feed.js`) | the head: `latest_batch_id`, `latest_seq`, `head_sha256`, `cumulative_mwh`, `spec_version`, `schema_version`, `last_ts_start`, `site_id` | replaced (it only points at the head) |
| `batches/<batch_id>.json` | pipeline | one batch, accepted or rejected, in canonical JSON (`protocol/batch.schema.json`; hash rules in `protocol/evidence.js`) | written once |
| `ledger/batches.jsonl` | pipeline | one line per published batch: `batch_id`, `seq`, `sha256`, `status` (`accepted` or `rejected`), `reasons` | grows only |
| `ledger/accepted.jsonl` | pipeline | one line per accepted interval: `batch_id`, `verdict` (`accept`), `reasons` (empty), `interval` (the normalized record, `protocol/interval.schema.json`), `raw` (the raw payloads it was built from, V3-5), `basis_mwh` | grows only |
| `ledger/rejected.jsonl` | pipeline | one line per refused interval: `batch_id`, `verdict` (`reject`), `reasons` (codes in `protocol/gates.spec.json` and `protocol/reasons.json`), `interval`, `raw` (the raw payloads that came with it, V3-5), and `detail` for some codes | grows only |
| `raw/<batch_id>.jsonl` | pipeline (`batch/feed.js`, V3-5) | one line per interval judged in the batch's window, accepted or refused: canonical JSON `{"payloads":[{"n":…,"utf8":…} or {"n":…,"hex":…}],"seq":…,"ts_start":…,"verdict":"accept"\|"reject"}`, in time order; the batch's `samples_root` is the Merkle root over the SHA-256 of every payload's bytes | written once (before the batch file), published in the same commit as its batch |
| `samples/<name>.csv` | the live run (`live/run.js`) | the samples replayed, one file per UTC day (or part of one) | written once |
| `samples/manifest.jsonl` | the live run | one line per CSV: `file`, `from`, `to`, `rows`, `sha256`; a CSV is published only once a manifest line lists it | grows only |
| `faults.json` | the live run | the run definition, published before the first sample: `description`, `label` (the fixed label "Simulated input · assurance A0 · Stellar testnet", V3-9), `site_id`, `node_id`, `anchoring` (`network` and `signers`: the proposer, verifier and third signer public keys; required for a real-time run, V3-9), `code_commit` (the commit the run was started from), `seed`, `days`, `run_start`, `run_end`, `sample_step_s`, `interval_s`, `faults` (every fault window), `published_at` | written once |
| `pending/<batch_id>.xdr` | proposer (`anchor/proposer.js`) | the proposal: the anchoring transaction for that batch, signed by the proposer, as base64 XDR | replaced only by a fresh proposal for the same batch; stays published after the proposer clears it locally |
| `anchored/<batch_id>.json` | proposer | the anchor found on the chain: `batch_id`, `seq`, `sha256`, `tx_hash`, `ledger`, `anchored_at` | written once |

Since batch schema 1.1.0 (V3-5) every batch carries `samples_root`. The rules R1–R4 (a payload
entry and its bytes, its binding to the interval's `source.raw_sha256`, the raw line and its order,
the root) are stated in `protocol/batch.schema.json` and `ingest/README.md` (*samples_root (V3-5)*).
`batch/verify-cli.js` and the verifier recompute `samples_root` from the published raw file; a batch
whose raw file is not published does not verify (`batch.raw_missing`).

## `qwatt-verifier-log/<run>/`

| Path | Written by | Content | Once published |
|---|---|---|---|
| `decisions.jsonl` | verifier (`anchor/verifier.js`) | one line per decision, once per decision, batch and proposal: `at`, `batch_id`, `seq`, `batch_sha256` (the batch-ledger hash judged), `decision` (`signed` or `refused`), `pending_tx_hash` (the proposal's transaction hash; for `signed`, the anchoring transaction's hash on Horizon, logged before the submission), `reasons` (empty when signed), `detail`, `feed_commit` (the commit of `qwatt-evidence` the verifier read for this decision, after reading Horizon; null for a feed that is not a repository; V3-7c) | grows only |
| `refusals.jsonl` | verifier | one line per refusal of a proposal: `at`, `batch_id`, `pending_tx_hash`, `reasons`, `detail`; each is also a `refused` line in `decisions.jsonl` | grows only |
| `status.json` | verifier | the verifier's last tick: `started_at`, `last_tick`, `last_result`, `feed` (the evidence feed it judges, ending in `/<run>`), `feed_commit` (the evidence commit of the last tick), `signed` and `refused` (counted from the two logs, so a restart never resets them) | replaced at most every 5 minutes when nothing else changed; a new decision is published at once, with the current status (deviation DV-8, for the founders to sign) |

A `status.json` whose `feed` does not end in `/<run>` is never published: that state directory
judged another run. The watchdog (`ops/watch.js --verifier-log`) takes its heartbeat from
`status.json` and counts refusals from the lines of `refusals.jsonl`.

## The rules every commit keeps

`ops/publish-feed.js` checks them before each push and refuses the whole tick on any violation;
`ops/evidence-audit.js` checks them over a whole history.

- **Only this layout**, under `<run>/`. Nothing else in the host's directory is published.
- **Written once** unless a table above says otherwise. Nothing published is ever deleted.
- **Replaced**: `index.json`, a pending envelope for the same batch, and the verifier's `status.json`.
- **Grows only**: every `.jsonl` except `raw/`. The published bytes stay the beginning of every
  later version, and a line is published only once it is complete (ends with a newline).
- **No secret keys**: a file that looks like a Stellar secret seed or a PEM private key stops the
  publication, and the refusal never repeats the key.
- **Consistent snapshots**: every commit is a feed that `node batch/verify-cli.js <clone>/<run>`
  accepts. The publisher reads `index.json` first and cuts every ledger at the head it names, so a
  batch closed during a publication never leaves a ledger line without its batch file.
- **A proposal after its batch**: `pending/<batch_id>.xdr` is added only in a commit after the one
  that published `batches/<batch_id>.json` (and `raw/<batch_id>.jsonl`, for a batch that carries
  `samples_root`), so the verifier is never asked to sign what it cannot download.
- **One writer, one line of history**: no merge commits and no force-push (the repository rulesets).
  Only the host's publisher commits under `<run>/`. The owner may add and edit `README.md` and
  `LICENSE`, never delete them.

## Checking a repository

```bash
git clone https://github.com/academiaseul/qwatt-evidence
node ops/evidence-audit.js qwatt-evidence --since <a head you recorded earlier>
node batch/verify-cli.js qwatt-evidence/<run>
git clone https://github.com/academiaseul/qwatt-verifier-log
node ops/evidence-audit.js qwatt-verifier-log --kind verifier-log
```

The audit needs git and Node only (no network after the clone). It prints
`<n> commits · public history intact`, or names each problem: a merge commit, a deleted, rewritten
or shrunk file, a line added half-written, a file outside the layout, a proposal published before
its batch or its raw file. `--since` also reports a force-push that removed a head you recorded.
