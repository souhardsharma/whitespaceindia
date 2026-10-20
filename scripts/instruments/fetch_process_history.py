"""Backfill the appraisal history of every proposal in the clearance register.

WHY THIS EXISTS
---------------
The register records where a proposal has *got to* - one status string, as of
the moment it was read. It does not record how it got there or how long it
took. Yet the passage itself is the substance of environmental regulation: a
proposal is submitted, verified, referred to an appraisal committee, queried,
answered, referred onward, and finally decided. Each of those is a dated act by
a public authority, and the interval between them is how long the public waited.

This module fetches that passage. With it the instrument can state how long
clearance takes, at which stage the time is spent, and how many rounds of
questions a proposal drew before it was decided - none of which the source
exposes as a query, and none of which is published anywhere else.

THE CALL, AND THE TRAP IN IT
----------------------------
    POST /workgroupmaster/process/getProcessHis?application_id=<ID>

`<ID>` is the register record's **`id`** field, not its `application_id` field.
The record carries both: `application_id` is a small integer naming the form
type (2, 6, 11), while `id` is the ten-digit key of the application itself.
Passing the field the parameter is named after returns HTTP 200 with an empty
`data` array - a silent nothing rather than an error, which is why the endpoint
reads as unpopulated until the right key is passed. This is the same naming
collision as `getCafDataByProposalNo`; see fetch_caf.py.

The body is an empty JSON object; the id travels in the query string. No
authentication, no key, no cookie.

WHAT A STEP LOOKS LIKE
----------------------
    abbriviation   TOR_PART_AB_EDS_RAISED     canonical stage code
    status         "EDS raised"               display label as the source writes it
    start_date     when the step opened       null on the first step
    end_date       when the step closed       null on the step still open
    is_current_step                           marks the proposal's live position

`abbriviation` is the source's own spelling and is the stable identifier: the
`status` label varies in case and wording between filings for the same stage,
while the code does not. A terminal decision ("EC Granted") carries a null code,
so a step is keyed on the pair.

WHAT IS DELIBERATELY NOT KEPT
-----------------------------
Every step names the individual officer who performed it, their internal entity
id, and - in the `remarks` field - their name, designation and government email
address again in free text. All three are dropped here and none reaches disk.

`remarks` reads like decision text and is not. Measured across 544,909 recorded
steps, 14,966 of the 15,233 non-empty remarks are an officer identity in the
form "Name, (email) (designation, office)", 3,199 of them carrying an email
address, and none carries a reason for a decision. Keeping the field would
persist 230 identifiable individuals for no analytical gain.

The public interest is in how long an authority took and what it decided, not
in which official handled the file; publishing named civil servants against
processing times would invite exactly the reading this instrument refuses to
support. The authority is recorded, the person is not.

POLITENESS
----------
Responses are small - a few kilobytes - so this is far lighter than the CAF
backfill. Measured throughput is 30 req/s at 8 workers and 86 req/s at 32; the
default of 16 sits well inside that and is not the ceiling. Backoff on 429 and
503, and a circuit breaker that halts on a sustained error rate rather than
continuing to press a service that has started refusing.

Storage is one compact JSONL line per proposal. Runs are resumable: ids already
recorded, including those recorded as empty, are skipped.

  sources:  PARIVESH workgroup process engine (live)
  outputs:  $INSTRUMENTS_CACHE_DIR/history/history.jsonl
            $INSTRUMENTS_CACHE_DIR/history/history_errors.jsonl

Run from the project root:
  python scripts/instruments/fetch_process_history.py
  python scripts/instruments/fetch_process_history.py --open-only
  python scripts/instruments/fetch_process_history.py --limit 500
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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import net as NET
import run_lock  # noqa: E402
import register_cache
import stages as ST  # noqa: E402

HISTORY_URL = ("https://parivesh.nic.in/workgroupmaster/process/"
               "getProcessHis?application_id={}")
# Headers live in net.py. A local dict here was never used: NET.get
# takes no headers argument, so it set nothing while looking like it did.
# Statuses that end a proposal's passage. A proposal in one of these is not
# re-polled by --open-only: its history cannot change again.
def _is_terminal(status: object) -> bool:
    """Whether a proposal has finished moving, per the ONE status registry.

    This was a hand-written set of twelve raw spellings sitting beside
    stages.py, which canonicalises 83 source spellings into 73 stages and
    already flags which are terminal. The two disagreed: ten canonical
    terminal keys had no match in the hand list, so `--open-only` kept
    re-polling proposals whose history is finished, and a spelling stages.py
    learned did not reach this file at all. A vocabulary held in two places
    is a vocabulary that drifts.
    """
    key = ST.canonical(status)
    return bool(ST.STATUSES.get(key, {}).get("terminal"))

# Highest-consequence first, so a partial run is still a useful one.
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



def fetch_one(rec_id: int, timeout: int = 45, deadline: float | None = None):
    """POST an empty object; the id travels in the query string.

    Routed through net.py so a dead egress does not end the run.
    """
    return NET.get(pool(), HISTORY_URL.format(rec_id), data=b"{}",
                   method="POST", timeout=timeout, deadline=deadline)


# What extract() below captures. The cache is append-only and resume skips any
# id already in it, so changing what is captured WITHOUT changing this number
# means every record already on disk keeps its old shape for ever and no amount
# of re-running repairs it. The CAF cache reached 24,360 records in exactly
# that state.
#   1  dated steps with the canonical code, the source label and the current
#      flag; officers and free text never persisted
# The only status this fetcher will retire an id on.
#
# THIS IS A DIFFERENT ENDPOINT FROM THE CAF ONE, and the justification that
# belongs to that constant there does NOT transfer here. This block was copied
# across verbatim, including a sentence about "the service holds no form for
# this proposal" and an incident count that happened on the CAF endpoint.
#
# What is actually established about THIS endpoint is the opposite shape: asked
# for an id it holds nothing for, it answers HTTP 200 with an EMPTY ARRAY - a
# silent nothing rather than an error - and `extract()` returns [] for exactly
# that case and records it as a real answer. So "no history here" already has
# a representation, and it is not a 500.
#
# A 500 from this endpoint therefore means something undocumented. It is kept
# settle-eligible rather than retried for ever, because an id that always 500s
# would otherwise be re-requested on every nightly run without bound - but it
# must say so TWICE, over what is almost always a different route, before the
# id is retired. Retiring on one unexplained answer is how a proposal ends up
# permanently without a duration while the register plainly says it was
# decided.
#
# Everything else stays owed: 403 is our address being refused, 404 with an
# HTML body is a proxy's own error page, 429/502/503/504 are capacity.
SETTLED_STATUSES = frozenset({500})

# How many times a settle-eligible status must repeat before it retires an id.
SETTLE_CONFIRMATIONS = 2

EXTRACT_VERSION = 1
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



def extract(raw: bytes) -> list[dict] | None:
    """Reduce a history response to the dated steps, without the officers.

    Returns [] for a proposal the engine holds no history for, which is a real
    answer and is recorded as such so the id is not retried on every run.
    Returns None when the response could not be read at all.
    """
    try:
        d = json.loads(raw.decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001
        return None
    # A body that parses but is not an envelope (`null`, `[]`) is unreadable,
    # not a crash: raised here, it ended the whole pass.
    if not isinstance(d, dict) or d.get("status") != 200:
        return None
    rows = d.get("data")
    if not isinstance(rows, list):
        return None

    steps = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        steps.append({
            "a": (r.get("abbriviation") or None),          # canonical stage code
            "s": (r.get("status") or "").strip() or None,  # source's display label
            "sd": r.get("start_date"),
            "ed": r.get("end_date"),
            "cur": bool(r.get("is_current_step")),
            "m": r.get("process_step_mapping_id"),
            "c": r.get("current_step_id"),
        })
    # Oldest first. A step may carry only one of the two dates, so order on
    # whichever it has rather than dropping it.
    steps.sort(key=lambda x: (x.get("ed") or x.get("sd") or ""))
    return steps


# Rewrite once the file is this much larger than the data in it. The cache is
# append-only and the nightly rolling pass re-reads a seventh of the open
# register, so a proposal accumulates a copy per re-read for ever - unbounded
# growth in a file every build streams end to end.
COMPACT_RATIO = 1.35


def compact(path: Path) -> None:
    """Keep only the latest record per id, when the file has grown enough.

    Rewritten through a temporary file and swapped into place, because a
    crash partway through an in-place rewrite would leave the cache truncated
    - and the cache is the only copy of ~93,000 requests' worth of work.
    """
    if not path.exists():
        return
    latest: dict = {}
    lines = 0
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            lines += 1
            try:
                rid = json.loads(line).get("id")
            except Exception:  # noqa: BLE001
                continue
            if rid is not None:
                latest[rid] = line
    if not latest or lines < len(latest) * COMPACT_RATIO:
        return
    tmp = path.with_suffix(".compacting")
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        for rid in sorted(latest):
            fh.write(latest[rid])
    os.replace(tmp, path)
    log(f"  compacted {lines:,} lines -> {len(latest):,} records")


def load_done(path: Path, require_version: int | None = None,
              answered_only: bool = False) -> set[int]:
    """Ids already fetched AT THE CURRENT EXTRACT VERSION.

    A record written by an older extractor is not done: it is a record of a
    shape this code no longer reads. Treating it as done is what freezes a
    cache permanently, so the version is checked rather than assumed.

    Records written before versioning existed carry no `v` and are taken as
    version 1, which is what they are. That grandfathers the 115,272 already
    on disk instead of throwing them away to gain a field.
    """
    done: set[int] = set()
    if not path.exists():
        return done
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
                if require_version is not None                         and int(rec.get("v", 1)) != require_version:
                    continue
                if answered_only:
                    if rec.get("status") not in SETTLED_STATUSES:
                        continue      # not a definitive answer; still owed
                done.add(rec["id"])
            except Exception:  # noqa: BLE001
                continue
    return done


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workers", type=int, default=16,
                    help="concurrent requests (measured: 30 req/s at 8, 86 at 32)")
    ap.add_argument("--limit", type=int, default=0, help="stop after N new fetches")
    ap.add_argument("--max-seconds", type=float, default=0, help=(
        "stop starting new requests after this many seconds, save progress and "
        "exit 3 - see the same option in fetch_caf.py"))
    ap.add_argument("--category", help="only this category (A, B1, B2)")
    ap.add_argument("--open-only", action="store_true",
                    help="only proposals not in a terminal status; for refresh runs")
    ap.add_argument("--refresh", action="store_true",
                    help="re-fetch ids already recorded rather than skipping them")
    ap.add_argument("--slice", help=(
        "i/n - take only records whose id mod n equals i, and re-read them "
        "whatever the cache holds. A proposal's history can advance without "
        "its register row changing at all: a step is added, the status string "
        "stays the same, and nothing in the delta says so. Combined with "
        "--open-only this re-reads the open set on a rolling cycle, which is "
        "the only way a still-moving proposal's timing stays true. Terminal "
        "proposals are not re-polled; their history is finished."))
    ap.add_argument("--ids-file", help=(
        "JSON array of record ids to (re-)fetch, bypassing the resume set. "
        "A proposal whose register row CHANGED needs its per-proposal sources "
        "read again: the cache is keyed on id and never revisited, so one "
        "cached while the proposal was pending keeps that state for ever "
        "while the register moves on around it."))
    args = ap.parse_args()
    run_lock.hold_or_exit("fetch_process_history")  # one run against PARIVESH at a time

    cache = cache_dir()
    out_path = cache / "history" / "history.jsonl"
    err_path = cache / "history" / "history_errors.jsonl"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Through the shared reader, which applies the same staleness rule
    # the build does: a fetch writes the sector files and merges after,
    # so a run that died in between leaves a stale merge beside fresh
    # downloads. Reading the merge directly meant a backfill could work
    # from a register older than the sweep that had just run, not know
    # about the proposals it added, and report a clean run.
    records = register_cache.load_records(cache, log)

    done: set[int] = set()
    if not args.refresh:
        # Fetched, at the shape this code reads. An older record is not done -
        # it is a record this code no longer understands.
        done = load_done(out_path, EXTRACT_VERSION)
        # An id the service ANSWERED about is settled and is not asked again.
        # An id whose request died in transport was never answered, so it
        # stays outstanding: marking it done would retire it permanently on
        # our own network trouble, and the gap would look like the register
        # having no history for it.
        done |= load_done(err_path, answered_only=True)
    log(f"register: {len(records):,} records, {len(done):,} already recorded")

    if args.slice:
        i, n = (int(x) for x in args.slice.split("/"))
        if not (0 <= i < n):
            sys.exit(f"--slice {args.slice}: need 0 <= i < n")
        todo = [r for r in records
                if r.get("id") is not None and int(r["id"]) % n == i]
        log(f"slice {i}/{n}: {len(todo):,} of {len(records):,} records")
    elif args.ids_file:
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
    if args.open_only:
        todo = [r for r in todo
                if not _is_terminal(r.get("proposalStatus"))]
    todo.sort(key=lambda r: (CATEGORY_ORDER.index(r.get("category"))
                             if r.get("category") in CATEGORY_ORDER else 9))
    if args.limit:
        todo = todo[: args.limit]
    log(f"to fetch: {len(todo):,}")
    if not todo:
        log("nothing to do")
        # Still a report: no report reads as a crash, and the caller would
        # keep the debt (and run this empty pass) every night.
        write_left(args.ids_file, [], set())
        return

    started = time.time()
    deadline = started + args.max_seconds if args.max_seconds else None
    aborted = False
    out_of_time = False
    counts = {"ok": 0, "empty": 0, "err": 0, "steps": 0}
    answered: set = set()
    recent_errors: list[float] = []
    storm = NET.SettleStorm()
    stop = threading.Event()
    write_lock = threading.Lock()

    def work(rec_id: int):
        if stop.is_set() or (deadline and time.time() > deadline):
            return None
        status, raw = -1, b""
        settled_seen = 0
        for attempt in range(3):
            # Budget checked before every attempt; see fetch_caf.work().
            if attempt and deadline and time.time() > deadline:
                return None
            status, raw = fetch_one(rec_id, deadline=deadline)
            # Every route busy is a queue, not the budget: wait for one, as
            # fetch_caf does. Returned unsent, these ids were counted as out
            # of time and the pass exited 3 with budget left.
            while (status == -1 and raw == NET.SATURATED_BODY
                   and not stop.is_set()
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
                # Corroborate before retiring. See SETTLED_STATUSES: a 500 here
                # is undocumented, and this endpoint expresses "nothing held"
                # as 200 with an empty array, so one 500 is not evidence of
                # absence.
                settled_seen += 1
                time.sleep(0.5 + random.random())
                continue
            return rec_id, status, raw
        return rec_id, status, raw

    with open(out_path, "a", encoding="utf-8") as fout, \
            open(err_path, "a", encoding="utf-8") as ferr, \
            ThreadPoolExecutor(max_workers=args.workers) as ex:
        # As each answer arrives, not in submission order: ex.map held every
        # finished answer behind the slowest early one, so a pass could read
        # for minutes, write nothing, and lose it all if stopped.
        futs = [ex.submit(work, r["id"]) for r in todo]
        try:
            for fut in as_completed(futs):
                result = fut.result()
                if result is None:
                    continue
                rec_id, status, raw = result
                steps = extract(raw) if status == 200 else None

                with write_lock:
                    if storm.note(steps is None and status in SETTLED_STATUSES) \
                            and not aborted:
                        log("  TOO MANY 500s to be genuine absences - halting. "
                            "Settled ids are re-asked by the nightly recheck.")
                        stop.set()
                        aborted = True
                    if steps is None:
                        counts["err"] += 1
                        # A settled 500 is an answer, not a refusal, so it
                        # never feeds the breaker; but it stays out of
                        # `answered` and so in `.left` (see fetch_caf).
                        if status not in SETTLED_STATUSES:
                            recent_errors.append(time.time())
                        ferr.write(json.dumps(
                            {"id": rec_id, "status": status,
                             "body": raw[:200].decode("utf-8", "replace")},
                            ensure_ascii=False) + "\n")
                    else:
                        answered.add(rec_id)
                        counts["ok"] += 1
                        counts["steps"] += len(steps)
                        if not steps:
                            counts["empty"] += 1
                        fout.write(json.dumps({"id": rec_id, "v": EXTRACT_VERSION,
                                               "steps": steps},
                                              ensure_ascii=False,
                                              separators=(",", ":")) + "\n")

                    n = counts["ok"] + counts["err"]
                    if n % 200 == 0:
                        fout.flush()
                        ferr.flush()
                        # Routes the pool file has gained since the run began.
                        pool().reload_routes(os.environ.get("INSTRUMENTS_PROXIES"))
                        st = pool().stats()
                        served = st["served"]
                        tot = max(1, served["direct"] + served["proxy"])
                        log(f"    egress: {100*served['direct']/tot:.0f}% direct / "
                            f"{100*served['proxy']/tot:.0f}% proxy | "
                            f"{st['routes_live']}/{st['routes_total']} routes live | "
                            f"concurrency {st['concurrency']}")
                        rate = n / max(time.time() - started, 1e-6)
                        log(f"  {n:>7,}/{len(todo):,}  {rate:5.1f} req/s  "
                            f"ok={counts['ok']:,} empty={counts['empty']:,} "
                            f"err={counts['err']:,} steps={counts['steps']:,}")

                    if deadline and time.time() > deadline and not out_of_time:
                        out_of_time = True
                        stop.set()
                        log(f"  TIME BUDGET of {args.max_seconds:.0f}s reached; "
                            "stopping new requests, keeping everything read.")

                    # Circuit breaker: if the service starts refusing, stop rather
                    # than continue pressing it. Sixty errors inside two minutes is
                    # far above the observed background rate.
                    cutoff = time.time() - 120
                    recent_errors[:] = [t for t in recent_errors if t > cutoff]
                    if len(recent_errors) > 60:
                        log("  ERROR RATE TOO HIGH - halting. Re-run to resume.")
                        stop.set()
                        aborted = True
        except BaseException:
            # Anything raised here used to leave the pool draining: every
            # queued id was still sent to PARIVESH and its answer discarded,
            # with no .left written. Stop, drop what is queued, then fail.
            stop.set()
            for f in futs:
                f.cancel()
            raise

    elapsed = time.time() - started
    # Unattempted work without an abort can only be the budget; see fetch_caf.
    if counts["ok"] + counts["err"] < len(todo) and not aborted:
        out_of_time = True
    log(f"\ndone in {elapsed/60:.1f} min: {counts['ok']:,} recorded "
        f"({counts['empty']:,} with no history), {counts['err']:,} errors, "
        f"{counts['steps']:,} steps total")
    compact(out_path)
    log(f"  -> {out_path}")
    write_left(args.ids_file, [r["id"] for r in todo], answered)
    if aborted:
        # The caller branches on the exit code and on nothing else. Returning
        # 0 from a halted backfill let the nightly sync treat a frozen
        # appraisal history as a completed one, advance its watermark, and
        # publish a complete check - while every proposal decided since the
        # freeze published a null duration. fetch_caf.py exits 2 for the same
        # reason; this one did not, so the pair disagreed about what a halt
        # means.
        log("ABORTED on a sustained error rate. Exiting non-zero so the "
            "caller does not treat this as a completed backfill.")
        raise SystemExit(2)
    if out_of_time:
        done = counts["ok"] + counts["err"]
        log(f"OUT OF TIME with {len(todo) - done:,} of {len(todo):,} not "
            "attempted; they stay owed for the next run.")
        raise SystemExit(3)


if __name__ == "__main__":
    main()
