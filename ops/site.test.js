#!/usr/bin/env node
/**
 * QWATT site — hard rules for every deployed file
 * ---------------------------------------------------------------------------
 * The site is static HTML that Vercel uploads from this repository. This suite
 * reads exactly the files Vercel would upload (tracked files minus .vercelignore)
 * and refuses the merge when any of them:
 *   - says what QWATT is not (price, amounts, trade, investment, peg, tokens…);
 *   - names a place, or the other company;
 *   - handles a secret key, signs, posts, stores anything but three UI keys,
 *     loads analytics or talks to a host that is not on the list;
 *   - reads a Horizon or evidence field that must never reach the screen;
 *   - lacks the label line, the source badge on a number, the shared header and
 *     footer, both disclaimers, or the Spanish/English pairs;
 *   - links to something that does not exist, or invents a GitHub link;
 *   - disagrees with assets/status.json, or status.json disagrees with the changelog;
 *   - grows past its weight budget.
 *
 * Rules and their ids: DESIGN.md §7 (R-VOCAB … R-SITEMAP), §10.4 (R-STATUS),
 * §13 (R-LINKS, R-I18N, R-A11Y, R-WEIGHT). Each failure prints
 *   file:line  RULE  "excerpt"  → hint
 *
 * Run:  node ops/site.test.js [--include a.html,b.html] [--list] [--json]
 *   --include  treat those files as deployed even if .vercelignore hides them
 *              (a group checks its pages before INTEGRATE removes the ignore line)
 *   --list     print the deployed set and exit
 *   --json     print machine-readable results
 *   --show-excepted  also print what each registered exception suppressed
 *
 * Zero dependencies, Node 20. This file necessarily contains every banned word:
 * ops/ is in .vercelignore, so it is never deployed and never scans itself.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ARGV = process.argv.slice(2);
const argVal = (name) => { const i = ARGV.indexOf(name); return i >= 0 ? ARGV[i + 1] : null; };
const OPT = {
  include: (argVal('--include') || '').split(',').map((s) => s.trim()).filter(Boolean),
  list: ARGV.includes('--list'),
  showExcepted: ARGV.includes('--show-excepted'),
  json: ARGV.includes('--json'),
};

/* ═════════════════════════════ constants ═════════════════════════════ */

const DISCLAIMER_ES = 'QWATT es un proyecto en desarrollo que opera solo en Stellar testnet. QWATT no es electricidad, ni una inversión, ni un valor o instrumento financiero, ni un certificado de energía renovable (REC), ni un crédito de carbono. No tiene precio y no se vende.';
const DISCLAIMER_EN = 'QWATT is a project in development that runs only on Stellar testnet. QWATT is not electricity, not an investment, not a security or financial instrument, not a renewable energy certificate (REC), and not a carbon credit. It has no price and is not for sale.';
const EN_BODY_NOTE = 'The body of this page is in Spanish. Headings, labels, live data and the disclaimer are translated.';

const HORIZON_HOST = 'horizon-testnet.stellar.org';
const FEED_HOSTS = ['academiaseul.github.io'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const ALLOWED_HOSTS = new Set([
  'qwatt.org', HORIZON_HOST, 'stellar.expert', 'github.com', 'academiaseul.github.io', 'raw.githubusercontent.com',
  'youtube.com', 'www.youtube.com', 'x.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'schema.org',
  'json-schema.org', 'www.w3.org', 'data.openei.org', 'www.nrel.gov', 'creativecommons.org', 'developers.stellar.org',
]);
const NAMED_BAD_HOSTS = ['esm.sh', 'unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'skypack', 'api.coingecko.com', 'api.awattar.de',
  'formspree.io', 'friendbot.stellar.org', 'horizon.stellar.org', 'laboratory.stellar.org', 'albedo.link', 'xbull.app', 'lobstr.co',
  'freighter.app', 'rabet.io', 'hanawallet.io', 'herewallet.app', 'hot-labs.org', 'stellar.creit.tech'];

const PAGE_STATUSES = ['testnet', 'prototipo', 'planificado', 'mixto', 'info'];
const PARTS = ['testnet', 'prototipo', 'planificado'];
const DOTS = ['testnet', 'prototipo', 'planificado', 'none'];
const SRC_KINDS = ['vivo', 'sim', 'ensayo', 'demo', 'publico', 'dato', 'plan', 'recalculado', 'archivo'];
const STORAGE_KEYS = ['qwatt.theme', 'qwatt.drawer', 'wc-lang'];
const STORAGE_REMOVE_ONLY = ['qwatt.issuerSecret', 'qwatt.distSecret'];

/* Pages whose whole body is Spanish + English (FD-8). The others show the EN body note. */
const FULL_BILINGUAL = {
  'index.html': null, '404.html': null, 'terminos.html': null,
  'como-funciona.html': null, 'pruebas.html': null, 'hoja-de-ruta.html': null,
  'verificacion.html': ['top', 'derivar'],       // hero and §A only
};

/* Accounts that must never become the anchoring account (DESIGN Appendix A). */
const KNOWN_PRIOR_ACCOUNTS = [
  'GDN6IWJT4ES7CI6BEGXWLAXFM6737XAAEQSV5PNSYNDHOGH7PI7BLT46', 'GCLS6EE5UNXFNK44SQGD4F3TYYFE7QCJX2QEXQ5E4TOQSAQBZUXTSOKW',
  'GAYA2PZSQJTHHXZPB2ZD6LO3C75GOLSI3T4PZNSSYOEL4FNWFK27CYET', 'GB2QTJRIMRGJDBAJ2PI7PQ74ZNVVXCRDOBKAZA6ZASRYCSTNNRXMX3HU',
  'GCTBRUGQRYNGH7OMRMMQU46NAQNB2AURIWG7D66ADTQDWJC6D2N5O6FO', 'GCBKRNIPS4IVV2X7ZWR6DBMDNNTRQ53HXNRIQIIVNORCBMTSPK52L5AB',
  'GDO5EL2AB4A5REHWU7AG5FTZWLMBKOKBECZRJBJC4MXTB674XONKR3FI', 'GDWN3AOGMNUS2ZFRBEW3I2SYJMU67FUAFMTMCLAODTUUVRW7VSG5TG53',
  'GDWVD7H2CKN3S2XZ756I7EITTQF2J3FBBFAMRL3RHBDRALEVOMNRF3I2',
];

const ENGINE = ['assets/gates.browser.js', 'assets/qwatt-gates.js', 'assets/qwatt-reconcile.js', 'assets/qwatt-protocol.js'];
const READERS = ['assets/qwatt-live.js', 'assets/qwatt-feed.js'];
const SEC_HEADERS = ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Strict-Transport-Security', 'Permissions-Policy', 'Cross-Origin-Opener-Policy'];
/* DESIGN §6.6: the browser itself refuses outside scripts, inline scripts, frames, forms and any host not listed. */
const CSP_CANON = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://horizon-testnet.stellar.org; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'; frame-ancestors 'self'";

/* ═════════════════════════════ exceptions (§7.6) ═════════════════════════════
 * Each entry: file, rule, match (sub-rule ids, or '*'), reason, fd. An entry whose
 * file is deployed but which suppressed nothing fails the suite, so stale entries get
 * removed. An entry whose file is not deployed is reported as pending. `sha256`
 * (optional) pins the exception to one exact file content (LF-normalized): if the
 * file changes, the exception stops applying and the entry fails as unused. */
const EXCEPTIONS = [
  /* The served gate binding carries no text from the spec apart from gate titles and messages; only the bench
     profile's reference coordinates remain, because the G2 solar-elevation gate computes with them. They are
     normative values of spec 1.0.0, frozen by architecture freeze v3 (OD-10), and change only with a new spec. */
  { id: 'E1', file: 'assets/gates.browser.js', rule: 'R-LOCATION', match: ['loc-coords'],
    reason: 'Served gate binding: the bench profile site.lat/site.lon that G2 computes with (spec 1.0.0, frozen); pages never render them (R-FIELDS)', fd: 'FD-2: spec 1.1.0 with a whole-degree reference point' },
  { id: 'E3', file: 'assets/pages/backup.js', rule: 'R-SECRET', match: ['secret-names'],
    reason: 'FD-6 purge button: localStorage.removeItem of the two August keys on click, never read', fd: 'FD-6 (declined → delete)',
    only: /localStorage\.removeItem\(\s*(['"])qwatt\.(issuerSecret|distSecret)\1\s*\)/ },
];

/* ═════════════════════════════ helpers ═════════════════════════════ */

const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel) => { try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch (e) { return false; } };
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; }
}
function lineAt(text, idx) { let n = 1; for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n; }
function clip(s, n = 90) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/* ═════════════════════════════ the deployed set (§7.1) ═════════════════════════════ */

function trackedFiles() {
  /* Tracked files plus new files not yet committed (but not .gitignored), so a change is checked before its commit. */
  const out = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (out != null) return out.split('\0').filter(Boolean);
  const files = [];
  (function walk(dir) {
    for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (d.name === '.git' || d.name === 'node_modules') continue;
      const rel = dir ? dir + '/' + d.name : d.name;
      if (d.isDirectory()) walk(rel); else files.push(rel);
    }
  })('');
  return files;
}

/** gitignore semantics, as Vercel applies .vercelignore. */
function compileIgnore(text) {
  const rules = [];
  for (let raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    let neg = false;
    if (line.startsWith('!')) { neg = true; line = line.slice(1); }
    let dirOnly = false;
    if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1); }
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    let re = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '*') {
        if (line[i + 1] === '*') { re += '.*'; i++; if (line[i + 1] === '/') i++; } else re += '[^/]*';
      } else if (c === '?') re += '[^/]';
      else re += esc(c);
    }
    rules.push({ raw, neg, dirOnly, anchored, re: new RegExp(anchored ? '^' + re + '$' : '(^|/)' + re + '$') });
  }
  return rules;
}
function ignoredState(rules, p, isDir) {
  let state = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.re.test(p)) state = !r.neg;
  }
  return state;
}
function isIgnored(rules, file) {
  const parts = file.split('/');
  for (let i = 1; i < parts.length; i++) {                // a parent directory excluded hides everything under it
    if (ignoredState(rules, parts.slice(0, i).join('/'), true)) return true;
  }
  return ignoredState(rules, file, false);
}

const TRACKED = trackedFiles();
const TRACKED_SET = new Set(TRACKED);
const IGNORE_TEXT = exists('.vercelignore') ? readText('.vercelignore') : '';
const IGNORE = compileIgnore(IGNORE_TEXT);
const DEPLOYED = TRACKED.filter((f) => exists(f) && !isIgnored(IGNORE, f));
for (const f of OPT.include) if (exists(f) && !DEPLOYED.includes(f)) DEPLOYED.push(f);
DEPLOYED.sort();
const DEPLOYED_SET = new Set(DEPLOYED);

