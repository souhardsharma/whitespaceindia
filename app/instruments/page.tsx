import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageLd } from "@/lib/instruments/metadata";
import {
  InstrumentFooter,
  InstrumentHeader,
  GRAPHITE,
  PLUM,
} from "@/components/instruments/InstrumentChrome";
import meta from "@/public/data/instruments/consent/meta.json";
import freshness from "@/public/data/instruments/consent/freshness.json";
import { sourceVintageLabel } from "@/lib/instruments/vintage";

/**
 * The instruments shelf.
 *
 * Container page. It says what an instrument is, how it differs from the four
 * indexes, and lists what is on the shelf. Static — it reads only the
 * instrument's meta.json for headline counts, so the numbers on this page are
 * the ones the pipeline actually produced rather than figures typed into prose.
 */

const nf = new Intl.NumberFormat("en-IN");

type Shelf = {
  num: string;
  name: string;
  href: string | null;
  status: "live" | "in-development";
  /** The instrument's own colour, used on its row and on its pages. */
  colour: string;
  question: string;
  blurb: string;
  inputs: string;
  stats: { label: string; value: string }[];
};

const INSTRUMENTS: Shelf[] = [
  {
    num: "01",
    name: "People & Consent",
    href: "/instruments/consent",
    status: "live",
    colour: PLUM,
    question:
      "Who lives where this project would be built, and whose agreement is legally required before it proceeds?",
    blurb:
      "Takes a proposal from the national environmental clearance register and assembles a socio-economic profile of the district it sits in: population and community composition, what people there earn a living from, what community infrastructure exists, and which statutory and international-standard obligations attach to a project of that kind in that place.",
    inputs:
      "PARIVESH environmental clearance register · Census 2011 Primary Census Abstract and Village Directory · Socio Economic and Caste Census 2011, rural · Census 2011 district boundaries",
    stats: [
      { label: "Proposals indexed", value: nf.format(meta.counts.proposals_published) },
      { label: "Districts profiled", value: nf.format(meta.counts.districts) },
      {
        label: "Located to a district",
        value: `${meta.resolution_rate_pct}%`,
      },
    ],
  },
];

