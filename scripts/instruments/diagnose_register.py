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

With --discover it also reads the portal's own page and scripts and reports
how the application itself now calls the search: a 404 that names the path is
what a moved route looks like.

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
import re
import statistics
import sys
import time
import urllib.error
import urllib.parse
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

PARIVESH_API = "https://parivesh.nic.in/parivesh_api/"
API = PARIVESH_API + "trackYourProposal/"
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


FRONT = "https://parivesh.nic.in/"
# The front page links its Track Your Proposal tile out to /newupgrade/#/trackYourProposal/V1:
# a second single-page application, and the one whose scripts name the search now.
# The portal's own script also carries NEW_BASE_URL=https://cpc.parivesh.nic.in.
FRONTS = (FRONT, FRONT + "newupgrade/", "https://cpc.parivesh.nic.in/")
NEEDLE = "advanceSearchData"
BUNDLE_LIMIT = 8
BUNDLE_BYTES = 8_000_000
MAX_FILES = 120
# Free proxies drop about half of what they are asked, and the two scripts that
# matter most (an application's runtime and main) are the large ones, so a file
# is asked for on READ_TRIES passes, each on READ_ROUTES routes of its own.
READ_TRIES = 3
READ_ROUTES = 4
BATCH_PAUSE_S = 4.0
DISCOVER_BUDGET_S = 1200
CANDIDATE_LIMIT = 60
CONTEXT = 110
# A lazily loaded chunk is named in the script that loads it, either as a file
# (esbuild: chunk-<hash>.js) or as an id -> content-hash map (webpack:
# <id>.<hash>.js; create-react-app: static/js/<id>.<hash>.chunk.js, with an
# 8-character hash - the portal's own main.<hash>.js is that kind).
ESBUILD_CHUNK = re.compile(r"""["'](?:\./)?(chunk-[\w-]+\.js)["']""")
WEBPACK_CHUNK = re.compile(r"""(?<![\w.])(\d+|[A-Za-z_][\w-]*)\s*:\s*["']([0-9a-f]{8,20})["']""")
SEARCH_ROUTE = re.compile(r"(?<![\w.])(?:[A-Za-z]\w*/)+\w*[Ss]earch\w*")
TRACK_ROUTE = re.compile(r"trackYourProposal/\w+(?:/\w+)*")
# Where an application says its API lives: FOO_URL: "https://..." / BASE_URL = `...`.
BASE_URL = re.compile(r"""\b([A-Z][A-Z0-9_]*URL[A-Z0-9_]*)\s*[:=]\s*[`"']([^`"'\s]{4,120})[`"']""")
# Any key bound to an absolute URL on a government host, in whatever case the application
# spells it: an Angular environment has frontendURL / apiUrl, not API_URL.
HOST_URL = re.compile(r"""\b([A-Za-z_$][\w$]*)\s*[:=]\s*[`"'](https?://[^`"'\s]{4,120})[`"']""")
HOST_SUFFIXES = (".nic.in", ".gov.in")
HOST_LIMIT = 150
# Links and documents are not where an application sends its calls.
NOT_A_BASE_KEY = ("href", "src", "hindiLink")
NOT_A_BASE_FILE = re.compile(r"\.(pdf|aspx?|docx?|xlsx?|png|jpe?g|gif|svg|css|js)$", re.I)
# A script that lazily loads the Track Your Proposal route names the chunks it needs.
LAZY_ROUTE = re.compile(r"loadChildren(?!\w)")
LAZY_BEFORE, LAZY_AFTER = 120, 420
CHUNK_ID = re.compile(r"""\.e\(["']?([\w-]+)["']?\)""")
# How a webpack runtime turns a chunk id into a file name: `<runtime>.u=e=>...`.
CHUNK_NAMER = re.compile(r"\.u\s*=")
RUNTIME_SHOWN = 1800
# The text around these, and how much of it, shows how an application joins a base to a route.
WIDE_CONTEXTS = (("TRACK_YOUR_PROPOSAL_ADVANCE_DATA", 220, 300), ("frontendURL", 80, 600))
WIDE_LIMIT = 4
# A relative path inside a string that is about proposals or searching, whatever its prefix.
API_PATH = re.compile(r"""["'`](?:\$\{[^}]{1,30}\})?/?((?:[A-Za-z][\w-]*/){1,5}[A-Za-z][\w-]*)(?=[?"'`])""")
API_WORDS = ("proposal", "search", "track")
API_PATH_LIMIT = 40
# Siblings of the search that are known and not worth asking again.
KNOWN_TRACK = ("trackYourProposal/getListOf", "trackYourProposal/getProcessHis")


