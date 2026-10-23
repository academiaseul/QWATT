"""QWATT week 1 video, shot 12 (1:05-1:16), vertical 1080x1920: the
three-paths diagram from ingest/README.md, under Diego's line "We built a
translator. Data can arrive three ways: straight off the wire from a meter,
pushed over the internet, or replayed from a file."

The README draws it left to right in ASCII; this is the same diagram folded for
a phone. Three source cards stacked at the top, each with Diego's plain words
first and the README's technical name under it. From each card a line runs to
the right-hand gutter, down its own lane, and the three lanes merge at one
junction. One trunk goes from there into the translator (lib/normalize.js,
IntervalBuilder), and one arrow from the translator into the output card
(interval.schema.json record).

  0.2-1.3 s   kicker "ingest/README.md", title "One translator", then the
              translator card ("We built a translator.")
  2.0-3.1 s   the three source cards, 6 frames apart ("three ways")
  2.9-4.2 s   output card, then the empty paths as faint dots and the junction
  5.3 s       Modbus arrow draws itself, travelling head, soft click
  7.3 s       HTTP arrow, soft click
  9.1 s       CSV arrow, soft click
  9.6-10.0 s  the trunk runs into the translator and on to the output card,
              which lights in terracotta (half lit at 10.05 s); calm hold to 11.0 s

Everything on screen is text from the repo or Diego's words: no numbers, no
records, no meters. check_repo() refuses to render unless every technical name
shown still appears in the diagram in ingest/README.md, the files it names
exist under ingest/, and lib/normalize.js still defines class IntervalBuilder.
The icons (a square wave, a globe, a page with rows) are plain glyphs, not
products. The clicks are synthesised by ffmpeg, about -11 dBFS peak.

Writes raw RGB frames to stdout. Needs numpy and Pillow. Render with:

    python3 docs/video/shot12-three-paths.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 -s 1080x1920 \\
      -r 30 -i - -f lavfi -i "aevalsrc='(0.20*sin(2*PI*1050*t)+0.07*sin(2*PI*2400*t))*exp(-70*t)*(1-exp(-3000*t))':d=0.15:s=48000" \\
      -filter_complex "[0:v]scale=out_color_matrix=bt709[v];[1]lowpass=f=4500,asplit=3[c1][c2][c3];\\
    [c1]adelay=5300:all=1[d1];[c2]adelay=7300:all=1[d2];[c3]adelay=9100:all=1[d3];\\
    [d1][d2][d3]amix=inputs=3:normalize=0,apad=whole_dur=11,atrim=0:11,aformat=channel_layouts=stereo[a]" \\
      -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \\
      -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart \\
      -c:a aac -b:a 192k QWATT-week1-shot12-three-paths.mp4

The click times in adelay (ms) are ARROWS below; change both together.
"""
import math
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FPS = 30
DUR = 11.0
W, H = 1080, 1920
SS = 3  # supersampling for shapes and strokes; text is drawn at 1x

PAPER = (250, 248, 242)
ESPRESSO = (22, 16, 10)
COFFEE = (41, 29, 19)
TERRACOTTA = (176, 88, 47)
TERRA_LIGHT = (208, 138, 87)  # terracotta on dark

FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FMB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Plain words are Diego's; the technical names are copied from the diagram in
# ingest/README.md (checked by check_repo).
SOURCES = (
    ("Straight off the wire", "Modbus meter", "adapters/modbus.js", "wire"),
    ("Pushed over the internet", "HTTP push", "adapters/http.js", "globe"),
    ("Replayed from a file", "CSV file", "adapters/csv.js", "file"),
)
TRANSLATOR = ("lib/normalize.js", "IntervalBuilder")
OUTPUT = ("interval.schema.json", "record")
KICKER, TITLE = "ingest/README.md", "One translator"

# layout, px. Safe area: x 72-940, y 120-1500 (platform UI and captions outside it)
X0, X1 = 72, 800                       # the card column
CX = (X0 + X1) // 2
CARD_Y, CARD_H, GAP = 350, 150, 28
LANES = (905, 875, 845)                # Modbus outermost, so no two lines cross
MERGE_Y0, MERGE_Y1 = 872, 918          # where the lanes bend together
JX, JY, JR = 875, 945, 11              # the junction
TR_Y0, TR_Y1 = 1000, 1170              # translator card
OUT_Y0, OUT_Y1 = 1250, 1390            # output card
R = 22                                 # corner radius of the lines
LINE_W = 6
BOX = (400, 380, 940, 1270)            # region the strokes live in

