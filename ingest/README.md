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
| `maps/pzem-017.json` | Bench meter A. 9600 8N2. Every field matches the manufacturer's protocol document ([sources](#register-map-sources)). |
| `maps/epever-tracer.json` | Bench meter B. 115200 8N1. PV and energy-counter registers match the EPEver protocol document; the two battery registers (0x3104, 0x3105) need a live read first ([sources](#register-map-sources)). |
| `harness.js` | **Acceptance test:** two simulated hours of solar data (10 s samples, two meters) through all three adapters must produce byte-identical records (minus `source`) and identical verdicts. The Modbus path polls a local simulator. |
| `capture-evidence.js` | Saves the harness and test output of one commit as evidence: `node ingest/capture-evidence.js <commit>` → `evidence/harness/harness-<commit>.txt`. |
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
  A gateway that converts RTU to Modbus TCP avoids native modules entirely and is the recommended
  production path. A transparent serial-to-TCP bridge that forwards raw RTU frames does not work
  with the `tcp` transport, which speaks Modbus TCP (MBAP) framing only.
- RTU framing is tested in CI against an in-memory serial port; no physical meter has been read
  through it yet.
- Each interval's `raw_sha256` covers the wire frames of every poll in it (see below), so a
  reviewer holding the frames can check that normalization did what the map says.

## raw_sha256

`source.raw_sha256` is the SHA-256 of the raw payloads of every sample whose timestamp falls in
the interval (`ts_start` ≤ ts < `ts_end`), concatenated in the order the samples were pushed
(`IntervalBuilder.push` in `lib/normalize.js`). The raw payload of one sample is:

| Adapter | Raw payload of one sample |
|---|---|
| CSV | The CSV line as read, without its line ending, plus `\n`. A line feeds one sample per meter column, in the order of `meters` in the config, so with two meters each line is hashed twice. |
| HTTP `POST /samples` | The exact request body the sample arrived in. A body carrying n samples of one interval is hashed n times; a body whose samples straddle a boundary enters both intervals. |
| Modbus (TCP or RTU) | The reply frames of that poll, concatenated in read-block order: the whole MBAP frame over TCP, the whole frame including its CRC over RTU. Requests are not hashed. |

Records posted whole to `POST /intervals` are not built by the `IntervalBuilder`; the
`adapters/http.js` row above says what the gateway does with them. The adapters do not store raw
payloads, so recomputing the hash needs the original input (the CSV file, the request bodies or
the frames). `ingest.test.js` recomputes it from the input alone for CSV and HTTP, and for an RTU
poll from its reply frame.

## Register-map sources

Both maps were checked field by field on 23 Oct 2026 against the manufacturers' protocol
documents. The manufacturer sites could not be reached from the environment that did the check,
so the copies read are third-party copies hosted on GitHub; their SHA-256 is recorded so anyone can
confirm they read the same file. No register has been read from a physical device.

| Ref. | Document | Copy read | SHA-256 |
|---|---|---|---|
| PZ1 | "PZEM-003/017 DC communication module" (its text does not name the manufacturer) | [vortigont/pzem-edl `docs/PZEM-003-Manual.pdf`](https://github.com/vortigont/pzem-edl/blob/main/docs/PZEM-003-Manual.pdf) | `88838a8483436964c44f59aa1befe852a7f2c900ea0d3f6aae481a5cbb0fa40d` |
| PZ2 | Scanned copy of the same specification, same register table | [SN-8023/PZEM-017-003-Change-Address `PZEM-003_017.pdf`](https://github.com/SN-8023/PZEM-017-003-Change-Address/blob/master/PZEM-003_017.pdf) | `1ad1693e132660513891e4b6938bee7f7dde1aedc89c38ca8a13cb2167769526` |
| EP25 | "LS-B, VS-B, Tracer-B, Tracer-A, iTracer, eTracer Series Controller Communication Instruction" (file named `MODBUS-Protocol-v25.pdf`; the text carries no version number; PDF created 27 Sep 2018) | [softwarecrash/EPEver2MQTT `Protocol/MODBUS-Protocol-v25.pdf`](https://github.com/softwarecrash/EPEver2MQTT/blob/main/Protocol/MODBUS-Protocol-v25.pdf) | `d0f9f08be06b5125134c3be24d9acc1430dcd4e9e82478df68d451489aaa77fb` |
| EP23 | "B-Series MODBUS Specification", EPEVER Corporation, V 2.3, 12 Jun 2015 | [darksilicon13/EPEVER-Modbus `ControllerProtocolV2.3.pdf`](https://github.com/darksilicon13/EPEVER-Modbus/blob/main/ControllerProtocolV2.3.pdf) | `a3fccf914928118def85223482e3091956d046810a01c20152006e6f68c61b70` |
| EP11 | "LS-B Series Protocol ModBus Register Address List" V1.1, Beijing Epsolar Technology Co., Ltd. | [darksilicon13/EPEVER-Modbus `1733_modbus_protocol.pdf`](https://github.com/darksilicon13/EPEVER-Modbus/blob/main/1733_modbus_protocol.pdf) | `86c05193b7f6e1945eb67616c6658366ef4033b110f506a33c1eeef03b0eafbf` |

**`maps/pzem-017.json`: every field matches PZ1 (and PZ2).** Serial 9600 8N2 (§2.1); function 4
(§2.3; function 3 would read the alarm thresholds at the same addresses instead, §2.4); 0x0000
voltage 0.01 V; 0x0001 current 0.01 A; 0x0002/0x0003 power 0.1 W, low word first; 0x0004/0x0005
energy 1 Wh, low word first; 0x0006/0x0007 alarm status (0xFFFF alarm). The §2.3 example reply
decodes with this map to the document's 100.00 V, 1.00 A, 100.0 W and 0 Wh (test "documented
example frames…"). Three things the document does not settle need the bench device: the factory
unit id (PZ1 gives the range 0x01–0xF7 and uses 0x01 in its example, but states no default); the
current-range holding register 0x0003 (100, 50, 200 or 300 A), which must match the fitted shunt or
current and power read wrong; and the 5 V supply over 100 mA that the RS-485 side needs (PZ1 §5).

**`maps/epever-tracer.json`: every field matches EP25 except the two battery fields.** Serial
115200 8N1 and unit id 1 (EP25 characteristics 2–3; the older EP23 says address 0x00); function 4;
0x3100 PV voltage and 0x3101 PV current (0.01 V, 0.01 A); 0x3102/0x3103 PV power (0.01 W, low word
first, as EP25 characteristic 5's 32-bit example shows; that example decodes with the map's
`power_w` type and scale in the same test); 0x330C/0x330D energy today and 0x3312/0x3313 energy
total (0.01 kWh, so scale 10). **Not confirmed:** `battery_voltage_v` at 0x3104 and
`battery_current_a` at 0x3105 appear only in EP11 (as charging-equipment output voltage and
charging current) and in a worked example in EP23. The EP23 and EP25 register tables omit both and
list battery voltage at 0x331A and net battery current, signed and 32-bit, at 0x331B/0x331C.
Neither field feeds energy (`power_field` is `power_w`), but both share the read block that starts
at 0x3100 (6 registers) with PV power, and `pollOnce` throws on any Modbus exception: if the
controller refuses 0x3104/0x3105, PV power is lost on every poll. EP25 names Tracer-A and Tracer-B,
not the AN or BN series the map's description lists; EPEver distributes a separate
"XTRA, TRIRON, TracerAN Series Controller Communication Instruction" through its support, which was
not available for this check. Before the first live read on the bench controller: read 0x3100 × 6
and 0x331A; if 0x3104/0x3105 are refused or disagree, moving or dropping those two fields is a map
change for the founders to approve.
