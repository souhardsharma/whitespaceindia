"""Read CBSE's public affiliated-school list and each school's public detail page from this runner.

Keeps only institution fields: affiliation number, school code, state, district, level, school type,
year of foundation, date of first opening, affiliation period from/to, type of affiliation.
Heads' names, phone numbers and e-mails are never written. One request at a time, TLS verified.
"""
from __future__ import annotations

import gzip
import html
import http.cookiejar
import json
import os
import re
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path("out")
BASE = "https://saras.cbse.gov.in/saras/AffiliatedList/"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
PAUSE = float(os.environ.get("PAUSE", "0.8"))
STATES = [s for s in os.environ.get("STATES", "28,27,5").split(",") if s]
CAP = int(os.environ.get("CAP", "3200"))
DEADLINE = time.time() + 60 * float(os.environ.get("MINUTES", "100"))
LOG: list[dict] = []
CTX = ssl.create_default_context()
OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
                                 urllib.request.HTTPSHandler(context=CTX))


def send(url, data=None, headers=None, timeout=60):
    h = {"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Encoding": "gzip"} | (headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data else "GET")
    t0 = time.time()
    try:
        with OP.open(req, timeout=timeout) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            status = r.status
    except urllib.error.HTTPError as e:
        status, raw = e.code, b""
    except Exception as e:  # noqa: BLE001
        status, raw = -1, repr(e).encode()
    LOG.append({"url": url.replace(BASE, ""), "status": status, "bytes": len(raw),
                "s": round(time.time() - t0, 2), "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    time.sleep(PAUSE)
    return status, raw.decode("utf-8", "replace")


def lines_of(page: str) -> list[str]:
    page = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S | re.I)
    page = re.sub(r"</(td|th|tr|div|p|li|h\d|label|span|b|strong)>|<br\s*/?>", "\n", page, flags=re.I)
    page = html.unescape(re.sub(r"<[^>]+>", " ", page))
    return [x for x in (re.sub(r"\s+", " ", y).strip() for y in page.split("\n")) if x]


KEEP = {"Affiliation Number": "aff", "State": "state", "District": "district",
        "Year of Foundation": "founded", "Date of First Opening of School": "opened",
        "Status of The School": "level", "School Type": "type", "Type of affiliation": "afftype",
        "Remarks, if any": "remarks"}


def detail(page: str) -> dict:
    ls = lines_of(page)
    d = {}
    for i, x in enumerate(ls[:-1]):
        lab = x.rstrip(" :")
        if lab in KEEP and KEEP[lab] not in d:
            nxt = ls[i + 1]
            d[KEEP[lab]] = "" if nxt.rstrip(" :") in KEEP or nxt.startswith("Affiliation Period") else nxt
    m = re.search(r"Affiliation Period.*?From\s*:?\s*([\d/]{8,10}).*?To\s*:?\s*([\d/]{8,10})", " ".join(ls), re.S | re.I)
    d["from"], d["to"] = (m.group(1), m.group(2)) if m else (None, None)
    return d


def state_list(state: str) -> list[str]:
    st, page = send(BASE + "ListOfSchdirReportNew", timeout=90)
    tok = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', page)
    fields = {"MainRadioValue": "State_wise", "State": state, "District": "", "Region": "",
              "InstName_orAddress": "", "RegiAffNo": "0", "SchoolStatusWise": "0",
              "__RequestVerificationToken": tok.group(1) if tok else ""}
    st, page = send(BASE + "ListOfSchdirReport", urllib.parse.urlencode(fields).encode(),
                    {"Content-Type": "application/x-www-form-urlencoded",
                     "Referer": BASE + "ListOfSchdirReportNew"}, timeout=180)
    ids = list(dict.fromkeys(re.findall(r"AfflicationDetails/(\d+)", page)))
    total = re.search(r"Total No\. Of Schools Affiliated With CBSE\s*:\s*(\d+)", page)
    LOG[-1]["ids"] = len(ids)
    LOG[-1]["total_cbse"] = total.group(1) if total else None
    return ids


def main() -> None:
    OUT.mkdir(exist_ok=True)
    st, page = send(BASE + "ListOfSchdirReportNew?ID1=D", timeout=90)
    dis = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, flags=re.S):
        cells = [html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c))).strip()
                 for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, flags=re.S)]
        if len(cells) >= 8:
            dis.append({"reg": cells[1], "state": cells[2], "district": cells[3], "level": cells[4],
                        "school": cells[5], "status": cells[6], "region": cells[7]})
    (OUT / "disaffiliated.json").write_text(json.dumps(dis, indent=0), encoding="utf-8")
    rows, n = [], 0
    for s in STATES:
        ids = state_list(s)
        print("state", s, "ids", len(ids), flush=True)
        for aff in ids:
            if n >= CAP or time.time() > DEADLINE:
                break
            st, page = send(BASE + "AfflicationDetails/" + aff, timeout=60)
            d = detail(page) if st == 200 else {}
            d.update({"req_aff": aff, "state_code": s, "http": st})
            rows.append(d)
            n += 1
            if n % 200 == 0:
                print(n, flush=True)
                (OUT / "details.json").write_text(json.dumps(rows), encoding="utf-8")
    (OUT / "details.json").write_text(json.dumps(rows), encoding="utf-8")
    (OUT / "log.json").write_text(json.dumps(LOG), encoding="utf-8")
    print("done", n, flush=True)


if __name__ == "__main__":
    main()
