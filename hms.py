"""Read Chhattisgarh HMS public attendance reports through the education pool (or from a runner).

    python -I -X utf8 hms.py <open|india> <district> <type> <hostel_code> [<hostel_code> ...] --out DIR

Walks the ASP.NET cascade (district -> type -> hostel -> Generate Report) in one egress.Session and
writes, per institution, ONLY institution-level aggregates: the boarder count and, per month, how many
boarders have a figure and the distribution of days present. Child and parent names never leave memory.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.parse
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE / "scripts" / "education"
if not REPO.exists():
    REPO = Path("C:/Users/souha/Desktop/WHITESPACE INDIA CSR/scripts/education")
sys.path.insert(0, str(REPO))
import egress  # noqa: E402

URL = "https://hmstribal.cg.nic.in/PublicModule/StudentAttendancePublicReport.aspx"
P = "ctl00$ContentPlaceHolder1$"


def hidden(page: str) -> dict:
    out = {}
    for tag in re.findall(r"<input[^>]*type=\"hidden\"[^>]*>", page, flags=re.I):
        name = re.search(r'name="([^"]+)"', tag)
        value = re.search(r'value="([^"]*)"', tag)
        if name:
            out[name.group(1)] = html.unescape(value.group(1)) if value else ""
    return out


def options(page: str, name: str) -> list[tuple[str, str]]:
    m = re.search(r'<select[^>]*name="' + re.escape(name) + r'"[^>]*>(.*?)</select>', page, re.S)
    if not m:
        return []
    return [(html.unescape(v), html.unescape(re.sub(r"<[^>]+>", "", t)).strip())
            for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(1), re.S)]


def post(s: egress.Session, page: str, fields: dict, target: str = "") -> str:
    body = hidden(page) | {"__EVENTTARGET": target, "__EVENTARGUMENT": ""} | fields
    status, raw, _ = s.request(URL, data=urllib.parse.urlencode(body).encode(),
                               headers={"Content-Type": "application/x-www-form-urlencoded",
                                        "Referer": URL})
    if status != 200:
        raise RuntimeError(f"HTTP {status} on postback {target or 'btnShow'}")
    return raw.decode("utf-8", "replace")


def table_aggregate(page: str) -> dict:
    """Institution-level summary of the report table; names are read and dropped here."""
    m = re.search(r"<table[^>]*>(.*?)</table>", page, re.S)
    if not m:
        return {"rows": 0, "table": False}
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(1), re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        rows.append(cells)
    header, body = rows[0], [r for r in rows[1:] if len(r) == len(rows[0])]
    months = [h.replace("Present in ", "") for h in header if h.startswith("Present in")]
    first = len(header) - len(months)
    out = {"rows": len(body), "header": [h for h in header if "Name" not in h],
           "admission_dates": dict(Counter(r[7] for r in body).most_common()),
           "classes": dict(Counter(r[5] for r in body)),
           "genders": dict(Counter(r[3] for r in body)),
           "months": {}}
    for k, month in enumerate(months):
        values = [r[first + k] for r in body if r[first + k] != ""]
        out["months"][month] = {"filled": len(values),
                                "days_present": dict(Counter(values).most_common())}
    return out


def read(target: str, district: str, kind: str, codes: list[str]) -> dict:
    s = egress.Session(target, spacing=1.5, timeout=60)
    status, raw, _ = s.request(URL)
    page = raw.decode("utf-8", "replace")
    if status != 200:
        raise RuntimeError(f"HTTP {status} on first GET")
    page = post(s, page, {P + "ddlDistrict": district}, P + "ddlDistrict")
    page = post(s, page, {P + "ddlDistrict": district, P + "ddlActiveInactive": kind},
                P + "ddlActiveInactive")
    listed = dict(options(page, P + "ddlHostel"))
    results = {"route": s.proxy, "listed": len(listed) - 1, "institutions": {}}
    if codes == ["ALL"]:
        codes = [c for c in listed if c != "0"]
    for code in codes:
        t0 = time.time()
        rpage = post(s, page, {P + "ddlDistrict": district, P + "ddlBlock": "",
                               P + "ddlActiveInactive": kind, P + "ddlCategoryType": "",
                               P + "ddlGovtPvt": "", P + "ddlHostel": code,
                               P + "btnShow": "Generate Report"})
        results["institutions"][code] = {"name": listed.get(code), "secs": round(time.time() - t0, 1),
                                         **table_aggregate(rpage)}
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("target", choices=["open", "india"])
    ap.add_argument("district")
    ap.add_argument("kind")
    ap.add_argument("codes", nargs="*")
    ap.add_argument("--list-only", action="store_true")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    for attempt in range(8):
        try:
            res = read(args.target, args.district, args.kind, args.codes)
            break
        except (egress.SessionLost, RuntimeError) as e:
            print(f"attempt {attempt + 1}: {e}")
    else:
        return 1
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    out = Path(args.out) / f"hms_{args.district}_{args.kind}_{stamp}.json"
    out.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"listed {res['listed']}; " + "; ".join(
        f"{c}: {v.get('rows')} rows" for c, v in res["institutions"].items()) + f" -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
