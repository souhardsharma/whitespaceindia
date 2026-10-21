/**
 * Types for Instrument 01 - People & Consent.
 *
 * These are NOT vertical types. There is no VerticalConfig here, no scoring
 * dimension, no weight preset and no ranked district, because an instrument has
 * none of those things. See the engineering reference, "Instruments are not verticals".
 *
 * The central idea is the split between a MEASURE and a VALUE. A measure is the
 * definition of a quantity - what it means, the expression that produces it,
 * which dataset it came from and the year that dataset describes. A value is one
 * number for one place. Measures live once, in measures.json; values live per
 * district, in districts.json. The interface joins them at render time to build
 * a Fact.
 *
 * That split is what makes a denominator mismatch structurally impossible. A
 * value and the benchmark it is compared against are the same measure id or the
 * comparison does not render, and `sameDefinition` records that check rather
 * than leaving it to a reviewer to notice.
 */

export type Unit = "percent" | "count" | "inr" | "ratio" | "hectare";
export type MeasureKind = "count" | "rate" | "ratio";
export type Confidence = "high" | "medium" | "low";

/** The definition of a quantity. One entry per measure, shared by every place. */
export interface Measure {
  label: string;
  unit: Unit;
  kind: MeasureKind;
  /** Precise definition, including the denominator for any rate. */
  definition: string;
  /** The expression actually evaluated by the pipeline. */
  formula: string;
  /** Dataset name and publisher. */
  source: string;
  /** Year or range the SOURCE data describes, not when it was fetched. */
  vintage: string;
  group: string;
  /** For rates: the measure id this divides by. */
  denominator_key?: string;
  /** Declared plausible range. The build fails if a value falls outside it. */
  range?: [number, number];
  caveats?: string[];
  /** Internal measures exist only as denominators and are never displayed. */
  internal?: boolean;
}

export interface MeasureRegistry {
  groups: Record<string, string>;
  measures: Record<string, Measure>;
  benchmarks: {
    india: Record<string, number | null>;
    byState: Record<string, Record<string, number | null>>;
    /** How many districts each benchmark was computed from. */
    districtsReporting?: {
      india: Record<string, number>;
      byState: Record<string, Record<string, number>>;
      districtsTotal: number;
    };
    /**
     * The formula each benchmark was computed with, keyed by measure id,
     * written by the pipeline at the moment it computes the benchmark.
     * `sameDefinition` is true only when this matches the value's own
     * formula exactly, so the flag records a comparison actually made.
     */
    definitions?: Record<string, string>;
  };
}

/** One place's computed values, keyed by measure id. */
export interface DistrictRecord {
  censuscode: number;
  district_name: string;
  state_name: string;
  values: Record<string, number | null>;
}

export interface SubdistrictRecord {
  code: number;
  district: number;
  /**
   * Every district this sub-district lies in, primary first.
   *
   * Almost always one. 31 tehsils straddle a district boundary and are
   * published by Census as "<name> part" on each side under a single code -
   * Barnagar Part is in Barpeta, Chirang and Baksa. Their published figures
   * cover the whole tehsil, so a reader in one of those districts is looking
   * at a unit that crosses their boundary, and the page says so.
   */
  districts?: number[];
  name: string | null;
  district_name: string | null;
  state_name: string | null;
  values: Record<string, number | null>;
}

/**
 * A value joined to its definition, ready to render.
 *
 * Never construct one by hand in a component. Use buildFact(), which is the
 * only place that decides whether a benchmark may be shown.
 */
export interface Fact {
  id: string;
  value: number | null;
  unit: Unit;
  kind: MeasureKind;
  label: string;
  definition: string;
  formula: string;
  source: string;
  vintage: string;
  benchmark?: {
    scope: "india" | "state";
    label: string;
    value: number;
    /**
     * True only when the benchmark was computed from the same measure id, and
     * therefore the same definition and denominator, as the value.
     * A comparison MUST NOT render when this is false.
     */
    sameDefinition: boolean;
    /**
     * How many districts the benchmark was actually computed from, and how
     * many exist. Present only when it is not all of them.
     *
     * "India 20.29%" for PHC doctor vacancy is summed over the 603 districts
     * that report the Village Directory columns, not over 640. The number is
     * right; calling it India without saying so is not.
     */
    coverage?: { districts: number; total: number };
  };
  caveats?: string[];
}

