"""QWATT week 1 video, shot 9 (0:44-0:47), vertical 1080x1920: three quick
motion-graphic beats under Diego's line "Different wiring, different
registers, different units."

The PZEM-017 sits on the left and the EPEver Tracer on the right in all three
beats, so the eye compares across. Each beat is about one second, cut on the
words:

  0.0-1.0  wiring     photo slot, bus, baud, framing, unit id
  1.0-2.0  registers  function code, then where voltage, current, power and the
                      energy counter live (hex address, decimal as stored, type)
  2.0-3.0  units      what one raw count of power and of the energy counter is
                      worth (type x scale -> unit), then a calm hold for the cut

Terracotta marks each value that differs. A circle badge between the cards
sums up the row in one glyph: "≠" where anything shown on it differs, "=" where
all of it is the same. Nothing is typed in by hand: the values are read from
ingest/maps/pzem-017.json and ingest/maps/epever-tracer.json at render time,
and the highlights come from comparing them, so the graphic always matches the
repo. The EPEver addresses
still have to be confirmed against the controller's manual (ingest/README.md),
so beats 2 and 3 carry a source line and make no claim of a hardware check.

Photo slots: we have no product photos yet and none is drawn here. Pass
--pzem PATH and --epever PATH to fill the slots (cover-cropped to a square);
without them each slot shows a dashed outline and "product photo". Only use
photos the team took itself or has the rights to use.

Writes raw RGB frames to stdout. Needs numpy and Pillow. Render with:

    python3 docs/video/shot09-meter-dialects.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1080x1920 -r 30 -i - -f lavfi -i "aevalsrc='st(0,mod(t,1));\\
    0.2*(1-exp(-900*ld(0)))*exp(-45*ld(0))*(0.7*sin(2*PI*1250*t)+0.3*sin(2*PI*620*t))':s=48000:d=3" \\
      -filter_complex "[1]lowpass=f=5000[a]" -map 0:v -map "[a]" -c:v libx264 -preset slow \\
      -crf 18 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k -shortest \\
      QWATT-week1-shot09-meter-dialects.mp4

With photos, add --pzem PHOTO --epever PHOTO after the script name.

The audio is three soft UI ticks, one on each beat change (0.0, 1.0, 2.0 s),
peaking around -16 dBFS.
"""
import argparse
import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

FPS = 30
DUR = 3.0
W, H = 1080, 1920
BEAT = 1.0  # seconds per beat
NOUNS = ("wiring", "registers", "units")

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MAPS = ("ingest/maps/pzem-017.json", "ingest/maps/epever-tracer.json")
# on-screen model names, left card then right card; each must appear in its map's description
MODELS = ("PZEM-017", "EPEver Tracer")
UNITS = {"v": "V", "a": "A", "w": "W", "wh": "Wh"}  # field-name suffix -> unit, as the maps name them

PAPER = (250, 248, 242)
ESPRESSO = (22, 16, 10)
COFFEE = (41, 29, 19)
TERRACOTTA = (176, 88, 47)
TERRA_LT = (208, 138, 87)  # accent on dark backgrounds
CARD_FILL = (47, 34, 23)
MUTED = (166, 156, 144)  # secondary text on the cards

FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FMB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

# Layout. Safe area: below y=120, left of x=940, above y=1500. All text and shapes stay
# inside it; only the cards' soft drop shadow (at most ~10 levels darker) reaches ~30 px past x=940.
LEFT = 64
CARD_W, CARD_H = 418, 1010
CARD_X = (LEFT, 940 - CARD_W)  # 64 and 522: a 40 px gutter for the badges
GUTTER_CX = (CARD_X[0] + CARD_W + CARD_X[1]) // 2
CARD_Y = 350
PAD = 26
INNER = CARD_W - 2 * PAD  # 366, the text column
ROW_M = 14  # row sprites reach this far either side of the column, for the highlight pills
BODY_Y = CARD_Y + 152
SOURCE_Y = CARD_Y + CARD_H + 22  # source line under the cards, above the caption zone

