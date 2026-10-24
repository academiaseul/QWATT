#!/usr/bin/env node
/**
 * QWATT — the two sample feeds the verification page re-derives (DESIGN D-14, §9.3, Appendix E)
 * ---------------------------------------------------------------------------
 *   node ops/sample-feeds.js            write evidence/feeds/ensayo-8oct/ and evidence/feeds/muestra/
 *   node ops/sample-feeds.js --check    regenerate in memory, compare byte for byte, re-derive both (CI)
 *
 * Both feeds are written by the repository's own pipeline pieces (batch/assemble.js
 * BatchAssembler, batch/feed.js Feed) in the public feed layout, so
 * verificacion.html checks real protocol output, not a hand-made example:
 *
 *   ensayo-8oct  the two batches of the 8 Oct 2-of-3 rehearsal (anchor/rehearse.js
 *                makeBatches: site "rehearsal", 20 Sep 2026 from 15:00 UTC, 12
 *                intervals each, meters 100 W and 99 W). Their fingerprints are the
 *                ones tests C and L anchored on Stellar testnet (322923a4…, 852314a2…);
 *                generation fails if either differs, because the feed is useful only
 *                as the anchored data. makeBatches lives in a module that loads the
 *                Stellar SDK, so the same 12-line input builder is repeated here (test
 *                data, not protocol logic) and its result is asserted.
 *   muestra      a simulated day (20 Sep 2026, 09:00–17:00 UTC = 06:00–14:00 hora de
 *                Chile), 8 hourly batches on the bench profile, clear sky, both meters
 *                within agreement, with deliberate faults: a night injection, a covered
 *                sensor, an interval over the nameplate ceiling, a repeated interval, an
 *                off-grid timestamp, and one hour from a misconfigured node (batch 6,
 *                published as refused with batch.site_mismatch, carrying the total
 *                forward). Not anchored, on purpose.
 *
 * Each feed also gets feed.json, the site manifest (label, anchoring account and
 * signer roles, expected refusals). --check additionally runs batch/verify-cli.js
 * verifyFeed on both and requires every expected refusal to appear in the ledgers
 * with its code. Deterministic: same code, same bytes. Not deployed (ops/ is ignored).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const E = require(path.join(ROOT, 'protocol', 'evidence.js'));
const V = require(path.join(ROOT, 'batch', 'verify.js'));
const { BatchAssembler } = require(path.join(ROOT, 'batch', 'assemble.js'));
const { Feed } = require(path.join(ROOT, 'batch', 'feed.js'));
const { verifyFeed } = require(path.join(ROOT, 'batch', 'verify-cli.js'));

const OUT = 'evidence/feeds';
const BUDGET = 150 * 1024;
const REHEARSAL_SHA = ['322923a411c146079b73269fe3135d9e6413a9dafdb07807567c8a119f35a245', '852314a2a11f86548e3f8b09c16aa2fd6ef82ae8e8641db5ef20a4bc2d0f5466'];
const REHEARSAL_EVIDENCE = 'evidence/rehearsal/rehearsal-2026-10-08T20-46-13-037Z.json';

/* ───────────────────────────── helpers ───────────────────────────── */

function readTree(dir, base = dir, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) readTree(f, base, out);
    else out[path.relative(base, f).split(path.sep).join('/')] = fs.readFileSync(f, 'utf8');
  }
  return out;
}
function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-feed-')); }
function rmrf(d) { fs.rmSync(d, { recursive: true, force: true }); }
const json = (o) => JSON.stringify(o, null, 2) + '\n';

/** Judge → ledger line → close → publish, as batch/pipeline.js does, with the window closed every hour. */
function run(dir, hours, opts) {
  const feed = new Feed(dir);
  let asm = null, state;
  const closed = [];
  for (const h of hours) {
    if (!asm || asm.node_id !== h.node) asm = new BatchAssembler({ site_id: opts.site, node_id: h.node, closeEvery: 1000, state });
    /* h.payloads (engines with samples_root): the raw payloads each record was built from */
    h.records.forEach((rec, i) => feed.appendInterval(h.payloads ? asm.judge(rec, h.payloads[i]) : asm.judge(rec)));
    const c = asm.close();
    feed.publish(c, { last_ts_start: asm.last_ts_start });
    closed.push(c);
    state = asm.state();
  }
  return closed;
}

