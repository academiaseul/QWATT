# anchor/ — multi-party authorization on Stellar (Deliverable 3)

Accepted batches are anchored only when two of three keys sign: the **proposer**, an
**independent verifier** on a separate host, and an **off-team third signer**. The verifier's only
input is the public evidence feed, so nothing can be signed before it is public.

```
batch pipeline ─► feed dir ──(published as static files)──► verifier: download · re-derive · rebuild tx
                     ▲                                              │  sign only on a byte-identical match
                 proposer: sign · write pending/<id>.xdr            └─► submit (2 of 3 signatures)
```

| File | Role |
|---|---|
| `tx.js` | The deterministic anchoring transaction (anchor hash · cumulative total · nominal payment · memo `QW#<seq>`) and `matchPending`, the verifier's rebuild-and-compare. |
| `chain.js` | Chain head from Horizon → anchored prefix → next batch. Both services rebuild their view from this every tick. `walkToHead` checks what a batch inherits against the on-chain head. |
| `proposer.js` | Proposer service: runs the verifier's walk over its own feed, signs the next published, self-verified batch and writes `pending/<id>.xdr`; otherwise it reports `blocked` with the verifier's reason. Never submits. |
| `verifier.js` | Verifier service: feed URL in, co-signature out. Refusals in `<state>/refusals.jsonl`, served read-only with `--port`. |
| `feed-client.js` | HTTP(S) reader for the public feed — the verifier's only input path. |
| `static-server.js` | Read-only static server for a feed directory (local runs, tests). |
| `rehearse.js` | Throwaway-account multisig rehearsal: tests A, B, C, D and third-signer liveness. |
| `e2e.js` | Throwaway-account end-to-end run of both services: chain, restart, independence test, test D. |
| `tx.test.js` | Offline tests (no network). |

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
   (the last accepted batch), never against a batch published as rejected.
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

QWATT_PROPOSER_SECRET=S… node proposer.js --feed ../feed --config config.json
QWATT_VERIFIER_SECRET=S… node verifier.js --feed https://<public feed> --config config.json --port 8090
# both accept --max-walk N (default 168); see ../docs/RUNBOOK.md before using it
```

Secrets come from the environment only and are never written, logged or committed. `config.json`
(copy `config.example.json`) holds public values only and stays out of git because it is host-specific.

**Evidence notes for the write-up** (from the live rehearsal):
- a single signature is refused as `tx_failed` / `op_bad_auth`: it meets the low threshold, not the
  medium one the anchor needs;
- tests A, B and C share one transaction hash because Stellar hashes exclude signatures — cite A
  and B by envelope and result code, never by hash.