# Motion, in frames
STAGGER = 1.25  # between rows arriving
RIGHT_LAG = 1.0  # right card's row lands a frame after the left one
IN_DUR, OUT_DUR = 6, 4
# outgoing rows start leaving this many frames before the cut into beat 2 and beat 3; beat 2's
# rows go earlier so they have cleared before beat 3's blocks land in the same place
OUT_LEAD = (3, 5)
SLIDE_IN, SLIDE_OUT = 150, 120
SHUTTER = 0.5  # motion blur length as a fraction of the per-frame move (180-degree shutter)


def font(path, size):
    return ImageFont.truetype(path, size)


def clamp01(x):
    return min(max(x, 0.0), 1.0)


def ease_out(x):
    return 1 - (1 - x) ** 3


class Sprite:
    """A premultiplied RGBA float layer. Every shape is drawn as its own coverage
    mask and composited, so antialiased edges keep their colour on transparency."""

    def __init__(self, w, h, ox=0):
        self.w, self.h = w, h
        self.ox = ox  # drawing origin, so a highlight can reach left of the text column
        self.px = np.zeros((h, w, 4), np.float32)

    def over(self, mask, color, alpha=1.0):
        m = np.asarray(mask, np.float32)[..., None] * (alpha / 255)
        src = np.concatenate([np.array(color, np.float32) * m, m], axis=-1)
        self.px = src + self.px * (1 - m)

    def _mask(self):
        m = Image.new("L", (self.w, self.h), 0)
        return m, ImageDraw.Draw(m)

    def text(self, xy, s, f, color, alpha=1.0, anchor="la", track=0):
        m, d = self._mask()
        xy = (xy[0] + self.ox, xy[1])
        if track:  # letter-spaced caps, for small labels
            x, y = xy
            if anchor[0] == "r":
                x -= tracked_len(s, f, track)
            for ch in s:
                d.text((x, y), ch, font=f, fill=255, anchor="l" + anchor[1])
                x += f.getlength(ch) + track
        else:
            d.text(xy, s, font=f, fill=255, anchor=anchor)
        self.over(m, color, alpha)

    def runs(self, xy, parts, f, anchor="ls"):
        """Several colours on one line: parts = [(text, color, alpha)]."""
        x, y = xy  # text() adds ox
        if anchor[0] == "r":
            x -= sum(f.getlength(p[0]) for p in parts)
        for s, color, alpha in parts:
            self.text((x, y), s, f, color, alpha, anchor="l" + anchor[1])
            x += f.getlength(s)

    def rrect(self, box, r, color, alpha=1.0, width=0):
        m, d = self._mask()
        box = [box[0] + self.ox, box[1], box[2] + self.ox, box[3]]
        if width:
            d.rounded_rectangle(box, r, outline=255, width=width)
        else:
            d.rounded_rectangle(box, r, fill=255)
        self.over(m, color, alpha)

    def line(self, y, color, alpha):
        m, d = self._mask()
        d.line([(self.ox, y), (self.w - self.ox, y)], fill=255, width=2)
        self.over(m, color, alpha)


def tracked_len(s, f, track):
    return sum(f.getlength(ch) + track for ch in s) - track


# ---------------------------------------------------------------- data

def load_maps():
    maps = []
    for rel, model in zip(MAPS, MODELS):
        with open(os.path.join(REPO, rel), encoding="utf-8") as fh:
            m = json.load(fh)
        if model not in m["description"]:
            raise SystemExit(f"{rel}: description does not name {model}; fix MODELS")
        m["_file"] = os.path.basename(rel)
        maps.append(m)
    return maps


def bus(m):
    """The bus is only stated in the description, e.g. "RS-485 Modbus RTU"."""
    hit = re.search(r"RS-?485", m["description"])
    return hit.group(0) if hit else None  # as written in the map


