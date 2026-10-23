"""QWATT week 1 video, shot 19 (2:15-2:40 and 2:51-2:55), vertical 1080x1920:
transparent overlays over Jay's real rooftop footage ("Where this goes") and over
the closing two-shot of Jay and Diego.

The footage is real and has to be filmed (vertically); this renders only what goes
over it. Jay's face sits in the upper third, so every overlay lives in the middle
band, about y 985-1490 and x 72-930 including the panels' soft edges: clear of the
face, of the top 120 px, of the right 140 px and of the bottom 420 px (platform
title and our burned-in captions). The look is the vertical lower third of shots
2 and 8: a terracotta bar at x = 72 that grows from its middle, a soft translucent
espresso panel (150/255) wiped in left to right, paper text, a little film grain.
One script, four overlays:

  roadmap-week2  2:15-2:22, 7.0 s. Jay: "Next week, every record gets chained to
                 the one before it, so nobody can quietly rewrite the past."
                 Roadmap strip Week 1 · Week 2 · Week 3 · Week 4 rises in (0.1-0.9 s),
                 Week 1 gets its terracotta check (0.58 s), Week 2 lights up
                 (0.80 s), the caption "Records chained by hash" wipes in (1.0 s),
                 then three small blocks link up one after the other (1.55, 1.75,
                 1.95 s). Out over the last 0.4 s.
  rejection      2:22-2:30, 8.0 s. Jay: "And we'll publish the rejections, not just
                 the passes, because a checker that only shows its wins hasn't
                 proven anything." A real rejection from the gate engine: the
                 verdict, the failing gate, its reason code and message, the four
                 gates' results, the test input, and the spec version and digest
                 (in 0.05-1.6 s, out over the last 0.4 s).
  roadmap-week3  2:30-2:40, 10.0 s. Jay: "In week three, records go onto Stellar's
                 test network, and it will take two independent signatures to write
                 one." The same strip, Week 3 lights up (0.80 s), caption "Anchored on
                 Stellar testnet" (1.0 s), a TESTNET tag (1.3 s); two empty signature
                 slots and the label "2 independent signatures (week 3)" (3.7 s), the
                 first key fills its slot at 4.0 s, the second at 5.0 s. Out over the
                 last 0.4 s.
  endcard        2:51-2:55, 4.0 s, over the two-shot: the QWATT logo, qwatt.org,
                 github.com/academiaseul/QWATT and a TESTNET tag, in the lower middle
                 (y 1144-1472). The panel fades in over 0.8 s and its content settles
                 in on it at the panel's own fade, staggered, the last landing at
                 0.8 s; then it holds to the last frame: the edit cuts from it to the
                 closing meter shot at 2:55.
  data           not a picture: runs the gate engine with node and prints the JSON
                 kept as shot19-rejection.data.json next to this file.

What is real. The rejection card shows only what the engine returned. node runs
assets/qwatt-gates.js (engine 1.1.0) with the thresholds in assets/gates.generated.js
(spec 1.0.0, digest 056f1b51...) on case "bench-night-generation" of
protocol/conformance/cases.json, merged over its profile defaults exactly as
protocol/conformance.test.js does. That case is the CI conformance case for the
demo page's "Generar de noche" preset (qwatt.org/verificacion, same values): meters
A 8000 mWh and B 7900 mWh for 02:00-02:05 UTC on 21 Sep 2026, which is 23:00 in
Santiago (the bench profile's time zone, UTC-3 that night), with the sun at
-41.11 deg. The engine rejects it at G2, "Solar elevation", code elevation.night,
and passes G0, G1 and G3. The message is the spec's English text for that code,
filled in by the engine's own format() with nothing re-rounded, so the minus signs
are the ASCII ones the engine prints. REJECTED is how the card writes the verdict
"reject"; the badge is result.spec_version and the first 8 hex digits of
result.spec_digest. The JSON also keeps the SHA-256 of the three input files, and
the rejection render refuses to start unless node, run again, gives exactly the
saved output and the case's own expected verdict, failing gates and codes. It is a
test input, not a meter reading, and the card says TEST CASE.

What is drawn, not data. The roadmap follows docs/SOW-INSTAWARD-v3.md section 4
(week 1 meter-agnostic ingestion, shipped, see docs/DELIVERABLE-1-EVIDENCE.md;
week 2 evidence batches and hash chain; week 3 multi-party authorization on Stellar
testnet, medium threshold 2-of-3, docs/ARCHITECTURE-FREEZE.md section 8; week 4
public feed). Only week 1 carries a check; weeks 2-4 are upcoming, and the
signatures are labelled week 3, future, never as done. The three blocks are a motif
with no hash or value in them. Key, check and cross icons are generic. The end card's
address and repo come from docs/WEEK1-VIDEO-SCRIPT.md; the repo is public (see
shot17-ci.data.json). The logo is keyed from logo.png as in shot 6: each pixel is
unmixed into navy and terracotta ink coverage, the navy is recoloured to paper so it
reads on the panel, the bolt keeps its own colour, and the mark is scaled by one
factor on both axes. No person, hand, meter or other company's logo or interface.
No audio: Jay's live sound carries these, music comes in the edit.

Colour is converted and tagged as BT.709. Writes raw RGBA frames to stdout. Needs
numpy and Pillow, and node for `rejection` and `data`. Render from the repo root with:

    python3 docs/video/shot19-overlays.py data > docs/video/shot19-rejection.data.json
    python3 docs/video/shot19-overlays.py roadmap-week2 | ffmpeg -y -f rawvideo \\
      -pix_fmt rgba -s 1080x1920 -r 30 -i - -vf scale=out_color_matrix=bt709:out_range=tv \\
      -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -colorspace bt709 \\
      -color_primaries bt709 -color_trc bt709 QWATT-week1-shot19-roadmap-week2.mov
    python3 docs/video/shot19-overlays.py rejection | ffmpeg -y -f rawvideo \\
      -pix_fmt rgba -s 1080x1920 -r 30 -i - -vf scale=out_color_matrix=bt709:out_range=tv \\
      -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -colorspace bt709 \\
      -color_primaries bt709 -color_trc bt709 QWATT-week1-shot19-rejection.mov
    python3 docs/video/shot19-overlays.py roadmap-week3 | ffmpeg -y -f rawvideo \\
      -pix_fmt rgba -s 1080x1920 -r 30 -i - -vf scale=out_color_matrix=bt709:out_range=tv \\
      -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -colorspace bt709 \\
      -color_primaries bt709 -color_trc bt709 QWATT-week1-shot19-roadmap-week3.mov
    python3 docs/video/shot19-overlays.py endcard | ffmpeg -y -f rawvideo \\
      -pix_fmt rgba -s 1080x1920 -r 30 -i - -vf scale=out_color_matrix=bt709:out_range=tv \\
      -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -colorspace bt709 \\
      -color_primaries bt709 -color_trc bt709 QWATT-week1-shot19-endcard.mov
"""
import datetime
import functools
import json
import math
import os
import subprocess
import sys
from zoneinfo import ZoneInfo

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FPS = 30
W, H = 1080, 1920

