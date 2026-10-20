# batch/ — evidence batches and hash chain (Deliverable 2)

Judged intervals become hash-chained, publicly downloadable evidence batches. Every batch is
published — accepted or rejected — and only accepted batches are ever anchored (Deliverable 3).

```
interval ──► assemble.js (judge: ingest checks + gates G0–G3) ──► ledger line (accepted | rejected + reasons)
                    │ every 12 intervals or on restart
                    ▼
              close(): canonical JSON · intervals_root · prev_hash · energy · cumulative · sha256
                    │ self-check with verify.js (the same function the verifier runs)
                    ▼
              feed.js: batches/<id>.json · ledger/*.jsonl · index.json
```

| File | Role |
|---|---|
| `../protocol/evidence.js` | Canonical JSON (integers only, enforced), SHA-256, Merkle root, batch hash, batch id, basis energy. The one definition of the hash rules. |
| `../protocol/reasons.json` | Registry of every non-gate reason code. Unregistered codes fail the tests. |
| `assemble.js` | `BatchAssembler`: judge intervals, close windows into batches. Pure. |
| `verify.js` | `verifyBatch`: re-derive everything a batch claims. Pure. Shared with the Deliverable 3 verifier. |
| `feed.js` | The on-disk evidence feed: atomic file writes, append-only fsynced ledgers. |
| `pipeline.js` | Restart-safe wiring of assembler + feed. State is rebuilt from the feed, never from memory. |
| `verify-cli.js` | Re-derive a whole published feed from its files alone. |
| `scale.js` | One month through the CSV adapter and the pipeline; chain verified; run twice, identical head. |
| `batch.test.js` | Unit, tamper, restart and determinism tests; pinned fixture in `protocol/conformance/batch-cases.json`. |

```bash
node batch/batch.test.js                 # tests (part of npm test and CI)
node batch/scale.js                      # synthetic month; or --csv file.csv --a a_w --b b_w
node batch/verify-cli.js <feed-dir>      # verify any published feed
node batch/batch.test.js --write         # regenerate the pinned fixture (only on a deliberate rule change)
```

Design decisions and their reasons: `docs/ARCHITECTURE-FREEZE-v2.md`.
