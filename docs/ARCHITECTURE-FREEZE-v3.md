# Architecture freeze v3 — Instawards sprint

**Status: AGREED by both founders on Wed 21 Oct 2026 (Day 3); binding from that date.** Drafted 20 Oct
2026 (Day 2); OD-1 decided 21 Oct (2/2/3). Recorded in the repository on Thu 22 Oct 2026 (§8).
Agreed on Wed 21 Oct 2026 (Day 3), together with the thresholds decision (OD-1: 2/2/3), within the
Days 1–3 that SOW final v4 (September 2026) §5 gives the architecture freeze: schemas, batch definition,
hash rules, adapter and verifier interfaces, transaction format.
**SOW:** every citation of the SOW below is to SOW final v4 (September 2026), the approved statement
of work. Any earlier SOW text in the repository or its history is superseded.
**Amends:** `docs/ARCHITECTURE-FREEZE-v2.md` (which amends `docs/ARCHITECTURE-FREEZE.md`). Both stay
unchanged as the record of what they froze; anything in v2 not changed here still holds. Where the
week-1 code departs from v2's "Batch rules as implemented" (the door order, the window check and
`cumulative_mwh` = previous + `energy_mwh`), §2 records it (V3-2, V3-3, DV-1 to DV-4); v2 is not
edited.
**Calendar:** Day 1 = Mon 19 Oct 2026, Day 30 = Tue 17 Nov 2026. Hosts and evidence run in UTC;
America/Santiago is UTC−3 for the whole sprint. SOW final v4 (September 2026) targets the start of
the live run for day 21, latest day 23 (Deliverable 3), puts the integration freeze on Days 21–22
(§5) and the seven-day run on days 23–30 (Deliverable 4). This plan runs earlier, inside the same 30
days: code freeze Fri 6 Nov (Day 19), start Sat 7 Nov (Day 20), counted window Sun 8 Nov 03:00 UTC
to Sun 15 Nov 03:00 UTC (V3-14).
**Rule:** each change in §2 lands in the week shown, with its test, and is not in force before then.
After the code freeze on Fri 6 Nov (Day 19) only documented defect fixes go in; any later change is
a numbered deviation in the write-up, never a silent edit.
**Scope:** Stellar testnet only. The existing QWATT testnet asset is used only as the anchoring
vehicle. QWATT is not electricity, not an investment, not a security or financial instrument, not a
renewable energy certificate (REC) and not a carbon credit.
**Status notes:** dated notes added after the agreement (OD-2, OD-4, the deviations built in week 2
and a summary of week 2) are in §9. They add to this document and change none of its agreed wording.

> **Resumen.** Adenda v3 a la congelación de la arquitectura, acordada por Jay Kim y Diego Ostertag
> el miércoles 21 de octubre (Día 3), porque la SOW final v4 (septiembre 2026) pone el
> acuerdo de arquitectura en los días 1–3. Se mantiene lo construido: el verificador reconstruye la
> transacción completa, la cuenta de anclaje deja la clave maestra en peso 0, cada anclaje lleva un
> pago marcador de 1 stroop, el procesamiento sobrevive reinicios, el simulador es determinista y el
> conjunto de datos público se juzga con un perfil derivado de 270,7 kWp. Semana 1: antes de
> firmar, el verificador recorre la cadena hasta el último anclaje; se rechazan intervalos
> repetidos, superpuestos, fuera de grilla o de otro sitio, y la energía de un lote rechazado nunca
> entra al total anclado (estaba previsto para la semana 3). Una revisión de esos arreglos agregó
> cinco reglas, también de la semana 1: la referencia de tiempo sale solo del último lote aceptado;
> cada lote anterior se descarga una vez y se recalcula su hash antes de leerlo; la entrada rechaza,
> línea por línea, intervalos superpuestos o de otro nodo; la entrada HTTP escribe cada instante de
> una sola forma, y el proponente hace el mismo recorrido que el verificador antes de proponer, con
> un límite que tiene su propio código de motivo y que el operador puede ampliar. S1, S2 y esa
> revisión entran como tres PR apilados. Semana 2: cuenta real 2 de 3 con tercer firmante externo
> y umbrales 2/2/3, pruebas A–D y `samples_root`. Semana 3: un rechazo del verificador es
> definitivo; congelación del código el viernes 6 de noviembre (Día 19). La corrida arranca el
> sábado 7 (Día 20) y se cuenta desde el domingo 8 de noviembre, 00:00 de Santiago (03:00 UTC),
> hasta el domingo 15: antes de los días 23–30 que fija la SOW, y dentro de sus 30 días.
> Los dos fundadores decidieron el miércoles 21 de octubre los umbrales de la cuenta de anclaje:
> 2/2/3 (bajo 2, medio 2, alto 3; opción B de OD-1). Así ninguna clave sola, ni siquiera una de las
> nuestras, puede enviar transacciones de la cuenta, y por lo tanto tampoco anclar una constancia;
> pero el proponente y el verificador, ambos del equipo, bastan sin el tercer firmante. Si la cuenta
> se crea antes de que llegue la clave del tercer firmante, parte con las dos claves del equipo y
> umbrales 2/2/2. Cada rechazo queda en la bitácora de rechazos pública. La entrada es simulada y
> todo ocurre solo en Stellar testnet: la corrida prueba el software y los filtros de verificación,
> no que una instalación física haya producido energía.
>
> *Nota fechada (viernes 30 de octubre de 2026, Jay Kim y Diego Ostertag).* No se usó la
> alternativa 2/2/2: se retiró el domingo 25 de octubre (correo de decisiones de la semana 2,
> punto 2). La cuenta se crea solo con las tres claves públicas; si la clave del tercer firmante se
> atrasa, la cuenta espera y los dos fundadores escriben juntos una desviación numerada. Las notas
> fechadas, las desviaciones de la semana 2 y un resumen de la semana 2 están en §9.

## 1. What stays frozen from v2

