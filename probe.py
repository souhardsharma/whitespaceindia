"""Throwaway probe 2: Madhya Pradesh GFMS public list of vacant posts open to guest teachers
("atithi shikshak hetu sambhavit riktiyan"), read school by school through its own JSON call,
and a third read of the Chhattisgarh sanctioned-post export.

Only reads public pages. Never reads the joined-guest-teacher report (it carries names and phone
numbers). TLS verified on every request. Everything read is written to out/ and uploaded.
"""
from __future__ import annotations

import concurrent.futures as cf
import gzip
import hashlib
import html
import http.cookiejar
import json
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
B = "https://gfms.educationportal3.in"
LOG: list[dict] = []
T_START = time.time()
BUDGET = 70 * 60


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
        st, raw = -1, f"{type(e).__name__}: {e}".encode()
    return st, raw, time.time() - t


def note(kind, url, st, raw, secs, **kw):
    LOG.append({"kind": kind, "url": url, "status": st, "bytes": len(raw), "s": round(secs, 2),
                "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "sha": hashlib.sha256(raw).hexdigest()[:16]} | kw)


def vac(op, d, b, p, t, phase):
    q = f"DistrictId={d}&BlockId={b}&SankulId=0&panelId={p}&VacancyType={t}&UdiseCode="
    url = f"{B}/TrnPublicVacancyInfo/GetPublishLongShortVaccancyInfo?{q}"
    st, raw, s = send(op, url, data=b"", headers={"Content-Type": "application/x-www-form-urlencoded"})
    rows = []
    if st == 200:
        try:
            j = json.loads(raw)
            if j.get("status") == 1:
                rows = json.loads(j["data"])
        except Exception:  # noqa: BLE001
            st = -2
    note("vac", url, st, raw, s, d=d, b=b, p=p, t=t, phase=phase, n=len(rows))
    return st, [r | {"_d": d, "_b": b, "_p": p, "_t": t} for r in rows]


def left():
    return BUDGET - (time.time() - T_START)


def mp():
    op = opener()
    st, raw, s = send(op, f"{B}/TrnPublicVacancyInfo", headers={"X-Requested-With": ""})
    note("page", f"{B}/TrnPublicVacancyInfo", st, raw, s)
    (OUT / "mp_vacancy_page.html").write_bytes(raw)
    page = raw.decode("utf-8", "replace")
    m = re.search(r'id="ddlPanelId".*?</select>', page, re.S)
    panels = [(v, html.unescape(t).strip()) for v, t in re.findall(r'value="(\d+)"[^>]*>([^<]*)', m.group(0))] if m else []
    m = re.search(r'id="DistrictId".*?</select>', page, re.S)
    dists = [(v, t) for v, t in re.findall(r'value="(\d+)"[^>]*>([^<]*)', m.group(0))] if m else []
    print("panels", len(panels), "districts", len(dists), flush=True)
    # A: DDO (block) offices for every district
    ddos = {}
    for d, name in dists:
        url = f"{B}/TrnPublicVacancyInfo/GetDDOOfficeByDistrictId?DistrictId={d}"
        st, raw, s = send(op, url)
        note("ddo", url, st, raw, s, d=d)
        try:
            ddos[d] = [x["DDOOfficeId"] for x in json.loads(raw)["msg"]]
        except Exception:  # noqa: BLE001
            ddos[d] = []
        time.sleep(1)
    (OUT / "mp_ddos.json").write_text(json.dumps({"districts": dists, "panels": panels, "ddos": ddos}, ensure_ascii=False, indent=0), encoding="utf-8")
    print("ddo offices", sum(len(v) for v in ddos.values()), flush=True)
    allrows = []
    # B1: Bhopal sequential, one a second (baseline)
    jobs = [("26", b, p, t) for b in ddos.get("26", []) for p, _ in panels for t in (1, 2)]
    t0 = time.time()
    for j in jobs:
        _, rows = vac(op, *j, phase="bhopal1")
        allrows += [r | {"_phase": "bhopal1"} for r in rows]
        time.sleep(1)
    print(f"bhopal1 {len(jobs)} req {time.time()-t0:.0f}s", flush=True)
    # B2: more districts, 4 workers (benchmark); stop when the budget runs low
    for d in ["51", "1", "44", "39", "2"]:
        if left() < 20 * 60:
            break
        jobs = [(d, b, p, t) for b in ddos.get(d, []) for p, _ in panels for t in (1, 2)]
        t0 = time.time()
        with cf.ThreadPoolExecutor(4) as ex:
            ops = [opener() for _ in range(4)]
            futs = [ex.submit(vac, ops[i % 4], *j, f"d{d}") for i, j in enumerate(jobs)]
            for f in futs:
                _, rows = f.result()
                allrows += [r | {"_phase": f"d{d}"} for r in rows]
        print(f"d{d} {len(jobs)} req {time.time()-t0:.0f}s", flush=True)
    # C: UDISE mode for 30 schools seen, to check it agrees with the block mode
    seen = []
    for r in allrows:
        if r["UdiseCode"] not in seen:
            seen.append(r["UdiseCode"])
    for u in seen[:30]:
        url = f"{B}/TrnPublicVacancyInfo/GetPublishLongShortVaccancyInfo?DistrictId=0&BlockId=0&SankulId=0&panelId=0&VacancyType=1&UdiseCode={u}"
        st, raw, s = send(op, url, data=b"", headers={"Content-Type": "application/x-www-form-urlencoded"})
        note("udise", url, st, raw, s, u=u)
        try:
            for r in json.loads(json.loads(raw)["data"]):
                allrows.append(r | {"_phase": "udise", "_u": u})
        except Exception:  # noqa: BLE001
            pass
        time.sleep(1)
    # D: Bhopal again at the end (intraday change)
    jobs = [("26", b, p, t) for b in ddos.get("26", []) for p, _ in panels for t in (1, 2)]
    for j in jobs:
        _, rows = vac(op, *j, phase="bhopal2")
        allrows += [r | {"_phase": "bhopal2"} for r in rows]
        time.sleep(1)
    (OUT / "mp_vac_rows.json").write_text(json.dumps(allrows, ensure_ascii=False), encoding="utf-8")


def cg():
    op = opener()
    url = "https://eduportal.cg.nic.in/SchoolReportPostWise.aspx"
    st, raw, s = send(op, url, headers={"X-Requested-With": ""})
    note("cg", url, st, raw, s)
    if st != 200:
        return
    page = raw.decode("utf-8", "replace")

    def fields(pg):
        f = {}
        for tag in re.findall(r"<input[^>]+>", pg, re.I):
            n = re.search(r'name="([^"]+)"', tag)
            ty = re.search(r'type="([^"]+)"', tag)
            v = re.search(r'value="([^"]*)"', tag)
            if n and (ty.group(1).lower() if ty else "text") not in ("submit", "image", "button", "checkbox", "radio"):
                f[n.group(1)] = html.unescape(v.group(1)) if v else ""
        return f
    P = "ctl00$ContentPlaceHolder1$"
    f = fields(page) | {P + "ddlDist": "2218", P + "Button1": "Show Report"}
    hd = {"Content-Type": "application/x-www-form-urlencoded", "Referer": url, "X-Requested-With": ""}
    st, raw, s = send(op, url, urllib.parse.urlencode(f).encode(), hd, 120)
    note("cg", url, st, raw, s, step="p1")
    if st != 200:
        return
    f = fields(raw.decode("utf-8", "replace")) | {P + "ddlDist": "2218", P + "ImageButton1.x": "8", P + "ImageButton1.y": "8"}
    st, raw, s = send(op, url, urllib.parse.urlencode(f).encode(), hd, 240)
    note("cg", url, st, raw, s, step="export")
    (OUT / "cg_post_2218_export1.bin").write_bytes(raw)
    st, raw, s = send(op, "https://eduportal.cg.nic.in/Uploaded_Record_Statistics.aspx", headers={"X-Requested-With": ""})
    note("cg", "Uploaded_Record_Statistics.aspx", st, raw, s)
    (OUT / "cg_recstats.html").write_bytes(raw)


if __name__ == "__main__":
    try:
        cg()
    except Exception as e:  # noqa: BLE001
        print("cg failed", e)
    try:
        mp()
    finally:
        (OUT / "log.json").write_text(json.dumps(LOG, indent=0), encoding="utf-8")
        ok = sum(1 for x in LOG if x["status"] == 200)
        print(f"requests {len(LOG)} ok {ok}", flush=True)
