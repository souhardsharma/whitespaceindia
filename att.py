"""Throwaway runner probe: Delhi DoE online student attendance (edustud.nic.in).

Reads the public report page by ASP.NET postback, one request at a time, and writes
out/att/*.html (raw pages) and out/att/summary.json (parsed figures, timings, counts).
Plan comes from att_plan.json. TLS verified on every request.
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import gzip
import html
import http.cookiejar
import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out" / "att"
BASE = "https://edustud.nic.in/mis/student/student/frmStudentAttendanceReport.aspx"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CTX = ssl.create_default_context()
LOG: list[dict] = []
COUNT = {"requests": 0}


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),
                                       urllib.request.HTTPSHandler(context=CTX))


def req(op, url, data=None, tag="", timeout=60, tries=3):
    for attempt in range(tries):
        t0 = time.time()
        COUNT["requests"] += 1
        headers = {"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Encoding": "gzip"}
        if data is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            headers["Referer"] = url
        r = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
        try:
            with op.open(r, timeout=timeout) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                st = resp.status
        except urllib.error.HTTPError as e:
            raw, st = e.read(), e.code
        except Exception as e:  # noqa: BLE001
            raw, st = f"{type(e).__name__}: {e}".encode(), -1
        secs = round(time.time() - t0, 2)
        LOG.append({"tag": tag, "status": st, "bytes": len(raw), "s": secs, "try": attempt})
        if st == 200:
            return st, raw.decode("utf-8", "replace")
        time.sleep(5 * (attempt + 1) if st in (429, -1) or st >= 500 else 1)
    return st, raw.decode("utf-8", "replace")


def form_fields(page: str) -> tuple[dict, dict, list, str]:
    fields, selects, submits = {}, {}, []
    for m in re.finditer(r"<input[^>]*>", page):
        tag = m.group(0)
        n = re.search(r'name="([^"]+)"', tag)
        if not n:
            continue
        ty = (re.search(r'type="([^"]+)"', tag) or [None, "text"])[1].lower()
        v = re.search(r'value="([^"]*)"', tag)
        val = html.unescape(v.group(1)) if v else ""
        if ty in ("submit", "image", "button"):
            submits.append((n.group(1), val))
            continue
        if ty in ("checkbox",) or (ty == "radio" and "checked" not in tag):
            continue
        fields[n.group(1)] = val
    for m in re.finditer(r'<select[^>]*name="([^"]+)"[^>]*>(.*?)</select>', page, flags=re.S):
        opts = re.findall(r'<option([^>]*)value="([^"]*)"[^>]*>(.*?)</option>', m.group(2), flags=re.S)
        sel = [o for o in opts if "selected" in o[0]]
        fields[m.group(1)] = html.unescape(sel[0][1]) if sel else (html.unescape(opts[0][1]) if opts else "")
        selects[m.group(1)] = [(html.unescape(o[1]), re.sub(r"\s+", " ", html.unescape(o[2])).strip()) for o in opts]
    act = re.search(r'<form[^>]*action="([^"]*)"', page)
    action = urllib.parse.urljoin(BASE, html.unescape(act.group(1))) if act else BASE
    return fields, selects, submits, action


def cells(page: str) -> list[list[str]]:
    page = re.sub(r"<script.*?</script>", "", page, flags=re.S)
    rows = []
    for tr in re.finditer(r"<tr[^>]*>(.*?)</tr>", page, flags=re.S | re.I):
        tds = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr.group(1), flags=re.S | re.I)
        vals = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t))).strip() for t in tds]
        vals = [v for v in vals if v]
        if vals and "<tr" not in tr.group(1).lower():
            rows.append(vals)
    return rows


def headline(page: str) -> dict:
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", "", page, flags=re.S)))
    d = {}
    for key, pat in [("schools", r"Total no\. of schools\s+(\d+)"), ("marked", r"Attendance marked by\s+(\d+)"),
                     ("present", r"Present\s+(\d+)\s+([\d.]+)"), ("absent", r"Absent\s+(\d+)\s+([\d.]+)"),
                     ("leave", r"Leave\s+(\d+)\s+([\d.]+)"), ("total", r"Total Number of Student\s+(\d+)")]:
        m = re.search(pat, t)
        if m:
            d[key] = [int(m.group(1))] + ([float(m.group(2))] if m.lastindex and m.lastindex > 1 else [])
    m = re.search(r'id="lblMessage"[^>]*>(.*?)</span>', page, flags=re.S)
    if m:
        d["msg"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(1))).strip()
    return d


def find_date_keys(fields, selects):
    day = next((k for k in selects if "day" in k.lower()), None)
    mon = next((k for k in selects if "month" in k.lower()), None)
    yr = next((k for k in fields if "year" in k.lower()), None)
    return day, mon, yr


class View:
    def __init__(self, op, vtype: str | None):
        self.op = op
        self.vtype = vtype
        self.url = BASE + (f"?Type={vtype}" if vtype else "")
        st, self.page = req(op, self.url, tag=f"GET {vtype}")
        self.ok = st == 200
        self.fields, self.selects, self.submits, self.action = form_fields(self.page)
        self.day, self.mon, self.yr = find_date_keys(self.fields, self.selects)

    def describe(self):
        return {"type": self.vtype, "ok": self.ok, "action": self.action, "fields": sorted(self.fields),
                "selects": {k: [len(v), v[:4]] for k, v in self.selects.items()}, "submits": self.submits,
                "date_keys": [self.day, self.mon, self.yr]}

    def post(self, date: dt.date | None, extra: dict | None = None, submit: str | None = None, tag=""):
        body = dict(self.fields)
        if date and self.day:
            body[self.day] = str(date.day)
            body[self.mon] = str(date.month)
            if self.yr:
                body[self.yr] = str(date.year)
        body.update(extra or {})
        sub = submit or next((n for n, _ in self.submits if "next" in n.lower()), None) or \
            (self.submits[0][0] if self.submits else None)
        if sub:
            body[sub] = dict(self.submits).get(sub, "Next")
        data = urllib.parse.urlencode(list(body.items())).encode()
        return req(self.op, self.action, data=data, tag=tag or f"POST {self.vtype} {date}")


def daterange(a: str, b: str):
    d, e = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    while d <= e:
        yield d
        d += dt.timedelta(days=1)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    plan = json.loads((HERE / "att_plan.json").read_text(encoding="utf-8"))
    pause = plan.get("pause", 1.0)
    S: dict = {"started": dt.datetime.utcnow().isoformat() + "Z", "views": {}, "series": {}, "tables": {},
               "fixity": {}, "schools": {}, "bench": {}}
    op = opener()

    views = {}
    for vt in plan["views"]:
        v = View(op, None if vt == "AllSchools" else vt)
        views[vt] = v
        (OUT / f"get_{vt}.html").write_text(v.page, encoding="utf-8")
        S["views"][vt] = v.describe()
        print("GET", vt, v.ok, v.describe()["selects"].keys(), v.submits, flush=True)
        time.sleep(pause)

    # state totals over the window, plus probes of old dates
    allv = views["AllSchools"]
    dates = [d for a, b in plan["series_windows"] for d in daterange(a, b)] + \
        [dt.date.fromisoformat(x) for x in plan.get("old_dates", [])]
    for d in dates:
        st, page = allv.post(d, tag=f"ALL {d}")
        S["series"][d.isoformat()] = {"status": st} | headline(page)
        if plan.get("save_all", True):
            (OUT / f"all_{d:%Y%m%d}.html").write_text(page, encoding="utf-8")
        print("ALL", d, S["series"][d.isoformat()].get("marked"), S["series"][d.isoformat()].get("present"),
              S["series"][d.isoformat()].get("msg", "")[:60], flush=True)
        time.sleep(pause)

    # fixity: the same date read again later in the run
    for x in plan.get("fixity", []):
        d = dt.date.fromisoformat(x)
        st, page = allv.post(d, tag=f"FIX {d}")
        S["fixity"][x] = headline(page)
        (OUT / f"fix_{d:%Y%m%d}.html").write_text(page, encoding="utf-8")
        time.sleep(pause)

    # breakdown tables
    for vt, wins in plan.get("tables", {}).items():
        v = views.get(vt)
        if not v or not v.ok:
            continue
        for a, b in wins:
            for d in daterange(a, b):
                st, page = v.post(d, tag=f"{vt} {d}")
                S["tables"].setdefault(vt, {})[d.isoformat()] = {"status": st, "rows": cells(page)[:400],
                                                                  "msg": headline(page).get("msg", "")}
                (OUT / f"{vt}_{d:%Y%m%d}.html").write_text(page, encoding="utf-8")
                print(vt, d, st, len(cells(page)), flush=True)
                time.sleep(pause)

    # breakdown tables that need a district / zone / type chosen in ddlType
    for vt, spec in plan.get("typed_tables", {}).items():
        v = views.get(vt)
        if not v or not v.ok:
            continue
        types = [o[0] for o in v.selects.get("ddlType", []) if o[0] != "Select"] if spec["types"] == "all" \
            else spec["types"]
        for x in spec["dates"]:
            d = dt.date.fromisoformat(x)
            for ty in types:
                st, page = v.post(d, extra={"ddlType": ty}, tag=f"{vt} {ty} {d}")
                S["tables"].setdefault(vt, {}).setdefault(x, {})[ty] = {
                    "status": st, "rows": cells(page)[:1500], "msg": headline(page).get("msg", "")}
                if spec.get("save", True):
                    (OUT / f"{vt}_{ty}_{d:%Y%m%d}.html").write_text(page, encoding="utf-8")
                time.sleep(pause)
            print(vt, d, len(types), flush=True)

    # today, read at the start and at the end of the run (does a day's figure move while it is marked?)
    for x in plan.get("today", []):
        st, page = allv.post(dt.date.fromisoformat(x), tag=f"TODAY {x}")
        S.setdefault("today", []).append({"utc": dt.datetime.utcnow().isoformat() + "Z", "date": x} | headline(page))
        time.sleep(pause)

    # school grain, several runs
    for sp in plan.get("school_runs", []):
        v = views.get("DesiredSchool")
        if not v or not v.ok:
            break
        opts = [o for o in v.selects.get("ddlType", []) if o[0] != "Select"]
        (OUT / "school_list.json").write_text(json.dumps(opts, ensure_ascii=False), encoding="utf-8")
        d = dt.date.fromisoformat(sp["date"])
        pick = opts if sp.get("all") else opts[: sp.get("n", 5)]
        t0 = time.time()
        res = {}

        def one2(o, d=d, v=v):
            st, page = v.post(d, extra={"ddlType": o[0]}, tag=f"SCH {d}")
            return o, st, page
        with cf.ThreadPoolExecutor(sp.get("conc", 1)) as ex:
            for o, st, page in ex.map(one2, pick):
                res[o[0]] = {"name": o[1], "status": st, "rows": cells(page)}
                if len(res) <= sp.get("save_n", 8):
                    (OUT / f"school_{o[0]}_{d:%Y%m%d}.html").write_text(page, encoding="utf-8")
        S.setdefault("school_runs", {})[sp["date"]] = {"seconds": round(time.time() - t0, 1), "n": len(res),
                                                       "conc": sp.get("conc", 1), "res": res}
        print("SCHOOL RUN", d, len(res), round(time.time() - t0, 1), flush=True)

    for x in plan.get("today", [])[:1]:
        st, page = allv.post(dt.date.fromisoformat(x), tag=f"TODAY {x}")
        S.setdefault("today", []).append({"utc": dt.datetime.utcnow().isoformat() + "Z", "date": x} | headline(page))

    # school grain
    sp = plan.get("schools")
    if sp and "DesiredSchool" in views and views["DesiredSchool"].ok:
        v = views["DesiredSchool"]
        sk = next((k for k in v.selects if "school" in k.lower()), None) or \
            next((k for k in v.selects if k not in (v.day, v.mon)), None)
        opts = [o for o in v.selects.get(sk, []) if o[0] not in ("", "0", "-1") and "select" not in o[1].lower()]
        S["schools"]["select_key"] = sk
        S["schools"]["n_options"] = len(opts)
        (OUT / "school_list.json").write_text(json.dumps(opts, ensure_ascii=False), encoding="utf-8")
        for x in sp.get("dates", []):
            d = dt.date.fromisoformat(x)
            pick = opts if sp.get("all") else opts[: sp.get("n", 5)]
            conc = sp.get("conc", 1)
            t0 = time.time()
            res = {}

            def one(o):
                st, page = v.post(d, extra={sk: o[0]}, tag=f"SCH {d}")
                return o, st, page
            with cf.ThreadPoolExecutor(conc) as ex:
                for o, st, page in ex.map(one, pick):
                    res[o[0]] = {"name": o[1], "status": st} | headline(page) | {"rows": cells(page)[-30:]}
                    if len(res) <= sp.get("save_n", 8):
                        (OUT / f"school_{o[0]}_{d:%Y%m%d}.html").write_text(page, encoding="utf-8")
            S["schools"][x] = {"seconds": round(time.time() - t0, 1), "n": len(res), "res": res}
            print("SCHOOLS", d, len(res), round(time.time() - t0, 1), flush=True)

    # benchmark: same request, sequential vs a few at once
    bd = plan.get("bench")
    if bd:
        d = dt.date.fromisoformat(bd["date"])
        for conc in bd["conc"]:
            t0 = time.time()
            with cf.ThreadPoolExecutor(conc) as ex:
                sts = list(ex.map(lambda _: allv.post(d, tag=f"BENCH c{conc}")[0], range(bd["n"])))
            S["bench"][f"c{conc}"] = {"n": bd["n"], "seconds": round(time.time() - t0, 1),
                                     "ok": sum(1 for s in sts if s == 200)}
            print("BENCH", conc, S["bench"][f"c{conc}"], flush=True)
            time.sleep(5)

    # side probes (single GETs)
    for name, url in plan.get("side", {}).items():
        st, page = req(op, url, tag=f"SIDE {name}")
        (OUT / f"side_{name}.html").write_text(page, encoding="utf-8")
        S.setdefault("side", {})[name] = {"status": st, "bytes": len(page)}
        time.sleep(pause)

    S["requests"] = COUNT["requests"]
    S["log"] = LOG
    S["finished"] = dt.datetime.utcnow().isoformat() + "Z"
    (OUT / "summary.json").write_text(json.dumps(S, ensure_ascii=False, indent=0), encoding="utf-8")
    print("requests", COUNT["requests"])


if __name__ == "__main__":
    main()
