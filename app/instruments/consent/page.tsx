import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import {
  InstrumentFooter,
  InstrumentHeader,
  PLUM,
} from "@/components/instruments/InstrumentChrome";
import ProjectSearch from "@/components/instruments/ProjectSearch";
import DistrictChoropleth from "@/components/instruments/DistrictChoropleth";
import {
  REGISTER_MAP_MEASURES,
  REGISTER_MAP_OPTIONS,
  districtsWithAPage,
  registerMapDistricts,
  scheduledByCode,
  type RegisterRow,
} from "@/lib/instruments/registerMap";
import registerRows from "@/public/data/instruments/consent/register/districts.json";
import legal from "@/public/data/instruments/consent/legal_reference.json";
import { censusAge,
  nextCensusNote, registerStart, sourceVintageLabel, CENSUS_YEAR } from "@/lib/instruments/vintage";
import index from "@/public/data/instruments/consent/index.json";
import meta from "@/public/data/instruments/consent/meta.json";
import freshness from "@/public/data/instruments/consent/freshness.json";
import type { InstrumentIndex, InstrumentMeta } from "@/lib/instruments/types";

export const metadata = pageMeta({
  path: "/instruments/consent",
  title: "People & Consent — Instrument 01 | Whitespace India",
  description:
    "Take an Indian environmental clearance proposal and see who lives where it would be built, what they live on, and which statutory and international-standard consent obligations attach.",
});

const nf = new Intl.NumberFormat("en-IN");

const REGISTER_ROWS = registerRows as unknown as RegisterRow[];
/** Three counts per district, projected before they cross into the client
 *  bundle; the full index carries fields this map never draws. */
const MAP_DISTRICTS = registerMapDistricts(REGISTER_ROWS);

const INSTRUMENTS_TRAIL = { name: "Instruments", path: "/instruments" };
const CONSENT_TRAIL = { name: "People & Consent", path: "/instruments/consent" };

