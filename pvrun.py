"""Monthly return fields (food-grain buffer, funds) of schools on the meal host, from this runner.

Reads, one request at a time and 1.2 s apart, with a hard cap:
  /SchoolReporting/Index/<abbr>          page token and district list (public page)
  /SchoolReporting/GetBlocksByDisttJS    blocks of a district (POST, token)
  /SchoolReporting/GetClustersByBlocksJS clusters of a block
  /SchoolReporting/GetSchoolsByClusterJS schools of a cluster (institution names and codes)
  /SchoolReporting/GetSchoolDetailsPV    one school's panel: today's meals, this month's enrolment,
                                         Food Grain (buffer) Y/N, Funds Y/N, Last Inspection
  /Home/GetSchoolDailyReportingWithAttendanceJSON  one school's meals per day this month
The school panel also lists the reporting staff by name with masked phone numbers. Those lines are
never parsed out, kept or written: only the whitelisted fields below leave this script. No raw page
is written. TLS verified (default context). No login, no CAPTCHA.
Output: out/pv.json, out/log.json
"""
from __future__ import annotations

import html
import http.cookiejar
import json
import os
import random
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

NIC = "https://mdmhp.nic.in"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CAP = int(os.environ.get("PV_CAP", "820"))
SCH_PER_CLUSTER = int(os.environ.get("PV_SCH", "12"))
MONTHJSON_CAP = int(os.environ.get("PV_MONTH", "110"))
OUT = Path(__file__).resolve().parent / "out"
OUT.mkdir(exist_ok=True)
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
                                     urllib.request.HTTPSHandler(context=ssl.create_default_context()))
LOG, NEXT = [], [0.0]
FIELDS = ["School Category", "School Type", "MDM Served", "Student Attendance", "Teacher Attendance",
          "Food Grain", "Funds", "Aadhaar Enrollment", "Last Inspection"]
# State abbr, code, districts to read (names matched case-insensitively; None = spread), clusters per district
PLAN_ALL = [
    ("TR", "16", None, 8, 2),
    ("MP", "23", ["RATLAM", "REWA", "UMARIA", "DHAR", "NARSIMHAPUR", "KHARGONE", "SHEOPUR", "SAGAR", "BHOPAL", "JHABUA"], 0, 1),
    ("JK", "01", ["KUPWARA", "BARAMULLA", "ANANTNAG", "SRINAGAR", "BUDGAM", "PULWAMA", "JAMMU", "RAMBAN", "KATHUA", "DODA"], 0, 1),
    ("UA", "05", None, 5, 1),
    ("AS", "18", None, 5, 1),
    ("HP", "02", None, 5, 1),
]
PLAN = [p for p in PLAN_ALL if p[0] in os.environ.get("PV_STATES", "TR,MP,JK,UA,AS,HP").split(",")]
random.seed(int(os.environ.get("PV_SEED", "20261118")))


