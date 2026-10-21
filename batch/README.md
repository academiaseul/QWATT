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

What `verify.js` checks (the proposer's self-check and the independent verifier run the same function):

- schema, spec and schema versions, `batch_id`, `sha256`, `intervals_root`;
- chain: `prev_hash` and `seq` continue the previous batch, or the batch is a valid genesis. The
  previous batch, and the floor below, must rehash to their own `sha256` before anything is read
  from them (`batch.chain_break`);
- energy and counts against the rejected ledger. Cumulative: an accepted batch adds its energy; a
  batch published as rejected carries the previous total forward unchanged (F6), so the total, and
  what is anchored, is the energy of accepted batches only (`batch.cumulative_mismatch`);
- the floor is the last batch published as accepted. A rejected batch was never verified, so it never
  becomes the floor and never moves it back;
- one installation: every interval names the batch's `site_id` and `node_id`, and the batch names the
  floor's (`batch.site_mismatch`). A node change is refused on every batch until a node-rotation rule
  is defined;
- time: canonical UTC timestamps (`YYYY-MM-DDTHH:mm:ss.sssZ`), every interval on its `dt_s` grid
  (`batch.interval_off_grid`), each interval starting at or after the previous one ends and the batch
  at or after the floor ends (`batch.interval_repeated`, `batch.interval_overlap`), so the same
  energy is never counted twice. Gaps (missing intervals) are allowed;
- every contained interval re-judged by the gates (must accept), every gate-coded rejection re-judged
  (must reject), every reason code registered.

At the door, `assemble.js` applies the same rule before the gates, so an honest batch never carries a
defect and one bad line never sinks a batch: an interval from another site or node
(`ingest.site_mismatch`), off the grid (`ingest.off_grid`), a duplicate, out of order, or starting
before the latest interval that holds time ends (`ingest.overlap`: a change of `dt_s`, or an interval
inside another) is refused on its own line. On restart that point resumes from the floor. A batch
window spans only intervals that hold time: accepted ones, and gate-refused ones no longer than the
profile's `interval_max_dt_s`. Lines refused at the door never set a window; a window with nothing
that holds time is zero-length at the floor (`1970-01-01T00:00:00.000Z` before anything is accepted).

```bash
node batch/batch.test.js                 # tests (part of npm test and CI)
node batch/scale.js                      # synthetic month; or --csv file.csv --a a_w --b b_w
node batch/verify-cli.js <feed-dir>      # verify any published feed
node batch/batch.test.js --write         # regenerate the pinned fixture (only on a deliberate rule change)
```

Design decisions and their reasons: `docs/ARCHITECTURE-FREEZE-v2.md`.
