"""Generate public/og/instruments.png, matching the existing OG treatment.

The five existing OG cards (brand, csr, health, energy, education) were made by
hand. They share one composition, which this reproduces:

  1200x630, cream ground
  an illustration filling the upper band, in the vertical's accent colour
  a double rule in the accent colour
  a bottom bar: "Whitespace / India" set in Newsreader (bold roman + bold
  italic, with a light slash between), and the section label at the far right
  in Space Grotesk, uppercase, tracked, in the accent colour

Fonts are the same three the site uses. They are fetched as variable TTFs from
the Google Fonts repository; set INSTRUMENTS_FONT_DIR to a directory holding
Newsreader.ttf, Newsreader-Italic.ttf and SpaceGrotesk.ttf.

Run from the project root:  python scripts/make_instruments_og.py
"""
from __future__ import annotations

import math
import os
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path("public/og/instruments.png")
W, H = 1200, 630
SS = 2

PLUM = (122, 59, 107)
INK = (28, 28, 25)
CREAM = (250, 246, 238)
SEED = 20260821

FONT_DIR = Path(os.environ.get("INSTRUMENTS_FONT_DIR", ""))
if not FONT_DIR or not FONT_DIR.is_dir():
    sys.exit(
        "ERROR: INSTRUMENTS_FONT_DIR is not set to a readable directory.\n"
        "It must contain Newsreader.ttf, Newsreader-Italic.ttf and "
        "SpaceGrotesk.ttf (variable TTFs from github.com/google/fonts)."
    )


def font(name: str, size: int, weight: float | None = None) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONT_DIR / name), size)
    if weight is not None:
        try:
            axes = [a["name"] for a in f.get_variation_axes()]
            values = [weight if ax == b"Weight" else
                      (size if ax == b"Optical Size" else None)
                      for ax in axes]
            f.set_variation_by_axes([v for v in values if v is not None]
                                    or [weight])
        except Exception:  # noqa: BLE001 - static font, nothing to set
            pass
    return f


