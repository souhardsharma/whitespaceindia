"""Replay the nightly workflow's steps locally, from a cold cache.

WHY THIS EXISTS
---------------
The scheduled job cannot be run from a branch - GitHub fires schedules only
from the default branch - so the first real run of its cold-start path would
otherwise be on production, unattended. This replays
.github/workflows/instruments-sync.yml step by step on this machine, starting
from a cache that holds only what a cold runner would have, so the path that
matters most - a cache with no application forms - is exercised before it is
relied on.

Steps, in the workflow's order:
  1. the three gating suites (resolver, egress, sync currency);
  2. static sources: copied from --static-from (a cache that holds them), or
     fetched with `build_data.py --fetch` if --fetch-static is given;
  3. the per-proposal cache: unpacked from --seed, verified first;
  4. `sync.py --full --budget-minutes N` - live, against PARIVESH, through
     net.py, building a candidate, checking it, and promoting it;
  5. the published-data contract, with the freshness assertion on;
  6. the boundary suite with the file required;
  7. what the commit step would stage.

It changes public/data/instruments/consent exactly as the scheduled job would,
because that is what is being rehearsed. It never commits.

  python scripts/instruments/rehearse_sync.py --cache <empty dir> \
      --static-from <warm cache> --seed <seed.tar.gz> --budget-minutes 25
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent.parent
sys.path.insert(0, str(SCRIPTS))
import run_lock  # noqa: E402
STATIC = ("parivesh", "shrug", "geo", "lgd", "fetch_stamps.json")


def step(name: str, cmd: list[str], env: dict, allow_fail: bool = False) -> int:
    t = time.time()
    print(f"\n=== {name}", flush=True)
    code = subprocess.run(cmd, cwd=ROOT, env=env).returncode
    print(f"=== {name}: exit {code} in {time.time()-t:.0f}s", flush=True)
    if code and not allow_fail:
        print(f"REHEARSAL FAILED at: {name}")
        sys.exit(code)
    return code


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", required=True, help="an EMPTY directory to use as the runner's cache")
    ap.add_argument("--static-from", help="a cache to copy the static sources from")
    ap.add_argument("--fetch-static", action="store_true", help="download them instead")
    ap.add_argument("--seed", help="the cache seed to unpack (omit to rehearse the no-seed path)")
    ap.add_argument("--budget-minutes", type=float, default=55)  # as the workflow
    args = ap.parse_args()
    run_lock.hold_or_exit("rehearse_sync")  # one run against PARIVESH at a time

    cache = Path(args.cache).resolve()
    if cache.exists() and any(cache.iterdir()):
        sys.exit(f"{cache} is not empty; a rehearsal starts cold")
    cache.mkdir(parents=True, exist_ok=True)
    # As the workflow scopes it: no INSTRUMENTS_GEO_DBF for the gating
    # suites, which run before any cache exists.
    env = {k: v for k, v in os.environ.items() if k != "INSTRUMENTS_GEO_DBF"}
    env.update({"INSTRUMENTS_CACHE_DIR": str(cache), "PYTHONIOENCODING": "utf-8"})
    sync_env = {**env, "INSTRUMENTS_GEO_DBF": str(cache / "geo" / "2011_Dist.dbf")}
    py = sys.executable
    started = time.time()

    for suite in ("test_district_resolution", "test_net", "test_sync"):
        step(suite, [py, str(SCRIPTS / f"{suite}.py")], env)

    if args.fetch_static:
        step("fetch static sources", [py, str(SCRIPTS / "build_data.py"), "--fetch"],
             env, allow_fail=True)
    elif args.static_from:
        src = Path(args.static_from)
        for name in STATIC:
            p = src / name
            if p.is_dir():
                shutil.copytree(p, cache / name)
            elif p.exists():
                shutil.copy2(p, cache / name)
        print(f"\n=== static sources copied from {src}")
    else:
        sys.exit("give --static-from or --fetch-static")

    if args.seed:
        step("unpack the seed", [py, str(SCRIPTS / "cache_seed.py"), "unpack", args.seed], env)
    else:
        print("\n=== no seed: rehearsing the path where the backfill builds up over nights")

    code = step("sync", [py, str(SCRIPTS / "sync.py"), "--full",
                         "--budget-minutes", str(args.budget_minutes)],
                {**sync_env, "INSTRUMENTS_ASSERT_FRESHNESS": "1"}, allow_fail=True)
    if code:
        print("\nThe sync did not publish (exit {}). On the runner the cache would "
              "still be saved, and the next night would continue.".format(code))
        sys.exit(code)

    step("published-data contract", [py, str(SCRIPTS / "check_published.py")],
         {**env, "INSTRUMENTS_ASSERT_FRESHNESS": "1"})
    step("boundary suite", [py, str(SCRIPTS / "test_geometry.py")],
         {**env, "INSTRUMENTS_GEOMETRY_REQUIRE_FILE": "1"})

    step("repeated-partial check", [py, str(SCRIPTS / "sync.py"), "--check-streak"], sync_env)

    print("\n=== what the commit step would stage")
    subprocess.run(["git", "status", "--short", "--", "public/data/instruments"], cwd=ROOT)
    print(f"\nREHEARSAL PASSED in {(time.time()-started)/60:.1f} min")


if __name__ == "__main__":
    main()
