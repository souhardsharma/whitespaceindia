"""The contract between the published files and the pages that read them.

Run over a candidate build before it is swapped in, and over the committed
files in CI. Every assertion is written to FAIL on a specific wrong build:
a flag whose own figures do not support it, a count that disagrees with the
rows under it, a threshold a page would quote that the tests did not use, a
phone number in a school's name, a word that turns a flag into a verdict.

    python scripts/meal_claims/check_published.py [folder]
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ams as AMS  # noqa: E402
import flags as FL  # noqa: E402
import measures as ME  # noqa: E402
import udise as UD  # noqa: E402
import reader as RD  # noqa: E402
import sync as SY  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
PUBLISHED = REPO / "public" / "data" / "instruments" / "meal-claims"

KINDS = {"over", "closed", "spike"}
# A flag is a contradiction in a school's own filings. These words say more
# than the data can, and none may reach a published file.
VERDICT_WORDS = re.compile(r"\b(fraud|fraudulent|scam|fake|ghost|corrupt|corruption|embezzl\w*|siphon\w*|theft)\b", re.I)
SIZE_LIMIT = 20 * 1024 * 1024   # Pages refuses a file over 25 MiB


class Checker:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.oddities: list[str] = []
        self.passed = 0

    def ok(self, cond: bool, what: str) -> bool:
        if cond:
            self.passed += 1
        else:
            self.failures.append(what)
        return bool(cond)

    def source(self, cond: bool, what: str) -> None:
        """A figure the host itself gave that does not add up. Published as
        the host has it and reported, never a reason to stop the night: the
        instrument cannot make the source consistent by refusing to read it."""
        if not cond:
            self.oddities.append(what)


def load(folder: Path, name: str):
    return json.loads((folder / name).read_text(encoding="utf-8"))


def strings(value):
    """Every string in a JSON value, keys excluded."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings(v)


def contact_in(text: str) -> bool:
    """A phone number or e-mail in a text cell. Codes are never passed here."""
    return bool(RD.EMAIL.search(text) or RD.PHONE.search(text))


def flag_supported(c: Checker, f: dict, where: str) -> None:
    """A standing flag's own figures must satisfy the rule that raised it."""
    t = FL.THRESHOLDS
    c.ok(f.get("kind") in KINDS, f"{where}: unknown kind {f.get('kind')!r}")
    c.ok(isinstance(f.get("meals"), int) and f["meals"] > 0, f"{where}: a flag with no meals")
    if not f.get("standing"):
        c.ok("now" in f, f"{where}: a flag that no longer stands must say what the figure is now")
        return
    if f["kind"] == "over":
        good = isinstance(f.get("enrolled"), int) and 0 < f["enrolled"] < f["meals"]
        c.ok(good, f"{where}: over flag with meals {f.get('meals')} and enrolment {f.get('enrolled')}")
        if good:
            c.ok(f.get("excess") == f["meals"] - f["enrolled"], f"{where}: excess does not close")
            wide = (f["meals"] >= f["enrolled"] * t["over_wide_ratio"]
                    and f["excess"] >= t["over_wide_min_excess"])
            c.ok(f.get("wide") is wide, f"{where}: wide is {f.get('wide')}, the figures say {wide}")
    elif f["kind"] == "spike":
        usual = f.get("usual")
        c.ok(isinstance(usual, int) and usual > 0 and f["meals"] >= usual * t["spike_ratio"] - 2
             and f.get("days_compared", 0) >= t["spike_min_other_days"],
             f"{where}: spike of {f.get('meals')} against a usual {usual}")
    elif f["kind"] == "closed":
        if f.get("rule") == "weekday":
            same, days = f.get("same_served"), f.get("same_days")
            c.ok(isinstance(days, int) and days >= t["offday_min_same_weekdays"]
                 and same / days <= t["offday_max_served_share"],
                 f"{where}: weekday rule on {same} of {days} same weekdays served")
            c.ok(f.get("other_days") and f["other_served"] / f["other_days"] >= t["offday_min_other_weekday_rate"],
                 f"{where}: weekday rule on a school that rarely serves")
        else:
            c.ok(f.get("rule") == "holiday" and "reason" in f, f"{where}: closed flag with no rule it rests on")


