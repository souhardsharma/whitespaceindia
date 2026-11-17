"""Throwaway probe: other State treasuries' public education reports, from this runner.
Uses r3's sender (one connection at a time, PAUSE between requests, cap, TLS verified)."""
from __future__ import annotations

import time

import r3
from r3 import send, postback, links, RESULTS, OUT

JH = "https://jkuber.jharkhand.gov.in/treasurymis/"
HP = "https://himkosh.nic.in/eHPOLTIS/PublicReports/"
P = "ctl00$ContentPlaceHolder1$"
M = "ctl00$MainContent$"


def jharkhand():
    pg = send("jh-bae", JH + "rptBudAlloExp.aspx", timeout=120)
    if not pg or pg["status"] != 200:
        return
    asks = [  # (name, set)
        ("jh-bae-59-year", {P + "rdSearchCer": "PdAu", P + "ddlDemandNo": "59"}),
        ("jh-bae-59-nov", {P + "rdSearchCer": "PdAu", P + "ddlDemandNo": "59",
                           P + "txtFromDate": "01/11/2026", P + "txtToDate": "16/11/2026"}),
        ("jh-bae-59-day", {P + "rdSearchCer": "PdAu", P + "ddlDemandNo": "59",
                           P + "txtFromDate": "13/11/2026", P + "txtToDate": "13/11/2026"}),
        ("jh-bae-44-year", {P + "rdSearchCer": "PdAu", P + "ddlDemandNo": "44"}),
    ]
    for name, s in asks:
        url, f = postback(pg, s, button=P + "btnSearch", drop=("ctl00$cmdLogin", "ctl00$CaptchaControl1"))
        send(name, url, f, timeout=150)
    # an earlier year: switch to the previous-year list, choose 2025-26, then a date range in it
    url, f = postback(pg, {P + "rdfinYears": "P", P + "ddlFinYear": "2526"}, event=P + "ddlFinYear",
                      drop=("ctl00$cmdLogin",))
    prev = send("jh-bae-fy2526", url, f, timeout=150)
    if prev and prev["status"] == 200:
        url, f = postback(prev, {P + "rdfinYears": "P", P + "ddlFinYear": "2526", P + "rdSearchCer": "PdAu",
                                 P + "ddlDemandNo": "59", P + "txtFromDate": "01/11/2025",
                                 P + "txtToDate": "16/11/2025"}, button=P + "btnSearch", drop=("ctl00$cmdLogin",))
        send("jh-bae-fy2526-59-nov", url, f, timeout=150)
    # day by day, demand 59, the same 35 days read in the browser (proof from the runner)
    import datetime as dt
    # every single day 1 Apr - 16 Nov 2026: proof from the runner AND a reconciliation against the
    # year-to-date total (ranges are unreliable, so the sum of single days must equal the undated total)
    url, f = postback(pg, {P + "rdSearchCer": "PdAu", P + "ddlDemandNo": "59"}, button=P + "btnSearch",
                      drop=("ctl00$cmdLogin",))
    send("jh-d59-ytd", url, f, timeout=150)
    d0 = dt.date(2026, 4, 1)
    for i in range((dt.date(2026, 11, 16) - d0).days + 1):
        d = (d0 + dt.timedelta(days=i)).strftime("%d/%m/%Y")
        url, f = postback(pg, {P + "rdSearchCer": "PdAu", P + "ddlDemandNo": "59", P + "txtFromDate": d,
                               P + "txtToDate": d}, button=P + "btnSearch", drop=("ctl00$cmdLogin",))
        send("jh-d59-" + d.replace("/", ""), url, f, timeout=120)
    # 2025-26 year end, day by day (validation: Samagra Shiksha money not drawn on 31 March 2026)
    if prev and prev["status"] == 200:
        for day in range(23, 32):
            d = f"{day:02d}/03/2026"
            url, f = postback(prev, {P + "rdfinYears": "P", P + "ddlFinYear": "2526", P + "rdSearchCer": "PdAu",
                                     P + "ddlDemandNo": "59", P + "txtFromDate": d, P + "txtToDate": d},
                              button=P + "btnSearch", drop=("ctl00$cmdLogin",))
            send("jh-fy2526-d59-" + d.replace("/", ""), url, f, timeout=120)
    for p in ("rptTWPassedT.aspx", "rptDWP.aspx", "rptBud_Exp.aspx", "rptConsolidatedReport.aspx"):
        send("jh-" + p[:-5], JH + p, timeout=120)


