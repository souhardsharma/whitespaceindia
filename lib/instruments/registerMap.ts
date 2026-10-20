/**
 * The register, drawn as a map.
 *
 * The register page maps Census measures: who lives in each district. The
 * instrument's landing page maps the register itself: where clearance
 * proposals are being filed. That is the live half of the instrument, the
 * part that changes with every sync, and it is what a first-time reader most
 * needs to see: in which parts of the country the proposals are.
 *
 * The counts come from `register/districts.json`, the per-district index
 * `build_register_index.py` writes and `check_published.py` traces back to
 * the shard rows. The definitions below state the index's own counting rules,
 * so a count is described exactly as it was made.
 */
import type { DistrictRecord } from "./types";
import type { MeasureSpec } from "@/components/instruments/DistrictChoropleth";

/** One row of `register/districts.json`: the fields this map reads. */
export interface RegisterRow {
  code: number;
  district: string;
  state: string;
  n: number;
  nA: number;
  displaced: number;
}

/**
 * The register measures the map offers, in order.
 *
 * `n` counts a proposal in every district it names, because a project sited
 * across several districts affects each of them. `displaced` is attributed to
 * a project's primary district only, so one project's filing is not counted
 * once per district it names.
 */
export const REGISTER_MAP_MEASURES: Record<string, MeasureSpec> = {
  "register.proposals": {
    label: "Clearance proposals filed",
    unit: "count",
    definition:
      "Environmental clearance proposals in the register that name this district. A proposal naming several districts is counted in each.",
    group: "register",
  },
  "register.category_a": {
    label: "Category A proposals",
    unit: "count",
    definition:
      "Proposals in Category A, appraised by the Ministry of Environment, Forest and Climate Change rather than a state authority. Counted in each district a proposal names.",
    group: "register",
  },
  "register.displaced": {
    label: "Families declared displaced",
    unit: "count",
    definition:
      "Families the proponents declare their projects will displace, as filed in their own applications, attributed to each project's primary district only.",
    group: "register",
  },
};

export const REGISTER_MAP_OPTIONS = Object.keys(REGISTER_MAP_MEASURES);

/** Scheduled Area status by Census code, for the map's outline layer. */
export function scheduledByCode(legal: {
  determinations?: Record<string, { status?: string }>;
}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(legal.determinations ?? {}).map(([code, d]) => [
      code,
      String(d?.status ?? "unknown"),
    ]),
  );
}

/** Census codes that have a district page: those holding a proposal. */
export function districtsWithAPage(rows: RegisterRow[]): number[] {
  return rows.filter((r) => r.n > 0).map((r) => r.code);
}

/**
 * Register rows reshaped into what the map reads: one record per district,
 * keyed by Census code, with only the values the map can draw.
 */
export function registerMapDistricts(rows: RegisterRow[]): Record<string, DistrictRecord> {
  return Object.fromEntries(
    rows.map((r) => [
      String(r.code),
      {
        censuscode: r.code,
        district_name: r.district,
        state_name: r.state,
        values: {
          "register.proposals": r.n,
          "register.category_a": r.nA,
          "register.displaced": r.displaced,
        },
      } as DistrictRecord,
    ]),
  );
}