def script_sources(html: str, base: str = FRONT) -> list[str]:
    """Absolute URLs of the page's scripts, in page order, without repeats."""
    seen: dict[str, None] = {}
    for src in re.findall(r"""<script[^>]+\bsrc=["']([^"']+)["']""", html, re.I):
        seen[urllib.parse.urljoin(base, src)] = None
    return list(seen)


def webpack_chunks(js: str, base: str) -> list[tuple[str, str]]:
    """(chunk id, absolute URL) for each id -> content-hash pair a script holds."""
    suffix = ".chunk.js" if "/static/js/" in base else ".js"
    return [(ident, urllib.parse.urljoin(base, f"{ident}.{digest}{suffix}"))
            for ident, digest in sorted(set(WEBPACK_CHUNK.findall(js)))]


def chunk_sources(js: str, base: str) -> list[str]:
    """Absolute URLs of the lazy chunks a script names."""
    urls = {urllib.parse.urljoin(base, name) for name in ESBUILD_CHUNK.findall(js)}
    urls.update(url for _, url in webpack_chunks(js, base))
    return sorted(urls)


def chunk_namer(js: str) -> str:
    """The text where a webpack runtime builds a chunk's file name - what to read
    when no id -> hash pair was found in a script that should have them."""
    m = CHUNK_NAMER.search(js)
    start = max(0, m.start() - 60) if m else 0
    return js[start: start + RUNTIME_SHOWN]


def base_uses(js: str, limit: int) -> list[str]:
    """The text around each use of a base URL that names a host other than the
    portal's own - where an application sends its calls to a second service."""
    uses: list[str] = []
    for name, value in sorted(set(BASE_URL.findall(js))):
        host = urllib.parse.urlsplit(value).hostname
        if host in (None, "parivesh.nic.in"):
            continue
        # A use is an occurrence that is not the definition (NAME: "https://...").
        for m in re.finditer(r"(?<![\w$])" + re.escape(name) + r"""(?!\s*[:=]\s*[`"'])""", js):
            uses.append(f"{name}: {js[max(0, m.start() - CONTEXT): m.end() + CONTEXT]}")
            if len(uses) >= limit:
                return uses
    return uses


def government_hosts(js: str) -> list[str]:
    """Every key the script binds to an absolute URL on a government host, other
    than links and documents."""
    found = {f"{k}={v}" for k, v in HOST_URL.findall(js)
             if k not in NOT_A_BASE_KEY and not NOT_A_BASE_FILE.search(v)
             and (urllib.parse.urlsplit(v).hostname or "").endswith(HOST_SUFFIXES)}
    return sorted(found)[:HOST_LIMIT]


def lazy_track(js: str) -> dict:
    """The routes this script loads lazily that are about Track Your Proposal: the
    text around each, and the chunk ids it names - the chunks that hold the call."""
    texts: list[str] = []
    ids: set[str] = set()
    starts = [m.start() for m in LAZY_ROUTE.finditer(js)]
    for i, start in enumerate(starts):
        # A route's chunks follow its loadChildren, up to the next route's.
        end = start + len("loadChildren") + LAZY_AFTER
        if i + 1 < len(starts):
            end = min(end, starts[i + 1])
        # ...and its own path is the last one before it, not the previous route's.
        head = js[max(0, start - LAZY_BEFORE): start]
        text = head[max(head.rfind("path:"), 0):] + js[start: end]
        if "rack" in text and text not in texts:
            texts.append(text)
            ids.update(CHUNK_ID.findall(text))
    return {"texts": texts[:WIDE_LIMIT], "ids": sorted(ids)}


