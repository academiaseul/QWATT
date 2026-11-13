//! qwatt-issuance: QWATT issuance prototype. Stellar testnet / local network only.
//!
//! One rule: a measured watt-hour range is claimed once. Units exist only inside
//! `retire`: the contract mints exactly the stated range to itself and burns it in the
//! same call, so the outstanding supply is zero before and after every invocation.
//! Nothing here is a payment, a price, a certificate or a credit: a retirement records
//! a statement hash next to the range it consumed, and nothing more.
//!
//! Accounting is in integers only:
//! * accrual input is the anchored `cumulative_mwh` (milli-watt-hours, accepted
//!   batches only, as published by the Instaward #1 pipeline);
//! * verified energy is `floor(cumulative_mwh / 1000)` whole Wh: floored, never rounded;
//! * 1 QWATT = 1 MWh and Stellar assets have 7 decimals, so 1 Wh = 10 stroops.
//!
//! The function order of every check is part of the specification: the BigInt
//! reference model (`soroban/model/model.mjs`) applies the same checks in the same
//! order and must return the same result code for every conformance case.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Bytes, BytesN, Env,
};

/// Stroops (10^-7 of a unit) per watt-hour, with 1 unit = 1 MWh = 10^6 Wh.
pub const STROOPS_PER_WH: u128 = 10;
/// Milli-watt-hours per watt-hour.
pub const MWH_PER_WH: u128 = 1_000;
/// Largest amount minted and burned in one retirement: the classic asset limit.
pub const MAX_STROOPS: u128 = i64::MAX as u128;

/// Data classes. A site is one or the other for life.
pub const CLASS_SIMULATED: u32 = 0; // QWA0SIM
pub const CLASS_LIVE: u32 = 1; // QWATT

/// Evidence levels carried by each accrual (Instaward #1 assurance levels).
pub const LEVEL_A0: u32 = 0; // simulated input
pub const LEVEL_A1: u32 = 1; // one meter
pub const LEVEL_A2: u32 = 2; // two meters, min(A,B)

/// Domain-separation tags. Every hash the contract computes starts with one of these.
pub const TAG_ACCRUE: &[u8] = b"QWATT/issuance/v1/accrue\x00";
pub const TAG_RETIRE: &[u8] = b"QWATT/issuance/v1/retire\x00";

