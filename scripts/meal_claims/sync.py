"""The nightly run: read the host within a budget, remember, flag.

What one night reads, in this order, so the things every page depends on are
read first and the sampling takes what is left:

  states     the all-States table for yesterday and the two days before it
             (figures move for a day or two as late reports arrive)
  districts  every State's district table for yesterday, and again for the
             day two before it, once late reports have settled
  holidays   each State's own holiday list, weekly
  history    earlier dates of the all-States table, newest first, back to
             where the host holds nothing
  closed     where a State was shut yesterday and meals were still reported:
             down through district, block and cluster to the schools
  district history
             each State's district table for the earlier dates on which that
             State reported, newest first, with what the closed days left
  hierarchy  block and cluster lists, oldest first
  sample     school tables of clusters, chosen by how long since each was read
             and how many of its schools have filed an enrolment to test against
  detail     the month and the enrolment history of each school a table named;
             what the budget does not reach is owed to the next night

Every school table read is kept row by row, so the store comes to hold each
school the host lists and what it showed on the day read.

The budget is requests, counted by the reader. It starts small and rises by
itself over clean nights (`next_budget`); a refusal ends the run at once and
halves the next night's. Nothing here goes round a refusal.

    python scripts/meal_claims/sync.py --store <dir>/store.sqlite
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import flags as FL  # noqa: E402
import reader as RD  # noqa: E402
import store as ST  # noqa: E402
import udise as UD  # noqa: E402

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

BUDGET_START = 300
BUDGET_STEP = 150           # the least a clean night adds
BUDGET_GROWTH = 1.5         # ... and the multiple it grows by once that is more
# About 14,000 clusters hold the schools. At 1,000 requests a night one pass
# over them took a month, and a school's month can only be read while it is
# the current month. At 5,000, with the pause between requests unchanged, a
# pass takes about a week and the night about three hours.
BUDGET_CAP = 5000
BUDGET_FLOOR = 150
CLEAN_FAIL_SHARE = 0.02     # a night is clean under this share of failed attempts
SLOW_FACTOR = 1.6           # ... and when its median answer is under this multiple of earlier nights'
# The all-States history is read back until this many days in a row, older
# than the oldest day with a report, hold none. The host has gone blank for
# three weeks at a time (5 to 25 June 2026) and States take long vacations,
# but never all of them for four months.
HISTORY_ENDS_AFTER_BLANK_DAYS = 120
SETTLED_AFTER_DAYS = 2      # late reports stop arriving: the day's district tables are read again
HOLIDAY_EVERY_DAYS = 7
MONTH_REREAD_DAYS = 7       # a followed school's month is read again after this long
ENROL_REREAD_DAYS = 30
OWED_KEEP_DAYS = 20         # a month not read within this long is no longer that month
UDISE_CAP = 300             # requests a night to the second source, UDISE+
UDISE_MINUTES = 10          # ... and the time it may take after the meal system's
UDISE_REFRESH_DAYS = 120    # its records are filed once a year; a school is asked again after this long
FAULTY_FAIL_AFTER = 3       # this many nights running not read whole, and the job goes red

# Shares of the night's budget. `closed` and `detail` are ceilings; what they
# do not use goes to the sample.
SHARE_HISTORY = 0.05            # earlier dates of the all-States table
SHARE_DISTRICT_HISTORY = 0.25   # earlier dates of the district tables, while any are owed
SHARE_CLOSED = 0.25
SHARE_HIERARCHY = 0.20
SHARE_HIERARCHY_BUILDING = 0.50   # while most blocks have no cluster list yet
SHARE_DETAIL = 0.25
# What the earlier passes must leave for the sample. On the first night
# (run 45557273187) the closed days and the hierarchy took their full shares
# of the budget, which was everything left: no school table was sampled and
# no school's month was read.
SHARE_SAMPLE_KEPT = 0.15

# A school-table row far above its neighbours is looked at even where no
# enrolment is filed: the month it opens is where a spike is judged.
NEIGHBOUR_RATIO = 6
NEIGHBOUR_MIN_MEALS = 300


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def yesterday_ist(now: dt.datetime | None = None) -> dt.date:
    now = now or dt.datetime.now(dt.timezone.utc)
    return (now.astimezone(IST) - dt.timedelta(days=1)).date()


def next_budget(nights: list[dict], today: str | None = None) -> int:
    """Tonight's request budget, from the nights before it (oldest first).

    Up after a clean night (by half, and by at least one step), halved
    after a refusal or a night of failures or slow answers, otherwise held. A run that never reached the
    host (no request answered) teaches nothing and changes nothing. A second
    run on one date (`today`, UTC) never steps up: the ramp is per night, so
    a run dispatched by hand cannot hurry it.
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
    if last["outcome"] == "complete" and last.get("stamp", "")[:10] != today:
        return min(BUDGET_CAP, max(last["budget"] + BUDGET_STEP, int(last["budget"] * BUDGET_GROWTH)))
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


