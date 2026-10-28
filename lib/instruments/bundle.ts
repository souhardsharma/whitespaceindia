/**
 * One proposal page's data, assembled in the browser from static files.
 *
 * scripts/instruments/proposal_pages.mjs writes the files (public/view/consent)
 * at build time; this reads the few a proposal needs - the row file holding
 * it, its shard's vocabulary, the districts and sub-districts it names, the
 * quarter-degree cells around its site - and puts together exactly what the
 * page used to be handed by a server render. Nothing here touches `fs`, so it
 * runs in the browser and under `node --test` alike.
 */
import type { DistrictRecord, MeasureRegistry, Project, SubdistrictRecord } from "./types.ts";
import { unpackOne, type RawShard } from "./projects.ts";
import type { LegalReference } from "./obligations.ts";
import { fpNumbers, type ForestRegisterEntry } from "./links.ts";

// Must equal the constants of the same names in proposal_pages.mjs.
const ROW_BUCKETS = 4096;
const SUB_BUCKETS = 256;
const CELLS_PER_DEGREE = 4;

export const VIEW_DIR = "/view/consent";
export const DATA_URL = "/data/instruments/consent";

/** Reads one JSON file by URL path; null when it is not there (404). */
export type ReadJson = <T>(path: string) => Promise<T | null>;

export type ChangeKind = "filed" | "query" | "moved" | "decided" | "closed";
export type ProposalStep = [ChangeKind, string, string];

export interface NearbyProposal {
  id: string;
  slug: string;
  no: string;
  name: string;
  sector: string;
  statusKey: string | null;
  km: number;
}

interface Dist { n: number; p25: number; median: number; p75: number }
export interface AppraisalContext {
  days: number;
  sector: (Dist & { name: string }) | null;
  state: (Dist & { name: string }) | null;
  national: Dist | null;
  minGroup: number;
}

export type GeoFeature = { type: string; id: number; properties: Record<string, unknown>; geometry: unknown };

export interface ProposalBundle {
  project: Project;
  stateSlug: string;
  district: DistrictRecord | null;
  subdistricts: SubdistrictRecord[];
  registry: MeasureRegistry;
  /** The reference cut to the determinations this proposal's districts need. */
  legal: (LegalReference & { available: true }) | { available: false };
  districtNames: Record<string, string>;
  nearby: { items: NearbyProposal[]; total: number; radiusKm: number };
  /** The forest register's record of the forest proposal this form names. */
  forestRegister?: ForestRegisterEntry | null;
  /** How this proposal's decision time compares, for EC decisions only. */
  appraisalContext: AppraisalContext | null;
  /** Outlines of the districts the site locator draws, and only those. */
  geo: GeoFeature[];
}

export interface ProposalView {
  bundle: ProposalBundle;
  /** The proposal's own steps in the change log's window, newest first. */
  steps: ProposalStep[];
  changes: { window: { from: string; to: string; days: number }; basis: string } | null;
}

type RowEntry = { s: string; r: unknown[]; e: ProposalStep[] };
type DistrictFile = { record: DistrictRecord | null; geo: [number, GeoFeature] | null; det?: unknown };
/** [register order, id, slug, lat, lon, no, name, sector, statusKey] */
type NearPoint = [number, string, string, number, number, string, string, string, string | null];

export type ForestIndex = {
  fields: string[];
  rows: Record<string, unknown[]>;
  read_at?: string | null;
  state_read_at?: Record<string, string>;
};

export type AppraisalFile = {
  minGroup: number;
  national: { environmentalClearance?: Dist };
  environmentalClearance: { bySector: Record<string, Dist>; byState: Record<string, Dist> };
};

export type StagesFile = { statuses?: Record<string, { decision?: string | null }> };

/**
 * The forest register's own record of the forest-clearance proposal an EC form
 * names, keyed by proposal number. Null where the form names none or the
 * register holds no such number.
 */
export function forestEntry(p: Pick<Project, "links">, idx: ForestIndex | null): ForestRegisterEntry | null {
  const links = p.links;
  const nos = fpNumbers(links ? links.f?.[0] ?? null : null);
  if (!nos.length || !idx) return null;
  // The first number the form names that the register holds.
  const row = nos.map((n) => idx.rows?.[n]).find(Boolean);
  if (!row) return null;
  const F = (k: string) => idx.fields.indexOf(k);
  return {
    status: String(row[F("status")] ?? ""),
    area: (row[F("area")] as number | null) ?? null,
    form: (row[F("form")] as string | null) ?? null,
    date: (row[F("date")] as string | null) ?? null,
    // Dated by when THIS record's State was last read, not by the sweep.
    readAt: idx.state_read_at?.[String(row[F("state")] ?? "")] ?? idx.read_at ?? null,
  };
}

