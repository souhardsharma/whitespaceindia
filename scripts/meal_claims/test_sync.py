"""Tests for the nightly run, against a host that exists only in this file.

WHY THIS EXISTS
---------------
The run is given a number of requests and must never send one more; it must
stop at a refusal and keep what it read; and it must ask for less the night
after, not the same again. None of that can be learned by trying it on the
real host, which is the thing being protected. Offline, no network.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
import urllib.error
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import flags as FL  # noqa: E402
import reader as RD  # noqa: E402
import store as ST  # noqa: E402
import sync as SY  # noqa: E402
import udise as UD  # noqa: E402

PASS = FAIL = 0
YESTERDAY = dt.date(2026, 11, 19)   # a Thursday


def check(name: str, cond: bool, detail: object = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


class PretendHost:
    """One State (16), one district, one block, two clusters, four schools.

    School 1001 reports 70 meals against a filed enrolment of 23 every day.
    """

    def __init__(self, budget: int, refuse_after: int | None = None, shut: set[dt.date] = frozenset()):
        self.budget, self.sent, self.refuse_after, self.shut = budget, 0, refuse_after, shut
        self.asked: list[str] = []

    def left(self) -> int:
        return max(0, self.budget - self.sent)

    def can_send(self, n: int = 1) -> bool:
        return self.sent + n <= self.budget

    def health(self) -> dict:
        return {"sent": self.sent, "answered": self.sent, "failed": 0, "median_s": 1.0, "p90_s": 2.0}

    def _count(self, what: str, n: int = 1) -> None:
        if not self.can_send(n):
            raise RD.OutOfBudget()
        if self.refuse_after is not None and self.sent >= self.refuse_after:
            self.sent += 1
            raise RD.Refused("HTTP 403 on " + what)
        self.sent += n
        self.asked.append(what)

    def state_table(self, day):
        self._count("states")
        open_ = day.weekday() != 6 and day not in self.shut
        return [{"st": "16", "name": "TRIPURA", "schools": 4, "reported": 4 if open_ else 0,
                 "meals": 300 if open_ else (70 if day in self.shut else 0)}]

    def districts(self, st, day):
        self._count("districts")
        if st != "16":
            return []
        return [{"code": "1605", "name": "SEPAHIJALA", "schools": 4, "enr_filed": 3,
                 "enrolled": 120, "reported": 4, "meals": 70 if day in self.shut else 300}]

    def blocks(self, st, dc, day):
        self._count("blocks")
        return [{"code": "160507", "name": "BOXANAGAR", "schools": 4, "enr_filed": 3,
                 "enrolled": 120, "reported": 4, "meals": 70 if day in self.shut else 300}]

    def clusters(self, st, dc, bc, day):
        self._count("clusters")
        shut = day in self.shut
        return [{"code": "1605070005", "name": "A", "schools": 2, "enr_filed": 2,
                 "enrolled": 73, "reported": 2, "meals": 70 if shut else 120},
                {"code": "1605070006", "name": "B", "schools": 2, "enr_filed": 1,
                 "enrolled": 47, "reported": 2, "meals": 0 if shut else 180}]

    def schools(self, st, dc, bc, cc, day):
        self._count("schools")
        shut = day in self.shut
        if cc == "1605070005":
            return [{"code": "1001", "shift": "1", "name": "Over Jr. Madrassa", "filed": True,
                     "enrolled": 23, "reported": True, "meals": 70},
                    {"code": "1002", "shift": "1", "name": "Plain School", "filed": True,
                     "enrolled": 50, "reported": not shut, "meals": None if shut else 50}]
        return [{"code": "1003", "shift": "1", "name": "Unfiled School", "filed": False,
                 "enrolled": None, "reported": not shut, "meals": None if shut else 90},
                {"code": "1004", "shift": "1", "name": "Under School", "filed": True,
                 "enrolled": 47, "reported": not shut, "meals": None if shut else 40}]

    def school_month(self, st, code, shift):
        self._count("month")
        meals = [70 if dt.date(2026, 11, d).weekday() != 4 and d <= 19 else 0 for d in range(1, 31)]
        return {"year": 2026, "month": 11, "meals": meals, "attendance_recorded": False}

    def school_enrolment(self, st, dc, bc, cc, code, shift):
        self._count("enrolment")
        return {"year": 2026, "months": [57, 57, 57, 57, 47, 82, 23, 23, 23, 23, 23, None]}

    def holidays(self, st):
        self._count("holidays", 2)
        return [{"date": "2026-11-04", "reason": "Deepawali"}]


CARD = {"udiseschCode": "00000001001", "yearDesc": "2025-26", "schoolName": "OVER JR. MADRASSA",
        "schCategoryDesc": "2-Primary with Upper Primary", "schTypeDesc": "3-Co-educational",
        "schMgmtStateDesc": "Madarsa Recognized (by Wakf board/Madarsa Board)",
        "schMgmtNationalDesc": "Madarsa", "schLocDesc": "1-Rural", "schStatusName": "Operational",
        "lowClass": 1, "highClass": 8, "ftbPr": 19, "ftbUpr": 6,
        # what the answer also carries and the instrument must not keep
        "totalTeacher": 4, "headMasterName": "A PERSON", "mobile": "9876543210", "email": "x@y.in"}


class PretendFinder:
    """UDISE+ as the run sees it: a record for school 1001, none for others."""

    def __init__(self, budget: int = 50, refuse: bool = False, next_year: bool = False):
        self.budget, self.sent, self.refuse, self.next_year = budget, 0, refuse, next_year
        self.asked: list[tuple[str, int]] = []

    def report_card(self, code, year_id):
        if self.sent >= self.budget:
            raise RD.OutOfBudget()
        self.sent += 1
        if self.refuse:
            raise RD.Refused("UDISE+ answered 403")
        self.asked.append((code, year_id))
        if code != "1001" or (year_id > UD.FIRST_YEAR_ID and not self.next_year):
            return None
        card = dict(CARD, yearDesc="2026-27") if year_id > UD.FIRST_YEAR_ID else CARD
        return UD.extract(json.dumps({"status": True, "data": card}), code)


class FakeAnswer:
    def __init__(self, body: str):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False

    def read(self) -> bytes:
        return self.body.encode()


class FakeOpener:
    def __init__(self, answers: list):
        self.answers, self.urls = list(answers), []

    def open(self, req, timeout=None):
        self.urls.append(req.full_url)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return FakeAnswer(answer)


def expect(name: str, error, fn) -> None:
    try:
        fn()
        check(name, False, "nothing was raised")
    except error:
        check(name, True)


def test_the_second_source_keeps_only_what_it_may() -> None:
    print("UDISE+")
    record = UD.extract(json.dumps({"data": CARD}), "1001")
    check("the kept fields and no others", tuple(record) == UD.FIELDS, sorted(record))
    check("no person, phone or address survives",
          not any(w in json.dumps(record) for w in ("PERSON", "9876543210", "x@y.in")))
    check("a coded label loses its number", record["type"] == "Co-educational" and record["location"] == "Rural")
    check("counts are numbers", record["textbooks_primary"] == 19 and record["high_class"] == 8)
    check("the year is kept whole", record["year"] == "2025-26", record["year"])
    check("no school under the code is an answer, not an error",
          UD.extract(json.dumps({"data": None}), "1001") is None)
    expect("another school's record is refused", RD.Unreadable,
           lambda: UD.extract(json.dumps({"data": dict(CARD, udiseschCode="16051100120")}), "1001"))
    check("a ten-digit code is written as eleven", UD.udise_code("2010100101") == "02010100101")

    opener = FakeOpener([json.dumps({"data": CARD}), urllib.error.HTTPError("u", 403, "Forbidden", {}, None)])
    waits: list[float] = []
    finder = UD.Finder(budget=3, opener=opener, sleep=waits.append, clock=lambda: 100.0)
    finder.report_card("1001", 12)
    check("one path, with the code and the year",
          opener.urls == [f"{UD.ORIGIN}{UD.PATH}?udiseSchCode=00000001001&yearId=12"], opener.urls)
    expect("a 403 is a refusal", RD.Refused, lambda: finder.report_card("1001", 12))
    check("the second request waited its turn", waits == [UD.PACE_S], waits)
    expect("nothing is sent past the budget", RD.OutOfBudget,
           lambda: UD.Finder(budget=0, opener=FakeOpener([])).report_card("1001", 12))

    folder, db = fresh_store()
    finder = PretendFinder()
    row = SY.run(db, PretendHost(budget=300), YESTERDAY, "2026-11-20T01:00:00+00:00", say=quiet, finder=finder)
    held = ST.udise(db, "16", "1001")
    check("the flagged school's record is stored", held and held["record"]["name"] == "OVER JR. MADRASSA", held)
    check("a school with no flag is not asked", {c for c, _ in finder.asked} == {"1001"}, finder.asked)
    check("the night notes what it asked",
          row["notes"]["udise"]["read"] == 1 and row["outcome"] == "complete", row["notes"])
    again = PretendFinder()
    SY.run(db, PretendHost(budget=300), YESTERDAY, "2026-11-21T01:00:00+00:00", say=quiet, finder=again)
    check("a record held is not asked for again within its term", again.asked == [], again.asked)
    later = PretendFinder(next_year=True)
    SY.run(db, PretendHost(budget=300), YESTERDAY, "2027-06-21T01:00:00+00:00", say=quiet, finder=later)
    check("a new academic year is taken up when UDISE+ answers for it",
          ST.udise(db, "16", "1001")["record"]["year"] == "2026-27", later.asked)
    refused = PretendFinder(refuse=True)
    row = SY.run(db, PretendHost(budget=300), YESTERDAY, "2028-01-21T01:00:00+00:00", say=quiet, finder=refused)
    check("a refusal there stops it after one request and leaves the night whole",
          refused.sent == 1 and row["outcome"] == "complete" and "refused" in row["notes"]["udise"], row["notes"])
    db.close()
    folder.cleanup()


def fresh_store() -> tuple:
    folder = tempfile.TemporaryDirectory()
    return folder, ST.connect(Path(folder.name) / "store.sqlite")


def quiet(*_a, **_k) -> None:
    pass


def night_row(budget, sent, failed=0, median=1.0, outcome="complete") -> dict:
    return {"budget": budget, "sent": sent, "failed": failed, "median_s": median, "outcome": outcome}


def test_budget_rises_slowly_and_falls_fast() -> None:
    print("budget")
    check("the first night starts small", SY.next_budget([]) == SY.BUDGET_START)
    check("one step up after a clean night",
          SY.next_budget([night_row(300, 300)]) == 300 + SY.BUDGET_STEP)
    check("by half once that is more than a step",
          SY.next_budget([night_row(1000, 1000)]) == 1500)
    check("never past the cap",
          SY.next_budget([night_row(SY.BUDGET_CAP - 10, SY.BUDGET_CAP - 10)]) == SY.BUDGET_CAP)
    check("halved after a refusal",
          SY.next_budget([night_row(600, 80, outcome="refused")]) == 300)
    check("halved when attempts fail",
          SY.next_budget([night_row(600, 600, failed=40)]) == 300)
    check("halved when answers slow down",
          SY.next_budget([night_row(300, 300), night_row(450, 450), night_row(600, 600, median=2.5)]) == 300)
    check("held after a night that fell short",
          SY.next_budget([night_row(450, 450, outcome="partial")]) == 450)
    check("never under the floor",
          SY.next_budget([night_row(150, 20, outcome="refused")]) == SY.BUDGET_FLOOR)
    check("a second run on the same date does not step up",
          SY.next_budget([{**night_row(300, 300), "stamp": "2026-11-25T05:59:10+00:00"}], "2026-11-25") == 300)
    check("the next date does",
          SY.next_budget([{**night_row(300, 300), "stamp": "2026-11-25T05:59:10+00:00"}], "2026-11-26") == 450)
    check("three runs short in a row are counted",
          SY.faulty_streak([night_row(300, 300), night_row(300, 9, outcome="refused"),
                            night_row(150, 150, outcome="partial"), night_row(150, 4, outcome="refused")]) == 3)
    check("a whole night ends the count",
          SY.faulty_streak([night_row(300, 9, outcome="refused"), night_row(150, 150)]) == 0)
    check("a night that sent nothing teaches nothing",
          SY.next_budget([night_row(450, 450), night_row(600, 0, outcome="partial")])
          == SY.next_budget([night_row(450, 450)]))


def test_a_night_stays_inside_its_budget() -> None:
    print("one night")
    folder, db = fresh_store()
    host = PretendHost(budget=300)
    row = SY.run(db, host, YESTERDAY, "2026-11-20T01:00:00+00:00", say=quiet)
    check("never one request past the budget", host.sent <= host.budget, host.sent)
    check("the night is complete", row["outcome"] == "complete", row)
    check("the State table is held for three days",
          db.execute("select count(*) from state_day where st='16' and day>=?",
                     (ST.iso(YESTERDAY - dt.timedelta(days=2)),)).fetchone()[0] == 3)
    check("the hierarchy is known",
          db.execute("select count(*) from cluster").fetchone()[0] == 2)
    flags = db.execute("select code, day, kind, basis from flag order by day").fetchall()
    check("only the school above its enrolment is flagged",
          {f["code"] for f in flags} == {"1001"}, [tuple(f) for f in flags][:3])
    check("its whole month was judged, Fridays apart",
          len(flags) == 17 and all(f["kind"] == "over" for f in flags), len(flags))
    check("the unfiled school was never tested",
          db.execute("select sum(tested) from cluster_read").fetchone()[0] == 3)
    check("nothing is still owed",
          db.execute("select count(*) from owed").fetchone()[0] == 0)
    db.close()
    folder.cleanup()


class ManyDistricts(PretendHost):
    """Two hundred districts: more block tables than one night's hierarchy pass can read."""

    def districts(self, st, day):
        rows = super().districts(st, day)
        return [{**rows[0], "code": f"16{n:03d}", "name": f"DISTRICT {n}"} for n in range(1, 201)] if rows else []

    def blocks(self, st, dc, day):
        return [{**row, "code": dc + "07"} for row in super().blocks(st, dc, day)]

    def clusters(self, st, dc, bc, day):
        return [{**row, "code": bc + row["code"][-4:]} for row in super().clusters(st, dc, bc, day)]


