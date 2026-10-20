"""Assert the contract between the published data and the code that reads it.

WHY THIS EXISTS
---------------
The published shards store rows as bare arrays with the column names in a
separate `fields` header. That is a large saving - repeating twenty-odd JSON
keys across 89,372 rows costs several megabytes of pure key text - but it moves
the column-name/position mapping out of the data and into an agreement between
the Python that writes it and the TypeScript that reads it.

An agreement that nothing checks is a bug waiting for a quiet afternoon. Insert
one field into SHARD_FIELDS and every reader silently shifts by one: the sector
column is read as a category, dates render as authority indexes, and nothing
throws, because every value is still a valid value of some type. It would ship.

So this file reads the published files exactly as the app does, by name, and
fails loudly on any mismatch. It reads only what is committed - no cache, no
network - so it runs on a fresh clone and in CI.

Run from the project root:
  python scripts/instruments/check_published.py
"""
from __future__ import annotations

import json
import os
import re
from datetime import date, datetime, timezone
import sys
import statistics
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from privacy import (  # noqa: E402
    EMAIL_RE, LABELLED_PHONE_RE, PHONE_RE)

ROOT = Path(__file__).resolve().parent.parent.parent
# Normally the published directory. $INSTRUMENTS_DATA_DIR points it at a
# candidate build instead, so the contract can be tested BEFORE the data it
# describes replaces anything - a check that only ever runs after publication
# tells you what you have already shipped.
DATA = Path(os.environ.get("INSTRUMENTS_DATA_DIR")
            or ROOT / "public" / "data" / "instruments" / "consent")

# The small-group floor the contract requires of published distributions.
# Kept HERE rather than read from appraisal.json, which this suite checks.
MIN_GROUP_FLOOR = 30

# A published read time may sit slightly ahead of this machine's clock
# (different hosts, no shared NTP) but not meaningfully so, and it may lag by
# a few nightly runs before it stops describing a live register.
FRESHNESS_SKEW_SECONDS = 6 * 3600
FRESHNESS_MAX_AGE_SECONDS = 30 * 86400

FAILURES: list[str] = []
# THE SUITE'S OWN SIZE, asserted rather than printed.
#
# Every count in this file is a claim about the data; this one is a claim about
# the file. Deleting a test function's call from main() removed its assertions
# silently - the run still ended "all N checks passed", with a smaller N that
# nobody was comparing against anything. It happened for real: narrowing a loop
# from `seen` to a fixed vocabulary changed the total, and the only way I
# noticed was reading the number.
#
# The floor is compared BEFORE it counts itself, so it is the number of
# substantive checks, one less than the total the run prints.
#
# A FLOOR, not an equality: adding checks must not require editing a constant,
# or the constant becomes a chore people satisfy by lowering it. Raise it when
# a batch of checks lands. Lowering it is the thing to argue about in review.
#
# RAISE IT WHEN YOU ADD CHECKS, or the guard stops guarding. Left at 185 while
# the suite grew to 231, it still passed after two whole test functions were
# deleted - a floor 45 below the real count cannot detect a dropped call, which
# is the single thing it exists for.
MIN_CHECKS = 245
# Same figure as build_data.UNREAD_CEILING; kept literal here so the checker
# needs no pandas import. check_published asserts the two agree.
UNREAD_CEILING = 0.03

CHECKS = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global CHECKS
    CHECKS += 1
    if cond:
        print(f"  ok    {name}")
    else:
        FAILURES.append(f"{name}: {detail}")
        print(f"  FAIL  {name}  {detail}")


def read(*parts: str):
    return json.loads((DATA.joinpath(*parts)).read_text(encoding="utf-8"))


def read_or_none(*parts: str):
    """Read a published file, or None if it is not there.

    A partially published directory must produce named failures rather than an
    unhandled traceback: a traceback stops the suite at the first missing file
    and hides every check after it, which is the opposite of what a contract
    suite is for.
    """
    path = DATA.joinpath(*parts)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


# ── the field header ──────────────────────────────────────────────────────
def ts_fields_read() -> set[str]:
    """Every field name the TypeScript readers look up by name."""
    names: set[str] = set()
    for rel in (
        "lib/instruments/projects.ts",
        "app/instruments/consent/district/[code]/page.tsx",
        "components/instruments/DistrictProposals.tsx",
    ):
        src = (ROOT / rel).read_text(encoding="utf-8")
        names |= set(re.findall(r'ix\("(\w+)"\)', src))
        names |= set(re.findall(r"\bF\.(\w+)\b", src))
    names.discard("fields")
    return names


def py_fields_written() -> list[str]:
    """SHARD_FIELDS as build_data declares it, without importing pandas.

    The list is read to the closing bracket in column zero, and comments are
    stripped before field names are taken. Both matter. A comment on a field
    may itself contain a bracket - `ext` documents its value as
    [south, west, north, east] - which ends a non-greedy match early and
    silently truncates the declared list, so the contract check would compare
    the published header against a short list and report a false mismatch. And
    a quoted word inside a comment would otherwise be read as a field name.
    """
    src = (ROOT / "scripts" / "instruments" / "build_data.py").read_text(
        encoding="utf-8")
    block = re.search(r"^SHARD_FIELDS\s*=\s*\[(.*?)^\]", src, re.S | re.M)
    assert block, "SHARD_FIELDS not found in build_data.py"
    body = re.sub(r"#.*$", "", block.group(1), flags=re.M)
    return re.findall(r'"(\w+)"', body)


def test_field_contract(shards: list[dict]) -> None:
    print("\nshard field header")
    declared = py_fields_written()
    check("build_data declares fields", bool(declared), "SHARD_FIELDS empty")

    for s in shards:
        if s["fields"] != declared:
            check(f"{s['slug']} header matches SHARD_FIELDS", False,
                  f"{s['fields']} != {declared}")
            return
    check("every shard header matches SHARD_FIELDS exactly", True)

    read_by_ts = ts_fields_read()
    missing = sorted(read_by_ts - set(declared))
    check("every field the app reads exists in the header", not missing,
          f"read but not written: {missing}")

    # A field written but never read is not an error; it is a field the app has
    # not needed yet. Report it so it is a decision rather than an accident.
    unused = sorted(set(declared) - read_by_ts)
    if unused:
        print(f"        note: written but not read by the app: {unused}")


# ── row shape ─────────────────────────────────────────────────────────────
def test_row_shape(shards: list[dict]) -> None:
    print("\nrow shape")
    width = len(shards[0]["fields"])
    bad = [(s["slug"], len(r)) for s in shards for r in s["rows"] if len(r) != width]
    check("every row has exactly one cell per field", not bad,
          f"{len(bad)} ragged rows, first {bad[:3]}")

    F = {n: i for i, n in enumerate(shards[0]["fields"])}
    bad_sector = [s["slug"] for s in shards for r in s["rows"]
                  if not isinstance(r[F["sector"]], int)
                  or not (0 <= r[F["sector"]] < len(s["sectors"]))]
    check("sector indexes are inside shard.sectors", not bad_sector,
          f"out of range in {sorted(set(bad_sector))[:3]}")
    bad_status = [s["slug"] for s in shards for r in s["rows"]
                  if not isinstance(r[F["status"]], int)
                  or not (0 <= r[F["status"]] < len(s["statuses"]))]
    check("status indexes are inside shard.statuses", not bad_status,
          f"out of range in {sorted(set(bad_status))[:3]}")

    cats = {r[F["cat"]] for s in shards for r in s["rows"]}
    check("categories are A/B1/B2 or null", cats <= {"A", "B1", "B2", None},
          f"unexpected {sorted(c for c in cats if c not in {'A','B1','B2',None})}")

    dates = [r[F["date"]] for s in shards for r in s["rows"] if r[F["date"]]]
    bad_dates = [d for d in dates[:100000] if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d)]
    check("dates are ISO yyyy-mm-dd", not bad_dates, f"first {bad_dates[:3]}")


# ── the join the district page depends on ─────────────────────────────────
def test_register_matches_shards(shards: list[dict]) -> None:
    """The count the register advertises must equal what the page renders.

    The register index and the district page compute their district membership
    in two different places - Python and TypeScript - from the same shards. If
    they ever disagree, a district page says "All 412 proposals" while the list
    it just rendered holds 380, and the page is quietly lying about being
    complete. This recomputes the page's filter and compares.
    """
    print("\nregister index vs district page filter")
    reg = read_or_none("register", "districts.json")
    if reg is None:
        # Built by build_register_index.py, a separate step. Absent is a
        # named failure rather than a traceback: this suite gates the
        # sync job, where an unhandled exception reads as a broken
        # checker instead of an incomplete publish.
        check("register/districts.json is published", False, "file missing")
        return
    advertised = {r["code"]: r["n"] for r in reg}
    slugs_for = {r["code"]: set(r.get("slugs") or ()) for r in reg}

    rendered: Counter[int] = Counter()
    shard_of: dict[int, set[str]] = {}
    per_shard: dict[int, Counter[str]] = {}
    for s in shards:
        F = {n: i for i, n in enumerate(s["fields"])}
        for r in s["rows"]:
            targets = set(r[F["dall"]] or [])
            if r[F["dc"]] is not None:
                targets.add(r[F["dc"]])
            for t in targets:
                rendered[t] += 1
                shard_of.setdefault(t, set()).add(s["slug"])
                per_shard.setdefault(t, Counter())[s["slug"]] += 1

    mismatched = [(c, advertised[c], rendered.get(c, 0))
                  for c in advertised if advertised[c] != rendered.get(c, 0)]
    check("advertised count equals rendered count for every district",
          not mismatched, f"{len(mismatched)} differ, first {mismatched[:3]}")

    orphans = sorted(c for c in rendered if c not in advertised)
    check("no district is reachable in a shard but absent from the register",
          not orphans, f"{orphans[:5]}")

    # THE CHECK THAT MATTERS MOST HERE.
    #
    # The district page lists proposals by reading the shards register.slugs
    # names. If that set is missing even one shard holding the district, the
    # page silently drops those proposals while still captioning the list with
    # the register's full count - it says "All 1,106" above a list of 1. An
    # earlier single-slug version did exactly that to 141 districts.
    #
    # So: the shards named must be exactly the shards that hold it.
    incomplete = {c: sorted(have - slugs_for.get(c, set()))
                  for c, have in shard_of.items()
                  if have - slugs_for.get(c, set())}
    hidden = sum(
        sum(cnt for slug, cnt in shard_counts.items() if slug in incomplete.get(c, []))
        for c, shard_counts in per_shard.items()
    )
    check("register.slugs names EVERY shard holding the district",
          not incomplete,
          f"{len(incomplete)} districts short, {hidden} proposals would be hidden, "
          f"first {list(incomplete.items())[:3]}")

    phantom = {c: sorted(set(s) - shard_of.get(c, set()))
               for c, s in slugs_for.items()
               if advertised[c] and set(s) - shard_of.get(c, set())}
    check("register.slugs names no shard that lacks the district",
          not phantom, f"{list(phantom.items())[:3]}")

    multi = sum(1 for v in shard_of.values() if len(v) > 1)
    print(f"        note: {multi} districts draw proposals from more than one "
          f"shard; all of them are read")


# ── measures and values ───────────────────────────────────────────────────
def test_measures() -> None:
    print("\nmeasures and values")
    registry = read("measures.json")
    districts = read("districts.json")
    measures = registry["measures"]

    unknown: set[str] = set()
    out_of_range: list[str] = []
    for code, d in districts.items():
        for key, val in d["values"].items():
            m = measures.get(key)
            if m is None:
                unknown.add(key)
                continue
            rng = m.get("range")
            if val is not None and rng and not (rng[0] <= val <= rng[1]):
                out_of_range.append(f"{code}/{key}={val} outside {rng}")
    check("every published value has a measure definition", not unknown,
          f"undefined: {sorted(unknown)[:5]}")
    check("every value is inside its declared range", not out_of_range,
          f"{len(out_of_range)} violations, first {out_of_range[:3]}")

    # The guard that makes a denominator mismatch structurally impossible: a
    # rate names the measure it divides by, and that measure must exist.
    dangling = [k for k, m in measures.items()
                if m.get("denominator_key") and m["denominator_key"] not in measures]
    check("every denominator_key resolves to a real measure", not dangling,
          f"{dangling}")

    for scope, table in (("india", registry["benchmarks"]["india"]),):
        stray = [k for k in table if k not in measures]
        check(f"{scope} benchmarks refer only to real measures", not stray, f"{stray[:5]}")


def test_legal_reference() -> None:
    """Prose that reaches the reader must be whole sentences.

    Every determination note is rendered verbatim on the district page and in
    the exported PDF - no interface rewrites it. A note assembled from a noun
    phrase reads as a fragment in both, which is how 83 determinations came to
    open mid-sentence with "territorial divisions as existing at...".
    """
    print("\nlegal reference prose")
    try:
        legal = read("legal_reference.json")
    except FileNotFoundError:
        print("        legal_reference.json absent, skipping")
        return
    dets = legal.get("determinations", {})
    check("determinations are published", bool(dets), "none found")

    fragments = [c for c, d in dets.items()
                 if d.get("note") and not d["note"].lstrip()[:1].isupper()]
    check("every determination note begins a sentence", not fragments,
          f"{len(fragments)} start lower-case, e.g. "
          f"{[dets[c]['note'][:48] for c in fragments[:2]]}")

    unterminated = [c for c, d in dets.items()
                    if d.get("note") and d["note"].rstrip()[-1:] not in ".?”)"]
    check("every determination note ends a sentence", not unterminated,
          f"{unterminated[:3]}")

    valid = {"within", "partial", "outside", "not_determined"}
    bad = {c: d.get("status") for c, d in dets.items() if d.get("status") not in valid}
    check("every status is one of the four defined values", not bad, f"{list(bad.items())[:3]}")

    # A determination that asserts a status must say which Order says so.
    uncited = [c for c, d in dets.items()
               if d.get("status") in ("within", "partial") and not d.get("citation")]
    check("every within/partial determination carries a citation", not uncited,
          f"{uncited[:5]}")

    unverified = [o.get("provision") for o in legal.get("obligations", [])
                  if not o.get("verified")]
    check("every published obligation is marked verified", not unverified,
          f"{unverified[:3]}")


def test_meta_agrees(shards: list[dict]) -> None:
    print("\nmeta.json")
    meta = read("meta.json")
    counts = meta["counts"]
    published = sum(len(s["rows"]) for s in shards)
    check("proposals_published equals rows actually shipped",
          counts["proposals_published"] == published,
          f"meta={counts['proposals_published']} shards={published}")

    F = {n: i for i, n in enumerate(shards[0]["fields"])}
    resolved = sum(1 for s in shards for r in s["rows"] if r[F["dc"]] is not None)
    check("proposals_district_resolved equals rows carrying a district",
          counts["proposals_district_resolved"] == resolved,
          f"meta={counts['proposals_district_resolved']} actual={resolved}")

    rate = round(resolved / published * 100, 2) if published else 0.0
    check("resolution_rate_pct is that ratio, not a stored guess",
          abs(meta["resolution_rate_pct"] - rate) < 0.02,
          f"meta={meta['resolution_rate_pct']} computed={rate}")

    check("no unreported invariant violations",
          meta["invariants"]["violations"] == 0,
          f"{meta['invariants']['detail'][:3]}")

    check("districts.json holds the count meta claims",
          counts["districts"] == len(read("districts.json")),
          f"meta={counts['districts']} file={len(read('districts.json'))}")


# ── the columns added by the appraisal and geometry work ──────────────────
def test_stage_registry(shards: list[dict]) -> None:
    """Every published status key resolves, and the registry is self-consistent.

    The whole point of the stage registry is that a filter and the count above
    it resolve through one definition. If a shard carries a key the registry
    does not define, the interface renders a filter that silently matches
    nothing - the exact failure the registry was built to remove.
    """
    print()
    print("stage registry")
    reg = read_or_none("stages.json")
    if reg is None:
        check("stages.json is published", False, "file missing or unreadable")
        return
    statuses = reg.get("statuses") or {}
    phases = reg.get("phases") or {}

    check("stages.json publishes statuses and phases",
          bool(statuses) and bool(phases),
          f"{len(statuses)} statuses, {len(phases)} phases")

    bad_phase = [k for k, v in statuses.items() if v.get("phase") not in phases]
    check("every status names a phase the registry defines",
          not bad_phase, str(bad_phase[:5]))

    carried = sum(1 for sh in shards if "sk" in
                  {n: i for i, n in enumerate(sh["fields"])})
    check("the status key column is present in every shard",
          carried == len(shards), f"{carried} of {len(shards)} shards carry `sk`")

    unknown: set[str] = set()
    unclassified = 0
    total = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "sk" not in F:
            continue
        for r in sh["rows"]:
            total += 1
            key = r[F["sk"]]
            if key not in statuses:
                unknown.add(str(key))
            elif key == "unclassified":
                unclassified += 1
    check("every published status key resolves to the registry",
          not unknown, str(sorted(unknown)[:5]))
    check("no published proposal carries an unclassified status",
          unclassified == 0, f"{unclassified:,} of {total:,}")

    # A canonical key that stands for several source spellings must say so, or
    # a reader cannot tell that one filter covers four labels.
    missing_raw = [k for k, v in statuses.items() if not v.get("raw")]
    check("every status records the source spellings behind it",
          len(missing_raw) <= 1,  # `unclassified` legitimately has none
          str(missing_raw[:5]))


def test_site_geometry(shards: list[dict]) -> None:
    """Coordinates are inside India, and the geometric verdicts are defined."""
    print()
    print("site coordinates")
    VALID = {"inside", "boundary", "elsewhere", "offshore", "unmapped",
             "no_geometry"}
    bad_gk: set[str] = set()
    out_of_bounds = 0
    bad_ext = 0
    with_coords = 0
    total = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "lat" not in F:
            continue
        for r in sh["rows"]:
            total += 1
            gk = r[F["gk"]]
            if gk is not None and gk not in VALID:
                bad_gk.add(str(gk))
            lat, lon = r[F["lat"]], r[F["lon"]]
            if lat is None or lon is None:
                continue
            with_coords += 1
            if not (6.0 <= lat <= 37.6 and 67.0 <= lon <= 97.5):
                out_of_bounds += 1
            ext = r[F["ext"]]
            if ext is not None:
                if (len(ext) != 4 or ext[0] > ext[2] or ext[1] > ext[3]
                        or not (ext[0] <= lat <= ext[2])
                        or not (ext[1] <= lon <= ext[3])):
                    bad_ext += 1
    check("every geometry verdict is one of the defined values",
          not bad_gk, str(sorted(bad_gk)))
    check("every published coordinate is inside India",
          out_of_bounds == 0, f"{out_of_bounds:,} of {with_coords:,}")
    check("every envelope is ordered and contains its own point",
          bad_ext == 0, f"{bad_ext:,} malformed")
    check("coordinates were actually examined",
          with_coords > 0, f"{with_coords:,} of {total:,} carry coordinates")

    # The verdict is the point of the coordinates. Asserting only that some
    # coordinates exist would stay green if every verdict were blanked - which
    # is the whole geometric check silently disappearing. A row that carries a
    # coordinate AND names a district has something to compare, so it must
    # carry a verdict.
    testable = missing = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if not {"lat", "gk", "dc"} <= set(F):
            continue
        for r in sh["rows"]:
            if r[F["lat"]] is None or r[F["dc"]] is None:
                continue
            testable += 1
            if r[F["gk"]] is None:
                missing += 1
    check("every testable location carries a verdict",
          testable > 0 and missing == 0,
          f"{missing:,} of {testable:,} testable rows have no verdict")


