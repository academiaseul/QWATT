# qwatt-issuance · Soroban issuance prototype

**Status: prototype, local network only.** Groundwork for the Instaward #2 SOW (draft v1):
"verified watt-hours that can be claimed once, retired in the same step, and checked by
anyone". Nothing here is deployed to testnet or mainnet. Not audited. QWATT units have no
price, no holder and no transfer path, and a retirement conveys no environmental
attribute: not a certificate, a REC or a carbon credit.

- What it is and how it works: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- What was tested, and what was not: [`docs/STATUS.md`](docs/STATUS.md)
- Threats and residual risk: [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md)

## Layout

| Path | What |
|---|---|
| `contracts/qwatt-issuance/src/lib.rs` | The contract (Rust, soroban-sdk 29.0.1). |
| `model/model.mjs` | Independent BigInt reference model (zero dependencies). |
| `fixtures/build-cases.mjs` → `issuance-cases.json` | 62 hand-written conformance cases (214 steps). |
| `fixtures/gen-random.mjs` + `random-sequences.lock` | 1,000 seeded random sequences (30,000 steps), regenerated and pinned by sha256. |
| `fixtures/compare-transcripts.mjs` | Byte-for-byte comparison of model and contract transcripts. |
| `contracts/qwatt-issuance/tests/` | Rust runners: `conformance` (fixtures, native or Wasm), `props` (proptest), `unit`. |
| `scripts/local-spike.mjs` | Mechanics spike + refusals on a local standalone network, fees and resources recorded. |
| `scripts/check-interface.mjs` | The Wasm exports only the allowed functions: no transfer, approve, mint, burn or upgrade. |
| `scripts/local-network.sh` | Starts `stellar/quickstart --local --enable rpc` (Docker). |
| `evidence/local/spike-run.json` | Transactions, results, fees and resources from the last local-network run. |
| `run-all.sh` | Every check, in order. |

## Reproduce

Needs Rust with the `wasm32v1-none` target, stellar-cli ≥ 25.2 (28.1.0 used), and Node ≥ 20.
Docker only for the network run.

```bash
cd soroban
./run-all.sh
```

```bash
./run-all.sh --network
```

The spike refuses to run unless the RPC reports `Standalone Network ; February 2017`.
Every key it uses is `Keypair.random()` in memory, then discarded. No secret is read,
printed or written.

## Units

1 QWATT = 1 MWh, and Stellar assets have 7 decimals, so **1 Wh = 10 stroops**:
412,000 Wh = 0.412 QWATT = 4,120,000 stroops. Accrual takes the anchored
`cumulative_mwh` (milli-watt-hours) and verifies `floor(cumulative_mwh / 1000)` Wh.
