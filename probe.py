"""Read a plan of GET/POST steps from this runner and save what came back, gzipped.

A step: {"name", "url", "body": null, "headers": {}, "range": [start, stop, step] (fills {i} in url),
         "next": "meta.nextLink" (follow a link found in the JSON answer, up to "max_pages"),
         "stop_empty": "data" (stop a range when this JSON key is an empty list),
         "pause": 1.0, "timeout": 90, "save": true}
The plan is plans/<PLAN>.json, or PLAN itself when it starts with "[".
One connection at a time; at least `pause` seconds between requests to a host; at most
HOST_CAP requests to one host in a run; a 429 or 5xx is waited out and asked again twice.
TLS is verified (Python's default context).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
UA = "Mozilla/5.0 (X11; Linux x86_64) research-probe/1.0"
HOST_CAP = 600
HOST_COUNT: dict[str, int] = {}
HOST_LAST: dict[str, float] = {}


def send(url, data=None, headers=None, timeout=90):
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"} | (headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return r.status, raw, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers or {})
    except Exception as e:  # noqa: BLE001 - a failure is a recorded result
        return -1, f"{type(e).__name__}: {e}".encode(), {}


def polite(url, pause, cap):
    host = urllib.parse.urlsplit(url).netloc
    if HOST_COUNT.get(host, 0) >= cap:
        return False
    wait = HOST_LAST.get(host, 0) + pause - time.time()
    if wait > 0:
        time.sleep(wait)
    HOST_COUNT[host] = HOST_COUNT.get(host, 0) + 1
    HOST_LAST[host] = time.time()
    return True


def dig(obj, path):
    for k in path.split("."):
        if not isinstance(obj, dict):
            return None
        obj = obj.get(k)
    return obj


def one(step, url, name, results):
    pause = step.get("pause", 1.0)
    cap = step.get("cap", HOST_CAP)
    body = step.get("body")
    data = (json.dumps(body) if isinstance(body, (dict, list)) else body or "").encode() or None
    headers = dict(step.get("headers", {}))
    if isinstance(body, (dict, list)):
        headers.setdefault("Content-Type", "application/json")
    for attempt in range(3):
        if not polite(url, pause, cap):
            results.append({"name": name, "url": url, "status": -3, "note": "host cap reached"})
            return -3, b""
        t0 = time.time()
        status, raw, h = send(url, data, headers, step.get("timeout", 90))
        secs = round(time.time() - t0, 2)
        if status in (429, 500, 502, 503, 504) and attempt < 2:
            time.sleep(20 * (attempt + 1))
            continue
        break
    if step.get("save", True):
        (OUT / (name + ".gz")).write_bytes(gzip.compress(raw, 6))
    results.append({"name": name, "url": url, "status": status, "bytes": len(raw), "seconds": secs,
                    "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
                    "sha": hashlib.sha256(raw).hexdigest()[:16], "type": h.get("Content-Type", ""),
                    "last_modified": h.get("Last-Modified", ""), "etag": h.get("ETag", ""),
                    "ratelimit": {k: v for k, v in h.items() if "ratelimit" in k.lower() or k.lower() == "retry-after"},
                    "head": raw[:200].decode("utf-8", "replace")})
    print(f"{status:>4} {len(raw):>11,} {secs:>7}s  {name}", flush=True)
    return status, raw


def main() -> None:
    OUT.mkdir(exist_ok=True)
    plan = os.environ.get("PLAN", "default").strip()
    steps = json.loads(plan) if plan.startswith("[") else json.loads(
        (HERE / "plans" / (plan + ".json")).read_text(encoding="utf-8"))
    results: list[dict] = []
    for step in steps:
        if "range" in step:
            a, b, c = step["range"]
            for i in range(a, b, c):
                status, raw = one(step, step["url"].replace("{i}", str(i)), f"{step['name']}-{i}", results)
                if status != 200:
                    break
                key = step.get("stop_empty")
                if key:
                    try:
                        if not dig(json.loads(raw), key):
                            break
                    except ValueError:
                        break
        elif "next" in step:
            url, n = step["url"], 0
            while url and n < step.get("max_pages", 50):
                status, raw = one(step, url, f"{step['name']}-{n}", results)
                n += 1
                if status != 200:
                    break
                try:
                    url = dig(json.loads(raw), step["next"])
                except ValueError:
                    url = None
        else:
            one(step, step["url"], step["name"], results)
        (OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
    (OUT / "host_counts.json").write_text(json.dumps(HOST_COUNT, indent=1), encoding="utf-8")
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a", encoding="utf-8") as s:
        s.write("| status | bytes | s | probe |\n|---|---|---|---|\n")
        for r in results[:300]:
            s.write(f"| {r['status']} | {r.get('bytes', 0):,} | {r.get('seconds', '')} | {r['name']} |\n")


if __name__ == "__main__":
    main()
