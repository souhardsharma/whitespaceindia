"""District geometry, and the geometric test of where a project actually is.

WHY THIS EXISTS
---------------
Every other statement about a project's location comes from one document: the
Common Application Form the proponent filed. The village, sub-district and
district codes on it are the spine the whole profile hangs from, and they are
all the same claim, made once, by the applicant.

The form also carries something different in kind: the corner coordinates of
the mapped site. Those are a position on the earth, not an administrative code,
and they can be tested. Dropping the site centre into the Census 2011 district
boundaries answers, independently of any code, which district the project is
in. Where that agrees with the filed codes, the location is corroborated by
something the filing did not assert. Where it disagrees, the record says so.

This runs over the whole register on every build, offline, at no network cost -
which is what distinguishes it from sampling clearance letters.

THE BOUNDARY SOURCE MUST BE THE 2011 FRAME, AND ONLY THE 2011 FRAME
-------------------------------------------------------------------
Boundaries are read from datameet's `2011_Dist.shp`, the same file whose `.dbf`
supplies the gazetteer. Because both sides come from one file, `censuscode`
identifies a district in the geometry and in the population tables by
construction, with no crosswalk to go wrong.

`public/geo/india-states.topojson` is NOT usable for this and must not be
substituted. It carries a districts layer that looks like the right thing and
is not: 102 of its 723 features post-date 2011 - Palghar, Gir Somnath, Morbi,
Paschim Bardhaman, Baloda Bazar and others exist as their own features, which
means the 2011 parent they were carved from is present with that area already
removed. Thane's polygon there is 45% of the Census 2011 district; Karimnagar's
is 19%. Its `year` property does not identify the affected features reliably -
Thane is tagged `2011_c` and is nonetheless the post-2014 shape. Separately its
`dt_code` is not unique: eight Mizoram districts share codes 261-268 with eight
Nagaland districts, and four Tamil Nadu districts carry code "0", so keying on
it silently unions districts 400 km apart in different states.

Used with that layer, this test reports inland projects in Palghar and Paschim
Bardhaman as being in no district at all, and corroborates a proposal filed in
Mon against coordinates in Aizawl. Both failures point the wrong way: they read
as findings about the filing rather than as faults in the reference data.

RING ORIENTATION
----------------
The shapefile polygon record stores every ring of a district in one part list.
By the specification an outer ring runs clockwise and a hole runs
counter-clockwise, which in the usual signed-area convention is negative for
outer and positive for holes. Rings are separated on that sign and each hole is
attached to the smallest outer ring that contains it, so island districts with
several landmasses and districts with enclaves both come out right.

  source:  datameet Census 2011 district boundaries (2011_Dist.shp + .dbf)
  used by: build_data.py
"""
from __future__ import annotations

import json
import re
import struct
import unicodedata
from pathlib import Path

try:
    from shapely.geometry import MultiPolygon, Point, Polygon
    from shapely.prepared import prep
    from shapely.strtree import STRtree
    HAVE_SHAPELY = True
except Exception:  # noqa: BLE001
    HAVE_SHAPELY = False

# How close to a boundary counts as "on it", in degrees. The datameet outlines
# are full resolution rather than simplified, so this only has to absorb the
# difference between a mapped boundary and a surveyed one - about 500 m.
BOUNDARY_TOLERANCE = 0.005


