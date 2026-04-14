"""
Whitespace India - Data Analysis
1. India-National-Multidimentional-Poverty-Index-2023.pdf (MPI data)
2. csr_state_sector.xlsx (CSR spending data)
3. census_2011_districts.csv (population data)

Outputs:
- public/data/whitespace_master.json (valid JSON, no NaN)
- public/data/sector_scores.json
"""

import json
import math
import os
import re
import sys

import numpy as np
import pandas as pd
import pdfplumber
from rapidfuzz import fuzz, process

# ── Paths ──────────────────────────────────────────────────────────────────
DATA_DIR = "$WHITESPACE_DATA_DIR"
OUT_DIR  = "$PROJECT_OUT_DIR"

PDF_PATH    = os.path.join(DATA_DIR, "India-National-Multidimentional-Poverty-Index-2023.pdf")
EXCEL_PATH  = os.path.join(DATA_DIR, "csr_state_sector.xlsx")
CENSUS_PATH = os.path.join(DATA_DIR, "census_2011_districts.csv")

# ── Sectors used for sector-specific scoring ───────────────────────────────
SCORE_SECTORS = [
    "Education", "Health Care", "Rural Development Projects",
    "Livelihood Enhancement Projects", "Environmental Sustainability",
    "Poverty, Eradicating Hunger, Malnutrition",
    "Safe Drinking Water", "Sanitation", "Vocational Skills",
    "Women Empowerment",
]

# ── Default weights ────────────────────────────────────────────────────────
W_N, W_G, W_U = 0.40, 0.40, 0.20


# ═══════════════════════════════════════════════════════════════════════════
# STEP 1: Extract MPI data from PDF
# ═══════════════════════════════════════════════════════════════════════════

def extract_mpi_from_pdf(pdf_path):
    """Extract district-level MPI tables from the NITI Aayog PDF."""
    print("=" * 60)
    print("STEP 1: Extracting MPI data from PDF...")
    print("=" * 60)

    all_rows = []
    current_state = None

    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        print(f"  Total pages in PDF: {total_pages}")

        # MPI district tables start around page 100+ and go to ~400
        for page_num in range(90, min(total_pages, 420)):
            page = pdf.pages[page_num]
            text = page.extract_text() or ""

            # Try to detect state name from page headers
            # State names typically appear as standalone lines before tables
            lines = text.split("\n")
            for line in lines:
                stripped = line.strip()
                # Heuristic: state names are title-cased, not too long, not a table row
                if (stripped and len(stripped) < 40 and
                    not any(c.isdigit() for c in stripped[:5]) and
                    stripped[0].isupper() and
                    stripped not in ("District", "Headcount", "Intensity", "MPI") and
                    "ratio" not in stripped.lower() and
                    "table" not in stripped.lower() and
                    "figure" not in stripped.lower() and
                    "source" not in stripped.lower() and
                    "note" not in stripped.lower() and
                    "contd" not in stripped.lower() and
                    "national" not in stripped.lower() and
                    len(stripped.split()) <= 6):
                    # Check if it looks like a known Indian state
                    potential_state = stripped.replace("&", "and").strip()
                    if is_known_state(potential_state):
                        current_state = stripped

            # Extract tables from the page
            tables = page.extract_tables()
            for table in tables:
                if not table:
                    continue
                for row in table:
                    if not row or len(row) < 7:
                        continue
                    # Skip header rows
                    first_cell = str(row[0] or "").strip()
                    if first_cell.lower() in ("district", "districts", "", "none"):
                        continue
                    if "headcount" in first_cell.lower() or "ratio" in first_cell.lower():
                        continue

                    # Try to parse as a data row
                    parsed = parse_mpi_row(row, current_state)
                    if parsed:
                        all_rows.append(parsed)

    df = pd.DataFrame(all_rows, columns=[
        "state", "district",
        "hr_2016", "intensity_2016", "mpi_2016",
        "hr_2021", "intensity_2021", "mpi_2021"
    ])

    # Remove duplicates (keep last - later pages may have corrections)
    df = df.drop_duplicates(subset=["state", "district"], keep="last")

    print(f"  Extracted {len(df)} districts from PDF")
    print(f"  States found: {df['state'].nunique()}")

    # If we got fewer than 600, fall back to the existing extracted CSV
    if len(df) < 600:
        print(f"  WARNING: Only {len(df)} districts extracted. Falling back to existing mpi_districts.csv")
        df = load_mpi_fallback()

    return df


