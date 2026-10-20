"""Whitespace India - Instrument 01 "People & Consent" data pipeline.

Single-file and reproducible. Regenerates every artifact the instrument reads.

Sources (all open, no authentication):
  PARIVESH  https://parivesh.nic.in/parivesh_api/trackYourProposal/advanceSearchData
            National environmental clearance register. Fetched per sector; the
            API ignores `page`/`size` and an unfiltered call returns ~128 MB.
  SHRUG v5  Harvard Dataverse doi:10.7910/DVN/DPESAK
            Census 2011 Primary Census Abstract and Village Directory, and
            the Socio Economic and Caste Census 2011 (rural households),
            aggregated to sub-district. Files are Stata binary despite the
            .tab extension - read with pandas.read_stata.
  datameet  Census 2011 district boundaries; supplies the district gazetteer
            and the censuscode that SHRUG's pc11_district_id joins to.

Writes to <project>/public/data/instruments/consent/:
  meta.json        vintages, counts, resolution rates, invariants
  measures.json    the measure registry plus national and state benchmarks
  districts.json   per-district computed values, keyed by 2011 censuscode
  index.json       search facets and per-state proposal counts
  lookup.json      proposal_id -> state slug, so a deep link can find its shard
  projects/<state>.json   trimmed proposals, sharded by state
And to <project>/scripts/instruments/:
  verification_report.json   local audit artifact, not shipped

Method
------
  District resolution   PARIVESH returns `state` but no district. The district
                        is recovered from the free-text projectName, constrained
                        to the proposal's own state. See district_resolution.py.
                        Roughly a third of the register resolves; the rest are
                        reported unresolved and are never guessed.
  Aggregation           SHRUG sub-district rows are summed to district on
                        pc11_district_id, which is the NATIONAL census code
                        (1..640) and matches datameet `censuscode`, NOT
                        `DT_CEN_CD`. Joining on state+district serial matches
                        almost nothing and looks like partial success.
  Facts                 Every measure is computed from the registry in
                        measures.py and range-checked. A measure outside its
                        declared range fails the build rather than rendering.

Environment:
  INSTRUMENTS_CACHE_DIR   required. Directory holding the fetched sources:
                            parivesh/all_records.json  (or sector_<id>.json)
                            shrug/*.tab
                            geo/2011_Dist.dbf
  Use --fetch to populate it from the network.

Run from the project root:
  python scripts/instruments/build_data.py --fetch     # download then build
  python scripts/instruments/build_data.py             # build from cache
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from district_resolution import Gazetteer, resolve_district  # noqa: E402
import join_csr_master  # noqa: E402
from location import (  # noqa: E402
    NO_SUBDISTRICT, LocationIndex, adjudicate, from_project_name, resolve_from_caf,
    unresolved,
)
from measures import GROUPS, MEASURES, PUBLIC_MEASURES, SECC_SHARES  # noqa: E402
import stages as ST  # noqa: E402
import appraisal as AP  # noqa: E402
from geometry import (  # noqa: E402
    BOUNDARY_TOLERANCE as DGEO_BOUNDARY_TOLERANCE, DistrictGeometry,
)
from privacy import scrub_contact  # noqa: E402

# ── Paths ─────────────────────────────────────────────────────────────────
_cache = os.environ.get("INSTRUMENTS_CACHE_DIR", "")
if not _cache:
    sys.exit(
        "ERROR: INSTRUMENTS_CACHE_DIR is not set.\n"
        "Set it to a working directory OUTSIDE the repository that holds (or\n"
        "will hold, with --fetch) the fetched sources:\n"
        "  parivesh/  shrug/  geo/\n\n"
        "  Windows:  set INSTRUMENTS_CACHE_DIR=C:\\path\\to\\cache\n"
        "  macOS:    export INSTRUMENTS_CACHE_DIR=/path/to/cache\n"
    )
CACHE = Path(_cache)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = PROJECT_ROOT / "public" / "data" / "instruments" / "consent"
# Where a build WRITES. Normally the same directory, but --out sends the
# output elsewhere so a pipeline change can be run end to end and checked
# without standing on the published data first and finding out afterwards.
# The published directory is still what the register floor is measured
# against, whatever this is set to: a trial build must clear the same bar as
# a real one, or it is not a trial of anything.
WRITE_DIR = OUT_DIR
# The audit report of the build that produced the PUBLISHED data. A candidate
# build (--out) writes its own report beside the candidate folder instead:
# writing here let every trial build overwrite the report of what is actually
# published, so the audit trail described a dataset nobody was serving.
REPORT_PATH = Path(__file__).resolve().parent / "verification_report.json"
SCRIPTS_DIR = Path(__file__).resolve().parent

# ── Constants ─────────────────────────────────────────────────────────────
PARIVESH_BASE = "https://parivesh.nic.in/parivesh_api/trackYourProposal"
SHRUG_DOI = "doi:10.7910/DVN/DPESAK"
SHRUG_VERSION = "5.0"
DATAMEET_URL = (
    "https://raw.githubusercontent.com/datameet/maps/master/Districts/Census_2011"
)

# Verified live 2026-08-21 against getListOfSector.
SECTORS = {
    2: "Industrial Projects - 1",
    3: "Non-Coal Mining",
    4: "Thermal Projects",
    5: "River Valley and Hydroelectric Projects",
    6: "INFRA-2",
    7: "Nuclear Projects",
    8: "INFRA-1",
    10: "Industrial Projects - 2",
    11: "Coal Mining",
    13: "Industrial Projects - 3",
}

SHRUG_FILES = {
    "pca": ("pc11_pca_clean_pc11subdist.tab", 10742882),
    "vd": ("pc11_vd_clean_pc11subdist.tab", 10742647),
    # Place names keyed to shrid2 (`11-<state>-<district>-<subdistrict>-<village>`).
    # This is what turns a CAF village code into a Census 2011 district, and it
    # is why no curated post-2011 district table is needed. 149 MB.
    "loc_names": ("shrid_loc_names.tab", 10742739),
    # Socio Economic and Caste Census 2011, rural households, per sub-district.
    # The household circumstances - land, income, work - the population
    # census does not record. Shares of households; see secc_weighted().
    "secc": ("secc_rural_pc11subdist.tab", 10742784),
}

# LGD reference published by PARIVESH itself; carries code -> census_code_2011
# for 641 of 774 districts. The remaining 133 are post-2011 creations, resolved
# through the village/sub-district route instead.
LGD_ENDPOINTS = {
    "getdistricts": "https://parivesh.nic.in/parivesh_api/kyc/getdistricts",
    "getstates": "https://parivesh.nic.in/parivesh_api/kyc/getstates",
}

# Records in this status are system-delisted and carry no decision. They are
# excluded from the shipped index and counted separately in the report.
EXCLUDED_STATUSES = {"DELISTED_BY_SYSTEM"}

# Shipped shard format.
#
# Rows are ARRAYS, not objects, and the column names live once in the shard
# header. Repeating twelve JSON keys across 89,372 records costs several MB of
# pure key text for no information. Sector, status and authority are interned to
# integer indexes into the shard's own dictionaries, the certificate URL has its
# constant prefix stripped, and the resolution result collapses to a censuscode
# plus a one-letter method. Nothing is lost: every field is reconstructible, and
# the reader in lib/instruments/projects.ts does exactly that.
SHARD_FIELDS = [
    "id",      # proposal_id
    "rid",     # the record's `id` - the key the CAF endpoint wants
    "no",      # proposalNo, the human-readable reference
    "name",    # projectName
    "agency",  # nameOfUserAgency, the proponent
    "sector",  # index into shard.sectors
    "cat",     # category: A | B1 | B2
    "status",  # index into shard.statuses
    "date",    # dateOfSubmission, date part only
    "auth",    # 0 = SEIAA, 1 = MOEFCC
    "cert",    # certificate_url with CERT_PREFIX stripped, "" when absent
    "dc",      # primary Census 2011 district code, or null
    "dall",    # every district touched, only when more than one
    "sd",      # Census 2011 sub-district codes, or null
    "nv",      # count of distinct villages named in the filing
    "dm",      # resolution method code, see RESOLUTION_CODES
    "af",      # no_of_project_affected_families, as declared by the proponent
    "df",      # no_of_project_displaced_families, as declared
    "rnr",     # rehabilitation and resettlement involved: YES / NO
    "lit",     # litigation pending: YES / NO
    "vio",     # violation involved: YES / NO
    "land",    # existing total land, hectares
    "forest",  # existing forest land, hectares
    # ── The position, canonically ─────────────────────────────────────────
    "sk",      # canonical status key; see stages.py. `status` keeps the raw text
    # ── Where the site actually is, from the filed KML corners ────────────
    "lat",     # the mapped block the verdict below rests on, latitude. Not the
               # centre of the envelope: on a project spread over several
               # blocks that centre can fall where no part of the project is
    "lon",     # the same block, longitude
    "ext",     # [south, west, north, east] envelope, null when the site is a point
    "gk",      # where the coordinates fall, against every district the filing
               # names: inside | boundary | elsewhere | offshore |
               #        unmapped | no_geometry.
               # Null in two cases, told apart by `lat`: no coordinates were
               # filed (lat null), or coordinates were filed but the filing
               # named no district to test them against (lat set)
    "gd",      # district the coordinates actually fall in; null when unresolvable
    # ── How the application has moved, from the appraisal history ─────────
    "dtd",     # days from first recorded step to decision; null when undecided
    "dpd",     # days open, for proposals not yet decided
    "qr",      # rounds of Essential/Additional Details sought
    "cst",     # canonical key of the step the proposal currently sits at
    "fon",     # first filing date from the appraisal history. `date` is the
               # register's own submission date and moves forward on
               # re-submission; durations are measured from this one, so
               # fon + dtd reaches the decision and date + dtd does not
    "don",     # decision date. fon + dtd + dsu == don, exactly, for every
               # decided proposal - the arithmetic is meant to be checked
    "dsu",     # days the portal had the proposal delisted, excluded from dtd
    "nblk",    # distinct mapped blocks the filing carries
    "sq",      # what qualifies this location, null when nothing does:
               #   alt   the filing named no primary site; this is an alternative
               #   1c    at least one block rested on a single usable corner
               #   rej   at least one block was discarded as malformed
               #   unt   at least one untyped block was passed over
               #   none  every block filed was discarded; nothing survived
               #   old   extracted before per-block detail was recorded, so the
               #         discard counts for this row are unknown, not zero
               #   wide  the mapped extent spans over ~110 km, so a verdict
               #         resting on one of its blocks is weaker evidence
               # A location resting on a rejected alternative site is a
               # statement about a place the project is not, so it cannot be
               # published looking identical to a clean one.
    "dd",      # district the form itself DECLARES (its LGD mainDistrict, as a
               # Census 2011 code), null when the form declares none or declares
               # one created after 2011. Published beside `dc` and `gd` so a
               # reader can see all three statements of place the filing makes,
               # and so a disagreement among them is visible rather than resolved
               # silently. See location.adjudicate().
    "upd",     # the register's own last-modified date (app_updated_on, IST
               # date). What changed, and when, is read from this.
    "lk",      # the OTHER clearances and the land, as the form declares them:
               #   null  the form has not been read by the reader that records
               #         these (fetch_caf EXTRACT_VERSION 4) - unknown, NOT none
               #   0     read, and it declares none of them
               #   {f: [forest proposal no, status, ha applied, ha diverted,
               #        approved on], w: [protected area, status, proposal no],
               #    a: forest land additionally sought (the form's own figure),
               #    e: eco-sensitive zone, p: protected area, c: [crz, class],
               #    t: [[land type, owner, acquisition status], ...]}
               #   with only the declared parts present
    "cf",      # why this proposal's location is as good as it is, in terms of
               # the source rather than of us:
               #   ok     the regulator's Common Application Form was read and
               #          it gave a location
               #   nogeo  the form was read and names no location we can place
               #   none   the regulator serves no form for this proposal; the
               #          location here comes from the project name alone
               #   pend   not yet read. The register gains proposals daily and
               #          a form is fetched after the proposal appears, so
               #          there is always a young cohort in this state
               # Without this, a proposal we have not got to yet and one the
               # government holds no file for are the same row, and the
               # instrument cannot say which of its silences are its own.
]
# Contact details are removed from free-text fields before publication; the
# line that draws and why is in privacy.py.
# A build publishing less than this share of what is already published is
# treated as a failed read rather than a real change. The register grows; it
# does not halve overnight.
# The reader version fetch_caf.py writes. Imported rather than retyped: a
# literal here silently stops meaning "current" the moment that file is bumped,
# and the flag it drives would then mark every row as up to date.
try:
    from fetch_caf import EXTRACT_VERSION as CAF_EXTRACT_VERSION
except Exception:  # noqa: BLE001
    CAF_EXTRACT_VERSION = 3

REGISTER_FLOOR = 0.80
# The largest share of published proposals whose application form may still
# be unread. See the invariant "the application forms were read".
UNREAD_CEILING = 0.03
# Of the proposals whose Common Application Form we actually read, the share
# we can place on the map. This is the instrument's competence, stated in a
# way that does not move with how much of the backfill is done: the
# whole-register rate ran 56% mid-backfill and 99.6% after it, for the same
# code, so a floor on THAT number either fires constantly or never. This one
# sat at 99.64% mid-backfill and 99.59% complete. A real break - the form
# changing shape, the village index failing to load, the resolver regressing -
# takes it to the floor immediately and cannot hide behind a young cohort.
READ_RESOLUTION_FLOOR = 0.95

# Degrees. A mapped extent wider than this - roughly 110 km - is flagged on the
# row. The block-span cap is deliberately loose, because a cap alone cannot
# separate a genuine 400 km expressway corridor from a malformed filing of the
# same size. The verdict is satisfied by any one block, so a large block whose
# centre happens to fall in a named district can corroborate a filing on thin
# evidence. That is disclosed rather than judged: the reader is told the extent
# is wide and can weigh the verdict accordingly.
WIDE_SITE_SPAN = 1.0

# A register submission date as the shards publish it: dateOfSubmission's date
# part. Anything else is not a date and does not bound the register's span.
REGISTER_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

CERT_PREFIX = "https://parivesh.nic.in/certificates/"
AUTHORITIES = ["SEIAA", "MOEFCC"]
RESOLUTION_CODES = {
    "village": "v",
    "subdistrict": "s",
    "lgd_district": "d",
    "project_name": "n",
    "unresolved": "x",
    # the declared district and the site coordinates overruled the place codes
    "adjudicated": "a",
    # a town code spanning districts placed it; the coordinates or the
    # declared district chose which (see location.adjudicate)
    "town_settled": "c",
}

USER_AGENT = "Mozilla/5.0 (compatible; whitespaceindia-instruments/1.0)"


def log(msg: str) -> None:
    print(msg, flush=True)


from forest_numbers import fp_numbers  # noqa: E402  (FP/... normalisation)


from links import LINK_TOPICS, compact_links  # noqa: E402,F401


def slugify(name: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", str(name).lower())).strip("-")


def safe_div(num: float | None, den: float | None) -> float | None:
    """Divide, returning None rather than raising or producing inf/nan."""
    if num is None or den is None:
        return None
    try:
        if den == 0 or not math.isfinite(den) or not math.isfinite(num):
            return None
        out = num / den
        return out if math.isfinite(out) else None
    except (TypeError, ZeroDivisionError):
        return None


def rnd(v: float | None, places: int = 2) -> float | None:
    return None if v is None else round(float(v), places)


# ═════════════════════════════════════════════════════════════════════════
# FETCH
# ═════════════════════════════════════════════════════════════════════════
def http_get(url: str, dest: Path, timeout: int = 600) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as fh:
        total = 0
        while chunk := resp.read(1 << 20):
            fh.write(chunk)
            total += len(chunk)
    return total


def fetch_sources(since: str | None = None) -> dict:
    """Download every source into the cache. Records what it did."""
    stamps: dict = {"fetched_at": datetime.now(timezone.utc).isoformat(), "sectors": []}

    if since:
        # A windowed fetch writes to sector_<id>.json - the SAME file a full
        # sweep writes - so it would replace the complete sector with just the
        # window, and every path that reads the cache would then build from a
        # fragment while reporting a clean run. Deltas belong to sync.py,
        # which merges into the register instead of overwriting it.
        raise SystemExit(
            "build_data.py --fetch --since would overwrite each full sector "
            "file with only the window, truncating the cached register. "
            "Use:  python scripts/instruments/sync.py --since " + str(since))

    log("fetching PARIVESH register, one sector at a time")
    for sid, sname in SECTORS.items():
        url = f"{PARIVESH_BASE}/advanceSearchData?majorClearanceType=1&sector={sid}"
        dest = CACHE / "parivesh" / f"sector_{sid}.json"
        t0 = time.time()
        try:
            n = http_get(url, dest)
            secs = round(time.time() - t0, 2)
            log(f"  sector {sid:2} {sname[:34]:36} {n:>10,} B  {secs:>6.1f}s")
            stamps["sectors"].append({"id": sid, "name": sname, "bytes": n, "seconds": secs})
        except Exception as exc:  # noqa: BLE001 - report and continue
            log(f"  sector {sid:2} {sname[:34]:36} FAILED: {exc}")
            stamps["sectors"].append({"id": sid, "name": sname, "error": str(exc)})

    log("fetching SHRUG files from Harvard Dataverse")
    for key, (fname, fid) in SHRUG_FILES.items():
        dest = CACHE / "shrug" / fname
        url = f"https://dataverse.harvard.edu/api/access/datafile/{fid}?format=original"
        n = http_get(url, dest)
        log(f"  {fname:36} {n:>10,} B")

    log("fetching datameet district boundaries")
    for ext in ("dbf", "shx", "prj", "shp"):
        dest = CACHE / "geo" / f"2011_Dist.{ext}"
        n = http_get(f"{DATAMEET_URL}/2011_Dist.{ext}", dest)
        log(f"  2011_Dist.{ext:4} {n:>10,} B")

    log("fetching LGD reference from PARIVESH")
    for name, url in LGD_ENDPOINTS.items():
        dest = CACHE / "lgd" / f"{name}.json"
        n = http_get(url, dest)
        log(f"  {name:36} {n:>10,} B")

    # Collapse the per-sector files into the one register the rest of the
    # pipeline reads. Without this the sector files and the merged cache that
    # sync.py maintains are two different registers, and load_register()
    # prefers the merged one - so a full fetch could be downloaded and then
    # silently ignored in favour of an older merge.
    merged: dict = {}
    for sid in SECTORS:
        path = CACHE / "parivesh" / f"sector_{sid}.json"
        if not path.exists():
            continue
        for rec in (json.loads(path.read_text(encoding="utf-8")).get("data") or []):
            pid = rec.get("proposal_id")
            if pid is not None:
                merged[pid] = rec
    combined = CACHE / "parivesh" / "all_records.json"
    combined.write_text(json.dumps(list(merged.values()), separators=(",", ":"),
                                   ensure_ascii=False), encoding="utf-8")
    stamps["merged_records"] = len(merged)
    log(f"  merged register: {len(merged):,} records -> {combined.name}")

    (CACHE / "fetch_stamps.json").write_text(
        json.dumps(stamps, indent=2), encoding="utf-8")
    return stamps


# ═════════════════════════════════════════════════════════════════════════
# LOAD
# ═════════════════════════════════════════════════════════════════════════
def load_register() -> tuple[list[dict], dict]:
    """Load the clearance register from cache, merging sector shards."""
    combined = CACHE / "parivesh" / "all_records.json"
    per_sector: dict[int, int] = {}

    # The merged file is only usable if it is at least as new as every sector
    # file behind it. A fetch writes the sectors first and merges after, so a
    # run that died in between leaves fresh downloads on disk beside a stale
    # merge - and this function, preferring the merge, would build from the
    # old data and report a clean build over it. Re-merging costs a few
    # seconds and makes "what was downloaded" and "what is built from" the
    # same thing by construction rather than by sequencing.
    stale_merge = False
    if combined.exists():
        merged_at = combined.stat().st_mtime
        newer = [sid for sid in SECTORS
                 if (CACHE / "parivesh" / f"sector_{sid}.json").exists()
                 and (CACHE / "parivesh" / f"sector_{sid}.json").stat().st_mtime
                 > merged_at + 1]
        if newer:
            stale_merge = True
            log(f"  merged register is older than sector(s) {newer}; "
                f"re-merging from what was actually downloaded")

    if combined.exists() and not stale_merge:
        records = json.loads(combined.read_text(encoding="utf-8"))
        log(f"  register (merged cache): {len(records):,} records")
    else:
        records = []
        missing, bad = [], []
        for sid in SECTORS:
            path = CACHE / "parivesh" / f"sector_{sid}.json"
            if not path.exists():
                missing.append(sid)
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:  # noqa: BLE001
                bad.append(f"{sid} ({type(exc).__name__})")
                continue
            # The HTTP status is not the answer: this API carries its own
            # status inside a 200 body, and a sector whose query failed
            # server-side arrives as a good-looking file with no `data`. Read
            # as zero rows that is indistinguishable from a sector with no
            # proposals - and Non-Coal Mining alone is 91 MB of them.
            env = payload.get("status") if isinstance(payload, dict) else None
            if env is not None and int(env) != 200:
                bad.append(f"{sid} (envelope status {env})")
                continue
            if not isinstance(payload, dict) or payload.get("data") is None:
                bad.append(f"{sid} (no `data` key)")
                continue
            rows = payload.get("data") or []
            per_sector[sid] = len(rows)
            records.extend(rows)
        if missing or bad:
            # Silently skipping a sector publishes a register with a whole
            # clearance category removed, and every downstream check passes
            # because what remains is internally consistent.
            raise SystemExit(
                "ERROR: the register cannot be assembled from sector files. " + \
                (f"missing: {missing}. " if missing else "") + \
                (f"unusable: {bad}. " if bad else "") + \
                "Re-run with --fetch, or restore the cache. Building "\
                "from the sectors that happen to be present would "\
                "publish a register with those categories silently "\
                "absent.")
        log(f"  register: {len(records):,} records from {len(per_sector)} sectors")

    # Last wins, matching the merge in fetch_sources() and in sync.merge().
    # The three used to disagree - two keeping the last record for a
    # proposal_id and this one the first - so which copy of a duplicated
    # proposal got published depended on which path assembled the register.
    by_pid: dict = {}
    for r in records:
        by_pid[r.get("proposal_id")] = r
    deduped = list(by_pid.values())
    return deduped, {"per_sector": per_sector, "raw": len(records),
                     "deduped": len(deduped)}


def load_shrug() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load PCA, Village Directory and SECC rural sub-district tables.

    TRAP: `?format=original` serves Stata binary regardless of the .tab
    extension, and every ID column is a ZERO-PADDED STRING. Converting an ID to
    int destroys the padding and silently breaks the join, so IDs stay str.
    """
    pca_path = CACHE / "shrug" / SHRUG_FILES["pca"][0]
    vd_path = CACHE / "shrug" / SHRUG_FILES["vd"][0]
    pca = pd.read_stata(pca_path, convert_categoricals=False)
    vd = pd.read_stata(vd_path, convert_categoricals=False)
    secc = pd.read_stata(CACHE / "shrug" / SHRUG_FILES["secc"][0],
                         convert_categoricals=False)
    log(f"  SHRUG PCA: {pca.shape[0]:,} x {pca.shape[1]}")
    log(f"  SHRUG VD : {vd.shape[0]:,} x {vd.shape[1]}")
    log(f"  SHRUG SECC rural: {secc.shape[0]:,} x {secc.shape[1]}")
    for df, name in ((pca, "PCA"), (vd, "VD"), (secc, "SECC")):
        for col in ("pc11_state_id", "pc11_district_id", "pc11_subdistrict_id"):
            if col not in df.columns:
                sys.exit(f"FATAL: {name} is missing {col}; schema has changed.")
    return pca, vd, secc


