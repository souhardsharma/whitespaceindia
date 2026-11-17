"""Read Gujarat's fire-certificate register and CBSE's affiliation register from this runner.

Writes parsed records to out/ with owners' and heads' names dropped before anything is saved.
One request at a time, PAUSE seconds apart, TLS verified.
"""
from __future__ import annotations

import gzip
import html
import json
import os
import re
import sys
import time
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
sys.path.insert(0, str(HERE))
from probe import hidden_fields, opener_for, send  # noqa: E402

PAUSE = float(os.environ.get("PAUSE", "1.5"))
PLAN = json.loads((HERE / "plan.json").read_text(encoding="utf-8"))
GUJ = "https://gujfiresafetycop.in/ValidCertificate.aspx"
SARAS = "https://saras.cbse.gov.in/saras/AffiliatedList/"
FORM = {"Content-Type": "application/x-www-form-urlencoded"}
LOG: list[dict] = []


def text_lines(page: str) -> list[str]:
    page = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S | re.I)
    page = re.sub(r"</(td|th|tr|div|p|li|h\d|label|span)>|<br\s*/?>", "\n", page, flags=re.I)
    page = html.unescape(re.sub(r"<[^>]+>", " ", page))
    lines = [re.sub(r"\s+", " ", line).strip() for line in page.split("\n")]
    return [line for line in lines if line]