KNOWN_STATES = {
    "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh",
    "goa", "gujarat", "haryana", "himachal pradesh", "jharkhand", "karnataka",
    "kerala", "madhya pradesh", "maharashtra", "manipur", "meghalaya", "mizoram",
    "nagaland", "odisha", "punjab", "rajasthan", "sikkim", "tamil nadu",
    "telangana", "tripura", "uttar pradesh", "uttarakhand", "west bengal",
    "andaman and nicobar islands", "chandigarh", "dadra and nagar haveli",
    "dadra and nagar haveli and daman and diu", "daman and diu", "delhi",
    "jammu and kashmir", "jammu & kashmir", "ladakh", "lakshadweep",
    "puducherry", "nct of delhi",
}

def is_known_state(name):
    return name.strip().lower().replace("&", "and") in KNOWN_STATES


def safe_float(val):
    """Convert a string to float, returning None if not possible."""
    if val is None:
        return None
    s = str(val).strip().replace(",", "")
    if s in ("", "-", "NA", "N/A", "nan", "None", ".."):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_mpi_row(row, current_state):
    """Try to parse a table row as MPI district data."""
    cells = [str(c or "").strip() for c in row]

    # Expect: district_name, then 3 values for 2015-16, then 3 values for 2019-21
    district_name = cells[0]

    # District name should be mostly alphabetic
    if not district_name or len(district_name) < 2:
        return None
    if sum(c.isdigit() for c in district_name) > len(district_name) * 0.5:
        return None

    # Try to extract 6 numeric values from the remaining cells
    nums = []
    for c in cells[1:]:
        f = safe_float(c)
        nums.append(f)

    # We need at least the last 3 values (2019-21 data)
    if len(nums) < 6:
        # Pad with None at the beginning
        nums = [None] * (6 - len(nums)) + nums

    hr_2016 = nums[0]
    int_2016 = nums[1]
    mpi_2016 = nums[2]
    hr_2021 = nums[3]
    int_2021 = nums[4]
    mpi_2021 = nums[5]

    # At minimum, the 2019-21 headcount ratio must be a valid number
    if hr_2021 is None or int_2021 is None:
        return None

    # Headcount ratios should be in percentage form (0-100)
    if hr_2021 > 100 or hr_2021 < 0:
        return None

    return [
        current_state, district_name,
        hr_2016, int_2016, mpi_2016,
        hr_2021, int_2021, mpi_2021
    ]


