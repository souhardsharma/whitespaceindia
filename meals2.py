"""Throwaway probe for a second P1 idea (meals not served). Serves nothing; the branch is deleted afterwards.

Runs on GitHub's runner. Direct from the runner first (TLS verified; a missing intermediate is completed the way
egress.py completes it, never by turning verification off). A host that refuses the runner is tried once through
the education India pool built on the runner. One request at a time per host, spaced, with a hard cap per host.

Keeps parsed counts only. No raw HTML is kept. Text cells pass through phone and e-mail masks. Never requested:
UP Darpan Type_Id=4 (teacher view, carries mobiles), any login, PARIVESH.

Phases
  pb      Punjab ePunjabSchool MDM: district XML per date (19 Oct-15 Nov; Sept 2026; samples May-Aug; history
          edge), Ludhiana and all-district block tables, school lists of reporting schools (SR map), benchmarks
  nic     NIC-HP: Rajasthan district tables across 2024-2026 (when its reporting collapsed)
  up      UP CM Darpan: district / block / school meal tables by date, and a 28-day district series if it answers
  reach   other State meal portals: one GET each (runner reachability)
"""
from __future__ import annotations

import datetime as dt
import gzip
import html
import http.cookiejar
import json
import os
import re
import shutil
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "scripts" / "education"))
CACHE = Path(os.environ.get("EDUCATION_CACHE_DIR", HERE / "cache"))
(CACHE / "intermediates").mkdir(parents=True, exist_ok=True)
for f in (HERE / "intermediates").glob("*.der"):
    shutil.copy(f, CACHE / "intermediates" / f.name)
os.environ["EDUCATION_CACHE_DIR"] = str(CACHE)
import egress  # noqa: E402

egress.load_intermediates()
TLS = egress.NET.TLS

OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
DEADLINE = time.time() + 60 * float(os.environ.get("PROBE_MINUTES", "95"))
PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
DENY = re.compile(r"Login|login|Teacher|Type_Id=4|GetSchoolDetailsPV|USERSummary|Principal|Grievanc|parivesh", re.I)
RES: dict = {}
LOG: list = []


def save():
    (OUT / "result.json").write_text(json.dumps(RES, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "log.json").write_text(json.dumps(LOG, ensure_ascii=False, indent=0), encoding="utf-8")


def strip(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def mask(s: str) -> str:
    return EMAIL.sub("[email]", PHONE.sub("[phone]", s))


def rows_of(t: str) -> list[list[str]]:
    out = []
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, flags=re.S | re.I):
        cells = [mask(strip(c)) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, flags=re.S | re.I)]
        if cells:
            out.append(cells)
    return out


class Host:
    def __init__(self, name: str, base: str, cap: int, spacing: float = 2.0):
        self.name, self.base, self.cap, self.spacing = name, base, cap, spacing
        self.n, self.next = 0, 0.0
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar),
                                              urllib.request.HTTPSHandler(context=TLS))
        self.chain = None

    def req(self, label, path, data=None, json_body=None, gz=False, timeout=90, headers=None):
        url = path if path.startswith("http") else self.base + path
        if DENY.search(url) or (data and DENY.search(json.dumps(data))):
            raise SystemExit("refused " + url)
        if self.n >= self.cap or time.time() > DEADLINE:
            raise RuntimeError(f"budget {self.name}")
        if self.chain is None:
            self.chain = egress.ensure_chain(url, [None])
        w = self.next - time.time()
        if w > 0:
            time.sleep(w)
        self.n += 1
        h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip" if gz else "identity"} | (headers or {})
        body = None
        if json_body is not None:
            body = json_body.encode()
            h["Content-Type"] = "application/json; charset=utf-8"
        elif data is not None:
            body = urllib.parse.urlencode(data).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
        t0 = time.time()
        st, raw = -1, b""
        try:
            with self.op.open(urllib.request.Request(url, data=body, headers=h), timeout=timeout) as r:
                st, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            st, raw = e.code, e.read()
        except Exception as e:  # noqa: BLE001
            st, raw = -1, f"{type(e).__name__}: {e}".encode()
        secs = round(time.time() - t0, 2)
        self.next = time.time() + self.spacing
        wire = len(raw)
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        LOG.append({"host": self.name, "label": label, "path": url.split("?")[0].replace(self.base, ""),
                    "post": body is not None, "status": st, "bytes": len(raw), "wire": wire, "s": secs,
                    "t_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(t0)),
                    "err": raw[:200].decode("utf-8", "replace") if st == -1 else ""})
        return st, raw.decode("utf-8", "replace"), secs


