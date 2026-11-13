#!/usr/bin/env node
// qwatt-issuance · Phase 2 mechanics spike + end-to-end evidence on a LOCAL standalone network.
//
// Proves or disproves, on a real stellar-core + RPC (stellar/quickstart --local):
//   M1  the asset admin of a classic asset's SAC can be set to a contract;
//   M2  the issuers can then be locked (master weight 0) and still nothing breaks;
//   M3  a locked issuer can no longer issue: a classic payment from it is refused;
//   M4  nobody but the contract can mint (direct SAC mint by anyone else is refused);
//   M5  retire() mints and burns the same amount in one call: the contract balance is 0
//       after the call, and mint/burn events net to zero;
//   M6  governance is a classic 2-of-3 account: one signature is refused, two pass;
//   M7  accrual needs both relay keys: a one-key relay is refused.
// and records fees and resources for every transaction.
//
// Safety: refuses to run unless the RPC reports the standalone passphrase. Every key is
// Keypair.random() held in memory for this process only; no secret is printed, logged
// or written. Nothing here can reach testnet or mainnet.
//
// Usage: node local-spike.mjs [--rpc http://localhost:8000/rpc] [--out <dir>]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Account, Address, Asset, BASE_FEE, Contract, Keypair, Operation, SorobanDataBuilder, TransactionBuilder,
  authorizeEntry, nativeToScVal, scValToNative, rpc,
} from '@stellar/stellar-sdk';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const RPC_URL = arg('--rpc', 'http://localhost:8000/rpc');
const OUT = resolve(arg('--out', join(HERE, '..', 'evidence', 'local')));
const WASM = resolve(HERE, '..', 'target', 'wasm32v1-none', 'release', 'qwatt_issuance.wasm');
const STANDALONE = 'Standalone Network ; February 2017';
const TAG_STATEMENT = 'QWATT/statement/v1\u0000';

