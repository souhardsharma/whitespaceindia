"""The national PM POSHAN daily system (pmposhan-ams.education.gov.in).

Every State and Union Territory sends its schools' daily meal returns to the
Ministry of Education's Automated Monitoring System. One public page,
"AMS Reporting Status", shows a day's totals for each of the 36 States and
UTs and, one click down, for each district of a State. This module reads
those two levels and nothing below them.

HOW THE PAGE WORKS. It is an ASP.NET form. There is no address per State or
per date: a date search and a click on a State are both a POST of the whole
form back to the same address, carrying the hidden fields the previous
answer gave. So a read is a FLOW of requests that must share one cookie jar
and one exit address (egress.Session).

WHAT IS NEVER DONE. Only PAGE is ever asked for. The "Download" button
(btnPdf) is never sent, nor the login page, nor any level below district.
The date box offers the last 30 days; an older date is not posted.

WHERE IT IS READ FROM. The host closes every connection from an address
outside India, so the nightly job reads it through verified Indian routes
(scripts/education/egress.py). TLS is verified on every request, so a route
carries bytes it can neither read nor alter.
"""
from __future__ import annotations

import datetime as dt
import html
import re
import urllib.parse

ORIGIN = "https://pmposhan-ams.education.gov.in"
PAGE = ORIGIN + "/Reported_ams_School.aspx"
WINDOW_DAYS = 30          # the date box offers today and the 30 days before
MIN_STATES = 30           # a State table with fewer rows is not the State table

GRID = "ctl00_ContentPlaceHolder1_Grd_total_detail"
DATE_FIELD = "ctl00$ContentPlaceHolder1$txtdate"
SEARCH = "ctl00$ContentPlaceHolder1$btnsearch"
BACK_TO_STATES = "ctl00$ContentPlaceHolder1$btnstate"

_CELL = re.compile(GRID + r'_ctl(\d+)_(\w+)"[^>]*>(.*?)</(?:span|a)>', re.S)
_HIDDEN = re.compile(r'<input type="hidden" name="([^"]+)"[^>]*?value="([^"]*)"', re.S)
_HIDDEN_ANY = re.compile(r'<input type="hidden" name="([^"]+)"', re.S)
_TITLE = re.compile(r'lblreport_title"[^>]*>\s*AMS Reporting Status\s*:\s*([^<]+)<')
_STATE = re.compile(r'lblstatename"[^>]*>\s*State\s*/\s*UT\s*:\s*([^<]+)<')
_DEEPER = re.compile(r'lbl(?:dist|district|block|village)name"[^>]*>')

# our name for each figure: the page's label id, in a data row and in the TOTAL row
FIELDS = {
    "schools": ("lbltot_sch", "lblfttot_sch"),
    "reported": ("lblreport_sch", "lblftreport_sch"),
    "holiday": ("lblholiday_yn", "lblftholiday_yn"),
    "enrolled": ("lbltot_enrol", "lblfttot_enrol"),
    "approved": ("lblpab_enroll", "lblftpab_enroll"),
    "rep_enrolled": ("lblreport_enrol", "lblftreport_enrol"),
    "meals": ("lblmeal_served_tot", "lblftmeal_served_tot"),
}
SUMMED = ("schools", "reported", "enrolled", "rep_enrolled", "meals")


class Unreadable(Exception):
    """The answer is not the table that was asked for."""


def date_text(day: dt.date) -> str:
    return f"{day.day:02d} {day.strftime('%B %Y')}"


def parse_date(text: str) -> dt.date | None:
    try:
        return dt.datetime.strptime(" ".join(text.split()), "%d %B %Y").date()
    except ValueError:
        return None


def _int(text: str) -> int | None:
    m = re.fullmatch(r"\s*(\d[\d,]*)\s*", text or "")
    return int(m.group(1).replace(",", "")) if m else None


