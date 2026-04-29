export const WEIGHT_PRESETS = [
  { name: 'Balanced', w_N: 0.40, w_G: 0.40, w_U: 0.20 },
  { name: 'Highest Need', w_N: 0.60, w_G: 0.25, w_U: 0.15 },
  { name: 'Most Underfunded', w_N: 0.20, w_G: 0.65, w_U: 0.15 },
  { name: 'Stuck Districts', w_N: 0.25, w_G: 0.30, w_U: 0.45 },
] as const;
