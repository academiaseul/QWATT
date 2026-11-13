#!/usr/bin/env node
// Byte-for-byte comparison of two conformance transcripts (model vs contract).
// Usage: node fixtures/compare-transcripts.mjs <a.jsonl> <b.jsonl>
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: compare-transcripts.mjs <a.jsonl> <b.jsonl>'); process.exit(2); }
const A = readFileSync(a, 'utf8');
const B = readFileSync(b, 'utf8');
if (A === B) {
  const lines = A.split('\n').filter(Boolean);
  const steps = lines.filter((l) => !l.includes('"final"')).length;
  const refused = lines.filter((l) => l.includes('"result":"err:')).length;
  console.log(`IDENTICAL  ${a}  ==  ${b}  (${lines.length - steps} cases, ${steps} steps, ${refused} refusals, sha-equal)`);
  process.exit(0);
}
const la = A.split('\n');
const lb = B.split('\n');
for (let i = 0; i < Math.max(la.length, lb.length); i++) {
  if (la[i] !== lb[i]) {
    console.error(`DIFFERENT at line ${i + 1}:\n  ${a}: ${la[i]}\n  ${b}: ${lb[i]}`);
    break;
  }
}
process.exit(1);