ESPRESSO = (22, 16, 10)
COFFEE = (41, 29, 19)
PAPER = (250, 248, 242)
TERRACOTTA = (176, 88, 47)
TERRA_LIGHT = (208, 138, 87)

FS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FMB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(HERE, "shot19-rejection.data.json")
LOGO_PNG = os.path.join(REPO, "logo.png")
CASE_ID = "bench-night-generation"  # protocol/conformance/cases.json; the demo's night preset
ENGINE_FILES = ("assets/qwatt-gates.js", "assets/gates.generated.js",
                "protocol/conformance/cases.json")

# Vertical safe zones: the platform UI and our burned-in captions own these bands
SAFE_TOP, SAFE_RIGHT, SAFE_BOTTOM = 120, 140, 420
LOWEST = H - SAFE_BOTTOM - 10  # 1490: nothing drawn below this
RIGHTMOST = W - SAFE_RIGHT  # 940
BAND = (980, 1480)  # Jay's face is above it, the captions below it

# The vertical lower-third look (shot 8): bar, soft panel, paper text
BAR_X, BAR_W = 72, 12
BAR_INSET = 8  # the bar stops this far inside the panel's top and bottom
CONTENT_X = 120  # left edge of the text
PANEL_RIGHT = 926  # roadmap and rejection share one panel width
PANEL_A = 150 / 255
PANEL_BLUR = 2.0  # sigma of the panel's soft edge, which reaches ~3 sigma
GRAIN = 1.6  # film grain on everything drawn, levels of 255
RX0, RY0, RX1, RY1 = 40, 960, 980, 1500  # the region every overlay is drawn in
ICON_SS = 4  # icons and shapes are drawn 4x finer, then reduced

# arrivals and exits
RISE = 12  # px a row rises while it fades and wipes in
ROW_LEN = 0.40  # s
STAGGER = 3 / FPS
WIPE_SOFT = 70  # px, the soft edge of a left-to-right reveal
POP_LEN = 0.30  # s, an icon scaling from 0.8 to 1
OUT_LEN = 0.40  # s, the roadmap and rejection overlays leave over their last 0.4 s
OUT_DROP = 10  # px they sink while they fade

DURATION = {"roadmap-week2": 7.0, "rejection": 8.0, "roadmap-week3": 10.0, "endcard": 4.0}

# ── roadmap (modes a and c) ──
ROADMAP = {"roadmap-week2": (2, "Records chained by hash"),
           "roadmap-week3": (3, "Anchored on Stellar testnet")}
RM_TOP, RM_BOTTOM = 996, 1386
EYEBROW_BASE = 1046
NODE_Y, NODE_R, CELL = 1104, 17, 200  # week k's node centre: CONTENT_X + NODE_R + k * CELL
LABEL_BASE = 1172
CAPTION_BASE = 1252
BLOCK_TOP, BLOCK_W, BLOCK_H, BLOCK_GAP = 1290, 84, 58, 58  # the chain motif (a)
KEY_Y, KEY_R, KEY_GAP = 1322, 30, 12  # the signature slots (c)
KEY_LABEL = "2 independent signatures (week 3)"
EYEBROW_PX = 28
PILL_RIGHT, PILL_PX = 890, 30  # the TESTNET tag, right-aligned on the eyebrow line
BAR_T, PANEL_T = (0.10, 0.45), (0.15, 0.65)
EYEBROW_T, NODE_T, LABEL_T = 0.24, 0.30, 0.36
CHECK_T = (0.58, 0.78)  # week 1's check draws
HIGHLIGHT_T = (0.80, 1.05)  # the week Jay is talking about lights up
CAPTION_T = 1.00
BLOCK_T = (1.55, 1.75, 1.95)  # each block lands; the link to it draws as it does
PILL_T = 1.30
SLOT_T = 3.70
KEY_T = (4.00, 5.00)

# ── rejection (mode b) ──
RJ_TOP, RJ_BOTTOM = 990, 1478
RJ_EYEBROW_BASE = 1036
VERDICT_BASE, VERDICT_DISC = 1126, (148, 1104, 28)  # disc centre x, y and radius
GATE_BASE = 1190
MSG_BASE, MSG_LEAD, MSG_PX = 1252, 44, 34
CHIPS_Y, CHIP_R, CHIP_STEP = 1344, 15, 116
RULE_Y = 1380
INPUT_BASE, SPEC_BASE = 1420, 1458
RJ_BAR_T, RJ_PANEL_T = (0.05, 0.40), (0.10, 0.60)
RJ_T = dict(eyebrow=0.22, disc=0.32, glyph=(0.46, 0.66), verdict=0.36, gate=0.50, code=0.56,
            msg=0.64, chips=0.92, rule=1.10, input=1.14, spec=1.20)
WORD = {"reject": "REJECTED"}  # load_rejection() admits only the case's expected reject

# ── end card (mode d) ──
EC_TOP, EC_BOTTOM = 1144, 1472
LOGO_H, LOGO_Y = 128, 1172  # the mark's height and top; its width follows the source
URL_BASE, REPO_BASE, EC_PILL_TOP = 1259, 1366, 1392
EC_PILL_PX = 33  # the only testnet marking on the end card: big enough to read on a phone
SITE, REPO_URL = "qwatt.org", "github.com/academiaseul/QWATT"
EC_FADE = 0.8  # the panel fades in over this
EC_T = dict(logo=0.10, url=0.17, repo=0.23, pill=0.30)  # its content settles in on it,
EC_ROW_LEN = EC_FADE - EC_T["pill"]  # each over 0.5 s, the last landing at EC_FADE
EC_BAR_T = (0.0, 0.5)


