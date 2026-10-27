"""What PARIVESH answers to the register search, route by route.

WHY THIS EXISTS
---------------
From 2026-10-24 the nightly sweep read 0 of 10 register sectors and 0 of 38
forest States three nights running, while the appraisal-history endpoint,
through the same proxy pool, kept answering (3,400-4,000 proposals a night, no
errors). The log shows an HTTP 404 from a Spring error page naming
advanceSearchData, connection resets and timeouts, and nothing that says which
of "our routes", "their endpoint" or "our request" is at fault. This sends a
few small requests down many routes and reports what each one answers, next to
a control on the same controller (getListOfSector, the call the proxy refresh
verifies routes with).

    control               getListOfSector: does the route reach the service?
    search                the sweep's own request, smallest sector
    search_plain_headers  the same without Content-Type, Origin and Referer
    search_window         the same with the date window the sweep uses
    search_post           the same as a POST (the per-proposal endpoints are)
    forest                the forest register's request
    search_again          the first search, repeated: does a route's answer
                          stick, or vary from one request to the next?

GITHUB'S RUNNER ONLY. PARIVESH answers addresses in India and this project's
own address is never to be used for it (see net.py), and a diagnostic is
exactly what someone would otherwise try from a laptop. It refuses to start
anywhere else.

Read-only GETs (one POST with an empty body), one request per exit IP every
SPACING seconds - PARIVESH's own per-address allowance - and a few requests a
second in all, against the sweep's two dozen.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import NamedTuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

import net as NET  # noqa: E402
import run_lock  # noqa: E402

API = "https://parivesh.nic.in/parivesh_api/trackYourProposal/"
SEARCH = API + "advanceSearchData"
# The smallest sector, so a success costs the proxy little.
SMALL_SECTOR = 7
SPACING = 11.0
# What of a response is kept: enough to recognise a gateway or an error page.
KEEP_HEADERS = ("server", "via", "content-type", "content-length", "date",
                "retry-after", "x-powered-by", "x-cache", "x-served-by", "location")
BODY_HEAD = 200
BODY_READ = 200_000
PLAIN_HEADERS = {"User-Agent": NET.USER_AGENT, "Accept": "application/json"}


class Probe(NamedTuple):
    name: str
    url: str
    method: str = "GET"
    body: bytes | None = None
    headers: dict | None = None


def plan(today: date) -> list[Probe]:
    small = f"{SEARCH}?majorClearanceType=1&sector={SMALL_SECTOR}"
    window = f"{small}&startDate={today - timedelta(days=30)}&endDate={today + timedelta(days=2)}"
    return [
        Probe("control", API + "getListOfSector"),
        Probe("search", small),
        Probe("search_plain_headers", small, headers=PLAIN_HEADERS),
        Probe("search_window", window),
        Probe("search_post", small, method="POST", body=b"{}"),
        Probe("forest", f"{SEARCH}?majorClearanceType=2&state=7"),
        Probe("search_again", small),
    ]


def require_runner(env) -> None:
    if env.get("GITHUB_ACTIONS") != "true":
        sys.exit("ERROR: this talks to PARIVESH and runs only on GitHub's "
                 "runner. Dispatch the 'Sync Instrument 01 data' workflow with "
                 "diagnose set; never run it from a personal machine.")


def classify(status: int | None, error: str | None) -> str:
    """One label per answer: the HTTP status, or what the transport said."""
    if status is not None:
        return str(status)
    text = (error or "").lower()
    for needle, label in (("timed out", "timeout"), ("reset", "reset"),
                          ("refused", "refused"), ("tunnel", "tunnel"),
                          ("socks", "socks")):
        if needle in text:
            return f"transport:{label}"
    return "transport:other"


def judge_200(body: bytes) -> str:
    """A 200 only counts as the register answering if it is shaped like one."""
    if len(body) >= BODY_READ:
        return "200"
    try:
        payload = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        return "200:not-json"
    if not isinstance(payload, dict):
        return "200:odd"
    if payload.get("status") not in (None, 200) or payload.get("data") is None:
        return "200:odd"
    return "200"


def probe_once(route, probe: Probe, timeout: int) -> dict:
    headers = probe.headers or NET.DEFAULT_HEADERS
    req = urllib.request.Request(probe.url, data=probe.body, method=probe.method,
                                 headers=headers)
    out: dict = {"route": route.host, "probe": probe.name, "status": None,
                 "error": None, "bytes": 0, "headers": {}, "head": ""}
    sent = time.time()
    try:
        with route.opener().open(req, timeout=timeout) as r:
            body = r.read(BODY_READ)
            out.update(status=r.status, headers=r.headers, bytes=len(body))
    except urllib.error.HTTPError as e:
        # A status that arrived through a verified TLS tunnel is the service's.
        body = e.read(2000)
        out.update(status=e.code, headers=e.headers, bytes=len(body))
    except Exception as exc:  # noqa: BLE001 - any transport failure is the answer
        out["error"] = f"{type(exc).__name__}: {exc}"[:160]
        body = b""
    out["seconds"] = round(time.time() - sent, 2)
    headers = out["headers"]
    out["headers"] = {k: headers[k] for k in KEEP_HEADERS if k in headers} if headers else {}
    out["head"] = body[:BODY_HEAD].decode("utf-8", "replace")
    out["label"] = (judge_200(body) if out["status"] == 200
                    else classify(out["status"], out["error"]))
    out["skew_s"] = clock_skew(out["headers"].get("date"), sent)
    return out


def clock_skew(date_header: str | None, sent: float) -> float | None:
    """Seconds the service's clock is ahead of ours. The 404 bodies the sweep
    logged carry a timestamp a constant 31 s behind the runner's."""
    if not date_header:
        return None
    try:
        return round(parsedate_to_datetime(date_header).timestamp() - sent, 1)
    except (TypeError, ValueError):
        return None