def wide_contexts(js: str) -> dict[str, list[str]]:
    """For each WIDE_CONTEXTS needle the script contains, the text around its first uses."""
    out: dict[str, list[str]] = {}
    for needle, before, after in WIDE_CONTEXTS:
        texts: list[str] = []
        for m in re.finditer(re.escape(needle), js):
            text = js[max(0, m.start() - before): m.end() + after]
            if text not in texts:
                texts.append(text)
            if len(texts) == WIDE_LIMIT:
                break
        if texts:
            out[needle] = texts
    return out


def call_sites(js: str, limit: int = 6) -> dict:
    """How a script refers to the search: the text around each mention, every
    trackYourProposal/<name> route it knows (the search's siblings, to see
    whether they are still where they were) and every other route whose name
    says search, in case it moved."""
    contexts = []
    for m in re.finditer(NEEDLE, js):
        text = js[max(0, m.start() - CONTEXT): m.end() + CONTEXT]
        if text not in contexts:
            contexts.append(text)
        if len(contexts) == limit:
            break
    # The siblings' own call sites, when the search is no longer named: how the
    # application builds a trackYourProposal URL shows where the search went.
    track_contexts = []
    for m in TRACK_ROUTE.finditer(js):
        if m.group().startswith(KNOWN_TRACK):
            continue
        text = js[max(0, m.start() - CONTEXT): m.end() + CONTEXT]
        if text not in track_contexts:
            track_contexts.append(text)
        if len(track_contexts) == limit:
            break
    api_paths = sorted({m.group(1) for m in API_PATH.finditer(js)
                        if any(w in m.group(1).lower() for w in API_WORDS)
                        and not m.group(1).startswith(("static/", "assests/", "assets/"))})
    return {"mentions": js.count(NEEDLE), "contexts": contexts,
            "track_contexts": track_contexts,
            "bases": sorted({f"{k}={v}" for k, v in BASE_URL.findall(js)}),
            "base_uses": base_uses(js, limit),
            "hosts": government_hosts(js),
            "wide": wide_contexts(js),
            "lazy": lazy_track(js),
            "api_paths": api_paths[:API_PATH_LIMIT],
            "routes": sorted(set(TRACK_ROUTE.findall(js))),
            "search_routes": sorted(set(SEARCH_ROUTE.findall(js)))}


def fetch_page(routes: list, url: str, timeout: int, limit: int,
               good: list | None = None) -> tuple[bytes | None, str]:
    """The first of `routes` that returns `url` with a 200, and what each said.
    A route that delivers is added to `good`, for the next file to try first."""
    said = []
    for route in routes:
        req = urllib.request.Request(url, headers=NET.DEFAULT_HEADERS)
        try:
            with route.opener().open(req, timeout=timeout) as r:
                body = r.read(limit)
                if r.status == 200:
                    if good is not None and route not in good:
                        good.append(route)
                    return body, f"200 via {route.host}"
                said.append(f"{r.status} via {route.host}")
        except urllib.error.HTTPError as e:
            said.append(f"{e.code} via {route.host}")
        except Exception as exc:  # noqa: BLE001 - any transport failure is the answer
            said.append(f"{type(exc).__name__}: {str(exc)[:70]} via {route.host}")
        time.sleep(1.0)
    return None, "; ".join(said)


