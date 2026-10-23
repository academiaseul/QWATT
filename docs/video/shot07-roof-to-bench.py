"""QWATT week 1 video, shot 7 (0:37-0:40), vertical 1080x1920: the wordless
"roof to bench" transition between Jay on the rooftop and Diego at the workbench.

Open on a warm close-up of solar cells, a sun glint drifting across them. A cable
leaves the panel's junction box and the camera tilts down after it, over the
parapet and down through the building, while a terracotta pulse runs along the
cable just ahead of the camera. The light cools from late-afternoon sun to the
neutral side light of the bench. The move settles on a desk and the edge of a
laptop: the cable runs into it, the pulse arrives, and the screen glows with a
few abstract terminal lines. The last 0.3 s hold still for the cut to Diego.

Honesty: the bench holds only the laptop and the cable (the meters are not on the
desk yet). No people, no text, no numbers, no logos.

Writes raw RGB frames to stdout. Needs numpy and Pillow. Render with:

    G="exp(-pow(log(max(b,1)*sr/(2*nb)/(260+2300*exp(-pow((pts/sr-1.35)/0.5,2))))/0.42,2))"
    python3 docs/video/shot07-roof-to-bench.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1080x1920 -r 30 -i - -f lavfi -i "anoisesrc=d=3:c=pink:r=48000:a=0.5:s=7" \\
      -filter_complex "[1]afftfilt=real='re*$G':imag='im*$G',highpass=f=120,\\
    volume='0.1+0.9*exp(-pow((t-1.35)/0.55,2))':eval=frame,afade=t=in:st=0:d=0.4,\\
    afade=t=out:st=2.45:d=0.55,volume=0.55[a]" -map 0:v -map "[a]" -c:v libx264 \\
      -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k \\
      -shortest QWATT-week1-shot07-roof-to-bench.mp4

The whoosh is pink noise through a band-pass whose centre sweeps from ~260 Hz up
to ~2.5 kHz and back (afftfilt; pts/sr is time in seconds), peaking with the
pulse's fastest stretch at 1.35 s. The music swell is added in the edit.
`python3 docs/video/shot07-roof-to-bench.py still 1.5 out.png` writes one frame.
"""
import math
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

FPS = 30
DUR = 3.0
W, H = 1080, 1920
SS = 2                      # the world is drawn at 2x and filtered down each frame
MX = 60                     # spare world either side for the handheld drift
WW, WH = W + 2 * MX, 5200   # world size in output pixels; world x runs -MX .. W + MX

TERRACOTTA = np.array([176, 88, 47], np.float32)  # #b0582f
CORE = np.array([224, 138, 90], np.float32)       # #e08a5a
HOT = np.array([255, 230, 208], np.float32)       # white-hot centre of the pulse

# World layout, top to bottom (output-pixel units, y grows downward)
FRAME_Y = 1180              # cells end, aluminium frame begins
PARAPET_Y = 1860            # roof edge
SLAB_Y = 2620               # dark band where the move passes indoors
DESK_Y = 4040               # bench wall meets the desk
CELL, PITCH = 300, 312      # mono cells and their spacing

# Camera: tilt down, gentle start, long ease-out, settled by 2.7 s, then hold
T_MOVE0, T_MOVE1 = 0.15, 2.70
CAM_Y0, CAM_Y1 = 1110, 4180
ZOOM0, ZOOM1 = 1.05, 1.0
SHUTTER = 0.5               # 180-degree shutter for the motion blur

# Pulse: forms at the junction box, leaves at 0.15 s, reaches the laptop at 2.3 s
T_PULSE0, T_ARRIVE = 0.15, 2.30
TRAIL = 170                 # e-folding length of the fading trail, along the cable

# Cable route through the world: junction box gland -> wall clips -> desk -> laptop port
CABLE = [(762, 1336), (764, 1420), (772, 1540), (784, 1680), (792, 1800), (796, 1866),
         (793, 1960), (790, 2250), (792, 2550), (796, 2850), (799, 3200), (800, 3550),
         (800, 3850), (800, 4040), (800, 4110), (786, 4180), (740, 4222), (690, 4234),
         (668, 4234), (630, 4232)]
