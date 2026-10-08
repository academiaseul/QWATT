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
| `chain.js` | Chain head from Horizon → anchored prefix → next batch. Both services rebuild their view from this every tick. |
| `proposer.js` | Proposer service: signs the next published, self-verified batch and writes `pending/<id>.xdr`. Never submits. |
| `verifier.js` | Verifier service: feed URL in, co-signature out. Refusals in `<state>/refusals.jsonl`, served read-only with `--port`. |
| `feed-client.js` | HTTP(S) reader for the public feed — the verifier's only input path. |
| `static-server.js` | Read-only static server for a feed directory (local runs, tests). |
| `rehearse.js` | Throwaway-account multisig rehearsal: tests A, B, C, D and third-signer liveness. |
| `e2e.js` | Throwaway-account end-to-end run of both services: chain, restart, independence test, test D. |
| `tx.test.js` | Offline tests (no network). |

```bash
npm install                                   # inside anchor/ — the Stellar SDK, the only dependency
node tx.test.js                               # offline tests (CI)
node rehearse.js                              # testnet rehearsal → ../evidence/rehearsal/
node e2e.js                                   # testnet end-to-end → ../evidence/e2e/

QWATT_PROPOSER_SECRET=S… node proposer.js --feed ../feed --config config.json
QWATT_VERIFIER_SECRET=S… node verifier.js --feed https://<public feed> --config config.json --port 8090
```

Secrets come from the environment only and are never written, logged or committed. `config.json`
(copy `config.example.json`) holds public values only and stays out of git because it is host-specific.

**Evidence notes for the write-up** (from the live rehearsal):
- a single signature is refused as `tx_failed` / `op_bad_auth`: it meets the low threshold, not the
  medium one the anchor needs;
- tests A, B and C share one transaction hash because Stellar hashes exclude signatures — cite A
  and B by envelope and result code, never by hash.
