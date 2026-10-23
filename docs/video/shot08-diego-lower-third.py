"""QWATT week 1 video, shot 8 (0:40-0:44), vertical 1080x1920: cut to Diego at
the workbench, to camera, on "Here's the hidden problem. Every meter speaks its
own dialect." Lower third: Diego Ostertag · Co-founder, QWATT.

Diego's footage is real and has to be filmed; this renders the parts around it.
The founders shot vertically, so this is also where the lower third gets its
vertical layout. It keeps the approved look from shot 2 (terracotta bar that
grows from the middle, then name and role wiped in left to right over a soft
espresso panel) re-laid-out for a phone: left-aligned at x = 72, bottom edge at
y = 1470, clear of the platform/caption band (bottom 420 px), the right 140 px
and the top 120 px. Name 68 px bold, role 40 px. Modes:

  diego  (default) the lower third alone, with transparency, 4.0 s: bar grows
         0.3-0.7 s, text wipe 0.5-1.1 s, out 3.3-3.9 s, clear before Diego's
         close-ups start at 0:44
  jay    Jay Kim · Co-founder, QWATT in the same vertical layout, 5.0 s with
         shot 2's timing (in 0.3-1.1 s, out 4.2-4.8 s); replaces shot 2's
         horizontal overlay now that the footage is vertical
  plate  a stand-in bench for the rough cut until the real take exists: wall and
         desk in soft side light, the edge of an open laptop showing only
         abstract bars, a framing guide where Diego sits, plus his lower third.
         No person and no meters: the meters are not on the desk yet.

Colour is converted and tagged as BT.709 so editors read the terracotta right.
Writes raw RGBA frames to stdout. Needs numpy and Pillow. Render with:

    python3 docs/video/shot08-diego-lower-third.py diego | ffmpeg -y -f rawvideo -pix_fmt rgba \\
      -s 1080x1920 -r 30 -i - -vf scale=out_color_matrix=bt709 -c:v prores_ks -profile:v 4444 \\
      -pix_fmt yuva444p10le -color_primaries bt709 -color_trc bt709 -colorspace bt709 \\
      QWATT-week1-shot08-diego-lower-third.mov
    python3 docs/video/shot08-diego-lower-third.py jay | ffmpeg -y -f rawvideo -pix_fmt rgba \\
      -s 1080x1920 -r 30 -i - -vf scale=out_color_matrix=bt709 -c:v prores_ks -profile:v 4444 \\
      -pix_fmt yuva444p10le -color_primaries bt709 -color_trc bt709 -colorspace bt709 \\
      QWATT-week1-shot02-jay-lower-third-vertical.mov
    python3 docs/video/shot08-diego-lower-third.py plate | ffmpeg -y -f rawvideo -pix_fmt rgba \\
      -s 1080x1920 -r 30 -i - -vf scale=out_color_matrix=bt709 -c:v libx264 -preset slow \\
      -crf 18 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 \\
      -movflags +faststart QWATT-week1-shot08-placeholder.mp4
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FPS = 30
W, H = 1080, 1920

TERRACOTTA = (176, 88, 47)
PAPER = (250, 248, 242)
ESPRESSO = (22, 16, 10)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_BOOK = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
F_NAME = ImageFont.truetype(FONT_BOLD, 68)
F_ROLE = ImageFont.truetype(FONT_BOOK, 40)
ROLE = "Co-founder, QWATT"  # both founders; never CEO

# Vertical safe zones: the platform UI and our burned-in captions own these bands
SAFE_TOP, SAFE_RIGHT, SAFE_BOTTOM = 120, 140, 420

# Lower-third geometry (shot 2's layout scaled ~1.17x for a phone screen)
LT_X = 72  # left edge of the terracotta bar
LT_Y = 1312  # top of the text block; panel spans LT_Y-8 .. LT_Y+158 = 1470
BAR_W, BAR_H = 12, 150
PANEL_PAD = 82  # panel width beyond the longer line

# mode: (name, duration in s, start of the out move in s, stand-in plate under it?)
MODES = {
    "diego": ("Diego Ostertag", 4.0, 3.3, False),
    "jay": ("Jay Kim", 5.0, 4.2, False),
    "plate": ("Diego Ostertag", 4.0, 3.3, True),
}

M = 60  # plate margin around the frame so the camera can drift
DESK_FAR, DESK_NEAR = 1250, 1700  # desk top, in frame coordinates


def ease(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return 1 - (1 - x) ** 3  # ease-out cubic


def lower_third(t, name, role, out_start):
    """RGBA lower third: bar grows 0.3-0.7 s, text wipes in 0.5-1.1 s, hold, then
    both retract over out_start .. out_start + 0.6 s."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x0, y0 = LT_X, LT_Y
    out = ease(out_start, out_start + 0.6, t)
    grow = ease(0.3, 0.7, t) * (1 - out)
    wipe = ease(0.5, 1.1, t) * (1 - out)
    if grow <= 0:
        return img

    bar_h = BAR_H * grow
    panel_w = max(d.textlength(name, font=F_NAME), d.textlength(role, font=F_ROLE)) + PANEL_PAD

    # soft dark panel behind the text so it reads on a bright wall or window
    pw = int(panel_w * wipe)
    if pw > 0:
        shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(shade).rectangle([x0 + BAR_W, y0 - 8, x0 + BAR_W + pw, y0 + 158],
                                        fill=(*ESPRESSO, int(150 * wipe)))
        img = Image.alpha_composite(img, shade.filter(ImageFilter.GaussianBlur(2)))
        d = ImageDraw.Draw(img)

    # terracotta bar grows from the middle
    mid = y0 + BAR_H / 2
    d.rectangle([x0, mid - bar_h / 2, x0 + BAR_W, mid + bar_h / 2], fill=(*TERRACOTTA, 255))

    # text revealed left to right
    txt = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    td = ImageDraw.Draw(txt)
    td.text((x0 + 46, y0 + 8), name, font=F_NAME, fill=(*PAPER, 255))
    td.text((x0 + 48, y0 + 94), role, font=F_ROLE, fill=(*PAPER, 215))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rectangle([0, 0, x0 + BAR_W + pw, H], fill=255)
    txt.putalpha(Image.fromarray(np.minimum(np.asarray(txt.getchannel("A")),
                                            np.asarray(mask))))
    return Image.alpha_composite(img, txt)


