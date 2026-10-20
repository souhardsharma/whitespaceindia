"""Turn a landing render into the WebP the landing serves.

The five landing prints are one family: wide 16:9 riso landscapes on the same
cream paper, one ink each (terra, cobalt, forest, ochre, graphite), ground
running off both edges, subject in the middle band. A tile is cover-cropped
by the browser to about 1.39:1 on desktop and 2.86:1 on a phone, so the art
must stay wide and full: a narrow or sparse print shrinks to a small drawing
in a field of paper (which is how the old instruments tile looked).

The tiles are served at their full 16:9 and each tile's `pos` in
app/page.tsx says which part survives the crop. Only the CSR banner is
cropped here, to the band from just above the watering can to below the
horizon. The banner runs from about 2.2:1 on a phone to 3.8:1 on a tablet,
and its `pos` keeps the can and the plots in view across that range; its
text sits in the empty sky, which every width keeps.

The generator stamps a pale sparkle in the bottom-right corner. Its pixels
are replaced with the print just to their left, which on these landscapes is
the same paper, hill or ground. Check the corner of every new render.

Sources live in public/landing/_orig_backup/<name>.png (git-ignored).
Run from repo root:  python scripts/optimize_landing.py [name ...]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SRC_DIR = Path("public/landing/_orig_backup")
OUT_DIR = Path("public/landing")
# name -> (rows kept as fractions of the height, long edge in px)
TARGETS = {
    "csr-horizon": ((0.12, 0.95), 2400),
    "health-road": ((0.0, 1.0), 1600),
    "energy-line": ((0.0, 1.0), 1600),
    "education-paths": ((0.0, 1.0), 1600),
    "instruments-lens": ((0.0, 1.0), 1600),
}
# Where the generator's mark sits, as shares of the height: its centre from the
# right and bottom edges, and a radius that covers it. Measured on 2752x1536.
MARK_CENTRE = (0.075, 0.073)
MARK_RADIUS = 0.036
QUALITY = 80


def paint_out_mark(img: Image.Image) -> Image.Image:
    w, h = img.size
    cx, cy, r = (round(h * f) for f in MARK_CENTRE + (MARK_RADIUS,))
    box = (w - cx - r, h - cy - r, w - cx + r, h - cy + r)
    shift = round(2.4 * r)
    donor = img.crop((box[0] - shift, box[1], box[2] - shift, box[3]))
    # The mark is a four-point star. Masking that shape, not a disc, keeps a
    # hill edge running just above it intact: only the top spike reaches it.
    steps = [2 * math.pi * i / 72 for i in range(72)]
    star = [(r + r * math.cos(t) ** 3, r + r * math.sin(t) ** 3) for t in steps]
    mask = Image.new("L", (2 * r, 2 * r), 0)
    ImageDraw.Draw(mask).polygon(star, fill=255)
    mask = mask.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(2))
    out = img.copy()
    out.paste(donor, box[:2], mask)
    return out


def main() -> None:
    selected = sys.argv[1:] or list(TARGETS)
    unknown = [n for n in selected if n not in TARGETS]
    if unknown:
        sys.exit(f"unknown target(s): {', '.join(unknown)}\nknown: {', '.join(TARGETS)}")

    total = 0
    for name in selected:
        (top, bottom), long_edge = TARGETS[name]
        img = paint_out_mark(Image.open(SRC_DIR / f"{name}.png").convert("RGB"))
        w, h = img.size
        img = img.crop((0, round(h * top), w, round(h * bottom)))
        img = img.resize((long_edge, round(img.height * long_edge / w)), Image.LANCZOS)
        dst = OUT_DIR / f"{name}.webp"
        img.save(dst, format="WEBP", quality=QUALITY, method=6)
        total += dst.stat().st_size
        print(f"{name:>16}: {img.size}  {dst.stat().st_size // 1024} KB")
    print(f"{'TOTAL':>16}: {total // 1024} KB")


if __name__ == "__main__":
    main()
