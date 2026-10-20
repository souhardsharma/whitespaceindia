"""How long environmental clearance takes, derived from the appraisal history.

WHAT THIS ADDS
--------------
The register says where a proposal has got to. The appraisal history says when
it reached each position. Put together across the whole register they answer a
question the source cannot be asked and nobody publishes: how long does it take
to decide an environmental clearance application in India, and where does the
time go.

The unit of analysis here is the PROPOSAL, not the district. District measures
live in measures.py and are computed over Census population; these are computed
over filings and dates. The two are published separately because they have
different denominators and are not comparable.

TERMS OF REFERENCE ARE NOT CLEARANCE
------------------------------------
A proposal may be granted Terms of Reference and, much later, granted
environmental clearance. Both are recorded as grants, and timing them together
produces a figure belonging to neither: measured over the register, the median
run to Standard ToR is 24 days and to environmental clearance 135 - figures
dated 2026-09-01 and illustrative only; the build derives its own. A pooled
median moves with whatever mix of the two a subset happens to hold, and would
fall whenever more ToR applications were filed.

Every duration here is therefore reported against the instrument decided.
`decision_kind` comes from the stage registry, not from this module, so the
classification and the labels a reader sees resolve to one definition.

THERE ARE TWO FILING DATES AND THEY ARE NOT THE SAME
----------------------------------------------------
The register's `dateOfSubmission` is the date of the LATEST submission. When a
proposal is returned, auto-delisted or re-submitted after a query, that field
moves forward; the appraisal history keeps the original. They agree for two
thirds of the register and, where they differ, the register's date is later -
by a median of 18 days at the quartile and by up to eight months.

Duration is measured from the FIRST recorded step, because the question is how
long the applicant and the public waited, and that clock started at the first
filing. The register's own date would understate it by about a quarter.

Three dates are published on every proposal: `date` is the register's, `fon`
the one durations are measured from, and `don` the decision. Durations are
differences of CALENDAR DATES, not of timestamps, so

    fon + dtd + dsu == don

holds exactly, for every decided proposal, and a reader can check it. Taking
the difference of timestamps instead would floor away a part-day whenever the
decision fell earlier in the day than the filing, leaving the published figures
a day short of each other more often than not. Every one of those dates is the
INDIAN calendar date of the act, not the UTC one.

WHAT IS COMPUTED, AND HOW
-------------------------
filed_on        The earliest date on any recorded step, taking each step's END
                date in preference to its start. Both are present on every
                step, so this is a choice rather than a fallback: on the
                submission step the start date is when the applicant opened the
                draft, sometimes years earlier, while the end date is when they
                submitted it and matches the register's own submission date.
                The draft was never before the authority and is not part of how
                long anyone waited.

decided_on      The date of the latest step whose canonical status equals the
                proposal's current canonical status, where that status carries
                an outcome. If the history holds no such step, the duration is
                not computed. There is no fallback to "the last step of any
                kind": that would publish a number under a definition it did
                not meet, which is the one thing this layer exists to prevent.

days_to_decision   decided_on - filed_on in whole calendar days, LESS any interval
                during which the portal had delisted the proposal. Elapsed
                time, not working days: the public waits through weekends too,
                and the source records no working calendar. A same-day decision
                is a real outcome and is kept; a decision dated BEFORE the
                filing is a defect in the record and is dropped.

days_suspended  Days the proposal sat automatically delisted and then revived.
                One proposal in eight passes through such an interval, for a
                median of two months and occasionally for over a year. During
                it nothing is pending with the authority and no one is waiting
                on a decision, so counting it as time the authority took would
                overstate the delay and would do so unevenly across sectors.
                It is subtracted and published separately rather than hidden.

days_pending    Days since filing for a proposal that has not been decided AND
                has not been closed. A withdrawn or returned proposal is not
                pending - its clock stopped when it closed - so it is excluded
                rather than left running for ever.

query_rounds    How many times the authority sent the application back for
                Essential or Additional Details. Each round is a full cycle of
                the proponent answering and the authority re-examining, so it
                is the closest thing the record holds to a measure of how much
                the application was contested.

phase_days      Time in each phase. A step contributes only when it carries
                both a start and an end date; 93.5% do, measured over 772,536
                recorded steps on 2026-09-01. Intervals within a phase are
                merged before summing, so two steps of the same phase running
                at once are not counted twice. Phases can still overlap EACH
                OTHER, because the source runs steps concurrently, so they do
                not sum to the elapsed total and are not presented as a
                breakdown of it. The published aggregate carries the measured
                overlap rate.

WHAT IS NOT CLAIMED
-------------------
Not every proposal has a history. The workflow engine holds a record for about
four in five; the rest were filed before it or through a route it does not
cover. Every aggregate here publishes its own denominator, and the denominator
is the count of proposals the statistic was computed from - never the size of
the register. A median over the covered subset is not a median over the
register and is not presented as one.

  source:  PARIVESH workgroup process engine (live), via fetch_process_history
  outputs: per-proposal timing on the published shards; aggregates in
           public/data/instruments/consent/appraisal.json
"""
from __future__ import annotations

