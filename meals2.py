"""Throwaway probe (round 2) of the NIC-HP meal host for two ideas: meals that stopped (P1) and Closed Days (P2).
Serves nothing; the branch is a throwaway.

Runs on GitHub's runner, direct to mdmhp.nic.in (verified TLS, one request at a time, 1.2 s apart, hard cap).
Keeps parsed counts only; never raw HTML (page footers carry an officer's e-mail). No school tables are read.

Phases (in order of importance, so a budget stop costs the least important):
  night     tonight's nightly read: district tables of all 17 States for yesterday (16 Nov) and 15 Nov
  closures  district tables around documented closure orders (P2 validation), block tables for named districts
  events    district / block / cluster tables around documented meal disruptions (P1 validation)
  home      the public home page: which report links are public
  blocks    block tables of every district for 16 Nov (cost of a block / cluster grain night; block grain data)
"""
from __future__ import annotations

import datetime as dt
import html
import http.cookiejar
import json
import os
import re
import ssl
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

NIC = "https://mdmhp.nic.in"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CAP = int(os.environ.get("NIC_CAP", "560"))
DEADLINE = time.time() + 60 * float(os.environ.get("PROBE_MINUTES", "90"))
OUT = Path("out")
OUT.mkdir(exist_ok=True)
DENY = re.compile(r"GetSchoolDetailsPV|USERSummary|SchoolWise|Principal|Grievanc|Login", re.I)
LOG: list = []
CJ = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CJ),
                                     urllib.request.HTTPSHandler(context=ssl.create_default_context()))
NEXT = [0.0]
RES: dict = {"phases": {}}
STATES = ["12", "18", "04", "38", "30", "06", "02", "01", "37", "31", "23", "14", "15", "13", "08", "16", "05"]


def jdump():
    (OUT / "result.json").write_text(json.dumps(RES, ensure_ascii=False, indent=0), encoding="utf-8")
    (OUT / "log.json").write_text(json.dumps(LOG, ensure_ascii=False, indent=0), encoding="utf-8")


def strip(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def rows_of(t):
    out = []
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, flags=re.S):
        cells = [strip(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, flags=re.S)]
        if len(cells) >= 9 and cells[0].isdigit():
            out.append(cells[:9])
    return out