def S(*pts):
    """Frame coordinates to plate coordinates."""
    return [(x + M, y + M) for x, y in pts]


def side_light(xf):
    """Soft window light from frame left, falling off to the right."""
    u = np.clip((np.asarray(xf, float) + M) / (W + 2 * M), 0, 1)
    return 0.62 + 0.55 * (1 - u) ** 1.3


def lit(rgb, xf, k=1.0):
    return tuple(int(min(255, c * side_light(xf) * k)) for c in rgb)


def persp_coeffs(dst, src):
    """Image.transform(PERSPECTIVE) coefficients taking output points dst to input points src."""
    a, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b += [u, v]
    return np.linalg.solve(np.array(a, float), np.array(b, float))


def screen_texture(rng):
    """What the laptop shows: pale abstract bars only, no text and no digits."""
    tw, th = 800, 500
    img = Image.new("RGB", (tw, th), (220, 229, 236))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, tw, 34], fill=(198, 210, 222))  # title strip
    d.rectangle([0, 34, 150, th], fill=(204, 215, 226))  # sidebar
    for y in range(64, th - 30, 40):
        d.rounded_rectangle([24, y, 24 + rng.integers(50, 100), y + 12], 6, fill=(180, 194, 210))
    y = 64
    while y < th - 30:
        x = 190 + 40 * rng.integers(0, 3)
        d.rounded_rectangle([x, y, x + rng.integers(120, 480), y + 14], 7,
                            fill=(176, 192, 210) if rng.random() < 0.7 else (192, 204, 218))
        y += 30 + 16 * (rng.random() < 0.25)  # the odd paragraph gap
    return img.filter(ImageFilter.GaussianBlur(1.5))