/* ───────────────────────────── ensayo-8oct ───────────────────────────── */

/** The inputs of anchor/rehearse.js makeBatches, verbatim. */
function rehearsalHours() {
  const T0 = Date.parse('2026-09-20T15:00:00Z'), DT = 300;
  const iv = (i) => {
    const t = T0 + i * DT * 1000;
    const m = (id, w) => ({ id, class: 'dc', mwh: Math.round(w * 1000 * DT / 3600), mw_mean: w * 1000, samples: 30 });
    return {
      spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION,
      site_id: 'rehearsal', node_id: 'rehearsal', seq: i,
      ts_start: new Date(t).toISOString(), ts_end: new Date(t + DT * 1000).toISOString(), dt_s: DT,
      meters: { a: m('pzem-017:1', 100), b: m('epever-tracer:2', 99) },
      source: { adapter: 'simulator', raw_sha256: E.sha256('rehearsal-' + i) },
    };
  };
  return [0, 1].map((b) => ({ node: 'rehearsal', records: Array.from({ length: 12 }, (_, i) => iv(b * 12 + i)) }));
}

function ensayoManifest() {
  const reh = JSON.parse(fs.readFileSync(path.join(ROOT, REHEARSAL_EVIDENCE), 'utf8'));
  const k = reh.public_keys;
  const th = reh.account_after_setup.thresholds;
  return {
    id: 'ensayo-8oct',
    title: { es: 'Ensayo del 8 oct', en: '8 Oct rehearsal' },
    label: 'testnet',
    prior: true,
    batch_schema: V.BATCH_SCHEMA_VERSION,
    source: {
      es: 'Los dos lotes del ensayo 2 de 3 del 8 oct, regenerados con el código del repositorio; sus huellas son las que anclaron las pruebas C y L.',
      en: 'The two batches of the 8 Oct 2-of-3 rehearsal, regenerated with the repository\'s code; their fingerprints are the ones tests C and L anchored.',
    },
    anchoring: {
      network: 'testnet',
      account: k.account,
      thresholds: `${th.low_threshold}/${th.med_threshold}/${th.high_threshold}`,
      signers: { proposer: k.proposer, verifier: k.verifier, third: k.third },
      evidence: '/' + REHEARSAL_EVIDENCE,
    },
    expected: { batches: 2, sha256: REHEARSAL_SHA, refusals: [] },
    generated_by: 'ops/sample-feeds.js',
  };
}

/* ───────────────────────────── muestra ───────────────────────────── */

const MUESTRA = { site: 'muestra-sim', node: 'muestra-sim-a', other: 'muestra-sim-b', day: '2026-09-20', from: '09:00', hours: 8 };

/**
 * One simulated day: clear sky from the gate engine's own solar position for the bench
 * profile (zero while the sun is below the horizon), meter a 0.4 % above and meter b
 * 0.4 % below the true value, so both always agree. Faults are written into the records
 * the node sends, exactly as a real fault would arrive.
 */
