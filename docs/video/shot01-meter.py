"""QWATT week 1 video, shot 1 (0:00-0:11): black, fade up on an extreme
close-up of a meter display, digits ticking, slow push-in. No logo.

Writes raw RGB frames to stdout for ffmpeg. Needs numpy and Pillow. Render with:

    python3 docs/video/shot01-meter.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - \
      -f lavfi -i "sine=f=50:d=11:r=48000" -f lavfi -i "sine=f=100:d=11:r=48000" \
      -f lavfi -i "sine=f=150:d=11:r=48000" -f lavfi -i "anoisesrc=d=11:c=pink:r=48000:a=0.02" \
      -filter_complex "[1]volume=0.10[a1];[2]volume=0.06[a2];[3]volume=0.025[a3];[4]lowpass=f=900[a4];\
    [a1][a2][a3][a4]amix=inputs=4:normalize=0,afade=t=in:st=0:d=2.5,afade=t=out:st=10.6:d=0.4,volume=1.4[a]" \
      -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
      -c:a aac -b:a 192k -shortest QWATT-week1-shot01-meter.mp4

The 50 Hz hum matches Chile's mains frequency."""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FPS = 30
DUR = 11.0
OUT_W, OUT_H = 1920, 1080
CW, CH = 4600, 2160  # supersampled scene canvas

# Energy counter: 4.0 kW rooftop -> 0.001 kWh roughly every 0.9 s
START_KWH = 4127.376
KW = 4.0

BG_TOP = np.array([176, 186, 164], float)
BG_BOT = np.array([150, 160, 140], float)
SEG_ON = (28, 33, 26)
SHADOW = (120, 128, 112)

SEGS = {
    "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
    "5": "afgcd", "6": "afgecd", "7": "abc", "8": "abcdefg", "9": "abcfgd",
}


def seg_polys(x, y, w, h, t, slant):
    """Seven hexagonal segments of one digit, top-left at (x, y)."""
    def sk(px, py):  # italic slant around the digit's baseline
        return (px + (y + h - py) * slant, py)

    g = t * 0.18
    hh = h / 2
    def horiz(cy):
        return [sk(x + g + t / 2, cy), sk(x + g + t, cy - t / 2), sk(x + w - g - t, cy - t / 2),
                sk(x + w - g - t / 2, cy), sk(x + w - g - t, cy + t / 2), sk(x + g + t, cy + t / 2)]

    def vert(cx, y0, y1):
        return [sk(cx, y0 + g + t / 2), sk(cx + t / 2, y0 + g + t), sk(cx + t / 2, y1 - g - t),
                sk(cx, y1 - g - t / 2), sk(cx - t / 2, y1 - g - t), sk(cx - t / 2, y0 + g + t)]

    return {
        "a": horiz(y + t / 2), "g": horiz(y + hh), "d": horiz(y + h - t / 2),
        "f": vert(x + t / 2, y, y + hh), "b": vert(x + w - t / 2, y, y + hh),
        "e": vert(x + t / 2, y + hh, y + h), "c": vert(x + w - t / 2, y + hh, y + h),
    }


def draw_digit(d, ch, x, y, w, h, t, slant, ghost_fill, on_fill, shadow_off):
    polys = seg_polys(x, y, w, h, t, slant)
    for name, p in polys.items():
        d.polygon(p, fill=ghost_fill)
    for name in SEGS.get(ch, ""):
        p = polys[name]
        d.polygon([(px + shadow_off, py + shadow_off * 1.3) for px, py in p], fill=SHADOW)
    for name in SEGS.get(ch, ""):
        d.polygon(polys[name], fill=on_fill)


def lcd_background():
    yy = np.linspace(0, 1, CH)[:, None, None]
    bg = BG_TOP * (1 - yy) + BG_BOT * yy
    bg = np.repeat(bg, CW, axis=1)
    rng = np.random.default_rng(7)
    bg += rng.normal(0, 1.6, (CH, CW, 1))  # faint film texture of the LCD
    return np.clip(bg, 0, 255).astype(np.uint8)


BASE = Image.fromarray(lcd_background())

# Layout on the canvas: one big counter row, small annotations
DW, DH, DT, SLANT = 330, 600, 64, 0.09
GAP = 92
ROW_Y = 760
N_INT, N_DEC = 6, 3
ROW_X = 330
DEC_X = ROW_X + N_INT * (DW + GAP) + 40
DEC_CX = DEC_X + (N_DEC * (DW + GAP) - GAP) / 2 + 20


