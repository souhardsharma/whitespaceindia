"""Read each probe in probes.json from this runner and record what came back.

A probe: {"name", "url", "kind": "get"|"json"|"postback", "body": null, "headers": {},
          "family": "open"|"india", "times": 1, "save": true, "timeout": 60, "pause": 1.0}
kind "json" POSTs `body` as JSON. kind "postback" GETs the ASP.NET page, keeps its hidden fields
and cookies, then POSTs `fields` (a select may be given by its visible text in `select_text`).
family "open" goes from the runner's own address; "india" through the education pool built on the
runner (scripts/education/refresh_pool.py). TLS is verified on every request; a host that omits
its intermediate certificate has it completed by egress.ensure_chain (signature-checked).
"""
from __future__ import annotations

import gzip
import hashlib
import html
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
sys.path.insert(0, str(HERE / "scripts" / "education"))
import egress  # noqa: E402

CTX = egress.NET.TLS


def opener_for() -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),
                                       urllib.request.HTTPSHandler(context=CTX))


def send(op, url, data=None, headers=None, method=None, timeout=60):
    egress.ensure_chain(url, [None])
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"} | (headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with op.open(req, timeout=timeout) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return r.status, raw, dict(r.headers), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers or {}), url
    except Exception as e:  # noqa: BLE001 - every failure is a recorded result, not a crash
        return -1, f"{type(e).__name__}: {e}".encode(), {}, url


def hidden_fields(page: str) -> dict:
    out = {}
    for tag in re.findall(r"<input[^>]*type=\"hidden\"[^>]*>", page, flags=re.I):
        n = re.search(r'name="([^"]+)"', tag)
        v = re.search(r'value="([^"]*)"', tag)
        if n:
            out[n.group(1)] = html.unescape(v.group(1)) if v else ""
    return out


def option_value(page: str, select: str, text: str) -> str | None:
    m = re.search(r'<select[^>]*name="%s"[^>]*>(.*?)</select>' % re.escape(select), page, flags=re.S | re.I)
    if not m:
        return None
    for val, label in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(1), flags=re.S | re.I):
        if html.unescape(re.sub(r"\s+", " ", label)).strip().upper() == text.strip().upper():
            return val
    return None


def run_probe(p: dict) -> tuple[int, bytes, dict]:
    op = opener_for()
    kind = p.get("kind", "get")
    t = p.get("timeout", 60)
    if kind == "json":
        data = json.dumps(p.get("body") or {}).encode()
        s, raw, h, _ = send(op, p["url"], data, {"Content-Type": "application/json; charset=utf-8",
                                                 "X-Requested-With": "XMLHttpRequest"} | p.get("headers", {}),
                            "POST", t)
        return s, raw, h
    if kind == "postback":
        s, raw, h, url = send(op, p["url"], timeout=t)
        if s != 200:
            return s, raw, h
        page = raw.decode("utf-8", "replace")
        for step in p.get("steps", [{}]):
            fields = hidden_fields(page)
            missing = []
            for sel, txt in step.get("select_text", {}).items():
                v = option_value(page, sel, txt)
                if v is None:
                    missing.append(f"{sel}={txt}")
                else:
                    fields[sel] = v
            if missing:
                return -2, ("option not found: " + ", ".join(missing) + "\n").encode() + raw, h
            fields.update(step.get("fields", {}))
            data = urllib.parse.urlencode(fields).encode()
            time.sleep(1.0)
            s, raw, h, url = send(op, url, data, {"Content-Type": "application/x-www-form-urlencoded",
                                                  "Referer": url}, "POST", t)
            if s != 200:
                return s, raw, h
            page = raw.decode("utf-8", "replace")
        h["final_url"] = url
        return s, raw, h
    if kind == "chain":
        # several GETs on one cookie jar (the LOV sets its item in the session, the frame reads it)
        for u in p.get("before", []):
            send(op, u, timeout=t)
            time.sleep(1.0)
    s, raw, h, url = send(op, p["url"], timeout=t, headers=p.get("headers"))
    if kind == "stub" and s == 200:
        # Odisha report utility: an HTML stub whose script sets window.location to the PDF generator.
        m = re.search(rb'window\.location\.href\s*=\s*"([^"]+)"', raw)
        if not m:
            return -3, b"no stub redirect\n" + raw, h
        time.sleep(1.0)
        s, raw, h, url = send(op, m.group(1).decode(), timeout=p.get("timeout2", 180))
    h["final_url"] = url
    return s, raw, h


_POOL = None


def via_pool(p: dict) -> tuple[int, bytes, dict]:
    global _POOL
    if _POOL is None:
        _POOL = egress.open_pool("india", reload_every=0)
    body = p.get("body")
    data = (json.dumps(body) if isinstance(body, (dict, list)) else body or "").encode() or None
    status, raw = egress.fetch(_POOL, p["url"], data=data, method="POST" if data else "GET",
                               timeout=p.get("timeout", 60), deadline=time.time() + 240)
    return status, raw, {}


def main() -> None:
    OUT.mkdir(exist_ok=True)
    probes = json.loads((HERE / "probes.json").read_text(encoding="utf-8"))
    results = []
    for p in probes:
        for i in range(p.get("times", 1)):
            t0 = time.time()
            status, raw, headers = (via_pool if p.get("family") == "india" else run_probe)(p)
            secs = round(time.time() - t0, 2)
            name = p["name"] + (f"-{i}" if p.get("times", 1) > 1 else "")
            if p.get("save", True) and i == 0:
                (OUT / name).write_bytes(raw)
            row = {"name": name, "url": p["url"], "status": status, "bytes": len(raw), "seconds": secs,
                   "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
                   "sha": hashlib.sha256(raw).hexdigest()[:16], "final_url": headers.get("final_url", ""),
                   "type": headers.get("Content-Type", ""), "last_modified": headers.get("Last-Modified", ""),
                   "etag": headers.get("ETag", ""), "head": raw[:160].decode("utf-8", "replace")}
            results.append(row)
            with open(OUT / "results.jsonl", "a", encoding="utf-8") as fh:
                fh.write(json.dumps(row) + "
")
            print(f"{status:>4} {len(raw):>10,} {secs:>7}s  {name}", flush=True)
            time.sleep(p.get("pause", 1.5))
    (OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a", encoding="utf-8") as s:
        s.write("| status | bytes | s | probe |\n|---|---|---|---|\n")
        for r in results:
            s.write(f"| {r['status']} | {r['bytes']:,} | {r['seconds']} | {r['name']} |\n")


if __name__ == "__main__":
    main()
