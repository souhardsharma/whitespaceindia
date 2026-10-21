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
        "Schools for each child of school age. A higher score means fewer schools per child.",
      defaultWeight: 0.35,
      hintLow: "ADEQUATE",
      hintHigh: "SCARCE",
    },
    {
      key: "learning",
      label: "Learning Outcomes",
      shortLabel: "L",
      description:
        "A composite of National Achievement Survey scores and pass rates. A higher score means weaker learning.",
      defaultWeight: 0.40,
      hintLow: "STRONG",
      hintHigh: "WEAK",
    },
    {
      key: "edu_infra",
      label: "Infrastructure Gap",
      shortLabel: "I",
      description:
        "Shortfalls in school buildings and services, including classrooms, toilets, drinking water and electricity. A higher score means larger shortfalls.",
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
    headline: "The Education Index is in preview.",
    headlineItalic: "It runs on placeholder data.",
    body: "When it is complete, the index will rank districts by where investment in schooling is likely to do the most good. The figures on this page are placeholders that show how the tool will work.",
  },
  howItWorksSteps: [
    {
      number: "01",
      tag: "Input",
      title: "Focus area",
      text: "You can choose one of seven education domains, such as primary, secondary or vocational education, and the infrastructure measure then reflects the facilities available for that domain.",
    },
    {
      number: "02",
      tag: "Weighting",
      title: "Weights",
      text: "Three sliders set how much the score depends on access to schools, on learning outcomes and on gaps in school infrastructure. You can start from a preset or set the sliders yourself.",
    },
    {
      number: "03",
      tag: "Output",
      title: "Ranking",
      text: "Every scored district is ranked as you change the weights, with the largest opportunity for education work at the top. Clicking a state on the map limits the list to that state.",
    },
    {
      number: "04",
      tag: "Export",
      title: "District brief",
      text: "Clicking a district produces a research brief with its education figures, its school infrastructure and the gaps worth investigating, which you can save as a PDF.",
    },
  ],
  findingsCards: [
    {
      number: "01",
      value: "23:1",
      label: "Pupils per teacher",
      sub: "The national average at elementary level, from UDISE+ 2021-22. Some rural schools have more than 60 pupils for each teacher.",
    },
    {
      number: "02",
      value: "47%",
      label: "Grade 3 reading",
      sub: "The share of Grade 3 pupils unable to read a Grade 1 text, from the National Achievement Survey 2021. The share varies widely between states.",
    },
    {
      number: "03",
      value: "—",
      label: "Underserved districts",
      sub: "Districts where access to schools is lowest and learning weakest, and where school buildings and services fall furthest short.",
    },
  ],
};