def test_cluster_lists_do_not_wait_for_every_district() -> None:
    print("hierarchy")
    folder, db = fresh_store()
    host = ManyDistricts(budget=300)
    SY.run(db, host, YESTERDAY, "2026-11-20T01:00:00+00:00", say=quiet)
    unread = db.execute("select count(*) from district where blocks_read_at is null").fetchone()[0]
    check("districts are still unread after the night", unread > 0, unread)
    check("and cluster lists were read all the same", host.asked.count("clusters") >= 5,
          host.asked.count("clusters"))
    check("so the sample had clusters to open", host.asked.count("schools") >= 5, host.asked.count("schools"))
    db.close()
    folder.cleanup()


class ShortRecord(PretendHost):
    """A host whose record begins on 1 October 2026: nothing before it."""

    BEGINS = dt.date(2026, 10, 1)

    def state_table(self, day):
        if day < self.BEGINS:
            self._count("states", 2)
            raise RD.Empty("the all-States table came back empty twice")
        return super().state_table(day)


def test_history_is_read_to_where_the_record_begins() -> None:
    print("history")
    folder, db = fresh_store()
    SY.HISTORY_ENDS_AFTER_BLANK_DAYS, kept = 10, SY.HISTORY_ENDS_AFTER_BLANK_DAYS
    try:
        for night in range(1, 4):
            host = ShortRecord(budget=3000)
            SY.run(db, host, YESTERDAY, f"2026-11-2{night}T01:00:00+00:00", say=quiet)
    finally:
        SY.HISTORY_ENDS_AFTER_BLANK_DAYS = kept
    first = db.execute("select min(day) from state_day where reported>0").fetchone()[0]
    check("the oldest day with a report is the record's first", first == "2026-10-01", first)
    floor = db.execute("select value from info where key='history_floor'").fetchone()
    check("and it is recorded as the floor", floor and floor["value"] == "2026-10-01", floor and floor["value"])
    blank = db.execute("select count(*) from table_read where kind='states' and rows=0").fetchone()[0]
    check("ten blank days older than it were asked, once", blank == 10, blank)
    check("the last night asked for no earlier date",
          host.asked.count("states") == 3, host.asked.count("states"))
    days = db.execute("select count(*) from table_read where kind='districts' and st='16'").fetchone()[0]
    open_days = db.execute("select count(*) from state_day where st='16' and reported>0").fetchone()[0]
    check("the district table is held for every day the State reported",
          days >= open_days - 1 and open_days > 30, (days, open_days))
    check("and no district table was asked for a day before the record",
          db.execute("select count(*) from table_read where kind='districts' and day<'2026-10-01'").fetchone()[0] == 0)
    db.close()
    folder.cleanup()


