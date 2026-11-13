// qwatt-issuance BigInt reference model. Zero dependencies (node:crypto only).
//
// An independent implementation of contracts/qwatt-issuance/src/lib.rs: same checks, in
// the same order, same result codes, same integers and the same domain-separated hashes.
// Every conformance case runs against both; their transcripts must be byte-identical.
//
// Integers are BigInt throughout; every value is range-checked against the Rust type it
// mirrors (u32, u64, u128), and arithmetic that the contract checks is checked here too.

import { createHash } from 'node:crypto';

export const STROOPS_PER_WH = 10n;
export const MWH_PER_WH = 1000n;
export const MAX_STROOPS = (1n << 63n) - 1n; // i64::MAX
export const U32_MAX = (1n << 32n) - 1n;
export const U64_MAX = (1n << 64n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;
export const CLASS = { SIMULATED: 0n, LIVE: 1n };
export const LEVEL = { A0: 0n, A1: 1n, A2: 2n };
export const TAG_ACCRUE = Buffer.from('QWATT/issuance/v1/accrue\u0000', 'latin1');
export const TAG_RETIRE = Buffer.from('QWATT/issuance/v1/retire\u0000', 'latin1');
export const TAG_STATEMENT = Buffer.from('QWATT/statement/v1\u0000', 'latin1');
export const TAG_SITE = Buffer.from('QWATT/site/v1\u0000', 'latin1');
export const TAG_BATCH = Buffer.from('QWATT/batch/v1\u0000', 'latin1');

/** Result codes: the contract's `Error` enum, plus AUTH for a failed require_auth. */
export const ERR = {
  Paused: 1, SiteNotFound: 2, SiteExists: 3, SiteFrozen: 4, InvalidClass: 5, InvalidLevel: 6,
  LevelMismatch: 7, SeqReplay: 8, SeqGap: 9, CumulativeRegression: 10, Overflow: 11,
  EmptyRange: 12, RangeOverlap: 13, RangeGap: 14, OverRetire: 15, DuplicateStatement: 16,
  AmountTooLarge: 17, SameRelayKey: 18, InvariantBroken: 19, SameAsset: 20,
};
export const ERR_NAME = Object.fromEntries(Object.entries(ERR).map(([k, v]) => [v, k]));

class Refusal extends Error { constructor(code) { super(code); this.code = code; } }
const refuse = (name) => { throw new Refusal(name); };

const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
function be(n, bytes, max) {
  if (typeof n !== 'bigint' || n < 0n || n > max) throw new TypeError(`value out of range for ${bytes * 8}-bit: ${n}`);
  const b = Buffer.alloc(bytes);
  let x = n;
  for (let i = bytes - 1; i >= 0; i--) { b[i] = Number(x & 0xffn); x >>= 8n; }
  return b;
}
const u32be = (n) => be(n, 4, U32_MAX);
const u64be = (n) => be(n, 8, U64_MAX);
const u128be = (n) => be(n, 16, U128_MAX);

/** Ids and hashes the fixtures use, derived the same way in both runners. */
export const siteId = (name) => sha256(TAG_SITE, Buffer.from(name, 'utf8'));
export const batchHash = (label) => sha256(TAG_BATCH, Buffer.from(label, 'utf8'));
export const statementHash = (text) => sha256(TAG_STATEMENT, Buffer.from(text, 'utf8'));

export function accrualDigest(prev, site, seq, cumulativeMwh, level, batch) {
  return sha256(TAG_ACCRUE, prev, site, u64be(seq), u128be(cumulativeMwh), u32be(level), batch);
}
export function retireCommitment(site, cls, start, end, statement) {
  return sha256(TAG_RETIRE, site, u32be(cls), u128be(start), u128be(end), statement);
}

/**
 * The state machine. Actors are names ("governance", "proposer", ...); `auth` is the set of
 * names that authorized the call. The contract's own balances are tracked per asset so the
 * zero-outstanding invariant is checked here as well.
 */
export class IssuanceModel {
  constructor({ governance, proposer, verifier }) {
    if (proposer === verifier) refuse('SameRelayKey');
    this.cfg = { governance, proposer, verifier };
    this.paused = false;
    this.sites = new Map();      // hex(site_id) -> site
    this.statements = new Map(); // hex(statement_hash) -> record
    this.balance = { LIVE: 0n, SIMULATED: 0n };
    this.minted = { LIVE: 0n, SIMULATED: 0n };
    this.burned = { LIVE: 0n, SIMULATED: 0n };
  }

  #requireAuth(actor, auth) { if (!auth.has(actor)) refuse('AUTH'); }
  #notPaused() { if (this.paused) refuse('Paused'); }
  #site(id) { const s = this.sites.get(id.toString('hex')); if (!s) refuse('SiteNotFound'); return s; }

  register_site({ site, responsible, cls, next_seq }, auth) {
    this.#requireAuth(this.cfg.governance, auth);
    this.#notPaused();
    u64be(next_seq); u32be(cls);
    if (cls !== CLASS.SIMULATED && cls !== CLASS.LIVE) refuse('InvalidClass');
    if (this.sites.has(site.toString('hex'))) refuse('SiteExists');
    this.sites.set(site.toString('hex'), {
      responsible, cls, frozen: false, next_seq, cumulative_mwh: 0n, accrued_wh: 0n, retired_wh: 0n,
      accrual_digest: Buffer.alloc(32), retirements: 0n,
    });
    return null;
  }

  set_frozen({ site, frozen }, auth) {
    this.#requireAuth(this.cfg.governance, auth);
    this.#site(site).frozen = frozen;
    return null;
  }

  set_paused({ paused }, auth) {
    this.#requireAuth(this.cfg.governance, auth);
    this.paused = paused;
    return null;
  }

  set_relay({ proposer, verifier }, auth) {
    this.#requireAuth(this.cfg.governance, auth);
    this.#notPaused();
    if (proposer === verifier) refuse('SameRelayKey');
    this.cfg.proposer = proposer;
    this.cfg.verifier = verifier;
    return null;
  }

  accrue({ site, seq, cumulative_mwh, batch, level }, auth) {
    this.#requireAuth(this.cfg.proposer, auth);
    this.#requireAuth(this.cfg.verifier, auth);
    this.#notPaused();
    u64be(seq); u128be(cumulative_mwh); u32be(level);
    const s = this.#site(site);
    if (s.frozen) refuse('SiteFrozen');
    if (level > LEVEL.A2) refuse('InvalidLevel');
    if ((level === LEVEL.A0) !== (s.cls === CLASS.SIMULATED)) refuse('LevelMismatch');
    if (seq < s.next_seq) refuse('SeqReplay');
    if (seq > s.next_seq) refuse('SeqGap');
    if (cumulative_mwh < s.cumulative_mwh) refuse('CumulativeRegression');
    const next = seq + 1n;
    if (next > U64_MAX) refuse('Overflow');
    const accrued_wh = cumulative_mwh / MWH_PER_WH; // BigInt division floors for non-negatives
    const digest = accrualDigest(s.accrual_digest, site, seq, cumulative_mwh, level, batch);
    Object.assign(s, { next_seq: next, cumulative_mwh, accrued_wh, accrual_digest: digest });
    return { accrued_wh, digest };
  }

  retire({ site, start_wh, end_wh, statement }, auth) {
    this.#notPaused();
    u128be(start_wh); u128be(end_wh);
    const s = this.#site(site);
    this.#requireAuth(s.responsible, auth);
    if (s.frozen) refuse('SiteFrozen');
    if (end_wh <= start_wh) refuse('EmptyRange');
    if (start_wh < s.retired_wh) refuse('RangeOverlap');
    if (start_wh > s.retired_wh) refuse('RangeGap');
    if (end_wh > s.accrued_wh) refuse('OverRetire');
    const key = statement.toString('hex');
    if (this.statements.has(key)) refuse('DuplicateStatement');
    const stroops = (end_wh - start_wh) * STROOPS_PER_WH;
    if (stroops > U128_MAX) refuse('Overflow');
    if (stroops > MAX_STROOPS) refuse('AmountTooLarge');
    if (s.retirements + 1n > U32_MAX) refuse('Overflow');
    const commitment = retireCommitment(site, s.cls, start_wh, end_wh, statement);
    const asset = s.cls === CLASS.LIVE ? 'LIVE' : 'SIMULATED';
    if (this.balance[asset] !== 0n) refuse('InvariantBroken');
    // mint to self, burn from self: the same call
    this.balance[asset] += stroops; this.minted[asset] += stroops;
    this.balance[asset] -= stroops; this.burned[asset] += stroops;
    if (this.balance[asset] !== 0n) refuse('InvariantBroken');
    this.statements.set(key, { site, cls: s.cls, start_wh, end_wh, commitment });
    s.retired_wh = end_wh;
    s.retirements += 1n;
    return { commitment, stroops };
  }

  /**
   * Apply one op atomically: on refusal nothing changes (as a failed Soroban call).
   * Returns { ok: value } or { err: code }.
   */
  apply(op, args, auth) {
    const snap = this.#snapshot();
    try {
      return { ok: this[op](args, auth) };
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      this.#restore(snap);
      return { err: e.code };
    }
  }

  #snapshot() {
    return {
      cfg: { ...this.cfg }, paused: this.paused,
      sites: new Map([...this.sites].map(([k, v]) => [k, { ...v }])),
      statements: new Map(this.statements),
      balance: { ...this.balance }, minted: { ...this.minted }, burned: { ...this.burned },
    };
  }
  #restore(s) { Object.assign(this, s); }
}