export default function ConsentInstrument() {
  const idx = index as unknown as InstrumentIndex;
  const m = meta as unknown as InstrumentMeta;

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData data={pageLd({ path: "/instruments/consent", name: "People & Consent", description: metadata.description as string, trail: [INSTRUMENTS_TRAIL] })} />
      <InstrumentHeader crumb="People & Consent" />

      <main id="main-content" className="flex-1">
        <section className="px-6 md:px-12 pt-14 md:pt-20 pb-10 border-b border-[#1c1c19]">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-3 mb-5">
              <span
                className="font-label font-bold text-[11px] tracking-[0.2em] px-2 py-1"
                style={{ background: PLUM, color: "#fcf9f4" }}
              >
                01
              </span>
              <span
                className="font-label text-[10px] uppercase tracking-[0.22em]"
                style={{ color: PLUM }}
              >
                Instrument · Live
              </span>
            </div>

            <h1 className="font-headline font-bold text-[clamp(32px,5.4vw,64px)] leading-[1.0] tracking-[-0.03em] max-w-4xl">
              People &amp; Consent
            </h1>
            <p className="mt-5 font-headline italic text-[clamp(18px,2.2vw,27px)] leading-snug max-w-3xl opacity-90">
              Who lives where this project would be built, and whose agreement is
              legally required before it proceeds?
            </p>

            <div className="mt-9 grid grid-cols-1 md:grid-cols-12 gap-8">
              <p className="md:col-span-7 font-body text-[15px] leading-relaxed opacity-80">
                Bring a proposal from India&rsquo;s environmental clearance
                register. The instrument reads the location the proponent filed
                — down to the village where one is named — and assembles the
                Census record for that place: who lives there, what they earn a
                living from, and what community infrastructure exists. It then
                sets out which statutory and international-standard obligations
                attach to a project of that kind in that place.
              </p>
              <div className="md:col-span-5 md:border-l md:border-[#1c1c19]/20 md:pl-8">
                <p className="font-body text-[14px] leading-relaxed opacity-70">
                  It produces no score and no ranking. It does not tell you
                  whether a project should proceed. It tells you what the public
                  record says about the people who live there, and what the law
                  requires of anyone who wants to build there.
                </p>
              </div>
            </div>

            <dl className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6 pt-8 border-t border-[#1c1c19]/20">
              <Stat
                label="Proposals indexed"
                value={nf.format(m.counts.proposals_published)}
              />
              <Stat
                label="Located to a district"
                value={`${m.resolution_rate_pct}%`}
              />
              <Stat
                label="Located to a sub-district"
                value={`${m.subdistrict_rate_pct}%`}
              />
              <Stat
                label="Districts profiled"
                value={nf.format(m.counts.districts)}
              />
            </dl>
          </div>
        </section>

        {/* Where the register's proposals are, as a map. This is the part of
            the instrument that changes with every sync, so it leads; the
            Census measures are mapped on the register page. */}
        <section
          className="px-6 md:px-12 py-12 md:py-16 border-b border-[#1c1c19]"
          aria-labelledby="map-heading"
        >
          <div className="max-w-6xl mx-auto">
            <h2
              id="map-heading"
              className="font-label text-[11px] uppercase tracking-[0.24em] opacity-75 mb-3"
            >
              Where proposals are filed
            </h2>
            <p className="font-body text-[13.5px] leading-relaxed opacity-70 mb-6 max-w-3xl">
              Every district, shaded by what the register holds for it. Choose a
              district to see its proposals and the Census record of who lives
              there. Outlined districts lie wholly or partly within a Fifth
              Schedule Scheduled Area.
            </p>
            <DistrictChoropleth
              districts={MAP_DISTRICTS}
              measures={REGISTER_MAP_MEASURES}
              scheduled={scheduledByCode(legal)}
              hasPage={districtsWithAPage(REGISTER_ROWS)}
              options={REGISTER_MAP_OPTIONS}
              initial={REGISTER_MAP_OPTIONS[0]}
            />
          </div>
        </section>

        <section
          className="px-6 md:px-12 py-12 md:py-16"
          aria-labelledby="search-heading"
        >
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
              <h2
                id="search-heading"
                className="font-label text-[11px] uppercase tracking-[0.24em] opacity-75"
              >
                Find a proposal
              </h2>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/instruments/consent/latest"
                  className="tap-target font-label text-[11px] uppercase tracking-[0.18em] border px-4 py-2.5 transition-colors hover:text-[#fcf9f4]"
                  style={{ borderColor: PLUM, color: PLUM }}
                >
                  What moved this week ↗
                </Link>
                <Link
                  href="/instruments/consent/register"
                  className="tap-target font-label text-[11px] uppercase tracking-[0.18em] border px-4 py-2.5 transition-colors hover:text-[#fcf9f4]"
                  style={{ borderColor: PLUM, color: PLUM }}
                >
                  Browse by district ↗
                </Link>
                <Link
                  href="/instruments/consent/appraisal"
                  className="tap-target font-label text-[11px] uppercase tracking-[0.18em] border px-4 py-2.5 transition-colors hover:text-[#fcf9f4]"
                  style={{ borderColor: PLUM, color: PLUM }}
                >
                  How long it takes ↗
                </Link>
              </div>
            </div>
            <p className="font-body text-[13.5px] leading-relaxed opacity-70 mb-6 max-w-3xl">
              Search every proposal in the register at once, by project,
              proponent, district or proposal number. If the question is about a
              place rather than a filing — what is proposed in this district, and
              who lives there — the register can be read by district instead; if
              it is about what is happening now, start with what moved this
              week.
            </p>
            <ProjectSearch index={idx} />
          </div>
        </section>

        <section className="px-6 md:px-12 py-12 border-t border-[#1c1c19] bg-[#f6f3ee]">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="md:col-span-7">
              <h2 className="font-label text-[11px] uppercase tracking-[0.24em] opacity-75 mb-4">
                What this instrument cannot see
              </h2>
              <ul className="font-body text-[14px] leading-relaxed opacity-80 space-y-3 list-disc pl-4">
                <li>
                  The socio-economic profile is Census {CENSUS_YEAR}, the most
                  recent complete sub-district enumeration of India.{" "}
                  {nextCensusNote()} Every population figure here describes the
                  country as it was {censusAge()} years ago.
                </li>
                <li>
                  {m.counts.proposals_published - m.counts.proposals_district_resolved > 0 ? (
                    <>
                      {nf.format(
                        m.counts.proposals_published -
                          m.counts.proposals_district_resolved
                      )}{" "}
                      proposals could not be placed below state level. They are
                      shown as undetermined rather than guessed.
                    </>
                  ) : (
                    <>
                      Every published proposal could be placed to at least a
                      district.
                    </>
                  )}
                </li>
                {registerStart(m.register_span) ? (
                  <li>
                    The register holds proposals submitted from{" "}
                    {registerStart(m.register_span)} onward. A proposal filed
                    earlier is not in it, so a search for one finds nothing.
                  </li>
                ) : null}
                <li>
                  Affected and displaced family counts are as declared by the
                  proponent in their own application. They are a filing, not an
                  independent assessment, and are labelled as such throughout.
                </li>
                <li>
                  Whether a place lies within a Fifth Schedule Scheduled Area is
                  a legal determination made by Presidential Order. Where the
                  curated reference does not cover a place, the instrument
                  reports that it is undetermined and does not infer it from
                  population data.
                </li>
              </ul>
            </div>
            <div className="md:col-span-5">
              <h2 className="font-label text-[11px] uppercase tracking-[0.24em] opacity-75 mb-4">
                Sources
              </h2>
              <ul className="space-y-4">
                {m.sources.map((s) => (
                  <li key={s.name}>
                    <div className="font-label text-[9px] uppercase tracking-[0.18em] opacity-70">
                      {sourceVintageLabel(s, freshness.checked_at)}
                    </div>
                    <div className="font-body text-[13.5px] leading-snug">
                      {s.name}
                    </div>
                    <div className="font-body text-[12px] opacity-75">
                      {s.publisher}
                    </div>
                    {/* Each updating source carries its OWN read date, from
                        lib/instruments/vintage.ts; the register's is the
                        sync's read time, the same one the footer states with
                        its hour and whether the check was complete. */}
                  </li>
                ))}
              </ul>
              <Link
                href="/instruments/consent/methodology"
                className="inline-flex items-center gap-2 mt-6 font-label text-[11px] uppercase tracking-[0.18em] hover:gap-3 transition-all"
                style={{ color: PLUM }}
              >
                Full methodology <span aria-hidden="true">&#8599;</span>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <InstrumentFooter />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-label text-[9px] uppercase tracking-[0.2em] opacity-70">
        {label}
      </dt>
      <dd
        className="font-label font-bold text-[clamp(22px,2.6vw,32px)] leading-none mt-1.5 tabular-nums"
        style={{ color: PLUM }}
      >
        {value}
      </dd>
    </div>
  );
}
