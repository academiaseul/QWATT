"""QWATT week 1 video, shots 10 and 11 (0:47-1:05), vertical 1080x1920: one
continuous 18 s motion graphic, cut into two files at 8.0 s.

  Shot 10 (0:47-0:55, 0.0-8.0 s). Diego: "Most systems handle that by writing
  new code for every device, and every new line of code is a new place for
  mistakes to hide."
    0.0-2.5  four generic meter glyphs arrive 0.4 s apart in a 2x2 grid (a
             DIN-rail module, a square panel meter, a wall-box inverter, a
             three-phase meter; blank or abstract displays, no names, no
             digits). Each speaks a bubble of made-up marks that writes itself
             on: overlapping coils, a jagged trace, dots and dashes, broken
             honeycomb chains. None of them is a letter or a real script.
    2.5-5.5  under each meter a block of "code" grows line by line: abstract
             bars, each block shaped differently (indents, braces, a flat
             register table, copy-paste per phase)
    5.5-8.0  small terracotta squiggles and dots tuck into random lines, one
             by one: the bugs hiding in four code paths
  Shot 11 (0:55-1:05, 8.0-18.0 s). Diego: "So in week one we asked: what if
  the rules that judge the energy never had to change?"
    8.0-10.5   code fades back (from 7.8 s, so the two frames at the seam
               differ), the meters shrink into a dimmed row at the
               top, and every mark peels off its bubble as a stream of ink
               that flies down and settles into one line of monospace text,
               each meter writing one quarter of it
    10.5-13.0  the record holds centred on a highlight band, wrapped onto three
               lines; a thin line runs from each meter to it; the source line
               "interval record · simulated test data" fades in under it
    12.2-13.0  the gate badge rises in with its padlock open, and the shackle
               drops shut at 13.0 s (on "the rules that judge the energy")
    13.2-18.0  calm hold, slow push-in (0.8 % over 4.8 s) for the cut to shot 12

The record is real, generated at render time. RECORD_JS (below) reads the
acceptance harness's own mkBuilder and viaCsv source out of ingest/harness.js
(the module exports only run and synthDay) and runs it on the harness's
synthetic morning from synthDay(), so the record is exactly what the
harness's CSV path produces; it returns the interval that starts at
RECORD_TS. The screen shows a subset of its fields with their real key names
and values, in the order the builder emits them, with raw_sha256 cut to 8 hex
characters and "…". Meter ids are left out: they carry product names. The
badge is read from assets/gates.generated.js: the number of gates the spec
runs on a single interval (level "interval": plausibility, nameplate ceiling,
solar elevation, meter agreement, the four the public docs call "physics
gates"), spec_version, and the first 8 hex characters of the spec digest that
node protocol/gen.js --check prints. Rendered on 23 Oct 2026 (HEAD 83ee698),
the screen reads:

    {"ts_start":"2026-09-20T15:30:00.000Z","dt_s":300,
     "meters":{"a":{"mwh":9085},"b":{"mwh":8947}},
     "source":{"raw_sha256":"ac3d50e4…"}}
    interval record · simulated test data
    4 physics gates · spec 1.0.0 · 056f1b51

EXPECT (below) holds those values. Every render logs the full record and the
badge to stderr, and stops before drawing a frame if the repo now yields
anything else, so this docstring and the mp4 cannot drift apart: check the
new values, then update EXPECT and the lines above. Nothing implies a live
meter or a real roof: the morning is the harness's simulation, and the source
line says so.

Writes raw RGB frames to stdout for frames [START, END) of the 540-frame
timeline (default: all of it); shot 11 starts at frame 240. Every frame is a
pure function of its index (grain is seeded per frame), so the two halves meet
frame-exact. Both renders together take 2-6 minutes on a shared 4-core
machine. Needs node, numpy and Pillow. Render from the repo root (bash or
zsh). Each part goes to a .part.mp4 that replaces the deliverable only when
both python and ffmpeg succeed, so a failed run never overwrites a good file
with an audio-only one:

    set -o pipefail
    A="anoisesrc=d=18:c=pink:r=48000:a=0.6:seed=1010:nb_samples=64,highpass=f=1400,lowpass=f=4800,\\
    volume=eval=frame:volume='0.26*(0.3+0.7*pow(abs(sin(2*PI*2.6*t)*sin(2*PI*0.83*t+1.3)),0.6))\\
    *(1-0.4*min(1,max(0,(t-5.5)/0.6)))*min(1,t/0.4)*min(1,max(0,(8.4-t)/0.8))'[s];\\
    aevalsrc=s=48000:d=18:exprs='gte(t,8)*0.11*if(lt(t,10.4),pow((t-8)/2.4,2),exp(-max(t-10.4,0)*2.2))\\
    *(sin(2*PI*(196*min(t-8,2.5)+19.6*pow(min(t-8,2.5),2)+294*max(t-10.5,0)))\\
    +0.3*sin(4*PI*(196*min(t-8,2.5)+19.6*pow(min(t-8,2.5),2)+294*max(t-10.5,0))))\\
    +gte(t,13)*(0.14*exp(-max(t-13,0)*320)*sin(2*PI*2300*(t-13))+0.11*exp(-max(t-13,0)*90)*sin(2*PI*640*(t-13)))'[k];\\
    [s][k]amix=inputs=2:normalize=0[bed]"
    V="[0:v]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]"

    python3 docs/video/shot10-dialects.py 0 240 | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1080x1920 -r 30 -i - -filter_complex "$V;$A;[bed]atrim=0:8,asetpts=PTS-STARTPTS[a]" \\
      -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \\
      -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart \\
      -c:a aac -b:a 192k QWATT-week1-shot10-dialects.part.mp4 \\
      && mv QWATT-week1-shot10-dialects.part.mp4 QWATT-week1-shot10-dialects.mp4
    python3 docs/video/shot10-dialects.py 240 540 | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1080x1920 -r 30 -i - -filter_complex "$V;$A;[bed]atrim=8:18,asetpts=PTS-STARTPTS[a]" \\
      -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \\
      -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart \\
      -c:a aac -b:a 192k QWATT-week1-shot11-one-line.part.mp4 \\
      && mv QWATT-week1-shot11-one-line.part.mp4 QWATT-week1-shot11-one-line.mp4

Both commands build the same 18 s audio bed (seeded noise, so identical) and
keep their own slice of it, so the sound runs on across the seam too: a soft
pencil-scribble texture under 0-8 s, a quiet rising tone (G3 to D4) under the
resolve 8.0-10.5 s, one soft click as the padlock shuts at 13.0 s. Peaks: the
scribble about -27 dBFS, the tone -18, the click -14. Music is added in the edit.
"""
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FPS = 30
DUR = 18.0
N_FRAMES = int(DUR * FPS)  # 540
W, H = 1080, 1920
SS = 3                     # supersampling for every shape, stroke and moving text

# Vertical safe zones: the platform UI and our burned-in captions own these bands
SAFE_TOP, SAFE_RIGHT, SAFE_BOTTOM = 120, 140, 420
CX = (40 + W - SAFE_RIGHT) // 2  # 490, centre of the usable column

PAPER = (250, 248, 242)
ESPRESSO = (22, 16, 10)
COFFEE = (41, 29, 19)
TERRACOTTA = (176, 88, 47)
TERRA_LIGHT = (208, 138, 87)  # accent on dark backgrounds
# meters: flat icons in paper and coffee tones
BODY = (234, 227, 213)
SHADE = (208, 197, 179)
LATTE = (162, 139, 112)
GROOVE = (118, 98, 78)
# speech bubbles and code cards
BUBBLE = (50, 37, 26)
BUBBLE_EDGE = (118, 97, 76)
INK = (240, 233, 220)
CARD = (39, 28, 19)
CARD_EDGE = (66, 50, 36)
TOKEN = {"kw": (186, 121, 77), "name": (162, 149, 132), "expr": (130, 118, 104),
         "punct": (112, 99, 86), "hex": (172, 159, 142), "comment": (98, 83, 68)}
