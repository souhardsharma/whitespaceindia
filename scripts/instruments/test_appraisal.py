"""Tests for one proposal's timing and for the stage vocabulary behind it.

WHY THIS EXISTS
---------------
The register shows a proposal's CURRENT position, and some positions are held
after a decision that still stands: a Terms of Reference grant is followed by
"Forwarded to MS SPCB/PCC by MS" while the board raises its fee. Read from the
register status alone, such a proposal was published as open, with a running
clock, and its row flipped between "decided months ago" and "pending" as the
register status flipped between the two. These pin the reading that does not
move: the decision is taken from the history, and only for positions the stage
registry names. Offline, no network, no cache.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import appraisal as AP  # noqa: E402
import stages as ST  # noqa: E402

PASS = FAIL = 0
AS_OF = datetime(2026, 11, 15, 6, 0, tzinfo=timezone.utc)
FORWARDED = "Forwarded to MS SPCB/PCC by MS"


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def step(status: str, day: str, cur: bool = False) -> dict:
    return {"s": status, "sd": f"{day}T06:00:00+00:00",
            "ed": f"{day}T06:00:00+00:00", "cur": cur}


FILED = step("Submitted", "2026-06-01")
TOR = step("ToR Granted", "2026-07-31")
SENT = step(FORWARDED, "2026-08-03")
DEMAND = step("Demand Note Raised by MS SPCB/PCC to PP", "2026-08-10", cur=True)


def test_a_grant_followed_by_the_board_step_is_still_a_grant() -> None:
    print("\na decision that stands is read from the history")
    got = AP.summarise([FILED, TOR, SENT, DEMAND], FORWARDED, as_of=AS_OF)
    check("decided on the grant's date", got["decided_on"] == "2026-07-31",
          str(got["decided_on"]))
    check("the decision is named", got["decided_stage"] == "tor_granted",
          str(got["decided_stage"]))
    check("its instrument is the grant's", got["decision_kind"] == "tor",
          str(got["decision_kind"]))
    check("its outcome is the grant's", got["outcome"] == "granted",
          str(got["outcome"]))
    check("60 days from filing to the grant", got["days_to_decision"] == 60,
          str(got["days_to_decision"]))
    check("no clock is left running", got["days_pending"] is None,
          str(got["days_pending"]))
    check("nothing is reported unmatched", got["decision_unmatched"] is False)


def test_the_row_reads_the_same_whichever_status_the_register_shows() -> None:
    print("\nthe register status flipping does not move the decision")
    history = [FILED, TOR, SENT, DEMAND]
    at_board = AP.summarise(history, FORWARDED, as_of=AS_OF)
    at_grant = AP.summarise(history, "ToR Granted", as_of=AS_OF)
    for field in ("decided_on", "decided_stage", "decision_kind", "outcome",
                  "days_to_decision", "days_pending"):
        check(f"{field} agrees", at_board[field] == at_grant[field],
              f"{at_board[field]!r} vs {at_grant[field]!r}")


def test_the_board_step_before_any_decision_is_open() -> None:
    print("\nwith no decision in the history the proposal is open")
    got = AP.summarise([FILED, SENT], FORWARDED, as_of=AS_OF)
    check("not decided", got["decided_on"] is None, str(got["decided_on"]))
    check("no decision named", got["decided_stage"] is None,
          str(got["decided_stage"]))
    check("open since filing", got["days_pending"] == 167,
          str(got["days_pending"]))


def test_the_latest_decision_is_the_one_that_stands() -> None:
    print("\ntwo decisions in one history")
    ec = step("EC Granted", "2026-09-20")
    later = step(FORWARDED, "2026-09-25")
    got = AP.summarise([FILED, TOR, ec, later], FORWARDED, as_of=AS_OF)
    check("the later decision is taken", got["decided_stage"] == "ec_granted",
          str(got["decided_stage"]))
    check("dated by its own step", got["decided_on"] == "2026-09-20",
          str(got["decided_on"]))
    check("counted as an environmental clearance", got["decision_kind"] == "ec",
          str(got["decision_kind"]))


def test_only_positions_the_registry_names_look_back() -> None:
    print("\nany other open position stays open")
    got = AP.summarise([FILED, TOR, step("EDS Raised", "2026-08-05")],
                       "EDS Raised", as_of=AS_OF)
    check("a query after a grant is not read as decided",
          got["decided_on"] is None and got["decided_stage"] is None,
          f"{got['decided_on']} {got['decided_stage']}")
    check("its clock runs", got["days_pending"] == 167, str(got["days_pending"]))


def test_a_decided_status_still_needs_its_own_step() -> None:
    print("\na decided register status is dated by its own step only")
    got = AP.summarise([FILED, TOR], "ToR Granted", as_of=AS_OF)
    check("dated by the matching step",
          got["decided_on"] == "2026-07-31" and got["decided_stage"] == "tor_granted")
    missing = AP.summarise([FILED, TOR], "EC Granted", as_of=AS_OF)
    check("another decision's step is not borrowed",
          missing["decided_on"] is None and missing["decision_unmatched"] is True
          and missing["decided_stage"] is None,
          f"{missing['decided_on']} {missing['decided_stage']}")


def test_the_registry_names_those_positions() -> None:
    print("\nthe positions held after a decision")
    check("the board step is one", "forwarded_to_spcb" in ST.AFTER_DECISION)
    known = [k for k in ST.AFTER_DECISION if k in ST.STATUSES]
    check("each is a status the registry defines",
          len(known) == len(ST.AFTER_DECISION), str(sorted(ST.AFTER_DECISION)))
    deciding = [k for k in known if ST.STATUSES[k]["outcome"] or ST.STATUSES[k]["terminal"]]
    check("none is itself an outcome or an end", not deciding, str(deciding))
    check("they are published", ST.registry().get("afterDecision") ==
          sorted(ST.AFTER_DECISION), str(ST.registry().get("afterDecision")))


def test_the_boards_return_is_not_the_forward() -> None:
    print("\nhistory spellings that had no stage")
    back = ST.canonical("Forwarded to MS by MS SPCB/PCC")
    check("the board's return has a stage", back == "returned_by_spcb", back)
    check("it is not the forward", back != ST.canonical(FORWARDED))
    check("it does not look back for a decision", back not in ST.AFTER_DECISION)
    check("a spaced 're open' is the same request",
          ST.canonical("Requested For Re Open") == "reopen_requested",
          ST.canonical("Requested For Re Open"))
    check("an unknown spelling is still not guessed",
          ST.canonical("Forwarded to nobody") == "unclassified")
    check("the registry is consistent", not ST.self_check(), str(ST.self_check()))


def main() -> int:
    for fn in (test_a_grant_followed_by_the_board_step_is_still_a_grant,
               test_the_row_reads_the_same_whichever_status_the_register_shows,
               test_the_board_step_before_any_decision_is_open,
               test_the_latest_decision_is_the_one_that_stands,
               test_only_positions_the_registry_names_look_back,
               test_a_decided_status_still_needs_its_own_step,
               test_the_registry_names_those_positions,
               test_the_boards_return_is_not_the_forward):
        fn()
    print()
    if FAIL:
        print(f"{FAIL} of {PASS + FAIL} checks FAILED")
        return 1
    print(f"all {PASS} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