import json
import statistics
from datetime import datetime, timedelta, timezone
from pathlib import Path

import stages

# The register is an Indian record and every date in it is read by people
# working to the Indian calendar. The source stamps its timestamps +00:00, and
# they are genuinely UTC - the hour histogram over 1.49 million of them peaks at
# 11:00 UTC, which is 16:30 IST, exactly where an Indian working day peaks; an
# IST-mislabelled source would peak six hours earlier. So they are converted
# rather than relabelled. Without this, 9.6% of source timestamps fall at or
# after 18:00 UTC and are published a day early: 638 decision dates would
# disagree with the date printed on the clearance letter.
IST = timezone(timedelta(hours=5, minutes=30))


# An aggregate is not published below this many observations. Small groups
# produce medians that move several months on one extra filing, which reads as
# a finding and is noise.
MIN_GROUP = 30

# Statuses that mark a round of questions to the proponent.
QUERY_KEYS = {"eds_raised", "ads_raised"}


# ── Appraisal measure registry ────────────────────────────────────────────
# Same contract as measures.py: the definition of a number lives here once and
# the interface joins it at render time. Nothing in appraisal.json is published
# without an entry here.
APPRAISAL_MEASURES: dict[str, dict] = {
    "appraisal.days_to_decision": {
        "label": "Days from filing to decision",
        "unit": "days",
        "kind": "duration",
        "definition": "Elapsed calendar days between the first recorded step on "
                      "a proposal and the step at which the authority granted or "
                      "refused what was applied for, LESS any period during "
                      "which the portal had automatically delisted the proposal "
                      "and nothing was pending with the authority. Reported "
                      "separately for each instrument decided, because Terms of "
                      "Reference and environmental clearance are settled on "
                      "different timescales and a pooled figure describes "
                      "neither.",
        "formula": "(decided_on - filed_on) in calendar days, minus days_suspended",
        "source": "PARIVESH appraisal history",
        "vintage": "live",
    },
    "appraisal.days_pending": {
        "label": "Days open",
        "unit": "days",
        "kind": "duration",
        "definition": "Elapsed calendar days between the first recorded step on "
                      "a proposal and the date the register was last read, LESS "
                      "any period the proposal spent automatically delisted - "
                      "the same adjustment the time to decision carries, so the "
                      "two are on one basis. Counted only for proposals that "
                      "are neither decided nor closed: withdrawn, returned and "
                      "delisted proposals stopped their clock when they closed.",
        "formula": "(register_read_on - filed_on) in calendar days, minus "
                   "days_suspended",
        "source": "PARIVESH appraisal history",
        "vintage": "live",
    },
    "appraisal.days_suspended": {
        "label": "Days suspended",
        "unit": "days",
        "kind": "duration",
        "definition": "Days during which the portal had automatically delisted "
                      "the proposal and it was later revived. Nothing is "
                      "pending with the authority during such an interval, so "
                      "it is excluded from the time to decision.",
        "formula": "merged intervals whose status is delisted_by_system, in "
                   "whole calendar days - the same basis as the duration it is "
                   "subtracted from",
        "source": "PARIVESH appraisal history",
        "vintage": "live",
    },
    "appraisal.filed_on": {
        "label": "First filing date",
        "unit": "date",
        "kind": "date",
        "definition": "The date of the earliest act the workflow engine records "
                      "for this proposal. Distinct from the register's own "
                      "submission date, which moves forward on re-submission; "
                      "durations are measured from this one.",
        "formula": "earliest step date",
        "source": "PARIVESH appraisal history",
        "vintage": "live",
    },
    "appraisal.query_rounds": {
        "label": "Rounds of questions",
        "unit": "count",
        "kind": "count",
        "definition": "Number of times the authority sought Essential or "
                      "Additional Details from the proponent.",
        "formula": "count of steps whose status is eds_raised or ads_raised",
        "source": "PARIVESH appraisal history",
        "vintage": "live",
    },
    "appraisal.steps_recorded": {
        "label": "Recorded steps",
        "unit": "count",
        "kind": "count",
        "definition": "Number of dated acts the workflow engine holds for this "
                      "proposal.",
        "formula": "count of steps",
        "source": "PARIVESH appraisal history",
        "vintage": "live",
    },
    "appraisal.phase_days": {
        "label": "Days in a phase",
        "unit": "days",
        "kind": "duration",
        "definition": "Elapsed days a proposal spent in one phase of the "
                      "passage from filing to decision. Overlapping steps "
                      "within a phase are merged before summing. Phases may "
                      "overlap each other because the source runs steps "
                      "concurrently, so these do not sum to the total elapsed "
                      "time and are not a breakdown of it.",
        "formula": "union of [start, end] intervals of the steps in the phase",
        "source": "PARIVESH appraisal history",
        "vintage": "live",
    },
}


