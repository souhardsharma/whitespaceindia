"""Rebuild the pool of egress routes that can reach PARIVESH.

WHY THIS EXISTS
---------------
Free public proxies are ephemeral: most of any published list is already dead,
and the ones that work stop working within days. A pool captured once is a
pool that quietly empties, so the fetchers end up back on a single route and
back at the failure this whole layer exists to survive.

This rebuilds the pool from scratch: several public lists, deduplicated, then
every candidate tried once against the lightest endpoint the service has.

WHAT COUNTS AS WORKING
----------------------
Only a route that CONNECT-tunnels to the real host with the certificate chain
VERIFIED. That is the entire safety argument for using untrusted intermediaries
at all: under a verified tunnel the proxy moves opaque bytes and can neither
read nor alter the payload, so what arrives is what the government server sent.
Verification is never relaxed to make a route work - see net.py.

And the response must be the real thing. A proxy that returns 200 with a
captive-portal page, an advertisement, or a truncated body is not working; it
is failing in the most dangerous way available. So the probe parses the answer
and checks it is the sector list, with the shape the sector list has.

  python scripts/instruments/refresh_proxies.py [--out FILE] [--workers N]
  then:  export INSTRUMENTS_PROXIES=FILE
"""
from __future__ import annotations

import argparse
import bisect
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import net as NET  # noqa: E402

# Public lists, no key, no account. Several because any one of them is often
# stale or briefly unreachable, and a pool built from one source inherits that
# source's outage.
SOURCES = [
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt",
    "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
    "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
    "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/proxies.txt",
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http",
    "https://www.proxy-list.download/api/v1/get?type=https",
    # Added after three scrapes in one day showed the yield falling as the
    # earlier lists went stale: 285, then 130, then 165 verified. A pool built
    # from a handful of sources inherits their refresh cycle, and when the
    # direct route is unavailable the pool IS the throughput.
    "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt",
    "https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt",
    "https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt",
    "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt",
    "https://raw.githubusercontent.com/prxchk/proxy-list/main/http.txt",
    "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt",
    "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/http.txt",
    "https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/http/http.txt",
    "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/http.txt",
    "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text",
]

# SOCKS lists: (scheme, url). Candidates from these are written as
# "socks5://ip:port" / "socks4://ip:port"; net.Route opens them through PySocks
# with the same verified TLS context.
SOCKS_SOURCES = [
    ("socks5", "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt"),
    ("socks4", "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt"),
    ("socks5", "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt"),
    ("socks4", "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt"),
    ("socks5", "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt"),
    ("socks4", "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks4/data.txt"),
    ("socks5", "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt"),
    ("socks5", "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/socks5.txt"),
    ("socks4", "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/socks4.txt"),
    ("socks5", "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/socks5.txt"),
    ("socks5", "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks5&proxy_format=ipport&format=text"),
    ("socks4", "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks4&proxy_format=ipport&format=text"),
    ("socks5", "https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt"),
    ("socks4", "https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS4_RAW.txt"),
    ("socks5", "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks5.txt"),
    ("socks4", "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks4.txt"),
    ("socks5", "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt"),
    ("socks4", "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks4.txt"),
    ("socks5", "https://raw.githubusercontent.com/prxchk/proxy-list/main/socks5.txt"),
    ("socks5", "https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/socks5/socks5.txt"),
    ("socks4", "https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/socks4/socks4.txt"),
    ("socks5", "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks5.txt"),
    ("socks4", "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/socks4.txt"),
    ("socks5", "https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks5.txt"),
    ("socks4", "https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks4.txt"),
    ("socks5", "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/socks5_proxies.txt"),
    ("socks5", "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/socks5.txt"),
    ("socks4", "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/socks4.txt"),
    ("socks5", "https://raw.githubusercontent.com/r00tee/Proxy-List/main/Socks5.txt"),
    ("socks4", "https://raw.githubusercontent.com/r00tee/Proxy-List/main/Socks4.txt"),
    ("socks5", "https://raw.githubusercontent.com/dpangestuw/Free-Proxy/main/socks5_proxies.txt"),
    ("socks5", "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks5.txt"),
    ("socks4", "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks4.txt"),
    ("socks5", "https://raw.githubusercontent.com/elliottophellia/proxylist/master/results/socks5/global/socks5_checked.txt"),
    ("socks4", "https://raw.githubusercontent.com/elliottophellia/proxylist/master/results/socks4/global/socks4_checked.txt"),
    ("socks5", "https://raw.githubusercontent.com/gfpcom/free-proxy-list/main/list/socks5.txt"),
    ("socks4", "https://raw.githubusercontent.com/gfpcom/free-proxy-list/main/list/socks4.txt"),
    ("socks5", "https://www.proxy-list.download/api/v1/get?type=socks5"),
]

