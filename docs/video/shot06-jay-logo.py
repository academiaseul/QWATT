"""QWATT week 1 video, shot 6 (0:30-0:37), vertical 1080x1920: back on Jay to
camera on the rooftop for "Diego and I started QWATT so that a small roof can
prove its work as cleanly as a power plant can." The QWATT logo fades in small,
top-left corner. The music lift happens in the edit; there is no audio here.

Jay's footage is real and has to be filmed (the founders shoot it vertically); this
renders only what goes around it:

  overlay       the logo alone, with transparency, in paper with a soft shadow so it
                reads on bright sky and on darker roofs (default)
  overlay-navy  the logo alone in its own colours, no shadow, for bright backgrounds
  plate         a stand-in rooftop with a framing guide where Jay stands, plus the
                paper logo, for a rough cut until the real take exists

The logo is keyed from logo.png, never redrawn. That file is opaque: navy and
terracotta ink on off-white. Each pixel is unmixed into "how much navy, how much
terracotta"; their sum is the alpha and the colour comes from the inks alone, so
edges keep their anti-aliasing and carry no white fringe. The mark is cropped to
its bounding box and scaled by the same factor on both axes.

Vertical-platform safe zones are kept clear: the right 140 px (Shorts buttons), the
bottom 420 px (title and captions) and the top 120 px (status and search bar).
The logo sits just inside the top-left corner.

Writes raw RGBA frames to stdout. Needs numpy and Pillow. Render with:

    python3 docs/video/shot06-jay-logo.py overlay | ffmpeg -y -f rawvideo -pix_fmt rgba \\
      -s 1080x1920 -r 30 -i - -vf scale=out_color_matrix=bt709:out_range=tv \\
      -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -colorspace bt709 \\
      -color_primaries bt709 -color_trc bt709 QWATT-week1-shot06-logo-overlay.mov
    python3 docs/video/shot06-jay-logo.py overlay-navy | ffmpeg -y -f rawvideo -pix_fmt rgba \\
      -s 1080x1920 -r 30 -i - -vf scale=out_color_matrix=bt709:out_range=tv \\
      -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -colorspace bt709 \\
      -color_primaries bt709 -color_trc bt709 QWATT-week1-shot06-logo-overlay-navy.mov
    python3 docs/video/shot06-jay-logo.py plate | ffmpeg -y -f rawvideo -pix_fmt rgba \\
      -s 1080x1920 -r 30 -i - -vf scale=out_color_matrix=bt709:out_range=tv \\
      -c:v libx264 -crf 18 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 \\
      -color_trc bt709 -movflags +faststart QWATT-week1-shot06-placeholder.mp4
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FPS = 30
DUR = 7.0
W, H = 1080, 1920

# no important graphics inside these margins on vertical platforms
SAFE_TOP, SAFE_RIGHT, SAFE_BOTTOM = 120, 140, 420

LOGO_PNG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "logo.png")
LOGO_W = 172              # width of the mark (Q + wordmark); the height follows the source
LOGO_X, LOGO_Y = 72, 152  # top-left of the mark once it has settled
DRIFT = 10                # px it rises while fading in
FADE_IN = (0.5, 1.3)      # s, ease-out
FADE_OUT = (6.6, DUR - 1 / FPS)  # s; the last frame is fully clear for a clean cut
PAD = 48                  # transparent margin around the mark: room for drift and shadow

PAPER = (250, 248, 242)
ESPRESSO = (22, 16, 10)
SHADOW = (12, 16, 22)     # cool near-black under the paper logo
# (down offset px, blur sigma px, opacity): a tight contact shadow plus a wide soft one
SHADOW_PASSES = ((1.5, 1.6, 0.45), (3.0, 7.0, 0.22))

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_BOOK = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def ease(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return 1 - (1 - x) ** 3  # ease-out cubic


def smooth(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return x * x * (3 - 2 * x)


def opacity(t):
    return ease(*FADE_IN, t) * (1 - smooth(*FADE_OUT, t))


def key_logo():
    """Key logo.png into two coverage maps, navy ink and terracotta ink.

    Every pixel is background + n * (navy - background) + b * (bolt - background);
    n and b, solved by least squares, are how much of each ink covers it. The inks
    never touch and the fit leaves under 3 levels of residual for all but ~100 of
    the file's 1.57 M pixels (max ~5), so this is exact up to the file's own noise.
    Returns the maps zero-padded so the resampling box can reach past the mark, the
    mark's bounding box in them, the scale that makes it LOGO_W wide, and both ink
    colours.
    """
    a = np.asarray(Image.open(LOGO_PNG).convert("RGB"), float)
    border = np.concatenate([a[:40].reshape(-1, 3), a[-40:].reshape(-1, 3),
                             a[:, :40].reshape(-1, 3), a[:, -40:].reshape(-1, 3)])
    bg = np.median(border, 0)  # ~ (254, 254, 254)
    dist = np.linalg.norm(a - bg, axis=-1)
    warm = a[..., 0] - a[..., 2]
    navy = np.median(a[(dist > 200) & (warm < 0)], 0)   # ~ (31, 46, 61), #1f2e3d
    bolt = np.median(a[(dist > 120) & (warm > 60)], 0)  # ~ (204, 104, 69), #cc6845

    basis = np.stack([navy - bg, bolt - bg], 1)
    cov = np.linalg.lstsq(basis, (a - bg).reshape(-1, 3).T, rcond=None)[0]
    n, b = (np.clip(c, 0, None).reshape(a.shape[:2]) for c in cov)
    # levels: paper noise (under 2 %) to clear, solid ink (over 92 %) to opaque
    total = n + b
    alpha = np.clip((total - 0.02) / 0.90, 0, 1)
    share = np.divide(n, total, out=np.ones_like(total), where=total > 0)
    n, b = alpha * share, alpha * (1 - share)

    ys, xs = np.nonzero(alpha)
    box = [xs.min(), ys.min(), xs.max() + 1, ys.max() + 1]
    scale = LOGO_W / (box[2] - box[0])
    # canvas margin and drift, plus 24 source px (~6 px on the canvas) for the canvas
    # rounding up and the filter's reach; PIL refuses a box that leaves the array
    m = int(math.ceil((PAD + DRIFT) / scale)) + 24
    n, b = (np.pad(c, m).astype(np.float32) for c in (n, b))
    return {"n": n, "b": b, "box": [v + m for v in box], "scale": scale,
            "navy": navy, "bolt": bolt}


def canvas_size(key):
    x0, y0, x1, y1 = key["box"]
    s = key["scale"]
    return int(math.ceil((x1 - x0) * s)) + 2 * PAD, int(math.ceil((y1 - y0) * s)) + 2 * PAD


def place(cov, key, dy):
    """Resample a full-size coverage map onto the logo canvas, scaled by the same
    factor on both axes and shifted down by dy px (sub-pixel, so the drift is smooth)."""
    x0, y0, _, _ = key["box"]
    s = key["scale"]
    cw, ch = canvas_size(key)
    src = (x0 - PAD / s, y0 - (PAD + dy) / s, x0 + (cw - PAD) / s, y0 + (ch - PAD - dy) / s)
    # Hamming, not Lanczos: Lanczos overshoots inside the strokes, and once clipped the
    # held mark is left up to 4 % short of opaque in places. Hamming stays in 0..1 here.
    out = Image.fromarray(cov, "F").resize((cw, ch), Image.HAMMING, box=src)
    return np.clip(np.asarray(out, float), 0, 1)


def blur_matrix(size, sigma, shift=0.0):
    """Gaussian blur along one axis as a matrix, moving the content by +shift px."""
    i = np.arange(size, dtype=float)
    k = np.exp(-0.5 * ((i[:, None] - i[None, :] - shift) / sigma) ** 2)
    return k / (sigma * math.sqrt(2 * math.pi))


def drop_shadow(alpha):
    out = np.zeros_like(alpha)
    ch, cw = alpha.shape
    for down, sigma, strength in SHADOW_PASSES:
        s = blur_matrix(ch, sigma, down) @ alpha @ blur_matrix(cw, sigma).T
        out = 1 - (1 - out) * (1 - strength * np.clip(s, 0, 1))
    return out


def logo_layer(key, dy, variant):
    """Straight-alpha RGB and alpha of the logo canvas, the mark dy px below its rest."""
    n, b = place(key["n"], key, dy), place(key["b"], key, dy)
    total = n + b
    alpha = np.clip(total, 0, 1)
    ink = np.array(PAPER, float) if variant == "paper" else key["navy"]
    # colour is a mix of the two inks only, never the paper the logo was printed on
    rgb = (n[..., None] * ink + b[..., None] * key["bolt"]) / np.maximum(total, 1e-6)[..., None]
    if variant == "paper":
        sh = drop_shadow(alpha) * (1 - alpha)  # the part of the shadow the logo leaves visible
        out = alpha + sh
        rgb = (rgb * alpha[..., None] + np.array(SHADOW, float) * sh[..., None]) \
            / np.maximum(out, 1e-6)[..., None]
        alpha = out
    return rgb, alpha


def rooftop_plate():
    """Vertical stand-in plate, larger than the frame so the camera can drift: the same
    late-afternoon roof as shot02's plate, re-composed for 9:16. Sky above Jay's head,
    the Andes and the city behind his shoulders, a small roof with three rows of panels
    below."""
    pw, ph = W + 120, H + 120
    hz = ph * 0.43  # foot of the mountains
    yy, xx = np.mgrid[0:ph, 0:pw].astype(float)
    # late-afternoon sky: pale blue above, warming toward the horizon (as in shot02)
    v = np.clip(0.55 * yy / hz, 0, 1)
    sky = np.stack([
        150 + 105 * v ** 1.4, 175 + 60 * v ** 1.4, 205 - 40 * v ** 1.2,
    ], axis=-1)
    # low sun off to the right, so its glow sits beside the guide box, not under it
    sun = np.exp(-(((xx - pw * 0.92) / 240) ** 2 + ((yy - (hz - 240)) / 220) ** 2))
    sky += sun[..., None] * np.array([90, 60, 10])
    img = Image.fromarray(np.clip(sky, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img, "RGBA")

    # Andes silhouette on the horizon
    rng = np.random.default_rng(11)
    pts, x = [(0, ph)], 0
    while x < pw + 40:
        pts.append((x, hz + rng.normal(0, 4) - 70 * math.sin(x / 380) ** 2 - 40 * math.sin(x / 150 + 1) ** 2))
        x += 18
    pts.append((pw, ph))
    d.polygon(pts, fill=(118, 112, 128, 255))

    vx, vy = pw * 0.5, hz + 40  # vanishing point of the roof
    near = ph * 1.04 - vy       # perspective scale: depth k sits at y = vy + near * k
    edge = vy + near * 0.16     # far edge of the roof (parapet)

    # the city beyond the parapet: three layers of low blocks, hazier the farther they are
    d.rectangle([0, vy - 10, pw, edge], fill=(170, 150, 143, 255))
    for top, tone, haze in ((vy - 4, (164, 146, 142), 70), (vy + 30, (150, 134, 131), 45),
                            (vy + 70, (136, 123, 121), 0)):
        x = rng.uniform(-60, 0)
        while x < pw:
            bw = rng.uniform(40, 150)
            d.rectangle([x, top + rng.uniform(0, 40), x + bw, edge], fill=(*tone, 255))
            x += bw + rng.uniform(0, 30)
        d.rectangle([0, vy - 10, pw, edge], fill=(205, 170, 140, haze))
    # the haze band where the city meets the mountains (as in shot02)
    d.rectangle([0, hz + 10, pw, vy + 40], fill=(205, 170, 140, 90))

    # roof deck and its parapet
    d.polygon([(0, edge), (pw, edge), (pw, ph), (0, ph)], fill=(150, 140, 128, 255))
    d.rectangle([0, edge - 6, pw, edge + 4], fill=(178, 168, 156, 255))

    # a utility box on the deck, left of Jay: says "building roof", gives the scale
    k0, k1 = 1 / 2.5, 1 / 3.0  # depth of its front and back faces
    bx0, bx1, bh = -1150, -880, 300
    fy, by = vy + near * k0, vy + near * k1
    d.polygon([(vx + bx0 * k0, fy - bh * k0), (vx + bx1 * k0, fy - bh * k0),
               (vx + bx1 * k1, by - bh * k1), (vx + bx0 * k1, by - bh * k1)], fill=(196, 188, 176, 255))
    d.polygon([(vx + bx1 * k0, fy), (vx + bx1 * k0, fy - bh * k0),
               (vx + bx1 * k1, by - bh * k1), (vx + bx1 * k1, by)], fill=(150, 144, 136, 255))
    d.rectangle([vx + bx0 * k0, fy - bh * k0, vx + bx1 * k0, fy], fill=(172, 164, 152, 255))

    # three rows of eight panels, an even pitch apart, off to the right of Jay so they
    # show beside him: a roof-sized array that visibly ends, not a field
    for z in (3.3, 2.6, 1.9):  # distance of each row's front edge; far rows first
        ka = 1 / z          # scale of the row's front edge
        kb = 1 / (z + 0.5)  # and of its back edge
        y_near, y_top = vy + near * ka, vy + near * kb
        for c in range(-2, 6):
            xa = vx + (c * 230 - 102.5) * ka
            xb = xa + 205 * ka
            quad = [(xa, y_near), (xb, y_near), (vx + (xb - vx) * kb / ka, y_top), (vx + (xa - vx) * kb / ka, y_top)]
            d.polygon(quad, fill=(28, 40, 62, 255), outline=(170, 175, 185, 255))
            for k in range(1, 4):  # cell grid
                f = k / 4
                d.line([(quad[0][0] + (quad[1][0] - quad[0][0]) * f, y_near),
                        (quad[3][0] + (quad[2][0] - quad[3][0]) * f, y_top)], fill=(70, 85, 110, 255), width=1)
            # sun glint on the glass
            d.polygon(quad, fill=(255, 210, 150, int(40 + 30 * (c % 3 == 0))))
    return img.filter(ImageFilter.GaussianBlur(2.0))  # shallow depth of field behind Jay


def guide(d, ink):
    """Where Jay stands: centred, eyes on the upper-third line, head well below the logo."""
    gx, gy = W // 2, H // 3
    d.rectangle([gx - 300, gy - 200, gx + 300, H + 10], outline=ink, width=3)
    d.line([(gx - 30, gy), (gx + 30, gy)], fill=ink, width=3)
    d.line([(gx, gy - 30), (gx, gy + 30)], fill=ink, width=3)
    return gx, gy


def guide_shade():
    """Soft dark shadow under the guide lines, so they hold on the sun glow and pale sky.
    It is fixed in the frame, like the guide, so it is built once."""
    m = Image.new("L", (W, H), 0)
    guide(ImageDraw.Draw(m), 255)
    m = m.transform(m.size, Image.AFFINE, (1, 0, -1, 0, 1, -2))  # 1 px right, 2 px down
    return m.filter(ImageFilter.GaussianBlur(2.5)).point(lambda a: int(a * 0.5))


def plate_frame(base, shade, t):
    ox = 60 + 16 * math.sin(t * 0.5) + 4 * math.sin(t * 2.3)  # handheld: slow sway, a little shake
    oy = 60 + 10 * math.sin(t * 0.7 + 1) + 3 * math.sin(t * 2.9)
    frame = base.resize((W, H), Image.BILINEAR, box=(ox, oy, ox + W, oy + H))
    frame.paste(ESPRESSO, (0, 0, W, H), shade)
    d = ImageDraw.Draw(frame, "RGBA")
    gx, gy = guide(d, (*PAPER, 200))
    # the label on the same espresso pill as the placeholder notice: pale sky is no backing
    f = ImageFont.truetype(FONT_BOLD, 30)
    x0, y0, x1, y1 = d.textbbox((gx - 272, gy - 182), "JAY: to camera", font=f)
    d.rounded_rectangle([x0 - 12, y0 - 9, x1 + 12, y1 + 9], radius=8, fill=(*ESPRESSO, 120))
    d.text((gx - 272, gy - 182), "JAY: to camera", font=f, fill=(*PAPER, 230))
    # placeholder notice, just above the caption zone
    s = ImageFont.truetype(FONT_BOOK, 24)
    label = "PLACEHOLDER · replace with real footage"
    lw = d.textlength(label, font=s)
    lx, ly = (W - lw) / 2, H - SAFE_BOTTOM - 60
    d.rounded_rectangle([lx - 16, ly - 10, lx + lw + 16, ly + 38], radius=8, fill=(*ESPRESSO, 120))
    d.text((lx, ly), label, font=s, fill=(*PAPER, 220))
    return frame


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "overlay"
    if mode not in ("overlay", "overlay-navy", "plate"):
        sys.exit("usage: shot06-jay-logo.py [overlay | overlay-navy | plate]")
    key = key_logo()
    assert LOGO_Y >= SAFE_TOP and LOGO_X + LOGO_W <= W - SAFE_RIGHT
    variant = "navy" if mode == "overlay-navy" else "paper"
    base = rooftop_plate() if mode == "plate" else None
    shade = guide_shade() if mode == "plate" else None
    cw, ch = canvas_size(key)
    cx, cy = LOGO_X - PAD, LOGO_Y - PAD
    layers = {}  # by drift, so the held logo is built once
    frame = np.zeros((H, W, 4), np.uint8)
    for i in range(int(DUR * FPS)):
        t = i / FPS
        dy = round(DRIFT * (1 - ease(*FADE_IN, t)), 2)
        if dy not in layers:
            layers[dy] = logo_layer(key, dy, variant)
        rgb, alpha = layers[dy]
        alpha = alpha * opacity(t)
        if base is None:
            a8 = np.rint(alpha * 255).astype(np.uint8)
            # fully clear pixels stay black, so the file is safe even if read as premultiplied
            rgb8 = np.where(a8[..., None] > 0, np.clip(np.rint(rgb), 0, 255), 0).astype(np.uint8)
            frame[cy:cy + ch, cx:cx + cw] = np.dstack([rgb8, a8])
        else:
            img = np.array(plate_frame(base, shade, t), float)
            region = img[cy:cy + ch, cx:cx + cw]
            img[cy:cy + ch, cx:cx + cw] = rgb * alpha[..., None] + region * (1 - alpha[..., None])
            frame = np.dstack([np.clip(np.rint(img), 0, 255).astype(np.uint8),
                               np.full((H, W), 255, np.uint8)])
        sys.stdout.buffer.write(frame.tobytes())


if __name__ == "__main__":
    main()
