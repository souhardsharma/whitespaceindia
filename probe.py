"""Throwaway runner probe (reads only): Telangana mid-day meal daily report and Delhi DoE employee attendance.

One request at a time per host, at least one second apart (except the small benchmark in plan.json).
TLS is verified on every request. Writes out/ts/*, out/emp/* and out/summary.json.
"""
from __future__ import annotations

import concurrent.futures as cf
import csv
import datetime as dt
import gzip
import html
import http.cookiejar
import json
import re
import sys
import time
import traceback
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
LOG: list[dict] = []
COUNT: dict[str, int] = {}
PLAN = json.loads((HERE / "plan.json").read_text(encoding="utf-8"))


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),
                                       urllib.request.HTTPSHandler(context=CTX))


def req(op, url, data=None, tag="", timeout=60, tries=3, pause=1.0):
    host = urllib.parse.urlsplit(url).hostname
    try:
        egress.ensure_chain(url, [None])
    except Exception as e:  # noqa: BLE001
        LOG.append({"tag": "chain " + tag, "err": repr(e)})
    st, raw = -1, b""
    for attempt in range(tries):
        t0 = time.time()
        COUNT[host] = COUNT.get(host, 0) + 1
        headers = {"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Encoding": "gzip"}
        if data is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            headers["Referer"] = url
        elif host == "edudel.nic.in" and url != EMP:
            headers["Referer"] = EMP
        r = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
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
        LOG.append({"tag": tag, "status": st, "bytes": len(raw), "s": secs, "try": attempt,
                    "utc": time.strftime("%H:%M:%S", time.gmtime(t0))})
        if pause:
            time.sleep(pause)
        if st == 200:
            break
        time.sleep(5 * (attempt + 1) if st in (429, -1) or st >= 500 else 1)
    return st, raw.decode("utf-8", "replace")


def cells(page: str) -> list[list[str]]:
    page = re.sub(r"<script.*?</script>", "", page, flags=re.S)
    page = re.sub(r"<!--.*?-->", "", page, flags=re.S)
    rows = []
    for tr in re.finditer(r"<tr[^>]*>(.*?)</tr>", page, flags=re.S | re.I):
        if "<tr" in tr.group(1).lower():
            continue
        tds = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr.group(1), flags=re.S | re.I)
        vals = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t))).strip() for t in tds]
        if any(vals):
            rows.append(vals)
    return rows


def form_fields(page: str, base: str):
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
        if ty == "checkbox" or (ty == "radio" and "checked" not in tag):
            continue
        fields[n.group(1)] = val
    for m in re.finditer(r'<select[^>]*name="([^"]+)"[^>]*>(.*?)</select>', page, flags=re.S):
        opts = re.findall(r'<option([^>]*)value="([^"]*)"[^>]*>(.*?)</option>', m.group(2), flags=re.S)
        sel = [o for o in opts if "selected" in o[0]]
        fields[m.group(1)] = html.unescape(sel[0][1]) if sel else (html.unescape(opts[0][1]) if opts else "")
        selects[m.group(1)] = [(html.unescape(o[1]), re.sub(r"\s+", " ", html.unescape(o[2])).strip()) for o in opts]
    act = re.search(r'<form[^>]*action="([^"]*)"', page)
    action = urllib.parse.urljoin(base, html.unescape(act.group(1))) if act else base
    return fields, selects, submits, action


def daterange(a: str, b: str):
    d, e = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    while d <= e:
        yield d
        d += dt.timedelta(days=1)


# ----------------------------------------------------------------------------- Telangana MDM
TS = "https://schooledu.telangana.gov.in/MDM/MDMDateWiseSelectionReport.do"


def ts_post(op, mode, d: dt.date, tag, d2: dt.date | None = None, **extra):
    f = d.strftime("%d/%m/%Y")
    t = (d2 or d).strftime("%d/%m/%Y")
    body = {"mode": mode, "distId": "", "todateOld": t, "fromdateOld": f, "villId": "", "mandalId": "",
            "mandalCode": "", "fromdate": f, "todate": t}
    body.update(extra)
    return req(op, TS, urllib.parse.urlencode(body).encode(), tag=tag)


def num(x: str) -> int:
    x = x.replace(",", "").strip()
    return int(x) if re.fullmatch(r"-?\d+", x) else -1


def ts_table(page: str):
    """Rows of the report table: [sl, name, ...numbers]; plus the codes the page names for each row."""
    rows = [r for r in cells(page) if len(r) >= 6 and r[0].isdigit()]
    total = next((r for r in cells(page) if r and r[0].strip().lower() == "total" or (len(r) > 1 and r[1].strip().lower() == "total")), None)
    codes = re.findall(r"getMandal(?:List)?\('get\w+', '(\d+)'", page)
    return rows, total, list(dict.fromkeys(codes))


