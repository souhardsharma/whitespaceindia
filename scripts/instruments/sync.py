"""Incremental sync for Instrument 01. This is what keeps the instrument true.

WHY THIS EXISTS
---------------
The clearance register is live: proposals are filed, appraised and decided
every day. A dataset scraped once and left alone is worse than no dataset,
because it looks current and is not. This script is the thing that runs on a
schedule and keeps the published data honest.

WHAT IT DOES
------------
  1. Sweep the register in full, per sector. PARIVESH accepts startDate and
     endDate, but they filter on the SUBMISSION date - so a window returns
     proposals FILED in it, not proposals that CHANGED in it. Measured over
     the register: 93.8% of proposals were last updated more than a week after
     they were submitted, so a two-day window reaches almost none of the
     status changes a sync exists to catch. A full sweep of all ten sectors is
     ~130 MB and ~90 seconds, which is a small price for the difference
     between a register that tracks the source and one that only looks like
     it does. A delta remains available for a targeted catch-up.
  2. Merge the delta into the cached register, keyed on proposal_id. Records
     that already exist are REPLACED, because status changes - a proposal moves
     from "ToR Granted" to "EC Granted" and the old row is stale.
  3. Read the per-proposal sources in three passes - `changed` (ids whose
     register row moved), `new` (ids not yet cached) and `rolling` (a seventh of
     open proposals' appraisal histories each night) - for both the Common
     Application Form and the appraisal history. Each pass is given what is
     left of --budget-minutes and stops itself when it runs out; unread ids
     stay owed in a durable queue.
  4. Rebuild every published artifact into a CANDIDATE folder, run every
     invariant and the full published-data contract there, and only then swap
     it in for public/data/instruments/consent. A failed run changes nothing.
  5. Write a freshness record (freshness.json) carrying when the register was
     read and whether the read was complete. The footer of every instrument
     page renders it (components/instruments/RegisterCurrency.tsx).

If any stage fails the previously published data is left alone. A stale dataset
that says it is stale beats a half-written one that does not.

SCHEDULING
----------
Designed to run unattended, daily. Either:
  - GitHub Actions on a cron, committing the regenerated JSON (see
    .github/workflows/instruments-sync.yml), or
  - any host scheduler invoking:  python scripts/instruments/sync.py --full

Run from the project root:
  python scripts/instruments/sync.py --full                        # the scheduled run
  python scripts/instruments/sync.py --full --budget-minutes 75    # under a job timeout
  python scripts/instruments/sync.py --since 2026-08-01            # targeted catch-up only
  python scripts/instruments/sync.py --dry-run           # report, change nothing
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import net as NET  # noqa: E402
import run_lock  # noqa: E402
from register_cache import merge_forest_states  # noqa: E402
ROOT = SCRIPTS.parent.parent
PUBLISHED = ROOT / "public" / "data" / "instruments" / "consent"

PARIVESH_SEARCH = ("https://parivesh.nic.in/parivesh_api/trackYourProposal/"
                   "advanceSearchData?majorClearanceType=1&sector={sector}")
SECTORS = {
    2: "Industrial Projects - 1", 3: "Non-Coal Mining", 4: "Thermal Projects",
    5: "River Valley and Hydroelectric Projects", 6: "INFRA-2",
    7: "Nuclear Projects", 8: "INFRA-1", 10: "Industrial Projects - 2",
    11: "Coal Mining", 13: "Industrial Projects - 3",
}
# What "is the direct route working" is asked with. Cheap on purpose.
PROBE_URL = ("https://parivesh.nic.in/parivesh_api/trackYourProposal/"
             "getListOfSector")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")

# A delta window this wide means something went wrong with the state file, or
# the sync has not run in a long time. Fall back to a full sweep rather than
# asking a government server for a two-year range ten times over.
MAX_DELTA_DAYS = 45

# What "this row moved" means. All of them, because each can move without the
# others: the queue label, the last-modified stamp (absent on ~18% of rows),
# and the two submission dates, which advance when a proposal is re-submitted
# with a corrected application.
CHANGE_FIELDS = ("proposalStatus", "app_updated_on",
                 "dateOfSubmission", "last_submission_date")


def log(msg: str) -> None:
    print(f"[sync] {msg}", flush=True)


def cache_dir() -> Path:
    d = os.environ.get("INSTRUMENTS_CACHE_DIR", "")
    if not d:
        sys.exit("ERROR: INSTRUMENTS_CACHE_DIR is not set.")
    return Path(d)


def state_path(cache: Path) -> Path:
    return cache / "sync_state.json"


def load_state(cache: Path) -> dict:
    p = state_path(cache)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


_POOL = None


def pool():
    """The egress the scheduled run uses.

    The same routing the backfills use, for the same reason. This is the path
    that runs unattended every night: if it depends on one address and that
    address is withdrawn, the instrument silently stops being current and the
    only symptom is a red job nobody is watching. See net.py.
    """
    global _POOL
    if _POOL is None:
        # The LIGHTEST endpoint the service has, ~800 bytes. Splitting the
        # search URL at its first "&" stripped the sector filter and turned
        # this into the unfiltered advanceSearchData call - the one this
        # project documents as returning about 128 MB. Every scheduled run was
        # asking a government server to build the entire register just to see
        # whether the route answered, then reading the status line and hanging
        # up; and because that query is the slowest one available, a timeout
        # on it stood the direct route down before any real work began.
        _POOL = NET.build_pool(probe_url=PROBE_URL, max_workers=8)
        # The sweeps download 130 MB of register and 35 MB of forest records;
        # they go down our own verified route and use proxies only while it
        # is stood down. The per-proposal passes are separate processes and
        # keep the default mix.
        _POOL.direct_share = 1.0
        n = len(_POOL.routes) - 1
        log(f"egress: direct "
            f"{'BLOCKED, using proxies' if _POOL.blocked_direct else 'available'}"
            f", {n} proxy route(s)")
        if _POOL.blocked_direct and not n:
            log("WARNING: the direct route is refusing and no proxy routes are "
                "configured. Set INSTRUMENTS_PROXIES, or run "
                "scripts/instruments/refresh_proxies.py to build a pool.")
    return _POOL


# Seconds between a sweep call's attempts: a sector that failed is a server
# struggling with one large query, and asking again at once does not help it.
SWEEP_BACKOFF = (10.0, 30.0, 60.0, 120.0)


def fetch(url: str, timeout: int = 300, deadline: float | None = None) -> bytes:
    """One register call, over whichever route is healthy.

    Raises on total failure so the caller's per-sector error handling still
    sees a failure rather than an empty body it might merge as "no records".
    `deadline` bounds it, retries included: five attempts at a 300-second
    timeout is 25 minutes for one sector, and the sweeps had no bound at all.
    """
    # A sector or State call has no "absent" answer: its 500 is retried. Each
    # failed attempt is logged and waited out before the next. Retried back to
    # back inside one get(), the 2026-10-20 sweep spent five attempts on
    # sector 2 in about two minutes and reported only the last, a dead proxy,
    # so what our own route had answered was never seen.
    status, body = -1, b""
    for i, pause in enumerate(SWEEP_BACKOFF + (None,), 1):
        status, body = NET.get(pool(), url, timeout=timeout, attempts=1,
                               deadline=deadline, final=frozenset())
        if status == 200:
            return body
        log(f"    attempt {i}: HTTP {status} "
            f"{body[:160].decode('utf-8', 'replace')!r}")
        if pause is None or body == NET.DEADLINE_BODY:
            break
        if deadline is not None:
            pause = min(pause, deadline - time.time())
            if pause <= 0:
                break
        time.sleep(pause)
    raise RuntimeError(
        f"register fetch failed after retries: HTTP {status} "
        f"{body[:200].decode('utf-8', 'replace')}")


def fetch_delta(since: str | None,
                deadline: float | None = None) -> tuple[list[dict], dict]:
    """Fetch the register, optionally windowed. Returns (records, per-sector stats)."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    records: list[dict] = []
    stats: dict = {}
    for sid, name in SECTORS.items():
        url = PARIVESH_SEARCH.format(sector=sid)
        if since:
            url += f"&startDate={since}&endDate={today}"
        t0 = time.time()
        try:
            raw = fetch(url, deadline=deadline)
            payload = json.loads(raw.decode("utf-8", "replace"))
            # The HTTP status is not the answer. This API carries its own
            # status inside a 200 body - both per-proposal fetchers already
            # check it - so a sector whose backing query failed server-side
            # arrives here as a perfectly good 200 with no `data`. Read as
            # "zero rows", that is indistinguishable from a quiet day: the
            # sector counts as covered, the watermark advances past it, and
            # every status change in that window is never asked for again.
            env = payload.get("status")
            if env is not None and int(env) != 200:
                raise RuntimeError(
                    f"sector answered HTTP 200 carrying status {env}: "
                    f"{str(payload.get('message') or payload)[:160]}")
            # `is None` too, not just absent. {"data": null} collapsed to
            # zero rows one line later and read as a quiet day - the exact
            # case this check was written to reject.
            if payload.get("data") is None:
                raise RuntimeError(
                    "sector answered HTTP 200 with no `data` key at all, so "
                    "there is no way to tell an empty window from a failed "
                    "query: " + str(payload)[:160])
            rows = payload.get("data") or []
            records.extend(rows)
            stats[name] = {"records": len(rows), "bytes": len(raw),
                           "seconds": round(time.time() - t0, 1)}
            log(f"  sector {sid:2} {name[:32]:34} {len(rows):>6,} rows  "
                f"{len(raw)/1024:>8,.0f} KB  {time.time()-t0:>5.1f}s")
        except Exception as exc:  # noqa: BLE001
            stats[name] = {"error": str(exc)[:200]}
            log(f"  sector {sid:2} {name[:32]:34} FAILED: {exc}")
    return records, stats


