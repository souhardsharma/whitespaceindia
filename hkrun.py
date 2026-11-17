"""Read HimKosh (Himachal Pradesh treasury) public reports from this runner, one request at a time.

Only public report pages are read: no login, no CAPTCHA, nothing personal typed. One connection,
at least PAUSE seconds between requests, a long pause after any 429/5xx, a hard cap on requests.

Stages (env STAGES, comma separated; default all):
  lists   every treasury's drawing-officer list (one postback each)
  beeo    for each block education officer: date-wise head-of-account drawals for each FY in YEARS,
          and for every SCHEME_EVERY-th officer the scheme-wise total of the first FY
  hod     the head-of-department form for HOD 220 (what does it return?)
  hist    one officer (BLP00-201), meal head only, each FY back to 2016-17; and one bill-level read
"""
from __future__ import annotations

import datetime as dt
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
(OUT / "html").mkdir(parents=True, exist_ok=True)
(OUT / "tsv").mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(HERE / "scripts" / "education"))
import egress  # noqa: E402

CTX = egress.NET.TLS
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
BASE = "https://himkosh.nic.in/eHPOLTIS/PublicReports/"
DDOFORM = BASE + "wfrmDDOWiseQueries.aspx"
HODFORM = "https://himkosh.nic.in/eHPOLTIS/publicreports/wfrmHODWiseDDOQueries.aspx"
P = "ctl00$MainContent$"
PAUSE = float(os.environ.get("PAUSE", "1.0"))
CAP = int(os.environ.get("CAP", "590"))
STAGES = [s for s in os.environ.get("STAGES", "lists,beeo,hod,hist").split(",") if s]
YEARS = [y for y in os.environ.get("YEARS", "2026,2025").split(",") if y]
SCHEME_EVERY = int(os.environ.get("SCHEME_EVERY", "3"))
ONLY = [t for t in os.environ.get("ONLY_TREASURIES", "").split(",") if t]
TODAY = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date()
BEEO = re.compile(r"B\.?\s?E\.?\s?E\.?\s?O|BLOCK\s+(ELE|PRI)|B\.?P\.?E\.?O|ELE.*EDU|ELEMENTARY", re.I)

COUNT = {"requests": 0, "errors": 0, "by_stage": {}}
LAST = [0.0]
LOG = open(OUT / "log.jsonl", "a", encoding="utf-8")


def log(row):
    LOG.write(json.dumps(row, ensure_ascii=False) + "\n")
    LOG.flush()


class CapReached(Exception):
    pass


jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),
                                     urllib.request.HTTPSHandler(context=CTX))


def send(url, data=None, timeout=90):
    if COUNT["requests"] >= CAP:
        raise CapReached()
    wait = LAST[0] + PAUSE - time.time()
    if wait > 0:
        time.sleep(wait)
    egress.ensure_chain(url, [None])
    h = {"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Encoding": "gzip", "Accept-Language": "en-IN,en;q=0.9"}
    if data is not None:
        h |= {"Content-Type": "application/x-www-form-urlencoded", "Referer": url, "Origin": "https://himkosh.nic.in"}
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
    t0 = time.time()
    COUNT["requests"] += 1
    try:
        with opener.open(req, timeout=timeout) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            st = r.status
    except urllib.error.HTTPError as e:
        st, raw = e.code, e.read()
    except Exception as e:  # noqa: BLE001 - a failure is a recorded result
        st, raw = -1, f"{type(e).__name__}: {e}".encode()
    LAST[0] = time.time()
    if st != 200:
        COUNT["errors"] += 1
        time.sleep(20 if st in (429, 500, 502, 503, 504) else 8)
    return st, raw.decode("utf-8", "replace"), round(time.time() - t0, 2)


def fields_of(t):
    f = {}
    for m in re.finditer(r"<input[^>]*>", t):
        tag = m.group(0)
        n = re.search(r'name="([^"]+)"', tag)
        if not n:
            continue
        ty = (re.search(r'type="([^"]+)"', tag) or [None, "text"])[1].lower()
        if ty in ("submit", "image", "button", "checkbox", "password"):
            continue
        if ty == "radio" and "checked" not in tag:
            continue
        v = re.search(r'value="([^"]*)"', tag)
        f[n.group(1)] = html.unescape(v.group(1)) if v else ""
    for m in re.finditer(r'<select[^>]*name="([^"]+)"[^>]*>(.*?)</select>', t, flags=re.S):
        sel = (re.search(r'<option[^>]*selected[^>]*value="([^"]*)"', m.group(2))
               or re.search(r'<option[^>]*value="([^"]*)"[^>]*selected', m.group(2))
               or re.search(r'<option[^>]*value="([^"]*)"', m.group(2)))
        f[m.group(1)] = html.unescape(sel.group(1)) if sel else ""
    return f


