# Key management: what went wrong and how we fixed it

*Instawards Chile, sprint #1 (19 Oct – 17 Nov 2026). Stellar testnet only.*

Two key problems happened during this sprint. Both are already in the changelog; this page puts
them in one place, with what we changed so they do not happen again.

## 1. The August treasury key was lost

**What happened.** In the August hackathon prototype, the testnet treasury key lived in browser
storage. A second testnet genesis on 24 Aug overwrote that storage, and the key was gone. Nothing of
value was lost (testnet only), but we could no longer move the asset of the first genesis.

**How we resolved it.** Deviation DV-10 ([PR #57](https://github.com/academiaseul/QWATT/pull/57))
moved the run to the QWATT asset of 24 Aug, whose treasury key Jay holds. The run account used that
asset from the start.

**What changed for good.**
- No key is created or kept in a browser. Every key is created with stellar-cli on the machine that
  uses it, and the site never asks for, stores or shows a secret key.
- Every key has a paper backup. On Fri 6 Nov all three holders restored their key from paper and
  signed one throwaway transaction
  ([`b5726893…`](https://stellar.expert/explorer/testnet/tx/b572689383e4a410ee400192e4f8c540704d4295f1d7e0c72f57f6197ef93c5e)),
  before the run account was created.
- The asset marker that needs an unlocked treasury goes away in the next design (agreement D1), so
  there is no treasury key left to lose.

## 2. The third signer arrived late

**What happened.** The plan was a signer from outside the team, named at kickoff. Our week 1 and
week 2 changelogs said the signer was confirmed and then chosen, but no key had arrived. The key we
use came from a signer found in week 3; it arrived on Thu 5 Nov, four days late. A deviation we
promised for Sun 1 Nov was not written. We said so in the week 3 changelog.

**How we resolved it.**
- Both founders confirmed the signer's public key by voice, and it was written into the freeze
  ([PR #56](https://github.com/academiaseul/QWATT/pull/56)).
- Diego confirmed in writing that the signer does not work for QWATT, depends on neither founder and
  has no role in the sprint.
- The run account was created on Fri 6 Nov with all three keys: weight 1 each, master key weight 0,
  thresholds 2/2/3. No single key can send anything; any change of signers needs all three.
- The run moved from Sat 7 to Mon 9 Nov (DV-11) instead of starting without the third key.

**Result.** The 7-day run anchored 168 of 168 batches, each with two signatures, and no key was
lost or exposed.

**What changed for good.**
- The third signer is named, with a public key confirmed by voice, **before** a sprint starts, not
  during it.
- A changelog says "confirmed" only when the public key is in hand.
- The signer has a one-page brief ([THIRD-SIGNER.md](THIRD-SIGNER.md)) and a stand-in role if the
  verifier is down.

## Still open

The stand-in drill and the kill tests did not run before the start. They are first on the list for
the next sprint.
