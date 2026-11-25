"""Tests for the reader's parsers and the three flag rules.

WHY THIS EXISTS
---------------
A flag names a school in public. Each rule below was written against a real
case the build brief records, and each has a neighbour that must NOT flag: a
madrassa that serves on Sundays and rests on Fridays, a school that has not
filed its enrolment (the host prints 0, which is not an enrolment of zero), a
ten-digit school code that looks like a mobile number. Offline: the fixtures
are answers the host gave, saved with nothing but counts, codes and names.
"""
from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import flags as FL  # noqa: E402
import reader as RD  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures"
PASS = FAIL = 0


def check(name: str, cond: bool, detail: object = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def fixture(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def series_of(month: dict) -> dict[dt.date, int]:
    return {dt.date(month["year"], month["month"], i + 1): m
            for i, m in enumerate(month["meals"])}


def test_school_table_reads_filed_and_unfiled_apart() -> None:
    print("school table")
    rows = RD.parse_schools(fixture("schools_1605070005_20260915.html"))
    check("35 schools", len(rows) == 35, len(rows))
    check("codes are digits", all(r["code"].isdigit() for r in rows))
    unfiled = [r for r in rows if not r["filed"]]
    check("an unfiled school has no enrolment, not zero",
          all(r["enrolled"] is None for r in unfiled))
    silent = [r for r in rows if not r["reported"]]
    check("a silent school has no meals, not zero",
          all(r["meals"] is None for r in silent))
    over = [r for r in rows if FL.over_enrolment(r["meals"], r["enrolled"])]
    check("7 schools above their filed enrolment on 15 Sep 2026", len(over) == 7, len(over))


def test_roll_up_tables() -> None:
    print("district and block tables")
    districts = RD.parse_districts(fixture("districts_05_20261123.html"))
    check("Uttarakhand has 13 districts", len(districts) == 13, len(districts))
    check("reported never exceeds schools",
          all(d["reported"] <= d["schools"] for d in districts))
    blocks = RD.parse_blocks(fixture("blocks_02_201_20261119.html"))
    check("block codes sit under their district",
          blocks and all(b["code"].startswith("201") for b in blocks),
          [b["code"] for b in blocks][:3])


def test_masking_spares_codes() -> None:
    print("masking")
    check("an e-mail is removed", "@" not in RD.mask("write to head.school@example.in today"))
    check("a mobile number is removed", "9876543210" not in RD.mask("call 9876543210"))
    check("a state name is untouched", RD.mask("MADHYA PRADESH") == "MADHYA PRADESH")


def test_over_enrolment() -> None:
    print("meals above filed enrolment")
    check("70 meals, 23 enrolled", FL.over_enrolment(70, 23) == {
        "meals": 70, "enrolled": 23, "excess": 47, "wide": True})
    basis = FL.over_enrolment(24, 22)
    check("24 against 22 flags, as a narrow margin", basis and basis["wide"] is False, basis)
    check("equal is not above", FL.over_enrolment(23, 23) is None)
    check("not filed is never tested", FL.over_enrolment(70, None) is None)
    check("a filed zero is never tested", FL.over_enrolment(70, 0) is None)
    check("no report is never tested", FL.over_enrolment(None, 23) is None)


def test_the_friday_off_madrassa() -> None:
    print("Hazi Haidar Ali Jr. Madrassa, November 2026")
    month = RD.parse_month(fixture("month_16050718101.json"))
    enrol = RD.parse_enrolment(fixture("enrol_16050718101.json"))
    check("enrolment filed for November is 23", enrol["months"][10] == 23, enrol["months"])
    check("December is not yet filed", enrol["months"][11] is None)
    series = series_of(month)
    upto = dt.date(2026, 11, 15)
    found = FL.month_flags(series, upto, {(2026, 11): enrol["months"][10]}, {}, {})
    kinds = {f["kind"] for f in found}
    check("above enrolment only", kinds == {"over"}, kinds)
    days = {f["date"].day for f in found}
    check("Sunday 8 and Sunday 15 November are among them", {8, 15} <= days, sorted(days))
    check("its Sundays are not off-days: it serves on them",
          FL.off_day(series, dt.date(2026, 11, 15), upto) is None)
    pattern = FL.weekday_pattern(series, upto)
    check("it rests on Fridays", pattern[4][0] == 0 and pattern[4][1] == 2, pattern[4])
    check("it serves on Sundays", pattern[6][0] == pattern[6][1] == 3, pattern[6])


def test_the_one_day_spike() -> None:
    print("UEGS BADAKA TOLA, November 2026")
    series = series_of(RD.parse_month(fixture("month_23470611903.json")))
    upto = dt.date(2026, 11, 15)
    found = FL.month_flags(series, upto, {}, {}, {})
    spikes = [f for f in found if f["kind"] == "spike"]
    check("one spike", len(spikes) == 1, spikes)
    check("on 1 November, 8,674 meals",
          spikes and spikes[0]["date"] == dt.date(2026, 11, 1) and spikes[0]["meals"] == 8674)
    check("against a usual count near 25", spikes and 20 <= spikes[0]["usual"] <= 30, spikes)
    check("too early to call that Sunday an off-day: one other Sunday lies in a break",
          [f for f in found if f["kind"] == "closed"] == [])
    later = dt.date(2026, 11, 23)
    series[dt.date(2026, 11, 22)] = 0
    for day in (16, 17, 18, 19, 20, 21, 23):
        series[dt.date(2026, 11, day)] = 20
    closed = [f for f in FL.month_flags(series, later, {}, {}, {}) if f["kind"] == "closed"]
    check("after two ordinary empty Sundays it is a day the school does not normally serve",
          [f["date"].day for f in closed] == [1] and closed[0]["rule"] == "weekday", closed)
    check("an ordinary day is not a spike", FL.spike(30, [30, 26, 23, 9, 25, 24, 22]) is None)
    check("too little history says nothing", FL.spike(900, [30, 26]) is None)


def test_a_report_cannot_vouch_for_itself() -> None:
    print("off-day rule")
    monday = dt.date(2026, 11, 2)
    # Served Monday to Saturday for three weeks, never on Sunday, then once.
    series = {monday + dt.timedelta(days=i): (0 if (monday + dt.timedelta(days=i)).weekday() == 6 else 40)
              for i in range(21)}
    sunday = dt.date(2026, 11, 22)
    series[sunday] = 38
    upto = sunday
    basis = FL.off_day(series, sunday, upto)
    check("a first Sunday after two empty ones is an off-day",
          basis == {"same_served": 0, "same_days": 2, "other_served": 18, "other_days": 18}, basis)
    check("one earlier Sunday is too little to say",
          FL.off_day({d: m for d, m in series.items() if d >= dt.date(2026, 11, 15)}, sunday, upto) is None)
    check("a school that rarely serves at all is not judged",
          FL.off_day({d: (m if d == sunday else 0) for d, m in series.items()}, sunday, upto) is None)
    check("days after `upto` are not read as empty days",
          FL.off_day(series, dt.date(2026, 11, 3), dt.date(2026, 11, 4)) is None)


def test_a_break_or_a_holiday_is_not_a_weekly_rest() -> None:
    print("breaks and holidays")
    start = dt.date(2026, 10, 26)
    days = [start + dt.timedelta(days=i) for i in range(30)]
    # Monday to Saturday, with a festival week (7 to 11 November) and one
    # holiday Tuesday (24 November) on which the whole State was shut.
    series = {d: (0 if d.weekday() == 6 or 7 <= d.day <= 11 or d.day == 24 else 60) for d in days}
    upto = dt.date(2026, 11, 24)
    check("the festival week is a break",
          FL.breaks(series, upto) == {dt.date(2026, 11, d) for d in (7, 8, 9, 10, 11)}, FL.breaks(series, upto))
    check("a lone Sunday is not a break", dt.date(2026, 11, 15) not in FL.breaks(series, upto))
    shut = {d: d.weekday() == 6 or d.day == 24 for d in days}
    check("the holiday Tuesday is a one-off; Sundays are not",
          FL.one_off_shut(shut, upto) == {dt.date(2026, 11, 24)}, FL.one_off_shut(shut, upto))
    november = {d: (0 if d.day == 17 else m) for d, m in series.items() if d.month == 11}
    check("counted plainly, a break, a holiday and one missed report made Tuesday an off-day",
          FL.off_day(november, dt.date(2026, 11, 3), upto) is not None)
    check("set aside, they do not",
          FL.off_day(november, dt.date(2026, 11, 3), upto,
                     FL.breaks(november, upto) | FL.one_off_shut(shut, upto)) is None)
    found = FL.month_flags(series, upto, {}, {}, shut)
    check("set aside, no Tuesday is flagged", found == [], found)
    series[dt.date(2026, 11, 22)] = 55
    found = FL.month_flags(series, upto, {}, {}, shut)
    check("a Sunday report is still flagged",
          [(f["kind"], f["date"].day) for f in found] == [("closed", 22)], found)
    check("a listed holiday is set aside too",
          FL.off_day(series, dt.date(2026, 11, 3), upto, {dt.date(2026, 11, 10), dt.date(2026, 11, 24)}) is None)


def test_holiday_rule_needs_the_state_shut() -> None:
    print("holiday rule")
    day = dt.date(2026, 11, 4)
    series = {dt.date(2026, 11, d): 50 for d in range(2, 8)}
    hol = {day: "Deepawali"}
    got = FL.month_flags(series, dt.date(2026, 11, 7), {}, hol, {day: True})
    check("listed holiday, State shut: flagged",
          [(f["kind"], f["rule"]) for f in got] == [("closed", "holiday")], got)
    check("listed holiday, State open: not flagged",
          FL.month_flags(series, dt.date(2026, 11, 7), {}, hol, {day: False}) == [])
    check("listed holiday, State not read: not flagged",
          FL.month_flags(series, dt.date(2026, 11, 7), {}, hol, {}) == [])
    check("an unlisted date is never called a working day or a holiday",
          FL.month_flags(series, dt.date(2026, 11, 7), {}, {}, {day: True}) == [])
    check("under 5% reporting is shut", FL.state_shut(40, 1000) is True)
    check("a third reporting is open", FL.state_shut(333, 1000) is False)
    check("an unread day is neither", FL.state_shut(None, 1000) is None)


def main() -> int:
    for fn in (test_school_table_reads_filed_and_unfiled_apart,
               test_roll_up_tables,
               test_masking_spares_codes,
               test_over_enrolment,
               test_the_friday_off_madrassa,
               test_the_one_day_spike,
               test_a_report_cannot_vouch_for_itself,
               test_a_break_or_a_holiday_is_not_a_weekly_rest,
               test_holiday_rule_needs_the_state_shut):
        fn()
    print()
    if FAIL:
        print(f"{FAIL} of {PASS + FAIL} checks FAILED")
        return 1
    print(f"all {PASS} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
