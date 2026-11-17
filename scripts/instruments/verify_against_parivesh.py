"""Independent check: does the published instrument say what PARIVESH says?

Runs ONLY on a GitHub runner (the owner's address is never used for PARIVESH),
through the project's proxy pool. It reuses net.py for transport and nothing
else: every interpretation below - windowing, de-duplication, field mapping,
IST dates, operative revision, block geometry - is written here from the raw
answers, so a mistake in the build cannot hide behind the same mistake here.

Part A, the whole register against every published shard on the live site:
presence both ways, and each published field against the register's own value.
A row the register changed AFTER our read is counted apart: the register is
live and our copy is a nightly snapshot, so that difference is expected.

Part B, a stratified sample of proposals, their appraisal history and their
application form read fresh: first filing and decision dates against the
history (in IST), the duration arithmetic, the site coordinates against the
form's PRIMARY blocks, and the form-read state.

Writes verify_report.json and verify_report.md to --out.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import random
import re
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import net as NET  # noqa: E402  (transport only)

SITE = "https://whitespaceindia.pages.dev"
DATA = SITE + "/data/instruments/consent"
SEARCH = "https://parivesh.nic.in/mis/trackYourProposal/advanceSearchData?majorClearanceType=1&sector={sid}"
CAF = "https://parivesh.nic.in/parivesh_api/proponentApplicant/getCafDataByProposalNo?proposal_id={rid}"
HIST = "https://parivesh.nic.in/workgroupmaster/process/getProcessHis?application_id={rid}"
PROBE = "https://parivesh.nic.in/parivesh_api/trackYourProposal/getListOfSector"
SECTORS = {2: "Industrial Projects - 1", 3: "Non-Coal Mining", 4: "Thermal Projects",
           5: "River Valley and Hydroelectric Projects", 6: "INFRA-2", 7: "Nuclear Projects",
           8: "INFRA-1", 10: "Industrial Projects - 2", 11: "Coal Mining",
           13: "Industrial Projects - 3"}
IST = timezone(timedelta(hours=5, minutes=30))


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def site_json(path: str):
    req = urllib.request.Request(f"{DATA}/{path}", headers={"user-agent": "whitespace-verify"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def slug(name: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", str(name).lower())).strip("-")


def norm(text) -> str:
    return " ".join(str(text or "").split())


# ── Part A: the register ───────────────────────────────────────────────────

def windows(today: date) -> list[tuple[str, str]]:
    """Quarter windows that SHARE their edge day, so an inclusive or exclusive
    endDate drops nothing; rows come back twice on the edge and are deduped."""
    out = [("2000-01-01", "2016-01-01")]
    d = date(2016, 1, 1)
    end = today + timedelta(days=3)
    while d < end:
        nxt = date(d.year + (d.month + 2) // 12, (d.month + 2) % 12 + 1, 1)
        out.append((d.isoformat(), min(nxt, end).isoformat()))
        d = nxt
    return out


def read_window(pool, sid: int, start: str, end: str) -> list[dict]:
    url = SEARCH.format(sid=sid) + f"&startDate={start}&endDate={end}"
    for attempt in range(6):
        status, body = NET.get(pool, url, timeout=60, attempts=1, final=frozenset())
        if status == 200:
            try:
                env = json.loads(body.decode("utf-8", "replace"))
            except ValueError:
                env = None
            if isinstance(env, dict) and env.get("status") == 200 and isinstance(env.get("data"), list):
                return env["data"]
        time.sleep(min(5 * (attempt + 1), 20))
    raise RuntimeError(f"sector {sid} {start}..{end}: no good answer (last HTTP {status})")


def read_register(pool, today: date) -> tuple[dict, dict]:
    jobs = [(sid, s, e) for sid in SECTORS for s, e in windows(today)]
    rows_by_pid: dict = {}
    dupes_differ = 0
    # Up to three rounds: a window that fails is usually a dead proxy, and is
    # asked again after the rest, with fewer requests in flight.
    for rnd, workers in ((1, 12), (2, 6), (3, 4)):
        failed = []
        with cf.ThreadPoolExecutor(workers) as ex:
            futs = {ex.submit(read_window, pool, *j): j for j in jobs}
            for n, f in enumerate(cf.as_completed(futs), 1):
                try:
                    for r in f.result():
                        pid = str(r.get("proposal_id"))
                        if pid in rows_by_pid and rows_by_pid[pid] != r:
                            dupes_differ += 1
                        rows_by_pid[pid] = r
                except Exception as exc:  # noqa: BLE001
                    failed.append((futs[f], str(exc)[:160]))
                if n % 50 == 0:
                    log(f"round {rnd}: windows {n}/{len(jobs)}, {len(rows_by_pid)} proposals")
        log(f"round {rnd}: {len(failed)} window(s) failed")
        jobs = [j for j, _ in failed]
        if not jobs:
            break
    by_sector = defaultdict(list)
    for (sid, s, e), err in failed:
        by_sector[SECTORS[sid]].append(f"{s}..{e}: {err}")
    return rows_by_pid, {"failed_windows": dict(by_sector),
                         "edge_rows_differing": dupes_differ,
                         "windows": len(SECTORS) * len(windows(today))}


def load_published() -> tuple[dict, dict]:
    index = site_json("index.json")
    fresh = site_json("freshness.json")
    rows = {}
    for s in index["states"]:
        shard = site_json(f"projects/{s}.json")
        f = {k: i for i, k in enumerate(shard["fields"])}
        for r in shard["rows"]:
            row = {k: r[i] if i < len(r) else None for k, i in f.items()}
            row["_slug"] = s
            row["_sector"] = shard["sectors"][row["sector"]]
            row["_status"] = shard["statuses"][row["status"]]
            row["_auth"] = shard["authorities"][row["auth"]] if row.get("auth") is not None else None
            row["_certPrefix"] = shard.get("certPrefix", "")
            rows[str(row["id"])] = row
    return rows, fresh


def updated_after_read(reg: dict, read_utc: datetime) -> bool:
    raw = str(reg.get("app_updated_on") or "")
    try:
        t = datetime.fromisoformat(raw.replace("Z", "+00:00")[:26])
    except ValueError:
        return False
    if t.tzinfo is None:
        t = t.replace(tzinfo=IST)  # app_updated_on is IST-local
    return t > read_utc


def part_a(reg_rows: dict, sweep: dict, pub: dict, fresh: dict) -> dict:
    read_utc = datetime.fromisoformat(fresh["checked_at"])
    failed_sectors = set(sweep["failed_windows"])
    reg_live = {p: r for p, r in reg_rows.items()
                if (r.get("proposalStatus") or "").strip() != "DELISTED_BY_SYSTEM"}
    delisted = len(reg_rows) - len(reg_live)

    missing = [p for p in reg_live if p not in pub and reg_live[p].get("sector") not in failed_sectors]
    extra = [p for p in pub if p not in reg_rows and pub[p]["_sector"] not in failed_sectors]
    extra_delisted = [p for p in pub if p in reg_rows and p not in reg_live]

    checks = {
        "state": lambda r, p: slug(r.get("state") or "unknown") == p["_slug"],
        "proposalNo": lambda r, p: (r.get("proposalNo") or None) == (p["no"] or None),
        "sector": lambda r, p: (r.get("sector") or "") == p["_sector"],
        "category": lambda r, p: r.get("category") == p["cat"],
        "status (raw text)": lambda r, p: (r.get("proposalStatus") or "").strip() == p["_status"],
        "submission date": lambda r, p: (r.get("dateOfSubmission") or "")[:10] == p["date"],
        "last-modified date": lambda r, p: ((r.get("app_updated_on") or "")[:10] or None) == p["upd"],
        "authority": lambda r, p: (r.get("issuing_authority") or "") == (p["_auth"] or ""),
        "certificate": lambda r, p: (r.get("certificate_url") or "").replace(p["_certPrefix"], "", 1) == (p["cert"] or ""),
        "record id": lambda r, p: r.get("id") == p["rid"],
        "project name": lambda r, p: norm(r.get("projectName")) == norm(p["name"]) or "[contact detail removed]" in str(p["name"]),
        "proponent": lambda r, p: norm(r.get("nameOfUserAgency")) == norm(p["agency"]) or "[contact detail removed]" in str(p["agency"]),
    }
    real, moved = Counter(), Counter()
    examples = defaultdict(list)
    for pid, p in pub.items():
        r = reg_live.get(pid)
        if r is None:
            continue
        after = updated_after_read(r, read_utc)
        for name, ok in checks.items():
            if ok(r, p):
                continue
            (moved if after else real)[name] += 1
            if not after and len(examples[name]) < 8:
                examples[name].append({"id": pid, "register": _field(r, name), "published": _pub(p, name),
                                       "register_updated": r.get("app_updated_on")})
    return {
        "register_rows": len(reg_rows), "register_delisted_excluded": delisted,
        "register_live": len(reg_live), "published_rows": len(pub),
        "read_at": fresh["checked_at"], "sweep": sweep,
        "missing_from_published": len(missing),
        "missing_examples": [{"id": p, "status": reg_live[p].get("proposalStatus"), "sector": reg_live[p].get("sector"),
                              "state": reg_live[p].get("state"), "submitted": reg_live[p].get("dateOfSubmission"),
                              "updated": reg_live[p].get("app_updated_on")} for p in missing[:25]],
        "missing_submitted_after_read": sum(1 for p in missing if updated_after_read(reg_live[p], read_utc)),
        "published_not_in_register": len(extra), "published_not_in_register_examples": extra[:25],
        "published_but_now_delisted": len(extra_delisted),
        "field_mismatch_real": dict(real), "field_mismatch_after_read": dict(moved),
        "field_examples": dict(examples),
    }


def _field(r, name):
    m = {"state": "state", "proposalNo": "proposalNo", "sector": "sector", "category": "category",
         "status (raw text)": "proposalStatus", "submission date": "dateOfSubmission",
         "last-modified date": "app_updated_on", "authority": "issuing_authority", "certificate": "certificate_url",
         "record id": "id", "project name": "projectName", "proponent": "nameOfUserAgency"}
    return r.get(m[name])


def _pub(p, name):
    m = {"state": "_slug", "proposalNo": "no", "sector": "_sector", "category": "cat", "status (raw text)": "_status",
         "submission date": "date", "last-modified date": "upd", "authority": "_auth", "certificate": "cert",
         "record id": "rid", "project name": "name", "proponent": "agency"}
    return p.get(m[name])


# ── Part B: the per-proposal sources ──────────────────────────────────────

def post(pool, url: str, data: bytes) -> tuple[int, object]:
    for _ in range(4):
        status, body = NET.get(pool, url, data=data, method="POST", timeout=60, attempts=2)
        if body in NET.NOT_SENT:
            time.sleep(5)
            continue
        if status == 200:
            try:
                return 200, json.loads(body.decode("utf-8", "replace"))
            except ValueError:
                return 200, None
        if status == 500:
            return 500, None
        time.sleep(5)
    return status, None


def ist_day(value) -> str | None:
    if not value:
        return None
    try:
        t = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)  # labelled +00:00 at source, really UTC
    return t.astimezone(IST).date().isoformat()


DECISION_WORDS = re.compile(r"grant|reject|accord|issued|closed|return|withdraw|transfer|delist|approv|denied|disposed", re.I)


def check_history(p: dict, env) -> list[str]:
    issues = []
    if not isinstance(env, dict) or env.get("status") != 200 or not isinstance(env.get("data"), list):
        return ["history: no usable answer"]
    steps = env["data"]
    if not steps:
        if p.get("fon"):
            issues.append(f"history empty at source but published fon {p['fon']}")
        return issues
    days = sorted(d for s in steps for d in (ist_day(s.get("start_date")), ist_day(s.get("end_date"))) if d)
    ends = {ist_day(s.get("end_date")): (s.get("status") or "") for s in steps if s.get("end_date")}
    if p.get("fon") and days and p["fon"] != days[0]:
        issues.append(f"fon {p['fon']} is not the history's earliest IST date {days[0]}")
    if p.get("don"):
        if p["don"] not in ends:
            issues.append(f"don {p['don']} matches no step's IST end date")
        elif not DECISION_WORDS.search(ends[p["don"]]):
            issues.append(f"don {p['don']} falls on step '{ends[p['don']]}', not a decision-like step")
    if p.get("fon") and p.get("don") and p.get("dtd") is not None:
        got = date.fromisoformat(p["fon"]) + timedelta(days=int(p["dtd"]) + int(p.get("dsu") or 0))
        if got.isoformat() != p["don"]:
            issues.append(f"fon+dtd+dsu = {got} but don = {p['don']}")
    if p.get("don") and p.get("fon") and p["don"] < p["fon"]:
        issues.append("decision before first filing")
    return issues


def corners(k: dict):
    out = []
    for key in ("ne_extend", "sw_extend"):
        v = k.get(key)
        if isinstance(v, str) and "," in v:
            a, _, b = v.partition(",")
            try:
                lat, lon = float(a), float(b)
            except ValueError:
                continue
            if 6 <= lat <= 38 and 68 <= lon <= 98:
                out.append((lat, lon))
    return out


def check_form(p: dict, status: int, env) -> tuple[list[str], dict]:
    issues, facts = [], {}
    if status == 500:
        facts["form"] = "absent (500)"
        if p.get("cf") == "ok":
            issues.append("form: source answers 500 now, published cf=ok (may be the server's load 500)")
        return issues, facts
    if not isinstance(env, dict) or env.get("status") != 200 or not isinstance(env.get("data"), dict):
        facts["form"] = f"no usable answer ({status})"
        return issues, facts
    pdd = ((env["data"].get("proponentApplications") or {}).get("projectDetailDto") or {})
    revs = [c for c in (pdd.get("commonFormDetails") or []) if isinstance(c, dict)]
    submitted = [c for c in revs if str(c.get("caf_status") or "").upper() != "DRAFT"] or revs
    op = max(submitted, key=lambda c: c.get("id") or 0) if submitted else None
    facts["form"] = "read"
    facts["revisions"] = len(revs)
    if p.get("cf") in (None, "pend"):
        facts["published_cf"] = p.get("cf")
    if op is None:
        if p.get("lat") is not None:
            issues.append("published coordinates but the form has no revision")
        return issues, facts
    blocks = list(op.get("cafKML") or [])
    primary = [k for k in blocks if str(k.get("type") or "").strip().upper() == "PRIMARY"]
    use = primary or blocks
    boxes = []
    for k in use:
        c = corners(k)
        if c:
            boxes.append((min(x[0] for x in c), max(x[0] for x in c), min(x[1] for x in c), max(x[1] for x in c)))
    facts["blocks"] = len(blocks)
    facts["primary"] = len(primary)
    lat, lon = p.get("lat"), p.get("lon")
    if lat is not None:
        tol = 2e-4
        if not any(s - tol <= lat <= n + tol and w - tol <= lon <= e + tol for s, n, w, e in boxes):
            issues.append(f"published point {lat},{lon} is in none of the form's {'PRIMARY' if primary else 'filed'} blocks ({len(boxes)})")
        if not primary and blocks and "alt" not in str(p.get("sq") or ""):
            issues.append("form names no PRIMARY block but the location is not flagged alt")
    elif boxes and p.get("cf") == "ok":
        issues.append(f"form has {len(boxes)} usable block(s) but nothing is published as the site")
    return issues, facts


def sample(pub: dict, n: int, seed: int) -> list[dict]:
    rnd = random.Random(seed)
    rows = [r for r in pub.values() if r.get("rid")]
    strata = {
        "decided": [r for r in rows if r.get("don")],
        "open": [r for r in rows if not r.get("don") and r.get("fon")],
        "located": [r for r in rows if r.get("lat") is not None],
        "unlocated_read": [r for r in rows if r.get("lat") is None and r.get("cf") in ("ok", "nogeo")],
        "form_none_or_pending": [r for r in rows if r.get("cf") in ("none", "pend")],
        "forwarded_after_tor": [r for r in rows if r.get("dsk")],
        "any": rows,
    }
    share = {"decided": .22, "open": .18, "located": .2, "unlocated_read": .1,
             "form_none_or_pending": .1, "forwarded_after_tor": .08, "any": .12}
    chosen = {}
    for k, frac in share.items():
        pool = strata[k]
        for r in rnd.sample(pool, min(len(pool), max(1, int(n * frac)))):
            chosen.setdefault(str(r["id"]), (k, r))
    return [{"stratum": k, **r} for k, r in chosen.values()]


def part_b(pool, pub: dict, reg_live: dict, n: int, seed: int) -> dict:
    picks = sample(pub, n, seed)
    log(f"deep sample: {len(picks)} proposals")
    results = []

    def work(p):
        hs, he = post(pool, HIST.format(rid=p["rid"]), b"{}")
        fs, fe = post(pool, CAF.format(rid=p["rid"]), b"")
        hi = check_history(p, he) if hs == 200 else [f"history: HTTP {hs}"]
        fi, facts = check_form(p, fs, fe)
        reg = reg_live.get(str(p["id"])) or {}
        return {"id": str(p["id"]), "stratum": p["stratum"], "state": p["_slug"], "status": p["_status"],
                "register_status_now": (reg.get("proposalStatus") or "").strip() or None,
                "changed_since_read": bool(reg) and (reg.get("proposalStatus") or "").strip() != p["_status"],
                "issues": hi + fi, "facts": facts}

    with cf.ThreadPoolExecutor(24) as ex:
        for i, res in enumerate(ex.map(work, picks), 1):
            results.append(res)
            if res["issues"]:
                log(f"  {res['id']} ({res['stratum']}): {'; '.join(res['issues'])[:300]}")
            if i % 25 == 0:
                log(f"deep sample {i}/{len(picks)}")
    unreachable = [r for r in results if any(x.startswith(("history: HTTP", "history: no usable")) for x in r["issues"])
                   or r["facts"].get("form", "").startswith("no usable")]
    flagged = [r for r in results if r["issues"] and r not in unreachable]
    kinds = Counter(re.sub(r"[\d.,:-]+", "#", x.split(":")[0] if x.startswith(("history", "form")) else x)[:70]
                    for r in flagged for x in r["issues"])
    return {"sampled": len(results), "unreachable": len(unreachable), "flagged": len(flagged),
            "issue_kinds": dict(kinds.most_common()), "flagged_rows": flagged[:60],
            "by_stratum": dict(Counter(r["stratum"] for r in results))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="verify-out")
    ap.add_argument("--sample", type=int, default=240)
    ap.add_argument("--seed", type=int, default=20261117)
    a = ap.parse_args()
    if os.environ.get("GITHUB_ACTIONS") != "true":
        sys.exit("refusing: PARIVESH is asked only from a GitHub runner, never the owner's address")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    pool = NET.build_pool(probe_url=PROBE)
    log(f"routes: {len(pool.routes)}")
    pub, fresh = load_published()
    log(f"published: {len(pub)} rows, register read {fresh['checked_at']}")
    reg, sweep = read_register(pool, datetime.now(IST).date())
    log(f"register: {len(reg)} proposals; failed windows: {sum(len(v) for v in sweep['failed_windows'].values())}")
    a_res = part_a(reg, sweep, pub, fresh)
    # Saved now: the per-proposal part is slow through free proxies, and a
    # run that ends early must still leave the register comparison behind.
    (out / "part_a.json").write_text(json.dumps(a_res, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    log("part A: " + json.dumps({k: a_res[k] for k in ("register_rows", "published_rows", "missing_from_published",
                                                       "missing_submitted_after_read", "published_not_in_register",
                                                       "field_mismatch_real", "field_mismatch_after_read")}))
    reg_live = {p: r for p, r in reg.items() if (r.get("proposalStatus") or "").strip() != "DELISTED_BY_SYSTEM"}
    b_res = part_b(pool, pub, reg_live, a.sample, a.seed)
    report = {"checked_at": datetime.now(timezone.utc).isoformat(), "part_a": a_res, "part_b": b_res,
              "pool": pool.stats() if hasattr(pool, "stats") else None}
    (out / "verify_report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    md = [f"## PARIVESH vs published instrument ({report['checked_at'][:16]} UTC)",
          f"Register: {a_res['register_rows']} rows ({a_res['register_delisted_excluded']} delisted, excluded by design); "
          f"published {a_res['published_rows']}; our read {a_res['read_at']}.",
          f"Failed windows: {json.dumps(sweep['failed_windows'])[:500]}",
          f"Missing from published: {a_res['missing_from_published']} (of which changed after our read: {a_res['missing_submitted_after_read']}); "
          f"published but not in register: {a_res['published_not_in_register']}; published but now delisted: {a_res['published_but_now_delisted']}.",
          f"Field mismatches NOT explained by a later change: {json.dumps(a_res['field_mismatch_real'])}",
          f"Field mismatches on rows changed after our read: {json.dumps(a_res['field_mismatch_after_read'])}",
          f"Deep sample: {b_res['sampled']} read, {b_res['unreachable']} unreachable, {b_res['flagged']} flagged; kinds {json.dumps(b_res['issue_kinds'])}"]
    (out / "verify_report.md").write_text("\n\n".join(md) + "\n", encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write("\n\n".join(md) + "\n")
    print("\n\n".join(md))


if __name__ == "__main__":
    main()
