"""One description of how the cached register is read.

WHY THIS EXISTS
---------------
Three programs read the register from the fetch cache - the build and both
per-proposal backfills - and they read it three different ways. The build
applies a staleness rule: `--fetch` writes `sector_<id>.json` first and merges
into `all_records.json` afterwards, so a run that died in between leaves fresh
downloads on disk beside a stale merge, and the merge must be re-made. The two
fetchers read `all_records.json` directly and got the stale one.

That is not a small difference. It decides which proposals a night's backfill
even considers: a fetcher reading a merge from before the last sweep does not
know about the proposals that sweep added, so it fetches nothing for them and
reports a clean run.
"""
from __future__ import annotations

import json
from pathlib import Path

# The sectors the register is fetched in. Kept here so a caller does not have
# to import the build to read the cache.
SECTOR_IDS = (2, 3, 4, 5, 6, 7, 8, 10, 11, 13)


def merged_is_stale(cache: Path) -> list[int]:
    """Sector files newer than the merge, if any.

    One second of slack, because a fetch writes the sectors and the merge
    within the same run and a filesystem's timestamp granularity should not
    manufacture a re-merge on every read.
    """
    combined = cache / "parivesh" / "all_records.json"
    if not combined.exists():
        return []
    merged_at = combined.stat().st_mtime
    newer = []
    for sid in SECTOR_IDS:
        p = cache / "parivesh" / f"sector_{sid}.json"
        if p.exists() and p.stat().st_mtime > merged_at + 1:
            newer.append(sid)
    return newer


def load_records(cache: Path, log=print) -> list[dict]:
    """Every register record, from whichever copy is actually current.

    Prefers the merge, unless a sector file is newer than it - in which case
    the merge predates a download and the sectors are what was fetched.
    """
    combined = cache / "parivesh" / "all_records.json"
    stale = merged_is_stale(cache)
    if combined.exists() and not stale:
        return json.loads(combined.read_text(encoding="utf-8"))

    if stale:
        log(f"  merged register is older than sector(s) {stale}; "
            f"reading what was actually downloaded")
    records: list[dict] = []
    missing = []
    for sid in SECTOR_IDS:
        p = cache / "parivesh" / f"sector_{sid}.json"
        if not p.exists():
            missing.append(sid)
            continue
        payload = json.loads(p.read_text(encoding="utf-8"))
        env = payload.get("status") if isinstance(payload, dict) else None
        if env is not None and int(env) != 200:
            missing.append(sid)
            continue
        rows = payload.get("data")
        if rows is None:
            missing.append(sid)
            continue
        records.extend(rows)
    if missing:
        raise SystemExit(
            f"ERROR: sector file(s) {missing} missing or unusable, so the "
            f"register cannot be assembled. Working from the sectors that "
            f"happen to be present would silently drop whole clearance "
            f"categories.")
    # Last wins, matching the build and the sync.
    by_pid: dict = {}
    for r in records:
        by_pid[r.get("proposal_id")] = r
    return list(by_pid.values())


def merge_forest_states(cache: Path) -> int:
    """Rebuild `forest_records.json` from the per-state copies; returns rows.

    One proposal per id, later state files winning, so a project filed in two
    states is counted once.
    """
    merged: dict = {}
    for f in sorted((cache / "parivesh" / "forest").glob("state_*.json")):
        try:
            rows = json.loads(f.read_text(encoding="utf-8")).get("data") or []
        except (OSError, ValueError):
            continue
        for r in rows:
            if r.get("proposal_id"):
                merged[r["proposal_id"]] = r
    (cache / "parivesh" / "forest_records.json").write_text(
        json.dumps(list(merged.values()), separators=(",", ":"), ensure_ascii=False),
        encoding="utf-8")
    return len(merged)
