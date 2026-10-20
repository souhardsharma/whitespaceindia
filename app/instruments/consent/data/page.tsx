import ScrollRegion from "@/components/instruments/ScrollRegion";
import Link from "next/link";
import {
  InstrumentFooter,
  InstrumentHeader,
  PLUM,
} from "@/components/instruments/InstrumentChrome";
import StructuredData from "@/components/instruments/StructuredData";
import { pageLd, pageMeta } from "@/lib/instruments/metadata";
import meta from "@/public/data/instruments/consent/meta.json";
import { SITE_URL } from "@/lib/site";

/**
 * The data, for anyone who wants it rather than the pages.
 *
 * Everything the instrument shows is built from files it publishes as they
 * are, so the files ARE the API: static JSON, rebuilt nightly, cacheable, with
 * no key. This page says what each file holds, what every column of the
 * proposal shards means, and which endpoints answer questions the files
 * cannot answer on their own. check_published.py fails if a shard column is
 * published without an entry in FIELDS below.
 */

export const metadata = pageMeta({
  path: "/instruments/consent/data",
  title: "Data and API — People & Consent",
  description:
    "Every file People & Consent publishes, what each column means, and the endpoints for search, change feeds and CSV downloads. Rebuilt nightly from the environmental clearance register.",
});

const FILES: [string, string][] = [
  ["meta.json", "Counts, resolution rates, coverage of each source, the register's submission span and the checks the build ran."],
  ["freshness.json", "When the register was last read, and whether that read covered all of it."],
  ["index.json", "The states, sectors, categories and status spellings the shards index into, and the location-method legend."],
  ["lookup.json", "Proposal id to the state shard that holds it."],
  ["projects/<state>.json", "Every published proposal filed in one state: a `fields` header and one array per proposal. See the columns below."],
  ["districts.json", "Census 2011 values for all 640 districts, keyed by census code; definitions are in measures.json."],
  ["subdistricts.json", "The same for 5,899 sub-districts."],
  ["measures.json", "What every value means: definition, formula, denominator, source, vintage, and the India and State benchmarks with the formula each was computed with."],
  ["legal_reference.json", "The Scheduled Area determination for every district with its Presidential Order and citation, and the fifteen statutory and standards obligations."],
  ["stages.json", "The canonical stages every status spelling maps to, with phases and decision outcomes."],
  ["appraisal.json", "How long clearance takes, by sector, State, authority, category and outcome."],
  ["register/districts.json", "Per-district counts from the register, and every shard that holds a district's proposals."],
  ["register/facets.json", "Register-wide tallies."],
  ["changes/recent.json", "Every dated event in the last sixty days - filed, details sought, moved, decided, closed - as [kind, date, proposal id, stage, seen] - seen indexes `stamps`, the build in which the event first appeared (null: already there when the log began)."],
  ["/geo/districts-2011.geojson", "Census 2011 district boundaries (datameet), keyed by census code."],
];

/** One entry per shard column. check_published.py asserts none is missing. */
const FIELDS: [string, string][] = [
  ["id", "Proposal id (the register's proposal_id)."],
  ["rid", "Record id - the key the portal's form and history endpoints take."],
  ["no", "Proposal number as the register writes it, e.g. IA/OR/IND1/591624/2026."],
  ["name", "Project name as filed, contact details removed."],
  ["agency", "Proponent, contact details removed."],
  ["sector", "Index into the shard's `sectors`."],
  ["cat", "Category: A, B1 or B2."],
  ["status", "Index into the shard's `statuses` - the status exactly as the register writes it."],
  ["date", "The register's submission date (moves forward on re-submission)."],
  ["auth", "Index into `authorities`: SEIAA or MoEFCC."],
  ["cert", "Clearance letter path, after `certPrefix`; empty when none is published."],
  ["dc", "Census 2011 district the profile is placed in."],
  ["dall", "Every district the filing names, when more than one."],
  ["sd", "Census 2011 sub-districts the filing names."],
  ["nv", "Number of villages or towns the filing names."],
  ["dm", "How it was placed - see `resolutionCodes` in index.json: village, sub-district, declared district, adjudicated, town settled, project name, unresolved."],
  ["af", "Families affected, as declared by the proponent."],
  ["df", "Families displaced, as declared."],
  ["rnr", "Rehabilitation and resettlement involved, as declared: YES or NO."],
  ["lit", "Litigation pending, as declared."],
  ["vio", "Violation involved, as declared."],
  ["land", "Land declared, as filed; the filing records no unit."],
  ["forest", "Forest land declared, as filed."],
  ["sk", "Canonical stage key (stages.json). Count and filter by this, not `status`."],
  ["lat", "Latitude of the mapped block the site verdict rests on."],
  ["lon", "Its longitude."],
  ["ext", "[south, west, north, east] of every mapped block."],
  ["gk", "Where the coordinates fall against the districts the filing names: inside, boundary, elsewhere, offshore, unmapped."],
  ["gd", "The district the coordinates fall in."],
  ["dtd", "Days from first filing to decision, excluding days delisted."],
  ["dpd", "Days open, for undecided proposals."],
  ["qr", "Rounds of essential or additional details sought."],
  ["cst", "Canonical key of the current step."],
  ["fon", "First filing date, from the appraisal history."],
  ["don", "Decision date; fon + dtd + dsu = don."],
  ["dsu", "Days the portal had the proposal delisted."],
  ["nblk", "Mapped blocks the filing carries."],
  ["sq", "Qualifiers on the location: alt, 1c, rej, unt, none, old, wide (see methodology)."],
  ["dd", "The district the form itself declares, as a Census 2011 code."],
  ["upd", "The register's own last-modified date (IST)."],
  ["lk", "The other clearances and the land, as the form declares them: null when the form has not yet been read for them (unknown); 0 when the form answers every question and declares none; else an object with only the declared parts - f: forest clearance [proposal no, status, ha applied, ha diverted, approved on]; w: wildlife board [protected area, status, proposal no]; a: forest land additionally sought, as filed, without a unit; e: eco-sensitive zone; p: protected area; c: coastal regulation zone [1, class]; t: land [[type, owner, acquisition status]]; u: the questions the form left blank, by letter (f, w, e, p, c) - a blank is not a no."],
  ["cf", "Whether the application form was read: ok, nogeo, none (the portal serves none), pend (not yet read)."],
];

