"""Stage and status registry for Instrument 01 - People & Consent.

WHAT THIS IS FOR
----------------
The register writes a proposal's position as free text, and it writes the same
position more than one way. "ToR Granted", "TOR Granted", "TOR GRANTED" and
"TOR GRanted" are one stage recorded four ways; "EDS raised", "EDS Raised" and
"EDS RAISED" are one stage recorded three ways. Measured over 115,272 register
records on 2026-09-01, the four ToR spellings covered 10,112 proposals, of
which the most common spelling accounted for 5,131 - so a filter keyed to the
raw text would have returned half of them.

Counts in this file are illustrative and are dated where given; the figures
the build actually publishes are derived at build time and reported in
verification_report.json. Nothing here is used as an input.

Left alone, that splits every count and every filter. A reader asking the
register for proposals at Terms of Reference would be shown half of them, under
an interface giving no sign that the other half existed. This registry is what
makes the vocabulary single-valued: one canonical key per position, one label,
one definition, and a map from every spelling the source uses.

It is the same architecture as the measure registry. The definition of a stage
lives here once; published records carry the key. The interface joins key to
definition at render time, so a filter and the count above it cannot disagree.

WHAT THE KEYS ARE, AND ARE NOT
------------------------------
Merging is confined to spellings of the same phrase - case, a transposed
letter, "Withdraw" for "Withdrawal". Positions that read as similar but are
distinct acts stay distinct:

  tor_granted vs standard_tor_granted   Standard Terms of Reference are issued
                                        from a published standard set; specific
                                        ToR are framed for the project. Both
                                        grant ToR; they are not one instrument.
  granted vs ec_granted                 The source writes a bare "Granted" on
                                        314 proposals without naming what was
                                        granted. It is not read as EC.
  referred_to_eac vs                    Referral by the member secretary and
    accepted_and_referred_to_eac        acceptance-then-referral are recorded
                                        separately by the source and are kept so.

PHASE is a coarser grouping for reading the register at a glance: where in the
passage from filing to decision a proposal currently sits. OUTCOME is set only
where the source states one. A proposal still moving has no outcome, and that
is different from an outcome of "pending".

UNRECOGNISED STATUSES
---------------------
The register is live and its vocabulary grows. An unknown status is never
folded into a neighbouring key: it resolves to `unclassified`, keeps its raw
text for display, and is reported by name and count in the verification report
so it can be curated. Silent mis-grouping is the failure this registry exists
to prevent, so guessing would defeat it. Above UNCLASSIFIED_LIMIT of the
register the build fails rather than publishes a vocabulary it does not know.

  source:  PARIVESH clearance register, `proposalStatus` (live)
  used by: build_data.py, check_published.py; published as
           public/data/instruments/consent/stages.json
"""
from __future__ import annotations

# A build may not publish more unclassified records than this. Set low: the
# curated map covers every status observed across 89,372 proposals, so a breach
# means the source has introduced vocabulary that needs a decision, not that
# the threshold is too tight.
UNCLASSIFIED_LIMIT = 0.005  # 0.5% of published records

# ── Phases ────────────────────────────────────────────────────────────────
# The passage a proposal makes. `order` drives display; it is not a claim that
# every proposal visits every phase, because most do not.
PHASES: dict[str, dict] = {
    "filed": {
        "order": 1,
        "label": "Filed",
        "definition": "The proposal has been lodged with the authority that "
                      "will decide it and has not yet been taken up.",
    },
    "verification": {
        "order": 2,
        "label": "In verification",
        "definition": "The authority's secretariat is checking the proposal "
                      "for completeness and eligibility before appraisal.",
    },
    "administrative": {
        "order": 3,
        "label": "Administrative steps",
        "definition": "The proposal is going through procedural steps, such as "
                      "fee demands and payments or comments from the "
                      "pollution control board, before appraisal continues.",
    },
    "query": {
        "order": 4,
        "label": "Under query",
        "definition": "The authority has asked the applicant in writing for "
                      "essential or additional details, and the proposal waits "
                      "on the reply.",
    },
    "appraisal": {
        "order": 5,
        "label": "In appraisal",
        "definition": "The proposal is before an expert appraisal committee, "
                      "or before the authority that decides on the "
                      "committee's recommendation.",
    },
    "decided": {
        "order": 6,
        "label": "Decided",
        "definition": "The authority has issued a decision on the application, "
                      "granting or refusing either the environmental clearance "
                      "or the Terms of Reference that come before it. A grant "
                      "of Terms of Reference settles only the scope of the "
                      "impact assessment, and the clearance itself is still to "
                      "be decided.",
    },
    "closed": {
        "order": 7,
        "label": "Closed without decision",
        "definition": "The proposal left the process without a decision on "
                      "its merits, for example when the applicant withdrew it "
                      "or the authority returned it. A proposal the portal "
                      "delisted automatically can later be restored.",
    },
    "other": {
        "order": 8,
        "label": "Other",
        "definition": "The proposal is at a recorded position outside the "
                      "usual sequence from filing to decision, such as a "
                      "transfer between authorities.",
    },
}


