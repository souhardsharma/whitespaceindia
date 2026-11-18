"""Name scrub for anganwadi centre names (verify-300-calendar, rule v1).

Publish rule: a centre is published by awc_id and awc_code. Its name is published only through scrub():
  1. WITHHOLD the whole name (return None) when it carries any sign that it names or locates a person:
     a possession marker (ka/ke/ki: "X ka darwaja"), a house or door word, a relation word (c/o, w/o, s/o, d/o,
     h/o, wife, son, pati, patni, putra ...), an honorific (shri, smt, mr, late ...), a phone label
     (mob, ph, contact ...), or a 10-digit number beginning 6-9 that is not the centre's own code.
     A withheld name is replaced by nothing; the centre is still published by its code.
  2. Otherwise strip every run of 7 or more digits (centre codes repeated in the name; never a person's) and
     collapse spaces. Short numbers (centre or ward numbers) stay.
Removing only the marker word would leave the person's name standing, so the rule never edits around a marker.
"""
from __future__ import annotations

import re

_W = r"(?<![A-Za-z])(?:{})(?![A-Za-z])"
POSSESSION = re.compile(_W.format(r"ka|ke|ki|kaa|kee|ka\.|ke\."), re.I)
HOUSE = re.compile(_W.format(
    r"house|houses|home|ghar|gher|makan|makaan|mkan|darwaja|darwaje|darwaza|darwaze|dwar|dalan|dalaan|angan|aangan|"
    r"niwas|nivas|niwash|nivash|residence|resi|bari|barir|bati|veedu|illu|mane|bhavanam|kothi|haveli|quarter"), re.I)
RELATION = re.compile(r"(?<![A-Za-z])(?:c|w|s|d|h)\s*/\s*o(?![A-Za-z])|" + _W.format(
    r"ho|h\.o|wife|son|daughter|husband|father|mother|pita|pati|patni|putra|putri|beti|beta|bahu|alias|urf"), re.I)
HONORIFIC = re.compile(_W.format(r"shri|shree|sri|smt|srimati|shrimati|shrimti|mr|mrs|ms|late|lt|dr|sh"), re.I)
PERSON = re.compile(_W.format(  # given-name and surname words that, standing alone, name a person
    r"devi|kumari|kumar|bai|ben|begum|khatun|khatoon|bibi|singh|aww|awh|worker|sevika|sahayika|didi|"
    r"prasad|lal|das|mondal|mandal|yadav|sharma|naskar|ram"), re.I)
PHONE_LABEL = re.compile(_W.format(r"mob|mobile|mo|ph|phone|contact|cell|tel|mob\.no|mno"), re.I)
PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{9}(?!\d)")
LONG_DIGITS = re.compile(r"\d{7,}")

REASONS = ("phone_number", "phone_label", "relation", "honorific", "house", "possession", "person_word")


def reasons(name: str, code: str = "") -> list[str]:
    out = []
    for m in PHONE.finditer(name):
        digits = re.sub(r"\D", "", m.group(0))[-10:]
        if digits not in (code or ""):
            out.append("phone_number")
            break
    for key, pat in (("phone_label", PHONE_LABEL), ("relation", RELATION), ("honorific", HONORIFIC),
                     ("house", HOUSE), ("possession", POSSESSION), ("person_word", PERSON)):
        if pat.search(name):
            out.append(key)
    return out


def scrub(name: str | None, code: str = "") -> str | None:
    if not name:
        return None
    if reasons(name, code):
        return None
    s = LONG_DIGITS.sub(" ", name)
    s = re.sub(r"\s+", " ", s).strip(" -_,.;:/")
    return s or None


def classify(name: str | None, code: str = "") -> tuple[str, list[str]]:
    """'withheld' | 'stripped' | 'unchanged' | 'empty', with reasons."""
    if not name:
        return "empty", []
    r = reasons(name, code)
    if r:
        return "withheld", r
    s = scrub(name, code)
    return ("unchanged" if s == re.sub(r"\s+", " ", name).strip(" -_,.;:/") else "stripped"), []
