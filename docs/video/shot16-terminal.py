"""QWATT week 1 video, shot 16 (1:40-1:57), vertical 1080x1920: the proof
moment. Diego types the test command and presses Enter, the real output comes
out at the speed it really printed, and the harness line is frozen and
highlighted, under "So here's the test. One simulated solar morning, two meters,
720 readings, sent down all three roads." ... "Byte-identical. Every path, the
same answer, down to the last character."

  0.0-0.4 s   a terminal card, prompt and blinking cursor; music is fully out
  0.4-2.6 s   "node ingest/ingest.test.js" types in one keystroke at a time, in
              bursts (a beat after "node ", small hesitations before "/" and "."),
              one key sound each
  2.72 s      Enter. The captured output appears line by line at the times it
              really printed, counted from the moment node was started: 32 lines
              in 0.44 s. The view glides after the newest line like a
              smooth-scrolling terminal (eased in and out, motion blur while it
              moves) and settles at 4.2 s with the harness line in view
  3.16 s      node exits; the next prompt, cursor blinking
  10.0 s      freeze: the cursor goes, the harness line gets a terracotta bar,
              row by row three frames apart, and everything else steps back; a
              very slow push-in on it begins (1.0 to 1.025 by 17.0 s)
  10.0-12.0   total silence (in fact silent from 3.0 s to the end, as measured)
  12.3 s      the summary line brightens and is underlined; hold to 17.0 s

What is real: every character of output on the card is a line from one genuine
run of `node ingest/ingest.test.js`, kept verbatim. The capture mode of this
script made that run under a pseudo-terminal, from the repo root, and stored
every line with its time since spawn in shot16-terminal.capture.json, next to
this file, along with the sha256 of the raw tty bytes, node's version, the
commit, whether ingest/ had uncommitted changes and a sha256 over every file in
ingest/. The render reads only that file: it re-checks the tty sha256 against
the stored lines, requires exit code 0, finds the harness line and the summary
line by their shape, and stops if any of that fails, so an edited, failing or
different run can never be dressed up as this one. Re-capture with

    python3 docs/video/shot16-terminal.py capture          # repo root, working tree
    python3 docs/video/shot16-terminal.py capture 3fce885  # a git archive of a commit

The run in the capture file: 2026-10-23T04:22:16Z, node v22.22.0, linux x86_64,
commit 3fce885 with ingest/ clean, exit 0 after 0.44 s. A clean git archive of
3fce885 prints the same 32 lines. It prints 26 test lines, then

    harness: 720 samples × 2 meters → 24 intervals per path · 24/24 accepted ·
    240.9 Wh basis · BYTE-IDENTICAL across csv, http, modbus

and "26 passed, 0 failed". The storyboard's "21 passed, 0 failed" is what
98b281a prints (21 tests); later commits added tests. The harness line is the
same at both commits. The test data is the harness's simulated morning (fixed
seed) on a simulated Modbus bus, and the label "Test data: simulated" stays on
screen: no live meter, no real roof.

What is styled here, not printed: the card, its tab, the "$" prompt (a stand-in
for any shell's), the cursor, the terracotta check marks, the bold weight on
the bar and the revealed summary, the wrapping (44 columns, word breaks that
keep "·"/"→" phrases whole, a hanging indent of 4 under a test name and 2 under
anything else; a break replaces one space and nothing is cut, reordered or
abbreviated, which the render asserts), the dimming, the bar, the underline and
the camera. The summary line is drawn dimmed from the moment it prints and
brightened at 12.3 s: a change of emphasis on text that genuinely printed, never
a change of its content. The frozen frame is the terminal's real final state.
No person, hand, meter, desk or other product's interface is drawn.

Audio: keystrokes only, made with ffmpeg's aevalsrc from the same key times as
the picture (`keys` mode prints the source): a short filtered noise click with a
low thock per key and a softer release tick, a heavier Enter, and digital
silence everywhere else. Mono, peak -15.0 dBFS as measured. Music returns in
the edit.

Vertical-platform safe zones are kept clear: nothing in the top 120 px, the
right 140 px (text, bar and label stay left of x = 940 at full push-in; only the
card's empty right margin passes it) or the bottom 420 px (the card ends at
1462). Colour is converted and tagged as BT.709.

Writes raw RGB frames to stdout. Needs numpy and Pillow (node only to capture).
Render from the repo root with:

    python3 docs/video/shot16-terminal.py | ffmpeg -y -f rawvideo -pix_fmt rgb24 \\
      -s 1080x1920 -r 30 -i - -f lavfi -i "$(python3 docs/video/shot16-terminal.py keys)" \\
      -map 0:v -map 1:a -vf scale=out_color_matrix=bt709:out_range=tv \\
      -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -color_primaries bt709 \\
      -color_trc bt709 -colorspace bt709 -movflags +faststart -c:a aac -b:a 192k \\
      -t 17 QWATT-week1-shot16-terminal.mp4
"""
import datetime
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
DUR = 17.0
W, H = 1080, 1920
SS = 2  # the card is drawn at 2x and resampled each frame

