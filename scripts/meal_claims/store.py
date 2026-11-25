"""What the nightly run remembers between nights: one SQLite file.

The host shows a school's daily figures for the current month only, and a
district's or a State's for whatever date is asked. So the history a flag is
judged against - which weekdays a school serves on, what it usually reports,
which nights read what - has to be kept here, or it is gone.

The file is NOT committed. It travels between runs as a release asset
(`pack` / `unpack`), and the published files are rebuilt from it every night.
It holds counts, codes, institution names and dates, and nothing else.
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import shutil
import sqlite3
from pathlib import Path

SCHEMA_VERSION = 1

SCHEMA = """
create table if not exists info(key text primary key, value text);

-- one row per State per day, from the national table
create table if not exists state_day(
  st text, day text, schools int, reported int, meals int, read_at text,
  primary key (st, day));

-- one row per district per day, from each State's district table
create table if not exists district_day(
  st text, dc text, day text, schools int, enr_filed int, enrolled int,
  reported int, meals int,
  primary key (st, dc, day));

-- the hierarchy, each level holding the latest table it appeared in
create table if not exists district(
  st text, dc text, name text, blocks_read_at text, blocks_day text,
  primary key (st, dc));
create table if not exists block(
  st text, dc text, bc text, name text, schools int, enr_filed int,
  enrolled int, reported int, meals int, day text, clusters_read_at text,
  primary key (st, bc));
create table if not exists cluster(
  st text, dc text, bc text, cc text, name text, schools int, enr_filed int,
  enrolled int, reported int, meals int, day text, schools_read_at text,
  schools_day text,
  primary key (st, cc));

-- one school table read: how many schools the tests could be run on
create table if not exists cluster_read(
  st text, cc text, day text, schools int, filed int, reported int,
  tested int, over int, read_at text,
  primary key (st, cc, day));

-- schools the instrument follows: every school a flag has named
create table if not exists school(
  st text, code text, shift text, name text, dc text, bc text, cc text,
  followed_since text,
  primary key (st, code, shift));
create table if not exists school_month(
  st text, code text, shift text, year int, month int, meals text,
  read_at text,
  primary key (st, code, shift, year, month));
create table if not exists school_enrol(
  st text, code text, shift text, year int, months text, read_at text,
  primary key (st, code, shift, year));

-- schools whose month a table asked to be read and the budget did not reach
create table if not exists owed(
  st text, code text, shift text, since text,
  primary key (st, code, shift));

create table if not exists flag(
  st text, code text, shift text, day text, kind text, basis text,
  first_stamp text, last_stamp text, standing int default 1,
  primary key (st, code, shift, day, kind));

create table if not exists holiday(
  st text, day text, reason text, primary key (st, day, reason));
create table if not exists holiday_read(st text primary key, read_at text);

-- closed days looked into: how much of the day's reporting was examined
create table if not exists closed_day(
  st text, day text, reported int, meals int, schools_found int,
  examined_at text,
  primary key (st, day));

create table if not exists night(
  stamp text primary key, day text, budget int, sent int, failed int,
  median_s real, p90_s real, outcome text, notes text);
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    got = db.execute("select value from info where key='schema'").fetchone()
    if got is None:
        db.execute("insert into info values ('schema', ?)", (str(SCHEMA_VERSION),))
        db.commit()
    elif int(got["value"]) != SCHEMA_VERSION:
        raise RuntimeError(f"store schema {got['value']}, this code reads {SCHEMA_VERSION}")
    return db


def pack(path: Path, out: Path) -> None:
    """Write a compressed, consistent copy of the store for upload."""
    snap = out.with_suffix(".snapshot")
    src = sqlite3.connect(path)
    dst = sqlite3.connect(snap)
    with dst:
        src.backup(dst)
    dst.execute("vacuum")
    dst.close()
    src.close()
    with snap.open("rb") as raw, gzip.open(out, "wb", compresslevel=6) as packed:
        shutil.copyfileobj(raw, packed)
    snap.unlink()


def unpack(packed: Path, path: Path) -> None:
    """Restore a packed store, refusing one that does not open cleanly."""
    tmp = path.with_suffix(".incoming")
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(packed, "rb") as raw, tmp.open("wb") as out:
        shutil.copyfileobj(raw, out)
    db = sqlite3.connect(tmp)
    verdict = db.execute("pragma integrity_check").fetchone()[0]
    db.close()
    if verdict != "ok":
        tmp.unlink()
        raise RuntimeError(f"packed store failed its integrity check: {verdict}")
    tmp.replace(path)


def iso(day: dt.date) -> str:
    return day.isoformat()


def put_state_day(db, day: dt.date, rows: list[dict], read_at: str) -> None:
    db.executemany(
        "insert or replace into state_day values (?,?,?,?,?,?)",
        [(r["st"], iso(day), r["schools"], r["reported"], r["meals"], read_at) for r in rows])


def put_districts(db, st: str, day: dt.date, rows: list[dict]) -> None:
    db.executemany(
        "insert or replace into district_day values (?,?,?,?,?,?,?,?)",
        [(st, r["code"], iso(day), r["schools"], r["enr_filed"], r["enrolled"],
          r["reported"], r["meals"]) for r in rows])
    for r in rows:
        db.execute(
            "insert into district (st, dc, name) values (?,?,?) "
            "on conflict (st, dc) do update set name=excluded.name",
            (st, r["code"], r["name"]))