/** The shard's `lk`, as declared on the form. Only declared parts are present. */
export interface LinkedClearances {
  /** Forest clearance: [proposal no, status, ha applied, ha diverted, approved on]. */
  f?: [string | null, string | null, number | null, number | null, string | null];
  /** Wildlife board: [protected area, status, proposal no]. */
  w?: [string | null, string | null, string | null];
  /** Forest land additionally sought, as the form's land breakup records it. */
  a?: number;
  /** In an eco-sensitive zone. */
  e?: 1;
  /** In a national park, sanctuary or other protected area. */
  p?: 1;
  /** In a coastal regulation zone: [1, classification]. */
  c?: [1, string | null];
  /** Land: [type, owner, acquisition status] per parcel type declared. */
  t?: [string | null, string | null, string | null][];
  /**
   * The questions the form left BLANK, by letter: f forest clearance, w
   * wildlife board, e eco-sensitive zone, p protected area, c coastal zone.
   * Blank is not "no" - see compact_links() in build_data.py.
   */
  u?: string;
}

/** How a proposal's location was established. */
export type ResolutionMethod =
  | "village"
  | "subdistrict"
  | "lgd_district"
  | "project_name"
  /** The form's declared district and its site coordinates agreed against
   *  its place codes, and overruled them. */
  | "adjudicated"
  /** A town code spanning districts placed it; the coordinates or the
   *  declared district chose which. */
  | "town_settled"
  | "unresolved";

/** A proposal as shipped in a per-state shard, after unpacking. */
export interface Project {
  id: string;
  /** The record id, which is the key the PARIVESH CAF endpoint expects. */
  rid: number;
  no: string;
  name: string;
  agency: string;
  sector: string;
  category: string | null;
  status: string;
  date: string;
  authority: string | null;
  certificateUrl: string | null;
  /** Primary Census 2011 district code, or null when unresolved. */
  district: number | null;
  /** Every district touched. Populated only for multi-district projects. */
  allDistricts: number[] | null;
  /** Census 2011 sub-district codes named in the filing. */
  subdistricts: number[] | null;
  villageCount: number | null;
  /** How many districts the filing names, where more than one. */
  multiDistrictCount?: number;
  resolution: ResolutionMethod;
  /** The district the form itself declares (Census 2011 code), or null. One
   *  of the filing's three statements of place; see lib/instruments/location.ts. */
  declaredDistrict: number | null;
  /** The register's own last-modified date (IST), or null. */
  updatedOn: string | null;
  /**
   * The other clearances and the land, as the application form declares them.
   * null: the form has not been read by the reader that records these - an
   * unknown, never "none". 0: read, and it declares none. See `lk` in the
   * shard contract.
   */
  links: LinkedClearances | 0 | null;
  /**
   * Whether the regulator's application form was read, and what it said.
   *
   * "ok" the form was read and placed the proposal; "nogeo" it was read and
   * names no place; "none" the service ANSWERED and serves no form for this
   * proposal at all; "pend" it has not been read yet. Not-yet-read and
   * not-there are different silences, and copy that collapses them tells a
   * reader a named applicant filed without a location when often no form
   * exists to have filed.
   */
  formStatus: string | null;
  /** Proponent-declared figures from the Common Application Form. */
  declared: {
    affectedFamilies: number | null;
    displacedFamilies: number | null;
    rnrInvolved: string | null;
    litigationPending: string | null;
    violationInvolved: string | null;
    totalLandHa: number | null;
    forestLandHa: number | null;
  };
  /**
   * How the application has moved, from the dated appraisal history.
   *
   * `filedOn + daysToDecision + daysSuspended == decidedOn` holds exactly on
   * every decided proposal - the arithmetic is meant to be checked. The
   * register's own `date` is a DIFFERENT date: it moves forward on
   * re-submission and disagrees for a third of the register, which is why
   * durations are measured from `filedOn` and never from it.
   */
  appraisal: {
    /** First recorded step. Durations are measured from here. */
    filedOn: string | null;
    decidedOn: string | null;
    daysToDecision: number | null;
    daysPending: number | null;
    /** Days the portal had the proposal delisted, excluded from the above. */
    daysSuspended: number | null;
    queryRounds: number | null;
    /** Canonical key of the step it currently sits at. */
    currentStage: string | null;
    /** Canonical status key. Filter and count through this, never the raw text. */
    statusKey: string | null;
  };
  /**
   * Where the site is, from the filed KML corners. `lat`/`lon` are the mapped
   * block the verdict rests on, NOT the centre of the envelope: on a project
   * spread over several blocks that centre can fall where no part of the
   * project is.
   */
  site: {
    lat: number | null;
    lon: number | null;
    /** [south, west, north, east], null when the site is a single point. */
    extent: number[] | null;
    /** inside | boundary | elsewhere | offshore | unmapped | no_geometry,
     *  or null. */
    verdict: string | null;
    /** District the coordinates actually fall in. */
    fallsIn: number | null;
    /** Distinct mapped blocks the filing carries. */
    blocks: number | null;
    /** What qualifies this location; see `sq` in the shard contract. */
    quality: string | null;
  };
}