def render_panel(kwh, kw):
    img = BASE.copy()
    d = ImageDraw.Draw(img, "RGBA")
    ghost = (40, 46, 36, 16)
    s = f"{kwh:0{N_INT + N_DEC + 1}.{N_DEC}f}"
    integer, dec = s.split(".")
    x = ROW_X
    for i, ch in enumerate(integer + dec):
        draw_digit(d, ch, x, ROW_Y, DW, DH, DT, SLANT, ghost, SEG_ON, 9)
        x += DW + GAP
        if i == N_INT - 1:  # decimal point
            cx = x - GAP / 2 - 6
            r = DT * 0.62
            d.ellipse([cx - r + 8, ROW_Y + DH - 2 * r + 9, cx + r + 8, ROW_Y + DH + 9], fill=SHADOW)
            d.ellipse([cx - r, ROW_Y + DH - 2 * r, cx + r, ROW_Y + DH], fill=SEG_ON)
            x += 40
    # unit "kWh" after the counter, as LCD-style segments of a smaller size
    _small_text(d, "kWh", x + 30, ROW_Y + DH - 220, 200)

    # top row: live power, small digits + annunciators
    p = f"{kw:4.2f}"
    sx = 3300
    for ch in p:
        if ch == ".":
            d.ellipse([sx - 34, 520, sx - 2, 552], fill=SEG_ON)
            continue
        draw_digit(d, ch, sx, 330, 120, 220, 26, SLANT, ghost, SEG_ON, 5)
        sx += 160
    _small_text(d, "kW", sx + 20, 430, 130)
    # annunciator bar segments (import arrow, phase markers), ghosted when off
    for i, on in enumerate([1, 1, 0, 1]):
        fill = SEG_ON if on else ghost
        d.rectangle([380 + i * 170, 380, 500 + i * 170, 430], fill=fill)
    d.polygon([(1100, 360), (1190, 405), (1100, 450)], fill=SEG_ON)  # flow arrow
    d.polygon([(1230, 360), (1320, 405), (1230, 450)], fill=SEG_ON)
    # thin LCD frame line
    d.rounded_rectangle([210, 230, CW - 210, CH - 260], radius=40, outline=(60, 66, 56, 90), width=10)
    return img


# Tiny segment-ish letters (built from strokes, not a font, to stay "LCD")
LETTERS = {
    "k": [((0, 0), (0, 1)), ((0, 0.62), (0.55, 0.3)), ((0.2, 0.52), (0.6, 1))],
    "W": [((0, 0), (0.2, 1)), ((0.2, 1), (0.42, 0.35)), ((0.42, 0.35), (0.64, 1)), ((0.64, 1), (0.84, 0))],
    "h": [((0, 0), (0, 1)), ((0, 0.45), (0.5, 0.45)), ((0.5, 0.45), (0.5, 1))],
}


def _small_text(d, text, x, y, size):
    for ch in text:
        for (x0, y0), (x1, y1) in LETTERS[ch]:
            d.line([(x + x0 * size, y + y0 * size), (x + x1 * size, y + y1 * size)],
                   fill=SEG_ON, width=int(size * 0.13))
        x += size * (1.05 if ch == "W" else 0.8)


def scene(panel):
    """Panel behind glass inside a dark bezel."""
    sc = Image.new("RGB", (CW + 1200, CH + 900), (9, 9, 10))
    sc.paste(panel, (600, 450))
    return sc


def smoothstep(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def main():
    nframes = int(DUR * FPS)
    cache = {}
    yy, xx = np.mgrid[0:OUT_H, 0:OUT_W]
    nx = (xx - OUT_W / 2) / (OUT_W / 2)
    ny = (yy - OUT_H / 2) / (OUT_H / 2)
    r2 = nx ** 2 + (ny * 1.1) ** 2
    vignette = (1 - 0.32 * np.clip(r2, 0, 1.6) ** 1.6)[..., None]
    rng = np.random.default_rng(3)

    for f in range(nframes):
        t = f / FPS
        kwh = START_KWH + KW * t / 3600.0
        kwh = math.floor(kwh * 1000) / 1000
        kw = KW + 0.06 * math.sin(t * 1.3) + 0.03 * math.sin(t * 3.7 + 1)
        kw = round(kw, 2)
        key = (kwh, kw)
        if key not in cache:
            cache.clear()
            cache[key] = scene(render_panel(kwh, kw))
        sc = cache[key]

        # Camera: slow push-in that ends with the ticking decimals filling the frame
        push = smoothstep(0.0, DUR, t) * 0.75 + (t / DUR) * 0.25
        start_w, end_w = 4200.0, 1240.0
        view_w = start_w * (end_w / start_w) ** push  # geometric, so the zoom speed feels even
        view_h = view_w * OUT_H / OUT_W
        sx0, sy0 = 600 + CW / 2, 450 + CH / 2 + 60
        sx1, sy1 = 600 + DEC_CX, 450 + ROW_Y + DH / 2
        cx = sx0 + (sx1 - sx0) * push + 10 * math.sin(t * 0.7) + 4 * math.sin(t * 2.3)
        cy = sy0 + (sy1 - sy0) * push + 7 * math.sin(t * 0.9 + 2) + 3 * math.sin(t * 2.9)
        box = (cx - view_w / 2, cy - view_h / 2, cx + view_w / 2, cy + view_h / 2)
        frame = sc.resize((OUT_W, OUT_H), Image.BICUBIC, box=box, reducing_gap=2.0)

        # Shallow depth of field: sharp band through the digits, soft above/below
        blurred = frame.filter(ImageFilter.GaussianBlur(9))
        focus = np.exp(-((ny - 0.08) / 0.62) ** 4)[..., None]
        img = np.asarray(frame, float) * focus + np.asarray(blurred, float) * (1 - focus)

        # Glass: a soft diagonal reflection drifting slowly across
        band_pos = -0.6 + 0.12 * t
        band = np.exp(-((nx * 0.8 + ny * 0.6 - band_pos) / 0.35) ** 2)[..., None]
        img = img + 22 * band

        # Warm natural light, vignette, grain
        img = img * np.array([1.04, 1.0, 0.93])
        img *= vignette
        img += rng.normal(0, 3.2, (OUT_H, OUT_W, 1))

        # Black, then fade up
        img *= smoothstep(0.8, 3.2, t)
        sys.stdout.buffer.write(np.clip(img, 0, 255).astype(np.uint8).tobytes())


if __name__ == "__main__":
    main()
