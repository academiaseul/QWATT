# QWATT · constancias de generación solar verificables de forma independiente (Stellar testnet)

QWATT es un verificador de código abierto que convierte lecturas de medidores solares en constancias verificables de forma independiente en Stellar testnet.

**Sprint Instawards Chile, desde el 19 oct 2026** · Jay Kim y Diego Ostertag, Santiago · Lo hecho cada semana: [CHANGELOG.md](CHANGELOG.md) · Trabajo previo (antes del 19 oct): [docs/PRIOR-WORK.md](docs/PRIOR-WORK.md)

Pruébalo (solo necesitas Node.js 20 o superior y git):

```bash
git clone https://github.com/academiaseul/QWATT.git
cd QWATT
npm test
```

*QWATT es un proyecto en desarrollo que opera solo en Stellar testnet. QWATT no es electricidad, ni una inversión, ni un valor o instrumento financiero, ni un certificado de energía renovable (REC), ni un crédito de carbono. No tiene precio y no se vende.*

El README del hackathon de agosto 2026 sigue en el historial: https://github.com/academiaseul/QWATT/blob/2bb5496/README.md

## Verificación completa

Son los mismos pasos que corre el CI. Ninguna prueba se conecta a Stellar testnet: el anclaje se prueba contra un Horizon simulado y claves desechables creadas en memoria.

```bash
npm test                                      # filtros de verificación, ingesta, lotes, conciliación, corrida en vivo y operación; sin instalar nada
npm ci --prefix anchor --no-audit --no-fund   # instala el SDK de Stellar, la única dependencia (solo para anchor/)
npm run test:anchor                           # anclaje con 2 de 3 firmas, recuperación y pruebas A–D
npm run harness                               # prueba de aceptación: Modbus, HTTP y CSV producen registros idénticos
npm run scale                                 # un mes de datos públicos NREL PVDAQ: 720 lotes, cadena verificada, segunda corrida idéntica
```

## Cómo está organizado

| Carpeta | Qué contiene | In English |
|---|---|---|
| `protocol/` | Especificación de los filtros de verificación (`gates.spec.json`), esquemas, reglas de hash de la evidencia y suite de conformidad | Verification-filter spec, schemas, evidence hashing rules, conformance suite |
| `ingest/` | Adaptadores de medidores (Modbus, HTTP, CSV) que entregan el mismo registro de intervalo de 5 minutos | Meter adapters (Modbus, HTTP, CSV) that emit the same 5-minute interval record |
| `batch/` | Lotes de evidencia encadenados por hash, su verificación, el feed en disco y la prueba de escala | Hash-chained evidence batches, their verification, the on-disk feed, the scale test |
| `anchor/` | Anclaje en Stellar testnet con 2 de 3 firmas: transacción determinista, proponente, verificador independiente, recuperación | 2-of-3 anchoring on Stellar testnet: deterministic transaction, proposer, independent verifier, recovery |
| `live/` | Simulador solar, fallas programadas, corrida en vivo y su auditoría | Solar simulator, scheduled faults, live run and its audit |
| `ops/` | Vigilancia, publicación del feed, informe automático, chequeo previo y servicios systemd | Watchdog, feed publisher, generated write-up, preflight, systemd units |
| `datasets/` | Datos públicos NREL PVDAQ (CC BY 4.0) convertidos, con su procedencia y hashes | Converted NREL PVDAQ public data (CC BY 4.0), with provenance and hashes |
| `evidence/` | Registros de los ensayos previos (8 oct 2026, cuentas desechables) y de la prueba de escala | Records of the prior rehearsals (8 Oct 2026, throwaway accounts) and the scale test |
| `assets/` | Código del navegador: motor de los filtros, conciliación y bibliotecas empaquetadas (`vendor/`) | Browser code: filter engine, reconciliation, bundled libraries (`vendor/`) |
| `vendor-src/` | Puntos de entrada para reconstruir `assets/vendor/` con esbuild | Entry points to rebuild `assets/vendor/` with esbuild |
| `mining-rig/` | Prototipo Modbus del hackathon de agosto; sus validadores (`validators.js`) siguen en las pruebas | August hackathon Modbus prototype; its validators (`validators.js`) are still tested |
| `docs/` | Diseño, modelo de verificación, plan del sprint, manual de operación | Design, verification model, sprint plan, runbook |
| `.github/` | CI: corre todas las suites en cada push a `main` y en cada PR | CI: runs every suite on each push to `main` and on each PR |
| `.well-known/` | `stellar.toml` (SEP-1) del sitio; solo Stellar testnet | The site's `stellar.toml` (SEP-1); Stellar testnet only |
| raíz (`*.html`) | Sitio estático de qwatt.org, sin compilación; la mayoría de las páginas viene del hackathon de agosto | Static qwatt.org site, no build step; most pages date from the August hackathon |

## In English

**QWATT · independently verifiable solar generation records (Stellar testnet)**

QWATT is an open-source verifier that turns solar meter readings into independently verifiable records on Stellar testnet.

**Instawards Chile sprint, since 19 Oct 2026** · Jay Kim and Diego Ostertag, Santiago · What was done each week: [CHANGELOG.md](CHANGELOG.md) (Spanish) · Prior work (before 19 Oct): [docs/PRIOR-WORK.md](docs/PRIOR-WORK.md)

Try it (you only need Node.js 20 or later and git). No test connects to Stellar testnet: anchoring is tested against a simulated Horizon with throwaway keys generated in memory.

```bash
git clone https://github.com/academiaseul/QWATT.git
cd QWATT
npm test                                      # verification filters, ingestion, batches, reconciliation, live run, ops; no install
npm ci --prefix anchor --no-audit --no-fund   # installs the Stellar SDK, the only dependency (anchor/ only)
npm run test:anchor                           # 2-of-3 anchoring, recovery, tests A–D
npm run harness                               # acceptance test: Modbus, HTTP and CSV produce identical records
npm run scale                                 # one month of NREL PVDAQ public data: 720 batches, chain verified, second run identical
```

The folder table above has an English column.

*QWATT is a project in development that runs only on Stellar testnet. QWATT is not electricity, not an investment, not a security or financial instrument, not a renewable energy certificate (REC), and not a carbon credit. It has no price and is not for sale.*

The August 2026 hackathon README is still in the history: https://github.com/academiaseul/QWATT/blob/2bb5496/README.md
