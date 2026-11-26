// Figures the CSR pages quote, read from the index's own meta.json so a
// rebuild of the data can never leave the prose behind. Typed by hand, they
// drifted: the card once said ₹1,436 for Maharashtra while the data said
// ₹1,446.93, and /reports said 44 whitespace districts while the data held 47.
import csrMeta from "@/public/data/csr/meta.json";

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const crore = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")} crore`;

/** Districts the index scores: every district in NITI Aayog's MPI 2023. */
export const TOTAL_DISTRICTS: number = csrMeta.total_districts;
export const WHITESPACE_COUNT: number = csrMeta.whitespace_count;

/** Districts where the filings place no CSR spending in the three-year window. */
export const NOT_RECORDED_COUNT: number = csrMeta.csr_not_recorded_count;

/** The whitespace cut-offs, exactly as the pipeline applies them (≤ and ≥). */
export const CSR_P25 = `₹${csrMeta.whitespace_thresholds.csr_p25.toFixed(2)}`;
export const HR_P75 = `${csrMeta.whitespace_thresholds.hr_p75_pct.toFixed(2)}%`;

/** CSR filed as "Pan India" or with no district, FY2014-15 to FY2023-24. */
export const PAN_INDIA_PCT = `${csrMeta.csr_totals.pan_india_pct.toFixed(1)}%`;
export const PAN_INDIA_CRORE = crore(csrMeta.csr_totals.pan_india_csr_all_years_crore);

// NITI Aayog's own State headcount ratios for 2019-21 (National MPI 2023,
// State tables). The index's State averages, over its districts and weighted
// by 2011 population, are in csrMeta.state_stats and differ slightly.
export const BIHAR_NITI_PCT = "33.76%";
export const MAHARASHTRA_NITI_PCT = "7.81%";

export const BIHAR_PER_PERSON = rupees(csrMeta.state_stats.bihar.csr_per_person_inr);
export const MAHARASHTRA_PER_PERSON = rupees(csrMeta.state_stats.maharashtra.csr_per_person_inr);

/** How many times Maharashtra's CSR per person is Bihar's, to the nearest whole. */
export const PER_PERSON_RATIO = Math.round(
  csrMeta.state_stats.maharashtra.csr_per_person_inr / csrMeta.state_stats.bihar.csr_per_person_inr,
);

export const BIHAR_VS_MAHARASHTRA =
  `Bihar receives ${BIHAR_PER_PERSON} of CSR spending per person, ` +
  `against ${MAHARASHTRA_PER_PERSON} in Maharashtra.`;
