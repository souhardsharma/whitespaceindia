"""Independently test the district resolution against the signed clearance letter.

WHY THIS MATTERS
----------------
The instrument's central claim is that it knows where each project is. That
comes from one source: the district, sub-district and village the proponent
entered on their Common Application Form. Everything else - the population
profile, the Scheduled Area status, the obligations - hangs off it.

Trusting a single source for a load-bearing claim is exactly what this
instrument tells its readers not to do. So this script tests the claim against
a DIFFERENT document: the signed environmental clearance letter, a PDF issued
by the regulator rather than filled in by the applicant. Those letters state the
site in prose, typically in the subject line or opening paragraph.

If the two agree, the location is corroborated by an independent document. If
they disagree, that is a finding and belongs in the verification report, not
hidden.

METHOD, AND ITS ONE REAL TRAP
-----------------------------
Clearance letters open with an addressee block containing the applicant's
REGISTERED OFFICE, which is frequently a metro hundreds of kilometres from the
site. Scanning the whole document finds that address and matches it confidently.
The addressee block is therefore stripped before scanning: everything between a
line that is just "To" and the "Sir/Madam" salutation is discarded.

The scan is state-constrained. Only districts of the proposal's own state are
candidates, so "Balrampur" cannot resolve to Uttar Pradesh for a Chhattisgarh
project.

Run from the project root:
  python scripts/instruments/crosscheck_location.py --sample 250
Writes scripts/instruments/crosscheck_report.json
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent.parent
PUBLISHED = ROOT / "public" / "data" / "instruments" / "consent"

sys.path.insert(0, str(SCRIPTS))
from district_resolution import Gazetteer, normalize_name  # noqa: E402
import net as NET  # noqa: E402
import run_lock  # noqa: E402

# Every outcome check() can return. The report publishes each one, zero
# included: the methodology page reads them by name, and a key that a
# sample happened not to hit broke the site's type check.
OUTCOMES = ("agree", "disagree", "no-district-in-letter", "no-location-text",
            "download-failed", "unreadable", "no-text-layer")

MIN_STOPPED_SAMPLE = 50

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")

ADDRESSEE = re.compile(r"^\s*To[,.]?\s*$", re.IGNORECASE | re.MULTILINE)
SALUTATION = re.compile(r"\b(Sir|Madam|Dear)\b", re.IGNORECASE)

# Words that actually introduce the PROJECT's location. A district name only
# counts as the site if it appears close to one of these.
LOCATION_CUE = re.compile(
    r"\b(village|vill|gram|tehsil|tahsil|taluka|taluk|mandal|block|district|"
    r"distt|dist|situated|located|site|khasra|survey\s*no|khata)\b",
    re.IGNORECASE,
)

# The window, in characters, either side of a cue within which a district name
# is treated as describing the site.
CUE_WINDOW = 240


def strip_addressee(text: str) -> tuple[str, bool]:
    """Remove the applicant's registered-office block. Returns (text, found)."""
    m = ADDRESSEE.search(text)
    if not m:
        return text, False
    sal = SALUTATION.search(text, m.end())
    if not sal:
        return text, False
    return text[: m.start()] + text[sal.end():], True


def location_regions(text: str) -> str:
    """Keep only the parts of the letter that actually describe a location.

    THE BIAS THIS CORRECTS. An earlier version of this check scanned the whole
    letter and reported 87.3% agreement. Reading the disagreements showed the
    pattern immediately: Gujarat proposals "disagreed" by naming Gandhinagar,
    Karnataka ones Bangalore, Tamil Nadu ones Chennai, West Bengal ones Kolkata.
    Those are the seats of the State Environment Impact Assessment Authorities
    that ISSUE the letters. The letterhead and signature block carry the
    regulator's own address, and stripping the applicant's addressee block does
    nothing about them.

    So the check was measuring the regulator's postal address, not the project
    site, and was understating agreement. Restricting the scan to text near a
    location cue removes the letterhead and signature block without needing to
    know where on the page they sit.
    """
    spans: list[tuple[int, int]] = []
    for m in LOCATION_CUE.finditer(text):
        spans.append((max(0, m.start() - CUE_WINDOW), min(len(text), m.end() + CUE_WINDOW)))
    if not spans:
        return ""
    spans.sort()
    merged = [spans[0]]
    for s, e in spans[1:]:
        if s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return " ".join(text[s:e] for s, e in merged)


_POOL = None


