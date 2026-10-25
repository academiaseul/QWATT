# anchor/ — multi-party authorization on Stellar (Deliverable 3)

Accepted batches are anchored only when two of three keys sign: the **proposer**, an
**independent verifier** on a separate host, and an **off-team third signer**. The verifier's only
input is the public evidence feed, so nothing can be signed before it is public.

**The anchoring account's thresholds are 2/2/3** (low 2, medium 2, high 3; three signers of
weight 1; master weight 0; defined once in `thresholds.js`). On Stellar every transaction needs
its source account's low threshold for its fee and sequence, so:

- **no single key can send any transaction for the account**: the network rejects it as
  `tx_bad_auth` and applies nothing, a `BumpSequence` included (under low 1, one key alone could
  bump the sequence, voiding every pending co-signed anchor, or bump it to its maximum and leave
  the account unable to send anything again);
- **anchoring needs two of the three keys** (`manageData` and `payment` are medium);
- **changing signers or thresholds needs all three** (`setOptions` on those fields is high).

```
batch pipeline ─► feed dir ──(published as static files)──► verifier: download · re-derive · rebuild tx
                     ▲                                              │  sign only on a byte-identical match
                 proposer: sign · write pending/<id>.xdr            └─► submit (2 of 3 signatures)
```

| File | Role |
|---|---|
| `thresholds.js` | The anchoring account's thresholds (2/2/3), read by every tool that sets, checks or describes them. |
| `setup-account.js` | Sets up the real anchoring account from public keys only, never creating or reading a secret: `build` (the UNSIGNED setup transaction for a fresh, Friendbot-funded account: trustline, three signers, 2/2/3, master weight 0), `submit` (re-derived from the public keys, signed by the holder's stellar-cli identity, submitted once and captured as evidence; it writes the public config only with `--out`, so the backup drill's account never replaces it), `fund-xdr` (the unsigned 1-QWATT funding payment), `fund-submit` (the treasury holder's step: the payment is rebuilt from public values and any other envelope is refused before stellar-cli signs), `friendbot`, `config` (the public config, each signer by role); `--verify` re-checks it, thresholds included. A setup envelope that never expires or lasts more than an hour is refused. |
| `capture.js` | Submits an envelope once (never retried), printing what it is before stellar-cli signs, and keeps Horizon's answer verbatim, the stellar.expert link and the account as Horizon reports it, each file listed with its SHA-256 in `index.json`. Reads envelopes written by bash or by Windows PowerShell 5.1 (UTF-16LE). It signs whatever it is given: the funding payment goes through `setup-account.js fund-submit`. |
| `keys.js` | `check`: a stellar-cli identity on this machine signs one throwaway transaction offline, matches `--expect` and is a weight-1 signer of `--account` (the identity file is only stat-ed, never read). `drill-xdr` / `drill-submit`: the backup drill, a throwaway transaction with a high-threshold operation that lands only when the three keys restored from their paper backups sign it (`../docs/RUNBOOK.md`, *Backup drill*; the third signer's part is in `../docs/THIRD-SIGNER.md`). |
| `signer.js` | Signing through stellar-cli (V3-8): `cliSigner` hands stellar-cli the transaction on stdin with `--sign-with-key <identity>` and accepts only the same transaction with one more signature, from that identity's key; `signerForRole` is the CLIs' start-up check (no secret in the environment, the identity is the config's signer for its role, one offline test signature). `keypairSigner` is for tests and throwaway rehearsals only. |
| `tx.js` | The deterministic anchoring transaction (anchor hash · cumulative total · nominal payment · memo `QW#<seq>`) and `matchPending`, the verifier's rebuild-and-compare. |
| `chain.js` | Chain head from Horizon → anchored prefix → next batch. Both services rebuild their view from this every tick. `walkToHead` checks what a batch inherits against the on-chain head. |
| `proposer.js` | Proposer service: runs the verifier's walk over its own feed, signs the next published, self-verified batch and writes `pending/<id>.xdr`; otherwise it reports `blocked` with the verifier's reason. Never submits. |
| `verifier.js` | Verifier service: feed URL in, co-signature out. Refusals in `<state>/refusals.jsonl`, served read-only with `--port`. |
| `feed-client.js` | HTTP(S) reader for the public feed — the verifier's only input path. |
| `static-server.js` | Read-only static server for a feed directory (local runs, tests). |
| `rehearse.js` | Throwaway-account multisig rehearsal: tests A, B, C, D and third-signer liveness. |
| `e2e.js` | Throwaway-account end-to-end run of both services: chain, restart, independence test, test D. |
| `reconcile-cli.js` | The reconciliation from the command line (the logic `../reconcile.html` runs, from `../assets/qwatt-reconcile.js`); see below. |
| `fake-horizon-http.js` | Test double: a fake Horizon REST API on 127.0.0.1 (the account, its operations joined with their transactions, `/transactions/<hash>`) and throwaway in-memory Ed25519 keys. No dependencies, so `../batch/reconcile.test.js` stays install-free. |
| `tx.test.js` · `recovery.test.js` · `tests-abcd.test.js` · `keys.test.js` | Offline tests (no network), against `fake-horizon.js`, which applies Stellar's signature rules. |
| `test-fixtures/` | Test-only stand-ins: `fake-stellar-cli.js` answers `keys address`, `tx sign` and `version` with keys derived from a salt, so no secret exists anywhere in a test. |

**What the verifier checks before it co-signs.** Any failure is a refusal with a reason code
registered in `../protocol/reasons.json`, and nothing is signed:

1. The batch named by the proposal is in the public feed (`verifier.not_published`) and hashes to
   its batch-ledger entry (`verifier.hash_mismatch`).
2. What the batch inherits leads back to the on-chain head (`verifier.head_mismatch`). The verifier
   walks back from the batch through the published files, downloads each one once, rehashes it with
   `../protocol/evidence.js` and re-adds every running total: the batch adds its energy, and every
   batch between it and the head, published but never anchored, carries the total forward unchanged.
   The walk must end at the batch whose hash is the on-chain `qwatt.anchor.sha256` and whose total
   is the on-chain `qwatt.cumulative_mwh`. With nothing anchored yet, it must end at seq 0 with a
   total that starts from zero. It reads at most 168 batches (`MAX_WALK_BATCHES` in `chain.js`, one
   week of hourly batches). A walk that stops at that bound is refused with its own code,
   `verifier.walk_too_long`: the check did not finish, which is not evidence of tampering. The
   proposer runs the same walk over its own feed before it proposes and reports `blocked` with the
   same code, so the two services never disagree; `--max-walk N` on both raises the bound
   (`../docs/RUNBOOK.md`). An earlier batch missing from the feed is `verifier.not_published`.
3. The batch re-derives with the shared `verifyBatch` against the copies the walk rehashed: hash,
   Merkle root, link to the previous batch, energy and cumulative arithmetic, counts, window and
   every gate (`batch.*`). Time, node and counted intervals are judged against the anchored head
   (the last accepted batch), never against a batch published as rejected. It also recomputes
   `samples_root` from the published `raw/<batch_id>.jsonl` and ties every raw line to its
   interval (`batch.samples_root_mismatch`, `batch.raw_mismatch`); with no raw file published the
   refusal is `batch.raw_missing` (V3-5). The proposer runs the same check over its own feed and
   reports `blocked` with the same code.
4. The anchoring transaction rebuilt from the batch is byte-identical to the pending one
   (`verifier.tx_mismatch`, `verifier.hash_mismatch`).

The chain head is read from Horizon once per tick. If Horizon or the feed cannot be read, the tick
ends in an error, nothing is signed, and the next tick starts again from the chain. A lagging Horizon
cannot make a batch count twice: the guarantee against a stale read comes from the sequence check in
`verifier.js` (the proposal's sequence must be the head's sequence plus one) together with Stellar's
rule that an account's sequence only moves forward, so anything co-signed on a stale head carries a
used sequence and the network refuses it (`tx_bad_seq`). Batches published as rejected between the
head and the next accepted batch are never anchored. They stay in the hash
chain so the defect stays visible, but they carry no energy: each carries the previous total forward
unchanged (F6), so the on-chain total is the energy of accepted batches only.

```bash
npm install                                   # inside anchor/ — the Stellar SDK, the only dependency
node tx.test.js                               # offline tests (CI)
node rehearse.js                              # testnet rehearsal → ../evidence/rehearsal/
node e2e.js                                   # testnet end-to-end → ../evidence/e2e/

node proposer.js --feed ../feed --config config.json --sign-with-key qwatt-proposer
node verifier.js --feed https://<public feed> --config config.json --sign-with-key qwatt-verifier --port 8090
# both accept --max-walk N (default 168); see ../docs/RUNBOOK.md before using it
# both accept --stellar-bin <path> when stellar is not on PATH
```

**What the reconciliation checks from Horizon** (`../assets/qwatt-reconcile.js`, shared by
`reconcile-cli.js`, `../reconcile.html`, `../ops/writeup.js`, `../ops/watch.js` and
`../ops/preflight.js`). Besides re-hashing every published batch against what was anchored, it
reads the anchoring account and every anchor's signatures, never assuming them:

- the account (`GET /accounts/<id>`) must be thresholds 2/2/3 (low/medium/high), master weight 0 and
  exactly three `ed25519_public_key` signers of weight 1 (freeze v3 §3); anything else is BROKEN and
  the problem names the value read;
- each anchoring transaction's signatures (from the operations joined with their transactions, or
  `GET /transactions/<hash>`) are verified with Ed25519 over the transaction hash, which is what
  Stellar signs, against the three signer keys: proposer + verifier is **normal**, proposer + third
  signer is **STAND-IN** (reported, still reconciles), anything else (verifier + third, one
  signature, all three, a key that is not a signer) is **BROKEN**;
- who is who comes from the run's `faults.json` (`anchoring.signers`, written by `../live/run.js`).
  `--proposer G… --verifier G… --third G…` (all three or none) are only for a feed that does not
  declare them; if both exist and differ, the verdict is BROKEN. Each role must be a signer of the
  account;
- the feed must publish `faults.json` with the fixed label "Simulated input · assurance A0 · Stellar
  testnet"; a feed without it, or with another label, is BROKEN.

```bash
node reconcile-cli.js --feed <base URL> --account G… [--horizon URL] [--proposer G… --verifier G… --third G…] [--json]
#   RECONCILED / PENDING (exit 0) or BROKEN (exit 1), then the label, the account as read,
#   "signatures: N proposer+verifier · M stand-in (proposer+third) · K other" and any problems
```

It reads Horizon first (the account, then every anchor), then the feed: a batch is published before
it is signed, so an anchor missing from a feed read afterwards is a defect, not a stale copy. A
Horizon or feed error fails the check (exit 1, no verdict); it is never reported as BROKEN. The
signer set is the one Horizon returns at the time of the check: if a signer were replaced during a
run, earlier anchors signed by the removed key would read as BROKEN (`unknown key`). Ed25519
verification needs WebCrypto Ed25519 (Node 20, or Chrome 137+, Firefox 129+, Safari 17+); without
it the check stops with no verdict and points to this CLI.

For code that builds on it: `R.check({ feed, horizon, account, roles?, feedOptions? })` returns
`{ report, feed, anchors, account }`; `feedOptions` is passed to `fetchFeed(base, opt)` (today
`{ timeoutMs }`), which is where pinned reads of the evidence repository add their options. A
caller that reconciles pieces it fetched itself passes the chain as the third argument,
`R.reconcile(feed, anchors, { account, record, roles })`; with two arguments it throws.

No secret enters a browser, a chat, an env file or the repository. Each service asks stellar-cli on
its own host to sign (`stellar tx sign --sign-with-key <identity>`), receives the signed envelope and
checks that the new signature is from the key it expects. Node never reads a secret. At start each
CLI refuses a `QWATT_*_SECRET` in the environment, checks that the identity's key is the config's
`signers.proposer` or `signers.verifier`, and signs one throwaway transaction offline (it expired in
1970 and is never submitted), so a missing stellar-cli, a missing identity or a swapped key stops it
with exit 2 instead of failing later on the network. The anchor config's `TESTNET` is mapped to the
full passphrase before stellar-cli sees it. `config.json` (copy `config.example.json`) holds public
values only, `signers` included, and stays out of git because it is host-specific. The stellar-cli
command forms (`stellar keys address <id>`, `stellar tx sign` with the XDR on stdin and no RPC URL,
`stellar version --only-version`) are to confirm with stellar-cli 28.1.0 (founder step 0). The real
account is set up from public keys with `setup-account.js build` and `submit` (`../docs/RUNBOOK.md`,
one-time setup), and the off-team third signer follows `../docs/THIRD-SIGNER.md`.

**Evidence notes for the write-up:**
- under 2/2/3 a single signature is refused as `tx_bad_auth`: it does not meet the low threshold,
  so the transaction itself is rejected. The 8 Oct 2026 rehearsal ran at 1/2/3, where one signature
  met the low threshold and the anchor failed as `tx_failed` / `op_bad_auth` (medium not met); its
  evidence keeps those codes;
- on the real account, `tests-abcd.js` loads the account before A and B and records its thresholds;
  A and B count as refused only on `tx_bad_auth` with the account at 2/2/3, otherwise the A–D
  verdict is FAIL (`rehearse.js` keeps accepting `op_bad_auth` for the 8 Oct evidence);
- tests A, B and C share one transaction hash because Stellar hashes exclude signatures — cite A
  and B by envelope and result code, never by hash.