def _s(label, phase, definition, outcome=None, terminal=False, decision=None):
    """One canonical position.

    `outcome`  granted / rejected / withdrawn / returned, where the source
               states one. None means the proposal is still moving.
    `decision` WHAT was decided, where anything was: "ec" for prior
               environmental clearance, "tor" for Terms of Reference, "form9"
               for a Form 9 application, "unspecified" where the source records
               a grant without naming the instrument.

    The distinction matters for duration. Terms of Reference are settled early
    and quickly; environmental clearance is the decision the public is waiting
    on. Timing them together produces a figure that belongs to neither and
    moves with whatever mix of the two a given subset happens to contain.
    """
    return {"label": label, "phase": phase, "definition": definition,
            "outcome": outcome, "terminal": terminal, "decision": decision}


# ── Canonical statuses ────────────────────────────────────────────────────
STATUSES: dict[str, dict] = {
    # Decided
    "ec_granted": _s(
        "Environmental clearance granted", "decided",
        "The project has been granted environmental clearance, which it needs "
        "before construction or operation can begin.",
        outcome="granted", terminal=True, decision="ec"),
    "ec_rejected": _s(
        "Environmental clearance refused", "decided",
        "The application for environmental clearance, which the project needs "
        "before work can begin, was refused.",
        outcome="rejected", terminal=True, decision="ec"),
    "tor_granted": _s(
        "Terms of Reference granted", "decided",
        "Terms of Reference for the environmental impact assessment have been "
        "framed and issued for this project.",
        outcome="granted", terminal=False, decision="tor"),
    "standard_tor_granted": _s(
        "Standard Terms of Reference granted", "decided",
        "Terms of Reference have been issued from the published standard set "
        "for the project's category, without project-specific framing.",
        outcome="granted", terminal=False, decision="tor"),
    "tor_rejected": _s(
        "Terms of Reference refused", "decided",
        "The application for Terms of Reference was refused.",
        outcome="rejected", terminal=True, decision="tor"),
    "granted": _s(
        "Granted", "decided",
        "The register records the application as granted but does not say "
        "whether the grant was of environmental clearance or of Terms of "
        "Reference.",
        outcome="granted", terminal=True, decision="unspecified"),
    "form9_approved": _s(
        "Form 9 approved", "decided",
        "An application made on Form 9 was approved.",
        outcome="granted", terminal=True, decision="form9"),
    "form9_rejected": _s(
        "Form 9 refused", "decided",
        "An application made on Form 9 was refused.",
        outcome="rejected", terminal=True, decision="form9"),
    "form9_accepted": _s(
        "Form 9 accepted", "verification",
        "An application made on Form 9 was accepted for processing.",
        outcome=None),

    # Filed
    "submitted": _s(
        "Submitted", "filed",
        "The proposal has been lodged with the authority and awaits its first "
        "action.",
        outcome=None),
    "draft": _s(
        "Draft", "filed",
        "The applicant has begun the application but not yet submitted it.",
        outcome=None),
    "intimated": _s(
        "Intimated", "filed",
        "The applicant has notified the authority of the proposal.",
        outcome=None),

    # Verification
    "ms_verification": _s(
        "With the member secretary", "verification",
        "The member secretary, the official who runs the appraisal body's "
        "secretariat, is verifying the application.",
        outcome=None),
    "under_verification": _s(
        "Under verification", "verification",
        "The authority is checking the application for completeness and "
        "eligibility before appraisal.",
        outcome=None),
    "under_verification_sceia": _s(
        "Under verification with SCEIA", "verification",
        "The application is being verified by the Standing Committee on Environment Impact Appraisal (SCEIA), which appraises proposals while a State Expert Appraisal Committee is not functioning.",
        outcome=None),
    "under_examination": _s(
        "Under examination", "verification",
        "The authority is examining the application.",
        outcome=None),
    "under_examination_sceia": _s(
        "Under examination with SCEIA", "verification",
        "The application is being examined by the Standing Committee on Environment Impact Appraisal (SCEIA), which appraises proposals while a State Expert Appraisal Committee is not functioning.",
        outcome=None),
    "under_processing": _s(
        "Under processing with the authority", "verification",
        "The authority is processing the application, and the register "
        "records no more precise position.",
        outcome=None),
    "pending_ms_seiaa": _s(
        "Pending with the member secretary, SEIAA", "verification",
        "Awaiting action by the member secretary of the State Environment "
        "Impact Assessment Authority.",
        outcome=None),
    "pending_ms_saeia": _s(
        "Pending with the member secretary, SAEIA", "verification",
        "Awaiting action by the member secretary of the Standing Authority on "
        "Environment Impact Assessment (SAEIA), which acts in place of a State "
        "Environment Impact Assessment Authority that is not functioning. The "
        "stage appears on 18 proposals, all from West Bengal.",
        outcome=None),

    # Query
    "eds_raised": _s(
        "Essential details sought", "query",
        "The authority has asked the applicant in writing for essential "
        "details, and the proposal waits on the reply.",
        outcome=None),
    "eds_replied": _s(
        "Essential details supplied", "query",
        "The applicant has answered the authority's request for essential "
        "details.",
        outcome=None),
    "eds_under_examination": _s(
        "Essential details under examination", "query",
        "The authority is examining the applicant's reply to its request for "
        "essential details.",
        outcome=None),
    "ads_raised": _s(
        "Additional details sought", "query",
        "The authority has asked the applicant in writing for additional "
        "details, and the proposal waits on the reply.",
        outcome=None),

    # Appraisal
    "referred_to_eac": _s(
        "Referred to the Expert Appraisal Committee", "appraisal",
        "Sent to the central Expert Appraisal Committee for appraisal.",
        outcome=None),
    "referred_to_seac": _s(
        "Referred to the State Expert Appraisal Committee", "appraisal",
        "Sent to the State Expert Appraisal Committee for appraisal.",
        outcome=None),
    "referred_to_seiaa": _s(
        "Referred to SEIAA", "appraisal",
        "Sent to the State Environment Impact Assessment Authority, which "
        "decides on the committee's recommendation.",
        outcome=None),
    "referred_to_saeia": _s(
        "Referred to SAEIA", "appraisal",
        "Sent to the Standing Authority on Environment Impact Assessment "
        "(SAEIA), which decides proposals while a State Environment Impact "
        "Assessment Authority is not functioning. It was first seen in the "
        "register read of 24 September 2026, on 131 proposals, all from Andhra "
        "Pradesh.",
        outcome=None),
    "accepted_referred_to_eac": _s(
        "Accepted and referred to the Expert Appraisal Committee", "appraisal",
        "Accepted by the authority and sent to the central Expert Appraisal "
        "Committee.",
        outcome=None),
    "accepted_referred_to_seac": _s(
        "Accepted and referred to the State Expert Appraisal Committee",
        "appraisal",
        "Accepted by the authority and sent to the State Expert Appraisal "
        "Committee.",
        outcome=None),
    "accepted_referred_to_sceia": _s(
        "Accepted and referred to SCEIA", "appraisal",
        "The authority has accepted the application and sent it to the Standing Committee on Environment Impact Appraisal (SCEIA), which appraises proposals while a State Expert Appraisal Committee is not functioning.",
        outcome=None),
    "mom_pending": _s(
        "Minutes of meeting pending", "appraisal",
        "The minutes of the appraisal committee's meeting are waiting to be "
        "prepared by its member secretary.",
        outcome=None),
    "mom_published": _s(
        "Minutes of meeting published", "appraisal",
        "The appraisal committee's minutes have been issued.",
        outcome=None),
    "public_hearing_examination": _s(
        "Public hearing under examination", "appraisal",
        "The record of the statutory public hearing is before the authority.",
        outcome=None),
    "stage1_fc_awaited": _s(
        "Stage-I forest clearance awaited", "appraisal",
        "The proposal waits on Stage-I forest clearance, the in-principle "
        "approval to divert forest land under the Forest (Conservation) Act, "
        "1980, now the Van (Sanrakshan Evam Samvardhan) Adhiniyam.",
        outcome=None),

    # Closed
    "withdrawn": _s(
        "Withdrawn", "closed",
        "The applicant has withdrawn the proposal.",
        outcome="withdrawn", terminal=True),
    "pulled_back": _s(
        "Pulled back by the applicant", "closed",
        "The register records that the applicant took the proposal back "
        "before a decision, using this wording in place of a withdrawal.",
        outcome="withdrawn", terminal=True),
    "withdrawal_request_accepted": _s(
        "Withdrawal accepted", "closed",
        "The applicant asked to withdraw and the authority agreed.",
        outcome="withdrawn", terminal=True),
    "pending_ms_withdraw": _s(
        "Withdrawal request pending", "closed",
        "The applicant has asked to withdraw, and the authority has not yet "
        "acted on the request.",
        outcome=None),
    "returned_in_present_form": _s(
        "Returned in its present form", "closed",
        "The authority returned the proposal to the applicant without deciding "
        "it on its merits, so that it can be filed again.",
        outcome="returned", terminal=True),
    "returned_to_ua": _s(
        "Returned to the user agency", "closed",
        "The authority sent the proposal back to the user agency, the body "
        "that applied to use the land.",
        outcome="returned", terminal=True),
    "delisted": _s(
        "Delisted", "closed",
        "The proposal has been removed from the list of active proposals.",
        outcome="withdrawn", terminal=True),

    # Other
    "violation_reported": _s(
        "Violation reported", "other",
        "The register records a reported violation of the environmental "
        "clearance rules against this proposal.",
        outcome=None),
    "unrecorded": _s(
        "Not recorded", "other",
        "The register carries no status for this proposal.",
        outcome=None),

    # ── Positions recorded only in the appraisal history ──────────────────
    # The workflow engine records events as well as positions: a step may say
    # that a stage COMPLETED rather than that the proposal is AT it. These are
    # kept distinct from the register's own vocabulary, because "under
    # verification" and "verification completed" are opposite ends of one stage
    # and must never be counted as the same thing.
    "ms_verification_completed": _s(
        "Member secretary verification completed", "verification",
        "The member secretary has finished verifying the application.",
        outcome=None),
    "examination_completed": _s(
        "Examination completed", "verification",
        "The authority has finished examining the application.",
        outcome=None),
    "proposal_acceptance": _s(
        "Accepted", "verification",
        "The authority has accepted the application for processing.",
        outcome=None),
    "eds_examination_completed": _s(
        "Essential details examination completed", "query",
        "The authority has finished examining the reply to its request for "
        "essential details.",
        outcome=None),
    "ads_replied": _s(
        "Additional details supplied", "query",
        "The applicant has answered the authority's request for additional "
        "details.",
        outcome=None),
    "processed_by_ms_seiaa": _s(
        "Processed by the member secretary, SEIAA", "appraisal",
        "Acted on by the member secretary of the State Environment Impact "
        "Assessment Authority and passed onward.",
        outcome=None),
    "processed_by_ms_seac": _s(
        "Processed by the member secretary, SEAC", "appraisal",
        "Acted on by the member secretary of the State Expert Appraisal "
        "Committee and passed onward.",
        outcome=None),
    # First published 2026-10 (1,934 proposals, nearly all violation-case
    # ToR/EC forms). Of 461 cached histories carrying it, 286 next show the
    # board's demand note and 54 "Demand Note Not Raised On Time".
    "forwarded_to_spcb": _s(
        "Forwarded to the pollution control board", "administrative",
        "The member secretary has sent the proposal to the State Pollution "
        "Control Board or Pollution Control Committee for its comments and "
        "fee demand.",
        outcome=None),
    "comments_furnished": _s(
        "Pollution control board comments furnished", "administrative",
        "The State Pollution Control Board or Pollution Control Committee has "
        "given its comments on the proposal.",
        outcome=None),
    "comments_late": _s(
        "Pollution control board comments not furnished in time", "administrative",
        "The board did not give its comments within the period allowed.",
        outcome=None),
    "demand_note_raised": _s(
        "Fee demand raised", "administrative",
        "The board has raised a demand for the processing fee.",
        outcome=None),
    "demand_note_late": _s(
        "Fee demand not raised in time", "administrative",
        "The board did not raise its fee demand within the period allowed.",
        outcome=None),
    "payment_furnished": _s(
        "Payment details furnished", "administrative",
        "The applicant has supplied evidence of payment of the fee.",
        outcome=None),
    "payment_approved": _s(
        "Payment approved", "administrative",
        "The board has accepted the applicant's payment.",
        outcome=None),
    "payment_rejected": _s(
        "Payment rejected", "administrative",
        "The board has refused the applicant's payment.",
        outcome=None),
    "transferred_to_state": _s(
        "Transferred to the state", "other",
        "Moved from central to state appraisal.",
        outcome=None),
    "transferred_to_ministry": _s(
        "Transferred to the ministry", "other",
        "Moved from state to central appraisal.",
        outcome=None),
    "transferred_to_sceia": _s(
        "Transferred to SCEIA", "other",
        "Moved to the Standing Committee on Environment Impact Appraisal "
        "(SCEIA) because the term of the State appraisal committee or authority "
        "had expired.",
        outcome=None),
    "transferred_from_sceia": _s(
        "Transferred back from SCEIA", "other",
        "Returned from SCEIA after the State appraisal committee was "
        "reconstituted.",
        outcome=None),
    "parked": _s(
        "Parked by the authority", "other",
        "Set aside by the authority without a decision.",
        outcome=None),
    "recalled": _s(
        "Recalled", "closed",
        "The authority has called the proposal back from the stage it had "
        "reached.",
        outcome=None),
    "reopen_requested": _s(
        "Reopening requested", "other",
        "The applicant has asked for the proposal to be reopened.",
        outcome=None),
    "reopened": _s(
        "Reopened for reconsideration", "other",
        "The authority has reopened the proposal to consider it again.",
        outcome=None),
    "delisted_by_system": _s(
        "Delisted automatically", "closed",
        "The portal removed the proposal automatically when a time limit "
        "lapsed, without any decision by the authority. Such a proposal can "
        "later be restored.",
        outcome="withdrawn", terminal=True),

    "processed_by_ms": _s(
        "Processed by the member secretary", "appraisal",
        "The member secretary has acted on the proposal and passed it on; the "
        "register does not name the authority.",
        outcome=None),
    "processed_by_ms_sceia": _s(
        "Processed by the member secretary, SCEIA", "appraisal",
        "The member secretary of the Standing Committee on Environment Impact "
        "Appraisal (SCEIA) has acted on the proposal and passed it on.",
        outcome=None),
    # Seen in the appraisal history from September 2026. Kept apart from SEIAA:
    # SAEIA is the standing authority that acts while a SEIAA is not
    # functioning (EIA Notification 2006 as amended by S.O. 3862(E), July 2026;
    # S.O. 3863(E) sets out its composition and that of the SCEIA).
    "processed_by_ms_saeia": _s(
        "Processed by the member secretary, SAEIA", "appraisal",
        "The member secretary of the Standing Authority on Environment Impact "
        "Assessment (SAEIA) has acted on the proposal and passed it on.",
        outcome=None),
    "transferred_from_saeia": _s(
        "Transferred from SAEIA to SEIAA", "other",
        "Returned from the Standing Authority on Environment Impact Assessment "
        "(SAEIA) to the State Environment Impact Assessment Authority after the "
        "appraisal committee was reconstituted.",
        outcome=None),
    "transferred_to_saeia": _s(
        "Transferred to SAEIA", "other",
        "Moved to the Standing Authority on Environment Impact Assessment "
        "(SAEIA) because the term of the State appraisal committee or "
        "authority had expired.",
        outcome=None),
    "stage1_fc_uploaded": _s(
        "Stage-I forest clearance uploaded", "appraisal",
        "The Stage-I forest clearance, the in-principle approval to divert "
        "forest land, has been uploaded to the proposal's record.",
        outcome=None),
    "pending_ms_seac": _s(
        "Pending with the member secretary, SEAC", "verification",
        "Awaiting action by the member secretary of the State Expert Appraisal "
        "Committee.",
        outcome=None),
    "pending_seiaa": _s(
        "Pending with SEIAA", "appraisal",
        "Awaiting action by the State Environment Impact Assessment Authority.",
        outcome=None),

    "unclassified": _s(
        "Not classified", "other",
        "The register has begun using a status we have not yet defined. It is "
        "shown in the register's own words and counted on its own.",
        outcome=None),
}

