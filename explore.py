"""Walk an ASP.NET public report page by its own dropdowns, read-only, and save every page it shows.

For each target in explore.json: GET the page, then repeatedly pick an option in the first select whose
value is still unset (preferring texts in `prefer`, else the second option), post back with that select as
__EVENTTARGET, and save the answer. When no select is left unset, press the first submit button whose
value matches `press`. At most `max_requests` requests per target, `pause` seconds apart. TLS verified.
"""
from __future__ import annotations

import html
import json
import re
import time
import urllib.parse
from pathlib import Path

import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import probe  # noqa: E402  reuses send(), opener_for(), hidden_fields()
OUT = HERE / "out" / "explore"


def selects(page: str) -> list[tuple[str, list[tuple[str, str, bool]]]]:
    out = []
    for name, body in re.findall(r'<select[^>]*name="([^"]+)"[^>]*>(.*?)</select>', page, flags=re.S | re.I):
        opts = []
        for attrs, label in re.findall(r'<option([^>]*)>(.*?)</option>', body, flags=re.S | re.I):
            v = re.search(r'value="([^"]*)"', attrs)
            opts.append((html.unescape(v.group(1)) if v else "", html.unescape(re.sub(r"\s+", " ", label)).strip(),
                         "selected" in attrs.lower()))
        out.append((name, opts))
    return out


def submits(page: str) -> list[tuple[str, str]]:
    out = []
    for tag in re.findall(r'<input[^>]*type="(?:submit|button)"[^>]*>', page, flags=re.I):
        n = re.search(r'name="([^"]+)"', tag)
        v = re.search(r'value="([^"]*)"', tag)
        if n:
            out.append((n.group(1), html.unescape(v.group(1)) if v else ""))
    return out


def explore(t: dict, log: list) -> None:
    op = probe.opener_for()
    name, url = t["name"], t["url"]
    pause, cap, prefer = t.get("pause", 2.0), t.get("max_requests", 20), [p.upper() for p in t.get("prefer", [])]
    press = [p.upper() for p in t.get("press", ["VIEW", "SHOW", "SUBMIT", "GO", "SEARCH", "GET"])]
    n = 0
    s, raw, h, url = probe.send(op, url, timeout=t.get("timeout", 60))
    n += 1
    (OUT / f"{name}-00.html").write_bytes(raw)
    log.append({"target": name, "step": 0, "status": s, "bytes": len(raw), "action": "GET " + url})
    if s != 200:
        return
    page = raw.decode("utf-8", "replace")
    chosen: dict[str, str] = {}
    while n < cap:
        fields = probe.hidden_fields(page)
        sel = selects(page)
        for nm, opts in sel:  # keep what the page itself has selected
            for v, lab, is_sel in opts:
                if is_sel:
                    fields[nm] = v
        fields.update(chosen)
        target = None
        for nm, opts in sel:
            if nm in chosen or len(opts) < 2:
                continue
            pick = None
            for v, lab, _ in opts:
                if any(p == lab.upper() or p in lab.upper() for p in prefer):
                    pick = v
                    break
            if pick is None:
                real = [v for v, lab, _ in opts if v not in ("", "0", "-1") and not lab.startswith("--")]
                pick = real[0] if real else opts[1][0]
            target = (nm, pick)
            break
        if target:
            chosen[target[0]] = target[1]
            fields[target[0]] = target[1]
            fields["__EVENTTARGET"] = target[0]
            action = f"select {target[0]}={target[1]}"
        else:
            btn = next(((bn, bv) for bn, bv in submits(page) if any(p in bv.upper() for p in press)), None)
            links = re.findall(r"__doPostBack\('([^']+)','((?:Select|Page)\$[^']*)'\)", page)
            follow = t.get("follow", [])  # e.g. ["Select$9", "Select$0", ...] one per drill level
            if (not btn or t.get("_pressed")) and links and t.get("_level", 0) < len(follow):
                want = follow[t.get("_level", 0)]
                # deepest grid first: the last grid named on the page is the newest drill level
                grids = []
                for g, a in links:
                    if g not in grids:
                        grids.append(g)
                grid = grids[-1]
                t["_level"] = t.get("_level", 0) + 1
                fields["__EVENTTARGET"], fields["__EVENTARGUMENT"] = grid, want
                action = f"follow {grid} {want}"
                time.sleep(pause)
                s, raw, h, url = probe.send(op, url, urllib.parse.urlencode(fields).encode(),
                                            {"Content-Type": "application/x-www-form-urlencoded", "Referer": url},
                                            "POST", t.get("timeout", 60))
                n += 1
                (OUT / f"{name}-{n - 1:02d}.html").write_bytes(raw)
                log.append({"target": name, "step": n - 1, "status": s, "bytes": len(raw), "action": action})
                print(s, len(raw), name, action, flush=True)
                if s != 200:
                    break
                page = raw.decode("utf-8", "replace")
                continue
            if not btn or t.get("_pressed"):
                break
            t["_pressed"] = True
            fields[btn[0]] = btn[1]
            fields["__EVENTTARGET"] = ""
            action = f"press {btn[0]}={btn[1]}"
        time.sleep(pause)
        s, raw, h, url = probe.send(op, url, urllib.parse.urlencode(fields).encode(),
                                    {"Content-Type": "application/x-www-form-urlencoded", "Referer": url},
                                    "POST", t.get("timeout", 60))
        n += 1
        (OUT / f"{name}-{n - 1:02d}.html").write_bytes(raw)
        log.append({"target": name, "step": n - 1, "status": s, "bytes": len(raw), "action": action,
                    "selects": [(nm, len(o)) for nm, o in selects(raw.decode('utf-8', 'replace'))]})
        print(s, len(raw), name, action, flush=True)
        if s != 200:
            break
        page = raw.decode("utf-8", "replace")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    log: list = []
    for t in json.loads((HERE / "explore.json").read_text(encoding="utf-8")):
        try:
            explore(t, log)
        except Exception as e:  # noqa: BLE001 - recorded, not fatal
            log.append({"target": t["name"], "error": f"{type(e).__name__}: {e}"})
    (OUT / "log.json").write_text(json.dumps(log, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