def test_appraisal(shards: list[dict]) -> None:
    """Durations are non-negative, and every aggregate names its denominator."""
    print()
    print("appraisal timing")
    carried = sum(1 for sh in shards if "dtd" in
                  {n: i for i, n in enumerate(sh["fields"])})
    check("the timing columns are present in every shard",
          carried == len(shards), f"{carried} of {len(shards)} shards carry `dtd`")

    neg_dtd = neg_dpd = both = 0
    rows_seen = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "dtd" not in F:
            continue
        for r in sh["rows"]:
            dtd, dpd = r[F["dtd"]], r[F["dpd"]]
            if dtd is not None and dtd < 0:
                neg_dtd += 1
            if dpd is not None and dpd < 0:
                neg_dpd += 1
            if dtd is not None and dpd is not None:
                both += 1
            rows_seen += 1
    check("no negative time to decision", neg_dtd == 0, f"{neg_dtd:,}")
    check("no negative days open", neg_dpd == 0, f"{neg_dpd:,}")
    check("no proposal is both decided and still open", both == 0, f"{both:,}")
    check("timing was actually examined", rows_seen > 0, f"{rows_seen:,} rows")

    # A duration must be reachable from the date published beside it. `date` is
    # the register's own submission date and moves forward on re-submission;
    # `fon` is the date the duration was measured from. Publishing one while
    # measuring from the other leaves arithmetic a reader cannot close.
    missing_fon = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "fon" not in F or "dtd" not in F:
            continue
        for r in sh["rows"]:
            if r[F["dtd"]] is not None and not r[F["fon"]]:
                missing_fon += 1
    check("every duration carries the date it was measured from",
          missing_fon == 0, f"{missing_fon:,} rows have dtd without fon")

    ap = read_or_none("appraisal.json")
    if ap is None:
        check("appraisal.json is published", False, "file missing or unreadable")
        return
    registry = ap.get("registry") or {}
    check("appraisal.json carries a measure registry", bool(registry),
          f"{len(registry)} measures")
    incomplete = [k for k, v in registry.items()
                  if not all(v.get(f) for f in
                             ("label", "definition", "formula", "source", "vintage"))]
    check("every appraisal measure states definition, formula, source, vintage",
          not incomplete, str(incomplete[:4]))

    # Every published distribution must carry the count it was computed from,
    # and must not be published below the stated floor.
    # The floor is asserted, not adopted. Reading it from the file being
    # checked means a build that publishes `minGroup: 1` also publishes a
    # median over one proposal, and this check keeps printing ok - the guard
    # validates itself. MIN_GROUP_FLOOR is the contract; the file must agree
    # with it, not define it.
    check("appraisal.json declares the agreed small-group floor",
          ap.get("minGroup") == MIN_GROUP_FLOOR,
          f"minGroup={ap.get('minGroup')}, contract={MIN_GROUP_FLOOR}")
    floor = MIN_GROUP_FLOOR
    thin: list[str] = []
    missing_n: list[str] = []

    def walk(node, path: str) -> None:
        if isinstance(node, dict):
            # `median` alone is enough to be a published distribution.
            # Requiring p90 too meant a group with a median, an n of 3 and no
            # p90 skipped the small-group floor entirely - the guard was
            # effectively opt-in for whoever wrote the data.
            if "median" in node:
                if "n" not in node:
                    missing_n.append(path)
                elif node["n"] < floor:
                    thin.append(f"{path} n={node['n']}")
                return
            for k, v in node.items():
                if k != "registry":
                    walk(v, f"{path}.{k}" if path else k)

    walk(ap, "")
    check("every published distribution states its own count",
          not missing_n, str(missing_n[:5]))
    check("no distribution is published below the stated minimum group",
          not thin, str(thin[:5]))

    # The aggregate must describe the rows beside it. Without this, every
    # median can be multiplied by ten and every count set to nonsense.
    rows_with_duration = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "dtd" not in F:
            continue
        rows_with_duration += sum(1 for r in sh["rows"] if r[F["dtd"]] is not None)
    stated = int(((ap.get("coverage") or {}).get("with_duration")) or -1)
    check("the appraisal coverage matches the rows it summarises",
          stated == rows_with_duration,
          f"appraisal.json says {stated:,}, the shards carry {rows_with_duration:,}")

    cov = ap.get("coverage") or {}
    check("appraisal coverage is published",
          "proposals_summarised" in cov and "with_duration" in cov,
          json.dumps(cov)[:120])

    # THE HEADLINE FIGURE, RECOMPUTED FROM THE SHARDS.
    #
    # Everything above checks the aggregate's SHAPE - that a count is present,
    # that no group is thinner than the floor, that the coverage total matches
    # the rows. None of it recomputes a single published number, so the one
    # claim the appraisal page exists to make - how long a clearance decision
    # takes - had no assertion behind it at all: appraisal.py could shift every
    # median and the contract would still print ok.
    #
    # Derived independently here, from the canonical stage key rather than
    # from appraisal.py's own `decision_kind`, so a bug in that mapping shows
    # up as a disagreement instead of being reproduced on both sides.
    EC_STAGES = {"ec_granted", "ec_rejected"}
    ec_days: list[int] = []
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "dtd" not in F or "sk" not in F:
            continue
        for r in sh["rows"]:
            if r[F["dtd"]] is not None and r[F["sk"]] in EC_STAGES:
                ec_days.append(r[F["dtd"]])
    ec_days.sort()

    published_ec = ((ap.get("national") or {}).get("environmentalClearance") or {})
    check("the headline environmental-clearance count matches the shards",
          published_ec.get("n") == len(ec_days),
          f"appraisal.json says {published_ec.get('n')}, "
          f"the shards carry {len(ec_days)}")

    if ec_days:
        def rank(p: float) -> int:
            # The same nearest-rank convention appraisal.py publishes with.
            i = min(len(ec_days) - 1, max(0, int(round(p * (len(ec_days) - 1)))))
            return ec_days[i]

        expected = {
            "median": int(statistics.median(ec_days)),
            "p25": rank(0.25),
            "p75": rank(0.75),
            "p10": rank(0.10),
            "p90": rank(0.90),
        }
        wrong = [f"{k}: published {published_ec.get(k)}, recomputed {v}"
                 for k, v in expected.items() if published_ec.get(k) != v]
        check("every published environmental-clearance percentile recomputes "
              "from the shards", not wrong, "; ".join(wrong[:3]))

    # EVERY BREAKDOWN, recomputed - not just the national headline.
    #
    # The appraisal page renders a row per sector, per state, per authority,
    # per category and per outcome: 41 published distributions, and only the
    # national figure was checked. Multiplying every percentile in all of them
    # by ten passed the contract.
    #
    # This also closes the one anchor `sector` never had. It is stored as an
    # INDEX into a per-shard array, so shifting every row's index by one
    # publishes each proposal under its neighbour's sector and stays perfectly
    # self-consistent - valid range, unchanged vocabulary, same row count. It
    # only becomes visible when the GROUP SIZES are compared against rows
    # gathered independently, which is what this does.
    ec_published = ap.get("environmentalClearance") or {}
    OUTCOME_OF = {"ec_granted": "granted", "ec_rejected": "rejected"}

    grouped: dict = {k: {} for k in
                     ("bySector", "byState", "byAuthority", "byCategory",
                      "byOutcome")}

    def add(kind, key, value):
        if key is None or key == "":
            return
        grouped[kind].setdefault(key, []).append(value)

    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "dtd" not in F or "sk" not in F:
            continue
        sectors = sh.get("sectors") or []
        authorities = sh.get("authorities") or []
        for r in sh["rows"]:
            if r[F["dtd"]] is None or r[F["sk"]] not in EC_STAGES:
                continue
            v = r[F["dtd"]]
            si = r[F["sector"]] if "sector" in F else None
            if isinstance(si, int) and 0 <= si < len(sectors):
                add("bySector", sectors[si], v)
            add("byState", sh.get("state"), v)
            ai = r[F["auth"]] if "auth" in F else None
            if isinstance(ai, int) and 0 <= ai < len(authorities):
                add("byAuthority", authorities[ai], v)
            add("byCategory", r[F["cat"]] if "cat" in F else None, v)
            add("byOutcome", OUTCOME_OF.get(r[F["sk"]]), v)

    wrong_n, wrong_median, unknown_group = [], [], []
    checked_groups = 0
    for kind, published in ec_published.items():
        if kind not in grouped or not isinstance(published, dict):
            continue
        for name, spec in published.items():
            if not isinstance(spec, dict) or "median" not in spec:
                continue
            checked_groups += 1
            vals = sorted(grouped[kind].get(name, []))
            if not vals:
                unknown_group.append(f"{kind}.{name}: no rows carry it")
                continue
            if spec.get("n") != len(vals):
                wrong_n.append(f"{kind}.{name}: published {spec.get('n')}, "
                               f"shards {len(vals)}")
                continue
            if spec.get("median") != int(statistics.median(vals)):
                wrong_median.append(
                    f"{kind}.{name}: published {spec.get('median')}, "
                    f"shards {int(statistics.median(vals))}")

    check("every published appraisal group names rows that exist",
          not unknown_group, f"{unknown_group[:3]}")
    check("every appraisal group size matches the shard rows it describes",
          not wrong_n, f"{len(wrong_n)} disagree: {wrong_n[:3]}")
    check("every appraisal group median recomputes from the shards",
          not wrong_median, f"{len(wrong_median)} disagree: {wrong_median[:3]}")
    # byDecision and pending, recomputed too - and byPhase stated as the one
    # subtree that CANNOT be.
    #
    # Recomputing only the environmentalClearance subtree left 12 of the 54
    # published distributions with shape checks alone: the three byDecision
    # groups, pending, and the eight byPhase spans. byDecision and pending are
    # derivable from the rows; the decision mapping is taken from the published
    # stage registry rather than hand-written here, which is what makes it a
    # check and not a second copy of the same assumption.
    stage_registry = read_or_none("stages.json") or {}
    stage_decision = {k: (v or {}).get("decision")
                      for k, v in (stage_registry.get("statuses") or {}).items()}
    by_decision: dict = {}
    pending: list = []
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "dtd" not in F or "sk" not in F:
            continue
        for r in sh["rows"]:
            if r[F["dtd"]] is not None:
                key = stage_decision.get(r[F["sk"]]) or "unspecified"
                by_decision.setdefault(key, []).append(r[F["dtd"]])
            elif "dpd" in F and r[F["dpd"]] is not None:
                pending.append(r[F["dpd"]])

    wrong_dec = []
    for name, spec in ((ap.get("national") or {}).get("byDecision") or {}).items():
        if not isinstance(spec, dict) or "median" not in spec:
            continue
        vals = sorted(by_decision.get(name, []))
        if spec.get("n") != len(vals) or (
                vals and spec.get("median") != int(statistics.median(vals))):
            wrong_dec.append(f"{name}: published n={spec.get('n')} "
                             f"med={spec.get('median')}, shards n={len(vals)}")
    check("every by-decision group recomputes from the shards",
          not wrong_dec, f"{wrong_dec[:3]}")

    pend_spec = (ap.get("national") or {}).get("pending") or {}
    pending.sort()
    if pend_spec.get("median") is not None:
        check("the pending distribution recomputes from the shards",
              pend_spec.get("n") == len(pending)
              and (not pending or pend_spec.get("median") == int(statistics.median(pending))),
              f"published n={pend_spec.get('n')} med={pend_spec.get('median')}, "
              f"shards n={len(pending)}")

    # The one subtree that genuinely cannot be recomputed, said out loud.
    phases = (ap.get("byPhase") or {}).get("phases") or {}
    print(f"  NOTE: {len(phases)} byPhase spans are NOT recomputable from the "
          f"published rows - per-phase durations exist only in the appraisal "
          f"history, which the shards do not carry. They have shape checks "
          f"only, and that is a real limit of this contract.")

    print(f"  recomputed {checked_groups} appraisal groups from the shards")


def test_no_contact_details(shards: list[dict]) -> None:
    """No published free-text field carries a way to contact a private person.

    Proponent names are published deliberately: an applicant is a party to a
    public regulatory proceeding and naming them is what a public register is
    for. An email address or phone number is different in kind - it is almost
    always a data-entry slip, it says nothing about the project, and it is
    directly actionable. One filing in the register has an applicant's personal
    address typed into the project-name field.
    """
    print()
    print("contact details")
    hits_e: list[str] = []
    hits_p: list[str] = []
    scanned = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        for r in sh["rows"]:
            # EVERY string column, not just name and agency.
            #
            # Two columns of 39 left about 49 MB unscanned - every other string
            # field of 89,817 rows - while the whole-tree scan below skips the
            # projects directory entirely. An email or a mobile number typed
            # into a status remark, a certificate path or a project number was
            # published unchallenged, and the pair of checks was named "no
            # email address is published" / "no phone number is published".
            #
            # `cert` is excluded deliberately and only there: it is a URL
            # fragment of digits, and PHONE_RE matches a ten-digit run whose
            # neighbours are slashes - 830 certificate names would report as
            # phone numbers. Emails are still checked in it, since an address
            # cannot occur there innocently.
            for col in F:
                v = r[F[col]]
                if not isinstance(v, str) or not v:
                    continue
                scanned += 1
                if EMAIL_RE.search(v):
                    hits_e.append(f"{sh['slug']}/{r[F['id']]}.{col}: {v[:60]}")
                if col != "cert" and (LABELLED_PHONE_RE.search(v)
                                      or PHONE_RE.search(v)):
                    hits_p.append(f"{sh['slug']}/{r[F['id']]}.{col}: {v[:60]}")
    check("scanned the free-text fields", scanned > 0, f"{scanned:,} values")

    # Every published file, not only the two shard columns. An address in
    # register/districts.json or lookup.json is as public as one in a project
    # name, and the earlier scan would not have seen it.
    # PHONES TOO, and over string VALUES rather than the raw bytes.
    #
    # This scanned for EMAIL_RE only, so a phone number in
    # register/districts.json or lookup.json was published unchallenged while
    # the identical email in the same field was caught. And it scanned the raw
    # file text, where a ten-digit numeric id sits next to a comma rather than
    # a digit and therefore satisfies PHONE_RE - a false positive waiting for
    # the first proposal id in that range. Walking the parsed structure and
    # testing only string values removes both problems.
    other_e: list[str] = []
    other_p: list[str] = []

    def scan_strings(node, where: str) -> None:
        if isinstance(node, str):
            if EMAIL_RE.search(node):
                other_e.append(f"{where}: {node[:60]}")
            if LABELLED_PHONE_RE.search(node) or PHONE_RE.search(node):
                other_p.append(f"{where}: {node[:60]}")
        elif isinstance(node, dict):
            for k, v in node.items():
                scan_strings(k, where)
                scan_strings(v, where)
        elif isinstance(node, list):
            for v in node:
                scan_strings(v, where)

    for path in sorted(DATA.rglob("*.json")):
        if path.parent.name == "projects":
            continue
        try:
            scan_strings(json.loads(path.read_text(encoding="utf-8")),
                         str(path.relative_to(DATA)))
        except Exception:  # noqa: BLE001
            continue
    check("no email address anywhere else in the published data",
          not other_e, str(other_e[:3]))
    check("no phone number anywhere else in the published data",
          not other_p, str(other_p[:3]))
    check("no email address is published", not hits_e, str(hits_e[:3]))
    check("no phone number is published", not hits_p, str(hits_p[:3]))


def test_derived_columns(shards: list[dict]) -> None:
    """The columns the appraisal and geometry work added must hold their shape.

    Each of these was published for a while with nothing asserting anything
    about it, which is how `gd` came to be an arbitrary numeric minimum and how
    an arithmetic identity stated in the field comments went unchecked.
    """
    print()
    print("derived columns")
    districts = read_or_none("districts.json") or {}
    valid_codes = {int(k) for k in districts} if districts else set()
    SQ = {"alt", "1c", "rej", "unt", "none", "old", "wide"}

    bad_ident = bad_sq = bad_gd = bad_nblk = 0
    checked_ident = seen_sq = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if not {"fon", "don", "dtd", "dsu"} <= set(F):
            continue
        for r in sh["rows"]:
            fon, don = r[F["fon"]], r[F["don"]]
            dtd, dsu = r[F["dtd"]], r[F["dsu"]]
            if fon and don and dtd is not None:
                checked_ident += 1
                if (date.fromisoformat(don) - date.fromisoformat(fon)).days != \
                        dtd + (dsu or 0):
                    bad_ident += 1
            sq = r[F["sq"]] if "sq" in F else None
            if sq is not None:
                seen_sq += 1
                if not str(sq).strip():
                    bad_sq += 1
                    continue
                if not set(str(sq).split()) <= SQ:
                    bad_sq += 1
            gd = r[F["gd"]] if "gd" in F else None
            if gd is not None and valid_codes and gd not in valid_codes:
                bad_gd += 1
            nblk = r[F["nblk"]] if "nblk" in F else None
            if r[F["lat"]] is not None and (nblk is None or nblk < 1):
                bad_nblk += 1

    check("the decision arithmetic closes: fon + dtd + dsu == don",
          checked_ident > 0 and bad_ident == 0,
          f"{bad_ident:,} of {checked_ident:,} rows do not close")
    check("every site-quality flag is one the field defines",
          bad_sq == 0, f"{bad_sq:,} of {seen_sq:,} carry an undefined flag")
    check("every located district is a real Census 2011 district",
          bad_gd == 0, f"{bad_gd:,} rows name a code districts.json does not hold")
    check("a published coordinate carries a block count",
          bad_nblk == 0, f"{bad_nblk:,} rows have a point but no block count")

    # A count is only as good as its agreement with the summary published
    # beside it. meta.json states how many locations are spread over more than
    # one block; if the rows disagree, one of the two is wrong and a reader has
    # no way to tell which.
    meta = read_or_none("meta.json") or {}
    stated = (((meta.get("site_geometry") or {}).get("coordinates") or {})
              .get("multi_block"))
    counted = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "nblk" not in F:
            continue
        counted += sum(1 for r in sh["rows"] if (r[F["nblk"]] or 0) > 1)
    # Presence first. `stated is None or ...` passed when meta simply omitted
    # the figure, so deleting one key turned the comparison off and the line
    # kept printing ok.
    check("meta states how many filings span several blocks",
          isinstance(stated, int), "site_geometry.coordinates.multi_block absent")
    check("the multi-block count agrees with the rows",
          isinstance(stated, int) and stated == counted,
          f"meta says {stated:,} rows span several blocks, the shards hold "
          f"{counted:,}" if stated is not None else "meta does not state it")


def test_verdict_consistency(shards: list[dict]) -> None:
    """The geometric verdict must agree with the row that carries it.

    The verdict cannot be recomputed here - the boundary file lives in the
    fetch cache and this suite must run on a bare clone - but it can be held
    to the rest of its own row. `inside` asserts the published point sits in a
    district the filing names, so the district it was located in must be one of
    them; `elsewhere` asserts the opposite. Without this, flipping every
    verdict to `inside`, or blanking the located district entirely, passes.
    """
    print()
    print("verdict consistency")
    inside_bad = elsewhere_bad = missing_gd = 0
    inside_n = elsewhere_n = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if not {"gk", "gd", "dc", "dall"} <= set(F):
            continue
        for r in sh["rows"]:
            gk, gd = r[F["gk"]], r[F["gd"]]
            if gk not in ("inside", "elsewhere"):
                continue
            named = set(r[F["dall"]] or ([r[F["dc"]]] if r[F["dc"]] is not None else []))
            if gd is None:
                missing_gd += 1
                continue
            if gk == "inside":
                inside_n += 1
                if gd not in named:
                    inside_bad += 1
            else:
                elsewhere_n += 1
                if gd in named:
                    elsewhere_bad += 1

    check("verdicts were actually examined", inside_n + elsewhere_n > 0,
          f"{inside_n:,} inside, {elsewhere_n:,} elsewhere")
    check("every 'inside' names a district the filing named",
          inside_bad == 0, f"{inside_bad:,} of {inside_n:,} do not")
    check("no 'elsewhere' names a district the filing named",
          elsewhere_bad == 0, f"{elsewhere_bad:,} of {elsewhere_n:,} do")
    check("every decided verdict carries the district it was located in",
          missing_gd == 0, f"{missing_gd:,} rows have a verdict but no district")