ESPRESSO = (22, 16, 10)
COFFEE = (41, 29, 19)
PAPER = (250, 248, 242)
TERRACOTTA = (176, 88, 47)
TERRA_LIGHT = (208, 138, 87)
EDGE = (64, 48, 34)  # 1 px card border
MUTED = (150, 130, 110)
TEXT = (226, 216, 202)  # output text on coffee
DIM = 0.32  # what is left of a line's contrast once it steps back
SUM_DIM = 0.36  # the summary line until its reveal

FS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FM = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FMB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
CAPTURE = os.path.join(HERE, "shot16-terminal.capture.json")
COMMAND = ["node", "ingest/ingest.test.js"]
TYPED = " ".join(COMMAND)
HARNESS = re.compile(r"^harness: .* · BYTE-IDENTICAL across csv, http, modbus$")
SUMMARY = re.compile(r"^\d+ passed, \d+ failed$")
LABEL = "Test data: simulated"

# card, in frame px: right edge on the 940 safe line, bottom above the 420 px band
CARD_X, CARD_Y, CARD_W = 36, 196, 904
TAB_H = 58
CODE_PX = 32
ADV = CODE_PX * 1233 / 2048  # DejaVu Mono advance
COLS = 44
TEXT_X = 30  # first column, from the card's left edge
ROW_H = 46
ROWS = 25  # visible rows
WIN_PAD = 18  # above the first and below the last visible row; edges fade here
WIN_X, WIN_Y = TEXT_X - 22, TAB_H + 10  # window, from the card's top-left
WIN_W, WIN_H = COLS * ADV + 44, ROWS * ROW_H + 2 * WIN_PAD
CARD_H = WIN_Y + WIN_H + 12
MARGIN = 44  # transparent border around the card layer, room for its shadow
LABEL_RIGHT = 922  # frame px; keeps the label inside the safe line at full push-in

# timings, in seconds
KEY_T = (0.40, 2.60)  # first and last character
ENTER_T = 2.72
BLINK = 0.53
SCROLL_V, SCROLL_A = 1.5, 0.2  # view glide: rows per frame, rows per frame per frame
FREEZE_T = 10.0
CURSOR_OUT = (FREEZE_T, FREEZE_T + 0.25)
DIM_T = (FREEZE_T, FREEZE_T + 0.5)
BAND_T0, BAND_LEN, BAND_STEP = FREEZE_T, 0.36, 3 / FPS  # bar, row by row
GLOW_T = (FREEZE_T + 0.3, FREEZE_T + 0.9)
REVEAL_T = (12.3, 12.75)
UNDER_T = (12.4, 12.95)
PUSH_T, PUSH = (FREEZE_T, DUR), 1.025
ANCHOR_X = 560  # push-in centre, frame px; y is the bar's centre


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


# ── the capture ───────────────────────────────────────────────────────────

def git(*args, cwd=REPO):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True).stdout