export default function InstrumentsShelf() {
  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData data={pageLd({ path: "/instruments", name: "Instruments", description: "Per-case screening instruments built from India's public records. Bring one project, filing or place and the instrument assembles what the record holds about it.", type: "CollectionPage" })} />
      <InstrumentHeader />

      <main id="main-content" className="flex-1">
        {/* ───────────────────────── STATEMENT ───────────────────────── */}
        <section className="px-6 md:px-12 pt-16 md:pt-24 pb-12 border-b border-[#1c1c19]">
          <div className="max-w-6xl mx-auto">
            <div
              className="font-label text-[11px] uppercase tracking-[0.24em] mb-6"
              style={{ color: GRAPHITE }}
            >
              The shelf
            </div>
            <h1 className="font-headline font-bold text-[clamp(34px,6vw,72px)] leading-[0.98] tracking-[-0.03em] max-w-4xl">
              An index ranks every district.
              <br />
              An instrument reads <em>one case</em>.
            </h1>
            <div className="mt-10 grid grid-cols-1 md:grid-cols-12 gap-8">
              <p className="md:col-span-7 font-body text-[clamp(16px,1.5vw,19px)] leading-relaxed opacity-80">
                The indexes on this site are comparative. They score every
                district in the country against one question and rank them, so
                they answer <em>where</em> a problem is worst. Instruments work
                the other way round. You bring a single project, filing, or
                place, and the instrument assembles what the public record
                actually holds about that one case. No score. No weighting. No
                ranking.
              </p>
              <p className="md:col-span-5 font-body text-[15px] leading-relaxed opacity-70 md:border-l md:border-[#1c1c19]/20 md:pl-8">
                Every figure an instrument shows carries the dataset it came
                from and the year that dataset was collected. Where the record
                does not say something, the instrument says that instead of
                estimating. That constraint is the point: an instrument is only
                worth using if it is honest about what it cannot see.
              </p>
            </div>
          </div>
        </section>

        {/* ───────────────────────── THE LIST ───────────────────────── */}
        <section
          className="px-6 md:px-12 py-14 md:py-20"
          aria-labelledby="shelf-heading"
        >
          <div className="max-w-6xl mx-auto">
            <h2
              id="shelf-heading"
              className="font-label text-[11px] uppercase tracking-[0.24em] opacity-75 mb-10"
            >
              On the shelf
            </h2>

            <ol className="border-t border-[#1c1c19]">
              {INSTRUMENTS.map((it) => {
                const inner = (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 py-10">
                    <div className="md:col-span-1">
                      <span
                        className="inline-block font-label font-bold text-[11px] tracking-[0.2em] px-2 py-1"
                        style={{ background: it.colour, color: "#fcf9f4" }}
                      >
                        {it.num}
                      </span>
                    </div>

                    <div className="md:col-span-7">
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <h3 className="font-headline font-bold text-[clamp(26px,3.2vw,40px)] leading-none tracking-[-0.02em]">
                          {it.name}
                        </h3>
                        <span
                          className="font-label text-[10px] uppercase tracking-[0.2em]"
                          style={{ color: it.status === "live" ? it.colour : undefined }}
                        >
                          {it.status === "live" ? "Live" : "In development"}
                        </span>
                      </div>
                      <p className="mt-4 font-headline italic text-[clamp(17px,1.8vw,22px)] leading-snug opacity-90">
                        {it.question}
                      </p>
                      <p className="mt-4 font-body text-[15px] leading-relaxed opacity-75">
                        {it.blurb}
                      </p>
                      <p className="mt-5 font-label text-[10px] uppercase tracking-[0.16em] opacity-70 leading-relaxed">
                        {it.inputs}
                      </p>
                    </div>

                    <div className="md:col-span-4 md:pl-8 md:border-l md:border-[#1c1c19]/20">
                      <dl className="flex md:flex-col gap-6 md:gap-5 flex-wrap">
                        {it.stats.map((s) => (
                          <div key={s.label}>
                            <dt className="font-label text-[9px] uppercase tracking-[0.2em] opacity-70">
                              {s.label}
                            </dt>
                            <dd
                              className="font-label font-bold text-[clamp(20px,2.4vw,30px)] leading-none mt-1 tabular-nums"
                              style={{ color: it.colour }}
                            >
                              {s.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {it.href ? (
                        <span className="inline-flex items-center gap-2 mt-7 font-label text-[11px] uppercase tracking-[0.2em] group-hover:gap-3 transition-all">
                          Open the instrument
                          <span aria-hidden="true">&#8599;</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                );

                return (
                  <li
                    key={it.num}
                    className="border-b border-[#1c1c19]/20 relative"
                    style={{ boxShadow: `inset 4px 0 0 ${it.colour}` }}
                  >
                    {it.href ? (
                      <Link
                        href={it.href}
                        className="group block pl-5 md:pl-8 hover:bg-[#1c1c19]/[0.02] transition-colors"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="pl-5 md:pl-8 opacity-75">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ol>

            <p className="mt-10 font-body text-[14px] leading-relaxed opacity-75 max-w-2xl">
              More instruments will be added to this shelf. Each one takes a
              different kind of public filing as its input and answers a
              different question about it.
            </p>
          </div>
        </section>

        {/* ───────────────────────── CURRENCY ───────────────────────── */}
        <section className="px-6 md:px-12 py-12 border-t border-[#1c1c19] bg-[#f6f3ee]">
          <div className="max-w-6xl mx-auto">
            <h2 className="font-label text-[11px] uppercase tracking-[0.24em] opacity-75 mb-6">
              Data currency
            </h2>
            <p className="font-body text-[15px] leading-relaxed opacity-80 max-w-3xl">
              {meta.vintage_warning}
            </p>
            <ul className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6">
              {meta.sources.map((s) => (
                <li key={s.name}>
                  <div className="font-label text-[9px] uppercase tracking-[0.2em] opacity-70">
                    {sourceVintageLabel(s, freshness.checked_at)}
                  </div>
                  <div className="font-body text-[14px] leading-snug mt-1">{s.name}</div>
                  <div className="font-body text-[12px] leading-snug opacity-75 mt-1">
                    {s.publisher}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <InstrumentFooter />
    </div>
  );
}
