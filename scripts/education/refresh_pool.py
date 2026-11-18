"""Rebuild the route pool for one education target family.

The machinery is People & Consent's refresher (scripts/instruments/
refresh_proxies.py), reused unchanged: several public HTTP and SOCKS lists,
Indian addresses probed first, at most four ports per address, the known pool
re-verified gently before new candidates, routes appended to the live file as
they verify, and a rotation at the end that drops a route only when it was
probed and failed (and only when at least 50 verified, so an outage on our
side cannot empty a good pool).

Only the probe changes: a route is verified against the target family it
will carry (egress.TARGETS), and the answer must have that source's shape.

    EDUCATION_CACHE_DIR=... python scripts/education/refresh_pool.py india --max-minutes 10
"""
from __future__ import annotations

import os
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


def make_probe(target: egress.Target):
    def probe(proxy: str, timeout: int = 12):
        opener = NET.Route(proxy).opener()
        t0 = time.time()
        try:
            req = urllib.request.Request(target.probe_url,
                                         headers=NET.DEFAULT_HEADERS)
            with opener.open(req, timeout=timeout) as r:
                if r.status != 200:
                    return RP.LIMITED if r.status == NET.RATE_LIMITED else None
                body = r.read(600_000)
        except urllib.error.HTTPError as e:
            return RP.LIMITED if e.code == NET.RATE_LIMITED else None
        except Exception:  # noqa: BLE001
            return None
        if not target.validate(body):
            return None
        return proxy, round(time.time() - t0, 2), len(body)
    return probe


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in egress.TARGETS:
        print(f"usage: refresh_pool.py <{'|'.join(egress.TARGETS)}> "
              "[refresh_proxies options]")
        return 2
    target = egress.TARGETS[sys.argv[1]]
    out = egress.pool_path(target.name)
    out.parent.mkdir(parents=True, exist_ok=True)
    RP.PROBE = target.probe_url
    RP.probe = make_probe(target)
    sys.argv = [sys.argv[0], "--out", str(out)] + sys.argv[2:]
    print(f"target {target.name}: {target.note}")
    return RP.run()


if __name__ == "__main__":
    os._exit(main())
