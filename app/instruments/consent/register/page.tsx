import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import {
  InstrumentFooter,
  InstrumentHeader,
  PLUM,
} from "@/components/instruments/InstrumentChrome";
import RegisterExplorer, {
  type DistrictRow,
} from "@/components/instruments/RegisterExplorer";
import DistrictChoropleth, {
  type MeasureSpec,
} from "@/components/instruments/DistrictChoropleth";
import type { DistrictRecord } from "@/lib/instruments/types";
import rows from "@/public/data/instruments/consent/register/districts.json";
import districts from "@/public/data/instruments/consent/districts.json";
import measuresFile from "@/public/data/instruments/consent/measures.json";
import legal from "@/public/data/instruments/consent/legal_reference.json";
import facets from "@/public/data/instruments/consent/register/facets.json";
import instrumentMeta from "@/public/data/instruments/consent/meta.json";

export const metadata = pageMeta({
  path: "/instruments/consent/register",
  title: "The register by district — People & Consent | Whitespace India",
  description:
    "Every environmental clearance proposal in India, placed in the district it was filed for, alongside the Census record of who lives there and the Fifth Schedule status of that place.",
});

const nf = new Intl.NumberFormat("en-IN");

const INSTRUMENTS_TRAIL = { name: "Instruments", path: "/instruments" };
const CONSENT_TRAIL = { name: "People & Consent", path: "/instruments/consent" };


/** What the map offers, in the order it offers them. Each key must exist in
 *  measures.json - the map reads its label, unit and definition from there
 *  rather than restating them, so a measure cannot be described one way on
 *  this page and another on the district page. */
const MAP_MEASURES = [
  "pop.st_share",
  "pop.total",
  "work.land_dependent_share",
  "pop.literacy_rate",
  "pop.sc_share",
];

/**
 * Only what the map can actually draw, projected before it crosses into the
 * client bundle.
 *
 * `districts.json` carries 23 measures for each of 640 districts and the map
 * offers 5 of them, so handing it the whole file serialised 18 measures per
 * district into the RSC payload that no control on this page can ever select -
 * 338 KB of a 471 KB file, about 44 KB gzipped, downloaded by every visitor
 * and rendered by nothing. The same applies to the registry: its label, unit
 * and definition are read for the measures on offer and for no others.
 *
 * Projecting here rather than trimming the published file keeps the file the
 * one source both pages read - the district page uses all 23 - and keeps this
 * page's payload to what this page draws.
 */

const MAP_DISTRICTS: Record<string, DistrictRecord> = Object.fromEntries(
  Object.entries(districts as unknown as Record<string, DistrictRecord>).map(
    ([code, d]) => [
      code,
      {
        censuscode: d.censuscode,
        district_name: d.district_name,
        state_name: d.state_name,
        values: Object.fromEntries(
          MAP_MEASURES.map((k) => [k, d.values?.[k] ?? null]),
        ),
      },
    ],
  ),
);

const ALL_MEASURES = ((measuresFile as { measures?: unknown }).measures ??
  measuresFile) as Record<string, unknown>;
const MAP_REGISTRY: Record<string, MeasureSpec> = Object.fromEntries(
  MAP_MEASURES.filter((k) => k in ALL_MEASURES).map((k) => [
    k,
    ALL_MEASURES[k] as MeasureSpec,
  ]),
);

/** Scheduled Area status by Census code, for the outline overlay. */
const SCHEDULED_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(
    (legal as { determinations?: Record<string, { status?: string }> })
      .determinations ?? {},
  ).map(([code, d]) => [code, String(d?.status ?? "unknown")]),
);

/** Exactly the districts `generateStaticParams` builds a page for. */
const DISTRICTS_WITH_A_PAGE = (rows as unknown as { code: number; n: number }[])
  .filter((r) => r.n > 0)
  .map((r) => r.code);

/**
 * Proposals in WHOLLY Scheduled districts, and in partly Scheduled ones.
 *
 * `facets.totals.proposals_in_scheduled_districts` lumps the two together at
 * 22,598, and it was published under the label "In districts that are
 * Scheduled Areas". 19,555 of those - 86.5% - are in districts only PARTLY
 * scheduled, where the Presidential Order names some blocks or villages and
 * not others, so the district's status settles nothing about the site.
 *
 * The distinction is the whole legal point. Inside a Fifth Schedule Scheduled
 * Area, consultation with the Gram Sabha is a precondition of acquisition; a
 * reader given one number under that label would fairly report that 22,598
 * clearance proposals sit in Scheduled Areas, and for seven in eight of them
 * that is not something this instrument knows.
 */
const scheduledSplit = (rows as unknown as { code: number; n: number }[]).reduce(
  (acc, r) => {
    const status = SCHEDULED_BY_CODE[String(r.code)];
    if (status === "within") acc.wholly += r.n;
    else if (status === "partial") acc.partly += r.n;
    return acc;
  },
  { wholly: 0, partly: 0 },
);