# The denominator each published rate MUST use, stated here independently of
# measures.py.
#
# `test_denominators_match_the_registry` imports MEASURES from measures.py and
# compares measures.json against it - but measures.json is SERIALISED from
# measures.py, so the two agree by construction. Changing literacy's
# denominator from population aged 7+ to total population and rebuilding
# satisfied it perfectly, while every literacy rate on the site became wrong by
# roughly a fifth and remained internally consistent.
#
# This table is the ground truth the drift check cannot supply: Census
# definitions, written down once, in the suite rather than in the code being
# checked. A rate whose denominator changes here has to be argued for, which is
# the point.
CENSUS_DENOMINATORS = {
    # Literacy is defined over population aged 7 and above. Computing it over
    # total population is the single most common error with this table and
    # yields a materially different, non-comparable figure.
    "pop.literacy_rate": "pop.age7plus",
    # Population shares are shares OF the population.
    "pop.st_share": "pop.total",
    "pop.sc_share": "pop.total",
    "pop.child_share": "pop.total",
    # Worker composition is a share of WORKERS, not of population. Using
    # pop.total would silently halve every one of them.
    "work.cultivator_share": "work.total_workers",
    "work.ag_labourer_share": "work.total_workers",
    "work.household_industry_share": "work.total_workers",
    "work.land_dependent_share": "work.total_workers",
    "work.marginal_share": "work.total_workers",
    # Participation is workers AS A SHARE OF population - the one work measure
    # whose denominator is deliberately the population.
    "work.participation_rate": "pop.total",
    # Vacancy is against sanctioned posts, not against posts filled.
    "infra.phc_doctor_vacancy_rate": "infra.phc_doctors_sanctioned",
    # SECC shares are shares of RURAL HOUSEHOLDS, not of population. Weighting
    # them by population would silently change every one of them.
    "secc.land_owning_share": "secc.households",
    "secc.earner_over_5k_share": "secc.households",
    "secc.manual_labour_share": "secc.households",
    "secc.salaried_share": "secc.households",
}


def test_denominators_match_the_registry(shards: list[dict]) -> None:
    """A rate's denominator must be the one the registry source declares.

    The engineering reference rests the whole fact layer on this: a benchmark and the value it
    judges resolve to the same registry entry, which is what makes a
    denominator mismatch structurally impossible. Asserting only that a
    denominator_key RESOLVES leaves the mismatch possible - swapping literacy's
    denominator from population aged 7+ to households resolves perfectly well
    and is wrong by a factor of five.
    """
    print()
    print("denominators")
    published = read_or_none("measures.json")
    if published is None:
        check("measures.json is published", False, "file missing")
        return
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from measures import MEASURES as SOURCE
    except Exception as exc:  # noqa: BLE001
        check("the measure registry source is importable", False,
              f"{type(exc).__name__}: {exc}")
        return

    pub = published.get("measures") or {}
    check("every source measure is published", set(SOURCE) <= set(pub),
          str(sorted(set(SOURCE) - set(pub))[:5]))

    # GROUND TRUTH, not self-consistency. See CENSUS_DENOMINATORS.
    wrong_denominator = []
    for key, expected in CENSUS_DENOMINATORS.items():
        got = (pub.get(key) or {}).get("denominator_key")
        if got != expected:
            wrong_denominator.append(f"{key}: publishes /{got}, must be /{expected}")
    check("every rate divides by the denominator its Census definition names",
          not wrong_denominator, f"{wrong_denominator[:3]}")

    # And nothing acquires one quietly: a measure gaining a denominator this
    # table does not know about is a definition nobody has checked.
    undeclared = sorted(
        k for k, v in pub.items()
        if (v or {}).get("denominator_key") and k not in CENSUS_DENOMINATORS
    )
    check("no published rate carries a denominator this suite has not pinned",
          not undeclared, f"unpinned: {undeclared[:5]}")


    drift = []
    for key, spec in SOURCE.items():
        got = pub.get(key) or {}
        # All of it, not four fields. label, definition, source, vintage and
        # caveats are the prose the interface prints beside every figure and
        # the PDF copies verbatim: rewriting literacy's definition to "share of
        # the TOTAL population", its source to anything, and its vintage to
        # 2031 passed, because only the four computational fields were read.
        for field in ("denominator_key", "kind", "unit", "formula",
                      "label", "definition", "source", "vintage", "caveat"):
            if got.get(field) != spec.get(field):
                drift.append(f"{key}.{field}: {got.get(field)!r} != {spec.get(field)!r}")
    check("every published measure matches the registry that defines it",
          not drift, str(drift[:4]))

    rates_without = [k for k, v in pub.items()
                     if v.get("kind") == "rate" and not v.get("denominator_key")]
    check("every rate names its denominator", not rates_without,
          str(rates_without[:5]))


def test_source_coverage(shards: list[dict]) -> None:
    """Every proposal must say whether its source form was actually read.

    `cf` separates three silences that otherwise publish identically: the
    regulator serves no form for this proposal, the form was read and names no
    place, and we have not read it yet. Collapsing them makes the register's
    own gaps and ours indistinguishable, and the young cohort the daily sync
    always carries would read as government non-disclosure.

    Written to fail: blanking the field, inventing a fourth code, marking a
    row `ok` when nothing was read, or letting the meta total drift from the
    rows are each caught here.
    """
    print()
    print("source coverage")
    CF = {"ok", "nogeo", "none", "pend"}
    meta = read_or_none("meta.json") or {}
    # The letter standing for "placed from the project name", taken from the
    # legend the data publishes rather than restated here, so the two cannot
    # drift apart into a check that silently stops checking.
    by_code = (read_or_none("index.json") or {}).get("resolutionCodes") or {}
    name_code = next((c for c, n in by_code.items() if n == "project_name"), None)
    check("meta publishes a legend for dm", name_code is not None,
          str(by_code)[:80])
    seen: dict[str, int] = {}
    bad_code = ok_without_source = 0
    missing = [sh["slug"] for sh in shards
               if "cf" not in set(sh["fields"])]
    check("every shard carries cf", not missing,
          f"{len(missing)} without it: {missing[:3]}")
    if missing:
        return
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        for r in sh["rows"]:
            v = r[F["cf"]]
            if v not in CF:
                bad_code += 1
                continue
            seen[v] = seen.get(v, 0) + 1
            # `ok` asserts a form was read AND placed the proposal, so a
            # resolution method that never touched the form contradicts it.
            if v == "ok" and name_code and "dm" in F and r[F["dm"]] == name_code:
                ok_without_source += 1

    check("every cf value is one of the four", bad_code == 0,
          f"{bad_code} rows carry something else")
    check("no row claims a form it did not use", ok_without_source == 0,
          f"{ok_without_source} rows say ok but were placed by project name")
    check("the four states are not collapsed into one", len(seen) >= 2,
          f"only {sorted(seen)} present")

    cov = meta.get("caf_coverage")
    check("meta publishes caf_coverage", isinstance(cov, dict), str(cov)[:60])
    if isinstance(cov, dict):
        check("meta names all four states", set(cov) == CF, str(sorted(cov)))
        # Every cf state, not only those the rows still carry. Iterating `seen`
    # meant a code dropping to zero rows stopped being compared at all, so
    # meta could keep claiming 44,000 of them while the check printed ok for
    # the three that remained - and the suite's total quietly fell by one,
    # which nothing noticed because the count is printed, not asserted.
        for k in sorted(CF):
            check(f"meta {k} matches the rows", cov.get(k) == seen.get(k, 0),
                  f"meta {cov.get(k)} vs rows {seen.get(k, 0)}")

    # THE UNREAD COHORT IS BOUNDED. `pend` is legitimate for proposals that
    # appeared since the last form backfill - a few hundred a day at most. A
    # build run without the form cache marks EVERY row `pend`, places a third
    # of the register from project names, and used to pass the build's own
    # invariants with 0 violations: the read-rate floor only engages once
    # 1,000 forms have been read, and none had. This is the gate that says a
    # build which did not read the forms is not a build worth publishing.
    total = sum(seen.values())
    pend = seen.get("pend", 0)
    check(f"at most {100*UNREAD_CEILING:.0f}% of the register is unread",
          total > 0 and pend <= total * UNREAD_CEILING,
          f"{pend:,} of {total:,} unread ({100*pend/max(1,total):.1f}%)")
    src = (ROOT / "scripts" / "instruments" / "build_data.py").read_text(
        encoding="utf-8")
    m = re.search(r"^UNREAD_CEILING\s*=\s*([0-9.]+)", src, re.M)
    check("the build and this check use the same unread ceiling",
          bool(m) and float(m.group(1)) == UNREAD_CEILING,
          f"build {m.group(1) if m else 'absent'} vs check {UNREAD_CEILING}")
    # The competence figure, and the one arithmetic relation between the two
    # published rates. Stated twice in meta and derivable from the rows, so a
    # build that reports a healthy rate over rows that disagree is caught.
    read = seen.get("ok", 0) + seen.get("nogeo", 0)
    if read:
        want = round(100 * seen.get("ok", 0) / read, 2)
        got = meta.get("resolution_rate_of_read_pct")
        check("meta publishes the read-cohort rate", got is not None)
        check("and it matches the rows", got == want, f"meta {got} vs rows {want}")
        # NOT `read <= sum(seen.values())`. That compares a subset sum of
        # non-negative counts against their total, so it is true for every
        # possible input and the check could never fail - it asserted
        # arithmetic, not the property in its name.
        #
        # What the name claims is that the two published rates rest on
        # DIFFERENT denominators: the read cohort (ok + nogeo) and the whole
        # register. The engineering reference is explicit that quoting one for the other is the
        # error to prevent - the whole-register rate read 71.78% mid-backfill
        # and 99.59% complete for identical code. So assert they actually
        # differ whenever anything is unread, and that the two published
        # percentages differ with them.
        unread = seen.get("none", 0) + seen.get("pend", 0)
        total_rows = sum(seen.values())
        check("the read cohort is a strict subset while anything is unread",
              (read < total_rows) if unread else (read == total_rows),
              f"read {read} of {total_rows}, unread {unread}")
        whole = meta.get("resolution_rate_pct")
        check("the two resolution rates are not the same number",
              unread == 0 or whole is None or got is None or whole != got,
              f"whole-register {whole} == read-cohort {got}, with {unread} "
              f"proposals unread - one of the two is mislabelled")
    # The coordinate outcomes must partition the register exactly. They did
    # not: a filing whose every block was discarded was counted both as its
    # own outcome and as "no location filed", and present + absent still summed
    # to the register total - a clean-looking partition with 354 filings
    # counted twice inside it.
    g = ((meta.get("site_geometry") or {}).get("coordinates") or {})
    if g:
        parts = ("present", "filed_but_all_discarded", "absent")
        check("the coordinate outcomes are all published",
              all(k in g for k in parts), str(sorted(g)))
        if all(k in g for k in parts):
            total = (meta.get("counts") or {}).get("proposals_published")
            got = sum(g[k] for k in parts)
            check("and they partition the register exactly", got == total,
                  f"{got:,} vs {total:,}")
            # NOT `g.get(key, <the other side>)`, which defaults to the very
            # value it is compared with and therefore cannot ever differ:
            # deleting the key turned the assertion into `x == x`.
            check("meta states how many filings had every block discarded",
                  "all_blocks_rejected" in g,
                  "site_geometry.coordinates.all_blocks_rejected absent")
            check("a filing whose blocks were all discarded is not also absent",
                  g.get("all_blocks_rejected") == g["filed_but_all_discarded"],
                  f"{g['filed_but_all_discarded']} vs "
                  f"{g.get('all_blocks_rejected')}")

    print(f"  {', '.join(f'{k} {v:,}' for k, v in sorted(seen.items()))}"
          f"  |  placed of read: {meta.get('resolution_rate_of_read_pct')}%"
          f"  |  placed of register: {meta.get('resolution_rate_pct')}%")


def test_index_contract(shards: list[dict]) -> None:
    """index.json is what the NEXT build reads its shard positions from.

    Nothing checked it. Shard `sector` and `status` are integer POSITIONS in
    these arrays, and the next build preserves that order by reading this
    file - so a corrupt, truncated or duplicated index does not break
    anything today, it silently renumbers every row tomorrow. The build has
    its own gate on this now; this asserts the same contract from outside,
    over the file as actually published.
    """
    print()
    print("the shard vocabulary index")
    idx = read_or_none("index.json")
    check("index.json is published and is an object", isinstance(idx, dict),
          type(idx).__name__)
    if not isinstance(idx, dict):
        return

    for key in ("sectors", "statuses"):
        arr = idx.get(key)
        check(f"index.json publishes {key}", isinstance(arr, list),
              type(arr).__name__)
        if not isinstance(arr, list):
            continue
        check(f"every {key} entry is a string",
              all(isinstance(v, str) for v in arr),
              str(sorted({type(v).__name__ for v in arr})))
        check(f"{key} has no duplicates - a position must identify a value",
              len(set(arr)) == len(arr),
              f"{len(arr) - len(set(arr))} repeated")

        # And every shard must agree with it, or a row means one thing when
        # read through its own shard and another through the index.
        mismatched = [sh["slug"] for sh in shards
                      if sh.get(key) is not None and sh[key] != arr]
        check(f"every shard's {key} matches index.json", not mismatched,
              f"{len(mismatched)} differ: {mismatched[:3]}")

    # The values rows actually use must all resolve.
    for key, field in (("sectors", "sector"), ("statuses", "status")):
        arr = idx.get(key)
        if not isinstance(arr, list):
            continue
        worst = 0
        for sh in shards:
            F = {n: i for i, n in enumerate(sh["fields"])}
            if field not in F:
                continue
            for r in sh["rows"]:
                v = r[F[field]]
                if isinstance(v, int):
                    worst = max(worst, v)
        check(f"the highest {field} index in any row resolves in index.json",
              worst < len(arr), f"{worst} vs {len(arr)} entries")


def test_determination_coverage(shards: list[dict]) -> None:
    """Every district answered, and every answer of a kind the readers know.

    Phase 3 turned 469 absent districts into an affirmative `outside`. Nothing
    asserted anything about it: not that every district has an answer, not that
    `outside` is even a permitted value, not that the copy in register/
    districts.json agrees with the source. A status the readers do not handle
    renders as a negative determination about a real place, which is the one
    output in this instrument that must never be wrong by accident.
    """
    print()
    print("scheduled area determinations")
    STATUSES = {"within", "partial", "outside", "not_determined"}
    legal = read_or_none("legal_reference.json") or {}
    dets = legal.get("determinations") or {}
    districts = read_or_none("districts.json") or {}
    districts = districts.get("districts", districts)

    check("every district carries a determination",
          set(districts) <= set(dets),
          f"{len(set(districts) - set(dets))} without one")
    bad = sorted({str(d.get("status")) for d in dets.values()} - STATUSES)
    check("every status is one the readers handle", not bad, str(bad))

    # A determination has to say what it rests on, or it is an assertion.
    unsourced = [k for k, d in dets.items() if not d.get("instrument")]
    check("every determination names its instrument", not unsourced,
          f"{len(unsourced)} without one")
    undated = [k for k, d in dets.items() if not d.get("lastReviewed")]
    check("every determination carries a review date", not undated,
          f"{len(undated)} without one")

    # An affirmative negative is the strongest claim here, so it must explain
    # itself: `outside` means PESA does not apply to a real place.
    mute = [k for k, d in dets.items()
            if d.get("status") == "outside" and not d.get("note")]
    check("every `outside` determination gives its ground", not mute,
          f"{len(mute)} state a negative with no reason")

    # The register index carries its own copy. Two copies that disagree are
    # worse than one, because each looks authoritative on its own page.
    reg = read_or_none("register/districts.json")
    rows = (reg.get("districts") if isinstance(reg, dict) else reg) or []
    if isinstance(rows, dict):
        rows = list(rows.values())
    mismatched = [r for r in rows
                  if str((dets.get(str(r.get("code"))) or {}).get("status",
                                                                  "unknown"))
                  != str(r.get("sa"))]
    check("the register index agrees with the determinations it copies",
          not mismatched,
          f"{len(mismatched)} differ, first {mismatched[:2]}")

    # Sub-division resolution may only ever RAISE a site. Nothing published
    # should let a reader lower one.
    lowered = [k for k, d in dets.items()
               if d.get("scheduledSubdistricts") and d.get("status") != "partial"]
    check("only a partial district carries resolved sub-divisions",
          not lowered, str(lowered[:3]))

    by = {}
    for d in dets.values():
        by[d.get("status")] = by.get(d.get("status"), 0) + 1
    print(f"  {', '.join(f'{k} {v}' for k, v in sorted(by.items()))}"
          f"  |  {sum(len(d.get('scheduledSubdistricts') or []) for d in dets.values())}"
          f" sub-districts resolved")


def test_freshness_contract() -> None:
    """freshness.json is imported statically by the site and read by the PDF.

    It had no contract at all: a missing file is a build error in Next, a
    missing or unparseable checked_at silently changes what every instrument
    page says about its own currency, and complete/sectors_unreachable decide
    whether a partial night is disclosed. All of that shipped on the strength
    of one producer that only runs with a network.
    """
    print()
    print("register freshness")
    f = read_or_none("freshness.json")
    check("freshness.json is published and is an object", isinstance(f, dict),
          type(f).__name__)
    if not isinstance(f, dict):
        return

    ts = f.get("checked_at")
    check("checked_at is present", ts is not None, str(f)[:70])
    if ts is not None:
        ok = False
        try:
            datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            ok = True
        except Exception:  # noqa: BLE001
            ok = False
        check("checked_at parses as a timestamp", ok, str(ts)[:40])
        # Parseable is not plausible. This line is the only statement on the
        # site about how current the register copy is, and it accepted a date
        # in the future or one arbitrarily old. A clock skew or a bad merge
        # would publish "read tomorrow" with the contract green.
        if ok:
            when = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            ahead = (when - now).total_seconds()
            behind = (now - when).total_seconds()
            check("checked_at is not in the future",
                  ahead <= FRESHNESS_SKEW_SECONDS,
                  f"{ts} is {ahead / 3600:.1f}h ahead of now")
            # Staleness is asserted only where a rebuild just happened.
            #
            # ci.yml runs this suite on every push to every branch, on a plain
            # checkout with no fetch cache, and freshness.json only moves when
            # the nightly sync rebuilds the data. Asserting age here would
            # turn every branch red thirty-one days after the last data
            # rebuild - for a reason the author of an unrelated change cannot
            # fix, and about a property their change does not touch. The sync
            # job sets INSTRUMENTS_ASSERT_FRESHNESS=1, because there a stale
            # read time means the run it just did was not recorded.
            if os.environ.get("INSTRUMENTS_ASSERT_FRESHNESS"):
                check("checked_at is recent enough to be a live reading",
                      behind <= FRESHNESS_MAX_AGE_SECONDS,
                      f"{ts} is {behind / 86400:.1f} days old; "
                      f"the sync runs nightly")

    check("complete is a boolean", isinstance(f.get("complete"), bool),
          repr(f.get("complete")))
    n = f.get("sectors_unreachable")
    check("sectors_unreachable is a count", isinstance(n, int) and n >= 0,
          repr(n))
    # A run that reached every sector cannot also report sectors it could not
    # reach; the two fields are written from the same observation.
    if isinstance(f.get("complete"), bool) and isinstance(n, int):
        check("complete and sectors_unreachable agree",
              (n == 0) if f["complete"] else True,
              f"complete={f['complete']} but {n} unreachable")

    meta = read_or_none("meta.json") or {}
    pub = (meta.get("counts") or {}).get("proposals_published")
    # REQUIRED, not conditional. Guarding this on `is not None` meant DELETING
    # the field removed the assertion instead of failing it - and this is the
    # only thing tying the currency statement in the footer to the register it
    # claims to describe. A freshness file with no count still renders "read
    # 21 September 2026", over a register from any other date.
    check("freshness names the register it read",
          isinstance(f.get("proposals_published"), int),
          f"proposals_published={f.get('proposals_published')!r}")
    check("the count it carries matches the published register",
          f.get("proposals_published") == pub,
          f"{f.get('proposals_published')} vs {pub}")
    print(f"  checked_at {f.get('checked_at')}  complete={f.get('complete')}")


