import type { VerticalConfig } from '@/lib/verticals/types';
import { WEIGHT_PRESETS } from './constants';
import { SECTORS } from './score';

export const csrConfig: VerticalConfig = {
  id: 'csr',
  name: 'CSR',
  fullName: 'Corporate Social Responsibility',
  slug: 'csr',
  comingSoon: false,
  theme: {
    accent: '#BD402C',
    accentDeep: '#9b2817',
    accentSoft: '#e0bfb9',
  },
  dimensions: [
    {
      key: 'w_N',
      label: 'Poverty Severity',
      shortLabel: 'N',
      description: 'NITI Aayog MPI headcount ratio (2019-21). Higher = more people in multidimensional poverty.',
      defaultWeight: 0.40,
      hintLow: 'LOW',
      hintHigh: 'HIGH',
    },
    {
      key: 'w_G',
      label: 'Funding Gap',
      shortLabel: 'G',
      description: 'Gap between district CSR per person and its population-tier median. Higher = more underfunded.',
      defaultWeight: 0.40,
      hintLow: 'FUNDED',
      hintHigh: 'NEGLECTED',
    },
    {
      key: 'w_U',
      label: 'Persistent Poverty',
      shortLabel: 'U',
      description: 'Ratio of 2019-21 to 2015-16 headcount. Values near or above 1.0 = poverty not declining.',
      defaultWeight: 0.20,
      hintLow: 'IMPROVED',
      hintHigh: 'STUCK',
    },
  ],
  sectors: [...SECTORS],
  weightPresets: WEIGHT_PRESETS.map((p) => ({
    name: p.name,
    weights: { w_N: p.w_N, w_G: p.w_G, w_U: p.w_U },
  })),
  dataPath: '/data/csr',
  heroStats: [
    { label: 'Districts scored', value: '651' },
    { label: 'CSR window', value: 'FY 21–24' },
  ],
  heroContent: {
    headline: 'Over two lakh crore in CSR since 2014.',
    headlineItalic: 'The poorest districts got the least.',
    body: "An investigative mapping of India's Corporate Social Responsibility landscape reveals a staggering geographical divide. While capital centers flourish, the aspirational districts remain shadowed by industrial neglect.",
  },
  howItWorksSteps: [
    {
      number: '01',
      tag: 'Input',
      title: 'Choose Your Sector',
      text: 'Pick a development sector (education, health, sanitation, or any of ten focus areas). When a sector is selected, only CSR spending in that sector is used to compute the funding gap (G). Districts with no activity in the chosen sector will show a maximum gap. Need (N) and Persistence (U) remain unchanged.',
    },
    {
      number: '02',
      tag: 'Weighting',
      title: 'Set Your Priorities',
      text: 'Three weight sliders. Drag them to reflect what matters most to your foundation. Poverty severity, funding gap, persistence. Weight each to match your theory of change, or pick a preset.',
    },
    {
      number: '03',
      tag: 'Output',
      title: 'See Ranked Districts',
      text: 'A live-ranked ledger of every scored district, ordered by philanthropic opportunity. Click any state on the map to filter down to that geography.',
    },
    {
      number: '04',
      tag: 'Export',
      title: 'Download a Brief',
      text: 'Click any district to generate a research brief with key data, context, and gaps worth studying. Export as PDF.',
    },
  ],
  findingsCards: [
    {
      number: '01',
      value: '₹1,29,660 Cr',
      label: 'Unattributable CSR',
      sub: 'Classified as Pan-India (FY2014-15 through FY2023-24). 60.7% of gross CSR, unattributable to any specific district.',
    },
    {
      number: '02',
      value: '33.76%',
      label: 'Bihar Poverty Rate',
      sub: 'NITI Aayog MPI 2023 state-level headcount ratio (2019-21). Bihar receives ₹66 per person in CSR vs Maharashtra\'s ₹1,436.',
    },
    {
      number: '03',
      value: '—',
      label: 'Neglected Districts',
      sub: 'High poverty meets low funding: the neglected districts awaiting capital.',
    },
  ],
};
