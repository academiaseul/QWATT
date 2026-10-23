r"""QWATT week 1 video, shot 18 (2:09-2:15, 6.0 s, 180 frames), vertical 1080x1920:
the breather. Music only, no dialogue: a wide rooftop at golden hour after the green
CI run (shot 17) and before "Where this goes" (2:15), which opens back on the roof.

A sky-heavy frame. The sun sits low on the Andes ridge, half behind it, over
Santiago's haze and a far skyline, a few neighbouring roofs with panel rows, and in
the lower half a flat roof covered in rows of solar panels. The modules face the sun
at a low tilt, so their glass mirrors the warm sky (more strongly with distance, as
glass does at grazing angles; the mirrored ridge shows as a darker band) and a
glitter path of sun glints runs down the rows under the sun. Two things make the
glints: each module sits a degree or so off true and mirrors the sun as a soft
patch at its own spot, and the textured cover glass flashes in tiny points, one
facet per 7 cm, each tipped a little. Only glass the sun actually reaches can glint
(the next row and the curb shade the far part of each module). As the camera moves
the rows slide under the fixed sun angle, so patches come and go at module edges and
the points travel with the rows, twinkling in and out. The low sun throws long
shadows toward the camera; the walkways between blocks of panels are golden stripes
that run toward the sun. The camera cranes up 45 cm, pushes in 30 cm and drifts
22 cm right, already moving at the cut and still moving at the end; the roof is
drawn in true perspective every frame, so the rows open up while the sky and the
mountains hold still. Four birds cross far away and thin clouds drift.

Honesty: everything here is generated, an illustrative stand-in in the palette and
style of shots 2 and 4 (Andes silhouette, city haze). It is not Jay's roof, not a
QWATT site and not a real installation, and nothing in it is measured: no live
rooftop or meter was read this week (the test data is simulated). Rooftop shots are
setting, not evidence, so never pair it with "live" wording. No text, numbers,
people, signage or logos. Real footage of a rooftop at golden hour (vertical, 6 s,
slow move) can replace it one for one. Light: from Santiago the Andes lie to the east,
so to a local eye a sun on the ridge reads as early morning, while shots 2 and 4 and the
planned rooftop takes ("late afternoon or golden hour" in the script) are afternoon
light. If real footage replaces this, pick a take whose light matches the 2:15 rooftop.

Vertical-platform safe zones: nothing that matters sits in the top 120 px or the
right 140 px; the glitter path centres on y ~1300-1450 (sparkles reach ~1230-1560),
above the bottom 420 px caption band apart from its lowest points. Colour is
converted and tagged as BT.709, as shot 17 before it is. Renders in about
2.5 min on 4 shared cores (~0.85 s a frame; the sky, ridge and haze are cached).

Writes raw RGB frames to stdout. Needs numpy and Pillow. Render with:

    python3 docs/video/shot18-breather.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 \
      -s 1080x1920 -r 30 -i - \
      -f lavfi -i "anoisesrc=d=6:c=brown:r=48000:a=0.06:seed=18" \
      -f lavfi -i "anoisesrc=d=6:c=pink:r=48000:a=0.05:seed=81" \
      -filter_complex "[0]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v];\
    [1]lowpass=f=260,highpass=f=35,volume='0.75+0.25*sin(2*PI*t/4.7+0.8)':eval=frame[low];\
    [2]highpass=f=450,lowpass=f=1900,\
    volume='0.15+0.85*pow(sin(PI*t/3.4+0.5),2)':eval=frame[gust];\
    [low][gust]amix=inputs=2:normalize=0:duration=first,\
    afade=t=in:st=0:d=0.8,afade=t=out:st=5.2:d=0.8,volume=2[a]" \
      -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
      -colorspace bt709 -color_primaries bt709 -color_trc bt709 -movflags +faststart \
      -c:a aac -b:a 192k -t 6 QWATT-week1-shot18-breather.mp4

The audio is a faint wind bed, nothing else (music comes in the edit): low brown
noise for the air, and a band of pink noise that swells and settles twice like a
light breeze; measured on the render: -37.6 dBFS RMS, peak -22.8 dBFS.
`python3 docs/video/shot18-breather.py still 3.0 out.png` writes one frame (frame 90,
with the same grain as in the render).
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FPS = 30
DUR = 6.0
W, H = 1080, 1920
SS = 2                      # the roof is drawn at 2x every frame and reduced
FM = 240                    # far layers run this far past each side (reflections sample them)

# Camera: a level pinhole (no pitch, no roll), so the horizon stays on one row and the
# sky and mountains hold still; only the near roof shows the move. World units are
# metres: x right, y up, z forward, origin on the deck under the camera's start.
F = 1000.0                  # focal length in output pixels
CX, HZ = W / 2, 1000.0      # principal point: the horizon is row 1000, sky above
CAM0 = np.array([0.00, 4.00, 0.00])   # start: 4 m above the deck
CAM1 = np.array([0.22, 4.45, 0.30])   # end: 45 cm higher, 30 cm in, 22 cm to the right

# Sun, low over the Andes; where it sits fixes the panels' tilt so the glints land on GLINT_Y
SUN_X, SUN_Y, SUN_R = 382.0, 884.0, 24.0
GLINT_Y = 1385.0

# Panel field: modules in blocks, rows facing the sun, a low curb at the far edge of the roof
L, PW, GAP = 1.70, 1.00, 0.02         # module length up the tilt, width, gap between modules
NG, AISLE = 5, 1.00                   # modules per block, walkway between blocks
BASE = 0.15                           # low (far) edge above the deck
W0, PITCH, NROWS = 4.4, 2.3, 6        # first row's near edge, row spacing, rows
U_MIN, U_MAX = -12.0, 18.0            # extent of the rows sideways
W_CURB, HC, TC = 19.4, 0.45, 0.30     # curb distance, height, thickness
ROOF_TOP = 1150                       # the roof layer covers rows 1150..1920 (curb is below 1180)
CELL_ROWS = 3                         # nearest rows get their cell lines drawn

# Glints: glass roughness, module alignment and the cover glass texture
SIG_CORE, SIG_HALO = math.radians(1.6), math.radians(3.0)   # whole-module reflection, sheen
JIT_TILT, JIT_ROLL = math.radians(1.2), math.radians(1.4)   # each module sits this far off true
FACET_CELL, FACET_FILL = 0.07, 0.85                         # textured glass: facet spacing, share that flash
TIP_UP, TIP_SIDE = math.radians(6.5), math.radians(2.4)     # how far facets tip (a tall, narrow path)
SIG_FACET = math.radians(0.8)                               # how sharply a facet flashes

# Far layers and neighbours (screen pixels)
CLOUD_H = 820                         # clouds live in rows 0..820, clear of the ridge and the sun
NB_D = 80.0                           # neighbours' distance in metres, for parallax
NB_Y0, NB_Y1, NB_M = 1040, 1240, 30   # their band of rows, and the margin each side

# Roof canvas (2x) and what each pixel of the id map holds
RW, RH = W * SS, (H - ROOF_TOP) * SS
ID_NONE, ID_DECK, ID_FRAME, ID_CELL, ID_CURB, ID_CAP, ID_LIP, ID_LEG, ID_GLASS = -1, 0, 2, 3, 4, 5, 6, 7, 100
ID_UNDER = (10, 11, 12, 13, 14, 15)   # the gap under a module's high edge, top to bottom
UNDER_RGB = ((29, 25, 28), (33, 29, 32), (38, 33, 36), (43, 38, 41), (50, 43, 46), (58, 50, 53))
# flat colour per id (indexed by id + 1); ids drawn from the sky, deck or glass are overwritten
FLAT_LUT = np.zeros((ID_UNDER[-1] + 2, 3), np.float32)
for _i, _c in ((ID_LEG, (24, 20, 22)), (ID_LIP, (108, 98, 96)),      # legs; frame edge, in shade
               (ID_CURB, (94, 78, 76)), (ID_CAP, (242, 198, 148)),    # curb face in shade, cap in the sun
               *zip(ID_UNDER, UNDER_RGB, strict=True)):
    FLAT_LUT[_i + 1] = _c

# Birds: x, y at t=0 (px), vx, vy (px/s), wingspan (px), wingbeats per s, phase
BIRDS = [(752, 512, -17, -1.6, 19, 2.6, 0.0), (790, 541, -16, -1.0, 16, 2.9, 1.7),
         (722, 560, -18, -2.2, 14, 2.4, 3.1), (884, 624, -12, 0.6, 12, 2.2, 0.6)]

GRAIN_SEED = 18                       # film grain: frame i uses the generator seeded (GRAIN_SEED, i)


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def move(t):
    """Camera progress 0..1: already moving at the cut, a little faster mid-shot, still moving at the end."""
    u = t / DUR
    return 0.55 * u + 0.45 * u * u * (3 - 2 * u)


def cam(t):
    return CAM0 + (CAM1 - CAM0) * move(t)


S_DIR = unit([(SUN_X - CX) / F, (HZ - SUN_Y) / F, 1.0])
AZ, ELEV = math.atan2(S_DIR[0], S_DIR[2]), math.asin(S_DIR[1])
WD = np.array([math.sin(AZ), 0.0, math.cos(AZ)])   # along the rows' depth, toward the sun
UD = np.array([math.cos(AZ), 0.0, -math.sin(AZ)])  # along the rows
UP = np.array([0.0, 1.0, 0.0])
# a pitch-only mirror facing the sun reflects it at depression ELEV + 2*TILT, straight below it
TILT = (math.atan((GLINT_Y - HZ) * math.cos(AZ) / F) - ELEV) / 2
ZH, LC = BASE + L * math.sin(TILT), L * math.cos(TILT)  # high (near) edge, depth of a module
N0 = unit(UP + math.tan(TILT) * WD)


def project(P, C):
    """World points (..., 3) to screen x, y in output pixels."""
    rel = P - C
    return CX + F * rel[..., 0] / rel[..., 2], HZ - F * rel[..., 1] / rel[..., 2]


def clip_near(poly, C, znear=0.5):
    """Clip a world polygon to the part in front of the camera (Sutherland-Hodgman on z),
    so a long shadow reaching behind the lens does not project inside out."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        zp, zq = p[2] - C[2] - znear, q[2] - C[2] - znear
        if zp >= 0:
            out.append(p)
        if (zp >= 0) != (zq >= 0):
            out.append(p + (q - p) * (zp / (zp - zq)))
    return np.array(out)