def test_boundary_file() -> None:
    """The map's own geometry, which nothing else here can see.

    Every check above anchors on DATA, so `public/geo/districts-2011.geojson`
    is structurally outside the published-data contract - and it is the file
    that decides which ground each published number is painted on. A boundary
    file of the wrong vintage, or one whose ids do not line up with
    districts.json, colours the right numbers onto the wrong districts and
    every assertion in this suite still passes.

    Its own build asserts these too. They are repeated here because the build
    runs on a machine with the shapefile cache and this runs everywhere,
    including on the sync job after a rebuild.
    """
    geo_path = ROOT / "public" / "geo" / "districts-2011.geojson"
    check("boundary file exists", geo_path.exists(), str(geo_path))
    if not geo_path.exists():
        return
    geo = json.loads(geo_path.read_text(encoding="utf-8"))
    feats = geo.get("features") or []
    check("boundary file is a FeatureCollection with 640 districts",
          geo.get("type") == "FeatureCollection" and len(feats) == 640,
          f"type={geo.get('type')} n={len(feats)}")

    ids = sorted(f.get("id") for f in feats)
    check("boundary census codes are exactly 1..640",
          ids == list(range(1, 641)),
          f"missing={sorted(set(range(1, 641)) - set(ids))[:5]}")

    # THE JOIN. This is the whole reason the file is checked at all: the map
    # looks a district up by this id, and if the two disagree the page paints
    # one district's number onto another's outline.
    districts = read("districts.json")
    gaz = {int(k) for k in districts}
    check("every boundary district is in the gazetteer",
          gaz >= set(i for i in ids if i is not None),
          f"orphans={sorted(set(ids) - gaz)[:5]}")
    named = 0
    disagree = []
    for f in feats:
        rec = districts.get(str(f.get("id")))
        if not rec:
            continue
        a = (f.get("properties", {}).get("district") or "").strip().lower()
        b = (rec.get("district_name") or "").strip().lower()
        if a and b:
            named += 1
            if a != b:
                disagree.append(f"{f.get('id')}:{a}!={b}")
    # Spelling differs between the shapefile and the gazetteer on a minority of
    # names; a WRONG-VINTAGE file disagrees on hundreds. The bound catches that
    # without pinning every transliteration.
    check("boundary names agree with the gazetteer on the great majority",
          named > 0 and len(disagree) <= named * 0.10,
          f"{len(disagree)} of {named} disagree: {disagree[:4]}")

    def signed_area(ring) -> float:
        a = 0.0
        for i in range(len(ring) - 1):
            a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
        return a / 2

    ext_signs = []
    zero_ext = 0
    bad_holes = []
    zero_holes = 0
    lon_lo = lat_lo = 1e9
    lon_hi = lat_hi = -1e9
    for f in feats:
        g = f.get("geometry") or {}
        if g.get("type") not in ("Polygon", "MultiPolygon"):
            bad_holes.append(f"{f.get('id')}:{g.get('type')}")
            continue
        polys = (g["coordinates"] if g["type"] == "MultiPolygon"
                 else [g["coordinates"]])
        for poly in polys:
            outer = signed_area(poly[0])
            if outer == 0:
                zero_ext += 1
            ext_signs.append(1 if outer > 0 else -1 if outer < 0 else 0)
            for ring in poly[1:]:
                a = signed_area(ring)
                if a == 0:
                    zero_holes += 1
                elif (a > 0) == (outer > 0):
                    bad_holes.append(str(f.get("id")))
            for ring in poly:
                for x, y in ring:
                    lon_lo = min(lon_lo, x); lon_hi = max(lon_hi, x)
                    lat_lo = min(lat_lo, y); lat_hi = max(lat_hi, y)

    # d3-geo reads winding SPHERICALLY: a ring wound against the rest is
    # "everything on the globe except this", and renders as one path over the
    # entire map. One odd ring is enough.
    check("no exterior ring has zero area", zero_ext == 0, f"{zero_ext} rings")
    check("every exterior ring winds the same way",
          len(set(s for s in ext_signs if s != 0)) <= 1,
          f"signs={Counter(ext_signs)}")
    check("no interior ring has zero area", zero_holes == 0,
          f"{zero_holes} rings")
    check("every interior ring winds against its exterior",
          not bad_holes, f"{bad_holes[:5]}")

    # A wrong-vintage or wrong-projection file lands outside this envelope.
    check("boundary coordinates are lon/lat inside India's envelope",
          67.0 <= lon_lo <= 69.5 and 96.5 <= lon_hi <= 98.5
          and 6.0 <= lat_lo <= 8.5 and 34.5 <= lat_hi <= 37.5,
          f"lon {lon_lo:.2f}..{lon_hi:.2f} lat {lat_lo:.2f}..{lat_hi:.2f}")

    # THE JOIN ITSELF, tested against ground truth rather than against the
    # file's own internal agreement.
    #
    # Everything above checks that ids are present, unique and named - which
    # a file whose geometries have all been shifted by one still satisfies
    # perfectly. Rotating every outline onto its neighbour was demonstrated to
    # pass all ten preceding checks, and it is the exact failure that matters:
    # the map then paints each district's proposal count, literacy and
    # Scheduled Area outline onto the wrong ground, consistently, with nothing
    # anywhere disagreeing.
    #
    # These points are city centres whose coordinates are independently known
    # and are nowhere near a district boundary, so each pins one specific id to
    # one specific piece of ground. Kamrup Metropolitan (322) rather than
    # Kamrup (321) because Census 2011 split them and Guwahati is in the
    # metropolitan half - the kind of distinction a wrong-vintage file gets
    # wrong.
    #
    # TEN WAS NOT ENOUGH, AND THE GAP WAS DEMONSTRATED RATHER THAN ARGUED.
    #
    # The first version held ten, all metropolitan. A reviewer built a copy of
    # districts-2011.geojson in which every district except those ten took its
    # SAME-STATE neighbour's geometry - 627 of 640 outlines moved - and all
    # fourteen boundary assertions passed, including this one and the state
    # containment cross-check. Cross-state corruption is caught; within-state
    # rotation was not, and within-state is where a plausible corruption lands,
    # because the state check below buffers each state outward by ~11 km and
    # has no discriminating power inside one at all.
    #
    # So the table now covers 94 districts across every state and union
    # territory that has a city whose position is common knowledge. Each entry
    # was resolved by NAME against districts.json - a population table with no
    # geometry in it - and only then tested for containment, so the check is
    # not the geometry agreeing with itself.
    #
    # Two places are deliberately absent, and both are worth knowing about:
    #   Imphal sits on the Imphal West/East line, so the city centre is not a
    #   safe pin for either half; Imphal East is used, which both the shapefile
    #   and the served file agree on.
    #   SRINAGAR IS EXCLUDED BECAUSE THE SOURCE IS WRONG THERE. The city centre
    #   (74.7973, 34.0837) falls inside datameet's Baramula polygon in the
    #   served file AND in 2011_Dist.shp itself, so this is not a fault
    #   introduced here - it is the source's Jammu & Kashmir geometry, the same
    #   region it carries 98,700 km2 of under "Data Not Available". Geometric
    #   verdicts in that state are correspondingly weak, which is why the
    #   `unmapped` verdict exists and why no landmark is placed there.
    LANDMARKS = [
        (21, "Jammu", 74.857, 32.7266),
        (33, "Shimla", 77.1734, 31.1048),
        (37, "Jalandhar", 75.5762, 31.326),
        (41, "Ludhiana", 75.8573, 30.901),
        (49, "Amritsar", 74.8723, 31.634),
        (55, "Chandigarh", 76.7794, 30.7333),
        (60, "Dehradun", 78.0322, 30.3165),
        (66, "Haldwani", 79.513, 29.2183),
        (74, "Karnal", 76.9905, 29.6857),
        (80, "Hisar", 75.7217, 29.1492),
        (86, "Gurgaon", 77.0266, 28.4595),
        (88, "Faridabad", 77.3178, 28.4089),
        (101, "Bikaner", 73.3119, 28.0229),
        (113, "Jodhpur", 73.0243, 26.2389),
        (119, "Ajmer", 74.6399, 26.4499),
        (127, "Kota", 75.8648, 25.2138),
        (130, "Udaipur", 73.7125, 24.5854),
        (138, "Meerut", 77.7064, 28.9845),
        (146, "Agra", 78.0081, 27.1767),
        (150, "Bareilly", 79.4304, 28.367),
        (164, "Kanpur", 80.3319, 26.4499),
        (166, "Jhansi", 78.5685, 25.4484),
        (175, "Allahabad", 81.8463, 25.4358),
        (188, "Gorakhpur", 83.3732, 26.7606),
        (197, "Varanasi", 82.9739, 25.3176),
        (215, "Darbhanga", 85.9, 26.1542),
        (216, "Muzaffarpur", 85.391, 26.1209),
        (224, "Bhagalpur", 86.9842, 25.2425),
        (230, "Patna", 85.1376, 25.5941),
        (244, "Gangtok", 88.6065, 27.3389),
        (248, "Itanagar", 93.6053, 27.0844),
        (270, "Kohima", 94.1086, 25.6751),
        (278, "Imphal", 93.9368, 24.817),
        (283, "Aizawl", 92.7176, 23.7271),
        (289, "Agartala", 91.2868, 23.8315),
        (298, "Shillong", 91.8933, 25.5788),
        (310, "Dibrugarh", 94.912, 27.4728),
        (312, "Jorhat", 94.2037, 26.7509),
        (316, "Silchar", 92.7789, 24.8333),
        (327, "Siliguri", 88.3953, 26.7271),
        (335, "Asansol", 86.9524, 23.6739),
        (341, "Howrah", 88.2636, 22.5958),
        (354, "Dhanbad", 86.4304, 23.7957),
        (357, "Jamshedpur", 86.2029, 22.8046),
        (364, "Ranchi", 85.3096, 23.3441),
        (374, "Rourkela", 84.8536, 22.2604),
        (381, "Cuttack", 85.883, 20.4625),
        (386, "Bhubaneswar", 85.8245, 20.2961),
        (388, "Berhampur", 84.7941, 19.315),
        (406, "Bilaspur(CG)", 82.1409, 22.0797),
        (409, "Durg", 81.3509, 21.1938),
        (410, "Raipur", 81.6296, 21.2514),
        (421, "Gwalior", 78.1828, 26.2183),
        (427, "Sagar", 78.7378, 23.8388),
        (435, "Ujjain", 75.7885, 23.1793),
        (439, "Indore", 75.8577, 22.7196),
        (444, "Bhopal", 77.4126, 23.2599),
        (451, "Jabalpur", 79.9864, 23.1815),
        (476, "Rajkot", 70.8022, 22.3039),
        (486, "Vadodara", 73.1812, 22.3072),
        (492, "Surat", 72.8311, 21.1702),
        (505, "Nagpur", 79.0882, 21.1458),
        (515, "Aurangabad(MH)", 75.3433, 19.8762),
        (516, "Nashik", 73.7898, 19.9975),
        (521, "Pune", 73.8567, 18.5204),
        (526, "Solapur", 75.9064, 17.6599),
        (530, "Kolhapur", 74.2433, 16.705),
        (533, "Nizamabad", 78.0941, 18.6725),
        (534, "Karimnagar", 79.1288, 18.4386),
        (540, "Warangal", 79.5941, 17.9689),
        (544, "Visakhapatnam", 83.2185, 17.6868),
        (547, "Vijayawada", 80.648, 16.5062),
        (548, "Guntur", 80.4365, 16.3067),
        (552, "Kurnool", 78.0373, 15.8281),
        (553, "Anantapur", 77.6006, 14.6819),
        (554, "Tirupati", 79.4192, 13.6288),
        (555, "Belgaum", 74.4977, 15.8497),
        (562, "Hubli", 75.124, 15.3647),
        (571, "Tumkur", 77.101, 13.3392),
        (575, "Mangalore", 74.856, 12.9141),
        (577, "Mysore", 76.6394, 12.2958),
        (585, "Panaji", 73.8278, 15.4909),
        (591, "Kozhikode", 75.7804, 11.2588),
        (594, "Thrissur", 76.2144, 10.5276),
        (595, "Kochi", 76.2673, 9.9312),
        (600, "Kollam", 76.6141, 8.8932),
        (601, "Thiruvananthapuram", 76.9366, 8.5241),
        (605, "Vellore", 79.1325, 12.9165),
        (608, "Salem", 78.146, 11.6643),
        (614, "Tiruchirappalli", 78.7047, 10.7905),
        (623, "Madurai", 78.1198, 9.9252),
        (628, "Tirunelveli", 77.7567, 8.7139),
        (632, "Coimbatore", 76.9558, 11.0168),
        (635, "Puducherry", 79.8083, 11.9416),
    ]

    def point_in_ring(x, y, ring) -> bool:
        inside = False
        n = len(ring)
        for i in range(n - 1):
            x1, y1 = ring[i][0], ring[i][1]
            x2, y2 = ring[i + 1][0], ring[i + 1][1]
            if (y1 > y) != (y2 > y):
                xin = (x2 - x1) * (y - y1) / (y2 - y1) + x1
                if x < xin:
                    inside = not inside
        return inside

    def contains(feature, x, y) -> bool:
        g = feature.get("geometry") or {}
        polys = (g["coordinates"] if g.get("type") == "MultiPolygon"
                 else [g.get("coordinates") or []])
        for poly in polys:
            if not poly:
                continue
            if point_in_ring(x, y, poly[0]):
                # Subtract holes, so a point in a lake is not "in" the district.
                if not any(point_in_ring(x, y, r) for r in poly[1:]):
                    return True
        return False

    by_id = {f.get("id"): f for f in feats}
    misplaced = []
    for code, name, x, y in LANDMARKS:
        f = by_id.get(code)
        if f is None or not contains(f, x, y):
            landed = [c for c, ff in by_id.items() if contains(ff, x, y)]
            misplaced.append(f"{name}({code})->{landed[:1] or 'nowhere'}")
    check("known places fall inside the district they belong to",
          not misplaced,
          f"{len(misplaced)} of {len(LANDMARKS)} misplaced: {misplaced[:4]}")


def test_measure_ranges_declared() -> None:
    """Every bounded measure must DECLARE its bound.

    `test_measures` performs its value-plausibility check as
    `if spec.get("range")`, so a measure with no range skips it silently.
    Deleting one line from measures.py therefore turns off the only guard
    against a literacy rate of 4000%, and the contract still prints ok.

    Percent and ratio measures are bounded by construction and must say so.
    Counts genuinely are not - a district's population has no upper bound this
    code should assert - so they are checked for sign instead.
    """
    registry = read("measures.json")
    registry = registry.get("measures", registry)
    missing = sorted(k for k, spec in registry.items()
                     if spec.get("unit") in ("percent", "ratio")
                     and not spec.get("range"))
    check("every percent and ratio measure declares a plausible range",
          not missing, f"no range on: {missing}")

    counts = sorted(k for k, spec in registry.items()
                    if spec.get("unit") == "count")
    districts = read("districts.json")
    negative = []
    for code, rec in districts.items():
        for k in counts:
            v = (rec.get("values") or {}).get(k)
            if isinstance(v, (int, float)) and v < 0:
                negative.append(f"{code}:{k}={v}")
    check("no count measure is negative", not negative, f"{negative[:4]}")


# Sub-district plausibility bands, where the DISTRICT band is the wrong shape.
#
# measures.py describes districts and its ranges are calibrated for them. A
# sub-district is a far smaller population and regresses to the mean much
# less, so a band that is right for 640 districts rejects genuine values at
# 5,900 sub-districts: Kibithoo in Arunachal has 1,455 people and a sex ratio
# of 395 (a border garrison), Bhikiasain in Uttarakhand has 1,307 (male
# out-migration). Both are real Census figures.
#
# Widened deliberately and only where the reason is understood. Percentages
# are bounded by arithmetic at [0, 100] and are NOT relaxed here.
# Only sex ratio needs one. Measured over all 5,900 published sub-districts,
# child share peaks at 26.08 against a district band of 40 and household size
# at 8.58 against 12, so widening those two loosened the only plausibility
# gate on them and bought nothing - a later build could then publish a 55%
# child share unchallenged. A band is widened here only where a real value
# sits outside the district one, and the reason is named.
SUBDISTRICT_RANGES = {
    # Kibithoo, 1,455 people, a border garrison: 395. Bhikiasain in
    # Uttarakhand, heavy male out-migration: 1,306.9. Both are real Census
    # figures that the district band [500, 1300] would reject.
    "pop.sex_ratio": (300.0, 1500.0),
}


def test_subdistricts() -> None:
    """The sub-district table, which had no contract at all.

    ProjectProfile fetches this file and its District/Sub-district toggle
    renders these values through the same measure registry as the district
    figures, so a reader comparing the two was comparing a checked number
    against an unchecked one.
    """
    subs = read_or_none("subdistricts.json")
    check("subdistricts.json is published", subs is not None)
    if subs is None:
        return
    rows = subs if isinstance(subs, list) else list(subs.values())
    check("subdistricts.json holds records", len(rows) > 1000, f"{len(rows)} rows")

    districts = read("districts.json")
    registry = read("measures.json")
    registry = registry.get("measures", registry)

    shapeless = [r for r in rows
                 if not all(k in r for k in ("code", "name", "district", "values"))]
    check("every sub-district record carries code, name, district and values",
          not shapeless, f"{len(shapeless)} malformed")

    orphans = sorted({str(r.get("district")) for r in rows
                      if str(r.get("district")) not in districts})
    check("every sub-district resolves to a published district",
          not orphans, f"{len(orphans)} unknown parents: {orphans[:5]}")

    unknown_keys = set()
    out_of_range = []
    for r in rows:
        for k, v in (r.get("values") or {}).items():
            spec = registry.get(k)
            if spec is None:
                unknown_keys.add(k)
                continue
            if v is None or not isinstance(v, (int, float)):
                continue
            band = SUBDISTRICT_RANGES.get(k) or tuple(spec.get("range") or ())
            if len(band) != 2:
                continue
            lo, hi = band
            if not (lo <= v <= hi):
                out_of_range.append(f"{r.get('name')}:{k}={v} not in [{lo},{hi}]")
    check("every sub-district measure is in the published registry",
          not unknown_keys, f"unknown: {sorted(unknown_keys)[:5]}")
    negative_counts = []
    for r in rows:
        for k, v in (r.get("values") or {}).items():
            spec = registry.get(k) or {}
            if spec.get("unit") == "count" and isinstance(v, (int, float)) and v < 0:
                negative_counts.append(f"{r.get('name')}:{k}={v}")
    check("no sub-district count measure is negative",
          not negative_counts, f"{negative_counts[:4]}")

    check("every sub-district value is within its plausible range",
          not out_of_range,
          f"{len(out_of_range)} outside: {out_of_range[:4]}")

    # IS IT A PLACE AT ALL, AND IS IT THE READER'S PLACE?
    #
    # Everything above checks a record's shape and the plausibility of its
    # numbers. None of it could tell that the record a proposal resolves to
    # describes somewhere else entirely, which is what SHRUG's "this district
    # has no sub-district" sentinel did: code 99999 is shared by 29 districts,
    # the publishing loop kept one record for it, and 1,855 proposals - 1,723
    # in Mumbai Suburban - then pointed at a record carrying Chennai's
    # population and literacy. Every assertion above passed on it: the shape
    # was right, Chennai is a published district, the measures were registry
    # keys and every value was in range. It was a real record of the wrong
    # place.
    CENSUS_SUBDISTRICT_MAX = 5924
    bad_code = [r.get("code") for r in rows
                if not isinstance(r.get("code"), int)
                or not (1 <= r["code"] <= CENSUS_SUBDISTRICT_MAX)]
    check("every published sub-district code is a Census 2011 code",
          not bad_code,
          f"{len(bad_code)} outside 1..{CENSUS_SUBDISTRICT_MAX}: {bad_code[:5]}")

    # The sentinel's only visible tell in the published file was an empty
    # name, because it names nothing.
    #
    # Not every record can be named, and pretending otherwise would be its own
    # false claim: 47 sub-districts are wholly urban - 13 in Hyderabad, 3 in
    # each Delhi district - and the name source is village-level, so they have
    # no entry in it. They are also unreachable: a proposal resolves through a
    # village code, and these have no villages, so no reader can open one. The
    # assertion that matters is therefore made where reachability is known,
    # in test_subdistrict_references_resolve. What is pinned here is that the
    # unnamed set stays SMALL - a sentinel-shaped bug would push it up, and a
    # naming source that silently stopped loading would push it to thousands.
    nameless = [r.get("code") for r in rows if not (r.get("name") or "").strip()]
    check("almost every published sub-district is named",
          len(nameless) <= 60,
          f"{len(nameless)} unnamed of {len(rows)}: {nameless[:5]}")

    dupes = [c for c, n in Counter(r.get("code") for r in rows).items() if n > 1]
    check("no sub-district code is published twice",
          not dupes, f"{dupes[:5]}")

    # A tehsil that straddles a district boundary is published once and lies
    # in more than one district; `districts` must agree with `district`.
    disagree = [r.get("code") for r in rows
                if r.get("districts") and r.get("district") not in r["districts"]]
    check("a sub-district's primary parent is one of its parents",
          not disagree, f"{disagree[:5]}")

    # A sub-district cannot hold more people than the district it is in.
    # Summed over all parents, because a straddling tehsil's population is
    # spread across them.
    KEY = "pop.total"
    too_big = []
    for r in rows:
        v = (r.get("values") or {}).get(KEY)
        parents = r.get("districts") or (
            [r["district"]] if r.get("district") is not None else [])
        cap = 0.0
        for dt in parents:
            drow = districts.get(str(dt)) or {}
            cap += ((drow.get("values") or {}).get(KEY) or 0)
        if isinstance(v, (int, float)) and cap and v > cap:
            too_big.append(f"{r.get('name')} {v:,.0f} > {cap:,.0f}")
    check("no sub-district holds more people than its district(s)",
          not too_big, f"{len(too_big)}: {too_big[:3]}")


