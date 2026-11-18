"""Reads a few public Poshan Tracker map files from the runner, with and without a query string, and
records the headers that show which cached copy was served. Writes out/report.json. Reads only."""
import hashlib, json, os, ssl, time, urllib.request
from pathlib import Path

BASE = "https://cdn.poshantracker.in/pt_maps_v2/2026"
PATHS = ["20261109_20261115/1/383", "20261109_20261115/17/126", "20261109_20261115/24/643",
         "20261102_20261108/1/383", "20261116_20261122/1/383", "10/1/383"]
RUN = os.environ.get("GITHUB_RUN_ID", "local")
CTX = ssl.create_default_context()
out = Path("out"); out.mkdir(exist_ok=True)
rep = []
for p in PATHS:
    for q in ("", "?v1", f"?r={RUN}"):
        url = f"{BASE}/{p}/mapsAWCOpen_AWCData.json{q}"
        rec = {"path": p, "query": q, "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (research probe)",
                                                       "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
                body = r.read()
                rec.update(status=r.status, bytes=len(body), sha=hashlib.sha256(body).hexdigest()[:16],
                           **{h: r.headers.get(h) for h in ("Last-Modified", "ETag", "X-Cache", "Age",
                                                            "X-Amz-Cf-Pop", "Cache-Control")})
                tot = [0, 0]
                def walk(o):
                    if isinstance(o, dict):
                        if "awc_id" in o and "no_of_days_opens" in o:
                            tot[0] += 1; tot[1] += int(o["no_of_days_opens"]); return
                        for v in o.values(): walk(v)
                    elif isinstance(o, list):
                        for v in o: walk(v)
                walk(json.loads(body))
                rec.update(centres=tot[0], days=tot[1])
        except urllib.error.HTTPError as e:
            rec.update(status=e.code)
        except Exception as e:  # noqa: BLE001
            rec.update(status=-1, error=str(e)[:200])
        rep.append(rec)
        print(json.dumps(rec))
        time.sleep(1)
(out / "report.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
