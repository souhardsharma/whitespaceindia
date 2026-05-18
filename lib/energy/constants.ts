import type { WeightPreset } from "@/lib/verticals/types";

export const ENERGY_WEIGHT_PRESETS: WeightPreset[] = [
  { name: "Balanced", weights: { supply: 0.35, access: 0.40, transition: 0.25 } },
  { name: "Supply Gap", weights: { supply: 0.55, access: 0.30, transition: 0.15 } },
  { name: "Access Equity", weights: { supply: 0.20, access: 0.60, transition: 0.20 } },
  { name: "Transition Ready", weights: { supply: 0.20, access: 0.25, transition: 0.55 } },
];

export const ENERGY_SECTORS = [
  "All Sectors",
  "Solar",
  "Wind",
  "Grid Infrastructure",
  "Rural Electrification",
  "Industrial Efficiency",
  "Clean Cooking",
  "EV Infrastructure",
] as const;