def check_history(c: Checker, folder: Path, st: str, years: list[int], last_day: str) -> dict[str, list]:
    """The State's yearly district files. Returns each district's latest row."""
    latest: dict[str, list] = {}
    found = sorted(int(p.stem) for p in (folder / "history" / st).glob("*.json")) \
        if (folder / "history" / st).is_dir() else []
    c.ok(found == years, f"state {st}: history files {found}, the State lists {years}")
    for year in found:
        doc = load(folder, f"history/{st}/{year}.json")
        c.ok(doc["st"] == st and doc["year"] == year, f"history/{st}/{year}.json names another State or year")
        for dc, rows in doc["districts"].items():
            where = f"history {st}-{dc} {year}"
            days = [r[0] for r in rows]
            c.ok(days == sorted(set(days)), f"{where}: days repeat or are out of order")
            c.ok(all(d[:4] == str(year) and d <= last_day for d in days), f"{where}: a day outside its year or after the last read")
            for day, schools, filed, _enrolled, reported, meals in rows:
                c.source(0 <= reported <= schools, f"{where} {day}: {reported} reported of {schools}")
                c.ok(meals >= 0 and (filed is None or filed >= 0), f"{where} {day}: a negative count")
            latest[dc] = rows[-1]
    return latest


def check_roster(c: Checker, folder: Path, st: str, d: dict, where: str) -> None:
    """A district's schools as read: the counts on its page are counts of this file."""
    path = folder / "roster" / f"{st}-{d['dc']}.json"
    c.ok(d["clusters_read"] <= d["clusters"], f"{where}: more clusters read than known")
    if not d["schools_read"]:
        c.ok(not path.exists() and not d["clusters_read"], f"{where}: a roster with no school in it")
        return
    if not c.ok(path.is_file(), f"{where}: roster file is missing"):
        return
    doc = json.loads(path.read_text(encoding="utf-8"))
    c.ok(len(doc["schools"]) == d["schools_read"], f"{where}: roster holds {len(doc['schools'])} schools, the page says {d['schools_read']}")
    c.ok(len(doc["clusters"]) == d["clusters_read"], f"{where}: roster clusters disagree with the count")
    keys = [s[0] for s in doc["schools"]]
    c.ok(len(keys) == len(set(keys)), f"{where}: a school is listed twice")
    for key, name, cc, enrolled, meals in doc["schools"]:
        c.ok(cc in doc["clusters"], f"{where}: school {key} in a cluster the file does not describe")
        c.ok(not contact_in(name), f"{where}: contact detail in a school name")
        c.ok((enrolled is None or enrolled >= 0) and (meals is None or meals >= 0), f"{where}: school {key} has a negative count")


def check_udise(c: Checker, held: dict | None, meta: dict, where: str) -> None:
    """A school's UDISE+ entry carries the kept fields and nothing else."""
    if held is None:
        return
    c.ok(set(held) == {"read_at", "record"}, f"{where}: UDISE+ entry has keys {sorted(held)}")
    c.ok(held["read_at"] <= meta["generated_at"], f"{where}: UDISE+ read after the build")
    record = held["record"]
    if record is None:
        return
    c.ok(tuple(sorted(record)) == tuple(sorted(UD.FIELDS)), f"{where}: UDISE+ record has fields {sorted(record)}")
    for name, value in record.items():
        if name in UD.NUMBERS:
            c.ok(value is None or (isinstance(value, int) and (value >= 0 or name in UD.CLASSES)), f"{where}: UDISE+ {name} is {value!r}")
        else:
            c.ok(value is None or (isinstance(value, str) and not contact_in(value)),
                 f"{where}: UDISE+ {name} is not plain text")
    low, high = record["low_class"], record["high_class"]
    if low is not None and high is not None:
        c.ok(low <= high <= 12, f"{where}: UDISE+ classes {low} to {high}")