def to_ground(P):
    """Slide world points down the sun's rays onto the deck (y = 0): where they cast shadow."""
    return P - S_DIR * (P[..., 1:2] / S_DIR[1])


# ---------------------------------------------------------------- far layers (static)

def ridge_far(x):
    return (HZ - 66 - 34 * np.sin(x / 290 + 0.6) ** 2 - 20 * np.sin(x / 118 + 2.1) ** 2
            - 7 * np.sin(x / 37 + 0.3) ** 2 - 3 * np.sin(x / 13 + 1.1) ** 2)


def ridge_near(x):
    return HZ - 20 - 16 * np.sin(x / 210 + 1.2) ** 2 - 6 * np.sin(x / 63) ** 2 - 2 * np.sin(x / 17) ** 2


def sky(xx, yy, core=True):
    """Golden-hour sky: dusty blue overhead to pale gold at the horizon, sun glow around SUN."""
    v = np.clip(yy / HZ, 0, 1.3)
    stops = [0.0, 0.24, 0.47, 0.68, 0.85, 1.0, 1.3]
    cols = np.array([(56, 76, 118), (94, 104, 142), (156, 134, 150), (214, 152, 126),
                     (240, 180, 122), (250, 206, 148), (238, 196, 150)], float)
    col = np.stack([np.interp(v, stops, cols[:, c]) for c in range(3)], -1)
    dx, dy = xx - SUN_X, yy - SUN_Y
    r2 = dx * dx + dy * dy
    col += np.exp(-r2 / (2 * 80.0 ** 2))[..., None] * np.array([60, 40, 22])
    col += np.exp(-r2 / (2 * 280.0 ** 2))[..., None] * np.array([56, 24, 0])
    col += np.exp(-(dx / 780) ** 2 - (dy / 230) ** 2)[..., None] * np.array([30, 10, -6])
    if core:
        r = np.sqrt(r2)
        disc = np.clip((SUN_R + 1.2 - r) / 2.4, 0, 1)[..., None]
        col += np.exp(-r2 / (2 * 36.0 ** 2))[..., None] * np.array([70, 60, 40])
        col = col * (1 - disc) + np.array([255, 249, 234]) * disc
    return col


