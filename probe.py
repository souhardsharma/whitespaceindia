"""Throwaway probe: reads Andhra Pradesh STMS Works public reports from a GitHub runner.

Reads only. One connection, one request at a time, PAUSE seconds apart, hard cap MAX_REQ requests.
Bills: one school per POST (the page serves nothing for "All"). Payee names (column 4) are dropped
before anything is written. Physical progress (R2.1): district > mandal > school drill by postback.
"""
from __future__ import annotations

import gzip
import html
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
sys.path.insert(0, str(HERE / "scripts" / "education"))
import egress  # noqa: E402

CTX = egress.NET.TLS
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
BASE = "https://schoolinfra.ap.gov.in/stmsworks/Dashboard/"
K = "ctl00$ContentPlaceHolder1$"
PAUSE = float(os.environ.get("PAUSE", "1.0"))
MAX_REQ = int(os.environ.get("MAX_REQ", "560"))
DEADLINE = time.time() + 60 * float(os.environ.get("MINUTES", "45"))
MANDALS = [("Annamayya", 0), ("Srikakulam", 3), ("Kurnool", 5), ("Guntur", 2), ("Eluru", 7),
           ("Tirupati", 4), ("Alluri Sitharama Raju", 1), ("Prakasam", 6), ("NTR", 3), ("Visakhapatnam", 2)]
LOG = []
N = 0


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),
                                       urllib.request.HTTPSHandler(context=CTX))


def send(op, url, fields=None, timeout=90):
    global N
    if N >= MAX_REQ or time.time() > DEADLINE:
        raise RuntimeError("budget")
    N += 1
    egress.ensure_chain(url, [None])
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    h = {"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Encoding": "gzip", "Referer": url}
    if data:
        h["Content-Type"] = "application/x-www-form-urlencoded"
    t0 = time.time()
    try:
        with op.open(urllib.request.Request(url, data=data, headers=h), timeout=timeout) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            st = r.status
    except urllib.error.HTTPError as e:
        st, raw = e.code, e.read()
    except Exception as e:  # noqa: BLE001
        st, raw = -1, f"{type(e).__name__}: {e}".encode()
    LOG.append({"utc": time.strftime("%H:%M:%S", time.gmtime(t0)), "url": url.split("/")[-1], "post": bool(data),
                "status": st, "bytes": len(raw), "s": round(time.time() - t0, 2)})
    time.sleep(PAUSE)
    return st, raw.decode("utf-8", "replace")


def hidden(page):
    out = {}
    for tag in re.findall(r"<input[^>]*type=\"hidden\"[^>]*>", page, flags=re.I):
        n = re.search(r'name="([^"]+)"', tag)
        v = re.search(r'value="([^"]*)"', tag)
        if n:
            out[html.unescape(n.group(1))] = html.unescape(v.group(1)) if v else ""
    return out


def selects(page):
    """All current select values (selected option or first), as the browser would post them."""
    out = {}
    for name, body in re.findall(r'<select[^>]*name="([^"]+)"[^>]*>(.*?)</select>', page, flags=re.S | re.I):
        opts = re.findall(r'<option([^>]*)value="([^"]*)"[^>]*>', body, flags=re.I)
        sel = [v for a, v in opts if "selected" in a.lower()]
        out[html.unescape(name)] = sel[0] if sel else (opts[0][1] if opts else "")
    return out


def options(page, name):
    m = re.search(r'<select[^>]*name="%s"[^>]*>(.*?)</select>' % re.escape(name), page, flags=re.S | re.I)
    if not m:
        return []
    return [(v, html.unescape(re.sub(r"<[^>]+>|\s+", " ", t)).strip())
            for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(1), flags=re.S | re.I)]


def form(page, **mods):
    f = hidden(page) | selects(page)
    f.update(mods)
    return f


def cells(row):
    return [html.unescape(re.sub(r"<[^>]+>|\s+", " ", c)).strip()
            for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, flags=re.S | re.I)]


def tables(page):
    return [[cells(r) for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, flags=re.S | re.I)]
            for t in re.findall(r"<table[^>]*>(.*?)</table>", page, flags=re.S | re.I)]


def bills_table(page):
    for t in tables(page):
        for i, r in enumerate(t):
            if any(c == "Bill Date" for c in r):
                return r, [x for x in t[i + 1:] if len(x) == len(r)]
    return None, []