- **Hashing.** Integers only, enforced (D-9); canonical JSON; SHA-256; the `intervals_root` Merkle
  rule. Pinned in `protocol/conformance/batch-cases.json`.
- **Gates.** Spec 1.0.0, G0–G3, thresholds unchanged, Phase-2 gates not wired. Correction to the
  record: since 13 Oct 2026 (before Day 1) the digest is `32dc1cf9a84eaa9b…`, not v1's `056f1b51…`,
  because the `rooftop` profile's name and coordinates were generalized. No threshold changed, and
  the `bench` profile the live run uses is untouched (OD-10).
- **Batches.** Close every 12 judged intervals or on restart; `energy_mwh` = basis energy (the lower
  of the two meters, or the only one) of accepted intervals; a batch with no accepted intervals is
  valid (D-5); every reason code registered (D-7); batch ledger (D-8).
- **Restart-safe pipeline.** Judged lines fsynced before they count; state rebuilt from the feed;
  a batch written before a crash is adopted, not rebuilt.
- **Transaction.** One atomic transaction per accepted batch: `manageData qwatt.anchor.sha256`,
  `manageData qwatt.cumulative_mwh`, a constant marker payment of 0.0000001 QWATT (1 stroop) to a
  fixed account (D-1), memo `QW#<seq>`. **The verifier rebuilds the whole transaction from the
  published batch** and signs only if the hash is identical (`anchor/tx.js`).
- **Roles.** Publish before sign. The proposer signs and never submits. The verifier reads only the
  public feed, Horizon and its public config, and submits. Anchoring is strictly in order; the chain
  is re-read before anything is resent; neither service signs with a clock more than 120 s off the
  network.
- **Account setup** (`anchor/setup-account.js`): a dedicated account (D-2), configured in one
  transaction by a throwaway master key that the same transaction sets to weight 0.
- **Simulator and faults.** `live/simulator.js` is a pure function of seed and time; the fault
  schedule is published as `faults.json` before a run; the ramp fault is caught by G1 (D-10).
- **Dataset.** NREL PVDAQ system 4902 is judged at its own site with the named profile
  **`pvdaq-4902`** (derived from `rooftop`; 270.7 kWp; AC/DC floor 0.88, not tuned, B-4), pinned by
  the SHA-256 of `datasets/pvdaq-4902-2017-09/dataset.json` (`835814d9…`). It is not part of the
  gate spec and judges only the scale test.
- **Also unchanged:** MIT licence (D-11); the rehearsal findings (tests A, B and C share one hash, so
  A and B are cited by envelope and result code). Out of the freeze: Phase-2 gates, Soroban,
  hardware, mainnet, any use of the asset beyond anchoring.

## 2. Changes from v2

*Ref.* is the founders' tracking label (S = code review of 12 Oct 2026, F = sprint-plan decision).

### Week 1 · 19–25 Oct (due Fri 23 Oct)

| # | Ref. | Change | Why |
|---|---|---|---|
| V3-1 | S1 | **Walk back to the on-chain head before signing.** From the candidate batch, follow `prev_hash`, rehashing each batch, to the batch whose hash is the account's `qwatt.anchor.sha256`; then re-add the totals: the candidate adds its energy, every batch between it and the head was never anchored and must carry the total forward unchanged (V3-3), and the head's `cumulative_mwh` must equal `qwatt.cumulative_mwh`. With nothing anchored, the walk ends at seq 0 with `prev_hash` of 64 zeros and the totals start from zero. A mismatch is refused with `verifier.head_mismatch`; a walk that reaches its bound (168 batches by default) before the head stops with its own code, `verifier.walk_too_long` (DV-5). The verifier runs it before co-signing (`anchor/chain.js` `walkToHead`, called from `anchor/verifier.js` `_tick`), and since DV-5 the proposer runs the same walk over its own feed before proposing (`anchor/proposer.js` `tick`). When Horizon lags, the walk is judged against a stale head; the guarantee then rests on the sequence check in `_tick` (the proposal's sequence must be the head's plus one) together with Stellar's rule that an account's sequence only moves forward, so whatever is co-signed on a stale head cannot land (`tx_bad_seq`). Tests in `anchor/recovery.test.js`. | Today the previous batch's claimed hash and total are trusted, so an altered previous batch could put an inflated cumulative on the ledger. |
| V3-2 | S2 | **Cross-batch checks**, in `verifyBatch` and at the door: canonical timestamps (`toISOString` form); `ts_start` on the `dt_s` grid and `ts_end = ts_start + dt_s`; each interval starts at or after the previous one ends, within a batch and after the last accepted batch (DV-1); `site_id` and `node_id` match the batch and the last accepted batch. Refused with registered reasons: `ingest.off_grid` at the door (`batch/assemble.js` `judge`); `batch.interval_repeated`, `batch.interval_overlap`, `batch.interval_off_grid`, `batch.site_mismatch` and `batch.window_mismatch` in `batch/verify.js` `verifyBatch`. Tests in `batch/batch.test.js`. | Today order is checked only inside a batch, so a batch rebuilt from the previous batch's intervals verifies and the same energy could count twice. |
| V3-3 | F6 | **A batch published as rejected carries no energy; the anchored cumulative is the energy of accepted batches only.** Moved from week 3 and built in week 1. A batch that fails the proposer's self-check is published with the previous `cumulative_mwh` unchanged, then rehashed (`batch/assemble.js` `close`); a batch adopted after a restart is judged the same way (`batch/pipeline.js` `_recover`). `verifyBatch` takes the publication status (`ctx.status`): a rejected batch with any other total fails with `batch.cumulative_mismatch`, and `batch/verify-cli.js` `verifyFeed` reports it. The walk (V3-1) applies the same rule, and the reconciliation (`assets/qwatt-reconcile.js` `reconcile`) is BROKEN unless every batch's cumulative is the energy of the accepted batches up to it. The chain still runs through a rejected batch, as in v2 D-4; only the total changes. A verifier refusal is not covered until V3-11. Tests in `batch/batch.test.js`, `anchor/recovery.test.js` and `batch/reconcile.test.js`. | Under v2 (D-4, and `cumulative_mwh` = previous + `energy_mwh`) a rejected batch's energy entered the total, so the next anchored total included energy that was never anchored. The review of S1 and S2 found a second effect: a batch rejected for carrying intervals already counted still added their energy, so the same energy could count twice. |