export interface StateSummary {
  slug: string;
  name: string;
  total: number;
  resolved: number;
}

export interface InstrumentIndex {
  states: Record<string, StateSummary>;
  sectors: string[];
  categories: string[];
  statuses: string[];
  resolutionCodes: Record<string, ResolutionMethod>;
}

export interface InstrumentMeta {
  instrument: string;
  generated_at: string;
  counts: {
    register_records_fetched: number;
    register_records_excluded: number;
    proposals_published: number;
    proposals_district_resolved: number;
    proposals_with_subdistrict: number;
    proposals_with_village: number;
    proposals_multi_district: number;
    caf_records_available: number;
    districts: number;
    subdistricts: number;
  };
  resolution_rate_pct: number;
  subdistrict_rate_pct: number;
  /**
   * Whose silence each unplaced proposal is.
   *
   * `ok` the regulator's form was read and placed it; `nogeo` it was read and
   * names no place; `none` the service ANSWERED and serves no form at all;
   * `pend` we have not read it yet. Copy that collapses these tells a reader a
   * named company filed without a location when often no form exists to have
   * filed, so any page reporting the unplaced count has to read this.
   */
  caf_coverage?: {
    ok: number;
    nogeo: number;
    none: number;
    pend: number;
  };
  resolution: {
    method: Partial<Record<ResolutionMethod, number>>;
    confidence: Record<string, number>;
    with_subdistrict: number;
    with_village: number;
    multi_district: number;
    /**
     * Whose silence each UNPLACED proposal is, keyed by `cf`.
     *
     * Distinct from `caf_coverage`, which is the same split over the whole
     * register. Any sentence about the proposals that could not be placed has
     * to use this one: register-wide there are 259 with no form served, but
     * only 189 of them are unplaced.
     */
    unresolved_by_form_status?: Record<string, number>;
    by_sector: Record<string, { total: number; resolved: number }>;
    by_category: Record<string, { total: number; resolved: number }>;
    /** Outcomes of reconciling the filing's three statements of place:
     *  kept | adjudicated | contested | town_by_coordinates |
     *  town_by_declaration | town_unsettled. */
    adjudication?: Record<string, number>;
  };
  /** The site-coordinate check over the register. */
  site_geometry?: {
    verdicts?: Record<string, number>;
    corroboration_pct?: number;
  };
  sources: {
    name: string;
    publisher: string;
    url: string;
    vintage: string;
    version?: string;
    coverage?: string;
    fetched?: string;
  }[];
  /**
   * The earliest and latest submission dates in this copy of the register,
   * measured from the published rows (and re-measured by check_published).
   * Null only when no row carries a date.
   */
  register_span?: { earliest: string; latest: string; dated: number } | null;
  vintage_warning: string;
  invariants: { violations: number; detail: string[]; resample_failures: number };
}

/**
 * A proposal without the appraisal history and site geometry.
 *
 * What a list, a search result or a district table renders. The two omitted
 * objects are read only by the per-proposal profile, and building them for
 * every row of a 20,000-row shard costs megabytes of heap for values nothing
 * on those pages can display.
 */
export type ProjectSummary = Omit<Project, "appraisal" | "site"> & {
  /**
   * Canonical stage key, carried on the summary because FILTERING needs it.
   *
   * The register writes one stage several ways - "ToR Granted", "TOR Granted",
   * "TOR GRANTED", "TOR GRanted" - and a control built on the raw string
   * offers each spelling as its own option, each matching only its own rows.
   * Everything that filters or counts by stage must go through this key.
   */
  statusKey: string | null;
  /** The decision date (`don`), for the watchlist's status endpoint, which
   *  otherwise had to read a whole shard per watched proposal. */
  decidedOn: string | null;
};
