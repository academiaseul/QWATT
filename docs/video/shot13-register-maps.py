"""QWATT week 1 video, shot 13 (1:16-1:23), vertical 1080x1920: under Diego's
"And a meter isn't code anymore. It's a short settings file, like adding one
more language to a dictionary."

The two register maps from the repo, stacked as file cards: ingest/maps/pzem-017.json
above ingest/maps/epever-tracer.json. Both cards slide in from the left a few
frames apart (0.0-1.0 s) and the camera pushes in slowly for the whole shot.
At 3.0 s the lines that make a meter a meter are marked in terracotta, one after
the other, as with a highlighter: its name, its serial settings and its fields
(one register per line). Everything else dims. At 4.5 s a small caption card
rises in: "A new meter = a new file", and rides the push-in with the cards. Hold
to the end.

What is real: every character inside the cards is read from the two JSON files at
render time, as stored (the files' own 2-space indentation, spacing and order),
nothing retyped. A line wider than the card is cut and ends in a muted "…"; the
head of each file is shown and the rest is marked "… N more lines", with N and the
"N lines" in each header counted from the file itself. The colours are a light
syntax colouring done here, not an editor. The caption restates
docs/ARCHITECTURE-FREEZE.md §3 ("Adding a meter is adding a file"). What is
generated: the background, the cards, the motion and the grain. No meter, desk,
person or other product's interface is drawn. The audio is a near-silent bed: low
room tone and three soft air swishes on the arrivals (music comes in the edit).

Vertical-platform safe zones are kept clear: the top 120 px, the right 140 px and
the bottom 420 px. Colour is converted and tagged as BT.709.

Writes raw RGB frames to stdout. Needs numpy and Pillow. Run from the repo root
(or set QWATT_MAPS to the maps folder). Render with:

    python3 docs/video/shot13-register-maps.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1080x1920 -r 30 -i - \\
      -f lavfi -i "anoisesrc=d=7:c=brown:r=48000:a=0.02:seed=13" \\
      -f lavfi -i "anoisesrc=d=0.7:c=pink:r=48000:a=0.1:seed=31" \\
      -filter_complex "[1]lowpass=f=300,afade=t=in:st=0:d=0.3,afade=t=out:st=6.5:d=0.5[bed];\\
    [2]highpass=f=700,lowpass=f=2600,afade=t=in:st=0:d=0.14,afade=t=out:st=0.14:d=0.56,\\
    asplit=3[w0][w1][w2];[w1]adelay=200:all=1,volume=0.8[w1d];\\
    [w2]adelay=4500:all=1,volume=0.6[w2d];\\
    [bed][w0][w1d][w2d]amix=inputs=4:normalize=0:duration=first[a]" \\
      -map 0:v -map "[a]" -vf scale=out_color_matrix=bt709:out_range=tv \\
      -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -color_primaries bt709 \\
      -color_trc bt709 -colorspace bt709 -movflags +faststart -c:a aac -b:a 192k \\
      -t 7 QWATT-week1-shot13-register-maps.mp4
"""
import math
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FPS = 30
DUR = 7.0
W, H = 1080, 1920
SS = 2  # cards and caption are drawn at 2x and resampled each frame (subpixel push-in)

ESPRESSO = (22, 16, 10)
COFFEE = (41, 29, 19)
PAPER = (250, 248, 242)
TERRACOTTA = (176, 88, 47)
TERRA_LIGHT = (208, 138, 87)
EDGE = (64, 48, 34)  # 1 px card border
MUTED = (150, 130, 110)

# light syntax colouring on coffee, brand colours only
KEY = (226, 216, 202)
STR = TERRA_LIGHT
NUM = PAPER
PUNCT = (140, 118, 98)
ELLIPSIS = (178, 158, 138)
DIM = 0.55  # what is left of a line's contrast once it steps back
BAND = (118, 61, 34)  # highlighter: terracotta pressed into the coffee card
HOT = {KEY: PAPER, NUM: PAPER, STR: (246, 214, 186), PUNCT: (214, 168, 138),
       ELLIPSIS: (226, 190, 160)}  # text colours on the band, all bold

FS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FMB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

MAPS = os.environ.get("QWATT_MAPS", "ingest/maps")
FILES = ("pzem-017.json", "epever-tracer.json")

