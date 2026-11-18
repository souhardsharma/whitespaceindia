"""Reopen-procurement probe, run 2 (read only).

A. CPPP GePNIC from the runner's own address, 1.5 s apart: every education organisation's active
   list, the detail page of EVERY active education tender, its corrigendum table (title, type) and,
   for up to 12 corrigenda of different types, the "View Corrigendum History" popup (saved raw; if it
   asks a CAPTCHA, no further popup is asked and nothing is answered).
B. GeM through the Indian pool: which search form still filters awarded bids by a school-education
   department (the free-text phrase was ignored on 18 Nov, numFound = every bid).
"""
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_procure as P  # noqa: E402

RES = {"started_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())}
TID = re.compile(r"^(\d{4})_([A-Za-z0-9]+)_(\d+)_(\d+)$")
CORR_ROW = re.compile(r"<tr class=\"(?:odd|even)\"[^>]*>\s*<td>(\d+)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>",
                      re.S)


def save():
    P.save("result.json", RES)


def field(html, caption):
    # GePNIC writes a caption either as <b>caption</b> or as the bare text of a td_caption cell
    m = (re.search(r"<b>\s*" + re.escape(caption) + r"\s*</b>\s*</td>\s*<td[^>]*>(.*?)</td>", html, re.S)
         or re.search(r"<td class=\"td_caption\"[^>]*>\s*" + re.escape(caption) + r"\s*</td>\s*<td[^>]*>(.*?)</td>",
                      html, re.S))
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip() if m else None


def corrigenda(html):
    body = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    i = body.find('id="corrigendumDocumenttable"')
    if i < 0:
        return []
    table = body[i:body.find("</table>", i)]
    out = []
    for sno, title, kind, view in CORR_ROW.findall(table):
        link = re.search(r'href="([^"]+)"', view)
        out.append({"title": re.sub(r"\s+", " ", title).strip(), "type": re.sub(r"\s+", " ", kind).strip(),
                    "link": "https://eprocure.gov.in" + link.group(1).replace("&amp;", "&") if link else None})
    return out


def cppp():
    s = P.Sess("open", spacing=1.5)
    orgs, _ = P.cppp_org_table(s, tag="orgs")
    edu = [o for o in orgs if P.EDU.search(o["name"]) and not P.NOT_EDU.search(o["name"])]
    RES["cppp_orgs_total"], RES["cppp_edu_orgs"] = len(orgs), len(edu)
    rows = []
    for o in edu:
        try:
            st, body, _ = s.req(o["link"], check=lambda a, b: a == 200, tag=f"org {o['name'][:40]}")
        except Exception as e:  # noqa: BLE001 - one organisation failing is recorded, the sweep goes on
            RES.setdefault("org_errors", []).append([o["name"], str(e)[:120]])
            continue
        html = body.decode("utf-8", "replace")
        links = re.findall(r'href="([^"]*FrontEndViewTender[^"]*)"', html)
        for r, link in zip(P.cppp_tenders(html, o["name"]), links):
            r["link"] = "https://eprocure.gov.in" + link.replace("&amp;", "&")
            rows.append(r)
    RES["cppp_tenders"] = len(rows)
    save()
    t0 = time.time()
    popups_asked, popup_types, captcha_seen = 0, set(), False
    (P.OUT / "popup").mkdir(exist_ok=True)
    for r in rows:
        tid = r["brackets"][-1] if r["brackets"] else "?"
        try:
            st, body, _ = s.req(r.pop("link"), check=lambda a, b: a == 200, tag=f"detail {tid}")
        except Exception as e:  # noqa: BLE001
            r["detail_error"] = str(e)[:120]
            continue
        html = body.decode("utf-8", "replace")
        r["type"], r["category"] = field(html, "Tender Type"), field(html, "Tender Category")
        r["value"], r["bid_validity"] = field(html, "Tender Value in &#8377;"), field(html, "Bid Validity(Days)")
        r["corr"] = corrigenda(html)
        for c in r["corr"]:
            link = c.pop("link")
            if captcha_seen or popups_asked >= 12 or c["type"] in popup_types or not link:
                continue
            popups_asked += 1
            popup_types.add(c["type"])
            try:
                st, pb, _ = s.req(link, tag=f"popup {tid} {c['type']}")
                (P.OUT / "popup" / f"{tid}_{len(popup_types)}.html").write_bytes(pb)
                captcha_seen = bool(re.search(rb"captcha", pb, re.I))
                c["popup"] = {"status": st, "bytes": len(pb), "captcha": captcha_seen}
            except Exception as e:  # noqa: BLE001
                c["popup"] = str(e)[:120]
    RES["detail_secs"] = round(time.time() - t0, 1)
    P.save("cppp_edu_detail.json", rows)
    with_corr = [r for r in rows if r.get("corr")]
    RES["tenders_with_corr"] = len(with_corr)
    RES["corr_types"] = Counter(c["type"] for r in rows for c in r.get("corr", [])).most_common()
    RES["popup_captcha"] = captcha_seen
    RES["cppp_sent"] = dict(P.SENT)
    save()


JK = "School Education Department Jammu and Kashmir"


def gem(budget_s=900):
    t_end = time.time() + budget_s
    tests = {
        "ft_phrase_awarded": ("/all-bids-data", P.ft(f'"{JK}"', by_status="bid_awarded", sort="Bid-End-Date-Latest")),
        "ft_plain_awarded": ("/all-bids-data", P.ft(JK, by_status="bid_awarded", sort="Bid-End-Date-Latest")),
        "ft_field_awarded": ("/all-bids-data", P.ft(f'ba_official_details_deptName:"{JK}"', by_status="bid_awarded",
                                                    sort="Bid-End-Date-Latest")),
        "ms_jk": ("/search-bids", P.ms(JK, "JAMMU & KASHMIR")),
        "ms_jk_awarded": ("/search-bids", P.ms(JK, "JAMMU & KASHMIR", bidStatusType="bidrastatus",
                                               byStatus="bid_awarded")),
    }
    out = {"setup_ok": 0, "setup_fail": 0}
    RES["gem"] = out
    sess = None
    for key, (path, payload) in tests.items():
        if time.time() > t_end:
            break
        try:
            if sess is None:
                sess = P.Sess("india", setup=P.gem_setup, spacing=1.2, tries=6, timeout=30)
                out["setup_ok"] += 1
            t0 = time.time()
            d, secs, n = P.gpost(sess, path, payload=payload, tag=key)
            r = P.rr(d) or {}
            docs = [P.slim(x) for x in r.get("docs", [])]
            out[key] = {"secs": round(time.time() - t0, 1), "numFound": r.get("numFound"),
                        "depts": Counter(x.get("ba_official_details_deptName") for x in docs).most_common(),
                        "statuses": [x.get("b_buyer_status") for x in docs],
                        "ends": [x.get("final_end_date_sort") for x in docs], "msg": None if r else str(d)[:300]}
        except RuntimeError as e:
            out["setup_fail" if sess is None else "search_fail_" + key] = str(e)[:120]
            sess = None
        except SystemExit as e:
            out["stopped"] = str(e)
            break
        save()
    out["sent"] = dict(P.SENT)
    save()


def main():
    for step in (cppp, gem):
        try:
            step()
        except BaseException as e:  # noqa: BLE001 - outermost: record and run the next step
            RES[f"{step.__name__}_error"] = repr(e)[:300]
            save()
    RES["finished_utc"] = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
    save()


if __name__ == "__main__":
    main()