def put_blocks(db, st: str, dc: str, day: dt.date, rows: list[dict], read_at: str) -> None:
    for r in rows:
        db.execute(
            "insert into block (st, dc, bc, name, schools, enr_filed, enrolled, reported, meals, day) "
            "values (?,?,?,?,?,?,?,?,?,?) on conflict (st, bc) do update set "
            "dc=excluded.dc, name=excluded.name, schools=excluded.schools, "
            "enr_filed=excluded.enr_filed, enrolled=excluded.enrolled, "
            "reported=excluded.reported, meals=excluded.meals, day=excluded.day",
            (st, dc, r["code"], r["name"], r["schools"], r["enr_filed"], r["enrolled"],
             r["reported"], r["meals"], iso(day)))
    db.execute("update district set blocks_read_at=?, blocks_day=? where st=? and dc=?",
               (read_at, iso(day), st, dc))


def put_clusters(db, st: str, dc: str, bc: str, day: dt.date, rows: list[dict], read_at: str) -> None:
    for r in rows:
        db.execute(
            "insert into cluster (st, dc, bc, cc, name, schools, enr_filed, enrolled, reported, meals, day) "
            "values (?,?,?,?,?,?,?,?,?,?,?) on conflict (st, cc) do update set "
            "dc=excluded.dc, bc=excluded.bc, name=excluded.name, schools=excluded.schools, "
            "enr_filed=excluded.enr_filed, enrolled=excluded.enrolled, "
            "reported=excluded.reported, meals=excluded.meals, day=excluded.day",
            (st, dc, bc, r["code"], r["name"], r["schools"], r["enr_filed"], r["enrolled"],
             r["reported"], r["meals"], iso(day)))
    db.execute("update block set clusters_read_at=? where st=? and bc=?", (read_at, st, bc))


def follow(db, st: str, school: dict, dc: str, bc: str, cc: str, stamp: str) -> None:
    db.execute(
        "insert into school values (?,?,?,?,?,?,?,?) on conflict (st, code, shift) do update set "
        "name=excluded.name, dc=excluded.dc, bc=excluded.bc, cc=excluded.cc",
        (st, school["code"], school["shift"], school["name"], dc, bc, cc, stamp))


def put_month(db, st: str, code: str, shift: str, month: dict, read_at: str) -> None:
    db.execute("insert or replace into school_month values (?,?,?,?,?,?,?)",
               (st, code, shift, month["year"], month["month"], json.dumps(month["meals"]), read_at))


def put_enrolment(db, st: str, code: str, shift: str, enrol: dict, read_at: str) -> None:
    db.execute("insert or replace into school_enrol values (?,?,?,?,?,?)",
               (st, code, shift, enrol["year"], json.dumps(enrol["months"]), read_at))


def put_flag(db, st: str, code: str, shift: str, flag: dict, stamp: str) -> bool:
    """Record a flag; True when it is new. The first stamp is never moved."""
    day, kind = iso(flag["date"]), flag["kind"]
    basis = json.dumps({k: v for k, v in flag.items() if k not in ("date", "kind")}, sort_keys=True)
    old = db.execute("select 1 from flag where st=? and code=? and shift=? and day=? and kind=?",
                     (st, code, shift, day, kind)).fetchone()
    if old:
        db.execute("update flag set basis=?, last_stamp=?, standing=1 "
                   "where st=? and code=? and shift=? and day=? and kind=?",
                   (basis, stamp, st, code, shift, day, kind))
        return False
    db.execute("insert into flag values (?,?,?,?,?,?,?,?,1)",
               (st, code, shift, day, kind, basis, stamp, stamp))
    return True


def series(db, st: str, code: str, shift: str) -> dict[dt.date, int]:
    """Every daily figure held for one school, across the months read."""
    out: dict[dt.date, int] = {}
    for row in db.execute("select year, month, meals from school_month "
                          "where st=? and code=? and shift=?", (st, code, shift)):
        for i, meals in enumerate(json.loads(row["meals"])):
            out[dt.date(row["year"], row["month"], i + 1)] = meals
    return out


def enrolment(db, st: str, code: str, shift: str) -> dict[tuple[int, int], int | None]:
    out: dict[tuple[int, int], int | None] = {}
    for row in db.execute("select year, months from school_enrol "
                          "where st=? and code=? and shift=?", (st, code, shift)):
        for i, filed in enumerate(json.loads(row["months"])):
            out[(row["year"], i + 1)] = filed
    return out


def holidays(db, st: str) -> dict[dt.date, str]:
    out: dict[dt.date, str] = {}
    for row in db.execute("select day, reason from holiday where st=? order by day, reason", (st,)):
        day = dt.date.fromisoformat(row["day"])
        out[day] = f"{out[day]}; {row['reason']}" if day in out and row["reason"] else out.get(day) or row["reason"]
    return out


def shut_days(db, st: str, shut) -> dict[dt.date, bool]:
    """date -> whether the State was shut, for every day its table was read."""
    out = {}
    for row in db.execute("select day, schools, reported from state_day where st=?", (st,)):
        verdict = shut(row["reported"], row["schools"])
        if verdict is not None:
            out[dt.date.fromisoformat(row["day"])] = verdict
    return out
