import { partsFor } from "@/lib/instruments/csv";
import Link from "next/link";
import { FollowButton } from "@/components/instruments/Watchlist";
import RecentActivity from "@/components/instruments/RecentActivity";
import { presentState, titleCase } from "@/lib/instruments/place";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import StructuredData from "@/components/instruments/StructuredData";
import { notFound } from "next/navigation";
import fs from "fs";
import path from "path";
import {
  InstrumentFooter,
  InstrumentHeader,
  PLUM,
} from "@/components/instruments/InstrumentChrome";
import { FactGroup } from "@/components/instruments/FactValue";
import { factsForGroup } from "@/lib/instruments/facts";
import { findingsForDistrict } from "@/lib/instruments/findings";
import Findings from "@/components/instruments/Findings";
import type { MeasureRegistry, DistrictRecord } from "@/lib/instruments/types";
import type { LegalDetermination } from "@/components/instruments/ConsentScreen";
import CompositionBar from "@/components/instruments/CompositionBar";
import FilingTimeline from "@/components/instruments/FilingTimeline";
import freshness from "@/public/data/instruments/consent/freshness.json";
import DistrictProposals, {
  type DistrictProposal,
} from "@/components/instruments/DistrictProposals";

/** How many proposals are rendered into the HTML. The rest load on demand. */
const SERVER_ROWS = 100;

/**
 * One district: who lives there, and everything proposed to be built there.
 *
 * This is the view the source register makes impossible. PARIVESH has no
 * district field to group by, so "what is being proposed in this district" is
 * not a slow query there - it is not a query at all.
 *
 * Rendered on the server from files the pipeline already produced. Only the
 * 620 districts that actually hold a proposal are generated.
 */

const DATA = path.join(process.cwd(), "public", "data", "instruments", "consent");
const nf = new Intl.NumberFormat("en-IN");

/**
 * Read a published file, parsed once per process.
 *
 * 620 district pages are generated at build time and each reads the register,
 * the measure registry, the district table and every state shard that holds it.
 * Without the cache that is thousands of re-parses of the same multi-megabyte
 * JSON - Rajasthan's shard alone is re-read by every Rajasthan district and by
 * the out-of-state districts its filings reach into.
 *
 * Safe because these files are immutable build inputs and callers only read
 * from the returned structures.
 */
const fileCache = new Map<string, unknown>();

function read<T>(...segments: string[]): T {
  const key = segments.join("/");
  const hit = fileCache.get(key);
  if (hit !== undefined) return hit as T;
  const parsed = JSON.parse(fs.readFileSync(path.join(DATA, ...segments), "utf-8"));
  fileCache.set(key, parsed);
  return parsed as T;
}

interface RegisterRow {
  code: number;
  district: string;
  state: string;
  n: number;
  /**
   * Every state shard holding a proposal for this district, busiest first.
   *
   * Usually one, but not always, and the exceptions are not rare: shards are
   * keyed by the state a proposal was FILED in, which is often not the state
   * its site is in. 141 districts draw proposals from more than one shard.
   */
  slugs: string[];
  /**
   * Families declared displaced and affected, counting each project ONCE, in
   * the district it is primarily sited in.
   *
   * Not derivable by summing `df`/`af` over the proposals that name this
   * district: a project spanning several districts declares one NATIONAL
   * figure, carried identically on every district it names. Summing them here
   * counted a single project's whole displacement against every district it
   * touches - Birbhum reported 29,391 families against an actual 225, a 131x
   * overstatement, from 19 multi-district projects among its 133 proposals.
   * `build_register_index.py` excludes the secondary rows when it computes
   * these, and the register page's national total is the sum of them, so
   * reading them here also makes the district pages and the register agree.
   */
  displaced: number;
  affected: number;
  /** Proposals whose form was read for its linked clearances - the
   *  denominator of every count below. */
  linksRead?: number;
  nForest?: number;
  /** Hectares of forest land sought, as declared, primary district only. */
  forestHa?: number;
  linksBlank?: number;
  nWildlife?: number;
  nEsz?: number;
  nProtected?: number;
  nCrz?: number;
}

export function generateStaticParams() {
  const rows = read<RegisterRow[]>("register", "districts.json");
  return rows.filter((r) => r.n > 0).map((r) => ({ code: String(r.code) }));
}

