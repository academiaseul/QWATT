/**
 * QWATT — evidence feed on disk (Deliverable 2; published as static files in Deliverable 4)
 * ---------------------------------------------------------------------------
 * Layout (docs/ARCHITECTURE-FREEZE.md §5, plus the batch index):
 *
 *   <feed>/index.json                 head of the chain: latest batch, cumulative, versions
 *   <feed>/batches/<batch_id>.json    each batch, canonical JSON — accepted or rejected
 *   <feed>/ledger/batches.jsonl       one line per published batch: sha256, status, reasons
 *   <feed>/ledger/accepted.jsonl      one line per accepted interval, with batch id
 *   <feed>/ledger/rejected.jsonl      one line per rejected interval, with reason codes
 *
 * Every batch is published; only batches with status "accepted" are ever
 * anchored (Deliverable 3). Ledgers are append-only. Files that are replaced
 * (index.json, batch files) are written to a temp name and renamed, so a
 * reader never sees half a file.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const E = require('../protocol/evidence');

class Feed {
  constructor(dir) {
    this.dir = dir;
    for (const sub of ['batches', 'ledger']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }

  p(...parts) { return path.join(this.dir, ...parts); }

  _writeAtomic(file, text) {
    const tmp = file + '.tmp-' + process.pid;
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  }

  _append(file, obj) {
    const fd = fs.openSync(file, 'a');
    try { fs.writeSync(fd, JSON.stringify(obj) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  _readJsonl(file) {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  }

  readIndex() {
    const f = this.p('index.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  }

  appendInterval(line) {
    this._append(this.p('ledger', line.verdict === 'accept' ? 'accepted.jsonl' : 'rejected.jsonl'), line);
  }

  readLedger(kind) { return this._readJsonl(this.p('ledger', `${kind}.jsonl`)); }

  batchPath(batchId) { return this.p('batches', `${batchId}.json`); }

  hasBatch(batchId) { return fs.existsSync(this.batchPath(batchId)); }

  readBatch(batchId) { return JSON.parse(fs.readFileSync(this.batchPath(batchId), 'utf8')); }

  /** Publish a closed batch: file, then batch-ledger line, then index (the commit point). */
  publish(closed, meta = {}) {
    const { batch, status, reasons } = closed;
    if (!this.hasBatch(batch.batch_id)) this._writeAtomic(this.batchPath(batch.batch_id), E.canonical(batch) + '\n');
    if (!this.readLedger('batches').some((l) => l.batch_id === batch.batch_id)) {
      this._append(this.p('ledger', 'batches.jsonl'), {
        batch_id: batch.batch_id, seq: batch.seq, sha256: batch.sha256, status, reasons: reasons || [],
      });
    }
    this._writeAtomic(this.p('index.json'), JSON.stringify({
      latest_batch_id: batch.batch_id,
      latest_seq: batch.seq,
      head_sha256: batch.sha256,
      cumulative_mwh: batch.cumulative_mwh,
      spec_version: batch.spec_version,
      schema_version: batch.schema_version,
      last_ts_start: meta.last_ts_start ?? null,
      site_id: batch.site_id,
    }, null, 2) + '\n');
  }
}

module.exports = { Feed };