def _name(cell: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", cell))).strip()


def hidden_fields(body: str) -> dict[str, str]:
    fields = {name: "" for name in _HIDDEN_ANY.findall(body)}
    fields.update({name: html.unescape(value) for name, value in _HIDDEN.findall(body)})
    return fields


def parse(body: str) -> dict:
    """One answer of the page: its date, its level, its rows and its TOTAL row.

    `state` is None on the all-States table and the State's name on a district
    table. Each row carries `target`, the postback that opens it. A figure the
    page leaves blank is None, never 0.
    """
    title = _TITLE.search(body)
    day = parse_date(html.unescape(title.group(1))) if title else None
    if day is None:
        raise Unreadable("no dated report title in the answer")
    if _DEEPER.search(body):
        raise Unreadable("the answer is below district level")
    state = _STATE.search(body)
    by_row: dict[str, dict[str, str]] = {}
    for ctl, label, inner in _CELL.findall(body):
        by_row.setdefault(ctl, {})[label] = inner
    rows, total = [], None
    for ctl in sorted(by_row):
        cells = by_row[ctl]
        if "lblftNamesch" in cells:
            total = {key: _int(cells.get(foot, "")) for key, (_, foot) in FIELDS.items()}
            continue
        if "lnkbtn_name" not in cells:
            continue
        row = {"name": _name(cells["lnkbtn_name"]),
               "target": f"ctl00$ContentPlaceHolder1$Grd_total_detail$ctl{ctl}$lnkbtn_name"}
        row.update({key: _int(cells.get(label, "")) for key, (label, _) in FIELDS.items()})
        if not row["name"] or row["schools"] is None:
            raise Unreadable(f"row {ctl} has no name or no school count")
        rows.append(row)
    if not rows:
        raise Unreadable("the table has no rows")
    names = [r["name"] for r in rows]
    if len(set(names)) != len(names):
        raise Unreadable("a name appears twice in the table")
    return {"day": day, "state": _name(state.group(1)) if state else None,
            "rows": rows, "total": total, "fields": hidden_fields(body)}


def sums(rows: list[dict]) -> dict:
    return {key: sum(r[key] or 0 for r in rows) for key in SUMMED}


def disagreements(page: dict) -> list[str]:
    """Where the page's own TOTAL row differs from the sum of its rows."""
    if not page["total"]:
        return ["no TOTAL row"]
    ours = sums(page["rows"])
    return [f"{key}: rows sum to {ours[key]}, TOTAL says {page['total'][key]}"
            for key in SUMMED if page["total"].get(key) not in (None, ours[key])]


class Flow:
    """The page, driven the way its own buttons drive it.

    `request(url, data)` returns (status, body) and raises on a lost route;
    the caller starts a new Flow on another route. `sent` counts requests.
    """

    def __init__(self, request):
        self.request, self.sent = request, 0
        self.top: dict | None = None     # the all-States table now held
        self.page: dict | None = None    # the last answer
        self.reuse = True                # may a State be opened from `top` after another?

    def _ask(self, target: str | None, day: dt.date | None, form: dict | None) -> dict:
        data = None
        if target is not None:
            fields = {**form, "__EVENTTARGET": target, "__EVENTARGUMENT": "",
                      DATE_FIELD: date_text(day)}
            data = urllib.parse.urlencode(fields).encode()
        self.sent += 1
        status, body = self.request(PAGE, data)
        if status != 200:
            raise Unreadable(f"HTTP {status}")
        self.page = parse(body)
        return self.page

    def open(self) -> dict:
        page = self._ask(None, None, None)
        self._must_be_top(page, None)
        return page

    def _must_be_top(self, page: dict, day: dt.date | None) -> None:
        if page["state"] is not None or len(page["rows"]) < MIN_STATES:
            raise Unreadable(f"not the all-States table ({len(page['rows'])} rows)")
        if day is not None and page["day"] != day:
            raise Unreadable(f"asked for {day}, the answer is dated {page['day']}")
        self.top = page

    def states(self, day: dt.date) -> dict:
        """The all-States table for one day."""
        if self.top is None:
            self.open()
        if self.page["state"] is None:
            self._must_be_top(self.page, None)
        else:                                    # on a district table: go back up
            self._must_be_top(self._ask(BACK_TO_STATES, self.page["day"], self.page["fields"]), None)
        if self.top["day"] != day:
            self._must_be_top(self._ask(SEARCH, day, self.top["fields"]), day)
        return self.top

    def districts(self, day: dt.date, state: str) -> dict:
        """One State's district table for one day."""
        if self.page and self.page["state"] == state:
            if self.page["day"] != day:          # a search keeps the level it is on
                page = self._ask(SEARCH, day, self.page["fields"])
                self._must_be(page, day, state)
            return self.page
        if not self.reuse or self.top is None or self.top["day"] != day:
            self.states(day)
        row = next((r for r in self.top["rows"] if r["name"] == state), None)
        if row is None:
            raise Unreadable(f"{state} is not in the all-States table")
        first_from_top = self.page is self.top and not self.top.get("opened")
        self.top["opened"] = True
        try:
            page = self._ask(row["target"], day, self.top["fields"])
            self._must_be(page, day, state)
        except Unreadable:
            if first_from_top or not self.reuse:
                raise
            # The page would not open a second State from a table it had
            # already answered from. From here on, go back up first.
            self.reuse = False
            return self.districts(day, state)
        return page

    def _must_be(self, page: dict, day: dt.date, state: str) -> None:
        if page["state"] != state:
            raise Unreadable(f"asked for {state}, the answer is {page['state'] or 'the all-States table'}")
        if page["day"] != day:
            raise Unreadable(f"asked for {day}, the answer is dated {page['day']}")