def options(t, name):
    m = re.search(r'<select[^>]*name="' + re.escape(name) + r'"[^>]*>(.*?)</select>', t, flags=re.S)
    if not m:
        return []
    return [(html.unescape(v), html.unescape(re.sub(r"\s+", " ", x)).strip())
            for v, x in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(1), flags=re.S)]


def table_rows(t):
    best = []
    for tb in re.findall(r"<table.*?</table>", t, flags=re.S | re.I):
        rows = []
        for tr in re.findall(r"<tr.*?</tr>", tb, flags=re.S | re.I):
            cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", c))).strip()
                     for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S | re.I)]
            if cells:
                rows.append("\t".join(cells))
        if len(rows) > len(best):
            best = rows
    return best


def messages(t):
    out = []
    for m in re.finditer(r'<span[^>]*id="[^"]*(?:lbl|Label|msg|Msg|err|Err)[^"]*"[^>]*>(.*?)</span>', t, flags=re.S):
        x = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", m.group(1)))).strip()
        if x:
            out.append(x[:160])
    for m in re.finditer(r"alert\('([^']{1,200})'", t):
        out.append("alert: " + m.group(1))
    return out[:8]


def save(name, t, keep_html=True):
    name = re.sub(r"[^A-Za-z0-9_.-]+", "_", name)[:120]
    rows = table_rows(t)
    (OUT / "tsv" / f"{name}.tsv").write_text("\n".join(rows), encoding="utf-8")
    if keep_html:
        (OUT / "html" / f"{name}.html.gz").write_bytes(gzip.compress(t.encode("utf-8")))
    return rows


def fy_dates(y):
    y = int(y)
    end = dt.date(y + 1, 3, 31)
    return f"01/04/{y}", (min(end, TODAY)).strftime("%d/%m/%Y")


class Form:
    """One ASP.NET form kept alive: every answer is the next request's view state."""

    def __init__(self, url):
        self.url, self.page, self.treasury = url, None, None

    def open(self, stage):
        for _ in range(3):
            st, t, s = send(self.url)
            log({"stage": stage, "name": "_get", "status": st, "bytes": len(t), "s": s})
            if st == 200 and "__VIEWSTATE" in t:
                self.page, self.treasury = t, None
                return True
        return False

    def post(self, stage, name, extra, keep_html=True, want=None):
        for attempt in range(3):
            if self.page is None and not self.open(stage):
                continue
            f = fields_of(self.page)
            f.update({"__EVENTTARGET": "", "__EVENTARGUMENT": ""})
            f.update(extra)
            st, t, s = send(self.url, data=urllib.parse.urlencode(f).encode())
            ok = st == 200 and "__VIEWSTATE" in t and (want is None or want(t))
            rows = save(name, t, keep_html) if st == 200 else []
            log({"stage": stage, "name": name, "status": st, "bytes": len(t), "s": s, "rows": len(rows),
                 "msgs": messages(t) if st == 200 else t[:200], "attempt": attempt + 1})
            COUNT["by_stage"][stage] = COUNT["by_stage"].get(stage, 0) + 1
            if ok:
                self.page = t
                return t, rows
            self.page, tre = None, self.treasury
            self.treasury = None
            if tre and "__EVENTTARGET" in extra and extra["__EVENTTARGET"]:
                continue
            if tre:                      # the session or view state went: take the treasury again
                self.pick(stage, tre)
        return None, []

    def pick(self, stage, tre):
        t, _ = self.post(stage, f"ddos_{tre}", {"__EVENTTARGET": P + "ddlTreaCode", P + "ddlTreaCode": tre},
                         keep_html=False, want=lambda x: (P + "ddlDDOCode") in x)
        if t is not None:
            self.treasury = tre
        return t

    def report(self, stage, name, tre, ddo, fr, to, q, head=None, keep_html=True):
        if self.treasury != tre and self.pick(stage, tre) is None:
            return None, []
        opts = options(self.page, P + "ddlDDOCode")
        if ddo not in [v for v, _ in opts]:            # accept "201" for a value or text that starts "201-"
            hit = [v for v, x in opts if v.split("-")[0].strip() == ddo or x.split("-")[0].strip() == ddo]
            if hit:
                ddo = hit[0]
        x = {P + "ddlTreaCode": tre, P + "ddlDDOCode": ddo, P + "txtFromDate": fr, P + "txtToDate": to,
             P + "ddlQuery": q, P + "rbtUnit": "0", P + "btnGetdata": "View Data"}
        head = head or ("", "", "")
        x.update({P + "txtMajor": head[0], P + "txtSubmajor": head[1], P + "txtMinor": head[2], P + "txtDemand": ""})
        return self.post(stage, name, x, keep_html)


