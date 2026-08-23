#!/usr/bin/env node
/*
 * QWATT mining rig — Quorelia proof-of-generation bridge.
 *
 * Reads solar generation from a Modbus TCP energy meter (or a built-in solar
 * simulator), accumulates the energy produced, and pays out QWATT from the
 * distributor treasury to this rig's wallet: 1 QWATT = 1 MWh, so 1 kWh mined
 * pays 0.001 QWATT. Every payout carries a proof-of-generation (PoG) memo
 * with the kWh amount and the electricity spot price at that moment, leaving
 * a permanent attestation on the Stellar testnet ledger.
 *
 * Usage:
 *   node miner.js                  run with config.json (Modbus or simulate)
 *   node miner.js --simulate       force the solar simulator
 *   node miner.js --dry-run        never submit payouts, just print them
 *   node miner.js --cycles 3       exit after 3 payouts (default: run forever)
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const StellarSdk = require('@stellar/stellar-sdk');

/* ---------------- config ---------------- */
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};

const CONFIG_PATH = path.join(__dirname, 'config.json');
const EXAMPLE_PATH = path.join(__dirname, 'config.example.json');
if (!fs.existsSync(CONFIG_PATH)) {
  fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
  console.log('[setup] config.json created from config.example.json — edit it to add your distributor secret and meter address.');
}
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const DRY_RUN = flag('--dry-run');
const SIMULATE = flag('--simulate') || cfg.source.mode === 'simulate';
const MAX_CYCLES = parseInt(opt('--cycles', '0'), 10) || 0;
const THRESHOLD = parseFloat(opt('--threshold', String(cfg.payoutThresholdKwh || 0.1)));
const POLL_S = Math.max(1, Number(cfg.pollSeconds) || 5);

const HORIZON = cfg.horizon;
const server = new StellarSdk.Horizon.Server(HORIZON);
const QWATT = new StellarSdk.Asset(cfg.assetCode, cfg.assetIssuer);

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

/* ---------------- energy price (for the PoG memo attestation) ---------------- */
let spotUsdMwh = null;
let spotFetchedAt = 0;
async function refreshSpot() {
  if (Date.now() - spotFetchedAt < 300000) return;
  let eurUsd = 1.08;
  try {
    const cg = await (await fetch('https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd,eur')).json();
    if (cg?.stellar?.usd > 0 && cg?.stellar?.eur > 0) eurUsd = cg.stellar.usd / cg.stellar.eur;
  } catch (e) {}
  try {
    const now = Date.now();
    const aw = await (await fetch('https://api.awattar.de/v1/marketdata')).json();
    const cur = (aw.data || []).find((d) => d.start_timestamp <= now && now < d.end_timestamp);
    if (cur) {
      spotUsdMwh = cur.marketprice * eurUsd;
      spotFetchedAt = Date.now();          // success: refresh again in 5 min
      return;
    }
  } catch (e) {}
  spotFetchedAt = Date.now() - 240000;     // failure: retry in ~1 min
}

/* ---------------- generation sources ---------------- */
/* Minimal Modbus TCP client — one read per call, no external dependencies. */
function readModbusRegisters(src) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: src.host, port: src.port, timeout: 3000 });
    const fail = (err) => { sock.destroy(); reject(err); };
    sock.on('timeout', () => fail(new Error(`Modbus timeout: no reply from ${src.host}:${src.port}`)));
    sock.on('error', fail);
    sock.on('connect', () => {
      const fc = src.register.type === 'holding' ? 0x03 : 0x04;
      const req = Buffer.alloc(12);
      req.writeUInt16BE(Math.floor(Math.random() * 0xffff), 0); // transaction id
      req.writeUInt16BE(0, 2);                                  // protocol id
      req.writeUInt16BE(6, 4);                                  // length
      req.writeUInt8(src.unitId, 6);
      req.writeUInt8(fc, 7);
      req.writeUInt16BE(src.register.addr, 8);
      req.writeUInt16BE(src.register.count, 10);
      sock.write(req);
    });
    sock.on('data', (buf) => {
      sock.destroy();
      if (buf.length < 9) return reject(new Error('Modbus: short response'));
      const fc = buf.readUInt8(7);
      if (fc & 0x80) return reject(new Error(`Modbus exception code ${buf.readUInt8(8)}`));
      const data = buf.subarray(9, 9 + buf.readUInt8(8));
      let value;
      switch (src.register.format) {
        case 'float32be': value = data.readFloatBE(0); break;
        case 'uint32be':  value = data.readUInt32BE(0); break;
        case 'int16':     value = data.readInt16BE(0); break;
        default:          value = data.readUInt16BE(0);
      }
      resolve(value * (src.register.scale || 1));
    });
  });
}

