"""Two bounded reads for the hunt-highered probe. Only aggregate pages are read; no per-person report is opened.

STAGE=aebas  : NMC's biometric attendance platform. Reads the organisation list (10 a page), then one
               dashboard page per college, and keeps only the counters (date, registered, active, present,
               out, devices, average in/out time). Raw HTML is kept for the first KEEP colleges only.
STAGE=register: NMC's college-and-course register, every page of the JSON search, kept whole.
Env: CAP (colleges or pages), SKIP (colleges to skip), PAUSE (seconds between requests), KEEP, EXTRA (path
     appended to each college host for a second small call, e.g. app/at_mark).
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import probe  # noqa: E402

OUT = HERE / "out"
CAP = int(os.environ.get("CAP") or "150")
SKIP = int(os.environ.get("SKIP") or "0")
PAUSE = float(os.environ.get("PAUSE") or "1.0")
KEEP = int(os.environ.get("KEEP") or "5")
EXTRA = (os.environ.get("EXTRA") or "").strip()
CENTRAL = os.environ.get("CENTRAL") or "https://central.nmcindia.ac.in"
STATS = {"requests": 0, "ok": 0, "fail": 0, "statuses": {}}


def get(url: str, timeout: int = 45, tries: int = 2):
    op = probe.opener_for()
    for attempt in range(tries):
        t0 = time.time()
        s, raw, h, _ = probe.send(op, url, timeout=timeout)
        STATS["requests"] += 1
        STATS["statuses"][str(s)] = STATS["statuses"].get(str(s), 0) + 1
        if s == 200:
            STATS["ok"] += 1
            return s, raw, round(time.time() - t0, 2)
        STATS["fail"] += 1
        time.sleep(PAUSE * 4 if s in (429, 500, 502, 503, 504) else PAUSE)
    return s, raw, round(time.time() - t0, 2)


def text_of(fragment: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", fragment)).strip()


def by_id(page: str, ident: str) -> str:
    m = re.search(r'id="%s"[^>]*>(.*?)</h3>' % re.escape(ident), page, flags=re.S)
    return text_of(m.group(1)) if m else ""


def before_label(page: str, label: str) -> str:
    m = re.search(r"<span[^>]*>\s*([^<]*?)\s*(?:<small>[^<]*</small>)?\s*</span>\s*</h2>\s*<div class=\"knob-label\">\s*%s"
                  % re.escape(label), page, flags=re.S)
    return m.group(1).strip() if m else ""


def parse_dashboard(page: str) -> dict:
    d = re.search(r"Attendance Summary Date:\s*([^<]+)<", page)
    t = re.search(r"<title>([^<]*)</title>", page)
    return {"summary_date": d.group(1).strip() if d else "", "title": text_of(t.group(1)) if t else "",
            "registered": by_id(page, "sub_reg") or by_id(page, "count_reg"),
            "active": by_id(page, "sub_act"), "present": by_id(page, "sub_present1"),
            "out": by_id(page, "sub_out1"), "devices": by_id(page, "sub_act_device1"),
            "avg_in": before_label(page, "Average In-Time"), "avg_out": before_label(page, "Average Out-Time")}


def org_rows(page: str) -> list[dict]:
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, flags=re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, flags=re.S)
        if len(tds) < 7:
            continue
        host = re.search(r'href="(https?://[^"]+)"', tds[6])
        rows.append({"sno": text_of(tds[0]), "org": text_of(tds[1]), "avg_in": text_of(tds[2]),
                     "avg_out": text_of(tds[3]), "avg_stay": text_of(tds[4]), "resp": text_of(tds[5]),
                     "host": host.group(1).rstrip("/") if host else text_of(tds[6])})
    return rows


def aebas() -> None:
    OUT.mkdir(exist_ok=True)
    orgs, offset, empty = [], 0, 0
    while offset <= 2000 and empty < 2:
        url = f"{CENTRAL}/reports/organization" + (f"/index/{offset}" if offset else "")
        s, raw, secs = get(url)
        rows = org_rows(raw.decode("utf-8", "replace")) if s == 200 else []
        print(f"orgs offset {offset}: {s} {len(rows)} rows {secs}s", flush=True)
        if offset == 0:
            (OUT / "orgs_p0.html").write_bytes(raw)
        empty = empty + 1 if not rows else 0
        orgs += rows
        offset += 10
        time.sleep(PAUSE)
        if os.environ.get("ORG_PAGES") and offset >= 10 * int(os.environ["ORG_PAGES"]):
            break
    seen, uniq = set(), []
    for o in orgs:
        if o["host"] not in seen:
            seen.add(o["host"])
            uniq.append(o)
    with open(OUT / "orgs.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["sno", "org", "avg_in", "avg_out", "avg_stay", "resp", "host"])
        w.writeheader()
        w.writerows(uniq)
    print(f"organisations: {len(orgs)} rows, {len(uniq)} distinct hosts", flush=True)
    fields = ["org", "host", "status", "seconds", "read_utc", "summary_date", "title", "registered", "active",
              "present", "out", "devices", "avg_in", "avg_out", "extra_status", "extra_bytes"]
    t_start = time.time()
    with open(OUT / "colleges.csv", "w", newline="", encoding="utf-8") as f, \
            open(OUT / "extra.jsonl", "w", encoding="utf-8") as fx:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for i, o in enumerate(uniq[SKIP:SKIP + CAP]):
            if not o["host"].startswith("http"):
                continue
            s, raw, secs = get(o["host"] + "/")
            page = raw.decode("utf-8", "replace")
            row = {"org": o["org"], "host": o["host"], "status": s, "seconds": secs,
                   "read_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            row |= parse_dashboard(page) if s == 200 else {"title": page[:120]}
            if i < KEEP:
                (OUT / f"college_{i}.html").write_bytes(raw)
            if EXTRA and s == 200:
                time.sleep(PAUSE)
                s2, raw2, _ = get(o["host"] + "/" + EXTRA, tries=1)
                row["extra_status"], row["extra_bytes"] = s2, len(raw2)
                fx.write(json.dumps({"host": o["host"], "status": s2, "body": raw2.decode("utf-8", "replace")[:20000]}) + "\n")
            w.writerow(row)
            f.flush()
            if i % 25 == 0:
                print(f"college {i}: {s} {secs}s {row.get('summary_date','')} reg={row.get('registered','')} "
                      f"present={row.get('present','')}", flush=True)
            time.sleep(PAUSE)
    STATS["college_seconds"] = round(time.time() - t_start, 1)


def register() -> None:
    OUT.mkdir(exist_ok=True)
    base = "https://nmc.org.in/information-desk-college-and-course-search/search"
    rows, page, last = [], 1, 1
    t_start = time.time()
    while page <= last and page <= CAP:
        s, raw, secs = get(f"{base}?page={page}&per_page=500", timeout=90)
        if s != 200:
            print(f"page {page}: {s} {raw[:120]!r}", flush=True)
            break
        j = json.loads(raw)
        last = int(j.get("pagination", {}).get("last_page", 1))
        rows += j.get("data", [])
        if page == 1:
            (OUT / "register_meta.json").write_text(json.dumps({k: v for k, v in j.items() if k != "data"}), encoding="utf-8")
        print(f"page {page}/{last}: {len(j.get('data', []))} rows {len(raw):,} bytes {secs}s", flush=True)
        page += 1
        time.sleep(PAUSE)
    STATS["register_seconds"] = round(time.time() - t_start, 1)
    stamp = time.strftime("%Y%m%dT%H%MZ", time.gmtime())
    (OUT / f"register_{stamp}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    by_day: dict = {}
    for r in rows:
        by_day[r.get("updated_date")] = by_day.get(r.get("updated_date"), 0) + 1
    (OUT / "register_updated_by_day.json").write_text(json.dumps(dict(sorted(by_day.items(), key=lambda kv: str(kv[0]))), indent=1),
                                                      encoding="utf-8")
    print(f"register rows {len(rows)}; days with an update: {len(by_day)}", flush=True)


if __name__ == "__main__":
    for stage in (os.environ.get("STAGE") or "").split(","):
        if stage.strip() == "aebas":
            aebas()
        elif stage.strip() == "register":
            register()
    OUT.mkdir(exist_ok=True)
    (OUT / "sweep_stats.json").write_text(json.dumps(STATS, indent=1), encoding="utf-8")
    print(json.dumps(STATS), flush=True)