export async function generateMetadata(props: { params: Promise<{ code: string }> }) {
  const params = await props.params;
  try {
    const districts = read<Record<string, DistrictRecord>>("districts.json");
    const d = districts[params.code];
    if (!d) return { title: "District | People & Consent" };
    // Its own canonical and og:url. Without them this page inherits the
    // instruments layout's, and 620 district pages all declare themselves a
    // duplicate of /instruments - which asks a search engine to drop the very
    // pages this instrument exists to publish.
    // A results page cuts a title near 60 characters. A few names are long
    // enough ("Dadra & Nagar Haveli, Dadra and Nagar Haveli and Daman and
    // Diu") that the State would push the instrument's name off the end, so
    // there the title names the district alone; the page heads both.
    const place = titleCase(d.district_name);
    const full = `${place}, ${titleCase(presentState(d.censuscode, d.state_name))} | People & Consent`;
    return pageMeta({
      path: `/instruments/consent/district/${params.code}`,
      title: full.length <= 60 ? full : `${place} | People & Consent`,
      description: `Environmental clearance proposals that name a site in ${titleCase(
        d.district_name
      )}, with the Census 2011 record of who lives there and the duties of consultation and consent that apply.`,
    });
  } catch {
    return { title: "District | People & Consent" };
  }
}

/** Proposals grouped by the sector they were filed under. Counts, not shares:
 *  the bar computes the shares so the two can never disagree. */
