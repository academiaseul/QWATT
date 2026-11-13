//! Property-based tests (proptest, with shrinking), independent of the JS generator.
//! Random operation sequences against the contract; after every step:
//!   P1 the contract's balance of both assets is 0 (zero outstanding);
//!   P2 retired_wh ≤ accrued_wh = floor(cumulative_mwh / 1000) for every site;
//!   P3 next_seq, cumulative_mwh, retired_wh and retirements never decrease;
//!   P4 a refused step changes nothing (all site views and the pause flag are identical);
//!   P5 an accepted retirement starts exactly at the previous retired_wh and moves it to end;
//!   P6 a statement hash is accepted at most once, across all sites;
//!   P7 an accepted accrual had both relay keys among its signers.
//! PROPTEST_CASES raises the number of sequences (default here: 128).

mod common;

use common::Harness;
use proptest::prelude::*;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const ACTORS: [&str; 8] = ["governance", "proposer", "verifier", "alice", "bob", "mallory", "relay2a", "relay2b"];
const SITES: [(&str, &str, u32); 3] = [("a", "alice", 1), ("b", "bob", 0), ("c", "alice", 1)];

#[derive(Debug, Clone)]
enum Op {
    Register { site: usize, class_ok: bool, next_seq: u64, auth: usize },
    Accrue { site: usize, seq_delta: i8, add_mwh: u64, regress: bool, level: u32, auth: usize },
    Retire { site: usize, start_delta: i8, len: u64, over: bool, stmt: u8, auth: usize },
    Freeze { site: usize, frozen: bool, auth: usize },
    Pause { paused: bool, auth: usize },
    Relay { pair: usize, auth: usize },
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        1 => (0..3usize, prop::bool::weighted(0.95), 0..3u64, 0..10usize).prop_map(|(site, class_ok, next_seq, auth)| Op::Register { site, class_ok, next_seq, auth }),
        6 => (0..3usize, prop_oneof![8 => Just(0i8), 1 => -2..0i8, 1 => 1..3i8], 0..3_000_000u64, prop::bool::weighted(0.05), 0..4u32, 0..12usize)
            .prop_map(|(site, seq_delta, add_mwh, regress, level, auth)| Op::Accrue { site, seq_delta, add_mwh, regress, level, auth }),
        4 => (0..3usize, prop_oneof![6 => Just(0i8), 3 => Just(-1i8), 1 => -3..-1i8, 1 => 1..3i8], 1..4_000u64, prop::bool::weighted(0.1), 0..40u8, 0..10usize)
            .prop_map(|(site, start_delta, len, over, stmt, auth)| Op::Retire { site, start_delta, len, over, stmt, auth }),
        1 => (0..3usize, any::<bool>(), 0..10usize).prop_map(|(site, frozen, auth)| Op::Freeze { site, frozen, auth }),
        1 => (prop::bool::weighted(0.4), 0..10usize).prop_map(|(paused, auth)| Op::Pause { paused, auth }),
        1 => (0..3usize, 0..10usize).prop_map(|(pair, auth)| Op::Relay { pair, auth }),
    ]
}

fn view(h: &Harness) -> (bool, BTreeMap<&'static str, Value>) {
    let mut m = BTreeMap::new();
    for (n, _, _) in SITES {
        m.insert(n, h.site_view(n));
    }
    (h.client().paused(), m)
}

