export interface ScoringDimension {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
  defaultWeight: number;
  hintLow?: string;
  hintHigh?: string;
}

export interface WeightPreset {
  name: string;
  weights: Record<string, number>;
}

export interface VerticalTheme {
  accent: string;
  accentDeep: string;
  accentSoft: string;
}

export interface VerticalConfig {
  id: string;
  name: string;
  fullName: string;
  slug: string;
  comingSoon: boolean;
  theme: VerticalTheme;
  dimensions: ScoringDimension[];
  sectors: string[];
  weightPresets: WeightPreset[];
  dataPath: string;
  heroStats: { label: string; value: string }[];
  heroContent: {
    headline: string;
    headlineItalic: string;
    body: string;
  };
  howItWorksSteps: {
    number: string;
    tag: string;
    title: string;
    text: string;
  }[];
  findingsCards: {
    number: string;
    value: string;
    label: string;
    sub: string;
  }[];
}

export interface GenericDistrict {
  state_name: string;
  district_name: string;
  district_lgd_code: string;
  total_population: number;
  pop_tier: string;
  is_whitespace: boolean;
  scores: Record<string, number>;
  raw: Record<string, number>;
  computed_score: number;
  [key: string]: unknown;
}