def wiring_rows(maps):
    """(label, left value, right value) for beat 1, from protocol and serial."""
    def framing(s):
        return f"{s['data_bits']}{s['parity']}{s['stop_bits']}"
    rows = []
    if all(bus(m) for m in maps):
        rows.append(("BUS", *[bus(m) for m in maps]))
    rows.append(("BAUD", *[str(m["protocol"]["serial"]["baud"]) for m in maps]))
    rows.append(("FRAMING", *[framing(m["protocol"]["serial"]) for m in maps]))
    rows.append(("UNIT ID", *[str(m["protocol"]["unit_id"]) for m in maps]))
    return rows


def field(m, key):
    f = m["fields"][key]
    words = f.get("words") or (1 if f["type"] in ("u16", "i16") else 2)
    scale = f.get("scale", 1)  # registermap.js treats a missing scale as 1
    suffix = key.rsplit("_", 1)[1]
    if suffix not in UNITS:
        raise SystemExit(f"{m['_file']}: no unit known for field {key}")
    return dict(key=key, address=f["address"], type=f["type"], words=words,
                scale=format(scale, "g"), unit=UNITS[suffix])


def register_rows(maps):
    """The same quantity in both maps: voltage, current, the power field each
    map integrates energy from, and each map's energy counter."""
    picks = (lambda m: "voltage_v", lambda m: "current_a",
             lambda m: m["power_field"], lambda m: m.get("counter_field"))
    rows = []
    for pick in picks:
        keys = [pick(m) for m in maps]
        if all(k and k in m["fields"] for k, m in zip(keys, maps)):
            rows.append([field(m, k) for k, m in zip(keys, maps)])
    return rows


# ---------------------------------------------------------------- elements

class El:
    """One moving piece: a sprite, where it rests, and when it arrives and leaves."""

    def __init__(self, spr, x, y, t_in, t_out=None, slide=SLIDE_IN, slide_out=SLIDE_OUT,
                 axis=1, clip=None, wipe_at=None):
        self.spr, self.x, self.y = spr, x, y
        self.t_in, self.t_out = t_in, t_out
        self.slide, self.slide_out, self.axis = slide, slide_out, axis
        self.clip, self.wipe_at = clip, wipe_at

    def offset(self, f):
        """Displacement (px) and opacity at frame f (float)."""
        p = clamp01((f - self.t_in) / IN_DUR)
        off = self.slide * (1 - ease_out(p))
        a = clamp01(p * 1.6)
        if self.t_out is not None:
            q = clamp01((f - self.t_out) / OUT_DUR)
            off -= self.slide_out * q * q
            a *= 1 - q
        return off, a


def card_clip(side):
    x = CARD_X[side]
    return (x + 2, CARD_Y + 134, x + CARD_W - 2, CARD_Y + CARD_H - 2)


def beat_times(beat, group, side):
    """Arrival and departure frames for one row of one beat."""
    start = beat * BEAT * FPS + (3 if beat == 0 else 0)  # beat 1 waits for the cards
    t_in = start + group * STAGGER + side * RIGHT_LAG
    t_out = None if beat == len(NOUNS) - 1 else (beat + 1) * BEAT * FPS - OUT_LEAD[beat] + group * 0.5
    return t_in, t_out


def badge(same):
    s = Sprite(52, 52)
    if same:
        s.rrect([3, 3, 49, 49], 23, ESPRESSO, 1.0)
        s.rrect([3, 3, 49, 49], 23, PAPER, 0.28, width=2)
        s.text((26, 27), "=", font(FB, 26), PAPER, 0.55, anchor="mm")
    else:
        s.rrect([3, 3, 49, 49], 23, TERRACOTTA, 1.0)
        s.text((26, 27), "≠", font(FB, 30), PAPER, 1.0, anchor="mm")
    return s


