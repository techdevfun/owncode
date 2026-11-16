#!/usr/bin/env python3
"""Render demo/transcript.txt as a terminal-typing GIF.

The transcript is generated from real CLI runs (scripts/capture-demo.sh);
this script only renders it, never edits the content.

Frames are written as PNGs to a temp dir and encoded with ffmpeg
(streaming, low memory) instead of holding every frame in RAM.
"""
from PIL import Image, ImageDraw, ImageFont
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FRAMES_DIR = "/tmp/owncode-gif-frames"

W = 1240
BG = (18, 18, 24)
FG = (220, 220, 220)
DIM = (150, 150, 160)
GREEN = (120, 220, 130)
YELLOW = (235, 200, 100)
RED = (240, 110, 110)
CYAN = (120, 200, 230)

font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 12)
bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 12)
LINE_H = 16

lines = open(os.path.join(ROOT, "demo", "transcript.txt")).read().splitlines()
# Wrap over-long lines at word boundaries for display only: the
# transcript itself is unchanged, but a 200-char reason line would
# otherwise run off the right edge of the 1240px canvas (seen 16/11
# on the UNPROTECTED reason line). Wrap width 100 chars at font 12.
import textwrap
display_lines: list[str] = []
for _raw in lines:
    if len(_raw) <= 100:
        display_lines.append(_raw)
    else:
        display_lines.extend(
            textwrap.wrap(_raw, width=100, subsequent_indent="  ", break_on_hyphens=False)
        )
lines = display_lines
# Fixed-height scrolling terminal viewport: the transcript is long,
# so a full-height canvas OOMs the encoder. Show the last VIEW_LINES
# lines like a real terminal scrolling; content is unchanged.
VIEW_LINES = 38
H = 14 + VIEW_LINES * LINE_H + 44

def color_for(line: str):
    if line.startswith("$"):
        return GREEN
    if line.startswith("#"):
        return DIM
    if "UNPROTECTED" in line:
        return RED
    if "AT-RISK" in line:
        return YELLOW
    if "OWNABLE" in line:
        return GREEN
    if "UNKNOWN" in line:
        return DIM
    if line.startswith("verdict:"):
        return CYAN
    if line.startswith("check: FAIL"):
        return RED
    if line.startswith("check: PASS"):
        return GREEN
    if line.startswith("summary:"):
        return CYAN
    if line.startswith("exit: 1"):
        return RED
    if line.startswith("exit: 0"):
        return GREEN
    return FG

shutil.rmtree(FRAMES_DIR, ignore_errors=True)
os.makedirs(FRAMES_DIR)

def render(canvas_tmp):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = 14
    for text, color in canvas_tmp[-VIEW_LINES:]:
        f = bold if text.startswith("$") else font
        d.text((14, y), text, font=f, fill=color)
        y += LINE_H
        if y > H - 30:
            break
    d.rectangle([14, H - 24, 22, H - 12], fill=GREEN)
    return img

n = 0
def save(img):
    global n
    n += 1
    img.save(os.path.join(FRAMES_DIR, f"frame{n:04d}.png"))

# Title card (10s at 20 fps).
title = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(title)
d.text((14, 120), "owncode - can you license, sell, and protect this file?", font=bold, fill=GREEN)
d.text((14, 170), "1. audit: per-file ownership verdicts from git history + markers", font=font, fill=FG)
d.text((14, 200), "   OWNABLE / AT-RISK / UNPROTECTED / UNKNOWN - no hooks, no daemon", font=font, fill=FG)
d.text((14, 230), "2. explain: the evidence chain behind one UNPROTECTED file", font=font, fill=FG)
d.text((14, 260), "3. check: CI gate fails only on NEW risky files vs a baseline", font=font, fill=FG)
d.text((14, 290), "   (fixture repo is synthetic - built with real git commits)", font=font, fill=FG)
d.text((14, 350), "zero-dep CLI - read-only, local git only, no network, no LLM", font=font, fill=DIM)
d.text((14, 380), "real CLI output - verdicts are heuristics, not legal advice", font=font, fill=DIM)
for _ in range(200):
    save(title.copy())

# Extra hold frames so a first-time viewer can actually read the
# verdict lines and the gate result. Total target is ~25-30 s at 20 fps.
def extra_holds(line: str) -> int:
    if line.startswith("summary:"):
        return 40
    if line.startswith("verdict:"):
        return 30
    if line.startswith("check: FAIL"):
        return 40
    if line.startswith("exit:"):
        return 15
    if "UNPROTECTED" in line and line.startswith("  "):
        return 15
    return 0

canvas: list[tuple[str, tuple]] = []
for line in lines:
    color = color_for(line)
    # Two typing steps per line + two holds: ~4 frames/line keeps the
    # total near 25 s at 20 fps without holding frames in memory.
    half = line[: max(1, len(line) // 2)]
    save(render(canvas + [(half, color)]))
    save(render(canvas + [(line, color)]))
    canvas.append((line, color))
    save(render(canvas))
    save(render(canvas))
    for _ in range(extra_holds(line)):
        save(render(canvas))

out = os.path.join(ROOT, "demo", "owncode-demo.gif")
cmd = [
    "ffmpeg", "-y", "-v", "error",
    "-framerate", "20", "-i", os.path.join(FRAMES_DIR, "frame%04d.png"),
    "-vf", "split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse",
    out,
]
res = subprocess.run(cmd)
if res.returncode != 0:
    print("ffmpeg failed", file=sys.stderr)
    sys.exit(1)
shutil.rmtree(FRAMES_DIR, ignore_errors=True)
size = os.path.getsize(out)
print(f"GIF written: {out} ({n} frames, {n * 50 / 1000:.1f}s, {size} bytes)")
