"""QWATT week 1 video, shot 4 (0:20-0:23): wide shot of an apartment
building's shared roof, under Jay's line "Picture one roof, one meter, forty neighbors."

One mid-rise block in late-afternoon light, solar panels across its roof, and
exactly forty windows (8 floors x 5) that light up one by one until all forty
glow: the forty neighbors under one roof. Same sky and Andes as shot 2, so the
two cut together. Slow push-in with a slight rise.

Two modes: no argument renders the original horizontal 1920x1080 shot;
"vertical" renders 1080x1920 for the vertical cut. The vertical shot is
re-composed rather than cropped: the same block stands left of centre (clear
of the platform buttons on the right) with sky and Andes above its roof, and
all forty windows stay inside the frame and above the caption band for the
whole move, which the horizontal framing did not manage (it cut the bottom
row). Below the forty windows the block stands on a double-height lobby with
no windows and a street-level entrance at the scale of the floors above; the
crowns of the street trees hide the street. The parapet of the roof the camera
stands on fills the caption band in the soft foreground, sliding down faster
than the block as the camera rises, so the move reveals more of the trees.
The window order and timing are the same as the horizontal shot.

Writes raw RGB frames to stdout. Needs numpy and Pillow. Render with:

    python3 docs/video/shot04-shared-roof.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1920x1080 -r 30 -i - -f lavfi -i "anoisesrc=d=3:c=pink:r=48000:a=0.03" \\
      -filter_complex "[1]lowpass=f=1200,highpass=f=80,afade=t=in:st=0:d=0.1,afade=t=out:st=2.85:d=0.15[a]" \\
      -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \\
      -movflags +faststart -c:a aac -b:a 192k -shortest QWATT-week1-shot04-shared-roof.mp4

    python3 docs/video/shot04-shared-roof.py vertical | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1080x1920 -r 30 -i - -f lavfi -i "anoisesrc=d=3:c=pink:r=48000:a=0.03:seed=4" \\
      -filter_complex "[1]lowpass=f=1200,highpass=f=80,afade=t=in:st=0:d=0.1,afade=t=out:st=2.85:d=0.15[a]" \\
      -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \\
      -movflags +faststart -c:a aac -b:a 192k -shortest QWATT-week1-shot04-shared-roof-vertical.mp4
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

# Vertical cut: taller canvas, the same block moved left and down so all 40 windows stay in frame
V_W, V_H = 1080, 1920
V_MW, V_MH = V_W + 240, V_H + 160
V_BLOCK = (223, 530, 983, 1210)  # front face: x0, top, x1, bottom of the 8th window floor
V_STREET = 1384                  # the block's base at street level: a lobby about two floors high
V_PARAPET_Y = 1400               # foreground parapet top, frame pixels, at the start of the move


def s(*v):
    return [x * SS for x in v]


def sky_and_hills(mw=MW, mh=MH, hill=0.44, haze=(0.47, 0.56), sun=(0.88, 0.30), sky_k=1):
    pw, ph = mw * SS, mh * SS
    yy, xx = np.mgrid[0:ph, 0:pw].astype(float)
    v = yy / (ph * sky_k)  # sky_k < 1 keeps the horizon colour at the horizon on a taller canvas
    sky = np.stack([150 + 105 * v ** 1.4, 175 + 60 * v ** 1.4, 205 - 40 * v ** 1.2], axis=-1)
    sun = np.exp(-(((xx - pw * sun[0]) / (240 * SS)) ** 2 + ((yy - ph * sun[1]) / (200 * SS)) ** 2))
    sky += sun[..., None] * np.array([90, 60, 10])
    img = Image.fromarray(np.clip(sky, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img, "RGBA")
    rng = np.random.default_rng(11)
    pts, x, hy = [(0, ph)], 0, ph * hill
    while x < pw + 40:
        pts.append((x, hy + rng.normal(0, 4) - 70 * SS * math.sin(x / (380 * SS)) ** 2
                    - 40 * SS * math.sin(x / (150 * SS) + 1) ** 2))
        x += 18
    pts.append((pw, ph))
    d.polygon(pts, fill=(118, 112, 128, 255))
    d.rectangle([0, ph * haze[0], pw, ph * haze[1]], fill=(205, 170, 140, 90))  # city haze
    return img


def window_rects(fx0=680, fy0=440, fx1=1440, fy1=1120):
    """Forty window rectangles on the front face, top floor first."""
    rects = []
    fh = (fy1 - fy0) / FLOORS
    cw = (fx1 - fx0) / COLS
    for f in range(FLOORS):
        for c in range(COLS):
            x0 = fx0 + c * cw + cw * 0.18
            y0 = fy0 + f * fh + fh * 0.22
            rects.append((x0, y0, x0 + cw * 0.64, y0 + fh * 0.50))
    return rects


def block(d, fx0=680, fy0=440, fx1=1440, fy1=1120, bottom=MH):
    """The block: front face, sunlit side face, roof, floor slabs, panels."""
    front = s(fx0, fy0, fx1, bottom)
    d.rectangle(front, fill=(214, 196, 176, 255))
    side = [(fx1 * SS, fy0 * SS), ((fx1 + 130) * SS, (fy0 - 80) * SS), ((fx1 + 130) * SS, bottom * SS),
            (fx1 * SS, bottom * SS)]
    d.polygon(side, fill=(236, 206, 168, 255))
    roof = [(fx0 * SS, fy0 * SS), (fx1 * SS, fy0 * SS), ((fx1 + 130) * SS, (fy0 - 80) * SS),
            ((fx0 + 130) * SS, (fy0 - 80) * SS)]
    d.polygon(roof, fill=(150, 142, 134, 255))
    # floor slab lines
    for f in range(1, FLOORS + 1):
        y = fy0 + f * (fy1 - fy0) / FLOORS
        d.line(s(fx0, y, fx1, y), fill=(190, 172, 152, 255), width=4 * SS)
    # parapet
    d.rectangle(s(fx0 - 4, fy0 - 12, fx1 + 4, fy0 + 6), fill=(196, 178, 158, 255))

    # panel rows across the roof, tilted toward the sun, with glints
    for r in range(4):
        t0 = 0.12 + r * 0.21
        y_front = fy0 - 80 * t0
        x_shift = 130 * t0
        for c in range(7):
            x0 = fx0 + 32 + x_shift + c * 104
            quad = [(x0, y_front - 4), (x0 + 92, y_front - 4), (x0 + 104, y_front - 26), (x0 + 12, y_front - 26)]
            quad = [(px * SS, py * SS) for px, py in quad]
            d.polygon(quad, fill=(30, 44, 70, 255), outline=(180, 186, 196, 255))
            if (r + c) % 3 == 0:
                d.polygon(quad, fill=(255, 214, 160, 28))


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
    block(d)
    return img


def building_v(img):
    """Vertical cut: the same block left of centre, its lobby and the street trees below its forty windows."""
    d = ImageDraw.Draw(img, "RGBA")
    fx0, fy0, fx1, fy1 = V_BLOCK
    # neighbors at the frame edges, cooler and hazier
    d.rectangle(s(-40, 770, 200, V_MH), fill=(150, 140, 140, 255))
    d.rectangle(s(1125, 830, V_MW + 40, V_MH), fill=(146, 138, 140, 255))
    for x in range(-20, 170, 80):
        for y in range(810, V_MH, 70):
            d.rectangle(s(x, y, x + 40, y + 34), fill=(110, 118, 132, 255))
    for x in range(1165, V_MW, 80):
        for y in range(870, V_MH, 70):
            d.rectangle(s(x, y, x + 40, y + 34), fill=(110, 118, 132, 255))

    block(d, fx0, fy0, fx1, fy1, V_MH)
    # ground floor: a plinth band, then a double-height lobby with no windows and a
    # street-level entrance at the scale of the floors above (door about one floor high)
    g0, base = fy1 + 14, V_STREET
    d.rectangle(s(fx0, fy1, fx1, g0), fill=(184, 166, 146, 255))
    d.rectangle(s(fx0, g0, fx1, V_MH), fill=(198, 180, 160, 255))  # down behind the trees
    ex = (fx0 + fx1) / 2
    d.rectangle(s(ex - 80, base - 126, ex + 80, base - 114), fill=(120, 110, 102, 255))  # canopy
    d.rectangle(s(ex - 48, base - 112, ex + 48, base), fill=(84, 78, 74, 255))  # entrance recess
    d.rectangle(s(ex - 42, base - 82, ex - 2, base), fill=(62, 64, 70, 255))  # door leaves
    d.rectangle(s(ex + 2, base - 82, ex + 42, base), fill=(62, 64, 70, 255))
    return street_trees(img, base)


def street_trees(img, top):
    """Vertical cut: crowns of the street trees in front of the block's base, so the
    camera rising over its parapet reveals foliage, never the street."""
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    rng = np.random.default_rng(43)
    dark, mid, lit = (80, 86, 70, 255), (98, 104, 78, 255), (128, 128, 94, 255)
    d.rectangle(s(-20, top + 40, V_MW + 20, V_MH), fill=dark)
    x = -60.0
    while x < V_MW + 60:  # crowns of uneven size and height along the street
        rw = rng.uniform(55, 105)
        cx, cy = x + rw, top + rng.uniform(-5, 45)
        d.ellipse(s(cx - rw, cy, cx + rw, cy + 2.4 * rw), fill=dark)
        for _ in range(7):  # foliage clumps, the sunlit ones up and to the right (sun on the right)
            a = rng.uniform(-math.pi, -0.2)
            r = rng.uniform(0.3, 0.75) * rw
            px, py, pr = cx + math.cos(a) * r, cy + rw * 0.95 + math.sin(a) * r * 0.9, rng.uniform(0.3, 0.45) * rw
            d.ellipse(s(px - pr, py - pr, px + pr, py + pr), fill=lit if math.cos(a) > 0.3 else mid)
        x += rw * rng.uniform(1.4, 1.8)
    lay = lay.filter(ImageFilter.GaussianBlur(2 * SS))  # foliage edges, soft at this distance
    return Image.alpha_composite(img.convert("RGBA"), lay).convert("RGB")


def windows_layer(base, lit_amount, rects=None):
    rects = window_rects() if rects is None else rects
    img = base.copy()
    d = ImageDraw.Draw(img, "RGBA")
    for (x0, y0, x1, y1), a in zip(rects, lit_amount):
        dark = np.array([70, 84, 104])  # glass reflecting the sky
        warm = np.array([255, 196, 120])
        col = tuple(int(v) for v in dark + (warm - dark) * a)
        d.rectangle(s(x0, y0, x1, y1), fill=col + (255,))
        d.line(s(x0 + (x1 - x0) / 2, y0, x0 + (x1 - x0) / 2, y1), fill=(60, 56, 54, 255), width=3 * SS)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for (x0, y0, x1, y1), a in zip(rects, lit_amount):
        if a > 0:
            gd.rectangle(s(x0 - 6, y0 - 6, x1 + 6, y1 + 6), fill=(255, 190, 110, int(70 * a)))
    return Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(10 * SS))).convert("RGB")


def parapet_layer():
    """Vertical cut: the near parapet of the camera's own roof, soft, catching the low sun on its cap."""
    lw, lh = V_W + 80, V_H
    rng = np.random.default_rng(41)
    yy = np.arange(lh, dtype=float)[:, None, None]
    face = np.array([86, 74, 66], float) * (1 - 0.35 * np.clip((yy - 40) / 600, 0, 1))  # darker lower down
    face = np.repeat(face, lw, axis=1) + rng.normal(0, 3.0, (lh, lw, 1))  # concrete
    lay = Image.fromarray(np.clip(face, 0, 255).astype(np.uint8)).convert("RGBA")
    d = ImageDraw.Draw(lay)
    d.rectangle([0, 0, lw, 26], fill=(196, 160, 124, 255))     # coping, lit from the side
    d.rectangle([0, 26, lw, 40], fill=(64, 54, 48, 255))       # its shadow line
    pad = Image.new("RGBA", (lw, lh + 60), (0, 0, 0, 0))
    pad.paste(lay, (0, 60))
    return pad.filter(ImageFilter.GaussianBlur(7))