/* Solar simulator: a full day passes in 24h/speedup, with a clean irradiance bell. */
let simClock = 8 * 3600; // start the virtual day at 08:00 — the sun is already up
function simulatePowerW(dtRealS) {
  simClock += dtRealS * (cfg.simulate.speedup || 720);
  const hour = (simClock / 3600) % 24;
  const irr = hour > 6 && hour < 18 ? Math.sin((Math.PI * (hour - 6)) / 12) : 0;
  const clouds = 0.9 + 0.1 * Math.random();
  return { watts: (cfg.simulate.peakWatts || 400) * irr * clouds, virtualHour: hour };
}

/* ---------------- persistent state (crash safety) ---------------- */
/* accKwh survives restarts (store-and-forward: no measured energy is lost) and
   lastEventId makes payouts idempotent — each carries a PoG#<id> memo, and on
   startup the chain is consulted so a crash between submit and save can never
   produce a double payment. */
const STATE_PATH = path.join(__dirname, 'state.json');
let state = { accKwh: 0, lastEventId: 0 };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) }; } catch (e) {}
function saveState() {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); } catch (e) {}
}
async function syncLastEventId(minerPub) {
  try {
    const txs = await server.transactions().forAccount(minerPub).order('desc').limit(30).call();
    for (const t of txs.records) {
      const m = /^PoG#(\d+):/.exec(t.memo || '');
      if (m) return parseInt(m[1], 10);
    }
  } catch (e) {}
  return 0;
}

/* ---------------- miner wallet ---------------- */
const WALLET_PATH = path.join(__dirname, 'wallet.json');
async function ensureMinerWallet() {
  if (fs.existsSync(WALLET_PATH)) {
    const w = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'));
    log(`miner wallet: ${w.public.slice(0, 6)}…${w.public.slice(-6)} (wallet.json)`);
    return StellarSdk.Keypair.fromSecret(w.secret);
  }
  const kp = StellarSdk.Keypair.random();
  log(`creating miner wallet ${kp.publicKey().slice(0, 6)}… and funding via Friendbot…`);
  const r = await fetch(`${cfg.friendbot}?addr=${kp.publicKey()}`);
  if (!r.ok) throw new Error(`Friendbot failed (HTTP ${r.status})`);
  const acct = await server.loadAccount(kp.publicKey());
  const tx = new StellarSdk.TransactionBuilder(acct, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.changeTrust({ asset: QWATT, limit: '1000000' }))
    .addMemo(StellarSdk.Memo.text('QWATT miner trustline'))
    .setTimeout(90)
    .build();
  tx.sign(kp);
  await server.submitTransaction(tx);
  fs.writeFileSync(WALLET_PATH, JSON.stringify({ public: kp.publicKey(), secret: kp.secret() }, null, 2));
  log(`miner wallet funded + QWATT trustline open — saved to wallet.json`);
  return kp;
}

/* ---------------- payout ---------------- */
async function payout(distKp, minerPub, kwh, id) {
  const amount = (kwh / 1000).toFixed(7); // 1 QWATT = 1 MWh
  let memo = `PoG#${id}:${kwh.toFixed(3)}kWh`;
  if (spotUsdMwh !== null) memo += `@${spotUsdMwh.toFixed(2)}/MWh`;
  memo = memo.slice(0, 28);
  if (DRY_RUN) {
    log(`DRY RUN — would pay ${amount} QWATT to miner, memo "${memo}"`);
    return { dryRun: true };
  }
  const acct = await server.loadAccount(distKp.publicKey());
  const tx = new StellarSdk.TransactionBuilder(acct, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.payment({ destination: minerPub, asset: QWATT, amount }))
    .addMemo(StellarSdk.Memo.text(memo))
    .setTimeout(90)
    .build();
  tx.sign(distKp);
  const res = await server.submitTransaction(tx);
  log(`⚡ MINED ${amount} QWATT for ${kwh.toFixed(3)} kWh — tx ${res.hash.slice(0, 8)}… memo "${memo}"`);
  return res;
}

