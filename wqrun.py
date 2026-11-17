"""Read WQMIS public report calls from this runner, one request at a time, and save what came back.

Plan (plan.json, or the PLAN_JSON environment variable): a list of stages.
  {"kind": "call",  "name", "endpoint", "params": {...}, "raw": {...}, "start": 0, "length": 50, "entry": "Report/Report_L"}
  {"kind": "pages", "name", "endpoint", "params": {...}, "length": 500, "max_pages": 10, "entry": ...}
  {"kind": "get",   "name", "url"}
Every value in "params" is AES-CBC encrypted exactly as the page's own enCriptedAES() does (key and IV are
printed in the page source); "raw" values are sent as they are. The session cookie is taken from a GET of the
entry page, and taken again when an answer comes back as HTML. TLS is verified on every request.
"""
from __future__ import annotations

import base64
import gzip
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
sys.path.insert(0, str(HERE / "scripts" / "education"))
import egress  # noqa: E402

CTX = egress.NET.TLS
KEY = b"8080808080808080"
BASE = "https://ejalshakti.gov.in/WQMIS/"
PAUSE = float(os.environ.get("PAUSE", "1.0"))
COUNT = {"requests": 0, "ok_json": 0, "html": 0, "errors": 0}
LAST = [0.0]


def enc(value: str) -> str:
    p = padding.PKCS7(128).padder()
    data = p.update(str(value).encode("utf-8")) + p.finalize()
    c = Cipher(algorithms.AES(KEY), modes.CBC(KEY)).encryptor()
    return base64.b64encode(c.update(data) + c.finalize()).decode()


class Sess:
    def __init__(self):
        self.new()

    def new(self):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar),
                                              urllib.request.HTTPSHandler(context=CTX))
        self.entered = None

    def send(self, url, data=None, headers=None, timeout=90):
        wait = LAST[0] + PAUSE - time.time()
        if wait > 0:
            time.sleep(wait)
        egress.ensure_chain(url, [None])
        h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"} | (headers or {})
        req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
        t0 = time.time()
        COUNT["requests"] += 1
        try:
            with self.op.open(req, timeout=timeout) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                st = r.status
        except urllib.error.HTTPError as e:
            st, raw = e.code, e.read()
        except Exception as e:  # noqa: BLE001 - a failure is a recorded result
            st, raw = -1, f"{type(e).__name__}: {e}".encode()
        LAST[0] = time.time()
        if st in (429, 500, 502, 503, 504) or st == -1:
            COUNT["errors"] += 1
            time.sleep(8)
        return st, raw, time.time() - t0

    def enter(self, entry):
        if self.entered == entry:
            return
        st, raw, dt = self.send(BASE + entry, headers={"Accept": "text/html"})
        log({"name": "_enter", "entry": entry, "status": st, "bytes": len(raw), "s": round(dt, 2),
             "cookies": [c.name for c in self.jar]})
        if st == 200:
            self.entered = entry

    def post(self, endpoint, params, raw, start, length, entry):
        f = {"draw": "1", "start": str(start), "length": str(length),
             "order[0][column]": "1", "order[0][dir]": "asc"}
        f.update({k: enc(v) for k, v in params.items()})
        f.update(raw or {})
        h = {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
             "X-Requested-With": "XMLHttpRequest",
             "Accept": "application/json, text/javascript, */*; q=0.01",
             "Referer": BASE + entry, "Origin": "https://ejalshakti.gov.in"}
        for attempt in range(3):
            self.enter(entry)
            st, body, dt = self.send(BASE + endpoint, data=urllib.parse.urlencode(f).encode(), headers=h)
            if st == 200 and body[:1] in (b"{", b"["):
                COUNT["ok_json"] += 1
                return st, body, dt
            if st == 200:
                COUNT["html"] += 1
                self.new()          # session gone or never made: take a new cookie and ask again
                continue
            if st not in (429, 500, 502, 503, 504, -1):
                break
        return st, body, dt


