import type { WeightPreset } from "@/lib/verticals/types";

export const HEALTH_WEIGHT_PRESETS: WeightPreset[] = [
  { name: "Balanced", weights: { access: 0.35, outcomes: 0.40, infrastructure: 0.25 } },
  { name: "Access First", weights: { access: 0.55, outcomes: 0.30, infrastructure: 0.15 } },
  { name: "Outcomes Focus", weights: { access: 0.20, outcomes: 0.60, infrastructure: 0.20 } },
  { name: "Infrastructure Gap", weights: { access: 0.20, outcomes: 0.25, infrastructure: 0.55 } },
];

export const HEALTH_SECTORS = [
  "All Sectors",
  "Primary Care",
  "Maternal Health",
  "Child Health",
  "Communicable Disease",
  "Non-Communicable Disease",
  "Mental Health",
  "Nutrition",
] as const;
