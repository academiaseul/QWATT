#!/usr/bin/env node
/**
 * QWATT — what a live run is expected to refuse, listed before it starts (OD-9)
 * ---------------------------------------------------------------------------
 *   node live/expected.js [--write | --check]
 *
 * The simulator is a pure function of seed and time and the gates are fixed, so a run's refusals are
 * known in advance: run it fast in a temporary directory with the same seed, start and length, and
 * read its rejected ledger. That lists the injected faults, the night injections' leading edges and
 * the dawn and dusk refusals from G0's relative tolerance (B-3), which no fault window covers.
 *
 * --write writes the list for the live run to live/expected-run.json; --check exits 1 if that file is
 * not what the code gives. live/audit.js --expected compares a run with it, slot by slot.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runLive } = require('./run');

/** The live run (freeze v3 V3-14): Tue 10 Nov 00:00 Santiago (DV-12), seven days with no soak day. */
const RUN = { seed: 20261103, start: '2026-11-10T03:00:00.000Z', days: 7 };
const FILE = path.join(__dirname, 'expected-run.json');

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);

/**
 * @param {{seed:number, startMs:number, days:number}} o
 * @returns {Promise<{seed:number, days:number, run_start:string, run_end:string, label:string, intervals:number,
 *   refused:Array<{ts_start:string, reasons:string[], fault:string|null}>}>}  refused in time order; `fault` is the fault window it falls in
 */
async function expectedRefusals({ seed, startMs, days }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwatt-expected-'));
  try {
    await runLive({ feedDir: dir, days, startMs, seed, speed: 'fast', log: () => {} });
    const def = JSON.parse(fs.readFileSync(path.join(dir, 'faults.json'), 'utf8'));
    const accepted = readJsonl(path.join(dir, 'ledger', 'accepted.jsonl'));
    const judged = readJsonl(path.join(dir, 'ledger', 'rejected.jsonl')).filter((l) => !(l.reasons || []).some((c) => c.startsWith('ingest.')));
    const refused = judged.map((l) => {
      const at = Date.parse(l.interval.ts_start);
      const fault = def.faults.find((f) => at >= Date.parse(f.start) && at < Date.parse(f.end));
      return { ts_start: l.interval.ts_start, reasons: [...l.reasons].sort(), fault: fault ? fault.id : null };
    }).sort((x, y) => Date.parse(x.ts_start) - Date.parse(y.ts_start));
    return { seed: def.seed, days: def.days, run_start: def.run_start, run_end: def.run_end, label: def.label, intervals: accepted.length + judged.length, refused };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** One line per refusal, so a diff of the file reads slot by slot. */
function render(list) {
  const { refused, ...head } = list;
  const lines = refused.map((r) => '    ' + JSON.stringify(r));
  return JSON.stringify(head, null, 2).replace(/\n}$/, `,\n  "refused": [\n${lines.join(',\n')}\n  ]\n}\n`);
}

if (require.main === module) {
  (async () => {
    const text = render(await expectedRefusals({ seed: RUN.seed, startMs: Date.parse(RUN.start), days: RUN.days }));
    if (process.argv.includes('--write')) { fs.writeFileSync(FILE, text); console.log(`wrote ${path.relative(process.cwd(), FILE)}`); return; }
    if (process.argv.includes('--check')) {
      const same = fs.existsSync(FILE) && fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n') === text;
      console.log(same ? 'live/expected-run.json is what the code gives' : 'live/expected-run.json differs: run node live/expected.js --write and review the diff');
      process.exitCode = same ? 0 : 1;
      return;
    }
    process.stdout.write(text);
  })().catch((e) => { console.error(e.message); process.exitCode = 2; });
}

module.exports = { expectedRefusals, render, RUN };
