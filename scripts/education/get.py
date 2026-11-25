"""Fetch one URL through the education egress, for probing a source by hand.

    EDUCATION_CACHE_DIR=... python scripts/education/get.py <india|open> URL [--out FILE] [--post JSON]

Prints the status, the size and the route mix; writes the body to --out (or
the first 2,000 characters to stdout). Off a runner the request never leaves
from this machine's own address: with an empty pool it is simply not sent.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import egress  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("target", choices=sorted(egress.TARGETS))
    ap.add_argument("url")
    ap.add_argument("--out")
    ap.add_argument("--post", help="JSON body; sends a POST")
    ap.add_argument("--timeout", type=int, default=40)
    args = ap.parse_args()

    pool = egress.open_pool(args.target, reload_every=0)
    if len(pool.routes) == 1 and not egress.direct_allowed(pool):
        print(f"no routes in {egress.pool_path(args.target)}; run refresh_pool.py first")
        return 2
    data = args.post.encode("utf-8") if args.post else None
    if data:
        egress.NET.DEFAULT_HEADERS["Content-Type"] = "application/json"
    t0 = time.time()
    status, body = egress.fetch(pool, args.url, data=data,
                                method="POST" if data else "GET",
                                timeout=args.timeout, deadline=t0 + 180)
    print(f"HTTP {status}  {len(body):,} bytes  {time.time() - t0:.1f}s  "
          f"[{egress.summary(pool)}]")
    if args.out:
        Path(args.out).write_bytes(body)
        print(f"-> {args.out}")
    else:
        print(body[:2000].decode("utf-8", "replace"))
    return 0 if status == 200 else 1


if __name__ == "__main__":
    sys.exit(main())
