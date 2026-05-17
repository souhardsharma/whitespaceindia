"""Re-encode landing images for the risograph poster landing.

Preserves the ORIGINAL riso colours of all four illustrations — red CSR,
blue Health, green Energy, tan Education. No desaturation. The colour
palette IS the brand identity.

Crops to landscape 3:2 so the tiles read as poster blocks rather than
narrow strips. Long edge 1600 px, WebP q=80.

Run from repo root:  python scripts/optimize_landing.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

SRC_DIR = Path("public/landing/_orig_backup")
OUT_DIR = Path("public/landing")
TARGETS = ["csr-hands", "education-bg", "energy-bg", "health-bg"]
LONG_EDGE = 1600
ASPECT = (3, 2)  # landscape poster tile
QUALITY = 80


def crop_to_aspect(img: Image.Image, ratio_w: int, ratio_h: int) -> Image.Image:
    w, h = img.size
    target = ratio_w / ratio_h
    current = w / h
    if current > target:
        new_w = int(round(h * target))
        x0 = (w - new_w) // 2
        return img.crop((x0, 0, x0 + new_w, h))
    new_h = int(round(w / target))
    y0 = (h - new_h) // 2
    return img.crop((0, y0, w, y0 + new_h))


def resize_long_edge(img: Image.Image, long_edge: int) -> Image.Image:
    w, h = img.size
    if max(w, h) <= long_edge:
        return img
    if h >= w:
        new_h = long_edge
        new_w = int(round(w * long_edge / h))
    else:
        new_w = long_edge
        new_h = int(round(h * long_edge / w))
    return img.resize((new_w, new_h), Image.LANCZOS)


def encode_and_save(img: Image.Image, out: Path) -> int:
    img.save(out, format="WEBP", quality=QUALITY, method=6)
    return out.stat().st_size


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    total = 0
    for name in TARGETS:
        src = SRC_DIR / f"{name}.webp"
        dst = OUT_DIR / f"{name}.webp"
        img = Image.open(src).convert("RGB")
        cropped = crop_to_aspect(img, *ASPECT)
        resized = resize_long_edge(cropped, LONG_EDGE)
        size = encode_and_save(resized, dst)
        total += size
        print(f"{name:>14}: {resized.size}  {size // 1024} KB")
    print(f"{'TOTAL':>14}: {total // 1024} KB")


if __name__ == "__main__":
    main()
