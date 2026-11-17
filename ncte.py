"""Read NCTE's register of teacher-education institutions (web.ncte.gov.in) from this runner.

Throwaway probe. One connection, about one request a second, a cap on requests per run.
Discovers the State list pages from the site, reads page 1 of each to learn its page count,
then reads the pages assigned to this part (PART=i/n). Raw pages are saved gzipped to out/ncte/.
TLS is verified; a missing intermediate is completed by egress.ensure_chain.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "scripts" / "education"))
import egress  # noqa: E402

OUT = HERE / "out" / "ncte"
BASE = "https://web.ncte.gov.in"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CAP = int(os.environ.get("CAP", "600"))
SKIP = int(os.environ.get("SKIP", "0"))
PAUSE = float(os.environ.get("PAUSE", "1.0"))
LOG: list[dict] = []


def get(url: str, timeout: int = 60) -> tuple[int, bytes]:
    if len(LOG) >= CAP:
        return -9, b"cap"
    egress.ensure_chain(url, [None])
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    t0 = time.time()
    status, raw = -1, b""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=egress.NET.TLS) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                status = r.status
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
        except Exception as e:  # noqa: BLE001
            status, raw = -1, f"{type(e).__name__}: {e}".encode()
        if status == 200 or status in (403, 404):
            break
        time.sleep(5 * (attempt + 1))
    LOG.append({"url": url, "status": status, "bytes": len(raw), "s": round(time.time() - t0, 2),
                "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0))})
    time.sleep(PAUSE)
    return status, raw


def save(name: str, raw: bytes) -> None:
    (OUT / (name + ".html.gz")).write_bytes(gzip.compress(raw))


def last_page(page: str) -> int:
    nums = [int(n) for n in re.findall(r"[?&]page=(\d+)", page)]
    return max(nums) if nums else 1


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    s, home = get(BASE + "/")
    save("home", home)
    links = sorted(set(re.findall(r'href="(?:https?://web\.ncte\.gov\.in)?(/page-regional-committee-institution-lists[^"?#]*)"',
                                  home.decode("utf-8", "replace"))))
    if not links:
        s, idx = get(BASE + "/page-regional-committee-institution-lists")
        save("index", idx)
        links = sorted(set(re.findall(r'href="(?:https?://web\.ncte\.gov\.in)?(/page-regional-committee-institution-lists[^"?#]*)"',
                                      idx.decode("utf-8", "replace"))))
    lists = [l for l in links if re.search(r"/\d+/[^/]+$", l)]
    if not lists:  # fall back to State ids seen in the wild
        lists = [f"/page-regional-committee-institution-lists/{k}/x" for k in range(1, 39)]
    plan = []
    for li, path in enumerate(lists):
        s, p1 = get(BASE + path)
        name = path.strip("/").replace("/", "_")
        save(f"{name}_p1", p1)
        lp = last_page(p1.decode("utf-8", "replace")) if s == 200 else 0
        plan.append({"path": path, "status": s, "pages": lp})
        # sibling list types linked from this page (withdrawn etc.)
        for sib in sorted(set(re.findall(r'href="(?:https?://web\.ncte\.gov\.in)?(/page-regional-committee-institution-lists-[a-z]+/\d+/[^"?#]+)"',
                                  p1.decode("utf-8", "replace")))):
            if sib not in lists:
                lists.append(sib)
    (OUT / "plan.json").write_text(json.dumps(plan, indent=1), encoding="utf-8")
    todo = [(row["path"], pg) for row in plan for pg in range(2, row["pages"] + 1)]
    for path, pg in todo[SKIP:]:
        s, raw = get(f"{BASE}{path}?page={pg}")
        if s == -9:
            break
        save(f"{path.strip('/').replace('/', '_')}_p{pg}", raw)
    print(f"pages after page 1: {len(todo)}; this run started at {SKIP}")
    (OUT / "log.json").write_text(json.dumps(LOG, indent=0), encoding="utf-8")
    ok = sum(1 for r in LOG if r["status"] == 200)
    print(f"ncte: {len(LOG)} requests, {ok} ok, lists {len(plan)}, pages planned {sum(r['pages'] for r in plan)}")
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a", encoding="utf-8") as f:
        f.write(f"ncte: {len(LOG)} requests, {ok} ok, lists {len(plan)}, pages planned {sum(r['pages'] for r in plan)}\n")


if __name__ == "__main__":
    main()
