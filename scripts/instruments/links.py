"""The other clearances a form declares, compacted for a shard row (`lk`).

Kept out of build_data.py so the rule that separates "unread", "answered
none" and "left blank" can be tested without a fetch cache (test_sync.py).
"""
from __future__ import annotations


# The questions whose answer the form may leave blank, by shard letter.
LINK_TOPICS = "fwepc"


def compact_links(caf: dict | None):
    """The form's linked clearances and land, compacted for a shard row.

    None when the form was not read by a reader that records them - unknown,
    and it must not read as "declares none".

    0 ONLY when the form was read and ANSWERED every question - forest
    clearance, wildlife board, eco-sensitive zone, protected area, coastal
    zone - and declared nothing. A question the form leaves blank is not a
    "no": 4,597 of the first 7,601 forms that compacted to 0 had every flag
    empty, and the page then told readers the forest-clearance rules did not
    apply to a project whose form never said. Blank topics travel as `u`, a
    string of their letters.

    Otherwise only the declared parts, so the common case costs a few
    characters a row.
    """
    if not caf or int(caf.get("v") or 1) < 4 or caf.get("links") is None:
        return None
    lk = caf["links"]
    out: dict = {}
    fc = lk.get("fc") or {}
    nb0 = lk.get("nbwl") or {}
    answered = {
        "f": (fc.get("involved") is not None or fc.get("approval_involved") is not None
              or bool(fc.get("proposal_no"))),
        "w": (nb0.get("required") is not None or bool(nb0.get("protected_area"))
              or bool(nb0.get("proposal_no"))),
        "e": lk.get("esz") is not None,
        "p": lk.get("protected_area") is not None,
        "c": lk.get("crz") is not None,
    }
    if fc.get("involved") or fc.get("proposal_no"):
        out["f"] = [fc.get("proposal_no"), fc.get("status"), fc.get("applied_ha"),
                    fc.get("diverted_ha"), fc.get("approved_on")]
    nb = lk.get("nbwl") or {}
    if nb.get("required") or nb.get("protected_area") or nb.get("proposal_no"):
        out["w"] = [nb.get("protected_area"), nb.get("status"), nb.get("proposal_no")]
    # Forest land the project ADDITIONALLY seeks. The `forest` column is the
    # forest land already held; a greenfield mine can hold none and seek
    # hundreds of hectares, and "no forest land" would then be false.
    add = ((caf.get("land") or {}).get("additional_forest") or 0)
    if isinstance(add, (int, float)) and add > 0:
        out["a"] = round(float(add), 4)
    if lk.get("esz"):
        out["e"] = 1
    if lk.get("protected_area"):
        out["p"] = 1
    if lk.get("crz"):
        out["c"] = [1, lk.get("crz_class")]
    tenure = [[t.get("type"), t.get("owner"), t.get("status")]
              for t in (lk.get("tenure") or [])
              if any(t.get(k) for k in ("type", "owner", "status"))]
    if tenure:
        out["t"] = tenure
    # A topic the form declared something under counts as answered even if
    # its flag is blank (a forest proposal number with no "involved" tick).
    blank = "".join(k for k in LINK_TOPICS if not answered[k] and k not in out)
    if blank:
        out["u"] = blank
    return out or 0
