"""Census 2011 district boundaries, simplified for the web.

WHY THIS EXISTS
---------------
The repo ships `public/geo/india-states.topojson`, which carries a `districts`
layer that looks like exactly the right thing and is not: 102 of its 723
features post-date 2011, so a district carved out after the Census exists as
its own feature while the 2011 parent is present with that area already
removed - Thane's polygon is 45% of the real district. Its `dt_code` is not
unique either. Every figure this instrument publishes is joined on the Census
2011 `censuscode`, so a map drawn on that file would colour the wrong ground.

The boundaries here come from datameet's `2011_Dist.shp` in the fetch cache -
the same file the gazetteer's `.dbf` comes from, so `censuscode` joins by
construction rather than by name matching.

WHAT IT DOES TO THEM
--------------------
Simplifies and rounds. The source is 10 MB, which is not a thing to send to a
phone. Two lossy steps, both chosen so the loss is invisible at the scale the
map is drawn and stated here rather than discovered later:

  - Douglas-Peucker at SIMPLIFY_DEG.
  - Coordinates rounded to COORD_DP decimal places.

`preserve_topology=True` does NOT mean shared borders stay shared. It is a
per-geometry guarantee - the polygon will not self-intersect and will not
collapse to nothing - and shapely applies it to each district ALONE, with no
knowledge of its neighbours. Two districts sharing a border simplify that
border independently and their versions of it diverge, which opens a sliver
between them. This file said the opposite for a while; it was measured, and
the map carries 4,207 such slivers totalling 5,659 km2, 0.18% of the mapped
area.

That is tolerable only because of the scale this is drawn at. The national map
is ~700px across ~30 degrees of longitude, so SIMPLIFY_DEG is about a fifth of
a pixel and a sliver closes under the 0.5px stroke every district is drawn
with. It is NOT tolerable if the simplification is loosened or the geometry is
reused at a zoom where a degree is hundreds of pixels, so the total is asserted
against GAP_AREA_LIMIT below rather than left to be noticed on a screen.
Genuine topology-preserving simplification across a shared boundary needs
mapshaper or TopoJSON's quantised arcs; if the cracks ever matter, that is the
fix, not a smaller SIMPLIFY_DEG.

Neither is safe for the point-in-polygon test - `geometry.py` reads the full
shapefile for that, and must go on doing so. This file is for DRAWING.

  python scripts/instruments/build_geometry.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from geometry import read_dbf, read_shp_polygons  # noqa: E402

# About 1.1 km at this latitude. Below the width of a line on a national map,
# and far above the ~11 m the rounding costs.
SIMPLIFY_DEG = 0.01
COORD_DP = 4

# Smallest sub-polygon kept, in square degrees. One square degree at 20 N is
# 110.6 km by 104.6 km, so 1e-6 sq deg is about 11,600 m2 - a square 108 m on
# a side. Far below one pixel at national scale, and far above the artifacts
# simplification leaves behind. Kaithal came through with a second polygon of
# four points and an area of 2e-8 square degrees - about 230 m2, a square 15 m
# on a side. A ring
# that small has no meaningful winding, so orient() cannot fix it and d3-geo
# read it SPHERICALLY as the complement - rendering everything on the globe
# except that sliver, as one path across the whole map.
# A ring must survive the ROUNDING as well as the simplification. At 4 dp the
# coordinate grid is 1e-4 degrees, so a polygon a few grid cells across is
# destroyed by rounding - its vertices collapse onto each other and the signed
# area flips. Kaithal's sliver measured 1.3e-7 before rounding, cleared a 1e-7
# threshold, and came out the other side at -2e-8: correctly wound going in,
# inverted coming out, and rendered as the whole globe. The floor is set two
# orders above the grid cell so rounding cannot invert what passes it.
MIN_RING_AREA = 1e-6

# Total area of the slivers that open between neighbouring districts, because
# each simplifies its half of a shared border without reference to the other.
# Measured at 0.1769% of mapped area (5,659 km2 in 4,207 slivers) and bounded
# here at a quarter of one percent, so loosening SIMPLIFY_DEG fails the build
# instead of quietly cracking the map. See the header for why this cannot be
# fixed by preserve_topology.
GAP_AREA_LIMIT = 0.0025

# The same bound for the other direction. Two independently-simplified copies
# of a shared border diverge either way: roughly half open a gap and half an
# overlap, and the overlap is worse, because a point inside two outlines is
# claimed by whichever was drawn last and a click opens the wrong district.
# Measured at 0.1616% on this file, so the limit sits at the same distance
# above it as the gap limit sits above its own measurement.
OVERLAP_AREA_LIMIT = 0.0025

OUT = (Path(__file__).resolve().parent.parent.parent
       / "public" / "geo" / "districts-2011.geojson")


def _round_coords(geom, dp: int):
    """Recursively round every coordinate in a GeoJSON coordinate array."""
    if isinstance(geom, (list, tuple)):
        if geom and isinstance(geom[0], (int, float)):
            return [round(float(c), dp) for c in geom]
        return [_round_coords(g, dp) for g in geom]
    return geom


def main() -> None:
    cache = os.environ.get("INSTRUMENTS_CACHE_DIR")
    if not cache:
        sys.exit("ERROR: INSTRUMENTS_CACHE_DIR is not set. The district "
                 "shapefile lives in the fetch cache.")
    shp = Path(cache) / "geo" / "2011_Dist.shp"
    dbf = Path(cache) / "geo" / "2011_Dist.dbf"
    if not shp.exists():
        sys.exit(f"ERROR: {shp} not found. Fetch the sources first.")

    try:
        from shapely.geometry import mapping
    except ImportError:
        sys.exit("ERROR: shapely is required. pip install -r requirements.txt")

    polygons = read_shp_polygons(shp)
    rows = read_dbf(dbf)
    if len(polygons) != len(rows):
        sys.exit(f"ERROR: {len(polygons)} shapes against {len(rows)} attribute "
                 f"rows. The .shp and .dbf are index-aligned by construction, "
                 f"so a mismatch means one of them is not the file it claims.")

    features = []
    seen: dict[int, int] = {}
    dropped = 0
    slivers = 0
    for poly, row in zip(polygons, rows):
        code = row.get("censuscode")
        if code in (None, ""):
            dropped += 1
            continue
        code = int(code)
        if code == 0:
            # "Data Not Available", a placeholder row the source carries for
            # the part of Jammu & Kashmir it does not map. The gazetteer drops
            # it for the same reason: it is not a district, and leaving it in
            # would put a 641st feature on a map whose figures are keyed 1..640.
            dropped += 1
            continue
        if poly is None or poly.is_empty:
            dropped += 1
            continue
        # preserve_topology keeps THIS polygon valid - no self-intersection,
        # no collapse to nothing. It says nothing about the border it shares
        # with the district next to it, which is simplified separately over
        # there and ends up a slightly different line. See the header: the
        # resulting slivers are measured and bounded, not prevented.
        simple = poly.simplify(SIMPLIFY_DEG, preserve_topology=True)
        if simple.is_empty:
            simple = poly

        # WINDING IS LEFT AS THE SHAPEFILE HAS IT. d3-geo reads winding
        # spherically - a ring wound the wrong way means "everything on the
        # globe except this" - so it is tempting to normalise every ring to
        # RFC 7946 on the way out. Doing that inverted all 640 districts: the
        # source winding is already what d3 wants, and re-orienting broke what
        # was working to fix two that were not. What was actually wrong with
        # those two is below - sub-pixel slivers that rounding destroys.
        if simple.geom_type == "Polygon":
            parts = [simple]
        else:
            parts = list(simple.geoms)
        kept = [g for g in parts if g.area >= MIN_RING_AREA]
        slivers += len(parts) - len(kept)
        if not kept:
            # Everything about this district was below the threshold. Keep the
            # unsimplified shape rather than publishing no shape at all.
            kept = parts
        if len(kept) == 1:
            simple = kept[0]
        elif len(kept) != len(parts):
            from shapely.geometry import MultiPolygon
            simple = MultiPolygon(kept)
        geom = mapping(simple)
        geom["coordinates"] = _round_coords(geom["coordinates"], COORD_DP)
        if code in seen:
            # censuscode is the join key for every published figure. Two
            # features sharing one would silently colour a district with
            # another's numbers.
            sys.exit(f"ERROR: censuscode {code} appears twice in the "
                     f"shapefile. It is the join key and must be unique.")
        seen[code] = len(features)
        features.append({
            "type": "Feature",
            "id": code,
            "properties": {
                "code": code,
                "district": row.get("DISTRICT"),
                "state": row.get("ST_NM"),
            },
            "geometry": geom,
        })

    # POST-CONDITION, after rounding, because rounding is what broke it.
    # d3-geo reads winding spherically: a clockwise exterior means "everything
    # except this", so one bad ring paints the entire map. Checked here rather
    # than discovered in a browser.
    def _signed_area(ring) -> float:
        a = 0.0
        for i in range(len(ring) - 1):
            a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
        return a / 2

    # NORMALISE WINDING TO THE FILE'S OWN MAJORITY, then assert it took.
    #
    # The source winds its small islands opposite to its large landmasses -
    # South 24 Parganas is the Sundarbans, 72 sub-polygons, and its islands
    # come through negative while the mainland is positive. d3-geo reads
    # winding SPHERICALLY, so a ring wound against the rest renders as the
    # whole globe minus itself: one path over the entire map.
    #
    # Two things this deliberately does NOT do. It does not re-orient every
    # ring to RFC 7946 - tried, and it inverted all 640 districts, because the
    # source convention is already the one d3 wants. And it does not drop the
    # offending rings - they are real islands, and an instrument that silently
    # deletes the Sundarbans to make a renderer happy is not one to trust.
    def _flip(ring):
        return list(reversed(ring))

    pre_signs = []
    for f in features:
        geom = f["geometry"]
        polys = (geom["coordinates"] if geom["type"] == "MultiPolygon"
                 else [geom["coordinates"]])
        for poly in polys:
            pre_signs.append(_signed_area(poly[0]))
    pos = sum(1 for a in pre_signs if a > 0)
    neg = sum(1 for a in pre_signs if a < 0)
    want = 1 if pos >= neg else -1

    flipped = 0
    for f in features:
        geom = f["geometry"]
        polys = (geom["coordinates"] if geom["type"] == "MultiPolygon"
                 else [geom["coordinates"]])
        for poly in polys:
            a = _signed_area(poly[0])
            if a != 0 and (1 if a > 0 else -1) != want:
                # Exterior and every hole, so their relationship survives.
                for k in range(len(poly)):
                    poly[k] = _flip(poly[k])
                flipped += 1
    if flipped:
        print(f"  {flipped} ring(s) wound against the other {max(pos, neg)}, "
              f"reversed to match")

    # DEGENERATE HOLES, dropped before anything is asserted about them.
    #
    # Rounding collapses a small interior ring exactly as it collapses a small
    # exterior, and nothing above looks at interiors: MIN_RING_AREA is applied
    # to `parts`, which are sub-POLYGONS, and both winding passes read poly[0]
    # only. Two rings of zero area were published this way and sat in the file
    # unexamined. A hole with no area is not a hole; it is four rounded points
    # on top of each other, and d3-geo is entitled to read its winding either
    # way.
    holes_dropped = 0
    for f in features:
        geom = f["geometry"]
        polys = (geom["coordinates"] if geom["type"] == "MultiPolygon"
                 else [geom["coordinates"]])
        for poly in polys:
            keep = [poly[0]] + [r for r in poly[1:]
                                if abs(_signed_area(r)) > 0]
            holes_dropped += len(poly) - len(keep)
            poly[:] = keep

    # CONSISTENCY, not a fixed convention. Which way the source winds its
    # rings is the source's business; what matters is that every ring winds
    # the SAME way, because d3-geo renders an odd one out as the whole globe
    # minus itself - one path over the entire map. Asserted after rounding,
    # because rounding is what inverted the ring that caused this.
    #
    # The sign half of this cannot fire on an exterior any more - the loop
    # above flips every exterior to the majority, so re-deriving the majority
    # here and comparing is a tautology. It is kept because the ZERO-area half
    # is not: the flip skips `a == 0`, so a ring that rounding flattened
    # reaches here untouched, and that is the failure this was written for.
    signs = []
    for f in features:
        geom = f["geometry"]
        polys = (geom["coordinates"] if geom["type"] == "MultiPolygon"
                 else [geom["coordinates"]])
        for poly in polys:
            signs.append((f["properties"]["district"], _signed_area(poly[0])))
    positive = sum(1 for _, a in signs if a > 0)
    negative = sum(1 for _, a in signs if a < 0)
    majority = 1 if positive >= negative else -1
    odd = [d for d, a in signs
           if a == 0 or (1 if a > 0 else -1) != majority]
    if odd:
        sys.exit(
            f"ERROR: {len(odd)} ring(s) wind against the other "
            f"{max(positive, negative)}, or have zero area, AFTER rounding: "
            f"{sorted(set(odd))[:5]}. d3-geo reads winding spherically, so "
            f"each renders as the whole globe minus itself. Raise "
            f"MIN_RING_AREA or COORD_DP.")

    # HOLES WIND AGAINST THEIR OWN EXTERIOR. A hole wound the same way as the
    # ring containing it is not subtracted - it is drawn as more land, so a
    # district with a lake in it is painted over the lake and its area silently
    # grows. The flip loop preserves this relationship (it reverses every ring
    # in a polygon together), which is exactly why it must be checked: a future
    # edit that flips only poly[0] would break every one of these at once.
    bad_holes = []
    holes = 0
    for f in features:
        geom = f["geometry"]
        polys = (geom["coordinates"] if geom["type"] == "MultiPolygon"
                 else [geom["coordinates"]])
        for poly in polys:
            outer = _signed_area(poly[0])
            for ring in poly[1:]:
                holes += 1
                a = _signed_area(ring)
                if a == 0 or (a > 0) == (outer > 0):
                    bad_holes.append(f["properties"]["district"])
    if bad_holes:
        sys.exit(
            f"ERROR: {len(bad_holes)} interior ring(s) do not wind against "
            f"the exterior containing them: {sorted(set(bad_holes))[:5]}. "
            f"A hole wound with its exterior is drawn as land, not subtracted "
            f"from it.")

    # THE FRAME. Checked BEFORE the write, with everything else: a build that
    # fails must leave the previous map in place, not replace it with one that
    # did not pass and then complain. This assertion used to run four lines
    # after the file had already been overwritten.
    if len(features) != 640:
        sys.exit(f"ERROR: expected 640 Census 2011 districts, got "
                 f"{len(features)}. The published figures are keyed 1..640, so "
                 f"a map with a different count is a different frame.")
    codes = sorted(f["id"] for f in features)
    if codes != list(range(1, 641)):
        missing = sorted(set(range(1, 641)) - set(codes))
        extra = sorted(set(codes) - set(range(1, 641)))
        sys.exit(f"ERROR: census codes are not exactly 1..640. "
                 f"missing={missing[:5]} unexpected={extra[:5]}")

    # THE SLIVERS BETWEEN NEIGHBOURS, measured rather than asserted away.
    # See the header: shapely simplifies each district without reference to
    # the one beside it, so a shared border becomes two slightly different
    # lines with a gap between them. Sub-pixel at the scale this is drawn, and
    # bounded here so that loosening SIMPLIFY_DEG fails the build rather than
    # cracking the map somewhere nobody is looking.
    try:
        from shapely.geometry import Polygon, shape
        from shapely.ops import unary_union
    except ImportError:  # pragma: no cover - shapely checked above
        sys.exit("ERROR: shapely is required.")
    merged = unary_union([shape(f["geometry"]).buffer(0) for f in features])
    pieces = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
    gap_area = sum(Polygon(r).area for p in pieces for r in p.interiors)
    gap_rings = sum(len(p.interiors) for p in pieces)
    mapped = sum(shape(f["geometry"]).buffer(0).area for f in features)
    gap_share = gap_area / mapped if mapped else 0.0
    if gap_share > GAP_AREA_LIMIT:
        sys.exit(
            f"ERROR: {gap_share*100:.4f}% of the mapped area is gaps between "
            f"neighbouring districts ({gap_rings} slivers), over the "
            f"{GAP_AREA_LIMIT*100:.2f}% limit. Simplification does not "
            f"preserve a shared border; at this size the cracks are visible. "
            f"Lower SIMPLIFY_DEG, or simplify with mapshaper/TopoJSON arcs.")

    # THE OTHER HALF OF THE SAME DEFECT: OVERLAPS.
    #
    # The check above measures the HOLES the simplification opens between
    # neighbours. When two independently-simplified versions of a shared border
    # diverge, roughly half the time they diverge the other way and the
    # districts overlap instead - and nothing measured that at all, although an
    # overlap is the more consequential of the two:
    #
    #   a GAP means a point belongs to no district on the map, which shows as
    #   nothing being highlighted;
    #   an OVERLAP means a point belongs to TWO, and then whichever feature was
    #   drawn last captures the pointer - so a reader clicking a district opens
    #   a different district's page, consistently, with no way to tell.
    #
    # Measured on the file this build produces: 1,515 overlapping pairs,
    # 5,271 km2, 0.1616% of the mapped area, 376 of them across a state line,
    # and 275 of the register's published points sit inside two outlines at
    # once. Bounded here for the same reason the gaps are: so loosening
    # SIMPLIFY_DEG fails the build instead of quietly making the map ambiguous.
    from shapely.strtree import STRtree
    polys = [shape(f["geometry"]).buffer(0) for f in features]
    tree = STRtree(polys)
    overlap_area = 0.0
    overlap_pairs = 0
    for i, g in enumerate(polys):
        for j in tree.query(g):
            if j <= i:
                continue
            h = polys[j]
            try:
                if not g.overlaps(h):
                    continue
                inter = g.intersection(h).area
            except Exception:  # noqa: BLE001
                continue
            if inter > 0:
                overlap_pairs += 1
                overlap_area += inter
    overlap_share = overlap_area / mapped if mapped else 0.0
    if overlap_share > OVERLAP_AREA_LIMIT:
        sys.exit(
            f"ERROR: {overlap_share*100:.4f}% of the mapped area is districts "
            f"overlapping each other ({overlap_pairs} pairs), over the "
            f"{OVERLAP_AREA_LIMIT*100:.2f}% limit. A point inside two outlines "
            f"is claimed by whichever is drawn last, so a click opens the wrong "
            f"district. Lower SIMPLIFY_DEG, or simplify with "
            f"mapshaper/TopoJSON arcs.")

    # EVERYTHING PASSED. Only now is the previous file replaced.
    fc = {"type": "FeatureCollection", "features": features}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")

    size = OUT.stat().st_size
    import gzip
    gz = len(gzip.compress(OUT.read_bytes()))
    print(f"  {len(features)} districts written ({dropped} shapes without a code)")
    print(f"  {slivers} sub-polygon(s) under {MIN_RING_AREA} sq deg dropped as "
          f"simplification artifacts")
    print(f"  {holes} interior ring(s) kept, {holes_dropped} dropped as "
          f"zero-area after rounding")
    print(f"  {gap_share*100:.4f}% of mapped area in {gap_rings} border slivers "
          f"(limit {GAP_AREA_LIMIT*100:.2f}%)")
    print(f"  {overlap_share*100:.4f}% of mapped area in {overlap_pairs} "
          f"overlapping pairs (limit {OVERLAP_AREA_LIMIT*100:.2f}%)")
    print(f"  simplify {SIMPLIFY_DEG} deg, {COORD_DP} dp")
    print(f"  {size/1024:,.0f} KB on disk, {gz/1024:,.0f} KB gzipped")
    print(f"  -> {OUT}")


if __name__ == "__main__":
    main()
