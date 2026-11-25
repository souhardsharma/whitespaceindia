"""Tests for the national system's reader, against a page that exists only here.

WHY THIS EXISTS
---------------
The page is a form that answers every question from one address, so a reader
can be handed a different table from the one it asked for and never know:
another day's, another State's, or the all-States table again. Storing that
under the wrong name would publish one State's children as another's. These
tests give the reader such answers and check that it refuses them, and that a
night keeps going when its route dies. Offline, no network.
"""
from __future__ import annotations

import datetime as dt
import itertools
import shutil
import sys
import tempfile
import threading
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ams as AMS  # noqa: E402
import ams_sync as AS  # noqa: E402
import store as ST  # noqa: E402

PASS = FAIL = 0


def QUIET(*_):
    """A night's progress lines are not part of what is tested."""


SERIAL = itertools.count()
YESTERDAY = dt.date(2026, 11, 24)
STATES = [f"STATE {n:02d}" for n in range(1, 35)] + ["A & N ISLANDS", "TRIPURA"]
DISTRICTS = ["DHALAI", "GOMATI", "SIPAHIJALA"]
G = "ctl00_ContentPlaceHolder1_Grd_total_detail"


def check(name: str, cond: bool, detail: object = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def figures(name: str, day: dt.date) -> dict:
    """Made-up figures that differ by name and by day, so a mix-up shows."""
    seed = sum(map(ord, name)) + day.toordinal()
    schools = 100 + seed % 900
    reported = 0 if name == "A & N ISLANDS" else schools - seed % 50
    return {"schools": schools, "reported": reported, "holiday": seed % 3,
            "enrolled": schools * 40, "approved": schools * 30,
            "rep_enrolled": reported * 40, "meals": reported * 25}


def row_html(n: int, name: str, f: dict, top: bool) -> str:
    ctl = f"{n + 4:02d}"
    span = lambda label, v: f'<span id="{G}_ctl{ctl}_{label}">{v}</span>'  # noqa: E731
    approved = f"<td> &nbsp; {span('lblpab_enroll', f['approved'])} &nbsp; </td>" if top else ""
    return (f'<tr class="text-right"><td>{span("lblsno", n + 1)}</td><td> &nbsp;&nbsp; '
            f'<a id="{G}_ctl{ctl}_lnkbtn_name" href="javascript:__doPostBack(\'x\',\'\')">'
            f'{name.replace("&", "&amp;")}</a> </td><td>{span("lbltot_sch", f["schools"])}</td>'
            f'<td>{span("lblreport_sch", f["reported"])} <b>&nbsp;[{span("lblreport_sch_per", "9.5")}%]</b></td>'
            f'<td> &nbsp;{span("lblholiday_yn", f["holiday"])}&nbsp; </td>'
            f'<td>{span("lblmeal_sch", "99.5")}&nbsp;% </td>'
            f'<td> &nbsp; {span("lbltot_enrol", f["enrolled"])} &nbsp; </td>{approved}'
            f'<td>{span("lblreport_enrol", f["rep_enrolled"])}</td>'
            f'<td> &nbsp; {span("lblmeal_served_tot", f["meals"])} &nbsp; </td></tr>')


def page_html(day: dt.date, state: str | None, wrong_total: bool = False) -> str:
    names = STATES if state is None else DISTRICTS
    rows = [figures((state or "") + n, day) for n in names]
    total = {k: sum(r[k] for r in rows) for k in rows[0]}
    if wrong_total:
        total["meals"] += 1
    ctl = f"{len(names) + 4:02d}"
    foot = "".join(f'<span id="{G}_ctl{ctl}_{label}">{total[key]}</span>'
                   for key, (_, label) in AMS.FIELDS.items())
    crumb = (f'<button id="ctl00_ContentPlaceHolder1_btnstate"><span id="ctl00_ContentPlaceHolder1_lblstatename">'
             f'State / UT : {state.replace("&", "&amp;")}</span></button>') if state else ""
    return (f'<form><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="{state or "top"}|{day}|{next(SERIAL)}" />'
            f'<input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="ev" />'
            f'<span id="ctl00_ContentPlaceHolder1_lblreport_title">AMS Reporting Status : '
            f'{AMS.date_text(day)}</span>{crumb}<table id="{G}">'
            + "".join(row_html(n, name, r, state is None) for n, (name, r) in enumerate(zip(names, rows)))
            + f'<tr><td><span id="{G}_ctl{ctl}_lblftNamesch">TOTAL</span>{foot}</td></tr></table></form>')


class Page:
    """The form as the server runs it: it answers from the posted view state."""

    def __init__(self, today: dt.date, lose_after: int | None = None, one_state_per_table: bool = False):
        self.today, self.lose_after, self.strict = today, lose_after, one_state_per_table
        self.posts: list[dict] = []
        self.used: set[str] = set()

    def request(self, url: str, data: bytes | None):
        assert url == AMS.PAGE, url
        if self.lose_after is not None:
            if self.lose_after == 0:
                raise AS.RouteLost("route died")
            self.lose_after -= 1
        if data is None:
            return 200, page_html(self.today, None)
        form = dict(urllib.parse.parse_qsl(data.decode(), keep_blank_values=True))
        self.posts.append(form)
        assert "ctl00$ContentPlaceHolder1$btnPdf" not in form, "the download button was sent"
        level = form["__VIEWSTATE"].split("|")[0]
        day = AMS.parse_date(form[AMS.DATE_FIELD])
        target = form["__EVENTTARGET"]
        if target == AMS.SEARCH:
            return 200, page_html(day, None if level == "top" else level)
        if target == AMS.BACK_TO_STATES:
            return 200, page_html(day, None)
        if self.strict and form["__VIEWSTATE"] in self.used:
            return 200, page_html(day, None)      # a spent table answers with itself
        self.used.add(form["__VIEWSTATE"])
        return 200, page_html(day, STATES[int(target.split("$ctl")[1][:2]) - 4])


def store():
    return ST.connect(Path(tempfile.mkdtemp()) / "store.sqlite")


def test_a_table_is_read_as_the_page_shows_it():
    print("\nparsing")
    page = AMS.parse(page_html(YESTERDAY, None))
    check("36 rows on the all-States table", len(page["rows"]) == 36, len(page["rows"]))
    check("the date in the title is read", page["day"] == YESTERDAY)
    check("an ampersand in a name is read as one", page["rows"][34]["name"] == "A & N ISLANDS")
    want = figures("TRIPURA", YESTERDAY)
    got = {k: page["rows"][35][k] for k in want}
    check("every figure of a row is its own", got == want, got)
    check("the TOTAL row agrees with the rows", AMS.disagreements(page) == [])
    check("a TOTAL that differs is reported", AMS.disagreements(AMS.parse(page_html(YESTERDAY, None, True))) != [])
    sub = AMS.parse(page_html(YESTERDAY, "TRIPURA"))
    check("a district table names its State", sub["state"] == "TRIPURA" and len(sub["rows"]) == 3)
    check("a district table has no approved figure", sub["rows"][0]["approved"] is None)
    blank = page_html(YESTERDAY, "TRIPURA").replace(
        f'lblmeal_served_tot">{figures("TRIPURADHALAI", YESTERDAY)["meals"]}<', 'lblmeal_served_tot"><')
    check("a blank cell is None, not 0", AMS.parse(blank)["rows"][0]["meals"] is None)
    for name, body in [("no title", "<html></html>"), ("no rows", page_html(YESTERDAY, None).split("<table")[0])]:
        try:
            AMS.parse(body)
            check(f"an answer with {name} is refused", False)
        except AMS.Unreadable:
            check(f"an answer with {name} is refused", True)


def test_the_flow_asks_as_the_page_does():
    print("\nflow")
    today = YESTERDAY + dt.timedelta(days=1)
    server = Page(today)
    flow = AMS.Flow(server.request)
    top = flow.states(YESTERDAY)
    check("a date is searched from today's table", top["day"] == YESTERDAY and flow.sent == 2)
    one = flow.districts(YESTERDAY, "TRIPURA")
    check("a State opens to its districts", one["state"] == "TRIPURA" and one["rows"][0]["name"] == "DHALAI")
    check("the click names the State's own row", server.posts[-1]["__EVENTTARGET"].endswith("$ctl39$lnkbtn_name"))
    two = flow.districts(YESTERDAY, "STATE 05")
    check("a second State opens from the table already held", two["state"] == "STATE 05" and flow.sent == 4)
    older = flow.districts(YESTERDAY - dt.timedelta(days=3), "STATE 05")
    check("a search on a district table stays on that State",
          older["state"] == "STATE 05" and older["day"] == YESTERDAY - dt.timedelta(days=3) and flow.sent == 5)
    back = flow.states(YESTERDAY - dt.timedelta(days=3))
    check("the all-States table is reached again by the back button",
          back["state"] is None and server.posts[-1]["__EVENTTARGET"] == AMS.BACK_TO_STATES)

    strict = Page(today, one_state_per_table=True)
    flow = AMS.Flow(strict.request)
    flow.districts(YESTERDAY, "TRIPURA")
    page = flow.districts(YESTERDAY, "STATE 05")
    check("a page that opens one State per table is followed by going back up",
          page["state"] == "STATE 05" and not flow.reuse)
    page = flow.districts(YESTERDAY, "STATE 06")
    check("... and the State after it is read too", page["state"] == "STATE 06")

    class Wrong(Page):
        def request(self, url, data):
            status, body = super().request(url, data)
            return status, body.replace(AMS.date_text(YESTERDAY), AMS.date_text(today))
    try:
        AMS.Flow(Wrong(today).request).states(YESTERDAY)
        check("an answer dated another day is refused", False)
    except AMS.Unreadable:
        check("an answer dated another day is refused", True)


def test_a_night_reads_in_order_and_survives_its_routes():
    print("\nnight")
    today = YESTERDAY + dt.timedelta(days=1)
    db = store()
    servers = []

    def new_flow():
        servers.append(Page(today, lose_after=25))
        return AMS.Flow(servers[-1].request)

    row = AS.run(db, new_flow, YESTERDAY, "2026-11-25T02:00:00Z", deadline=float("inf"), cap=120, clock=lambda: 0, say=QUIET)
    check("the night stops at its cap", row["outcome"] == "cap reached" and row["sent"] <= 120, row)
    check("routes that died were replaced", row["routes_lost"] >= 3 and len(servers) >= 4, row["routes_lost"])
    read = ST.ams_read_at(db)
    check("yesterday's all-States table was read", ("", "2026-11-24") in read)
    check("every State's districts were read for yesterday",
          sum(1 for (state, day) in read if state and day == "2026-11-24") == 36)
    oldest = (YESTERDAY - dt.timedelta(days=29)).isoformat()
    check("then the oldest day still offered", ("", oldest) in read)
    got = db.execute("select * from ams_district_day where day='2026-11-24' and state='TRIPURA' and name='GOMATI'").fetchone()
    check("a district row is stored under its own State and day",
          got["meals"] == figures("TRIPURAGOMATI", YESTERDAY)["meals"])

    row = AS.run(db, lambda: AMS.Flow(Page(today).request), YESTERDAY, "2026-11-25T03:00:00Z",
                 deadline=float("inf"), cap=5000, clock=lambda: 0, say=QUIET)
    read = ST.ams_read_at(db)
    days = {day for (state, day) in read if not state}
    check("a night with room reads all 30 days", row["outcome"] == "complete" and len(days) == 30, len(days))
    check("a State that reported nothing has no earlier district table",
          not any(state == "A & N ISLANDS" and day != "2026-11-24" for (state, day) in read))
    before = row["tables"]
    row = AS.run(db, lambda: AMS.Flow(Page(today).request), YESTERDAY, "2026-11-25T04:00:00Z",
                 deadline=float("inf"), cap=5000, clock=lambda: 0, say=QUIET)
    check("a second run the same night re-reads only what is not settled",
          row["tables"] < before / 4, (row["tables"], before))
    check("the night with no route says so",
          AS.run(db, lambda: None, YESTERDAY, "x", deadline=float("inf"), clock=lambda: 0)["outcome"] == "no route")

    asked = []

    def refusing():
        asked.append(1)

        def request(url, data):
            raise AS.Refused("HTTP 403")
        return AMS.Flow(request)
    row = AS.run(store(), refusing, YESTERDAY, "x", deadline=float("inf"), clock=lambda: 0, say=QUIET)
    check("a refusal ends the pass", row["outcome"] == "refused" and row["tables"] == 0 and len(asked) == 1, row)

    seen = []

    def refused_on_one_route():
        n = len(seen)
        seen.append(n)
        page = Page(today)

        def request(url, data):
            if n == 2:
                raise AS.Refused("HTTP 429")
            return page.request(url, data)
        return AMS.Flow(request)
    row = AS.run(store(), refused_on_one_route, YESTERDAY, "x", deadline=float("inf"), clock=lambda: 0,
                 say=QUIET, flows=6)
    check("with six flows, one refusal still ends the pass", row["outcome"] == "refused", row["outcome"])

    def broken():
        raise RuntimeError("a bug in a flow")
    row = AS.run(store(), broken, YESTERDAY, "x", deadline=float("inf"), clock=lambda: 0, say=QUIET, flows=3)
    check("an error in a flow ends the pass and the night is still recorded",
          row["outcome"].startswith("error"), row["outcome"])


def test_flows_side_by_side_read_the_same_night():
    print("\nside by side")
    today = YESTERDAY + dt.timedelta(days=1)
    one, six = store(), store()
    AS.run(one, lambda: AMS.Flow(Page(today).request), YESTERDAY, "2026-11-25T02:00:00Z", deadline=float("inf"),
           cap=5000, clock=lambda: 0, say=QUIET)
    opened = []
    guard = threading.Lock()

    def new_flow():
        with guard:
            opened.append(Page(today, lose_after=40))
        return AMS.Flow(opened[-1].request)

    row = AS.run(six, new_flow, YESTERDAY, "2026-11-25T02:00:00Z", deadline=float("inf"), cap=5000, clock=lambda: 0,
                 say=QUIET, flows=6)
    check("six flows finish the night", row["outcome"] == "complete" and row["routes_lost"] > 0, row)
    check("more than one route was in use at once", len(opened) >= 6, len(opened))
    for name in ("ams_state_day", "ams_district_day"):
        rows = [[tuple(r) for r in db.execute(f"select * from {name} order by 1, 2, 3")] for db in (one, six)]
        check(f"{name} holds what one flow would have read", rows[0] == rows[1] and len(rows[0]) > 100,
              (len(rows[0]), len(rows[1])))
    ledger = [sorted((r["state"], r["day"]) for r in db.execute("select state, day from ams_read")) for db in (one, six)]
    check("the ledger names the same tables", ledger[0] == ledger[1])
    row = AS.run(store(), new_flow, YESTERDAY, "2026-11-25T02:00:00Z", deadline=float("inf"), cap=200, clock=lambda: 0,
                 say=QUIET, flows=6)
    check("six flows stop at the cap, give or take a request each",
          row["outcome"] == "cap reached" and row["sent"] <= 200 + 6, row["sent"])


def test_the_side_copy_is_taken_whole():
    print("\nside copy")
    today = YESTERDAY + dt.timedelta(days=1)
    folder = Path(tempfile.mkdtemp())
    main_db = ST.connect(folder / "store.sqlite")
    AS.run(main_db, lambda: AMS.Flow(Page(today).request), YESTERDAY, "2026-11-25T02:00:00Z", deadline=float("inf"),
           cap=60, clock=lambda: 0, say=QUIET)
    main_db.commit()
    shutil.copy(folder / "store.sqlite", folder / "national.sqlite")
    side = ST.connect(folder / "national.sqlite")
    AS.run(side, lambda: AMS.Flow(Page(today).request), YESTERDAY, "2026-11-25T03:00:00Z", deadline=float("inf"),
           cap=400, clock=lambda: 0, say=QUIET)
    want = {name: [tuple(r) for r in side.execute(f"select * from {name} order by 1, 2, 3")] for name in ST.AMS_TABLES}
    side.close()
    before = main_db.execute("select count(*) from ams_read").fetchone()[0]
    taken = ST.take_ams(main_db, folder / "national.sqlite")
    check("the store takes every table the copy read", taken > before, (before, taken))
    check("all four national tables are the copy's", all(
        [tuple(r) for r in main_db.execute(f"select * from {name} order by 1, 2, 3")] == want[name]
        for name in ST.AMS_TABLES))
    check("both nights are on record", main_db.execute("select count(*) from ams_night").fetchone()[0] == 2)
    empty = folder / "empty.sqlite"
    ST.connect(empty).close()
    try:
        ST.take_ams(main_db, empty)
        check("a copy holding less is refused", False)
    except ValueError:
        check("a copy holding less is refused", True)
    check("and the store is left as it was", main_db.execute("select count(*) from ams_read").fetchone()[0] == taken)


def test_settling():
    print("\nsettling")
    day = dt.date(2026, 11, 20)
    check("a table read the next morning is not settled", not AS.settled(day, "2026-11-21T02:00:00Z"))
    check("a table read three mornings on is", AS.settled(day, "2026-11-23T02:00:00Z"))
    check("the window is 30 days ending yesterday",
          len(AS.window(YESTERDAY)) == 30 and AS.window(YESTERDAY)[-1] == YESTERDAY)


def main() -> int:
    for fn in (test_a_table_is_read_as_the_page_shows_it, test_the_flow_asks_as_the_page_does,
               test_a_night_reads_in_order_and_survives_its_routes,
               test_flows_side_by_side_read_the_same_night, test_the_side_copy_is_taken_whole, test_settling):
        fn()
    print()
    if FAIL:
        print(f"{FAIL} of {PASS + FAIL} checks FAILED")
        return 1
    print(f"all {PASS} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
