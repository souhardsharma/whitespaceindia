"""The second source: a school's own record in UDISE+.

WHY THIS EXISTS
---------------
A flag rests on figures one system holds: the meal reports and the enrolment
a school filed on the PM POSHAN daily reporting system. The Ministry of
Education keeps a separate register of schools, UDISE+, filed once a year by
the school and checked by its block office, and its public school finder
("Know Your School", kys.udiseplus.gov.in) answers one address without a key
or a login: a school's report card, by the same code the meal system lists
the school under. That gives a reader of a flag something the meal system
cannot: what the school is (the classes it teaches, who runs it, whether it is
open) and how many children it gave free textbooks to in classes I to VIII,
which is a headcount filed somewhere else.

WHAT IS NOT READ
----------------
One path and nothing else. The finder's search sits behind a CAPTCHA and is
never asked; enrolment by class needs the id that search gives and is
therefore out of reach. The report card also names teachers by number and
the school profile names its head: this module keeps the fields in `KEPT`
and drops the answer's every other key before anything is stored.

It is read from GitHub's runner only, slowly, a few hundred schools a night at
most, and a refusal ends the night's reading of it.
"""
from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

import reader as RD

ORIGIN = "https://kys.udiseplus.gov.in"
PATH = "/web-app/api/school/report-card"
PACE_S = 1.5
TIMEOUT_S = 60
BREAKER_FAILS = 5
# UDISE+ numbers its academic years: 11 is 2024-25, 12 is 2025-26. The run
# asks for the year after the newest it has seen, so a new year is taken up
# the night it appears and this number never needs editing.
FIRST_YEAR_ID = 12

# answer key -> the name it is published under. Nothing else is kept.
KEPT = {
    "yearDesc": "year",
    "schoolName": "name",
    "schCategoryDesc": "category",
    "schTypeDesc": "type",
    "schMgmtStateDesc": "management",
    "schMgmtNationalDesc": "management_group",
    "schLocDesc": "location",
    "schStatusName": "status",
    "lowClass": "low_class",
    "highClass": "high_class",
    "ftbPr": "textbooks_primary",
    "ftbUpr": "textbooks_upper",
}
CLASSES = ("low_class", "high_class")      # pre-primary is written below 1
NUMBERS = CLASSES + ("textbooks_primary", "textbooks_upper")
FIELDS = tuple(KEPT.values())


def udise_code(code: str) -> str:
    """The meal system's school code as UDISE+ writes it: eleven digits.
    Himachal Pradesh's codes begin with its State code 02 and the meal
    system drops the leading zero."""
    return code.zfill(11)


def _label(text) -> str | None:
    """'3-Co-educational' as 'Co-educational'; blank as None."""
    if text is None:
        return None
    text = RD.mask(" ".join(str(text).split()))
    head, sep, tail = text.partition("-")
    if sep and head.strip().isdigit() and len(head.strip()) <= 2:   # not the year, "2025-26"
        text = tail.strip()
    return text or None


def _number(value, least: int) -> int | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n >= least else None


def extract(body: str, code: str) -> dict | None:
    """The kept fields of one answer; None when UDISE+ holds no school under
    this code. Raises Unreadable on an answer that is not a report card."""
    try:
        doc = json.loads(body)
    except ValueError as e:
        raise RD.Unreadable(f"UDISE+ answer for {code} is not JSON: {e}") from None
    if not isinstance(doc, dict):
        raise RD.Unreadable(f"UDISE+ answer for {code} is not an object")
    data = doc.get("data")
    if not isinstance(data, dict) or not data.get("schoolName"):
        return None
    theirs = str(data.get("udiseschCode") or "").zfill(11)
    if theirs != udise_code(code):
        # A record for a different school must never be published under this one.
        raise RD.Unreadable(f"UDISE+ answered {theirs} when asked for {udise_code(code)}")
    record = {}
    for key, name in KEPT.items():
        if name in NUMBERS:
            record[name] = _number(data.get(key), -5 if name in CLASSES else 0)
        else:
            record[name] = _label(data.get(key))
    return record


class Finder:
    """A paced session with the school finder, one allowed path.

    budget     most requests this object will send.
    deadline   time.time() after which nothing more is sent.
    """

    def __init__(self, budget: int, deadline: float | None = None, pace: float = PACE_S,
                 opener=None, sleep=time.sleep, clock=time.time):
        self.budget, self.deadline, self.pace = budget, deadline, pace
        self.sleep, self.clock = sleep, clock
        self.sent = self.failed = 0
        self._fails_in_a_row = 0
        self._next_at = 0.0
        if opener is None:
            opener = urllib.request.build_opener(
                urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        self._opener = opener

    def can_send(self) -> bool:
        if self.deadline is not None and self.clock() >= self.deadline:
            return False
        return self.sent < self.budget

    def report_card(self, code: str, year_id: int) -> dict | None:
        """One school's kept fields for one year, or None when there is no
        record. Raises OutOfBudget, Refused or Unreadable."""
        if not self.can_send():
            raise RD.OutOfBudget()
        wait = self._next_at - self.clock()
        if wait > 0:
            self.sleep(wait)
        query = urllib.parse.urlencode({"udiseSchCode": udise_code(code), "yearId": year_id})
        req = urllib.request.Request(f"{ORIGIN}{PATH}?{query}", headers={
            "User-Agent": RD.UA, "Accept": "application/json"})
        self.sent += 1
        try:
            with self._opener.open(req, timeout=TIMEOUT_S) as resp:
                body = resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            self._next_at = self.clock() + self.pace
            if e.code in RD.REFUSALS:
                raise RD.Refused(f"UDISE+ answered {e.code}") from None
            self._failed(f"UDISE+ answered {e.code} for {code}")
        except (urllib.error.URLError, OSError) as e:
            self._next_at = self.clock() + self.pace
            self._failed(f"UDISE+ could not be reached for {code}: {e}")
        self._next_at = self.clock() + self.pace
        self._fails_in_a_row = 0
        return extract(body, code)

    def _failed(self, what: str):
        self.failed += 1
        self._fails_in_a_row += 1
        if self._fails_in_a_row >= BREAKER_FAILS:
            raise RD.Refused(f"{BREAKER_FAILS} requests in a row failed; last: {what}")
        raise RD.Unreadable(what)