def add_row(els, beat, group, sprites, y, cy=None, same=None, pills=None):
    """A row across both cards: left and right sprites, optional highlight pills
    under them, and a badge in the gutter centred at y + cy."""
    for side in (0, 1):
        t_in, t_out = beat_times(beat, group, side)
        x = CARD_X[side] + PAD - ROW_M
        if pills and pills[side] is not None:
            els.append(El(pills[side], x, y, t_in, t_out, clip=card_clip(side), wipe_at=t_in + 4))
        els.append(El(sprites[side], x, y, t_in, t_out, clip=card_clip(side)))
    if same is not None:
        t_in, t_out = beat_times(beat, group, 1)
        els.append(El(badge(same).px, GUTTER_CX - 26, y + cy - 26, t_in + 3, t_out, slide=0, slide_out=0))


def row_sprite(h):
    return Sprite(INNER + 2 * ROW_M, h, ox=ROW_M)


def pill(h, box):
    s = row_sprite(h)
    s.rrect(box, 12, TERRACOTTA, 0.30)
    return s.px


def dashed_rrect(box, r, dash=16, gap=11):
    """Dashes along a rounded rectangle's outline, evenly spaced all the way round."""
    x0, y0, x1, y1 = box
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        pts += [(cx + r * math.cos(math.radians(a0 + k)), cy + r * math.sin(math.radians(a0 + k)))
                for k in range(0, 91, 5)]
    pts.append(pts[0])
    p = np.array(pts)
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p, axis=0).T))])
    n = max(1, round(s[-1] / (dash + gap)))
    period = s[-1] / n
    out = []
    for i in range(n):
        u = np.linspace(i * period, i * period + period * dash / (dash + gap), 8)
        out.append(list(zip(np.interp(u, s, p[:, 0]), np.interp(u, s, p[:, 1]))))
    return out


def photo_slot(path):
    size = INNER
    s = Sprite(size, size)
    if path:
        img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        img = ImageOps.fit(img, (size, size), Image.LANCZOS)  # cover-crop to the square
        m = Image.new("L", (size, size), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], 20, fill=255)
        a = np.asarray(m, np.float32)[..., None] / 255
        s.px = np.concatenate([np.asarray(img, np.float32) * a, a], axis=-1)
        s.rrect([0, 0, size - 1, size - 1], 20, PAPER, 0.14, width=2)
    else:
        s.rrect([0, 0, size - 1, size - 1], 20, PAPER, 0.035)
        m = Image.new("L", (size, size), 0)
        d = ImageDraw.Draw(m)
        for dash in dashed_rrect([2, 2, size - 3, size - 3], 20):
            d.line(dash, fill=255, width=3, joint="curve")
        s.over(m, PAPER, 0.38)
        s.text((size / 2, size / 2), "product photo", font(FR, 30), PAPER, 0.55, anchor="mm")
    return s.px


def beat_wiring(maps, photos):
    els = []
    for side in (0, 1):
        t_in, t_out = beat_times(0, 0, side)
        els.append(El(photo_slot(photos[side]), CARD_X[side] + PAD, BODY_Y, t_in, t_out,
                      clip=card_clip(side)))
    row_h, y0 = 108, BODY_Y + INNER + 22
    fl, fv = font(FB, 29), font(FMB, 54)
    vx = INNER - ROW_M  # values end here, so a highlight pill ends on the column edge
    for g, (label, *vals) in enumerate(wiring_rows(maps), start=1):
        same = len({re.sub(r"\W", "", v).upper() for v in vals}) == 1  # spelling aside: "RS485" = "RS-485"
        sprites, pills = [], []
        for v in vals:
            s = row_sprite(row_h)
            if g > 1:
                s.line(1, PAPER, 0.10)
            s.text((0, row_h / 2), label, fl, MUTED, 1.0, anchor="lm", track=2)
            s.text((vx, row_h / 2), v, fv, PAPER if same else TERRA_LT,
                   0.82 if same else 1.0, anchor="rm")
            sprites.append(s.px)
            vw = fv.getlength(v)
            pills.append(None if same else pill(row_h, [vx - vw - ROW_M, 20, INNER, row_h - 20]))
        add_row(els, 0, g, sprites, y0 + (g - 1) * row_h, row_h / 2, same, pills)
    return els


