"""Measure registry for Instrument 01 - People & Consent.

One entry per computed measure. The registry is the single source of truth for
what a number MEANS: its definition, the expression that produced it, the source
dataset and the vintage of that source. District files carry only values; the
interface joins value to definition at render time.

That split is deliberate. It makes it structurally impossible to compare two
numbers computed under different definitions, because a benchmark and its value
resolve to the same registry entry or the comparison does not render at all.

DENOMINATORS ARE NOT INTERCHANGEABLE. Census literacy is defined over population
aged 7 and above, not total population; work participation is over total
population; worker composition is over total workers. Each entry states its own
denominator and `denominator_key` names the measure it divides by.

EXCLUDED SOURCE COLUMNS, and why - do not add these back without re-verifying:
  pc11_vd_ph_cntr        sums to 58,806 nationally against roughly 24,000 actual
                         PHCs in 2011, with 30,000 in a single subdistrict.
                         The column is corrupt at this aggregation.
  pc11_vd_disp           max 9,419 in one subdistrict. Implausible.
  pc11_vd_ch_cntr        max 2,519 in one subdistrict. Implausible.
  pc11_vd_power_*,       binary 0/1 flags at subdistrict level, not shares:
  pc11_vd_wat_*,         5,590 of 5,834 subdistricts are 1, so the variable
  pc11_vd_bus_*,         answers "does ANY village here have this" and is 96%
  pc11_vd_asha, _pds,    yes nationally. It carries no usable signal about
  pc11_vd_atm            coverage and must not be rendered as one.
"""
from __future__ import annotations

PCA = ("Census of India 2011, Primary Census Abstract, as compiled in SHRUG "
       "v5.0, the Development Data Lab's sub-district dataset for India")
VD = ("Census of India 2011, Village Directory, as compiled in SHRUG v5.0, the "
      "Development Data Lab's sub-district dataset for India")
SECC = ("Socio Economic and Caste Census 2011, rural households, Ministry of "
        "Rural Development, as compiled in SHRUG v5.0, the Development Data "
        "Lab's sub-district dataset for India")
V2011 = "2011"

