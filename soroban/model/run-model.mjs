#!/usr/bin/env node
// Runs conformance cases against the BigInt reference model.
//   * checks every hand-written expectation (result code, accrued_wh, final fields);
//   * checks invariants after every step (zero balance, retired ≤ accrued, monotonic);
//   * writes a canonical transcript (one JSON line per step + one per final state) that
//     the Rust runner must reproduce byte for byte (compare-transcripts.mjs).
//
// Usage: node model/run-model.mjs <cases.json> <transcript-out.jsonl>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { IssuanceModel, siteId, batchHash, statementHash } from './model.mjs';

const [casesPath, outPath] = process.argv.slice(2);
if (!casesPath || !outPath) { console.error('usage: run-model.mjs <cases.json> <transcript-out.jsonl>'); process.exit(2); }
const doc = JSON.parse(readFileSync(casesPath, 'utf8'));

const lines = [];
const failures = [];
const hex = (b) => b.toString('hex');

function siteView(m, name) {
  const s = m.sites.get(hex(siteId(name)));
  if (!s) return null;
  return {
    responsible: s.responsible, class: s.cls.toString(), frozen: s.frozen, next_seq: s.next_seq.toString(),
    cumulative_mwh: s.cumulative_mwh.toString(), accrued_wh: s.accrued_wh.toString(), retired_wh: s.retired_wh.toString(),
    accrual_digest: hex(s.accrual_digest), retirements: s.retirements.toString(),
  };
}

for (const c of doc.cases) {
  const m = new IssuanceModel(doc.setup);
  const names = new Set();
  c.steps.forEach((st, i) => {
    const a = st.args;
    let args;
    switch (st.op) {
      case 'register_site': names.add(a.site); args = { site: siteId(a.site), responsible: a.responsible, cls: BigInt(a.class), next_seq: BigInt(a.next_seq) }; break;
      case 'accrue': names.add(a.site); args = { site: siteId(a.site), seq: BigInt(a.seq), cumulative_mwh: BigInt(a.cumulative_mwh), batch: batchHash(a.batch), level: BigInt(a.level) }; break;
      case 'retire': names.add(a.site); args = { site: siteId(a.site), start_wh: BigInt(a.start_wh), end_wh: BigInt(a.end_wh), statement: statementHash(a.statement) }; break;
      case 'set_frozen': names.add(a.site); args = { site: siteId(a.site), frozen: a.frozen }; break;
      case 'set_paused': args = { paused: a.paused }; break;
      case 'set_relay': args = { proposer: a.proposer, verifier: a.verifier }; break;
      default: throw new Error(`unknown op ${st.op}`);
    }
    const r = m.apply(st.op, args, new Set(st.auth));
    const line = { case: c.id, step: i, op: st.op };
    if ('err' in r) line.result = 'err:' + r.err;
    else {
      line.result = 'ok';
      if (st.op === 'accrue') line.value = { accrued_wh: r.ok.accrued_wh.toString(), digest: hex(r.ok.digest) };
      if (st.op === 'retire') line.value = { commitment: hex(r.ok.commitment) };
    }
    lines.push(JSON.stringify(line));

    if (st.expect !== undefined) {
      const want = st.expect === 'ok' ? 'ok' : 'err:' + st.expect.err;
      if (want !== line.result) failures.push(`${c.id} step ${i} ${st.op}: expected ${want}, got ${line.result}`);
    }
    if (st.expect_value && line.value) {
      for (const [k, v] of Object.entries(st.expect_value)) if (line.value[k] !== v) failures.push(`${c.id} step ${i}: ${k} expected ${v}, got ${line.value[k]}`);
    }
    // invariants after every step
    for (const asset of ['LIVE', 'SIMULATED']) {
      if (m.balance[asset] !== 0n) failures.push(`${c.id} step ${i}: ${asset} balance ${m.balance[asset]} ≠ 0`);
      if (m.minted[asset] !== m.burned[asset]) failures.push(`${c.id} step ${i}: ${asset} minted ≠ burned`);
    }
    for (const s of m.sites.values()) {
      if (s.retired_wh > s.accrued_wh) failures.push(`${c.id} step ${i}: retired > accrued`);
      if (s.accrued_wh !== s.cumulative_mwh / 1000n) failures.push(`${c.id} step ${i}: accrued ≠ floor(cumulative/1000)`);
    }
  });
  const final = { case: c.id, final: { paused: m.paused, balance_live: m.balance.LIVE.toString(), balance_sim: m.balance.SIMULATED.toString(), sites: {} } };
  for (const n of [...names].sort()) final.final.sites[n] = siteView(m, n);
  lines.push(JSON.stringify(final));
  for (const [n, want] of Object.entries(c.final ?? {})) {
    const got = final.final.sites[n];
    for (const [k, v] of Object.entries(want)) if (!got || got[k] !== v) failures.push(`${c.id} final ${n}.${k}: expected ${v}, got ${got?.[k]}`);
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join('\n') + '\n');
const steps = doc.cases.reduce((n, c) => n + c.steps.length, 0);
if (failures.length) {
  console.error(`model: ${failures.length} failure(s) in ${doc.cases.length} cases`);
  for (const f of failures.slice(0, 50)) console.error('  ' + f);
  process.exit(1);
}
console.log(`model: ${doc.cases.length} cases, ${steps} steps, all expectations and invariants hold → ${outPath}`);