def req(label, path):
    if DENY.search(path):
        raise SystemExit("refused " + path)
    if len(LOG) >= CAP or time.time() > DEADLINE:
        raise RuntimeError("budget")
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
    secs = round(time.time() - t0, 2)
    NEXT[0] = time.time() + 1.2
    LOG.append({"label": label, "path": path.split("?")[0], "status": st, "bytes": len(raw), "s": secs,
                "t_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(t0))})
    return st, raw.decode("utf-8", "replace"), secs


def d2(iso):
    x = dt.date.fromisoformat(iso)
    return f"{x.day:02d}/{x.month:02d}/{x.year}"


def days(a, b, sat=True):
    x, y = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    out = []
    while x <= y:
        if x.weekday() < (6 if sat else 5):
            out.append(x.isoformat())
        x += dt.timedelta(1)
    return out


DIST = {}  # (state, iso) -> parsed
CODES = {}  # state -> {DISTRICT NAME: code}


def dist(code, iso):
    k = f"{code}|{iso}"
    if k in DIST:
        return DIST[k]
    st, t, s = req(f"dist {code} {iso}", f"/Home/GetDisttWiseSummaryHome?stateCode={code}&dateYesterday={d2(iso)}")
    if st != 200:
        DIST[k] = {"error": st, "s": s}
        return DIST[k]
    rows = rows_of(t)
    codes = [c[1] for c in re.findall(r"GetBlockwiseSummaryDetail\(\s*'(\d+)'\s*,\s*'(\d+)'", t, flags=re.I)]
    if len(codes) == len(rows):
        CODES.setdefault(code, {}).update({r[1].upper(): c for r, c in zip(rows, codes)})
    DIST[k] = {"rows": rows, "s": s, "read_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())}
    return DIST[k]


BLK = {}


def blocks(code, dc, iso):
    k = f"{code}|{dc}|{iso}"
    if k in BLK:
        return BLK[k]
    st, t, s = req(f"blk {code}/{dc} {iso}",
                   f"/Home/GetBlockWiseSummaryHome?stateCode={code}&districtCode={dc}&dateYesterday={d2(iso)}")
    if st != 200:
        BLK[k] = {"error": st, "s": s}
        return BLK[k]
    rows = rows_of(t)
    codes = [c[2] for c in re.findall(r"GetClusterwiseSummaryDetail\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,\s*'(\d+)'", t, flags=re.I)]
    BLK[k] = {"rows": rows, "codes": codes if len(codes) == len(rows) else [], "s": s}
    return BLK[k]


CLU = {}


def clusters(code, dc, bc, iso):
    k = f"{code}|{dc}|{bc}|{iso}"
    st, t, s = req(f"clu {code}/{dc}/{bc} {iso}",
                   f"/Home/GetClusterWiseSummaryHome?stateCode={code}&districtCode={dc}&blockCode={bc}&dateYesterday={d2(iso)}")
    CLU[k] = {"rows": rows_of(t), "s": s} if st == 200 else {"error": st, "s": s}
    return CLU[k]


def dcode(code, name, probe_iso):
    if name not in CODES.get(code, {}):
        dist(code, probe_iso)
    return CODES.get(code, {}).get(name)


def phase(name, fn):
    t0, n0 = time.time(), len(LOG)
    try:
        fn()
        RES["phases"][name] = {"result": "ok"}
    except Exception as e:  # noqa: BLE001
        RES["phases"][name] = {"result": f"stopped {e!r}"[:200]}
        traceback.print_exc()
    RES["phases"][name].update({"wall_s": round(time.time() - t0), "requests": len(LOG) - n0,
                                "ok": sum(1 for r in LOG[n0:] if r["status"] == 200)})
    RES["dist"], RES["blk"], RES["clu"], RES["codes"] = DIST, BLK, CLU, CODES
    jdump()
    print(name, RES["phases"][name], flush=True)


def p_night():
    for iso in os.environ.get("NIGHT_DATES", "2026-11-16,2026-11-17").split(","):
        for s in STATES:
            dist(s, iso)


# P2: documented closures. (state, [dates]) for district tables; (state, district, [dates]) for block tables.
CLOSURE_DIST = [
    ("05", ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11"]),  # UK rain 9 Jul 26
    ("18", ["2026-04-15", "2026-04-16", "2026-04-17", "2026-04-18", "2026-04-20", "2026-04-21", "2026-04-22",
            "2026-04-23"]),  # Kamrup Metro / Guwahati flash floods, closed Mon 20 Apr 2026
    ("18", ["2024-06-12", "2024-06-24", "2024-06-25", "2024-06-26", "2024-06-27", "2024-06-28"]),  # Karimganj 270
    ("02", days("2025-08-04", "2025-08-08")),  # Shimla six subdivisions, Wed 6 Aug 2025
    ("02", days("2025-08-18", "2025-08-29")),  # parts of Una/Kullu/Mandi 20 Aug; 5 districts 25 Aug; Kullu/Mandi 26
    ("06", ["2024-11-13", "2024-11-14", "2024-11-15", "2024-11-16"] + days("2024-11-18", "2024-11-26")),  # GGN/FBD
    ("01", ["2024-09-16", "2024-09-17", "2024-09-18", "2024-09-19", "2024-09-20", "2024-09-23", "2024-09-24",
            "2024-09-25", "2024-09-26", "2024-09-27", "2024-09-30", "2024-10-01", "2024-10-03"]),  # J&K poll days
    ("05", days("2025-07-21", "2025-07-29")),  # UK panchayat polls 24 and 28 Jul 2025 (12 districts, not Haridwar)
    ("16", days("2024-08-19", "2024-08-28")),  # Tripura floods: all schools shut 21-26 Aug 2024
]
CLOSURE_BLK = [("02", "SHIMLA", ["2025-08-05", "2025-08-06"]), ("02", "KULLU", ["2025-08-21", "2025-08-26"]),
               ("18", "KARIMGANJ", ["2024-06-12", "2024-06-25"])]


def p_closures():
    for s, ds in CLOSURE_DIST:
        for iso in ds:
            dist(s, iso)
    for s, name, ds in CLOSURE_BLK:
        dc = dcode(s, name, ds[0])
        if not dc:
            for alt in ("SRIBHUMI",):
                dc = dc or dcode(s, alt, ds[0])
        if dc:
            for iso in ds:
                blocks(s, dc, iso)
        else:
            RES.setdefault("missing", []).append([s, name])


# P1: documented meal disruptions
EVENT_DIST = [
    ("02", days("2026-06-15", "2026-06-27")),  # HP statewide MDM workers' strike, Mon 22 Jun 2026
    ("05", days("2026-01-27", "2026-02-06")),  # Nainital bhojan mata strike, Mon 2 Feb 2026
    ("01", days("2026-03-30", "2026-04-17")),  # Kashmir LPG shortage, meals stopped ~9-10 Apr 2026
    ("15", days("2024-10-14", "2024-10-25", sat=False) + ["2024-11-04", "2024-11-11"]),  # Mizoram from 18 Oct 24
    ("15", days("2025-04-08", "2025-04-11", sat=False) + days("2025-04-14", "2025-04-18", sat=False)
     + ["2025-04-21", "2025-04-22"]),  # Mizoram CSS workers' strike 15-17 Apr 2025
    ("23", ["2025-09-10", "2025-10-15", "2025-11-12", "2025-12-10", "2025-12-17", "2026-01-14"]),  # Dhar unpaid
    ("16", ["2025-01-15", "2025-02-12", "2025-03-04"]),  # Khowai: funds stalled since Nov 2024, teachers paid
    ("01", ["2025-07-15", "2025-07-23"]),  # Bandipora: cooks unpaid, dues > Rs 3 crore (24 Jul 2025)
    ("23", ["2023-07-26", "2023-08-02", "2023-08-09", "2023-09-08"]),  # MP SHG strike from 1 Aug 2023; Indore 8 Sep
]
EVENT_BLK = [("05", "NAINITAL", ["2026-01-30", "2026-02-02", "2026-02-03"], True),
             ("01", "KUPWARA", ["2026-04-02", "2026-04-09", "2026-04-10"], False),
             ("02", "SHIMLA", ["2026-06-19", "2026-06-22"], False),
             ("23", "DHAR", ["2025-09-10", "2025-12-17"], False),
             ("01", "BANDIPORA", ["2025-07-15", "2025-07-23"], False)]


def p_events():
    for s, ds in EVENT_DIST:
        for iso in ds:
            dist(s, iso)
    for s, name, ds, deep in EVENT_BLK:
        dc = dcode(s, name, ds[0])
        if not dc:
            RES.setdefault("missing", []).append([s, name])
            continue
        for iso in ds:
            b = blocks(s, dc, iso)
            if deep and iso in ("2026-01-30", "2026-02-02"):
                for bc in b.get("codes", []):
                    clusters(s, dc, bc, iso)


def p_home():
    st, t, s = req("home hp", "/home/Index/hp")
    links = sorted(set(re.findall(r"href=\"(/[^\"#]{2,100})\"", t)))
    RES["home"] = {"status": st, "s": s, "links": [x for x in links if not re.search(r"\.(css|js|png|jpg)", x)][:120],
                   "report_words": sorted(set(re.findall(r"(?i)(not served[^<]{0,60}|exception[^<]{0,60}|reason[^<]{0,60})", t)))[:40]}


def p_blocks():
    """Block tables of every district for 16 Nov: the cost of a block-grain night and the block counts."""
    for s in STATES:
        for name, dc in sorted(CODES.get(s, {}).items()):
            blocks(s, dc, "2026-11-16")


CAL_IDS = ["AR", "AS", "CH", "DH", "GA", "HR", "HP", "JK", "LA", "LD", "MP", "MN", "MZ", "NL", "TR", "UA"]


def p_cal():
    """Each State's public holiday master: GET the calendar page (sets the State in the session), then the JSON."""
    out = RES.setdefault("calendar", {})
    for sid in CAL_IDS:
        st, t, s = req(f"calpage {sid}", f"/Home/MDMCalendar/{sid}")
        st2, t2, s2 = req(f"caljson {sid}", "/Home/GetHolidaysListJSON")
        try:
            j = json.loads(t2)
            out[sid] = {"status": st2, "s": s2, "rows": [[x.get("HolidayDate"), x.get("SubReason"), x.get("DistrictCode"),
                                                         x.get("BlockCode")] for x in j]}
        except Exception as e:  # noqa: BLE001
            out[sid] = {"status": st2, "s": s2, "error": repr(e)[:100], "head": t2[:100]}


def p_sb():
    """Assam, dense weekdays 3-28 Jun 2024: a trailing norm before the Karimganj (Sribhumi) closure."""
    for iso in days("2024-06-03", "2024-06-22"):
        dist("18", iso)


def p_live():
    """Today (17 Nov) during the school day, and yesterday again: same-day filling."""
    for s in STATES:
        dist(s, "2026-11-17")


def main():
    RES["t_start_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    table = {"night": p_night, "closures": p_closures, "events": p_events, "home": p_home, "blocks": p_blocks,
             "cal": p_cal, "sb": p_sb, "live": p_live}
    for name in os.environ.get("PHASES", "night").split(","):
        fn = table[name]
        phase(name, fn)
    RES["t_end_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    RES["requests"] = len(LOG)
    RES["ok"] = sum(1 for r in LOG if r["status"] == 200)
    jdump()
    print("done", RES["requests"], RES["ok"])


if __name__ == "__main__":
    main()
