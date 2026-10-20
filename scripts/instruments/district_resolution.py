"""District resolution for PARIVESH clearance proposals.

The PARIVESH search API returns `state` but no district. This module recovers a
Census 2011 district from the free-text `projectName`, state-constrained, and
records how it did so. Every resolution carries a method and a confidence so the
interface can distinguish a declared district from an inferred one.

Measured on the full register (114,659 records, fetched 2026-08-21):
  explicit District/Distt/Dist label present   33.0%
  resolved to an in-state Census 2011 district 30.9%   (see verification_report)
The remainder have no sub-state signal in the project name at all and are
reported as `unresolved`. They are NOT guessed.

Two label forms occur and both must be handled:
  prefix   "District-Sikar, Rajasthan"
  postfix  "Dolvi village, Raigad District, Maharashtra"
An earlier prefix-only implementation silently mis-parsed the postfix form,
matching `dist` inside the word `District` and capturing the fragment "rict"
5,075 times. Hence the word-boundary anchors below - do not remove them.

Resolution methods, in descending confidence:
  exact              label matched a Census 2011 district name in the same state
  spelling           label matched via a curated spelling-variant alias
  post2011_parent    label is a district created after Census 2011; resolved to
                     its 2011 parent, whose geometry and code it inherits. The
                     profile therefore describes the PARENT district's 2011
                     population, which is a real limitation and is surfaced.
  prefix             label began with a district name plus a qualifier
                     ("Jodhpur Rural" -> Jodhpur)
  fuzzy              state-constrained rapidfuzz match at or above FUZZY_CUTOFF.
                     LOW confidence and labelled as such - fuzzy alone is unsafe
                     here ("Sangareddy" scores 90 against "Rangareddy" but is a
                     different district, carved from Medak).
"""
from __future__ import annotations

import json
import re
import struct
from pathlib import Path

from rapidfuzz import fuzz, process

FUZZY_CUTOFF = 92

# ── Normalisation ─────────────────────────────────────────────────────────


def normalize_name(name: object) -> str:
    """Lowercase and strip every non-alphabetic character.

    Deliberately aggressive: source spellings vary in spacing, ampersands,
    dots and parentheses ("Y.S.R. (Kadapa)" vs "Y.s.r."), and none of that
    punctuation is ever meaningful for identity.
    """
    return re.sub(r"[^a-z]", "", str(name or "").lower())


# PARIVESH state spellings -> datameet ST_NM spellings.
# Post-2011 states (Telangana, Ladakh) have no 2011 geometry of their own; their
# districts sit under the 2011 parent state in the Census boundary file.
STATE_ALIASES: dict[str, str] = {
    "arunachalpradesh": "arunanchalpradesh",
    "andamanandnicobarislands": "andamannicobarisland",
    "andamannicobarislands": "andamannicobarisland",
    "andamannicobar": "andamannicobarisland",
    "dadranagarhaveli": "dadaranagarhavelli",
    "dadraandnagarhaveli": "dadaranagarhavelli",
    "dadraandnagarhavelianddamananddiu": "dadaranagarhavelli",
    "damananddiu": "damandiu",
    "delhi": "nctofdelhi",
    "nationalcapitalterritoryofdelhi": "nctofdelhi",
    "pondicherry": "puducherry",
    "orissa": "odisha",
    "uttaranchal": "uttarakhand",
    "telangana": "andhrapradesh",
    "ladakh": "jammukashmir",
    "jammuandkashmir": "jammukashmir",
    "jammukashmir": "jammukashmir",
}