def clouds(cw, ch):
    """Thin stratus streaks, lit warm underneath near the sun. RGBA float."""
    rng = np.random.default_rng(181)
    field = np.zeros((ch, cw), np.float32)
    for cell, amp in ((110, 1.0), (40, 0.45), (15, 0.18)):
        g = rng.normal(0, 1, (ch // cell + 3, cw // (cell * 6) + 3)).astype(np.float32)
        field += amp * np.asarray(Image.fromarray(g).resize((cw, ch), Image.BICUBIC))
    yy, xx = np.mgrid[0:ch, 0:cw].astype(np.float32)
    env = 0.9 * np.exp(-((yy - 420) / 80) ** 2) + 0.75 * np.exp(-((yy - 640) / 55) ** 2)
    dens = np.clip((field * env - 0.32) / 0.6, 0, 1) ** 1.4
    warm = np.clip(np.exp(-((xx - FM - SUN_X) / 560) ** 2) * (yy / 640), 0, 1)[..., None]
    col = np.array([150, 128, 154]) * (1 - warm) + np.array([255, 194, 150]) * warm
    return np.dstack([col, 0.62 * dens])


def far_layers():
    """Sky, sun, Andes, skyline and haze over a canvas FM wider each side.
    Returns (sky, mountains+skyline+haze RGBA over it, what the glass reflects, clouds RGBA)."""
    fw = W + 2 * FM
    yy, xx = np.mgrid[0:H, 0:fw].astype(np.float32)
    xs = xx - FM
    base = sky(xs, yy)
    refl = sky(xs, yy, core=False)
    over = np.zeros((H, fw, 4), np.float32)

    def lay(rgb, a):
        nonlocal over
        a = a[..., None]
        over[..., :3] = rgb * a + over[..., :3] * (1 - a)
        over[..., 3:] = a + over[..., 3:] * (1 - a)

    # Andes: far range and foothills, exact anti-aliasing per column, lighter toward their base
    xcol = np.arange(fw) - FM
    rf, rn = ridge_far(xcol), ridge_near(xcol)
    hz_fade = np.clip((yy - 880) / 120, 0, 1)[..., None]
    far_col = np.array([146, 118, 136]) * (1 - hz_fade) + np.array([196, 158, 156]) * hz_fade
    near_col = np.array([124, 98, 110]) * (1 - hz_fade) + np.array([176, 138, 134]) * hz_fade
    depth_f = yy - rf[None, :]
    rim = (np.exp(-((xs - SUN_X) / 140) ** 2) * np.exp(-np.clip(depth_f, 0, None) / 2.4))[..., None]
    lay(far_col + rim * np.array([120, 92, 52]), np.clip(depth_f + 0.5, 0, 1))
    lay(near_col, np.clip(yy - rn[None, :] + 0.5, 0, 1))

    # skyline, drawn at 2x: far blocks then nearer ones, flat and hazy, no signage
    rng = np.random.default_rng(1802)
    for base_y, mean_h, col, alpha in ((1030, 18, (194, 156, 148), 255), (1062, 30, (160, 126, 122), 255)):
        cnv = Image.new("RGBA", (fw * 2, 400), (0, 0, 0, 0))
        d = ImageDraw.Draw(cnv)
        x = -10.0
        while x < fw:
            bw = rng.uniform(10, 46)
            bh = min(rng.exponential(mean_h), 2.2 * mean_h) + 6
            if rng.random() < 0.04 and abs(x - FM - SUN_X) > 160:
                bh += rng.uniform(24, 50)  # an occasional tower, none right under the sun
            top = base_y - bh
            step = rng.uniform(-6, 2)
            # a block reaches over any gap to the next (a gap shows as a lit thread), and down to
            # the canvas's last row, so row 1099 is solid where the fill below takes over
            d.rectangle([x * 2, (top - 900) * 2, (x + bw + max(step, 0)) * 2, 399], fill=(*col, alpha))
            x += bw + step
        arr = np.asarray(cnv.reduce(2), np.float32)
        a = np.zeros((H, fw), np.float32)
        rgb = np.zeros((H, fw, 3), np.float32)
        a[900:1100] = arr[..., 3] / 255
        rgb[900:1100] = arr[..., :3]
        a[1100:] = 1.0
        rgb[1100:] = col
        lay(rgb, a)

    # haze: a warm band along the horizon, stronger toward the sun
    sunward = 1 + 0.6 * np.exp(-((xs - SUN_X) / 420) ** 2)
    haze_a = np.clip((0.62 * np.exp(-((yy - 1010) / 46) ** 2) + 0.30 * np.exp(-((yy - 1070) / 110) ** 2))
                     * sunward, 0, 0.9)
    haze = np.array([242, 194, 148])
    over[..., :3] = haze * haze_a[..., None] + over[..., :3] * (1 - haze_a[..., None])
    over[..., 3] = haze_a + over[..., 3] * (1 - haze_a)

    # veiling glare round the sun, over the ridge as well as the sky
    r2 = (xs - SUN_X) ** 2 + (yy - SUN_Y) ** 2
    glare = np.exp(-r2 / (2 * 110.0 ** 2))[..., None] * np.array([60, 46, 26])
    over[..., :3] += glare  # where there is ground; the sky has its own glow
    a = over[..., 3:]
    return base, over, refl * (1 - a) + over[..., :3] * a, clouds(fw, CLOUD_H)


# ---------------------------------------------------------------- neighbours (static, moves a little)

def neighbours():
    """Three neighbouring roofs behind our curb: flat tops with panel rows, rim-lit edges,
    shaded facades. Drawn in screen pixels at 2x, returned as 1x RGBA with a margin."""
    cw, ch = (W + 2 * NB_M) * 2, (NB_Y1 - NB_Y0) * 2
    img = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def P(x, y):
        return ((x + NB_M) * 2, (y - NB_Y0) * 2)

    def poly(pts, col):
        d.polygon([P(*p) for p in pts], fill=col)

    rng = np.random.default_rng(77)
    # (left, right, back y, front y, skew px, panel rows)
    for x0, x1, yb, yf, sk, rows in ((-40, 430, 1126, 1166, 16, 4), (520, 860, 1094, 1110, 8, 2),
                                     (780, 1150, 1114, 1150, 12, 3)):
        poly([(x0, yf), (x1, yf), (x1, NB_Y1), (x0, NB_Y1)], (112, 94, 96, 255))         # facade in shade
        for wy in range(int(yf) + 12, NB_Y1, 26):                                          # window bands
            for wx in range(int(x0) + 14, int(x1) - 20, 34):
                poly([(wx, wy), (wx + 20, wy), (wx + 20, wy + 13), (wx, wy + 13)], (136, 116, 124, 255))
        poly([(x0 + sk, yb), (x1 + sk, yb), (x1, yf), (x0, yf)], (164, 138, 126, 255))     # roof top
        poly([(x0 + sk, yb - 2), (x1 + sk, yb - 2), (x1 + sk, yb + 1), (x0 + sk, yb + 1)], (246, 204, 156, 255))
        poly([(x0, yf - 1), (x1, yf - 1), (x1, yf + 2), (x0, yf + 2)], (132, 110, 104, 255))
        for r in range(rows):
            f0 = (r + 0.6) / (rows + 0.4)
            ya, yb2 = yb + (yf - yb) * f0, yb + (yf - yb) * (f0 + 0.55 / (rows + 0.4))
            xa = x0 + sk * (1 - f0) + 10
            while xa < x1 + sk * (1 - f0) - 30:
                pw = 18 + 6 * f0
                poly([(xa, ya), (xa + pw, ya), (xa + pw, yb2), (xa, yb2)], (92, 84, 100, 255))
                poly([(xa, ya - 0.5), (xa + pw, ya - 0.5), (xa + pw, ya + 0.5), (xa, ya + 0.5)],
                     (226, 186, 146, 255) if rng.random() > 0.3 else (176, 146, 132, 255))
                xa += pw + 2
    # a stair box on the middle roof, rim-lit against the haze
    poly([(600, 1074), (650, 1074), (650, 1096), (600, 1096)], (126, 104, 104, 255))
    poly([(600, 1072), (650, 1072), (650, 1075), (600, 1075)], (236, 196, 150, 255))
    return img.reduce(2)


def neighbour_glints():
    """Sun glints on the neighbours' panels under the sun: (x, y, on-time in the move)."""
    rng = np.random.default_rng(91)
    out = []
    for _ in range(9):
        out.append((SUN_X + rng.normal(0, 26), rng.uniform(1134, 1162), rng.uniform(-0.1, 1.1)))
    return out


# ---------------------------------------------------------------- the roof (per frame, 3D)

def build_panels():
    """Every module: glass corners (near-left, near-right, far-right, far-left), its row, a
    tone, a slightly-off normal, and the obstacle that shades its far part."""
    rng = np.random.default_rng(1818)
    quads, rows, blocks = [], [], []
    step = PW + GAP
    period = NG * step - GAP + AISLE
    u_start = -(NG * step - GAP) / 2 - 2 * period  # a block centred under the sun
    for r in range(NROWS):
        w = W0 + r * PITCH
        u = u_start
        while u < U_MAX:
            for m in range(NG):
                ua = u + m * step
                if ua < U_MIN:
                    continue
                ub = ua + PW
                quads.append([ua * UD + w * WD + ZH * UP, ub * UD + w * WD + ZH * UP,
                              ub * UD + (w + LC) * WD + BASE * UP, ua * UD + (w + LC) * WD + BASE * UP])
                rows.append(r)
            blocks.append((r, u, u + NG * step - GAP))
            u += period
    quads = np.array(quads)
    rows = np.array(rows)
    n = len(rows)
    tone = rng.uniform(0.90, 1.05, n).astype(np.float32)
    dt = rng.normal(0, JIT_TILT, n)
    dr = rng.normal(0, JIT_ROLL, n)
    normals = unit(UP[None] + np.tan(TILT + dt)[:, None] * WD[None] + np.tan(dr)[:, None] * UD[None])
    # what shades a module's far part from the low sun: the next row's high edge, or the curb
    obs_w = np.where(rows < NROWS - 1, W0 + (rows + 1) * PITCH, W_CURB)
    obs_z = np.where(rows < NROWS - 1, ZH, HC)
    return {"quads": quads, "rows": rows, "tone": tone, "normals": normals, "obs_w": obs_w,
            "obs_z": obs_z, "blocks": blocks}


def cell_lines(quads):
    """Cell borders (6 across, 10 up the tilt) for every module, as 3D segments (n, 14, 2, 3)."""
    nl, nr, fr, fl = quads[:, 0], quads[:, 1], quads[:, 2], quads[:, 3]
    segs = []
    for i in range(1, 6):
        f = i / 6
        segs.append([nl + (nr - nl) * f, fl + (fr - fl) * f])
    for k in range(1, 10):
        f = k / 10
        segs.append([nl + (fl - nl) * f, nr + (fr - nr) * f])
    return np.transpose(np.array(segs), (2, 0, 1, 3))


def to_canvas(x, y):
    return x * SS, (y - ROOF_TOP) * SS


def view_dirs(x, y):
    """Unit view rays for screen positions (level camera)."""
    return unit(np.stack([(x - CX) / F, -(y - HZ) / F, np.ones_like(x)], -1))


def bilinear(img, x, y):
    h, w = img.shape[:2]
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0, y0 = x.astype(np.int32), y.astype(np.int32)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    a, b = img[y0, x0], img[y0, x0 + 1]
    c, e = img[y0 + 1, x0], img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy


def glass_look(refl_src):
    """What the glass shows from the camera's position, at 2x: the reflected sky and skyline
    (Fresnel: dark navy close up, a mirror at grazing angles), for a module facing the sun
    at TILT. It depends only on the viewing direction, so it is the same every frame."""
    ys, xs = np.mgrid[0:RH, 0:RW].astype(np.float32)
    x, y = (xs + 0.5) / SS, ROOF_TOP + (ys + 0.5) / SS
    v = view_dirs(x, y)
    vn = (v @ N0)[..., None]
    r = v - 2 * vn * N0
    xr, yr = CX + F * r[..., 0] / r[..., 2], HZ - F * r[..., 1] / r[..., 2]
    sky_r = bilinear(refl_src, xr + FM, yr)
    cos_i = np.clip(-vn, 0, 1)
    fres = 0.06 + 0.94 * (1 - cos_i) ** 4  # Schlick, softened a little so the near rows hold some sky
    cell = np.array([16, 20, 52], np.float32)
    return (cell * (1 - fres) + sky_r * fres).astype(np.float32)


def deck_rows():
    """Deck colour per canvas row, lit and in shadow, hazier with distance."""
    y = ROOF_TOP + (np.arange(RH) + 0.5) / SS
    z = F * CAM0[1] / np.maximum(y - HZ, 1)
    haze = (1 - np.exp(-z / 40))[:, None]
    lit = np.array([186, 134, 96]) * (1 - haze) + np.array([226, 178, 136]) * haze
    shade = np.array([74, 64, 66]) * (1 - haze) + np.array([150, 126, 120]) * haze
    return lit.astype(np.float32), shade.astype(np.float32)


class Roof:
    def __init__(self, refl_src):
        self.p = build_panels()
        self.cells = cell_lines(self.p["quads"])
        self.glass = glass_look(refl_src)
        self.lit, self.shade = deck_rows()
        # glint window (1x): around the column under the sun
        gx0, gx1 = int(SUN_X - 280), int(SUN_X + 280)
        gy0, gy1 = int(GLINT_Y - 200), int(GLINT_Y + 230)
        self.gwin = (max(gx0, 0) * SS, (gy0 - ROOF_TOP) * SS, min(gx1, W) * SS, (gy1 - ROOF_TOP) * SS)
        x0, y0, x1, y1 = self.gwin
        ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        self.gv = view_dirs((xs + 0.5) / SS, ROOF_TOP + (ys + 0.5) / SS)

    def draw(self, C):
        """One frame of the roof at 2x: returns RGBA uint8 (RH, RW, 4)."""
        p = self.p
        ids = Image.new("I", (RW, RH), ID_NONE)
        d = ImageDraw.Draw(ids)
        shadow = Image.new("L", (RW, RH), 0)
        sd = ImageDraw.Draw(shadow)

        def pts(P):
            P = clip_near(P, C)
            x, y = project(P, C)
            return list(zip(*to_canvas(x, y), strict=True))

        ul, ur = -60.0, 60.0  # the deck and the curb run far past both sides of the frame
        # deck: everything below the curb's foot
        foot = pts(np.array([ul * UD + W_CURB * WD, ur * UD + W_CURB * WD]))
        d.polygon([foot[0], foot[1], (RW + 50, RH + 50), (-50, RH + 50)], fill=ID_DECK)
        # curb: inner face in shade, top caught by the sun
        face = np.array([ul * UD + W_CURB * WD, ur * UD + W_CURB * WD,
                         ur * UD + W_CURB * WD + HC * UP, ul * UD + W_CURB * WD + HC * UP])
        d.polygon(pts(face), fill=ID_CURB)
        cap = np.array([ul * UD + W_CURB * WD + HC * UP, ur * UD + W_CURB * WD + HC * UP,
                        ur * UD + (W_CURB + TC) * WD + HC * UP, ul * UD + (W_CURB + TC) * WD + HC * UP])
        d.polygon(pts(cap), fill=ID_CAP)
        # long shadows toward the camera: the curb's, and each block's
        sd.polygon(pts(to_ground(face)), fill=255)
        for r, ua, ub in p["blocks"]:
            w = W0 + r * PITCH
            blk = np.array([ua * UD + w * WD + ZH * UP, ub * UD + w * WD + ZH * UP,
                            ub * UD + (w + LC) * WD + BASE * UP, ua * UD + (w + LC) * WD + BASE * UP])
            sh_pts = pts(to_ground(blk))
            if len(sh_pts) >= 3:
                sd.polygon(sh_pts, fill=255)

        # modules, far rows first so nearer ones overlap them
        q = p["quads"]
        qx, qy = project(q, C)
        qx, qy = to_canvas(qx, qy)
        # the high edge, from the glass down to the deck: frame lip, then four bands of the dark gap
        zs = [ZH, ZH - 0.035] + [(ZH - 0.035) * (1 - i / 6) for i in range(1, 7)]
        ex, ey = [], []
        for z in zs:
            x, y = project(q[:, :2] - (ZH - z) * UP, C)
            x, y = to_canvas(x, y)
            ex.append(x)
            ey.append(y)
        # two legs per module, 12 cm in from its sides
        lu = np.stack([q[:, 0] + (q[:, 1] - q[:, 0]) * f for f in (0.12, 0.17, 0.83, 0.88)], 1)
        lx_, ly_ = project(np.concatenate([lu, lu - ZH * UP], 1), C)
        lx_, ly_ = to_canvas(lx_, ly_)
        cx_, cy_ = project(self.cells, C)
        cx_, cy_ = to_canvas(cx_, cy_)
        for r in range(NROWS - 1, -1, -1):
            for k in np.nonzero(p["rows"] == r)[0]:
                if qx[k].max() < -20 or qx[k].min() > RW + 20:
                    continue
                for i, ident in enumerate((ID_LIP,) + ID_UNDER):
                    d.polygon([(ex[i][k, 0], ey[i][k, 0]), (ex[i][k, 1], ey[i][k, 1]),
                               (ex[i + 1][k, 1], ey[i + 1][k, 1]), (ex[i + 1][k, 0], ey[i + 1][k, 0])], fill=ident)
                for a_, b_ in ((0, 1), (2, 3)):
                    d.polygon([(lx_[k, a_], ly_[k, a_]), (lx_[k, b_], ly_[k, b_]),
                               (lx_[k, b_ + 4], ly_[k, b_ + 4]), (lx_[k, a_ + 4], ly_[k, a_ + 4])], fill=ID_LEG)
                quad = list(zip(qx[k], qy[k], strict=True))
                d.polygon(quad, fill=ID_GLASS + int(k))
                if r < CELL_ROWS:
                    for s in range(cx_.shape[1]):
                        d.line([(cx_[k, s, 0], cy_[k, s, 0]), (cx_[k, s, 1], cy_[k, s, 1])], fill=ID_CELL, width=1)
                d.line(quad + [quad[0]], fill=ID_FRAME, width=3 if r < 2 else 2)

        ids = np.asarray(ids)
        glass_m = ids >= ID_GLASS
        k = np.where(glass_m, ids - ID_GLASS, 0)
        # flat colours in one lookup; the deck, glass, frames and busbars are filled in after
        rgb = FLAT_LUT[np.where(glass_m, 0, ids + 1)]
        dm = ids == ID_DECK
        sh = np.asarray(shadow.filter(ImageFilter.GaussianBlur(2.0)), np.float32)[dm][:, None] / 255
        rows = np.nonzero(dm)[0]
        rgb[dm] = self.lit[rows] * (1 - sh) + self.shade[rows] * sh
        rgb[glass_m] = self.glass[glass_m] * p["tone"][k[glass_m]][:, None]
        m = ids == ID_FRAME
        rgb[m] = self.glass[m] * 0.55 + np.float32([92, 84, 82])            # aluminium, sky in it
        m = ids == ID_CELL
        rgb[m] = self.glass[m] * 1.16 + 6                                   # busbars, a touch brighter
        self.add_glints(rgb, ids, k, C)
        out = np.empty((RH, RW, 4), np.uint8)
        out[..., :3] = np.clip(rgb, 0, 255, out=rgb)
        out[..., 3] = np.where(ids == ID_NONE, 0, 255)
        return out

    def add_glints(self, rgb, ids, kmap, C):
        """The sun mirrored in the glass, only where that spot of glass is in the sun (not shaded
        by the next row or the curb): a broad sheen, the whole module's reflection, and the
        sparkle of the textured cover glass, then a soft bloom. Only glass pixels in the
        window under the sun are computed."""
        p = self.p
        x0, y0, x1, y1 = self.gwin
        sel = np.nonzero(ids[y0:y1, x0:x1] >= ID_GLASS)
        if not sel[0].size:
            return
        k = kmap[y0:y1, x0:x1][sel]
        v = self.gv[sel]
        n = p["normals"][k]
        vn = np.einsum("ij,ij->i", v, n)
        r = v - 2 * vn[:, None] * n
        fres = 0.04 + 0.96 * (1 - np.clip(-vn, 0, 1)) ** 5
        # where the ray meets the module, and whether the sun reaches that point
        t = np.einsum("ij,ij->i", p["quads"][k, 0] - C, n) / np.minimum(vn, -1e-6)
        hit = C + t[:, None] * v
        w_hit, u_hit = hit @ WD, hit @ UD
        ray = p["obs_z"][k] - (p["obs_w"][k] - w_hit) * math.tan(ELEV)
        lit = np.clip((hit[:, 1] - ray) / 0.08 + 0.5, 0, 1)
        # the mirrored ray's angle from the sun: up-down, and sideways
        de = np.arcsin(np.clip(r[:, 1], -1, 1)) - ELEV
        dpsi = np.arctan2(r @ UD, r @ WD)
        th2 = de * de + dpsi * dpsi
        # textured glass: one facet per FACET_CELL square, tipped a little; a facet flashes
        # when its own tip lines the sun up, so the flashes travel with the rows
        iu, iw = np.floor(u_hit / FACET_CELL), np.floor(w_hit / FACET_CELL)
        h = [hash01(iu, iw, salt) for salt in range(6)]
        cu = (iu + 0.5 + (h[0] - 0.5) * 0.5) * FACET_CELL
        cw = (iw + 0.5 + (h[1] - 0.5) * 0.5) * FACET_CELL
        dot = np.exp(-((u_hit - cu) / 0.022) ** 2 - ((w_hit - cw) / 0.04) ** 2) * (h[2] < FACET_FILL)
        tip_e, tip_s = (h[3] - 0.5) * 2 * TIP_UP, (h[4] - 0.5) * 2 * TIP_SIDE
        sparkle = dot * (0.45 + 0.55 * h[5]) * np.exp(-((de + tip_e) ** 2 + (dpsi + tip_s) ** 2) / SIG_FACET ** 2)
        g = fres * lit
        gc = g * (1.5 * np.exp(-th2 / SIG_CORE ** 2) + 24.0 * sparkle)
        gh = g * 0.9 * np.exp(-th2 / SIG_HALO ** 2)
        win = rgb[y0:y1, x0:x1]
        win[sel] += gc[:, None] * np.float32([255, 244, 222]) + gh[:, None] * np.float32([255, 190, 120])
        glow = np.zeros(win.shape[:2], np.float32)
        glow[sel] = gc
        bloom = Image.fromarray(np.clip(glow * 110, 0, 255).astype(np.uint8))
        bloom = np.asarray(bloom.filter(ImageFilter.GaussianBlur(7 * SS)), np.float32) / 255
        win += bloom[..., None] * np.float32([170, 126, 72])


def hash01(a, b, salt):
    """A repeatable pseudo-random number in [0, 1) for each integer cell (a, b)."""
    h = (a.astype(np.int64) * 73856093) ^ (b.astype(np.int64) * 19349663) ^ (salt * 83492791 + 1818)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF).astype(np.float32) / float(0x1000000)


# ---------------------------------------------------------------- birds

def draw_bird(frame, x, y, span, beat):
    """A far-off bird: two wing arcs, tips raised or lowered by the beat, drawn at 4x."""
    k = 4
    sz = int(span * 1.4) + 6
    spr = Image.new("RGBA", (sz * k, sz * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(spr)
    ox, oy = sz * k / 2 + (x % 1) * k, sz * k / 2 + (y % 1) * k
    s = span * k / 2
    lift = -0.38 * beat  # tips up when positive
    pts = [(ox - s, oy + s * lift), (ox - s * 0.45, oy - s * 0.18 + s * lift * 0.35), (ox, oy + s * 0.08),
           (ox + s * 0.45, oy - s * 0.18 + s * lift * 0.35), (ox + s, oy + s * lift)]
    d.line(pts, fill=(58, 44, 46, 215), width=int(1.3 * k), joint="curve")
    spr = spr.reduce(k)
    frame.alpha_composite(spr, (int(x) - sz // 2, int(y) - sz // 2))


# ---------------------------------------------------------------- frame assembly

class Shot:
    def __init__(self):
        sky, over, refl, cl = far_layers()
        a = over[..., 3:]
        # sky and ground never move (the camera is level and they are far): cache them composited
        still = np.clip(sky * (1 - a) + over[..., :3] * a, 0, 255).astype(np.uint8)
        self.still = Image.fromarray(still).convert("RGBA")
        self.clouds = Image.fromarray(np.dstack([np.clip(cl[..., :3], 0, 255), cl[..., 3] * 255]).astype(np.uint8))
        # glass is slightly wavy: a soft reflection. Kept unclipped (half scale through the 8-bit
        # blur) so the bright glow mirrors as warm light rather than clipped yellow.
        refl = Image.fromarray(np.clip(refl / 2, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))
        self.roof = Roof(np.asarray(refl, np.float32) * 2)
        self.nb = neighbours()
        self.nb_glints = neighbour_glints()
        yy, xx = np.mgrid[0:H, 0:W]
        r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H * 0.48) / (H / 2)) ** 2
        self.vignette = (1 - 0.24 * np.clip(r2, 0, 1.6) ** 1.5)[..., None].astype(np.float32)

    def render(self, t, i):
        """Frame at time t, with frame i's grain."""
        C = cam(t)
        frame = self.still.crop((FM, 0, FM + W, H))
        # clouds drift 5 px to the right over the shot; their rows are clear of the ridge
        drift = 5.0 * t / DUR
        cl = self.clouds.transform((W, CLOUD_H), Image.AFFINE, (1, 0, FM - drift, 0, 1, 0), Image.BILINEAR)
        frame.alpha_composite(cl, (0, 0))
        for bx, by, vx, vy, span, hz, ph in BIRDS:
            beat = math.sin(2 * math.pi * hz * t + ph) * (0.55 + 0.45 * math.sin(0.9 * t + ph))
            draw_bird(frame, bx + vx * t, by + vy * t, span, beat)

        # neighbours: a little parallax, scaling about the horizon point (CX, HZ)
        dc = C - CAM0
        sc = NB_D / (NB_D - dc[2])
        sx, sy = -F * dc[0] / NB_D, F * dc[1] / NB_D
        ax = 1 / sc
        ox = NB_M + CX - (CX + sx) * ax
        oy = (HZ - NB_Y0) - (HZ - NB_Y0 + sy) * ax
        nh = self.nb.size[1]
        band = self.nb.transform((W, nh), Image.AFFINE, (ax, 0, ox, 0, ax, oy), Image.BICUBIC)
        gd = ImageDraw.Draw(band)
        m = move(t)
        for gx, gy, on in self.nb_glints:  # glints on their panels come and go with the move
            a = math.exp(-((m - on) / 0.09) ** 2)
            if a < 0.02:
                continue
            px, py = CX + (gx - CX) * sc + sx, HZ + (gy - HZ) * sc + sy - NB_Y0
            for rr, aa in ((4, 0.25), (2, 0.6), (1, 1.0)):
                gd.ellipse([px - rr, py - rr * 0.6, px + rr, py + rr * 0.6], fill=(255, 236, 200, int(200 * a * aa)))
        frame.alpha_composite(band, (0, NB_Y0))

        roof = Image.fromarray(self.roof.draw(C)).reduce(SS)
        frame.alpha_composite(roof, (0, ROOF_TOP))

        img = np.asarray(frame.convert("RGB"), np.float32)
        img *= np.float32([1.03, 1.0, 0.95])   # golden-hour warmth
        img *= self.vignette
        img += np.random.default_rng((GRAIN_SEED, i)).normal(0, 2.4, (H, W, 1)).astype(np.float32)
        return np.clip(img, 0, 255).astype(np.uint8)


def main():
    args = sys.argv[1:]
    if args and not (args[0] == "still" and len(args) == 3):
        sys.exit("usage: shot18-breather.py [still SECONDS OUT.png]")
    shot = Shot()
    if args:
        t = float(args[1])
        Image.fromarray(shot.render(t, round(t * FPS))).save(args[2])
        return
    for i in range(int(DUR * FPS)):
        sys.stdout.buffer.write(shot.render(i / FPS, i).tobytes())


if __name__ == "__main__":
    main()
