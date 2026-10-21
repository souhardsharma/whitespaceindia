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
  title: "Data and API | People & Consent",
  description:
    "The files People & Consent publishes and what each column means, with the endpoints for search, the change feed and CSV downloads.",
});

const FILES: [string, string][] = [
  ["meta.json", "Counts, resolution rates, coverage of each source, the register's submission span and the checks the build ran."],
  ["freshness.json", "When the register was last read, and whether that read covered all of it."],
  ["index.json", "The states, sectors, categories and status spellings the shards index into, and the location-method legend."],
  ["lookup.json", "Proposal id to the state shard that holds it."],
  ["projects/<state>.json", "The published proposals filed in one state, as a header named fields followed by one array per proposal. The columns are described below."],
  ["districts.json", "Census 2011 values for all 640 districts, keyed by census code. Their definitions are in measures.json."],
  ["subdistricts.json", "The same values for 5,899 sub-districts."],
  ["measures.json", "The meaning of every value, with its definition, formula, denominator, source and year, and the India and State benchmarks together with the formula used for each."],
  ["legal_reference.json", "The Scheduled Area determination for every district with the Presidential Order and citation it rests on, and the fifteen obligations drawn from statutes and international standards."],
  ["stages.json", "The standard stages to which every spelling of a status is mapped, with their phases and decision outcomes."],
  ["appraisal.json", "How long clearance takes, by sector, State, authority, category and outcome."],
  ["register/districts.json", "Per-district counts from the register, and every shard that holds a district's proposals."],
  ["register/facets.json", "Register-wide tallies."],
  ["changes/recent.json", "Every dated event of the last sixty days (filed, details sought, other step, decided or closed), each as [kind, date, proposal id, stage, seen]. The seen value points into stamps, the list of builds, and gives the build in which the event first appeared; it is null for events already present when the log began."],
  ["/geo/districts-2011.geojson", "Census 2011 district boundaries (datameet), keyed by census code."],
];

/** One entry per shard column. check_published.py asserts none is missing. */
const FIELDS: [string, string][] = [
  ["id", "Proposal id (the register's proposal_id)."],
  ["rid", "Record id, which is the key the portal's form and history endpoints take."],
  ["no", "Proposal number as the register writes it, e.g. IA/OR/IND1/591624/2026."],
  ["name", "Project name as filed, contact details removed."],
  ["agency", "Proponent, contact details removed."],
  ["sector", "Position in the shard's sectors list."],
  ["cat", "Category: A, B1 or B2."],
  ["status", "Position in the shard's statuses list, which holds each status exactly as the register writes it."],
  ["date", "The register's submission date (moves forward on re-submission)."],
  ["auth", "Position in the authorities list: SEIAA (the State Environment Impact Assessment Authority) or MoEFCC (the Ministry of Environment, Forest and Climate Change)."],
  ["cert", "Path of the clearance letter, to be appended to certPrefix. It is empty when no letter is published."],
  ["dc", "Census 2011 district the profile is placed in."],
  ["dall", "Every district the filing names, when more than one."],
  ["sd", "Census 2011 sub-districts the filing names."],
  ["nv", "Number of villages or towns the filing names."],
  ["dm", "How the proposal was placed, as a code listed under resolutionCodes in index.json. The methods are by village, by sub-district, by declared district, by reconciling conflicting statements, by settling a town that spans districts and by project name, and a further code marks a proposal left unresolved."],
  ["af", "Families affected, as declared by the proponent."],
  ["df", "Families displaced, as declared."],
  ["rnr", "Rehabilitation and resettlement involved, as declared: YES or NO."],
  ["lit", "Litigation pending, as declared."],
  ["vio", "Violation involved, as declared."],
  ["land", "Land declared, as filed; the filing records no unit."],
  ["forest", "Forest land declared, as filed."],
  ["sk", "Standard stage key from stages.json. Counts and filters are reliable on this column, since the status column carries several spellings of one stage."],
  ["lat", "Latitude of the mapped block the site verdict rests on."],
  ["lon", "Its longitude."],
  ["ext", "[south, west, north, east] of every mapped block."],
  ["gk", "Where the coordinates fall relative to the districts the filing names: inside, boundary, elsewhere, offshore or unmapped."],
  ["gd", "The district the coordinates fall in."],
  ["dtd", "Days from first filing to decision, excluding days delisted."],
  ["dpd", "Days open, for undecided proposals."],
  ["qr", "Rounds of essential or additional details sought."],
  ["cst", "Canonical key of the current step."],
  ["fon", "First filing date, from the appraisal history."],
  ["don", "Decision date; fon + dtd + dsu = don."],
  ["dsu", "Days the portal had the proposal delisted."],
  ["nblk", "Mapped blocks the filing carries."],
  ["sq", "Qualifiers on the site location. alt means the filing had no block marked primary and its other blocks were used; 1c, a block with a single corner; rej, blocks discarded as unusable; unt, untyped blocks beside a primary block that were skipped; none, every block discarded; old, a record extracted before the current version, whose discards were not counted; wide, a site spanning more than one degree."],
  ["dd", "The district the form itself declares, as a Census 2011 code."],
  ["upd", "The register's own last-modified date (IST)."],
  ["lk", "The other clearances and the land, as the form declares them. The value is null when the form has not yet been read for these questions, and 0 when the form answers every question and declares none of them. Otherwise it is an object holding only the parts declared. f is forest clearance [proposal no, status, ha applied, ha diverted, approved on]; w, the wildlife board [protected area, status, proposal no]; a, forest land additionally sought, as filed and without a unit; e, an eco-sensitive zone; p, a protected area; c, a coastal regulation zone [1, class]; and t, the land [[type, owner, acquisition status]]. u lists by letter (f, w, e, p, c) the questions the form left blank, which are counted as unknown."],
  ["cf", "Whether the application form was read. ok means it was read and placed the proposal; nogeo, it was read and names no place; none, the portal answered and serves no form; pend, the form has not yet been read."],
];

