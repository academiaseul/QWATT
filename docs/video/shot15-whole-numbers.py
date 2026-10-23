"""QWATT week 1 video, shot 15 (1:31-1:40), vertical 1080x1920: under Diego's
"And we count energy in whole numbers only, so every computer on earth gets the
exact same answer."

The interval record from shot 14, canonicalised and hashed twice, by two
independent pieces of code on two different machines-as-glyphs.

  0.0-1.2 s  kicker "docs/ARCHITECTURE-FREEZE.md §1", headline "Energy in whole /
             milliwatt-hours" ("whole" in terracotta) and the freeze's issuance
             line "1 QWATT = 1 MWh = 1,000,000,000 mWh" rise in a few frames apart
  1.95-2.75 s the headline glides up and shrinks into the title; the kicker and the
             unit line travel with it
  2.6-3.5 s  two generic laptops rise in, a few frames apart: a thin dark one
             labelled "Node.js", a chunkier warm-grey one labelled "Python"
  3.35-6.0 s both screens fill in, each at its own rhythm: the canonical JSON's
             length and its first bytes, meters.a.mwh, meters.b.mwh, and the
             first 16 hex of sha256 over the canonical bytes
  6.4 s      the hash lines are marked in terracotta on both screens and a
             terracotta badge "= same bytes, same hash" settles in between them
             (6.5 s); hold to 9.0 s

What is real: every value on both screens is computed at render time, from the
same record, by two separate implementations, and the script refuses to render
(exit with "BLOCKER") unless they agree byte for byte.

  Node.js   RECORD_JS (below) runs the acceptance harness, ingest/harness.js run(),
            unchanged, and keeps the records the modbus path closes, as shot 14
            does (IntervalBuilder._close is wrapped; the wrapper calls the
            original and changes nothing). It takes the first one (seq 0,
            15:00-15:05Z, the record shot 14 shows) and hashes it with the repo's
            own code path: canonical() and sha256() from ingest/lib/normalize.js,
            the functions the harness itself compares records with.
  Python    canonical() and python_side() (below) are a separate implementation of
            docs/ARCHITECTURE-FREEZE.md §1, written here without looking at the
            bytes Node produced: keys sorted (by UTF-16 code unit, as JavaScript
            sorts), no whitespace, strings escaped as JSON.stringify escapes them,
            integers only (a float raises), UTF-8; then hashlib.sha256. Its input is
            the record as JSON.stringify(record, null, 2) prints it, in the
            builder's own key order, so the sorting is Python's own work.

The script checks that the two canonical byte strings are identical, that the
full 64-hex hashes are identical (the screens show the first 16, marked "…"),
and that the energies each side reads from its own copy of the record agree.
The bytes line is the head of each side's own canonical output, cut to fit and
ending in "…". The runtime versions in the labels are the ones that rendered.

With the repo at 3fce885, Node 22.22.0 and Python 3.13.16:

    record     seq 0, 2026-09-20T15:00:00.000Z-15:05:00.000Z, modbus-tcp path
    energy     meters.a.mwh 9180, meters.b.mwh 9041 (integers, milliwatt-hours)
    canonical  519 bytes, starts {"dt_s":300,"meters":{"a":{"class":"dc","id":…
    sha256     58bd772d5034c9a6e2aea23d30cdd0d6728a46a6b524ae375debb94e87973a02
               (Node and Python agree on all 64 hex digits)

The data is the harness's simulated morning on a simulated Modbus bus, and the
footnote says so: no live meter, no real roof. The two laptops are glyphs, not a
claim about hardware: both computations ran on the machine that rendered this
shot, in two languages. What is generated: the background, the laptop glyphs, the
labels, the badge, the motion and the grain. No person, desk, meter, brand mark or
other product's interface is drawn. The audio is a near-silent bed: low room tone,
two soft air swishes (headline, laptops) and a soft two-note tick on the match;
peak about -20 dBFS on the tick, swishes about -30, bed about -40. Music comes in
the edit.

Vertical-platform safe zones are kept clear: the top 120 px, the right 140 px and
the bottom 420 px. Colour is converted and tagged as BT.709.

Writes raw RGB frames to stdout. Needs node, numpy and Pillow. Render from the
repo root with:

    python3 docs/video/shot15-whole-numbers.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1080x1920 -r 30 -i - \\
      -f lavfi -i "anoisesrc=d=9:c=brown:r=48000:a=0.02:seed=15" \\
      -f lavfi -i "anoisesrc=d=0.7:c=pink:r=48000:a=0.1:seed=51" \\
      -f lavfi -i "aevalsrc='0.1*sin(2*PI*784*t)*exp(-30*t)*(1-exp(-2500*t))':d=0.4:s=48000" \\
      -f lavfi -i "aevalsrc='0.09*sin(2*PI*1175*t)*exp(-26*t)*(1-exp(-2500*t))':d=0.4:s=48000" \\
      -filter_complex "[1]lowpass=f=300,afade=t=in:st=0:d=0.3,afade=t=out:st=8.5:d=0.5[bed];\\
    [2]highpass=f=700,lowpass=f=2600,afade=t=in:st=0:d=0.14,afade=t=out:st=0.14:d=0.56,\\
    asplit=2[w0][w1];[w0]adelay=1950:all=1,volume=0.9[w0d];[w1]adelay=2600:all=1,volume=1.0[w1d];\\
    [3]lowpass=f=3000,adelay=6500:all=1[t0];[4]lowpass=f=3500,adelay=6590:all=1[t1];\\
    [bed][w0d][w1d][t0][t1]amix=inputs=5:normalize=0:duration=first[a]" \\
      -map 0:v -map "[a]" -vf scale=out_color_matrix=bt709:out_range=tv \\
      -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -color_primaries bt709 \\
      -color_trc bt709 -colorspace bt709 -movflags +faststart -c:a aac -b:a 192k \\
      -t 9 QWATT-week1-shot15-whole-numbers.mp4
"""
import hashlib
import json
import math
import os
import platform
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FPS = 30
DUR = 9.0
W, H = 1080, 1920
SS = 2  # title, laptops, labels and badge are drawn at 2x; screen text at 1x, in place

