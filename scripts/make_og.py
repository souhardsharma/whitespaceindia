"""Generate the link-preview cards for the landing page and the CSR index.

  public/og/whitespace-india.jpg   the site, used by / and every page without its own
  public/og/csr-index.jpg          /csr and its sub-pages (about, methodology, reports)

Composition: 1200x630, one sheet of paper. Type on the left, set in the
site's own fonts; a risograph print on the right, from scripts/og/art/. The
art carries no text, no figures and no map. A map of India in a share card
is a legal exposure (an inexact boundary is an offence) and the site already
says what it is in words.

Type stays 72 px inside every edge, within the 1080x600 area that platforms
which trim a 1.91:1 card still show. The art may bleed; the words may not.

Kept under 300 KB as JPEG: WhatsApp drops previews above roughly 300 KB on
some clients, and the PNG of a halftone texture is twice that.

Change the art or the words and rename the file: scrapers (WhatsApp about a
week, LinkedIn and X longer) cache by image URL, so a file replaced in place
keeps showing the old card.

The art in scripts/og/art/ is two Gemini risograph renders, reduced to 1400 px
with the generator's corner mark painted out from the print's own paper.

Fonts: set OG_FONT_DIR to a directory holding Newsreader.ttf,
Newsreader-Italic.ttf and SpaceGrotesk.ttf (variable TTFs from
github.com/google/fonts).

Run from the project root:  python scripts/make_og.py
"""
from __future__ import annotations

import os
import random
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageStat

W, H = 1200, 630
PAD = 72
TEXT_W = 480
ART = Path("scripts/og/art")
OUT = Path("public/og")
MAX_BYTES = 300 * 1024

INK = (28, 28, 25)
CLAY = (189, 64, 44)
MUTED = (91, 95, 98)
SEED = 20261020

FONT_DIR = Path(os.environ.get("OG_FONT_DIR", ""))
if not FONT_DIR.is_dir() or not (FONT_DIR / "Newsreader.ttf").is_file():
    sys.exit("ERROR: OG_FONT_DIR must name a directory holding Newsreader.ttf, "
             "Newsreader-Italic.ttf and SpaceGrotesk.ttf.")


@dataclass(frozen=True)
class Card:
    out: str
    art: str
    crop: tuple[int, int, int, int]  # square box in the 1400 px art
    side: int  # rendered size of that square; under 630 it floats on the sheet
    eyebrow: str
    headline: str  # lines broken by hand: a wrapper leaves one word on a line
    italic: str
    section: str


CARDS = [
    Card(
        out="whitespace-india.jpg",
        art="brand.webp",
        crop=(0, 0, 1400, 1400),
        side=590,
        eyebrow="OPEN CIVIC DATA · INDIA",
        headline="Where India’s\nresources land,",
        italic="and where\nthey don’t.",
        section="CSR · HEALTH · EDUCATION · ENERGY · INSTRUMENTS",
    ),
    Card(
        out="csr-index.jpg",
        art="csr.webp",
        # the print leaves its left third empty; take the square around the plant
        crop=(180, 40, 1400, 1260),
        side=630,
        eyebrow="CSR OPPORTUNITY INDEX",
        headline="Where CSR\nshould go,",
        italic="district by district.",
        section="651 DISTRICTS · GOVERNMENT DATA · FREE",
    ),
]


def font(name: str, size: int, weight: float) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONT_DIR / name), size)
    axes = [a["name"] for a in f.get_variation_axes()]
    f.set_variation_by_axes([size if ax == b"Optical Size" else weight for ax in axes])
    return f


def tracked(draw: ImageDraw.ImageDraw, xy, text: str, fnt, fill, tracking: float) -> float:
    """Draw text with letter-spacing (PIL has none) and return the end x."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + tracking
    return x


def lines(draw: ImageDraw.ImageDraw, text: str, fnt) -> list[str]:
    out = text.split("\n")
    for line in out:
        if draw.textlength(line, font=fnt) > TEXT_W:
            sys.exit(f"ERROR: {line!r} is wider than the {TEXT_W} px text column")
    return out


def paper_tone(art: Image.Image) -> tuple[int, int, int]:
    """The print's own paper colour, so type and art sit on one sheet."""
    strip = art.crop((0, art.height - 60, 200, art.height - 10)).convert("RGB")
    return tuple(ImageStat.Stat(strip).median)