# ── Shapefile reading ─────────────────────────────────────────────────────
def read_dbf(path: Path) -> list[dict]:
    """dBase III records, in file order. Order matters: it pairs with the .shp.

    Rows flagged deleted in dBase (an asterisk in the first byte) are KEPT and
    returned in place. That is deliberate and load-bearing: the .shp has no
    corresponding deletion flag, so dropping a row here would shift every
    subsequent attribute record against its geometry and silently rename half
    the districts in the country. This file carries no deleted rows today; the
    invariant is that the two files stay index-aligned regardless.
    """
    with open(path, "rb") as fh:
        head = fh.read(32)
        numrec, hdrlen, reclen = struct.unpack("<IHH", head[4:12])
        fields = []
        for _ in range((hdrlen - 33) // 32):
            fd = fh.read(32)
            fields.append((fd[:11].split(b"\x00")[0].decode("latin-1"), fd[16]))
        fh.read(hdrlen - 32 - len(fields) * 32)
        rows = []
        for _ in range(numrec):
            rec = fh.read(reclen)
            if len(rec) < reclen:
                break
            off, out = 1, {}
            for name, ln in fields:
                out[name] = rec[off:off + ln].decode("latin-1").strip()
                off += ln
            rows.append(out)
    return rows


def _rings_to_polygon(rings: list[list[tuple[float, float]]]):
    """Assemble one district from its rings, honouring the hole convention."""
    outers, holes = [], []
    for r in rings:
        if len(r) < 4:
            continue
        # Shoelace. Shapefile outer rings are clockwise, negative in this sign
        # convention; holes run the other way.
        area2 = sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
                    for i in range(len(r) - 1))
        (holes if area2 > 0 else outers).append(r)
    if not outers:
        outers, holes = holes, []
    if not outers:
        return None

    polys = []
    for ring in outers:
        try:
            polys.append(Polygon(ring))
        except Exception:  # noqa: BLE001
            continue
    if not polys:
        return None

    # Attach each hole to the smallest outer ring that contains it, so an
    # enclave is subtracted from the district that actually surrounds it.
    assigned: dict[int, list] = {}
    for h in holes:
        try:
            hp = Polygon(h)
        except Exception:  # noqa: BLE001
            continue
        best, best_area = None, None
        for i, p in enumerate(polys):
            if p.contains(hp) and (best_area is None or p.area < best_area):
                best, best_area = i, p.area
        if best is not None:
            assigned.setdefault(best, []).append(h)

    built = []
    for i, p in enumerate(polys):
        try:
            built.append(Polygon(p.exterior.coords, assigned.get(i, [])))
        except Exception:  # noqa: BLE001
            built.append(p)
    geom = built[0] if len(built) == 1 else MultiPolygon(built)
    return geom.buffer(0)


def read_shp_polygons(path: Path) -> list[object]:
    """Polygon geometry per record, in file order. None for unreadable records."""
    data = Path(path).read_bytes()
    out: list[object] = []
    pos, end = 100, len(data)
    while pos + 8 <= end:
        _num, clen = struct.unpack(">ii", data[pos:pos + 8])
        pos += 8
        body = data[pos:pos + clen * 2]
        pos += clen * 2
        if len(body) < 4:
            out.append(None)
            continue
        shape_type, = struct.unpack("<i", body[:4])
        if shape_type != 5 or not HAVE_SHAPELY:      # 5 = Polygon
            out.append(None)
            continue
        nparts, npoints = struct.unpack("<ii", body[36:44])
        parts = struct.unpack(f"<{nparts}i", body[44:44 + 4 * nparts])
        pofs = 44 + 4 * nparts
        coords = struct.unpack(f"<{2 * npoints}d", body[pofs:pofs + 16 * npoints])
        pts = [(coords[i * 2], coords[i * 2 + 1]) for i in range(npoints)]
        bounds = list(parts) + [npoints]
        rings = [pts[bounds[i]:bounds[i + 1]] for i in range(nparts)]
        out.append(_rings_to_polygon(rings))
    return out