ESPRESSO = (22, 16, 10)
PAPER = (250, 248, 242)
TERRACOTTA = (176, 88, 47)
TERRA_LIGHT = (208, 138, 87)
MUTED = (150, 130, 110)
BYTES_INK = (168, 150, 130)  # the canonical bytes line, a step under the values
BAND = (118, 61, 34)  # highlighter: terracotta pressed into the screen
HOT = (246, 214, 186)  # hash text on the band

FS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FMB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# The harness, run unchanged; IntervalBuilder._close is wrapped to keep the records
# the modbus path closes (the wrapper calls the original). The first one is hashed
# with the repo's own canonical() and sha256(). Prints one JSON line on stdout.
RECORD_JS = r"""
const { IntervalBuilder, canonical, sha256 } = require('./ingest/lib/normalize');
const harness = require('./ingest/harness');
const close = IntervalBuilder.prototype._close;
const closed = [];
IntervalBuilder.prototype._close = function (k) {
  const record = close.call(this, k);
  if (this.adapter === 'modbus-tcp') closed.push(record);
  return record;
};
const print = console.log;
console.log = (...a) => console.error(...a);  // the harness's own summary line goes to stderr
harness.run().then((diffs) => {
  if (diffs) throw new Error('harness reported ' + diffs + ' differences');
  const record = closed[0];
  const c = canonical(record);
  print(JSON.stringify({
    record_text: JSON.stringify(record, null, 2), canonical: c,
    bytes: Buffer.byteLength(c, 'utf8'), sha256: sha256(c),
    mwh: { a: record.meters.a.mwh, b: record.meters.b.mwh },
    intervals: closed.length, version: process.versions.node,
  }));
}).catch((e) => { console.error(e); process.exit(1); });
"""

# layout, frame px
CX = 482  # the laptops' centre line; their right edges stay inside the 940 safe line
LEFT = 48
SHOW_HEX = 16

# headline: drawn once at 92 px, then scaled into the title
HEAD_PX, HEAD_PITCH, HEAD_BASE = 92, 104, 90  # size, line pitch, first baseline in the layer
KICK_PX, NOTE_PX = 26, 26
BIG = {"kick": 620, "head": 642, "note": 900}  # kicker / note baselines, headline layer top
SMALL = {"kick": 162, "head": 176, "note": 352}
SMALL_K = 0.65  # headline scale once it is the title

# the two machines: different shapes and finishes, no marks of any brand
LAP_A = dict(name="Node.js", w=810, h=350, x=CX - 405, y=450, r=16, bz=16, bt=18, bb=22,
             chassis=(50, 39, 29), rim=(96, 78, 60), screen=(12, 9, 6), over=34, base_h=22,
             base=(72, 57, 44), base_top=(112, 92, 72), base_front=(44, 34, 25))
LAP_B = dict(name="Python", w=780, h=340, x=CX - 390, y=984, r=30, bz=24, bt=24, bb=24,
             chassis=(120, 109, 96), rim=(158, 146, 130), screen=(26, 19, 13), over=30, base_h=34,
             base=(138, 126, 112), base_top=(172, 160, 144), base_front=(104, 94, 82))
LABEL_GAP = 18  # label baseline sits this far above the lid
BADGE_Y = 880  # badge centre, midway between laptop A's base and B's label
SOURCE_Y = (1420, 1462)  # footnote baselines: the record, then where its data comes from
SOURCE_PX = 30
MARGIN = 50  # transparent border around a laptop layer, room for its shadow