def discover(routes: list, timeout: int, budget_s: float = DISCOVER_BUDGET_S,
             chunks: str = "all") -> dict:
    """Read the portal's page, its scripts and the lazy chunks they name, for the
    search's call sites and every route the application knows. `chunks` is "all"
    (every chunk named), "track" (only those the Track Your Proposal route loads)
    or "none"."""
    deadline = time.time() + budget_s
    found: dict = {"page": None, "pages": {}, "bundles": {}}
    queue: list[str] = []
    for front in FRONTS:
        html, said = fetch_page(routes[:6], front, timeout, BUNDLE_BYTES)
        found["pages"][front] = said
        if html is not None:
            queue += script_sources(html.decode("utf-8", "replace"), front)[:BUNDLE_LIMIT]
    found["page"] = found["pages"][FRONT]
    if not queue:
        return found
    queue = list(dict.fromkeys(queue))
    found["scripts"] = list(queue)
    seen = set(queue)
    turn = 6
    tries: dict[str, int] = {}
    good: list = []
    wanted: set[str] = set()
    named: list[tuple[str, str]] = []

    def next_chunks(js: str, url: str, lazy_ids: list[str]) -> list[str]:
        if chunks == "all":
            return chunk_sources(js, url)
        if chunks == "none":
            return []
        # The ids are in one script and the id -> file map in another, in either order.
        wanted.update(lazy_ids)
        named.extend(webpack_chunks(js, url))
        return [chunk for ident, chunk in named if ident in wanted]

    def read(url: str, start: int):
        # One route that has already delivered a file, if there is one, then
        # routes from a different place in the pool for each file, so an exit
        # IP is asked about once per pass.
        picks = good[(start // READ_ROUTES) % len(good):][:1] if good else []
        picks += [routes[(start + k) % len(routes)] for k in range(READ_ROUTES)]
        return url, fetch_page(picks, url, timeout, BUNDLE_BYTES, good)

    with ThreadPoolExecutor(max_workers=8) as ex:
        while queue and time.time() < deadline and len(found["bundles"]) < MAX_FILES:
            batch, queue = queue[:8], queue[8:]
            jobs = [(url, turn + READ_ROUTES * i) for i, url in enumerate(batch)]
            turn += READ_ROUTES * len(batch)
            for url, (body, said) in ex.map(lambda job: read(*job), jobs):
                tries[url] = tries.get(url, 0) + 1
                if body is None and tries[url] < READ_TRIES:
                    queue.append(url)
                    continue
                entry: dict = {"fetched": said, "bytes": len(body) if body else 0}
                if body:
                    js = body.decode("utf-8", "replace")
                    entry.update(call_sites(js))
                    if "runtime" in url.rsplit("/", 1)[-1]:
                        entry["chunk_namer"] = chunk_namer(js)
                    for chunk in next_chunks(js, url, entry["lazy"]["ids"]):
                        if chunk not in seen:
                            seen.add(chunk)
                            queue.append(chunk)
                found["bundles"][url] = entry
            time.sleep(BATCH_PAUSE_S)
    found["unread"] = len(queue)
    found["failed"] = [url for url, entry in found["bundles"].items() if not entry["bytes"]]
    return found


def other_hosts(found: dict) -> list[str]:
    """PARIVESH hosts other than the portal's own that a script binds to a URL."""
    hosts: set[str] = set()
    for entry in found["bundles"].values():
        for pair in entry.get("hosts", []):
            host = urllib.parse.urlsplit(pair.partition("=")[2]).hostname or ""
            if host.endswith(".parivesh.nic.in"):
                hosts.add(host)
    return sorted(hosts)


def service_bases(found: dict) -> list[str]:
    """The service bases a script names other than the one the sweep calls: a
    directory URL on a government host, with no fragment, query or port."""
    bases: set[str] = set()
    for entry in found["bundles"].values():
        for pair in entry.get("hosts", []):
            parts = urllib.parse.urlsplit(pair.partition("=")[2])
            if (parts.fragment or parts.query or parts.port or not parts.path.endswith("/")
                    or parts.path == "/"):
                continue
            if parts.geturl() != PARIVESH_API:
                bases.add(parts.geturl())
    return sorted(bases)


def search_candidates(found: dict) -> list[str]:
    """What to ask: the search on every other service base a script names, the
    search and its control on every other PARIVESH host, then the routes the
    application knows whose name says search and the search's siblings (the
    track routes first), other than the one the sweep calls, which answers 404."""
    names: set[str] = set()
    for entry in found["bundles"].values():
        names.update(n.removeprefix("parivesh_api/") for n in entry.get("search_routes", []))
        names.update(n for n in entry.get("routes", []) if not n.startswith(KNOWN_TRACK))
    routes = sorted((n for n in names if "/" in n and not n.endswith("/" + NEEDLE)),
                    key=lambda n: (not n.startswith("trackYourProposal/"), n))
    elsewhere = [f"https://{host}/parivesh_api/trackYourProposal/{leaf}"
                 for host in other_hosts(found) for leaf in ("getListOfSector", NEEDLE)]
    services = [f"{base}trackYourProposal/{NEEDLE}" for base in service_bases(found)]
    return (services + elsewhere + routes)[:CANDIDATE_LIMIT]


def probe_candidates(routes: list, candidates: list[str], timeout: int) -> list[dict]:
    """Each candidate asked the sweep's smallest question on two routes."""
    query = f"?majorClearanceType=1&sector={SMALL_SECTOR}"

    def ask(item):
        i, name = item
        url = name + query if name.startswith("https://") else PARIVESH_API + name + query
        probe = Probe("candidate:" + name, url, headers=PLAIN_HEADERS)
        return [probe_once(routes[(2 * i + k) % len(routes)], probe, timeout) for k in range(2)]

    with ThreadPoolExecutor(max_workers=6) as ex:
        return [row for rows in ex.map(ask, enumerate(candidates)) for row in rows]


def report_discovery(found: dict, candidates: list[dict]) -> None:
    for front, said in found.get("pages", {FRONT: found["page"]}).items():
        print(f"\n=== portal page {front}: {said} ===")
    for url, entry in found["bundles"].items():
        print(f"  {url}: {entry['fetched']}, {entry['bytes']:,} B, "
              f"{entry.get('mentions', 0)} mention(s) of {NEEDLE}")
        for text in entry.get("contexts", []):
            print(f"      ...{text!r}...")
        for text in entry.get("track_contexts", []):
            print(f"      track ...{text!r}...")
        if entry.get("bases"):
            print(f"      base urls: {entry['bases']}")
        for text in entry.get("base_uses", []):
            print(f"      base use ...{text!r}...")
        if entry.get("hosts"):
            print(f"      urls on government hosts: {entry['hosts']}")
        for needle, texts in entry.get("wide", {}).items():
            for text in texts:
                print(f"      {needle} ...{text!r}...")
        lazy = entry.get("lazy", {})
        if lazy.get("ids"):
            print(f"      chunks the Track Your Proposal route loads: {lazy['ids']}")
        for text in lazy.get("texts", []):
            print(f"      lazy route ...{text!r}...")
        if entry.get("chunk_namer"):
            print(f"      chunk namer ...{entry['chunk_namer']!r}...")
        if entry.get("api_paths"):
            print(f"      paths about proposals or search: {entry['api_paths']}")
        if entry.get("routes"):
            print(f"      trackYourProposal routes: {entry['routes']}")
        if entry.get("search_routes"):
            print(f"      routes that say search: {entry['search_routes']}")
    failed = found.get("failed", [])
    print(f"  {len(found['bundles']) - len(failed)} file(s) read, {len(failed)} never delivered, "
          f"{found.get('unread', 0)} not reached")
    for url in failed:
        print(f"    NOT READ: {url}")
    for r in candidates:
        print(f"  candidate {r['probe'][len('candidate:'):]} via {r['route']}: {r['label']} "
              f"{r['bytes']}B head={r['head']!r}")


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
    ap.add_argument("--discover", action="store_true",
                    help="also read the portal's scripts for how it calls the search")
    ap.add_argument("--chunks", choices=("all", "track", "none"), default="all",
                    help="with --discover, which lazy chunks to read: every one a script names, "
                         "only those the Track Your Proposal route loads, or none")
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

    if args.discover:
        # Routes that answered the control above come first.
        live = {r["route"] for r in everything if r["probe"] == "control" and r["status"] == 200}
        ordered = [rt for rt in routes if rt.host in live] + [rt for rt in routes if rt.host not in live]
        found = discover(ordered, args.timeout, chunks=args.chunks)
        asked = probe_candidates(ordered, search_candidates(found), args.timeout)
        report_discovery(found, asked)
        everything.append({"discovery": found, "candidates": asked})
    if args.out:
        Path(args.out).write_text(json.dumps(everything, indent=1), encoding="utf-8")
    reached = sum(1 for r in everything if r.get("probe") == "control" and r["status"] == 200)
    if args.waves and not reached:
        print("\nNo route reached the service at all: the pool, not the endpoint, is what failed.")
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
