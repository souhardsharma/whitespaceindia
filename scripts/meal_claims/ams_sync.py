"""The nightly read of the national PM POSHAN system (ams.py).

What one night reads, in this order:

  states     the all-States table for yesterday and the day before
  districts  every State's district table for yesterday
  earlier    the all-States table for each earlier day the date box still
             offers, oldest first, because the oldest leaves the box tomorrow
  settled    tables read before their day's late returns were in, and the
             district tables of earlier days, oldest first

The source keeps 30 days on screen, so a day not read while it is offered is
not read at all. What a night does not reach is still unread the next night
and is planned again from the store; nothing is carried in a queue.

The host answers Indian addresses only, so every request goes down a
verified Indian route (egress.Session). Ten flows run side by side, each
on a route of its own, and all of them together keep one pace. When a route
dies its flow starts again on another, for as long as the night's minutes
last; the pool file is read again each time, so routes a refresher verifies
while the night runs are taken up. A refusal (401, 403, 429) is different:
it is the source's answer, and the pass ends at the first one rather than
asking again from another address.

The workflow runs this on a copy of the store while the meal system is read
into the store itself, and `--absorb` then takes the copy's national tables.

    EDUCATION_CACHE_DIR=... python scripts/meal_claims/ams_sync.py --store <dir>/national.sqlite
    python scripts/meal_claims/ams_sync.py --store <dir>/store.sqlite --absorb <dir>/national.sqlite
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "education"))

import ams as AMS  # noqa: E402
import store as ST  # noqa: E402

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
REQUEST_CAP = 2400        # most requests in one night
SPACING_S = 3.0           # between requests on one route
PACE_S = 1.5              # between requests on all routes together
FLOWS = 10                # flows side by side, each on its own route
REPORT_EVERY = 25         # tables between two progress lines
SETTLED_AFTER_DAYS = 2    # a day's figures stop moving: a table read sooner is read again
ATTEMPTS = 3              # routes tried for one table that will not parse
REFUSALS = frozenset({401, 403, 407, 429})


class Refused(Exception):
    """The source refused the route it was asked through."""


class RouteLost(Exception):
    """The route under the flow failed in transit."""


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def yesterday_ist(now: dt.datetime | None = None) -> dt.date:
    return ((now or dt.datetime.now(dt.timezone.utc)).astimezone(IST) - dt.timedelta(days=1)).date()


def settled(day: dt.date, read_at: str | None) -> bool:
    """Was the table read after its day's late returns were in?"""
    return bool(read_at) and dt.date.fromisoformat(read_at[:10]) >= day + dt.timedelta(days=SETTLED_AFTER_DAYS + 1)


def window(yesterday: dt.date) -> list[dt.date]:
    """The days the date box offers, oldest first, up to yesterday."""
    return [yesterday - dt.timedelta(days=n) for n in range(AMS.WINDOW_DAYS - 1, -1, -1)]


def state_names(db, day: dt.date, reporting_only: bool) -> list[str]:
    least = 1 if reporting_only else 0
    return [r["name"] for r in db.execute(
        "select name from ams_state_day where day=? and coalesce(reported, 0) >= ? order by name",
        (ST.iso(day), least))]


def stages(db, yesterday: dt.date):
    """Yield lists of (day, State name or None), in the order the night
    reads them.

    Each list is made only when it is asked for: a day's district tables are
    named by its all-States table, which the list before it has just read.
    Within a list no table depends on another, so its tables can be read
    side by side.
    """
    read_at = ST.ams_read_at(db)
    days = window(yesterday)

    def due(day: dt.date, state: str = "") -> bool:
        at = read_at.get((state, ST.iso(day)))
        return at is None or (not settled(day, at) and day <= yesterday - dt.timedelta(days=SETTLED_AFTER_DAYS))

    yield [(yesterday, None), (yesterday - dt.timedelta(days=1), None)]
    yield ([(yesterday, state) for state in state_names(db, yesterday, reporting_only=False)]
           + [(day, None) for day in days[:-2] if due(day)])
    # A State that reported nothing that day has no district figures to keep.
    yield [(day, state) for day in days[:-1]
           for state in state_names(db, day, reporting_only=True) if due(day, state)]