def dates(a: str, b: str):
    x, y = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    while x <= y:
        yield x
        x += dt.timedelta(1)


def pbd(d: dt.date) -> str:
    return d.strftime("%d-%b-%Y")


# ---------------------------------------------------------------- Punjab
PB = Host("pb", "https://epunjabschool.gov.in", cap=int(os.environ.get("PB_CAP", "150")), spacing=2.0)
PB_DIST = {"AMRITSAR": "2", "BARNALA": "3", "BATHINDA": "4", "FARIDKOT": "5", "FATEHGARH SAHIB": "6",
           "FAZILKA": "34911", "FEROZEPUR": "7", "GURDASPUR": "8", "HOSHIARPUR": "9", "JALANDHAR": "10",
           "KAPURTHALA": "11", "LUDHIANA": "12", "MALERKOTLA": "34913", "MANSA": "13", "MOGA": "14",
           "MUKTSAR": "16", "PATHANKOT": "34912", "PATIALA": "18", "ROOPNAGAR": "19", "S.B.S. NAGAR": "17",
           "SANGRUR": "20", "SAS NAGAR": "15", "TARN TARAN": "21"}


def pb_dist(d: dt.date, gz=False):
    body = '{_objBAL_MDMUser: ' + json.dumps({"pCreated_On": pbd(d)}) + '}'
    st, t, s = PB.req(f"pb dist {d}", "/Home/MDM_Graph_Reports.aspx/GetMDMDistrictWise", json_body=body, gz=gz,
                      headers={"X-Requested-With": "XMLHttpRequest",
                               "Referer": "https://epunjabschool.gov.in/Home/MDM_Graph_Reports.aspx"})
    if st != 200:
        return {"error": st, "s": s, "head": t[:120]}
    try:
        x = json.loads(t)["d"]
    except Exception:  # noqa: BLE001
        return {"error": "notjson", "s": s, "head": t[:120]}
    rows = []
    for c in re.findall(r"<Customers>(.*?)</Customers>", x, flags=re.S):
        rows.append({k: mask(v.strip()) for k, v in re.findall(r"<(\w+)>([^<]*)</\1>", c)})
    return {"rows": rows, "s": s, "bytes": len(t), "read_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())}


def pb_blocks(code: str, d: dt.date):
    body = '{_objBAL_MDMUser: ' + json.dumps({"pCreated_On": pbd(d), "pDistrict_Code": code}) + '}'
    st, t, s = PB.req(f"pb blk {code} {d}", "/Home/MDM_Graph_Reports.aspx/GetMDMDistrictEduWise", json_body=body,
                      headers={"X-Requested-With": "XMLHttpRequest",
                               "Referer": "https://epunjabschool.gov.in/Home/MDM_Graph_Reports.aspx"})
    if st != 200:
        return {"error": st, "s": s}
    try:
        x = json.loads(t)["d"]
    except Exception:  # noqa: BLE001
        return {"error": "notjson", "s": s}
    return {"rows": rows_of(x), "s": s, "bytes": len(t)}


def pb_map(kind: str, code: str, d: dt.date):
    st, t, s = PB.req(f"pb map {kind} {code} {d}",
                      f"/GIS/MDMGIS.aspx?ReportType={kind}&DistrictCode={code}&Date={pbd(d)}", timeout=120)
    if st != 200:
        return {"error": st, "s": s}
    codes = re.findall(r"\"schoolCode\":\s*'([^']*)'", t)
    types = re.findall(r"\"schooltype\":\s*'([^']*)'", t)
    return {"codes": codes, "types": sorted(set(types)), "s": s, "bytes": len(t)}


def phase_pb():
    r = RES.setdefault("pb", {})
    st, t, s = PB.req("pb page", "/Home/MDM_Graph_Reports.aspx")
    r["page"] = {"status": st, "s": s, "bytes": len(t), "chain": PB.chain}
    save()
    if st != 200:
        return
    series = r.setdefault("dist", {})
    for d in dates("2026-10-19", "2026-11-15"):
        series[str(d)] = pb_dist(d)
    save()
    # the strike week in Ludhiana (8 Sep; warned again for 12 Sep), and the month around it
    for d in dates("2026-09-01", "2026-09-30"):
        series[str(d)] = pb_dist(d)
    save()
    for x in ["2026-05-05", "2026-05-12", "2026-07-07", "2026-07-14", "2026-08-04", "2026-08-18"]:
        series[x] = pb_dist(dt.date.fromisoformat(x))
    save()
    # history edge: 13th of each month back to Nov 2024, plus two edges
    for x in ["2025-10-13", "2025-09-12", "2025-08-13", "2025-07-14", "2025-05-13", "2025-04-15", "2025-03-13",
              "2025-02-13", "2025-01-13", "2024-12-13", "2024-11-26", "2024-11-14"]:
        series[x] = pb_dist(dt.date.fromisoformat(x))
    save()
    blk = r.setdefault("blocks", {})
    for x in ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-12"]:
        blk[f"12|{x}"] = pb_blocks("12", dt.date.fromisoformat(x))
    for name, code in PB_DIST.items():
        blk[f"{code}|2026-11-13"] = pb_blocks(code, dt.date(2026, 11, 13))
    save()
    mp = r.setdefault("maps", {})
    for x in ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-09-08"]:
        mp[f"SR|12|{x}"] = pb_map("SR", "12", dt.date.fromisoformat(x))
        save()
    mp["NS|19|2026-11-13"] = pb_map("NS", "19", dt.date(2026, 11, 13))
    # benchmarks: gzip on the XML call; the Google-Charts GET; the same date re-read (revision within days)
    b = r.setdefault("bench", {})
    b["dist_gzip"] = {k: v for k, v in pb_dist(dt.date(2026, 11, 13), gz=True).items() if k != "rows"}
    st, t, s = PB.req("pb commongraph", "/Home/CommonGraph.aspx?MDM=Yes&Date=13-Nov-2026&SchoolType=Not%20Served")
    b["commongraph_notserved"] = {"status": st, "s": s, "bytes": len(t),
                                  "rows": re.findall(r"addRows\(\[(.*?)\]\)", t, flags=re.S)[:1]}
    r["reread_1113"] = pb_dist(dt.date(2026, 11, 13))
    r["reread_1116"] = pb_dist(dt.date(2026, 11, 16))
    save()


# ---------------------------------------------------------------- NIC-HP (Rajasthan)
NIC = Host("nic", "https://mdmhp.nic.in", cap=int(os.environ.get("NIC_CAP", "16")), spacing=1.5)


def phase_nic():
    r = RES.setdefault("nic_raj", {})
    for x in ["13/12/2024", "13/02/2025", "15/04/2025", "15/07/2025", "15/09/2025", "13/11/2025", "13/01/2026",
              "13/03/2026", "14/05/2026", "14/07/2026", "15/09/2026", "15/10/2026", "13/11/2026"]:
        st, t, s = NIC.req(f"nic raj {x}", f"/Home/GetDisttWiseSummaryHome?stateCode=08&dateYesterday={x}",
                           headers={"X-Requested-With": "XMLHttpRequest"})
        rows = [c for c in rows_of(t) if len(c) >= 9 and c[0].isdigit()] if st == 200 else []
        r[x] = {"status": st, "s": s, "rows": rows}
        save()


# ---------------------------------------------------------------- UP CM Darpan
UP = Host("up", "https://darpan.prernaup.in", cap=int(os.environ.get("UP_CAP", "45")), spacing=2.0)


def up_post(type_id: str, a: str, b: str, timeout=120):
    assert type_id in ("1", "2", "3")
    st, t, s = UP.req(f"up {type_id} {a}-{b}", "/CMPrerna/MealServedDataForSearchType_Darpan",
                      data={"Type_Id": type_id, "Name": "", "FromDate": a, "ToDate": b}, timeout=timeout,
                      headers={"X-Requested-With": "XMLHttpRequest",
                               "Referer": "https://darpan.prernaup.in/CMPrerna/districtwisemonthlymealserved_darpan"})
    out = {"status": st, "s": s, "bytes": len(t), "phone_like": len(PHONE.findall(t)), "head": mask(t[:200])}
    if st == 200 and t.strip():
        try:
            data = json.loads(t)
        except Exception:  # noqa: BLE001
            data = None
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:  # noqa: BLE001
                pass
        if isinstance(data, list):
            out["n"] = len(data)
            out["rows"] = [[mask(str(c)) for c in row] if isinstance(row, list) else row for row in
                           (data if type_id in ("1", "2") else data[:40])]
    return out


def phase_up():
    r = RES.setdefault("up", {})
    st, t, s = UP.req("up page", "/CMPrerna/districtwisemonthlymealserved_darpan")
    r["page"] = {"status": st, "s": s, "bytes": len(t)}
    if st != 200:
        save()
        return
    r["t1_1311"] = up_post("1", "13/11/2026", "13/11/2026")
    save()
    if not r["t1_1311"].get("n"):
        r["t1_1311_b"] = up_post("1", "2026-11-13", "2026-11-13")
        save()
        return
    r["t1_range"] = up_post("1", "09/11/2026", "13/11/2026")
    r["t2_1311"] = up_post("2", "13/11/2026", "13/11/2026")
    r["t3_1311"] = up_post("3", "13/11/2026", "13/11/2026", timeout=240)
    save()
    ser = r.setdefault("t1_series", {})
    for d in dates("2026-10-19", "2026-11-15"):
        x = d.strftime("%d/%m/%Y")
        if x == "13/11/2026":
            continue
        ser[x] = up_post("1", x, x)
        save()
    for x in ["13/11/2025", "13/11/2024", "08/09/2026"]:
        ser[x] = up_post("1", x, x)
    save()


# ---------------------------------------------------------------- reachability of other State meal portals
REACH = [
    ("bihar_mdms", "https://www.mdmsbihar.org/"),
    ("bihar_eshikshakosh", "https://eshikshakosh.bihar.gov.in/"),
    ("odisha_pmposhan", "https://pmposhan.odisha.gov.in/"),
    ("kerala_mdms", "https://www.mdms.kerala.gov.in/"),
    ("tn_middaymeal", "https://tnmiddaymeal.tn.gov.in/"),
    ("karnataka_sats", "https://sts.karnataka.gov.in/SATS/"),
    ("rajasthan_shaladarpan", "https://rajshaladarpan.nic.in/"),
    ("gujarat_mdm_guess", "https://mdm.gujarat.gov.in/"),
]


def phase_reach():
    r = RES.setdefault("reach", {})
    for name, url in REACH:
        h = Host(name, "", cap=1)
        st, t, s = h.req(name, url, timeout=40)
        title = re.search(r"<title[^>]*>(.*?)</title>", t, flags=re.S | re.I)
        r[name] = {"url": url, "direct": {"status": st, "s": s, "bytes": len(t), "chain": h.chain,
                                          "title": mask(strip(title.group(1)))[:120] if title else "",
                                          "err": t[:160] if st == -1 else "",
                                          "login_form": bool(re.search(r"type=.password", t, flags=re.I)),
                                          "links": sorted(set(re.findall(r"href=\"([^\"#]{3,80})\"", t)))[:40]}}
        if st != 200 and egress.pool_path("india").exists():
            try:
                sess = egress.Session("india", timeout=40)
                t0 = time.time()
                st2, raw, _ = sess.request(url)
                r[name]["pool"] = {"status": st2, "s": round(time.time() - t0, 2), "bytes": len(raw)}
            except Exception as e:  # noqa: BLE001
                r[name]["pool"] = {"status": -1, "err": f"{type(e).__name__}: {e}"[:160]}
            LOG.append({"host": name, "label": "pool", **{k: v for k, v in r[name]["pool"].items() if k != "err"}})
        save()


def main():
    for ph in os.environ.get("PHASES", "pb,nic,up,reach").split(","):
        t0 = time.time()
        try:
            {"pb": phase_pb, "nic": phase_nic, "up": phase_up, "reach": phase_reach}[ph]()
        except Exception as e:  # noqa: BLE001
            RES.setdefault("errors", {})[ph] = f"{type(e).__name__}: {e}"[:300]
        RES.setdefault("phase_s", {})[ph] = round(time.time() - t0, 1)
        save()
    per = {}
    for x in LOG:
        k = x["host"]
        per.setdefault(k, {"n": 0, "ok": 0})
        per[k]["n"] += 1
        per[k]["ok"] += x.get("status") == 200
    RES["per_host"] = per
    save()
    print(json.dumps(per, indent=1))
    print(json.dumps(RES.get("errors", {}), indent=1))


if __name__ == "__main__":
    main()
