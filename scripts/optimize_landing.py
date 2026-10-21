"""Turn a landing render into the WebP the landing serves.

The five landing prints are one family: wide 16:9 riso landscapes on the same
cream paper, one ink each (terra, cobalt, forest, ochre, graphite), ground
running off both edges, subject in the middle band. A tile is cover-cropped
by the browser to about 1.39:1 on desktop and 2.86:1 on a phone, so the art
must stay wide and full: a narrow or sparse print shrinks to a small drawing
in a field of paper (which is how the old instruments tile looked).

The tiles are served at their 16:9 less one cropped edge, and each tile's
`pos` in app/page.tsx says which part survives the browser's crop. The CSR
banner is recut to the band from just above the watering can to below the
horizon. The banner runs from about 2.2:1 on a phone to 3.8:1 on a tablet,
and its `pos` keeps the can and the plots in view across that range; its
text sits in the empty sky, which every width keeps.

The generator stamps a pale four-point sparkle in the bottom-right corner of
every render. It is cropped out of every print, never painted over: each
crop box below is chosen so the mark lies wholly outside it, with a margin of
at least 0.02 of the height. The mark's extent, measured on 2752x1536, is the
region right of 1 - 0.111*H/W and below 1 - 0.109 of the height. Check the
corner of every new render, and change the output filename when a print
changes: CDNs and Next's image cache key on the URL.

Sources live in public/landing/_orig_backup/<name>.png (git-ignored).
Run from repo root:  python scripts/optimize_landing.py [name ...]
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

SRC_DIR = Path("public/landing/_orig_backup")
OUT_DIR = Path("public/landing")
# name -> (output file, crop box as (left, top, right, bottom) fractions of the
# source, long edge in px). The mark is at x > 0.9 and y > 0.891 of a 16:9 source.
TARGETS = {
    # Banner recut; the mark is below row 0.80.
    "csr-horizon": ("csr-horizon-2.webp", (0.0, 0.24, 1.0, 0.80), 2400),
    # The clinic stands at the right edge, so the bottom strip goes instead:
    # it is only the lower hill.
    "health-road": ("health-road-2.webp", (0.0, 0.0, 1.0, 0.87), 1600),
    # Houses and the solar roof reach the right edge; the bottom is dark hill.
    "energy-line": ("energy-line-2.webp", (0.0, 0.0, 1.0, 0.87), 1600),
    # The village runs off the right edge; the bottom is open ground.
    "education-paths": ("education-paths-2.webp", (0.0, 0.0, 1.0, 0.87), 1600),
    # The magnifier's handle ends near row 0.90, so a bottom crop would cut it;
    # the right strip is only field stripes that run off the edge anyway.
    "instruments-lens": ("instruments-lens-2.webp", (0.0, 0.0, 0.9266, 1.0), 1600),
}
QUALITY = 80


def main() -> None:
    selected = sys.argv[1:] or list(TARGETS)
    unknown = [n for n in selected if n not in TARGETS]
    if unknown:
        sys.exit(f"unknown target(s): {', '.join(unknown)}\nknown: {', '.join(TARGETS)}")

    total = 0
    for name in selected:
        out_name, (left, top, right, bottom), long_edge = TARGETS[name]
        img = Image.open(SRC_DIR / f"{name}.png").convert("RGB")
        w, h = img.size
        img = img.crop((round(w * left), round(h * top), round(w * right), round(h * bottom)))
        img = img.resize((long_edge, round(img.height * long_edge / img.width)), Image.LANCZOS)
        dst = OUT_DIR / out_name
        # No exif, icc or xmp argument: the file carries image data only.
        img.save(dst, format="WEBP", quality=QUALITY, method=6)
        total += dst.stat().st_size
        print(f"{name:>16}: {img.size}  {dst.stat().st_size // 1024} KB")
    print(f"{'TOTAL':>16}: {total // 1024} KB")


if __name__ == "__main__":
    main()
