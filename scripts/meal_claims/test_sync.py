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
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import flags as FL  # noqa: E402
import reader as RD  # noqa: E402
import store as ST  # noqa: E402
import sync as SY  # noqa: E402

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
    check("never past the cap", SY.next_budget([night_row(1000, 1000)]) == SY.BUDGET_CAP)
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
    check("a night that sent nothing teaches nothing",
          SY.next_budget([night_row(450, 450), night_row(600, 0, outcome="partial")]) == 600)


def test_a_night_stays_inside_its_budget() -> None:
    print("one night")
    folder, db = fresh_store()
    host = PretendHost(budget=80)
    row = SY.run(db, host, YESTERDAY, "2026-11-20T01:00:00+00:00", say=quiet)
    check("never one request past the budget", host.sent <= 80, host.sent)
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
    host = PretendHost(budget=120, shut={shut})
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
    host = PretendHost(budget=120)
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
               test_a_night_stays_inside_its_budget,
               test_a_refusal_ends_the_run_and_keeps_what_was_read,
               test_a_shut_day_is_looked_into,
               test_a_corrected_figure_unsettles_its_flag,
               test_a_named_school_is_read,
               test_store_round_trip):
        fn()
    print()
    if FAIL:
        print(f"{FAIL} of {PASS + FAIL} checks FAILED")
        return 1
    print(f"all {PASS} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