def log(rec):
    rec["t"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(OUT / "log.jsonl", "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(json.dumps(rec, ensure_ascii=False)[:400], flush=True)


def shape(body):
    try:
        j = json.loads(body)
    except Exception:  # noqa: BLE001
        return {"json": False, "head": body[:160].decode("utf-8", "replace")}
    if isinstance(j, dict):
        d = j.get("data")
        return {"json": True, "keys": list(j)[:12], "recordsTotal": j.get("recordsTotal"),
                "rows": len(d) if isinstance(d, list) else None,
                "row_keys": list(d[0])[:60] if isinstance(d, list) and d and isinstance(d[0], dict) else None}
    return {"json": True, "list": len(j), "row_keys": list(j[0])[:60] if j and isinstance(j[0], dict) else None}


def fill(obj, row):
    """Replace {Field} in every string of a stage with the row's value (field names matched without case)."""
    low = {k.lower(): v for k, v in row.items()}
    if isinstance(obj, str):
        out = obj
        for k, v in low.items():
            out = out.replace("{" + k + "}", str(v))
        import re
        return re.sub(r"\{(\w+)\}", lambda m: str(low.get(m.group(1).lower(), m.group(0))), out)
    if isinstance(obj, dict):
        return {k: fill(v, row) for k, v in obj.items()}
    if isinstance(obj, list):
        return [fill(v, row) for v in obj]
    return obj


def expand(plan):
    """Yield stages; a foreach stage reads rows of an earlier saved answer when it is reached."""
    for st in plan:
        if st.get("kind") == "foreach":
            try:
                j = json.loads((OUT / f"{st['from']}.json").read_bytes())
                rows = j["data"] if isinstance(j, dict) else j
            except Exception as e:  # noqa: BLE001
                log({"name": "_foreach_failed", "from": st["from"], "why": str(e)[:200]})
                continue
            where = st.get("where")
            if where:
                rows = [r for r in rows if all(str(r.get(k)) not in ("0", "None", "") for k in where)]
            for row in rows[st.get("skip", 0): st.get("skip", 0) + st.get("take", 1)]:
                yield from expand(fill(st["stages"], row))
        else:
            yield st


def main():
    OUT.mkdir(exist_ok=True)
    plan = os.environ.get("PLAN_JSON") or (HERE / "plan.json").read_text(encoding="utf-8")
    plan = json.loads(plan)
    s = Sess()
    cap = int(os.environ.get("CAP", "600"))
    for st in expand(plan):
        if COUNT["requests"] >= cap:
            log({"name": "_cap", "requests": COUNT["requests"]})
            break
        kind, name = st.get("kind", "call"), st["name"]
        entry = st.get("entry", "Report/Report_L")
        if kind == "get":
            code, body, dt = s.send(st["url"], headers={"Accept": "text/html"})
            (OUT / f"{name}.html").write_bytes(body)
            log({"name": name, "status": code, "bytes": len(body), "s": round(dt, 2)})
        elif kind == "call":
            code, body, dt = s.post(st["endpoint"], st.get("params", {}), st.get("raw"),
                                    st.get("start", 0), st.get("length", 50), entry)
            (OUT / f"{name}.json").write_bytes(body)
            log({"name": name, "status": code, "bytes": len(body), "s": round(dt, 2)} | shape(body))
        elif kind == "pages":
            length, start, total, got = st.get("length", 500), st.get("start", 0), None, 0
            for page in range(st.get("max_pages", 10)):
                if COUNT["requests"] >= cap:
                    break
                code, body, dt = s.post(st["endpoint"], st.get("params", {}), st.get("raw"), start, length, entry)
                (OUT / f"{name}.p{page:04d}.json").write_bytes(body)
                sh = shape(body)
                log({"name": f"{name}.p{page:04d}", "status": code, "bytes": len(body), "s": round(dt, 2),
                     "start": start} | sh)
                rows = sh.get("rows") or 0
                total = sh.get("recordsTotal") if sh.get("recordsTotal") is not None else total
                got += rows
                start += length
                if code != 200 or rows == 0 or (total is not None and start >= int(total)):
                    break
            log({"name": name, "pages_done": page + 1, "rows": got, "recordsTotal": total})
    log({"name": "_done"} | COUNT)


if __name__ == "__main__":
    main()
