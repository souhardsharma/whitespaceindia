"""Reopen-orders probe: reads State education order registers from a GitHub runner only.

"open" = the runner's own address; "india" = the education pool built on the runner. TLS verified everywhere.
Every request is logged to out/results.json (status, bytes, seconds). One request at a time, spaced; per-host caps.
Reads: Kerala GO register (General and Higher Education) for 13 weeks with PDFs of amending, money and court
orders plus a random sample; Andhra Pradesh GOIR (School and Higher Education) for 13 weeks with PDFs; Delhi DoE's
date-range circular search with some PDFs; Punjab, Haryana and other dated listings; the regulators' listings.
"""
from __future__ import annotations

import gzip
import hashlib
import html
import http.cookiejar
import json
import random
import re
import ssl
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CTX = ssl.create_default_context()
LEG = ssl.create_default_context()
LEG.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
FORM = {"Content-Type": "application/x-www-form-urlencoded"}
LOG: list[dict] = []
COUNT: Counter = Counter()
CAP = {"eoffice.kerala.gov.in": 200, "goir.ap.gov.in": 80, "www.edudel.nic.in": 40}
KL = "https://eoffice.kerala.gov.in/EofficePortal/"
DL = "https://www.edudel.nic.in/mis/misadmin/"
sys.path.insert(0, str(HERE / "scripts" / "education"))

AMEND = re.compile(
    r"amend|erratum|errata|corrigend|modif|cancel|withdraw|supersed|in\s+partial\s+modification|revis|rectif"
    r"|extension|extend|addend|in\s+continuation|ratif|keep\s+in\s+abeyance|abeyance"
    r"|ഭേദഗതി|ഭേദഗതി|തിരുത്ത|റദ്ദ|പിൻവലി|പിന്‍വലി|ദീർഘിപ്പി|ദീര്‍ഘിപ്പി|പുതുക്കി|പരിഷ്കരി|പരിഷ്ക്കരി|സാധൂകരി|അനുബന്ധ"
    r"|संशोधन|निरस्त|शुद्धि|विस्तार",
    re.I,
)
MONEY = re.compile(
    r"release|grant|\bfunds?\b|sanction|allotment|expenditure|\bbudget|\brs\.?\s*\d|₹|amount|instal|reimburs"
    r"|ഭരണാനുമതി|ധനാനുമതി|തുക|ഫണ്ട്|ഗ്രാന്റ്|ധനസഹായ|ഗഡു|വിഹിത|രൂപ|അനുവദി"
    r"|राशि|अनुदान|बजट|आवंटन|स्वीकृति",
    re.I,
)
PERSON = re.compile(r"ജനനത്തീയതി|ശ്രീമതി|ശ്രീ\.|ശ്രീ\s|\bSri\b|\bSmt\b|\bShri\b|\bKum\b|\bDr\.|medical\s+reimb|ചികിത്സ", re.I)
COURT = re.compile(
    r"high\s*court|supreme\s+court|judge?ment|tribunal|contempt|\bcourt\b|W\.?P\.?\s?\(|\bWP\s*\(?C|\bO\.?A\.?\s|COC\b"
    r"|ഹൈക്കോടതി|കോടതി|വിധി|ട്രിബ്യൂണ|ട്രിബുണ|ട്രൈബ്യൂണ|റിട്ട്",
    re.I,
)


def host(u):
    return urllib.parse.urlsplit(u).hostname or ""


class Direct:
    def __init__(self, legacy=False):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPSHandler(context=LEG if legacy else CTX),
                                              urllib.request.HTTPCookieProcessor(self.jar))

    def go(self, url, data=None, headers=None, timeout=90):
        h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip", "Accept-Language": "en-IN,en;q=0.8"}
        h.update(headers or {})
        req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
        try:
            with self.op.open(req, timeout=timeout) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return r.status, raw
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except Exception as e:  # noqa: BLE001
            return -1, f"{type(e).__name__}: {e}".encode()