BUG = (224, 108, 60)  # brand terracotta's hue lifted for the dark card: redder than the keyword bars
# the record, the source line and the badge
KEY, PUNCT, MUTED, LABEL = (196, 187, 172), (128, 118, 106), (150, 140, 126), (226, 219, 206)
BAND = (52, 38, 26)
LINK = (112, 96, 80)

FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

REPO = Path(__file__).resolve().parents[2]
RECORD_TS = "2026-09-20T15:30:00.000Z"  # seq 6 of the harness's 24 five-minute intervals
# What the docstring quotes; setup() stops if the repo now yields anything else
EXPECT = {"ts_start": RECORD_TS, "dt_s": 300, "mwh": [9085, 8947], "raw_sha256": "ac3d50e4",
          "spec_version": "1.0.0", "digest": "056f1b51", "interval_gates": 4}

# Runs the harness's own CSV path: mkBuilder and viaCsv are read from ingest/harness.js
# (it exports only run and synthDay) and evaluated as they stand, so they cannot drift.
RECORD_JS = r"""
const fs = require('fs'), os = require('os'), path = require('path');
const { synthDay } = require('./ingest/harness');
const { IntervalBuilder } = require('./ingest/lib/normalize');
const csv = require('./ingest/adapters/csv');
const SPEC = require('./assets/gates.generated.js');
const src = fs.readFileSync('./ingest/harness.js', 'utf8');
const grab = (re, what) => {
  const m = src.match(re);
  if (!m) throw new Error('cannot find ' + what + ' in ingest/harness.js; update RECORD_JS to match it');
  return m[0];
};
const viaCsv = new Function('fs', 'os', 'path', 'IntervalBuilder', 'csv',
  grab(/const mkBuilder = [\s\S]*?\n\}\);\n/, 'mkBuilder')
  + grab(/async function viaCsv\(samples\) \{[\s\S]*?\n\}\n/, 'viaCsv') + 'return viaCsv;')(fs, os, path, IntervalBuilder, csv);
(async () => {
  const out = await viaCsv(synthDay());
  const record = out.find((r) => r.ts_start === process.argv[1]);
  if (!record) throw new Error('no interval starts at ' + process.argv[1]);
  console.log(JSON.stringify({ record, spec_version: SPEC.spec_version, digest: SPEC.digest,
    interval_gates: SPEC.gates.filter((g) => g.level === 'interval').length }));
})().catch((e) => { console.error(e); process.exit(1); });
"""

# ── layout ────────────────────────────────────────────────────────────────
# 2x2 grid of meter centres: cells 0 TL, 1 TR, 2 BL, 3 BR
GRID = [(176, 460), (606, 460), (176, 1130), (606, 1130)]
KIND = ["din", "panel", "inverter", "three_phase"]
SCRIPT = ["loops", "zigzag", "dotdash", "hex"]
CODE_STYLE = ["indent", "braces", "table", "phases"]
# in shot 11 the meters line up in one row; the left column takes slots 0-1 so no paths cross
SLOT = [0, 2, 1, 3]
ROW_Y, ROW_DX, S_SMALL = 430, 215, 0.42
# meter-relative geometry at scale 1 (meter centre = 0, 0)
BUBBLE_BOX = (70, -290, 302, -140)
TAIL = [(92, -141), (124, -141), (74, -121)]  # base on the bubble's bottom edge, tip toward the meter
TIP = TAIL[2]
INNER = (88, -271, 196, 112)  # where the marks live inside the bubble: x, y, w, h
CARD_BOX = (-100, 135, 304, 331)
CODE_X, LINE_Y0, LINE_PITCH, BAR_H = 34, 18, 17, 7
METER_BOTTOM = {"din": 113, "panel": 80, "inverter": 118, "three_phase": 112}
# the record
REC_FONT = 31
REC_PITCH = 48
REC_MAXW = 892  # widest line, px; the text stays inside x 44-936
BAND_CY = 980
BAND_PAD = 30

# ── timeline (s) ──────────────────────────────────────────────────────────
ARRIVE = [0.0, 0.4, 0.8, 1.2]      # meter i starts to arrive; 0.6 s ease-out
POP, WRITE_AT, WRITE_DUR = 0.35, 0.55, 0.7  # bubble pops, then its marks write on
CODE_T0, CODE_T1 = 2.45, 5.45      # code blocks grow
BUG_T0, BUG_DT, BUG_DRAW = 5.6, 0.29, 0.3  # error marks, one by one
CODE_OUT = (7.8, 8.5)              # code and bugs fade back (frames 239 and 240 differ)
MOVE = (8.0, 9.3)                  # meters to the top row
DEP0, DEP_STAGGER, DEP_WIN = 8.3, 0.08, 0.9  # marks peel off, per slot
FLY, FLY_JIT = 0.95, 0.08
DIM = (9.0, 10.4)
BAND_IN = (9.6, 10.5)
LINKS = (10.4, 1.0, 0.15)          # start, duration, stagger per slot
SOURCE_IN = (10.6, 11.2)
BADGE_IN = (12.2, 12.7)
LOCK = (12.72, 13.0)               # shackle drops; the click is at 13.0 s
GLOW = (13.0, 13.8)
DRIFT = (13.2, DUR, 0.008)         # slow push-in, ease-in, to +0.8 %
DRIFT_C = (CX, 800)

N_PER_BUBBLE = 1500                # ink particles per bubble
SUBSTEPS, SHUTTER = 10, 0.6        # motion blur for the particles (fraction of a frame)
HEAD = 0.4                         # share of a particle's ink on its leading sample; the rest is its blur tail
FLIGHT_BOOST = 2.2                 # extra ink in flight so the streams read on a phone; eases to 1 on landing
SPREAD = (30, 20, (1.5, 4.5))      # control-point sigma x, y and sway range (px): ribbons, not haze
GRAIN = 2.4                        # film grain sigma, as in shot 9


def clamp(x):
    return np.clip(x, 0.0, 1.0)


def ease_out(a, b, t):
    x = clamp((np.asarray(t, float) - a) / (b - a))
    return 1 - (1 - x) ** 3


def ease_in(a, b, t):
    x = clamp((np.asarray(t, float) - a) / (b - a))
    return x ** 3


def ease_io(a, b, t):
    x = clamp((np.asarray(t, float) - a) / (b - a))
    return np.where(x < 0.5, 4 * x ** 3, 1 - (-2 * x + 2) ** 3 / 2)


def smooth(a, b, t):
    x = clamp((np.asarray(t, float) - a) / (b - a))
    return x * x * (3 - 2 * x)


def font(path, size):
    return ImageFont.truetype(path, int(round(size)))


