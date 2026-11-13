//! Shared harness: runs fixture steps against the contract and writes the transcript in
//! exactly the format of `soroban/model/run-model.mjs`.
//!
//! Set QWATT_ISSUANCE_WASM=<path to .wasm> to run the compiled Wasm artifact instead of the
//! natively compiled contract.
#![allow(dead_code)]

use qwatt_issuance::{QwattIssuance, QwattIssuanceClient, Site};
use serde_json::{json, Map, Value};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token, xdr::ScErrorType, Address, Bytes, BytesN, Env, IntoVal, Symbol, TryFromVal, Val, Vec,
};
use std::collections::BTreeMap;

pub const TAG_SITE: &[u8] = b"QWATT/site/v1\x00";
pub const TAG_BATCH: &[u8] = b"QWATT/batch/v1\x00";
pub const TAG_STATEMENT: &[u8] = b"QWATT/statement/v1\x00";

pub const ERR_NAMES: [&str; 21] = [
    "", "Paused", "SiteNotFound", "SiteExists", "SiteFrozen", "InvalidClass", "InvalidLevel",
    "LevelMismatch", "SeqReplay", "SeqGap", "CumulativeRegression", "Overflow", "EmptyRange",
    "RangeOverlap", "RangeGap", "OverRetire", "DuplicateStatement", "AmountTooLarge",
    "SameRelayKey", "InvariantBroken", "SameAsset",
];

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub struct Harness {
    pub env: Env,
    pub cid: Address,
    pub live: Address,
    pub sim: Address,
    pub actors: BTreeMap<String, Address>,
    pub wasm: bool,
}

