"""Forest proposal numbers, normalised - one rule for every reader.

Imported by build_data.py (the forest join), build_register_index.py (counting
each forest proposal once) and check_published.py. lib/instruments/links.ts
`fpNumbers` is the same rule for the screen.
"""
from __future__ import annotations

import re

FP_SPLIT = re.compile(r"[,;&]|\bAND\b")
FP_NO = re.compile(r"^FP/[A-Z0-9/._-]+$")


def fp_numbers(text: str | None) -> list[str]:
    """The forest proposal numbers in a form's free-typed field, normalised.

    The form's field is typed by the proponent: "FP/OR/ROAD/ 451983/2023"
    with a stray space, or two numbers separated by a comma. Matched exactly,
    only 134 of 277 named numbers were found in the forest register. Upper
    case, no whitespace, split on separators, and only what has the shape of a
    forest proposal number. lib/instruments/links.ts `fpNumbers` is the same
    rule, so the screen joins as the build does.
    """
    if not text:
        return []
    out = []
    for part in FP_SPLIT.split(str(text).upper()):
        no = re.sub(r"\s+", "", part)
        if FP_NO.match(no) and no not in out:
            out.append(no)
    return out
