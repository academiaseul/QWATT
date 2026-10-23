"""QWATT week 1 video, shot 17 (a 3.0 s insert inside 2:01-2:09), vertical
1080x1920: the quick cut to the green CI run under Jay's "...It runs on every
change we make, in public. You can watch it go green." Then back to Jay.

  0.00-0.40 s  the title "Every change, checked in public" and the repo path rise
               in, then the card, its four step rows staggered 3 frames apart
  0.30-1.64 s  the four steps of .github/workflows/conformance.yml run in order:
               a terracotta arc turns on each, then it ticks to a terracotta check
               (0.56, 0.92, 1.28, 1.64 s) and the rail to the next step fills
  1.76-2.10 s  a terracotta band sweeps in: "passed", commit 98b281a, and under it
               the run's date and id; hold to 3.0 s
  whole shot   a very slow push-in, 1.0 to 1.012

What is real: everything the card states comes from the GitHub REST API, copied
into shot17-ci.data.json next to this file (fetched 2026-10-23 04:27 UTC): the
"conformance" run 34340123840, run #8, a push to main for 98b281a38f27 (the
week-1 commit), created 2026-09-09 10:25:23 UTC, status completed, conclusion
success, and its job "gates", whose four named steps each concluded success.
The repo is public (unauthenticated API: private false). The step commands are
read from .github/workflows/conformance.yml, unchanged since 98b281a, and the
render refuses to start unless its four step names are exactly the steps the
API says ran, in that order. Each icon and the summary are drawn from the
recorded conclusions: a run that was not a success would render as what it
was (a cross, "failed" on a brick band), never as passed. Full run:
https://github.com/academiaseul/QWATT/actions/runs/34340123840

What is styled here, not GitHub's: the short labels (spec check, conformance,
validators, ingest) for the four step names, the card, the icons, the order and
pace of the ticks (on GitHub the four steps took about one second together,
10:25:35-10:25:36), the band and the grain. It is a QWATT card, not a copy of
GitHub's interface, and no logo is drawn. No person, hand, meter or desk.

Audio: four soft ticks as the checks land and a low two-note tone under
"passed", made by ffmpeg's aevalsrc from the same times as the picture (`sfx`
mode prints the source); silence elsewhere. Mono, peak -22.1 dBFS as measured.
Music and Jay's voice come in the edit.

Vertical-platform safe zones are kept clear: nothing in the top 120 px, the right
140 px (the card ends at x = 930, 934 at full push-in) or the bottom 420 px.
Colour is converted and tagged as BT.709.

Writes raw RGB frames to stdout. Needs numpy and Pillow. Render from the repo
root with:

    python3 docs/video/shot17-ci.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1080x1920 -r 30 -i - -f lavfi -i "$(python3 docs/video/shot17-ci.py sfx)" \\
      -map 0:v -map 1:a -vf scale=out_color_matrix=bt709:out_range=tv \\
      -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -color_primaries bt709 \\
      -color_trc bt709 -colorspace bt709 -movflags +faststart -c:a aac -b:a 192k \\
      -t 3 QWATT-week1-shot17-ci.mp4
"""
import datetime
import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FPS = 30
DUR = 3.0
W, H = 1080, 1920
SS = 2  # layers are drawn at 2x and resampled each frame
ICON_SS = 4  # icons are drawn 4x finer again, then reduced

ESPRESSO = (22, 16, 10)
COFFEE = (41, 29, 19)
PAPER = (250, 248, 242)
TERRACOTTA = (176, 88, 47)
TERRA_LIGHT = (208, 138, 87)
BRICK = (128, 44, 34)  # a run that did not pass; never used for this run
EDGE = (64, 48, 34)  # 1 px card border, idle rail
RING = (112, 92, 72)  # a step that has not started
TEXT = (226, 216, 202)

