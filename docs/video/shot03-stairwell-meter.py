"""QWATT week 1 video, shot 3 (0:16-0:20): B-roll of a single meter in a
stairwell, under Jay's line "...whose meter, which number, who checks it."

Cool fluorescent light (a contrast with the warm rooftop), one meter cabinet on
a plaster wall, conduit running up out of frame, a stair rail in the soft
foreground. The meter's pulse LED blinks and its counter ticks, continuing the
reading from shot 1. Slow lateral slide with a slight push-in.

Writes raw RGB frames to stdout. Needs numpy and Pillow. Render with:

    python3 docs/video/shot03-stairwell-meter.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1920x1080 -r 30 -i - -f lavfi -i "anoisesrc=d=4:c=brown:r=48000:a=0.05" \\
      -f lavfi -i "sine=f=100:d=4:r=48000" \\
      -filter_complex "[1]lowpass=f=400[a1];[2]volume=0.012[a2];[a1][a2]amix=inputs=2:normalize=0,\\
    afade=t=in:st=0:d=0.15,afade=t=out:st=3.8:d=0.2[a]" -map 0:v -map "[a]" -c:v libx264 \\
      -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k -shortest \\
      QWATT-week1-shot03-stairwell-meter.mp4
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FPS = 30
DUR = 4.0
W, H = 1920, 1080
SS = 2  # supersampling
CW, CH = (W + 420) * SS, (H + 240) * SS

# Continues the counter from shot 1 (which ended near 4127.388 kWh at 0:11)
START_KWH = 4127.393
KW = 4.0
LED_WH = 1.0  # one LED pulse per Wh, like a real meter's test LED

SEGS = {
    "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
    "5": "afgcd", "6": "afgecd", "7": "abc", "8": "abcdefg", "9": "abcfgd",
}


def seg_polys(x, y, w, h, t, slant):
    def sk(px, py):
        return (px + (y + h - py) * slant, py)
    g, hh = t * 0.18, h / 2

    def horiz(cy):
        return [sk(x + g + t / 2, cy), sk(x + g + t, cy - t / 2), sk(x + w - g - t, cy - t / 2),
                sk(x + w - g - t / 2, cy), sk(x + w - g - t, cy + t / 2), sk(x + g + t, cy + t / 2)]

    def vert(cx, y0, y1):
        return [sk(cx, y0 + g + t / 2), sk(cx + t / 2, y0 + g + t), sk(cx + t / 2, y1 - g - t),
                sk(cx, y1 - g - t / 2), sk(cx - t / 2, y1 - g - t), sk(cx - t / 2, y0 + g + t)]

    return {"a": horiz(y + t / 2), "g": horiz(y + hh), "d": horiz(y + h - t / 2),
            "f": vert(x + t / 2, y, y + hh), "b": vert(x + w - t / 2, y, y + hh),
            "e": vert(x + t / 2, y + hh, y + h), "c": vert(x + w - t / 2, y + hh, y + h)}


def draw_number(d, s, x, y, w, h, t, gap, on, ghost):
    for ch in s:
        if ch == ".":
            r = t * 0.6
            d.ellipse([x - gap * 0.5 - r, y + h - 2 * r, x - gap * 0.5 + r, y + h], fill=on)
            continue
        polys = seg_polys(x, y, w, h, t, 0.09)
        for p in polys.values():
            d.polygon(p, fill=ghost)
        for name in SEGS[ch]:
            d.polygon(polys[name], fill=on)
        x += w + gap


def static_scene():
    """Everything that does not change between frames."""
    rng = np.random.default_rng(5)
    yy, xx = np.mgrid[0:CH, 0:CW].astype(float)
    # plaster wall lit from a fluorescent tube above and to the left
    light = 0.55 + 0.45 * np.exp(-(((xx - CW * 0.30) / (CW * 0.55)) ** 2 + ((yy + CH * 0.15) / (CH * 0.9)) ** 2))
    base = np.array([196, 202, 200], float)  # cool off-white paint
    wall = base * light[..., None]
    # plaster texture: low-frequency blotches plus fine grain
    blot = Image.fromarray((rng.random((CH // 40, CW // 40)) * 255).astype(np.uint8)).resize((CW, CH), Image.BICUBIC)
    wall *= (0.96 + 0.06 * np.asarray(blot, float) / 255)[..., None]
    wall += rng.normal(0, 2.5, (CH, CW, 1))
    img = Image.fromarray(np.clip(wall, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img, "RGBA")

    # painted dado band along the lower wall
    d.rectangle([0, CH * 0.80, CW, CH], fill=(120, 132, 128, 255))
    d.line([(0, CH * 0.80), (CW, CH * 0.80)], fill=(90, 100, 96, 255), width=6 * SS)

    # cabinet
    cx0, cy0, cx1, cy1 = CW * 0.40, CH * 0.20, CW * 0.40 + 620 * SS, CH * 0.20 + 760 * SS
    # wall shadow, offset down-right away from the light
    sh = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([cx0 + 26 * SS, cy0 + 34 * SS, cx1 + 26 * SS, cy1 + 34 * SS],
                                         radius=22 * SS, fill=(30, 36, 36, 110))
    img = Image.alpha_composite(img.convert("RGBA"), sh.filter(ImageFilter.GaussianBlur(24 * SS)))
    d = ImageDraw.Draw(img, "RGBA")

    # conduit pipes up out of frame, with clips
    for px in (cx0 + 150 * SS, cx0 + 250 * SS):
        d.rectangle([px - 18 * SS, -10, px + 18 * SS, cy0 + 10], fill=(170, 176, 176, 255))
        d.rectangle([px - 18 * SS, -10, px - 8 * SS, cy0 + 10], fill=(200, 206, 206, 255))
        for cy in (CH * 0.03, CH * 0.12):
            d.rectangle([px - 26 * SS, cy, px + 26 * SS, cy + 22 * SS], fill=(130, 136, 136, 255))

    # cabinet body: grey powder-coated steel, lit from the upper left
    d.rounded_rectangle([cx0, cy0, cx1, cy1], radius=22 * SS, fill=(150, 156, 158, 255))
    d.rounded_rectangle([cx0 + 6 * SS, cy0 + 6 * SS, cx1 - 14 * SS, cy1 - 14 * SS], radius=18 * SS,
                        fill=(168, 174, 176, 255))
    for sx, sy in ((cx0 + 34 * SS, cy0 + 34 * SS), (cx1 - 48 * SS, cy0 + 34 * SS),
                   (cx0 + 34 * SS, cy1 - 48 * SS), (cx1 - 48 * SS, cy1 - 48 * SS)):
        d.ellipse([sx - 9 * SS, sy - 9 * SS, sx + 9 * SS, sy + 9 * SS], fill=(110, 114, 116, 255))
        d.line([(sx - 6 * SS, sy), (sx + 6 * SS, sy)], fill=(70, 72, 74, 255), width=2 * SS)
    # handle
    d.rounded_rectangle([cx1 - 70 * SS, cy0 + 300 * SS, cx1 - 44 * SS, cy0 + 440 * SS], radius=8 * SS,
                        fill=(90, 94, 96, 255))
    # window
    wx0, wy0, wx1, wy1 = cx0 + 90 * SS, cy0 + 110 * SS, cx1 - 120 * SS, cy0 + 560 * SS
    d.rounded_rectangle([wx0, wy0, wx1, wy1], radius=14 * SS, fill=(40, 44, 46, 255))
    # meter body behind the window
    mx0, my0, mx1, my1 = wx0 + 40 * SS, wy0 + 40 * SS, wx1 - 40 * SS, wy1 - 30 * SS
    d.rounded_rectangle([mx0, my0, mx1, my1], radius=10 * SS, fill=(58, 62, 66, 255))
    # terminal cover and label below the display
    d.rectangle([mx0 + 30 * SS, my1 - 110 * SS, mx1 - 30 * SS, my1 - 30 * SS], fill=(48, 52, 56, 255))
    d.rectangle([mx0 + 50 * SS, my1 - 98 * SS, mx0 + 190 * SS, my1 - 74 * SS], fill=(190, 192, 188, 255))
    geo = dict(lcd=(mx0 + 30 * SS, my0 + 40 * SS, mx1 - 30 * SS, my0 + 170 * SS),
               led=(mx1 - 70 * SS, my0 + 210 * SS), win=(wx0, wy0, wx1, wy1))
    return img, geo


def dynamic_layer(img, geo, kwh, led_on, flicker):
    img = img.convert("RGB")  # RGBA drawing only blends onto an RGB base
    d = ImageDraw.Draw(img, "RGBA")
    x0, y0, x1, y1 = geo["lcd"]
    d.rectangle([x0, y0, x1, y1], fill=(150, 162, 140, 255))
    s = f"{kwh:.2f}"  # stairwell meters show 2 decimals
    dw, dh, dt, gap = 31 * SS, 62 * SS, 7 * SS, 9 * SS
    width = (len(s) - 1) * (dw + gap) - gap
    draw_number(d, s, (x0 + x1) / 2 - width / 2 - 4 * SS, (y0 + y1) / 2 - dh / 2, dw, dh, dt, gap,
                (26, 30, 24, 255), (40, 46, 36, 18))
    lx, ly = geo["led"]
    r = 9 * SS
    d.ellipse([lx - r, ly - r, lx + r, ly + r], fill=(255, 60, 40, 255) if led_on else (90, 30, 26, 255))
    img = img.convert("RGBA")
    if led_on:
        glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse([lx - 5 * r, ly - 5 * r, lx + 5 * r, ly + 5 * r], fill=(255, 70, 40, 90))
        img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(14 * SS)))
        d = ImageDraw.Draw(img, "RGBA")
    # glass on the cabinet window: a cool diagonal reflection
    wx0, wy0, wx1, wy1 = geo["win"]
    refl = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(refl).polygon([(wx0 + 60 * SS, wy0), (wx0 + 200 * SS, wy0), (wx0 + 40 * SS, wy1),
                                  (wx0 - 100 * SS, wy1)], fill=(230, 240, 245, int(26 * flicker)))
    return Image.alpha_composite(img, refl.filter(ImageFilter.GaussianBlur(6 * SS)))


def rail_layer():
    """Out-of-focus stair rail crossing the lower-left foreground."""
    lay = Image.new("RGBA", (W + 420, H + 240), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    d.line([(-80, H + 120), (900, 520)], fill=(38, 40, 42, 255), width=46)
    d.line([(-80, H + 200), (900, 600)], fill=(38, 40, 42, 255), width=14)
    for x in (120, 360, 600):
        y = H + 120 - (x + 80) * (H + 120 - 520) / 980
        d.line([(x, y), (x, H + 260)], fill=(38, 40, 42, 255), width=16)
    return lay.filter(ImageFilter.GaussianBlur(22))


def main():
    static, geo = static_scene()
    rail = rail_layer()
    rng = np.random.default_rng(9)
    yy, xx = np.mgrid[0:H, 0:W]
    r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    vignette = (1 - 0.30 * np.clip(r2, 0, 1.6) ** 1.5)[..., None]
    cache_key, cache = None, None
    for i in range(int(DUR * FPS)):
        t = i / FPS
        wh = (START_KWH * 1000) + KW * 1000 * t / 3600
        kwh = math.floor(wh / 10) / 100
        led_on = (wh % LED_WH) < 0.22  # short flash each Wh
        flicker = 1.0 - 0.025 * (math.sin(t * 2 * math.pi * 7.3) > 0.96) - 0.01 * math.sin(t * 13)
        key = (kwh, led_on)
        if key != cache_key:
            cache_key = key
            cache = dynamic_layer(static, geo, kwh, led_on, 1.0)

        # camera: slow slide right to left with a slight push-in
        p = t / DUR
        zoom = 1.0 + 0.06 * p
        vw, vh = W * SS / zoom, H * SS / zoom
        cx = (W / 2 + 330 - 200 * p) * SS + 6 * SS * math.sin(t * 1.7)
        cy = (H / 2 + 110 - 20 * p) * SS + 4 * SS * math.sin(t * 2.3 + 1)
        frame = cache.resize((W, H), Image.LANCZOS, box=(cx - vw / 2, cy - vh / 2, cx + vw / 2, cy + vh / 2))

        # foreground rail moves faster than the wall (parallax)
        rx = int(250 - 380 * p)
        frame = frame.convert("RGBA")
        frame.alpha_composite(rail, dest=(0, 0), source=(max(rx, 0), 120, max(rx, 0) + W, 120 + H))

        img = np.asarray(frame.convert("RGB"), float)
        img = img * np.array([0.95, 1.0, 1.04]) * flicker  # cool fluorescent cast
        img *= vignette
        img += rng.normal(0, 3.0, (H, W, 1))
        sys.stdout.buffer.write(np.clip(img, 0, 255).astype(np.uint8).tobytes())


if __name__ == "__main__":
    main()
