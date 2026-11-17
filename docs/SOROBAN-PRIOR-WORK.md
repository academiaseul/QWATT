# Soroban issuance prototype (prior work)

*Status: local network only. Not on testnet, not on mainnet, not audited.*

## What it is

A prototype of the issuance contract planned for the next Instaward, written in Rust with
soroban-sdk 29.0.1. It was built on 12–13 Nov 2026, outside the scope of sprint #1 and **not funded
by any Instaward**. We disclose it here as prior work for the next proposal.

The code is in a private repository, `academiaseul/qwatt-soroban`. We give read access to
reviewers on request.

## What it does

- **Two-key accrual.** `accrue` records verified energy for a site only with both the proposer's
  and the verifier's signatures, the exact next sequence number, and a total that never goes down.
- **Retire in one call.** `retire` mints and burns the same amount in one transaction, through a
  Stellar Asset Contract whose admin is the contract. The balance is zero before and after, so there
  is never a token to transfer or trade.
- **Locked issuer.** After setup the classic issuer has master weight 0 and no signers. Only the
  contract can mint.
- **2-of-3 governance** for registering sites, pausing and freezing.
- **No double counting.** Each site's retirements cover contiguous ranges that cannot overlap, and
  every statement commitment is unique.
- **No upgrade path**, on purpose: an upgrade key could mint.

## How it was tested (all performed, local only)

| Test | Result |
|---|---|
| Conformance cases (replay, overlap, overflow, unauthorized, frozen, …) | 62 cases, 214 steps: JS model, Rust native and compiled Wasm give byte-identical transcripts |
| Random sequences, model vs contract | 1,000 sequences, 30,000 steps, identical |
| Property tests (proptest) | 7 invariants, pass |
| Mutation check (10 planted bugs) | 10/10 caught, after adding 3 boundary cases the first run showed were missing |
| Local network spike (`stellar/quickstart --local`) | 8/8 mechanics and 12/12 scripted refusals, pass |

Measured fees on the local network: accrue 14,360 stroops; retire 262,839 stroops.

## Not done yet

- The same spike on **testnet** (needs the founders' approval; planned before the 16 Dec reset or
  right after it).
- The two-key relay service, statement schemas, ceremony scripts and the retire page.
- CI on GitHub Actions (written, never run there).
- An outside security review.
