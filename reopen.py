"""Reopen the Poshan Tracker centre files under the weekly bar (read only).

Stages (env STAGE comma list, else plan.json "stage"; ARG json, else plan.json "arg"):
  snap     week 2026-11-09..15: every State's project file and sample centre files, with Last-Modified
           (the files under that week were rewritten on Wed 18 Nov 03:2x GMT)
  sample   twelve districts: the last twelve weekly centre files, months Aug-Oct 2026, FY 2025-26 months
  country  every district's centre file for the periods in ARG.periods, ARG.workers at a time, timed;
           written compact (code, days) per period, names once
  again    re-read the snap files at the end, to see whether they moved during the run
TLS verified. Nothing written outside out/.
"""
from __future__ import annotations

import concurrent.futures as cf
import csv
import datetime as dt
import gzip
import hashlib
import json
import os
import re
import ssl
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out" / "reopen"
BASE = "https://cdn.poshantracker.in/pt_maps_v2/"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CTX = ssl.create_default_context()
PLAN = json.loads((HERE / "plan.json").read_text(encoding="utf-8")) if (HERE / "plan.json").exists() else {}
ARG = json.loads(os.environ.get("ARG") or "null") or PLAN.get("arg", {})
LOG: list[dict] = []
LOCK = threading.Lock()
W46 = "2026/20261109_20261115"
SAMPLE = [(1, 383), (17, 126), (24, 643), (24, 638), (22, 242), (14, 917), (14, 49), (21, 213), (23, 270),
          (29, 708), (35, 596), (17, 114)]


def get(path: str, save: str | None = None, pause: float = 0.0, tag: str = ""):
    url = BASE + path
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json",
                                               "Accept-Encoding": "gzip", "Referer": "https://www.poshantracker.in/"})
    t0 = time.time()
    wire = 0
    try:
        with urllib.request.urlopen(req, timeout=90, context=CTX) as r:
            raw = r.read()
            wire = len(raw)
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            status, h = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        raw, status, h = e.read(), e.code, dict(e.headers or {})
    except Exception as e:  # noqa: BLE001
        raw, status, h = f"{type(e).__name__}: {e}".encode(), -1, {}
    secs = round(time.time() - t0, 3)
    row = {"path": path, "status": status, "bytes": len(raw), "wire": wire, "seconds": secs, "tag": tag,
           "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)), "last_modified": h.get("Last-Modified", ""),
           "etag": h.get("ETag", ""), "sha": hashlib.sha256(raw).hexdigest()[:16]}
    with LOCK:
        LOG.append(row)
    if save and status == 200:
        f = OUT / "raw" / save
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(raw)
    if pause:
        time.sleep(pause)
    return status, raw, h


def js(raw):
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return None


def centres(j) -> list[dict]:
    out: list[dict] = []

    def walk(o, proj=None, sec=None):
        if isinstance(o, list):
            for x in o:
                walk(x, proj, sec)
        elif isinstance(o, dict):
            if "awc_code" in o:
                out.append({**o, "_p": proj, "_s": sec})
                return
            p = o.get("project_id", proj)
            for k, v in o.items():
                if k == "sectordata":
                    for blk in v:
                        for sk, sv in blk.items():
                            walk(sv, p, sk)
                elif isinstance(v, (list, dict)):
                    walk(v, p, sec)
    walk(j)
    return out


def weeks(first: dt.date, n: int):
    return [f"{(first + dt.timedelta(days=7 * i)).year}/{first + dt.timedelta(days=7 * i):%Y%m%d}_"
            f"{first + dt.timedelta(days=7 * i + 6):%Y%m%d}" for i in range(n)]


def state_ids() -> list[int]:
    s, raw, _ = get(f"{W46}/mapsAWCOpen.json", f"{W46}/national.json", tag="snap")
    return [st["state_id"] for st in (js(raw) or {}).get("data", [])]


def stage_snap():
    for sid in state_ids():
        get(f"{W46}/{sid}/mapsAWCOpen.json", f"{W46}/{sid}/state.json", 0.3, "snap")
        get(f"{W46}/{sid}/mapsAWCOpen_ProjectData.json", f"{W46}/{sid}/project.json", 0.3, "snap")
    for sid, did in SAMPLE:
        get(f"{W46}/{sid}/{did}/mapsAWCOpen_AWCData.json", f"snap/{W46}/{sid}/{did}.json", 0.3, "snap")
    for p in ["2026/10/1/383/mapsAWCOpen_AWCData.json", "2026/20261102_20261108/1/383/mapsAWCOpen_AWCData.json",
              "2026/Q3/mapsAWCOpen.json", "2026/Q3/1/383/mapsAWCOpen_AWCData.json",
              "2026/20261116_20261122/mapsAWCOpen.json", "2026/11/mapsAWCOpen.json"]:
        get(p, "snap/" + p, 0.3, "snap")


def stage_sample():
    wk = weeks(dt.date(2026, 8, 24), 12)
    months = [f"2026/{m:02d}" for m in (8, 9, 10)] + [f"2025/{m:02d}" for m in range(4, 13)] + \
             [f"2026/{m:02d}" for m in (1, 2, 3)]
    for sid, did in SAMPLE:
        for p in wk + months:
            get(f"{p}/{sid}/{did}/mapsAWCOpen_AWCData.json", f"sample/{p}/{sid}/{did}.json", 0.3, "sample")
        for ind in ["mapsSNPDistributed", "mapsMorningSnacks", "mapsAWCAttended"]:
            get(f"2026/10/{sid}/{did}/{ind}_AWCData.json", f"sample/2026/10/{sid}/{did}_{ind}.json", 0.3, "sample")