/** Whether a proposal's form names a forest proposal the register could hold. */
export function namesForestProposal(p: Pick<Project, "links">): boolean {
  return fpNumbers(p.links ? p.links.f?.[0] ?? null : null).length > 0;
}

/** Whether a proposal has an EC decision time to compare. */
function isEcDecision(p: Project, stages: StagesFile): boolean {
  const sk = p.appraisal?.statusKey;
  return p.appraisal?.daysToDecision != null && !!sk && stages.statuses?.[sk]?.decision === "ec";
}

/**
 * Where this proposal's time to an environmental clearance decision sits
 * among others'. Only for an EC decision: appraisal.json's groups are EC-only,
 * and comparing a ToR decision (median ~50 days) against EC medians (~135)
 * would be the mixed-denominator error the instrument exists to prevent.
 * Groups smaller than appraisal.json's own minimum are not compared against.
 * `stateName` is the register's state for the proposal (its filing state).
 */
export function appraisalFor(
  p: Project, stateName: string | null, stages: StagesFile, a: AppraisalFile | null,
): AppraisalContext | null {
  if (!isEcDecision(p, stages) || !a) return null;
  const pick = (d: Dist | undefined) =>
    d && d.n >= a.minGroup ? { n: d.n, p25: d.p25, median: d.median, p75: d.p75 } : null;
  const sec = pick(a.environmentalClearance.bySector[p.sector]);
  const stateKey = Object.keys(a.environmentalClearance.byState)
    .find((k) => k.toLowerCase() === (stateName ?? "").toLowerCase());
  const st = stateKey ? pick(a.environmentalClearance.byState[stateKey]) : null;
  return {
    days: p.appraisal!.daysToDecision as number,
    sector: sec ? { ...sec, name: p.sector } : null,
    state: st && stateKey ? { ...st, name: stateKey } : null,
    national: pick(a.national.environmentalClearance),
    minGroup: a.minGroup,
  };
}

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * A degree of latitude is ~111 km everywhere; a degree of longitude is 111 km
 * times the cosine of the latitude (about 91 km in Kashmir), so the box is
 * widened for the site's own latitude, with margin.
 */
function searchBox(lat: number, radiusKm: number): { dLat: number; dLon: number } {
  return {
    dLat: radiusKm / 110,
    dLon: radiusKm / (110 * Math.cos((Math.abs(lat) + 1) * Math.PI / 180)),
  };
}

/** The quarter-degree cells a box around (lat, lon) touches. */
export function nearCells(lat: number, lon: number, radiusKm = 10): string[] {
  const { dLat, dLon } = searchBox(lat, radiusKm);
  const out: string[] = [];
  for (let a = Math.floor((lat - dLat) * CELLS_PER_DEGREE); a <= Math.floor((lat + dLat) * CELLS_PER_DEGREE); a++) {
    for (let b = Math.floor((lon - dLon) * CELLS_PER_DEGREE); b <= Math.floor((lon + dLon) * CELLS_PER_DEGREE); b++) {
      out.push(`${a}_${b}`);
    }
  }
  return out;
}

/**
 * Other proposals whose mapped site lies within `radiusKm`, nearest first.
 * `total` counts them all; only the nearest `limit` are listed - each row is
 * a link, and a crawler follows every one.
 */
export function nearbyFrom(points: NearPoint[], p: Project, radiusKm = 10, limit = 20): ProposalBundle["nearby"] {
  const lat = p.site?.lat, lon = p.site?.lon;
  if (lat == null || lon == null) return { items: [], total: 0, radiusKm };
  const { dLat, dLon } = searchBox(lat, radiusKm);
  const hits: { point: NearPoint; km: number }[] = [];
  for (const point of points) {
    const [, id, , a, b] = point;
    if (Math.abs(a - lat) > dLat || Math.abs(b - lon) > dLon) continue;
    if (id === p.id) continue;
    const d = km(lat, lon, a, b);
    if (d > radiusKm) continue;
    hits.push({ point, km: Math.round(d * 10) / 10 });
  }
  // Equal distances keep register order.
  hits.sort((x, y) => x.km - y.km || x.point[0] - y.point[0]);
  const items = hits.slice(0, limit).map(({ point, km: dist }): NearbyProposal => {
    const [, id, slug, , , no, name, sector, statusKey] = point;
    return { id, slug, no, name, sector, statusKey, km: dist };
  });
  return { items, total: hits.length, radiusKm };
}

