"""QWATT week 1 video, shot 1 (0:00-0:11): black, fade up on an extreme
close-up of a meter display, digits ticking, slow push-in. No logo. Under
Jay's voice-over: "This number is the only proof a small solar roof has of
what it gave the world. And right now, almost nobody can check it."

Three modes, one meter:

  (none)    horizontal 1920x1080, the original render
  vertical  1080x1920 for the vertical cut. Re-composed, not cropped: the LCD
            window is taller and sits in a dark meter housing, the push-in
            starts on "127.376" and ends with the three ticking decimals filling
            the width of the frame, clear of the right-hand platform buttons
            and above the bottom caption band. The soft kW reading above them
            gets a bigger decimal point, so it reads "3.95 kW", not "395"
  closing   shot 20 (2:55-3:00, 5.0 s), vertical, the last frame of the video:
            the same final framing as the end of the vertical shot 1, digits
            still ticking, held 4.4 s, then a hard cut to black for 0.6 s

The counter is set dressing like the bill in shot 5, not data: an illustrative
reading that runs at 4.0 kW on the video's own clock, START_KWH + KW x video
time. Shot 3 picks it up at 0:16 and the closing shot at 2:55, so it reads
4127.570 there and ticks to 4127.575 before the cut. It is not a reading from
a real meter, nor from the simulated test morning.

Writes raw RGB frames to stdout for ffmpeg. Needs numpy and Pillow. Render with:

    python3 docs/video/shot01-meter.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - \
      -f lavfi -i "sine=f=50:d=11:r=48000" -f lavfi -i "sine=f=100:d=11:r=48000" \
      -f lavfi -i "sine=f=150:d=11:r=48000" -f lavfi -i "anoisesrc=d=11:c=pink:r=48000:a=0.02" \
      -filter_complex "[1]volume=0.10[a1];[2]volume=0.06[a2];[3]volume=0.025[a3];[4]lowpass=f=900[a4];\
    [a1][a2][a3][a4]amix=inputs=4:normalize=0,afade=t=in:st=0:d=2.5,afade=t=out:st=10.6:d=0.4,volume=1.4[a]" \
      -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
      -c:a aac -b:a 192k -shortest QWATT-week1-shot01-meter.mp4

    python3 docs/video/shot01-meter.py vertical | ffmpeg -y -f rawvideo -pix_fmt rgb24 -s 1080x1920 -r 30 -i - \
      -f lavfi -i "sine=f=50:d=11:r=48000" -f lavfi -i "sine=f=100:d=11:r=48000" \
      -f lavfi -i "sine=f=150:d=11:r=48000" -f lavfi -i "anoisesrc=d=11:c=pink:r=48000:a=0.02:seed=1" \
      -filter_complex "[1]volume=0.10[a1];[2]volume=0.06[a2];[3]volume=0.025[a3];[4]lowpass=f=900[a4];\
    [a1][a2][a3][a4]amix=inputs=4:normalize=0,afade=t=in:st=0:d=2.5,afade=t=out:st=10.6:d=0.4,volume=1.4[a]" \
      -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
      -c:a aac -b:a 192k -shortest QWATT-week1-shot01-meter-vertical.mp4

    python3 docs/video/shot01-meter.py closing | ffmpeg -y -f rawvideo -pix_fmt rgb24 -s 1080x1920 -r 30 -i - \
      -f lavfi -i "sine=f=50:d=5:r=48000" -f lavfi -i "sine=f=100:d=5:r=48000" \
      -f lavfi -i "sine=f=150:d=5:r=48000" -f lavfi -i "anoisesrc=d=5:c=pink:r=48000:a=0.02:seed=20" \
      -filter_complex "[1]volume=0.10[a1];[2]volume=0.06[a2];[3]volume=0.025[a3];[4]lowpass=f=900[a4];\
    [a1][a2][a3][a4]amix=inputs=4:normalize=0,afade=t=in:st=0:d=0.3,afade=t=out:st=1.4:d=3.0,volume=1.4[a]" \
      -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
      -c:a aac -b:a 192k -shortest QWATT-week1-shot20-closing.mp4

The 50 Hz hum matches Chile's mains frequency. In the closing shot the music
resolves into it; it fades to silence by 4.4 s, where the picture cuts to black."""
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

