/**
 * Reader for the per-state project shards.
 *
 * Shards store rows as ARRAYS with the column names in a header, and intern
 * sector/status/authority to integer indexes. Repeating twenty-odd JSON keys
 * across 89,372 records costs several megabytes of pure key text and buys
 * nothing. This module is the only place that knows the packing, so the rest of
 * the app sees ordinary Project objects.
 *
 * Keep this in step with SHARD_FIELDS in scripts/instruments/build_data.py.
 */

import type { LinkedClearances, Project, ProjectSummary, ResolutionMethod } from "./types";

export interface RawShard {
  state: string;
  slug: string;
  fields: string[];
  certPrefix: string;
  authorities: string[];
  sectors: string[];
  statuses: string[];
  rows: unknown[][];
}

const RESOLUTION_BY_CODE: Record<string, ResolutionMethod> = {
  v: "village",
  s: "subdistrict",
  d: "lgd_district",
  n: "project_name",
  a: "adjudicated",
  c: "town_settled",
  x: "unresolved",
};

/**
 * Which array position each column sits at, computed once per shard.
 *
 * `fields.indexOf` is a linear scan over ~38 names; doing it inside the row
 * loop would repeat it for every one of 20,000 rows.
 */
function fieldIndex(shard: RawShard) {
  const ix = (name: string) => shard.fields.indexOf(name);
  return {
    id: ix("id"), rid: ix("rid"), no: ix("no"), name: ix("name"),
    agency: ix("agency"), sector: ix("sector"), cat: ix("cat"),
    status: ix("status"), date: ix("date"), auth: ix("auth"), cert: ix("cert"),
    dc: ix("dc"), dall: ix("dall"), sd: ix("sd"), nv: ix("nv"), dm: ix("dm"),
    af: ix("af"), df: ix("df"), rnr: ix("rnr"), lit: ix("lit"), vio: ix("vio"),
    land: ix("land"), forest: ix("forest"),
    // Published since Phase 1 and read by nothing until now: the appraisal
    // timing and the site geometry were in every shard while the reader
    // stopped at the original 23 columns.
    sk: ix("sk"), cf: ix("cf"), lat: ix("lat"), lon: ix("lon"), ext: ix("ext"),
    gk: ix("gk"), gd: ix("gd"), nblk: ix("nblk"), sq: ix("sq"),
    dtd: ix("dtd"), dpd: ix("dpd"), qr: ix("qr"), cst: ix("cst"),
    fon: ix("fon"), don: ix("don"), dsu: ix("dsu"),
    dd: ix("dd"), upd: ix("upd"), lk: ix("lk"),
  };
}

type FieldIndex = ReturnType<typeof fieldIndex>;

/** Everything a list or a search result needs, and nothing per-proposal. */
function buildSummary(
  r: unknown[],
  I: FieldIndex,
  shard: RawShard,
): ProjectSummary {
  const cert = (r[I.cert] as string) || "";
  return {
    id: String(r[I.id]),
    rid: r[I.rid] as number,
    no: (r[I.no] as string) || "",
    name: (r[I.name] as string) || "",
    agency: ((r[I.agency] as string) || "").trim(),
    sector: shard.sectors[r[I.sector] as number] ?? "",
    category: (r[I.cat] as string) ?? null,
    status: shard.statuses[r[I.status] as number] ?? "",
    // The canonical key beside the raw string. Filter and count through this.
    statusKey: (r[I.sk] as string) ?? null,
    formStatus: (r[I.cf] as string) ?? null,
    date: (r[I.date] as string) || "",
    authority:
      r[I.auth] === null || r[I.auth] === undefined
        ? null
        : shard.authorities[r[I.auth] as number] ?? null,
    certificateUrl: cert ? shard.certPrefix + cert : null,
    district: (r[I.dc] as number) ?? null,
    allDistricts: (r[I.dall] as number[]) ?? null,
    subdistricts: (r[I.sd] as number[]) ?? null,
    villageCount: (r[I.nv] as number) ?? null,
    multiDistrictCount: ((r[I.dall] as number[]) ?? []).length || undefined,
    resolution: RESOLUTION_BY_CODE[r[I.dm] as string] ?? "unresolved",
    declaredDistrict: I.dd >= 0 ? ((r[I.dd] as number) ?? null) : null,
    updatedOn: I.upd >= 0 ? ((r[I.upd] as string) ?? null) : null,
    decidedOn: (r[I.don] as string) ?? null,
    links: I.lk >= 0 ? ((r[I.lk] as LinkedClearances | 0 | null) ?? null) : null,
    declared: {
      affectedFamilies: (r[I.af] as number) ?? null,
      displacedFamilies: (r[I.df] as number) ?? null,
      rnrInvolved: (r[I.rnr] as string) ?? null,
      litigationPending: (r[I.lit] as string) ?? null,
      violationInvolved: (r[I.vio] as string) ?? null,
      totalLandHa: (r[I.land] as number) ?? null,
      forestLandHa: (r[I.forest] as number) ?? null,
    },
  };
}