def bench_plate():
    """Wide stand-in plate in plate coordinates (frame + M), larger than the frame."""
    pw, ph = W + 2 * M, H + 2 * M
    rng = np.random.default_rng(8)
    yy, xx = np.mgrid[0:ph, 0:pw].astype(float)
    xf, yf = xx - M, yy - M
    light = side_light(xf)

    # wall: warm plaster, with the window's light falling across the left of it
    wall = Image.new("RGB", (pw, ph), (150, 140, 126))
    d = ImageDraw.Draw(wall)
    # a floating shelf on the right with a few books and a plant, nothing with a screen
    d.rectangle(S((840, 760), (1150, 780)), fill=(128, 98, 70))
    x = 880
    for bw, bh, col in ((34, 150, (96, 72, 60)), (28, 128, (66, 88, 80)),
                        (40, 168, (150, 82, 52)), (30, 140, (196, 186, 166))):
        d.rectangle(S((x, 760 - bh), (x + bw, 760)), fill=col)
        x += bw + 3
    d.polygon(S((1040, 700), (1100, 700), (1092, 760), (1048, 760)), fill=(160, 84, 52))
    for lx, ly, rx, ry in ((1070, 650, 30, 54), (1040, 670, 34, 24), (1102, 668, 32, 22), (1066, 618, 14, 34)):
        d.ellipse(S((lx - rx, ly - ry), (lx + rx, ly + ry)), fill=(74, 104, 72))
    wall_a = np.asarray(wall, float)
    shade = Image.new("L", (pw, ph), 0)
    ImageDraw.Draw(shade).rectangle(S((850, 780), (1150, 812)), fill=110)  # under the shelf
    shade = np.asarray(shade.filter(ImageFilter.GaussianBlur(14)), float) / 255
    window = Image.new("L", (pw, ph), 0)
    wd = ImageDraw.Draw(window)
    wd.polygon(S((-60, 250), (300, 330), (300, 1060), (-60, 1190)), fill=255)
    wd.line(S((120, 280), (120, 1120)), fill=0, width=22)  # mullions
    wd.line(S((-60, 715), (300, 700)), fill=0, width=22)
    window = np.asarray(window.filter(ImageFilter.GaussianBlur(45)), float) / 255
    wall_a = wall_a * (light * (1 - 0.6 * shade))[..., None] + window[..., None] * (58, 48, 30)
    wall_a *= (0.9 + 0.1 * np.clip(yf / DESK_FAR, 0, 1))[..., None]  # a touch darker up high
    img = Image.fromarray(np.clip(wall_a, 0, 255).astype(np.uint8), "RGB")
    img = img.filter(ImageFilter.GaussianBlur(5))  # the wall sits well behind Diego

    # desk: light oak, grain running across, compressed toward the far edge
    s = np.clip((yf - DESK_FAR) / (DESK_NEAR - DESK_FAR), 0, 1)
    z = s ** 1.6 * 700 + (0.3 + s) * (6 * np.sin(xf / 170 + 1.3) + 3 * np.sin(xf / 61))
    streaks = np.convolve(rng.normal(0, 1, 760), np.ones(3) / 3, "same")
    grain = np.interp(z, np.arange(760), streaks) * 9 + rng.normal(0, 1.5, (ph, pw))
    oak = np.array((176, 134, 92), float) + grain[..., None] * (1, 0.8, 0.6)
    desk = oak * (light * (0.92 + 0.12 * s))[..., None]
    apron = np.array((112, 80, 54), float) * light[..., None]
    under = np.array((32, 27, 23), float) * (0.7 + 0.3 * light)[..., None]
    rows = np.where(yf < DESK_FAR, 0, np.where(yf < DESK_NEAR, 1, np.where(yf < DESK_NEAR + 70, 2, 3)))
    out = np.asarray(img, float).copy()
    out = np.where((rows == 1)[..., None], desk, out)
    out = np.where((rows == 2)[..., None], apron, out)
    out = np.where((rows == 3)[..., None], under, out)
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img, "RGBA")
    d.line(S((-60, DESK_FAR), (1140, DESK_FAR)), fill=(40, 30, 22, 120), width=2)  # far edge
    d.line(S((-60, DESK_NEAR), (1140, DESK_NEAR)), fill=(236, 206, 166, 150), width=3)  # edge catches light

    # contact shadows, thrown to the right because the light comes from the left
    sh = Image.new("L", (pw, ph), 0)
    sd = ImageDraw.Draw(sh)
    sd.polygon(S((820, 1400), (1160, 1445), (1160, 1570), (810, 1505)), fill=150)
    sd.polygon(S((120, 1548), (440, 1528), (462, 1652), (112, 1676)), fill=120)
    sh = np.asarray(sh.filter(ImageFilter.GaussianBlur(18)), float) / 255
    a = np.asarray(img, float) * (1 - 0.55 * sh)[..., None]
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img, "RGBA")

    # a closed notebook and a pen at the front left of the desk
    d.polygon(S((110, 1540), (420, 1520), (440, 1640), (96, 1664)), fill=lit((58, 70, 78), 260))
    d.line(S((380, 1523), (396, 1645)), fill=lit(TERRACOTTA, 380, 0.9), width=8)  # elastic band
    d.line(S((470, 1560), (640, 1610)), fill=lit((30, 30, 34), 560), width=7)

    # laptop at the right edge: keyboard deck, then the open lid seen at an angle
    deck = S((860, 1392), (1160, 1430), (1150, 1548), (805, 1488))
    d.polygon(deck, fill=lit((172, 174, 178), 950, 1.05))
    d.polygon(S((882, 1410), (1160, 1446), (1155, 1500), (856, 1452)), fill=lit((58, 60, 64), 980))
    d.line([deck[2], deck[3]], fill=lit((214, 216, 220), 950), width=3)
    lid = S((882, 1102), (1170, 1048), (1160, 1430), (860, 1392))
    d.polygon(lid, fill=(26, 28, 32))
    # display, inset in the bezel
    p = np.array(lid, float)
    c = p.mean(axis=0)
    disp = [tuple(c + (q - c) * 0.9) for q in p]
    tex = screen_texture(rng)
    coeffs = persp_coeffs(disp, [(0, 0), (tex.width, 0), (tex.width, tex.height), (0, tex.height)])
    warped = tex.transform((pw, ph), Image.Transform.PERSPECTIVE, tuple(coeffs), Image.Resampling.BICUBIC)
    dm = Image.new("L", (pw, ph), 0)
    ImageDraw.Draw(dm).polygon(disp, fill=255)
    img.paste(warped, (0, 0), dm)
    # the screen spills a little cool light onto the desk and the wall
    glow = np.asarray(dm.filter(ImageFilter.GaussianBlur(70)), float) / 255
    a = np.asarray(img, float) + glow[..., None] * (52, 64, 78)

    # soft focus, vignette and grain, like a real lens and sensor
    r2 = ((xx - pw / 2) / (pw / 2)) ** 2 + ((yy - ph * 0.45) / (ph / 2)) ** 2
    a *= (1 - 0.22 * np.clip(r2, 0, 1.6))[..., None]
    a += rng.normal(0, 2.4, (ph, pw, 1))
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")
    return img.filter(ImageFilter.GaussianBlur(0.8))


