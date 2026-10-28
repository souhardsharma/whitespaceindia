/**
 * Server-side reads of the published instrument data.
 *
 * SERVER ONLY. It reads files from public/data with `fs`, so it must never be
 * imported into a "use client" module - Next would try to bundle `fs` for the
 * browser and fail the build, which is the guard.
 *
 * Proposal pages do NOT come through here: they are assembled in the browser
 * from static files (lib/instruments/bundle.ts), because rendering ~92,000 of
 * them on demand for crawlers used up the Hobby plan. What remains is what the
 * district pages, the change log, the sitemaps and the API need.
 *
 * Every file is read through `json()`, which caches by path for the life of
 * the process. The data only changes when a deploy replaces it, and a deploy
 * starts new processes, so the cache can never serve a previous build's data.
 */

import fs from "fs";
import path from "path";
import type { DistrictRecord, InstrumentMeta, Project } from "./types";
import { unpackSummaries, type RawShard } from "./projects";
import type { LegalReference } from "./obligations";
import { forestEntry, type ChangeKind, type ForestIndex } from "./bundle";

export type { ChangeKind };

/**
 * Cache-Control for a response built only from this deployment's files.
 * Vercel's CDN keys its cache on the deployment, so a day at the edge never
 * outlives the data; a repeat request is answered there without running a
 * function at all.
 */
export const EDGE_CACHE = "public, max-age=300, s-maxage=86400";

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
// so they are never kept. What sweeps all of them (the national index, the
// sitemaps) reads each once and keeps only what it derives; one proposal is
// read by byte range through the runtime index below.

/** Read a shard without keeping it. */
export function shardOnce(slug: string): RawShard | null {
  if (!SLUG_RE.test(slug)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "projects", `${slug}.json`), "utf-8")) as RawShard;
  } catch {
    return null;
  }
}

export function stateSlugs(): string[] {
  return fs
    .readdirSync(path.join(DATA_DIR, "projects"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export const districts = () => json<Record<string, DistrictRecord>>("districts.json");
export const meta = () => json<InstrumentMeta>("meta.json");
export const legal = () => jsonOrNull<LegalReference>("legal_reference.json");

/*
 * The runtime index (scripts/instruments/runtime_index.mjs, run before every
 * build): where each proposal's row sits in its shard, so one proposal is read
 * by byte range instead of by parsing its whole shard. It is built from these
 * same files in the same build, so it cannot describe other data than the
 * shards beside it.
 */
const RUNTIME_DIR = path.join(process.cwd(), ".runtime", "instruments", "consent");

type ShardHeader = Omit<RawShard, "rows">;
type RuntimeHeaders = { idBuckets: number; slugs: string[]; shards: Record<string, ShardHeader> };

function runtime<T>(rel: string): T | null {
  const key = `__runtime__/${rel}`;
  if (cache.has(key)) return cache.get(key) as T | null;
  let data: T | null = null;
  try {
    data = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, rel), "utf-8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
  }
  cache.set(key, data);
  return data;
}

function shardHeaders(): RuntimeHeaders {
  const h = runtime<RuntimeHeaders>("headers.json");
  // Loud, never a quiet 404 for every proposal.
  if (!h) throw new Error(`runtime index missing at ${RUNTIME_DIR}: run node scripts/instruments/runtime_index.mjs`);
  return h;
}

/** A proposal's raw row and the shard it was filed in, read by byte range. */
function rawRow(id: string): { slug: string; shard: RawShard } | null {
  if (!/^[0-9]{1,12}$/.test(id)) return null;
  const h = shardHeaders();
  const at = runtime<Record<string, [number, number, number]>>(`ids/${Number(id) % h.idBuckets}.json`)?.[id];
  return at ? rowAt(id, ...at) : null;
}

/** The row of shard `si` at [offset, offset + length), which must carry `id`. */
function rowAt(id: string, si: number, offset: number, length: number): { slug: string; shard: RawShard } {
  const h = shardHeaders();
  const slug = h.slugs[si];
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(path.join(DATA_DIR, "projects", `${slug}.json`), "r");
  try {
    fs.readSync(fd, buf, 0, length, offset);
  } finally {
    fs.closeSync(fd);
  }
  const header = h.shards[slug];
  let row: unknown[] | null = null;
  try {
    row = JSON.parse(buf.toString("utf-8")) as unknown[];
  } catch {
    row = null;
  }
  if (!row || String(row[header.fields.indexOf("id")]) !== id) {
    throw new Error(`runtime index is stale for ${slug}.json (id ${id}): rebuild it`);
  }
  return { slug, shard: { ...header, rows: [row] } };
}

/** One proposal's row as published, with its shard's vocabulary, for the PDF export. */
export function proposalRow(id: string): { slug: string; shard: RawShard; row: unknown[] } | null {
  const raw = rawRow(id);
  return raw ? { ...raw, row: raw.shard.rows[0] } : null;
}

/**
 * One state's summaries, WITHOUT keeping the raw shard. The national index
 * needs every state's summaries once; caching all 35 raw shards beside them
 * held ~130 MB of heap per server instance for data already copied into the
 * summaries.
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

const NAMED_LOOKUP_MAX = 100;

/** The national index's entries for these ids, built without the national index. */
export function summariesFor(ids: Iterable<string>): Map<string, IndexedProposal> {
  const names = districts();
  const out = new Map<string, IndexedProposal>();
  for (const id of ids) {
    const raw = rawRow(id);
    const p = raw ? unpackSummaries(raw.shard)[0] : undefined;
    if (!raw || !p) continue;
    out.set(id, {
      ...p,
      stateSlug: raw.slug,
      districtName: p.district != null ? names[String(p.district)]?.district_name ?? null : null,
    });
  }
  return out;
}

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
  const ref = legal();
  const dets = (ref?.determinations ?? {}) as Record<string, { status?: string }>;
  const kinds = q.kinds && q.kinds.length ? new Set(q.kinds) : null;
  const out: ChangeEvent[] = [];
  let total = 0;
  const reads = file.stamps ?? [];
  // A few named proposals (one proposal's own steps) are looked up one by
  // one; building the national index for them parsed every shard.
  const byId = q.ids && q.ids.size <= NAMED_LOOKUP_MAX ? summariesFor(q.ids) : allSummaries().byId;
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
 * names (register/forest.json, keyed by proposal number), for the PDF export.
 */
export function forestRecord(p: Pick<Project, "links">) {
  return forestEntry(p, jsonOrNull<ForestIndex>("register/forest.json"));
}