def capture(rev=None):
    """One genuine run under a pseudo-terminal, every line with its time since
    spawn. Writes CAPTURE; prints the transcript to stderr."""
    import pty
    import select
    import shutil
    import tempfile
    import time

    cwd, tmp = REPO, None
    if rev:  # a clean tree of that commit, as ingest/capture-evidence.js does
        tmp = tempfile.mkdtemp(prefix="qwatt-shot16-")
        subprocess.run(["tar", "-x", "-C", tmp], input=git("archive", rev), check=True)
        cwd = tmp
    files = sorted(os.path.relpath(os.path.join(dp, f), cwd)
                   for dp, _, fs in os.walk(os.path.join(cwd, "ingest")) for f in fs)
    tree = hashlib.sha256()
    for f in files:  # what ran: path and sha256 of every file under ingest/
        with open(os.path.join(cwd, f), "rb") as fh:
            tree.update(f"{f}\0{hashlib.sha256(fh.read()).hexdigest()}\n".encode())
    node = subprocess.run(["node", "--version"], check=True, capture_output=True,
                          text=True).stdout.strip()

    master, slave = pty.openpty()
    t0 = time.monotonic()
    proc = subprocess.Popen(COMMAND, cwd=cwd, stdin=slave, stdout=slave, stderr=slave)
    os.close(slave)
    raw, buf, lines = b"", b"", []
    while True:
        ready, _, _ = select.select([master], [], [], 30)
        if not ready:
            proc.kill()
            raise SystemExit("capture: no output for 30 s")
        try:
            chunk = os.read(master, 65536)
        except OSError:  # EIO: the child closed the terminal
            chunk = b""
        if not chunk:
            break
        t = time.monotonic() - t0
        raw += chunk
        buf += chunk
        while b"\r\n" in buf:  # the tty turns every "\n" into "\r\n"
            line, buf = buf.split(b"\r\n", 1)
            lines.append({"t": round(t, 4), "text": line.decode("utf-8")})
    code = proc.wait()
    t_exit = time.monotonic() - t0
    os.close(master)
    if tmp:
        shutil.rmtree(tmp)
    assert not buf, "output did not end with a newline"

    dirty = git("status", "--porcelain", "--", "ingest").decode().splitlines() if not rev else []
    data = {
        "command": TYPED,
        "cwd": f"git archive {rev}" if rev else "repo root (working tree)",
        "commit": git("rev-parse", rev or "HEAD").decode().strip(),
        "ingest_uncommitted": dirty,
        "ingest_diff_sha256": hashlib.sha256(git("diff", "HEAD", "--", "ingest")).hexdigest()
        if dirty else None,
        "ingest_files_sha256": tree.hexdigest(),
        "node": node,
        "platform": f"{sys.platform} {os.uname().machine}",
        "captured_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "captured_with": "python3 docs/video/shot16-terminal.py capture" + (f" {rev}" if rev else ""),
        "timing": "t = seconds from spawning node to reading the line's newline from the tty",
        "exit_code": code,
        "exit_t": round(t_exit, 4),
        "tty_bytes": len(raw),
        "tty_sha256": hashlib.sha256(raw).hexdigest(),
        "lines": lines,
    }
    with open(CAPTURE, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    for ln in lines:
        print(f"{ln['t']:8.4f}  {ln['text']}", file=sys.stderr)
    print(f"exit {code} at {t_exit:.4f} s -> {CAPTURE}", file=sys.stderr)


def load_capture():
    with open(CAPTURE, encoding="utf-8") as fh:
        data = json.load(fh)
    raw = "".join(ln["text"] + "\r\n" for ln in data["lines"]).encode("utf-8")
    assert hashlib.sha256(raw).hexdigest() == data["tty_sha256"], "capture edited after the run"
    assert data["command"] == TYPED and data["exit_code"] == 0
    texts = [ln["text"] for ln in data["lines"]]
    assert sum(bool(HARNESS.match(s)) for s in texts) == 1, "no single harness line in the capture"
    assert sum(bool(SUMMARY.match(s)) for s in texts) == 1, "no single summary line in the capture"
    return data


# ── rows: the transcript wrapped for a vertical frame ─────────────────────

SEPS = ("·", "→")


def wrap(text):
    """Word-wrap at COLS with a hanging indent; returns (indent, piece) rows.
    Phrases stay whole where they can: after a "·" or "→" the row breaks if the
    next phrase would not fit and the row is a third full. No row starts with a
    separator. A break replaces exactly one space; nothing else changes."""
    if len(text) <= COLS:
        return [(0, text)]
    hang = 4 if text[:4] in ("  ✓ ", "  ✗ ") else 2
    lead = len(text) - len(text.lstrip(" "))
    words = text[lead:].split(" ")
    words[0] = text[:lead] + words[0]

    def phrase(n):  # words[n] up to the next separator, or to the end
        k = n
        while k < len(words) - 1 and not words[k].endswith(SEPS):
            k += 1
        return len(" ".join(words[n:k + 1]))

    rows, row, ind = [], [words[0]], 0
    for n in range(1, len(words)):
        width, used = COLS - ind, len(" ".join(row))
        w = words[n]
        full = used + 1 + len(w) > width
        at_sep = row[-1].endswith(SEPS) and used >= width / 3 and used + 1 + phrase(n) > width
        if full or at_sep:
            nxt = [w]
            if w in ("·", "→", "×") and len(row) > 1:  # keep a separator off the row's start
                nxt.insert(0, row.pop())
            rows.append((ind, " ".join(row)))
            row, ind = nxt, hang
        else:
            row.append(w)
    rows.append((ind, " ".join(row)))
    assert all(len(p) + i <= COLS for i, p in rows), f"cannot wrap {text!r}"
    assert " ".join(p for _, p in rows) == text  # verbatim: only spaces became breaks
    return rows


def build_rows(data):
    """Every row on the card, in order: (kind, indent, text, t_appear)."""
    rows = [("cmd", 0, "", 0.0)]  # the typed command; drawn live
    for ln in data["lines"]:
        s, t = ln["text"], ENTER_T + ln["t"]
        kind = ("harness" if HARNESS.match(s) else "summary" if SUMMARY.match(s)
                else "test" if s[:4] in ("  ✓ ", "  ✗ ") else "plain")
        for k, (ind, piece) in enumerate(wrap(s)):
            rows.append((kind if k == 0 else kind + "+", ind, piece, t))
    rows.append(("prompt", 0, "", ENTER_T + data["exit_t"]))  # the shell's next prompt
    return rows


def key_times():
    """Keystroke times: bursts, a beat after the space, hesitations before / and ."""
    rng = np.random.default_rng(16)
    gaps = []
    for prev, ch in zip(TYPED, TYPED[1:]):
        g = 0.075 * math.exp(rng.normal(0, 0.3))
        if prev == " ":
            g += 0.17
        if ch in "/.":
            g += 0.05
        gaps.append(g)
    k = (KEY_T[1] - KEY_T[0]) / sum(gaps)
    return list(KEY_T[0] + np.concatenate([[0], np.cumsum(gaps) * k]))


# ── layers ────────────────────────────────────────────────────────────────

def strip(spans, bold=False):
    """One row of text at SS as premultiplied colour and alpha, float32."""
    f = font(FMB if bold else FM, CODE_PX)
    w, h = P(COLS * ADV + 4), P(ROW_H)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x = 0
    for s, col in spans:
        d.text((x, h / 2 + P(1)), s, font=f, fill=(*col, 255), anchor="lm")
        x += f.getlength(s)
    a = np.asarray(img, np.float32)
    alpha = a[..., 3:] / 255.0
    return a[..., :3] * alpha, alpha


def row_spans(kind, ind, text):
    pad = " " * ind
    if kind == "test" and text[2:3] in ("✓", "✗"):
        return [(pad + text[:2], TEXT), (text[2], TERRA_LIGHT), (text[3:], TEXT)]
    if kind == "plain" and text.strip() == "ingest":
        return [(pad + text, PAPER)]
    return [(pad + text, TEXT)]


def card_shell():
    """RGBA card at SS: folder-style tab with title, body, shadow, 1 px edge, and
    the "Test data: simulated" label on the tab row, right. As shots 13 and 14."""
    lw, lh = P(CARD_W + 2 * MARGIN), P(CARD_H + 2 * MARGIN)
    o = P(MARGIN)
    title, title_px = "Terminal", 30
    f_title = font(FB, title_px)
    tab_w = P(22 + 10 + 14) + f_title.getlength(title) + P(24)
    sil = Image.new("L", (lw, lh), 0)
    d = ImageDraw.Draw(sil)
    d.rounded_rectangle([o, o, o + tab_w, o + P(TAB_H + 24)], radius=P(16), fill=255)
    d.rounded_rectangle([o, o + P(TAB_H), o + P(CARD_W), o + P(CARD_H)], radius=P(20), fill=255)
    d.rectangle([o, o + P(TAB_H), o + P(30), o + P(TAB_H + 30)], fill=255)
    r = P(14)  # concave fillet where the tab meets the top edge
    d.rectangle([o + tab_w, o + P(TAB_H) - r, o + tab_w + r, o + P(TAB_H)], fill=255)
    d.ellipse([o + tab_w, o + P(TAB_H) - 2 * r, o + tab_w + 2 * r, o + P(TAB_H)], fill=0)
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
    by = o + P(TAB_H / 2 + title_px * 0.37)
    sq = title_px * 0.34
    d.rectangle([o + P(22), by - P(title_px * 0.63), o + P(22 + sq), by - P(title_px * 0.63 - sq)],
                fill=(*TERRACOTTA, 255))
    d.text((o + P(22 + 10 + 14), by), title, font=f_title, fill=(*PAPER, 255), anchor="ls")
    # the label, a small pill, right-aligned on the tab row
    f_lab = font(FS, 26)
    lx1 = o + P(LABEL_RIGHT - CARD_X)
    lw_ = f_lab.getlength(LABEL) + P(18 + 10 + 12 + 18)  # pad, dot, gap, text, pad
    ly0, ly1 = o + P(TAB_H / 2 - 21 + 2), o + P(TAB_H / 2 + 21 + 2)
    d.rounded_rectangle([lx1 - lw_, ly0, lx1, ly1], radius=P(21), outline=(*EDGE, 255),
                        width=P(1.5), fill=(*COFFEE, 255))
    cx, cy = lx1 - lw_ + P(18 + 5), (ly0 + ly1) / 2
    d.ellipse([cx - P(5), cy - P(5), cx + P(5), cy + P(5)], fill=(*TERRA_LIGHT, 255))
    d.text((lx1 - P(18), cy), LABEL, font=f_lab, fill=(*TEXT, 255), anchor="rm")
    return base, o


def background():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    lift = np.exp(-(((xx - CARD_X - CARD_W / 2) / 760) ** 2 + ((yy - 860) / 1000) ** 2))
    r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
    img = np.array(ESPRESSO, np.float32) + lift[..., None] * np.array([12, 9, 6], np.float32)
    return img * (1 - 0.22 * np.clip(r2, 0, 1.6) ** 1.3)[..., None]


class Terminal:
    """Draws the text window at SS for a moment in time; caches what repeats."""

    def __init__(self, rows):
        self.rows = rows
        self.keys = key_times()
        self.ww, self.wh = P(WIN_W), P(WIN_H)
        self.tx = P(TEXT_X - WIN_X)  # first column, window px
        self.strips = {}
        for i, (kind, ind, text, _) in enumerate(rows):
            if kind in ("cmd", "prompt") or not text.strip():
                continue
            self.strips[i] = strip(row_spans(kind, ind, text))
            if kind.startswith("harness") or kind == "summary":
                self.strips[i, "hot"] = strip([(" " * ind + text, PAPER)], bold=True)
        self.prompt = strip([("$", TERRA_LIGHT)], bold=True)
        self.cmd = {}  # the command as typed so far, by length
        self.hot = [i for i, r in enumerate(rows) if r[0].startswith("harness")]
        self.sum_row = next(i for i, r in enumerate(rows) if r[0] == "summary")
        self.sum_len = len(rows[self.sum_row][2])
        self.n_hot = len(self.hot)
        self.scroll = self._scroll_track()

        # the bar: one rounded block over the harness rows, and its soft glow
        bh = P(self.n_hot * ROW_H)
        bw = P(COLS * ADV + 28)
        self.band_off = (-P(14), P(1))  # from the first column and the first bar row
        m = Image.new("L", (bw, bh), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, bw - 1, bh - 1], radius=P(10), fill=255)
        self.band = np.asarray(m, np.float32) / 255.0
        g = P(22)
        gm = Image.new("L", (bw + 2 * g, bh + 2 * g), 0)
        gm.paste(m, (g, g))
        self.glow = np.asarray(gm.filter(ImageFilter.GaussianBlur(P(12))), np.float32) / 255.0
        self.glow_off = g

    # where the view is, in rows, frame by frame
    def _scroll_track(self):
        """The view glides after the newest line like a smooth-scrolling terminal:
        the output arrives faster than it can scroll, so it accelerates to a
        steady speed and brakes into place; a light causal filter rounds the
        corners. The lines themselves still appear at their captured times."""
        sub, dt = 8, 1 / 8  # substeps per frame; time in frames
        pos, vel, soft, out = 0.0, 0.0, 0.0, []
        for i in range(int(DUR * FPS) + 1):
            for k in range(sub):
                target = max(0, self.cursor_row((i + k * dt) / FPS) - (ROWS - 1))
                dist = target - pos
                want = math.copysign(min(SCROLL_V, math.sqrt(2 * SCROLL_A * abs(dist))), dist)
                vel += max(-SCROLL_A * dt, min(SCROLL_A * dt, want - vel))
                pos = target if abs(dist) < 1e-3 and abs(vel) < 0.02 else pos + vel * dt
                vel = 0.0 if pos == target else vel
            soft += (pos - soft) * 0.45
            out.append(soft)
        last = max(0, self.cursor_row(DUR) - (ROWS - 1))
        assert max(out) <= last + 1e-3 and abs(out[-1] - last) < 1e-3, "view must settle, no bounce"
        return out

    def printed(self, t):
        """Rows on screen at t (the command row is always there)."""
        return sum(1 for r in self.rows if r[3] <= t) if t >= ENTER_T else 1

    def cursor_row(self, t):
        if t < ENTER_T:
            return 0
        n = self.printed(t)
        return n - 1 if self.rows[n - 1][0] == "prompt" else n

    def typed(self, t):
        return sum(1 for k in self.keys if k <= t)

    def cursor(self, t):
        """(row, column, alpha) of the block cursor."""
        row = self.cursor_row(t)
        if t < ENTER_T:  # after the typed text; each key restarts the blink
            n = self.typed(t)
            col, last = 2 + n, self.keys[n - 1] if n else 0.0
        elif row < len(self.rows) and self.rows[row][0] == "prompt":
            col, last = 2, self.rows[row][3]
        else:  # node is running: start of the next line
            col, last = 0, ENTER_T
        on = ((t - last) % (2 * BLINK)) < BLINK
        a = (1.0 if on else 0.0) * (1 - smooth(*CURSOR_OUT, t))
        return row, col, a

    def band_progress(self, j, t):
        return ease(BAND_T0 + j * BAND_STEP, BAND_T0 + j * BAND_STEP + BAND_LEN, t)

    def state(self, i):
        """Everything that changes the window, rounded; equal states draw equal pixels."""
        t = i / FPS
        row, col, ca = self.cursor(t)
        s = self.scroll[i]
        v = abs(self.scroll[i] - self.scroll[i - 1]) if i else 0.0
        return (self.typed(t), self.printed(t), round(s * ROW_H * SS), round(v * ROW_H * SS / 2),
                row, col, round(ca, 3), round(smooth(*DIM_T, t), 3),
                tuple(round(self.band_progress(j, t), 3) for j in range(self.n_hot)),
                round(smooth(*GLOW_T, t), 3), round(smooth(*REVEAL_T, t), 3),
                round(ease(*UNDER_T, t), 3))

    def draw(self, i):
        t = i / FPS
        (n_typed, n_rows, scroll_px, blur_px, c_row, c_col, c_a, dim, bands, glow, reveal,
         under) = self.state(i)
        win = np.empty((self.wh, self.ww, 3), np.float32)
        win[:] = COFFEE
        y_of = lambda r: P(WIN_PAD) + r * P(ROW_H) - scroll_px  # noqa: E731

        def put(rgb, a, x, y, k=1.0):
            h, w = a.shape[:2]
            y0, y1 = max(y, 0), min(y + h, self.wh)
            x0, x1 = max(x, 0), min(x + w, self.ww)
            if y1 <= y0 or x1 <= x0 or k <= 0:
                return
            dst = win[y0:y1, x0:x1]
            dst *= 1 - a[y0 - y:y1 - y, x0 - x:x1 - x] * k
            dst += rgb[y0 - y:y1 - y, x0 - x:x1 - x] * k

        # the bar and its glow, behind the text
        if bands[0] > 0:
            bx, by = self.tx + self.band_off[0], y_of(self.hot[0]) + self.band_off[1]
            if glow > 0:
                g = self.glow * (0.38 * glow)
                put(g[..., None] * np.array(TERRACOTTA, np.float32), g[..., None],
                    bx - self.glow_off, by - self.glow_off)
            bh, bw = self.band.shape
            cols = np.arange(bw, dtype=np.float32)
            reach = np.empty((bh, 1), np.float32)
            for j, p in enumerate(bands):  # each row's share of the block wipes in on its own
                reach[j * P(ROW_H):(j + 1) * P(ROW_H)] = p * (bw + P(24))
            wipe = np.clip((reach - cols[None, :]) / P(24), 0, 1)
            a = (self.band * wipe)[..., None]
            put(a * np.array(TERRACOTTA, np.float32), a, bx, by)

        for r in range(n_rows):
            y = y_of(r)
            if y + P(ROW_H) < 0 or y > self.wh:
                continue
            kind = self.rows[r][0]
            k_dim = 1 - (1 - DIM) * dim
            if kind == "cmd":
                rgb, a = self.prompt
                put(rgb, a, self.tx, y, k_dim)
                if n_typed:
                    if n_typed not in self.cmd:
                        self.cmd[n_typed] = strip([("  " + TYPED[:n_typed], PAPER)])
                    rgb, a = self.cmd[n_typed]
                    put(rgb, a, self.tx, y, k_dim)
            elif kind == "prompt":
                rgb, a = self.prompt
                put(rgb, a, self.tx, y, k_dim)
            elif r in self.strips:
                rgb, a = self.strips[r]
                if r in self.hot:
                    p = bands[self.hot.index(r)]
                    put(rgb, a, self.tx, y, 1 - p)
                    rgb, a = self.strips[r, "hot"]
                    put(rgb, a, self.tx, y, p)
                elif r == self.sum_row:
                    put(rgb, a, self.tx, y, SUM_DIM * (1 - reveal))
                    rgb, a = self.strips[r, "hot"]
                    put(rgb, a, self.tx, y, reveal)
                else:
                    put(rgb, a, self.tx, y, k_dim)

        # the underline under the summary, swept in left to right
        if under > 0:
            y = y_of(self.sum_row) + P(ROW_H / 2 + CODE_PX * 0.66)  # under the descenders
            x0 = self.tx
            x1 = x0 + int(self.sum_len * P(ADV) * under)
            win[y:y + P(2.5), x0:x1] = TERRA_LIGHT

        # block cursor
        if c_a > 0:
            y = y_of(c_row) + P(ROW_H / 2 - CODE_PX * 0.62)
            x = self.tx + int(c_col * ADV * SS)
            h, w = P(CODE_PX * 1.2), P(ADV)
            k = 0.85 * c_a * (1 - (1 - DIM) * dim)
            dst = win[max(y, 0):y + h, x:x + w]
            dst += (np.array(PAPER, np.float32) - dst) * k

        # vertical motion blur while the view scrolls fast (180 degree shutter)
        if blur_px >= 2:  # a centred box: each row averages blur_px rows around it
            h1 = blur_px // 2
            c = np.cumsum(np.pad(win, ((h1 + 1, blur_px - 1 - h1), (0, 0), (0, 0)), mode="edge"),
                          axis=0)
            win = (c[blur_px:] - c[:-blur_px]) / blur_px

        # rows fade out where they pass under the window's top and bottom edges
        m = P(WIN_PAD)
        ramp = np.linspace(0, 1, m, dtype=np.float32)[:, None, None]
        col = np.array(COFFEE, np.float32)
        win[:m] = col + (win[:m] - col) * ramp
        win[-m:] = col + (win[-m:] - col) * ramp[::-1]
        return np.clip(win + 0.5, 0, 255).astype(np.uint8)


