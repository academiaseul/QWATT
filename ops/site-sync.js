#!/usr/bin/env node
/**
 * QWATT site — stamp shared markup and the plan into every page
 * ---------------------------------------------------------------------------
 * Rewrites, in every root *.html page that carries the markers:
 *   <!-- q:header -->…<!-- /q:header -->     from ops/site-fragments/header.html
 *   <!-- q:footer -->…<!-- /q:footer -->     from ops/site-fragments/footer.html
 *   <!-- q:week N -->…<!-- /q:week N -->     the week-N highlights or plan (assets/status.json)
 *   <!-- q:route -->, <!-- q:calendar -->, <!-- q:roadmap -->
 *   every chip <span class="q-chip" data-st="…" data-status-of="item:ID|node:ID|week:N">…</span>
 * with the renderers of assets/qwatt-status.js, so what crawlers and readers without
 * JavaScript see is what everyone sees. Week chips are stamped as of status.json
 * "updated"; the browser recomputes them for today.
 *
 * Run:  node ops/site-sync.js            rewrite the pages
 *       node ops/site-sync.js --check    exit 1 if any page would change (CI)
 * Zero dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');
const Q = require(path.join(ROOT, 'assets', 'qwatt-status.js'));
const S = Q.init(JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'status.json'), 'utf8')));
const NOW = S.updated;

const frag = (n) => fs.readFileSync(path.join(__dirname, 'site-fragments', n + '.html'), 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
const HEADER = frag('header');
const FOOTER = frag('footer');

function stamp(text, file) {
  let t = text;
  t = t.replace(/<!-- q:header -->[\s\S]*?<!-- \/q:header -->/g, `<!-- q:header -->\n${HEADER}\n<!-- /q:header -->`);
  t = t.replace(/<!-- q:footer -->[\s\S]*?<!-- \/q:footer -->/g, `<!-- q:footer -->\n${FOOTER}\n<!-- /q:footer -->`);
  t = t.replace(/<!-- q:week (\d+) -->[\s\S]*?<!-- \/q:week \1 -->/g, (m, n) => `<!-- q:week ${n} -->\n${Q.render.weekBlock(+n)}\n<!-- /q:week ${n} -->`);
  t = t.replace(/<!-- q:route -->[\s\S]*?<!-- \/q:route -->/g, () => `<!-- q:route -->\n${Q.render.route(NOW)}\n<!-- /q:route -->`);
  t = t.replace(/<!-- q:calendar -->[\s\S]*?<!-- \/q:calendar -->/g, () => `<!-- q:calendar -->\n${Q.render.calendar(NOW)}\n<!-- /q:calendar -->`);
  t = t.replace(/<!-- q:roadmap -->[\s\S]*?<!-- \/q:roadmap -->/g, () => `<!-- q:roadmap -->\n${Q.render.roadmap(NOW)}\n<!-- /q:roadmap -->`);
  t = t.replace(/<span class="q-chip" data-st="[^"]*" data-status-of="([^"]+)"><span data-l="es">[^<]*<\/span><span data-l="en">[^<]*<\/span><\/span>/g, (m, ref) => {
    const c = Q.chipFor(ref, NOW);
    if (!c) throw new Error(`${file}: data-status-of="${ref}" names no item, node or week of assets/status.json`);
    return Q.render.chip(c, ref);
  });
  return t;
}

const pages = fs.readdirSync(ROOT).filter((f) => /\.html$/.test(f)).sort();
const changed = [];
for (const f of pages) {
  const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const crlf = /\r\n/.test(raw);
  const lf = raw.replace(/\r\n/g, '\n');
  if (!/<!-- q:(header|footer|week \d+|route|calendar|roadmap) -->|data-status-of=/.test(lf)) continue;
  const out = stamp(lf, f);
  if (out === lf) continue;
  changed.push(f);
  if (!CHECK) fs.writeFileSync(path.join(ROOT, f), crlf ? out.replace(/\n/g, '\r\n') : out);
}

if (CHECK) {
  if (changed.length) {
    console.log(`site-sync --check: ${changed.length} page(s) differ from ops/site-fragments and assets/status.json: ${changed.join(', ')}\n  → run node ops/site-sync.js and commit the result`);
    process.exit(1);
  }
  console.log(`site-sync --check: every stamped block and the shared header/footer match (status.json updated ${NOW})`);
} else {
  console.log(changed.length ? `site-sync: stamped ${changed.join(', ')}` : 'site-sync: nothing to change');
}