impl Harness {
    pub fn new(actor_names: &[&str], setup: (&str, &str, &str)) -> Self {
        let env = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig { capture_snapshot_at_drop: false });
        let mut actors = BTreeMap::new();
        for n in actor_names {
            actors.insert(n.to_string(), Address::generate(&env));
        }
        // SACs start with a temporary admin, handed to the contract below (as in the spike).
        let tmp_admin = Address::generate(&env);
        let live = env.register_stellar_asset_contract_v2(tmp_admin.clone()).address();
        let sim = env.register_stellar_asset_contract_v2(tmp_admin.clone()).address();
        let ctor = (
            actors[setup.0].clone(),
            actors[setup.1].clone(),
            actors[setup.2].clone(),
            live.clone(),
            sim.clone(),
        );
        let (cid, wasm) = match std::env::var("QWATT_ISSUANCE_WASM") {
            Ok(p) if !p.is_empty() => {
                let bytes = std::fs::read(&p).expect("read QWATT_ISSUANCE_WASM");
                (env.register(bytes.as_slice(), ctor), true)
            }
            _ => (env.register(QwattIssuance, ctor), false),
        };
        env.mock_all_auths();
        token::StellarAssetClient::new(&env, &live).set_admin(&cid);
        token::StellarAssetClient::new(&env, &sim).set_admin(&cid);
        env.set_auths(&[]);
        assert_eq!(token::StellarAssetClient::new(&env, &live).admin(), cid);
        Harness { env, cid, live, sim, actors, wasm }
    }

    pub fn tagged(&self, tag: &[u8], label: &str) -> BytesN<32> {
        let mut b = Bytes::from_slice(&self.env, tag);
        b.append(&Bytes::from_slice(&self.env, label.as_bytes()));
        self.env.crypto().sha256(&b).to_bytes()
    }

    fn actor(&self, name: &str) -> Address {
        self.actors.get(name).unwrap_or_else(|| panic!("unknown actor {name}")).clone()
    }

    fn actor_name(&self, a: &Address) -> String {
        self.actors.iter().find(|(_, v)| *v == a).map(|(k, _)| k.clone()).unwrap_or_else(|| "?".into())
    }

    /// Run one fixture step. Returns the transcript `result` and optional `value`.
    pub fn step(&self, op: &str, a: &Value, auth: &[String]) -> (String, Option<Value>) {
        let env = &self.env;
        let s = |k: &str| a[k].as_str().unwrap_or_else(|| panic!("missing string arg {k}"));
        let u = |k: &str| a[k].as_u64().unwrap_or_else(|| panic!("missing int arg {k}")) as u32;
        let args: Vec<Val> = match op {
            "register_site" => (
                self.tagged(TAG_SITE, s("site")),
                self.actor(s("responsible")),
                u("class"),
                s("next_seq").parse::<u64>().unwrap(),
            )
                .into_val(env),
            "accrue" => (
                self.tagged(TAG_SITE, s("site")),
                s("seq").parse::<u64>().unwrap(),
                s("cumulative_mwh").parse::<u128>().unwrap(),
                self.tagged(TAG_BATCH, s("batch")),
                u("level"),
            )
                .into_val(env),
            "retire" => (
                self.tagged(TAG_SITE, s("site")),
                s("start_wh").parse::<u128>().unwrap(),
                s("end_wh").parse::<u128>().unwrap(),
                self.tagged(TAG_STATEMENT, s("statement")),
            )
                .into_val(env),
            "set_frozen" => (self.tagged(TAG_SITE, s("site")), a["frozen"].as_bool().unwrap()).into_val(env),
            "set_paused" => (a["paused"].as_bool().unwrap(),).into_val(env),
            "set_relay" => (self.actor(s("proposer")), self.actor(s("verifier"))).into_val(env),
            other => panic!("unknown op {other}"),
        };

        // Exactly the listed actors authorize exactly this invocation; nobody else.
        let addrs: std::vec::Vec<Address> = auth.iter().map(|n| self.actor(n)).collect();
        let invoke = MockAuthInvoke { contract: &self.cid, fn_name: op, args: args.clone(), sub_invokes: &[] };
        let mocks: std::vec::Vec<MockAuth> = addrs.iter().map(|a| MockAuth { address: a, invoke: &invoke }).collect();
        env.mock_auths(&mocks);

        let before = env.host().get_diagnostic_events().map(|e| e.0.len()).unwrap_or(0);
        let r = env.try_invoke_contract::<Val, soroban_sdk::Error>(&self.cid, &Symbol::new(env, op), args);
        env.set_auths(&[]);
        // A failed require_auth reaches this frame as Error(Context, InvalidAction); label it
        // AUTH only if the host's diagnostics for this call carry the Auth error itself
        // (diagnostic `error` events with topic Error(Auth(InvalidAction))).
        let auth_failed = || {
            env.host().get_diagnostic_events().map(|e| {
                e.0[before.min(e.0.len())..].iter().any(|ev| {
                    let d = format!("{:?}", ev.event);
                    d.contains("type_: Diagnostic") && d.contains("Error(Auth(InvalidAction))")
                })
            }).unwrap_or(false)
        };
        match r {
            Ok(Ok(v)) => {
                let value = match op {
                    "accrue" => {
                        let rc = qwatt_issuance::AccrualReceipt::try_from_val(env, &v).unwrap();
                        Some(json!({ "accrued_wh": rc.accrued_wh.to_string(), "digest": hex(&rc.digest.to_array()) }))
                    }
                    "retire" => {
                        let c = BytesN::<32>::try_from_val(env, &v).unwrap();
                        Some(json!({ "commitment": hex(&c.to_array()) }))
                    }
                    _ => None,
                };
                ("ok".into(), value)
            }
            Ok(Err(e)) => panic!("{op}: return value conversion failed: {e:?}"),
            Err(Ok(e)) => {
                if e.is_type(ScErrorType::Contract) {
                    let code = e.get_code() as usize;
                    (format!("err:{}", ERR_NAMES.get(code).copied().unwrap_or("UNKNOWN")), None)
                } else if e.is_type(ScErrorType::Auth)
                    || (e.is_type(ScErrorType::Context) && auth_failed())
                {
                    ("err:AUTH".into(), None)
                } else {
                    (format!("err:HOST({e:?})"), None)
                }
            }
            Err(Err(e)) => (format!("err:INVOKE({e:?})"), None),
        }
    }

    pub fn client(&self) -> QwattIssuanceClient<'_> {
        QwattIssuanceClient::new(&self.env, &self.cid)
    }

    pub fn balances(&self) -> (i128, i128) {
        (
            token::TokenClient::new(&self.env, &self.live).balance(&self.cid),
            token::TokenClient::new(&self.env, &self.sim).balance(&self.cid),
        )
    }

    pub fn site_view(&self, name: &str) -> Value {
        match self.client().site(&self.tagged(TAG_SITE, name)) {
            None => Value::Null,
            Some(Site { responsible, class, frozen, next_seq, cumulative_mwh, accrued_wh, retired_wh, accrual_digest, retirements }) => {
                json!({
                    "responsible": self.actor_name(&responsible),
                    "class": class.to_string(),
                    "frozen": frozen,
                    "next_seq": next_seq.to_string(),
                    "cumulative_mwh": cumulative_mwh.to_string(),
                    "accrued_wh": accrued_wh.to_string(),
                    "retired_wh": retired_wh.to_string(),
                    "accrual_digest": hex(&accrual_digest.to_array()),
                    "retirements": retirements.to_string(),
                })
            }
        }
    }
}