/* ---------------- main loop ---------------- */
(async () => {
  log(`QWATT mining rig starting — source: ${SIMULATE ? 'SOLAR SIMULATOR' : `Modbus TCP ${cfg.source.host}:${cfg.source.port}`}${DRY_RUN ? ' (dry run)' : ''}`);
  log(`payout threshold: ${THRESHOLD} kWh -> ${(THRESHOLD / 1000).toFixed(4)} QWATT per payout`);

  let distKp = null;
  if (!DRY_RUN) {
    if (!cfg.distributorSecret || cfg.distributorSecret.startsWith('PASTE')) {
      console.error('\nconfig.json has no distributorSecret. Paste the distributor S… key from the genesis console,');
      console.error('or run with --dry-run to test without submitting payouts.\n');
      process.exit(1);
    }
    distKp = StellarSdk.Keypair.fromSecret(cfg.distributorSecret);
  }
  const minerKp = await ensureMinerWallet();
  await refreshSpot();

  const chainId = await syncLastEventId(minerKp.publicKey());
  state.lastEventId = Math.max(state.lastEventId, chainId);
  let accKwh = state.accKwh || 0;
  if (accKwh > 0) log(`estado recuperado: ${accKwh.toFixed(4)} kWh pendientes · último evento PoG#${state.lastEventId}`);
  let lastCounter = null;
  let cycles = 0;
  let lastT = Date.now();

  while (true) {
    await new Promise((r) => setTimeout(r, POLL_S * 1000));
    const nowT = Date.now();
    const dt = (nowT - lastT) / 1000;
    lastT = nowT;
    await refreshSpot();

    try {
      let watts = 0, note = '';
      if (SIMULATE) {
        const sim = simulatePowerW(dt);
        watts = sim.watts;
        note = ` (virtual ${String(Math.floor(sim.virtualHour)).padStart(2, '0')}:${String(Math.floor((sim.virtualHour % 1) * 60)).padStart(2, '0')})`;
        accKwh += (watts * dt * (cfg.simulate.speedup || 720)) / 3600000;
      } else if (cfg.source.measures === 'energy_kwh') {
        const counter = await readModbusRegisters(cfg.source);
        if (lastCounter !== null && counter >= lastCounter) accKwh += counter - lastCounter;
        lastCounter = counter;
        watts = NaN;
      } else {
        watts = await readModbusRegisters(cfg.source);
        accKwh += (watts * dt) / 3600000;
      }

      const spot = spotUsdMwh !== null ? `$${spotUsdMwh.toFixed(2)}/MWh` : 'spot n/a';
      log(`${Number.isNaN(watts) ? 'meter' : Math.round(watts) + ' W'}${note} | pending ${accKwh.toFixed(4)} kWh | ${spot}`);
      state.accKwh = accKwh;
      saveState();

      if (accKwh >= THRESHOLD) {
        const kwh = accKwh;
        const id = state.lastEventId + 1;
        await payout(distKp, minerKp.publicKey(), kwh, id);
        accKwh = 0; // solo tras el éxito — si el pago falla, la energía medida se conserva
        state.accKwh = 0;
        state.lastEventId = id;
        saveState();
        cycles++;
        if (MAX_CYCLES && cycles >= MAX_CYCLES) {
          log(`done — ${cycles} payout(s) completed.`);
          process.exit(0);
        }
      }
    } catch (e) {
      log(`error: ${e.message || e}${e.response?.data?.extras?.result_codes ? ' ' + JSON.stringify(e.response.data.extras.result_codes) : ''}`);
    }
  }
})();
