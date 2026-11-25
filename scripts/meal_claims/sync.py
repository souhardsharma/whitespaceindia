"""The nightly run: read the host within a budget, remember, flag.

What one night reads, in this order, so the things every page depends on are
read first and the sampling takes what is left:

  states     the all-States table for yesterday and the two days before it
             (figures move for a day or two as late reports arrive), and a
             stretch of earlier days until the history is filled
  districts  every State's district table for yesterday
  holidays   each State's own holiday list, weekly
  closed     where a State was shut yesterday and meals were still reported:
             down through district, block and cluster to the schools
  hierarchy  block and cluster lists, oldest first
  sample     school tables of clusters, chosen by how long since each was read
             and how many of its schools have filed an enrolment to test against
  detail     the month and the enrolment history of each school a table named;
             what the budget does not reach is owed to the next night

The budget is requests, counted by the reader. It starts small and rises by
itself over clean nights (`next_budget`); a refusal ends the run at once and
halves the next night's. Nothing here goes round a refusal.

    python scripts/meal_claims/sync.py --store <dir>/store.sqlite
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import flags as FL  # noqa: E402
import reader as RD  # noqa: E402
import store as ST  # noqa: E402

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

BUDGET_START = 300
BUDGET_STEP = 150
BUDGET_CAP = 1000
BUDGET_FLOOR = 150
CLEAN_FAIL_SHARE = 0.02     # a night is clean under this share of failed attempts
SLOW_FACTOR = 1.6           # ... and when its median answer is under this multiple of earlier nights'
HISTORY_DAYS = 400          # how far back the all-States history is filled
HOLIDAY_EVERY_DAYS = 7
MONTH_REREAD_DAYS = 7       # a followed school's month is read again after this long
ENROL_REREAD_DAYS = 30
OWED_KEEP_DAYS = 20         # a month not read within this long is no longer that month

# Shares of the night's budget. `closed` and `detail` are ceilings; what they
# do not use goes to the sample.
SHARE_HISTORY = 0.08
SHARE_CLOSED = 0.25
SHARE_HIERARCHY = 0.20
SHARE_HIERARCHY_BUILDING = 0.50   # while most blocks have no cluster list yet
SHARE_DETAIL = 0.25

# A school-table row far above its neighbours is looked at even where no
# enrolment is filed: the month it opens is where a spike is judged.
NEIGHBOUR_RATIO = 6
NEIGHBOUR_MIN_MEALS = 300


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def yesterday_ist(now: dt.datetime | None = None) -> dt.date:
    now = now or dt.datetime.now(dt.timezone.utc)
    return (now.astimezone(IST) - dt.timedelta(days=1)).date()


def next_budget(nights: list[dict]) -> int:
    """Tonight's request budget, from the nights before it (oldest first).

    Up one step after a clean night, halved after a refusal or a night of
    failures or slow answers, otherwise held. A run that never reached the
    host (no request answered) teaches nothing and changes nothing.
    """
    told = [n for n in nights if n["sent"]]
    if not told:
        return BUDGET_START
    last = told[-1]
    earlier = [n["median_s"] for n in told[:-1] if n["median_s"]]
    slow = bool(earlier and last["median_s"]
                and last["median_s"] > SLOW_FACTOR * statistics.median(earlier))
    failing = last["failed"] / last["sent"] > CLEAN_FAIL_SHARE
    if last["outcome"] == "refused" or slow or failing:
        return max(BUDGET_FLOOR, last["budget"] // 2)
    if last["outcome"] == "complete":
        return min(BUDGET_CAP, last["budget"] + BUDGET_STEP)
    return last["budget"]


def sample_day(db, st: str, yesterday: dt.date) -> dt.date | None:
    """The latest of the last seven days on which the State was open.

    School tables answer for any date, so a State shut yesterday is sampled on
    its last working day rather than on a day nobody reported.
    """
    rows = db.execute(
        "select day, schools, reported from state_day where st=? and day<=? and day>? order by day desc",
        (st, ST.iso(yesterday), ST.iso(yesterday - dt.timedelta(days=7)))).fetchall()
    for row in rows:
        if row["schools"] and row["reported"] / row["schools"] >= FL.THRESHOLDS["state_open_share"]:
            return dt.date.fromisoformat(row["day"])
    return None


def closed_states(db, yesterday: dt.date) -> list[str]:
    """States shut yesterday, with meals reported, that were open within the
    three days before - a shut day, not the middle of a vacation."""
    out = []
    for row in db.execute("select st, schools, reported, meals from state_day where day=?",
                          (ST.iso(yesterday),)):
        if not FL.state_shut(row["reported"], row["schools"]) or not row["meals"]:
            continue
        before = db.execute(
            "select schools, reported from state_day where st=? and day<? and day>=?",
            (row["st"], ST.iso(yesterday), ST.iso(yesterday - dt.timedelta(days=3)))).fetchall()
        if any(b["schools"] and b["reported"] / b["schools"] >= FL.THRESHOLDS["state_open_share"]
               for b in before):
            out.append(row["st"])
    return out


def far_above_neighbours(rows: list[dict]) -> list[dict]:
    """Rows whose meals stand far above the table's other reporting schools."""
    served = [r["meals"] for r in rows if r["meals"]]
    if len(served) < 4:
        return []
    usual = statistics.median(served)
    return [r for r in rows if r["meals"] and r["meals"] >= NEIGHBOUR_MIN_MEALS
            and r["meals"] >= NEIGHBOUR_RATIO * usual]