def beat_registers(maps):
    els = []
    fl, fv = font(FB, 29), font(FMB, 48)
    fn = [f"{m['protocol']['function']:02d}" for m in maps]
    head_h = 92
    same = fn[0] == fn[1]
    vx = INNER - ROW_M  # as in beat 1: a pill ends on the column edge
    sprites, pills = [], []
    for v in fn:
        s = row_sprite(head_h)
        s.text((0, head_h / 2), "FUNCTION", fl, MUTED, 1.0, anchor="lm", track=2)
        s.text((vx, head_h / 2), v, fv, PAPER if same else TERRA_LT, 0.82 if same else 1.0, anchor="rm")
        sprites.append(s.px)
        pills.append(None if same else pill(head_h, [vx - fv.getlength(v) - ROW_M, 16, INNER, head_h - 16]))
    add_row(els, 1, 0, sprites, BODY_Y - 6, head_h / 2, same, pills)

    row_h, y0 = 172, BODY_Y + head_h
    fk, fa, fd, ft = font(FM, 28), font(FMB, 58), font(FM, 28), font(FM, 26)
    for g, pair in enumerate(register_rows(maps), start=1):
        same_addr = pair[0]["address"] == pair[1]["address"]
        same_kind = (pair[0]["type"], pair[0]["words"]) == (pair[1]["type"], pair[1]["words"])
        sprites, pills = [], []
        for r in pair:
            s = row_sprite(row_h)
            s.line(1, PAPER, 0.10)
            s.text((0, 18), r["key"], fk, MUTED, 1.0)
            hexa = f"0x{r['address']:04X}"
            s.text((0, 112), hexa, fa, PAPER if same_addr else TERRA_LT, 1.0, anchor="ls")
            s.text((INNER, 112), f"({r['address']})", fd, MUTED, 0.9, anchor="rs")  # decimal, as stored in the map
            s.text((0, 134), f"{r['type']} · {r['words']} word{'s' if r['words'] > 1 else ''}",
                   ft, *((MUTED, 0.9) if same_kind else (TERRA_LT, 1.0)))
            sprites.append(s.px)
            hw = fa.getlength(hexa)
            pills.append(None if same_addr else pill(row_h, [-12, 58, hw + 12, 126]))
        add_row(els, 1, g, sprites, y0 + (g - 1) * row_h, 92, same_addr and same_kind, pills)
    return els