# timeline, s
T_TITLE = 0.2
T_TRANSLATOR = 0.6                     # "We built a translator."
T_SOURCES = (2.0, 2.2, 2.4)            # "Data can arrive three ways"
T_OUTPUT = 2.9
T_GUIDES = 3.4
ARROWS = (5.3, 7.3, 9.1)               # on "wire", "internet", "file"; a click on each
SPEED = 620                            # px/s average along a path
T_TRUNK = (9.6, 9.82)
T_DOWN = (9.82, 9.97)
T_LIGHT = (9.9, 10.25)


def ease(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return 1 - (1 - x) ** 3  # ease-out cubic


def glide(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return 0.5 - 0.5 * math.cos(math.pi * x)  # sine in-out: gentle start and landing


def mix(a, b, k):
    return tuple(int(round(a[i] * k + b[i] * (1 - k))) for i in range(3))


def font(path, size):
    return ImageFont.truetype(path, size)


def check_repo():
    """Refuse to render a diagram that no longer matches the repo."""
    readme = open(os.path.join(REPO, "ingest", "README.md"), encoding="utf-8").read()
    diagram = readme.split("```")[1]
    shown = [s for src in SOURCES for s in src[1:3]] + list(TRANSLATOR) + [" ".join(OUTPUT)]
    missing = [s for s in shown if s not in diagram]
    files = [os.path.join("ingest", src[2]) for src in SOURCES] + [os.path.join("ingest", TRANSLATOR[0]),
                                                                   os.path.join("protocol", OUTPUT[0])]
    missing += [f for f in files if not os.path.isfile(os.path.join(REPO, f))]
    normalize = open(os.path.join(REPO, "ingest", TRANSLATOR[0]), encoding="utf-8").read()
    if not re.search(r"^class %s\b" % TRANSLATOR[1], normalize, re.M):
        missing.append("class " + TRANSLATOR[1])
    if missing:
        sys.exit("shot12: not in the repo any more: " + ", ".join(missing))


# ── paths ──────────────────────────────────────────────────────────────────

def seg(a, b, step=2.0):
    n = max(2, int(math.hypot(b[0] - a[0], b[1] - a[1]) / step) + 1)
    return [(a[0] + (b[0] - a[0]) * k / (n - 1), a[1] + (b[1] - a[1]) * k / (n - 1)) for k in range(n)]


def arc(c, r, a0, a1, step=2.0):
    n = max(3, int(abs(a1 - a0) * r / step) + 1)
    return [(c[0] + r * math.cos(a0 + (a1 - a0) * k / (n - 1)),
             c[1] + r * math.sin(a0 + (a1 - a0) * k / (n - 1))) for k in range(n)]


def bezier(p0, p1, p2, p3, n=30):
    out = []
    for k in range(n):
        u = k / (n - 1)
        out.append(tuple((1 - u) ** 3 * p0[i] + 3 * (1 - u) ** 2 * u * p1[i]
                         + 3 * (1 - u) * u ** 2 * p2[i] + u ** 3 * p3[i] for i in range(2)))
    return out


class Path:
    """A polyline with arc length, so a line can be drawn up to any length s."""

    def __init__(self, pts):
        p = np.asarray(pts, float)
        keep = np.r_[True, np.hypot(*np.diff(p, axis=0).T) > 1e-6]
        self.p = p[keep]
        self.s = np.r_[0, np.cumsum(np.hypot(*np.diff(self.p, axis=0).T))]
        self.length = self.s[-1]

    def at(self, s):
        s = min(max(s, 0.0), self.length)
        j = min(int(np.searchsorted(self.s, s, side="right")) - 1, len(self.p) - 2)
        a, b = self.p[j], self.p[j + 1]
        d = self.s[j + 1] - self.s[j]
        return a + (b - a) * (s - self.s[j]) / d, (b - a) / d

    def upto(self, s):
        j = int(np.searchsorted(self.s, s, side="right"))
        return np.vstack([self.p[:j], self.at(s)[0]])


def card_top(i):
    return CARD_Y + i * (CARD_H + GAP)


def build_paths():
    sources = []
    for i, lx in enumerate(LANES):
        cy = card_top(i) + CARD_H / 2
        pts = (seg((X1 + 9, cy), (lx - R, cy)) + arc((lx - R, cy + R), R, -math.pi / 2, 0)
               + seg((lx, cy + R), (lx, MERGE_Y0))
               + bezier((lx, MERGE_Y0), (lx, MERGE_Y0 + 26), (JX, MERGE_Y1 - 26), (JX, MERGE_Y1))
               + seg((JX, MERGE_Y1), (JX, JY - JR - 3)))
        sources.append(Path(pts))
    ty = (TR_Y0 + TR_Y1) / 2
    trunk = Path(seg((JX, JY + JR + 3), (JX, ty - R)) + arc((JX - R, ty - R), R, 0, math.pi / 2)
                 + seg((JX - R, ty), (X1 + 14, ty)))  # the arrowhead tip lands 4 px off the card
    down = Path(seg((CX, TR_Y1 + 8), (CX, OUT_Y0 - 14)))
    return sources, trunk, down


# ── static layers ──────────────────────────────────────────────────────────

def as_layer(img, x, y):
    a = np.asarray(img, np.float32) / 255.0
    return a[..., :3] * 255.0, a[..., 3:4], x, y


def blend(frame, layer, dy=0, opacity=1.0):
    rgb, a, x, y = layer
    if opacity <= 0:
        return
    h, w = a.shape[:2]
    reg = frame[y + dy:y + dy + h, x:x + w]
    k = a * opacity
    reg *= 1 - k
    reg += rgb * k


def background():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    lift = np.exp(-(((xx - 470) / 900) ** 2 + ((yy - 880) / 1150) ** 2))
    img = np.array(ESPRESSO, np.float32) + lift[..., None] * (np.array(COFFEE, np.float32) - ESPRESSO) * 0.9
    r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    return img * (1 - 0.22 * np.clip(r2, 0, 1.6) ** 1.3)[..., None]


def icon(d, kind, x, y, s):
    """60 px line glyphs, drawn on the supersampled card: x, y, s already scaled."""
    w = int(4 * SS)
    col = TERRA_LIGHT + (255,)
    P = lambda u, v: (x + u * s, y + v * s)
    if kind == "wire":  # bits on a wire: a square wave
        pts = [(0, .64), (.16, .64), (.16, .34), (.36, .34), (.36, .64), (.56, .64), (.56, .34),
               (.76, .34), (.76, .64), (1, .64)]
        d.line([P(*p) for p in pts], fill=col, width=w, joint="curve")
        d.line([P(0, .84), P(1, .84)], fill=mix(TERRA_LIGHT, COFFEE, .45) + (255,), width=w)
    elif kind == "globe":
        d.ellipse([P(.06, .06), P(.94, .94)], outline=col, width=w)
        d.ellipse([P(.30, .06), P(.70, .94)], outline=col, width=w)
        d.line([P(.06, .5), P(.94, .5)], fill=col, width=w)
        for v in (.28, .72):
            hw = math.sqrt(.44 ** 2 - (v - .5) ** 2)
            d.line([P(.5 - hw + .03, v), P(.5 + hw - .03, v)], fill=col, width=w)
    else:  # a file with rows
        d.line([P(.62, .04), P(.16, .04), P(.16, .96), P(.84, .96), P(.84, .26), P(.62, .04),
                P(.62, .26), P(.84, .26)], fill=col, width=w, joint="curve")
        for v in (.48, .64, .80):
            d.line([P(.30, v), P(.46, v)], fill=col, width=w)
            d.line([P(.54, v), P(.70, v)], fill=col, width=w)


def card(w, h, fill, border, bw, port=None, glyph=None):
    """Rounded card, supersampled; optional input port on the right edge and a glyph."""
    pad = 12 if port else 0
    img = Image.new("RGBA", ((w + pad) * SS, h * SS), border + (0,))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w * SS - 1, h * SS - 1], 22 * SS, fill=fill + (255,),
                        outline=border + (255,), width=bw * SS)
    if port:
        ring, core = port
        c, r = (w * SS, h * SS / 2), 7 * SS
        d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=core + (255,), outline=ring + (255,),
                  width=2 * SS)
    if glyph:
        icon(d, glyph, 28 * SS, (h - 60) / 2 * SS, 60 * SS)
    return img.resize((w + pad, h), Image.LANCZOS)


