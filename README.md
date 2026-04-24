# Whitespace India CSR

**Interactive tool ranking Indian districts by philanthropic opportunity.**

Combines NITI Aayog MPI poverty data with MCA CSR spending data to surface where philanthropic capital is most absent relative to need. Produces a composite Philanthropic Opportunity Score (POS) for 651 Indian districts.

## Live Site

[whitespaceindia-csr.vercel.app](https://whitespaceindia-csr.vercel.app)

## Data Sources

| Source | Coverage | Link |
|--------|----------|------|
| NITI Aayog MPI 2023 | District-level headcount ratios (NFHS-5, 2019-21) | [PDF](https://niti.gov.in/sites/default/files/2023-07/National-Multidimentional-Poverty-Index-2023-Final-17th-July.pdf) |
| Ministry of Corporate Affairs CSR data, via Dataful.in (Dataset 1612) | CSR spending, 10 fiscal years (FY2014-15 to FY2023-24) | [dataful.in/datasets/1612](https://dataful.in/datasets/1612) · [csr.gov.in](https://www.csr.gov.in/) |
| Census of India 2011 | District populations for per-capita calculations | [censusindia.gov.in](https://censusindia.gov.in/) |

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Map**: react-simple-maps + D3
- **PDF**: @react-pdf/renderer
- **AI Briefs**: Google Gemini 2.5 Flash API
- **Hosting**: Vercel

## Local Development

```bash
# Install dependencies
npm install

# Create .env.local with your Gemini API key(s)
# GEMINI_API_KEY_1 is required; _2 through _10 are optional fallbacks
echo "GEMINI_API_KEY_1=your_key_here" > .env.local

# Run dev server
npm run dev
```

## Project Structure

```
app/
  page.tsx          # Homepage with simulator
  methodology/      # Full methodology writeup
  about/            # About the project
  reports/          # Reports & analysis (coming soon)
  api/
    brief/          # Gemini-generated district brief, returned as PDF
components/         # UI components (Hero, IndiaMap, BriefModal, etc.)
lib/
  score.ts          # POS scoring engine
public/
  data/             # Pre-computed JSON data files
scripts/
  rebuild_data.py   # Single-file reproducible data pipeline
```

## Methodology

The POS combines three dimensions:
- **N (Poverty Severity)** — MPI headcount ratio (default 40%)
- **G (Funding Gap)** — CSR shortfall vs population-tier median (default 40%)
- **U (Persistence)** — Fraction of 2015-16 poverty remaining in 2019-21 (default 20%)

Districts are grouped into three population tiers for like-for-like benchmarking. All weights are adjustable via the interactive simulator.

See [/methodology](https://whitespaceindia-csr.vercel.app/methodology) for the full writeup.

## Author

**Souhard Sharma** — [LinkedIn](https://www.linkedin.com/in/souhardsharma/)

## License

Data: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