CLIPS = [2060, 2400, 2930, 3250, 3570, 3890]

# Laptop, seen from the front, cropped by the left edge of the final frame
LID = [(-24, 3740), (616, 3740), (622, 4196), (-30, 4196)]
SCREEN = [(-6, 3758), (598, 3758), (603, 4160), (-11, 4160)]
DECK = [(-30, 4200), (622, 4200), (690, 4500), (-84, 4500)]
PORT = (630, 4232)
TERM_X, TERM_Y, TERM_PITCH = 26, 3792, 26
NEW_LINE = (11, 290)        # row and length of the line that appears when the pulse lands

# Base colour down the world (y, rgb); pairs one pixel apart make hard edges
ROWS = [
    (0, (206, 196, 180)), (FRAME_Y, (206, 196, 180)),           # backsheet between cells
    (FRAME_Y + 1, (40, 34, 31)), (1500, (50, 43, 39)),           # shade under the panel
    (1740, (70, 60, 52)), (1770, (138, 114, 92)),                # low sun on the gravel
    (PARAPET_Y, (156, 128, 102)),
    (PARAPET_Y + 1, (224, 200, 168)), (PARAPET_Y + 60, (204, 180, 150)),  # parapet cap
    (PARAPET_Y + 61, (86, 68, 56)), (PARAPET_Y + 84, (170, 140, 112)),    # drip shadow
    (1990, (188, 154, 122)), (2380, (150, 124, 104)),            # outside wall, warm plaster
    (2520, (92, 80, 74)), (SLAB_Y - 30, (30, 28, 28)),           # through the slab
    (SLAB_Y + 40, (30, 29, 30)), (2730, (116, 120, 124)),
    (2731, (196, 198, 198)), (2736, (132, 136, 140)),            # cornice catching room light
    (2900, (150, 154, 158)), (DESK_Y, (162, 165, 168)),          # bench wall, cool neutral
    (DESK_Y + 1, (92, 88, 84)), (DESK_Y + 14, (156, 149, 139)),  # contact shadow, desk top
    (WH, (138, 132, 124)),
]


def smooth(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return x * x * (3 - 2 * x)


def P(x, y):
    """World coordinates (output pixels) to 2x canvas pixels."""
    return ((x + MX) * SS, y * SS)


def box(x0, y0, x1, y1):
    return [*P(x0, y0), *P(x1, y1)]


def catmull(pts, n=40):
    p = np.array(pts, float)
    p = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for s in np.linspace(0, 1, n, endpoint=False):
            out.append(0.5 * (2 * p1 + (p2 - p0) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s
                              + (3 * p1 - p0 - 3 * p2 + p3) * s ** 3))
    out.append(p[-2])
    return np.array(out)


# The cable as an arc-length table, shared by the drawing and the pulse
_c = catmull(CABLE)
CABLE_S = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(_c, axis=0).T))])
CABLE_LEN = CABLE_S[-1]
_grid = np.arange(0, CABLE_LEN, 2.0)
CABLE_XY = np.stack([np.interp(_grid, CABLE_S, _c[:, 0]), np.interp(_grid, CABLE_S, _c[:, 1])], -1)
CABLE_S = _grid


def cable_at(s):
    s = np.clip(s, 0, CABLE_S[-1])
    return np.interp(s, CABLE_S, CABLE_XY[:, 0]), np.interp(s, CABLE_S, CABLE_XY[:, 1])


def camera(t, shake=True):
    u = min(max((t - T_MOVE0) / (T_MOVE1 - T_MOVE0), 0.0), 1.0)
    p = 1 - (1 - u * u) ** 3          # peak speed at ~1.3 s, soft landing
    cx, cy = W / 2, CAM_Y0 + (CAM_Y1 - CAM_Y0) * p
    if shake:                          # a few pixels of handheld life
        cx += 3.0 * math.sin(1.9 * t + 0.4) + 1.3 * math.sin(4.7 * t + 2.1)
        cy += 2.4 * math.sin(1.4 * t + 1.2) + 1.1 * math.sin(5.3 * t)
    return cx, cy, ZOOM0 + (ZOOM1 - ZOOM0) * p, p


