"""Re-ink a one-colour riso print: the paper stays, the ink becomes another ink.

The instruments shelf took its art from Instrument 01's plum, so the shelf and
its first instrument read as one thing. The shelf is now graphite, and its two
prints (the landing tile and the share card's magnifying glass) were re-inked
with this script rather than redrawn, so the drawings are unchanged.

Ink coverage is read from luminance, which keeps the grain, the halftone and
the misregistration. Luminance runs paper -> MID -> DEEP. MID sits at the
luminance plum had, so the drawing keeps its weight; only pixels darker than
plum (the second, deeper ink some prints carry) move toward DEEP.

usage: python scripts/og/reink.py <in> <out> <mid r,g,b> <deep r,g,b>
  shelf: python scripts/og/reink.py public/landing/_orig_backup/instruments-bg.webp \
             public/landing/_orig_backup/instruments-shelf.webp 84,80,72 30,28,25
         then python scripts/optimize_landing.py instruments-shelf
"""
import sys

import numpy as np
from PIL import Image

LUMA = np.array([0.299, 0.587, 0.114])
OLD_INK = np.array([122, 59, 107])  # plum, #7a3b6b


def parse_rgb(text: str) -> np.ndarray:
    return np.array([int(v) for v in text.split(",")], float)


def reink(src: str, dst: str, mid: np.ndarray, deep: np.ndarray) -> None:
    pixels = np.asarray(Image.open(src).convert("RGB")).astype(float)
    flat = pixels.reshape(-1, 3)
    lum = flat @ LUMA
    # The brighter 40% of a print is bare paper, grain included.
    paper = np.median(flat[lum >= np.percentile(lum, 60)], axis=0)
    l_paper, l_dark = paper @ LUMA, np.percentile(lum, 0.2)
    t = np.clip((l_paper - lum) / (l_paper - l_dark), 0, 1)
    t_mid = (l_paper - OLD_INK @ LUMA) / (l_paper - l_dark)
    to_mid = np.clip(t / t_mid, 0, 1)[:, None]
    to_deep = np.clip((t - t_mid) / (1 - t_mid), 0, 1)[:, None]
    out = np.where(t[:, None] <= t_mid,
                   paper + to_mid * (mid - paper),
                   mid + to_deep * (deep - mid))
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8).reshape(pixels.shape)).save(dst, quality=92)
    print(f"wrote {dst}  paper {paper.round()}")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    reink(sys.argv[1], sys.argv[2], parse_rgb(sys.argv[3]), parse_rgb(sys.argv[4]))
