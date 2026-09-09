# ingest/ — meter-agnostic ingestion (Deliverable 1)

Any meter → one record. Adapters own protocol, decoding and time alignment; they never judge.
The only thing that differs between meters is a register map, which is a JSON file.

```
Modbus meter ──► adapters/modbus.js ──┐
HTTP push    ──► adapters/http.js   ──┼──► lib/normalize.js (IntervalBuilder) ──► interval.schema.json record
CSV file     ──► adapters/csv.js    ──┘        integer mWh · grid-aligned · raw_sha256 · validated
```

| Path | Role |
|---|---|
| `lib/registermap.js` | Loads and validates `maps/*.json`; decodes u16/i16/u32/i32/f32 with word order and scale; computes read blocks; encodes for simulators. |
| `lib/normalize.js` | `IntervalBuilder`: samples in, schema-valid interval records out. Trapezoidal integration split exactly at grid boundaries, or counter deltas. Integer units. Throws rather than emit an invalid record. |
| `adapters/modbus.js` | Modbus TCP client (no deps), Modbus RTU client (needs `serialport` on the gateway), `pollOnce`, continuous `start`, and a TCP **simulator** for tests. |
| `adapters/http.js` | `POST /samples`, `POST /intervals` (validated, `clock_skew_s` stamped), `POST /flush`, `GET /health`. |
| `adapters/csv.js` | Replay at fast or real-time pace; the CSV line is the raw payload. |
| `maps/pzem-017.json` | Bench meter A. 9600 8N2. |
| `maps/epever-tracer.json` | Bench meter B. 115200 8N1. Confirm addresses against your controller's manual before the first live read. |
| `harness.js` | **Acceptance test:** one synthetic morning through all three adapters must produce byte-identical records (minus `source`) and identical verdicts. |
| `cli.js` | Run an adapter and print intervals as JSON lines. |

```bash
node ingest/ingest.test.js          # unit tests + the acceptance harness
node ingest/harness.js              # the acceptance test alone
node ingest/cli.js modbus --a pzem-017@192.168.1.50:502 --b epever-tracer@192.168.1.51:502
node ingest/cli.js csv --file day.csv --a a_w --b b_w --pace fast
node ingest/cli.js http --port 8080
```

## Adding a meter

Copy a map, change `name`, `class`, `protocol` and `fields`. Set `energy` to `integrate` when
the device's energy counter is coarser than a few percent of one interval's energy, otherwise
`counter`. Run `node ingest/ingest.test.js`: the round-trip test covers every field you declare.

## Bench wiring notes

- The PZEM-017 and the EPEver run at different baud rates and stop bits. They need **two**
  USB-RS485 adapters, or one adapter re-opened per device. The CLI takes one device per `--a`/`--b`.
- Modbus RTU on Windows needs `npm i serialport` inside `ingest/`. On the Pi it builds cleanly.
  An RTU-over-TCP gateway avoids native modules entirely and is the recommended production path.
- Every meter's decoded fields are hashed into `raw_sha256` from the wire frames, so a reviewer
  can later check that normalization did what the map says.
