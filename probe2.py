"""Throwaway probe 2: AP STMS Works bills read through the Indian pool built on the runner.

GET the Bills page, district postback, mandal postback, then up to PER_MANDAL schools, each one POST.
Payee names (column 4) and bill numbers (column 5) are dropped before anything is written.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import sys
import time
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import probe as P  # noqa: E402

egress = P.egress
egress.NET.DEFAULT_HEADERS.update({"Content-Type": "application/x-www-form-urlencoded",
                                   "Accept": "text/html,*/*",
                                   "Origin": "https://schoolinfra.ap.gov.in",
                                   "Referer": P.BASE + "ViewExpenditure.aspx"})
URL = P.BASE + "ViewExpenditure.aspx"
K = P.K
DEADLINE = time.time() + 42 * 60
PER_MANDAL = 12
WORKERS = 4
LOG = []
POOL = egress.open_pool("india", reload_every=0)


def req(fields=None):
    if time.time() > DEADLINE:
        return -9, ""
    t0 = time.time()
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    st, body = egress.fetch(POOL, URL, data=data, method="POST" if data else "GET", timeout=60,
                            deadline=min(DEADLINE, time.time() + 180))
    LOG.append({"utc": time.strftime("%H:%M:%S", time.gmtime(t0)), "post": bool(data), "status": st,
                "bytes": len(body), "s": round(time.time() - t0, 1)})
    return st, body.decode("utf-8", "replace")


def school(page, dist, mandal, code):
    st, q = req(P.form(page, **{"__EVENTTARGET": "", "__EVENTARGUMENT": "", K + "ddlSchool": code,
                                K + "ddlPhase": "II", K + "btn_submit": "GO"}))
    head, rows = P.bills_table(q)
    return code, {"district": dist, "mandal": mandal, "status": st, "nodata": "There is no Data" in q,
                  "redirected": "Default.aspx" in q[:3000] and not head,
                  "head": [h for i, h in enumerate(head or []) if i not in (3, 4)],
                  "rows": [[c for i, c in enumerate(r) if i not in (3, 4)] for r in rows]}


def main():
    out = HERE / "out"
    out.mkdir(exist_ok=True)
    st, p0 = req()
    dists = [(v, t) for v, t in P.options(p0, K + "ddlDistrict") if v != "-1"]
    res, mand = {}, []
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        for i, (dv, dt) in enumerate(dists):
            if time.time() > DEADLINE:
                break
            st, p = req(P.form(p0, **{"__EVENTTARGET": K + "ddlDistrict", "__EVENTARGUMENT": "",
                                      K + "ddlDistrict": dv, K + "ddlPhase": "II"}))
            ms = [(v, t) for v, t in P.options(p, K + "ddlMandal") if v != "-1"]
            if not ms:
                mand.append({"district": dt, "error": f"no mandals ({st})"})
                continue
            mv, mt = ms[i % len(ms)]
            st, p = req(P.form(p, **{"__EVENTTARGET": K + "ddlMandal", "__EVENTARGUMENT": "",
                                     K + "ddlMandal": mv, K + "ddlPhase": "II"}))
            codes = [v for v, t in P.options(p, K + "ddlSchool") if v != "-1"]
            pick = codes[:: max(1, len(codes) // PER_MANDAL)][:PER_MANDAL]
            for code, r in ex.map(lambda c: school(p, dt, mt, c), pick):
                res[code] = r
            mand.append({"district": dt, "mandal": mt, "schools_in_mandal": len(codes), "read": len(pick)})
            print(json.dumps(mand[-1]), flush=True)
    (out / "bills2.json").write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    sc = {}
    for x in LOG:
        sc[str(x["status"])] = sc.get(str(x["status"]), 0) + 1
    summ = {"mandals": mand, "requests": len(LOG), "status_counts": sc,
            "median_s": sorted(x["s"] for x in LOG)[len(LOG) // 2] if LOG else None,
            "schools_with_rows": sum(1 for v in res.values() if v["rows"]),
            "bills": sum(len(v["rows"]) for v in res.values())}
    (out / "summary2.json").write_text(json.dumps(summ, indent=1, ensure_ascii=False), encoding="utf-8")
    (out / "log2.json").write_text(json.dumps(LOG), encoding="utf-8")
    print(json.dumps({k: v for k, v in summ.items() if k != "mandals"}))


if __name__ == "__main__":
    main()