**Deviations built in week 1 (DV).** On 20 Oct a review of S1 and S2 found more ways to count the
same energy twice (DV-1 to DV-4), and a final review found that V3-1's bound could stop anchoring
for good (DV-5). All five are closed on branch `semana-1/endurecimiento`. S1, S2 and the hardening
land as three stacked PRs, merged in that order with merge commits before Fri 23 Oct:
`semana-1/s2-misma-energia` sits on `semana-1/s1-total-heredado`, and `semana-1/endurecimiento` sits
on S2. Each branch has exactly two commits of its own: the tests, which fail (red), then the fix
(green). Each deviation departs from V3-1 or V3-2 as first drafted, so it is numbered here instead
of entering silently. The scale test is unchanged: 8,640 intervals, 720 batches, 0 rejected, head
`cb3d1050…`.

| # | Rule, and where it is built | Why (departs from) |
|---|---|---|
| DV-1 | **The floor is the last accepted batch.** The time, node and counted-interval checks of V3-2 run against the last batch published as accepted, never against a rejected one, so a rejected batch never moves the floor and the floor never moves back. `batch/verify.js` `verifyBatch` takes it as `ctx.floor` (a caller that leaves it out gets the previous batch; every caller in the repository passes it). `batch/assemble.js` `BatchAssembler` keeps the last published batch and the last accepted one, and `advance(batch, accepted)` moves the floor only for an accepted batch. `batch/pipeline.js` restores the floor on restart from the last accepted batch at or before the head (constructor) and moves it through `advance` for an adopted batch (`_recover`). `batch/verify-cli.js` `verifyFeed` carries it; `anchor/proposer.js` `tick` and `anchor/verifier.js` `_tick` use the anchored head. Tests in `batch/batch.test.js` and `anchor/recovery.test.js`. | V3-2 as first built judged against the previous published batch, whatever its status. A rejected batch with an earlier window then let an accepted batch be sent again and pass, and a change of `node_id` was refused only in the first batch after it. Now every later batch is refused with `batch.site_mismatch`, so a node-rotation rule is needed before nodes sign. |
| DV-2 | **One rehashed fetch.** Nothing is read from the previous batch or the floor before it rehashes to its own `sha256` (`batch/verify.js` `rehashes`, called by `verifyBatch`; `batch.chain_break` otherwise). The verifier downloads each earlier batch once, in `anchor/chain.js` `walkToHead`, which returns the rehashed previous batch and floor; `anchor/verifier.js` `_tick` judges the batch with `verifyBatch` against exactly those copies and downloads nothing a second time. Tests in `batch/batch.test.js` and `anchor/recovery.test.js`. | V3-1 and V3-2 as first built: the verifier walked the chain and then downloaded the previous batch again for `verifyBatch`, which read its time, node and intervals without rehashing it. A feed could show the walk one batch and the checks another. |
| DV-3 | **The door applies the verifier's rule.** `batch/assemble.js` `judge` refuses an interval from another site or node (`ingest.site_mismatch`) and one that starts before `last_ts_end`, the end of the latest interval that holds time, resumed from the floor on restart and updated in `restore` (`ingest.overlap`). Only that line is refused; its batch is not. `close` builds the window with `toISOString` from the intervals that hold time only: accepted ones, and gate-refused ones no longer than the profile's `interval_max_dt_s`. Lines refused at the door never set it; with none, the window is zero-length at the floor (`1970-01-01T00:00:00.000Z` before anything is accepted). Both codes are registered in `protocol/reasons.json`. Tests in `batch/batch.test.js`. | V3-2 as first built checked overlap and node only at batch level. A meter that changed `dt_s` got an overlapping line through the door, and that line sank its whole batch, whose energy still entered the total before V3-3; a refused line could stretch a window. Keeping gate-refused intervals within `interval_max_dt_s` in the window keeps the scale-test head `cb3d1050…`; a window built from accepted lines only would change it. |
| DV-4 | **Canonical timestamps at the HTTP gateway.** `ingest/adapters/http.js` `canonicalTs` and the `/intervals` handler accept strict RFC 3339 with an offset (nothing finer than a millisecond) and store the `toISOString` form, one spelling per instant. When the spelling changes, the SHA-256 of the request body goes into `source.raw_sha256`; a record still off its `dt_s` grid is answered 400 `ingest.off_grid` (`offGrid` from `batch/verify.js`). `protocol/interval.schema.json` states the canonical form. Test in `ingest/ingest.test.js`. | V3-2 as first built refused other spellings only at the door, after the gateway had answered 202, so an honest meter writing `+00:00` instead of `Z` would have lost every interval without being told. Now the stored form is canonical, the request hash makes the rewrite auditable, and an off-grid sender gets 400 at once. |
| DV-5 | **A bounded walk with its own code, run by both services.** The walk of V3-1 downloads at most `MAX_WALK_BATCHES` earlier batches (168, one week of hourly batches). When it reaches that bound before the head it stops with `verifier.walk_too_long`, a code registered in `protocol/reasons.json` and used only for the bound (`anchor/chain.js` `walkToHead`): the check did not finish, which is not evidence of tampering, so `verifier.head_mismatch` keeps one meaning, a chain that does not lead back to the on-chain head. The proposer runs the same `walkToHead` over its own feed, with the same bound, before proposing; it judges the batch against the copies that walk rehashed and returns `blocked` with the walk's code and detail instead of proposing what the verifier would refuse, and a batch file that differs from its ledger entry blocks it with `verifier.hash_mismatch` (`anchor/proposer.js` `tick`). Operators raise the bound with `--max-walk N` on both CLIs (`anchor/proposer.js` and `anchor/verifier.js` `cli`), or the `maxWalk` option of `Proposer` and `Verifier`; `anchor/chain.js` `checkMaxWalk` and `maxWalkArg` accept only a whole number of batches, at least 1, and a CLI given anything else exits with status 2 before it starts. Every check still runs. `docs/RUNBOOK.md` gains the section "A long run of rejected batches (`verifier.walk_too_long`)", and its `BACKLOG` and `NEW_REFUSAL` rows point to it; `anchor/README.md` describes the bound and the proposer's walk. Tests in `anchor/recovery.test.js`: 168 batches published as rejected (a `node_id` wrong for a week, then put back) block the proposer and make the verifier refuse with `verifier.walk_too_long`, a bound of 168 is still one short, and 169 on both sides anchors with the on-chain total equal to the anchored energy; a proposer bounded at 1 blocks; `--max-walk` parsing and exit; and the lagging Horizon head of V3-1. Four S1 tests are rewritten because the proposer now blocks a forged chain: each checks that it blocks with `verifier.head_mismatch`, then publishes the proposal by hand so the verifier is still tested. | V3-1 as first built refused a walk past 168 batches with `verifier.head_mismatch`, the code for a forged chain, and the proposer did not run the walk. After more than 168 batch-level rejections in a row (since DV-1, a `node_id` changed by mistake rejects every later batch until it is put back) the proposer proposed the same batch every day, the verifier refused it every time, and nothing could anchor again without a code change. |

