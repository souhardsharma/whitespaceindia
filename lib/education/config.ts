import type { VerticalConfig } from "@/lib/verticals/types";
import { EDUCATION_WEIGHT_PRESETS, EDUCATION_SECTORS } from "./constants";

export const educationConfig: VerticalConfig = {
  id: "education",
  name: "Education",
  fullName: "Education Infrastructure",
  slug: "education",
  comingSoon: true,
  theme: {
    accent: "#b48a52",
    accentDeep: "#8a6a2a",
    accentSoft: "#ddd0b9",
  },
  dimensions: [
    {
      key: "school_access",
      label: "School Access",
      shortLabel: "S",
      description:
        "Ratio of schools to school-age population. Higher = fewer schools per child.",
      defaultWeight: 0.35,
      hintLow: "ADEQUATE",
      hintHigh: "SCARCE",
    },
    {
      key: "learning",
      label: "Learning Outcomes",
      shortLabel: "L",
      description:
        "Composite of NAS scores and pass rates. Higher = worse learning outcomes.",
      defaultWeight: 0.40,
      hintLow: "STRONG",
      hintHigh: "WEAK",
    },
    {
      key: "edu_infra",
      label: "Infrastructure",
      shortLabel: "I",
      description:
        "Gap in school infrastructure — classrooms, toilets, drinking water, electricity. Higher = greater deficiency.",
      defaultWeight: 0.25,
      hintLow: "EQUIPPED",
      hintHigh: "DEFICIENT",
    },
  ],
  sectors: [...EDUCATION_SECTORS],
  weightPresets: EDUCATION_WEIGHT_PRESETS,
  dataPath: "/data/education",
  heroStats: [
    { label: "Districts scored", value: "651" },
    { label: "Data window", value: "2019–22" },
  ],
  heroContent: {
    headline: "From access",
    headlineItalic: "to outcomes.",
    body: "Four steps to surface the districts where education investment would create the greatest impact. Evidence-ranked, publicly sourced.",
  },
  howItWorksSteps: [
    {
      number: "01",
      tag: "Input",
      title: "Choose Your Focus",
      text: "Select an education domain — primary, secondary, vocational, or any of seven focus areas. The infrastructure dimension adjusts to reflect sector-specific facility availability.",
    },
    {
      number: "02",
      tag: "Weighting",
      title: "Set Your Priorities",
      text: "Three weight sliders. Adjust to reflect your organisation's priorities — school access, learning outcomes, or infrastructure gaps. Pick a preset or calibrate manually.",
    },
    {
      number: "03",
      tag: "Output",
      title: "See Ranked Districts",
      text: "A live-ranked ledger of every scored district, ordered by education intervention opportunity. Click any state on the map to filter to that geography.",
    },
    {
      number: "04",
      tag: "Export",
      title: "Download a Brief",
      text: "Click any district to generate a research brief with education metrics, infrastructure data, and gaps worth investigating. Export as PDF.",
    },
  ],
  findingsCards: [
    {
      number: "01",
      value: "23:1",
      label: "Pupil-Teacher Ratio",
      sub: "National average PTR (elementary level, UDISE+ 2021-22), masking rural extremes exceeding 60:1.",
    },
    {
      number: "02",
      value: "47%",
      label: "Grade 3 Reading",
      sub: "Proportion of Grade 3 students who cannot read a Grade 1-level text (NAS 2021). Wide interstate variation.",
    },
    {
      number: "03",
      value: "—",
      label: "Underserved Districts",
      sub: "Districts with critically low school access, poor learning outcomes, and infrastructure gaps.",
    },
  ],
};