FS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FMB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(HERE, "shot17-ci.data.json")
WORKFLOW = os.path.join(REPO, ".github", "workflows", "conformance.yml")
TITLE = ("Every change,", "checked in public")
# short on-screen names for the workflow's four steps, keyed by the step name
LABELS = {
    "Generated bindings are current": "spec check",
    "Conformance suite (shared engine, schema, bindings)": "conformance",
    "Validator adversary tests (V1–V7)": "validators",
    "Ingestion tests + Deliverable 1 acceptance harness": "ingest",
}
# conclusion -> (summary word, band colour, icon)
STATUS = {"success": ("passed", TERRACOTTA, "check"), "failure": ("failed", BRICK, "cross"),
          "cancelled": ("cancelled", RING, "dash"), "skipped": ("skipped", RING, "dash")}

# layout, frame px
HEAD_X = 64
HEAD_BASE = (318, 410)  # title baselines
HEAD_PX = 80
PATH_BASE, PATH_PX = 482, 36
CARD_X, CARD_Y, CARD_W = 36, 548, 894  # right edge at 930
TAB_H = 58
ROW_TOP, ROW_H = TAB_H + 28, 128  # first step row, from the card's top
ICON_X, ICON_DY, ICON_R = 76, 40, 27  # disc centre from the row's top-left
TEXT_X = 140
LABEL_PX, CMD_PX = 42, 28
BAND_TOP = ROW_TOP + 4 * ROW_H + 16
BAND_H, BAND_IN = 100, 22  # band height, inset from the card's sides
META_PX = 28
CARD_H = BAND_TOP + BAND_H + 82
MARGIN = 44  # around the card layer, room for its shadow
CANVAS = (-60, 150, W + 60, 1480)  # the area all layers are drawn in, frame px

# timings, in seconds
RISE, RISE_LEN = 30, 0.34  # arrivals: px risen, duration (ease-out cubic)
HEAD_T = (-0.08, -0.08 + 2 / FPS, -0.08 + 4 / FPS)  # title lines, repo path
CARD_T, CARD_RISE = 0.02, 44
ROW_T0, ROW_STEP = 0.10, 3 / FPS
RUN_T0 = 0.30  # the first step starts
TICKS = (0.56, 0.92, 1.28, 1.64)  # each step's check lands; the next starts then
SPIN = 1.7  # turns per second of the running arc
RAIL_LEN = 0.22
BAND_T, BAND_LEN = 1.76, 0.30
SUM_T, SUM_LEN = 1.86, 0.26
PUSH = 1.012
ANCHOR = (600, 900)  # push-in centre


def font(path, px):
    return ImageFont.truetype(path, int(round(px * SS)))


def P(v):
    return int(round(v * SS))


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


# ── the data ──────────────────────────────────────────────────────────────

def load():
    """The run from shot17-ci.data.json and the four steps it is shown with."""
    with open(DATA, encoding="utf-8") as fh:
        data = json.load(fh)
    run, job = data["run"], data["job"]
    assert run["path"] == ".github/workflows/conformance.yml" and run["status"] == "completed"
    assert job["head_sha"] == run["head_sha"] and job["status"] == "completed"
    assert data["repo"]["visibility"] == "public" and not data["repo"]["private"]
    assert run["html_url"] == f"{data['repo']['html_url']}/actions/runs/{run['id']}"
    with open(WORKFLOW, encoding="utf-8") as fh:
        wf = re.findall(r"- name: (.+)\n\s+run: (.+)\n", fh.read())
    ran = {s["name"]: s for s in job["steps"]}
    steps = [dict(label=LABELS[name], cmd=cmd.strip(), n=ran[name]["number"],
                  conclusion=ran[name]["conclusion"]) for name, cmd in wf]
    assert len(steps) == 4 and [s["n"] for s in steps] == sorted(s["n"] for s in steps)
    return data, steps


# ── static layers ─────────────────────────────────────────────────────────