# ── Every spelling the source uses ────────────────────────────────────────
# Left side is the register's `proposalStatus` verbatim. Comparison is made on
# the trimmed, case-folded, whitespace-collapsed form, so only genuinely
# different wording needs an entry.
RAW_TO_KEY: dict[str, str] = {
    "ec granted": "ec_granted",
    "ec rejected": "ec_rejected",
    "tor granted": "tor_granted",
    "standard tor granted": "standard_tor_granted",
    "tor rejected": "tor_rejected",
    "granted": "granted",
    "ec form 9 approved": "form9_approved",
    "ec form 9 rejected": "form9_rejected",
    "ec form 9 accepted": "form9_accepted",

    "submitted": "submitted",
    "draft": "draft",
    "intimated": "intimated",

    "ms verification": "ms_verification",
    "under verification": "under_verification",
    "under verification with sceia": "under_verification_sceia",
    "under examination": "under_examination",
    "under examinitaion": "under_examination",          # source typo
    "under examination with sceia": "under_examination_sceia",
    "under processing with authority": "under_processing",
    "pending at ms seiaa": "pending_ms_seiaa",
    "pending at ms with saeia": "pending_ms_saeia",
    "pending at ms saeia": "pending_ms_saeia",

    "eds raised": "eds_raised",
    "eds_replied": "eds_replied",
    "eds under examination": "eds_under_examination",
    "ads raised": "ads_raised",

    "referred to eac": "referred_to_eac",
    "referred to seac": "referred_to_seac",
    "referred to seiaa": "referred_to_seiaa",
    "referred to saeia": "referred_to_saeia",
    "proposal accepted and referred to eac": "accepted_referred_to_eac",
    "proposal accepted and referred to seac": "accepted_referred_to_seac",
    "proposal accepted and referred to sceia": "accepted_referred_to_sceia",
    "pending at ms for mom creation": "mom_pending",
    "mom published": "mom_published",
    "public hearing proposal under examination": "public_hearing_examination",
    "stage-i fc awaited": "stage1_fc_awaited",

    "withdrawn": "withdrawn",
    "proposal pulled back (withdrawn)": "pulled_back",
    "withdrawal request accepted": "withdrawal_request_accepted",
    "proposal withdrawal request accepted": "withdrawal_request_accepted",
    "proposal withdraw request accepted": "withdrawal_request_accepted",
    "pending at ms for proposal withdraw": "pending_ms_withdraw",
    "pending at ms for proposal withdraw request": "pending_ms_withdraw",
    "proposal returned in present form": "returned_in_present_form",
    "return to ua": "returned_to_ua",
    "delisted": "delisted",

    "report violation": "violation_reported",
    "": "unrecorded",

    # Seen in the appraisal history only.
    "ms verification completed": "ms_verification_completed",
    "under ms verification": "ms_verification",
    "examination completed": "examination_completed",
    "proposal acceptance": "proposal_acceptance",
    "eds examination completed": "eds_examination_completed",
    "eds replied": "eds_replied",
    "ads replied": "ads_replied",
    "processed by ms seiaa": "processed_by_ms_seiaa",
    "processed by ms seac": "processed_by_ms_seac",
    "forwarded to ms spcb/pcc by ms": "forwarded_to_spcb",
    "comments furnished by ms spcb/pcc": "comments_furnished",
    "comments not furnished on time": "comments_late",
    "demand note raised by ms spcb/pcc to pp": "demand_note_raised",
    "demand note not raised on time": "demand_note_late",
    "payment details furnished by pp to ms spcb/pcc": "payment_furnished",
    "payment approved by ms spcb/pcc": "payment_approved",
    "payment rejected by ms spcb/pcc": "payment_rejected",
    "proposal transferred to state": "transferred_to_state",
    "proposal transferred to ministry": "transferred_to_ministry",
    "transferred to sceia due to seac/seiaa expiry": "transferred_to_sceia",
    "transferred from sceia to seac after reconstitution of seac/seiaa":
        "transferred_from_sceia",
    "proposal parked by authority": "parked",
    "recalled proposal": "recalled",
    "requested for reopen": "reopen_requested",
    "proposal reopened for reconsideration": "reopened",
    "delisted_by_system": "delisted_by_system",
    "withdraw request accepted": "withdrawal_request_accepted",

    # Further history-only spellings. Each is a near-miss of a key already
    # defined - the same act written more tersely, or naming a different
    # authority - which is exactly the case the registry exists to catch
    # rather than let fall into `unclassified`.
    "processed by ms": "processed_by_ms",
    "processed by ms sceia": "processed_by_ms_sceia",
    "proposal accepted": "proposal_acceptance",
    "proposal parked": "parked",
    "transferred to saeia due to seac/seiaa expiry": "transferred_to_saeia",
    "eds raised by ms to ua": "eds_raised",
    "stage-i fc uploaded": "stage1_fc_uploaded",
    "pending at ms seac": "pending_ms_seac",
    "pending at seiaa": "pending_seiaa",
    "processed by ms saeia": "processed_by_ms_saeia",
    "transferred from saeia to seiaa after reconstitution of seac/seiaa":
        "transferred_from_saeia",
}


