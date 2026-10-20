"""Backfill structured project location from the PARIVESH Common Application Form.

WHY THIS EXISTS
---------------
The clearance search API (`trackYourProposal/advanceSearchData`) returns `state`
and nothing finer, so district had to be guessed from the free-text project
name, which resolved about a third of the register. The CAF endpoint returns the
location the proponent actually filed: district, sub-district and village, each
with its LGD code, plus plot numbers. Measured on a random sample of 120
proposals: 100% carried `mainDistrict` and 100% carried village-level plots.

THE CALL, AND THE TRAP IN IT
----------------------------
    POST /parivesh_api/proponentApplicant/getCafDataByProposalNo?proposal_id=<ID>

`<ID>` is the record's **`id`** field, NOT its `proposal_id` field. Those are
different numbers - for IA/GJ/THE/428278/2023 they are 5131820 and 5131819. The
parameter is named `proposal_id` but is fed `id`. Passing the field of the same
name returns HTTP 500, which is why earlier attempts concluded the endpoint was
unavailable. It is not. The body is empty; the id travels in the query string.

TWO DISTRICT FIELDS, ONLY ONE OF WHICH IS THE PROJECT
-----------------------------------------------------
`projectDetailDto.mainDistrict` is the project's district.
`commonFormDetails[].organization_district` and `.applicant_district` are the
proponent's registered office, which is frequently a metro far from the site.
For the sample proposal, mainDistrict is Jamnagar and organization_district is
Ahmadabad. Reading the wrong one produces confident, wrong answers concentrated
on state capitals. Only `mainDistrict` and the KML plots are used here.

CODES ARE LGD, NOT CENSUS
-------------------------
district_code/sub_district_code/village_code are Local Government Directory
codes. Map to Census 2011 via `kyc/getdistricts`, which publishes both
(`code` -> `census_code_2011`) for 758 of 774 districts. See build_data.py.

POLITENESS
----------
This is a government server, and sustained concurrency against it once got this
project's address refused at the TCP layer for nine hours. Pace and routing are
therefore not decided here: net.py watches what the service is actually
tolerating, spreads the load across every route available, and holds the direct
route - the one address that cannot be replaced - well below the concurrency
that provoked that. The worker count below is an upper bound on threads, not a
request rate; the pool decides the rate. There is still a backoff and a
circuit breaker that halts on a sustained error rate rather than hammering
a service that has started refusing.

Storage is one compact JSONL line per proposal - the full CAF response averages
25 KB, which would be 2.2 GB across the register, so only the fields the
instrument uses are kept. Runs are resumable: already-fetched ids are skipped.

Run from the project root:
  python scripts/instruments/fetch_caf.py                 # all, priority order
  python scripts/instruments/fetch_caf.py --category A    # just Category A
  python scripts/instruments/fetch_caf.py --limit 500     # a bounded slice
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import net as NET
import run_lock  # noqa: E402
import register_cache  # noqa: E402

CAF_URL = ("https://parivesh.nic.in/parivesh_api/proponentApplicant/"
           "getCafDataByProposalNo?proposal_id={}")
# Headers live in net.py. A local dict here was never used: NET.get
# takes no headers argument, so it set nothing while looking like it did.
# Highest-consequence first: Category A is appraised centrally and carries the
# largest projects, so a partial backfill is still a useful one.
CATEGORY_ORDER = ["A", "B1", "B2", None]

_print_lock = threading.Lock()


def log(msg: str) -> None:
    with _print_lock:
        print(msg, flush=True)


def cache_dir() -> Path:
    d = os.environ.get("INSTRUMENTS_CACHE_DIR", "")
    if not d:
        sys.exit("ERROR: INSTRUMENTS_CACHE_DIR is not set. See build_data.py.")
    return Path(d)


# One pool for the process, built on first use. Routes and pace are shared
# across every worker, which is the point: a per-thread view of how the server
# is behaving would never see the pattern that matters.
_POOL: NET.Pool | None = None
_POOL_LOCK = threading.Lock()

PROBE_URL = ("https://parivesh.nic.in/parivesh_api/trackYourProposal/"
             "getListOfSector")


def pool() -> "NET.Pool":
    global _POOL
    with _POOL_LOCK:
        if _POOL is None:
            _POOL = NET.build_pool(probe_url=PROBE_URL, max_workers=96)
            n = len(_POOL.routes) - 1
            log(f"egress: direct "
                f"{'BLOCKED, using proxies' if _POOL.blocked_direct else 'available'}"
                f", {n} proxy route(s) loaded")
        return _POOL


def write_left(ids_file: str | None, todo_ids, answered: set) -> None:
    """With --ids-file, name the ids that were NOT answered, for the caller.

    Exit 0 means the run finished without its breaker tripping - not that every
    named id was read. A moved proposal whose re-read timed out was cleared
    from the sync's queue on exit 0, and since its old record is still cached
    the normal resume never reads it again. `<ids-file>.left` lists what is
    still owed; the sync keeps exactly those.
    """
    if not ids_file:
        return
    left = sorted(i for i in todo_ids if i not in answered)
    Path(ids_file + ".left").write_text(json.dumps(left), encoding="utf-8")
    log(f"ids-file: {len(left):,} of {len(todo_ids):,} still owed")



def fetch_one(rec_id: int, timeout: int = 60, deadline: float | None = None):
    """POST with an empty body; the id travels in the query string.

    Routed through net.py, which picks a healthy egress and paces the run to
    what the service is actually tolerating. See that module for why a fixed
    worker count is not enough.
    """
    return NET.get(pool(), CAF_URL.format(rec_id), data=b"",
                   method="POST", timeout=timeout, deadline=deadline)


# ── site geometry ─────────────────────────────────────────────────────────
# Every KML block on a proposal carries the corner coordinates of the mapped
# site. They are the only statement of where a project physically is; the
# district, sub-district and village codes name the administrative unit, not
# the place inside it.
#
# A PROJECT IS A SET OF PLACES, NOT ONE PLACE
# A mine is one block. An expressway is four hundred, strung across two states.
# Reducing both to a single point loses the distinction and then invites a
# false conclusion from it: the centre of the envelope around a dispersed
# project falls where no part of the project is, and testing that centre
# against the districts the filing names reports a disagreement that exists
# only because of the reduction. Every block's centre is therefore kept, and
# the geometric test in build_data.py asks whether ANY of them sits in a
# district the filing names. Every one of them is carried: truncating
# that list can only turn a project that does sit in the district it
# named into one that appears not to, since any single block satisfies
# the test.
#
# FOUR PROPERTIES OF THE SOURCE THAT MUST BE HANDLED
#   1. The corners are labelled `ne_extend` and `sw_extend`, but the values are
#      not ordered to match: the "north-east" corner routinely carries the
#      smaller latitude. Measured over 71 live proposals, the labels were
#      transposed in all 71. They are ignored; the envelope is the min and max
#      of both corners.
#   2. Coordinates are written "latitude,longitude", not the longitude-first
#      order GeoJSON uses.
#   3. A proposal may carry ALTERNATIVE sites beside the one it proposes, typed
#      PRIMARY / ALTERNATIVE1 / ALTERNATIVE2. Spanning all of them places the
#      site between a real location and a rejected one. Only PRIMARY blocks are
#      used; a filing with no PRIMARY block falls back to what it has and says
#      so through `alt`.
#   4. Individual blocks are sometimes malformed, with two "corners" hundreds of
#      kilometres apart - one observed block spanned Kachchh to Delhi. A cap
#      alone cannot separate those from a genuine 400 km expressway corridor,
#      because the two overlap in size. So the cap is set only to reject the
#      clearly impossible, every rejection is counted rather than silently
#      becoming "this proposal filed no location", and NOTHING downstream is
#      allowed to depend on a single block being the right one: the point that
#      represents the project is chosen in build_data.py, from the blocks that
#      agree with the district the filing names.

# Generous but real bounds for India including island territories. A corner
# outside this is a filing error, not a location.
INDIA_BOUNDS = {"s": 6.0, "w": 67.0, "n": 37.6, "e": 97.5}

# What `extract()` records. Bump this whenever the shape changes, or records
# written by the previous reader are skipped on every future run and quietly
# keep their old shape for ever.
#   1  district / sub-district / village codes, declared land and families
#   2  adds per-block site geometry: pts, dropped, untyped_skipped,
#      single_corner - without which the multi-block verdict cannot run
#   3  deterministic. The source returns a proposal's form revisions and its
#      plots in no fixed order, and version 2 read whichever came last, so two
#      fetches of the same unchanged proposal could disagree. Measured over
#      58,107 records fetched twice: 985 disagreed - 878 on plot order alone,
#      109 on declared land, because the land figures came from whichever form
#      revision happened to be last in the response.
# The ONLY status that means "the service holds no form for this proposal".
# Documented behaviour of this endpoint, and confirmed against the register.
# Every other status is about us or about the moment: 403 is our address being
# refused, 404 with an HTML body is a proxy's own error page, 429/502/503/504
# are capacity. Treating any non-negative status as a settled answer published
# 163 proposals as "the regulator serves no form" when the regulator had said
# no such thing - our own block and our own bad routes, put in a government's
# mouth on a public register.
SETTLED_STATUSES = frozenset({500})

# How many times a settle-eligible status must repeat before it
# retires an id. net.py picks a route per attempt, so the second
# ask almost always leaves by a different one.
SETTLE_CONFIRMATIONS = 2

# 4 (2026-09-25): adds `links` - the form's own cross-references to the
#   forest-clearance and wildlife-board proposals, its eco-sensitive-zone,
#   protected-area and CRZ declarations, and the tenure of its land. Records at
#   3 are re-read; until they are, they publish no linked clearance.
EXTRACT_VERSION = 4
def settle_decision(status: int, settled_seen: int, attempt: int,
                    max_attempts: int = 3) -> str:
    """What to do with one answer: "return", "retry", "confirm" or "owed".

    A named function rather than a condition inside a worker thread, because
    it decides whether a proposal is retired for ever - and every other rule
    in this pipeline that decided something that consequential from inside a
    loop turned out to be untestable and wrong.

      return   this answer is the answer; hand it back
      retry    capacity or transport; wait and ask again
      confirm  a settle-eligible status seen once; ask again before retiring
      owed     seen once with no attempt left to confirm it: not an answer,
               so the id stays owed (returned, a single 500 retired it)

    `confirm` is the whole point. See SETTLED_STATUSES.
    """
    if status in (429, 503, -1):
        return "retry"
    if status in SETTLED_STATUSES:
        if settled_seen + 1 < SETTLE_CONFIRMATIONS:
            return "confirm" if attempt < max_attempts - 1 else "owed"
        return "return"
    return "return"


# Degrees. About 660 km. An expressway block, a transmission corridor and a
# canal all fit inside this; the malformed blocks observed spanned five to
# seven degrees. Set deliberately loose: a corridor wrongly discarded is
# reported as a project that filed no location at all, which is a worse error
# than a large box, and the per-block centres make a large box harmless.
MAX_BLOCK_SPAN = 6.0

def _corner(text: object) -> tuple[float, float] | None:
    """Parse one "latitude,longitude" corner. Returns None if unusable."""
    if not isinstance(text, str) or "," not in text:
        return None
    lat_s, _, lon_s = text.partition(",")
    try:
        lat, lon = float(lat_s.strip()), float(lon_s.strip())
    except ValueError:
        return None
    if not (INDIA_BOUNDS["s"] <= lat <= INDIA_BOUNDS["n"]):
        return None
    if not (INDIA_BOUNDS["w"] <= lon <= INDIA_BOUNDS["e"]):
        return None
    return lat, lon


def _block_box(kml: dict) -> tuple[dict | None, str]:
    """One block's envelope, with why it was rejected if it was.

    Reason is one of: ok, no_corner, one_corner, too_wide. `one_corner` is kept
    but flagged - a block with a single usable corner is a point rather than an
    extent, and publishing that as an exact location without saying so would
    overstate what the filing established.
    """
    ne, sw = _corner(kml.get("ne_extend")), _corner(kml.get("sw_extend"))
    corners = [c for c in (ne, sw) if c is not None]
    if not corners:
        return None, "no_corner"
    lats = [c[0] for c in corners]
    lons = [c[1] for c in corners]
    box = {"s": min(lats), "n": max(lats), "w": min(lons), "e": max(lons)}
    if (box["n"] - box["s"]) > MAX_BLOCK_SPAN or (box["e"] - box["w"]) > MAX_BLOCK_SPAN:
        return None, "too_wide"
    return box, ("ok" if len(corners) == 2 else "one_corner")


def site_extent(kml_objects: list) -> dict | None:
    """Where the project is, from its mapped blocks.

    Returns the envelope over the kept blocks, the centre of each DISTINCT kept
    block, a fallback point, and an account of what was discarded and why.
    Every kept block is carried: truncating the list can only turn a project
    that does sit in the district it named into one that appears not to, since
    the verdict downstream is satisfied by any single block.
    """
    objs = list(kml_objects or [])
    typed = [(k, str(k.get("type") or "").strip().upper()) for k in objs]
    primary = [k for k, t in typed if t == "PRIMARY"]
    # A block with no type at all, sitting beside a typed PRIMARY, is dropped by
    # the filter. That is a discard like any other and is counted as one rather
    # than quietly shrinking the block count.
    untyped_skipped = (len([k for k, t in typed if not t]) if primary else 0)
    used_alternatives = not primary and bool(objs)

    boxes, dropped, single = [], 0, 0
    for k in (primary or objs):
        box, why = _block_box(k)
        if box is None:
            dropped += 1
            continue
        if why == "one_corner":
            single += 1
        boxes.append(box)

    if not boxes:
        # Blocks were filed and none survived. That is a different fact from
        # "no location was filed" and must not be reported as the same one.
        if dropped or untyped_skipped:
            return {"blocks": 0, "dropped": dropped,
                    "untyped_skipped": untyped_skipped,
                    "alt": used_alternatives}
        return None

    # Distinct blocks only. A filing that repeats one block three times has one
    # location, and counting three would overstate how spread the site is.
    seen, uniq_boxes = set(), []
    for b in boxes:
        key = (b["s"], b["n"], b["w"], b["e"])
        if key in seen:
            continue
        seen.add(key)
        uniq_boxes.append(b)

    pts = [(round((b["s"] + b["n"]) / 2, 6), round((b["w"] + b["e"]) / 2, 6))
           for b in uniq_boxes]
    # Fallback only, used when no block corroborates the filing. Longest side
    # rather than area, so a corridor is not passed over for a compact quarry.
    main = max(range(len(uniq_boxes)),
               key=lambda i: max(uniq_boxes[i]["n"] - uniq_boxes[i]["s"],
                                 uniq_boxes[i]["e"] - uniq_boxes[i]["w"]))

    return {
        "s": round(min(b["s"] for b in uniq_boxes), 6),
        "n": round(max(b["n"] for b in uniq_boxes), 6),
        "w": round(min(b["w"] for b in uniq_boxes), 6),
        "e": round(max(b["e"] for b in uniq_boxes), 6),
        "lat": pts[main][0],
        "lon": pts[main][1],
        "pts": pts,
        "blocks": len(uniq_boxes),
        "dropped": dropped,
        "untyped_skipped": untyped_skipped,
        "single_corner": single,
        "alt": used_alternatives,
    }


def _operative(cfds: list) -> dict | None:
    """The form revision that is in force, of however many the proposal carries.

    A proposal accumulates Common Application Form revisions - one SUBMITTED,
    another after a query is raised, another when it completes - and each
    carries its own declared land and its own plots. The response lists them in
    no particular order, so reading "the last one" reads a different revision
    from one fetch to the next. Observed on 2948987: the SUBMITTED revision
    declares 74.21 ha of forest land and the later EDS_RAISED revision declares
    136.724 ha, and version 2 of this extractor published whichever arrived
    last.

    The operative revision is the most recent one, and `id` orders them: it is
    assigned when the revision is created, so the highest is the latest. That
    is both deterministic and the right answer - a proposal is judged on the
    form it now stands on, not on a superseded draft.
    """
    usable = [c for c in (cfds or []) if isinstance(c, dict)]
    if not usable:
        return None
    return max(usable, key=lambda c: (c.get("id") or 0))


def _flag(v) -> bool | None:
    """The form's yes/no fields arrive as booleans, "YES"/"NO", or null."""
    if isinstance(v, bool):
        return v
    if isinstance(v, str) and v.strip().upper() in ("YES", "Y", "TRUE"):
        return True
    if isinstance(v, str) and v.strip().upper() in ("NO", "N", "FALSE"):
        return False
    return None


