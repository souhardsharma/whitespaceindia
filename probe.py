"""Throwaway reader: registered education trials and the registers they could be joined to.

Reads only. One request a second a host, one connection at a time, TLS verified, every
answer logged to out/log.jsonl with its status, size and time. Stages are chosen in stage.txt.
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CTX = ssl.create_default_context()
LAST: dict[str, float] = {}
COUNT: dict[str, int] = {}
LOG = (OUT / "log.jsonl").open("a", encoding="utf-8")
KEEP_HEADERS = ("content-type", "content-length", "last-modified", "etag", "retry-after", "x-ratelimit-limit",
                "x-ratelimit-remaining", "x-rate-limit-limit", "x-rate-limit-interval", "ratelimit-limit",
                "ratelimit-remaining", "x-api-pool", "cf-cache-status", "content-disposition", "date",
                "x-ratelimit-reset", "x-ratelimit-credits-used", "x-ratelimit-credits-remaining")


def fetch(name: str, url: str, *, data: bytes | None = None, headers: dict | None = None, timeout: int = 60,
          save: str | None = None, gap: float = 1.0, stream_gz: bool = False):
    host = urllib.parse.urlsplit(url).netloc
    wait = LAST.get(host, 0) + gap - time.time()
    if wait > 0:
        time.sleep(wait)
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"} | (headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
    t0 = time.time()
    status, raw, rh, err = -1, b"", {}, ""
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            status, rh = r.status, {k.lower(): v for k, v in r.headers.items()}
            if stream_gz and save:
                n = 0
                enc = rh.get("content-encoding") == "gzip"
                src = gzip.GzipFile(fileobj=r) if enc else r
                with gzip.open(OUT / save, "wb", compresslevel=6) as f:
                    while True:
                        chunk = src.read(1 << 20)
                        if not chunk:
                            break
                        n += len(chunk)
                        f.write(chunk)
                raw = b"<streamed %d bytes>" % n
                rh["x-streamed-bytes"] = str(n)
            else:
                raw = r.read()
                if rh.get("content-encoding") == "gzip":
                    raw = gzip.decompress(raw)
    except urllib.error.HTTPError as e:
        status, rh = e.code, {k.lower(): v for k, v in (e.headers or {}).items()}
        try:
            raw = e.read()
            if rh.get("content-encoding") == "gzip":
                raw = gzip.decompress(raw)
        except Exception:  # noqa: BLE001
            raw = b""
    except Exception as e:  # noqa: BLE001 - a failure is a recorded result
        err = f"{type(e).__name__}: {e}"
    dt = time.time() - t0
    LAST[host] = time.time()
    COUNT[host] = COUNT.get(host, 0) + 1
    if save and not stream_gz and raw:
        p = OUT / save
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(raw)
    size = int(rh.get("x-streamed-bytes", len(raw)))
    LOG.write(json.dumps({"name": name, "url": url, "status": status, "bytes": size, "seconds": round(dt, 2),
                          "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "err": err,
                          "headers": {k: v for k, v in rh.items() if k in KEEP_HEADERS}}) + "\n")
    LOG.flush()
    print(f"{name}: {status} {size}b {dt:.1f}s {err}", flush=True)
    if status in (429, 500, 502, 503, 504):
        time.sleep(10)
    return status, raw, rh


def jget(name, url, **kw):
    s, raw, h = fetch(name, url, **kw)
    try:
        return s, json.loads(raw.decode("utf-8", "replace")), h
    except Exception:  # noqa: BLE001
        return s, None, h


# ---------------------------------------------------------------- stage 1: raw reads
def aea_raw():
    fetch("aea_robots", "https://www.socialscienceregistry.org/robots.txt", save="aea/robots.txt")
    fetch("aea_csv", "https://www.socialscienceregistry.org/site/csv", timeout=900, save="aea_trials.csv.gz",
          stream_gz=True)
    fetch("aea_csv_head_again", "https://www.socialscienceregistry.org/site/data", save="aea/data_page.html")


def dataverse():
    for alias in ("aearegistry", "aea-rct-registry", "AEARCTR"):
        s, j, _ = jget(f"dv_{alias}_0",
                       "https://dataverse.harvard.edu/api/search?q=*&subtree=%s&type=dataset&per_page=100"
                       "&sort=date&order=asc&start=0" % alias, save=f"dataverse/{alias}_0.json")
        if s == 200 and j and j.get("data", {}).get("total_count"):
            total = j["data"]["total_count"]
            start = 100
            while start < total and start < 400:
                jget(f"dv_{alias}_{start}",
                     "https://dataverse.harvard.edu/api/search?q=*&subtree=%s&type=dataset&per_page=100"
                     "&sort=date&order=asc&start=%d" % (alias, start), save=f"dataverse/{alias}_{start}.json")
                start += 100
            break


CT_EXPR = ('AREA[BriefTitle](school OR schools OR classroom OR preschool OR kindergarten OR literacy OR numeracy OR '
           'teacher OR teachers OR students OR "academic achievement" OR "academic performance" OR dyslexia OR '
           '"reading intervention" OR "early childhood education" OR tutoring OR curriculum) OR '
           'AREA[Keyword](school OR schools OR classroom OR preschool OR kindergarten OR literacy OR numeracy OR '
           'teacher OR teachers OR "academic achievement" OR "academic performance" OR dyslexia OR tutoring OR '
           'curriculum OR education) OR '
           'AREA[Condition]("academic achievement" OR "academic performance" OR literacy OR dyslexia OR '
           '"learning disabilities" OR "school readiness" OR "reading disability" OR "educational problems" OR '
           '"school dropout")')
CT_FIELDS = ["NCTId", "BriefTitle", "OverallStatus", "StudyType", "StartDate", "PrimaryCompletionDate",
             "PrimaryCompletionDateType", "CompletionDate", "StudyFirstSubmitDate", "StudyFirstPostDate",
             "ResultsFirstSubmitDate", "ResultsFirstPostDate", "LastUpdateSubmitDate", "LastUpdatePostDate",
             "LeadSponsorName", "LeadSponsorClass", "CollaboratorName", "CollaboratorClass", "SecondaryId",
             "SecondaryIdType", "InterventionType", "Condition", "Keyword", "LocationCountry", "HasResults",
             "Phase", "IsFDARegulatedDrug", "IsFDARegulatedDevice", "DispFirstSubmitDate", "OrgStudyId"]


def ctgov():
    fetch("ct_version", "https://clinicaltrials.gov/api/v2/version", save="ctgov/version.json")
    fields = list(CT_FIELDS)
    token, page, total = None, 0, None
    while page < 60:
        q = {"query.term": CT_EXPR, "filter.advanced": "AREA[StudyType]INTERVENTIONAL", "pageSize": "1000",
             "countTotal": "true", "fields": "|".join(fields)}
        if token:
            q["pageToken"] = token
        s, j, _ = jget(f"ct_edu_{page}", "https://clinicaltrials.gov/api/v2/studies?" + urllib.parse.urlencode(q),
                       save=f"ctgov/edu_{page:03d}.json", timeout=120)
        if s == 400 and page == 0 and len(fields) > 5:
            msg = (OUT / f"ctgov/edu_{page:03d}.json").read_text("utf-8", "replace")
            bad = [f for f in fields if f in msg]
            print("400:", msg[:300], "dropping", bad[:3], flush=True)
            if not bad:
                break
            fields = [f for f in fields if f not in bad]
            continue
        if s != 200 or not j:
            break
        total = j.get("totalCount", total)
        token = j.get("nextPageToken")
        page += 1
        if not token:
            break
    (OUT / "ctgov/fields_used.json").write_text(json.dumps({"fields": fields, "total": total, "pages": page}))
    # how many records of the whole register were last posted on each of the last 35 days
    today = time.gmtime()
    base = time.mktime(time.strptime(time.strftime("%Y-%m-%d", today), "%Y-%m-%d"))
    days = {}
    for back in range(1, 36):
        d = time.strftime("%Y-%m-%d", time.localtime(base - back * 86400))
        row = {}
        for label, area in (("upd", "LastUpdatePostDate"), ("new", "StudyFirstPostDate")):
            q = {"filter.advanced": f"AREA[{area}]RANGE[{d},{d}]", "pageSize": "1", "countTotal": "true",
                 "fields": "NCTId"}
            s, j, _ = jget(f"ct_all_{label}_{d}",
                           "https://clinicaltrials.gov/api/v2/studies?" + urllib.parse.urlencode(q), gap=0.7)
            row[label] = (j or {}).get("totalCount") if s == 200 else None
        days[d] = row
    (OUT / "ctgov/all_register_by_day.json").write_text(json.dumps(days, indent=1))


def nih_reporter():
    nums: dict[str, int] = {}
    for p in sorted((OUT / "ctgov").glob("edu_*.json")):
        try:
            j = json.loads(p.read_text("utf-8"))
        except Exception:  # noqa: BLE001
            continue
        for st in j.get("studies", []):
            ids = st.get("protocolSection", {}).get("identificationModule", {})
            for sec in ids.get("secondaryIdInfos", []) or []:
                if sec.get("type") in ("NIH", "OTHER_GRANT", "AHRQ"):
                    m = re.search(r"([A-Z][A-Z0-9]{2})\s?([A-Z]{2})\s?-?(\d{6})", (sec.get("id") or "").upper())
                    if m and sec.get("type") == "NIH":
                        core = "".join(m.groups())
                        nums[core] = nums.get(core, 0) + 1
    cores = sorted(nums)
    (OUT / "reporter").mkdir(exist_ok=True)
    (OUT / "reporter/core_nums_from_ctgov.json").write_text(json.dumps(cores))
    for i in range(0, min(len(cores), 2000), 100):
        body = {"criteria": {"project_nums": cores[i:i + 100]},
                "include_fields": ["ProjectNum", "CoreProjectNum", "FiscalYear", "AwardAmount", "ProjectStartDate",
                                   "ProjectEndDate", "AwardNoticeDate", "Organization", "AgencyIcAdmin", "ApplId",
                                   "ProjectTitle", "FundingMechanism", "ActivityCode"],
                "offset": 0, "limit": 500, "sort_field": "fiscal_year", "sort_order": "asc"}
        fetch(f"reporter_{i}", "https://api.reporter.nih.gov/v2/projects/search", data=json.dumps(body).encode(),
              headers={"Content-Type": "application/json", "Accept": "application/json"},
              save=f"reporter/batch_{i:05d}.json", timeout=120, gap=1.2)


def small_hosts():
    fetch("ohchr_late_countries", "https://tbinternet.ohchr.org/_layouts/15/TreatyBodyExternal/LateReporting.aspx",
          save="ohchr/late_countries.html")
    fetch("ohchr_late_treaty",
          "https://tbinternet.ohchr.org/_layouts/15/TreatyBodyExternal/LateReporting.aspx?Type=Treaty",
          save="ohchr/late_treaty.html")
    fetch("ohchr_india", "https://tbinternet.ohchr.org/_layouts/15/TreatyBodyExternal/Countries.aspx?"
          "CountryCode=IND&Lang=EN", save="ohchr/india.html")
    fetch("uhri_search", "https://uhri.ohchr.org/en/search-human-rights-recommendations", save="ohchr/uhri.html")
    fetch("isrctn_eef", "https://www.isrctn.com/api/query/format/default?q=%22Education%20Endowment%20Foundation%22"
          "&limit=100", save="isrctn/eef.xml", timeout=120)
    fetch("isrctn_school_edit", "https://www.isrctn.com/api/query/format/default?q=school%20AND%20lastEdited%20GT%20"
          "2026-10-19T00:00:00&limit=100", save="isrctn/school_recent.xml", timeout=120)
    fetch("rees_search", "https://sreereg.icpsr.umich.edu/sreereg/search/search", save="rees/search.html")
    fetch("rees_home", "https://sreereg.icpsr.umich.edu/sreereg/", save="rees/home.html")
    fetch("eric", "https://api.ies.ed.gov/eric/?search=randomized%20controlled%20trial&format=json&rows=5"
          "&fields=id,title,publicationdateyear,iesgrantcontractnum,iesfunded,e_datemodified,e_yearadded",
          save="eric/sample.json")
    fetch("osf_reg", "https://api.osf.io/v2/registrations/?page%5Bsize%5D=3&sort=-date_registered",
          save="osf/reg.json")
    fetch("nsf", "https://api.nsf.gov/services/v1/awards.json?keyword=%22randomized+controlled+trial%22&rpp=5"
          "&printFields=id,date,startDate,expDate,fundsObligatedAmt,awardeeName,fundProgramName,publicationResearch",
          save="nsf/sample.json")
    fetch("gtr", "https://gtr.ukri.org/gtr/api/projects?q=%22randomised+controlled+trial%22+school&s=5",
          headers={"Accept": "application/vnd.rcuk.gtr.json-v7"}, save="gtr/sample.json")


# ---------------------------------------------------------------- joins against the AEA registry
def aea_rows():
    p = OUT / "aea_trials.csv.gz"
    if not p.exists():
        return [], []
    csv.field_size_limit(1 << 30)
    with gzip.open(p, "rt", encoding="utf-8", errors="replace", newline="") as f:
        r = csv.reader(f)
        head = next(r)
        rows = [row for row in r]
    return head, rows


def col(head, *needles):
    for i, h in enumerate(head):
        low = h.lower()
        if all(n in low for n in needles):
            return i
    return None


def join_sample():
    head, rows = aea_rows()
    (OUT / "aea").mkdir(exist_ok=True)
    (OUT / "aea/header.json").write_text(json.dumps({"columns": head, "rows": len(rows)}, indent=1))
    if not rows:
        return
    c_doi, c_kw, c_id = col(head, "doi"), col(head, "keyword"), col(head, "rct", "id")
    paper_cols = [i for i, h in enumerate(head) if "paper" in h.lower() or "report" in h.lower()]
    print("cols", c_doi, c_kw, c_id, paper_cols, flush=True)
    if c_doi is None or c_kw is None:
        return
    edu = [r for r in rows if len(r) > max(c_doi, c_kw) and "education" in r[c_kw].lower() and r[c_doi].strip()]
    with_p = [r for r in edu if any(len(r) > i and r[i].strip() for i in paper_cols)]
    without = [r for r in edu if not any(len(r) > i and r[i].strip() for i in paper_cols)]
    sample = with_p[:: max(1, len(with_p) // 20)][:20] + without[:: max(1, len(without) // 20)][:20]
    res = []
    for r in sample:
        doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", r[c_doi].strip())
        rid = r[c_id].strip() if c_id is not None else ""
        row = {"doi": doi, "rct_id": rid, "has_paper_in_registry": r in with_p}
        s, j, _ = jget(f"crossref_{rid}", "https://api.crossref.org/works/" + urllib.parse.quote(doi, safe="/"))
        row["crossref_status"] = s
        if s == 200 and j:
            m = j.get("message", {})
            row["crossref_refby"] = m.get("is-referenced-by-count")
            row["crossref_type"] = m.get("type")
        s, j, h = jget(f"openalex_{rid}", "https://api.openalex.org/works/doi:" + doi)
        row["openalex_status"] = s
        row["openalex_headers"] = {k: v for k, v in h.items() if "limit" in k or "credit" in k or "cost" in k}
        if s == 200 and j:
            row["openalex_id"] = j.get("id")
            row["openalex_cited_by"] = j.get("cited_by_count")
            wid = (j.get("id") or "").rsplit("/", 1)[-1]
            s2, j2, h2 = jget(f"openalex_cites_{rid}",
                              "https://api.openalex.org/works?filter=cites:%s&per-page=25&select=id,doi,title,"
                              "publication_date,type" % wid)
            row["openalex_cites_status"] = s2
            row["openalex_cites_headers"] = {k: v for k, v in h2.items() if "limit" in k or "credit" in k or "cost" in k}
            if s2 == 200 and j2:
                row["openalex_citing"] = [{k: w.get(k) for k in ("doi", "publication_date", "type")}
                                          for w in j2.get("results", [])]
        s, j, _ = jget(f"oc_{rid}", "https://api.opencitations.net/index/v2/citations/doi:" + doi, timeout=60)
        row["opencitations_status"] = s
        if s == 200 and isinstance(j, list):
            row["opencitations_n"] = len(j)
        if rid:
            s, j, _ = jget(f"epmc_{rid}", "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=%22"
                           + urllib.parse.quote(rid) + "%22&format=json&pageSize=5&resultType=lite")
            row["epmc_status"] = s
            if s == 200 and j:
                row["epmc_hits"] = j.get("hitCount")
            s, j, h = jget(f"openalex_ft_{rid}", "https://api.openalex.org/works?filter=fulltext.search:%22"
                           + urllib.parse.quote(rid) + "%22&per-page=10&select=id,doi,publication_date,type")
            row["openalex_ft_status"] = s
            if s == 200 and j:
                row["openalex_ft_n"] = j.get("meta", {}).get("count")
                row["openalex_ft"] = [w.get("doi") for w in j.get("results", [])]
        res.append(row)
        (OUT / "aea/join_sample.json").write_text(json.dumps(res, indent=1))
    jget("epmc_all", "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=%22AEARCTR%22&format=json"
         "&pageSize=5&resultType=lite", save="aea/epmc_all.json")
    jget("openalex_ft_all", "https://api.openalex.org/works?filter=fulltext.search:AEARCTR&per-page=5"
         "&select=id,doi,publication_date", save="aea/openalex_ft_all.json")


def biggest_list(o, best=None):
    """The longest list of dicts anywhere in a JSON answer: the result rows."""
    best = best if best is not None else []
    if isinstance(o, list):
        if o and all(isinstance(x, dict) for x in o) and len(o) > len(best):
            best = o
        for x in o:
            best = biggest_list(x, best)
    elif isinstance(o, dict):
        for v in o.values():
            best = biggest_list(v, best)
    return best


def ies_eric():
    """IES awards (the Department's own search API) and every IES-funded ERIC record."""
    api = "https://api.ies.ed.gov/web/search/v1/execute"
    body = {"apiVersion": "1.0", "searchTerms": "", "singleSelectFilters": [],
            "multiSelectFilters": [{"mcontenttype": ["Grant", "Contract", "Cooperative agreement"],
                                    "recommended_display_name": "Result Type"}],
            "andedMultiSelectFilters": [], "rangeFilters": [], "geoDistanceFilter": {}, "bestBetSize": 5,
            "context": "https://ies.ed.gov", "userEID": "123", "typeAheadSelected": False, "raw": False,
            "pageNum": 0, "applyAutoFilter": True, "enableAutocorrect": True, "pageSize": 15,
            "maxFacetCount": 10, "sort": [], "urlsForDeductiveFilters": [], "preFilters": {},
            "relatedResultsClues": []}
    hdr = {"Content-Type": "application/json", "Accept": "application/json", "Origin": "https://ies.ed.gov",
           "Referer": "https://ies.ed.gov/"}

    def page(n, size, save):
        b = dict(body, pageNum=n, pageSize=size)
        return jget(f"ies_awards_p{n}_s{size}", api, data=json.dumps(b).encode(), headers=hdr, save=save)

    s, first, _ = page(0, 15, "ies/awards_s15_000.json")
    size = 15
    s2, big, _ = page(0, 200, "ies/awards_s200_000.json")
    if big is not None and len(biggest_list(big)) > 15:
        size = len(biggest_list(big)) if len(biggest_list(big)) < 200 else 200
    rows_seen, n = 0, 0
    slugs = []
    while n < 260:
        s, d, _ = page(n, size, f"ies/awards_{n:03d}.json")
        rows = biggest_list(d) if d is not None else []
        if s != 200 or not rows:
            break
        rows_seen += len(rows)
        slugs += re.findall(r"/use-work/awards/[a-z0-9\-]+", json.dumps(rows))
        n += 1
        if rows_seen >= 3600:
            break
    (OUT / "ies" / "awards_read.json").write_text(json.dumps({"page_size": size, "pages": n, "rows": rows_seen,
                                                               "slugs": len(set(slugs))}))
    # ERIC: every IES-funded record, year by year (rows capped at 200 an answer)
    eric = "https://api.ies.ed.gov/eric/"
    fields = ("id,title,publicationdateyear,e_yearadded,e_datemodified,iesgrantcontractnum,iesfunded,"
              "peerreviewed,publicationtype,source,e_fulltextauth,iescited,ieswwcreviewed")
    ids, per_year = [], {}
    gz = gzip.open(OUT / "eric_iesfunded.jsonl.gz", "wt", encoding="utf-8")
    for label, q in [("pre2000", "publicationdateyear:[1900 TO 1999]")] + [(str(y), f"publicationdateyear:{y}")
                                                                           for y in range(2000, 2028)]:
        start, found = 0, None
        while True:
            u = eric + "?" + urllib.parse.urlencode({"search": f"iesfunded:Y AND {q}", "format": "json",
                                                     "rows": 200, "start": start, "fields": fields})
            s, d, _ = jget(f"eric_{label}_{start}", u, gap=1.0)
            docs = ((d or {}).get("response") or {}).get("docs") or []
            found = ((d or {}).get("response") or {}).get("numFound", found)
            for doc in docs:
                ids.append(doc.get("id"))
                gz.write(json.dumps(doc) + "\n")
            start += 200
            if s != 200 or not docs or (found is not None and start >= found) or start > 20000:
                break
        per_year[label] = found
    gz.close()
    counts = {}
    for label, q in (("iesfunded_all", "iesfunded:Y"), ("iesfunded_added_2026", "iesfunded:Y AND e_yearadded:2026"),
                     ("iesfunded_added_2025", "iesfunded:Y AND e_yearadded:2025"),
                     ("all_added_2026", "e_yearadded:2026"), ("all", "*:*")):
        u = eric + "?" + urllib.parse.urlencode({"search": q, "format": "json", "rows": 1, "fields": "id"})
        s, d, _ = jget("eric_count_" + label, u)
        counts[label] = ((d or {}).get("response") or {}).get("numFound")
    (OUT / "eric_read.json").write_text(json.dumps({"utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                                    "records": len(ids), "distinct": len(set(ids)),
                                                    "per_year": per_year, "counts": counts}, indent=1))
    (OUT / "eric_ids.txt").write_text("\n".join(sorted(x for x in set(ids) if x)))
    # award pages: five named ones and up to sixty more, for cases (number, period, amount)
    known = ["project-citizen-research-program",
             "longitudinal-study-latino-students-grade-3-academic-achievement-role-early-childhood-family-and",
             "getting-effective-leaders-high-needs-schools-cross-site-mixed-methods-examination-principal",
             "follow-replicating-cgi-experiment-diverse-environments-study",
             "child-instruction-interactions-reading-examining-causal-effects-individualized-instruction-second"]
    uniq = sorted(set(slugs))
    step = max(1, len(uniq) // 60)
    for i, slug in enumerate(["/use-work/awards/" + k for k in known] + uniq[::step][:60]):
        fetch(f"ies_award_page_{i}", "https://ies.ed.gov" + slug, save=f"ies/pages/{i:03d}.html")


STAGES = {"aea_raw": aea_raw, "dataverse": dataverse, "ctgov": ctgov, "nih_reporter": nih_reporter,
          "small_hosts": small_hosts, "join_sample": join_sample, "ies_eric": ies_eric}

if __name__ == "__main__":
    wanted = (HERE / "stage.txt").read_text().split()
    for name in wanted:
        print("== stage", name, flush=True)
        try:
            STAGES[name]()
        except Exception as e:  # noqa: BLE001
            print("stage failed", name, type(e).__name__, e, flush=True)
            LOG.write(json.dumps({"name": "STAGE_FAILED_" + name, "err": f"{type(e).__name__}: {e}"}) + "\n")
    (OUT / "request_counts.json").write_text(json.dumps(COUNT, indent=1))
    print(json.dumps(COUNT), flush=True)
    sys.exit(0)
