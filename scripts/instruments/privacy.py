"""What is removed from a public record before it is republished, and why.

THE LINE THIS DRAWS
-------------------
The clearance register is a public record of who has applied to build what, and
where. Naming the proponent is the point of it: a company or an individual
applying for a clearance is a party to a public regulatory proceeding, and
redacting them would defeat the register rather than protect anyone. Proponent
names are therefore published as filed.

The officials who processed a file are a different matter, and are not
published. Which officer handled which application is incidental to the record
- the public interest is in what the authority decided and how long it took -
and publishing named civil servants against processing times would invite
exactly the reading this instrument refuses to support. See
fetch_process_history.py, where they are dropped before anything reaches disk.

A contact detail is neither of those. Where a filing carries an email address
or a telephone number in a free-text field it is almost always a data-entry
slip: one proposal in the register has an applicant's personal email address
typed into the project-name box. It conveys nothing about the project and is a
direct means of reaching a private person, so it is removed. Identity in a
public proceeding is disclosed; a way to contact someone is not.

The project title itself is reproduced as filed, apart from those details. It
is the official name of a public application, and rewriting it - to remove a
patronymic, say - would put the instrument in the position of editing the
record it exists to report.

WHY THE PATTERNS ARE NARROW
---------------------------
A permissive pattern does real damage here. Allowing a separator between any
two digits makes "SBP(64800-87600TPA)" - a production-capacity range inside a
project title - indistinguishable from "98765-43210", and an earlier version
replaced exactly that with a privacy notice inside a published project name.

So a bare ten-digit number is matched only when nothing numeric abuts it, and a
number written with separators is matched only when the surrounding text says
what it is. Measured over all 115,272 register records, the corpus contains no
bare mobile number at all and two email addresses, so the narrow reading costs
nothing real and the broad one was corrupting titles.

  used by: build_data.py (removal), check_published.py (verification)
"""
from __future__ import annotations

import re

REDACTED = "[contact detail removed]"

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

# Ten digits beginning 6-9 with nothing numeric adjacent, optionally behind an
# explicit +91. A capacity range or a khasra number cannot imitate this,
# because both carry a digit or a hyphen on at least one side.
PHONE_RE = re.compile(r"(?<![\d-])(?:\+?91[\s-]?)?[6-9]\d{9}(?![\d-])")

# The same ten digits written with separators, but only where the text says
# what they are. The label removes the ambiguity that makes the bare form
# unsafe to match loosely.
LABELLED_PHONE_RE = re.compile(
    r"(?i:(?:phone|mobile|mob|tel|contact|call|whatsapp)"
    r"\s*(?:\.|:|-|no\.?|number)?\s*)"
    r"(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}")


def find_contact(text: object) -> list[str]:
    """Every contact detail in a value. Empty when there is none."""
    if not isinstance(text, str) or not text:
        return []
    return (EMAIL_RE.findall(text)
            + LABELLED_PHONE_RE.findall(text)
            + PHONE_RE.findall(text))


def scrub_contact(text: object) -> tuple[object, bool]:
    """Strip contact details from a free-text field. Returns (value, changed).

    Order matters: the labelled pattern runs before the bare one so a labelled
    number is replaced whole rather than leaving its label behind.
    """
    if not isinstance(text, str) or not text:
        return text, False
    out = EMAIL_RE.sub(REDACTED, text)
    out = LABELLED_PHONE_RE.sub(REDACTED, out)
    out = PHONE_RE.sub(REDACTED, out)
    out = " ".join(out.split())
    return (out or REDACTED), out != " ".join(text.split())
