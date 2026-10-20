/**
 * Server-side reads of the published instrument data.
 *
 * SERVER ONLY. It reads files from public/data with `fs`, so it must never be
 * imported into a "use client" module - Next would try to bundle `fs` for the
 * browser and fail the build, which is the guard.
 *
 * WHY THE SERVER ASSEMBLES A PROPOSAL
 * -----------------------------------
 * A proposal page used to be rendered in the browser: the HTML said "Loading
 * the profile…" and the browser then fetched the whole state shard (10.5 MB for
 * Rajasthan), the whole district file and the whole sub-district file (5.4 MB)
 * to show one proposal - 9.6 to 18 MB of JSON parsed on a phone, and nothing at
 * all for a crawler or a reader without JavaScript. The server now reads those
 * files once per process, picks out the one proposal and the handful of places
 * and determinations it touches, and hands the page a bundle of a few tens of
 * kilobytes. The page is rendered on the server and cached.
 *
 * Every file is read through `json()`, which caches by path for the life of
 * the process. The data only changes when a deploy replaces it, and a deploy
 * starts new processes, so the cache can never serve a previous build's data.
 */

import fs from "fs";
import path from "path";
import type {
  DistrictRecord,
  InstrumentMeta,
  MeasureRegistry,
  Project,
  SubdistrictRecord,
} from "./types";
import { unpackOne, unpackSummaries, type RawShard } from "./projects";
import type { LegalReference } from "./obligations";
import { fpNumbers } from "./links";

export const DATA_DIR = path.join(process.cwd(), "public", "data", "instruments", "consent");

const cache = new Map<string, unknown>();

export function json<T>(rel: string): T {
  const hit = cache.get(rel);
  if (hit !== undefined) return hit as T;
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, rel), "utf-8")) as T;
  cache.set(rel, data);
  return data;
}

// Files that were asked for and are not there. Remembered like the files
// that are: before a build wrote register/forest.json, every proposal render
// went to the disk for it and threw.
const missing = new Set<string>();

export function jsonOrNull<T>(rel: string): T | null {
  if (missing.has(rel)) return null;
  try {
    return json<T>(rel);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") missing.add(rel);
    return null;
  }
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Raw shards are the largest thing here - 35 of them are ~117 MB of heap -
// so they are NOT kept like the other files. A few recently used shards stay
// (proposal pages cluster by State); everything that sweeps all of them
// (the national index, the nearby-points table, the sitemaps) reads each
// once and keeps only what it derives.
const SHARD_CACHE_MAX = 4;
const shardCache = new Map<string, RawShard>();

/** Read a shard without keeping it. */
export function shardOnce(slug: string): RawShard | null {
  if (!SLUG_RE.test(slug)) return null;
  const hit = shardCache.get(slug);
  if (hit) return hit;
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "projects", `${slug}.json`), "utf-8")) as RawShard;
  } catch {
    return null;
  }
}

/** A shard, kept in a small most-recently-used cache. */
export function shard(slug: string): RawShard | null {
  if (!SLUG_RE.test(slug)) return null;
  const hit = shardCache.get(slug);
  if (hit) {
    shardCache.delete(slug);
    shardCache.set(slug, hit);
    return hit;
  }
  const sh = shardOnce(slug);
  if (!sh) return null;
  shardCache.set(slug, sh);
  while (shardCache.size > SHARD_CACHE_MAX) {
    shardCache.delete(shardCache.keys().next().value as string);
  }
  return sh;
}