def _norm(name: object) -> str:
    s = unicodedata.normalize("NFKD", str(name or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", s.lower())


class DistrictGeometry:
    """Census 2011 district polygons, keyed by national census code."""

    def __init__(self, shp_path: Path, dbf_path: Path | None = None):
        shp_path = Path(shp_path)
        dbf_path = Path(dbf_path) if dbf_path else shp_path.with_suffix(".dbf")
        if not shp_path.exists() or not dbf_path.exists():
            raise FileNotFoundError(
                f"Census 2011 district boundaries not found: {shp_path} / "
                f"{dbf_path}. Fetch them with build_data.py --fetch.")

        attrs = read_dbf(dbf_path)
        shapes = read_shp_polygons(shp_path)
        if len(attrs) != len(shapes):
            raise ValueError(f"shapefile mismatch: {len(attrs)} attribute rows, "
                             f"{len(shapes)} geometries")

        self.by_code: dict[int, object] = {}
        self.names: dict[int, tuple[str, str]] = {}
        self.duplicate_codes: list[int] = []
        self.unreadable = 0
        self.skipped_placeholder = 0
        # Ground the boundary source carries but does not name as a district.
        # KEPT, not discarded: see `unmapped` in test()'s docstring.
        self.unmapped: list[object] = []

        self.ingest(attrs, shapes)

        self._prepared = {c: prep(g) for c, g in self.by_code.items()} \
            if HAVE_SHAPELY else {}
        self._codes = list(self.by_code)
        self._tree = (STRtree([self.by_code[c] for c in self._codes])
                      if HAVE_SHAPELY and self._codes else None)
        self._unmapped_prepared = ([prep(g) for g in self.unmapped]
                                   if HAVE_SHAPELY else [])

    def ingest(self, attrs, shapes) -> None:
        """Fold the attribute rows and geometries into the index.

        A method rather than a loop inside __init__ so it can be
        exercised without a shapefile. It was inline, and the
        duplicate-code detector below was therefore untestable on a bare
        clone: deleting the line that RECORDS a repeat, while keeping the
        union that absorbs it, left every check in test_geometry green
        and two districts sharing a code would have been silently merged
        into one polygon. That is the exact trap india-states.topojson
        sets, where eight Mizoram districts share codes with eight in
        Nagaland.
        """
        for row, shp in zip(attrs, shapes):
            raw = (row.get("censuscode") or "").strip()
            # datameet carries one placeholder row with censuscode 0 and no
            # district. The gazetteer drops it for the same reason: it is not a
            # district and must never come back as the answer to locate().
            if not raw.isdigit() or int(raw) == 0:
                self.skipped_placeholder += 1
                # It must never be an ANSWER - it is not a district and
                # locate() must not return it. But it is still ground, and
                # forgetting it entirely is what made "we do not map this" and
                # "this is the sea" indistinguishable. Held separately so a
                # point inside it can be named for what it is.
                if shp is not None and not getattr(shp, "is_empty", True):
                    self.unmapped.append(shp)
                continue
            code = int(raw)
            if shp is None or getattr(shp, "is_empty", True):
                self.unreadable += 1
                continue
            if code in self.by_code:
                # datameet holds one record per district. A repeat means the
                # file has changed shape and the join can no longer be trusted,
                # so it is recorded rather than absorbed silently.
                self.duplicate_codes.append(code)
                self.by_code[code] = self.by_code[code].union(shp)
                continue
            self.by_code[code] = shp
            self.names[code] = (row.get("DISTRICT", ""), row.get("ST_NM", ""))


    @classmethod
    def from_polygons(cls, polygons: dict, names: dict | None = None,
                      unmapped: list | None = None):
        """Build an index over polygons supplied directly, for tests.

        The verdict logic is worth testing on a bare clone, where the boundary
        file is not present. Without this the whole suite skips and CI reports
        green over nothing.
        """
        self = cls.__new__(cls)
        self.by_code = dict(polygons)
        self.names = dict(names or {c: (f"D{c}", "T") for c in polygons})
        self.duplicate_codes = []
        self.unreadable = 0
        self.skipped_placeholder = 0
        self.unmapped = list(unmapped or [])
        self._prepared = {c: prep(g) for c, g in self.by_code.items()}             if HAVE_SHAPELY else {}
        self._codes = list(self.by_code)
        self._tree = (STRtree([self.by_code[c] for c in self._codes])
                      if HAVE_SHAPELY and self._codes else None)
        self._unmapped_prepared = ([prep(g) for g in self.unmapped]
                                   if HAVE_SHAPELY else [])
        return self

    # ── queries ───────────────────────────────────────────────────────────
    def has(self, code: int) -> bool:
        return code in self.by_code

    def test(self, codes, lat: float, lon: float) -> str:
        """Where this point falls, against the districts the filing names.

        `codes` is every district the proposal names, not only its primary one.
        A project spanning three districts has one envelope centre, and that
        centre lands in whichever of the three it lands in; testing it against
        the primary district alone would report two thirds of such projects as
        misplaced when nothing is wrong.

        Returns one of:
          inside       within a district the filing names
          boundary     within about half a kilometre of a named district's edge,
                       where the mapped line cannot decide and neither will this
          elsewhere    inside a different district - a real disagreement between
                       the coordinates and the codes
          offshore     inside no district in the 2011 frame AND on ground the
                       source maps. The boundary file is land only, so a
                       coastal or marine project - an LNG terminal, a port, an
                       offshore block - lands here. It describes the site; it
                       is not a fault in the record.
          unmapped     inside no district because the boundary source does not
                       map this ground at all - it carries the area under
                       "Data Not Available". A statement about the reference
                       data, not about the site, and never to be shown as one.
          no_geometry  no polygon is held for any district the filing names
        """
        if not HAVE_SHAPELY:
            return "no_geometry"
        if isinstance(codes, int):
            codes = [codes]
        known = [c for c in codes if c in self.by_code]
        if not known:
            return "no_geometry"
        pt = Point(lon, lat)
        for c in known:
            if self._prepared[c].contains(pt):
                return "inside"
        for c in known:
            try:
                if self.by_code[c].distance(pt) <= BOUNDARY_TOLERANCE:
                    return "boundary"
            except Exception:  # noqa: BLE001
                continue
        if self.locate(lat, lon) is not None:
            return "elsewhere"
        return "unmapped" if self.is_unmapped(lat, lon) else "offshore"

    def test_points(self, codes, points) -> tuple[str, list[int]]:
        """The verdict over every mapped block of a project, not one point.

        A project is a set of places. An expressway is hundreds of blocks
        across two states; a mine is one. Reducing both to a single point and
        testing that loses the distinction and then manufactures a conclusion
        from the loss - the centre of a dispersed project falls where no part
        of the project is, and testing it reports a disagreement created
        entirely by the reduction.

        A project is therefore `inside` if ANY of its blocks sits in a district
        the filing names. `elsewhere` means no block does and at least one
        block sits in some other district, which is a real disagreement between
        the coordinates and the codes.

        Returns the verdict, the districts the blocks were found in, and THE
        BLOCK THE VERDICT RESTS ON, as a coordinate pair rather than an index.
        The caller publishes that block as the project's location, so the
        coordinate a reader sees is the one that produced the verdict beside
        it. Returning an index would be a trap: this method filters its input,
        so an index into the filtered list silently addresses a different
        element of the caller's unfiltered one.

        Choosing the point earlier, before the districts are known, lets a
        single malformed block decide where the project is reported to be.
        """
        if not HAVE_SHAPELY:
            return "no_geometry", [], None
        if isinstance(codes, int):
            codes = [codes]
        known = [c for c in codes if c in self.by_code]
        pts = [p for p in (points or []) if p]
        if not pts:
            return "no_geometry", [], None
        if not known:
            return "no_geometry", sorted({d for d in
                                          (self.locate(a, b) for a, b in pts)
                                          if d}), pts[0]

        found: list[int] = []
        inside_pt = None
        for lat, lon in pts:
            pt = Point(lon, lat)
            hit = next((c for c in known if self._prepared[c].contains(pt)), None)
            if hit is not None:
                found.append(hit)
                if inside_pt is None:
                    inside_pt = (lat, lon)
                continue
            here = self.locate(lat, lon)
            if here is not None:
                found.append(here)
        if inside_pt is not None:
            return "inside", sorted(set(found)), inside_pt

        for lat, lon in pts:
            pt = Point(lon, lat)
            for c in known:
                try:
                    if self.by_code[c].distance(pt) <= BOUNDARY_TOLERANCE:
                        return "boundary", sorted(set(found)), (lat, lon)
                except Exception:  # noqa: BLE001
                    continue

        if found:
            at = next(((a, b) for a, b in pts
                       if self.locate(a, b) is not None), pts[0])
            return "elsewhere", sorted(set(found)), at
        if any(self.is_unmapped(a, b) for a, b in pts):
            at = next(((a, b) for a, b in pts if self.is_unmapped(a, b)), pts[0])
            return "unmapped", sorted(set(found)), at
        return "offshore", sorted(set(found)), pts[0]

    def is_unmapped(self, lat: float, lon: float) -> bool:
        """Does this point fall on ground the source carries but does not name?

        datameet's file holds one row with `censuscode` 0, DISTRICT
        "Data Not Available", ST_NM "Jammu & Kashmir", covering about 98,700
        km2. It is correctly kept out of the district index - it is not a
        district and must never be the answer to locate(). But dropping it
        entirely left a hole in the map, and `test()` returns `offshore`
        for anything in a hole.

        So seven filings were published as being at sea while sitting in the
        Kashmir valley, among them the 240 MW Uri-I Stage-II hydroelectric
        project at 34.08N 74.04E - a run-of-river scheme on the Jhelum, about
        16 km from the nearest mapped district and several hundred from any
        coast. "The boundary source does not map this ground" and "this site
        is in the sea" are different statements, and only one of them was
        available to say.
        """
        if not HAVE_SHAPELY or not self._unmapped_prepared:
            return False
        pt = Point(lon, lat)
        return any(g.contains(pt) for g in self._unmapped_prepared)

    def locate(self, lat: float, lon: float) -> int | None:
        """Which district contains this point, independent of any filed code."""
        if not HAVE_SHAPELY or self._tree is None:
            return None
        pt = Point(lon, lat)
        for idx in self._tree.query(pt):
            code = self._codes[int(idx)]
            if self._prepared[code].contains(pt):
                return code
        return None

    def usable(self) -> str | None:
        """Why this geometry cannot be trusted, or None when it can.

        Without shapely every verdict silently becomes `no_geometry`, which the
        contract suite accepts as a valid value - so the whole check can vanish
        with every test still green. The build asks this and refuses to publish
        rather than shipping a column that means nothing.
        """
        if not HAVE_SHAPELY:
            return ("shapely is not installed, so no geometric test can be "
                    "performed; install it or the site verdict is meaningless")
        if len(self.by_code) < 600:
            return (f"only {len(self.by_code)} district polygons were read; "
                    f"the Census 2011 frame has 640")
        if self.duplicate_codes:
            return (f"census codes appear more than once in the boundary file: "
                    f"{sorted(set(self.duplicate_codes))[:10]}")
        if self.unreadable:
            return f"{self.unreadable} boundary records could not be parsed"
        return None

    def stats(self) -> dict:
        return {
            "source": "datameet 2011_Dist.shp",
            "districts_with_geometry": len(self.by_code),
            "duplicate_codes": sorted(set(self.duplicate_codes)),
            "unreadable_records": self.unreadable,
            "skipped_non_numeric_code": self.skipped_placeholder,
            "shapely_available": HAVE_SHAPELY,
        }


if __name__ == "__main__":
    import os
    cache = Path(os.environ.get("INSTRUMENTS_CACHE_DIR", ""))
    dg = DistrictGeometry(cache / "geo" / "2011_Dist.shp")
    print(json.dumps(dg.stats(), indent=1))

    # Chosen because they discriminate. Four sit in districts that were split
    # after 2011 and must resolve to the 2011 PARENT; two are the Mizoram and
    # Nagaland pair that a code collision would union.
    checks = [
        ("Umaria town, MP", 23.5250, 80.8370, "Umaria"),
        ("Palghar town, MH", 19.6967, 72.7655, "Thane"),
        ("Asansol, WB", 23.6739, 86.9524, "Barddhaman"),
        ("Veraval, GJ", 20.9070, 70.3670, "Junagadh"),
        ("Aizawl, MZ", 23.7271, 92.7176, "Aizawl"),
        ("Mon, NL", 26.7509, 95.0000, "Mon"),
        ("Connaught Place, DL", 28.6315, 77.2167, "New Delhi"),
        ("Jaipur, RJ", 26.9124, 75.7873, "Jaipur"),
    ]
    print("\npoint -> district located (2011 frame):")
    for label, lat, lon, expect in checks:
        code = dg.locate(lat, lon)
        got = dg.names.get(code, ("NONE", ""))[0] if code else "NONE"
        ok = "ok  " if _norm(got) == _norm(expect) else "MISMATCH"
        print(f"  {ok} {label:24} -> {got:18} (expected {expect})")
