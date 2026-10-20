import ScrollRegion from "@/components/instruments/ScrollRegion";
import { partsFor } from "@/lib/instruments/csv";
import Link from "next/link";
import {
  InstrumentFooter,
  InstrumentHeader,
  PLUM,
} from "@/components/instruments/InstrumentChrome";
import StructuredData from "@/components/instruments/StructuredData";
import Watchlist from "@/components/instruments/Watchlist";
import { pageLd, pageMeta } from "@/lib/instruments/metadata";
import {
  changes,
  changesFile,
  json,
  type ChangeKind,
} from "@/lib/instruments/server";
import { presentState, titleCase } from "@/lib/instruments/place";
import stagesFile from "@/public/data/instruments/consent/stages.json";
import freshness from "@/public/data/instruments/consent/freshness.json";

/**
 * What moved in the register - the change layer.
 *
 * The sync reads the register every night; until this page, nothing showed a
 * reader what that read found. Everything here is dated by the portal's own
 * appraisal history (see scripts/instruments/build_changes.py), so the page
 * is complete from its first build rather than from the second sync.
 *
 * Server-rendered, and the filters are a plain GET form: it works without
 * JavaScript, every filtered view has a URL that can be shared, and the same
 * query drives the CSV download and the Atom feed.
 */

export const revalidate = 3600;

export const metadata = pageMeta({
  path: "/instruments/consent/latest",
  title: "What moved in the register — People & Consent",
  description:
    "Environmental clearance proposals filed, queried, decided and closed across India in the last sixty days, dated by the regulator's own appraisal history.",
});

const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(
    (stagesFile as { statuses?: Record<string, { label?: string }> }).statuses ?? {},
  ).map(([k, v]) => [k, String(v?.label ?? k)]),
);

const KIND_ORDER: ChangeKind[] = ["filed", "query", "moved", "decided", "closed"];
const KIND_LABEL: Record<ChangeKind, string> = {
  filed: "Filed",
  query: "Details sought",
  moved: "Moved",
  decided: "Decided",
  closed: "Closed",
};
const DEFAULT_KINDS: ChangeKind[] = ["filed", "query", "decided", "closed"];
const LIST = 200;
const nf = new Intl.NumberFormat("en-IN");

type SP = Record<string, string | string[] | undefined>;

function one(sp: SP, k: string): string {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}


function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
}