def test_subdistrict_references_resolve(shards: list) -> None:
    """A proposal's `sd` must name a real place, and it must be ITS place.

    This is the assertion that would have caught the sentinel on the day it
    was published. A Mumbai Suburban proposal carried `sd: [99999]`, the
    published record for 99999 sat in Chennai, and the profile page rendered
    Chennai's population under a sentence promising the reader "a far closer
    description of who a project actually affects".
    """
    subs = read_or_none("subdistricts.json")
    if subs is None:
        return
    by_code = {}
    for r in (subs if isinstance(subs, list) else subs.values()):
        by_code[r.get("code")] = r

    dangling = set()
    mismatched = []
    reachable: set = set()
    checked = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "sd" not in F:
            continue
        for row in sh["rows"]:
            codes = row[F["sd"]]
            if not codes:
                continue
            named = set()
            if "dc" in F and row[F["dc"]]:
                named.add(row[F["dc"]])
            if "dall" in F and isinstance(row[F["dall"]], list):
                named.update(c for c in row[F["dall"]] if c)
            for code in codes:
                checked += 1
                reachable.add(code)
                rec = by_code.get(code)
                if rec is None:
                    dangling.add(code)
                    continue
                parents = set(rec.get("districts") or (
                    [rec["district"]] if rec.get("district") is not None else []))
                if named and parents and not (parents & named):
                    mismatched.append(
                        f"{row[F['id']]}: sd {code} is in {sorted(parents)}, "
                        f"proposal names {sorted(named)}")

    check("every sub-district a proposal names is published",
          not dangling, f"{len(dangling)} dangling: {sorted(dangling)[:5]}")
    # A record a reader CAN open must name a place. The profile page falls
    # back to the district name when the sub-district has none, which would
    # print a district's name under a heading promising something finer.
    unnamed_reachable = sorted(
        code for code in {c for c in by_code if c in reachable}
        if not ((by_code[code].get("name") or "").strip()))
    check("no proposal can reach an unnamed sub-district",
          not unnamed_reachable,
          f"{len(unnamed_reachable)}: {unnamed_reachable[:5]}")
    check("a proposal's sub-district lies in a district that proposal names",
          not mismatched,
          f"{len(mismatched)} mismatched, first: {mismatched[:2]}")
    print(f"  checked {checked:,} sub-district references")


def test_facets(shards: list) -> None:
    """The register page's headline stats, recomputed rather than trusted.

    Three of the four numbers above the register's map come from this file and
    nothing asserted any of them: the page could have stated "12 proposals
    placed in a district" over a table listing 89,361.
    """
    facets = read_or_none("register", "facets.json")
    check("register/facets.json is published", facets is not None)
    if facets is None:
        return
    t = facets.get("totals") or {}
    rows = read("register", "districts.json")
    districts = read("districts.json")

    total_rows = sum(len(s["rows"]) for s in shards)
    check("facets: proposals matches the shards",
          t.get("proposals") == total_rows,
          f"{t.get('proposals')} vs {total_rows}")
    check("facets: districts_total matches the gazetteer",
          t.get("districts_total") == len(districts),
          f"{t.get('districts_total')} vs {len(districts)}")
    with_rows = sum(1 for r in rows if r.get("n"))
    check("facets: districts_with_proposals matches the register index",
          t.get("districts_with_proposals") == with_rows,
          f"{t.get('districts_with_proposals')} vs {with_rows}")
    disp = sum(r.get("displaced") or 0 for r in rows)
    check("facets: declared_displaced_families is the sum of the index",
          t.get("declared_displaced_families") == disp,
          f"{t.get('declared_displaced_families')} vs {disp}")
    aff = sum(r.get("affected") or 0 for r in rows)
    check("facets: declared_affected_families is the sum of the index",
          t.get("declared_affected_families") == aff,
          f"{t.get('declared_affected_families')} vs {aff}")

    legal = read_or_none("legal_reference.json") or {}
    det = {int(k): (v or {}).get("status")
           for k, v in (legal.get("determinations") or {}).items()}
    wholly = sum(r["n"] for r in rows if det.get(r["code"]) == "within")
    partly = sum(r["n"] for r in rows if det.get(r["code"]) == "partial")
    check("facets: proposals_in_scheduled_districts is wholly plus partly",
          t.get("proposals_in_scheduled_districts") == wholly + partly,
          f"{t.get('proposals_in_scheduled_districts')} vs {wholly + partly}")


def test_lookup(shards: list) -> None:
    """The id-to-shard map every deep link resolves through.

    A pasted /instruments/consent/<id> URL with no ?state= consults this file
    to decide which shard to fetch, so a missing or wrong entry is a proposal
    that cannot be opened by link at all. Nothing asserted it.
    """
    lookup = read_or_none("lookup.json")
    check("lookup.json is published", lookup is not None)
    if lookup is None:
        return
    by_id = {}
    for s in shards:
        i = s["fields"].index("id")
        for r in s["rows"]:
            by_id[str(r[i])] = s["slug"]
    check("lookup covers every published proposal",
          len(lookup) == len(by_id),
          f"lookup {len(lookup):,} vs shards {len(by_id):,}")
    missing = [k for k in by_id if k not in lookup]
    wrong = [k for k, v in lookup.items() if by_id.get(k) != v]
    check("every proposal has a lookup entry", not missing,
          f"{len(missing)} missing, e.g. {missing[:3]}")
    check("every lookup entry names the shard that holds the proposal",
          not wrong, f"{len(wrong)} wrong, e.g. {wrong[:3]}")


def test_index_counts(shards: list) -> None:
    """The state picker's counts, against the shards they describe."""
    idx = read("index.json")
    states = idx.get("states") or {}
    by_slug = {s["slug"]: s for s in shards}
    bad_total, bad_resolved = [], []
    for slug, meta in states.items():
        shard = by_slug.get(slug)
        if shard is None:
            bad_total.append(f"{slug}: no shard")
            continue
        if meta.get("total") != len(shard["rows"]):
            bad_total.append(f"{slug}: {meta.get('total')} vs {len(shard['rows'])}")
        dc = shard["fields"].index("dc")
        dall = shard["fields"].index("dall")
        resolved = sum(1 for r in shard["rows"]
                       if r[dc] is not None or (r[dall] or []))
        if meta.get("resolved") != resolved:
            bad_resolved.append(f"{slug}: {meta.get('resolved')} vs {resolved}")
    check("index.json's per-state totals match the shards",
          not bad_total, f"{bad_total[:3]}")
    check("index.json's per-state resolved counts match the shards",
          not bad_resolved, f"{bad_resolved[:3]}")
    check("index.json names every shard",
          set(states) == set(by_slug),
          f"only in index: {sorted(set(states) - set(by_slug))[:3]}; "
          f"only in shards: {sorted(set(by_slug) - set(states))[:3]}")


def test_register_rows_agree_with_gazetteer() -> None:
    """register/districts.json copies census columns; they must still match.

    The register explorer filters on these copies ("ST share above X"), so
    drift between them and districts.json shows as a filter selecting the
    wrong districts, with both files internally consistent.
    """
    rows = read("register", "districts.json")
    districts = read("districts.json")
    pairs = [("pop", "pop.total"), ("st", "pop.st_share"), ("sc", "pop.sc_share"),
             ("lit", "pop.literacy_rate"), ("landDep", "work.land_dependent_share")]
    drift = []
    for r in rows:
        rec = districts.get(str(r["code"]))
        if not rec:
            drift.append(f"{r['code']}: not in gazetteer")
            continue
        for short, key in pairs:
            a, b = r.get(short), (rec.get("values") or {}).get(key)
            if a is None and b is None:
                continue
            if a is None or b is None or abs(float(a) - float(b)) > 0.011:
                drift.append(f"{r['code']}.{short}: {a} vs {b}")
    check("the register index's census columns match the gazetteer",
          not drift, f"{len(drift)} disagree: {drift[:4]}")


# Census 2011 state names against the names the independent state layer uses,
# where they differ or where a 2011 state has since been split. The union is
# the right comparison: the district file is 2011 vintage and the state layer
# is current, so J&K's 2011 districts legitimately fall in today's J&K OR
# Ladakh, and Andhra Pradesh's in today's Andhra Pradesh OR Telangana.
STATE_LAYER_ALIASES = {
    "Andaman & Nicobar Island": ["Andaman and Nicobar Islands"],
    "Arunanchal Pradesh": ["Arunachal Pradesh"],
    "Dadara & Nagar Havelli": ["Dadra and Nagar Haveli and Daman and Diu"],
    "Daman & Diu": ["Dadra and Nagar Haveli and Daman and Diu"],
    "Jammu & Kashmir": ["Jammu and Kashmir", "Ladakh"],
    "NCT of Delhi": ["Delhi"],
    "Andhra Pradesh": ["Andhra Pradesh", "Telangana"],
    "Telangana": ["Telangana", "Andhra Pradesh"],
}

# Districts the two files genuinely disagree about, with the reason.
# Lakshadweep is a scatter of very small islands and the two sources draw
# them at different precisions, so its representative point lands just off
# the state layer's outline. Nothing else is exempt.
STATE_CONTAINMENT_EXEMPT = {587: "Lakshadweep: sub-degree islands, two vintages"}

# The state layer is a different source at a different simplification, so the
# two outlines do not agree to the metre along a shared border.
STATE_CONTAINMENT_TOLERANCE_DEG = 0.1


def _load_state_polygons(path):
    """The `states` layer of the topojson, decoded, keyed by name."""
    import json as _json
    raw = _json.loads(path.read_text(encoding="utf-8"))
    tr = raw.get("transform")

    def decode(arc):
        if not tr:
            return [(p[0], p[1]) for p in arc]
        sx, sy = tr["scale"]
        tx, ty = tr["translate"]
        x = y = 0
        out = []
        for dx, dy in arc:
            x += dx
            y += dy
            out.append((x * sx + tx, y * sy + ty))
        return out

    arcs = [decode(a) for a in raw["arcs"]]

    def ring(idxs):
        pts = []
        for i in idxs:
            seg = arcs[~i][::-1] if i < 0 else arcs[i]
            pts.extend(seg if not pts else seg[1:])
        return pts

    from shapely.geometry import shape as _shape
    out = {}
    for g in raw["objects"]["states"]["geometries"]:
        if g["type"] == "Polygon":
            geom = {"type": "Polygon", "coordinates": [ring(r) for r in g["arcs"]]}
        elif g["type"] == "MultiPolygon":
            geom = {"type": "MultiPolygon",
                    "coordinates": [[ring(r) for r in p] for p in g["arcs"]]}
        else:
            continue
        s = _shape(geom)
        out[g["properties"]["st_nm"]] = s if s.is_valid else s.buffer(0)
    return out


def test_boundary_sits_in_its_state() -> None:
    """Every district's polygon must lie in the state it is filed under.

    The landmark check above pins ten metropolitan districts to ten known
    points, which proves the file is not globally rotated but leaves most of
    the country free: rotating the districts of four adjacent states onto each
    other passed every other assertion here, because ids, names, winding,
    envelope and count all stay perfect under any permutation of the
    geometries.

    This closes it with an INDEPENDENT source. `india-states.topojson`'s
    `states` layer is a different file from a different vintage - its district
    layer is unusable for this instrument (102 post-2011 features, non-unique
    codes) but the engineering reference records that its state layer is correct - so asking
    whether each district's polygon falls inside the state the gazetteer
    assigns it is a genuine cross-check rather than the file agreeing with
    itself. Measured: a shift-by-one displaces 578 districts, a four-state
    rotation 5, a two-district swap 3.
    """
    layer_path = ROOT / "public" / "geo" / "india-states.topojson"
    geo_path = ROOT / "public" / "geo" / "districts-2011.geojson"
    if not layer_path.exists() or not geo_path.exists():
        check("the state layer and the boundary file are both present",
              False, f"{layer_path.name} / {geo_path.name}")
        return
    try:
        from shapely.geometry import shape
        from shapely.ops import unary_union
    except ImportError:
        check("shapely is available for the state-containment check", False,
              "pip install -r requirements.txt")
        return

    states = _load_state_polygons(layer_path)
    fc = json.loads(geo_path.read_text(encoding="utf-8"))
    districts = read("districts.json")

    unmatched = sorted({
        rec["state_name"] for rec in districts.values()
        if not [n for n in STATE_LAYER_ALIASES.get(rec["state_name"],
                                                   [rec["state_name"]])
                if n in states]
    })
    check("every gazetteer state resolves to a polygon in the state layer",
          not unmatched, f"unresolved: {unmatched[:4]}")

    cache: dict = {}
    outside = []
    for f in fc.get("features") or []:
        rec = districts.get(str(f.get("id")))
        if not rec:
            continue
        if f.get("id") in STATE_CONTAINMENT_EXEMPT:
            continue
        name = rec["state_name"]
        if name not in cache:
            parts = [states[n] for n in STATE_LAYER_ALIASES.get(name, [name])
                     if n in states]
            cache[name] = (unary_union(parts)
                           .buffer(STATE_CONTAINMENT_TOLERANCE_DEG)
                           if parts else None)
        poly = cache[name]
        if poly is None:
            continue
        g = shape(f["geometry"])
        if not poly.contains(g.representative_point()):
            outside.append(f"{f.get('id')} {rec['district_name']}, {name}")

    check("every district's outline sits inside the state it is filed under",
          not outside,
          f"{len(outside)} elsewhere: {outside[:4]}")

    # GEOMETRIC VALIDITY, bounded rather than absolute.
    #
    # Nothing here asserted that a published polygon is well-formed. Three are
    # not: Bharuch, North 24 Parganas and South 24 Parganas each carry a
    # self-intersection where simplification pinched an estuary. Repairing
    # them changes their area by under 1e-8 square degrees - a few square
    # metres on districts of ~5,000 km2 - so they draw correctly and the
    # verdicts are unaffected (those are computed from the full shapefile in
    # geometry.py, never from this file).
    #
    # Asserting strict validity would fail on those three for no benefit.
    # Asserting that a repair cannot MOVE anything catches the case that would
    # matter: a bow-tie or a folded ring, where the filled area and the
    # intended area differ visibly.
    repaired = []
    for f in (fc.get("features") or []):
        try:
            g = shape(f.get("geometry") or {})
        except Exception:  # noqa: BLE001
            repaired.append(f"{f.get('id')}: unreadable geometry")
            continue
        if g.is_valid:
            continue
        fixed = g.buffer(0)
        moved = abs(fixed.area - g.area)
        if g.area <= 0 or moved / g.area > 1e-4:
            repaired.append(f"{f.get('id')}: repair moves "
                            f"{100 * moved / max(g.area, 1e-12):.3f}% of its area")
    check("no published outline is malformed enough to draw wrongly",
          not repaired, f"{len(repaired)}: {repaired[:3]}")


def test_vocabulary_is_anchored(shards: list) -> None:
    """The raw status string and the canonical key must describe each other.

    Shards store `sector` and `status` as INDEXES into arrays published in
    index.json, and carry the canonical stage separately in `sk`. Every check
    before this one validated those indexes only for range - "is it a valid
    position" - which is true of any permutation. So three different silent
    corruptions all passed:

      - swapping `sk` between tor_granted and tor_rejected on 10,295 rows
        while leaving the raw status text alone,
      - shifting every row's `sector` index by one, publishing every proposal
        under its neighbour's sector,
      - rotating index.json's `statuses` array and every shard's copy of it
        together, so each row's integer resolves to a different label.

    `stages.json` publishes, for each canonical key, the source spellings it
    stands for. That makes the two halves checkable against each other: the
    raw string a row carries must normalise to a spelling belonging to that
    row's `sk`. A permutation of either side breaks the correspondence.
    """
    stages = read_or_none("stages.json") or {}
    statuses = stages.get("statuses") or {}
    check("stages.json publishes the source spellings behind each key",
          bool(statuses) and any(v.get("raw") for v in statuses.values()),
          f"{len(statuses)} keys")
    if not statuses:
        return

    def norm(v) -> str:
        return " ".join(str(v or "").split()).lower()

    spelling_to_key = {}
    for key, spec in statuses.items():
        for raw in spec.get("raw") or []:
            spelling_to_key[norm(raw)] = key

    mismatched = []
    unknown_spelling = []
    unknown_key = []
    checked = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "sk" not in F or "status" not in F:
            continue
        vocab = sh.get("statuses") or []
        for r in sh["rows"]:
            sk = r[F["sk"]]
            idx = r[F["status"]]
            raw = vocab[idx] if isinstance(idx, int) and 0 <= idx < len(vocab) else None
            if raw is None:
                continue
            checked += 1
            if sk not in statuses and sk != "unclassified":
                unknown_key.append(f"{sh['slug']}:{sk}")
                continue
            expected = spelling_to_key.get(norm(raw))
            if expected is None:
                unknown_spelling.append(f"{sh['slug']}:{raw!r}")
            elif sk != expected:
                mismatched.append(f"{sh['slug']}: {raw!r} carries sk={sk}, "
                                  f"the registry says {expected}")

    check("every row's canonical stage is one the registry publishes",
          not unknown_key, f"{len(unknown_key)} unknown: {unknown_key[:3]}")
    check("every raw status spelling is one the registry accounts for",
          not unknown_spelling,
          f"{len(unknown_spelling)} unaccounted: {unknown_spelling[:3]}")
    check("every row's raw status text agrees with its canonical stage",
          not mismatched,
          f"{len(mismatched)} of {checked:,} disagree: {mismatched[:3]}")


def test_sector_vocabulary_is_stable(shards: list) -> None:
    """A shard's sector array must be the one index.json publishes.

    Sector has no canonical key to check against, so the anchor is that every
    shard and the index agree on the ARRAY - positions included. Re-sorting or
    rotating it silently re-labels every row that follows the moved entry, and
    The engineering reference records that this already happened once: 52 of 58 positions
    moved for one new spelling and rewrote every row in all 35 shards.
    """
    idx = read("index.json")
    published = idx.get("sectors")
    check("index.json publishes the sector vocabulary",
          isinstance(published, list) and bool(published),
          repr(published)[:60])
    if not isinstance(published, list):
        return

    drift = []
    for sh in shards:
        own = sh.get("sectors") or []
        if own != published[:len(own)]:
            first = next((i for i, (a, b) in enumerate(zip(own, published))
                          if a != b), min(len(own), len(published)))
            drift.append(f"{sh['slug']} diverges at position {first}")
    check("every shard's sector vocabulary matches index.json, position for "
          "position", not drift, f"{drift[:3]}")

    out_of_range = []
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        n = len(sh.get("sectors") or [])
        for r in sh["rows"]:
            v = r[F["sector"]]
            if not isinstance(v, int) or not (0 <= v < n):
                out_of_range.append(f"{sh['slug']}:{v}")
                break
    check("every row's sector index addresses a published sector",
          not out_of_range, f"{out_of_range[:3]}")


def test_site_verdicts_recompute(shards: list) -> None:
    """meta's geometric verdicts, against the rows they summarise.

    `corroboration_pct` is the instrument's headline geometric finding - how
    often the coordinates a proponent filed fall in a district that proposal
    names - and the whole of `verdicts` was published without anything tying
    it to the shards. Folding boundary, offshore and elsewhere into `inside`,
    or hard-coding the percentage to 100.0, passed every other assertion here.
    """
    meta = read_or_none("meta.json") or {}
    sg = meta.get("site_geometry") or {}
    stated = sg.get("verdicts")
    check("meta states the geometric verdicts", isinstance(stated, dict),
          repr(stated)[:60])
    if not isinstance(stated, dict):
        return

    counted: dict = {}
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "gk" not in F:
            continue
        for r in sh["rows"]:
            v = r[F["gk"]]
            if v is not None:
                counted[v] = counted.get(v, 0) + 1

    check("every published verdict tally matches the rows",
          {k: v for k, v in stated.items() if v} ==
          {k: v for k, v in counted.items() if v},
          f"meta {sorted(stated.items())} vs shards {sorted(counted.items())}")

    # The headline percentage, recomputed from the published rows.
    #
    # The definition is the build's own and is deliberate: `boundary` is the
    # case the mapped line cannot decide, and `offshore` describes a site the
    # land-only boundary file cannot contain - neither is a disagreement, so
    # both are excluded from BOTH sides rather than charged against
    # corroboration. What makes this a check rather than an echo is the
    # source: these tallies come from the published shard rows, not from the
    # build's own in-memory counters.
    inside = counted.get("inside", 0)
    against = counted.get("elsewhere", 0)
    decidable = inside + against
    pct = round(100 * inside / decidable, 2) if decidable else None
    published = sg.get("corroboration_pct")
    check("the corroboration rate recomputes from the rows",
          pct is not None and isinstance(published, (int, float))
          and abs(published - pct) <= 0.01,
          f"meta says {published}, the shards give {pct}")


