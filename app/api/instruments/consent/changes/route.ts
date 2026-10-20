import { NextRequest } from "next/server";
import { changeQueryFrom, changes, changesFile } from "@/lib/instruments/server";

/**
 * Change-log events as JSON, under the same filters as
 * /instruments/consent/latest. Returns the count, and the newest 200 events
 * with the fields a list needs.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = changeQueryFrom(req.nextUrl.searchParams);
  const { events, total } = changes({ ...q, limit: 200 });
  return Response.json(
    {
      total,
      since: q.since ?? null,
      to: changesFile()?.window.to ?? null,
      // When this log was built. A follower stores it and asks `after=` it
      // next time: events that first appeared since, however they are dated.
      stamp: changesFile()?.stamp ?? null,
      events: events.map((e) => ({
        kind: e.kind,
        date: e.date,
        stage: e.sk,
        id: e.proposal.id,
        no: e.proposal.no,
        name: e.proposal.name,
        agency: e.proposal.agency,
        sector: e.proposal.sector,
        category: e.proposal.category,
        district: e.proposal.district,
        districtName: e.proposal.districtName,
        state: e.proposal.stateSlug,
      })),
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