def pool():
    """The same egress every other fetcher uses.

    This ran on its own before: a dozen concurrent urlopen() calls straight at
    parivesh.nic.in, with no pacing, no route health, no circuit breaker and no
    connect-refusal detection - fired in the scheduled job immediately after
    the sync had finished talking to the same host. That is the precise
    behaviour that got this project refused at the TCP layer for nine hours,
    and because the step is continue-on-error it could cause the block and
    still report success. Every request out of this process now goes through
    net.py, so it shares the pace, the routes and the breaker.
    """
    global _POOL
    if _POOL is None:
        _POOL = NET.build_pool(max_workers=8)
    return _POOL


def download(url: str, dest: Path, timeout: int = 90,
             deadline: float | None = None) -> str | None:
    status, data = NET.get(pool(), url, timeout=timeout, attempts=3,
                           deadline=deadline)
    if status != 200:
        return f"http-{status}" if status > 0 else "transport"
    if not data.startswith(b"%PDF"):
        return "not-a-pdf"
    dest.write_bytes(data)
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sample", type=int, default=250)
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--cache", default="", help="directory for downloaded PDFs")
    ap.add_argument("--budget-minutes", type=float, default=0,
                    help=("stop starting letters after this long and report on "
                          "those read; 0 for no limit"))
    args = ap.parse_args()
    run_lock.hold_or_exit("crosscheck_location")  # one run against PARIVESH at a time

    try:
        import pdfplumber
    except ImportError:
        sys.exit("ERROR: pdfplumber is required. pip install pdfplumber")

    import os
    cache = Path(args.cache or os.environ.get("INSTRUMENTS_CACHE_DIR", ""))
    if not cache.name:
        sys.exit("ERROR: set INSTRUMENTS_CACHE_DIR or pass --cache")
    pdf_dir = cache / "crosscheck_pdfs"
    pdf_dir.mkdir(parents=True, exist_ok=True)

    gaz = Gazetteer(cache / "geo" / "2011_Dist.dbf")
    by_state: dict[str, dict[str, int]] = {}
    for r in gaz.rows:
        by_state.setdefault(normalize_name(r["ST_NM"]), {})[
            normalize_name(r["DISTRICT"])] = int(r["censuscode"])

    # Only proposals the instrument claims to have located AND that have a
    # certificate to check against. Anything else cannot be cross-checked.
    candidates = []
    for shard_path in sorted((PUBLISHED / "projects").glob("*.json")):
        shard = json.loads(shard_path.read_text(encoding="utf-8"))
        F = {n: i for i, n in enumerate(shard["fields"])}
        for row in shard["rows"]:
            if row[F["dc"]] is None or not row[F["cert"]]:
                continue
            candidates.append({
                "id": row[F["id"]],
                "no": row[F["no"]],
                "cert": shard["certPrefix"] + row[F["cert"]],
                "claimed": row[F["dc"]],
                "method": row[F["dm"]],
                "state": shard["state"],
            })

    print(f"cross-checkable proposals: {len(candidates):,}", flush=True)
    rnd = random.Random(20260822)
    sample = rnd.sample(candidates, min(args.sample, len(candidates)))

    stats = Counter()
    disagreements = []
    agreements_by_method = Counter()
    total_by_method = Counter()
    # Sampled and comparable are different denominators and the difference is
    # large: a letter that names no district, or one that would not download,
    # is not a disagreement. The headline rate has always divided by the
    # comparable ones; the per-method figures divided by everything sampled,
    # so the same word meant two things eighteen points apart in one object.
    comparable_by_method = Counter()

    started = time.time()
    deadline = started + args.budget_minutes * 60 if args.budget_minutes else None

    def check(rec: dict) -> dict | None:
        """None when the budget ran out before this letter could be read: it
        was not checked, which is not the same as being unreadable."""
        if deadline and time.time() >= deadline:
            return None
        dest = pdf_dir / f"{rec['id']}.pdf"
        if not dest.exists():
            err = download(rec["cert"], dest, deadline=deadline)
            if err:
                if deadline and time.time() >= deadline:
                    return None
                return {**rec, "outcome": "download-failed", "detail": err}
        try:
            with pdfplumber.open(dest) as pdf:
                text = "\n".join(p.extract_text() or "" for p in pdf.pages[:6])
        except Exception as e:  # noqa: BLE001
            return {**rec, "outcome": "unreadable", "detail": type(e).__name__}
        if len(text.strip()) < 200:
            return {**rec, "outcome": "no-text-layer", "detail": f"{len(text)} chars"}

        body, stripped = strip_addressee(text)
        # Only the parts of the letter that describe a location. Without this the
        # scan matches the issuing authority's own address on the letterhead.
        body = location_regions(body)
        if not body.strip():
            return {**rec, "outcome": "no-location-text", "stripped": stripped}
        pool = by_state.get(normalize_name(rec["state"]), {})
        flat = normalize_name(body)
        found = {code for name, code in pool.items()
                 if len(name) >= 5 and name in flat}

        if not found:
            return {**rec, "outcome": "no-district-in-letter", "stripped": stripped}
        if rec["claimed"] in found:
            return {**rec, "outcome": "agree", "stripped": stripped,
                    "found": sorted(found)}
        return {**rec, "outcome": "disagree", "stripped": stripped,
                "found": sorted(found)}

    t0 = time.time()
    unchecked = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(check, r) for r in sample]
        for i, f in enumerate(as_completed(futs), 1):
            res = f.result()
            if res is None:
                unchecked += 1
                continue
            if res["outcome"] not in OUTCOMES:
                raise ValueError(f"unknown cross-check outcome {res['outcome']!r}")
            stats[res["outcome"]] += 1
            total_by_method[res["method"]] += 1
            if res["outcome"] in ("agree", "disagree"):
                comparable_by_method[res["method"]] += 1
            if res["outcome"] == "agree":
                agreements_by_method[res["method"]] += 1
            elif res["outcome"] == "disagree":
                disagreements.append({
                    "proposalNo": res["no"], "state": res["state"],
                    "claimed": res["claimed"], "foundInLetter": res.get("found"),
                    "method": res["method"], "certificate": res["cert"],
                })
            if i % 50 == 0:
                print(f"  {i}/{len(sample)}  {dict(stats)}", flush=True)

    # A run the budget cut short is reported on what it read, but not when that
    # is so little that it would replace a committed report with a thinner one.
    if unchecked and len(sample) - unchecked < MIN_STOPPED_SAMPLE:
        sys.exit(f"stopped early with {len(sample) - unchecked} letters read "
                 f"(fewer than {MIN_STOPPED_SAMPLE}); the committed report stands")

    comparable = stats["agree"] + stats["disagree"]
    rate = (100 * stats["agree"] / comparable) if comparable else None

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "purpose": (
            "Tests the district the instrument reports against the district named "
            "in the regulator's signed clearance letter - a different document, "
            "not the applicant's own form. Corroborates or refutes the single "
            "source the whole profile depends on."
        ),
        # What was actually read. The methodology page words this as the
        # sample, so it must be the letters checked, not the letters asked for.
        "sampled": len(sample) - unchecked,
        "requested": len(sample),
        "stopped_early": bool(unchecked),
        "seconds": round(time.time() - t0, 1),
        "outcomes": {k: stats[k] for k in OUTCOMES},
        "comparable": comparable,
        "agreement_rate_pct": round(rate, 2) if rate is not None else None,
        # Every denominator named, and the rate computed here rather than left
        # for the reader to infer from whichever pair of numbers is to hand.
        "agreement_by_resolution_method": {
            m: {
                "agree": agreements_by_method[m],
                "comparable": comparable_by_method[m],
                "sampled": total_by_method[m],
                "rate_pct": (round(100 * agreements_by_method[m]
                                   / comparable_by_method[m], 2)
                             if comparable_by_method[m] else None),
            }
            for m in total_by_method
        },
        "disagreements": disagreements[:40],
        "method_notes": [
            "The addressee block is stripped before scanning. It carries the "
            "applicant's registered office, which is often a metro far from the "
            "site and produces confident false matches.",
            "The scan is constrained to districts of the proposal's own state.",
            "A letter naming several districts counts as agreement if the "
            "claimed district is among them: linear projects legitimately span "
            "districts, and the instrument reports a primary.",
            "'no-district-in-letter' is not a disagreement. Many letters describe "
            "the site only by village and tehsil, or refer to an annexure.",
            "Only text within 240 characters of a location cue (village, tehsil, "
            "district, situated, located, khasra, survey no) is scanned. Scanning "
            "the whole letter matches the letterhead and signature block, which "
            "carry the issuing SEIAA's own address - Gandhinagar for Gujarat, "
            "Bangalore for Karnataka, Chennai for Tamil Nadu. That bias made an "
            "earlier version of this check understate agreement at 87.34%.",
        ],
    }
    out = SCRIPTS / "crosscheck_report.json"
    out.write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")

    print()
    print("=== CROSS-CHECK AGAINST THE SIGNED CLEARANCE LETTER ===")
    for k, v in stats.most_common():
        print(f"  {k:24} {v:5,}  {100*v/max(1, len(sample) - unchecked):5.1f}%")
    if unchecked:
        print(f"\n  stopped early: {unchecked} of {len(sample)} letters not "
              f"reached within {args.budget_minutes:g} minutes")
    if rate is not None:
        print(f"\n  comparable cases        {comparable:,}")
        print(f"  AGREEMENT RATE          {rate:.2f}%")
    print(f"\n  written to {out}")


if __name__ == "__main__":
    main()