# PARIVESH answers only addresses in India. Measured 2026-10-21: 105 of the 107
# distinct addresses in a working pool geolocated to India (data-centre ranges
# of Microsoft, Oracle and DigitalOcean among them), and GitHub's runners,
# outside India, are refused at connect. Of 271,185 candidates gathered from
# the lists above only 4,874 were Indian, so a time-bounded refresh spent
# nearly all its time on routes that could not work. These lists are India
# only, one `scheme://ip:port` per line.
INDIA_SOURCES = [
    "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies"
    "&country=in&proxy_format=protocolipport&format=text",
    "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/"
    "countries/IN/data.txt",
]
# The same, as JSON objects carrying ip, port and protocols.
GEONODE_INDIA = ("https://proxylist.geonode.com/api/proxy-list?country=IN"
                 "&limit=500&page=1&sort_by=lastChecked&sort_type=desc")
# IPv4 ranges by country (ip-location-db, from WHOIS and ASN data; CC0). Used
# only to probe Indian candidates first; without it the order is unchanged.
COUNTRY_RANGES = ("https://cdn.jsdelivr.net/npm/@ip-location-db/"
                  "geo-whois-asn-country/geo-whois-asn-country-ipv4-num.csv")
SCHEMED = re.compile(r"^\s*(https?|socks[45])://(\d{1,3}(?:\.\d{1,3}){3}:\d{2,5})\s*$",
                     re.M)

PROBE = ("https://parivesh.nic.in/parivesh_api/trackYourProposal/"
         "getListOfSector")
ADDR = re.compile(r"^\s*(\d{1,3}(?:\.\d{1,3}){3}:\d{2,5})\s*$", re.M)


PORTS_PER_HOST = 4


def gather() -> list[str]:
    """Candidates, the most promising first.

    Ordered by SOURCE, smallest list first, not sorted by address. Measured on
    2026-09-25: the small curated lists verified at ~3.4%, while one list of
    ~101,000 addresses verified at ~0.2%. Sorting everything together buried
    the good candidates among dead ones, so a time-bounded refresh (the
    nightly job has four minutes) spent most of its budget on the worst list.
    """
    per_source: list[list[str]] = []
    for scheme, url in SOCKS_SOURCES:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": NET.USER_AGENT})
            with urllib.request.urlopen(req, timeout=45) as r:
                body = r.read().decode("utf-8", "replace")
            hits = [f"{scheme}://{h}" for h in ADDR.findall(
                re.sub(r"(?m)^\s*socks[45]://", "", body))]
            per_source.append(hits)
            print(f"  {len(hits):>5} {scheme} from {url.split('/')[2]}")
        except Exception as exc:  # noqa: BLE001
            print(f"      0 {scheme} from {url.split('/')[2]}  ({type(exc).__name__})")
    for url in SOURCES:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": NET.USER_AGENT})
            with urllib.request.urlopen(req, timeout=45) as r:
                body = r.read().decode("utf-8", "replace")
            hits = ADDR.findall(body)
            per_source.append(hits)
            print(f"  {len(hits):>5} from {url.split('/')[2]}")
        except Exception as exc:  # noqa: BLE001
            print(f"      0 from {url.split('/')[2]}  ({type(exc).__name__})")
    for url in INDIA_SOURCES:
        try:
            hits = [as_route(s, a) for s, a in SCHEMED.findall(fetch_text(url))]
            per_source.append(hits)
            print(f"  {len(hits):>5} India from {url.split('/')[2]}")
        except Exception as exc:  # noqa: BLE001
            print(f"      0 India from {url.split('/')[2]}  ({type(exc).__name__})")
    try:
        rows = json.loads(fetch_text(GEONODE_INDIA)).get("data") or []
        hits = [as_route(proto, f"{r['ip']}:{r['port']}") for r in rows
                for proto in (r.get("protocols") or [])[:1]
                if ADDR.match(f"{r.get('ip')}:{r.get('port')}")]
        per_source.append(hits)
        print(f"  {len(hits):>5} India from {GEONODE_INDIA.split('/')[2]}")
    except Exception as exc:  # noqa: BLE001
        print(f"      0 India from {GEONODE_INDIA.split('/')[2]}  ({type(exc).__name__})")
    # At most PORTS_PER_HOST ports of one address. Lists carry gateways on
    # hundreds of ports (measured 2026-10-20: 514 of 578 verified routes on
    # five IPs, exiting through two), and PARIVESH spaces by address - so the
    # probe budget was spent re-finding the same two exits instead of new ones.
    return cap_ports([h for hits in sorted(per_source, key=len) for h in hits])[0]


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": NET.USER_AGENT})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read().decode("utf-8", "replace")