class Shot:
    """The whole frame at any frame index; equal window states reuse one layer."""

    def __init__(self):
        self.term = Terminal(build_rows(load_capture()))
        self.shell, self.o = card_shell()
        self.bg = background()
        self.cache = {}
        # push-in centre: x right of centre (text and label stay inside the safe
        # line), y the bar's centre where the view settles
        hot, n = self.term.hot[0], self.term.n_hot
        self.anchor = (ANCHOR_X, CARD_Y + WIN_Y + WIN_PAD + (hot - self.term.scroll[-1] + n / 2) * ROW_H)
        for x in (CARD_X + TEXT_X + COLS * ADV + 14, LABEL_RIGHT):  # bar edge, label
            assert ANCHOR_X + (x - ANCHOR_X) * PUSH <= 940, "push-in crosses the right safe line"

    def layer(self, i):
        key = self.term.state(i)
        if key not in self.cache:
            layer = self.shell.copy()
            layer.paste(Image.fromarray(self.term.draw(i), "RGB"),
                        (self.o + P(WIN_X), self.o + P(WIN_Y)))
            if len(self.cache) > 8:
                self.cache.clear()
            self.cache[key] = layer.convert("RGBa")  # premultiplied, for resampling
        return self.cache[key]

    def frame(self, i):
        t = i / FPS
        layer = self.layer(i)
        s = 1 + (PUSH - 1) * smooth(*PUSH_T, t)
        ax, ay = self.anchor
        k = s / SS  # frame px per layer px
        x0 = ax + (CARD_X - MARGIN - ax) * s
        y0 = ay + (CARD_Y - MARGIN - ay) * s
        lw, lh = layer.size
        ix0, iy0 = max(math.ceil(x0), 0), max(math.ceil(y0), 0)
        ix1, iy1 = min(math.floor(x0 + lw * k), W), min(math.floor(y0 + lh * k), H)
        box = ((ix0 - x0) / k, (iy0 - y0) / k, (ix1 - x0) / k, (iy1 - y0) / k)
        if s == 1:  # exact 2:1, a plain box filter
            small = layer.reduce(SS, box=tuple(int(round(v)) for v in box))
        else:
            small = layer.resize((ix1 - ix0, iy1 - iy0), Image.LANCZOS, box=box)
        a = np.asarray(small, np.float32)
        frame = self.bg.copy()
        dst = frame[iy0:iy1, ix0:ix1]
        dst *= 1 - a[..., 3:] / 255.0
        dst += a[..., :3]
        grain = np.random.default_rng((16, i)).standard_normal((H, W, 1), dtype=np.float32)
        frame += grain * 2.2  # film grain
        return np.clip(frame + 0.5, 0, 255).astype(np.uint8)


