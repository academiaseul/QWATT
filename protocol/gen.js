#!/usr/bin/env node
/**
 * QWATT — binding generator
 * ---------------------------------------------------------------------------
 * Reads protocol/gates.spec.json and writes every derived artifact:
 *
 *   assets/gates.generated.js        browser global + CommonJS  (verificacion.html, conformance suite)
 *   mining-rig/gates.generated.js    CommonJS                   (validators.js — rig is deployable standalone)
 *   docs/GATES.md                    human-readable table       (reviewers, the SOW, the whitepaper)
 *
 * Usage:  node protocol/gen.js            write the files
 *         node protocol/gen.js --check    exit 1 if any file on disk is stale (CI)
 *
 * The spec digest (SHA-256 of the canonical JSON, line-ending independent) is
 * embedded in each binding so a page or a batch can state exactly which spec it
 * ran. No dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SPEC_PATH = path.join(__dirname, 'gates.spec.json');

/** Canonical JSON: sorted keys, no whitespace — same function as validators.js. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
const digest = crypto.createHash('sha256').update(canonical(spec), 'utf8').digest('hex');
const bound = Object.assign({}, spec, { digest });

const header = (rel) => [
  '/* GENERATED FILE — do not edit by hand.',
  ` * Source: protocol/gates.spec.json  (spec_version ${spec.spec_version}, sha256 ${digest.slice(0, 16)}…)`,
  ' * Regenerate: npm run gen:gates   ·   CI verifies this file with: node protocol/gen.js --check',
  ` * Target: ${rel}`,
  ' */',
].join('\n');

const json = JSON.stringify(bound, null, 2);

const outputs = {
  'assets/gates.generated.js':
    header('assets/gates.generated.js') + '\n' +
    '(function (root) {\n' +
    '  var SPEC = ' + json.replace(/\n/g, '\n  ') + ';\n' +
    "  if (typeof module === 'object' && module.exports) module.exports = SPEC;\n" +
    '  else root.QWATT_GATES_SPEC = SPEC;\n' +
    "}(typeof self !== 'undefined' ? self : this));\n",

  'mining-rig/gates.generated.js':
    header('mining-rig/gates.generated.js') + '\n' +
    "'use strict';\n" +
    'module.exports = ' + json + ';\n',

  'docs/GATES.md': renderMarkdown(bound),
};

function renderMarkdown(s) {
  const L = [];
  L.push(`# QWATT verification gates — spec ${s.spec_version}`);
  L.push('');
  L.push(`> GENERATED from \`protocol/gates.spec.json\` (sha256 \`${s.digest.slice(0, 16)}…\`). Do not edit; run \`npm run gen:gates\`.`);
  L.push('');
  L.push(s.description);
  L.push('');
  L.push('## Issuance');
  L.push('');
  L.push(`- **Unit:** ${s.issuance.unit} — ${s.issuance.unit_note}`);
  L.push(`- **Basis:** \`${s.issuance.basis}\` — ${s.issuance.basis_note}`);
  L.push(`- **Rounding:** ${s.issuance.rounding}, ${s.issuance.precision} decimals (Stellar precision). \`qwatt_per_kwh = ${s.issuance.qwatt_per_kwh}\``);
  L.push('');
  L.push('## Gates');
  L.push('');
  L.push('| Gate | Validator | Phase | Level | Rule | Stops |');
  L.push('|---|---|---|---|---|---|');
  for (const g of s.gates) {
    L.push(`| **${g.label}** ${g.title.en} (\`${g.id}\`) | ${g.validator} | ${g.phase} | ${g.level} | ${g.rule} | ${g.stops.en} |`);
  }
  L.push('');
  L.push('## Profiles');
  L.push('');
  const names = Object.keys(s.profiles);
  L.push('| Parameter | Unit | ' + names.map((n) => `\`${n}\``).join(' | ') + ' | Meaning |');
  L.push('|---|---|' + names.map(() => '---:').join('|') + '|---|');
  const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  for (const [key, meta] of Object.entries(s.parameters)) {
    const vals = names.map((n) => {
      const v = get(s.profiles[n], key);
      return v === undefined ? '—' : (v === null ? 'null' : String(v));
    });
    const flag = meta.provisional ? ' *(provisional)*' : '';
    L.push(`| \`${key}\` | ${meta.unit} | ${vals.join(' | ')} | ${meta.description}${flag} |`);
  }
  L.push('| `site.lat`, `site.lon` | deg | ' + names.map((n) => `${s.profiles[n].site.lat}, ${s.profiles[n].site.lon}`).join(' | ') + ' | Site coordinates for the solar-elevation gate. |');
  L.push('');
  for (const n of names) L.push(`- **\`${n}\`** — ${s.profiles[n].name}: ${s.profiles[n].description}`);
  L.push('');
  L.push('## Conformance');
  L.push('');
  L.push('Every binding is run against `protocol/conformance/cases.json` in CI (`npm test`). A case states the input interval, the profile, the expected verdict and the exact set of gates expected to fail. Divergence between implementations fails the build.');
  L.push('');
  return L.join('\n');
}

const check = process.argv.includes('--check');
let stale = 0;
for (const [rel, content] of Object.entries(outputs)) {
  const abs = path.join(ROOT, rel);
  if (check) {
    const onDisk = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') : null;
    if (onDisk !== content) { console.error(`STALE  ${rel}`); stale++; }
    else console.log(`ok     ${rel}`);
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    console.log(`wrote  ${rel}`);
  }
}
if (check && stale) {
  console.error(`\n${stale} generated file(s) out of date — run: npm run gen:gates`);
  process.exit(1);
}
console.log(`spec ${spec.spec_version}  sha256 ${digest}`);
