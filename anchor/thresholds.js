/**
 * QWATT — the anchoring account's signature thresholds (the one source of truth)
 * ---------------------------------------------------------------------------
 * Three signers of weight 1 (proposer, independent verifier, off-team third
 * signer), master weight 0, and thresholds low 2 / medium 2 / high 3
 * (decision OD-1, 21 Oct 2026). On Stellar:
 *
 *   low 2   every transaction needs its source account's LOW threshold for its
 *           fee and sequence, or the network rejects it (tx_bad_auth) and
 *           applies nothing. So no single key can send ANY transaction for the
 *           account, BumpSequence included (a low-level operation: under low 1,
 *           one key alone could bump the sequence, voiding every pending
 *           co-signed anchor, or bump it to its maximum and leave the account
 *           unable to send anything again).
 *   med 2   anchoring (manageData + payment) needs two of the three keys.
 *   high 3  changing signers or thresholds (setOptions) needs all three.
 *
 * Every tool that configures, checks or describes the account reads it from
 * here: setup-account.js, rehearse.js, e2e.js, live/dress-rehearsal.js,
 * live/soak.js, ops/writeup.js and the fake Horizon used by the tests.
 * assets/qwatt-reconcile.js (ACCOUNT_RULES) keeps a browser copy, held equal
 * to these values by batch/reconcile.test.js.
 * No dependencies, so ops/ can read it without installing anchor/.
 */

'use strict';

const THRESHOLDS = Object.freeze({ low: 2, med: 2, high: 3 });

/** "2/2/3" */
const LABEL = `${THRESHOLDS.low}/${THRESHOLDS.med}/${THRESHOLDS.high}`;

/** The thresholds as Stellar's setOptions fields. */
function setOptionsFields() {
  return { lowThreshold: THRESHOLDS.low, medThreshold: THRESHOLDS.med, highThreshold: THRESHOLDS.high };
}

/** True when a Horizon account's `thresholds` object is exactly these thresholds. */
function matches(h) {
  return !!h && h.low_threshold === THRESHOLDS.low && h.med_threshold === THRESHOLDS.med && h.high_threshold === THRESHOLDS.high;
}

module.exports = { THRESHOLDS, LABEL, setOptionsFields, matches };
