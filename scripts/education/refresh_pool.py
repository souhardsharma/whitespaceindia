"""Rebuild the route pool for one education target family.

The machinery is People & Consent's refresher (scripts/instruments/
refresh_proxies.py), reused unchanged: several public HTTP and SOCKS lists,
Indian addresses probed first, at most four ports per address, the known pool
re-verified gently before new candidates, routes appended to the live file as
they verify, and a rotation at the end that drops a route only when it was
probed and failed (and only when at least 50 verified, so an outage on our
side cannot empty a good pool).

Three things are added here, and none of them is a second pool mechanism:

  the probe    a route is verified against the target family it will carry
               (egress.TARGETS), and the answer must have that source's shape.
  the lists    more public lists, most of them India-only SOCKS5 and SOCKS4,
               are added to the refresher's own for the length of this run.
               For a family that answers Indian addresses only, candidates
               outside India's address ranges are not probed at all: on
               2026-11-25 a ten-minute run spent itself on 274,620 candidates
               of which 30 verified.
  the seed     `--seed FILE` puts another pool's routes at the head of the
               candidates, so they are probed first and enter this pool only
               if they verify against this target. The meal workflow passes
               the pool People & Consent verified against PARIVESH: both
               sources answer India only, so a route good for one is the
               likeliest to be good for the other.

    EDUCATION_CACHE_DIR=... python scripts/education/refresh_pool.py india --max-minutes 10
"""
from __future__ import annotations

import bisect
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "instruments"))
import egress  # noqa: E402  (sets generic headers on net before RP uses them)
import refresh_proxies as RP  # noqa: E402

NET = egress.NET


# India-only lists, (scheme, url), one bare ip:port a line. Each answered on
# 2026-11-25. The refresher's own India lists are read as well.
INDIA_LISTS = [
    ("socks5", "https://raw.githubusercontent.com/SoliSpirit/proxy-list/main/Countries/socks5/India.txt"),
    ("socks4", "https://raw.githubusercontent.com/SoliSpirit/proxy-list/main/Countries/socks4/India.txt"),
    ("http", "https://raw.githubusercontent.com/SoliSpirit/proxy-list/main/Countries/http/India.txt"),
    ("socks5", "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&country=IN&timeout=10000"),
    ("socks4", "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks4&country=IN&timeout=10000"),
    ("http", "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&country=IN&timeout=10000"),
]
# The same, as JSON pages of 500 (the refresher reads page 1 itself).
GEONODE_INDIA_PAGE = ("https://proxylist.geonode.com/api/proxy-list?country=IN"
                      "&limit=500&page={page}&sort_by=lastChecked&sort_type=desc")
GEONODE_PAGES = (2, 3, 4)
# A list that tags each address with its country ("1.2.3.4:80 IN-N-S +").
SPYS = "https://spys.me/proxy.txt"
SPYS_INDIA = re.compile(r"^(\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}) IN-", re.M)
# Lists of every country that the refresher does not carry; the address
# filter keeps their Indian entries for an India-only target. Each answered
# on 2026-11-25.
MORE_SOCKS = [
    ("socks5", "https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/socks5_proxies.txt"),
    ("socks5", "https://raw.githubusercontent.com/databay-labs/free-proxy-list/master/socks5.txt"),
    ("socks5", "https://raw.githubusercontent.com/TuanMinPay/live-proxy/master/socks5.txt"),
    ("socks5", "https://api.openproxylist.xyz/socks5.txt"),
    ("socks5", "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/socks5.txt"),
    ("socks5", "https://raw.githubusercontent.com/Vann-Dev/proxy-list/main/proxies/socks5.txt"),
    ("socks5", "https://raw.githubusercontent.com/B4RC0DE-TM/proxy-list/main/SOCKS5.txt"),
    ("socks5", "https://raw.githubusercontent.com/im-razvan/proxy_list/main/socks5.txt"),
    ("socks5", "https://raw.githubusercontent.com/ProxyScraper/ProxyScraper/main/socks5.txt"),
]
MORE_HTTP = [
    "https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/http.txt",
]


def india_extra() -> list[str]:
    """Routes from the India-only lists above, in the pool's notation."""
    routes: list[str] = []
    for scheme, url in INDIA_LISTS:
        try:
            hits = [RP.as_route(scheme, addr) for addr in RP.ADDR.findall(RP.fetch_text(url))]
        except Exception as exc:  # noqa: BLE001 - a list that is down is skipped
            print(f"      0 India {scheme} from {url.split('/')[2]}  ({type(exc).__name__})")
            continue
        print(f"  {len(hits):>5} India {scheme} from {url.split('/')[2]}")
        routes += hits
    try:
        hits = SPYS_INDIA.findall(RP.fetch_text(SPYS))
        print(f"  {len(hits):>5} India http from {SPYS.split('/')[2]}")
        routes += hits
    except Exception as exc:  # noqa: BLE001
        print(f"      0 India http from {SPYS.split('/')[2]}  ({type(exc).__name__})")
    for page in GEONODE_PAGES:
        try:
            rows = json.loads(RP.fetch_text(GEONODE_INDIA_PAGE.format(page=page))).get("data") or []
        except Exception as exc:  # noqa: BLE001
            print(f"      0 India from geonode page {page}  ({type(exc).__name__})")
            break
        hits = [RP.as_route(proto, f"{r['ip']}:{r['port']}") for r in rows
                for proto in (r.get("protocols") or [])[:1]
                if RP.ADDR.match(f"{r.get('ip')}:{r.get('port')}")]
        print(f"  {len(hits):>5} India from geonode page {page}")
        routes += hits
        if len(rows) < 500:
            break
    return routes


