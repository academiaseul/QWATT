"""QWATT week 1 video, shot 14 (1:23-1:31), vertical 1080x1920: under Diego's
"Every record also keeps a fingerprint of the raw data it came from, so anyone
can check we translated honestly."

One interval record, pretty-printed in full on a dark card, and the raw bytes
its fingerprint covers.

  0.0-1.2 s  the record card rises in, its lines arriving top to bottom a frame
             or so apart; the source line "interval record · simulated test
             data" fades in under it
  2.0 s      the raw_sha256 field (wrapped onto two lines) is marked in
             terracotta, with a soft glow; everything else steps back
  2.8-4.5 s  the camera pans down the card to the hash
  3.0-4.6 s  a thin line runs from the highlight down to a small second card,
             "raw payload (register frames)", which rises in at 4.3 s with its
             rows two frames apart: the first six Modbus TCP response frames the
             hash covers, "… 84 more frames", and the sha256 of all of them
  5.5 s      caption card "Anyone can re-check the translation"; hold to 8.0 s

What is real: everything inside both cards is produced at render time by this
repo's code. FINGERPRINT_JS (below) runs the acceptance harness, ingest/harness.js
run(), unchanged: the same two simulated hours of bench data from synthDay()
(12:00-14:00 Santiago, fixed seed), all three paths, the same byte-identical
comparison. While it runs, two IntervalBuilder methods are wrapped so they can
be watched (each calls the original and changes nothing):
push() keeps a copy of every raw payload the modbus path hands it, and _close()
keeps every record the modbus path closes. The script takes the first one (seq 0,
15:00-15:05Z), checks that the harness passed, that the gate engine accepts this
interval (assets/qwatt-gates.js, bench profile), and that sha256 over the kept
payloads, in order, equals the record's raw_sha256. A payload is the reply frames
of one poll concatenated (pollOnce in ingest/adapters/modbus.js); it is split into
frames at the MBAP length field, the same way ModbusTcp._onData reads them. That
is the definition in ingest/README.md, "raw_sha256": the reply frames of every
poll in the interval, whole MBAP frames, in order; requests are not hashed. The
record card is JSON.stringify(record, null, 2): every key and value, in the order
the builder emits them. The 64-character hash is wrapped after 32 characters,
the continuation aligned under its first character; nothing is cut. In the hex,
the 9 header bytes of each frame (MBAP header, unit, function, byte count) are
muted and the register data is bright; "a" and "b" are the record's meter keys.
The frame count, byte count and "1 of 24" are counted from the run. The colours
are a light syntax colouring done here, not an editor.

With the repo at ec5f99d (the same as at 5b02798) the record reads:

    seq 0, ts 2026-09-20T15:00:00.000Z-15:05:00.000Z, dt_s 300
    a pzem-017:1    dc  mwh 9180  samples 30  mw_mean 110227
    b epever-tracer:2  dc  mwh 9041  samples 30  mw_mean 108553
    source modbus-tcp, register_map pzem-017@1+epever-tracer@2
    raw_sha256 7833c575043462907344b90904fa74953033c9f09082a50d0e4442c53b76d37a
    = sha256 of 90 frames, 2,130 bytes (60 polls: 30 of meter a, 30 of meter b)

and the first frame (meter a, PZEM-017 at unit 1) is
000100000013010410071c0284049400000000000000000000.

The data is the harness's simulated bench data on a simulated Modbus bus, and the
source line says so: no live meter, no real roof. What is generated: the
background, the cards, the connector, the motion and the grain. No meter, desk,
person or other product's interface is drawn. The audio is a near-silent bed:
low room tone, three soft air swishes (card in, pan, second card) and one soft
tick on the highlight; peak -23.4 dBFS, mono, as measured. Music comes in the edit.

Vertical-platform safe zones are kept clear: the top 120 px, the right 140 px and
the bottom 420 px. The pan carries the record's first lines, read and dimmed by
then, up to the top edge; above y=200 the frame melts back into the background, so
the top band stays clean. Colour is converted and tagged as BT.709.

Writes raw RGB frames to stdout. Needs node, numpy and Pillow. Render from the
repo root with:

    python3 docs/video/shot14-fingerprint.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1080x1920 -r 30 -i - \\
      -f lavfi -i "anoisesrc=d=8:c=brown:r=48000:a=0.02:seed=14" \\
      -f lavfi -i "anoisesrc=d=0.7:c=pink:r=48000:a=0.1:seed=41" \\
      -f lavfi -i "aevalsrc='(0.06*sin(2*PI*880*t)+0.025*sin(2*PI*1760*t))*exp(-38*t)*(1-exp(-2500*t))':d=0.3:s=48000" \\
      -filter_complex "[1]lowpass=f=300,afade=t=in:st=0:d=0.3,afade=t=out:st=7.5:d=0.5[bed];\\
    [2]highpass=f=700,lowpass=f=2600,afade=t=in:st=0:d=0.14,afade=t=out:st=0.14:d=0.56,\\
    asplit=3[w0][w1][w2];[w1]adelay=2800:all=1,volume=0.7[w1d];\\
    [w2]adelay=4300:all=1,volume=0.6[w2d];[3]lowpass=f=3000,adelay=2000:all=1[tk];\\
    [bed][w0][w1d][w2d][tk]amix=inputs=5:normalize=0:duration=first[a]" \\
      -map 0:v -map "[a]" -vf scale=out_color_matrix=bt709:out_range=tv \\
      -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -color_primaries bt709 \\
      -color_trc bt709 -colorspace bt709 -movflags +faststart -c:a aac -b:a 192k \\
      -t 8 QWATT-week1-shot14-fingerprint.mp4
"""
import hashlib
import json
import math
import os
import re
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FPS = 30
DUR = 8.0
W, H = 1080, 1920
SS = 2  # cards are drawn at 2x and resampled each frame (subpixel pan and push-in)