def plan(db, yesterday: dt.date):
    """Every table of `stages`, one after another."""
    for tables in stages(db, yesterday):
        yield from tables


class Lane:
    """One flow's place in the night: the flow changes, the lane stays."""
    flow = None


def run(db, new_flow, yesterday: dt.date, stamp: str, deadline: float,
        cap: int = REQUEST_CAP, say=print, clock=time.time, flows: int = 1) -> dict:
    """Read what `stages` names until the cap or the deadline, `flows` tables
    at a time. `new_flow()` returns an ams.Flow on a fresh route, or None
    when no route is left. Only this thread touches the store."""
    lanes = [Lane() for _ in range(flows)]
    idle = list(lanes)
    lock = threading.Lock()
    count = {"sent": 0, "lost": 0}
    outcome = ["complete"]
    unreadable: list[str] = []

    def spent() -> int:
        with lock:
            return count["sent"] + sum(lane.flow.sent for lane in lanes if lane.flow is not None)

    def drop(lane: Lane) -> None:
        with lock:
            flow, lane.flow = lane.flow, None
            if flow is not None:
                count["sent"] += flow.sent
        release = getattr(flow, "release", None)
        if release:
            release()     # the route is free for another flow

    def stop(why: str) -> None:
        with lock:
            if outcome[0] == "complete":
                outcome[0] = why

    def not_read(what: str, why: str) -> None:
        unreadable.append(f"{what}: {why}")
        say(f"  not read: {what}: {why}")

    def read(lane: Lane, day: dt.date, state: str | None):
        """The table, or None when the night ended first or it would not parse."""
        what = f"{state or 'all States'} {day}"
        misreads = 0
        while outcome[0] == "complete":
            if clock() >= deadline:
                stop("out of time")
                break
            if spent() >= cap:
                stop("cap reached")
                break
            try:
                if lane.flow is None:
                    lane.flow = new_flow()
                    if lane.flow is None:
                        stop("no route")
                        break
                page = lane.flow.states(day) if state is None else lane.flow.districts(day, state)
            except RouteLost:
                drop(lane)
                with lock:
                    count["lost"] += 1
                continue
            except Refused as e:
                drop(lane)
                stop("refused")
                say(f"::warning::the national system refused a request; the pass stops: {e}")
                break
            except AMS.Unreadable as e:
                drop(lane)
                misreads += 1
                if misreads >= ATTEMPTS:
                    not_read(what, str(e))
                    break
                continue
            if page["total"] is not None:
                return page
            # Every table ends in a TOTAL row. One without it was cut short,
            # and storing it would replace a whole day with a part.
            drop(lane)
            misreads += 1
            if misreads >= ATTEMPTS:
                not_read(what, "no TOTAL row")
                break
        return None

    def table(item):
        with lock:
            lane = idle.pop()
        try:
            return read(lane, *item)
        finally:
            with lock:
                idle.append(lane)

    tables, disagree = 0, []
    with ThreadPoolExecutor(max_workers=flows) as pool:
        try:
            for items in stages(db, yesterday):
                for page in pool.map(table, items):
                    if page is None:
                        continue
                    wrong = AMS.disagreements(page)
                    if wrong:
                        disagree.append(f"{page['state'] or 'all States'} {page['day']}: {'; '.join(wrong)}")
                    ST.put_ams(db, page, stamp, not wrong)
                    db.commit()
                    tables += 1
                    if tables % REPORT_EVERY == 0:
                        say(f"  {tables} tables read, {spent()} requests, {count['lost']} routes lost")
                if outcome[0] != "complete":
                    break
        except Exception as e:  # noqa: BLE001 - the outermost handler of the pass
            # Queued tables see the outcome and send nothing more; what was
            # stored is kept and the night is still recorded.
            stop(f"error: {type(e).__name__}")
            say(f"::warning::the national read stopped on an error: {type(e).__name__}: {e}")
    for lane in lanes:
        drop(lane)
    notes = {"unreadable": unreadable[:20], "total_disagrees": disagree[:20]}
    row = {"stamp": stamp, "day": ST.iso(yesterday), "sent": count["sent"], "tables": tables,
           "routes_lost": count["lost"], "outcome": outcome[0], "notes": notes}
    db.execute("insert or replace into ams_night values (?,?,?,?,?,?,?)",
               (stamp, row["day"], row["sent"], tables, row["routes_lost"], row["outcome"],
                json.dumps(notes, sort_keys=True)))
    db.commit()
    return row