const ENDPOINTS: [string, string][] = [
  ["GET /api/instruments/consent/search", "Search the whole register: q, state, district, sector, category, stage, located=1, displacement=1, offset, limit (up to 200)."],
  ["GET /api/instruments/consent/proposals.csv", "The register as CSV - all of India, ?state=<slug>, or ?district=<census code>. Served in parts of 8,000 rows: &part=2 and on; the X-Parts header gives the count and a Link header names the next part."],
  ["GET /api/instruments/consent/changes", "Change-log events as JSON: kind (repeatable), state, district, sector, category, scheduled=1, days (7, 30 or 60) or since=YYYY-MM-DD, and after=<ISO time> for events that first appeared in a build later than that. Returns `stamp`, when this log was built - store it and pass it back as `after` to see only what is new."],
  ["GET /api/instruments/consent/changes.csv", "The same selection, every event, as CSV, in parts of 8,000 rows (&part=N)."],
  ["GET /instruments/consent/feed", "The same selection as an Atom feed - one per district, State, sector or Scheduled Area view."],
  ["GET /api/instruments/consent/status", "Current stage of up to 100 proposals: ?ids=1,2,3."],
  ["POST /api/instruments/consent/export", "One proposal's profile as a PDF (from this site's pages)."],
];

type Source = { name: string; publisher?: string; url?: string };

/**
 * schema.org Dataset for this page, the published files' landing page.
 *
 * Google reads Dataset markup for Dataset Search only (not for web results),
 * which is where a researcher looking for India's clearance register as data
 * looks. Everything is read from meta.json at build time - the span from the
 * rows, the sources as the build recorded them - so it cannot state a date or
 * a source the files do not carry. No licence is claimed because none has
 * been chosen; add `license` when one is.
 */
function datasetLd() {
  const m = meta as {
    generated_at?: string;
    register_span?: { earliest?: string; latest?: string };
    sources?: Source[];
  };
  const base = `${SITE_URL}/data/instruments/consent`;
  const files: [string, string][] = [
    ["meta.json", "Counts, resolution rates, source coverage and the build's checks"],
    ["index.json", "States, sectors, categories and status spellings the shards index into"],
    ["districts.json", "Census 2011 values for every district, keyed by census code"],
    ["register/districts.json", "Per-district counts from the register"],
    ["changes/recent.json", "Every dated event in the register over the last sixty days"],
  ];
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": `${SITE_URL}/instruments/consent/data#dataset`,
    name: "People & Consent: India's environmental clearance register by district",
    description:
      "Every proposal in India's environmental clearance register (PARIVESH), placed in the Census 2011 district and sub-district it was filed for, with its stage, dated appraisal history and time to decision, joined to the Census 2011, Village Directory and SECC profile of the place and to the Scheduled Area determination for the district. Rebuilt nightly from the register; contact details are removed.",
    url: `${SITE_URL}/instruments/consent/data`,
    isAccessibleForFree: true,
    creator: { "@id": `${SITE_URL}/#org` },
    publisher: { "@id": `${SITE_URL}/#org` },
    inLanguage: "en-IN",
    keywords: [
      "environmental clearance", "PARIVESH", "India", "districts", "Census 2011",
      "Scheduled Areas", "Fifth Schedule", "Gram Sabha", "open data",
    ],
    spatialCoverage: { "@type": "Place", name: "India" },
    ...(m.register_span?.earliest && m.register_span?.latest
      ? { temporalCoverage: `${m.register_span.earliest}/${m.register_span.latest}` }
      : {}),
    ...(m.generated_at ? { dateModified: m.generated_at } : {}),
    isBasedOn: (m.sources ?? []).map((s) => ({
      "@type": "CreativeWork",
      name: s.name,
      ...(s.url ? { url: s.url } : {}),
      ...(s.publisher ? { publisher: { "@type": "Organization", name: s.publisher } } : {}),
    })),
    distribution: files.map(([file, what]) => ({
      "@type": "DataDownload",
      name: file,
      description: what,
      encodingFormat: "application/json",
      contentUrl: `${base}/${file}`,
    })),
  };
}

