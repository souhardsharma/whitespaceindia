"""Pack, unpack and verify the per-proposal cache the nightly sync starts from.

WHY THIS EXISTS
---------------
The register itself, SHRUG and the boundaries are fetched in a few minutes.
The per-proposal sources are not: the Common Application Form (~116,000 forms,
several seconds each) and the appraisal history (~115,000 calls). A scheduled
job that starts without them tries to read the whole register in one night,
hits the job's time limit, is killed - and a killed job saves nothing to the
Actions cache, so the next night starts from the same empty place. The loop
never bootstraps, while every gate that runs before the timeout stays green.

The seed breaks that. It is the two per-proposal caches, packed from a machine
that holds them, published once as a release asset, and unpacked by the
workflow whenever its cache is cold. Everything after that is the ordinary
nightly increment.

WHAT GOES IN, AND WHAT CANNOT
-----------------------------
  caf/caf_extract.jsonl     one line per proposal: its latest record, at the
                            highest extract version held. An older-version
                            record is KEPT - fetch_caf re-reads it on the next
                            run anyway - because dropping it is not neutral:
                            a proposal whose form was read once and whose later
                            re-read hit a 500 would then publish as "the
                            Ministry serves no form", a false statement about a
                            government body. Measured: 7 such proposals.
  caf/caf_errors.jsonl      HTTP 500 answers only - the settled "no form served"
                            ledger. Transport failures are ours, not the
                            service's, and stay owed.
  history/history.jsonl     one line per proposal, the latest.
  history/history_errors.jsonl   HTTP 500 answers only, for the same reason.

Every record is rebuilt from a WHITELIST of fields, so nothing the extractors
once captured and later dropped - officer names, remarks, contact details - can
travel in a seed even if an old line still carries it. `verify` re-reads the
archive and fails on any field outside the whitelist, any email address or
phone number in any string, a checksum that does not match the manifest, or a
count that does not.

Run from the project root:
  python scripts/instruments/cache_seed.py pack   --out seed.tar.gz
  python scripts/instruments/cache_seed.py verify seed.tar.gz
  python scripts/instruments/cache_seed.py unpack seed.tar.gz   # into $INSTRUMENTS_CACHE_DIR

`unpack` MERGES under a cache that already holds forms: it adds only the
proposals the cache has not read, before the cache's own lines, so every read
made since the seed wins. --force replaces the cache with the seed outright.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
from privacy import find_contact  # noqa: E402

try:
    from fetch_caf import EXTRACT_VERSION as CAF_VERSION  # noqa: E402
except Exception:  # noqa: BLE001
    CAF_VERSION = 3

SEED_FORMAT = 1

CAF_FIELDS = {"id", "v", "proposal_id", "proposalNo", "mainState", "mainDistrict",
              "site", "toposheets", "plots", "villages", "affected_families",
              "displaced_families", "rnr_involved", "litigation_pending",
              "violation_involved", "land", "caf_revisions", "links"}
CAF_LINK_FIELDS = {"fc", "nbwl", "esz", "protected_area", "crz", "crz_class",
                   "interlinked_no", "tenure"}
CAF_LINK_FC = {"involved", "approval_involved", "proposal_no", "status",
               "applied_ha", "diverted_ha", "approved_on"}
CAF_LINK_NBWL = {"required", "protected_area", "submitted", "proposal_no", "status"}
CAF_TENURE_FIELDS = {"type", "owner", "status"}
CAF_PLOT_FIELDS = {"dc", "sdc", "vc", "dn", "sdn", "vn"}
CAF_SITE_FIELDS = {"s", "n", "w", "e", "lat", "lon", "pts", "blocks", "dropped",
                   "untyped_skipped", "single_corner", "alt"}
CAF_LAND_FIELDS = {"existing_forest", "existing_non_forest", "existing_total",
                   "additional_forest", "additional_non_forest", "total",
                   "shape", "border_state", "intl_border_km"}
HISTORY_FIELDS = {"id", "v", "steps"}
STEP_FIELDS = {"a", "s", "sd", "ed", "cur", "m", "c"}
ERROR_FIELDS = {"id", "status", "reason"}

MEMBERS = ("caf/caf_extract.jsonl", "caf/caf_errors.jsonl",
           "history/history.jsonl", "history/history_errors.jsonl")


def log(msg: str) -> None:
    print(f"[seed] {msg}", flush=True)


def cache_dir() -> Path:
    d = os.environ.get("INSTRUMENTS_CACHE_DIR", "")
    if not d:
        sys.exit("ERROR: INSTRUMENTS_CACHE_DIR is not set.")
    return Path(d)


def _pick(d: dict, allowed: set) -> dict:
    return {k: v for k, v in d.items() if k in allowed}


def clean_caf(rec: dict) -> dict:
    out = _pick(rec, CAF_FIELDS)
    if isinstance(out.get("plots"), list):
        out["plots"] = [_pick(p, CAF_PLOT_FIELDS) for p in out["plots"]
                        if isinstance(p, dict)]
    if isinstance(out.get("site"), dict):
        out["site"] = _pick(out["site"], CAF_SITE_FIELDS)
    if isinstance(out.get("land"), dict):
        out["land"] = _pick(out["land"], CAF_LAND_FIELDS)
    if isinstance(out.get("links"), dict):
        lk = _pick(out["links"], CAF_LINK_FIELDS)
        if isinstance(lk.get("fc"), dict):
            lk["fc"] = _pick(lk["fc"], CAF_LINK_FC)
        if isinstance(lk.get("nbwl"), dict):
            lk["nbwl"] = _pick(lk["nbwl"], CAF_LINK_NBWL)
        if isinstance(lk.get("tenure"), list):
            lk["tenure"] = [_pick(t, CAF_TENURE_FIELDS) for t in lk["tenure"]
                            if isinstance(t, dict)]
        out["links"] = lk
    return out


def clean_history(rec: dict) -> dict:
    out = _pick(rec, HISTORY_FIELDS)
    out["steps"] = [_pick(s, STEP_FIELDS) for s in (rec.get("steps") or [])
                    if isinstance(s, dict)]
    return out


def latest_by_id(path: Path, version_key: str | None, want_version: int | None):
    """One record per id: the last line at the highest version seen."""
    best: dict[int, tuple[int, dict]] = {}
    dropped_old = 0
    if not path.exists():
        return {}, 0
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            rid = rec.get("id")
            if rid is None:
                continue
            ver = int(rec.get(version_key) or 1) if version_key else 1
            cur = best.get(rid)
            if cur is None or ver >= cur[0]:
                best[rid] = (ver, rec)
    out = {}
    for rid, (ver, rec) in best.items():
        if want_version is not None and ver != want_version:
            dropped_old += 1
            continue
        out[rid] = rec
    return out, dropped_old


def settled_errors(path: Path) -> list[dict]:
    """HTTP 500 answers only - the only ones that settle anything."""
    rows, seen = [], set()
    if not path.exists():
        return rows
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("status") != 500 or e.get("id") is None:
                continue
            key = (e["id"], e.get("reason"))
            # Kept per occurrence: the fetchers corroborate a 500 by seeing it
            # twice, and the build reads the ledger's lines, not a set.
            rows.append(_pick(e, ERROR_FIELDS))
            seen.add(key)
    return rows


def _jsonl(records) -> bytes:
    buf = io.StringIO()
    for r in records:
        buf.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
    return buf.getvalue().encode("utf-8")


def pack(out: Path) -> dict:
    cache = cache_dir()
    caf, _ = latest_by_id(cache / "caf" / "caf_extract.jsonl", "v", None)
    caf_old = sum(1 for r in caf.values() if int(r.get("v") or 1) != CAF_VERSION)
    hist, _ = latest_by_id(cache / "history" / "history.jsonl", "v", None)
    payload = {
        "caf/caf_extract.jsonl": _jsonl(clean_caf(r) for _, r in sorted(caf.items())),
        "caf/caf_errors.jsonl": _jsonl(settled_errors(cache / "caf" / "caf_errors.jsonl")),
        "history/history.jsonl": _jsonl(clean_history(r) for _, r in sorted(hist.items())),
        "history/history_errors.jsonl": _jsonl(
            settled_errors(cache / "history" / "history_errors.jsonl")),
    }
    manifest = {
        "format": SEED_FORMAT,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "caf_extract_version": CAF_VERSION,
        "caf_records": len(caf),
        "caf_records_at_older_version": caf_old,
        "history_records": len(hist),
        "files": {name: {"sha256": hashlib.sha256(data).hexdigest(),
                         "bytes": len(data),
                         "lines": data.count(b"\n")}
                  for name, data in payload.items()},
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(out, "w:gz", compresslevel=9) as tar:
        for name, data in [("manifest.json",
                            json.dumps(manifest, indent=1).encode("utf-8")),
                           *payload.items()]:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mtime = 0          # a deterministic archive for identical input
            tar.addfile(info, io.BytesIO(data))
    log(f"packed {len(caf):,} forms and {len(hist):,} histories into {out} "
        f"({out.stat().st_size/1e6:.1f} MB); {caf_old:,} are at an older extract "
        f"version and will be re-read by fetch_caf")
    return manifest


def _read(archive: Path) -> tuple[dict, dict[str, bytes]]:
    files: dict[str, bytes] = {}
    with tarfile.open(archive, "r:gz") as tar:
        for m in tar.getmembers():
            if not m.isfile():
                raise ValueError(f"unexpected non-file member {m.name!r}")
            if m.name != "manifest.json" and m.name not in MEMBERS:
                raise ValueError(f"unexpected member {m.name!r}")
            f = tar.extractfile(m)
            files[m.name] = f.read() if f else b""
    manifest = json.loads(files.pop("manifest.json"))
    return manifest, files


def _strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _strings(v)


def verify(archive: Path) -> list[str]:
    problems: list[str] = []
    try:
        manifest, files = _read(archive)
    except Exception as exc:  # noqa: BLE001
        return [f"unreadable archive: {exc}"]
    if manifest.get("format") != SEED_FORMAT:
        problems.append(f"format {manifest.get('format')} != {SEED_FORMAT}")
    for name in MEMBERS:
        data = files.get(name)
        want = (manifest.get("files") or {}).get(name)
        if data is None or want is None:
            problems.append(f"{name} missing")
            continue
        if hashlib.sha256(data).hexdigest() != want["sha256"]:
            problems.append(f"{name} checksum does not match the manifest")
        if data.count(b"\n") != want["lines"]:
            problems.append(f"{name} line count does not match the manifest")
    allowed = {
        "caf/caf_extract.jsonl": CAF_FIELDS,
        "history/history.jsonl": HISTORY_FIELDS,
        "caf/caf_errors.jsonl": ERROR_FIELDS,
        "history/history_errors.jsonl": ERROR_FIELDS,
    }
    # Each record must be exactly what the cleaner would make of it - so a
    # field outside a whitelist is caught at ANY depth (inside site, plots,
    # land, links, a step), not only at the top level as before.
    cleaner = {"caf/caf_extract.jsonl": clean_caf,
               "history/history.jsonl": clean_history}
    for name, fields in allowed.items():
        for n, line in enumerate((files.get(name) or b"").splitlines(), 1):
            rec = json.loads(line)
            extra = set(rec) - fields
            if extra:
                problems.append(f"{name}:{n} carries fields outside the "
                                f"whitelist: {sorted(extra)}")
                break
            if name in cleaner and cleaner[name](rec) != rec:
                problems.append(f"{name}:{n} carries a nested field outside "
                                "its whitelist")
                break
            if name.endswith("_errors.jsonl") and rec.get("status") != 500:
                problems.append(f"{name}:{n} is not a settled 500")
                break
            # The same detector the build's privacy gate uses, labelled
            # numbers with separators ("Mob: 98765 43210") included.
            if any(find_contact(text) for text in _strings(rec)):
                problems.append(f"{name}:{n} carries a contact detail")
                break
    if manifest.get("caf_records") != (files.get("caf/caf_extract.jsonl") or b"").count(b"\n"):
        problems.append("caf_records in the manifest does not match the file")
    return problems


def _ids_in(path: Path) -> set:
    ids = set()
    if not path.exists():
        return ids
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rid = json.loads(line).get("id")
            except (json.JSONDecodeError, AttributeError):
                continue
            if rid is not None:
                ids.add(rid)
    return ids


def unpack(archive: Path, force: bool = False) -> dict:
    """Merge the seed UNDER what the cache already holds.

    Only proposals the cache has not read are taken from the seed; its lines
    go BEFORE the cache's own, and every reader takes the last line per id, so
    a proposal read since the seed was made keeps its newer copy. Refusing a
    cache that held anything - as this once did - meant one night without a
    published seed read a few thousand forms and the seed was never usable
    again. --force replaces the cache with the seed outright.
    """
    cache = cache_dir()
    problems = verify(archive)
    if problems:
        for p in problems:
            log(f"REFUSED: {p}")
        sys.exit(1)
    manifest, files = _read(archive)
    added: dict = {}
    for name, data in files.items():
        dest = cache / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        if force or not dest.exists() or dest.stat().st_size == 0:
            tmp.write_bytes(data)
            added[name] = data.count(b"\n")
        else:
            have = _ids_in(dest)
            fresh = [ln for ln in data.splitlines()
                     if ln.strip() and json.loads(ln).get("id") not in have]
            added[name] = len(fresh)
            with open(tmp, "wb") as out:
                for ln in fresh:
                    out.write(ln + b"\n")
                with open(dest, "rb") as own:
                    shutil.copyfileobj(own, out)
        os.replace(tmp, dest)
    log(f"seed of {manifest['created_at'][:10]}: "
        + ", ".join(f"{k.split('/')[-1]} +{v:,}" for k, v in added.items())
        + f" into {cache}" + (" (replaced)" if force else " (merged under)"))
    return added


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pack")
    p.add_argument("--out", required=True)
    v = sub.add_parser("verify")
    v.add_argument("archive")
    u = sub.add_parser("unpack")
    u.add_argument("archive")
    u.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if args.cmd == "pack":
        out = Path(args.out)
        pack(out)
        problems = verify(out)
        if problems:
            for q in problems:
                log(f"FAILED VERIFY: {q}")
            sys.exit(1)
        log("verified")
    elif args.cmd == "verify":
        problems = verify(Path(args.archive))
        for q in problems:
            log(f"FAIL: {q}")
        if problems:
            sys.exit(1)
        log("verified")
    else:
        unpack(Path(args.archive), force=args.force)


if __name__ == "__main__":
    main()