def test_register_counts_trace_to_the_shards(shards: list) -> None:
    """Each district row's counts, rebuilt from the proposals themselves.

    `test_register_rows_agree_with_gazetteer` covers the census columns this
    file copies. The COUNTS - proposals, Category A, filings declaring a land
    area, families displaced and affected - had nothing behind them: the
    register explorer filters and sorts on them, and multiplying every shard
    `af`/`df` by a thousand left the index and the shards three orders of
    magnitude apart with the contract green.

    The two bases are different on purpose, and both are rebuilt here:

      n, nA         every district a proposal NAMES, so a project spanning
                    four districts is counted in all four.
      declaringLand,
      displaced,
      affected      the PRIMARY district only. A multi-district project
                    declares one national figure, and counting it against
                    every district it names reported 29,391 families displaced
                    in Birbhum against an actual 225.
    """
    rows = read("register", "districts.json")

    n: dict = {}
    cat_a: dict = {}
    land: dict = {}
    displaced: dict = {}
    affected: dict = {}

    def bump(d, key, by=1):
        if key:
            d[key] = d.get(key, 0) + by

    for sh in shards:
        F = {x: i for i, x in enumerate(sh["fields"])}
        for r in sh["rows"]:
            dc = r[F["dc"]]
            touched = set(r[F["dall"]] or [])
            if dc:
                touched.add(dc)
            for c in touched:
                bump(n, c)
                if r[F["cat"]] == "A":
                    bump(cat_a, c)
            # Primary district only. See the docstring.
            if dc:
                if r[F["land"]]:
                    bump(land, dc)
                bump(displaced, dc, r[F["df"]] or 0)
                bump(affected, dc, r[F["af"]] or 0)

    for field, rebuilt, label in (
        ("n", n, "proposal counts"),
        ("nA", cat_a, "Category A counts"),
        ("declaringLand", land, "land-declaring counts"),
        ("displaced", displaced, "displaced-family totals"),
        ("affected", affected, "affected-family totals"),
    ):
        wrong = [f"{r['code']} {r['district']}: index {r.get(field)}, "
                 f"shards {rebuilt.get(r['code'], 0)}"
                 for r in rows
                 if (r.get(field) or 0) != rebuilt.get(r["code"], 0)]
        check(f"the register index's {label} rebuild from the shards",
              not wrong, f"{len(wrong)} districts disagree: {wrong[:3]}")


def test_order_transcription_completeness() -> None:
    """Whether each Presidential Order's schedule was transcribed in FULL.

    Every "outside" determination this instrument publishes rests on the
    transcription being complete, and completeness is a different claim from
    correctness: each transcribed entry can be right while an ABSENT one turns
    a Scheduled Area into "no part of this district is one" - the strongest
    negative claim the tool makes, and the one that would tell a Gram Sabha it
    has no statutory role in the case where the statute gives it one.

    Nothing recorded a declared item count, so a dropped item was invisible.
    This does not invent one: where the count has not been read from the
    Order's own schedule it reports the Order as UNVERIFIED, so the limit is
    published rather than implied away. It fails only on a recorded count that
    disagrees with what is transcribed.
    """
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from legal_reference import transcription_completeness
    except Exception as exc:  # noqa: BLE001
        check("the legal reference exposes transcription completeness", False,
              f"{type(exc).__name__}: {exc}")
        return

    comp = transcription_completeness()
    check("every Presidential Order reports a transcribed count",
          all(v.get("transcribed", 0) > 0 for v in comp.values()),
          str({k: v["transcribed"] for k, v in comp.items()}))

    disagree = [f"{v['number']}: declares {v['declared']}, "
                f"transcribed {v['transcribed']}"
                for v in comp.values() if v.get("agrees") is False]
    check("no Order's transcription contradicts its declared area count",
          not disagree, str(disagree))

    unverified = sorted(v["number"] for v in comp.values() if not v["verified"])
    print(f"  NOTE: {len(unverified)} of {len(comp)} Orders have NO verified "
          f"area count, so their transcriptions are not known to be complete: "
          f"{', '.join(unverified)}")
    print("        Every 'outside' determination drawn from them rests on that. "
          "Reading each Order's schedule and recording the count in "
          "ORDER_DECLARED_AREA_COUNTS closes it.")