# Curated district aliases. Two kinds, and the distinction matters to the UI:
#   "spelling"        - same 2011 district under a different transliteration or
#                       a post-2011 rename. No boundary change.
#   "post2011_parent" - a district created after Census 2011. Resolving to the
#                       parent means the socio-economic profile describes a
#                       LARGER area than the project's actual district.
#
# Sources: Census 2011 district directory spellings (datameet 2011_Dist.dbf) and
# state reorganisation notifications. Extend rather than replace; every entry
# added should be checked against the gazetteer, not guessed from similarity.
DISTRICT_ALIASES: dict[str, tuple[str, str]] = {
    # ── Odisha: 2011 census transliterations differ sharply from common usage
    "jajpur": ("Jajapur", "spelling"),
    "keonjhar": ("Kendujhar", "spelling"),
    "balasore": ("Baleshwar", "spelling"),
    "jagatsinghpur": ("Jagatsinghapur", "spelling"),
    "angul": ("Anugul", "spelling"),
    "khurda": ("Khordha", "spelling"),
    "khordha": ("Khordha", "spelling"),
    "bolangir": ("Balangir", "spelling"),
    "balangir": ("Balangir", "spelling"),
    "deogarh": ("Debagarh", "spelling"),
    "nabarangpur": ("Nabarangapur", "spelling"),
    "sonepur": ("Subarnapur", "spelling"),
    "subarnapur": ("Subarnapur", "spelling"),
    "boudh": ("Bauda", "spelling"),
    "baudh": ("Bauda", "spelling"),
    "sundergarh": ("Sundargarh", "spelling"),
    # ── Karnataka: 2014 renames
    "bengaluru": ("Bangalore", "spelling"),
    "bengaluruurban": ("Bangalore", "spelling"),
    "bengalururural": ("Bangalore Rural", "spelling"),
    "mysuru": ("Mysore", "spelling"),
    "belagavi": ("Belgaum", "spelling"),
    "ballari": ("Bellary", "spelling"),
    "kalaburagi": ("Gulbarga", "spelling"),
    "vijayapura": ("Bijapur", "spelling"),
    "shivamogga": ("Shimoga", "spelling"),
    "tumakuru": ("Tumkur", "spelling"),
    "chikkamagaluru": ("Chikmagalur", "spelling"),
    "bagalkote": ("Bagalkot", "spelling"),
    "davangere": ("Davanagere", "spelling"),
    "chamarajanagara": ("Chamrajnagar", "spelling"),
    "chamarajanagar": ("Chamrajnagar", "spelling"),
    "vijayanagara": ("Bellary", "post2011_parent"),
    # ── Maharashtra
    "raigad": ("Raigarh", "spelling"),
    "ahmednagar": ("Ahmadnagar", "spelling"),
    "ahilyanagar": ("Ahmadnagar", "spelling"),
    "buldhana": ("Buldana", "spelling"),
    "gondia": ("Gondiya", "spelling"),
    "gadchiroli": ("Garhchiroli", "spelling"),
    "beed": ("Bid", "spelling"),
    "dharashiv": ("Osmanabad", "spelling"),
    "palghar": ("Thane", "post2011_parent"),
    # ── Rajasthan: 2023 reorganisation created many districts
    "jhunjhunu": ("Jhunjhunun", "spelling"),
    "jalore": ("Jalor", "spelling"),
    "dholpur": ("Dhaulpur", "spelling"),
    "chittorgarh": ("Chittaurgarh", "spelling"),
    "sriganganagar": ("Ganganagar", "spelling"),
    "bhartpur": ("Bharatpur", "spelling"),
    "beawar": ("Ajmer", "post2011_parent"),
    "kekri": ("Ajmer", "post2011_parent"),
    "didwana": ("Nagaur", "post2011_parent"),
    "didwanakuchaman": ("Nagaur", "post2011_parent"),
    "kuchaman": ("Nagaur", "post2011_parent"),
    "makrana": ("Nagaur", "post2011_parent"),
    "neemkathana": ("Sikar", "post2011_parent"),
    "balotra": ("Barmer", "post2011_parent"),
    "kotputlibehror": ("Jaipur", "post2011_parent"),
    "kotputli": ("Jaipur", "post2011_parent"),
    "dudu": ("Jaipur", "post2011_parent"),
    "phalodi": ("Jodhpur", "post2011_parent"),
    "salumbar": ("Udaipur", "post2011_parent"),
    "sanchore": ("Jalor", "post2011_parent"),
    "shahpura": ("Bhilwara", "post2011_parent"),
    "khairthaltijara": ("Alwar", "post2011_parent"),
    "anupgarh": ("Ganganagar", "post2011_parent"),
    "deeg": ("Bharatpur", "post2011_parent"),
    "gangapurcity": ("Sawai Madhopur", "post2011_parent"),
    # ── Telangana: 2016 reorganisation (2011 parents are Andhra Pradesh rows)
    "sangareddy": ("Medak", "post2011_parent"),
    "siddipet": ("Medak", "post2011_parent"),
    "medchalmalkajgiri": ("Rangareddy", "post2011_parent"),
    "vikarabad": ("Rangareddy", "post2011_parent"),
    "mulugu": ("Warangal", "post2011_parent"),
    "hanumakonda": ("Warangal", "post2011_parent"),
    "warangalrural": ("Warangal", "post2011_parent"),
    "warangalurban": ("Warangal", "post2011_parent"),
    "mahabubabad": ("Warangal", "post2011_parent"),
    "jayashankarbhupalapally": ("Warangal", "post2011_parent"),
    "jagitial": ("Karimnagar", "post2011_parent"),
    "jagtial": ("Karimnagar", "post2011_parent"),
    "peddapalli": ("Karimnagar", "post2011_parent"),
    "rajannasircilla": ("Karimnagar", "post2011_parent"),
    "kamareddy": ("Nizamabad", "post2011_parent"),
    "mancherial": ("Adilabad", "post2011_parent"),
    "nirmal": ("Adilabad", "post2011_parent"),
    "kumurambheemasifabad": ("Adilabad", "post2011_parent"),
    "bhadradrikothagudem": ("Khammam", "post2011_parent"),
    "suryapet": ("Nalgonda", "post2011_parent"),
    "yadadribhuvanagiri": ("Nalgonda", "post2011_parent"),
    "nagarkurnool": ("Mahbubnagar", "post2011_parent"),
    "wanaparthy": ("Mahbubnagar", "post2011_parent"),
    "jogulambagadwal": ("Mahbubnagar", "post2011_parent"),
    "narayanpet": ("Mahbubnagar", "post2011_parent"),
    "mahabubnagar": ("Mahbubnagar", "spelling"),
    # ── Andhra Pradesh: 2022 reorganisation
    "spsrnellore": ("Sri Potti Sriramulu Nellore", "spelling"),
    "nellore": ("Sri Potti Sriramulu Nellore", "spelling"),
    "ysrkadapa": ("Y.s.r.", "spelling"),
    "kadapa": ("Y.s.r.", "spelling"),
    "visakhapatanam": ("Visakhapatnam", "spelling"),
    "anakapalli": ("Visakhapatnam", "post2011_parent"),
    "alluriseethararmaraju": ("Visakhapatnam", "post2011_parent"),
    "palnadu": ("Guntur", "post2011_parent"),
    "bapatla": ("Guntur", "post2011_parent"),
    "annamayya": ("Y.s.r.", "post2011_parent"),
    "tirupati": ("Chittoor", "post2011_parent"),
    "srisathyasai": ("Anantapur", "post2011_parent"),
    "nandyal": ("Kurnool", "post2011_parent"),
    "konaseema": ("East Godavari", "post2011_parent"),
    "kakinada": ("East Godavari", "post2011_parent"),
    "eluru": ("West Godavari", "post2011_parent"),
    "ntr": ("Krishna", "post2011_parent"),
    "parvathipuram": ("Vizianagaram", "post2011_parent"),
    # ── Gujarat: 2013 reorganisation
    "ahmedabad": ("Ahmadabad", "spelling"),
    "kutch": ("Kachchh", "spelling"),
    "dang": ("The Dangs", "spelling"),
    "dangs": ("The Dangs", "spelling"),
    "panchmahal": ("Panch Mahals", "spelling"),
    "morbi": ("Rajkot", "post2011_parent"),
    "botad": ("Bhavnagar", "post2011_parent"),
    "mahisagar": ("Panch Mahals", "post2011_parent"),
    "chhotaudepur": ("Vadodara", "post2011_parent"),
    "devbhumidwarka": ("Jamnagar", "post2011_parent"),
    "girsomnath": ("Junagadh", "post2011_parent"),
    "aravalli": ("Sabar Kantha", "post2011_parent"),
    # ── Chhattisgarh
    "dantewada": ("Dakshin Bastar Dantewada", "spelling"),
    "kanker": ("Uttar Bastar Kanker", "spelling"),
    "kabirdham": ("Kabeerdham", "spelling"),
    "korea": ("Koriya", "spelling"),
    "janjgirchampa": ("Janjgir - Champa", "spelling"),
    "sukma": ("Dakshin Bastar Dantewada", "post2011_parent"),
    "kondagaon": ("Bastar", "post2011_parent"),
    "surajpur": ("Surguja", "post2011_parent"),
    "balrampurramanujganj": ("Surguja", "post2011_parent"),
    "sarguja": ("Surguja", "spelling"),
    "gariyaband": ("Raipur", "post2011_parent"),
    "mungeli": ("Bilaspur", "post2011_parent"),
    "gaurelapendramarwahi": ("Bilaspur", "post2011_parent"),
    "sarangarh": ("Raigarh", "post2011_parent"),
    "sakti": ("Janjgir - Champa", "post2011_parent"),
    # ── Uttar Pradesh
    "prayagraj": ("Allahabad", "spelling"),
    "ayodhya": ("Faizabad", "spelling"),
    "amroha": ("Jyotiba Phule Nagar", "spelling"),
    "hathras": ("Mahamaya Nagar", "spelling"),
    "kasganj": ("Kansiram Nagar", "spelling"),
    "mahrajganj": ("Maharajganj", "spelling"),
    "shravasti": ("Shrawasti", "spelling"),
    "santkabeernagar": ("Sant Kabir Nagar", "spelling"),
    "bhadohi": ("Sant Ravidas Nagar (bhadohi)", "spelling"),
    "hapur": ("Ghaziabad", "post2011_parent"),
    "sambhal": ("Moradabad", "post2011_parent"),
    "shamli": ("Muzaffarnagar", "post2011_parent"),
    "amethi": ("Sultanpur", "post2011_parent"),
    # ── Madhya Pradesh
    "khandwa": ("East Nimar", "spelling"),
    "khargone": ("West Nimar", "spelling"),
    "narsinghpur": ("Narsimhapur", "spelling"),
    "agarmalwa": ("Shajapur", "post2011_parent"),
    "niwari": ("Tikamgarh", "post2011_parent"),
    "maihar": ("Satna", "post2011_parent"),
    "pandhurna": ("Chhindwara", "post2011_parent"),
    "mauganj": ("Rewa", "post2011_parent"),
    # ── Bihar / Jharkhand
    "purbichamparan": ("Purba Champaran", "spelling"),
    "pashchimchamparan": ("Pashchim Champaran", "spelling"),
    "koderma": ("Kodarma", "spelling"),
    "sahebganj": ("Sahibganj", "spelling"),
    "eastsinghbhum": ("Purbi Singhbhum", "spelling"),
    "westsinghbhum": ("Pashchimi Singhbhum", "spelling"),
    # ── Punjab / Haryana / HP / J&K
    "sasnagar": ("Sahibzada Ajit Singh Nagar", "spelling"),
    "mohali": ("Sahibzada Ajit Singh Nagar", "spelling"),
    "sbsnagar": ("Shahid Bhagat Singh Nagar", "spelling"),
    "shaheedbhagatsinghnagar": ("Shahid Bhagat Singh Nagar", "spelling"),
    "nawanshahr": ("Shahid Bhagat Singh Nagar", "spelling"),
    "ferozepur": ("Firozpur", "spelling"),
    "firozepur": ("Firozpur", "spelling"),
    "srimuktsarsahib": ("Muktsar", "spelling"),
    "pathankot": ("Gurdaspur", "post2011_parent"),
    "fazilka": ("Firozpur", "post2011_parent"),
    "malerkotla": ("Sangrur", "post2011_parent"),
    "gurugram": ("Gurgaon", "spelling"),
    "nuh": ("Mewat", "spelling"),
    "charkidadri": ("Bhiwani", "post2011_parent"),
    "lahaulspiti": ("Lahul & Spiti", "spelling"),
    "budgam": ("Badgam", "spelling"),
    "poonch": ("Punch", "spelling"),
    "shopian": ("Shupiyan", "spelling"),
    "baramulla": ("Baramula", "spelling"),
    "bandipora": ("Bandipore", "spelling"),
    "leh": ("Leh (ladakh)", "spelling"),
    # ── Tamil Nadu / Kerala
    "kanchipuram": ("Kancheepuram", "spelling"),
    "nagapattinam": ("Nagappattinam", "spelling"),
    "villupuram": ("Viluppuram", "spelling"),
    "virudhunagar": ("Virudunagar", "spelling"),
    "thoothukudi": ("Thoothukkudi", "spelling"),
    "tuticorin": ("Thoothukkudi", "spelling"),
    "chengalpattu": ("Kancheepuram", "post2011_parent"),
    "tenkasi": ("Tirunelveli", "post2011_parent"),
    "tirupathur": ("Vellore", "post2011_parent"),
    "ranipet": ("Vellore", "post2011_parent"),
    "kallakurichi": ("Viluppuram", "post2011_parent"),
    "mayiladuthurai": ("Nagappattinam", "post2011_parent"),
    # ── West Bengal / North East / Uttarakhand
    "darjeeling": ("Darjiling", "spelling"),
    "howrah": ("Haora", "spelling"),
    "hooghly": ("Hugli", "spelling"),
    "coochbehar": ("Koch Bihar", "spelling"),
    "paschimbardhaman": ("Barddhaman", "post2011_parent"),
    "purbabardhaman": ("Barddhaman", "post2011_parent"),
    "kalimpong": ("Darjiling", "post2011_parent"),
    "alipurduar": ("Jalpaiguri", "post2011_parent"),
    "jhargram": ("Pashchim Medinipur", "post2011_parent"),
    "haridwar": ("Hardwar", "spelling"),
    "morigaon": ("Marigaon", "spelling"),
    "hojai": ("Nagaon", "post2011_parent"),
    "charaideo": ("Sivasagar", "post2011_parent"),
    "majuli": ("Jorhat", "post2011_parent"),
    "lawngtlai": ("Lawangtlai", "spelling"),
}