class Night:
    """One run: the host, the store, and what is still owed."""

    def __init__(self, db, host: RD.Host, yesterday: dt.date, stamp: str, say=print):
        self.db, self.host, self.yesterday, self.stamp, self.say = db, host, yesterday, stamp, say
        self.notes: dict = {"unreadable": 0}
        self.spent: dict[str, int] = {}

    # -- plumbing
    def allowance(self, share: float) -> int:
        return self.host.sent + int((self.host.budget or 0) * share)

    def read(self, fn, *args):
        """One read; None when the host could not be read this time."""
        try:
            return fn(*args)
        except (RD.Unreadable, ValueError) as e:
            self.notes["unreadable"] += 1
            self.say(f"  unreadable: {e}")
            return None

    def run_pass(self, name: str, fn) -> None:
        before = self.host.sent
        try:
            fn()
        finally:
            self.spent[name] = self.host.sent - before
            self.db.commit()
            self.say(f"{name}: {self.spent[name]} requests, {self.host.left()} left")

    # -- passes
    def states(self) -> None:
        for back in range(3):
            day = self.yesterday - dt.timedelta(days=back)
            rows = self.read(self.host.state_table, day)
            if rows:
                ST.put_state_day(self.db, day, rows, now_utc())
        self.notes["state_table"] = bool(self.db.execute(
            "select 1 from state_day where day=?", (ST.iso(self.yesterday),)).fetchone())

    def history(self) -> None:
        """Fill earlier days of the all-States table, newest first."""
        stop_at = self.allowance(SHARE_HISTORY)
        held = {r["day"] for r in self.db.execute("select distinct day from state_day")}
        for back in range(3, HISTORY_DAYS):
            if self.host.sent >= stop_at:
                return
            day = self.yesterday - dt.timedelta(days=back)
            if ST.iso(day) in held:
                continue
            rows = self.read(self.host.state_table, day)
            if rows:
                ST.put_state_day(self.db, day, rows, now_utc())

    def districts(self) -> None:
        read = 0
        for st in RD.STATES:
            rows = self.read(self.host.districts, st, self.yesterday)
            if rows:
                ST.put_districts(self.db, st, self.yesterday, rows)
                read += 1
        self.notes["district_tables"] = read

    def holidays(self) -> None:
        due = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=HOLIDAY_EVERY_DAYS)).isoformat()
        for st, (_, abbr) in RD.STATES.items():
            got = self.db.execute("select read_at from holiday_read where st=?", (st,)).fetchone()
            if abbr is None or (got and got["read_at"] > due):
                continue
            rows = self.read(self.host.holidays, st)
            if rows is None:
                continue
            # The list is kept whole: a date the State once listed stays listed.
            self.db.executemany("insert or ignore into holiday values (?,?,?)",
                                [(st, r["date"], r["reason"]) for r in rows])
            self.db.execute("insert or replace into holiday_read values (?,?)", (st, now_utc()))

    def closed(self) -> None:
        """Schools that reported meals on a day their State was shut."""
        stop_at = self.allowance(SHARE_CLOSED)
        day = self.yesterday
        for st in closed_states(self.db, day):
            total = self.db.execute("select reported, meals from state_day where st=? and day=?",
                                    (st, ST.iso(day))).fetchone()
            found = 0
            districts = self.db.execute(
                "select dc from district_day where st=? and day=? and meals>0 order by meals desc",
                (st, ST.iso(day))).fetchall()
            for d in districts:
                for b in self.below(stop_at, self.host.blocks, st, d["dc"], day):
                    for c in self.below(stop_at, self.host.clusters, st, d["dc"], b["code"], day):
                        rows = self.school_table(st, d["dc"], b["code"], c["code"], day) \
                            if self.host.sent < stop_at else None
                        for r in rows or []:
                            if r["meals"]:
                                found += 1
                                self.follow_up(st, r, d["dc"], b["code"], c["code"])
            self.db.execute("insert or replace into closed_day values (?,?,?,?,?,?)",
                            (st, ST.iso(day), total["reported"], total["meals"], found, now_utc()))

    def below(self, stop_at: int, fn, *args) -> list[dict]:
        """The rows of one roll-up table that reported any meals."""
        if self.host.sent >= stop_at:
            return []
        rows = self.read(fn, *args) or []
        return sorted((r for r in rows if r["meals"]), key=lambda r: -r["meals"])

    def hierarchy(self) -> None:
        """Block lists of districts and cluster lists of blocks.

        What has never been read comes first; after that the oldest block
        tables and the oldest cluster lists share what is left, so the block
        figures on a district page and the list of clusters both stay recent.
        """
        blocks = self.db.execute(
            "select count(*) n, sum(clusters_read_at is null) unread from block").fetchone()
        building = (not blocks["n"] or blocks["unread"] / blocks["n"] > 0.2 or bool(self.db.execute(
            "select 1 from district where blocks_read_at is null").fetchone()))
        stop_at = self.allowance(SHARE_HIERARCHY_BUILDING if building else SHARE_HIERARCHY)
        days = {st: sample_day(self.db, st, self.yesterday) or self.yesterday for st in RD.STATES}
        filing = {r["st"]: r["share"] for r in self.db.execute(
            "select st, 1.0*sum(enr_filed)/max(1, sum(schools)) share from district_day "
            "where day=(select max(day) from district_day) group by st")}

        def block_table(d) -> None:
            rows = self.read(self.host.blocks, d["st"], d["dc"], days[d["st"]])
            if rows is not None:
                ST.put_blocks(self.db, d["st"], d["dc"], days[d["st"]], rows, now_utc())

        def cluster_list(b) -> None:
            rows = self.read(self.host.clusters, b["st"], b["dc"], b["bc"], days[b["st"]])
            if rows is not None:
                ST.put_clusters(self.db, b["st"], b["dc"], b["bc"], days[b["st"]], rows, now_utc())

        for d in self.db.execute("select st, dc from district where blocks_read_at is null").fetchall():
            if self.host.sent >= stop_at:
                return
            block_table(d)
        # The States that file the most enrolment first: their clusters are
        # the ones the enrolment test can be run on.
        unread = self.db.execute("select st, dc, bc from block where clusters_read_at is null").fetchall()
        for b in sorted(unread, key=lambda b: (-filing.get(b["st"], 0), b["st"], b["bc"])):
            if self.host.sent >= stop_at:
                return
            cluster_list(b)
        half = self.host.sent + (stop_at - self.host.sent) // 2
        for d in self.db.execute("select st, dc from district order by blocks_read_at").fetchall():
            if self.host.sent >= half:
                break
            block_table(d)
        for b in self.db.execute("select st, dc, bc from block order by clusters_read_at").fetchall():
            if self.host.sent >= stop_at:
                return
            cluster_list(b)

    def sample(self, reserve: int) -> None:
        """School tables, most overdue and most testable clusters first."""
        today = self.yesterday + dt.timedelta(days=1)
        days = {st: sample_day(self.db, st, self.yesterday) for st in RD.STATES}
        flagged = {(r["st"], r["cc"]) for r in self.db.execute(
            "select distinct s.st, s.cc from school s join flag f on f.st=s.st and f.code=s.code")}
        queue = []
        for c in self.db.execute("select st, dc, bc, cc, schools, enr_filed, schools_read_at from cluster"):
            if days[c["st"]] is None or not c["schools"]:
                continue
            if c["schools_read_at"] and c["schools_read_at"] >= self.stamp:
                continue  # read earlier tonight
            age = 60 if c["schools_read_at"] is None else \
                (today - dt.date.fromisoformat(c["schools_read_at"][:10])).days
            weight = max(0.15, (c["enr_filed"] or 0) / c["schools"])
            if (c["st"], c["cc"]) in flagged:
                weight *= 2
            queue.append((-age * weight, c["st"], c["cc"], c["dc"], c["bc"]))
        queue.sort()
        self.notes["clusters_known"] = len(queue)
        for _, st, cc, dc, bc in queue:
            if not self.host.can_send(reserve + 1):
                return
            self.school_table(st, dc, bc, cc, days[st])

    def school_table(self, st: str, dc: str, bc: str, cc: str, day: dt.date) -> list[dict] | None:
        """Read one cluster's schools for one day and test every row it can."""
        rows = self.read(self.host.schools, st, dc, bc, cc, day)
        if rows is None:
            return None
        over = 0
        for r in rows:
            basis = FL.over_enrolment(r["meals"], r["enrolled"])
            if basis:
                over += 1
                ST.follow(self.db, st, r, dc, bc, cc, self.stamp)
                ST.put_flag(self.db, st, r["code"], r["shift"],
                            {"kind": "over", "date": day, **basis}, self.stamp)
                self.owe(st, r["code"], r["shift"])
        for r in far_above_neighbours(rows):
            self.follow_up(st, r, dc, bc, cc)
        tested = sum(1 for r in rows if r["enrolled"] and r["meals"] is not None)
        self.db.execute(
            "insert or replace into cluster_read values (?,?,?,?,?,?,?,?,?)",
            (st, cc, ST.iso(day), len(rows), sum(1 for r in rows if r["filed"]),
             sum(1 for r in rows if r["reported"]), tested, over, now_utc()))
        self.db.execute("update cluster set schools_read_at=?, schools_day=? where st=? and cc=?",
                        (now_utc(), ST.iso(day), st, cc))
        return rows

    def follow_up(self, st: str, row: dict, dc: str, bc: str, cc: str) -> None:
        ST.follow(self.db, st, row, dc, bc, cc, self.stamp)
        self.owe(st, row["code"], row["shift"])

    def owe(self, st: str, code: str, shift: str) -> None:
        """Queue a school's month to be read; the queue outlives the night."""
        self.db.execute("insert or ignore into owed values (?,?,?,?)", (st, code, shift, self.stamp))

    def detail(self) -> None:
        """Month and enrolment history of the schools a table named, oldest
        debt first, then of flagged schools whose month is a week old."""
        self.db.execute("delete from owed where since<?",
                        ((dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=OWED_KEEP_DAYS)).isoformat(),))
        stale = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=MONTH_REREAD_DAYS)).isoformat()
        month_start = self.yesterday.replace(day=1)
        owed = [(r["st"], r["code"], r["shift"]) for r in self.db.execute(
            "select st, code, shift from owed order by since")]
        due = [(r["st"], r["code"], r["shift"]) for r in self.db.execute(
            "select s.st, s.code, s.shift from school s left join school_month m "
            "on m.st=s.st and m.code=s.code and m.shift=s.shift and m.year=? and m.month=? "
            "where exists (select 1 from flag f where f.st=s.st and f.code=s.code "
            "and f.shift=s.shift and f.day>=?) and (m.read_at is null or m.read_at<?) "
            "order by m.read_at",
            (self.yesterday.year, self.yesterday.month, ST.iso(month_start), stale))]
        seen: set[tuple[str, str, str]] = set()
        for key in owed + due:
            if key in seen:
                continue
            seen.add(key)
            if not self.host.can_send(2):
                break
            if self.school_detail(*key):
                self.db.execute("delete from owed where st=? and code=? and shift=?", key)
        self.notes["detail_owed"] = self.db.execute("select count(*) from owed").fetchone()[0]

    def school_detail(self, st: str, code: str, shift: str) -> bool:
        month = self.read(self.host.school_month, st, code, shift)
        if month is None:
            return False
        ST.put_month(self.db, st, code, shift, month, now_utc())
        place = self.db.execute("select dc, bc, cc from school where st=? and code=? and shift=?",
                                (st, code, shift)).fetchone()
        old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=ENROL_REREAD_DAYS)).isoformat()
        got = self.db.execute("select read_at from school_enrol where st=? and code=? and shift=? and year=?",
                              (st, code, shift, month["year"])).fetchone()
        if (got is None or got["read_at"] < old) and self.host.can_send():
            enrol = self.read(self.host.school_enrolment, st, place["dc"], place["bc"], place["cc"], code, shift)
            if enrol is not None:
                ST.put_enrolment(self.db, st, code, shift, enrol, now_utc())
        judge(self.db, st, code, shift, month["year"], month["month"], self.yesterday, self.stamp)
        return True