const ext = (f) => (f.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
const PAGES = DEPLOYED.filter((f) => ext(f) === 'html');
const SCRIPTS = DEPLOYED.filter((f) => ext(f) === 'js');
const STYLES = DEPLOYED.filter((f) => ext(f) === 'css');
const TEXT = DEPLOYED.filter((f) => ['html', 'js', 'css', 'json', 'md', 'toml', 'txt', 'xml', 'svg'].includes(ext(f)) || f === '.well-known/stellar.toml');
const COPYDATA = DEPLOYED.filter((f) => f === 'assets/status.json' || /^evidence\/feeds\/[^/]+\/feed\.json$/.test(f));
const PAGE_JS = SCRIPTS.filter((f) => !ENGINE.includes(f) && !READERS.includes(f));

if (OPT.list) {
  console.log(DEPLOYED.join('\n'));
  console.log(`\n${DEPLOYED.length} deployed files · ${PAGES.length} pages · ${SCRIPTS.length} scripts · ${STYLES.length} styles`);
  process.exit(0);
}

/* ═════════════════════════════ normalization (§7.2) ═════════════════════════════ */

const ENT = {
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  iquest: '¿', iexcl: '¡', middot: '·', nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  rarr: '→', larr: '←', darr: '↓', uarr: '↑', harr: '↔', ndash: '–', mdash: '—', hellip: '…', deg: '°',
  minus: '−', times: '×', le: '≤', ge: '≥', asymp: '≈', ne: '≠', laquo: '«', raquo: '»', copy: '©', reg: '®',
  Delta: 'Δ', bull: '•', thinsp: ' ', ensp: ' ', emsp: ' ', zwj: '', zwnj: '', sup2: '²', sub2: '₂', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', check: '✓', cross: '✗', para: '¶', sect: '§', ordm: 'º', ordf: 'ª', frac12: '½', plusmn: '±',
};
function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => (n in ENT ? ENT[n] : m))
    .replace(/\\u\{([0-9a-f]+)\}/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
}
function normalize(s) {
  return decode(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[−‒–]/g, '-')
    .replace(/₂/g, '2')
    .replace(/[      ]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const NEGATIONS = [
  new RegExp(esc(normalize(DISCLAIMER_ES)), 'g'),
  new RegExp(esc(normalize(DISCLAIMER_EN)), 'g'),
  /\bno tiene precio\b/g, /\bsin precio\b/g, /\bno se vende\b/g,
  /\bni (una|un) inversion\b/g, /\bno es una inversion\b/g,
  /\bni un credito de carbono\b/g, /\bno es un credito de carbono\b/g,
  /\bhas no price\b/g, /\bno price\b/g, /\bnot for sale\b/g,
  /\bnot an investment\b/g, /\bnor an investment\b/g,
  /\bnot a carbon credit\b/g, /\bnor a carbon credit\b/g,
];
const IDENT_STRIP = [
  /\basset_issuer\b/g, /\bpaging_token\b/g,
  /\b(?:window\.|globalthis\.|self\.)?crypto\.(?:subtle|getrandomvalues|randomuuid)\b/g,
  /\b(?:window|globalthis|self)\.crypto\b/g,
  /\brequire\(\s*['"`](?:node:)?crypto['"`]\s*\)/g, /\bnode:crypto\b/g, /\bcrypto\.createhash\b/g, /\b(?:const|let|var)\s+crypto\s*=/g,
  /\bamerica\/santiago\b/g, /\boutline-offset\b/g,
  /\b(?:font-)?display\s*[=:]\s*swap\b/g, /\btext-wrap\s*:\s*balance\b/g,
];

const V = (id, cat, re, hint) => ({ id, cat, re, hint });
const H = {
  price: 'QWATT has no price and no market: show live testnet verification instead',
  supply: 'never show amounts, holdings or supply of any asset',
  issuance: 'nothing is issued, minted or tokenized: say "constancia" / "record"',
  trade: 'nothing is bought, sold, traded or paid with QWATT',
  invest: 'QWATT is not an investment: no returns, rewards or savings',
  finance: 'no financial framing (reserves, peg, crypto, decentralized)',
  carbon: 'QWATT is not a carbon credit or a REC',
  overclaim: 'overclaim: say "constancias verificables" / "independently verifiable records"',
  claims: 'unverified August claim or old brand: remove',
  privacy: 'no forms or newsletters (no privacy notice for them)',
  secret: 'never mention seed phrases: no page handles secret material',
};
const VOCAB = [
  V('price-es', 'price', /\bprecios?\b/), V('price-en', 'price', /\bpric(e|es|ed|ing)\b/),
  V('cotiza', 'price', /\bcotiz\w*/), V('mcap-es', 'price', /\bcapitalizacion\b/), V('mcap-en', 'price', /\bmarket ?cap\w*/),
  V('valuation', 'price', /\b(valoracion|valoraciones|valorizacion|valuation)\b/),
  V('value-phrases', 'price', /\b(valor de mercado|valor economico|valor anual|market value|valor de qwatt|value of qwatt)\b/),
  V('market', 'price', /\b(mercados?|markets?)\b/), V('spot', 'price', /\bspot\b/),
  V('price-sources', 'price', /\b(epex|awattar|coingecko|day-ahead)\b/),
  V('oracle', 'price', /\b(oracul\w*|oracles?)\b/), V('ticker', 'price', /\bticker\b/),
  V('fiat', 'price', /\b(usd|eur|clp)\b|us\$/), V('xlm-per-qwatt', 'price', /xlm\s*\/\s*qwatt/),
  V('supply', 'supply', /\b(supply|suministro|circulante|circulacion|circulating|oferta maxima)\b/),
  V('supply-figures', 'supply', /42[.,]?7\s?m\b|42[.,]700[.,]000|100[.,]000[.,]000/),
  V('qwatt-amount', 'supply', /\b(?!20\d\d\b)\d[\d.,]*\s*qwatt\b/), V('xlm-amount', 'supply', /\b\d[\d.,]*\s*xlm\b/),
  V('balance', 'supply', /\b(saldos?|balance)\b/),
  V('holder-metrics', 'supply', /\b(trustlines abiertas|open trustlines|cuentas con qwatt|accounts holding qwatt)\b/),
  V('emite', 'issuance', /\bemit(e|en|ir|ido|idos|ida|idas|iendo|io|imos)\b/),
  V('emision', 'issuance', /\bemision(es)?\b|\bemisor(es|a)?\b/),
  V('issuance', 'issuance', /\b(issuance|issued|issuer)\b/),
  V('mint', 'issuance', /\b(mint|mints|minted|minting|mintfor)\b|\bmintea\w*|\bminteo\w*/),
  V('acunar', 'issuance', /\bacun(a|ar|ado|ada|ados|adas|o)\b/),
  V('burn', 'issuance', /\b(burn|burns|burned|burning)\b|\bquem(a|ar|ado|ada|an|o)\b/),
  V('tokenize', 'issuance', /\btokeni[sz]\w*|\btokenom\w*/), V('token', 'issuance', /\btokens?\b/),
  V('into-qwatt', 'issuance', /\bconvierte[^.]{0,60}\ben qwatt\b|\binto qwatt\b/),
  V('buy-es', 'trade', /\bcompr(a|as|ar|e|o|aste|aron|ado|ada|ador|adores)\b/),
  V('sell-es', 'trade', /\bvend(e|er|o|ido|ida|en|iste|edor|edores)\b|\bventas?\b/),
  V('swap-es', 'trade', /\b(recompra\w*|intercambi\w*|transa|transar|transan)\b/),
  V('buy-sell-en', 'trade', /\b(buy|buys|buying|buyer|buyers|bought|sell|sells|selling|seller|sold|sales|purchas\w*|trade|trades|traded|trading|swap\w*|exchange\w*|buyback)\b|\b(for|on) sale\b/),
  V('dex', 'trade', /\b(dex|p2p|order ?book|libro de ordenes)\b/),
  V('pay-es', 'trade', /\bpagar\b|\bpaga(n|s|mos)?\b|\bpagos? (con|en) qwatt\b/),
  V('pay-en', 'trade', /\bpay(ing)? (with|in|for)\b|\bpaid\b|\bpayments? (in|with) qwatt\b/),
  V('settle', 'trade', /\bliquid(ar|acion|aciones)\b|\bsettle\w*/),
  V('bills', 'trade', /\bfactura\w*|\binvoice\w*|\b(electricity|energy|power) bill\b|\bcuenta de (la )?luz\b/),
  V('funding', 'trade', /\bfriendbot\b|\bbilleteras? financiadas?\b|\bfunded (wallet|account)s?\b|\b(dinero|money|fondos|funds)\b/),
  V('invest', 'invest', /\binversi(on|ones)\b|\binvert(ir|ido|ida)\b|\binversionistas?\b|\binvest(ment|ments|or|ors|ing|ed|s)?\b/),
  V('returns', 'invest', /\b(rentabilidad|retornos?|ganancias?|ganad(o|os|a|as)|ganar|earn|earns|earned|earning|earnings|rewards?|recompensas?|yields?|apy|roi|dividend\w*|profit\w*|ahorro|ahorros|ahorrar|savings)\b/),
  V('hedge', 'invest', /\bhedg\w*|\bcobertura de (precio|riesgo)\b/),
  V('token-sale', 'invest', /\b(staking|stake|vesting|airdrop\w*|pre-?venta|pre-?sale|ico|volatil\w*|especula\w*|speculat\w*)\b/),
  V('treasury', 'finance', /\b(tesoreri\w*|treasur\w*|reservas?|reserves?|proof of reserves|colateral\w*|collateral\w*|backed by)\b/),
  V('backed-energy', 'finance', /\brespaldad[oa]s? por (la )?(electricidad|energia|mwh|kwh)\b/),
  V('peg', 'finance', /\b(paridad|parity|peg|pegged)\b|1\s*qwatt\s*=\s*1\s*mwh|\brepresentan? 1 mwh\b|\brepresents? 1 mwh\b|\banclad[oa] al (precio|mercado)\b/),
  V('stabilize', 'finance', /\bestabiliza\w*|\bstabili[sz]\w*|\bstablecoin\w*/),
  V('crypto', 'finance', /\b(cripto|criptomonedas?|criptoactivos?|crypto|cryptos|cryptocurrenc\w*|crypto-?assets?)\b/),
  V('decentralized', 'finance', /\bdescentraliz\w*|\bdecentrali[sz]\w*/),
  V('carbon', 'carbon', /\b(co2e?|kgco2e?|esg)\b|\bcreditos? de carbono\b|\bcarbon credits?\b|\bhuella de carbono\b|\bcarbon (footprint|offsets?)\b|\bcompensaci(on|ones) de emisiones\b/),
  V('retire', 'carbon', /\bretir\w*/),
  V('clean-token', 'carbon', /\bqwatt-c\b|\bqwatt-clean\b|\bclean token\b/),
  V('pog', 'overclaim', /\bproof[- ]of[- ]generation\b|\bprueba de generacion\b|\bpog\b/),
  V('verified-energy', 'overclaim', /\benergia verificada\b|\bverified energy\b|\b[km]wh verificados?\b|\bverified [km]wh\b|\bverificada onchain\b|\bverified on-?chain\b|\b[km]wh reales?\b|\breal [km]wh\b/),
  V('mining', 'overclaim', /\b(minad\w*|mineria|minero|mineros|mining|minar|miners?)\b/),
  V('events', 'claims', /\b(stellar builder night|ai studio|build challenge)\b/),
  V('old-brand', 'claims', /\bqwatt pay\b|\bthe clean token\b/),
  V('forms', 'privacy', /formspree|\bnewsletter\b/),
  V('seed-phrase', 'secret', /\b(seed ?phrase|frase semilla|mnemonic\w*|mnemonico|bip-?39)\b/),
];
const FIAT_HTML = V('fiat-dollar', 'price', /\$\s?\d/);   // HTML only: "$5"
const LOCATION = [
  V('loc-city', 'location', /\bsantiago\b/), V('loc-pilot', 'location', /\b(arrayan|barnechea|metropolitana|comuna|enel)\b/),
  V('loc-balcony', 'location', /\bbalcon(y|es)?\b/),
  V('loc-coords', 'location', /-?33[.,]45\b|-?70[.,]65\b|\b33\s?°\s?s\b|\blatitud(e)? -?33\b/),
];

function prepared(raw) {
  let t = normalize(raw);
  for (const re of NEGATIONS) t = t.replace(re, ' ');
  for (const re of IDENT_STRIP) t = t.replace(re, ' ');
  return t;
}
/** All distinct matches of the rules in a text, with the first raw line that holds each. */
function scan(raw, rules) {
  const t = prepared(raw);
  const hits = [];
  for (const r of rules) {
    const g = new RegExp(r.re.source, 'g');
    const seen = new Set();
    let m;
    while ((m = g.exec(t))) {
      if (!m[0]) { g.lastIndex++; continue; }
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      hits.push({ id: r.id, cat: r.cat, match: m[0] });
    }
  }
  if (!hits.length) return hits;
  const lines = String(raw).split('\n');
  const prep = lines.map(prepared);
  for (const h of hits) {
    const i = prep.findIndex((l) => l.includes(h.match));
    h.line = i >= 0 ? i + 1 : 0;
    h.excerpt = i >= 0 ? clip(lines[i]) : h.match;
  }
  return hits;
}
/** String values of a JSON document, one per line, so line numbers stay meaningful. */
function jsonStrings(text) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((l, i) => { const ms = l.match(/"(?:[^"\\]|\\.)*"\s*(?=[,\]}\n]|$)/g); if (ms) out.push({ line: i + 1, s: ms.map((x) => JSON.parse(x.trim())).join(' · ') }); });
  return out;
}

/* ═════════════════════════════ minimal HTML tree ═════════════════════════════ */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAWTEXT = new Set(['script', 'style', 'textarea', 'title']);
function parseAttrs(s) {
  const attrs = {};
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1].toLowerCase()] = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '';
  return attrs;
}
function parseHTML(src) {
  const root = { type: 'el', tag: '#root', attrs: {}, children: [], parent: null, pos: 0 };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/gi;
  let last = 0, m;
  const pushText = (from, to) => { if (to > from) cur.children.push({ type: 'text', text: src.slice(from, to), pos: from, parent: cur }); };
  while ((m = re.exec(src))) {
    pushText(last, m.index);
    last = re.lastIndex;
    if (m[0].startsWith('<!')) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      let n = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n !== root) cur = n.parent;
      continue;
    }
    const tag = m[2].toLowerCase();
    const el = { type: 'el', tag, attrs: parseAttrs(m[3] || ''), children: [], parent: cur, pos: m.index, raw: m[0] };
    cur.children.push(el);
    if (VOID.has(tag) || m[4] === '/') continue;
    if (RAWTEXT.has(tag)) {
      const close = new RegExp('</' + tag + '\\s*>', 'ig');
      close.lastIndex = re.lastIndex;
      const c = close.exec(src);
      const end = c ? c.index : src.length;
      el.children.push({ type: 'text', text: src.slice(re.lastIndex, end), pos: re.lastIndex, parent: el });
      el.inner = src.slice(re.lastIndex, end);
      re.lastIndex = c ? close.lastIndex : src.length;
      last = re.lastIndex;
      continue;
    }
    cur = el;
  }
  pushText(last, src.length);
  return root;
}
function walk(node, fn) { fn(node); if (node.children) for (const c of node.children) walk(c, fn); }
function all(root, pred) { const out = []; walk(root, (n) => { if (n.type === 'el' && n.tag !== '#root' && pred(n)) out.push(n); }); return out; }
const cls = (el) => (el.attrs.class || '').split(/\s+/).filter(Boolean);
const hasClass = (el, c) => cls(el).includes(c);
function textOf(node) { let s = ''; walk(node, (n) => { if (n.type === 'text' && !(n.parent && ['script', 'style'].includes(n.parent.tag))) s += n.text; }); return decode(s).replace(/\s+/g, ' ').trim(); }
function closest(el, pred) { for (let n = el; n && n.tag !== '#root'; n = n.parent) if (n.type === 'el' && pred(n)) return n; return null; }
function elementChildren(el) { return (el.children || []).filter((c) => c.type === 'el'); }
function nextElementSibling(el) {
  const sib = el.parent.children; const i = sib.indexOf(el);
  for (let j = i + 1; j < sib.length; j++) { if (sib[j].type === 'el') return sib[j]; if (sib[j].text && sib[j].text.trim()) return null; }
  return null;
}
function prevElementSibling(el) {
  const sib = el.parent.children; const i = sib.indexOf(el);
  for (let j = i - 1; j >= 0; j--) { if (sib[j].type === 'el') return sib[j]; if (sib[j].text && sib[j].text.trim()) return null; }
  return null;
}
const HAS_LETTER = /[A-Za-zÀ-ÿĀ-ɏ]/;

/* ═════════════════════════════ results ═════════════════════════════ */

const RULE_ORDER = ['R-VOCAB', 'R-LOCATION', 'R-ORG', 'R-SECRET', 'R-SECRET-LITERAL', 'R-STORAGE', 'R-ANALYTICS', 'R-HOSTS', 'R-FIELDS',
  'R-PAGE', 'R-NAV', 'R-VERCEL', 'R-IGNORE', 'R-SITEMAP', 'R-STATUS', 'R-LINKS', 'R-I18N', 'R-A11Y', 'R-WEIGHT', 'R-EXCEPTION'];
let failures = [];
const warnings = [];
function fail(file, line, rule, sub, excerpt, hint) { failures.push({ file, line: line || 0, rule, sub: sub || '', excerpt: clip(excerpt || '', 110), hint: hint || '' }); }
function warn(msg) { warnings.push(msg); }

/* ═════════════════════════════ rule implementations ═════════════════════════════
 * Each takes (file, text) and calls fail(). Pure enough for the self-test to call
 * with synthetic inputs through withCapture(). */

