# ⚡ QWATT mining rig — proof of generation

This is QWATT's "mining" bridge. QWATT is not mined with hashpower — it's mined with
**sunlight**: a solar panel generates real kWh, a Modbus energy meter measures them, and
this service pays the rig's wallet **0.001 QWATT per kWh** (1 QWATT = 1 MWh) from the
distributor treasury. Every payout is a Stellar transaction with a proof-of-generation
memo like `PoG:1.250kWh@173.44/MWh` — the amount of energy and the spot price at that
moment, attested on-chain forever.

## Quick start (no hardware needed)

```bash
npm install
```

```bash
node miner.js --simulate --dry-run
```

The simulator runs an accelerated solar day (~2 real minutes per day at the default
`speedup: 720`) and `--dry-run` prints the payouts it would make without touching the
network — no secrets needed.

To pay out for real on testnet:

1. Open `config.json` (created on first run) and set `distributorSecret` to the
   distributor `S…` key from the genesis console.
2. Run `node miner.js --simulate`. On first run it creates `wallet.json` (the rig's own
   wallet), funds it with Friendbot, opens the QWATT trustline, and starts mining.
3. Watch the payouts arrive: each one links the rig wallet on
   [stellar.expert](https://stellar.expert/explorer/testnet) with its PoG memo.

Useful flags: `--cycles 3` (stop after 3 payouts), `--threshold 0.5` (payout every 0.5 kWh).

## The first real kit (no batteries)

A battery-less "direct" system is the simplest legal-ish test rig because the panel's
output is consumed immediately — nothing is stored:

```
PV panel(s) ──DC──> grid-tie microinverter ──AC──> building circuits (self-consumption)
                          │
                          └── Modbus kWh meter on the inverter's AC output
                                      │ RS-485
                              RS-485↔TCP gateway (or USB-RS485 on a Raspberry Pi)
                                      │ Modbus TCP
                                 miner.js (this service)
                                      │
                                 Stellar testnet — QWATT payout + PoG memo
```

Shopping list (typical):

| Part | Example | Notes |
|---|---|---|
| Panel | 1–2 × 400 W mono | any brand |
| Microinverter | Hoymiles HM-400 / APsystems | grid-tie, no batteries; sized to the panel |
| Energy meter | Eastron SDM120M or SDM630 (DIN rail) | the Modbus RTU measurement point |
| RS-485 bridge | USR-W630 / Elfin EW11 (RS485→WiFi/TCP), or a USB-RS485 dongle | gives the meter an IP |
| Host | Raspberry Pi or any PC | runs `miner.js` 24/7 |

Wire the meter so it measures **only the inverter's production** (its AC output), not the
whole house — that's what makes payouts equal generated energy.

⚠️ AC-side wiring must be done by an electrician, and feeding a grid-tie inverter into a
home circuit falls under your local interconnection rules (in Chile: netbilling,
Ley 21.118). For a first bench test you can keep everything on one metered circuit
feeding a resistive load.

## Pointing it at your meter

Edit `config.json` → `source`:

```json
"source": {
  "mode": "modbus-tcp",
  "host": "192.168.1.50",
  "port": 502,
  "unitId": 1,
  "register": { "type": "input", "addr": 12, "count": 2, "format": "float32be", "scale": 1 },
  "measures": "power_w"
}
```

- `measures: "power_w"` — the register is instantaneous power in W; the miner integrates
  it over time. Example: Eastron SDM120 active power = input register `0x000C` (addr 12),
  2 registers, float32 big-endian.
- `measures: "energy_kwh"` — the register is a cumulative kWh counter; the miner pays out
  the deltas. More robust across restarts. Example: SDM120 total active energy =
  input register `0x0156` (addr 342), float32.
- **Always verify addresses against your meter's datasheet** — register maps differ
  between models and firmware.

The Modbus client is built in (plain Modbus TCP, function codes 3/4) — no drivers needed.
If your meter is RS-485-only, the TCP gateway in the shopping list translates transparently.

## How the payout works on-chain

```
distributor (treasury) ── payment: 0.001 QWATT/kWh ──> rig wallet
                          memo: PoG:<kWh>kWh@<USD>/MWh
```

Payouts come from the distributor's 42.7M QWATT treasury (the "ecosystem" allocation) —
supply is not inflated. The spot price in the memo comes from the same oracle as the site
(EPEX day-ahead via aWATTar, converted to USD). A real production system would replace the
single distributor key with a Soroban contract verifying signed meter readings — this
bridge is the testnet proof of that loop.

## Files

- `miner.js` — the whole service (simulator, Modbus TCP client, Stellar payouts)
- `config.json` — your settings + distributor secret (**gitignored, keep private**)
- `wallet.json` — the rig's auto-created wallet (**gitignored**)