export default function LatestPage({ searchParams }: { searchParams: SP }) {
  const file = changesFile();
  const index = json<{ states: Record<string, { name: string; total: number }>; sectors: string[]; categories: string[] }>("index.json");

  const kindsRaw = searchParams.kind;
  const picked = (Array.isArray(kindsRaw) ? kindsRaw : kindsRaw ? [kindsRaw] : [])
    .filter((k): k is ChangeKind => (KIND_ORDER as string[]).includes(k));
  const kinds = picked.length ? picked : DEFAULT_KINDS;
  const state = one(searchParams, "state");
  const sector = one(searchParams, "sector");
  const scheduled = one(searchParams, "scheduled") === "1";
  const districtRaw = one(searchParams, "district");
  const district = /^[0-9]{1,4}$/.test(districtRaw) ? Number(districtRaw) : null;
  const districtName = district != null
    ? json<Record<string, { district_name: string }>>("districts.json")[String(district)]?.district_name ?? null
    : null;
  const daysRaw = Number(one(searchParams, "days")) || 30;
  const days = [7, 30, 60].includes(daysRaw) ? daysRaw : 30;
  const to = file?.window.to ?? "";
  const since = to
    ? new Date(new Date(`${to}T00:00:00Z`).getTime() - (days - 1) * 86400000).toISOString().slice(0, 10)
    : "";

  const query = { kinds, state: state || undefined, sector: sector || undefined, scheduled, since,
                  district: districtName ? district : null };
  const { events, total } = changes({ ...query, limit: LIST });

  const qs = new URLSearchParams();
  for (const k of kinds) qs.append("kind", k);
  if (state) qs.set("state", state);
  if (sector) qs.set("sector", sector);
  if (scheduled) qs.set("scheduled", "1");
  if (districtName && district != null) qs.set("district", String(district));
  qs.set("days", String(days));

  // The seven COMPLETE days before the register was read, over the whole
  // register, for the headline figures. The read day itself is only partly
  // recorded - the portal logs the day's steps after it is read - so
  // including it made "last 7 days" about six.
  const week = (file?.daily ?? []).slice(-8, -1);
  const weekEnd = week[week.length - 1]?.date ?? to;
  const sum = (k: ChangeKind) => week.reduce((n, d) => n + (d[k] ?? 0), 0);
  const scheduledSince = (since: string) =>
    changes({ kinds: ["filed", "decided"], scheduled: true, since }).total;
  const scheduledWeek = to && week.length
    ? scheduledSince(week[0].date) - scheduledSince(to)
    : 0;

  // The chart: filings and decisions per day across the window.
  const daily = file?.daily ?? [];
  const max = Math.max(1, ...daily.map((d) => Math.max(d.filed, d.decided)));
  const W = 720, H = 120, bw = daily.length ? W / daily.length : W;

  const states = Object.entries(index.states)
    .map(([slug, s]) => ({ slug, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData
        data={pageLd({
          path: "/instruments/consent/latest",
          name: "What moved in the register",
          description: "Environmental clearance proposals filed, queried, decided and closed in the last sixty days.",
          trail: [
            { name: "Instruments", path: "/instruments" },
            { name: "People & Consent", path: "/instruments/consent" },
          ],
          type: "CollectionPage",
        })}
      />
      <InstrumentHeader crumb="People & Consent" crumbHref="/instruments/consent" />
      <main id="main-content" className="flex-1 px-6 md:px-12 py-10 md:py-14">
        <div className="max-w-6xl mx-auto">
          <p className="font-label text-[10px] uppercase tracking-[0.2em] opacity-70 mb-2">
            The register, as it moves
          </p>
          <h1 className="font-headline font-bold text-[clamp(30px,4.6vw,54px)] leading-[1.03] tracking-[-0.03em] mb-4">
            What moved in the register
          </h1>
          <p className="font-body text-[15px] leading-relaxed max-w-3xl opacity-85 mb-2">
            Every environmental clearance proposal filed, queried, decided or
            closed across India, day by day. Each event is dated by the
            regulator&rsquo;s own appraisal history; a proposal with no recorded
            history appears on the date it was submitted.
          </p>
          <p className="font-label text-[10px] uppercase tracking-[0.16em] opacity-65 mb-10">
            {file
              ? `${fmtDate(file.window.from)} to ${fmtDate(file.window.to)} · register read ${
                  (freshness as { checked_at?: string }).checked_at
                    ? new Date(String((freshness as { checked_at?: string }).checked_at))
                        .toLocaleDateString("en-IN", { day: "numeric", month: "short",
                          year: "numeric", timeZone: "Asia/Kolkata" })
                    : "—"
                }`
              : "The change log has not been built."}
          </p>

          <Watchlist />

          {/* ── the last seven days ── */}
          <section aria-labelledby="week-heading" className="mb-12">
            <h2 id="week-heading" className="sr-only">The seven complete days before the register was read</h2>
            <dl className="grid grid-cols-2 md:grid-cols-5 gap-6 border-y border-[#1c1c19] py-6">
              {([
                ["Filed", sum("filed")],
                ["Details sought", sum("query")],
                ["Decided", sum("decided")],
                ["Closed", sum("closed")],
                ["Filed or decided in a Scheduled Area district", scheduledWeek],
              ] as [string, number][]).map(([label, n]) => (
                <div key={label}>
                  <dt className="font-label text-[10px] uppercase tracking-[0.16em] opacity-70 mb-1">
                    {label} · 7 complete days to {weekEnd ? fmtDate(weekEnd) : "—"}
                  </dt>
                  <dd className="font-headline text-[34px] leading-none" style={{ color: PLUM }}>
                    {nf.format(n)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* ── the window, day by day ── */}
          {daily.length ? (
            <section aria-labelledby="daily-heading" className="mb-12">
              <h2 id="daily-heading" className="font-headline font-bold text-[22px] mb-3">
                Filings and decisions, day by day
              </h2>
              <svg
                viewBox={`0 0 ${W} ${H + 18}`}
                className="w-full h-auto"
                role="img"
                aria-label={`Filings and decisions per day from ${fmtDate(daily[0].date)} to ${fmtDate(daily[daily.length - 1].date)}. The table below gives every value.`}
              >
                {daily.map((d, i) => (
                  <g key={d.date}>
                    <rect x={i * bw + 1} y={H - (d.filed / max) * H} width={bw / 2 - 1}
                          height={(d.filed / max) * H} fill="rgba(28,28,25,0.35)" />
                    <rect x={i * bw + bw / 2} y={H - (d.decided / max) * H} width={bw / 2 - 1}
                          height={(d.decided / max) * H} fill={PLUM} />
                  </g>
                ))}
                <text x={0} y={H + 14} fontSize="10" fill="currentColor" opacity="0.7">
                  {fmtDate(daily[0].date)}
                </text>
                <text x={W} y={H + 14} fontSize="10" fill="currentColor" opacity="0.7" textAnchor="end">
                  {fmtDate(daily[daily.length - 1].date)}
                </text>
              </svg>
              <p className="font-label text-[10px] uppercase tracking-[0.14em] opacity-70 mt-2">
                <span className="inline-block w-3 h-3 align-middle mr-1" style={{ background: "rgba(28,28,25,0.35)" }} /> filed
                <span className="inline-block w-3 h-3 align-middle ml-4 mr-1" style={{ background: PLUM }} /> decided
                · weekends and holidays fall to near zero
              </p>
              <details className="mt-3">
                <summary className="cursor-pointer font-label text-[10px] uppercase tracking-[0.16em] opacity-75">
                  The same figures as a table
                </summary>
                <ScrollRegion label="Events per day" className="mt-2">
                  <table className="font-body text-[12.5px] w-full">
                    <caption className="sr-only">Events per day</caption>
                    <thead>
                      <tr className="text-left font-label text-[10px] uppercase tracking-[0.12em] opacity-70">
                        <th scope="col" className="pr-4 py-1 font-normal">Date</th>
                        {KIND_ORDER.map((k) => (
                          <th key={k} scope="col" className="pr-4 py-1 font-normal">{KIND_LABEL[k]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...daily].reverse().map((d) => (
                        <tr key={d.date} className="border-t border-[#1c1c19]/10">
                          <td className="pr-4 py-1 whitespace-nowrap">{fmtDate(d.date)}</td>
                          {KIND_ORDER.map((k) => (
                            <td key={k} className="pr-4 py-1 tabular-nums">{nf.format(d[k])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollRegion>
              </details>
            </section>
          ) : null}

          {/* ── filters: a plain GET form ── */}
          <form method="get" className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-6 border border-[#1c1c19]/25 p-4">
            {districtName && district != null ? (
              <p className="md:col-span-12 font-body text-[13.5px]">
                <input type="hidden" name="district" value={district} />
                District: <strong>{districtName}</strong>{" "}
                <Link href="/instruments/consent/latest" className="underline underline-offset-2 opacity-75">
                  clear
                </Link>
              </p>
            ) : null}
            <fieldset className="md:col-span-12 flex flex-wrap gap-x-5 gap-y-2">
              <legend className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 mb-1">
                What happened
              </legend>
              {KIND_ORDER.map((k) => (
                <label key={k} className="flex items-center gap-2 font-body text-[13px]">
                  <input type="checkbox" name="kind" value={k} defaultChecked={kinds.includes(k)}
                         className="accent-[#7a3b6b]" />
                  {KIND_LABEL[k]}
                </label>
              ))}
            </fieldset>
            <label className="md:col-span-4 block">
              <span className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 block mb-1.5">Filed in</span>
              <select name="state" defaultValue={state}
                      className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px]">
                <option value="">All of India</option>
                {states.map((s) => (
                  <option key={s.slug} value={s.slug}>{titleCase(s.name)}</option>
                ))}
              </select>
            </label>
            <label className="md:col-span-4 block">
              <span className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 block mb-1.5">Sector</span>
              <select name="sector" defaultValue={sector}
                      className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px]">
                <option value="">All sectors</option>
                {index.sectors.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="md:col-span-2 block">
              <span className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 block mb-1.5">Period</span>
              <select name="days" defaultValue={String(days)}
                      className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px]">
                {/* Ending on the read day, which is only partly recorded -
                    unlike the headline, which counts complete days only. The
                    labels say which, so the two never read as one figure. */}
                {[7, 30, 60].map((n) => (
                  <option key={n} value={String(n)}>
                    {to ? `${n} days to ${fmtDate(to)}, incl. the read day` : `Last ${n} days`}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-2 flex items-end gap-2 font-body text-[13px] pb-3">
              <input type="checkbox" name="scheduled" value="1" defaultChecked={scheduled}
                     className="accent-[#7a3b6b]" />
              Scheduled Area districts only
            </label>
            <div className="md:col-span-12 flex flex-wrap gap-3">
              <button type="submit"
                      className="tap-target px-5 py-2.5 font-label text-[11px] uppercase tracking-[0.18em]"
                      style={{ background: PLUM, color: "#fcf9f4" }}>
                Show
              </button>
              <a href={`/instruments/consent/feed?${qs.toString()}`}
                 className="tap-target inline-flex items-center px-5 py-2.5 border border-[#1c1c19] font-label text-[11px] uppercase tracking-[0.18em]">
                Feed for this view (Atom)
              </a>
              {Array.from({ length: partsFor(total) }, (_, i) => (
                <a key={i}
                   href={`/api/instruments/consent/changes.csv?${qs.toString()}${i ? `&part=${i + 1}` : ""}`}
                   className="tap-target inline-flex items-center px-5 py-2.5 border border-[#1c1c19] font-label text-[11px] uppercase tracking-[0.18em]">
                  {partsFor(total) > 1
                    ? `CSV, part ${i + 1} of ${partsFor(total)}`
                    : "Download this view (CSV)"}
                </a>
              ))}
            </div>
          </form>

          {/* ── the events ── */}
          <h2 className="sr-only">Events in this view</h2>
          <p className="font-body text-[14px] mb-3" role="status">
            <strong className="font-label">{nf.format(total)}</strong>{" "}
            {total === 1 ? "event" : "events"} in this view
            {total > events.length ? (
              <span className="opacity-75">
                {" "}— the newest {nf.format(events.length)} are listed; the CSV holds all{" "}
                {nf.format(total)}
              </span>
            ) : null}
            .
          </p>
          {events.length === 0 ? (
            <p className="font-body text-[14px] opacity-75 border border-dashed border-[#1c1c19]/30 p-6">
              Nothing in this view. That is a real empty result, not a failure.
            </p>
          ) : (
            <ol className="border-t border-[#1c1c19]/25">
              {events.map((e, i) => (
                <li key={`${e.proposal.id}-${e.kind}-${e.date}-${i}`} className="border-b border-[#1c1c19]/12 py-3 grid grid-cols-1 md:grid-cols-12 gap-2">
                  <div className="md:col-span-2 font-label text-[11px] uppercase tracking-[0.12em]">
                    <span className="block opacity-75">{fmtDate(e.date)}</span>
                    <span style={{ color: e.kind === "decided" ? PLUM : undefined }}>
                      {KIND_LABEL[e.kind]}
                    </span>
                  </div>
                  <div className="md:col-span-7">
                    <Link href={`/instruments/consent/${e.proposal.id}`}
                          className="font-body text-[14px] underline underline-offset-2 break-words">
                      {e.proposal.name.length > 180
                        ? e.proposal.name.slice(0, 177).replace(/\s+\S*$/, "") + "…"
                        : e.proposal.name}
                    </Link>
                    <p className="font-body text-[12px] opacity-70 mt-0.5">
                      {e.proposal.agency || "Proponent not recorded"} · {e.proposal.sector} ·
                      Category {e.proposal.category ?? "—"} · {e.proposal.no}
                    </p>
                  </div>
                  <div className="md:col-span-3 md:text-right font-body text-[12.5px]">
                    <span className="block">{STAGE_LABELS[e.sk] ?? e.sk}</span>
                    <span className="opacity-70">
                      {e.proposal.district != null && e.proposal.districtName ? (
                        <Link href={`/instruments/consent/district/${e.proposal.district}`} className="underline underline-offset-2">
                          {e.proposal.districtName}
                        </Link>
                      ) : (
                        titleCase(presentState(null, index.states[e.proposal.stateSlug]?.name ?? ""))
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {file ? (
            <p className="font-body text-[12.5px] opacity-70 mt-6 max-w-3xl">
              {file.basis} {nf.format(file.coverage.with_history)} of{" "}
              {nf.format(file.coverage.published)} published proposals have a recorded
              appraisal history; the rest contribute only their submission.
            </p>
          ) : null}
        </div>
      </main>
      <InstrumentFooter />
    </div>
  );
}
