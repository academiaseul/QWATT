/**
 * QWATT — what the chain says (shared by proposer, verifier and reconciliation)
 * ---------------------------------------------------------------------------
 * Batches are anchored strictly in order, one transaction at a time, so the
 * anchoring account's current `qwatt.anchor.sha256` value identifies the whole
 * anchored prefix of the feed: every accepted batch up to and including the one
 * with that hash is anchored, nothing after it is. Both services rebuild their
 * view from this on every tick — never from local memory — which is what makes
 * restarts, timeouts and an absent co-signer safe.
 */

'use strict';

const E = require('../protocol/evidence');
const { ANCHOR_KEY, CUMULATIVE_KEY } = require('./tx');

const decode = (b64) => (b64 == null ? null : Buffer.from(b64, 'base64').toString('ascii'));

/** Current anchoring-account state from Horizon. */
async function getHead(server, account) {
  const a = await server.loadAccount(account);
  const cum = decode(a.data_attr[CUMULATIVE_KEY]);
  return {
    sequence: a.sequence,
    anchor_sha256: decode(a.data_attr[ANCHOR_KEY]),
    cumulative_mwh: cum == null ? null : Number(cum),
    thresholds: a.thresholds,
    signers: a.signers,
  };
}

/**
 * How many entries of the batch ledger are covered by the on-chain head.
 * @param {object[]} listed   ledger/batches.jsonl entries, in seq order
 * @param {string|null} headAnchor
 * @returns {number} count of leading entries at or before the anchored head (0 when nothing is anchored)
 * @throws when the chain's head anchor is not a published batch — an alarm, never a silent pass
 */
function anchoredPrefix(listed, headAnchor) {
  if (!headAnchor) return 0;
  const i = listed.findIndex((e) => e.sha256 === headAnchor);
  if (i < 0) throw new Error(`on-chain anchor ${headAnchor.slice(0, 12)}… is not a published batch`);
  if (listed[i].status !== 'accepted') throw new Error(`on-chain anchor points at ${listed[i].batch_id}, which was published as rejected`);
  return i + 1;
}

/** The next batch that should be anchored: the first accepted entry after the anchored prefix. */
function nextToAnchor(listed, prefix) {
  for (let i = prefix; i < listed.length; i++) if (listed[i].status === 'accepted') return listed[i];
  return null;
}

/** Find the transaction that anchored a given batch (memo QW#<seq>, anchor value = sha256). */
async function findAnchorTx(server, account, entry, { pages = 5 } = {}) {
  let page = await server.transactions().forAccount(account).order('desc').limit(100).call();
  for (let n = 0; n < pages && page.records.length; n++) {
    for (const t of page.records) {
      if (t.successful && t.memo_type === 'text' && t.memo === `QW#${entry.seq}`) {
        return { tx_hash: t.hash, ledger: t.ledger_attr ?? t.ledger, created_at: t.created_at };
      }
    }
    page = await page.next();
  }
  return null;
}

/**
 * Most published batches the verifier (and the proposer, which runs the same
 * walk) downloads to walk from a batch back to the on-chain head: one week of
 * hourly batches, so neither reads an unbounded history. Only batches published
 * as rejected lie between the head and the next accepted batch. A walk that
 * stops at the bound has its own code, verifier.walk_too_long: the check did
 * not finish, which is not evidence of tampering. The usual cause is a long run
 * of batch-level rejections, for example a node_id changed by mistake (every
 * later batch is rejected until it is put back). Operators raise the bound with
 * --max-walk on both services (docs/RUNBOOK.md); every check still runs.
 */
const MAX_WALK_BATCHES = 168;

/** A bound given by an operator or a caller: a whole number of batches, at least 1. */
function checkMaxWalk(n) {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`--max-walk must be a whole number of batches, at least 1 (got ${JSON.stringify(n)})`);
  return n;
}

/**
 * The --max-walk value from a CLI's arguments: undefined when absent (the default
 * bound applies); throws when present but not a whole number of batches, at least 1.
 */
function maxWalkArg(args) {
  const i = args.indexOf('--max-walk');
  if (i < 0) return undefined;
  const v = args[i + 1];
  return checkMaxWalk(v != null && /^\d+$/.test(v) ? Number(v) : v);
}

/**
 * Does the published chain behind `batch` lead back exactly to the on-chain head?
 *
 * This walk believes nothing it has not recomputed. First the links: each
 * earlier batch is downloaded once, rehashed with the shared integer-only rules
 * (protocol/evidence.js) and linked by prev_hash, seq and site, until the batch
 * whose recomputed hash is the on-chain anchor; with nothing anchored yet, until
 * seq 0 with prev_hash of 64 zeros. Then the totals: every batch's energy is
 * re-summed from its intervals. The offered batch adds its energy to the total
 * before it. Every batch between it and the head was published but never
 * anchored (rejected at batch level), so it carries the total before it forward
 * unchanged (F6). The head's total must be the on-chain cumulative; with
 * nothing anchored the totals start from zero.
 *
 * The walk returns what it downloaded, so the caller judges the batch against
 * the same rehashed objects and never downloads a batch twice: `prev`, the
 * batch before it, and `floor`, the anchored head (the last accepted batch;
 * null when nothing is anchored yet).
 *
 * @param {object} batch        the batch offered for anchoring
 * @param {{anchor_sha256:string|null, cumulative_mwh:number|null}} head  from getHead
 * @param {(id:string) => Promise<object|null>} fetchBatch  a published batch by id; null when not published
 * @param {object} [o]
 * @param {number} [o.maxSteps=MAX_WALK_BATCHES]  most batches downloaded; one more is verifier.walk_too_long
 * @returns {Promise<{ok:boolean, code:string|null, detail:string|null, steps:number, prev:object|null, floor:object|null}>}
 */
