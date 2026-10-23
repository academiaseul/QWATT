"""QWATT week 1 video, shot 4 (0:20-0:23): wide shot of an apartment
building's shared roof, under Jay's line "Picture one roof, one meter, forty neighbors."

One mid-rise block in late-afternoon light, solar panels across its roof, and
exactly forty windows (8 floors x 5) that light up one by one until all forty
glow: the forty neighbors under one roof. Same sky and Andes as shot 2, so the
two cut together. Slow push-in with a slight rise.

Writes raw RGB frames to stdout. Needs numpy and Pillow. Render with:

    python3 docs/video/shot04-shared-roof.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1920x1080 -r 30 -i - -f lavfi -i "anoisesrc=d=3:c=pink:r=48000:a=0.03" \\
      -filter_complex "[1]lowpass=f=1200,highpass=f=80,afade=t=in:st=0:d=0.1,afade=t=out:st=2.85:d=0.15[a]" \\
      -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \\
      -movflags +faststart -c:a aac -b:a 192k -shortest QWATT-week1-shot04-shared-roof.mp4
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FPS = 30
DUR = 3.0
W, H = 1920, 1080
SS = 2
MW, MH = W + 240, H + 160  # margin so the camera can move
FLOORS, COLS = 8, 5


def s(*v):
    return [x * SS for x in v]


def sky_and_hills():
    pw, ph = MW * SS, MH * SS
    yy, xx = np.mgrid[0:ph, 0:pw].astype(float)
    v = yy / ph
    sky = np.stack([150 + 105 * v ** 1.4, 175 + 60 * v ** 1.4, 205 - 40 * v ** 1.2], axis=-1)
    sun = np.exp(-(((xx - pw * 0.88) / (240 * SS)) ** 2 + ((yy - ph * 0.30) / (200 * SS)) ** 2))
    sky += sun[..., None] * np.array([90, 60, 10])
    img = Image.fromarray(np.clip(sky, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img, "RGBA")
    rng = np.random.default_rng(11)
    pts, x, hy = [(0, ph)], 0, ph * 0.44
    while x < pw + 40:
        pts.append((x, hy + rng.normal(0, 4) - 70 * SS * math.sin(x / (380 * SS)) ** 2
                    - 40 * SS * math.sin(x / (150 * SS) + 1) ** 2))
        x += 18
    pts.append((pw, ph))
    d.polygon(pts, fill=(118, 112, 128, 255))
    d.rectangle([0, ph * 0.47, pw, ph * 0.56], fill=(205, 170, 140, 90))  # city haze
    return img


def window_rects():
    """Forty window rectangles on the front face, top floor first."""
    fx0, fy0, fx1, fy1 = 680, 440, 1440, 1120
    rects = []
    fh = (fy1 - fy0) / FLOORS
    cw = (fx1 - fx0) / COLS
    for f in range(FLOORS):
        for c in range(COLS):
            x0 = fx0 + c * cw + cw * 0.18
            y0 = fy0 + f * fh + fh * 0.22
            rects.append((x0, y0, x0 + cw * 0.64, y0 + fh * 0.50))
    return rects


def building(img):
    d = ImageDraw.Draw(img, "RGBA")
    # neighbors: lower blocks either side, cooler and hazier
    d.rectangle(s(120, 640, 600, MH), fill=(150, 140, 140, 255))
    d.rectangle(s(1600, 700, 2100, MH), fill=(146, 138, 140, 255))
    for x in range(160, 560, 80):
        for y in range(680, MH, 70):
            d.rectangle(s(x, y, x + 40, y + 34), fill=(110, 118, 132, 255))
    for x in range(1640, 2060, 80):
        for y in range(740, MH, 70):
            d.rectangle(s(x, y, x + 40, y + 34), fill=(110, 118, 132, 255))

    # the block: front face, sunlit side face, roof
    front = s(680, 440, 1440, MH)
    d.rectangle(front, fill=(214, 196, 176, 255))
    side = [(1440 * SS, 440 * SS), (1570 * SS, 360 * SS), (1570 * SS, MH * SS), (1440 * SS, MH * SS)]
    d.polygon(side, fill=(236, 206, 168, 255))
    roof = [(680 * SS, 440 * SS), (1440 * SS, 440 * SS), (1570 * SS, 360 * SS), (810 * SS, 360 * SS)]
    d.polygon(roof, fill=(150, 142, 134, 255))
    # floor slab lines
    for f in range(1, FLOORS + 1):
        y = 440 + f * (1120 - 440) / FLOORS
        d.line(s(680, y, 1440, y), fill=(190, 172, 152, 255), width=4 * SS)
    # parapet
    d.rectangle(s(676, 428, 1444, 446), fill=(196, 178, 158, 255))

    # panel rows across the roof, tilted toward the sun, with glints
    for r in range(4):
        t0 = 0.12 + r * 0.21
        y_front = 440 - 80 * t0
        x_shift = 130 * t0
        for c in range(7):
            x0 = 712 + x_shift + c * 104
            quad = [(x0, y_front - 4), (x0 + 92, y_front - 4), (x0 + 104, y_front - 26), (x0 + 12, y_front - 26)]
            quad = [(px * SS, py * SS) for px, py in quad]
            d.polygon(quad, fill=(30, 44, 70, 255), outline=(180, 186, 196, 255))
            if (r + c) % 3 == 0:
                d.polygon(quad, fill=(255, 214, 160, 28))
    return img


def windows_layer(base, lit_amount):
    img = base.copy()
    d = ImageDraw.Draw(img, "RGBA")
    for (x0, y0, x1, y1), a in zip(window_rects(), lit_amount):
        dark = np.array([70, 84, 104])  # glass reflecting the sky
        warm = np.array([255, 196, 120])
        col = tuple(int(v) for v in dark + (warm - dark) * a)
        d.rectangle(s(x0, y0, x1, y1), fill=col + (255,))
        d.line(s(x0 + (x1 - x0) / 2, y0, x0 + (x1 - x0) / 2, y1), fill=(60, 56, 54, 255), width=3 * SS)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for (x0, y0, x1, y1), a in zip(window_rects(), lit_amount):
        if a > 0:
            gd.rectangle(s(x0 - 6, y0 - 6, x1 + 6, y1 + 6), fill=(255, 190, 110, int(70 * a)))
    return Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(10 * SS))).convert("RGB")


def main():
    base = building(sky_and_hills())
    rng = np.random.default_rng(40)
    # 14 already lit, the other 26 switch on in random order across the shot
    order = rng.permutation(FLOORS * COLS)
    on_time = np.zeros(FLOORS * COLS)
    on_time[order[:14]] = -1.0
    on_time[order[14:]] = np.sort(rng.uniform(0.15, 2.45, FLOORS * COLS - 14))
    grain_rng = np.random.default_rng(2)
    yy, xx = np.mgrid[0:H, 0:W]
    r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    vignette = (1 - 0.25 * np.clip(r2, 0, 1.6) ** 1.5)[..., None]
    last_key, frame_src = None, None
    for i in range(int(DUR * FPS)):
        t = i / FPS
        lit = np.clip((t - on_time) / 0.12, 0, 1)
        lit = np.round(lit * 6) / 6  # quantize so frames can be cached
        key = lit.tobytes()
        if key != last_key:
            last_key, frame_src = key, windows_layer(base, lit)
        p = t / DUR
        zoom = 1.0 + 0.05 * p
        vw, vh = W * SS / zoom, H * SS / zoom
        cx = (MW / 2 + 40 - 30 * p) * SS
        cy = (MH / 2 - 40 * p) * SS
        frame = frame_src.resize((W, H), Image.LANCZOS, box=(cx - vw / 2, cy - vh / 2, cx + vw / 2, cy + vh / 2))
        img = np.asarray(frame, float) * np.array([1.04, 1.0, 0.94])  # late-afternoon warmth
        img *= vignette
        img += grain_rng.normal(0, 2.8, (H, W, 1))
        sys.stdout.buffer.write(np.clip(img, 0, 255).astype(np.uint8).tobytes())


if __name__ == "__main__":
    main()
