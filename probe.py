"""Throwaway probe: which State school-staffing systems answer this runner, and the Chhattisgarh
School Education Portal's public "Sanctioned Post Information Report" in depth.

Only reads public report pages. One request at a time, about one a second a host. TLS is verified
on every request. Everything read is written to out/ and uploaded as an artifact.
"""
from __future__ import annotations

import gzip
import hashlib
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
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
sys.path.insert(0, str(HERE / "scripts" / "education"))
import egress  # noqa: E402

CTX = egress.NET.TLS
RESULTS: list[dict] = []
PLAN = json.loads((HERE / "plan.json").read_text(encoding="utf-8"))


def opener_for() -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),
                                       urllib.request.HTTPSHandler(context=CTX))


def send(op, url, data=None, headers=None, timeout=60):
    try:
        egress.ensure_chain(url, [None])
    except Exception:  # noqa: BLE001
        pass
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"} | (headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
    try:
        with op.open(req, timeout=timeout) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return r.status, raw, dict(r.headers), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers or {}), url
    except Exception as e:  # noqa: BLE001 - every failure is a recorded result
        return -1, f"{type(e).__name__}: {e}".encode(), {}, url


def record(name, url, status, raw, secs, headers=None, route="direct", save=True):
    headers = headers or {}
    if save:
        (OUT / name).write_bytes(raw)
    RESULTS.append({"name": name, "url": url, "status": status, "bytes": len(raw), "seconds": round(secs, 2),
                    "route": route, "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "sha": hashlib.sha256(raw).hexdigest()[:16], "final_url": headers.get("final_url", ""),
                    "type": headers.get("Content-Type", ""), "disp": headers.get("Content-Disposition", ""),
                    "head": raw[:120].decode("utf-8", "replace")})
    print(f"{status:>4} {len(raw):>10,} {secs:>7.1f}s {route:6} {name}", flush=True)
    (OUT / "results.json").write_text(json.dumps(RESULTS, indent=1), encoding="utf-8")


def form_fields(page: str) -> dict:
    f = {}
    for tag in re.findall(r"<input[^>]+>", page, flags=re.I):
        n = re.search(r'name="([^"]+)"', tag)
        ty = re.search(r'type="([^"]+)"', tag)
        v = re.search(r'value="([^"]*)"', tag)
        if not n:
            continue
        t = ty.group(1).lower() if ty else "text"
        if t in ("submit", "image", "button", "checkbox", "radio"):
            continue
        f[n.group(1)] = html.unescape(v.group(1)) if v else ""
    for m in re.finditer(r'<select[^>]+name="([^"]+)"[^>]*>(.*?)</select>', page, flags=re.S | re.I):
        sel = (re.search(r'<option[^>]*selected[^>]*value="([^"]*)"', m.group(2), re.I)
               or re.search(r'<option[^>]*value="([^"]*)"[^>]*selected', m.group(2), re.I)
               or re.search(r'<option[^>]*value="([^"]*)"', m.group(2), re.I))
        f[m.group(1)] = sel.group(1) if sel else ""
    return f


def options(page: str, select: str) -> list[tuple[str, str]]:
    m = re.search(r'<select[^>]+name="%s"[^>]*>(.*?)</select>' % re.escape(select), page, flags=re.S | re.I)
    if not m:
        return []
    return [(v, re.sub(r"\s+", " ", html.unescape(t)).strip())
            for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(1), flags=re.S | re.I)]


class Direct:
    route = "direct"

    def __init__(self):
        self.op = opener_for()

    def __call__(self, url, data=None, timeout=90):
        time.sleep(1.0)
        hdr = {"Content-Type": "application/x-www-form-urlencoded", "Referer": url} if data is not None else None
        s, raw, h, final = send(self.op, url, data, hdr, timeout)
        h["final_url"] = final
        return s, raw, h


class Pooled:
    route = "india"

    def __init__(self):
        self.pool = egress.open_pool("india", reload_every=0)

    def __call__(self, url, data=None, timeout=90):
        if data is not None:
            egress.NET.DEFAULT_HEADERS["Content-Type"] = "application/x-www-form-urlencoded"
            egress.NET.DEFAULT_HEADERS["Referer"] = url
        else:
            egress.NET.DEFAULT_HEADERS.pop("Content-Type", None)
        s, raw = egress.fetch(self.pool, url, data=data, method="POST" if data is not None else "GET",
                              timeout=timeout, deadline=time.time() + 300)
        return s, raw, {}


