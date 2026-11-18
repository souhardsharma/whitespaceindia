"""Drive BMC's anonymous SAP Web Dynpro purchase-order view without a browser.

    python -I -X utf8 wd_probe.py <india|open|runner> FROM TO OUT.json [--dept 30]

Opens the app, reads the context id and secure id, sets the date range, presses
Display and pages through the result table ten rows at a time. One request at a
time, a few seconds apart. Keeps vendor names; drops the column that names the
official who created the order.
"""
from __future__ import annotations

import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import http.cookiejar
from pathlib import Path

APP = "https://r3appprd.sap.mcgm.gov.in/sap/bc/webdynpro/sap/zpur_order_data"
SPACING = 3.0
TAIL = ("~E001Form_Request~E002Id~E004sap.client.SsrClient.form~E005Async~E004false"
        "~E005FocusInfo~E004~E005Hash~E004~E005DomChanged~E004false~E005IsDirty~E004false"
        "~E003~E002ResponseData~E004delta~E003~E002~E003")


def change(control: str, value: str) -> str:
    return (f"InputField_Change~E002Id~E004{control}~E005Value~E004{value}~E003"
            "~E002ResponseData~E004delta~E005EnqueueCardinality~E004single~E003~E002~E003~E001")


def scroll(first: int) -> str:
    return (f"SapTable_VerticalScroll~E002Id~E004WD78~E005FirstVisibleItemIndex~E004{first}"
            "~E005Action~E004DIRECT~E005CellId~E004~E005AccessType~E004SCROLLBAR"
            "~E005SelectionFollowFocus~E004false~E005Shift~E004false~E005Ctrl~E004false"
            "~E005Alt~E004false~E003~E002ResponseData~E004delta~E005ClientAction~E004submit~E003~E002~E003")


DISPLAY = ("Button_Press~E002Id~E004WD56~E003~E002ResponseData~E004delta"
           "~E005ClientAction~E004submit~E003~E002~E003")

CELL = re.compile(r'role="gridcell"[^>]*>(.*?)</td>', re.S)
ROW = re.compile(r'<tr[^>]*role="row"[^>]*>(.*?)</tr>', re.S)
TAG = re.compile(r"<[^>]+>")


def rows_in(body: str) -> list[dict]:
    """Purchase-order rows in a Web Dynpro response (full or delta)."""
    found = []
    for row in ROW.findall(body):
        cells = [re.sub(r"\s+", " ", html.unescape(TAG.sub(" ", c))).strip()
                 for c in CELL.findall(row)]
        for i, cell in enumerate(cells):
            if re.fullmatch(r"\d\d\.\d\d\.\d{4}", cell) and re.fullmatch(r"\d{10}", cells[i + 1] if i + 1 < len(cells) else ""):
                c = cells[i:] + [""] * 11
                found.append({"date": c[0], "po": c[1], "vcode": c[2], "vendor": c[3],
                              "value": c[4], "cur": c[5], "office": c[6],
                              "t1": c[8], "t2": c[9], "t3": c[10]})
                break
    return found


class Client:
    """One cookie jar on one route: the runner's own address, or one pool route via egress.Session."""

    def __init__(self, target: str):
        self.requests = 0
        if target == "runner":
            self.session = None
            self.opener = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
            self.next_ok = 0.0
        else:
            import egress
            self.session = egress.Session(target, spacing=SPACING, timeout=60)

    def send(self, url: str, data: bytes | None = None) -> str:
        self.requests += 1
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        if self.session:
            status, body, _ = self.session.request(url, data=data, headers=headers)
            if status != 200:
                raise OSError(f"HTTP {status}")
            return body.decode("utf-8", "replace")
        time.sleep(max(0.0, self.next_ok - time.time()))
        self.next_ok = time.time() + SPACING
        req = urllib.request.Request(url, data=data, headers={
            "User-Agent": "Mozilla/5.0 (education research probe)", **headers})
        with self.opener.open(req, timeout=60) as r:
            return r.read().decode("utf-8", "replace")


def run(client: Client, start: str, end: str, dept: str) -> dict:
    page = client.send(APP)
    Path("out").mkdir(exist_ok=True)
    Path("out/first_page.html").write_text(page, encoding="utf-8")
    # The page writes the context id entity-encoded (sap-contextid&#x3d;SID&#x25;3aANON...).
    ctx = re.search(r"sap-contextid=([^\"'&\s]+)", html.unescape(page))
    secure = re.search(r'id="sap-wd-secure-id"[^>]*value="([0-9A-F]+)"', page) \
        or re.search(r'sap-wd-secure-id[^0-9A-F]+([0-9A-F]{32})', page)
    if not ctx or not secure:
        raise SystemExit(f"no context or secure id in the first page ({len(page)} chars)")
    post_url = f"{APP}?sap-contextid={ctx.group(1)}"

    def event(queue: str) -> str:
        body = urllib.parse.urlencode({
            "sap-charset": "utf-8", "sap-wd-secure-id": secure.group(1),
            "fesrAppName": "ZPUR_ORDER_DATA", "fesrUseBeacon": "true",
            "SAPEVENTQUEUE": queue + TAIL}, safe="~").encode()
        return client.send(post_url, body)

    first = event(change("WD21", dept) + change("WD43", start) + change("WD47", end) + DISPLAY)
    total = int(re.search(r'aria-rowcount="(\d+)"', first).group(1)) - 1 if 'aria-rowcount="' in first else 0
    orders = {r["po"]: r for r in rows_in(first)}
    for first_row in list(range(1, total + 1, 10)) + [1]:
        if len(orders) >= total:
            break
        orders.update({r["po"]: r for r in rows_in(event(scroll(first_row)))})
    return {"from": start, "to": end, "dept": dept, "rowcount": total,
            "read": len(orders), "requests": client.requests, "orders": list(orders.values())}


def main() -> int:
    target, start, end, out = sys.argv[1:5]
    dept = sys.argv[sys.argv.index("--dept") + 1] if "--dept" in sys.argv else "30"
    if target != "runner":
        sys.path.insert(0, "C:/Users/souha/Desktop/WHITESPACE INDIA CSR/scripts/education")
    for attempt in range(1 if target == "runner" else 8):
        client = Client(target)
        try:
            result = run(client, start, end, dept)
        except (Exception, SystemExit) as e:  # outermost: report the route's failure and try another
            print(f"attempt {attempt + 1}: {type(e).__name__}: {str(e)[:160]}")
            continue
        result["route"] = target
        Path(out).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"rowcount {result['rowcount']} read {result['read']} requests {result['requests']} -> {out}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