def read_bills(op, dist, midx, res):
    url = BASE + "ViewExpenditure.aspx"
    st, p = send(op, url)
    if st != 200:
        return {"error": f"GET {st}"}
    dv = next((v for v, t in options(p, K + "ddlDistrict") if dist.lower() in t.lower()), None)
    st, p = send(op, url, form(p, **{"__EVENTTARGET": K + "ddlDistrict", "__EVENTARGUMENT": "",
                                      K + "ddlDistrict": dv, K + "ddlPhase": "II"}))
    ms = [(v, t) for v, t in options(p, K + "ddlMandal") if v != "-1"]
    if not ms:
        return {"error": "no mandals"}
    mv, mt = ms[midx % len(ms)]
    st, p = send(op, url, form(p, **{"__EVENTTARGET": K + "ddlMandal", "__EVENTARGUMENT": "",
                                      K + "ddlMandal": mv, K + "ddlPhase": "II"}))
    schools = [(v, t) for v, t in options(p, K + "ddlSchool") if v != "-1"]
    info = {"district": dist, "mandal": mt, "mandal_code": mv, "schools": len(schools), "read": 0}
    for code, name in schools:
        f = form(p, **{"__EVENTTARGET": "", "__EVENTARGUMENT": "", K + "ddlSchool": code,
                       K + "ddlPhase": "II", K + "btn_submit": "GO"})
        st, q = send(op, url, f)
        head, rows = bills_table(q)
        nodata = "There is no Data" in q
        res[code] = {"name": name, "mandal": mt, "district": dist, "status": st, "nodata": nodata,
                     "head": [h for i, h in enumerate(head or []) if i != 3],
                     "rows": [[c for i, c in enumerate(r) if i != 3] for r in rows]}
        info["read"] += 1
    return info


def find_link(page, grid, text):
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, flags=re.S | re.I):
        m = re.search(r"__doPostBack\(&#39;([^&]+)&#39;|__doPostBack\('([^']+)'", tr)
        if m and grid in (m.group(1) or m.group(2)) and text.lower() in html.unescape(
                re.sub(r"<[^>]+>|\s+", " ", tr)).lower():
            return m.group(1) or m.group(2)
    return None


def read_progress(op, dist, mandal):
    url = BASE + "STMS_Projectsprogress.aspx"
    st, p = send(op, url)
    if st != 200:
        return {"error": f"GET {st}"}
    tgt = find_link(p, "gv_Dis_G", dist)
    st, p = send(op, url, form(p, __EVENTTARGET=tgt, __EVENTARGUMENT=""))
    tgt = find_link(p, "gv_Dis_G", mandal)
    if not tgt:
        return {"error": "mandal link not found", "tables": tables(p)[-1][:3] if tables(p) else []}
    st, p = send(op, url, form(p, __EVENTTARGET=tgt, __EVENTARGUMENT=""))
    t = max(tables(p), key=len) if tables(p) else []
    return {"district": dist, "mandal": mandal, "rows": t}


def main():
    OUT.mkdir(exist_ok=True)
    summary = {"start": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    op = opener()
    for name in ["Glance_Report.aspx", "Schools_Pendency_Report.aspx", "STMS_Projectsprogress.aspx"]:
        st, p = send(op, BASE + name)
        (OUT / name.replace(".aspx", ".html")).write_text(p, encoding="utf-8")
        summary[name] = st
    # Indian pool: three GETs of the public pages (reachability only)
    try:
        pool = egress.open_pool("india", reload_every=0)
        pr = []
        for name in ["Glance_Report.aspx", "ViewExpenditure.aspx", "Glance_Report.aspx"]:
            t0 = time.time()
            st, body = egress.fetch(pool, BASE + name, timeout=60, deadline=time.time() + 150)
            pr.append({"page": name, "status": st, "bytes": len(body), "s": round(time.time() - t0, 1),
                       "head": body[:120].decode("utf-8", "replace")})
            if st == 200:
                (OUT / ("pool_" + name.replace(".aspx", ".html"))).write_bytes(body)
        summary["india_pool"] = pr
        print(json.dumps(pr), flush=True)
    except Exception as e:  # noqa: BLE001
        summary["india_pool"] = f"{type(e).__name__}: {e}"
    if summary["Glance_Report.aspx"] != 200:
        MANDALS[:] = MANDALS[:1]
    bills, mandals, prog = {}, [], []
    try:
        for dist, midx in MANDALS:
            info = read_bills(opener(), dist, midx, bills)
            mandals.append(info)
            print(json.dumps(info), flush=True)
            if "mandal" in info:
                prog.append(read_progress(opener(), dist, info["mandal"]))
    except RuntimeError as e:
        summary["stopped"] = str(e)
    summary.update({"end": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "requests": N,
                    "mandals": mandals, "schools_read": len(bills),
                    "status_counts": {}, "latency_s": sorted(x["s"] for x in LOG)[len(LOG) // 2] if LOG else None})
    for x in LOG:
        summary["status_counts"][str(x["status"])] = summary["status_counts"].get(str(x["status"]), 0) + 1
    (OUT / "bills.json").write_text(json.dumps(bills, ensure_ascii=False), encoding="utf-8")
    (OUT / "progress.json").write_text(json.dumps(prog, ensure_ascii=False), encoding="utf-8")
    (OUT / "log.json").write_text(json.dumps(LOG), encoding="utf-8")
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "mandals"}, indent=1))


if __name__ == "__main__":
    main()
