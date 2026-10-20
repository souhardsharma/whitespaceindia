"""Run fetch_caf.py as N sharded processes, then merge their output.

WHY
---
One Python fetcher is CPU-bound: measured on 2026-09-25 it sat at 0.98 of one
core (TLS handshakes and parsing ~25 KB forms under one GIL) and topped out
near 7 forms/s whatever the thread count (1,500 or 4,000) or pool size. The
machine had 18 logical CPUs at 30% load. Speed therefore comes from
processes. Each shard takes ids with id % N == i and a disjoint slice of the
proxy pool (by exit IP, so no proxy address serves two shards and PARIVESH's
per-address allowance is never shared), gets 1/N of the total pace, and
writes its own files, merged here afterwards - appends from several
processes into one file could interleave lines. Our OWN address is in every
shard's pool, so each shard spaces it N times wider: together they send it
what one process would.

This process holds the machine-wide lock; the shards inherit it, and are
terminated with it - Windows does not end a child when its parent dies, and
orphaned shards kept reading after the lock naming their dead parent had
been cleared for the next run.

  python scripts/instruments/fetch_parallel.py --procs 8 [--workers 1500]
      [--max-rps R] [--limit N] [--max-seconds S]

Exit code: 0 if every shard finished, 3 if the worst was out of time, else 2
(an abort, a crash or a signal is a fault, never hidden behind "out of time").
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import net as NET  # noqa: E402
import run_lock  # noqa: E402


def _complete_lines(data: bytes) -> bytes:
    """`data` cut back to its last newline: a line a killed writer left
    half-written is dropped, never glued to the next record."""
    return data[: data.rfind(b"\n") + 1]


def merge(cache: Path) -> tuple[int, int]:
    """Append every shard file into the main caches, then remove it."""
    moved = [0, 0]
    for k, (pattern, main) in enumerate((("caf_extract.shard*.jsonl", "caf_extract.jsonl"),
                                         ("caf_errors.shard*.jsonl", "caf_errors.jsonl"))):
        target = cache / "caf" / main
        for f in sorted((cache / "caf").glob(pattern)):
            data = _complete_lines(f.read_bytes())
            if target.exists() and target.stat().st_size:
                with open(target, "rb+") as out:
                    out.seek(-1, os.SEEK_END)
                    if out.read(1) != b"\n":
                        # The main file itself was cut mid-line; appending
                        # onto it lost the first merged record.
                        out.seek(0)
                        out.truncate(len(_complete_lines(out.read())))
            with open(target, "ab") as out:
                out.write(data)
            moved[k] += data.count(b"\n")
            f.unlink()
    return moved[0], moved[1]


def exit_code(codes: list[int]) -> int:
    if all(c == 0 for c in codes):
        return 0
    if all(c in (0, 3) for c in codes):
        return 3
    return 2


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--procs", type=int, default=max(2, (os.cpu_count() or 4) // 2))
    ap.add_argument("--workers", type=int, default=1500)
    ap.add_argument("--max-rps", type=float, default=NET.MAX_RPS)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-seconds", type=float, default=0)
    ap.add_argument("--merge-only", action="store_true")
    args = ap.parse_args()
    run_lock.hold_or_exit("fetch_parallel")
    cache = Path(os.environ["INSTRUMENTS_CACHE_DIR"])
    # Leftovers from a run that died before merging go in first.
    f, e = merge(cache)
    if f or e:
        print(f"[parallel] merged {f:,} forms / {e:,} errors left by an earlier run", flush=True)
    if args.merge_only:
        return 0
    n = args.procs
    env = {**os.environ, "INSTRUMENTS_MAX_RPS": str(args.max_rps / n),
           "INSTRUMENTS_MIN_RPS": str(max(0.5, NET.MAX_RPS_FLOOR / n)),
           "INSTRUMENTS_ROUTE_INTERVAL_DIRECT": str(NET.ROUTE_INTERVAL_DIRECT * n)}
    procs = []
    try:
        for i in range(n):
            cmd = [sys.executable, "-u", str(SCRIPTS / "fetch_caf.py"), "--shard", f"{i}/{n}",
                   "--workers", str(max(50, args.workers // n))]
            if args.limit:
                cmd += ["--limit", str(max(1, args.limit // n))]
            if args.max_seconds:
                cmd += ["--max-seconds", str(int(args.max_seconds))]
            log = open(cache / "caf" / f"shard{i}.log", "w", encoding="utf-8")
            procs.append((subprocess.Popen(cmd, env=env, stdout=log, stderr=subprocess.STDOUT), log))
        print(f"[parallel] {n} shards running, {args.max_rps:g}/s total", flush=True)
        codes = [p.wait() for p, _ in procs]
    finally:
        for p, log in procs:
            if p.poll() is None:
                p.terminate()
                p.wait()
            log.close()
    f, e = merge(cache)
    print(f"[parallel] shard exits {codes}; merged {f:,} forms / {e:,} errors", flush=True)
    return exit_code(codes)


if __name__ == "__main__":
    sys.exit(main())