# The forest-clearance register is swept by STATE, and its state filter takes
# LGD state codes, not the ids getListOfAllState returns - asked with the
# list's id 36, it answered with Telangana (LGD 36), not West Bengal. Every
# code 1..38 is asked, and proposals are de-duplicated by id, so a code that
# names no State costs one empty answer and nothing is missed by a mapping.
FOREST_SEARCH = ("https://parivesh.nic.in/parivesh_api/trackYourProposal/"
                 "advanceSearchData?majorClearanceType=2&state={code}")
LGD_STATE_CODES = range(1, 39)


def forest_rows_in(path: Path) -> int:
    try:
        return len(json.loads(path.read_text(encoding="utf-8")).get("data") or [])
    except Exception:  # noqa: BLE001
        return 0


def fetch_forest(cache: Path, deadline: float | None = None) -> dict:
    """Sweep the forest-clearance register and cache it.

    The environmental clearance form names its forest proposal by number
    (FP/...); this register is where that proposal's own current stage is
    recorded - Stage-I, a final diversion order, a rejection. ~30,000 records,
    ~35 MB, a few minutes. A state that fails leaves the previous copy of that
    state's records in place rather than dropping them.

    "Fails" includes answering badly: the envelope's own status (the register
    sweep learned this the hard way - a failed query arrives as HTTP 200), and
    an EMPTY answer for a state whose last read held records. The forest
    register does not lose a whole State's proposals overnight; an empty list
    there is a failed query, and writing it would erase that State's forest
    stages from every proposal page.

    `forest_meta.json` records when the register was last actually read. The
    merged file's modification time was used before, and it is rewritten even
    when every state code failed.
    """
    folder = cache / "parivesh" / "forest"
    folder.mkdir(parents=True, exist_ok=True)
    stats = {"codes": 0, "failed": [], "records": 0}
    for code in LGD_STATE_CODES:
        if deadline is not None and time.time() > deadline:
            stats["failed"].append({"code": code, "error": "out of time"})
            continue
        try:
            raw = fetch(FOREST_SEARCH.format(code=code), timeout=300,
                        deadline=deadline)
            payload = json.loads(raw.decode("utf-8", "replace"))
            env = payload.get("status")
            if env is not None and int(env) != 200:
                raise RuntimeError(f"answered HTTP 200 carrying status {env}")
            if payload.get("data") is None:
                raise RuntimeError("no `data` in the answer")
            target = folder / f"state_{code}.json"
            held = forest_rows_in(target) if target.exists() else 0
            if not payload["data"] and held:
                raise RuntimeError(f"answered with no records where {held:,} "
                                   "were held; keeping the previous copy")
            target.write_bytes(raw)
            stats["codes"] += 1
            stats.setdefault("read", {})[str(code)] = datetime.now(timezone.utc).isoformat()
        except Exception as exc:  # noqa: BLE001
            stats["failed"].append({"code": code, "error": str(exc)[:120]})
            log(f"  forest register, state code {code}: FAILED ({exc})")
    stats["records"] = merge_forest_states(cache)
    meta_path = cache / "parivesh" / "forest_meta.json"
    try:
        prior = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        prior = {}
    stats["complete"] = not stats["failed"]
    # WHEN EACH STATE CODE WAS LAST READ. A code that failed tonight keeps
    # the date of its last good read, so a page never dates an old record
    # by tonight's sweep - with one date for the whole register, a night on
    # which 37 of 38 codes failed stamped every forest status "read today".
    codes = {**(prior.get("codes") or {}), **stats.pop("read", {})}
    if prior.get("read_at") and not prior.get("codes"):
        for c in LGD_STATE_CODES:
            codes.setdefault(str(c), prior["read_at"])
    stats["read_at"] = min(codes.values()) if codes else None
    meta_path.write_text(json.dumps({
        "read_at": stats["read_at"], "complete": stats["complete"],
        "codes_read": stats["codes"], "codes": codes,
        "failed": [f["code"] for f in stats["failed"]],
    }, indent=1), encoding="utf-8")
    log(f"forest register: {stats['records']:,} proposals from {stats['codes']} state "
        f"codes ({len(stats['failed'])} failed)")
    return stats


