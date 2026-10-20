import { NextRequest } from "next/server";
import { clientIp } from "@/lib/request-identity";
import { filterProjects } from "@/lib/instruments/projects";
import { allSummaries, type IndexedProposal } from "@/lib/instruments/server";

/**
 * Search the whole register - every state at once.
 *
 * The search used to require a state first, because it loaded one state's
 * shard into the browser and filtered it there; the page then told readers
 * the SOURCE "offers no national index to search across", which was our
 * design, not the government's. Searching "Adani" or a proposal number meant
 * guessing which of 35 states it was filed in. The server holds every shard,
 * so it answers across all of them and returns one page of results.
 *
 * GET, read-only, public data, so no origin check is needed; a per-client
 * token bucket stops it being used as a bulk-download endpoint (the published
 * shards and the data page serve that honestly).
 *
 * Query: q, state, sector, category, stage, district, located=1,
 * displacement=1, offset, limit (max 200).
 */

export const dynamic = "force-dynamic";

// The searchable text of each proposal, beside the summaries rather than
// copied into a second set of objects: spreading every summary to add one
// field held the whole national index twice.
let HAY: Map<IndexedProposal, string> | null = null;

function hay(): Map<IndexedProposal, string> {
  if (HAY) return HAY;
  HAY = new Map(allSummaries().list.map((p) => [
    p, `${p.name} ${p.agency} ${p.no} ${p.id} ${p.districtName ?? ""}`.toLowerCase(),
  ]));
  return HAY;
}

const buckets = new Map<string, { tokens: number; at: number }>();
const MAX = 60;
const REFILL_MS = 60_000;

function allow(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b) {
    buckets.set(ip, { tokens: MAX - 1, at: now });
    return true;
  }
  const refill = Math.floor((now - b.at) / REFILL_MS) * MAX;
  if (refill > 0) {
    b.tokens = Math.min(MAX, b.tokens + refill);
    b.at = now;
  }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  if (buckets.size > 50_000) buckets.clear();
  return true;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(req: NextRequest) {
  if (!allow(clientIp(req))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
  const u = req.nextUrl.searchParams;
  const q = (u.get("q") || "").slice(0, 120);
  const state = u.get("state") || "";
  if (state && !SLUG_RE.test(state)) {
    return Response.json({ error: "Invalid state" }, { status: 400 });
  }
  const districtRaw = u.get("district");
  const district = districtRaw && /^[0-9]{1,4}$/.test(districtRaw) ? Number(districtRaw) : null;
  const offset = Math.max(0, Math.min(1_000_000, Number(u.get("offset")) || 0));
  const limit = Math.max(1, Math.min(200, Number(u.get("limit")) || 25));

  const text = hay();
  let rows = allSummaries().list;
  if (state) rows = rows.filter((r) => r.stateSlug === state);
  if (district != null) {
    // Every proposal that NAMES the district, as the district page counts
    // them - a multi-district filing is listed in each district it names.
    rows = rows.filter((r) => r.district === district || (r.allDistricts ?? []).includes(district));
  }
  const base = filterProjects(rows, {
    text: "",
    sector: u.get("sector") || "",
    category: u.get("category") || "",
    status: "",
    resolvedOnly: u.get("located") === "1",
    displacementOnly: u.get("displacement") === "1",
  });
  const needle = q.trim().toLowerCase();
  const matched = needle ? base.filter((r) => (text.get(r) ?? "").includes(needle)) : base;

  // Stage counts over everything else the reader chose, so the stage menu
  // offers exactly the stages that would return something.
  const stages: Record<string, number> = {};
  for (const r of matched) {
    const k = r.statusKey ?? r.status;
    stages[k] = (stages[k] ?? 0) + 1;
  }
  const stage = u.get("stage") || "";
  const final = stage ? matched.filter((r) => (r.statusKey ?? r.status) === stage) : matched;

  const items = final.slice(offset, offset + limit);
  return Response.json(
    { total: final.length, offset, limit, stages, items },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
