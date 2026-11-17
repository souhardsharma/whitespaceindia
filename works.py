"""Read school-work assets from GeoMGNREGA (Bhuvan) on this runner, gently, and record what came back.

One request at a time, at least PAUSE seconds apart per host. TLS is verified on every request.
Writes out/summary.json, out/recent.jsonl, out/history_<st>.jsonl, out/details.jsonl, out/raw_*.
The moderator's user name on a detail page is removed before anything is saved.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CTX = ssl.create_default_context()
PAUSE = float(os.environ.get("PAUSE", "1.0"))
CAP = int(os.environ.get("CAP", "560"))
APP = "https://bhuvan-app2.nrsc.gov.in"
VEC = "https://bhuvan-vec3.nrsc.gov.in/bhuvan/wms"
SCH = ["1707", "17060", "17016", "17068", "17011", "0707", "17084", "17114", "17098", "17117", "17150",
       "17151", "0403", "04010", "0415", "0601", "17052", "17018", "17086", "17116"]
SCH_SQL = "(" + ",".join("'%s'" % s for s in SCH) + ")"
SINCE = "2026-10-01T00:00:00Z"
COUNT = {}
LOG = []
T_END = time.time() + 50 * 60


def get(url: str, timeout: float = 90, referer: str | None = None) -> tuple[int, bytes, float]:
    host = urllib.parse.urlsplit(url).netloc
    if COUNT.get(host, 0) >= CAP:
        return -9, b"cap reached", 0.0
    COUNT[host] = COUNT.get(host, 0) + 1
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"}
    if referer:
        h["Referer"] = referer
    t0 = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout, context=CTX) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            out = (r.status, raw)
    except urllib.error.HTTPError as e:
        out = (e.code, e.read())
    except Exception as e:  # noqa: BLE001
        out = (-1, f"{type(e).__name__}: {e}".encode())
    secs = round(time.time() - t0, 2)
    time.sleep(PAUSE)
    return out[0], out[1], secs


def gfi(cql: str, n: int, bbox: str = "68,6,98,37.5") -> str:
    q = {"SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetFeatureInfo", "LAYERS": "nrega:nrega_phase2_poly",
         "QUERY_LAYERS": "nrega:nrega_phase2_poly", "STYLES": "", "SRS": "EPSG:4326", "BBOX": bbox,
         "WIDTH": "101", "HEIGHT": "101", "X": "50", "Y": "50", "BUFFER": "60", "FEATURE_COUNT": str(n),
         "INFO_FORMAT": "application/json", "viewparams": "fyear:all", "CQL_FILTER": cql}
    return VEC + "?" + urllib.parse.urlencode(q)


def via_proxy(url: str) -> str:
    return APP + "/cgi-bin/proxy.cgi?url=" + urllib.parse.quote(url, safe="")


def note(name: str, status: int, raw: bytes, secs: float, **kw) -> dict:
    row = {"name": name, "status": status, "bytes": len(raw), "seconds": secs,
           "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "head": raw[:140].decode("utf-8", "replace")} | kw
    LOG.append(row)
    print(f"{status:>4} {len(raw):>11,} {secs:>7}s  {name}  {kw.get('n', '')}", flush=True)
    (OUT / "summary.json").write_text(json.dumps({"count": COUNT, "log": LOG}, indent=1), encoding="utf-8")
    return row


def rows(raw: bytes) -> list[dict] | None:
    try:
        j = json.loads(raw)
    except Exception:  # noqa: BLE001
        return None
    out = []
    for f in j.get("features", []):
        p = f.get("properties", {})
        g = f.get("geometry") or {}
        c = g.get("coordinates") or []
        while c and isinstance(c[0], list):
            c = c[0]
        out.append({"sid": p.get("sid"), "asset": p.get("asset_id"), "cat": p.get("category_id"),
                    "sub": p.get("subcategory_id"), "st": p.get("state_code"), "d": p.get("district_code"),
                    "b": p.get("block_code"), "gp": p.get("panchayat_code"), "wfy": p.get("work_financial_year"),
                    "cfy": p.get("completion_financial_year"), "ser": p.get("ser_time"), "stage": p.get("stage"),
                    "status": p.get("status"), "val": p.get("validated_timestamp"), "ft": p.get("feature_type"),
                    "geom": g.get("type"), "lon": c[0] if len(c) > 1 else None, "lat": c[1] if len(c) > 1 else None})
    return out


CELL = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S | re.I)
TAG = re.compile(r"<[^>]+>")


def parse_details(page: str) -> dict:
    cells = [re.sub(r"\s+", " ", TAG.sub(" ", c)).strip() for c in CELL.findall(page)]
    d = {}
    for i in range(0, len(cells) - 1):
        k = cells[i].rstrip(":").strip()
        if k and len(k) < 40 and k not in d and not k.lower().startswith("accepted"):
            d[k] = cells[i + 1]
    return d


def scrub(page: str) -> str:
    return re.sub(r"(Accepted\s*by)[^<]*", r"\1 [removed]", page, flags=re.I)


def main() -> None:
    # 1. reach
    s, raw, t = get(APP + "/bhugram/bhugram.php", 60)
    note("viewer", s, raw, t)
    small = gfi("state_code='13' and subcategory_id='17068' and status=1", 5)
    s, raw, t = get(via_proxy(small), 90, APP + "/bhugram/bhugram.php")
    note("gfi_proxy_small", s, raw, t, n=len(rows(raw) or []))
    (OUT / "raw_gfi_proxy_small.json").write_bytes(raw)
    proxy_ok = s == 200 and rows(raw) is not None
    s, raw, t = get(small, 90)
    note("gfi_direct_small", s, raw, t, n=len(rows(raw) or []))
    direct_ok = s == 200 and rows(raw) is not None
    wfs = ("https://bhuvan-vec3.nrsc.gov.in/bhuvan/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName="
           "nrega:nrega_phase2_poly&maxFeatures=3&outputFormat=application/json&viewparams=fyear:all&CQL_FILTER="
           + urllib.parse.quote("state_code='13' and subcategory_id='17068'"))
    s, raw, t = get(wfs if direct_ok else via_proxy(wfs), 90)
    note("wfs_test", s, raw, t)
    (OUT / "raw_wfs_test.txt").write_bytes(raw[:20000])
    cap = VEC + "?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities"
    s, raw, t = get(cap if direct_ok else via_proxy(cap), 180)
    names = sorted(set(re.findall(rb"<Name>([^<]{1,120})</Name>", raw)))
    want = [n.decode("utf-8", "replace") for n in names
            if re.search(rb"school|udise|mhrd|edu|sch_|anganwadi|aw[c_]|lgd|village|panch|habit|nrega|pmgsy", n, re.I)]
    note("wms_capabilities", s, raw, t, n=len(names))
    (OUT / "layers_all.txt").write_text("\n".join(n.decode("utf-8", "replace") for n in names), encoding="utf-8")
    (OUT / "layers_wanted.txt").write_text("\n".join(want), encoding="utf-8")
    if not (proxy_ok or direct_ok):
        note("stop", -1, b"neither route answered with features", 0)
        return
    wrap = via_proxy if proxy_ok else (lambda u: u)

    # 2. recent school-work assets, every State
    recent = []
    with open(OUT / "recent.jsonl", "w", encoding="utf-8") as fh:
        for st in ["%02d" % i for i in range(1, 39)]:
            cql = f"state_code='{st}' and subcategory_id in {SCH_SQL} and ser_time > '{SINCE}'"
            s, raw, t = get(wrap(gfi(cql, 20000)), 120)
            r = rows(raw)
            if r is None and s != -9:
                time.sleep(5)
                s, raw, t = get(wrap(gfi(cql, 20000)), 180)
                r = rows(raw)
            note(f"recent_{st}", s, raw, t, n=len(r) if r is not None else None)
            for x in r or []:
                fh.write(json.dumps(x) + "\n")
                recent.append(x)

    # 2b. the same count with no sub-category filter for one State, one week: is school work a sliver of the flow?
    s, raw, t = get(wrap(gfi("state_code='17' and ser_time > '2026-11-09T00:00:00Z'", 60000)), 180)
    r = rows(raw)
    note("mp_all_categories_since_1109", s, raw, t, n=len(r) if r is not None else None)
    # 2c. stages other than 3 for school works
    s, raw, t = get(wrap(gfi(f"state_code='17' and subcategory_id in {SCH_SQL} and stage in (1,2)", 2000)), 120)
    r = rows(raw)
    note("mp_school_stage_1_2", s, raw, t, n=len(r) if r is not None else None)

    # 3. details for recent assets, round-robin by State
    by = {}
    for x in sorted(recent, key=lambda x: x.get("ser") or "", reverse=True):
        by.setdefault(x["st"], []).append(x)
    order = []
    while any(by.values()) and len(order) < 330:
        for st in sorted(by):
            if by[st]:
                order.append(by[st].pop(0))
    raw_saved = 0
    with open(OUT / "details.jsonl", "w", encoding="utf-8") as fh:
        for x in order:
            if time.time() > T_END - 12 * 60:
                break
            u = (APP + "/bhugram/usrtasks/nrega_phase2/get/get_details.php?sno=%s&uname=empty&mode=nm&stage=all&block_code=%s"
                 % (x["sid"], x["b"]))
            s, raw, t = get(u, 60, APP + "/bhugram/bhugram.php")
            if s == -9:
                break
            page = scrub(raw.decode("utf-8", "replace"))
            d = parse_details(page) if s == 200 else {}
            fh.write(json.dumps({"sid": x["sid"], "status": s, "seconds": t, "row": x, "details": d}) + "\n")
            if raw_saved < 12 and s == 200:
                (OUT / f"raw_details_{x['sid']}.html").write_text(page, encoding="utf-8")
                raw_saved += 1
    note("details_done", 200, b"", 0, n=len(order))

    # 4. full history of school works, three States, by upload year
    for st in ("13", "17", "05"):
        with open(OUT / f"history_{st}.jsonl", "w", encoding="utf-8") as fh:
            for y in range(2017, 2027):
                if time.time() > T_END:
                    break
                cql = (f"state_code='{st}' and subcategory_id in {SCH_SQL} and ser_time >= '{y}-01-01T00:00:00Z' "
                       f"and ser_time < '{y + 1}-01-01T00:00:00Z'")
                s, raw, t = get(wrap(gfi(cql, 200000)), 240)
                r = rows(raw)
                note(f"history_{st}_{y}", s, raw, t, n=len(r) if r is not None else None)
                for x in r or []:
                    fh.write(json.dumps(x) + "\n")
    note("end", 200, b"", 0)


if __name__ == "__main__":
    try:
        main()
    finally:
        (OUT / "summary.json").write_text(json.dumps({"count": COUNT, "log": LOG}, indent=1), encoding="utf-8")
        sys.stdout.flush()
