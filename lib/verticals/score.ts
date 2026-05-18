import type { GenericDistrict, VerticalConfig } from "./types";

export function computeGenericScore(
  scores: Record<string, number>,
  weights: Record<string, number>,
  dimensions: VerticalConfig["dimensions"]
): number {
  let total = 0;
  for (const dim of dimensions) {
    total += (weights[dim.key] ?? dim.defaultWeight) * (scores[dim.key] ?? 0);
  }
  return total * 100;
}

export function rankGenericDistricts(
  districts: GenericDistrict[],
  weights: Record<string, number>,
  config: VerticalConfig,
  sectorScores: Record<string, Record<string, number>>,
  sectorFilter: string,
  whitespaceOnly: boolean = false
): Array<GenericDistrict & { computed_pos: number; rank: number }> {
  const filtered = whitespaceOnly
    ? districts.filter((d) => d.is_whitespace)
    : districts;

  const sectorDimKey = config.dimensions[1]?.key;

  const scored = filtered.map((d) => {
    const dimScores = { ...d.scores };

    if (
      sectorFilter !== "All Sectors" &&
      sectorDimKey &&
      sectorScores[d.district_lgd_code]?.[sectorFilter] != null
    ) {
      dimScores[sectorDimKey] = sectorScores[d.district_lgd_code][sectorFilter];
    }

    const pos = computeGenericScore(dimScores, weights, config.dimensions);
    return { ...d, computed_pos: Math.max(0, Math.min(100, pos)) };
  });

  scored.sort((a, b) => b.computed_pos - a.computed_pos);
  return scored.map((d, i) => ({ ...d, rank: i + 1 }));
}