const DAY_LEDGERS: u32 = 17_280;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Paused = 1,
    SiteNotFound = 2,
    SiteExists = 3,
    SiteFrozen = 4,
    InvalidClass = 5,
    InvalidLevel = 6,
    LevelMismatch = 7,
    SeqReplay = 8,
    SeqGap = 9,
    CumulativeRegression = 10,
    Overflow = 11,
    EmptyRange = 12,
    RangeOverlap = 13,
    RangeGap = 14,
    OverRetire = 15,
    DuplicateStatement = 16,
    AmountTooLarge = 17,
    SameRelayKey = 18,
    InvariantBroken = 19,
    SameAsset = 20,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    /// Registers, freezes and pauses. In the SOW design: a classic 2-of-3 account.
    pub governance: Address,
    /// The two relay keys: every accrual needs both (two-key relay, SOW D2).
    pub proposer: Address,
    pub verifier: Address,
    /// Stellar Asset Contracts whose admin is this contract.
    pub live_asset: Address,
    pub sim_asset: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Site {
    pub responsible: Address,
    pub class: u32,
    pub frozen: bool,
    /// The only sequence number the next accrual may carry.
    pub next_seq: u64,
    pub cumulative_mwh: u128,
    /// floor(cumulative_mwh / 1000).
    pub accrued_wh: u128,
    /// Retired ranges are contiguous from 0: [0, retired_wh) is consumed.
    pub retired_wh: u128,
    /// Hash chain over every accrual of this site (32 zero bytes before the first).
    pub accrual_digest: BytesN<32>,
    pub retirements: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatementRecord {
    pub site_id: BytesN<32>,
    pub class: u32,
    pub start_wh: u128,
    pub end_wh: u128,
    pub commitment: BytesN<32>,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccrualReceipt {
    pub accrued_wh: u128,
    pub digest: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    Paused,
    Site(BytesN<32>),
    Statement(BytesN<32>),
}

#[contractevent(topics = ["accrued"])]
pub struct Accrued {
    #[topic]
    pub site_id: BytesN<32>,
    pub seq: u64,
    pub cumulative_mwh: u128,
    pub accrued_wh: u128,
    pub level: u32,
    pub batch_hash: BytesN<32>,
    pub digest: BytesN<32>,
}

#[contractevent(topics = ["retired"])]
pub struct Retired {
    #[topic]
    pub site_id: BytesN<32>,
    #[topic]
    pub statement_hash: BytesN<32>,
    pub class: u32,
    pub start_wh: u128,
    pub end_wh: u128,
    pub commitment: BytesN<32>,
}

#[contract]
pub struct QwattIssuance;

fn bump_instance(env: &Env) {
    let to = core::cmp::min(env.storage().max_ttl(), 30 * DAY_LEDGERS);
    env.storage().instance().extend_ttl(to - DAY_LEDGERS, to);
}

fn bump_persistent(env: &Env, key: &DataKey) {
    let to = core::cmp::min(env.storage().max_ttl(), 30 * DAY_LEDGERS);
    env.storage().persistent().extend_ttl(key, to - DAY_LEDGERS, to);
}

fn config(env: &Env) -> Config {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

fn ensure_not_paused(env: &Env) -> Result<(), Error> {
    if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
        return Err(Error::Paused);
    }
    Ok(())
}

fn load_site(env: &Env, site_id: &BytesN<32>) -> Result<Site, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Site(site_id.clone()))
        .ok_or(Error::SiteNotFound)
}

fn save_site(env: &Env, site_id: &BytesN<32>, site: &Site) {
    let key = DataKey::Site(site_id.clone());
    env.storage().persistent().set(&key, site);
    bump_persistent(env, &key);
}

/// Accrual hash chain:
/// sha256(TAG_ACCRUE ‖ prev_digest ‖ site_id ‖ seq:u64be ‖ cumulative_mwh:u128be ‖ level:u32be ‖ batch_hash)
pub fn accrual_digest(
    env: &Env,
    prev: &BytesN<32>,
    site_id: &BytesN<32>,
    seq: u64,
    cumulative_mwh: u128,
    level: u32,
    batch_hash: &BytesN<32>,
) -> BytesN<32> {
    let mut b = Bytes::from_slice(env, TAG_ACCRUE);
    b.append(&prev.clone().into());
    b.append(&site_id.clone().into());
    b.extend_from_array(&seq.to_be_bytes());
    b.extend_from_array(&cumulative_mwh.to_be_bytes());
    b.extend_from_array(&level.to_be_bytes());
    b.append(&batch_hash.clone().into());
    env.crypto().sha256(&b).to_bytes()
}

/// Retirement commitment:
/// sha256(TAG_RETIRE ‖ site_id ‖ class:u32be ‖ start_wh:u128be ‖ end_wh:u128be ‖ statement_hash)
pub fn retire_commitment(
    env: &Env,
    site_id: &BytesN<32>,
    class: u32,
    start_wh: u128,
    end_wh: u128,
    statement_hash: &BytesN<32>,
) -> BytesN<32> {
    let mut b = Bytes::from_slice(env, TAG_RETIRE);
    b.append(&site_id.clone().into());
    b.extend_from_array(&class.to_be_bytes());
    b.extend_from_array(&start_wh.to_be_bytes());
    b.extend_from_array(&end_wh.to_be_bytes());
    b.append(&statement_hash.clone().into());
    env.crypto().sha256(&b).to_bytes()
}