def load_mpi_fallback():
    """Load from the existing extracted CSV as fallback."""
    csv_path = os.path.join(DATA_DIR, "data", "mpi_districts.csv")
    print(f"  Loading fallback from {csv_path}")
    df = pd.read_csv(csv_path)
    df.columns = ["state", "district", "hr_2016", "intensity_2016", "mpi_2016",
                   "hr_2021", "intensity_2021", "mpi_2021"]
    # Convert percentage values to proportions (0-1 scale)
    for col in ["hr_2016", "hr_2021"]:
        df[col] = pd.to_numeric(df[col], errors="coerce") / 100.0
    for col in ["intensity_2016", "intensity_2021"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in ["mpi_2016", "mpi_2021"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # ── Fix state misattributions in the CSV ──
    # West Bengal districts are mislabeled as "Bihar" (rows ~599-613)
    WEST_BENGAL_DISTRICTS = {
        "bankura", "barddhaman", "birbhum", "darjeeling", "howrah",
        "hugli (hooghly)", "jalpaiguri", "koch bihar (coochbehar)",
        "kolkata", "maldah", "murshidabad", "nadia",
        "paschim bardhaman", "purba bardhaman", "puruliya",
        "north twenty four parganas", "south twenty four parganas",
        "paschim medinipur", "purba medinipur", "uttar dinajpur",
        "dakshin dinajpur", "alipurduar", "cooch behar",
    }
    # Morigaon is an Assam district mislabeled as Bihar
    ASSAM_DISTRICTS = {"morigaon"}

    for idx, row in df.iterrows():
        dist_lower = str(row["district"]).lower().strip()
        if row["state"] == "Bihar" and dist_lower in WEST_BENGAL_DISTRICTS:
            df.at[idx, "state"] = "West Bengal"
        elif row["state"] == "Bihar" and dist_lower in ASSAM_DISTRICTS:
            df.at[idx, "state"] = "Assam"

    corrections = (df["state"] != pd.read_csv(csv_path).iloc[:, 0]).sum()
    print(f"  Fixed {corrections} state misattributions")
    print(f"  States after fix: {df['state'].nunique()}")

    return df


# ═══════════════════════════════════════════════════════════════════════════
# STEP 2: Process CSR Excel
# ═══════════════════════════════════════════════════════════════════════════

def process_csr_excel(excel_path):
    """Process the original CSR Excel file."""
    print("\n" + "=" * 60)
    print("STEP 2: Processing CSR Excel...")
    print("=" * 60)

    df = pd.read_excel(excel_path)
    print(f"  Total rows in Excel: {len(df)}")

    # Exclude Pan India and unattributable rows
    exclude_states = ["Pan India", "Pan India (Other Centralized Funds)", "Nec/ Not Mentioned"]
    df = df[~df["state"].isin(exclude_states)]
    df = df[df["district_lgd_code"].notna()]
    df = df[df["district_lgd_code"] != "Not Applicable"]

    print(f"  Rows after excluding Pan India/Nec/no-LGD: {len(df)}")

    # Filter to recent 3 fiscal years for scoring
    recent_years = ["2021-22", "2022-23", "2023-24"]
    df_recent = df[df["fiscal_year"].isin(recent_years)]
    print(f"  Rows in recent 3 years: {len(df_recent)}")

    # District totals
    csr_district = df_recent.groupby(
        ["state", "district_as_per_lgd", "district_lgd_code"]
    ).agg(total_csr_recent=("amount_spent", "sum")).reset_index()
    csr_district.rename(columns={"district_as_per_lgd": "district_name"}, inplace=True)

    print(f"  Unique districts with CSR data: {len(csr_district)}")
    print(f"  Total attributable CSR (recent 3yr): {csr_district['total_csr_recent'].sum():.2f} crore")

    # Sector-level breakdowns
    csr_sector = df_recent.groupby(
        ["state", "district_as_per_lgd", "district_lgd_code", "sector"]
    ).agg(amount=("amount_spent", "sum")).reset_index()

    # Pivot to get sectors as columns
    csr_sector_pivot = csr_sector.pivot_table(
        index=["state", "district_as_per_lgd", "district_lgd_code"],
        columns="sector",
        values="amount",
        fill_value=0
    ).reset_index()

    return csr_district, csr_sector_pivot


# ═══════════════════════════════════════════════════════════════════════════
# STEP 3: Process Census data
# ═══════════════════════════════════════════════════════════════════════════

def process_census(census_path):
    """Process Census 2011 district population data."""
    print("\n" + "=" * 60)
    print("STEP 3: Processing Census 2011 data...")
    print("=" * 60)

    df = pd.read_csv(census_path)
    print(f"  Total census districts: {len(df)}")
    print(f"  Columns: {list(df.columns[:10])}...")

    # Identify key columns
    # The CSV has: District code, State name, District name, Population, etc.
    col_map = {}
    for col in df.columns:
        cl = col.lower().strip()
        if "state" in cl and "name" in cl:
            col_map["state"] = col
        elif "district" in cl and "name" in cl:
            col_map["district"] = col
        elif "district" in cl and "code" in cl:
            col_map["district_code"] = col
        elif cl == "population" or cl == "total population":
            col_map["population"] = col

    # If standard column detection fails, use positional
    if "state" not in col_map:
        # Try common column names
        for col in df.columns:
            if col.strip().lower() in ("state", "state name", "state_name"):
                col_map["state"] = col
                break
    if "district" not in col_map:
        for col in df.columns:
            if col.strip().lower() in ("district", "district name", "district_name"):
                col_map["district"] = col
                break
    if "population" not in col_map:
        for col in df.columns:
            if col.strip().lower() in ("population", "total_population"):
                col_map["population"] = col
                break

    print(f"  Column mapping: {col_map}")

    census = df[[col_map.get("state", df.columns[1]),
                 col_map.get("district", df.columns[2]),
                 col_map.get("population", df.columns[3])]].copy()
    census.columns = ["state", "district", "population"]
    census["population"] = pd.to_numeric(census["population"], errors="coerce")
    census = census.dropna(subset=["population"])

    # Total India population
    total_pop = census["population"].sum()
    print(f"  Total India population (Census 2011): {total_pop:,.0f}")

    return census, total_pop


# ═══════════════════════════════════════════════════════════════════════════
# STEP 4: Merge datasets
# ═══════════════════════════════════════════════════════════════════════════


# ── State Name Aliases ────────────────────────────────────────────────────
# Maps MPI state names (normalized) to Census 2011 state names (normalized).
# Census 2011 predates: Telangana (2014, from AP), Ladakh (2019, from J&K),
# and the D&NH + D&D merger (2020).
MPI_TO_CENSUS_STATE = {
    "odisha": "orissa",
    "delhi": "nct of delhi",
    "puducherry": "pondicherry",
    "telangana": "andhra pradesh",  # Telangana districts were in AP in Census 2011
    "ladakh": "jammu and kashmir",  # Ladakh was part of J&K in Census 2011
    "andaman and nicobar islands": "andaman and nicobar islands",
    "dadra and nagar haveli and daman and diu": "dadra and nagar haveli",  # merged UT; try DNH first
    "jammu and kashmir": "jammu and kashmir",
}

# Reverse map: Census names that could also match a second MPI UT
# (Daman & Diu is separate in Census but merged into DNH&DD in MPI)
CENSUS_EXTRA_STATES_FOR_MPI = {
    "dadra and nagar haveli and daman and diu": ["dadra and nagar haveli", "daman and diu"],
}


def normalize_name(name):
    """Normalize district/state names for matching."""
    if not isinstance(name, str):
        return ""
    s = name.lower().strip()
    s = re.sub(r"\s+", " ", s)
    s = s.replace("&", "and")
    s = s.replace(" district", "")
    s = s.replace(".", "")
    s = s.replace("'", "")
    return s


def resolve_census_state(mpi_state_norm):
    """Map a normalized MPI state name to the Census 2011 equivalent(s)."""
    if mpi_state_norm in MPI_TO_CENSUS_STATE:
        primary = MPI_TO_CENSUS_STATE[mpi_state_norm]
        extras = CENSUS_EXTRA_STATES_FOR_MPI.get(mpi_state_norm, [])
        return [primary] + extras
    return [mpi_state_norm]


def fuzzy_match_districts(mpi_df, csr_df, census_df):
    """Merge MPI, CSR, and Census data using fuzzy matching."""
    print("\n" + "=" * 60)
    print("STEP 4: Merging datasets...")
    print("=" * 60)

    # Start from MPI as the base (these are the districts we score)
    master = mpi_df.copy()

    # First, try to match CSR data by LGD code where possible
    # Also match by state + district name using fuzzy matching

    # Build lookup for CSR: (normalized_state, normalized_district) -> row
    csr_lookup = {}
    for _, row in csr_df.iterrows():
        key = (normalize_name(row["state"]), normalize_name(row["district_name"]))
        csr_lookup[key] = row

    # Build lookup for Census: (normalized_state, normalized_district) -> population
    census_lookup = {}
    for _, row in census_df.iterrows():
        key = (normalize_name(row["state"]), normalize_name(row["district"]))
        census_lookup[key] = row["population"]

    # Also build flat lists for fuzzy matching
    csr_keys = list(csr_lookup.keys())
    census_keys = list(census_lookup.keys())

    matched_csr = 0
    matched_census = 0
    master["total_csr_recent"] = 0.0
    master["total_population"] = np.nan
    master["district_lgd_code"] = ""

    for idx, row in master.iterrows():
        state_norm = normalize_name(row["state"])
        dist_norm = normalize_name(row["district"])

        # Match CSR
        csr_match = find_best_match(state_norm, dist_norm, csr_lookup, csr_keys)
        if csr_match is not None:
            master.at[idx, "total_csr_recent"] = csr_match["total_csr_recent"]
            master.at[idx, "district_lgd_code"] = str(csr_match["district_lgd_code"])
            matched_csr += 1

        # Match Census
        census_match = find_best_census_match(state_norm, dist_norm, census_lookup, census_keys)
        if census_match is not None:
            master.at[idx, "total_population"] = census_match
            matched_census += 1

    print(f"  MPI districts: {len(master)}")
    print(f"  Matched to CSR: {matched_csr} ({matched_csr/len(master)*100:.1f}%)")
    print(f"  Matched to Census: {matched_census} ({matched_census/len(master)*100:.1f}%)")

    # Diagnostic: show unmatched states
    unmatched = master[master["total_population"].isna()]
    if len(unmatched) > 0:
        unmatched_states = unmatched["state"].value_counts()
        print(f"\n  UNMATCHED by state ({len(unmatched)} total):")
        for state, cnt in unmatched_states.items():
            print(f"    {state}: {cnt} districts")

    # For districts without LGD code, generate a synthetic one
    no_lgd = master["district_lgd_code"] == ""
    for idx in master[no_lgd].index:
        master.at[idx, "district_lgd_code"] = f"MPI_{idx}"

    # Drop rows with no population (can't compute CSR density)
    before = len(master)
    master = master.dropna(subset=["total_population"])
    master = master[master["total_population"] > 0]
    print(f"  Dropped {before - len(master)} districts with no population match")
    print(f"  Final dataset: {len(master)} districts")

    return master


def find_best_match(state_norm, dist_norm, lookup, keys):
    """Find best match in CSR lookup using exact then fuzzy matching."""
    # CSR Excel uses modern state names, so try direct match first
    exact_key = (state_norm, dist_norm)
    if exact_key in lookup:
        return lookup[exact_key]

    # Also try with aliases (CSR may use different spellings)
    for alias in resolve_census_state(state_norm):
        alias_key = (alias, dist_norm)
        if alias_key in lookup:
            return lookup[alias_key]

    # Fuzzy match within same state (try all aliases)
    same_state_keys = [(s, d) for s, d in keys if s == state_norm]
    for alias in resolve_census_state(state_norm):
        if alias != state_norm:
            same_state_keys += [(s, d) for s, d in keys if s == alias]

    if not same_state_keys:
        # Try fuzzy state match
        same_state_keys = [(s, d) for s, d in keys if fuzz.ratio(s, state_norm) > 85]

    if same_state_keys:
        dist_names = [d for _, d in same_state_keys]
        result = process.extractOne(dist_norm, dist_names, scorer=fuzz.ratio, score_cutoff=75)
        if result:
            matched_dist = result[0]
            for s, d in same_state_keys:
                if d == matched_dist:
                    return lookup[(s, d)]
    return None


def find_best_census_match(state_norm, dist_norm, lookup, keys):
    """Find best match in Census lookup, using state alias mapping."""
    # Resolve MPI state name to Census state name(s)
    census_states = resolve_census_state(state_norm)

    # Try exact match with each alias
    for cs in census_states:
        exact_key = (cs, dist_norm)
        if exact_key in lookup:
            return lookup[exact_key]

    # Collect candidate districts from all aliased Census states
    same_state_keys = []
    for cs in census_states:
        same_state_keys += [(s, d) for s, d in keys if s == cs]

    # If still nothing, try fuzzy state match as last resort
    if not same_state_keys:
        same_state_keys = [(s, d) for s, d in keys if fuzz.ratio(s, state_norm) > 85]

    if same_state_keys:
        dist_names = [d for _, d in same_state_keys]
        result = process.extractOne(dist_norm, dist_names, scorer=fuzz.ratio, score_cutoff=70)
        if result:
            matched_dist = result[0]
            for s, d in same_state_keys:
                if d == matched_dist:
                    return lookup[(s, d)]
    return None


# ═══════════════════════════════════════════════════════════════════════════
# STEP 5: Compute Philanthropic Opportunity Score
# ═══════════════════════════════════════════════════════════════════════════

def compute_scores(master, total_pop):
    """Compute POS using population-tertile-stratified CSR benchmarking.

    Instead of a single national median, districts are grouped into 3 tiers
    by population (as an exogenous proxy for urbanization/corporate presence).
    Each tier's median CSR per person serves as the benchmark for that tier's
    districts, ensuring like-for-like comparison.

    Tier boundaries: 33rd and 67th percentile of district population.
    """
    print("\n" + "=" * 60)
    print("STEP 5: Computing Philanthropic Opportunity Scores...")
    print("        (Population-tertile-stratified benchmarking)")
    print("=" * 60)

    # Drop districts with missing 2019-21 headcount (can't score without it)
    before = len(master)
    master = master[master["hr_2021"].notna() & (master["hr_2021"] > 0)].copy()
    if len(master) < before:
        print(f"  Dropped {before - len(master)} districts with missing hr_2021")

    # ── Component A: NEED (N) ──
    master["N_raw"] = master["hr_2021"]

    # ── Component B: SUPPLY GAP (G) - Tiered Approach ──
    # CSR per person = (total_csr_recent * 1e7) / total_population
    master["district_csr_per_person"] = (
        master["total_csr_recent"] * 1e7 / master["total_population"]
    )

    # Population tertile boundaries (33rd and 67th percentile)
    pop_p33 = master["total_population"].quantile(1/3)
    pop_p67 = master["total_population"].quantile(2/3)

    # Assign population tier
    # Tier 1: Small districts (bottom third by population)
    # Tier 2: Medium districts (middle third)
    # Tier 3: Large districts (top third)
    master["pop_tier"] = pd.cut(
        master["total_population"],
        bins=[-np.inf, pop_p33, pop_p67, np.inf],
        labels=["Tier 1 (Small)", "Tier 2 (Medium)", "Tier 3 (Large)"],
    )

    print(f"\n  Population tertile boundaries:")
    print(f"    Tier 1 (Small):  pop <= {pop_p33:,.0f}")
    print(f"    Tier 2 (Medium): {pop_p33:,.0f} < pop <= {pop_p67:,.0f}")
    print(f"    Tier 3 (Large):  pop > {pop_p67:,.0f}")
    print(f"    Tier counts: {master['pop_tier'].value_counts().to_dict()}")

    # Compute tier-specific median CSR per person
    tier_medians = master.groupby("pop_tier", observed=True)["district_csr_per_person"].median()
    print(f"\n  Tier CSR medians (INR/person):")
    for tier, med in tier_medians.items():
        print(f"    {tier}: {med:.2f}")

    # Store tier median for each district (convert to float to avoid categorical dtype)
    master["tier_median_csr"] = master["pop_tier"].map(tier_medians).astype(float)

    # G_raw = max(0, tier_median - district_csr) for each district
    # This measures the gap relative to each district's own peer group
    master["G_raw"] = (master["tier_median_csr"] - master["district_csr_per_person"]).clip(lower=0)

    # Also compute overall national median for reference (used in UI display)
    national_median = master["district_csr_per_person"].median()
    national_mean = master["district_csr_per_person"].mean()
    print(f"\n  National CSR density - Mean: {national_mean:.2f} INR/person")
    print(f"  National CSR density - Median: {national_median:.2f} INR/person")

    # ── Component C: UNRESOLVED POVERTY (U) ──
    has_baseline = master["hr_2016"].notna() & (master["hr_2016"] > 0)
    master.loc[has_baseline, "U_raw"] = (
        master.loc[has_baseline, "hr_2021"] / master.loc[has_baseline, "hr_2016"]
    )
    median_retention = master.loc[has_baseline, "U_raw"].median()
    print(f"  Median retention ratio: {median_retention:.3f}")
    master.loc[~has_baseline, "U_raw"] = median_retention

    # ── Min-Max Normalization ──
    for comp in ["N_raw", "G_raw", "U_raw"]:
        norm_col = comp.replace("_raw", "_norm")
        vals = master[comp]
        vmin, vmax = vals.min(), vals.max()
        if vmax > vmin:
            master[norm_col] = (vals - vmin) / (vmax - vmin)
        else:
            master[norm_col] = 0.5

    # ── Compute POS ──
    master["POS"] = (
        W_N * master["N_norm"] +
        W_G * master["G_norm"] +
        W_U * master["U_norm"]
    ) * 100

    # ── Whitespace flag ──
    # Bottom 25% CSR per person (within their tier) AND top 25% headcount ratio
    csr_p25 = master["district_csr_per_person"].quantile(0.25)
    hr_p75 = master["N_raw"].quantile(0.75)
    master["is_whitespace"] = (
        (master["district_csr_per_person"] <= csr_p25) &
        (master["N_raw"] >= hr_p75)
    )

    print(f"\n  POS range: {master['POS'].min():.1f} - {master['POS'].max():.1f}")
    print(f"  Whitespace districts: {master['is_whitespace'].sum()}")
    print(f"  CSR 25th percentile: {csr_p25:.2f} INR/person")
    print(f"  MPI headcount 75th percentile: {hr_p75:.4f}")

    # Return tier medians dict and extra metadata for downstream use
    tier_medians_dict = {str(k): round(float(v), 2) for k, v in tier_medians.items()}
    extra_meta = {
        "whitespace_thresholds": {
            "csr_p25": round(float(csr_p25), 2),
            "hr_p75_pct": round(float(hr_p75 * 100), 1),
        },
        "whitespace_count": int(master["is_whitespace"].sum()),
        "pos_range": {
            "min": round(float(master["POS"].min()), 1),
            "max": round(float(master["POS"].max()), 1),
        },
        "pop_tier_boundaries": {
            "p33": int(round(float(pop_p33))),
            "p67": int(round(float(pop_p67))),
        },
        "national_mean_csr": round(float(national_mean), 2),
        "median_retention_ratio": round(float(median_retention), 3),
    }
    return master, national_median, tier_medians_dict, extra_meta


# ═══════════════════════════════════════════════════════════════════════════
# STEP 6: Compute sector-specific scores
# ═══════════════════════════════════════════════════════════════════════════

def compute_sector_scores(master, csr_sector_pivot):
    """Compute sector-specific POS for each district."""
    print("\n" + "=" * 60)
    print("STEP 6: Computing sector-specific scores...")
    print("=" * 60)

    sector_scores = {}

    for _, row in master.iterrows():
        lgd = row["district_lgd_code"]
        sector_scores[lgd] = {}

    for sector in SCORE_SECTORS:
        # Find matching sector column in pivot table
        matching_col = None
        for col in csr_sector_pivot.columns:
            if isinstance(col, str) and fuzz.ratio(col.lower(), sector.lower()) > 80:
                matching_col = col
                break

        if matching_col is None:
            print(f"  WARNING: Sector '{sector}' not found in CSR data")
            continue

        # Build sector CSR per person for each district
        sector_csr = {}
        for _, srow in csr_sector_pivot.iterrows():
            lgd = str(srow.get("district_lgd_code", ""))
            if lgd and lgd != "nan":
                sector_csr[lgd] = srow.get(matching_col, 0)

        # Compute sector density for matched master districts
        sector_densities = []
        for _, mrow in master.iterrows():
            lgd = mrow["district_lgd_code"]
            csr_amount = sector_csr.get(lgd, 0)
            density = (csr_amount * 1e7) / mrow["total_population"] if mrow["total_population"] > 0 else 0
            sector_densities.append(density)

        master_temp = master.copy()
        master_temp["sector_density"] = sector_densities

        # Tier-specific median sector density as benchmark
        tier_sector_medians = master_temp.groupby("pop_tier", observed=True)["sector_density"].median()
        master_temp["tier_sector_median"] = master_temp["pop_tier"].map(tier_sector_medians).astype(float)

        # Sector gap (tiered)
        master_temp["sector_gap"] = (master_temp["tier_sector_median"] - master_temp["sector_density"]).clip(lower=0)

        # Normalize sector gap
        sg_min, sg_max = master_temp["sector_gap"].min(), master_temp["sector_gap"].max()
        if sg_max > sg_min:
            master_temp["sector_G_norm"] = (master_temp["sector_gap"] - sg_min) / (sg_max - sg_min)
        else:
            master_temp["sector_G_norm"] = 0.5

        # Sector POS
        sector_pos = (
            W_N * master_temp["N_norm"] +
            W_G * master_temp["sector_G_norm"] +
            W_U * master_temp["U_norm"]
        ) * 100

        for i, (_, mrow) in enumerate(master.iterrows()):
            lgd = mrow["district_lgd_code"]
            score = float(sector_pos.iloc[i])
            if math.isfinite(score):
                sector_scores[lgd][sector] = round(score, 2)
            else:
                sector_scores[lgd][sector] = 50.0  # neutral fallback

        print(f"  {sector}: computed for {len(master)} districts")

    return sector_scores


# ═══════════════════════════════════════════════════════════════════════════
# STEP 7: Output to JSON
# ═══════════════════════════════════════════════════════════════════════════

def safe_json_value(val):
    """Convert a value to JSON-safe format."""
    if val is None:
        return None
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating, float)):
        if math.isnan(val) or math.isinf(val):
            return None
        return round(float(val), 6)
    if isinstance(val, (np.bool_,)):
        return bool(val)
    if isinstance(val, bool):
        return val
    return val