def main():
    shot = Shot()
    for i in range(int(DUR * FPS)):
        sys.stdout.buffer.write(shot.frame(i).tobytes())


def keys():
    """The lavfi audio source: one click per keystroke, a heavier Enter, silence."""
    rng = np.random.default_rng(61)
    terms = []
    for n, k in enumerate(key_times() + [ENTER_T]):
        enter = n == len(TYPED)
        amp = 1.35 if enter else 0.78 + 0.22 * rng.random()
        thock = 2 * math.pi * (125 if enter else 170 + 60 * rng.random())
        rel = 0.12 if enter else 0.07 + 0.04 * rng.random()  # key release
        body = 70 if enter else 150
        d = f"(t-{k:.4f})"
        terms.append(
            f"if(between(t,{k:.4f},{k + 0.25:.4f}),{amp:.3f}*("
            f"(2*random(0)-1)*(0.55*exp(-1300*{d})+0.16*exp(-{body}*{d}))"
            f"+0.30*sin({thock:.1f}*{d})*exp(-110*{d})"
            f"+0.22*gte({d},{rel:.3f})*(2*random(0)-1)*exp(-1700*({d}-{rel:.3f}))),0)")
    expr = "0.28*(" + "+".join(terms) + ")"
    print(f"aevalsrc='{expr}':s=48000:d={DUR:g},highpass=f=90,lowpass=f=7500")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "render"
    if mode == "capture":
        capture(sys.argv[2] if len(sys.argv) > 2 else None)
    elif mode == "keys":
        keys()
    else:
        main()
