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

The host answers Indian addresses only, so every request goes down one
verified Indian route at a time (egress.Session). When a route dies the flow
starts again on another, for as long as the night's minutes last. A refusal
(401, 403, 429) is different: three in a row, on three routes, end the pass.

    EDUCATION_CACHE_DIR=... python scripts/meal_claims/ams_sync.py --store <dir>/store.sqlite
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "education"))

import ams as AMS  # noqa: E402
import store as ST  # noqa: E402

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
REQUEST_CAP = 900         # most requests in one night
SPACING_S = 3.0           # between requests on the one route in use
SETTLED_AFTER_DAYS = 2    # a day's figures stop moving: a table read sooner is read again
ATTEMPTS = 3              # routes tried for one table that will not parse
REFUSALS = frozenset({401, 403, 407, 429})
REFUSALS_END_AFTER = 3


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


def plan(db, yesterday: dt.date):
    """Yield (day, State name or None) in the order the night reads them.

    Lazy on purpose: a day's district tables are named by its all-States
    table, which an earlier step of the same night may have just read.
    """
    read_at = ST.ams_read_at(db)
    days = window(yesterday)

    def due(day: dt.date, state: str = "") -> bool:
        at = read_at.get((state, ST.iso(day)))
        return at is None or (not settled(day, at) and day <= yesterday - dt.timedelta(days=SETTLED_AFTER_DAYS))

    yield yesterday, None
    yield yesterday - dt.timedelta(days=1), None
    for state in state_names(db, yesterday, reporting_only=False):
        yield yesterday, state
    earlier = days[:-2]
    for day in earlier:
        if due(day):
            yield day, None
    for day in days[:-1]:
        # A State that reported nothing that day has no district figures to keep.
        for state in state_names(db, day, reporting_only=True):
            if due(day, state):
                yield day, state


def run(db, new_flow, yesterday: dt.date, stamp: str, deadline: float,
        cap: int = REQUEST_CAP, say=print, clock=time.time) -> dict:
    """Read what `plan` names until the cap or the deadline. `new_flow()`
    returns an ams.Flow on a fresh route, or None when no route is left."""
    flow, sent, tables, lost, refused, unreadable = None, 0, 0, 0, 0, []
    disagree: list[str] = []
    outcome = "complete"

    def drop() -> None:
        nonlocal flow, sent
        if flow is not None:
            sent += flow.sent
        flow = None

    for day, state in plan(db, yesterday):
        what = f"{state or 'all States'} {day}"
        misreads = 0
        while True:
            if clock() >= deadline or sent + (flow.sent if flow else 0) >= cap:
                outcome = "out of time" if clock() >= deadline else "cap reached"
                break
            try:
                if flow is None:
                    flow = new_flow()
                    if flow is None:
                        outcome = "no route"
                        break
                page = flow.states(day) if state is None else flow.districts(day, state)
            except RouteLost:
                lost += 1
                drop()
                continue
            except Refused as e:
                refused += 1
                drop()
                if refused >= REFUSALS_END_AFTER:
                    outcome = "refused"
                    say(f"::warning::the national system refused {refused} routes in a row; the pass stops: {e}")
                    break
                continue
            except AMS.Unreadable as e:
                drop()
                misreads += 1
                if misreads >= ATTEMPTS:
                    unreadable.append(f"{what}: {e}")
                    say(f"  not read: {what}: {e}")
                    break
                continue
            refused = 0
            wrong = AMS.disagreements(page)
            if wrong:
                disagree.append(f"{what}: {'; '.join(wrong)}")
            ST.put_ams(db, page, stamp, not wrong)
            db.commit()
            tables += 1
            break
        if outcome != "complete":
            break
    drop()
    notes = {"unreadable": unreadable[:20], "total_disagrees": disagree[:20]}
    row = {"stamp": stamp, "day": ST.iso(yesterday), "sent": sent, "tables": tables,
           "routes_lost": lost, "outcome": outcome, "notes": notes}
    db.execute("insert or replace into ams_night values (?,?,?,?,?,?,?)",
               (stamp, row["day"], sent, tables, lost, outcome, json.dumps(notes, sort_keys=True)))
    db.commit()
    return row


def route_flows(say=print):
    """A `new_flow` that opens each flow on a route not yet seen to fail."""
    import egress as EG

    failed: set[str] = set()

    def new_flow():
        routes = EG.NET.load_proxies(EG.pool_path("ams"))
        if not routes:
            say("no verified route to the national system tonight")
            return None
        if failed.issuperset(routes):
            failed.clear()        # every route has failed once: free routes come back
        session = EG.Session("ams", spacing=SPACING_S, avoid=failed)

        def request(url: str, data: bytes | None):
            headers = {"Accept": "text/html,application/xhtml+xml"}
            if data is not None:
                headers.update({"Content-Type": "application/x-www-form-urlencoded",
                                "Origin": AMS.ORIGIN, "Referer": AMS.PAGE})
            try:
                status, body, _ = session.request(url, data=data, headers=headers)
            except EG.SessionLost as e:
                failed.add(session.proxy)
                raise RouteLost(str(e)) from None
            if status in REFUSALS:
                failed.add(session.proxy)
                raise Refused(f"HTTP {status}")
            return status, body.decode("utf-8", "replace")

        return AMS.Flow(request)

    return new_flow


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--store", required=True, type=Path)
    ap.add_argument("--minutes", type=int, default=30, help="stop sending after this long")
    ap.add_argument("--cap", type=int, default=REQUEST_CAP, help="most requests tonight")
    ap.add_argument("--day", type=dt.date.fromisoformat, help="read this day as yesterday")
    args = ap.parse_args()
    db = ST.connect(args.store)
    row = run(db, route_flows(), args.day or yesterday_ist(), now_utc(),
              time.time() + args.minutes * 60, args.cap)
    print(json.dumps(row, indent=1))
    # Whatever was read is kept and whatever was not is planned again tomorrow.
    return 0


if __name__ == "__main__":
    sys.exit(main())