# Tokens that appear where a district name is expected but are not districts.
# Mostly source data-entry errors (a state written into the district field) and
# parse noise. Listed explicitly so they are counted as bad input rather than
# silently attempted and reported as unresolvable.
NON_DISTRICT_TOKENS = {
    "odisha", "rajasthan", "gujarat", "maharashtra", "karnataka", "telangana",
    "andhrapradesh", "madhyapradesh", "uttarpradesh", "tamilnadu", "kerala",
    "surveyreport", "miningofficer", "collector", "office", "state", "india",
    "na", "nil", "none", "notapplicable",
}

# ── Label extraction ──────────────────────────────────────────────────────
# \b anchors are load-bearing: without them `dist` matches inside `District`
# and captures the fragment "rict". Verified against the live register.
_KEY = r"(?:district|distt|dist)"
PREFIX_RE = re.compile(
    rf"\b{_KEY}\b\.?\s*[-:.–—]?\s*([A-Za-z][A-Za-z .'&–-]{{2,40}})",
    re.IGNORECASE,
)
POSTFIX_RE = re.compile(
    rf"([A-Za-z][A-Za-z .'&–-]{{2,40}}?)\s*[-,]?\s*\b{_KEY}\b\.?(?![A-Za-z])",
    re.IGNORECASE,
)
_STOP_RE = re.compile(
    r"\b(state|tehsil|taluka|taluk|tal|mandal|mandalam|village|vill|villages|block|"
    r"of|in|at|and|for|the|near|dist|distt|district|division|sub|post|po|ps|by|ms|"
    r"ltd|limited|located|situated|pvt|private|company|plant|mine|project|area|no|nos)\b",
    re.IGNORECASE,
)