class Vec:
    """Supersampled drawing in frame coordinates. Positions stay fractional, so
    slow eases glide instead of stepping a whole pixel; done() returns the RGBA
    sprite at 1x and its integer top-left."""

    def __init__(self, x0, y0, x1, y1):
        self.ox, self.oy = math.floor(x0) - 2, math.floor(y0) - 2
        self.w, self.h = math.ceil(x1) + 2 - self.ox, math.ceil(y1) + 2 - self.oy
        self.img = Image.new("RGBA", (self.w * SS, self.h * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    def p(self, x, y):
        return ((x - self.ox) * SS, (y - self.oy) * SS)

    def rrect(self, a, b, r, fill=None, outline=None, width=0):
        (x0, y0), (x1, y1) = self.p(*a), self.p(*b)
        self.d.rounded_rectangle([x0, y0, x1, y1], max(0, r * SS), fill=fill, outline=outline,
                                 width=max(1, round(width * SS)) if outline else 0)

    def circle(self, c, r, fill=None, outline=None, width=0):
        x, y = self.p(*c)
        self.d.ellipse([x - r * SS, y - r * SS, x + r * SS, y + r * SS], fill=fill, outline=outline,
                       width=max(1, round(width * SS)) if outline else 0)

    def poly(self, pts, fill):
        self.d.polygon([self.p(*q) for q in pts], fill=fill)

    def line(self, pts, fill, width, caps=True):
        pts = [self.p(*q) for q in pts]
        w = max(1, round(width * SS))
        if len(pts) > 1:
            self.d.line(pts, fill=fill, width=w, joint="curve")
        if caps:  # round caps
            r = w / 2
            for x, y in (pts[0], pts[-1]):
                self.d.ellipse([x - r, y - r, x + r, y + r], fill=fill)

    def text(self, xy, s, f, fill, anchor="ls"):
        self.d.text(self.p(*xy), s, font=f, fill=fill, anchor=anchor)

    def done(self):
        return self.img.resize((self.w, self.h), Image.BOX), self.ox, self.oy


def put(frame, sprite, opacity=1.0):
    """Composite an (image, x, y) sprite over the RGB frame at an opacity."""
    img, x, y = sprite
    if opacity <= 0.003:
        return
    a = img.getchannel("A")
    if opacity < 0.997:
        a = a.point(lambda v: int(v * opacity + 0.5))
    frame.paste(img.convert("RGB"), (x, y), a)


# ── the four meters ───────────────────────────────────────────────────────

def draw_meter(v, kind, mx, my, s):
    """Generic flat meter glyphs, about 170 x 230 px at scale 1. No names, no digits."""
    q = lambda x, y: (mx + s * x, my + s * y)
    if kind == "din":  # one-module DIN-rail meter clipped to its rail
        v.rrect(q(-88, -13), q(88, 13), 3 * s, fill=LATTE)
        v.line([q(-88, -5), q(88, -5)], GROOVE, 1.6 * s, caps=False)
        v.rrect(q(-50, -113), q(50, 113), 10 * s, fill=SHADE)    # shoulders with the terminals
        v.rrect(q(-38, -80), q(38, 80), 8 * s, fill=BODY)        # raised front
        for y in (-97, 97):
            for x in (-22, 22):
                v.circle(q(x, y), 8 * s, fill=COFFEE)
                v.line([q(x - 4, y), q(x + 4, y)], LATTE, 2 * s, caps=False)
        v.rrect(q(-28, -64), q(28, -22), 4 * s, fill=COFFEE)
        for a, b in (((-21, -55), (4, -48)), ((9, -55), (21, -48)), ((-21, -38), (11, -31))):
            v.rrect(q(*a), q(*b), 3 * s, fill=TERRA_LIGHT)
        v.circle(q(22, -6), 4.5 * s, fill=TERRACOTTA)
        v.rrect(q(-22, 22), q(22, 34), 6 * s, fill=SHADE)
        v.rrect(q(-22, 48), q(10, 54), 3 * s, fill=SHADE)
    elif kind == "panel":  # square panel meter in its bezel
        v.rrect(q(-80, -80), q(80, 80), 13 * s, fill=BODY)
        v.rrect(q(-68, -68), q(68, 68), 7 * s, fill=SHADE)
        v.rrect(q(-58, -58), q(58, 6), 5 * s, fill=COFFEE)
        for a, b in (((-47, -46), (-8, -32)), ((0, -46), (24, -32)), ((32, -46), (47, -32)),
                     ((-47, -20), (12, -12)), ((20, -20), (47, -12))):
            v.rrect(q(*a), q(*b), 3 * s, fill=TERRA_LIGHT)
        for x in (-42, -14, 14, 42):
            v.rrect(q(x - 10, 26), q(x + 10, 46), 4 * s, fill=BODY, outline=LATTE, width=2 * s)
    elif kind == "inverter":  # wall-box inverter: fins on top, a curve on its screen, glands below
        v.rrect(q(-72, -112), q(72, -86), 6 * s, fill=LATTE)
        for x in range(-60, 61, 12):
            v.line([q(x, -107), q(x, -92)], GROOVE, 2 * s, caps=False)
        v.rrect(q(-78, -96), q(78, 90), 14 * s, fill=BODY)
        v.rrect(q(-46, -68), q(46, -16), 6 * s, fill=COFFEE)
        for k, hh in enumerate((9, 15, 23, 30, 34, 31, 24, 17, 10)):
            x = -37 + k * 8.4
            v.rrect(q(x, -23 - hh), q(x + 5, -23), 2 * s, fill=TERRA_LIGHT)
        v.circle(q(-15, 4), 4.5 * s, fill=TERRA_LIGHT)
        v.circle(q(0, 4), 4.5 * s, fill=SHADE)
        v.circle(q(15, 4), 4.5 * s, fill=SHADE)
        v.rrect(q(-50, 42), q(50, 48), 3 * s, fill=SHADE)
        for x in (-46, 0, 46):
            v.line([q(x, 100), q(x, 118)], SHADE, 7 * s, caps=False)
            v.rrect(q(x - 10, 88), q(x + 10, 102), 3 * s, fill=LATTE)
    else:  # three-phase meter: domed case, terminal cover, three phase lamps, optical port
        v.rrect(q(-80, -112), q(80, 60), 34 * s, fill=BODY)
        v.poly([q(-80, 52), q(80, 52), q(64, 112), q(-64, 112)], fill=LATTE)
        v.line([q(-60, 84), q(60, 84)], GROOVE, 1.6 * s, caps=False)
        v.circle(q(-44, 98), 4 * s, fill=COFFEE)
        v.circle(q(44, 98), 4 * s, fill=COFFEE)
        v.rrect(q(-56, -86), q(56, -42), 5 * s, fill=COFFEE)
        for a, b in (((-46, -76), (26, -66)), ((33, -76), (46, -66)), ((-46, -56), (-8, -50)),
                     ((0, -56), (20, -50))):
            v.rrect(q(*a), q(*b), 3 * s, fill=TERRA_LIGHT)
        for x in (-26, 0, 26):
            v.circle(q(x, -22), 5 * s, fill=TERRACOTTA)
        v.circle(q(0, 18), 13 * s, outline=COFFEE, width=4 * s)
        v.circle(q(0, 18), 4 * s, fill=COFFEE)


def meter_state(c, t):
    """Centre, scale and opacity of meter c at time t (scalar or array)."""
    t = np.asarray(t, float)
    (gx, gy), s_ = GRID[c], SLOT[c]
    fx, fy = CX + (s_ - 1.5) * ROW_DX, ROW_Y
    k = ease_io(*MOVE, t)
    a = ease_out(ARRIVE[c], ARRIVE[c] + 0.6, t)
    x = gx + (fx - gx) * k
    y = gy + (fy - gy) * k + 34 * (1 - a)
    s = (1 + (S_SMALL - 1) * k) * (0.94 + 0.06 * a)
    return x, y, s, a * (1 - 0.5 * smooth(*DIM, t))


# ── the made-up scripts ───────────────────────────────────────────────────

def resample(pts, step=0.7):
    pts = np.asarray(pts, float)
    seg = np.hypot(*np.diff(pts, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    n = max(2, int(math.ceil(s[-1] / step)) + 1)
    q = np.linspace(0, s[-1], n)
    return np.stack([np.interp(q, s, pts[:, 0]), np.interp(q, s, pts[:, 1])], 1), s[-1]


def dot(x, y, r=1.3):
    a = np.linspace(0, 2 * math.pi, 10)
    return np.stack([x + r * np.cos(a), y + r * np.sin(a)], 1)


def script_strokes(kind, rng):
    """Abstract marks in reading order, as (points, width) in bubble-inner coords
    (196 x 112). None of them is a letter: coils overlap and wander off the
    line, the jagged line spikes both ways like a trace, dashes ride a wave,
    and the hexagons come in broken honeycomb clusters."""
    iw, ih = INNER[2], INNER[3]
    out = []
    if kind == "loops":  # overlapping coils, like a pen testing itself
        for base in (40, 88):
            x = rng.uniform(2, 8)
            while x < iw - 40:
                n = int(rng.integers(4, 8))
                pts = [(x - 4, base + 4)]
                up = 1.0
                for _ in range(n):
                    adv = rng.uniform(5.5, 8.5)
                    h = rng.uniform(9, 22) * up
                    r = rng.uniform(5.5, 8.5)
                    th = np.linspace(0, 2 * math.pi, 34)[1:]
                    drift = 3 * math.sin(x / 17)
                    yy = base + drift - h * (1 - np.cos(th)) / 2
                    xx = x + adv * th / (2 * math.pi) + r * np.sin(th) * np.sign(up)
                    pts += list(zip(xx, yy))
                    x += adv
                    up = -0.55 if (up > 0 and rng.random() < 0.3) else 1.0
                pts.append((x + 9, base + 2 * math.sin(x / 17)))
                out.append((pts, 2.8))
                x += rng.uniform(22, 30)
    elif kind == "zigzag":  # a jagged trace with spikes up and down
        for base in (30, 66, 100):
            x = rng.uniform(0, 6)
            while x < iw - 30:
                pts, end = [(x, base)], min(iw - 2, x + rng.uniform(60, 110))
                while x < end:
                    x += rng.uniform(2.5, 5.5)
                    r = rng.random()
                    y = base - (rng.uniform(10, 17) if r < 0.3 else -rng.uniform(4, 8) if r < 0.5
                                else rng.uniform(-2, 3))
                    pts.append((min(x, end), y))
                pts.append((min(x + 4, iw - 1), base))
                out.append((pts, 2.6))
                x += rng.uniform(12, 18)
    elif kind == "dotdash":
        for row, base in enumerate((30, 66, 100)):
            x = rng.uniform(0, 8)
            wave = lambda x: base - 9 + 4 * math.sin(x / 19 + row * 1.7)
            while x < iw - 10:
                if rng.random() < 0.4:
                    out.append((dot(x + 2, wave(x + 2) + rng.choice([0, 0, -7])), 4.4))
                    x += rng.uniform(9, 12)
                else:
                    ln = min(rng.uniform(8, 24), iw - 2 - x)
                    xs = np.linspace(x, x + ln, 8)
                    out.append(([(u, wave(u)) for u in xs], 4.0))
                    x += ln + rng.uniform(7, 10)
                if rng.random() < 0.18:
                    x += 10
    else:  # broken honeycomb chains: 2-4 cells side by side, some walls missing, one cell seeded
        R = 9.5
        hx, hy = 1.5 * R, math.sqrt(3) * R  # flat-top lattice: columns 1.5 R apart, half a cell up or down
        for base in (34, 86):
            x = rng.uniform(4, 10)
            while x < iw - 3 * R:
                n = int(rng.integers(2, 5))
                if x + 2 * R + (n - 1) * hx > iw - 2:
                    break
                lift = rng.choice([-1, 1]) * hy / 4
                centres = [(x + R + k * hx, base - 12 + (lift if k % 2 == 0 else -lift)) for k in range(n)]
                edges = {}
                for cx, cy in centres:
                    vx = [(round(cx + R * math.cos(k * math.pi / 3), 1), round(cy + R * math.sin(k * math.pi / 3), 1))
                          for k in range(6)]
                    for k in range(6):
                        edges[tuple(sorted((vx[k], vx[(k + 1) % 6])))] = True
                keep = [e for e in edges if rng.random() > 0.15]
                if len(keep) == len(edges):  # always broken somewhere
                    keep.pop(int(rng.integers(len(keep))))
                for e0, e1 in keep:
                    out.append(([e0, e1], 2.6))
                cx, cy = centres[int(rng.integers(n))]
                out.append((dot(cx, cy, 1.2), 4.0))
                x = centres[-1][0] + R + rng.uniform(10, 15)
    # keep every mark inside the bubble whatever the dice said
    allp = np.concatenate([np.asarray(p, float) for p, _ in out])
    kx = min(1.0, (iw - 3) / max(allp[:, 0].max(), 1))
    y0, y1 = allp[:, 1].min(), allp[:, 1].max()
    ky = min(1.0, (ih - 6) / max(y1 - y0, 1))
    oy = 3 - y0 * ky if (y0 < 3 or y1 > ih - 3) else 0.0
    return [([(px * kx, py * (ky if oy else 1) + oy) for px, py in p], w) for p, w in out]


def prepare_script(kind, rng):
    """Dense strokes plus u, the share of ink written so far (0..1), at every point."""
    strokes = []
    total = 0.0
    for pts, w in script_strokes(kind, rng):
        d, ln = resample(pts)
        strokes.append([d, ln, w, total])
        total += ln
    for st in strokes:
        d, ln, w, off = st
        st.append((off + np.linspace(0, ln, len(d))) / total)
    return [(d, w, u) for d, ln, w, off, u in strokes]


# ── bubbles ───────────────────────────────────────────────────────────────

def bubble_map(mx, my, s, pop):
    """Meter-relative coords -> frame coords: pop about the tail tip, then the meter."""
    def q(x, y):
        x = TIP[0] + (np.asarray(x) - TIP[0]) * pop
        y = TIP[1] + (np.asarray(y) - TIP[1]) * pop
        return mx + s * x, my + s * y
    return q


def draw_bubble(c, mx, my, s, pop, lo, hi):
    q = bubble_map(mx, my, s, pop)
    k = s * pop
    x0, y0, x1, y1 = BUBBLE_BOX
    a, b = q(x0, y0), q(x1, TIP[1])
    v = Vec(a[0] - 4, a[1] - 4, b[0] + 4, b[1] + 4)
    v.rrect(q(x0, y0), q(x1, y1), 26 * k, fill=BUBBLE, outline=BUBBLE_EDGE, width=2 * k)
    t0, t1, tip = TAIL
    v.poly([q(t0[0], t0[1] - 3), q(t1[0], t1[1] - 3), q(*t1), q(*tip), q(*t0)], fill=BUBBLE)
    v.line([q(*t0), q(*tip), q(*t1)], BUBBLE_EDGE, 2 * k, caps=False)
    for d, w, u in SCRIPTS[c] if hi > 0 and lo < 1 else []:
        m = (u > lo) & (u <= hi)
        if not m.any():
            continue
        px, py = q(INNER[0] + d[m, 0], INNER[1] + d[m, 1])
        v.line(list(zip(px, py)), INK, w * k)
    return v.done()


# ── code blocks and bugs ──────────────────────────────────────────────────

def code_lines(style, rng):
    """Ten lines of abstract code: [(x, length, token kind)] from the code column's left."""
    U = lambda a, b: float(rng.uniform(a, b))
    L = []
    if style == "indent":  # nesting by indentation only
        for ind in (0, 1, 1, 2, 2, 1, 2, 3, 3, 0):
            x, toks = ind * 22, []
            if rng.random() < 0.55:
                toks.append((x, U(22, 36), "kw"))
                x += toks[-1][1] + 8
            for _ in range(int(rng.integers(1, 3))):
                ln = min(U(26, 92), 330 - x)
                if ln < 14:
                    break
                toks.append((x, ln, "name" if rng.random() < 0.6 else "expr"))
                x += ln + 8
            L.append(toks)
    elif style == "braces":  # opening and closing braces, C-like
        spec = [(0, ["kw", "name", "punct"]), (1, ["kw", "expr", "punct"]), (2, ["name", "punct", "expr"]),
                (2, ["name", "expr"]), (1, ["punct"]), (1, ["kw", "expr", "punct"]), (2, ["name", "expr", "expr"]),
                (1, ["punct"]), (1, ["kw", "name"]), (0, ["punct"])]
        for ind, kinds in spec:
            x, toks = ind * 22, []
            for kd in kinds:
                ln = 8 if kd == "punct" else (U(24, 34) if kd == "kw" else U(40, 110))
                toks.append((x, ln, kd))
                x += ln + 8
            L.append(toks)
    elif style == "table":  # a flat register table: four columns, no nesting
        for _ in range(10):
            toks = [(0, U(40, 48), "hex"), (58, U(36, 46), "hex"), (116, U(60, 96), "name")]
            if rng.random() < 0.7:
                toks.append((226, U(40, 110), "comment"))
            L.append(toks)
    else:  # the same lines pasted once per phase, then a long loop
        a, b, cc = U(60, 76), U(130, 160), U(40, 64)
        L.append([(0, 30, "kw"), (38, U(120, 150), "name")])
        for _ in range(3):
            L.append([(22, a, "name"), (30 + a, 8, "punct"), (46 + a, b + U(-3, 3), "expr"), (54 + a + b, cc, "expr")])
        L.append([(22, 30, "kw"), (60, U(150, 190), "expr")])
        for _ in range(3):
            d = U(80, 96)
            L.append([(44, d, "name"), (52 + d, U(170, 214), "expr")])
        L.append([(22, 40, "kw"), (70, U(90, 120), "name")])
        L.append([(22, U(200, 250), "comment")])
    return L


def card_origin(c):
    gx, gy = GRID[c]
    return gx + CARD_BOX[0], gy + CARD_BOX[1]


def render_card(c):
    """Card background and its code, fully grown; the reveal is a mask per frame."""
    x0, y0 = card_origin(c)
    w, h = CARD_BOX[2] - CARD_BOX[0], CARD_BOX[3] - CARD_BOX[1]
    bg = Vec(x0, y0, x0 + w, y0 + h)
    bg.rrect((x0, y0), (x0 + w, y0 + h), 12, fill=CARD, outline=CARD_EDGE, width=1.5)
    code = Vec(x0, y0, x0 + w, y0 + h)
    spans = []
    for l, toks in enumerate(CODES[c]):
        y = y0 + LINE_Y0 + l * LINE_PITCH
        code.circle((x0 + 16, y + BAR_H / 2), 1.8, fill=TOKEN["comment"])  # gutter
        for x, ln, kd in toks:
            xa = x0 + CODE_X + x
            code.rrect((xa, y), (xa + ln, y + BAR_H), BAR_H / 2, fill=TOKEN[kd])
        spans.append((y, x0 + CODE_X + toks[0][0], x0 + CODE_X + max(x + ln for x, ln, _ in toks)))
    return bg.done(), code.done(), spans


def make_bugs(rng):
    """Eight small terracotta marks: a squiggle under a token, centred in the gap
    to the next line, or a dot after the line's last token."""
    order = [1, 3, 0, 2, 3, 1, 0, 2]
    used, bugs = set(), []
    for k, c in enumerate(order):
        x0, y0 = card_origin(c)
        while True:
            l = int(rng.integers(0, 10))
            toks = [tk for tk in CODES[c][l] if tk[1] >= 20]
            if toks and (c, l) not in used and (c, l - 1) not in used and (c, l + 1) not in used:
                break
        used.add((c, l))
        squiggle = rng.random() < 0.65
        span = float(rng.uniform(30, 50))
        below = [tk for tk in CODES[c][l + 1] if tk[2] == "kw"] if l < 9 else []
        # a squiggle never sits on a terracotta keyword or right above one, where the two would merge
        plain = [tk for tk in toks if tk[2] != "kw" and
                 not any(bx < tk[0] + min(tk[1], span) + 4 and tk[0] - 4 < bx + bl for bx, bl, _ in below)]
        if squiggle and plain:
            x, ln, kd = plain[int(rng.integers(len(plain)))]
        else:  # a dot sits after the line's last token, never between two
            squiggle = False
            x, ln, kd = CODES[c][l][-1]
        y = y0 + LINE_Y0 + l * LINE_PITCH
        xa = x0 + CODE_X + x
        v = Vec(xa - 4, y - 4, xa + ln + 16, y + LINE_PITCH + 2)
        if squiggle:
            span = min(ln, span)
            xs = np.linspace(xa + 2, xa + span, 48)
            mid = y + (BAR_H + LINE_PITCH) / 2  # halfway between this bar and the next
            v.line(list(zip(xs, mid + 2.4 * np.sin((xs - xa) / 6.5 * 2 * math.pi))), BUG, 2.5)
            x_end = xa + span + 2
        else:
            v.circle((xa + ln + 8, y + BAR_H / 2), 3.8, fill=BUG)
            xa, x_end = xa + ln + 3, xa + ln + 13
        bugs.append((c, BUG_T0 + k * BUG_DT, v.done(), xa, x_end))
    return bugs


def masked(sprite, mask, opacity):
    img, x, y = sprite
    a = np.asarray(img.getchannel("A"), np.float32) * mask * opacity
    out = img.copy()
    out.putalpha(Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8)))
    return out, x, y


# ── the record ────────────────────────────────────────────────────────────

def load_record():
    try:
        out = subprocess.run(["node", "-e", RECORD_JS, RECORD_TS], cwd=REPO, check=True,
                             capture_output=True, text=True).stdout
    except FileNotFoundError:
        sys.exit("shot10: needs Node.js ('node' on PATH) to generate the interval record from ingest/harness.js")
    except subprocess.CalledProcessError as e:
        sys.exit(f"shot10: node failed while generating the record (repo root {REPO}):\n{e.stderr}")
    return json.loads(out)


def check_record(data):
    """Stop unless the repo still yields what the docstring quotes (EXPECT)."""
    rec = data["record"]
    got = {"ts_start": rec["ts_start"], "dt_s": rec["dt_s"], "mwh": [rec["meters"][k]["mwh"] for k in "ab"],
           "raw_sha256": rec["source"]["raw_sha256"][:8], "spec_version": data["spec_version"],
           "digest": data["digest"][:8], "interval_gates": data["interval_gates"]}
    diff = [f"  {k}: expected {EXPECT[k]!r}, got {got[k]!r}" for k in EXPECT if got[k] != EXPECT[k]]
    if diff:
        sys.exit("shot10: the repo no longer yields the record and spec this docstring quotes:\n"
                 + "\n".join(diff) + "\nCheck the new values, then update EXPECT and the docstring to match.")


def record_text(rec):
    """A faithful subset in the order the builder emits it, as one compact JSON
    line, wrapped before "meters" and "source"."""
    sub = {"ts_start": rec["ts_start"], "dt_s": rec["dt_s"],
           "meters": {k: {"mwh": rec["meters"][k]["mwh"]} for k in ("a", "b")},
           "source": {"raw_sha256": rec["source"]["raw_sha256"][:8] + "…"}}
    one = json.dumps(sub, separators=(",", ":"), ensure_ascii=False)
    i, j = one.index('"meters"'), one.index('"source"')
    lines = [one[:i], " " + one[i:j], " " + one[j:]]
    assert "".join(ln.lstrip(" ") for ln in lines) == one
    return one, lines


def syntax_colours(one):
    """Per-character colour: keys muted, punctuation dim, strings paper, numbers terracotta."""
    cols, i = [], 0
    while i < len(one):
        ch = one[i]
        if ch == '"':
            j = one.index('"', i + 1)
            is_key = j + 1 < len(one) and one[j + 1] == ":"
            body = [KEY if is_key else PAPER] * (j - i - 1)
            if not is_key and one[j - 1] == "…":
                body[-1] = MUTED
            cols += [PUNCT] + body + [PUNCT]
            i = j + 1
        elif ch.isdigit():
            cols.append(TERRA_LIGHT)
            i += 1
        else:
            cols.append(PUNCT)
            i += 1
    return cols


def build_record_layer(lines, cols):
    """Crisp syntax-coloured text, which pixel belongs to which character, and
    where the glyphs are (targets for the ink)."""
    n = max(len(s) for s in lines)
    adv = REC_MAXW / n
    f = font(FM, REC_FONT * SS)
    x0 = CX - n * adv / 2
    asc = REC_FONT * 0.76
    y_first = BAND_CY - (REC_PITCH * (len(lines) - 1)) / 2 + asc / 2 - 2  # baseline of line 1
    rx, ry = math.floor(x0) - 4, math.floor(y_first - REC_FONT * 1.2)
    rw, rh = REC_MAXW + 40, REC_PITCH * (len(lines) - 1) + int(REC_FONT * 1.6) + 4
    best = np.zeros((rh, rw), np.float32)
    cid = np.full((rh, rw), -1, np.int32)
    rgb = np.zeros((rh, rw, 3), np.float32)
    k = 0
    for l, s in enumerate(lines):
        for i, ch in enumerate(s):
            if ch != " ":
                cx, cy = x0 + i * adv, y_first + l * REC_PITCH
                ix, iy = math.floor(cx) - 2, math.floor(cy - REC_FONT * 1.05)
                cw, chh = int(adv) + 8, int(REC_FONT * 1.4)
                m = Image.new("L", (cw * SS, chh * SS), 0)
                ImageDraw.Draw(m).text(((cx - ix) * SS, (cy - iy) * SS), ch, font=f, fill=255, anchor="ls")
                a = np.asarray(m.resize((cw, chh), Image.BOX), np.float32) / 255
                sy, sx = iy - ry, ix - rx
                reg = (slice(sy, sy + chh), slice(sx, sx + cw))
                win = a > best[reg]
                cid[reg][win] = k
                best[reg] = np.maximum(best[reg], a)
                rgb[reg][win] = cols[k]
            if not (l > 0 and i == 0):  # continuation lines start with a layout space
                k += 1
    return dict(x=rx, y=ry, alpha=best, cid=cid, rgb=rgb, nchar=k,
                top=y_first - asc - BAND_PAD, bottom=y_first + REC_PITCH * (len(lines) - 1) + REC_FONT * 0.24 + BAND_PAD)


# ── the ink: marks that fly into the record ───────────────────────────────

def build_particles(rng, layer):
    """Every mark is sampled into N_PER_BUBBLE particles in writing order. The
    record's glyph pixels are sorted left to right and dealt out in four equal
    columns, one per meter slot, so each meter writes a quarter of the line."""
    ys, xs = np.nonzero(layer["alpha"] >= 0.5)
    n_all = 4 * N_PER_BUBBLE
    pick = rng.choice(len(xs), n_all, replace=len(xs) < n_all)
    tx = layer["x"] + xs[pick] + rng.uniform(0, 1, n_all)
    ty = layer["y"] + ys[pick] + rng.uniform(0, 1, n_all)
    tc = layer["cid"][ys[pick], xs[pick]]
    order = np.argsort(tx + 0.001 * ty, kind="stable")
    tx, ty, tc = tx[order], ty[order], tc[order]

    P = {k: [] for k in ("rx", "ry", "tdep", "fly", "tx", "ty", "tc", "slot", "wob", "ph")}
    for c in range(4):
        s = SLOT[c]
        d = np.concatenate([st[0] for st in SCRIPTS[c]])
        u = np.concatenate([st[2] for st in SCRIPTS[c]])
        w = np.concatenate([np.full(len(st[0]), st[1]) for st in SCRIPTS[c]])
        uk = (np.arange(N_PER_BUBBLE) + 0.5) / N_PER_BUBBLE
        j = np.clip(np.searchsorted(u, uk), 0, len(u) - 1)
        jit = rng.normal(0, 1, (N_PER_BUBBLE, 2)) * (w[j] * 0.22)[:, None]
        P["rx"].append(INNER[0] + d[j, 0] + jit[:, 0])
        P["ry"].append(INNER[1] + d[j, 1] + jit[:, 1])
        P["tdep"].append(DEP0 + DEP_STAGGER * s + DEP_WIN * uk)
        seg = slice(s * N_PER_BUBBLE, (s + 1) * N_PER_BUBBLE)
        P["tx"].append(tx[seg]); P["ty"].append(ty[seg]); P["tc"].append(tc[seg])
        P["slot"].append(np.full(N_PER_BUBBLE, s))
        P["fly"].append(FLY + rng.uniform(-FLY_JIT, FLY_JIT, N_PER_BUBBLE))
        P["wob"].append(rng.uniform(*SPREAD[2], N_PER_BUBBLE))
        P["ph"].append(rng.uniform(0, 1, N_PER_BUBBLE))
    P = {k: np.concatenate(v) for k, v in P.items()}
    P["cxo"] = rng.normal(0, SPREAD[0], n_all)  # control points bunch near the centre column
    P["cyo"] = rng.normal(0, SPREAD[1], n_all)
    P["tarr"] = P["tdep"] + P["fly"]
    # a character turns crisp once most of its ink has landed
    tchar = np.full(layer["nchar"], np.nan)
    for k in range(layer["nchar"]):
        m = P["tc"] == k
        if m.any():
            tchar[k] = np.percentile(P["tarr"][m], 85)
    idx = np.arange(layer["nchar"])
    ok = ~np.isnan(tchar)
    tchar[~ok] = np.interp(idx[~ok], idx[ok], tchar[ok])
    return P, tchar


def particle_positions(t):
    """Each particle leaves from its point on the (moving) bubble and rides a
    quadratic curve whose control point sits near the centre column, so the
    four streams bow inward and funnel into the line."""
    P = PARTS
    act = np.nonzero((t >= P["tdep"]) & (t < P["tarr"] + 0.3))[0]
    if not len(act):
        return None
    slot, rx, ry = P["slot"][act], P["rx"][act], P["ry"][act]
    tx, ty = P["tx"][act], P["ty"][act]
    xs, ys, ws = [], [], []
    # a bright head and a fading tail; in flight the ink is boosted, back to 1 as it lands
    tail = np.linspace(1, 0.2, SUBSTEPS - 1)
    sub_w = np.concatenate([[HEAD], tail * (1 - HEAD) / tail.sum()])
    u_now = clamp((t - P["tdep"][act]) / P["fly"][act])
    boost = 1 + (FLIGHT_BOOST - 1) * (1 - smooth(0.7, 1.0, u_now))
    fade = (1 - smooth(P["tarr"][act], P["tarr"][act] + 0.28, t)) * boost
    # the start point follows the bubble at frame time: only the flight itself is
    # motion-blurred, since the bubble the ink leaves is drawn sharp
    p0x, p0y = np.empty(len(act)), np.empty(len(act))
    for c in range(4):
        m = slot == SLOT[c]
        mx, my, ms, _ = meter_state(c, t)
        p0x[m], p0y[m] = mx + ms * rx[m], my + ms * ry[m]
    for j in range(SUBSTEPS):
        tj = t - j * SHUTTER / FPS / (SUBSTEPS - 1)
        cx = CX + P["cxo"][act]
        cy = (p0y + ty) / 2 + P["cyo"][act]
        u = clamp((tj - P["tdep"][act]) / P["fly"][act])
        e = ease_io(0, 1, u)
        a, b, cc = (1 - e) ** 2, 2 * (1 - e) * e, e * e
        dx, dy = tx - p0x, ty - p0y
        ln = np.hypot(dx, dy) + 1e-6
        sway = P["wob"][act] * np.sin(math.pi * e) * np.sin(2 * math.pi * (1.5 * e + P["ph"][act]))
        xs.append(a * p0x + b * cx + cc * tx - dy / ln * sway)
        ys.append(a * p0y + b * cy + cc * ty + dx / ln * sway)
        ws.append(fade * sub_w[j])
    return np.concatenate(xs), np.concatenate(ys), np.concatenate(ws)


def splat(img, xs, ys, ws, color, gain=3.2):
    """Bilinear splat, a 3x3 soften, then soft saturation, composited over img."""
    x0, y0 = max(int(xs.min()) - 3, 0), max(int(ys.min()) - 3, 0)
    x1, y1 = min(int(xs.max()) + 4, W), min(int(ys.max()) + 4, H)
    if x1 <= x0 or y1 <= y0:
        return
    bw, bh = x1 - x0, y1 - y0
    fx, fy = xs - 0.5 - x0, ys - 0.5 - y0
    ix, iy = np.floor(fx).astype(int), np.floor(fy).astype(int)
    ax, ay = fx - ix, fy - iy
    acc = np.zeros((bh + 2) * (bw + 2), np.float64)
    for dx, dy, wgt in ((0, 0, (1 - ax) * (1 - ay)), (1, 0, ax * (1 - ay)), (0, 1, (1 - ax) * ay), (1, 1, ax * ay)):
        jx, jy = np.clip(ix + dx + 1, 0, bw + 1), np.clip(iy + dy + 1, 0, bh + 1)
        acc += np.bincount(jy * (bw + 2) + jx, weights=ws * wgt, minlength=acc.size)
    acc = acc.reshape(bh + 2, bw + 2).astype(np.float32)
    soft = (4 * acc[1:-1, 1:-1] + 2 * (acc[:-2, 1:-1] + acc[2:, 1:-1] + acc[1:-1, :-2] + acc[1:-1, 2:])
            + acc[:-2, :-2] + acc[:-2, 2:] + acc[2:, :-2] + acc[2:, 2:]) / 16
    a = (1 - np.exp(-gain * soft))[..., None]
    reg = img[y0:y1, x0:x1]
    reg *= 1 - a
    reg += np.array(color, np.float32) * a


# ── shot 11 furniture: band, links, source line, badge ───────────────────

def band(img, t):
    k = float(smooth(*BAND_IN, t))
    if k <= 0:
        return
    y0, y1 = int(round(LAYER["top"])), int(round(LAYER["bottom"]))
    yy = np.arange(y0, y1) + 0.5
    ramp = smooth(0, 22, yy - y0) * smooth(0, 22, y1 - yy)  # soft top and bottom edges
    a = (0.9 * k * ramp).astype(np.float32)[:, None, None]
    reg = img[y0:y1]
    reg *= 1 - a
    reg += np.array(BAND, np.float32) * a
    tick = float(smooth(10.0, 10.5, t))
    if tick > 0:  # terracotta tick at the left end, like a highlighted line
        reg2 = img[y0 + 20:y1 - 20, 24:29]
        reg2 *= 1 - tick
        reg2 += np.array(TERRACOTTA, np.float32) * tick


def text_layer(img, t):
    ca = smooth(TCHAR - 0.1, TCHAR + 0.25, t)
    if ca.max() <= 0:
        return
    L = LAYER
    lut = np.concatenate([ca, [0.0]]).astype(np.float32)
    a = (L["alpha"] * lut[L["cid"]])[..., None]
    reg = img[L["y"]:L["y"] + a.shape[0], L["x"]:L["x"] + a.shape[1]]
    reg *= 1 - a
    reg += L["rgb"] * a


def link_ends(s):
    sx = CX + (s - 1.5) * ROW_DX
    c = SLOT.index(s)
    return (sx, ROW_Y + S_SMALL * METER_BOTTOM[KIND[c]] + 12), (CX + (s - 1.5) * 64, LAYER["top"] + 4)


def draw_links(t):
    ps = [float(ease_io(LINKS[0] + LINKS[2] * s, LINKS[0] + LINKS[2] * s + LINKS[1], t)) for s in range(4)]
    v = Vec(CX - 2 * ROW_DX, ROW_Y, CX + 2 * ROW_DX, LAYER["top"] + 10)
    for s, p in enumerate(ps):
        if p <= 0:
            continue
        (xa, ya), (xb, yb) = link_ends(s)
        v.line([(xa, ya), (xa + (xb - xa) * p, ya + (yb - ya) * p)], LINK, 2.0)
        k = float(smooth(0.85, 1.0, p))
        if k > 0:
            v.circle((xb, yb), 3.6 * k, fill=TERRA_LIGHT)
    return v.done()


def source_sprite():
    f = font(FR, 25 * SS)
    s = "interval record · simulated test data"
    y = LAYER["bottom"] + 40
    w = f.getlength(s) / SS
    v = Vec(CX - w / 2, y - 26, CX + w / 2, y + 8)
    v.text((CX - w / 2, y), s, f, MUTED)
    return v.done()


def badge_parts():
    """[(text, font, colour)] for the badge: Sans labels, Mono values."""
    fs, fm = font(FR, 28 * SS), font(FM, 28 * SS)
    return [(f"{DATA['interval_gates']} physics gates", fs, LABEL), ("  ·  spec ", fs, MUTED),
            (DATA["spec_version"], fm, TERRA_LIGHT), ("  ·  ", fs, MUTED), (DATA["digest"][:8], fm, TERRA_LIGHT)]


def draw_badge(t):
    parts = badge_parts()
    tw = sum(f.getlength(s) for s, f, _ in parts) / SS
    lock_w, gap, padx, hh = 24, 16, 30, 62
    bw = padx * 2 + lock_w + gap + tw
    cy = LAYER["bottom"] + 120 + 12 * (1 - float(ease_out(*BADGE_IN, t)))
    x0 = CX - bw / 2
    v = Vec(x0 - 4, cy - hh / 2 - 22, x0 + bw + 4, cy + hh / 2 + 4)
    glow = 1 - float(smooth(*GLOW, t)) if t >= GLOW[0] else 0.0
    edge = tuple(int(COFFEE[i] + (TERRA_LIGHT[i] - COFFEE[i]) * (0.72 + 0.28 * glow)) for i in range(3))
    v.rrect((x0, cy - hh / 2), (x0 + bw, cy + hh / 2), hh / 2, fill=COFFEE, outline=edge, width=2.2)
    # padlock: the shackle drops shut at LOCK[1], accelerating, no bounce
    lift = 8 * (1 - float(ease_in(*LOCK, t)))
    lx = x0 + padx
    v.rrect((lx, cy - 4), (lx + lock_w, cy + 14), 3.5, fill=TERRA_LIGHT)
    sx0, sx1, top = lx + 5, lx + lock_w - 5, cy - 16 - lift
    arc = [(lx + lock_w / 2 + (sx1 - sx0) / 2 * math.cos(a), top + 7 - 7 * math.sin(a))
           for a in np.linspace(math.pi, 0, 24)]
    v.line([(sx0, cy - 3 - lift)] + arc + [(sx1, cy - 3 - lift)], TERRA_LIGHT, 3.2)
    x = lx + lock_w + gap
    for s, f, col in parts:
        v.text((x, cy + 10), s, f, col)
        x += f.getlength(s) / SS
    return v.done()


# ── frames ────────────────────────────────────────────────────────────────

def background():
    """Shot 9's ground, so the cut in is seamless: coffee fading to espresso, a warm glow."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    v = yy / H
    top, bot = np.array(COFFEE, np.float32) * 0.86, np.array(ESPRESSO, np.float32)
    img = top * (1 - v[..., None]) + bot * v[..., None]
    glow = np.exp(-(((xx - W * 0.45) / 620) ** 2 + ((yy - H * 0.42) / 760) ** 2))
    img += glow[..., None] * np.array([16, 9, 4], np.float32)
    r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    vignette = (1 - 0.22 * np.clip(r2, 0, 1.6) ** 1.3)[..., None]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)), vignette.astype(np.float32)


class Cache:
    """Keeps the last sprite per slot; static stretches reuse it."""

    def __init__(self):
        self.d = {}

    def get(self, slot, key, make):
        if slot in self.d and self.d[slot][0] == key:
            return self.d[slot][1]
        val = make()
        self.d[slot] = (key, val)
        return val


def render(i, cache):
    t = i / FPS
    frame = BG.copy()

    # code cards and bugs (0-8.5 s)
    out = 1 - float(smooth(*CODE_OUT, t))
    for c in range(4):
        cin = float(smooth(CODE_T0 + 0.07 * c, CODE_T0 + 0.07 * c + 0.3, t)) * out
        if cin <= 0:
            continue
        bg, code, spans = CARDS[c]
        put(frame, bg, cin)
        n = len(spans)
        img, ox, oy = code
        mask = np.zeros((img.size[1], img.size[0]), np.float32)
        cols = np.arange(img.size[0]) + ox
        for l, (y, xa, xb) in enumerate(spans):
            tl = CODE_T0 + 0.25 + 0.07 * c + l * (CODE_T1 - CODE_T0 - 0.45) / n
            p = float(ease_out(tl, tl + 0.2, t))
            if p <= 0:
                continue
            xr = xa - 6 + (xb - xa + 8) * p
            r0, r1 = int(y - oy - 3), int(y - oy + BAR_H + 3)
            mask[r0:r1] = np.clip((xr - cols) / 4 + 0.5, 0, 1)
            mask[r0:r1, :int(xa - ox - 10)] = 1  # gutter dot shows with its line
        put(frame, masked(code, mask, 1.0), cin)
        for bc, tb, spr, xa, xb in BUGS:
            if bc != c or t < tb:
                continue
            p = float(ease_out(tb, tb + BUG_DRAW, t))
            img, ox, oy = spr
            cols = np.arange(img.size[0]) + ox
            m = np.broadcast_to(np.clip((xa + (xb - xa + 4) * p - cols) / 2 + 0.5, 0, 1), (img.size[1], img.size[0]))
            put(frame, masked(spr, m, 0.95), out)

    # links behind the meters (shot 11)
    if t >= LINKS[0]:
        key = tuple(round(float(ease_io(LINKS[0] + LINKS[2] * s, LINKS[0] + LINKS[2] * s + LINKS[1], t)), 4)
                    for s in range(4))
        put(frame, cache.get("links", key, lambda: draw_links(t)), 1.0)

    # meters and their bubbles
    for c in range(4):
        mx, my, ms, ma = (float(v) for v in meter_state(c, t))
        if ma <= 0.003:
            continue
        key = (round(mx, 2), round(my, 2), round(ms, 4))
        spr = cache.get(("m", c), key, lambda: _meter_sprite(c, mx, my, ms))
        put(frame, spr, ma)
        t_pop = ARRIVE[c] + POP
        pop = 0.86 + 0.14 * float(ease_out(t_pop, t_pop + 0.3, t))
        s_ = SLOT[c]
        d0 = DEP0 + DEP_STAGGER * s_
        ba = float(ease_out(t_pop, t_pop + 0.3, t)) * (1 - float(smooth(d0 + DEP_WIN - 0.3, d0 + DEP_WIN + 0.15, t)))
        if ba <= 0.003:
            continue
        hi = float(clamp((t - ARRIVE[c] - WRITE_AT) / WRITE_DUR))
        lo = float(clamp((t - d0) / DEP_WIN)) if t >= d0 else -1.0
        key = (round(mx, 2), round(my, 2), round(ms * pop, 4), round(lo, 4), round(hi, 4))
        spr = cache.get(("b", c), key, lambda: draw_bubble(c, mx, my, ms, pop, lo, hi))
        put(frame, spr, ba)

    if t >= SOURCE_IN[0]:
        put(frame, SOURCE, float(smooth(*SOURCE_IN, t)))
    if t >= BADGE_IN[0]:
        key = (round(float(ease_out(*BADGE_IN, t)), 4), round(float(ease_in(*LOCK, t)), 4),
               round(float(smooth(*GLOW, t)), 3))
        put(frame, cache.get("badge", key, lambda: draw_badge(t)), float(smooth(*BADGE_IN, t)))

    img = np.array(frame, np.float32)
    band(img, t)
    text_layer(img, t)
    pp = particle_positions(t)
    if pp is not None:
        splat(img, *pp, INK)

    if t > DRIFT[0]:  # slow push-in about the record
        z = 1 + DRIFT[2] * ((t - DRIFT[0]) / (DRIFT[1] - DRIFT[0])) ** 1.6
        cx, cy = DRIFT_C
        pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
        pil = pil.transform((W, H), Image.AFFINE, (1 / z, 0, cx - cx / z, 0, 1 / z, cy - cy / z),
                            resample=Image.BICUBIC)
        img = np.array(pil, np.float32)

    img *= VIGNETTE
    img += np.random.default_rng(1000 + i).standard_normal((H, W, 1), dtype=np.float32) * GRAIN
    return np.clip(img, 0, 255).astype(np.uint8)


def _meter_sprite(c, mx, my, s):
    v = Vec(mx - 92 * s, my - 122 * s, mx + 92 * s, my + 124 * s)
    draw_meter(v, KIND[c], mx, my, s)
    return v.done()


def check_safe_zones():
    """Stop if anything that matters reaches into the platform's bands (with the
    full push-in applied, which only grows things)."""
    def bbox(sprite):
        img, x, y = sprite
        b = img.getchannel("A").getbbox()
        return b[0] + x, b[1] + y, b[2] + x, b[3] + y

    boxes = {"source line": bbox(SOURCE), "badge": bbox(draw_badge(DUR)), "links": bbox(draw_links(DUR))}
    ys, xs = np.nonzero(LAYER["alpha"] > 0)
    boxes["record"] = (LAYER["x"] + xs.min(), LAYER["y"] + ys.min(), LAYER["x"] + xs.max() + 1, LAYER["y"] + ys.max() + 1)
    for c in range(4):
        boxes[f"card {c}"] = bbox(CARDS[c][0])
        for t in (2.5, 12.0):  # in the grid, then small in the top row
            mx, my, ms, _ = (float(v) for v in meter_state(c, t))
            boxes[f"meter {c} at {t} s"] = bbox(_meter_sprite(c, mx, my, ms))
        mx, my, ms, _ = (float(v) for v in meter_state(c, 2.5))
        boxes[f"bubble {c}"] = bbox(draw_bubble(c, mx, my, ms, 1.0, -1.0, 1.0))
    z, (cx, cy) = 1 + DRIFT[2], DRIFT_C
    for name, (x0, y0, x1, y1) in boxes.items():
        x1, y0, y1 = cx + (x1 - cx) * z, cy + (y0 - cy) * z, cy + (y1 - cy) * z
        if y0 < SAFE_TOP or x1 > W - SAFE_RIGHT or y1 > H - SAFE_BOTTOM:
            sys.exit(f"shot10: the {name} reaches into a safe zone: x up to {x1:.0f}, y {y0:.0f}-{y1:.0f}")


def setup():
    global DATA, RECORD_ONE, RECORD_LINES, LAYER, SCRIPTS, CODES, CARDS, BUGS, PARTS, TCHAR
    global BG, VIGNETTE, SOURCE
    DATA = load_record()
    check_record(DATA)
    RECORD_ONE, RECORD_LINES = record_text(DATA["record"])
    print("shot10: record", json.dumps(DATA["record"], ensure_ascii=False), file=sys.stderr)
    print("shot10: on screen", RECORD_ONE, "|", "".join(s for s, _, _ in badge_parts()), file=sys.stderr)
    LAYER = build_record_layer(RECORD_LINES, syntax_colours(RECORD_ONE))
    SCRIPTS = [prepare_script(k, np.random.default_rng(40 + c)) for c, k in enumerate(SCRIPT)]
    CODES = [code_lines(st, np.random.default_rng(60 + c)) for c, st in enumerate(CODE_STYLE)]
    CARDS = [render_card(c) for c in range(4)]
    BUGS = make_bugs(np.random.default_rng(7))
    PARTS, TCHAR = build_particles(np.random.default_rng(10), LAYER)
    BG, VIGNETTE = background()
    SOURCE = source_sprite()
    check_safe_zones()


def main():
    a = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    b = int(sys.argv[2]) if len(sys.argv) > 2 else N_FRAMES
    if not 0 <= a < b <= N_FRAMES:
        sys.exit(f"frame range must lie within 0..{N_FRAMES}")
    setup()
    cache = Cache()
    for i in range(a, b):
        sys.stdout.buffer.write(render(i, cache).tobytes())


if __name__ == "__main__":
    main()