ESPRESSO = (22, 16, 10)
COFFEE = (41, 29, 19)
PAPER = (250, 248, 242)
TERRACOTTA = (176, 88, 47)
TERRA_LIGHT = (208, 138, 87)
EDGE = (64, 48, 34)  # 1 px card border
MUTED = (150, 130, 110)

# light syntax colouring on coffee, brand colours only (as shot 13)
KEY = (226, 216, 202)
STR = TERRA_LIGHT
NUM = PAPER
PUNCT = (140, 118, 98)
ELLIPSIS = (178, 158, 138)
DIM = 0.45  # what is left of a line's contrast once it steps back
BAND = (118, 61, 34)  # highlighter: terracotta pressed into the coffee card
HOT = {KEY: PAPER, NUM: PAPER, STR: (246, 214, 186), PUNCT: (214, 168, 138)}
HEX_HEAD = (128, 108, 90)  # frame header bytes, muted
HEX_DATA = (238, 230, 218)  # register data

FS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FMB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# The harness, run unchanged; two IntervalBuilder methods are wrapped to watch the
# modbus path (each calls the original). Prints one JSON line on stdout.
FINGERPRINT_JS = r"""
const crypto = require('crypto');
const { IntervalBuilder } = require('./ingest/lib/normalize');
const harness = require('./ingest/harness');
const G = require('./assets/qwatt-gates.js');
const SPEC = require('./assets/gates.generated.js');
const push = IntervalBuilder.prototype.push, close = IntervalBuilder.prototype._close;
const raw = new Map(), closed = [];
IntervalBuilder.prototype.push = function (meter, sample, payload) {
  if (this.adapter === 'modbus-tcp') {
    const k = this.gridIndex(sample.ts);
    if (!raw.has(k)) raw.set(k, []);
    raw.get(k).push({ meter, payload: Buffer.from(payload) });
  }
  return push.call(this, meter, sample, payload);
};
IntervalBuilder.prototype._close = function (k) {
  const record = close.call(this, k);
  if (this.adapter === 'modbus-tcp') closed.push({ k, record });
  return record;
};
const print = console.log;
console.log = (...a) => console.error(...a);  // the harness's own summary line goes to stderr
harness.run().then((diffs) => {
  if (diffs) throw new Error('harness reported ' + diffs + ' differences');
  const { k, record } = closed[0];
  const verdict = G.evaluateInterval(record, SPEC.profiles.bench, SPEC).verdict;
  if (verdict !== 'accept') throw new Error('first modbus interval: ' + verdict);
  const h = crypto.createHash('sha256'), frames = [];
  let bytes = 0;
  for (const { meter, payload } of raw.get(k)) {
    h.update(payload);
    bytes += payload.length;
    for (let o = 0; o < payload.length;) {
      const n = 6 + payload.readUInt16BE(o + 4);  // MBAP length field: bytes after byte 6
      frames.push({ meter, hex: payload.subarray(o, o + n).toString('hex') });
      o += n;
    }
  }
  const sha = h.digest('hex');
  if (sha !== record.source.raw_sha256) throw new Error('raw_sha256 does not recompute');
  print(JSON.stringify({ record, verdict, intervals: closed.length, polls: raw.get(k).length,
    bytes, frames, sha256: sha }));
}).catch((e) => { console.error(e); process.exit(1); });
"""

