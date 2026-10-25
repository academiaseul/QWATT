/**
 * QWATT — tests A–D, judged again from the published evidence (DESIGN §12.1–§12.3)
 * ---------------------------------------------------------------------------
 * The promise is that no single key can write a record, and the network itself
 * refuses one that tries. Week 2 publishes, for the real anchoring account,
 * evidence/account/<G…>/abcd.json with its index.json and raw files (signed
 * envelopes, Horizon's answers). This module re-derives a verdict from those files
 * alone, without reading the file's own verdict:
 *
 *   A, B  the envelope file rehashes to its index entry; its body hash (recomputed
 *         from the signed envelope) is C's transaction hash; one signature, which
 *         verifies for the proposer (A) / the verifier (B); thresholds 2/2/3 at
 *         submission; the network answered tx_bad_auth → REFUSED, as expected.
 *   C     on Stellar testnet (read live, or from the saved Horizon record): the
 *         same hash, its ledger and memo QW#n, two signatures: proposer + verifier.
 *   D     refused by the verifier with verifier.hash_mismatch, nothing submitted.
 *   I     refused with verifier.not_published, nothing submitted.
 *
 * worked() runs the same rules on the 8 Oct rehearsal (thresholds 1/2/3, the
 * earlier design, where A and B were refused as tx_failed / op_bad_auth) and on the
 * independence scenario of the 8 Oct end-to-end rehearsal.
 *
 * The file is never trusted about which account it describes: model() requires the
 * file's account to be the configured one (deps.account), transaction C to come
 * from that account, and judges the 2/2/3 setup from the account as read now on
 * Horizon (deps.live), with the proposer and verifier among its signers.
 *
 * Pure: everything it reads is handed in (deps.sha256, deps.envelope,
 * deps.signedBy, deps.horizonTx, deps.account, deps.live, deps.roles). Its output carries states, hashes, ledgers, memos
 * QW#n, public keys and registered reason codes only: never a batch id, a detail
 * text, a refusal log, a method, a Horizon response body or a tool version.
 * UMD: window.QWATT_TESTS. Zero dependencies, ES2017.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QWATT_TESTS = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PASSPHRASE = 'Test SDF Network ; September 2015';
  var EXPLORER = 'https://stellar.expert/explorer/testnet';
  var STEPS = { A: 'A_proposer_alone', B: 'B_verifier_alone', C: 'C_proposer_plus_verifier', D: 'D_altered_after_proposer_signed', I: 'I_withheld_refused' };
  var ORDER = ['A', 'B', 'C', 'D', 'I'];
  var RAW = { A: ['A.envelope.xdr', 'A.horizon.json'], B: ['B.envelope.xdr', 'B.horizon.json'], C: ['C.transaction.json'], D: ['D.pending.xdr'], I: ['I.pending.xdr', 'I.refusals.jsonl'] };
  /* Registered codes the page may show, with their words (DESIGN §5.17). Nothing else is ever rendered. */
  var REASONS = {
    tx_bad_auth: { es: 'faltan firmas para el umbral bajo; la red no aplica la transacción.', en: 'not enough signatures for the low threshold; the network does not apply the transaction.' },
    tx_failed: { es: 'la transacción entró a validación pero una operación falló.', en: 'the transaction was validated but one operation failed.' },
    op_bad_auth: { es: 'la transacción era válida pero una operación no tenía firmas suficientes.', en: 'the transaction was valid but one operation lacked signatures.' },
    'verifier.hash_mismatch': { es: 'la transacción propuesta no lleva la huella del lote publicado.', en: 'the proposed transaction does not carry the published batch\'s fingerprint.' },
    'verifier.not_published': { es: 'el lote no está en el feed público.', en: 'the batch is not in the public feed.' }
  };
  var VERDICT = {
    PASS: { es: 'APROBADAS', en: 'PASSED' }, FAIL: { es: 'FALLARON', en: 'FAILED' }, INCOMPLETE: { es: 'INCOMPLETAS', en: 'INCOMPLETE' }
  };

  function registered(code) { return Object.prototype.hasOwnProperty.call(REASONS, code); }
  function codesOf(list) { return (Array.isArray(list) ? list : []).filter(registered); }
  function memo(m) { return typeof m === 'string' && /^QW#\d+$/.test(m) ? m : null; }
  /* The one place a memo field is read: it is masked to an anchoring memo QW#n at once; anything else is null. */
  var MEMO_KEY = 'memo';
  function memoOf(o) { return o ? memo(o[MEMO_KEY]) : null; }
  function isHash(h) { return typeof h === 'string' && /^[0-9a-f]{64}$/.test(h); }
  function isG(g) { return typeof g === 'string' && /^G[A-Z2-7]{55}$/.test(g); }
  function row(id, state, vals) { return { id: id, state: state, vals: vals || {} }; }
  function th(t) { return t ? [t.low_threshold, t.med_threshold, t.high_threshold].join('/') : null; }

  /** §12.1: what the tests page shows, from status.json's account and the abcd.json lookup. */
  function pageState(account, abcd) {
    if (!account) return { state: 'planificado', section2: false, line: 'planned' };
    if (!abcd) return { state: 'curso', section2: false, line: 'account-no-tests' };
    if (abcd.verdict === 'PASS' || abcd.verdict === 'FAIL') return { state: 'testnet', section2: true, line: 'published' };
    return { state: 'curso', section2: true, line: 'published' };
  }

  function rehash(deps, index, files, name) {
    if (!index || !index.files || !index.files[name]) return Promise.resolve(row('index', 'fail', { file: name, why: 'not-in-index' }));
    if (files[name] == null) return Promise.resolve(row('index', 'fail', { file: name, why: 'missing' }));
    return Promise.resolve(deps.sha256(files[name])).then(function (h) {
      return row('index', h === index.files[name] ? 'ok' : 'fail', { file: name, sha256: h, listed: index.files[name] });
    });
  }
  function firstLine(t) { return typeof t === 'string' ? (t.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean)[0] || '') : ''; }
  function sig(deps, key, signature, hash) {
    if (!deps.signedBy || !isG(key)) return Promise.resolve(null);
    return Promise.resolve(deps.signedBy(key, signature, hash)).then(function (v) { return v; }, function () { return null; });
  }

  /* ───────────────────────────── one refused single-signature step (A or B) ───────────────────────────── */

  function singleSig(letter, s, ctx, deps) {
    var xdr = ctx.files && ctx.files[RAW[letter][0]] != null ? firstLine(ctx.files[RAW[letter][0]]) : s.envelope_xdr;
    var role = letter === 'A' ? 'proposer' : 'verifier';
    var key = ctx.roles[role];
    var jobs = [];
    if (ctx.index) jobs.push(rehash(deps, ctx.index, ctx.files, RAW[letter][0]));
    var env = deps.envelope;
    var decoded = null;
    try { decoded = xdr ? env.decode(xdr) : null; } catch (e) { decoded = null; }
    if (!decoded || decoded.unsupported) {
      jobs.push(Promise.resolve(row('body', 'fail', { why: decoded && decoded.unsupported ? 'unsupported' : 'unreadable' })));
    } else {
      jobs.push(env.bodyHash(xdr, PASSPHRASE).then(function (h) {
        var ok = h === s.body_hash && (!ctx.cHash || h === ctx.cHash);
        return row('body', ok ? 'ok' : 'fail', { recomputed: h, recorded: isHash(s.body_hash) ? s.body_hash : null, c: ctx.cHash || null });
      }, function () { return row('body', 'na', { why: 'no-webcrypto' }); }));
      var sigs = decoded.signatures;
      jobs.push(Promise.resolve(row('one-sig', sigs.length === 1 && s.signatures === 1 ? 'ok' : 'fail', { count: sigs.length })));
      jobs.push((sigs.length ? env.bodyHash(xdr, PASSPHRASE) : Promise.resolve(null)).then(function (h) {
        if (!h || !sigs.length) return row('signer', 'fail', { role: role });
        return sig(deps, key, sigs[0].signature, h).then(function (v) {
          return row('signer', v === null ? 'na' : v ? 'ok' : 'fail', { role: role, key: isG(key) ? key : null, why: v === null ? 'no-ed25519' : null });
        });
      }, function () { return row('signer', 'na', { role: role, why: 'no-webcrypto' }); }));
    }
    var t = th(s.thresholds);
    if (ctx.earlier) {
      jobs.push(Promise.resolve(row('thresholds', t === '1/2/3' ? 'ok' : 'fail', { thresholds: t, earlier: true })));
      var c = s.codes || {};
      var ok = s.ok === false && c.transaction === 'tx_failed' && Array.isArray(c.operations) && c.operations.indexOf('op_bad_auth') >= 0;
      jobs.push(Promise.resolve(row('answer', ok ? 'refused' : 'fail', { codes: codesOf([c.transaction].concat(c.operations || [])), earlier: true })));
    } else {
      jobs.push(Promise.resolve(liveSetup(ctx, t)));
      var cc = s.codes || {};
      jobs.push(Promise.resolve(row('answer', s.refused === true && cc.transaction === 'tx_bad_auth' ? 'refused' : 'fail', { codes: codesOf([cc.transaction]) })));
    }
    return Promise.all(jobs);
  }

  /**
   * The frozen setup (freeze v3 §3), read from the account now, never from the file: thresholds 2/2/3,
   * master weight 0, exactly three other signers of weight 1, the proposer and the verifier among them.
   * No account read (Horizon offline, or not handed in): offline, so the verdict stays INCOMPLETE.
   */
  function liveSetup(ctx, fileThresholds) {
    var a = ctx.live;
    if (!a || !a.exists || !a.thresholds) return row('thresholds', 'offline', { file: fileThresholds, why: a && a.exists === false ? 'no-account' : 'no-read' });
    var others = (a.signers || []).filter(function (s) { return s.key !== a.id && s.weight > 0; });
    var keys = others.map(function (s) { return s.key; });
    var t = a.thresholds.low + '/' + a.thresholds.med + '/' + a.thresholds.high;
    var ok = t === '2/2/3' && a.masterWeight === 0 && others.length === 3 && others.every(function (s) { return s.weight === 1; }) &&
      isG(ctx.roles.proposer) && isG(ctx.roles.verifier) && keys.indexOf(ctx.roles.proposer) >= 0 && keys.indexOf(ctx.roles.verifier) >= 0;
    return row('thresholds', ok ? 'ok' : 'fail', { thresholds: t, live: true, file: fileThresholds, masterWeight: a.masterWeight, signersW1: others.filter(function (s) { return s.weight === 1; }).length });
  }

  /* ───────────────────────────── C: anchored with two signatures ───────────────────────────── */

  function anchored(s, ctx, deps) {
    var jobs = [];
    if (ctx.index) jobs.push(rehash(deps, ctx.index, ctx.files, 'C.transaction.json'));
    var saved = null;
    if (ctx.files && ctx.files['C.transaction.json'] != null) { try { saved = JSON.parse(ctx.files['C.transaction.json']); } catch (e) { saved = null; } }
    var live = deps.horizonTx && isHash(s.hash) ? Promise.resolve(deps.horizonTx(s.hash)).then(function (t) { return t ? { tx: t, src: 'vivo' } : null; }, function () { return { offline: true }; }) : Promise.resolve(null);
    jobs.push(live.then(function (l) {
      var src = l && l.tx ? l : saved ? { tx: { hash: saved.hash, ledger: saved.ledger, ok: saved.successful, memoShown: saved.memo_type === 'text' ? memoOf(saved) : null, signatures: saved.signatures || [], sourceAccount: saved.source_account || null }, src: 'archivo' } : null;
      if (!src) return [row('onchain', l && l.offline ? 'offline' : 'na', { why: l && l.offline ? 'horizon' : 'no-record' }), row('two-sigs', l && l.offline ? 'offline' : 'na', {})];
      var t = src.tx;
      /* C must come from the account under test (ctx.account), whether read live or from the saved record */
      var fromAccount = !ctx.account || t.sourceAccount === ctx.account;
      var okOn = t.ok === true && t.hash === s.hash && t.ledger === s.ledger && (!memoOf(s) || t.memoShown === memoOf(s)) && fromAccount;
      var r1 = row('onchain', okOn ? 'ok' : 'fail', { ledger: t.ledger, memoShown: t.memoShown || null, hash: t.hash, src: src.src, otherAccount: fromAccount ? null : (isG(t.sourceAccount) ? t.sourceAccount : 'unknown') });
      var sigs = Array.isArray(t.signatures) ? t.signatures : [];
      var names = ['proposer', 'verifier', 'third'].filter(function (n) { return isG(ctx.roles[n]); });
      return Promise.all(sigs.map(function (sg) {
        return Promise.all(names.map(function (n) { return sig(deps, ctx.roles[n], sg, s.hash); })).then(function (res) {
          if (res.some(function (v) { return v === null; })) return null;
          var i = res.indexOf(true); return i >= 0 ? names[i] : 'unknown';
        });
      })).then(function (roles) {
        if (roles.some(function (r) { return r === null; }) || !deps.signedBy) return [r1, row('two-sigs', 'na', { count: sigs.length, why: 'no-ed25519' })];
        var pair = roles.slice().sort().join('+');
        return [r1, row('two-sigs', sigs.length === 2 && pair === 'proposer+verifier' ? 'ok' : 'fail', { count: sigs.length, roles: roles, pair: pair, src: src.src })];
      });
    }));
    if (!ctx.earlier || s.link) jobs.push(Promise.resolve(row('link', s.link === EXPLORER + '/tx/' + s.hash && isHash(s.hash) ? 'ok' : 'fail', { url: isHash(s.hash) ? EXPLORER + '/tx/' + s.hash : null })));
    return Promise.all(jobs).then(function (rs) { return [].concat.apply([], rs); });
  }

  /* ───────────────────────────── D and I: refused by the verifier ───────────────────────────── */

  function refusedByVerifier(letter, s, want, ctx, deps) {
    var jobs = [];
    if (ctx.index) RAW[letter].forEach(function (f) { jobs.push(rehash(deps, ctx.index, ctx.files, f)); });
    var reasons = codesOf(s.reasons);
    jobs.push(Promise.resolve(row('reason', s.refused === true && reasons.indexOf(want) >= 0 ? 'refused' : 'fail', { codes: reasons })));
    var notSent = ctx.earlier ? s.submitted !== true : s.submitted === false;
    jobs.push(Promise.resolve(row('not-submitted', notSent ? 'ok' : 'fail', {})));
    return Promise.all(jobs);
  }

  function stepState(rows) {
    if (!rows.length) return 'fail';
    if (rows.some(function (r) { return r.state === 'fail'; })) return 'fail';
    if (rows.some(function (r) { return r.state === 'offline'; })) return 'offline';
    if (rows.every(function (r) { return r.state === 'na'; })) return 'na';
    return rows.some(function (r) { return r.state === 'refused'; }) ? 'refused' : 'ok';
  }
  function verdictOf(steps) {
    var states = ORDER.map(function (k) { return steps[k] ? steps[k].state : null; });
    if (states.some(function (s) { return s === 'fail'; })) return 'FAIL';
    if (states.some(function (s) { return s === null || s === 'offline' || s === 'na'; })) return 'INCOMPLETE';
    return 'PASS';
  }

  /**
   * The real account's evidence. deps.account: the anchoring account status.json names (required for PASS).
   * deps.live: that account as read now (QWATT_LIVE.account). deps.roles: { proposer, verifier } from the
   * public run feed; without it, the keys that signed A and B, which must then be signers of the live account.
   */
  function model(abcd, index, files, deps) {
    var st = (abcd && abcd.steps) || {};
    var A = st[STEPS.A], B = st[STEPS.B], C = st[STEPS.C], D = st[STEPS.D], I = st[STEPS.I];
    var roles = Object.assign({}, deps.roles || {});
    if (!roles.proposer && A && isG(A.signer_public_key)) roles.proposer = A.signer_public_key;
    if (!roles.verifier && B && isG(B.signer_public_key)) roles.verifier = B.signer_public_key;
    var configured = isG(deps.account) ? deps.account : null;
    var fileAccount = abcd && abcd.public_keys && isG(abcd.public_keys.account) ? abcd.public_keys.account : null;
    var accountRow = row('account', !configured ? 'na' : fileAccount === configured ? 'ok' : 'fail', { file: fileAccount, configured: configured });
    var ctx = { index: index, files: files || {}, roles: roles, cHash: C && isHash(C.hash) ? C.hash : null, earlier: false, account: configured, live: deps.live || null };
    var jobs = {
      A: A ? singleSig('A', A, ctx, deps) : null,
      B: B ? singleSig('B', B, ctx, deps) : null,
      C: C ? anchored(C, ctx, deps) : null,
      D: D ? refusedByVerifier('D', D, 'verifier.hash_mismatch', ctx, deps) : null,
      I: I ? refusedByVerifier('I', I, 'verifier.not_published', ctx, deps) : null
    };
    return Promise.all(ORDER.map(function (k) { return jobs[k]; })).then(function (res) {
      var steps = {};
      ORDER.forEach(function (k, i) {
        if (!res[i]) return;
        var s = st[STEPS[k]];
        steps[k] = { state: stepState(res[i]), rows: res[i], at: typeof s.at === 'string' ? s.at : null };
      });
      var verdict = verdictOf(steps);
      /* the file must describe the configured account: another account FAILS, no configured account cannot PASS */
      if (accountRow.state === 'fail') verdict = 'FAIL';
      else if (accountRow.state === 'na' && verdict === 'PASS') verdict = 'INCOMPLETE';
      var fileVerdict = abcd && VERDICT[abcd.verdict] ? abcd.verdict : null;
      return { steps: steps, verdict: verdict, fileVerdict: fileVerdict, agree: fileVerdict === verdict, account: fileAccount, accountCheck: accountRow };
    });
  }

  /** The 8 Oct rehearsal (thresholds 1/2/3, earlier design) and the 8 Oct independence scenario. */
  function worked(reh, e2e, deps) {
    var st = (reh && reh.steps) || {};
    var keys = (reh && reh.public_keys) || {};
    var roles = { proposer: keys.proposer, verifier: keys.verifier, third: keys.third };
    var C = st[STEPS.C];
    var t = reh && reh.account_after_setup ? reh.account_after_setup.thresholds : null;
    var withTh = function (s) { return s ? Object.assign({}, s, { thresholds: t }) : s; };
    var ctx = { index: null, files: {}, roles: roles, cHash: C && isHash(C.hash) ? C.hash : null, earlier: true, account: isG(keys.account) ? keys.account : null };
    var L = st.L_third_plus_verifier;
    var ind = e2e && e2e.scenarios ? e2e.scenarios.independence_unpublished : null;
    var after = e2e && e2e.scenarios ? e2e.scenarios.independence_after_publication : null;
    var I = ind && ind.verifier ? { refused: ind.verifier.action === 'refused', reasons: ind.verifier.reasons, submitted: false } : null;
    var D = st[STEPS.D] ? { refused: st[STEPS.D].refused === true, reasons: st[STEPS.D].reasons, submitted: false } : null;
    return Promise.all([
      st[STEPS.A] ? singleSig('A', withTh(st[STEPS.A]), ctx, deps) : null,
      st[STEPS.B] ? singleSig('B', withTh(st[STEPS.B]), ctx, deps) : null,
      C ? anchored(C, ctx, deps) : null,
      D ? refusedByVerifier('D', D, 'verifier.hash_mismatch', ctx, deps) : null,
      I ? refusedByVerifier('I', I, 'verifier.not_published', ctx, deps) : null
    ]).then(function (res) {
      var steps = {};
      ORDER.forEach(function (k, i) { if (res[i]) steps[k] = { state: stepState(res[i]), rows: res[i], at: null }; });
      return {
        steps: steps, verdict: verdictOf(steps), fileVerdict: reh && VERDICT[reh.verdict] ? reh.verdict : null, thresholds: th(t),
        account: isG(keys.account) ? keys.account : null, roles: roles,
        L: L && isHash(L.hash) ? { hash: L.hash, ledger: L.ledger, ok: L.ok === true } : null,
        independenceAfter: after && after.verifier && isHash(after.verifier.tx_hash) ? { hash: after.verifier.tx_hash, ledger: after.verifier.ledger, anchored: after.verifier.action === 'anchored' } : null
      };
    });
  }

  return { model: model, worked: worked, pageState: pageState, REASONS: REASONS, VERDICT: VERDICT, STEPS: STEPS, ORDER: ORDER, RAW: RAW, PASSPHRASE: PASSPHRASE };
}));