def _dt(value: object) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _local_date(d: datetime):
    """The Indian calendar date of a moment."""
    return d.astimezone(IST).date()


def _merged_days(intervals: list[tuple[datetime, datetime]]) -> int:
    """Days covered by a set of intervals, counting overlap once.

    Counted in CALENDAR days, on the same basis as the duration this is
    subtracted from. Flooring a timestamp difference instead would make the
    subtrahend systematically smaller than the span it is taken out of - over
    the register, smaller on 7,644 of the 7,658 proposals that have one - and
    the reported time to decision that much too long, while the published
    identity still closed because both sides used the same wrong number.
    """
    if not intervals:
        return 0
    ordered = sorted(intervals)
    total = 0
    cur_s, cur_e = ordered[0]
    for a, b in ordered[1:]:
        if a <= cur_e:
            cur_e = max(cur_e, b)
        else:
            total += (_local_date(cur_e) - _local_date(cur_s)).days
            cur_s, cur_e = a, b
    total += (_local_date(cur_e) - _local_date(cur_s)).days
    return total


def summarise(steps: list[dict], register_status: object,
              as_of: datetime | None = None) -> dict | None:
    """Timing for one proposal. None when the history holds nothing usable."""
    if not steps:
        return None
    as_of = as_of or datetime.now(timezone.utc)

    dated = [(_dt(s.get("ed")) or _dt(s.get("sd")), s) for s in steps]
    dated = [(d, s) for d, s in dated if d is not None]
    if not dated:
        return None
    dated.sort(key=lambda x: x[0])
    filed_on = dated[0][0]

    key = stages.canonical(register_status)
    meta = stages.STATUSES.get(key, {})
    outcome = meta.get("outcome")
    decision_kind = meta.get("decision")
    terminal = bool(meta.get("terminal"))

    # The decision step must be the step that records THIS decision. Where the
    # history holds no such step the duration is not computed and the proposal
    # is counted as unmatched, rather than timed to whatever step came last.
    decided_on = None
    decision_unmatched = False
    if outcome in ("granted", "rejected"):
        matching = [d for d, s in dated if stages.canonical(s.get("s")) == key]
        if matching:
            decided_on = max(matching)
        else:
            decision_unmatched = True

    # Time the portal had the proposal delisted. Merged, so overlapping
    # delisting records are not double-counted.
    suspended_iv = []
    for st in steps:
        if stages.canonical(st.get("s")) != "delisted_by_system":
            continue
        a, b = _dt(st.get("sd")), _dt(st.get("ed"))
        if a and b and b > a:
            suspended_iv.append((a, b))
    days_suspended = _merged_days(suspended_iv)

    days_to_decision = None
    if decided_on is not None:
        delta = (_local_date(decided_on) - _local_date(filed_on)).days \
            - days_suspended
        # A same-day decision is real and is kept. A decision dated before the
        # filing is a defect in the record and is dropped rather than floored.
        days_to_decision = delta if delta >= 0 else None

    # Pending means still moving. A proposal that was withdrawn, returned or
    # delisted is closed, not open, and must not accrue days for ever.
    days_pending = None
    if decided_on is None and outcome is None and not terminal:
        delta = (_local_date(as_of) - _local_date(filed_on)).days - days_suspended
        days_pending = delta if delta >= 0 else None

    by_phase: dict[str, list[tuple[datetime, datetime]]] = {}
    for s in steps:
        start, end = _dt(s.get("sd")), _dt(s.get("ed"))
        if not (start and end) or end < start:
            continue
        phase = stages.STATUSES.get(
            stages.canonical(s.get("s")), {}).get("phase", "other")
        by_phase.setdefault(phase, []).append((start, end))
    phase_days = {p: d for p, d in
                  ((p, _merged_days(v)) for p, v in by_phase.items()) if d > 0}

    current = [s for s in steps if s.get("cur")]
    # The engine flags more than one step as current on 41 proposals. Taking
    # whichever came first in the response makes the published stage depend on
    # the order the source happened to serve its rows in - the same fault the
    # CAF extractor had, where two fetches of an unchanged proposal disagreed.
    # Ordering by date puts the furthest-advanced step first, which is both
    # deterministic and the right answer: where the record says a proposal is
    # at two places at once, the later is where it has got to. The step ids
    # break a remaining tie so the choice rests on content, never arrival.
    def _rank(st: dict):
        # The ids are the source's, not ours, and it has already been seen to
        # send strings where it sends integers elsewhere. Sorting a mixed list
        # raises TypeError, and this runs inside the build over every one of
        # 96,318 proposals - one odd row would fail the whole publish. Coerced
        # to a comparable pair, so a strange id costs its own tie-break and
        # nothing else.
        def _num(v):
            try:
                return int(v)
            except (TypeError, ValueError):
                return -1
        return (_dt(st.get("ed")) or _dt(st.get("sd"))
                or datetime.min.replace(tzinfo=timezone.utc),
                _num(st.get("m")), _num(st.get("c")))

    current.sort(key=_rank, reverse=True)

    return {
        "filed_on": _local_date(filed_on).isoformat(),
        "decided_on": _local_date(decided_on).isoformat() if decided_on else None,
        "as_of": _local_date(as_of).isoformat(),
        "days_to_decision": days_to_decision,
        "days_suspended": days_suspended,
        "days_pending": days_pending,
        "decision_kind": decision_kind,
        "decision_unmatched": decision_unmatched,
        "query_rounds": sum(1 for s in steps
                            if stages.canonical(s.get("s")) in QUERY_KEYS),
        "steps": len(steps),
        "phase_days": phase_days,
        # The engine flags no current step on a large share of closed proposals
        # and more than one on a handful. Both are recorded rather than hidden.
        "current_stage": (stages.canonical(current[0].get("s"))
                          if current else None),
        "current_ambiguous": len(current) > 1,
        "outcome": outcome,
    }


