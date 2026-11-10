"""How the education instruments reach their sources.

One egress for every education source, built on the same route pool that
keeps People & Consent current (scripts/instruments/net.py, imported, never
edited). What that pool already does, and why it is reused rather than
re-invented:

- Every request is HTTPS with the certificate chain and hostname verified, so
  a free proxy carries opaque bytes and can neither read nor alter an answer.
- Each exit IP is spaced (ROUTE_INTERVAL), so no single address leans on a
  source; a 429 cools only the address that drew it.
- The total pace adapts down on server distress (5xx) and back up when clean.
- Failing routes rest, then retire; sustained success buys rests back; the
  pool takes new routes from its file every minute (reload_routes).

What this module adds:

1. NO DIRECT ROUTE OFF A RUNNER. On the owner's machine the direct route is
   suspended for good: nothing is ever fetched from that address. On a
   GitHub runner (GITHUB_ACTIONS=true) the runner's own address may carry a
   share, as it does for People & Consent - it is not the owner's.
2. ONE POOL FILE PER TARGET FAMILY. Several education hosts answer only
   Indian addresses (PRABANDH, PGI, PM POSHAN, the School GIS layers), others
   answer anyone. A route is verified against the family it will be used for
   (refresh_pool.py), with a validator that checks the answer is the real
   thing and not a captive page.
3. GENTLER DEFAULTS. These are small public services. The total pace starts
   at 4 requests a second and each exit address waits 6 s between requests,
   unless the caller asks for less.

Usage:
    from egress import open_pool, fetch
    pool = open_pool("india")           # or "open"
    status, body = fetch(pool, url)
"""
from __future__ import annotations

import os
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

# Pace defaults must be in the environment BEFORE net is imported: net reads
# them once at import. A caller's own setting wins.
os.environ.setdefault("INSTRUMENTS_MAX_RPS", "4")
os.environ.setdefault("INSTRUMENTS_MIN_RPS", "0.5")
os.environ.setdefault("INSTRUMENTS_ROUTE_INTERVAL", "6")
os.environ.setdefault("INSTRUMENTS_ROUTE_INTERVAL_DIRECT", "1.5")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "instruments"))
import net as NET  # noqa: E402

# Generic browser headers. net's defaults name PARIVESH as Origin and Referer;
# carrying those to another government host would be both wrong and odd.
NET.DEFAULT_HEADERS = {
    "User-Agent": NET.USER_AGENT,
    "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
}

# Ten years: "never" without the arithmetic trouble of infinity in stats().
FOREVER = 10 * 365 * 86400


def on_runner() -> bool:
    return os.environ.get("GITHUB_ACTIONS") == "true"


def cache_dir() -> Path:
    d = os.environ.get("EDUCATION_CACHE_DIR")
    if not d:
        raise SystemExit("EDUCATION_CACHE_DIR is not set: downloaded data and "
                         "caches live outside the repository")
    p = Path(d)
    p.mkdir(parents=True, exist_ok=True)
    return p


@dataclass(frozen=True)
class Target:
    """A family of hosts that one verified route is expected to reach."""
    name: str
    probe_url: str
    validate: Callable[[bytes], bool]
    note: str


def _json_list(min_len: int, *keys: str) -> Callable[[bytes], bool]:
    import json

    def ok(body: bytes) -> bool:
        try:
            doc = json.loads(body.decode("utf-8", "replace"))
        except ValueError:
            return False
        rows = doc.get("data") if isinstance(doc, dict) else doc
        if isinstance(rows, dict):
            rows = rows.get("content") or rows.get("list") or rows.get("data")
        return (isinstance(rows, list) and len(rows) >= min_len
                and all(isinstance(r, dict) and all(k in r for k in keys)
                        for r in rows[:min_len]))
    return ok


# The probe is the lightest real answer the family gives, checked for shape.
TARGETS: dict[str, Target] = {
    # Hosts that time out from outside India (runner probe, 2026-11-05).
    "india": Target(
        "india",
        "https://spgi.udiseplus.gov.in/performance/yearMaster",
        _json_list(3, "year", "yr_code"),
        "PGI / PRABANDH / PM POSHAN / School GIS: answer Indian addresses only"),
    # Hosts that answer anyone; still read through the pool off a runner.
    "open": Target(
        "open",
        "https://kys.udiseplus.gov.in/web-app/api/states?yearId=0",
        _json_list(30, "stateId"),
        "KYS, sansad.in, SARAS and the other hosts that answered the US runner"),
}


