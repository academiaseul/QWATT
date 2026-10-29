#!/usr/bin/env node
/**
 * QWATT — independent verifier service (Deliverable 3)
 * ---------------------------------------------------------------------------
 *   node anchor/verifier.js --feed https://<public feed> --config anchor/config.json --sign-with-key qwatt-verifier \
 *        [--stellar-bin stellar] [--state ./verifier-state] [--interval 30] [--port 8090 (127.0.0.1 only)] [--max-walk 168]
 *
 * The verifier key is the stellar-cli identity `qwatt-verifier` on this host
 * (freeze v3, V3-8): stellar-cli signs, and Node never reads a secret. A secret
 * in the environment is refused. At start the CLI checks that the identity's
 * key is `signers.verifier` in the public config and signs one throwaway
 * transaction offline, so a missing or wrong key stops it at once (exit 2).
 * A tick on which stellar-cli cannot sign ends as an error with reason
 * `signer`: nothing is refused, signed or submitted.
 *
 * Runs on a separate host with a separate key. Its ONLY input is the public
 * evidence feed (a base URL) plus the public chain. Each tick:
 *
 *   0. the clock check, then the chain head from Horizon, then ONE commit of the
 *      public evidence (anchor/feed-client.js snapshot: the branch of the evidence
 *      repository resolved to its head commit; freeze v3 V3-7, D7). Every file of
 *      the tick is read at that commit. Horizon comes first: a batch is published
 *      before it is signed, so every batch the head names is in the snapshot;
 *   1. chain head → anchored prefix → the next accepted batch;
 *   2. download pending/<id>.xdr; if there is none, nothing has been proposed;
 *   3. download the batch; if it is not published, refuse (verifier.not_published);
 *   4. walk back from the batch to the on-chain head (chain.walkToHead): every
 *      earlier batch downloaded once and rehashed, every running total re-added
 *      (a batch never anchored carries the total forward unchanged), and the
 *      walk must end at the on-chain anchor with the on-chain cumulative, so an
 *      inherited total is never taken on trust (verifier.head_mismatch otherwise;
 *      verifier.walk_too_long when the walk stops at its bound, --max-walk);
 *   5. re-derive the batch with the shared verifyBatch (hash, root, chain,
 *      arithmetic, time, every gate) against the copies the walk rehashed: the
 *      previous batch, and the anchored head as the floor;
 *   6. rebuild the anchoring transaction from the batch and compare it with the
 *      pending one byte for byte (matchPending);
 *   7. only if everything agrees: add the second signature and submit.
 *
 * Its public log (freeze v3, V3-7), kept in <state>:
 *   decisions.jsonl  every decision, appended once: 'signed' (with the hash of the
 *                    transaction it signed, written BEFORE the submission) or
 *                    'refused' (with the reasons), each with feed_commit, the evidence
 *                    commit it judged (null for a feed that is not a repository);
 *   refusals.jsonl   every refusal, appended once (the same format as before);
 *   status.json      replaced whole each tick (written to a temporary name, then renamed).
 * Only `ops/publish-feed.js --kind verifier-log` (qwatt-verifier-log.service, verifier
 * host) publishes them, to academiaseul/qwatt-verifier-log/<run>/. --port serves them
 * on 127.0.0.1 only, for the operator. A submission that times out is never blindly
 * retried: the next tick re-reads the chain first, so a transaction that landed
 * despite the timeout is recognised instead of being sent twice.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const S = require('@stellar/stellar-sdk');
const V = require('../batch/verify');
const T = require('./tx');
const C = require('./chain');
const { makeFeedClient, FeedUnavailable } = require('./feed-client');
const { loadConfig } = require('./proposer');
const SG = require('./signer');

/** The lines of a .jsonl file; a trailing line that does not parse (being written) is ignored. */
function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const lines = text.split('\n').filter((l) => l.trim());
  const out = [];
  lines.forEach((l, i) => {
    try { out.push(JSON.parse(l)); } catch (e) { if (i < lines.length - 1) throw new Error(`${file} line ${i + 1} is not JSON`); }
  });
  return out;
}