function SECTOR_PARTS(
  proposals: { sector: string }[],
): { label: string; value: number }[] {
  const by = new Map<string, number>();
  for (const p of proposals) {
    const k = p.sector || "Not recorded";
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  return Array.from(by.entries()).map(([label, value]) => ({ label, value }));
}

export default async function DistrictPage(props: { params: Promise<{ code: string }> }) {
  const params = await props.params;
  if (!/^\d{1,3}$/.test(params.code)) notFound();

  // Read EVERY shard that holds a proposal for this district, not just the one
  // named after its state. Reading a single shard hid 18,361 proposals across
  // 141 districts - Jaipur's page listed 1 of 1,106 - because a proposal is
  // sharded by the state it was filed in, not the state its site is in.
  //
  // This gives the page the FULL set, which is what the counts above the list
  // are computed from. Only the first page is rendered into the HTML; the rest
  // are fetched from these same shards in the browser. See DistrictProposals.
  const registerRows = read<RegisterRow[]>("register", "districts.json");
  const registerRow = registerRows.find((r) => String(r.code) === params.code);
  if (!registerRow || !registerRow.n || !registerRow.slugs?.length) notFound();
  const csvParts = partsFor(registerRow.n);

  const target = Number(params.code);
  const proposals: DistrictProposal[] = registerRow.slugs
    .flatMap((slug) => {
      const shard = read<{
        slug: string;
        fields: string[];
        sectors: string[];
        statuses: string[];
        rows: unknown[][];
      }>("projects", `${slug}.json`);
      const F = Object.fromEntries(shard.fields.map((n, i) => [n, i])) as Record<
        string,
        number
      >;
      return shard.rows
        .filter((r) => {
          if (r[F.dc] === target) return true;
          const all = r[F.dall] as number[] | null;
          return Array.isArray(all) && all.includes(target);
        })
        .map((r) => ({
          id: String(r[F.id]),
          no: (r[F.no] as string) || "",
          name: (r[F.name] as string) || "",
          agency: ((r[F.agency] as string) || "").trim(),
          sector: shard.sectors[r[F.sector] as number] ?? "",
          cat: (r[F.cat] as string) ?? null,
          status: shard.statuses[r[F.status] as number] ?? "",
          date: (r[F.date] as string) || "",
          af: (r[F.af] as number) ?? null,
          df: (r[F.df] as number) ?? null,
          rnr: (r[F.rnr] as string) ?? null,
          // The appraisal history's first step, NOT the register's own
          // submission date: that one moves forward on re-submission and
          // disagrees for a third of the register, so a series drawn on it
          // would move proposals between quarters when nothing was filed.
          fon: (r[F.fon] as string) ?? null,
          // The district this project is PRIMARILY sited in, which decides
          // which district its declared displacement is counted against.
          dc: (r[F.dc] as number) ?? null,
          state: shard.slug,
        }));
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const bundle = { proposals };

  const districts = read<Record<string, DistrictRecord>>("districts.json");
  const registry = read<MeasureRegistry>("measures.json");
  const legal = read<{ determinations: Record<string, LegalDetermination> }>(
    "legal_reference.json"
  );
  const record = districts[params.code];
  if (!record) notFound();

  const det = legal.determinations?.[params.code] ?? null;
  const facts = (group: string) =>
    factsForGroup(group, registry, record.values, {
      benchmarkScope: "india",
      stateName: record.state_name,
    });

  const catA = bundle.proposals.filter((p) => p.cat === "A").length;
  // From the register index, NOT summed from the proposal rows. See RegisterRow.
  const displaced = registerRow.displaced ?? 0;
  const affected = registerRow.affected ?? 0;
  // Proposals LISTED on this page that declare displacement but are sited
  // primarily elsewhere, so their figures are counted against another
  // district.
  //
  // Without this the page could print "None declared" above a list containing
  // a proposal that plainly declares families displaced - the count and the
  // list coming from different filters, which is the one thing this instrument
  // is not allowed to do. The attribution itself is right and deliberate: a
  // project spanning districts declares ONE national figure carried identically
  // on each, and summing them here reported 29,391 families displaced in
  // Birbhum against an actual 225. So the fix is to reconcile the two on the
  // page, not to change the arithmetic.
  const declaredElsewhere = bundle.proposals.filter(
    (p) => (p.df ?? 0) > 0 && p.dc !== target,
  ).length;

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      {/* This page's OWN identity. All 620 district pages used to inherit the
          shelf's graph from the layout and announce themselves as the
          Instruments CollectionPage, contradicting their own canonical. */}
      <StructuredData
        data={pageLd({
          path: `/instruments/consent/district/${params.code}`,
          name: `${titleCase(record.district_name)}, ${titleCase(presentState(record.censuscode, record.state_name))}`,
          description: `Environmental clearance proposals that name a site in ${titleCase(
            record.district_name,
          )}, with the Census 2011 record of who lives there.`,
          trail: [
            { name: "Instruments", path: "/instruments" },
            { name: "People & Consent", path: "/instruments/consent" },
            { name: "Proposals by district", path: "/instruments/consent/register" },
          ],
        })}
      />
      <InstrumentHeader crumb="People & Consent" crumbHref="/instruments/consent" />

      <main id="main-content" className="flex-1 px-6 md:px-12 py-10 md:py-14">
        <div className="max-w-6xl mx-auto">
          <Link
            href="/instruments/consent/register"
            className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 hover:opacity-100"
          >
            ← All districts
          </Link>

          <h1 className="mt-4 font-headline font-bold text-[clamp(28px,4.4vw,50px)] leading-[1.03] tracking-[-0.03em]">
            {titleCase(record.district_name)}
            <span className="opacity-65">, {titleCase(presentState(record.censuscode, record.state_name))}</span>
            {presentState(record.censuscode, record.state_name) !== record.state_name ? (
              <span className="block font-label text-[11px] uppercase tracking-[0.16em] opacity-80 mt-2">
                Counted as part of {titleCase(record.state_name)} in Census 2011, whose boundaries every figure here uses
              </span>
            ) : null}
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <ScheduledBadge det={det} />
            <span className="font-label text-[10px] uppercase tracking-[0.14em] opacity-70">
              Census 2011 district code {record.censuscode}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <FollowButton kind="district" id={String(record.censuscode)} name={titleCase(record.district_name)} />
            <a
              href={`/instruments/consent/feed?district=${record.censuscode}`}
              className="tap-target inline-flex items-center px-4 py-2 border border-[#1c1c19] font-label text-[10px] uppercase tracking-[0.16em]"
            >
              Follow in a feed reader
            </a>
            {Array.from({ length: csvParts }, (_, i) => (
              <a
                key={i}
                href={`/api/instruments/consent/proposals.csv?district=${record.censuscode}${i ? `&part=${i + 1}` : ""}`}
                className="tap-target inline-flex items-center px-4 py-2 border border-[#1c1c19] font-label text-[10px] uppercase tracking-[0.16em]"
              >
                {csvParts > 1 ? `Download all proposals (CSV), part ${i + 1} of ${csvParts}` : "Download all proposals (CSV)"}
              </a>
            ))}
          </div>

          <RecentActivity district={Number(record.censuscode)} />

          {registerRow.linksRead ? (
            <section className="mt-10" aria-labelledby="other-clearances">
              <h2 id="other-clearances" className="font-headline font-bold text-[clamp(20px,2.4vw,28px)] tracking-[-0.02em] mb-2">
                Other clearances these proposals declare
              </h2>
              <dl className="grid grid-cols-2 lg:grid-cols-5 gap-x-8 gap-y-6 pb-6 border-b border-[#1c1c19]">
                <Stat label="Forest land diversion declared" value={nf.format(registerRow.nForest ?? 0)} />
                <Stat
                  label="Forest land sought for diversion"
                  value={registerRow.forestHa
                    ? `${nf.format(Math.round(registerRow.forestHa))} ha`
                    : registerRow.nForest ? "Area not stated" : "None declared"}
                />
                <Stat label="Wildlife board recommendation declared" value={nf.format(registerRow.nWildlife ?? 0)} />
                <Stat label="In or near a protected area" value={nf.format(registerRow.nProtected ?? 0)} />
                <Stat label="In an eco-sensitive zone" value={nf.format(registerRow.nEsz ?? 0)} />
              </dl>
              <p className="font-body text-[12px] leading-relaxed opacity-70 mt-3 max-w-3xl">
                These counts are taken from the application forms of the{" "}
                {nf.format(registerRow.linksRead)} of {nf.format(registerRow.n)} proposals
                naming this district whose forms have been read for these
                questions.
                {registerRow.linksBlank
                  ? ` In ${nf.format(registerRow.linksBlank)} of those forms at least one question was left blank, and a blank answer is counted as unknown.`
                  : ""}
                {" "}The forest area is the area stated for forest clearance,
                with each forest proposal counted once, in the district where
                its project is primarily sited.
                {registerRow.nCrz ? ` ${nf.format(registerRow.nCrz)} proposals declare activity in a coastal regulation zone.` : ""}
              </p>
            </section>
          ) : null}

          <dl className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6 pb-8 border-b border-[#1c1c19]">
            <Stat label="Proposals naming this district" value={nf.format(bundle.proposals.length)} />
            <Stat label="Category A proposals" value={catA ? nf.format(catA) : "None"} />
            <Stat
              label="Families declared displaced"
              value={displaced ? nf.format(displaced) : "None declared"}
            />
            {/* The basis, stated once beside the pair. A project sited across
                several districts declares one national figure, and this counts
                it in the district it is primarily sited in rather than against
                every district it names. */}
            <Stat
              label="Families declared affected"
              value={affected ? nf.format(affected) : "None declared"}
            />
          </dl>
          <p className="font-body text-[12px] leading-relaxed opacity-70 mt-3 max-w-3xl">
            Displacement figures are the proponents&rsquo; own declarations. A
            project sited across several districts declares one figure for the
            whole project, and that figure is counted once, in the district
            where the project is primarily sited.
            {declaredElsewhere > 0 ? (
              <>
                {" "}
                {nf.format(declaredElsewhere)} of the proposals listed below
                declare displacement and are sited primarily in another
                district, so their figures are counted in that district&rsquo;s
                total.
              </>
            ) : null}
          </p>

          {det ? (
            <section
              className="mt-8 p-5 border-2"
              style={{ borderColor: PLUM, background: "rgba(122,59,107,0.035)" }}
            >
              <h2
                className="font-label text-[10px] uppercase tracking-[0.2em] mb-2"
                style={{ color: PLUM }}
              >
                Fifth Schedule status
              </h2>
              <p className="font-headline text-[19px] leading-snug mb-2">
                {det.status === "within"
                  ? "Within a Fifth Schedule Scheduled Area"
                  : det.status === "partial"
                  ? "Partly within a Fifth Schedule Scheduled Area"
                  : det.status === "outside"
                  ? "Not within a Fifth Schedule Scheduled Area"
                  : "Not determined"}
              </p>
              <p className="font-body text-[13px] leading-relaxed opacity-75 max-w-3xl">
                {det.note}
              </p>
              {det.instrument ? (
                <p className="font-body text-[12.5px] leading-relaxed opacity-70 mt-2">
                  <span className="font-label text-[9px] uppercase tracking-[0.16em] mr-2">
                    Order
                  </span>
                  {det.instrument}
                  {det.provision ? ` · ${det.provision}` : ""}
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="mt-12">
            <Findings
              findings={findingsForDistrict(record, det, {
                proposals: bundle.proposals.length,
                categoryA: catA,
                displaced,
              })}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12">
            <FactGroup
              title="Who lives there"
              intro="Figures from Census 2011, each compared with the all-India value computed on the same definition."
              facts={facts("population")}
              emphasise={["pop.total", "pop.st_share"]}
            />
            <FactGroup
              title="What they live on"
              intro="How the district's workers earn a living, from Census 2011. The land-dependent share counts cultivators and agricultural labourers as a share of all workers, and it is the group most directly affected when land is acquired."
              facts={facts("livelihood")}
              emphasise={["work.land_dependent_share"]}
            />
          </div>
          <FactGroup
            title="How households live"
            intro="Land, income and work among rural households, from the Socio Economic and Caste Census 2011, which recorded these where the population census did not. Only the survey's rural part is used here, so urban households do not appear."
            facts={facts("circumstances")}
          />

          {/* When proposals here were filed, by quarter. */}
          <section className="mt-10">
            <h2 className="font-headline font-bold text-[clamp(19px,2.2vw,26px)] tracking-[-0.02em] mb-1">
              When these were filed
            </h2>
            <p className="font-body text-[13px] leading-relaxed opacity-70 max-w-3xl mb-4">
              Each proposal is dated by the first step in its appraisal
              history, the dated record of steps the portal keeps for it.
            </p>
            <FilingTimeline
              filings={bundle.proposals.map((p) => ({
                filedOn: p.fon ?? null,
                // The register's own submission date, which every row carries.
                // Used only as the denominator: it is how the chart knows what
                // share of each quarter it is actually drawing.
                registeredOn: p.date ?? null,
              }))}
              readAt={freshness.checked_at ?? null}
            />
          </section>

          {/* What the register here is made of. The heading is deliberately
              NOT "What is proposed here" - that names the proposal list two
              sections below, and two same-level headings with one name give a
              reader jumping by heading no way to tell them apart. */}
          <section className="mt-10">
            <h2 className="font-headline font-bold text-[clamp(19px,2.2vw,26px)] tracking-[-0.02em] mb-1">
              What kind of projects these are
            </h2>
            <p className="font-body text-[13px] leading-relaxed opacity-70 max-w-3xl mb-4">
              The proposals naming this district, grouped by the sector each
              was filed under.
            </p>
            <CompositionBar
              parts={SECTOR_PARTS(bundle.proposals)}
              total={bundle.proposals.length}
              unitLabel="proposals"
              caption="The four largest sectors are shown by name and the rest are grouped as Other."
            />
          </section>

          <section className="mt-6">
            <h2 className="font-headline font-bold text-[clamp(21px,2.6vw,30px)] tracking-[-0.02em] mb-1">
              What is proposed here
            </h2>
            <p className="font-body text-[13.5px] leading-relaxed opacity-70 mb-5 max-w-3xl">
              These are the proposals in the national environmental clearance
              register whose application names a site in this district, newest
              first. A project with sites in several districts appears under
              each of them.
            </p>
            <DistrictProposals
              initial={bundle.proposals.slice(0, SERVER_ROWS)}
              total={bundle.proposals.length}
              districtCode={target}
              stateSlugs={registerRow.slugs}
            />
            <noscript>
              <p className="mt-4 font-body text-[13px] opacity-70">
                Showing the first {nf.format(Math.min(SERVER_ROWS, bundle.proposals.length))} of{" "}
                {nf.format(bundle.proposals.length)} proposals. The rest load
                in the browser, and with scripting turned off they can be read
                from{" "}
                {registerRow.slugs.map((s, i) => (
                  <span key={s}>
                    {i > 0 ? " and " : ""}
                    <a
                      className="underline"
                      href={`/data/instruments/consent/projects/${s}.json`}
                    >
                      {s}.json
                    </a>
                  </span>
                ))}{" "}
                under /data/instruments/consent/projects/.
              </p>
            </noscript>
          </section>
        </div>
      </main>

      <InstrumentFooter />
    </div>
  );
}

function ScheduledBadge({ det }: { det: LegalDetermination | null }) {
  const within = det?.status === "within";
  const partial = det?.status === "partial";
  const outside = det?.status === "outside";
  // Every status named. Reaching "Not scheduled" through an else meant any
  // status this badge did not recognise - a value added later, a typo in the
  // data - was published as a negative determination about a real place.
  if (!det || !(within || partial || outside)) {
    return (
      <span className="font-label text-[10px] uppercase tracking-[0.16em] opacity-70">
        Scheduled Area status not determined
      </span>
    );
  }
  return (
    <span
      className="font-label text-[10px] uppercase tracking-[0.16em] px-2 py-1"
      style={
        within
          ? { background: PLUM, color: "#fcf9f4" }
          : partial
          ? { border: `1px solid ${PLUM}`, color: PLUM }
          : { border: "1px solid rgba(28,28,25,0.3)", opacity: 0.7 }
      }
    >
      {within
        ? "Scheduled Area"
        : partial
        ? "Partly Scheduled Area"
        : "Not a Scheduled Area"}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-label text-[9px] uppercase tracking-[0.2em] opacity-70 leading-snug">
        {label}
      </dt>
      <dd
        className="font-label font-bold text-[clamp(19px,2.2vw,26px)] leading-none mt-1.5 tabular-nums"
        style={{ color: PLUM }}
      >
        {value}
      </dd>
    </div>
  );
}

