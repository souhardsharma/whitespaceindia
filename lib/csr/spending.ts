/**
 * The CSR index's figures summed by State, for the static /csr-spending pages.
 * Imports the whole district file, so it is for server components only; a client
 * page that needs the State names takes them from ./states.
 */
import master from "@/public/data/csr/whitespace_master.json";
import meta from "@/public/data/csr/meta.json";
import { DEFAULT_WEIGHTS, rankDistricts, type District } from "./score";
import { CSR_STATES, stateSlug } from "./states";

const CRORE = 1e7;

export type RankedDistrict = District & { computed_pos: number; rank: number };

export interface StateSpending {
  name: string;
  slug: string;
  /** Ranked by score. `rank` is the district's place among all of India's. */
  districts: RankedDistrict[];
  whitespace: RankedDistrict[];
  csrCrore: number;
  csrPerPerson: number;
  /** Share of people in poverty, weighted by district population. 0-1. */
  poorShare: number;
  /** Districts with no spending named in the filings over the window. */
  noRecordedSpending: number;
  /** Districts absent from Census 2011, whose population is estimated from their parents. */
  estimatedPopulation: number;
}

export const NATIONAL_MEDIAN_CSR_PER_PERSON = meta.national_median_csr_per_person;
export const PAN_INDIA_SHARE = Math.round(meta.csr_totals.pan_india_pct);
export const CSR_WINDOW = `FY${meta.csr_window_fy[0]} to ${meta.csr_window_fy[meta.csr_window_fy.length - 1]}`;

export const RANKED_DISTRICTS: RankedDistrict[] = rankDistricts(master as District[], DEFAULT_WEIGHTS, "All Sectors", {});

export function summariseState(name: string, ranked: RankedDistrict[] = RANKED_DISTRICTS): StateSpending {
  const districts = ranked.filter((d) => d.state_name === name);
  const population = districts.reduce((sum, d) => sum + d.total_population, 0);
  const csrCrore = districts.reduce((sum, d) => sum + d.total_csr_recent, 0);
  const poorPeople = districts.reduce((sum, d) => sum + d.headcount_ratio_2021 * d.total_population, 0);
  return {
    name,
    slug: stateSlug(name),
    districts,
    whitespace: districts.filter((d) => d.is_whitespace),
    csrCrore,
    csrPerPerson: population > 0 ? (csrCrore * CRORE) / population : 0,
    poorShare: population > 0 ? poorPeople / population : 0,
    noRecordedSpending: districts.filter((d) => d.district_csr_per_person === 0).length,
    estimatedPopulation: districts.filter((d) => d.population_imputed).length,
  };
}

export const STATE_SPENDING: StateSpending[] = CSR_STATES.map((name) => summariseState(name));

const numberIN = new Intl.NumberFormat("en-IN");

export function formatCrore(crore: number): string {
  return `₹${numberIN.format(Math.round(crore * 10) / 10)} crore`;
}

export function formatRupees(rupees: number): string {
  return `₹${numberIN.format(Math.round(rupees))}`;
}

export function formatPoor(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}