def pulse_s(t):
    """Arc length of the pulse: a touch ahead of the camera, easing into the port."""
    v = min(max((t - T_PULSE0) / (T_ARRIVE - T_PULSE0), 0.0), 1.0)
    return CABLE_LEN * (1 - (1 - v ** 1.8) ** 2)


def pulse_level(t):
    return smooth(0.0, 0.22, t) * (1 - smooth(T_ARRIVE + 0.02, T_ARRIVE + 0.38, t))


def to_screen(x, y, cam):
    cx, cy, z, _ = cam
    return (np.asarray(x) - cx) * z + W / 2, (np.asarray(y) - cy) * z + H / 2


# ---------------------------------------------------------------- the world

def noise_field(rng, h, w, cell):
    n = rng.normal(0, 1, (h // cell + 3, w // cell + 3)).astype(np.float32)
    return np.asarray(Image.fromarray(n, "F").resize((w, h), Image.BICUBIC, box=(0, 0, w / cell, h / cell)))


def base_tones():
    """Colour, light and texture of every surface, at 1x."""
    rng = np.random.default_rng(71)
    ys = np.arange(WH, dtype=np.float32)
    keys = np.array([k for k, _ in ROWS], np.float32)
    cols = np.array([c for _, c in ROWS], np.float32)
    rows = np.stack([np.interp(ys, keys, cols[:, i]) for i in range(3)], -1)
    xs = (np.arange(WW, dtype=np.float32) - MX) / W
    outside = 1 - np.clip((ys - (SLAB_Y - 120)) / 240, 0, 1)[:, None]
    light = outside * (0.90 + 0.16 * xs) + (1 - outside) * (1.10 - 0.22 * xs)  # sun right, window left
    img = rows[:, None, :] * light[..., None]

    yy = ys[:, None]
    xx = np.arange(WW, dtype=np.float32)[None] - MX
    walls = (yy > PARAPET_Y + 84) & (yy < DESK_Y)
    plaster = noise_field(rng, WH, WW, 26) * 4.0 + noise_field(rng, WH, WW, 5) * 2.0
    gravel = (yy > FRAME_Y + 52) & (yy < PARAPET_Y)
    grit = rng.normal(0, 1, (WH, WW)).astype(np.float32)
    lum = np.where(walls, plaster, 0) + np.where(gravel, grit * (4 + 10 * (yy > 1760)), 0)

    # pale wood: grain streaks along x, bunching up toward the back edge (perspective)
    depth = np.sqrt(np.clip((ys - DESK_Y) / (WH - DESK_Y), 0, 1)) * 380
    streak = noise_field(rng, 400, WW, 1)
    streak = np.asarray(Image.fromarray(rng.normal(0, 1, (400, WW // 70 + 3)).astype(np.float32), "F")
                        .resize((WW, 400), Image.BICUBIC, box=(0, 0, WW / 70, 400))) + 0.3 * streak
    r0 = np.minimum(depth.astype(int), 398)
    f = (depth - r0)[:, None]
    grain = streak[r0] * (1 - f) + streak[r0 + 1] * f
    lum += np.where(yy > DESK_Y + 14, grain * 6.0, 0)

    # soft window light falling across the bench wall
    patch = np.exp(-(((xx + 0.45 * (yy - 3300)) - 140) / 300) ** 4 - ((yy - 3420) / 440) ** 4)
    lum += np.where((yy > SLAB_Y + 110) & (yy < DESK_Y), patch * 14, 0)

    img += lum[..., None] + rng.normal(0, 1.2, (WH, WW, 1)).astype(np.float32)
    return np.clip(img, 0, 255).astype(np.uint8)


def draw_panel(img):
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(5)
    ch = 34  # chamfered corners of pseudo-square mono cells
    for row in range(5):
        y1 = FRAME_Y - 14 - row * PITCH
        y0 = y1 - CELL
        for col in range(4):
            x0 = -40 + col * PITCH
            x1 = x0 + CELL
            v = rng.normal(0, 3)
            d.polygon([P(x0 + ch, y0), P(x1 - ch, y0), P(x1, y0 + ch), P(x1, y1 - ch), P(x1 - ch, y1),
                       P(x0 + ch, y1), P(x0, y1 - ch), P(x0, y0 + ch)],
                      fill=(int(22 + v), int(36 + v), int(68 + 1.4 * v)))
            for fy in np.arange(y0 + 6, y1 - 3, 9):  # fine grid fingers
                inset = max(0, ch - min(fy - y0, y1 - fy)) + 2
                d.line([P(x0 + inset, fy), P(x1 - inset, fy)], fill=(44, 60, 94), width=1)
            for bx in np.linspace(x0 + 34, x1 - 34, 5):  # busbars, ribbons bridging the gaps
                d.line([P(bx, y0 - 7), P(bx, y1 + 7)], fill=(198, 192, 182), width=5)

    # aluminium frame along the panel's lower edge, sunlit lip on top
    d.rectangle(box(-MX, FRAME_Y, W + MX, FRAME_Y + 52), fill=(146, 140, 132))
    d.rectangle(box(-MX, FRAME_Y, W + MX, FRAME_Y + 7), fill=(246, 224, 188))
    d.rectangle(box(-MX, FRAME_Y + 7, W + MX, FRAME_Y + 10), fill=(96, 88, 80))
    d.rectangle(box(-MX, FRAME_Y + 34, W + MX, FRAME_Y + 52), fill=(104, 96, 88))
    d.rectangle(box(-MX, FRAME_Y + 50, W + MX, FRAME_Y + 53), fill=(36, 32, 30))

    # junction box under the frame, plain moulded plastic, cable gland at the bottom
    d.rounded_rectangle(box(690, 1210, 834, 1322), radius=14 * SS, fill=(44, 45, 49))
    d.rounded_rectangle(box(690, 1210, 834, 1216), radius=3 * SS, fill=(92, 88, 84))
    for rx in (716, 762, 808):
        d.line([P(rx, 1232), P(rx, 1304)], fill=(54, 55, 59), width=3 * SS)
    d.rounded_rectangle(box(747, 1320, 777, 1344), radius=5 * SS, fill=(34, 35, 38))
    d.line([P(749, 1330), P(775, 1330)], fill=(64, 64, 66), width=SS)

    # sheen on the glass: brighter toward the low sun, a warm sky reflection near the top
    top = (FRAME_Y + 53) * SS
    a = np.asarray(img.crop((0, 0, WW * SS, top)), np.float32)
    yy, xx = np.mgrid[0:top, 0:WW * SS].astype(np.float32) / SS
    xx -= MX
    m = 0.88 + 0.28 * np.exp(-((xx - 980) / 700) ** 2 - ((yy - 200) / 900) ** 2)
    a = a * m[..., None] + (16 * np.clip(1 - yy / FRAME_Y, 0, 1))[..., None] * np.array([1.0, 0.85, 0.6])
    img.paste(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), (0, 0))


def cable_normals():
    tx, ty = np.gradient(CABLE_XY[:, 0]), np.gradient(CABLE_XY[:, 1])
    n = np.hypot(tx, ty) + 1e-6
    return np.stack([-ty / n, tx / n], -1)


def light_dir(y):
    """Unit vector toward the light: low sun upper right outside, window on the left inside."""
    k = np.clip((np.asarray(y) - (SLAB_Y - 60)) / 120, 0, 1)[..., None]
    v = (1 - k) * np.array([0.75, -0.66]) + k * np.array([-0.95, -0.3])
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def clip_x(y):
    k = np.searchsorted(CABLE_XY[:, 1], DESK_Y)
    return float(np.interp(y, CABLE_XY[:k, 1], CABLE_XY[:k, 0]))


def draw_shadows(img):
    """Cable, clips and laptop shadows, multiplied into the world."""
    sz = (WW * SS, WH * SS)
    thin = Image.new("L", sz, 0)
    d = ImageDraw.Draw(thin)
    ys = CABLE_XY[:, 1]
    off = -light_dir(ys) * np.where(ys > DESK_Y, 4, 11)[:, None]  # shadow falls away from the light
    sel = CABLE_S < CABLE_LEN - 40
    pts = [P(x, y) for (x, y) in (CABLE_XY + off)[sel][::3]]
    d.line(pts, fill=150, width=13 * SS, joint="curve")
    for y in CLIPS:
        ox, oy = -light_dir(y) * 11
        d.rounded_rectangle(box(clip_x(y) - 17 + ox, y - 8 + oy, clip_x(y) + 17 + ox, y + 8 + oy),
                            radius=5 * SS, fill=150)
    thin = thin.filter(ImageFilter.GaussianBlur(6 * SS))

    wide = Image.new("L", sz, 0)
    d = ImageDraw.Draw(wide)
    d.polygon([P(x + 46, y + 18) for x, y in DECK], fill=170)                     # under the base
    d.polygon([P(-30, 4196), P(622, 4196), P(735, 4110), P(90, 4100)], fill=110)  # lid, to the right
    d.rounded_rectangle(box(690 - 10, 1210 + 16, 834 - 10, 1322 + 14), radius=14 * SS, fill=120)
    wide = wide.filter(ImageFilter.GaussianBlur(26 * SS))

    mask = ImageChops.lighter(thin, wide)
    shade = mask.point(lambda v: 255 - int(v * 0.62))
    return ImageChops.multiply(img, Image.merge("RGB", [shade] * 3))


def deck_point(u, v):
    """Point on the laptop deck: u across (0 left .. 1 right), v back (0) to front (1)."""
    (ax, ay), (bx, by), (cx, cy), (dx, dy) = DECK
    lx, ly = ax + (dx - ax) * v, ay + (dy - ay) * v
    rx, ry = bx + (cx - bx) * v, by + (cy - by) * v
    return lx + (rx - lx) * u, ly + (ry - ly) * u


def draw_laptop(img):
    d = ImageDraw.Draw(img)
    # base: deck, front face, keyboard well with plain keys, trackpad
    d.polygon([P(*q) for q in DECK], fill=(98, 100, 105))
    (ax, ay), (bx, by), (cx, cy), (dx, dy) = DECK
    d.polygon([P(dx, dy), P(cx, cy), P(cx - 2, cy + 22), P(dx + 2, dy + 22)], fill=(52, 54, 58))
    d.line([P(dx, dy), P(cx, cy)], fill=(150, 152, 156), width=2 * SS)
    for r in range(6):
        v0, v1 = 0.06 + r * 0.075, 0.06 + r * 0.075 + 0.058
        n = 13 if r else 15
        for k in range(n):
            u0 = 0.06 + k * (0.88 / n)
            u1 = u0 + 0.88 / n - 0.012
            if r == 5 and 4 <= k <= 8:  # space bar
                if k > 4:
                    continue
                u1 = 0.06 + 9 * (0.88 / n) - 0.012
            d.polygon([P(*deck_point(u0, v0)), P(*deck_point(u1, v0)), P(*deck_point(u1, v1)),
                       P(*deck_point(u0, v1))], fill=(36, 37, 40))
    d.polygon([P(*deck_point(0.34, 0.56)), P(*deck_point(0.66, 0.56)), P(*deck_point(0.66, 0.93)),
               P(*deck_point(0.34, 0.93))], fill=(108, 110, 115), outline=(86, 88, 92))
    # lid and hinge
    d.rectangle(box(-30, 4190, 622, 4204), fill=(28, 28, 30))
    d.polygon([P(*q) for q in LID], fill=(28, 29, 32))
    d.line([P(-24, 3741), P(616, 3741)], fill=(140, 142, 148), width=2 * SS)
    d.polygon([P(*q) for q in SCREEN], fill=(14, 18, 24))
    # plug at the side port, the cable's strain relief
    px, py = PORT
    d.rounded_rectangle(box(px - 2, py - 9, px + 30, py + 9), radius=4 * SS, fill=(38, 38, 41))
    d.rounded_rectangle(box(px + 28, py - 7, px + 42, py + 7), radius=3 * SS, fill=(30, 30, 32))
    d.line([P(px + 2, py - 7), P(px + 28, py - 7)], fill=(96, 96, 100), width=SS)


def draw_cable(img):
    d = ImageDraw.Draw(img)
    sel = CABLE_S <= CABLE_LEN - 36  # the plug covers the last stretch
    xy = CABLE_XY[sel]
    d.line([P(x, y) for x, y in xy[::2]], fill=(24, 24, 26), width=13 * SS, joint="curve")
    nrm = cable_normals()[sel]
    side = np.sign(np.sum(nrm * light_dir(xy[:, 1]), -1))[:, None]
    hl = xy + nrm * side * 3.6
    k = np.searchsorted(xy[:, 1], SLAB_Y)
    d.line([P(x, y) for x, y in hl[:k:2]], fill=(176, 140, 104), width=7, joint="curve")
    d.line([P(x, y) for x, y in hl[k::2]], fill=(128, 132, 138), width=7, joint="curve")
    for y in CLIPS:
        x = clip_x(y)
        col = (210, 188, 158) if y < SLAB_Y else (212, 212, 208)
        d.rounded_rectangle(box(x - 17, y - 8, x + 17, y + 8), radius=5 * SS, fill=col)
        d.ellipse(box(x - 3, y - 3, x + 3, y + 3), fill=(140, 136, 130))


def draw_screen(img):
    """Soft glow of the laptop screen and a few abstract terminal lines (bars, not text)."""
    x0, y0, x1, y1 = -MX, 3700, 780, 4560
    a = np.asarray(img.crop(box(x0, y0, x1, y1)), np.float32)
    yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]].astype(np.float32) / SS
    xx += x0
    yy += y0
    inside = Image.new("L", (a.shape[1], a.shape[0]), 0)
    ImageDraw.Draw(inside).polygon([((x - x0) * SS, (y - y0) * SS) for x, y in SCREEN], fill=255)
    inside = np.asarray(inside, np.float32)[..., None] / 255
    centre = np.exp(-((xx - 300) / 420) ** 2 - ((yy - 3950) / 300) ** 2)[..., None]
    spill = np.exp(-((xx - 300) / 420) ** 2 - ((yy - 4240) / 150) ** 2)[..., None] * (yy > 4200)[..., None]
    a += inside * centre * np.array([8, 12, 16]) + spill * np.array([10, 13, 16])
    img.paste(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), (int((x0 + MX) * SS), int(y0 * SS)))

    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(17)
    for i in range(NEW_LINE[0]):
        if i in (3, 7):
            continue  # blank lines between groups of output
        y = TERM_Y + i * TERM_PITCH
        x = TERM_X + (26 if i in (1, 2, 5, 6, 9, 10) else 0)
        for k in range(int(rng.integers(1, 4))):
            n = int(rng.integers(34, 150))
            if i in (0, 4, 8) and k == 0:
                col, n = (172, 128, 104), 18          # prompt marker, warm and dim
            else:
                col = (150, 164, 172) if rng.random() < 0.7 else (96, 108, 118)
            d.rounded_rectangle(box(x, y, x + n, y + 7), radius=3 * SS, fill=col)
            x += n + 12
            if x > 520:
                break


def world():
    img = Image.fromarray(base_tones(), "RGB").resize((WW * SS, WH * SS), Image.BICUBIC)
    draw_panel(img)
    img = draw_shadows(img)
    draw_laptop(img)
    draw_cable(img)
    draw_screen(img)
    return img


# ---------------------------------------------------------------- per frame

def vblur(a, n):
    """Box blur along y: the camera's motion blur for a vertical tilt."""
    n = int(round(n))
    if n < 2:
        return a
    h = n // 2
    p = np.pad(a, ((h, n - 1 - h), (0, 0), (0, 0)), mode="edge")
    c = np.concatenate([np.zeros((1,) + a.shape[1:], np.float32), np.cumsum(p, axis=0, dtype=np.float32)])
    return (c[n:n + a.shape[0]] - c[:a.shape[0]]) / n


_PEAK = {}


def peak(shape, size, radius):
    """Peak of a blurred dot or line, so glow gains read as 'intensity at rest'."""
    key = (shape, size, radius)
    if key not in _PEAK:
        m = Image.new("L", (800, 800), 0)
        d = ImageDraw.Draw(m)
        if shape == "dot":
            d.ellipse([400 - size, 400 - size, 400 + size, 400 + size], fill=255)
        else:
            d.line([(400, 0), (400, 800)], fill=255, width=size)
        _PEAK[key] = max(np.asarray(m.filter(ImageFilter.GaussianBlur(radius))).max() / 255, 1e-3)
    return _PEAK[key]


def add_glow(img, draw, bbox, layers, shape=None, size=0):
    """Draw a mask in a window of the frame, then add blurred copies of it as light."""
    x0, y0, x1, y1 = (int(max(bbox[0], 0)), int(max(bbox[1], 0)),
                      int(min(bbox[2], W)), int(min(bbox[3], H)))
    if x1 <= x0 or y1 <= y0:
        return
    m = Image.new("L", (x1 - x0, y1 - y0), 0)
    draw(ImageDraw.Draw(m), x0, y0)
    for radius, colour, gain in layers:
        g = np.asarray(m.filter(ImageFilter.GaussianBlur(radius)), np.float32) / 255
        if shape:
            g /= peak(shape, size, radius)
        img[y0:y1, x0:x1] += (g * gain)[..., None] * colour


def trail_layer(img, t, cam):
    """The cable glowing behind the pulse, fading with distance."""
    lvl = pulse_level(t)
    if lvl < 0.01:
        return
    s1 = pulse_s(t)
    ss = np.arange(max(0.0, s1 - 5 * TRAIL), s1 + 0.1, 4.0)
    if len(ss) < 2:
        return
    sx, sy = to_screen(*cable_at(ss), cam)
    level = np.exp(-(s1 - ss) / TRAIL) * lvl
    pad = 90

    def draw(d, ox, oy):
        for i in range(len(ss) - 1):
            d.line([(sx[i] - ox, sy[i] - oy), (sx[i + 1] - ox, sy[i + 1] - oy)],
                   fill=int(255 * level[i + 1]), width=7)

    add_glow(img, draw, (sx.min() - pad, sy.min() - pad, sx.max() + pad, sy.max() + pad),
             [(1.5, CORE, 0.8), (10, TERRACOTTA, 0.35), (34, TERRACOTTA, 0.16)], "line", 7)


def pulse_layer(img, t):
    """The pulse head, smeared over the shutter interval in screen space."""
    lvl = pulse_level(t)
    flash = 0.9 * math.exp(-((t - T_ARRIVE - 0.04) / 0.1) ** 2)
    if lvl < 0.01 and flash < 0.01:
        return
    ts = t - np.linspace(0, SHUTTER / FPS, 6)
    pts = [to_screen(*cable_at(pulse_s(u)), camera(u)) for u in ts]
    xs = np.array([p[0] for p in pts], float)
    ys = np.array([p[1] for p in pts], float)
    pad = 260

    def draw(d, ox, oy):
        d.line([(x - ox, y - oy) for x, y in zip(xs, ys)], fill=255, width=9, joint="curve")
        d.ellipse([xs[0] - ox - 7, ys[0] - oy - 7, xs[0] - ox + 7, ys[0] - oy + 7], fill=255)

    a = max(lvl, flash)
    add_glow(img, draw, (xs.min() - pad, ys.min() - pad, xs.max() + pad, ys.max() + pad),
             [(2, HOT, 1.0 * a), (7, CORE, 0.9 * a), (26, TERRACOTTA, 0.5 * a), (80, TERRACOTTA, 0.2 * a)],
             "dot", 7)


def screen_layer(img, t, cam):
    """The laptop answers: a soft brightening and one new line, then stillness."""
    if t < T_ARRIVE - 0.6:
        return
    lift = smooth(T_ARRIVE, T_ARRIVE + 0.08, t) * (0.35 + 0.65 * math.exp(-max(t - T_ARRIVE - 0.08, 0) / 0.22))
    grow = smooth(T_ARRIVE + 0.06, T_ARRIVE + 0.32, t)
    quad = [to_screen(x, y, cam) for x, y in SCREEN]
    xs = [q[0] for q in quad]
    ys = [q[1] for q in quad]
    z = cam[2]

    if lift > 0.01:
        def scr(d, ox, oy):
            d.polygon([(x - ox, y - oy) for x, y in quad], fill=255)
        add_glow(img, scr, (min(xs) - 120, min(ys) - 120, max(xs) + 120, max(ys) + 160),
                 [(3, np.array([20, 26, 32], np.float32), lift), (60, np.array([30, 38, 46], np.float32), 0.5 * lift)])

    row, length = NEW_LINE
    lx, ly = to_screen(TERM_X, TERM_Y + row * TERM_PITCH, cam)
    n = length * grow * z

    def line(d, ox, oy):
        if n > 1:
            d.rounded_rectangle([lx - ox, ly - oy, lx + n - ox, ly + 7 * z - oy], radius=3, fill=255)
        cx = lx + n + (12 * z if n > 1 else 0)
        d.rectangle([cx - ox, ly - 5 * z - oy, cx + 11 * z - ox, ly + 12 * z - oy], fill=150)  # cursor

    add_glow(img, line, (lx - 20, ly - 30, lx + length * z + 60, ly + 40),
             [(0.6, np.array([214, 178, 150], np.float32), 1.0), (6, CORE, 0.25 * grow)])


def main():
    still = len(sys.argv) > 1 and sys.argv[1] == "still"
    src = world()
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    vignette = (1 - 0.28 * np.clip(r2, 0, 1.6) ** 1.4)[..., None]
    grain_rng = np.random.default_rng(37)
    warm, cool = np.array([1.07, 1.0, 0.87]), np.array([0.97, 1.0, 1.035])
    frames = [float(sys.argv[2]) * FPS] if still else range(int(DUR * FPS))

    for i in frames:
        t = i / FPS
        cam = camera(t)
        cx, cy, z, p = cam
        vw, vh = W / z, H / z
        frame = src.resize((W, H), Image.LANCZOS,
                           box=((cx - vw / 2 + MX) * SS, (cy - vh / 2) * SS, (cx + vw / 2 + MX) * SS, (cy + vh / 2) * SS))
        img = np.asarray(frame, np.float32).copy()

        # sun glint drifting across the cells, catching the busbars hardest
        if t < 1.4:
            gx, gy = to_screen(160 + 380 * t, 700 - 40 * t, cam)
            c, s = math.cos(-0.56), math.sin(-0.56)
            u = ((xx - gx) * c + (yy - gy) * s) / (250 * z)
            v = (-(xx - gx) * s + (yy - gy) * c) / (80 * z)
            g = 0.55 * np.exp(-u * u - v * v) + 0.6 * np.exp(-((xx - gx) ** 2 + (yy - gy) ** 2) / (34 * z) ** 2)
            edge = to_screen(0, FRAME_Y, cam)[1]
            g *= np.clip((edge - yy) / 6, 0, 1)
            lum = img.mean(-1) / 255
            img += (g * (0.45 + 1.4 * lum) * 70)[..., None] * np.array([1.0, 0.9, 0.74])

        trail_layer(img, t, cam)

        # motion blur of the tilt itself (the pulse gets its own, below)
        speed = abs(camera(t + 0.5 / FPS, False)[1] - camera(t - 0.5 / FPS, False)[1]) * z
        img = vblur(img, speed * SHUTTER)

        # shallow depth of field: a sharp band around the cable, softer top and bottom
        fy = 1150 - 260 * p
        focus = np.exp(-((yy - fy) / 820) ** 4)[..., None]
        soft = np.asarray(Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4)), np.float32)
        img = img * focus + soft * (1 - focus)

        pulse_layer(img, t)
        screen_layer(img, t, cam)

        # light: late-afternoon sun cooling into the bench's neutral side light
        k = smooth(0.25, 0.85, p)
        img *= (warm * (1 - k) + cool * k) * (1.03 - 0.04 * k)
        img *= vignette
        img += grain_rng.normal(0, 2.8, (H, W, 1)).astype(np.float32)
        out = np.clip(img, 0, 255).astype(np.uint8)
        if still:
            Image.fromarray(out).save(sys.argv[3])
        else:
            sys.stdout.buffer.write(out.tobytes())


if __name__ == "__main__":
    main()
