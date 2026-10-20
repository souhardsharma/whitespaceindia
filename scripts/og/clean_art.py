"""Store a Gemini render as card art: generator mark painted out, 1400 px WebP.

The generator stamps a pale sparkle near the bottom-right corner of its
2048 px square. On these prints it lands on bare paper and is LIGHTER than
the paper, so in that corner every pixel brighter than the paper's own
grain is replaced by paper taken from the print's bottom-left corner.
Ink is never lighter than paper, so a mark that strayed onto ink would be
left visible: check the corner of every new render.

usage: python scripts/og/clean_art.py <render.png> <name>   (writes scripts/og/art/<name>.webp)
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageStat

CORNER = 260  # px of the 2048 square, from the bottom-right, that the mark sits in


def main(src: Path, name: str) -> None:
    im = Image.open(src).convert("RGB")
    if im.size != (2048, 2048):
        sys.exit(f"ERROR: {src} is {im.size}, expected a 2048 px square render")
    box = (2048 - CORNER, 2048 - CORNER, 2048, 2048)
    corner = im.crop(box)
    # Bare paper to repaint with: the darkest pixel tells ink from paper, so
    # take the candidate patch whose darkest pixel is lightest.
    candidates = [(x, y) for x in (0, 2048 - CORNER) for y in (0, 2048 - CORNER)
                  if (x, y) != box[:2]]
    x, y = max(candidates, key=lambda xy: sorted(
        im.crop((*xy, xy[0] + CORNER, xy[1] + CORNER)).convert("L").getdata())[200])
    paper = im.crop((x, y, x + CORNER, y + CORNER))
    # The mark is only a few levels above the paper (251-254 against 248), so
    # the threshold is low; paper caught by it is replaced by paper, which is
    # harmless. The dilated mask is then held to light pixels so it never
    # eats into the edge of ink beside the mark.
    median = ImageStat.Stat(paper.convert("L")).median[0]
    grey = corner.convert("L")
    light = grey.point(lambda v: 255 if v > median + 1 else 0)
    paperish = grey.point(lambda v: 255 if v > median - 30 else 0)
    mark = ImageChops.multiply(light.filter(ImageFilter.MaxFilter(7)), paperish)
    corner.paste(paper, (0, 0), mark.filter(ImageFilter.GaussianBlur(1)))
    im.paste(corner, box[:2])
    out = Path("scripts/og/art") / f"{name}.webp"
    im.resize((1400, 1400), Image.LANCZOS).save(out, quality=92, method=6)
    print(f"wrote {out}  {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(Path(sys.argv[1]), sys.argv[2])
