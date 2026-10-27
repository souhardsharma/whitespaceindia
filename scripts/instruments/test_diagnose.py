"""Tests for the register diagnostic.

WHY THIS EXISTS
---------------
diagnose_register.py is the one tool that talks to PARIVESH on purpose to find
out why the sweep fails, so two things about it are pinned: it will not run
from a personal machine, and its summary says what the service answered rather
than what we hoped. Offline, no network.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import diagnose_register as DG  # noqa: E402

PASS = FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def row(route: str, probe: str, label: str, status: int | None = None,
        seconds: float = 1.0, skew: float | None = None) -> dict:
    return {"route": route, "probe": probe, "label": label, "status": status,
            "seconds": seconds, "skew_s": skew}


def test_it_refuses_to_run_off_the_runner() -> None:
    print("\nit runs only on GitHub's runner")
    for env in ({}, {"GITHUB_ACTIONS": ""}, {"GITHUB_ACTIONS": "false"}):
        try:
            DG.require_runner(env)
            refused = False
        except SystemExit as exc:
            refused = "never run it from a personal machine" in str(exc)
        check(f"refused with {env or 'no environment'}", refused)
    try:
        DG.require_runner({"GITHUB_ACTIONS": "true"})
        allowed = True
    except SystemExit:
        allowed = False
    check("allowed on the runner", allowed)


def test_answers_are_labelled_by_what_came_back() -> None:
    print("\neach answer carries one label")
    check("a status is its own label", DG.classify(404, None) == "404")
    check("a timeout", DG.classify(None, "TimeoutError: <urlopen error timed out>") == "transport:timeout")
    check("a reset", DG.classify(None, "<urlopen error [Errno 104] Connection reset by peer>") == "transport:reset")
    check("a refusal", DG.classify(None, "[Errno 111] Connection refused") == "transport:refused")
    check("a proxy that would not tunnel",
          DG.classify(None, "Tunnel connection failed: 500 Internal Server Error") == "transport:tunnel")
    check("anything else", DG.classify(None, "boom") == "transport:other")
    ok = b'{"status":200,"data":[{"id":1}]}'
    check("a register-shaped 200", DG.judge_200(ok) == "200")
    check("a 200 with no data is not the register answering",
          DG.judge_200(b'{"status":200,"data":null}') == "200:odd")
    check("a 200 carrying another status is not either",
          DG.judge_200(b'{"status":500,"data":[]}') == "200:odd")
    check("a 200 that is not JSON", DG.judge_200(b"<html>") == "200:not-json")
    check("a body cut at the read limit is trusted as the register",
          DG.judge_200(b"x" * DG.BODY_READ) == "200")


def test_the_summary_counts_outcomes_per_probe() -> None:
    print("\nthe summary says what each probe drew")
    rows = [row("a", "control", "200", 200, 1.0), row("b", "control", "200", 200, 3.0),
            row("c", "control", "transport:timeout"),
            row("a", "search", "404", 404, 2.0), row("b", "search", "404", 404, 4.0),
            row("c", "search", "200", 200, 6.0)]
    s = DG.summarise(rows)
    check("control: two answered, one timed out",
          s["control"]["outcomes"] == {"200": 2, "transport:timeout": 1}, str(s["control"]))
    check("search: the 404s are counted, not folded into failures",
          s["search"]["outcomes"] == {"404": 2, "200": 1}, str(s["search"]))
    check("the median ignores a request that never got an answer",
          s["control"]["median_s"] == 2.0, str(s["control"]))


def test_stickiness_tells_a_bad_route_from_a_flapping_service() -> None:
    print("\nstickiness: does a route's answer stay the same")
    rows = [row("a", "search", "404"), row("a", "search_again", "404"),
            row("b", "search", "200"), row("b", "search_again", "404"),
            row("c", "search", "404"), row("c", "search_again", "200"),
            row("d", "search", "200")]
    s = DG.stickiness(rows)
    check("only routes asked twice are compared", s["routes"] == 3, str(s))
    check("one route answered the same both times", s["same"] == 1, str(s))
    check("one went from answering to not", s["first_ok_then_not"] == 1, str(s))
    check("one went from not answering to answering", s["first_not_then_ok"] == 1, str(s))


def test_one_exit_ip_is_one_route() -> None:
    print("\nPARIVESH counts addresses, so does the diagnostic")
    routes = DG.distinct_exits(["1.1.1.1:80", "1.1.1.1:8080", "2.2.2.2:80", "socks5://3.3.3.3:1080"], 10)
    check("ports on one address are one route", [r.host for r in routes] == ["1.1.1.1", "2.2.2.2", "3.3.3.3"],
          str([r.host for r in routes]))
    check("the limit applies", len(DG.distinct_exits(["1.1.1.1:80", "2.2.2.2:80"], 1)) == 1)


def test_the_plan_asks_the_sweeps_own_questions() -> None:
    print("\nthe plan covers the sweep's request and a control")
    from datetime import date
    names = [p.name for p in DG.plan(date(2026, 10, 27))]
    check("starts with the control, so a dead route is dropped early", names[0] == "control", str(names))
    check("repeats the search at the end", names[-1] == "search_again", str(names))
    window = next(p for p in DG.plan(date(2026, 10, 27)) if p.name == "search_window")
    check("the window runs to two days past today, as the sweep's last window does",
          "endDate=2026-10-29" in window.url and "startDate=2026-09-27" in window.url, window.url)


def test_the_portal_pages_are_read_for_the_searchs_call_sites() -> None:
    print("\nthe portal's own scripts show where the search now lives")
    html = ('<html><script src="main.abc.js"></script><script src="/static/x.js"></script>'
            "<script src='https://cdn.example/y.js'></script><script>inline()</script>"
            '<script src="main.abc.js"></script></html>')
    check("scripts resolve against the page, once each, in page order",
          DG.script_sources(html, "https://parivesh.nic.in/") == [
              "https://parivesh.nic.in/main.abc.js",
              "https://parivesh.nic.in/static/x.js",
              "https://cdn.example/y.js"],
          str(DG.script_sources(html, "https://parivesh.nic.in/")))
    js = ('a.get(`${b}trackYourProposal/getListOfSector`);'
          'a.get(`${b}trackYourProposal/v2/advanceSearchData?x=1`);'
          'a.post(`${b}trackYourProposal/getProcessHis`);')
    sites = DG.call_sites(js)
    check("a mention is reported with the text around it",
          sites["mentions"] == 1 and "v2/advanceSearchData" in sites["contexts"][0], str(sites))
    check("every sibling route is listed, with the whole path it was called by", sites["routes"] == [
        "trackYourProposal/getListOfSector", "trackYourProposal/getProcessHis",
        "trackYourProposal/v2/advanceSearchData"], str(sites["routes"]))
    check("a script that never mentions it reports none",
          DG.call_sites("var a = 1;")["mentions"] == 0)
    moved = DG.call_sites('a.get(`${b}trackYourProposal/V1/proposalList?x=1`);'
                          'a.get(`${b}trackYourProposal/getListOfSector`);')
    check("with the search unnamed, a sibling's call site is shown and a known one is not",
          moved["mentions"] == 0 and len(moved["track_contexts"]) == 1
          and "V1/proposalList" in moved["track_contexts"][0], str(moved))
    app = ('r={IMAGE_URL:"https://parivesh.nic.in/",API_BASE_URL:`https://parivesh.nic.in/newapi/`};'
           'a.post(`${API_BASE_URL}proposal/v3/advancedSearch?x=1`);'
           'a.get("assests/img/proposal-icon/a");import x from "react/jsx-runtime";'
           'a.get("master/getListOfState");')
    sites = DG.call_sites(app)
    check("where an application says its API lives is reported",
          sites["bases"] == ["API_BASE_URL=https://parivesh.nic.in/newapi/",
                             "IMAGE_URL=https://parivesh.nic.in/"], str(sites["bases"]))
    check("a path about proposals or search is reported whatever its prefix; assets and "
          "unrelated paths are not",
          sites["api_paths"] == ["proposal/v3/advancedSearch"], str(sites["api_paths"]))


def test_lazy_chunks_are_followed_and_a_moved_search_is_found() -> None:
    print("\nlazy chunks are named, and routes that say search are candidates")
    esbuild = 'import("./chunk-AB12CD.js");import("chunk-x_9.js");load("not-a-chunk.js")'
    check("esbuild chunks resolve against the script that names them",
          DG.chunk_sources(esbuild, "https://parivesh.nic.in/static/main.js") == [
              "https://parivesh.nic.in/static/chunk-AB12CD.js",
              "https://parivesh.nic.in/static/chunk-x_9.js"],
          str(DG.chunk_sources(esbuild, "https://parivesh.nic.in/static/main.js")))
    webpack = '{12:"0123456789abcdef",foo:"fedcba9876543210",7:"short"}'
    check("webpack id-to-hash maps give <id>.<hash>.js, and a short value is not a hash",
          DG.chunk_sources(webpack, "https://parivesh.nic.in/") == [
              "https://parivesh.nic.in/12.0123456789abcdef.js",
              "https://parivesh.nic.in/foo.fedcba9876543210.js"],
          str(DG.chunk_sources(webpack, "https://parivesh.nic.in/")))
    cra = '{3:"a1b2c3d4",51:"0f1e2d3c",x:"zzzzzzzz"}'
    check("a create-react-app script names 8-character chunks under static/js",
          DG.chunk_sources(cra, "https://parivesh.nic.in/static/js/main.ff788027.js") == [
              "https://parivesh.nic.in/static/js/3.a1b2c3d4.chunk.js",
              "https://parivesh.nic.in/static/js/51.0f1e2d3c.chunk.js"],
          str(DG.chunk_sources(cra, "https://parivesh.nic.in/static/js/main.ff788027.js")))
    js = ('a.get("trackYourProposal/v2/advanceSearchData");'
          'a.get("trackYourProposal/v2/proposalSearch");'
          'a.get("trackYourProposal/V1/proposalList");'
          'a.get("trackYourProposal/getListOfSector");'
          'a.get("parivesh_api/master/searchState");')
    found = {"bundles": {"u": DG.call_sites(js)}}
    check("the route the sweep calls and the known siblings are not candidates; the other "
          "siblings and the search-named routes are, from the API root",
          DG.search_candidates(found) == [
              "master/searchState", "trackYourProposal/V1/proposalList",
              "trackYourProposal/v2/proposalSearch"],
          str(DG.search_candidates(found)))


def test_a_base_url_off_the_portal_is_followed_to_where_it_is_used() -> None:
    print("\na base URL on another host is shown where the application uses it")
    js = ('r={BASE_URL:"https://parivesh.nic.in",NEW_BASE_URL:"https://cpc.parivesh.nic.in",IMAGE_URL:"assests/"};'
          'a.get(`${r.BASE_URL}trackYourProposal/getListOfSector`);'
          'a.post(`${r.NEW_BASE_URL}api/v1/proposalList`,b);')
    uses = DG.call_sites(js)["base_uses"]
    check("the use is shown with its path; the definition is not a second use",
          len(uses) == 1 and "r.NEW_BASE_URL}api/v1/proposalList" in uses[0], str(uses))
    own = DG.call_sites('r={BASE_URL:"https://parivesh.nic.in"};a.get(`${r.BASE_URL}x/y`);')
    check("the portal's own host is not a foreign base", own["base_uses"] == [], str(own["base_uses"]))
    check("a script with no base reports none", DG.call_sites("var a = 1;")["base_uses"] == [])


class FakeRoute:
    def __init__(self, host: str) -> None:
        self.host = host


def test_a_script_no_route_delivered_is_retried_and_then_reported() -> None:
    print("\na script that failed is asked again, and one that never arrives is reported, not counted as read")
    calls: dict[str, int] = {}
    body = b"a.get(`${b}trackYourProposal/V1/proposalList`);"
    flaky, dead = DG.FRONT + "flaky.js", DG.FRONT + "dead.js"

    def fake_fetch(routes, url, timeout, limit, good=None):
        calls[url] = calls.get(url, 0) + 1
        if url == DG.FRONT:
            return b'<script src="flaky.js"></script><script src="dead.js"></script>', "200 via x"
        if url in DG.FRONTS:
            return b"<html></html>", "200 via x"
        if url == flaky and calls[url] < DG.READ_TRIES:
            return None, "URLError via x"
        if url == dead:
            return None, "URLError via x"
        return body, "200 via x"

    real_fetch, real_pause = DG.fetch_page, DG.BATCH_PAUSE_S
    DG.fetch_page, DG.BATCH_PAUSE_S = fake_fetch, 0.0
    try:
        found = DG.discover([FakeRoute("a"), FakeRoute("b"), FakeRoute("c")], 1, budget_s=60)
    finally:
        DG.fetch_page, DG.BATCH_PAUSE_S = real_fetch, real_pause
    check("a script that arrives on a later try is read",
          found["bundles"][flaky]["bytes"] == len(body) and calls[flaky] == DG.READ_TRIES, str(calls))
    check("a script that never arrives is tried READ_TRIES times and listed as failed",
          calls[dead] == DG.READ_TRIES and found["failed"] == [dead], f"{calls} {found.get('failed')}")
    check("what was read is not reported as unread", found["unread"] == 0, str(found.get("unread")))


def main() -> int:
    for fn in (test_it_refuses_to_run_off_the_runner,
               test_answers_are_labelled_by_what_came_back,
               test_the_summary_counts_outcomes_per_probe,
               test_stickiness_tells_a_bad_route_from_a_flapping_service,
               test_one_exit_ip_is_one_route,
               test_the_plan_asks_the_sweeps_own_questions,
               test_the_portal_pages_are_read_for_the_searchs_call_sites,
               test_lazy_chunks_are_followed_and_a_moved_search_is_found,
               test_a_base_url_off_the_portal_is_followed_to_where_it_is_used,
               test_a_script_no_route_delivered_is_retried_and_then_reported):
        fn()
    print()
    if FAIL:
        print(f"{FAIL} of {PASS + FAIL} checks FAILED")
        return 1
    print(f"all {PASS} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