function ruleVocab(file, text) {
  const rules = ext(file) === 'html' ? VOCAB.concat([FIAT_HTML]) : VOCAB;
  if (COPYDATA.includes(file) || /\.json$/.test(file)) {
    for (const { line, s } of jsonStrings(text)) for (const h of scan(s, rules)) fail(file, line, 'R-VOCAB', h.id, s, H[h.cat]);
    return;
  }
  for (const h of scan(text, rules)) fail(file, h.line, 'R-VOCAB', h.id, h.excerpt, H[h.cat]);
}
function ruleLocation(file, text) {
  const hint = 'never name or locate the pilot, the bench or a city';
  if (/\.json$/.test(file)) {
    for (const { line, s } of jsonStrings(text)) for (const h of scan(s, LOCATION)) fail(file, line, 'R-LOCATION', h.id, s, hint);
    return;
  }
  for (const h of scan(text, LOCATION)) fail(file, h.line, 'R-LOCATION', h.id, h.excerpt, hint);
}
function ruleLocationName(file) {
  for (const h of scan(file.replace(/[\/_.-]/g, ' '), LOCATION)) fail(file, 0, 'R-LOCATION', h.id, file, 'a deployed file name names a place: rename it or ignore it');
}
function ruleOrg(file, text) {
  const m = /quorelia/i.exec(text);
  if (m) fail(file, lineAt(text, m.index), 'R-ORG', 'quorelia', text.split('\n')[lineAt(text, m.index) - 1], 'QWATT is a separate entity: remove the name');
}
const SECRET_PATTERNS = [
  ['keypair', /Keypair\.(random|fromSecret)/], ['from-secret', /fromSecret|fromRawEd25519Seed|encodeEd25519SecretSeed/], ['secret-call', /\.secret\(\)/],
  ['secret-names', /\b(issuerSecret|distSecret|secretKey|secret_key|secretSeed|privateKey|private_key)\b/],
  ['signing', /signTransaction|submitTransaction|TransactionBuilder|\.sign\(/], ['sdk', /StellarSdk|stellar-sdk|stellar-wallets-kit|qwatt-wallet\.js|assets\/vendor\//],
  ['post', /method\s*:\s*['"`]post['"`]/i], ['transport', /XMLHttpRequest|sendBeacon|WebSocket/], ['storage-db', /indexedDB/],
  ['cookie', /document\.cookie\s*=/], ['eval', /\beval\s*\(|new\s+Function\s*\(/], ['js-url', /javascript:/i],
  ['secret-input', /placeholder\s*=\s*["']S(\.\.\.|…|&hellip;)|<(input|textarea)\b[^>]*\b(id|name)\s*=\s*["'][^"']*(secret|seed|priv)/i],
  ['webcrypto-keys', /\bsubtle\s*\.\s*(encrypt|decrypt|deriveKey|deriveBits|wrapKey|unwrapKey|generateKey|exportKey)\b/],
];
function ruleSecret(file, text) {
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    for (const [id, re] of SECRET_PATTERNS) {
      if (!re.test(l)) continue;
      const ex = EXCEPTIONS.find((e) => e.only && e.file === file && e.match.includes(id));
      if (ex && ex.only.test(l) && !l.replace(new RegExp(ex.only.source, 'g'), '').match(re)) { markUsed(ex); continue; }
      fail(file, i + 1, 'R-SECRET', id, l, 'no page creates, reads, stores or uses a secret key, signs or posts');
    }
  });
}
function ruleSecretLiteral(file, text) {
  const re = /\bS[A-Z2-7]{55}\b/g;
  let m;
  while ((m = re.exec(text))) fail(file, lineAt(text, m.index), 'R-SECRET-LITERAL', 'seed', m[0].slice(0, 6) + '…', 'a string shaped like a Stellar secret seed: remove it now and rotate the key');
}
function ruleStorage(file, text) {
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    const re = /\b(localStorage|sessionStorage)\s*(?:\.\s*(setItem|getItem|removeItem|clear)\s*\(\s*([^,)]*)|\[)/g;
    let m;
    while ((m = re.exec(l))) {
      const [, store, op, argRaw] = m;
      if (!op) { fail(file, i + 1, 'R-STORAGE', 'bracket', l, 'use getItem/setItem with a literal key'); continue; }
      if (store === 'sessionStorage' && op === 'setItem') { fail(file, i + 1, 'R-STORAGE', 'session', l, 'no sessionStorage writes'); continue; }
      if (op === 'clear') { fail(file, i + 1, 'R-STORAGE', 'clear', l, 'never clear the visitor\'s storage'); continue; }
      const lit = /^\s*(['"])([^'"]*)\1\s*$/.exec(argRaw || '');
      if (!lit) { fail(file, i + 1, 'R-STORAGE', 'non-literal', l, 'storage keys must be string literals in ' + STORAGE_KEYS.join(', ')); continue; }
      const key = lit[2];
      const ok = STORAGE_KEYS.includes(key) || (op === 'removeItem' && STORAGE_REMOVE_ONLY.includes(key));
      if (!ok) fail(file, i + 1, 'R-STORAGE', 'key', l, `storage key "${key}" is not allowed (allowed: ${STORAGE_KEYS.join(', ')})`);
    }
  });
}
const ANALYTICS = /googletagmanager|google-analytics|gtag\(|dataLayer|G-ESWGGQ9742|plausible\.io|umami|hotjar|mixpanel|segment\.(io|com)|clarity\.ms|fbq\(|connect\.facebook/;
function ruleAnalytics(file, text) {
  text.split('\n').forEach((l, i) => { const m = ANALYTICS.exec(l); if (m) fail(file, i + 1, 'R-ANALYTICS', m[0], l, 'no analytics: the site links no privacy notice for them'); });
}
function ruleHosts(file, text) {
  const lines = text.split('\n');
  const isHTML = ext(file) === 'html';
  lines.forEach((l, i) => {
    const urlRe = /(?:\bhttps?:)?\/\/([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)(?::\d+)?(\/[^\s"'<>)\\`]*)?/gi;
    let m;
    while ((m = urlRe.exec(l))) {
      const before = l.slice(Math.max(0, m.index - 1), m.index);
      if (!/^https?:/i.test(m[0]) && /[\w:]/.test(before)) continue;     // "a//b" is not a URL
      if (!/^https?:/i.test(m[0]) && !/\b(src|href|url|action|content)\s*=?\s*\(?\s*['"]?$/i.test(l.slice(0, m.index))) continue;
      const host = m[1].toLowerCase(); const p = m[2] || '/';
      const named = NAMED_BAD_HOSTS.find((h) => host === h || host.endsWith('.' + h) || host.includes(h));
      if (named) { fail(file, i + 1, 'R-HOSTS', 'named-host', l, `${named} is not allowed: no outside scripts, APIs, wallets or main network`); continue; }
      if (!ALLOWED_HOSTS.has(host)) { fail(file, i + 1, 'R-HOSTS', 'host', l, `host ${host} is not on the allowlist`); continue; }
      if (host === 'raw.githubusercontent.com' && !/^\/academiaseul\/(qwatt-evidence|qwatt-verifier-log)\//.test(p)) fail(file, i + 1, 'R-HOSTS', 'raw-path', l, 'raw.githubusercontent.com only for the two evidence repositories');
      if (host === 'json-schema.org' && file !== 'assets/qwatt-protocol.js') fail(file, i + 1, 'R-HOSTS', 'json-schema', l, 'json-schema.org only inside the generated protocol build');
    }
    if (/stellar\.expert\/explorer\/testnet\/asset\//i.test(l)) fail(file, i + 1, 'R-HOSTS', 'asset-page', l, 'never link the asset page (it shows the August amount)');
    if (/1859e7e5/i.test(l)) fail(file, i + 1, 'R-HOSTS', 'creation-tx', l, 'never reference the August asset-creation transaction (its memo carries the old equivalence)');
    if (/stellar\.expert[^\s"'<>]*(GDN6IWJT|GCLS6EE5)/.test(l)) fail(file, i + 1, 'R-HOSTS', 'august-account-link', l, 'never link the August accounts on an explorer (D-10)');
    if (/horizon[^\s"'<>]*\/assets\?/i.test(l)) fail(file, i + 1, 'R-HOSTS', 'assets-endpoint', l, 'never read the Horizon /assets endpoint (amounts)');
    const fx = /\b(?:fetch|EventSource)\s*\(\s*['"`](https?:\/\/[^'"`]+)/.exec(l);
    if (fx && !new RegExp('^https://' + esc(HORIZON_HOST) + '(/|$)').test(fx[1])) fail(file, i + 1, 'R-HOSTS', 'fetch-host', l, 'a literal absolute fetch/EventSource URL must be Horizon testnet');
    const im = /\bimport\s*\(\s*['"`]([^'"`]+)|^\s*import\s[^'"]*from\s*['"]([^'"]+)/.exec(l);
    if (im && !/^\.\.?\//.test(im[1] || im[2])) fail(file, i + 1, 'R-HOSTS', 'import', l, 'JS imports must be relative');
  });
  if (isHTML) {
    const tree = parseHTML(text);
    for (const s of all(tree, (e) => e.tag === 'script' && e.attrs.src != null)) {
      if (/^(https?:)?\/\//i.test(s.attrs.src)) fail(file, lineAt(text, s.pos), 'R-HOSTS', 'script-src', s.raw, '<script src> must be same-origin');
    }
    for (const lk of all(tree, (e) => e.tag === 'link')) {
      const rel = (lk.attrs.rel || '').toLowerCase(); const href = lk.attrs.href || '';
      const host = (/^(?:https?:)?\/\/([^/]+)/i.exec(href) || [])[1];
      if (rel.split(/\s+/).includes('stylesheet') && host && host !== 'fonts.googleapis.com') fail(file, lineAt(text, lk.pos), 'R-HOSTS', 'stylesheet', lk.raw, 'external stylesheets only from fonts.googleapis.com');
      if (/preconnect|dns-prefetch|preload|modulepreload/.test(rel) && host && !FONT_HOSTS.includes(host)) fail(file, lineAt(text, lk.pos), 'R-HOSTS', 'preconnect', lk.raw, 'preconnect only to the two font hosts');
    }
  }
}
const FIELD_PATTERNS = [
  ['memo', /\.memo\b|\[\s*['"`]memo['"`]\s*\]/], ['amount', /\.amount\b|\[\s*['"`]amount['"`]\s*\]/],
  ['fees', /fee_charged|total_coins|fee_pool|base_fee|base_reserve/], ['balance', /\.balance\b/],
  ['batch_id', /\.batch_id\b|\[\s*['"`]batch_id['"`]\s*\]/], ['site_id', /\.site_id\b|\[\s*['"`]site_id['"`]\s*\]/],
  ['node_id', /\.node_id\b/], ['last_anchored_batch', /last_anchored_batch/], ['description', /\.description\b/],
  ['site', /\.site\b/], ['mint', /\.mint\b|\.minted\b|spec\.issuance/], ['refusal_log', /\.refusal_log\b/],
];
const DOM_PATTERNS = /\bdocument\b|innerHTML|outerHTML|insertAdjacentHTML|textContent|createElement|createTextNode|appendChild|\.append\(|\.prepend\(|\.replaceChildren\(|setAttribute\(/;
function ruleFieldsPageJS(file, text) {
  text.split('\n').forEach((l, i) => {
    for (const [id, re] of FIELD_PATTERNS) if (re.test(l)) fail(file, i + 1, 'R-FIELDS', id, l, 'this field never reaches the screen (memo, amounts, fees, batch/site ids, profile text, issuance)');
  });
}
function ruleFieldsReader(file, text) {
  text.split('\n').forEach((l, i) => { const m = DOM_PATTERNS.exec(l); if (m) fail(file, i + 1, 'R-FIELDS', 'reader-dom', l, 'READERS hand plain objects to renderers and never touch the DOM (D-17)'); });
}

/* ── R-PAGE (§7.3) ── */
const FRAGMENTS = {};
for (const k of ['header', 'footer']) FRAGMENTS[k] = exists(`ops/site-fragments/${k}.html`) ? readText(`ops/site-fragments/${k}.html`).replace(/\n+$/, '') : null;
function headOf(tree) { return all(tree, (e) => e.tag === 'head')[0] || tree; }
function rulePage(file, text, tree) {
  const L = (pos) => lineAt(text, pos);
  const is404 = file === '404.html';
  const html = all(tree, (e) => e.tag === 'html')[0];
  if (!html || html.attrs.lang !== 'es' || !(html.attrs['data-title-en'] || '').trim()) fail(file, html ? L(html.pos) : 1, 'R-PAGE', '1', html ? html.raw : '<html>', '<html lang="es" data-title-en="…">');
  const head = headOf(tree);
  const title = all(head, (e) => e.tag === 'title')[0];
  if (!title || !/QWATT/.test(textOf(title))) fail(file, title ? L(title.pos) : 1, 'R-PAGE', '2', title ? title.raw + textOf(title) : '<title>', '<title> must contain "QWATT"');
  const meta = (pred) => all(head, (e) => e.tag === 'meta' && pred(e))[0];
  if (is404) {
    const rb = meta((e) => (e.attrs.name || '').toLowerCase() === 'robots');
    if (!rb || !/noindex/.test(rb.attrs.content || '')) fail(file, 1, 'R-PAGE', '2', '<meta name="robots">', '404.html needs <meta name="robots" content="noindex">');
  } else {
    const d = meta((e) => (e.attrs.name || '').toLowerCase() === 'description');
    if (!d || !(d.attrs.content || '').trim()) fail(file, 1, 'R-PAGE', '2', 'meta description', 'meta description required');
    const c = all(head, (e) => e.tag === 'link' && (e.attrs.rel || '') === 'canonical')[0];
    if (!c || !/^https:\/\/qwatt\.org\//.test(c.attrs.href || '')) fail(file, c ? L(c.pos) : 1, 'R-PAGE', '2', c ? c.raw : 'canonical', 'canonical https://qwatt.org/…');
    const og = meta((e) => e.attrs.property === 'og:image'); const tw = meta((e) => e.attrs.name === 'twitter:image');
    if (!og || og.attrs.content !== 'https://qwatt.org/og-sprint.png') fail(file, og ? L(og.pos) : 1, 'R-PAGE', '3', og ? og.raw : 'og:image', 'og:image must be https://qwatt.org/og-sprint.png');
    if (!tw || tw.attrs.content !== 'https://qwatt.org/og-sprint.png') fail(file, tw ? L(tw.pos) : 1, 'R-PAGE', '3', tw ? tw.raw : 'twitter:image', 'twitter:image must be https://qwatt.org/og-sprint.png');
  }
  const ogi = text.indexOf('og-image.png');
  if (ogi >= 0) fail(file, L(ogi), 'R-PAGE', '3', 'og-image.png', 'og-image.png is not served (FD-4): use og-sprint.png');
  const flat = decode(text).replace(/\s+/g, ' ');
  if (!flat.includes(DISCLAIMER_ES)) fail(file, 0, 'R-PAGE', '4', 'ES disclaimer', 'the exact ES disclaimer must be in the page');
  if (!flat.includes(DISCLAIMER_EN)) fail(file, 0, 'R-PAGE', '4', 'EN disclaimer', 'the exact EN disclaimer must be in the page');
  const body = all(tree, (e) => e.tag === 'body')[0];
  const st = body && body.attrs['data-status'];
  const parts = body && body.attrs['data-parts'] != null ? body.attrs['data-parts'].split(/\s+/).filter(Boolean) : null;
  if (!body || !PAGE_STATUSES.includes(st) || parts == null || parts.some((p) => !PARTS.includes(p)) || (st === 'mixto' && parts.length < 2) || (PARTS.includes(st) && !(parts.length === 1 && parts[0] === st)) || (st === 'info' && parts.length)) {
    fail(file, body ? L(body.pos) : 0, 'R-PAGE', '5', body ? body.raw : '<body>', 'data-status ∈ testnet|prototipo|planificado|mixto|info, data-parts ⊆ testnet prototipo planificado (mixto ≥ 2)');
  }
  const h1 = all(tree, (e) => e.tag === 'h1')[0];
  const qs = h1 ? all(tree, (e) => hasClass(e, 'q-status') && e.pos > h1.pos)[0] : null;
  if (!qs) fail(file, h1 ? L(h1.pos) : 0, 'R-PAGE', '6', 'no .q-status after the h1', 'label line: <p class="q-status" role="note"> with one chip per part, right under the h1');
  else {
    const chips = all(qs, (e) => hasClass(e, 'q-chip')).map((e) => e.attrs['data-st']);
    const need = st === 'info' ? ['info'] : (parts || []);
    for (const p of need) if (!chips.includes(p)) fail(file, L(qs.pos), 'R-PAGE', '6', qs.raw, `label line lacks a .q-chip[data-st="${p}"]`);
  }
  for (const k of ['header', 'footer']) {
    if (FRAGMENTS[k] == null) { fail(file, 0, 'R-PAGE', '7', `ops/site-fragments/${k}.html missing`, 'SHELL provides the fragments'); continue; }
    const block = `<!-- q:${k} -->\n${FRAGMENTS[k]}\n<!-- /q:${k} -->`;
    if (!text.includes(block)) fail(file, 0, 'R-PAGE', '7', `${k} block differs from ops/site-fragments/${k}.html`, 'run node ops/site-sync.js');
  }
  const headScripts = all(head, (e) => e.tag === 'script');
  const first = headScripts[0];
  if (!first || first.attrs.src !== '/assets/boot.js' || first.attrs.defer != null || first.attrs.async != null) fail(file, first ? L(first.pos) : L(head.pos), 'R-PAGE', '8', first ? first.raw : 'no script in <head>', 'first <head> script: <script src="/assets/boot.js"> (blocking)');
  if (!all(head, (e) => e.tag === 'link' && /stylesheet/.test(e.attrs.rel || '') && e.attrs.href === '/assets/site.css').length) fail(file, L(head.pos), 'R-PAGE', '8', 'no /assets/site.css', 'load /assets/site.css in <head>');
  if (!headScripts.some((s) => s.attrs.src === '/assets/site.js')) fail(file, L(head.pos), 'R-PAGE', '8', 'no /assets/site.js', 'load /assets/site.js (defer) in <head>');
  for (const s of all(tree, (e) => e.tag === 'script' && e.attrs.src == null && (e.attrs.type || '') !== 'application/ld+json')) fail(file, L(s.pos), 'R-PAGE', '9', '<script> inline', 'no inline script: move it to /assets/pages/<page>.js');
  for (const e of all(tree, () => true)) {
    for (const a of Object.keys(e.attrs)) if (/^on[a-z]+$/.test(a)) fail(file, L(e.pos), 'R-PAGE', '9', e.raw, 'no inline event handlers (CSP script-src \'self\')');
    if (['form', 'iframe', 'embed', 'object'].includes(e.tag)) fail(file, L(e.pos), 'R-PAGE', '9', e.raw, `no <${e.tag}>`);
    if (e.tag === 'meta' && /refresh/i.test(e.attrs['http-equiv'] || '')) fail(file, L(e.pos), 'R-PAGE', '9', e.raw, 'no meta refresh');
    if (hasClass(e, 'q-num') && !SRC_KINDS.includes(e.attrs['data-src'])) fail(file, L(e.pos), 'R-PAGE', '10', e.raw, 'every .q-num needs data-src ∈ ' + SRC_KINDS.join('|'));
    if ((e.attrs.target || '') === '_blank' && !/\bnoopener\b/.test(e.attrs.rel || '')) fail(file, L(e.pos), 'R-PAGE', '11', e.raw, 'target="_blank" needs rel="noopener"');
    if (e.tag === 'img' && /^(https?:)?\/\//i.test(e.attrs.src || '')) fail(file, L(e.pos), 'R-PAGE', '13', e.raw, '<img src> must be same-origin');
  }
}
/** R-PAGE 10 in scripts: every literal "q-num" carries a literal data-src right after it. */
function ruleNumJS(file, text) {
  text.split('\n').forEach((l, i) => {
    const re = /q-num\b/g; let m;
    while ((m = re.exec(l))) {
      const tail = l.slice(m.index, m.index + 80);
      const d = /data-src=\\?["']([a-z]+)\\?["']/.exec(tail);
      if (/['"`]\.q-num['"`]|\.q-num\[/.test(l.slice(Math.max(0, m.index - 2), m.index + 8))) continue;   // a selector, not markup
      if (!d || !SRC_KINDS.includes(d[1])) fail(file, i + 1, 'R-PAGE', '10', l, 'markup with class q-num needs a literal data-src ∈ ' + SRC_KINDS.join('|') + ' right after it');
    }
  });
}

/* ── R-NAV ── */
function loadModule(rel) {
  if (!exists(rel)) return null;
  try { delete require.cache[require.resolve(path.join(ROOT, rel))]; return require(path.join(ROOT, rel)); } catch (e) { return { __error: e }; }
}
let SITE = null, STATUS = null, LIVE = null, QSTATUS = null;
function navEntries() { return SITE && Array.isArray(SITE.NAV) ? SITE.NAV.flatMap((g) => g.items || []) : []; }

/* ═════════════════════════════ gather ═════════════════════════════ */

const TEXTS = {};
const TREES = {};
for (const f of DEPLOYED) if (TEXT.includes(f)) TEXTS[f] = readText(f);
for (const f of PAGES) TREES[f] = parseHTML(TEXTS[f]);

/* ═════════════════════════════ exception plumbing ═════════════════════════════ */

const USED = new Set();
function markUsed(ex) { USED.add(ex); }
function exceptionActive(ex) {
  if (!DEPLOYED_SET.has(ex.file)) return false;
  if (ex.sha256) return TEXTS[ex.file] != null && sha256(TEXTS[ex.file]) === ex.sha256;
  return true;
}
function applyExceptions(list) {
  return list.filter((f) => {
    const ex = EXCEPTIONS.find((e) => !e.only && e.file === f.file && exceptionActive(e) &&
      (Array.isArray(e.rule) ? e.rule.includes(f.rule) : e.rule === f.rule) && (e.match === '*' || e.match.includes(f.sub)));
    if (ex) { markUsed(ex); (ex.suppressed = ex.suppressed || []).push(f); return false; }
    return true;
  });
}

/* ═════════════════════════════ self-test (§7.4) ═════════════════════════════ */

function withCapture(fn) { const saved = failures; failures = []; try { fn(); return failures; } finally { failures = saved; } }
function selfTest() {
  const problems = [];
  const vocabAll = VOCAB.concat(LOCATION, [FIAT_HTML]);
  const flags = (s) => scan(s, vocabAll).length > 0 || /quorelia/i.test(s);
  const seed = 'S' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.repeat(2).slice(0, 55);   // built at runtime: no seed-shaped literal in the repo
  const mustFlag = ['Comprar&nbsp;QWATT', '1 QWATT = 1 MWh', '0.0000001 QWATT', 'Array&aacute;n', 'Santiago', 'precio', 'token', 'issuer', '\\u00e9mite', 'Quorelia', 'cripto',
    'La tesorer&iacute;a', 'proof of reserves', 'stablecoin', 'descentralizado', 'kWh verificados', 'mining rig', 'Stellar Builder Night', 'US$ 5', 'retiro de CO2e', '−33,45'];
  const mustPass = [DISCLAIMER_ES, DISCLAIMER_EN, '© 2026 QWATT', 'America/Santiago', 'crypto.subtle', 'paging_token', 'asset_issuer', 'No tiene precio y no se vende.',
    'pago marcador fijo de 1 stroop', 'inversor híbrido', 'firma criptográfica', '&display=swap', 'Cada dato sale de Horizon', 'nunca pegues una clave secreta',
    "const crypto = require('crypto')", "crypto.createHash('sha256')", 'La red dice que no', 'Lote #3 · aceptado', 'ventana de 5 minutos', 'comprobar', 'Compruébalo tú', 'transacciones'];
  let nFlag = 0, nPass = 0, nOther = 0;
  for (const s of mustFlag) { nFlag++; if (!flags(s)) problems.push('should flag: ' + s); }
  for (const s of mustPass) { nPass++; if (flags(s)) problems.push('should pass: ' + s + ' → ' + JSON.stringify(scan(s, vocabAll).map((h) => h.match))); }
  const expectFail = (label, fn, rule) => { nOther++; const got = withCapture(fn); if (!got.some((g) => g.rule === rule)) problems.push(`should flag (${rule}): ${label}`); };
  const expectPass = (label, fn, rule) => { nOther++; const got = withCapture(fn); if (got.some((g) => g.rule === rule)) problems.push(`should pass (${rule}): ${label} → ${got.map((g) => g.excerpt).join(' | ')}`); };
  expectFail('Keypair.random()', () => ruleSecret('x.js', 'const k = StellarSdk.Keypair.random();'), 'R-SECRET');
  expectFail('a secret-key input', () => ruleSecret('x.html', '<input id="eIssuer" placeholder="S...">'), 'R-SECRET');
  expectFail('WebCrypto encryption of keys', () => ruleSecret('x.js', "await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)"), 'R-SECRET');
  expectPass('WebCrypto digest, verify, importKey', () => ruleSecret('x.js', "crypto.subtle.digest('SHA-256', b); crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']); crypto.subtle.verify('Ed25519', k, sig, msg)"), 'R-SECRET');
  expectFail('localStorage.setItem("qwatt.issuerSecret", s)', () => ruleStorage('x.js', 'localStorage.setItem("qwatt.issuerSecret", s)'), 'R-STORAGE');
  expectFail('localStorage.setItem(key, v)', () => ruleStorage('x.js', 'localStorage.setItem(key, v)'), 'R-STORAGE');
  expectFail('<script src="https://esm.sh/x">', () => ruleHosts('x.html', '<script src="https://esm.sh/x"></script>'), 'R-HOSTS');
  expectFail('fetch("https://api.coingecko.com/…")', () => ruleHosts('x.js', 'fetch("https://api.coingecko.com/api/v3")'), 'R-HOSTS');
  expectFail('asset page link', () => ruleHosts('x.html', '<a href="https://stellar.expert/explorer/testnet/asset/QWATT-G">x</a>'), 'R-HOSTS');
  expectFail('seed-shaped string', () => ruleSecretLiteral('x.txt', 'key ' + seed + ' end'), 'R-SECRET-LITERAL');
  expectFail('gtag(', () => ruleAnalytics('x.html', "gtag('js', new Date())"), 'R-ANALYTICS');
  expectFail('READERS file with innerHTML', () => ruleFieldsReader('assets/qwatt-live.js', 'el.innerHTML = x;'), 'R-FIELDS');
  expectFail('page JS with entry.batch_id', () => ruleFieldsPageJS('assets/pages/x.js', 'row.textContent = entry.batch_id;'), 'R-FIELDS');
  expectFail('page JS with tx.memo', () => ruleFieldsPageJS('assets/pages/x.js', 'cell.textContent = tx.memo;'), 'R-FIELDS');
  expectFail('deployed file named bench-santiago-000001.json', () => ruleLocationName('evidence/feeds/x/batches/bench-santiago-000001.json'), 'R-LOCATION');
  expectFail('status.json done item without evidence', () => statusRules({ version: 1, updated: '2026-10-24', sprint: {}, labels: { sim: { es: 'Entrada simulada · Stellar testnet', en: 'Simulated input · Stellar testnet' } }, anchor: { account: null, target: {} }, feeds: [], weeks: [{ n: 1, id: 's1', from: '2026-10-19', to: '2026-10-23', title: { es: 'a', en: 'a' }, summary: { es: 'a', en: 'a' }, changelog: null, release: null, highlights: [] }], deliverables: [], items: [{ id: 'X-1', ref: null, deliverable: null, week: 1, status: 'done', label: 'prototipo', title: { es: 'a', en: 'a' }, summary: { es: 'a', en: 'a' }, evidence: [], nodes: [] }], nodes: [] }, { quiet: true }), 'R-STATUS');
  expectFail('q-num without data-src', () => rulePage('x.html', '<p><span class="q-num">5</span></p>', parseHTML('<p><span class="q-num">5</span></p>')), 'R-PAGE');
  expectFail('inline onclick', () => rulePage('x.html', '<a onclick="x()">a</a>', parseHTML('<a onclick="x()">a</a>')), 'R-PAGE');
  expectPass("localStorage.setItem('qwatt.theme','dark')", () => ruleStorage('x.js', "localStorage.setItem('qwatt.theme','dark')"), 'R-STORAGE');
  expectPass('<script src="/assets/site.js">', () => ruleHosts('x.html', '<script src="/assets/site.js"></script>'), 'R-HOSTS');
  expectPass('Horizon fetch', () => ruleHosts('x.js', "fetch('https://horizon-testnet.stellar.org/ledgers')"), 'R-HOSTS');
  expectPass('a G… public key', () => ruleSecretLiteral('x.txt', 'GAYA2PZSQJTHHXZPB2ZD6LO3C75GOLSI3T4PZNSSYOEL4FNWFK27CYET'), 'R-SECRET-LITERAL');
  expectPass('memoShown', () => ruleFieldsPageJS('assets/pages/x.js', 'cell.textContent = tx.memoShown;'), 'R-FIELDS');
  // .vercelignore semantics
  const ig = compileIgnore('ops\n.env*\n/top.txt\nprotocol/*\n!protocol/batch.schema.json\nassets/vendor\nbuild/\n*.local.txt\n');
  const igCases = [['ops/site.test.js', true], ['a/ops/x.js', true], ['.env.local', true], ['top.txt', true], ['sub/top.txt', false],
    ['protocol/gen.js', true], ['protocol/batch.schema.json', false], ['protocol/conformance/cases.json', true], ['assets/vendor/x.js', true],
    ['build/x', true], ['notes.local.txt', true], ['assets/site.js', false]];
  for (const [p, want] of igCases) { nOther++; if (isIgnored(ig, p) !== want) problems.push(`ignore matcher: ${p} → expected ${want ? 'ignored' : 'deployed'}`); }
  return { problems, counts: `${nFlag} must-flag, ${nPass} must-pass, ${nOther} rule and ignore-matcher controls` };
}

/* ═════════════════════════════ R-STATUS (§10.4) ═════════════════════════════ */

const EVIDENCE_PATTERNS = {
  pr: /^https:\/\/github\.com\/academiaseul\/QWATT\/pull\/\d+$/,
  commit: /^https:\/\/github\.com\/academiaseul\/QWATT\/commit\/[0-9a-f]{7,40}$/,
  run: /^https:\/\/github\.com\/academiaseul\/QWATT\/actions\/runs\/\d+$/,
  release: /^https:\/\/github\.com\/academiaseul\/QWATT\/releases\/tag\/[A-Za-z0-9._-]+$/,
  compare: /^https:\/\/github\.com\/academiaseul\/QWATT\/compare\/[A-Za-z0-9._-]+\.\.\.[A-Za-z0-9._-]+$/,
  doc: /^https:\/\/github\.com\/academiaseul\/QWATT\/(blob|tree)\/main\/(.+)$/,
  site: /^\/[^\s?#]*$/,
  video: /^https:\/\/youtube\.com\/shorts\/4PBe8vSmcwM$/,
  post: /^https:\/\/x\.com\/ch1ngukim\/status\/2113590210952921290$/,
};
const ITEM_STATUSES = ['prior', 'done', 'in_progress', 'planned', 'open', 'out_of_scope', 'dropped'];
const LABELS = ['testnet', 'prototipo', 'planificado', 'info'];
const NODE_IDS = ['medidor', 'entrada', 'filtros', 'lotes', 'feed', 'proponente', 'verificador', 'cuenta', 'cualquiera'];
const SIM_LABELS = [
  { es: 'Entrada simulada · Stellar testnet', en: 'Simulated input · Stellar testnet' },
  { es: 'Entrada simulada · assurance A0 · Stellar testnet', en: 'Simulated input · assurance A0 · Stellar testnet' },
];
const PRESENT_TENSE = [
  /\bla cuenta de anclaje (tiene|exige|usa|esta activa)\b/, /\bcuenta 2 de 3 (creada|activa)\b/,
  /\bthe anchoring account (has|requires|uses|is live)\b/, /\b2-of-3 account (created|is live)\b/,
];
const MONTHS_EN = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const MONTHS_ES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const pad = (n) => String(n).padStart(2, '0');

function isStrKeyG(s) {
  if (!/^G[A-Z2-7]{55}$/.test(s)) return false;
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0; const out = [];
  for (const ch of s) { val = (val << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  if (out.length !== 35 || out[0] !== 6 << 3) return false;
  let crc = 0;
  for (let i = 0; i < 33; i++) { crc ^= out[i] << 8; for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
  return out[33] === (crc & 255) && out[34] === (crc >> 8);
}

function changelogWeeks() {
  const res = { en: {}, es: {} };
  if (exists('CHANGELOG.md')) {
    const t = readText('CHANGELOG.md');
    const re = /^## Week (\d+) — (\d+) to (\d+) (\w+) (\d{4})$/gm; let m;
    while ((m = re.exec(t))) {
      const mo = MONTHS_EN[m[4].toLowerCase()];
      const next = t.slice(re.lastIndex).search(/^## /m);
      res.en[m[1]] = { heading: m[0].slice(3), from: `${m[5]}-${pad(mo)}-${pad(m[2])}`, to: `${m[5]}-${pad(mo)}-${pad(m[3])}`, section: t.slice(m.index, next < 0 ? t.length : re.lastIndex + next) };
    }
  }
  if (exists('CHANGELOG.es.md')) {
    const t = readText('CHANGELOG.es.md');
    const re = /^## Semana (\d+) — (\d+) al (\d+) de (\w+) de (\d{4})$/gm; let m;
    while ((m = re.exec(t))) {
      const mo = MONTHS_ES[m[4].toLowerCase()];
      res.es[m[1]] = { heading: m[0].slice(3), from: `${m[5]}-${pad(mo)}-${pad(m[2])}`, to: `${m[5]}-${pad(mo)}-${pad(m[3])}` };
    }
  }
  return res;
}

function statusRules(S, opts = {}) {
  const F = 'assets/status.json';
  const f = (sub, excerpt, hint) => fail(F, 0, 'R-STATUS', sub, excerpt, hint);
  const pair = (o, where) => { if (!o || typeof o.es !== 'string' || typeof o.en !== 'string' || !o.es.trim() || !o.en.trim()) f('1', where, 'every {es, en} object needs two non-empty strings'); };
  if (!S || S.version !== 1) f('1', 'version', 'version must be 1');
  if (!S || typeof S !== 'object') return;
  const weeks = S.weeks || [], items = S.items || [], nodes = S.nodes || [], dels = S.deliverables || [];
  const ids = new Set();
  for (const x of [...items, ...nodes, ...dels]) { if (ids.has(x.id)) f('1', x.id, 'ids must be unique'); ids.add(x.id); }
  const weekNs = new Set(weeks.map((w) => w.n));
  const itemIds = new Set(items.map((i) => i.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  pair(S.labels && S.labels.sim, 'labels.sim');
  if (S.labels && S.labels.sim && !SIM_LABELS.some((l) => l.es === S.labels.sim.es && l.en === S.labels.sim.en)) f('1', 'labels.sim', 'labels.sim must be the simulated-input label (or the V3-9 A0 label) and its translation');
  for (const w of weeks) {
    pair(w.title, `weeks[${w.n}].title`); pair(w.summary, `weeks[${w.n}].summary`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(w.to || '')) f('1', `weeks[${w.n}]`, 'from/to YYYY-MM-DD');
    for (const h of w.highlights || []) {
      pair(h.title, h.id); pair(h.text, h.id);
      if (!ITEM_STATUSES.includes(h.status)) f('1', h.id, 'status enum');
      if (!LABELS.includes(h.label)) f('1', h.id, 'label enum');
      if (w.changelog && !['done', 'prior'].includes(h.status)) f('8', h.id, 'highlights of a week with a changelog section are done or prior');
      evidenceRules(h.evidence || [], h.id, f);
    }
  }
  for (const d of dels) { pair(d.title, d.id); pair(d.summary, d.id); for (const i of d.items || []) if (!itemIds.has(i)) f('1', `${d.id} → ${i}`, 'deliverable item does not exist'); }
  for (const n of nodes) {
    if (!NODE_IDS.includes(n.id)) f('1', n.id, 'node id enum');
    if (!PARTS.includes(n.status)) f('1', n.id, 'node status ∈ testnet|prototipo|planificado');
    for (const i of n.items || []) if (!itemIds.has(i)) f('1', `${n.id} → ${i}`, 'node item does not exist');
  }
  for (const it of items) {
    pair(it.title, it.id); pair(it.summary, it.id);
    if (!ITEM_STATUSES.includes(it.status)) f('1', it.id, 'status enum');
    if (!LABELS.includes(it.label)) f('1', it.id, 'label enum');
    if (it.week === null ? it.status !== 'out_of_scope' : !weekNs.has(it.week)) f('1', it.id, 'week must exist in weeks (null only for out_of_scope)');
    for (const n of it.nodes || []) if (!nodeIds.has(n)) f('1', `${it.id} → ${n}`, 'item node does not exist');
  }
  /* the two directions agree: a node lists exactly the items that name it (the diagram panels read nodes[].items) */
  for (const n of nodes) {
    const want = items.filter((it) => (it.nodes || []).includes(n.id)).map((it) => it.id).sort().join(',');
    if ((n.items || []).slice().sort().join(',') !== want) f('1', `nodes[${n.id}].items`, `must list exactly the items whose nodes include it: ${want}`);
  }
  for (const it of items) {
    const ev = it.evidence || [];
    evidenceRules(ev, it.id, f);
    if (it.status === 'done') {
      if (!ev.some((e) => ['pr', 'commit', 'run', 'release'].includes(e.kind))) f('4', it.id, 'a done item needs a pr, commit, run or release link');
      if (!['testnet', 'prototipo', 'info'].includes(it.label)) f('4', it.id, 'a done item is testnet, prototipo or info');
    }
    if (it.status === 'planned') {
      if (it.label !== 'planificado') f('4', it.id, 'a planned item has label planificado');
      if (ev.some((e) => ['run', 'release'].includes(e.kind))) f('4', it.id, 'a planned item has no run or release evidence');
    }
    if (it.status === 'prior' && it.week !== 0) f('4', it.id, 'prior items are in week 0');
  }
  if (opts.quiet) return;
  /* 6–7: weeks and the changelog */
  const cl = changelogWeeks();
  for (const n of Object.keys(cl.en)) {
    const w = weeks.find((x) => String(x.n) === n);
    const es = cl.es[n];
    if (!w || !w.changelog) { f('6', `changelog week ${n}`, 'every changelog week needs a weeks[] entry with changelog set'); continue; }
    if (w.changelog.en !== cl.en[n].heading) f('6', w.changelog.en, `weeks[${n}].changelog.en must equal "${cl.en[n].heading}"`);
    if (!es || w.changelog.es !== es.heading) f('6', w.changelog.es, `weeks[${n}].changelog.es must equal the CHANGELOG.es.md heading`);
    if (w.from !== cl.en[n].from || w.to !== cl.en[n].to) f('6', `weeks[${n}] ${w.from}…${w.to}`, `dates must equal the changelog (${cl.en[n].from}…${cl.en[n].to})`);
  }
  for (const w of weeks) if (w.changelog && (!cl.en[w.n] || !cl.es[w.n])) f('6', `weeks[${w.n}].changelog`, 'a week with changelog set needs both changelog headings');
  for (const it of items.filter((x) => x.status === 'done')) {
    const sec = cl.en[it.week];
    if (!sec) { f('7', it.id, `a done item's week (${it.week}) needs a changelog section`); continue; }
    for (const e of it.evidence || []) if (['pr', 'run'].includes(e.kind) && !sec.section.includes(e.url)) f('7', `${it.id} ${e.url}`, 'its PR/run must appear inside that week\'s CHANGELOG.md section');
  }
  /* 9–11: the anchoring account */
  const acct = S.anchor && S.anchor.account;
  if (acct == null) {
    if ((items.find((i) => i.id === 'V3-4') || {}).status === 'done') f('9', 'V3-4', 'V3-4 cannot be done while anchor.account is null');
    const strs = []; (function coll(o) { if (typeof o === 'string') strs.push(o); else if (o && typeof o === 'object') Object.values(o).forEach(coll); })(S);
    for (const s of strs) for (const re of PRESENT_TENSE) if (re.test(normalize(s))) f('9', s, 'the real account does not exist yet: say "en preparación (semana 2)" / future tense');
    for (const p of PAGES) { const t = normalize(textOf(TREES[p])); for (const re of PRESENT_TENSE) { const m = re.exec(t); if (m) fail(p, 0, 'R-STATUS', '9', m[0], 'the real account does not exist yet: future tense'); } }
    if (TRACKED.some((x) => /^evidence\/account\/[^/]+\/abcd\.json$/.test(x))) f('9', 'evidence/account/*/abcd.json', 'no tests A–D evidence before the account exists');
  } else if (!isStrKeyG(acct) || KNOWN_PRIOR_ACCOUNTS.includes(acct)) f('10', acct, 'anchor.account must be a valid G… address and not an August or rehearsal account');
  if (exists('assets/qwatt-live.js')) {
    const lt = readText('assets/qwatt-live.js');
    if (/ANCHOR_ACCOUNT\s*[:=]\s*['"`]G/.test(lt)) f('11', 'ANCHOR_ACCOUNT literal', 'qwatt-live.js never hard-codes the anchoring account: it reads status.json');
    if (LIVE && LIVE.CONFIG && S.sprint) {
      const C = LIVE.CONFIG;
      const day = (d, add) => { const t = new Date(d + 'T03:00:00Z'); t.setUTCDate(t.getUTCDate() + add); return t.toISOString().replace('.000Z', 'Z'); };
      const want = weeks.filter((w) => w.n >= 1 && w.n <= 3).map((w) => ({ n: w.n, from: day(w.from, 0), to: day(w.to, 1) }));
      if (JSON.stringify(C.WEEKS) !== JSON.stringify(want)) f('11', 'qwatt-live.js WEEKS', 'fallback WEEKS must equal status.json weeks 1–3 as [from 03:00Z, to + 1 day 03:00Z)');
      if (!C.RUN || C.RUN.from !== S.sprint.run.from || C.RUN.to !== S.sprint.run.to) f('11', 'qwatt-live.js RUN', 'fallback RUN must equal status.json sprint.run');
      if (C.SPRINT_START !== day(S.sprint.day1, 0)) f('11', 'qwatt-live.js SPRINT_START', 'fallback SPRINT_START must equal status.json sprint.day1 03:00Z');
    }
  }
  /* 12: feeds */
  const pendingVerif = navEntries().some((e) => e.id === 'verificacion' && e.pending);
  for (const fd of S.feeds || []) {
    pair(fd.title, fd.id); pair(fd.note, fd.id);
    if (!['ensayo-8oct', 'muestra', 'corrida'].includes(fd.id) || !PARTS.includes(fd.label)) f('12', fd.id, 'feed id/label enum');
    if (fd.base == null) { if (fd.label !== 'planificado') f('12', fd.id, 'a feed without base is planificado'); continue; }
    if (fd.base.startsWith('/')) {
      const dir = fd.base.replace(/^\//, '');
      const ok = DEPLOYED_SET.has(dir + 'index.json') && DEPLOYED_SET.has(dir + 'ledger/batches.jsonl');
      if (!ok) { if (pendingVerif) warn(`feed ${fd.id} (${fd.base}) not built yet: group D generates it (verificacion is pending)`); else f('12', fd.base, 'a same-origin feed base needs index.json and ledger/batches.jsonl'); }
    } else {
      const u = /^https:\/\/([^/]+)\//.exec(fd.base);
      if (!u) f('12', fd.base, 'an absolute feed base must be https://…/');
      else if (!cspConnect().includes('https://' + u[1])) f('12', fd.base, 'the feed host must be in the CSP connect-src (R-VERCEL 7)');
    }
  }
  /* 13–14 */
  if (TREES['como-funciona.html']) {
    const got = all(TREES['como-funciona.html'], (e) => e.attrs['data-node'] != null).map((e) => e.attrs['data-node']);
    const uniq = [...new Set(got)].sort().join(',');
    if (uniq !== [...nodeIds].sort().join(',')) fail('como-funciona.html', 0, 'R-STATUS', '13', uniq, 'its [data-node] ids must equal status.json nodes[].id');
  }
  if (QSTATUS && QSTATUS.init) {
    let Q = null; try { Q = QSTATUS.init(S); } catch (e) { f('1', 'qwatt-status.js init()', e.message); }
    for (const p of PAGES) {
      for (const e of all(TREES[p], (x) => x.attrs['data-status-of'] != null)) {
        const ref = e.attrs['data-status-of'];
        let chip = null;
        try { chip = QSTATUS.chipFor(ref, S.updated); } catch (err) { chip = null; }
        if (!chip) { fail(p, lineAt(TEXTS[p], e.pos), 'R-STATUS', '14', ref, 'data-status-of names no item, node or week of status.json'); continue; }
        if (e.attrs['data-st'] !== chip.st) fail(p, lineAt(TEXTS[p], e.pos), 'R-STATUS', '14', e.raw, `stamped data-st must be "${chip.st}": run node ops/site-sync.js`);
      }
    }
  }
}
function evidenceRules(list, owner, f) {
  const changelog = exists('CHANGELOG.md') ? readText('CHANGELOG.md') : '';
  for (const e of list) {
    const re = EVIDENCE_PATTERNS[e.kind];
    if (!re) { f('3', `${owner} ${e.kind}`, 'unknown evidence kind'); continue; }
    const m = re.exec(e.url || '');
    if (!m) { f('3', `${owner} ${e.url}`, `URL does not match the ${e.kind} pattern`); continue; }
    if (e.result != null && !['red', 'green'].includes(e.result)) f('3', `${owner} ${e.url}`, 'result ∈ red|green');
    if (e.note) { if (!e.note.es || !e.note.en) f('1', `${owner} note`, 'note needs es and en'); }
    if (e.kind === 'doc') {
      const p = m[2];
      const ok = m[1] === 'blob' ? TRACKED_SET.has(p) : TRACKED.some((t) => t.startsWith(p.replace(/\/?$/, '/')));
      if (!ok) f('3', `${owner} ${e.url}`, 'doc path is not in git ls-files');
    }
    if (e.kind === 'site' && !resolvesSite(e.url).ok) f('3', `${owner} ${e.url}`, 'site path does not resolve to a deployed file (or a redirect source)');
    if (e.kind === 'commit') {
      const sha = e.url.split('/').pop();
      if (git(['rev-parse', '--is-shallow-repository']) === 'true\n') f('5', `${owner} ${sha}`, 'run with full history (fetch-depth: 0)');
      else if (git(['cat-file', '-e', sha + '^{commit}']) == null) f('5', `${owner} ${sha}`, 'commit does not exist in this repository');
    }
    if (e.kind === 'release') {
      const tag = e.url.split('/').pop();
      if (git(['rev-parse', '-q', '--verify', 'refs/tags/' + tag]) == null) f('5', `${owner} ${tag}`, 'release tag does not exist (fetch tags: fetch-depth: 0)');
    }
    if ((e.kind === 'pr' || e.kind === 'run') && !new RegExp(esc(e.url) + '(?!\\d)').test(changelog)) f('5', `${owner} ${e.url}`, 'PR and CI-run links must appear in CHANGELOG.md (the offline proof they exist)');
  }
}

/* ═════════════════════════════ vercel.json, links ═════════════════════════════ */

let VERCEL = null;
function cspConnect() {
  const hdr = cspHeader(); if (!hdr) return [];
  const d = cspDirectives(hdr); return d['connect-src'] || [];
}
/** A vercel.json `source` (path-to-regexp subset: raw groups, :name, :name*) as a RegExp. */
function vercelSourceRe(src) {
  let out = '', depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { out += c + (src[i + 1] || ''); i++; continue; }
    if (c === '(') { depth++; out += c; continue; }
    if (c === ')') { depth--; out += c; continue; }
    if (depth === 0 && c === ':') {
      const m = /^:([A-Za-z_]\w*)([*+?])?/.exec(src.slice(i));
      if (m) { out += m[2] === '*' ? '(.*)' : m[2] === '+' ? '(.+)' : '([^/]+)'; i += m[0].length - 1; continue; }
    }
    if (depth === 0 && '.+*?^$|[]{}'.includes(c)) { out += '\\' + c; continue; }
    out += c;
  }
  try { return new RegExp('^' + out + '$'); } catch (e) { return /^$/; }
}
/** Every header Vercel would send for a path (all matching blocks). */
function headersFor(p) {
  if (!VERCEL || !Array.isArray(VERCEL.headers)) return [];
  return VERCEL.headers.filter((h) => vercelSourceRe(h.source).test(p)).flatMap((h) => h.headers || []);
}
/** The CSP of an ordinary page (the home page). */
function cspHeader() {
  const h = headersFor('/').filter((x) => x.key.toLowerCase() === 'content-security-policy');
  return h.length ? h[0].value : null;
}
function cspDirectives(v) { const d = {}; v.split(';').map((s) => s.trim()).filter(Boolean).forEach((s) => { const [k, ...rest] = s.split(/\s+/); d[k.toLowerCase()] = rest; }); return d; }
function redirectSources() { return VERCEL && Array.isArray(VERCEL.redirects) ? VERCEL.redirects.map((r) => r.source) : []; }
function rewriteSources() { return VERCEL && Array.isArray(VERCEL.rewrites) ? VERCEL.rewrites.map((r) => r.source) : []; }
function pendingFiles() { return navEntries().filter((e) => e.pending && e.file).map((e) => e.file); }

/** Does a same-site path resolve? → { ok, file (deployed page file or null), via } */
function resolvesSite(p) {
  let clean = p.split('#')[0].split('?')[0];
  try { clean = decodeURI(clean); } catch (e) { return { ok: false }; }
  if (clean === '' || clean === '/') return { ok: true, file: 'index.html', via: 'file' };
  clean = clean.replace(/^\//, '');
  if (DEPLOYED_SET.has(clean)) return { ok: true, file: clean, via: 'file' };
  if (clean.endsWith('/') && (DEPLOYED_SET.has(clean + 'index.html') || DEPLOYED_SET.has(clean + 'index.json'))) return { ok: true, file: DEPLOYED_SET.has(clean + 'index.html') ? clean + 'index.html' : null, via: 'dir' };
  const slash = '/' + clean;
  if (redirectSources().includes(slash)) return { ok: true, file: null, via: 'redirect' };
  for (const src of rewriteSources()) { const re = new RegExp('^' + src.replace(/:[a-z]+/gi, '[^/]+') + '$'); if (re.test(slash)) return { ok: true, file: null, via: 'rewrite' }; }
  if (pendingFiles().includes(clean)) return { ok: true, file: null, via: 'pending' };
  return { ok: false };
}
function idsOf(file) { const t = TREES[file]; if (!t) return null; return new Set(all(t, (e) => e.attrs.id != null).map((e) => e.attrs.id)); }

function ruleLinks(file, text, tree) {
  const L = (pos) => lineAt(text, pos);
  const urls = [];
  if (tree) {
    for (const e of all(tree, () => true)) {
      for (const a of ['href', 'src']) if (e.attrs[a] != null) urls.push({ u: e.attrs[a], pos: e.pos, raw: e.raw, tag: e.tag, rel: e.attrs.rel || '' });
      if (e.attrs.srcset) e.attrs.srcset.split(',').forEach((s) => urls.push({ u: s.trim().split(/\s+/)[0], pos: e.pos, raw: e.raw }));
      if (e.attrs.style) { const re = /url\(\s*['"]?([^'")]+)/g; let m; while ((m = re.exec(e.attrs.style))) urls.push({ u: m[1], pos: e.pos, raw: e.raw }); }
    }
  } else if (ext(file) === 'css') {
    const re = /url\(\s*['"]?([^'")]+)/g; let m; while ((m = re.exec(text))) urls.push({ u: m[1], pos: m.index, raw: m[0] });
  }
  for (const { u, pos, raw, rel } of urls) {
    if (!u || /^(data:|mailto:|tel:|javascript:|about:)/i.test(u)) continue;
    if (/^(https?:)?\/\//i.test(u)) {
      if (/^https:\/\/qwatt\.org(\/|$)/.test(u)) { if (!/canonical|og:/.test(raw) && !rel.includes('canonical')) siteLink(file, u.replace(/^https:\/\/qwatt\.org/, '') || '/', pos, raw, L); continue; }
      githubLink(file, u, L(pos), raw);
      explorerLink(file, u, L(pos), raw);
      continue;
    }
    if (u.startsWith('#')) { if (u.length > 1 && tree && !idsOf(file).has(decodeURIComponent(u.slice(1)))) fail(file, L(pos), 'R-LINKS', '2', raw, `${u} does not exist in this page`); continue; }
    const absP = u.startsWith('/') ? u : ('/' + path.posix.normalize(path.posix.join(path.posix.dirname(file), u))).replace(/^\/\.\/?/, '/');
    siteLink(file, absP, pos, raw, L);
  }
  if (ext(file) === 'js') {
    text.split('\n').forEach((l, i) => {
      const re = /['"`](https:\/\/github\.com\/academiaseul\/QWATT\/[^'"`\s]+)['"`]/g; let m;
      while ((m = re.exec(l))) githubLink(file, m[1], i + 1, l);
      const re2 = /['"`](https:\/\/stellar\.expert\/[^'"`\s]+)['"`]/g;
      while ((m = re2.exec(l))) explorerLink(file, m[1], i + 1, l);
      const re3 = /['"`](\/(?:assets|evidence)\/[^'"`\s]+\.json)['"`]/g;
      while ((m = re3.exec(l))) if (!resolvesSite(m[1]).ok) fail(file, i + 1, 'R-LINKS', '6', l, `${m[1]} is not a deployed file`);
      const re4 = /\bfetch\(\s*['"`](\/[^'"`]*)['"`]/g;
      while ((m = re4.exec(l))) if (!resolvesSite(m[1]).ok) fail(file, i + 1, 'R-LINKS', '6', l, `${m[1]} is not deployed`);
    });
  }
}
function siteLink(file, p, pos, raw, L) {
  const r = resolvesSite(p);
  if (!r.ok) { fail(file, L(pos), 'R-LINKS', '1', raw, `${p} does not resolve to a deployed file, a rewrite, a redirect source or a pending page`); return; }
  const frag = p.includes('#') ? decodeURIComponent(p.split('#')[1]) : '';
  if (frag && r.file && pendingFiles().includes(r.file)) return;   // pending page: its group adds the anchor
  if (frag && r.file && /\.html$/.test(r.file)) {
    const ids = idsOf(r.file);
    if (ids && !ids.has(frag)) fail(file, L(pos), 'R-LINKS', '2', raw, `#${frag} does not exist in ${r.file}`);
  }
}
let CHANGELOG_TEXT = null, STATUS_TEXT = null;
function githubLink(file, u, line, raw) {
  const m = /^https:\/\/github\.com\/academiaseul\/QWATT\/(blob|tree)\/main\/([^#?]+)/.exec(u);
  if (m) {
    const p = decodeURIComponent(m[2]).replace(/\/$/, '');
    const ok = m[1] === 'blob' ? TRACKED_SET.has(p) : TRACKED.some((t) => t.startsWith(p + '/'));
    if (!ok) fail(file, line, 'R-LINKS', '4', raw, `${p} is not in the repository`);
    return;
  }
  if (/^https:\/\/github\.com\/academiaseul\/QWATT\/(pull|actions\/runs|commit|releases\/tag|compare)\//.test(u)) {
    if (CHANGELOG_TEXT == null) CHANGELOG_TEXT = exists('CHANGELOG.md') ? readText('CHANGELOG.md') : '';
    if (STATUS_TEXT == null) STATUS_TEXT = exists('assets/status.json') ? readText('assets/status.json') : '';
    const plain = u.split('#')[0];
    if (!CHANGELOG_TEXT.includes(plain) && !STATUS_TEXT.includes('"' + plain + '"')) fail(file, line, 'R-LINKS', '4', raw, 'PR/run/commit/release/compare links must come from status.json evidence or CHANGELOG.md');
  }
}
function explorerLink(file, u, line, raw) {
  if (!/^https:\/\/stellar\.expert\//.test(u)) return;
  if (u === 'https://stellar.expert/explorer/testnet') return;   // the base a script builds tx links from
  const m = /^https:\/\/stellar\.expert\/explorer\/testnet\/(tx\/[0-9a-f]{64}|account\/(G[A-Z2-7]{55}))\/?$/.exec(u);
  if (!m || (m[2] && !isStrKeyG(m[2]))) fail(file, line, 'R-LINKS', '5', raw, 'stellar.expert links: …/explorer/testnet/tx/<64 hex> or /account/<valid G…> only');
}

/* ═════════════════════════════ R-I18N, R-A11Y ═════════════════════════════ */

function covered(el) {   // language-specific or language-neutral by an ancestor
  return !!closest(el, (n) => n.attrs['data-l'] != null || n.attrs.lang != null && n.tag !== 'html' || n.attrs.translate === 'no' || ['code', 'pre', 'kbd', 'samp', 'script', 'style', 'svg', 'noscript', 'template', 'title', 'head'].includes(n.tag));
}
function hasEN(el) {
  if (covered(el)) return true;
  if (all(el, (n) => n.attrs['data-l'] === 'en').length) return true;
  const t = textOf(el);
  if (!HAS_LETTER.test(t)) return !el.attrs['aria-label'] || !!el.attrs['data-aria-en'];
  return false;
}
function ruleI18n(file, text, tree) {
  const L = (pos) => lineAt(text, pos);
  const html = all(tree, (e) => e.tag === 'html')[0];
  if (!html || !(html.attrs['data-title-en'] || '').trim()) fail(file, 1, 'R-I18N', '2', '<html>', 'data-title-en on <html>');
  for (const e of all(tree, (n) => n.attrs['data-l'] != null)) {
    const l = e.attrs['data-l'];
    if (l !== 'es' && l !== 'en') { fail(file, L(e.pos), 'R-I18N', '1', e.raw, 'data-l is "es" or "en"'); continue; }
    const mate = l === 'es' ? nextElementSibling(e) : prevElementSibling(e);
    if (!mate || mate.attrs['data-l'] !== (l === 'es' ? 'en' : 'es')) fail(file, L(e.pos), 'R-I18N', '1', e.raw + textOf(e), `a data-l="${l}" element needs its ${l === 'es' ? 'EN twin as next' : 'ES twin as previous'} element sibling`);
    if (!textOf(e) && !all(e, (n) => n.tag === 'img' || n.tag === 'svg').length) fail(file, L(e.pos), 'R-I18N', '1', e.raw, 'a language pair member is empty');
  }
  const required = all(tree, (e) => ['h1', 'h2', 'h3', 'button', 'label', 'summary', 'caption', 'th'].includes(e.tag) || hasClass(e, 'q-lead') || hasClass(e, 'q-status') || hasClass(e, 'q-chip') || hasClass(e, 'q-src'));
  for (const e of required) if (!hasEN(e)) fail(file, L(e.pos), 'R-I18N', '2', `<${e.tag}> ${textOf(e)}`, 'needs an EN twin (data-l pair), translate="no" for names, or no letters');
  for (const e of all(tree, (n) => n.attrs['aria-label'] != null)) if (!(e.attrs['data-aria-en'] || '').trim() && !covered(e) && HAS_LETTER.test(e.attrs['aria-label'])) fail(file, L(e.pos), 'R-I18N', '2', e.raw, 'aria-label needs data-aria-en');
  if (file in FULL_BILINGUAL) {
    const scopes = FULL_BILINGUAL[file] ? FULL_BILINGUAL[file].map((id) => all(tree, (e) => e.attrs.id === id)[0]).filter(Boolean) : all(tree, (e) => e.tag === 'body');
    const seen = new Set();
    for (const sc of scopes) walk(sc, (n) => {
      if (n.type !== 'text' || !HAS_LETTER.test(decode(n.text))) return;
      if (covered(n.parent)) return;
      const key = n.parent.pos; if (seen.has(key)) return; seen.add(key);
      fail(file, L(n.pos), 'R-I18N', '2', decode(n.text), 'this page is fully bilingual: wrap the text in a data-l="es"/"en" pair');
    });
  } else if (!all(tree, (e) => hasClass(e, 'q-en-note')).some((e) => textOf(e).includes(EN_BODY_NOTE))) {
    fail(file, 0, 'R-I18N', '2', 'no EN body note', 'a page with a Spanish body shows the EN note (.q-en-note): "' + EN_BODY_NOTE + '"');
  }
}
function ruleI18nDicts(file, text) {
  text.split('\n').forEach((l, i) => {
    const re = /(?<![.\w$])es\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g; let m;   // a key es: (not x.es in a ternary)
    while ((m = re.exec(l))) {
      const tail = l.slice(re.lastIndex);
      if (/^\s*[+.(?]/.test(tail)) continue;          // a computed string: checked at runtime, not here
      const en = /^\s*,\s*en\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(tail);
      if (!en || !en[2].trim() || !m[2].trim()) fail(file, i + 1, 'R-I18N', '3', l, 'every es: string is followed by a non-empty en: string');
    }
  });
}
function ruleA11y(file, text, tree) {
  const L = (pos) => lineAt(text, pos);
  const html = all(tree, (e) => e.tag === 'html')[0];
  if (!html || html.attrs.lang !== 'es') fail(file, 1, 'R-A11Y', '1', '<html>', '<html lang="es">');
  const title = all(tree, (e) => e.tag === 'title')[0];
  if (!title || !textOf(title)) fail(file, 1, 'R-A11Y', '1', '<title>', 'non-empty <title>');
  const h1s = all(tree, (e) => e.tag === 'h1');
  if (h1s.length !== 1) fail(file, h1s[1] ? L(h1s[1].pos) : 0, 'R-A11Y', '1', `${h1s.length} h1`, 'exactly one h1');
  let prev = 0;
  for (const h of all(tree, (e) => /^h[1-6]$/.test(e.tag))) {
    const lv = +h.tag[1];
    if (prev && lv > prev + 1) fail(file, L(h.pos), 'R-A11Y', '1', `<${h.tag}> ${textOf(h)}`, `heading level skips (h${prev} → h${lv})`);
    prev = lv;
  }
  for (const e of all(tree, (n) => n.tag === 'img')) if (e.attrs.alt == null || (e.attrs.alt === '' && e.attrs['aria-hidden'] !== 'true' && e.attrs.role !== 'presentation')) fail(file, L(e.pos), 'R-A11Y', '2', e.raw, '<img> needs alt');
  for (const e of all(tree, (n) => n.tag === 'svg' && !closest(n.parent, (p) => p.tag === 'svg'))) {
    if (e.attrs['aria-hidden'] === 'true') continue;
    const named = (e.attrs.role === 'img' || e.attrs.role === 'group') && (e.attrs['aria-labelledby'] || e.attrs['aria-label'] || all(e, (n) => n.tag === 'title').length);
    if (!named) fail(file, L(e.pos), 'R-A11Y', '2', e.raw, 'inline <svg>: aria-hidden="true", or role="img"/"group" with a name');
  }
  for (const e of all(tree, (n) => n.tag === 'button')) {
    if (!e.attrs.type) fail(file, L(e.pos), 'R-A11Y', '3', e.raw, '<button type="button">');
    if (!textOf(e) && !e.attrs['aria-label']) fail(file, L(e.pos), 'R-A11Y', '3', e.raw, 'button needs a name');
  }
  for (const e of all(tree, (n) => ['input', 'select', 'textarea'].includes(n.tag) && n.attrs.type !== 'hidden')) {
    const id = e.attrs.id;
    const lab = id && all(tree, (n) => n.tag === 'label' && n.attrs.for === id).length;
    if (!lab && !e.attrs['aria-label'] && !closest(e, (n) => n.tag === 'label')) fail(file, L(e.pos), 'R-A11Y', '3', e.raw, 'form control needs <label for> or aria-label');
  }
  for (const e of all(tree, () => true)) {
    if (e.attrs.role === 'button' && e.attrs.tabindex !== '0' && e.tag !== 'button') fail(file, L(e.pos), 'R-A11Y', '3', e.raw, 'role="button" needs tabindex="0"');
    if (e.attrs.tabindex != null && +e.attrs.tabindex > 0) fail(file, L(e.pos), 'R-A11Y', '4', e.raw, 'no positive tabindex');
    if (e.attrs.accesskey != null || e.attrs.autofocus != null) fail(file, L(e.pos), 'R-A11Y', '4', e.raw, 'no accesskey / autofocus');
    if (e.tag === 'a' && e.attrs.target === '_blank') {
      const t = textOf(e);
      const ok = /pesta(ñ|n)a nueva|new tab/i.test(t) || (/↗/.test(t) && (e.attrs['aria-label'] || all(e, (n) => hasClass(n, 'q-vh')).length));
      if (!ok) fail(file, L(e.pos), 'R-A11Y', '5', e.raw + t, 'a new-tab link says so: visually hidden "(abre en una pestaña nueva)" or ↗ with an aria-label');
    }
    if (e.tag === 'table') {
      if (!all(e, (n) => n.tag === 'caption').length && !e.attrs['aria-label'] && !e.attrs['aria-labelledby']) fail(file, L(e.pos), 'R-A11Y', '6', e.raw, 'table needs <caption> or aria-label');
      for (const th of all(e, (n) => n.tag === 'th')) if (!th.attrs.scope) fail(file, L(th.pos), 'R-A11Y', '6', th.raw, '<th scope="col|row">');
    }
  }
  const skip = all(tree, (e) => e.tag === 'a' && hasClass(e, 'q-skip'))[0];
  const main = all(tree, (e) => e.tag === 'main')[0];
  if (!skip || skip.attrs.href !== '#main') fail(file, 0, 'R-A11Y', '7', 'skip link', 'skip link <a class="q-skip" href="#main">');
  if (!main || main.attrs.id !== 'main') fail(file, 0, 'R-A11Y', '7', 'main', '<main id="main">');
}

/* ═════════════════════════════ R-WEIGHT ═════════════════════════════ */

const KB = 1024;
const BUDGET = {
  'index.html': 140, 'whitepaper.html': 140, 'terminos.html': 110, 'verificacion.html': 110, 'hoja-de-ruta.html': 110, '404.html': 20,
  'assets/site.css': 45, 'assets/site.js': 30, 'assets/qwatt-live.js': 30, 'assets/live-widgets.js': 45, 'assets/qwatt-status.js': 20,
  'assets/qwatt-feed.js': 15, 'assets/qwatt-verify-steps.js': 30, 'assets/qwatt-envelope.js': 8, 'assets/qwatt-tests.js': 20,
  'assets/qwatt-protocol.js': 100, 'assets/status.json': 60,
};
function budgetOf(f) {
  if (BUDGET[f]) return BUDGET[f];
  if (/^assets\/pages\/.+\.css$/.test(f)) return 15;
  if (/^assets\/pages\/.+\.js$/.test(f)) return 40;
  if (/\.html$/.test(f)) return 90;
  return null;
}
const MARKERS = ['StellarSdk', 'TransactionBuilder', 'stellar-base', 'tweetnacl', '@stellar/', '@creit.tech', '__webpack_require__', 'var __create=Object.create', '/*! For license information'];
function ruleWeight(table) {
  for (const f of DEPLOYED) {
    if (f.startsWith('assets/vendor/')) fail(f, 0, 'R-WEIGHT', 'vendor', f, 'nothing under assets/vendor/ is deployed');
    const b = budgetOf(f);
    const size = TEXTS[f] != null ? Buffer.byteLength(TEXTS[f]) : fs.statSync(path.join(ROOT, f)).size;
    if (b && size > b * KB) fail(f, 0, 'R-WEIGHT', 'budget', `${size} bytes`, `budget ${b} KB`);
    if (/\.(js|html)$/.test(f) && TEXTS[f] != null) {
      TEXTS[f].split('\n').forEach((l, i) => {
        if (l.length > 5000 && !/application\/ld\+json|^\s*\{"@context"|rel="icon"/.test(l)) fail(f, i + 1, 'R-WEIGHT', 'long-line', l.slice(0, 60), `line of ${l.length} characters (a minified bundle?)`);
      });
      for (const mk of MARKERS) { const at = TEXTS[f].indexOf(mk); if (at >= 0) fail(f, lineAt(TEXTS[f], at), 'R-WEIGHT', 'bundle-marker', mk, 'a bundled SDK or minified library: not on this site'); }
    }
  }
  for (const p of PAGES) {
    const refs = new Set();
    for (const e of all(TREES[p], (n) => (n.tag === 'script' && n.attrs.src) || (n.tag === 'link' && /stylesheet/.test(n.attrs.rel || '')))) {
      const u = e.attrs.src || e.attrs.href;
      if (/^(https?:)?\/\//.test(u)) continue;
      const rel = (u.startsWith('/') ? u.slice(1) : path.posix.join(path.posix.dirname(p), u)).split('?')[0];
      if (DEPLOYED_SET.has(rel)) refs.add(rel);
    }
    let total = Buffer.byteLength(TEXTS[p]);
    for (const r of refs) total += TEXTS[r] != null ? Buffer.byteLength(TEXTS[r]) : fs.statSync(path.join(ROOT, r)).size;
    const cap = p === 'verificacion.html' ? 400 : 300;
    table.push({ page: p, html: Buffer.byteLength(TEXTS[p]), total, cap: cap * KB });
    if (total > cap * KB) fail(p, 0, 'R-WEIGHT', 'page-total', `${total} bytes with its scripts and styles`, `page total budget ${cap} KB`);
  }
}

/* ═════════════════════════════ run everything ═════════════════════════════ */

const selfRes = selfTest();

SITE = loadModule('assets/site.js');
LIVE = loadModule('assets/qwatt-live.js');
QSTATUS = loadModule('assets/qwatt-status.js');
if (SITE && SITE.__error) { fail('assets/site.js', 0, 'R-NAV', 'load', SITE.__error.message, 'site.js must load in Node (UMD)'); SITE = null; }
if (LIVE && LIVE.__error) { fail('assets/qwatt-live.js', 0, 'R-STATUS', 'load', LIVE.__error.message, 'qwatt-live.js must load in Node (UMD)'); LIVE = null; }
if (QSTATUS && QSTATUS.__error) { fail('assets/qwatt-status.js', 0, 'R-STATUS', 'load', QSTATUS.__error.message, 'qwatt-status.js must load in Node (UMD)'); QSTATUS = null; }
try { VERCEL = exists('vercel.json') ? JSON.parse(readText('vercel.json')) : null; } catch (e) { VERCEL = null; fail('vercel.json', 0, 'R-VERCEL', '1', e.message, 'vercel.json must parse'); }

// text rules
for (const f of PAGES.concat(SCRIPTS, STYLES)) { ruleVocab(f, TEXTS[f]); ruleLocation(f, TEXTS[f]); }
for (const f of COPYDATA) { ruleVocab(f, TEXTS[f]); ruleLocation(f, TEXTS[f]); }
for (const f of DEPLOYED) ruleLocationName(f);
for (const f of TEXT) { ruleOrg(f, TEXTS[f]); ruleSecretLiteral(f, TEXTS[f]); }
for (const f of PAGES.concat(SCRIPTS)) { ruleSecret(f, TEXTS[f]); ruleStorage(f, TEXTS[f]); ruleAnalytics(f, TEXTS[f]); }
for (const f of PAGES.concat(SCRIPTS, STYLES)) ruleHosts(f, TEXTS[f]);
for (const f of PAGE_JS) { ruleFieldsPageJS(f, TEXTS[f]); ruleNumJS(f, TEXTS[f]); ruleI18nDicts(f, TEXTS[f]); }
for (const f of PAGES) for (const s of all(TREES[f], (e) => e.tag === 'script' && e.attrs.src == null && (e.attrs.type || '') !== 'application/ld+json')) ruleFieldsPageJS(f, s.inner || '');
for (const f of SCRIPTS.filter((x) => READERS.includes(x))) ruleFieldsReader(f, TEXTS[f]);

// pages
for (const f of PAGES) { rulePage(f, TEXTS[f], TREES[f]); ruleLinks(f, TEXTS[f], TREES[f]); ruleI18n(f, TEXTS[f], TREES[f]); ruleA11y(f, TEXTS[f], TREES[f]); }
for (const f of STYLES.concat(SCRIPTS)) ruleLinks(f, TEXTS[f], null);

// R-NAV
(function navRules() {
  const F = 'assets/site.js';
  if (!SITE) { if (!exists(F)) fail(F, 0, 'R-NAV', 'missing', 'assets/site.js missing', 'SHELL provides assets/site.js with NAV (DESIGN Appendix C)'); return; }
  if (!Array.isArray(SITE.NAV)) { fail(F, 0, 'R-NAV', 'shape', 'NAV', 'site.js exports NAV (array of groups)'); return; }
  const entries = navEntries();
  for (const e of entries) {
    if (e.status && !PAGE_STATUSES.includes(e.status)) fail(F, 0, 'R-NAV', 'status', e.id, 'status enum');
    if (e.dot && !DOTS.includes(e.dot)) fail(F, 0, 'R-NAV', 'dot', e.id, 'dot ∈ testnet|prototipo|planificado|none');
    if (!e.es || !e.en) fail(F, 0, 'R-NAV', 'i18n', e.id, 'every entry has es and en');
    if (e.href === null && e.status !== 'planificado') fail(F, 0, 'R-NAV', 'nolink', e.id, 'an entry without a link is planificado');
    if (e.file) {
      if (!exists(e.file) && !e.pending) fail(F, 0, 'R-NAV', 'file', e.file, 'NAV names a file that does not exist');
      if (e.pending) warn(`NAV entry "${e.id}" is pending (${e.file}${exists(e.file) ? ' exists' : ' not built yet'}): INTEGRATE removes the flag`);
    }
    if (e.ext && !/^https:\/\//.test(e.href || '')) fail(F, 0, 'R-NAV', 'ext', e.id, 'external entries are https');
    if (e.href && /^https?:/.test(e.href)) { githubLink(F, e.href, 0, e.href); explorerLink(F, e.href, 0, e.href); }
  }
  for (const p of PAGES) {
    if (p === '404.html') continue;
    const e = entries.find((x) => x.file === p);
    if (!e) { fail(p, 0, 'R-NAV', 'entry', p, 'every deployed page has a NAV entry'); continue; }
    const body = all(TREES[p], (x) => x.tag === 'body')[0];
    const st = body && body.attrs['data-status'];
    const parts = body && body.attrs['data-parts'] != null ? body.attrs['data-parts'].split(/\s+/).filter(Boolean).sort().join(' ') : null;
    if (st !== e.status || parts !== (e.parts || []).slice().sort().join(' ')) fail(p, body ? lineAt(TEXTS[p], body.pos) : 0, 'R-NAV', 'match', `${st} [${parts}] vs NAV ${e.status} [${(e.parts || []).join(' ')}]`, 'data-status/data-parts must equal the NAV entry');
  }
  const pr = entries.find((x) => x.id === 'pruebas');
  if (pr) {
    const acct = STATUS && STATUS.anchor && STATUS.anchor.account;
    const want = acct && TRACKED_SET.has(`evidence/account/${acct}/abcd.json`) ? 'testnet' : 'planificado';
    if (pr.dot !== want) fail(F, 0, 'R-NAV', 'pruebas-dot', `pruebas dot ${pr.dot}`, `the pruebas dot is "${want}" (testnet only when the real account's abcd.json is published)`);
  }
})();

// R-VERCEL
(function vercelRules() {
  const F = 'vercel.json';
  if (!VERCEL) { if (!exists(F)) fail(F, 0, 'R-VERCEL', '1', 'missing', 'vercel.json'); return; }
  const deployedPage = (src) => { const m = /^\/([^/]+\.html)$/.exec(src); return m && DEPLOYED_SET.has(m[1]); };
  for (const r of VERCEL.redirects || []) {
    if (deployedPage(r.source)) fail(F, 0, 'R-VERCEL', '2', `${r.source} → ${r.destination}`, 'this redirect hides a restored page');
    const gh = /^https:\/\/github\.com\/academiaseul\/QWATT\/blob\/main\/(.+)$/.exec(r.destination);
    if (gh ? !TRACKED_SET.has(gh[1]) : !resolvesSite(r.destination).ok) fail(F, 0, 'R-VERCEL', '6', r.destination, 'redirect destination must be a deployed file, / or a repository file on GitHub');
  }
  if (DEPLOYED_SET.has('proof.html')) {
    if ((VERCEL.redirects || []).some((r) => r.source === '/proof/:id')) fail(F, 0, 'R-VERCEL', '2', '/proof/:id redirect', 'proof.html is deployed: remove the /proof/:id redirect');
    if (!(VERCEL.rewrites || []).some((r) => r.source === '/proof/:id' && r.destination === '/proof.html')) fail(F, 0, 'R-VERCEL', '2', 'rewrites', 'add { source: "/proof/:id", destination: "/proof.html" }');
  }
  for (const r of VERCEL.rewrites || []) if (!resolvesSite(r.destination).ok) fail(F, 0, 'R-VERCEL', '6', r.destination, 'rewrite destination does not resolve');
  const blk = (VERCEL.headers || []).find((h) => h.source === '/(.*)');
  const keys = blk ? (blk.headers || []).map((h) => h.key.toLowerCase()) : [];
  for (const k of SEC_HEADERS) if (!keys.includes(k.toLowerCase())) fail(F, 0, 'R-VERCEL', '3', k, 'keep the six security headers');
  const csp = cspHeader();
  if (!csp) fail(F, 0, 'R-VERCEL', '3', 'no Content-Security-Policy', 'add the CSP of DESIGN §6.6 for every page');
  /* Every deployed page gets exactly one CSP, equal to the canonical one (connect-src may add the feed host).
     Only a page under an active, hash-pinned exception (E5) may add the sha256 of its own inline scripts. */
  const CANON = cspDirectives(CSP_CANON);
  for (const p of PAGES) {
    const urlPath = p === 'index.html' ? '/' : '/' + p;
    const hs = headersFor(urlPath);
    const csps = hs.filter((h) => h.key.toLowerCase() === 'content-security-policy');
    for (const k of SEC_HEADERS) if (!hs.some((h) => h.key.toLowerCase() === k.toLowerCase())) fail(F, 0, 'R-VERCEL', '3', `${urlPath} ${k}`, 'every page keeps the six security headers');
    if (csps.length !== 1) { fail(F, 0, 'R-VERCEL', '3', `${urlPath}: ${csps.length} CSP headers`, 'every deployed page gets exactly one Content-Security-Policy'); continue; }
    const v = csps[0].value, d = cspDirectives(v);
    if (/unsafe-eval/.test(v)) fail(F, 0, 'R-VERCEL', '3', `${urlPath} unsafe-eval`, "no 'unsafe-eval'");
    const pinned = EXCEPTIONS.some((e) => e.file === p && e.sha256 && exceptionActive(e));
    const inlineHashes = all(TREES[p], (e) => e.tag === 'script' && e.attrs.src == null && (e.attrs.type || '') !== 'application/ld+json')
      .map((s) => `'sha256-${crypto.createHash('sha256').update(s.inner || '', 'utf8').digest('base64')}'`).sort();
    for (const k of new Set(Object.keys(CANON).concat(Object.keys(d)))) {
      const got = (d[k] || []).slice().sort(), want = (CANON[k] || []).slice().sort();
      if (k === 'script-src' && pinned && got.includes("'self'") && JSON.stringify(got.filter((x) => x !== "'self'").sort()) === JSON.stringify(inlineHashes)) continue;
      if (k === 'connect-src' && got.every((c) => want.includes(c) || FEED_HOSTS.map((h) => 'https://' + h).includes(c)) && want.every((c) => got.includes(c))) continue;
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        fail(F, 0, 'R-VERCEL', '3', `${urlPath} ${k} ${got.join(' ') || '(missing)'}`, k === 'script-src'
          ? (pinned ? "script-src: 'self' plus exactly the sha256 of this page's inline scripts" : "script-src exactly 'self' (a per-page CSP is allowed only while the page is under a hash-pinned exception)")
          : `${k} must be: ${want.join(' ') || '(absent)'}`);
      }
    }
  }
  const toml = (VERCEL.headers || []).find((h) => h.source === '/.well-known/stellar.toml');
  if (!toml || !(toml.headers || []).some((h) => h.key === 'Access-Control-Allow-Origin' && h.value === '*')) fail(F, 0, 'R-VERCEL', '4', 'stellar.toml CORS', 'keep the stellar.toml CORS header block');
  if (TREES['terminos.html']) {
    const named = all(TREES['terminos.html'], (e) => e.tag === 'code' && hasClass(e, 'q-host')).map((e) => textOf(e).replace(/^https?:\/\//, '').replace(/\/$/, ''));
    const want = (csp ? (cspDirectives(csp)['connect-src'] || []) : []).filter((c) => c !== "'self'").map((c) => c.replace(/^https:\/\//, '')).concat(FONT_HOSTS, ['qwatt.org']);
    const a = [...new Set(named)].sort().join(','), b = [...new Set(want)].sort().join(',');
    if (a !== b) fail('terminos.html', 0, 'R-VERCEL', '5', a, `the hosts named in 06 (code.q-host) must equal the CSP connect-src + font hosts + qwatt.org: ${b}`);
  }
  if (STATUS) for (const fd of STATUS.feeds || []) {
    const m = fd.base && /^https:\/\/([^/]+)\//.exec(fd.base);
    if (m && !cspConnect().includes('https://' + m[1])) fail(F, 0, 'R-VERCEL', '7', fd.base, 'the configured feed host must be in connect-src');
  }
})();

// R-IGNORE
(function ignoreRules() {
  const F = '.vercelignore';
  const lines = IGNORE_TEXT.split(/\r?\n/).map((l) => l.trim());
  for (const need of ['mining-rig', '.env*', 'node_modules', 'vendor-src', 'assets/vendor', 'qwatt-wallet.js', 'deployment.json', 'set-home-domain.js', 'ops', 'anchor', 'batch', 'live', 'ingest', 'docs', '.github', 'og-image.png', '_headers', 'protocol/*',
    'assets/gates.generated.js', 'README.md', 'THIRD_PARTY_NOTICES.md', 'evidence/harness', 'evidence/dress-rehearsal/WRITEUP-dress.md', 'evidence/asset-rehearsal/asset-*.json',
    'live-state', '/video', '*.mp4', '*.mov', '__pycache__', '.gitattributes']) {
    if (!lines.includes(need)) fail(F, 0, 'R-IGNORE', need, need, `.vercelignore must list "${need}"`);
  }
  const negs = lines.filter((l) => /^!protocol\//.test(l)).sort();
  const wantNegs = ['!protocol/batch.schema.json', '!protocol/interval.schema.json', '!protocol/reasons.json'];
  if (negs.join(',') !== wantNegs.join(',')) fail(F, 0, 'R-IGNORE', 'protocol-negations', negs.join(' ') || 'none', 'protocol/* with exactly the negations ' + wantNegs.join(' '));
  for (const f of DEPLOYED) {
    if (f.startsWith('assets/vendor/')) fail(F, 0, 'R-IGNORE', 'vendor', f, 'nothing under assets/vendor/ may deploy');
    if (/^protocol\/[^/]+\.js$/.test(f) || f.startsWith('protocol/conformance/')) fail(F, 0, 'R-IGNORE', 'protocol', f, 'protocol scripts and conformance data are not deployed (D-16)');
  }
})();

// R-SITEMAP
(function sitemapRules() {
  const F = 'sitemap.xml';
  if (!DEPLOYED_SET.has(F)) { fail(F, 0, 'R-SITEMAP', 'missing', F, 'sitemap.xml'); return; }
  const locs = [...TEXTS[F].matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
  const listed = new Set();
  for (const u of locs) {
    const m = /^https:\/\/qwatt\.org(\/.*)$/.exec(u);
    if (!m) { fail(F, 0, 'R-SITEMAP', 'host', u, 'https://qwatt.org/… only'); continue; }
    const p = m[1] === '/' ? 'index.html' : m[1].slice(1);
    if (/^proof\//.test(p) || p === '404.html' || !DEPLOYED_SET.has(p) || !/\.html$/.test(p)) fail(F, 0, 'R-SITEMAP', 'loc', u, 'every <loc> is a deployed page (never /proof/…, never 404.html)');
    if (redirectSources().includes('/' + p)) fail(F, 0, 'R-SITEMAP', 'redirected', u, 'a redirected path is not a page');
    listed.add(p);
  }
  for (const p of PAGES) if (p !== '404.html' && !listed.has(p)) fail(F, 0, 'R-SITEMAP', 'missing-page', p, 'every deployed page except 404.html is listed');
  if (locs.length && !/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(TEXTS[F])) fail(F, 0, 'R-SITEMAP', 'lastmod', 'lastmod', 'each <url> carries <lastmod>YYYY-MM-DD</lastmod>');
})();

// R-STATUS
if (!exists('assets/status.json')) fail('assets/status.json', 0, 'R-STATUS', 'missing', 'assets/status.json missing', 'SHELL provides status.json (DESIGN Appendix D)');
else {
  try { STATUS = JSON.parse(readText('assets/status.json')); } catch (e) { fail('assets/status.json', 0, 'R-STATUS', '1', e.message, 'status.json must parse'); }
  if (STATUS) statusRules(STATUS);
}

// R-WEIGHT
const weightTable = [];
ruleWeight(weightTable);

// exceptions
failures = applyExceptions(failures);
for (const ex of EXCEPTIONS) {
  if (!DEPLOYED_SET.has(ex.file)) { warn(`${ex.id} (${[].concat(ex.rule).join(', ')}) pending: ${ex.file} is not deployed`); continue; }
  if (!USED.has(ex)) fail(ex.file, 0, 'R-EXCEPTION', ex.id, `${ex.id} ${[].concat(ex.rule).join(',')} ${[].concat(ex.match).join(',')}`, ex.sha256 && sha256(TEXTS[ex.file] || '') !== ex.sha256
    ? `the file changed, so ${ex.id} no longer applies: delete the entry and make the file pass` : `exception ${ex.id} suppressed nothing: delete it`);
}

/* ═════════════════════════════ report ═════════════════════════════ */

if (selfRes.problems.length) for (const p of selfRes.problems) fail('ops/site.test.js', 0, 'SELF-TEST', 'control', p, 'the matcher is broken');
failures.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));

if (OPT.json) {
  console.log(JSON.stringify({ deployed: DEPLOYED.length, pages: PAGES, failures, warnings, weight: weightTable }, null, 2));
  process.exit(failures.length ? 1 : 0);
}
console.log('\nsite hard rules (every deployed file)');
console.log(`  deployed set: ${DEPLOYED.length} files · ${PAGES.length} pages (${PAGES.join(', ')}) · ${SCRIPTS.length} scripts · ${STYLES.length} styles · ${TEXT.length} text${OPT.include.length ? ' · --include ' + OPT.include.join(',') : ''}`);
console.log(`  ${selfRes.problems.length ? '✗' : '✓'} self-test: ${selfRes.counts}`);
for (const r of RULE_ORDER) {
  const n = failures.filter((f) => f.rule === r).length;
  console.log(`  ${n ? '✗' : '✓'} ${r}${n ? `: ${n} failure(s)` : ''}`);
}
for (const ex of EXCEPTIONS) if (USED.has(ex)) console.log(`  · ${ex.id} (${[].concat(ex.rule).join(', ')}) applied to ${ex.file} — ${ex.reason} · expires: ${ex.fd}`);
for (const w of warnings) console.log(`  · ${w}`);
if (OPT.showExcepted) for (const ex of EXCEPTIONS) for (const f of ex.suppressed || []) console.log(`    [${ex.id}] ${f.file}:${f.line} ${f.rule} ${f.sub} "${f.excerpt}"`);
console.log('\n  page weight (HTML · with its same-origin scripts and styles · budget)');
for (const r of weightTable) console.log(`    ${r.page.padEnd(22)} ${String(r.html).padStart(8)} B · ${String(r.total).padStart(8)} B · ${r.cap / KB} KB${r.total > r.cap ? '  ✗' : ''}`);
if (failures.length) {
  console.log('\nfailures:');
  for (const f of failures) {
    const tag = f.rule === 'R-VOCAB' || f.rule === 'R-LOCATION' ? `${f.rule}/${f.sub}` : /^\d+$/.test(f.sub) ? `${f.rule} ${f.sub}` : f.sub ? `${f.rule} (${f.sub})` : f.rule;
    console.log(`  ${f.file}:${f.line}  ${tag}  "${f.excerpt}"  → ${f.hint}`);
  }
}
console.log(`\nsite rules: ${failures.length} failure(s)`);
process.exit(failures.length ? 1 : 0);