def merge(cache: Path, delta: list[dict], read_something: bool = True,
          sector_stats: dict | None = None) -> dict:
    """Merge delta into the cached register, replacing changed records."""
    path = cache / "parivesh" / "all_records.json"
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    by_id = {r.get("proposal_id"): r for r in existing}
    before = len(by_id)

    added = updated = unchanged = 0
    changed_ids: list = []
    for rec in delta:
        pid = rec.get("proposal_id")
        if pid is None:
            continue
        prior = by_id.get(pid)
        if prior is None:
            added += 1
        # Every field the register moves when a proposal changes. Status
        # alone is not enough: a proposal returned, corrected and
        # re-submitted keeps its queue label while its CAF gains a whole
        # new revision - different plots, different declared land,
        # different family counts - and the pipeline would go on
        # publishing the superseded filing for ever. app_updated_on is a
        # real field but null on about 18% of the register, so on those
        # rows it contributes nothing and the submission dates are the
        # only signal there is.
        elif any(prior.get(k) != rec.get(k) for k in CHANGE_FIELDS):
            updated += 1
        else:
            unchanged += 1
            continue
        # UPDATED rows only. A proposal seen for the first time is fetched by
        # the "new" pass, which exists for exactly that - queueing it here as
        # well had every new proposal fetched twice a night, by both fetchers,
        # for nothing.
        if rec.get("id") is not None and prior is not None:
            changed_ids.append(rec["id"])
        by_id[pid] = rec

    merged = list(by_id.values())
    if not read_something:
        # Every sector failed, so `delta` is empty and this merge is just the
        # cache written back over itself. Doing that re-dates the file, and
        # the staleness check in build_data.load_register() compares that date
        # against the sector files - so a night that read nothing would make
        # the merge look NEWER than the sources it was built from, which is
        # the one thing that check exists to detect.
        return {"before": before, "after": len(merged), "added": added,
                "updated": updated, "unchanged": unchanged,
                "changed_ids": changed_ids}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(merged, separators=(",", ":"), ensure_ascii=False),
                    encoding="utf-8")

    # Record WHEN the register was read. build_data reads this to date the
    # source in meta.json and to measure how long open proposals have been
    # open. Only --fetch used to write it, and --fetch is not the path this
    # runs, so the stamp froze at the last manual fetch while the register
    # underneath it moved on - every open proposal's clock stopping with it.
    stamp_path = cache / "fetch_stamps.json"
    try:
        stamps = json.loads(stamp_path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        stamps = {}
    stamps["fetched_at"] = datetime.now(timezone.utc).isoformat()
    stamps["fetched_by"] = "sync.py"
    # This run's per-sector figures, not the last manual fetch's. Updating
    # only the timestamp left a stamp dated today beside byte counts from
    # weeks earlier - a record that disagreed with itself.
    if sector_stats is not None:
        stamps["sectors"] = [{"name": n, **v} for n, v in sector_stats.items()]
    stamps["merged_records"] = len(merged)
    stamp_path.write_text(json.dumps(stamps, indent=2), encoding="utf-8")

    # before + added == after, and the rows this sweep did NOT return (still
    # held, never deleted) close the count: not_returned = before - updated -
    # unchanged. Without it the published tallies did not add up.
    return {"before": before, "after": len(merged), "added": added,
            "updated": updated, "unchanged": unchanged,
            "not_returned": before - updated - unchanged,
            "changed_ids": changed_ids}


def queue_rereads(pending: dict, moved, fetchers=("caf", "history")) -> dict:
    """Add this run's moved ids to every fetcher's outstanding debt.

    ADDITIVE, because merge() advances the cached register in the same call
    that reports what moved: an id seen as changed tonight reads as unchanged
    tomorrow, so if the pass meant to consume it fails and the queue is
    rebuilt from that run alone, the proposal is never asked for again. Its
    appraisal history stays frozen before the decision step, it publishes a
    null duration, and nothing anywhere records that anything is owed.
    """
    out = dict(pending or {})
    m = {int(x) for x in (moved or [])}
    for k in fetchers:
        out[k] = sorted({int(x) for x in (out.get(k) or [])} | m)
    return out


def discharge(pending: dict, name: str, consumed: bool,
              left: list | None = None) -> dict:
    """Clear one fetcher's debt, and only what was actually paid.

    `left` is what the fetcher itself reports as still owed after a pass that
    completed (`<ids-file>.left`): an id whose re-read failed without tripping
    the breaker stays queued instead of being cleared with the rest.
    """
    out = dict(pending or {})
    if consumed:
        out[name] = sorted({int(x) for x in (left or [])})
    return out


def changed_pass_left(ids_path: Path) -> list | None:
    """The ids a changed pass reports it did not answer, or None if it left no report.

    The fetcher writes `<ids-file>.left` before exiting 0, 2 or 3, so the
    report is exact whatever the exit code. Read only on exit 0, a pass that
    ran out of time kept its whole debt: one read 2,301 forms and still queued
    all 8,301 for re-reading. No report (the process died) is not "nothing
    owed", so None keeps the debt.
    """
    try:
        return json.loads(Path(str(ids_path) + ".left").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def rolling_slot(when, n: int) -> int:
    """Which slice of the open register this run re-reads.

    Days since the proleptic epoch, not day-of-year. tm_yday restarts at 1
    every January and 365 % 7 == 1 == 1 % 7, so 31 December and 1 January pick
    the SAME slice: one runs twice and another is skipped, leaving that slice's
    open proposals fourteen days between reads instead of seven. An ordinal
    never restarts, so the cycle is unbroken across a year boundary and across
    a leap year.
    """
    return when.toordinal() % n


def next_watermark(previous: str | None, finished: str,
                   failed_sectors: list[str],
                   incomplete_backfill: bool = False) -> str | None:
    """Where the next delta should start from, after this run.

    The watermark is a claim about ground covered, so it may only advance over
    ground actually covered. A sector that failed leaves a hole in this
    window; advancing past it means the next delta begins after the hole and
    nothing ever asks for those changes again. The proposals in it keep a
    stale status permanently, while the job goes green and the site reports a
    successful check - the failure is invisible from every direction.

    Holding the watermark makes the next run re-cover the window. The merge is
    keyed on proposal_id and replaces, so re-fetching costs only bandwidth. If
    a sector keeps failing, the held window widens until MAX_DELTA_DAYS turns
    it into a full sweep, which is the right escalation.
    """
    # BOTH kinds of hole. A sector that failed leaves part of the register
    # unread; a backfill that aborted leaves the per-proposal sources unread
    # for proposals the register did return. The first version of this took
    # only `failed_sectors`, so a run could log "watermark held" and advance
    # the watermark in the same breath - and the escalation to a full sweep
    # could never fire for a backfill failure, however many nights it ran.
    if failed_sectors or incomplete_backfill:
        return previous
    return finished


# Kept back from the per-proposal passes for the rebuild, the change log and
# the contract that follow them inside this process: about five minutes on a
# warm cache, more than doubled. The cache save, commit and push after the
# sync are the WORKFLOW's margin (job timeout minus --budget-minutes), not
# this one. Eight minutes proved too little once a single form could spend
# several minutes in retries; each attempt is now bounded by the deadline too.
REBUILD_RESERVE_S = 12 * 60

# The share of the time left that each pass may take when it starts. The
# changed passes are small and repair proposals that moved, so they run first
# for both sources. `new` for the CAF used to take everything left, and an
# EXTRACT_VERSION bump makes that pass ~116,000 forms long - so the history
# passes were skipped for about ten nights, decisions published null
# durations, and the change log under-counted what was decided. The re-check
# of "no form" ids is small and paced (RECHECK_RPS) and runs BEFORE rolling,
# which takes everything left: last, it was skipped on every budgeted night.
PASS_PLAN = (
    ("caf", "changed", 0.5),
    ("history", "changed", 0.5),
    ("caf", "new", 0.5),
    ("history", "new", 0.7),
    ("caf", "recheck_none", 0.5),
    ("history", "recheck_none", 0.5),
    ("history", "rolling", 1.0),
)

# Passes that re-ask what is already published rather than cover the
# register: running out of time in one leaves nothing unread, so it never
# marks a night partial. `rolling` re-reads cached histories and takes all the
# time left, so on a budgeted night it nearly always ends out of time; counted
# as a hole, it would have marked every such night partial.
REVISIT_PASSES = frozenset({"recheck_none", "rolling"})

# The pace for re-asking proposals published as "the portal serves no form".
# Measured on 2026-09-25: 488 of 495 such proposals returned a form when
# re-asked one at a time at 3/s - the 500s that settled them were the form
# server failing under load, not absences. Re-asked every night, gently,
# they are published as `none` only while the server keeps saying so.
RECHECK_RPS = "3"


# Each fetcher's error ledger and record file, for settled_absent().
LEDGERS = {"caf": ("caf/caf_errors.jsonl", "caf/caf_extract.jsonl"),
           "history": ("history/history_errors.jsonl", "history/history.jsonl")}


def settled_absent(cache: Path, name: str = "caf") -> list:
    """Ids the error ledger settles as absent (500) that hold no record."""
    ledger, forms = (cache / rel for rel in LEDGERS[name])
    if not ledger.exists():
        return []
    ids = set()
    for line in ledger.read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get("status") == 500 and e.get("id") is not None:
            ids.add(int(e["id"]))
    if forms.exists() and ids:
        with open(forms, encoding="utf-8") as fh:
            for line in fh:
                try:
                    ids.discard(int(json.loads(line).get("id")))
                except (json.JSONDecodeError, TypeError, ValueError):
                    continue
    return sorted(ids)
# Threads per fetcher. An upper bound, not a rate: net.py's ceiling follows the
# proxy pool and MAX_RPS bounds what the service sees (tuned 2026-09-25; see
# net.py). 20 and 16 capped a night at a fraction of what the pool can carry.
PARALLEL_PROCS = max(2, min(8, os.cpu_count() or 2))
FETCHERS = {"caf": ("fetch_caf.py", "1500"),
            "history": ("fetch_process_history.py", "1500")}

# Consecutive FAULTY nights (see next_streak) before the job fails. One is
# ordinary and is published with a warning; this many in a row is a fault
# nobody is looking at, and a red job is the only thing that will make someone
# look. A night that simply ran out of budget is progress, not a fault.
PARTIAL_FAIL_AFTER = 3


def next_streak(previous: int, failed_sectors, backfills: dict) -> int:
    """Nights in a row with a FAULT: a sector that failed, or a fetcher that
    aborted or died. A pass that ran out of time (exit 3) is not one - it is
    how a backfill after an EXTRACT_VERSION bump, or a start without a seed,
    makes progress for several nights, and counting it would turn the job red
    on the third night of expected work. A --since run is not one either."""
    faulty = bool(failed_sectors) or any(
        (b or {}).get("exit") not in (0, 3, None) for b in (backfills or {}).values())
    return int(previous or 0) + 1 if faulty else 0


def recover_published(published: Path) -> None:
    """Put the published folder back if a promote died between its renames."""
    outgoing = published.with_name(published.name + ".outgoing")
    if not published.exists() and outgoing.exists():
        _rename(outgoing, published)
        log(f"recovered {published.name} from an interrupted promote")


def _rename(src: Path, dst: Path, tries: int = 6) -> None:
    """Rename, retrying: on Windows a folder with an open handle in it - an
    editor, a file watcher, Explorer - refuses the rename for a moment."""
    for i in range(tries):
        try:
            src.rename(dst)
            return
        except PermissionError:
            if i == tries - 1:
                raise
            time.sleep(0.5 * (i + 1))


def _remove_tree(d: Path, tries: int = 6) -> None:
    """rmtree, retrying while Windows holds a file in it open. A half-removed
    `.outgoing` left by `ignore_errors` once failed every later promote."""
    for i in range(tries):
        if not d.exists():
            return
        try:
            shutil.rmtree(d)
            return
        except PermissionError:
            if i == tries - 1:
                raise
            time.sleep(0.5 * (i + 1))


def promote(candidate: Path, published: Path) -> None:
    """Replace the published folder with the candidate, as one step.

    Copied beside the published folder first (the candidate may be on another
    volume, where a rename cannot reach), then swapped in by two renames. A
    reader - or a crash - never sees half the files from one build and half
    from another. Files the new build no longer writes are removed with the
    old folder rather than left to be served stale.
    """
    incoming = published.with_name(published.name + ".incoming")
    outgoing = published.with_name(published.name + ".outgoing")
    # A previous promote that died between its two renames left the only copy
    # of the published data in .outgoing. Deleting .outgoing first, as this
    # once did unconditionally, would destroy it.
    recover_published(published)
    for d in (incoming, outgoing):
        _remove_tree(d)
    shutil.copytree(candidate, incoming)
    _rename(published, outgoing)
    try:
        _rename(incoming, published)
    except Exception:
        _rename(outgoing, published)    # put the old data back before failing
        raise
    shutil.rmtree(outgoing, ignore_errors=True)


def run(cmd: list[str], env: dict | None = None) -> tuple[int, str]:
    """Run a fetcher, passing its progress through to this log as it comes.

    Captured until exit, a pass that ran for hours showed nothing at all: on
    2026-10-20 a stalled CAF pass and a history pass that was waiting could
    not be told apart from outside, and both looked like a quiet log.
    """
    proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True,
                            encoding="utf-8", errors="replace",
                            env={**os.environ, **(env or {})})
    lines = []
    try:
        for line in proc.stdout:
            lines.append(line)
            print(f"    | {line.rstrip()}", flush=True)
    except BaseException:
        # subprocess.run killed its child on any exception, Ctrl-C included;
        # a fetcher left behind keeps reading PARIVESH with nobody watching.
        proc.kill()
        proc.wait()
        raise
    return proc.wait(), "".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--since-last", action="store_true",
                   help=("delta from the last successful sync. NOT the "
                         "scheduled mode: PARIVESH filters on SUBMISSION "
                         "date, so a window cannot see a status change on a "
                         "proposal submitted earlier - and 93.8%% of the "
                         "register is touched more than a week after it was "
                         "submitted. Use for a targeted catch-up only."))
    g.add_argument("--since", help="delta from this date, YYYY-MM-DD")
    g.add_argument("--full", action="store_true",
                   help=("sweep every sector in full. This is what happens "
                         "when no window is given; the flag exists so the "
                         "scheduled job states its intent rather than relying "
                         "on the absence of an argument."))
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch and report, but publish nothing")
    ap.add_argument("--budget-minutes", type=float, default=0, help=(
        "wall-clock budget for the whole run. The per-proposal passes are "
        "given what is left after reserving time for the rebuild, and stop "
        "themselves when it runs out, keeping what they read - so a run "
        "under a hard job timeout ends cleanly, saves its cache, and the "
        "remainder stays owed. 0 means no budget (a local run)."))
    ap.add_argument("--skip-caf", "--skip-backfills", dest="skip_caf",
                    action="store_true",
                    help=("skip BOTH per-proposal backfills - the Common "
                          "Application Form and the appraisal history. The "
                          "old name named only the CAF while gating both, so "
                          "a run meant to skip one silently skipped the other "
                          "and published null durations for anything decided "
                          "since."))
    ap.add_argument("--check-streak", action="store_true", help=(
        "read the last run's state and exit 4 if the register has not been "
        f"covered for {PARTIAL_FAIL_AFTER} nights running; no network"))
    args = ap.parse_args()
    if args.check_streak:
        st = load_state(cache_dir())
        streak = int(st.get("partial_streak") or 0)
        log(f"partial nights in a row: {streak}")
        if streak >= PARTIAL_FAIL_AFTER:
            log(f"FAILING: {streak} consecutive nights did not cover the "
                "register. What was read was published and passed every "
                "check, but something is persistently wrong.")
            sys.exit(4)
        return
    run_lock.hold_or_exit("sync")  # one run against PARIVESH at a time

    cache = cache_dir()
    started = datetime.now(timezone.utc)
    deadline = (time.time() + args.budget_minutes * 60
                if args.budget_minutes else None)
    state = load_state(cache)
    recover_published(PUBLISHED)

    since: str | None = None
    if args.since:
        since = args.since
    elif args.since_last:
        last = state.get("last_success")
        if last:
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            age_days = (started - last_dt).days
            if age_days > MAX_DELTA_DAYS:
                log(f"last sync was {age_days} days ago, exceeding the "
                    f"{MAX_DELTA_DAYS}-day delta limit - doing a full sweep")
            else:
                # Overlap by two days. The register's date fields reflect
                # submission, not last modification, so a tight window can miss
                # a record whose status changed without its date moving.
                since = (last_dt - timedelta(days=2)).strftime("%Y-%m-%d")
        else:
            log("no previous sync recorded - doing a full sweep")

    if since:
        log("WARNING: this is a submission-date window, so it will NOT see a "
            "status change on any proposal submitted before it. A scheduled "
            "run should sweep in full.")
    log(f"register fetch: {'full sweep' if not since else f'delta since {since}'}")
    sweep_deadline = (deadline - REBUILD_RESERVE_S) if deadline else None
    delta, sector_stats = fetch_delta(since, sweep_deadline)
    # WHEN THE REGISTER WAS READ, captured here. The run continues for a long
    # while after this - two backfills and a full rebuild - and stamping the
    # end of all that as the read time overstates currency by however long the
    # rest took, which on a cold night is over an hour.
    register_read_at = datetime.now(timezone.utc)
    log(f"fetched {len(delta):,} records")
    forest_stats = {"skipped": True}
    if not args.dry_run:
        # Bounded to a quarter of what is left: the forest register enriches
        # proposals, the per-proposal passes keep them current, and a slow
        # night on the forest endpoint must not starve the second.
        forest_deadline = None
        if deadline:
            forest_deadline = time.time() + max(
                0.0, (deadline - REBUILD_RESERVE_S - time.time()) * 0.25)
        forest_stats = fetch_forest(cache, forest_deadline)

    if not delta and since:
        log("no records in this window; nothing to merge")

    if args.dry_run:
        log("dry run - stopping before any write")
        print(json.dumps({"fetched": len(delta), "sectors": sector_stats}, indent=1))
        return

    failed_sectors = sorted(n for n, st in sector_stats.items() if "error" in st)
    if failed_sectors:
        log(f"{len(failed_sectors)} of {len(SECTORS)} sectors failed: "
            f"{', '.join(s[:28] for s in failed_sectors)}")

    merge_stats = merge(cache, delta,
                        read_something=len(failed_sectors) < len(SECTORS),
                        sector_stats=sector_stats)
    log(f"register merged: {merge_stats['before']:,} -> {merge_stats['after']:,} "
        f"(+{merge_stats['added']:,} new, {merge_stats['updated']:,} updated, "
        f"{merge_stats['unchanged']:,} unchanged)")

    # Both per-proposal sources, not just one. The register says a proposal
    # moved; the CAF says where it is; the appraisal history says how long it
    # took. Fetching only the first two meant history.jsonl froze at the last
    # manual backfill, so every proposal decided after that date found no
    # matching decision step, published a null duration, and dropped out of
    # both `days_to_decision` and `days_pending` - the timing quietly emptying
    # while the register kept growing.
    backfills: dict = {}
    incomplete_backfill = False
    if not args.skip_caf and (merge_stats["added"] or merge_stats["updated"]
                              or not since):
        # The ids whose register row actually moved. Both caches are keyed on
        # id and never revisited, so without this a proposal cached while it
        # was pending keeps that state for ever: its CAF is never re-read and
        # its appraisal history never gains the decision step, so it publishes
        # a null duration while the register plainly says it was decided.
        # A DURABLE queue, per fetcher. merge() advances the cached register
        # in the same call that reports what moved, so an id observed as
        # changed is never observable as changed again: next run the cache
        # already holds the new status and the row reads as unchanged. If the
        # pass consuming those ids fails and the queue were rebuilt from that
        # run alone, those proposals would drop out of the pipeline
        # permanently - history frozen before the decision step, a null
        # duration published, and nothing recording a debt. The watermark does
        # not cover it either: the scheduled run sweeps in FULL, so holding
        # `last_success` changes nothing about what is fetched.
        #
        # So the queue accumulates, and is cleared only for a fetcher that
        # actually consumed it.
        pending_path = cache / "pending_rereads.json"
        try:
            pending = json.loads(pending_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pending = {}
        moved = set(merge_stats.get("changed_ids") or [])
        pending = queue_rereads(pending, moved)
        pending_path.write_text(json.dumps(pending), encoding="utf-8")
        log(f"{len(moved):,} register rows moved this run; "
            f"{len(pending['caf']):,} caf / {len(pending['history']):,} "
            f"history ids owed a re-read in total")

        # A seventh of the open proposals each night, so the whole open set
        # is re-read weekly. A history can advance without the register row
        # moving at all - a step is added and the status string does not
        # change - and nothing in the register would ever say so. Terminal
        # proposals are not re-polled: their history is finished, and re-asking
        # would be seven times the traffic for nothing.
        ROLLING = 7
        slot = rolling_slot(started.date(), ROLLING)

        # CHANGED FIRST. It is the smallest pass and the only one that repairs
        # a proposal whose row moved, and it was last - behind the two largest
        # passes and behind a break-on-failure - so the nights when PARIVESH
        # was flaky, which are exactly the nights with the most movement, were
        # the nights it was skipped. Ordering it first costs nothing when
        # everything works and is the difference between a repaired proposal
        # and a permanently frozen one when it does not.
        extras = {"new": [],
                  "rolling": ["--slice", f"{slot}/{ROLLING}", "--open-only"]}
        owed = {n: list(pending.get(n) or []) for n in FETCHERS}
        ids_paths = {n: cache / f"pending_{n}.json" for n in FETCHERS}
        for n in FETCHERS:
            if owed[n]:
                ids_paths[n].write_text(json.dumps(owed[n]), encoding="utf-8")
        # Per fetcher, never carried from one to the other.
        result = {n: {"code": 0, "out": "", "ran": [], "consumed": False,
                      "stopped": False} for n in FETCHERS}

        for name, pass_name, share in PASS_PLAN:
            r = result[name]
            if r["stopped"]:
                continue
            script, workers = FETCHERS[name]
            pass_env = None
            if pass_name == "changed":
                if not owed[name]:
                    continue
                extra = ["--ids-file", str(ids_paths[name])]
            elif pass_name == "recheck_none":
                absent = settled_absent(cache, name)
                if not absent:
                    continue
                recheck_path = cache / f"pending_recheck_none_{name}.json"
                recheck_path.write_text(json.dumps(absent), encoding="utf-8")
                extra = ["--ids-file", str(recheck_path)]
                pass_env = {"INSTRUMENTS_MAX_RPS": RECHECK_RPS,
                            "INSTRUMENTS_RECHECK": "1"}
                log(f"  re-asking {len(absent):,} proposals settled as 'no form'")
            else:
                extra = extras[pass_name]
            budget = []
            if deadline is not None:
                left = deadline - time.time() - REBUILD_RESERVE_S
                if left < 60:
                    log(f"  {name} ({pass_name}): no time left in the "
                        "budget; the work stays owed for the next run")
                    if pass_name not in REVISIT_PASSES:
                        r["code"], r["out"] = 3, "skipped: budget exhausted"
                    r["ran"].append(f"{pass_name}=skipped")
                    continue
                budget = ["--max-seconds", str(int(max(60, left * share)))]
            if pass_name == "changed":
                # A report from an earlier night must never be read as tonight's.
                Path(str(ids_paths[name]) + ".left").unlink(missing_ok=True)
            log(f"fetching {name} ({pass_name})")
            if name == "caf" and pass_name == "new":
                # The bulk form pass runs as parallel shards: one Python
                # process is CPU-bound near 7 forms/s (see fetch_parallel.py).
                code, out = run([sys.executable, str(SCRIPTS / "fetch_parallel.py"),
                                 "--procs", str(PARALLEL_PROCS), "--workers", workers,
                                 *budget])
            else:
                code, out = run([sys.executable, str(SCRIPTS / script),
                                 "--workers", workers, *extra, *budget], pass_env)
            r["ran"].append(f"{pass_name}={code}")
            if pass_name in REVISIT_PASSES and code == 3:
                pass              # out of time re-asking: nothing left unread
            elif code != 0 or r["code"] == 0:
                r["code"], r["out"] = code, out
            if pass_name == "changed":
                r["left"] = changed_pass_left(ids_paths[name])
                r["consumed"] = r["left"] is not None
            if code not in (0, 3):
                # Aborted on a sustained error rate, or died: the service is
                # refusing this fetcher, so its later passes are not tried.
                # Out of time (3) is not that - the next pass has its own share.
                r["stopped"] = True

        for name in FETCHERS:
            r = result[name]
            # The debt is discharged only by a pass that actually completed.
            # Clearing it on any other outcome is how a queue silently becomes
            # a no-op.
            pending = discharge(pending, name, r["consumed"], r.get("left"))
            if not r["consumed"] and owed[name]:
                log(f"  {name}: {len(owed[name]):,} ids still owed a re-read; "
                    f"they stay queued for the next run")
            code = r["code"]
            backfills[name] = {
                "exit": code,
                "passes": r["ran"],
                "owed_before": len(owed[name]),
                "owed_after": len(pending.get(name) or []),
                "tail": " | ".join(r["out"].strip().splitlines()[-3:]),
            }
            log(f"  {name} fetch exit={code}"
                + (" (out of time; the rest stays owed)" if code == 3 else ""))
            if code != 0:
                # Non-zero means it did not finish: it aborted on a sustained
                # error rate, ran out of time, or died. Either way this window
                # is not covered, so the watermark must not move past it.
                incomplete_backfill = True
                log(f"  {name} fetch did not complete; this window stays open")

        pending_path.write_text(json.dumps(pending), encoding="utf-8")

    caf_stats = backfills or {"skipped": True}

    # ── REBUILD INTO A CANDIDATE, CHECK IT THERE, THEN PROMOTE ──────────
    #
    # The rebuild used to write straight into public/, and the published-data
    # contract ran afterwards. A run whose data failed the contract therefore
    # left the failed data in the working tree: harmless in CI, where the
    # checkout is thrown away, and wrong everywhere else - the next local
    # build or dev server served data that had not passed. Now every file is
    # built into a candidate folder, the full contract runs there, and only a
    # candidate that passes replaces what is published.
    log("rebuilding into a candidate")
    candidate = cache / "candidate"
    if candidate.exists():
        shutil.rmtree(candidate)
    candidate.mkdir(parents=True)
    # The register index reads the freshness record; a candidate needs the
    # current one until this run's is written below.
    if (PUBLISHED / "freshness.json").exists():
        shutil.copy2(PUBLISHED / "freshness.json", candidate / "freshness.json")
    report = candidate.with_name(candidate.name + ".verification_report.json")
    steps = [
        ("build_data", [sys.executable, str(SCRIPTS / "build_data.py"),
                        "--out", str(candidate)]),
        ("legal_reference", [sys.executable, str(SCRIPTS / "legal_reference.py")]),
        ("register_index", [sys.executable, str(SCRIPTS / "build_register_index.py")]),
    ]
    build_env = {"INSTRUMENTS_GEO_DBF": str(cache / "geo" / "2011_Dist.dbf"),
                 "INSTRUMENTS_DATA_DIR": str(candidate),
                 "PYTHONIOENCODING": "utf-8"}

    def fail(stage: str, out: str) -> None:
        # Nothing in public/ has been touched - or, if a promote failed
        # between its renames and could not put the old folder back, it is
        # restored here. Say so, keep the tail of the output, record the
        # failure, and stop.
        recover_published(PUBLISHED)
        log(f"  FAILED at {stage}. Published data is unchanged.")
        log("\n".join(out.strip().splitlines()[-15:]))
        state_path(cache).write_text(json.dumps({
            **state,
            "last_attempt": started.isoformat(),
            "last_success": state.get("last_success"),
            "status": "failed",
            "failed_stage": stage,
        }, indent=1), encoding="utf-8")
        sys.exit(1)

    results = {}
    for name, cmd in steps:
        code, out = run(cmd, build_env)
        results[name] = code
        log(f"  {name:18} exit={code}")
        if code != 0:
            # build_data exits non-zero on an invariant violation. That is the
            # designed behaviour and it must stop the sync: publishing a dataset
            # that failed its own checks is worse than publishing yesterday's.
            fail(name, out)

    meta = json.loads((candidate / "meta.json").read_text(encoding="utf-8"))
    finished = datetime.now(timezone.utc)
    egress = pool().stats()

    # Covered means the whole window was read, from every source. A sector
    # that failed and a backfill that aborted are the same kind of hole.
    # COVERED means the whole register was read. A window is not: PARIVESH
    # filters on submission date, so a windowed run returns proposals FILED in
    # it and cannot have seen a status change on anything older. Publishing
    # complete:true after one made the footer state a full register read that
    # had not happened.
    complete = (not failed_sectors and not incomplete_backfill
                and since is None)
    advanced_to = next_watermark(state.get("last_success"),
                                 finished.isoformat(), failed_sectors,
                                 incomplete_backfill)
    if not complete:
        log("watermark held: this window was not fully covered, so the next "
            "run will ask for it again")
    freshness = {
        "last_attempt": started.isoformat(),
        "last_success": advanced_to,
        "complete": complete,
        "failed_sectors": failed_sectors,
        "incomplete_backfill": incomplete_backfill,
        "egress": {
            "direct_blocked": egress["direct_blocked"],
            "routes_live": egress["routes_live"],
            "served": egress["served"],
        },
        "status": "ok" if complete else "partial",
        "window": since or "full sweep",
        "seconds": round((finished - started).total_seconds(), 1),
        "register": merge_stats,
        "sectors": sector_stats,
        "caf": caf_stats,
        "forest": forest_stats,
        "resolution_rate_pct": meta.get("resolution_rate_pct"),
        "proposals_published": meta["counts"]["proposals_published"],
        # Nights in a row that did not cover the register. See
        # PARTIAL_FAIL_AFTER.
        "partial_streak": next_streak(state.get("partial_streak"), failed_sectors,
                                      backfills),
    }
    # The state file is written AFTER the promote below. Written here, a
    # failure in the change log, the contract or the promote left it claiming
    # a success - an advanced `last_success` - for a run that published
    # nothing.

    # The site reads this. It is what lets the interface say when the register
    # was last checked instead of implying it is live.
    # #2: only when something was actually read. A night on which every
    # sector failed has not checked the register, and dating it now would put
    # a fresh timestamp on a page whose figures did not move.
    any_sector_read = len(failed_sectors) < len(SECTORS)
    prior_fresh = {}
    try:
        prior_fresh = json.loads(
            (PUBLISHED / "freshness.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        prior_fresh = {}
    (candidate / "freshness.json").write_text(json.dumps({
        "checked_at": (register_read_at.isoformat() if any_sector_read
                       else prior_fresh.get("checked_at")),
        "last_attempt": finished.isoformat(),
        # Whether this check reached the whole register. The interface must be
        # able to say "checked, partially" rather than showing a timestamp
        # that means less than it appears to.
        "complete": complete,
        "sectors_unreachable": len(failed_sectors),
        "window": since or "full sweep",
        "proposals_published": freshness["proposals_published"],
        "new_since_last_check": merge_stats["added"],
        "updated_since_last_check": merge_stats["updated"],
        "resolution_rate_pct": freshness["resolution_rate_pct"],
    }, indent=1), encoding="utf-8")

    # The change log, dated by the register's own history, windowed to end on
    # the read just recorded above - so it runs after freshness is written.
    code, out = run([sys.executable, str(SCRIPTS / "build_changes.py")],
                    {**build_env, "INSTRUMENTS_CACHE_DIR": str(cache)})
    log(f"  changes            exit={code}")
    if code != 0:
        fail("changes", out)

    # The published-data contract, over the candidate. Freshness is asserted
    # here too: this run just read the register, so a stale read time in the
    # candidate would mean the read was not recorded.
    code, out = run([sys.executable, str(SCRIPTS / "check_published.py")],
                    {**build_env, "INSTRUMENTS_ASSERT_FRESHNESS": "1"})
    log(f"  contract           exit={code}")
    if code != 0:
        fail("contract", out)

    try:
        promote(candidate, PUBLISHED)
    except Exception as exc:  # noqa: BLE001
        fail("promote", f"{type(exc).__name__}: {exc}")
    state_path(cache).write_text(json.dumps(freshness, indent=1), encoding="utf-8")
    if report.exists():
        shutil.copy2(report, SCRIPTS / "verification_report.json")
        report.unlink()
    # Promoted, so the candidate is a second copy of what is published. Left
    # in the cache it was saved into the Actions cache every night.
    shutil.rmtree(candidate, ignore_errors=True)
    log(f"  promoted the candidate to {PUBLISHED.relative_to(ROOT)}")

    log(f"{'OK' if complete else 'PARTIAL'} in {freshness['seconds']}s  "
        f"{freshness['proposals_published']:,} proposals published, "
        f"{freshness['resolution_rate_pct']}% located")

    streak = freshness["partial_streak"]
    if not complete:
        # A GitHub annotation, so a partial night shows on the run summary
        # even though the job is green.
        print(f"::warning::partial sync ({streak} faulty night(s) in a row): "
              f"failed sectors {failed_sectors or 'none'}, backfills "
              f"{ {k: v.get('exit') for k, v in backfills.items()} }", flush=True)
    if streak >= PARTIAL_FAIL_AFTER:
        # Not an exit here: the job still has to save the cache and commit
        # what was published. The workflow's last step runs
        # `sync.py --check-streak`, which fails the job.
        log(f"{streak} consecutive nights have not covered the register; "
            f"the job will be failed after the commit so a person looks.")


if __name__ == "__main__":
    main()
