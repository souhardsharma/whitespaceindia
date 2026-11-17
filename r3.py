"""Throwaway probe 4: Koshvani (UP treasury) education grants, read in depth from this runner.

One connection at a time, at least PAUSE seconds between requests, a hard cap of CAP requests.
TLS verified on every request (legacy renegotiation allowed; no change to certificate checks).
Writes every page to out/ and a results.json with status, bytes, seconds and the final URL.
"""
from __future__ import annotations

import gzip, hashlib, http.cookiejar, json, re, ssl, time, urllib.error, urllib.parse, urllib.request
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
BASE = "https://koshvani.up.nic.in/"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
PAUSE, CAP = 1.2, 420
EDU = ["071", "072", "073", "075", "047", "069"]
TREAS_CAP = {"071": 120, "072": 70, "073": 50, "075": 20, "047": 30, "069": 20}

CTX = ssl.create_default_context()
CTX.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
try:
    CTX.set_ciphers("DEFAULT:@SECLEVEL=1")
except ssl.SSLError:
    pass
OPENER = urllib.request.build_opener(urllib.request.HTTPSHandler(context=CTX),
                                     urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
RESULTS, N = [], [0]
LAST = [0.0]


class Forms(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.forms, self._sel, self._opt = [], None, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form":
            self.forms.append({"action": a.get("action", ""), "inputs": [], "selects": {}})
        if not self.forms:
            return
        f = self.forms[-1]
        if tag == "input":
            f["inputs"].append({"name": a.get("name"), "type": (a.get("type") or "text").lower(),
                                "value": a.get("value", ""), "checked": "checked" in a})
        elif tag == "select":
            self._sel = a.get("name"); f["selects"][self._sel] = []
        elif tag == "option" and self._sel:
            self._opt = {"value": a.get("value"), "selected": "selected" in a, "text": ""}
            f["selects"][self._sel].append(self._opt)

    def handle_data(self, d):
        if self._opt is not None:
            self._opt["text"] += d.strip()

    def handle_endtag(self, tag):
        if tag == "select":
            self._sel = None
        if tag == "option":
            self._opt = None


def forms_of(raw):
    p = Forms()
    try:
        p.feed(raw.decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001
        pass
    return p.forms


def send(name, url, data=None, timeout=120):
    if N[0] >= CAP:
        RESULTS.append({"name": name, "status": "skipped: cap"}); return None
    wait = PAUSE - (time.time() - LAST[0])
    if wait > 0:
        time.sleep(wait)
    N[0] += 1
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    h = {"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Encoding": "gzip"}
    if body is not None:
        h["Content-Type"] = "application/x-www-form-urlencoded"
    t0 = time.time()
    hdr = {}
    try:
        with OPENER.open(urllib.request.Request(url, data=body, headers=h), timeout=timeout) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            status, final, hdr = r.status, r.geturl(), dict(r.headers)
    except urllib.error.HTTPError as e:
        status, raw, final = e.code, e.read(), url
    except Exception as e:  # noqa: BLE001
        status, raw, final = -1, f"{type(e).__name__}: {e}".encode(), url
    secs = round(time.time() - t0, 2)
    LAST[0] = time.time()
    ctype = hdr.get("Content-Type", "")
    ext = ".html" if ("html" in ctype or raw[:200].lstrip()[:1] == b"<") else ".bin"
    (OUT / (name + ext)).write_bytes(raw)
    row = {"name": name, "method": "POST" if body else "GET", "url": url[:160], "final": final[:160],
           "status": status, "bytes": len(raw), "seconds": secs, "type": ctype,
           "disposition": hdr.get("Content-Disposition", ""), "sha": hashlib.sha256(raw).hexdigest()[:16],
           "at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0))}
    RESULTS.append(row)
    print(f"{N[0]:>4} {status!s:>4} {len(raw):>9,} {secs:>6}s {name} -> {final[-70:]}", flush=True)
    (OUT / "results.json").write_text(json.dumps(RESULTS, indent=1), encoding="utf-8")
    return {"raw": raw, "final": final, "status": status}


def links(page, text_re):
    t = page["raw"].decode("utf-8", "replace")
    out = []
    for href, inner in re.findall(r"<a[^>]*href=['\"]([^'\"]+)['\"][^>]*>(.*?)</a>", t, re.S):
        txt = " ".join(re.sub("<[^>]+>", " ", inner).split())
        if re.search(text_re, txt):
            out.append((txt, urllib.parse.urljoin(page["final"], href.replace("&amp;", "&"))))
    return out


def postback(page, setf=None, event=None, button=None, choose=None, drop=()):
    f = forms_of(page["raw"])[0]
    fields = {}
    for i in f["inputs"]:
        if not i["name"] or i["type"] in ("submit", "button", "image", "reset"):
            continue
        if i["type"] in ("checkbox", "radio") and not i["checked"]:
            continue
        fields[i["name"]] = i["value"]
    for name, opts in f["selects"].items():
        if name and opts:
            sel = [o for o in opts if o["selected"]] or opts[:1]
            fields[name] = sel[0]["value"] or sel[0]["text"]
    for sel, rx in (choose or {}).items():
        hit = next((o for o in f["selects"].get(sel, []) if re.search(rx, f"{o['value']} {o['text']}")), None)
        if hit:
            fields[sel] = hit["value"]
    for k in drop:
        fields.pop(k, None)
    fields |= setf or {}
    if event:
        fields["__EVENTTARGET"] = event
    if button:
        b = next((i for i in f["inputs"] if i["name"] == button), None)
        if b and b["type"] == "image":
            fields[button + ".x"], fields[button + ".y"] = "12", "12"
        elif b:
            fields[button] = b["value"]
    return urllib.parse.urljoin(page["final"], f["action"] or page["final"]), fields


HOME_DROP = ("btnGray", "btnBlue", "btnOlive", "btnXSmall", "btnSmall", "btnLarge")


def set_year(fy):
    home = send(f"home-{fy}", BASE)
    if not home or home["status"] != 200:
        return False
    url, f = postback(home, {"ddlFinYear": fy}, event="ddlFinYear", drop=HOME_DROP)
    r = send(f"fy-{fy}", url, f)
    return bool(r and fy.encode() in r["raw"])


def read_year(tag, fy, grants, treas_cap, export=False):
    if not set_year(fy):
        return
    eg = send(f"{tag}-ExpGrant", BASE + "KoshReports/ExpGrant.aspx")
    if not eg or eg["status"] != 200:
        return
    if export:
        url, f = postback(eg, button="btnExport")
        send(f"{tag}-ExpGrant-export", url, f, timeout=180)
    for g in grants:
        hit = [u for t, u in links(eg, rf"^{g}$")]
        if not hit:
            RESULTS.append({"name": f"{tag}-head-{g}", "status": "no link"}); continue
        head = send(f"{tag}-head-{g}", hit[0])
        if not head or head["status"] != 200:
            continue
        if export and g == "071":
            url, f = postback(head, button="btnExport")
            send(f"{tag}-head-{g}-export", url, f, timeout=180)
        sch = links(head, r"^\d{13}")
        if not sch:  # an intermediate page: record its links, follow up to two that lead to a report
            alll = links(head, r".")
            (OUT / f"{tag}-head-{g}.all-links.json").write_text(json.dumps(alll, ensure_ascii=False),
                                                               encoding="utf-8")
            for k, (t, u) in enumerate([x for x in alll if "Exp" in x[1] or "pln" in x[1].lower()][:2]):
                nxt = send(f"{tag}-head-{g}-step{k}", u)
                if nxt and nxt["status"] == 200 and links(nxt, r"^\d{13}"):
                    head = nxt
                    sch = links(nxt, r"^\d{13}")
                    break
        (OUT / f"{tag}-head-{g}.links.json").write_text(json.dumps([t for t, _ in sch], ensure_ascii=False),
                                                       encoding="utf-8")
        for k, (t, u) in enumerate(sch[: treas_cap.get(g, 0)]):
            send(f"{tag}-treas-{g}-{t[:13]}", u, timeout=90)


def main():
    OUT.mkdir(exist_ok=True)
    t_start = time.time()
    # 1. current year, every education grant, every scheme's treasury page (capped), export benchmark
    read_year("cur", "2026-2027", EDU, TREAS_CAP, export=True)
    # 2. source-dated daily arrival, exception page for each education grant
    send("cur-DailyTrx", BASE + "KoshReports/DailyTrx.aspx")
    ex = send("cur-ExcNoExp", BASE + "KoshReports/ExcNoExp.aspx", timeout=180)
    if ex and ex["status"] == 200:
        for g in EDU:
            url, f = postback(ex, choose={"DropDownList1": rf"^{g}\b"}, button="Button1")
            send(f"cur-ExcNoExp-{g}", url, f, timeout=240)
    em = send("cur-ExcMore", BASE + "KoshReports/ExcMore.aspx", timeout=180)
    # 3. what the other reports ask for (forms only)
    for p in ["DataStat", "PayBudCtrlStmt", "RBDSt", "Tr27Exp", "ConExp", "OthRepObj", "OthRepTre",
              "ExpObjRevCap", "BM8DeptList", "ReappList", "NonPlanExp", "GrantObj", "DivExp"]:
        send(f"form-{p}", BASE + f"KoshReports/{p}.aspx", timeout=150)
    # 4. BM4 monthly statement: grant 071, October, all treasuries
    bm = send("bm4", BASE + "KoshReports/BM4Detail.aspx", timeout=180)
    if bm and bm["status"] == 200:
        url, f = postback(bm, {"ddlGrant": "071"}, event="ddlGrant")
        bg = send("bm4-g071", url, f, timeout=180)
        if bg and bg["status"] == 200:
            url, f = postback(bg, {"ddlMonth": "10", "ddlGrant": "071", "ddlHead": "2202011010300"},
                              button="btnShow")
            send("bm4-g071-oct-show", url, f, timeout=240)
    # 5. earlier years: year-end position of the education grants
    read_year("fy26", "2025-2026", ["071", "072"], {"071": 4})
    read_year("fy23", "2022-2023", ["071"], {"071": 2})
    # 6. the same current-year grant page again, to time a repeat read
    if set_year("2026-2027"):
        send("cur-ExpGrant-again", BASE + "KoshReports/ExpGrant.aspx")
    RESULTS.append({"name": "_total", "requests": N[0], "wall_seconds": round(time.time() - t_start, 1)})
    (OUT / "results.json").write_text(json.dumps(RESULTS, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
