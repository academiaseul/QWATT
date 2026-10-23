"""QWATT week 1 video, shot 2 (0:11-0:16): hard cut to Jay on a rooftop in
Santiago, panels behind him, late-afternoon sun. Lower third: Jay Kim · Co-founder, QWATT.

Jay's footage has to be filmed; this renders the parts around it:

  overlay  the lower third alone, with transparency, to lay over the real footage
  plate    a stand-in rooftop with a framing guide where Jay stands, plus the lower
           third, for a rough cut until the real take exists

Writes raw RGBA frames to stdout. Needs numpy and Pillow. Render with:

    python3 docs/video/shot02-jay-roof.py overlay | ffmpeg -y -f rawvideo -pix_fmt rgba \\
      -s 1920x1080 -r 30 -i - -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le \\
      QWATT-week1-shot02-lower-third.mov
    python3 docs/video/shot02-jay-roof.py plate | ffmpeg -y -f rawvideo -pix_fmt rgba \\
      -s 1920x1080 -r 30 -i - -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart \\
      QWATT-week1-shot02-placeholder.mp4
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FPS = 30
DUR = 5.0
W, H = 1920, 1080

TERRACOTTA = (176, 88, 47)
PAPER = (250, 248, 242)
ESPRESSO = (22, 16, 10)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_BOOK = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
NAME = "Jay Kim"
ROLE = "Co-founder, QWATT"


def ease(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return 1 - (1 - x) ** 3  # ease-out cubic


def lower_third(t):
    """RGBA lower third: in at 0.3-1.1 s, hold, out at 4.2-4.8 s."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fn = ImageFont.truetype(FONT_BOLD, 58)
    fr = ImageFont.truetype(FONT_BOOK, 34)
    x0, y0 = 140, 820
    out = ease(4.2, 4.8, t)
    grow = ease(0.3, 0.7, t) * (1 - out)
    wipe = ease(0.5, 1.1, t) * (1 - out)
    if grow <= 0:
        return img

    bar_h = 128 * grow
    nw = d.textlength(NAME, font=fn)
    rw = d.textlength(ROLE, font=fr)
    panel_w = max(nw, rw) + 70

    # soft dark panel behind the text so it reads on bright sky
    pw = int(panel_w * wipe)
    if pw > 0:
        shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(shade).rectangle([x0 + 10, y0 - 6, x0 + 10 + pw, y0 + 134],
                                        fill=(*ESPRESSO, int(150 * wipe)))
        img = Image.alpha_composite(img, shade.filter(ImageFilter.GaussianBlur(2)))
        d = ImageDraw.Draw(img)

    # terracotta bar grows from the middle
    mid = y0 + 64
    d.rectangle([x0, mid - bar_h / 2, x0 + 10, mid + bar_h / 2], fill=(*TERRACOTTA, 255))

    # text revealed left to right
    txt = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    td = ImageDraw.Draw(txt)
    td.text((x0 + 40, y0 + 6), NAME, font=fn, fill=(*PAPER, 255))
    td.text((x0 + 42, y0 + 78), ROLE, font=fr, fill=(*PAPER, 215))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rectangle([0, 0, x0 + 10 + pw, H], fill=255)
    txt.putalpha(Image.fromarray(np.minimum(np.asarray(txt.getchannel("A")),
                                            np.asarray(mask))))
    return Image.alpha_composite(img, txt)


