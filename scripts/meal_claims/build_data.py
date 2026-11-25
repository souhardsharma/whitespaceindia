"""Rebuild every published file from the store.

Reads the SQLite store the nightly run keeps and writes
`public/data/instruments/meal-claims/`. Nothing here asks the host anything.

The files are written to a candidate folder first; `check_published.py` runs
over the candidate, and only a candidate that passes is swapped in. A build
that fails leaves what is served exactly as it was.

    python scripts/meal_claims/build_data.py --store <dir>/store.sqlite
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_published as CP  # noqa: E402
import flags as FL  # noqa: E402
import measures as ME  # noqa: E402
import reader as RD  # noqa: E402
import store as ST  # noqa: E402
import sync as SY  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
PUBLISHED = REPO / "public" / "data" / "instruments" / "meal-claims"

BUCKETS = 64            # school files per month: code modulo this
MONTHS_KEPT = 12        # months of school files kept; older flags stay in the CSVs
LIST_DAYS = 120         # a district page lists schools flagged within this long
RECENT_NIGHTS = 14      # nights the "latest" page covers
RECENT_ROWS = 4000
STATE_SERIES_DAYS = 35

CSV_COLUMNS = ["state", "district", "block", "cluster", "school_code", "shift", "school_name",
               "date", "flag", "meals_reported", "enrolment_filed", "usual_daily_count",
               "closed_day_rule", "first_seen", "still_stands", "meals_as_last_read"]


def tidy(name: str) -> str:
    """ANUPPUR -> Anuppur. Area names only; a school's name is left as filed."""
    if not name.isupper():
        return name.strip()
    out = re.sub(r"[A-Za-z]+", lambda m: m.group(0).capitalize(), name.strip())
    return re.sub(r"\b(And|Of)\b", lambda m: m.group(0).lower(), out)


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("&", "and")).strip("-")


def school_key(code: str, shift: str) -> str:
    return f"{code}-{shift}"


def bucket_of(code: str) -> str:
    return f"{int(code) % BUCKETS:02d}"


def calibration() -> dict:
    """The one-off measurement the thresholds were checked against, as committed."""
    return json.loads((Path(__file__).resolve().parent / "calibration.json").read_text(encoding="utf-8"))


def pct(part: int | None, whole: int | None) -> float | None:
    return None if part is None or not whole else round(part / whole * 100, 1)


def blank_ranges(db) -> list[list[str]]:
    """Stretches of read days on which no school in any State reported."""
    days = [r["day"] for r in db.execute(
        "select day from state_day group by day having sum(reported)=0 order by day")]
    out: list[list[str]] = []
    for day in days:
        if out and dt.date.fromisoformat(day) - dt.date.fromisoformat(out[-1][1]) == dt.timedelta(days=1):
            out[-1][1] = day
        else:
            out.append([day, day])
    return out


def flag_rows(db) -> list[dict]:
    """Every flag with the school and the places it sits in."""
    rows = []
    for r in db.execute(
            "select f.*, s.name, s.dc, s.bc, s.cc, d.name district, b.name block, c.name cluster "
            "from flag f join school s on s.st=f.st and s.code=f.code and s.shift=f.shift "
            "left join district d on d.st=s.st and d.dc=s.dc "
            "left join block b on b.st=s.st and b.bc=s.bc "
            "left join cluster c on c.st=s.st and c.cc=s.cc order by f.day, f.st, f.code"):
        row = {"st": r["st"], "code": r["code"], "shift": r["shift"], "name": r["name"],
               "dc": r["dc"], "bc": r["bc"], "cc": r["cc"],
               "district": tidy(r["district"] or ""), "block": tidy(r["block"] or ""),
               "cluster": tidy(r["cluster"] or ""),
               "day": r["day"], "kind": r["kind"], "first": r["first_stamp"],
               "standing": bool(r["standing"]), **json.loads(r["basis"])}
        rows.append(row)
    return rows


def public_flag(row: dict) -> dict:
    """A flag as a school's page shows it: the day, the kind, the figures."""
    keep = ("day", "kind", "meals", "enrolled", "excess", "wide", "usual", "days_compared",
            "rule", "same_served", "same_days", "other_served", "other_days", "reason", "now")
    out = {k: row[k] for k in keep if k in row}
    out["first"] = row["first"][:10]
    out["standing"] = row["standing"]
    return out


def tally(rows: list[dict]) -> dict:
    standing = [r for r in rows if r["standing"]]
    return {
        "flag_over": sum(1 for r in standing if r["kind"] == "over"),
        "flag_over_wide": sum(1 for r in standing if r["kind"] == "over" and r.get("wide")),
        "flag_closed": sum(1 for r in standing if r["kind"] == "closed"),
        "flag_spike": sum(1 for r in standing if r["kind"] == "spike"),
        "schools_flagged": len({(r["st"], r["code"], r["shift"]) for r in standing}),
    }


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
                    encoding="utf-8")


