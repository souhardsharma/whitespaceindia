"""Read Karnataka's SATS recognition registers from this runner, gently, and save what came back.

One host, one connection, at least 1 s between requests, a hard request cap and a time budget.
Only public GET/POST endpoints that the public SATS dashboard pages themselves call. TLS verified.
"""
from __future__ import annotations

import gzip
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
sys.path.insert(0, str(HERE / "scripts" / "education"))
import egress  # noqa: E402

CTX = egress.NET.TLS
BASE = "https://sts.karnataka.gov.in/SDB"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CAP = 950
DEADLINE = time.time() + 34 * 60
LOG: list[dict] = []
OP = urllib.request.build_opener(urllib.request.HTTPSHandler(context=CTX))
_last = [0.0]


def req(path: str, data: dict | None = None, timeout: int = 60) -> tuple[int, bytes]:
    if len(LOG) >= CAP or time.time() > DEADLINE:
        return -2, b"budget"
    wait = 1.0 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    url = BASE + path
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    egress.ensure_chain(url, [None])
    r = urllib.request.Request(url, data=body, headers={"User-Agent": UA, "Accept": "*/*",
                                                        "Accept-Encoding": "gzip",
                                                        "X-Requested-With": "XMLHttpRequest"})
    t0 = time.time()
    try:
        with OP.open(r, timeout=timeout) as resp:
            raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            st = resp.status
    except urllib.error.HTTPError as e:
        st, raw = e.code, e.read()
    except Exception as e:  # noqa: BLE001 - a failure is a recorded result
        st, raw = -1, f"{type(e).__name__}: {e}".encode()
    _last[0] = time.time()
    LOG.append({"path": path[:200], "post": data is not None, "status": st, "bytes": len(raw),
                "s": round(time.time() - t0, 2), "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    if st in (429, 503):
        time.sleep(20)
    return st, raw


def common(svc: str, obj: dict, sats: bool = False) -> list:
    host = "getCommonWebDataSats.htm" if sats else "getCommonWebDataSDB.htm"
    path = (f"/commonweb/{host}?serviceType=other&serviceName={svc}&reqData="
            + urllib.parse.quote(json.dumps(obj, separators=(",", ":"))))
    st, raw = req(path)
    if st != 200:
        return [{"_error": st, "_body": raw[:200].decode("utf-8", "replace")}]
    try:
        j = json.loads(raw)
        return j.get("payload") or []
    except Exception:  # noqa: BLE001
        return [{"_error": "notjson", "_body": raw[:200].decode("utf-8", "replace")}]


def save(name: str, obj) -> None:
    (OUT / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    years = ["2026-2027", "2025-2026", "2024-2025"]
    types = ["RR", "FR", "NS", "NOC", "PP"]
    dash, auto = {}, {}
    for y in years:
        for t in types:
            dash[f"{t}|{y}"] = common("districtWiseNewSchoolDashboard", {"appl_type": t, "aca_year": y})
        for t in ["RR", "FR", "NOC", "NS"]:
            auto[f"{t}|{y}"] = common("districtWiseAutomateRejectedBkpReport", {"appl_type": t, "aca_year": y}, sats=True)
    save("dash", dash)
    save("auto_dist", auto)

    rows = {}
    plan = [("RR", "2026-2027"), ("FR", "2026-2027"), ("RR", "2025-2026"), ("NS", "2026-2027"),
            ("NOC", "2026-2027"), ("FR", "2025-2026")]
    for t, y in plan:
        for d in dash.get(f"{t}|{y}", []):
            if "_error" in d or not d.get("total_application"):
                continue
            for s in ("A", "R", "P"):
                key = f"{t}|{y}|{s}|{d['district_id']}"
                rows[key] = common("applTypeDetailsReport",
                                   {"appl_type": t, "aca_year": y, "status": s, "district_id": d["district_id"]})
        save("rows", rows)

    arows = {}
    for t, y in [("RR", "2026-2027"), ("RR", "2025-2026"), ("FR", "2026-2027"), ("FR", "2025-2026")]:
        for d in auto.get(f"{t}|{y}", []):
            if "_error" in d or not d.get("total_application"):
                continue
            arows[f"{t}|{y}|{d['district_id']}"] = common(
                "applTypeDetailsWithAutomateRejectedBkpReport",
                {"appl_type": t, "aca_year": y, "status": "R", "district_id": d["district_id"]}, sats=True)
        save("auto_rows", arows)

    appeals = {}
    for y in ["2026-2027", "2025-2026"]:
        dl = common("districtWiseAppealApplicationDashboard", {"aca_year": y})
        appeals[f"dist|{y}"] = dl
        for d in dl:
            if "_error" in d or not d.get("application_count"):
                continue
            appeals[f"{y}|{d['district_id']}"] = common("appealDistictReport",
                                                       {"aca_year": y, "district_id": d["district_id"]})
    save("appeals", appeals)

    import re
    names = {"2903": "VIJAYAPURA (2903)", "2924": "DAKSHINA KANNADA (2924)", "2901": "BELAGAVI (2901)"}
    sdir = OUT / "schoolsearch"
    sdir.mkdir(exist_ok=True)
    for dist in ["2903", "2924", "2901"]:
        st, raw = req(f"/front/loadBRCWithoutCode.htm?dise=true&id={dist}")
        xml = raw.decode("utf-8", "replace")
        (sdir / f"brc_{dist}.xml").write_text(xml, encoding="utf-8")
        pairs = re.findall(r"<brc_id>(\d{6})</brc_id><brc_name>([^<]*)</brc_name>", xml)
        for bid, bname in pairs:
            st, raw = req("/front/schoolSearch.htm", {"dist_name": names[dist], "brc_name": bname,
                                                     "school_name": "", "sch_mngt_name": "",
                                                     "district_search": dist, "brcid": bid,
                                                     "sch_school_id": "-1"}, timeout=150)
            if st == -2:
                break
            (sdir / f"block_{bid}.html").write_bytes(raw)

    meta = {"stamp_start": stamp, "stamp_end": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "requests": len(LOG), "by_status": {}}
    for x in LOG:
        meta["by_status"][str(x["status"])] = meta["by_status"].get(str(x["status"]), 0) + 1
    save("meta", meta)
    save("log", LOG)
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