def secc_weighted(secc: pd.DataFrame, by: str) -> pd.DataFrame:
    """SECC household SHARES as household-weighted sums, grouped on `by`.

    SHRUG publishes each SECC measure as a share of a sub-district's rural
    households. Shares cannot be summed or averaged to a district: a plain
    mean gives a 50-household tehsil the weight of a 50,000-household one.
    So each share becomes two summable columns - share x households, and
    households - taken only over sub-districts that REPORT the share, so an
    unreported answer never counts as a "no". A rate anywhere up the
    hierarchy is then 100 x the first sum / the second, exactly as the
    registry formula states, and the national benchmark sums the same
    columns.
    """
    hh = col(secc, "secc_hh")
    out = pd.DataFrame({"secc_hh": hh})
    for share_col in SECC_SHARES.values():
        if share_col in secc.columns:
            share = pd.to_numeric(secc[share_col], errors="coerce")
        else:
            MISSING_SOURCE_COLUMNS.add(share_col)
            share = pd.Series(float("nan"), index=secc.index)
        reported = share.notna()
        out[f"secc_n__{share_col}"] = (share.fillna(0.0) * hh).where(reported, 0.0)
        out[f"secc_d__{share_col}"] = hh.where(reported, 0.0)
    out[by] = secc[by]
    return out.groupby(by, dropna=True).sum()


# ═════════════════════════════════════════════════════════════════════════
# AGGREGATE AND COMPUTE
# ═════════════════════════════════════════════════════════════════════════
# Source columns this build asked for and did not find. A missing column is
# substituted with zeros so aggregation can proceed, and zero is a PERFECTLY
# VALID value for a count - so nothing downstream can tell the difference
# between a district with no households and a column SHRUG renamed. The
# suppressor cannot help either: it skips any measure whose national total is
# zero, which is exactly this case. So the names are collected here and the
# build refuses to publish if any survive, rather than quietly emitting 640
# districts of zeroes with every gate green.
MISSING_SOURCE_COLUMNS: set[str] = set()

# Published vocabularies this build could not take at face value. Positions in
# these arrays ARE the meaning of every `sector` and `status` in every shard,
# so a reference that cannot be read exactly cannot be silently repaired: the
# obvious repair - drop the unusable entries and carry on - closes the gaps and
# renumbers everything after them, which is the one outcome the whole mechanism
# exists to prevent. The build refuses instead.
UNREADABLE_VOCABULARY: dict[str, str] = {}


def col(df: pd.DataFrame, name: str) -> pd.Series:
    """Numeric column, or a zero column if absent. Absence is RECORDED."""
    if name not in df.columns:
        MISSING_SOURCE_COLUMNS.add(name)
        return pd.Series(0.0, index=df.index)
    return pd.to_numeric(df[name], errors="coerce").fillna(0.0)