def source_cards(i):
    label, tech, path, glyph = SOURCES[i]
    out = []
    for active in (False, True):
        border = TERRA_LIGHT if active else mix(PAPER, COFFEE, .14)
        port = (TERRA_LIGHT, TERRA_LIGHT) if active else (mix(PAPER, ESPRESSO, .35), ESPRESSO)
        img = card(X1 - X0, CARD_H, COFFEE, border, 2, port=port, glyph=glyph)
        d = ImageDraw.Draw(img)
        x = 28 + 60 + 24
        d.text((x, 66), label, font=font(FB, 40), fill=PAPER, anchor="ls")
        fs, fm = font(FR, 30), font(FM, 30)
        d.text((x, 112), tech, font=fs, fill=mix(PAPER, COFFEE, .72), anchor="ls")
        x += d.textlength(tech, font=fs)
        d.text((x, 112), " · ", font=fs, fill=mix(PAPER, COFFEE, .45), anchor="ls")
        x += d.textlength(" · ", font=fs)
        d.text((x, 112), path, font=fm, fill=TERRA_LIGHT, anchor="ls")
        assert x + d.textlength(path, font=fm) < X1 - X0 - 20, "source card text too wide"
        out.append(as_layer(img, X0, card_top(i)))
    return out


def translator_cards():
    out = []
    for lit in (False, True):
        border = TERRA_LIGHT if lit else mix(PAPER, COFFEE, .14)
        fill = mix(TERRACOTTA, COFFEE, .10) if lit else COFFEE
        img = card(X1 - X0, TR_Y1 - TR_Y0, fill, border, 3 if lit else 2)
        d = ImageDraw.Draw(img)
        mid = (X1 - X0) / 2
        d.text((mid, 78), TRANSLATOR[0], font=font(FMB, 44), fill=PAPER, anchor="ms")
        d.text((mid, 128), TRANSLATOR[1], font=font(FM, 32), fill=mix(PAPER, COFFEE, .72), anchor="ms")
        out.append(as_layer(img, X0, TR_Y0))
    return out