function muestraHours() {
  const G = V.GATES, P = V.SPEC.profiles.bench, DT = 300;
  const t0 = Date.parse(`${MUESTRA.day}T${MUESTRA.from}:00.000Z`);
  let seq = 0;
  const truth = (ms) => {
    const el = G.solarElevationDeg(new Date(ms + DT * 500), P.site.lat, P.site.lon);
    return el <= 0 ? 0 : P.nameplate_w * 0.8 * Math.pow(Math.sin(el * Math.PI / 180), 1.15);   // W
  };
  const mwh = (w) => Math.round(w * 1000 * DT / 3600);
  /* Under an engine with samples_root (batch schema 1.1.0) every record carries the raw payload it
     was built from (one simulated CSV row), and source.raw_sha256 binds to it (batch.schema.json R2),
     so the feed also gets raw/<batch>.jsonl. Under 1.0.0 the records stay as they were. */
  const withRaw = typeof E.rawStreamSha256 === 'function';
  const payloadsOf = new Map();
  const rec = (ms, node, aW, bW) => {
    const s = seq++;
    const r = {
      spec_version: V.SPEC.spec_version, schema_version: V.INTERVAL_SCHEMA_VERSION,
      site_id: MUESTRA.site, node_id: node, seq: s,
      ts_start: new Date(ms).toISOString(), ts_end: new Date(ms + DT * 1000).toISOString(), dt_s: DT,
      meters: { a: { id: 'pzem-017:1', class: 'dc', mwh: mwh(aW) }, b: { id: 'epever-tracer:2', class: 'dc', mwh: mwh(bW) } },
      source: { adapter: 'simulator', raw_sha256: E.sha256('muestra-' + s) },
    };
    if (withRaw) {
      const payloads = [{ n: 1, utf8: [s, r.ts_start, r.meters.a.mwh, r.meters.b.mwh].join(',') + '\n' }];
      r.source.raw_sha256 = E.rawStreamSha256(payloads);
      payloadsOf.set(r, payloads);
    }
    return r;
  };
  const faults = [];
  const hours = [];
  for (let h = 0; h < MUESTRA.hours; h++) {
    const node = h === 6 ? MUESTRA.other : MUESTRA.node;
    const records = [];
    for (let i = 0; i < 12; i++) {
      const ms = t0 + (h * 12 + i) * DT * 1000;
      const w = truth(ms);
      let aW = w * 1.004, bW = w * 0.996;
      if (h === 0 && i === 6) { aW = 24; bW = 23.8; }                         // night injection, before sunrise
      if (h === 3 && i === 5) { bW = w * 0.4; }                               // a covered sensor: the meters disagree
      if (h === 4 && i === 7) { aW = 196; bW = 195; }                         // over the 150 Wp nameplate ceiling
      if (h === 2 && i === 4) {                                               // a record off the 5-minute grid, sent before this slot
        const off = rec(ms - 150 * 1000, node, w, w);
        records.push(off);
        faults.push({ seq: off.seq, code: 'ingest.off_grid' });
      }
      const r = rec(ms, node, aW, bW);
      records.push(r);
      if (h === 0 && i === 6) faults.push({ seq: r.seq, code: 'elevation.night' });
      if (h === 3 && i === 5) faults.push({ seq: r.seq, code: 'agreement.diverge' });
      if (h === 4 && i === 7) faults.push({ seq: r.seq, code: 'nameplate.over' });
      if (h === 5 && i === 8) { records.push(r); faults.push({ seq: r.seq, code: 'ingest.duplicate_interval' }); }   // the same interval, sent twice
    }
    hours.push(withRaw ? { node, records, payloads: records.map((r) => payloadsOf.get(r)) } : { node, records });
  }
  return { hours, faults };
}

const WHY = {
  'elevation.night': { es: 'generación antes de que salga el sol', en: 'generation before sunrise' },
  'agreement.diverge': { es: 'un sensor tapado: los dos medidores no coinciden', en: 'a covered sensor: the two meters disagree' },
  'nameplate.over': { es: 'más energía de la que la placa permite', en: 'more energy than the nameplate allows' },
  'ingest.duplicate_interval': { es: 'el mismo intervalo, enviado dos veces', en: 'the same interval, sent twice' },
  'ingest.off_grid': { es: 'una hora fuera de la grilla de 5 minutos', en: 'a time off the 5-minute grid' },
  'batch.site_mismatch': { es: 'un nodo mal configurado durante una hora: el lote se publica rechazado y arrastra el total', en: 'a node misconfigured for one hour: the batch is published as refused and carries the total forward' },
};

