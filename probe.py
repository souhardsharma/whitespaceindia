"""Reopen-procurement probe (read only).

A. CPPP GePNIC from the runner's own address: organisation table, every education organisation's
   active list, the detail page of every re-tendered (suffix > 1) tender, and the gated pages once
   each to record that they ask a CAPTCHA (none is answered).
B. GeM through the Indian pool: how often a session opens, how often an awarded-bid search answers,
   how long each answered request takes, and the award dates of school-education buyers, so that a
   weekly read can be costed.
C. The India Procurement Watch dump (third-party copy of CPPP to 26 Jun 2026), if it was downloaded
   by the workflow: re-tender cadence by week and the _1/_N title match, for education organisations.
"""
import json
import os
import re
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib_procure as P  # noqa: E402

RES = {"started_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())}
TID = re.compile(r"^(\d{4})_([A-Za-z0-9]+)_(\d+)_(\d+)$")


def save():
    P.save("result.json", RES)


def cppp():
    s = P.Sess("open", spacing=1.2)
    t0 = time.time()
    orgs, n = P.cppp_org_table(s, tag="orgs")
    edu = [o for o in orgs if P.EDU.search(o["name"]) and not P.NOT_EDU.search(o["name"])]
    RES["cppp_orgs_total"] = len(orgs)
    RES["cppp_edu_orgs"] = [(o["name"], o["count"]) for o in edu]
    tenders = []
    for o in edu:
        try:
            st, body, _ = s.req(o["link"], check=lambda a, b: a == 200, tag=f"org {o['name'][:40]}")
        except Exception as e:  # noqa: BLE001 - one organisation failing is recorded, the sweep goes on
            RES.setdefault("org_errors", []).append([o["name"], str(e)[:120]])
            continue
        links = re.findall(r'href="([^"]*FrontEndViewTender[^"]*)"', body.decode("utf-8", "replace"))
        rows = P.cppp_tenders(body.decode("utf-8", "replace"), o["name"])
        for r, link in zip(rows, links):
            r["link"] = "https://eprocure.gov.in" + link.replace("&amp;", "&")
        tenders += rows
    RES["cppp_sweep_secs"] = round(time.time() - t0, 1)
    retendered = []
    for r in tenders:
        m = TID.match(r["brackets"][-1]) if r["brackets"] else None
        r["suffix"] = int(m.group(4)) if m else None
        if r["suffix"] and r["suffix"] > 1:
            retendered.append(r)
    (P.OUT / "detail").mkdir(exist_ok=True)
    for r in retendered:
        try:
            st, body, _ = s.req(r["link"], check=lambda a, b: a == 200, tag=f"detail {r['brackets'][-1]}")
            (P.OUT / "detail" / (r["brackets"][-1] + ".html")).write_bytes(body)
        except Exception as e:  # noqa: BLE001
            r["detail_error"] = str(e)[:120]
    for r in tenders:
        r.pop("link", None)
    P.save("cppp_edu_tenders.json", tenders)
    RES["cppp_tenders"] = len(tenders)
    RES["cppp_suffix"] = sorted(Counter(r["suffix"] for r in tenders).items(), key=lambda x: (x[0] is None, x[0]))
    for pg in ("WebCancelledTenderLists", "ResultOfTenders", "FrontEndLatestActiveCorrigendums"):
        try:
            st, body, _ = s.req(f"{P.C}?page={pg}&service=page", tag=f"gated {pg}")
            RES[f"gated_{pg}"] = {"status": st, "bytes": len(body),
                                  "captcha": bool(re.search(rb"captcha", body, re.I)),
                                  "rows": len(P.cppp_rows(body.decode("utf-8", "replace")))}
        except Exception as e:  # noqa: BLE001
            RES[f"gated_{pg}"] = str(e)[:120]
    RES["cppp_sent"] = dict(P.SENT)
    save()


SCHOOL_QUERIES = ['"Samagra Shiksha"', '"School Education"', '"Basic Shiksha"', '"Kendriya Vidyalaya"']


def gem(budget_s=1500):
    """Awarded bids of school buyers through the Indian pool, inside a time budget."""
    t_end = time.time() + budget_s
    out = {"setup_ok": 0, "setup_fail": 0, "search_ok": 0, "search_fail": 0, "search_secs": [], "awards": []}
    RES["gem"] = out
    sess = None
    for q in SCHOOL_QUERIES:
        for page in (1, 2, 3):
            if time.time() > t_end:
                break
            try:
                if sess is None:
                    sess = P.Sess("india", setup=P.gem_setup, spacing=1.2, tries=6, timeout=30)
                    out["setup_ok"] += 1
                t0 = time.time()
                d, secs, n = P.gpost(sess, "/all-bids-data",
                                     payload=P.ft(q, by_status="bid_awarded", sort="Bid-End-Date-Latest", page=page),
                                     tag=f"awarded {q} p{page}")
                out["search_ok"] += 1
                out["search_secs"].append(round(time.time() - t0, 1))
                docs = (P.rr(d) or {}).get("docs", [])
                out["awards"] += [{"q": q, **P.slim(x)} for x in docs]
                out.setdefault("numFound", {})[q] = (P.rr(d) or {}).get("numFound")
            except RuntimeError as e:
                if sess is None:
                    out["setup_fail"] += 1
                else:
                    out["search_fail"] += 1
                sess = None
                out.setdefault("errors", []).append(str(e)[:120])
            except SystemExit as e:
                out.setdefault("errors", []).append(str(e))
                break
            save()
    out["sent"] = dict(P.SENT)
    save()


def dump():
    db = Path(os.environ.get("DUMP_DB", "dump/tenders_vps.db"))
    if not db.exists():
        RES["dump"] = "not downloaded"
        return
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    tables = {t: [c[1] for c in con.execute(f"PRAGMA table_info({t})")]
              for (t,) in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    RES["dump_tables"] = tables
    save()
    cols = tables.get("tenders", [])
    org_col = next((c for c in cols if "org" in c.lower()), None)
    id_col = next((c for c in cols if c.lower() in ("tender_id", "tenderid")), None)
    pub_col = next((c for c in cols if "publish" in c.lower()), None)
    title_col = next((c for c in cols if "title" in c.lower()), None)
    corr_col = next((c for c in cols if "corrig" in c.lower()), None)
    RES["dump_cols_used"] = [org_col, id_col, pub_col, title_col, corr_col]
    if not (org_col and id_col and pub_col):
        save()
        return
    sql = f"SELECT {org_col}, {id_col}, {pub_col}, {title_col or 'NULL'}, {corr_col or 'NULL'} FROM tenders"
    edu_rows, orgs, n = [], Counter(), 0
    for org, tid, pub, title, corr in con.execute(sql):
        n += 1
        if org and P.EDU.search(org) and not P.NOT_EDU.search(org):
            edu_rows.append((org, tid, pub, title, corr))
            orgs[org] += 1
    RES["dump_rows"] = n
    RES["dump_edu_rows"] = len(edu_rows)
    RES["dump_edu_orgs"] = len(orgs)
    RES["dump_pub_samples"] = [r[2] for r in edu_rows[:5]]

    def day(v):
        text = str(v or "").strip()
        for fmt, width in (("%d-%b-%Y %I:%M %p", 20), ("%Y-%m-%d %H:%M:%S", 19), ("%Y-%m-%dT%H:%M:%S", 19),
                           ("%d-%m-%Y %H:%M", 16), ("%d-%b-%Y", 11), ("%Y-%m-%d", 10), ("%d-%m-%Y", 10)):
            try:
                return datetime.strptime(text[:width], fmt).date()
            except ValueError:
                continue
        return None

    by_base = defaultdict(list)
    dated = []
    for org, tid, pub, title, corr in edu_rows:
        m = TID.match(str(tid or ""))
        d = day(pub)
        if not m:
            continue
        by_base[(m.group(1), m.group(2), m.group(3))].append((int(m.group(4)), d, title, org, corr))
        dated.append((int(m.group(4)), d, bool(corr)))
    last = max((d for _, d, _ in dated if d), default=None)
    RES["dump_last_pub"] = str(last)
    if last:
        start = last - timedelta(days=7 * 12 + last.weekday())
        weeks = defaultdict(lambda: {"retender_days": set(), "retenders": 0, "tenders": 0, "corr_url": 0})
        for suf, d, corr in dated:
            if not d or d < start:
                continue
            w = str(d - timedelta(days=d.weekday()))
            weeks[w]["tenders"] += 1
            weeks[w]["corr_url"] += corr
            if suf > 1:
                weeks[w]["retenders"] += 1
                weeks[w]["retender_days"].add(str(d))
        RES["dump_weeks"] = {w: {**v, "retender_days": len(v["retender_days"])} for w, v in sorted(weeks.items())}
    pairs = []
    for base, items in by_base.items():
        sufs = {s for s, *_ in items}
        if len(sufs) > 1:
            items.sort(key=lambda x: x[0])
            pairs.append({"base": "_".join(base), "rounds": [[s, str(d), (t or "")[:120], o[:50]] for s, d, t, o, _ in items]})
    RES["dump_multi_round_bases"] = len(pairs)
    RES["dump_suffix_counts"] = sorted(Counter(s for s, _, _ in dated).items())
    P.save("dump_pairs.json", pairs)
    save()


def main():
    for step in (cppp, gem, dump):
        try:
            step()
        except BaseException as e:  # noqa: BLE001 - outermost: record and run the next step
            RES[f"{step.__name__}_error"] = repr(e)[:300]
            save()
    RES["finished_utc"] = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
    save()


if __name__ == "__main__":
    main()
