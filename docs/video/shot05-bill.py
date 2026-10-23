"""QWATT week 1 video, shot 5 (0:23-0:30), vertical 1080x1920: an
electricity bill with one kWh figure circled, under Jay's line "Proving who
produced what costs more than the energy is worth. So the smallest producers
just get left out."

A generic net-billing bill on a desk under warm lamp light. Name, address and
account number are blurred. A terracotta marker circles the injected-energy
figure, the one number a prosumer gets, then the camera pushes in on it.
The bill is illustrative: no real utility, no real customer, and it says so in
small print at the bottom.

Writes raw RGB frames to stdout. Needs numpy and Pillow. Render with:

    python3 docs/video/shot05-bill.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 -s 1080x1920 \\
      -r 30 -i - -f lavfi -i "anoisesrc=d=7:c=brown:r=48000:a=0.03" \\
      -filter_complex "[1]lowpass=f=500,afade=t=in:st=0:d=0.1,afade=t=out:st=6.8:d=0.2[a]" \\
      -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \\
      -movflags +faststart -c:a aac -b:a 192k -shortest QWATT-week1-shot05-bill.mp4
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FPS = 30
DUR = 7.0
W, H = 1080, 1920
BW, BH = 1500, 2300  # bill, in pixels
DESK_W, DESK_H = 2000, 3000

FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
INK = (34, 38, 44)
MUTED = (110, 116, 124)
ACCENT = (58, 92, 128)  # generic utility blue, no real brand
MARKER = (176, 88, 47)  # QWATT terracotta

# where the circled figure sits on the bill; filled in by bill()
TARGET = {}


def font(path, size):
    return ImageFont.truetype(path, size)


def blurred_field(img, xy, text, f):
    """Write a fake value, then blur it beyond reading, like a privacy blur in post."""
    x, y = xy
    tmp = Image.new("RGB", (900, 90), (250, 248, 242))
    ImageDraw.Draw(tmp).text((10, 10), text, font=f, fill=INK)
    tmp = tmp.filter(ImageFilter.GaussianBlur(14))
    img.paste(tmp, (x, y))


def bill():
    rng = np.random.default_rng(4)
    paper = np.full((BH, BW, 3), (250, 248, 242), float)
    paper += rng.normal(0, 2.2, (BH, BW, 1))  # paper tooth
    img = Image.fromarray(np.clip(paper, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)
    L = 110

    d.rectangle([0, 0, BW, 190], fill=ACCENT)
    d.text((L, 52), "BOLETA DE ELECTRICIDAD", font=font(FB, 64), fill=(250, 248, 242))
    d.text((L, 128), "Distribuidora  ·  Región Metropolitana", font=font(FR, 34), fill=(214, 224, 236))

    y = 270
    lab, val = font(FR, 34), font(FB, 38)
    for label, text in (("Cliente", "Nombre Apellido Apellido"),
                        ("Dirección", "Calle Ejemplo 123, Depto 0"),
                        ("N° de cliente", "00000000-0")):
        d.text((L, y), label, font=lab, fill=MUTED)
        blurred_field(img, (L + 330, y - 12), text, val)
        y += 90

    d.text((L, y + 20), "Período", font=lab, fill=MUTED)
    d.text((L + 340, y + 16), "01-09-2026 al 30-09-2026", font=val, fill=INK)
    d.text((L, y + 90), "Tarifa", font=lab, fill=MUTED)
    d.text((L + 340, y + 86), "BT1 · Net billing (Ley 21.118)", font=val, fill=INK)
    y += 210
    d.line([(L, y), (BW - L, y)], fill=(200, 200, 196), width=3)

    y += 50
    d.text((L, y), "DETALLE DEL PERÍODO", font=font(FB, 40), fill=ACCENT)
    y += 90
    rows = [
        ("Cargo fijo", "", "$ 1.024"),
        ("Energía consumida", "312 kWh", "$ 52.416"),
        ("Energía inyectada", "186 kWh", "− $ 18.972"),
        ("Transmisión", "", "$ 3.120"),
    ]
    rf, rm = font(FR, 40), font(FM, 42)
    for label, qty, amount in rows:
        d.text((L, y), label, font=rf, fill=INK)
        if qty:
            qx = 760
            d.text((qx, y - 2), qty, font=rm, fill=INK)
            if label == "Energía inyectada":
                tw = d.textlength(qty, font=rm)
                TARGET.update(cx=qx + tw / 2, cy=y + 24, rx=tw / 2 + 60, ry=58)
        aw = d.textlength(amount, font=rm)
        d.text((BW - L - aw, y - 2), amount, font=rm, fill=INK)
        y += 100
    d.line([(L, y), (BW - L, y)], fill=(200, 200, 196), width=3)
    y += 40
    d.text((L, y), "TOTAL A PAGAR", font=font(FB, 52), fill=INK)
    tot = "$ 37.588"
    tf = font(FB, 60)
    d.text((BW - L - d.textlength(tot, font=tf), y - 6), tot, font=tf, fill=INK)

    # consumption bar chart, the kind every bill prints
    y += 160
    d.text((L, y), "Consumo últimos 6 meses (kWh)", font=font(FR, 34), fill=MUTED)
    y += 70
    vals = [348, 361, 402, 377, 330, 312]
    for i, v in enumerate(vals):
        bx = L + i * 205
        bh = v * 0.9
        d.rectangle([bx, y + 380 - bh, bx + 140, y + 380], fill=(186, 198, 212) if i < 5 else ACCENT)
    y += 470
    d.text((L, y), "Boleta ilustrativa. No corresponde a un cliente ni a una distribuidora real.",
           font=font(FR, 28), fill=MUTED)
    return img


def marker_points(progress):
    """A hand-drawn ellipse: a little more than one lap, with wobble and overshoot."""
    cx, cy, rx, ry = TARGET["cx"], TARGET["cy"], TARGET["rx"], TARGET["ry"]
    total = 2 * math.pi * 1.12
    n = max(2, int(140 * progress))
    pts = []
    for i in range(n):
        a = -2.6 + total * progress * i / (n - 1)
        wob = 1 + 0.05 * math.sin(a * 3.1 + 0.7) + 0.03 * math.sin(a * 7.3)
        drift = 10 * (a + 2.6) / total  # second lap lands slightly off the first
        pts.append((cx + rx * wob * math.cos(a) + drift, cy + ry * wob * math.sin(a) - drift * 0.4))
    return pts


def desk():
    yy, xx = np.mgrid[0:DESK_H, 0:DESK_W].astype(float)
    grain = np.sin(xx / 9 + np.sin(yy / 140) * 3) * 6 + np.sin(xx / 37) * 4
    base = np.array([92, 66, 48], float)
    lamp = 0.55 + 0.6 * np.exp(-(((xx - DESK_W * 0.35) / 1100) ** 2 + ((yy - DESK_H * 0.25) / 1300) ** 2))
    img = (base + grain[..., None]) * lamp[..., None]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")


def smooth(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return x * x * (3 - 2 * x)


def main():
    paper = bill()
    table = desk()
    angle = -3.0
    ox, oy = (DESK_W - BW) // 2, (DESK_H - BH) // 2 - 60
    # where the target lands on the desk after rotation about the bill centre
    a = math.radians(angle)
    dx, dy = TARGET["cx"] - BW / 2, TARGET["cy"] - BH / 2
    tx = ox + BW / 2 + dx * math.cos(a) + dy * math.sin(a)
    ty = oy + BH / 2 - dx * math.sin(a) + dy * math.cos(a)

    shadow = Image.new("L", (DESK_W, DESK_H), 0)
    ImageDraw.Draw(shadow).rectangle([ox + 30, oy + 50, ox + BW + 30, oy + BH + 50], fill=150)
    shadow = shadow.rotate(angle, center=(DESK_W / 2, DESK_H / 2), resample=Image.BICUBIC)
    shadow = shadow.filter(ImageFilter.GaussianBlur(40))
    table = Image.composite(Image.new("RGB", table.size, (20, 12, 8)), table, shadow)

    yy, xx = np.mgrid[0:H, 0:W]
    r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    vignette = (1 - 0.30 * np.clip(r2, 0, 1.6) ** 1.4)[..., None]
    grain_rng = np.random.default_rng(6)
    last_p, scene = None, None
    for i in range(int(DUR * FPS)):
        t = i / FPS
        p = round(smooth(1.0, 2.3, t), 3)  # marker circles the figure between 1.0 and 2.3 s
        if p != last_p:
            last_p = p
            sheet = paper.copy().convert("RGBA")
            if p > 0:
                ink = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
                ImageDraw.Draw(ink).line(marker_points(p), fill=(*MARKER, 225), width=13, joint="curve")
                sheet = Image.alpha_composite(sheet, ink.filter(ImageFilter.GaussianBlur(0.8)))
            layer = Image.new("RGBA", table.size, (0, 0, 0, 0))
            layer.paste(sheet, (ox, oy))
            layer = layer.rotate(angle, center=(DESK_W / 2, DESK_H / 2), resample=Image.BICUBIC)
            scene = table.copy()
            scene.paste(layer, (0, 0), layer)

        # camera: whole bill, then a push-in that settles on the circled figure
        z = smooth(1.6, 6.6, t)
        view_h = 2700 * (1 - z) + 1120 * z
        view_w = view_h * W / H
        cx = DESK_W / 2 + (tx - DESK_W / 2) * z + 6 * math.sin(t * 0.9)
        cy = DESK_H / 2 - 40 + (ty - DESK_H / 2 + 40) * z + 5 * math.sin(t * 1.3 + 1)
        box = (cx - view_w / 2, cy - view_h / 2, cx + view_w / 2, cy + view_h / 2)
        frame = scene.resize((W, H), Image.LANCZOS, box=box)

        # depth of field grows as the camera closes in
        if z > 0.05:
            soft = frame.filter(ImageFilter.GaussianBlur(2 + 7 * z))
            ny = (yy - H / 2) / (H / 2)
            focus = np.exp(-(ny / (1.6 - 1.1 * z)) ** 4)[..., None]
            img = np.asarray(frame, float) * focus + np.asarray(soft, float) * (1 - focus)
        else:
            img = np.asarray(frame, float)
        img = img * np.array([1.05, 1.0, 0.92])  # warm lamp
        img *= vignette
        img += grain_rng.normal(0, 2.6, (H, W, 1))
        sys.stdout.buffer.write(np.clip(img, 0, 255).astype(np.uint8).tobytes())


if __name__ == "__main__":
    main()
