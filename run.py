"""Read Chhattisgarh HMS public attendance reports from this runner; aggregates only, no names.

Each job is (district code, institution type, codes). Writes out/<job>.json and out/summary.json with
request counts, failures and timings.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import hms

OUT = Path(__file__).resolve().parent / "out"
JOBS = [
    ("01", "A", ["ALL"]),     # Bastar ashrams
    ("01", "HPRE", ["ALL"]),  # Bastar pre-matric hostels
    ("25", "A", ["ALL"]),     # Sukma ashrams
    ("13", "HPRE", ["ALL"]),  # Raipur pre-matric hostels
    ("13", "HPOS", ["ALL"]),  # Raipur post-matric hostels
]


def main() -> None:
    OUT.mkdir(exist_ok=True)
    summary = []
    for district, kind, codes in JOBS:
        t0 = time.time()
        entry = {"district": district, "kind": kind, "attempts": 0}
        for attempt in range(3):
            entry["attempts"] += 1
            try:
                res = hms.read("open", district, kind, codes)
            except Exception as e:  # noqa: BLE001 - each failure is a recorded result
                entry.setdefault("errors", []).append(f"{type(e).__name__}: {e}"[:300])
                time.sleep(10)
                continue
            (OUT / f"hms_{district}_{kind}.json").write_text(
                json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
            inst = res["institutions"].values()
            entry |= {"listed": res["listed"], "read": len(inst),
                      "with_table": sum(1 for v in inst if v.get("table", True) and v.get("rows", 0) > 0),
                      "requests": 3 + len(inst)}
            break
        entry["secs"] = round(time.time() - t0, 1)
        summary.append(entry)
        print(entry, flush=True)
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
