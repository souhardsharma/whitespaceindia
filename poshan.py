"""Read the public files behind the Poshan Tracker "AWC open" map from this runner.

Stages (env STAGE, comma list; env ARG is a JSON object of options):
  cadence  every weekly and monthly national file: status, Last-Modified, totals
  sample   every State file for one week (district list), then centre-level files for a sample
  bench    every district centre-level file of one State for one week, timed
  cases    named files (ARG.paths), saved whole
One request at a time, ARG.pause seconds apart (default 1.0). TLS verified. Nothing is written anywhere
but out/.
"""
from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out" / "poshan"
BASE = "https://cdn.poshantracker.in/pt_maps_v2/"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CTX = ssl.create_default_context()
ARG = json.loads(os.environ.get("ARG") or "{}")
PAUSE = float(ARG.get("pause", 1.0))
LOG: list[dict] = []
COUNT = 0


def get(path: str, save: str | None = None, keep: bool = True):
    """One GET. Returns (status, bytes, headers)."""
    global COUNT
    COUNT += 1
    url = BASE + path
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json",
                                               "Accept-Encoding": "gzip",
                                               "Referer": "https://www.poshantracker.in/"})
    t0 = time.time()
    wire = 0
    try:
        with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
            raw = r.read()
            wire = len(raw)
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            status, h = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        raw, status, h = e.read(), e.code, dict(e.headers or {})
    except Exception as e:  # noqa: BLE001 - a failure is a recorded result
        raw, status, h = f"{type(e).__name__}: {e}".encode(), -1, {}
    secs = round(time.time() - t0, 2)
    row = {"path": path, "status": status, "bytes": len(raw), "wire": wire, "seconds": secs,
           "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
           "last_modified": h.get("Last-Modified", ""), "etag": h.get("ETag", ""),
           "encoding": h.get("Content-Encoding", ""), "cache": h.get("Cache-Control", ""),
           "server": h.get("Server", ""), "sha": hashlib.sha256(raw).hexdigest()[:16]}
    LOG.append(row)
    if save and status == 200 and keep:
        f = OUT / save
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(raw)
    print(f"{status:>4} {len(raw):>10,} {secs:>6}s {row['last_modified'][5:25]:<20} {path}", flush=True)
    time.sleep(PAUSE)
    return status, raw, h


def js(raw: bytes):
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return None


def weeks(first: dt.date, last: dt.date):
    d = first
    while d <= last:
        e = d + dt.timedelta(days=6)
        yield f"{d.year}/{d:%Y%m%d}_{e:%Y%m%d}"
        d += dt.timedelta(days=7)


def stage_cadence():
    rows = []
    first = dt.date.fromisoformat(ARG.get("first_week", "2024-09-02"))
    last = dt.date.fromisoformat(ARG.get("last_week", "2026-11-16"))
    for w in weeks(first, last):
        s, raw, h = get(f"{w}/mapsAWCOpen.json")
        j = js(raw) if s == 200 else None
        rows.append({"kind": "week", "key": w, "status": s, "last_modified": h.get("Last-Modified", ""),
                     "value": (j or {}).get("value"), "days": (j or {}).get("no_of_days_opens"),
                     "awcs": (j or {}).get("count_awc_ids")})
    y, m = 2022, 4
    while (y, m) <= (2026, 11):
        s, raw, h = get(f"{y}/{m:02d}/mapsAWCOpen.json")
        j = js(raw) if s == 200 else None
        rows.append({"kind": "month", "key": f"{y}/{m:02d}", "status": s,
                     "last_modified": h.get("Last-Modified", ""), "value": (j or {}).get("value"),
                     "days": (j or {}).get("no_of_days_opens"), "awcs": (j or {}).get("count_awc_ids")})
        m += 1
        if m == 13:
            y, m = y + 1, 1
    for extra in ARG.get("extra_paths", ["yearly-data/2025/mapsAWCOpen.json", "yearly-data/2026/mapsAWCOpen.json",
                                         "2026/Q2/mapsAWCOpen.json", "2026/07/mapsAWCDrinkingWater.json",
                                         "2026/09/mapsAWCDrinkingWater.json", "2026/10/mapsAWCAttended.json",
                                         "2026/20261109_20261115/mapsAWCAttended.json",
                                         "2026/20261109_20261115/mapsMorningSnacks.json"]):
        s, raw, h = get(extra)
        rows.append({"kind": "extra", "key": extra, "status": s, "last_modified": h.get("Last-Modified", ""),
                     "head": raw[:120].decode("utf-8", "replace")})
    (OUT / "cadence.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")