def himachal():
    pg = send("hp-hod", HP + "wfrmHODAllocation.aspx", timeout=120)
    if pg and pg["status"] == 200:
        for fy, hod in (("2026", "220"), ("2026", "207"), ("2025", "220")):
            url, f = postback(pg, {M + "ddlFinYear": fy, M + "ddlHOD": hod}, button=M + "btnGetdata")
            send(f"hp-hod-{fy}-{hod}", url, f, timeout=150)
    dd = send("hp-ddo", HP + "wfrmDDOAllocationExpenditure.aspx", timeout=120)
    if dd and dd["status"] == 200:
        url, f = postback(dd, {M + "ddlTreaCode": "SML00"}, event=M + "ddlTreaCode")
        tr = send("hp-ddo-SML00", url, f, timeout=150)
        if tr and tr["status"] == 200:
            url, f = postback(tr, {M + "ddlTreaCode": "SML00"}, choose={M + "ddlDDOCode": r"(?i)educ|school"},
                              button=M + "btnGetReport")
            send("hp-ddo-SML00-edu", url, f, timeout=150)


def others():
    for name, url in (
        ("or-monthly", "https://www.odishatreasury.gov.in/webportal/MonthlyReport.do?rconfig=DDO&reportId=1"),
        ("or-graph", "https://www.odishatreasury.gov.in/webportal/PortalPages.do?page=GraphicalReports.jsp"),
        ("uk-ekosh", "https://ekosh.uk.gov.in/"),
        ("cg-ekosh", "https://ekoshonline.cg.nic.in/"),
        ("uk-dashboard", "https://ekosh.uk.gov.in/dashboard/"),
        ("mh-koshwahini", "https://koshwahini.mahakosh.gov.in/"),
        ("ka-khajane2", "https://khajane2.karnataka.gov.in/"),
        ("mp-treasury", "https://mptreasury.gov.in/"),
        ("br-cfms", "https://cfms.bihar.gov.in/"),
        ("pb-ifms", "https://ifms.punjab.gov.in/"),
        ("gj-cybertreasury", "https://cybertreasury.gujarat.gov.in/"),
        ("wb-ifms", "https://wbifms.gov.in/"),
        ("tn-karuvoolam", "https://www.karuvoolam.tn.gov.in/"),
        ("ap-cfms", "https://cfms.ap.gov.in/"),
        ("tg-treasury", "https://treasury.telangana.gov.in/"),
        ("as-finance", "https://finance.assam.gov.in/"),
        ("ml-treasury", "https://megtreasury.gov.in/"),
        ("hr-ifms", "https://ifms.haryana.gov.in/"),
        ("kl-isoft", "https://isoft.treasury.kerala.gov.in/"),
        ("rj-ifms", "https://ifms.rajasthan.gov.in/"),
        ("mh-beams-mis", "https://beams.mahakosh.gov.in/Beams5/BudgetMVC/MISRPT/MIST1.jsp"),
    ):
        send(name, url, timeout=90)


def main():
    OUT.mkdir(exist_ok=True)
    t0 = time.time()
    for fn in (jharkhand, himachal, others):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            RESULTS.append({"name": fn.__name__, "status": f"error: {e}"})
    RESULTS.append({"name": "_states_total", "wall_seconds": round(time.time() - t0, 1)})
    (OUT / "results.json").write_text(r3.json.dumps(RESULTS, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