def normalise(raw: object) -> str:
    """Trim, collapse internal whitespace and case-fold. Comparison form only."""
    if raw is None:
        return ""
    return " ".join(str(raw).split()).lower()


def canonical(raw: object) -> str:
    """Canonical key for one register status. Never guesses.

    Anything absent from RAW_TO_KEY resolves to `unclassified` and is counted
    by the caller, rather than being folded into a key it resembles.
    """
    return RAW_TO_KEY.get(normalise(raw), "unclassified")


def decision_kinds() -> dict:
    """Which canonical keys settle which instrument."""
    out: dict[str, list[str]] = {}
    for k, v in STATUSES.items():
        if v.get("decision"):
            out.setdefault(v["decision"], []).append(k)
    return {k: sorted(v) for k, v in sorted(out.items())}


def registry() -> dict:
    """The published registry: phases, statuses, and the spellings behind each.

    `raw` lets the interface show which source labels a canonical key stands
    for, so a reader can see that one filter covers four spellings rather than
    having to take it on trust.
    """
    raws: dict[str, list[str]] = {}
    for raw, key in RAW_TO_KEY.items():
        raws.setdefault(key, []).append(raw)
    return {
        "phases": PHASES,
        "decisionKinds": decision_kinds(),
        "statuses": {
            k: {**v, "raw": sorted(raws.get(k, []))}
            for k, v in STATUSES.items()
        },
    }