### Week 2 · 26 Oct – 1 Nov

| # | Ref. | Change | Why |
|---|---|---|---|
| V3-4 | — | **Real 2-of-3 account**, created with `setup-account.js` only once all three public keys exist: three weight-1 signers, one off-team; master weight 0; thresholds 2/2/3 (OD-1: low 2, medium 2, high 3). `setup-account.js` sets 2/2/3 and its `--verify` check requires it, built on branch `semana-1/umbrales-2-2-3`. Tests on it: **A** (proposer alone) and **B** (verifier alone): one signature does not meet the low threshold 2, so the network rejects it with `tx_bad_auth`, with the signed envelope and Horizon's response as evidence, since they never reach a ledger; **C** (both): anchored; **D** (batch altered after the proposer signed): refused with `verifier.hash_mismatch`, nothing anchors; **independence** (batch not published): refused with `verifier.not_published`. | SOW final v4 (September 2026) Deliverable 3, which its §5 schedules for week 3; it moves to week 2 because the batches exist as prior work. So far only throwaway accounts. The SOW words test D as evidence altered after the verifier's read; as built (`anchor/tests-abcd.js` `testD`), the published batch is altered in memory after the proposer signed and the verifier refuses it on its own read. In both, nothing anchors. |
| V3-5 | F7 | **`samples_root` required** (batch schema 1.1.0): the `intervals_root` Merkle rule over the SHA-256 of each raw payload line (CSV row, JSON body or Modbus frame in hex) of every interval judged in the window, in sample order. Lines published at `raw/<batch_id>.jsonl`; the verifier recomputes the root. The scale test is re-run and its new head hash replaces `cb3d1050…`. | v2 D-6 left it optional; SOW final v4 (September 2026) Deliverable 2 lists a Merkle root over raw samples as a batch field. |
| V3-6 | F9 | **`clock_skew_s` on every adapter path**, stamped by the interval builder as receive time − `ts_end`. In fast replay the receive time is the replay clock. | Only the HTTP path stamps it, so G0's clock check never fires on Modbus, CSV or simulator input. |
| V3-7 | F12 | **Two evidence repositories:** `academiaseul/qwatt-evidence`, written only by the proposer host, and `academiaseul/qwatt-verifier-log`, only by the verifier host, each with its own single-repository deploy key and protected branches (no force-push, no deletion). Published files never change, except `index.json` and a pending envelope replaced for the same batch; `.jsonl` only grows. Called a public history, not "append-only". | v2 used a branch of the code repository and served refusals from the verifier's own port. Now the two sides share no credential and no file. |
| V3-8 | F13 | **Keys without a browser.** Each key is generated with stellar-cli on the machine that uses it, the third signer's on their own computer; no secret enters a browser, a chat or a repository. One offline backup per holder, tested once before the freeze by co-signing a throwaway testnet transaction. `setup-account.js` and the runbook switch to stellar-cli. | They point key holders to browser tools today. With high threshold 3, a lost key freezes the signer set. |
| V3-9 | F15 | **Fixed label** "Simulated input · assurance A0 · Stellar testnet" in the run's `faults.json`, on the reconciliation page and in the write-up. The reconciliation fetches signers, thresholds and each anchor's signatures (§3). | Week 1 added the label "Simulated input · Stellar testnet" to the reconciliation page and the write-up; week 2 adds the A0 level, puts it in `faults.json`, and checks "2 of 3" from Horizon instead of printing it. |
| V3-10 | — | **Meter dropouts:** no energy is interpolated across a gap longer than three sample periods, wherever it starts. | A gap that starts off the 5-minute grid is still interpolated over, hiding the dropout. |

Feed layout from week 2 (v2 plus V3-5 and V3-7):

```
qwatt-evidence/<run>/        index.json · faults.json · batches/<batch_id>.json · raw/<batch_id>.jsonl
                             samples/*.csv + samples/manifest.jsonl (SHA-256 per file)
                             ledger/{batches,accepted,rejected}.jsonl · pending/<batch_id>.xdr · anchored/<batch_id>.json
qwatt-verifier-log/<run>/    decisions.jsonl (signed or refused, per batch) · refusals.jsonl · status.json
```

*Deviations built in week 2 (DV-6 to DV-8): §9, status note of Fri 30 Oct 2026.*

### Week 3 · 2–8 Nov (code freeze Fri 6 Nov)