def build(db, out: Path, generated_at: str) -> dict:
    """Write every published file into `out`. Returns meta."""
    latest = db.execute("select max(day) from state_day").fetchone()[0]
    if latest is None:
        raise RuntimeError("the store holds no all-States table yet; nothing to publish")
    latest_day = dt.date.fromisoformat(latest)
    first = db.execute("select min(day) from state_day").fetchone()[0]
    nights = SY.nights(db)
    flags = flag_rows(db)
    by_state: dict[str, list[dict]] = {}
    for f in flags:
        by_state.setdefault(f["st"], []).append(f)

    tables = {r["st"]: dict(r) for r in db.execute(
        "select st, count(*) tables_read, sum(tested) school_days_tested, sum(over) over_in_tables "
        "from cluster_read group by st")}   # every table has its cluster row (sync.school_table)
    counts_known = {r["st"]: dict(r) for r in db.execute(
        "select st, (select count(*) from block b where b.st=d.st) blocks, "
        "(select count(*) from cluster c where c.st=d.st) clusters, count(*) districts "
        "from district d group by st")}

    states = []
    for st, (name, _) in RD.STATES.items():
        day_row = db.execute("select * from state_day where st=? order by day desc limit 1", (st,)).fetchone()
        dsum = db.execute(
            "select day, sum(schools) schools, sum(enr_filed) enr_filed, sum(enrolled) enrolled, "
            "sum(reported) reported, sum(meals) meals from district_day where st=? and day="
            "(select max(day) from district_day where st=?)", (st, st)).fetchone()
        if day_row is None and (dsum is None or dsum["day"] is None):
            continue
        series = [[r["day"], r["schools"], r["reported"], r["meals"]] for r in db.execute(
            "select day, schools, reported, meals from state_day where st=? order by day", (st,))]
        hol = db.execute("select read_at from holiday_read where st=?", (st,)).fetchone()
        known = counts_known.get(st, {})
        # Rajasthan is not in the all-States table: its figures are the sum
        # of its district table, and `from_districts` says so.
        base = day_row or dsum
        row = {
            "st": st, "name": name, "slug": slug(name),
            "day": base["day"], "schools": base["schools"], "reported": base["reported"],
            "meals": base["meals"], "from_districts": day_row is None,
            "enr_day": dsum["day"] if dsum else None,
            "enr_filed": dsum["enr_filed"] if dsum else None,
            "enr_schools": dsum["schools"] if dsum else None,
            "enrolled": dsum["enrolled"] if dsum else None,
            "districts": known.get("districts", 0), "blocks": known.get("blocks", 0),
            "clusters": known.get("clusters", 0),
            "tables_read": tables.get(st, {}).get("tables_read", 0),
            "school_days_tested": tables.get(st, {}).get("school_days_tested") or 0,
            "over_in_tables": tables.get(st, {}).get("over_in_tables") or 0,
            **tally(by_state.get(st, [])),
            "holidays_listed": db.execute("select count(distinct day) from holiday where st=?",
                                          (st,)).fetchone()[0],
            "holidays_read_at": hol["read_at"] if hol else None,
            "series": series[-STATE_SERIES_DAYS:],
        }
        states.append(row)
        write_state(db, out, row, series, by_state.get(st, []), latest_day)

    months = sorted({f["day"][:7] for f in flags})
    write_schools(db, out, flags, months[-MONTHS_KEPT:])
    for month in months:
        write_csv(out / "flags" / f"{month}.csv", [f for f in flags if f["day"][:7] == month])
    write_recent(out, flags, nights)

    holidays = {}
    for st in RD.STATES:
        hol = db.execute("select read_at from holiday_read where st=?", (st,)).fetchone()
        if hol:
            holidays[st] = {"read_at": hol["read_at"], "days": [
                {"date": r["day"], "reason": r["reason"]} for r in db.execute(
                    "select day, reason from holiday where st=? order by day, reason", (st,))]}
    write_json(out / "holidays.json", holidays)
    write_json(out / "measures.json", ME.MEASURES)

    last_night = nights[-1] if nights else None
    meta = {
        "instrument": "meal-claims",
        "generated_at": generated_at,
        "day": latest,
        "span": {"first_day": first, "last_day": latest,
                 "days_read": db.execute("select count(distinct day) from state_day").fetchone()[0]},
        "first_night": nights[0]["stamp"] if nights else None,
        "nights": len(nights),
        "thresholds": FL.THRESHOLDS,
        "calibration": calibration(),
        "buckets": BUCKETS,
        "months": months[-MONTHS_KEPT:],
        "csv_months": months,
        "list_days": LIST_DAYS,
        "blank_ranges": blank_ranges(db),
        "counts": {
            "states": len(states),
            "schools": sum(s["schools"] or 0 for s in states),
            "districts": sum(s["districts"] for s in states),
            "blocks": sum(s["blocks"] for s in states),
            "clusters": sum(s["clusters"] for s in states),
            "tables_read": sum(s["tables_read"] for s in states),
            "school_days_tested": sum(s["school_days_tested"] for s in states),
            "over_in_tables": sum(s["over_in_tables"] for s in states),
            **tally(flags),
            "flags_no_longer_standing": sum(1 for f in flags if not f["standing"]),
        },
    }
    write_json(out / "meta.json", meta)
    write_json(out / "states.json", {"day": latest, "states": states})
    notes = json.loads(last_night["notes"]) if last_night else {}
    write_json(out / "freshness.json", {
        "checked_at": last_night["stamp"] if last_night else None,
        "day": last_night["day"] if last_night else latest,
        "outcome": last_night["outcome"] if last_night else None,
        "complete": bool(last_night and last_night["outcome"] == "complete"),
        "district_tables": notes.get("district_tables"),
        "budget": last_night["budget"] if last_night else None,
        "sent": last_night["sent"] if last_night else None,
        "failed": last_night["failed"] if last_night else None,
        "median_s": last_night["median_s"] if last_night else None,
        # Counted, not taken from the night's notes: a night that ends
        # before its detail pass writes no note, and owes the most.
        "detail_owed": db.execute("select count(*) from owed").fetchone()[0],
        "next_budget": SY.next_budget(nights),
    })
    return meta