class ISess:
    """One India-pool route with its own cookie jar (egress.Session)."""

    def __init__(self):
        import egress  # noqa: PLC0415
        self.s = egress.Session("india", spacing=2.0, timeout=60)

    def go(self, url, data=None, headers=None, timeout=60):
        try:
            st, body, _ = self.s.request(url, data=data, headers=headers)
            return st, body
        except Exception as e:  # noqa: BLE001
            return -1, f"{type(e).__name__}: {e}".encode()


_POOL = None


def india(url, data=None, timeout=60):
    global _POOL
    import egress  # noqa: PLC0415
    if _POOL is None:
        _POOL = egress.open_pool("india", reload_every=0)
    return egress.fetch(_POOL, url, data=data, method="POST" if data is not None else "GET",
                        timeout=timeout, deadline=time.time() + 150)


def call(name, url, data=None, fam="open", sess=None, headers=None, save=None, timeout=90, pause=1.0):
    h = host(url)
    if COUNT[h] >= CAP.get(h, 30):
        print(f"CAP {h} {name}", flush=True)
        return -2, b""
    COUNT[h] += 1
    t0 = time.time()
    if fam in ("open", "isess"):
        st, body = (sess or Direct()).go(url, data, headers, timeout)
    else:
        try:
            st, body = india(url, data, timeout)
        except BaseException as e:  # noqa: BLE001 - SystemExit when the pool is empty
            st, body = -1, f"{type(e).__name__}: {e}".encode()
    secs = round(time.time() - t0, 2)
    if save and st == 200 and body:
        p = OUT / save
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body)
    LOG.append({"name": name, "fam": fam, "url": url[:300], "post": bool(data), "status": st, "bytes": len(body),
                "seconds": secs, "sha": hashlib.sha256(body).hexdigest()[:16], "save": save if st == 200 else None,
                "head": body[:120].decode("utf-8", "replace"), "t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    print(f"{st:>4} {len(body):>10,} {secs:>7}s {fam:5s} {name}", flush=True)
    time.sleep(pause)
    return st, body


def good(st, b, minlen=2000):
    return st == 200 and len(b) >= minlen


def cell(x):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", x.decode("utf-8", "replace")))).strip()


def flush():
    (OUT / "results.json").write_text(json.dumps(LOG, ensure_ascii=False, indent=1), "utf-8")
    (OUT / "per_host.json").write_text(json.dumps(COUNT, indent=1), "utf-8")


# ------------------------------------------------------------------------------------------------- Kerala
WINDOWS = [("08b", "17/08/2026", "01/09/2026"), ("09a", "01/09/2026", "16/09/2026"), ("09b", "16/09/2026", "01/10/2026"),
           ("10a", "01/10/2026", "16/10/2026"), ("10b", "16/10/2026", "01/11/2026"), ("11a", "01/11/2026", "16/11/2026"),
           ("11b", "16/11/2026", "20/11/2026")]
PDFHDR = {**FORM, "Referer": KL + "godetails", "Origin": "https://eoffice.kerala.gov.in"}


def kl_form(dept, a, b, tok):
    return urllib.parse.urlencode({"token": tok, "departmentId": dept, "fromdate": a, "todate": b}).encode()


def kl_rows(body):
    rows = []
    for r in re.findall(rb"<tr.*?</tr>", body, re.S):
        c = re.findall(rb"<td[^>]*>(.*?)</td>", r, re.S)
        k = re.search(rb"record\d+", r)
        if len(c) >= 6 and k:
            rows.append({"no": cell(c[1]), "date": cell(c[2]), "subject": cell(c[4]), "rk": k.group(0).decode()})
    return rows


def kerala(dept, budget, seed):
    s = Direct()
    st, b = call(f"kl golist {dept}", KL + "golist", b"token=KL0567QW111A0SA1011W0", "open", s, FORM)
    m = re.search(rb'name="token"\s+value="([^"]+)"', b)
    tok = m.group(1).decode() if m else "KL0567QW111A0SA1011W0"
    (OUT / "kl").mkdir(parents=True, exist_ok=True)
    (OUT / "kl" / f"token_{dept}.txt").write_text(tok)
    rnd = random.Random(seed)
    meta = []
    used = 0
    per_win = max(4, budget // len(WINDOWS))
    for lab, a, z in WINDOWS:
        st, body = call(f"kl {dept} {lab}", KL + "godetails", kl_form(dept, a, z, tok), "open", s, FORM,
                        save=f"kl/{dept}/{lab}.html", timeout=120)
        if not good(st, body, 500):
            continue
        rows = kl_rows(body)
        gen = [r for r in rows if not PERSON.search(r["subject"])]
        amend = [r for r in gen if AMEND.search(r["subject"])]
        money = [r for r in gen if MONEY.search(r["subject"]) and r not in amend]
        rest = [r for r in rows if r not in amend and r not in money]
        pick = amend + rnd.sample(money, min(len(money), max(0, per_win - len(amend) - 3)))
        pick += rnd.sample(rest, min(len(rest), 3))
        for r in pick[: per_win + 6]:
            if used >= budget:
                break
            st2, pdf = call(f"kl pdf {dept} {lab} {r['rk']}", KL + "openIssuedGOList", f"recordKey={r['rk']}".encode(),
                            "open", s, PDFHDR, save=f"kl/pdf_{dept}/{lab}_{r['rk']}.pdf", timeout=60, pause=1.5)
            used += 1
            meta.append({**r, "win": lab, "status": st2, "is_pdf": pdf[:4] == b"%PDF", "bytes": len(pdf),
                         "why": "amend" if r in amend else ("money" if r in money else "random")})
        (OUT / "kl" / f"pdf_meta_{dept}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")
        flush()


# ------------------------------------------------------------------------------------------------- ASP.NET forms
def fields(b: bytes) -> dict:
    t = b.decode("utf-8", "replace")
    f = {}
    for tag in re.findall(r"<input[^>]+>", t):
        n = re.search(r'name="([^"]+)"', tag)
        if not n:
            continue
        typ = (re.search(r'type="([^"]+)"', tag) or [None, "text"])[1].lower()
        if typ in ("submit", "image", "button"):
            continue
        if typ in ("radio", "checkbox") and "checked" not in tag:
            continue
        v = re.search(r'value="([^"]*)"', tag)
        f[n.group(1)] = html.unescape(v.group(1)) if v else ""
    for name, body in re.findall(r'<select[^>]+name="([^"]+)"[^>]*>(.*?)</select>', t, re.S):
        sel = re.search(r'<option[^>]*selected[^>]*value="([^"]*)"', body) or re.search(r'<option[^>]*value="([^"]*)"', body)
        f[name] = html.unescape(sel.group(1)) if sel else ""
    return f


def options(b: bytes, name: str) -> list[tuple[str, str]]:
    t = b.decode("utf-8", "replace")
    m = re.search(r'<select[^>]+name="' + re.escape(name) + r'"[^>]*>(.*?)</select>', t, re.S)
    if not m:
        return []
    return [(html.unescape(v), cell(x.encode())) for v, x in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(1), re.S)]


# ------------------------------------------------------------------------------------------------- Andhra Pradesh
AP = "https://goir.ap.gov.in/"


def ap_rows(b: bytes):
    rows = []
    for r in re.findall(rb"<tr.*?</tr>", b, re.S):
        c = re.findall(rb"<td[^>]*>(.*?)</td>", r, re.S)
        g = re.search(rb"downloadFile\(\W*(\d+)", r)
        if len(c) >= 8 and g:
            rows.append({"no": cell(c[1]), "date": cell(c[2]), "cat": cell(c[3]), "abs": cell(c[4]),
                         "sect": cell(c[6]), "amt": cell(c[7]), "gid": g.group(1).decode()})
    return rows


def ap_dept(sess, fam, dept, pdf_budget, seed):
    st, b = call(f"ap home {dept}", AP, None, fam, sess, timeout=90)
    if not good(st, b, 5000):
        return False
    f = fields(b)
    f.update({"ctl00$ContentPlaceHolder1$DDLDeptname": dept, "__EVENTTARGET": "ctl00$ContentPlaceHolder1$DDLDeptname",
              "__EVENTARGUMENT": ""})
    st, b = call(f"ap {dept} select", AP, urllib.parse.urlencode(f).encode(), fam, sess, {**FORM, "Referer": AP})
    if not good(st, b, 5000):
        return False
    f = fields(b)
    f.update({"ctl00$ContentPlaceHolder1$DDLDeptname": dept, "ctl00$ContentPlaceHolder1$txtfrmdate": "17-08-2026",
              "ctl00$ContentPlaceHolder1$txttodate": "18-11-2026", "ctl00$ContentPlaceHolder1$BtnSearch": "Search",
              "__EVENTTARGET": "", "__EVENTARGUMENT": ""})
    st, b = call(f"ap {dept} search", AP, urllib.parse.urlencode(f).encode(), fam, sess, {**FORM, "Referer": AP},
                 save=f"ap/{dept}_p1.html", timeout=120)
    if not good(st, b, 5000):
        return False
    rows = ap_rows(b)
    pages = sorted({int(x) for x in re.findall(rb"Page\$(\d+)", b)})
    for p in pages[:8]:
        if p == 1:
            continue
        g = fields(b)
        g.update({"__EVENTTARGET": "ctl00$ContentPlaceHolder1$FileMoveList2", "__EVENTARGUMENT": f"Page${p}"})
        g.pop("ctl00$ContentPlaceHolder1$BtnSearch", None)
        st, b2 = call(f"ap {dept} page {p}", AP, urllib.parse.urlencode(g).encode(), fam, sess, {**FORM, "Referer": AP},
                      save=f"ap/{dept}_p{p}.html", timeout=120)
        if good(st, b2, 5000):
            rows += ap_rows(b2)
            b = b2
    (OUT / "ap").mkdir(parents=True, exist_ok=True)
    (OUT / "ap" / f"{dept}_rows.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), "utf-8")
    rnd = random.Random(seed)
    amend = [r for r in rows if AMEND.search(r["abs"])]
    money = [r for r in rows if MONEY.search(r["abs"]) and r not in amend]
    pick = amend[: pdf_budget // 2]
    pick += rnd.sample(money, min(len(money), pdf_budget - len(pick)))
    meta = []
    for r in pick:
        st, pdf = call(f"ap pdf {dept} {r['gid']}", AP + f"dgo.ashx?gid={r['gid']}&fileType=E", None, fam, sess,
                       {"Referer": AP}, save=f"ap/pdf_{dept}/{r['gid']}.pdf", timeout=90, pause=1.5)
        meta.append({**r, "status": st, "is_pdf": pdf[:4] == b"%PDF", "bytes": len(pdf),
                     "why": "amend" if r in amend else "money"})
    (OUT / "ap" / f"pdf_meta_{dept}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")
    return True


def andhra():
    for dept, budget, seed in (("SE", 16, 11), ("HE", 12, 12)):
        done = ap_dept(Direct(legacy=True), "open", dept, budget, seed)
        if not done:
            for _ in range(3):
                try:
                    if ap_dept(ISess(), "isess", dept, budget, seed):
                        break
                except BaseException:  # noqa: BLE001
                    traceback.print_exc()
        flush()


# ------------------------------------------------------------------------------------------------- Delhi
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def pick_opt(b, name, want_int=None, want_month=None):
    for v, t in options(b, name):
        tl = t.lower()
        if want_int is not None and (v.strip().lstrip("0") == str(want_int) or tl.strip().lstrip("0") == str(want_int)):
            return v
        if want_month is not None and (tl.startswith(MONTHS[want_month - 1]) or v.strip().lstrip("0") == str(want_month)):
            return v
    return None


def delhi_flow(sess, fam):
    st, b = call("dl public form", DL + "frmPublic_Circular.aspx", None, fam, sess, timeout=90)
    if not good(st, b, 5000):
        return False
    f = fields(b)
    f["ddlFrom"] = pick_opt(b, "ddlFrom", want_int=17) or "17"
    f["ddlmonthfrom"] = pick_opt(b, "ddlmonthfrom", want_month=8) or "8"
    f["txtfromyy"] = "2026"
    f["ddldayto"] = pick_opt(b, "ddldayto", want_int=18) or "18"
    f["ddlmonthto"] = pick_opt(b, "ddlmonthto", want_month=11) or "11"
    f["txtToyy"] = "2026"
    f["rbtbranchWise"] = "1"
    f["btn3"] = "VIEW"
    f["__EVENTTARGET"] = ""
    (OUT / "dl").mkdir(parents=True, exist_ok=True)
    (OUT / "dl" / "form_sent.json").write_text(json.dumps({k: v for k, v in f.items() if not k.startswith("__")}))
    st, r = call("dl public 17aug-18nov", DL + "frmPublic_Circular.aspx", urllib.parse.urlencode(f).encode(), fam, sess,
                 {**FORM, "Referer": DL + "frmPublic_Circular.aspx"}, save="dl/range.html", timeout=120)
    if not good(st, r, 5000):
        return False
    t = r.decode("utf-8", "replace")
    items = []
    for m in re.finditer(r"frmCircular_pdf_File\.aspx\?id=([0-9A-F]+)", t):
        ctx = cell(t[max(0, m.start() - 1500): m.start()].encode())[-400:]
        items.append({"id": m.group(1), "ctx": ctx})
    want = [i for i in items if AMEND.search(i["ctx"][-250:]) or MONEY.search(i["ctx"][-250:])][:10]
    meta = []
    for k, i in enumerate(want):
        st, pdf = call(f"dl pdf {k}", DL + "frmCircular_pdf_File.aspx?id=" + i["id"], None, fam, sess,
                       {"Referer": DL + "frmPublic_Circular.aspx"}, save=f"dl/pdf/{k}.pdf", timeout=120, pause=1.5)
        meta.append({**i, "k": k, "status": st, "is_pdf": pdf[:4] == b"%PDF", "bytes": len(pdf)})
    (OUT / "dl" / "pdf_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")
    return True


def delhi():
    if not delhi_flow(Direct(), "open"):
        for _ in range(3):
            try:
                if delhi_flow(ISess(), "isess"):
                    break
            except BaseException:  # noqa: BLE001
                traceback.print_exc()


# ------------------------------------------------------------------------------------------------- Punjab PDFs
def punjab():
    st, b = call("pb instr", "https://www.ssapunjab.org/subpages/instructions.html", None, "open", Direct(),
                 save="pb/instr.html", timeout=90)
    if not good(st, b):
        st, b = call("pb instr india", "https://www.ssapunjab.org/subpages/instructions.html", None, "india",
                     save="pb/instr.html")
    if not good(st, b):
        return
    links = re.findall(rb'href="([^"]+/instructions/2026/(?:Aug|Sep|Oct|Nov)/[^"]+\.pdf)"', b, re.I)
    want = [x.decode() for x in links if AMEND.search(urllib.parse.unquote(x.decode()).replace("_", " "))
            or MONEY.search(urllib.parse.unquote(x.decode()).replace("_", " "))]
    want = [w for w in want if not re.search(r"transfer|station|promotion|extension\s*(?:in|of)\s*service|leave",
                                             urllib.parse.unquote(w).replace("_", " "), re.I)]
    meta = []
    for k, u in enumerate(want[:10]):
        st, pdf = call(f"pb pdf {k}", u, None, "open", Direct(), save=f"pb/pdf/{k}.pdf", timeout=90)
        meta.append({"url": u, "k": k, "status": st, "is_pdf": pdf[:4] == b"%PDF", "bytes": len(pdf)})
    (OUT / "pb" / "pdf_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")


# ------------------------------------------------------------------------------------------------- listings
LISTINGS = [
    ("hr daily p1", "https://schooleducationharyana.gov.in/daily-orders/", "hr/p1.html", True),
    ("hr daily p2", "https://schooleducationharyana.gov.in/daily-orders/page/2/", "hr/p2.html", True),
    ("hr daily p3", "https://schooleducationharyana.gov.in/daily-orders/page/3/", "hr/p3.html", True),
    ("hr daily p4", "https://schooleducationharyana.gov.in/daily-orders/page/4/", "hr/p4.html", True),
    ("hr daily p5", "https://schooleducationharyana.gov.in/daily-orders/page/5/", "hr/p5.html", True),
    ("hr daily p6", "https://schooleducationharyana.gov.in/daily-orders/page/6/", "hr/p6.html", True),
    ("cbse exam", "https://www.cbse.gov.in/cbsenew/examination_circular.html", "reg/cbse_exam.html", False),
    ("cbse misc", "https://www.cbse.gov.in/cbsenew/misc.html", "reg/cbse_misc.html", False),
    ("cbse acad", "https://cbseacademic.nic.in/circulars.html", "reg/cbse_acad.html", False),
    ("upmsp", "https://upmsp.edu.in/", "up/upmsp.html", False),
    ("cg circ", "https://eduportal.cg.nic.in/Circular.aspx", "cg/circ.html", True),
    ("jh notif", "https://schooleducation.jharkhand.gov.in/notification", "jh/notif.html", False),
    ("uk notices", "https://schooleducation.uk.gov.in/notices/", "uk/notices.html", False),
    ("mh gr p1", "https://gr.maharashtra.gov.in/1145/Government-Resolutions", "mh/gr1.html", True),
    ("moe circ", "https://www.education.gov.in/circulars-orders-notification", "reg/moe.html", False),
]
INDIA_LISTINGS = [
    ("hp dse", "https://himachal.nic.in/dse", "hp/dse.html"),
    ("ka dosel", "https://dosel.karnataka.gov.in/27/department-notifications-circulars/en", "ka/dosel.html"),
    ("od news", "https://sme.odisha.gov.in/news", "od/news.html"),
    ("aicte circ", "https://www.aicte.gov.in/bulletins/circulars", "reg/aicte.html"),
    ("ncte appeal", "https://web.ncte.gov.in/page-appeal-orders", "reg/ncte_appeal.html"),
    ("tg goir home", "https://goir.telangana.gov.in/", "tg/home.html"),
]


def listings():
    for name, url, save, legacy in LISTINGS:
        st, b = call(name, url, None, "open", Direct(legacy), save=save)
        if not good(st, b):
            call(name + " india", url, None, "india", save=save)
        flush()
    call("ugc fill", "https://www.ugc.gov.in/Notices/Fill_Notices", b"ID=0&type=NoticeGrid", "open", Direct(), FORM,
         save="reg/ugc_fill.json")
    for name, url, save in INDIA_LISTINGS:
        st, b = call(name + " open", url, None, "open", Direct(True), save=save, timeout=40)
        if not good(st, b):
            for i in range(2):
                st, b = call(f"{name} india#{i}", url, None, "india", save=save)
                if good(st, b):
                    break
        flush()


def main():
    OUT.mkdir(exist_ok=True)
    for name, fn in (("kerala 740", lambda: kerala(740, 110, 7401)), ("kerala 1124", lambda: kerala(1124, 50, 1124)),
                     ("andhra", andhra), ("delhi", delhi), ("punjab", punjab), ("listings", listings)):
        print(f"== {name}", flush=True)
        try:
            fn()
        except BaseException:  # noqa: BLE001 - SystemExit from a pool with no routes must not end the run
            traceback.print_exc()
        flush()


if __name__ == "__main__":
    main()