def note(name: str, status: int, size: int, secs: float, **extra) -> None:
    row = {"name": name, "status": status, "bytes": size, "seconds": round(secs, 2),
           "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())} | extra
    LOG.append(row)
    print(json.dumps(row), flush=True)
    time.sleep(PAUSE)


def guj_records(lines: list[str]) -> list[dict]:
    """One dict per certificate block; a block starts at an application number line."""
    starts = [i for i, line in enumerate(lines) if re.fullmatch(r"20\d\d/\d{6,}", line)]
    records = []
    for a, b in zip(starts, starts[1:] + [len(lines)]):
        block = lines[a:b]
        joined = "\n".join(block)
        owner_at = next((i for i, line in enumerate(block) if line.startswith("Owner")), len(block))
        addr_at = next((i for i, line in enumerate(block) if line.startswith("Address")), None)
        address = ""
        if addr_at is not None:
            address = " ".join(block[addr_at:owner_at]).removeprefix("Address:").strip()
        issued = re.search(r"ISSUED\s*\n?\s*(\d{2} \w{3} \d{4})", joined)
        expiry = re.search(r"EXPIRY\s*\n?\s*(\d{2} \w{3} \d{4})", joined)
        region = re.search(r"Region:\s*([^\n]+)", joined)
        records.append({"no": block[0], "type": block[1] if len(block) > 1 else "",
                        "name": block[2] if len(block) > 2 else "", "address": address,
                        "region": region.group(1).strip() if region else "",
                        "issued": issued.group(1) if issued else "",
                        "expiry": expiry.group(1) if expiry else ""})
    return records


def guj_search(op, page: str, region: str, apptype: str, keyword: str) -> tuple[int, bytes]:
    fields = hidden_fields(page)
    fields.update({"__EVENTTARGET": "ctl00$body$btnSearch", "__EVENTARGUMENT": "",
                   "ctl00$body$ddlRegion": region, "ctl00$body$ddlApplicationType": apptype,
                   "ctl00$body$txtkeyword": keyword})
    status, raw, _, final = send(op, GUJ, urllib.parse.urlencode(fields).encode(),
                                 FORM | {"Referer": GUJ}, "POST", 90)
    if not final.endswith("ValidCertificate.aspx"):
        status = -3
    return status, raw


def gujarat() -> None:
    op = opener_for()
    t0 = time.time()
    status, raw, _, _ = send(op, GUJ, timeout=60)
    note("guj-get", status, len(raw), time.time() - t0)
    if status != 200:
        (OUT / "guj-get-fail.txt").write_bytes(raw[:2000])
        return
    page = raw.decode("utf-8", "replace")
    everything: dict[str, dict] = {}
    for region, apptype, keyword in PLAN["gujarat"]:
        t0 = time.time()
        status, raw = guj_search(op, page, region, apptype, keyword)
        secs = time.time() - t0
        answer = raw.decode("utf-8", "replace")
        records = guj_records(text_lines(answer)) if status == 200 else []
        for r in records:
            r["q"] = f"{region}|{apptype}|{keyword}"
            everything.setdefault(r["no"] + "|" + r["type"], r)
        note(f"guj-{region}-{apptype}-{keyword}", status, len(raw), secs, records=len(records))
        if status == 200 and "__VIEWSTATE" in answer:
            page = answer
        elif status != 200:
            t0 = time.time()
            status, raw, _, _ = send(op, GUJ, timeout=60)
            note("guj-reget", status, len(raw), time.time() - t0)
            if status == 200:
                page = raw.decode("utf-8", "replace")
    rows = sorted(everything.values(), key=lambda r: r["no"])
    (OUT / "guj_records.json.gz").write_bytes(gzip.compress(json.dumps(rows).encode()))
    print("gujarat distinct records", len(rows), flush=True)


def saras_detail(lines: list[str]) -> dict:
    def after(label: str) -> str:
        for i, line in enumerate(lines[:-1]):
            if line.startswith(label):
                return lines[i + 1]
        return ""
    return {"name": after("Name of Institution"), "aff": after("Affiliation Number"),
            "state": after("State"), "district": after("District"),
            "address": after("Postal Address"), "pin": after("Pin Code"),
            "status": after("Status of The School"), "type": after("School Type"),
            "from": after("From :"), "to": after("To :")}


def saras() -> None:
    op = opener_for()
    t0 = time.time()
    status, raw, _, _ = send(op, SARAS + "ListOfSchdirReportNew", timeout=90)
    note("saras-get", status, len(raw), time.time() - t0)
    if status != 200:
        (OUT / "saras-get-fail.txt").write_bytes(raw[:2000])
        return
    page = raw.decode("utf-8", "replace")
    token = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', page)
    action = re.search(r'<form action="([^"]+)"', page)
    fields = {"MainRadioValue": "State_wise", "State": PLAN["saras_state"], "District": "",
              "Region": "", "InstName_orAddress": "", "RegiAffNo": "0", "SchoolStatusWise": "0",
              "__RequestVerificationToken": token.group(1) if token else ""}
    url = urllib.parse.urljoin(SARAS, action.group(1) if action else "ListOfSchdirReport")
    t0 = time.time()
    status, raw, _, _ = send(op, url, urllib.parse.urlencode(fields).encode(),
                             FORM | {"Referer": SARAS + "ListOfSchdirReportNew"}, "POST", 120)
    answer = raw.decode("utf-8", "replace")
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", answer, flags=re.S):
        cells = [html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c))).strip()
                 for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, flags=re.S)]
        if len(cells) >= 8:
            rows.append(cells[:8])
    note("saras-state-list", status, len(raw), time.time() - t0, rows=len(rows))
    (OUT / "saras_state_list.json").write_text(json.dumps(rows), encoding="utf-8")
    wanted = [r for r in rows if r[3].upper() in PLAN["saras_districts"]][: PLAN["saras_detail_cap"]]
    details = []
    for r in wanted:
        t0 = time.time()
        status, raw, _, _ = send(op, SARAS + "AfflicationDetails/" + r[1].strip(), timeout=60)
        d = saras_detail(text_lines(raw.decode("utf-8", "replace"))) if status == 200 else {}
        d["list_status"] = r[6]
        d["reg"] = r[1]
        details.append(d)
        note(f"saras-detail-{r[1]}", status, len(raw), time.time() - t0)
    (OUT / "saras_details.json").write_text(json.dumps(details), encoding="utf-8")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for part in (gujarat, saras):
        try:
            part()
        except Exception as e:  # noqa: BLE001 - one source failing must not lose the other's output
            print(f"{part.__name__} failed: {type(e).__name__}: {e}", flush=True)
    (OUT / "sweep_log.json").write_text(json.dumps(LOG, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
