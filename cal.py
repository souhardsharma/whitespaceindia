"""Calendar-year 2025 count of days recorded open, every anganwadi centre (read only, public CDN files).

Reads pt_maps_v2/2025/{01..12}/{state}/{district}/mapsAWCOpen_AWCData.json for every district each month's own
State files list, WORKERS (6) at a time, TLS verified. Records status, Last-Modified, ETag and a full sha256 for
every file. Centre NAMES ARE DROPPED HERE: the artifact holds codes, ids, days and counts only. The name scrub
(scrub.py) is applied on the runner and only its counts leave it.
Also reads 2026/{01..10} for twelve sample districts (rows without names).
"""
from __future__ import annotations

import collections
import concurrent.futures as cf
import csv
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
sys.path.insert(0, str(HERE))
from scrub import classify  # noqa: E402

OUT = HERE / "out"
BASE = "https://cdn.poshantracker.in/pt_maps_v2/"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CTX = ssl.create_default_context()
WORKERS = int(os.environ.get("WORKERS", "6"))
MONTHS = [f"2025/{m:02d}" for m in range(1, 13)]
SAMPLE = [(1, 383), (17, 126), (24, 643), (24, 638), (22, 242), (14, 917), (14, 49), (21, 213), (23, 270),
          (29, 708), (35, 596), (17, 114)]
LOG: list[dict] = []
LOCK = threading.Lock()
# the sceptic's patterns, for a like-for-like count
PHONE_S = re.compile(r"(?<!\d)[6-9]\d{9}(?!\d)")
HOUSE_S = re.compile(r"\b(house|ghar|home|niwas|nivas|residence|makan|bhawan of|near house|h/o|c/o|w/o|s/o|d/o)\b", re.I)


def get(path: str, tag: str):
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
        raw, status, h = b"", e.code, dict(e.headers or {})
    except Exception as e:  # noqa: BLE001
        raw, status, h = f"{type(e).__name__}".encode(), -1, {}
    row = {"path": path, "status": status, "bytes": len(raw), "wire": wire, "seconds": round(time.time() - t0, 3),
           "tag": tag, "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
           "last_modified": h.get("Last-Modified", ""), "etag": h.get("ETag", ""), "x_cache": h.get("X-Cache", ""),
           "pop": h.get("X-Amz-Cf-Pop", ""), "sha256": hashlib.sha256(raw).hexdigest() if status == 200 else ""}
    with LOCK:
        LOG.append(row)
    return status, raw


def get_retry(path, tag, tries=3):
    for a in range(tries):
        s, raw = get(path, tag)
        if s == 200 or s in (403, 404):
            return s, raw
        time.sleep(2 + 3 * a)
    return s, raw


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