def test_every_school_row_read_is_kept() -> None:
    print("school rows")
    folder, db = fresh_store()
    SY.run(db, PretendHost(budget=300), YESTERDAY, "2026-11-20T01:00:00+00:00", say=quiet)
    check("four schools are on the roster",
          db.execute("select count(*) from roster").fetchone()[0] == 4)
    rows = db.execute("select rows from school_day where cc='1605070006'").fetchone()
    check("an unfiled enrolment is kept as none, not as zero",
          rows and '["1003","1",null,90]' in rows["rows"], rows and rows["rows"])
    db.close()
    folder.cleanup()


def test_an_older_store_is_brought_forward() -> None:
    print("upgrade")
    folder, db = fresh_store()
    ST.put_state_day(db, YESTERDAY, [{"st": "16", "schools": 4, "reported": 4, "meals": 300}], "r")
    ST.put_districts(db, "16", YESTERDAY, [{"code": "1605", "name": "SEPAHIJALA", "schools": 4,
                                            "enr_filed": 3, "enrolled": 120, "reported": 4, "meals": 300}])
    db.execute("update info set value='1' where key='schema'")
    db.commit()
    path = Path(db.execute("pragma database_list").fetchone()[2])
    db.close()
    db = ST.connect(path)
    check("the store now reads as the current version",
          db.execute("select value from info where key='schema'").fetchone()[0] == str(ST.SCHEMA_VERSION))
    check("tables read before are in the ledger",
          ST.days_read(db, "states") == {ST.iso(YESTERDAY)} and ST.days_read(db, "districts", "16") == {ST.iso(YESTERDAY)})
    db.close()
    folder.cleanup()