def reach() -> None:
    op = opener_for()
    for name, url in PLAN["reach"]:
        t0 = time.time()
        s, raw, h, final = send(op, url, timeout=25)
        h["final_url"] = final
        record("reach_" + name + ".html", url, s, raw[:400_000], time.time() - t0, h)
        time.sleep(0.5)


CG = "https://eduportal.cg.nic.in/"
P = "ctl00$ContentPlaceHolder1$"


def post(fetch, tag, url, page, extra, timeout=120):
    f = form_fields(page)
    f.update(extra)
    t0 = time.time()
    s, raw, h = fetch(url, urllib.parse.urlencode(f).encode(), timeout)
    record(tag, url, s, raw, time.time() - t0, h, fetch.route)
    return s, raw.decode("utf-8", "replace")


def cg(fetch) -> bool:
    url = CG + "SchoolReportPostWise.aspx"
    t0 = time.time()
    s, raw, h = fetch(url)
    record(f"cg_{fetch.route}_form.html", url, s, raw, time.time() - t0, h, fetch.route)
    if s != 200 or b"ddlDist" not in raw:
        return False
    form = raw.decode("utf-8", "replace")
    for name in PLAN["cg_forms"]:
        t0 = time.time()
        s2, raw2, h2 = fetch(CG + name)
        record(f"cg_{fetch.route}_get_{name}.html", CG + name, s2, raw2, time.time() - t0, h2, fetch.route)
    for dist in PLAN["cg_districts"]:
        s, p1 = post(fetch, f"cg_post_{dist}_p1.html", url, form, {P + "ddlDist": dist, P + "Button1": "Show Report"})
        if s != 200 or "GridView1" not in p1:
            continue
        if dist == PLAN["cg_districts"][0]:
            post(fetch, f"cg_post_{dist}_p2.html", url, p1,
                 {"__EVENTTARGET": P + "GridView1", "__EVENTARGUMENT": "Page$2"})
        post(fetch, f"cg_post_{dist}_export1.bin", url, p1, {P + "ImageButton1.x": "8", P + "ImageButton1.y": "8"}, 240)
        if dist == PLAN["cg_districts"][0]:
            post(fetch, f"cg_post_{dist}_export2.bin", url, p1, {P + "ImageButton2.x": "8", P + "ImageButton2.y": "8"}, 240)
    # narrowing: district -> block -> cluster, to size a small unit of work
    d0 = PLAN["cg_districts"][0]
    s, pb = post(fetch, f"cg_drill_{d0}_blocks.html", url, form, {"__EVENTTARGET": P + "ddlDist", P + "ddlDist": d0})
    blks = [v for v, _ in options(pb, P + "ddlBlk") if v != "0"]
    if s == 200 and blks:
        s, pc = post(fetch, f"cg_drill_{d0}_clusters.html", url, pb, {"__EVENTTARGET": P + "ddlBlk", P + "ddlBlk": blks[0]})
        cls = [v for v, _ in options(pc, P + "ddlCluster") if v != "0"]
        if s == 200 and cls:
            post(fetch, f"cg_drill_{d0}_cluster_report.html", url, pc,
                 {P + "ddlCluster": cls[0], P + "Button1": "Show Report"})
    return True


def main() -> None:
    OUT.mkdir(exist_ok=True)
    if PLAN.get("do_reach"):
        reach()
    ok = False
    if PLAN.get("cg_direct", True):
        ok = cg(Direct())
    if not ok and PLAN.get("cg_pool", True):
        try:
            cg(Pooled())
        except SystemExit as e:  # an empty pool is a recorded result, not a crash
            record("cg_pool_unavailable.txt", CG, -3, str(e).encode(), 0, route="india")
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a", encoding="utf-8") as fsum:
        fsum.write("| status | bytes | s | route | probe |\n|---|---|---|---|---|\n")
        for r in RESULTS:
            fsum.write(f"| {r['status']} | {r['bytes']:,} | {r['seconds']} | {r['route']} | {r['name']} |\n")


if __name__ == "__main__":
    main()
