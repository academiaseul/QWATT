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

/** Above this disagreement with the network, neither service signs: timebounds would be judged wrong. */
const MAX_CLOCK_SKEW_S = 120;

/** Seconds by which the local clock is ahead (+) or behind (−) the latest closed ledger. */
async function clockSkewS(server, nowS = Math.floor(Date.now() / 1000)) {
  const page = await server.ledgers().order('desc').limit(1).call();
  const closed = Math.floor(Date.parse(page.records[0].closed_at) / 1000);
  return nowS - closed;
}

module.exports = { getHead, anchoredPrefix, nextToAnchor, findAnchorTx, clockSkewS, MAX_CLOCK_SKEW_S, decode };
