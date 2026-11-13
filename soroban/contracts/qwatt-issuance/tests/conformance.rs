//! Conformance: the contract against fixtures/issuance-cases.json (hand-written
//! expectations) and fixtures/random-sequences.json (generated, transcript-only).
//! Transcripts go to soroban/target/conformance/rust-<native|wasm>-<name>.jsonl and are
//! compared byte for byte with the BigInt model's (fixtures/compare-transcripts.mjs).

mod common;

use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn run(name: &str, required: bool) {
    let path = root().join("fixtures").join(format!("{name}.json"));
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) if !required => {
            eprintln!("skipping {name}: {} not found", path.display());
            return;
        }
        Err(e) => panic!("{}: {e}", path.display()),
    };
    let doc: serde_json::Value = serde_json::from_str(&text).unwrap();
    let wasm = std::env::var("QWATT_ISSUANCE_WASM").map(|p| !p.is_empty()).unwrap_or(false);
    let (lines, failures) = common::run_document(&doc);
    let out = root().join("target/conformance").join(format!("rust-{}-{name}.jsonl", if wasm { "wasm" } else { "native" }));
    std::fs::create_dir_all(out.parent().unwrap()).unwrap();
    std::fs::write(&out, lines.join("\n") + "\n").unwrap();
    let cases = doc["cases"].as_array().unwrap().len();
    assert!(failures.is_empty(), "{} failure(s):\n  {}", failures.len(), failures.join("\n  "));
    eprintln!("{name}: {cases} cases pass ({}) → {}", if wasm { "wasm" } else { "native" }, out.display());
}

#[test]
fn issuance_cases() {
    run("issuance-cases", true);
}

#[test]
fn random_sequences() {
    run("random-sequences", false);
}