| # | Ref. | Change | Why |
|---|---|---|---|
| V3-11 | F3 | **A verifier refusal is terminal; timebounds at most 60 minutes.** The proposer reads refusals from the public verifier log and proposes the next accepted batch at the same sequence number, so only one envelope per sequence can land. A batch the verifier refuses is never anchored and its energy never enters the anchored cumulative (V3-3 extended to verifier refusals, §4). An unreachable feed, an expired or stale proposal and clock drift are waits, not refusals. The fee is fixed in the public config (OD-6); the verifier also requires exactly one signature on the pending envelope, the proposer's. One pending transaction at a time, as built. | With 24 h timebounds and a proposer that ignores refusals, one refusal stops anchoring at that batch. |
| V3-12 | — | **Clock-error watermark:** an interval refused for a time reason (`plausibility.skew`, `plausibility.order`, `plausibility.dt_mismatch`, or a V3-2 timestamp refusal) advances neither `last_ts_start` nor, since DV-3, `last_ts_end`; a restart rebuilds both by the same rule. | Today one future-dated record makes every later record `ingest.out_of_order` (and, since DV-3, `ingest.overlap`), across restarts. |
| V3-13 | — | **Recovery hardening:** no sample published before its time; restart on failure only; off-host monitoring (dead-man ping, a check from outside both hosts for an anchor in the last 90 minutes, alerts counted as sent only on HTTP 2xx); a third-signer stand-in drill; kill tests on each service, each host, the network, a tampered batch, an expired proposal and the watchdog, with recorded outcomes. | SOW final v4 (September 2026) Deliverable 4 requires recovery logic in place before day 21 (Sun 8 Nov); the code freeze is Day 19. The real-time path has not yet run for 24 hours. |

**V3-14 · Live run.** It starts Sat 7 Nov (Day 20) 00:00 America/Santiago (03:00 UTC) on a fresh
feed and its own account (OD-5); that day is an untouched soak. **Counted window: Sun 8 Nov (Day 21)
00:00 Santiago (03:00 UTC) to Sun 15 Nov 00:00 Santiago (03:00 UTC).** This runs earlier than SOW
final v4 (September 2026), which targets the start of the live run for day 21 (Sun 8 Nov), latest
day 23 (Tue 10 Nov), in Deliverable 3, and places the seven-day run on days 23–30 (Tue 10 Nov to
Tue 17 Nov) in Deliverable 4; the counted window lies inside the SOW's 30 days. If the soak needs a
touch, the window opens Mon 9 Nov (day 22); the latest start that still fits seven days inside the
30 is Tue 10 Nov (day 23). Simulated input, Stellar testnet (§6).

Not adopted from the sprint plan: F4 (envelope template; the full rebuild is stricter), F8 and F10
(re-timed dataset with a derived second meter), and F3's run of several pending transactions. F5 is
the stand-in role in §3.

## 3. What the 2-of-3 multisig guarantees, and what it does not

**Setup.** One dedicated anchoring account with three signers of weight 1: the proposer key
(proposer host), the verifier key (verifier host, another provider, operated by the other founder)
and the third signer's key (a person outside the team). Master weight 0; thresholds 2/2/3 (OD-1):
low 2, medium 2, high 3. Every transaction for the account must meet the low threshold, because the
account pays its fee and supplies its sequence number; anchoring (`manageData` and the marker
payment) needs medium; changing signers or thresholds needs high.

**The network guarantees:**

- **No single key can send any transaction for the anchoring account**, including either team key.
  A one-signature transaction does not meet the low threshold 2, so the network rejects it with
  `tx_bad_auth` and it is never applied (tests A and B): one key cannot anchor, and cannot bump the
  sequence number either. So no single key can anchor alone, which is what SOW final v4 (September
  2026) §2.1 and Deliverable 3 promise: no single key can write a record on its own.
- **Signers and thresholds change only with all three keys.** The team cannot remove the third
  signer, add a key or lower a threshold without them.
- **Each anchor is atomic:** hash, cumulative total and marker payment land together or not at all.

**It does not guarantee:**

- **The third signer's participation in every anchor.** Any two keys meet low 2 and medium 2. The
  proposer and the verifier, both operated by the team, can anchor without the third signer, and in
  normal operation they do. The third signer gives continuity (standing in for the verifier when it is
  down, by running the same verifier code against the public feed) and a non-team key that every
  signer or threshold change requires. SOW final v4 (September 2026) §3 (Objective) says accepted
  batches are anchored only when a proposer, an independent verifier and an off-team third signer
  "agree"; its Deliverable 3 sets medium threshold 2-of-3, so read: any two of the three.
- **Which pair signed.** The network counts weight. The reconciliation therefore checks each
  anchor's signatures: proposer + verifier is normal, proposer + third signer is STAND-IN, anything
  else is BROKEN.
- **That the checks ran, or that the input is true.** A signature says a published batch
  re-derives under the published rules, not that a meter measured it. The public verifier log and
  anyone's own re-run (§7) show whether the checks hold.

Under 1/2/3 (OD-1 option A) one key alone could have signed a low-threshold BumpSequence that
cancels or stalls anchoring; that is why OD-1 chose 2/2/3 (§5). Public wording may therefore say
"no single key can send any transaction for the anchoring account", as well as "no single key can
anchor alone".

**Key loss.** One key lost: anchoring continues, but the signer set can never change. Two lost:
anchoring stops, and recovery is a new account. Hence the tested backups (V3-8).

## 4. Accepted and rejected

- **Accepted interval:** passes the ingest checks (schema, integers, spec version, no duplicate, in
  order; from week 1 also canonical, on the grid, from the same site and node, and not starting
  before the latest interval that holds time ends) and gates G0–G3. Its energy counts.
- **Rejected interval** (same rule before and after v3): written with registered reason codes to
  `ledger/rejected.jsonl`, the public rejection log; counted in the `rejected_count` of the batch
  whose window contains it; never in a batch's `intervals`; no energy.
