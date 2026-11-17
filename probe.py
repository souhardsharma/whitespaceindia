"""Read each probe in probes.json from this runner and record what came back.

A probe: {"name", "url", "method": "GET", "body": null, "headers": {}, "family": "open"|"india",
          "times": 1, "save": true, "timeout": 60}
family "open" goes from the runner's own address; "india" through the education pool built on the
runner (scripts/education/refresh_pool.py). TLS is verified on every request.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CTX = ssl.create_default_context()


def direct(p: dict) -> tuple[int, bytes, dict]:
    headers = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"} | p.get("headers", {})
    body = p.get("body")
    data = (json.dumps(body) if isinstance(body, (dict, list)) else body or "").encode() or None
    req = urllib.request.Request(p["url"], data=data, headers=headers, method=p.get("method", "GET"))
    try:
        with urllib.request.urlopen(req, timeout=p.get("timeout", 60), context=CTX) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return r.status, raw, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers or {})
    except Exception as e:  # noqa: BLE001 - every failure is a recorded result, not a crash
        return -1, f"{type(e).__name__}: {e}".encode(), {}


_POOL = None


def via_pool(p: dict) -> tuple[int, bytes, dict]:
    global _POOL
    sys.path.insert(0, str(HERE / "scripts" / "education"))
    import egress  # noqa: PLC0415
    if _POOL is None:
        _POOL = egress.open_pool("india", reload_every=0)
    body = p.get("body")
    data = (json.dumps(body) if isinstance(body, (dict, list)) else body or "").encode() or None
    status, raw = egress.fetch(_POOL, p["url"], data=data, method=p.get("method", "GET"),
                               timeout=p.get("timeout", 60), deadline=time.time() + 240)
    return status, raw, {}


def main() -> None:
    OUT.mkdir(exist_ok=True)
    probes = json.loads((HERE / "probes.json").read_text(encoding="utf-8"))
    results = []
    for p in probes:
        for i in range(p.get("times", 1)):
            t0 = time.time()
            status, raw, headers = (via_pool if p.get("family") == "india" else direct)(p)
            secs = round(time.time() - t0, 2)
            name = p["name"] + (f"-{i}" if p.get("times", 1) > 1 else "")
            if p.get("save", True) and i == 0:
                (OUT / name).write_bytes(raw)
            row = {"name": name, "url": p["url"], "status": status, "bytes": len(raw), "seconds": secs,
                   "sha": hashlib.sha256(raw).hexdigest()[:16],
                   "type": headers.get("Content-Type", ""), "last_modified": headers.get("Last-Modified", ""),
                   "etag": headers.get("ETag", ""), "head": raw[:160].decode("utf-8", "replace")}
            results.append(row)
            print(f"{status:>4} {len(raw):>10,} {secs:>7}s  {name}", flush=True)
            time.sleep(p.get("pause", 1.0))
    (OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a", encoding="utf-8") as s:
        s.write("| status | bytes | s | probe |\n|---|---|---|---|\n")
        for r in results:
            s.write(f"| {r['status']} | {r['bytes']:,} | {r['seconds']} | {r['name']} |\n")


if __name__ == "__main__":
    main()
