"""Read Chhattisgarh HMS public attendance reports from this runner; aggregates only, no names.

Each job is (district code, institution type). A session that dies part-way keeps what it read and the
next session carries on with the institutions left. Writes out/hms_<job>.json and out/summary.json.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hms  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
TARGET = "india"  # run 44183036191: the runner's own address timed out on 15 of 15 sessions
JOBS = [("01", "A"), ("25", "A"), ("13", "HPRE"), ("13", "HPOS")]
SESSIONS_PER_JOB = 12
JOB_BUDGET_S = 600


def run_job(district: str, kind: str) -> dict:
    t0 = time.time()
    merged = {"listed": None, "institutions": {}, "sessions": []}
    remaining = ["ALL"]
    for _ in range(SESSIONS_PER_JOB):
        if not remaining or time.time() - t0 > JOB_BUDGET_S:
            break
        s0 = time.time()
        try:
            res = hms.read(TARGET, district, kind, remaining)
        except Exception as e:  # noqa: BLE001 - each failure is a recorded result
            merged["sessions"].append({"error": f"{type(e).__name__}: {e}"[:200],
                                       "secs": round(time.time() - s0, 1)})
            continue
        if merged["listed"] is None:
            merged["listed"] = res["listed"]
        merged["institutions"].update(res["institutions"])
        merged["sessions"].append({"route": res["route"], "read": len(res["institutions"]),
                                   "lost": res.get("lost"), "secs": round(time.time() - s0, 1)})
        remaining = [c for c in res["codes"] if c not in merged["institutions"]]
    merged["left"] = len(remaining) if remaining != ["ALL"] else None
    merged["secs"] = round(time.time() - t0, 1)
    return merged


def main() -> None:
    OUT.mkdir(exist_ok=True)
    summary = []
    for district, kind in JOBS:
        res = run_job(district, kind)
        (OUT / f"hms_{district}_{kind}.json").write_text(
            json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
        entry = {"district": district, "kind": kind, "listed": res["listed"], "read": len(res["institutions"]),
                 "left": res["left"], "secs": res["secs"], "sessions": res["sessions"]}
        summary.append(entry)
        print({k: v for k, v in entry.items() if k != "sessions"}, f"{len(res['sessions'])} sessions", flush=True)
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