# screen rows, px from the top of the content block (centred in each screen)
ROW_BASE = [38, 76, 140, 198, 258]
BLOCK_H = 272
TEXT_PAD = 28
LABEL_COL = 228  # value column, from the text's left edge

# timings, seconds
KICK_T, HEAD_T, NOTE_T = (0.0, 0.7), (0.12, 0.95), (0.55, 1.2)
HEAD_STEP = 0.12  # second headline line, after the first
RISE_TEXT = 26
MOVE_T = (1.95, 2.65)
MOVE_STAGGER = 1 / FPS  # kicker, line 1, line 2, note leave a frame apart
LAP_T = {"Node.js": (2.6, 3.35), "Python": (2.75, 3.5)}  # once the title has cleared their space
LAP_RISE = 90
SOURCE_T = (3.4, 3.9)
SOURCE_STEP = 2 / FPS  # second footnote line, after the first
HL_T = {"Node.js": (6.40, 6.80), "Python": (6.46, 6.86)}
BADGE_T = (6.5, 6.95)
T_SETTLE = 4.0  # everything but the screens and the badge is at rest from here


def font(path, px):
    return ImageFont.truetype(path, int(round(px * SS)))


def ease(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return 1 - (1 - x) ** 3  # ease-out cubic


def smooth(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return x * x * (3 - 2 * x)


def P(v):
    return int(round(v * SS))


# ── the data: one record, two implementations ─────────────────────────────

def node_side():
    out = subprocess.run(["node", "-e", RECORD_JS], cwd=REPO, check=True,
                         capture_output=True, text=True).stdout
    return json.loads(out)


def js_string(s):
    """A string as JSON.stringify writes it: quote, backslash and C0 controls
    escaped (short forms where JSON has them), lone surrogates as \\uXXXX,
    everything else as itself."""
    short = {0x08: "\\b", 0x09: "\\t", 0x0A: "\\n", 0x0C: "\\f", 0x0D: "\\r",
             0x22: '\\"', 0x5C: "\\\\"}
    out = []
    for ch in s:
        o = ord(ch)
        if o in short:
            out.append(short[o])
        elif o < 0x20 or 0xD800 <= o <= 0xDFFF:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


def canonical(value):
    """docs/ARCHITECTURE-FREEZE.md §1, written independently of the repo's JS:
    keys sorted, no whitespace, integers only. (JSON input has no `undefined`.)"""
    if value is None:
        return "null"
    if value is True or value is False:
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        raise ValueError(f"non-integer number {value!r}: the freeze allows integers only")
    if isinstance(value, str):
        return js_string(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical(v) for v in value) + "]"
    keys = sorted(value, key=lambda k: k.encode("utf-16-be"))  # JavaScript's sort order
    return "{" + ",".join(js_string(k) + ":" + canonical(value[k]) for k in keys) + "}"


def python_side(record_text):
    record = json.loads(record_text)
    raw = canonical(record).encode("utf-8")
    return {"record": record, "canonical": raw, "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "mwh": {k: record["meters"][k]["mwh"] for k in ("a", "b")},
            "version": platform.python_version()}


def load_sides():
    js = node_side()
    py = python_side(js["record_text"])
    rec = py["record"]
    if rec["seq"] != 0 or rec["source"]["adapter"] != "modbus-tcp":
        raise SystemExit("BLOCKER: the first modbus record is not shot 14's (seq 0, modbus-tcp)")
    problems = []
    if py["canonical"] != js["canonical"].encode("utf-8"):
        problems.append("canonical bytes differ")
    if py["bytes"] != js["bytes"]:
        problems.append(f"byte counts differ: node {js['bytes']}, python {py['bytes']}")
    if py["sha256"] != js["sha256"]:
        problems.append(f"sha256 differs: node {js['sha256']}, python {py['sha256']}")
    if py["mwh"] != js["mwh"]:
        problems.append("energies differ")
    if problems:
        raise SystemExit("BLOCKER: Node and Python disagree: " + "; ".join(problems))
    head = {"Node.js": js["canonical"], "Python": py["canonical"].decode("utf-8")}
    return {
        "Node.js": dict(bytes=js["bytes"], head=head["Node.js"], mwh=js["mwh"],
                        sha=js["sha256"], meta=f"v{js['version']} · ingest/lib/normalize.js"),
        "Python": dict(bytes=py["bytes"], head=head["Python"], mwh=py["mwh"],
                       sha=py["sha256"], meta=f"{py['version']} · own canonical() + hashlib"),
        "record": rec,
    }


# ── layers drawn once ─────────────────────────────────────────────────────

def text_layer(parts, h_px):
    """One line of text runs [(text, path, px, colour)] at SS, premultiplied, with
    `h_px` of height; returns the layer and the baseline in layer px / SS."""
    base = round(h_px * 0.78)
    w = sum(font(p, s).getlength(t) for t, p, s, _ in parts) / SS + 8
    img = Image.new("RGBA", (P(w), P(h_px)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x = P(2)
    for t, p, s, c in parts:
        f = font(p, s)
        d.text((x, P(base)), t, font=f, fill=(*c, 255), anchor="ls")
        x += f.getlength(t)
    return img.convert("RGBa"), base


def headline_layers():
    """The two headline lines, each its own layer so they can arrive a few frames apart."""
    f = font(FB, HEAD_PX)
    lines = [[("Energy in ", PAPER), ("whole", TERRA_LIGHT)], [("milliwatt-hours", PAPER)]]
    out = []
    for parts in lines:
        w = sum(f.getlength(t) for t, _ in parts) / SS + 8
        img = Image.new("RGBA", (P(w), P(HEAD_PITCH + 30)), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        x = P(2)
        for t, c in parts:
            d.text((x, P(HEAD_BASE)), t, font=f, fill=(*c, 255), anchor="ls")
            x += f.getlength(t)
        out.append(img.convert("RGBa"))
    assert LEFT + out[0].size[0] / SS < 940 - 20, "headline too wide for the safe area"
    return out


def laptop_layer(L):
    """RGBa laptop at SS with its shadow. The lid's top-left sits at (MARGIN + over,
    MARGIN) in layer px / SS. A: thin dark lid, slim wedge base with a thumb notch.
    B: warm-grey lid with a wide bezel and round corners, hinge band, thick base, feet."""
    w, h, over = L["w"], L["h"], L["over"]
    thin = L["name"] == "Node.js"
    base_y = h if thin else h + 8
    bottom = base_y + L["base_h"]
    ox, oy = MARGIN + over, MARGIN
    lw, lh = P(w + 2 * over + 2 * MARGIN), P(bottom + 2 * MARGIN)

    def X(v):
        return P(ox + v)

    def Y(v):
        return P(oy + v)

    sil = Image.new("L", (lw, lh), 0)
    d = ImageDraw.Draw(sil)
    d.rounded_rectangle([X(0), Y(0), X(w), Y(h)], radius=P(L["r"]), fill=255)
    d.rounded_rectangle([X(-over), Y(base_y), X(w + over), Y(bottom)], radius=P(10), fill=255)
    shadow = Image.new("L", (lw, lh), 0)
    shadow.paste(sil, (0, P(16)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(P(18)))
    contact = Image.new("L", (lw, lh), 0)  # where the base meets the ground
    ImageDraw.Draw(contact).ellipse([X(-over + 10), Y(bottom - 6), X(w + over - 10), Y(bottom + 16)],
                                    fill=255)
    contact = contact.filter(ImageFilter.GaussianBlur(P(8)))

    img = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    black = Image.new("RGBA", (lw, lh), (0, 0, 0, 255))
    img.paste(black, (0, 0), shadow.point(lambda v: int(v * 0.55)))
    img.paste(black, (0, 0), contact.point(lambda v: int(v * 0.5)))
    d = ImageDraw.Draw(img)

    # lid: rim, then chassis, then the screen glass with a faint top-down falloff
    d.rounded_rectangle([X(0), Y(0), X(w), Y(h)], radius=P(L["r"]), fill=(*L["rim"], 255))
    d.rounded_rectangle([X(0) + P(1.5), Y(0) + P(1.5), X(w) - P(1.5), Y(h) - P(1.5)],
                        radius=P(L["r"] - 1.5), fill=(*L["chassis"], 255))
    sx0, sy0, sx1, sy1 = L["bz"], L["bt"], w - L["bz"], h - L["bb"]
    glass = Image.new("L", (lw, lh), 0)
    ImageDraw.Draw(glass).rounded_rectangle([X(sx0), Y(sy0), X(sx1), Y(sy1)],
                                            radius=P(6 if thin else 12), fill=255)
    ramp = np.linspace(1, 0, Y(sy1) - Y(sy0))[:, None, None] ** 1.5
    tint = np.zeros((lh, lw, 3), np.float32) + np.array(L["screen"], np.float32)
    tint[Y(sy0):Y(sy1)] += ramp * np.array([9, 7, 5], np.float32)
    img.paste(Image.fromarray(tint.astype(np.uint8), "RGB").convert("RGBA"), (0, 0), glass)
    cam_r, cam_y = (3, L["bt"] / 2) if thin else (4.5, L["bt"] / 2)
    d.ellipse([X(w / 2 - cam_r), Y(cam_y - cam_r), X(w / 2 + cam_r), Y(cam_y + cam_r)],
              fill=(*(tuple(int(c * 0.55) for c in L["chassis"])), 255))

    if thin:
        # slim wedge base: lit top edge, darker front, a thumb notch in the middle
        d.rounded_rectangle([X(-over), Y(base_y), X(w + over), Y(bottom)], radius=P(10),
                            fill=(*L["base_front"], 255))
        d.rounded_rectangle([X(-over), Y(base_y), X(w + over), Y(base_y + 12)], radius=P(6),
                            fill=(*L["base"], 255))
        d.line([(X(-over + 8), Y(base_y) + P(1)), (X(w + over - 8), Y(base_y) + P(1))],
               fill=(*L["base_top"], 255), width=P(2))
        d.rounded_rectangle([X(w / 2 - 66), Y(base_y) - P(1), X(w / 2 + 66), Y(base_y + 6)],
                            radius=P(3), fill=(*L["base_front"], 255))
    else:
        # hinge band, thick base with a lit top face and a darker front, two feet
        d.rounded_rectangle([X(56), Y(h - 6), X(w - 56), Y(base_y + 4)], radius=P(5),
                            fill=(62, 54, 46, 255))
        d.rounded_rectangle([X(-over), Y(base_y), X(w + over), Y(bottom)], radius=P(12),
                            fill=(*L["base_front"], 255))
        d.rounded_rectangle([X(-over), Y(base_y), X(w + over), Y(base_y + 16)], radius=P(8),
                            fill=(*L["base"], 255))
        d.line([(X(-over + 12), Y(base_y) + P(1)), (X(w + over - 12), Y(base_y) + P(1))],
               fill=(*L["base_top"], 255), width=P(2))
        for fx in (40, w - 100):
            d.rounded_rectangle([X(fx), Y(bottom - 2), X(fx + 60), Y(bottom + 5)], radius=P(3),
                                fill=(70, 62, 54, 255))
    inner = (L["x"] + sx0, L["y"] + sy0, sx1 - sx0, sy1 - sy0)  # frame px: x, y, w, h
    return img.convert("RGBa"), inner


def label_layer(L, meta):
    f_name, f_meta = font(FB, 36), font(FM, 24)
    nw = f_name.getlength(L["name"]) / SS
    w = 26 + nw + 18 + f_meta.getlength(meta) / SS + 8
    img = Image.new("RGBA", (P(w), P(56)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    base = 42
    sq = 12
    d.rectangle([P(2), P(base - 26), P(2 + sq), P(base - 26 + sq)], fill=(*TERRACOTTA, 255))
    d.text((P(26), P(base)), L["name"], font=f_name, fill=(*PAPER, 255), anchor="ls")
    d.text((P(26 + nw + 18), P(base)), meta, font=f_meta, fill=(*MUTED, 255), anchor="ls")
    assert L["x"] + w < 940, "label runs into the right safe zone"
    return img.convert("RGBa"), base


def badge_layer():
    """Terracotta pill: a paper disc with a terracotta '=', then the words."""
    text = "same bytes, same hash"
    f = font(FB, 32)
    tw = f.getlength(text) / SS
    ph, disc = 74, 52
    pw = 11 + disc + 18 + tw + 30
    m = 30
    lw, lh = P(pw + 2 * m), P(ph + 2 * m)
    sil = Image.new("L", (lw, lh), 0)
    ImageDraw.Draw(sil).rounded_rectangle([P(m), P(m), P(m + pw), P(m + ph)], radius=P(ph / 2),
                                          fill=255)
    shadow = Image.new("L", (lw, lh), 0)
    shadow.paste(sil, (0, P(8)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(P(12))).point(lambda v: int(v * 0.6))
    img = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    img.paste(Image.new("RGBA", (lw, lh), (0, 0, 0, 255)), (0, 0), shadow)
    img.paste(Image.new("RGBA", (lw, lh), (*TERRACOTTA, 255)), (0, 0), sil)
    d = ImageDraw.Draw(img)
    cx, cy = m + 11 + disc / 2, m + ph / 2
    d.ellipse([P(cx - disc / 2), P(cy - disc / 2), P(cx + disc / 2), P(cy + disc / 2)],
              fill=(*PAPER, 255))
    for dy in (-7, 7):  # the '=' as two bars, crisper than a glyph
        d.rounded_rectangle([P(cx - 13), P(cy + dy - 3.5), P(cx + 13), P(cy + dy + 3.5)],
                            radius=P(2), fill=(*TERRACOTTA, 255))
    d.text((P(m + 11 + disc + 18), P(cy)), text, font=f, fill=(*PAPER, 255), anchor="lm")
    return img.convert("RGBa"), m, pw, ph


def background():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    lift = np.exp(-(((xx - CX) / 760) ** 2 + ((yy - 880) / 1000) ** 2))
    r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    img = np.array(ESPRESSO, np.float32) + lift[..., None] * np.array([12, 9, 6], np.float32)
    return img * (1 - 0.22 * np.clip(r2, 0, 1.6) ** 1.3)[..., None]


def place(frame, im, x, y, k, alpha=1.0, blur=0.0):
    """Composite a premultiplied (RGBa) layer with its top-left at (x, y) frame px,
    scaled by k frame px per layer px. Subpixel exact: the resample box carries the
    fraction. blur: vertical motion blur, px covered while the shutter is open."""
    if alpha <= 0:
        return
    lw, lh = im.size
    ix0, iy0 = math.ceil(x), math.ceil(y)
    ix1, iy1 = math.floor(x + lw * k), math.floor(y + lh * k)
    box = ((ix0 - x) / k, (iy0 - y) / k, (ix1 - x) / k, (iy1 - y) / k)
    a = np.asarray(im.resize((ix1 - ix0, iy1 - iy0), Image.LANCZOS, box=box), np.float32)
    a = a * (alpha / 255.0)
    n = int(round(blur))
    if n >= 2:  # vertical box over the distance covered while the shutter is open
        p = np.pad(a, ((n, n), (0, 0), (0, 0)))
        c = np.concatenate([np.zeros_like(p[:1]), np.cumsum(p, axis=0)], axis=0)
        a = (c[n:] - c[:-n]) / n
        iy0 -= (n + 1) // 2
    blit(frame, a, ix0, iy0)


def blit(frame, a, x, y):
    """Premultiplied float layer (0-255 colour, 0-1 alpha) over the frame at integer x, y."""
    h, w = a.shape[:2]
    fx0, fy0, fx1, fy1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if fx1 <= fx0 or fy1 <= fy0:
        return
    a = a[fy0 - y:fy1 - y, fx0 - x:fx1 - x]
    dst = frame[fy0:fy1, fx0:fx1]
    dst *= 1 - a[..., 3:]
    dst += a[..., :3] * 255.0


# ── the screens ───────────────────────────────────────────────────────────

class Screen:
    """What one laptop shows: five rows that fill in at that machine's own rhythm.
    Each row is runs of (x, text, font, colour, mode): 'show' appears when the row
    starts, 'type' arrives a character at a time, 'after' appears with the last
    typed character."""

    F = {"head": (FM, 26), "bytes": (FM, 24), "label": (FM, 28), "val": (FMB, 46),
         "unit": (FM, 28), "hash": (FMB, 42)}

    def __init__(self, side, inner, starts, rates, seed, hl_t):
        self.x, self.y, self.w, self.h = inner
        self.fonts = {k: ImageFont.truetype(p, s) for k, (p, s) in self.F.items()}
        self.top = (self.h - BLOCK_H) / 2
        tx = TEXT_PAD
        vx = tx + LABEL_COL
        adv = self.fonts["bytes"].getlength("0")
        room = int((self.w - 2 * TEXT_PAD) // adv)
        head = side["head"][:room - 1] + "…" if len(side["head"]) > room else side["head"]
        unit_x = lambda v: vx + self.fonts["val"].getlength(v)
        a, b = str(side["mwh"]["a"]), str(side["mwh"]["b"])
        self.rows = [
            [(tx, f"canonical JSON · {side['bytes']} bytes", "head", MUTED, "show")],
            [(tx, head, "bytes", BYTES_INK, "type")],
            [(tx, "meters.a.mwh", "label", MUTED, "show"), (vx, a, "val", PAPER, "type"),
             (unit_x(a), " mWh", "unit", MUTED, "after")],
            [(tx, "meters.b.mwh", "label", MUTED, "show"), (vx, b, "val", PAPER, "type"),
             (unit_x(b), " mWh", "unit", MUTED, "after")],
            [(tx, "sha256", "label", MUTED, "show"),
             (vx, side["sha"][:SHOW_HEX] + "…", "hash", TERRA_LIGHT, "type")],
        ]
        assert vx + self.fonts["hash"].getlength("0" * (SHOW_HEX + 1)) < self.w - 12, "hash row too wide"
        rng = np.random.default_rng(seed)
        self.starts, self.times = starts, []
        for row, t0, rate in zip(self.rows, starts, rates):
            n = sum(len(r[1]) for r in row if r[4] == "type")
            gaps = (0.55 + 0.9 * rng.random(n)) / rate if rate else np.zeros(n)
            self.times.append(t0 + 0.07 + np.cumsum(gaps))  # first character a moment after the label
        self.done = float(self.times[-1][-1])
        self.hl_t = hl_t

    def state(self, t):
        """Characters showing in each typed row, and where the cursor sits."""
        counts = [int(np.searchsorted(ts, t, side="right")) for ts in self.times]
        cur = None
        for i, row in enumerate(self.rows):
            if t < self.starts[i]:
                break
            n = counts[i]
            for x, text, fk, _, mode in row:
                if mode == "type":
                    k = min(n, len(text))
                    cur = (x + self.fonts[fk].getlength(text[:k]), i, fk)
                    n -= k
                elif mode == "after" and counts[i] == len(self.times[i]):
                    cur = (x + self.fonts[fk].getlength(text), i, fk)
        return counts, cur

    def render(self, t, hl):
        img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        counts, cur = self.state(t)
        self._draw(img, t, counts, hot=False)
        if hl > 0:  # highlighter wipes the hash row left to right
            hot = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
            self._draw(hot, t, counts, hot=True)
            y0, y1 = self._band()
            xs = np.arange(self.w, dtype=np.float32)
            feather = 50.0
            thr = 8 + hl * (self.w - 16 + feather)
            m = np.clip((thr - xs) / feather, 0, 1)[None, :, None]
            p = np.asarray(img, np.float32)
            q = np.asarray(hot, np.float32)
            p[y0:y1] = p[y0:y1] + (q[y0:y1] - p[y0:y1]) * m
            img = Image.fromarray(np.clip(p + 0.5, 0, 255).astype(np.uint8), "RGBA")
        if cur is not None:
            idle = t - self.done - 0.25  # solid while filling in, then a slow blink
            on = idle <= 0 or idle % 1.0 < 0.55
            fade = 1 - smooth(self.hl_t[0], self.hl_t[0] + 0.2, t)
            if on and fade > 0:
                x, i, fk = cur
                f = self.fonts[fk]
                size = self.F[fk][1]
                base = self.top + ROW_BASE[i]
                d = ImageDraw.Draw(img)
                d.rectangle([x + 3, base - size * 0.74, x + 3 + f.getlength("0") * 0.62, base + size * 0.12],
                            fill=(*TERRA_LIGHT, int(210 * fade)))
        return img

    def _band(self):
        base = self.top + ROW_BASE[4]
        return int(base - 42), int(base + 16)

    def _draw(self, img, t, counts, hot):
        d = ImageDraw.Draw(img)
        if hot:
            y0, y1 = self._band()
            d.rectangle([8, y0, self.w - 8, y1], fill=(*BAND, 255))
            d.rectangle([8, y0, 14, y1], fill=(*TERRACOTTA, 255))
        for i, row in enumerate(self.rows):
            if t < self.starts[i]:
                continue
            fa = smooth(self.starts[i], self.starts[i] + 0.1, t)  # labels settle in over 3 frames
            n = counts[i]
            base = self.top + ROW_BASE[i]
            for x, text, fk, col, mode in row:
                if mode == "type":
                    k = min(n, len(text))
                    n -= k
                    text, a = text[:k], 255
                elif mode == "after":
                    a = 255 if counts[i] == len(self.times[i]) else 0
                else:
                    a = int(255 * fa)
                if not text or a == 0:
                    continue
                if hot and i == 4:
                    col = PAPER if mode == "show" else HOT
                d.text((x, base), text, font=self.fonts[fk], fill=(*col, a), anchor="ls")


def premul(img):
    a = np.asarray(img, np.float32)
    out = a.copy()
    out[..., 3] = a[..., 3] / 255.0
    out[..., :3] = a[..., :3] * out[..., 3:] / 255.0
    return out


# ── frames ────────────────────────────────────────────────────────────────

def main():
    data = load_sides()
    rec = data["record"]
    heads = headline_layers()
    kick, kick_base = text_layer([("docs/ARCHITECTURE-FREEZE.md §1", FM, KICK_PX, TERRA_LIGHT)], 40)
    note, note_base = text_layer([("1 QWATT = 1 MWh = 1,000,000,000 mWh", FM, NOTE_PX, MUTED)], 40)
    t0, t1 = rec["ts_start"], rec["ts_end"]
    sources = [text_layer([(s, FS, SOURCE_PX, MUTED)], 44) for s in (
        f"interval seq {rec['seq']} · {t0[:10]} {t0[11:16]}–{t1[11:16]} UTC",
        "simulated test data")]
    assert all(LEFT + im.size[0] / SS < 940 for im, _ in sources), "footnote runs into the right safe zone"
    badge, b_m, b_w, b_h = badge_layer()

    laps = {}
    for L, starts, rates, seed in (
            (LAP_A, (3.35, 3.50, 4.00, 4.42, 4.85), (0, 150, 18, 18, 22), 151),
            (LAP_B, (3.50, 3.65, 4.17, 4.62, 5.07), (0, 120, 16, 16, 20), 152)):
        side = data[L["name"]]
        layer, inner = laptop_layer(L)
        lab, lab_base = label_layer(L, side["meta"])
        scr = Screen(side, inner, starts, rates, seed, HL_T[L["name"]])
        assert starts[0] >= LAP_T[L["name"]][1], "screen fills before the laptop has landed"
        assert scr.done < scr.hl_t[0] - 0.3, "screen still typing when the highlight starts"
        laps[L["name"]] = dict(L=L, layer=layer, lab=lab, lab_base=lab_base, scr=scr)

    bg = background()
    rng = np.random.default_rng(15)
    cache = None

    for i in range(int(DUR * FPS)):
        t = i / FPS
        if cache is not None:
            frame = cache.copy()
        else:
            frame = bg.copy()
            # kicker, headline lines, unit note: rise in, then glide up into the title
            for j, (a0, a1) in enumerate((KICK_T, HEAD_T, (HEAD_T[0] + HEAD_STEP, HEAD_T[1] + HEAD_STEP),
                                          NOTE_T)):
                e = ease(a0, a1, t)
                if e <= 0:
                    continue
                m = smooth(MOVE_T[0] + j * MOVE_STAGGER, MOVE_T[1] + j * MOVE_STAGGER, t)
                mp = smooth(MOVE_T[0] + j * MOVE_STAGGER, MOVE_T[1] + j * MOVE_STAGGER, t - 1 / FPS)
                rise = RISE_TEXT * (1 - e)
                v_rise = RISE_TEXT * (ease(a0, a1, t) - ease(a0, a1, t - 1 / FPS))
                if j in (1, 2):
                    k = 1 + (SMALL_K - 1) * m
                    top = BIG["head"] + (SMALL["head"] - BIG["head"]) * m
                    top_p = BIG["head"] + (SMALL["head"] - BIG["head"]) * mp
                    y = top + (j - 1) * HEAD_PITCH * k + rise
                    v = abs(top - top_p) + v_rise
                    place(frame, heads[j - 1], LEFT - 2 * k, y, k / SS, alpha=smooth(a0, a0 + 0.4, t),
                          blur=0.5 * v)
                else:
                    im, b, key = (kick, kick_base, "kick") if j == 0 else (note, note_base, "note")
                    base = BIG[key] + (SMALL[key] - BIG[key]) * m
                    v = abs(SMALL[key] - BIG[key]) * (m - mp) + v_rise
                    place(frame, im, LEFT - 2, base - b + rise, 1 / SS, alpha=smooth(a0, a0 + 0.4, t),
                          blur=0.5 * v)

            # laptops and their labels rise in, a few frames apart
            for name, lp in laps.items():
                L = lp["L"]
                a0, a1 = LAP_T[name]
                e = ease(a0, a1, t)
                if e <= 0:
                    continue
                v = LAP_RISE * (ease(a0, a1, t) - ease(a0, a1, t - 1 / FPS))
                dy = LAP_RISE * (1 - e)
                al = smooth(a0, a0 + 0.4, t)
                place(frame, lp["lab"], L["x"] - 2, L["y"] - LABEL_GAP - lp["lab_base"] + dy, 1 / SS,
                      alpha=al, blur=0.5 * v)
                place(frame, lp["layer"], L["x"] - L["over"] - MARGIN, L["y"] - MARGIN + dy, 1 / SS,
                      alpha=al, blur=0.5 * v)

            # footnote: the record and where the data comes from
            for j, ((im, b), y) in enumerate(zip(sources, SOURCE_Y)):
                a = smooth(SOURCE_T[0] + j * SOURCE_STEP, SOURCE_T[1] + j * SOURCE_STEP, t)
                if a > 0:
                    place(frame, im, LEFT - 2, y - b + 10 * (1 - a), 1 / SS, alpha=a)
            if t >= T_SETTLE:
                cache = frame.copy()

        # the screens fill in, then the hash lines are marked
        for name, lp in laps.items():
            scr = lp["scr"]
            if t < scr.starts[0]:
                continue
            hl = smooth(*HL_T[name], t)
            blit(frame, premul(scr.render(t, hl)), scr.x, scr.y)

        # the match badge, between the two machines
        be = ease(*BADGE_T, t)
        if be > 0:
            k = 0.88 + 0.12 * be
            bw, bh = (b_w + 2 * b_m) * k, (b_h + 2 * b_m) * k
            place(frame, badge, CX - bw / 2, BADGE_Y - bh / 2, k / SS, alpha=smooth(BADGE_T[0], BADGE_T[0] + 0.3, t))

        frame += rng.standard_normal((H, W, 1), dtype=np.float32) * 2.2  # film grain
        sys.stdout.buffer.write(np.clip(frame + 0.5, 0, 255).astype(np.uint8).tobytes())


if __name__ == "__main__":
    main()
