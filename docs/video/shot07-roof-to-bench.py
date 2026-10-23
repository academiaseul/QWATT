r"""QWATT week 1 video, shot 7 (0:37-0:40), vertical 1080x1920: the wordless
"roof to bench" transition between Jay on the rooftop and Diego at the workbench.

Open on a warm, sunlit close-up of solar cells, a sun glint drifting across them. A
cable leaves the panel's junction box and the camera tilts down after it, over the
parapet and down through the building, while a terracotta pulse runs along the
cable just ahead of the camera. The light cools from late-afternoon sun to the
neutral side light of the bench. The move settles on a desk and the edge of a
laptop: the cable runs into it and the pulse fades into the port. The screen glows
softly with a few abstract terminal lines and a waiting cursor the whole time; it
does not react to the pulse. The last 0.3 s hold still for the cut to Diego.

Honesty: everything here is generated. The roof and the bench are illustrative,
not Jay's or Diego's locations, and the panel-to-laptop cable is a visual metaphor,
not a real installation or data link: no live rooftop or meter is read this week
(the test data is simulated), so never pair this shot with "live" wording. The
bench holds only the laptop and the cable (the meters are not on the desk yet). No
people, no text, no numbers, no logos. Jay before this shot and Diego after it are
real footage.

Writes raw RGB frames to stdout. Needs numpy and Pillow. Render with:

    G="exp(-pow(log(max(b,1)*sr/(2*nb)/(260+2300*exp(-pow((pts/sr-1.35)/0.5,2))))/0.42,2))"
    python3 docs/video/shot07-roof-to-bench.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 \
      -s 1080x1920 -r 30 -i - -f lavfi -i "anoisesrc=d=3:c=pink:r=48000:a=0.5:s=7" \
      -filter_complex "[0]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v];\
    [1]afftfilt=real='re*$G':imag='im*$G',highpass=f=120,\
    volume='0.1+0.9*exp(-pow((t-1.35)/0.55,2))':eval=frame,afade=t=in:st=0:d=0.4,\
    afade=t=out:st=2.45:d=0.55,volume=1.4[a]" -map "[v]" -map "[a]" -c:v libx264 \
      -preset slow -crf 18 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 \
      -color_trc bt709 -movflags +faststart -c:a aac -b:a 192k \
      -shortest QWATT-week1-shot07-roof-to-bench.mp4

The video is converted and tagged as BT.709, like shots 6 and 8 on either side.
The whoosh is pink noise through a band-pass whose centre sweeps from ~260 Hz up
to ~2.5 kHz and back (afftfilt; pts/sr is time in seconds), peaking with the
pulse's fastest stretch at 1.35 s, around -30 dBFS RMS with peaks near -18 dBFS.
The music swell is added in the edit.
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
TRAIL = 220                 # e-folding length of the fading trail, along the cable

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
TERM_ROWS = 12              # the last row is a fresh prompt with a waiting cursor

# Base colour down the world (y, rgb); pairs one pixel apart make hard edges
ROWS = [
    (0, (206, 196, 180)), (FRAME_Y, (206, 196, 180)),           # backsheet between cells
    (FRAME_Y + 1, (84, 76, 71)), (1500, (100, 89, 80)),          # open shade under the panel, sky-lit
    (1740, (112, 97, 84)), (1772, (160, 131, 102)),              # low sun on the gravel
    (PARAPET_Y, (166, 136, 108)),
    (PARAPET_Y + 1, (224, 200, 168)), (PARAPET_Y + 60, (204, 180, 150)),  # parapet cap
    (PARAPET_Y + 61, (86, 68, 56)), (PARAPET_Y + 84, (170, 140, 112)),    # drip shadow
    (1990, (188, 154, 122)), (2380, (150, 124, 104)),            # outside wall, warm plaster
    (2520, (92, 80, 74)), (SLAB_Y - 30, (30, 28, 28)),           # through the slab
    (SLAB_Y + 40, (30, 29, 30)), (2730, (118, 119, 120)),
    (2731, (198, 198, 196)), (2736, (134, 134, 134)),            # cornice catching room light
    (2900, (154, 153, 150)), (DESK_Y, (166, 164, 160)),          # bench wall, neutral paint
    (DESK_Y + 1, (94, 84, 74)), (DESK_Y + 14, (176, 152, 124)),  # contact shadow, pale oak desk top
    (WH, (158, 134, 108)),
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
    rough = np.where(yy < SLAB_Y, 4.0, 1.6)  # sun-raked plaster outside, smooth paint inside
    plaster = noise_field(rng, WH, WW, 26) * rough + noise_field(rng, WH, WW, 4) * 1.6
    gravel = (yy > FRAME_Y + 52) & (yy < PARAPET_Y)
    grit = rng.normal(0, 1, (WH, WW)).astype(np.float32)
    lum = np.where(walls, plaster, 0) + np.where(gravel, grit * (4 + 10 * (yy > 1760)), 0)

    # pale wood: grain streaks along x, bunching up toward the back edge (perspective)
    depth = np.sqrt(np.clip((ys - DESK_Y) / (WH - DESK_Y), 0, 1)) * 900
    streak = np.asarray(Image.fromarray(rng.normal(0, 1, (902, WW // 24 + 3)).astype(np.float32), "F")
                        .resize((WW, 902), Image.BICUBIC, box=(0, 0, WW / 24, 902)))
    r0 = np.minimum(depth.astype(int), 900)
    f = (depth - r0)[:, None]
    grain = streak[r0] * (1 - f) + streak[r0 + 1] * f
    lum += np.where(yy > DESK_Y + 14, grain * 2.6, 0)

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
                      fill=(int(26 + v), int(40 + v), int(82 + 1.4 * v)))
            for fy in np.arange(y0 + 6, y1 - 3, 9):  # fine grid fingers
                inset = max(0, ch - min(fy - y0, y1 - fy)) + 2
                d.line([P(x0 + inset, fy), P(x1 - inset, fy)], fill=(50, 64, 98), width=1)
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

    # sheen on the glass: brighter toward the low sun, a light haze of reflected sky,
    # and warm veiling glare spreading in from the sun at the upper right (screen
    # blends, so the busbars keep their detail)
    top = (FRAME_Y + 53) * SS
    a = np.asarray(img.crop((0, 0, WW * SS, top)), np.float32)
    yy, xx = np.mgrid[0:top, 0:WW * SS].astype(np.float32) / SS
    xx -= MX
    sun = np.exp(-((xx - 980) / 700) ** 2 - ((yy - 200) / 900) ** 2)
    a = a * (0.94 + 0.30 * sun)[..., None]
    up = np.clip(1 - yy / FRAME_Y, 0, 1)
    glass = (yy < FRAME_Y)[..., None]
    sky = (14 + 10 * up)[..., None] * np.array([0.92, 0.98, 1.06], np.float32)
    glare = np.clip(0.55 + 0.5 * (xx / W - yy / FRAME_Y), 0, 1) ** 1.6
    glare = (92 * glare + 30 * sun)[..., None] * np.array([1.0, 0.79, 0.54], np.float32)
    for veil in (sky, glare):
        a = 255 - (255 - a) * (255 - veil * glass) / 255
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
    # base: deck, keyboard well with plain keys (lit top edges), trackpad
    d.polygon([P(*q) for q in DECK], fill=(98, 100, 105))
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
            d.line([P(*deck_point(u0 + 0.002, v0)), P(*deck_point(u1 - 0.002, v0))], fill=(62, 63, 67), width=SS)
    d.polygon([P(*deck_point(0.34, 0.56)), P(*deck_point(0.66, 0.56)), P(*deck_point(0.66, 0.93)),
               P(*deck_point(0.34, 0.93))], fill=(108, 110, 115), outline=(86, 88, 92))

    # aluminium shading: darker toward the hinge (under the lid), lighter toward the
    # front lip and toward the window on the left
    x0, y0, x1, y1 = box(-84, 4200, 690, 4500)
    a = np.asarray(img.crop((x0, y0, x1, y1)), np.float32)
    mask = Image.new("L", (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(mask).polygon([(qx - x0, qy - y0) for qx, qy in (P(*q) for q in DECK)], fill=255)
    mask = np.asarray(mask, np.float32)[..., None] / 255
    v, u = np.mgrid[0:y1 - y0, 0:x1 - x0].astype(np.float32)
    v, u = v / (y1 - y0), u / (x1 - x0)
    g = (0.86 + 0.20 * v ** 0.7 + 0.06 * (1 - u))[..., None]
    a = a * (1 - mask) + a * g * mask
    img.paste(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), (x0, y0))

    # front face and its catch-light lip
    *_, (cx, cy), (dx, dy) = DECK
    d.polygon([P(dx, dy), P(cx, cy), P(cx - 2, cy + 22), P(dx + 2, dy + 22)], fill=(52, 54, 58))
    d.line([P(dx, dy + 6), P(cx - 1, cy + 6)], fill=(64, 66, 70), width=SS)
    d.line([P(dx, dy), P(cx, cy)], fill=(158, 160, 164), width=2 * SS)
    # lid and hinge, the lid's edges catching the window light
    d.rectangle(box(-30, 4190, 622, 4204), fill=(28, 28, 30))
    d.line([P(-30, 4203), P(622, 4203)], fill=(58, 59, 63), width=SS)
    d.polygon([P(*q) for q in LID], fill=(28, 29, 32))
    d.line([P(-24, 3741), P(616, 3741)], fill=(146, 148, 154), width=2 * SS)
    d.line([P(-24, 3744), P(616, 3744)], fill=(48, 49, 53), width=SS)
    d.line([P(616, 3742), P(622, 4194)], fill=(62, 63, 68), width=SS)
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
    d.line([P(x, y) for x, y in hl[:k:2]], fill=(122, 98, 76), width=5, joint="curve")
    d.line([P(x, y) for x, y in hl[k::2]], fill=(104, 108, 114), width=5, joint="curve")
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
    a += inside * centre * np.array([14, 20, 27]) + spill * np.array([14, 18, 22])
    img.paste(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), (int((x0 + MX) * SS), int(y0 * SS)))

    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(17)
    for i in range(TERM_ROWS - 1):
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
    # a fresh prompt and a resting block cursor on the last row: part of the static
    # world, so it pans and blurs with everything else and never reacts to the pulse
    y = TERM_Y + (TERM_ROWS - 1) * TERM_PITCH
    d.rounded_rectangle(box(TERM_X, y, TERM_X + 18, y + 7), radius=3 * SS, fill=(172, 128, 104))
    d.rectangle(box(TERM_X + 30, y - 5, TERM_X + 41, y + 12), fill=(150, 160, 166))


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


def box1d(a, n, axis):
    h = n // 2
    if axis == 0:
        c = np.cumsum(np.pad(a, ((h + 1, h), (0, 0))), axis=0)
        return (c[n:] - c[:-n]) / n
    c = np.cumsum(np.pad(a, ((0, 0), (h + 1, h))), axis=1)
    return (c[:, n:] - c[:, :-n]) / n


def gblur(a, sigma):
    """Gaussian blur in float (three box passes per axis): wide glows without 8-bit banding."""
    n = int(round(math.sqrt(4 * sigma * sigma + 1))) | 1
    for axis in (0, 1):
        for _ in range(3):
            a = box1d(a, n, axis)
    return a


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
        _PEAK[key] = gblur(np.asarray(m, np.float32) / 255, radius).max()
    return _PEAK[key]


def add_glow(img, draw, bbox, layers, shape=None, size=0):
    """Draw a mask in a window of the frame, then add blurred copies of it as light."""
    x0, y0, x1, y1 = (int(max(bbox[0], 0)), int(max(bbox[1], 0)),
                      int(min(bbox[2], W)), int(min(bbox[3], H)))
    if x1 <= x0 or y1 <= y0:
        return
    m = Image.new("L", (x1 - x0, y1 - y0), 0)
    draw(ImageDraw.Draw(m), x0, y0)
    m = np.asarray(m, np.float32) / 255
    for radius, colour, gain in layers:
        g = gblur(m, radius)
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
                   fill=int(255 * level[i + 1]), width=8)

    add_glow(img, draw, (sx.min() - pad, sy.min() - pad, sx.max() + pad, sy.max() + pad),
             [(1.5, CORE, 1.0), (10, TERRACOTTA, 0.6), (34, TERRACOTTA, 0.25)], "line", 8)


def pulse_layer(img, t):
    """The pulse head, smeared over the shutter interval in screen space."""
    lvl = pulse_level(t)
    flash = 1.4 * math.exp(-((t - T_ARRIVE - 0.04) / 0.1) ** 2)
    if lvl < 0.01 and flash < 0.01:
        return
    ts = t - np.linspace(0, SHUTTER / FPS, 6)
    pts = [to_screen(*cable_at(pulse_s(u)), camera(u)) for u in ts]
    xs = np.array([p[0] for p in pts], float)
    ys = np.array([p[1] for p in pts], float)
    pad = 260

    def draw(d, ox, oy):
        d.line([(x - ox, y - oy) for x, y in zip(xs, ys)], fill=255, width=11, joint="curve")
        d.ellipse([xs[0] - ox - 9, ys[0] - oy - 9, xs[0] - ox + 9, ys[0] - oy + 9], fill=255)

    a = max(lvl, flash)
    add_glow(img, draw, (xs.min() - pad, ys.min() - pad, xs.max() + pad, ys.max() + pad),
             [(2, HOT, 1.0 * a), (7, CORE, 1.0 * a), (26, TERRACOTTA, 0.85 * a), (80, TERRACOTTA, 0.35 * a)],
             "dot", 9)


YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
VIGNETTE = (1 - 0.28 * np.clip(((XX - W / 2) / (W / 2)) ** 2 + ((YY - H / 2) / (H / 2)) ** 2, 0, 1.6) ** 1.4)[..., None]
WARM, COOL = np.array([1.07, 1.0, 0.87]), np.array([0.99, 1.0, 1.01])


def render(src, t, grain_rng):
    cam = camera(t)
    cx, cy, z, p = cam
    vw, vh = W / z, H / z
    frame = src.resize((W, H), Image.LANCZOS,
                       box=((cx - vw / 2 + MX) * SS, (cy - vh / 2) * SS, (cx + vw / 2 + MX) * SS, (cy + vh / 2) * SS))
    img = np.asarray(frame, np.float32).copy()
    xx, yy = XX, YY

    # sun glint drifting across the cells, catching the busbars hardest
    if t < 1.4:
        gx, gy = to_screen(200 + 520 * t, 700 + 220 * t, cam)
        c, s = math.cos(-0.56), math.sin(-0.56)
        u = ((xx - gx) * c + (yy - gy) * s) / (380 * z)
        v = (-(xx - gx) * s + (yy - gy) * c) / (140 * z)
        r2 = ((xx - gx) ** 2 + (yy - gy) ** 2) / (z * z)
        g = (0.5 * np.exp(-u * u - v * v) + 0.8 * np.exp(-r2 / 70 ** 2) + 1.6 * np.exp(-r2 / 16 ** 2)
             + 0.35 * np.exp(-((yy - gy) / (5 * z)) ** 2 - ((xx - gx) / (240 * z)) ** 2))  # faint lens streak
        edge = to_screen(0, FRAME_Y, cam)[1]
        g *= np.clip((edge - yy) / 6, 0, 1) * smooth(-0.4, 0.3, t)
        lum = img.mean(-1) / 255
        img += (g * (0.5 + 1.3 * lum) * 110)[..., None] * np.array([1.0, 0.88, 0.7])

    trail_layer(img, t, cam)

    # motion blur of the tilt itself (the pulse gets its own, below)
    speed = abs(camera(t + 0.5 / FPS, False)[1] - camera(t - 0.5 / FPS, False)[1]) * z
    img = vblur(img, speed * SHUTTER)

    # shallow depth of field: a sharp band around the cable, softer top and bottom
    fy = 1150 - 260 * p
    focus = np.exp(-((yy - fy) / 820) ** 4)[..., None]
    soft = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))
    img = img * focus + np.asarray(soft, np.float32) * (1 - focus)

    pulse_layer(img, t)

    # light: late-afternoon sun cooling into the bench's neutral side light
    k = smooth(0.25, 0.85, p)
    img *= (WARM * (1 - k) + COOL * k) * (1.11 - 0.12 * k)  # the sunlit roof a touch brighter
    img *= VIGNETTE
    img += grain_rng.normal(0, 2.8, (H, W, 1)).astype(np.float32)
    return np.clip(img, 0, 255).astype(np.uint8)


def main():
    src = world()
    grain_rng = np.random.default_rng(37)
    if len(sys.argv) > 3 and sys.argv[1] == "still":
        Image.fromarray(render(src, float(sys.argv[2]), grain_rng)).save(sys.argv[3])
        return
    for i in range(int(DUR * FPS)):
        sys.stdout.buffer.write(render(src, i / FPS, grain_rng).tobytes())


if __name__ == "__main__":
    main()