def beat_units(maps):
    """Power (the field each map integrates energy from) and the energy counter:
    what one raw count is worth on each device."""
    els, blocks = [], []
    for label, pick in (("POWER", "power_field"), ("ENERGY COUNTER", "counter_field")):
        keys = [m.get(pick) for m in maps]
        if all(k and k in m["fields"] for k, m in zip(keys, maps)):
            blocks.append((label, [field(m, k) for k, m in zip(keys, maps)]))
    fl, fk, fx, fc, fh = font(FB, 29), font(FM, 28), font(FMB, 40), font(FR, 30), font(FMB, 92)
    blk_h, gap = 330, 84
    for g, (label, pair) in enumerate(blocks):
        # each of type, scale and unit is marked on its own where the two differ
        diff = {k: pair[0][k] != pair[1][k] for k in ("type", "scale", "unit")}
        def tint(k, plain=(PAPER, 0.85)):
            return (TERRA_LT, 1.0) if diff[k] else plain
        hero_diff = diff["scale"] or diff["unit"]
        sprites, pills = [], []
        for r in pair:
            s = row_sprite(blk_h + gap)
            if g < len(blocks) - 1:
                s.line(blk_h + gap // 2, PAPER, 0.10)
            s.text((0, 6), label, fl, TERRA_LT, 1.0, track=2)
            s.text((0, 52), r["key"], fk, MUTED, 1.0)
            s.runs((0, 140), [(r["type"], *tint("type")), (" × ", MUTED, 1.0),
                              (r["scale"], *tint("scale", (PAPER, 0.9))),
                              (" → ", MUTED, 1.0), (r["unit"], *tint("unit"))], fx)
            s.text((0, 170), "1 raw count =", fc, MUTED, 1.0)
            hero = f"{r['scale']} {r['unit']}"
            s.text((0, 302), hero, fh, *((TERRA_LT, 1.0) if hero_diff else (PAPER, 0.9)), anchor="ls")
            sprites.append(s.px)
            hw = fh.getlength(hero)
            pills.append(pill(blk_h + gap, [-12, 222, hw + 12, 318]) if hero_diff else None)
        add_row(els, 2, g * 2, sprites, BODY_Y + g * (blk_h + gap), 270, not any(diff.values()), pills)
    return els


def card(side, m):
    """Card face with soft shadow and its header: model name and map file."""
    M = 40
    s = Sprite(CARD_W + 2 * M, CARD_H + 2 * M)
    sh = Image.new("L", (s.w, s.h), 0)
    ImageDraw.Draw(sh).rounded_rectangle([M, M + 16, M + CARD_W, M + CARD_H + 16], 28, fill=255)
    s.over(sh.filter(ImageFilter.GaussianBlur(18)), (6, 4, 2), 0.6)
    s.rrect([M, M, M + CARD_W - 1, M + CARD_H - 1], 28, CARD_FILL, 0.96)
    s.rrect([M, M, M + CARD_W - 1, M + CARD_H - 1], 28, PAPER, 0.11, width=2)
    s.text((M + PAD, M + 30), MODELS[side], font(FB, 42), PAPER, 1.0)
    s.text((M + PAD, M + 86), m["_file"], font(FM, 28), MUTED, 1.0)
    m2 = Image.new("L", (s.w, s.h), 0)
    ImageDraw.Draw(m2).line([(M + 2, M + 134), (M + CARD_W - 2, M + 134)], fill=255, width=2)
    s.over(m2, PAPER, 0.12)
    return El(s.px, CARD_X[side] - M, CARD_Y - M, side * RIGHT_LAG - 1, slide=44, axis=0)  # already rising on frame 0


def heading():
    """'Different' stays; the noun under it changes on each beat."""
    els = []
    k = Sprite(560, 70)
    k.text((0, 54), "Different", font(FB, 46), TERRA_LT, 1.0, anchor="ls")
    els.append(El(k.px, LEFT, 128, -1, slide=0))
    for beat, noun in enumerate(NOUNS):
        s = Sprite(860, 140)
        s.text((0, 100), noun, font(FB, 104), PAPER, 1.0, anchor="ls")
        t_in, _ = beat_times(beat, 0, 0)
        # leaves 4 frames before the cut and is gone on it, so two nouns never overlap
        t_out = None if beat == len(NOUNS) - 1 else (beat + 1) * BEAT * FPS - 4
        els.append(El(s.px, LEFT - 4, 196, t_in - (2 if beat == 0 else 1), t_out, slide=90, slide_out=70,
                      clip=(LEFT - 6, 190, 940, 336)))
    return els


def source_line():
    s = Sprite(880, 46)
    f = font(FM, 29)
    s.text((0, 36), "from ingest/maps/*.json", f, MUTED, 0.95, anchor="ls")
    return El(s.px, LEFT, SOURCE_Y, BEAT * FPS + 5, slide=0)


# ---------------------------------------------------------------- frame

def smear(px, n, axis):
    """Box blur of length n along one axis, for motion blur. Returns the blurred
    sprite and how far its origin moved (it grows by n on that axis)."""
    widths = [(0, 0)] * 3
    widths[axis] = (n, n)
    a = np.pad(px, widths)
    c = np.cumsum(a, axis=axis, dtype=np.float32)
    zero = np.zeros_like(np.take(c, [0], axis=axis))
    c = np.concatenate([zero, c], axis=axis)
    L = c.shape[axis]
    out = (np.take(c, np.arange(n, L), axis=axis) - np.take(c, np.arange(0, L - n), axis=axis)) / n
    return out, (n - 1) // 2 - n


def put(canvas, px, x, y, alpha, clip=None):
    h, w = px.shape[:2]
    x0, y0, x1, y1 = clip or (0, 0, W, H)
    cx0, cy0 = max(x, x0, 0), max(y, y0, 0)
    cx1, cy1 = min(x + w, x1, W), min(y + h, y1, H)
    if cx0 >= cx1 or cy0 >= cy1 or alpha <= 0:
        return
    s = px[cy0 - y:cy1 - y, cx0 - x:cx1 - x] * alpha
    dst = canvas[cy0:cy1, cx0:cx1]
    dst *= 1 - s[..., 3:4]
    dst += s[..., :3]


def draw(canvas, el, f):
    off, alpha = el.offset(f)
    if alpha <= 0.001:
        return
    px = el.spr
    if el.wipe_at is not None:  # highlight pill sweeps in left to right after the row lands
        r = ease_out(clamp01((f - el.wipe_at) / 4))
        if r <= 0:
            return
        px = px.copy()
        px[:, int(px.shape[1] * r):] = 0
    x, y = int(round(el.x)), int(round(el.y))
    v = abs(el.offset(f + 0.5)[0] - el.offset(f - 0.5)[0])  # px per frame
    n = int(round(v * SHUTTER))
    if n >= 2:
        px, shift = smear(px, n, el.axis)
        if el.axis == 1:
            x += shift
        else:
            y += shift
    if el.axis == 1:
        x += int(round(off))
    else:
        y += int(round(off))
    put(canvas, px, x, y, alpha, el.clip)


def progress(canvas, f):
    """Three short bars at the top right: which beat we are on."""
    bw, gap, y = 40, 10, 150
    x0 = 940 - 3 * bw - 2 * gap
    for i in range(3):
        on = clamp01((f - i * BEAT * FPS) / 4)  # lights up as its beat starts
        past = clamp01((f - (i + 1) * BEAT * FPS) / 4)  # then settles to paper
        col = np.array(PAPER, np.float32) * (1 - on) + np.array(TERRA_LT, np.float32) * on
        col = col * (1 - past) + np.array(PAPER, np.float32) * past
        a = (0.18 * (1 - on) + on) * (1 - past) + 0.45 * past
        a *= clamp01((f + 1) / 4)
        sl = canvas[y:y + 6, x0 + i * (bw + gap):x0 + i * (bw + gap) + bw]
        sl *= 1 - a
        sl += col * a


def background():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    v = yy / H
    top, bot = np.array(COFFEE, np.float32) * 0.86, np.array(ESPRESSO, np.float32)
    img = top * (1 - v[..., None]) + bot * v[..., None]
    # a faint warm glow behind the cards
    glow = np.exp(-(((xx - W * 0.45) / 620) ** 2 + ((yy - H * 0.42) / 760) ** 2))
    img += glow[..., None] * np.array([16, 9, 4], np.float32)
    r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    vignette = (1 - 0.22 * np.clip(r2, 0, 1.6) ** 1.3)[..., None]
    return img.astype(np.float32), vignette.astype(np.float32)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--pzem", help="photo for the PZEM-017 slot (team-owned or licensed)")
    ap.add_argument("--epever", help="photo for the EPEver Tracer slot (team-owned or licensed)")
    args = ap.parse_args()

    maps = load_maps()
    bg, vignette = background()
    cards = [card(side, m) for side, m in enumerate(maps)]
    els = cards + heading() + beat_wiring(maps, (args.pzem, args.epever)) \
        + beat_registers(maps) + beat_units(maps) + [source_line()]
    rng = np.random.default_rng(9)
    for i in range(int(DUR * FPS)):
        canvas = bg.copy()
        for el in els:
            draw(canvas, el, float(i))
        progress(canvas, float(i))
        img = canvas * vignette
        img += rng.normal(0, 2.4, (H, W, 1)).astype(np.float32)  # subtle film grain
        sys.stdout.buffer.write(np.clip(img, 0, 255).astype(np.uint8).tobytes())


if __name__ == "__main__":
    main()