/** The summary plus the two nested objects only a profile page reads. */
function buildDetail(r: unknown[], I: FieldIndex, shard: RawShard): Project {
  return {
    ...buildSummary(r, I, shard),
    appraisal: {
      filedOn: (r[I.fon] as string) ?? null,
      decidedOn: (r[I.don] as string) ?? null,
      daysToDecision: (r[I.dtd] as number) ?? null,
      daysPending: (r[I.dpd] as number) ?? null,
      daysSuspended: (r[I.dsu] as number) ?? null,
      queryRounds: (r[I.qr] as number) ?? null,
      currentStage: (r[I.cst] as string) ?? null,
      statusKey: (r[I.sk] as string) ?? null,
    },
    site: {
      lat: (r[I.lat] as number) ?? null,
      lon: (r[I.lon] as number) ?? null,
      extent: (r[I.ext] as number[]) ?? null,
      verdict: (r[I.gk] as string) ?? null,
      fallsIn: (r[I.gd] as number) ?? null,
      blocks: (r[I.nblk] as number) ?? null,
      quality: (r[I.sq] as string) ?? null,
    },
  };
}

/**
 * Every row, with the appraisal and site detail.
 *
 * PREFER `unpackSummaries` FOR LISTS AND `unpackOne` FOR A SINGLE PROPOSAL.
 * A shard is up to 20,202 rows, and this allocates two extra nested objects
 * per row - 40,404 objects that a search results list never reads. Measured on
 * /instruments/consent, that was 4.0 MB of resident heap, +83%, for fields the
 * page has no code path to display.
 */
export function unpackShard(shard: RawShard): Project[] {
  const I = fieldIndex(shard);
  return shard.rows.map((r) => buildDetail(r, I, shard));
}

/** Every row, without the two nested objects only a profile reads. */
export function unpackSummaries(shard: RawShard): ProjectSummary[] {
  const I = fieldIndex(shard);
  return shard.rows.map((r) => buildSummary(r, I, shard));
}

/**
 * One proposal, found before anything is built.
 *
 * The profile page needs exactly one row out of the shard it downloads. Going
 * through `unpackShard(...).find(...)` constructed a full Project for all
 * 20,202 rows - and the eight nested objects each - to keep one of them.
 */
export function unpackOne(shard: RawShard, id: string): Project | null {
  const I = fieldIndex(shard);
  const row = shard.rows.find((r) => String(r[I.id]) === id);
  return row ? buildDetail(row, I, shard) : null;
}

export interface ProjectFilters {
  text?: string;
  sector?: string;
  category?: string;
  status?: string;
  /** Only proposals whose location could be established. */
  resolvedOnly?: boolean;
  /** Only proposals the proponent declared as involving displacement. */
  displacementOnly?: boolean;
}

// Generic over the row type: filtering reads only summary fields, so it works
// on a lean list and on a fully detailed one, and returns whichever it was
// given rather than widening a detailed list into a summary one.
export function filterProjects<T extends ProjectSummary>(
  projects: T[],
  f: ProjectFilters
): T[] {
  const needle = (f.text || "").trim().toLowerCase();
  return projects.filter((p) => {
    if (f.sector && p.sector !== f.sector) return false;
    if (f.category && p.category !== f.category) return false;
    // On the CANONICAL key. Matching the raw string split one stage across
    // four options - "TOR GRANTED", "TOR GRanted", "TOR Granted", "ToR
    // Granted" - so choosing any one of them returned a fraction of the rows
    // at that stage while the count above the list confidently reported it.
    if (f.status && (p.statusKey ?? p.status) !== f.status) return false;
    if (f.resolvedOnly && p.district === null) return false;
    if (f.displacementOnly) {
      const d = p.declared;
      const any =
        (d.displacedFamilies ?? 0) > 0 ||
        (d.affectedFamilies ?? 0) > 0 ||
        d.rnrInvolved === "YES";
      if (!any) return false;
    }
    if (needle) {
      const hay = `${p.name} ${p.agency} ${p.no} ${p.id}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/** Status strings arrive in several casings for the same state of affairs. */
/**
 * The label for a proposal's position, from the canonical stage registry.
 *
 * NOT a substring match on the raw status text, which is what this was:
 *
 *     if (s.includes("withdraw")) return "Withdrawn";
 *
 * "Pending at MS for Proposal Withdraw Request" contains "withdraw", so 169
 * proposals whose withdrawal the authority had NOT yet acted on were badged
 * WITHDRAWN - the instrument telling a reader a live application was finished.
 * `includes("tor granted")` had the same shape in the other direction: Terms
 * of Reference are a step, not a decision, and 16,288 proposals still in
 * appraisal were badged as though something had concluded.
 *
 * The register writes 83 spellings of 73 stages and `stages.py` already maps
 * every one to a canonical key with a label attached. Reading that label is
 * the whole point of publishing `sk`; re-deriving one from the raw string is
 * how the UI and the data come to disagree. Measured before this change, the
 * badge differed from the canonical label on 88,568 of 89,817 rows.
 *
 * The raw text is the fallback, never a source of interpretation: an
 * unrecognised key means the registry has gained a stage this build does not
 * know, and showing the register's own words is the honest answer to that.
 */
export function stageLabel(
  statusKey: string | null | undefined,
  rawStatus: string,
  labels: Record<string, string>,
): string {
  const key = String(statusKey ?? "");
  return labels[key] ?? rawStatus.trim();
}