def check_national(c: Checker, folder: Path, states: dict) -> None:
    """The national system's files: every State once, sums that close, and
    the comparison drawn from the two files it claims to compare."""
    c.ok((folder / "national.json").is_file(), "national.json is missing")
    if not (folder / "national.json").is_file():
        return
    nat = load(folder, "national.json")
    c.ok(nat["read"] == bool(nat["states"]), "national.read disagrees with its rows")
    if not nat["read"]:
        return
    names = [s["name"] for s in nat["states"]]
    c.ok(AMS.MIN_STATES <= len(names) <= 40, f"national.json lists {len(names)} States")
    c.ok(len(set(names)) == len(names) and len({s["slug"] for s in nat["states"]}) == len(names),
         "a State appears twice in national.json")
    c.ok(nat["first_day"] <= nat["day"] and nat["series"][-1][0] == nat["day"], "national.json dates are out of order")
    for column, key in ((1, "schools"), (2, "reported"), (3, "meals")):
        c.ok(nat["series"][-1][column] == sum(s[key] or 0 for s in nat["states"]),
             f"the all-India {key} for {nat['day']} is not the sum of the States")
    held = {s["st"]: s for s in states["states"]}
    codes = [s["st"] for s in nat["states"] if s["st"]]
    c.ok(len(set(codes)) == len(codes), "two national rows claim one State on the meal system")
    for s in nat["states"]:
        where = f"national {s['name']}"
        c.ok(s["st"] is None or s["st"] in RD.STATES, f"{where}: unknown State code {s['st']}")
        c.ok(not contact_in(s["name"]), f"{where}: contact detail in a name")
        for key in ("schools", "reported", "holiday", "enrolled", "approved", "rep_enrolled", "meals"):
            c.ok(s[key] is None or (isinstance(s[key], int) and s[key] >= 0), f"{where}: {key} is {s[key]!r}")
        c.ok(s["series"] and s["series"][-1][0] <= nat["day"], f"{where}: series runs past the day read")
        c.ok(bool(s["districts"]) == bool(s["district_day"]), f"{where}: district rows without their date")
        if s["schools"] is not None and s["reported"] is not None and s["reported"] > s["schools"]:
            c.source(False, f"{where}: {s['reported']} schools reported of {s['schools']} listed")
        if s["districts"] and s["district_day"] == nat["day"]:
            for key in ("schools", "reported", "meals"):
                total = sum(d[key] or 0 for d in s["districts"])
                if total != (s[key] or 0):
                    c.source(False, f"{where}: districts sum to {total} {key}, the State row says {s[key]}")
        for d in s["districts"]:
            c.ok(not contact_in(d["name"]), f"{where}: contact detail in district {d['name']}")
    for row in nat["compare"]:
        mine = held.get(row["st"])
        c.ok(mine is not None, f"comparison for {row['st']}, which is not in states.json")
        if mine:
            day = next((r for r in mine["series"] if r[0] == row["day"]), None)
            c.ok(day is not None and day[1:] == row["here"],
                 f"comparison {row['name']}: the meal system's side is not what states.json holds")
        theirs = next((s for s in nat["states"] if s["st"] == row["st"]), None)
        c.ok(theirs is not None and [theirs["schools"], theirs["reported"], theirs["meals"]] == row["national"],
             f"comparison {row['name']}: the national side is not the State's own row")
    c.ok((folder / "national" / "states.csv").is_file(), "national/states.csv is missing")
    for month in nat["district_months"]:
        path = folder / "national" / f"districts-{month}.csv"
        c.ok(path.is_file() and path.stat().st_size < 20 * 2**20, f"national/districts-{month}.csv is missing or too large")