export function stateSlugs(): string[] {
  return fs
    .readdirSync(path.join(DATA_DIR, "projects"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export const lookup = () => json<Record<string, string>>("lookup.json");
export const districts = () => json<Record<string, DistrictRecord>>("districts.json");
export const measures = () => json<MeasureRegistry>("measures.json");
export const meta = () => json<InstrumentMeta>("meta.json");
export const legal = () => jsonOrNull<LegalReference>("legal_reference.json");

function subdistrictMap(): Record<string, SubdistrictRecord> {
  const raw = json<Record<string, SubdistrictRecord> | { subdistricts: Record<string, SubdistrictRecord> }>(
    "subdistricts.json",
  );
  return "subdistricts" in raw && typeof raw.subdistricts === "object"
    ? (raw.subdistricts as Record<string, SubdistrictRecord>)
    : (raw as Record<string, SubdistrictRecord>);
}

/** One proposal, with the state it was filed in, or null. */
export function findProposal(id: string): { project: Project; slug: string } | null {
  if (!/^[0-9]{1,12}$/.test(id)) return null;
  const slug = lookup()[id];
  if (!slug) return null;
  const sh = shard(slug);
  if (!sh) return null;
  const project = unpackOne(sh, id);
  return project ? { project, slug } : null;
}

export interface NearbyProposal {
  id: string;
  slug: string;
  no: string;
  name: string;
  sector: string;
  statusKey: string | null;
  km: number;
}

/**
 * Every proposal in the register with coordinates, as flat arrays, built once
 * per process. Used to find what else is proposed near a site - the
 * cumulative picture no single filing gives.
 */
let POINTS: {
  id: string[]; slug: string[]; lat: Float64Array; lon: Float64Array;
  no: string[]; name: string[]; sector: string[]; sk: (string | null)[];
} | null = null;

function points() {
  if (POINTS) return POINTS;
  const id: string[] = [], slug: string[] = [], lat: number[] = [], lon: number[] = [];
  const no: string[] = [], name: string[] = [], sector: string[] = [], sk: (string | null)[] = [];
  for (const s of stateSlugs()) {
    const sh = shardOnce(s);
    if (!sh) continue;
    const I = (k: string) => sh.fields.indexOf(k);
    const iLat = I("lat"), iLon = I("lon"), iId = I("id"), iNo = I("no"),
      iName = I("name"), iSec = I("sector"), iSk = I("sk");
    for (const r of sh.rows) {
      const a = r[iLat] as number | null, b = r[iLon] as number | null;
      if (a == null || b == null) continue;
      id.push(String(r[iId])); slug.push(s); lat.push(a); lon.push(b);
      no.push(String(r[iNo] ?? "")); name.push(String(r[iName] ?? ""));
      sector.push(sh.sectors[r[iSec] as number] ?? ""); sk.push((r[iSk] as string) ?? null);
    }
  }
  POINTS = { id, slug, lat: Float64Array.from(lat), lon: Float64Array.from(lon), no, name, sector, sk };
  return POINTS;
}

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Other proposals whose mapped site lies within `radiusKm`, nearest first. */
export function nearby(p: Project, radiusKm = 10, limit = 50): {
  items: NearbyProposal[]; total: number; radiusKm: number;
} {
  const lat = p.site?.lat, lon = p.site?.lon;
  if (lat == null || lon == null) return { items: [], total: 0, radiusKm };
  const P = points();
  // A cheap box first: a degree of latitude is ~111 km everywhere; a degree
  // of longitude is 111 km times the cosine of the latitude (about 91 km in
  // Kashmir), so the box is widened for the site's own latitude, with margin.
  const dLat = radiusKm / 110;
  const dLon = radiusKm / (110 * Math.cos((Math.abs(lat) + 1) * Math.PI / 180));
  const hits: NearbyProposal[] = [];
  for (let i = 0; i < P.id.length; i++) {
    if (Math.abs(P.lat[i] - lat) > dLat || Math.abs(P.lon[i] - lon) > dLon) continue;
    if (P.id[i] === p.id) continue;
    const d = km(lat, lon, P.lat[i], P.lon[i]);
    if (d > radiusKm) continue;
    hits.push({ id: P.id[i], slug: P.slug[i], no: P.no[i], name: P.name[i],
                sector: P.sector[i], statusKey: P.sk[i], km: Math.round(d * 10) / 10 });
  }
  hits.sort((a, b) => a.km - b.km);
  return { items: hits.slice(0, limit), total: hits.length, radiusKm };
}

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
  forestRegister?: import("@/components/instruments/LinkedClearances").ForestRegisterEntry | null;
  /** How this proposal's decision time compares, for EC decisions only. */
  appraisalContext: AppraisalContext | null;
  /** Outlines of the districts the site locator draws, and only those. */
  geo: { type: string; id: number; properties: Record<string, unknown>; geometry: unknown }[];
}

type GeoFile = { features: { id?: number | string; properties?: Record<string, unknown>; type: string; geometry: unknown }[] };

/** The Census 2011 outlines of these districts, from the published boundary file. */
export function geoFeatures(codes: number[]): ProposalBundle["geo"] {
  const key = "__geo__";
  let g = cache.get(key) as GeoFile | undefined;
  if (!g) {
    g = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), "public", "geo", "districts-2011.geojson"), "utf-8")) as GeoFile;
    cache.set(key, g);
  }
  const want = new Set(codes);
  return g.features
    .filter((f) => want.has(Number(f.id)))
    .map((f) => ({ type: f.type, id: Number(f.id), properties: f.properties ?? {}, geometry: f.geometry }));
}

