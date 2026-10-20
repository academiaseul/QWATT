#!/usr/bin/env node
/**
 * QWATT — proposer service (Deliverable 3)
 * ---------------------------------------------------------------------------
 *   QWATT_PROPOSER_SECRET=S… node anchor/proposer.js --feed <dir> --config anchor/config.json [--interval 30]
 *
 * Runs next to the batch pipeline and writes into the evidence-feed directory
 * that is published as static files. Each tick:
 *
 *   1. read the chain head (Horizon) and the batch ledger (local feed);
 *   2. record anchored/<id>.json for batches the chain now covers, and clear
 *      their pending transactions;
 *   3. for the next accepted batch: if it is published, self-verifies and has
 *      no live proposal, build the anchoring transaction, sign it with the
 *      proposer key and publish pending/<id>.xdr.
 *
 * Publish before sign: a proposal is only ever written for a batch that is
 * already in the feed, so the verifier can never be asked to sign something it
 * cannot download. The proposer never submits; one signature cannot anchor.
 * State lives on the chain and in the feed, so a restart resumes cleanly, and
 * an expired or sequence-stale proposal is simply rebuilt.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const S = require('@stellar/stellar-sdk');
const { Feed } = require('../batch/feed');
const V = require('../batch/verify');
const T = require('./tx');
const C = require('./chain');

/** Re-propose this long before expiry, so the verifier never races a dying window. */
const EXPIRY_MARGIN_S = 600;

class Proposer {
  /**
   * @param {object} o
   * @param {string} o.feedDir
   * @param {object} o.cfg       anchor config (tx.js AnchorConfig) + horizon_url
   * @param {import('@stellar/stellar-sdk').Keypair} o.keypair  proposer key (a signer on the anchoring account)
   * @param {object} [o.server]  Horizon server (injectable for tests)
   */
  constructor(o) {
    T.checkConfig(o.cfg);
    this.feed = new Feed(o.feedDir);
    this.cfg = o.cfg;
    this.keypair = o.keypair;
    this.server = o.server || new S.Horizon.Server(o.cfg.horizon_url);
    for (const sub of ['pending', 'anchored']) fs.mkdirSync(this.feed.p(sub), { recursive: true });
  }

  _pendingFile(id) { return this.feed.p('pending', `${id}.xdr`); }
  _anchoredFile(id) { return this.feed.p('anchored', `${id}.json`); }

  async tick(nowS = Math.floor(Date.now() / 1000)) {
    const skew = await C.clockSkewS(this.server, nowS);
    if (Math.abs(skew) > C.MAX_CLOCK_SKEW_S) return { action: 'wait', reason: `local clock ${skew}s off the network; not proposing`, skew_s: skew };
    const listed = this.feed.readLedger('batches');
    const head = await C.getHead(this.server, this.cfg.anchor_account);
    const prefix = C.anchoredPrefix(listed, head.anchor_sha256);

    /* 2. anchored records, derived from the chain, and cleanup of their proposals */
    for (let i = 0; i < prefix; i++) {
      const e = listed[i];
      if (e.status !== 'accepted') continue;
      if (fs.existsSync(this._pendingFile(e.batch_id))) fs.unlinkSync(this._pendingFile(e.batch_id));
      if (!fs.existsSync(this._anchoredFile(e.batch_id))) {
        const found = await C.findAnchorTx(this.server, this.cfg.anchor_account, e);
        this.feed._writeAtomic(this._anchoredFile(e.batch_id), JSON.stringify({
          batch_id: e.batch_id, seq: e.seq, sha256: e.sha256,
          tx_hash: found ? found.tx_hash : null, ledger: found ? found.ledger : null, anchored_at: found ? found.created_at : null,
        }, null, 2) + '\n');
      }
    }

    /* 3. the next batch */
    const next = C.nextToAnchor(listed, prefix);
    if (!next) return { action: 'idle', anchored: prefix };
    if (!this.feed.hasBatch(next.batch_id)) return { action: 'wait', reason: 'batch listed but file not yet written', batch_id: next.batch_id };

    const batch = this.feed.readBatch(next.batch_id);
    const prev = batch.seq > 0 ? this.feed.readBatch(listed[batch.seq - 1].batch_id) : null;
    const check = V.verifyBatch(batch, { prev, rejected: this.feed.readLedger('rejected') });
    if (!check.ok || batch.sha256 !== next.sha256) {
      return { action: 'blocked', batch_id: next.batch_id, reasons: check.failures.map((f) => f.code) };
    }

    const pf = this._pendingFile(next.batch_id);
    if (fs.existsSync(pf)) {
      const cur = new S.Transaction(fs.readFileSync(pf, 'utf8').trim(), this.cfg.network_passphrase);
      const maxTime = Number(cur.timeBounds.maxTime);
      const seqOk = BigInt(cur.sequence) === BigInt(head.sequence) + 1n;
      if (seqOk && maxTime - EXPIRY_MARGIN_S > nowS) return { action: 'wait', reason: 'proposal live, awaiting co-signature', batch_id: next.batch_id };
    }

    const tx = T.buildAnchorTx(batch, this.cfg, T.proposalParams(head.sequence, nowS));
    tx.sign(this.keypair);
    this.feed._writeAtomic(pf, tx.toEnvelope().toXDR('base64') + '\n');
    return { action: 'proposed', batch_id: next.batch_id, tx_hash: tx.hash().toString('hex'), sequence: tx.sequence };
  }
}

function loadConfig(file) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (cfg.network_passphrase === 'TESTNET') cfg.network_passphrase = S.Networks.TESTNET;
  return cfg;
}

async function cli() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const secret = process.env.QWATT_PROPOSER_SECRET;
  if (!secret) { console.error('QWATT_PROPOSER_SECRET is not set; refusing to start'); process.exit(2); }
  const p = new Proposer({ feedDir: path.resolve(opt('--feed', 'feed')), cfg: loadConfig(opt('--config', path.join(__dirname, 'config.json'))), keypair: S.Keypair.fromSecret(secret) });
  const every = Number(opt('--interval', 30)) * 1000;
  const run = async () => {
    try { console.log(new Date().toISOString(), JSON.stringify(await p.tick())); }
    catch (e) { console.error(new Date().toISOString(), 'tick failed (will retry):', e.message); }
  };
  await run();
  if (!args.includes('--once')) setInterval(run, every);
}

if (require.main === module) cli();

module.exports = { Proposer, loadConfig, EXPIRY_MARGIN_S };