#[contractimpl]
impl QwattIssuance {
    pub fn __constructor(
        env: Env,
        governance: Address,
        proposer: Address,
        verifier: Address,
        live_asset: Address,
        sim_asset: Address,
    ) {
        if proposer == verifier {
            panic_with_error!(&env, Error::SameRelayKey);
        }
        if live_asset == sim_asset {
            panic_with_error!(&env, Error::SameAsset);
        }
        let cfg = Config { governance, proposer, verifier, live_asset, sim_asset };
        env.storage().instance().set(&DataKey::Config, &cfg);
        env.storage().instance().set(&DataKey::Paused, &false);
        bump_instance(&env);
    }

    // ----- governance -------------------------------------------------------------

    /// Order: auth(governance) → paused → class → exists.
    pub fn register_site(
        env: Env,
        site_id: BytesN<32>,
        responsible: Address,
        class: u32,
        next_seq: u64,
    ) -> Result<(), Error> {
        config(&env).governance.require_auth();
        ensure_not_paused(&env)?;
        if class != CLASS_SIMULATED && class != CLASS_LIVE {
            return Err(Error::InvalidClass);
        }
        if env.storage().persistent().has(&DataKey::Site(site_id.clone())) {
            return Err(Error::SiteExists);
        }
        let site = Site {
            responsible,
            class,
            frozen: false,
            next_seq,
            cumulative_mwh: 0,
            accrued_wh: 0,
            retired_wh: 0,
            accrual_digest: BytesN::from_array(&env, &[0u8; 32]),
            retirements: 0,
        };
        save_site(&env, &site_id, &site);
        bump_instance(&env);
        Ok(())
    }

    /// Order: auth(governance) → exists. Allowed while paused (an emergency control).
    pub fn set_frozen(env: Env, site_id: BytesN<32>, frozen: bool) -> Result<(), Error> {
        config(&env).governance.require_auth();
        let mut site = load_site(&env, &site_id)?;
        site.frozen = frozen;
        save_site(&env, &site_id, &site);
        Ok(())
    }

    pub fn set_paused(env: Env, paused: bool) {
        config(&env).governance.require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
        bump_instance(&env);
    }

    /// Order: auth(governance) → paused → distinct keys.
    pub fn set_relay(env: Env, proposer: Address, verifier: Address) -> Result<(), Error> {
        let mut cfg = config(&env);
        cfg.governance.require_auth();
        ensure_not_paused(&env)?;
        if proposer == verifier {
            return Err(Error::SameRelayKey);
        }
        cfg.proposer = proposer;
        cfg.verifier = verifier;
        env.storage().instance().set(&DataKey::Config, &cfg);
        bump_instance(&env);
        Ok(())
    }

    // ----- accrual: two-key relay -------------------------------------------------

    /// Order: auth(proposer) → auth(verifier) → paused → site → frozen → level → class
    /// → seq (replay, gap) → cumulative regression → seq overflow.
    pub fn accrue(
        env: Env,
        site_id: BytesN<32>,
        seq: u64,
        cumulative_mwh: u128,
        batch_hash: BytesN<32>,
        level: u32,
    ) -> Result<AccrualReceipt, Error> {
        let cfg = config(&env);
        cfg.proposer.require_auth();
        cfg.verifier.require_auth();
        ensure_not_paused(&env)?;
        let mut site = load_site(&env, &site_id)?;
        if site.frozen {
            return Err(Error::SiteFrozen);
        }
        if level > LEVEL_A2 {
            return Err(Error::InvalidLevel);
        }
        let level_is_sim = level == LEVEL_A0;
        if level_is_sim != (site.class == CLASS_SIMULATED) {
            return Err(Error::LevelMismatch);
        }
        if seq < site.next_seq {
            return Err(Error::SeqReplay);
        }
        if seq > site.next_seq {
            return Err(Error::SeqGap);
        }
        if cumulative_mwh < site.cumulative_mwh {
            return Err(Error::CumulativeRegression);
        }
        let next_seq = seq.checked_add(1).ok_or(Error::Overflow)?;
        let accrued_wh = cumulative_mwh / MWH_PER_WH; // floor, never round
        let digest = accrual_digest(
            &env,
            &site.accrual_digest,
            &site_id,
            seq,
            cumulative_mwh,
            level,
            &batch_hash,
        );
        site.next_seq = next_seq;
        site.cumulative_mwh = cumulative_mwh;
        site.accrued_wh = accrued_wh;
        site.accrual_digest = digest.clone();
        save_site(&env, &site_id, &site);
        bump_instance(&env);
        Accrued {
            site_id,
            seq,
            cumulative_mwh,
            accrued_wh,
            level,
            batch_hash,
            digest: digest.clone(),
        }
        .publish(&env);
        Ok(AccrualReceipt { accrued_wh, digest })
    }