# record card, in canvas px at scale 1 (canvas = frame before the pan)
CARD_X, CARD_W = 36, 896  # right edge 932, inside the 940 safe line through the push-in
CARD_Y = 200
TAB_H, ROW_H, PAD_TOP, PAD_BOT = 60, 33, 18, 16
CODE_PX = 26
TEXT_X = 30
ADV = CODE_PX * 1233 / 2048  # DejaVu Mono advance
MAX_CHARS = int((CARD_W - TEXT_X - 14) // ADV)
WRAP = 32  # hex characters on the first line of the wrapped hash
MARGIN = 44  # transparent border around a card layer, room for its shadow and glow

# raw payload card: indented under the record, joined to the hash by the connector
SEC_X, SEC_W = 96, 836
SEC_GAP = 70  # between the record card's bottom and this card's tab
SEC_TAB_H, SEC_PAD_TOP, SEC_ROW_H, SEC_PAD_BOT = 54, 14, 32, 18
HEX_PX = 24
SHOW_FRAMES = 6  # two polls: meter a, then meter b's two blocks
LINK_X = CARD_X + 13  # the connector leaves the highlight's terracotta bar, straight down

# camera: slow push-in about a point right of centre (the right edges stay out of
# the platform buttons), and one eased pan down the card to the hash
ANCHOR = (800, 1200)
S0, S1 = 1.0, 1.02
PAN = 460
TOP_FADE = (60, 200)  # frame px: background above 60, the shot untouched below 200

# timings, in seconds
CARD_T = (0.0, 1.0)  # rise of the record card
RISE = 90
ROW_T0, ROW_STEP, ROW_LEN = 0.12, 0.02, 0.3  # its lines, top to bottom
SRC_T = (0.9, 1.4)
HL_T0, HL_STEP, HL_LEN = 2.0, 0.07, 0.4  # highlighter, hash line by line
DIM_T = (2.0, 2.6)
GLOW_T = (2.1, 2.8)
PAN_T = (2.8, 4.5)
LINK_T = (3.0, 4.6)
SEC_T = (4.3, 5.0)
SEC_RISE = 30
SEC_ROW_T0, SEC_ROW_STEP = 4.4, 2 / FPS
CAP_T = (5.5, 6.0)
CAPTION = "Anyone can re-check the translation"
CAP_Y = 1440  # caption card centre, frame px; bottom edge stays above the 420 px band
SOURCE = "interval record · simulated test data"

TOKEN = re.compile(r'"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]|\s+|.')


def font(path, px):
    return ImageFont.truetype(path, int(px * SS))


def ease(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return 1 - (1 - x) ** 3  # ease-out cubic


def smooth(a, b, t):
    x = min(max((t - a) / (b - a), 0.0), 1.0)
    return x * x * (3 - 2 * x)


def P(v):
    return int(round(v * SS))


# ── the data ──────────────────────────────────────────────────────────────

def load_fingerprint():
    out = subprocess.run(["node", "-e", FINGERPRINT_JS], cwd=REPO, check=True,
                         capture_output=True, text=True).stdout
    data = json.loads(out)
    joined = b"".join(bytes.fromhex(f["hex"]) for f in data["frames"])
    # the frames are exactly the bytes that were hashed, and nothing else
    assert len(joined) == data["bytes"]
    assert hashlib.sha256(joined).hexdigest() == data["record"]["source"]["raw_sha256"] == data["sha256"]
    return data


def spans(line):
    """Split one line into coloured spans; a string followed by ':' is a key."""
    out = []
    for m in TOKEN.finditer(line):
        s = m.group()
        if s.startswith('"'):
            kind = KEY if re.match(r"\s*:", line[m.end():]) else STR
        elif s[0] in "-0123456789" and s != "-":
            kind = NUM
        elif s in ("true", "false", "null"):
            kind = NUM
        elif s.isspace():
            kind = None
        else:
            kind = PUNCT
        out.append((s, kind))
    return out


def split_spans(sp, at):
    """Cut a span list at character index `at`."""
    left, right, n = [], [], 0
    for s, k in sp:
        if n + len(s) <= at:
            left.append((s, k))
        elif n >= at:
            right.append((s, k))
        else:
            left.append((s[:at - n], k))
            right.append((s[at - n:], k))
        n += len(s)
    return left, right


def record_rows(record):
    """The record as JSON.stringify(record, null, 2), coloured; the raw_sha256 line
    wrapped after WRAP hex characters. Returns rows and the indices of the hash rows."""
    rows, hot = [], []
    for line in json.dumps(record, indent=2, ensure_ascii=False).split("\n"):
        sp = spans(line)
        if line.lstrip().startswith('"raw_sha256"'):
            col = line.index(': "') + 3  # first hex character
            a, b = split_spans(sp, col + WRAP)
            hot += [len(rows), len(rows) + 1]
            rows += [a, [(" " * col, None)] + b]
        else:
            rows.append(sp)
    # honesty guard: every line fits whole, nothing is cut, nothing is added
    assert all(sum(len(s) for s, _ in r) <= MAX_CHARS for r in rows), "a record line would be cut"
    assert "".join(s for r in rows for s, _ in r).replace(" ", "") == \
        json.dumps(record, indent=2, ensure_ascii=False).replace(" ", "").replace("\n", "")
    return rows, hot


# ── layers ────────────────────────────────────────────────────────────────

def card_shell(w, h, tab_h, title, title_px, meta):
    """Premultiplied-ready RGBA card at SS: folder-style tab with title, body,
    shadow, 1 px edge; meta text outside the tab, on the right. As shot 13."""
    lw, lh = (w + 2 * MARGIN) * SS, (h + 2 * MARGIN) * SS
    o = MARGIN * SS
    f_title, f_meta = font(FB, title_px), font(FS, 23)
    tab_w = (22 + 10 + 14) * SS + f_title.getlength(title) + 24 * SS
    sil = Image.new("L", (lw, lh), 0)
    d = ImageDraw.Draw(sil)
    d.rounded_rectangle([o, o, o + tab_w, o + P(tab_h + 24)], radius=P(16), fill=255)
    d.rounded_rectangle([o, o + P(tab_h), o + P(w), o + P(h)], radius=P(20), fill=255)
    d.rectangle([o, o + P(tab_h), o + P(30), o + P(tab_h + 30)], fill=255)
    r = P(14)  # concave fillet where the tab meets the top edge
    d.rectangle([o + tab_w, o + P(tab_h) - r, o + tab_w + r, o + P(tab_h)], fill=255)
    d.ellipse([o + tab_w, o + P(tab_h) - 2 * r, o + tab_w + 2 * r, o + P(tab_h)], fill=0)

    shadow = Image.new("L", (lw, lh), 0)
    shadow.paste(sil, (0, P(14)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(P(16)))
    edge = Image.fromarray(np.asarray(sil) - np.asarray(sil.filter(ImageFilter.MinFilter(3))))

    base = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    base.paste(Image.new("RGBA", (lw, lh), (0, 0, 0, 255)), (0, 0),
               shadow.point(lambda v: int(v * 0.6)))
    base.paste(Image.new("RGBA", (lw, lh), (*COFFEE, 255)), (0, 0), sil)
    base.paste(Image.new("RGBA", (lw, lh), (*EDGE, 255)), (0, 0), edge)

    d = ImageDraw.Draw(base)
    by = o + P(tab_h / 2 + title_px * 0.37)
    sq = title_px * 0.34
    d.rectangle([o + P(22), by - P(title_px * 0.63), o + P(22 + sq), by - P(title_px * 0.63 - sq)],
                fill=(*TERRACOTTA, 255))
    d.text((o + P(22 + 10 + 14), by), title, font=f_title, fill=(*PAPER, 255), anchor="ls")
    d.text((o + P(w - 6), by - P(4)), meta, font=f_meta, fill=(*MUTED, 255), anchor="rs")
    return base, sil, o


def mix(c, amount):
    return tuple(int(round(COFFEE[i] + (c[i] - COFFEE[i]) * amount)) for i in range(3))


def record_layers(rows, hot, meta):
    card_h = TAB_H + PAD_TOP + len(rows) * ROW_H + PAD_BOT
    base, sil, o = card_shell(CARD_W, card_h, TAB_H, "interval record", 30, meta)
    f_reg, f_bold = font(FM, CODE_PX), font(FMB, CODE_PX)
    adv = f_reg.getlength("0")
    row_y = [o + P(TAB_H + PAD_TOP + i * ROW_H) for i in range(len(rows))]
    band = [o + P(10), row_y[hot[0]], o + P(CARD_W - 10), row_y[hot[-1]] + P(ROW_H) - 1]

    # soft glow around the marked lines, kept inside the card
    gmask = Image.new("L", base.size, 0)
    ImageDraw.Draw(gmask).rectangle(band, fill=255)
    gmask = gmask.filter(ImageFilter.GaussianBlur(P(14)))
    gmask = Image.fromarray((np.asarray(gmask, np.float32) * 0.75
                             * (np.asarray(sil, np.float32) / 255)).astype(np.uint8))

    def draw(state):
        img = base.copy()
        if state == "empty":
            return np.asarray(img.convert("RGBa"))
        after = state == "after"
        if after:
            img.paste(Image.new("RGBA", img.size, (*TERRACOTTA, 255)), (0, 0), gmask)
        d = ImageDraw.Draw(img)
        for i, row in enumerate(rows):
            on = after and i in hot
            if on:  # highlighter band and a solid bar at the left edge
                d.rectangle([band[0], row_y[i], band[2], row_y[i] + P(ROW_H) - 1], fill=(*BAND, 255))
                d.rectangle([band[0], row_y[i], o + P(16), row_y[i] + P(ROW_H) - 1],
                            fill=(*TERRACOTTA, 255))
            cx, cy = o + P(TEXT_X), row_y[i] + P(ROW_H / 2)
            for s, kind in row:
                if kind is not None:
                    col = HOT.get(kind, kind) if on else kind
                    if after and not on:
                        col = mix(col, DIM)
                    d.text((cx, cy), s, font=f_bold if on else f_reg, fill=(*col, 255), anchor="lm")
                cx += adv * len(s)
        return np.asarray(img.convert("RGBa"))

    c = {
        "empty": draw("empty"), "plain": draw("plain"), "after": draw("after"),
        "rows": [(y, y + P(ROW_H)) for y in row_y], "hot": hot, "o": o, "h": card_h,
        "band_bottom": TAB_H + PAD_TOP + (hot[-1] + 1) * ROW_H,  # card px
    }
    c["still"] = {k: rgba_image(c[k]) for k in ("plain", "after")}  # the two resting states
    return c


def payload_layers(data):
    """The second card: the first frames the hash covers, the count of the rest,
    and sha256 over all of them."""
    frames = data["frames"]
    n_rows = SHOW_FRAMES + 3  # frames, "… more", footer label, footer hash
    sec_h = SEC_TAB_H + SEC_PAD_TOP + n_rows * SEC_ROW_H + 14 + 8 + SEC_PAD_BOT
    base, sil, o = card_shell(SEC_W, sec_h, SEC_TAB_H, "raw payload (register frames)", 26,
                              data["record"]["source"]["adapter"])
    img = base.copy()
    d = ImageDraw.Draw(img)
    f_hex, f_lab = font(FM, HEX_PX), font(FMB, HEX_PX)
    f_note, f_foot, f_sha = font(FM, HEX_PX - 2), font(FS, 23), font(FMB, 26)
    f_eq = font(FM, 22)
    adv = f_hex.getlength("0")
    tx = o + P(28)
    bounds, y = [], SEC_TAB_H + SEC_PAD_TOP
    for f in frames[:SHOW_FRAMES]:
        cy = o + P(y + SEC_ROW_H / 2)
        raw = bytes.fromhex(f["hex"])
        assert raw[7] == 4, "a normal function-4 reply"
        head = 18  # 9 bytes: MBAP header (7), function code, byte count
        d.text((tx, cy), f["meter"], font=f_lab, fill=(*TERRA_LIGHT, 255), anchor="lm")
        x = tx + adv * 2
        d.text((x, cy), f["hex"][:head], font=f_hex, fill=(*HEX_HEAD, 255), anchor="lm")
        d.text((x + adv * head, cy), f["hex"][head:], font=f_hex, fill=(*HEX_DATA, 255), anchor="lm")
        assert 28 + (2 + len(f["hex"])) * adv / SS < SEC_W - 14, "frame row too wide"
        bounds.append((y, y + SEC_ROW_H))
        y += SEC_ROW_H
    more = len(frames) - SHOW_FRAMES
    d.text((tx + adv * 2, o + P(y + SEC_ROW_H / 2)), f"… {more} more frames", font=f_note,
           fill=(*ELLIPSIS, 255), anchor="lm")
    bounds.append((y, y + SEC_ROW_H))
    y += SEC_ROW_H + 14
    d.line([(tx, o + P(y)), (o + P(SEC_W - 28), o + P(y))], fill=(*EDGE, 255), width=P(1.5))
    y += 8
    d.text((tx, o + P(y + SEC_ROW_H / 2)),
           f"sha256 over all {len(frames)} frames · {data['bytes']:,} bytes", font=f_foot,
           fill=(*MUTED, 255), anchor="lm")
    bounds.append((y, y + SEC_ROW_H))
    y += SEC_ROW_H
    sha = data["sha256"]
    cy = o + P(y + SEC_ROW_H / 2 + 2)
    d.text((tx, cy), sha[:WRAP] + "…", font=f_sha, fill=(*TERRA_LIGHT, 255), anchor="lm")
    d.text((o + P(SEC_W - 28), cy), "= raw_sha256", font=f_eq, fill=(*MUTED, 255), anchor="rm")
    bounds.append((y, y + SEC_ROW_H + 8))
    return {
        "empty": np.asarray(base.convert("RGBa")), "full": np.asarray(img.convert("RGBa")),
        "still": img.convert("RGBa"),
        "rows": [(o + P(a), o + P(b)) for a, b in bounds], "h": sec_h, "o": o,
    }


def caption_layer():
    f = font(FB, 36)
    tw = f.getlength(CAPTION)
    cw, ch = tw / SS + 2 * 32, 76
    m = 30
    lw, lh = int((cw + 2 * m) * SS), int((ch + 2 * m) * SS)
    sil = Image.new("L", (lw, lh), 0)
    ImageDraw.Draw(sil).rounded_rectangle([m * SS, m * SS, (m + cw) * SS, (m + ch) * SS],
                                          radius=16 * SS, fill=255)
    shadow = Image.new("L", (lw, lh), 0)
    shadow.paste(sil, (0, 10 * SS))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14 * SS)).point(lambda v: int(v * 0.6))
    img = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    img.paste(Image.new("RGBA", (lw, lh), (0, 0, 0, 255)), (0, 0), shadow)
    img.paste(Image.new("RGBA", (lw, lh), (*TERRACOTTA, 255)), (0, 0), sil)
    ImageDraw.Draw(img).text(((m + cw / 2) * SS, (m + ch / 2) * SS), CAPTION, font=f,
                             fill=(*PAPER, 255), anchor="mm")
    return img.convert("RGBa"), m, cw, ch


def source_layer():
    f = font(FS, 24)
    w = int(f.getlength(SOURCE)) + 4 * SS
    img = Image.new("RGBA", (w, 40 * SS), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((2 * SS, 20 * SS), SOURCE, font=f, fill=(*ELLIPSIS, 255), anchor="lm")
    return img.convert("RGBa")


def background():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    lift = np.exp(-(((xx - CARD_X - CARD_W / 2) / 760) ** 2 + ((yy - 860) / 1000) ** 2))
    r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    img = np.array(ESPRESSO, np.float32) + lift[..., None] * np.array([12, 9, 6], np.float32)
    return img * (1 - 0.22 * np.clip(r2, 0, 1.6) ** 1.3)[..., None]


def rgba_image(a):
    return Image.frombytes("RGBa", (a.shape[1], a.shape[0]), a.tobytes())


def place(frame, im, x, y, k, alpha=1.0, blur=0.0):
    """Composite a premultiplied (RGBa) SS layer with its top-left at (x, y) frame
    px, scaled by k frame px per layer px. Subpixel exact: the resample box carries
    the fraction. blur: vertical motion blur, px covered while the shutter is open."""
    lw, lh = im.size
    ix0, iy0 = math.ceil(x), math.ceil(y)
    ix1, iy1 = math.floor(x + lw * k), math.floor(y + lh * k)
    box = ((ix0 - x) / k, (iy0 - y) / k, (ix1 - x) / k, (iy1 - y) / k)
    a = np.asarray(im.resize((ix1 - ix0, iy1 - iy0), Image.LANCZOS, box=box), np.float32)
    a = a * (alpha / 255.0)
    n = int(round(blur))
    if n >= 2:  # vertical box over the distance covered while the shutter is open
        p = np.pad(a, ((n, n), (0, 0), (0, 0)))
        c = np.concatenate([np.zeros_like(p[:1]), np.cumsum(p, axis=0)], axis=0)
        a = (c[n:] - c[:-n]) / n
        iy0 -= (n + 1) // 2
    h, w = a.shape[:2]
    fx0, fy0, fx1, fy1 = max(ix0, 0), max(iy0, 0), min(ix0 + w, W), min(iy0 + h, H)
    if fx1 <= fx0 or fy1 <= fy0:
        return
    a = a[fy0 - iy0:fy1 - iy0, fx0 - ix0:fx1 - ix0]
    dst = frame[fy0:fy1, fx0:fx1]
    dst *= 1 - a[..., 3:]
    dst += a[..., :3] * 255.0


def mix_rows(a, b, bounds, vals):
    """Per-row mix of two premultiplied states: vals[i] is a scalar or an x-ramp."""
    out = a.copy()
    for (y0, y1), v in zip(bounds, vals):
        if np.ndim(v) == 0 and v <= 0:
            continue
        p, q = a[y0:y1].astype(np.float32), b[y0:y1].astype(np.float32)
        m = v if np.ndim(v) == 0 else v[None, :, None]
        out[y0:y1] = np.clip(p + (q - p) * m + 0.5, 0, 255).astype(np.uint8)
    return out


def record_now(c, t):
    """The record card's pixels at time t: lines arriving, plain, marked, or mid-way."""
    n = len(c["rows"])
    if t < ROW_T0 + (n - 1) * ROW_STEP + ROW_LEN:
        vals = [smooth(ROW_T0 + i * ROW_STEP, ROW_T0 + i * ROW_STEP + ROW_LEN, t) for i in range(n)]
        return rgba_image(mix_rows(c["empty"], c["plain"], c["rows"], vals))
    starts = {r: HL_T0 + j * HL_STEP for j, r in enumerate(c["hot"])}
    dim = smooth(*DIM_T, t)
    glow = smooth(*GLOW_T, t)
    prog = {r: smooth(s, s + HL_LEN, t) for r, s in starts.items()}
    if dim == 0 and all(p == 0 for p in prog.values()):
        key = "plain"
    elif dim == 1 and glow == 1 and all(p == 1 for p in prog.values()):
        key = "after"
    else:
        key = None
    if key:
        return c["still"][key]
    w = c["plain"].shape[1]
    xs = np.arange(w, dtype=np.float32)
    feather = 60.0
    x_a, x_b = c["o"] + 10 * SS, c["o"] + (CARD_W - 10) * SS
    vals = []
    for r in range(n):
        if r in prog:
            thr = x_a + prog[r] * (x_b - x_a + feather)
            vals.append(np.clip((thr - xs) / feather, 0, 1) * (0.6 + 0.4 * glow))
        else:
            vals.append(dim * (0.85 + 0.15 * glow))
    return rgba_image(mix_rows(c["plain"], c["after"], c["rows"], vals))


def payload_now(c, t):
    n = len(c["rows"])
    vals = [smooth(SEC_ROW_T0 + i * SEC_ROW_STEP, SEC_ROW_T0 + i * SEC_ROW_STEP + 0.3, t)
            for i in range(n)]
    if all(v == 1 for v in vals):
        return c["still"]
    return rgba_image(mix_rows(c["empty"], c["full"], c["rows"], vals))


def link_path(band_bottom, sec_y):
    """The connector in canvas px: down from the highlight's bar (band_bottom, card px),
    a rounded corner, then right into the side of the second card's tab."""
    x0, y0 = LINK_X, CARD_Y + band_bottom
    y1 = sec_y + SEC_TAB_H / 2
    x1 = SEC_X - 3
    r = 16
    pts = [(x0, y0 + (y1 - r - y0) * i / 40) for i in range(41)]
    pts += [(x0 + r - r * math.cos(a), y1 - r + r * math.sin(a))
            for a in np.linspace(0, math.pi / 2, 12)[1:]]
    pts += [(x0 + r + (x1 - x0 - r) * i / 8, y1) for i in range(1, 9)]
    return pts


def trim(pts, frac):
    """The first `frac` of a polyline, by length."""
    seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    goal, out = sum(seg) * frac, [pts[0]]
    for i, s in enumerate(seg):
        if goal >= s:
            out.append(pts[i + 1])
            goal -= s
        else:
            f = goal / s if s else 0
            out.append((pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
                        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f))
            break
    return out


def draw_link(frame, pts, s, start_a, end_r):
    """Antialiased connector and its two dots, drawn at 4x on a small patch."""
    q = 4
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    bx0, by0 = int(min(xs)) - 14, int(min(ys)) - 14
    bx1, by1 = int(max(xs)) + 15, int(max(ys)) + 15
    bx0, by0, bx1, by1 = max(bx0, 0), max(by0, 0), min(bx1, W), min(by1, H)
    if bx1 <= bx0 or by1 <= by0:
        return
    m = Image.new("L", ((bx1 - bx0) * q, (by1 - by0) * q), 0)
    d = ImageDraw.Draw(m)
    loc = [((x - bx0) * q, (y - by0) * q) for x, y in pts]
    if len(loc) > 1:
        d.line(loc, fill=255, width=int(round(3 * s * q)), joint="curve")
    r0 = 5.5 * s * q * start_a
    if r0 > 0:
        d.ellipse([loc[0][0] - r0, loc[0][1] - r0, loc[0][0] + r0, loc[0][1] + r0], fill=255)
    if end_r > 0:
        r1 = 6.5 * s * q * end_r
        d.ellipse([loc[-1][0] - r1, loc[-1][1] - r1, loc[-1][0] + r1, loc[-1][1] + r1], fill=255)
    a = np.asarray(m.resize((bx1 - bx0, by1 - by0), Image.BOX), np.float32)[..., None] / 255.0
    dst = frame[by0:by1, bx0:bx1]
    dst *= 1 - a
    dst += a * np.array(TERRA_LIGHT, np.float32)


def main():
    data = load_fingerprint()
    rows, hot = record_rows(data["record"])
    rec = record_layers(rows, hot, f"modbus path · 1 of {data['intervals']}")
    sec = payload_layers(data)
    sec_y = CARD_Y + rec["h"] + SEC_GAP
    src = source_layer()
    cap, cap_m, cap_w, cap_h = caption_layer()
    path = link_path(rec["band_bottom"], sec_y)
    bg = background()
    # top band: what the pan carries up melts back into the background
    y0, y1 = TOP_FADE
    fade = np.array([1 - smooth(y0, y1, y) for y in range(y1)], np.float32)[:, None, None]
    rng = np.random.default_rng(14)

    for i in range(int(DUR * FPS)):
        t = i / FPS
        frame = bg.copy()
        s = S0 + (S1 - S0) * t / DUR  # constant, slow push-in
        pan = PAN * smooth(*PAN_T, t)
        v_pan = PAN * (smooth(*PAN_T, t) - smooth(*PAN_T, t - 1 / FPS))

        def cam(x, y):
            return ANCHOR[0] + (x - ANCHOR[0]) * s, ANCHOR[1] + (y - ANCHOR[1]) * s - pan

        # the record card rises in, lines arriving top to bottom
        e = ease(*CARD_T, t)
        v = RISE * (ease(*CARD_T, t) - ease(*CARD_T, t - 1 / FPS))
        x, y = cam(CARD_X - MARGIN, CARD_Y - MARGIN + RISE * (1 - e))
        place(frame, record_now(rec, t), x, y, s / SS, alpha=smooth(0.0, 0.45, t),
              blur=0.5 * (v + v_pan) * s)

        # source line, under the card on the right
        a = smooth(*SRC_T, t)
        if a > 0:
            sx, sy = cam(CARD_X + CARD_W - src.size[0] / SS - 4, CARD_Y + rec["h"] + 10)
            place(frame, src, sx, sy, s / SS, alpha=a, blur=0.5 * v_pan * s)

        # connector from the highlight to the second card
        lk = smooth(*LINK_T, t)
        if lk > 0:
            pts = [cam(px, py) for px, py in trim(path, lk)]
            draw_link(frame, pts, s, smooth(LINK_T[0], LINK_T[0] + 0.25, t),
                      ease(LINK_T[1] - 0.1, LINK_T[1] + 0.2, t))

        # the raw payload card
        se = ease(*SEC_T, t)
        if se > 0:
            vs = SEC_RISE * (ease(*SEC_T, t) - ease(*SEC_T, t - 1 / FPS))
            x, y = cam(SEC_X - MARGIN, sec_y - MARGIN + SEC_RISE * (1 - se))
            place(frame, payload_now(sec, t), x, y, s / SS, alpha=smooth(SEC_T[0], SEC_T[0] + 0.4, t),
                  blur=0.5 * (vs + v_pan) * s)

        # caption, in frame space
        ce = ease(*CAP_T, t)
        if ce > 0:
            cx = CARD_X + CARD_W / 2 - cap_w / 2 - cap_m
            cy = CAP_Y - cap_h / 2 - cap_m + 22 * (1 - ce)
            place(frame, cap, cx, cy, 1 / SS, alpha=smooth(CAP_T[0], CAP_T[0] + 0.35, t))

        frame[:y1] += (bg[:y1] - frame[:y1]) * fade
        frame += rng.standard_normal((H, W, 1), dtype=np.float32) * 2.2  # film grain
        sys.stdout.buffer.write(np.clip(frame + 0.5, 0, 255).astype(np.uint8).tobytes())


if __name__ == "__main__":
    main()
