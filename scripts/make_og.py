"""Generate the link-preview cards, one per section.

  public/og/<card>.jpg   named in CARDS below; each layout or page names its own

Composition: 1200x630, one sheet of paper. A risograph print on the left,
from scripts/og/art/; on the right, the wordmark, the section, a two-part
headline and one line of detail, set in the site's own fonts. The art carries
no text, no figures and no map. A map of India in a share card is a legal
exposure (an inexact boundary is an offence) and the site says what it is in
words.

Everything that matters sits between x=150 and x=1000. WhatsApp's desktop and
web clients show the centre ~820 px of a 1.91:1 card, and a card laid out to
the edges lost the start of every headline there (measured 2026-10-20). The
full width is still used: the print's own paper continues to the edges.

The wordmark is the site header's: the {?} mark, then "Whitespace India" on
one baseline in Newsreader, with "space" in italic. scripts/og/logo.png is
public/logo.svg rasterised at 240 px by sharp:
  node -e "require('sharp')(require('fs').readFileSync('public/logo.svg'),{density:1200}).resize({height:240}).png().toFile('scripts/og/logo.png')"

Kept under 300 KB as JPEG: WhatsApp drops previews above roughly 300 KB on
some clients, and the PNG of a halftone texture is twice that.

Change the art or the words and rename the file: scrapers (WhatsApp about a
week, LinkedIn and X longer) cache by image URL, so a file replaced in place
keeps showing the old card. WhatsApp also caches the preview of a PAGE URL
on the sharing device; a renamed image reaches a link shared before only once
that cache lapses.

The art in scripts/og/art/ is Gemini risograph renders, reduced to 1400 px
with the generator's corner mark painted out from the print's own paper
(scripts/og/clean_art.py).

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

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageStat

W, H = 1200, 630
ART_X, ART_Y, ART_SIDE = 150, 90, 450
PAPER_MARGIN = 200  # paper added round each print, so a crop may start at -200
TEXT_X, TEXT_W = 640, 360
TOP, BOTTOM = ART_Y, ART_Y + ART_SIDE
ART = Path("scripts/og/art")
LOGO = Path("scripts/og/logo.png")
OUT = Path("public/og")
MAX_BYTES = 300 * 1024

INK = (28, 28, 25)
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
    crop: tuple[int, int, int, int]  # square box in the 1400 px art; may reach 200 px past it
    accent: tuple[int, int, int]  # the section's colour on the site
    eyebrow: str
    headline: str  # lines broken by hand: a wrapper leaves one word on a line
    italic: str
    detail: str


CLAY = (189, 64, 44)
CARDS = [
    Card("whitespace-india-2.jpg", "brand.webp", (-110, -110, 1510, 1510), CLAY,
         "OPEN CIVIC DATA · INDIA",
         "Where India’s\nresources land,", "and where\nthey don’t.",
         "District indexes · Civic instruments"),
    Card("csr-index-2.jpg", "csr.webp", (180, 40, 1400, 1260), CLAY,
         "CSR OPPORTUNITY INDEX",
         "Where CSR\nshould go,", "district by\ndistrict.",
         "651 districts · Government data"),
    Card("instruments-2.jpg", "instruments.webp", (0, 0, 1400, 1400), (122, 59, 107),
         "INSTRUMENTS",
         "Bring one case,", "see what the\nrecord holds.",
         "Built from India’s public records"),
    Card("consent-2.jpg", "consent.webp", (100, 87, 1300, 1287), (122, 59, 107),
         "PEOPLE & CONSENT",
         "Who lives where\nit would be built,", "and which consent\nrules apply.",
         "Instrument 01 · Clearance filings"),
    Card("health-2.jpg", "health.webp", (100, 127, 1300, 1327), (52, 62, 150),
         "HEALTH INDEX",
         "Where care\nis thin,", "district by\ndistrict.",
         "District index · Coming soon"),
    Card("energy-2.jpg", "energy.webp", (100, 50, 1300, 1250), (42, 111, 62),
         "ENERGY INDEX",
         "Where power\nfalls short,", "district by\ndistrict.",
         "District index · Coming soon"),
    Card("education-2.jpg", "education.webp", (100, 82, 1300, 1282), (138, 106, 42),
         "EDUCATION INDEX",
         "Where schools\nfall behind,", "district by\ndistrict.",
         "District index · Coming soon"),
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


def tracked_width(draw: ImageDraw.ImageDraw, text: str, fnt, tracking: float) -> float:
    return sum(draw.textlength(ch, font=fnt) + tracking for ch in text) - tracking


def paper_tone(art: Image.Image) -> tuple[int, int, int]:
    """The print's own paper colour, so type and art sit on one sheet."""
    patches = [art.crop((x, y, x + 120, y + 120)).convert("RGB")
               for x in (10, art.width - 130) for y in (10, art.height - 130)]
    # the corner with no ink in it is the lightest one
    paper = max(patches, key=lambda im: sum(ImageStat.Stat(im).median))
    return tuple(int(v) for v in ImageStat.Stat(paper).median)


def grain(canvas: Image.Image) -> Image.Image:
    rnd = random.Random(SEED)
    w, h = W // 2, H // 2
    noise = Image.new("L", (w, h))
    noise.putdata([max(0, min(255, int(rnd.gauss(244, 9)))) for _ in range(w * h)])
    noise = noise.resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.5))
    return Image.composite(canvas, Image.eval(canvas, lambda v: int(v * 0.94)), noise)