def test_a_refusal_ends_the_run_and_keeps_what_was_read() -> None:
    print("refusal")
    folder, db = fresh_store()
    host = PretendHost(budget=400, refuse_after=5)
    row = SY.run(db, host, YESTERDAY, "2026-11-20T01:00:00+00:00", say=quiet)
    check("the outcome is a refusal", row["outcome"] == "refused", row["outcome"])
    check("nothing was sent after it", host.sent == 6, host.sent)
    check("what was read before it is kept",
          db.execute("select count(*) from state_day").fetchone()[0] == 3)
    check("the next night asks for half", SY.next_budget(SY.nights(db)) == 200)
    db.close()
    folder.cleanup()


def test_a_shut_day_is_looked_into() -> None:
    print("closed day")
    folder, db = fresh_store()
    shut = dt.date(2026, 11, 19)
    host = PretendHost(budget=400, shut={shut})
    SY.run(db, host, YESTERDAY, "2026-11-20T01:00:00+00:00", say=quiet)
    check("the State counted as shut with meals reported",
          SY.closed_states(db, YESTERDAY) == ["16"])
    got = db.execute("select reported, meals, schools_found from closed_day where st='16'").fetchone()
    check("the one school that reported was found", got and got["schools_found"] == 1,
          tuple(got) if got else None)
    check("the sample went to the last open day instead",
          SY.sample_day(db, "16", YESTERDAY) == dt.date(2026, 11, 18))
    db.close()
    folder.cleanup()