def self_check() -> list[str]:
    """Every mapping target exists, and every phase named is defined."""
    problems = []
    for raw, key in RAW_TO_KEY.items():
        if key not in STATUSES:
            problems.append(f"RAW_TO_KEY[{raw!r}] -> unknown status {key!r}")
    for key, meta in STATUSES.items():
        if meta["phase"] not in PHASES:
            problems.append(f"STATUSES[{key!r}] -> unknown phase {meta['phase']!r}")
        if meta["outcome"] not in (None, "granted", "rejected", "withdrawn",
                                   "returned"):
            problems.append(f"STATUSES[{key!r}] -> unknown outcome "
                            f"{meta['outcome']!r}")
        if meta.get("decision") not in (None, "ec", "tor", "form9", "unspecified"):
            problems.append(f"STATUSES[{key!r}] -> unknown decision "
                            f"{meta.get('decision')!r}")
        if meta.get("decision") and meta["outcome"] not in ("granted", "rejected"):
            problems.append(f"STATUSES[{key!r}] names a decision but has "
                            f"outcome {meta['outcome']!r}")
    return problems


if __name__ == "__main__":
    issues = self_check()
    print(f"{len(STATUSES)} canonical statuses, {len(RAW_TO_KEY)} source spellings, "
          f"{len(PHASES)} phases")
    if issues:
        for i in issues:
            print("  PROBLEM:", i)
        raise SystemExit(1)
    print("registry self-check passed")
