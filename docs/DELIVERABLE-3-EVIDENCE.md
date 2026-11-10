# Deliverable 3 evidence · multi-party authorization on Stellar

**Deliverable 3 is built and running on Stellar testnet. The run account and the rehearsal accounts are at thresholds 2/2/3 with master weight 0, and all of them hold the same three signer keys: the proposer's, the independent verifier's and the off-team third signer's. On Mon 9 Nov 2026 the network refused the proposer alone and the verifier alone (`tx_bad_auth`). The verifier refused an altered batch (`verifier.hash_mismatch`) and a batch withheld from its only input path (`verifier.not_published`). The two keys together then anchored the proposal (test C). The live run's anchors began on Tue 10 Nov at 04:01 UTC (01:01 Chile time), and each one is signed by the proposer and the verifier.** The A–D evidence is in [`evidence/rehearsal/2026-11-09-abcd/`](../evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY/) ([PR #66](https://github.com/academiaseul/QWATT/pull/66)). Two things were not done before the run: the stand-in drill and the kill tests. One SOW item was not met: the third signer was not designated at kickoff. All three are covered below.

- **Date:** Tue 10 Nov 2026 (Day 23). The chain, feed and log facts below were read from Horizon testnet and the public repositories at 20:54 UTC (17:54 Chile time). Repository: `main` at `4e56a1f`, after [PR #67](https://github.com/academiaseul/QWATT/pull/67).
- **SOW:** Deliverable 3 as written in SOW final v4 (September 2026): §4 Scope, §5 Week 3 and §6 Evidence of Completion.
  - That text is not in the repository. [`docs/ARCHITECTURE-FREEZE-v3.md`](ARCHITECTURE-FREEZE-v3.md) cites it throughout.
- **Calendar:** Day 1 is Mon 19 Oct 2026, and Chile time is UTC−3 for the whole sprint.
  - **Prior work, not funded:** the proposer, the verifier, the anchoring transaction and a 2-of-3 rehearsal on throwaway keys (8 Oct 2026), plus the first A–D tool for the real account (17 Oct). See [`docs/PRIOR-WORK.md`](PRIOR-WORK.md).
  - **Built in the sprint:**
    - thresholds 2/2/3 (OD-1, Day 3);
    - keys held only in stellar-cli (V3-8);
    - the public verifier log (V3-7b);
    - tests A–D on a real account as built (DV-7);
    - final refusals (V3-11) and the stand-in role (V3-13d);
    - the third signer's key (Thu 5 Nov), the backup drill and the accounts (6, 7 and 9 Nov);
    - the tests (Mon 9 Nov) and the run (from Tue 10 Nov).
- **Scope:** Stellar testnet only. All input is simulated, at assurance A0. QWATT is not electricity, a security, a renewable energy certificate (REC) or a carbon credit. The QWATT testnet asset is used only as the anchoring vehicle.

> **Resumen.** El Entregable 3 (autorización de varias partes en Stellar) está construido y funcionando en Stellar testnet.
>
> - **Cuentas y claves.** La cuenta de la corrida y las cuentas de ensayo tienen umbrales 2/2/3 y la clave maestra en peso 0. Todas usan las mismas tres claves: la del proponente, la del verificador independiente y la del firmante externo al equipo.
> - **Pruebas del lunes 9 de noviembre.** La red rechazó al proponente solo y al verificador solo (`tx_bad_auth`). El verificador rechazó un lote alterado (`verifier.hash_mismatch`) y un lote retenido fuera de su única vía de entrada (`verifier.not_published`). Con las dos firmas, la misma propuesta quedó anclada (prueba C).
> - **Corrida.** Ancla desde el martes 10 a la 01:01 hora de Chile. Cada anclaje lleva la firma del proponente y la del verificador, y la conciliación da RECONCILED.
>
> Lo que no se hizo:
> - el simulacro de suplente y las pruebas de caída;
> - designar al firmante externo en el arranque del sprint: el firmante cuya clave se usa se encontró en la semana 3, y la clave pública del firmante externo llegó el jueves 5 de noviembre.
>
> Todo es simulado y solo en Stellar testnet.

## Build items (SOW §4, Deliverable 3)

| SOW requirement | Status | Evidence |
|---|---|---|
| Anchoring account configured with native Stellar multisig, medium threshold 2-of-3 | Built, on testnet | **Run account** [`GDSEQAD3…4MDC`](https://stellar.expert/explorer/testnet/account/GDSEQAD3B5YTX3TYA6L3U65X6IGAGET67OHQFMKNC4O5AJFVEIVL4MDC), as Horizon reports it: low 2, medium 2, high 3; the three signer keys at weight 1; master weight 0. It was set up from public keys only by `anchor/setup-account.js`, which reads the thresholds from `anchor/thresholds.js`. A single setup transaction, [`38b27d8a…`](https://stellar.expert/explorer/testnet/tx/38b27d8ab2f55c025b8bd2137bf3bb5b1ba0745087c2fd13a8ebaf0d993764df) (Fri 6 Nov, ledger 5,596,586), added the trustline, the three signers, the thresholds and master weight 0. **Why 2/2/3:** OD-1 (Wed 21 Oct) raised the low threshold to 2, so no single key can send any transaction for the account. The other accounts have the same configuration ([table below](#signer-keys-and-accounts)). |
| Proposer service: signs batches the engine accepted | Built, running on the proposer host | `anchor/proposer.js` (unit `ops/deploy/qwatt-proposer.service`). **Before it signs,** it runs the verifier's own walk and checks over its own feed. **What it signs:** the next batch that is both published and self-verified. It writes the proposal to the public feed as `pending/<id>.xdr` and never submits. **Proposal limits:** valid for at most 60 minutes, a fixed fee, and only the proposer's signature (V3-11). **Refusals:** it learns of them only from the public verifier log (`--verifier-log`). |
| Independent verifier service on a separate host with a separate key: downloads the published batch, recomputes the hash, re-runs the gates and signs only on agreement — it never receives data from the proposer directly | Built, running. Separate host, provider, operator and key | `anchor/verifier.js` (unit `ops/deploy/qwatt-verifier.service`, `--feed ${QWATT_FEED_URL}`). **What it reads:** Horizon's chain head, then one commit of the public feed (`anchor/feed-client.js`). **What it checks:** **(1)** the batch is in the public feed and hashes to its ledger entry; **(2)** the walk back to the on-chain head; **(3)** the full re-derivation with `verifyBatch`, every gate and `samples_root` included; **(4)** the pending transaction, rebuilt byte for byte (`anchor/tx.js` `matchPending`). Any failure is a refusal with a reason code registered in `protocol/reasons.json` ([`anchor/README.md`](../anchor/README.md)). **Hosts (freeze v3 §9, OD-4):** the proposer host is a VPS at DigitalOcean operated by Diego Ostertag, and the verifier host is Jay Kim's own computer (Windows 10, WSL2). **No direct path:** the RUNBOOK forbids giving the verifier host any path or address of the proposer, so a proposal reaches the verifier only as `pending/<id>.xdr` in the public feed. **Keys:** each is a stellar-cli identity on its host, and no secret goes in an environment file (V3-8). |
| Third signer key held off-team, designated at kickoff | Held off-team: **yes**. Designated at kickoff: **not met** | **Key:** [`GCA6…MBSD`](#signer-keys-and-accounts). The third signer generated it with stellar-cli 28.1.0 on the third signer's own computer and sent only the public key ([`docs/THIRD-SIGNER.md`](THIRD-SIGNER.md)). Both founders confirmed it by voice on Thu 5 Nov (freeze v3 §9, OD-2; [PR #56](https://github.com/academiaseul/QWATT/pull/56)). **Off-team:** on Fri 6 Nov, Diego Ostertag confirmed in writing that the third signer does not work for QWATT, depends on neither founder and has no role in the sprint. The name is not recorded. **Backup drill:** see the [backup-drill row below](#signer-keys-and-accounts). **Designation:** not at kickoff. The signer whose key is used was found in week 3, and the public key arrived on Thu 5 Nov, Day 18 (`CHANGELOG.md`, week 3, which corrects week 1's wording). |
| One atomic transaction per batch: manageData evidence hash + manageData cumulative total + payment op, using the existing testnet asset as the anchoring vehicle only | Built as specified. The asset follows DV-10 | **Format** (`anchor/tx.js`): `manageData qwatt.anchor.sha256` (the batch SHA-256 as 64 hex characters), `manageData qwatt.cumulative_mwh` (a decimal string), a payment of 0.0000001 QWATT, and memo `QW#<seq>`. **Example:** [QW#16](https://horizon-testnet.stellar.org/transactions/70e3f82048cc2390997e533b7bc0d650b7bc98e8a3b500cbde66d25314d695ea/operations) carries `3254f8c0…`, `620035` and 0.0000001 QWATT to `GCR3…SWGN`. **Asset:** `QWATT:GC5FJHNEEULWCFXNPHUJ4VU27ROEVKY33VCNN3DJLVD53VNZ7RXXO3SX`, from the second testnet genesis of 24 Aug 2026. It replaces the 22 Aug asset named in `deployment.json` (`QWATT:GDN6…LT46`), whose treasury key is not available (deviation DV-10). |
| Four published test transactions: (A) proposer signs alone — rejected by the network; (B) verifier signs alone — rejected; (C) proposer and verifier sign — anchored; (D) evidence altered after the verifier's read — the verifier refuses and nothing anchors | Done: verdict **PASS**, Mon 9 Nov, rehearsal account `GCJ5…E4GY` | [Tests A–D and independence](#tests-ad-and-independence-mon-9-nov). D as built differs from the SOW wording; see that section. |
| Independence acceptance test: the verifier's only input path is the public evidence feed — a batch the proposer holds but has not published cannot be signed | Done: **PASS** (test I) | Refused with `verifier.not_published`; nothing was signed or submitted ([test I](#tests-ad-and-independence-mon-9-nov)). |
| Live run starts as soon as the first multisig batch anchors (target day 21, latest day 23) | **Partly met:** started on Day 23, the latest day allowed, three days after the first multisig anchor (Day 20) | **First 2/2/3 anchor:** Sat 7 Nov (Day 20), on a rehearsal account ([below](#the-first-anchor-at-223-with-the-three-sprint-keys-sat-7-nov)). **Run start:** Tue 10 Nov 00:00 Chile time (03:00 UTC), Day 23. **First run anchor:** 04:01:02 UTC. **Why Day 23:** the run did not start right after the first anchor. Deviations DV-11 and DV-12 moved the start so that tests A–D could run first on a separate account. |

## Week 3 plan and expected output (SOW §5)

| SOW requirement | Status | Evidence |
|---|---|---|
| Multisig account setup; proposer service; independent verifier service; third signer onboarding; atomic anchoring transaction; test transactions A–D; live run starts (target day 21) | Done, later than planned | Third signer's key: Thu 5 Nov. Run account: Fri 6 Nov. Rehearsal accounts: Sat 7 and Mon 9 Nov. Tests A–D: Mon 9 Nov (Day 22). Run: Tue 10 Nov (Day 23). |
| Days 21–22: integration freeze — no new features; reliability, recovery, documentation | **Partly met** | **Code:** `anchor/`, `batch/` and `protocol/` are unchanged from `848c90e` (Fri 6 Nov, Day 19) to `9ee4646`, the run's commit. That commit is `code_commit` in `run/faults.json`, and the tag `code-freeze`, set on Tue 10 Nov, points to it. **Recorded changes:** later changes to the monitors, the run dates and the expected-refusal list are recorded as DV-11 and DV-12. **Not done:** the recovery checks, meaning the kill tests and the stand-in drill ([below](#not-done-or-not-as-the-sow-says)). |
| Expected output: "the first 2-of-3 anchored batch on Stellar Testnet, with linked transactions proving a single signer cannot anchor, and the pipeline left running" | Met | First 2/2/3 anchor: [`13457b4b…`](https://stellar.expert/explorer/testnet/tx/13457b4b27fbfbe0743c6ff3664c0f89427bf3659f683df522799ff3fe14a9a8) (7 Nov). Single signers refused: A and B (9 Nov). The pipeline has been anchoring every hour since Tue 10 Nov. |

## Evidence of completion (SOW §6, Deliverable 3)

| SOW evidence | Status | Where |
|---|---|---|
| Multisig account on stellar.expert showing the three signers and thresholds | Done | **Run account:** [stellar.expert](https://stellar.expert/explorer/testnet/account/GDSEQAD3B5YTX3TYA6L3U65X6IGAGET67OHQFMKNC4O5AJFVEIVL4MDC) · [Horizon](https://horizon-testnet.stellar.org/accounts/GDSEQAD3B5YTX3TYA6L3U65X6IGAGET67OHQFMKNC4O5AJFVEIVL4MDC). The rehearsal and drill accounts are in the [table below](#signer-keys-and-accounts). The reconciliation re-reads the account on every check: thresholds 2/2/3, master weight 0, exactly three signers of weight 1 ([`anchor/README.md`](../anchor/README.md)). |
| Stellar Testnet transaction hashes of anchored batches | Done; the list grows every hour | **Run:** QW#0 [`31b72314…`](https://stellar.expert/explorer/testnet/tx/31b723146869494fdb21ee613d55f1f5ba090d562afc6b7bce4c1072d2890856) to QW#16 [`70e3f820…`](https://stellar.expert/explorer/testnet/tx/70e3f82048cc2390997e533b7bc0d650b7bc98e8a3b500cbde66d25314d695ea); [all 17](#live-run-anchors-from-tue-10-nov) as of 20:54 UTC Tue 10 Nov. **Rehearsals:** [`13457b4b…`](https://stellar.expert/explorer/testnet/tx/13457b4b27fbfbe0743c6ff3664c0f89427bf3659f683df522799ff3fe14a9a8) (first, 7 Nov) and test C [`d75c10d7…`](https://stellar.expert/explorer/testnet/tx/d75c10d78fa0dace388c4155e87e243d75bd32e3eb4ca43effea4e46fc55d86a) (9 Nov). Every run anchor is listed by [Horizon](https://horizon-testnet.stellar.org/accounts/GDSEQAD3B5YTX3TYA6L3U65X6IGAGET67OHQFMKNC4O5AJFVEIVL4MDC/transactions?order=asc&limit=200). |
| The four test transactions A–D, each linked | Done | **A and B** never entered a ledger: under 2/2/3 one signature does not meet the low threshold, so no explorer page exists for them. Their evidence is the signed envelope plus Horizon's verbatim answer. **C** is an on-chain transaction. **D** was never submitted; its evidence is the pending envelope it refused plus the verdict. All are linked in [the table below](#tests-ad-and-independence-mon-9-nov). |
| Independence test log: an unpublished batch the verifier refused to sign | Done | [`I.refusals.jsonl`](../evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY/I.refusals.jsonl): at `2026-11-09T21:59:52.866Z`, batch `qwatt-chispa-01-000000`, reason `verifier.not_published`, "pending transaction names a batch that is not in the public feed". **Wording (DV-7):** the batch was withheld from the verifier's only input path, and the public feed was never touched. The SOW's word "unpublished" is therefore not used for it. |
| Independent verifier logs | Done | **Repository:** [`academiaseul/qwatt-verifier-log`](https://github.com/academiaseul/qwatt-verifier-log), written only from the verifier host. **Run:** [`run/decisions.jsonl`](https://raw.githubusercontent.com/academiaseul/qwatt-verifier-log/main/run/decisions.jsonl) and [`run/status.json`](https://raw.githubusercontent.com/academiaseul/qwatt-verifier-log/main/run/status.json). Each decision names the evidence commit it judged (`feed_commit`) and the hash of the transaction it signed. **Rehearsals:** [`rehearsal-2026-11-07/decisions.jsonl`](https://raw.githubusercontent.com/academiaseul/qwatt-verifier-log/main/rehearsal-2026-11-07/decisions.jsonl) and [`rehearsal-2026-11-09/decisions.jsonl`](https://raw.githubusercontent.com/academiaseul/qwatt-verifier-log/main/rehearsal-2026-11-09/decisions.jsonl). The run log begins with 25 rehearsal decisions ([below](#found-when-the-run-was-armed-mon-9-nov)). |

## Signer keys and accounts

| Role | Public key | Held as | Where |
|---|---|---|---|
| Proposer | `GDGTDIZGF5PY5UZHWLLRIF7O3VYR5ZSYBKG5GZOBNOCL7PC44IRQQT5T` | stellar-cli identity `qwatt-proposer` | Proposer host: a VPS at DigitalOcean (Ubuntu 24.04), operated by Diego Ostertag |
| Verifier | `GAJCK4PA3CFEZNQD3TLVWWSMHIXGIBV33SIYWZM6CUTMLH7LQKKSYI3U` | stellar-cli identity `qwatt-verifier` | Verifier host: Jay Kim's own computer (Windows 10, WSL2, Ubuntu 26.04), a different provider |
| Third signer | `GCA6IH2O4N3UOCLTEBEFQ6DA4Y4367G6SWRUTE47Y7VGBHIV64BAMBSD` | stellar-cli identity `qwatt-third` | The third signer's own computer, off-team |

The roles are the ones the run declares in [`run/faults.json`](https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/run/faults.json) (`anchoring.signers`). The hosts are as recorded in freeze v3 §9 (OD-4, 30 Oct and 6 Nov).

All five accounts below were read from Horizon at 20:54 UTC on Tue 10 Nov. Each has thresholds 2/2/3, the three keys above at weight 1 and master weight 0.

| Account | Use | Set up | Anchors | Links |
|---|---|---|---|---|
| `GDSEQAD3B5YTX3TYA6L3U65X6IGAGET67OHQFMKNC4O5AJFVEIVL4MDC` | **The live run** | [`38b27d8a…`](https://stellar.expert/explorer/testnet/tx/38b27d8ab2f55c025b8bd2137bf3bb5b1ba0745087c2fd13a8ebaf0d993764df), Fri 6 Nov 23:09 UTC, ledger 5,596,586. Funded with 1 QWATT by [`67737031…`](https://stellar.expert/explorer/testnet/tx/67737031c547e36f4f8996baba8ee3dcbb8d9d9d73d855ed5625c319c0b96404) | 17 by 20:54 UTC Tue 10 Nov (QW#0–QW#16), from 04:01 UTC Tue 10 Nov | [stellar.expert](https://stellar.expert/explorer/testnet/account/GDSEQAD3B5YTX3TYA6L3U65X6IGAGET67OHQFMKNC4O5AJFVEIVL4MDC) · [Horizon](https://horizon-testnet.stellar.org/accounts/GDSEQAD3B5YTX3TYA6L3U65X6IGAGET67OHQFMKNC4O5AJFVEIVL4MDC) |
| `GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY` | Rehearsal of Mon 9 Nov: tests A–D and I | [`ef0ed7bd…`](https://stellar.expert/explorer/testnet/tx/ef0ed7bd379c151fe1534b369b579f2a53df6b447d40e7b976b269c36d2e3b85), Mon 9 Nov 20:06 UTC, ledger 5,646,230. Funded by [`e7ba593e…`](https://stellar.expert/explorer/testnet/tx/e7ba593e8634a5679b08ac469f06db733848544a434cb22543da13252cbdffa2) | 1: test C | [stellar.expert](https://stellar.expert/explorer/testnet/account/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY) · [Horizon](https://horizon-testnet.stellar.org/accounts/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY) |
| `GBITYDTMWQMP73YYHB4U3E3LQHHKADLTD2QUNNRLTMLHONRXWZCTHFC2` | Rehearsal of Sat 7 Nov (`rehearsal-2026-11-07`) | [`718b3efd…`](https://stellar.expert/explorer/testnet/tx/718b3efd1cffe82a31944c260e0f3372b2fbe3fef7ce11f323e202456d9b579d), Sat 7 Nov 15:19 UTC, ledger 5,608,230. Funded by [`c173f874…`](https://stellar.expert/explorer/testnet/tx/c173f87414442d8f9895294ef56457eb77c8fc970a6230f773d9d600893d54b2) | 24 (QW#0–QW#23), Sat 7 Nov 23:43 UTC to Sun 8 Nov 15:30 UTC, all proposer + verifier | [stellar.expert](https://stellar.expert/explorer/testnet/account/GBITYDTMWQMP73YYHB4U3E3LQHHKADLTD2QUNNRLTMLHONRXWZCTHFC2) · [Horizon](https://horizon-testnet.stellar.org/accounts/GBITYDTMWQMP73YYHB4U3E3LQHHKADLTD2QUNNRLTMLHONRXWZCTHFC2) |
| `GBQ4B36LUJUTNIRDMJGS5ATERINFIQBWMVL63DSNY3PPRNQOXJMRDROH` | **Backup drill**, Fri 6 Nov | [`ee664ae3…`](https://stellar.expert/explorer/testnet/tx/ee664ae385cd9385d74d4ac672916aeb272bdc4b219f8fcbe5dbdc0f69717b64), Fri 6 Nov 18:27 UTC, ledger 5,593,200 | None. **The drill transaction:** [`b5726893…`](https://stellar.expert/explorer/testnet/tx/b572689383e4a410ee400192e4f8c540704d4295f1d7e0c72f57f6197ef93c5e) (21:15 UTC, ledger 5,595,221), carrying `manageData qwatt.backup_drill` and a `setOptions` on the high threshold. **Who signed:** proposer, verifier and third signer, each with the key restored from its paper backup (RUNBOOK, *Backup drill*; `CHANGELOG.md`, week 3). **What it proves:** a high-threshold operation lands only when all three keys sign. **When:** before any anchoring account existed. **Files:** [`evidence/backup-drill/`](../evidence/backup-drill/GBQ4B36LUJUTNIRDMJGS5ATERINFIQBWMVL63DSNY3PPRNQOXJMRDROH/) ([PR #57](https://github.com/academiaseul/QWATT/pull/57)) | [stellar.expert](https://stellar.expert/explorer/testnet/account/GBQ4B36LUJUTNIRDMJGS5ATERINFIQBWMVL63DSNY3PPRNQOXJMRDROH) · [Horizon](https://horizon-testnet.stellar.org/accounts/GBQ4B36LUJUTNIRDMJGS5ATERINFIQBWMVL63DSNY3PPRNQOXJMRDROH) |
| `GBQFZBRDV7JVHI45CVIOWHHUQPESV67NN57ERYEZOENZF7HR5XSNGSX5` | **Not used** (DV-10): a trustline to the 22 Aug asset, never funded | [`3e511448…`](https://stellar.expert/explorer/testnet/tx/3e511448f2783abcbe563e61fe9667642cbde4bd4c58271d493a2d6561350314), Fri 6 Nov 21:20 UTC, ledger 5,595,273 | None | [stellar.expert](https://stellar.expert/explorer/testnet/account/GBQFZBRDV7JVHI45CVIOWHHUQPESV67NN57ERYEZOENZF7HR5XSNGSX5) · [Horizon](https://horizon-testnet.stellar.org/accounts/GBQFZBRDV7JVHI45CVIOWHHUQPESV67NN57ERYEZOENZF7HR5XSNGSX5) |

## Tests A–D and independence (Mon 9 Nov)

**Setup.** Run `rehearsal-2026-11-09` used account `GCJ5…E4GY`, with both hosts at `9ee4646`. The verifier service was stopped for A, B, D and I.

**One proposal for all five.** Every test used the proposal for batch `qwatt-chispa-01-000000`, transaction body `d75c10d78fa0dace388c4155e87e243d75bd32e3eb4ca43effea4e46fc55d86a`, valid 21:45:25–22:45:25 UTC. Stellar hashes exclude signatures, so A, B and C are one body with one hash. A and B are therefore cited by envelope and Horizon's answer, never by hash.

**Where each test ran.**
- A: the proposer host, or any computer.
- B, D and I: the verifier host.
- C: the verifier service, restarted (RUNBOOK, *Tests A–D and independence on the real account*, T4–T9).

**Files.** All files are in [`evidence/rehearsal/2026-11-09-abcd/GCJ5…E4GY/`](../evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY/). The combined verdict in [`abcd.json`](../evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY/abcd.json) is **PASS**. All 13 files match the SHA-256 listed in `index.json`, rechecked on 10 Nov.

| Test | What ran (UTC, Mon 9 Nov) | Result | Evidence |
|---|---|---|---|
| **A** · proposer alone | The published proposal, carrying only the proposer's signature, submitted unchanged at 21:58:12 | **Refused by the network:** HTTP 400, `tx_bad_auth`; result XDR `AAAAAAAAASz////6AAAAAA==` (txBAD_AUTH). The account was loaded at 2/2/3 first. | [`A.envelope.xdr`](../evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY/A.envelope.xdr) · [`A.horizon.json`](../evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY/A.horizon.json) |
| **B** · verifier alone | The same body, re-signed by the verifier key alone, at 21:59:22. B first ran the verifier's own checks, so it signs nothing the verifier would refuse. | **Refused by the network:** `tx_bad_auth` | [`B.envelope.xdr`](../evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY/B.envelope.xdr) · [`B.horizon.json`](../evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY/B.horizon.json) |
| **D** · altered evidence | On the verifier host, the published batch was altered in memory after the proposer signed: +1,000 mWh on one interval, with the hash recomputed to `4d2d9f93…`. Run at 21:59:47. | **Refused** with `verifier.hash_mismatch`: "pending anchor ≠ hash of the published batch". Nothing was submitted or published. | [`D.pending.xdr`](../evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY/D.pending.xdr) · `abcd.json` (`D_altered_after_proposer_signed`) |
| **I** · independence | At 21:59:52, a local proxy on the verifier host withheld `batches/qwatt-chispa-01-000000.json`. It forwarded every other file from evidence commit [`2648c417…`](https://raw.githubusercontent.com/academiaseul/qwatt-evidence/2648c417f91436622290283be5b1430a539e9921/rehearsal-2026-11-09/index.json), and the real verifier code judged the live proposal. | **Refused** with `verifier.not_published`. Nothing was signed or submitted. | [`I.pending.xdr`](../evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY/I.pending.xdr) · [`I.refusals.jsonl`](../evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY/I.refusals.jsonl) |
| **C** · proposer + verifier | The verifier service, restarted, co-signed that same proposal | **Anchored** at 22:00:17, ledger 5,647,595, memo `QW#0`. It carries two signatures, proposer and verifier, checked with Ed25519 against both keys on 10 Nov. | [`d75c10d7…`](https://stellar.expert/explorer/testnet/tx/d75c10d78fa0dace388c4155e87e243d75bd32e3eb4ca43effea4e46fc55d86a) · [Horizon](https://horizon-testnet.stellar.org/transactions/d75c10d78fa0dace388c4155e87e243d75bd32e3eb4ca43effea4e46fc55d86a) · [`C.transaction.json`](../evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY/C.transaction.json) |

- **D as built:** the SOW words test D as "evidence altered after the verifier's read". As built (`anchor/tests-abcd.js` `testD`), the batch is altered after the proposer signed, and the verifier refuses it on its own read. Either way, nothing anchors. Freeze v3 §2, row V3-4, records this.
- **The withheld batch was public all along:** it is public at that evidence commit, with hash `b5efc27a…`. That is the hash the proposal anchors and test C put on chain. Withholding it on the verifier's only input path was enough to stop the signature. This is the DV-7 method, and the public feed was never touched.
- **A and B cannot be re-submitted today.** Their timebounds ended at 22:45:25 UTC on 9 Nov, so Horizon would now answer `tx_too_late`. The recorded answers above are the evidence.
- **Also tested in CI:** the A–D tool and the thresholds are tested on every CI run, and so are the transaction builder, the stellar-cli signing and the recovery. [CI run #257](https://github.com/academiaseul/QWATT/actions/runs/42599535094) on `9ee4646` (push to `main`, Mon 9 Nov) succeeded.

## The first anchor at 2/2/3 with the three sprint keys (Sat 7 Nov)

[`13457b4b27fbfbe0743c6ff3664c0f89427bf3659f683df522799ff3fe14a9a8`](https://stellar.expert/explorer/testnet/tx/13457b4b27fbfbe0743c6ff3664c0f89427bf3659f683df522799ff3fe14a9a8) · [Horizon](https://horizon-testnet.stellar.org/transactions/13457b4b27fbfbe0743c6ff3664c0f89427bf3659f683df522799ff3fe14a9a8)

- **When and where:** Sat 7 Nov 2026 at 23:43:32 UTC (20:43 Chile time, Day 20), ledger 5,614,274, account `GBIT…HFC2`, memo `QW#0`.
- **Who signed:** proposer and verifier, checked with Ed25519.
- **Why it is the first:** it is the first anchor on an account at 2/2/3 holding the proposer's, the verifier's and the off-team third signer's keys.
- **Earlier anchors:** a two-signature anchor already landed on 8 Oct 2026, in prior work: [`494e8d12…`](https://stellar.expert/explorer/testnet/tx/494e8d12cc3ab7b4f62a7f061a1e899c45e8b4553539346a0e71c8f5c525a8a1), on a throwaway account at 1/2/3 with throwaway keys ([`evidence/rehearsal/rehearsal-2026-10-08T20-46-13-037Z.json`](../evidence/rehearsal/rehearsal-2026-10-08T20-46-13-037Z.json)).
- **What the rest of that rehearsal did** (DV-12, freeze v3 §9, Mon 9 Nov):
  - refused tests B, D and I and anchored test C, the transaction above;
  - did not run test A, the stand-in drill, the kill tests or the go/no-go.
- **What is public, and what is not:** that rehearsal's test files are not in the repository. Its 24 anchors and its verifier log ([`rehearsal-2026-11-07/decisions.jsonl`](https://raw.githubusercontent.com/academiaseul/qwatt-verifier-log/main/rehearsal-2026-11-07/decisions.jsonl), 24 signed) are public. The tests of Mon 9 Nov replace it.

## Live run anchors (from Tue 10 Nov)

**The run.** [`run/faults.json`](https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/run/faults.json) was public before the start. It declares:

- `run_start` `2026-11-10T03:00:00.000Z` and `run_end` `2026-11-17T03:00:00.000Z` (Tue 10 Nov 00:00 to Tue 17 Nov 00:00 Chile time), 7 days;
- `code_commit` `9ee46466255fb21da12531d0b54e3e451b0fea7e`;
- the label "Simulated input · assurance A0 · Stellar testnet";
- the three signer keys;
- eight faults, Wed 11 to Mon 16 Nov (Deliverable 4).

**Anchors so far.** By 20:54 UTC on Tue 10 Nov there were 17 anchors, one per hourly batch. Each was signed by proposer + verifier: Ed25519 over the transaction hash, checked against the three keys. None was a stand-in and none was signed by another pair.

| QW# | Transaction | Ledger | UTC |
|---|---|---|---|
| 0 | [`31b723146869494fdb21ee613d55f1f5ba090d562afc6b7bce4c1072d2890856`](https://stellar.expert/explorer/testnet/tx/31b723146869494fdb21ee613d55f1f5ba090d562afc6b7bce4c1072d2890856) | 5,651,924 | 04:01:02 |
| 1 | [`56165fb8c88508c25dd11daa64edbbeb971558f96e9d5e0c119838d7559a8ccb`](https://stellar.expert/explorer/testnet/tx/56165fb8c88508c25dd11daa64edbbeb971558f96e9d5e0c119838d7559a8ccb) | 5,652,644 | 05:01:02 |
| 2 | [`4e7b5a98f77c568ca773ffbb38791a9df191a760953a207702d1b0f80af410ec`](https://stellar.expert/explorer/testnet/tx/4e7b5a98f77c568ca773ffbb38791a9df191a760953a207702d1b0f80af410ec) | 5,653,364 | 06:01:02 |
| 3 | [`fdbf469050093dd20052f34a09efdc58c747ce537e7bde4264ee1e31191c7f7e`](https://stellar.expert/explorer/testnet/tx/fdbf469050093dd20052f34a09efdc58c747ce537e7bde4264ee1e31191c7f7e) | 5,654,085 | 07:01:07 |
| 4 | [`3f881d0b93e2cdadafb556826bd8799bde163fb8e55fed407ec8dcc4cc46db99`](https://stellar.expert/explorer/testnet/tx/3f881d0b93e2cdadafb556826bd8799bde163fb8e55fed407ec8dcc4cc46db99) | 5,654,805 | 08:01:07 |
| 5 | [`7b8df71f569c4f66022cb7b71083ef815767e2a2bd81745d44e17d58c405450e`](https://stellar.expert/explorer/testnet/tx/7b8df71f569c4f66022cb7b71083ef815767e2a2bd81745d44e17d58c405450e) | 5,655,525 | 09:01:07 |
| 6 | [`61f01701ef70f6ef3d4f5ae70e8aafee9123cdec3185eab7ba771b974cfb95fb`](https://stellar.expert/explorer/testnet/tx/61f01701ef70f6ef3d4f5ae70e8aafee9123cdec3185eab7ba771b974cfb95fb) | 5,656,245 | 10:01:08 |
| 7 | [`bd78f34b3556e94a060cc66bfc680963178cffdb3144502cac0e592faf7ca604`](https://stellar.expert/explorer/testnet/tx/bd78f34b3556e94a060cc66bfc680963178cffdb3144502cac0e592faf7ca604) | 5,656,966 | 11:01:13 |
| 8 | [`1d83f4ac362c2d7ae56e092d3361d7ab20aafafb297339c3825e4563631e17ec`](https://stellar.expert/explorer/testnet/tx/1d83f4ac362c2d7ae56e092d3361d7ab20aafafb297339c3825e4563631e17ec) | 5,657,686 | 12:01:13 |
| 9 | [`ab0e8ad542e883df31b4d77ab6a90cba06c12989432fd542a7d819d1e05389a2`](https://stellar.expert/explorer/testnet/tx/ab0e8ad542e883df31b4d77ab6a90cba06c12989432fd542a7d819d1e05389a2) | 5,658,406 | 13:01:13 |
| 10 | [`4313c1256d28d13f3d2b3b8492486c5c3277f9a44825e89aa36ad4c8568dc416`](https://stellar.expert/explorer/testnet/tx/4313c1256d28d13f3d2b3b8492486c5c3277f9a44825e89aa36ad4c8568dc416) | 5,659,127 | 14:01:18 |
| 11 | [`7540e49d748511203e51ef320c9b42fe29573a6435c13c6b7cc8951d6ded103d`](https://stellar.expert/explorer/testnet/tx/7540e49d748511203e51ef320c9b42fe29573a6435c13c6b7cc8951d6ded103d) | 5,659,847 | 15:01:18 |
| 12 | [`9d6fcbf12d4c188a8438d05e67e951382931bec1bcacd43658f858fbd0fb9e3f`](https://stellar.expert/explorer/testnet/tx/9d6fcbf12d4c188a8438d05e67e951382931bec1bcacd43658f858fbd0fb9e3f) | 5,660,568 | 16:01:23 |
| 13 | [`19642090b6d651da748db4b66941ae9e03c84515e30749ba840d6b4f894a6202`](https://stellar.expert/explorer/testnet/tx/19642090b6d651da748db4b66941ae9e03c84515e30749ba840d6b4f894a6202) | 5,661,288 | 17:01:23 |
| 14 | [`5be780a3ee28a144300eb92650619a3f084f128c96d86553d70b6620304e9730`](https://stellar.expert/explorer/testnet/tx/5be780a3ee28a144300eb92650619a3f084f128c96d86553d70b6620304e9730) | 5,662,008 | 18:01:23 |
| 15 | [`6db6a88756635bbfea8e95cc9c0907d40328eeadffe1039dc8c6f6e30d5d7b6f`](https://stellar.expert/explorer/testnet/tx/6db6a88756635bbfea8e95cc9c0907d40328eeadffe1039dc8c6f6e30d5d7b6f) | 5,662,728 | 19:01:23 |
| 16 | [`70e3f82048cc2390997e533b7bc0d650b7bc98e8a3b500cbde66d25314d695ea`](https://stellar.expert/explorer/testnet/tx/70e3f82048cc2390997e533b7bc0d650b7bc98e8a3b500cbde66d25314d695ea) | 5,663,449 | 20:01:28 |

- **Reconciliation:** `node anchor/reconcile-cli.js` at `main`, run at 20:54 UTC against the run's feed and account, printed **RECONCILED**:
  - evidence read at `academiaseul/qwatt-evidence@840f8a4`;
  - the account at 2/2/3, master weight 0, three signers;
  - "17 proposer+verifier · 0 stand-in (proposer+third) · 0 other";
  - 17 batches published and 17 anchored;
  - 620,035 mWh both published and anchored;
  - 1 rejected interval.
- **One anchor by hand:** batch `qwatt-chispa-01-000016`, downloaded from the feed and rehashed with `protocol/evidence.js`, gives `3254f8c0…`, the `qwatt.anchor.sha256` of QW#16.
- **Verifier log:**
  - [`run/decisions.jsonl`](https://raw.githubusercontent.com/academiaseul/qwatt-verifier-log/main/run/decisions.jsonl) has 17 `signed` decisions for the run, from 04:00:57 UTC. The `pending_tx_hash` of each is the hash Horizon shows for that anchor.
  - [`run/status.json`](https://raw.githubusercontent.com/academiaseul/qwatt-verifier-log/main/run/status.json) shows `signed` 42 (17 + 25 from the rehearsals; [below](#found-when-the-run-was-armed-mon-9-nov)) and `refused` 0.
  - There is no `run/refusals.jsonl` yet, because nothing has been refused.
- **First rejection, the expected dawn refusal:**
  - **What:** the interval 09:45–09:50 UTC (06:45 Chile time), in batch `qwatt-chispa-01-000006`, refused with `plausibility.energy_power`.
  - **Where it is published:** in [`run/ledger/rejected.jsonl`](https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/run/ledger/rejected.jsonl), with its reason and raw lines.
  - **Expected:** it is the first entry of `live/expected-run.json` at `9ee4646`, a dawn refusal from G0's relative tolerance listed before the run (OD-9).
  - **The batch:** batch `000006` was anchored as QW#6.

## Not done, or not as the SOW says

- **Stand-in drill (V3-13; [`docs/THIRD-SIGNER.md`](THIRD-SIGNER.md) step 6): not done.**
  - The third signer's computer was prepared at `9ee4646`. Run once at 22:14:50 UTC on Mon 9 Nov, it recognised the identity `qwatt-third`, answered `idle` (there was no new proposal) and signed nothing.
  - No anchor signed by proposer + third signer has been made on any 2/2/3 account. The founders stopped the rehearsal to arm the run in time.
  - During the run, a stand-in anchor is used only for a real verifier outage, never as a drill. The reconciliation would mark it STAND-IN.
  - The code path is tested in CI against a simulated network only ([PR #47](https://github.com/academiaseul/QWATT/pull/47)).
- **Kill tests (V3-13): not done.** These were planned on each service, each host, the network, a tampered batch, an expired proposal and the watchdog. Restart behaviour rests on the unit settings, on the recovery tests in CI and on the earlier rehearsals.
- **The go decision.** Both founders decided to go on Mon 9 Nov at about 19:20 Chile time, knowing the stand-in drill and the kill tests had not been done. This is recorded in the freeze v3 §9 status note of Tue 10 Nov ([PR #67](https://github.com/academiaseul/QWATT/pull/67), merged Tue 10 Nov).
- **"Third signer key held off-team, designated at kickoff": the designation at kickoff was not met.**
  - The signer whose key is used was found in week 3, not designated at kickoff. Week 1's changelog called a signer confirmed, and week 3's changelog corrects that wording (`CHANGELOG.md`, week 3).
  - The public key arrived on Thu 5 Nov (Day 18), "four days late" against the week-2 goal (`CHANGELOG.md`, week 3).
  - The account waited for it: the 2/2/2 fallback with only the team's two keys was withdrawn on Sun 25 Oct and never used. Every account above was created with all three keys.
  - The other half of the requirement is met: the key is held off-team.
- **Rehearsal of Sat 7 Nov:** test A did not run, and the rehearsal's test files were not published. The tests of Mon 9 Nov replace it.
- **Setup evidence files for the run account:** there is no folder in the repository at `4e56a1f`. The same is true for the unused account `GBQF…GSX5`, whose files DV-10 says are "published with the run account's tests A–D". Their setup and funding transactions are public on testnet and linked above.

## Found when the run was armed (Mon 9 Nov)

Both items are recorded in the freeze v3 §9 status note of Tue 10 Nov ([PR #67](https://github.com/academiaseul/QWATT/pull/67)). The cause of the first is corrected by the note of Wed 11 Nov 2026 ([PR #70](https://github.com/academiaseul/QWATT/pull/70), awaiting approval).

- **The verifier was not running on Mon 9 Nov from 19:30:04 to 20:18:16 Chile time (22:30–23:18 UTC).**
  - **When it came back:** it was started again by command at 23:18:16 UTC, which is the `started_at` in `run/status.json`.
  - **Effect:** none on the run. The stop fell before the start (03:00 UTC Tue 10 Nov), so no batch waited on it.
  - **Cause:** a manual stop on the verifier host, by mistake, recorded in the note of Wed 11 Nov ([PR #70](https://github.com/academiaseul/QWATT/pull/70)). It corrects the Tue 10 note, which said the cause was not established.
  - **Alert:** the watchdog raised `VERIFIER_SILENT` at 20:18:19 and cleared it at 20:23:23.
  - **During the run:** the watchdog and the check from outside both hosts would report such a stop. That check was configured on Tue 10 Nov, and its first run with the run's settings is [#329](https://github.com/academiaseul/QWATT/actions/runs/42879802937) (18:53 UTC, success).
- **The run's verifier log begins with 25 decisions from the rehearsals.**
  - **What they are:** 24 from `rehearsal-2026-11-07` and 1 from `rehearsal-2026-11-09` (test C). The run's own decisions start at 04:00 UTC on Tue 10 Nov.
  - **Cause:** the command used to empty the verifier's state directory before the rehearsals and before arming deleted nothing. The operator's shell could not read that directory, so the `*` did not expand.
  - **Effect on signing:** none. The walk and the reconciliation judge the run's own feed and account, and every run anchor reconciles.
  - **Telling them apart:** the 25 lines differ by time and by `feed_commit`, which is not a commit of the run's feed.
  - **Why they stay:** the log only grows (DV-8).
  - **The same cause elsewhere:** the `rehearsal-2026-11-09` log also begins with the 24 decisions of `rehearsal-2026-11-07`.

## Deviations that touch Deliverable 3

| # | What it records | Where |
|---|---|---|
| OD-1 | Thresholds 2/2/3 rather than 1/2/3, so no single key can send any transaction for the account, a BumpSequence included. Decided Wed 21 Oct. | Freeze v3 §5 |
| DV-7 | Tests A–D and I as built: A submits the published proposal; B re-signs the same body; I withholds the batch through a local proxy on one pinned evidence commit. Wording rule: I's batch is never called "unpublished". | Freeze v3 §9; [PR #27](https://github.com/academiaseul/QWATT/pull/27) |
| DV-8 | `status.json` in the verifier log is the one file that is replaced, at most every 5 minutes. The decision and refusal logs only grow. | Freeze v3 §9 |
| DV-10 | The run anchors with `QWATT:GC5F…O3SX` (24 Aug), not the 22 Aug asset, whose treasury key is not available. The run account is `GDSE…4MDC`, and `GBQF…GSX5` is not used. | Freeze v3 §9; [PR #57](https://github.com/academiaseul/QWATT/pull/57) |
| DV-11, DV-12 | Tests A–D run on a separate 2/2/3 rehearsal account with the same keys, because C lands an anchor and the run's chain starts at genesis on its own account (OD-5). The run starts Tue 10 Nov 03:00 UTC (Day 23, the latest start) and lasts 7 days with no soak day. | Freeze v3 §9; [PR #59](https://github.com/academiaseul/QWATT/pull/59) (DV-11), [PR #65](https://github.com/academiaseul/QWATT/pull/65) (DV-12) |

## Known limitations

- **Two of three, not three of three.**
  - Any two keys meet the low and medium thresholds. The proposer and the verifier, both operated by the team, anchor without the third signer, and in normal operation they do.
  - The third signer's key is required for every change to signers or thresholds (high 3), and for a stand-in anchor when the verifier is down.
  - The SOW's §3 says batches anchor when the three parties "agree". Its Deliverable 3 sets a medium threshold of 2-of-3, so freeze v3 §3 reads that as any two of the three.
- **The network counts weight, not which pair signed.** The reconciliation checks each anchor's signatures:
  - proposer + verifier is normal;
  - proposer + third signer is STAND-IN;
  - any other pair is BROKEN.
- **What a signature means.** It says a published batch re-derives under the published rules. It does not say that a meter measured it. The input is simulated, at assurance A0.
- **The verifier host is a personal computer under WSL2,** operated by a founder. The stop of Mon 9 Nov shows the exposure. The watchdog and the check from outside both hosts are what would report such a stop during the run.
- **Tests D and I are run against the real verifier code, not on the public feed.**
  - D alters the batch in memory.
  - I withholds the batch through a local proxy (DV-7).
- **The verifier's walk reads at most 168 batches,** one week of hourly batches. A longer walk is refused with its own code, `verifier.walk_too_long`, and is judged again.
- **Key loss.**
  - With one key lost, anchoring continues, but the signer set can never change.
  - With two keys lost, anchoring stops, and recovery means a new account.
  - Each paper backup was tested once, in the backup drill of Fri 6 Nov.

## Needs a founder decision

1. **Status of Deliverable 3 in the SOW checklist.** All five §6 evidence items are now public, so PRESENT is proposed. The disclosures would be: the third signer was not designated at kickoff, and the stand-in drill was not done. The other option is PARTIAL.
2. **The verifier stop of Mon 9 Nov.** Merge the correcting status note ([PR #70](https://github.com/academiaseul/QWATT/pull/70)) before this document, so that public text states the cause only after the freeze record does.
3. **The `VERIFIER_SILENT` times** (raised 20:18:19, cleared 20:23:23) come from the verifier host's watchdog log; the log lines for the stop and the restart are quoted in [PR #70](https://github.com/academiaseul/QWATT/pull/70).
4. **Wording of "first 2-of-3 anchor".**
   - Proposed public wording: "the first anchor on a 2/2/3 account with the sprint's three keys" (`13457b4b…`, 7 Nov).
   - A two-signature anchor on a throwaway 1/2/3 account already landed on 8 Oct, in prior work.
5. **Setup evidence for the run account, and for `GBQF…GSX5`.** DV-10's sentence is not carried out at `4e56a1f`. Either publish the evidence folders, or record that they were not published.
6. **Commit this page** as `docs/DELIVERABLE-3-EVIDENCE.md` through a pull request.

## Reproduce

```bash
git clone https://github.com/academiaseul/QWATT.git && cd QWATT     # main

# The account as the network reports it: thresholds 2/2/3, three signers of weight 1, master weight 0
curl -s https://horizon-testnet.stellar.org/accounts/GDSEQAD3B5YTX3TYA6L3U65X6IGAGET67OHQFMKNC4O5AJFVEIVL4MDC

# The reconciliation (needs no install): RECONCILED, the signer pair of every anchor, published vs anchored totals
node anchor/reconcile-cli.js --feed https://raw.githubusercontent.com/academiaseul/qwatt-evidence/main/run \
  --account GDSEQAD3B5YTX3TYA6L3U65X6IGAGET67OHQFMKNC4O5AJFVEIVL4MDC

# Tests A–D and I: the verdict, then every file against its SHA-256 in index.json
cd evidence/rehearsal/2026-11-09-abcd/GCJ5LL6TWH27SEP7BE73TOKKKRSMZGMFY3H6YR7GBDRVSUH4KSPUE4GY
node -e "console.log(require('./abcd.json').verdict)"                     # PASS
sha256sum A.envelope.xdr A.horizon.json B.envelope.xdr B.horizon.json C.transaction.json D.pending.xdr I.pending.xdr I.refusals.jsonl abcd.json account.json setup.horizon.json setup.signed.xdr setup.unsigned.xdr
cd -

# One anchor by hand: the batch's hash, then the anchor's operations (tx_hash is in run/anchored/<batch_id>.json)
git clone https://github.com/academiaseul/qwatt-evidence.git ../qwatt-evidence
node -e "console.log(require('./protocol/evidence').batchSha256(require('../qwatt-evidence/run/batches/qwatt-chispa-01-000016.json')))"
curl -s "https://horizon-testnet.stellar.org/transactions/70e3f82048cc2390997e533b7bc0d650b7bc98e8a3b500cbde66d25314d695ea/operations"
```