- **Accepted batch:** published, passes the proposer's self-check (`verifyBatch`, the function the
  verifier runs) and, from week 3, not refused by the verifier. From week 1 the verifier also walks
  back to the on-chain head before co-signing (V3-1), and the proposer runs the same walk before
  proposing (DV-5). An empty batch can be accepted (D-5). It is
  *anchored* once its transaction lands.
- **Rejected batch:**

| | v2 (D-3, D-4) | Week 1 (V3-3, DV-1; built) | Week 3 (V3-11) |
|---|---|---|---|
| Rejected when | the proposer's self-check fails | unchanged | also when the verifier refuses it |
| Published / anchored | published with `batch.*` reasons (`rejected` in `ledger/batches.jsonl`); never anchored | unchanged | a verifier refusal is also published, in the verifier log; never anchored |
| Chain (`prev_hash`) | runs through it: the next `prev_hash` is its hash | unchanged, so the defect stays visible in sequence | a batch the verifier refused is left out: the next batch links to the last anchored batch and carries its `cumulative_mwh` |
| Floor (time, node, counted intervals) | none: order is checked only inside a batch | the last batch published as accepted; a rejected batch never moves it | the last anchored batch |
| Its energy | enters `cumulative_mwh`, so the next anchored total includes energy never anchored | never: it carries the previous `cumulative_mwh` forward unchanged, so the anchored cumulative is the energy of accepted batches only | the same for a verifier refusal |
| A verifier refusal | changes no status: the batch stays next in line and anchoring stops there | unchanged | is terminal; anchoring continues with the next batch |
| Reconciliation | expects contiguous `seq` | also BROKEN unless every cumulative is the energy of the accepted batches up to it | also accepts a link that skips a batch only where the skipped batch is refused in the verifier log |

Since week 1 the time, node and counted-interval checks run against the floor, not the previous
published batch: a rejected batch carries no energy, so its window and intervals never become the
floor, and a rejected batch with an earlier window cannot reopen time that an accepted batch already
counted. V3-1's walk passes through batches published as rejected, each carrying the total forward
unchanged, and stops a walk longer than its bound (168 batches by default) with
`verifier.walk_too_long` (DV-5); with nothing anchored it ends at seq 0 with
`prev_hash` of 64 zeros. From week 3, a batch already published on top of a batch the verifier then refuses fails
the walk and is refused in turn; published files are never rewritten, and the next batch links to
the last anchored one. This happens only after a verifier outage, because a batch is normally
judged within minutes and the next one closes an hour later.

## 5. Open decisions

### OD-1 · Account thresholds — DECIDED: Option B, 2/2/3

Decided on Wed 21 Oct 2026 (Day 3) by both founders: Option B, thresholds 2/2/3 (low 2, medium 2,
high 3; three signers of weight 1; master weight 0), marked in §8. It applies from the creation of
the real account (week 2); afterwards a change needs all three keys. The table below stays as the
record of the choice.

**Why B.** Under 1/2/3 any single key, the off-team third signer's included, could alone sign a
low-threshold BumpSequence for the account. That invalidates every co-signed anchor still pending,
so anchoring stalls; bumped to the largest sequence number (INT64_MAX), it would leave the account
unable to send any further transaction, which blocks anchoring for good and makes recovery a new
account. Under 2/2/3 every transaction for the account needs two signatures to meet the low
threshold, so no single key can send any transaction for the account.

| | Option A: keep 1/2/3 | Option B: 2/2/3 |
|---|---|---|
| What it is | what `setup-account.js` sets today and the 8 Oct rehearsal used | low threshold raised to 2 |
| One key | cannot anchor, but can sign a low-threshold operation such as BumpSequence that cancels or stalls anchoring | cannot submit any transaction for the account |
| Public wording | only "no single key can anchor alone"; the `setup-account.js` comment that no single key "can do anything that matters" must be corrected | may also say "no single key can submit any transaction for the anchoring account" |
| Tests A and B | `tx_failed` / `op_bad_auth`, as rehearsed | `tx_bad_auth`; still "the network rejects it", and `tests-abcd.js` accepts both |
| Work | none | `setup-account.js` and its `--verify` check, the fake Horizon in the recovery tests, `rehearse.js`, the write-up and the docs change; the rehearsal is repeated on a throwaway account |
| Fallback with two team signers | 1/2/2 | 2/2/2 |

*Not used (status Fri 30 Oct 2026, Jay Kim and Diego Ostertag): the fallback below was withdrawn
on Sun 25 Oct 2026, and the account is created only with the three public keys (§9, OD-2).*

**Fallback.** If the third signer's public key has not arrived when the account must exist, it is
created with the two team signers, master weight 0, at thresholds 2/2/2, and the write-up reports
the off-team requirement as not met. No single key can send any transaction for the account under
2/2/2 either, but the two team keys together meet every threshold until the third signer is added.
Both team keys can later add the third signer and raise the high threshold to 3, which gives
2/2/3.

### Other decisions

Signing adopts each proposal unless the founders write another answer into the row.

| # | Decision | Proposal | By |
|---|---|---|---|
| OD-2 | Third signer named, public key received | SOW final v4 (September 2026) Deliverable 3 has the third signer designated at kickoff; that was not met. Target: confirmed Wed 28 Oct, key added before the code freeze Fri 6 Nov (Day 19). The real account waits for it; fallback above | Wed 28 Oct (target) |
| OD-3 | Marker payment destination | As built: the team's existing QWATT testnet account; or a dedicated account with a trustline | Week 2 |
| OD-4 | Who operates each host, on which provider | Different founders, different providers | Week 2 |
| OD-5 | Account for the run | A run account created at the freeze with the same three signer keys, so the run's chain starts at genesis | Fri 6 Nov |
| OD-6 | Fee per operation, in the public config | 1,000 stroops, to stay valid under testnet surge pricing | Week 3 |
| OD-7 | Which refusals are terminal | All (V3-11 as written); or `verifier.not_published` and `verifier.tx_mismatch`, which concern the proposal, become waits | Week 3 |
| OD-8 | "Seven consecutive days" | A restart that drains its backlog in order, with original timestamps, within 2 hours keeps the run continuous; published before Sat 7 Nov | Fri 6 Nov |
| OD-9 | Dawn and dusk refusals from G0's relative tolerance (B-3) | Listed in advance in the run's published expectations; spec unchanged | Fri 6 Nov |
| OD-10 | Spec digest | Keep version 1.0.0 with digest `32dc1cf9a84eaa9b…` | Sign-off |

