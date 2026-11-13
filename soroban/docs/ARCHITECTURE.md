# qwatt-issuance · Architecture

## One sentence

A Soroban contract that lets each measured watt-hour be claimed **once, and only once**.
A claim creates QWATT units and destroys them in the same call, so nobody ever holds one.

## Why, after Instaward #1

Instaward #1 proves a **measurement**: every hour a proposer and an independent verifier
agree on a batch of readings and anchor its fingerprint on Stellar under a 2-of-3 account.
A record is not a **claim**: nothing stops two parties citing the same energy. This
contract binds a statement to an exact range of measured energy, and that range can never
be used again, by anyone, the team included.

## Components

```
  Instaward #1 pipeline (exists)                    Soroban (this prototype)
  ┌──────────────┐   ┌──────────────┐
  │ Proposer     │   │ Verifier     │  both sign   ┌───────────────────────────┐
  └──────────────┘   └──────────────┘─────────────▶│  qwatt-issuance           │
     anchored batch: seq, cumulative_mwh, level    │   per site: verified Wh ▲ │
                                     accrue()      │             retired [0,n) │
  Site's responsible party ──── retire() ─────────▶│   per statement: once     │
                                                   └────────────┬──────────────┘
  Governance: classic 2-of-3 account                            │ only admin of
  register · freeze · pause · rotate relay                      ▼
                                         ┌────────────────────────────────────┐
                                         │ Stellar Asset Contracts (built-in) │
                                         │  QWATT   ← live measured data       │
                                         │  QWA0SIM ← simulated data           │
                                         │  issuers locked (master weight 0)   │
                                         └────────────────────────────────────┘
```

### Assets and locked issuers
Each classic asset's Stellar Asset Contract (SAC) starts with its issuer as admin. The
issuer calls `set_admin(contract)`, then is locked (master weight 0, no signers). After
that, no key can create units. Only the contract's code can call the SAC's `mint`, and the
host refuses mint to or burn from the issuer (`check_not_issuer`).

### Sites
Governance registers a site: a 32-byte id, the responsible party's address, a data class
(0 simulated, 1 live; fixed for life) and the next expected batch sequence.

### `accrue`: the verified counter (two-key relay)
Needs **both** relay keys. The check order is part of the specification:
auth(proposer) → auth(verifier) → paused → site exists → frozen → level valid →
level matches class → seq (replay / gap) → cumulative not decreasing → seq + 1 fits u64.
Then `accrued_wh = floor(cumulative_mwh / 1000)`, and the site's hash chain advances:
`sha256("QWATT/issuance/v1/accrue\0" ‖ prev ‖ site ‖ seq ‖ cumulative ‖ level ‖ batch_hash)`.

### `retire`: the claim
Order: paused → site exists → auth(responsible) → frozen → non-empty range →
no overlap (`start < retired` refused) → no gap (`start > retired` refused) →
`end ≤ accrued` (the min(A,B) rule) → statement unused → amount fits.
Effects, in one call: store the statement record and its commitment
`sha256("QWATT/issuance/v1/retire\0" ‖ site ‖ class ‖ start ‖ end ‖ statement_hash)`,
move `retired_wh` to `end`, mint `(end − start) × 10` stroops to itself on the asset of the
site's class, burn the same, and check the balance is 0 before and after.

Contiguous ranges from 0 make overlap impossible by construction, with O(1) storage per
site: the consumed set is always `[0, retired_wh)`.

### Controls
`set_paused` stops register, accrue, retire and relay rotation. `set_frozen` stops one
site, and works while paused. `set_relay` replaces the relay pair but never with one key
for both roles. There is no upgrade, transfer, approve or public mint function.

### Integers and hashes
u64 sequence, u128 energy, checked arithmetic, `overflow-checks = true` in release
(stellar-cli refuses to build without it), one retirement capped at i64::MAX stroops.
Every hash starts with its own domain tag: `QWATT/site/v1`, `QWATT/batch/v1`,
`QWATT/statement/v1`, `QWATT/issuance/v1/accrue`, `QWATT/issuance/v1/retire`.

## How it is checked

1. **Two independent implementations.** The Rust contract and a BigInt JavaScript model
   apply the same rules in the same order.
2. **62 hand-written cases.** Each implementation must meet every expectation, and their
   full transcripts (results, integers, digests, commitments, final state) must be
   byte-identical. Compared for model vs native Rust and model vs the compiled Wasm.
3. **1,000 seeded random sequences** (30,000 steps): byte-identical transcripts.
4. **proptest**: seven invariants after every step, with shrinking.
5. **Mutation check**: planted bugs must be caught (STATUS.md).
6. **Local network spike**: the real Wasm on stellar-core + RPC (protocol 30), with
   real transactions, fees and refusals.

## Out of scope

Mainnet; any sale, transfer, trading or price; certificates, RECs or carbon credits;
moving the gate checks on-chain (Instaward #3); third-party sites; audits and legal work.