def write_state(db, out: Path, state: dict, series: list, flags: list[dict], latest: dt.date) -> None:
    st = state["st"]
    since = ST.iso(latest - dt.timedelta(days=LIST_DAYS))
    by_district: dict[str, list[dict]] = {}
    for f in flags:
        by_district.setdefault(f["dc"], []).append(f)
    tables = {r["dc"]: dict(r) for r in db.execute(
        "select c.dc, count(*) tables_read, sum(r.tested) school_days_tested, sum(r.over) over_in_tables "
        "from cluster_read r join cluster c on c.st=r.st and c.cc=r.cc where r.st=? group by c.dc", (st,))}
    districts = []
    for d in db.execute("select * from district where st=? order by name", (st,)):
        day = db.execute("select * from district_day where st=? and dc=? order by day desc limit 1",
                         (st, d["dc"])).fetchone()
        recent = [[r["day"], r["schools"], r["reported"], r["meals"]] for r in db.execute(
            "select day, schools, reported, meals from district_day where st=? and dc=? "
            "order by day desc limit 14", (st, d["dc"]))][::-1]
        blocks = [{"bc": b["bc"], "name": tidy(b["name"]), "schools": b["schools"],
                   "enr_filed": b["enr_filed"], "enrolled": b["enrolled"],
                   "reported": b["reported"], "meals": b["meals"], "day": b["day"]}
                  for b in db.execute("select * from block where st=? and dc=? order by name", (st, d["dc"]))]
        mine = by_district.get(d["dc"], [])
        schools: dict[str, dict] = {}
        for f in mine:
            if not f["standing"] or f["day"] < since:
                continue
            s = schools.setdefault(school_key(f["code"], f["shift"]), {
                "k": school_key(f["code"], f["shift"]), "name": f["name"], "block": f["block"],
                "over": 0, "wide": 0, "closed": 0, "spike": 0, "last": None})
            s[f["kind"]] += 1
            s["wide"] += 1 if f.get("wide") else 0
            s["last"] = public_flag(f)   # rows arrive in day order, so the last is the latest
        districts.append({
            "dc": d["dc"], "name": tidy(d["name"]),
            "day": day["day"] if day else None,
            "schools": day["schools"] if day else None, "enr_filed": day["enr_filed"] if day else None,
            "enrolled": day["enrolled"] if day else None, "reported": day["reported"] if day else None,
            "meals": day["meals"] if day else None,
            "series": recent, "blocks": blocks,
            "tables_read": tables.get(d["dc"], {}).get("tables_read", 0),
            "school_days_tested": tables.get(d["dc"], {}).get("school_days_tested") or 0,
            "over_in_tables": tables.get(d["dc"], {}).get("over_in_tables") or 0,
            **tally(mine),
            "flagged": sorted(schools.values(), key=lambda s: (-(s["closed"] + s["spike"]), -s["wide"], s["name"])),
        })
    closed = [dict(r) for r in db.execute(
        "select day, reported, meals, schools_found from closed_day where st=? order by day desc limit 30", (st,))]
    write_json(out / "state" / f"{st}.json", {
        "st": st, "name": state["name"], "slug": state["slug"], "series": series,
        "districts": districts, "closed_days": closed})