def districts_of(per: str):
    s, raw = get_retry(f"{per}/mapsAWCOpen.json", "list")
    states = [st["state_id"] for st in (js(raw) or {}).get("data", [])]
    out = []
    for sid in states:
        s, raw = get_retry(f"{per}/{sid}/mapsAWCOpen.json", "list")
        for d in (js(raw) or {}).get("data", []):
            out.append({"state_id": sid, "district_id": d["district_id"], "state_name": d.get("state_name"),
                        "district_name": d.get("district_name"), "awc": int(d.get("count_awc_ids") or 0),
                        "days": int(d.get("no_of_days_opens") or 0)})
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cen: dict[int, dict] = {}            # awc_id -> record
    dup = collections.Counter()           # same awc_id twice in one month
    noid = collections.Counter()
    scrub_c = collections.Counter()
    scrub_r = collections.Counter()
    scrub_state = collections.defaultdict(collections.Counter)
    sceptic_c = collections.Counter()
    seen_name_keys: set = set()
    periods = []
    for mi, per in enumerate(MONTHS):
        t0 = time.time()
        n0 = len(LOG)
        dists = districts_of(per)
        sums = []

        def one(d):
            s, raw = get_retry(f"{per}/{d['state_id']}/{d['district_id']}/mapsAWCOpen_AWCData.json", f"awc:{per}")
            return d, s, centres(js(raw) or {}) if s == 200 else []
        with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for d, s, rows in ex.map(one, dists):
                seen_m = set()
                tot = 0
                for c in rows:
                    aid = c.get("awc_id")
                    days = int(c.get("no_of_days_opens") or 0)
                    tot += days
                    if aid is None:
                        noid[per] += 1
                        continue
                    aid = int(aid)
                    if aid in seen_m:
                        dup[per] += 1
                    seen_m.add(aid)
                    r = cen.get(aid)
                    if r is None:
                        r = cen[aid] = {"s": d["state_id"], "d": d["district_id"], "p": c["_p"], "sec": c["_s"],
                                        "code": c["awc_code"], "codes": {c["awc_code"]}, "m": [None] * 12,
                                        "dists": {(d["state_id"], d["district_id"])}}
                    r["m"][mi] = (r["m"][mi] or 0) + days
                    r["codes"].add(c["awc_code"])
                    r["code"] = c["awc_code"]
                    r["s"], r["d"], r["p"], r["sec"] = d["state_id"], d["district_id"], c["_p"], c["_s"]
                    r["dists"].add((d["state_id"], d["district_id"]))
                    # name: counted on the runner, never written out
                    nm = c.get("awc_name") or ""
                    key = (aid, nm)
                    if key not in seen_name_keys:
                        seen_name_keys.add(key)
                        k, rs = classify(nm, c["awc_code"])
                        scrub_c[k] += 1
                        scrub_state[d["state_id"]][k] += 1
                        for x in rs:
                            scrub_r[x] += 1
                        if PHONE_S.search(nm):
                            sceptic_c["phone_like_10_digit"] += 1
                            m = PHONE_S.search(nm).group(0)
                            sceptic_c["phone_like_inside_own_code" if m in c["awc_code"] else "phone_like_not_own_code"] += 1
                        if HOUSE_S.search(nm):
                            sceptic_c["house_or_relation_word"] += 1
                sums.append({**d, "status": s, "file_awc": len(rows), "file_days": tot})
        mine = LOG[n0:]
        periods.append({"period": per, "districts": len(dists), "requests": len(mine),
                        "ok": sum(r["status"] == 200 for r in mine),
                        "errors": collections.Counter(str(r["status"]) for r in mine if r["status"] != 200),
                        "seconds": round(time.time() - t0, 1), "wire_bytes": sum(r["wire"] for r in mine),
                        "median_latency": statistics.median([r["seconds"] for r in mine] or [0]),
                        "centres": sum(x["file_awc"] for x in sums), "days": sum(x["file_days"] for x in sums)})
        print(json.dumps(periods[-1]), flush=True)
        (OUT / f"districts_{per.replace('/', '_')}.json").write_text(json.dumps(sums), encoding="utf-8")
    seen_name_keys.clear()
    # centre rows, no names
    with gzip.open(OUT / "centres_2025.csv.gz", "wt", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["awc_id", "state_id", "district_id", "project_id", "sector_id", "awc_code_last", "n_codes",
                    "n_districts"] + [f"m{m:02d}" for m in range(1, 13)])
        for aid, r in cen.items():
            w.writerow([aid, r["s"], r["d"], r["p"], r["sec"], r["code"], len(r["codes"]), len(r["dists"])] +
                       ["" if v is None else v for v in r["m"]])
    (OUT / "scrub_counts.json").write_text(json.dumps({
        "unit": "distinct (awc_id, name) pairs seen in the twelve 2025 monthly files",
        "classes": scrub_c, "reasons": scrub_r, "by_state": scrub_state, "sceptic_patterns": sceptic_c,
        "dup_awc_id_in_month": dup, "rows_without_awc_id": noid}, indent=1), encoding="utf-8")
    (OUT / "periods.json").write_text(json.dumps(periods, indent=1), encoding="utf-8")
    # sample districts, 2026 Jan-Oct, rows without names
    with gzip.open(OUT / "sample_2026.csv.gz", "wt", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["period", "state_id", "district_id", "project_id", "sector_id", "awc_code", "awc_id", "days"])
        for m in range(1, 11):
            per = f"2026/{m:02d}"
            for sid, did in SAMPLE:
                s, raw = get_retry(f"{per}/{sid}/{did}/mapsAWCOpen_AWCData.json", "sample2026")
                for c in centres(js(raw) or {}) if s == 200 else []:
                    w.writerow([per, sid, did, c["_p"], c["_s"], c["awc_code"], c.get("awc_id"),
                                int(c.get("no_of_days_opens") or 0)])
                time.sleep(0.2)
    (OUT / "requests.json").write_text(json.dumps(LOG), encoding="utf-8")
    ok = sum(r["status"] == 200 for r in LOG)
    msg = f"cal2025: {len(LOG)} requests, {ok} answered 200, centres {len(cen)}"
    print(msg, flush=True)
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a", encoding="utf-8") as s:
        s.write(msg + "\n")


if __name__ == "__main__":
    sys.exit(main())