def tracked(draw: ImageDraw.ImageDraw, xy, text: str, fnt, fill, tracking: float):
    """Draw text with extra letter-spacing. PIL has no tracking of its own."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + tracking
    return x


def measure_tracked(draw: ImageDraw.ImageDraw, text: str, fnt, tracking: float) -> float:
    return sum(draw.textlength(c, font=fnt) + tracking for c in text) - tracking


def draw_illustration(size: tuple[int, int], band_h: int) -> tuple[Image.Image, Image.Image]:
    """Solid and halftone-tint masks for the upper illustration band."""
    w, _ = size
    solid = Image.new("L", size, 0)
    tint = Image.new("L", size, 0)
    ds, dt = ImageDraw.Draw(solid), ImageDraw.Draw(tint)

    cx, cy = int(w * 0.50), int(band_h * 0.47)
    R = int(band_h * 0.40)

    ds.ellipse([cx - R, cy - R, cx + R, cy + R], outline=255, width=int(band_h * 0.028))
    for i in range(37):
        a = math.radians(180 + i * 5)
        long_tick = i % 3 == 0
        r0 = R - int(band_h * 0.044)
        r1 = r0 - int(band_h * (0.074 if long_tick else 0.040))
        ds.line([cx + r0 * math.cos(a), cy + r0 * math.sin(a),
                 cx + r1 * math.cos(a), cy + r1 * math.sin(a)],
                fill=255, width=int(band_h * (0.016 if long_tick else 0.009)))

    ri = R - int(band_h * 0.122)
    dt.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], fill=255)

    ang = math.radians(-52)
    tip = (cx + (ri - band_h * 0.04) * math.cos(ang),
           cy + (ri - band_h * 0.04) * math.sin(ang))
    perp = ang + math.pi / 2
    bw = band_h * 0.037
    ds.polygon([(cx + bw * math.cos(perp), cy + bw * math.sin(perp)),
                (cx - bw * math.cos(perp), cy - bw * math.sin(perp)), tip], fill=255)
    pv = int(band_h * 0.060)
    ds.ellipse([cx - pv, cy - pv, cx + pv, cy + pv], fill=255)

    ground_y = int(band_h * 0.90)
    ds.line([cx, cy, cx, ground_y - int(band_h * 0.075)], fill=255,
            width=int(band_h * 0.012))
    bob = int(band_h * 0.040)
    ds.polygon([(cx - bob, ground_y - int(band_h * 0.105)),
                (cx + bob, ground_y - int(band_h * 0.105)),
                (cx, ground_y - int(band_h * 0.028))], fill=255)

    def contour(dr, amp: float, base: int) -> None:
        pts = [(0, band_h * 1.4)]
        for x in range(0, w + 20, 20):
            t = x / w
            pts.append((x, base + amp * (math.sin(t * math.pi * 1.7 + 0.6)
                                         + 0.45 * math.sin(t * math.pi * 4.1 + 2.2))))
        pts.append((w, band_h * 1.4))
        dr.polygon(pts, fill=255)

    contour(dt, band_h * 0.042, ground_y - int(band_h * 0.062))
    contour(ds, band_h * 0.034, ground_y + int(band_h * 0.028))

    rnd = random.Random(SEED)
    for fx in [0.10, 0.165, 0.215, 0.285, 0.715, 0.775, 0.845, 0.905]:
        px = int(w * fx)
        scale = band_h * (0.105 + rnd.uniform(-0.012, 0.016))
        t = px / w
        fy = int((ground_y + band_h * 0.028) + band_h * 0.034 * (
            math.sin(t * math.pi * 1.7 + 0.6)
            + 0.45 * math.sin(t * math.pi * 4.1 + 2.2)) + band_h * 0.016)
        head = scale * 0.23
        ds.ellipse([px - head, fy - scale - head * 2, px + head, fy - scale], fill=255)
        bwid = scale * 0.24
        ds.polygon([(px - bwid * 0.72, fy), (px + bwid * 0.72, fy),
                    (px + bwid, fy - scale * 0.92), (px - bwid, fy - scale * 0.92)],
                   fill=255)
    return solid, tint


def main() -> None:
    big = (W * SS, H * SS)
    band_h = int(H * 0.80) * SS
    solid, tint = draw_illustration(big, band_h)
    solid = solid.resize((W, H), Image.LANCZOS)
    tint = tint.resize((W, H), Image.LANCZOS)

    canvas = Image.new("RGB", (W, H), CREAM)

    # halftone tint plate
    dots = Image.new("L", (W, H), 0)
    dd = ImageDraw.Draw(dots)
    for y in range(0, H + 7, 7):
        off = 3 if (y // 7) % 2 else 0
        for x in range(-7, W + 7, 7):
            dd.ellipse([x + off - 2.1, y - 2.1, x + off + 2.1, y + 2.1], fill=255)
    tint_dots = Image.new("L", (W, H), 0)
    tint_dots.paste(dots, (0, 0), tint)
    canvas.paste(Image.new("RGB", (W, H), PLUM), (4, -3), tint_dots)

    ghost = solid.point(lambda v: int(v * 0.18)).filter(ImageFilter.GaussianBlur(1.0))
    canvas.paste(Image.new("RGB", (W, H), PLUM), (-4, 3), ghost)
    canvas.paste(Image.new("RGB", (W, H), PLUM), (0, 0), solid)

    d = ImageDraw.Draw(canvas)

    # clear the bottom bar, then the double rule above it
    bar_top = int(H * 0.845)
    d.rectangle([0, bar_top - 2, W, H], fill=CREAM)
    pad = 48
    d.line([pad, bar_top, W - pad, bar_top], fill=PLUM, width=3)
    d.line([pad, bar_top + 9, W - pad, bar_top + 9], fill=PLUM, width=1)

    # "Whitespace / India"
    f_bold = font("Newsreader.ttf", 44, 700)
    f_ital = font("Newsreader-Italic.ttf", 44, 400)
    baseline = bar_top + 30
    x = pad
    d.text((x, baseline), "White", font=f_bold, fill=INK)
    x += d.textlength("White", font=f_bold)
    d.text((x, baseline), "space", font=f_ital, fill=INK)
    x += d.textlength("space", font=f_ital) + 14
    d.text((x, baseline + 2), "/", font=font("Newsreader.ttf", 40, 300), fill=INK + ())
    x += d.textlength("/", font=font("Newsreader.ttf", 40, 300)) + 14
    f_label = font("SpaceGrotesk.ttf", 26, 500)
    tracked(d, (x, baseline + 12), "India", f_label, INK, 3.0)

    # section label, right-aligned, in the accent
    f_sec = font("SpaceGrotesk.ttf", 22, 700)
    label = "INSTRUMENTS"
    wlab = measure_tracked(d, label, f_sec, 4.0)
    tracked(d, (W - pad - wlab, baseline + 16), label, f_sec, PLUM, 4.0)

    # paper grain
    rnd = random.Random(SEED)
    noise = Image.new("L", (W // 2, H // 2))
    noise.putdata([max(0, min(255, int(rnd.gauss(240, 11))))
                   for _ in range((W // 2) * (H // 2))])
    noise = noise.resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.4))
    canvas = Image.composite(canvas, Image.eval(canvas, lambda v: int(v * 0.9)), noise)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, format="PNG", optimize=True)
    print(f"wrote {OUT}  {OUT.stat().st_size/1024:.0f} KB  {W}x{H}")


if __name__ == "__main__":
    main()