/** Everything one proposal page needs, and nothing else. */
export function proposalBundle(id: string): ProposalBundle | null {
  const found = findProposal(id);
  if (!found) return null;
  const { project, slug } = found;
  const all = districts();
  const district = project.district != null ? all[String(project.district)] ?? null : null;

  const districtNames: Record<string, string> = {};
  const codes = [
    ...(project.allDistricts ?? []),
    project.district,
    project.declaredDistrict,
    project.site?.fallsIn,
  ].filter((c): c is number => c != null);
  for (const c of codes) {
    const rec = all[String(c)];
    if (rec) districtNames[String(c)] = rec.district_name;
  }

  let subdistricts: SubdistrictRecord[] = [];
  if (project.subdistricts?.length) {
    const sd = subdistrictMap();
    subdistricts = project.subdistricts.map((c) => sd[String(c)]).filter(Boolean);
  }

  const ref = legal();
  let legalCut: ProposalBundle["legal"] = { available: false };
  if (ref) {
    const need = new Set(codes.map(String));
    const dets = (ref as unknown as { determinations?: Record<string, unknown> }).determinations ?? {};
    legalCut = {
      ...ref,
      determinations: Object.fromEntries(
        Object.entries(dets).filter(([k]) => need.has(k)),
      ),
      available: true,
    } as ProposalBundle["legal"];
  }

  return {
    project,
    stateSlug: slug,
    district,
    subdistricts,
    registry: measures(),
    legal: legalCut,
    districtNames,
    nearby: nearby(project),
    geo: project.site?.lat != null ? geoFeatures(codes) : [],
    forestRegister: forestRecord(project),
    appraisalContext: appraisalContext(project),
  };
}

/** Summaries of every proposal in one state, for the search endpoint. */
export function stateSummaries(slug: string) {
  const sh = shard(slug);
  return sh ? unpackSummaries(sh) : [];
}

/**
 * The same, WITHOUT keeping the raw shard. The national index needs every
 * state's summaries once; caching all 35 raw shards beside them held ~130 MB
 * of heap per server instance for data already copied into the summaries.
 */
function stateSummariesOnce(slug: string) {
  const sh = shardOnce(slug);
  return sh ? unpackSummaries(sh) : [];
}

/** A proposal's summary with where it was filed and the district it is placed in. */
export type IndexedProposal = import("./types").ProjectSummary & {
  stateSlug: string;
  districtName: string | null;
};

let ALL_SUMMARIES: { list: IndexedProposal[]; byId: Map<string, IndexedProposal> } | null = null;

/** Every published proposal, newest submission first, built once per process. */
export function allSummaries(): { list: IndexedProposal[]; byId: Map<string, IndexedProposal> } {
  if (ALL_SUMMARIES) return ALL_SUMMARIES;
  const names = districts();
  const list: IndexedProposal[] = [];
  for (const slug of stateSlugs()) {
    for (const p of stateSummariesOnce(slug)) {
      list.push({
        ...p,
        stateSlug: slug,
        districtName: p.district != null ? names[String(p.district)]?.district_name ?? null : null,
      });
    }
  }
  list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  ALL_SUMMARIES = { list, byId: new Map(list.map((p) => [p.id, p])) };
  return ALL_SUMMARIES;
}

