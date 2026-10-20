# QWATT — ensayo acelerado: 48 h simuladas en 4 min 18 s (testnet, cuentas desechables, feed local, datos simulados)

Generated 2026-10-08T22:09:00.118Z from public data only: Horizon (`https://horizon-testnet.stellar.org`) and the evidence feed (`http://127.0.0.1:8767`). Reproduce: `node ops/writeup.js --feed http://127.0.0.1:8767 --account GB2QTJRIMRGJDBAJ2PI7PQ74ZNVVXCRDOBKAZA6ZASRYCSTNNRXMX3HU`.

## Result

- Reconciliation verdict: **RECONCILED** — [run it yourself in the browser](https://qwatt.org/reconcile.html?feed=http%3A%2F%2F127.0.0.1%3A8767&account=GB2QTJRIMRGJDBAJ2PI7PQ74ZNVVXCRDOBKAZA6ZASRYCSTNNRXMX3HU) or `node anchor/reconcile-cli.js --feed http://127.0.0.1:8767 --account GB2QTJRIMRGJDBAJ2PI7PQ74ZNVVXCRDOBKAZA6ZASRYCSTNNRXMX3HU`.
- **48** batches published (48 accepted, 0 rejected) · **48** anchored through 2-of-3 multisig in 48 transactions.
- First anchor 2026-10-08T21:38:07Z · last anchor 2026-10-08T21:42:02Z.
- Energy anchored (cumulative): **1.107 kWh** · published: 1.107 kWh.
- Intervals refused by the gates: **6** — `plausibility.energy_power` ×2, `agreement.diverge` ×4.
- Anchoring account: [`GB2QTJRIMRGJDBAJ2PI7PQ74ZNVVXCRDOBKAZA6ZASRYCSTNNRXMX3HU`](https://stellar.expert/explorer/testnet/account/GB2QTJRIMRGJDBAJ2PI7PQ74ZNVVXCRDOBKAZA6ZASRYCSTNNRXMX3HU) — three signers of weight 1, thresholds 1/2/3, master weight 0.

## Multi-party authorization: tests A–D

Evidence file: `evidence/rehearsal/rehearsal-2026-10-08T20-46-13-037Z.json` · anchoring account [`GAYA2PZSQJTHHXZPB2ZD6LO3C75GOLSI3T4PZNSSYOEL4FNWFK27CYET`](https://stellar.expert/explorer/testnet/account/GAYA2PZSQJTHHXZPB2ZD6LO3C75GOLSI3T4PZNSSYOEL4FNWFK27CYET)

| Test | Signatures | Expected | Network / verifier result | Transaction |
|---|---|---|---|---|
| A | proposer signs alone | refused by the network | `tx_failed` / ops `op_bad_auth, op_success, op_success` | envelope in the evidence file (never landed in a ledger) |
| B | verifier signs alone | refused by the network | `tx_failed` / ops `op_bad_auth, op_success, op_success` | envelope in the evidence file (never landed in a ledger) |
| C | proposer + verifier | anchored | success | [`494e8d12cc…25a8a1`](https://stellar.expert/explorer/testnet/tx/494e8d12cc3ab7b4f62a7f061a1e899c45e8b4553539346a0e71c8f5c525a8a1) |
| D | batch altered after the proposer signed | verifier refuses, nothing anchors | `verifier.hash_mismatch` | no transaction (by design) |
| L | third signer + verifier (liveness) | anchored | success | [`9851ba7ec2…758715`](https://stellar.expert/explorer/testnet/tx/9851ba7ec2743b6e7a4e22e5da9915e1dd7c499ccfdfe4e216a02365a3758715) |

A, B and C are the **same transaction body**: Stellar transaction hashes exclude signatures. The identical transaction was refused with one signature and accepted with two. A and B are therefore cited by envelope and result code, never by hash (their hash resolves to C).

## Fault injections during the live run

Coverage: **576 of 576** five-minute intervals judged · 0 gap(s) · 0 duplicate(s). Audit verdict: **OK**.

| Fault | Window (UTC) | Expected reason | Intervals refused | Status |
|---|---|---|---|---|
| F01-shaded_sensor | 2026-11-04 16:05 → 16:25 | `agreement.diverge` | 4/4 | refused as expected |

## Every anchoring transaction

Each row: the batch, the hash recomputed from the published file (equal to the value the transaction carries in `qwatt.anchor.sha256`), and the transaction that anchored it.

| Seq | Batch | Window (UTC) | Energy (Wh) | Refused intervals | Batch SHA-256 | Ledger | Transaction |
|---:|---|---|---:|---:|---|---:|---|
| 0 | `bench-santiago-000000` | 2026-11-03 03:00 → 04:00 | 0.000 | 0 | `a908bb0f9561b06e…` | 5094380 | [`a28787643c…ca5a20`](https://stellar.expert/explorer/testnet/tx/a28787643c08e0c3a7bc2f79f0f3002b38dc21695d6a4051d29d1a7a46ca5a20) |
| 1 | `bench-santiago-000001` | 2026-11-03 04:00 → 05:00 | 0.000 | 0 | `8f341aa80515f57b…` | 5094381 | [`97e2e79736…7bc6af`](https://stellar.expert/explorer/testnet/tx/97e2e79736eb3e9f0adc66c8b849fb0b2a6ad1bc7dff2f5cf6931c24447bc6af) |
| 2 | `bench-santiago-000002` | 2026-11-03 05:00 → 06:00 | 0.000 | 0 | `7bc0cd1560e45488…` | 5094382 | [`d84a7f2e75…bb84bd`](https://stellar.expert/explorer/testnet/tx/d84a7f2e758d4f2f2e39ab22530f0bb182a5938eb57c1675f9c751e7e5bb84bd) |
| 3 | `bench-santiago-000003` | 2026-11-03 06:00 → 07:00 | 0.000 | 0 | `80bc547c4f18c311…` | 5094383 | [`c0efb8133d…1057e7`](https://stellar.expert/explorer/testnet/tx/c0efb8133dae1bcaa8baf62032ee8aba41e22224b083af192f52561eb61057e7) |
| 4 | `bench-santiago-000004` | 2026-11-03 07:00 → 08:00 | 0.000 | 0 | `fa7aad6c2d3ccb19…` | 5094384 | [`d64623f01c…144be7`](https://stellar.expert/explorer/testnet/tx/d64623f01c902e600cbcf81387b982ba8df118b6cc565b58fd1df0ff81144be7) |
| 5 | `bench-santiago-000005` | 2026-11-03 08:00 → 09:00 | 0.000 | 0 | `834597a2dff27c64…` | 5094385 | [`be29c66727…445d60`](https://stellar.expert/explorer/testnet/tx/be29c66727fa21b2ab29fa9237cb3aab3610ba117a3f1aa5ac19994050445d60) |
| 6 | `bench-santiago-000006` | 2026-11-03 09:00 → 10:00 | 0.054 | 0 | `c9121729a4a0744e…` | 5094386 | [`3bc125a33c…af4f71`](https://stellar.expert/explorer/testnet/tx/3bc125a33c128c8118e258eb5e23bdf1d3a71f6168d9ad5bd2bc9b5cf7af4f71) |
| 7 | `bench-santiago-000007` | 2026-11-03 10:00 → 11:00 | 10.178 | 0 | `0328d1db8c692417…` | 5094387 | [`c11de5ab80…93dd2c`](https://stellar.expert/explorer/testnet/tx/c11de5ab80bcf763d5090092c1ffa0888cbd0e7ca4afed4e77e82ae90b93dd2c) |
| 8 | `bench-santiago-000008` | 2026-11-03 11:00 → 12:00 | 31.631 | 0 | `edf562a8376c7072…` | 5094388 | [`fe6041d570…f786ed`](https://stellar.expert/explorer/testnet/tx/fe6041d570380b09c03678f5abb3bc92a07eddab04455bb8a433de2987f786ed) |
| 9 | `bench-santiago-000009` | 2026-11-03 12:00 → 13:00 | 51.131 | 0 | `4616472ccbb72621…` | 5094389 | [`2d743b35e5…c7c6f7`](https://stellar.expert/explorer/testnet/tx/2d743b35e57db0e87e3a98393d71361bad0926ffbcfc87e9ea9cea7fedc7c6f7) |
| 10 | `bench-santiago-000010` | 2026-11-03 13:00 → 14:00 | 69.158 | 0 | `34e9df2fd6b49e90…` | 5094390 | [`3485c90d77…6760bb`](https://stellar.expert/explorer/testnet/tx/3485c90d774da89ccbd50ea62a388b820d98fb15329ed215bfed43f5076760bb) |
| 11 | `bench-santiago-000011` | 2026-11-03 14:00 → 15:00 | 85.238 | 0 | `96fc507b9fb8792a…` | 5094391 | [`d69b4fa788…c50ed8`](https://stellar.expert/explorer/testnet/tx/d69b4fa78804482a2bd713065d9988132b15a51b049c96a147a0cf5f18c50ed8) |
| 12 | `bench-santiago-000012` | 2026-11-03 15:00 → 16:00 | 93.327 | 0 | `0e67c383c180ea79…` | 5094392 | [`549daa18a9…07d5d0`](https://stellar.expert/explorer/testnet/tx/549daa18a9c31bf956c8bbec2e38a742a28fa413254d51715f0fe14ba107d5d0) |
| 13 | `bench-santiago-000013` | 2026-11-03 16:00 → 17:00 | 101.800 | 0 | `d07b79c1d0b41d0e…` | 5094393 | [`21ea32299d…8e352b`](https://stellar.expert/explorer/testnet/tx/21ea32299d1e7c31fff932bc9828f2e71d3e563dc268113ddb1e8c4eec8e352b) |
| 14 | `bench-santiago-000014` | 2026-11-03 17:00 → 18:00 | 94.039 | 0 | `6a082060f22779b9…` | 5094394 | [`bd7e62974d…3c42f7`](https://stellar.expert/explorer/testnet/tx/bd7e62974deed10ee450cb6e5ce1aa552e6a15abfe989e1bf52de3de033c42f7) |
| 15 | `bench-santiago-000015` | 2026-11-03 18:00 → 19:00 | 89.166 | 0 | `529b0721efb038aa…` | 5094395 | [`07ccd0ca5f…7dfdd1`](https://stellar.expert/explorer/testnet/tx/07ccd0ca5f0b2def180e80740ee2ede074037d4b23c4aab5becdc979b07dfdd1) |
| 16 | `bench-santiago-000016` | 2026-11-03 19:00 → 20:00 | 73.931 | 0 | `8c094ea76b92734b…` | 5094396 | [`cefee4933c…d756e6`](https://stellar.expert/explorer/testnet/tx/cefee4933cabe760608cfdfcb2464274bd2923dedff488bd70dcb62a9ed756e6) |
| 17 | `bench-santiago-000017` | 2026-11-03 20:00 → 21:00 | 54.537 | 0 | `deb3d13c4c9ff097…` | 5094397 | [`83d517b23a…747605`](https://stellar.expert/explorer/testnet/tx/83d517b23a72aede8cf8e3e401b517fd250c8b33b7dd21fd16469d4b06747605) |
| 18 | `bench-santiago-000018` | 2026-11-03 21:00 → 22:00 | 35.522 | 0 | `bd6bfbd2a9a66287…` | 5094398 | [`3f21b0087d…daec58`](https://stellar.expert/explorer/testnet/tx/3f21b0087de0bc3a5aef7352e94c56c94aba84212714a0b71729a0109adaec58) |
| 19 | `bench-santiago-000019` | 2026-11-03 22:00 → 23:00 | 14.492 | 0 | `929903fbbb80a665…` | 5094399 | [`e9dd312f31…e838f9`](https://stellar.expert/explorer/testnet/tx/e9dd312f319486bcfa63980ac06dadaa6ea2861e5e8481cc4ed8ced5ace838f9) |
| 20 | `bench-santiago-000020` | 2026-11-03 23:00 → 00:00 | 0.633 | 1 | `478e910614c57939…` | 5094400 | [`3c1fbd3138…a8c97d`](https://stellar.expert/explorer/testnet/tx/3c1fbd313832f32501425bca730465ab3c54f7dbc2d8d7935c60a89fcea8c97d) |
| 21 | `bench-santiago-000021` | 2026-11-04 00:00 → 01:00 | 0.000 | 0 | `ed46b483545ec2ad…` | 5094401 | [`3f065a7053…f1b7c3`](https://stellar.expert/explorer/testnet/tx/3f065a705323881b769ded1e64bc49f61b5fccfdba3c815e2595372e13f1b7c3) |
| 22 | `bench-santiago-000022` | 2026-11-04 01:00 → 02:00 | 0.000 | 0 | `8f8f7dd01afb6e9a…` | 5094402 | [`6f01702132…af56e7`](https://stellar.expert/explorer/testnet/tx/6f01702132c6c687b5f371825c1e624ed346005b46dfb93486f7d69746af56e7) |
| 23 | `bench-santiago-000023` | 2026-11-04 02:00 → 03:00 | 0.000 | 0 | `fbf0da90a8aef0ba…` | 5094403 | [`c18bfda1ed…f4049a`](https://stellar.expert/explorer/testnet/tx/c18bfda1ed845dae8fabca1172ec55dfcd8758332a93c566e86c56da1cf4049a) |
| 24 | `bench-santiago-000024` | 2026-11-04 03:00 → 04:00 | 0.000 | 0 | `89cdcab8f1264fcf…` | 5094404 | [`2dd5d9062c…04e1c4`](https://stellar.expert/explorer/testnet/tx/2dd5d9062c5ac6231cf8b548e6439439b2e0b1b37120c11c23fee9e6e604e1c4) |
| 25 | `bench-santiago-000025` | 2026-11-04 04:00 → 05:00 | 0.000 | 0 | `1aa30a9d42e04bf4…` | 5094405 | [`c564270fe1…8bf88f`](https://stellar.expert/explorer/testnet/tx/c564270fe1bb45607dc2344543e0458ac36b2ce342295d2eaad36bdb778bf88f) |
| 26 | `bench-santiago-000026` | 2026-11-04 05:00 → 06:00 | 0.000 | 0 | `89a635c60d25ebf3…` | 5094406 | [`4164bd16a2…c61b3c`](https://stellar.expert/explorer/testnet/tx/4164bd16a2365720149ff5c96fd332dd23ff7ac17b74983191e29faa4ac61b3c) |
| 27 | `bench-santiago-000027` | 2026-11-04 06:00 → 07:00 | 0.000 | 0 | `4dffd44b73cb8261…` | 5094407 | [`7036502a53…524130`](https://stellar.expert/explorer/testnet/tx/7036502a536f9a2ad6a1e61eeda98becade154ae5c6bc6aba2fb9bba8e524130) |
| 28 | `bench-santiago-000028` | 2026-11-04 07:00 → 08:00 | 0.000 | 0 | `83b5cc47a0197431…` | 5094408 | [`2ee0996cec…60d3d1`](https://stellar.expert/explorer/testnet/tx/2ee0996cec9fde930c6fadad86832c4da58d915d23d9ff74c03706709d60d3d1) |
| 29 | `bench-santiago-000029` | 2026-11-04 08:00 → 09:00 | 0.000 | 0 | `31cde4496293622a…` | 5094409 | [`cbc767aeda…81a815`](https://stellar.expert/explorer/testnet/tx/cbc767aedaba426e3c059919183e948c6ed0a06895d67f99bd2e1c790181a815) |
| 30 | `bench-santiago-000030` | 2026-11-04 09:00 → 10:00 | 0.019 | 1 | `1d54e316ab8bd8f2…` | 5094410 | [`56b04c6e23…7cbdd6`](https://stellar.expert/explorer/testnet/tx/56b04c6e238045f22c2f07a5a9601e145db7facf59f4d5c8b8a0e34cb57cbdd6) |
| 31 | `bench-santiago-000031` | 2026-11-04 10:00 → 11:00 | 4.359 | 0 | `f3ac6bac2ca09107…` | 5094411 | [`826c03f218…e0093a`](https://stellar.expert/explorer/testnet/tx/826c03f218bdce8c53a148dc579d25b9621109deed4934471237cf26b8e0093a) |
| 32 | `bench-santiago-000032` | 2026-11-04 11:00 → 12:00 | 14.861 | 0 | `1e5dacc141d41533…` | 5094412 | [`8cf318f658…9cd745`](https://stellar.expert/explorer/testnet/tx/8cf318f6586c436ed1fa29aa2bf34e76bccf28bf37bdff9ef29a2158fe9cd745) |
| 33 | `bench-santiago-000033` | 2026-11-04 12:00 → 13:00 | 19.384 | 0 | `30f1e0ba23854362…` | 5094413 | [`4d22214c13…d715ed`](https://stellar.expert/explorer/testnet/tx/4d22214c1346f2e08a67dec8d0bedf756fca6616b1ece809fde59f12fbd715ed) |
| 34 | `bench-santiago-000034` | 2026-11-04 13:00 → 14:00 | 21.220 | 0 | `6163b69d1e74be80…` | 5094414 | [`4b6d34d72a…a672a6`](https://stellar.expert/explorer/testnet/tx/4b6d34d72aeaec56146b6dedc86e600924e863ee417ef6c0382cc38bd7a672a6) |
| 35 | `bench-santiago-000035` | 2026-11-04 14:00 → 15:00 | 29.954 | 0 | `817110c77c5814a6…` | 5094415 | [`e82d7e1f04…2ed58e`](https://stellar.expert/explorer/testnet/tx/e82d7e1f046d80f15789c9347df8b27e98f0c523b4074271abd383e21c2ed58e) |
| 36 | `bench-santiago-000036` | 2026-11-04 15:00 → 16:00 | 33.974 | 0 | `e85aa7c6e129cfc7…` | 5094416 | [`4e627df4c4…59c7a2`](https://stellar.expert/explorer/testnet/tx/4e627df4c40b4ae53e28ebfeae6831a8abafabd9a7c01871819cb5bd6e59c7a2) |
| 37 | `bench-santiago-000037` | 2026-11-04 16:00 → 17:00 | 26.536 | 4 | `094605ee98c91ade…` | 5094417 | [`35f2cacc73…fd62ea`](https://stellar.expert/explorer/testnet/tx/35f2cacc73785090f6b1a39a95513128ae4d16987649e92dde987fa1d0fd62ea) |
| 38 | `bench-santiago-000038` | 2026-11-04 17:00 → 18:00 | 42.647 | 0 | `1fe238a4dba35a5f…` | 5094418 | [`126e6fc5e1…006980`](https://stellar.expert/explorer/testnet/tx/126e6fc5e101a3a325439291b98b60ca4f987ec3a05f058359fb747989006980) |
| 39 | `bench-santiago-000039` | 2026-11-04 18:00 → 19:00 | 39.428 | 0 | `86c54d1c0844c5a9…` | 5094419 | [`86b0df9304…d029a3`](https://stellar.expert/explorer/testnet/tx/86b0df93047d0ed92e51717bde26896e0ffe8f7da042cdb74050619aa7d029a3) |
| 40 | `bench-santiago-000040` | 2026-11-04 19:00 → 20:00 | 28.461 | 0 | `63355c488624a583…` | 5094420 | [`518845d19a…fc7e6a`](https://stellar.expert/explorer/testnet/tx/518845d19a135ca87eeca4f49b0466807cb59b4aa6421658e59c890198fc7e6a) |
| 41 | `bench-santiago-000041` | 2026-11-04 20:00 → 21:00 | 21.109 | 0 | `13eaa7d3e4ba0771…` | 5094421 | [`716d72a7ef…8a8484`](https://stellar.expert/explorer/testnet/tx/716d72a7ef30ee173bf705481064ef252db5e197124794d9305363dd348a8484) |
| 42 | `bench-santiago-000042` | 2026-11-04 21:00 → 22:00 | 14.188 | 0 | `ce443efc1df1e891…` | 5094422 | [`e6bde9e45a…abdc81`](https://stellar.expert/explorer/testnet/tx/e6bde9e45a24b41e59472128bae5b104a5b4b4584b0e79905ab2b9a108abdc81) |
| 43 | `bench-santiago-000043` | 2026-11-04 22:00 → 23:00 | 6.051 | 0 | `0e6e40c273353b76…` | 5094423 | [`38f5ecfe57…2c8a77`](https://stellar.expert/explorer/testnet/tx/38f5ecfe575cadf178aa2ea60cadfcbdf557c1e396b2c4c9776a9c6ead2c8a77) |
| 44 | `bench-santiago-000044` | 2026-11-04 23:00 → 00:00 | 0.343 | 0 | `58aa177b44635ff1…` | 5094424 | [`be36509914…80d347`](https://stellar.expert/explorer/testnet/tx/be36509914745b71cac0137842866a2a096e71f2c8d05a80e568b043e280d347) |
| 45 | `bench-santiago-000045` | 2026-11-05 00:00 → 01:00 | 0.000 | 0 | `6fd9ffe6e74fe611…` | 5094425 | [`d4a4f6f7e9…03b054`](https://stellar.expert/explorer/testnet/tx/d4a4f6f7e9146d8b27c6f5de3459e8d450fec8cb4a0ccb880c1fca819103b054) |
| 46 | `bench-santiago-000046` | 2026-11-05 01:00 → 02:00 | 0.000 | 0 | `b432e26ee206c666…` | 5094426 | [`5e66386da5…155437`](https://stellar.expert/explorer/testnet/tx/5e66386da50b523e1806928e8d095c4522ddec8014945e8c21c47f73b3155437) |
| 47 | `bench-santiago-000047` | 2026-11-05 02:00 → 03:00 | 0.000 | 0 | `ff1e12393c25632b…` | 5094427 | [`ea31ce924c…a02d30`](https://stellar.expert/explorer/testnet/tx/ea31ce924c81f4660bd03dfaf7b4d60d9090b6c31f5f20e248b8abc26fa02d30) |

## How to verify any row without trusting us

1. Download `http://127.0.0.1:8767/batches/<batch_id>.json`.
2. Remove its `sha256` field, serialize with sorted keys and no whitespace (integers only), SHA-256 the UTF-8 bytes.
3. Open the row's transaction: its `qwatt.anchor.sha256` data entry equals your hash, and it carries two signatures.
4. Re-run the gates on every interval in the batch with `assets/qwatt-gates.js` and spec 1.0.0: each one is accepted. Each rejected interval in `ledger/rejected.jsonl` is refused for the reason it states.