def text_layer(spans, pad=8):
    """RGBA text at SS, cropped to its ink plus pad; returns (img, dx, dy) where
    (dx, dy) is the baseline-left point inside the image, frame px."""
    w = sum(font(f, px).getlength(s) for s, f, px, _ in spans) + P(2 * pad)
    asc = max(font(f, px).getmetrics()[0] for _, f, px, _ in spans)
    dsc = max(font(f, px).getmetrics()[1] for _, f, px, _ in spans)
    img = Image.new("RGBA", (int(w), asc + dsc + P(2 * pad)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x = P(pad)
    for s, f, px, col in spans:
        d.text((x, P(pad) + asc), s, font=font(f, px), fill=(*col, 255), anchor="ls")
        x += font(f, px).getlength(s)
    return img, pad, (P(pad) + asc) / SS


def card_shell(tab, pill):
    """RGBA card at SS: folder-style tab with title, body, shadow, 1 px edge, and a
    small pill on the tab row, right. As shots 13, 14 and 16."""
    lw, lh = P(CARD_W + 2 * MARGIN), P(CARD_H + 2 * MARGIN)
    o = P(MARGIN)
    title_px = 30
    f_title = font(FB, title_px)
    tab_w = P(22 + 10 + 14) + f_title.getlength(tab) + P(24)
    sil = Image.new("L", (lw, lh), 0)
    d = ImageDraw.Draw(sil)
    d.rounded_rectangle([o, o, o + tab_w, o + P(TAB_H + 24)], radius=P(16), fill=255)
    d.rounded_rectangle([o, o + P(TAB_H), o + P(CARD_W), o + P(CARD_H)], radius=P(20), fill=255)
    d.rectangle([o, o + P(TAB_H), o + P(30), o + P(TAB_H + 30)], fill=255)
    r = P(14)  # concave fillet where the tab meets the top edge
    d.rectangle([o + tab_w, o + P(TAB_H) - r, o + tab_w + r, o + P(TAB_H)], fill=255)
    d.ellipse([o + tab_w, o + P(TAB_H) - 2 * r, o + tab_w + 2 * r, o + P(TAB_H)], fill=0)
    shadow = Image.new("L", (lw, lh), 0)
    shadow.paste(sil, (0, P(14)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(P(16)))
    edge = Image.fromarray(np.asarray(sil) - np.asarray(sil.filter(ImageFilter.MinFilter(3))))

    base = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    base.paste(Image.new("RGBA", (lw, lh), (0, 0, 0, 255)), (0, 0),
               shadow.point(lambda v: int(v * 0.6)))
    base.paste(Image.new("RGBA", (lw, lh), (*COFFEE, 255)), (0, 0), sil)
    base.paste(Image.new("RGBA", (lw, lh), (*EDGE, 255)), (0, 0), edge)

    d = ImageDraw.Draw(base)
    by = o + P(TAB_H / 2 + title_px * 0.37)
    sq = title_px * 0.34
    d.rectangle([o + P(22), by - P(title_px * 0.63), o + P(22 + sq), by - P(title_px * 0.63 - sq)],
                fill=(*TERRACOTTA, 255))
    d.text((o + P(22 + 10 + 14), by), tab, font=f_title, fill=(*PAPER, 255), anchor="ls")
    f_lab = font(FS, 26)
    lx1 = o + P(CARD_W - 14)
    lw_ = f_lab.getlength(pill) + P(18 + 10 + 12 + 18)  # pad, dot, gap, pad
    ly0, ly1 = o + P(TAB_H / 2 - 21 + 2), o + P(TAB_H / 2 + 21 + 2)
    d.rounded_rectangle([lx1 - lw_, ly0, lx1, ly1], radius=P(21), outline=(*EDGE, 255),
                        width=P(1.5), fill=(*COFFEE, 255))
    cx, cy = lx1 - lw_ + P(18 + 5), (ly0 + ly1) / 2
    d.ellipse([cx - P(5), cy - P(5), cx + P(5), cy + P(5)], fill=(*TERRA_LIGHT, 255))
    d.text((lx1 - P(18), cy), pill, font=f_lab, fill=(*TEXT, 255), anchor="rm")
    return base


def glyph_points(kind, r):
    """The stroke of a check, cross or dash in a disc of radius r, centre (0, 0)."""
    if kind == "check":
        return [[(-0.42 * r, 0.02 * r), (-0.12 * r, 0.32 * r), (0.44 * r, -0.30 * r)]]
    if kind == "cross":
        k = 0.32 * r
        return [[(-k, -k), (k, k)], [(k, -k), (-k, k)]]
    return [[(-0.36 * r, 0), (0.36 * r, 0)]]


def partial(strokes, p):
    """The first p (0-1) of a set of polylines, by length."""
    segs = [(a, b) for s in strokes for a, b in zip(s, s[1:])]
    total = sum(math.dist(a, b) for a, b in segs)
    left, out = p * total, []
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


def stroke(d, strokes, width, col):
    for pts in strokes:
        d.line(pts, fill=col, width=int(width), joint="curve")
        for x, y in (pts[0], pts[-1]):  # round caps
            d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=col)


def icon(state):
    """One step's disc at SS, from a rounded state (see Shot.icon_state)."""
    ring_a, arc_a, arc_deg, fill_a, scale, glyph_p, kind, col = state
    k = SS * ICON_SS
    box = int(2 * (ICON_R + 6) * k)
    img = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c, r = box / 2, ICON_R * k
    if ring_a > 0:
        d.ellipse([c - r, c - r, c + r, c + r], outline=(*RING, int(255 * ring_a)), width=int(3 * k))
    if arc_a > 0:  # the running arc, 110 degrees, over the ring
        d.arc([c - r, c - r, c + r, c + r], arc_deg, arc_deg + 110,
              fill=(*TERRA_LIGHT, int(255 * arc_a)), width=int(4 * k))
    if fill_a > 0:
        rf = r * scale
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.ellipse([c - rf, c - rf, c + rf, c + rf], fill=(*col, 255))
        if glyph_p > 0:
            pts = partial(glyph_points(kind, ICON_R), glyph_p)
            stroke(ld, [[(c + x * k, c + y * k) for x, y in s] for s in pts], 5.5 * k, (*PAPER, 255))
        a = np.asarray(layer.getchannel("A"), np.float32) * fill_a
        layer.putalpha(Image.fromarray(a.astype(np.uint8)))
        img = Image.alpha_composite(img, layer)
    return img.reduce(ICON_SS)


def background():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    lift = np.exp(-(((xx - CARD_X - CARD_W / 2) / 760) ** 2 + ((yy - 880) / 1000) ** 2))
    r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    img = np.array(ESPRESSO, np.float32) + lift[..., None] * np.array([12, 9, 6], np.float32)
    return img * (1 - 0.22 * np.clip(r2, 0, 1.6) ** 1.3)[..., None]


def faded(img, k):
    if k >= 1:
        return img
    out = img.copy()
    out.putalpha(img.getchannel("A").point(lambda v: int(v * k + 0.5)))
    return out


def vblur(img, n):
    """Vertical box blur of n px (motion blur of a vertical move), premultiplied."""
    if n < 2:
        return img
    a = np.asarray(img.convert("RGBa"), np.float32)
    h1 = n // 2
    c = np.cumsum(np.pad(a, ((h1 + 1, n - 1 - h1), (0, 0), (0, 0))), axis=0)
    a = (c[n:] - c[:-n]) / n
    return Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), "RGBa").convert("RGBA")


