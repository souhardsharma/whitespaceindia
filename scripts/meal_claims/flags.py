"""The three tests. Pure functions: figures in, flags out, no network, no files.

A flag is a contradiction between two things one school filed on one
government system. It is never a finding: either figure may be the wrong one,
and each flag carries the figures it rests on so a reader can see which.

  over    meals reported exceed the enrolment this school filed for the month
  closed  meals reported on a day this school does not normally serve, or on
          a date its State's own list marks a holiday while the State was shut
  spike   one day far above this school's usual daily count

Thresholds live in THRESHOLDS and are published in meta.json; no page spells
one out.
"""
from __future__ import annotations

import datetime as dt
import statistics

THRESHOLDS = {
    # over: any excess is a contradiction. `wide` marks the larger ones so a
    # reader can set aside margins a late admission would explain.
    "over_wide_ratio": 1.2,
    "over_wide_min_excess": 5,
    # spike
    "spike_ratio": 3.0,
    "spike_min_excess": 30,
    "spike_min_other_days": 5,
    # closed, weekday rule: the school serves on most other weekdays, and on
    # at most this share of the other dates falling on this weekday.
    "offday_min_same_weekdays": 2,
    "offday_max_served_share": 1 / 3,
    "offday_min_other_weekday_rate": 0.5,
    # closed, holiday rule: the State counts as shut when under this share of
    # its schools reported that day.
    "state_shut_share": 0.05,
    # a State-day is drilled into when the State was shut and had been open
    # (at least this share reporting) on one of the three days before.
    "state_open_share": 0.20,
}


def over_enrolment(meals: int | None, enrolled: int | None) -> dict | None:
    """The basis of an `over` flag, or None.

    `enrolled` is None where the school has not filed (the host prints 0
    there, and the reader turns that 0 into None). A FILED zero is not
    tested: no school has zero children and serves meals, so the zero is a
    filing artefact, and it is counted separately rather than flagged.
    """
    if meals is None or enrolled is None or enrolled <= 0 or meals <= enrolled:
        return None
    excess = meals - enrolled
    wide = (meals >= enrolled * THRESHOLDS["over_wide_ratio"]
            and excess >= THRESHOLDS["over_wide_min_excess"])
    return {"meals": meals, "enrolled": enrolled, "excess": excess, "wide": wide}


def spike(meals: int | None, other_days: list[int]) -> dict | None:
    """The basis of a `spike` flag, or None.

    `other_days` are the school's other daily counts; zeros (days not served)
    are ignored, because the usual count is the usual count of a serving day.
    """
    served = [m for m in other_days if m and m > 0]
    if meals is None or len(served) < THRESHOLDS["spike_min_other_days"]:
        return None
    usual = statistics.median(served)
    if meals >= usual * THRESHOLDS["spike_ratio"] and meals - usual >= THRESHOLDS["spike_min_excess"]:
        return {"meals": meals, "usual": round(usual), "days_compared": len(served)}
    return None


def weekday_pattern(series: dict[dt.date, int], upto: dt.date) -> list[list[int]]:
    """[[served, elapsed]] for Monday..Sunday over the dates up to `upto`."""
    out = [[0, 0] for _ in range(7)]
    for day, meals in series.items():
        if day <= upto:
            out[day.weekday()][1] += 1
            out[day.weekday()][0] += 1 if meals > 0 else 0
    return out


def off_day(series: dict[dt.date, int], day: dt.date, upto: dt.date) -> dict | None:
    """Is `day` a day this school does not normally serve, by its own record?

    Judged from the school's other dates only: `day` itself is left out, so a
    report cannot vouch for itself. Returns the counts the judgement rests on,
    or None when the record does not show an off-day (including when it shows
    too little to say).
    """
    others = {d: m for d, m in series.items() if d != day and d <= upto}
    same = [m for d, m in others.items() if d.weekday() == day.weekday()]
    rest = [m for d, m in others.items() if d.weekday() != day.weekday()]
    if len(same) < THRESHOLDS["offday_min_same_weekdays"] or not rest:
        return None
    same_served = sum(1 for m in same if m > 0)
    rest_served = sum(1 for m in rest if m > 0)
    if same_served / len(same) > THRESHOLDS["offday_max_served_share"]:
        return None
    if rest_served / len(rest) < THRESHOLDS["offday_min_other_weekday_rate"]:
        return None
    return {"same_served": same_served, "same_days": len(same),
            "other_served": rest_served, "other_days": len(rest)}


def state_shut(reported: int | None, schools: int | None) -> bool | None:
    """True when the State was shut that day; None when it was not read."""
    if reported is None or not schools:
        return None
    return reported / schools < THRESHOLDS["state_shut_share"]


def month_flags(series: dict[dt.date, int], upto: dt.date,
                enrolled_by_month: dict[tuple[int, int], int | None],
                holidays: dict[dt.date, str],
                shut_days: dict[dt.date, bool]) -> list[dict]:
    """Every flag one school's daily series supports, for dates up to `upto`.

    series             date -> meals (0 where none reported)
    enrolled_by_month  (year, month) -> filed enrolment, None if not filed
    holidays           date -> reason, from the State's own list
    shut_days          date -> whether the State was shut (absent: not read)
    """
    out = []
    for day in sorted(series):
        meals = series[day]
        if day > upto or meals <= 0:
            continue
        basis = over_enrolment(meals, enrolled_by_month.get((day.year, day.month)))
        if basis:
            out.append({"kind": "over", "date": day, **basis})
        basis = spike(meals, [m for d, m in series.items() if d != day and d <= upto])
        if basis:
            out.append({"kind": "spike", "date": day, **basis})
        basis = off_day(series, day, upto)
        if basis:
            out.append({"kind": "closed", "date": day, "meals": meals, "rule": "weekday", **basis})
        elif day in holidays and shut_days.get(day) is True:
            out.append({"kind": "closed", "date": day, "meals": meals, "rule": "holiday",
                        "reason": holidays[day]})
    return out
