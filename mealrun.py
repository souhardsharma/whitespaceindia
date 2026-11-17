"""Block tables of Himachal Pradesh on the meal host (mdmhp.nic.in) for chosen dates, from this runner.

Public summary tables only (State code 02, district codes 201-212): no school table, no login.
One request at a time, 1.2 s apart, hard cap. Parsed counts only are kept; raw pages are not (the
page footer carries an officer's e-mail address).
Dates: env MEAL_DATES (comma separated ISO dates). Output: out/meal_blocks.json
"""
from __future__ import annotations

import html
import http.cookiejar
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path

NIC = "https://mdmhp.nic.in"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CAP = int(os.environ.get("MEAL_CAP", "520"))
OUT = Path(__file__).resolve().parent / "out"
OUT.mkdir(exist_ok=True)
DATES = [d for d in os.environ.get("MEAL_DATES", "").split(",") if d]
DISTRICTS = [str(c) for c in range(201, 213)]
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
                                     urllib.request.HTTPSHandler(context=ssl.create_default_context()))
LOG, NEXT = [], [0.0]
RES = {"dates": DATES, "blk": {}, "head": None}


def strip(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def req(path):
    if len(LOG) >= CAP:
        raise RuntimeError("cap")
    w = NEXT[0] - time.time()
    if w > 0:
        time.sleep(w)
    h = {"User-Agent": UA, "Accept": "text/html, */*; q=0.01", "X-Requested-With": "XMLHttpRequest",
         "Accept-Encoding": "identity", "Referer": NIC + "/Home/StateWiseSummary/HP"}
    t0 = time.time()
    st, raw = -1, b""
    for attempt in range(3):
        try:
            with OPENER.open(urllib.request.Request(NIC + path, headers=h), timeout=90) as r:
                st, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            st, raw = e.code, e.read()
        except Exception as e:  # noqa: BLE001
            st, raw = -1, f"{type(e).__name__}: {e}".encode()
        if st == 200 or (st != -1 and st < 500 and st != 429):
            break
        time.sleep(10 * (attempt + 1))
    NEXT[0] = time.time() + 1.2
    LOG.append({"path": path, "status": st, "bytes": len(raw), "s": round(time.time() - t0, 2)})
    return st, raw.decode("utf-8", "replace")


def main():
    for iso in DATES:
        y, m, d = iso.split("-")
        for dc in DISTRICTS:
            try:
                st, t = req(f"/Home/GetBlockWiseSummaryHome?stateCode=02&districtCode={dc}&dateYesterday={d}/{m}/{y}")
            except RuntimeError:
                RES["stopped"] = "cap"
                return
            if st != 200:
                RES["blk"][f"{dc}|{iso}"] = {"error": st}
                continue
            rows = []
            for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, flags=re.S):
                cells = [strip(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, flags=re.S)]
                if RES["head"] is None and len(cells) >= 9 and not cells[0].isdigit():
                    RES["head"] = cells
                if len(cells) >= 9 and cells[0].isdigit():
                    rows.append(cells[:9])
            codes = [c[2] for c in re.findall(r"GetClusterwiseSummaryDetail\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,\s*'(\d+)'", t, flags=re.I)]
            RES["blk"][f"{dc}|{iso}"] = {"rows": rows, "codes": codes if len(codes) == len(rows) else []}
        (OUT / "meal_blocks.json").write_text(json.dumps(RES, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    t0 = time.time()
    try:
        main()
    except Exception as e:  # noqa: BLE001
        RES["crash"] = f"{type(e).__name__}: {e}"
    RES["requests"] = len(LOG)
    RES["ok"] = sum(1 for x in LOG if x["status"] == 200)
    RES["seconds"] = round(time.time() - t0)
    RES["mean_s"] = round(sum(x["s"] for x in LOG) / max(1, len(LOG)), 2)
    (OUT / "meal_blocks.json").write_text(json.dumps(RES, ensure_ascii=False), encoding="utf-8")
    (OUT / "meal_log.json").write_text(json.dumps(LOG), encoding="utf-8")
    print({k: v for k, v in RES.items() if k not in ("blk",)})
