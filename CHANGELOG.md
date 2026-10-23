# Changelog · QWATT

What we did each week of the Instawards Chile sprint, which started on 19 Oct 2026. Work from before that day is in [docs/PRIOR-WORK.md](docs/PRIOR-WORK.md).

*Versión en español: [CHANGELOG.es.md](CHANGELOG.es.md).*

## Week 1 — 19 to 23 October 2026

### Summary
QWATT is an open-source verifier that turns solar meter readings into records on Stellar testnet that anyone can re-check from public data alone; it cannot show that a meter is accurate or that the energy was really produced. This week we closed two ways to fool our own verifier, plus four more found by reviewing those fixes; tests went from 154 to 194, all passing. All input is simulated (no real meter was read), and we sent 0 testnet transactions this week, on purpose.

### Added
- **Prior work, public and labeled.** Diego Ostertag's 20 commits from 8 to 17 Oct were brought into this repository with their original dates and author ([PR #4](https://github.com/academiaseul/QWATT/pull/4)). The tag `dia-1` (`7336e20`) marks the cut-off, and [docs/PRIOR-WORK.md](docs/PRIOR-WORK.md) lists everything before it (added in `6be021f`).
- **40 new automated tests** (154 → 194), most of them tampering attempts that must be refused.
- **Architecture freeze v3** ([docs/ARCHITECTURE-FREEZE-v3.md](docs/ARCHITECTURE-FREEZE-v3.md), `b304ddb`), agreed by both founders on Wed 21 Oct (Day 3) and written into the repository on Thu 22 Oct. It sets the evidence format, the signing and rejection rules, and the plan for each week. It reached main in a later pull request, after PR #10 (see Blockers).
- **Evidence for Deliverable 1, reading any meter** (`cae00a6`, [PR #10](https://github.com/academiaseul/QWATT/pull/10)): [docs/DELIVERABLE-1-EVIDENCE.md](docs/DELIVERABLE-1-EVIDENCE.md), the saved output of the acceptance test ([evidence/harness/harness-c1ae630.txt](evidence/harness/harness-c1ae630.txt)) and 5 new meter-reading tests. One of them tests Modbus RTU (Modbus over a serial cable) on a simulated port.
- **License notices** for third-party code and public data: `THIRD_PARTY_NOTICES.md` and `datasets/LICENSE` (`141089a`). One point is still open: a file from the August prior work, `assets/vendor/stellar-wallets-kit.js` (not deployed on the site), bundles a GPL-3.0 package, and we have not yet decided whether to keep it.
- **[CHANGELOG.es.md](CHANGELOG.es.md):** this changelog in Spanish.

### Changed
- **A rejected batch no longer adds energy to the running total that will be written to Stellar testnet;** it carries the previous total forward (`8385da3`, [PR #8](https://github.com/academiaseul/QWATT/pull/8)). Planned for week 3, built now because without it the same energy could count twice.
- **Thresholds 2/2/3 for the anchoring account** (`075b14e` test, `666c65b` change, [PR #9](https://github.com/academiaseul/QWATT/pull/9)). On that account, which does not exist yet, no single key, not even one of our two, will be able to send a transaction; anchoring will need 2 of the 3 keys, and changing signers or thresholds all 3. Our two team keys together can anchor without the signer from outside the team, but cannot change signers or thresholds without the third key. Built into the account setup tool and its check, and tested against a simulated network; the real account is planned for next week.
- **Prior work relabeled accurately** (`141089a`). The 8 Oct run once called a "two-day live run" is now described as what it was: an accelerated rehearsal of 48 simulated hours in 4 min 18 s, on throwaway testnet accounts. Energy totals in our reports now say "Simulated input · Stellar testnet".
- **README, website and `stellar.toml`** (the public file that describes our Stellar testnet accounts) now describe the sprint, say that the input is simulated, and say that we use testnet only (`152e088`, [PR #2](https://github.com/academiaseul/QWATT/pull/2); `8175ba9`, `799ab5a`, [PR #6](https://github.com/academiaseul/QWATT/pull/6); `155fb0f`, [PR #3](https://github.com/academiaseul/QWATT/pull/3)). The demo page names the anchored value correctly: `qwatt.cumulative_mwh`, in milliwatt-hours (`ad71bee`).

### Fixed
Flaws 1 and 2 were found in our own code review on 12 Oct, before Day 1. They affected no real record: the real anchoring account does not exist yet, and every rehearsal used throwaway accounts.

- **Flaw 1 (S1), "the inherited total".** The independent verifier copied the previous batch's running total from our published file without checking it, so an altered file could inflate the total. Now, before signing, it walks the chain back to the last batch anchored on Stellar and recomputes every fingerprint and total. Test `bdd5784` ([PR #7](https://github.com/academiaseul/QWATT/pull/7)), fix `09210b0` ([PR #5](https://github.com/academiaseul/QWATT/pull/5)).
- **Flaw 2 (S2), "the same energy, twice".** A batch rebuilt from intervals already counted passed as new. Now intervals that are repeated, overlapping, off the 5-minute grid or from another installation are refused. Test `6204b12` ([PR #5](https://github.com/academiaseul/QWATT/pull/5)), fix `40aaa3d` ([PR #1](https://github.com/academiaseul/QWATT/pull/1)).
- **Review of both fixes: four more ways to count the same energy twice, closed** (DV-1 to DV-4 in freeze v3). Test `301bc50` ([PR #1](https://github.com/academiaseul/QWATT/pull/1)), fix `8385da3` ([PR #8](https://github.com/academiaseul/QWATT/pull/8)):
  - each new batch is checked against the last accepted batch only, never a rejected one, so a rejected batch cannot reopen time already counted;
  - each earlier batch is downloaded once and its fingerprint checked before it is read;
  - the input stage refuses just the interval, not its whole batch, when it comes from another installation or device or overlaps the previous one;
  - the web (HTTP) input stores each timestamp in one standard format, and rejects an off-grid interval at once instead of accepting it and dropping it later.
- **One way anchoring could stop for good** (DV-5, same commits). After more than 168 rejected batches in a row (a week of hourly batches), the verifier refused the next batch again and again with the error code meant for a forged chain, and nothing could be anchored again without changing the code. Reaching the walk's limit now has its own code, `verifier.walk_too_long`, and the proposer runs the same walk before proposing.

### Removed
- **Google Analytics** from the home page, the demo page and the error page (`8175ba9`, `799ab5a`).
- **The 11 pages of the August 2026 hackathon** from qwatt.org; their URLs now redirect to the home page (`c3fd035`, [PR #3](https://github.com/academiaseul/QWATT/pull/3)).
- **The reconciliation page** (which checks every anchor on Stellar against the published batches) from the site, until it reads the account's signers and thresholds from Stellar instead of stating them (`141089a`).
- **Old pitch material, internal documents, earlier versions of our proposal and local editor settings** from the repository's current files (`152e088`, `772b8f3`, `c2fd8db`, `16bc6c2`, `184f885`, `26e615c`). They remain in the public git history.

### Progress vs. last week
This is our first week, so "last week" is the prior work that existed before Day 1 (Mon 19 Oct), listed in [docs/PRIOR-WORK.md](docs/PRIOR-WORK.md). It is not funded by the Instawards program and is not counted below. "Goal (Monday)" means a goal we set on Day 1.

- Goal (Monday): prior work public, labeled and tagged `dia-1` → Result: done Wed 21 Oct ([PR #4](https://github.com/academiaseul/QWATT/pull/4), `7336e20`).
- Goal (Monday): Flaw 1 closed, red to green → Result: done. Red in [run #19](https://github.com/academiaseul/QWATT/actions/runs/39589564074), green in [run #29](https://github.com/academiaseul/QWATT/actions/runs/39593831385) (pull request) and on main in [run #30](https://github.com/academiaseul/QWATT/actions/runs/39593847463).
- Goal (Monday): Flaw 2 closed, 4 of 4 attempts refused → Result: done, 4 of 4. Red in [run #17](https://github.com/academiaseul/QWATT/actions/runs/39589526847), green in runs [#29](https://github.com/academiaseul/QWATT/actions/runs/39593831385) and [#30](https://github.com/academiaseul/QWATT/actions/runs/39593847463).
- Goal (our proposal, days 1–3): agree on the architecture → Result: architecture freeze v3 agreed on Day 3, Wed 21 Oct, and written into the repository on Day 4 (`b304ddb`).
- Goal (our proposal, week 1): Deliverable 1, read any meter (Modbus, HTTP or CSV) with byte-identical output → Result: the reader was built before Day 1 (prior work, `98b281a`, 9 Sep). This week we added its evidence (`cae00a6`): 24 of 24 intervals accepted, identical across the three inputs, with Modbus read from a simulator. Three items stay open (see Blockers).
- Goal (our proposal): a signer from outside the team, designated at kickoff → Result: confirmed this week, not at kickoff.

**In numbers**
- Tests: 154 passing at `dia-1` → 194 passing on main, 0 failing ([run #34](https://github.com/academiaseul/QWATT/actions/runs/39943161382)).
- Tests for the two flaws: 10 written, 9 of them cases that must be refused, and all 9 are. 5 were red until their fix landed; the other 5 came with the fix.
- Review of the fixes: 14 new tests and 6 rewritten; 19 of those 20 were red before the fix and are green after. Thresholds: 11 new tests, 8 of them red without the change (checked locally).
- No change for untampered data: one month of a public research dataset (NREL PVDAQ, September 2017; not our measurements), replayed offline as 720 batches, still verifies with 0 rejected and the same final fingerprint as at `dia-1`. Nothing is sent to Stellar in this test.
- Commits: 30 on main from `dia-1` to `4ac5632`, plus `b304ddb`, the freeze v3 document (not counting merge commits or the commit that adds this text).
- Pull requests merged up to `4ac5632`: 9 with this week's work, plus #4, which brought in prior work. Freeze v3 needed one more (see Blockers).
- Testnet transactions this week: 0, on purpose, checked on Horizon for every account listed in the repository.
- Stellar secret keys in the repository: 0, scanning every commit on every public branch and tag (156 commits on 23 Oct).

### Blockers and lessons
- **Resolved: the signer from outside the team is confirmed.** Their secret key stays with them; their public key will be added when the real account is created next week. Freeze v3 (OD-2), [docs/FOUNDER-CHECKLIST.md](docs/FOUNDER-CHECKLIST.md) and [docs/RUNBOOK.md](docs/RUNBOOK.md) were written before the confirmation and still show it as open, with a fallback of thresholds 2/2/2 and two team signers; that fallback is no longer the plan.
- **Our main branch was red for about five minutes on 21 Oct** (CI runs [#26](https://github.com/academiaseul/QWATT/actions/runs/39593287708) to [#28](https://github.com/academiaseul/QWATT/actions/runs/39593346018)): our stacked pull requests #7, #5 and #1 each ended on a test meant to fail until its fix, which came in the next one, and we merged them before #8, which carried the last fix. We also merged [PR #8](https://github.com/academiaseul/QWATT/pull/8) and [PR #9](https://github.com/academiaseul/QWATT/pull/9) about 30 seconds before their CI finished (both passed). The freeze v3 document was left out of [PR #10](https://github.com/academiaseul/QWATT/pull/10), so it went in through a later pull request. Lesson: merge a test together with its fix, wait for CI, and check what a pull request contains before merging it.
- **Some red-to-green proof is only local.** No CI run tested the Flaw 1 or Flaw 2 fix on its own, and the 2/2/3 test never ran red in public CI. Anyone can reproduce both by running the tests at the commits listed above. Lesson: push the failing test so CI records it.
- **Still open in Deliverable 1 (reading any meter):** two battery fields of the EPEver Tracer charge controller (registers 0x3104 and 0x3105) and the test-bench settings of the PZEM-017 meter need real hardware, which is outside this sprint. Separately, the code interface for meter inputs differs from the first architecture freeze (deviation D1-1). The founders will decide how to handle all three.
- **Lessons:** a verifier that trusts our files is not independent; it has to check against what is anchored on Stellar. And a fix is finished when it survives someone trying to break it, not when it passes its own tests.

### Next week (26 to 30 October)
Planned, not built yet:

1. **Create the real 2-of-3 account on Stellar testnet,** with three signers (the proposer, the independent verifier and the signer from outside the team), thresholds 2/2/3, and the key that created the account switched off.
2. **Tests A–D and the independence test on that account:**
   - A (proposer alone) and B (verifier alone): rejected by the network for having too few signatures (`tx_bad_auth`). They are never recorded on Stellar, so the evidence is the signed transaction and the network's answer, not a stellar.expert link as our proposal first said; only C gets one.
   - C (both sign): anchored, with a link to it on stellar.expert, a public Stellar explorer.
   - D (batch altered after the proposer signed): refused by the verifier; nothing is anchored.
   - Independence: the verifier refuses a batch that was never published, since it may use only public data.
3. **Raw readings in every batch:** each batch will carry a fingerprint of all its raw readings (`samples_root`). The first batch will be anchored on the real account, and its evidence published in two new public repositories, one written only by the proposer and one only by the verifier.

Also due in week 2 under freeze v3: every input path records how far its clock is off; each key is created on the machine that will use it, never in a browser; the reconciliation page reads the signers and thresholds from Stellar; and no energy is estimated across a gap longer than three readings when a meter drops out. Mid-week post: test A, rejected by the network. Later: code freeze on Fri 6 Nov, then 7 days on testnet that count for the final results, from Sun 8 Nov 00:00 to Sun 15 Nov 00:00, Chile time. That is earlier than the days 23–30 in our proposal, and inside the same 30 days.

### Links
- **Video (2:56):** https://youtube.com/shorts/4PBe8vSmcwM
- **Post on X:** https://x.com/ch1ngukim/status/2113590210952921290
- **What's new this week, commit by commit:** https://github.com/academiaseul/QWATT/compare/dia-1...semana-1
- **Pull requests:** [#4](https://github.com/academiaseul/QWATT/pull/4) prior work · [#2](https://github.com/academiaseul/QWATT/pull/2) README and docs · [#6](https://github.com/academiaseul/QWATT/pull/6) website · [#3](https://github.com/academiaseul/QWATT/pull/3) August pages retired · [#7](https://github.com/academiaseul/QWATT/pull/7), [#5](https://github.com/academiaseul/QWATT/pull/5), [#1](https://github.com/academiaseul/QWATT/pull/1) and [#8](https://github.com/academiaseul/QWATT/pull/8) the two flaws and the review · [#9](https://github.com/academiaseul/QWATT/pull/9) thresholds · [#10](https://github.com/academiaseul/QWATT/pull/10) Deliverable 1
- **CI runs, red before the fixes:** [#19](https://github.com/academiaseul/QWATT/actions/runs/39589564074) Flaw 1 · [#17](https://github.com/academiaseul/QWATT/actions/runs/39589526847) Flaw 2 · [#13](https://github.com/academiaseul/QWATT/actions/runs/39587187862) and [#25](https://github.com/academiaseul/QWATT/actions/runs/39593250856) review. **Green after:** [#29](https://github.com/academiaseul/QWATT/actions/runs/39593831385) (pull request) and [#30](https://github.com/academiaseul/QWATT/actions/runs/39593847463) (main). **Thresholds, green:** [#31](https://github.com/academiaseul/QWATT/actions/runs/39939377387) (pull request) and [#32](https://github.com/academiaseul/QWATT/actions/runs/39939391730) (main).
- **CI on main after the week's last code change:** [run #34](https://github.com/academiaseul/QWATT/actions/runs/39943161382), on `4ac5632`.
- **Repository:** https://github.com/academiaseul/QWATT. With Node.js 20 or later and git, run `npm test`; for the anchoring tests, `npm ci --prefix anchor` and then `npm run test:anchor`. No test connects to Stellar testnet.
- **Docs:** [prior work](docs/PRIOR-WORK.md) · [Deliverable 1 evidence](docs/DELIVERABLE-1-EVIDENCE.md) · [architecture freeze v3](docs/ARCHITECTURE-FREEZE-v3.md)
- **Browser demo** (prior work from August 2026, reworded this week): https://qwatt.org/verificacion.html

### Glossary
- **Testnet:** Stellar's test network, separate from its main network. QWATT uses only testnet.
- **Batch:** a package of 5-minute intervals of readings, checked and published together.
- **Rejected batch:** a batch that failed a check. It is published with its reason, but it is not anchored and adds no energy to the total.
- **Fingerprint (hash):** a short code computed from data. Changing a single byte changes it completely.
- **Chain of batches:** each batch carries the previous batch's fingerprint, so altering one breaks every batch after it.
- **Anchor:** to write a batch's fingerprint and the running energy total into a Stellar testnet transaction, where it is dated and cannot be edited.
- **Proposer:** our service that builds and publishes each batch and signs first.
- **Independent verifier:** a separate service with its own key that re-checks every batch from public data only, then co-signs. Today our own team operates it (it will run on a host of its own): it is independent in code and data, not in organization, which is why it may use only public data. Routine anchoring will use our two keys; the key held outside the team is needed to change signers or thresholds, and can stand in for the verifier.
- **Signers (2 of 3):** the keys allowed to sign for the anchoring account. The account, planned for next week, will have three: the proposer's, the verifier's and one held by a person outside the team. Any two can anchor, including our two team keys together; none can act alone.
- **Thresholds 2/2/3:** the signatures the account will need: 2 for any transaction, 2 to anchor, 3 to change signers or thresholds.
- **Horizon:** Stellar's public interface for reading what the network recorded.
- **CI:** the automated tests GitHub runs on every change. Red means a test failed; green means all passed.
- **Pull request (PR):** a proposed change that is reviewed, then merged into the main code.
- **Commit:** one saved change, with its date and author, named by a short code such as `bdd5784`.
- **Tag:** a fixed name for a point in the history. Ours are in Spanish: `dia-1` ("day 1") marks where prior work ends (the sprint started Mon 19 Oct), and `semana-1` ("week 1") marks the end of week 1.
- **Modbus, HTTP, CSV:** three ways readings arrive: an industrial meter protocol, a web request, a file.
- **Architecture freeze:** the document both founders agreed on that fixes the design and the weekly plan for the sprint; v3 is its third version.
- **Deliverable 1:** the first milestone in our proposal: read any meter (Modbus, HTTP or CSV) and get identical records.
- **Main:** the repository's main branch, the code everyone gets.
- **Item codes (S1, S2, DV-1 to DV-5, D1-1):** the numbers these items carry in our code review and in the architecture freeze, for readers who want the detail.

*QWATT is a project in development that runs only on Stellar testnet. QWATT is not electricity, an investment, a security or financial instrument, a renewable energy certificate (REC) or a carbon credit. It has no price and is not for sale.*
