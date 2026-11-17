"""Throwaway reader for stream hunt-states-east. Reads only; serves nothing.

1. Reach: one GET to each candidate host from the runner's own address.
2. Sikkim EMMIS: the school directory, then staff-by-designation and students-by-class pages for a
   sample of schools (1 request a second, at most MAX_SCHOOLS schools), written as CSV of counts.
   No names are collected: the staff page lists designations and counts only.
TLS is verified on every request (urllib default context).
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import html
import json
import re
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent / "out"
OUT.mkdir(exist_ok=True)
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CTX = ssl.create_default_context()
MAX_SCHOOLS = 280
LOG = []

REACH = {
    "as_shikshasetu": "https://shikshasetu.assam.gov.in/",
    "as_shikshasetu_districts": "https://shikshasetu.assam.gov.in/api/v1/get_all_districts",
    "br_medhasoft_status": "https://medhasoft.bihar.gov.in/Medhasoft/Medha/PFMSBenCheckList.aspx",
    "br_medhasoft_home": "https://medhasoft.bihar.gov.in/",
    "wb_sms_search": "https://school.banglarshiksha.gov.in/landing/search_school.php",
    "wb_portal": "https://banglarshiksha.wb.gov.in/",
    "cg_vsk": "https://vsk.cg.gov.in/",
    "mz_vsk": "https://vsk.vskmizoram.com/",
    "jh_jepc_sfbsr": "https://jepc.jharkhand.gov.in/sfbsr",
    "od_osepa": "https://osepa.odisha.gov.in/",
    "ml_tims": "https://www.megtims.gov.in/",
}


def get(url: str, timeout: int = 60):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            st = r.status
    except urllib.error.HTTPError as e:
        raw, st = e.read(), e.code
    except Exception as e:  # noqa: BLE001 - every failure is a result
        raw, st = f"{type(e).__name__}: {e}".encode(), -1
    LOG.append({"url": url, "status": st, "bytes": len(raw), "s": round(time.time() - t0, 2),
                "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "sha": hashlib.sha256(raw).hexdigest()[:16]})
    return st, raw.decode("utf-8", "replace")


def text(h: str) -> str:
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h))).strip()


def table(page: str):
    rows = []
    for tr in re.findall(r"<tr.*?</tr>", page, flags=re.S | re.I):
        cells = [text(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, flags=re.S | re.I)]
        if cells:
            rows.append(cells)
    return rows


def main() -> None:
    reach = {}
    for k, u in REACH.items():
        st, body = get(u, timeout=45)
        reach[k] = {"status": st, "bytes": len(body), "head": body[:160]}
        (OUT / f"reach_{k}.html").write_text(body[:200000], encoding="utf-8")
        time.sleep(1)

    st, d = get("https://emmis.sikkim.gov.in/schools", timeout=120)
    (OUT / "sk_directory.html").write_text(d, encoding="utf-8")
    # cards: each card holds a management line, a name, "UDISE Code: <11 digits>" and maybe /web/<slug>
    cards = re.split(r"(?=UDISE Code:)", d)
    schools = []
    for i in range(1, len(cards)):
        code = re.match(r"UDISE Code:\s*(\d{11})", cards[i])
        slug = re.search(r'href="/web/([^"/]+)"', cards[i])
        before = text(cards[i - 1][-600:])
        grades = re.search(r"(Primary only[^<]*|Upper Primary[^<]*|Secondary[^<]*|Higher Secondary[^<]*|Pre[- ]Primary[^<]*)", text(cards[i][:800]))
        mgmt = re.findall(r"(Government Aided|Government|Private Unaided \(Recognized\)|Private Unaided|Central Government|Others?[^ ]*)", before)
        schools.append({"udise": code.group(1) if code else "", "slug": slug.group(1) if slug else "",
                        "mgmt": mgmt[-1] if mgmt else "", "grades": grades.group(1).strip() if grades else ""})
    with open(OUT / "sk_directory.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["udise", "slug", "mgmt", "grades"])
        w.writeheader()
        w.writerows(schools)

    withweb = [s for s in schools if s["slug"]]
    step = max(1, len(withweb) // MAX_SCHOOLS)
    sample = withweb[::step][:MAX_SCHOOLS]
    staff_rows, stud_rows = [], []
    for s in sample:
        base = f"https://emmis.sikkim.gov.in/web/{s['slug']}"
        st1, e = get(base + "/employees", timeout=60)
        time.sleep(1)
        st2, p = get(base + "/students", timeout=60)
        time.sleep(1)
        for r in table(e):
            if len(r) == 4 and r[0] != "Designation":
                staff_rows.append([s["udise"], s["slug"], st1] + r)
        for r in table(p):
            if len(r) == 4 and r[0] != "Class":
                stud_rows.append([s["udise"], s["slug"], st2] + r)
    with open(OUT / "sk_staff.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["udise", "slug", "http", "designation", "male", "female", "total"])
        w.writerows(staff_rows)
    with open(OUT / "sk_students.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["udise", "slug", "http", "class", "boys", "girls", "total"])
        w.writerows(stud_rows)
    summary = {"reach": reach, "directory_status": st, "schools": len(schools), "with_web": len(withweb),
               "sampled": len(sample), "requests": len(LOG),
               "ok": sum(1 for x in LOG if x["status"] == 200)}
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    (OUT / "log.json").write_text(json.dumps(LOG, indent=0), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "reach"}))
    for k, v in reach.items():
        print(k, v["status"], v["bytes"])


if __name__ == "__main__":
    main()
