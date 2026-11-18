"""Procurement probe: GeM (school-education buyers) and CPPP (central education bodies).

Phase is chosen by the file phase.txt: "recon" learns the API's behaviour cheaply,
"sweep" runs the full counts. GeM goes through the Indian pool (it refuses the runner's
own address at connect); CPPP goes from the runner's own address (it answers it).
Every request is logged with host, status, bytes and seconds to out/requests.jsonl.
Per-host caps keep the probe inside its budget. One request at a time per host, >= 1 s apart.
"""
from __future__ import annotations

import gzip
import json
import os
import random
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import http.cookiejar
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
sys.path.insert(0, str(HERE / "scripts" / "education"))
import egress  # noqa: E402

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CAP = {"bidplus.gem.gov.in": int(os.environ.get("CAP_BIDPLUS", "150")),
       "gem.gov.in": int(os.environ.get("CAP_GEM", "120")),
       "eprocure.gov.in": int(os.environ.get("CAP_CPPP", "150"))}
SENT: dict[str, int] = {}
LOGF = (OUT / "requests.jsonl").open("a", encoding="utf-8")
LAST: dict[str, float] = {}
GOOD: list = []   # Indian routes that answered with 200, in order found


def gap(host: str, spacing: float) -> None:
    w = LAST.get(host, 0) + spacing - time.time()
    if w > 0:
        time.sleep(w)
    LAST[host] = time.time()


def log(tag, url, status, n, secs, route):
    host = urllib.parse.urlsplit(url).hostname
    LOGF.write(json.dumps({"t": time.strftime("%H:%M:%S"), "tag": tag, "host": host, "status": status,
                           "bytes": n, "secs": round(secs, 3), "route": "direct" if route is None else "proxy",
                           "url": url[:200]}) + "\n")
    LOGF.flush()
    print(f"{status:>4} {n:>9,} {secs:6.2f}s {tag[:60]}", flush=True)


class Sess:
    """One cookie session on one route; restarts on another route when it fails.

    family "india": a route from the Indian pool (egress.Session); "open": the runner's own address.
    """

    def __init__(self, family: str, setup=None, spacing: float = 1.5, tries: int = 14, timeout: int = 35):
        self.family, self.setup, self.spacing, self.tries, self.timeout = family, setup, spacing, tries, timeout
        self.bad: set = set()
        self.new()

    def new(self):
        for _ in range(self.tries):
            if self.family == "india":
                self.s = egress.Session("india", spacing=0, timeout=self.timeout, avoid=self.bad)
                pool = [r for r in egress.NET.load_proxies(egress.pool_path("india")) if r not in self.bad]
                good = [r for r in GOOD if r not in self.bad]
                order = good + [r for r in pool if r not in good]
                if not order:
                    self.bad.clear()
                    order = list(GOOD) + [r for r in egress.NET.load_proxies(egress.pool_path("india")) if r not in GOOD]
                if order:
                    self.s.proxy = order[0]
                    self.s.jar = http.cookiejar.CookieJar()
                    self.s.opener = egress.NET.Route(order[0]).opener()
                    self.s.opener.add_handler(urllib.request.HTTPCookieProcessor(self.s.jar))
                self.route = self.s.proxy
            else:
                self.route = None
                jar = http.cookiejar.CookieJar()
                self.opener = urllib.request.build_opener(
                    urllib.request.HTTPSHandler(context=ssl.create_default_context()),
                    urllib.request.HTTPCookieProcessor(jar))
            try:
                if self.setup:
                    self.setup(self)
                return
            except (egress.SessionLost, RuntimeError, OSError) as e:
                print("  setup failed:", str(e)[:140], flush=True)
                if self.route in GOOD:
                    GOOD.remove(self.route)
                if self.route:
                    self.bad.add(self.route)
        raise RuntimeError("no session could be opened")

    def raw(self, url, data=None, headers=None, tag=""):
        host = urllib.parse.urlsplit(url).hostname
        if SENT.get(host, 0) >= CAP.get(host, 50):
            raise SystemExit(f"cap reached for {host}")
        if isinstance(data, dict):
            data = urllib.parse.urlencode(data).encode()
        gap(host, self.spacing)
        SENT[host] = SENT.get(host, 0) + 1
        t0 = time.time()
        try:
            if self.family == "india":
                st, body, final = self.s.request(url, data=data, headers=headers)
            else:
                h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip", **(headers or {})}
                req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
                try:
                    with self.opener.open(req, timeout=self.timeout) as r:
                        body = r.read()
                        if r.headers.get("Content-Encoding") == "gzip":
                            body = gzip.decompress(body)
                        st, final = r.status, r.geturl()
                except urllib.error.HTTPError as e:
                    st, body, final = e.code, e.read(), url
        except Exception as e:  # noqa: BLE001 - any transport fault (IncompleteRead included) loses the route
            log(tag or url, url, -1, 0, time.time() - t0, self.route)
            raise egress.SessionLost(f"{type(e).__name__}: {e}") from e
        log(tag or url, url, st, len(body), time.time() - t0, self.route)
        if st == 200 and self.route and self.route not in GOOD:
            GOOD.append(self.route)
        return st, body, final

    def req(self, url, data=None, headers=None, check=None, tag=""):
        for _ in range(self.tries):
            try:
                st, body, final = self.raw(url, data, headers, tag)
                if check and not check(st, body):
                    raise RuntimeError(f"bad answer {st} {body[:160]!r}")
                return st, body, final
            except (egress.SessionLost, RuntimeError) as e:
                print("  lost:", str(e)[:160], flush=True)
                if self.route:
                    self.bad.add(self.route)
                    if self.route in GOOD:
                        GOOD.remove(self.route)
                self.new()
        raise RuntimeError("gave up on " + url)


