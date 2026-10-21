import type { VerticalConfig } from "@/lib/verticals/types";
import { ENERGY_WEIGHT_PRESETS, ENERGY_SECTORS } from "./constants";

export const energyConfig: VerticalConfig = {
  id: "energy",
  name: "Energy",
  fullName: "Energy Access & Transition",
  slug: "energy",
  comingSoon: true,
  theme: {
    accent: "#2a6f3e",
    accentDeep: "#1d5a2e",
    accentSoft: "#b9d4c2",
  },
  dimensions: [
    {
      key: "supply",
      label: "Supply Gap",
      shortLabel: "S",
      description:
        "How far installed capacity in the district falls short of peak demand. A higher score means a larger shortfall.",
      defaultWeight: 0.35,
      hintLow: "SURPLUS",
      hintHigh: "DEFICIT",
    },
    {
      key: "access",
      label: "Access Equity",
      shortLabel: "A",
      description:
        "The share of households without a reliable electricity supply. A higher score means worse access.",
      defaultWeight: 0.40,
      hintLow: "CONNECTED",
      hintHigh: "DARK",
    },
    {
      key: "transition",
      label: "Transition Gap",
      shortLabel: "T",
      description:
        "How far renewable energy use falls short of national targets. A higher score means the district is further from them.",
      defaultWeight: 0.25,
      hintLow: "TRANSITIONING",
      hintHigh: "FOSSIL-LOCKED",
    },
  ],
  sectors: [...ENERGY_SECTORS],
  weightPresets: ENERGY_WEIGHT_PRESETS,
  dataPath: "/data/energy",
  heroStats: [
    { label: "Districts scored", value: "651" },
    { label: "Data window", value: "2020–23" },
  ],
  heroContent: {
    headline: "The Energy Index is in preview.",
    headlineItalic: "It runs on placeholder data.",
    body: "When it is complete, the index will rank districts by how badly they need investment in electricity supply and access. The figures on this page are placeholders that show how the tool will work.",
  },
  howItWorksSteps: [
    {
      number: "01",
      tag: "Input",
      title: "Focus area",
      text: "You can choose one of seven energy domains, such as solar, wind or grid infrastructure, and the supply gap measure then reflects the capacity in that domain.",
    },
    {
      number: "02",
      tag: "Weighting",
      title: "Weights",
      text: "Three sliders set how much the score depends on the supply gap, on household access and on the distance from renewable targets. You can start from a preset or set the sliders yourself.",
    },
    {
      number: "03",
      tag: "Output",
      title: "Ranking",
      text: "Every scored district is ranked as you change the weights, with the largest opportunity for energy investment at the top. Clicking a state on the map limits the list to that state.",
    },
    {
      number: "04",
      tag: "Export",
      title: "District brief",
      text: "Clicking a district produces a research brief with its electricity access figures, its infrastructure gaps and its progress towards renewables, which you can save as a PDF.",
    },
  ],
  findingsCards: [
    {
      number: "01",
      value: "31 GW",
      label: "Peak deficit",
      sub: "The combined gap between peak demand and supply in states short of power, most of it in eastern and northeastern India.",
    },
    {
      number: "02",
      value: "2.4 Cr",
      label: "Households without electricity",
      sub: "Households without a reliable electricity supply, according to Saubhagya scheme data, most of them in rural areas.",
    },
    {
      number: "03",
      value: "—",
      label: "Underserved districts",
      sub: "Districts with the widest gaps in electricity access and little renewable capacity, which makes them the first candidates for intervention.",
    },
  ],
};
