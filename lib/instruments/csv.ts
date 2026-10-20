/**
 * CSV downloads, in parts a serverless function can actually return.
 *
 * Vercel caps a function's response body at 4.5 MB. Rajasthan's proposals run
 * to 7.3 MB as CSV and sixty days of every kind of event to 14 MB, so a single
 * file per selection fails in production while working perfectly on a laptop.
 * Each selection is served in parts of PART_ROWS rows (well under the cap at
 * the widest rows measured), numbered from 1, with the total and the next part
 * in the headers and every part's rows in the same order - so part 1 + part 2
 * + ... is the whole selection, and a reader who wants it all follows `next`.
 *
 * Also a per-client token bucket (the published shards are the bulk-download
 * route) and a CDN cache: the data changes once a night, with a deploy, and a
 * deploy purges the CDN.
 */
import type { NextRequest } from "next/server";
import { clientIp } from "../request-identity.ts";

export const PART_ROWS = 8000;

export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // A cell a spreadsheet would run as a formula is neutralised.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

const buckets = new Map<string, { tokens: number; at: number }>();

/** A token bucket per client: `max` requests, refilled every minute. */
export function allowRequest(req: NextRequest, scope: string, max: number): boolean {
  const key = `${scope}:${clientIp(req)}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b) {
    if (buckets.size > 50_000) buckets.clear();
    buckets.set(key, { tokens: max - 1, at: now });
    return true;
  }
  const refills = Math.floor((now - b.at) / 60_000);
  if (refills > 0) {
    b.tokens = Math.min(max, b.tokens + refills * max);
    b.at = now;
  }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}

/** Which part a request asks for, 1-based; 0 when the value is not a part. */
export function partOf(u: URLSearchParams): number {
  const raw = u.get("part");
  if (raw == null || raw === "") return 1;
  return /^[1-9][0-9]{0,4}$/.test(raw) ? Number(raw) : 0;
}

/**
 * One part of a selection as a CSV response. `rows` is the WHOLE selection,
 * already filtered and ordered; this slices it.
 */
export function csvPart(
  req: NextRequest,
  head: string[],
  rows: unknown[][],
  filename: string,
): Response {
  const part = partOf(req.nextUrl.searchParams);
  const parts = Math.max(1, Math.ceil(rows.length / PART_ROWS));
  if (!part || part > parts) {
    return Response.json(
      { error: `No such part. This selection has ${parts} part(s), numbered from 1.` },
      { status: 404 },
    );
  }
  const slice = rows.slice((part - 1) * PART_ROWS, part * PART_ROWS);
  const body = [head.join(","), ...slice.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
  const headers: Record<string, string> = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition":
      `attachment; filename="${filename}${parts > 1 ? `-part-${part}-of-${parts}` : ""}.csv"`,
    "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600",
    "X-Total-Rows": String(rows.length),
    "X-Parts": String(parts),
  };
  if (part < parts) {
    const next = new URL(req.nextUrl.toString());
    next.searchParams.set("part", String(part + 1));
    headers["Link"] = `<${next.pathname}${next.search}>; rel="next"`;
  }
  return new Response(body, { headers });
}

/** How many parts a selection of `n` rows is served in. */
export function partsFor(n: number): number {
  return Math.max(1, Math.ceil(n / PART_ROWS));
}