def ease(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return 1 - (1 - x) ** 3  # ease-out cubic


def smooth(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return x * x * (3 - 2 * x)


def ease_v(a, b, t, dist):
    """Speed of an ease-out cubic move of dist px, in px per frame."""
    x = (t - a) / (b - a)
    return 0.0 if not 0 <= x < 1 else 3 * (1 - x) ** 2 * dist / ((b - a) * FPS)


def smooth_v(a, b, t, dist):
    """Speed of a smoothstep move of dist px, in px per frame."""
    x = (t - a) / (b - a)
    return 0.0 if not 0 <= x < 1 else 6 * x * (1 - x) * dist / ((b - a) * FPS)


@functools.lru_cache(maxsize=None)
def font(path, px):
    return ImageFont.truetype(path, px)


# ── drawing: premultiplied float patches ──────────────────────────────────

def paint(w, h, layers):
    """Composite (coverage mask, colour, opacity) layers, in order, into a
    premultiplied RGBA float patch."""
    pm = np.zeros((h, w, 4), np.float32)
    for mask, col, op in layers:
        a = mask * op
        pm *= 1 - a[..., None]
        pm[..., :3] += a[..., None] * (np.asarray(col, np.float32) / 255)
        pm[..., 3] += a
    return pm


def mask(w, h, draw, ss=ICON_SS):
    """Coverage of shapes drawn ss times larger (draw(d, k) scales by k), box-reduced."""
    m = Image.new("L", (w * ss, h * ss), 0)
    draw(ImageDraw.Draw(m), ss)
    return np.asarray(m.reduce(ss), np.float32) / 255


def text_patch(spans, track=0, pad=14):
    """One line in one or more fonts and colours, spans of (text, font, px, colour,
    opacity), with track px between letters. Returns (patch, dx, dy): the
    baseline-left point of the line inside the patch."""
    fs = [font(f, px) for _, f, px, _, _ in spans]
    asc = max(f.getmetrics()[0] for f in fs)
    dsc = max(f.getmetrics()[1] for f in fs)
    widths = [sum(f.getlength(c) + track for c in s) - track if track else f.getlength(s)
              for (s, *_), f in zip(spans, fs)]
    w, h = int(math.ceil(sum(widths) + track * (len(spans) - 1))) + 2 * pad, asc + dsc + 2 * pad
    layers, x = [], pad
    for (s, _, _, col, op), f, sw in zip(spans, fs, widths):
        m = Image.new("L", (w, h), 0)
        d = ImageDraw.Draw(m)
        if track:
            cx = x
            for c in s:
                d.text((cx, pad + asc), c, font=f, fill=255, anchor="ls")
                cx += f.getlength(c) + track
        else:
            d.text((x, pad + asc), s, font=f, fill=255, anchor="ls")
        layers.append((np.asarray(m, np.float32) / 255, col, op))
        x += sw + track
    return paint(w, h, layers), pad, pad + asc


def text_width(spans, track=0):
    return sum((sum(font(f, px).getlength(c) + track for c in s) - track) if track
               else font(f, px).getlength(s) for s, f, px, _, _ in spans)


def wrap(text, f, px, width):
    """Greedy word wrap to width px."""
    lines, cur = [], ""
    for word in text.split(" "):
        nxt = f"{cur} {word}".strip()
        if cur and font(f, px).getlength(nxt) > width:
            lines.append(cur)
            cur = word
        else:
            cur = nxt
    return lines + [cur]


def partial(strokes, p):
    """The first p (0-1) of a set of polylines, by length (as shot 17)."""
    segs = [(a, b) for s in strokes for a, b in zip(s, s[1:])]
    left, out = p * sum(math.dist(a, b) for a, b in segs), []
    for s in strokes:
        pts = [s[0]]
        for a, b in zip(s, s[1:]):
            if left <= 0:
                break
            L = math.dist(a, b)
            k = min(1.0, left / L)
            pts.append((a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k))
            left -= L
        if len(pts) > 1:
            out.append(pts)
    return out


def stroke(d, strokes, width):
    for pts in strokes:
        d.line(pts, fill=255, width=int(round(width)), joint="curve")
        for x, y in (pts[0], pts[-1]):  # round caps
            d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=255)


GLYPHS = {  # in units of the disc radius, centre (0, 0)
    "check": ([[(-0.42, 0.02), (-0.12, 0.32), (0.44, -0.30)]], 0.20),
    "cross": ([[(-0.30, -0.30), (0.30, 0.30)], [(0.30, -0.30), (-0.30, 0.30)]], 0.19),
}


@functools.lru_cache(maxsize=None)
def icon(kind, r, p=1.0, s=1.0):
    """A round icon of radius r at scale s, centred in a (2r + 12) px square patch.
    check / cross: terracotta disc, paper glyph drawn to fraction p
    ring: an upcoming week (paper ring) · hl: the week being talked about
    slot: an empty signature slot (dashed ring) · key: terracotta disc, paper key
    pass / fail: the small gate results on the rejection card"""
    size = 2 * (r + 6)
    c = size / 2
    R = r * s

    def disc(d, k):
        d.ellipse([(c - R) * k, (c - R) * k, (c + R) * k, (c + R) * k], fill=255)

    def ring(width, dashed=False):
        def draw(d, k):
            q = R - width / 2
            box = [(c - q) * k, (c - q) * k, (c + q) * k, (c + q) * k]
            if dashed:
                for a0 in range(-90, 270, 30):
                    d.arc(box, a0, a0 + 17, fill=255, width=int(round(width * k)))
            else:
                d.ellipse(box, outline=255, width=int(round(width * k)))
        return draw

    def glyph(name, frac):
        pts, wd = GLYPHS[name]
        pts = partial([[(c + x * R, c + y * R) for x, y in g] for g in pts], frac)
        return lambda d, k: stroke(d, [[(x * k, y * k) for x, y in g] for g in pts], wd * R * k)

    def key(d, k):  # a plain key: ring bow, shaft, two teeth
        u, wd = R * k, 0.14 * R * k
        bx, by, br = c * k - 0.30 * u, c * k - 0.06 * u, 0.27 * u
        d.ellipse([bx - br, by - br, bx + br, by + br], outline=255, width=int(round(wd)))
        stroke(d, [[(bx + br - wd / 2, by), (c * k + 0.60 * u, by)]], wd)
        stroke(d, [[(c * k + 0.30 * u, by), (c * k + 0.30 * u, by + 0.26 * u)]], wd)
        stroke(d, [[(c * k + 0.50 * u, by), (c * k + 0.50 * u, by + 0.30 * u)]], wd)

    M = lambda draw: mask(size, size, draw)  # noqa: E731
    if kind in ("check", "cross", "fail"):
        g = "cross" if kind == "fail" else kind
        layers = [(M(disc), TERRACOTTA, 1.0)]
        if p > 0:
            layers.append((M(glyph(g, p)), PAPER, 1.0))
    elif kind == "key":
        layers = [(M(disc), TERRACOTTA, 1.0), (M(key), PAPER, 1.0)]
    elif kind == "ring":
        layers = [(M(ring(3)), PAPER, 0.55)]
    elif kind == "hl":
        inner = lambda d, k: d.ellipse([(c - 0.40 * R) * k, (c - 0.40 * R) * k,  # noqa: E731
                                        (c + 0.40 * R) * k, (c + 0.40 * R) * k], fill=255)
        layers = [(M(disc), TERRACOTTA, 0.30), (M(ring(4)), TERRA_LIGHT, 1.0),
                  (M(inner), TERRA_LIGHT, 1.0)]
    elif kind == "slot":
        layers = [(M(ring(2.5, dashed=True)), PAPER, 0.55)]
    elif kind == "pass":
        layers = [(M(ring(2.5)), PAPER, 0.60), (M(glyph("check", 1.0)), PAPER, 0.90)]
    else:
        raise ValueError(kind)
    return paint(size, size, layers)


def rect_patch(w, h, col, op=1.0, radius=0, outline=None):
    """A (rounded) rectangle, filled, or an outline of the given width."""
    def draw(d, k):
        box = [0, 0, w * k - 1, h * k - 1]
        if outline:
            d.rounded_rectangle(box, radius=radius * k, outline=255, width=int(round(outline * k)))
        else:
            d.rounded_rectangle(box, radius=radius * k, fill=255)
    return paint(w, h, [(mask(w, h, draw), col, op)])


def pill_patch(word, px):
    """A small tag: terracotta-light outline and dot, mono bold capitals px px tall,
    its geometry scaled from the 26 px design (44 px high)."""
    u = px / 26
    txt, tdx, tdy = text_patch([(word, FMB, px, PAPER, 1.0)], pad=0)
    ph = int(round(44 * u))
    tx = int(round(40 * u))  # the dot sits at 18-28 (x u), the text after it
    pw = tx + txt.shape[1] + int(round(20 * u))
    pm = rect_patch(pw, ph, TERRA_LIGHT, 0.95, radius=ph // 2, outline=2.2 * u)
    dot = mask(pw, ph, lambda d, k: d.ellipse([18 * u * k, (ph / 2 - 5 * u) * k, 28 * u * k,
                                               (ph / 2 + 5 * u) * k], fill=255))
    pm = over_patch(pm, paint(pw, ph, [(dot, TERRA_LIGHT, 1.0)]), 0, 0)
    # cap height of DejaVu Sans Mono Bold is ~0.73 em: centre the capitals
    return over_patch(pm, txt, tx, int(round(ph / 2 + 0.73 * px / 2 - tdy)))


def over_patch(dst, src, x, y):
    """src over dst (both premultiplied) at integer x, y inside dst; returns dst."""
    dst = dst.copy()
    h, w = src.shape[:2]
    y0, x0 = max(0, y), max(0, x)
    y1, x1 = min(dst.shape[0], y + h), min(dst.shape[1], x + w)
    s = src[y0 - y:y1 - y, x0 - x:x1 - x]
    dst[y0:y1, x0:x1] = s + dst[y0:y1, x0:x1] * (1 - s[..., 3:4])
    return dst


def vblur(pm, n):
    """Vertical box blur over n px (the smear of a vertical move at a 180-degree
    shutter) of a premultiplied patch; the patch grows by n - 1 rows."""
    p = np.pad(pm, ((n - 1, n - 1), (0, 0), (0, 0)))
    c = np.concatenate([np.zeros((1,) + p.shape[1:], np.float32), np.cumsum(p, 0, np.float32)])
    return (c[n:] - c[:-n]) / n


ERF = np.vectorize(math.erf, otypes=[np.float64])


def soft_box(n, lo, hi, offset):
    """Coverage of [lo, hi) blurred by the panel's Gaussian, at pixel centres offset + i."""
    x = np.arange(n, dtype=np.float64) + offset + 0.5
    s = PANEL_BLUR * math.sqrt(2)
    return 0.5 * (ERF((x - lo) / s) - ERF((x - hi) / s))


class Canvas:
    """The overlay region, premultiplied, composited back to front."""

    def __init__(self):
        self.acc = np.zeros((RY1 - RY0, RX1 - RX0, 4), np.float32)

    def over(self, pm, x, y):
        h, w = pm.shape[:2]
        x0, y0 = x - RX0, y - RY0
        dx0, dy0 = max(0, x0), max(0, y0)
        dx1, dy1 = min(self.acc.shape[1], x0 + w), min(self.acc.shape[0], y0 + h)
        if dx1 <= dx0 or dy1 <= dy0:
            return
        src = pm[dy0 - y0:dy1 - y0, dx0 - x0:dx1 - x0]
        dst = self.acc[dy0:dy1, dx0:dx1]
        dst *= 1 - src[..., 3:4]
        dst += src

    def put(self, pm, x, y, a=1.0, wipe=1.0, vel=0.0):
        """Place a patch at frame px (x, sub-pixel y) with opacity a, revealed left
        to right to fraction wipe, smeared vertically for a speed of vel px/frame."""
        if a <= 0.002 or wipe <= 0:
            return
        if wipe < 1:
            cols = np.arange(pm.shape[1], dtype=np.float32)
            pm = pm * np.clip((wipe * (pm.shape[1] + WIPE_SOFT) - cols) / WIPE_SOFT, 0, 1)[None, :, None]
        if a < 1:
            pm = pm * np.float32(a)
        n = int(round(abs(vel) * 0.5))
        if n >= 2:
            pm = vblur(pm, n)
            y -= (n - 1) / 2
        iy = math.floor(y)
        f = y - iy
        if f > 0.004:  # sub-pixel position: a two-row lerp
            z = np.zeros((1,) + pm.shape[1:], np.float32)
            pm = np.concatenate([pm, z]) * (1 - f) + np.concatenate([z, pm]) * f
        self.over(pm, int(round(x)), iy)

    def panel(self, x0, x1, y0, y1, a):
        """The soft espresso panel, its edges blurred like shot 8's."""
        fy = soft_box(RY1 - RY0, y0, y1, RY0)
        rows = np.nonzero(fy > 1e-4)[0]
        fx = soft_box(RX1 - RX0, x0, x1, RX0)
        al = (np.outer(fy[rows[0]:rows[-1] + 1], fx) * (PANEL_A * a)).astype(np.float32)
        pm = np.empty(al.shape + (4,), np.float32)
        pm[..., :3] = al[..., None] * (np.asarray(ESPRESSO, np.float32) / 255)
        pm[..., 3] = al
        self.over(pm, RX0, RY0 + int(rows[0]))

    def bar(self, mid, h, a):
        """The terracotta bar, h px tall about mid, with anti-aliased ends; under
        1 px it is gone (as shot 8)."""
        if h < 1 or a <= 0:
            return
        ya, yb = mid - h / 2, mid + h / 2
        rows = np.arange(math.floor(ya), math.ceil(yb))
        cov = np.clip(np.minimum(rows + 1, yb) - np.maximum(rows, ya), 0, 1).astype(np.float32) * a
        pm = np.empty((len(rows), BAR_W, 4), np.float32)
        pm[..., :3] = cov[:, None, None] * (np.asarray(TERRACOTTA, np.float32) / 255)
        pm[..., 3] = cov[:, None]
        self.over(pm, BAR_X, int(rows[0]))

    def frame_rgba(self, rng):
        """Straight-alpha RGBA bytes of the region, with film grain."""
        a = self.acc[..., 3]
        rgb = self.acc[..., :3] / np.maximum(a, 1e-6)[..., None]
        rgb += rng.standard_normal(a.shape, dtype=np.float32)[..., None] * (GRAIN / 255)
        out = np.empty(self.acc.shape, np.uint8)
        out[..., :3] = np.where(a[..., None] > 0, np.clip(rgb * 255 + 0.5, 0, 255), 0)
        out[..., 3] = np.clip(a * 255 + 0.5, 0, 255)
        return out


class Row:
    """A patch that arrives at t0: wipes in left to right, fades in, rises RISE px;
    ease-out, or smoothstep (in and out) when soft."""

    def __init__(self, patch, x, y, t0, length=ROW_LEN, rise=RISE, wipe=True, op=None, soft=False):
        self.pm, self.dx, dy = patch
        self.x, self.y = x - self.dx, y - dy  # (x, y) is the baseline-left point for text
        self.t0, self.len, self.rise, self.wipe, self.op = t0, length, rise, wipe, op
        self.curve, self.speed = (smooth, smooth_v) if soft else (ease, ease_v)

    def draw(self, cv, t, k=1.0, drop=0.0):
        a = self.curve(self.t0, self.t0 + self.len, t)
        if a <= 0:
            return
        w = ease(self.t0, self.t0 + self.len * 1.15, t) if self.wipe else 1.0
        op = self.op(t) if self.op else 1.0
        cv.put(self.pm, self.x, self.y + self.rise * (1 - a) + drop, a * op * k, w,
               self.speed(self.t0, self.t0 + self.len, t, self.rise))

    @property
    def right(self):
        return self.x + self.pm.shape[1] - self.dx  # a text patch's padding is its dx


def pop(cv, kind, r, cx, cy, t0, t, k=1.0, drop=0.0, p=1.0):
    """An icon that scales up from 0.8 and fades in from t0."""
    a = ease(t0, t0 + 0.20, t)
    if a <= 0:
        return
    s = round(0.8 + 0.2 * ease(t0, t0 + POP_LEN, t), 2)
    pm = icon(kind, r, round(p, 2), s)
    half = pm.shape[0] / 2
    cv.put(pm, cx - half, cy - half + drop, a * k)


def outro(t, dur):
    """(opacity, drop px) of the last OUT_LEN s; the last frame is fully clear."""
    o = smooth(dur - OUT_LEN, dur - 1 / FPS, t)
    return 1 - o, OUT_DROP * o


def check_bounds(top, bottom, right, extra=()):
    soft = 3 * PANEL_BLUR
    assert BAND[0] - 10 <= top - soft and bottom + soft <= min(BAND[1] + 10, LOWEST), "out of the band"
    assert right + soft <= RIGHTMOST and top >= SAFE_TOP, "inside a safe zone"
    for name, x in extra:
        assert x <= right - 20, f"{name} reaches past the panel ({x:.0f})"


# ── a: roadmap-week2 / c: roadmap-week3 ───────────────────────────────────

def node_x(k):
    return CONTENT_X + NODE_R + k * CELL


class Roadmap:
    def __init__(self, mode):
        self.dur = DURATION[mode]
        self.week, caption = ROADMAP[mode]
        self.mode = mode
        hl = self.week - 1
        self.eyebrow = Row(text_patch([("SPRINT ROADMAP", FB, EYEBROW_PX, PAPER, 0.72)], track=3),
                           CONTENT_X, EYEBROW_BASE, EYEBROW_T)
        self.labels = []
        for k in range(4):
            base = 0.90 if k == 0 else 0.60
            op = (lambda t, b=base: b + (1 - b) * smooth(*HIGHLIGHT_T, t)) if k == hl else None
            self.labels.append(Row(text_patch([(f"Week {k + 1}", FB, 38, PAPER, 1.0 if op else base)]),
                                   node_x(k) - NODE_R, LABEL_BASE, LABEL_T + k * STAGGER, op=op))
        lw = text_width([(f"Week {self.week}", FB, 38, None, None)])
        self.underline = (rect_patch(int(round(lw)), 4, TERRA_LIGHT), node_x(hl) - NODE_R, LABEL_BASE + 13)
        self.rails = []
        for k in range(3):
            x0, x1 = node_x(k) + NODE_R + 8, node_x(k + 1) - NODE_R - 8
            self.rails.append(Row((rect_patch(x1 - x0, 3, PAPER, 0.30), 0, 0), x0, NODE_Y - 1.5,
                                  NODE_T + (k + 1) * STAGGER, rise=0))
        self.caption = Row(text_patch([(caption, FB, 44, PAPER, 1.0)]), CONTENT_X, CAPTION_BASE,
                           CAPTION_T)
        extra = [("caption", self.caption.right), ("week 4", self.labels[3].right)]
        if self.week == 2:  # the chain motif: three blocks, each linked to the one before
            self.blocks = [Row((block_patch(), 0, 0), CONTENT_X + i * (BLOCK_W + BLOCK_GAP), BLOCK_TOP,
                               BLOCK_T[i], length=0.35, rise=14, wipe=False) for i in range(3)]
            lk = link_patch()
            self.links = [Row((lk, 0, 0), CONTENT_X + BLOCK_W + i * (BLOCK_W + BLOCK_GAP)
                              + (BLOCK_GAP - lk.shape[1]) / 2, BLOCK_TOP + (BLOCK_H - lk.shape[0]) / 2,
                              BLOCK_T[i + 1] - 0.06, length=0.25, rise=0) for i in range(2)]
        else:  # TESTNET tag, signature slots and keys
            pill = pill_patch("TESTNET", PILL_PX)
            cap_mid = EYEBROW_BASE - 0.73 * EYEBROW_PX / 2
            self.pill = Row((pill, 0, 0), PILL_RIGHT - pill.shape[1], cap_mid - pill.shape[0] / 2,
                            PILL_T, rise=8)
            self.slots = [CONTENT_X + KEY_R + i * (2 * KEY_R + KEY_GAP) for i in range(2)]
            self.key_label = Row(text_patch([(KEY_LABEL, FS, 32, PAPER, 0.95)]),
                                 self.slots[1] + KEY_R + 24, KEY_Y + 0.73 * 32 / 2, SLOT_T + 0.05)
            extra += [("key label", self.key_label.right), ("pill", PILL_RIGHT)]
        check_bounds(RM_TOP, RM_BOTTOM, PANEL_RIGHT, extra)

    def draw(self, cv, t):
        k, drop = outro(t, self.dur)
        if k <= 0:
            return
        wipe = ease(*PANEL_T, t)
        if wipe > 0:
            cv.panel(BAR_X + BAR_W, BAR_X + BAR_W + (PANEL_RIGHT - BAR_X - BAR_W) * wipe,
                     RM_TOP + drop, RM_BOTTOM + drop, wipe * k)
        cv.bar((RM_TOP + RM_BOTTOM) / 2 + drop, (RM_BOTTOM - RM_TOP - 2 * BAR_INSET) * ease(*BAR_T, t), k)
        self.eyebrow.draw(cv, t, k, drop)
        for r in self.rails:
            r.draw(cv, t, k, drop)
        hl = self.week - 1
        for i in range(4):
            t0 = NODE_T + i * STAGGER
            if i == 0:
                pop(cv, "check", NODE_R, node_x(0), NODE_Y, t0, t, k, drop,
                    p=smooth(*CHECK_T, t))
                continue
            h = smooth(*HIGHLIGHT_T, t) if i == hl else 0.0
            if h < 1:
                pop(cv, "ring", NODE_R, node_x(i), NODE_Y, t0, t, k * (1 - h), drop)
            if h > 0:  # cross-fade to the lit node, which swells a little as it lights
                s = round(1.0 + 0.12 * h, 2)
                pm = icon("hl", NODE_R, 1.0, s)
                cv.put(pm, node_x(i) - pm.shape[0] / 2, NODE_Y - pm.shape[0] / 2 + drop, h * k)
        for r in self.labels:
            r.draw(cv, t, k, drop)
        pm, x, y = self.underline
        u = ease(HIGHLIGHT_T[0] + 0.05, HIGHLIGHT_T[0] + 0.40, t)
        if u > 0:
            cv.put(pm, x, y + drop, k, u)
        self.caption.draw(cv, t, k, drop)
        if self.week == 2:
            for r in self.links + self.blocks:
                r.draw(cv, t, k, drop)
        else:
            self.pill.draw(cv, t, k, drop)
            sa = ease(SLOT_T, SLOT_T + 0.35, t)
            for i, (cx, tk) in enumerate(zip(self.slots, KEY_T)):
                if sa > 0:
                    filled = ease(tk, tk + 0.20, t)
                    if filled < 1:
                        pm = icon("slot", KEY_R)
                        cv.put(pm, cx - pm.shape[0] / 2, KEY_Y - pm.shape[0] / 2 + drop + 8 * (1 - sa),
                               sa * k * (1 - filled))
                pop(cv, "key", KEY_R, cx, KEY_Y, tk, t, k, drop)
            self.key_label.draw(cv, t, k, drop)


def block_patch():
    """One record in the chain motif: a small dark card with two abstract lines and a
    terracotta tab on its left edge for the link to the record before it. No text."""
    w, h = BLOCK_W, BLOCK_H
    card = mask(w, h, lambda d, k: d.rounded_rectangle([0, 0, w * k - 1, h * k - 1], radius=9 * k,
                                                       fill=255))
    edge = mask(w, h, lambda d, k: d.rounded_rectangle([0, 0, w * k - 1, h * k - 1], radius=9 * k,
                                                       outline=255, width=int(1.6 * k)))
    tab = mask(w, h, lambda d, k: d.rounded_rectangle([10 * k, 14 * k, 18 * k, (h - 14) * k],
                                                      radius=3 * k, fill=255))
    lines = mask(w, h, lambda d, k: [d.rounded_rectangle([27 * k, y * k, (27 + lw) * k, (y + 5) * k],
                                                         radius=2.5 * k, fill=255)
                                     for y, lw in ((18, 40), (32, 28))])
    return paint(w, h, [(card, COFFEE, 0.96), (edge, PAPER, 0.32), (tab, TERRA_LIGHT, 1.0),
                        (lines, PAPER, 0.55)])


def link_patch():
    """Two interlocked chain links that bridge the gap between two blocks, with a
    short stub to each block, terracotta-light."""
    lw, lh, over, stub = 26, 20, 9, 6  # one link's size, their overlap, the stubs
    w, h = 2 * stub + 2 * lw - over, lh + 4

    def draw(d, k):
        for x0 in (stub, stub + lw - over):
            d.rounded_rectangle([x0 * k, 2 * k, (x0 + lw) * k, (2 + lh) * k], radius=lh / 2 * k,
                                outline=255, width=int(3.4 * k))
        for x0, x1 in ((0, stub + 2), (w - stub - 2, w)):
            d.rectangle([x0 * k, (h / 2 - 1.7) * k, x1 * k, (h / 2 + 1.7) * k], fill=255)
    return paint(w, h, [(mask(w, h, draw), TERRA_LIGHT, 1.0)])


# ── b: rejection ──────────────────────────────────────────────────────────

NODE_PROG = r"""
const fs = require('fs'), crypto = require('crypto');
const SPEC = require('./assets/gates.generated.js');
const G = require('./assets/qwatt-gates.js');
const suite = require('./protocol/conformance/cases.json');
// the merge protocol/conformance.test.js applies: case input over defaults[profile]
function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function merge(base, over) {
  const out = Object.assign({}, base);
  for (const k of Object.keys(over)) {
    out[k] = isPlainObject(base[k]) && isPlainObject(over[k]) ? merge(base[k], over[k]) : over[k];
  }
  return out;
}
const c = suite.cases.find(x => x.id === process.argv[1]);
const input = merge(suite.defaults[c.profile], c.input);
const profile = SPEC.profiles[c.profile];
const result = G.evaluateInterval(input, profile, SPEC);
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
process.stdout.write(JSON.stringify({
  case: c,
  input: input,
  profile_site: profile.site,
  result: result,
  messages_en: result.failures.map(f => G.format(SPEC.messages.en[f.code], f.detail)),
  gate_titles_en: Object.fromEntries(SPEC.gates.map(g => [g.id, g.title.en])),
  sha256: Object.fromEntries(process.argv.slice(2).map(f => [f, sha(f)]))
}));
"""
CHECKED = ("case", "input", "profile_site", "result", "messages_en", "gate_titles_en", "sha256")


def engine_output():
    """Run the gate engine on CASE_ID with node, from the repo root."""
    out = subprocess.run(["node", "-e", NODE_PROG, CASE_ID, *ENGINE_FILES], cwd=REPO,
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def data():
    node = subprocess.run(["node", "--version"], capture_output=True, text=True, check=True)
    doc = {"about": "The gate engine's verdict shown in shot 19 (rejection), verbatim. "
                    "assets/qwatt-gates.js evaluateInterval() with assets/gates.generated.js on "
                    f"protocol/conformance/cases.json case {CASE_ID}, merged over defaults[profile] "
                    "as protocol/conformance.test.js does; messages_en is the spec's English "
                    "message filled by the engine's format(). sha256 is of the three input files.",
           "command": "python3 docs/video/shot19-overlays.py data > docs/video/shot19-rejection.data.json",
           "node": node.stdout.strip()}
    doc.update(engine_output())
    json.dump(doc, sys.stdout, indent=1, ensure_ascii=False)
    sys.stdout.write("\n")


def load_rejection():
    """The saved engine output, refused unless node gives the same now and it is the
    verdict the conformance case expects."""
    with open(DATA, encoding="utf-8") as fh:
        saved = json.load(fh)
    now = engine_output()
    for key in CHECKED:
        assert saved[key] == now[key], f"{DATA}: '{key}' differs from the engine's output now"
    res, exp = saved["result"], saved["case"]["expect"]
    assert res["verdict"] == exp["verdict"] == "reject"
    assert [f["id"] for f in res["failures"]] == exp["fail"]
    assert all(c["code"] == exp["codes"][c["id"]] for c in res["checks"] if c["id"] in exp["codes"])
    return saved


class Rejection:
    def __init__(self):
        self.dur = DURATION["rejection"]
        d = load_rejection()
        res, inp = d["result"], d["input"]
        fail = res["failures"]
        T = RJ_T
        self.rows = [Row(text_patch([("GATE ENGINE · TEST CASE", FB, EYEBROW_PX, PAPER, 0.72)], track=3),
                         CONTENT_X, RJ_EYEBROW_BASE, T["eyebrow"])]
        verdict = f"{WORD[res['verdict']]} · {' · '.join(f['label'] for f in fail)}"
        self.rows.append(Row(text_patch([(verdict, FB, 60, PAPER, 1.0)]),
                             VERDICT_DISC[0] + VERDICT_DISC[2] + 18, VERDICT_BASE, T["verdict"]))
        title = d["gate_titles_en"][fail[0]["id"]]
        gate = Row(text_patch([(title, FS, 36, PAPER, 0.92)]), CONTENT_X, GATE_BASE, T["gate"])
        self.rows.append(gate)
        self.rows.append(Row((code_chip(fail[0]["code"]), 0, 0), gate.right + 24, GATE_BASE - 34,
                             T["code"]))
        lines = wrap(d["messages_en"][0], FS, MSG_PX, PANEL_RIGHT - 36 - CONTENT_X)
        assert len(lines) <= 2, lines
        for i, line in enumerate(lines):
            self.rows.append(Row(text_patch([(line, FS, MSG_PX, PAPER, 0.92)]), CONTENT_X,
                                 MSG_BASE + i * MSG_LEAD, T["msg"] + i * STAGGER))
        # every gate's result, as the engine returned it
        self.chips = []
        for i, c in enumerate(res["checks"]):
            kind = c["status"]  # this case's four gates all ran: pass or fail
            assert kind in ("pass", "fail"), c
            lab = text_patch([(c["label"], FMB, 28, PAPER, 1.0 if kind == "fail" else 0.78)])
            x = CONTENT_X + i * CHIP_STEP
            self.chips.append((kind, x + CHIP_R, Row(lab, x + 2 * CHIP_R + 10, CHIPS_Y + 0.73 * 28 / 2,
                                                     T["chips"] + i * STAGGER + 0.04, rise=6),
                               T["chips"] + i * STAGGER))
        self.rows.append(Row((rect_patch(PANEL_RIGHT - 36 - CONTENT_X, 2, PAPER, 0.20), 0, 0),
                             CONTENT_X, RULE_Y, T["rule"], rise=0))
        # the test input: integer mWh shown as Wh only where that loses no digit
        a, b = inp["meters"]["a"]["mwh"], inp["meters"]["b"]["mwh"]
        assert a % 100 == 0 and b % 100 == 0
        site = d["profile_site"]
        t0 = datetime.datetime.strptime(inp["ts_start"], "%Y-%m-%dT%H:%M:%SZ")
        local = t0.replace(tzinfo=datetime.timezone.utc).astimezone(ZoneInfo(site["tz"]))
        city = site["tz"].split("/")[-1].replace("_", " ")
        self.rows.append(Row(text_patch([(f"Test input: A {a / 1000:.1f} Wh · B {b / 1000:.1f} Wh · "
                                          f"{local:%H:%M} {city}", FS, 30, PAPER, 0.82)]),
                             CONTENT_X, INPUT_BASE, T["input"]))
        self.rows.append(Row(text_patch([(f"spec {res['spec_version']} · {res['spec_digest'][:8]}",
                                          FM, 30, PAPER, 0.95)]), CONTENT_X, SPEC_BASE, T["spec"]))
        check_bounds(RJ_TOP, RJ_BOTTOM, PANEL_RIGHT, [(f"row {i}", r.right) for i, r in enumerate(self.rows)])

    def draw(self, cv, t):
        k, drop = outro(t, self.dur)
        if k <= 0:
            return
        wipe = ease(*RJ_PANEL_T, t)
        if wipe > 0:
            cv.panel(BAR_X + BAR_W, BAR_X + BAR_W + (PANEL_RIGHT - BAR_X - BAR_W) * wipe,
                     RJ_TOP + drop, RJ_BOTTOM + drop, wipe * k)
        cv.bar((RJ_TOP + RJ_BOTTOM) / 2 + drop, (RJ_BOTTOM - RJ_TOP - 2 * BAR_INSET) * ease(*RJ_BAR_T, t), k)
        cx, cy, r = VERDICT_DISC
        pop(cv, "cross", r, cx, cy, RJ_T["disc"], t, k, drop, p=smooth(*RJ_T["glyph"], t))
        for row in self.rows:
            row.draw(cv, t, k, drop)
        for kind, x, lab, t0 in self.chips:
            pop(cv, kind, CHIP_R, x, CHIPS_Y, t0, t, k, drop)
            lab.draw(cv, t, k, drop)


def code_chip(code):
    """The reason code, mono, paper on a terracotta chip."""
    txt, dx, dy = text_patch([(code, FM, 30, PAPER, 1.0)], pad=0)
    ch = 46
    cw = txt.shape[1] + 28
    chip = rect_patch(cw, ch, TERRACOTTA, 1.0, radius=8)
    return over_patch(chip, txt, 14, int(round(ch / 2 + 0.73 * 30 / 2 - dy)))


# ── d: end card ───────────────────────────────────────────────────────────

def key_logo(height):
    """logo.png keyed to a premultiplied patch `height` px tall: navy ink recoloured
    to paper, the bolt in its own colour (the unmixing of shot 6)."""
    a = np.asarray(Image.open(LOGO_PNG).convert("RGB"), np.float64)
    border = np.concatenate([a[:40].reshape(-1, 3), a[-40:].reshape(-1, 3),
                             a[:, :40].reshape(-1, 3), a[:, -40:].reshape(-1, 3)])
    bg = np.median(border, 0)  # ~ (254, 254, 254)
    dist = np.linalg.norm(a - bg, axis=-1)
    warm = a[..., 0] - a[..., 2]
    navy = np.median(a[(dist > 200) & (warm < 0)], 0)  # ~ (31, 46, 61)
    bolt = np.median(a[(dist > 120) & (warm > 60)], 0)  # ~ (204, 104, 69)
    basis = np.stack([navy - bg, bolt - bg], 1)
    cov = np.linalg.lstsq(basis, (a - bg).reshape(-1, 3).T, rcond=None)[0]
    n, b = (np.clip(c, 0, None).reshape(a.shape[:2]) for c in cov)
    total = n + b  # paper noise (under 2 %) to clear, solid ink (over 92 %) to opaque
    alpha = np.clip((total - 0.02) / 0.90, 0, 1)
    share = np.divide(n, total, out=np.ones_like(total), where=total > 0)
    n, b = alpha * share, alpha * (1 - share)
    ys, xs = np.nonzero(alpha)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    s = height / (y1 - y0)  # one factor for both axes
    pad = 3
    cw, ch = int(math.ceil((x1 - x0) * s)) + 2 * pad, height + 2 * pad
    m = int(math.ceil(pad / s)) + 24
    src = (x0 + m - pad / s, y0 + m - pad / s, x0 + m + (cw - pad) / s, y0 + m + (ch - pad) / s)
    n, b = (np.clip(np.asarray(Image.fromarray(np.pad(c, m).astype(np.float32), "F")
                               .resize((cw, ch), Image.HAMMING, box=src)), 0, 1) for c in (n, b))
    pm = np.zeros((ch, cw, 4), np.float32)
    pm[..., :3] = n[..., None] * (np.asarray(PAPER, np.float32) / 255) + b[..., None] * (bolt / 255)
    pm[..., 3] = np.clip(n + b, 0, 1)
    return pm, pad


class EndCard:
    def __init__(self):
        self.dur = DURATION["endcard"]
        logo, pad = key_logo(LOGO_H)
        L = EC_ROW_LEN
        self.rows = [Row((logo, pad, pad), CONTENT_X, LOGO_Y, EC_T["logo"], length=L, wipe=False,
                         soft=True)]
        lw = logo.shape[1] - 2 * pad
        self.rows.append(Row(text_patch([(SITE, FB, 64, PAPER, 1.0)]), CONTENT_X + lw + 28, URL_BASE,
                             EC_T["url"], length=L, wipe=False, soft=True))
        self.rows.append(Row(text_patch([(REPO_URL, FM, 36, PAPER, 0.95)]), CONTENT_X, REPO_BASE,
                             EC_T["repo"], length=L, wipe=False, soft=True))
        self.rows.append(Row((pill_patch("TESTNET", EC_PILL_PX), 0, 0), CONTENT_X, EC_PILL_TOP,
                             EC_T["pill"], length=L, wipe=False, soft=True))
        assert abs(max(r.t0 + r.len for r in self.rows) - EC_FADE) < 1e-9  # the last lands at 0.8 s
        assert self.rows[3].y + self.rows[3].pm.shape[0] <= EC_BOTTOM - 16, "pill too low"
        self.right = int(max(r.right for r in self.rows[1:3])) + 36
        check_bounds(EC_TOP, EC_BOTTOM, self.right)

    def draw(self, cv, t):
        f = smooth(0, EC_FADE, t)
        if f > 0:
            cv.panel(BAR_X + BAR_W, self.right, EC_TOP, EC_BOTTOM, f)
        cv.bar((EC_TOP + EC_BOTTOM) / 2, (EC_BOTTOM - EC_TOP - 2 * BAR_INSET) * ease(*EC_BAR_T, t), f)
        for r in self.rows:  # at the panel's own fade, so the panel always leads its content
            r.draw(cv, t, f)


SCENES = {"roadmap-week2": Roadmap, "rejection": lambda m: Rejection(),
          "roadmap-week3": Roadmap, "endcard": lambda m: EndCard()}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "roadmap-week2"
    if mode == "data":
        return data()
    if mode not in SCENES:
        sys.exit("usage: shot19-overlays.py [roadmap-week2 | rejection | roadmap-week3 | endcard | data]")
    scene = SCENES[mode](mode)
    full = np.zeros((H, W, 4), np.uint8)
    seed = list(SCENES).index(mode)
    for i in range(round(DURATION[mode] * FPS)):
        cv = Canvas()
        scene.draw(cv, i / FPS)
        full[RY0:RY1, RX0:RX1] = cv.frame_rgba(np.random.default_rng((19, seed, i)))
        sys.stdout.buffer.write(full.tobytes())


if __name__ == "__main__":
    main()