def wordmark(canvas: Image.Image, draw: ImageDraw.ImageDraw, x: int, top: int) -> None:
    """The {?} mark and 'Whitespace India' on one baseline, as the site header sets it."""
    size = 32
    bold = font("Newsreader.ttf", size, 700)
    ital = font("Newsreader-Italic.ttf", size, 500)
    baseline = top + bold.getmetrics()[0]
    cap = bold.getbbox("W", anchor="ls")[1]  # negative: cap height above the baseline
    mark = Image.open(LOGO).convert("RGBA")
    mark_h = -cap + 4
    mark = mark.resize((round(mark.width * mark_h / mark.height), mark_h), Image.LANCZOS)
    canvas.paste(mark, (x, baseline - mark_h + 2), mark)
    x += mark.width + 12
    for text, fnt in (("White", bold), ("space", ital), (" India", bold)):
        draw.text((x, baseline), text, font=fnt, fill=INK, anchor="ls")
        x += draw.textlength(text, font=fnt)


def headline_size(draw: ImageDraw.ImageDraw, card: Card, room: int) -> int:
    """The largest size, 56 px down, at which every line fits the column and the block fits `room`."""
    lines = card.headline.split("\n") + card.italic.split("\n")
    for size in range(56, 39, -1):
        roman = font("Newsreader.ttf", size, 500)
        italic = font("Newsreader-Italic.ttf", size, 400)
        widest = max(
            [draw.textlength(l, font=roman) for l in card.headline.split("\n")]
            + [draw.textlength(l, font=italic) for l in card.italic.split("\n")])
        if widest <= TEXT_W and round(size * 1.12) * len(lines) <= room:
            return size
    sys.exit(f"ERROR: the headline of {card.out} does not fit the {TEXT_W} px column at 40 px")


def render(card: Card) -> Path:
    art = Image.open(ART / card.art).convert("RGB")
    paper = paper_tone(art)
    canvas = Image.new("RGB", (W, H), paper)
    # A crop may reach past the print onto more of its paper, so art that runs
    # to the print's edge still sits inside the soft edge below.
    art = ImageOps.expand(art, PAPER_MARGIN, fill=paper)
    crop = tuple(v + PAPER_MARGIN for v in card.crop)

    # The print floats on its own paper; a soft edge all round hides any seam
    # where its tone meets the sheet's.
    panel = art.crop(crop).resize((ART_SIDE, ART_SIDE), Image.LANCZOS)
    mask = Image.new("L", (ART_SIDE, ART_SIDE), 0)
    ImageDraw.Draw(mask).rectangle([28, 28, ART_SIDE - 29, ART_SIDE - 29], fill=255)
    canvas.paste(panel, (ART_X, ART_Y), mask.filter(ImageFilter.GaussianBlur(16)))

    d = ImageDraw.Draw(canvas)
    wordmark(canvas, d, TEXT_X, TOP - 6)

    eyebrow_font = font("SpaceGrotesk.ttf", 17, 600)
    if tracked_width(d, card.eyebrow, eyebrow_font, 2.6) > TEXT_W:
        sys.exit(f"ERROR: eyebrow {card.eyebrow!r} is wider than the column")
    eyebrow_y = TOP + 74
    d.rectangle([TEXT_X, eyebrow_y, TEXT_X + 32, eyebrow_y + 4], fill=card.accent)
    tracked(d, (TEXT_X, eyebrow_y + 16), card.eyebrow, eyebrow_font, card.accent, 2.6)

    rule_y = BOTTOM - 34
    head_top = eyebrow_y + 56
    size = headline_size(d, card, rule_y - 24 - head_top)
    roman = font("Newsreader.ttf", size, 500)
    italic = font("Newsreader-Italic.ttf", size, 400)
    lead = round(size * 1.12)
    y = head_top + roman.getmetrics()[0]
    for line in card.headline.split("\n"):
        d.text((TEXT_X, y), line, font=roman, fill=INK, anchor="ls")
        y += lead
    for line in card.italic.split("\n"):
        d.text((TEXT_X, y), line, font=italic, fill=card.accent, anchor="ls")
        y += lead

    detail_font = font("SpaceGrotesk.ttf", 15, 500)
    detail = card.detail.upper()
    if tracked_width(d, detail, detail_font, 1.4) > TEXT_W:
        sys.exit(f"ERROR: detail {card.detail!r} is wider than the column")
    d.line([TEXT_X, rule_y, TEXT_X + TEXT_W, rule_y], fill=INK, width=2)
    tracked(d, (TEXT_X, rule_y + 16), detail, detail_font, MUTED, 1.4)

    canvas = grain(canvas)
    out = OUT / card.out
    for quality in (88, 84, 80, 76):
        canvas.save(out, format="JPEG", quality=quality, optimize=True, progressive=True,
                    subsampling="4:4:4" if quality >= 84 else "4:2:0")
        if out.stat().st_size <= MAX_BYTES:
            break
    else:
        sys.exit(f"ERROR: {out} is {out.stat().st_size // 1024} KB, over {MAX_BYTES // 1024} KB")
    print(f"wrote {out}  {out.stat().st_size / 1024:.0f} KB  {W}x{H}  headline {size} px")
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    for card in CARDS:
        if not only or card.out in only:
            render(card)


if __name__ == "__main__":
    main()