def write_schools(db, out: Path, flags: list[dict], months: list[str]) -> None:
    """One file per month and bucket: each flagged school's month as read."""
    files: dict[tuple[str, str], dict] = {}
    for f in flags:
        month = f["day"][:7]
        if month not in months:
            continue
        key = school_key(f["code"], f["shift"])
        school = files.setdefault((month, bucket_of(f["code"])), {}).get(key)
        if school is None:
            year, mon = int(month[:4]), int(month[5:])
            held = db.execute("select meals, read_at from school_month where st=? and code=? and shift=? "
                              "and year=? and month=?", (f["st"], f["code"], f["shift"], year, mon)).fetchone()
            enrol = db.execute("select months, read_at from school_enrol where st=? and code=? and shift=? "
                               "and year=?", (f["st"], f["code"], f["shift"], year)).fetchone()
            school = files[(month, bucket_of(f["code"]))][key] = {
                "st": f["st"], "code": f["code"], "shift": f["shift"], "name": f["name"],
                "dc": f["dc"], "district": f["district"], "block": f["block"], "cluster": f["cluster"],
                "meals": json.loads(held["meals"]) if held else None,
                "meals_read_at": held["read_at"] if held else None,
                "enrolment": json.loads(enrol["months"]) if enrol else None,
                "enrolment_read_at": enrol["read_at"] if enrol else None,
                "flags": []}
        school["flags"].append(public_flag(f))
    for (month, bucket), schools in files.items():
        write_json(out / "schools" / month / f"{bucket}.json", schools)


def write_csv(path: Path, rows: list[dict]) -> None:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(CSV_COLUMNS)
    for f in rows:
        w.writerow([RD.STATES[f["st"]][0], f["district"], f["block"], f["cluster"], f["code"], f["shift"],
                    f["name"], f["day"], f["kind"], f["meals"], f.get("enrolled", ""), f.get("usual", ""),
                    f.get("rule", ""), f["first"][:10], "yes" if f["standing"] else "no",
                    f.get("now", "")])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(buf.getvalue(), encoding="utf-8")


def write_recent(out: Path, flags: list[dict], nights: list[dict]) -> None:
    """Flags first seen in the last nights, the stronger ones first when the
    list has to be cut; `total` always says how many there were."""
    stamps = [n["stamp"] for n in nights][-RECENT_NIGHTS:]
    fresh = [f for f in flags if f["standing"] and f["first"] in stamps]
    fresh.sort(key=lambda f: (f["kind"] == "over" and not f.get("wide"), -stamps.index(f["first"]),
                              -(f.get("excess") or f["meals"])))
    rows = [{"seen": stamps.index(f["first"]), "st": f["st"], "dc": f["dc"], "district": f["district"],
             "k": school_key(f["code"], f["shift"]), "name": f["name"], **public_flag(f)}
            for f in fresh[:RECENT_ROWS]]
    write_json(out / "flags" / "recent.json", {"stamps": stamps, "total": len(fresh), "rows": rows})


def promote(candidate: Path, published: Path) -> None:
    """Swap a checked candidate in for what is served."""
    outgoing = published.with_name(published.name + ".outgoing")
    if outgoing.exists():
        shutil.rmtree(outgoing)
    published.parent.mkdir(parents=True, exist_ok=True)
    if published.exists():
        published.rename(outgoing)
    candidate.rename(published)
    if outgoing.exists():
        shutil.rmtree(outgoing)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--store", required=True, type=Path)
    ap.add_argument("--out", type=Path, default=PUBLISHED)
    args = ap.parse_args()

    db = ST.connect(args.store)
    candidate = args.out.with_name(args.out.name + ".candidate")
    if candidate.exists():
        shutil.rmtree(candidate)
    meta = build(db, candidate, SY.now_utc())
    db.close()
    failures = CP.check(candidate)
    if failures:
        print(f"{len(failures)} contract failures; nothing published:")
        for line in failures[:40]:
            print("  " + line)
        return 1
    promote(candidate, args.out)
    c = meta["counts"]
    print(f"published {args.out}: day {meta['day']}, {c['schools']} schools, "
          f"{c['tables_read']} school tables, {c['flag_over']} over / {c['flag_closed']} closed / "
          f"{c['flag_spike']} spike")
    return 0


if __name__ == "__main__":
    sys.exit(main())
