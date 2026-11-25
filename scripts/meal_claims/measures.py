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
UDISE = "UDISE+ school report card, Ministry of Education (kys.udiseplus.gov.in)"
NATIONAL = "PM POSHAN Automated Monitoring System, Ministry of Education (pmposhan-ams.education.gov.in)"

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
        "definition": "Cluster tables of schools read so far, each for one date. A cluster is a group of neighbouring schools, and one table lists every school in it for one day.",
        "unit": "tables", "source": OURS,
    },
    "clusters_read": {
        "label": "Clusters with a school table read",
        "definition": "Clusters for which this instrument has read the table of schools at least once.",
        "unit": "clusters", "source": OURS,
    },
    "schools_read": {
        "label": "Schools read",
        "definition": "Schools named in the school tables this instrument has read. Each is published with the enrolment it had filed and the meals it reported on the latest date read.",
        "unit": "schools", "source": OURS,
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
    "udise_asked": {
        "label": "Flagged schools looked up in UDISE+",
        "definition": "Schools with a flag whose code has been looked up in UDISE+, the Ministry of Education's yearly register of schools. UDISE+ is a separate system from the meal reporting system.",
        "unit": "schools", "source": OURS,
    },
    "udise_found": {
        "label": "Of those, found in UDISE+",
        "definition": "Flagged schools for which UDISE+ holds a report card under the code the meal system lists the school by.",
        "unit": "schools", "source": OURS,
    },
    "udise_classes": {
        "label": "Classes taught",
        "definition": "The lowest and highest class the school teaches, as it declared them to UDISE+ for the year shown. The Mid-Day Meal Rules, 2015 cover classes I to VIII, so a school teaching up to class XII has children the Rules do not cover.",
        "unit": "class", "source": UDISE,
    },
    "udise_category": {
        "label": "Kind of school",
        "definition": "The school's category, type and management as UDISE+ records them. A madrasa or other school with its own calendar may keep working days its State's holiday list does not show.",
        "source": UDISE,
    },
    "udise_status": {
        "label": "Status in the register",
        "definition": "Whether UDISE+ lists the school as operational in the year shown.",
        "source": UDISE,
    },
    "udise_textbooks": {
        "label": "Children given free textbooks",
        "definition": "Children in classes I to V (primary) and VI to VIII (upper primary) to whom the school says it gave free textbooks in the year shown. The school files this once a year for the textbook scheme, outside the meal system. It is not an enrolment figure, though it covers the same classes as the meal scheme.",
        "unit": "children", "source": UDISE,
    },
    "nat_schools": {
        "label": "Schools listed",
        "definition": "The national system's \"Total Schools\" for the State or district: the schools in its master list.",
        "unit": "schools", "source": NATIONAL,
    },
    "nat_reported": {
        "label": "Schools that reported",
        "definition": "Schools the national system counts as having sent a return for the date.",
        "unit": "schools", "source": NATIONAL,
    },
    "nat_reported_pct": {
        "label": "Share of schools reporting",
        "definition": "Schools that sent a return for the date, as a share of the schools listed.",
        "formula": "nat_reported / nat_schools x 100",
        "unit": "%", "source": NATIONAL,
    },
    "nat_holiday": {
        "label": "Schools on holiday",
        "definition": "The figure in the national system's \"Holiday\" column for the date, copied as printed.",
        "unit": "schools", "source": NATIONAL,
    },
    "nat_enrolled": {
        "label": "Enrolment",
        "definition": "The national system's \"Student Enrolment\" for every school it lists in the State or district.",
        "unit": "children", "source": NATIONAL,
    },
    "nat_approved": {
        "label": "Children approved",
        "definition": "The national system's \"No. of Students approved by PAB\": the number of children in the State for whom the scheme's Programme Approval Board approved meals for the year. Shown for States only.",
        "unit": "children", "source": NATIONAL,
    },
    "nat_rep_enrolled": {
        "label": "Enrolment in reporting schools",
        "definition": "Enrolment of the schools that sent a return for the date.",
        "unit": "children", "source": NATIONAL,
    },
    "nat_meals": {
        "label": "Meals reported",
        "definition": "The national system's \"Availed meals\": meals the reporting schools said children took on the date.",
        "unit": "meals", "source": NATIONAL,
    },
    "nat_meals_pct": {
        "label": "Meals per 100 enrolled",
        "definition": "Meals reported, per 100 children enrolled in the schools that reported.",
        "formula": "nat_meals / nat_rep_enrolled x 100",
        "unit": "per 100", "source": NATIONAL,
    },
}