def route_flows(say=print):
    """A `new_flow` that opens each flow on a route no other flow is on and
    that has not yet been seen to fail. Safe to call from several threads."""
    import egress as EG

    lock = threading.Lock()
    failed: set[str] = set()
    in_use: set[str] = set()
    next_at = [0.0]       # for all routes together: more routes is not more load

    def take_turn() -> None:
        with lock:
            now = time.time()
            wait = max(0.0, next_at[0] - now)
            next_at[0] = now + wait + PACE_S
        if wait > 0:
            time.sleep(wait)

    def new_flow():
        with lock:
            # Read again each time: a refresher appends routes as it verifies them.
            routes = EG.NET.load_proxies(EG.pool_path("ams"))
            if not routes:
                say("no verified route to the national system tonight")
                return None
            free = [r for r in routes if r not in failed and r not in in_use]
            if not free:
                failed.clear()    # every route has failed once: free routes come back
                free = [r for r in routes if r not in in_use] or routes
            session = EG.Session("ams", spacing=SPACING_S, avoid=set(routes) - set(free))
            in_use.add(session.proxy)

        def gone() -> None:
            with lock:
                failed.add(session.proxy)
                in_use.discard(session.proxy)

        def release() -> None:
            with lock:
                in_use.discard(session.proxy)

        def request(url: str, data: bytes | None):
            headers = {"Accept": "text/html,application/xhtml+xml"}
            if data is not None:
                headers.update({"Content-Type": "application/x-www-form-urlencoded",
                                "Origin": AMS.ORIGIN, "Referer": AMS.PAGE})
            take_turn()
            try:
                status, body, _ = session.request(url, data=data, headers=headers)
            except EG.SessionLost as e:
                gone()
                raise RouteLost(str(e)) from None
            if status in REFUSALS:
                gone()
                raise Refused(f"HTTP {status}")
            return status, body.decode("utf-8", "replace")

        flow = AMS.Flow(request)
        flow.release = release
        return flow

    return new_flow


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--store", required=True, type=Path)
    ap.add_argument("--minutes", type=int, default=30, help="stop sending after this long")
    ap.add_argument("--cap", type=int, default=REQUEST_CAP, help="most requests tonight")
    ap.add_argument("--flows", type=int, default=FLOWS, help="flows side by side")
    ap.add_argument("--day", type=dt.date.fromisoformat, help="read this day as yesterday")
    ap.add_argument("--absorb", type=Path, help="take the national tables of this store file, and read nothing")
    args = ap.parse_args()
    db = ST.connect(args.store)
    if args.absorb:
        print(f"national tables taken: {ST.take_ams(db, args.absorb)} in the ledger")
        return 0
    row = run(db, route_flows(), args.day or yesterday_ist(), now_utc(),
              time.time() + args.minutes * 60, args.cap, flows=max(1, args.flows))
    print(json.dumps(row, indent=1))
    # Whatever was read is kept and whatever was not is planned again tomorrow.
    return 0


if __name__ == "__main__":
    sys.exit(main())