def second_source(db, finder, stamp: str, say=print) -> dict:
    """Ask UDISE+ for the record of each flagged school not asked in the
    last UDISE_REFRESH_DAYS, newest flags first. Its own request count, its
    own refusal: nothing here touches the meal system or the night's outcome."""
    note = {"sent": 0, "read": 0, "none": 0, "unreadable": 0}
    stale = (dt.date.fromisoformat(stamp[:10]) - dt.timedelta(days=UDISE_REFRESH_DAYS)).isoformat()
    year = int((db.execute("select value from info where key='udise_year'").fetchone() or [UD.FIRST_YEAR_ID])[0])
    due = db.execute(
        "select f.st, f.code, max(f.day) latest from flag f left join udise u on u.st=f.st and u.code=f.code "
        "where f.standing=1 and (u.read_at is null or u.read_at < ?) group by f.st, f.code "
        "order by latest desc, f.code", (stale,)).fetchall()
    try:
        held = [json.loads(r["record"])["year"] for r in
                db.execute("select record from udise where record is not null and year_id=?", (year,))]
        if due and held:
            # A new academic year is taken up the night UDISE+ first answers
            # for it: an answer that names a later year than any record held.
            try:
                ahead = finder.report_card(due[0]["code"], year + 1)
                if ahead and (ahead["year"] or "") > max(y or "" for y in held):
                    year += 1
                    db.execute("insert or replace into info values ('udise_year', ?)", (str(year),))
            except RD.Unreadable:
                note["unreadable"] += 1
        for school in due:
            try:
                record = finder.report_card(school["code"], year)
            except RD.Unreadable as e:
                note["unreadable"] += 1
                say(f"  unreadable: {e}")
                continue
            ST.put_udise(db, school["st"], school["code"], year, record, stamp)
            note["read" if record else "none"] += 1
    except RD.OutOfBudget:
        pass
    except RD.Refused as e:
        note["refused"] = str(e)
        say(f"::warning::UDISE+ refused; its reading stops here for tonight: {e}")
    db.commit()
    note["sent"] = finder.sent
    say(f"UDISE+: {note['sent']} requests, {note['read']} records, {note['none']} codes it does not hold")
    return note