export default function DataPage() {
  const read = (meta as { generated_at?: string }).generated_at;
  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData
        data={pageLd({
          path: "/instruments/consent/data",
          name: "Data and API",
          description: "Every file People & Consent publishes and the endpoints that answer across them.",
          trail: [
            { name: "Instruments", path: "/instruments" },
            { name: "People & Consent", path: "/instruments/consent" },
          ],
        })}
      />
      <StructuredData data={datasetLd()} />
      <InstrumentHeader crumb="People & Consent" crumbHref="/instruments/consent" />
      <main id="main-content" className="flex-1 px-6 md:px-12 py-10 md:py-14">
        <div className="max-w-5xl mx-auto">
          <p className="font-label text-[10px] uppercase tracking-[0.2em] opacity-70 mb-2">Data and API</p>
          <h1 className="font-headline font-bold text-[clamp(30px,4.4vw,50px)] leading-[1.05] tracking-[-0.03em] mb-4">
            Take the data, not only the pages
          </h1>
          <p className="font-body text-[15px] leading-relaxed max-w-3xl opacity-85 mb-3">
            Everything this instrument shows is built from files it publishes as
            they are, rebuilt every night from the environmental clearance
            register. They are plain JSON at stable addresses under{" "}
            <code>/data/instruments/consent/</code>, need no key, and can be
            cached. The endpoints below answer the questions a file cannot answer
            on its own - search across India, the change log, and CSV.
          </p>
          <p className="font-body text-[13.5px] leading-relaxed max-w-3xl opacity-75 mb-10">
            Each source keeps its own terms: the register is the Ministry of
            Environment, Forest and Climate Change&rsquo;s; the Census figures
            come through SHRUG (Development Data Lab); the boundaries from
            datameet. How each is read and checked is in the{" "}
            <Link href="/instruments/consent/methodology" className="underline underline-offset-2">methodology</Link>.
            {read ? ` These files were last built ${new Date(read).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}.` : ""}
          </p>

          <h2 className="font-headline font-bold text-[24px] mb-3">Endpoints</h2>
          <dl className="mb-12 border-t border-[#1c1c19]/25">
            {ENDPOINTS.map(([k, v]) => (
              <div key={k} className="grid grid-cols-1 md:grid-cols-12 gap-2 py-3 border-b border-[#1c1c19]/10">
                <dt className="md:col-span-5 font-label text-[12px] break-words" style={{ color: PLUM }}>{k}</dt>
                <dd className="md:col-span-7 font-body text-[13.5px]">{v}</dd>
              </div>
            ))}
          </dl>

          <h2 className="font-headline font-bold text-[24px] mb-3">Files</h2>
          <dl className="mb-12 border-t border-[#1c1c19]/25">
            {FILES.map(([k, v]) => (
              <div key={k} className="grid grid-cols-1 md:grid-cols-12 gap-2 py-3 border-b border-[#1c1c19]/10">
                <dt className="md:col-span-4 font-label text-[12px] break-words">
                  {k.includes("<") ? k : (
                    <a href={k.startsWith("/") ? k : `/data/instruments/consent/${k}`} className="underline underline-offset-2">{k}</a>
                  )}
                </dt>
                <dd className="md:col-span-8 font-body text-[13.5px]">{v}</dd>
              </div>
            ))}
          </dl>

          <h2 className="font-headline font-bold text-[24px] mb-2">The proposal shards, column by column</h2>
          <p className="font-body text-[13.5px] opacity-80 max-w-3xl mb-3">
            Each shard is one state&rsquo;s proposals as arrays under a{" "}
            <code>fields</code> header. Read columns by name from the header,
            never by position.
          </p>
          <ScrollRegion label="Shard columns" className="mb-8">
            <table className="w-full text-left font-body text-[13px]">
              <caption className="sr-only">Shard columns and what they hold</caption>
              <thead>
                <tr className="font-label text-[10px] uppercase tracking-[0.14em] opacity-70">
                  <th scope="col" className="py-2 pr-4 font-normal">Column</th>
                  <th scope="col" className="py-2 font-normal">What it holds</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map(([k, v]) => (
                  <tr key={k} className="border-t border-[#1c1c19]/10 align-top">
                    <td className="py-2 pr-4"><code data-field={k}>{k}</code></td>
                    <td className="py-2">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </div>
      </main>
      <InstrumentFooter />
    </div>
  );
}