def districts_of(week: str):
    s, raw, _ = get(f"{week}/mapsAWCOpen.json", f"{week}/national_mapsAWCOpen.json")
    nat = js(raw) or {}
    out = []
    for st in nat.get("data", []):
        sid = st["state_id"]
        s, raw, _ = get(f"{week}/{sid}/mapsAWCOpen.json", f"{week}/{sid}/mapsAWCOpen.json")
        for d in (js(raw) or {}).get("data", []):
            out.append({"state_id": sid, "state": st["state_name"], "state_code": st.get("state_code"),
                        "district_id": d.get("district_id"), "district": d.get("district_name"),
                        "district_code": d.get("district_code"), "awcs": int(d.get("count_awc_ids") or 0),
                        "days": int(d.get("no_of_days_opens") or 0), "pct": d.get("open_percentage")})
    (OUT / "districts.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    return out


def stage_sample():
    week = ARG.get("week", "2026/20261109_20261115")
    ds = districts_of(week)
    print("districts", len(ds), "awcs", sum(d["awcs"] for d in ds), flush=True)
    by = sorted(ds, key=lambda d: -d["awcs"])
    want = ARG.get("districts") or (
        [(d["state_id"], d["district_id"]) for d in by[:3]] +            # the three largest
        [(d["state_id"], d["district_id"]) for d in by[len(by) // 2:len(by) // 2 + 3]] +  # three middling
        [(d["state_id"], d["district_id"]) for d in by[-2:]])              # the two smallest
    two = [(1, 383)] + [(d["state_id"], d["district_id"]) for d in by[len(by) // 3:len(by) // 3 + 1]]
    for sid, did in want:
        get(f"{week}/{sid}/{did}/mapsAWCOpen_AWCData.json", f"{week}/{sid}/{did}/mapsAWCOpen_AWCData.json")
    # two districts: eight consecutive weeks, every month of 2025-26 and 2026-27 so far, six indicators
    wk = list(weeks(dt.date(2026, 9, 21), dt.date(2026, 11, 9)))
    for sid, did in two:
        for w in wk:
            get(f"{w}/{sid}/{did}/mapsAWCOpen_AWCData.json", f"{w}/{sid}/{did}/mapsAWCOpen_AWCData.json")
        for y, m in [(2025, x) for x in range(4, 13)] + [(2026, x) for x in range(1, 11)]:
            p = f"{y}/{m:02d}/{sid}/{did}/mapsAWCOpen_AWCData.json"
            get(p, p)
        for ind in ["mapsAWCAttended", "mapsMorningSnacks", "mapsSNPDistributed", "mapsGrowthMonitoring",
                    "mapsAWCHomeVisits", "mapsStuntedChildren"]:
            for ym in ["2026/09", "2026/10"]:
                p = f"{ym}/{sid}/{did}/{ind}_AWCData.json"
                get(p, p)
        for q in ["2026/Q2", "2026/Q3", "2026/09", "2026/07"]:
            p = f"{q}/{sid}/{did}/mapsAWCwithToilets_AWCData.json"
            get(p, p)
    for sid in {s for s, _ in two}:
        for suffix in ["_ProjectData", "_SectorData"]:
            p = f"{week}/{sid}/mapsAWCOpen{suffix}.json"
            get(p, p)


def stage_bench():
    week = ARG.get("week", "2026/20261109_20261115")
    sid = int(ARG.get("state_id", 1))
    ds = json.loads((OUT / "districts.json").read_text(encoding="utf-8")) if (OUT / "districts.json").exists() \
        else districts_of(week)
    mine = [d for d in ds if d["state_id"] == sid][: int(ARG.get("cap", 60))]
    t0 = time.time()
    n = b = 0
    for d in mine:
        p = f"{week}/{sid}/{d['district_id']}/mapsAWCOpen_AWCData.json"
        s, raw, _ = get(p, p, keep=bool(ARG.get("keep", True)))
        n += s == 200
        b += len(raw)
    print(f"bench state {sid}: {n}/{len(mine)} files, {b:,} bytes, {time.time() - t0:.0f}s at pause {PAUSE}",
          flush=True)
    (OUT / f"bench_{sid}.json").write_text(json.dumps(
        {"state_id": sid, "week": week, "files": len(mine), "ok": n, "bytes": b,
         "seconds": round(time.time() - t0, 1), "pause": PAUSE}), encoding="utf-8")


def stage_cases():
    for p in ARG.get("paths", []):
        get(p, p)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for st in [s.strip() for s in os.environ.get("STAGE", "").split(",") if s.strip()]:
        print("== stage", st, flush=True)
        {"cadence": stage_cadence, "sample": stage_sample, "bench": stage_bench, "cases": stage_cases}[st]()
    (OUT / "requests.json").write_text(json.dumps(LOG, indent=1), encoding="utf-8")
    ok = sum(r["status"] == 200 for r in LOG)
    print(f"requests {COUNT}, 200s {ok}", flush=True)
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a", encoding="utf-8") as s:
        s.write(f"poshan: {COUNT} requests, {ok} answered 200\n")


if __name__ == "__main__":
    sys.exit(main())
