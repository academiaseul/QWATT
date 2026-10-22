# QWATT — Week 1 · YouTube script (3:00)

**Working title:** *Every rooftop should be able to prove its sunshine*
**Deliverable:** Instawards sprint, Deliverable 1 — meter-agnostic ingestion (`docs/SOW-INSTAWARD-v3.md` §4)
**On camera:** Jay Kim and Diego Ostertag, co-founders
**Audience:** Stellar community, program reviewers, solar installers, possible design partners
**Spoken length:** ≈ 2:50 · **Hard stop:** 3:00 · **Language:** English (a Spanish cut can reuse every shot)

**The feeling we want:** people meet two builders who care about a real, small problem, see it solved
in front of them with nothing hidden, and leave wanting to try it or help.
**The one idea they remember:** *any meter, one truth.*

Every number in this script comes from the repo at commit `98b281a` and can be re-run on camera.

---

## 0:00 – 0:12 · The hook

*Black screen. Sound first: a quiet electrical hum. Fade up on an extreme close-up of a meter
display, digits ticking. Natural light, slow push-in. No logo yet.*

> **JAY (voice-over):** This number is the only proof a small solar roof has of what it gave the
> world. And right now, almost nobody can check it.

*Hard cut to Jay on a rooftop in Santiago, panels behind him, late-afternoon sun.*

## 0:12 – 0:40 · Why we care

*Jay walks along the panels, talking to camera. B-roll: an apartment building's shared roof, a
single meter in a stairwell, a hand holding an electricity bill with one kWh figure circled.*

> **JAY:** I'm Jay. I spent ten years in energy, running solar plants here in Chile, and I've
> seen the same argument again and again: whose meter, which number, who checks it.
> Picture one roof, one meter, forty neighbors. Proving who produced what costs more than the
> energy is worth. So the smallest producers just get left out.
> Diego and I started QWATT so that a small roof can prove its work as cleanly as a power plant can.

## 0:40 – 1:05 · The problem nobody sees

*Cut to Diego at the workbench. Lower third: "Diego Ostertag · Co-founder, QWATT". On the
desk: the bench meters if you have them, otherwise product photos composited on screen.*

> **DIEGO:** Here's the hidden problem. Every meter speaks its own dialect. Different wiring,
> different registers, different units. Most systems handle that by writing new code for every
> device, and every new line of code is a new place for mistakes to hide.
> So in week one we asked: what if the rules that judge the energy never had to change?

*Graphic: four meters speaking in different scribbled "languages" → one clean line of text.*

## 1:05 – 1:40 · What we built

*Screen recording, clean and zoomed. Show `ingest/maps/pzem-017.json` next to
`ingest/maps/epever-tracer.json`, then the three-paths diagram from `ingest/README.md`
animating in one arrow at a time.*

> **DIEGO:** We built a translator. Data can arrive three ways: straight off the wire from a
> meter, pushed over the internet, or replayed from a file. And a meter isn't code anymore.
> It's a short settings file, like adding one more language to a dictionary.
> Every record also keeps a fingerprint of the raw data it came from, so anyone can check we
> translated honestly. And we count energy in whole numbers only, so every computer on earth gets
> the exact same answer.

## 1:40 – 2:15 · The moment of truth

*Music drops out completely. Terminal, full screen, real time. Diego types
`node ingest/ingest.test.js` and presses Enter. Let the lines scroll at real speed. Freeze and
highlight the key line in the brand accent colour:*
`harness: 720 samples × 2 meters → 24 intervals per path · 24/24 accepted · 240.9 Wh basis · BYTE-IDENTICAL across csv, http, modbus`

> **DIEGO:** So here's the test. One simulated solar morning, two meters, 720 readings, sent down
> all three roads.

*Beat. One full second of silence on the highlighted line.*

> **DIEGO:** Byte-identical. Every path, the same answer, down to the last character.

*Music comes back in, warmer. Cut to Jay, smiling.*

> **JAY:** Same sunshine, three different roads, one truth. And this isn't a one-time demo. It runs
> on every change we make, in public. You can watch it go green.

*Quick cut: the green GitHub Actions run on `academiaseul/QWATT`.*

## 2:15 – 2:40 · Where this goes

*Back on the rooftop, golden hour. Simple roadmap overlay: Week 1 ✓ · Week 2 · Week 3 · Week 4.*

