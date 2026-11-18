"""Throwaway probe: reads open-data catalogues' education records from GitHub's runner and saves them.

Reads only. One request at a time, at least 1 s apart per host. TLS verified (default context).
Each probe in probes.json: {"name", "url", "pages": n (SODA paging by $offset), "page": rows per page}.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
UA = "edu-probe/1.0 (open-data reader)"
LAST: dict[str, float] = {}
LOG: list[dict] = []
COUNT: dict[str, int] = {}


def get(url: str, timeout: int = 120) -> tuple[int, bytes, float]:
    host = urllib.parse.urlsplit(url).hostname or ""
    wait = LAST.get(host, 0) + 1.0 - time.time()
    if wait > 0:
        time.sleep(wait)
    t = time.time()
    COUNT[host] = COUNT.get(host, 0) + 1
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        body, code = e.read()[:2000], e.code
    except Exception as e:  # transport
        body, code = repr(e).encode(), -1
    LAST[host] = time.time()
    return code, body, time.time() - t


def main() -> None:
    probes = json.loads((HERE / "probes.json").read_text(encoding="utf-8"))
    for p in probes:
        pages = p.get("pages", 1)
        for k in range(pages):
            url = p["url"]
            if pages > 1:
                url += f"&$limit={p['page']}&$offset={k * p['page']}"
            for attempt in range(3):
                code, body, secs = get(url, p.get("timeout", 120))
                if code == 200 or code in (400, 403, 404):
                    break
                time.sleep(5 * (attempt + 1))
            name = p["name"] + (f".p{k:02d}" if pages > 1 else "")
            ext = p.get("ext", "json")
            (OUT / f"{name}.{ext}").write_bytes(body)
            rows = None
            if ext == "json" and code == 200:
                try:
                    rows = len(json.loads(body))
                except Exception:
                    pass
            LOG.append({"name": name, "url": url, "status": code, "bytes": len(body), "secs": round(secs, 2), "rows": rows})
            print(name, code, len(body), round(secs, 1), rows, flush=True)
            if pages > 1 and code == 200 and rows is not None and rows < p["page"]:
                break
    (OUT / "log.json").write_text(json.dumps({"requests": LOG, "per_host": COUNT,
                                              "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, indent=1))


if __name__ == "__main__":
    main()
