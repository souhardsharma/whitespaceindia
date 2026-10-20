"""Build the cross-register index: the queries PARIVESH cannot answer.

WHY THIS FILE EXISTS
--------------------
PARIVESH lets you look up one proposal you already know the number of. Its
search exposes `state` and nothing finer, so below state level the register is
effectively unqueryable: you cannot ask which proposals sit in a district, still
less which sit in a Fifth Schedule Scheduled Area or where most of the
population is Scheduled Tribe. Those questions are not hard on PARIVESH, they
are impossible - the field is not in the API.

Having resolved 99.6% of the register to a Census 2011 district, those questions
become answerable. This script precomputes them into small files the browser can
hold, so the instrument can be entered from the other end: not "show me this
proposal" but "show me everything happening in this district", or "show me every
proposal in a Scheduled Area".

It emits:
  register/districts.json   one row per district with proposal counts, declared
                            land and displacement totals, its Scheduled Area
                            status, and the population figures worth filtering on
  register/facets.json      national totals and the filter ranges the UI needs
  (no per-district proposal files: the district page reads the state shard)

Everything here is an aggregate of data already published by this instrument. No
new source, no new claim - only the joins PARIVESH does not let you make.

Run from the project root, after build_data.py and legal_reference.py:
  python scripts/instruments/build_register_index.py
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from forest_numbers import fp_numbers  # noqa: E402


def forest_hectares(proposals) -> tuple[float, dict]:
    """Hectares applied for diversion, each forest proposal counted ONCE.

    Several environmental filings can name one forest proposal - a project's
    ToR and its EC, an expansion and its parent - and summing per filing
    counted 36 of 281 forest proposals more than once, 11% of the total. Keyed
    by the normalised forest proposal number; a filing that gives hectares
    without a number stands alone. Where filings disagree on one proposal's
    area, the largest is taken - the area sought, not a part of it.

    Only the forest-clearance area (`f[2]`), in hectares by that register's
    own definition. The land breakup's `a` is NOT a fallback: that block has
    no unit (see landUnitCaveat), and adding it as hectares mixed units.
    """
    by_key: dict = {}
    for p in proposals:
        lk = p.get("lk")
        if not isinstance(lk, dict) or not lk.get("f"):
            continue
        ha = lk["f"][2]
        if not isinstance(ha, (int, float)) or ha <= 0:
            continue
        key = tuple(fp_numbers(lk["f"][0])) or ("proposal", p.get("id"))
        by_key[key] = max(by_key.get(key, 0.0), float(ha))
    return sum(by_key.values()), by_key

ROOT = Path(__file__).resolve().parent.parent.parent
# $INSTRUMENTS_DATA_DIR points this at a candidate build, so the register
# index can be built and checked alongside the data it indexes before either
# replaces what is published. The two must be built from the same shards:
# an index over one build and shards from another is the single-shard bug
# again, wearing a different hat.
DATA = Path(os.environ.get("INSTRUMENTS_DATA_DIR")
            or ROOT / "public" / "data" / "instruments" / "consent")
OUT = DATA / "register"

# Fields kept for a proposal listed under a district. Deliberately lean: the
# full record is one fetch away on the proposal's own page.
LIST_FIELDS = ["id", "no", "name", "agency", "sector", "cat", "status", "date",
               "af", "df", "rnr", "land", "forest", "dm", "lk"]

# NO per-district proposal files are written, and nothing is capped.
#
# An earlier version shipped a listing file per district holding the 300 most
# recent proposals. That hid 28,475 proposals across 62 districts - Jodhpur
# alone has 5,042 - which is a third of the resolved register unreachable from
# the view built to show it. Trading completeness for 23 MB is a bad trade on an
# instrument whose whole claim is that it shows the whole record.
#
# A district belongs to exactly one state, so the district page reads that
# state's shard on the server and filters it. Every proposal is reachable, and
# the duplicated index is gone.


def read(name: str):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def main() -> None:
    districts = read("districts.json")
    legal = read("legal_reference.json")
    meta = read("meta.json")
    determinations = legal.get("determinations", {})

    by_district: dict[str, list[dict]] = defaultdict(list)
    # EVERY shard that holds a proposal for a district, not just one.
    #
    # A district's proposals are NOT confined to its own state's shard. Shards
    # are keyed by the register's `state`, which is the state the application
    # was FILED in, and that is routinely not the state the site is in: a
    # project filed with the Gujarat SEIAA names sites in Jaipur, a Chhattisgarh
    # filing names sites in Sundargarh in Odisha, and every inter-state linear
    # project names districts on both sides of a border.
    #
    # An earlier version recorded a single slug via setdefault, which took
    # whichever shard happened to be read first - alphabetically. The district
    # page then read that one shard, so Jaipur's page showed 1 proposal of
    # 1,106 while truthfully captioning it "All 1 proposals ... Nothing is
    # truncated". 18,361 proposals across 141 districts were hidden that way.
    # Recording the full set is the only thing that makes the caption true.
    shards_for: dict[str, set[str]] = defaultdict(set)
    totals = {"proposals": 0, "with_district": 0}

    shard_paths = sorted((DATA / "projects").glob("*.json"))
    for path in shard_paths:
        shard = json.loads(path.read_text(encoding="utf-8"))
        F = {n: i for i, n in enumerate(shard["fields"])}
        for row in shard["rows"]:
            totals["proposals"] += 1
            code = row[F["dc"]]
            if code is None:
                continue
            totals["with_district"] += 1
            rec = {k: (row[F[k]] if k in F else None) for k in LIST_FIELDS}
            rec["sector"] = shard["sectors"][rec["sector"]]
            rec["status"] = shard["statuses"][rec["status"]]
            rec["state"] = shard["slug"]
            by_district[str(code)].append(rec)
            shards_for[str(code)].add(shard["slug"])
            # A project spanning districts is counted in each district it names.
            # It genuinely affects all of them; attributing it only to the
            # primary would under-report every other district it touches.
            for extra in (row[F["dall"]] or []):
                if str(extra) != str(code):
                    by_district[str(extra)].append({**rec, "_secondary": True})
                    shards_for[str(extra)].add(shard["slug"])

    OUT.mkdir(parents=True, exist_ok=True)

    rows = []
    for code, d in sorted(districts.items(), key=lambda kv: int(kv[0])):
        proposals = by_district.get(code, [])
        proposals.sort(key=lambda r: r.get("date") or "", reverse=True)
        v = d["values"]
        det = determinations.get(code)

        # DECLARED LAND IS NOT SUMMABLE. The Common Application Form records a
        # land figure but NO UNIT for it - verified against the raw CAF, which
        # carries units for air and water quality but none for area. Proponents
        # file in hectares or in square metres depending on project type:
        # mining leases are conventionally hectares, township and building
        # projects square metres. The register's median is 2.00 while its
        # largest entry is 9,693,775 for a residential scheme, which is 969
        # hectares in square metres and would be larger than Kerala in hectares.
        # Adding those together produces a number that means nothing, so no land
        # total is published. The count of proposals declaring a figure is.
        declaring_land = sum(1 for p in proposals
                             if p.get("land") and not p.get("_secondary"))
        displaced = sum((p.get("df") or 0) for p in proposals if not p.get("_secondary"))
        affected = sum((p.get("af") or 0) for p in proposals if not p.get("_secondary"))

        # The other clearances, as the forms declare them. Membership counts
        # every proposal naming the district; hectares only its primary
        # district, as for families. Each count is over proposals whose form
        # was READ for these fields (lk not null) - the denominator is
        # published beside it, because a form not yet read is not one that
        # declares nothing.
        def lk(p):
            got = p.get("lk")
            return got if isinstance(got, dict) else None
        read_links = [p for p in proposals if p.get("lk") is not None]
        forest_ha, _ = forest_hectares(p for p in proposals if not p.get("_secondary"))

        rows.append({
            "code": int(code),
            "linksRead": len(read_links),
            # Read, but leaving at least one of the questions blank.
            "linksBlank": sum(1 for p in read_links if lk(p) and lk(p).get("u")),
            "nForest": sum(1 for p in read_links if lk(p) and (lk(p).get("f") or lk(p).get("a"))),
            "forestHa": round(forest_ha, 2),
            "nWildlife": sum(1 for p in read_links if lk(p) and lk(p).get("w")),
            "nEsz": sum(1 for p in read_links if lk(p) and lk(p).get("e")),
            "nProtected": sum(1 for p in read_links if lk(p) and lk(p).get("p")),
            "nCrz": sum(1 for p in read_links if lk(p) and lk(p).get("c")),
            "district": d["district_name"],
            "state": d["state_name"],
            "n": len(proposals),
            "nA": sum(1 for p in proposals if p.get("cat") == "A"),
            # Scheduled Area status carried through verbatim from the curated
            # reference. "unknown" here means the reference has no entry at all,
            # which is different from an entry that says "not determined".
            "sa": det["status"] if det else "unknown",
            # EVERY shard the district page must read to list its proposals.
            # Ordered with the shard holding the most first, so a page that
            # renders progressively shows the bulk of the district immediately.
            "slugs": sorted(
                shards_for.get(code, ()),
                key=lambda s: (-sum(1 for p in proposals if p["state"] == s), s),
            ),
            "declaringLand": declaring_land,
            "displaced": displaced,
            "affected": affected,
            "pop": v.get("pop.total"),
            "st": v.get("pop.st_share"),
            "sc": v.get("pop.sc_share"),
            "landDep": v.get("work.land_dependent_share"),
            "lit": v.get("pop.literacy_rate"),
        })

    with_proposals = [r for r in rows if r["n"] > 0]
    in_scheduled = [r for r in with_proposals if r["sa"] in ("within", "partial")]

    facets = {
        "generated_at": meta["generated_at"],
        "totals": {
            "proposals": totals["proposals"],
            "with_district": totals["with_district"],
            "districts_total": len(rows),
            "districts_with_proposals": len(with_proposals),
            "proposals_in_scheduled_districts": sum(r["n"] for r in in_scheduled),
            "districts_scheduled_wholly": sum(1 for r in rows if r["sa"] == "within"),
            "districts_scheduled_partly": sum(1 for r in rows if r["sa"] == "partial"),
            "proposals_declaring_land": sum(r["declaringLand"] for r in rows),
            "declared_displaced_families": sum(r["displaced"] for r in rows),
            "declared_affected_families": sum(r["affected"] for r in rows),
            # Over proposals whose form was read for its linked clearances.
            "proposals_links_read": sum(1 for p in
                                        (q for r in by_district.values() for q in r
                                         if not q.get("_secondary"))
                                        if p.get("lk") is not None),
            "proposals_declaring_forest": sum(r["nForest"] for r in rows),
            # De-duplicated across the whole country, not the district rows
            # summed: one forest proposal can be the primary of filings in two
            # districts.
            "forest_ha_sought_primary": round(forest_hectares(
                q for r in by_district.values() for q in r
                if not q.get("_secondary"))[0], 2),
        },
        "note": (
            "Counts are of proposals this instrument could place in a district. "
            "A project naming sites in several districts is counted in each, "
            "because it affects each. Declared land and family figures are the "
            "proponents' own filings summed, not an independent assessment, and "
            "are attributed only to a project's primary district so they are not "
            "double-counted."
        ),
        "landUnitCaveat": (
            "No total land area is published. The Common Application Form "
            "records a land figure but no unit for it - the form carries units "
            "for air and water quality and none for area. Mining leases are "
            "conventionally filed in hectares and township projects in square "
            "metres, and nothing in the record distinguishes them, so the "
            "figures cannot be added together. Each proposal's declared figure "
            "is shown as filed, without a unit."
        ),
    }

    (OUT / "districts.json").write_text(
        json.dumps(rows, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    (OUT / "facets.json").write_text(
        json.dumps(facets, indent=1, ensure_ascii=False), encoding="utf-8")

    size = sum(f.stat().st_size for f in OUT.rglob("*.json"))
    print(f"wrote {OUT}")
    print(f"  districts.json      {len(rows)} rows")

    print(f"  total               {size/1048576:.1f} MB")
    print()
    for k, val in facets["totals"].items():
        print(f"  {k:36} {val:,}" if isinstance(val, (int, float)) else f"  {k:36} {val}")


if __name__ == "__main__":
    main()
