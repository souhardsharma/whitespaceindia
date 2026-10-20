"""Resolve a clearance proposal to Census 2011 districts, sub-districts and villages.

WHAT CHANGED, AND WHY IT MATTERS
--------------------------------
The first implementation parsed the district out of the free-text project name
and reached 33.5%. It is kept here only as a last resort. The Common Application
Form carries the location the proponent actually filed, and using it takes
resolution to 99.7% with sub-district precision for roughly 89% of records.

THE MIXED CODE SYSTEMS TRAP
---------------------------
Inside a single `cafKMLPlots` object the identifiers come from two different
national code systems:

    district_code       LGD          447 = Jamnagar
    sub_district_code   Census 2011  3818
    village_code        Census 2011  513877

Verified against SHRUG's `shrid_loc_names`, where Kanalus village resolves to
shrid2 `11-24-477-03818-513877`: the sub-district and village segments match the
CAF codes exactly, while the district segment (477) does not match the CAF's 447.
Treating all three as one system silently mis-joins every record.

WHY THE VILLAGE ROUTE IS PREFERRED
-----------------------------------
Village and sub-district codes are Census 2011 identifiers, so they resolve to a
2011 district directly and correctly even when the project sits in a district
created after 2011. Morbi, created in 2013, resolves through its Morvi
sub-district to the 2011 parent Rajkot with no curated mapping at all. The LGD
`mainDistrict` route needs a crosswalk and cannot express projects that span
districts, so it ranks below.

Measured agreement between routes over 60,953 CAF records:
    village vs sub-district   99.4% identical
    village vs LGD district   95.6% identical
The residual disagreement is mostly linear projects (highways, transmission
lines) where `mainDistrict` names one district but the plots span several.
2.42% of projects touch more than one district, so location is modelled as a
LIST, with the plot-weighted mode as the primary.

PRECEDENCE
----------
    1 village        village_code  -> Census district + sub-district   high
    2 subdistrict    sub_district_code -> Census district              high
    3 lgd_district   mainDistrict  -> LGD crosswalk -> Census district  medium
    4 project_name   free-text parse, state-constrained                 low
    5 unresolved     reported as such, never guessed

ADJUDICATION
------------
The ladder picks the most specific code, and a code can still be wrong.
Once the site coordinates have been tested, adjudicate() lets the filing's
other two statements of place - the district it declares and the districts its
coordinates fall in - overrule the codes when, and only when, those two agree
with each other. And a town code that spans districts (Greater Mumbai, Greater
Hyderabad) chooses nothing, so when it alone placed the primary district the
coordinates or the declaration choose instead (method `town_settled`).

Measured on the register when this was introduced (2026-09-25): Mumbai City's
page listed 25 proposals while 440 were sited there, because the Greater
Mumbai code was placed in Mumbai Suburban. After it: 2,071 town placements
settled (2,063 by coordinates, 6 by declaration, 2 left provisional), 125
adjudicated, 23 contested, and 439 of the 440 Mumbai City sites published
there - the last lies on the boundary.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pandas as pd

CONFIDENCE = {
    "village": "high",
    "subdistrict": "high",
    # Two independent statements in the same filing - its declared district
    # and its site coordinates - agree against its place codes. See adjudicate().
    "adjudicated": "high",
    # A town code spanning districts placed the primary; the coordinates or
    # the declared district chose among its districts. See adjudicate().
    "town_settled": "high",
    "lgd_district": "medium",
    "project_name": "low",
}

# SHRUG's "this district has no sub-district" sentinel, NOT a place.
#
# It occupies the sub-district segment of shrid2 for 149 villages across 29
# districts - Mumbai Suburban, Kolkata, Chennai, Bangalore among them - and
# every one of those rows carries an empty sub-district name. It is a filler,
# and it is the same filler in all 29, so anything keyed on the code alone
# silently folds 29 districts into one.
#
# Treated as a real code it did exactly that twice over: the published
# sub-district map kept one record for it, carrying whichever district was
# written last, and 1,855 proposals - 1,723 of them in Mumbai Suburban - then
# resolved to that record. A reader who opened a Mumbai building proposal and
# asked for the sub-district was shown Chennai's population and literacy,
# under a sentence promising "a far closer description of who a project
# actually affects than a district of several million people".
#
# The index must not resolve it either: `subdistrict` is built with
# `setdefault`, so `subdistrict["99999"]` returned whichever of the 29
# districts loaded first, and a filing citing that code would have been placed
# in a district chosen by dataframe order.
NO_SUBDISTRICT = 99999
NO_SUBDISTRICT_KEY = "99999"

# Census 2011 town codes that the Town Directory lists in several districts,
# each as "(Part)", but that SHRUG's place index carries under one district.
# Keyed by the 6-digit code; values are Census 2011 district codes (3-digit).
TOWN_SPANS: dict[str, list[str]] = {
    # Greater Mumbai (M Corp.): Mumbai Suburban (518) and Mumbai (519).
    "802794": ["518", "519"],
}


class LocationIndex:
    """Census 2011 place-code indexes plus the LGD district crosswalk."""

    def __init__(self, loc_names_path: Path, lgd_districts_path: Path,
                 census_codes: set[int] | None = None):
        """`census_codes` is the Census 2011 district frame (the gazetteer's
        640 codes). A crosswalk target outside it is dropped. It must come from
        the gazetteer, NOT from this index's own district names: wholly urban
        districts - Mumbai, the nine Delhi districts - carry no village rows
        here, so validating against those names rejected every one of them."""
        names = pd.read_stata(loc_names_path, convert_categoricals=False)
        parts = names["shrid2"].str.split("-", expand=True)
        names["st"], names["dt"] = parts[1], parts[2]
        names["sd"], names["vl"] = parts[3], parts[4]

        # village code -> (district, subdistrict). A handful of codes recur.
        # Most recurrences are harmless (the same place listed twice), but a
        # few are TOWNS that straddle districts: Greater Hyderabad (M Corp.)
        # carries one code in Hyderabad, Rangareddy and Medak. "First wins"
        # placed every filing citing it in whichever district loaded first, so
        # every district a code lies in is kept in `village_districts`, and a
        # filing citing an ambiguous code is settled by its own coordinates or
        # declared district in adjudicate(), never by load order.
        self.village: dict[str, tuple[str, str]] = {}
        self.village_districts: dict[str, list[str]] = {}
        dup = 0
        for vl, dt, sd in zip(names["vl"], names["dt"], names["sd"]):
            if vl == "000000":
                continue
            seen = self.village_districts.setdefault(vl, [])
            if dt not in seen:
                seen.append(dt)
            if vl in self.village:
                dup += 1
                continue
            self.village[vl] = (dt, sd)
        # Towns the Census lists in more than one district under ONE code, where
        # SHRUG's place index keeps a single parent. Greater Mumbai (M Corp.) is
        # enumerated as "(Part)" in both Mumbai and Mumbai Suburban in the
        # Census 2011 Town Directory; the index places it in Suburban only, so a
        # filing citing it says nothing about which of the two it is in.
        for vl, spans in TOWN_SPANS.items():
            seen = self.village_districts.setdefault(vl, [])
            for dt in spans:
                if dt not in seen:
                    seen.append(dt)
        for parents in self.village_districts.values():
            parents.sort()
        self.duplicate_village_codes = dup
        self.ambiguous_village_codes = sorted(
            vl for vl, ds in self.village_districts.items() if len(ds) > 1)

        # The sentinel is excluded: it is shared by 29 districts, so
        # `setdefault` would resolve it to whichever loaded first and place a
        # filing that cites it in a district picked by dataframe order.
        self.subdistrict: dict[str, str] = {}
        for sd, dt in zip(names["sd"], names["dt"]):
            if sd == NO_SUBDISTRICT_KEY:
                continue
            self.subdistrict.setdefault(sd, dt)

        # Which districts a sub-district's places actually lie in.
        #
        # The PCA carries one district per sub-district, so it cannot express a
        # tehsil that STRADDLES a boundary - and 31 of them do, all in Assam,
        # published by Census as "<name> part" on each side under one code.
        # Barnagar part (02018) lies in Barpeta, Chirang and Baksa; the PCA
        # says Barpeta. Taking the parent from there put 77 proposals on a
        # sub-district the published record said was in another district.
        # This index is village-level, so it sees all three.
        self.subdistrict_districts: dict[str, list[str]] = {}
        for sd, dt in zip(names["sd"], names["dt"]):
            if sd == NO_SUBDISTRICT_KEY:
                continue
            seen = self.subdistrict_districts.setdefault(sd, [])
            if dt not in seen:
                seen.append(dt)
        for parents in self.subdistrict_districts.values():
            parents.sort()

        # human-readable names, for display and for auditing a resolution
        self.district_name: dict[str, str] = {}
        self.subdistrict_name: dict[str, str] = {}
        for dt, sd, dn, sdn in zip(names["dt"], names["sd"],
                                   names["district_name"], names["subdistrict_name"]):
            self.district_name.setdefault(dt, dn)
            self.subdistrict_name.setdefault(sd, sdn)

        raw = json.loads(Path(lgd_districts_path).read_text(encoding="utf-8"))
        rows = raw["data"] if isinstance(raw, dict) and "data" in raw else raw
        self.lgd_to_census: dict[str, int] = {}
        self.lgd_unmapped: list[dict] = []
        self.lgd_invalid_targets: list[dict] = []
        for r in rows:
            try:
                c = int((r.get("census_code_2011") or "").strip())
            except (ValueError, AttributeError):
                c = 0
            if c and c != 999 and (census_codes is None or c in census_codes):
                self.lgd_to_census[str(r["code"])] = c
            elif c and c != 999:
                # A crosswalk target that is not a Census 2011 district. LGD
                # gives Gariyaband (carved from Raipur in 2012) the code 645;
                # the 2011 frame ends at 640. Published, it read "the district
                # the form declares, district 645" on 46 profiles. Not a
                # disagreement - an unusable piece of evidence - so it is
                # dropped and counted.
                self.lgd_invalid_targets.append({"code": r["code"],
                                                 "name": r.get("name"),
                                                 "target": c})
            else:
                # Post-2011 district with no 2011 equivalent. Not an error: the
                # village and sub-district routes resolve these correctly, so no
                # curated parent table is needed.
                self.lgd_unmapped.append({"code": r["code"], "name": r.get("name")})

    def stats(self) -> dict:
        return {
            "village_codes": len(self.village),
            "duplicate_village_codes": self.duplicate_village_codes,
            "ambiguous_village_codes": {
                vl: [int(d) for d in self.village_districts[vl]]
                for vl in self.ambiguous_village_codes},
            "subdistrict_codes": len(self.subdistrict),
            "lgd_districts_mapped": len(self.lgd_to_census),
            "lgd_districts_unmapped_post2011": len(self.lgd_unmapped),
            "lgd_targets_not_in_census_2011": self.lgd_invalid_targets,
        }


def resolve_from_caf(caf: dict, index: LocationIndex) -> dict | None:
    """Resolve one CAF extract to Census 2011 geography.

    Returns None when the CAF carries nothing usable, so the caller can fall
    back to parsing the project name.
    """
    districts: Counter = Counter()
    subdistricts: Counter = Counter()
    villages: list[str] = []
    # Plots counted under a district only provisionally, because the code they
    # cite is a town spanning several districts: district -> its candidates.
    provisional: Counter = Counter()
    candidates_of: dict[str, set[int]] = {}
    method = None

    for plot in caf.get("plots") or []:
        vc = (plot.get("vc") or "").strip()
        if vc:
            key = vc.zfill(6)
            hit = index.village.get(key)
            if hit:
                spans = index.village_districts.get(key) or [hit[0]]
                if len(spans) > 1:
                    # A town across districts. Counted provisionally under the
                    # first; adjudicate() settles it against the filing's own
                    # coordinates and declared district - but only if it is
                    # what placed the PRIMARY district (see below).
                    provisional[hit[0]] += 1
                    candidates_of.setdefault(hit[0], set()).update(
                        int(d) for d in spans)
                districts[hit[0]] += 1
                # The village still places the DISTRICT - that part is real.
                # It just has no sub-district to name, and saying so is the
                # honest answer. Counting the sentinel here is what put 1,855
                # proposals on a record belonging to another state.
                if hit[1] != NO_SUBDISTRICT_KEY:
                    subdistricts[hit[1]] += 1
                villages.append(key)
                method = method or "village"
                continue
        sdc = (plot.get("sdc") or "").strip()
        if sdc:
            key = sdc.zfill(5)
            if key == NO_SUBDISTRICT_KEY:
                continue
            dt = index.subdistrict.get(key)
            if dt:
                districts[dt] += 1
                subdistricts[key] += 1
                method = method or "subdistrict"

    declared = declared_district(caf, index)
    if not districts:
        if declared:
            districts[str(declared).zfill(3)] += 1
            method = "lgd_district"

    if not districts:
        return None

    ordered = [d for d, _ in districts.most_common()]
    primary = ordered[0]
    # The primary is in doubt only if EVERY plot counted under it cited an
    # ambiguous town. A Thane project with one Greater Mumbai plot among its
    # village plots is not in doubt about Thane, and must not be moved - that
    # rule, applied to any plot, dropped Thane from a creek project and
    # Hyderabad from another.
    ambiguous = (sorted(candidates_of[primary])
                 if provisional[primary] and provisional[primary] == districts[primary]
                 else None)
    return {
        "declared_district": declared,
        "ambiguous_candidates": ambiguous,
        "districts": [int(d) for d in ordered],
        "primary_district": int(primary),
        "subdistricts": sorted({int(s) for s in subdistricts}),
        "villages": sorted({int(v) for v in villages}),
        "village_count": len(set(villages)),
        "method": method,
        "confidence": CONFIDENCE[method],
        "multi_district": len(ordered) > 1,
        "source": "caf",
    }


def declared_district(caf: dict | None, index: LocationIndex) -> int | None:
    """The district the form itself declares, as a Census 2011 code.

    This is the project's `mainDistrict`, an LGD code. Each plot also carries
    a district code (`dc`), and it is deliberately NOT used: it does not map
    reliably through the LGD crosswalk. Measured on the register, an East
    Godavari plot's code crosswalks to Mysore and a Kamrup Metropolitan plot's
    to Bokaro, while the plot's own district NAME and the mainDistrict agree
    with each other. Preferring the plot code cut adjudicated proposals from
    496 to 83 and stranded genuine two-against-one cases. `mainDistrict` was
    measured at 95.6% agreement with the village route.

    A district created after 2011 has no 2011 code of its own and yields
    nothing: an absence of this one piece of evidence, not a disagreement
    with anything.
    """
    md = (caf or {}).get("mainDistrict")
    if md is None:
        return None
    cen = index.lgd_to_census.get(str(md))
    return int(cen) if cen else None


def adjudicate(loc: dict, verdict: str | None, falls_in: int | None,
               index: LocationIndex | None = None,
               found: list[int] | None = None) -> tuple[dict, str]:
    """Settle a location when the filing's own evidence disagrees with itself.

    A form carries three independent statements of where a project is: the
    place codes on its plots (what `loc` was built from), the district it
    declares (`loc["declared_district"]`), and the coordinates of its site -
    `found`, every district its mapped blocks fall in, and `falls_in`, the one
    the published point rests on; `verdict` says whether any block falls in a
    district the codes name. The codes rank first because they are the most
    specific, but a code can be wrong in a way the other two expose.

    TWO AGAINST ONE. When no block falls in any district the codes name
    (`elsewhere`) and the declared district is one the blocks DO fall in, the
    location moves there: method `adjudicated`. If the declared district is
    neither named by the codes nor under any block, no two agree: `contested`,
    and nothing moves. If the declaration agrees with the codes, the
    coordinates are the outlier and the codes stand.

    A TOWN SPANNING DISTRICTS. Greater Mumbai (M Corp.) is one code in two
    districts; Greater Hyderabad's is one code in three. When such a code is
    what placed the PRIMARY district (`ambiguous_candidates`), the code says
    nothing about which of its districts the site is in, so the filing's other
    evidence decides: the coordinates if they fall in a candidate, else the
    declared district if it is one, else nothing does and the placement stays
    provisional. Only the primary district is replaced - any other district
    the codes name is kept. Method `town_settled`, whether or not the district
    changed, because the codes did not choose it and the page must not say
    they did.

    Returns the (possibly new) location and one of: kept | adjudicated |
    town_by_coordinates | town_by_declaration | town_unsettled | contested
    """
    primary = loc.get("primary_district")
    if primary is None:
        return loc, "kept"
    named = list(loc.get("districts") or [primary])
    candidates = set(loc.get("ambiguous_candidates") or [])
    declared = loc.get("declared_district")
    under = set(found or []) | ({falls_in} if falls_in is not None else set())

    if candidates:
        if falls_in is not None and falls_in in candidates:
            target, outcome = falls_in, "town_by_coordinates"
        elif declared is not None and declared in candidates:
            target, outcome = declared, "town_by_declaration"
        else:
            target, outcome = primary, "town_unsettled"
        districts = [target] + [d for d in named if d not in (primary, target)]
        return _moved(loc, target, districts, "town_settled", primary,
                      index), outcome

    if falls_in is None and not under:
        return loc, "kept"
    if verdict == "elsewhere" and declared is not None and declared not in named:
        if declared in under:
            return _moved(loc, declared, [declared], "adjudicated", primary,
                          index), "adjudicated"
        return loc, "contested"
    return loc, "kept"


def _moved(loc: dict, target: int, districts: list[int], method: str,
           was: int, index: LocationIndex | None) -> dict:
    moved = dict(loc)
    moved["primary_district"] = target
    moved["districts"] = districts
    moved["multi_district"] = len(districts) > 1
    keys = {str(d).zfill(3) for d in districts}
    if index is not None:
        # Keep only the finer places that actually lie in a district the
        # location now names. A sub-district of a district it was moved OUT
        # of would describe somebody else's population.
        moved["subdistricts"] = sorted(
            s for s in (loc.get("subdistricts") or [])
            if keys & set(index.subdistrict_districts.get(str(s).zfill(5), [])))
        moved["villages"] = sorted(
            v for v in (loc.get("villages") or [])
            if keys & set(index.village_districts.get(str(v).zfill(6), [])))
    else:
        moved["subdistricts"] = []
        moved["villages"] = []
    moved["village_count"] = len(moved["villages"])
    moved["method"] = method
    moved["confidence"] = CONFIDENCE[method]
    moved["moved_from"] = was
    return moved


def unresolved() -> dict:
    return {
        "declared_district": None,
        "ambiguous_candidates": None,
        "districts": [],
        "primary_district": None,
        "subdistricts": [],
        "villages": [],
        "village_count": 0,
        "method": "unresolved",
        "confidence": None,
        "multi_district": False,
        "source": None,
    }


def from_project_name(name_result: dict) -> dict:
    """Adapt the legacy project-name parser's output to this shape.

    Kept as the last resort for proposals whose CAF could not be fetched.
    Confidence is forced to low regardless of how the name matched, because a
    name is an assertion about the project, not a filed location.
    """
    if name_result.get("censuscode") is None:
        return unresolved()
    return {
        "declared_district": None,
        "ambiguous_candidates": None,
        "districts": [name_result["censuscode"]],
        "primary_district": name_result["censuscode"],
        "subdistricts": [],
        "villages": [],
        "village_count": 0,
        "method": "project_name",
        "confidence": "low",
        "multi_district": False,
        "source": "projectName",
        "name_match": name_result.get("resolution_method"),
    }