def as_route(scheme: str, addr: str) -> str:
    """A list entry in the pool's notation: HTTP(S) proxies bare, SOCKS schemed."""
    scheme = scheme.lower()
    return f"{scheme}://{addr}" if scheme.startswith("socks") else addr


def ip_number(route: str) -> int:
    # Lists write octets with leading zeros ("103.250.166.04"), which
    # ipaddress refuses.
    a, b, c, d = (int(x) for x in route.split("://")[-1].rsplit(":", 1)[0].split("."))
    return (a << 24) | (b << 16) | (c << 8) | d


def india_ranges() -> tuple[list[int], list[int]] | None:
    """(starts, ends) of India's IPv4 ranges, or None if the table is unreachable."""
    try:
        body = fetch_text(COUNTRY_RANGES)
    except Exception as exc:  # noqa: BLE001
        print(f"  country table unreachable ({type(exc).__name__}); "
              "candidates keep their list order")
        return None
    starts, ends = [], []
    for ln in body.splitlines():
        parts = ln.split(",")
        if len(parts) == 3 and parts[2].strip() == "IN":
            starts.append(int(parts[0]))
            ends.append(int(parts[1]))
    return (starts, ends) if starts else None


def india_first(routes: list[str], ranges) -> list[str]:
    """Indian addresses first, each group in its existing order."""
    if not ranges:
        return routes
    starts, ends = ranges

    def in_india(route: str) -> bool:
        try:
            ip = ip_number(route)
        except ValueError:
            return False
        i = bisect.bisect_right(starts, ip) - 1
        return i >= 0 and ip <= ends[i]

    inside = [r for r in routes if in_india(r)]
    chosen = set(inside)
    print(f"  {len(inside):,} of {len(routes):,} candidates are in India; "
          "probed first")
    return inside + [r for r in routes if r not in chosen]


def cap_ports(routes: list[str]) -> tuple[list[str], set]:
    """(routes with at most PORTS_PER_HOST per address, in order; the rest)."""
    out, seen, ports, excess = [], set(), {}, set()
    for h in routes:
        if h in seen:
            continue
        seen.add(h)
        host = h.split("://")[-1].rsplit(":", 1)[0]
        if ports.get(host, 0) >= PORTS_PER_HOST:
            excess.add(h)
            continue
        ports[host] = ports.get(host, 0) + 1
        out.append(h)
    return out, excess


# A probe answered 429: the route reaches PARIVESH and the ADDRESS is over its
# per-address allowance - routine while a backfill uses the same addresses. It
# is not evidence the route is dead, so it is never dropped for it.
LIMITED = "limited"