*Status notes of Fri 30 Oct 2026 on OD-2 and OD-4: §9. The rows above keep their agreed wording.*

## 6. Input, and what the seven-day run proves

All input during the sprint is simulated or replayed. The live run is fed by the deterministic
simulator (the 150 Wp bench in Santiago as numbers, two simulated DC meters) through the CSV adapter
at real-time pace, so meter agreement in the run is simulated too. The scale test replays one month
of public historical data (NREL PVDAQ 4902, September 2017, CC BY 4.0). No hardware is in scope.
Every page and write-up that shows anchored energy carries the label "Simulated input · assurance
A0 · Stellar testnet", and none presents it as generation.

**If it completes, the run shows** that the software runs unattended for seven days at real-time
pace on Stellar testnet; that every hourly batch is published and either anchored with two
signatures or rejected with a published reason; that the verifier re-derives each batch from the
public feed alone before signing; that each injected fault (shaded sensor, disconnected meter, night
injection, implausible ramp) appears in the public rejection log with its expected reason; and that
anyone can reconcile every anchor with the published evidence.

**It does not show** that any physical installation produced energy, that any meter is accurate,
that the gate thresholds suit a real site, that the verifier is organizationally independent of the
team, or anything about mainnet or production key custody.

## 7. How a stranger reproduces a check

Git and Node 20 or later; no keys, no account, nothing written to any network. The repositories and
account go live in week 2, the run's feed on Sat 7 Nov.

```bash
git clone https://github.com/academiaseul/QWATT.git && cd QWATT
git checkout <tag>                                  # the frozen commit, named in the feed

node protocol/gen.js --check                        # bindings match the spec; prints its digest
node protocol/conformance.test.js && node batch/batch.test.js
node batch/scale.js --dataset datasets/pvdaq-4902-2017-09/dataset.json
#   "chain VERIFIED · second run IDENTICAL"; head = head_sha256 in evidence/scale/

git clone https://github.com/academiaseul/qwatt-evidence.git ../qwatt-evidence
node batch/verify-cli.js ../qwatt-evidence/run
#   a batch count matching the feed, then "OK — every published batch re-derives from the feed"

# one batch by hand: its hash, then the anchor (tx_hash is in run/anchored/<batch_id>.json)
node -e "console.log(require('./protocol/evidence').batchSha256(require('../qwatt-evidence/run/batches/<batch_id>.json')))"
curl -s "https://horizon-testnet.stellar.org/transactions/<tx_hash>/operations" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s)._embedded.records.filter(o=>o.type==='manage_data').forEach(o=>console.log(o.name,Buffer.from(o.value,'base64').toString())))"
curl -s "https://horizon-testnet.stellar.org/accounts/<anchoring account>"   # signers, thresholds

node anchor/reconcile-cli.js --feed https://academiaseul.github.io/qwatt-evidence/run --account <anchoring account>
#   RECONCILED, or PENDING while the newest batches await anchoring; BROKEN on any mismatch
```

## 8. Signatures

Date: Wed 21 Oct 2026 (Day 3), the last of the Days 1–3 that SOW final v4 (September 2026) §5
gives the architecture freeze. By agreeing, each founder accepts §1–§7, the proposals in §5 and
the option marked for OD-1.

OD-1: ☐ Option A (1/2/3) ☒ Option B (2/2/3)

| Founder | GitHub | Signature | Date |
|---|---|---|---|
| Jay Kim | academiaseul | Agreed | Wed 21 Oct 2026 |
| Diego Ostertag | CogeloEasy | Agreed | Wed 21 Oct 2026 |

Both founders agreed to §1–§7, the proposals in §5 and Option B for OD-1 on Wed 21 Oct 2026. Jay Kim
recorded the agreement in the repository on Thu 22 Oct 2026.

## 9. Dated status notes

Notes added after the agreement of Wed 21 Oct 2026. Each is dated and agreed by both founders, and
records what was decided or built since. None of them changes the agreed wording of §1–§8: every row
and paragraph above stays as agreed, and a note says where the facts now differ from a proposal. The
build facts of V3-6, V3-9 and V3-10 are in the week-2 changelog ([CHANGELOG.md](../CHANGELOG.md)),
not here.

### Fri 30 Oct 2026 (Day 12) · Jay Kim and Diego Ostertag

**OD-2 · Third signer (status note, Fri 30 Oct 2026, Jay Kim and Diego Ostertag).** The fallback of
§5, the two team signers at thresholds 2/2/2, is withdrawn: decided on Sun 25 Oct 2026 (week-2
decisions email, item 2). The anchoring account is created only with the three public keys
(proposer, verifier and third signer). If the third signer's public key is late, the account waits,
and the founders write a numbered deviation together. **Fallback: Not used.** At the date of this
note the third signer is confirmed (week 1) and their public key has not arrived.