fn num(v: &Value, k: &str) -> u128 {
    v[k].as_str().map(|s| s.parse().unwrap()).unwrap_or(0)
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: std::env::var("PROPTEST_CASES").ok().and_then(|s| s.parse().ok()).unwrap_or(128),
        max_shrink_iters: 2000,
        .. ProptestConfig::default()
    })]

    #[test]
    fn invariants_hold_for_random_sequences(ops in prop::collection::vec(op(), 1..40)) {
        let h = Harness::new(&ACTORS, ("governance", "proposer", "verifier"));
        let mut relay = ("proposer", "verifier");
        let mut accepted_statements: BTreeSet<String> = BTreeSet::new();
        for (i, o) in ops.iter().enumerate() {
            let before = view(&h);
            let (op_name, args, auth): (&str, Value, Vec<String>) = match o {
                Op::Register { site, class_ok, next_seq, auth } => {
                    let (n, r, c) = SITES[*site];
                    ("register_site", json!({"site": n, "responsible": r, "class": if *class_ok { c } else { 2 }, "next_seq": next_seq.to_string()}),
                     if *auth < 9 { vec!["governance".into()] } else { vec!["alice".into()] })
                }
                Op::Accrue { site, seq_delta, add_mwh, regress, level, auth } => {
                    let (n, _, c) = SITES[*site];
                    let s = &before.1[n];
                    let next = num(s, "next_seq") as i128 + *seq_delta as i128;
                    let cur = num(s, "cumulative_mwh");
                    let cum = if *regress && cur > 0 { cur - 1 } else { cur + *add_mwh as u128 };
                    let lvl = match *level { 3 => 3, 0 if c == 1 => 0, _ if c == 0 => 0, l => l.max(1) };
                    let keys = match *auth { 0 => vec![relay.0.to_string()], 1 => vec![relay.1.to_string()], 2 => vec!["mallory".into()],
                                              3 => vec!["relay2a".into(), "relay2b".into()], _ => vec![relay.0.to_string(), relay.1.to_string()] };
                    ("accrue", json!({"site": n, "seq": next.max(0).to_string(), "cumulative_mwh": cum.to_string(), "batch": format!("p{i}"), "level": lvl}), keys)
                }
                Op::Retire { site, start_delta, len, over, stmt, auth } => {
                    let (n, r, _) = SITES[*site];
                    let s = &before.1[n];
                    let start = (num(s, "retired_wh") as i128 + *start_delta as i128).max(0) as u128;
                    let acc = num(s, "accrued_wh");
                    let end = if *over { acc + 1 } else { start + (*len as u128).min(acc.saturating_sub(start).max(1)) };
                    ("retire", json!({"site": n, "start_wh": start.to_string(), "end_wh": end.to_string(), "statement": format!("st{stmt}")}),
                     if *auth < 9 { vec![r.into()] } else { vec!["mallory".into()] })
                }
                Op::Freeze { site, frozen, auth } => ("set_frozen", json!({"site": SITES[*site].0, "frozen": frozen}),
                     if *auth < 9 { vec!["governance".into()] } else { vec!["mallory".into()] }),
                Op::Pause { paused, auth } => ("set_paused", json!({"paused": paused}),
                     if *auth < 9 { vec!["governance".into()] } else { vec!["proposer".into()] }),
                Op::Relay { pair, auth } => {
                    let (p, v) = [("proposer", "verifier"), ("relay2a", "relay2b"), ("relay2a", "relay2a")][*pair];
                    ("set_relay", json!({"proposer": p, "verifier": v}), if *auth < 9 { vec!["governance".into()] } else { vec!["verifier".into()] })
                }
            };
            let (result, _) = h.step(op_name, &args, &auth);
            prop_assert!(result == "ok" || (result.starts_with("err:") && !result.contains("HOST") && !result.contains("INVOKE")),
                "step {i} {op_name}: unexpected host failure {result}");
            let after = view(&h);

            // P1
            prop_assert_eq!(h.balances(), (0, 0), "P1 step {}", i);
            for (n, s) in &after.1 {
                if s.is_null() { continue; }
                // P2
                prop_assert!(num(s, "retired_wh") <= num(s, "accrued_wh"), "P2 step {} site {}", i, n);
                prop_assert_eq!(num(s, "accrued_wh"), num(s, "cumulative_mwh") / 1000, "P2 floor step {}", i);
                // P3
                let b = &before.1[n];
                if !b.is_null() {
                    for k in ["next_seq", "cumulative_mwh", "retired_wh", "retirements"] {
                        prop_assert!(num(s, k) >= num(b, k), "P3 {} decreased at step {} site {}", k, i, n);
                    }
                }
            }
            if result != "ok" {
                // P4
                prop_assert_eq!(&before, &after, "P4 refused step {} {} changed state", i, op_name);
            } else {
                match op_name {
                    "retire" => {
                        let n = args["site"].as_str().unwrap();
                        let start: u128 = args["start_wh"].as_str().unwrap().parse().unwrap();
                        let end: u128 = args["end_wh"].as_str().unwrap().parse().unwrap();
                        // P5
                        let key: &str = SITES.iter().find(|x| x.0 == n).unwrap().0;
                        prop_assert_eq!(num(&before.1[key], "retired_wh"), start, "P5 start step {}", i);
                        prop_assert_eq!(num(&after.1[key], "retired_wh"), end, "P5 end step {}", i);
                        // P6
                        prop_assert!(accepted_statements.insert(args["statement"].as_str().unwrap().to_string()), "P6 statement reused at step {}", i);
                    }
                    "accrue" => {
                        // P7
                        prop_assert!(auth.contains(&relay.0.to_string()) && auth.contains(&relay.1.to_string()), "P7 step {}", i);
                    }
                    "set_relay" => {
                        relay = if args["proposer"] == "relay2a" { ("relay2a", "relay2b") } else { ("proposer", "verifier") };
                    }
                    _ => {}
                }
            }
        }
    }
}