function muestraManifest(faults) {
  const order = ['elevation.night', 'agreement.diverge', 'nameplate.over', 'ingest.duplicate_interval', 'ingest.off_grid'];
  const refusals = order.map((code) => { const f = faults.find((x) => x.code === code); return { seq: f.seq, code, why: WHY[code] }; });
  refusals.push({ batch: 6, code: 'batch.site_mismatch', why: WHY['batch.site_mismatch'] });
  return {
    id: 'muestra',
    title: { es: 'Feed de muestra', en: 'Sample feed' },
    label: 'prototipo',
    prior: false,
    batch_schema: V.BATCH_SCHEMA_VERSION,
    source: {
      es: 'Un día simulado (20 sep 2026, de 06:00 a 14:00 hora de Chile) armado con el código del repositorio, con fallas a propósito. No está anclado.',
      en: 'A simulated day (20 Sep 2026, 06:00 to 14:00 Chile time) built with the repository\'s code, with deliberate faults. Not anchored.',
    },
    anchoring: null,
    expected: { batches: MUESTRA.hours, refusals },
    generated_by: 'ops/sample-feeds.js',
  };
}

/* ───────────────────────────── generate / check ───────────────────────────── */

/** Both feeds, in memory: { 'ensayo-8oct/index.json': text, … }. */
function generate() {
  const files = {};
  const tmp = tempDir();
  try {
    const d1 = path.join(tmp, 'ensayo-8oct');
    if (V.BATCH_SCHEMA_VERSION === '1.0.0') {
      const c1 = run(d1, rehearsalHours(), { site: 'rehearsal' });
      c1.forEach((c, i) => {
        if (c.status !== 'accepted') throw new Error(`ensayo-8oct: batch ${i} was ${c.status} (${c.reasons.join(', ')})`);
        if (c.batch.sha256 !== REHEARSAL_SHA[i]) throw new Error(`ensayo-8oct: batch ${i} hashes to ${c.batch.sha256}, but tests ${i ? 'L' : 'C'} anchored ${REHEARSAL_SHA[i]} on Stellar testnet`);
      });
      /* an empty refusal ledger, so a reader that asks for it gets the file, not a 404 */
      const rej = path.join(d1, 'ledger', 'rejected.jsonl');
      if (!fs.existsSync(rej)) fs.writeFileSync(rej, '');
      fs.writeFileSync(path.join(d1, 'feed.json'), json(ensayoManifest()));
    } else {
      /* A later batch schema cannot rebuild the anchored 1.0.0 batches (the assembler writes samples_root
         and asks for raw payloads), so the committed files are kept byte for byte: they are the anchored data. */
      const committed = readTree(path.join(ROOT, OUT, 'ensayo-8oct'));
      for (const [rel, text] of Object.entries(committed)) {
        const f = path.join(d1, ...rel.split('/'));
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, text);
      }
      ['000000', '000001'].forEach((n, i) => {
        const b = JSON.parse(committed[`batches/rehearsal-${n}.json`]);
        const got = E.batchSha256(b);
        if (got !== REHEARSAL_SHA[i] || b.sha256 !== got) throw new Error(`ensayo-8oct: committed batch ${i} hashes to ${got}, but tests ${i ? 'L' : 'C'} anchored ${REHEARSAL_SHA[i]} on Stellar testnet`);
      });
    }

    const d2 = path.join(tmp, 'muestra');
    const m = muestraHours();
    const c2 = run(d2, m.hours, { site: MUESTRA.site });
    c2.forEach((c, i) => {
      const want = i === 6 ? 'rejected' : 'accepted';
      if (c.status !== want) throw new Error(`muestra: batch ${i} was ${c.status} (${c.reasons.join(', ')}), expected ${want}`);
    });
    if (!c2[6].reasons.includes('batch.site_mismatch')) throw new Error('muestra: batch 6 must be refused with batch.site_mismatch');
    fs.writeFileSync(path.join(d2, 'feed.json'), json(muestraManifest(m.faults)));

    for (const id of ['ensayo-8oct', 'muestra']) for (const [rel, text] of Object.entries(readTree(path.join(tmp, id)))) files[`${id}/${rel}`] = text;
  } finally { rmrf(tmp); }
  return files;
}