def output_json(master, sector_scores, median_csr, tier_medians, out_dir, extra_meta=None):
    """Write validated JSON files."""
    print("\n" + "=" * 60)
    print("STEP 7: Writing output JSON...")
    print("=" * 60)

    os.makedirs(out_dir, exist_ok=True)

    # Master JSON
    records = []
    for _, row in master.iterrows():
        record = {
            "state_name": str(row["state"]),
            "district_name": str(row["district"]),
            "district_lgd_code": str(row["district_lgd_code"]),
            "headcount_ratio_2016": safe_json_value(row["hr_2016"]),
            "headcount_ratio_2021": safe_json_value(row["hr_2021"]),
            "intensity_2021": safe_json_value(row["intensity_2021"]),
            "mpi_2021": safe_json_value(row["mpi_2021"]),
            "total_csr_recent": safe_json_value(row["total_csr_recent"]),
            "total_population": safe_json_value(row["total_population"]),
            "district_csr_per_person": safe_json_value(row["district_csr_per_person"]),
            "pop_tier": str(row["pop_tier"]),
            "tier_median_csr": safe_json_value(row["tier_median_csr"]),
            "N_raw": safe_json_value(row["N_raw"]),
            "G_raw": safe_json_value(row["G_raw"]),
            "U_raw": safe_json_value(row["U_raw"]),
            "N_norm": safe_json_value(row["N_norm"]),
            "G_norm": safe_json_value(row["G_norm"]),
            "U_norm": safe_json_value(row["U_norm"]),
            "POS": safe_json_value(row["POS"]),
            "is_whitespace": safe_json_value(row["is_whitespace"]),
        }
        records.append(record)

    master_path = os.path.join(out_dir, "whitespace_master.json")
    with open(master_path, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    # Validate: re-read and check
    with open(master_path, "r") as f:
        test = json.load(f)
    print(f"  whitespace_master.json: {len(test)} records, valid JSON confirmed")

    # Sector scores JSON
    sector_path = os.path.join(out_dir, "sector_scores.json")
    with open(sector_path, "w", encoding="utf-8") as f:
        json.dump(sector_scores, f, indent=2, ensure_ascii=False)

    with open(sector_path, "r") as f:
        test_s = json.load(f)
    print(f"  sector_scores.json: {len(test_s)} districts, valid JSON confirmed")

    # Store meta information
    meta = {
        "national_median_csr_per_person": round(median_csr, 2),
        "tier_medians": tier_medians,
        "total_districts": len(records),
        "methodology": "population-tertile-stratified benchmarking",
    }
    if extra_meta:
        meta.update(extra_meta)
    meta_path = os.path.join(out_dir, "meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)


# ═══════════════════════════════════════════════════════════════════════════
# STEP 8: Print verification report
# ═══════════════════════════════════════════════════════════════════════════

def print_report(master):
    """Print verification data."""
    print("\n" + "=" * 60)
    print("VERIFICATION REPORT")
    print("=" * 60)

    print(f"\n  Total districts: {len(master)}")
    print(f"  POS range: {master['POS'].min():.1f} - {master['POS'].max():.1f}")
    print(f"  Whitespace districts: {master['is_whitespace'].sum()}")

    print(f"\n  TOP 20 DISTRICTS BY POS:")
    top20 = master.nlargest(20, "POS")
    for i, (_, row) in enumerate(top20.iterrows()):
        print(f"    {i+1:3d}. {row['district']:<25s} {row['state']:<20s}  "
              f"POS={row['POS']:5.1f}  HR={row['hr_2021']:.4f}  "
              f"CSR/pp={row['district_csr_per_person']:.0f}  "
              f"WS={'YES' if row['is_whitespace'] else 'no'}")

    print(f"\n  DISTRICTS BY STATE (top 10 by count):")
    state_counts = master.groupby("state").size().sort_values(ascending=False).head(10)
    for state, count in state_counts.items():
        avg_pos = master[master["state"] == state]["POS"].mean()
        print(f"    {state:<30s} {count:3d} districts  avg POS={avg_pos:.1f}")

    # Check for any remaining NaN/Infinity issues
    for col in ["POS", "N_norm", "G_norm", "U_norm", "district_csr_per_person"]:
        bad = master[col].isna().sum() + np.isinf(master[col]).sum()
        if bad > 0:
            print(f"  WARNING: {col} has {bad} NaN/Inf values!")


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

def main():
    print("Whitespace India - Data Pipeline")
    print("================================\n")

    # Step 1: Extract MPI from PDF
    mpi_df = extract_mpi_from_pdf(PDF_PATH)

    # Step 2: Process CSR Excel
    csr_district, csr_sector_pivot = process_csr_excel(EXCEL_PATH)

    # Step 3: Process Census
    census, total_pop = process_census(CENSUS_PATH)

    # Step 4: Merge
    master = fuzzy_match_districts(mpi_df, csr_district, census)

    # Step 5: Compute scores (population-tertile-stratified)
    master, median_csr, tier_medians, extra_meta = compute_scores(master, total_pop)

    # Step 6: Sector scores (also tiered)
    sector_scores = compute_sector_scores(master, csr_sector_pivot)

    # Step 7: Output
    output_json(master, sector_scores, median_csr, tier_medians, OUT_DIR, extra_meta)

    # Step 8: Report
    print_report(master)

    print("\n" + "=" * 60)
    print("PIPELINE COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    main()