**OD-4 · Hosts, as built (status note, Fri 30 Oct 2026, Jay Kim and Diego Ostertag).** Proposer
host: a cloud VPS operated by Diego Ostertag (provider: <provider, to be filled when the VPS exists>).
Verifier host: Jay Kim's own computer (Windows 10, WSL2, Ubuntu 26.04), installed with the host
package of [PR #32](https://github.com/academiaseul/QWATT/pull/32) at commit `03169a8`. Different
founders on different providers, as §5 proposed. The proposer host is not set up yet.

**Deviations built in week 2 (status note, Fri 30 Oct 2026, Jay Kim and Diego Ostertag).** Three
deviations from the week-2 rows of §2, each approved by both founders and built in the PR shown.
Each text is the approved text, word for word.

| # | Departs from | Approved text | Built in | Approved |
|---|---|---|---|---|
| DV-6 | V3-5 | V3-5 as built departs from the freeze row's wording in these points: **Encoding:** the leaves are the raw payload bytes, grouped in runs with a count `n`. **Order (R3):** raw lines in time order; at a tie, accepted before refused; unreadable lines last. **R2 exemption tightened:** only `source.adapter` `http-json`, and the payload must be the record as posted. **Sub-decisions:** keep R3's "readable" timestamp as built (whatever `Date.parse` accepts) for week 2 and revisit it in week 3, since it only changes the order of odd refused lines. R1 does not refuse zero-length payloads for now, since no honest adapter makes one. `ingest.raw_missing` stays for intervals with no samples. | [PR #24](https://github.com/academiaseul/QWATT/pull/24) | Jay Kim, Sun 25 Oct 2026 (week-2 decisions email, item 3); Diego Ostertag, Tue 27 Oct 2026 (message to Jay) |
| DV-7 | V3-4 | V3-4 as built: A submits the published proposal; B re-signs that same body; I withholds the batch from the verifier's only input path through a local proxy that reads one pinned evidence commit (`feed_commit`). The public feed is never touched. Wording rule: I's batch is never called "unpublished". The step name `I_withheld_refused` is accepted. | [PR #27](https://github.com/academiaseul/QWATT/pull/27) | Jay Kim, Sun 25 Oct 2026 (week-2 decisions email, item 3); Diego Ostertag, Thu 29 Oct 2026 (approval comment on PR #27) |
| DV-8 | V3-7 | `status.json` in `qwatt-verifier-log` is the one file that is replaced, at most every 5 minutes. `decisions.jsonl` and `refusals.jsonl` only grow. | [PR #26](https://github.com/academiaseul/QWATT/pull/26) (its tests merged first in [PR #25](https://github.com/academiaseul/QWATT/pull/25)) | Jay Kim, Sun 25 Oct 2026 (week-2 decisions email, item 3); Diego Ostertag, Thu 29 Oct 2026 (approval comment on PR #26) |

**Resumen / Summary of week 2 as built (status note, Fri 30 Oct 2026, Jay Kim and Diego
Ostertag).** PRs #22 to #32, merged on main from 27 to 29 Oct: account setup and funding from the
public keys (V3-8b, PR #22); key check and backup drill (V3-8c, PR #23); `samples_root` (V3-5,
DV-6, PR #24); the verifier's public log (V3-7b, DV-8, PRs #25 and #26); tests A–D and the
independence step (V3-4a, DV-7, PR #27); the live-run audit of raw readings (V3-5b, PR #28); readers
pinned to one commit of the public evidence (V3-7c, PR #29); the neutral site name (FD-14, PR #30);
the reconciliation page on the site (V3-9.3, PR #31); the host package (PR #32). PRs #33 to #35,
merged on 30 Oct: the host package's Windows task fix (PR #33), CI on Node 24.14.1 (PR #34), the
week-2 changelog and `status.json` (PR #35). PRs #12 to #21, merged on 25 and 26 Oct, are in the
week-2 changelog. Not done yet: the real 2-of-3 anchoring account on Stellar testnet (V3-4), and
tests A–D and the independence test on it, so nothing is anchored on the real account yet. The
account waits for the proposer's public key (its host is not set up yet) and the third signer's
public key.

> **Resumen (viernes 30 de octubre de 2026, Jay Kim y Diego Ostertag).** La semana 2 tal como se
> construyó: en main entraron los PR #22 a #32 (27 a 29 de octubre) y #33 a #35 (30 de octubre);
> los PR #12 a #21 están en el registro de cambios de la semana 2. Ambos fundadores aprobaron tres
> desviaciones: DV-6 (`samples_root`), DV-7 (pruebas A–D e independencia) y DV-8 (`status.json` de
> la bitácora del verificador). La alternativa 2/2/2 se retiró el 25 de octubre: la cuenta se crea
> solo con las tres claves públicas. Falta todavía: la cuenta real 2 de 3 en Stellar testnet y las
> pruebas A–D sobre ella, así que aún no hay anclajes en la cuenta real. El host del proponente
> será un VPS en la nube a cargo de Diego Ostertag, aún no instalado; el del verificador es el
> computador de Jay Kim (Windows 10, WSL2, Ubuntu 26.04).

### Sat 31 Oct 2026 (Day 13) · Jay Kim and Diego Ostertag

**V3-5 · Scale-test head (status note, Sat 31 Oct 2026, Jay Kim and Diego Ostertag).** As the V3-5
row of §2 says, the scale test was re-run when `samples_root` became required (batch schema 1.1.0,
[PR #24](https://github.com/academiaseul/QWATT/pull/24)). Its head is now `99e22999…`
(`evidence/scale/scale-pvdaq-4902-2017-09.json`): 8,640 intervals, 720 batches, 0 rejected, chain
verified. The `cb3d1050…` cited in §2 (the V3-1/V3-2 paragraph and the DV-3 row) is the head before
V3-5.

**§8 · Diego Ostertag's GitHub account (status note, Sat 31 Oct 2026, Jay Kim and Diego
Ostertag).** §8 lists Diego Ostertag's GitHub account as `CogeloEasy`. His GitHub account is
`dostertags`, the account that approved DV-7 and DV-8 on PRs #27 and #26; no GitHub account is
named `CogeloEasy`. The agreement recorded in §8 stands.

Status notes agreed by Jay Kim and Diego Ostertag: Diego Ostertag approves the pull request that
adds them and Jay Kim merges it; the merge date is the date of agreement.
