#!/usr/bin/env node
/*
 * QWATT testnet redeploy — recovery tool for Stellar testnet resets.
 *
 * The testnet is wiped roughly quarterly, destroying the QWATT asset. This
 * script turns recovery into one command:
 *
 *   node redeploy-testnet.js --check     verify every current address/hash is
 *                                        where the patcher expects it (safe, no
 *                                        network writes — run this anytime)
 *   node redeploy-testnet.js --go        run a NEW genesis on testnet, patch
 *                                        every file, update config.json, and
 *                                        save the new keys locally
 *
 * After --go: review `git diff`, save the keys from
 * mining-rig/deployment-keys.local.txt somewhere safe, then deploy the site
 * (`npx vercel --prod`).
 */

const fs = require('fs');
const path = require('path');
const StellarSdk = require('@stellar/stellar-sdk');

const ROOT = path.join(__dirname, '..');
const DEPLOYMENT = path.join(ROOT, 'deployment.json');
const PATCH_FILES = ['index.html', 'respaldo.html', 'red.html', 'whitepaper.html', 'README.md', '.well-known/stellar.toml'];
const HORIZON = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const SUPPLY_LIMIT = '100000000';

const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function shortForms(hash) {
  return [`${hash.slice(0, 8)}&hellip;${hash.slice(-6)}`, `${hash.slice(0, 8)}&hellip;`];
}

function buildReplacements(oldD, newD) {
  const [oldShortLong, oldShort] = shortForms(oldD.genesisTx);
  const [newShortLong, newShort] = shortForms(newD.genesisTx);
  return [
    [oldD.issuer, newD.issuer],
    [oldD.distributor, newD.distributor],
    [oldD.genesisTx, newD.genesisTx],
    [oldShortLong, newShortLong],
    [oldShort, newShort],
    [oldD.genesisLedgerDisplay, newD.genesisLedgerDisplay],
    [oldD.genesisDateES, newD.genesisDateES],
    [oldD.genesisDateEN, newD.genesisDateEN],
  ];
}

function check(oldD) {
  console.log('— modo verificación: buscando los valores actuales en los archivos —');
  let missing = 0;
  const probes = [
    ['issuer', oldD.issuer],
    ['distributor', oldD.distributor],
    ['genesisTx', oldD.genesisTx],
    ['tx corto', shortForms(oldD.genesisTx)[1]],
    ['ledger', oldD.genesisLedgerDisplay],
  ];
  for (const f of PATCH_FILES) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const found = probes.filter(([, v]) => s.includes(v)).map(([n]) => n);
    console.log(`  ${f}: ${found.length ? found.join(', ') : '(sin coincidencias)'}`);
    if (f === 'index.html' && found.length < 4) missing++;
  }
  console.log(missing ? '\n⚠ index.html no contiene todos los valores esperados — revisar antes de --go' : '\n✓ los archivos contienen los valores esperados; --go puede parchear con seguridad');
}

async function genesis() {
  const server = new StellarSdk.Horizon.Server(HORIZON);
  const issuerKp = StellarSdk.Keypair.random();
  const distKp = StellarSdk.Keypair.random();
  console.log('genesis: creando y financiando cuentas…');
  for (const kp of [issuerKp, distKp]) {
    const r = await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
    if (!r.ok) throw new Error(`Friendbot falló (HTTP ${r.status}) para ${kp.publicKey()}`);
  }
  const asset = new StellarSdk.Asset('QWATT', issuerKp.publicKey());
  const distAcct = await server.loadAccount(distKp.publicKey());
  const tx = new StellarSdk.TransactionBuilder(distAcct, { fee: StellarSdk.BASE_FEE, networkPassphrase: StellarSdk.Networks.TESTNET })
    .addOperation(StellarSdk.Operation.changeTrust({ asset, limit: SUPPLY_LIMIT }))
    .addOperation(StellarSdk.Operation.payment({ source: issuerKp.publicKey(), destination: distKp.publicKey(), asset, amount: '42700000' }))
    .addMemo(StellarSdk.Memo.text('QWATT genesis 1QWATT=1MWh'))
    .setTimeout(90)
    .build();
  tx.sign(distKp); tx.sign(issuerKp);
  const res = await server.submitTransaction(tx);
  console.log(`genesis confirmada: tx ${res.hash.slice(0, 8)}… ledger ${res.ledger}`);
  return { issuerKp, distKp, hash: res.hash, ledger: res.ledger };
}

async function go(oldD) {
  const g = await genesis();
  const now = new Date();
  const newD = {
    ...oldD,
    issuer: g.issuerKp.publicKey(),
    distributor: g.distKp.publicKey(),
    genesisTx: g.hash,
    genesisLedger: g.ledger,
    genesisLedgerDisplay: g.ledger.toLocaleString('en-US'),
    genesisDateES: `${now.getDate()} de ${MONTHS_ES[now.getMonth()]} de ${now.getFullYear()}`,
    genesisDateEN: `${MONTHS_EN[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`,
  };
  const reps = buildReplacements(oldD, newD);
  for (const f of PATCH_FILES) {
    const p = path.join(ROOT, f);
    let s = fs.readFileSync(p, 'utf8');
    let n = 0;
    for (const [from, to] of reps) { const c = s.split(from).length - 1; n += c; s = s.split(from).join(to); }
    fs.writeFileSync(p, s, 'utf8');
    console.log(`  ${f}: ${n} reemplazos`);
  }
  fs.writeFileSync(DEPLOYMENT, JSON.stringify(newD, null, 2) + '\n', 'utf8');

  // config.json del rig: nuevo emisor + secret del distribuidor
  const cfgPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.assetIssuer = newD.issuer;
    cfg.distributorSecret = g.distKp.secret();
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    console.log('  mining-rig/config.json: emisor y secret actualizados');
  }
  // el wallet del rig pertenece a la red anterior — se regenera en el próximo arranque
  const walletPath = path.join(__dirname, 'wallet.json');
  if (fs.existsSync(walletPath)) {
    fs.renameSync(walletPath, walletPath + '.pre-reset');
    console.log('  mining-rig/wallet.json: archivado (.pre-reset); el miner creará uno nuevo');
  }

  const keysPath = path.join(__dirname, 'deployment-keys.local.txt');
  fs.writeFileSync(keysPath,
    `QWATT testnet deployment — ${now.toISOString()}\n` +
    `GUARDA ESTE ARCHIVO FUERA DE LÍNEA Y NO LO COMPARTAS\n\n` +
    `EMISOR  pub: ${newD.issuer}\n        sec: ${g.issuerKp.secret()}\n` +
    `DISTRIB pub: ${newD.distributor}\n        sec: ${g.distKp.secret()}\n` +
    `genesis tx: ${g.hash}\nledger: ${g.ledger}\n`, 'utf8');
  console.log(`\n✓ redeploy completo.\n  claves: mining-rig/deployment-keys.local.txt (gitignored — guárdalas fuera de línea)\n  siguiente: revisar git diff → npx vercel --prod`);
}

(async () => {
  const oldD = JSON.parse(fs.readFileSync(DEPLOYMENT, 'utf8'));
  const mode = process.argv[2];
  if (mode === '--check') return check(oldD);
  if (mode === '--go') return go(oldD);
  console.log('uso: node redeploy-testnet.js --check | --go   (ver comentario del archivo)');
})().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