def grain(canvas: Image.Image) -> Image.Image:
    rnd = random.Random(SEED)
    w, h = W // 2, H // 2
    noise = Image.new("L", (w, h))
    noise.putdata([max(0, min(255, int(rnd.gauss(244, 9)))) for _ in range(w * h)])
    noise = noise.resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.5))
    return Image.composite(canvas, Image.eval(canvas, lambda v: int(v * 0.94)), noise)


def wordmark(draw: ImageDraw.ImageDraw, x: float, y: float) -> None:
    """'Whitespace / India' as the site's header sets it."""
    bold = font("Newsreader.ttf", 34, 700)
    ital = font("Newsreader-Italic.ttf", 34, 400)
    draw.text((x, y), "White", font=bold, fill=INK)
    x += draw.textlength("White", font=bold)
    draw.text((x, y), "space", font=ital, fill=INK)
    x += draw.textlength("space", font=ital) + 10
    slash = font("Newsreader.ttf", 30, 300)
    draw.text((x, y + 2), "/", font=slash, fill=INK)
    x += draw.textlength("/", font=slash) + 10
    tracked(draw, (x, y + 10), "India", font("SpaceGrotesk.ttf", 20, 500), INK, 2.5)


def render(card: Card) -> Path:
    art = Image.open(ART / card.art).convert("RGB")
    canvas = Image.new("RGB", (W, H), paper_tone(art))

    # The art sits on the right, at full height or floated with an even margin;
    # its own paper is the gutter, and a soft left edge hides any seam where
    # its tone meets the sheet's.
    side = card.side
    panel = art.crop(card.crop).resize((side, side), Image.LANCZOS)
    fade = Image.linear_gradient("L").rotate(90).resize((20, side))
    mask = Image.new("L", (side, side), 255)
    mask.paste(fade.transpose(Image.FLIP_LEFT_RIGHT), (0, 0))
    inset = (H - side) // 2
    canvas.paste(panel, (W - side - inset, inset), mask)

    d = ImageDraw.Draw(canvas)

    d.rectangle([PAD, PAD, PAD + 36, PAD + 4], fill=CLAY)
    tracked(d, (PAD, PAD + 22), card.eyebrow, font("SpaceGrotesk.ttf", 19, 600), CLAY, 3.2)

    roman = font("Newsreader.ttf", 56, 500)
    italic = font("Newsreader-Italic.ttf", 56, 400)
    y = PAD + 80
    lead = 64
    for line in lines(d, card.headline, roman):
        d.text((PAD, y), line, font=roman, fill=INK)
        y += lead
    for line in lines(d, card.italic, italic):
        d.text((PAD, y), line, font=italic, fill=CLAY)
        y += lead

    rule_y = H - PAD - 64
    d.line([PAD, rule_y, PAD + TEXT_W, rule_y], fill=INK, width=2)
    d.line([PAD, rule_y + 6, PAD + TEXT_W, rule_y + 6], fill=INK, width=1)
    wordmark(d, PAD, rule_y + 20)
    tracked(d, (PAD, H - PAD + 14), card.section, font("SpaceGrotesk.ttf", 13, 500), MUTED, 1.6)

    canvas = grain(canvas)
    out = OUT / card.out
    for quality in (88, 84, 80, 76):
        canvas.save(out, format="JPEG", quality=quality, optimize=True, progressive=True,
                    subsampling="4:4:4" if quality >= 84 else "4:2:0")
        if out.stat().st_size <= MAX_BYTES:
            break
    else:
        sys.exit(f"ERROR: {out} is {out.stat().st_size // 1024} KB, over {MAX_BYTES // 1024} KB")
    print(f"wrote {out}  {out.stat().st_size / 1024:.0f} KB  {W}x{H}")
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for card in CARDS:
        render(card)


if __name__ == "__main__":
    main()