def walk(route, probes: list[Probe], timeout: int, spacing: float = SPACING) -> list[dict]:
    """One route's probes, one per `spacing` seconds. A route that cannot even
    answer the control is not asked the rest."""
    results = []
    for probe in probes:
        started = time.time()
        results.append(probe_once(route, probe, timeout))
        if probe.name == "control" and results[-1]["status"] is None:
            break
        time.sleep(max(0.0, spacing - (time.time() - started)))
    return results


def summarise(results: list[dict]) -> dict:
    """Per probe: how many answers of each kind, and how long they took."""
    by_probe: dict = defaultdict(list)
    for r in results:
        by_probe[r["probe"]].append(r)
    summary = {}
    for name, rows in by_probe.items():
        seconds = [r["seconds"] for r in rows if r["status"] is not None]
        summary[name] = {
            "n": len(rows),
            "outcomes": dict(Counter(r["label"] for r in rows).most_common()),
            "median_s": round(statistics.median(seconds), 1) if seconds else None,
        }
    return summary


def stickiness(results: list[dict]) -> dict:
    """Of the routes asked the search twice, how many answered the same way."""
    first = {r["route"]: r["label"] for r in results if r["probe"] == "search"}
    again = {r["route"]: r["label"] for r in results if r["probe"] == "search_again"}
    both = [k for k in first if k in again]
    return {"routes": len(both),
            "same": sum(first[k] == again[k] for k in both),
            "first_ok_then_not": sum(first[k] == "200" and again[k] != "200" for k in both),
            "first_not_then_ok": sum(first[k] != "200" and again[k] == "200" for k in both)}


def distinct_exits(proxies: list[str], limit: int) -> list:
    """Routes with one exit IP each: PARIVESH's allowance is per address."""
    seen, routes = set(), []
    for proxy in proxies:
        route = NET.Route(proxy)
        if route.host in seen:
            continue
        seen.add(route.host)
        routes.append(route)
        if len(routes) == limit:
            break
    return routes


def report(results: list[dict]) -> None:
    for name, s in summarise(results).items():
        print(f"  {name:22} n={s['n']:3}  median {s['median_s']}s  {s['outcomes']}")
    print(f"  stickiness {stickiness(results)}")
    skews = [r["skew_s"] for r in results if r["skew_s"] is not None]
    if skews:
        print(f"  service clock minus ours: median {statistics.median(skews)}s "
              f"(min {min(skews)}, max {max(skews)}, {len(skews)} answers)")
    # One sample of each distinct (probe, label), with what the service sent.
    shown = set()
    for r in results:
        key = (r["probe"], r["label"])
        if key in shown:
            continue
        shown.add(key)
        print(f"  sample {r['probe']}/{r['label']} via {r['route']} in {r['seconds']}s "
              f"{r['bytes']}B headers={r['headers']} head={r['head'][:BODY_HEAD]!r}"
              f"{' error=' + r['error'] if r['error'] else ''}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--routes", type=int, default=60, help="exit IPs to try")
    ap.add_argument("--waves", type=int, default=2, help="rounds over the same routes")
    ap.add_argument("--wave-gap-minutes", type=float, default=15)
    ap.add_argument("--workers", type=int, default=24)
    ap.add_argument("--timeout", type=int, default=45)
    ap.add_argument("--out", default="", help="write every answer here as JSON")
    args = ap.parse_args()
    require_runner(os.environ)
    run_lock.hold_or_exit("diagnose_register")

    routes = distinct_exits(NET.load_proxies(), args.routes)
    if not routes:
        sys.exit("ERROR: no proxy pool to test (INSTRUMENTS_PROXIES / the cache's proxies.txt)")
    print(f"diagnose: {len(routes)} exit IPs, {args.waves} wave(s)", flush=True)

    everything: list[dict] = []
    for wave in range(1, args.waves + 1):
        probes = plan(date.today())
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            rows = [r for walked in ex.map(lambda rt: walk(rt, probes, args.timeout), routes)
                    for r in walked]
        for r in rows:
            r["wave"] = wave
        everything += rows
        print(f"\n=== wave {wave} at {time.strftime('%H:%M:%S', time.gmtime())} UTC ===")
        report(rows)
        sys.stdout.flush()
        if wave < args.waves:
            time.sleep(args.wave_gap_minutes * 60)

    if args.out:
        Path(args.out).write_text(json.dumps(everything, indent=1), encoding="utf-8")
    reached = sum(1 for r in everything if r["probe"] == "control" and r["status"] == 200)
    if not reached:
        print("\nNo route reached the service at all: the pool, not the endpoint, is what failed.")
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