def rooftop_plate():
    """Wide stand-in plate, larger than the frame so the camera can drift."""
    pw, ph = W + 160, H + 100
    yy, xx = np.mgrid[0:ph, 0:pw].astype(float)
    # late-afternoon sky: warm near the horizon, pale blue above
    v = yy / ph
    sky = np.stack([
        150 + 105 * v ** 1.4, 175 + 60 * v ** 1.4, 205 - 40 * v ** 1.2,
    ], axis=-1)
    sun = np.exp(-(((xx - pw * 0.82) / 260) ** 2 + ((yy - ph * 0.36) / 220) ** 2))
    sky += sun[..., None] * np.array([90, 60, 10])
    img = Image.fromarray(np.clip(sky, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img, "RGBA")

    # Andes silhouette on the horizon
    rng = np.random.default_rng(11)
    pts, x, hy = [(0, ph)], 0, ph * 0.52
    while x < pw + 40:
        pts.append((x, hy + rng.normal(0, 4) - 70 * math.sin(x / 380) ** 2 - 40 * math.sin(x / 150 + 1) ** 2))
        x += 18
    pts.append((pw, ph))
    d.polygon(pts, fill=(118, 112, 128, 255))
    # city haze band
    d.rectangle([0, ph * 0.56, pw, ph * 0.62], fill=(205, 170, 140, 90))

    # roof deck
    d.polygon([(0, ph * 0.60), (pw, ph * 0.60), (pw, ph), (0, ph)], fill=(150, 140, 128, 255))

    # rows of panels in perspective, receding toward the horizon
    vx, vy = pw * 0.42, ph * 0.55
    for r, (y_near, depth) in enumerate([(ph * 0.98, 0.0), (ph * 0.80, 0.3), (ph * 0.69, 0.55)]):
        y_top = y_near - (150 - 90 * depth)
        for c in range(-6, 8):
            xa = vx + (c * 230 - 40) * (1 - depth * 0.65)
            xb = xa + 205 * (1 - depth * 0.65)
            ka, kb = 1 - depth * 0.65, 1 - (depth + 0.08) * 0.65
            quad = [(xa, y_near), (xb, y_near), (vx + (xb - vx) * kb / ka, y_top), (vx + (xa - vx) * kb / ka, y_top)]
            d.polygon(quad, fill=(28, 40, 62, 255), outline=(170, 175, 185, 255))
            for k in range(1, 4):  # cell grid
                f = k / 4
                d.line([(quad[0][0] + (quad[1][0] - quad[0][0]) * f, y_near),
                        (quad[3][0] + (quad[2][0] - quad[3][0]) * f, y_top)], fill=(70, 85, 110, 255), width=1)
            # sun glint on the glass
            d.polygon(quad, fill=(255, 210, 150, int(40 + 30 * (c % 3 == 0))))
    return img.filter(ImageFilter.GaussianBlur(1.6))  # shallow depth of field on the background


def plate_frame(base, t):
    ox = 80 + 22 * math.sin(t * 0.6) + 5 * math.sin(t * 2.1)  # handheld walk-and-talk drift
    oy = 50 + 10 * math.sin(t * 0.8 + 1) + 4 * math.sin(t * 2.7)
    frame = base.crop((int(ox), int(oy), int(ox) + W, int(oy) + H)).convert("RGBA")
    d = ImageDraw.Draw(frame)
    # where Jay stands: rule-of-thirds guide on the left third, eyeline on the top third
    gx, gy = 640, 360
    d.rectangle([gx - 230, gy - 200, gx + 230, H + 10], outline=(*PAPER, 200), width=3)
    d.line([(gx - 30, gy), (gx + 30, gy)], fill=(*PAPER, 200), width=3)
    d.line([(gx, gy - 30), (gx, gy + 30)], fill=(*PAPER, 200), width=3)
    f = ImageFont.truetype(FONT_BOLD, 30)
    d.text((gx - 210, gy - 186), "JAY: walk and talk, to camera", font=f, fill=(*PAPER, 230))
    s = ImageFont.truetype(FONT_BOOK, 24)
    d.text((40, 30), "PLACEHOLDER · replace with real footage", font=s, fill=(*PAPER, 200))
    return frame


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "overlay"
    base = rooftop_plate() if mode == "plate" else None
    for i in range(int(DUR * FPS)):
        t = i / FPS
        lt = lower_third(t)
        frame = Image.alpha_composite(plate_frame(base, t), lt) if base else lt
        sys.stdout.buffer.write(frame.tobytes())


if __name__ == "__main__":
    main()