def strip(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


class Cap(Exception):
    pass


def req(path, data=None, referer=None):
    if len(LOG) >= CAP:
        raise Cap()
    w = NEXT[0] - time.time()
    if w > 0:
        time.sleep(w)
    h = {"User-Agent": UA, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest", "Accept-Encoding": "identity",
         "Referer": referer or NIC + "/SchoolReporting/Index/HP"}
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode()
        h["Content-Type"] = "application/x-www-form-urlencoded"
    t0 = time.time()
    st, raw = -1, b""
    for attempt in range(3):
        try:
            with OPENER.open(urllib.request.Request(NIC + path, data=body, headers=h), timeout=90) as r:
                st, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            st, raw = e.code, e.read()
        except Exception as e:  # noqa: BLE001
            st, raw = -1, f"{type(e).__name__}: {e}".encode()
        if st == 200 or (st != -1 and st < 500 and st != 429):
            break
        time.sleep(10 * (attempt + 1))
    NEXT[0] = time.time() + 1.2
    LOG.append({"path": path.split("?")[0], "q": path.split("?")[1][:120] if "?" in path else "", "status": st,
                "bytes": len(raw), "s": round(time.time() - t0, 2), "t": time.strftime("%H:%M:%S", time.gmtime())})
    return st, raw.decode("utf-8", "replace")


def panel(st_code, d, b, c, s):
    st, t = req(f"/SchoolReporting/GetSchoolDetailsPV?stateCode={st_code}&disttCode={d}&blockCode={b}"
                f"&clusterCode={c}&schoolCode={s}&shift=1")
    if st != 200:
        return {"error": st}
    cut = t.find("Respondants")  # everything after this word is staff names: dropped unread
    if cut > 0:
        t = t[:cut]
    lines = [x for x in (strip(p) for p in re.split(r"<[^>]+>", t)) if x]
    o = {}
    for f in FIELDS:
        if f in lines:
            i = lines.index(f)
            o[f] = lines[i + 1] if i + 1 < len(lines) else None
    for i, x in enumerate(lines):
        if x.startswith("Monthly Enrollment"):
            o["Enrol"] = lines[i + 1] if i + 1 < len(lines) else None
            o["EnrolMonth"] = x
        if x.startswith("School Reportings On"):
            o["On"] = x
    return o


def jload(t):
    try:
        j = json.loads(t)
        return j.get("data", j) if isinstance(j, dict) else j
    except Exception:  # noqa: BLE001
        return []


def relist():
    """Re-read the panel of every school in relist.json (no picker calls)."""
    res = {"mode": "relist", "schools": []}
    L = json.loads((Path(__file__).resolve().parent / "relist.json").read_text(encoding="utf-8"))
    try:
        for x in L:
            o = panel(x["code"], x["d"], x["b"], x["c"], x["s"])
            o.update({k: x[k] for k in ("state", "code", "d", "dname", "b", "c", "s")})
            res["schools"].append(o)
    except Cap:
        res["stopped"] = "cap"
    (OUT / "pv_relist.json").write_text(json.dumps(res, ensure_ascii=False, indent=0), encoding="utf-8")
    (OUT / "log_relist.json").write_text(json.dumps(LOG, indent=0), encoding="utf-8")
    print(f"relist requests {len(LOG)} ok {sum(1 for x in LOG if x['status'] == 200)} schools {len(res['schools'])}")


def main():
    if os.environ.get("PV_RELIST") == "1":
        relist()
        if os.environ.get("PV_STATES"):
            LOG.clear()
        else:
            return
    res = {"plan": [p[:2] for p in PLAN], "schools": [], "clusters": [], "state_pages": {}}
    try:
        for abbr, code, names, nspread, ncl in PLAN:
            ref = f"{NIC}/SchoolReporting/Index/{abbr}"
            st, page = req(f"/SchoolReporting/Index/{abbr}", referer=ref)
            m = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', page)
            tok = m.group(1) if m else ""
            sel = re.search(r'id="ddlDistt".*?</select>', page, flags=re.S)
            dists = re.findall(r'<option value="(\d+)">([^<]*)</option>', sel.group(0) if sel else "")
            res["state_pages"][abbr] = {"status": st, "districts": len(dists), "token": bool(tok)}
            if names:
                chosen = [(v, t) for v, t in dists if any(n in t.upper() for n in names)]
            else:
                step = max(1, len(dists) // nspread)
                chosen = dists[::step][:nspread]
            for d, dname in chosen:
                if os.environ.get("PV_RELOAD") == "1":  # fresh page token per district (MP lost blocks after 3)
                    st, page = req(f"/SchoolReporting/Index/{abbr}", referer=ref)
                    m = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', page)
                    tok = m.group(1) if m else tok
                st, t = req("/SchoolReporting/GetBlocksByDisttJS", data={"DisttCode": d, "__RequestVerificationToken": tok},
                            referer=ref)
                blocks = jload(t)
                if not blocks:
                    res["clusters"].append({"state": abbr, "d": d, "dname": dname, "error": f"blocks {st}"})
                    continue
                for b in random.sample(blocks, min(ncl, len(blocks))):
                    bv = b["Value"]
                    st, t = req(f"/SchoolReporting/GetClustersByBlocksJS?BlockCode={bv}&DisttCode={d}", referer=ref)
                    cls = jload(t)
                    if not cls:
                        continue
                    c = random.choice(cls)["Value"]
                    st, t = req(f"/SchoolReporting/GetSchoolsByClusterJS?DisttCode={d}&BlockCode={bv}&ClusterCode={c}",
                                referer=ref)
                    schs = jload(t)
                    res["clusters"].append({"state": abbr, "d": d, "dname": dname, "b": bv, "bname": b.get("Text"),
                                            "c": c, "n_schools": len(schs)})
                    for s in schs[:SCH_PER_CLUSTER]:
                        o = panel(code, d, bv, c, s["Value"])
                        o.update({"state": abbr, "code": code, "d": d, "dname": dname, "b": bv, "c": c,
                                  "s": s["Value"], "name": s.get("Text", "")[:120]})
                        res["schools"].append(o)
        # meals per day this month, for schools that declared No on either field
        flagged = [o for o in res["schools"] if o.get("Food Grain") == "No" or o.get("Funds") == "No"]
        others = [o for o in res["schools"] if o.get("Food Grain") == "Yes" and o.get("Funds") == "Yes"]
        for o in flagged[:MONTHJSON_CAP] + others[:15]:
            st, t = req(f"/Home/GetSchoolDailyReportingWithAttendanceJSON?stateCode={o['code']}&schoolCode={o['s']}&shiftID=1")
            try:
                j = json.loads(t)
                o["month"] = {"m": j.get("MonthName"), "y": j.get("Year"), "meals": j.get("ListMDMServed")}
            except Exception:  # noqa: BLE001
                o["month"] = {"error": st}
    except Cap:
        res["stopped"] = "cap"
    blob = json.dumps(res, ensure_ascii=False, indent=0)
    # guard: no e-mail and no unmasked 10-digit mobile in text fields (codes are separate fields)
    for o in res["schools"]:
        for k in ("name",):
            if re.search(r"@|(?<!\d)[6-9]\d{9}(?!\d)", o.get(k) or ""):
                o[k] = "[masked]"
    (OUT / "pv.json").write_text(json.dumps(res, ensure_ascii=False, indent=0), encoding="utf-8")
    (OUT / "log.json").write_text(json.dumps(LOG, indent=0), encoding="utf-8")
    ok = sum(1 for x in LOG if x["status"] == 200)
    print(f"requests {len(LOG)} ok {ok} schools {len(res['schools'])} bytes {len(blob)}")


if __name__ == "__main__":
    main()