def _quantiles(values: list[int]) -> dict | None:
    """Distribution of a group, or None when the group is too small to publish."""
    vals = sorted(v for v in values if v is not None)
    if len(vals) < MIN_GROUP:
        return None

    def q(p: float) -> int:
        # Nearest-rank on a 0-based list: the smallest value at or above the
        # p-th position. Using int(p*n) alone overshoots on small groups.
        idx = min(len(vals) - 1, max(0, int(round(p * (len(vals) - 1)))))
        return vals[idx]

    return {
        "n": len(vals),
        "p10": q(0.10), "p25": q(0.25),
        "median": int(statistics.median(vals)),
        "p75": q(0.75), "p90": q(0.90),
        "max": vals[-1],
    }


def _describe(rows: list[dict]) -> dict | None:
    """Duration distribution plus query rounds, each under its own denominator."""
    stats = _quantiles([r.get("days_to_decision") for r in rows])
    if not stats:
        return None
    qr = [r["query_rounds"] for r in rows
          if r.get("query_rounds") is not None
          and r.get("days_to_decision") is not None]
    stats["query_rounds"] = ({"n": len(qr), "median": int(statistics.median(qr))}
                             if len(qr) >= MIN_GROUP else None)
    return stats


def aggregate(rows: list[dict]) -> dict:
    """National and per-group distributions, split by the instrument decided.

    `rows` is one dict per proposal carrying the keys `summarise` produces plus
    sector, state, authority and category. Every group publishes `n`, the count
    the statistic was computed from.
    """
    def group_by(field: str, subset: list[dict]) -> dict:
        buckets: dict[str, list[dict]] = {}
        for r in subset:
            k = r.get(field)
            if k:
                buckets.setdefault(str(k), []).append(r)
        out = {}
        for k, rs in buckets.items():
            d = _describe(rs)
            if d:
                out[k] = d
        return dict(sorted(out.items(), key=lambda kv: -kv[1]["median"]))

    decided = [r for r in rows if r.get("days_to_decision") is not None]
    pending = [r for r in rows if r.get("days_pending") is not None]
    ec = [r for r in decided if r.get("decision_kind") == "ec"]

    # Phase totals, and how often they exceed the elapsed time they sit inside.
    phase_totals: dict[str, list[int]] = {}
    over = 0
    for r in decided:
        pd = r.get("phase_days") or {}
        for phase, days in pd.items():
            phase_totals.setdefault(phase, []).append(days)
        if pd and sum(pd.values()) > (r.get("days_to_decision") or 0):
            over += 1

    by_decision = {}
    for kind in sorted({r.get("decision_kind") for r in decided if r.get("decision_kind")}):
        d = _describe([r for r in decided if r.get("decision_kind") == kind])
        if d:
            by_decision[kind] = d

    return {
        "minGroup": MIN_GROUP,
        "coverage": {
            "proposals_summarised": len(rows),
            "with_duration": len(decided),
            "pending": len(pending),
            # THE THIRD BUCKET, which the page presented as if it did not
            # exist. `with_duration` and `pending` do not partition the
            # summarised set: 4,296 proposals ended WITHOUT a decision -
            # returned in present form, withdrawn, or pulled back by the
            # proponent - so they have no duration to a decision and are not
            # open either. Saying "of those, N have been decided and M are
            # still open" left them out of a sentence shaped like a partition,
            # which is how a reader is invited to add two numbers and believe
            # they have the whole.
            "closed_without_decision": (
                len(rows) - len(decided) - len(pending)),
            "decision_step_unmatched": sum(
                1 for r in rows if r.get("decision_unmatched")),
            # How much time was taken out of the durations above, and from how
            # many proposals. Stated because it is an adjustment to the
            # headline figure, not a detail of it.
            "suspended": {
                "proposals": sum(1 for r in decided if r.get("days_suspended")),
                "of_decided": len(decided),
                "days_excluded": sum(r.get("days_suspended") or 0 for r in decided),
            },
        },
        # Headline. `environmentalClearance` is the figure the phrase "how long
        # clearance takes" refers to; the others are shown beside it rather than
        # folded into it.
        "national": {
            "environmentalClearance": _describe(ec),
            "byDecision": by_decision,
            "pending": _quantiles([r["days_pending"] for r in pending]),
        },
        "byPhase": {
            "note": "Phases may overlap because the source runs steps "
                    "concurrently. These do not sum to the elapsed total.",
            "overlapping_proposals": over,
            "of_decided": len(decided),
            "phases": {p: v for p, v in
                       ((p, _quantiles(d)) for p, d in sorted(phase_totals.items()))
                       if v},
        },
        # Grouped views are restricted to environmental clearance so that a
        # state or sector comparison is comparing one instrument, not a mix.
        "environmentalClearance": {
            "bySector": group_by("sector", ec),
            "byState": group_by("state", ec),
            "byAuthority": group_by("authority", ec),
            "byCategory": group_by("category", ec),
            "byOutcome": group_by("outcome", ec),
        },
        "registry": APPRAISAL_MEASURES,
    }