> **JAY:** Next week, every record gets chained to the one before it, so nobody can quietly
> rewrite the past. And we'll publish the rejections, not just the passes, because a checker that
> only shows its wins hasn't proven anything.
> In week three, records go onto Stellar's test network, and it will take two independent
> signatures to write one.

## 2:40 – 3:00 · The invitation

*Two-shot, Jay and Diego side by side on the roof. Natural, not posed. End card fades in:
qwatt.org · github.com/academiaseul/QWATT · "Testnet".*

> **DIEGO:** Everything you saw is open source. Clone it, run the same test, and try to break it.
>
> **JAY:** And if you live or work under a shared solar roof, we'd love you as our first design
> partner. Every rooftop should be able to prove its sunshine. See you next week.

*Last frame: the meter close-up from the opening, digits still ticking, then cut to black.*

---

## Why this version works

- **It opens on a feeling, not a feature.** A ticking number nobody can check is the whole problem
  in five seconds, before any logo or name.
- **It earns trust before it asks for attention.** Jay's ten years running plants is said once, as
  the reason he cares, not as a credential.
- **Every technical idea has a picture.** Dialects and a translator, a dictionary entry, three roads
  to one truth. Viewers who never heard of Modbus still follow.
- **The proof is real and given room.** The music cuts, the line is highlighted, and there's a beat
  of silence. That pause is the emotional peak of the video.
- **It ends with an invitation, not a pitch.** "Try to break it" and "be our partner" make viewers
  part of the story.
- **It loops.** The last frame is the first frame, now with meaning.

## Shoot list

| Shot | Where | Notes |
|---|---|---|
| Meter display, extreme close-up | Any real meter or inverter screen | Macro or phone in portrait-zoom; digits must move |
| Jay walk-and-talk | A rooftop with panels, Santiago | Late afternoon or golden hour; lavalier mic, wind cover |
| Shared-roof B-roll | Apartment building roof, stairwell meter | Get permission from the building; no faces of neighbors without consent |
| Bill close-up | A real bill with personal data covered, or a mock-up | Blur names, account numbers and address |
| Diego at the bench | Desk with laptop and meters | Soft side light; meters only if physically there |
| Terminal run | Screen capture, fresh clone | 125 % zoom, dark theme, one take, no edits to numbers |
| Two-shot close | Same rooftop | Shoot several takes; keep the most natural one |

## Sound and edit

- **Music:** soft, warm instrumental (piano or light synth), low under voice. Fully out for the
  terminal moment, back in on "Same sunshine". Use royalty-free or licensed tracks only.
- **Pacing:** change the picture every 5–8 seconds; never hold a talking head longer than ~15 s
  without a cut to B-roll.
- **Captions:** burned-in, large, high contrast. Most viewers watch muted at first.
- **Colour:** keep the QWATT palette (warm paper, terracotta accent) on every graphic.

## YouTube packaging

- **Title options:**
  1. *Every rooftop should be able to prove its sunshine · QWATT week 1*
  2. *Any meter, one truth: what we built in week one*
  3. *We made three different roads give the exact same answer*
- **Thumbnail:** Jay and Diego on the roof, small, to one side; big text "ANY METER → ONE TRUTH";
  the highlighted "BYTE-IDENTICAL" line as a strip across the bottom.
- **Chapters:** 0:00 The problem · 0:40 Every meter speaks a dialect · 1:05 What we built ·
  1:40 The test · 2:15 What's next · 2:40 Try it yourself
- **Description:** two lines on the mission, then links to the repo, `docs/ARCHITECTURE-FREEZE.md`,
  `ingest/README.md` and the green CI run for commit `98b281a`. Mark it clearly as testnet.
- **Pinned comment:** "What meter is on your roof? Tell us and we'll tell you how hard it is to
  add." Comments drive reach, and the answers are leads for design partners.

## Honesty guardrails (keep these, the trust is the product)

- **Data is simulated.** The test uses a simulated morning and a simulated meter. Never say or
  imply that live meters or a real rooftop were read this week. Rooftop shots are setting, not
  evidence; add the on-screen text "Test data: simulated" during the terminal shot.
- **Tense.** The two-signature step is week three: say "will take", never "takes".
- **Jay's background:** "ten years in energy, running solar plants here in Chile". Don't inflate it.
- **Don't say:** "DeFi", "decentralized", "REC" / "I-REC", "carbon credit", "investment", "price",
  "mainnet", or "customers" / "revenue" as if they existed (same list as `docs/DEMO-DAY-PITCH.md`).
- **Titles:** both of you are "Co-founder, QWATT". Never introduce either of you as CEO.
