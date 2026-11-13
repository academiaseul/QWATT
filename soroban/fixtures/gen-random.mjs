#!/usr/bin/env node
// Generates fixtures/random-sequences.json: N seeded random sequences of accrual,
// retirement, freeze, pause, registration and relay rotation, mixing valid steps with
// near-miss mutations (replays, gaps, regressions, overlaps, wrong levels, missing keys,
// reused statements, boundary integers). No expectations: both implementations run them,
// each checks its invariants after every step, and the two transcripts must be identical.
//
// Deterministic: same seed → same file. The file is not committed; its sha256 for the
// default parameters is pinned in fixtures/random-sequences.lock.
//
// Usage: node fixtures/gen-random.mjs [--seed 20261113] [--n 1000] [--steps 30] [--out path] [--check-lock]

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IssuanceModel, siteId, batchHash, statementHash } from '../model/model.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = BigInt(arg('--seed', '20261113'));
const N = Number(arg('--n', '1000'));
const STEPS = Number(arg('--steps', '30'));
const OUT = arg('--out', join(HERE, 'random-sequences.json'));

// splitmix64: tiny, well-known, identical everywhere.
let state = SEED;
const M64 = (1n << 64n) - 1n;
function next64() {
  state = (state + 0x9e3779b97f4a7c15n) & M64;
  let z = state;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
  return z ^ (z >> 31n);
}
const rint = (n) => Number(next64() % BigInt(n));        // [0, n)
const rbig = (n) => (n <= 0n ? 0n : next64() % n);         // [0, n) BigInt
const chance = (p) => rint(1_000_000) < p * 1_000_000;
const pick = (xs) => xs[rint(xs.length)];

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const RELAYS = [['proposer', 'verifier'], ['relay2a', 'relay2b']];
const SITES = [
  { name: 'a', responsible: 'alice', cls: 1 },
  { name: 'b', responsible: 'bob', cls: 0 },
  { name: 'c', responsible: 'alice', cls: 1 },
];

