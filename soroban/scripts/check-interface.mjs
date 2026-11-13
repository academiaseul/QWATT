#!/usr/bin/env node
// Interface check (SOW Instaward #2, Deliverable 1): the compiled contract exports exactly
// the allowed functions, and none of them is a transfer, an approval, a balance-moving
// call or a public mint. Reads the Wasm export section directly (no tooling needed).
//
// Usage: node scripts/check-interface.mjs [path/to/qwatt_issuance.wasm]

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const path = process.argv[2] ?? resolve(here, '..', 'target', 'wasm32v1-none', 'release', 'qwatt_issuance.wasm');
const mod = new WebAssembly.Module(readFileSync(path));
const fns = WebAssembly.Module.exports(mod).filter((e) => e.kind === 'function').map((e) => e.name).sort();

const ALLOWED = ['__constructor', 'accrue', 'config', 'paused', 'register_site', 'retire', 'set_frozen', 'set_paused', 'set_relay', 'site', 'statement'].sort();
const FORBIDDEN = /transfer|approve|allowance|mint|burn|clawback|set_admin|upgrade|withdraw|send|pay/i;

const bad = fns.filter((f) => FORBIDDEN.test(f));
const extra = fns.filter((f) => !ALLOWED.includes(f) && !f.startsWith('_'));
const missing = ALLOWED.filter((f) => !fns.includes(f));
console.log(`exports: ${fns.join(', ')}`);
if (bad.length || extra.length || missing.length) {
  if (bad.length) console.error(`FAIL forbidden: ${bad.join(', ')}`);
  if (extra.length) console.error(`FAIL not in allowlist: ${extra.join(', ')}`);
  if (missing.length) console.error(`FAIL missing: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('PASS no transfer, approve, public mint, burn, clawback, set_admin or upgrade entry point');
