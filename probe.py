"""Read official hazard footprints and official school registers from this runner; join them.

Reads only. One request a second a host. TLS verified. Everything read is saved under out/.
"""
from __future__ import annotations

import array
import csv
import gzip
import io
import json
import math
import os
import re
import ssl
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
RAW = OUT / "raw"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CTX = ssl.create_default_context()
LAST: dict[str, float] = {}
COUNTS: dict[str, int] = {}
LOG = []
T0 = time.time()


def log(*a):
    s = " ".join(str(x) for x in a)
    LOG.append(f"{time.time() - T0:7.1f}s {s}")
    print(s, flush=True)


def get(url: str, timeout: int = 90, pause: float = 1.0, tries: int = 2) -> tuple[int, bytes]:
    host = urllib.parse.urlsplit(url).netloc
    for attempt in range(tries):
        wait = LAST.get(host, 0) + pause - time.time()
        if wait > 0:
            time.sleep(wait)
        LAST[host] = time.time()
        COUNTS[host] = COUNTS.get(host, 0) + 1
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"})
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return r.status, raw
        except urllib.error.HTTPError as e:
            body = e.read()
            if e.code in (429, 500, 502, 503, 504) and attempt + 1 < tries:
                time.sleep(10)
                continue
            return e.code, body
        except Exception as e:  # noqa: BLE001
            if attempt + 1 < tries:
                time.sleep(5)
                continue
            return -1, f"{type(e).__name__}: {e}".encode()
    return -1, b""


def save(name: str, raw: bytes) -> Path:
    p = RAW / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(raw)
    return p


RESULTS = []


