"""Generate the Instruments landing tile in the risograph family.

The other four tiles were produced through Gemini's chat interface. This one is
drawn programmatically so the fifth tile has artwork in the right colour and
idiom without needing an authenticated session. It matches the family on the
characteristics that actually carry the look:

  one spot colour on cream, no third hue
  flat shapes, no gradients
  a halftone-dot tint instead of a lighter solid
  slight plate misregistration
  visible paper grain
  a simple symbolic subject with generous negative space

Subject: a dial with a scale, a plumb line dropped to a ground contour, and
figures standing on it. An instrument measuring people on land.

Writes the full-resolution original to public/landing/_orig_backup/, which is
the source of truth for re-encoding. Run scripts/optimize_landing.py afterwards
to produce the served WebP.

Run from the project root:  python scripts/make_instruments_tile.py
"""
from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path("public/landing/_orig_backup/instruments-bg.webp")
W, H = 2400, 1600          # 3:2, matching optimize_landing.py's ASPECT
SS = 2                     # supersample factor for clean edges

PLUM = (122, 59, 107)      # --plum #7a3b6b
CREAM = (243, 237, 225)    # --ivory #f3ede1

SEED = 20260821


def halftone(size: tuple[int, int], mask: Image.Image, colour, spacing: int = 14,
             radius: float = 4.2) -> Image.Image:
    """Dot screen clipped to `mask`. Stands in for a lighter ink tint."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for y in range(0, size[1] + spacing, spacing):
        offset = (spacing // 2) if (y // spacing) % 2 else 0
        for x in range(-spacing, size[0] + spacing, spacing):
            cx = x + offset
            d.ellipse([cx - radius, y - radius, cx + radius, y + radius],
                      fill=colour + (255,))
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.paste(layer, (0, 0), mask)
    return out


def draw_plate(size: tuple[int, int]) -> tuple[Image.Image, Image.Image]:
    """Return (solid_mask, tint_mask) for the artwork at `size`."""
    w, h = size
    solid = Image.new("L", size, 0)
    tint = Image.new("L", size, 0)
    ds = ImageDraw.Draw(solid)
    dt = ImageDraw.Draw(tint)

    # The composition sits in the upper two-thirds. The tile overlays a title
    # and a meta line across the bottom of the frame, so the lower third is
    # deliberately left as clear paper.
    cx, cy = int(w * 0.50), int(h * 0.355)
    R = int(h * 0.275)

    # ── dial: outer ring, drawn as an annulus
    ring = int(h * 0.020)
    ds.ellipse([cx - R, cy - R, cx + R, cy + R], outline=255, width=ring)

    # tick marks around the upper half of the dial, long every third
    for i in range(37):
        a = math.radians(180 + i * 5)
        long_tick = i % 3 == 0
        r0 = R - int(h * 0.030)
        r1 = r0 - int(h * (0.052 if long_tick else 0.028))
        ds.line([cx + r0 * math.cos(a), cy + r0 * math.sin(a),
                 cx + r1 * math.cos(a), cy + r1 * math.sin(a)],
                fill=255, width=int(h * (0.011 if long_tick else 0.006)))

    # ── inner disc as halftone tint, so the dial face reads as a lighter ink
    ri = R - int(h * 0.085)
    dt.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], fill=255)

    # ── needle: a tapered pointer from the pivot, held at about 40 degrees
    ang = math.radians(-52)
    tipx, tipy = cx + (ri - int(h * 0.03)) * math.cos(ang), cy + (ri - int(h * 0.03)) * math.sin(ang)
    perp = ang + math.pi / 2
    bw = int(h * 0.026)
    ds.polygon([
        (cx + bw * math.cos(perp), cy + bw * math.sin(perp)),
        (cx - bw * math.cos(perp), cy - bw * math.sin(perp)),
        (tipx, tipy),
    ], fill=255)
    pv = int(h * 0.042)
    ds.ellipse([cx - pv, cy - pv, cx + pv, cy + pv], fill=255)
    pv2 = int(h * 0.018)
    dt.ellipse([cx - pv2, cy - pv2, cx + pv2, cy + pv2], fill=0)

    # ── plumb line dropped from the pivot to the ground
    ground_y = int(h * 0.640)
    ds.line([cx, cy, cx, ground_y - int(h * 0.055)], fill=255, width=int(h * 0.008))
    bob = int(h * 0.028)
    ds.polygon([
        (cx - bob, ground_y - int(h * 0.075)),
        (cx + bob, ground_y - int(h * 0.075)),
        (cx, ground_y - int(h * 0.020)),
    ], fill=255)

    # ── ground contour: two stacked bands, the lower solid, the upper tinted
    def contour(dr, amp: float, base: int, fill: int) -> None:
        pts = [(0, h)]
        for x in range(0, w + 20, 20):
            t = x / w
            y = base + amp * (math.sin(t * math.pi * 1.7 + 0.6)
                              + 0.45 * math.sin(t * math.pi * 4.1 + 2.2))
            pts.append((x, y))
        pts.append((w, h))
        dr.polygon(pts, fill=fill)

    contour(dt, h * 0.030, ground_y - int(h * 0.045), 255)
    contour(ds, h * 0.024, ground_y + int(h * 0.020), 255)

    # ── figures standing on the ground line, deliberately uneven spacing
    rnd = random.Random(SEED)
    xs = [0.115, 0.190, 0.247, 0.330, 0.680, 0.742, 0.815, 0.878]
    for fx in xs:
        px = int(w * fx)
        scale = h * (0.076 + rnd.uniform(-0.009, 0.012))
        # feet sit on the contour
        t = px / w
        fy = (ground_y + int(h * 0.020)) + h * 0.024 * (
            math.sin(t * math.pi * 1.7 + 0.6) + 0.45 * math.sin(t * math.pi * 4.1 + 2.2))
        fy = int(fy) + int(h * 0.012)
        head = scale * 0.23
        ds.ellipse([px - head, fy - scale - head * 2, px + head, fy - scale], fill=255)
        bodyw = scale * 0.24
        ds.polygon([
            (px - bodyw * 0.72, fy),
            (px + bodyw * 0.72, fy),
            (px + bodyw, fy - scale * 0.92),
            (px - bodyw, fy - scale * 0.92),
        ], fill=255)

    return solid, tint


def main() -> None:
    big = (W * SS, H * SS)
    solid, tint = draw_plate(big)
    solid = solid.resize((W, H), Image.LANCZOS)
    tint = tint.resize((W, H), Image.LANCZOS)

    canvas = Image.new("RGB", (W, H), CREAM)

    # halftone tint plate, offset slightly — the misregistration riso is known for
    ht = halftone((W, H), tint, PLUM)
    canvas.paste(Image.new("RGB", (W, H), PLUM), (7, -5), ht.split()[3])

    # a soft ghost of the solid plate, offset the other way
    ghost = solid.point(lambda v: int(v * 0.20)).filter(ImageFilter.GaussianBlur(1.2))
    canvas.paste(Image.new("RGB", (W, H), PLUM), (-6, 4), ghost)

    # the solid ink plate
    canvas.paste(Image.new("RGB", (W, H), PLUM), (0, 0), solid)

    # paper grain: per-pixel noise, multiplied in
    rnd = random.Random(SEED)
    noise = Image.new("L", (W // 2, H // 2))
    noise.putdata([max(0, min(255, int(rnd.gauss(238, 13)))) for _ in range(
        (W // 2) * (H // 2))])
    noise = noise.resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.4))

    # multiply the grain over the whole sheet, so the tooth of the paper shows
    # through both the ink and the ground
    darker = Image.eval(canvas, lambda v: int(v * 0.86))
    canvas = Image.composite(canvas, darker, noise)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, format="WEBP", quality=92, method=6)
    print(f"wrote {OUT}  {OUT.stat().st_size/1024:.0f} KB  {W}x{H}")


if __name__ == "__main__":
    main()
