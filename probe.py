import urllib.request, json, time, os, re
os.makedirs("out", exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (research probe; public inspection reports)"}
log = []
def get(name, url):
    t0 = time.time()
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60)
        body = r.read(); st = r.status; waf = r.headers.get("x-amzn-waf-action", "")
    except urllib.error.HTTPError as e:
        body = e.read(); st = e.code; waf = e.headers.get("x-amzn-waf-action", "")
    except Exception as e:
        body = b""; st = -1; waf = repr(e)[:120]
    open(f"out/{name}", "wb").write(body)
    log.append({"name": name, "url": url, "status": st, "waf": waf, "bytes": len(body), "s": round(time.time() - t0, 2)})
    time.sleep(1.5)
S = "https://reports.ofsted.gov.uk/search?level_1_types=2&level_2_types=6"
get("robots.txt", "https://reports.ofsted.gov.uk/robots.txt")
for start in (0, 500, 1000, 1500):
    get(f"search_12wk_{start}.html", f"{S}&latest_report_date_start=24-08-2026&latest_report_date_end=17-11-2026&rows=500&start={start}&sort=date&order=desc")
for start in range(0, 8000, 500):
    get(f"noreport_{start}.html", f"{S}&rows=500&start={start}&sort=date&order=asc")
for u in json.load(open("urns.json")):
    get(f"prov_{u}.html", f"https://reports.ofsted.gov.uk/provider/16/{u}")
json.dump(log, open("out/log.json", "w"), indent=1)
from collections import Counter
print(Counter((x["status"], x["waf"]) for x in log))
