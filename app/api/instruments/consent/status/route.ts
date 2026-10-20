import { NextRequest } from "next/server";
import { allSummaries, findProposal } from "@/lib/instruments/server";
import { stageLabel } from "@/lib/instruments/projects";
import stagesFile from "@/public/data/instruments/consent/stages.json";

/**
 * The current position of up to 100 proposals, for the watchlist.
 *
 * GET ?ids=1,2,3. Read-only and public; returns only what the proposal pages
 * already publish.
 */
export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = Object.fromEntries(
  Object.entries((stagesFile as { statuses?: Record<string, { label?: string }> }).statuses ?? {})
    .map(([k, v]) => [k, String(v?.label ?? k)]),
);

export async function GET(req: NextRequest) {
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
    const full = findProposal(id)?.project;
    out[id] = {
      sk: p.statusKey,
      stage: stageLabel(p.statusKey, p.status, LABELS),
      upd: p.updatedOn,
      don: full?.appraisal?.decidedOn ?? null,
    };
  }
  return Response.json(out, { headers: { "Cache-Control": "public, max-age=300" } });
}