/** Re-derive both feeds from files (verify-cli) and check every expected refusal. @returns problems[] */
function verifyAll(baseDir) {
  const problems = [];
  for (const id of ['ensayo-8oct', 'muestra']) {
    const dir = path.join(baseDir, id);
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'feed.json'), 'utf8'));
    const out = verifyFeed(dir);
    if (id === 'muestra' || V.BATCH_SCHEMA_VERSION === '1.0.0') {
      if (!out.ok) problems.push(`${id}: verify-cli fails: ${out.problems.join('; ')}`);
    } else {
      /* FD-13: under batch schema ≥ 1.1.0 the rehearsal batches (1.0.0, no samples_root) may fail only for that reason */
      const codes = new Set(out.report.flatMap((r) => r.failures));
      for (const c of codes) if (!['batch.schema_invalid', 'batch.raw_missing'].includes(c)) problems.push(`${id}: under batch schema ${V.BATCH_SCHEMA_VERSION} fails with ${c}`);
    }
    if (out.batches !== man.expected.batches) problems.push(`${id}: ${out.batches} batches, feed.json expects ${man.expected.batches}`);
    const lines = (n) => { const f = path.join(dir, 'ledger', n); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
    const rejected = lines('rejected.jsonl'), batches = lines('batches.jsonl');
    if (man.expected.sha256 && JSON.stringify(batches.map((b) => b.sha256)) !== JSON.stringify(man.expected.sha256)) problems.push(`${id}: ledger hashes differ from feed.json expected.sha256`);
    for (const r of man.expected.refusals) {
      const hit = r.batch != null
        ? batches.some((b) => b.seq === r.batch && b.status === 'rejected' && (b.reasons || []).includes(r.code))
        : rejected.some((l) => l.interval && l.interval.seq === r.seq && (l.reasons || []).includes(r.code));
      if (!hit) problems.push(`${id}: expected refusal ${r.code} (${r.batch != null ? 'batch ' + r.batch : 'interval ' + r.seq}) is not in the ledgers`);
    }
  }
  return problems;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  let files;
  try { files = generate(); } catch (e) { console.error('sample-feeds: ' + e.message); process.exit(1); }
  for (const id of ['ensayo-8oct', 'muestra']) {
    const size = Object.entries(files).filter(([k]) => k.startsWith(id + '/')).reduce((s, [, t]) => s + Buffer.byteLength(t), 0);
    if (size > BUDGET) { console.error(`sample-feeds: ${id} is ${size} bytes, over the ${BUDGET}-byte budget (DESIGN §13.4)`); process.exit(1); }
  }
  const outDir = path.join(ROOT, OUT);
  if (check) {
    const problems = [];
    const have = fs.existsSync(outDir) ? readTree(outDir) : {};
    for (const k of Object.keys(files)) {
      if (!(k in have)) problems.push(`${OUT}/${k} is missing`);
      else if (have[k] !== files[k]) problems.push(`${OUT}/${k} differs from a fresh generation`);
    }
    for (const k of Object.keys(have)) if (!(k in files)) problems.push(`${OUT}/${k} is not generated by ops/sample-feeds.js`);
    if (!problems.length) problems.push(...verifyAll(outDir));
    if (problems.length) { console.error('sample-feeds --check:\n  ' + problems.join('\n  ') + '\n  → run node ops/sample-feeds.js and commit the result'); process.exit(1); }
    console.log(`sample-feeds --check: ${Object.keys(files).length} files equal a fresh generation; ensayo-8oct re-derives to the anchored 322923a4… and 852314a2…; muestra re-derives with every expected refusal in its ledgers`);
  } else {
    for (const id of ['ensayo-8oct', 'muestra']) rmrf(path.join(outDir, id));
    for (const [k, text] of Object.entries(files)) {
      const f = path.join(outDir, ...k.split('/'));
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, text);
    }
    const problems = verifyAll(outDir);
    if (problems.length) { console.error('sample-feeds: written, but:\n  ' + problems.join('\n  ')); process.exit(1); }
    console.log(`sample-feeds: wrote ${Object.keys(files).length} files under ${OUT}/ (ensayo-8oct, muestra); both re-derive`);
  }
}

module.exports = { generate, verifyAll, REHEARSAL_SHA };