# ── the shot ──────────────────────────────────────────────────────────────

class Shot:
    def __init__(self):
        data, self.steps = load()
        run = data["run"]
        word, self.band_col, self.kind = STATUS.get(run["conclusion"],
                                                    (run["conclusion"], RING, "dash"))
        sha = run["head_sha"][:7]
        when = datetime.datetime.strptime(run["created_at"], "%Y-%m-%dT%H:%M:%SZ")

        # title and repo path
        self.heads = []
        for line, base, t0 in zip(TITLE, HEAD_BASE, HEAD_T):
            img, dx, dy = text_layer([(line, FB, HEAD_PX, PAPER)])
            self.heads.append((img, HEAD_X - dx, base - dy, t0))
        path = data["repo"]["html_url"].split("://", 1)[1]
        img, dx, dy = text_layer([(path, FM, PATH_PX, TERRA_LIGHT)])
        self.heads.append((img, HEAD_X - dx + 2, PATH_BASE - dy, HEAD_T[2]))
        for img, x, _, _ in self.heads:
            assert x + img.width / SS - 8 <= 940, "title crosses the right safe line"

        self.shell = card_shell(run["name"], f"{run['event']} · {run['head_branch']}")
        self.rows = []
        for s in self.steps:
            lab = text_layer([(s["label"], FB, LABEL_PX, PAPER)])
            cmd = text_layer([(s["cmd"], FM, CMD_PX, TEXT)])
            assert TEXT_X + cmd[0].width / SS - 16 <= CARD_W - 20, f"{s['cmd']} does not fit"
            self.rows.append((lab, cmd))

        # the band, drawn 4x finer and reduced; its text; the line under it
        bw, bh = CARD_W - 2 * BAND_IN, BAND_H
        m = Image.new("L", (P(bw) * 2, P(bh) * 2), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, m.width - 1, m.height - 1], radius=P(14) * 2,
                                            fill=255)
        self.band_mask = np.asarray(m.reduce(2), np.float32) / 255.0
        txt = Image.new("RGBA", (P(bw), P(bh)), (0, 0, 0, 0))
        d = ImageDraw.Draw(txt)
        gk = SS * ICON_SS  # the band's glyph, drawn finer and reduced
        g = Image.new("RGBA", (int(60 * gk), int(60 * gk)), (0, 0, 0, 0))
        stroke(ImageDraw.Draw(g), [[(30 * gk + x * gk, 30 * gk + y * gk) for x, y in s]
                                   for s in glyph_points(self.kind, 34)], 6.5 * gk, (*PAPER, 255))
        txt.alpha_composite(g.reduce(ICON_SS), (P(18), P(bh / 2 - 30)))
        d.text((P(88), P(bh / 2 + 2)), word, font=font(FB, 54), fill=(*PAPER, 255), anchor="lm")
        d.text((P(bw - 30), P(bh / 2 + 2)), f"commit {sha}", font=font(FMB, 34),
               fill=(*PAPER, 255), anchor="rm")
        assert P(88) + font(FB, 54).getlength(word) < P(bw - 40) - font(FMB, 34).getlength(
            f"commit {sha}"), "band text overlaps"
        self.band_txt = txt
        self.meta = text_layer([(f"{when:%Y-%m-%d %H:%M} UTC · run {run['id']}", FM, META_PX, TEXT)])
        assert BAND_IN + 6 + self.meta[0].width / SS - 16 <= CARD_W - 20

        self.bg = background()
        self.icons = {}

    # ── per step ──
    def step_times(self, k):
        return (RUN_T0 if k == 0 else TICKS[k - 1]), TICKS[k]

    def icon_state(self, k, t):
        t0, t1 = self.step_times(k)
        conc = self.steps[k]["conclusion"]
        _, col, kind = STATUS.get(conc, (conc, RING, "dash"))
        run_a = smooth(t0, t0 + 0.08, t) * (1 - smooth(t1, t1 + 0.06, t))
        deg = (-90 + 360 * SPIN * (t - t0)) % 360
        fill_a = ease(t1, t1 + 0.08, t)
        scale = 0.80 + 0.20 * ease(t1, t1 + 0.16, t)
        glyph = smooth(t1 + 0.03, t1 + 0.20, t)
        ring_a = 0.85 * (1 - fill_a)
        return (round(ring_a, 2), round(run_a, 2), round(deg / 3) * 3, round(fill_a, 2),
                round(scale, 3), round(glyph, 2), kind, col)

    def card(self, t):
        """The card layer at SS for time t (shell, rows, icons, rails, band)."""
        card = self.shell.copy()
        o = P(MARGIN)
        d = ImageDraw.Draw(card)
        for k, ((lab, ldx, ldy), (cmd, cdx, cdy)) in enumerate(self.rows):
            ta = ROW_T0 + k * ROW_STEP
            a = ease(ta, ta + RISE_LEN, t)
            if a <= 0:
                continue
            top = ROW_TOP + k * ROW_H + (1 - a) * 22
            t0, _ = self.step_times(k)
            live = 0.50 + 0.50 * smooth(t0, t0 + 0.12, t)  # a step brightens as it starts
            # rail to the next step, behind the discs; fills as this step lands
            if k < 3:
                y0 = o + P(ROW_TOP + k * ROW_H + ICON_DY + ICON_R + 4)
                y1 = o + P(ROW_TOP + (k + 1) * ROW_H + ICON_DY - ICON_R - 4)
                x = o + P(ICON_X)
                ra = min(a, ease(ta + ROW_STEP, ta + ROW_STEP + RISE_LEN, t))
                mix = lambda c: tuple(int(COFFEE[j] + (c[j] - COFFEE[j]) * ra) for j in range(3))  # noqa
                d.rectangle([x - P(1.5), y0, x + P(1.5), y1], fill=(*mix(EDGE), 255))
                f = ease(TICKS[k], TICKS[k] + RAIL_LEN, t)
                if f > 0:
                    d.rectangle([x - P(1.5), y0, x + P(1.5), y0 + (y1 - y0) * f],
                                fill=(*mix(TERRACOTTA), 255))
            card.alpha_composite(faded(lab, a * live), (o + P(TEXT_X - ldx), o + P(top + 52 - ldy)))
            card.alpha_composite(faded(cmd, a * (0.40 + 0.35 * live)),
                                 (o + P(TEXT_X - cdx), o + P(top + 98 - cdy)))
            key = self.icon_state(k, t)
            if key not in self.icons:
                self.icons[key] = icon(key)
            ic = faded(self.icons[key], a)
            card.alpha_composite(ic, (o + P(ICON_X) - ic.width // 2,
                                      o + P(top + ICON_DY) - ic.height // 2))

        # the band sweeps in left to right, then its text and the line under it
        p = ease(BAND_T, BAND_T + BAND_LEN, t)
        if p > 0:
            bh, bw = self.band_mask.shape
            soft = P(28)
            cols = np.arange(bw, dtype=np.float32)
            wipe = np.clip((p * (bw + soft) - cols) / soft, 0, 1)[None, :]
            band = Image.new("RGBA", (bw, bh), (*self.band_col, 255))
            s = ease(SUM_T, SUM_T + SUM_LEN, t)
            if s > 0:  # the text slides in from 14 px left, inside the band's wipe
                sx = P(14 * (1 - s))
                band.alpha_composite(faded(self.band_txt.crop((sx, 0, sx + bw, bh)), s))
            a = (self.band_mask * wipe * 255 + 0.5).astype(np.uint8)
            band.putalpha(Image.fromarray(a))
            bx, by = o + P(BAND_IN), o + P(BAND_TOP)
            card.alpha_composite(band, (bx, by))
            if s > 0:
                meta, mdx, mdy = self.meta
                card.alpha_composite(faded(meta, s * 0.8),
                                     (o + P(BAND_IN + 6 - mdx),
                                      o + P(BAND_TOP + BAND_H + 50 - mdy + 8 * (1 - s))))
        return card

    def frame(self, i):
        t = i / FPS
        cx0, cy0, cx1, cy1 = CANVAS
        canvas = Image.new("RGBA", (P(cx1 - cx0), P(cy1 - cy0)), (0, 0, 0, 0))

        def put(img, x, y, a, v):  # frame px position, alpha, speed px/frame
            if a <= 0:
                return
            img = vblur(faded(img, a), int(round(v * 0.5 * SS)))  # 180 degree shutter
            canvas.alpha_composite(img, (P(x - cx0), P(y - cy0)))

        for img, x, y, t0 in self.heads:
            a = ease(t0, t0 + RISE_LEN, t)
            put(img, x, y + (1 - a) * RISE, a, ease_v(t0, t0 + RISE_LEN, t, RISE))
        a = ease(CARD_T, CARD_T + RISE_LEN, t)
        put(self.card(t), CARD_X - MARGIN, CARD_Y - MARGIN + (1 - a) * CARD_RISE, a,
            ease_v(CARD_T, CARD_T + RISE_LEN, t, CARD_RISE))

        # slow push-in about ANCHOR; resample the canvas into the frame
        layer = canvas.convert("RGBa")  # premultiplied, for resampling
        s = 1 + (PUSH - 1) * smooth(0, DUR, t)
        ax, ay = ANCHOR
        k = s / SS  # frame px per layer px
        x0, y0 = ax + (cx0 - ax) * s, ay + (cy0 - ay) * s
        ix0, iy0 = max(math.ceil(x0), 0), max(math.ceil(y0), 0)
        ix1 = min(math.floor(x0 + layer.width * k), W)
        iy1 = min(math.floor(y0 + layer.height * k), H)
        box = ((ix0 - x0) / k, (iy0 - y0) / k, (ix1 - x0) / k, (iy1 - y0) / k)
        if s == 1:  # exact 2:1, a plain box filter
            small = layer.reduce(SS, box=tuple(int(round(v)) for v in box))
        else:
            small = layer.resize((ix1 - ix0, iy1 - iy0), Image.LANCZOS, box=box)
        a = np.asarray(small, np.float32)
        out = self.bg.copy()
        dst = out[iy0:iy1, ix0:ix1]
        dst *= 1 - a[..., 3:] / 255.0
        dst += a[..., :3]
        grain = np.random.default_rng((17, i)).standard_normal((H, W, 1), dtype=np.float32)
        out += grain * 2.2  # film grain
        return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def main():
    shot = Shot()
    for i in range(int(DUR * FPS)):
        sys.stdout.buffer.write(shot.frame(i).tobytes())


def sfx():
    """The lavfi audio source: a soft tick per check, a low two-note tone under
    "passed", silence elsewhere."""
    terms = []
    for tk in TICKS:
        d = f"(t-{tk + 0.04:.3f})"  # as the check's stroke starts
        terms.append(f"if(between(t,{tk + 0.04:.3f},{tk + 0.34:.3f}),"
                     f"(0.75*sin(2*PI*1320*{d})+0.25*sin(2*PI*2640*{d}))"
                     f"*exp(-55*{d})*(1-exp(-2500*{d})),0)")
    for f, dt, amp in ((587, 0.0, 0.55), (880, 0.09, 0.45)):  # under "passed"
        t0 = SUM_T + dt
        d = f"(t-{t0:.3f})"
        terms.append(f"if(between(t,{t0:.3f},{t0 + 0.9:.3f}),"
                     f"{amp}*sin(2*PI*{f}*{d})*exp(-7*{d})*(1-exp(-400*{d})),0)")
    expr = "0.1*(" + "+".join(terms) + ")"
    print(f"aevalsrc='{expr}':s=48000:d={DUR:g},lowpass=f=6000")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "sfx":
        sfx()
    else:
        main()