def output_cards():
    out = []
    for lit in (False, True):
        border = TERRA_LIGHT if lit else mix(PAPER, COFFEE, .14)
        fill = TERRACOTTA if lit else COFFEE
        img = card(X1 - X0, OUT_Y1 - OUT_Y0, fill, border, 2)
        d = ImageDraw.Draw(img)
        fm, fs = font(FMB, 38), font(FR, 34)
        name, word = OUTPUT[0], " " + OUTPUT[1]
        tw = d.textlength(name, font=fm) + d.textlength(word, font=fs)
        x, base = ((X1 - X0) - tw) / 2, (OUT_Y1 - OUT_Y0) / 2 + 13
        ink = PAPER if lit else mix(PAPER, COFFEE, .80)
        d.text((x, base), name, font=fm, fill=ink, anchor="ls")
        d.text((x + d.textlength(name, font=fm), base), word, font=fs,
               fill=ink if lit else mix(PAPER, COFFEE, .62), anchor="ls")
        out.append(as_layer(img, X0, OUT_Y0))
    return out


def output_glow():
    """Soft terracotta light around the lit output card, added on top."""
    pad = 66  # keeps the light inside the frame on the left
    w, h = X1 - X0 + 2 * pad, OUT_Y1 - OUT_Y0 + 2 * pad
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([pad, pad, w - pad, h - pad], 22, fill=255)
    g = np.asarray(m.filter(ImageFilter.GaussianBlur(24)), np.float32) / 255.0
    return g[..., None] * np.array(TERRACOTTA, np.float32), X0 - pad, OUT_Y0 - pad


def title_layer():
    img = Image.new("RGBA", (800, 150), PAPER + (0,))
    d = ImageDraw.Draw(img)
    d.text((0, 0), KICKER, font=font(FM, 28), fill=mix(TERRA_LIGHT, ESPRESSO, .85) + (255,))
    d.text((-3, 44), TITLE, font=font(FB, 64), fill=PAPER + (255,))
    return as_layer(img, X0, 168)