async function required<T>(read: ReadJson, path: string): Promise<T> {
  const data = await read<T>(path);
  if (data == null) throw new Error(`missing ${path}: rebuild with scripts/instruments/proposal_pages.mjs`);
  return data;
}

/** Everything one proposal page shows, or null for an id the register does not hold. */
export async function loadProposal(id: string, read: ReadJson, stages: StagesFile): Promise<ProposalView | null> {
  if (!/^[0-9]{1,12}$/.test(id)) return null;
  const entry = (await read<Record<string, RowEntry>>(`${VIEW_DIR}/rows/${Number(id) % ROW_BUCKETS}.json`))?.[id];
  if (!entry) return null;
  const header = await required<Omit<RawShard, "rows">>(read, `${VIEW_DIR}/shards/${entry.s}.json`);
  const project = unpackOne({ ...header, rows: [entry.r] }, id);
  if (!project) return null;

  const codes = [
    ...(project.allDistricts ?? []),
    project.district,
    project.declaredDistrict,
    project.site?.fallsIn,
  ].filter((c): c is number => c != null);
  const unique = [...new Set(codes)];
  const subCodes = project.subdistricts ?? [];
  const site = project.site?.lat != null && project.site?.lon != null ? project.site : null;

  const [registry, legalHeader, districtFiles, subBuckets, cells, forest, appraisal, changes] = await Promise.all([
    required<MeasureRegistry>(read, `${DATA_URL}/measures.json`),
    read<LegalReference>(`${VIEW_DIR}/legal.json`),
    Promise.all(unique.map((c) => read<DistrictFile>(`${VIEW_DIR}/districts/${c}.json`))),
    Promise.all([...new Set(subCodes.map((c) => Number(c) % SUB_BUCKETS))]
      .map((b) => required<Record<string, SubdistrictRecord>>(read, `${VIEW_DIR}/subdistricts/${b}.json`))),
    site
      ? Promise.all(nearCells(site.lat as number, site.lon as number).map((c) => read<NearPoint[]>(`${VIEW_DIR}/near/${c}.json`)))
      : Promise.resolve([]),
    namesForestProposal(project) ? read<ForestIndex>(`${DATA_URL}/register/forest.json`) : Promise.resolve(null),
    isEcDecision(project, stages) ? read<AppraisalFile>(`${DATA_URL}/appraisal.json`) : Promise.resolve(null),
    read<ProposalView["changes"]>(`${VIEW_DIR}/changes.json`),
  ]);

  const byCode = new Map(unique.map((c, i) => [c, districtFiles[i]]));
  const districtNames: Record<string, string> = {};
  for (const c of codes) {
    const rec = byCode.get(c)?.record;
    if (rec) districtNames[String(c)] = rec.district_name;
  }
  const subs: Record<string, SubdistrictRecord> = Object.assign({}, ...subBuckets);

  const legal: ProposalBundle["legal"] = legalHeader
    ? {
        ...legalHeader,
        determinations: Object.fromEntries(
          unique.filter((c) => byCode.get(c)?.det !== undefined).map((c) => [String(c), byCode.get(c)!.det]),
        ),
        available: true,
      } as ProposalBundle["legal"]
    : { available: false };

  const geo = site
    ? unique.map((c) => byCode.get(c)?.geo).filter((g): g is [number, GeoFeature] => g != null)
        .sort((a, b) => a[0] - b[0]).map(([, f]) => f)
    : [];

  return {
    bundle: {
      project,
      stateSlug: entry.s,
      district: project.district != null ? byCode.get(project.district)?.record ?? null : null,
      subdistricts: subCodes.map((c) => subs[String(c)]).filter(Boolean),
      registry,
      legal,
      districtNames,
      nearby: nearbyFrom(cells.flatMap((c) => c ?? []), project),
      geo,
      forestRegister: forestEntry(project, forest),
      appraisalContext: appraisalFor(project, header.state ?? null, stages, appraisal),
    },
    steps: entry.e,
    changes,
  };
}