def probe(proxy: str, timeout: int = 12):
    """(proxy, seconds, bytes) when this route delivers the real answer;
    LIMITED when it reached the service and was told to wait (429)."""
    # The same opener the fetchers use, so a SOCKS route is probed exactly as
    # it will be used - verified TLS either way.
    opener = NET.Route(proxy).opener()
    t0 = time.time()
    try:
        req = urllib.request.Request(PROBE, headers=NET.DEFAULT_HEADERS)
        with opener.open(req, timeout=timeout) as r:
            if r.status != 200:
                return LIMITED if r.status == NET.RATE_LIMITED else None
            body = r.read(200_000)
    except urllib.error.HTTPError as e:
        return LIMITED if e.code == NET.RATE_LIMITED else None
    except Exception:  # noqa: BLE001
        return None
    try:
        rows = json.loads(body.decode("utf-8", "replace")).get("data")
    except Exception:  # noqa: BLE001
        return None
    # The sector list, and shaped like the sector list. A 200 carrying anything
    # else is a route that would corrupt the register silently.
    if not isinstance(rows, list) or len(rows) < 8:
        return None
    if not all(isinstance(x, dict) and "id" in x and "name" in x for x in rows):
        return None
    return proxy, round(time.time() - t0, 2), len(body)


# Below this many verified routes a run is not evidence about the pool: when
# the service or our own network is down for the refresh, every known route
# "fails" its probe, and dropping them on that basis wrote an empty pool.
MIN_REPLACE = 50


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="proxies_verified.txt")
    # Tuned top-down on 2026-09-25 (2-minute trials): 500 workers probed
    # 67/s, 1,000 158/s, 4,000 279/s. A probe is one small request through a
    # different address each, so the width costs the service nothing.
    ap.add_argument("--workers", type=int, default=4000)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-minutes", type=float, default=0, help=(
        "stop probing after this long and keep what verified; 0 = no limit"))
    ap.add_argument("--target", type=int, default=0, help=(
        "stop once this many routes have verified; 0 = probe everything"))
    args = ap.parse_args()

    print("gathering candidates")
    cands = gather()
    out_path = Path(args.out)
    prior_routes = [ln.split()[0] for ln in (out_path.read_text(encoding="utf-8").splitlines()
                                              if out_path.exists() else []) if ln.strip()]
    # The known pool is capped per address too. Uncapped, a pool of 514 ports
    # on five gateway IPs was re-verified and kept every night.
    prior_routes, trimmed = cap_ports(prior_routes)
    # The known pool first: routes that verified before are ~50x likelier to
    # verify again than a random list entry, so a time-bounded refresh spends
    # its first seconds confirming (or disproving) what the fetchers use.
    front = set(prior_routes)
    cands = cap_ports(prior_routes + [c for c in cands if c not in front])[0]
    cands = india_first(cands, india_ranges())
    if args.limit:
        cands = cands[: args.limit]
    print(f"  {len(cands):,} unique\n")

    # Pass 1: the known pool, gently. Probed 4,000 wide, this machine's own
    # network stack saturates and working proxies time out: measured, 130 of
    # 806 routes "disproved" in a wide pass verified at 200 wide / 20 s.
    known_ok: list = []
    limited: set = set()
    if prior_routes:
        with ThreadPoolExecutor(max_workers=200) as kx:
            for p_, r in zip(prior_routes,
                             kx.map(lambda p: probe(p, timeout=20), prior_routes)):
                if r == LIMITED:
                    limited.add(p_)
                elif r:
                    known_ok.append(r)
        print(f"  known routes: {len(known_ok)} of {len(prior_routes)} verify "
              f"(200 wide, 20 s)", flush=True)
    known_ok_set = {r[0] for r in known_ok}
    cands = [c for c in cands if c not in front]
    print(f"probing against {PROBE.split('/')[2]}")
    good, done, t0 = list(known_ok), 0, time.time()
    failed: set = set(front) - known_ok_set - limited
    out = Path(args.out)
    # Written AS ROUTES VERIFY, not only at the end. Probing ~100,000
    # candidates takes over an hour; a run stopped by a timeout used to leave
    # nothing, and a fetcher already running picks new lines up from this
    # file (net.Pool.reload_routes) - so the pool is usable within minutes.
    # APPEND, never truncate first: the file is the live pool a running
    # fetcher reads, and truncating it at start left an empty pool for the
    # whole probe - or for good, if the run was killed or nothing verified.
    # Routes already listed are kept; at the end the file is rotated (below).
    prior = [ln for ln in (out.read_text(encoding="utf-8").splitlines()
                           if out.exists() else []) if ln.strip()]
    known = {ln.split()[0] for ln in prior}
    live = open(out, "a", encoding="utf-8")
    ex = ThreadPoolExecutor(max_workers=args.workers)
    try:
        futs = {ex.submit(probe, c): c for c in cands}
        for fut in as_completed(futs):
            done += 1
            res = fut.result()
            # A LIMITED route is neither verified nor failed, and still falls
            # through to the stop checks below: a `continue` here let a run of
            # 429s carry the refresh past its time bound.
            if not res:
                failed.add(futs[fut])
            elif res != LIMITED:
                good.append(res)
                if res[0] not in known:
                    known.add(res[0])
                    live.write(f"{res[0]} {res[1]} {res[2]}\n")
                    live.flush()
            if done % 1000 == 0:
                print(f"  {done:,}/{len(cands):,}  working {len(good)}", flush=True)
            if (args.target and len(good) >= args.target) or (
                    args.max_minutes and time.time() - t0 > args.max_minutes * 60):
                print(f"  stopping at {done:,} probed: "
                      + ("target reached" if args.target and len(good) >= args.target
                         else "time budget reached"), flush=True)
                break
    finally:
        live.close()
        ex.shutdown(wait=False, cancel_futures=True)

    good.sort(key=lambda x: x[1])
    # ROTATION: this run's verified routes, fastest first, then every prior
    # route this run did NOT disprove (not reached before the time bound).
    # A route is dropped only when it was probed and failed. Replacing the
    # file with one run's result threw away ~900 working routes when a
    # 2-minute refresh reached only part of the list.
    verified = {p for p, _, _ in good}
    disproved = failed if len(good) >= MIN_REPLACE else set()
    if not disproved and failed & front:
        print(f"  only {len(good)} verified (< {MIN_REPLACE}): no known route is "
              "dropped on this run's evidence")
    keep = [ln for ln in prior if ln.split()[0] not in verified
            and ln.split()[0] not in disproved and ln.split()[0] not in trimmed]
    # Through a temporary file and one replace: a fetcher reloading the pool
    # mid-write would otherwise read a truncated file.
    tmp = out.with_name(out.name + ".tmp")
    tmp.write_text("".join(f"{p} {s} {b}\n" for p, s, b in good)
                   + "".join(ln + "\n" for ln in keep), encoding="utf-8")
    for attempt in range(12):
        try:
            os.replace(tmp, out)
            break
        except PermissionError:
            # Windows refuses while a reader (or a scanner) has the file open.
            # Not fatal: the live file already holds every route this run
            # verified, appended as they came, so it is left as it is.
            if attempt == 11:
                print("  could not rotate the pool file (held open); the "
                      "appended pool stays in place")
                tmp.unlink(missing_ok=True)
                break
            time.sleep(1.0 * (attempt + 1))
    print(f"  pool: {len(good)} verified now + {len(keep)} kept unprobed; "
          f"{len(disproved & front)} known routes disproved and dropped")
    took = (time.time() - t0) / 60
    print(f"\n{len(good)} of {len(cands):,} routes reach the service "
          f"({took:.1f} min)")
    if good:
        lat = [s for _, s, _ in good]
        print(f"  latency  min {lat[0]:.2f}s  median {lat[len(lat)//2]:.2f}s  "
              f"max {lat[-1]:.2f}s")
    print(f"-> {out}\n   export INSTRUMENTS_PROXIES={out}")
    if not good:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