class Night:
    """One run: the host, the store, and what is still owed."""

    def __init__(self, db, host: RD.Host, yesterday: dt.date, stamp: str, say=print):
        self.db, self.host, self.yesterday, self.stamp, self.say = db, host, yesterday, stamp, say
        self.notes: dict = {"unreadable": 0}
        self.spent: dict[str, int] = {}

    # -- plumbing
    def allowance(self, share: float, keep: float = 0.0) -> int:
        """Where a pass stops: at its share of the budget, and never inside
        the part of it kept for the passes that come after."""
        budget = self.host.budget or 0
        room = max(0, (self.host.left() or 0) - int(budget * keep))
        return self.host.sent + min(int(budget * share), room)

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
            self.state_day(day)
        self.notes["state_table"] = bool(self.db.execute(
            "select 1 from state_day where day=?", (ST.iso(self.yesterday),)).fetchone())

    def state_day(self, day: dt.date) -> None:
        """One date of the all-States table, entered in the ledger when the
        host answered, with rows or with none."""
        try:
            rows = self.host.state_table(day)
        except RD.Empty:
            rows = []
        except (RD.Unreadable, ValueError) as e:
            self.notes["unreadable"] += 1
            self.say(f"  unreadable: {e}")
            return
        ST.put_state_day(self.db, day, rows, now_utc())
        ST.mark_read(self.db, "states", "", day, len(rows), now_utc())

    def history_floor(self) -> dt.date | None:
        """The oldest day the all-States table has a report for, once enough
        blank days older than it have been read to call it the first."""
        got = self.db.execute("select value from info where key='history_floor'").fetchone()
        if got:
            return dt.date.fromisoformat(got["value"])
        oldest = self.db.execute("select min(day) from state_day where reported>0").fetchone()[0]
        if oldest is None:
            return None
        older = self.db.execute("select count(*) from table_read where kind='states' and day<?",
                                (oldest,)).fetchone()[0]
        if older < HISTORY_ENDS_AFTER_BLANK_DAYS:
            return None
        self.db.execute("insert or replace into info values ('history_floor', ?)", (oldest,))
        return dt.date.fromisoformat(oldest)

    def history(self) -> None:
        """Earlier dates of the all-States table, newest first, until the
        host's record runs out."""
        stop_at = self.allowance(SHARE_HISTORY)
        held = ST.days_read(self.db, "states")
        day = self.yesterday - dt.timedelta(days=3)
        while self.host.sent < stop_at and self.history_floor() is None:
            if ST.iso(day) not in held:
                self.state_day(day)
            day -= dt.timedelta(days=1)

    def district_history(self) -> None:
        """District tables of earlier dates, newest first: for each State,
        the dates on which the all-States table shows it reporting. A State
        that table leaves out (Rajasthan) is asked for every date any other
        State reported on."""
        stop_at = self.allowance(SHARE_DISTRICT_HISTORY,
                                 keep=SHARE_HIERARCHY + SHARE_SAMPLE_KEPT + SHARE_DETAIL)
        listed = {r["st"] for r in self.db.execute("select distinct st from state_day")}
        held = {st: ST.days_read(self.db, "districts", st) for st in RD.STATES}
        owed = 0
        for row in self.db.execute(
                "select day, group_concat(case when reported>0 then st end) sts from state_day "
                "where day<? group by day having sum(reported)>0 order by day desc",
                (ST.iso(self.yesterday),)).fetchall():
            reporting = set((row["sts"] or "").split(","))
            day = dt.date.fromisoformat(row["day"])
            for st in RD.STATES:
                if row["day"] in held[st] or (st in listed and st not in reporting):
                    continue
                if self.host.sent >= stop_at:
                    owed += 1
                    continue
                self.district_table(st, day)
        self.notes["district_days_owed"] = owed

    def district_table(self, st: str, day: dt.date) -> bool:
        rows = self.read(self.host.districts, st, day)
        if rows is None:
            return False
        ST.put_districts(self.db, st, day, rows)
        ST.mark_read(self.db, "districts", st, day, len(rows), now_utc())
        return bool(rows)

    def districts(self) -> None:
        read = sum(self.district_table(st, self.yesterday) for st in RD.STATES)
        self.notes["district_tables"] = read
        settled = self.yesterday - dt.timedelta(days=SETTLED_AFTER_DAYS)
        for st in RD.STATES:
            first = self.db.execute("select read_at from table_read where kind='districts' and st=? and day=?",
                                    (st, ST.iso(settled))).fetchone()
            # Read once more, and only a table first read before the day had settled.
            if first and first["read_at"] and first["read_at"][:10] <= ST.iso(settled + dt.timedelta(days=1)):
                self.district_table(st, settled)

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
        stop_at = self.allowance(SHARE_CLOSED, keep=SHARE_HIERARCHY + SHARE_SAMPLE_KEPT + SHARE_DETAIL)
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

        Unread districts take no more than half the pass once a block is
        waiting for its cluster list. The sample can only open clusters it
        knows of: with every district read first, it re-read the same 64
        tables for nights while 1,200 blocks waited.
        """
        blocks = self.db.execute(
            "select count(*) n, sum(clusters_read_at is null) unread from block").fetchone()
        building = (not blocks["n"] or blocks["unread"] / blocks["n"] > 0.2 or bool(self.db.execute(
            "select 1 from district where blocks_read_at is null").fetchone()))
        stop_at = self.allowance(SHARE_HIERARCHY_BUILDING if building else SHARE_HIERARCHY,
                                 keep=SHARE_SAMPLE_KEPT + SHARE_DETAIL)
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

        half = self.host.sent + (stop_at - self.host.sent) // 2
        for d in self.db.execute("select st, dc from district where blocks_read_at is null").fetchall():
            if self.host.sent >= stop_at:
                return
            if self.host.sent >= half and self.db.execute(
                    "select 1 from block where clusters_read_at is null").fetchone():
                break
            block_table(d)
        for b in unread_blocks(self.db, filing):
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

    def named(self, schools: list[tuple[str, str, str, str, str]]) -> None:
        """Schools named on the command line: find each in its block's school
        tables, then read its month. For a school a reader reports, or a case
        being re-checked; the nightly run names none."""
        for st, dc, bc, code, shift in schools:
            known = self.db.execute("select 1 from school where st=? and code=? and shift=?",
                                    (st, code, shift)).fetchone()
            if not known and not self.find(st, dc, bc, code, shift):
                continue
            if self.school_detail(st, code, shift):
                self.db.execute("delete from owed where st=? and code=? and shift=?", (st, code, shift))

    def find(self, st: str, dc: str, bc: str, code: str, shift: str) -> bool:
        """Look for one school in its block's school tables and follow it."""
        day = sample_day(self.db, st, self.yesterday) or self.yesterday
        blocks = self.read(self.host.blocks, st, dc, day)
        clusters = self.read(self.host.clusters, st, dc, bc, day)
        if blocks is None or clusters is None:
            return False
        ST.put_blocks(self.db, st, dc, day, blocks, now_utc())
        ST.put_clusters(self.db, st, dc, bc, day, clusters, now_utc())
        for c in clusters:
            rows = self.school_table(st, dc, bc, c["code"], day) or []
            row = next((r for r in rows if r["code"] == code and r["shift"] == shift), None)
            if row:
                self.follow_up(st, row, dc, bc, c["code"])
                return True
        self.say(f"::warning::school {code} was not found in block {bc}")
        return False

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
        ST.put_school_day(self.db, st, dc, bc, cc, day, rows)
        # A table can be read before its block's cluster list is (a closed
        # day, a named school). The cluster is recorded here so the table is
        # counted under its district; the list fills in the rest later.
        self.db.execute("insert or ignore into cluster (st, dc, bc, cc) values (?,?,?,?)", (st, dc, bc, cc))
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
            "select st, code, shift from owed o order by since, not exists (select 1 from flag f "
            "where f.st=o.st and f.code=o.code and f.shift=o.shift)")]   # a flag's own school first
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
        if place and (got is None or got["read_at"] < old) and self.host.can_send():
            enrol = self.read(self.host.school_enrolment, st, place["dc"], place["bc"], place["cc"], code, shift)
            if enrol is not None:
                ST.put_enrolment(self.db, st, code, shift, enrol, now_utc())
        judge(self.db, st, code, shift, month["year"], month["month"], self.yesterday, self.stamp)
        return True


