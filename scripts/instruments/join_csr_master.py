"""The third join: Census 2011 districts <-> the Whitespace CSR master.

WHY THIS EXISTS
---------------
The plan (section 6.3) specifies three joins, each reporting its match rate and
its unmatched keys in the verification report. The first two - SHRUG to the
Census code, and a proposal to its district - feed everything the instrument
shows. This one feeds nothing yet: no instrument surface shows a CSR figure.
It is measured anyway, because the moment a feature wants CSR spend beside a
clearance profile, this join is what it will stand on, and a join whose match
rate nobody has measured is a join nobody can trust.

HOW
---
The CSR master is keyed on TODAY's 651 districts; this instrument on the 640 of
Census 2011. The master already records, for each post-2011 district, the 2011
district(s) it was carved from (`population_parent_districts`). So each CSR row
resolves to a Census 2011 code by its own name first and, failing that, by its
recorded parent - through the same Gazetteer the proposal resolver uses, so the
two joins cannot disagree about what a district name means.

States are matched the same way the Gazetteer matches them. A few states did
not exist in the 2011 frame (Telangana was part of Andhra Pradesh; Ladakh part
of Jammu & Kashmir; Dadra & Nagar Haveli and Daman & Diu were two territories),
so a row that does not resolve in its own state is tried in the 2011 state its
territory then belonged to. Nothing is guessed: an unresolved row is listed.

Run from the project root (reads only committed data):
  python scripts/instruments/join_csr_master.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from district_resolution import Gazetteer, normalize_name  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
MASTER = ROOT / "public" / "data" / "csr" / "whitespace_master.json"

# Today's state -> the state its territory belonged to in the 2011 frame.
# Keyed by normalize_name(), which strips "&", "and"-less punctuation and space.
_DNH_DD = ("Dadra & Nagar Haveli", "Daman & Diu")
STATES_IN_2011: dict[str, tuple[str, ...]] = {
    normalize_name("Telangana"): ("Andhra Pradesh",),
    normalize_name("Ladakh"): ("Jammu & Kashmir",),
    normalize_name("Dadra & Nagar Haveli & Daman & Diu"): _DNH_DD,
    normalize_name("Dadra and Nagar Haveli and Daman and Diu"): _DNH_DD,
    normalize_name("The Dadra and Nagar Haveli and Daman and Diu"): _DNH_DD,
}

# CSR-master names that are not a Census 2011 name, and the 2011 district each
# IS. Kept here, not in the shared Gazetteer, because they are facts about how
# the CSR master spells places, and the proposal resolver must not inherit them.
#   Sikkim renamed its four districts in 2021: East -> Gangtok, West ->
#   Gyalshing, North -> Mangan, South -> Namchi.
CSR_ALIASES: dict[tuple[str, str], str] = {
    ("sikkim", "gangtok"): "East",
    ("sikkim", "gyalshing"): "West",
    ("sikkim", "mangan"): "North",
    ("sikkim", "namchi"): "South",
    ("bihar", "saran"): "Saran (Chhapra)",
    ("odisha", "baudhboudh"): "Bauda",
    ("himachalpradesh", "lahulandspiti"): "Lahul & Spiti",
}


def _variants(name: str) -> list[str]:
    """The name as written, then each side of a parenthetical alternate.

    The CSR master writes a current and a former name together - "Nuh
    (Mewat)", "Khandwa (East Nimar)", "Bid (Beed)" - and the 2011 frame uses
    one of them. Both are tried; neither is invented.
    """
    out = [name]
    if "(" in name and name.rstrip().endswith(")"):
        outer, inner = name.split("(", 1)
        out += [outer.strip(), inner.rstrip(" )").strip()]
    return [v for v in out if v]


def _resolve(gaz: Gazetteer, name: str, state: str):
    """A district name in a state, trying the 2011 state it lay in if needed."""
    alias = CSR_ALIASES.get((normalize_name(state), normalize_name(name)))
    candidates = [alias] if alias else _variants(name)
    for cand in candidates:
        token = normalize_name(cand)
        for st in (state, *STATES_IN_2011.get(normalize_name(state), ())):
            row, method, _ = gaz.resolve(token, st)
            if row is not None:
                return row, method
    return None, None


def measure(gaz: Gazetteer, master: list[dict], census_codes: set[int]) -> dict:
    """Match statistics for the CSR master against the Census 2011 frame."""
    direct = via_parent = 0
    unmatched: list[str] = []
    covered: set[int] = set()
    for r in master:
        state, name = r.get("state_name") or "", r.get("district_name") or ""
        row, _ = _resolve(gaz, name, state)
        if row is not None:
            direct += 1
            covered.add(int(row["censuscode"]))
            continue
        parents = [p.strip() for p in str(r.get("population_parent_districts") or "")
                   .split(",") if p.strip()]
        hits = [h for h, _ in (_resolve(gaz, p, state) for p in parents) if h is not None]
        if hits:
            via_parent += 1
            covered.update(int(h["censuscode"]) for h in hits)
        else:
            unmatched.append(f"{state} / {name}")

    not_covered = sorted(census_codes - covered)
    return {
        "csr_districts": len(master),
        "matched_by_name": direct,
        "matched_by_recorded_parent": via_parent,
        "unmatched": len(unmatched),
        "unmatched_keys": sorted(unmatched),
        "match_rate_pct": round(100 * (direct + via_parent) / max(1, len(master)), 2),
        "census_districts": len(census_codes),
        "census_districts_covered": len(census_codes & covered),
        "census_coverage_pct": round(
            100 * len(census_codes & covered) / max(1, len(census_codes)), 2),
        "census_districts_not_covered": not_covered,
        "note": ("Measured, not used: no instrument surface shows a CSR figure. "
                 "A CSR district resolves by its own name, else by the 2011 "
                 "district the CSR master records it was carved from."),
    }


def main() -> int:
    gaz = Gazetteer.from_published()
    master = json.loads(MASTER.read_text(encoding="utf-8"))
    districts = json.loads((ROOT / "public" / "data" / "instruments" / "consent"
                            / "districts.json").read_text(encoding="utf-8"))
    stats = measure(gaz, master, {int(k) for k in districts})
    names = {int(k): f"{v['state_name']} / {v['district_name']}"
             for k, v in districts.items()}
    print(f"  CSR districts            {stats['csr_districts']}")
    print(f"  matched by name          {stats['matched_by_name']}")
    print(f"  matched by 2011 parent   {stats['matched_by_recorded_parent']}")
    print(f"  unmatched                {stats['unmatched']}  ({stats['match_rate_pct']}% matched)")
    for k in stats["unmatched_keys"]:
        print(f"      {k}")
    print(f"  Census 2011 districts covered {stats['census_districts_covered']}"
          f" of {stats['census_districts']} ({stats['census_coverage_pct']}%)")
    for c in stats["census_districts_not_covered"]:
        print(f"      {c:>4}  {names.get(c, '?')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