def stage_country():
    periods = ARG.get("periods", ["2026/20261102_20261108", "2026/10", "2026/09", "2026/08"])
    workers = int(ARG.get("workers", 6))
    dists = []
    for sid in state_ids():
        s, raw, _ = get(f"{periods[0]}/{sid}/mapsAWCOpen.json", None, 0.2, "country-state")
        for d in (js(raw) or {}).get("data", []):
            dists.append((sid, d["district_id"], d.get("district_name"), d.get("state_name"),
                          int(d.get("count_awc_ids") or 0), int(d.get("no_of_days_opens") or 0)))
    (OUT / "country").mkdir(parents=True, exist_ok=True)
    (OUT / "country" / "districts.json").write_text(json.dumps(dists), encoding="utf-8")
    names: dict[str, list] = {}
    bench = []
    # harmlessness check: 30 files one at a time first, then the pool
    for pi, per in enumerate(periods):
        rows: list[tuple] = []
        sums: list[tuple] = []
        t0 = time.time()
        b0 = sum(r["wire"] for r in LOG)
        n0 = len(LOG)

        def one(d):
            sid, did = d[0], d[1]
            for attempt in range(3):
                s, raw, _ = get(f"{per}/{sid}/{did}/mapsAWCOpen_AWCData.json", None, 0.0, f"country:{per}")
                if s == 200:
                    break
                time.sleep(2 + 3 * attempt)
            j = js(raw) if s == 200 else None
            out = []
            for c in centres(j or {}):
                out.append((sid, did, c["_p"], c["_s"], c["awc_code"], c.get("awc_id"),
                            int(c.get("no_of_days_opens") or 0), c.get("awc_name", "")))
            return d, s, out
        seq = dists[:30] if pi == 0 else []
        rest = dists[30:] if pi == 0 else dists
        for d in seq:
            res = one(d)
            rows += res[2]
            sums.append((d[0], d[1], res[1], len(res[2]), sum(x[6] for x in res[2]), d[4], d[5]))
        t_seq = time.time() - t0
        with cf.ThreadPoolExecutor(max_workers=workers) as ex:
            for d, s, out in ex.map(one, rest):
                rows += out
                sums.append((d[0], d[1], s, len(out), sum(x[6] for x in out), d[4], d[5]))
        secs = time.time() - t0
        mine = LOG[n0:]
        ok = sum(r["status"] == 200 for r in mine)
        bench.append({"period": per, "files": len(dists), "requests": len(mine), "ok": ok,
                      "errors": sorted({r["status"] for r in mine if r["status"] != 200}),
                      "seconds": round(secs, 1), "seq30_seconds": round(t_seq, 1),
                      "seq30_median": statistics.median([r["seconds"] for r in mine[:30]]) if pi == 0 else None,
                      "pool_median": statistics.median([r["seconds"] for r in mine[30 if pi == 0 else 0:]] or [0]),
                      "wire_bytes": sum(r["wire"] for r in LOG) - b0, "raw_bytes": sum(r["bytes"] for r in mine),
                      "workers": workers, "centres": len(rows)})
        print(json.dumps(bench[-1]), flush=True)
        fn = OUT / "country" / (per.replace("/", "_") + ".csv.gz")
        with gzip.open(fn, "wt", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["state_id", "district_id", "project_id", "sector_id", "awc_code", "awc_id", "days"])
            for r in rows:
                w.writerow(r[:7])
                names.setdefault(r[4], [r[7], r[0], r[1], r[2], r[3]])
        with open(OUT / "country" / (per.replace("/", "_") + "_districts.json"), "w", encoding="utf-8") as f:
            json.dump(sums, f)
    with gzip.open(OUT / "country" / "names.csv.gz", "wt", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["awc_code", "awc_name", "state_id", "district_id", "project_id", "sector_id"])
        for k, v in names.items():
            w.writerow([k] + v)
    (OUT / "country" / "bench.json").write_text(json.dumps(bench, indent=1), encoding="utf-8")


def stage_again():
    for sid, did in SAMPLE[:4]:
        get(f"{W46}/{sid}/{did}/mapsAWCOpen_AWCData.json", f"again/{W46}/{sid}/{did}.json", 0.3, "again")
    for sid in (1, 17, 24):
        get(f"{W46}/{sid}/mapsAWCOpen_ProjectData.json", f"again/{W46}/{sid}/project.json", 0.3, "again")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    stages = os.environ.get("STAGE") or PLAN.get("stage", "")
    for st in [s.strip() for s in stages.split(",") if s.strip()]:
        print("== stage", st, time.strftime("%H:%M:%S"), flush=True)
        {"snap": stage_snap, "sample": stage_sample, "country": stage_country, "again": stage_again}[st]()
    (OUT / "requests.json").write_text(json.dumps(LOG), encoding="utf-8")
    ok = sum(r["status"] == 200 for r in LOG)
    print(f"requests {len(LOG)}, 200s {ok}", flush=True)
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a", encoding="utf-8") as s:
        s.write(f"reopen: {len(LOG)} requests, {ok} answered 200\n")


if __name__ == "__main__":
    sys.exit(main())