def guides_layer(paths):
    """The empty diagram: every path as faint dots, and the junction ring."""
    bx0, by0, bx1, by1 = BOX
    dots = Image.new("L", ((bx1 - bx0) * SS, (by1 - by0) * SS), 0)
    d = ImageDraw.Draw(dots)
    for p in paths:
        for s in np.arange(4, p.length - 2, 12):
            (x, y), _ = p.at(s)
            x, y, r = (x - bx0) * SS, (y - by0) * SS, 2.2 * SS
            d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    ring = Image.new("L", dots.size, 0)
    x, y, r = (JX - bx0) * SS, (JY - by0) * SS, JR * SS
    ImageDraw.Draw(ring).ellipse([x - r, y - r, x + r, y + r], outline=255, width=2 * SS)
    a = (np.asarray(dots.reduce(SS), np.float32) * 0.24 + np.asarray(ring.reduce(SS), np.float32) * 0.42) / 255
    return np.broadcast_to(np.array(PAPER, np.float32), a.shape + (3,)).copy(), a[..., None], bx0, by0


def sprite(sigma, size):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) - (size - 1) / 2
    return np.exp(-(xx ** 2 + yy ** 2) / (2 * sigma ** 2))


# ── the moving part ────────────────────────────────────────────────────────

def arrowhead(d, p, u, ox, oy):
    n = np.array([-u[1], u[0]])
    tip, back = p + u * 10, p - u * 16
    pts = [tip, back + n * 12, back - n * 12]
    d.polygon([((q[0] - ox) * SS, (q[1] - oy) * SS) for q in pts], fill=255)


