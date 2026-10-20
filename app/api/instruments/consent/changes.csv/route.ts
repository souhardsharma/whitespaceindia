import { NextRequest } from "next/server";
import { changeQueryFrom, changes } from "@/lib/instruments/server";
import { allowRequest, csvPart } from "@/lib/instruments/csv";

/**
 * Change-log events as CSV: every event in the view, not a page of them, in
 * parts a function can return - see lib/instruments/csv.ts.
 */
export const dynamic = "force-dynamic";

const HEAD = ["date", "event", "stage", "proposal_id", "proposal_no", "project", "proponent",
              "sector", "category", "district_code", "district", "filed_in_state", "url"];

export async function GET(req: NextRequest) {
  if (!allowRequest(req, "csv", 30)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
  const q = changeQueryFrom(req.nextUrl.searchParams);
  const { events } = changes(q);
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";
  return csvPart(req, HEAD, events.map((e) => {
    const p = e.proposal;
    return [e.date, e.kind, e.sk, p.id, p.no, p.name, p.agency, p.sector, p.category,
            p.district, p.districtName, p.stateSlug, `${base}/instruments/consent/${p.id}`];
  }), `people-and-consent-changes-since-${q.since ?? "window"}`);
}
