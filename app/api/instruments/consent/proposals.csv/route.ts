import { NextRequest } from "next/server";
import { allSummaries } from "@/lib/instruments/server";
import { allowRequest, csvPart } from "@/lib/instruments/csv";

/**
 * The register as CSV: every published proposal, or those filed in one state,
 * or those naming one district. What the proposal pages show, flat. Served in
 * parts of a size a function can return - see lib/instruments/csv.ts.
 */
export const dynamic = "force-dynamic";

const HEAD = ["proposal_id", "proposal_no", "project", "proponent", "sector", "category",
              "stage", "status_as_written", "submitted", "register_updated", "district_code",
              "district", "districts_named", "filed_in_state", "located_by",
              "families_affected_declared", "families_displaced_declared", "rnr_declared"];

export async function GET(req: NextRequest) {
  if (!allowRequest(req, "csv", 30)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
  const u = req.nextUrl.searchParams;
  const state = u.get("state") || "";
  const dRaw = u.get("district");
  const district = dRaw && /^[0-9]{1,4}$/.test(dRaw) ? Number(dRaw) : null;
  if (state && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state)) {
    return Response.json({ error: "Invalid state" }, { status: 400 });
  }
  let rows = allSummaries().list;
  if (state) rows = rows.filter((p) => p.stateSlug === state);
  if (district != null) {
    rows = rows.filter((p) => p.district === district || (p.allDistricts ?? []).includes(district));
  }
  const tag = district != null ? `district-${district}` : state || "india";
  return csvPart(req, HEAD, rows.map((p) => [
    p.id, p.no, p.name, p.agency, p.sector, p.category, p.statusKey, p.status, p.date,
    p.updatedOn, p.district, p.districtName, (p.allDistricts ?? []).join(" "), p.stateSlug,
    p.resolution, p.declared.affectedFamilies, p.declared.displacedFamilies,
    p.declared.rnrInvolved,
  ]), `people-and-consent-proposals-${tag}`);
}