def _num(v):
    try:
        return round(float(v), 4) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _code(v, limit: int = 60) -> str | None:
    """A short structured value - a proposal number, a status, a place name.
    Free text is not taken: a reason field can name a person or give a phone
    number, and nothing here needs one."""
    if v is None:
        return None
    s = " ".join(str(v).split())
    return s[:limit] or None


def links(data: dict) -> dict | None:
    """What the form declares about the OTHER clearances and the land.

    The environmental clearance form carries its own cross-references: whether
    forest land is diverted and under which forest-clearance proposal, whether
    a wildlife-board recommendation is needed and for which protected area,
    whether the site is in an eco-sensitive zone, a protected area or a coastal
    regulation zone, and how its land is held. These are the proponent's
    declarations; the instrument publishes them as such.
    """
    cl = data.get("clearence")
    if not isinstance(cl, dict):
        return None
    pd = cl.get("ecProjectDetail") or {}
    tenure = []
    for la in cl.get("landAcquisitionDetails") or []:
        if not isinstance(la, dict) or la.get("delete"):
            continue
        tenure.append({
            "type": _code(la.get("land_type")),
            "owner": _code(la.get("non_forest_land_type")),
            "status": _code(la.get("land_acquisition_status")),
        })
    tenure.sort(key=lambda t: (t["type"] or "", t["owner"] or "", t["status"] or ""))
    return {
        "fc": {
            "involved": _flag(cl.get("is_fc_involved")),
            "approval_involved": _flag(cl.get("is_fc_approval_invovled")),  # sic
            "proposal_no": _code(cl.get("fc_proposal_no") or cl.get("fc_submitted_proposal_no")),
            "status": _code(cl.get("fc_status_of_application")),
            "applied_ha": _num(cl.get("fc_applied_diversion")),
            "diverted_ha": _num(cl.get("fc_area_diverted")),
            "approved_on": _code(cl.get("fc_date_of_approval"), 10),
        },
        "nbwl": {
            "required": _flag(cl.get("is_nbwl_recomm")),
            "protected_area": _code(cl.get("nbwl_name_pa"), 120),
            "submitted": _flag(cl.get("is_nbwl_application_submitted")),
            "proposal_no": _code(cl.get("nbwl_proposal_no")),
            "status": _code(cl.get("nbwl_status")),
        },
        "esz": _flag(cl.get("is_located_in_ecosensitive_zone")
                     if cl.get("is_located_in_ecosensitive_zone") is not None
                     else pd.get("is_located_in_ecosensitive_zone")),
        "protected_area": _flag(pd.get("parks_protected_area")
                                if pd.get("parks_protected_area") is not None
                                else cl.get("is_protected")),
        "crz": _flag(pd.get("is_activity_located_in_crz")),
        "crz_class": _code(pd.get("crz_classifctn")),
        "interlinked_no": _code(cl.get("interlink_proposal_no")),
        "tenure": tenure,
    }


