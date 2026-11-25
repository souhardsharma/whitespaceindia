"""The one door to mdmhp.nic.in.

Every request this instrument makes goes through `Host`. It exists so that
four promises are kept in one place instead of in every caller:

1. ALLOW-LIST. Only the paths in `ALLOWED` are ever asked. The host also
   serves panels that name meal in-charges with phone numbers, user lists,
   grievance forms and a login; a deny pattern can miss a new one, so the
   reader refuses anything it was not built to read.
2. PACE. One request at a time, `PACE_S` apart, whatever the caller does.
   The host is shared by sixteen States' schools filing their day.
3. NO PAGES KEPT. Callers get parsed rows. Full pages carry a footer naming
   a State officer with an e-mail and are never returned or written.
4. MASKING. Text cells pass through phone and e-mail masks. Code fields never
   do: Haryana and Rajasthan school codes are ten digits beginning 6 or 8 and
   have exactly a mobile number's shape.

It also stops. A refusal aimed at the caller (401/403/407/429), or
`BREAKER_FAILS` failures in a row, raises `Refused`, and the run ends with
what it has. Nothing here retries past that or looks for another way in.
"""
from __future__ import annotations

import datetime as dt
import html
import http.cookiejar
import json
import re
import ssl
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request

ORIGIN = "https://mdmhp.nic.in"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")
PACE_S = 1.2
TIMEOUT_S = 90
ATTEMPTS = 3
BACKOFF_S = 10
BREAKER_FAILS = 5
REFUSALS = frozenset({401, 403, 407, 429})

# path -> what it is. Nothing else is ever requested.
ALLOWED = {
    "/Home/StateWiseSummary/HP": "page that carries the form token",
    "/Home/StateWiseSummaryPV": "all States, one date",
    "/Home/GetDisttWiseSummaryHome": "districts of a State, one date",
    "/Home/GetBlockWiseSummaryHome": "blocks of a district, one date",
    "/Home/GetClusterWiseSummaryHome": "clusters of a block, one date",
    "/Home/GetSchoolWiseSummaryHome": "schools of a cluster, one date",
    "/Home/GetSchoolDailyReportingWithAttendanceJSON": "one school, current month",
    "/Home/GetSchoolEnrollmentJSON": "one school, enrolment filed per month",
    "/Home/GetHolidaysListJSON": "the State holiday list of the session's State",
    "/Home/MDMHPReport": "all-States report page (timed once, never stored)",
}
CALENDAR_PREFIX = "/Home/MDMCalendar/"

# State code -> (name, calendar abbreviation). Rajasthan (08) is on the host
# and files almost nothing; it is absent from the all-States table and has no
# calendar page. Uttarakhand's page is UA: /UK silently serves Himachal's.
STATES = {
    "01": ("Jammu & Kashmir", "JK"),
    "02": ("Himachal Pradesh", "HP"),
    "04": ("Chandigarh", "CH"),
    "05": ("Uttarakhand", "UA"),
    "06": ("Haryana", "HR"),
    "08": ("Rajasthan", None),
    "12": ("Arunachal Pradesh", "AR"),
    "13": ("Nagaland", "NL"),
    "14": ("Manipur", "MN"),
    "15": ("Mizoram", "MZ"),
    "16": ("Tripura", "TR"),
    "18": ("Assam", "AS"),
    "23": ("Madhya Pradesh", "MP"),
    "30": ("Goa", "GA"),
    "31": ("Lakshadweep", "LD"),
    "37": ("Ladakh", "LA"),
    "38": ("Dadra & Nagar Haveli and Daman & Diu", "DH"),
}
# How the all-States table spells each State, reduced by `_key`.
_STATE_TABLE_NAMES = {
    "jammuandkashmir": "01", "himachalpradesh": "02", "chandigarh": "04",
    "uttarakhand": "05", "haryana": "06", "rajasthan": "08",
    "arunachalpradesh": "12", "nagaland": "13", "manipur": "14",
    "mizoram": "15", "tripura": "16", "assam": "18", "madhyapradesh": "23",
    "goa": "30", "lakshadweep": "31", "ladakh": "37",
    "dnhanddamananddiu": "38", "dnhdamananddiu": "38", "dnhdd": "38", "dadraandnagarhavelianddamananddiu": "38",
    "dadranagarhavelianddamandiu": "38",
}

PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)")
EMAIL = re.compile(r"[\w.+-]+\s*(?:@|\[at\]|\(at\))\s*[\w-]+(?:\s*(?:\.|\[dot\]|\(dot\))\s*[\w-]+)+", re.I)