# Vertical cut and closing shot
V_W, V_H = 1080, 1920
V_CH = 3300            # taller LCD window for the portrait frame
V_ROW_DY = 700         # counter row moved down in it; the kW status row stays on top
V_HX, V_HY = 600, 1500  # dark housing around the window
V_START_W, V_END_W = 3000.0, 1500.0  # canvas width in view, start and end of the push-in
V_DEC_FX, V_ROW_FY = 478, 860  # where the decimals end up: centred left of the platform buttons
V_KW_DOT = 64          # kW decimal point, canvas px (horizontal: 32), so "3.95 kW" keeps its point
CLOSE_DUR = 5.0
CLOSE_CUT = 4.4        # hard cut to black
CLOSE_T0 = 175.0       # video time of the closing shot (2:55), for the counter

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


def lcd_background(w=CW, h=CH):
    yy = np.linspace(0, 1, h)[:, None, None]
    bg = BG_TOP * (1 - yy) + BG_BOT * yy
    bg = np.repeat(bg, w, axis=1)
    rng = np.random.default_rng(7)
    bg += rng.normal(0, 1.6, (h, w, 1))  # faint film texture of the LCD
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


def render_panel(kwh, kw, base=None, dy=0, kw_dot=32):
    """The LCD. The vertical cut passes a taller base, moves the counter row down by dy and
    asks for a bigger kW decimal point (kw_dot, canvas px): at its wider framing the 32 px
    point vanished in the depth-of-field blur and "3.95" read as "395"."""
    img = (BASE if base is None else base).copy()
    d = ImageDraw.Draw(img, "RGBA")
    ghost = (40, 46, 36, 16)
    s = f"{kwh:0{N_INT + N_DEC + 1}.{N_DEC}f}"
    integer, dec = s.split(".")
    x = ROW_X
    row_y = ROW_Y + dy
    for i, ch in enumerate(integer + dec):
        draw_digit(d, ch, x, row_y, DW, DH, DT, SLANT, ghost, SEG_ON, 9)
        x += DW + GAP
        if i == N_INT - 1:  # decimal point
            cx = x - GAP / 2 - 6
            r = DT * 0.62
            d.ellipse([cx - r + 8, row_y + DH - 2 * r + 9, cx + r + 8, row_y + DH + 9], fill=SHADOW)
            d.ellipse([cx - r, row_y + DH - 2 * r, cx + r, row_y + DH], fill=SEG_ON)
            x += 40
    # unit "kWh" after the counter, as LCD-style segments of a smaller size
    _small_text(d, "kWh", x + 30, row_y + DH - 220, 200)

    # top row: live power, small digits + annunciators
    p = f"{kw:4.2f}"
    room = (kw_dot - 32) * 5 // 2  # a bigger point gets room of its own, taken from the left so "kW" stays put
    sx = 3300 - room
    for ch in p:
        if ch == ".":
            r, cx = kw_dot // 2, sx - 18 + room // 2  # centred between the two digits
            d.ellipse([cx - r, 552 - kw_dot, cx + r, 552], fill=SEG_ON)
            sx += room
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
    d.rounded_rectangle([210, 230, CW - 210, img.height - 260], radius=40, outline=(60, 66, 56, 90), width=10)
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