const server = new rpc.Server(RPC_URL, { allowHttp: true });
const log = [];      // every step, in order
const checks = [];   // PASS/FAIL per mechanic
const sha256 = (buf) => createHash('sha256').update(buf).digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(id, title, pass, detail) {
  checks.push({ id, title, result: pass ? 'PASS' : 'FAIL', detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${title}${detail ? '  · ' + detail : ''}`);
}

// ---------- helpers -----------------------------------------------------------------

async function fund(kp) {
  const r = await fetch(`${RPC_URL.replace(/\/rpc$/, '')}/friendbot?addr=${kp.publicKey()}`);
  if (!r.ok) throw new Error(`friendbot ${r.status}`);
}

async function waitTx(hash) {
  for (let i = 0; i < 60; i++) {
    const t = await server.getTransaction(hash);
    if (t.status !== 'NOT_FOUND') return t;
    await sleep(500);
  }
  throw new Error('timeout waiting for ' + hash);
}

// v17 XDR: unions expose `.type` and the arm as a property. Follow the chain of types.
function typeChain(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 6) return [];
  const out = v.type ? [v.type] : [];
  for (const [k, x] of Object.entries(v)) {
    if (k === 'type' || k === 'ext') continue;
    if (Array.isArray(x)) { if (x.length) return out.concat(typeChain(x[0], depth + 1)); continue; }
    if (x && typeof x === 'object' && (x.type || Object.values(x).some((y) => y && typeof y === 'object' && y.type))) return out.concat(typeChain(x, depth + 1));
  }
  return out;
}
function resultCode(t) { try { return typeChain(t.resultXdr.result).join('/'); } catch { return t.status; } }
function feeCharged(t) { try { return Number(BigInt(t.resultXdr.feeCharged)); } catch { return null; } }

function resourcesOf(txData) {
  if (!txData) return null;
  const r = txData.resources;
  return {
    instructions: r.instructions,
    disk_read_bytes: r.diskReadBytes,
    write_bytes: r.writeBytes,
    footprint_read_only: r.footprint.readOnly.length,
    footprint_read_write: r.footprint.readWrite.length,
    resource_fee: Number(BigInt(txData.resourceFee)),
  };
}

/** Submit a signed transaction and record it. */
async function submit(step, tx, extra = {}) {
  const sent = await server.sendTransaction(tx);
  let entry = { step, hash: sent.hash, ...extra };
  if (sent.status === 'ERROR') {
    let code = 'ERROR';
    try { code = typeChain(sent.errorResult.result).join('/'); } catch {}
    entry = { ...entry, status: 'REJECTED_AT_SUBMIT', result: code };
    log.push(entry); return entry;
  }
  const t = await waitTx(sent.hash);
  entry = { ...entry, status: t.status, ledger: t.ledger, result: resultCode(t), fee_charged_stroops: feeCharged(t) };
  if (t.status === 'SUCCESS' && t.returnValue) {
    try { entry.return = toJson(scValToNative(t.returnValue)); } catch {}
  }
  log.push(entry);
  return { ...entry, raw: t };
}

function toJson(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v).toString('hex');
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)]));
  return v;
}

async function classic(step, sourceKp, ops, signers) {
  const acct = await server.getAccount(sourceKp.publicKey());
  let b = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: STANDALONE });
  for (const op of ops) b = b.addOperation(op);
  const tx = b.setTimeout(60).build();
  for (const s of signers) tx.sign(s);
  return submit(step, tx);
}

/**
 * Invoke a host function.
 * authSigners: Map<G-address, Keypair> for Address-credential auth entries. An entry whose
 * address is missing from the map is left unsigned (used to prove one-key refusals).
 * forceSubmit: on simulation failure, submit anyway with the record-mode footprint, so the
 * refusal is a real failed transaction rather than only a simulation.
 */
async function invoke(step, { source, txSigners, op, authSigners = new Map(), forceSubmit = false }) {
  const acct0 = await server.getAccount(source.publicKey());
  const fresh = () => new Account(acct0.accountId(), acct0.sequenceNumber());
  const build = (o) => new TransactionBuilder(fresh(), { fee: BASE_FEE, networkPassphrase: STANDALONE })
    .addOperation(o).setTimeout(60).build();
  // 1) record-mode simulation (no signatures yet)
  const sim1 = await server.simulateTransaction(build(op));
  if (rpc.Api.isSimulationError(sim1)) {
    const entry = { step, status: 'REFUSED_IN_SIMULATION', error: sim1.error.split('\n')[0].slice(0, 300) };
    log.push(entry); return entry;
  }
  // 2) sign Address-credential auth entries
  const latest = (await server.getLatestLedger()).sequence;
  const auth = [];
  let unsigned = 0;
  for (const e of sim1.result.auth) {
    const c = e.credentials;
    const ac = c.type === 'sorobanCredentialsAddress' ? c.address : c.type === 'sorobanCredentialsAddressV2' ? c.addressV2 : null;
    if (!ac) { auth.push(e); continue; }
    const addr = Address.fromScAddress(ac.address).toString();
    const kp = authSigners.get(addr);
    if (!kp) { auth.push(e); unsigned++; continue; }
    auth.push(await authorizeEntry(e, kp, latest + 100, STANDALONE));
  }
  const fn = build(op).operations[0].func;
  const signedOp = Operation.invokeHostFunction({ func: fn, auth });
  // 3) enforcing-mode simulation with the signed entries, for exact resources
  const sim2 = await server.simulateTransaction(build(signedOp));
  let tx;
  let simInfo;
  if (rpc.Api.isSimulationError(sim2)) {
    const err = sim2.error.split('\n')[0].slice(0, 300);
    if (!forceSubmit) {
      const entry = { step, status: 'REFUSED_IN_SIMULATION', error: err, unsigned_auth_entries: unsigned };
      log.push(entry); return entry;
    }
    // submit anyway with the record-mode data and generous resources
    const d0 = sim1.transactionData.build();
    const fee = Number(BigInt(d0.resourceFee)) * 2 + 1_000_000;
    const data = new SorobanDataBuilder(d0)
      .setResources(d0.resources.instructions * 2 + 1_000_000, d0.resources.diskReadBytes + 10_000, d0.resources.writeBytes + 10_000)
      .setResourceFee(fee).build();
    tx = new TransactionBuilder(fresh(), { fee: String(fee + 100), networkPassphrase: STANDALONE })
      .addOperation(signedOp).setSorobanData(data).setTimeout(60).build();
    simInfo = { simulation_error: err };
  } else {
    tx = rpc.assembleTransaction(build(signedOp), sim2).build();
    simInfo = {
      sim_min_resource_fee_stroops: Number(sim2.minResourceFee),
      sim_cpu_insns: Number(sim2.cost?.cpuInsns ?? 0) || undefined,
      sim_mem_bytes: Number(sim2.cost?.memBytes ?? 0) || undefined,
      resources: resourcesOf(sim2.transactionData.build()),
    };
  }
  for (const s of txSigners) tx.sign(s);
  return submit(step, tx, { ...simInfo, unsigned_auth_entries: unsigned });
}

const call = (contractId, fn, ...args) => new Contract(contractId).call(fn, ...args);
const addr = (kp) => new Address(kp.publicKey()).toScVal();
const caddr = (id) => new Address(id).toScVal();
const b32 = (buf) => nativeToScVal(Buffer.from(buf), { type: 'bytes' });
const u128 = (n) => nativeToScVal(BigInt(n), { type: 'u128' });
const u64 = (n) => nativeToScVal(BigInt(n), { type: 'u64' });
const u32 = (n) => nativeToScVal(n, { type: 'u32' });

async function readOnly(contractId, fn, ...args) {
  const src = await server.getAccount(VIEWER.publicKey());
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: STANDALONE })
    .addOperation(call(contractId, fn, ...args)).setTimeout(60).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${fn}: ${sim.error.split('\n')[0]}`);
  return scValToNative(sim.result.retval);
}

async function accountEntry(pub) {
  const a = await server.getAccountEntry(pub);
  const th = a.thresholds?.toBytes ? a.thresholds.toBytes() : a.thresholds;
  return {
    master_weight: th[0], low: th[1], medium: th[2], high: th[3],
    signers: a.signers.map((x) => ({ key: x.key.type, weight: x.weight })),
  };
}

// ---------- the run -----------------------------------------------------------------

let VIEWER;

async function main() {
  const net = await server.getNetwork();
  if (net.passphrase !== STANDALONE) {
    console.error(`Refusing to run: RPC passphrase is "${net.passphrase}", not the local standalone network.`);
    process.exit(2);
  }
  const wasm = readFileSync(WASM);
  const wasmSha = sha256(wasm).toString('hex');
  console.log(`local network, protocol ${net.protocolVersion}; wasm ${wasm.length} B sha256 ${wasmSha}`);

  // In-memory keys only.
  const K = {};
  for (const n of ['deployer', 'issuerLive', 'issuerSim', 'gov', 'g1', 'g2', 'g3', 'proposer', 'verifier', 'relayer', 'alice', 'mallory', 'viewer']) K[n] = Keypair.random();
  VIEWER = K.viewer;
  for (const n of ['deployer', 'issuerLive', 'issuerSim', 'gov', 'proposer', 'verifier', 'relayer', 'alice', 'mallory', 'viewer']) await fund(K[n]);
  const pub = Object.fromEntries(Object.entries(K).map(([k, v]) => [k, v.publicKey()]));

  const QWATT = new Asset('QWATT', pub.issuerLive);
  const QSIM = new Asset('QWA0SIM', pub.issuerSim);

  // Governance: classic 2-of-3 account, master weight 0, thresholds 2/2/3 (as Instaward #1).
  await classic('gov.setup 2-of-3', K.gov, [
    Operation.setOptions({ signer: { ed25519PublicKey: pub.g1, weight: 1 } }),
    Operation.setOptions({ signer: { ed25519PublicKey: pub.g2, weight: 1 } }),
    Operation.setOptions({ signer: { ed25519PublicKey: pub.g3, weight: 1 } }),
    Operation.setOptions({ masterWeight: 0, lowThreshold: 2, medThreshold: 2, highThreshold: 3 }),
  ], [K.gov]);

  // SACs for both assets.
  const sacLive = QWATT.contractId(STANDALONE);
  const sacSim = QSIM.contractId(STANDALONE);
  await invoke('sac.deploy QWATT', { source: K.deployer, txSigners: [K.deployer], op: Operation.createStellarAssetContract({ asset: QWATT }) });
  await invoke('sac.deploy QWA0SIM', { source: K.deployer, txSigners: [K.deployer], op: Operation.createStellarAssetContract({ asset: QSIM }) });

  // Upload and deploy the issuance contract (constructor sets roles and assets).
  await invoke('wasm.upload', { source: K.deployer, txSigners: [K.deployer], op: Operation.uploadContractWasm({ wasm }) });
  const salt = sha256(Buffer.from('qwatt-issuance local spike ' + Date.now()));
  const dep = await invoke('contract.deploy', {
    source: K.deployer, txSigners: [K.deployer],
    op: Operation.createCustomContract({
      address: new Address(pub.deployer), wasmHash: sha256(wasm), salt,
      constructorArgs: [addr(K.gov), addr(K.proposer), addr(K.verifier), caddr(sacLive), caddr(sacSim)],
    }),
  });
  const CID = dep.return;
  console.log("contract", CID); for (const e of log) console.log("  ", JSON.stringify({...e, resources: undefined}).slice(0, 300));

  // M1: admin of each SAC → the contract (needs the issuer, so before the lock).
  for (const [sac, iss, name] of [[sacLive, K.issuerLive, 'QWATT'], [sacSim, K.issuerSim, 'QWA0SIM']]) {
    await invoke(`sac.set_admin ${name} → contract`, { source: iss, txSigners: [iss], op: call(sac, 'set_admin', caddr(CID)) });
  }
  const adminLive = await readOnly(sacLive, 'admin');
  const adminSim = await readOnly(sacSim, 'admin');
  check('M1', 'SAC admin of both assets is the issuance contract', adminLive === CID && adminSim === CID, `QWATT admin ${adminLive}`);

  // M2: lock both issuers (master weight 0, no other signer).
  for (const [iss, name] of [[K.issuerLive, 'QWATT'], [K.issuerSim, 'QWA0SIM']]) {
    await classic(`issuer.lock ${name} (master weight 0)`, iss, [Operation.setOptions({ masterWeight: 0 })], [iss]);
  }
  const accL = await accountEntry(pub.issuerLive);
  const accS = await accountEntry(pub.issuerSim);
  check('M2', 'both issuers locked: master weight 0, no signers', accL.master_weight === 0 && accL.signers.length === 0 && accS.master_weight === 0 && accS.signers.length === 0,
    `QWATT issuer thresholds ${JSON.stringify(accL)}`);

  // M3: a locked issuer cannot issue on the classic side.
  await classic('mallory trustline QWATT', K.mallory, [Operation.changeTrust({ asset: QWATT })], [K.mallory]);
  const pay = await classic('REFUSAL locked issuer classic payment', K.issuerLive, [Operation.payment({ destination: pub.mallory, asset: QWATT, amount: '1' })], [K.issuerLive]);
  check('M3', 'locked issuer: classic payment refused', pay.status !== 'SUCCESS', `${pay.status} ${pay.result ?? ''}`);
  const relock = await invoke('REFUSAL locked issuer tries set_admin back', { source: K.mallory, txSigners: [K.mallory], op: call(sacLive, 'set_admin', addr(K.issuerLive)), authSigners: new Map([[pub.issuerLive, K.issuerLive]]), forceSubmit: true });
  check('M3b', 'locked issuer cannot take the SAC admin back', relock.status !== 'SUCCESS', `${relock.status} ${relock.result ?? relock.error ?? ''}`);

  // M4: nobody but the contract can mint.
  const m1 = await invoke('REFUSAL direct SAC mint by issuer key', { source: K.mallory, txSigners: [K.mallory], op: call(sacLive, 'mint', addr(K.mallory), nativeToScVal(10n, { type: 'i128' })), authSigners: new Map([[pub.issuerLive, K.issuerLive]]) });
  const m2 = await invoke('REFUSAL direct SAC mint by mallory', { source: K.mallory, txSigners: [K.mallory], op: call(sacLive, 'mint', addr(K.mallory), nativeToScVal(10n, { type: 'i128' })), authSigners: new Map([[pub.mallory, K.mallory]]), forceSubmit: true });
  check('M4', 'direct SAC mint refused for the issuer key and for any other key', m1.status !== 'SUCCESS' && m2.status !== 'SUCCESS', `${m1.status}; ${m2.status} ${m2.result ?? ''}`);

  // M6: governance 2-of-3.
  const siteLive = sha256(Buffer.from('QWATT/site/v1\u0000bench-dc-01'));
  const siteSim = sha256(Buffer.from('QWATT/site/v1\u0000flow-a-shared-roof'));
  const g1only = await invoke('REFUSAL register_site with 1 of 3 governance signatures', {
    source: K.gov, txSigners: [K.g1], op: call(CID, 'register_site', b32(siteLive), addr(K.alice), u32(1), u64(0)),
  });
  const reg = await invoke('register_site LIVE (2 of 3 governance)', {
    source: K.gov, txSigners: [K.g1, K.g2], op: call(CID, 'register_site', b32(siteLive), addr(K.alice), u32(1), u64(0)),
  });
  await invoke('register_site SIMULATED (2 of 3 governance)', {
    source: K.gov, txSigners: [K.g2, K.g3], op: call(CID, 'register_site', b32(siteSim), addr(K.alice), u32(0), u64(0)),
  });
  check('M6', 'governance: one signature refused, two accepted', g1only.status !== 'SUCCESS' && reg.status === 'SUCCESS', `${g1only.status} ${g1only.result ?? ''}; ${reg.status}`);

  // M7: two-key relay.
  const both = new Map([[pub.proposer, K.proposer], [pub.verifier, K.verifier]]);
  const onlyProposer = new Map([[pub.proposer, K.proposer]]);
  const batch = (n) => sha256(Buffer.from(`batch ${n}`));
  const oneKey = await invoke('REFUSAL accrue with proposer key only', {
    source: K.relayer, txSigners: [K.relayer], op: call(CID, 'accrue', b32(siteLive), u64(0), u128(412_000_999n), b32(batch(0)), u32(2)), authSigners: onlyProposer, forceSubmit: true,
  });
  const acc0 = await invoke('accrue LIVE seq 0 (both relay keys)', {
    source: K.relayer, txSigners: [K.relayer], op: call(CID, 'accrue', b32(siteLive), u64(0), u128(412_000_999n), b32(batch(0)), u32(2)), authSigners: both,
  });
  check('M7', 'accrual: one relay key refused, both accepted', oneKey.status !== 'SUCCESS' && acc0.status === 'SUCCESS', `${oneKey.status} ${oneKey.result ?? oneKey.error ?? ''}; ${acc0.status}`);
  await invoke('accrue SIMULATED seq 0', {
    source: K.relayer, txSigners: [K.relayer], op: call(CID, 'accrue', b32(siteSim), u64(0), u128(5_000_000n), b32(batch(100)), u32(0)), authSigners: both,
  });
  const contam = await invoke('REFUSAL simulated (A0) batch on the LIVE site', {
    source: K.relayer, txSigners: [K.relayer], op: call(CID, 'accrue', b32(siteLive), u64(1), u128(413_000_000n), b32(batch(1)), u32(0)), authSigners: both,
  });

  await invoke('accrue LIVE seq 1', {
    source: K.relayer, txSigners: [K.relayer], op: call(CID, 'accrue', b32(siteLive), u64(1), u128(413_000_000n), b32(batch(1)), u32(2)), authSigners: both,
  });

  // M5: retire = mint + burn in one call, zero outstanding.
  const statement = 'These 412,000 Wh generated on this roof in January are allocated to these six apartments. (local spike, fictional)';
  const sh = sha256(Buffer.concat([Buffer.from(TAG_STATEMENT), Buffer.from(statement, 'utf8')]));
  const ret = await invoke('retire LIVE [0, 412000) Wh', {
    source: K.alice, txSigners: [K.alice], op: call(CID, 'retire', b32(siteLive), u128(0), u128(412_000), b32(sh)),
  });
  const balAfter = await readOnly(sacLive, 'balance', caddr(CID));
  // events of that transaction
  let minted = 0n; let burned = 0n; const evNames = [];
  if (ret.raw) {
    const ev = await server.getEvents({ startLedger: ret.ledger, endLedger: ret.ledger + 1, filters: [{ type: 'contract', contractIds: [sacLive, CID] }] });
    for (const e of ev.events.filter((x) => x.txHash === ret.hash)) {
      const name = scValToNative(e.topic[0]);
      evNames.push(`${String(e.contractId) === CID ? 'issuance' : 'SAC'}:${name}`);
      const v = scValToNative(e.value);
      const amt = typeof v === 'bigint' ? v : (v && typeof v === 'object' && 'amount' in v ? BigInt(v.amount) : 0n);
      if (name === 'mint') minted += amt;
      if (name === 'burn') burned += amt;
    }
  }
  check('M5', 'retire mints and burns 4,120,000 stroops (0.412 QWATT) in one call; contract balance 0 after', ret.status === 'SUCCESS' && balAfter === 0n && minted === 4_120_000n && burned === 4_120_000n,
    `${ret.status}; balance ${balAfter}; minted ${minted}; burned ${burned}; events ${evNames.join(' ')}`);

  // Refusals on the network after a retirement.
  const dup = await invoke('REFUSAL same statement again (next range)', { source: K.alice, txSigners: [K.alice], op: call(CID, 'retire', b32(siteLive), u128(412_000), u128(413_000), b32(sh)) });
  const overlap = await invoke('REFUSAL overlapping range', { source: K.alice, txSigners: [K.alice], op: call(CID, 'retire', b32(siteLive), u128(100), u128(200), b32(sha256(Buffer.from('other')))) });
  const over = await invoke('REFUSAL over-retire (beyond accrued 413,000 Wh)', { source: K.alice, txSigners: [K.alice], op: call(CID, 'retire', b32(siteLive), u128(412_000), u128(413_001), b32(sha256(Buffer.from('x')))) });
  const xfer = await invoke('REFUSAL SAC transfer out of the contract by mallory', { source: K.mallory, txSigners: [K.mallory], op: call(sacLive, 'transfer', caddr(CID), addr(K.mallory), nativeToScVal(1n, { type: 'i128' })) });
  const notResp = await invoke('REFUSAL retire signed by mallory (not responsible)', { source: K.mallory, txSigners: [K.mallory], op: call(CID, 'retire', b32(siteLive), u128(412_000), u128(413_000), b32(sha256(Buffer.from('m')))), authSigners: new Map([[pub.mallory, K.mallory]]) });

  // Simulated retirement goes to QWA0SIM, never QWATT.
  const shSim = sha256(Buffer.concat([Buffer.from(TAG_STATEMENT), Buffer.from('flow A fictional allocation', 'utf8')]));
  const retSim = await invoke('retire SIMULATED [0, 5000) Wh on QWA0SIM', { source: K.alice, txSigners: [K.alice], op: call(CID, 'retire', b32(siteSim), u128(0), u128(5000), b32(shSim)) });
  const balSim = await readOnly(sacSim, 'balance', caddr(CID));

  const siteState = toJson(await readOnly(CID, 'site', b32(siteLive)));
  const stmt = toJson(await readOnly(CID, 'statement', b32(sh)));
  const qwattClassic = await (async () => {
    // classic supply: mallory's trustline (the only one) must hold 0
    try { const tl = await server.getTrustline(pub.mallory, QWATT); return String(BigInt(tl.balance)); } catch (e) { return 'none: ' + e.message; }
  })();
  check('M8', 'zero outstanding: contract SAC balances 0 (QWATT and QWA0SIM), the only classic trustline holds 0', balAfter === 0n && balSim === 0n && qwattClassic === '0', `QWATT ${balAfter}, QWA0SIM ${balSim}, trustline ${qwattClassic}`);

  const refusals = log.filter((e) => e.step.startsWith('REFUSAL'));
  check('R', 'every scripted refusal was refused', refusals.every((e) => e.status !== 'SUCCESS'), `${refusals.filter((e) => e.status !== 'SUCCESS').length}/${refusals.length}`);

  const out = {
    generated_at: new Date().toISOString(),
    network: { rpc: RPC_URL, passphrase: net.passphrase, protocol: net.protocolVersion, kind: 'local standalone (stellar/quickstart --local)' },
    wasm: { bytes: wasm.length, sha256: wasmSha },
    contract: CID,
    assets: { QWATT: { sac: sacLive, issuer: pub.issuerLive }, QWA0SIM: { sac: sacSim, issuer: pub.issuerSim } },
    public_keys: Object.fromEntries(Object.entries(pub).filter(([k]) => k !== 'viewer')),
    note: 'Public keys only. Every secret was Keypair.random() held in memory for this run and discarded.',
    checks,
    site_after: siteState,
    statement_record: stmt,
    transactions: log,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'spike-run.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`\n${checks.filter((c) => c.result === 'PASS').length}/${checks.length} checks PASS · evidence ${join(OUT, 'spike-run.json')}`);
  console.log('\nfees (successful invocations):');
  for (const e of log.filter((x) => x.status === 'SUCCESS' && x.resources)) {
    console.log(`  ${e.step.padEnd(42)} fee ${String(e.fee_charged_stroops).padStart(9)}  insns ${String(e.resources.instructions).padStart(9)}  read ${e.resources.disk_read_bytes}  write ${e.resources.write_bytes}`);
  }
  if (checks.some((c) => c.result !== 'PASS')) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