def pool_path(target: str) -> Path:
    return cache_dir() / "pools" / f"{target}.txt"


def open_pool(target: str, *, reload_every: float = 60.0, **kw) -> NET.Pool:
    """A route pool for one target family.

    Off a runner the direct route is suspended for the life of the process,
    so a pool with no proxies sends nothing rather than falling back to the
    owner's address. The pool file is re-read every `reload_every` seconds,
    so a refresher running beside a long fetch heals the pool in place.
    """
    if target not in TARGETS:
        raise SystemExit(f"unknown target {target!r}; known: {sorted(TARGETS)}")
    path = pool_path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    os.environ["INSTRUMENTS_PROXIES"] = str(path)
    pool = NET.Pool(NET.load_proxies(path), **kw)
    if not on_runner():
        pool.direct_blocked_until = time.time() + FOREVER
        pool.direct_blocks = 1
    if reload_every:
        def reload() -> None:
            while True:
                time.sleep(reload_every)
                n = pool.reload_routes(path)
                if n:
                    print(f"  pool: +{n} routes from {path.name}", flush=True)
        threading.Thread(target=reload, daemon=True, name="pool-reload").start()
    return pool


def direct_allowed(pool: NET.Pool) -> bool:
    return not pool.blocked_direct


def fetch(pool: NET.Pool, url: str, **kw) -> tuple[int, bytes]:
    """One request through the pool: (status, body); status -1 = not answered.

    Statuses in net.NOT_SENT bodies mean the request was never sent (deadline
    or every route full) and are owed, not failures of the source.
    """
    kw.setdefault("final", frozenset({404}))
    return NET.get(pool, url, **kw)


def not_sent(body: bytes) -> bool:
    return body in NET.NOT_SENT


class SessionLost(Exception):
    """The route under a session failed; the caller restarts its flow."""


class Session:
    """Several requests that must share one cookie jar and one exit address.

    Some sources keep state between requests: an ASP.NET page whose postbacks
    carry a view state bound to a session cookie, a form whose antiforgery
    token is bound to a cookie. The pool sends each request down whichever
    route is free, so it cannot carry them. A Session holds ONE verified route
    (never the direct one off a runner) for the length of a flow, spaces its
    own requests, and raises SessionLost when that route fails, so the caller
    starts the flow again on another route rather than continuing a half-made
    session somewhere else.
    """

    def __init__(self, target: str, *, spacing: float = 2.0,
                 timeout: int = 40, avoid: set[str] | None = None):
        import http.cookiejar
        import random
        import urllib.request

        routes = [r for r in NET.load_proxies(pool_path(target))
                  if r not in (avoid or set())]
        if not routes and not on_runner():
            raise SystemExit(f"no routes in {pool_path(target)}; run refresh_pool.py")
        # Fastest half first (the file is written fastest first), chosen at
        # random so successive sessions spread over addresses.
        self.proxy = random.choice(routes[: max(1, len(routes) // 2)]) if routes else None
        self.jar = http.cookiejar.CookieJar()
        self.opener = NET.Route(self.proxy).opener()
        self.opener.add_handler(urllib.request.HTTPCookieProcessor(self.jar))
        self.spacing, self.timeout, self._next = spacing, timeout, 0.0

    def request(self, url: str, *, data: bytes | None = None,
                headers: dict | None = None) -> tuple[int, bytes, str]:
        """(status, body, final URL). Raises SessionLost on a transport failure."""
        import urllib.error
        import urllib.request

        wait = self._next - time.time()
        if wait > 0:
            time.sleep(wait)
        self._next = time.time() + self.spacing
        req = urllib.request.Request(url, data=data,
                                     headers={**NET.DEFAULT_HEADERS, **(headers or {})},
                                     method="POST" if data is not None else "GET")
        try:
            with self.opener.open(req, timeout=self.timeout) as r:
                return r.status, r.read(), r.geturl()
        except urllib.error.HTTPError as e:
            return e.code, e.read(), url
        except OSError as e:
            raise SessionLost(f"{self.proxy}: {e}") from e


def summary(pool: NET.Pool) -> str:
    s = pool.stats()
    return (f"routes {s['routes_live']}/{s['routes_total']} live, "
            f"sends {s['sends']}, direct "
            + ("suspended" if s["direct_blocked"] else "allowed"))
