# Whitespace India

**India's unattended problems, found in public data.**

Whitespace India reads India's public records together to find places where a problem is visible in the record and the response to it is not. Everything it publishes is free to use, with the method, data and code open.

- **CSR & Impact Finance** asks where company money for social causes goes, and where the need is greatest against it.
- **Instruments** are working tools for practitioners, built on the same public records.

**Live site:** [whitespaceindia.pages.dev](https://whitespaceindia.pages.dev)

| Tool | What it does | Status |
|-----|--------------|--------|
| [CSR Opportunity Index](https://whitespaceindia.pages.dev/csr) | Ranks 651 districts by the gap between multidimensional poverty and corporate social responsibility (CSR) spending | Live |
| [CSR spending by State](https://whitespaceindia.pages.dev/csr-spending) | Reported CSR spending against poverty, district by district, for each of 36 States and Union Territories, and the [list of whitespace districts](https://whitespaceindia.pages.dev/csr-spending/whitespace-districts) | Live |
| [Instrument 01: People & Consent](https://whitespaceindia.pages.dev/instruments/consent) | Takes an environmental clearance proposal and shows who lives where it would be built, what they live on, and which consent obligations attach | Live, refreshed nightly |
| [Instrument 02: Meal Claims Check](https://whitespaceindia.pages.dev/instruments/meal-claims) | Reads the PM POSHAN daily meal reports of 17 States and Union Territories and flags school-days on which a school's report contradicts its own filings | Live, refreshed nightly |
| Health, Education, Energy indexes | District indexes built on the same framework as CSR | In preview: placeholder data, not indexed |

## CSR Opportunity Index

The index combines NITI Aayog's Multidimensional Poverty Index with Ministry of Corporate Affairs CSR filings. The result is a Philanthropic Opportunity Score (POS) for 651 districts, which is higher where poverty is greater relative to recorded CSR spending.

The POS has three dimensions:

- **N, poverty severity:** the MPI headcount ratio (default weight 40%).
- **G, funding gap:** the CSR shortfall against the median for the district's population tier (default 40%).
- **U, persistence:** the share of 2015-16 poverty still present in 2019-21 (default 20%).

Only the funding gap compares a district with others in its population tier; each dimension is then rescaled across all districts. Every weight can be changed on the index page, and any district can be downloaded as a research brief. The full write-up is at [/methodology](https://whitespaceindia.pages.dev/methodology).

The same figures can be read two other ways: "Enter the ledger" on the [landing page](https://whitespaceindia.pages.dev/#ledger) opens every district in one table, and [/csr-spending](https://whitespaceindia.pages.dev/csr-spending) gives each State its own page.

| Source | Coverage | Link |
|--------|----------|------|
| NITI Aayog MPI 2023 | District headcount ratios (NFHS-5, 2019-21) | [PDF](https://niti.gov.in/sites/default/files/2023-07/National-Multidimentional-Poverty-Index-2023-Final-17th-July.pdf) |
| Ministry of Corporate Affairs CSR data, via Dataful.in (dataset 1612) | CSR spending, FY2014-15 to FY2023-24 | [dataful.in/datasets/1612](https://dataful.in/datasets/1612) · [csr.gov.in](https://www.csr.gov.in/) |
| Census of India 2011 | District populations for per-capita figures | [censusindia.gov.in](https://censusindia.gov.in/) |

## Instrument 01: People & Consent

People & Consent reads India's environmental clearance register on PARIVESH, the Ministry of Environment, Forest and Climate Change's portal. For each proposal it:

- places the proposal in the Census 2011 district and sub-district it was filed for, from the regulator's own application form;
- adds the Census record of who lives there;
- sets out the statutory consent obligations that attach, such as Fifth Schedule areas and the Gram Sabha's role under PESA.

The instrument scores and ranks nothing. Each proposal gets its own profile.

A scheduled job re-reads the register every night. It publishes only data that passes the published-data contract (`scripts/instruments/check_published.py`). Every page states how current its copy of the register is.

Its files and endpoints are documented at [/instruments/consent/data](https://whitespaceindia.pages.dev/instruments/consent/data).

| Source | Publisher |
|--------|-----------|
| PARIVESH environmental clearance register, Common Application Form and appraisal history | Ministry of Environment, Forest and Climate Change |
| Census 2011 Primary Census Abstract and Village Directory | Office of the Registrar General of India, via [SHRUG](https://doi.org/10.7910/DVN/DPESAK) |
| Socio Economic and Caste Census 2011, rural | Ministry of Rural Development, via SHRUG |
| Census 2011 district boundaries | [datameet](https://github.com/datameet/maps) |
| Presidential Orders scheduling Fifth Schedule areas | Gazette of India; Ministry of Panchayati Raj |

## Instrument 02: Meal Claims Check

Meal Claims Check reads the PM POSHAN (midday meal) daily reporting system at mdmhp.nic.in, kept by the National Informatics Centre, Himachal Pradesh, into which 17 States and Union Territories file a return for every school. It flags three things:

- a school-day on which the meals reported exceed the enrolment the school filed for the month;
- meals reported on a weekday the school's own record shows it does not normally serve, or on a State-listed holiday while the State was shut;
- a one-day count several times the school's usual one.

A flag is two filed figures that disagree. It is not a finding about a school, and the instrument gives no score and ranks no school. Each flag is printed with the figures behind it. When a later read no longer supports a flag, the flag is kept and marked as no longer standing.

A scheduled job reads the meal system once a day. It counts its requests against a budget it sets for itself and stops at the first refusal. For each flagged school it then asks UDISE+, the Ministry of Education's register of schools, for the school's report card, and keeps the classes taught, the kind of school and the free-textbook counts. The same job reads the Ministry's national monitoring system for the day's totals in all 36 States and Union Territories and their districts. That system answers only addresses in India, so the job reads it through Indian relays it verifies each night, with TLS checked on every request. Files are published only if they pass the contract in `scripts/meal_claims/check_published.py`. School tables are read as a sample that moves through the clusters, so every count is a count of what has been read so far. The method and its limits are at [/instruments/meal-claims/methodology](https://whitespaceindia.pages.dev/instruments/meal-claims/methodology). The files are documented at [/instruments/meal-claims/data](https://whitespaceindia.pages.dev/instruments/meal-claims/data).

| Source | Publisher |
|--------|-----------|
| PM POSHAN daily meal reporting system (mdmhp.nic.in): daily reports, monthly enrolment filings, State holiday lists | National Informatics Centre, Himachal Pradesh, for the Department of School Education & Literacy, Ministry of Education; filed by State education departments |
| PM POSHAN Automated Monitoring System (pmposhan-ams.education.gov.in): daily totals for all 36 States and Union Territories and their districts | Department of School Education & Literacy, Ministry of Education; sent daily by the States |
| UDISE+ school report card (kys.udiseplus.gov.in): classes taught, category, management, status and free-textbook counts, for flagged schools | Department of School Education & Literacy, Ministry of Education; filed yearly by schools |

## Tech stack

- **Framework:** Next.js 15 (App Router), TypeScript, Tailwind CSS
- **Charts and maps:** Recharts, react-simple-maps, D3
- **PDF briefs:** @react-pdf/renderer, with text from the Google Gemini API
- **Data pipelines:** Python 3.12
- **Hosting and scheduled jobs:** Cloudflare Pages (the site), Render (the routes rendered per request) and GitHub Actions, all on free plans. Every tool shares their limits: read [docs/shared-limits.md](docs/shared-limits.md) before adding one. The Watchdog workflow checks the live site and the budgets daily.

## Local development

```bash
npm install
echo "GEMINI_API_KEY_1=your_key_here" > .env.local   # only the CSR brief needs it; _2 to _10 are optional fallbacks
npm run dev
```

Checks that run in CI:

```bash
npx tsc --noEmit
npm test
npm run build
node scripts/cloudflare/assemble.mjs . dist   # fits one Cloudflare Pages deployment
pip install -r requirements.txt
python scripts/instruments/check_published.py
```

## Project structure

```
app/
  page.tsx                 landing page: one tile per arm
  csr/ about/ methodology/ reports/ simulator/
                           the CSR index and its pages
  csr-spending/            CSR spending by State, and the whitespace districts
  instruments/             the instruments shelf, Instrument 01 and Instrument 02
  health/ education/ energy/
                           indexes in preview
  api/                     brief PDFs, subscriptions, instrument search and exports
components/                shared index components; components/instruments/ for instruments
lib/                       scoring engines, vertical configs, instrument readers, lib/site.ts (the one origin)
public/data/               published data for each arm
scripts/
  csr/                     CSR data pipeline (rebuild_data.py)
  instruments/             Instrument 01 pipeline, nightly sync and test suites
  meal_claims/             Instrument 02 pipeline, nightly read and test suites
  make_og.py, make_icons.mjs
                           link-preview cards and site icons
  seo_check.mjs            what a search engine reads, checked in CI
.github/workflows/         CI, and the nightly instrument syncs
```

## Author

**Souhard Sharma**: [LinkedIn](https://www.linkedin.com/in/souhardsharma/)

## Licence

- **Code:** [GNU AGPL v3.0 or later](LICENSE). Run a modified version as a
  public service and you must offer its source to the people who use it.
- **Data and content:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
  open to any use, commercial included, with credit to Whitespace India. The
  exceptions are the two files of Census and SECC figures taken from SHRUG, which
  keep SHRUG's [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
- **Not licensed:** the Whitespace India name, logo and artwork.

The full terms, and the sources each file is built from, are in
[LICENSE-DATA.md](LICENSE-DATA.md).
