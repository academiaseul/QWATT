/**
 * QWATT ops — the host package (plan W2-5): what ops/deploy/host and ops/deploy/wsl install.
 * Run: node ops/host-package.test.js     (zero dependencies: reads the working tree only)
 *
 * The package installs the same commit on both hosts: Node at /usr/bin/node (where every unit
 * calls it), stellar-cli 28.1.0, user qwatt, the units of the host's role only, its deploy key and
 * GitHub's pinned host key. On Jay's PC it also keeps WSL running with no window open and starts it
 * after a reboot with nobody signed in. It never generates or reads a stellar-cli key: each holder
 * does that in their own terminal (RUNBOOK, setup step 2). These checks hold the scripts to that.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, w) { assert(a === b, `${w}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const INSTALL = 'ops/deploy/host/install.sh', CHECK = 'ops/deploy/host/check.sh', README = 'ops/deploy/host/README.md';
const TASK = 'ops/deploy/wsl/instalar-wsl.ps1', WSLCONFIG = 'ops/deploy/wsl/wslconfig.example';
const PACKAGE = [INSTALL, CHECK, README, TASK, WSLCONFIG];
/** The value of a shell assignment NAME=value (quotes removed), or null. */
const shellVar = (text, name) => { const m = new RegExp(`^${name}=["']?([^"'\\s]+)["']?\\s*$`, 'm').exec(text); return m ? m[1] : null; };
/** The words of a shell array NAME=(a b c), or null. */
const shellArray = (text, name) => { const m = new RegExp(`^${name}=\\(([^)]*)\\)`, 'm').exec(text); return m ? m[1].trim().split(/\s+/) : null; };
const units = () => fs.readdirSync(path.join(ROOT, 'ops/deploy')).filter((n) => n.endsWith('.service'));

test('the package exists: install and check scripts for both hosts, the WSL task and a README', () => {
  for (const f of PACKAGE) assert(exists(f), `${f} exists`);
});

test('install.sh fails closed (set -euo pipefail) and runs only as root on 64-bit Ubuntu with systemd', () => {
  const s = read(INSTALL);
  assert(/^set -euo pipefail$/m.test(s), 'set -euo pipefail');
  assert(/id -u/.test(s) && /x86_64/.test(s) && /ID=ubuntu|ubuntu/.test(s) && /systemd/.test(s), 'checks root, x86_64, Ubuntu and systemd as PID 1');
});

test('Node is one pinned version, checked against its official SHA-256, and lands at /usr/bin/node, where every unit calls it', () => {
  const s = read(INSTALL);
  eq(shellVar(s, 'NODE_VERSION'), '24.14.1', 'Node version');
  eq(shellVar(s, 'NODE_SHA256'), '84d38715d449447117d05c3e71acd78daa49d5b1bfa8aacf610303920c3322be', 'SHA-256 of node-v24.14.1-linux-x64.tar.xz (nodejs.org SHASUMS256.txt)');
  assert(/sha256sum -c/.test(s), 'the download is checked with sha256sum -c before it is unpacked');
  assert(/ln -sfn? [^\n]*\/usr\/bin\/node\b/.test(s), 'links /usr/bin/node');
  for (const u of units()) {
    const exec = read(`ops/deploy/${u}`).split(/\r?\n/).find((l) => l.startsWith('ExecStart='));
    assert(exec && exec.startsWith('ExecStart=/usr/bin/node '), `${u} calls /usr/bin/node`);
  }
});

test('stellar-cli is 28.1.0, checked against the release\'s published SHA-256, which the RUNBOOK names, installed to /usr/local/bin', () => {
  const s = read(INSTALL);
  eq(shellVar(s, 'STELLAR_VERSION'), '28.1.0', 'stellar-cli version');
  /* the digest GitHub publishes for stellar-cli-28.1.0-x86_64-unknown-linux-gnu.tar.gz (release v28.1.0) */
  const SUM = 'c1680deee94301d33ada7a17f98411e642a4248c727afbd2e43050d345746462';
  eq(shellVar(s, 'STELLAR_SHA256'), SUM, 'install.sh checks the release digest');
  assert(read('docs/RUNBOOK.md').includes(SUM), 'the RUNBOOK names it, so a holder installing by hand checks the same sum');
  assert(/\/usr\/local\/bin\/stellar/.test(s) && /--only-version/.test(s), 'installs /usr/local/bin/stellar and checks the version it prints');
});

