"""What happened in the register recently: the change layer for Instrument 01.

WHY THIS EXISTS
---------------
The sync reads the whole register every night and the published data moves
with it - but a reader could not see what moved. There was no "what changed
today", no feed, no way to watch a district; the one record of movement
(new_since_last_check) was written and read by nothing. A tool that updates
itself daily and shows none of the updates is, to its reader, a static site.

WHERE THE DATES COME FROM
-------------------------
Not from diffing one night's copy against the last. The register dates its
own events, and those dates are better evidence than the date we happened to
notice them:

  * every step of a proposal's appraisal history carries the time it started
    (`sd`, UTC; converted to an IST date, as everywhere else) and its status,
    which stages.py maps to a canonical stage. A move, a query or a closure is
    dated when its step STARTED - when the proposal entered it;
  * a filing or a decision is dated as appraisal.py dates it: the step's END,
    falling back to its start. On a submission step the start is when the
    applicant opened the draft, sometimes weeks earlier. Dating filings by the
    start put 45% of "filed" events on a different day from the proposal's own
    published filing date (`fon`), by up to 49 days - two published dates for
    one act. The earliest filing IS `fon`, so the two can be checked;
  * a proposal with no recorded history yet appears on its register submission
    date (`date`, already IST).

So the log is complete from its first build: nothing waits for a second sync
to have something to compare against. A step the portal records later than it
happened appears on the date it happened.

EACH EVENT is one of
  filed     the proposal was submitted (history phase `filed`, or the register
            submission date where no history is recorded)
  query     the authority sought essential or additional details
  moved     any other step - verification, referral, appraisal
  decided   a decision was recorded: EC or ToR granted or refused, Form 9
  closed    withdrawn, delisted, returned or otherwise closed

OUTPUT  <data>/changes/recent.json
  fields   ["kind", "date", "id", "sk", "seen"]  - rows are arrays
  rows     newest first; `id` is the proposal_id, `sk` the canonical stage,
           `seen` an index into `stamps`: the build in which this event
           FIRST appeared in the published log, or null for events already
           there when the log began
  stamps   build times (ISO, UTC), oldest first
  stamp    this build's time. Not the register's read time: a rebuild that
           did not re-read the register (every sector failed, a manual
           rebuild) can still add events, and stamping them with a read time
           a follower has already stored would hide them for ever.
  window   {"from", "to", "days"}
  daily    [{date, filed, query, moved, decided, closed}] over the window

WHY `seen`. A follower asks "what is new since I last looked?". Counting
events by their DATE cannot answer it: a step the portal records late - the
seven-day rolling re-read, a skipped night - arrives dated before the reader's
last visit and is never counted, and an event that disappears (a proposal
delisted, re-dated) hides a real one in any count-subtraction. The read in
which an event first appeared answers it exactly.
Names, districts and sectors are NOT repeated here: every consumer already
reads the shards, and a second copy of 90,000 names would be one more thing to
drift. Only proposals published in the shards appear.

Run after build_data.py (and legal_reference.py / build_register_index.py):
  python scripts/instruments/build_changes.py
Honours INSTRUMENTS_DATA_DIR for candidate builds and needs INSTRUMENTS_CACHE_DIR
for the appraisal history.
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import stages as ST  # noqa: E402

OUT = Path(os.environ.get("INSTRUMENTS_DATA_DIR")
           or SCRIPTS.parent.parent / "public" / "data" / "instruments" / "consent")

WINDOW_DAYS = 60
IST = timezone(timedelta(hours=5, minutes=30))
KINDS = ("filed", "query", "moved", "decided", "closed")
KIND_BY_PHASE = {"filed": "filed", "query": "query", "decided": "decided",
                 "closed": "closed"}


def log(msg: str) -> None:
    print(msg, flush=True)


def ist_date(ts: str | None) -> str | None:
    """A source timestamp (UTC, labelled +00:00) as an IST calendar date."""
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST).date().isoformat()


def kind_of(sk: str, statuses: dict) -> str:
    phase = (statuses.get(sk) or {}).get("phase")
    return KIND_BY_PHASE.get(phase, "moved")


PUBLISHED = SCRIPTS.parent.parent / "public" / "data" / "instruments" / "consent"


def published_rows() -> dict[str, dict]:
    """proposal_id -> {rid, date, sk, fon} for every published proposal."""
    out: dict[str, dict] = {}
    for f in sorted((OUT / "projects").glob("*.json")):
        sh = json.loads(f.read_text(encoding="utf-8"))
        F = {n: i for i, n in enumerate(sh["fields"])}
        for r in sh["rows"]:
            out[str(r[F["id"]])] = {"rid": r[F["rid"]], "date": r[F["date"]],
                                    "sk": r[F["sk"]],
                                    "fon": r[F["fon"]] if "fon" in F else None}
    return out


def previous_log() -> tuple[dict, bool]:
    """(event key -> read it first appeared in, whether a log existed).

    Read from the PUBLISHED log, not the candidate being built: in the sync
    the candidate folder starts empty, and the published log is the one
    followers saw.
    """
    path = PUBLISHED / "changes" / "recent.json"
    try:
        prev = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}, False
    reads = prev.get("stamps") or []
    seen: dict = {}
    for row in prev.get("rows") or []:
        idx = row[4] if len(row) > 4 else None
        at = reads[idx] if isinstance(idx, int) and idx < len(reads) else None
        seen[tuple(row[:4])] = at
        # A proposal's FIRST filing, whatever it was keyed by. With no history
        # yet it is ("filed", register date, id, "submitted"); once the
        # history arrives it is ("filed", fon, id, <stage>) - a new key for an
        # old event, which reported every backfilled filing as news.
        if row[0] == "filed":
            key = ("first-filed", row[2])
            if key not in seen or (seen[key] is not None and (at is None or at < seen[key])):
                seen[key] = at
    return seen, True


def history(cache: Path) -> dict[int, list[dict]]:
    """record id -> steps, the latest line per id (the file is append-only)."""
    path = cache / "history" / "history.jsonl"
    steps: dict[int, list[dict]] = {}
    if not path.exists():
        return steps
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("id") is not None:
                steps[rec["id"]] = rec.get("steps") or []
    return steps


def build(today: date | None = None) -> dict:
    cache = Path(os.environ.get("INSTRUMENTS_CACHE_DIR", ""))
    statuses = ST.registry()["statuses"]
    rows = published_rows()
    hist = history(cache) if str(cache) else {}

    # The window ends on the register's read date, not the build's clock: a
    # rebuild from cache on a later day must not claim days it never read.
    fresh = {}
    try:
        fresh = json.loads((OUT / "freshness.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        pass
    end = (ist_date(fresh.get("checked_at")) if fresh.get("checked_at") else None) \
        or (today or datetime.now(IST).date()).isoformat()
    start = (date.fromisoformat(end) - timedelta(days=WINDOW_DAYS - 1)).isoformat()

    events: set[tuple[str, str, str, str]] = set()
    unknown_steps: Counter = Counter()
    with_history = 0
    for pid, r in rows.items():
        steps = hist.get(r["rid"]) or []
        filed_in_history = False
        filed: list[tuple[str, str]] = []
        for st in steps:
            sk = ST.canonical(st.get("s"))
            if sk == "unclassified":
                unknown_steps[ST.normalise(st.get("s"))] += 1
                continue
            k = kind_of(sk, statuses)
            # Filings and decisions by the step's end, as appraisal.py dates
            # them; everything else by when the step started.
            if k in ("filed", "decided"):
                d = ist_date(st.get("ed")) or ist_date(st.get("sd"))
            else:
                d = ist_date(st.get("sd"))
            if k == "filed":
                filed_in_history = True
                if d:
                    filed.append((d, sk))
                continue
            if d and start <= d <= end:
                events.add((k, d, pid, sk))
        # The first filing is the proposal's published filing date, exactly;
        # later filing steps (re-submissions) keep their own dates.
        filed.sort()
        if filed and r.get("fon"):
            filed[0] = (r["fon"], filed[0][1])
        for d, sk in filed:
            if start <= d <= end:
                events.add(("filed", d, pid, sk))
        if steps:
            with_history += 1
        # No recorded filing step: the register's own submission date stands in.
        if not filed_in_history:
            d = (r.get("date") or "")[:10]
            if d and start <= d <= end:
                events.add(("filed", d, pid, "submitted"))

    ordered = sorted(events, key=lambda e: (e[1], KINDS.index(e[0]), e[2]),
                     reverse=True)

    # When each event first appeared in a published log.
    read_now = datetime.now(timezone.utc).isoformat()
    prev_seen, had_log = previous_log()
    first: list = []
    earliest_filed: dict = {}
    for e in ordered:
        if e[0] == "filed" and (e[2] not in earliest_filed or e[1] < earliest_filed[e[2]]):
            earliest_filed[e[2]] = e[1]
    for e in ordered:
        if e in prev_seen:
            first.append(prev_seen[e])
        elif (e[0] == "filed" and e[1] == earliest_filed.get(e[2])
              and ("first-filed", e[2]) in prev_seen):
            first.append(prev_seen[("first-filed", e[2])])
        else:
            # New in this build. With no previous log there is no "before",
            # so everything counts as already there when the log began.
            first.append(read_now if had_log else None)
    reads = sorted({x for x in first if x})
    read_index = {x: i for i, x in enumerate(reads)}
    daily: dict[str, Counter] = {}
    for k, d, _, _ in ordered:
        daily.setdefault(d, Counter())[k] += 1
    days = []
    cur = date.fromisoformat(start)
    while cur.isoformat() <= end:
        c = daily.get(cur.isoformat(), Counter())
        days.append({"date": cur.isoformat(), **{k: c.get(k, 0) for k in KINDS}})
        cur += timedelta(days=1)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window": {"from": start, "to": end, "days": WINDOW_DAYS},
        "stamp": read_now,
        "stamps": reads,
        "fields": ["kind", "date", "id", "sk", "seen"],
        "kinds": {
            "filed": "Submitted to the authority",
            "query": "Essential or additional details sought",
            "moved": "Moved to another stage of appraisal",
            "decided": "A decision was recorded",
            "closed": "Withdrawn, delisted, returned or closed",
        },
        "basis": ("Dated by the portal's own appraisal history, converted to "
                  "India Standard Time; a proposal with no recorded history "
                  "appears on its register submission date."),
        "coverage": {"published": len(rows), "with_history": with_history},
        "rows": [[*e, read_index.get(f) if f else None]
                 for e, f in zip(ordered, first)],
        "daily": days,
    }
    (OUT / "changes").mkdir(parents=True, exist_ok=True)
    (OUT / "changes" / "recent.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    totals = Counter(e[0] for e in ordered)
    log(f"changes: {len(ordered):,} events {start} .. {end}: "
        + ", ".join(f"{k} {totals.get(k, 0):,}" for k in KINDS))
    if unknown_steps:
        log(f"  {sum(unknown_steps.values()):,} history steps with an unmapped "
            f"status were left out: {dict(unknown_steps.most_common(5))}")
    return payload


if __name__ == "__main__":
    build()
