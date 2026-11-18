"""Throwaway probe: Madhya Pradesh GFMS short-term (leave) vacancy list, re-read, and the
working-guest-teacher report reduced to counts in memory.

The working-guest-teacher report carries each guest teacher's name and mobile number. Its answer is
parsed in memory only; nothing is kept but school code, panel, vacancy type, joining type, counts and
any date-valued field. The raw answer is never written, printed or logged (only its byte length).
TLS verified on every request.
"""
from __future__ import annotations

import concurrent.futures as cf
import gzip
import hashlib
import http.cookiejar
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CTX = ssl.create_default_context()
B = "https://gfms.educationportal3.in"
MODE = os.environ.get("MODE", "sample")
LOG: list[dict] = []
T0 = time.time()
BUDGET = 105 * 60
SAMPLE = ["26", "51", "1", "44", "39", "2"]
ORDERS = ["2026-09-10_17-17-48", "2026-06-30_19-54-53", "2026-08-24_19-22-55", "2026-08-06_17-13-12"]
KEEP = ("PanelName", "VacancyTypeName", "JoiningType")
DATE_RE = re.compile(r"^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}([ T][\d:.]+)?$")


def opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
                                       urllib.request.HTTPSHandler(context=CTX))


def send(op, url, data=None, headers=None, timeout=60):
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip",
         "X-Requested-With": "XMLHttpRequest"} | (headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
    t = time.time()
    try:
        with op.open(req, timeout=timeout) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            st = r.status
    except urllib.error.HTTPError as e:
        st, raw = e.code, e.read()
    except Exception as e:  # noqa: BLE001
        st, raw = -1, f"{type(e).__name__}".encode()
    return st, raw, time.time() - t


def note(kind, url, st, raw, secs, keep_sha=True, **kw):
    LOG.append({"kind": kind, "url": url, "status": st, "bytes": len(raw), "s": round(secs, 2),
                "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
               | ({"sha": hashlib.sha256(raw).hexdigest()[:16]} if keep_sha else {}) | kw)


def vac(op, d, b, p, t, phase):
    url = (f"{B}/TrnPublicVacancyInfo/GetPublishLongShortVaccancyInfo?DistrictId={d}&BlockId={b}"
           f"&SankulId=0&panelId={p}&VacancyType={t}&UdiseCode=")
    for attempt in range(2):
        st, raw, s = send(op, url, data=b"", headers={"Content-Type": "application/x-www-form-urlencoded"})
        if st == 200:
            break
        time.sleep(3)
    rows = []
    if st == 200:
        try:
            j = json.loads(raw)
            if j.get("status") == 1:
                rows = json.loads(j["data"])
        except Exception:  # noqa: BLE001
            st = -2
    note("vac", url, st, raw, s, d=d, b=b, p=p, t=t, phase=phase, n=len(rows))
    return st, [{k: r.get(k) for k in ("UdiseCode", "Panel_Name", "ApplyStartDate", "ApplyEndDate", "VacantPost")}
                | {"_d": d, "_b": b, "_p": p, "_t": t, "_phase": phase} for r in rows]


def joined(op, udise):
    """Counts only. The answer holds names and mobile numbers: reduced here, never stored."""
    url = f"{B}/JoinedGuestFacultySchoolWiseReport/GetJoinedGuestSchoolWiseRpt?udiseCode={udise}"
    st, raw, s = send(op, url)
    out = {"u": udise, "status": st, "n": None, "groups": {}, "keys": [], "dates": []}
    if st == 200:
        try:
            j = json.loads(raw)
            out["sts"] = str(j.get("sts"))
            if str(j.get("sts")) == "1":
                recs = json.loads(j["msg"])
                out["n"] = len(recs)
                keys = set()
                for r in recs:
                    keys |= set(r.keys())
                    g = " | ".join(re.sub(r"\s+", " ", str(r.get(k, ""))).strip()[:40] for k in KEEP)
                    if re.search(r"\d{6,}|@", g):  # a stray number or address never leaves memory
                        g = "REDACTED"
                    out["groups"][g] = out["groups"].get(g, 0) + 1
                    for k, v in r.items():
                        if "date" in k.lower() and isinstance(v, str) and DATE_RE.match(v.strip()):
                            out["dates"].append([k, v.strip(), r.get("PanelName"), r.get("VacancyTypeName")])
                out["keys"] = sorted(keys)
            else:
                out["n"] = 0
        except Exception as e:  # noqa: BLE001
            out["err"] = type(e).__name__
    del raw
    note("joined", url, st, b"", s, keep_sha=False, u=udise, n=out["n"])
    return out


def left():
    return BUDGET - (time.time() - T0)


def orders():
    op = opener()
    for f in ORDERS:
        url = f"https://sederp.educationportal3.in//UploadFolder/GuestFacultyCircularOrder/GuestCircularOrderDoc{f}_.pdf"
        st, raw, s = send(op, url, headers={"X-Requested-With": ""}, timeout=90)
        note("order", url, st, raw, s)
        if st == 200 and raw[:4] == b"%PDF":
            (OUT / f"order_{f}.pdf").write_bytes(raw)
        time.sleep(1)


def main():
    meta = json.loads((HERE / "data" / "mp_ddos.json").read_text(encoding="utf-8"))
    panels = [p for p, _ in meta["panels"]]
    ddos = meta["ddos"]
    if MODE == "statewide":
        jobs = [(d, b, p, 2) for d in ddos for b in ddos[d] for p in panels]
        jobs += [(d, b, p, 1) for d in ddos for b in ddos[d] for p in panels]  # long-term after, if time allows
    else:
        jobs = [(d, b, p, t) for d in SAMPLE for b in ddos[d] for p in panels for t in (2, 1)]
    rows = []
    t0 = time.time()
    with cf.ThreadPoolExecutor(4) as ex:
        ops = [opener() for _ in range(4)]
        futs = []
        for i, j in enumerate(jobs):
            futs.append(ex.submit(lambda j=j, i=i: vac(ops[i % 4], *j, MODE) if left() > 25 * 60 else (0, [])))
        for f in futs:
            rows += f.result()[1]
    print(f"vacancy calls {sum(1 for x in LOG if x['kind']=='vac')} rows {len(rows)} in {time.time()-t0:.0f}s", flush=True)
    (OUT / "vac_rows.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    # joined-teacher counts for every school with a listed row (short-term first), plus the run2 schools
    prev = json.loads((HERE / "data" / "prev_schools.json").read_text(encoding="utf-8"))
    schools = []
    for r in sorted(rows, key=lambda r: r["_t"], reverse=True):
        if r["UdiseCode"] not in schools:
            schools.append(r["UdiseCode"])
    for u in prev:
        if u not in schools:
            schools.append(u)
    res = []
    with cf.ThreadPoolExecutor(2) as ex:
        ops = [opener(), opener()]
        futs = [ex.submit(lambda u=u, i=i: joined(ops[i % 2], u) if left() > 4 * 60 else None)
                for i, u in enumerate(schools)]
        for f in futs:
            r = f.result()
            if r:
                res.append(r)
    (OUT / "joined_counts.json").write_text(json.dumps(res, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"joined lookups {len(res)}", flush=True)


if __name__ == "__main__":
    try:
        orders()
    except Exception as e:  # noqa: BLE001
        print("orders failed", type(e).__name__)
    try:
        main()
    finally:
        (OUT / "log.json").write_text(json.dumps(LOG, indent=0), encoding="utf-8")
        print(f"mode {MODE} requests {len(LOG)} ok {sum(1 for x in LOG if x['status'] == 200)}", flush=True)