# ---------------------------------------------------------------- GeM
B = "https://bidplus.gem.gov.in"
G = "https://gem.gov.in"


def gem_setup(sess):
    st, body, _ = sess.raw(B + "/all-bids", tag="gem setup /all-bids")
    m = re.search(rb"csrf_bd_gem_nk'\s*:\s*'([0-9a-f]+)'", body)
    if st != 200 or not m:
        raise RuntimeError(f"no token ({st}, {len(body)} bytes)")
    sess.tok = m.group(1).decode()


def ok_json(st, body):
    if st != 200:
        return False
    try:
        json.loads(body)
        return True
    except ValueError:
        return False


GH = {"X-Requested-With": "XMLHttpRequest", "Referer": B + "/all-bids"}


def gpost(sess, path, payload=None, form=None, tag=""):
    f = {"payload": json.dumps(payload)} if payload is not None else dict(form)
    f["csrf_bd_gem_nk"] = sess.tok
    t0 = time.time()
    st, body, _ = sess.req(B + path, f, headers=GH, check=ok_json, tag=tag or path)
    return json.loads(body), time.time() - t0, len(body)


def rr(doc):
    try:
        return doc["response"]["response"]
    except (KeyError, TypeError):
        return None


def ms(dept, state="", ministry="", org="", page=1, efrom="", eto="", **extra):
    p = {"searchType": "ministry-search", "ministry": ministry, "buyerState": state, "organization": org,
         "department": dept, "bidEndFromMin": efrom, "bidEndToMin": eto, "page": page}
    p.update(extra)
    return p


def ft(text, status_type="bidrastatus", by_status="", sort="Bid-Start-Date-Latest", page=1, efrom="", eto="", **extra):
    p = {"page": page, "param": {"searchBid": text, "searchType": "fullText"},
         "filter": {"bidStatusType": status_type, "byType": "all", "highBidValue": "",
                    "byEndDate": {"from": efrom, "to": eto}, "sort": sort, "byStatus": by_status}}
    p.update(extra)
    return p


def slim(doc):
    """Keep only the fields the instrument would publish (drops b.b_created_by, a buyer login id)."""
    keep = ("b_id", "b_bid_number", "b_category_name", "b_total_quantity", "b_status", "b_bid_type",
            "b_buyer_status", "b_eval_type", "final_start_date_sort", "final_end_date_sort",
            "b_bid_number_parent", "b_id_parent", "ba_official_details_minName", "ba_official_details_deptName",
            "ba_is_single_packet", "is_rc_bid", "is_high_value", "bbt_title", "b_ra_to_bid", "ra_b_buyer_status")
    out = {}
    for k in keep:
        v = doc.get(k)
        if isinstance(v, list) and len(v) == 1:
            v = v[0]
        if v is not None:
            out[k] = v
    return out