export default function RegisterPage() {
  const t = facets.totals;

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData data={pageLd({ path: "/instruments/consent/register", name: "The register by district", description: metadata.description as string, trail: [INSTRUMENTS_TRAIL, CONSENT_TRAIL], type: "CollectionPage" })} />
      <InstrumentHeader crumb="People & Consent" crumbHref="/instruments/consent" />

      <main id="main-content" className="flex-1">
        <section className="px-6 md:px-12 pt-14 md:pt-18 pb-8 border-b border-[#1c1c19]">
          <div className="max-w-6xl mx-auto">
            <p
              className="font-label text-[11px] uppercase tracking-[0.24em] mb-4"
              style={{ color: PLUM }}
            >
              The register, by district
            </p>
            <h1 className="font-headline font-bold text-[clamp(28px,4.6vw,52px)] leading-[1.04] tracking-[-0.03em] max-w-4xl">
              What is proposed, and where
            </h1>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-12 gap-8">
              <p className="md:col-span-7 font-body text-[15px] leading-relaxed opacity-80">
                PARIVESH publishes every clearance proposal and is the
                authoritative record of them. It is organised around the
                proposal: you go to it knowing which filing you want. The
                location a proponent files sits inside each application rather
                than in the search index, so the register is hard to read by
                place.
              </p>
              <p className="md:col-span-5 font-body text-[14px] leading-relaxed opacity-70 md:border-l md:border-[#1c1c19]/20 md:pl-8">
                This view reads that filed location for every proposal and
                joins it to the Census record for the same place, so the register
                can also be read the other way round: by district, and by who
                lives there.
              </p>
            </div>

            <dl className="mt-9 grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6 pt-7 border-t border-[#1c1c19]/20">
              <Stat
                label="Proposals placed in a district"
                value={nf.format(t.with_district)}
              />
              <Stat
                label="Districts with at least one"
                value={`${nf.format(t.districts_with_proposals)} of ${nf.format(t.districts_total)}`}
              />
              <Stat
                label="In wholly Scheduled districts"
                value={nf.format(scheduledSplit.wholly)}
                note={`${nf.format(scheduledSplit.partly)} more are in partly Scheduled districts, where the district's status does not settle whether the site itself is in a Scheduled Area.`}
              />
              <Stat
                label="Families declared displaced"
                value={nf.format(t.declared_displaced_families)}
              />
            </dl>
          </div>
        </section>

        <section className="px-6 md:px-12 py-10 md:py-14">
          <div className="max-w-6xl mx-auto">
            {/* The same 640 districts the table below holds, as magnitude.
                A map answers "where is this concentrated" in one look and
                answers "what is the number here" badly; the table answers the
                second. Both are rendered from one set of values, so they
                cannot drift apart. */}
            <DistrictChoropleth
              districts={MAP_DISTRICTS}
              measures={MAP_REGISTRY}
              scheduled={SCHEDULED_BY_CODE}
              hasPage={DISTRICTS_WITH_A_PAGE}
              options={MAP_MEASURES}
              initial={MAP_MEASURES[0]}
            />

            <RegisterExplorer
              rows={rows as unknown as DistrictRow[]}
              registerTotal={instrumentMeta.counts.proposals_published}
            />

            <div className="mt-10 pt-6 border-t border-[#1c1c19]/20 max-w-3xl space-y-3">
              <p className="font-body text-[13px] leading-relaxed opacity-70">
                {facets.note}
              </p>
              <p className="font-body text-[13px] leading-relaxed opacity-70">
                {facets.landUnitCaveat}
              </p>
              {/* Faded by text colour, not opacity: opacity reaches the link
                  inside and took its plum to 3.7:1. */}
              <p className="font-body text-[13px] leading-relaxed text-[#1c1c19]/70">
                Scheduled Area status is a legal determination made by
                Presidential Order, not a property of the population data. Where
                the curated reference does not cover a district it reads{" "}
                <em>not determined</em>, which is not the same as outside.{" "}
                <Link
                  href="/instruments/consent/methodology"
                  className="underline underline-offset-2"
                  style={{ color: PLUM }}
                >
                  How this was established
                </Link>
                .
              </p>
            </div>
          </div>
        </section>
      </main>

      <InstrumentFooter />
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  /** A qualification the headline number would otherwise overstate. */
  note?: string;
}) {
  return (
    <div>
      <dt className="font-label text-[9px] uppercase tracking-[0.2em] opacity-70 leading-snug">
        {label}
      </dt>
      <dd
        className="font-label font-bold text-[clamp(20px,2.4vw,28px)] leading-none mt-1.5 tabular-nums"
        style={{ color: PLUM }}
      >
        {value}
      </dd>
      {note ? (
        <dd className="font-body text-[11.5px] leading-snug opacity-75 mt-1.5 max-w-[30ch]">
          {note}
        </dd>
      ) : null}
    </div>
  );
}