def test_register_span(shards: list) -> None:
    """The register's span, against the submission dates in the rows.

    Every surface that says which years the register covers reads
    `meta.register_span`. It is what tells a reader that a search for an
    older proposal will find nothing, so a wrong span is a silent failure of
    exactly the kind that sentence exists to prevent. The span is recomputed
    here from the shard `date` column, independently of the build.
    """
    meta = read_or_none("meta.json") or {}
    span = meta.get("register_span")
    check("meta states the register's span", isinstance(span, dict), repr(span)[:80])
    if not isinstance(span, dict):
        return
    dates = []
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "date" not in F:
            continue
        for r in sh["rows"]:
            d = r[F["date"]]
            if isinstance(d, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", d):
                dates.append(d)
    check("the span's earliest date is the earliest submission in the rows",
          bool(dates) and span.get("earliest") == min(dates),
          f"{span.get('earliest')} vs {min(dates) if dates else None}")
    check("the span's latest date is the latest submission in the rows",
          bool(dates) and span.get("latest") == max(dates),
          f"{span.get('latest')} vs {max(dates) if dates else None}")
    check("the span counts every dated row",
          span.get("dated") == len(dates), f"{span.get('dated')} vs {len(dates)}")
    reg = next((s for s in meta.get("sources") or []
                if s.get("name") == "PARIVESH environmental clearance register"), {})
    check("the register's source description names the span's first year",
          bool(span.get("earliest"))
          and str(span["earliest"])[:4] in str(reg.get("coverage") or ""),
          repr(reg.get("coverage")))


def test_meta_resolution_block(shards: list) -> None:
    """meta's resolution-quality figures, against the rows they describe.

    test_meta_agrees covers four fields. The rest of the block - the
    sub-district rate, the counts of proposals carrying a sub-district, a
    village or more than one district, and the whole `resolution` subtree of
    methods and confidence tiers - had no assertion at all, and the methodology
    page prints them as headline figures. Setting the rate to 12.0 and the
    counts to 1 passed the contract.
    """
    meta = read_or_none("meta.json") or {}
    counts = meta.get("counts") or {}
    METHOD = {"v": "village", "s": "subdistrict", "d": "lgd_district",
              "n": "project_name", "a": "adjudicated", "c": "town_settled",
              "x": "unresolved"}

    sub = vill = multi = 0
    method: dict = {}
    total = 0
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        for r in sh["rows"]:
            total += 1
            if "sd" in F and r[F["sd"]]:
                sub += 1
            if "nv" in F and (r[F["nv"]] or 0) > 0:
                vill += 1
            if "dall" in F and len(r[F["dall"]] or []) > 1:
                multi += 1
            if "dm" in F:
                key = METHOD.get(r[F["dm"]], r[F["dm"]])
                method[key] = method.get(key, 0) + 1

    for field, got in (("proposals_with_subdistrict", sub),
                       ("proposals_with_village", vill),
                       ("proposals_multi_district", multi)):
        check(f"meta.counts.{field} matches the rows",
              counts.get(field) == got,
              f"meta {counts.get(field)} vs rows {got}")

    # The rate is over the PUBLISHED register, not over the resolved subset -
    # 87,276 of 89,817 is 97.17%, and dividing by the resolved count instead
    # gives 97.67%. Which denominator it is matters, so it is pinned.
    if total:
        want = round(100 * sub / total, 2)
        got = meta.get("subdistrict_rate_pct")
        check("meta.subdistrict_rate_pct is over the whole published register",
              isinstance(got, (int, float)) and abs(got - want) <= 0.01,
              f"meta {got} vs {want} (= {sub}/{total})")

    res = (meta.get("resolution") or {}).get("method") or {}
    check("meta.resolution.method matches the rows method for method",
          res == method,
          f"meta {sorted(res.items())} vs rows {sorted(method.items())}")

    conf = (meta.get("resolution") or {}).get("confidence") or {}
    check("meta.resolution.confidence totals the register",
          sum(conf.values()) == total if conf else False,
          f"{sum(conf.values()) if conf else 0} vs {total}")


def test_benchmark_formulas_are_the_registry_formulas() -> None:
    """Every benchmark states the formula it was computed with, and it is ours.

    The interface draws a comparison only when a benchmark's recorded formula
    equals the value's own. That check is only as good as the recorded
    formulas: if they were missing every comparison would silently vanish, and
    if they were copied from somewhere other than the registry the check would
    compare a thing with itself. So every published benchmark must carry a
    formula, and it must be the registry formula for that measure exactly.
    """
    reg = read_or_none("measures.json") or {}
    measures = reg.get("measures") or {}
    bench = reg.get("benchmarks") or {}
    defs = bench.get("definitions")
    check("benchmarks record the formula each was computed with",
          isinstance(defs, dict) and len(defs) > 0, type(defs).__name__)
    if not isinstance(defs, dict):
        return
    benchmarked = [k for k, v in (bench.get("india") or {}).items()
                   if v is not None and k in measures
                   and not measures[k].get("internal")]
    missing = [k for k in benchmarked if k not in defs]
    check("every published benchmark has a recorded formula",
          not missing, f"{len(missing)}: {missing[:4]}")
    wrong = [k for k in defs if k not in measures
             or defs[k] != measures[k].get("formula")]
    check("every recorded benchmark formula is the registry formula",
          not wrong, f"{len(wrong)}: {wrong[:4]}")


def test_benchmarks_are_computable_and_covered() -> None:
    """A benchmark must exist where the data exists, and say what it covers.

    Two failures lived here, and neither was assertable before:

    1. NULL WHERE THE DATA IS PRESENT. `_raw` carried NaN for the ten
       fully-urban districts with no Village Directory rows, and NaN is truthy,
       so `float(v or 0.0)` kept it and one NaN made the running total NaN for
       ever. All seven `infra.*` NATIONAL benchmarks published as null while
       534 to 630 districts held real values - 6,101 hospitals, 291,777
       government middle schools. Nothing noticed, because the only benchmark
       assertion was that the KEYS are real measure ids.

    2. ZERO WHERE THE VALUE WAS DELIBERATELY WITHHELD. Bihar's
       `infra.hospitals` is nulled in all 38 districts because a state-wide
       zero describes a reporting convention rather than the world - and the
       state benchmark, computed from `_raw`, published 0 anyway. Two files
       contradicting each other on one measure, the aggregate being the wrong
       one.
    """
    reg = read("measures.json")
    measures = reg.get("measures", reg)
    bm = reg.get("benchmarks") or {}
    india = bm.get("india") or {}
    by_state = bm.get("byState") or {}
    districts = read("districts.json")

    holds: dict[str, int] = {}
    for rec in districts.values():
        for key, val in (rec.get("values") or {}).items():
            if val is not None:
                holds[key] = holds.get(key, 0) + 1

    null_but_present = sorted(
        key for key, n in holds.items()
        if n > 0 and key in india and india[key] is None
        and not (measures.get(key) or {}).get("internal")
    )
    check("no national benchmark is null while districts hold that measure",
          not null_but_present,
          f"{len(null_but_present)}: "
          + ", ".join(f"{k} (held by {holds[k]})" for k in null_but_present[:4]))

    rep = bm.get("districtsReporting") or {}
    rep_india = rep.get("india") or {}
    total = rep.get("districtsTotal")
    check("the benchmark block states how many districts it covers",
          isinstance(rep_india, dict) and len(rep_india) > 0
          and total == len(districts),
          f"districtsTotal={total!r} vs {len(districts)}, "
          f"{len(rep_india)} measures")

    bad_counts = [f"{k}={v}" for k, v in rep_india.items()
                  if not isinstance(v, int) or not (0 <= v <= len(districts))]
    check("every reporting count is between zero and the district total",
          not bad_counts, f"{bad_counts[:4]}")

    # A value with no contributing district is not a measurement.
    hollow = sorted(k for k, v in india.items()
                    if v is not None and rep_india.get(k) == 0)
    check("no national benchmark is computed from zero districts",
          not hollow, f"{hollow[:4]}")

    # And the count must agree with the district file it claims to describe.
    disagree = [f"{k}: says {rep_india[k]}, file holds {holds.get(k, 0)}"
                for k in rep_india
                if rep_india[k] != holds.get(k, 0)]
    check("the reporting count matches the district values",
          not disagree, f"{len(disagree)}: {disagree[:3]}")

    meta = read_or_none("meta.json") or {}
    leaked = []
    for entry in meta.get("withheld_values") or []:
        st, key = entry.get("state"), entry.get("measure")
        if st in by_state and by_state[st].get(key) is not None:
            leaked.append(f"{st}/{key}={by_state[st][key]}")
    check("a measure withheld across a state is not published as its benchmark",
          not leaked, f"{len(leaked)}: {leaked[:4]}")


# How many published points may sit inside two district outlines at once, and
# how many may be drawn outside the outline of a district the verdict says they
# are inside. Both are consequences of simplifying the DRAWN geometry, both are
# measured rather than assumed, and both are bounded so that loosening the
# simplification shows up here as well as in build_geometry.
#
# Measured on the current file: 275 and 1,229 of 89,070. The limits sit above
# those with headroom, not at them, so ordinary register growth does not fail
# the build while a change in the geometry does.
AMBIGUOUS_POINT_LIMIT = 400
DRAWN_OUTSIDE_LIMIT = 1600

# How far a published verdict may sit from the DRAWN outline before it stops
# being explicable by simplification and starts being a wrong verdict.
#
# Degrees. 0.0135 is about 1.5 km; the furthest an `inside` proposal actually
# sits outside its own simplified outline is 1,022 m, and the p99 is 769 m.
# 0.0045 is about 500 m; the deepest an `elsewhere` proposal sits INSIDE a
# named outline is 294 m, and only 12 do so at all.
#
# These are what turn a tally into a recompute. An `inside` verdict on a point
# two districts away fails the first; an `elsewhere` verdict on a point in the
# middle of a district it names fails the second.
INSIDE_DRIFT_LIMIT_DEG = 0.0135
ELSEWHERE_DEPTH_LIMIT_DEG = 0.0045


def test_drawn_geometry_agrees_with_the_verdicts(shards: list) -> None:
    """The map is simplified; the verdict is not. Bound the disagreement.

    `geometry.py` decides `inside` / `elsewhere` against the FULL shapefile,
    and the page draws the marker on `districts-2011.geojson`, which is
    Douglas-Peucker simplified for the web. Those two can disagree, and where
    they do the reader sees a marker outside the outline of the district the
    sentence beneath it names - the picture contradicting the words, in the one
    component whose stated purpose is to let a reader "see the distance for
    themselves rather than take the word for it".

    Neither number can be driven to zero without abandoning simplification, so
    both are bounded. What must never happen is the count moving without anyone
    noticing, which is what a limit is for.
    """
    geo_path = ROOT / "public" / "geo" / "districts-2011.geojson"
    if not geo_path.exists():
        return
    geo = json.loads(geo_path.read_text(encoding="utf-8"))
    feats = [f for f in (geo.get("features") or []) if f.get("geometry")]

    def ring_contains(x, y, ring) -> bool:
        inside = False
        for i in range(len(ring) - 1):
            x1, y1 = ring[i][0], ring[i][1]
            x2, y2 = ring[i + 1][0], ring[i + 1][1]
            if (y1 > y) != (y2 > y):
                xin = (x2 - x1) * (y - y1) / (y2 - y1) + x1
                if x < xin:
                    inside = not inside
        return inside

    def feature_contains(feature, x, y) -> bool:
        g = feature.get("geometry") or {}
        polys = (g["coordinates"] if g.get("type") == "MultiPolygon"
                 else [g.get("coordinates") or []])
        for poly in polys:
            if poly and ring_contains(x, y, poly[0]):
                if not any(ring_contains(x, y, r) for r in poly[1:]):
                    return True
        return False

    # A crude bounding box per feature, so 89,070 points do not each get tested
    # against 640 outlines. Without it this check takes minutes.
    boxes = []
    for f in feats:
        g = f["geometry"]
        polys = (g["coordinates"] if g.get("type") == "MultiPolygon"
                 else [g.get("coordinates") or []])
        xs, ys = [], []
        for poly in polys:
            for x, y in (poly[0] if poly else []):
                xs.append(x)
                ys.append(y)
        if xs:
            boxes.append((f.get("id"), min(xs), min(ys), max(xs), max(ys), f))

    def seg_distance(px, py, x1, y1, x2, y2) -> float:
        dx, dy = x2 - x1, y2 - y1
        if dx == 0 and dy == 0:
            return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
        t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
        t = max(0.0, min(1.0, t))
        qx, qy = x1 + t * dx, y1 + t * dy
        return ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5

    def edge_distance(feature, x, y) -> float:
        """Distance from the point to the nearest edge of this outline."""
        g = feature.get("geometry") or {}
        polys = (g["coordinates"] if g.get("type") == "MultiPolygon"
                 else [g.get("coordinates") or []])
        best = float("inf")
        for poly in polys:
            for ring in poly or []:
                for i in range(len(ring) - 1):
                    d = seg_distance(x, y, ring[i][0], ring[i][1],
                                     ring[i + 1][0], ring[i + 1][1])
                    if d < best:
                        best = d
        return best

    ambiguous = 0
    drawn_outside = 0
    inside_total = 0
    # THE RECOMPUTE. Not a tally of the published column - that cannot
    # disagree with itself. Every verdict is re-derived from the point and the
    # drawn outlines, with a tolerance taken from the measured simplification
    # drift rather than assumed.
    inside_too_far = []
    elsewhere_too_deep = []
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if not {"lat", "lon", "gk", "dc"} <= set(F):
            continue
        for r in sh["rows"]:
            lat, lon = r[F["lat"]], r[F["lon"]]
            if lat is None or lon is None:
                continue
            hits = [cid for cid, x0, y0, x1, y1, f in boxes
                    if x0 <= lon <= x1 and y0 <= lat <= y1
                    and feature_contains(f, lon, lat)]
            if len(hits) > 1:
                ambiguous += 1
            if r[F["gk"]] == "inside":
                inside_total += 1
                named = set()
                if r[F["dc"]]:
                    named.add(r[F["dc"]])
                if "dall" in F and isinstance(r[F["dall"]], list):
                    named.update(c for c in r[F["dall"]] if c)
                if named and not (set(hits) & named):
                    drawn_outside += 1
                    d = min((edge_distance(f, lon, lat)
                             for cid, x0, y0, x1, y1, f in boxes
                             if cid in named), default=None)
                    if d is not None and d > INSIDE_DRIFT_LIMIT_DEG:
                        inside_too_far.append(
                            f"{r[F['id']]}: {d * 111:.1f} km from every "
                            f"district it names")
            elif r[F["gk"]] == "elsewhere":
                named = set()
                if r[F["dc"]]:
                    named.add(r[F["dc"]])
                if "dall" in F and isinstance(r[F["dall"]], list):
                    named.update(c for c in r[F["dall"]] if c)
                deep = set(hits) & named
                if deep:
                    d = max(edge_distance(f, lon, lat)
                            for cid, x0, y0, x1, y1, f in boxes if cid in deep)
                    if d > ELSEWHERE_DEPTH_LIMIT_DEG:
                        elsewhere_too_deep.append(
                            f"{r[F['id']]}: {d * 111_000:.0f} m inside a "
                            f"district it names")

    check("few published points fall inside two drawn outlines at once",
          ambiguous <= AMBIGUOUS_POINT_LIMIT,
          f"{ambiguous} over the limit of {AMBIGUOUS_POINT_LIMIT}; the drawn "
          f"geometry has become more ambiguous")
    check("few `inside` proposals are drawn outside the district they name",
          drawn_outside <= DRAWN_OUTSIDE_LIMIT,
          f"{drawn_outside} of {inside_total} over the limit of "
          f"{DRAWN_OUTSIDE_LIMIT}")
    check("every `inside` verdict is near a district the filing names",
          not inside_too_far,
          f"{len(inside_too_far)} beyond "
          f"{INSIDE_DRIFT_LIMIT_DEG * 111:.1f} km: {inside_too_far[:3]}")
    check("no `elsewhere` verdict sits deep inside a district it names",
          not elsewhere_too_deep,
          f"{len(elsewhere_too_deep)} deeper than "
          f"{ELSEWHERE_DEPTH_LIMIT_DEG * 111_000:.0f} m: "
          f"{elsewhere_too_deep[:3]}")
    print(f"  {ambiguous} ambiguous points, {drawn_outside} of {inside_total} "
          f"drawn outside their named district")


def test_site_geometry_states_its_basis() -> None:
    """The corroboration rate must publish the constant that produced it.

    `boundary` means "within this distance of a named district's edge", and
    boundary rows are excluded from both sides of the rate - so the tolerance
    decides how many rows the rate is computed over, and it moves the answer:
    at zero tolerance the rate is 96.07, at 0.01 degrees it is 98.42. 98.05 is
    one point in that band, and published on its own it is not a figure anyone
    can check.

    Also gates `alternative_site_only`, which counts filings placed from an
    ALTERNATIVE block because they carried no PRIMARY one - a site the
    regulator may have rejected. It is 0 today and was counted but never
    bounded, so a register change that introduced them would have published
    them silently rather than failing the build the way UNCLASSIFIED_LIMIT and
    READ_RESOLUTION_FLOOR do for their equivalents.
    """
    meta = read_or_none("meta.json") or {}
    sg = meta.get("site_geometry") or {}

    tol = sg.get("boundary_tolerance_m")
    check("the boundary tolerance is published with the rate",
          isinstance(tol, int) and tol > 0, repr(tol))

    # It must be the tolerance the verdicts were actually computed with.
    try:
        sys.path.insert(0, str(ROOT / "scripts" / "instruments"))
        from geometry import BOUNDARY_TOLERANCE  # noqa: PLC0415
        want = round(BOUNDARY_TOLERANCE * 111_000)
    except Exception:  # noqa: BLE001
        want = None
    if want is not None:
        check("the published tolerance is the one the code used",
              tol == want, f"published {tol} m, geometry.py says {want} m")

    check("the rate says which rows it is computed over",
          isinstance(sg.get("corroboration_note"), str)
          and "inside" in sg["corroboration_note"],
          repr(sg.get("corroboration_note"))[:80])

    coords = sg.get("coordinates") or {}
    alt = coords.get("alternative_site_only")
    check("no site is placed from a rejected alternative block",
          alt in (0, None),
          f"{alt} proposals placed from an ALTERNATIVE block; only PRIMARY "
          f"blocks may position a site")


def test_published_prose_is_not_malformed() -> None:
    """Sentences assembled from parts must not repeat a part.

    `legal_reference.py` builds each determination note from a template plus a
    variable. When the whole State is covered the variable was set to
    "an Autonomous District Council under the Sixth Schedule" while the
    template already supplied ", under the Sixth Schedule (Articles 244(2) and
    275(1))" - so 7 Meghalaya and 4 Tripura district pages published "lies
    within an Autonomous District Council under the Sixth Schedule, under the
    Sixth Schedule (Articles 244(2) and 275(1))".

    Nothing could catch it: every other check reads the determination's STATUS,
    which was right, and the note is prose. This reads the prose.
    """
    legal = read_or_none("legal_reference.json")
    if not legal:
        return
    notes = []
    for code, d in (legal.get("determinations") or {}).items():
        if isinstance(d, dict) and d.get("note"):
            notes.append((f"determination {code}", d["note"]))
    for i, o in enumerate(legal.get("obligations") or []):
        for field in ("requirement", "trigger", "note"):
            if isinstance(o, dict) and o.get(field):
                notes.append((f"obligation {i}.{field}", o[field]))

    def repeated_clause(text: str) -> str | None:
        """An immediately repeated run of words, which is what a doubled
        template variable looks like. Four words is long enough that ordinary
        English does not trip it and short enough to catch a stray phrase."""
        words = text.split()
        for size in range(8, 3, -1):
            for i in range(len(words) - 2 * size + 1):
                a = words[i:i + size]
                b = words[i + size:i + 2 * size]
                if a == b:
                    return " ".join(a)
        return None

    doubled = []
    for label, text in notes:
        hit = repeated_clause(text)
        if hit:
            doubled.append(f"{label}: {hit!r}")
    check("no published sentence repeats a clause",
          not doubled, f"{len(doubled)}: {doubled[:3]}")

    # The specific shape that shipped, pinned by name so it cannot come back
    # in a form the generic detector happens to miss.
    dup_schedule = [label for label, text in notes
                    if "Sixth Schedule, under the Sixth Schedule" in text]
    check("the Sixth Schedule clause is not doubled",
          not dup_schedule, f"{len(dup_schedule)}: {dup_schedule[:3]}")

    # A note assembled from a missing variable.
    empties = [label for label, text in notes
               if "undefined" in text.lower() or "None" in text.split()
               or "  " in text]
    check("no published sentence carries a missing or doubled space",
          not empties, f"{len(empties)}: {empties[:3]}")


def test_the_download_says_what_the_screen_says() -> None:
    """The PDF must decide applicability the same way the page does.

    The export route printed all fifteen obligations under the heading
    "OBLIGATIONS THAT ATTACH" with no verdict at all, so the artefact a reader
    takes away and cites told them fifteen statutory duties attached to their
    proposal while the screen it came from said most did not. It also blamed
    the proponent's filing for every unplaced location, which the screen had
    already been corrected not to do.

    Both are wiring, so both are checked as wiring: the route has to reach for
    the shared decision functions rather than re-deriving or omitting them.
    """
    route = ROOT / "app" / "api" / "instruments" / "consent" / "export" / "route.ts"
    if not route.exists():
        return
    src = route.read_text(encoding="utf-8")
    check("the PDF decides applicability with the shared function",
          "obligationsFor" in src and "sortObligations" in src,
          "route.ts does not import obligationsFor/sortObligations")
    check("the PDF prints an applicability verdict",
          "DOES NOT APPLY" in src and "MAY APPLY" in src,
          "no verdict strings in route.ts")
    check("the PDF distinguishes whose silence an unplaced location is",
          "formStatus" in src and "'none'" in src and "'pend'" in src,
          "route.ts does not branch on formStatus")
    # The map's no-coordinates sentence has two halves and each has its own
    # truth condition. "This filing records no site coordinates" is false for
    # the 70 placed proposals whose form the Ministry does not serve at all,
    # and "its district comes from the codes in the application form" is
    # false for the 73 whose district was read from the project's title. It
    # was one fixed sentence for all of them.
    loc = ROOT / "components" / "instruments" / "SiteLocator.tsx"
    if loc.exists():
        ls = loc.read_text(encoding="utf-8")
        check("the map says whose silence missing coordinates are",
              'formStatus === "none"' in ls and 'formStatus === "pend"' in ls,
              "SiteLocator does not branch on formStatus")
        check("the map says where the district actually came from",
              'resolution === "project_name"' in ls,
              "SiteLocator does not branch on the resolution method")
    prof = ROOT / "components" / "instruments" / "ProjectProfile.tsx"
    if prof.exists():
        ps = prof.read_text(encoding="utf-8")
        check("the profile hands the map both facts",
              "formStatus={project?.formStatus" in ps
              and "resolution={project?.resolution" in ps,
              "ProjectProfile does not pass formStatus/resolution")
    screen = ROOT / "components" / "instruments" / "ConsentScreen.tsx"
    if screen.exists():
        check("the screen renders the curated caveat the PDF carries",
              "o.note" in screen.read_text(encoding="utf-8"),
              "ConsentScreen never renders an obligation's note")


def test_unresolved_split_is_over_the_unresolved(shards: list) -> None:
    """Two splits of the same field, and they are not interchangeable.

    `caf_coverage` is the cf split over the WHOLE register;
    `resolution.unresolved_by_form_status` is the same split over the proposals
    that could not be placed. They differ substantially - 259 proposals have no
    form served register-wide, but only 189 of those are unplaced, because a
    project name can still resolve one - and the methodology page quotes the
    second in a sentence about the unplaced cohort.

    Quoting the first there overstated the Ministry's non-disclosure by 70 and
    read as government secrecy rather than as what it is. Both are asserted
    here, against the rows, so neither can be substituted for the other.
    """
    meta = read_or_none("meta.json") or {}
    want_all: dict = {}
    want_unplaced: dict = {}
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "cf" not in F:
            continue
        for r in sh["rows"]:
            cf = r[F["cf"]]
            want_all[cf] = want_all.get(cf, 0) + 1
            if not r[F["dc"]]:
                want_unplaced[cf] = want_unplaced.get(cf, 0) + 1

    got_all = meta.get("caf_coverage") or {}
    check("caf_coverage is the split over the whole register",
          {k: v for k, v in got_all.items() if v} == {k: v for k, v in want_all.items() if v},
          f"meta {sorted(got_all.items())} vs rows {sorted(want_all.items())}")

    got_un = (meta.get("resolution") or {}).get("unresolved_by_form_status") or {}
    check("unresolved_by_form_status is the split over the UNPLACED only",
          {k: v for k, v in got_un.items() if v} == {k: v for k, v in want_unplaced.items() if v},
          f"meta {sorted(got_un.items())} vs rows {sorted(want_unplaced.items())}")

    # The distinction itself: if these two were ever equal the field would be
    # redundant and a page could quote either without noticing.
    check("the two splits are genuinely different sets",
          sum(want_un for want_un in want_unplaced.values())
          < sum(want_all.values()),
          "every proposal is unplaced, which cannot be right")

    # And the unplaced split must total the unplaced count.
    counts = meta.get("counts") or {}
    unplaced_total = (counts.get("proposals_published", 0)
                      - counts.get("proposals_district_resolved", 0))
    check("the unplaced split totals the unplaced count",
          sum(got_un.values()) == unplaced_total,
          f"{sum(got_un.values())} vs {unplaced_total}")


def test_appraisal_coverage_partitions() -> None:
    """decided + open + closed-without-decision must be the whole.

    The page said "of those, N have been decided and M are still open", which
    is the shape of a partition and was not one: 4,296 proposals ended without
    a decision - returned in their present form, withdrawn, or pulled back -
    so they have no duration and are not waiting for one. A reader adding the
    two printed numbers got 66,576 of 70,872 and no indication that anything
    was missing.
    """
    ap = read_or_none("appraisal.json") or {}
    cov = ap.get("coverage") or {}
    total = cov.get("proposals_summarised")
    parts = [cov.get("with_duration"), cov.get("pending"),
             cov.get("closed_without_decision")]
    check("appraisal coverage publishes all three outcomes",
          all(isinstance(p, int) for p in parts),
          f"with_duration={parts[0]!r} pending={parts[1]!r} "
          f"closed_without_decision={parts[2]!r}")
    if all(isinstance(p, int) for p in parts) and isinstance(total, int):
        check("the three outcomes partition the summarised set",
              sum(parts) == total,
              f"{parts[0]} + {parts[1]} + {parts[2]} = {sum(parts)} "
              f"vs {total}")
        # And the third bucket must not be empty, or the page would print a
        # clause about nothing and the partition would be vacuous.
        check("the closed-without-decision bucket is real",
              parts[2] > 0, f"{parts[2]}")


def test_no_status_is_reinterpreted_in_the_ui() -> None:
    """A position must reach the reader through the registry, not a substring.

    `normaliseStatus` derived the badge from the raw status text:

        if (s.includes("withdraw")) return "Withdrawn";

    "Pending at MS for Proposal Withdraw Request" contains "withdraw", so 169
    proposals whose withdrawal the authority had NOT acted on were badged
    WITHDRAWN - a live application shown to the public as finished. The
    `includes("tor granted")` branch did the same for 16,288 proposals still in
    appraisal. Measured before the fix, the badge disagreed with the canonical
    label on 88,568 of 89,817 rows.

    `stages.py` already maps all 83 spellings to a canonical key carrying a
    label, and every shard publishes that key as `sk`. This asserts the UI
    reads it rather than re-deriving one.
    """
    for rel in ("components/instruments/ProjectProfile.tsx",
                "components/instruments/ProjectSearch.tsx",
                "lib/instruments/projects.ts"):
        p = ROOT / rel
        if not p.exists():
            continue
        src = p.read_text(encoding="utf-8")
        check(f"{rel.split('/')[-1]} does not re-derive a status label",
              "normaliseStatus" not in src,
              "normaliseStatus is back; it matches substrings of the raw "
              "register text and cannot tell a request from a decision")

    for rel in ("components/instruments/ProjectProfile.tsx",
                "components/instruments/ProjectSearch.tsx"):
        p = ROOT / rel
        if p.exists():
            check(f"{rel.split('/')[-1]} labels a status from the registry",
                  "stageLabel(" in p.read_text(encoding="utf-8"),
                  "no stageLabel call")

    # And the registry has to be able to answer: every published `sk` needs a
    # label, or stageLabel falls back to the register's raw words.
    stages = read_or_none("stages.json") or {}
    statuses = stages.get("statuses") or {}
    unlabelled = [k for k, v in statuses.items()
                  if not str((v or {}).get("label") or "").strip()]
    check("every canonical stage carries a label",
          not unlabelled, f"{len(unlabelled)}: {unlabelled[:5]}")

    # The specific confusion that shipped: asking to withdraw is not having
    # withdrawn, and the registry must keep them apart.
    asked = statuses.get("pending_ms_withdraw") or {}
    done = statuses.get("withdrawal_request_accepted") or {}
    if asked and done:
        check("a pending withdrawal is not terminal",
              asked.get("terminal") is False and not asked.get("outcome"),
              f"terminal={asked.get('terminal')} outcome={asked.get('outcome')}")
        check("an accepted withdrawal is",
              done.get("terminal") is True and done.get("outcome") == "withdrawn",
              f"terminal={done.get('terminal')} outcome={done.get('outcome')}")
        check("the two carry different labels",
              str(asked.get("label")) != str(done.get("label")),
              f"both say {asked.get('label')!r}")


# Districts the Ministry of Panchayati Raj names as notified Fifth Schedule
# Areas, by Census 2011 code. Only the ones whose name resolves unambiguously
# to a 2011 district; post-2011 districts and unmatched spellings are left out
# rather than guessed, and the count is asserted so the list cannot quietly
# empty.
#
# Source: Ministry of Panchayati Raj, "State wise details of notified Fifth
# Schedule Areas", read 2026-09-22.
MOPR_SCHEDULED_CODES = {
    # Every district the list names, in the Census 2011 frame. Telangana's four
    # were Andhra Pradesh districts in 2011. Six Chhattisgarh districts formed
    # after 2011 (Balrampur, Surajpur, Sukma, Kondagaon, Balod, Gariaband) are
    # entered as the 2011 district they were carved from - Surguja, Dantewada,
    # Bastar, Durg, Raipur - because a scheduled part of the child is a
    # scheduled part of the parent, so the parent cannot be denied either.
    23: "Chamba", 25: "Lahul & Spiti", 34: "Kinnaur", 117: "Sirohi",
    124: "Dungarpur", 125: "Banswara", 126: "Chittaurgarh", 130: "Udaipur",
    346: "Garhwa", 351: "Godda", 352: "Sahibganj", 353: "Pakur",
    356: "Lohardaga", 357: "Purbi Singhbhum", 358: "Palamu", 359: "Latehar",
    362: "Dumka", 363: "Jamtara", 364: "Ranchi", 365: "Khunti", 366: "Gumla",
    367: "Simdega", 368: "Pashchimi Singhbhum", 369: "Saraikela-kharsawan",
    372: "Sambalpur", 374: "Sundargarh", 375: "Kendujhar", 376: "Mayurbhanj",
    377: "Baleshwar", 388: "Ganjam", 389: "Gajapati", 390: "Kandhamal",
    395: "Kalahandi", 396: "Rayagada", 397: "Nabarangapur", 398: "Koraput",
    399: "Malkangiri", 400: "Koriya", 401: "Surguja", 402: "Jashpur",
    403: "Raigarh", 404: "Korba", 406: "Bilaspur", 408: "Rajnandgaon",
    409: "Durg", 410: "Raipur", 412: "Dhamtari", 413: "Uttar Bastar Kanker",
    414: "Bastar", 415: "Narayanpur", 416: "Dakshin Bastar Dantewada",
    417: "Bijapur", 418: "Sheopur", 431: "Umaria", 434: "Ratlam",
    438: "Dhar", 440: "West Nimar", 441: "Barwani", 447: "Betul",
    449: "Hoshangabad", 453: "Dindori", 454: "Mandla", 455: "Chhindwara",
    456: "Seoni", 457: "Balaghat", 460: "Shahdol", 461: "Anuppur",
    462: "Sidhi", 464: "Jhabua", 465: "Alirajpur", 466: "East Nimar",
    467: "Burhanpur", 472: "Sabar Kantha", 484: "Panch Mahals", 485: "Dohad",
    486: "Vadodara", 487: "Narmada", 488: "Bharuch", 489: "The Dangs",
    490: "Navsari", 491: "Valsad", 492: "Surat", 493: "Tapi",
    497: "Nandurbar", 498: "Dhule", 499: "Jalgaon", 503: "Amravati",
    508: "Garhchiroli", 509: "Chandrapur", 510: "Yavatmal", 511: "Nanded",
    516: "Nashik", 517: "Thane", 521: "Pune", 522: "Ahmadnagar",
    532: "Adilabad", 538: "Mahbubnagar", 540: "Warangal", 541: "Khammam",
    542: "Srikakulam", 543: "Vizianagaram", 544: "Visakhapatnam",
    545: "East Godavari", 546: "West Godavari",
}


def test_no_denial_contradicts_the_ministry() -> None:
    """`outside` is a denial, and a denial needs the Order to be current.

    The instrument derives "no part of this district is a Scheduled Area" from
    the Presidential Orders as transcribed. That is sound only while the
    transcription is the last word. For Garhwa it was not: the Scheduled Areas
    (State of Jharkhand) Order, 2007 has fourteen entries and does not name it -
    the transcription is complete, checked against two independent
    reproductions - but the Ministry of Panchayati Raj's own list of notified
    Fifth Schedule Areas does name it, and the State's PESA rules notified in
    January 2026 are applied partially there.

    Published as `outside`, that told a Gram Sabha in Bhandaria that its
    consent is not a precondition, on the strength of a document something
    later had overtaken. The status is now withdrawn to `not_determined` rather
    than reversed, because a summary table is not the instrument that declares
    a Scheduled Area either.

    This asserts the class, not the instance: no district the Ministry names
    may carry a denial.
    """
    legal = read_or_none("legal_reference.json")
    if not legal:
        return
    det = legal.get("determinations") or {}
    check("the Ministry list is still populated",
          len(MOPR_SCHEDULED_CODES) >= 100, str(len(MOPR_SCHEDULED_CODES)))

    denied = []
    missing = []
    for code, name in sorted(MOPR_SCHEDULED_CODES.items()):
        row = det.get(str(code))
        if row is None:
            missing.append(f"{code} {name}")
            continue
        if row.get("status") == "outside":
            denied.append(f"{code} {name}")
    check("every district the Ministry names carries a determination",
          not missing, f"{len(missing)}: {missing[:4]}")
    check("no district the Ministry names is published as outside",
          not denied,
          f"{len(denied)} denied while the Ministry lists them as Fifth "
          f"Schedule Areas: {denied[:4]}")

    # And the withdrawal has to say why, or it is just a gap.
    for code in (346,):
        row = det.get(str(code)) or {}
        if row.get("status") == "not_determined":
            note = str(row.get("note") or "")
            check(f"district {code}'s undetermined status explains itself",
                  "Panchayati Raj" in note and "checked" in note.lower(),
                  f"note does not name the conflicting source: {note[:90]!r}")


# Determinations whose answer is not in doubt and that were each published
# wrongly - or not at all - at some point. Rayagada is the Niyamgiri district,
# carved from Koraput, which the 1977 Order names whole; it was "not
# determined". Hyderabad and Srikakulam were "not determined" with the rest of
# undivided Andhra Pradesh. Singrauli and Ramgarh are successors the Orders do
# not reach.
LEGAL_LANDMARKS = {
    396: ("Rayagada", "within"),
    365: ("Khunti", "within"),
    542: ("Srikakulam", "partial"),
    545: ("East Godavari", "partial"),
    536: ("Hyderabad", "outside"),
    534: ("Karimnagar", "outside"),
    463: ("Singrauli", "outside"),
    361: ("Ramgarh", "outside"),
}


def test_legal_completeness_and_succession() -> None:
    """Every district is answered, and succession is decided one way everywhere.

    Before 2026-09-25: 43 districts were "not determined" - all 23 of undivided
    Andhra Pradesh, and every district carved after an Order from ground it
    scheduled - while Nandurbar, carved from Dhule after C.O. 123, WAS given its
    parent's status. Two rules for one question. And the sub-division aliases
    that carry an Order's tehsil names into the Census frame pointed at
    spellings the frame does not contain, so 19 named tehsils resolved to
    nothing while each looked transcribed.
    """
    print("\nlegal completeness and succession")
    legal = read_or_none("legal_reference.json") or {}
    det = legal.get("determinations") or {}

    # 1. "Not determined" only where a named second source conflicts.
    open_ = {k: d for k, d in det.items() if d.get("status") == "not_determined"}
    unexplained = [k for k, d in open_.items()
                   if "Panchayati Raj" not in str(d.get("note") or "")]
    check("a district is left undetermined only where two official sources "
          "conflict, and says which", not unexplained,
          f"{len(unexplained)} undetermined without a named conflict: "
          f"{unexplained[:6]}")

    # 2. Successors: the Ministry's list agrees with the containment outcome.
    succ = {k: d for k, d in det.items() if d.get("successorOf")}
    check("successor districts carry a containment determination",
          len(succ) >= 20, f"only {len(succ)}")
    wrong = []
    for k, d in succ.items():
        listed = int(k) in MOPR_SCHEDULED_CODES
        if d["status"] in ("within", "partial") and not listed:
            wrong.append(f"{k} {d['status']} but not on the Ministry list")
        if d["status"] == "outside" and listed:
            wrong.append(f"{k} outside but on the Ministry list")
        if d["status"] not in ("within", "partial", "outside"):
            wrong.append(f"{k} {d['status']}")
    check("every successor's outcome agrees with the Ministry list, both ways",
          not wrong, "; ".join(wrong[:5]))

    # 3. Landmarks.
    bad = {f"{c} {n}": (det.get(str(c), {}).get("status"), want)
           for c, (n, want) in LEGAL_LANDMARKS.items()
           if det.get(str(c), {}).get("status") != want}
    check(f"all {len(LEGAL_LANDMARKS)} legal landmarks carry their determination",
          not bad, f"(published, expected): {bad}")

    # 4. Every alias target exists in the Census sub-district frame.
    sys.path.insert(0, str(ROOT / "scripts" / "instruments"))
    from district_resolution import normalize_name
    import legal_reference as LR
    subs = read_or_none("subdistricts.json") or {}
    subs = subs.get("subdistricts", subs)
    frame = {normalize_name(v.get("name") or "") for v in subs.values()}
    dead = [f"{k} -> {v}" for k, v in LR.SUBDIVISION_ALIASES.items()
            if normalize_name(v) not in frame]
    check("every sub-division alias points at a name the Census frame carries",
          not dead, f"{len(dead)} dead: {dead[:5]}")
    cov = legal.get("subdivision_coverage") or {}
    check("named sub-divisions resolve (at most 4 left, each deliberately)",
          cov.get("unitsUnresolved", 99) <= 4,
          f"{cov.get('unitsUnresolved')} unresolved of {cov.get('unitsNamed')}")


def test_change_log(shards: list[dict]) -> None:
    """The change log says only what the register's own dates say.

    changes/recent.json is what "What moved in the register", the feeds, the
    CSV and every district's recent activity read. Each event must name a
    published proposal, fall inside the window, carry a stage the registry
    defines, and the per-day tallies must be the rows counted. And it must be
    complete where it can be checked: a proposal whose decision date (`don`,
    from the same appraisal history) falls in the window must appear as a
    decision on that date.
    """
    print("\nchange log")
    log = read_or_none("changes", "recent.json")
    check("the change log is published", isinstance(log, dict))
    if not isinstance(log, dict):
        return
    check("its rows are [kind, date, id, sk, seen]",
          log.get("fields") == ["kind", "date", "id", "sk", "seen"],
          str(log.get("fields")))
    win = log.get("window") or {}
    lo, hi = win.get("from", ""), win.get("to", "")
    stages = set(((read_or_none("stages.json") or {}).get("statuses") or {}).keys())
    kinds = {"filed", "query", "moved", "decided", "closed"}
    ids = set()
    don = {}
    fon = {}
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        for r in sh["rows"]:
            ids.add(str(r[F["id"]]))
            if r[F["don"]]:
                don[str(r[F["id"]])] = r[F["don"]]
            if r[F["fon"]]:
                fon[str(r[F["id"]])] = r[F["fon"]]
    rows = log.get("rows") or []
    reads = log.get("stamps") or []
    bad = [r for r in rows if len(r) != 5 or r[0] not in kinds or not (lo <= r[1] <= hi)
           or r[2] not in ids or r[3] not in stages
           or not (r[4] is None or (isinstance(r[4], int) and 0 <= r[4] < len(reads)))]
    check("every event names a published proposal, a known stage and a date in the window",
          not bad, f"{len(bad)} bad, e.g. {bad[:3]}")
    check("events run newest first",
          all(rows[i][1] >= rows[i + 1][1] for i in range(len(rows) - 1)))
    check("the reads an event can first appear in are ordered and unique",
          reads == sorted(set(reads)), str(reads[:4]))
    # One filing date per act. The earliest filing event of a proposal IS its
    # published filing date; dating filings by the step's start once put 45%
    # of them on a different day from `fon`, by up to 49 days.
    first_filed: dict = {}
    for k, d, pid, _, _ in rows:
        if k == "filed" and (pid not in first_filed or d < first_filed[pid]):
            first_filed[pid] = d
    early = [(p, d, fon[p]) for p, d in first_filed.items() if p in fon and d < fon[p]]
    owed_filings = [p for p, d in fon.items() if lo <= d <= hi]
    missing_f = [p for p in owed_filings if first_filed.get(p) != fon[p]]
    check("no filing event predates the proposal's published filing date",
          not early, f"{len(early)}, e.g. {early[:3]}")
    check("every filing date inside the window appears as a filing on that date",
          not owed_filings or len(missing_f) <= len(owed_filings) * 0.01,
          f"{len(missing_f)} of {len(owed_filings)}, e.g. {missing_f[:3]}")
    tally: dict = {}
    for k, d, _, _, _ in rows:
        tally[(d, k)] = tally.get((d, k), 0) + 1
    daily = log.get("daily") or []
    mismatch = [(d["date"], k) for d in daily for k in kinds
                if d.get(k, 0) != tally.get((d["date"], k), 0)]
    check("the day-by-day tallies are the rows counted", not mismatch,
          f"{len(mismatch)} disagree, e.g. {mismatch[:3]}")
    check("the tallies cover every day of the window",
          bool(daily) and daily[0]["date"] == lo and daily[-1]["date"] == hi
          and len(daily) == win.get("days"), f"{len(daily)} days, {lo}..{hi}")
    decided = {(r[2], r[1]) for r in rows if r[0] == "decided"}
    owed = [(i, d) for i, d in don.items() if lo <= d <= hi]
    missing = [x for x in owed if x not in decided]
    check("every decision dated inside the window appears as one",
          not owed or len(missing) <= len(owed) * 0.01,
          f"{len(missing)} of {len(owed)} missing, e.g. {missing[:3]}")
    fresh = read_or_none("freshness.json") or {}
    if fresh.get("checked_at"):
        from datetime import datetime as _dt, timedelta as _td, timezone as _tz
        ist = (_dt.fromisoformat(fresh["checked_at"].replace("Z", "+00:00"))
               .astimezone(_tz(_td(hours=5, minutes=30))).date().isoformat())
        check("the window ends on the day the register was read", hi == ist,
              f"window ends {hi}, register read {ist} (IST)")
        check("the log is stamped no earlier than the read it was built from",
              bool(log.get("stamp")) and log["stamp"] >= fresh["checked_at"],
              f"{log.get('stamp')} vs {fresh['checked_at']}")
    check("no event claims to have appeared in a later build than this one",
          all(x <= (log.get("stamp") or "") for x in reads), str(reads[-2:]))


def test_linked_clearances(shards: list[dict]) -> None:
    """The other clearances are published as declared, and never as absent.

    `lk` separates an unread form (null) from one that declares nothing (0);
    collapsing them would tell a reader a project needs no forest clearance
    because this instrument had not read its form yet. The forest register's
    records are published only for proposals some form names, and every
    district's counts must rebuild from the shards over their own denominator.
    """
    print("\nlinked clearances")
    allowed = {"f", "w", "a", "e", "p", "c", "t", "u"}
    from forest_numbers import fp_numbers
    bad_shape, unread_claim, named = [], [], set()
    per_district: dict = {}
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "lk" not in F:
            check("shards publish linked clearances (lk)", False, sh.get("slug"))
            return
        for r in sh["rows"]:
            v = r[F["lk"]]
            if v is not None and r[F["cf"]] not in ("ok", "nogeo"):
                unread_claim.append(r[F["no"]])
            if v is None or v == 0:
                pass
            elif not isinstance(v, dict) or set(v) - allowed or not v:
                bad_shape.append(r[F["no"]])
            else:
                if "f" in v and (not isinstance(v["f"], list) or len(v["f"]) != 5):
                    bad_shape.append(r[F["no"]])
                elif v.get("f") and v["f"][0]:
                    named.update(fp_numbers(v["f"][0]))
                if "t" in v and not all(isinstance(t, list) and len(t) == 3 for t in v["t"]):
                    bad_shape.append(r[F["no"]])
                # A blank is a topic the form did not answer - never one it
                # also declared something under, and never an empty marker.
                u = v.get("u")
                if u is not None and (not isinstance(u, str) or not u
                                      or set(u) - set("fwepc")
                                      or any(k in v for k in u)):
                    bad_shape.append(r[F["no"]])
            codes = {r[F["dc"]]} | set(r[F["dall"]] or [])
            for c in codes:
                if c is None:
                    continue
                d = per_district.setdefault(str(c), {"read": 0, "forest": 0, "blank": 0})
                if v is not None:
                    d["read"] += 1
                    if isinstance(v, dict) and v.get("u"):
                        d["blank"] += 1
                    if isinstance(v, dict) and (v.get("f") or v.get("a")):
                        d["forest"] += 1
    check("shards publish linked clearances (lk)", True)
    check("every lk value has the documented shape", not bad_shape,
          f"{len(bad_shape)}, e.g. {bad_shape[:4]}")
    check("no proposal declares linked clearances from a form that was not read",
          not unread_claim, f"{len(unread_claim)}, e.g. {unread_claim[:4]}")

    forest = read_or_none("register", "forest.json")
    check("the forest register's records are published", isinstance(forest, dict))
    if isinstance(forest, dict):
        extra = [k for k in (forest.get("rows") or {}) if k not in named]
        check("only forest proposals some published form names are published",
              not extra, f"{len(extra)} unnamed, e.g. {extra[:3]}")
        check("the forest index counts what it names",
              forest.get("named") == len(named)
              and forest.get("found") == len(forest.get("rows") or {}),
              f"named {forest.get('named')} vs {len(named)}")
        check("forest records are keyed by the normalised proposal number",
              all(fp_numbers(k) == [k] for k in (forest.get("rows") or {})))
        check("a forest register with records says when it was read",
              not forest.get("rows") or bool(forest.get("read_at")))
        fi = {n: i for i, n in enumerate(forest.get("fields") or [])}
        sra = forest.get("state_read_at") or {}
        undated = [k for k, row in (forest.get("rows") or {}).items()
                   if not sra.get(row[fi["state"]])] if "state" in fi else ["no state field"]
        check("every forest record is dated by when its own State was read",
              not undated, f"{len(undated)}, e.g. {undated[:3]}")
        check("the register's read date is its oldest State's, never newer",
              not sra or forest.get("read_at") == min(sra.values()))

    reg = read_or_none("register", "districts.json") or []
    # Hectares: each forest proposal once per district, from f[2] only.
    ha_by: dict = {}
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        for r in sh["rows"]:
            v = r[F["lk"]]
            if r[F["dc"]] is None or not isinstance(v, dict) or not v.get("f"):
                continue
            ha = v["f"][2]
            if not isinstance(ha, (int, float)) or ha <= 0:
                continue
            key = tuple(fp_numbers(v["f"][0])) or ("proposal", r[F["id"]])
            d = ha_by.setdefault(str(r[F["dc"]]), {})
            d[key] = max(d.get(key, 0.0), float(ha))
    ha_wrong = [(row["code"], row.get("forestHa"), round(sum(ha_by.get(str(row["code"]), {}).values()), 2))
                for row in reg
                if abs((row.get("forestHa") or 0) - sum(ha_by.get(str(row["code"]), {}).values())) > 0.01]
    check("each district's forest hectares count every forest proposal once",
          not ha_wrong, f"{len(ha_wrong)}, e.g. {ha_wrong[:3]}")
    wrong = []
    for row in reg:
        got = per_district.get(str(row["code"]), {"read": 0, "forest": 0, "blank": 0})
        if (row.get("linksRead", 0), row.get("nForest", 0), row.get("linksBlank", 0)) != (
                got["read"], got["forest"], got["blank"]):
            wrong.append((row["code"], row.get("linksRead"), got["read"],
                          row.get("nForest"), got["forest"]))
        if row.get("nForest", 0) > row.get("linksRead", 0) or row.get("linksRead", 0) > row.get("n", 0):
            wrong.append((row["code"], "exceeds its denominator"))
    check("every district's clearance counts rebuild from the shards",
          not wrong, f"{len(wrong)}, e.g. {wrong[:3]}")


def test_data_page_documents_every_column() -> None:
    """The data page promises a meaning for every shard column."""
    print("\ndata page")
    src = (ROOT / "app" / "instruments" / "consent" / "data" / "page.tsx").read_text(
        encoding="utf-8")
    block = src[src.index("const FIELDS"):src.index("const ENDPOINTS")]
    documented = set(re.findall(r'\["(\w+)",', block))
    missing = [f for f in py_fields_written() if f not in documented]
    check("every shard column is documented on the data page", not missing,
          f"undocumented: {missing}")


# Proposals whose place codes, declared district and coordinates were read on
# the portal and whose correct district is not in doubt. Each was published in
# the wrong district before adjudication existed, and each fails if the rule
# is removed. Pinned by proposal number, which the register never reuses.
LOCATION_LANDMARKS = {
    # Malabar Hill, D Ward. Filed under the Greater Mumbai town code, which the
    # village index places in Mumbai Suburban; declared Mumbai, sited in Mumbai.
    "SIA/MH/INFRA2/535132/2025": 519,
    "SIA/MH/INFRA2/529061/2025": 519,
    "SIA/MH/INFRA2/509322/2024": 519,
    # Filed under the Greater Hyderabad town code, which spans Hyderabad,
    # Rangareddy and Medak; its coordinates fall in Rangareddy.
    "SIA/TG/INFRA2/433585/2023": 537,
}


def test_location_adjudication(shards: list[dict]) -> None:
    """The three statements of place a filing makes are reconciled, not ignored.

    The place codes on a form, the district it declares (`dd`) and the district
    its coordinates fall in (`gd`) were all published, and 698 rows stood in a
    district the other two contradicted together - Mumbai City's page listed 25
    proposals while 440 were sited there. adjudicate() moves a row only when
    the declared district and the coordinates agree against the codes; this
    asserts that no row is left in that state, that every moved row is
    consistent with the rule that moved it, and that the landmarks resolve.
    """
    stranded, bad_a, n_a, seen = [], [], 0, {}
    valid = set((read_or_none("districts.json") or {}).keys())
    bad_dd: list = []
    for sh in shards:
        F = {n: i for i, n in enumerate(sh["fields"])}
        if "dd" not in F:
            check("shards publish the declared district (dd)", False,
                  f"{sh.get('slug')} has no dd column")
            return
        for r in sh["rows"]:
            dc, dd, gd, gk = r[F["dc"]], r[F["dd"]], r[F["gd"]], r[F["gk"]]
            if dd is not None and str(dd) not in valid:
                bad_dd.append((r[F["no"]], dd))
            named = set(r[F["dall"]] or []) | ({dc} if dc is not None else set())
            if gk == "elsewhere" and dd is not None and dd == gd and dd not in named:
                stranded.append(r[F["no"]])
            if r[F["dm"]] == "a":
                n_a += 1
                if not (dc == dd == gd and gk in ("inside", "boundary")):
                    bad_a.append((r[F["no"]], dc, dd, gd, gk))
            if r[F["no"]] in LOCATION_LANDMARKS:
                seen[r[F["no"]]] = dc
    check("shards publish the declared district (dd)", True)
    # LGD gives a district carved after 2011 a code of its own that the Census
    # 2011 frame does not contain; published, it read "district 645".
    check("every declared district is a Census 2011 district",
          not bad_dd, f"{len(bad_dd)}, e.g. {bad_dd[:4]}")
    check("no proposal stands where its declared district and its coordinates "
          "both contradict it", not stranded,
          f"{len(stranded)} stranded, e.g. {stranded[:5]}")
    check("every adjudicated proposal stands where its declaration and its "
          "coordinates agree", n_a > 0 and not bad_a,
          f"{n_a} adjudicated; inconsistent: {bad_a[:5]}")
    wrong = {k: (seen.get(k), v) for k, v in LOCATION_LANDMARKS.items()
             if seen.get(k) != v}
    check(f"all {len(LOCATION_LANDMARKS)} location landmarks resolve to their "
          "district", not wrong, f"(published, expected): {wrong}")


def main() -> int:
    if not DATA.exists():
        print(f"ERROR: {DATA} not found - nothing published to check")
        return 2
    shards = [json.loads(p.read_text(encoding="utf-8"))
              for p in sorted((DATA / "projects").glob("*.json"))]
    if not shards:
        print("ERROR: no state shards found")
        return 2
    print(f"checking {len(shards)} shards, "
          f"{sum(len(s['rows']) for s in shards):,} proposals")

    test_field_contract(shards)
    test_row_shape(shards)
    test_register_matches_shards(shards)
    test_measures()
    test_legal_reference()
    test_order_transcription_completeness()
    test_published_prose_is_not_malformed()
    test_the_download_says_what_the_screen_says()
    test_no_status_is_reinterpreted_in_the_ui()
    test_no_denial_contradicts_the_ministry()
    test_meta_agrees(shards)
    test_register_span(shards)
    test_meta_resolution_block(shards)
    test_unresolved_split_is_over_the_unresolved(shards)
    test_appraisal_coverage_partitions()
    test_stage_registry(shards)
    test_site_geometry(shards)
    test_appraisal(shards)
    test_no_contact_details(shards)
    test_derived_columns(shards)
    test_verdict_consistency(shards)
    test_denominators_match_the_registry(shards)
    test_source_coverage(shards)
    test_index_contract(shards)
    test_determination_coverage(shards)
    test_freshness_contract()
    test_boundary_file()
    test_boundary_sits_in_its_state()
    test_drawn_geometry_agrees_with_the_verdicts(shards)
    test_site_geometry_states_its_basis()
    test_vocabulary_is_anchored(shards)
    test_site_verdicts_recompute(shards)
    test_sector_vocabulary_is_stable(shards)
    test_measure_ranges_declared()
    test_benchmarks_are_computable_and_covered()
    test_benchmark_formulas_are_the_registry_formulas()
    test_subdistricts()
    test_subdistrict_references_resolve(shards)
    test_facets(shards)
    test_lookup(shards)
    test_index_counts(shards)
    test_register_rows_agree_with_gazetteer()
    test_register_counts_trace_to_the_shards(shards)
    test_location_adjudication(shards)
    test_legal_completeness_and_succession()
    test_change_log(shards)
    test_linked_clearances(shards)
    test_data_page_documents_every_column()

    check(f"the suite still runs at least {MIN_CHECKS} checks",
          CHECKS >= MIN_CHECKS,
          f"only {CHECKS} ran - a test call was probably dropped from main()")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} of {CHECKS} checks FAILED:")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print(f"all {CHECKS} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