test('each role installs exactly its units (RUNBOOK, "The three machines"), and the two sets cover every unit', () => {
  const s = read(INSTALL);
  const p = shellArray(s, 'PROPOSER_UNITS'), v = shellArray(s, 'VERIFIER_UNITS');
  assert(p && v, 'PROPOSER_UNITS and VERIFIER_UNITS arrays');
  eq(p.sort().join(' '), 'qwatt-live.service qwatt-proposer.service qwatt-publish.service', 'proposer host');
  eq(v.sort().join(' '), 'qwatt-verifier-log.service qwatt-verifier.service qwatt-watch.service', 'verifier host');
  eq([...p, ...v].sort().join(' '), units().sort().join(' '), 'every unit in ops/deploy belongs to one role');
});

test('each role generates only its own deploy key, the one its publisher unit uses, and prints only the .pub', () => {
  const s = read(INSTALL);
  eq(shellVar(s, 'PROPOSER_DEPLOY_KEY'), 'qwatt-evidence', 'proposer host key');
  eq(shellVar(s, 'VERIFIER_DEPLOY_KEY'), 'qwatt-verifier-log', 'verifier host key');
  assert(read('ops/deploy/qwatt-publish.service').includes('--ssh-key /home/qwatt/.ssh/qwatt-evidence'), 'qwatt-publish uses qwatt-evidence');
  assert(read('ops/deploy/qwatt-verifier-log.service').includes('--ssh-key /home/qwatt/.ssh/qwatt-verifier-log'), 'qwatt-verifier-log uses qwatt-verifier-log');
  assert(/ssh-keygen -t ed25519 -N ""/.test(s), 'ed25519, no passphrase (a service uses it)');
  assert(/\.pub/.test(s) && !/cat [^\n]*\.ssh\/\$\{?DEPLOY_KEY\}?\s*$/m.test(s), 'prints the .pub, never the private file');
});

test('GitHub\'s host key is pinned only when it matches the published ED25519 fingerprint in the RUNBOOK', () => {
  const fp = 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU';
  assert(read('docs/RUNBOOK.md').includes(fp), 'the RUNBOOK names it');
  const s = read(INSTALL);
  eq(shellVar(s, 'GITHUB_ED25519_FP'), fp, 'install.sh pins the same fingerprint');
  assert(/ssh-keyscan -t ed25519 github\.com/.test(s) && /ssh-keygen -lf/.test(s), 'scans, then checks the fingerprint before writing known_hosts');
});

