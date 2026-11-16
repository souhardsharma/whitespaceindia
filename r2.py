"""Throwaway probe: reads candidate sources from this runner, one request at a time per host.

plan.json is a list of steps:
  {"name", "url", "method": "GET"|"POST", "data": {form fields} | null,
   "postback": {"from": "<earlier step>", "form": 0, "set": {field: value}, "button": "<name>"|null,
                "drop": [fields to leave out]},
   "pause": seconds, "timeout": seconds, "via": "direct"|"india"}
A postback re-reads the form of an earlier saved page (ASP.NET style), keeps its hidden fields,
applies "set" and posts it to the form's action with that host's cookies.
TLS is verified on every request. Legacy renegotiation is allowed (some NIC hosts need it);
that changes nothing about certificate or hostname checks.
"""
from __future__ import annotations

import gzip
import hashlib
import http.cookiejar
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

CTX = ssl.create_default_context()
CTX.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
try:
    CTX.set_ciphers("DEFAULT:@SECLEVEL=1")
except ssl.SSLError:
    pass

JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPSHandler(context=CTX),
                                     urllib.request.HTTPCookieProcessor(JAR))


class Forms(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.forms, self._sel, self._opt = [], None, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form":
            self.forms.append({"action": a.get("action", ""), "method": a.get("method", "get"),
                               "inputs": [], "selects": {}})
        if not self.forms:
            return
        f = self.forms[-1]
        if tag == "input":
            f["inputs"].append({"name": a.get("name"), "type": (a.get("type") or "text").lower(),
                                "value": a.get("value", ""), "checked": "checked" in a})
        elif tag == "select":
            self._sel = a.get("name")
            f["selects"][self._sel] = []
        elif tag == "option" and self._sel:
            self._opt = {"value": a.get("value"), "selected": "selected" in a, "text": ""}
            f["selects"][self._sel].append(self._opt)
        elif tag == "textarea":
            f["inputs"].append({"name": a.get("name"), "type": "textarea", "value": ""})

    def handle_data(self, data):
        if self._opt is not None:
            self._opt["text"] += data.strip()

    def handle_endtag(self, tag):
        if tag == "select":
            self._sel = None
        if tag == "option":
            self._opt = None


def forms_of(raw: bytes) -> list:
    p = Forms()
    try:
        p.feed(raw.decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001
        pass
    return p.forms


def send(url, method="GET", data=None, timeout=90, headers=None):
    body = urllib.parse.urlencode(data).encode() if isinstance(data, dict) else data
    h = {"User-Agent": UA, "Accept": "text/html,application/json,*/*", "Accept-Encoding": "gzip"}
    if body is not None and isinstance(data, dict):
        h["Content-Type"] = "application/x-www-form-urlencoded"
    h |= headers or {}
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with OPENER.open(req, timeout=timeout) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return r.status, raw, r.geturl(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), url, dict(e.headers or {})
    except Exception as e:  # noqa: BLE001 - recorded, not raised
        return -1, f"{type(e).__name__}: {e}".encode(), url, {}


_POOL = None


def send_india(url, method="GET", data=None, timeout=90):
    global _POOL
    sys.path.insert(0, str(HERE / "scripts" / "education"))
    import egress  # noqa: PLC0415
    if _POOL is None:
        _POOL = egress.open_pool("india", reload_every=0)
    body = urllib.parse.urlencode(data).encode() if isinstance(data, dict) else data
    status, raw = egress.fetch(_POOL, url, data=body, method=method, timeout=timeout,
                               deadline=time.time() + 240)
    return status, raw, url, {}


def build_postback(saved: dict, pb: dict):
    raw, base = saved["raw"], saved["final"]
    forms = forms_of(raw)
    f = forms[pb.get("form", 0)]
    fields = {}
    for i in f["inputs"]:
        if not i["name"] or i["type"] in ("submit", "button", "image", "reset"):
            continue
        if i["type"] in ("checkbox", "radio") and not i.get("checked"):
            continue
        fields[i["name"]] = i["value"]
    for name, opts in f["selects"].items():
        if not name or not opts:
            continue
        sel = [o for o in opts if o["selected"]] or opts[:1]
        fields[name] = sel[0]["value"] if sel[0]["value"] is not None else sel[0]["text"]
    import re as _re
    chosen = None
    for ch in pb.get("choose", []):
        for name, opts in f["selects"].items():
            if not name or (ch.get("select") and not _re.search(ch["select"], name, _re.I)):
                continue
            hit = next((o for o in opts if _re.search(ch["option"], f"{o['value']} {o['text']}", _re.I)), None)
            if hit:
                fields[name] = hit["value"] if hit["value"] is not None else hit["text"]
                chosen = name
                break
    for k in pb.get("drop", []):
        fields.pop(k, None)
    fields |= pb.get("set", {})
    if pb.get("event") == "auto" and chosen:
        fields["__EVENTTARGET"] = chosen
    elif pb.get("event"):
        fields["__EVENTTARGET"] = pb["event"]
    if pb.get("button_regex"):
        btn = next((i for i in f["inputs"] if i["name"] and i["type"] in ("submit", "button", "image")
                    and _re.search(pb["button_regex"], i["name"], _re.I)), None)
        if btn and btn["type"] == "image":
            fields[btn["name"] + ".x"], fields[btn["name"] + ".y"] = "10", "10"
        elif btn:
            fields[btn["name"]] = btn["value"]
    if pb.get("button"):
        btn = next((i for i in f["inputs"] if i["name"] == pb["button"]), None)
        fields[pb["button"]] = (btn or {}).get("value", "") or pb.get("button_value", "")
    action = urllib.parse.urljoin(base, f["action"] or base)
    return action, fields


def main() -> None:
    OUT.mkdir(exist_ok=True)
    plan = json.loads((HERE / "plan.json").read_text(encoding="utf-8"))
    saved, results = {}, []
    for s in plan:
        url, method, data = s.get("url"), s.get("method", "GET"), s.get("data")
        if "postback" in s:
            src = saved.get(s["postback"]["from"])
            if not src:
                results.append({"name": s["name"], "status": "skipped: no source page"})
                continue
            try:
                url, data = build_postback(src, s["postback"])
                method = "POST"
            except Exception as e:  # noqa: BLE001
                results.append({"name": s["name"], "status": f"skipped: {e}"})
                continue
        t0 = time.time()
        if s.get("via") == "india":
            status, raw, final, headers = send_india(url, method, data, s.get("timeout", 90))
        else:
            status, raw, final, headers = send(url, method, data, s.get("timeout", 90), s.get("headers"))
        secs = round(time.time() - t0, 2)
        saved[s["name"]] = {"raw": raw, "final": final}
        ext = ".json" if raw[:1] in (b"{", b"[") else ".html"
        (OUT / (s["name"] + ext)).write_bytes(raw)
        fm = forms_of(raw) if ext == ".html" else []
        if fm:
            slim = [{"action": f["action"], "inputs": [(i["name"], i["type"], i["value"][:60])
                                                     for i in f["inputs"] if i["name"] != "__VIEWSTATE"],
                     "selects": {k: [(o["value"], o["text"][:40], o["selected"]) for o in v[:400]]
                                 for k, v in f["selects"].items()}} for f in fm]
            (OUT / (s["name"] + ".forms.json")).write_text(json.dumps(slim, indent=1, ensure_ascii=False),
                                                         encoding="utf-8")
        row = {"name": s["name"], "via": s.get("via", "direct"), "method": method, "url": url,
               "final": final, "status": status, "bytes": len(raw), "seconds": secs,
               "sha": hashlib.sha256(raw).hexdigest()[:16], "type": headers.get("Content-Type", ""),
               "posted_fields": sorted((data or {}).keys()) if isinstance(data, dict) else None,
               "at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0))}
        results.append(row)
        print(f"{status!s:>4} {len(raw):>10,} {secs:>7}s  {s['name']}  -> {final}", flush=True)
        (OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
        time.sleep(s.get("pause", 2.0))
    (OUT / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a", encoding="utf-8") as fh:
        for r in results:
            fh.write(f"- {r.get('status')} {r.get('bytes', '')} B {r.get('seconds', '')} s {r['name']}\n")


if __name__ == "__main__":
    main()
