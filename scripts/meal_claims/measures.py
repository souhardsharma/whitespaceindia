"""What each published number MEANS, said once.

Values live in the data files; their label, definition and formula live here
and are published as `measures.json`. Pages join the two when they draw, so a
figure cannot appear under a description written for a different one, and
`check_published.py` compares the published file with this one field by field.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from flags import THRESHOLDS as T  # noqa: E402


def _n(x: float) -> str:
    """A threshold as a reader would write it: 3, 1.2, 5%."""
    return f"{x:g}"


SOURCE = "PM POSHAN daily reporting system, NIC Himachal Pradesh (mdmhp.nic.in)"
OURS = "Counted by this instrument from the tables it has read"

MEASURES: dict[str, dict] = {
    "schools": {
        "label": "Schools listed",
        "definition": "Schools the reporting system lists for the area on the date read.",
        "unit": "schools", "source": SOURCE,
    },
    "reported": {
        "label": "Schools that reported",
        "definition": "Schools that filed a daily meal report for the date.",
        "unit": "schools", "source": SOURCE,
    },
    "reported_pct": {
        "label": "Share of schools reporting",
        "definition": "Schools that filed a daily meal report for the date, as a share of the schools listed.",
        "formula": "reported / schools x 100",
        "unit": "%", "source": SOURCE,
    },
    "meals": {
        "label": "Meals reported served",
        "definition": "The total of the meal counts schools reported for the date. A school that did not report adds nothing.",
        "unit": "meals", "source": SOURCE,
    },
    "enr_filed": {
        "label": "Schools that filed enrolment",
        "definition": "Schools that have filed their enrolment for the month of the date read.",
        "unit": "schools", "source": SOURCE,
    },
    "enr_filed_pct": {
        "label": "Share that filed enrolment",
        "definition": "Schools that have filed their enrolment for the month, as a share of the schools listed. Only these schools can be tested against enrolment.",
        "formula": "enr_filed / schools x 100",
        "unit": "%", "source": SOURCE,
    },
    "enrolled": {
        "label": "Enrolment filed",
        "definition": "The total enrolment of the schools that filed one for the month. Schools that have not filed add nothing, so this is not the area's enrolment.",
        "unit": "children", "source": SOURCE,
    },
    "tables_read": {
        "label": "School tables read",
        "definition": "Cluster tables of schools this instrument has read, each for one date. A cluster is a group of neighbouring schools; one table lists every school in it for one day.",
        "unit": "tables", "source": OURS,
    },
    "school_days_tested": {
        "label": "School-days tested against enrolment",
        "definition": "Rows of those tables in which the school had filed an enrolment above zero and had reported that day. Only these rows can show meals above enrolment.",
        "unit": "school-days", "source": OURS,
    },
    "flag_over": {
        "label": "Days above filed enrolment",
        "definition": "School-days on which the meals a school reported exceed the enrolment that school filed for the month.",
        "formula": "meals > enrolment filed, enrolment filed > 0",
        "unit": "school-days", "source": OURS,
    },
    "flag_over_wide": {
        "label": "Of those, by a wide margin",
        "definition": f"School-days above filed enrolment where the meals are at least {_n(T['over_wide_ratio'])} times the enrolment and at least {_n(T['over_wide_min_excess'])} more than it.",
        "formula": f"meals >= {_n(T['over_wide_ratio'])} x enrolment filed and meals - enrolment filed >= {_n(T['over_wide_min_excess'])}",
        "unit": "school-days", "source": OURS,
    },
    "flag_closed": {
        "label": "Meals on a closed day",
        "definition": f"School-days with meals reported on a weekday the school's own record shows it does not normally serve, or on a date its State's own list marks a holiday while under {_n(T['state_shut_share'] * 100)}% of the State's schools reported.",
        "unit": "school-days", "source": OURS,
    },
    "flag_spike": {
        "label": "One-day spikes",
        "definition": f"School-days on which a school reported at least {_n(T['spike_ratio'])} times its usual daily count and at least {_n(T['spike_min_excess'])} meals more than it. The usual count is the median of its other serving days read.",
        "formula": f"meals >= {_n(T['spike_ratio'])} x median of other serving days and meals - median >= {_n(T['spike_min_excess'])}",
        "unit": "school-days", "source": OURS,
    },
    "schools_flagged": {
        "label": "Schools with a flag",
        "definition": "Schools with at least one flag that still stands on the figures as last read.",
        "unit": "schools", "source": OURS,
    },
}