def aggregate_to_district(pca: pd.DataFrame, vd: pd.DataFrame,
                          secc: pd.DataFrame | None = None) -> tuple[pd.DataFrame, dict]:
    """Sum sub-district rows to district on the national census code."""
    notes: dict = {}

    pca = pca.copy()
    pca["_code"] = pd.to_numeric(pca["pc11_district_id"], errors="coerce")
    vd = vd.copy()
    vd["_code"] = pd.to_numeric(vd["pc11_district_id"], errors="coerce")

    notes["pca_subdistricts"] = int(len(pca))
    notes["vd_subdistricts"] = int(len(vd))
    notes["pca_districts"] = int(pca["_code"].nunique())
    notes["vd_districts"] = int(vd["_code"].nunique())

    pca_cols = [
        "pc11_pca_tot_p", "pc11_pca_tot_m", "pc11_pca_tot_f", "pc11_pca_no_hh",
        "pc11_pca_p_06", "pc11_pca_p_sc", "pc11_pca_p_st", "pc11_pca_p_lit",
        "pc11_pca_tot_work_p", "pc11_pca_mainwork_p", "pc11_pca_margwork_p",
        "pc11_pca_main_cl_p", "pc11_pca_main_al_p", "pc11_pca_main_hh_p",
        "pc11_pca_main_ot_p", "pc11_pca_marg_cl_p", "pc11_pca_marg_al_p",
        "pc11_pca_marg_hh_p",
    ]
    vd_cols = [
        "pc11_vd_ph_cntr_doc_tot", "pc11_vd_ph_cntr_doc_pos", "pc11_vd_all_hosp",
        "pc11_vd_p_sch_gov", "pc11_vd_m_sch_gov", "pc11_vd_s_sch_gov",
    ]
    notes["pca_columns_absent"] = [c for c in pca_cols if c not in pca.columns]
    notes["vd_columns_absent"] = [c for c in vd_cols if c not in vd.columns]

    pca_agg = pd.DataFrame({c: col(pca, c) for c in pca_cols})
    pca_agg["_code"] = pca["_code"]
    pca_g = pca_agg.groupby("_code", dropna=True).sum()

    vd_agg = pd.DataFrame({c: col(vd, c) for c in vd_cols})
    vd_agg["_code"] = vd["_code"]
    vd_g = vd_agg.groupby("_code", dropna=True).sum()

    merged = pca_g.join(vd_g, how="left")
    if secc is not None:
        # Left join: a district with no rural SECC rows (the wholly urban
        # ones) keeps NaN, which compute_values reads as "not recorded".
        s = secc.copy()
        s["_code"] = pd.to_numeric(s["pc11_district_id"], errors="coerce")
        sg = secc_weighted(s, "_code")
        merged = merged.join(sg, how="left")
        notes["secc_districts"] = int(sg.index.nunique())
    notes["districts_after_join"] = int(len(merged))
    notes["districts_missing_vd"] = int(
        merged["pc11_vd_p_sch_gov"].isna().sum()) if "pc11_vd_p_sch_gov" in merged else None
    return merged, notes


def aggregate_to_subdistrict(
    pca: pd.DataFrame, vd: pd.DataFrame, secc: pd.DataFrame | None = None,
) -> tuple[pd.DataFrame, dict[int, list[int]], dict]:
    """Same measures, one administrative level down.

    Worth doing only because CAF village codes resolve to a Census 2011
    sub-district for roughly 89% of proposals. A sub-district is a far better
    description of who a project actually affects than a district, which can be
    several million people.

    ONE ROW PER SUB-DISTRICT, NOT ONE PER (SUB-DISTRICT, DISTRICT).
    ---------------------------------------------------------------
    This used to group the PCA by `["_sd", "_dt"]`, which is the right key for
    almost every sub-district and the wrong one for two kinds:

    1. A tehsil that STRADDLES a district keeps one code and appears in Census
       as "<name> part" on each side - 31 of them, all in Assam ("gossaigaon
       part" is in both Kokrajhar and Dhubri under code 02001). Grouped by the
       pair they became two rows with one key, and the publishing loop wrote
       `subdistricts[code] = ...` for each, so one part silently replaced the
       other. The surviving record understated the place it named.
    2. SHRUG writes `pc11_subdistrict_id == 99999` for "this district has no
       sub-district", once per such district - 149 rows across 29 districts,
       every one with an empty name. Those are not one place, they are 29
       different districts sharing a sentinel, and collapsing them published a
       single record carrying whichever district iterated last.

    The sentinel is dropped here, because it is not a place. Real codes are
    grouped by the code alone, so a straddling tehsil is published once with
    its true totals, and the districts it lies in are returned separately.

    The Village Directory columns are the reason this could not simply be
    summed after the fact: `bg` is keyed on `_sd`, so joining it onto (sd, dt)
    rows gave EACH part the whole tehsil's VD totals, and adding the parts
    would have counted every hospital and school in Gossaigaon twice.
    """
    notes: dict = {}
    pca = pca.copy()
    vd = vd.copy()
    for df in (pca, vd):
        df["_sd"] = pd.to_numeric(df["pc11_subdistrict_id"], errors="coerce")
        df["_dt"] = pd.to_numeric(df["pc11_district_id"], errors="coerce")

    pca_cols = [
        "pc11_pca_tot_p", "pc11_pca_tot_m", "pc11_pca_tot_f", "pc11_pca_no_hh",
        "pc11_pca_p_06", "pc11_pca_p_sc", "pc11_pca_p_st", "pc11_pca_p_lit",
        "pc11_pca_tot_work_p", "pc11_pca_mainwork_p", "pc11_pca_margwork_p",
        "pc11_pca_main_cl_p", "pc11_pca_main_al_p", "pc11_pca_main_hh_p",
        "pc11_pca_main_ot_p", "pc11_pca_marg_cl_p", "pc11_pca_marg_al_p",
        "pc11_pca_marg_hh_p",
    ]
    vd_cols = [
        "pc11_vd_ph_cntr_doc_tot", "pc11_vd_ph_cntr_doc_pos", "pc11_vd_all_hosp",
        "pc11_vd_p_sch_gov", "pc11_vd_m_sch_gov", "pc11_vd_s_sch_gov",
    ]

    a = pd.DataFrame({c: col(pca, c) for c in pca_cols})
    a["_sd"], a["_dt"] = pca["_sd"], pca["_dt"]

    # Which districts each sub-district lies in, before the code is collapsed.
    # Recorded rather than inferred later: once the values are grouped by code
    # there is nothing left to say that Gossaigaon is in two districts.
    parents: dict[int, list[int]] = {}
    pairs = a[["_sd", "_dt"]].dropna()
    for sd_code, dt_code in zip(pairs["_sd"], pairs["_dt"]):
        sd_code, dt_code = int(sd_code), int(dt_code)
        if sd_code == NO_SUBDISTRICT:
            continue
        seen = parents.setdefault(sd_code, [])
        if dt_code not in seen:
            seen.append(dt_code)
    for code in parents:
        parents[code].sort()

    a = a[a["_sd"] != NO_SUBDISTRICT]
    ag = a.drop(columns=["_dt"]).groupby("_sd", dropna=True).sum()

    b = pd.DataFrame({c: col(vd, c) for c in vd_cols})
    b["_sd"] = vd["_sd"]
    b = b[b["_sd"] != NO_SUBDISTRICT]
    bg = b.groupby("_sd", dropna=True).sum()

    merged = ag.join(bg, how="left")
    if secc is not None:
        s = secc.copy()
        s["_sd"] = pd.to_numeric(s["pc11_subdistrict_id"], errors="coerce")
        s = s[s["_sd"] != NO_SUBDISTRICT]
        merged = merged.join(secc_weighted(s, "_sd"), how="left")
    notes["subdistricts"] = int(len(merged))
    notes["straddling_district_boundaries"] = int(
        sum(1 for v in parents.values() if len(v) > 1))
    notes["sentinel_rows_dropped"] = int((pca["_sd"] == NO_SUBDISTRICT).sum())
    notes["districts_with_no_subdistrict"] = int(
        pca.loc[pca["_sd"] == NO_SUBDISTRICT, "_dt"].nunique())
    return merged, parents, notes


def raw_number(v) -> float | None:
    """A source cell as a float, or None when it is missing.

    NaN is missing. It arrives from the left join for districts with no Village
    Directory rows, and it must not be coerced to 0.0 either - "no data" and
    "none of them" are different facts and the whole registry is built on
    keeping them apart.
    """
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def compute_values(row: pd.Series) -> dict[str, float | None]:
    """Compute every registry measure for one district.

    Missing is not zero. A district with no Village Directory rows has no
    infrastructure data; reporting 0 hospitals there would assert something
    false. Those measures return None and the interface renders "not recorded".
    """
    def g(c: str) -> float:
        """PCA value. The PCA join is inner, so these are always present."""
        v = row.get(c)
        return 0.0 if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)

    def gvd(c: str) -> float | None:
        """Village Directory value, or None where the district has no VD rows."""
        v = row.get(c)
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return None
        return float(v)

    def cnt(v: float | None) -> int | None:
        return None if v is None else int(v)

    tot_p = g("pc11_pca_tot_p")
    p06 = g("pc11_pca_p_06")
    workers = g("pc11_pca_tot_work_p")
    doc_tot = gvd("pc11_vd_ph_cntr_doc_tot")
    doc_pos = gvd("pc11_vd_ph_cntr_doc_pos")
    age7 = tot_p - p06

    land = (g("pc11_pca_main_cl_p") + g("pc11_pca_main_al_p")
            + g("pc11_pca_marg_cl_p") + g("pc11_pca_marg_al_p"))
    cultiv = g("pc11_pca_main_cl_p") + g("pc11_pca_marg_cl_p")
    aglab = g("pc11_pca_main_al_p") + g("pc11_pca_marg_al_p")
    hhind = g("pc11_pca_main_hh_p") + g("pc11_pca_marg_hh_p")

    pct = lambda n, d: rnd(safe_div(100.0 * n, d))  # noqa: E731

    def secc_rate(share_col: str) -> float | None:
        """A SECC household share, weighted; None where no household reported."""
        n = gvd(f"secc_n__{share_col}")
        d = gvd(f"secc_d__{share_col}")
        if n is None or d is None or d <= 0:
            return None
        return pct(n, d)

    return {
        "pop.total": int(tot_p),
        "pop.households": int(g("pc11_pca_no_hh")),
        "pop.age7plus": int(age7),
        "pop.avg_household_size": rnd(safe_div(tot_p, g("pc11_pca_no_hh"))),
        "pop.st_share": pct(g("pc11_pca_p_st"), tot_p),
        "pop.sc_share": pct(g("pc11_pca_p_sc"), tot_p),
        "pop.child_share": pct(p06, tot_p),
        "pop.literacy_rate": pct(g("pc11_pca_p_lit"), age7),
        "pop.sex_ratio": rnd(safe_div(1000.0 * g("pc11_pca_tot_f"), g("pc11_pca_tot_m")), 1),
        "work.total_workers": int(workers),
        "work.participation_rate": pct(workers, tot_p),
        "work.land_dependent_share": pct(land, workers),
        "work.cultivator_share": pct(cultiv, workers),
        "work.ag_labourer_share": pct(aglab, workers),
        "work.marginal_share": pct(g("pc11_pca_margwork_p"), workers),
        "work.household_industry_share": pct(hhind, workers),
        "infra.phc_doctors_sanctioned": cnt(doc_tot),
        "infra.phc_doctors_in_post": cnt(doc_pos),
        # Undefined where no posts are sanctioned, and where the source reports
        # MORE doctors in post than sanctioned. The latter happens in 21
        # districts and is a source inconsistency, not a staffing surplus - a
        # vacancy of -466% is not a statement about anything. Both raw counts
        # are still published so a reader can see the inconsistency directly.
        "infra.phc_doctor_vacancy_rate": (
            pct(doc_tot - doc_pos, doc_tot)
            if doc_tot is not None and doc_pos is not None
            and doc_tot > 0 and doc_pos <= doc_tot
            else None
        ),
        "infra.hospitals": cnt(gvd("pc11_vd_all_hosp")),
        "infra.primary_schools_gov": cnt(gvd("pc11_vd_p_sch_gov")),
        "infra.middle_schools_gov": cnt(gvd("pc11_vd_m_sch_gov")),
        "infra.secondary_schools_gov": cnt(gvd("pc11_vd_s_sch_gov")),
        "secc.households": cnt(gvd("secc_hh")),
        **{key: secc_rate(share_col) for key, share_col in SECC_SHARES.items()},
    }


def suppress_state_wide_zeros(districts: dict[int, dict]) -> list[dict]:
    """Null out count measures that are zero across an ENTIRE state.

    Gujarat reports 0 government middle schools in all 26 of its districts while
    reporting 1,217 government primary schools in Jamnagar alone. That is not an
    absence of provision: Gujarat's primary schools run to standard 8, so the
    Village Directory has no separate middle-school category for the state.

    Rendering 0 there would assert something false - that the schools do not
    exist. A measure uniformly zero across every district of a state, while
    substantial nationally, is describing a reporting convention rather than the
    world, so the value becomes null and the reason is recorded.

    Applies to counts only. A rate that is genuinely zero everywhere in a state
    is a different kind of claim and is left alone.
    """
    suppressed: list[dict] = []
    by_state: dict[str, list[dict]] = {}
    for d in districts.values():
        by_state.setdefault(d["state_name"], []).append(d)

    for key, spec in MEASURES.items():
        if spec["kind"] != "count" or spec.get("internal"):
            continue
        national = sum((d["values"].get(key) or 0) for d in districts.values())
        if national <= 0:
            continue
        for state, rows in by_state.items():
            if len(rows) < 2:
                continue  # a single-district state proves nothing
            present = [r for r in rows if r["values"].get(key) is not None]
            if not present or any((r["values"][key] or 0) > 0 for r in present):
                continue
            for r in present:
                r["values"][key] = None
            suppressed.append({
                "measure": key, "state": state, "districts": len(present),
                "reason": "zero in every district of this state while substantial "
                          "nationally; a reporting-convention artefact, not an "
                          "absence of provision",
            })
    return suppressed


