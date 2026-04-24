export interface District {
  state_name: string;
  district_name: string;
  district_lgd_code: string;
  headcount_ratio_2016: number | null;
  headcount_ratio_2021: number;
  mpi_2021: number;
  total_csr_recent: number;
  total_population: number;
  district_csr_per_person: number;
  pop_tier: string;
  tier_median_csr: number;
  N_raw: number;
  G_raw: number;
  U_raw: number;
  N_norm: number;
  G_norm: number;
  U_norm: number;
  POS: number;
  is_whitespace: boolean;
}

export interface Weights {
  w_N: number;
  w_G: number;
  w_U: number;
}

export const DEFAULT_WEIGHTS: Weights = { w_N: 0.40, w_G: 0.40, w_U: 0.20 };

export const SECTORS = [
  'All Sectors', 'Education', 'Health Care', 'Rural Development Projects',
  'Livelihood Enhancement Projects', 'Poverty, Eradicating Hunger, Malnutrition',
  'Safe Drinking Water', 'Sanitation', 'Vocational Skills',
  'Environmental Sustainability', 'Women Empowerment'
] as const;

export function computePOS(d: District, weights: Weights): number {
  return (weights.w_N * d.N_norm + weights.w_G * d.G_norm + weights.w_U * d.U_norm) * 100;
}

export function rankDistricts(
  districts: District[],
  weights: Weights,
  sector: string,
  sectorScores: Record<string, Record<string, number>>,
  whitespaceOnly: boolean = false
): Array<District & { computed_pos: number; rank: number }> {
  let filtered = whitespaceOnly ? districts.filter(d => d.is_whitespace) : districts;

  const scored = filtered.map(d => {
    let pos: number;
    if (sector === 'All Sectors' || sectorScores[d.district_lgd_code]?.[sector] == null) {
      pos = computePOS(d, weights);
    } else {
      const sectorGNorm = sectorScores[d.district_lgd_code][sector];
      pos = (weights.w_N * d.N_norm + weights.w_G * sectorGNorm + weights.w_U * d.U_norm) * 100;
    }
    return { ...d, computed_pos: Math.max(0, Math.min(100, pos)) };
  });

  scored.sort((a, b) => b.computed_pos - a.computed_pos);
  return scored.map((d, i) => ({ ...d, rank: i + 1 }));
}