def heads_alpha(heads, shape):
    """Arrowheads with motion blur: each one is drawn at 5 instants across half a
    frame's shutter and averaged, on a small supersampled patch around it."""
    bx0, by0 = BOX[:2]
    acc = np.zeros(shape, np.float32)
    P = 120
    for samples, alpha in heads:
        cx, cy = samples[len(samples) // 2][0]
        ox, oy = int(cx) - P // 2, int(cy) - P // 2
        patch = np.zeros((P, P), np.float32)
        for p, u in samples:
            m = Image.new("L", (P * SS, P * SS), 0)
            arrowhead(ImageDraw.Draw(m), p, u, ox, oy)
            patch += np.asarray(m.reduce(SS), np.float32) / (255 * len(samples))
        x0, y0 = ox - bx0, oy - by0  # clip the patch to the stroke box
        cx0, cy0 = max(x0, 0), max(y0, 0)
        cx1, cy1 = min(x0 + P, shape[1]), min(y0 + P, shape[0])
        reg = acc[cy0:cy1, cx0:cx1]
        reg[:] = 1 - (1 - reg) * (1 - patch[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0] * alpha)
    return acc


def main():
    check_repo()
    bg = background()
    title = title_layer()
    sources = [source_cards(i) for i in range(3)]
    tr_dim, tr_lit = translator_cards()
    out_dim, out_lit = output_cards()
    glow_rgb, gx, gy = output_glow()
    src_paths, trunk, down = build_paths()
    guides = guides_layer(src_paths + [trunk, down])
    head_glow = sprite(15, 96)

    starts = list(ARROWS)
    durs = [min(max(p.length / SPEED, 0.45), 1.0) for p in src_paths]
    arrive = [s + d for s, d in zip(starts, durs)]
    assert arrive[2] <= T_TRUNK[0], "CSV arrow must land before the trunk starts"

    bx0, by0, bx1, by1 = BOX
    shutter = 0.5 / FPS
    grain_rng = np.random.default_rng(12)
    cache_key, cache = None, None
    for i in range(int(DUR * FPS)):
        t = i / FPS
        f = bg.copy()

        # title, translator, sources, output: staggered rise and fade
        o = ease(T_TITLE, T_TITLE + 0.7, t)
        blend(f, title, round(24 * (1 - o)), o)
        o = ease(T_TRANSLATOR, T_TRANSLATOR + 0.7, t)
        blend(f, tr_dim, round(28 * (1 - o)), o)
        blend(f, tr_lit, 0, o * ease(T_TRUNK[1] - 0.05, T_TRUNK[1] + 0.3, t))
        for k, (dim, active) in enumerate(sources):
            o = ease(T_SOURCES[k], T_SOURCES[k] + 0.7, t)
            blend(f, dim, round(28 * (1 - o)), o)
            blend(f, active, 0, o * ease(starts[k] - 0.05, starts[k] + 0.25, t))
        o = ease(T_OUTPUT, T_OUTPUT + 0.7, t)
        blend(f, out_dim, round(28 * (1 - o)), o)
        light = glide(*T_LIGHT, t)
        if light > 0:
            f[gy:gy + glow_rgb.shape[0], gx:gx + glow_rgb.shape[1]] += glow_rgb * (0.42 * light)
            blend(f, out_lit, 0, light)
        blend(f, guides, 0, ease(T_GUIDES, T_GUIDES + 0.8, t))

        # strokes: each path drawn up to its current length
        lengths = [p.length * glide(s, s + d, t) for p, s, d in zip(src_paths, starts, durs)]
        lengths += [trunk.length * glide(*T_TRUNK, t), down.length * glide(*T_DOWN, t)]
        n_in = sum(t >= a for a in arrive)
        pulses = tuple(round(min(max((t - a) / 0.45, 0), 1), 2) for a in arrive)
        key = (tuple(round(v, 1) for v in lengths), n_in, pulses)
        if key != cache_key and max(lengths) > 0:
            cache_key = key
            m = Image.new("L", ((bx1 - bx0) * SS, (by1 - by0) * SS), 0)
            d = ImageDraw.Draw(m)
            jx, jy = (JX - bx0) * SS, (JY - by0) * SS
            for q in pulses:  # a ring opens out of the junction as each road arrives
                if 0 < q < 1:
                    r = (JR + 26 * (1 - (1 - q) ** 2)) * SS
                    d.ellipse([jx - r, jy - r, jx + r, jy + r], outline=int(200 * (1 - q)), width=2 * SS)
            for p, s in zip(src_paths + [trunk, down], lengths):
                if s > 0.5:
                    pts = [((x - bx0) * SS, (y - by0) * SS) for x, y in p.upto(s)]
                    d.line(pts, fill=255, width=LINE_W * SS, joint="curve")
                    x, y = pts[0]
                    r = LINE_W * SS / 2
                    d.ellipse([x - r, y - r, x + r, y + r], fill=255)
            if n_in:
                r = (JR - 2) * SS * ease(arrive[0], arrive[0] + 0.25, t)
                d.ellipse([jx - r, jy - r, jx + r, jy + r], fill=255)
            cache = np.asarray(m.reduce(SS), np.float32) / 255

        # travelling heads: the three source heads melt into the junction on
        # arrival; the trunk's and the last arrow's heads stay as arrowheads
        heads, glows = [], []
        for p, s0, dur, a in [(src_paths[k], starts[k], durs[k], arrive[k]) for k in range(3)] + \
                [(trunk, T_TRUNK[0], T_TRUNK[1] - T_TRUNK[0], None),
                 (down, T_DOWN[0], T_DOWN[1] - T_DOWN[0], None)]:
            if t < s0:
                continue
            alpha = 1.0 if a is None else 1 - ease(a, a + 0.18, t)
            if alpha <= 0:
                continue
            samples = [p.at(p.length * glide(s0, s0 + dur, t - shutter * j / 4)) for j in range(4, -1, -1)]
            heads.append((samples, alpha))
            if t < s0 + dur + 0.25:
                glows.append((samples[-1][0], alpha * (1 - ease(s0 + dur, s0 + dur + 0.25, t))))

        if max(lengths) > 0 or heads:
            a = cache if cache is not None else np.zeros((by1 - by0, bx1 - bx0), np.float32)
            if heads:
                a = 1 - (1 - a) * (1 - heads_alpha(heads, a.shape))
            reg = f[by0:by1, bx0:bx1]
            reg *= 1 - a[..., None]
            reg += np.array(TERRA_LIGHT, np.float32) * a[..., None]
            for (x, y), g in glows:
                x0, y0 = int(x) - 48, int(y) - 48
                f[y0:y0 + 96, x0:x0 + 96] += head_glow[..., None] * np.array(TERRA_LIGHT, np.float32) * 0.35 * g

        f += grain_rng.standard_normal((H, W, 1), dtype=np.float32) * 2.2
        sys.stdout.buffer.write(np.clip(f, 0, 255).astype(np.uint8).tobytes())


if __name__ == "__main__":
    main()