def plate_frame(base, t):
    ox = M + 14 * math.sin(t * 0.55) + 4 * math.sin(t * 1.9 + 0.7)  # gentle handheld drift
    oy = M + 10 * math.sin(t * 0.7 + 1) + 3 * math.sin(t * 2.3)
    frame = base.transform((W, H), Image.Transform.AFFINE, (1, 0, ox, 0, 1, oy),
                           Image.Resampling.BILINEAR).convert("RGBA")
    d = ImageDraw.Draw(frame)
    # where Diego sits: centred, eyes on the upper-third line, face well above the lower third
    gx, gy = W // 2, H // 3
    f = ImageFont.truetype(FONT_BOLD, 30)
    s = ImageFont.truetype(FONT_BOOK, 28)
    for dx, col in ((2, (*ESPRESSO, 120)), (0, (*PAPER, 210))):  # soft drop shadow, then the line
        d.rectangle([gx - 320 + dx, gy - 280 + dx, gx + 320 + dx, DESK_FAR + dx], outline=col, width=3)
        d.line([(gx - 30 + dx, gy + dx), (gx + 30 + dx, gy + dx)], fill=col, width=3)
        d.line([(gx + dx, gy - 30 + dx), (gx + dx, gy + 30 + dx)], fill=col, width=3)
        d.text((gx - 300 + dx, gy - 264 + dx), "DIEGO: at the bench, to camera", font=f, fill=col)
        d.text((LT_X + dx, SAFE_TOP + 30 + dx), "PLACEHOLDER · replace with real footage", font=s, fill=col)
    return frame


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "diego"
    name, dur, out_start, with_plate = MODES[mode]
    base = bench_plate() if with_plate else None
    for i in range(round(dur * FPS)):
        t = i / FPS
        lt = lower_third(t, name, ROLE, out_start)
        frame = Image.alpha_composite(plate_frame(base, t), lt) if base else lt
        sys.stdout.buffer.write(frame.tobytes())


if __name__ == "__main__":
    main()
