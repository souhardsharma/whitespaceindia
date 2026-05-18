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
        "Deficit between installed capacity and peak demand in the district. Higher = greater shortfall.",
      defaultWeight: 0.35,
      hintLow: "SURPLUS",
      hintHigh: "DEFICIT",
    },
    {
      key: "access",
      label: "Access Equity",
      shortLabel: "A",
      description:
        "Proportion of households without reliable electricity access. Higher = worse access.",
      defaultWeight: 0.40,
      hintLow: "CONNECTED",
      hintHigh: "DARK",
    },
    {
      key: "transition",
      label: "Transition Readiness",
      shortLabel: "T",
      description:
        "Gap in renewable energy adoption vs national targets. Higher = further from transition goals.",
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
    headline: "From darkness",
    headlineItalic: "to light.",
    body: "Four steps to surface the districts most in need of energy infrastructure investment. Transparent scoring, ranked by opportunity.",
  },
  howItWorksSteps: [
    {
      number: "01",
      tag: "Input",
      title: "Choose Your Focus",
      text: "Select an energy domain — solar, wind, grid infrastructure, or any of seven focus areas. The supply gap dimension adjusts to reflect sector-specific capacity.",
    },
    {
      number: "02",
      tag: "Weighting",
      title: "Set Your Priorities",
      text: "Three weight sliders. Adjust to reflect your organisation's priorities — supply gaps, access equity, or transition readiness. Pick a preset or calibrate manually.",
    },
    {
      number: "03",
      tag: "Output",
      title: "See Ranked Districts",
      text: "A live-ranked ledger of every scored district, ordered by energy investment opportunity. Click any state on the map to filter to that geography.",
    },
    {
      number: "04",
      tag: "Export",
      title: "Download a Brief",
      text: "Click any district to generate a research brief with energy access data, infrastructure gaps, and transition metrics. Export as PDF.",
    },
  ],
  findingsCards: [
    {
      number: "01",
      value: "31 GW",
      label: "Peak Deficit",
      sub: "Aggregate peak supply-demand gap across energy-deficit states, concentrated in eastern and northeastern India.",
    },
    {
      number: "02",
      value: "2.4 Cr",
      label: "Unelectrified Households",
      sub: "Households without reliable electricity access per Saubhagya scheme data, disproportionately in rural areas.",
    },
    {
      number: "03",
      value: "—",
      label: "Underserved Districts",
      sub: "Districts with critical energy access gaps and minimal renewable capacity — intervention priorities.",
    },
  ],
};