def save(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")


# ---------------------------------------------------------------- CPPP
C = "https://eprocure.gov.in/eprocure/app"
EDU = re.compile(r"universit|institute of technology|institute of science|institute of management|"
                 r"\bIIT\b|\bIISER\b|\bNIT\b|vishwavidyalaya|secondary education|technical education|"
                 r"national book trust|jamia|tata institute of social|statistical institute|"
                 r"information technology design|science education and research|"
                 r"engineering science and technology|indian law institute|NCERT|navodaya|kendriya|"
                 r"school|open schooling|educational", re.I)
NOT_EDU = re.compile(r"medical|AIIMS|Postgraduate Institute of Medical|forest management|fashion|"
                     r"agricultural research|ayurveda|food technology", re.I)


def cppp_rows(html: str):
    rows = []
    for r in re.findall(r'<tr[^>]*class="(?:even|odd)"[^>]*>(.*?)</tr>', html, re.S):
        tds = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", c)).strip()
               for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        links = re.findall(r'href="([^"]*DirectLink[^"]*)"', r)
        rows.append((tds, links))
    return rows


def cppp_org_table(sess, tag="cppp orgs"):
    st, body, _ = sess.req(C + "?page=FrontEndTendersByOrganisation&service=page",
                           check=lambda s, b: s == 200 and b"FrontEndTendersByOrganisation" in b, tag=tag)
    html = body.decode("utf-8", "replace")
    orgs = []
    for tds, links in cppp_rows(html):
        if len(tds) >= 3 and tds[0].isdigit() and links:
            orgs.append({"name": tds[1], "count": int(tds[2] or 0),
                         "link": "https://eprocure.gov.in" + links[0].replace("&amp;", "&")
                         if links[0].startswith("/") else links[0].replace("&amp;", "&")})
    return orgs, len(body)


def cppp_tenders(html: str, org: str):
    out = []
    for tds, _ in cppp_rows(html):
        if len(tds) >= 6 and tds[0].isdigit():
            m = re.findall(r"\[([^\]]*)\]", tds[4] if len(tds) == 6 else tds[5])
            out.append({"org": org, "published": tds[1], "closing": tds[2], "opening": tds[3],
                        "title_ref_id": tds[4] if len(tds) == 6 else tds[5], "chain": tds[-1], "brackets": m})
    return out


# ---------------------------------------------------------------- phases
def cppp(res):
    """CPPP (runner's own address): org table x3 timed (gzip and plain), gated pages, full education sweep."""
    cp = Sess("open", spacing=1.2)
    times = []
    for i in range(3):
        t0 = time.time()
        orgs, n = cppp_org_table(cp, tag=f"cppp orgs gzip #{i}")
        times.append((round(time.time() - t0, 2), n, len(orgs)))
    res["cppp_org_times_gzip"] = times
    times = []
    for i in range(3):
        t0 = time.time()
        st, body, _ = cp.req(C + "?page=FrontEndTendersByOrganisation&service=page", headers={"Accept-Encoding": "identity"},
                             check=lambda s_, b: s_ == 200, tag=f"cppp orgs plain #{i}")
        times.append((round(time.time() - t0, 2), len(body)))
    res["cppp_org_times_plain"] = times
    save("cppp_orgs.json", orgs)
    for pg in ("FrontEndListTendersbyDate", "WebAwards", "ResultOfTenders", "FrontEndTendersInArchive",
               "WebTenderStatusLists", "FrontEndLatestActiveTenders", "FrontEndTendersByClassification"):
        try:
            st, body, _ = cp.req(f"{C}?page={pg}&service=page", tag=f"cppp {pg}")
            (OUT / f"cppp_{pg}.html").write_bytes(body)
            res[f"cppp_{pg}"] = {"status": st, "bytes": len(body), "captcha": bool(re.search(rb"captcha", body, re.I)),
                                 "rows": len(cppp_rows(body.decode('utf-8', 'replace')))}
        except Exception as e:  # noqa: BLE001
            res[f"cppp_{pg}"] = str(e)[:200]
    for u in ("https://eprocure.gov.in/cppp/latestactivetendersnew/cpppdata", "https://eprocure.gov.in/cppp/gemtender"):
        try:
            st, body, _ = cp.req(u, tag=f"cppp {u[-30:]}")
            (OUT / ("cppp_" + u.rsplit('/', 1)[1] + ".html")).write_bytes(body)
            res[u] = {"status": st, "bytes": len(body), "captcha": bool(re.search(rb"captcha", body, re.I))}
        except Exception as e:  # noqa: BLE001
            res[u] = str(e)[:200]
    save("recon.json", res)
    cp2 = Sess("open", spacing=1.2)
    orgs, _ = cppp_org_table(cp2, tag="cppp orgs (sweep session)")
    edu = [o for o in orgs if EDU.search(o["name"]) and not NOT_EDU.search(o["name"])]
    allt = []
    t_sweep = time.time()
    for o in edu:
        try:
            st, body, _ = cp2.req(o["link"], check=lambda s_, b: s_ == 200, tag=f"cppp org {o['name'][:40]}")
            (OUT / "cppp_pages").mkdir(exist_ok=True)
            (OUT / "cppp_pages" / (re.sub(r"\W+", "_", o["name"])[:60] + ".html")).write_bytes(body)
            ts = cppp_tenders(body.decode("utf-8", "replace"), o["name"])
            allt += ts
            o["read"] = len(ts)
        except Exception as e:  # noqa: BLE001
            o["read"] = str(e)[:100]
    res["cppp_sweep"] = {"orgs": len(edu), "tenders": len(allt), "secs": round(time.time() - t_sweep, 1)}
    save("cppp_edu_orgs.json", edu)
    save("cppp_edu_tenders.json", allt)
    save("recon.json", res)


def gem_tests(res, gs):
    """What the GeM search accepts: date formats, status, phrase and field queries, page size."""
    ml, s, n = gpost(gs, "/ministry-list-adv", form={}, tag="ministry-list-adv")
    save("gem_ministry_list.json", ml)
    res["gem_states"] = ml.get("data", {}).get("BuyerStateList")
    try:
        d, s, n = gpost(gs, "/dept-list-adv", form={"ministry": "", "buyer_state": "JAMMU & KASHMIR", "organization": ""},
                        tag="dept_state_only")
        res["dept_state_only"] = {"secs": round(s, 2), "bytes": n, "value": d}
    except Exception as e:  # noqa: BLE001
        res["dept_state_only"] = str(e)[:200]
    save("recon.json", res)
    JK = "School Education Department Jammu and Kashmir"
    tests = {
        "ms_jk": ("/search-bids", ms(JK, "JAMMU & KASHMIR")),
        "ms_jk_rows50": ("/search-bids", ms(JK, "JAMMU & KASHMIR", rows=50)),
        "ms_jk_past_dmy": ("/search-bids", ms(JK, "JAMMU & KASHMIR", efrom="19-10-2026", eto="15-11-2026")),
        "ms_jk_status": ("/search-bids", ms(JK, "JAMMU & KASHMIR", bidStatusType="bidrastatus")),
        "ft_phrase_all": ("/all-bids-data", ft(f'"{JK}"')),
        "ft_field_all": ("/all-bids-data", ft(f'ba_official_details_deptName:"{JK}"')),
        "ft_field_or": ("/all-bids-data", ft(f'ba_official_details_deptName:("{JK}" OR "Education Department Bihar")')),
        "ft_phrase_ongoing": ("/all-bids-data", ft(f'"{JK}"', status_type="ongoing_bids")),
        "ft_phrase_awarded": ("/all-bids-data", ft(f'"{JK}"', by_status="bid_awarded", sort="Bid-End-Date-Latest")),
        "ft_rows50": ("/all-bids-data", ft(f'"{JK}"', rows=50)),
    }
    for key, (path, payload) in tests.items():
        try:
            d, s, n = gpost(gs, path, payload=payload, tag=key)
            r = rr(d)
            docs = [slim(x) for x in (r or {}).get("docs", [])]
            res[key] = {"secs": round(s, 2), "bytes": n, "numFound": r and r.get("numFound"),
                        "ndocs": len(docs), "depts": [x.get("ba_official_details_deptName") for x in docs],
                        "starts": [x.get("final_start_date_sort") for x in docs],
                        "statuses": [x.get("b_buyer_status") for x in docs], "docs": docs,
                        "msg": None if r else str(d)[:300]}
        except Exception as e:  # noqa: BLE001
            res[key] = str(e)[:200]
        save("recon.json", res)


def main():
    res = {}
    try:
        cppp(res)
    except Exception as e:  # noqa: BLE001
        res["cppp_error"] = repr(e)[:300]
    save("recon.json", res)
    gs = Sess("india", setup=gem_setup, spacing=1.2)
    res["gem_route_secs"] = [r for r in GOOD]
    gem_tests(res, gs)
    save("recon.json", res)
    import sweep
    try:
        sweep.main(sys.modules[__name__], res, gs)
    except BaseException as e:  # noqa: BLE001
        res["sweep_error"] = repr(e)[:300]
    save("recon.json", res)
    import price
    try:
        price.main(sys.modules[__name__])
    except BaseException as e:  # noqa: BLE001
        res["price_error"] = repr(e)[:300]
    # last, one-off benchmarks that may be slow through a proxy
    for key, url in (("bench_advance_search", B + "/advance-search"),
                     ("bench_result_page", B + "/bidding/bid/getBidResultView/7616805")):
        try:
            t0 = time.time()
            st, body, _ = gs.raw(url, tag=key)
            res[key] = {"status": st, "bytes": len(body), "secs": round(time.time() - t0, 2)}
            if key == "bench_result_page":
                (OUT / "result_7616805.html").write_bytes(body)
        except BaseException as e:  # noqa: BLE001
            res[key] = repr(e)[:200]
    res["sent"] = SENT
    save("recon.json", res)
    print("sent:", SENT)


if __name__ == "__main__":
    main()