async function walkToHead(batch, head, fetchBatch, { maxSteps = MAX_WALK_BATCHES } = {}) {
  let steps = 0;
  const fail = (code, detail) => ({ ok: false, code, detail, steps, prev: null, floor: null });
  const anchored = head.anchor_sha256 != null;
  if (anchored && !Number.isSafeInteger(head.cumulative_mwh)) return fail('verifier.head_mismatch', 'on-chain anchor has no integer cumulative_mwh beside it');
  if (!anchored && head.cumulative_mwh != null) return fail('verifier.head_mismatch', 'on-chain cumulative_mwh without an on-chain anchor');

  /* links, newest first: from the offered batch back to the on-chain head (or seq 0) */
  const chain = [batch];
  for (let child = batch; ;) {
    if (child.seq === 0) {
      if (anchored) return fail('verifier.head_mismatch', `reached seq 0 without meeting the on-chain head ${head.anchor_sha256.slice(0, 12)}…`);
      if (child.prev_hash !== E.ZERO_HASH) return fail('verifier.head_mismatch', `${child.batch_id}: nothing is anchored, but the chain does not start from prev_hash 0`);
      break;
    }
    if (steps >= maxSteps) return fail('verifier.walk_too_long', `more than ${maxSteps} published batches between ${batch.batch_id} and the on-chain head; the walk stopped at its bound before reaching the head. If they are batches published as rejected, raise --max-walk on the proposer and the verifier (docs/RUNBOOK.md)`);
    const id = E.batchId(child.site_id, child.seq - 1);
    const parent = await fetchBatch(id);
    steps++;
    if (parent == null) return fail('verifier.not_published', `${id} is not in the public feed`);
    let h;
    try { h = E.batchSha256(parent); } catch (e) { return fail('verifier.head_mismatch', `${id}: ${e.message}`); }
    if (h !== parent.sha256 || h !== child.prev_hash || parent.seq !== child.seq - 1 || parent.site_id !== child.site_id) {
      return fail('verifier.head_mismatch', `${id} does not rehash to the prev_hash of ${child.batch_id}`);
    }
    chain.push(parent);
    if (anchored && h === head.anchor_sha256) break;
    child = parent;
  }

  /* totals, oldest first: the offered batch adds its energy, a batch never anchored adds none */
  const floor = anchored ? chain[chain.length - 1] : null;
  if (floor && floor.cumulative_mwh !== head.cumulative_mwh) return fail('verifier.head_mismatch', `${floor.batch_id} is the on-chain head, but its total ${floor.cumulative_mwh} is not the on-chain ${head.cumulative_mwh}`);
  for (let i = chain.length - (floor ? 2 : 1); i >= 0; i--) {
    const b = chain[i], before = chain[i + 1] ? chain[i + 1].cumulative_mwh : 0;
    let energy;
    try { energy = b.intervals.reduce((s, r) => s + E.basisMwh(r), 0); } catch (e) { return fail('verifier.head_mismatch', `${b.batch_id}: ${e.message}`); }
    if (energy !== b.energy_mwh) return fail('verifier.head_mismatch', `${b.batch_id}: energy_mwh is not the sum of its intervals`);
    if (b === batch && b.cumulative_mwh !== before + energy) return fail('verifier.head_mismatch', `${b.batch_id}: cumulative_mwh is not the total before it plus its energy`);
    if (b !== batch && b.cumulative_mwh !== before) return fail('verifier.head_mismatch', `${b.batch_id} was never anchored, so it must carry the total before it (${before}) forward unchanged`);
  }
  return { ok: true, code: null, detail: null, steps, prev: chain[1] || null, floor };
}

/** Above this disagreement with the network, neither service signs: timebounds would be judged wrong. */
const MAX_CLOCK_SKEW_S = 120;

/** Seconds by which the local clock is ahead (+) or behind (−) the latest closed ledger. */
async function clockSkewS(server, nowS = Math.floor(Date.now() / 1000)) {
  const page = await server.ledgers().order('desc').limit(1).call();
  const closed = Math.floor(Date.parse(page.records[0].closed_at) / 1000);
  return nowS - closed;
}

module.exports = { getHead, anchoredPrefix, nextToAnchor, walkToHead, findAnchorTx, clockSkewS, MAX_CLOCK_SKEW_S, MAX_WALK_BATCHES, checkMaxWalk, maxWalkArg, decode };
