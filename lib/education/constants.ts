import type { WeightPreset } from "@/lib/verticals/types";

export const EDUCATION_WEIGHT_PRESETS: WeightPreset[] = [
  { name: "Balanced", weights: { school_access: 0.35, learning: 0.40, edu_infra: 0.25 } },
  { name: "Access First", weights: { school_access: 0.55, learning: 0.30, edu_infra: 0.15 } },
  { name: "Learning Focus", weights: { school_access: 0.20, learning: 0.60, edu_infra: 0.20 } },
  { name: "Infrastructure Gap", weights: { school_access: 0.20, learning: 0.25, edu_infra: 0.55 } },
];

export const EDUCATION_SECTORS = [
  "All Sectors",
  "Primary Education",
  "Secondary Education",
  "Higher Education",
  "Vocational Training",
  "Digital Literacy",
  "Special Education",
  "Teacher Development",
] as const;