# kind:
#   "count" - an absolute number
#   "rate"  - a percentage; MUST name its denominator_key
#   "ratio" - a dimensionless ratio
MEASURES: dict[str, dict] = {
    # ── Population ────────────────────────────────────────────────────────
    "pop.total": {
        "label": "Total population",
        "unit": "count",
        "kind": "count",
        "definition": "Everyone enumerated in Census 2011 within the district's 2011 boundary.",
        "formula": "sum(pc11_pca_tot_p) over the district's subdistricts",
        "source": PCA,
        "vintage": V2011,
        "group": "population",
    },
    "pop.households": {
        "label": "Households",
        "unit": "count",
        "kind": "count",
        "definition": "Normal households enumerated in Census 2011, the Census term for people who usually live together and eat from a common kitchen.",
        "formula": "sum(pc11_pca_no_hh)",
        "source": PCA,
        "vintage": V2011,
        "group": "population",
    },
    "pop.avg_household_size": {
        "label": "Average household size",
        "unit": "ratio",
        "kind": "ratio",
        "definition": "People per household, found by dividing the total population by the number of households.",
        "formula": "pop.total / pop.households",
        "source": PCA,
        "vintage": V2011,
        "group": "population",
        "range": [1.0, 12.0],
    },
    "pop.st_share": {
        "label": "Scheduled Tribe share of population",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "pop.total",
        "definition": (
            "People enumerated as members of a Scheduled Tribe, as a percentage "
            "of the whole population, children under seven included."
        ),
        "formula": "100 * sum(pc11_pca_p_st) / sum(pc11_pca_tot_p)",
        "source": PCA,
        "vintage": V2011,
        "group": "population",
        "range": [0.0, 100.0],
        "caveats": [
            "Scheduled Tribe is a constitutional status given to communities. "
            "Scheduled Areas are declared separately, by Presidential Order under "
            "the Fifth Schedule, and many districts with a large tribal population "
            "lie outside them, so this share describes who lives here and settles "
            "no legal question.",
        ],
    },
    "pop.sc_share": {
        "label": "Scheduled Caste share of population",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "pop.total",
        "definition": "People enumerated as members of a Scheduled Caste, as a percentage of the whole population.",
        "formula": "100 * sum(pc11_pca_p_sc) / sum(pc11_pca_tot_p)",
        "source": PCA,
        "vintage": V2011,
        "group": "population",
        "range": [0.0, 100.0],
    },
    "pop.child_share": {
        "label": "Children aged 0-6",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "pop.total",
        "definition": "Children aged 0 to 6 as a percentage of the whole population.",
        "formula": "100 * sum(pc11_pca_p_06) / sum(pc11_pca_tot_p)",
        "source": PCA,
        "vintage": V2011,
        "group": "population",
        "range": [0.0, 40.0],
    },
    "pop.literacy_rate": {
        "label": "Literacy rate",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "pop.age7plus",
        "definition": (
            "People who can both read and write with understanding in any "
            "language, as a percentage of the population aged seven and above. "
            "This is the Census of India definition. Measured over the whole "
            "population, children included, the rate comes out markedly lower "
            "and matches no published Census figure."
        ),
        "formula": "100 * sum(pc11_pca_p_lit) / (sum(pc11_pca_tot_p) - sum(pc11_pca_p_06))",
        "source": PCA,
        "vintage": V2011,
        "group": "population",
        "range": [0.0, 100.0],
    },
    "pop.age7plus": {
        "label": "Population aged 7 and above",
        "unit": "count",
        "kind": "count",
        "definition": "The whole population minus children aged 0 to 6, which the Census uses as the base for its literacy rate.",
        "formula": "sum(pc11_pca_tot_p) - sum(pc11_pca_p_06)",
        "source": PCA,
        "vintage": V2011,
        "group": "population",
        "internal": True,
    },
    "pop.sex_ratio": {
        "label": "Sex ratio",
        "unit": "ratio",
        "kind": "ratio",
        "definition": "Females per 1,000 males, the convention used by the Census of India.",
        "formula": "1000 * sum(pc11_pca_tot_f) / sum(pc11_pca_tot_m)",
        "source": PCA,
        "vintage": V2011,
        "group": "population",
        "range": [500.0, 1300.0],
    },
    # ── Livelihood ────────────────────────────────────────────────────────
    "work.total_workers": {
        "label": "Total workers",
        "unit": "count",
        "kind": "count",
        "definition": (
            "Everyone recorded in Census 2011 as a main or marginal worker. A main "
            "worker worked for six months or more of the year before the count, "
            "and a marginal worker for less than six months."
        ),
        "formula": "sum(pc11_pca_tot_work_p)",
        "source": PCA,
        "vintage": V2011,
        "group": "livelihood",
    },
    "work.participation_rate": {
        "label": "Work participation rate",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "pop.total",
        "definition": (
            "Total workers as a percentage of the whole population, children "
            "included, which is the Census of India definition. A labour-force "
            "participation rate, computed over the working-age population, is a "
            "different measure and runs higher."
        ),
        "formula": "100 * sum(pc11_pca_tot_work_p) / sum(pc11_pca_tot_p)",
        "source": PCA,
        "vintage": V2011,
        "group": "livelihood",
        "range": [0.0, 100.0],
    },
    "work.land_dependent_share": {
        "label": "Workers dependent on land",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "work.total_workers",
        "definition": (
            "Cultivators and agricultural labourers, main and marginal together, "
            "as a percentage of all workers. These are the workers who earn their "
            "living directly from land, and so the people a land acquisition "
            "affects most directly."
        ),
        "formula": (
            "100 * (main_cl_p + main_al_p + marg_cl_p + marg_al_p) / tot_work_p"
        ),
        "source": PCA,
        "vintage": V2011,
        "group": "livelihood",
        "range": [0.0, 100.0],
        "caveats": [
            "The figure counts individual workers. People who live on forest "
            "produce or common land are included only if the Census recorded them "
            "as cultivators or agricultural labourers.",
        ],
    },
    "work.cultivator_share": {
        "label": "Cultivators",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "work.total_workers",
        "definition": "Cultivators, main and marginal, as a percentage of all workers. The Census counts as a cultivator anyone who farms land they own or hold from the government, a private person or an institution.",
        "formula": "100 * (main_cl_p + marg_cl_p) / tot_work_p",
        "source": PCA,
        "vintage": V2011,
        "group": "livelihood",
        "range": [0.0, 100.0],
    },
    "work.ag_labourer_share": {
        "label": "Agricultural labourers",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "work.total_workers",
        "definition": (
            "Agricultural labourers, main and marginal, as a percentage of all "
            "workers. An agricultural labourer works on another person's land for "
            "wages in money, kind or share and holds no right in it, so receives "
            "no compensation for the land when it is acquired. Where the 2013 land "
            "acquisition Act (RFCTLARR) governs, a labourer who worked in the "
            "affected area for the three years before the acquisition, and whose "
            "main livelihood it affects, counts as an affected family under "
            "section 3(c) and is owed rehabilitation and resettlement."
        ),
        "formula": "100 * (main_al_p + marg_al_p) / tot_work_p",
        "source": PCA,
        "vintage": V2011,
        "group": "livelihood",
        "range": [0.0, 100.0],
    },
    "work.marginal_share": {
        "label": "Marginal workers",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "work.total_workers",
        "definition": (
            "Workers who worked for less than six months of the year before the "
            "count, as a percentage of all workers. A high share points to "
            "seasonal or insecure work."
        ),
        "formula": "100 * sum(pc11_pca_margwork_p) / sum(pc11_pca_tot_work_p)",
        "source": PCA,
        "vintage": V2011,
        "group": "livelihood",
        "range": [0.0, 100.0],
    },
    "work.household_industry_share": {
        "label": "Household industry workers",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "work.total_workers",
        "definition": "Workers in household industry, main and marginal, as a percentage of all workers.",
        "formula": "100 * (main_hh_p + marg_hh_p) / tot_work_p",
        "source": PCA,
        "vintage": V2011,
        "group": "livelihood",
        "range": [0.0, 100.0],
    },
    # ── Community infrastructure ──────────────────────────────────────────
    "infra.phc_doctors_sanctioned": {
        "label": "Primary Health Centre doctor posts sanctioned",
        "unit": "count",
        "kind": "count",
        "definition": "Doctor positions sanctioned at Primary Health Centres in the district's rural areas.",
        "formula": "sum(pc11_vd_ph_cntr_doc_tot)",
        "source": VD,
        "vintage": V2011,
        "group": "infrastructure",
    },
    "infra.phc_doctors_in_post": {
        "label": "Primary Health Centre doctor posts filled",
        "unit": "count",
        "kind": "count",
        "definition": "Doctor posts filled at Primary Health Centres in the district's rural areas.",
        "formula": "sum(pc11_vd_ph_cntr_doc_pos)",
        "source": VD,
        "vintage": V2011,
        "group": "infrastructure",
    },
    "infra.phc_doctor_vacancy_rate": {
        "label": "Primary Health Centre doctor vacancy",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "infra.phc_doctors_sanctioned",
        "definition": (
            "Sanctioned doctor posts left vacant, as a percentage of all sanctioned "
            "posts. Both figures come from the same Village Directory columns, so "
            "the rate avoids the unit problems that make the directory's raw "
            "facility counts unusable."
        ),
        "formula": "100 * (doc_tot - doc_pos) / doc_tot",
        "source": VD,
        "vintage": V2011,
        "group": "infrastructure",
        "range": [0.0, 100.0],
        "caveats": [
            "The figure covers rural areas only. A district with no sanctioned "
            "posts shows no figure.",
            "In 21 districts the source records more doctors in post than posts sanctioned. We read that as an inconsistency within the Village Directory, so we withhold the rate for those districts and still show both counts.",
        ],
    },
    "infra.hospitals": {
        "label": "Hospitals",
        "unit": "count",
        "kind": "count",
        "definition": "All hospitals recorded in the Village Directory for the district's rural areas.",
        "formula": "sum(pc11_vd_all_hosp)",
        "source": VD,
        "vintage": V2011,
        "group": "infrastructure",
        "caveats": ["The figure covers rural areas only, and hospitals in towns and cities are left out."],
    },
    "infra.primary_schools_gov": {
        "label": "Government primary schools",
        "unit": "count",
        "kind": "count",
        "definition": "Government primary schools in the district's rural areas.",
        "formula": "sum(pc11_vd_p_sch_gov)",
        "source": VD,
        "vintage": V2011,
        "group": "infrastructure",
    },
    "infra.middle_schools_gov": {
        "label": "Government middle schools",
        "unit": "count",
        "kind": "count",
        "definition": "Government middle schools in the district's rural areas.",
        "formula": "sum(pc11_vd_m_sch_gov)",
        "source": VD,
        "vintage": V2011,
        "group": "infrastructure",
        "caveats": [
            "Some states have no separate middle-school category. All 26 of Gujarat's districts report zero, because its primary schools run to standard 8 and leave no separate middle school to count. Where a measure is zero across a whole state we withhold it, because a zero would suggest the schools are missing.",
        ],
    },
    "infra.secondary_schools_gov": {
        "label": "Government secondary schools",
        "unit": "count",
        "kind": "count",
        "definition": "Government secondary schools in the district's rural areas.",
        "formula": "sum(pc11_vd_s_sch_gov)",
        "source": VD,
        "vintage": V2011,
        "group": "infrastructure",
    },

    # ── How households live: SECC 2011, rural ───────────────────────────
    # The Socio Economic and Caste Census records each RURAL household's
    # circumstances - land, income, work - which the population census does
    # not. SHRUG publishes it per sub-district as SHARES of households. A
    # district's share is therefore the household-weighted mean of its
    # sub-districts' shares - sum(share x households) / sum(households) - and
    # never the plain mean, which would give a 50-household tehsil the weight
    # of a 50,000-household one. Only sub-districts that report the share
    # enter either sum, so a missing answer is never counted as a "no".
    #
    # Checked at national level against the Ministry of Rural Development's
    # published SECC 2011 rural summary: land-owning 46.1% (published, about
    # 44%), highest earner over Rs 5,000 a month 24.3% (about 25%), main
    # income from manual casual labour 51.8% (about 51%), any salaried member
    # 8.3% (about 9.7%, the SHRUG subset covering 16.1 of 17.97 crore rural
    # households).
    "secc.households": {
        "label": "Rural households (SECC)",
        "unit": "count",
        "kind": "count",
        "definition": "Rural households enumerated in the Socio Economic and Caste Census 2011 and matched to this area in SHRUG.",
        "formula": "sum(secc_hh)",
        "source": SECC,
        "vintage": V2011,
        "group": "circumstances",
        "internal": True,
    },
    "secc.land_owning_share": {
        "label": "Rural households owning land",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "secc.households",
        "definition": "Share of rural households that own land, as recorded in SECC 2011. The table covers rural households only.",
        "formula": "100 * sum(land_own_share * secc_hh) / sum(secc_hh), over sub-districts reporting it",
        "source": SECC,
        "vintage": V2011,
        "group": "circumstances",
        "range": [0.0, 100.0],
    },
    "secc.earner_over_5k_share": {
        "label": "Rural households whose highest earner makes over ₹5,000 a month",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "secc.households",
        "definition": "Share of rural households whose highest-earning member makes more than ₹5,000 a month, as recorded in SECC 2011. Its complement, the share whose highest earner makes ₹5,000 or less, is the form in which SECC deprivation is most often quoted.",
        "formula": "100 * sum(inc_5k_plus_share * secc_hh) / sum(secc_hh), over sub-districts reporting it",
        "source": SECC,
        "vintage": V2011,
        "group": "circumstances",
        "range": [0.0, 100.0],
    },
    "secc.manual_labour_share": {
        "label": "Rural households living mainly on manual casual labour",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "secc.households",
        "definition": "Share of rural households whose main source of income is manual casual labour, as recorded in SECC 2011.",
        "formula": "100 * sum(inc_source_manlab_share * secc_hh) / sum(secc_hh), over sub-districts reporting it",
        "source": SECC,
        "vintage": V2011,
        "group": "circumstances",
        "range": [0.0, 100.0],
    },
    "secc.salaried_share": {
        "label": "Rural households with a salaried member",
        "unit": "percent",
        "kind": "rate",
        "denominator_key": "secc.households",
        "definition": "Share of rural households with any member in salaried employment (government, public or private sector), as recorded in SECC 2011.",
        "formula": "100 * sum(salary_any_share * secc_hh) / sum(secc_hh), over sub-districts reporting it",
        "source": SECC,
        "vintage": V2011,
        "group": "circumstances",
        "range": [0.0, 100.0],
    },
}

# The SECC share columns each rate above is built from, keyed by measure id.
# One place, read by the build's aggregation and its value computation, so the
# column a measure is computed from cannot drift from the one its formula names.
SECC_SHARES: dict[str, str] = {
    "secc.land_owning_share": "land_own_share",
    "secc.earner_over_5k_share": "inc_5k_plus_share",
    "secc.manual_labour_share": "inc_source_manlab_share",
    "secc.salaried_share": "salary_any_share",
}

GROUPS = {
    "population": "Population",
    "livelihood": "Work and livelihood",
    "infrastructure": "Village facilities",
    "circumstances": "Household circumstances",
}

# Measures whose value is shown to a reader. `internal` measures exist only as
# denominators for others.
PUBLIC_MEASURES = [k for k, v in MEASURES.items() if not v.get("internal")]
