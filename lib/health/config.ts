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
        "Primary and community health centres (PHCs and CHCs) per lakh people. A higher score means fewer facilities for the population.",
      defaultWeight: 0.35,
      hintLow: "ADEQUATE",
      hintHigh: "SCARCE",
    },
    {
      key: "outcomes",
      label: "Health Outcomes",
      shortLabel: "O",
      description:
        "A composite of infant mortality, maternal mortality and stunting. A higher score means worse health outcomes.",
      defaultWeight: 0.40,
      hintLow: "STRONG",
      hintHigh: "CRITICAL",
    },
    {
      key: "infrastructure",
      label: "Infrastructure Gap",
      shortLabel: "I",
      description:
        "How far the number of hospital beds per person falls short of the national target. A higher score means a larger shortfall.",
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
    headline: "The Health Index is in preview.",
    headlineItalic: "It runs on placeholder data.",
    body: "When it is complete, the index will rank districts by the gaps in their health facilities and health outcomes. The figures on this page are placeholders that show how the tool will work.",
  },
  howItWorksSteps: [
    {
      number: "01",
      tag: "Input",
      title: "Focus area",
      text: "You can choose one of seven health domains, such as primary care, maternal health or child health, and the infrastructure gap measure then reflects the facilities available for that domain.",
    },
    {
      number: "02",
      tag: "Weighting",
      title: "Weights",
      text: "Three sliders set how much the score depends on access to care, on the severity of health outcomes and on the infrastructure gap. You can start from a preset or set the sliders yourself.",
    },
    {
      number: "03",
      tag: "Output",
      title: "Ranking",
      text: "Every scored district is ranked as you change the weights, with the largest opportunity for health work at the top. Clicking a state on the map limits the list to that state.",
    },
    {
      number: "04",
      tag: "Export",
      title: "District brief",
      text: "Clicking a district produces a research brief with its health indicators, its infrastructure figures and the gaps worth investigating, which you can save as a PDF.",
    },
  ],
  findingsCards: [
    {
      number: "01",
      value: "1:1,800",
      label: "Doctors to population",
      sub: "The national average ratio of doctors to people. It hides severe rural shortfalls, where the ratio is worse than 1:10,000.",
    },
    {
      number: "02",
      value: "28 per 1,000",
      label: "Infant mortality rate",
      sub: "The national rate, from the Sample Registration System for 2020. Across states it ranges from 4 (Kerala) to 36 (Madhya Pradesh).",
    },
    {
      number: "03",
      value: "—",
      label: "Underserved districts",
      sub: "Districts where access to care is lowest and health outcomes are poorest, which makes them the first candidates for intervention.",
    },
  ],
};