def fetch(name: str, url: str, timeout: int = 90, keep: bool = True) -> tuple[int, bytes]:
    t = time.time()
    s, raw = get(url, timeout)
    RESULTS.append({"name": name, "url": url, "status": s, "bytes": len(raw), "seconds": round(time.time() - t, 2),
                    "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t)), "head": raw[:120].decode("utf-8", "replace")})
    log(f"{s:>4} {len(raw):>11,} {time.time() - t:6.1f}s {name}")
    if keep:
        save(name, raw)
    return s, raw


# ---------------------------------------------------------------- registers
SCHOOLS: list[tuple] = []  # (country, id, name, admin1, admin2, lat, lon, enrol)
REG_INFO: dict[str, dict] = {}


def fnum(x):
    try:
        v = float(str(x).replace(",", "."))
        return v if math.isfinite(v) else None
    except Exception:  # noqa: BLE001
        return None


def reg_nces():
    base = "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_ADMINDATA_PUBLICSCH_2425/MapServer"
    s, raw = fetch("nces/service.json", base + "?f=json")
    meta = json.loads(raw)
    lid = meta["layers"][0]["id"]
    s, raw = fetch("nces/layer.json", f"{base}/{lid}?f=json")
    lay = json.loads(raw)
    names = [f["name"] for f in lay["fields"]]
    page = min(int(lay.get("maxRecordCount") or 1000), 2000)
    s, raw = fetch("nces/count.json", f"{base}/{lid}/query?where=1%3D1&returnCountOnly=true&f=json")
    total = json.loads(raw).get("count")

    def pick(*c):
        for x in c:
            if x in names:
                return x
        return None
    f_id, f_nm = pick("NCESSCH"), pick("SCH_NAME", "NAME")
    f_st, f_co = pick("STABR", "LSTATE", "STATE", "ST"), pick("NMCNTY", "CNTY", "LEA_NAME")
    f_en = pick("TOTAL", "MEMBER", "ENROLLMENT")
    f_lat, f_lon = pick("LATCOD", "LAT"), pick("LONCOD", "LON")
    want = [x for x in (f_id, f_nm, f_st, f_co, f_en, f_lat, f_lon) if x]
    REG_INFO["US"] = {"source": base, "layer": lay.get("name"), "fields": names, "used": want, "count_reported": total,
                      "maxRecordCount": lay.get("maxRecordCount")}
    off, n, t = 0, 0, time.time()
    while True:
        q = (f"{base}/{lid}/query?where=1%3D1&outFields={','.join(want)}&returnGeometry=true&outSR=4326"
             f"&orderByFields={f_id}&resultOffset={off}&resultRecordCount={page}&f=json")
        s, raw = get(q, 120)
        if s != 200:
            log("nces page fail", off, s, raw[:100])
            break
        d = json.loads(raw)
        feats = d.get("features", [])
        for ft in feats:
            a, g = ft["attributes"], ft.get("geometry") or {}
            lat = fnum(a.get(f_lat)) if f_lat else None
            lon = fnum(a.get(f_lon)) if f_lon else None
            if lat is None:
                lat, lon = g.get("y"), g.get("x")
            if lat is None:
                continue
            en = fnum(a.get(f_en)) if f_en else None
            SCHOOLS.append(("US", str(a.get(f_id)), a.get(f_nm), a.get(f_st), a.get(f_co), lat, lon,
                            en if en is not None and en >= 0 else None))
        n += len(feats)
        off += len(feats)
        if not feats or (not d.get("exceededTransferLimit") and len(feats) < page):
            break
    REG_INFO["US"].update({"rows_read": n, "seconds": round(time.time() - t, 1), "requests": COUNTS.get("nces.ed.gov")})
    log("NCES rows", n, "of", total)


def extract(archive: Path, dest: Path) -> list[Path]:
    dest.mkdir(parents=True, exist_ok=True)
    for cmd in (["7z", "x", "-y", f"-o{dest}", str(archive)], ["unar", "-f", "-o", str(dest), str(archive)],
                ["bsdtar", "-xf", str(archive), "-C", str(dest)]):
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=300)
            files = [p for p in dest.rglob("*") if p.is_file()]
            if files:
                log("extracted with", cmd[0], len(files), "files")
                return files
            log(cmd[0], "gave nothing:", r.stderr[-200:])
        except Exception as e:  # noqa: BLE001
            log(cmd[0], "failed", e)
    return []


def reg_chile():
    url = "https://datosabiertos.mineduc.cl/wp-content/uploads/2026/11/Directorio-EE-Oficial-2026.rar"
    s, raw = fetch("cl/directorio2026.rar", url, 180)
    if s != 200:
        return
    files = extract(RAW / "cl/directorio2026.rar", OUT / "tmp_cl")
    REG_INFO["CL"] = {"source": url, "files": [f.name for f in files]}
    for f in files:
        if f.suffix.lower() != ".csv":
            continue
        txt = f.read_bytes().decode("utf-8-sig", "replace")
        delim = ";" if txt[:2000].count(";") > txt[:2000].count(",") else ","
        rd = csv.DictReader(io.StringIO(txt), delimiter=delim)
        REG_INFO["CL"]["columns"] = rd.fieldnames
        n = 0
        for r in rd:
            r = {(k or "").strip().upper(): v for k, v in r.items()}
            n += 1
            if str(r.get("ESTADO_ESTAB", "1")).strip() != "1":
                continue
            lat, lon = fnum(r.get("LATITUD")), fnum(r.get("LONGITUD"))
            if lat is None or lon is None or lat == 0:
                continue
            SCHOOLS.append(("CL", r.get("RBD"), r.get("NOM_RBD"), r.get("NOM_REG_RBD_A"), r.get("NOM_COM_RBD"),
                            lat, lon, fnum(r.get("MAT_TOTAL"))))
        REG_INFO["CL"]["rows_in_file"] = n
    log("Chile schools", sum(1 for x in SCHOOLS if x[0] == "CL"))


def read_dbf(raw: bytes, enc: str) -> list[dict]:
    nrec, hlen, rlen = struct.unpack("<IHH", raw[4:12])
    fields, pos = [], 32
    while raw[pos] != 0x0D:
        name = raw[pos:pos + 11].split(b"\0")[0].decode("ascii", "replace")
        fields.append((name, raw[pos + 16]))
        pos += 32
    out = []
    for i in range(nrec):
        rec = raw[hlen + i * rlen: hlen + (i + 1) * rlen]
        o, d = 1, {}
        for name, ln in fields:
            d[name] = rec[o:o + ln].decode(enc, "replace").strip()
            o += ln
        out.append(d)
    return out


def read_shp_points(raw: bytes) -> list[tuple]:
    pts, pos = [], 100
    while pos + 12 <= len(raw):
        clen = struct.unpack(">i", raw[pos + 4:pos + 8])[0] * 2
        st = struct.unpack("<i", raw[pos + 8:pos + 12])[0]
        if st in (1, 11, 21):
            x, y = struct.unpack("<dd", raw[pos + 12:pos + 28])
            pts.append((x, y))
        else:
            pts.append((None, None))
        pos += 8 + clen
    return pts


def reg_japan():
    url = "https://nlftp.mlit.go.jp/ksj/gml/data/P29/P29-23/P29-23_GML.zip"
    s, raw = fetch("jp/P29-23_GML.zip", url, 180)
    if s != 200:
        return
    z = zipfile.ZipFile(io.BytesIO(raw))
    names = z.namelist()
    REG_INFO["JP"] = {"source": url, "files": names[:40]}
    n = 0
    gj = [x for x in names if x.lower().endswith(".geojson")]
    if gj:
        for name in gj:
            d = json.loads(z.read(name).decode("utf-8", "replace"))
            for ft in d.get("features", []):
                p, g = ft.get("properties", {}), ft.get("geometry") or {}
                if g.get("type") != "Point":
                    continue
                lon, lat = g["coordinates"][:2]
                SCHOOLS.append(("JP", p.get("P29_002") or p.get("P29_001"), p.get("P29_004"), str(p.get("P29_001"))[:2],
                                p.get("P29_003"), lat, lon, None))
                n += 1
            REG_INFO["JP"]["properties"] = list((d.get("features") or [{}])[0].get("properties", {}).keys())
    else:
        for name in [x for x in names if x.lower().endswith(".shp")]:
            pts = read_shp_points(z.read(name))
            dbf = read_dbf(z.read(name[:-4] + ".dbf"), "cp932")
            REG_INFO["JP"]["properties"] = list(dbf[0].keys()) if dbf else []
            for (x, y), p in zip(pts, dbf):
                if x is None:
                    continue
                SCHOOLS.append(("JP", p.get("P29_002") or p.get("P29_001"), p.get("P29_004"), str(p.get("P29_001"))[:2],
                                p.get("P29_003"), y, x, None))
                n += 1
    REG_INFO["JP"]["rows_read"] = n
    log("Japan schools", n)


def reg_discovery():
    for name, url in [
        ("disc/nz_directory.csv", "https://www.educationcounts.govt.nz/__data/assets/file/0003/62571/Directory-School-current.csv"),
        ("disc/nz_ckan.json", "https://catalogue.data.govt.nz/api/3/action/package_search?q=school+directory&rows=5"),
        ("disc/pe_padron.html", "https://escale.minedu.gob.pe/uee/-/document_library_display/GMv7/view/958881"),
        ("disc/pe_padron2.html", "https://escale.minedu.gob.pe/padron-de-iiee"),
        ("disc/hdx_ph.json", "https://data.humdata.org/api/3/action/package_search?q=schools&fq=groups:phl&rows=30"),
        ("disc/hdx_vu.json", "https://data.humdata.org/api/3/action/package_search?q=schools&fq=groups:vut&rows=30"),
        ("disc/hdx_id.json", "https://data.humdata.org/api/3/action/package_search?q=schools&fq=groups:idn&rows=30"),
        ("disc/hdx_ht.json", "https://data.humdata.org/api/3/action/package_search?q=schools&fq=groups:hti&rows=30"),
        ("disc/hdx_np.json", "https://data.humdata.org/api/3/action/package_search?q=schools&fq=groups:npl&rows=30"),
        ("disc/hdx_mz.json", "https://data.humdata.org/api/3/action/package_search?q=schools&fq=groups:moz&rows=30"),
        ("disc/co_catalog.json", "https://api.us.socrata.com/api/catalog/v1?domains=www.datos.gov.co&q=sedes%20educativas&limit=20"),
        ("disc/mx_ckan.json", "https://www.datos.gob.mx/api/3/action/package_search?q=escuelas+coordenadas&rows=10"),
        ("disc/gdacs_swagger.json", "https://www.gdacs.org/gdacsapi/swagger/v1/swagger.json"),
        ("disc/ss_home_uk.html", "https://saveschools.in.ua/"),
        ("disc/ss_wpjson.json", "https://saveschools.in.ua/wp-json/"),
        ("disc/ss_mapjs.js", "https://saveschools.in.ua/wp-content/themes/ukr-osvita/assets/js/map.js"),
        ("disc/ss_mainjs.js", "https://saveschools.in.ua/wp-content/themes/ukr-osvita/assets/js/main.js"),
        ("disc/giga_api.json", "https://uni-ooi-giga-maps-service.azurewebsites.net/api/v1/schools_location/country/144?size=2"),
    ]:
        try:
            fetch(name, url, 60)
        except Exception as e:  # noqa: BLE001
            log("disc fail", name, e)


# ---------------------------------------------------------------- shakemaps
def parse_grid(raw: bytes):
    if raw[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(raw))
        raw = z.read(z.namelist()[0])
    txt = raw.decode("utf-8", "replace")
    spec = re.search(r"<grid_specification([^>]*)>", txt).group(1)
    a = {k: float(v) for k, v in re.findall(r'(\w+)="([-\d.eE+]+)"', spec)}
    fields = {n.upper(): int(i) - 1 for i, n in re.findall(r'<grid_field index="(\d+)" name="(\w+)"', txt)}
    body = txt[txt.index("<grid_data>") + 11: txt.rindex("</grid_data>")]
    nlon, nlat = int(a["nlon"]), int(a["nlat"])
    dx, dy = a["nominal_lon_spacing"], a["nominal_lat_spacing"]
    arr = array.array("f", [0.0]) * (nlon * nlat)
    il, it, im = fields["LON"], fields["LAT"], fields["MMI"]
    for line in body.splitlines():
        p = line.split()
        if len(p) <= im:
            continue
        i = int(round((float(p[il]) - a["lon_min"]) / dx))
        j = int(round((a["lat_max"] - float(p[it])) / dy))
        if 0 <= i < nlon and 0 <= j < nlat:
            arr[j * nlon + i] = float(p[im])
    return a, nlon, nlat, dx, dy, arr


def mmi_at(g, lat, lon):
    a, nlon, nlat, dx, dy, arr = g
    if not (a["lat_min"] <= lat <= a["lat_max"]):
        return None
    for lo in (lon, lon + 360.0, lon - 360.0):
        if a["lon_min"] <= lo <= a["lon_max"]:
            i = int(round((lo - a["lon_min"]) / dx))
            j = int(round((a["lat_max"] - lat) / dy))
            if 0 <= i < nlon and 0 <= j < nlat:
                return arr[j * nlon + i]
    return None


BANDS = [(3.5, "IV"), (4.5, "V"), (5.5, "VI"), (6.5, "VII"), (7.5, "VIII+")]


def band(m):
    b = None
    for lo, nm in BANDS:
        if m >= lo:
            b = nm
    return b


VALID = [  # label, start, end, minmag, lat, lon, radius km
    ("anchorage2018", "2018-11-30", "2018-12-01", 6.9, 61.3, -150.0, 200),
    ("puertorico2020", "2020-01-07", "2020-01-08", 6.3, 18.0, -66.8, 200),
    ("napa2014", "2014-08-24", "2014-08-25", 5.9, 38.2, -122.3, 100),
    ("ferndale2022", "2022-12-20", "2022-12-21", 6.2, 40.5, -124.4, 150),
    ("ridgecrest2019", "2019-07-06", "2019-07-07", 7.0, 35.8, -117.6, 100),
    ("illapel2015", "2015-09-16", "2015-09-17", 8.0, -31.6, -71.7, 300),
    ("iquique2014", "2014-04-01", "2014-04-02", 8.0, -19.6, -70.8, 300),
    ("maule2010", "2010-02-27", "2010-02-28", 8.5, -36.1, -72.9, 400),
    ("noto2024", "2024-01-01", "2024-01-02", 7.3, 37.5, 137.2, 200),
    ("kumamoto2016", "2016-04-15", "2016-04-16", 6.9, 32.8, 130.7, 150),
    ("fukushima2022", "2022-03-16", "2022-03-17", 7.2, 37.7, 141.6, 200),
    ("osaka2018", "2018-06-17", "2018-06-18", 5.4, 34.8, 135.6, 100),
    ("hokkaido2018", "2018-09-05", "2018-09-06", 6.5, 42.7, 142.0, 150),
    ("sparta2020", "2020-08-09", "2020-08-10", 5.0, 36.5, -81.1, 100),
    ("magna2020", "2020-03-18", "2020-03-19", 5.5, 40.75, -112.08, 100),
]


def shakemap_for(eid: str, label: str):
    s, raw = get(f"https://earthquake.usgs.gov/fdsnws/event/1/query?eventid={eid}&format=geojson", 60)
    if s != 200:
        log("detail fail", eid, s)
        return None
    d = json.loads(raw)
    p = d["properties"]
    sms = p.get("products", {}).get("shakemap") or []
    if not sms:
        return None
    sm = sms[0]
    c = sm["contents"]
    key = "download/grid.xml.zip" if "download/grid.xml.zip" in c else "download/grid.xml"
    if key not in c:
        return None
    s, graw = get(c[key]["url"], 180)
    if s != 200:
        log("grid fail", eid, s)
        return None
    save(f"grids/{label}_{eid}.xml.gz", gzip.compress(graw) if graw[:2] != b"PK" else graw)
    if "download/cont_mmi.json" in c and label.startswith(("v_", "r_us7", "r_us6")):
        s2, craw = get(c["download/cont_mmi.json"]["url"], 60)
        if s2 == 200:
            save(f"contours/{label}_{eid}.json", craw)
    info = {"id": eid, "label": label, "place": p.get("place"), "mag": p.get("mag"), "time": p.get("time"),
            "maxmmi_event": p.get("mmi"), "alert": p.get("alert"), "shakemap_version": sm["properties"].get("version"),
            "shakemap_update": sm.get("updateTime"), "process_time": sm["properties"].get("process-timestamp"),
            "grid_key": key, "grid_bytes": len(graw)}
    return info, parse_grid(graw)


def join_event(info, g, rows_out):
    a = g[0]
    counts: dict[str, dict] = {}
    for sch in SCHOOLS:
        lat, lon = sch[5], sch[6]
        if lat is None or lon is None or not (a["lat_min"] <= lat <= a["lat_max"]):
            continue
        m = mmi_at(g, lat, lon)
        if m is None or m < 3.5:
            continue
        b = band(m)
        c = counts.setdefault(sch[0], {})
        e = c.setdefault(b, [0, 0, 0])
        e[0] += 1
        if sch[7] is not None:
            e[1] += int(sch[7])
            e[2] += 1
        if m >= 4.5:
            rows_out.append([info["id"], info["label"], sch[0], sch[1], sch[2], sch[3], sch[4], round(lat, 5),
                             round(lon, 5), "" if sch[7] is None else int(sch[7]), round(m, 2), b])
    info["schools_by_country_band"] = counts
    info["grid_bbox"] = [a["lon_min"], a["lat_min"], a["lon_max"], a["lat_max"]]


def run_shakemaps():
    events, rows = [], []
    s, raw = fetch("usgs/list_4w.geojson", "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson"
                   "&starttime=2026-10-20&endtime=2026-11-18&producttype=shakemap&orderby=time")
    recent = json.loads(raw)["features"] if s == 200 else []
    log("recent shakemap events", len(recent))
    todo = [(f["id"], "r_" + f["id"]) for f in recent if (f["properties"].get("mmi") or 0) >= 3.5]
    for lab, st, en, mag, lat, lon, rad in VALID:
        s, raw = get("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson"
                     f"&starttime={st}&endtime={en}T23:59:59&minmagnitude={mag}&latitude={lat}&longitude={lon}"
                     f"&maxradiuskm={rad}&orderby=magnitude&limit=3", 60)
        if s == 200 and json.loads(raw)["features"]:
            todo.append((json.loads(raw)["features"][0]["id"], "v_" + lab))
        else:
            log("validation event not found", lab, s)
    t = time.time()
    for eid, label in todo:
        try:
            r = shakemap_for(eid, label)
            if not r:
                log("no shakemap grid", eid, label)
                continue
            info, g = r
            join_event(info, g, rows)
            events.append(info)
            log("joined", label, info["place"], json.dumps(info["schools_by_country_band"]))
        except Exception as e:  # noqa: BLE001
            log("event fail", eid, label, type(e).__name__, e)
    (OUT / "shake_events.json").write_text(json.dumps(events, indent=1), encoding="utf-8")
    with open(OUT / "shake_schools.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["event", "label", "country", "school_id", "name", "admin1", "admin2", "lat", "lon", "enrol", "mmi", "band"])
        w.writerows(rows)
    log("shakemap stage seconds", round(time.time() - t, 1), "events", len(events), "rows", len(rows))


# ---------------------------------------------------------------- gdacs
def run_gdacs():
    base = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
    weeks = [("2026-10-20", "2026-10-26"), ("2026-10-27", "2026-11-02"), ("2026-11-03", "2026-11-09"), ("2026-11-10", "2026-11-17")]
    tcs = {}
    for typ in ("EQ", "TC", "FL", "VO", "DR", "WF"):
        for a, b in weeks:
            s, raw = fetch(f"gdacs/{typ}_{a}.json", f"{base}?eventlist={typ}&fromdate={a}&todate={b}&alertlevel=red;orange;green", 60)
            if s == 200 and typ == "TC":
                try:
                    for ft in json.loads(raw).get("features", []):
                        tcs[ft["properties"]["eventid"]] = ft["properties"]
                except Exception:  # noqa: BLE001
                    pass
    fetch("gdacs/WF_page2.json", f"{base}?eventlist=WF&fromdate=2026-11-10&todate=2026-11-17&alertlevel=green&pagenumber=2", 60)
    hist = [("ian2022", "2022-09-22", "2022-10-02"), ("helene2024", "2024-09-23", "2024-09-29"),
            ("hagibis2019", "2019-10-05", "2019-10-13"), ("maria2017", "2017-09-16", "2017-09-22"),
            ("michael2018", "2018-10-06", "2018-10-12"), ("milton2024", "2024-10-05", "2024-10-11"),
            ("laura2020", "2020-08-20", "2020-08-28"), ("ida2021", "2021-08-26", "2021-09-02")]
    for lab, a, b in hist:
        s, raw = fetch(f"gdacs/hist_{lab}.json", f"{base}?eventlist=TC&fromdate={a}&todate={b}&alertlevel=red;orange", 60)
        try:
            for ft in json.loads(raw).get("features", []):
                p = ft["properties"]
                p["_hist"] = lab
                tcs[p["eventid"]] = p
        except Exception:  # noqa: BLE001
            pass
    idx = []
    for eid, p in list(tcs.items())[:40]:
        s, raw = fetch(f"gdacs/geom_TC_{eid}.json", p["url"]["geometry"], 120)
        s2, raw2 = fetch(f"gdacs/data_TC_{eid}.json", p["url"]["details"], 60)
        idx.append({"eventid": eid, "name": p.get("name"), "alert": p.get("alertlevel"), "from": p.get("fromdate"),
                    "to": p.get("todate"), "modified": p.get("datemodified"), "hist": p.get("_hist"),
                    "countries": [c.get("iso3") for c in p.get("affectedcountries", [])], "geom_status": s, "geom_bytes": len(raw)})
    (OUT / "gdacs_tc_index.json").write_text(json.dumps(idx, indent=1), encoding="utf-8")


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    for fn in (reg_nces, reg_chile, reg_japan):
        try:
            t = time.time()
            fn()
            log(fn.__name__, "done in", round(time.time() - t, 1), "s")
        except Exception as e:  # noqa: BLE001
            log(fn.__name__, "FAILED", type(e).__name__, e)
    with gzip.open(OUT / "schools.csv.gz", "wt", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["country", "id", "name", "admin1", "admin2", "lat", "lon", "enrol"])
        w.writerows(SCHOOLS)
    (OUT / "registers.json").write_text(json.dumps(REG_INFO, indent=1, ensure_ascii=False), encoding="utf-8")
    for fn in (run_shakemaps, run_gdacs, reg_discovery):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            log(fn.__name__, "FAILED", type(e).__name__, e)
        (OUT / "results.json").write_text(json.dumps(RESULTS, indent=1), encoding="utf-8")
        (OUT / "requests_by_host.json").write_text(json.dumps(COUNTS, indent=1), encoding="utf-8")
        (OUT / "log.txt").write_text("\n".join(LOG), encoding="utf-8")
    import shutil
    shutil.rmtree(OUT / "tmp_cl", ignore_errors=True)


if __name__ == "__main__":
    main()