D_PAT = re.compile(r"GetBlockwiseSummaryDetail\(\s*'(\d+)'\s*,\s*'(\d+)'", re.I)
B_PAT = re.compile(r"GetClusterwiseSummaryDetail\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,\s*'(\d+)'", re.I)
C_PAT = re.compile(r"GetSchoolwiseSummaryDetail\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,\s*'(\d+)'\s*,\s*'(\d+)'", re.I)
S_PAT = re.compile(r"GetDailyMDMServedChart\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,\s*'(\d+)'\s*\)", re.I)
TOKEN_PAT = re.compile(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"')

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


class Refused(Exception):
    """The host refused this caller, or stopped answering. The run ends."""


class NotAllowed(Exception):
    """A path outside the allow-list was asked for. A bug, never retried."""


class OutOfBudget(Exception):
    """The run's request budget or deadline is spent. Not an error."""


class Unreadable(Exception):
    """One request failed after its attempts. The caller records it as owed."""


class Empty(Unreadable):
    """The host answered, twice, with a table that has no rows for that date."""


def _key(name: str) -> str:
    return re.sub(r"[^a-z]", "", name.lower().replace("&", "and"))


def state_code_of(name: str) -> str | None:
    return _STATE_TABLE_NAMES.get(_key(name))


def mask(text: str) -> str:
    """Remove phone and e-mail shapes from a TEXT cell. Never call on a code."""
    return EMAIL.sub("[removed]", PHONE.sub("[removed]", text))


def _text(cell: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", cell))).strip()


def _int(cell: str) -> int | None:
    m = re.match(r"\s*(-?[\d,]+)", cell or "")
    return int(m.group(1).replace(",", "")) if m else None


def _rows(fragment: str):
    """(cells, raw row html) for every data row: first cell a serial number."""
    fragment = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", fragment, flags=re.S | re.I)
    for raw in re.findall(r"<tr[^>]*>(.*?)</tr>", fragment, flags=re.S | re.I):
        cells = [_text(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", raw, flags=re.S | re.I)]
        if cells and cells[0].isdigit():
            yield cells, raw


def ddmmyyyy(d: dt.date) -> str:
    return d.strftime("%d/%m/%Y")


# ---------------------------------------------------------------- parsers
# Pure functions over a response body, so they are tested on saved fragments
# with no network.

def parse_state_table(body: str) -> list[dict]:
    """[{st, name, schools, reported, meals}] from the all-States table.

    Row: Sr, State, Total schools, "Reported (pct %)", Not reported, Meals.
    """
    out = []
    for cells, _ in _rows(body):
        if len(cells) < 6:
            continue
        st = state_code_of(cells[1])
        row = {"st": st, "name": mask(cells[1]), "schools": _int(cells[2]),
               "reported": _int(cells[3]), "meals": _int(cells[5])}
        if row["schools"] is None or row["reported"] is None or row["meals"] is None:
            raise ValueError(f"state row not understood: {cells!r}")
        out.append(row)
    return out


def _area_rows(body: str, pat: re.Pattern, depth: int) -> list[dict]:
    """District, block and cluster tables share one shape.

    Row: Sr, Name, Total schools, monthly enrolment filed, not filed,
    Enrolled, daily Reported, Not reported, Meals.
    """
    out = []
    for cells, raw in _rows(body):
        if len(cells) < 9:
            continue
        m = pat.search(raw)
        row = {
            "code": m.group(depth) if m else None,
            "name": mask(cells[1]),
            "schools": _int(cells[2]),
            "enr_filed": _int(cells[3]),
            "enrolled": _int(cells[5]),
            "reported": _int(cells[6]),
            "meals": _int(cells[8]),
        }
        if row["schools"] is None or row["reported"] is None or row["meals"] is None:
            raise ValueError(f"area row not understood: {cells!r}")
        out.append(row)
    return out


def parse_districts(body: str) -> list[dict]:
    return _area_rows(body, D_PAT, 2)


def parse_blocks(body: str) -> list[dict]:
    return _area_rows(body, B_PAT, 3)


def parse_clusters(body: str) -> list[dict]:
    return _area_rows(body, C_PAT, 4)


def parse_schools(body: str) -> list[dict]:
    """[{code, shift, name, filed, enrolled, reported, meals}] of one cluster.

    Row: Sr, School, Shift, monthly enrolment filed Yes/No, Enrolled,
    daily reported Yes/No, Meals.

    THE TRAP: where enrolment is not filed the Enrolled cell reads 0. So
    `enrolled` is None unless the filed flag is Yes; a caller cannot mistake
    "not filed" for "filed as zero".
    """
    out = []
    for cells, raw in _rows(body):
        if len(cells) < 7:
            continue
        m = S_PAT.search(raw)
        if not m:
            raise ValueError(f"school row without a code: {cells!r}")
        filed = cells[3].strip().lower() == "yes"
        reported = cells[5].strip().lower() == "yes"
        enrolled, meals = _int(cells[4]), _int(cells[6])
        if cells[3].strip().lower() not in ("yes", "no") or cells[5].strip().lower() not in ("yes", "no"):
            raise ValueError(f"school row flags not understood: {cells!r}")
        out.append({
            "code": m.group(2),            # a code field: never masked
            "shift": m.group(3),
            "name": mask(cells[1]),
            "filed": filed,
            "enrolled": enrolled if filed else None,
            "reported": reported,
            "meals": (meals or 0) if reported else None,
        })
    return out


def parse_month(body: str) -> dict:
    """{year, month, meals: [per day of month]} of one school's current month."""
    j = json.loads(body)
    name = str(j.get("MonthName") or "")
    if name not in MONTHS:
        raise ValueError(f"month not understood: {name!r}")
    days, served = j.get("ListDayNo") or [], j.get("ListMDMServed") or []
    if len(days) != len(served) or days != list(range(1, len(days) + 1)):
        raise ValueError("month series not understood")
    return {"year": int(j["Year"]), "month": MONTHS.index(name) + 1,
            "meals": [int(x) for x in served],
            "attendance_recorded": str(j.get("RecordStudentAttendance") or "N") == "Y"}


def parse_enrolment(body: str) -> dict:
    """{year, months: [12 values]}: int filed, None not filed ("N") or future ("F")."""
    j = json.loads(body)
    got = {str(e.get("key")): str(e.get("value")) for e in (j.get("ListYearMonths") or [])}
    months = []
    for name in MONTHS:
        v = got.get(name, "N")
        months.append(int(v) if re.fullmatch(r"\d+", v) else None)
    return {"year": int(j["Year"]), "months": months}


def parse_holidays(body: str) -> list[dict]:
    """[{date: yyyy-mm-dd, reason}] - the two fields kept; the rest are null."""
    seen = set()
    for e in json.loads(body):
        raw = str(e.get("HolidayDate") or "")
        m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", raw.strip())
        if m:
            # The host lists some dates twice; one entry per date and reason.
            seen.add((f"{m.group(3)}-{m.group(2)}-{m.group(1)}",
                      mask(str(e.get("SubReason") or "").strip())))
    return [{"date": d, "reason": r} for d, r in sorted(seen)]


# ------------------------------------------------------------------- host

class Host:
    """A paced, allow-listed session with the host.

    budget     most requests this object will send (attempts count).
    deadline   time.time() after which nothing more is sent.
    log        callable(dict) given one record per attempt.
    """

    def __init__(self, budget: int | None = None, deadline: float | None = None,
                 pace: float = PACE_S, log=None, opener=None, sleep=time.sleep,
                 clock=time.time):
        self.budget, self.deadline, self.pace = budget, deadline, pace
        self.log, self.sleep, self.clock = log, sleep, clock
        self.sent = 0
        self.answered = 0
        self.failed = 0
        self.latencies: list[float] = []
        self._fails_in_a_row = 0
        self._next_at = 0.0
        self._token: str | None = None
        self._calendar_state: str | None = None
        if opener is None:
            jar = http.cookiejar.CookieJar()
            opener = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(jar),
                # Verified TLS, always: the default context checks the chain
                # and the hostname, and nothing here turns that off.
                urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        self._opener = opener

    # -- accounting
    def left(self) -> int | None:
        return None if self.budget is None else max(0, self.budget - self.sent)

    def can_send(self, n: int = 1) -> bool:
        if self.deadline is not None and self.clock() >= self.deadline:
            return False
        return self.budget is None or self.sent + n <= self.budget

    def health(self) -> dict:
        lat = sorted(self.latencies)
        return {
            "sent": self.sent, "answered": self.answered, "failed": self.failed,
            "median_s": round(statistics.median(lat), 2) if lat else None,
            "p90_s": round(lat[int(len(lat) * 0.9) - 1], 2) if len(lat) >= 10 else None,
        }

    # -- the one request function
    def _send(self, path: str, params: dict | None = None, form: dict | None = None,
              accept: str = "text/html, */*; q=0.01", xhr: bool = True) -> str:
        if path not in ALLOWED and not (
                path.startswith(CALENDAR_PREFIX)
                and path[len(CALENDAR_PREFIX):] in {a for _, a in STATES.values() if a}):
            raise NotAllowed(path)
        url = ORIGIN + path + ("?" + urllib.parse.urlencode(params) if params else "")
        headers = {"User-Agent": UA, "Accept": accept, "Accept-Encoding": "identity",
                   "Referer": ORIGIN + "/Home/StateWiseSummary/HP"}
        if xhr:
            headers["X-Requested-With"] = "XMLHttpRequest"
        data = None
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
        last = "no attempt"
        for attempt in range(1, ATTEMPTS + 1):
            if not self.can_send():
                raise OutOfBudget()
            wait = self._next_at - self.clock()
            if wait > 0:
                self.sleep(wait)
            started = self.clock()
            status, body = -1, b""
            try:
                req = urllib.request.Request(url, data=data, headers=headers)
                with self._opener.open(req, timeout=TIMEOUT_S) as r:
                    status, body = r.status, r.read()
            except urllib.error.HTTPError as e:
                status = e.code
            except Exception as e:  # noqa: BLE001 - transport: timeout, reset, DNS
                last = f"{type(e).__name__}"
            secs = self.clock() - started
            self._next_at = self.clock() + self.pace
            self.sent += 1
            if self.log:
                self.log({"path": path, "status": status, "bytes": len(body),
                          "s": round(secs, 2), "attempt": attempt})
            if status == 200:
                self.answered += 1
                self.latencies.append(secs)
                self._fails_in_a_row = 0
                return body.decode("utf-8", "replace")
            self.failed += 1
            self._fails_in_a_row += 1
            if status in REFUSALS:
                raise Refused(f"HTTP {status} on {path}")
            if self._fails_in_a_row >= BREAKER_FAILS:
                raise Refused(f"{self._fails_in_a_row} failures in a row, last on {path}")
            if status != -1:
                last = f"HTTP {status}"
            if attempt < ATTEMPTS:
                self.sleep(BACKOFF_S * attempt)
        raise Unreadable(f"{path}: {last}")

    # -- the reads
    def token(self, fresh: bool = False) -> str:
        if self._token is None or fresh:
            page = self._send("/Home/StateWiseSummary/HP", accept="text/html", xhr=False)
            m = TOKEN_PAT.search(page)
            if not m:
                raise Unreadable("no form token on the State page")
            self._token = m.group(1)
            self._calendar_state = None
        return self._token

    def state_table(self, day: dt.date) -> list[dict]:
        """All States for one date. A stale token is replaced once."""
        for again in (False, True):
            body = self._send("/Home/StateWiseSummaryPV", form={
                "mealServedDate": ddmmyyyy(day),
                "__RequestVerificationToken": self.token(fresh=again)})
            rows = parse_state_table(body)
            if rows:
                return rows
        raise Empty("the all-States table came back empty twice")

    def districts(self, st: str, day: dt.date) -> list[dict]:
        return parse_districts(self._send("/Home/GetDisttWiseSummaryHome", {
            "stateCode": st, "dateYesterday": ddmmyyyy(day)}))

    def blocks(self, st: str, dc: str, day: dt.date) -> list[dict]:
        return parse_blocks(self._send("/Home/GetBlockWiseSummaryHome", {
            "stateCode": st, "districtCode": dc, "dateYesterday": ddmmyyyy(day)}))

    def clusters(self, st: str, dc: str, bc: str, day: dt.date) -> list[dict]:
        return parse_clusters(self._send("/Home/GetClusterWiseSummaryHome", {
            "stateCode": st, "districtCode": dc, "blockCode": bc,
            "dateYesterday": ddmmyyyy(day)}))

    def schools(self, st: str, dc: str, bc: str, cc: str, day: dt.date) -> list[dict]:
        return parse_schools(self._send("/Home/GetSchoolWiseSummaryHome", {
            "stateCode": st, "districtCode": dc, "blockCode": bc, "clusterCode": cc,
            "dateYesterday": ddmmyyyy(day)}))

    def school_month(self, st: str, code: str, shift: str) -> dict:
        return parse_month(self._send("/Home/GetSchoolDailyReportingWithAttendanceJSON", {
            "stateCode": st, "schoolCode": code, "shiftID": shift},
            accept="application/json, text/javascript, */*; q=0.01"))

    def school_enrolment(self, st: str, dc: str, bc: str, cc: str, code: str, shift: str) -> dict:
        return parse_enrolment(self._send("/Home/GetSchoolEnrollmentJSON", {
            "StateCode": st, "DisttCode": dc, "BlockCode": bc, "Cluster": cc,
            "School": code, "Shift": shift},
            accept="application/json, text/javascript, */*; q=0.01"))

    def holidays(self, st: str) -> list[dict]:
        """The State's own holiday list. Two requests: the calendar page sets
        the State in the session, then the list is that State's. Asked without
        the page it answers Himachal's list with no State named - so the page
        is always opened first, and its body is discarded unread."""
        abbr = STATES[st][1]
        if abbr is None:
            return []
        self._send(CALENDAR_PREFIX + abbr, accept="text/html", xhr=False)
        self._calendar_state = st
        return parse_holidays(self._send(
            "/Home/GetHolidaysListJSON",
            accept="application/json, text/javascript, */*; q=0.01"))
