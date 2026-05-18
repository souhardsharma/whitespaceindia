import type { VerticalConfig } from "@/lib/verticals/types";
import { HEALTH_WEIGHT_PRESETS, HEALTH_SECTORS } from "./constants";

export const healthConfig: VerticalConfig = {
  id: "health",
  name: "Health",
  fullName: "Public Health Infrastructure",
  slug: "health",
  comingSoon: true,
  theme: {
    accent: "#2e54a5",
    accentDeep: "#1e3d7a",
    accentSoft: "#b9c5e0",
  },
  dimensions: [
    {
      key: "access",
      label: "Health Access",
      shortLabel: "A",
      description:
        "PHC/CHC density per lakh population. Higher = fewer facilities relative to population.",
      defaultWeight: 0.35,
      hintLow: "ADEQUATE",
      hintHigh: "SCARCE",
    },
    {
      key: "outcomes",
      label: "Health Outcomes",
      shortLabel: "O",
      description:
        "Composite of IMR, MMR, and stunting rates. Higher = worse health outcomes.",
      defaultWeight: 0.40,
      hintLow: "STRONG",
      hintHigh: "CRITICAL",
    },
    {
      key: "infrastructure",
      label: "Infrastructure Gap",
      shortLabel: "I",
      description:
        "Bed-to-population ratio gap vs national target. Higher = greater shortfall.",
      defaultWeight: 0.25,
      hintLow: "EQUIPPED",
      hintHigh: "DEFICIENT",
    },
  ],
  sectors: [...HEALTH_SECTORS],
  weightPresets: HEALTH_WEIGHT_PRESETS,
  dataPath: "/data/health",
  heroStats: [
    { label: "Districts scored", value: "651" },
    { label: "Data window", value: "2019–22" },
  ],
  heroContent: {
    headline: "From diagnosis",
    headlineItalic: "to action.",
    body: "Four steps to surface the districts with the most critical health infrastructure gaps. Evidence-first, ranked by need.",
  },
  howItWorksSteps: [
    {
      number: "01",
      tag: "Input",
      title: "Choose Your Focus",
      text: "Select a health domain — primary care, maternal health, child health, or any of seven focus areas. The infrastructure gap dimension adjusts to reflect sector-specific facility availability.",
    },
    {
      number: "02",
      tag: "Weighting",
      title: "Set Your Priorities",
      text: "Three weight sliders. Adjust to reflect your organisation’s priorities — health access, outcomes severity, or infrastructure gaps. Pick a preset or calibrate manually.",
    },
    {
      number: "03",
      tag: "Output",
      title: "See Ranked Districts",
      text: "A live-ranked ledger of every scored district, ordered by health intervention opportunity. Click any state on the map to filter to that geography.",
    },
    {
      number: "04",
      tag: "Export",
      title: "Download a Brief",
      text: "Click any district to generate a research brief with health indicators, infrastructure data, and gaps worth investigating. Export as PDF.",
    },
  ],
  findingsCards: [
    {
      number: "01",
      value: "1:1,800",
      label: "Doctor-Patient Ratio",
      sub: "National average doctor-to-population ratio, masking severe rural shortfalls where ratios exceed 1:10,000.",
    },
    {
      number: "02",
      value: "28 per 1,000",
      label: "Infant Mortality Rate",
      sub: "National IMR (SRS 2020). State-level variation ranges from 4 (Kerala) to 36 (Madhya Pradesh).",
    },
    {
      number: "03",
      value: "—",
      label: "Underserved Districts",
      sub: "Districts with critically low health access and poor outcomes — intervention priorities.",
    },
  ],
};
