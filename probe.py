"""Read NCMEI's public listings and every PDF they link (cause lists, daily orders, judgements, certificate
register) from this runner's own address, one request at a time, and record what came back.

Only reads. TLS is verified on every request (egress.ensure_chain completes a missing intermediate, signature
checked). Output: out/log.jsonl (one line per request), out/idx/*.html, out/pdf/<kind>/<file>.pdf.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
sys.path.insert(0, str(HERE / "scripts" / "education"))
import egress  # noqa: E402

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
OP = urllib.request.build_opener(urllib.request.HTTPSHandler(context=egress.NET.TLS))
LOG = None
SITE = "https://ncmei.gov.in"


def get(url: str, timeout: int = 90, tries: int = 3) -> tuple[int, bytes]:
    status, body = -1, b""
    for attempt in range(1, tries + 1):
        egress.ensure_chain(url, [None])
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"})
        t0 = time.time()
        try:
            with OP.open(req, timeout=timeout) as r:
                body = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                status = r.status
        except urllib.error.HTTPError as e:
            status, body = e.code, e.read()
        except Exception as e:  # noqa: BLE001 - recorded, not raised
            status, body = -1, f"{type(e).__name__}: {e}".encode()
        LOG.write(json.dumps({"url": url, "try": attempt, "status": status, "bytes": len(body),
                              "s": round(time.time() - t0, 2), "at": time.strftime("%H:%M:%S")}) + "\n")
        LOG.flush()
        time.sleep(1.0)
        if status == 200:
            return status, body
        time.sleep(4 * attempt)
    return status, body


def listing(path: str, pages: int, name: str) -> list[tuple[str, str]]:
    """Return (title, pdf url) for every row of a paged WordPress document listing."""
    rows = []
    for p in range(1, pages + 1):
        url = f"{SITE}/{path}/" if p == 1 else f"{SITE}/{path}/page/{p}/"
        st, body = get(url)
        if st != 200:
            continue
        t = body.decode("utf-8", "replace")
        (OUT / "idx" / f"{name}_p{p}.html").write_text(t, encoding="utf-8")
        for tr in re.findall(r"<tr.*?</tr>", t, re.S):
            m = re.search(r'href="(https://cdnbbsr[^"]+\.pdf)"', tr)
            if m:
                title = " ".join(re.sub(r"<[^>]+>", " ", tr).split())[:160]
                rows.append((title, m.group(1)))
        if p > 1 and not re.search(rf"/page/{p + 1}", t):
            break
    return rows


def main() -> int:
    global LOG
    (OUT / "idx").mkdir(parents=True, exist_ok=True)
    LOG = open(OUT / "log.jsonl", "w", encoding="utf-8")
    plan = {
        "cl": ("cause-list", 17),
        "do26": ("document-category/daily-orders-2026", 9),
        "do25": ("document-category/daily-orders-2025", 9),
        "ju26": ("document-category/judgements-2026", 11),
        "ju25": ("document-category/judgements-2025", 12),
        "stat": ("statistics", 1),
    }
    found = {}
    for name, (path, pages) in plan.items():
        found[name] = listing(path, pages, name)
        print(name, len(found[name]), flush=True)
    (OUT / "listings.json").write_text(json.dumps(found, indent=1), encoding="utf-8")
    # PDFs: everything uploaded since 2025-11-01 (a year of cause lists and orders), all 2026 judgements, register
    for name, rows in found.items():
        d = OUT / "pdf" / name
        d.mkdir(parents=True, exist_ok=True)
        for title, url in rows:
            m = re.search(r"uploads/(\d{4})/(\d{2})/", url)
            ym = m.group(1) + m.group(2) if m else "000000"
            fn = url.rsplit("/", 1)[1]
            up = fn[:8]
            if name in ("do25", "ju25") and up < "20251101":
                continue
            if name == "cl" and ym < "202510":
                continue
            st, body = get(url, timeout=150)
            if st == 200 and body[:4] == b"%PDF":
                (d / fn).write_bytes(body)
    LOG.close()
    ok = sum(1 for line in open(OUT / "log.jsonl", encoding="utf-8") if json.loads(line)["status"] == 200)
    print("requests 200:", ok, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