def _clean_capture(raw: str, take_last: bool) -> str:
    """Reduce a captured span to the bare district token."""
    parts = re.split(r"[,;()]", raw)
    raw = parts[-1] if take_last else parts[0]
    if take_last:
        last = None
        for m in _STOP_RE.finditer(raw):
            last = m
        if last:
            raw = raw[last.end():]
    else:
        cut = _STOP_RE.search(raw)
        if cut:
            raw = raw[: cut.start()]
    return normalize_name(raw)


# ── Gazetteer ─────────────────────────────────────────────────────────────


def parse_dbf(path: Path) -> list[dict]:
    """Read a dBase III file. datameet's 2011_Dist.dbf needs no shapefile lib.

    Layout: 32-byte header; (hdrlen-33)//32 field descriptors of 32 bytes each;
    a 0x0D terminator; then numrec fixed-width records, each prefixed by a
    one-byte deletion flag.
    """
    with open(path, "rb") as fh:
        head = fh.read(32)
        numrec, hdrlen, reclen = struct.unpack("<IHH", head[4:12])
        fields = []
        for _ in range((hdrlen - 33) // 32):
            fd = fh.read(32)
            fields.append((fd[:11].split(b"\x00")[0].decode(), fd[16]))
        fh.read(1)
        rows = []
        for _ in range(numrec):
            rec = fh.read(reclen)
            if not rec:
                break
            off, values = 1, {}
            for name, length in fields:
                values[name] = rec[off:off + length].decode("latin-1").strip()
                off += length
            # Deleted rows are skipped here. The geometry reader in
            # geometry.py deliberately KEEPS them, because it must stay
            # index-aligned with the .shp, which carries no deletion flag.
            # This reader joins by census code rather than by position, so
            # dropping is safe. The two can only disagree if a deleted row
            # ever appears; the file carries none today.
            if rec[0:1] != b"*":
                rows.append(values)
    return rows


class Gazetteer:
    """Census 2011 districts, indexed by state for constrained lookup."""

    def __init__(self, dbf_path: Path | None = None, *, rows: list[dict] | None = None):
        if rows is None:
            if dbf_path is None:
                raise ValueError("Gazetteer needs either dbf_path or rows")
            rows = parse_dbf(dbf_path)
        # censuscode 0 is a 'Data Not Available' placeholder row in the source.
        # It must be dropped or it attracts garbage in fuzzy matching.
        self.rows = [r for r in rows if str(r["censuscode"]).strip() not in ("", "0")]
        self.dropped_placeholders = len(rows) - len(self.rows)
        self.by_state: dict[str, dict[str, dict]] = {}
        for r in self.rows:
            self.by_state.setdefault(normalize_name(r["ST_NM"]), {})[
                normalize_name(r["DISTRICT"])
            ] = r
        self.by_code = {int(r["censuscode"]): r for r in self.rows}

    @classmethod
    def from_published(cls, root: Path | None = None) -> "Gazetteer":
        """Build from this repo's own districts.json instead of the source DBF.

        The DBF lives in a fetch cache outside the repository, so anything that
        needs a gazetteer - the resolver tests above all - could only run on a
        machine that had already done a full fetch. That made the test suite
        unrunnable in CI and on a fresh clone, which is the opposite of what a
        test suite is for.

        districts.json carries the same three fields the gazetteer indexes on
        (census code, district name, state name) for all 640 districts, and it is
        derived from that same DBF by the build. Reading it here is not a second
        source of truth; it is the first one, already committed.
        """
        root = root or Path(__file__).resolve().parent.parent.parent
        path = root / "public" / "data" / "instruments" / "consent" / "districts.json"
        published = json.loads(path.read_text(encoding="utf-8"))
        rows = [
            {
                "censuscode": str(d["censuscode"]),
                "DISTRICT": d["district_name"],
                "ST_NM": d["state_name"],
            }
            for d in published.values()
        ]
        return cls(rows=rows)

    def state_key(self, state: str) -> str:
        n = normalize_name(state)
        return STATE_ALIASES.get(n, n)

    def resolve(self, token: str, state: str) -> tuple[dict | None, str | None, int | None]:
        """Return (district_row, method, fuzzy_score) for a candidate token."""
        if not token or token in NON_DISTRICT_TOKENS:
            return None, None, None
        pool = self.by_state.get(self.state_key(state), {})
        if not pool:
            return None, None, None

        if token in pool:
            return pool[token], "exact", None

        alias = DISTRICT_ALIASES.get(token)
        if alias:
            target = normalize_name(alias[0])
            if target in pool:
                return pool[target], alias[1], None

        # "Jodhpur Rural" -> Jodhpur. Require >=5 chars so short names like
        # "Bid" or "Pali" cannot swallow unrelated tokens.
        starts = [d for d in pool if token.startswith(d) and len(d) >= 5]
        if starts:
            return pool[max(starts, key=len)], "prefix", None

        match = process.extractOne(token, list(pool), scorer=fuzz.ratio,
                                   score_cutoff=FUZZY_CUTOFF)
        if match:
            return pool[match[0]], "fuzzy", int(match[1])
        return None, None, None


CONFIDENCE = {
    "exact": "high",
    "spelling": "high",
    "prefix": "medium",
    "post2011_parent": "medium",
    "fuzzy": "low",
}


def resolve_district(project_name: str, state: str, gaz: Gazetteer) -> dict:
    """Resolve one proposal to a Census 2011 district.

    Returns a dict that is always well-formed; an unresolved proposal gets
    method 'unresolved' and null codes. Never guesses.
    """
    attempted: list[str] = []
    for form, regex, take_last in (
        ("prefix", PREFIX_RE, False),
        ("postfix", POSTFIX_RE, True),
    ):
        for m in regex.finditer(project_name or ""):
            token = _clean_capture(m.group(1), take_last)
            if not token or len(token) < 3:
                continue
            attempted.append(token)
            row, method, score = gaz.resolve(token, state)
            if row is not None:
                return {
                    "censuscode": int(row["censuscode"]),
                    "district_name": row["DISTRICT"],
                    "state_name_2011": row["ST_NM"],
                    "resolution_method": method,
                    "resolution_form": form,
                    "resolution_confidence": CONFIDENCE[method],
                    "resolution_token": token,
                    "fuzzy_score": score,
                    "inherits_parent_geometry": method == "post2011_parent",
                }
    return {
        "censuscode": None,
        "district_name": None,
        "state_name_2011": None,
        "resolution_method": "unresolved",
        "resolution_form": None,
        "resolution_confidence": None,
        "resolution_token": attempted[0] if attempted else None,
        "fuzzy_score": None,
        "inherits_parent_geometry": False,
    }