def check(folder: Path) -> list[str]:
    c = Checker()
    needed = ["meta.json", "states.json", "freshness.json", "measures.json", "holidays.json",
              "flags/recent.json"]
    for name in needed:
        c.ok((folder / name).is_file(), f"{name} is missing")
    if c.failures:
        return c.failures
    meta, states = load(folder, "meta.json"), load(folder, "states.json")
    fresh, recent = load(folder, "freshness.json"), load(folder, "flags/recent.json")

    # -- the registry and the thresholds are the code's own
    c.ok(load(folder, "measures.json") == ME.MEASURES, "measures.json differs from measures.py")
    c.ok(meta["thresholds"] == FL.THRESHOLDS, "meta.thresholds differs from flags.THRESHOLDS")
    c.ok(meta.get("budget_cap") == SY.BUDGET_CAP, "meta.budget_cap is not the nightly run's ceiling")
    c.ok(meta.get("budget_step") == SY.BUDGET_STEP, "meta.budget_step is not the nightly run's step")
    c.ok(meta.get("calibration") == load(Path(__file__).resolve().parent, "calibration.json"), "meta.calibration differs from calibration.json")
    for key in ("flag_over", "flag_over_wide", "flag_closed", "flag_spike", "schools_flagged",
                "tables_read", "school_days_tested", "schools", "clusters_read", "schools_read",
                "udise_asked", "udise_found"):
        c.ok(isinstance(meta["counts"].get(key), int), f"meta.counts.{key} is not a number")
        c.ok(key in ME.MEASURES, f"count {key} has no entry in the registry")

    # -- dates
    day = dt.date.fromisoformat(meta["day"])
    made = dt.datetime.fromisoformat(meta["generated_at"])
    c.ok(day <= made.date(), "meta.day is after the build")
    c.ok(meta["span"]["first_day"] <= meta["span"]["last_day"] == meta["day"], "meta.span does not end on meta.day")
    c.ok(states["day"] == meta["day"], "states.json and meta.json name different days")
    if fresh.get("checked_at"):
        c.ok(dt.datetime.fromisoformat(fresh["checked_at"]) <= made, "freshness is dated after the build")
    c.ok(isinstance(fresh.get("complete"), bool), "freshness.complete is not a yes or no")
    for a, b in meta["blank_ranges"]:
        c.ok(meta["span"]["first_day"] <= a <= b <= meta["day"], f"blank range {a}..{b} outside the span")

    # -- States, and the district files under them
    seen_slugs = set()
    totals = {k: 0 for k in ("flag_over", "flag_over_wide", "flag_closed", "flag_spike",
                             "tables_read", "school_days_tested", "over_in_tables")}
    listed_schools: dict[str, dict] = {}
    for s in states["states"]:
        st = s["st"]
        c.ok(st in RD.STATES and s["name"] == RD.STATES[st][0], f"state {st}: not a State on the host")
        c.ok(s["slug"] not in seen_slugs, f"state {st}: slug {s['slug']} used twice")
        seen_slugs.add(s["slug"])
        if s["schools"] is not None and s["reported"] is not None:
            c.source(0 <= s["reported"] <= s["schools"], f"state {st}: {s['reported']} reported of {s['schools']}")
        if s["enr_filed"] is not None:
            c.source(0 <= s["enr_filed"] <= s["enr_schools"], f"state {st}: more schools filed than listed")
        c.ok(s["over_in_tables"] <= s["school_days_tested"],
             f"state {st}: more over-enrolment rows than rows tested")
        c.ok(s["flag_over_wide"] <= s["flag_over"], f"state {st}: wide exceeds over")
        for k in totals:
            totals[k] += s[k]
        c.ok(all(row[0] <= meta["day"] for row in s["series"]), f"state {st}: series runs past meta.day")
        path = folder / "state" / f"{st}.json"
        if not c.ok(path.is_file(), f"state/{st}.json is missing"):
            continue
        detail = json.loads(path.read_text(encoding="utf-8"))
        c.ok(len(detail["districts"]) == s["districts"], f"state {st}: district count disagrees with its file")
        sub = {k: 0 for k in ("flag_over", "flag_over_wide", "flag_closed", "flag_spike", "tables_read",
                              "clusters_read", "schools_read")}
        history = check_history(c, folder, st, s["history_years"], meta["day"])
        codes = set()
        for d in detail["districts"]:
            where = f"district {st}-{d['dc']}"
            c.ok(d["dc"] not in codes, f"{where}: listed twice")
            codes.add(d["dc"])
            if d["schools"] is not None:
                c.source(0 <= d["reported"] <= d["schools"], f"{where}: {d['reported']} reported of {d['schools']}")
                c.source(0 <= d["enr_filed"] <= d["schools"], f"{where}: more filed than listed")
            for k in sub:
                sub[k] += d[k]
            check_roster(c, folder, st, d, where)
            if d["day"] is not None:
                c.ok(history.get(d["dc"]) == [d["day"], d["schools"], d["enr_filed"], d["enrolled"],
                                               d["reported"], d["meals"]],
                     f"{where}: its latest day is not the last row of its history")
            for b in d["blocks"]:
                c.source(b["reported"] <= b["schools"], f"{where} block {b['bc']}: reported exceeds schools")
            for school in d["flagged"]:
                c.ok(school["over"] + school["closed"] + school["spike"] > 0, f"{where}: {school['k']} listed with no flag")
                c.ok(school["last"] is not None and school["last"]["standing"],
                     f"{where}: {school['k']} listed on a flag that no longer stands")
                c.ok(not contact_in(school["name"]), f"{where}: contact detail in a school name")
                listed_schools[school["k"]] = school
        for k in sub:
            c.ok(sub[k] == s[k], f"state {st}: {k} is {s[k]} but its districts sum to {sub[k]}")
    for k, v in totals.items():
        c.ok(meta["counts"][k] == v, f"meta.counts.{k} is {meta['counts'][k]} but the States sum to {v}")
    for k in ("clusters_read", "schools_read"):
        c.ok(meta["counts"][k] == sum(s[k] for s in states["states"]),
             f"meta.counts.{k} is not the sum of the States")
    c.ok(meta["counts"]["clusters_read"] <= meta["counts"]["clusters"], "more clusters read than are known")
    hist = meta["history"]
    if hist["state_first_day"]:
        c.ok(meta["span"]["first_day"] <= hist["state_first_day"] <= meta["day"],
             "the first day with a report is outside the span read")
    rosters = {p.stem for p in (folder / "roster").glob("*.json")} if (folder / "roster").is_dir() else set()
    named = {f"{s['st']}-{d['dc']}" for s in states["states"]
             for d in load(folder, f"state/{s['st']}.json")["districts"] if d["schools_read"]}
    c.ok(rosters == named, f"roster files and districts with schools read differ: {sorted(rosters ^ named)[:5]}")

    # -- every flag, from the monthly CSVs (the complete list) and the school files
    csv_rows = []
    for month in meta["csv_months"]:
        path = folder / "flags" / f"{month}.csv"
        if not c.ok(path.is_file(), f"flags/{month}.csv is missing"):
            continue
        with path.open(encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
        c.ok(all(r["date"][:7] == month for r in rows), f"flags/{month}.csv holds another month's rows")
        csv_rows += rows
    standing = [r for r in csv_rows if r["still_stands"] == "yes"]
    c.ok(sum(1 for r in standing if r["flag"] == "over") == meta["counts"]["flag_over"],
         "the CSVs and meta disagree on over flags")
    c.ok(sum(1 for r in standing if r["flag"] == "closed") == meta["counts"]["flag_closed"],
         "the CSVs and meta disagree on closed-day flags")
    c.ok(sum(1 for r in standing if r["flag"] == "spike") == meta["counts"]["flag_spike"],
         "the CSVs and meta disagree on spikes")
    c.ok(len({(r["school_code"], r["shift"]) for r in standing}) == meta["counts"]["schools_flagged"],
         "the CSVs and meta disagree on schools flagged")
    c.ok(len(csv_rows) - len(standing) == meta["counts"]["flags_no_longer_standing"],
         "the CSVs and meta disagree on flags that no longer stand")
    for r in csv_rows:
        c.ok(r["date"] <= meta["day"], f"csv: flag dated {r['date']}, after the last day read")

    in_files = 0
    for month in meta["months"]:
        for path in sorted((folder / "schools" / month).glob("*.json")):
            schools = json.loads(path.read_text(encoding="utf-8"))
            for key, school in schools.items():
                where = f"schools/{month}/{path.name} {key}"
                c.ok(key == f"{school['code']}-{school['shift']}", f"{where}: key does not match its school")
                c.ok(f"{int(school['code']) % meta['buckets']:02d}" == path.stem, f"{where}: in the wrong bucket")
                c.ok(not contact_in(school["name"]), f"{where}: contact detail in a school name")
                if school["meals"] is not None:
                    c.ok(28 <= len(school["meals"]) <= 31, f"{where}: a month of {len(school['meals'])} days")
                if school["enrolment"] is not None:
                    c.ok(len(school["enrolment"]) == 12, f"{where}: enrolment history is not twelve months")
                c.ok(bool(school["flags"]), f"{where}: a school file entry with no flag")
                check_udise(c, school.get("udise"), meta, where)
                for f in school["flags"]:
                    in_files += 1
                    c.ok(f["day"][:7] == month, f"{where}: flag of {f['day']} filed under {month}")
                    flag_supported(c, f, f"{where} {f['day']}")
                    if f["standing"] and school["meals"] is not None and f["kind"] == "over":
                        held = school["meals"][int(f["day"][8:]) - 1]
                        c.ok(held > f["enrolled"], f"{where} {f['day']}: the month now shows {held}, not above {f['enrolled']}")
    kept = [r for r in csv_rows if r["date"][:7] in meta["months"]]
    c.ok(meta["counts"]["udise_found"] <= meta["counts"]["udise_asked"], "more schools found in UDISE+ than asked for")
    c.ok(in_files == len(kept), f"school files hold {in_files} flags, the CSVs {len(kept)} for the same months")

    # -- the latest list
    c.ok(recent["total"] >= len(recent["rows"]), "recent.json shows more rows than it says exist")
    for r in recent["rows"]:
        c.ok(0 <= r["seen"] < len(recent["stamps"]), "recent.json: a row seen in no listed night")
        c.ok(r["standing"], "recent.json lists a flag that no longer stands")
        flag_supported(c, r, f"recent {r['k']} {r['day']}")

    # -- nothing personal, nothing accusing, nothing too large
    for path in sorted(folder.rglob("*")):
        if not path.is_file():
            continue
        c.ok(path.stat().st_size < SIZE_LIMIT, f"{path.relative_to(folder)} is over {SIZE_LIMIT} bytes")
        text = path.read_text(encoding="utf-8")
        c.ok(not RD.EMAIL.search(text), f"{path.relative_to(folder)} contains an e-mail address")
        # Our own words only: a village may be called anything.
        if path.name in ("measures.json", "meta.json", "freshness.json"):
            c.ok(not VERDICT_WORDS.search(text), f"{path.name} contains a word that reads as a verdict")
    for st, hol in load(folder, "holidays.json").items():
        c.ok(st in RD.STATES, f"holidays for {st}, not a State on the host")
        for h in hol["days"]:
            c.ok(not contact_in(h["reason"]), f"holidays {st}: contact detail in a reason")
            dt.date.fromisoformat(h["date"])
    check_national(c, folder, states)
    check.passed, check.oddities = c.passed, c.oddities
    return c.failures


def main() -> int:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else PUBLISHED
    failures = check(folder)
    for line in getattr(check, "oddities", []):
        print("  source  " + line)
    for line in failures:
        print("  FAIL  " + line)
    if failures:
        print(f"{len(failures)} assertions FAILED on {folder}")
        return 1
    print(f"all {check.passed} assertions passed on {folder}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
