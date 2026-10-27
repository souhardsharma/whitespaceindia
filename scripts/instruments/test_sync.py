"""Tests for the scheduled sync's currency claims.

WHY THIS EXISTS
---------------
This job runs unattended every night and nobody reads its log. Everything it
gets wrong is therefore silent by construction, and the two things below were
silent in the worst way: the run went green, the site reported a successful
check, and the register underneath it was quietly wrong.

Both are claims about time - when the register was last read, and how much of
it that read covered. Neither can be checked by looking at the published data,
because a stale row and a current row are the same row.

Offline. No network, no cache.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sync as SY  # noqa: E402

PASS = FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


PREV = "2026-09-01T01:30:00+00:00"
NOW = "2026-09-02T01:30:00+00:00"


def test_watermark() -> None:
    print("\nthe watermark only advances over ground actually covered")
    check("a clean run advances it",
          SY.next_watermark(PREV, NOW, []) == NOW)
    check("one failed sector holds it",
          SY.next_watermark(PREV, NOW, ["Non-Coal Mining"]) == PREV)
    check("several failed sectors hold it",
          SY.next_watermark(PREV, NOW, ["a", "b", "c"]) == PREV)
    # The case that makes this matter: holding must re-cover the SAME window,
    # not a later one. If the returned watermark ever moved forward on a
    # partial run, the missed changes would never be requested again.
    held = SY.next_watermark(PREV, NOW, ["Non-Coal Mining"])
    check("the held window is the one that was missed, not a later one",
          held == PREV and held < NOW, f"{held}")
    check("a first-ever run with a failure still has nothing to go back to",
          SY.next_watermark(None, NOW, ["a"]) is None)

    # A backfill that aborted is the same kind of hole as a sector that
    # failed: the register said a proposal moved and we did not read its
    # forms. The first version of this took only failed_sectors, so a run
    # logged "watermark held" and advanced the watermark in the same breath.
    check("an aborted backfill holds it even with every sector green",
          SY.next_watermark(PREV, NOW, [], incomplete_backfill=True) == PREV)
    check("and a clean run with a clean backfill still advances",
          SY.next_watermark(PREV, NOW, [], incomplete_backfill=False) == NOW)
    check("either hole alone is enough to hold it",
          SY.next_watermark(PREV, NOW, ["a"], incomplete_backfill=True) == PREV)
    check("and a first-ever clean run sets it",
          SY.next_watermark(None, NOW, []) == NOW)


def test_rolling_slot() -> None:
    """The open register must be re-read on an unbroken seven-day cycle.

    A slice that is skipped leaves its open proposals fourteen days between
    reads, and nothing anywhere says so: the job is green, the data is
    internally consistent, and those proposals simply carry a status that is a
    week staler than the rest. Day-of-year did exactly that at every year
    boundary, because 365 % 7 == 1 == 1 % 7.
    """
    import datetime
    print("\nthe rolling re-read cycle is unbroken")
    d = datetime.date(2026, 12, 20)
    slots = []
    for _ in range(60):
        slots.append(SY.rolling_slot(d, 7))
        d += datetime.timedelta(days=1)
    repeats = sum(1 for a, b in zip(slots, slots[1:]) if a == b)
    check("no slice runs two days running, across a year boundary",
          repeats == 0, f"{repeats} repeats")

    # Every slice used, and used equally, over a long stretch including a leap
    # year - so no cohort is ever read less often than another.
    import collections
    c = collections.Counter()
    d = datetime.date(2027, 6, 1)
    for _ in range(7 * 200):
        c[SY.rolling_slot(d, 7)] += 1
        d += datetime.timedelta(days=1)
    check("every slice is used", set(c) == set(range(7)), str(sorted(c)))
    check("and used equally", max(c.values()) - min(c.values()) <= 1,
          str(dict(sorted(c.items()))))

    # And a full cycle covers the whole set exactly once.
    seen = {SY.rolling_slot(datetime.date(2026, 9, 3)
                            + datetime.timedelta(days=i), 7) for i in range(7)}
    check("seven consecutive days cover all seven slices",
          seen == set(range(7)), str(sorted(seen)))


def test_reread_queue() -> None:
    """A proposal whose row moved must be re-read, or asked for again.

    merge() advances the cached register in the same call that reports what
    moved, so an id seen as changed tonight reads as UNCHANGED tomorrow. If
    the pass that consumes it fails and the queue is rebuilt from that run
    alone, nothing ever asks for that proposal again: its history stays frozen
    before the decision step, it publishes a null duration, and no counter
    anywhere says a debt was dropped. Nor does the watermark cover it - the
    scheduled run sweeps in full, so holding last_success changes nothing
    about what is fetched.
    """
    print("\nthe re-read queue is a debt, not a notification")
    q = SY.queue_rereads({}, {101, 102})
    check("a moved id is queued for every fetcher",
          q["caf"] == [101, 102] and q["history"] == [101, 102], str(q))

    # The failure night: the consuming pass did not complete.
    q = SY.discharge(q, "history", consumed=False)
    check("a pass that did not complete discharges nothing",
          q["history"] == [101, 102], str(q["history"]))

    # The next night the register reports NOTHING moved, because the cache
    # already holds the new status. The debt must survive that.
    q = SY.queue_rereads(q, set())
    check("the debt survives a night with no movement at all",
          q["history"] == [101, 102], str(q["history"]))

    q = SY.queue_rereads(q, {103})
    check("and accumulates", q["history"] == [101, 102, 103], str(q["history"]))

    q = SY.discharge(q, "history", consumed=True)
    check("a completed pass clears it", q["history"] == [], str(q["history"]))
    check("and only for the fetcher that ran",
          q["caf"] == [101, 102, 103], str(q["caf"]))

    # Ids are compared as numbers, not as whatever JSON round-tripping left.
    q2 = SY.queue_rereads({"caf": ["7"], "history": []}, {7})
    check("an id queued twice in different shapes is one id",
          q2["caf"] == [7], str(q2["caf"]))


def test_stamp_is_not_written_without_a_read(tmp: Path) -> None:
    print("\nthe register is not dated by a read that did not happen")
    cache = tmp / "cache"
    (cache / "parivesh").mkdir(parents=True, exist_ok=True)
    (cache / "parivesh" / "all_records.json").write_text(
        '[{"proposal_id": "P1", "proposalStatus": "X", "app_updated_on": "1"}]',
        encoding="utf-8")
    stamp = cache / "fetch_stamps.json"

    SY.merge(cache, [], read_something=False)
    check("every sector failing leaves the fetch stamp alone",
          not stamp.exists(), "a stamp was written for a read that did not happen")

    SY.merge(cache, [], read_something=True)
    check("a run that read something does stamp it", stamp.exists())

    # And the merge itself must never lose a record it did not fetch.
    import json
    recs = json.loads((cache / "parivesh" / "all_records.json")
                      .read_text(encoding="utf-8"))
    check("a partial delta does not delete what it did not cover",
          len(recs) == 1 and recs[0]["proposal_id"] == "P1", str(recs)[:80])


def test_promote(tmp: Path) -> None:
    print("\na candidate replaces the published data whole, or not at all")
    pub = tmp / "public" / "consent"
    cand = tmp / "cache" / "candidate"
    (pub / "projects").mkdir(parents=True)
    (cand / "projects").mkdir(parents=True)
    (pub / "meta.json").write_text("old", encoding="utf-8")
    (pub / "projects" / "gone.json").write_text("stale", encoding="utf-8")
    (cand / "meta.json").write_text("new", encoding="utf-8")
    (cand / "projects" / "kept.json").write_text("new", encoding="utf-8")

    SY.promote(cand, pub)
    check("the published folder carries the candidate's files",
          (pub / "meta.json").read_text(encoding="utf-8") == "new"
          and (pub / "projects" / "kept.json").exists())
    check("a file the new build no longer writes is not left to be served",
          not (pub / "projects" / "gone.json").exists())
    check("no staging folder is left behind",
          not pub.with_name("consent.incoming").exists()
          and not pub.with_name("consent.outgoing").exists())
    check("the candidate itself is untouched (it is copied, not moved)",
          (cand / "meta.json").exists())

    # A promote that died between its two renames leaves the only copy of the
    # published data in .outgoing. The next promote must restore it, never
    # delete it as leftover staging.
    out = pub.with_name("consent.outgoing")
    pub.rename(out)
    (cand / "meta.json").write_text("newer", encoding="utf-8")
    SY.recover_published(pub)
    check("an interrupted promote is recovered from .outgoing",
          pub.exists() and not out.exists()
          and (pub / "meta.json").read_text(encoding="utf-8") == "new")
    pub.rename(out)
    SY.promote(cand, pub)
    check("promote itself recovers first, then swaps",
          (pub / "meta.json").read_text(encoding="utf-8") == "newer"
          and not out.exists())


def test_sweep_fetch_waits_and_reports() -> None:
    print("\na sweep call logs each failed attempt and waits before the next")
    answers = [(500, b"busy"), (-1, b"timed out"), (200, b"rows")]
    sent, slept, logged = [], [], []
    saved = (SY.NET.get, SY.pool, SY.time.sleep, SY.log)
    try:
        SY.NET.get = lambda *a, **k: (sent.append(k), answers.pop(0))[1]
        SY.pool = lambda: None
        SY.time.sleep = slept.append
        SY.log = logged.append
        body = SY.fetch("https://x")
        check("it returns the answer that came", body == b"rows")
        check("each attempt is one send, with a 500 retried, not returned",
              len(sent) == 3 and all(k["attempts"] == 1 and k["final"] == frozenset()
                                     for k in sent))
        check("it waited between attempts, by the backoff",
              slept == list(SY.SWEEP_BACKOFF[:2]), str(slept))
        check("each failure is in the log with its status",
              len(logged) == 2 and "HTTP 500" in logged[0] and "HTTP -1" in logged[1])
        answers[:] = [(-1, SY.NET.DEADLINE_BODY)]
        sent.clear()
        try:
            SY.fetch("https://x")
            raised = False
        except RuntimeError:
            raised = True
        check("a passed deadline ends it at once, as a failure",
              raised and len(sent) == 1)
    finally:
        SY.NET.get, SY.pool, SY.time.sleep, SY.log = saved


def test_failed_sector_gets_a_second_round() -> None:
    print("\na sector that failed is asked once more after the others")
    first, second = list(SY.SECTORS)[:2]
    calls: list[int] = []
    fail_left = {first: 1, second: 2}

    def fake_fetch(url: str, timeout: int = 300, deadline=None, **_) -> bytes:
        sid = int(url.split("sector=")[1].split("&")[0]) if "sector=" in url else None
        calls.append(sid)
        if fail_left.get(sid, 0) > 0:
            fail_left[sid] -= 1
            raise RuntimeError("register fetch failed after retries: HTTP -1 refused")
        return b'{"status": 200, "data": [{"id": %d}]}' % sid

    saved = (SY.fetch, SY.log, SY.PARIVESH_SEARCH)
    try:
        SY.fetch, SY.log = fake_fetch, (lambda *_: None)
        SY.PARIVESH_SEARCH = "https://x/?sector={sector}"
        records, stats = SY.fetch_delta(None)
        check("a sector that answers on the second round counts as read",
              "error" not in stats[SY.SECTORS[first]] and {"id": first} in records,
              str(stats[SY.SECTORS[first]]))
        check("a sector that fails twice is still a failure",
              "error" in stats[SY.SECTORS[second]], str(stats[SY.SECTORS[second]]))
        check("each sector is asked at most twice, the others once",
              calls.count(first) == 2 and calls.count(second) == 2
              and len(calls) == len(SY.SECTORS) + 2, str(calls))
        check("its rows are not counted twice", records.count({"id": first}) == 1)

        calls.clear()
        fail_left.update({first: 1})
        SY.fetch_delta(None, deadline=time.time() - 1)
        check("no second round once the sweep's time is spent",
              calls.count(first) == 1, str(calls))
    finally:
        SY.fetch, SY.log, SY.PARIVESH_SEARCH = saved


def test_failed_forest_state_gets_a_second_round(tmp: Path) -> None:
    print("\na forest State that failed is asked once more, with longer patience")
    calls: list[tuple[int, int]] = []

    def fake_fetch(url: str, timeout: int = 300, **_) -> bytes:
        code = int(url.split("code=")[1])
        calls.append((code, timeout))
        if code == 9 or (code == 6 and timeout == SY.WINDOW_TIMEOUT):
            raise RuntimeError("register fetch failed after retries: HTTP -1 timed out")
        return b'{"status": 200, "data": [{"proposal_id": %d}]}' % code

    saved = (SY.fetch, SY.log, SY.FOREST_SEARCH, SY.merge_forest_states)
    try:
        SY.fetch, SY.log = fake_fetch, (lambda *_: None)
        SY.FOREST_SEARCH = "https://x/?code={code}"
        SY.merge_forest_states = lambda cache: 0
        stats = SY.fetch_forest(tmp)
        check("a State that answers on the second round counts as read",
              stats["codes"] == len(SY.LGD_STATE_CODES) - 1
              and (tmp / "parivesh" / "forest" / "state_6.json").exists(), str(stats))
        check("the second round waits longer",
              (6, SY.FOREST_RETRY_TIMEOUT) in calls, str(calls))
        check("a State that fails twice is still a failure, and only it",
              [f["code"] for f in stats["failed"]] == [9], str(stats["failed"]))
        check("each State that answered is asked once",
              len(calls) == len(SY.LGD_STATE_CODES) + 2, str(len(calls)))
    finally:
        SY.fetch, SY.log, SY.FOREST_SEARCH, SY.merge_forest_states = saved


def _rows(sector: str, per_day: dict) -> list[dict]:
    rows, n = [], 0
    for day, count in per_day.items():
        for _ in range(count):
            n += 1
            rows.append({"proposal_id": f"{sector}-{n}", "sector": sector,
                         "dateOfSubmission": f"{day} 10:00:00.0"})
    return rows


def test_windows_cover_every_day() -> None:
    print("\na sector is read in windows that leave no day out")
    name = "Non-Coal Mining"
    per_day = {f"2024-01-{d:02}": 900 for d in range(1, 11)}
    windows = SY.plan_windows(_rows(name, per_day) + _rows("INFRA-1", {"2024-01-01": 5}),
                              name, "2024-02-01")
    check("windows hold about WINDOW_ROWS each",
          len(windows) == 4 and all(h >= SY.WINDOW_ROWS for _, _, h in windows[:-1]),
          str(windows))
    check("the first opens before the register and the last runs past today",
          windows[0][0] == SY.WINDOW_FLOOR and windows[-1][1] == "2024-02-03",
          str(windows))
    check("each window starts on the day the one before it ends",
          all(a[1] == b[0] for a, b in zip(windows, windows[1:])), str(windows))
    check("only this sector's rows place the edges",
          sum(h for _, _, h in windows) == 9000, str(windows))
    check("a sector with no previous rows is one unfiltered call",
          SY.plan_windows([], name, "2024-02-01") == [(None, None, 0)])
    check("a small sector is one unfiltered call",
          SY.plan_windows(_rows(name, {"2024-01-01": 30}), name, "2024-02-01")
          == [(None, None, 30)])


def test_windowed_sector_is_checked_whole() -> None:
    print("\na windowed sector is read, retried and checked window by window")
    import json
    name = SY.SECTORS[3]
    previous = _rows(name, {f"2024-01-{d:02}": 900 for d in range(1, 11)})
    answers: dict = {}
    calls: list[str] = []
    fail_once = {"2024-01-04"}

    def fake_fetch(url: str, **_) -> bytes:
        if "sector=3" not in url:
            return b'{"status": 200, "data": []}'
        start = url.split("startDate=")[1].split("&")[0]
        calls.append(start)
        if start in fail_once:
            fail_once.discard(start)
            raise RuntimeError("register fetch failed after retries: HTTP -1 refused")
        return json.dumps({"status": 200, "data": answers.get(start, [])}).encode()

    saved = (SY.fetch, SY.log, SY.PARIVESH_SEARCH)
    try:
        SY.fetch, SY.log = fake_fetch, (lambda *_: None)
        SY.PARIVESH_SEARCH = "https://x/?sector={sector}"
        windows = SY.plan_windows(previous, name, "2024-02-01")
        for start, end, _ in windows:
            # every window also returns its shared edge day's rows
            answers[start] = [r for r in previous
                              if start <= r["dateOfSubmission"][:10] <= end]
        records, stats = SY.fetch_delta(None, previous=previous,
                                        last_counts={name: 9000})
        check("a window that failed once is asked again, alone",
              calls.count("2024-01-04") == 2 and len(calls) == len(windows) + 1,
              str(calls))
        check("rows on a shared edge day are counted once",
              stats[name] == {"records": 9000, "windows": len(windows)}
              and len([r for r in records if r["sector"] == name]) == 9000,
              str(stats[name]))

        answers[windows[1][0]] = []
        _, stats = SY.fetch_delta(None, previous=previous)
        check("a window answering empty where rows were held fails its sector",
              "error" in stats[name] and "no rows where" in stats[name]["error"],
              str(stats[name]))

        answers[windows[1][0]] = answers[windows[0][0]][:1]
        _, stats = SY.fetch_delta(None, previous=previous,
                                  last_counts={name: 9000})
        check("windows short of the last good read fail their sector",
              "error" in stats[name] and "9,000" in stats[name]["error"],
              str(stats[name]))
    finally:
        SY.fetch, SY.log, SY.PARIVESH_SEARCH = saved


def test_pass_plan() -> None:
    print("\nevery source gets its own share of the budget")
    names = [(n, p) for n, p, _ in SY.PASS_PLAN]
    check("both changed passes run before either bulk pass",
          names.index(("history", "changed")) < names.index(("caf", "new")))
    caf_new = [sh for n, p, sh in SY.PASS_PLAN if (n, p) == ("caf", "new")][0]
    check("the CAF bulk pass cannot take the whole remaining budget",
          caf_new < 1.0, f"share {caf_new}")
    check("the history bulk pass comes after the CAF bulk pass, with a share",
          names.index(("history", "new")) > names.index(("caf", "new")))
    check("the reserve covers a rebuild with margin (>= 10 minutes)",
          SY.REBUILD_RESERVE_S >= 600)


def test_parallel_merge_and_exit(tmp: Path) -> None:
    print("\nsharded fetches merge whole lines and report faults as faults")
    import fetch_parallel as FP
    caf = tmp / "caf"
    caf.mkdir(parents=True)
    # The main file was cut mid-line, and a shard was killed mid-line.
    (caf / "caf_extract.jsonl").write_bytes(b'{"id":1}\n{"id":2,"x')
    (caf / "caf_extract.shard0.jsonl").write_bytes(b'{"id":3}\n{"id":4}\n{"id":5,')
    forms, _ = FP.merge(tmp)
    lines = (caf / "caf_extract.jsonl").read_bytes().splitlines()
    check("no merged record is glued to a cut line",
          lines == [b'{"id":1}', b'{"id":3}', b'{"id":4}'], str(lines))
    check("the shard file is consumed", not (caf / "caf_extract.shard0.jsonl").exists())
    check("a crashed shard is a fault, not 'out of time'", FP.exit_code([3, 1, 3]) == 2)
    check("all out of time is out of time", FP.exit_code([3, 0, 3]) == 3)
    check("all finished is success", FP.exit_code([0, 0]) == 0)


def test_lock(tmp: Path) -> None:
    print("\none run against PARIVESH at a time")
    import json
    import os
    import subprocess
    import run_lock as RL
    lock = tmp / "parivesh.lock"
    saved = os.environ.pop(RL.ENV, None)
    try:
        check("the first run takes the lock", RL.acquire("a", lock))
        # A live process that is not our parent holds it: a child started
        # without the inherited marker must be refused.
        env = {k: v for k, v in os.environ.items() if k != RL.ENV}
        code = subprocess.run(
            [sys.executable, "-c",
             "import sys; sys.path.insert(0, r'%s'); import run_lock as RL; "
             "from pathlib import Path; "
             "sys.exit(0 if RL.acquire('b', Path(r'%s')) else 7)"
             % (Path(__file__).resolve().parent, lock)],
            env=env).returncode
        check("a second, unrelated run is refused", code == 7, f"exit {code}")
        env[RL.ENV] = str(os.getpid())
        code = subprocess.run(
            [sys.executable, "-c",
             "import sys; sys.path.insert(0, r'%s'); import run_lock as RL; "
             "from pathlib import Path; "
             "sys.exit(0 if RL.acquire('child', Path(r'%s')) else 7)"
             % (Path(__file__).resolve().parent, lock)],
            env=env).returncode
        check("a process the holder started may run", code == 0, f"exit {code}")
        RL.release(lock)
        check("release removes the lock", not lock.exists())
        # A lock left by a process that is gone is stale.
        lock.write_text(json.dumps({"pid": 2 ** 22 + 12345, "name": "dead"}),
                        encoding="utf-8")
        check("a stale lock from a dead process is cleared",
              RL.acquire("c", lock))
        RL.release(lock)
        check("the liveness probe does not report a dead pid alive",
              not RL.pid_alive(2 ** 22 + 12345))
        check("the liveness probe sees this process", RL.pid_alive(os.getpid()))
        # Two starters judging one stale lock: the OS lock admits one.
        lock.write_text(json.dumps({"pid": 2 ** 22 + 12345, "name": "dead"}),
                        encoding="utf-8")
        check("one starter clears a stale lock", RL.acquire("d", lock))
        code = subprocess.run(
            [sys.executable, "-c",
             "import sys; sys.path.insert(0, r'%s'); import run_lock as RL; "
             "from pathlib import Path; "
             "sys.exit(0 if RL.acquire('e', Path(r'%s')) else 7)"
             % (Path(__file__).resolve().parent, lock)],
            env={k: v for k, v in os.environ.items() if k != RL.ENV}).returncode
        check("a second starter is refused while the first holds it",
              code == 7, f"exit {code}")
        RL.release(lock)
        # A run started before the OS lock existed holds only the JSON file.
        os.environ.pop(RL.ENV, None)
        holder_proc = subprocess.Popen([sys.executable, "-c",
                                        "import time; time.sleep(30)"])
        try:
            lock.write_text(json.dumps({"pid": holder_proc.pid, "name": "old"}),
                            encoding="utf-8")
            check("a live holder named only in the JSON file is still honoured",
                  not RL.acquire("f", lock))
            # Its child, inheriting the lock, stops itself when it dies.
            env = {k: v for k, v in os.environ.items() if k != RL.ENV}
            env[RL.ENV] = str(holder_proc.pid)
            child = subprocess.Popen(
                [sys.executable, "-c",
                 "import sys, time; sys.path.insert(0, r'%s'); import run_lock as RL; "
                 "from pathlib import Path; "
                 "ok = RL.acquire('child', Path(r'%s')); RL.watch_holder; "
                 "time.sleep(40); sys.exit(0 if ok else 7)"
                 % (Path(__file__).resolve().parent, lock)], env=env)
            time.sleep(3)
            holder_proc.kill()
            holder_proc.wait()
            try:
                code = child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                child.kill()
                code = None
            check("an inheriting child exits when its holder is killed",
                  code == 2, f"exit {code}")
        finally:
            holder_proc.kill()
            lock.unlink(missing_ok=True)
    finally:
        os.environ.pop(RL.ENV, None)
        if saved is not None:
            os.environ[RL.ENV] = saved


def test_seed(tmp: Path) -> None:
    print("\nthe cache seed carries only what it is allowed to, and survives nothing else")
    import json
    import os
    import tarfile
    import cache_seed as CS

    cache = tmp / "cache"
    (cache / "caf").mkdir(parents=True)
    (cache / "history").mkdir(parents=True)
    with open(cache / "caf" / "caf_extract.jsonl", "w", encoding="utf-8") as f:
        # Two versions of one record: the later, higher one must win.
        f.write(json.dumps({"id": 1, "v": 2, "mainDistrict": 1, "plots": []}) + "\n")
        f.write(json.dumps({"id": 1, "v": 3, "mainDistrict": 2, "plots": [
            {"vc": "000001", "dc": "1", "officer": "x"}],
            "remarks": "call 9876543210"}) + "\n")
    with open(cache / "caf" / "caf_errors.jsonl", "w", encoding="utf-8") as f:
        f.write(json.dumps({"id": 5, "status": 500, "body": "x"}) + "\n")
        f.write(json.dumps({"id": 6, "status": -1, "body": "no route available"}) + "\n")
    with open(cache / "history" / "history.jsonl", "w", encoding="utf-8") as f:
        f.write(json.dumps({"id": 1, "steps": [{"a": 1, "s": "x", "officer": "y"}]}) + "\n")
    (cache / "lgd").mkdir()
    (cache / "lgd" / "getdistricts.json").write_text('{"data": [{"code": 1}]}', encoding="utf-8")
    (cache / "parivesh" / "forest").mkdir(parents=True)
    (cache / "parivesh" / "all_records.json").write_text(json.dumps([
        {"proposal_id": 10, "proposalStatus": "A", "moefccFileNumber": "a@b.com"},
        {"proposal_id": 11, "proposalStatus": "B"}]), encoding="utf-8")
    for code in (1, 2):
        (cache / "parivesh" / "forest" / f"state_{code}.json").write_text(json.dumps(
            {"data": [{"proposal_id": 100 + code, "nameOfUserAgency": "X@Y.GOV.IN"}]}),
            encoding="utf-8")
    (cache / "parivesh" / "forest_meta.json").write_text(json.dumps(
        {"read_at": "2026-01-01", "complete": True, "codes_read": 2,
         "codes": {"1": "2026-01-01", "2": "2026-01-02"}, "failed": []}), encoding="utf-8")

    old = os.environ.get("INSTRUMENTS_CACHE_DIR")
    os.environ["INSTRUMENTS_CACHE_DIR"] = str(cache)
    try:
        seed = tmp / "seed.tar.gz"
        CS.pack(seed)
        check("a packed seed verifies", CS.verify(seed) == [], str(CS.verify(seed)))
        _, files = CS._read(seed)
        caf = [json.loads(x) for x in files["caf/caf_extract.jsonl"].splitlines()]
        check("one record per proposal, the latest version",
              len(caf) == 1 and caf[0]["v"] == 3 and caf[0]["mainDistrict"] == 2)
        check("fields outside the whitelist are stripped",
              "remarks" not in caf[0] and "officer" not in caf[0]["plots"][0])
        steps = json.loads(files["history/history.jsonl"])["steps"]
        check("history steps carry no officer field", "officer" not in steps[0])
        errs = [json.loads(x) for x in files["caf/caf_errors.jsonl"].splitlines()]
        check("only settled 500s travel; our own transport failures stay owed",
              [e["id"] for e in errs] == [5])

        # Tamper: rewrite one member without updating the manifest.
        bad = tmp / "bad.tar.gz"
        with tarfile.open(seed, "r:gz") as src, tarfile.open(bad, "w:gz") as dst:
            for m in src.getmembers():
                data = src.extractfile(m).read()
                if m.name == "caf/caf_extract.jsonl":
                    data = data.replace(b'"mainDistrict":2', b'"mainDistrict":9')
                m.size = len(data)
                import io
                dst.addfile(m, io.BytesIO(data))
        check("a tampered seed is refused", bool(CS.verify(bad)))

        # A nested field outside its whitelist, with a manifest that agrees -
        # i.e. a seed built by a packer that forgot to clean. The top-level
        # check alone passed this.
        def repack(mutate, out):
            import hashlib
            import io
            manifest, fl = CS._read(seed)
            fl = {k: mutate(k, v) for k, v in fl.items()}
            for k, v in fl.items():
                manifest["files"][k] = {"sha256": hashlib.sha256(v).hexdigest(),
                                        "lines": v.count(b"\n")}
            with tarfile.open(out, "w:gz") as dst:
                for k, v in {**fl, "manifest.json": json.dumps(manifest).encode()}.items():
                    info = tarfile.TarInfo(k)
                    info.size = len(v)
                    dst.addfile(info, io.BytesIO(v))
            return out
        nested = repack(lambda k, v: v.replace(b'"vc":"000001"',
                                               b'"vc":"000001","officer":"x"')
                        if k == "caf/caf_extract.jsonl" else v, tmp / "nested.tar.gz")
        check("a nested field outside its whitelist is refused",
              any("nested" in q for q in CS.verify(nested)), str(CS.verify(nested)))
        phone = repack(lambda k, v: v.replace(b'"mainDistrict":2',
                                              b'"mainDistrict":2,"proposalNo":"Mob: 98765 43210"')
                       if k == "caf/caf_extract.jsonl" else v, tmp / "phone.tar.gz")
        check("a labelled phone number with a separator is refused",
              any("contact" in q for q in CS.verify(phone)), str(CS.verify(phone)))

        # Unpack MERGES under a warm cache: what the cache read wins, and
        # only proposals it lacks come from the seed.
        target = cache / "caf" / "caf_extract.jsonl"
        target.write_text(json.dumps({"id": 1, "v": 4, "mainDistrict": 7}) + "\n",
                          encoding="utf-8")
        added = CS.unpack(seed)
        lines = [json.loads(x) for x in target.read_text(encoding="utf-8").splitlines()]
        last = {}
        for r in lines:
            last[r["id"]] = r
        check("a seed never replaces a proposal the cache has read since",
              last[1]["v"] == 4 and last[1]["mainDistrict"] == 7
              and added["caf/caf_extract.jsonl"] == 0, str(lines))
        target.write_text(json.dumps({"id": 2, "v": 4}) + "\n", encoding="utf-8")
        CS.unpack(seed)
        ids = [json.loads(x)["id"] for x in target.read_text(encoding="utf-8").splitlines()]
        check("a proposal the cache lacks is taken from the seed, below its own reads",
              ids == [1, 2], str(ids))

        # The PARIVESH-only sources, for a runner PARIVESH refuses.
        _, files = CS._read(seed)
        check("the seed carries the register, the LGD reference and each forest State",
              {"parivesh/all_records.json", "lgd/getdistricts.json",
               "parivesh/forest/state_1.json", "parivesh/forest_meta.json"} <= set(files))
        check("contact details in the raw register are scrubbed on the way in",
              b"a@b.com" not in files["parivesh/all_records.json"]
              and b"X@Y.GOV.IN" not in files["parivesh/forest/state_2.json"])
        leak = repack(lambda k, v: v.replace(b'"B"', b'"c@d.com"')
                      if k == "parivesh/all_records.json" else v, tmp / "leak.tar.gz")
        check("a source whose bytes no longer match the manifest is refused",
              bool(CS.verify(leak)), str(CS.verify(leak)))

        # A cold-ish runner: part of the register read tonight, one forest
        # State, no LGD. The seed fills the gaps and overrides nothing read.
        reg = cache / "parivesh" / "all_records.json"
        reg.write_text(json.dumps([{"proposal_id": 11, "proposalStatus": "moved"}]),
                       encoding="utf-8")
        (cache / "lgd" / "getdistricts.json").unlink()
        (cache / "parivesh" / "forest" / "state_2.json").unlink()
        (cache / "parivesh" / "forest_meta.json").write_text(json.dumps(
            {"read_at": "2026-02-01", "complete": False, "codes_read": 1,
             "codes": {"1": "2026-02-01"}, "failed": [2]}), encoding="utf-8")
        CS.unpack(seed)
        listed = json.loads(reg.read_text(encoding="utf-8"))
        rows = {r["proposal_id"]: r for r in listed}
        check("register rows the cache lacks come from the seed; tonight's read wins",
              len(listed) == 2 and set(rows) == {10, 11}
              and rows[11]["proposalStatus"] == "moved", str(listed))
        check("a missing LGD reference is restored",
              (cache / "lgd" / "getdistricts.json").is_file())
        meta = json.loads((cache / "parivesh" / "forest_meta.json").read_text(encoding="utf-8"))
        check("a forest State taken from the seed keeps the seed's read date",
              meta["codes"] == {"1": "2026-02-01", "2": "2026-01-02"} and meta["failed"] == [],
              str(meta))
        forest = json.loads((cache / "parivesh" / "forest_records.json").read_text(encoding="utf-8"))
        check("the forest records are re-merged from every State held",
              sorted(r["proposal_id"] for r in forest) == [101, 102])
    finally:
        if old is None:
            os.environ.pop("INSTRUMENTS_CACHE_DIR", None)
        else:
            os.environ["INSTRUMENTS_CACHE_DIR"] = old


def test_link_silences() -> None:
    print("\nan unread form, a blank one and one that answers none are three things")
    import links as LK
    from forest_numbers import fp_numbers
    base = {"v": 4, "land": {}}
    blank = {"fc": {}, "nbwl": {}, "esz": None, "protected_area": None,
             "crz": None, "tenure": []}
    no = {"fc": {"involved": False}, "nbwl": {"required": False}, "esz": False,
          "protected_area": False, "crz": False, "tenure": []}
    check("a form read before version 4 is unread, not empty",
          LK.compact_links({"v": 3, "links": no}) is None)
    check("a form that answered every question 'no' compacts to 0",
          LK.compact_links({**base, "links": no}) == 0)
    check("a form that answered nothing is NOT 0 - it carries its blanks",
          LK.compact_links({**base, "links": blank}) == {"u": "fwepc"},
          str(LK.compact_links({**base, "links": blank})))
    mixed = {**no, "fc": {"involved": True, "proposal_no": "FP/A/1"}, "crz": None}
    got = LK.compact_links({**base, "links": mixed})
    check("a declared topic is never also listed as blank",
          isinstance(got, dict) and got.get("u") == "c" and "f" in got, str(got))
    check("forest proposal numbers are normalised and split",
          fp_numbers("FP/OR/ROAD/ 451983/2023, fp/x/1") == ["FP/OR/ROAD/451983/2023", "FP/X/1"])


def test_debts_and_streaks() -> None:
    print("\na re-read that failed stays owed; a night out of time is not a fault")
    q = {"caf": [1, 2, 3], "history": [1]}
    q2 = SY.discharge(q, "caf", consumed=True, left=[2])
    check("ids the fetcher reports unread stay queued after a completed pass",
          q2["caf"] == [2] and q2["history"] == [1], str(q2))
    check("a completed pass with nothing left clears the debt",
          SY.discharge(q, "caf", consumed=True, left=[])["caf"] == [])
    check("an out-of-time night is not a fault",
          SY.next_streak(2, [], {"caf": {"exit": 3}, "history": {"exit": 3}}) == 0)
    check("an aborted fetcher is a fault, and faults accumulate",
          SY.next_streak(2, [], {"caf": {"exit": 0}, "history": {"exit": 2}}) == 3)
    check("a failed sector is a fault", SY.next_streak(0, ["Mining"], {}) == 1)
    nothing = {"codes": 0, "failed": [{"code": c, "error": "HTTP -1 timed out"} for c in range(1, 39)]}
    check("a forest register read nowhere is a fault",
          SY.next_streak(1, [], {}, nothing) == 2)
    check("a forest register read in part is not",
          SY.next_streak(1, [], {}, {"codes": 30, "failed": [{"code": 3, "error": "x"}]}) == 0)
    check("a forest register never asked for want of time is budget, not a fault",
          SY.next_streak(1, [], {}, {"codes": 0, "failed": [{"code": 1, "error": "out of time"}]}) == 0)
    check("a skipped forest register (dry run) is not a fault",
          SY.next_streak(1, [], {}, {"skipped": True}) == 0)


def test_a_night_that_read_nothing_is_red() -> None:
    print("\na night that read no register sector fails the job that night")
    every = [f"sector {i}" for i in range(len(SY.SECTORS))]
    check("all sectors failed is an unread register", SY.register_unread(every))
    check("one sector read is not", not SY.register_unread(every[1:]))
    check("no failure is not", not SY.register_unread([]) and not SY.register_unread(None))
    reason = SY.failure_reason({"failed_sectors": every, "partial_streak": 1})
    check("the first such night fails, and says why",
          reason is not None and "not read tonight" in reason, str(reason))
    check("a partial night is still green until the streak",
          SY.failure_reason({"failed_sectors": every[:3], "partial_streak": 2}) is None)
    check("the third faulty night in a row fails",
          SY.failure_reason({"failed_sectors": every[:1],
                             "partial_streak": SY.PARTIAL_FAIL_AFTER}) is not None)
    check("a clean night is green", SY.failure_reason({"failed_sectors": [], "partial_streak": 0}) is None)
    check("an empty state (no run yet) is green", SY.failure_reason({}) is None)
    gone = SY.failure_reason({"failed_sectors": every, "partial_streak": 1,
                              "endpoint_gone": ["/parivesh_api/trackYourProposal/advanceSearchData"]})
    check("when the search path is gone the night's failure names it and the 404",
          gone is not None and "advanceSearchData" in gone and "404" in gone
          and "moved or been removed" in gone, str(gone))


def test_a_pass_out_of_time_pays_what_it_read(tmp: Path) -> None:
    print("\na changed pass that ran out of time discharges what it read")
    import fetch_caf as FC
    ids_path = tmp / "pending_caf.json"
    owed = list(range(1, 11))
    # The fetcher's own report, as it writes it just before exiting 3.
    FC.write_left(str(ids_path), owed, answered={1, 2, 3, 4})
    left = SY.changed_pass_left(ids_path)
    check("the report is read whatever the exit code", left == [5, 6, 7, 8, 9, 10], str(left))
    q = SY.discharge({"caf": owed}, "caf", consumed=left is not None, left=left)
    check("the forms read are not queued again", q["caf"] == [5, 6, 7, 8, 9, 10], str(q))
    Path(str(ids_path) + ".left").unlink()
    check("no report keeps the whole debt", SY.changed_pass_left(ids_path) is None)
    Path(str(ids_path) + ".left").write_text("[1, 2", encoding="utf-8")
    check("a torn report keeps the whole debt", SY.changed_pass_left(ids_path) is None)


def test_no_form_is_rechecked(tmp: Path) -> None:
    print("\na proposal settled as 'no form' is re-asked, unless it has a form")
    import json
    (tmp / "caf").mkdir(parents=True)
    (tmp / "caf" / "caf_errors.jsonl").write_text(
        json.dumps({"id": 1, "status": 500}) + "\n" + json.dumps({"id": 2, "status": 500}) + "\n"
        + json.dumps({"id": 3, "status": 403}) + "\n", encoding="utf-8")
    (tmp / "caf" / "caf_extract.jsonl").write_text(json.dumps({"id": 2, "v": 4}) + "\n", encoding="utf-8")
    check("only settled 500s without a form are re-asked", SY.settled_absent(tmp) == [1],
          str(SY.settled_absent(tmp)))
    names = [(n, p) for n, p, _ in SY.PASS_PLAN]
    # Behind rolling, which takes everything left, it never ran on a
    # budgeted night.
    check("the recheck runs before the rolling pass, with a share",
          ("caf", "recheck_none") in names
          and names.index(("caf", "recheck_none")) < names.index(("history", "rolling"))
          and dict(((n, p), sh) for n, p, sh in SY.PASS_PLAN)[("caf", "recheck_none")] < 1.0)
    check("running out of time re-asking never marks a night partial",
          "recheck_none" in SY.REVISIT_PASSES)
    # The history ledger settles 500s too, and nothing re-asked them:
    # terminal proposals are never re-polled, so a storm's null durations
    # would have been permanent.
    (tmp / "history").mkdir(parents=True)
    (tmp / "history" / "history_errors.jsonl").write_text(
        json.dumps({"id": 7, "status": 500}) + "\n"
        + json.dumps({"id": 8, "status": 500}) + "\n", encoding="utf-8")
    (tmp / "history" / "history.jsonl").write_text(
        json.dumps({"id": 8, "v": 1, "steps": []}) + "\n", encoding="utf-8")
    check("history ids settled as absent are re-asked too",
          SY.settled_absent(tmp, "history") == [7],
          str(SY.settled_absent(tmp, "history")))
    check("the history recheck runs before rolling",
          ("history", "recheck_none") in names
          and names.index(("history", "recheck_none"))
          < names.index(("history", "rolling")))
    # rolling re-reads cached histories and takes all the time left: as a
    # hole it marked nearly every budgeted night partial.
    check("rolling running out of time never marks a night partial",
          "rolling" in SY.REVISIT_PASSES)


SPRING_404 = (b'{"timestamp":"2026-10-27T07:00:52.678+00:00","status":404,'
              b'"error":"Not Found","path":"/p/search"}')


def test_a_path_the_origin_dropped_is_not_asked_again() -> None:
    print("\na path PARIVESH itself answers 404 for, and never 200, stops being asked")
    url = "https://x/p/search?sector=1"
    w = SY.Witness(gone_after=3)
    for _ in range(2):
        w.note(url, 404, SPRING_404)
    check("below the count it is not gone", not w.is_gone(url))
    w.note(url, 404, b"<html>404 Not Found</html>")
    check("a proxy's own 404 page is not the service's answer", not w.is_gone(url))
    w.note(url, 404, SPRING_404)
    check("the third 404 from the service itself, and no 200, is gone",
          w.is_gone(url) and w.gone_paths() == ["/p/search"], str(w.gone_paths()))
    check("the path decides, not the query", w.is_gone("https://x/p/search?sector=9"))
    check("a different path is its own", not w.is_gone("https://x/p/other"))
    w.note(url, 200, b"{}")
    check("one 200 clears it", not w.is_gone(url) and w.gone_paths() == [])

    saved = (SY.NET.get, SY.pool, SY.time.sleep, SY.log, SY.ENDPOINTS)
    sent: list[str] = []
    try:
        SY.NET.get = lambda p, u, **k: (sent.append(u), (404, SPRING_404))[1]
        SY.pool = lambda: None
        SY.time.sleep = lambda s: None
        SY.log = lambda *_: None
        SY.ENDPOINTS = SY.Witness(gone_after=2)
        try:
            SY.fetch(url)
            raised = None
        except SY.EndpointGone as exc:
            raised = exc
        check("a call stops retrying once its path is gone, and says why",
              raised is not None and len(sent) == 2 and "/p/search" in str(raised),
              f"{len(sent)} sent, {raised}")
        sent.clear()
        try:
            SY.fetch(url)
            raised = None
        except SY.EndpointGone as exc:
            raised = exc
        check("a later call to that path sends nothing", raised is not None and sent == [],
              str(sent))
        check("it is a RuntimeError, so every caller's failure handling covers it",
              issubclass(SY.EndpointGone, RuntimeError))
    finally:
        SY.NET.get, SY.pool, SY.time.sleep, SY.log, SY.ENDPOINTS = saved


def test_no_second_round_for_a_gone_path(tmp: Path) -> None:
    print("\na second round is not spent on a path that is gone")
    gone = SY.Witness(gone_after=1)
    gone.note("https://x/?sector=1", 404, SPRING_404)
    calls: list[str] = []

    def failing(url: str, timeout: int = 300, deadline=None, **_) -> bytes:
        calls.append(url)
        raise RuntimeError("register fetch failed after retries: HTTP 404")

    saved = (SY.fetch, SY.log, SY.PARIVESH_SEARCH, SY.FOREST_SEARCH,
             SY.merge_forest_states, SY.ENDPOINTS)
    logged: list[str] = []
    try:
        SY.fetch, SY.log = failing, logged.append
        SY.PARIVESH_SEARCH = "https://x/?sector={sector}"
        SY.FOREST_SEARCH = "https://x/?code={code}"
        SY.merge_forest_states = lambda cache: 0
        SY.ENDPOINTS = gone
        _, stats = SY.fetch_delta(None)
        check("each sector is asked once and not again",
              len(calls) == len(SY.SECTORS) and all("error" in s for s in stats.values()),
              str(len(calls)))
        check("the log says why there was no second round",
              any("no second round" in line and "moved or been removed" in line for line in logged))
        calls.clear()
        stats = SY.fetch_forest(tmp)
        check("each State code is asked once and not again",
              len(calls) == len(SY.LGD_STATE_CODES), str(len(calls)))
        check("a State left unasked is blamed on the path, not on time",
              {f["error"] for f in stats["failed"]} == {"search path gone"}, str(stats["failed"][:2]))
    finally:
        (SY.fetch, SY.log, SY.PARIVESH_SEARCH, SY.FOREST_SEARCH,
         SY.merge_forest_states, SY.ENDPOINTS) = saved


def main() -> int:
    import tempfile
    test_watermark()
    test_rolling_slot()
    test_reread_queue()
    with tempfile.TemporaryDirectory() as d:
        test_stamp_is_not_written_without_a_read(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_promote(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_seed(Path(d))
    test_pass_plan()
    test_sweep_fetch_waits_and_reports()
    test_failed_sector_gets_a_second_round()
    with tempfile.TemporaryDirectory() as d:
        test_failed_forest_state_gets_a_second_round(Path(d))
    test_a_path_the_origin_dropped_is_not_asked_again()
    with tempfile.TemporaryDirectory() as d:
        test_no_second_round_for_a_gone_path(Path(d))
    test_windows_cover_every_day()
    test_windowed_sector_is_checked_whole()
    test_link_silences()
    test_debts_and_streaks()
    test_a_night_that_read_nothing_is_red()
    with tempfile.TemporaryDirectory() as d:
        test_a_pass_out_of_time_pays_what_it_read(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_no_form_is_rechecked(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_parallel_merge_and_exit(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_lock(Path(d))
    print()
    if FAIL:
        print(f"{FAIL} of {PASS + FAIL} checks FAILED")
        return 1
    print(f"all {PASS} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
