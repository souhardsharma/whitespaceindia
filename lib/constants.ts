export const COLORS = {
  navy: '#0B1526',
  navyLight: '#1E293B',
  amber: '#F5A623',
  amberLight: '#FBBF24',
  white: '#FAFAFA',
  slate: '#94A3B8',
  slateDark: '#4A5568',
  red: '#EF4444',
  green: '#10B981',
} as const;

export const SCORE_TIERS = [
  { min: 75, color: '#EF4444', label: 'Critical Opportunity' },
  { min: 50, color: '#F59E0B', label: 'High Opportunity' },
  { min: 25, color: '#8B5CF6', label: 'Moderate Opportunity' },
  { min: 0, color: '#64748B', label: 'Lower Opportunity' },
] as const;

export const WEIGHT_PRESETS = [
  { name: 'Balanced', w_N: 0.40, w_G: 0.40, w_U: 0.20 },
  { name: 'Highest Need', w_N: 0.60, w_G: 0.25, w_U: 0.15 },
  { name: 'Most Underfunded', w_N: 0.20, w_G: 0.65, w_U: 0.15 },
  { name: 'Stuck Districts', w_N: 0.25, w_G: 0.30, w_U: 0.45 },
] as const;

export const DATA_SOURCES = {
  mpi: {
    label: 'NITI Aayog National Multidimensional Poverty Index 2023, based on NFHS-5 (2019-21)',
    url: 'https://www.niti.gov.in/sites/default/files/2023-08/India-National-Multidimentional-Poverty-Index-2023.pdf'
  },
  csr: {
    label: 'Ministry of Corporate Affairs, National CSR Portal, via Dataful.in (Dataset ID: 1612)',
    url: 'https://dataful.in/datasets/1612/'
  },
  census: {
    label: 'Census of India 2011, Office of the Registrar General',
    url: 'https://censusindia.gov.in'
  },
  methodology: {
    label: 'OECD Handbook on Constructing Composite Indicators (Nardo et al., 2008)',
    url: 'https://www.oecd.org/en/publications/handbook-on-constructing-composite-indicators-methodology-and-user-guide_9789264043466-en.html'
  },
  map: {
    label: 'Administrative boundary data curated from Survey of India and DataMeet',
    url: 'https://datameet.org'
  },
} as const;