def test_a_corrected_figure_unsettles_its_flag() -> None:
    print("a figure that changed")
    folder, db = fresh_store()
    day = dt.date(2026, 11, 10)
    ST.put_flag(db, "16", "1001", "1", {"kind": "over", "date": day, **FL.over_enrolment(70, 23)}, "s1")
    meals = [20] * 30
    ST.put_month(db, "16", "1001", "1", {"year": 2026, "month": 11, "meals": meals}, "r")
    SY.judge(db, "16", "1001", "1", 2026, 11, YESTERDAY, "s2")
    row = db.execute("select standing, basis, first_stamp from flag").fetchone()
    check("the flag no longer stands", row["standing"] == 0)
    check("it says what the figure is now", '"now": 20' in row["basis"], row["basis"])
    check("it keeps the night it was first seen", row["first_stamp"] == "s1")
    db.close()
    folder.cleanup()


def test_a_named_school_is_read() -> None:
    print("a named school")
    folder, db = fresh_store()
    host = PretendHost(budget=400)
    SY.run(db, host, YESTERDAY, "2026-11-20T01:00:00+00:00", say=quiet,
           named=[("16", "1605", "160507", "1004", "1")])
    check("its month is held, though no table flagged it",
          db.execute("select count(*) from school_month where code='1004'").fetchone()[0] == 1)
    check("and it is filed under its block",
          db.execute("select bc from school where code='1004'").fetchone()["bc"] == "160507")
    db.close()
    folder.cleanup()


