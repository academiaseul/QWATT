#!/usr/bin/env node
/**
 * QWATT — proposer service (Deliverable 3)
 * ---------------------------------------------------------------------------
 *   node anchor/proposer.js --feed <dir> --config anchor/config.json --sign-with-key qwatt-proposer \
 *        [--stellar-bin stellar] [--interval 30] [--max-walk 168]
 *
 * The proposer key is the stellar-cli identity `qwatt-proposer` on this host
 * (freeze v3, V3-8): stellar-cli signs, and Node never reads a secret. A secret
 * in the environment is refused. At start the CLI checks that the identity's
 * key is `signers.proposer` in the public config and signs one throwaway
 * transaction offline, so a missing or wrong key stops it at once (exit 2).
 *
 * Runs next to the batch pipeline and writes into the evidence-feed directory
 * that is published as static files. Each tick:
 *
 *   1. read the chain head (Horizon) and the batch ledger (local feed);
 *   2. record anchored/<id>.json for batches the chain now covers, and clear
 *      their pending transactions;
 *   3. for the next accepted batch: if it is published, walks back to the
 *      on-chain head exactly as the verifier does (chain.walkToHead, over the
 *      local feed), self-verifies against the copies that walk rehashed, and
 *      has no live proposal, build the anchoring transaction, sign it with the
 *      proposer key and publish pending/<id>.xdr. Otherwise it returns
 *      'blocked' with the reason the verifier would give, so the two services
 *      cannot disagree about whether a batch can be anchored.
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
const SG = require('./signer');

/** Re-propose this long before expiry, so the verifier never races a dying window. */
const EXPIRY_MARGIN_S = 600;

class Proposer {
  /**
   * @param {object} o
   * @param {string} o.feedDir
   * @param {object} o.cfg       anchor config (tx.js AnchorConfig) + horizon_url
   * @param {object} [o.signer]  signs as the proposer (anchor/signer.js cliSigner: stellar-cli on this host)
   * @param {import('@stellar/stellar-sdk').Keypair} [o.keypair]  instead of a signer, for tests and throwaway rehearsals only
   * @param {object} [o.server]  Horizon server (injectable for tests)
   * @param {number} [o.maxWalk]  most batches walked back to the on-chain head (default chain.MAX_WALK_BATCHES; CLI --max-walk)
   */
  constructor(o) {
    T.checkConfig(o.cfg);
    this.feed = new Feed(o.feedDir);
    this.cfg = o.cfg;
    this.signer = o.signer || (o.keypair && SG.keypairSigner(o.keypair));
    if (!this.signer) throw new Error('Proposer: a signer is required (stellar-cli through anchor/signer.js; a keypair only in tests and throwaway rehearsals)');
    this.server = o.server || new S.Horizon.Server(o.cfg.horizon_url);
    this.maxWalk = o.maxWalk == null ? C.MAX_WALK_BATCHES : C.checkMaxWalk(o.maxWalk);
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
    if (batch.sha256 !== next.sha256) return { action: 'blocked', batch_id: next.batch_id, reasons: ['verifier.hash_mismatch'], detail: 'batch file differs from the batch ledger entry' };
    /* the verifier's walk, over the local feed: what the batch inherits must lead back to the on-chain
       head within the same bound, or the verifier would refuse it. The batch is then judged against the
       copies the walk rehashed: the previous batch, and the anchored head as the floor. */
    const walk = await C.walkToHead(batch, head, (id) => (this.feed.hasBatch(id) ? this.feed.readBatch(id) : null), { maxSteps: this.maxWalk });
    if (!walk.ok) return { action: 'blocked', batch_id: next.batch_id, reasons: [walk.code], detail: walk.detail };
    const check = V.verifyBatch(batch, { prev: walk.prev, floor: walk.floor, rejected: this.feed.readLedger('rejected') });
    if (!check.ok) return { action: 'blocked', batch_id: next.batch_id, reasons: check.failures.map((f) => f.code) };

    const pf = this._pendingFile(next.batch_id);
    if (fs.existsSync(pf)) {
      const cur = new S.Transaction(fs.readFileSync(pf, 'utf8').trim(), this.cfg.network_passphrase);
      const maxTime = Number(cur.timeBounds.maxTime);
      const seqOk = BigInt(cur.sequence) === BigInt(head.sequence) + 1n;
      if (seqOk && maxTime - EXPIRY_MARGIN_S > nowS) return { action: 'wait', reason: 'proposal live, awaiting co-signature', batch_id: next.batch_id };
    }

    const tx = T.buildAnchorTx(batch, this.cfg, T.proposalParams(head.sequence, nowS));
    const signed = await this.signer.sign(tx);   // stellar-cli returns a new, checked Transaction: use the returned one
    this.feed._writeAtomic(pf, signed.toEnvelope().toXDR('base64') + '\n');
    return { action: 'proposed', batch_id: next.batch_id, tx_hash: signed.hash().toString('hex'), sequence: signed.sequence };
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
  let maxWalk;
  try { maxWalk = C.maxWalkArg(args); } catch (e) { console.error(e.message); process.exit(2); }
  const usage = 'usage: node anchor/proposer.js --feed <dir> --config anchor.json --sign-with-key qwatt-proposer [--stellar-bin stellar] [--interval 30] [--max-walk 168]';
  const env = SG.refuseEnvSecrets(['QWATT_PROPOSER_SECRET']);
  if (env) { console.error(env); process.exit(2); }
  if (!args.includes('--sign-with-key')) { console.error(`--sign-with-key <identity> is required (the stellar-cli identity that holds the proposer key)\n${usage}`); process.exit(2); }
  const cfg = loadConfig(opt('--config', path.join(__dirname, 'config.json')));
  const { signer, error } = await SG.signerForRole({ args, cfg, role: 'proposer', envNames: ['QWATT_PROPOSER_SECRET'] });
  if (error) { console.error(`${error}\n${usage}`); process.exit(2); }
  console.log(new Date().toISOString(), `proposer key ${signer.publicKey} (stellar-cli identity ${signer.identity})`);
  const p = new Proposer({ feedDir: path.resolve(opt('--feed', 'feed')), cfg, signer, maxWalk });
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