def summarise_all(cache: Path, status_by_id: dict, as_of: datetime | None = None
                  ) -> tuple[dict[int, dict], dict[str, int], int]:
    """Stream the history file and keep only the summaries.

    Holding every step of every proposal costs about half a gigabyte at full
    register size and is never needed twice: each proposal's steps are read,
    reduced, and dropped. Only the small per-proposal summary is retained.

    Also returns any step status the registry does not define. Those decide
    phase attribution and query counts, so the caller gates on them rather than
    letting an unknown label fall quietly into `other`.
    """
    path = Path(cache) / "history" / "history.jsonl"
    out: dict[int, dict] = {}
    # Per id, not accumulated across lines. The file is append-only and the
    # nightly rolling pass re-reads a seventh of the open register, so a
    # proposal appears many times over. `out[rid] = summary` already keeps the
    # last one, but counting steps and unknown labels as they streamed by
    # tallied every superseded copy too - inflating both without bound and at
    # a rate that grows with how diligently the instrument re-reads itself.
    steps_by_id: dict[int, int] = {}
    unclassified_by_id: dict[int, dict] = {}
    if not path.exists():
        # An empty summary, not a traceback. This referenced `unclassified` and
        # `total_steps`, which are only bound AFTER the loop below, so the
        # cold-cache path - a fresh clone, or a cache where
        # fetch_process_history.py has not run - died with UnboundLocalError
        # instead of saying what was missing. It is before any write, so
        # nothing published was ever at risk; the cost was that the maintainer
        # got a name error where the sibling CAF path prints a one-line
        # instruction, so the fix is to say the same thing here.
        print("  WARNING: no appraisal history found at "
              f"{path}. Run scripts/instruments/fetch_process_history.py "
              "first; every duration will be null until you do.")
        return out, {}, 0
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except Exception:  # noqa: BLE001
                continue
            rid = rec.get("id")
            if rid is None:
                continue
            steps = rec.get("steps") or []
            steps_by_id[rid] = len(steps)
            seen_unknown: dict[str, int] = {}
            for st in steps:
                if stages.canonical(st.get("s")) == "unclassified":
                    key = stages.normalise(st.get("s"))
                    seen_unknown[key] = seen_unknown.get(key, 0) + 1
            unclassified_by_id[rid] = seen_unknown
            summary = summarise(steps, status_by_id.get(rid), as_of=as_of)
            if summary is not None:
                out[rid] = summary
            elif rid in out:
                # A later, unusable record must not leave the earlier
                # summary standing as if it were current.
                del out[rid]

    total_steps = sum(steps_by_id.values())
    unclassified: dict[str, int] = {}
    for per in unclassified_by_id.values():
        for k, v in per.items():
            unclassified[k] = unclassified.get(k, 0) + v
    return out, unclassified, total_steps