# card layout, in frame pixels at scale 1 (safe area is x < 940, 120 < y < 1500)
CARD_X, CARD_W = 36, 902
CARD_Y = (134, 768)  # top of each card's tab
TAB_H, ROW_H, PAD_TOP, PAD_BOT = 60, 34, 18, 16
SHOWN = 14  # head of each file; the rest is marked "… N more lines"
CARD_H = TAB_H + PAD_TOP + (SHOWN + 1) * ROW_H + PAD_BOT
TEXT_X = 30  # code starts here inside the card
CODE_PX = 27
MAX_CHARS = int((CARD_W - TEXT_X - 22) // (CODE_PX * 1233 / 2048))  # DejaVu Mono advance
MARGIN = 44  # transparent border around a card layer, room for its shadow

# camera: slow push-in about a point right of centre, so the stack grows toward the
# open left side and its right edge stays out of the platform buttons; slight drift
ANCHOR = (760, (CARD_Y[0] + CARD_Y[1] + CARD_H) / 2)
S0, S1 = 0.98, 1.02
DRIFT = -4  # px over the shot

# timings, in seconds
SLIDE = ((0.0, 0.8), (0.2, 1.0))  # card A, card B: from 240 px to the left, fading in
SLIDE_DX = 240
HL_T0, HL_STEP, HL_LEN, HL_B_LAG = 3.0, 0.07, 0.4, 0.1  # highlighter, row by row
DIM_T = (3.0, 3.6)
CAP_T = (4.5, 5.0)
CAPTION = "A new meter = a new file"
CAP_Y = 1434  # caption card centre at scale 1, 20 px under card B; it rides the camera
# with the cards, so that gap holds through the push-in and its bottom ends at ~1490

TOKEN = re.compile(r'"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]|\s+|.')


def font(path, px):
    return ImageFont.truetype(path, int(px * SS))


def ease(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return 1 - (1 - x) ** 3  # ease-out cubic


def smooth(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return x * x * (3 - 2 * x)


def spans(line):
    """Split one stored line into coloured spans; a string followed by ':' is a key."""
    out = []
    for m in TOKEN.finditer(line):
        s = m.group()
        if s.startswith('"'):
            kind = KEY if re.match(r"\s*:", line[m.end():]) else STR
        elif s[0] in "-0123456789" and s != "-":
            kind = NUM
        elif s in ("true", "false", "null"):
            kind = NUM
        elif s.isspace():
            kind = None
        else:
            kind = PUNCT
        out.append((s, kind))
    return out


def cut(line_spans):
    """Keep what fits in MAX_CHARS; a cut line ends in a muted ellipsis."""
    if sum(len(s) for s, _ in line_spans) <= MAX_CHARS:
        return line_spans
    out, room = [], MAX_CHARS - 1
    for s, k in line_spans:
        out.append((s[:room], k))
        room -= len(s[:room])
        if room <= 0:
            break
    while out and not out[-1][0].strip():  # no dangling blank before the ellipsis
        out.pop()
    out[-1] = (out[-1][0].rstrip(), out[-1][1])
    return out + [("…", ELLIPSIS)]


def mix(c, amount):
    return tuple(int(round(COFFEE[i] + (c[i] - COFFEE[i]) * amount)) for i in range(3))


def read_map(name):
    """The file exactly as stored: its lines, which of the shown ones to mark."""
    with open(os.path.join(MAPS, name), encoding="utf-8") as fh:
        lines = fh.read().rstrip("\n").split("\n")
    marked, in_fields = set(), False
    for i, ln in enumerate(lines[:SHOWN]):
        s = ln.strip()
        if s.startswith('"fields"'):
            in_fields = True
        if s.startswith('"name"') or s.startswith('"serial"') or in_fields:
            marked.add(i)
        if in_fields and s.startswith("}"):
            in_fields = False
    return lines, sorted(marked)


def card_layers(name):
    """Premultiplied RGBA arrays at SS: the card as it arrives, and with its key
    lines marked and the rest dimmed. Same geometry, so they can be mixed per row."""
    lines, marked = read_map(name)
    lw, lh = (CARD_W + 2 * MARGIN) * SS, (CARD_H + 2 * MARGIN) * SS
    o = MARGIN * SS  # card origin inside the layer

    def P(v):
        return int(round(v * SS))

    # silhouette: a folder-style tab carrying the file name, joined to the body
    f_path, f_file, f_meta = font(FS, 23), font(FB, 30), font(FS, 23)
    tab_w = (22 + 14 + 12) * SS + f_path.getlength("ingest/maps/") + f_file.getlength(name) + 24 * SS
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

    # header: accent square, folder path, file name; line count outside, on the right
    d = ImageDraw.Draw(base)
    by = o + P(TAB_H / 2 + 11)
    d.rectangle([o + P(22), by - P(19), o + P(32), by - P(9)], fill=(*TERRACOTTA, 255))
    x = o + P(22 + 10 + 14)
    d.text((x, by), "ingest/maps/", font=f_path, fill=(*MUTED, 255), anchor="ls")
    x += f_path.getlength("ingest/maps/")
    d.text((x, by), name, font=f_file, fill=(*PAPER, 255), anchor="ls")
    d.text((o + P(CARD_W - 6), by - P(4)), f"{len(lines)} lines", font=f_meta,
           fill=(*MUTED, 255), anchor="rs")

    f_reg, f_bold, f_note = font(FM, CODE_PX), font(FMB, CODE_PX), font(FM, CODE_PX - 2)
    adv = f_reg.getlength("0")
    rows = [cut(spans(ln)) for ln in lines[:SHOWN]]
    more = len(lines) - SHOWN
    row_y = [o + P(TAB_H + PAD_TOP + i * ROW_H) for i in range(SHOWN + 1)]

    def draw(after):
        img = base.copy()
        d = ImageDraw.Draw(img)
        for i, row in enumerate(rows):
            hot = after and i in marked
            if hot:  # highlighter band and a solid bar at the left edge
                d.rectangle([o + P(10), row_y[i], o + P(CARD_W - 10), row_y[i] + P(ROW_H) - 1],
                            fill=(*BAND, 255))
                d.rectangle([o + P(10), row_y[i], o + P(16), row_y[i] + P(ROW_H) - 1],
                            fill=(*TERRACOTTA, 255))
            cx, cy = o + P(TEXT_X), row_y[i] + P(ROW_H / 2)
            for s, kind in row:
                if kind is not None:
                    c = HOT[kind] if hot else kind
                    if after and not hot:
                        c = mix(c, DIM)
                    d.text((cx, cy), s, font=f_bold if hot else f_reg, fill=(*c, 255), anchor="lm")
                cx += adv * len(s)
        note = f"… {more} more lines"
        c = mix(ELLIPSIS, 0.6) if after else ELLIPSIS
        d.text((o + P(TEXT_X), row_y[SHOWN] + P(ROW_H / 2)), "  " + note, font=f_note,
               fill=(*c, 255), anchor="lm")
        return np.asarray(img.convert("RGBa"))

    plain, after = draw(False), draw(True)
    return {
        "plain": plain, "after": after, "marked": marked,
        "plain_im": rgba_image(plain), "after_im": rgba_image(after),
        "rows": (row_y[0], row_y[0] + P((SHOWN + 1) * ROW_H)), "o": o,
    }


def caption_layer():
    f = font(FB, 42)
    tw = f.getlength(CAPTION)
    cw, ch = tw / SS + 2 * 34, 84
    m = 30
    lw, lh = int((cw + 2 * m) * SS), int((ch + 2 * m) * SS)
    sil = Image.new("L", (lw, lh), 0)
    ImageDraw.Draw(sil).rounded_rectangle([m * SS, m * SS, (m + cw) * SS, (m + ch) * SS],
                                          radius=16 * SS, fill=255)
    shadow = Image.new("L", (lw, lh), 0)
    shadow.paste(sil, (0, 10 * SS))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14 * SS)).point(lambda v: int(v * 0.6))
    img = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    img.paste(Image.new("RGBA", (lw, lh), (0, 0, 0, 255)), (0, 0), shadow)
    img.paste(Image.new("RGBA", (lw, lh), (*TERRACOTTA, 255)), (0, 0), sil)
    ImageDraw.Draw(img).text(((m + cw / 2) * SS, (m + ch / 2) * SS), CAPTION, font=f,
                             fill=(*PAPER, 255), anchor="mm")
    return img.convert("RGBa"), m, cw, ch


def background():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    lift = np.exp(-(((xx - CARD_X - CARD_W / 2) / 760) ** 2 + ((yy - ANCHOR[1]) / 1000) ** 2))
    r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    img = np.array(ESPRESSO, np.float32) + lift[..., None] * np.array([12, 9, 6], np.float32)
    return img * (1 - 0.22 * np.clip(r2, 0, 1.6) ** 1.3)[..., None]


def rgba_image(a):
    return Image.frombytes("RGBa", (a.shape[1], a.shape[0]), a.tobytes())


def place(frame, im, x, y, k, alpha=1.0, blur=0.0):
    """Composite a premultiplied (RGBa) SS layer with its top-left at (x, y) frame
    px, scaled by k frame px per layer px. Subpixel exact: the resample box carries
    the fraction, so a slow push-in never steps."""
    lw, lh = im.size
    ix0, iy0 = math.ceil(x), math.ceil(y)
    ix1, iy1 = math.floor(x + lw * k), math.floor(y + lh * k)
    box = ((ix0 - x) / k, (iy0 - y) / k, (ix1 - x) / k, (iy1 - y) / k)
    a = np.asarray(im.resize((ix1 - ix0, iy1 - iy0), Image.LANCZOS, box=box), np.float32)
    a = a * (alpha / 255.0)
    n = int(round(blur))
    if n >= 2:  # motion blur: horizontal box over the distance covered while the shutter is open
        p = np.pad(a, ((0, 0), (n, n), (0, 0)))
        c = np.concatenate([np.zeros_like(p[:, :1]), np.cumsum(p, axis=1)], axis=1)
        a = (c[:, n:] - c[:, :-n]) / n
        ix0 -= (n + 1) // 2
    h, w = a.shape[:2]
    fx0, fy0, fx1, fy1 = max(ix0, 0), max(iy0, 0), min(ix0 + w, W), min(iy0 + h, H)
    if fx1 <= fx0 or fy1 <= fy0:
        return
    a = a[fy0 - iy0:fy1 - iy0, fx0 - ix0:fx1 - ix0]
    dst = frame[fy0:fy1, fx0:fx1]
    dst *= 1 - a[..., 3:]
    dst += a[..., :3] * 255.0


def card_now(c, t, lag):
    """The card's pixels at time t: plain, marked, or mid-way, mixed row by row."""
    starts = {r: HL_T0 + lag + j * HL_STEP for j, r in enumerate(c["marked"])}
    dim = smooth(DIM_T[0] + lag, DIM_T[1] + lag, t)
    prog = {r: smooth(s, s + HL_LEN, t) for r, s in starts.items()}
    if dim == 0 and all(p == 0 for p in prog.values()):
        return c["plain_im"]
    if dim == 1 and all(p == 1 for p in prog.values()):
        return c["after_im"]
    y0, y1 = c["rows"]
    o = c["o"]
    w = c["plain"].shape[1]
    xs = np.arange(w, dtype=np.float32)
    feather = 60.0
    x_a, x_b = o + 10 * SS, o + (CARD_W - 10) * SS
    m = np.full((y1 - y0, w), dim, np.float32)
    for r in range(SHOWN + 1):
        ry = r * ROW_H * SS
        if r in prog:
            thr = x_a + prog[r] * (x_b - x_a + feather)
            m[ry:ry + ROW_H * SS] = np.clip((thr - xs) / feather, 0, 1)[None, :]
    out = c["plain"].copy()
    p, q = c["plain"][y0:y1].astype(np.float32), c["after"][y0:y1].astype(np.float32)
    out[y0:y1] = np.clip(p + (q - p) * m[..., None] + 0.5, 0, 255).astype(np.uint8)
    return rgba_image(out)


def main():
    cards = [card_layers(n) for n in FILES]
    cap, cap_m, cap_w, cap_h = caption_layer()
    bg = background()
    rng = np.random.default_rng(13)
    for i in range(int(DUR * FPS)):
        t = i / FPS
        frame = bg.copy()
        s = S0 + (S1 - S0) * t / DUR  # constant, slow push-in
        drift = DRIFT * t / DUR
        for j, c in enumerate(cards):
            a, b = SLIDE[j]
            e = ease(a, b, t)
            dx = -SLIDE_DX * (1 - e)
            # speed in px/frame from the previous frame's position; half-frame shutter
            v = SLIDE_DX * (ease(a, b, t) - ease(a, b, t - 1 / FPS))
            x = ANCHOR[0] + (CARD_X - MARGIN - ANCHOR[0]) * s + dx + drift
            y = ANCHOR[1] + (CARD_Y[j] - MARGIN - ANCHOR[1]) * s
            if e > 0:
                place(frame, card_now(c, t, HL_B_LAG * j), x, y, s / SS,
                      alpha=smooth(a, a + 0.5, t), blur=0.5 * v)
        ce = ease(*CAP_T, t)
        if ce > 0:
            cx = ANCHOR[0] + (CARD_X + CARD_W / 2 - cap_w / 2 - cap_m - ANCHOR[0]) * s + drift
            cy = ANCHOR[1] + (CAP_Y - cap_h / 2 - cap_m - ANCHOR[1]) * s + 22 * (1 - ce)
            place(frame, cap, cx, cy, s / SS, alpha=smooth(CAP_T[0], CAP_T[0] + 0.35, t))
        frame += rng.standard_normal((H, W, 1), dtype=np.float32) * 2.2  # film grain
        sys.stdout.buffer.write(np.clip(frame + 0.5, 0, 255).astype(np.uint8).tobytes())


if __name__ == "__main__":
    main()