test('the package never generates, reads or prints a stellar-cli key: that is each holder\'s own step', () => {
  for (const f of [INSTALL, CHECK]) {
    const s = read(f);
    const run = s.replace(/<<'?EOF'?[\s\S]*?\nEOF\b/g, '').replace(/^\s*#.*$/gm, '').replace(/echo [^\n]*/g, '');
    assert(!/stellar keys (generate|secret|add|rm)\b/.test(run), `${f}: no stellar keys generate/secret/add/rm outside printed instructions`);
    assert(!/(cat|less|head|tail|cp|tar|scp)\b[^\n]*\.config\/stellar/.test(s), `${f}: never reads the identity store`);
  }
});

test('updates cannot restart anything during the run: unattended upgrades off, needrestart lists only (Q5)', () => {
  const s = read(INSTALL);
  assert(/apt-daily-upgrade\.timer/.test(s) && /unattended-upgrades/.test(s), 'stops the upgrade timer and unattended-upgrades');
  assert(/needrestart/.test(s) && /\$nrconf\{restart\} = 'l'/.test(s), 'needrestart only lists');
});

test('/opt/qwatt is the commit named on the command line, readable by qwatt as a safe git directory', () => {
  const s = read(INSTALL);
  assert(/--commit/.test(s) && /rev-parse HEAD/.test(s), 'checks that /opt/qwatt is at --commit');
  assert(/safe\.directory \/opt\/qwatt/.test(s), 'git safe.directory /opt/qwatt (the run publishes code_commit as user qwatt)');
  assert(/npm ci/.test(s), 'npm ci for anchor/');
});

test('env files are created from the placeholders only when missing (never overwritten), mode 600, and units are installed but not started', () => {
  const s = read(INSTALL);
  assert(/\[ -e "\$f" \]|\[\[ -e "\$f" \]\]|-e "\$\{?f\}?"/.test(s), 'an existing env file is kept');
  assert(/chmod 600/.test(s), 'mode 600');
  assert(/daemon-reload/.test(s) && !/systemctl (enable --now|start) qwatt-/.test(s), 'daemon-reload; nothing started before the keys and anchor.json exist');
});

test('WSL keeps running with no window open and starts after a reboot with nobody signed in', () => {
  const t = read(TASK);
  assert(/New-ScheduledTaskTrigger -AtStartup/.test(t), 'a task at startup');
  /* Windows refuses a LogonType Password task registered without its password (0x8007052E, found on
     Jay's PC on 30 Oct): the password is asked first and given to Register-ScheduledTask itself */
  const code = t.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  const askAt = code.search(/Get-Credential/), regAt = code.search(/Register-ScheduledTask/);
  assert(askAt >= 0 && regAt > askAt, 'the password is asked (Get-Credential) before the task is registered');
  assert(/Register-ScheduledTask[^\n]*(`\n[^\n]*)*-User [^\n]*-Password /.test(code), 'Register-ScheduledTask gets -User and -Password: it runs whether or not anyone is signed in');
  assert(!/New-ScheduledTaskPrincipal[^\n]*-LogonType Password/.test(code), 'no Password principal registered without its password');
  assert(/sleep infinity/.test(t), 'whose action keeps the distribution alive');
  assert(/RestartCount/.test(t) && /ExecutionTimeLimit\s*\(?\s*New-TimeSpan|ExecutionTimeLimit ([\w.]+::)?Zero|-ExecutionTimeLimit 0/.test(t), 'restarted on failure, no time limit');
  assert(/standby-timeout-ac 0/.test(t) && /hibernate off/i.test(t), 'the PC never sleeps on AC power');
  const w = read(WSLCONFIG);
  assert(/^\[wsl2\]/m.test(w) && /^vmIdleTimeout=-1/m.test(w) && /^memory=\d+GB/m.test(w), '.wslconfig: no idle shutdown, a memory cap (Q14)');
  assert(/\[boot\][\s\S]*systemd=true/.test(read(INSTALL)), 'install.sh turns systemd on in /etc/wsl.conf');
});

test('every acceptance test AT-1..AT-26 is defined once in the README; each automated one is in check.sh', () => {
  const r = read(README), c = read(CHECK);
  for (let i = 1; i <= 26; i++) {
    const rows = r.split(/\r?\n/).filter((l) => new RegExp(`^\\| AT-${i} \\|`).test(l));
    eq(rows.length, 1, `AT-${i} defined once in the README table`);
    if (/\| auto \|/.test(rows[0])) assert(new RegExp(`\\bAT-${i}\\b`).test(c), `AT-${i} is automated in check.sh`);
  }
});

test('CI runs the exact Node the hosts run (decision 1), and no action is pinned to a major older than v5 (GitHub retires the Node 20 action runtime)', () => {
  const ci = read('.github/workflows/conformance.yml');
  const node = shellVar(read(INSTALL), 'NODE_VERSION');
  const pins = [...ci.matchAll(/node-version:\s*['"]?([^'"\s]+)/g)].map((m) => m[1]);
  assert(pins.length > 0, 'the CI sets a node-version');
  for (const p of pins) eq(p, node, 'CI node-version = install.sh NODE_VERSION (one exact version everywhere)');
  for (const m of ci.matchAll(/uses:\s*actions\/([\w-]+)@v(\d+)/g)) assert(Number(m[2]) >= 5, `actions/${m[1]}@v${m[2]}: v5 or later`);
});

test('shell scripts are checked out with LF line endings, so bash runs them on a Windows-cloned tree too', () => {
  assert(/^\*\.sh\s+text\s+eol=lf/m.test(read('.gitattributes')), '.gitattributes: *.sh text eol=lf');
});

test('no secret in the package: no S… seed, no private key block', () => {
  for (const f of PACKAGE) {
    const s = read(f);
    assert(!/\bS[A-Z2-7]{55}\b/.test(s), `${f}: no secret seed`);
    assert(!/BEGIN [A-Z ]*PRIVATE KEY/.test(s), `${f}: no private key`);
  }
});

(async () => {
  console.log('\nhost package (W2-5)');
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + e.message); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