def unread_blocks(db, filing: dict[str, float]) -> list:
    """Blocks whose cluster list has not been read, in the order to read them.

    First the blocks holding a cluster known only by its code: a table read
    before its block's list (a closed day, a named school) records the
    cluster with no name, and a flagged school's page would print an empty
    cluster until the list is read. Then the States that file the most
    enrolment, whose clusters the enrolment test can be run on.
    """
    unread = db.execute(
        "select b.st, b.dc, b.bc, exists (select 1 from cluster c where c.st=b.st and c.bc=b.bc "
        "and coalesce(c.name, '')='') nameless from block b where b.clusters_read_at is null").fetchall()
    return sorted(unread, key=lambda b: (-b["nameless"], -filing.get(b["st"], 0), b["st"], b["bc"]))


def withdraw_by_rule(db, upto: dt.date) -> int:
    """Delete the flags the current thresholds no longer raise on the figures held.

    A flag kept from before a rule was tightened would be marked "no longer
    standing" the next time its school is judged, which tells readers the
    school's figures changed when only the rule did. So it is settled before
    anything is judged. Today the candidates are weekday closed-day flags whose
    stored basis rests on fewer dates of its weekday than the rule now asks
    for. Each is judged again on the school's figures as now held, because
    weeks read since can supply the missing dates: a flag the rule still
    raises keeps its first stamp and takes the new basis, and only the others
    are deleted.
    """
    rows = db.execute(
        "select st, code, shift, day from flag where kind='closed' "
        "and json_extract(basis, '$.rule')='weekday' and json_extract(basis, '$.same_days') < ?",
        (FL.THRESHOLDS["offday_min_same_weekdays"],)).fetchall()
    gone = 0
    for r in rows:
        st, code, shift, day = r["st"], r["code"], r["shift"], r["day"]
        raised = {ST.iso(f["date"]): f for f in FL.month_flags(
            ST.series(db, st, code, shift), upto, ST.enrolment(db, st, code, shift),
            ST.holidays(db, st), ST.shut_days(db, st, FL.state_shut)) if f["kind"] == "closed"}
        key = (st, code, shift, day)
        if day in raised and raised[day].get("rule") == "weekday":
            basis = {k: v for k, v in raised[day].items() if k not in ("date", "kind")}
            db.execute("update flag set basis=? where st=? and code=? and shift=? and day=? and kind='closed'",
                       (json.dumps(basis, sort_keys=True), *key))
        else:
            db.execute("delete from flag where st=? and code=? and shift=? and day=? and kind='closed'", key)
            gone += 1
    db.commit()
    return gone


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


