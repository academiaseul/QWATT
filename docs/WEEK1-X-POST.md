# Week 1 · X post (draft, not posted)

Drafts for the founders' account. Nothing here has been posted; posting is the founders' call.
Every claim is sourced in the table at the end and matches the week-1 section of
[`CHANGELOG.md`](../CHANGELOG.md). Lengths are X's weighted count (each link counts 23), limit
280.

## Before posting

- [ ] The week-1 section of `CHANGELOG.md` is on `main`. Until then the changelog link in posts 1
      and S shows the placeholder "Se publica el viernes 23 de octubre."
- [ ] Freeze v3 is merged to `main` (branch `semana-1/acuerdo-v3`). Until it is, post 3 is
      still true (the founders agreed it on 21 Oct), but nothing on `main` shows it. Either merge
      first or drop post 3.
- [ ] The founders agree with the framing: the ingestion is **prior work** (9 Sep,
      `docs/PRIOR-WORK.md`), and week 1 saved its evidence.

## Thread · Español

**1/3** (273)

> Semana 1 del sprint Instawards Chile de QWATT (19–23 oct, solo Stellar testnet): antes de firmar, el verificador recorre la cadena hasta el último anclaje en vez de confiar en el total heredado, y la misma energía ya no cuenta dos veces entre lotes. https://github.com/academiaseul/QWATT/blob/main/CHANGELOG.md

**2/3** (276)

> Ingesta independiente del medidor (trabajo previo, 9 sep): evidencia guardada. Dos horas simuladas de datos solares (muestras cada 10 s) por CSV, HTTP y Modbus (contra un simulador) dan registros idénticos byte a byte. No se leyó ningún medidor físico. https://github.com/academiaseul/QWATT/actions/runs/39593847463

**3/3** (232)

> Los dos cofundadores acordaron la congelación de la arquitectura v3 el miércoles 21 (Día 3). Lo que sigue: la cuenta de anclaje 2 de 3 en testnet, con un tercer firmante externo. Código abierto, licencia MIT: https://github.com/academiaseul/QWATT

**S · single post instead of the thread** (273)

> Semana 1 del sprint Instawards Chile de QWATT (solo Stellar testnet): el verificador revisa la cadena hasta el último anclaje antes de firmar, la misma energía no se cuenta dos veces, y CSV, HTTP y Modbus dan registros idénticos con datos simulados. https://github.com/academiaseul/QWATT/blob/main/CHANGELOG.md

## Thread · English

**1/3** (272)

> Week 1 of QWATT's Instawards Chile sprint (Oct 19–23), Stellar testnet only. The verifier no longer trusts an inherited total: before signing, it walks the chain back to the last anchor. And the same energy can no longer count twice across batches. https://github.com/academiaseul/QWATT/blob/main/CHANGELOG.md

**2/3** (266)

> Meter-agnostic ingestion is prior work (Sep 9). This week we saved its evidence: two simulated hours of solar data (10-second samples) through CSV, HTTP and Modbus (against a simulator) give byte-identical records. No physical meter was read. https://github.com/academiaseul/QWATT/actions/runs/39593847463

**3/3** (196)

> Both co-founders agreed architecture freeze v3 on Wed Oct 21 (Day 3). Next: the 2-of-3 anchoring account on testnet, with an outside third signer. Open source, MIT licence: https://github.com/academiaseul/QWATT

**S · single post instead of the thread** (274)

> Week 1 of QWATT's Instawards Chile sprint, Stellar testnet only: the verifier walks the chain back to the last anchor before signing, the same energy can't count twice across batches, and CSV, HTTP and Modbus give identical records on simulated data. https://github.com/academiaseul/QWATT/blob/main/CHANGELOG.md

## Where each claim comes from

| Claim | Source |
|---|---|
| Week 1 = 19–23 Oct; Stellar testnet only | `README.md` and `docs/PRIOR-WORK.md` on `main` (Day 1 = Mon 19 Oct 2026) |
| The verifier walks the chain back to the last anchor before signing (S1) | `09210b0`, test `bdd5784`, [PR #7](https://github.com/academiaseul/QWATT/pull/7); freeze v3 V3-1 |
| The same energy cannot count twice across batches (S2 and its review) | `40aaa3d`, test `6204b12`, [PR #5](https://github.com/academiaseul/QWATT/pull/5); `8385da3`, test `301bc50`, [PRs #1](https://github.com/academiaseul/QWATT/pull/1) and [#8](https://github.com/academiaseul/QWATT/pull/8) |
| Ingestion is prior work (9 Sep) | `98b281a`; `docs/PRIOR-WORK.md` on `main` |
| Two simulated hours, 10 s samples, byte-identical records across CSV, HTTP and Modbus; Modbus against a simulator | `ingest/harness.js` (720 samples per meter, 2026-09-20 15:00–17:00 UTC, fixed seed; Modbus TCP simulator); output saved in `evidence/harness/harness-c1ae630.txt`; [CI run #30](https://github.com/academiaseul/QWATT/actions/runs/39593847463), step 7 |
| No physical meter was read | No test or evidence file in the repository reads a device; `docs/DELIVERABLE-1-EVIDENCE.md`, "Known limitations" |
| Freeze v3 agreed by both co-founders on Wed 21 Oct (Day 3) | `docs/ARCHITECTURE-FREEZE-v3.md` §8 on branch `semana-1/acuerdo-v3` (`b304ddb`) |
| Next: the 2-of-3 anchoring account on testnet with an outside third signer | Freeze v3 V3-4 (planned, not built on a real account yet) |
| Open source, MIT licence | `LICENSE` on `main` (`fe16c53`, 8 Oct) |
