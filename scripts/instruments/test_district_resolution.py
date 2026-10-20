"""Tests for district_resolution.

Run: python scripts/instruments/test_district_resolution.py

Each test encodes a failure actually observed against the live register, so a
regression here means a real bug has come back, not a style change.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from district_resolution import (
    PREFIX_RE,
    POSTFIX_RE,  # noqa: E402
    DISTRICT_ALIASES,
    Gazetteer,
    _clean_capture,
    normalize_name,
    resolve_district,
)

DBF_ENV = "INSTRUMENTS_GEO_DBF"
FAILURES: list[str] = []


def check(name: str, got, want) -> None:
    if got != want:
        FAILURES.append(f"{name}\n     got:  {got!r}\n     want: {want!r}")
        print(f"  FAIL  {name}")
    else:
        print(f"  ok    {name}")


def check_true(name: str, cond, detail: str = "") -> None:
    if cond:
        print(f"  ok    {name}")
    else:
        FAILURES.append(f"{name}: {detail}")
        print(f"  FAIL  {name}  {detail}")


# ── normalisation ─────────────────────────────────────────────────────────
def test_normalize() -> None:
    print("\nnormalize_name")
    check("strips punctuation", normalize_name("Y.S.R. (Kadapa)"), "ysrkadapa")
    check("strips ampersand", normalize_name("Lahul & Spiti"), "lahulspiti")
    check("lowercases", normalize_name("NORTH & MIDDLE ANDAMAN"), "northmiddleandaman")
    check("handles None", normalize_name(None), "")
    check("strips digits", normalize_name("24 Parganas"), "parganas")


# ── capture cleaning ──────────────────────────────────────────────────────
def test_clean_capture() -> None:
    print("\n_clean_capture")
    check("prefix cuts at stop word",
          _clean_capture("Sikar, Rajasthan", False), "sikar")
    check("prefix cuts at comma",
          _clean_capture("Bankura, West Bengal", False), "bankura")
    # No comma and no stop word: the capture is not cleanable here. The
    # gazetteer's startswith rule catches it downstream at medium confidence -
    # see test_prefix_form. Asserted so the division of labour stays explicit.
    check("prefix leaves uncleanable run intact",
          _clean_capture("Bankura West Bengal", False), "bankurawestbengal")
    # postfix: name is the tail of the span
    check("postfix takes tail after stop word",
          _clean_capture("Dolvi village, Raigad", True), "raigad")
    check("postfix bare name", _clean_capture("Raipur", True), "raipur")


# ── the regex bug that shipped once ───────────────────────────────────────
def test_no_rict_fragment(gaz: Gazetteer) -> None:
    """`dist` must not match inside the word `District`.

    Before the \\b anchors were added this captured the fragment "rict" on
    5,075 records of the live register.
    """
    print("\nregex word-boundary regression")
    r = resolve_district(
        "Works located at Dolvi village, Raigad District, Maharashtra",
        "MAHARASHTRA", gaz)
    check("postfix form resolves", r["district_name"], "Raigarh")
    check("  and not to a fragment", r["resolution_token"] == "rict", False)
    check("  method is the curated spelling alias", r["resolution_method"], "spelling")

    # THE ANCHORS THEMSELVES. The two cases above resolve correctly with or
    # without \b, so they proved the resolver works rather than that the
    # anchors are load-bearing: dropping \b from PREFIX_RE and POSTFIX_RE left
    # this whole suite green while 1,161 register names reverted to a captured
    # fragment. `Subdistrict` is the discriminator - it contains `district`, so
    # an unanchored pattern matches inside the word and captures everything up
    # to "Sub".
    for probe, want in (
        ("Mining lease in the Subdistrict of Raipur District, Chhattisgarh",
         "Raipur"),
        ("Quarry in Subdistrict Jodhpur District, Rajasthan", "Jodhpur"),
    ):
        got = POSTFIX_RE.search(probe)
        captured = got.group(1).strip() if got else ""
        check_true(f"the postfix anchor does not match inside 'Subdistrict' "
                   f"({want})",
                   captured.lower().endswith(want.lower()),
                   f"captured {captured!r}, which must end at {want!r} - the "
                   f"\b anchors in _KEY are what prevent matching inside a "
                   f"longer word")

    # And the prefix form, which the same anchors protect.
    pre = PREFIX_RE.search("Located in Subdistrict area, District Jodhpur")
    check_true("the prefix anchor captures the named district, not a fragment",
               bool(pre) and "jodhpur" in pre.group(1).strip().lower(),
               f"captured {pre.group(1).strip()!r}" if pre else "no match")

    r2 = resolve_district(
        "Cement Plant at Simga Tehsil, Raipur District, Chhattisgarh",
        "CHHATTISGARH", gaz)
    check("second postfix case", r2["district_name"], "Raipur")
    check("  form recorded", r2["resolution_form"], "postfix")


# ── prefix form ───────────────────────────────────────────────────────────
def test_prefix_form(gaz: Gazetteer) -> None:
    print("\nprefix form")
    r = resolve_district("Sand mining, District-Sikar, Rajasthan", "RAJASTHAN", gaz)
    check("resolves", r["district_name"], "Sikar")
    check("  method", r["resolution_method"], "exact")
    check("  confidence", r["resolution_confidence"], "high")
    check("  form", r["resolution_form"], "prefix")

    r2 = resolve_district("Unit at Distt. Bankura", "WEST BENGAL", gaz)
    check("Distt. abbreviation", r2["district_name"], "Bankura")

    # uncleanable run recovered by the gazetteer's startswith rule
    r3 = resolve_district("Unit at District-Bankura West Bengal", "WEST BENGAL", gaz)
    check("startswith rule recovers an uncut run", r3["district_name"], "Bankura")
    check("  and downgrades confidence", r3["resolution_confidence"], "medium")


# ── state constraint ──────────────────────────────────────────────────────
def test_state_constraint(gaz: Gazetteer) -> None:
    print("\nstate constraint")
    # Balrampur exists in Uttar Pradesh but not in Chhattisgarh's 2011 list.
    # Without the state constraint this would resolve to the wrong state.
    r = resolve_district("Bauxite mine at District-Balrampur", "CHHATTISGARH", gaz)
    check("cross-state label does not resolve to another state's district",
          r["district_name"], None)
    check("  reported unresolved", r["resolution_method"], "unresolved")

    r2 = resolve_district("Mine at District-Balrampur", "UTTAR PRADESH", gaz)
    check("same label resolves in its own state", r2["district_name"], "Balrampur")


# ── post-2011 districts inherit the parent, and say so ────────────────────
def test_post2011_parent(gaz: Gazetteer) -> None:
    print("\npost-2011 districts")
    r = resolve_district("Steel plant at District-Palghar", "MAHARASHTRA", gaz)
    check("Palghar maps to its 2011 parent", r["district_name"], "Thane")
    check("  method labelled", r["resolution_method"], "post2011_parent")
    check("  flagged as inherited geometry", r["inherits_parent_geometry"], True)
    check("  confidence is not high", r["resolution_confidence"], "medium")

    # Telangana districts sit under the 2011 Andhra Pradesh rows
    r2 = resolve_district("Plant at District-Sangareddy", "TELANGANA", gaz)
    check("Telangana resolves via 2011 parent state", r2["district_name"], "Medak")
    check("  not the fuzzy near-miss Rangareddy",
          r2["district_name"] == "Rangareddy", False)


# ── unresolved is honest, not guessed ─────────────────────────────────────
def test_unresolved(gaz: Gazetteer) -> None:
    print("\nunresolved handling")
    r = resolve_district("Expansion of capacity from 10 MTPA to 15 MTPA", "ODISHA", gaz)
    check("no label -> unresolved", r["resolution_method"], "unresolved")
    check("  censuscode is null", r["censuscode"], None)
    check("  not flagged as inherited", r["inherits_parent_geometry"], False)

    r2 = resolve_district("Project at District-Odisha", "ODISHA", gaz)
    check("state name in district field is rejected", r2["censuscode"], None)


# ── alias table integrity ─────────────────────────────────────────────────
def test_alias_targets_exist(gaz: Gazetteer) -> None:
    """Every curated alias must point at a district that actually exists.

    A typo here fails silently in production: the alias simply never fires and
    the record falls through to unresolved.
    """
    print("\nalias table integrity")
    known = {normalize_name(r["DISTRICT"]) for r in gaz.rows}
    bad = sorted(
        f"{k} -> {v[0]}" for k, v in DISTRICT_ALIASES.items()
        if normalize_name(v[0]) not in known
    )
    check_true("every alias target exists in the gazetteer",
               not bad, f"{len(bad)} dangling: {bad[:8]}")

    bad_kind = sorted(k for k, v in DISTRICT_ALIASES.items()
                      if v[1] not in ("spelling", "post2011_parent"))
    check_true("every alias has a valid kind", not bad_kind, str(bad_kind[:8]))


def test_gazetteer_shape(gaz: Gazetteer) -> None:
    print("\ngazetteer")
    check("640 real districts", len(gaz.rows), 640)
    check("censuscodes are unique", len(gaz.by_code), 640)
    check_true("census codes run 1..640",
               min(gaz.by_code) == 1 and max(gaz.by_code) == 640,
               f"min={min(gaz.by_code)} max={max(gaz.by_code)}")


def test_placeholder_dropped() -> None:
    """The 'Data Not Available' row must never enter the fuzzy-match pool.

    Asserted on a hand-built gazetteer rather than on whichever source main()
    loaded. The DBF carries the placeholder and districts.json does not, so
    asserting a count on the loaded gazetteer would test the source, not the
    dropping rule. This tests the rule.
    """
    print("\nplaceholder handling")
    rows = [
        {"censuscode": "0", "DISTRICT": "Data Not Available", "ST_NM": "Data Not Available"},
        {"censuscode": "", "DISTRICT": "Blank", "ST_NM": "Rajasthan"},
        {"censuscode": "113", "DISTRICT": "Jodhpur", "ST_NM": "Rajasthan"},
    ]
    g = Gazetteer(rows=rows)
    check("placeholder and blank rows dropped", g.dropped_placeholders, 2)
    check("only the real district survives", len(g.rows), 1)
    check_true("placeholder is not in the match pool",
               0 not in g.by_code, "censuscode 0 leaked into by_code")
    row, method, _ = g.resolve(normalize_name("Data Not Available"), "Rajasthan")
    check_true("placeholder cannot be fuzzy-matched", row is None,
               f"matched {row} via {method}")


def test_adjudication() -> None:
    """Two statements of place in the same filing outvote a third - never less.

    Observed: Malabar Hill redevelopments filed under the Greater Mumbai town
    code were published in Mumbai Suburban, while the form declared Mumbai and
    the site coordinates fell in Mumbai. Filings citing Greater Hyderabad's code
    were published in Medak by load order.
    """
    print("\nadjudication")
    from location import adjudicate

    def loc(primary, declared, districts=None, ambiguous=None):
        return {"primary_district": primary, "districts": districts or [primary],
                "declared_district": declared, "ambiguous_candidates": ambiguous,
                "subdistricts": [1], "villages": [2], "village_count": 1,
                "method": "village", "confidence": "high",
                "multi_district": False}

    # Mumbai: codes say Suburban (518); declaration and coordinates say 519.
    moved, how = adjudicate(loc(518, 519), "elsewhere", 519)
    check("declaration + coordinates overrule the codes", how, "adjudicated")
    check("  ...and the proposal moves", moved["primary_district"], 519)
    check("  ...with its method recorded", moved["method"], "adjudicated")
    check("  ...keeping no sub-district of the district it left",
          moved["subdistricts"], [])

    # Chitrakoot sand leases: codes and declaration agree, coordinates do not.
    kept, how = adjudicate(loc(171, 171), "elsewhere", 170)
    check("codes + declaration outvote the coordinates", how, "kept")
    check("  ...and nothing moves", kept["primary_district"], 171)

    # No majority: nothing moves, and it says so.
    same, how = adjudicate(loc(535, 518), "elsewhere", 537)
    check("three-way disagreement is contested", how, "contested")
    check("  ...and nothing moves", same["primary_district"], 535)

    # A declaration alone never moves anything.
    same, how = adjudicate(loc(518, 519), "inside", 518)
    check("a declaration the coordinates do not back moves nothing", how, "kept")

    # Coordinates inside a named district: nothing to adjudicate.
    same, how = adjudicate(loc(518, None), "inside", 518)
    check("agreement is left alone", how, "kept")

    # Missing evidence is not evidence.
    same, how = adjudicate(loc(518, None), "elsewhere", 519)
    check("no declaration, no move", how, "kept")
    same, how = adjudicate(loc(518, 519), "elsewhere", None)
    check("no coordinates, no move", how, "kept")

    # A town code straddling districts is settled by its coordinates.
    moved, how = adjudicate(loc(535, None, ambiguous=[535, 536, 537]),
                            "boundary", 537)
    check("an ambiguous town code follows the coordinates", how,
          "town_by_coordinates")
    check("  ...to the candidate they fall in", moved["primary_district"], 537)
    check("  ...recorded as settled by other evidence, not by the codes",
          moved["method"], "town_settled")
    # ...but never to a district that is not one of its candidates.
    same, how = adjudicate(loc(535, None, ambiguous=[535, 536]), "boundary", 537)
    check("  ...and never outside its candidates", how, "town_unsettled")
    check("  ...which stays provisional where it was", same["primary_district"], 535)

    # Without coordinates, the declared district may settle a town code.
    moved, how = adjudicate(loc(535, 536, ambiguous=[535, 536, 537]), None, None)
    check("a declared candidate settles a town code with no coordinates",
          (how, moved["primary_district"]), ("town_by_declaration", 536))

    # Only the PRIMARY district is replaced; the others the codes name stay.
    # Observed: a Thane creek project with one Greater Mumbai plot lost Thane.
    multi = loc(518, None, districts=[518, 517], ambiguous=[518, 519])
    moved, how = adjudicate(multi, "elsewhere", 519)
    check("a town settlement keeps the project's other districts",
          sorted(moved["districts"]), [517, 519])
    check("  ...and it stays multi-district", moved["multi_district"], True)

    # Two against one uses EVERY block's district, not just the first found.
    moved, how = adjudicate(loc(518, 520), "elsewhere", 519, found=[519, 520])
    check("a declared district under any block is corroborated", how,
          "adjudicated")
    check("  ...and the location moves there", moved["primary_district"], 520)
    same, how = adjudicate(loc(518, 521), "elsewhere", 519, found=[519, 520])
    check("a declared district under no block is contested", how, "contested")


def main() -> int:
    # Prefer the source DBF when the caller has a fetch cache, because that also
    # exercises parse_dbf. Fall back to the committed districts.json so the suite
    # runs on a fresh clone and in CI, where no cache exists. Both carry the same
    # 640 districts; test_gazetteer_shape asserts that either way.
    dbf = os.environ.get(DBF_ENV)
    if dbf and not Path(dbf).exists():
        # Named but absent - e.g. a job that sets the variable before its cache
        # is restored. Test against the committed gazetteer rather than crash;
        # the suite's claims do not depend on which of the two it reads.
        print(f"{DBF_ENV}={dbf} does not exist; using the committed gazetteer")
        dbf = None
    if dbf:
        gaz = Gazetteer(Path(dbf))
        print(f"gazetteer source: {DBF_ENV}={dbf}")
    else:
        gaz = Gazetteer.from_published()
        print("gazetteer source: public/data/instruments/consent/districts.json "
              f"(set {DBF_ENV} to test parse_dbf against the source DBF too)")

    test_normalize()
    test_clean_capture()
    test_gazetteer_shape(gaz)
    test_placeholder_dropped()
    test_no_rict_fragment(gaz)
    test_prefix_form(gaz)
    test_state_constraint(gaz)
    test_post2011_parent(gaz)
    test_unresolved(gaz)
    test_alias_targets_exist(gaz)
    test_adjudication()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S):")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("all tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
