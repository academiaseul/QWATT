#!/usr/bin/env python3
"""Mutation check: plant one known bug at a time in lib.rs and require the suites to fail.

Each line of scripts/mutants.txt is `name|original|replacement` (\\n for newlines).
For each mutant: hand-written cases, proptest, and the random-sequence differential
(model transcript vs contract transcript). The source is always restored.
Run from soroban/ after ./run-all.sh (needs target/conformance/model-random.jsonl).
Usage: python3 scripts/mutation-test.py [name,name,...]
"""
import subprocess, sys, pathlib

F = pathlib.Path('contracts/qwatt-issuance/src/lib.rs')
orig = F.read_text()
only = set(sys.argv[1].split(',')) if len(sys.argv) > 1 else None
run = lambda cmd: subprocess.run(cmd, capture_output=True, text=True, timeout=1800).returncode
missed = 0
try:
    for line in pathlib.Path('scripts/mutants.txt').read_text().splitlines():
        name, a, b = line.split('|')
        if only and name not in only:
            continue
        a, b = a.replace('\\n', '\n'), b.replace('\\n', '\n')
        assert orig.count(a) == 1, f'{name}: anchor not found exactly once'
        F.write_text(orig.replace(a, b))
        c = run(['cargo', 'test', '--release', '--test', 'conformance', 'issuance_cases'])
        p = run(['cargo', 'test', '--release', '--test', 'props'])
        run(['cargo', 'test', '--release', '--test', 'conformance', 'random_sequences'])
        d = run(['node', 'fixtures/compare-transcripts.mjs', 'target/conformance/model-random.jsonl',
                 'target/conformance/rust-native-random-sequences.jsonl'])
        f = lambda r: 'CAUGHT' if r else 'missed'
        if not (c or d):
            missed += 1
        print(f'{name:22} cases={f(c):7} props={f(p):7} differential={f(d)}', flush=True)
finally:
    F.write_text(orig)
sys.exit(1 if missed else 0)