def lit_schedule():
    rng = np.random.default_rng(40)
    # 14 already lit, the other 26 switch on in random order across the shot
    order = rng.permutation(FLOORS * COLS)
    on_time = np.zeros(FLOORS * COLS)
    on_time[order[:14]] = -1.0
    on_time[order[14:]] = np.sort(rng.uniform(0.15, 2.45, FLOORS * COLS - 14))
    return on_time


def horizontal():
    base = building(sky_and_hills())
    on_time = lit_schedule()
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


def vertical():
    hill = 520 / V_MH  # Andes ridge just below the roofline, peaks showing above it
    base = building_v(sky_and_hills(V_MW, V_MH, hill, (hill + 38 / V_MH, hill + 149 / V_MH),
                                    (0.82, 0.15), hill / 0.44))
    rects = window_rects(*V_BLOCK)
    parapet = parapet_layer()
    on_time = lit_schedule()
    grain_rng = np.random.default_rng(2)
    yy, xx = np.mgrid[0:V_H, 0:V_W]
    r2 = ((xx - V_W / 2) / (V_W / 2)) ** 2 + ((yy - V_H / 2) / (V_H / 2)) ** 2
    vignette = (1 - 0.25 * np.clip(r2, 0, 1.6) ** 1.5)[..., None]
    last_key, frame_src = None, None
    for i in range(int(DUR * FPS)):
        t = i / FPS
        lit = np.clip((t - on_time) / 0.12, 0, 1)
        lit = np.round(lit * 6) / 6  # quantize so frames can be cached
        key = lit.tobytes()
        if key != last_key:
            last_key, frame_src = key, windows_layer(base, lit, rects)
        p = t / DUR
        zoom = 1.0 + 0.05 * p
        vw, vh = V_W * SS / zoom, V_H * SS / zoom
        cx = (V_MW / 2 + 30 - 20 * p) * SS
        cy = (V_MH / 2 - 40 * p) * SS
        frame = frame_src.resize((V_W, V_H), Image.LANCZOS, box=(cx - vw / 2, cy - vh / 2, cx + vw / 2, cy + vh / 2))

        # near parapet: rises with the camera, so it slides down faster than the block (parallax)
        top = V_PARAPET_Y + 150 * p
        frame = frame.convert("RGBA")
        frame.alpha_composite(parapet, dest=(0, int(top) - 60), source=(int(40 - 30 * p), 0))

        img = np.asarray(frame.convert("RGB"), float) * np.array([1.04, 1.0, 0.94])  # late-afternoon warmth
        img *= vignette
        img += grain_rng.normal(0, 2.8, (V_H, V_W, 1))
        sys.stdout.buffer.write(np.clip(img, 0, 255).astype(np.uint8).tobytes())


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "horizontal"
    if mode == "horizontal":
        horizontal()
    elif mode == "vertical":
        vertical()
    else:
        sys.exit(f"unknown mode {mode!r}: use vertical, or no argument for horizontal")


if __name__ == "__main__":
    main()
