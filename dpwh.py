"""Read the public works department's school-building contracts from this runner.

1. Every contract the portal finds for "classroom" (17 pages of 1,000), saved as returned.
2. A compact snapshot (id, status, progress, start, completion) for a re-read 24 hours later.
3. The detail record of every contract not yet completed or terminated, and of every contract
   completed since 2026-01-01: expiry date, procurement dates, components.
One connection, at least 1.1 s between requests, back off on 429/5xx. Reads only.
"""
from __future__ import annotations

import csv
import gzip
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out" / "dpwh"
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(HERE / "scripts" / "education"))
import egress  # noqa: E402

CTX = egress.NET.TLS
API = "https://api.transparency.dpwh.gov.ph"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
HDR = {"User-Agent": UA, "Accept": "application/json", "Origin": "https://transparency.dpwh.gov.ph",
       "Referer": "https://transparency.dpwh.gov.ph/"}
LOG = []
DEADLINE = time.time() + 62 * 60


def get(path: str, tries: int = 3):
    url = API + path
    for i in range(tries):
        t0 = time.time()
        try:
            egress.ensure_chain(url, [None])
            req = urllib.request.Request(url, headers=HDR)
            with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
                body = r.read()
                LOG.append([path, r.status, len(body), round(time.time() - t0, 2)])
                time.sleep(1.1)
                return r.status, body
        except urllib.error.HTTPError as e:
            LOG.append([path, e.code, 0, round(time.time() - t0, 2)])
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(10 * (i + 1))
                continue
            return e.code, b""
        except Exception as e:  # noqa: BLE001 - recorded, not raised
            LOG.append([path, -1, str(e)[:120], round(time.time() - t0, 2)])
            time.sleep(5 * (i + 1))
    return -1, b""


def main() -> None:
    rows = []
    for page in range(1, 25):
        st, body = get(f"/projects?search=classroom&limit=1000&page={page}")
        if st != 200:
            break
        (OUT / f"list_classroom_p{page:02d}.json.gz").write_bytes(gzip.compress(body))
        d = json.loads(body)["data"]
        rows += d["data"]
        if not d["pagination"]["hasNext"]:
            break
    stamp = time.strftime("%Y%m%dT%H%MZ", time.gmtime())
    with open(OUT / f"snapshot_{stamp}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["contractId", "status", "progress", "startDate", "completionDate", "budget", "sourceOfFunds"])
        for r in rows:
            w.writerow([r["contractId"], r["status"], r["progress"], r["startDate"], r["completionDate"],
                        r["budget"], r["sourceOfFunds"]])
    want = [r["contractId"] for r in rows
            if r["status"] in ("For Procurement", "Not Yet Started", "On-Going")
            or (r["status"] == "Completed" and (r["completionDate"] or "") >= "2026-01-01")]
    details = {}
    for cid in want:
        if time.time() > DEADLINE:
            break
        st, body = get(f"/projects/{cid}")
        if st == 200:
            details[cid] = json.loads(body)["data"]
    (OUT / "details.json.gz").write_bytes(gzip.compress(json.dumps(details).encode()))
    (OUT / "log.json").write_text(json.dumps({"rows": len(rows), "wanted": len(want), "details": len(details),
                                              "requests": LOG}, indent=0), encoding="utf-8")
    print(f"rows {len(rows)} wanted {len(want)} details {len(details)} requests {len(LOG)}")


if __name__ == "__main__":
    main()