export type ChangeKind = "filed" | "query" | "moved" | "decided" | "closed";

export interface ChangeEvent {
  kind: ChangeKind;
  date: string;
  sk: string;
  proposal: IndexedProposal;
}

interface ChangesFile {
  window: { from: string; to: string; days: number };
  /** This build's time (ISO). A follower stores it as "seen up to". */
  stamp?: string | null;
  /** Build times, oldest first; a row's `seen` indexes this. */
  stamps?: string[];
  kinds: Record<ChangeKind, string>;
  basis: string;
  coverage: { published: number; with_history: number };
  fields: string[];
  rows: [ChangeKind, string, string, string, (number | null)?][];
  daily: ({ date: string } & Record<ChangeKind, number>)[];
}

export function changesFile(): ChangesFile | null {
  return jsonOrNull<ChangesFile>("changes/recent.json");
}

export interface ChangeQuery {
  kinds?: ChangeKind[];
  state?: string;
  district?: number | null;
  sector?: string;
  category?: string;
  scheduled?: boolean;
  ids?: Set<string>;
  since?: string;
  /**
   * Only events that FIRST APPEARED in a build later than this (ISO).
   * What "new since I last looked" means: an event the portal recorded late
   * is dated before the last visit but appeared after it.
   */
  after?: string;
  limit?: number;
}

/**
 * Events from the change log joined to the proposals they are about, newest
 * first, filtered. A proposal no longer published (delisted since the log was
 * built) is dropped rather than shown half-known.
 */
export function changes(q: ChangeQuery = {}): { events: ChangeEvent[]; total: number } {
  const file = changesFile();
  if (!file) return { events: [], total: 0 };
  const { byId } = allSummaries();
  const ref = legal();
  const dets = (ref?.determinations ?? {}) as Record<string, { status?: string }>;
  const kinds = q.kinds && q.kinds.length ? new Set(q.kinds) : null;
  const out: ChangeEvent[] = [];
  let total = 0;
  const reads = file.stamps ?? [];
  for (const [kind, date, id, sk, seen] of file.rows) {
    if (kinds && !kinds.has(kind)) continue;
    if (q.since && date < q.since) continue;
    if (q.after) {
      const at = seen != null ? reads[seen] : null;
      if (!at || at <= q.after) continue;
    }
    if (q.ids && !q.ids.has(id)) continue;
    const p = byId.get(id);
    if (!p) continue;
    if (q.state && p.stateSlug !== q.state) continue;
    if (q.district != null && p.district !== q.district &&
        !(p.allDistricts ?? []).includes(q.district)) continue;
    if (q.sector && p.sector !== q.sector) continue;
    if (q.category && p.category !== q.category) continue;
    if (q.scheduled) {
      const codes = [p.district, ...(p.allDistricts ?? [])].filter((c): c is number => c != null);
      const s = codes.map((c) => dets[String(c)]?.status);
      if (!s.some((x) => x === "within" || x === "partial")) continue;
    }
    total++;
    if (!q.limit || out.length < q.limit) out.push({ kind, date, sk, proposal: p });
  }
  return { events: out, total };
}

const KIND_SET = new Set(["filed", "query", "moved", "decided", "closed"]);
export const DEFAULT_CHANGE_KINDS: ChangeKind[] = ["filed", "query", "decided", "closed"];

/**
 * The change-log filters from a query string, validated. One parser for the
 * page, the feed, the CSV and the JSON endpoint, so the same URL means the
 * same selection everywhere.
 */
