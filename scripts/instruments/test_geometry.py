"""Tests for the Census 2011 boundary reader and the site verdict.

WHY THIS EXISTS
---------------
The shapefile reader is hand-written and load-bearing: every geometric verdict
the instrument publishes rests on it, and a boundary file of the wrong vintage
looks exactly like a boundary file of the right one until a point is tested
against it. An earlier build used a layer that carried 102 post-2011 districts
under 2011 codes and unioned eight Mizoram districts with eight Nagaland ones;
it read as correct, produced confident verdicts, and was wrong for ten states.

TWO HALVES, AND WHY
-------------------
The structural half needs no boundary file and therefore runs everywhere,
including on the plain checkout CI uses. Putting every check behind the
presence of the fetch cache meant CI reported green over zero assertions - the
suite existed and tested nothing exactly where it mattered.

The file half runs only where the boundary file is present, and its point
checks are chosen to fail on precisely the wrong-vintage error above: four
districts created AFTER 2011, which must resolve to their 2011 PARENT, and the
Mizoram/Nagaland pair that a shared district code would union.

  INSTRUMENTS_CACHE_DIR=... python scripts/instruments/test_geometry.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from geometry import (  # noqa: E402
    DistrictGeometry, _norm, _rings_to_polygon, read_dbf, read_shp_polygons)

PASS = FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def structural() -> None:
    """Checks that need no boundary file, so they run on a bare clone."""
    from shapely.geometry import Polygon

    print("\nring orientation and holes")
    # Shapefile convention: an outer ring runs clockwise, a hole runs
    # counter-clockwise. Reversing that turns a district into its own hole -
    # a polygon that is still valid, and empty.
    outer_cw = [(0, 0), (0, 10), (10, 10), (10, 0), (0, 0)]
    hole_ccw = [(4, 4), (5, 4), (5, 5), (4, 5), (4, 4)]
    g = _rings_to_polygon([outer_cw, hole_ccw])
    check("an outer ring and its hole make a polygon with a hole",
          g is not None and abs(g.area - 99.0) < 1e-6,
          f"area {getattr(g, 'area', None)}")
    g2 = _rings_to_polygon([outer_cw])
    check("a lone outer ring keeps its whole area",
          g2 is not None and abs(g2.area - 100.0) < 1e-6,
          f"area {getattr(g2, 'area', None)}")
    g3 = _rings_to_polygon([[(0, 0), (1, 1), (0, 0)]])
    check("a degenerate ring yields nothing rather than a bad polygon",
          g3 is None or g3.is_empty, str(g3))
    island = [(20, 20), (20, 22), (22, 22), (22, 20), (20, 20)]
    g4 = _rings_to_polygon([outer_cw, island])
    check("two separate landmasses both survive",
          g4 is not None and abs(g4.area - 104.0) < 1e-6,
          f"area {getattr(g4, 'area', None)}")

    print("\nthe verdict, on synthetic districts")
    a = Polygon([(0, 0), (0, 10), (10, 10), (10, 0)])
    b = Polygon([(20, 0), (20, 10), (30, 10), (30, 0)])
    dg = DistrictGeometry.from_polygons({1: a, 2: b})
    for label, codes, pts, expect in [
        ("a block inside the named district", [1], [(5, 5)], "inside"),
        ("one block of two inside it", [1], [(5, 25), (5, 5)], "inside"),
        ("a block in a district not named", [1], [(5, 25)], "elsewhere"),
        ("a block in no district at all", [1], [(50, 50)], "offshore"),
        ("a district with no polygon held", [99], [(5, 5)], "no_geometry"),
        ("no blocks at all", [1], [], "no_geometry"),
    ]:
        verdict, _found, _at = dg.test_points(codes, pts)
        check(f"{label} reads as {expect}", verdict == expect, f"got {verdict}")

    # ── unmapped ground is not the sea ────────────────────────────────────
    #
    # datameet carries about 98,700 km2 of Jammu & Kashmir as one row with
    # censuscode 0 and DISTRICT "Data Not Available". It is correctly kept out
    # of the district index, and for a while it was simply forgotten - so a
    # point inside it fell in no district and `test()` said `offshore`, which
    # the profile page renders as "at sea". Seven filings were published that
    # way, among them the 240 MW Uri-I Stage-II hydroelectric project on the
    # Jhelum, 16 km from the nearest mapped district and several hundred from
    # any coast.
    hole = Polygon([(40, 0), (40, 10), (50, 10), (50, 0)])
    dgu = DistrictGeometry.from_polygons({1: a, 2: b}, unmapped=[hole])
    for label, codes, pts, expect in [
        ("a block on ground the source does not map", [1], [(5, 45)], "unmapped"),
        ("a block in genuine open sea", [1], [(50, 80)], "offshore"),
        # Precedence: a real district still wins, and so does a real
        # disagreement. `unmapped` is the answer only when there is nothing
        # else to say.
        ("a block inside the named district, with a hole present",
         [1], [(5, 5)], "inside"),
        ("a block in another named district, with a hole present",
         [1], [(5, 25)], "elsewhere"),
        ("one block unmapped and one inside", [1], [(5, 45), (5, 5)], "inside"),
    ]:
        verdict, _found, _at = dgu.test_points(codes, pts)
        check(f"{label} reads as {expect}", verdict == expect, f"got {verdict}")

    check("the single-point verdict agrees with the block verdict",
          dgu.test([1], 5, 45) == "unmapped", f"got {dgu.test([1], 5, 45)}")
    check("an index with no unmapped ground still says offshore",
          dg.test([1], 5, 45) == "offshore", f"got {dg.test([1], 5, 45)}")
    _vu, _fu, atu = dgu.test_points([1], [(5, 5.5), (5, 45)])
    check("the unmapped verdict points at the unmapped block",
          _vu == "inside" or atu == (5, 45), f"got {_vu} at {atu}")

    _v, _f, at = dg.test_points([1], [(5, 25), (5, 5)])
    check("the verdict points at the block that produced it",
          at == (5, 5), f"got {at}")
    check("that point is a coordinate, not an index into a filtered list",
          isinstance(at, tuple) and len(at) == 2, str(at))

    print("\ngeometry the build must refuse")
    check("too few polygons is refused",
          DistrictGeometry.from_polygons({1: a}).usable() is not None)
    dup = DistrictGeometry.from_polygons({i: a for i in range(1, 700)})
    dup.duplicate_codes = [5]
    check("a repeated census code is refused", dup.usable() is not None)
    torn = DistrictGeometry.from_polygons({i: a for i in range(1, 700)})
    torn.unreadable = 2
    check("an unreadable boundary record is refused", torn.usable() is not None)

    # THE THRESHOLDS THEMSELVES, pinned to a value.
    #
    # The three checks above prove usable() refuses SOMETHING, which stays
    # true however the constants move. Measured against the shipped code:
    # lowering the district floor from 600 to 2 kept every check green while
    # a boundary read that recovered three districts was declared fit to
    # publish; and widening BOUNDARY_TOLERANCE from 0.005 to 5.0 degrees -
    # roughly 550 km - kept every check green while turning the instrument's
    # central geometric finding, "the coordinates are elsewhere", into
    # "on the boundary" for the entire country.
    from geometry import BOUNDARY_TOLERANCE  # noqa: PLC0415
    check("the boundary tolerance is a hair's breadth, not a region",
          0 < BOUNDARY_TOLERANCE <= 0.01,
          f"{BOUNDARY_TOLERANCE} degrees is about "
          f"{BOUNDARY_TOLERANCE * 111:.0f} km")

    thin = DistrictGeometry.from_polygons({i: a for i in range(1, 600)})
    check("a boundary read that recovered 599 districts is refused",
          thin.usable() is not None,
          "the floor must sit at the Census frame, not at 'more than one'")
    full = DistrictGeometry.from_polygons({i: a for i in range(1, 641)})
    check("a boundary read that recovered all 640 is accepted",
          full.usable() is None, str(full.usable()))

    # THE DETECTORS THEMSELVES, driven through the real ingestion path.
    #
    # The three refusals above set `duplicate_codes` and `unreadable` by hand
    # and only prove usable() reacts to them. Nothing proved the reader ever
    # SETS them - so deleting the line that records a repeat, while keeping
    # the union that absorbs it, silently merged two districts into one
    # polygon with every check green. datameet is clean today; the file this
    # instrument refuses to use is not, and shares codes across eight Mizoram
    # and eight Nagaland districts.
    def _index():
        g = DistrictGeometry.__new__(DistrictGeometry)
        g.by_code, g.names = {}, {}
        g.duplicate_codes, g.unreadable, g.skipped_placeholder = [], 0, 0
        g.unmapped = []
        return g

    dupfeed = _index()
    dupfeed.ingest(
        [{"censuscode": "7", "DISTRICT": "A", "ST_NM": "S"},
         {"censuscode": "7", "DISTRICT": "B", "ST_NM": "S"}],
        [a, a],
    )
    check("the reader RECORDS a repeated census code", dupfeed.duplicate_codes == [7],
          str(dupfeed.duplicate_codes))

    tornfeed = _index()
    tornfeed.ingest([{"censuscode": "9", "DISTRICT": "A", "ST_NM": "S"}], [None])
    check("the reader COUNTS a geometry it could not read",
          tornfeed.unreadable == 1, str(tornfeed.unreadable))

    placeholder = _index()
    placeholder.ingest([{"censuscode": "0", "DISTRICT": "", "ST_NM": ""}], [a])
    check("the censuscode 0 placeholder never enters the index",
          placeholder.skipped_placeholder == 1 and not placeholder.by_code,
          f"{placeholder.skipped_placeholder}, {list(placeholder.by_code)}")
    # ...but it is not thrown away either. Forgetting it is what made "the
    # source does not map this ground" indistinguishable from "this is the
    # sea", and published seven inland Kashmir filings as being at sea.
    check("the placeholder's geometry is kept as unmapped ground",
          len(placeholder.unmapped) == 1, f"{len(placeholder.unmapped)}")


def against_the_file(shp: Path) -> None:
    """Checks that need the real Census 2011 boundary file."""
    print("\nfile structure")
    attrs = read_dbf(shp.with_suffix(".dbf"))
    shapes = read_shp_polygons(shp)
    check("attribute rows pair one-to-one with geometries",
          len(attrs) == len(shapes), f"{len(attrs)} vs {len(shapes)}")
    check("every record yielded a geometry",
          all(g is not None for g in shapes),
          f"{sum(1 for g in shapes if g is None)} unreadable")
    check("the attribute table carries the census code",
          bool(attrs) and "censuscode" in attrs[0], str(list(attrs[0])[:6]))

    print("\nthe 2011 frame")
    dg = DistrictGeometry(shp)
    codes = sorted(dg.by_code)
    check("640 districts, and only the 640", len(codes) == 640, str(len(codes)))
    check("codes run 1..640 with no gaps", codes == list(range(1, 641)),
          f"{codes[:3]}..{codes[-3:]}" if codes else "none")
    check("no census code is used twice", not dg.duplicate_codes,
          str(dg.duplicate_codes[:8]))
    check("the geometry is usable", dg.usable() is None, str(dg.usable()))

    print("\nplaces that discriminate a wrong-vintage boundary file")
    # Four districts created AFTER 2011, which must resolve to their 2011
    # parent, and the Mizoram/Nagaland pair a shared district code would union.
    # Bijapur is deliberately absent: it was created in 2007 and so is a Census
    # 2011 district in its own right.
    for label, lat, lon, expect in [
        ("Palghar town", 19.6967, 72.7655, "Thane"),
        ("Asansol", 23.6739, 86.9524, "Barddhaman"),
        ("Veraval", 20.9070, 70.3670, "Junagadh"),
        ("Morbi town", 22.8173, 70.8370, "Rajkot"),
        ("Mandla town", 22.5980, 80.3710, "Mandla"),
        ("Aizawl", 23.7271, 92.7176, "Aizawl"),
        ("Mon", 26.7509, 95.0000, "Mon"),
        ("Connaught Place", 28.6315, 77.2167, "New Delhi"),
        ("Jaipur", 26.9124, 75.7873, "Jaipur"),
        ("Umaria", 23.5250, 80.8370, "Umaria"),
    ]:
        code = dg.locate(lat, lon)
        got = dg.names.get(code, ("none", ""))[0] if code else "NONE"
        check(f"{label} resolves to {expect}", _norm(got) == _norm(expect),
              f"got {got!r}")

    print("\nthe verdict rests on a real block")
    mandla = next(c for c, n in dg.names.items() if _norm(n[0]) == "mandla")
    quarry = (22.6853, 80.5821)      # well inside Mandla, not on its edge
    far = (25.550, 74.000)           # Rajasthan, hundreds of km away
    verdict, _found, at = dg.test_points([mandla], [far, quarry])
    check("a project with one block in the named district reads as inside",
          verdict == "inside", f"verdict {verdict}")
    check("and the published point is that block, not the far one",
          at == quarry, f"got {at}")
    v2, _f2, _a2 = dg.test_points([mandla], [far])
    check("a project with no block in the named district does not read as inside",
          v2 != "inside", f"verdict {v2}")

    print("\nthe sea is not a district")
    v3, found3, _a3 = dg.test_points([mandla], [(15.0, 70.0)])
    check("a point in the Arabian Sea is offshore, not elsewhere",
          v3 == "offshore", f"verdict {v3}, found {found3}")


def main() -> int:
    structural()

    cache = os.environ.get("INSTRUMENTS_CACHE_DIR", "")
    shp = Path(cache) / "geo" / "2011_Dist.shp" if cache else None
    ran_file_checks = bool(shp and shp.exists())
    if ran_file_checks:
        against_the_file(shp)
    else:
        print()
        print("boundary file not in the cache; the file-dependent "
              "checks are skipped.")
        print("Set INSTRUMENTS_CACHE_DIR and fetch to run them.")

    print()
    if FAIL:
        print(f"{FAIL} of {PASS + FAIL} checks FAILED")
        return 1

    # The summary must say WHICH half ran.
    #
    # This printed a bare "all 15 checks passed" when the file-dependent half
    # was skipped, and CI never supplies the cache - so the step named
    # "Boundary reader and site verdict" went green on every commit having
    # tested no boundary file and no site verdict. A green line that reads
    # the same whether or not the discriminating checks ran is worse than no
    # line at all, because it gets quoted as evidence that they did.
    #
    # Exit status stays 0 without the cache: the structural half is a real
    # gate and a contributor who has not fetched should not be blocked. What
    # changes is that the sentence can no longer be mistaken for full
    # coverage. Set INSTRUMENTS_GEOMETRY_REQUIRE_FILE=1 where the cache IS
    # expected - the nightly sync - and a skip becomes a failure.
    if ran_file_checks:
        print(f"all {PASS} checks passed (structural and file-dependent)")
        return 0

    print(f"all {PASS} STRUCTURAL checks passed")
    print("NOT RUN: the file-dependent checks - wrong-vintage boundary "
          "detection, the shared-code union, and every point-in-district "
          "verdict. This run tested none of them.")
    if os.environ.get("INSTRUMENTS_GEOMETRY_REQUIRE_FILE"):
        print("INSTRUMENTS_GEOMETRY_REQUIRE_FILE is set and the boundary file "
              "was absent, so this run is a failure.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
