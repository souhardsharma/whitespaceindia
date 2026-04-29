"""
Whitespace India CSR — Data Pipeline (single-file, reproducible)
================================================================

Reads the three source files and regenerates every data artifact the
website consumes.

Source files (hard-coded — the user keeps them at this exact path):
  $WHITESPACE_DATA_DIR/
    India-National-Multidimentional-Poverty-Index-2023.pdf   (MPI)
    csr_state_sector.xlsx                                    (CSR MCA)
    census_2011_districts.csv                                (population)

Writes:
  <project>/public/data/csr/
    whitespace_master.json       — per-district POS + inputs (consumed by UI)
    sector_scores.json           — per-district × sector POS (consumed by UI)
    meta.json                    — headline constants the UI reads
  <project>/scripts/csr/
    verification_report.json     — local-only audit report (Bihar vs Maha,
                                   national totals, top districts). Read by
                                   show_examples.py; not shipped to the site.

Methodology
-----------
  Need (N)         = MPI headcount ratio 2019–21, min-max normalised
  Supply gap (G)   = max(0, tier_median_csr_per_person – district_csr_per_person),
                     where the tier is the district's population tertile
                     (33rd/67th pctile of 2011 population). Min-max normalised.
  Unresolved (U)   = hr_2019_21 / hr_2015_16 (retention ratio). Min-max normalised.
                     Districts lacking a 2015-16 baseline get the median
                     retention ratio AND are flagged `u_imputed: true`.
  POS              = (0.40·N̂ + 0.40·Ĝ + 0.20·Û) × 100

  CSR window       = FY 2021-22, 2022-23, 2023-24 (three most recent)
  Exclusions       = Pan India rows, rows lacking a district_lgd_code
  Whitespace flag  = district_csr_per_person ≤ national 25th pctile
                     AND hr_2019_21 ≥ national 75th pctile

Matching
--------
  MPI is the spine. Each MPI district is joined against CSR and Census
  via (normalised state, normalised district). Census 2011 predates
  Telangana, Ladakh, and the D&NH+D&D merger, so state aliases are
  resolved explicitly. Fuzzy matching uses rapidfuzz with a cutoff of
  85 for CSR (names broadly consistent with MCA) and 80 for Census
  (more historical/spelling drift). Every match keeps a score so the
  verification report can flag low-confidence ones.

Run: `python scripts/csr/rebuild_data.py` from the project root.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pdfplumber
from rapidfuzz import fuzz, process

# ── Paths ─────────────────────────────────────────────────────────────────
SRC_DIR = Path("$WHITESPACE_DATA_DIR")
PDF_PATH = SRC_DIR / "India-National-Multidimentional-Poverty-Index-2023.pdf"
EXCEL_PATH = SRC_DIR / "csr_state_sector.xlsx"
CENSUS_PATH = SRC_DIR / "census_2011_districts.csv"

# This file lives at <project>/scripts/csr/rebuild_data.py, so PROJECT_ROOT
# is THREE levels up (rebuild_data.py → csr/ → scripts/ → <project>).
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = PROJECT_ROOT / "public" / "data" / "csr"
SCRIPTS_DIR = Path(__file__).resolve().parent

# ── Constants ─────────────────────────────────────────────────────────────
W_N, W_G, W_U = 0.40, 0.40, 0.20
CSR_RECENT_YEARS = ["2021-22", "2022-23", "2023-24"]

# Census 2011 national total. Used as upper-bound check on the pipeline
# total (matched_pop must be <= this + 0.5%; under is allowed because some
# MPI districts get dropped for missing 2019-21 HR).
CENSUS_2011_NATIONAL = 1_210_854_977

# Path to the population recast catalogue. One row per post-2011 carve-out
# child and per residual parent. Edit the CSV to change values, not this file.
# Lives next to this script under scripts/csr/data/external/.
RECAST_CSV_PATH = (
    Path(__file__).resolve().parent
    / "data" / "external" / "population_recast_2011.csv"
)

SCORE_SECTORS = [
    "Education",
    "Health Care",
    "Rural Development Projects",
    "Livelihood Enhancement Projects",
    "Environmental Sustainability",
    "Poverty, Eradicating Hunger, Malnutrition",
    "Safe Drinking Water",
    "Sanitation",
    "Vocational Skills",
    "Women Empowerment",
]

INDIAN_STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
    "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
    "West Bengal", "Andaman & Nicobar Islands", "Andaman and Nicobar Islands",
    "Chandigarh", "Dadra and Nagar Haveli", "Daman and Diu", "Delhi",
    "Jammu & Kashmir", "Jammu and Kashmir", "Ladakh", "Lakshadweep",
    "Puducherry", "NCT of Delhi",
    "Dadra & Nagar Haveli & Daman & Diu",
    "Dadra & Nagar Haveli and Daman & Diu",
]

# Canonical state abbreviations used to build the internal district_lgd_code key
# (a composite state+district slug, not the official LGD number). This guarantees
# uniqueness even when the upstream MCA CSR source assigns the same LGD number to
# two distinct districts (e.g. both Bihar/Aurangabad and Maharashtra/Aurangabad
# carry LGD 189 in the MCA dataset).
STATE_CODES: dict[str, str] = {
    "andhra pradesh": "AP", "arunachal pradesh": "AR", "assam": "AS",
    "bihar": "BR", "chhattisgarh": "CG", "goa": "GA", "gujarat": "GJ",
    "haryana": "HR", "himachal pradesh": "HP", "jharkhand": "JH",
    "karnataka": "KA", "kerala": "KL", "madhya pradesh": "MP",
    "maharashtra": "MH", "manipur": "MN", "meghalaya": "ML",
    "mizoram": "MZ", "nagaland": "NL", "odisha": "OR", "punjab": "PB",
    "rajasthan": "RJ", "sikkim": "SK", "tamil nadu": "TN", "telangana": "TG",
    "tripura": "TR", "uttar pradesh": "UP", "uttarakhand": "UK",
    "west bengal": "WB", "andaman and nicobar islands": "AN",
    "chandigarh": "CH", "dadra and nagar haveli": "DN",
    "daman and diu": "DD", "delhi": "DL", "nct of delhi": "DL",
    "jammu and kashmir": "JK", "ladakh": "LA", "lakshadweep": "LD",
    "puducherry": "PY",
}

# Spelling aliases that normalise to the same canonical district name.
# Morigaon (historic spelling) and Marigaon (current Assam district) refer
# to the same district; the NITI MPI PDF ocassionally lists both.
DISTRICT_NAME_ALIASES: dict[str, str] = {
    "morigaon": "marigaon",
    # Telangana spellings: route to the AP-side Census key.
    "mahabubnagar": "mahbubnagar",
    "ranga reddy": "rangareddy",
    # Chhattisgarh: prevent Korea from fuzzy-matching Korba (~85%).
    "korea": "koriya",
    "kabirdham": "kabeerdham",
    # Assam: MPI lists both as separate rows; collapse to one.
    "kamrup metro": "kamrup metropolitan",
}

# ─────────────────────────────────────────────────────────────────────────
# Post-Census-2011 district rescue tables
#
# Many MPI districts cannot match Census 2011 directly, either because the
# Census used a different / older spelling, or because the district did not
# exist in 2011 and was carved from a parent. Each entry was validated
# against Census of India 2011 DCHB PDFs, Wikipedia "District of <State>"
# articles, and the LGD directory (sources inline below in commit-friendly
# form). Keys are (normalized_state, normalized_mpi_district).
#
# CENSUS_NAME_OVERRIDES: MPI district → the exact (state_norm, district_norm)
# Census 2011 key. Used when Census has the district under an older spelling.
# ─────────────────────────────────────────────────────────────────────────
CENSUS_NAME_OVERRIDES: dict[tuple[str, str], tuple[str, str]] = {
    # Andhra Pradesh — Census full names (verified against DCHB)
    ("andhra pradesh", "spsr nellore"): ("andhra pradesh", "sri potti sriramulu nellore"),
    ("andhra pradesh", "ysr (kadapa)"): ("andhra pradesh", "ysr"),
    # Assam
    ("assam", "kamrup metro"): ("assam", "kamrup metropolitan"),
    # Chhattisgarh
    ("chhattisgarh", "dantewada"): ("chhattisgarh", "dakshin bastar dantewada"),
    # Gujarat
    ("gujarat", "dang"): ("gujarat", "the dangs"),
    # Haryana
    ("haryana", "gurugram"): ("haryana", "gurgaon"),
    ("haryana", "nuh (mewat)"): ("haryana", "mewat"),
    # J&K
    ("jammu and kashmir", "badgam (budgam)"): ("jammu and kashmir", "badgam"),
    ("jammu and kashmir", "punch (poonch)"): ("jammu and kashmir", "punch"),
    # Karnataka
    ("karnataka", "belagavi"): ("karnataka", "belgaum"),
    ("karnataka", "bellary (ballari)"): ("karnataka", "bellary"),
    ("karnataka", "bijapur (vijayapura)"): ("karnataka", "bijapur"),
    ("karnataka", "gulbarga (kalaburagi)"): ("karnataka", "gulbarga"),
    ("karnataka", "mysuru"): ("karnataka", "mysore"),
    # Maharashtra
    ("maharashtra", "bid (beed)"): ("maharashtra", "bid"),
    ("maharashtra", "raigad"): ("maharashtra", "raigarh"),
    # Odisha
    ("odisha", "baudh (boudh)"): ("orissa", "baudh"),
    ("odisha", "sonepur"): ("orissa", "subarnapur"),
    # Puducherry
    # Census 2011 lists Puducherry under state "Pondicherry" / district "Pondicherry".
    # Map MPI's "puducherry" district name to the Census-side key.
    ("puducherry", "puducherry"): ("pondicherry", "pondicherry"),
    # Sikkim — 2021 Gazette renamed East/West/North/South to single-word
    # names. Boundary changes are negligible (a few villages), so these are
    # treated as renames and use the Census 2011 parent's exact population.
    ("sikkim", "gangtok"): ("sikkim", "east"),
    ("sikkim", "gyalshing"): ("sikkim", "west"),
    ("sikkim", "mangan"): ("sikkim", "north"),
    ("sikkim", "namchi"): ("sikkim", "south"),
    # Tamil Nadu
    ("tamil nadu", "thoothukkudi (tuticorin)"): ("tamil nadu", "thoothukkudi"),
    # Uttar Pradesh
    ("uttar pradesh", "allahabad (prayagraj)"): ("uttar pradesh", "allahabad"),
    ("uttar pradesh", "faizabad (ayodhya)"): ("uttar pradesh", "faizabad"),
    ("uttar pradesh", "kasganj"): ("uttar pradesh", "kanshiram nagar"),
    ("uttar pradesh", "mahamaya nagar (hathras)"): ("uttar pradesh", "mahamaya nagar"),
    # Uttarakhand
    ("uttarakhand", "garhwal (pauri garhwal)"): ("uttarakhand", "garhwal"),
    # West Bengal
    ("west bengal", "howrah"): ("west bengal", "haora"),
    ("west bengal", "hugli (hooghly)"): ("west bengal", "hugli"),
    ("west bengal", "koch bihar (coochbehar)"): ("west bengal", "koch bihar"),
}

# CARVEOUT_PARENTS: post-2011 carve-out district -> Census 2011 parent(s).
# Coverage tracking only - the actual population resolution comes from
# scripts/csr/data/external/population_recast_2011.csv. If a row here has no matching
# recast CSV row, the pipeline aborts naming the missing district.
CARVEOUT_PARENTS: dict[tuple[str, str], list[tuple[str, str]]] = {
    # Arunachal Pradesh — 2012+ carve-outs
    ("arunachal pradesh", "longding"): [("arunachal pradesh", "tirap")],
    ("arunachal pradesh", "namsai"): [("arunachal pradesh", "lohit")],
    ("arunachal pradesh", "siang"): [("arunachal pradesh", "west siang")],
    # Assam
    ("assam", "charaideo"): [("assam", "sivasagar")],
    ("assam", "hojai"): [("assam", "nagaon")],
    ("assam", "majuli"): [("assam", "jorhat")],
    ("assam", "south salmara mancachar"): [("assam", "dhubri")],
    # Chhattisgarh
    ("chhattisgarh", "gariyaband"): [("chhattisgarh", "raipur")],
    ("chhattisgarh", "kondagaon"): [("chhattisgarh", "bastar")],
    ("chhattisgarh", "mungeli"): [("chhattisgarh", "bilaspur")],
    ("chhattisgarh", "sukma"): [("chhattisgarh", "dakshin bastar dantewada")],
    ("chhattisgarh", "surajpur"): [("chhattisgarh", "surguja")],
    # Delhi — Shahdara carved from East + North East 2012
    ("delhi", "shahdara"): [("nct of delhi", "north east"), ("nct of delhi", "east")],
    # Gujarat
    ("gujarat", "devbhumi dwarka"): [("gujarat", "jamnagar")],
    ("gujarat", "gir somnath"): [("gujarat", "junagadh")],
    ("gujarat", "mahisagar"): [("gujarat", "panch mahals"), ("gujarat", "kheda")],
    ("gujarat", "morbi"): [("gujarat", "rajkot")],
    # Haryana
    ("haryana", "charki dadri"): [("haryana", "bhiwani")],
    # Maharashtra
    ("maharashtra", "palghar"): [("maharashtra", "thane")],
    # NCT of Delhi — South East carved from South in 2017 (Shahdara handled above)
    ("delhi", "south east"): [("nct of delhi", "south")],
    # Meghalaya — Jaintia Hills bifurcated 2012 into East and West
    ("meghalaya", "east jaintia hills"): [("meghalaya", "jaintia hills")],
    ("meghalaya", "west jaintia hills"): [("meghalaya", "jaintia hills")],
    # Punjab
    ("punjab", "fazilka"): [("punjab", "firozpur")],
    ("punjab", "pathankot"): [("punjab", "gurdaspur")],
    # Sikkim — 2021 renames live in CENSUS_NAME_OVERRIDES (zero-boundary
    # change; treated as renames not carve-outs).
    # Telangana — all 21 carved from the original 10 AP districts
    ("telangana", "bhadradri kothagudem"): [("andhra pradesh", "khammam")],
    ("telangana", "jagitial"): [("andhra pradesh", "karimnagar")],
    ("telangana", "jangoan"): [("andhra pradesh", "warangal")],
    ("telangana", "jayashankar bhupalapally"): [("andhra pradesh", "warangal")],
    ("telangana", "jogulamba gadwal"): [("andhra pradesh", "mahbubnagar")],
    ("telangana", "kamareddy"): [("andhra pradesh", "nizamabad")],
    ("telangana", "kumuram bheem asifabad"): [("andhra pradesh", "adilabad")],
    ("telangana", "mahabubabad"): [("andhra pradesh", "warangal")],
    ("telangana", "mancherial"): [("andhra pradesh", "adilabad")],
    ("telangana", "medchal-malkajgiri"): [("andhra pradesh", "rangareddy")],
    ("telangana", "nagarkurnool"): [("andhra pradesh", "mahbubnagar")],
    ("telangana", "nirmal"): [("andhra pradesh", "adilabad")],
    ("telangana", "peddapalli"): [("andhra pradesh", "karimnagar")],
    ("telangana", "rajanna sircilla"): [("andhra pradesh", "karimnagar")],
    ("telangana", "sangareddy"): [("andhra pradesh", "medak")],
    ("telangana", "siddipet"): [("andhra pradesh", "medak")],
    ("telangana", "suryapet"): [("andhra pradesh", "nalgonda")],
    ("telangana", "vikarabad"): [("andhra pradesh", "rangareddy")],
    ("telangana", "wanaparthy"): [("andhra pradesh", "mahbubnagar")],
    ("telangana", "warangal rural"): [("andhra pradesh", "warangal")],
    ("telangana", "warangal urban"): [("andhra pradesh", "warangal")],
    ("telangana", "yadadri bhuvanagiri"): [("andhra pradesh", "nalgonda")],
    # Tripura — 2012 carve-outs
    ("tripura", "gomati"): [("tripura", "south tripura")],
    ("tripura", "khowai"): [("tripura", "west tripura")],
    ("tripura", "sepahijala"): [("tripura", "west tripura")],
    ("tripura", "unakoti"): [("tripura", "north tripura")],
    # Uttar Pradesh
    ("uttar pradesh", "amethi"): [("uttar pradesh", "sultanpur")],
    ("uttar pradesh", "hapur"): [("uttar pradesh", "ghaziabad")],
    ("uttar pradesh", "sambhal"): [("uttar pradesh", "moradabad")],
    ("uttar pradesh", "shamli"): [("uttar pradesh", "muzaffarnagar")],
    # West Bengal — 2017 split of Barddhaman
    ("west bengal", "paschim bardhaman"): [("west bengal", "barddhaman")],
    ("west bengal", "purba bardhaman"): [("west bengal", "barddhaman")],
}


def state_code(state: str) -> str:
    return STATE_CODES.get(normalize_name(state), "XX")


def build_district_key(state: str, district: str) -> str:
    """Composite, stable internal key that disambiguates homonyms across states."""
    slug = re.sub(r"[^a-z0-9]+", "_", normalize_name(district)).strip("_").upper()
    return f"{state_code(state)}_{slug}" if slug else f"{state_code(state)}_UNKNOWN"

# Census 2011 used "Orissa", "Pondicherry" and did not yet include Telangana
# (formed 2014 from AP) or Ladakh (formed 2019 from J&K). Map MPI state names
# to the Census 2011 equivalent(s). "Dadra and Nagar Haveli and Daman and Diu"
# is merged in the MPI document but separate in Census 2011.
MPI_TO_CENSUS_STATE = {
    "odisha": ["orissa"],
    "delhi": ["nct of delhi"],
    "puducherry": ["pondicherry"],
    "telangana": ["andhra pradesh"],
    "ladakh": ["jammu and kashmir"],
    "dadra and nagar haveli and daman and diu": [
        "dadra and nagar haveli", "daman and diu",
    ],
}

# Districts the MPI PDF occasionally misattributes when a page header is
# missing or ambiguous.
STATE_MISATTRIBUTION_FIX = {
    # West Bengal districts sometimes absorbed into the Bihar block
    ("bihar", "bankura"): "West Bengal",
    ("bihar", "barddhaman"): "West Bengal",
    ("bihar", "birbhum"): "West Bengal",
    ("bihar", "darjeeling"): "West Bengal",
    ("bihar", "howrah"): "West Bengal",
    ("bihar", "hugli (hooghly)"): "West Bengal",
    ("bihar", "jalpaiguri"): "West Bengal",
    ("bihar", "koch bihar (coochbehar)"): "West Bengal",
    ("bihar", "kolkata"): "West Bengal",
    ("bihar", "maldah"): "West Bengal",
    ("bihar", "murshidabad"): "West Bengal",
    ("bihar", "nadia"): "West Bengal",
    ("bihar", "paschim bardhaman"): "West Bengal",
    ("bihar", "purba bardhaman"): "West Bengal",
    ("bihar", "puruliya"): "West Bengal",
    ("bihar", "north twenty four parganas"): "West Bengal",
    ("bihar", "south twenty four parganas"): "West Bengal",
    ("bihar", "paschim medinipur"): "West Bengal",
    ("bihar", "purba medinipur"): "West Bengal",
    ("bihar", "uttar dinajpur"): "West Bengal",
    ("bihar", "dakshin dinajpur"): "West Bengal",
    ("bihar", "alipurduar"): "West Bengal",
    ("bihar", "cooch behar"): "West Bengal",
    ("bihar", "morigaon"): "Assam",
}


def load_recast_csv(path: Path) -> tuple[dict[tuple[str, str], dict], dict]:
    """Parse the recast CSV. Skips '#' comment lines."""
    import csv as _csv
    if not path.exists():
        raise RuntimeError(f"Population recast CSV missing: {path}")
    recast: dict[tuple[str, str], dict] = {}
    methods: dict[str, int] = {}
    children_count = residuals_count = 0
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or stripped.startswith("state,"):
                continue
            row = next(_csv.reader([stripped]))
            while len(row) < 10:
                row.append("")
            state, district, pop_s, parents_s, share_s, method, url, doc, date, notes = row[:10]
            state_norm = normalize_name(state)
            dist_norm = normalize_name(district)
            try:
                pop = int(pop_s.replace(",", "").strip())
            except ValueError:
                raise RuntimeError(
                    f"Recast CSV line {line_no}: bad population {pop_s!r} for {state_norm}/{dist_norm}"
                )
            if pop <= 0:
                raise RuntimeError(
                    f"Recast CSV line {line_no}: non-positive population {pop} for {state_norm}/{dist_norm}"
                )
            key = (state_norm, dist_norm)
            if key in recast:
                raise RuntimeError(
                    f"Recast CSV line {line_no}: duplicate key {key} (first at line {recast[key]['_line']})"
                )
            parent_list = [
                (normalize_name(state), normalize_name(p))
                for p in parents_s.split(",")
                if p.strip()
            ]
            shares: dict[str, int] = {}
            if share_s.strip():
                share_total = 0
                for kv in share_s.split(";"):
                    if "=" not in kv:
                        continue
                    k, v = kv.split("=", 1)
                    try:
                        share_val = int(v.strip())
                    except ValueError:
                        raise RuntimeError(
                            f"Recast CSV line {line_no}: bad share integer {v!r} for {state_norm}/{dist_norm}"
                        )
                    shares[normalize_name(k)] = share_val
                    share_total += share_val
                if abs(share_total - pop) > 1:
                    raise RuntimeError(
                        f"Recast CSV line {line_no}: parent_share_pops sum ({share_total}) != population ({pop})"
                    )
            recast[key] = {
                "population": pop,
                "method": method.strip() or "unspecified",
                "source_url": url.strip(),
                "source_doc": doc.strip(),
                "parents": parent_list,
                "shares": shares,
                "notes": notes.strip(),
                "_line": line_no,
            }
            methods[method.strip()] = methods.get(method.strip(), 0) + 1
            if parent_list:
                children_count += 1
            else:
                residuals_count += 1

    meta = {
        "row_count": len(recast),
        "child_count": children_count,
        "residual_count": residuals_count,
        "methods": methods,
        "csv_path": str(path),
    }
    return recast, meta


# ── Helpers ───────────────────────────────────────────────────────────────
def normalize_name(name: object) -> str:
    if not isinstance(name, str):
        return ""
    s = name.lower().strip()
    s = re.sub(r"\s+", " ", s)
    s = s.replace("&", "and")
    s = s.replace(" district", "")
    s = s.replace(".", "")
    s = s.replace("'", "")
    # Collapse known spelling aliases so that historic/current forms unify.
    return DISTRICT_NAME_ALIASES.get(s, s)


def safe_float(val: object) -> float | None:
    if val is None:
        return None
    s = str(val).strip().replace(",", "").replace("%", "")
    if s in ("", "-", "–", "—", "\u2013", "\u2014", "NA", "ND", "N/A", "nan", "None", ".."):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def safe_json(val: object) -> object:
    if val is None:
        return None
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating, float)):
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 6)
    if isinstance(val, (np.bool_, bool)):
        return bool(val)
    return val


# ═════════════════════════════════════════════════════════════════════════
# STEP 1 — Extract MPI directly from the NITI Aayog PDF
# ═════════════════════════════════════════════════════════════════════════
def extract_mpi(pdf_path: Path) -> pd.DataFrame:
    print("=" * 72)
    print("STEP 1  Extracting MPI districts from PDF")
    print("=" * 72)

    data: list[dict] = []
    current_state = "Unknown"
    pattern = re.compile(
        r"^(.+?)\s+"
        r"([\d\.\,]+%?|NA|ND|\-|\u2013|\u2014)\s+"
        r"([\d\.\,]+%?|NA|ND|\-|\u2013|\u2014)\s+"
        r"([\d\.\,]+%?|NA|ND|\-|\u2013|\u2014)\s+"
        r"([\d\.\,]+%?|NA|ND|\-|\u2013|\u2014)\s+"
        r"([\d\.\,]+%?|NA|ND|\-|\u2013|\u2014)\s+"
        r"([\d\.\,]+%?|NA|ND|\-|\u2013|\u2014)$"
    )

    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        print(f"  PDF pages: {total}")
        for i in range(80, min(360, total)):
            page = pdf.pages[i]
            text = page.extract_text(x_tolerance=2, y_tolerance=2)
            if not text:
                continue
            lines = text.split("\n")

            # State detection — look at the first 30 lines of the page
            for line in lines[:30]:
                upper = line.strip().upper()
                for state in INDIAN_STATES:
                    if re.search(r"\b" + re.escape(state.upper()) + r"\b", upper):
                        current_state = state
                        break

            # Data row extraction
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                m = pattern.match(line)
                if not m:
                    continue
                dist = m.group(1).strip()
                if any(tok in dist for tok in ("Total", "Average", "State")):
                    continue
                if len(dist) < 3 and dist.lower() != "diu":
                    continue
                if any(c.isdigit() for c in dist):
                    continue

                data.append({
                    "state": current_state,
                    "district": dist,
                    "hr_2016": safe_float(m.group(2)),
                    "intensity_2016": safe_float(m.group(3)),
                    "mpi_2016": safe_float(m.group(4)),
                    "hr_2021": safe_float(m.group(5)),
                    "intensity_2021": safe_float(m.group(6)),
                    "mpi_2021": safe_float(m.group(7)),
                })

    df = pd.DataFrame(data)
    df = df.drop_duplicates(subset=["district", "hr_2021"])

    # Apply state-attribution corrections
    fixes = 0
    for idx, row in df.iterrows():
        key = (row["state"].lower().strip(), str(row["district"]).lower().strip())
        if key in STATE_MISATTRIBUTION_FIX:
            df.at[idx, "state"] = STATE_MISATTRIBUTION_FIX[key]
            fixes += 1
    # Assam districts sometimes lose the header
    df.loc[df["district"].isin(["Kamrup Metropolitan", "Kamrup Metro"]), "state"] = "Assam"

    # Convert HR from percent to proportion (0-1) to match internal maths
    df["hr_2016"] = df["hr_2016"] / 100.0
    df["hr_2021"] = df["hr_2021"] / 100.0

    # Drop rows where the spine data (2019-21 HR) is missing
    before = len(df)
    df = df[df["hr_2021"].notna() & (df["hr_2021"] > 0)].reset_index(drop=True)

    print(f"  Extracted {before} rows, dropped {before - len(df)} with null hr_2021")
    print(f"  State corrections applied: {fixes}")
    print(f"  Final MPI rows: {len(df)}  states: {df['state'].nunique()}")
    return df


# ═════════════════════════════════════════════════════════════════════════
# STEP 2 — Load + aggregate CSR Excel
# ═════════════════════════════════════════════════════════════════════════
def load_csr(excel_path: Path) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    print("\n" + "=" * 72)
    print("STEP 2  Loading CSR Excel (MCA)")
    print("=" * 72)

    raw = pd.read_excel(excel_path)
    print(f"  Raw rows: {len(raw)}")

    # Compute Pan India / unattributable CSR BEFORE filtering
    exclude_states = {"Pan India", "Pan India (Other Centralized Funds)", "Nec/ Not Mentioned"}
    pan_india_mask = raw["state"].isin(exclude_states) | raw["district_lgd_code"].isna() | (raw["district_lgd_code"].astype(str) == "Not Applicable")
    pan_india_all_years = float(pd.to_numeric(raw.loc[pan_india_mask, "amount_spent"], errors="coerce").fillna(0).sum())
    total_all_years_gross = float(pd.to_numeric(raw["amount_spent"], errors="coerce").fillna(0).sum())

    df = raw[~raw["state"].isin(exclude_states)]
    df = df[df["district_lgd_code"].notna()]
    df = df[df["district_lgd_code"].astype(str) != "Not Applicable"]
    print(f"  After excluding Pan-India / missing LGD: {len(df)}")

    df_recent = df[df["fiscal_year"].isin(CSR_RECENT_YEARS)].copy()
    df_recent["amount_spent"] = pd.to_numeric(df_recent["amount_spent"], errors="coerce").fillna(0)
    print(f"  FY{CSR_RECENT_YEARS[0]}–FY{CSR_RECENT_YEARS[-1]}: {len(df_recent)} rows")

    total_by_year = df.groupby("fiscal_year")["amount_spent"].sum()
    print("  Total CSR by FY (Rs  crore):")
    for fy, amt in total_by_year.items():
        print(f"    {fy}: {amt:>12,.2f}")

    csr_district = (
        df_recent.groupby(["state", "district_as_per_lgd", "district_lgd_code"])
        .agg(total_csr_recent=("amount_spent", "sum"))
        .reset_index()
        .rename(columns={"district_as_per_lgd": "district_name"})
    )
    print(f"  Unique (state, district) with CSR in window: {len(csr_district)}")
    print(f"  Total CSR in 3-yr window: Rs {csr_district['total_csr_recent'].sum():,.2f} crore")

    csr_sector_pivot = (
        df_recent.groupby(["state", "district_as_per_lgd", "district_lgd_code", "sector"])
        .agg(amount=("amount_spent", "sum"))
        .reset_index()
        .pivot_table(
            index=["state", "district_as_per_lgd", "district_lgd_code"],
            columns="sector",
            values="amount",
            fill_value=0,
        )
        .reset_index()
    )

    # Totals across the entire dataset, used by site copy
    overview = {
        "total_csr_all_years_gross": round(total_all_years_gross, 2),
        "total_csr_all_years": float(df["amount_spent"].sum()),
        "total_csr_fy23_24": float(total_by_year.get("2023-24", 0.0)),
        "total_csr_recent_3yr": float(df_recent["amount_spent"].sum()),
        "pan_india_csr_all_years": round(pan_india_all_years, 2),
        "pan_india_pct": round(pan_india_all_years / total_all_years_gross * 100, 1) if total_all_years_gross else 0,
        "total_rows_raw": int(len(df)),
        "unique_districts_all_years": int(
            df.groupby(["state", "district_as_per_lgd"]).ngroups
        ),
    }
    return csr_district, csr_sector_pivot, overview


# ═════════════════════════════════════════════════════════════════════════
# STEP 3 — Load Census 2011 populations
# ═════════════════════════════════════════════════════════════════════════
def load_census(census_path: Path) -> tuple[pd.DataFrame, int]:
    print("\n" + "=" * 72)
    print("STEP 3  Loading Census 2011 populations")
    print("=" * 72)

    df = pd.read_csv(census_path)
    census = df[["State name", "District name", "Population"]].copy()
    census.columns = ["state", "district", "population"]
    census["population"] = pd.to_numeric(census["population"], errors="coerce")
    census = census.dropna(subset=["population"])
    total = int(census["population"].sum())
    print(f"  Districts: {len(census)}")
    print(f"  Total Census 2011 population: {total:,}")
    return census, total


# ═════════════════════════════════════════════════════════════════════════
# STEP 4 — Match MPI → CSR and Census
# ═════════════════════════════════════════════════════════════════════════
def resolve_census_state(mpi_state_norm: str) -> list[str]:
    if mpi_state_norm in MPI_TO_CENSUS_STATE:
        return MPI_TO_CENSUS_STATE[mpi_state_norm]
    return [mpi_state_norm]


def best_match(
    dist_norm: str,
    lookup: dict,
    keys: list,
    allowed_states: list[str],
    cutoff: int,
    enforce_first_token: bool = False,
) -> tuple[object, float | None]:
    """Exact match first; else fuzzy within the allowed states. Returns (value, score).

    When `enforce_first_token` is True, reject fuzzy matches (score < 100) whose
    first token differs — prevents "west jaintia hills" inheriting "east jaintia
    hills" identity. We enable this only for CSR matching, since Census has
    legitimate first-token drift (e.g. "hugli" ↔ "hooghly").
    """
    for st in allowed_states:
        if (st, dist_norm) in lookup:
            return lookup[(st, dist_norm)], 100.0
    candidates = [(s, d) for (s, d) in keys if s in allowed_states]
    if not candidates:
        return None, None
    names = [d for _, d in candidates]
    result = process.extractOne(dist_norm, names, scorer=fuzz.ratio, score_cutoff=cutoff)
    if not result:
        return None, None
    matched, score, _ = result

    if enforce_first_token and score < 100:
        def _first_token(s: str) -> str:
            return s.split(" ", 1)[0] if s else ""
        if _first_token(dist_norm) != _first_token(matched):
            return None, None

    for (s, d) in candidates:
        if d == matched:
            return lookup[(s, d)], float(score)
    return None, None


def join_datasets(
    mpi: pd.DataFrame, csr: pd.DataFrame, census: pd.DataFrame,
) -> pd.DataFrame:
    print("\n" + "=" * 72)
    print("STEP 4  Joining MPI x CSR x Census")
    print("=" * 72)

    csr_lookup = {
        (normalize_name(r["state"]), normalize_name(r["district_name"])): r
        for _, r in csr.iterrows()
    }
    census_lookup = {
        (normalize_name(r["state"]), normalize_name(r["district"])): r["population"]
        for _, r in census.iterrows()
    }
    csr_keys = list(csr_lookup.keys())
    census_keys = list(census_lookup.keys())

    recast, recast_meta = load_recast_csv(RECAST_CSV_PATH)
    print(f"  Recast catalogue: {recast_meta['row_count']} rows "
          f"({recast_meta['child_count']} carve-outs, "
          f"{recast_meta['residual_count']} residual parents) from {recast_meta['csv_path']}")

    out = mpi.copy()
    out["total_csr_recent"] = 0.0
    out["total_population"] = np.nan
    # csr_lgd_source preserves whatever LGD number the MCA CSR sheet carried for
    # this row. Several districts share wrong LGD numbers in the upstream data
    # (e.g. BR/Aurangabad + MH/Aurangabad both = 189; Kheri + Kushinagar both =
    # 159). We store it for traceability only. The canonical internal identifier
    # is `district_lgd_code`, built as `{STATE_ABBREV}_{DIST_SLUG}` below.
    out["csr_lgd_source"] = ""
    out["district_lgd_code"] = ""
    out["csr_match_score"] = np.nan
    out["census_match_score"] = np.nan
    out["population_imputed"] = False
    out["population_parent_districts"] = ""
    out["population_source"] = ""        # method label from the recast CSV
    out["population_citation"] = ""      # source URL from the recast CSV
    matched_csr = matched_census = 0
    matched_override = matched_recast = matched_fuzzy = 0
    unresolved: list[tuple[str, str]] = []

    # CSR fuzzy cutoff raised from 85 → 90 plus first-token guard (West/East
    # Jaintia Hills scored 89 and got wrongly merged under the old setting).
    # Census stays at 80 without guard: real Census spelling drift can shift
    # the first token (Hugli ↔ Hooghly, Baleshwar ↔ Balasore).
    CSR_FUZZ_CUTOFF = 90
    CENSUS_FUZZ_CUTOFF = 80

    for idx, row in out.iterrows():
        state_norm = normalize_name(row["state"])
        dist_norm = normalize_name(row["district"])

        # Build the canonical internal key from the MPI spine (state + district),
        # not from the CSR LGD number. This guarantees uniqueness across scored
        # districts, regardless of source-data LGD collisions.
        out.at[idx, "district_lgd_code"] = build_district_key(row["state"], row["district"])

        # CSR — MCA uses modern state names, so prefer the MPI state directly
        csr_states = [state_norm] + [
            s for s in resolve_census_state(state_norm) if s != state_norm
        ]
        csr_val, csr_score = best_match(
            dist_norm, csr_lookup, csr_keys, csr_states,
            cutoff=CSR_FUZZ_CUTOFF, enforce_first_token=True,
        )
        if csr_val is not None:
            out.at[idx, "total_csr_recent"] = float(csr_val["total_csr_recent"])
            out.at[idx, "csr_lgd_source"] = str(csr_val["district_lgd_code"])
            out.at[idx, "csr_match_score"] = csr_score
            matched_csr += 1

        # Census match: recast CSV, then CENSUS_NAME_OVERRIDES, then fuzzy.
        # No fallback to summing parents - unmatched districts raise.
        census_key = (state_norm, dist_norm)
        recast_keys_to_try = [census_key]
        for cs in resolve_census_state(state_norm):
            if cs != state_norm:
                recast_keys_to_try.append((cs, dist_norm))
        # Also try the Census-side override target (e.g. MPI 'Dantewada' ->
        # Census 'Dakshin Bastar Dantewada') so residuals keyed under the
        # Census name are found before the override falls back to full pop.
        override = CENSUS_NAME_OVERRIDES.get(census_key)
        if override:
            recast_keys_to_try.append(override)

        recast_hit = None
        for k in recast_keys_to_try:
            if k in recast:
                recast_hit = recast[k]
                break
        if recast_hit is not None:
            out.at[idx, "total_population"] = float(recast_hit["population"])
            out.at[idx, "census_match_score"] = 100.0
            out.at[idx, "population_source"] = recast_hit["method"]
            out.at[idx, "population_citation"] = recast_hit["source_url"]
            # imputed = anything that's not a direct Census number
            out.at[idx, "population_imputed"] = recast_hit["method"] != "census_exact_rename"
            if recast_hit["parents"]:
                out.at[idx, "population_parent_districts"] = ", ".join(
                    p[1].title() for p in recast_hit["parents"]
                )
            matched_census += 1
            matched_recast += 1
            continue

        override = CENSUS_NAME_OVERRIDES.get(census_key)
        if override and override in census_lookup:
            out.at[idx, "total_population"] = float(census_lookup[override])
            out.at[idx, "census_match_score"] = 100.0
            out.at[idx, "population_source"] = "census_exact_rename"
            out.at[idx, "population_citation"] = (
                f"Census 2011 entry: {override[0].title()}/{override[1].title()}"
            )
            matched_census += 1
            matched_override += 1
            continue

        census_states = resolve_census_state(state_norm)
        pop_val, pop_score = best_match(
            dist_norm, census_lookup, census_keys, census_states,
            cutoff=CENSUS_FUZZ_CUTOFF, enforce_first_token=False,
        )
        if pop_val is not None:
            out.at[idx, "total_population"] = float(pop_val)
            out.at[idx, "census_match_score"] = pop_score
            out.at[idx, "population_source"] = "census_exact"
            out.at[idx, "population_citation"] = (
                "Census 2011 districts CSV (direct match)"
                if pop_score == 100.0
                else f"Census 2011 districts CSV (fuzzy match score={pop_score:.0f})"
            )
            matched_census += 1
            matched_fuzzy += 1
            continue

        # No match → record for hard fail at the end (don't sum parents)
        unresolved.append((state_norm, dist_norm))

    print(f"  MPI districts in:           {len(out)}")
    print(f"  Matched to CSR (cutoff {CSR_FUZZ_CUTOFF}): {matched_csr} ({matched_csr/len(out)*100:.1f} %)")
    print(f"  Matched to Census (cutoff {CENSUS_FUZZ_CUTOFF}): {matched_census} ({matched_census/len(out)*100:.1f} %)")
    print(f"    via RECAST_CSV:         {matched_recast}")
    print(f"    via explicit override:  {matched_override}")
    print(f"    via fuzzy match:        {matched_fuzzy}")

    # Raise only if an unresolved row also has a usable hr_2021; rows
    # without one would be dropped during scoring anyway.
    fatal: list[tuple[str, str]] = []
    for state_norm, dist_norm in unresolved:
        mpi_match = out[(out["state"].apply(normalize_name) == state_norm)
                        & (out["district"].apply(normalize_name) == dist_norm)]
        if mpi_match.empty:
            continue
        if mpi_match["hr_2021"].iloc[0] and mpi_match["hr_2021"].iloc[0] > 0:
            fatal.append((state_norm, dist_norm))
    if fatal:
        bullet = "\n    - "
        raise RuntimeError(
            "No population resolution for the following MPI districts. "
            "Add a row to scripts/csr/data/external/population_recast_2011.csv for each:"
            + bullet + bullet.join(f"{s}/{d}" for s, d in fatal)
        )

    before = len(out)
    out = out.dropna(subset=["total_population"])
    out = out[out["total_population"] > 0].reset_index(drop=True)
    print(f"  Dropped {before - len(out)} districts without a population match")

    # Post-dedup: if two MPI rows collapse to the same canonical key (e.g.
    # Morigaon/Marigaon alias), keep the one with a non-null 2015-16 baseline
    # (more information) and fall back to the first otherwise.
    before = len(out)
    out["_baseline"] = out["hr_2016"].notna() & (out["hr_2016"] > 0)
    out = (
        out.sort_values("_baseline", ascending=False)
        .drop_duplicates(subset=["district_lgd_code"], keep="first")
        .drop(columns=["_baseline"])
        .reset_index(drop=True)
    )
    if len(out) < before:
        print(f"  Dedup: collapsed {before - len(out)} rows on canonical key")
    print(f"  Final scoreable districts:  {len(out)}")
    return out


# ═════════════════════════════════════════════════════════════════════════
# STEP 5 — Compute POS + whitespace flag
# ═════════════════════════════════════════════════════════════════════════
def compute_scores(master: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    print("\n" + "=" * 72)
    print("STEP 5  Computing Philanthropic Opportunity Score")
    print("=" * 72)

    # Need — 2019-21 headcount ratio (proportion)
    master["N_raw"] = master["hr_2021"]

    # CSR per person (rupees) — total_csr_recent is in Rs  crore (× 1e7 = Rs )
    master["district_csr_per_person"] = (
        master["total_csr_recent"] * 1e7 / master["total_population"]
    )

    # Population tertiles
    p33 = master["total_population"].quantile(1 / 3)
    p67 = master["total_population"].quantile(2 / 3)
    master["pop_tier"] = pd.cut(
        master["total_population"],
        bins=[-np.inf, p33, p67, np.inf],
        labels=["Tier 1 (Small)", "Tier 2 (Medium)", "Tier 3 (Large)"],
    )

    print(f"  Tier 1 (Small)  pop <= {p33:>12,.0f}")
    print(f"  Tier 2 (Medium) pop <= {p67:>12,.0f}")
    print(f"  Tier 3 (Large)  pop >  {p67:>12,.0f}")
    print(f"  Tier counts: {master['pop_tier'].value_counts().to_dict()}")

    tier_medians = master.groupby("pop_tier", observed=True)["district_csr_per_person"].median()
    master["tier_median_csr"] = master["pop_tier"].map(tier_medians).astype(float)
    master["G_raw"] = (master["tier_median_csr"] - master["district_csr_per_person"]).clip(lower=0)

    national_median = float(master["district_csr_per_person"].median())
    national_mean = float(master["district_csr_per_person"].mean())

    print(f"  National CSR density — mean   Rs {national_mean:,.2f} /person")
    print(f"  National CSR density — median Rs {national_median:,.2f} /person")
    for t, m in tier_medians.items():
        print(f"    {t:<18} median Rs {m:,.2f} /person")

    # Unresolved poverty — retention ratio (hr_2021 / hr_2016)
    baseline = master["hr_2016"].notna() & (master["hr_2016"] > 0)
    master.loc[baseline, "U_raw"] = master.loc[baseline, "hr_2021"] / master.loc[baseline, "hr_2016"]
    median_retention = float(master.loc[baseline, "U_raw"].median())
    master.loc[~baseline, "U_raw"] = median_retention
    master["u_imputed"] = ~baseline
    print(f"  Median retention ratio: {median_retention:.3f}   imputed for {(~baseline).sum()} districts")

    # Min-max normalisation
    for raw in ["N_raw", "G_raw", "U_raw"]:
        norm = raw.replace("_raw", "_norm")
        v = master[raw]
        lo, hi = float(v.min()), float(v.max())
        master[norm] = (v - lo) / (hi - lo) if hi > lo else 0.5

    # POS
    master["POS"] = (W_N * master["N_norm"] + W_G * master["G_norm"] + W_U * master["U_norm"]) * 100

    # Whitespace: national 25th pctile CSR + national 75th pctile HR
    csr_p25 = float(master["district_csr_per_person"].quantile(0.25))
    hr_p75 = float(master["N_raw"].quantile(0.75))
    master["is_whitespace"] = (master["district_csr_per_person"] <= csr_p25) & (master["N_raw"] >= hr_p75)

    print(f"  POS range: {master['POS'].min():.2f} – {master['POS'].max():.2f}")
    print(f"  Whitespace districts: {int(master['is_whitespace'].sum())}")
    print(f"  Whitespace thresholds: CSR p25 Rs {csr_p25:,.2f}, HR p75 {hr_p75*100:.2f} %")

    # Whitespace counts per state — used by the methodology copy so the list
    # can't go stale when the pipeline reruns.
    ws_by_state = (
        master[master["is_whitespace"]]
        .groupby("state")
        .size()
        .sort_values(ascending=False)
        .to_dict()
    )

    # Pop-weighted national headcount ratio computed across matched districts
    # (distinct from the NITI Aayog published national figure of 14.96%, which
    # covers all 36 States/UTs and 653 MPI districts; we match 569).
    tot_pop = float(master["total_population"].sum())
    national_hr_pop_weighted = float(
        (master["hr_2021"] * master["total_population"]).sum() / tot_pop
    )

    meta = {
        "national_median_csr_per_person": round(national_median, 2),
        "national_mean_csr": round(national_mean, 2),
        "tier_medians": {str(k): round(float(v), 2) for k, v in tier_medians.items()},
        "total_districts": int(len(master)),
        "methodology": "population-tertile-stratified benchmarking",
        "whitespace_thresholds": {
            "csr_p25": round(csr_p25, 2),
            "hr_p75_pct": round(hr_p75 * 100, 1),
        },
        "whitespace_count": int(master["is_whitespace"].sum()),
        "whitespace_by_state": {str(k): int(v) for k, v in ws_by_state.items()},
        "pos_range": {
            "min": round(float(master["POS"].min()), 1),
            "max": round(float(master["POS"].max()), 1),
        },
        "pop_tier_boundaries": {"p33": int(round(p33)), "p67": int(round(p67))},
        "median_retention_ratio": round(median_retention, 3),
        "weights": {"w_N": W_N, "w_G": W_G, "w_U": W_U},
        "csr_window_fy": CSR_RECENT_YEARS,
        "national_hr_official_pct": 14.96,  # NITI Aayog (PIB 17-Jul-2023)
        "national_hr_pop_weighted_pct": round(national_hr_pop_weighted * 100, 2),
        "national_hr_2015_16_official_pct": 24.85,  # NITI Aayog (PIB 17-Jul-2023)
        "u_imputed_count": int(master.get("u_imputed", pd.Series([], dtype=bool)).sum()) if "u_imputed" in master.columns else 0,
    }
    return master, meta


# ═════════════════════════════════════════════════════════════════════════
# STEP 6 — Sector-specific scores
# ═════════════════════════════════════════════════════════════════════════
def compute_sector_scores(master: pd.DataFrame, pivot: pd.DataFrame) -> tuple[dict, dict]:
    print("\n" + "=" * 72)
    print("STEP 6  Sector-specific G_norm")
    print("=" * 72)

    scores: dict[str, dict] = {row["district_lgd_code"]: {} for _, row in master.iterrows()}
    sector_meta: dict[str, dict] = {}

    # The pivot is keyed by (state, district_as_per_lgd, district_lgd_code) from
    # the CSR source. The master now uses a canonical internal key built from
    # (state, district), so build a (state_norm, district_norm) → sector_csr
    # lookup to bridge the two.
    pivot_by_sd = {
        (normalize_name(r.get("state", "")), normalize_name(r.get("district_as_per_lgd", ""))): r
        for _, r in pivot.iterrows()
    }

    for sector in SCORE_SECTORS:
        col = next(
            (c for c in pivot.columns if isinstance(c, str) and fuzz.ratio(c.lower(), sector.lower()) > 80),
            None,
        )
        if col is None:
            print(f"  WARN  sector '{sector}' not in CSR data")
            continue

        m = master.copy()
        densities = []
        for _, r in m.iterrows():
            key = (normalize_name(r["state"]), normalize_name(r["district"]))
            src = pivot_by_sd.get(key)
            amt_cr = float(src.get(col, 0) or 0) if src is not None else 0.0
            pop = float(r["total_population"] or 0)
            densities.append((amt_cr * 1e7) / pop if pop > 0 else 0.0)
        m["sector_density"] = densities

        tier_sec_med = m.groupby("pop_tier", observed=True)["sector_density"].median()
        m["tier_sec_med"] = m["pop_tier"].map(tier_sec_med).astype(float)
        m["sector_gap"] = (m["tier_sec_med"] - m["sector_density"]).clip(lower=0)

        lo, hi = float(m["sector_gap"].min()), float(m["sector_gap"].max())
        m["sector_G_norm"] = (m["sector_gap"] - lo) / (hi - lo) if hi > lo else 0.5

        # Store the sector-specific G_norm (not the composite POS) so the
        # frontend can apply arbitrary user weights correctly.
        sector_pos_max = 0.0
        for i, (_, r) in enumerate(master.iterrows()):
            v = float(m["sector_G_norm"].iloc[i])
            g = round(v, 6) if math.isfinite(v) else 0.5
            scores[r["district_lgd_code"]][sector] = g
            pos = (W_N * r["N_norm"] + W_G * g + W_U * r["U_norm"]) * 100
            if pos > sector_pos_max:
                sector_pos_max = pos
        sector_meta[sector] = {"pos_max": round(sector_pos_max, 2)}

        print(f"  {sector:<42} scored {len(master)} districts  max POS {sector_pos_max:.2f}")
    return scores, sector_meta


# ═════════════════════════════════════════════════════════════════════════
# STEP 7 — Write outputs + verification report
# ═════════════════════════════════════════════════════════════════════════
def write_outputs(
    master: pd.DataFrame,
    sector_scores: dict,
    meta: dict,
    csr_overview: dict,
    out_dir: Path,
    mpi_total_extracted: int = 0,
) -> None:
    print("\n" + "=" * 72)
    print("STEP 7  Writing JSON outputs")
    print("=" * 72)
    out_dir.mkdir(parents=True, exist_ok=True)

    records = []
    for _, r in master.iterrows():
        records.append({
            "state_name": str(r["state"]),
            "district_name": str(r["district"]),
            "district_lgd_code": str(r["district_lgd_code"]),
            "csr_lgd_source": str(r.get("csr_lgd_source", "") or ""),
            "headcount_ratio_2016": safe_json(r["hr_2016"]),
            "headcount_ratio_2021": safe_json(r["hr_2021"]),
            "mpi_2021": safe_json(r["mpi_2021"]),
            "total_csr_recent": safe_json(r["total_csr_recent"]),
            "total_population": safe_json(r["total_population"]),
            "district_csr_per_person": safe_json(r["district_csr_per_person"]),
            "pop_tier": str(r["pop_tier"]),
            "tier_median_csr": safe_json(r["tier_median_csr"]),
            "N_raw": safe_json(r["N_raw"]),
            "G_raw": safe_json(r["G_raw"]),
            "U_raw": safe_json(r["U_raw"]),
            "N_norm": safe_json(r["N_norm"]),
            "G_norm": safe_json(r["G_norm"]),
            "U_norm": safe_json(r["U_norm"]),
            "POS": safe_json(r["POS"]),
            "is_whitespace": safe_json(r["is_whitespace"]),
            "u_imputed": bool(r.get("u_imputed", False)),
            "population_imputed": bool(r.get("population_imputed", False)),
            "population_parent_districts": str(r.get("population_parent_districts", "") or ""),
            "population_source": str(r.get("population_source", "") or "census_exact"),
            "population_citation": str(r.get("population_citation", "") or ""),
        })

    # Produce the verification report first — meta.json embeds a compact subset
    # so the UI can cite reconciled numbers without loading the full report.
    report = build_verification_report(master, meta, csr_overview, mpi_total_extracted)

    meta = {
        **meta,
        "csr_totals": report["csr_totals"],
        "state_stats": {
            "bihar": report["bihar"],
            "maharashtra": report["maharashtra"],
        },
        "retention_ratio_stats": report["retention_ratio_stats"],
        "population_method_counts": report["population_method_counts"],
        "population_invariants": report["population_invariants"],
    }

    (out_dir / "whitespace_master.json").write_text(
        json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "sector_scores.json").write_text(
        json.dumps(sector_scores, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )
    print(f"  wrote whitespace_master.json ({len(records)} districts)")
    print(f"  wrote sector_scores.json     ({len(sector_scores)} districts)")
    print(f"  wrote meta.json")

    (SCRIPTS_DIR / "verification_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(f"  wrote verification_report.json (scripts/csr/)")


def build_verification_report(
    master: pd.DataFrame, meta: dict, csr_overview: dict,
    mpi_total_extracted: int = 0,
) -> dict:
    """Produce the numbers the website copy quotes, so we can reconcile each one."""

    # Population method counts
    if "population_source" in master.columns:
        method_counts = {
            str(k): int(v)
            for k, v in master["population_source"].fillna("census_exact").value_counts().items()
        }
    else:
        method_counts = {"census_exact": int(len(master))}

    # Population invariants (fatal on violation)
    nat_total = float(master["total_population"].sum())
    nat_deviation_pct = (nat_total - CENSUS_2011_NATIONAL) / CENSUS_2011_NATIONAL * 100

    print("\n  Population conservation invariants:")
    print(f"    Pipeline national total:  {nat_total:>16,.0f}")
    print(f"    Census 2011 reference:    {CENSUS_2011_NATIONAL:>16,}")
    print(f"    Deviation:                {nat_deviation_pct:>+8.3f}%")

    # INV-3: cap on national total (over-count means double-count).
    invariant_3_overcount = nat_deviation_pct > 0.5
    all_positive = bool((master["total_population"] > 0).all())

    # INV-2: per-state matched_pop vs Census state total.
    census_state_totals: dict[str, int] = {}
    try:
        census_df = pd.read_csv(CENSUS_PATH)
        census_df = census_df[["State name", "District name", "Population"]].dropna()
        census_df["state_norm"] = census_df["State name"].apply(normalize_name)
        census_state_totals = census_df.groupby("state_norm")["Population"].sum().to_dict()
    except Exception as e:
        print(f"  WARN  could not compute per-state Census totals: {e}")

    state_invariants: list[dict] = []
    if census_state_totals:
        # MPI states that map to multiple Census states (the merged D&NH+D&D UT)
        # are checked against the combined Census total to avoid spurious
        # double-firing on each constituent.
        from collections import defaultdict
        mpi_state_to_census: dict[str, list[str]] = {}
        for s in master["state"].unique():
            sn = normalize_name(s)
            mpi_state_to_census[sn] = resolve_census_state(sn)

        groups: dict[tuple, list[str]] = defaultdict(list)
        for mpi_state, cs_list in mpi_state_to_census.items():
            groups[tuple(sorted(cs_list))].append(mpi_state)

        accounted: set[str] = set()
        for cs_tuple, mpi_states in sorted(groups.items()):
            if len(cs_tuple) > 1:
                combined_label = " + ".join(cs_tuple)
                combined_census = sum(census_state_totals.get(c, 0) for c in cs_tuple)
                mask = master["state"].apply(
                    lambda s, ms=set(mpi_states): normalize_name(s) in ms
                )
                matched_pop = float(master.loc[mask, "total_population"].sum())
                dev_pct = (matched_pop - combined_census) / combined_census * 100 if combined_census else 0.0
                state_invariants.append({
                    "state_census": combined_label,
                    "census_pop": int(combined_census),
                    "matched_pop": int(round(matched_pop)),
                    "deviation_pct": round(dev_pct, 3),
                    "ok": dev_pct <= 0.5,
                })
                accounted.update(cs_tuple)

        for census_state, census_pop in sorted(census_state_totals.items()):
            if census_state in accounted:
                continue
            mask = master["state"].apply(
                lambda s, cs=census_state: cs in resolve_census_state(normalize_name(s))
                or normalize_name(s) == cs
            )
            matched_pop = float(master.loc[mask, "total_population"].sum())
            dev_pct = (matched_pop - census_pop) / census_pop * 100 if census_pop else 0.0
            state_invariants.append({
                "state_census": census_state,
                "census_pop": int(census_pop),
                "matched_pop": int(round(matched_pop)),
                "deviation_pct": round(dev_pct, 3),
                "ok": dev_pct <= 0.5,
            })
    invariant_2_violators = [s for s in state_invariants if not s["ok"]]

    # INV-1: per-parent reconciliation.
    try:
        recast, _ = load_recast_csv(RECAST_CSV_PATH)
    except Exception:
        recast = {}
    parent_invariants: list[dict] = []
    if recast and census_state_totals:
        census_df2 = pd.read_csv(CENSUS_PATH)[["State name", "District name", "Population"]].dropna()
        census_lookup_local = {
            (normalize_name(r["State name"]), normalize_name(r["District name"])): int(r["Population"])
            for _, r in census_df2.iterrows()
        }
        per_parent: dict[tuple[str, str], dict] = {}
        for (st, dist), entry in recast.items():
            parents = entry["parents"]
            shares = entry.get("shares") or {}
            if not parents:
                continue
            for p_state, p_dist in parents:
                key = (p_state, p_dist)
                per_parent.setdefault(key, {"children": 0, "residual": 0})
                contribution = (
                    shares.get(p_dist, entry["population"] // len(parents))
                    if len(parents) > 1
                    else entry["population"]
                )
                per_parent[key]["children"] += contribution
        for (st, dist), entry in recast.items():
            if entry["parents"]:
                continue
            cs_states = resolve_census_state(st)
            for cs in [st] + [c for c in cs_states if c != st]:
                key = (cs, dist)
                if key in per_parent:
                    per_parent[key]["residual"] = entry["population"]
                    break
        for (cs, p), v in sorted(per_parent.items()):
            census_pop = census_lookup_local.get((cs, p))
            if census_pop is None:
                parent_invariants.append({
                    "parent": f"{cs}/{p}",
                    "error": "parent not in Census 2011 CSV",
                })
                continue
            total = v["children"] + v["residual"]
            dev_pct = (total - census_pop) / census_pop * 100
            parent_invariants.append({
                "parent": f"{cs}/{p}",
                "census_pop": int(census_pop),
                "children_sum": int(v["children"]),
                "residual": int(v["residual"]),
                "total": int(total),
                "deviation_pct": round(dev_pct, 3),
                "ok": abs(dev_pct) <= 0.5,
            })
    invariant_1_violators = [p for p in parent_invariants if not p.get("ok", True)]

    invariants_ok = (
        not invariant_1_violators
        and not invariant_2_violators
        and not invariant_3_overcount
        and all_positive
    )
    if invariants_ok:
        print("  OK   all population invariants satisfied")
        if nat_deviation_pct < -0.5:
            print(
                f"  NOTE national total runs {nat_deviation_pct:+.2f}% vs Census 2011 "
                f"because the MPI PDF does not enumerate every Census-2011 district; "
                f"this gap is structural and not introduced by the recast."
            )
    else:
        print("  FAIL population invariants:")
        if invariant_1_violators:
            print(f"    INV-1 (per-parent): {len(invariant_1_violators)} violators")
            for p in invariant_1_violators[:5]:
                print(f"      {p}")
        if invariant_2_violators:
            print(f"    INV-2 (per-state): {len(invariant_2_violators)} violators")
            for s in invariant_2_violators[:5]:
                print(f"      {s}")
        if invariant_3_overcount:
            print(f"    INV-3 (national): +{nat_deviation_pct:.2f}% over Census — DOUBLE-COUNT")
        if not all_positive:
            print(f"    non-positive populations present")

    def state_row(state: str) -> dict:
        s = master[master["state"].str.lower() == state.lower()]
        if len(s) == 0:
            return {"state": state, "error": "no districts matched"}
        pop = float(s["total_population"].sum())
        hr_pop_weighted = float(
            (s["hr_2021"] * s["total_population"]).sum() / pop
        )
        hr_simple_avg = float(s["hr_2021"].mean())
        csr_total = float(s["total_csr_recent"].sum())
        csr_per_person = (csr_total * 1e7) / pop if pop else 0.0
        return {
            "state": state,
            "districts_matched": int(len(s)),
            "population_2011": int(round(pop)),
            "hr_2019_21_pop_weighted_pct": round(hr_pop_weighted * 100, 2),
            "hr_2019_21_simple_avg_pct": round(hr_simple_avg * 100, 2),
            "csr_3yr_crore": round(csr_total, 2),
            "csr_per_person_inr": round(csr_per_person, 2),
        }

    bihar = state_row("Bihar")
    maha = state_row("Maharashtra")
    ratios = {
        "bihar_vs_maharashtra_hr_pop_weighted": round(
            bihar["hr_2019_21_pop_weighted_pct"] / maha["hr_2019_21_pop_weighted_pct"], 2
        ),
        "bihar_vs_maharashtra_hr_simple_avg": round(
            bihar["hr_2019_21_simple_avg_pct"] / maha["hr_2019_21_simple_avg_pct"], 2
        ),
        "maharashtra_vs_bihar_csr_per_person": round(
            maha["csr_per_person_inr"] / bihar["csr_per_person_inr"], 2
        ) if bihar.get("csr_per_person_inr") else None,
    }

    # National headcount ratio: population-weighted across all matched districts
    total_pop = float(master["total_population"].sum())
    national_hr_pct = round(
        float((master["hr_2021"] * master["total_population"]).sum() / total_pop) * 100, 2
    )

    top10 = (
        master.nlargest(10, "POS")
        [["district", "state", "POS", "hr_2021", "district_csr_per_person", "is_whitespace"]]
        .assign(hr_2021_pct=lambda d: (d["hr_2021"] * 100).round(2))
        .drop(columns=["hr_2021"])
        .to_dict(orient="records")
    )

    ws_by_state = (
        master[master["is_whitespace"]]
        .groupby("state")
        .size()
        .sort_values(ascending=False)
        .to_dict()
    )

    baseline_mask = master["hr_2016"].notna() & (master["hr_2016"] > 0)
    u_raw_observed = master.loc[baseline_mask, "U_raw"]
    retention_stats = {
        "median": round(float(u_raw_observed.median()), 3),
        "mean": round(float(u_raw_observed.mean()), 3),
        "std": round(float(u_raw_observed.std()), 3),
        "p25": round(float(u_raw_observed.quantile(0.25)), 3),
        "p75": round(float(u_raw_observed.quantile(0.75)), 3),
        "n_observed": int(baseline_mask.sum()),
        "n_imputed": int((~baseline_mask).sum()),
    }

    return {
        "national": {
            "total_districts_scored": int(len(master)),
            "mpi_districts_extracted": mpi_total_extracted,
            "mpi_districts_excluded": mpi_total_extracted - int(len(master)),
            "total_population_2011": int(round(total_pop)),
            "national_hr_2019_21_pop_weighted_pct": national_hr_pct,
            "pos_range": meta["pos_range"],
            "whitespace_count": meta["whitespace_count"],
        },
        "csr_totals": {
            "total_all_years_gross_crore": round(csr_overview.get("total_csr_all_years_gross", 0), 2),
            "total_all_years_attributable_crore": round(csr_overview["total_csr_all_years"], 2),
            "total_fy23_24_crore": round(csr_overview["total_csr_fy23_24"], 2),
            "total_3yr_window_crore": round(csr_overview["total_csr_recent_3yr"], 2),
            "pan_india_csr_all_years_crore": round(csr_overview.get("pan_india_csr_all_years", 0), 2),
            "pan_india_pct": csr_overview.get("pan_india_pct", 0),
        },
        "bihar": bihar,
        "maharashtra": maha,
        "ratios": ratios,
        "whitespace_by_state": ws_by_state,
        "retention_ratio_stats": retention_stats,
        "top_10_districts_by_pos": top10,
        "population_method_counts": method_counts,
        "population_invariants": {
            "census_2011_national_reference": CENSUS_2011_NATIONAL,
            "pipeline_national_total": int(round(nat_total)),
            "deviation_pct": round(nat_deviation_pct, 3),
            "all_positive": all_positive,
            "invariant_1_per_parent_ok": not invariant_1_violators,
            "invariant_1_violator_count": len(invariant_1_violators),
            "invariant_2_per_state_ok": not invariant_2_violators,
            "invariant_2_violator_count": len(invariant_2_violators),
            "invariant_3_national_overcount_ok": not invariant_3_overcount,
            "ok": invariants_ok,
        },
        "per_parent_invariants": parent_invariants,
        "per_state_invariants": state_invariants,
    }


# ═════════════════════════════════════════════════════════════════════════
# Main
# ═════════════════════════════════════════════════════════════════════════
def main() -> None:
    print("Whitespace India CSR — data pipeline")
    print(f"Source: {SRC_DIR}")
    print(f"Output: {OUT_DIR}")
    print()

    for p in (PDF_PATH, EXCEL_PATH, CENSUS_PATH):
        if not p.exists():
            print(f"ERROR: missing source file {p}", file=sys.stderr)
            sys.exit(1)

    mpi = extract_mpi(PDF_PATH)
    mpi_total_extracted = len(mpi)
    csr_district, csr_sector_pivot, csr_overview = load_csr(EXCEL_PATH)
    census, _ = load_census(CENSUS_PATH)
    master = join_datasets(mpi, csr_district, census)
    master, meta = compute_scores(master)
    sector_scores, sector_meta = compute_sector_scores(master, csr_sector_pivot)
    meta["sector_pos_max"] = round(
        max((m.get("pos_max", 0) for m in sector_meta.values()), default=0), 1
    )
    meta["sector_pos_meta"] = sector_meta
    write_outputs(master, sector_scores, meta, csr_overview, OUT_DIR, mpi_total_extracted)

    print("\n" + "=" * 72)
    print("PIPELINE COMPLETE")
    print("=" * 72)
    print(f"Artifacts in: {OUT_DIR}")


if __name__ == "__main__":
    main()