def q_value(page, wanted):
    """The option VALUE of the query whose value or text is `wanted` (spaces and case ignored)."""
    w = wanted.replace(" ", "").lower()
    for v, x in options(page, P + "ddlQuery"):
        if w in (v.replace(" ", "").lower(), x.replace(" ", "").lower()):
            return v
    return None


def main():
    res = {"today_ist": str(TODAY), "stages": STAGES, "years": YEARS, "treasuries": [], "officers": {}}
    form = Form(DDOFORM)
    try:
        if not form.open("lists"):
            res["fatal"] = "DDO form did not open"
            return res
        (OUT / "html" / "ddo_form.html.gz").write_bytes(gzip.compress(form.page.encode("utf-8")))
        treas = [(v, x) for v, x in options(form.page, P + "ddlTreaCode") if v and v not in ("0", "-1")]
        queries = options(form.page, P + "ddlQuery")
        res["treasuries"], res["queries"] = treas, queries
        q_date = q_value(form.page, "TransDate,HOA") or "8"
        q_scheme = q_value(form.page, "HOD,SCHEMENAME")
        q_bill = q_value(form.page, "TransDate,HOA,BILLNO")
        res["q"] = {"date": q_date, "scheme": q_scheme, "bill": q_bill}
        if "hist" in STAGES:
            for y in range(2016, 2025):
                fr, to = fy_dates(y)
                form.report("hist", f"h_BLP00_201_{y}", "BLP00", "201", fr, to, q_date, head=("2202", "01", "112"))
            fr, to = fy_dates(2026)
            form.report("hist", "h_BLP00_201_2026_mealhead", "BLP00", "201", fr, to, q_date, head=("2202", "01", "112"))
            if q_bill:
                form.report("hist", "b_BLP00_201_2026_billlevel", "BLP00", "201", fr, to, q_bill, head=("2202", "01", "112"))
        if "hod" in STAGES:
            hod = Form(HODFORM)
            if hod.open("hod"):
                (OUT / "html" / "hod_form.html.gz").write_bytes(gzip.compress(hod.page.encode("utf-8")))
                res["hod_queries"] = options(hod.page, P + "ddlQuery")
                for i, (v, x) in enumerate(res["hod_queries"]):
                    hod.post("hod", f"hod220_oct26_q{i}", {
                        P + "txtFromDate": "01/10/2026", P + "txtToDate": "31/10/2026", P + "txtHOD": "220",
                        P + "ddlQuery": v, P + "rbtUnit": "0", P + "txtMajor": "2202", P + "txtSubmajor": "01",
                        P + "txtMinor": "112", P + "btnGetdata": "View Data"})
                if res["hod_queries"]:
                    hod.post("hod", "hod220_day_2026-11-03", {
                        P + "txtFromDate": "03/11/2026", P + "txtToDate": "03/11/2026", P + "txtHOD": "220",
                        P + "ddlQuery": res["hod_queries"][0][0], P + "rbtUnit": "0", P + "txtMajor": "2202",
                        P + "txtSubmajor": "01", P + "txtMinor": "112", P + "btnGetdata": "View Data"})
        n_officer = 0
        if "lists" in STAGES or "beeo" in STAGES:
            for tre, tname in treas:
                if ONLY and tre not in ONLY:
                    continue
                t = form.pick("lists", tre)
                if t is None:
                    res["officers"][tre] = None
                    continue
                ddos = [(v, x) for v, x in options(t, P + "ddlDDOCode") if v and v not in ("0", "-1")]
                res["officers"][tre] = ddos
                if "beeo" not in STAGES:
                    continue
                for ddo, dname in ddos:
                    if not BEEO.search(dname):
                        continue
                    n_officer += 1
                    for i, y in enumerate(YEARS):
                        fr, to = fy_dates(y)
                        form.report("beeo", f"d_{tre}_{ddo}_{y}", tre, ddo, fr, to, q_date, keep_html=(n_officer <= 3))
                        if i == 0 and q_scheme and n_officer % SCHEME_EVERY == 1:
                            form.report("beeo", f"s_{tre}_{ddo}_{y}", tre, ddo, fr, to, q_scheme, keep_html=(n_officer <= 3))
                (OUT / "results.json").write_text(json.dumps(res | {"count": COUNT}, ensure_ascii=False, indent=1), encoding="utf-8")
    except CapReached:
        res["stopped"] = f"request cap {CAP} reached"
    return res


if __name__ == "__main__":
    t0 = time.time()
    try:
        r = main()
    except Exception as e:  # noqa: BLE001
        r = {"crash": f"{type(e).__name__}: {e}"}
    r["count"] = COUNT
    r["seconds"] = round(time.time() - t0)
    (OUT / "results.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in r.items() if k not in ("officers", "treasuries")}, ensure_ascii=False)[:3000])
