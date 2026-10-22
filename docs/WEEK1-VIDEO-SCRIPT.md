# QWATT — Week 1 update · YouTube script (3:00)

**Deliverable:** Instawards sprint, Deliverable 1 — meter-agnostic ingestion (`docs/SOW-INSTAWARD-v3.md` §4)
**On camera:** Jay Kim (CEO) · Diego Ostertag (engineering and product)
**Audience:** Stellar community reviewers, program leads, prospective design partners
**Spoken length:** ≈ 2:50 at a steady pace · **Hard stop:** 3:00
**Language:** English (a Spanish cut can reuse the same shots)

Every number below comes from the repo as of commit `98b281a` and can be re-run on camera.

---

## 0:00 – 0:15 · Cold open (Jay, to camera)

*On screen: black, then the QWATT logo. Lower third: "Jay Kim · CEO, QWATT".*

> **JAY:** Small solar can't prove what it produced. Every meter speaks a different language, and
> verifying them costs more than the energy is worth. This week we fixed the first half of that
> problem. I'm Jay, CEO of QWATT, and this is week one.

## 0:15 – 0:40 · Why week one matters (Jay)

*On screen: simple diagram, three meters (Modbus, HTTP, CSV) → one record → four physics gates → Stellar. Highlight the first arrow only.*

> **JAY:** Our verifier already judges energy with four physics gates, under an open spec, version
> 1.0.0. But a verifier is only useful if real equipment can feed it. So the week-one commitment was
> simple to say and hard to do: any meter in, one identical record out. Adding a new meter should
> mean adding a configuration file, never changing the rules that judge it. Diego.

## 0:40 – 1:05 · Architecture freeze (Diego)

*On screen: `docs/ARCHITECTURE-FREEZE.md`, scroll slowly. Lower third: "Diego Ostertag · Engineering & Product".*

> **DIEGO:** Days one to three, we froze the architecture: the record format, the batch definition,
> the hash rules, the transaction format. One rule we're strict about: every unit of energy in our
> evidence is a whole number of milliwatt-hours. No decimals ever get hashed, so any language,
> on any machine, produces the exact same bytes. If something in the freeze turns out wrong, we
> document the change publicly. We don't edit it quietly.

## 1:05 – 1:45 · Three adapters, two meters as config (Diego)

*On screen: the ingest diagram from `ingest/README.md`, then open `ingest/maps/pzem-017.json` beside `ingest/maps/epever-tracer.json`.*

> **DIEGO:** Days four to seven, we built ingestion. Three ways in: Modbus, the industrial standard
> most inverters and meters use; HTTP, for devices that push data; and CSV, for replaying historical
> files. Our two bench meters, a PZEM-017 and an EPEver Tracer, aren't code. They're these two
> JSON files: addresses, data types, scaling. A new meter is a new file.
> And every record carries a fingerprint of the raw data it came from, so anyone can check that our
> conversion did exactly what the file says.

## 1:45 – 2:20 · The proof (Diego, then Jay)

*On screen: terminal, full screen. Type and run `node ingest/ingest.test.js`. Hold on the last lines:*
`harness: 720 samples × 2 meters → 24 intervals per path · 24/24 accepted · 240.9 Wh basis · BYTE-IDENTICAL across csv, http and modbus`
`21 passed, 0 failed`

> **DIEGO:** Here's the acceptance test. One synthetic solar morning, two meters, 720 samples, sent
> through all three paths. Twenty-four intervals out of each, all twenty-four accepted, and the
> records are byte-identical across Modbus, HTTP and CSV.
>
> **JAY:** That's the point. Same energy, three different routes, one answer. And it runs on every
> commit: 21 ingestion tests, 37 conformance checks and 24 validator tests, all green in public CI.

*Cut to GitHub Actions, green run on `academiaseul/QWATT`.*

## 2:20 – 2:45 · What's next (Jay, to camera)

*On screen: simple roadmap strip, Week 1 ✓ · Week 2 · Week 3 · Week 4.*

> **JAY:** Week two: these records become evidence batches, chained by hash, so changing any past
> record breaks the chain. And we publish the rejections, not just the passes, because a verifier
> that only shows its successes hasn't proven anything. Week three: anchoring on Stellar testnet,
> where it will take two independent signatures to record a batch.

## 2:45 – 3:00 · Close (Jay and Diego, two-shot)

*On screen: qwatt.org · github.com/academiaseul/QWATT · "Testnet".*

> **DIEGO:** Everything we showed is open source. Clone it and run the same test.
>
> **JAY:** We're looking for one shared-rooftop building or installer to be our design partner.
> If that's you, find us at qwatt.org. See you in week two.

---

## Production notes

- **Record the terminal for real.** Run `node ingest/ingest.test.js` on camera from a fresh clone;
  it needs no install step. Don't edit the numbers in post.
- **Data is synthetic.** The harness uses a simulated morning and a Modbus simulator. Do not say or
  imply that live meters or a real rooftop were read this week. The EPEver addresses still need
  confirming against the controller manual before the first live read (`ingest/README.md`).
- **Tense.** Multisig anchoring is week 3: say "will take two signatures", never "takes".
- **Don't say:** "DeFi", "decentralized", "REC" / "I-REC", "carbon credit", "investment", "price",
  "mainnet", or "customers" / "revenue" as if they existed (same list as `docs/DEMO-DAY-PITCH.md`).
- **Diego's lower third:** "Engineering & Product", matching the Demo Day deck.
- **Thumbnail:** "Any meter → one record" over the byte-identical terminal line.
- **Description box:** link the repo, `docs/ARCHITECTURE-FREEZE.md`, `ingest/README.md` and the
  green CI run for commit `98b281a`.