def extract(raw: bytes) -> dict | None:
    """Reduce a ~25 KB CAF response to the fields the instrument uses.

    Deterministic: the same response always yields the same extract, and an
    unchanged proposal always yields the same extract. Everything the source
    returns unordered is ordered here, and everything it returns more than one
    of is chosen from explicitly rather than by arrival.
    """
    try:
        d = json.loads(raw.decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001
        return None
    # A body that parses but is not an envelope (`null`, `[]`) is unreadable,
    # not a crash: raised here, it ended the whole pass.
    if not isinstance(d, dict) or d.get("status") != 200:
        return None
    data = d.get("data") or {}
    if not isinstance(data, dict):
        return None
    pdd = ((data.get("proponentApplications") or {}).get("projectDetailDto") or {})

    plots, seen = [], set()
    villages = affected = displaced = None
    rnr = litigation = violation = None
    land = {}
    kml_objects: list = []
    toposheets: set = set()
    # One revision, not a blend of several. Land, plots and site geometry must
    # describe the same version of the form, or the profile reports a site from
    # one revision beside an area from another.
    operative = _operative(pdd.get("commonFormDetails"))
    for cfd in ([operative] if operative else []):
        blocks = list(cfd.get("cafKML") or [])
        # Plots inherit the same primary/alternative split as the geometry: a
        # village named only on a rejected alternative site is not a village
        # this project affects.
        chosen = [k for k in blocks
                  if str(k.get("type") or "").strip().upper() == "PRIMARY"] or blocks
        for kml in chosen:
            kml_objects.append(kml)
            for p in (kml.get("cafKMLPlots") or []):
                sheet = (p.get("toposheet_no") or "").strip()
                if sheet:
                    toposheets.add(sheet)
                key = (p.get("district_code"), p.get("sub_district_code"),
                       p.get("village_code"))
                if key in seen:
                    continue
                seen.add(key)
                plots.append({
                    "dc": p.get("district_code"),
                    "sdc": p.get("sub_district_code"),
                    "vc": p.get("village_code"),
                    "dn": p.get("district"),
                    "sdn": p.get("sub_District"),
                    "vn": p.get("village"),
                })
        o = cfd.get("cafOthers") or {}
        if o:
            villages = o.get("no_of_villages", villages)
            affected = o.get("no_of_project_affected_families", affected)
            displaced = o.get("no_of_project_displaced_families", displaced)
            rnr = o.get("rnr_involved", rnr)
            litigation = o.get("is_any_litigation_pending", litigation)
            violation = o.get("is_any_violayion_involved", violation)  # sic, source spelling
        lk = cfd.get("cafLocationOfKml") or {}
        if lk:
            land = {
                "existing_forest": lk.get("existing_forest_land"),
                "existing_non_forest": lk.get("existing_non_forest_land"),
                "existing_total": lk.get("existing_total_land"),
                "additional_forest": lk.get("additional_forest_land"),
                "additional_non_forest": lk.get("additional_non_forest_land"),
                "total": lk.get("total_land"),
                "shape": lk.get("shape_of_project"),
                "border_state": lk.get("falling_border_in_states"),
                "intl_border_km": lk.get("international_border_distance"),
            }

    # Sorted, so the order the service happened to return them in cannot reach
    # the published data. Two fetches of an unchanged proposal must produce
    # byte-identical extracts or nothing downstream is reproducible.
    plots.sort(key=lambda p: (str(p.get("dc") or ""), str(p.get("sdc") or ""),
                              str(p.get("vc") or ""), str(p.get("vn") or "")))
    site = site_extent(kml_objects)
    if site and site.get("pts"):
        site["pts"] = sorted(site["pts"])

    return {
        "mainState": pdd.get("mainState"),
        "mainDistrict": pdd.get("mainDistrict"),
        "caf_revisions": len(pdd.get("commonFormDetails") or []),
        "site": site,
        "toposheets": sorted(toposheets),
        "plots": plots,
        "villages": villages,
        "affected_families": affected,
        "displaced_families": displaced,
        "rnr_involved": rnr,
        "litigation_pending": litigation,
        "violation_involved": violation,
        "land": land,
        "links": links(data),
    }


def _direct_why(st: dict) -> str:
    """Why the direct route is carrying the share it is.

    A bare percentage cannot be acted on. Suspended, out-scored on a bad
    failure rate, and resting are three different problems with three
    different fixes, and over a long unattended run the difference is the
    whole diagnosis.
    """
    d = st.get("direct_route") or {}
    if st.get("direct_blocked"):
        return f"suspended {st.get('direct_blocked_for', 0)}s, {d.get('blocks')} time(s)"
    if d.get("resting"):
        return f"resting, {d.get('rests')} rest(s)"
    seen = (d.get("ok") or 0) + (d.get("fail") or 0)
    rate = (d.get("fail") or 0) / seen if seen else 0
    return (f"ok {d.get('ok')}/{seen} fail {100*rate:.0f}% "
            f"score {d.get('score')} vs best proxy {d.get('best_proxy_score')}")


def load_done(path: Path, require_version: int | None = None,
              answered_only: bool = False) -> set[int]:
    """Ids already recorded, optionally only those at the current reader version.

    Resume is what makes a 30-hour backfill survivable, and it works by never
    re-fetching an id already on disk. That is also how a cache silently
    freezes: change what `extract()` records, and every id fetched under the
    old reader is skipped for ever, so the new fields never appear for them and
    no amount of re-running repairs it. The extract itself is the only record
    of what produced it, so it carries a version, and a run for a newer reader
    treats older records as absent.

    `answered_only` is for the error ledger. A status in SETTLED_STATUSES is a
    definitive answer ABOUT THE PROPOSAL and may retire it, as is a 200 whose
    body carried its own failure (`reason: "unparseable"`) - the service
    answered, and asking again returns the same thing. Everything else is
    about us or about the moment and stays owed. The
    first version of this test admitted every non-negative status, which
    settled 403s from our own block and 404s from proxies serving their error
    pages - 163 proposals retired permanently for reasons that had nothing to
    do with the register, and then published as government non-disclosure.
    """
    done: set[int] = set()
    if not path.exists():
        return done
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except Exception:  # noqa: BLE001
                continue
            if require_version is not None and rec.get("v", 1) != require_version:
                continue
            if answered_only:
                # Only a settled status is a definitive answer. An
                # "unparseable" record - a 200 whose envelope carried a failed
                # status - stays OWED: under load the form server fails forms
                # that exist (D172: 488 of 495 settled "no form" ids answered
                # when re-asked), and retiring the id kept it `pend` for ever
                # with nothing left to read it. Nor is it written as 500,
                # which `build_data` would publish as `cf: "none"`.
                if rec.get("status") not in SETTLED_STATUSES:
                    continue      # not a definitive answer; still owed
            rid = rec.get("id")
            if rid is not None:
                done.add(rid)
    return done


def extract_versions(path: Path) -> dict[int, int]:
    """How many records each reader version wrote. For reporting mixed caches."""
    counts: dict[int, int] = {}
    if not path.exists():
        return counts
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                v = int(json.loads(line).get("v", 1))
            except Exception:  # noqa: BLE001
                continue
            counts[v] = counts.get(v, 0) + 1
    return counts


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workers", type=int, default=24,
                    help="concurrent requests (measured plateau is ~3.4 req/s)")
    ap.add_argument("--limit", type=int, default=0, help="stop after N new fetches")
    ap.add_argument("--shard", default="", help=(
        "i/N: fetch only ids with id %% N == i, over the i-th slice of the "
        "proxy pool, writing to shard files that fetch_parallel.py merges. "
        "One Python process is CPU-bound near 7 forms/s (TLS + parsing on "
        "one core, measured), so speed comes from processes, not threads."))
    ap.add_argument("--max-seconds", type=float, default=0, help=(
        "stop starting new requests after this many seconds, save progress and "
        "exit 3. The scheduled job has a hard time limit; a run killed by it "
        "saves nothing to the Actions cache, so the next night starts from the "
        "same place and the backfill never completes. A run that stops itself "
        "keeps every form it read, and the rest stays owed."))
    ap.add_argument("--category", help="only this category (A, B1, B2)")
    ap.add_argument("--retry-errors", action="store_true",
                    help="also re-attempt ids previously recorded as errors")
    ap.add_argument("--rewrite-stale", action="store_true",
                    help="drop records written by an earlier reader before "
                         "starting, so the file does not carry two shapes")
    ap.add_argument("--ids-file", help=(
        "JSON array of record ids to (re-)fetch, bypassing the resume set. "
        "A proposal whose register row CHANGED needs its per-proposal sources "
        "read again: the cache is keyed on id and never revisited, so one "
        "cached while the proposal was pending keeps that state for ever "
        "while the register moves on around it."))
    args = ap.parse_args()
    run_lock.hold_or_exit("fetch_caf")  # one run against PARIVESH at a time

    cache = cache_dir()
    out_path = cache / "caf" / "caf_extract.jsonl"
    err_path = cache / "caf" / "caf_errors.jsonl"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    shard_i = shard_n = None
    if args.shard:
        shard_i, shard_n = (int(x) for x in args.shard.split("/"))
        # The proxy slice: this process uses only exit IPs hashed to it, so
        # no two processes share an address (and its per-address allowance).
        os.environ["INSTRUMENTS_ROUTE_SHARD"] = args.shard

    if args.rewrite_stale and out_path.exists():
        kept = 0
        tmp = out_path.with_suffix(".jsonl.tmp")
        with open(out_path, encoding="utf-8") as fin, \
                open(tmp, "w", encoding="utf-8") as fkeep:
            for line in fin:
                try:
                    if int(json.loads(line).get("v", 1)) == EXTRACT_VERSION:
                        fkeep.write(line)
                        kept += 1
                except Exception:  # noqa: BLE001
                    continue
        os.replace(tmp, out_path)
        log(f"dropped records from earlier readers; {kept:,} kept")

    # Through the shared reader, which applies the same staleness rule
    # the build does: a fetch writes the sector files and merges after,
    # so a run that died in between leaves a stale merge beside fresh
    # downloads. Reading the merge directly meant a backfill could work
    # from a register older than the sweep that had just run, not know
    # about the proposals it added, and report a clean run.
    records = register_cache.load_records(cache, log)
    versions = extract_versions(out_path)
    stale = {v: n for v, n in versions.items() if v != EXTRACT_VERSION}
    if stale:
        log(f"cache holds {sum(stale.values()):,} records from an earlier "
            f"reader {stale}; they will be re-fetched at version "
            f"{EXTRACT_VERSION}")
    done = load_done(out_path, require_version=EXTRACT_VERSION)
    if not args.retry_errors:
        done |= load_done(err_path, answered_only=True)
    if shard_n:
        # Resume sees every shard's unmerged work too.
        for f in sorted((cache / "caf").glob("caf_extract.shard*.jsonl")):
            done |= load_done(f, require_version=EXTRACT_VERSION)
        if not args.retry_errors:
            for f in sorted((cache / "caf").glob("caf_errors.shard*.jsonl")):
                done |= load_done(f, answered_only=True)
        out_path = cache / "caf" / f"caf_extract.shard{shard_i}.jsonl"
        err_path = cache / "caf" / f"caf_errors.shard{shard_i}.jsonl"
    log(f"register: {len(records):,} records, {len(done):,} already fetched")

    if args.ids_file:
        # Exactly these, whatever the cache holds. The caller has established
        # that their register rows changed, which is the one thing the resume
        # set cannot know.
        wanted = set(json.loads(Path(args.ids_file).read_text(encoding="utf-8")))
        todo = [r for r in records if r.get("id") in wanted]
        log(f"ids-file: re-reading {len(todo):,} of {len(wanted):,} named ids")
    else:
        todo = [r for r in records if r.get("id") and r["id"] not in done]
    if args.category:
        todo = [r for r in todo if (r.get("category") or "") == args.category]
    if shard_n:
        todo = [r for r in todo if int(r["id"]) % shard_n == shard_i]
    # Category A first, then B1, then B2; within a category, newest first so a
    # partial run is weighted to current proposals.
    todo.sort(key=lambda r: r.get("dateOfSubmission") or "", reverse=True)
    todo.sort(key=lambda r: CATEGORY_ORDER.index(r.get("category"))
              if r.get("category") in CATEGORY_ORDER else 9)
    # Every named id, before --limit: one cut by the limit was not answered
    # and must stay in `.left`, or the sync clears it from its queue.
    named = [r["id"] for r in todo]
    if args.limit:
        todo = todo[: args.limit]
    log(f"to fetch: {len(todo):,}")
    if not todo:
        log("nothing to do")
        # Still a report: no report reads as a crash, and the caller would
        # keep the debt (and run this empty pass) every night.
        write_left(args.ids_file, [], set())
        return

    by_id = {r["id"]: r for r in todo}
    answered: set = set()
    started = time.time()
    deadline = started + args.max_seconds if args.max_seconds else None
    aborted = False
    out_of_time = False
    counts = {"ok": 0, "err": 0, "empty": 0}
    recent_errors: list[float] = []
    storm = NET.SettleStorm()
    stop = threading.Event()
    write_lock = threading.Lock()

    def work(rec_id: int):
        if stop.is_set() or (deadline and time.time() > deadline):
            return None
        settled_seen = 0
        for attempt in range(3):
            # The budget is checked before EVERY attempt, and net.py bounds
            # each attempt by it too. Checked once per proposal, a single
            # proposal could spend three attempts of four retries each past
            # the deadline, eating the time reserved for the rebuild.
            if attempt and deadline and time.time() > deadline:
                return None
            status, raw = fetch_one(rec_id, deadline=deadline)
            # Every route busy (spaced or cooling) is a queue, not a failure:
            # wait for one rather than dropping the proposal for this run.
            # Dropping them left 750-3,600 per shard "not attempted" while
            # routes freed up seconds later.
            while (status == -1 and raw == NET.SATURATED_BODY and not stop.is_set()
                   and not (deadline and time.time() > deadline)):
                time.sleep(1 + random.random() * 2)
                status, raw = fetch_one(rec_id, deadline=deadline)
            if status == -1 and raw in NET.NOT_SENT:
                return None          # never sent: owed, not failed
            if status == 200 and raw:
                return rec_id, status, raw
            decision = settle_decision(status, settled_seen, attempt)
            if decision == "owed":
                return None
            if decision == "retry":
                time.sleep((2 ** attempt) + random.random())
                continue
            if decision == "confirm":
                # A SETTLED status is the strongest claim this fetcher makes:
                # it retires the proposal for ever, and the build publishes it
                # as `cf: "none"` - a public statement that the Ministry serves
                # no application form for it. One 500, on one attempt, over one
                # route, was enough to make it.
                #
                # That is fine when the endpoint is healthy and wrong when it
                # is not. A degraded window returning 500 to a tenth of
                # requests sits under the circuit breaker's threshold, moves no
                # pace (a resource answer is credited, not charged), and would
                # mint false claims about a government body at a rate two
                # orders of magnitude above the genuine population of ~300.
                #
                # So it has to say it twice. net.py picks a route per attempt,
                # so the second ask almost always leaves by a different one,
                # and an answer that survives that is about the proposal rather
                # than about the moment. The cost is one extra request per
                # genuinely formless proposal - about 300 over the register.
                settled_seen += 1
                time.sleep(0.5 + random.random())
                continue
            return rec_id, status, raw
        return rec_id, status, raw

    # Routes are reloaded on a CLOCK, not on progress. Free proxies die
    # within hours; tied to "every 200 forms", a run slowed by a dying pool
    # stopped taking up the fresh routes the refresher was writing, and
    # starved - 26 of 30 routes dead, 0.4 forms/s - while live ones sat in
    # the pool file.
    def _reload_loop():
        while not stop.is_set():
            time.sleep(60)
            try:
                n = pool().reload_routes(os.environ.get("INSTRUMENTS_PROXIES"))
                if n:
                    log(f"    egress: {n} new route(s) taken on")
            except Exception:  # noqa: BLE001
                pass
    threading.Thread(target=_reload_loop, daemon=True).start()

    with open(out_path, "a", encoding="utf-8") as fout, \
            open(err_path, "a", encoding="utf-8") as ferr, \
            ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(work, r["id"]): r["id"] for r in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            res = fut.result()
            if res is None:
                continue
            rec_id, status, raw = res
            src = by_id.get(rec_id, {})
            if status == 200 and raw:
                info = extract(raw)
                if info is None:
                    # NOT answered: extract() returns None for an unparseable
                    # body AND for an envelope carrying a failed status, and
                    # the second is a transient server fault. Counted as
                    # answered, a moved proposal left the re-read queue and
                    # kept its superseded form for ever.
                    counts["empty"] += 1
                    with write_lock:
                        ferr.write(json.dumps({"id": rec_id, "status": status,
                                               "reason": "unparseable"}) + "\n")
                else:
                    answered.add(rec_id)
                    info["id"] = rec_id
                    info["v"] = EXTRACT_VERSION
                    info["proposal_id"] = src.get("proposal_id")
                    info["proposalNo"] = src.get("proposalNo")
                    counts["ok"] += 1
                    with write_lock:
                        fout.write(json.dumps(info, ensure_ascii=False,
                                              separators=(",", ":")) + "\n")
            else:
                counts["err"] += 1
                # A settled "no form" is an answer, not a refusal, so it never
                # feeds the breaker: the nightly re-check asks only such ids,
                # and counting them aborted it on a healthy service once twenty
                # genuine absences existed. Nor is it in `answered`, so it stays
                # in `.left`: a changed pass's ids are already cached, the
                # re-check skips cached ids, and a 500 cleared from the queue
                # left the superseded form published for ever.
                if status not in SETTLED_STATUSES:
                    recent_errors.append(time.time())
                with write_lock:
                    ferr.write(json.dumps({
                        "id": rec_id, "status": status,
                        "body": (raw or b"")[:200].decode("utf-8", "replace"),
                    }) + "\n")
            if storm.note(status in SETTLED_STATUSES) and not aborted:
                log("STOPPING: the form server is answering 500 to too many "
                    "proposals for them to be genuine absences. Each settled "
                    "id is re-asked by the nightly recheck_none pass.")
                stop.set()
                aborted = True
                break

            if i % 200 == 0:
                fout.flush()
                ferr.flush()
                elapsed = time.time() - started
                rate = i / elapsed
                left = (len(todo) - i) / rate / 3600 if rate else 0
                # Take on any routes the list has gained since this run began.
                # A six-hour backfill outlives its proxies; refresh_proxies.py
                # can be run alongside it and the pool will pick the new ones up.
                added = pool().reload_routes(os.environ.get("INSTRUMENTS_PROXIES"))
                if added:
                    log(f"    egress: {added} new route(s) taken on")
                st = pool().stats()
                served = st["served"]
                tot = max(1, served["direct"] + served["proxy"])
                log(f"  {i:>7,}/{len(todo):,}  ok={counts['ok']:,} "
                    f"err={counts['err']:,} empty={counts['empty']:,}  "
                    f"{rate:.2f} req/s  ~{left:.1f}h left  |  "
                    f"egress now {st['recent']['direct_pct']}% direct "
                    f"(life {100*served['direct']/tot:.0f}%, "
                    f"{_direct_why(st)}), "
                    f"{st['routes_live']}/{st['routes_total']} routes, "
                    f"conc {st['concurrency']}, pace {NET.current_rps():.1f}/s, "
                    f"{st['transport_failures']:,} dead-proxy sends")
                try:
                    (cache / "caf" / "route_tally.json").write_text(json.dumps(
                        [[k[0], k[1], v] for k, v in NET.ROUTE_TALLY.items()]), encoding="utf-8")
                except Exception:  # noqa: BLE001
                    pass
                log(f"    answers {dict(NET.ANSWER_TALLY.most_common(6))}  "
                    f"observe {dict(NET.OBSERVE_TALLY.most_common(6))}")

            if deadline and time.time() > deadline and not out_of_time:
                # Queued work returns at once from here on; requests already
                # in flight are allowed to finish and are written.
                out_of_time = True
                stop.set()
                log(f"TIME BUDGET of {args.max_seconds:.0f}s reached; "
                    "stopping new requests, keeping everything read so far.")

            # Circuit breaker: if the last 100 outcomes are more than a quarter
            # errors, the server is refusing and continuing is abuse, not
            # persistence.
            cutoff = time.time() - 120
            recent_errors[:] = [t for t in recent_errors if t > cutoff]
            # Absolute OR proportional. The absolute arm needs 200 attempts
            # before it can fire, which a nightly delta of a few dozen new
            # proposals never reaches - so a run in which EVERY request failed
            # exited 0 and the sync treated it as a completed backfill.
            failing_hard = i >= 20 and len(recent_errors) > i * 0.5
            if (len(recent_errors) > 60 and i > 200) or failing_hard:
                log("STOPPING: sustained error rate over the last two minutes. "
                    "Re-run later; progress is saved and the run resumes.")
                stop.set()
                aborted = True
                break

    elapsed = time.time() - started
    # A proposal skipped because the budget ran out returns None and is
    # counted nowhere - so a run could finish its loop with work left, having
    # never reached the in-loop budget check (it sits after the `continue`),
    # and exit 0 as if complete. Whatever is left unattempted without an abort
    # is, by construction, out of time.
    unattempted = len(todo) - counts["ok"] - counts["err"] - counts["empty"]
    if unattempted > 0 and not aborted:
        out_of_time = True
    log(f"\ndone in {elapsed/60:.1f} min  ok={counts['ok']:,} "
        f"err={counts['err']:,} empty={counts['empty']:,}")
    summary = {
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "attempted": len(todo), **counts,
        "aborted": aborted,
        "out_of_time": out_of_time,
        "remaining": max(0, len(todo) - counts["ok"] - counts["err"]
                         - counts["empty"]),
        "seconds": round(elapsed, 1),
        "total_cached": len(load_done(out_path)),
        # Send efficiency: requests sent, how many died in transport (dead
        # proxies; never reached the service) and routes banned by 403.
        "sends": pool().stats()["sends"],
        "transport_failures": pool().stats()["transport_failures"],
        "banned_routes": pool().stats()["banned"],
        "max_rps": NET.MAX_RPS,
    }
    (cache / "caf" / (f"last_run.shard{shard_i}.json" if shard_n else "last_run.json")).write_text(
        json.dumps(summary, indent=2), encoding="utf-8")
    write_left(args.ids_file, named, answered)
    log(json.dumps(summary))
    if aborted:
        # A backfill that stopped early is not a backfill that finished. The
        # caller branches on this exit code and nothing else, so returning 0
        # here let the nightly sync advance its watermark, publish, and report
        # a complete check over a register whose new proposals were never
        # fetched. Every gate downstream still passes, because the data that
        # IS there is perfectly consistent - it is simply missing.
        log("ABORTED with " + f"{summary['remaining']:,}" + " of "
            + f"{len(todo):,}" + " not attempted. Exiting non-zero so the "
            "caller does not treat this as a completed backfill.")
        raise SystemExit(2)
    if out_of_time:
        # Healthy, unfinished. Distinct from 2 (the service was refusing):
        # the caller keeps the remainder owed and reports the night partial.
        log(f"OUT OF TIME with {summary['remaining']:,} of {len(todo):,} "
            "not attempted; they stay owed for the next run.")
        raise SystemExit(3)


if __name__ == "__main__":
    main()