export function changeQueryFrom(u: URLSearchParams): ChangeQuery & { days: number } {
  const kinds = u.getAll("kind").filter((k): k is ChangeKind => KIND_SET.has(k));
  const state = u.get("state") || "";
  const districtRaw = u.get("district");
  const daysRaw = Number(u.get("days")) || 30;
  const days = [7, 30, 60].includes(daysRaw) ? daysRaw : 30;
  const file = changesFile();
  const to = file?.window.to ?? "";
  const sinceParam = u.get("since") || "";
  const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceParam)
    ? sinceParam
    : to
      ? new Date(new Date(`${to}T00:00:00Z`).getTime() - (days - 1) * 86400000)
          .toISOString().slice(0, 10)
      : undefined;
  return {
    kinds: kinds.length ? kinds : DEFAULT_CHANGE_KINDS,
    state: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state) ? state : undefined,
    district: districtRaw && /^[0-9]{1,4}$/.test(districtRaw) ? Number(districtRaw) : null,
    sector: u.get("sector") || undefined,
    category: u.get("category") || undefined,
    scheduled: u.get("scheduled") === "1",
    since,
    after: /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(u.get("after") || "")
      ? (u.get("after") as string)
      : undefined,
    days,
  };
}

/** One CSV cell: quoted, quotes doubled, and a formula-leading value
 *  neutralised so a spreadsheet does not execute it. */
export { csvCell } from "./csv";


/**
 * The forest register's own record of the forest-clearance proposal an EC form
 * names, from the published index of forest proposals (register/forest.json),
 * keyed by proposal number. Null where the form names none or the register
 * holds no such number.
 */
export function forestRecord(p: Project) {
  const links = p.links;
  const nos = fpNumbers(links ? links.f?.[0] ?? null : null);
  if (!nos.length) return null;
  const idx = jsonOrNull<{
    fields: string[]; rows: Record<string, unknown[]>; read_at?: string | null;
    state_read_at?: Record<string, string>;
  }>("register/forest.json");
  if (!idx) return null;
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


interface Dist { n: number; p25: number; median: number; p75: number }
export interface AppraisalContext {
  days: number;
  sector: (Dist & { name: string }) | null;
  state: (Dist & { name: string }) | null;
  national: Dist | null;
  minGroup: number;
}

/**
 * Where this proposal's time to an environmental clearance decision sits
 * among others'. Only for an EC decision: appraisal.json's groups are EC-only,
 * and comparing a ToR decision (median ~50 days) against EC medians (~135)
 * would be the mixed-denominator error the instrument exists to prevent.
 * Groups smaller than appraisal.json's own minimum are not compared against.
 */
export function appraisalContext(p: Project): AppraisalContext | null {
  const days = p.appraisal?.daysToDecision;
  const sk = p.appraisal?.statusKey;
  if (days == null || !sk) return null;
  const stages = jsonOrNull<{ statuses?: Record<string, { decision?: string }> }>("stages.json");
  if (stages?.statuses?.[sk]?.decision !== "ec") return null;
  const a = jsonOrNull<{
    minGroup: number;
    national: { environmentalClearance?: Dist };
    environmentalClearance: { bySector: Record<string, Dist>; byState: Record<string, Dist> };
  }>("appraisal.json");
  if (!a) return null;
  const pick = (d: Dist | undefined) =>
    d && d.n >= a.minGroup ? { n: d.n, p25: d.p25, median: d.median, p75: d.p75 } : null;
  const sec = pick(a.environmentalClearance.bySector[p.sector]);
  const stateKey = Object.keys(a.environmentalClearance.byState)
    .find((k) => k.toLowerCase() === (lookupStateName(p) ?? "").toLowerCase());
  const st = stateKey ? pick(a.environmentalClearance.byState[stateKey]) : null;
  return {
    days,
    sector: sec ? { ...sec, name: p.sector } : null,
    state: st && stateKey ? { ...st, name: stateKey } : null,
    national: pick(a.national.environmentalClearance),
    minGroup: a.minGroup,
  };
}

/** The register's state name for a proposal (its filing state). */
function lookupStateName(p: Project): string | null {
  const slug = lookup()[p.id];
  const sh = slug ? shard(slug) : null;
  return sh?.state ?? null;
}