/// Run every case of a fixture document. Returns (transcript lines, failures).
pub fn run_document(doc: &Value) -> (std::vec::Vec<String>, std::vec::Vec<String>) {
    let actors: std::vec::Vec<&str> = doc["actors"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    let setup = &doc["setup"];
    let setup = (
        setup["governance"].as_str().unwrap(),
        setup["proposer"].as_str().unwrap(),
        setup["verifier"].as_str().unwrap(),
    );
    let mut lines = vec![];
    let mut failures = vec![];
    for c in doc["cases"].as_array().unwrap() {
        let id = c["id"].as_str().unwrap();
        let h = Harness::new(&actors, setup);
        let mut names = std::collections::BTreeSet::new();
        for (i, st) in c["steps"].as_array().unwrap().iter().enumerate() {
            let op = st["op"].as_str().unwrap();
            if let Some(site) = st["args"].get("site").and_then(|v| v.as_str()) {
                names.insert(site.to_string());
            }
            let auth: std::vec::Vec<String> = st["auth"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
            let (result, value) = h.step(op, &st["args"], &auth);
            let mut line = Map::new();
            line.insert("case".into(), json!(id));
            line.insert("step".into(), json!(i));
            line.insert("op".into(), json!(op));
            line.insert("result".into(), json!(result));
            if let Some(v) = &value {
                line.insert("value".into(), v.clone());
            }
            lines.push(Value::Object(line).to_string());

            if let Some(exp) = st.get("expect") {
                let want = if exp == "ok" { "ok".to_string() } else { format!("err:{}", exp["err"].as_str().unwrap()) };
                if want != result {
                    failures.push(format!("{id} step {i} {op}: expected {want}, got {result}"));
                }
            }
            if let (Some(ev), Some(v)) = (st.get("expect_value"), &value) {
                for (k, want) in ev.as_object().unwrap() {
                    if &v[k] != want {
                        failures.push(format!("{id} step {i}: {k} expected {want}, got {}", v[k]));
                    }
                }
            }
            // invariants after every step
            let (bl, bs) = h.balances();
            if bl != 0 || bs != 0 {
                failures.push(format!("{id} step {i}: contract balances {bl}/{bs} ≠ 0"));
            }
            for n in &names {
                if let Some(s) = h.client().site(&h.tagged(TAG_SITE, n)) {
                    if s.retired_wh > s.accrued_wh || s.accrued_wh != s.cumulative_mwh / 1000 {
                        failures.push(format!("{id} step {i}: site {n} invariant broken"));
                    }
                }
            }
        }
        let (bl, bs) = h.balances();
        let mut sites = Map::new();
        for n in &names {
            sites.insert(n.clone(), h.site_view(n));
        }
        let final_line = json!({
            "case": id,
            "final": { "paused": h.client().paused(), "balance_live": bl.to_string(), "balance_sim": bs.to_string(), "sites": Value::Object(sites.clone()) }
        });
        lines.push(final_line.to_string());
        if let Some(fin) = c.get("final") {
            for (n, want) in fin.as_object().unwrap() {
                for (k, v) in want.as_object().unwrap() {
                    let got = sites.get(n).map(|s| s[k].clone()).unwrap_or(Value::Null);
                    if &got != v {
                        failures.push(format!("{id} final {n}.{k}: expected {v}, got {got}"));
                    }
                }
            }
        }
    }
    (lines, failures)
}
