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
      label: 'Poverty',
      shortLabel: 'N',
      description: 'The share of people who were multidimensionally poor in 2019-21, from NITI Aayog\'s MPI 2023. A higher share raises the score.',
      defaultWeight: 0.40,
      hintLow: 'LOW',
      hintHigh: 'HIGH',
    },
    {
      key: 'w_G',
      label: 'Funding gap',
      shortLabel: 'G',
      description: 'How far CSR spending per person falls below the median for districts of similar population. A larger gap raises the score.',
      defaultWeight: 0.40,
      hintLow: 'SMALL GAP',
      hintHigh: 'LARGE GAP',
    },
    {
      key: 'w_U',
      label: 'Persistence',
      shortLabel: 'U',
      description: 'The 2019-21 poverty headcount divided by the 2015-16 one. A value near or above 1.0 means poverty has not fallen.',
      defaultWeight: 0.20,
      hintLow: 'FELL',
      hintHigh: 'PERSISTED',
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
    { label: 'CSR window', value: 'FY21-24' },
  ],
  heroContent: {
    headline: 'Companies have spent over two lakh crore rupees on CSR since 2014.',
    headlineItalic: 'This index sets each district\'s share against its poverty.',
    body: "Larger Indian companies must spend part of their profits on corporate social responsibility (CSR) and report where the money went. The CSR Opportunity Index compares the spending reported for each district with the share of its people in poverty, and it calls a district a whitespace district when its spending per person is in the bottom quarter of all districts and its poverty is in the top quarter.",
  },
  howItWorksSteps: [
    {
      number: '01',
      tag: 'Input',
      title: 'Sector',
      text: 'The index can be scored on all CSR spending or on one of ten sectors, such as education, health care or sanitation. With a sector chosen, the funding gap is calculated from that sector\'s spending alone, so a district with no spending in it gets the largest possible gap, while poverty and persistence stay as they are.',
    },
    {
      number: '02',
      tag: 'Weighting',
      title: 'Weights',
      text: 'The score combines poverty, the funding gap and persistence, each with its own weight. You can move the sliders to weight them differently, or choose one of the presets.',
    },
    {
      number: '03',
      tag: 'Output',
      title: 'Ranking',
      text: 'Every scored district is listed by its score, highest first, and the order updates as the weights change. Clicking a state on the map lists only that state\'s districts.',
    },
    {
      number: '04',
      tag: 'Export',
      title: 'Research brief',
      text: 'Clicking a district opens a short research brief on it, which you can download as a PDF.',
    },
  ],
  findingsCards: [
    {
      number: '01',
      value: '₹1,29,660 Cr',
      label: 'CSR with no district',
      sub: 'Of all CSR spending filed between FY2014-15 and FY2023-24, 60.7% was recorded as "Pan India" or named no district, so every district total is a lower bound.',
    },
    {
      number: '02',
      value: '33.76%',
      label: 'Bihar\'s poverty headcount',
      sub: 'The share of Bihar\'s people in multidimensional poverty in 2019-21, from NITI Aayog\'s MPI 2023. Bihar receives ₹66 of CSR spending per person, against ₹1,436 in Maharashtra.',
    },
    {
      number: '03',
      value: '—',
      label: 'Whitespace districts',
      sub: 'Districts in the bottom 25% of all districts for CSR spending per person and the top 25% for the share of people in poverty.',
    },
  ],
};