def judge(db, st: str, code: str, shift: str, year: int, month: int, upto: dt.date, stamp: str) -> None:
    """Run the three tests over one school's month as now held, and settle
    that month's earlier flags against it: a flag the figures no longer
    support is kept, marked as no longer standing, with what the figure is now."""
    series = ST.series(db, st, code, shift)
    enrolled = ST.enrolment(db, st, code, shift)
    found = [f for f in FL.month_flags(series, upto, enrolled, ST.holidays(db, st),
                                       ST.shut_days(db, st, FL.state_shut))
             if (f["date"].year, f["date"].month) == (year, month)]
    for f in found:
        ST.put_flag(db, st, code, shift, f, stamp)
    standing = {(ST.iso(f["date"]), f["kind"]) for f in found}
    first, last = dt.date(year, month, 1), upto
    for row in db.execute("select day, kind, basis from flag where st=? and code=? and shift=? "
                          "and day>=? and day<=? and standing=1",
                          (st, code, shift, ST.iso(first), ST.iso(last))).fetchall():
        if (row["day"], row["kind"]) in standing:
            continue
        day = dt.date.fromisoformat(row["day"])
        if (day.year, day.month) != (year, month):
            continue
        basis = json.loads(row["basis"])
        now_meals = series.get(day)
        if row["kind"] == "over" and enrolled.get((year, month)) is None:
            # No enrolment history read: the flag still rests on the table's
            # own two figures unless the meals figure itself has come down.
            if now_meals is not None and now_meals > basis["enrolled"]:
                continue
        basis["now"] = now_meals
        db.execute("update flag set standing=0, basis=?, last_stamp=? "
                   "where st=? and code=? and shift=? and day=? and kind=?",
                   (json.dumps(basis, sort_keys=True), stamp, st, code, shift, row["day"], row["kind"]))


