#!/usr/bin/env bash
# Every check of the qwatt-issuance prototype, in order. Local only.
#   ./run-all.sh            build, interface, model, conformance (native + wasm), random
#                           differential, properties, unit tests
#   ./run-all.sh --network  also the local-network spike (needs Docker)
# Requires: rust (wasm32v1-none target), stellar-cli >= 25.2 (`stellar` or $STELLAR), node >= 20.
set -euo pipefail
cd "$(dirname "$0")"
STELLAR="${STELLAR:-stellar}"
WASM="$PWD/target/wasm32v1-none/release/qwatt_issuance.wasm"
step() { printf '\n== %s\n' "$*"; }

step "build (stellar contract build)";        "$STELLAR" contract build
step "wasm sha256";                           sha256sum "$WASM"
step "interface check";                       node scripts/check-interface.mjs "$WASM"
step "cases file is current";                 node fixtures/build-cases.mjs --check
step "model: hand-written cases";             node model/run-model.mjs fixtures/issuance-cases.json target/conformance/model.jsonl
step "contract (native): hand-written cases"; cargo test --release --test conformance issuance_cases
step "contract (wasm): hand-written cases";   QWATT_ISSUANCE_WASM="$WASM" cargo test --release --test conformance issuance_cases
step "model == native";                       node fixtures/compare-transcripts.mjs target/conformance/model.jsonl target/conformance/rust-native-issuance-cases.jsonl
step "model == wasm";                         node fixtures/compare-transcripts.mjs target/conformance/model.jsonl target/conformance/rust-wasm-issuance-cases.jsonl
step "random sequences (1,000, seeded)";      node fixtures/gen-random.mjs --check-lock
step "model: random sequences";               node model/run-model.mjs fixtures/random-sequences.json target/conformance/model-random.jsonl
step "contract (native): random sequences";   cargo test --release --test conformance random_sequences
step "model == native (random)";              node fixtures/compare-transcripts.mjs target/conformance/model-random.jsonl target/conformance/rust-native-random-sequences.jsonl
step "property tests (proptest)";             cargo test --release --test props
step "unit tests (incl. cost estimate on wasm)"; QWATT_ISSUANCE_WASM="$WASM" cargo test --release --test unit
if [[ "${1:-}" == "--network" ]]; then
  step "local network";                       scripts/local-network.sh
  step "local-network spike";                 (cd scripts && npm ci --no-audit --no-fund && NO_PROXY=localhost,127.0.0.1 node local-spike.mjs)
fi
printf '\nALL CHECKS PASSED\n'