/** Cut a trailing partial line (no line feed after it) off a .jsonl file; a missing file is left alone. */
function dropTornTail(file) {
  let fd;
  try { fd = fs.openSync(file, 'r+'); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  try {
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(65536);
    let end = size, keep = 0;
    while (end > 0) {
      const n = Math.min(buf.length, end);
      fs.readSync(fd, buf, 0, n, end - n);
      const i = buf.subarray(0, n).lastIndexOf(0x0a);
      if (i >= 0) { keep = end - n + i + 1; break; }
      end -= n;
    }
    if (keep !== size) { fs.ftruncateSync(fd, keep); fs.fsyncSync(fd); }
  } finally { fs.closeSync(fd); }
}

class Verifier {
  /**
   * @param {object} o
   * @param {string} o.feedUrl    public base URL of the evidence feed — the only input path
   * @param {object} [o.feedOptions]  anchor/feed-client.js options ({ timeoutMs, pin }; pin = assets/qwatt-pin.js origins, for tests)
   * @param {object} o.cfg        anchor config + horizon_url
   * @param {object} [o.signer]   signs as the verifier (anchor/signer.js cliSigner: stellar-cli on this host)
   * @param {import('@stellar/stellar-sdk').Keypair} [o.keypair]  instead of a signer, for tests and throwaway rehearsals only
   * @param {string} o.stateDir   where decisions.jsonl, refusals.jsonl and status.json are kept
   * @param {object} [o.server]
   * @param {number} [o.maxWalk]  most batches walked back to the on-chain head (default chain.MAX_WALK_BATCHES; CLI --max-walk)
   */
  constructor(o) {
    T.checkConfig(o.cfg);
    this.feed = makeFeedClient(o.feedUrl, o.feedOptions);
    this.cfg = o.cfg;
    this.signer = o.signer || (o.keypair && SG.keypairSigner(o.keypair));
    if (!this.signer) throw new Error('Verifier: a signer is required (stellar-cli through anchor/signer.js; a keypair only in tests and throwaway rehearsals)');
    this.server = o.server || new S.Horizon.Server(o.cfg.horizon_url);
    this.maxWalk = o.maxWalk == null ? C.MAX_WALK_BATCHES : C.checkMaxWalk(o.maxWalk);
    this.stateDir = o.stateDir;
    fs.mkdirSync(this.stateDir, { recursive: true });
    this.refusalsFile = path.join(this.stateDir, 'refusals.jsonl');
    this.decisionsFile = path.join(this.stateDir, 'decisions.jsonl');
    /* the counters are what the logs hold, so a restart never resets them */
    this.status = {
      started_at: new Date().toISOString(), last_tick: null, last_result: null, feed: o.feedUrl, feed_commit: null,
      signed: readJsonl(this.decisionsFile).filter((d) => d.decision === 'signed').length,
      refused: readJsonl(this.refusalsFile).length,
    };
  }

  /**
   * Append one line and fsync it before going on (as batch/feed.js does). A file that does not end in a
   * line feed holds half a line from a power cut during an earlier append: it was never complete, so never
   * published (the publisher takes complete lines only), and is cut off first. Appending after it would glue
   * this line to it, and readJsonl would refuse the log from then on.
   */
  _append(file, obj) {
    dropTornTail(file);
    const fd = fs.openSync(file, 'a');
    try { fs.writeSync(fd, JSON.stringify(obj) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  _logged(file, match) { return readJsonl(file).some(match); }

  /** One decision line per (decision, batch, proposal). @returns whether a line was appended */
  _decide(entry, decision, txHash, reasons, detail) {
    if (this._logged(this.decisionsFile, (d) => d.decision === decision && d.batch_id === entry.batch_id && d.pending_tx_hash === txHash)) return false;
    this._append(this.decisionsFile, { at: new Date().toISOString(), batch_id: entry.batch_id, seq: entry.seq, batch_sha256: entry.sha256, decision, pending_tx_hash: txHash, reasons, detail, feed_commit: this.feed.commit });
    return true;
  }

  /** @param {object} entry  the batch-ledger entry judged ({batch_id, seq, sha256}) */
  _refuse(entry, pendingXdr, reasons, detail) {
    let txHash = null;
    try { txHash = new S.Transaction(pendingXdr, this.cfg.network_passphrase).hash().toString('hex'); } catch (e) { /* unparseable: hash stays null */ }
    const result = { action: 'refused', batch_id: entry.batch_id, reasons, detail: detail || null };
    if (!this._logged(this.refusalsFile, (r) => r.batch_id === entry.batch_id && r.pending_tx_hash === txHash)) {
      this._append(this.refusalsFile, { at: new Date().toISOString(), batch_id: entry.batch_id, pending_tx_hash: txHash, reasons, detail: detail || null });
      this.status.refused++;
    }
    this._decide(entry, 'refused', txHash, reasons, detail || null);
    return result;
  }

  async tick(nowS = Math.floor(Date.now() / 1000)) {
    /* reason 'signer': stellar-cli could not sign (missing, identity gone, a bad answer). An error, not a
       refusal: nothing is refused, signed or submitted, and the next tick starts again from the chain. */
    const result = await this._tick(nowS).catch((e) => ({
      action: 'error', reason: e instanceof FeedUnavailable ? 'verifier.feed_unavailable' : e instanceof SG.SignerError ? 'signer' : 'internal', detail: e.message,
    }));
    this.status.last_tick = new Date().toISOString();
    this.status.last_result = result;
    /* replaced whole: a reader (the verifier-log publisher) never sees half a file */
    const file = path.join(this.stateDir, 'status.json'), tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(this.status, null, 2) + '\n');
    fs.renameSync(tmp, file);
    return result;
  }

  async _tick(nowS) {
    const skew = await C.clockSkewS(this.server, nowS);
    if (Math.abs(skew) > C.MAX_CLOCK_SKEW_S) return { action: 'wait', reason: `local clock ${skew}s off the network; refusing to judge timebounds`, skew_s: skew };
    /* Horizon first, then one commit of the public evidence: the proposer publishes a batch before it
       signs, so every batch the head names is in a snapshot taken after it (V3-7c) */
    const head = await C.getHead(this.server, this.cfg.anchor_account);
    await this.feed.snapshot();
    this.status.feed_commit = this.feed.commit;
    const listed = await this.feed.batches();
    const prefix = C.anchoredPrefix(listed, head.anchor_sha256);
    const next = C.nextToAnchor(listed, prefix);
    if (!next) return { action: 'idle', anchored: prefix };

    const pending = await this.feed.pending(next.batch_id);
    if (pending == null) return { action: 'wait', reason: 'nothing proposed', batch_id: next.batch_id };
    /* an expired proposal is routine after downtime, not an attack: wait for the fresh one */
    try {
      const tb = new S.Transaction(pending, this.cfg.network_passphrase).timeBounds;
      if (tb && Number(tb.maxTime) !== 0 && Number(tb.maxTime) <= nowS) return { action: 'wait', reason: 'proposal expired; awaiting a fresh one', batch_id: next.batch_id };
    } catch (e) { /* unparseable: matchPending below refuses it with a reason */ }

    const batch = await this.feed.batch(next.batch_id);
    if (batch == null) return this._refuse(next, pending, ['verifier.not_published'], 'pending transaction names a batch that is not in the public feed');
    if (batch.sha256 !== next.sha256) return this._refuse(next, pending, ['verifier.hash_mismatch'], 'batch file differs from the batch ledger entry');

    /* what the batch inherits is believed only once it leads back to the on-chain head (S1). Each
       earlier batch is downloaded once, and the batch is judged against those same rehashed copies:
       the previous batch, and the anchored head as the floor for time, node and counted intervals. */
    const walk = await C.walkToHead(batch, head, (id) => this.feed.batch(id), { maxSteps: this.maxWalk });
    if (!walk.ok) return this._refuse(next, pending, [walk.code], walk.detail);
    const check = V.verifyBatch(batch, { prev: walk.prev, floor: walk.floor, rejected: await this.feed.rejected(), raw: await this.feed.raw(next.batch_id) });
    if (!check.ok) return this._refuse(next, pending, [...new Set(check.failures.map((f) => f.code))], 'batch does not re-derive');

    const m = T.matchPending(pending, batch, this.cfg, nowS);
    if (!m.match) return this._refuse(next, pending, m.reasons, m.detail);
    if (BigInt(m.tx.sequence) !== BigInt(head.sequence) + 1n) return { action: 'wait', reason: 'proposal sequence is stale; waiting for a fresh proposal', batch_id: next.batch_id };

    /* stellar-cli returns a new, checked Transaction: submit the returned one. A SignerError ends the
       tick with reason 'signer' before anything is logged as signed. */
    const signed = await this.signer.sign(m.tx);
    /* logged BEFORE the submission: if the line cannot be written this throws, tick() reports
       'internal' and nothing is submitted. The hash is the anchoring transaction's hash on Horizon
       (the same as m.tx.hash(): a Stellar transaction hash does not cover its signatures). */
    const txHash = signed.hash().toString('hex');
    if (this._decide(next, 'signed', txHash, [], null)) this.status.signed++;
    try {
      const res = await this.server.submitTransaction(signed);
      return { action: 'anchored', batch_id: next.batch_id, tx_hash: res.hash, ledger: res.ledger };
    } catch (e) {
      const codes = e && e.response && e.response.data && e.response.data.extras && e.response.data.extras.result_codes;
      /* No blind retry: the next tick re-reads the chain, which tells whether it landed. */
      return { action: 'submit_failed', batch_id: next.batch_id, codes: codes || null, detail: codes ? null : e.message };
    }
  }

  /** For the operator on this host only (127.0.0.1); the public copy is the verifier log. */
  serve(port) {
    return http.createServer((req, res) => {
      const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
      if (req.method !== 'GET') return send(405, 'text/plain', 'read-only');
      if (req.url === '/status.json') return send(200, 'application/json', JSON.stringify(this.status, null, 2));
      if (req.url === '/refusals.jsonl') return send(200, 'application/x-ndjson', fs.existsSync(this.refusalsFile) ? fs.readFileSync(this.refusalsFile) : '');
      if (req.url === '/decisions.jsonl') return send(200, 'application/x-ndjson', fs.existsSync(this.decisionsFile) ? fs.readFileSync(this.decisionsFile) : '');
      return send(404, 'text/plain', 'not found');
    }).listen(port, '127.0.0.1');
  }
}

async function cli() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  let maxWalk;
  try { maxWalk = C.maxWalkArg(args); } catch (e) { console.error(e.message); process.exit(2); }
  const usage = 'usage: node anchor/verifier.js --feed <public base URL> --config anchor.json --sign-with-key qwatt-verifier [--stellar-bin stellar] [--state DIR] [--interval 30] [--port 8090] [--max-walk 168]';
  const env = SG.refuseEnvSecrets(['QWATT_VERIFIER_SECRET']);
  if (env) { console.error(env); process.exit(2); }
  if (!args.includes('--sign-with-key')) { console.error(`--sign-with-key <identity> is required (the stellar-cli identity that holds the verifier key)\n${usage}`); process.exit(2); }
  const feedUrl = opt('--feed');
  if (!feedUrl) { console.error('--feed <public base URL> is required: it is the verifier\'s only input'); process.exit(2); }
  const cfg = loadConfig(opt('--config', path.join(__dirname, 'config.json')));
  const { signer, error } = await SG.signerForRole({ args, cfg, role: 'verifier', envNames: ['QWATT_VERIFIER_SECRET'] });
  if (error) { console.error(`${error}\n${usage}`); process.exit(2); }
  console.log(new Date().toISOString(), `verifier key ${signer.publicKey} (stellar-cli identity ${signer.identity})`);
  const v = new Verifier({ feedUrl, cfg, signer, stateDir: path.resolve(opt('--state', 'verifier-state')), maxWalk });
  if (opt('--port')) v.serve(Number(opt('--port')));
  const every = Number(opt('--interval', 30)) * 1000;
  const run = async () => console.log(new Date().toISOString(), JSON.stringify(await v.tick()));
  await run();
  if (!args.includes('--once')) setInterval(run, every);
}

if (require.main === module) cli();

module.exports = { Verifier };