    // ----- retirement -------------------------------------------------------------

    /// Order: paused → site → auth(responsible) → frozen → empty → overlap → gap
    /// → over-retire → duplicate statement → amount overflow → amount limit.
    /// Effects: record, mint(range) to self, burn(range) from self, balance must be 0.
    pub fn retire(
        env: Env,
        site_id: BytesN<32>,
        start_wh: u128,
        end_wh: u128,
        statement_hash: BytesN<32>,
    ) -> Result<BytesN<32>, Error> {
        ensure_not_paused(&env)?;
        let mut site = load_site(&env, &site_id)?;
        site.responsible.require_auth();
        if site.frozen {
            return Err(Error::SiteFrozen);
        }
        if end_wh <= start_wh {
            return Err(Error::EmptyRange);
        }
        if start_wh < site.retired_wh {
            return Err(Error::RangeOverlap);
        }
        if start_wh > site.retired_wh {
            return Err(Error::RangeGap);
        }
        if end_wh > site.accrued_wh {
            return Err(Error::OverRetire);
        }
        let skey = DataKey::Statement(statement_hash.clone());
        if env.storage().persistent().has(&skey) {
            return Err(Error::DuplicateStatement);
        }
        let stroops = (end_wh - start_wh)
            .checked_mul(STROOPS_PER_WH)
            .ok_or(Error::Overflow)?;
        if stroops > MAX_STROOPS {
            return Err(Error::AmountTooLarge);
        }
        let amount = stroops as i128;

        let commitment =
            retire_commitment(&env, &site_id, site.class, start_wh, end_wh, &statement_hash);
        let record = StatementRecord {
            site_id: site_id.clone(),
            class: site.class,
            start_wh,
            end_wh,
            commitment: commitment.clone(),
            ledger: env.ledger().sequence(),
        };
        env.storage().persistent().set(&skey, &record);
        bump_persistent(&env, &skey);
        site.retired_wh = end_wh;
        site.retirements = site.retirements.checked_add(1).ok_or(Error::Overflow)?;
        save_site(&env, &site_id, &site);

        let cfg = config(&env);
        let asset = if site.class == CLASS_LIVE { cfg.live_asset } else { cfg.sim_asset };
        let me = env.current_contract_address();
        let tok = token::TokenClient::new(&env, &asset);
        if tok.balance(&me) != 0 {
            return Err(Error::InvariantBroken);
        }
        token::StellarAssetClient::new(&env, &asset).mint(&me, &amount);
        tok.burn(&me, &amount);
        if tok.balance(&me) != 0 {
            return Err(Error::InvariantBroken);
        }
        bump_instance(&env);
        Retired {
            site_id,
            statement_hash,
            class: site.class,
            start_wh,
            end_wh,
            commitment: commitment.clone(),
        }
        .publish(&env);
        Ok(commitment)
    }

    // ----- views ------------------------------------------------------------------

    pub fn config(env: Env) -> Config {
        config(&env)
    }

    pub fn paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    pub fn site(env: Env, site_id: BytesN<32>) -> Option<Site> {
        env.storage().persistent().get(&DataKey::Site(site_id))
    }

    pub fn statement(env: Env, statement_hash: BytesN<32>) -> Option<StatementRecord> {
        env.storage().persistent().get(&DataKey::Statement(statement_hash))
    }
}