def housing_v():
    """Vertical cut: the meter's dark plastic housing around the taller window.

    Built at quarter size and scaled up: it is always out of focus."""
    w, h = CW + 2 * V_HX, V_CH + 2 * V_HY
    q = 4
    yy, xx = np.mgrid[0:h // q, 0:w // q].astype(float)
    # warm window light from the upper left, falling off across the housing
    light = 0.7 + 0.6 * np.exp(-(((xx - w / q * 0.2) / (w / q * 0.7)) ** 2 + ((yy - h / q * 0.15) / (h / q * 0.6)) ** 2))
    plastic = np.array([27, 27, 28], float) * light[..., None]
    plastic += np.random.default_rng(8).normal(0, 0.8, (h // q, w // q, 1))  # moulded texture
    img = Image.fromarray(np.clip(plastic, 0, 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = V_HX, V_HY, V_HX + CW, V_HY + V_CH
    # recessed window: a dark gasket, a lit lip where the light catches the lower edge
    d.rounded_rectangle([x0 - 110, y0 - 110, x1 + 110, y1 + 110], radius=120, fill=(46, 45, 43))
    d.rounded_rectangle([x0 - 90, y0 - 90, x1 + 90, y1 + 90], radius=100, fill=(12, 12, 13))
    d.line([(x0 - 40, y1 + 96), (x1 + 40, y1 + 96)], fill=(70, 66, 60), width=10)
    return img.filter(ImageFilter.GaussianBlur(3))


def smoothstep(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def horizontal():
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


def vertical(closing):
    """Portrait frame. closing=False: shot 1 (11 s). closing=True: shot 20 (5 s)."""
    base = Image.fromarray(lcd_background(CW, V_CH))
    housing = housing_v()
    row_cy = V_HY + V_ROW_DY + ROW_Y + DH / 2  # counter row centre on the scene canvas
    end_scale = V_W / V_END_W
    # start: centred near the decimal point; end: decimals at (V_DEC_FX, V_ROW_FY) in the frame
    sx0, sy0 = V_HX + 2950, row_cy + 40
    sx1 = V_HX + DEC_CX + (V_W / 2 - V_DEC_FX) / end_scale
    sy1 = row_cy + (V_H / 2 - V_ROW_FY) / end_scale

    yy, xx = np.mgrid[0:V_H, 0:V_W]
    nx = (xx - V_W / 2) / (V_W / 2)
    ny = (yy - V_H / 2) / (V_H / 2)
    r2 = nx ** 2 + (ny * 1.1) ** 2
    vignette = (1 - 0.30 * np.clip(r2, 0, 1.6) ** 1.6)[..., None]
    ny_col = ny[:, :1, None]
    rng = np.random.default_rng(20 if closing else 3)
    cache_key, sc = None, None

    nframes = int((CLOSE_DUR if closing else DUR) * FPS)
    for f in range(nframes):
        t = f / FPS
        if closing and t >= CLOSE_CUT:  # hard cut to black
            sys.stdout.buffer.write(bytes(V_W * V_H * 3))
            continue
        tv = CLOSE_T0 + t if closing else t  # video time drives the counter
        kwh = START_KWH + KW * tv / 3600.0
        kwh = math.floor(kwh * 1000) / 1000
        kw = round(KW + 0.06 * math.sin(tv * 1.3) + 0.03 * math.sin(tv * 3.7 + 1), 2)
        if (kwh, kw) != cache_key:
            cache_key = (kwh, kw)
            sc = housing.copy()
            sc.paste(render_panel(kwh, kw, base, V_ROW_DY, V_KW_DOT), (V_HX, V_HY))

        # Camera: the same slow geometric push-in; the closing shot holds its last framing.
        # tc keeps the handheld drift continuous from the end of shot 1 into the closing shot.
        tc = DUR + t if closing else t
        push = 1.0 if closing else smoothstep(0.0, DUR, t) * 0.75 + (t / DUR) * 0.25
        view_w = V_START_W * (V_END_W / V_START_W) ** push
        view_h = view_w * V_H / V_W
        cx = sx0 + (sx1 - sx0) * push + 10 * math.sin(tc * 0.7) + 4 * math.sin(tc * 2.3)
        cy = sy0 + (sy1 - sy0) * push + 7 * math.sin(tc * 0.9 + 2) + 3 * math.sin(tc * 2.9)
        box = (cx - view_w / 2, cy - view_h / 2, cx + view_w / 2, cy + view_h / 2)
        frame = sc.resize((V_W, V_H), Image.BICUBIC, box=box, reducing_gap=2.0)

        # Shallow depth of field: a sharp band that follows the counter row.
        # The soft copy is blurred at half size, which looks the same and costs a quarter.
        soft = frame.resize((V_W // 2, V_H // 2), Image.BILINEAR).filter(ImageFilter.GaussianBlur(4.5))
        soft = soft.resize((V_W, V_H), Image.BILINEAR)
        row_ny = ((row_cy - cy) * V_W / view_w) / (V_H / 2)
        focus = np.exp(-((ny_col - row_ny) / 0.40) ** 4)
        img = np.asarray(frame, float) * focus + np.asarray(soft, float) * (1 - focus)

        # Glass reflection drifting across (parked where shot 1 left it in the closing shot)
        band_pos = -0.6 + 0.12 * min(tc, DUR)
        band = np.exp(-((nx * 0.8 + ny * 0.45 - band_pos) / 0.35) ** 2)[..., None]
        img = img + 22 * band

        # Warm natural light, vignette, grain
        img = img * np.array([1.04, 1.0, 0.93])
        img *= vignette
        img += rng.normal(0, 3.2, (V_H, V_W, 1))
        if not closing:
            img *= smoothstep(0.8, 3.2, t)  # black, then fade up
        sys.stdout.buffer.write(np.clip(img, 0, 255).astype(np.uint8).tobytes())


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "horizontal"
    if mode == "horizontal":
        horizontal()
    elif mode in ("vertical", "closing"):
        vertical(closing=mode == "closing")
    else:
        sys.exit(f"unknown mode {mode!r}: use vertical or closing, or no argument for horizontal")


if __name__ == "__main__":
    main()
