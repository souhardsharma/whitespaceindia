"""Tests for the builder and for the contract that guards what it publishes.

WHY THIS EXISTS
---------------
The contract is only worth running if it fails on a wrong build. Each case
below builds a small, correct set of files from a pretend night, checks that
it passes, then damages one thing - a flag's enrolment, a count, a threshold,
a school's name - and checks that the contract notices. Offline.
"""
from __future__ import annotations

import datetime as dt
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ams as AMS  # noqa: E402
import ams_sync as AS  # noqa: E402
import build_data as BD  # noqa: E402
import check_published as CP  # noqa: E402
import store as ST  # noqa: E402
import sync as SY  # noqa: E402
import test_ams as TA  # noqa: E402
from test_sync import PretendFinder, PretendHost, YESTERDAY, quiet  # noqa: E402

PASS = FAIL = 0


def check(name: str, cond: bool, detail: object = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def built() -> tuple:
    folder = tempfile.TemporaryDirectory()
    base = Path(folder.name)
    db = ST.connect(base / "store.sqlite")
    SY.run(db, PretendHost(budget=300), YESTERDAY, "2026-11-20T01:00:00+00:00", say=quiet,
           finder=PretendFinder())
    meta = BD.build(db, base / "out", "2026-11-20T02:00:00+00:00")
    db.close()
    return folder, base / "out", meta


def edit(path: Path, change) -> None:
    value = json.loads(path.read_text(encoding="utf-8"))
    change(value)
    path.write_text(json.dumps(value), encoding="utf-8")


def test_a_correct_build_passes() -> None:
    print("a correct build")
    folder, out, meta = built()
    failures = CP.check(out)
    check("passes the contract", failures == [], failures[:5])
    check("counts the 17 days above enrolment", meta["counts"]["flag_over"] == 17, meta["counts"])
    check("one school flagged", meta["counts"]["schools_flagged"] == 1)
    school = json.loads((out / "schools" / "2026-11" / f"{BD.bucket_of('1001')}.json").read_text(encoding="utf-8"))["1001-1"]
    check("the flagged school carries its UDISE+ record",
          school["udise"]["record"]["textbooks_primary"] == 19 and meta["counts"]["udise_found"] == 1, school["udise"])
    check("three school-days could be tested", meta["counts"]["school_days_tested"] == 3)
    state = json.loads((out / "state" / "16.json").read_text(encoding="utf-8"))
    district = state["districts"][0]
    check("area names are tidied", district["name"] == "Sepahijala", district["name"])
    check("the school's name is left as filed", district["flagged"][0]["name"] == "Over Jr. Madrassa")
    bucket = out / "schools" / "2026-11" / f"{BD.bucket_of('1001')}.json"
    school = json.loads(bucket.read_text(encoding="utf-8"))["1001-1"]
    check("the school's month is published beside its flags", school["meals"][0] == 70 and len(school["flags"]) == 17)
    check("and its enrolment history", school["enrolment"][10] == 23)
    roster = json.loads((out / "roster" / "16-1605.json").read_text(encoding="utf-8"))
    check("every school read is in the district's roster",
          len(roster["schools"]) == 4 == meta["counts"]["schools_read"], len(roster["schools"]))
    check("with what its cluster's latest table showed",
          ["1003-1", "Unfiled School", "1605070006", None, 90] in roster["schools"], roster["schools"])
    history = json.loads((out / "history" / "16" / "2026.json").read_text(encoding="utf-8"))
    check("the district's days are in the year's history file",
          history["districts"]["1605"][-1][:2] == ["2026-11-19", 4], history["districts"]["1605"][-1])
    csv_text = (out / "flags" / "2026-11.csv").read_text(encoding="utf-8")
    check("the CSV lists every flag", csv_text.count("\n") == 18, csv_text.count("\n"))
    folder.cleanup()


def damaged(name: str, change_path: str, change) -> None:
    folder, out, _ = built()
    edit(out / change_path, change)
    failures = CP.check(out)
    check(name, bool(failures), "the contract passed a damaged build")
    folder.cleanup()


def test_damage_is_noticed() -> None:
    print("damage")
    bucket = f"schools/2026-11/{BD.bucket_of('1001')}.json"

    def enrolment_above_meals(v):
        v["1001-1"]["flags"][0]["enrolled"] = 500
    damaged("a flag its own figures do not support", bucket, enrolment_above_meals)

    def wrong_bucket_name(v):
        v["9999-1"] = v.pop("1001-1")
    damaged("a school under another school's key", bucket, wrong_bucket_name)

    def phone_in_name(v):
        v["1001-1"]["name"] = "Over Jr. Madrassa 9876543210"
    damaged("a phone number in a school's name", bucket, phone_in_name)

    def person_in_udise(v):
        v["1001-1"]["udise"]["record"]["head"] = "A PERSON"
    damaged("a field of the UDISE+ answer the instrument does not keep", bucket, person_in_udise)

    def phone_in_udise(v):
        v["1001-1"]["udise"]["record"]["name"] += " 9876543210"
    damaged("a phone number in the UDISE+ name", bucket, phone_in_udise)

    def count_off(v):
        v["counts"]["flag_over"] += 1
    damaged("a count that disagrees with the rows", "meta.json", count_off)

    def threshold_changed(v):
        v["thresholds"]["spike_ratio"] = 2
    damaged("a threshold the tests did not use", "meta.json", threshold_changed)

    def definition_changed(v):
        v["meals"]["definition"] = "Meals eaten."
    damaged("a measure described differently from the registry", "measures.json", definition_changed)

    def verdict(v):
        v["meals"]["definition"] += " Evidence of fraud."
    damaged("a word that reads as a verdict", "measures.json", verdict)

    def state_total_off(v):
        v["states"][0]["flag_over"] += 3
    damaged("a State total its districts do not sum to", "states.json", state_total_off)

    def school_dropped(v):
        v["schools"].pop()
    damaged("a roster shorter than the count on the page", "roster/16-1605.json", school_dropped)

    def history_edited(v):
        v["districts"]["1605"][-1][5] += 1
    damaged("a history whose last row is not the district's latest day", "history/16/2026.json", history_edited)

    def history_out_of_order(v):
        v["districts"]["1605"].reverse()
    damaged("a history out of date order", "history/16/2026.json", history_out_of_order)

    def stale_flag_listed(v):
        v["rows"][0]["standing"] = False
    damaged("a flag that no longer stands on the latest list", "flags/recent.json", stale_flag_listed)


def test_a_failed_build_changes_nothing() -> None:
    print("promotion")
    folder, out, _ = built()
    base = out.parent
    published = base / "published"
    BD.promote(out, published)
    check("a checked candidate is swapped in", (published / "meta.json").is_file() and not out.exists())
    before = (published / "meta.json").read_text(encoding="utf-8")
    db = ST.connect(base / "store.sqlite")
    BD.build(db, base / "second", "2026-11-21T02:00:00+00:00")
    db.close()
    BD.promote(base / "second", published)
    check("a later build replaces it whole",
          (published / "meta.json").read_text(encoding="utf-8") != before
          and not (base / "published.outgoing").exists())
    folder.cleanup()


def test_the_national_files() -> None:
    print("the national system's files")
    folder = tempfile.TemporaryDirectory()
    base = Path(folder.name)
    db = ST.connect(base / "store.sqlite")
    SY.run(db, PretendHost(budget=300), YESTERDAY, "2026-11-20T01:00:00+00:00", say=quiet,
           finder=PretendFinder())
    BD.build(db, base / "before", "2026-11-20T02:00:00+00:00")
    check("a store with no national read still builds and passes",
          CP.check(base / "before") == []
          and json.loads((base / "before" / "national.json").read_text(encoding="utf-8"))["read"] is False)
    today = YESTERDAY + dt.timedelta(days=1)
    AS.run(db, lambda: AMS.Flow(TA.Page(today).request), YESTERDAY, "2026-11-20T01:30:00Z",
           deadline=float("inf"), cap=200, say=quiet, clock=lambda: 0)
    out = base / "out"
    BD.build(db, out, "2026-11-20T02:00:00+00:00")
    db.close()
    failures = CP.check(out)
    check("passes the contract", failures == [], failures[:5])
    nat = json.loads((out / "national.json").read_text(encoding="utf-8"))
    check("36 States and UTs", len(nat["states"]) == 36 and nat["day"] == YESTERDAY.isoformat(), len(nat["states"]))
    tripura = next(s for s in nat["states"] if s["name"] == "Tripura")
    check("a State on both systems carries the meal system's code", tripura["st"] == "16")
    check("its districts are listed in ordinary case",
          [d["name"] for d in tripura["districts"]] == ["Dhalai", "Gomati", "Sipahijala"], tripura["districts"])
    check("an abbreviated name is written out",
          any(s["name"] == "Andaman & Nicobar Islands" for s in nat["states"]))
    check("both systems are set side by side for the same day",
          any(row["st"] == "16" and row["day"] == nat["day"] for row in nat["compare"]), nat["compare"])
    lines = (out / "national" / "states.csv").read_text(encoding="utf-8").splitlines()
    check("the State CSV holds every State-day read", len(lines) == 1 + 36 * nat["days"], len(lines))
    check("a district CSV is written for each month", nat["district_months"] and all(
        (out / "national" / f"districts-{m}.csv").is_file() for m in nat["district_months"]))

    def damaged(name: str, change) -> None:
        copy = base / "damaged"
        shutil.rmtree(copy, ignore_errors=True)
        shutil.copytree(out, copy)
        edit(copy / "national.json", change)
        check(f"refuses {name}", CP.check(copy) != [])

    damaged("a State listed twice", lambda v: v["states"].append(v["states"][0]))
    damaged("an all-India total the States do not sum to", lambda v: v["series"][-1].__setitem__(3, 1))
    damaged("a comparison that is not the meal system's own figure",
            lambda v: v["compare"][0]["here"].__setitem__(2, 1))
    damaged("a phone number in a district's name",
            lambda v: v["states"][-1]["districts"][0].__setitem__("name", "Dhalai 9876543210"))
    folder.cleanup()


def main() -> int:
    for fn in (test_a_correct_build_passes, test_damage_is_noticed, test_a_failed_build_changes_nothing,
               test_the_national_files):
        fn()
    print()
    if FAIL:
        print(f"{FAIL} of {PASS + FAIL} checks FAILED")
        return 1
    print(f"all {PASS} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