def in_ranges(route: str, ranges) -> bool:
    starts, ends = ranges
    try:
        ip = RP.ip_number(route)
    except ValueError:
        return False
    i = bisect.bisect_right(starts, ip) - 1
    return i >= 0 and ip <= ends[i]


def india_only(routes: list[str], ranges, known: set[str]) -> list[str]:
    """Indian candidates, and every known route whatever its address: a
    route that verified before is evidence, and the address table is not
    perfect. With no table, the candidates are left as they are."""
    if not ranges:
        return routes
    kept = [r for r in routes if r in known or in_ranges(r, ranges)]
    print(f"  {len(kept):,} of {len(routes):,} candidates are known or in India; "
          "the rest are not probed for this target")
    return kept


def read_seed(seed: Path) -> list[str]:
    """Routes from another pool's file, in its order; any line that is not
    the shape of a pool line is ignored."""
    if not seed.exists():
        print(f"  no seed at {seed}")
        return []
    routes = []
    for ln in seed.read_text(encoding="utf-8").splitlines():
        route = ln.split()[0] if ln.strip() else ""
        if route and (RP.ADDR.match(route) or RP.SCHEMED.match(route)):
            routes.append(route)
    print(f"  seed: {len(routes)} routes from {seed.name}, probed first")
    return routes


def widen(target: egress.Target, out: Path, seed: list[str]) -> None:
    """Point the refresher's own gather and ordering at this target."""
    listed = {url for _, url in RP.SOCKS_SOURCES}
    RP.SOCKS_SOURCES.extend(s for s in MORE_SOCKS if s[1] not in listed)
    RP.SOURCES.extend(url for url in MORE_HTTP if url not in RP.SOURCES)
    gather, order = RP.gather, RP.india_first

    def gather_wider() -> list[str]:
        # The seed, then the India lists: gather() orders by list, most promising first.
        return RP.cap_ports(seed + india_extra() + gather())[0]

    def order_for_target(routes: list[str], ranges) -> list[str]:
        if target.india_only:
            known = set(seed) | {ln.split()[0] for ln in (out.read_text(encoding="utf-8").splitlines()
                                                          if out.exists() else []) if ln.strip()}
            routes = india_only(routes, ranges, known)
        return order(routes, ranges)

    RP.gather, RP.india_first = gather_wider, order_for_target


def make_probe(target: egress.Target):
    def probe(proxy: str, timeout: int = 0):
        timeout = max(timeout, target.probe_timeout)
        opener = NET.Route(proxy).opener()
        t0 = time.time()
        req = urllib.request.Request(target.probe_url, headers=NET.DEFAULT_HEADERS)
        for chain_checked in (False, True):
            try:
                with opener.open(req, timeout=timeout) as r:
                    if r.status != 200:
                        return RP.LIMITED if r.status == NET.RATE_LIMITED else None
                    body = r.read(600_000)
                break
            except urllib.error.HTTPError as e:
                return RP.LIMITED if e.code == NET.RATE_LIMITED else None
            except Exception as e:  # noqa: BLE001
                # A host that leaves out its intermediate certificate fails
                # every probe on a runner until the chain is completed, and
                # only a route that reaches the host can complete it.
                if (chain_checked or egress.ISSUER_MISSING not in str(e)
                        or egress.ensure_chain(target.probe_url, [proxy], recheck=True) != "completed"):
                    return None
        else:
            return None
        if not target.validate(body):
            return None
        return proxy, round(time.time() - t0, 2), len(body)
    return probe


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in egress.TARGETS:
        print(f"usage: refresh_pool.py <{'|'.join(egress.TARGETS)}> "
              "[--seed FILE] [refresh_proxies options]")
        return 2
    target = egress.TARGETS[sys.argv[1]]
    out = egress.pool_path(target.name)
    out.parent.mkdir(parents=True, exist_ok=True)
    rest = sys.argv[2:]
    print(f"target {target.name}: {target.note}")
    seed: list[str] = []
    if "--seed" in rest:
        at = rest.index("--seed")
        seed = read_seed(Path(rest[at + 1]))
        del rest[at:at + 2]
    RP.PROBE = target.probe_url
    RP.probe = make_probe(target)
    widen(target, out, seed)
    sys.argv = [sys.argv[0], "--out", str(out)] + rest
    return RP.run()


if __name__ == "__main__":
    os._exit(main())
