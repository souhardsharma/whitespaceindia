import { NextRequest } from "next/server";
import { allSummaries } from "@/lib/instruments/server";
import { stageLabel } from "@/lib/instruments/projects";
import { allowRequest } from "@/lib/instruments/csv";
import stagesFile from "@/public/data/instruments/consent/stages.json";

/**
 * The current position of up to 100 proposals, for the watchlist.
 *
 * GET ?ids=1,2,3. Read-only and public; returns only what the proposal pages
 * already publish. Answered from the in-memory index alone: reading each
 * proposal's shard for its decision date cost 3.3 s of function time for 100
 * ids spread across States, which made this the cheapest way to run down the
 * deployment's quota.
 */
export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = Object.fromEntries(
  Object.entries((stagesFile as { statuses?: Record<string, { label?: string }> }).statuses ?? {})
    .map(([k, v]) => [k, String(v?.label ?? k)]),
);

export async function GET(req: NextRequest) {
  if (!allowRequest(req, "status", 30)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
  const ids = (req.nextUrl.searchParams.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9]{1,12}$/.test(s))
    .slice(0, 100);
  const { byId } = allSummaries();
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    out[id] = {
      sk: p.statusKey,
      stage: stageLabel(p.statusKey, p.status, LABELS),
      upd: p.updatedOn,
      don: p.decidedOn,
    };
  }
  return Response.json(out, { headers: { "Cache-Control": "public, max-age=300" } });
}