def run(db, host: RD.Host, yesterday: dt.date, stamp: str, say=print) -> dict:
    """One night. Returns the row recorded for it."""
    night = Night(db, host, yesterday, stamp, say)
    outcome = "complete"
    try:
        night.run_pass("states", night.states)
        night.run_pass("districts", night.districts)
        night.run_pass("holidays", night.holidays)
        night.run_pass("history", night.history)
        night.run_pass("closed", night.closed)
        night.run_pass("hierarchy", night.hierarchy)
        reserve = int((host.budget or 0) * SHARE_DETAIL)
        night.run_pass("sample", lambda: night.sample(min(reserve, max(0, (host.left() or 0) // 2))))
        night.run_pass("detail", night.detail)
        night.run_pass("sample again", lambda: night.sample(0))
    except RD.OutOfBudget:
        pass  # the ordinary end of a night: the budget or the time is used up
    except RD.Refused as e:
        outcome = "refused"
        night.notes["refused"] = str(e)
        say(f"::warning::the host refused; the run stops here: {e}")
    if outcome == "complete" and not (night.notes.get("state_table") and night.notes.get("district_tables")):
        outcome = "partial"
    health = host.health()
    row = {"stamp": stamp, "day": ST.iso(yesterday), "budget": host.budget, "sent": health["sent"],
           "failed": health["failed"], "median_s": health["median_s"], "p90_s": health["p90_s"],
           "outcome": outcome, "notes": {**night.notes, "spent": night.spent}}
    db.execute("insert or replace into night values (?,?,?,?,?,?,?,?,?)",
               (row["stamp"], row["day"], row["budget"], row["sent"], row["failed"],
                row["median_s"], row["p90_s"], row["outcome"], json.dumps(row["notes"], sort_keys=True)))
    db.commit()
    return row


def nights(db) -> list[dict]:
    return [dict(r) for r in db.execute("select * from night order by stamp")]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--store", required=True, type=Path)
    ap.add_argument("--budget", type=int, help="requests tonight; default follows the ramp")
    ap.add_argument("--minutes", type=int, default=100, help="stop sending after this long")
    ap.add_argument("--day", type=dt.date.fromisoformat, help="read this day as yesterday")
    args = ap.parse_args()

    db = ST.connect(args.store)
    budget = args.budget or next_budget(nights(db))
    yesterday = args.day or yesterday_ist()
    print(f"reading for {yesterday}, budget {budget} requests")
    host = RD.Host(budget=budget, deadline=time.time() + args.minutes * 60)
    row = run(db, host, yesterday, now_utc())
    print(json.dumps(row, indent=1))
    # A refusal is a result, not a crash: the store keeps what was read, the
    # pages are rebuilt from it, and the next night asks for half as much.
    return 0


if __name__ == "__main__":
    sys.exit(main())