def test_store_round_trip() -> None:
    print("store")
    folder, db = fresh_store()
    ST.put_state_day(db, YESTERDAY, [{"st": "16", "schools": 4, "reported": 4, "meals": 300}], "r")
    db.commit()
    db.close()
    base = Path(folder.name)
    ST.pack(base / "store.sqlite", base / "store.sqlite.gz")
    ST.unpack(base / "store.sqlite.gz", base / "back.sqlite")
    back = ST.connect(base / "back.sqlite")
    check("a packed store comes back whole",
          back.execute("select meals from state_day").fetchone()[0] == 300)
    back.close()
    (base / "bad.gz").write_bytes(b"not a store")
    try:
        ST.unpack(base / "bad.gz", base / "bad.sqlite")
        check("a damaged store is refused", False)
    except Exception:  # noqa: BLE001 - any refusal will do; the point is that it is not accepted
        check("a damaged store is refused", not (base / "bad.sqlite").exists())
    folder.cleanup()


def main() -> int:
    for fn in (test_budget_rises_slowly_and_falls_fast,
               test_a_night_stays_inside_its_budget, test_cluster_lists_do_not_wait_for_every_district,
               test_history_is_read_to_where_the_record_begins,
               test_every_school_row_read_is_kept, test_an_older_store_is_brought_forward,
               test_a_refusal_ends_the_run_and_keeps_what_was_read,
               test_a_shut_day_is_looked_into,
               test_a_corrected_figure_unsettles_its_flag,
               test_a_named_school_is_read,
               test_store_round_trip,
               test_the_second_source_keeps_only_what_it_may):
        fn()
    print()
    if FAIL:
        print(f"{FAIL} of {PASS + FAIL} checks FAILED")
        return 1
    print(f"all {PASS} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
