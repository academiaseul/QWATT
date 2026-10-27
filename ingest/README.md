# ingest/ — meter-agnostic ingestion (Deliverable 1)

Any meter → one record. Adapters own protocol, decoding and time alignment; they never judge.
The only thing that differs between meters is a register map, which is a JSON file.

```
Modbus meter ──► adapters/modbus.js ──┐
HTTP push    ──► adapters/http.js   ──┼──► lib/normalize.js (IntervalBuilder) ──► interval.schema.json record
CSV file     ──► adapters/csv.js    ──┘        integer mWh · grid-aligned · raw_sha256 · validated
                                                raw payloads handed on with the record, out of band (V3-5)
```

| Path | Role |
|---|---|
| `lib/registermap.js` | Loads and validates `maps/*.json`; decodes u16/i16/u32/i32/f32 with word order and scale; computes read blocks; encodes for simulators. |
| `lib/normalize.js` | `IntervalBuilder`: samples in, schema-valid interval records out. Trapezoidal integration between consecutive samples no more than three sample periods apart ([dropouts](#dropouts-v3-10)), split exactly at grid boundaries, or counter deltas. Integer units. Stamps `clock_skew_s` from its clock when an interval closes ([clock_skew_s](#clock_skew_s-v3-6)). Throws rather than emit an invalid record. |
| `adapters/modbus.js` | Modbus TCP client (no deps), Modbus RTU client (needs `serialport` on the gateway), `pollOnce`, continuous `start`, and a TCP **simulator** for tests. |
| `adapters/http.js` | `POST /samples` (intervals stamped by the builder's clock), `POST /intervals` (validated; timestamps rewritten from any RFC 3339 spelling to canonical UTC, `YYYY-MM-DDTHH:mm:ss.sssZ`, with the request hash kept in `source.raw_sha256` when a spelling changed; 400 `ingest.off_grid` when off the `dt_s` grid; `clock_skew_s` stamped by the gateway), `POST /flush`, `GET /health`. |
| `adapters/csv.js` | Replay at fast, factor or real-time pace; a replay faster than real time needs a builder on the replay clock; raw payload: see [raw_sha256](#raw_sha256) below. |
| `maps/pzem-017.json` | Bench meter A. 9600 8N2. Every field matches the manufacturer's protocol document ([sources](#register-map-sources)). |
| `maps/epever-tracer.json` | Bench meter B. 115200 8N1. PV and energy-counter registers match the EPEver protocol document; the two battery registers (0x3104, 0x3105) need a live read first ([sources](#register-map-sources)). |
| `harness.js` | **Acceptance test:** two simulated hours of solar data (10 s samples, two meters) through all three adapters must produce byte-identical records (minus `source`) and identical verdicts. The Modbus path polls a local simulator. |
| `capture-evidence.js` | Saves the harness and test output of one commit as evidence: `node ingest/capture-evidence.js <commit>` → `evidence/harness/harness-<commit>.txt`. |
| `cli.js` | Run an adapter and print intervals as JSON lines. Modbus and HTTP stamp `clock_skew_s` from the host clock; CSV from the host clock at `--pace realtime` and from the replay clock otherwise. |

```bash
node ingest/ingest.test.js          # unit tests + the acceptance harness
node ingest/harness.js              # the acceptance test alone
node ingest/cli.js modbus --a pzem-017@192.168.1.50:502 --b epever-tracer@192.168.1.51:502 --poll 5000
node ingest/cli.js csv --file day.csv --a a_w --b b_w --pace fast --sample-s 10
node ingest/cli.js http --port 8080 --sample-s 10
```

The sample period: `modbus` takes it from `--poll` (ms); `csv` and `http` from `--sample-s`
(seconds, default 10). Pass the input's real cadence (`--sample-s 60` for one-minute data), or every
gap between its samples is a [dropout](#dropouts-v3-10) and no energy is integrated. `csv` and `http`
print one warning on stderr at the first gap longer than three periods, naming its length.

## clock_skew_s (V3-6)

Every interval record carries `clock_skew_s` = receive time − `ts_end`, in whole seconds. The
`IntervalBuilder` stamps it when it closes the interval, from the clock it was built with
(`clock` is a required option):

- a function returning ms since the epoch: a real clock, read once per closed interval;
- `'replay'`: the replay clock, the latest sample timestamp pushed so far (across both meters,
  only forward, never moved by a refused sample).

| Path | Clock | What `clock_skew_s` measures |
|---|---|---|
| Modbus (TCP or RTU) | Gateway clock | Poll lateness: how long after `ts_end` the poll that closed the interval ran. |
| CSV at real-time pace | Host clock | How far the replay runs behind (or ahead of) the host clock. |
| CSV at fast or factor pace | Replay clock | Replayed time only; a wall clock is refused before the file is opened. |
| Live run (`live/run.js`) | Host clock in real time; replay clock for `fast` and every numeric speed | See `live/README.md`. |
| HTTP `POST /samples` | Gateway clock | Gateway time against the node's own timestamps: node clock error plus latency. |
| HTTP `POST /intervals` | Gateway clock (`config.now`) | Unchanged: stamped by the gateway on records posted whole. |

On the replay clock the value is 0 when the interval is closed by a sample exactly at `ts_end`,
n sample periods when that sample is missing, +`dt_s` (300) when the one-interval grace closes it
(a meter a full interval past its end), and negative at `flush()`: an interval flushed before its
end (shutdown, end of file) is received before it ended. The schema sets no minimum, and G0 judges
the magnitude: |`clock_skew_s`| ≤ `clock_max_skew_s` (7500 s on the bench profile), otherwise
`plausibility.skew`. The guard vectors `bench-clock-skew-negative` and `bench-clock-skew-early` in
`protocol/conformance/cases.json` pin that.

`clock_skew_s` is the gateway's own observation. The verifier re-judges G0 on the published value;
it cannot re-derive a real-time receive time.

## Dropouts (V3-10)

The `IntervalBuilder` takes the meters' sample period, `sample_s` (seconds, a positive number;
fractions are allowed, e.g. 2.5 for a 2500 ms poll; required). For an `integrate` meter:

- **The gap** is the time between two consecutive samples of the same meter.
- **Longer than three sample periods** (strictly more than 3 × `sample_s`, no jitter tolerance):
  integration restarts at the returning sample, and no energy is booked for the gap in any interval.
  That includes the sliver from the last sample to the end of its interval and the sliver from the
  start of the returning interval to the returning sample.
- **Exactly three periods or less:** the trapezoid between the two samples, split exactly at every
  grid boundary it spans, as before.
- **Wherever it starts:** on or off the grid, inside an interval or across a boundary, one meter or
  both. The order in which the meters are pushed does not matter.
- **Empty intervals:** an interval entirely inside a gap still closes, with 0 samples and 0 mWh for
  that meter, rather than being skipped. The gates judge it (a silent meter b fails G3 agreement).
- **First sample:** integration starts there; nothing is booked before it.
- **Real time and replay** give identical energy: the rule reads sample timestamps only, never the
  clock.
- **Counter meters** are unchanged: the delta of the instrument's own register is a measurement, not
  an interpolation, so energy counted during a dropout is booked where the meter returns (G1 judges
  it). No shipped register map uses counter mode; revisit this before one does.
- A meter returning after intervals were already closed without it also restarts (the week-1 B-1
  rule), whatever the gap's length.

The live simulator samples every 10 s (`live/run.js` passes `sim.STEP_S`); the scale test's sources
are one-minute data (`batch/scale.js --sample-s`, default 60); the CLI takes it from `--poll` or
`--sample-s`. A `sample_s` that is too large lets real dropouts be interpolated; one that is too
small cuts normal energy. Modbus polling waits `--poll` after each poll completes, so the real
period is slightly longer than `--poll`: two missed polls in a row already exceed three periods and
are cut. That loses energy rather than inventing it.

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
| CSV | The CSV line as read, without its line ending, plus `\n`. A line feeds one sample per meter column, in the order of `meters` in the config, so with two meters each line is hashed twice. An empty power cell is a missing reading, not a sample, so the line is not hashed for that meter. |
| HTTP `POST /samples` | The exact request body the sample arrived in. A body carrying n samples of one interval is hashed n times; a body whose samples straddle a boundary enters both intervals. |
| Modbus (TCP or RTU) | The reply frames of that poll, concatenated in read-block order: the whole MBAP frame over TCP, the whole frame including its CRC over RTU. Requests are not hashed. |

Records posted whole to `POST /intervals` are not built by the `IntervalBuilder`; the
`adapters/http.js` row above says what the gateway does with them. `ingest.test.js` recomputes the
hash from the input alone for CSV and HTTP, and for an RTU poll from its reply frame.

Since week 2 (V3-5) the payloads are no longer discarded after hashing. The `IntervalBuilder`
keeps them with each interval and hands them on with the closed record, out of band: under the
registered symbol `Symbol.for('qwatt.raw_payloads')`, a non-enumerable property, so the record's
JSON, its canonical bytes, its schema check, `intervals_root` and the acceptance harness are
unchanged. A record posted whole to `POST /intervals` carries its request body the same way. The
batch layer stores them in the judged ledger line, publishes them at `raw/<batch_id>.jsonl` and
commits to them with `samples_root` (next section). Any JSON round trip, spread or structured
clone of a record before the batch pipeline loses the symbol; the door then refuses the interval
with `ingest.raw_missing` and its energy is not counted, so such a path is never silent.

## samples_root (V3-5)

`samples_root` is required in every batch since batch schema 1.1.0. It is a fingerprint of every
raw reading behind the batch's window. The normative rules are in the `samples_root` description of
`protocol/batch.schema.json`:

- **R1, payload entry.** `{n, utf8}` or `{n, hex}`. Its bytes are the UTF-8 of `utf8`, or `hex`
  decoded (lowercase, whole bytes). `n` ≥ 1 counts the consecutive samples of the interval that
  arrived with exactly these bytes.

  | Adapter | Entry |
  |---|---|
  | CSV | The row as read plus `\n`, one entry per row; `n` = the meters with a reading (2, or 1 when a power cell is empty). |
  | HTTP `POST /samples` | The request body: `utf8` when its bytes round-trip as UTF-8, otherwise `hex`. One entry per interval the body feeds; `n` = its samples in that interval. |
  | Modbus (TCP or RTU) | The reply frames of one poll, concatenated, as `hex`; `n` 1. |
  | HTTP `POST /intervals` | The request body; `n` 1. |

- **R2, binding.** The SHA-256 of the stream (each entry's bytes `n` times, in order) equals the
  interval's `source.raw_sha256`: the rule in the section above, unchanged. Exempt: an interval
  with no `source.raw_sha256`; and a record posted whole (`source.adapter` `http-json`) that kept
  its node's own `raw_sha256`, whose frames the gateway never saw. Its one payload (`n` 1, `utf8`)
  must then be that record as posted: the same canonical JSON apart from the `clock_skew_s` the
  gateway stamps. No other interval can pass off its own JSON as its raw payload. An accepted or
  gate-refused interval needs a non-empty, bound payload list. An interval in which no meter sent
  anything has no payload, so the door records it as `ingest.raw_missing` and counts nothing.
- **R3, raw line.** One line per interval judged in the window, accepted or refused: canonical JSON
  of `{"payloads":[…],"seq":…,"ts_start":…,"verdict":"accept"|"reject"}` plus `\n` (`seq` only if
  a safe integer and `ts_start` only if a string, otherwise `null`). Lines are in time order:
  `Date.parse(ts_start)` ascending (unreadable last), an accepted line before a refused one at the
  same start, otherwise in judgment order. A restart therefore republishes identical bytes.
- **R4, root.** The `intervals_root` pairing (parent = SHA-256 of the two hex strings
  concatenated, an odd node paired with itself, no leaves = SHA-256 of no bytes) over SHA-256 of the
  bytes of every payload entry of every raw line, in file order. Neither `n` nor the encoding enters
  a leaf: a payload is proven by the root, its count only through `raw_sha256`.

`protocol/conformance/batch-cases.json` pins `samples_root` for three batches and five vectors
(raw lines in, in R3 order, root out: an `n` and a hex case, and one for the R3 order itself) for
other implementations. The verifier recomputes the root from the published file and ties each
line to its interval (`batch/README.md`).

These rules differ from the wording of the agreed freeze v3 V3-5 row (which says a root over each
raw payload line "in sample order"): leaves are the payload bytes (hex is only how binary payloads
are published), one leaf per run of identical consecutive payloads with its count `n` outside the
leaf, and lines in interval time order. They are recorded as deviation **DV-6**, for both founders
to sign.

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
current and power read wrong; and the 5 V power source over 100 mA that the RS-485 side needs (PZ1 §5).

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