const ENDPOINTS: [string, string][] = [
  ["GET /api/instruments/consent/search", "Search the whole register: q, state, district, sector, category, stage, located=1, displacement=1, offset, limit (up to 200)."],
  ["GET /api/instruments/consent/proposals.csv", "The register as CSV, for all of India, for one state with ?state=<slug> or for one district with ?district=<census code>. It is served in parts of 8,000 rows, requested with &part=2 and so on; the X-Parts header gives the number of parts and a Link header names the next one."],
  ["GET /api/instruments/consent/changes", "Change log events as JSON, filtered by kind (repeatable), state, district, sector, category, scheduled=1 (districts wholly or partly scheduled), days (7, 30 or 60) or since=YYYY-MM-DD. after=<ISO time> returns only events that first appeared in a later build. Each answer includes stamp, the time the log was built, which a client can store and send back as after to receive only what is new."],
  ["GET /api/instruments/consent/changes.csv", "The same selection as CSV, with every event, in parts of 8,000 rows (&part=N)."],
  ["GET /instruments/consent/feed", "The same selection as an Atom feed, which a feed reader can follow for any district, State, sector or Scheduled Area view."],
  ["GET /api/instruments/consent/status", "Current stage of up to 100 proposals: ?ids=1,2,3."],
  ["POST /api/instruments/consent/export", "One proposal's profile as a PDF, as requested from this site's pages."],
];

type Source = { name: string; publisher?: string; url?: string };

const CC_BY = "https://creativecommons.org/licenses/by/4.0/";
const CC_BY_NC_SA = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
/** Files carrying Census and SECC values from SHRUG, which is CC BY-NC-SA 4.0. */
const SHRUG_FILES = ["districts.json", "subdistricts.json"];

/**
 * schema.org Dataset for this page, the published files' landing page.
 *
 * Google reads Dataset markup for Dataset Search only (not for web results),
 * which is where a researcher looking for India's clearance register as data
 * looks. Everything is read from meta.json at build time - the span from the
 * rows, the sources as the build recorded them - so it cannot state a date or
 * a source the files do not carry. Each download names its own licence,
 * because the two files holding SHRUG's figures keep SHRUG's terms.
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
      "Every proposal in India's environmental clearance register (PARIVESH), placed where possible in the Census 2011 district and sub-district its application names, with its stage, dated appraisal history and time to decision. Each is joined to the Census 2011, Village Directory and SECC profile of the place and to the district's Scheduled Area determination. The files are rebuilt nightly from the register, with contact details removed.",
    url: `${SITE_URL}/instruments/consent/data`,
    isAccessibleForFree: true,
    license: [CC_BY, CC_BY_NC_SA],
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
      license: SHRUG_FILES.includes(file) ? CC_BY_NC_SA : CC_BY,
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
          description: "The files People & Consent publishes and the endpoints that query across them.",
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
            The data behind these pages
          </h1>
          <p className="font-body text-[15px] leading-relaxed max-w-3xl opacity-85 mb-3">
            Every figure on these pages is built from the files listed here,
            which are published exactly as the pages use them. They are plain
            JSON at stable addresses under{" "}
            <code>/data/instruments/consent/</code>, need no key and can be
            cached. The files drawn from the environmental clearance register
            are rebuilt every night, while the Census, boundary and legal files
            change only when they are revised. The endpoints below answer
            questions that no single file can, such as a search across India,
            the change log and CSV downloads.
          </p>
          <p className="font-body text-[13.5px] leading-relaxed max-w-3xl opacity-75 mb-3">
            Each source keeps its own terms. The register is published by the
            Ministry of Environment, Forest and Climate Change, the Census
            figures come through SHRUG from the Development Data Lab, and the
            boundaries come from datameet. The way each is read and checked is
            set out in the{" "}
            <Link href="/instruments/consent/methodology" className="underline underline-offset-2">methodology</Link>.
            {read ? ` These files were last built ${new Date(read).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}.` : ""}
          </p>
          <p className="font-body text-[13.5px] leading-relaxed max-w-3xl opacity-75 mb-10">
            Licence: what this project adds to these files is published under{" "}
            <a href={CC_BY} className="underline underline-offset-2">CC BY 4.0</a>
            , so it may be reused for any purpose, commercial use included,
            with credit to Whitespace India and a link to this page. The two
            exceptions are <code>{SHRUG_FILES.join(" and ")}</code>, which carry
            Census and SECC figures taken from SHRUG and keep its licence,{" "}
            <a href={CC_BY_NC_SA} className="underline underline-offset-2">CC BY-NC-SA 4.0</a>
            . Under that licence they may be used for non-commercial purposes
            only, and anything built from them must be shared on the same
            terms. Records taken from the register remain under their
            publisher&rsquo;s terms.
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

          <h2 className="font-headline font-bold text-[24px] mb-2">Proposal files, column by column</h2>
          <p className="font-body text-[13.5px] opacity-80 max-w-3xl mb-3">
            Each proposal file, or shard, holds the proposals filed in one
            state, which may differ from the state where a project would be
            built. The proposals are stored as arrays under a header named{" "}
            <code>fields</code>. A column&rsquo;s position in that header is
            not guaranteed, so each column is best located by its name.
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