def ts_school_rows(page: str):
    """School rows with the 11-digit code carried beside each name."""
    out = []
    for tr in re.finditer(r"<tr[^>]*>(.*?)</tr>", page, flags=re.S | re.I):
        body = tr.group(1)
        code = re.search(r"(?:villId=|')(\d{11})(?:&|')", body)
        clean = re.sub(r"<!--.*?-->", "", body, flags=re.S)
        tds = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t))).strip()
               for t in re.findall(r"<td[^>]*>(.*?)</td>", clean, flags=re.S | re.I)]
        tds = [t for t in tds]
        if len(tds) >= 4 and tds[0].isdigit():
            out.append([code.group(1) if code else ""] + tds)
    return out


def telangana(S: dict):
    P = PLAN["ts"]
    out = OUT / "ts"
    out.mkdir(parents=True, exist_ok=True)
    op = opener()
    st, page = req(op, TS, tag="TS GET")
    (out / "page.html").write_text(page, encoding="utf-8")
    S["get"] = {"status": st, "bytes": len(page)}
    print("TS GET", st, len(page), flush=True)
    if st != 200:
        return
    series = []
    dist_codes: dict[str, str] = {}

    def state_day(d: dt.date, label: str, save=False):
        st, pg = ts_post(op, "unspecified", d, f"TS state {d}")
        rows, total, codes = ts_table(pg)
        if save:
            (out / f"state_{d}_{label}.html").write_text(pg, encoding="utf-8")
        nz = sum(1 for r in rows if num(r[4]) > 0) if rows else 0
        rec = {"date": str(d), "dow": d.strftime("%a"), "status": st, "bytes": len(pg), "districts": len(rows),
               "districts_with_meals": nz, "total": total, "label": label}
        series.append(rec)
        if rows and codes and len(codes) == len(rows):
            for r, c in zip(rows, codes):
                dist_codes[c] = r[1]
        print("TS state", d, st, len(rows), total, flush=True)
        return pg, rows

    a, b = P["series"]
    for d in daterange(a, b):
        state_day(d, "series", save=str(d) in P.get("save_dates", []))
    for x in P["old_dates"]:
        state_day(dt.date.fromisoformat(x), "old", save=True)
    S["series"] = series
    S["district_codes"] = dist_codes
    with open(out / "series.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["date", "dow", "label", "status", "districts", "districts_with_meals", "total_row"])
        for r in series:
            w.writerow([r["date"], r["dow"], r["label"], r["status"], r["districts"], r["districts_with_meals"],
                        "|".join(r["total"] or [])])

    # a range of dates in one request: is the answer the sum of its days?
    ra, rb = P["range_check"]
    st, pg = ts_post(op, "unspecified", dt.date.fromisoformat(ra), "TS range", dt.date.fromisoformat(rb))
    (out / f"state_range_{ra}_{rb}.html").write_text(pg, encoding="utf-8")
    S["range_check"] = {"from": ra, "to": rb, "total": ts_table(pg)[1]}

    # mandal tables, every district, one date
    md = dt.date.fromisoformat(P["mandal_date"])
    mandals: dict[str, list] = {}
    mrows = []
    for dc in sorted(dist_codes):
        st, pg = ts_post(op, "getMandalReportsList", md, f"TS mandals {dc}", distId=dc)
        rows, total, codes = ts_table(pg)
        (out / f"mandals_{dc}_{md}.html").write_text(pg, encoding="utf-8")
        mandals[dc] = codes
        for r, c in zip(rows, codes if len(codes) == len(rows) else [""] * len(rows)):
            mrows.append([str(md), dc, dist_codes[dc], c] + r[1:6])
        print("TS mandals", dc, st, len(rows), len(codes), total, flush=True)
    S["mandal_counts"] = {k: len(v) for k, v in mandals.items()}
    with open(out / "mandals.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["date", "dist", "dist_name", "mandal", "mandal_name", "schools", "enrolled", "meals", "not_availed"])
        w.writerows(mrows)

    # school tables
    srows = []
    S["school_pages"] = []

    def school_day(mc: str, d: dt.date, save=True):
        st, pg = ts_post(op, "getVillageCount", d, f"TS schools {mc} {d}", mandalId=mc, distId=mc[:4])
        rows = ts_school_rows(pg)
        if save:
            (out / f"schools_{mc}_{d}.html").write_text(pg, encoding="utf-8")
        for r in rows:
            srows.append([str(d), mc] + r[:1] + r[2:6])
        S["school_pages"].append({"mandal": mc, "date": str(d), "status": st, "bytes": len(pg), "rows": len(rows),
                                  "with_code": sum(1 for r in rows if r[0])})
        print("TS schools", mc, d, st, len(rows), flush=True)

    for dc in P["full_districts"]:
        for mc in mandals.get(dc, []):
            school_day(mc, md)
    watch = []
    for dc in P["watch_districts"]:
        watch += mandals.get(dc, [])[: P["watch_mandals_each"]]
    for x in P["watch_dates"]:
        for mc in watch:
            school_day(mc, dt.date.fromisoformat(x))
    with open(out / "schools.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["date", "mandal", "school_code", "school_name", "enrolled", "meals", "not_availed"])
        w.writerows(srows)

    # fixity: the same day asked again at the end of the run
    pg2, rows2 = state_day(md, "fixity", save=True)
    S["fixity"] = [r for r in series if r["date"] == str(md)]

    # benchmark: the same school table, one at a time without a pause, then three at a time
    if watch and P.get("bench", 0):
        mc = watch[0]
        body = urllib.parse.urlencode({"mode": "getVillageCount", "mandalId": mc, "distId": mc[:4],
                                       "fromdate": md.strftime("%d/%m/%Y"), "todate": md.strftime("%d/%m/%Y"),
                                       "fromdateOld": md.strftime("%d/%m/%Y"), "todateOld": md.strftime("%d/%m/%Y")}).encode()
        n = P["bench"]
        t0 = time.time()
        a1 = [req(op, TS, body, tag="TS bench seq", pause=0, tries=1)[0] for _ in range(n)]
        t1 = time.time() - t0
        time.sleep(3)
        t0 = time.time()
        with cf.ThreadPoolExecutor(3) as ex:
            a3 = list(ex.map(lambda _: req(opener(), TS, body, tag="TS bench x3", pause=0, tries=1)[0], range(n)))
        t3 = time.time() - t0
        S["bench"] = {"n": n, "seq_s": round(t1, 1), "seq_status": a1, "x3_s": round(t3, 1), "x3_status": a3}
        print("TS bench", S["bench"], flush=True)

    # the other open registers on the host (first read for a 24-hour comparison)
    for name, url, body in P.get("side", []):
        st, pg = req(op, url, urllib.parse.urlencode(body).encode() if body else None, tag=f"TS side {name}")
        (out / f"side_{name}.html").write_text(pg, encoding="utf-8")
        r = cells(pg)
        S.setdefault("side", {})[name] = {"status": st, "bytes": len(pg), "rows": len(r), "tail": r[-2:]}


# ----------------------------------------------------------------------------- Delhi employee attendance
EMP = "https://edudel.nic.in/mis/eis/attendance/attendancereport.aspx"


def date_keys(fields, selects):
    day = next((k for k in selects if "day" in k.lower()), None)
    mon = next((k for k in selects if "month" in k.lower()), None)
    yr = next((k for k in list(selects) + list(fields) if "year" in k.lower()), None)
    return day, mon, yr


def set_date(body, selects, keys, d: dt.date):
    day, mon, yr = keys
    for k, want in ((day, d.day), (mon, d.month)):
        if not k:
            continue
        opts = selects.get(k, [])
        pick = next((v for v, lab in opts if v.lstrip("0") == str(want) or lab.lstrip("0") == str(want)), None)
        if pick is None and k == mon:
            pick = next((v for v, lab in opts if lab[:3].lower() == d.strftime("%b").lower()), None)
        body[k] = pick if pick is not None else str(want)
    if yr:
        body[yr] = str(d.year)


def delhi(S: dict):
    P = PLAN["emp"]
    out = OUT / "emp"
    out.mkdir(parents=True, exist_ok=True)
    op = opener()
    st, index = req(op, EMP, tag="EMP index")
    (out / "index.html").write_text(index, encoding="utf-8")
    S["index"] = {"status": st, "bytes": len(index)}
    print("EMP index", st, len(index), flush=True)
    if st != 200:
        return
    f0, sel0, sub0, act0 = form_fields(index, EMP)
    S["index_form"] = {"fields": {k: v[:40] for k, v in f0.items() if not k.startswith("__")},
                       "selects": {k: [len(v), v[:4]] for k, v in sel0.items()}, "submits": sub0}
    S["views"], S["posts"] = {}, {}

    def describe(page):
        r = cells(page)
        return {"n_rows": len(r), "head": r[:10], "tail": r[-5:]}

    def view(name, url, dates, n_targets=0, target_dates=()):
        st, page = req(op, url, tag=f"EMP GET {name}")
        (out / f"view_{name}.html").write_text(page, encoding="utf-8")
        f, sel, sub, action = form_fields(page, url)
        S["views"][name] = {"status": st, "bytes": len(page), "action": action,
                            "fields": {k: v[:40] for k, v in f.items() if not k.startswith("__")},
                            "selects": {k: [len(v), v[:4]] for k, v in sel.items()}, "submits": sub} | describe(page)
        print("EMP view", name, st, len(page), {k: len(v) for k, v in sel.items()}, sub, flush=True)
        keys = date_keys(f, sel)
        if st != 200 or not keys[0] or not sub:
            return
        pick = next((k for k in sel if k not in keys and len(sel[k]) > 10), None)
        targets = [None]
        if pick and n_targets:
            targets = [o[0] for o in sel[pick] if o[0] not in ("", "0", "-1") and "select" not in o[1].lower()][:n_targets]
            S["views"][name]["picker"] = [pick, len(sel[pick])]
        for x in (target_dates if pick and n_targets else dates):
            d = dt.date.fromisoformat(x)
            for tv in targets:
                body = dict(f)
                set_date(body, sel, keys, d)
                if tv:
                    body[pick] = tv
                body[sub[0][0]] = sub[0][1]
                st, pg = req(op, action, urllib.parse.urlencode(list(body.items())).encode(), tag=f"EMP POST {name} {x} {tv}")
                key = f"{name}_{x}_{tv or 'all'}"
                if P.get("save_all") or tv or x in P.get("save_dates", []):
                    (out / f"post_{key}.html").write_text(pg, encoding="utf-8")
                S["posts"][key] = {"status": st, "bytes": len(pg), "dow": d.strftime("%a")} | describe(pg)
                print("EMP POST", key, st, len(pg), S["posts"][key]["n_rows"], flush=True)
                nf, nsel, nsub, naction = form_fields(pg, action)
                if "__VIEWSTATE" in nf:
                    f.update({k: v for k, v in nf.items() if k.startswith("__")})

    base = EMP.rsplit("/", 1)[0] + "/"
    series = [str(d) for d in daterange(*P["series"])] + P["old_dates"]
    view("all", base + "EmpAtnReportnew.aspx?dis=all&name=All%20Schools", series)
    view("school", base + "EmpAtnReportnew.aspx?dis=allsch", [], P["n_schools"], P["school_dates"])
    view("morning", base + "EmpAtnReportnew.aspx?dis=m&name=Morning%20Schools", P["school_dates"][:1])
    view("offices", base + "EmpAtnReportnew.aspx?dis=DoeOffices", [])
    view("district10", base + "EmpAtnReportnew.aspx?dis=10&name=District%20East", P["school_dates"][:1])
    view("zone01", base + "EmpAtnReportnew.aspx?dis=Z01&name=Zone%2001", P["school_dates"][:1])
    view("all_plain", base + "EmpAtnReportnew.aspx?dis=all&name=All Schools".replace(" ", "+"), P["school_dates"][:1])
    # the index's own postbacks: districts, zones, bottom 50, schools not marked
    for target in P["index_postbacks"]:
        st, index = req(op, EMP, tag="EMP index again")
        f, sel, sub, act = form_fields(index, EMP)
        body = dict(f)
        keys = date_keys(f, sel)
        if keys[0]:
            set_date(body, sel, keys, dt.date.fromisoformat(P["school_dates"][0]))
        if target.startswith("LinkButton"):
            body["ddlDate1"] = P.get("day", "13")
        body["__EVENTTARGET"], body["__EVENTARGUMENT"] = target, ""
        st, pg = req(op, act, urllib.parse.urlencode(list(body.items())).encode(), tag=f"EMP postback {target}")
        (out / f"postback_{target}.html").write_text(pg, encoding="utf-8")
        nf, nsel, nsub, nact = form_fields(pg, act)
        S["posts"][f"postback_{target}"] = {"status": st, "bytes": len(pg), "selects": {k: [len(v), v[:4]] for k, v in nsel.items()},
                                           "submits": nsub, "links": re.findall(r'href="([^"]*EmpAtn[^"]*)"', pg)[:8]} | describe(pg)
        print("EMP postback", target, st, len(pg), flush=True)


def main():
    OUT.mkdir(exist_ok=True)
    S: dict = {"started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    for name, fn in (("ts", telangana), ("emp", delhi)):
        if not PLAN.get(name, {}).get("run", True):
            continue
        S[name] = {}
        try:
            fn(S[name])
        except Exception:  # noqa: BLE001 - a failed section is a recorded result
            S[name]["error"] = traceback.format_exc()
            print(S[name]["error"], flush=True)
        (OUT / "summary.json").write_text(json.dumps(S, ensure_ascii=False, indent=0), encoding="utf-8")
    S["requests"] = COUNT
    S["log"] = LOG
    S["ended"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    (OUT / "summary.json").write_text(json.dumps(S, ensure_ascii=False, indent=0), encoding="utf-8")
    print("requests", COUNT, flush=True)


if __name__ == "__main__":
    main()
