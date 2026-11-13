//! Unit tests that fixtures can't express: constructor refusals, known-answer hashes,
//! SAC-level authorization, events, the non-zero-balance guard, and cost estimates.

mod common;

use common::{hex, Harness, TAG_BATCH, TAG_SITE, TAG_STATEMENT};
use qwatt_issuance::{accrual_digest, retire_commitment, QwattIssuance};
use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig, Events as _, MockAuth, MockAuthInvoke},
    token, xdr, Address, BytesN, Env, IntoVal,
};

const ACTORS: [&str; 6] = ["governance", "proposer", "verifier", "alice", "bob", "mallory"];
const SETUP: (&str, &str, &str) = ("governance", "proposer", "verifier");

fn env() -> Env {
    Env::new_with_config(EnvTestConfig { capture_snapshot_at_drop: false })
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn constructor_refuses_one_key_for_both_relay_roles() {
    let env = env();
    let k = Address::generate(&env);
    let g = Address::generate(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    env.register(QwattIssuance, (g, k.clone(), k, a, b));
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")]
fn constructor_refuses_the_same_asset_for_live_and_simulated() {
    let env = env();
    let (g, p, v, a) = (Address::generate(&env), Address::generate(&env), Address::generate(&env), Address::generate(&env));
    env.register(QwattIssuance, (g, p, v, a.clone(), a));
}

/// Same inputs, same bytes as the BigInt model (values computed with model/model.mjs).
#[test]
fn known_answer_hashes_match_the_model() {
    let h = Harness::new(&ACTORS, SETUP);
    let env = &h.env;
    let site = h.tagged(TAG_SITE, "kat-site");
    assert_eq!(hex(&site.to_array()), "edb1ad47941a9a593d67933b25b5cbed6ef80cad7d4e4073a569960ecf481fad");
    let batch = h.tagged(TAG_BATCH, "kat-batch");
    let st = h.tagged(TAG_STATEMENT, "kat statement");
    let zero = BytesN::from_array(env, &[0u8; 32]);
    let d = accrual_digest(env, &zero, &site, 7, 412_000_999, 2, &batch);
    assert_eq!(hex(&d.to_array()), "ec63fc53d5a74cb8344a75db26718b59f4d3ba3d5f412d5a886dfefdc21bb86b");
    let c = retire_commitment(env, &site, 1, 0, 412_000, &st);
    assert_eq!(hex(&c.to_array()), "4d4490c1d1c7de1cd19c029cb71719301c027fa40e5b578c180a22d266e198cc");
    // domain separation: the same fields under the other class give a different commitment
    let c0 = retire_commitment(env, &site, 0, 0, 412_000, &st);
    assert_ne!(c, c0);
}

fn setup_live_site(h: &Harness, wh: u128) {
    let ok = |op: &str, args: serde_json::Value, auth: &[&str]| {
        let auth: Vec<String> = auth.iter().map(|s| s.to_string()).collect();
        let (r, _) = h.step(op, &args, &auth);
        assert_eq!(r, "ok", "{op}");
    };
    ok("register_site", serde_json::json!({"site":"roof","responsible":"alice","class":1,"next_seq":"0"}), &["governance"]);
    ok("accrue", serde_json::json!({"site":"roof","seq":"0","cumulative_mwh":(wh*1000).to_string(),"batch":"b0","level":2}), &["proposer","verifier"]);
}

/// The spike's on-network transfer refusal failed on balance (the contract holds nothing).
/// Here the contract is given a balance, so the authorization path itself is exercised.
#[test]
fn sac_transfer_out_of_the_contract_needs_the_contracts_own_auth() {
    let h = Harness::new(&ACTORS, SETUP);
    let env = &h.env;
    env.mock_all_auths();
    token::StellarAssetClient::new(env, &h.live).mint(&h.cid, &100);
    env.set_auths(&[]);
    let mallory = h.actors["mallory"].clone();
    let args = (h.cid.clone(), mallory.clone(), 1i128).into_val(env);
    env.mock_auths(&[MockAuth {
        address: &mallory,
        invoke: &MockAuthInvoke { contract: &h.live, fn_name: "transfer", args, sub_invokes: &[] },
    }]);
    let r = token::TokenClient::new(env, &h.live).try_transfer(&h.cid, &mallory, &1);
    assert!(r.is_err(), "transfer out of the contract without its auth must fail");
    env.set_auths(&[]);
    assert_eq!(token::TokenClient::new(env, &h.live).balance(&h.cid), 100);
}

/// If the contract ever held a balance, retire() refuses instead of hiding it.
#[test]
fn retire_refuses_when_the_contract_holds_a_balance() {
    let h = Harness::new(&ACTORS, SETUP);
    setup_live_site(&h, 100);
    h.env.mock_all_auths();
    token::StellarAssetClient::new(&h.env, &h.live).mint(&h.cid, &1);
    h.env.set_auths(&[]);
    let (r, _) = h.step("retire", &serde_json::json!({"site":"roof","start_wh":"0","end_wh":"100","statement":"s"}), &["alice".into()]);
    assert_eq!(r, "err:InvariantBroken");
}

fn i128_of(v: &xdr::ScVal) -> Option<i128> {
    match v {
        xdr::ScVal::I128(p) => Some(((p.hi as i128) << 64) | p.lo as i128),
        xdr::ScVal::Map(Some(m)) => m.iter().find_map(|e| match &e.key {
            xdr::ScVal::Symbol(s) if s.to_string() == "amount" => i128_of(&e.val),
            _ => None,
        }),
        _ => None,
    }
}

#[test]
fn retire_emits_one_mint_and_one_burn_of_the_same_amount() {
    let h = Harness::new(&ACTORS, SETUP);
    setup_live_site(&h, 412_000);
    let (r, _) = h.step("retire", &serde_json::json!({"site":"roof","start_wh":"0","end_wh":"412000","statement":"s"}), &["alice".into()]);
    assert_eq!(r, "ok");
    let all = h.env.events().all();
    let sac = all.filter_by_contract(&h.live);
    let (mut mint, mut burn, mut other) = (0i128, 0i128, 0);
    for e in sac.events() {
        let xdr::ContractEventBody::V0(b) = &e.body;
        let name = match b.topics.first() { Some(xdr::ScVal::Symbol(s)) => s.to_string(), _ => String::new() };
        let amt = i128_of(&b.data).unwrap_or(0);
        match name.as_str() { "mint" => mint += amt, "burn" => burn += amt, _ => other += 1 }
    }
    assert_eq!((mint, burn, other), (4_120_000, 4_120_000, 0), "0.412 QWATT minted and burned, nothing else");
    assert_eq!(all.filter_by_contract(&h.cid).events().len(), 1, "one Retired event");
    assert_eq!(h.balances(), (0, 0));
}

/// In-process cost estimate on the compiled Wasm. The fee uses the SDK's hard-coded
/// mainnet fee snapshot, so it is an estimate; the local-network spike records the
/// real charged fees.
#[test]
fn cost_estimate_on_wasm() {
    let Ok(path) = std::env::var("QWATT_ISSUANCE_WASM") else {
        eprintln!("skipping: set QWATT_ISSUANCE_WASM to the built .wasm");
        return;
    };
    assert!(!path.is_empty());
    let h = Harness::new(&ACTORS, SETUP);
    assert!(h.wasm);
    let mut out = serde_json::Map::new();
    let mut measure = |label: &str, op: &str, args: serde_json::Value, auth: &[&str]| {
        let auth: Vec<String> = auth.iter().map(|s| s.to_string()).collect();
        let (r, _) = h.step(op, &args, &auth);
        assert_eq!(r, "ok", "{label}");
        let res = h.env.cost_estimate().resources();
        let fee = h.env.cost_estimate().fee();
        out.insert(label.into(), serde_json::json!({
            "instructions": res.instructions, "mem_bytes": res.mem_bytes,
            "disk_read_entries": res.disk_read_entries, "write_entries": res.write_entries,
            "write_bytes": res.write_bytes, "contract_events_size_bytes": res.contract_events_size_bytes,
            "fee_estimate_total_stroops": fee.total,
            "fee_estimate_breakdown": {
                "instructions": fee.instructions, "disk_read_entries": fee.disk_read_entries,
                "write_entries": fee.write_entries, "disk_read_bytes": fee.disk_read_bytes,
                "write_bytes": fee.write_bytes, "contract_events": fee.contract_events,
                "persistent_entry_rent": fee.persistent_entry_rent, "temporary_entry_rent": fee.temporary_entry_rent,
            },
        }));
    };
    measure("register_site", "register_site", serde_json::json!({"site":"roof","responsible":"alice","class":1,"next_seq":"0"}), &["governance"]);
    measure("accrue (first)", "accrue", serde_json::json!({"site":"roof","seq":"0","cumulative_mwh":"412000999","batch":"b0","level":2}), &["proposer","verifier"]);
    measure("accrue (next)", "accrue", serde_json::json!({"site":"roof","seq":"1","cumulative_mwh":"500000000","batch":"b1","level":2}), &["proposer","verifier"]);
    measure("retire 412,000 Wh", "retire", serde_json::json!({"site":"roof","start_wh":"0","end_wh":"412000","statement":"s"}), &["alice"]);
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/conformance");
    std::fs::create_dir_all(&dir).unwrap();
    let doc = serde_json::json!({ "note": "soroban-sdk testutils cost_estimate on the compiled Wasm; fee uses the SDK's mainnet fee snapshot (2026-07-10), an estimate", "invocations": out });
    std::fs::write(dir.join("cost-estimate.json"), serde_json::to_string_pretty(&doc).unwrap()).unwrap();
    eprintln!("{}", serde_json::to_string_pretty(&doc).unwrap());
}