def compute_benchmarks(districts: dict[int, dict],
                       suppressed: list[dict] | None = None) -> dict:
    """National and per-state benchmarks, computed from the SAME expressions.

    Benchmarks are recomputed from summed inputs rather than averaged from the
    district values. Averaging a set of rates gives a different and wrong
    answer, because each district's rate has a different denominator.
    """
    def agg(rows: list[dict]) -> dict[str, float | None]:
        tot = {}
        for r in rows:
            for k, v in r["_raw"].items():
                if v is None:
                    continue          # missing contributes nothing, not zero
                tot[k] = tot.get(k, 0.0) + v
        return compute_values(pd.Series(tot))

    def reporting(rows: list[dict]) -> dict[str, int]:
        """How many of these districts carry a value for each measure.

        Published because a benchmark summed over 534 of 640 districts is not
        the same statement as one summed over all of them, and a reader
        comparing a district to "India" is entitled to know which it is.
        """
        out: dict[str, int] = {}
        for key in MEASURES:
            if MEASURES[key].get("internal"):
                continue
            out[key] = sum(1 for r in rows
                           if (r["values"].get(key) is not None))
        return out

    national = agg(list(districts.values()))
    by_state: dict[str, dict] = {}
    states: dict[str, list[dict]] = {}
    for d in districts.values():
        states.setdefault(d["state_name"], []).append(d)
    for st, rows in states.items():
        by_state[st] = agg(rows)

    # A measure withheld across a whole state must not come back as that
    # state's benchmark. `suppress_state_wide_zeros` nulls the district values
    # because publishing 0 "would assert something false"; the aggregate is
    # computed from `_raw`, which it does not touch, so Bihar published
    # `infra.hospitals = 0` as a state benchmark while all 38 of its districts
    # said "not recorded". Two published files contradicting each other on the
    # same measure, and the confident-looking one was the wrong one.
    for entry in suppressed or []:
        st, key = entry.get("state"), entry.get("measure")
        if st in by_state and key in by_state[st]:
            by_state[st][key] = None

    return {
        "india": national,
        "byState": by_state,
        "districtsReporting": {
            "india": reporting(list(districts.values())),
            "byState": {st: reporting(rows) for st, rows in states.items()},
            "districtsTotal": len(districts),
        },
        # The formula each benchmark was computed with, recorded HERE, where
        # the benchmark is computed - by the same compute_values() that makes
        # every district value. The interface compares it with the value's own
        # registry formula and draws a comparison only when they match, so
        # `sameDefinition` is a comparison actually made rather than a
        # constant. check_published asserts these equal the registry.
        "definitions": {key: MEASURES[key]["formula"] for key in national
                        if key in MEASURES and not MEASURES[key].get("internal")},
    }


# ═════════════════════════════════════════════════════════════════════════
# VERIFICATION
# ═════════════════════════════════════════════════════════════════════════
def describe_violation(v) -> str:
    """One line for a violation, whichever shape it arrived in.

    check_invariants() returns plain strings; the gates added later append
    dicts. The failure path used to assume dicts, so the only class of
    violation this function actually emits printed a traceback instead of its
    reason - on the one code path whose entire job is to say what went wrong.
    """
    if isinstance(v, dict):
        return f"{v.get('invariant')}: {str(v.get('detail'))[:150]}"
    return str(v)[:200]


def published_vocabulary_problem() -> str | None:
    """Why the published index.json cannot be used to preserve positions.

    Checked on its own rather than as a side effect of building the shards.
    The first version of this gate read a dict that stable_vocabulary() fills
    - and the gate ran 124 lines BEFORE the only call to it, so it always saw
    an empty dict and could never fire. A guard whose trigger runs after the
    check is not a guard; it is a comment.

    Absent is fine and means sorted order, because there are no positions to
    preserve. Present-but-unreadable is not: shard `sector` and `status` ARE
    positions in these arrays, so publishing against a vocabulary whose order
    could not be recovered silently changes what every existing row means.
    """
    path = OUT_DIR / "index.json"
    if not path.exists():
        return None
    try:
        idx = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return (f"index.json exists but could not be parsed "
                f"({type(exc).__name__}), so the positions every published "
                f"shard indexes into cannot be recovered")
    if not isinstance(idx, dict):
        return f"index.json is a {type(idx).__name__}, not an object"
    for key in ("sectors", "statuses"):
        raw = idx.get(key)
        if raw is None:
            return (f"index.json does not publish {key!r}, so the positions "
                    f"already-published shards use for it are unknown")
        if not isinstance(raw, list) or any(not isinstance(v, str) for v in raw):
            return (f"index.json publishes {key!r} with non-string entries; "
                    f"dropping them would close the gaps and shift every "
                    f"position after them")
        if len(set(raw)) != len(raw):
            return (f"index.json publishes {key!r} with duplicates, so a "
                    f"position does not identify a value")
    return None


