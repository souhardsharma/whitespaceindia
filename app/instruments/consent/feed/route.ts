import { NextRequest } from "next/server";
import { changeQueryFrom, changes, changesFile, districts, json } from "@/lib/instruments/server";
import stagesFile from "@/public/data/instruments/consent/stages.json";
import { SITE_URL } from "@/lib/site";

/**
 * An Atom feed of the register's movement, under the same filters as
 * /instruments/consent/latest: /instruments/consent/feed?district=519 follows
 * one district, ?scheduled=1&kind=decided follows decisions in Scheduled Area
 * districts, and so on.
 *
 * A feed is the alert: any feed reader, or a feed-to-email service, turns it
 * into a notification without this site holding anyone's address. Entries are
 * the newest 100 events; each carries a stable id, so a reader never sees the
 * same event twice.
 */
export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = Object.fromEntries(
  Object.entries((stagesFile as { statuses?: Record<string, { label?: string }> }).statuses ?? {})
    .map(([k, v]) => [k, String(v?.label ?? k)]),
);
const KIND: Record<string, string> = {
  filed: "Filed", query: "Details sought", moved: "Moved", decided: "Decided", closed: "Closed",
};

function x(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most control characters; a stray one in a project name
    // would make the whole feed unparseable.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export async function GET(req: NextRequest) {
  const base = SITE_URL;
  const host = new URL(base).host;
  const u = req.nextUrl.searchParams;
  const q = changeQueryFrom(u);
  const { events } = changes({ ...q, limit: 100 });
  const file = changesFile();

  const scope: string[] = [];
  if (q.district != null) scope.push(districts()[String(q.district)]?.district_name ?? `district ${q.district}`);
  if (q.state) {
    const idx = json<{ states: Record<string, { name: string }> }>("index.json");
    scope.push(`filed in ${idx.states[q.state]?.name ?? q.state}`);
  }
  if (q.sector) scope.push(q.sector);
  if (q.scheduled) scope.push("Scheduled Area districts");
  const title = `People & Consent — ${(q.kinds ?? []).map((k) => KIND[k]).join(", ")}` +
    (scope.length ? ` · ${scope.join(" · ")}` : " · all of India");

  // The feed's identity is its SELECTION, not the URL it was fetched by: the
  // raw query string made "?district=519&utm_source=x" a different feed from
  // "?district=519", and a parameter this route ignores a new subscription.
  // Only the parameters that choose events, in a fixed order.
  const canon = new URLSearchParams();
  for (const k of [...(q.kinds ?? [])].sort()) canon.append("kind", k);
  if (q.state) canon.set("state", q.state);
  if (q.district != null) canon.set("district", String(q.district));
  if (q.sector) canon.set("sector", q.sector);
  if (q.category) canon.set("category", q.category);
  if (q.scheduled) canon.set("scheduled", "1");
  const self = `${base}/instruments/consent/feed${canon.toString() ? `?${canon.toString()}` : ""}`;
  const updated = (events[0]?.date ?? file?.window.to ?? "1970-01-01") + "T00:00:00+05:30";

  const entries = events.map((e) => {
    const p = e.proposal;
    const url = `${base}/instruments/consent/${p.id}`;
    const where = p.districtName ?? "location not determined";
    return `  <entry>
    <id>tag:${host},${e.date}:consent/${x(p.id)}/${e.kind}/${x(e.sk)}</id>
    <title>${x(`${KIND[e.kind]}: ${LABELS[e.sk] ?? e.sk} — ${p.name.slice(0, 160)}`)}</title>
    <link href="${x(url)}"/>
    <updated>${e.date}T00:00:00+05:30</updated>
    <summary>${x(`${p.agency || "Proponent not recorded"} · ${p.sector} · Category ${p.category ?? "—"} · ${where} · ${p.no}`)}</summary>
  </entry>`;
  }).join("\n");

  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${x(title)}</title>
  <subtitle>${x("Environmental clearance proposals as they move through the register, dated by the regulator's own appraisal history.")}</subtitle>
  <id>${x(self)}</id>
  <link rel="self" href="${x(self)}"/>
  <link href="${x(`${base}/instruments/consent/latest?${canon.toString()}`)}"/>
  <updated>${updated}</updated>
  <author><name>Whitespace India</name></author>
${entries}
</feed>
`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, max-age=900",
    },
  });
}