const s = String;
const cases = [];
for (let k = 0; k < N; k++) {
  const m = new IssuanceModel({ governance: 'governance', proposer: 'proposer', verifier: 'verifier' });
  let relay = 0;
  const statements = [];
  const steps = [];
  const big = chance(0.08); // some sequences live at the integer boundaries
  const push = (op, args, auth) => {
    steps.push({ op, args, auth });
    // advance the shadow model so the next choice is state-aware
    const a = args;
    const conv = {
      register_site: () => ({ site: siteId(a.site), responsible: a.responsible, cls: BigInt(a.class), next_seq: BigInt(a.next_seq) }),
      accrue: () => ({ site: siteId(a.site), seq: BigInt(a.seq), cumulative_mwh: BigInt(a.cumulative_mwh), batch: batchHash(a.batch), level: BigInt(a.level) }),
      retire: () => ({ site: siteId(a.site), start_wh: BigInt(a.start_wh), end_wh: BigInt(a.end_wh), statement: statementHash(a.statement) }),
      set_frozen: () => ({ site: siteId(a.site), frozen: a.frozen }),
      set_paused: () => ({ paused: a.paused }),
      set_relay: () => ({ proposer: a.proposer, verifier: a.verifier }),
    }[op]();
    const r = m.apply(op, conv, new Set(auth));
    if (op === 'set_relay' && 'ok' in r) relay = RELAYS.findIndex((p) => p[0] === a.proposer);
  };
  // most sequences start with two or three registered sites
  for (const st of SITES.slice(0, 2 + rint(2))) {
    const ns = big && chance(0.5) ? U64_MAX - BigInt(rint(4)) : BigInt(rint(3));
    push('register_site', { site: st.name, responsible: st.responsible, class: st.cls, next_seq: s(ns) }, ['governance']);
  }
  while (steps.length < STEPS) {
    const st = pick(SITES);
    const site = m.sites.get(siteId(st.name).toString('hex'));
    const r = rint(100);
    if (r < 48) { // accrue
      const nextSeq = site ? site.next_seq : 0n;
      let seq = nextSeq;
      if (chance(0.12)) seq = nextSeq > 0n && chance(0.6) ? nextSeq - 1n - rbig(nextSeq) : nextSeq + 1n + rbig(3n);
      if (seq > U64_MAX) seq = U64_MAX;
      const cur = site ? site.cumulative_mwh : 0n;
      let cum = cur + (chance(0.15) ? 0n : rbig(big ? (1n << 100n) : 2_500_000n));
      if (chance(0.06) && cur > 0n) cum = cur - 1n - rbig(cur);
      if (big && chance(0.2)) cum = U128_MAX - rbig(1000n);
      if (cum > U128_MAX) cum = U128_MAX;
      const live = st.cls === 1;
      let level = live ? 1 + rint(2) : 0;
      if (chance(0.08)) level = live ? 0 : 1 + rint(2);
      if (chance(0.02)) level = 3;
      const keys = RELAYS[relay];
      let auth = [...keys];
      if (chance(0.08)) auth = pick([[keys[0]], [keys[1]], ['mallory'], ['governance'], [...RELAYS[1 - relay]]]);
      push('accrue', { site: st.name, seq: s(seq), cumulative_mwh: s(cum), batch: `${k}:${st.name}:${steps.length}`, level }, auth);
    } else if (r < 80) { // retire
      const retired = site ? site.retired_wh : 0n;
      const accrued = site ? site.accrued_wh : 0n;
      let start = retired;
      if (chance(0.12)) start = retired > 0n && chance(0.5) ? rbig(retired) : retired + 1n + rbig(5n);
      const room = accrued > start ? accrued - start : 0n;
      let end = start + 1n + rbig(room > 0n ? room : 2n);
      if (chance(0.08)) end = accrued + 1n + rbig(3n);
      if (chance(0.04)) end = start - rbig(start + 1n);
      if (big && chance(0.3)) end = start + ((1n << 63n) - 1n) / 10n + BigInt(rint(3)) - 1n;
      if (end > U128_MAX) end = U128_MAX;
      const statement = statements.length && chance(0.1) ? pick(statements) : `stmt ${k}/${steps.length}`;
      statements.push(statement);
      const auth = chance(0.9) ? [st.responsible] : [pick(['mallory', 'governance', 'bob', 'alice', 'proposer'])];
      push('retire', { site: st.name, start_wh: s(start), end_wh: s(end), statement }, auth);
    } else if (r < 86) {
      push('set_frozen', { site: st.name, frozen: chance(0.5) }, chance(0.9) ? ['governance'] : ['mallory']);
    } else if (r < 91) {
      push('set_paused', { paused: chance(0.4) }, chance(0.9) ? ['governance'] : ['proposer']);
    } else if (r < 97) {
      push('register_site', { site: st.name, responsible: st.responsible, class: chance(0.97) ? st.cls : 2, next_seq: s(rint(3)) }, chance(0.9) ? ['governance'] : ['alice']);
    } else {
      const [p, v] = chance(0.9) ? RELAYS[rint(2)] : ['relay2a', 'relay2a'];
      push('set_relay', { proposer: p, verifier: v }, chance(0.9) ? ['governance'] : ['verifier']);
    }
  }
  cases.push({ id: `X${String(k).padStart(4, '0')}`, title: `random sequence ${k} (seed ${SEED})`, steps });
}

const doc = {
  spec: 'qwatt-issuance random sequences v1',
  generator: { seed: String(SEED), n: N, steps: STEPS },
  actors: ['governance', 'proposer', 'verifier', 'alice', 'bob', 'mallory', 'relay2a', 'relay2b'],
  setup: { governance: 'governance', proposer: 'proposer', verifier: 'verifier' },
  cases,
};
const text = JSON.stringify(doc) + '\n';
const sha = createHash('sha256').update(text).digest('hex');
writeFileSync(OUT, text);
const total = cases.reduce((n, c) => n + c.steps.length, 0);
console.log(`wrote ${N} sequences, ${total} steps, sha256 ${sha} → ${OUT}`);
const lockPath = join(HERE, 'random-sequences.lock');
if (process.argv.includes('--check-lock')) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (lock.seed !== String(SEED) || lock.n !== N || lock.steps !== STEPS || lock.sha256 !== sha) {
    console.error(`random-sequences.lock mismatch: expected ${lock.sha256}, got ${sha}`); process.exit(1);
  }
  console.log('matches random-sequences.lock');
} else if (process.argv.includes('--write-lock')) {
  writeFileSync(lockPath, JSON.stringify({ seed: String(SEED), n: N, steps: STEPS, sha256: sha }, null, 2) + '\n');
}