def stable_vocabulary(key: str, present: set[str]) -> list[str]:
    """The published order for `key`, extended with anything new.

    Read from what is PUBLISHED, not from what this build is writing, for the
    same reason the register floor is: a build to a scratch directory must
    inherit the real positions or it would renumber everything and report a
    change that is an artefact of where it was told to write.

    A fresh clone with nothing published falls back to sorted order, which is
    correct and self-consistent - the array travels with the shards that index
    into it, so a reader is never wrong either way. What it is not is stable
    against the NEXT build, and that is the whole point of preferring the
    published order when there is one.
    """
    prior: list[str] = []
    try:
        idx = json.loads((OUT_DIR / "index.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        idx = None
    if isinstance(idx, dict) and idx.get(key) is not None:
        raw = idx.get(key)
        if not isinstance(raw, list) or any(not isinstance(v, str) for v in raw):
            # Present and unusable. Filtering the bad entries out would close
            # the gaps and shift every position after them, silently changing
            # what every already-published shard row means.
            UNREADABLE_VOCABULARY[key] = (
                f"index.json publishes {key!r} as "
                f"{type(raw).__name__} containing "
                f"{sorted({type(v).__name__ for v in raw}) if isinstance(raw, list) else 'n/a'}"
                f"; positions cannot be preserved from it")
            return sorted(present)
        if len(set(raw)) != len(raw):
            UNREADABLE_VOCABULARY[key] = (
                f"index.json publishes {key!r} with duplicate entries, so a "
                f"position does not identify a value")
            return sorted(present)
        prior = raw
    seen = set(prior)
    return prior + sorted(v for v in present if v not in seen)


def check_invariants(districts: dict[int, dict], benchmarks: dict) -> list[str]:
    """Every violation is a build failure, not a warning."""
    violations: list[str] = []

    for code, d in districts.items():
        for key, val in d["values"].items():
            spec = MEASURES.get(key)
            if spec is None:
                violations.append(f"district {code}: value '{key}' has no registry entry")
                continue
            lo_hi = spec.get("range")
            if lo_hi and val is not None:
                lo, hi = lo_hi
                if not (lo <= val <= hi):
                    violations.append(
                        f"district {code} ({d['district_name']}): {key} = {val} "
                        f"outside declared range [{lo}, {hi}]")
            if val is not None and isinstance(val, float) and not math.isfinite(val):
                violations.append(f"district {code}: {key} is not finite")

    # every rate must name a denominator that exists in the registry
    for key, spec in MEASURES.items():
        if spec["kind"] == "rate":
            dk = spec.get("denominator_key")
            if not dk:
                violations.append(f"measure '{key}' is a rate with no denominator_key")
            elif dk not in MEASURES:
                violations.append(f"measure '{key}' denominator '{dk}' not in registry")

    # composition identity: the parts of the worker split cannot exceed the whole
    for code, d in districts.items():
        v = d["values"]
        parts = (v.get("work.cultivator_share") or 0) + (v.get("work.ag_labourer_share") or 0)
        land = v.get("work.land_dependent_share")
        if land is not None and abs(parts - land) > 0.05:
            violations.append(
                f"district {code}: cultivator+ag_labourer ({parts:.2f}) != "
                f"land_dependent ({land:.2f})")

    nat = benchmarks["india"]
    if nat["pop.total"] < 1_150_000_000 or nat["pop.total"] > 1_250_000_000:
        violations.append(
            f"national population {nat['pop.total']:,} implausible for Census 2011")
    return violations


def _parse_iso(value: object):
    if not isinstance(value, str):
        return None
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def source_fetched_at() -> dict:
    """When each cached source was really last read, not when the build ran.

    A rebuild from cache is the normal case - the engineering reference documents it - so
    stamping every source with the build's own start time asserts a fetch that
    did not happen, and the drift grows for as long as the cache is reused.
    The register's own fetch stamp is written by fetch_sources(); everything
    else is dated by the modification time of the file the build actually read.
    """
    def mtime(*parts) -> str | None:
        f = CACHE.joinpath(*parts)
        if not f.exists():
            return None
        return datetime.fromtimestamp(f.stat().st_mtime,
                                      tz=timezone.utc).isoformat()

    stamps = {}
    sp = CACHE / "fetch_stamps.json"
    if sp.exists():
        try:
            stamps = json.loads(sp.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            stamps = {}

    # Whichever is LATER. A stamp older than the file it describes is a stamp
    # from a previous fetch that a later write has overtaken, and preferring it
    # would assert a read that is older than the data on disk.
    def later(*values):
        got = [v for v in values if v]
        return max(got) if got else None

    return {
        "register": later(stamps.get("fetched_at"),
                          mtime("parivesh", "all_records.json")),
        "caf": mtime("caf", "caf_extract.jsonl"),
        "history": mtime("history", "history.jsonl"),
        "boundaries": mtime("geo", "2011_Dist.shp"),
        "shrug": mtime("shrug", SHRUG_FILES["pca"][0]),
    }


def _corroboration_pct(test_counts: dict):
    """Agreement over the verdicts that could decide it, or None if none could.

    Two verdicts are excluded from BOTH sides rather than counted against
    corroboration, because neither is a disagreement:

      boundary  defined as the case the mapped line cannot decide. Charging it
                against agreement would contradict its own definition.
      offshore  the boundary file is land only, so a port or an offshore block
                lands outside every polygon. That describes the site; it says
                nothing about whether the filing named the right district.
      unmapped  the boundary source does not map this ground at all. It is a
                statement about the reference data, so charging it either way
                would put our own gap in the proponent's mouth.

    With no decidable verdict at all the answer is not nought per cent, it is
    that nothing was measured, and it is returned as such.
    """
    inside = test_counts.get("inside", 0)
    against = test_counts.get("elsewhere", 0)
    total = inside + against
    return round(100 * inside / total, 2) if total else None


def resample_check(districts: dict[int, dict], pca: pd.DataFrame, n: int = 12) -> list[dict]:
    """Independently re-derive a sample of facts straight from the source rows.

    Deliberately does NOT reuse compute_values: it recomputes from the raw
    sub-district frame so an error in the aggregation path is caught rather
    than reproduced.
    """
    out = []
    codes = sorted(districts)[:: max(1, len(districts) // n)][:n]
    pca = pca.copy()
    pca["_code"] = pd.to_numeric(pca["pc11_district_id"], errors="coerce")
    for code in codes:
        sub = pca[pca["_code"] == code]
        tot_p = float(pd.to_numeric(sub["pc11_pca_tot_p"], errors="coerce").sum())
        st = float(pd.to_numeric(sub["pc11_pca_p_st"], errors="coerce").sum())
        lit = float(pd.to_numeric(sub["pc11_pca_p_lit"], errors="coerce").sum())
        p06 = float(pd.to_numeric(sub["pc11_pca_p_06"], errors="coerce").sum())
        expect_st = rnd(safe_div(100.0 * st, tot_p))
        expect_lit = rnd(safe_div(100.0 * lit, tot_p - p06))
        got = districts[code]["values"]
        out.append({
            "censuscode": int(code),
            "district": districts[code]["district_name"],
            "subdistricts_used": int(len(sub)),
            "pop.total": {"expected": int(tot_p), "got": got["pop.total"],
                          "pass": int(tot_p) == got["pop.total"]},
            "pop.st_share": {"expected": expect_st, "got": got["pop.st_share"],
                             "pass": expect_st == got["pop.st_share"]},
            "pop.literacy_rate": {"expected": expect_lit, "got": got["pop.literacy_rate"],
                                  "pass": expect_lit == got["pop.literacy_rate"]},
        })
    return out


# ═════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fetch", action="store_true", help="download sources first")
    ap.add_argument("--since", help="delta fetch from YYYY-MM-DD (with --fetch)")
    ap.add_argument("--out", help="write the built data here instead of "
                                  "public/data/instruments/consent. The "
                                  "register floor still compares against what "
                                  "is published, so a trial build cannot pass "
                                  "by having nothing to be measured against.")
    args = ap.parse_args()
    if args.out:
        global WRITE_DIR, REPORT_PATH
        WRITE_DIR = Path(args.out).resolve()
        REPORT_PATH = WRITE_DIR.with_name(WRITE_DIR.name + ".verification_report.json")
        log(f"writing to {WRITE_DIR}")
        log(f"register floor still measured against {OUT_DIR}")

    started = datetime.now(timezone.utc)
    report: dict = {
        "generated_at": started.isoformat(),
        "pipeline": "scripts/instruments/build_data.py",
    }

    if args.fetch:
        import run_lock
        run_lock.hold_or_exit("build_data --fetch")  # one run against PARIVESH at a time
        report["fetch"] = fetch_sources(args.since)

    log("\n[1/6] loading sources")
    gaz = Gazetteer(CACHE / "geo" / "2011_Dist.dbf")
    log(f"  gazetteer: {len(gaz.rows)} districts "
        f"({gaz.dropped_placeholders} placeholder row dropped)")
    records, reg_notes = load_register()
    pca, vd, secc = load_shrug()
    loc_index = LocationIndex(CACHE / "shrug" / SHRUG_FILES["loc_names"][0],
                              CACHE / "lgd" / "getdistricts.json",
                              census_codes={int(r["censuscode"]) for r in gaz.rows})
    log(f"  location index: {loc_index.stats()}")
    loc_names_for_subdistrict = loc_index.subdistrict_name

    log("  appraisal history")
    # Reduced as it is read. Holding every step of every proposal costs about
    # half a gigabyte at full register size and is never needed twice.
    status_by_id = {r.get("id"): (r.get("proposalStatus") or "").strip()
                    for r in records if r.get("id") is not None}
    # Pending time is measured to the moment the register was READ, not the
    # moment this build ran. Rebuilding from cache is the ordinary case, so
    # using the build clock would inflate every open proposal by the age of
    # the cache - the same defect source_fetched_at() exists to prevent.
    read_at = _parse_iso(source_fetched_at().get("register")) or started
    # Tolerated on the same terms as the register's own vocabulary rather than
    # at zero. The history covers every proposal ever filed, including the 22%
    # this build excludes and never publishes; halting the whole run because
    # one label appeared on one of those would stop publication over a record
    # no reader will ever see.
    appraisal_by_id, history_unclassified, total_history_steps = AP.summarise_all(
        CACHE, status_by_id, as_of=read_at)
    log(f"    {len(appraisal_by_id):,} proposals with a usable appraisal history")
    log("  district geometry")
    # Read from the same datameet file the gazetteer comes from, so censuscode
    # identifies a district in the geometry and in the population tables by
    # construction. See geometry.py for why the site's own topojson cannot be
    # substituted here.
    dgeo = DistrictGeometry(CACHE / "geo" / "2011_Dist.shp",
                            CACHE / "geo" / "2011_Dist.dbf")
    unusable = dgeo.usable()
    if unusable:
        sys.exit(f"ERROR: district boundaries are unusable - {unusable}. "
                 f"Nothing was written; the published data is unchanged.")
    gstats = dgeo.stats()
    log(f"    {gstats['districts_with_geometry']:,} district polygons "
        f"from {gstats['source']}")
    if gstats["duplicate_codes"]:
        log(f"    WARNING: repeated census codes {gstats['duplicate_codes']}")

    log("\n[2/6] aggregating sub-district to district")
    agg, agg_notes = aggregate_to_district(pca, vd, secc)
    log(f"  {agg_notes['pca_subdistricts']:,} PCA subdistricts -> "
        f"{agg_notes['districts_after_join']} districts")

    districts: dict[int, dict] = {}
    unmatched_codes: list[int] = []
    for code, row in agg.iterrows():
        if pd.isna(code):
            continue
        code = int(code)
        geo = gaz.by_code.get(code)
        if geo is None:
            unmatched_codes.append(code)
            continue
        districts[code] = {
            "censuscode": code,
            "district_name": geo["DISTRICT"],
            "state_name": geo["ST_NM"],
            "values": compute_values(row),
            # NOT `float(row.get(k) or 0.0)`. NaN is TRUTHY, so that expression
            # returns NaN unchanged for the 10 fully-urban districts with no
            # Village Directory rows - and one NaN in a sum makes the sum NaN
            # for ever. Every one of the seven infra.* NATIONAL benchmarks was
            # published as null because of it, while 534 to 630 districts held
            # real values summing to 6,101 hospitals and 291,777 government
            # middle schools. Missing has to be missing, so the aggregator can
            # skip it.
            "_raw": {k: raw_number(row.get(k)) for k in agg.columns},
        }
    log(f"  {len(districts)} districts matched to the gazetteer, "
        f"{len(unmatched_codes)} SHRUG codes unmatched")

    sd_agg, sd_parents, sd_notes = aggregate_to_subdistrict(pca, vd, secc)
    subdistricts: dict[int, dict] = {}
    for sd_code, row in sd_agg.iterrows():
        if pd.isna(sd_code):
            continue
        sd_code = int(sd_code)
        # The village index first, because it is the only source that can see
        # a tehsil straddling a district boundary; the PCA pair is the
        # fallback for the 47 fully-urban sub-districts that have no villages
        # and so do not appear in a village-level file at all.
        parents = [int(d) for d in
                   loc_index.subdistrict_districts.get(str(sd_code).zfill(5), [])]
        for dt in sd_parents.get(sd_code) or []:
            if dt not in parents:
                parents.append(dt)
        parents.sort()
        # `district` stays the first parent so every existing reader keeps
        # working; `districts` carries all of them, which is the honest answer
        # for a tehsil that straddles a boundary and the only one that lets a
        # reader see that it does.
        dt_code = parents[0] if parents else None
        geo = gaz.by_code.get(dt_code) if dt_code is not None else None
        subdistricts[sd_code] = {
            "code": sd_code,
            "district": dt_code,
            "districts": parents,
            "name": loc_names_for_subdistrict.get(str(sd_code).zfill(5)),
            "district_name": geo["DISTRICT"] if geo else None,
            "state_name": geo["ST_NM"] if geo else None,
            "values": compute_values(row),
        }
    log(f"  {len(subdistricts):,} sub-districts aggregated")

    suppressed = suppress_state_wide_zeros(districts)
    if suppressed:
        log(f"  suppressed {len(suppressed)} state-wide zero measure(s): "
            + ", ".join(sorted({m + " in " + st for m, st in
                                 ((x["measure"], x["state"]) for x in suppressed)})[:4])
            + (" ..." if len(suppressed) > 4 else ""))

    log("\n[3/6] computing benchmarks")
    benchmarks = compute_benchmarks(districts, suppressed)
    log(f"  national population: {benchmarks['india']['pop.total']:,}")
    log(f"  states: {len(benchmarks['byState'])}")

    log("\n[4/6] resolving proposal locations")
    caf_path = CACHE / "caf" / "caf_extract.jsonl"
    caf_by_id: dict[int, dict] = {}
    if caf_path.exists():
        with open(caf_path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    c = json.loads(line)
                except Exception:  # noqa: BLE001
                    continue
                caf_by_id[c["id"]] = c
        log(f"  CAF extracts available: {len(caf_by_id):,}")
    else:
        log("  WARNING: no CAF extract found. Falling back to project-name "
            "parsing only, which resolves about a third of the register. "
            "Run scripts/instruments/fetch_caf.py first.")

    # Attempts that came back with nothing. The fetcher records them rather
    # than dropping them, which is what makes "the source has no form for
    # this" a fact we hold instead of an absence we cannot interpret.
    #
    # Only an answer from the service counts. The ledger holds two unlike
    # things: an HTTP status, which is the service telling us it has nothing,
    # and -1, which is our own request failing before any answer arrived. The
    # second says nothing whatever about the source, so a proposal that only
    # ever failed in transport stays unread rather than being published as a
    # government gap - which would put our network trouble in the source's
    # mouth, the exact confusion this field exists to prevent.
    caf_absent: set[int] = set()
    err_path = CACHE / "caf" / "caf_errors.jsonl"
    if err_path.exists():
        with open(err_path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    e = json.loads(line)
                except Exception:  # noqa: BLE001
                    continue
                # Only the one status that means the service holds no form.
                # See SETTLED_STATUSES in fetch_caf.py. A 403 is our address
                # being refused and a 404 with an HTML body is a proxy's error
                # page; publishing either as "the regulator serves no form"
                # states something about a government body that the government
                # never said. 163 proposals were published that way.
                if e.get("id") is None or e.get("status") != 500:
                    continue
                caf_absent.add(int(e["id"]))
        caf_absent -= set(caf_by_id)      # a later retry succeeded
        if caf_absent:
            log(f"  CAF served no form for {len(caf_absent):,} proposals")

    resolution = {"method": {}, "confidence": {}, "by_sector": {}, "by_category": {},
                  "multi_district": 0, "with_subdistrict": 0, "with_village": 0,
                  "unresolved_by_form_status": {},
                  # the outcome of location.adjudicate() for every row it
                  # examined: kept | adjudicated | contested |
                  # town_by_coordinates | town_by_declaration | town_unsettled
                  "adjudication": {}, "adjudication_moves": []}
    by_state: dict[str, list[dict]] = {}
    lookup: dict[str, str] = {}
    excluded = 0
    unclassified_statuses: dict[str, int] = {}
    scrubbed_contacts = 0
    stale_site_extracts: set = set()
    # Three different questions, three different denominators, kept apart so
    # the published figures cannot be read as parts of one total.
    # Initialised, not accumulated from nothing: a counter that is absent from
    # the published report cannot be told apart from one that is zero, and the
    # difference is exactly "we did not measure this" versus "this never
    # happened".
    geo_stats: dict[str, dict] = {
        "coordinates": {"present": 0, "absent": 0,
                        "filed_but_all_discarded": 0, "multi_block": 0,
                        "blocks_rejected": 0, "all_blocks_rejected": 0,
                        "single_corner_blocks": 0, "untyped_blocks_skipped": 0,
                        "alternative_site_only": 0},
        "test": {}, "match": {}}
    appraisal_rows: list[dict] = []
    # Initialised so a state that never occurs reads as zero rather than as
    # unmeasured - the same distinction the field itself exists to draw.
    caf_coverage: dict[str, int] = {"ok": 0, "nogeo": 0, "none": 0, "pend": 0}
    t0 = time.time()
    for rec in records:
        status = (rec.get("proposalStatus") or "").strip()
        if status in EXCLUDED_STATUSES:
            excluded += 1
            continue

        caf = caf_by_id.get(rec.get("id"))
        loc = resolve_from_caf(caf, loc_index) if caf else None
        # Three unlike silences, told apart before either is filled in.
        if caf is not None:
            caf_cov = "ok" if loc is not None else "nogeo"
        elif rec.get("id") in caf_absent:
            caf_cov = "none"
        else:
            caf_cov = "pend"
        caf_coverage[caf_cov] = caf_coverage.get(caf_cov, 0) + 1
        if loc is None:
            # No CAF, or a CAF with no usable geography: fall back to the
            # project name, explicitly marked low confidence.
            loc = from_project_name(
                resolve_district(rec.get("projectName") or "",
                                 rec.get("state") or "", gaz))

        state_slug = slugify(rec.get("state") or "unknown")
        bucket = by_state.setdefault(state_slug, [])
        cert = (rec.get("certificate_url") or "")
        if cert.startswith(CERT_PREFIX):
            cert = cert[len(CERT_PREFIX):]
        auth = rec.get("issuing_authority") or ""
        others = caf or {}

        clean_name, n_hit = scrub_contact(rec.get("projectName"))
        clean_agency, a_hit = scrub_contact(rec.get("nameOfUserAgency"))
        if n_hit or a_hit:
            scrubbed_contacts += 1

        # The position, canonically. The raw string is kept in `status`; `sk`
        # is what every count and filter resolves through, so four spellings
        # of one stage cannot become four stages.
        status_key = ST.canonical(status)
        if status_key == "unclassified":
            unclassified_statuses[ST.normalise(status)] = (
                unclassified_statuses.get(ST.normalise(status), 0) + 1)

        # Where the site is. These are corner coordinates from the filed KML,
        # not an administrative code, so they can be tested against the
        # boundary of the district the proposal was filed under. That test is
        # the one statement about location the filing did not itself assert.
        site = raw_site = (others.get("site") or None)
        if site is not None and not site.get("blocks"):
            # Blocks were filed and every one was rejected as malformed. That
            # is a different fact from "no location was filed" and is counted
            # as such, including how many blocks were lost, rather than folded
            # into the count of filings that named no place at all.
            geo_stats["coordinates"]["all_blocks_rejected"] += 1
            geo_stats["coordinates"]["blocks_rejected"] += site.get("dropped") or 0
            geo_stats["coordinates"]["untyped_blocks_skipped"] += (
                site.get("untyped_skipped") or 0)
            site = None
        lat = lon = ext = geo_check = geo_district = None
        flags = []
        if raw_site:
            if raw_site.get("alt"):
                flags.append("alt")
            if raw_site.get("single_corner"):
                flags.append("1c")
            if raw_site.get("dropped"):
                flags.append("rej")
            if raw_site.get("untyped_skipped"):
                flags.append("unt")
            if raw_site.get("blocks") and max(
                    raw_site["n"] - raw_site["s"],
                    raw_site["e"] - raw_site["w"]) > WIDE_SITE_SPAN:
                flags.append("wide")
            if not raw_site.get("blocks"):
                # Every block this filing mapped was discarded. Without a flag
                # this publishes identically to a filing that mapped nothing,
                # which is a different thing entirely.
                flags.append("none")
            # The record's own version, not the absence of a key. site_extent
            # omits `pts` when every block was discarded, so the old test fired
            # on 354 current-reader rows and published them as `rej none old` -
            # asserting simultaneously that the discard counts were measured
            # exactly (`none`) and that they were never recorded (`old`). Both
            # cannot be true, and the `old` half also inflated the published
            # vintage figure with rows whose counts are precisely known.
            if int((caf or {}).get("v") or 1) < CAF_EXTRACT_VERSION:
                flags.append("old")
                stale_site_extracts.add(rec.get("id"))
        site_quality = " ".join(flags) or None
        if site:
            # Round first, then test the rounded point. A reader re-testing the
            # published coordinate must get the published answer.
            lat, lon = round(site["lat"], 4), round(site["lon"], 4)
            if (site["n"] - site["s"]) or (site["e"] - site["w"]):
                ext = [round(site["s"], 4), round(site["w"], 4),
                       round(site["n"], 4), round(site["e"], 4)]
            # Test every mapped block, not only one. The points tested are the
            # rounded ones, so a reader re-testing the published coordinate
            # gets the published answer.
            pts = [(round(a, 4), round(b, 4))
                   for a, b in (site.get("pts") or [(site["lat"], site["lon"])])]
            named = loc["districts"] or ([loc["primary_district"]]
                                         if loc["primary_district"] is not None else [])
            if named:
                geo_check, found, at = dgeo.test_points(named, pts)
            else:
                # There is nothing to test the coordinates against. That is a
                # gap in the filing, not a finding about the site, so no
                # verdict is published rather than one that reads like one.
                geo_check, at = None, (pts[0] if pts else None)
                found = [d for d in (dgeo.locate(a, b) for a, b in pts) if d]
                geo_stats["test"]["no_district_filed"] = (
                    geo_stats["test"].get("no_district_filed", 0) + 1)

            # The published coordinate is the block the verdict rests on, so
            # the point and the verdict beside it describe the same place. The
            # district published is the one that point falls in - not the
            # lowest-numbered of everywhere the project reaches.
            if at is not None:
                lat, lon = at
            geo_district = dgeo.locate(lat, lon)

            # The filing's three statements of place, reconciled. The codes
            # were preferred above because they are the most specific; here
            # the declared district and the coordinates may overrule them, but
            # only together. See location.adjudicate().
            before = list(loc.get("districts") or [])
            loc, adjudication = adjudicate(loc, geo_check, geo_district,
                                           loc_index, found)
            resolution["adjudication"][adjudication] = (
                resolution["adjudication"].get(adjudication, 0) + 1)
            if list(loc.get("districts") or []) != before:
                resolution["adjudication_moves"].append({
                    "no": rec.get("proposalNo"),
                    "from": loc["moved_from"],
                    "to": loc["primary_district"],
                    "outcome": adjudication})
                # Re-tested against where it now stands, so the verdict
                # published beside the district describes that district.
                named = loc["districts"]
                geo_check, found, at = dgeo.test_points(named, pts)
                if at is not None:
                    lat, lon = at
                geo_district = dgeo.locate(lat, lon)
            if named:
                geo_stats["test"][geo_check] = geo_stats["test"].get(geo_check, 0) + 1

            geo_stats["coordinates"]["blocks_rejected"] += site.get("dropped") or 0
            geo_stats["coordinates"]["untyped_blocks_skipped"] += (
                site.get("untyped_skipped") or 0)
            geo_stats["coordinates"]["single_corner_blocks"] += (
                site.get("single_corner") or 0)
            # A separate question with a separate denominator: does the district
            # the coordinates fall in match the district the codes name? A point
            # in no district at all is neither agreement nor disagreement, and
            # is counted as its own outcome rather than dropped.
            if loc["primary_district"] is None:
                geo_stats["match"]["no_district_filed"] = (
                    geo_stats["match"].get("no_district_filed", 0) + 1)
            elif geo_check == "boundary":
                # Undecidable by definition. Counted as its own outcome so it
                # is not silently folded into disagreement here while being
                # excluded from the corroboration rate two lines away.
                geo_stats["match"]["on_boundary"] = (
                    geo_stats["match"].get("on_boundary", 0) + 1)
            elif geo_district is None:
                geo_stats["match"]["located_nowhere"] = (
                    geo_stats["match"].get("located_nowhere", 0) + 1)
            elif any(f in (named or []) for f in found):
                geo_stats["match"]["agree"] = geo_stats["match"].get("agree", 0) + 1
            else:
                geo_stats["match"]["disagree"] = (
                    geo_stats["match"].get("disagree", 0) + 1)
        elif raw_site and not raw_site.get("blocks"):
            # Blocks were filed and every one was discarded as malformed. That
            # is not "no location was filed", and folding it into `absent` made
            # present + absent equal the register exactly - a partition that
            # looked clean while hiding 354 filings that did name a place.
            geo_stats["coordinates"]["filed_but_all_discarded"] += 1
        else:
            geo_stats["coordinates"]["absent"] += 1
        if site:
            geo_stats["coordinates"]["present"] += 1
            if site.get("alt"):
                geo_stats["coordinates"]["alternative_site_only"] += 1
            if (site.get("blocks") or 1) > 1:
                geo_stats["coordinates"]["multi_block"] += 1

        if not site:
            # No coordinates to test. A town code spanning districts can still
            # be settled by the declared district - or is published as
            # provisional, never as settled by load order.
            loc, adjudication = adjudicate(loc, None, None, loc_index, None)
            if adjudication != "kept":
                resolution["adjudication"][adjudication] = (
                    resolution["adjudication"].get(adjudication, 0) + 1)

        # Counted AFTER adjudication, so the published method breakdown is the
        # method each published row actually carries.
        m = loc["method"]
        resolution["method"][m] = resolution["method"].get(m, 0) + 1
        c = loc["confidence"] or "none"
        resolution["confidence"][c] = resolution["confidence"].get(c, 0) + 1
        if loc["multi_district"]:
            resolution["multi_district"] += 1
        if loc["subdistricts"]:
            resolution["with_subdistrict"] += 1
        if loc["villages"]:
            resolution["with_village"] += 1
        # WHOSE SILENCE EACH UNPLACED PROPOSAL IS.
        #
        # `caf_coverage` counts the whole register, and the methodology page
        # needs the same split over the UNPLACED subset - a different set. The
        # two differ a lot: 259 proposals register-wide have no form served,
        # but only 189 of those are unplaced, because a project name can still
        # resolve one. Reading the register-wide figure into a sentence about
        # the unplaced cohort overstated the Ministry's non-disclosure by 70,
        # which is the wrong direction to be wrong in.
        if m == "unresolved":
            resolution["unresolved_by_form_status"][caf_cov] = (
                resolution["unresolved_by_form_status"].get(caf_cov, 0) + 1)

        sec = rec.get("sector") or "?"
        cat = rec.get("category") or "?"
        for bucket_name, key in (("by_sector", sec), ("by_category", cat)):
            b = resolution[bucket_name].setdefault(key, {"total": 0, "resolved": 0})
            b["total"] += 1
            if loc["primary_district"] is not None:
                b["resolved"] += 1

        # How the application has moved.
        appraisal_row = appraisal_by_id.get(rec.get("id"))
        if appraisal_row:
            appraisal_rows.append({
                **appraisal_row,
                "sector": rec.get("sector") or None,
                "state": rec.get("state") or None,
                "authority": auth or None,
                "category": rec.get("category") or None,
            })

        bucket.append({
            "id": rec.get("proposal_id"),
            "rid": rec.get("id"),
            "no": rec.get("proposalNo"),
            "name": clean_name,
            "agency": clean_agency,
            "sector": rec.get("sector") or "",
            "cat": rec.get("category"),
            "status": status,
            "date": (rec.get("dateOfSubmission") or "")[:10],
            "auth": AUTHORITIES.index(auth) if auth in AUTHORITIES else None,
            "cert": cert,
            "dc": loc["primary_district"],
            "dall": loc["districts"] if loc["multi_district"] else None,
            "sd": loc["subdistricts"] or None,
            "nv": loc["village_count"] or None,
            "dm": RESOLUTION_CODES[loc["method"]],
            # Proponent-declared figures, straight from the CAF. Nulls stay null.
            "af": others.get("affected_families"),
            "df": others.get("displaced_families"),
            "rnr": others.get("rnr_involved"),
            "lit": others.get("litigation_pending"),
            "vio": others.get("violation_involved"),
            "land": (others.get("land") or {}).get("existing_total"),
            "forest": (others.get("land") or {}).get("existing_forest"),
            "sk": status_key,
            "lat": lat,
            "lon": lon,
            "ext": ext,
            "gk": geo_check,
            "gd": geo_district,
            "dtd": (appraisal_row or {}).get("days_to_decision"),
            "dpd": (appraisal_row or {}).get("days_pending"),
            "qr": (appraisal_row or {}).get("query_rounds"),
            "cst": (appraisal_row or {}).get("current_stage"),
            "fon": (appraisal_row or {}).get("filed_on"),
            "don": (appraisal_row or {}).get("decided_on"),
            "dsu": (appraisal_row or {}).get("days_suspended"),
            "nblk": (site or {}).get("blocks"),
            "sq": site_quality,
            "dd": loc.get("declared_district"),
            "upd": (rec.get("app_updated_on") or "")[:10] or None,
            "lk": compact_links(caf),
            "cf": caf_cov,
        })
        lookup[str(rec.get("proposal_id"))] = state_slug

    kept = sum(len(v) for v in by_state.values())
    resolved = kept - resolution["method"].get("unresolved", 0)
    log(f"  {kept:,} proposals kept, {excluded:,} excluded as "
        f"{'/'.join(sorted(EXCLUDED_STATUSES))}")
    log(f"  district resolved: {resolved:,} ({100*resolved/max(1,kept):.2f}%) "
        f"in {time.time()-t0:.1f}s")

    log("\n[5/6] checking invariants")
    violations = check_invariants(districts, benchmarks)

    # A mapping that points at a status that does not exist, or a status naming
    # a phase that does not exist, would otherwise ship.
    for problem in ST.self_check():
        violations.append({"invariant": "stage registry is internally consistent",
                           "detail": problem})

    # The appraisal history uses a wider vocabulary than the register, and its
    # statuses drive phase attribution and decision matching. An unrecognised
    # one lands in phase `other` and is counted as no query round, so it must
    # be gated on the same terms as the register's own.
    history_steps_seen = sum(history_unclassified.values())
    if history_steps_seen and history_steps_seen > (
            total_history_steps * ST.UNCLASSIFIED_LIMIT):
        violations.append({
            "invariant": "appraisal history vocabulary is fully defined",
            "detail": f"{history_steps_seen:,} of {total_history_steps:,} "
                      f"recorded steps carry a status stages.py does not "
                      f"define ({100*history_steps_seen/max(1,total_history_steps):.2f}%, "
                      f"limit {100*ST.UNCLASSIFIED_LIMIT:.2f}%)",
            "statuses": dict(sorted(history_unclassified.items(),
                                    key=lambda kv: -kv[1])[:20]),
        })

    # A build that publishes a fraction of what is already published has not
    # found that the register shrank - it has failed to read it. An outage
    # during a cold-cache fetch leaves no sector files at all, and the merge
    # then writes an empty register over the good one without erroring. Left
    # ungated, that publishes cleanly and passes every other check.
    published_total = sum(len(v) for v in by_state.values())
    prior_meta = OUT_DIR / "meta.json"
    if prior_meta.exists():
        was = None
        try:
            prior = json.loads(prior_meta.read_text(encoding="utf-8"))
            was = int(((prior.get("counts") or {}).get("proposals_published")) or 0)
        except Exception as exc:  # noqa: BLE001
            violations.append({
                "invariant": "the previously published count is readable",
                "detail": f"meta.json exists but its published count could not "
                          f"be read ({type(exc).__name__}), so the register "
                          f"floor cannot be applied. An unreadable reference "
                          f"disables the guard, which is the moment it is most "
                          f"needed - so this fails rather than proceeds.",
            })
        if was is not None and not was:
            violations.append({
                "invariant": "the previously published count is readable",
                "detail": "meta.json exists but records no published count, so "
                          "the register floor has nothing to compare against.",
            })
        # The high-water mark, not the last run's figure. Comparing against
        # what the previous run happened to publish lets a sustained partial
        # source walk the register down a fifth a night indefinitely, each
        # step inside the floor and none of them tripping it.
        if was:
            high = int((prior.get("counts") or {}).get(
                "proposals_published_high_water") or was)
            reference = max(was, high)
            if published_total < reference * REGISTER_FLOOR:
                violations.append({
                    "invariant": "the register has not collapsed",
                    "detail": f"this build would publish {published_total:,} "
                              f"proposals against a high-water mark of "
                              f"{reference:,} ({100*published_total/reference:.1f}%). "
                              f"Below {100*REGISTER_FLOOR:.0f}% this is treated "
                              f"as a failure to read the source, not as a real "
                              f"fall. Re-run when the source is reachable, or "
                              f"reset the mark deliberately if the register "
                              f"genuinely shrank.",
                })

    # A build that did not read the application forms is not a degraded build,
    # it is a different product: it places a third of the register from
    # project names. It used to pass every invariant here with 0 violations,
    # because the read-rate floor below only engages once 1,000 forms have
    # been read and a cold cache reads none. The unread share is bounded
    # directly. The daily cohort not yet read is a few hundred proposals.
    unread = caf_coverage["pend"]
    total_rows = sum(caf_coverage.values())
    if total_rows and unread > total_rows * UNREAD_CEILING:
        violations.append({
            "invariant": "the application forms were read",
            "detail": f"{unread:,} of {total_rows:,} proposals "
                      f"({100*unread/total_rows:.1f}%) have no application "
                      f"form read, against a ceiling of "
                      f"{100*UNREAD_CEILING:.0f}%. The form cache is missing "
                      f"or stale; restore it (cache_seed.py unpack) or run "
                      f"fetch_caf.py before building.",
        })

    read_cohort = caf_coverage["ok"] + caf_coverage["nogeo"]
    if read_cohort >= 1000:      # too few to mean anything before that
        placed_rate = caf_coverage["ok"] / read_cohort
        if placed_rate < READ_RESOLUTION_FLOOR:
            violations.append({
                "invariant": "forms we read can still be placed",
                "detail": f"of {read_cohort:,} proposals whose application "
                          f"form was read, only {caf_coverage['ok']:,} "
                          f"({100*placed_rate:.2f}%) could be placed, against "
                          f"a floor of {100*READ_RESOLUTION_FLOOR:.0f}%. This "
                          f"figure does not move with backfill progress, so a "
                          f"fall is the form, the village index or the "
                          f"resolver breaking - not a partly-fetched register.",
            })

    vocab_problem = published_vocabulary_problem()
    if vocab_problem:
        violations.append({
            "invariant": "the published shard vocabulary can be read exactly",
            "detail": vocab_problem
            + ". Shard `sector` and `status` are POSITIONS in these arrays, so "
              "publishing against a vocabulary whose order could not be "
              "preserved silently changes what every already-published row "
              "means. Fix index.json, or delete it to rebuild the vocabulary "
              "from scratch, and re-run.",
        })

    if MISSING_SOURCE_COLUMNS:
        violations.append({
            "invariant": "every source column this build reads exists",
            "detail": f"{len(MISSING_SOURCE_COLUMNS)} column(s) named by the "
                      f"pipeline are absent from the source tables and were "
                      f"read as zero: "
                      f"{', '.join(sorted(MISSING_SOURCE_COLUMNS))}. Zero is a "
                      f"valid count, so every district would publish a "
                      f"plausible figure and no range check, benchmark or "
                      f"published-data assertion would notice. Re-check the "
                      f"source vintage: SHRUG renames columns between "
                      f"releases.",
            "columns": sorted(MISSING_SOURCE_COLUMNS),
        })

    unclassified_total = sum(unclassified_statuses.values())
    if published_total and unclassified_total / published_total > ST.UNCLASSIFIED_LIMIT:
        violations.append({
            "invariant": "status vocabulary is fully defined",
            "detail": f"{unclassified_total:,} of {published_total:,} published "
                      f"proposals carry a status stages.py does not define "
                      f"({100*unclassified_total/published_total:.2f}%, limit "
                      f"{100*ST.UNCLASSIFIED_LIMIT:.2f}%)",
            "statuses": dict(sorted(unclassified_statuses.items(),
                                    key=lambda kv: -kv[1])[:20]),
        })
    samples = resample_check(districts, pca)
    failed_samples = [s for s in samples
                      if not all(s[k]["pass"] for k in
                                 ("pop.total", "pop.st_share", "pop.literacy_rate"))]
    log(f"  invariant violations: {len(violations)}")
    log(f"  re-derivation samples: {len(samples)}, failed: {len(failed_samples)}")

    # Stop here, before anything is written. The engineering reference requires that a build
    # failing its own checks emits nothing rather than emitting a dataset and
    # then reporting the failure - a reader who finds fresh files has no way
    # to know the run that produced them did not pass.
    if violations or failed_samples:
        REPORT_PATH.write_text(
            json.dumps({**report,
                        "status": "FAILED",
                        "published": False,
                        "invariant_violations": violations,
                        "resample_check": samples,
                        "note": "No output was written. The previously "
                                "published data is unchanged."},
                       indent=2, ensure_ascii=False), encoding="utf-8")
        log(f"\nBUILD FAILED: {len(violations)} invariant violation(s), "
            f"{len(failed_samples)} re-derivation failure(s). Nothing was "
            f"written; the published data is unchanged.")
        for v in violations[:8]:
            log(f"    - {describe_violation(v)}")
        sys.exit(1)

    log("\n[6/6] writing outputs")
    WRITE_DIR.mkdir(parents=True, exist_ok=True)
    (WRITE_DIR / "projects").mkdir(parents=True, exist_ok=True)

    def dump(path: Path, obj) -> int:
        path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False),
                        encoding="utf-8")
        return path.stat().st_size

    sizes: dict[str, int] = {}
    # Internal measures ARE published. They carry internal=True so the interface
    # never renders them as facts, but they must be in the registry, because a
    # rate names its denominator by measure id and that id has to resolve to a
    # definition. Publishing pop.literacy_rate while withholding pop.age7plus
    # left the literacy rate pointing at a definition the browser did not have,
    # and left districts.json carrying values for a measure the registry did not
    # admit existed - which is precisely the mismatch the measure/value split is
    # built to make impossible.
    # buildFact() and factsForGroup() both drop measure.internal, so an internal
    # measure in the registry is never rendered as a fact. PUBLIC_MEASURES stays
    # as the list of what is displayable; it is just not the list of what the
    # registry must define.
    sizes["measures.json"] = dump(WRITE_DIR / "measures.json", {
        "groups": GROUPS,
        "measures": MEASURES,
        "benchmarks": benchmarks,
    })
    sizes["districts.json"] = dump(WRITE_DIR / "districts.json", {
        str(code): {
            "censuscode": d["censuscode"],
            "district_name": d["district_name"],
            "state_name": d["state_name"],
            "values": d["values"],
        } for code, d in sorted(districts.items())
    })
    sizes["subdistricts.json"] = dump(WRITE_DIR / "subdistricts.json", {
        str(code): {
            "code": s["code"],
            "district": s["district"],
            # Every district this sub-district lies in. 31 tehsils straddle a
            # boundary and are published once; without this a reader in Baksa
            # is told their sub-district is in Barpeta, and the contract check
            # that a proposal's sub-district lies in a district the proposal
            # names has nothing to check against.
            "districts": s["districts"],
            "name": s["name"],
            "district_name": s["district_name"],
            "state_name": s["state_name"],
            "values": s["values"],
        } for code, s in sorted(subdistricts.items())
    })

    # Shards store `sector` and `status` as positions in these arrays, so a
    # position that moves rewrites every row that uses it. Re-sorting the
    # whole vocabulary each build did exactly that: the register carries 83
    # source spellings of 73 stages and gains new ones, and one arriving
    # spelling that sorts into the middle shifted every index after it - all
    # 35 shards rewritten, 47 MB committed, for one new label on one proposal.
    #
    # So the vocabulary is a REGISTER, not a sort. Whatever is already
    # published keeps its position for ever; anything new is appended in
    # sorted order after it; nothing is ever removed, because removing one
    # shifts everything past it and costs the same full rewrite. A value that
    # has left the register keeps an unused slot, which is cheap: 73 statuses
    # and ten sectors, against 47 MB of shards.
    all_sectors = stable_vocabulary(
        "sectors", {r["sector"] for rows in by_state.values() for r in rows})
    all_statuses = stable_vocabulary(
        "statuses", {r["status"] for rows in by_state.values() for r in rows})
    sector_ix = {s: i for i, s in enumerate(all_sectors)}
    status_ix = {s: i for i, s in enumerate(all_statuses)}

    state_names = {}
    for rec in records:
        state_names.setdefault(slugify(rec.get("state") or "unknown"),
                               rec.get("state") or "Unknown")

    state_counts = {}
    for slug, rows in sorted(by_state.items()):
        rows.sort(key=lambda r: r["date"], reverse=True)
        packed = [
            [r["id"], r["rid"], r["no"], r["name"], r["agency"],
             sector_ix[r["sector"]], r["cat"], status_ix[r["status"]], r["date"],
             r["auth"], r["cert"], r["dc"], r["dall"], r["sd"], r["nv"], r["dm"],
             r["af"], r["df"], r["rnr"], r["lit"], r["vio"], r["land"], r["forest"],
             r["sk"], r["lat"], r["lon"], r["ext"], r["gk"], r["gd"],
             r["dtd"], r["dpd"], r["qr"], r["cst"],
             r["fon"], r["don"], r["dsu"], r["nblk"], r["sq"], r["dd"], r["upd"],
             r["lk"], r["cf"]]
            for r in rows
        ]
        sizes[f"projects/{slug}.json"] = dump(WRITE_DIR / "projects" / f"{slug}.json", {
            "state": state_names.get(slug, slug),
            "slug": slug,
            "fields": SHARD_FIELDS,
            "certPrefix": CERT_PREFIX,
            "authorities": AUTHORITIES,
            "sectors": all_sectors,
            "statuses": all_statuses,
            "rows": packed,
        })
        state_counts[slug] = {
            "slug": slug,
            "name": state_names.get(slug, slug),
            "total": len(rows),
            "resolved": sum(1 for r in rows if r["dc"] is not None),
        }

    sizes["stages.json"] = dump(WRITE_DIR / "stages.json", ST.registry())

    # ── The forest register's own record of each forest proposal an EC form
    # names. The form declares a number (FP/...) and a status as the proponent
    # sees it; the forest register holds the proposal's actual current stage.
    # Only the proposals some published form names are written - the rest of
    # the forest register is not this instrument's subject.
    named_fc = {no for rows in by_state.values() for r in rows
                if isinstance(r.get("lk"), dict) and r["lk"].get("f")
                for no in fp_numbers(r["lk"]["f"][0])}
    forest_rows: dict[str, list] = {}
    forest_path = CACHE / "parivesh" / "forest_records.json"
    forest_read = None
    forest_complete = None
    state_read: dict[str, str] = {}
    if forest_path.exists():
        # When the register was last actually READ - written by the sweep only
        # when at least one state answered. The merged file's modification
        # time was used before, and it moves even when every state failed.
        try:
            fm = json.loads((CACHE / "parivesh" / "forest_meta.json")
                            .read_text(encoding="utf-8"))
            forest_read, forest_complete = fm.get("read_at"), fm.get("complete")
        except Exception:  # noqa: BLE001
            fm, forest_read = {}, None
        # Each State's records are dated by when ITS state code was last read
        # (see sync.fetch_forest); `read_at` is the oldest of them.
        code_read = fm.get("codes") or {}
        for sf in sorted((CACHE / "parivesh" / "forest").glob("state_*.json")):
            code = sf.stem.split("_", 1)[1]
            when = code_read.get(code) or forest_read
            try:
                srows = json.loads(sf.read_text(encoding="utf-8")).get("data") or []
            except Exception:  # noqa: BLE001
                continue
            for fr in srows:
                if fr.get("state") and when:
                    prev = state_read.get(fr["state"])
                    state_read[fr["state"]] = min(prev, when) if prev else when
        for fr in json.loads(forest_path.read_text(encoding="utf-8")):
            nos = fp_numbers(fr.get("proposalNo"))
            no = nos[0] if nos else None
            if no and no in named_fc:
                area = fr.get("forest_area")
                try:
                    area = round(float(area), 4) if area not in (None, "") else None
                except (TypeError, ValueError):
                    area = None
                form = (fr.get("clearanceType") or "").split(":")[0].strip() or None
                forest_rows[no] = [(fr.get("proposalStatus") or "").strip(), area,
                                   form, (fr.get("dateOfSubmission") or "")[:10] or None,
                                   fr.get("state") or None]
    (WRITE_DIR / "register").mkdir(parents=True, exist_ok=True)
    sizes["register/forest.json"] = dump(WRITE_DIR / "register" / "forest.json", {
        "read_at": min(state_read.values()) if state_read else forest_read,
        "complete": forest_complete,
        # When each State's records were read; a row is dated by its `state`.
        "state_read_at": dict(sorted(state_read.items())),
        "fields": ["status", "area", "form", "date", "state"],
        "area_unit": "hectares, as the forest register records the area sought",
        "named": len(named_fc),
        "found": len(forest_rows),
        "rows": dict(sorted(forest_rows.items())),
    })
    sizes["appraisal.json"] = dump(WRITE_DIR / "appraisal.json",
                                   AP.aggregate(appraisal_rows))
    sizes["lookup.json"] = dump(WRITE_DIR / "lookup.json", lookup)
    sizes["index.json"] = dump(WRITE_DIR / "index.json", {
        "states": state_counts,
        "sectors": all_sectors,
        "categories": sorted({r["cat"] for rows in by_state.values() for r in rows
                              if r.get("cat")}),
        "statuses": all_statuses,
        "resolutionCodes": {v: k for k, v in RESOLUTION_CODES.items()},
    })

    # The span of submission dates this copy of the register holds, measured
    # from its own rows. "2022 onward" used to be typed into the source
    # description and into pages by hand: a claim about the source that
    # nothing checked. It is the limit that makes a search for an older
    # proposal fail silently, so it is published as a figure and every surface
    # reads it from here.
    submitted = sorted(r["date"] for rows in by_state.values() for r in rows
                       if REGISTER_DATE_RE.match(r["date"] or ""))
    register_span = ({"earliest": submitted[0], "latest": submitted[-1],
                      "dated": len(submitted)} if submitted else None)

    fetched_at = source_fetched_at()
    prior_counts = {}
    if (OUT_DIR / "meta.json").exists():
        try:
            prior_counts = (json.loads(
                (OUT_DIR / "meta.json").read_text(encoding="utf-8")
            ).get("counts") or {})
        except Exception:  # noqa: BLE001
            prior_counts = {}
    meta = {
        "instrument": "People & Consent",
        "generated_at": started.isoformat(),
        "counts": {
            # The largest register ever published, carried forward. The floor
            # compares against this rather than against the last run, so a
            # source that degrades gradually cannot ratchet the register down
            # one acceptable step at a time.
            "proposals_published_high_water": max(
                published_total,
                int(((prior_counts or {}).get("proposals_published_high_water"))
                    or (prior_counts or {}).get("proposals_published") or 0)),
            "register_records_fetched": reg_notes["deduped"],
            "register_records_excluded": excluded,
            "proposals_published": kept,
            "proposals_district_resolved": resolved,
            "proposals_with_subdistrict": resolution["with_subdistrict"],
            "proposals_with_village": resolution["with_village"],
            "proposals_multi_district": resolution["multi_district"],
            "caf_records_available": len(caf_by_id),
            "districts": len(districts),
            "subdistricts": len(subdistricts),
        },
        # Without the per-proposal log of moves: meta.json is bundled into the
        # pages that import it, and 852 rows of audit trail tenfolded it. The
        # log is in verification_report.json; the counts stay here.
        "resolution": {k: v for k, v in resolution.items()
                       if k != "adjudication_moves"},
        # The earliest and latest submission dates in this copy of the register.
        "register_span": register_span,
        # How far the source itself has been read. Kept beside the resolution
        # figures because the two answer different questions and are easy to
        # confuse: `resolution` is how much of the register we could place,
        # `caf_coverage` is how much of it we have actually looked at. A low
        # resolution rate over a fully-read register is a finding about the
        # register; the same rate over a half-read one is a finding about us.
        "caf_coverage": caf_coverage,
        # Of the forms actually read, the share placed. Independent of how far
        # the backfill has got, unlike the rate below it.
        "resolution_rate_of_read_pct": (
            round(100 * caf_coverage["ok"]
                  / (caf_coverage["ok"] + caf_coverage["nogeo"]), 2)
            if (caf_coverage["ok"] + caf_coverage["nogeo"]) else None),
        "resolution_rate_pct": round(100 * resolved / max(1, kept), 2),
        "subdistrict_rate_pct": round(100 * resolution["with_subdistrict"] / max(1, kept), 2),
        "sources": [
            {"name": "PARIVESH environmental clearance register",
             "publisher": "Ministry of Environment, Forest and Climate Change",
             "url": PARIVESH_BASE, "vintage": "live",
             "fetched": fetched_at["register"],
             "coverage": (f"proposals submitted {register_span['earliest'][:4]} onward"
                          if register_span else "proposals as the register serves them")},
            {"name": "PARIVESH Common Application Form",
             "publisher": "Ministry of Environment, Forest and Climate Change",
             "url": PARIVESH_BASE.replace("trackYourProposal", "proponentApplicant"),
             "vintage": "live", "fetched": fetched_at["caf"],
             "coverage": "project location as filed by the proponent: district, "
                         "sub-district and village, plus declared land area, "
                         "affected and displaced families"},
            {"name": "Census 2011 Primary Census Abstract",
             "publisher": "Office of the Registrar General of India, via SHRUG",
             "url": f"https://doi.org/10.7910/DVN/DPESAK", "vintage": "2011",
             "version": SHRUG_VERSION, "fetched": fetched_at["shrug"]},
            {"name": "Census 2011 Village Directory",
             "publisher": "Office of the Registrar General of India, via SHRUG",
             "url": f"https://doi.org/10.7910/DVN/DPESAK", "vintage": "2011",
             "version": SHRUG_VERSION, "fetched": fetched_at["shrug"]},
            {"name": "Socio Economic and Caste Census 2011, rural",
             "publisher": "Ministry of Rural Development, via SHRUG",
             "url": f"https://doi.org/10.7910/DVN/DPESAK", "vintage": "2011",
             "version": SHRUG_VERSION, "fetched": fetched_at["shrug"],
             "coverage": "rural households only: land ownership, income band, "
                         "main source of income and salaried employment"},
            {"name": "PARIVESH appraisal history",
             "publisher": "Ministry of Environment, Forest and Climate Change",
             "url": "https://parivesh.nic.in/workgroupmaster/process",
             "vintage": "live", "fetched": fetched_at["history"],
             "coverage": "every dated step a proposal has passed through, from "
                         "submission to decision. Individual officers are named "
                         "in the source and are not recorded here."},
            {"name": "Census 2011 district boundaries",
             "publisher": "datameet", "url": DATAMEET_URL, "vintage": "2011",
             "fetched": fetched_at["boundaries"],
             "coverage": "district outlines as they stood at the 2011 Census, "
                         "used to test filed coordinates against the district "
                         "a proposal names"},
        ],
        # What the interface needs in order to say how far each new column can
        # be trusted. Without these in the shipped file, the only record of
        # them is the local audit artifact, which no reader ever sees.
        "site_geometry": {
            "coordinates": geo_stats["coordinates"],
            # What the three coordinate outcomes mean, so the partition is not
            # misread as two buckets plus a detail. `untyped_blocks_skipped` is
            # scoped deliberately: the extractor keeps only PRIMARY blocks
            # where a filing has any, so this counts untyped blocks only in
            # filings that named no primary site at all. It measures that
            # residual; it is not a claim that untyped blocks never occur.
            "coordinates_note": (
                "present, filed_but_all_discarded and absent partition the "
                "published register exactly. filed_but_all_discarded named a "
                "site whose every mapped block was malformed, which is not "
                "the same as naming no site at all. untyped_blocks_skipped is "
                "counted only within filings carrying no PRIMARY block, "
                "because non-primary blocks are dropped before this stage."
            ),
            "verdicts": {k: v for k, v in geo_stats["test"].items()
                         if k != "no_district_filed"},
            "not_testable_no_district_filed":
                geo_stats["test"].get("no_district_filed", 0),
            "corroboration_pct": _corroboration_pct(geo_stats["test"]),
            # THE CONSTANT THE FIGURE ABOVE RESTS ON, published beside it.
            #
            # `boundary` means "within this distance of a named district's
            # edge", and boundary rows are excluded from both sides of the
            # corroboration rate. So the tolerance decides how many rows the
            # rate is computed over, and it moves the answer: recomputed at
            # zero tolerance, 1,794 of the 1,872 boundary rows become
            # `elsewhere` and the rate falls to 96.07; at 0.01 degrees - still
            # a defensible ~1.1 km - 326 `elsewhere` rows become `boundary`
            # and it rises to 98.42.
            #
            # 98.05 is therefore one point in a 96.07-98.42 band chosen by a
            # number, and a figure published without the number that chose it
            # is not a figure anyone can check. It is stated here rather than
            # left in the source.
            "boundary_tolerance_m": round(DGEO_BOUNDARY_TOLERANCE * 111_000),
            "corroboration_note": (
                "inside / (inside + elsewhere). Rows within "
                f"{round(DGEO_BOUNDARY_TOLERANCE * 111_000)} m of a named "
                "district's edge are published as `boundary` and excluded "
                "from both sides, because the mapped line cannot decide them; "
                "`offshore` and `unmapped` are excluded too, as neither is a "
                "disagreement about the district. Widening the tolerance "
                "moves rows from `elsewhere` into `boundary` and raises the "
                "rate; narrowing it does the reverse."
            ),
            "code_agreement": geo_stats["match"],
            "boundary_source": "datameet Census 2011 district boundaries",
            "note": "Coordinates come from the KML the proponent filed. The "
                    "verdict compares them with the district the same filing "
                    "names, using boundaries from a different source, so it is "
                    "the one check on location the filing did not itself make.",
        },
        "appraisal_coverage": {
            "proposals_with_history": len(appraisal_rows),
            "of_published": sum(len(v) for v in by_state.values()),
            "pct": round(100 * len(appraisal_rows)
                         / max(1, sum(len(v) for v in by_state.values())), 2),
            # NOT "the workflow engine does not hold a history for every
            # proposal", which is what this said and is a claim about the
            # Ministry we cannot make. `appraisal_rows` is built from the
            # fetch cache, so a proposal whose history has not been read yet
            # is indistinguishable here from one whose history came back
            # empty. Measured by register year, coverage is 0.0% for 2022,
            # 8.4% for 2023 and 98.7% for 2024 - a monotone step in time,
            # which is the signature of a reading order, not of a
            # record-keeping regime. Publishing the first reading as the
            # second put our own backlog in the government's mouth.
            "note": "This instrument does not yet hold an appraisal history for every proposal. Every timing figure is computed over the proposals it does hold, and states that count. The proposals without one are overwhelmingly older filings, so this is a gap in what has been read and not a property of the register.",
        },
        "site_data_vintage": {
            "extracts_without_per_block_detail": len(stale_site_extracts),
            "note": "Counts of discarded, single-corner and untyped blocks are "
                    "measured only for locations extracted by the current "
                    "reader. Where this is non-zero those counts are a floor, "
                    "not a total, and the affected rows carry `old` in `sq`.",
        },
        "contact_details_removed": {
            "records": scrubbed_contacts,
            "note": "Proponent names are published: an applicant is a party to "
                    "a public regulatory proceeding and naming them is what the "
                    "register is for. Email addresses and phone numbers found "
                    "in free-text fields are removed - they identify a way to "
                    "reach a private person and say nothing about the project.",
        },
        "status_vocabulary": {
            "canonical_keys": len(ST.STATUSES),
            "source_spellings": len(ST.RAW_TO_KEY),
            "unclassified_records": sum(unclassified_statuses.values()),
            "note": "The register records one position under several spellings. "
                    "Filters and counts resolve through the canonical key so "
                    "they cannot disagree; stages.json carries the mapping.",
        },
        "vintage_warning": (
            "The socio-economic profile is Census 2011. It is the most recent "
            "complete sub-district enumeration of India; the 2021 Census has not "
            "been conducted. Every figure describes the population as it was "
            "enumerated in 2011 and is presented on that basis."
        ),
        "invariants": {
            "violations": len(violations),
            "detail": violations[:100],
            "resample_failures": len(failed_samples),
        },
        "withheld_values": [
            {"measure": s["measure"], "state": s["state"],
             "districts": s["districts"], "reason": s["reason"]}
            for s in suppressed
        ],
    }
    sizes["meta.json"] = dump(WRITE_DIR / "meta.json", meta)

    report.update({
        "register": reg_notes,
        "aggregation": agg_notes,
        "subdistrict_aggregation": sd_notes,
        # Every value the pipeline withheld, and why. Suppression is a
        # deliberate act on the data and must be auditable, not just logged.
        "state_wide_zero_suppressions": suppressed,
        "location_index": loc_index.stats(),
        # How much of the register has an extract on disk. Distinct from
        # `caf_coverage` below, which is the per-proposal outcome over the
        # PUBLISHED rows. Both were once called caf_coverage in this same dict
        # literal, so the later key silently won and this block never reached
        # the report at all - a duplicate key is not an error in Python.
        "caf_extraction": {
            "extracts_available": len(caf_by_id),
            "register_size": reg_notes["deduped"],
            "pct": round(100 * len(caf_by_id) / max(1, reg_notes["deduped"]), 2),
        },
        "districts_built": len(districts),
        "subdistricts_built": len(subdistricts),
        "shrug_codes_unmatched_to_gazetteer": unmatched_codes,
        # Plan section 6.3, the third join: Census 2011 districts against the
        # Whitespace CSR master. Measured, not used - see join_csr_master.py.
        "join_census_to_csr_master": join_csr_master.measure(
            gaz,
            json.loads(join_csr_master.MASTER.read_text(encoding="utf-8")),
            set(districts),
        ),
        "resolution": resolution,
        # How far the source itself has been read. Kept beside the resolution
        # figures because the two answer different questions and are easy to
        # confuse: `resolution` is how much of the register we could place,
        # `caf_coverage` is how much of it we have actually looked at. A low
        # resolution rate over a fully-read register is a finding about the
        # register; the same rate over a half-read one is a finding about us.
        "caf_coverage": caf_coverage,
        # The geometric test: where the filed coordinates actually fall, set
        # against the district the proposal was filed under. `agree` and
        # `disagree` compare the district the coordinates land in with the
        # district the codes name; they are the independent corroboration of
        # the location spine, computed over every proposal rather than sampled.
        "site_geometry": {
            "coordinates": geo_stats["coordinates"],
            # What the three coordinate outcomes mean, so the partition is not
            # misread as two buckets plus a detail. `untyped_blocks_skipped` is
            # scoped deliberately: the extractor keeps only PRIMARY blocks
            # where a filing has any, so this counts untyped blocks only in
            # filings that named no primary site at all. It measures that
            # residual; it is not a claim that untyped blocks never occur.
            "coordinates_note": (
                "present, filed_but_all_discarded and absent partition the "
                "published register exactly. filed_but_all_discarded named a "
                "site whose every mapped block was malformed, which is not "
                "the same as naming no site at all. untyped_blocks_skipped is "
                "counted only within filings carrying no PRIMARY block, "
                "because non-primary blocks are dropped before this stage."
            ),
            "test": geo_stats["test"],
            "match": geo_stats["match"],
            # Stated over every proposal whose coordinates were testable,
            # including those the boundary file could not place. Excluding the
            # latter would report a rate for the cases that happened to work.
            # Corroboration counts the verdicts that place a block inside a
            # district the filing names. `boundary` is excluded from BOTH sides:
            # it is defined as the case the mapped line cannot decide, so
            # charging it against agreement would contradict its own definition.
            "corroboration_pct": _corroboration_pct(geo_stats["test"]),
            # THE CONSTANT THE FIGURE ABOVE RESTS ON, published beside it.
            #
            # `boundary` means "within this distance of a named district's
            # edge", and boundary rows are excluded from both sides of the
            # corroboration rate. So the tolerance decides how many rows the
            # rate is computed over, and it moves the answer: recomputed at
            # zero tolerance, 1,794 of the 1,872 boundary rows become
            # `elsewhere` and the rate falls to 96.07; at 0.01 degrees - still
            # a defensible ~1.1 km - 326 `elsewhere` rows become `boundary`
            # and it rises to 98.42.
            #
            # 98.05 is therefore one point in a 96.07-98.42 band chosen by a
            # number, and a figure published without the number that chose it
            # is not a figure anyone can check. It is stated here rather than
            # left in the source.
            "boundary_tolerance_m": round(DGEO_BOUNDARY_TOLERANCE * 111_000),
            "corroboration_note": (
                "inside / (inside + elsewhere). Rows within "
                f"{round(DGEO_BOUNDARY_TOLERANCE * 111_000)} m of a named "
                "district's edge are published as `boundary` and excluded "
                "from both sides, because the mapped line cannot decide them; "
                "`offshore` and `unmapped` are excluded too, as neither is a "
                "disagreement about the district. Widening the tolerance "
                "moves rows from `elsewhere` into `boundary` and raises the "
                "rate; narrowing it does the reverse."
            ),
            "corroboration_note": "share of tested proposals whose blocks fall "
                                  "in a district the filing names. Cases within "
                                  "half a kilometre of a boundary are excluded "
                                  "from the ratio, not counted against it.",
            "boundary_source": gstats,
        },
        "status_vocabulary": {
            "canonical_keys": len(ST.STATUSES),
            "source_spellings": len(ST.RAW_TO_KEY),
            "unclassified_records": sum(unclassified_statuses.values()),
            "unclassified_statuses": dict(sorted(unclassified_statuses.items(),
                                                 key=lambda kv: -kv[1])[:20]),
        },
        "appraisal": {
            "proposals_with_history": len(appraisal_rows),
            "coverage_pct": round(100 * len(appraisal_rows)
                                  / max(1, sum(len(v) for v in by_state.values())), 2),
            "decided_with_duration": sum(
                1 for r in appraisal_rows if r.get("days_to_decision") is not None),
        },
        "resolution_rate_pct": meta["resolution_rate_pct"],
        "excluded_statuses": sorted(EXCLUDED_STATUSES),
        "excluded_count": excluded,
        "invariant_violations": violations,
        "resample_check": samples,
        "national_benchmarks": benchmarks["india"],
        "output_bytes": sizes,
        "output_bytes_total": sum(sizes.values()),
    })
    REPORT_PATH.write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    total_mb = sum(sizes.values()) / (1 << 20)
    biggest = sorted(sizes.items(), key=lambda kv: -kv[1])[:5]
    log(f"  wrote {len(sizes)} files, {total_mb:.1f} MB total")
    for name, n in biggest:
        log(f"    {name:34} {n/1024:9,.0f} KB")
    log(f"  verification report: {REPORT_PATH}")

    log(f"\nOK - built in {(datetime.now(timezone.utc)-started).total_seconds():.1f}s")


if __name__ == "__main__":
    main()
