"""Read MPLADS eSAKSHI's public work lists on this runner, gently, and record what came back.

One request at a time, PAUSE seconds apart. TLS verified. Names of MPs and of district officers are
not written to disk. Writes out/mplads_summary.json and out/mplads_<house>_<tenure>.jsonl.gz.
"""
from __future__ import annotations

import gzip
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CTX = ssl.create_default_context()
PAUSE = float(os.environ.get("PAUSE", "1.0"))
CAP = int(os.environ.get("CAP", "420"))
BASE = "https://mplads.mospi.gov.in"
EP = BASE + "/rest/PreLoginDashboardData/"
STATES = [35, 2, 3, 5, 6, 7, 8, 11, 12, 27, 14, 15, 16, 17, 18, 36, 130, 19, 20, 21, 22, 23, 13, 24, 25, 26, 1, 28,
          29, 30, 129, 10, 31, 33, 32, 34]
SETS = [("2", "7"), ("1", "1"), ("2", "5"), ("1", "2")]  # (house, tenure): LS 18th, RS sitting, LS 17th, RS retired
KEYS = ["Works Recommended", "Works Completed"]
DROP = {"MP_NAME", "IDA_NAME", "TENURE_START_DATE", "TENURE_END_DATE", "Sno"}
N = 0
LOG = []
T_END = time.time() + 48 * 60


def post(path: str, body: dict, timeout: float = 240) -> tuple[int, bytes, float]:
    global N
    if N >= CAP:
        return -9, b"cap reached", 0.0
    N += 1
    h = {"User-Agent": UA, "Accept": "application/json, text/plain, */*", "Accept-Encoding": "gzip",
         "Content-Type": "application/json", "Origin": BASE, "Referer": BASE + "/digigov/dashboard.html"}
    t0 = time.time()
    try:
        req = urllib.request.Request(EP + path, data=json.dumps(body).encode(), headers=h, method="POST")
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
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


def records(raw: bytes) -> list[dict] | None:
    try:
        j = json.loads(raw)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(j, dict):
        return None
    out = []
    for v in j.values():
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except Exception:  # noqa: BLE001
                continue
        if isinstance(v, list):
            out.extend(x for x in v if isinstance(x, dict))
    return out


def note(name: str, status: int, raw: bytes, secs: float, **kw) -> None:
    LOG.append({"name": name, "status": status, "bytes": len(raw), "seconds": secs,
                "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "head": "" if status == 200 and kw.get("n") else raw[:120].decode("utf-8", "replace")} | kw)
    print(f"{status:>4} {len(raw):>11,} {secs:>7}s  {name}  {kw.get('n', '')}", flush=True)
    (OUT / "mplads_summary.json").write_text(json.dumps({"requests": N, "log": LOG}, indent=1), encoding="utf-8")


def main() -> None:
    s, raw, t = post("getStateData", {})
    note("getStateData", s, raw, t)
    (OUT / "mplads_raw_states.json").write_bytes(raw[:200000])
    s, raw, t = post("getTilesData", {"uname": "0,0,0,2,7"})
    note("tiles_all_ls18", s, raw, t)
    (OUT / "mplads_raw_tiles_all_ls18.json").write_bytes(raw)
    s, raw, t = post("getTilesData", {"uname": "0,0,0,1,1"})
    note("tiles_all_rs_sitting", s, raw, t)
    (OUT / "mplads_raw_tiles_all_rs.json").write_bytes(raw)
    # one small State kept raw, all three lists, for field-by-field checks (names removed)
    for key in ["Works Recommended", "Works Sanctioned", "Works Completed"]:
        s, raw, t = post("getTilesReportData", {"combo": "15,0,0,2,7", "key": key})
        r = records(raw)
        note(f"hp_ls18_{key}", s, raw, t, n=len(r) if r is not None else None)
        if r is not None:
            for x in r:
                for k in DROP:
                    x.pop(k, None)
            (OUT / f"mplads_hp_ls18_{key.replace(' ', '_')}.json").write_text(json.dumps(r, indent=0), encoding="utf-8")
    for house, tenure in SETS:
        with gzip.open(OUT / f"mplads_{house}_{tenure}.jsonl.gz", "wt", encoding="utf-8") as fh:
            for st in STATES:
                if time.time() > T_END:
                    note(f"stopped_{house}_{tenure}_{st}", -8, b"out of time", 0)
                    return
                for key in KEYS:
                    body = {"combo": f"{st},0,0,{house},{tenure}", "key": key}
                    s, raw, t = post("getTilesReportData", body)
                    r = records(raw)
                    if r is None and s not in (-9,):
                        time.sleep(6)
                        s, raw, t = post("getTilesReportData", body)
                        r = records(raw)
                    note(f"{house}_{tenure}_{st}_{key.split()[1]}", s, raw, t, n=len(r) if r is not None else None)
                    for x in r or []:
                        for k in DROP:
                            x.pop(k, None)
                        x["_list"] = key.split()[1]
                        x["_st"] = st
                        fh.write(json.dumps(x, ensure_ascii=False) + "\n")
    # benchmark: the whole country in one call
    s, raw, t = post("getTilesReportData", {"combo": "0,0,0,2,7", "key": "Works Completed"}, 400)
    r = records(raw)
    note("all_india_ls18_Completed_one_call", s, raw, t, n=len(r) if r is not None else None)
    note("end", 200, b"", 0)


if __name__ == "__main__":
    try:
        main()
    finally:
        (OUT / "mplads_summary.json").write_text(json.dumps({"requests": N, "log": LOG}, indent=1), encoding="utf-8")
        sys.stdout.flush()