def run(db, host: RD.Host, yesterday: dt.date, stamp: str, say=print, named=(), finder=None) -> dict:
    """One night. Returns the row recorded for it."""
    night = Night(db, host, yesterday, stamp, say)
    outcome = "complete"
    withdrawn = withdraw_by_rule(db, yesterday)
    if withdrawn:
        night.notes["withdrawn_by_rule"] = withdrawn
        say(f"{withdrawn} flag(s) the current thresholds no longer raise were removed")
    try:
        night.run_pass("states", night.states)
        night.run_pass("districts", night.districts)
        night.run_pass("holidays", night.holidays)
        if named:
            night.run_pass("named", lambda: night.named(list(named)))
        night.run_pass("history", night.history)
        night.run_pass("closed", night.closed)
        night.run_pass("district history", night.district_history)
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
    if finder is not None:
        night.notes["udise"] = second_source(db, finder, stamp, say)
    health = host.health()
    row = {"stamp": stamp, "day": ST.iso(yesterday), "budget": host.budget, "sent": health["sent"],
           "failed": health["failed"], "median_s": health["median_s"], "p90_s": health["p90_s"],
           "outcome": outcome, "notes": {**night.notes, "spent": night.spent}}
    relayed = getattr(host, "relayed", 0)
    if relayed:
        row["notes"]["relayed"] = relayed
        say(f"::warning::the host went silent {relayed} time(s) and was asked through an Indian route")
    db.execute("insert or replace into night values (?,?,?,?,?,?,?,?,?)",
               (row["stamp"], row["day"], row["budget"], row["sent"], row["failed"],
                row["median_s"], row["p90_s"], row["outcome"], json.dumps(row["notes"], sort_keys=True)))
    db.commit()
    return row


def indian_route():
    """An opener on a verified Indian route with its own cookie jar, or None
    when the night has no pool. The host has always answered the runner
    directly; this is for a night on which it stops answering foreign
    addresses, as the national system does."""
    import http.cookiejar
    import random
    import urllib.request
    if not os.environ.get("EDUCATION_CACHE_DIR"):
        return None
    sys.path.insert(0, str(HERE.parent / "education"))
    import egress as EG
    routes = EG.NET.load_proxies(EG.pool_path("ams"))
    if not routes:
        return None
    # the faster half, as egress.Session chooses; TLS is verified as on every route
    opener = EG.NET.Route(random.choice(routes[: max(1, len(routes) // 2)])).opener()
    opener.add_handler(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    return opener


def nights(db) -> list[dict]:
    return [dict(r) for r in db.execute("select * from night order by stamp")]


def faulty_streak(nights: list[dict]) -> int:
    """How many of the latest runs, counted back from the last, were refused
    or did not read the State and district tables."""
    streak = 0
    for night in reversed(nights):
        if night["outcome"] == "complete":
            break
        streak += 1
    return streak


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--store", required=True, type=Path)
    ap.add_argument("--budget", type=int, help="requests tonight; default follows the ramp")
    ap.add_argument("--minutes", type=int, default=100, help="stop sending after this long")
    ap.add_argument("--day", type=dt.date.fromisoformat, help="read this day as yesterday")
    ap.add_argument("--school", action="append", default=[], metavar="ST:DISTRICT:BLOCK:CODE:SHIFT",
                    help="also read this school's month tonight (repeatable)")
    ap.add_argument("--check-streak", action="store_true",
                    help=f"exit 4 if the last {FAULTY_FAIL_AFTER} runs were refused or fell short; no network")
    args = ap.parse_args()

    db = ST.connect(args.store)
    if args.check_streak:
        streak = faulty_streak(nights(db))
        print(f"runs in a row not read whole: {streak}")
        if streak >= FAULTY_FAIL_AFTER:
            # An annotation, because "exit code 4" is all the run page would say.
            print(f"::error title=Meal Claims Check is not being refreshed::the last {streak} runs were "
                  "refused by the source or did not read its State and district tables")
            return 4
        return 0
    budget = args.budget or next_budget(nights(db), now_utc()[:10])
    yesterday = args.day or yesterday_ist()
    print(f"reading for {yesterday}, budget {budget} requests")
    host = RD.Host(budget=budget, deadline=time.time() + args.minutes * 60, relay=indian_route)
    finder = UD.Finder(budget=UDISE_CAP, deadline=time.time() + (args.minutes + UDISE_MINUTES) * 60)
    row = run(db, host, yesterday, now_utc(), named=[tuple(v.split(":")) for v in args.school], finder=finder)
    print(json.dumps(row, indent=1))
    # A refusal is a result, not a crash: the store keeps what was read, the
    # pages are rebuilt from it, and the next night asks for half as much.
    return 0


if __name__ == "__main__":
    sys.exit(main())
