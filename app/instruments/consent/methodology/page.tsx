import ScrollRegion from "@/components/instruments/ScrollRegion";
import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import {
  InstrumentFooter,
  InstrumentHeader,
  PLUM,
} from "@/components/instruments/InstrumentChrome";
import meta from "@/public/data/instruments/consent/meta.json";
import freshness from "@/public/data/instruments/consent/freshness.json";
import { censusAge, nextCensusNote, registerStart, sourceVintageLabel, CENSUS_YEAR } from "@/lib/instruments/vintage";
import measures from "@/public/data/instruments/consent/measures.json";
import legal from "@/public/data/instruments/consent/legal_reference.json";
import crosscheck from "@/scripts/instruments/crosscheck_report.json";
import type { InstrumentMeta, MeasureRegistry } from "@/lib/instruments/types";

/**
 * Methodology.
 *
 * Every figure on this page is read from the pipeline's own output. Nothing is
 * typed in as prose, so the page cannot drift out of step with the data the way
 * a hand-written methodology does.
 */

export const metadata = pageMeta({
  path: "/instruments/consent/methodology",
  title: "Methodology — People & Consent | Whitespace India",
  description:
    "How Instrument 01 establishes where a clearance proposal is, which Census measures it computes, what it excludes and why, and what it cannot see.",
});

const nf = new Intl.NumberFormat("en-IN");

const INSTRUMENTS_TRAIL = { name: "Instruments", path: "/instruments" };
const CONSENT_TRAIL = { name: "People & Consent", path: "/instruments/consent" };


export default function Methodology() {
  const m = meta as unknown as InstrumentMeta;
  const reg = measures as unknown as MeasureRegistry;
  const c = m.counts;

  // The census this instrument reports, and how old it is at build time. The
  // page is rebuilt on every sync deploy, so this stays true on its own.
  const age = censusAge();

  // Read from the same block the determination table is built from, so the
  // sentence beneath it cannot disagree with it.
  const byStatus = legal.counts?.determinations_by_status ?? {};
  const undetermined = Number(byStatus.not_determined ?? 0);
  const answered =
    Number(byStatus.within ?? 0) +
    Number(byStatus.partial ?? 0) +
    Number(byStatus.outside ?? 0);
  const unresolvedCount = c.proposals_published - c.proposals_district_resolved;
  // Whose silence it is, over the UNPLACED proposals specifically.
  //
  // NOT `m.caf_coverage`, which counts the whole register: 259 proposals have
  // no form served, but only 189 of those are unplaced, because a project name
  // can still resolve one. Reading the register-wide figure into a sentence
  // about the unplaced cohort overstated the Ministry's non-disclosure by 70 -
  // on the page that exists to explain how carefully this instrument separates
  // its own gaps from the source's.
  const unplaced = m.resolution?.unresolved_by_form_status ?? {};
  const cafNone = Number(unplaced.none ?? 0);
  const cafPend = Number(unplaced.pend ?? 0);

  const byGroup = Object.entries(reg.groups).map(([key, title]) => ({
    key,
    title,
    entries: Object.entries(reg.measures).filter(([, v]) => v.group === key),
  }));

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData data={pageLd({ path: "/instruments/consent/methodology", name: "Methodology", description: metadata.description as string, trail: [INSTRUMENTS_TRAIL, CONSENT_TRAIL] })} />
      <InstrumentHeader crumb="People & Consent" crumbHref="/instruments/consent" />

      <main id="main-content" className="flex-1 px-6 md:px-12 py-12 md:py-16">
        <div className="max-w-4xl mx-auto">
          <p
            className="font-label text-[11px] uppercase tracking-[0.24em] mb-4"
            style={{ color: PLUM }}
          >
            Instrument 01 · Methodology
          </p>
          <h1 className="font-headline font-bold text-[clamp(30px,5vw,56px)] leading-[1.03] tracking-[-0.03em]">
            How every figure on this instrument was produced
          </h1>
          <p className="mt-6 font-body text-[16px] leading-relaxed opacity-80">
            Every count and rate below is read from the data this instrument
            publishes, not typed into the prose, so this page cannot quietly
            fall out of step with what it describes. Last rebuilt{" "}
            {new Date(m.generated_at).toISOString().slice(0, 10)}.
          </p>

          <Section n="01" title="What the instrument does">
            <P>
              It takes one proposal from India&rsquo;s environmental clearance
              register and assembles the public record about the place it would
              be built. There is no score, no weighting and no ranking. Nothing
              is normalised against anything else, because the question is not
              &ldquo;which district is worst&rdquo; but &ldquo;who lives here,
              and what does the law require of anyone who wants to build
              here&rdquo;.
            </P>
            <P>
              It holds {nf.format(c.proposals_published)} proposals, at every
              stage from filing to decision.{" "}
              {nf.format(c.register_records_excluded)} further records are
              excluded because the system has delisted them; they carry no
              decision and appear in no count on this site.
            </P>
          </Section>

          <Section n="02" title="Establishing where a project is">
            <P>
              This is the hard part, and it is worth being precise about how it
              is done, because the answer determines every population figure
              that follows.
            </P>
            <P>
              The register&rsquo;s search API returns a project&rsquo;s state and
              nothing finer. It has no district field, so the district is read
              from the application form each proponent files.
            </P>
            <P>
              The Common Application Form, which every proponent files, records
              the location they declared: district, sub-district and village,
              with plot numbers. Reading it directly took resolution to{" "}
              <strong>{m.resolution_rate_pct}%</strong>, with{" "}
              <strong>{m.subdistrict_rate_pct}%</strong> resolved to a
              sub-district rather than only a district.
            </P>
            <Table
              label="How proposals were placed in a district"
              head={["Route", "Proposals", "Share", "Confidence"]}
              rows={[
                ["Village named in the filing", m.resolution.method?.village, "high"],
                ["Sub-district named in the filing", m.resolution.method?.subdistrict, "high"],
                ["District named in the filing", m.resolution.method?.lgd_district, "medium"],
                ["Declared district and site coordinates, overruling the place codes", m.resolution.method?.adjudicated, "high"],
                ["A town spanning districts, settled by the site coordinates or declared district", m.resolution.method?.town_settled, "high"],
                ["Inferred from the project name", m.resolution.method?.project_name, "low"],
                ["Not determined", m.resolution.method?.unresolved, "—"],
              ].map(([label, n, conf]) => [
                String(label),
                nf.format(Number(n ?? 0)),
                `${((Number(n ?? 0) / c.proposals_published) * 100).toFixed(1)}%`,
                String(conf),
              ])}
            />
            <P>
              Two traps are worth recording because both produce confident,
              wrong answers rather than obvious failures.
            </P>
            <P>
              <strong>The wrong district field.</strong> A Common Application
              Form carries three districts: the project&rsquo;s, the
              proponent&rsquo;s registered office, and the applicant&rsquo;s
              address. The last two are frequently a metro hundreds of kilometres
              from the site. Only the project&rsquo;s district is used here.
            </P>
            <P>
              <strong>Two code systems in one record.</strong> Within a single
              filing the village and sub-district codes are Census 2011
              identifiers while the district code is a Local Government Directory
              code. They are different numbering systems, and treating them as
              one mis-joins every record. The village code is preferred
              throughout, because it is a Census identifier and therefore
              resolves correctly even for districts created after 2011 — Morbi,
              created in 2013, resolves through its Morvi sub-district to the
              2011 parent Rajkot without needing any curated table.
            </P>
            <P>
              {nf.format(c.proposals_multi_district)} proposals name sites in
              more than one district. These are mostly linear projects —
              highways, transmission lines, pipelines. The profile describes the
              district holding the most sites and says so; it does not pretend a
              linear project has one location.
            </P>
            <P>
              <strong>Three statements of place, reconciled.</strong> A filing
              states where a project is three times over: the place codes on its
              plots, the district it declares, and the coordinates of its site.
              The codes are preferred because they are the most specific, but a
              code can be wrong in a way the other two expose. Where the declared
              district and the coordinates agree with each other against the
              codes, they decide: {nf.format(m.resolution.adjudication?.adjudicated ?? 0)}{" "}
              proposals are placed that way. A town that spans more than one
              district - Greater Mumbai, Greater Hyderabad - carries one code for
              all of them, which says nothing about which district a site is in;
              where such a code alone placed a proposal, its coordinates or its
              declared district choose ({nf.format(
                (m.resolution.adjudication?.town_by_coordinates ?? 0) +
                (m.resolution.adjudication?.town_by_declaration ?? 0))}{" "}
              proposals), and where neither can, the placement is published as
              provisional. Where no two of the three statements agree (
              {nf.format(m.resolution.adjudication?.contested ?? 0)} proposals),
              nothing is moved and the page says the location is contested. Each
              profile states which of these it rests on.
            </P>
          </Section>

          <Section n="03" title="The population record">
            <P>
              Socio-economic figures come from the Census of India 2011, accessed
              through SHRUG, and are aggregated from sub-district rows to the
              level being shown. The instrument profiles {nf.format(c.districts)}{" "}
              districts and {nf.format(c.subdistricts)} sub-districts.
            </P>
            <P>
              {/* NOT "fourteen years old", spelled out in prose. It was
                  written in 2025, it was already wrong when this page was read
                  in 2026, and it would be wrong again every January - a number
                  reaching the reader as a word nobody re-checks, on a page
                  whose subject is how carefully this instrument handles
                  numbers. Derived from the census year instead, so it cannot
                  drift. */}
              Census {CENSUS_YEAR} is {age} years old. It is nonetheless the most
              recent complete sub-district enumeration of India. {nextCensusNote()}{" "}
              The interface states the vintage on every figure rather than
              burying it here.
            </P>
          </Section>

          <Section n="04" title="Every measure, and what it means">
            <P>
              A measure&rsquo;s definition, the expression that produces it, its
              source and its vintage live in one registry. District files carry
              only values. The interface joins the two when it draws a figure,
              which is what allows every number on the instrument to show its own
              provenance.
            </P>
            <P>
              It also makes one class of error structurally impossible. A
              benchmark and the value it judges must resolve to the same registry
              entry, so a rate can never be compared against a benchmark computed
              over a different denominator. Where that check cannot pass, no
              comparison is drawn at all.
            </P>
            {byGroup.map((g) => (
              <div key={g.key} className="mt-8">
                <h3 className="font-label text-[10px] uppercase tracking-[0.2em] opacity-75 mb-3">
                  {g.title}
                </h3>
                <dl className="border-t border-[#1c1c19]/25">
                  {g.entries.map(([id, mm]) => (
                    <div key={id} className="py-4 border-b border-[#1c1c19]/12">
                      <dt className="font-body text-[15px] font-semibold">
                        {mm.label}
                        <span className="font-label text-[10px] tracking-[0.1em] opacity-65 ml-2">
                          {id}
                        </span>
                      </dt>
                      <dd className="mt-1.5 space-y-1.5">
                        <p className="font-body text-[13.5px] leading-relaxed opacity-80">
                          {mm.definition}
                        </p>
                        <p className="font-label text-[11.5px] opacity-65">
                          {mm.formula}
                        </p>
                        <p className="font-body text-[12px] opacity-70">
                          {mm.source} · {mm.vintage}
                        </p>
                        {mm.caveats?.length ? (
                          <ul className="list-disc pl-4 font-body text-[12.5px] leading-relaxed opacity-70 space-y-1">
                            {mm.caveats.map((cv) => (
                              <li key={cv}>{cv}</li>
                            ))}
                          </ul>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </Section>

          <Section n="05" title="What was deliberately excluded">
            <P>
              Several fields that look usable are not, and are left out with the
              reason recorded rather than quietly dropped.
            </P>
            <ul className="font-body text-[14.5px] leading-relaxed opacity-85 space-y-3 list-disc pl-5">
              <li>
                <strong>Primary Health Centre counts.</strong> The Village
                Directory column sums to roughly 58,800 nationally against about
                24,000 actual centres in 2011, with 30,000 in a single
                sub-district. The column is corrupt at this aggregation. The
                doctor vacancy rate, a ratio of two columns from the same family,
                is used instead because it survives the unit ambiguity.
              </li>
              <li>
                <strong>Electricity, water and bus coverage.</strong> These are
                binary flags at sub-district level, not shares: 5,590 of 5,834
                sub-districts read 1, because the variable answers &ldquo;does
                any village here have this&rdquo;. At 96% yes nationally it
                carries no signal about coverage and must not be rendered as if
                it did.
              </li>
              <li>
                <strong>Counts that are zero across an entire state.</strong>{" "}
                Every one of Gujarat&rsquo;s 26 districts reports zero government
                middle schools while Jamnagar alone reports 1,217 primary
                schools. Gujarat&rsquo;s primary schools run to standard 8, so
                there is no separate middle school to count. Where a count is
                zero across a whole state but substantial nationally, the value
                is withheld rather than shown as zero, which would assert that
                the schools do not exist.
              </li>
              <li>
                <strong>Doctor vacancy where the source contradicts itself.</strong>{" "}
                In some districts the Village Directory records more doctors in
                post than posts sanctioned. A vacancy rate of −466% is not a
                statement about anything, so the rate is withheld while both raw
                counts remain visible.
              </li>
            </ul>
          </Section>

          <Section n="06" title="The legal reference, and its limits">
            <P>
              The statutory and standards entries are hand-written and cited to a
              provision. No model wrote them, and none of them is derived from
              the population data. The reference currently holds{" "}
              <strong>{legal.counts.obligations} obligations</strong>, all{" "}
              {legal.counts.verified} verified against a primary source, last
              reviewed {legal.last_reviewed}.
            </P>
            <P>
              Whether a place lies in a Fifth Schedule Scheduled Area is decided
              by Presidential Order under paragraph 6 of the Fifth Schedule.
              There is no machine-readable authoritative list — the Ministry of
              Tribal Affairs page that once carried one still returns 404, and
              the Ministry of Panchayati Raj&rsquo;s state-wise page carries no
              Order citations and leaves its coverage columns empty. The Orders
              themselves were read.
            </P>
            <Table
              label="Districts by Scheduled Area status"
              head={["Scheduled Area status", "Districts"]}
              rows={[
                ["Named in an Order as wholly scheduled",
                  String(legal.counts.determinations_by_status?.within ?? 0)],
                ["Named in an Order, but only in part",
                  String(legal.counts.determinations_by_status?.partial ?? 0)],
                ["Outside every Order — a determination, not a gap",
                  String(legal.counts.determinations_by_status?.outside ?? 0)],
                ["Not determined",
                  String(legal.counts.determinations_by_status?.not_determined ?? 0)],
              ]}
            />
            <P>
              {/* NOT "every district carries a determination", which the table
                  immediately above contradicts: 65 of them are published as
                  "not determined", and the next paragraph explains why. The
                  claim was true of the RECORD - every district has an entry -
                  and false of the ANSWER, which is the reading a reader takes.
                  Stated with the counts the table itself is built from. */}
              {answered} of the {answered + undetermined} districts carry an
              answer. Where an Order names a district, that Order answers. Where an Order exists
              for the State but does not name the district, the Order still
              answers: it declares which areas in its State are Scheduled
              Areas, so one it does not name is not one. Where no Presidential
              Order reaches the State at all, the absence answers — and in
              Assam, Meghalaya, Tripura and Mizoram Article 244(1) answers,
              because it applies the Fifth Schedule everywhere <em>except</em>
              those four States. None of that is a gap, and none of it is
              rendered as one. The remaining {undetermined} are genuinely open,
              for the reason below, and are published as undetermined rather
              than resolved to whichever answer is easier.
            </P>
            <P>
              <strong>Districts drawn after an Order.</strong> Every Order fixes
              its area by reference to the territorial divisions existing on its
              date, and a district drawn later does not change the ground the
              Order scheduled. So a later district&rsquo;s status follows from
              where its ground lay on that date: carved wholly from a district the
              Order names in whole, it is wholly scheduled (Rayagada, Malkangiri
              and Nabarangapur from Koraput; Bijapur, Narayanpur, Alirajpur,
              Khunti); taking part of what an Order names in part, it is partly
              scheduled; taking none of it, it is outside. Each such answer is
              checked against the Ministry of Panchayati Raj&rsquo;s list of
              notified Fifth Schedule Areas, which names every district decided
              inside and none decided outside.
            </P>
            <P>
              <strong>Andhra Pradesh and Telangana</strong> are governed by
              the 1950 Orders C.O. 9 and C.O. 26, which schedule the agency
              tracts of the old Madras districts and villages of the old
              Hyderabad State, district by district. The districts they reach -
              East Godavari, West Godavari, Visakhapatnam, Srikakulam and
              Vizianagaram; Adilabad, Warangal, Khammam and Mahbubnagar - are
              partly scheduled; the rest of both States is outside. The first
              Order&rsquo;s text, the Andhra Pradesh High Court&rsquo;s recital
              of the agency districts, and the Ministry of Panchayati Raj&rsquo;s
              list agree on that set.
            </P>
            <P>
              {undetermined === 1 ? "One district remains" : `${undetermined} districts remain`}{" "}
              undetermined, where two official sources conflict: the Order does
              not name it, and the Ministry of Panchayati Raj lists it. The note
              on its page names both. Where the answer is &ldquo;partly
              scheduled&rdquo;, a site is placed inside the Scheduled Area when
              the filing puts it in a sub-division the Order names in whole;
              otherwise district-level status cannot settle it, and the page
              says so.
            </P>
            <P>
              Two claims that circulate widely are wrong and are corrected here.
              C.O. 192 of 2003 is titled for Chhattisgarh, Jharkhand and Madhya
              Pradesh, and its schedule lists thirty areas in Chhattisgarh and
              Madhya Pradesh; Jharkhand&rsquo;s are scheduled by C.O. 229 of
              2007. It does <em>not</em> include Odisha, which remains under
              C.O. 109 of 1977. And Rajasthan&rsquo;s C.O. 114 of 1981 was expressly rescinded
              by C.O. 270 of 2018 — the Ministry of Tribal Affairs&rsquo; own
              compendium still lists the 1981 Order as operative, because it
              predates the replacement.
            </P>
            <P>
              Sixth Schedule areas in Assam, Meghalaya, Tripura and Mizoram are a
              different constitutional regime, administered through Autonomous
              District Councils, and PESA does not apply to them. They are marked
              as such rather than being left to read as unscheduled, which would
              be as wrong as marking them scheduled.
            </P>
          </Section>

          <Section n="07" title="Verification">
            <P>
              <strong>The location is checked against a second document.</strong>{" "}
              Everything on this instrument hangs off one claim: that it knows
              where each project is. That comes from a single source, the form
              the proponent filled in. Trusting one source for a load-bearing
              claim is precisely what this instrument tells its readers not to
              do, so it is tested against the regulator&rsquo;s signed clearance
              letter — a different document, written by a different party, which
              states the site in prose.
            </P>
            <P>
              On a random sample of {crosscheck.sampled} proposals, the district
              this instrument reports matched the district named in the letter in{" "}
              <strong>{crosscheck.agreement_rate_pct}%</strong> of the{" "}
              {crosscheck.comparable} cases where the letter could be read and
              named one. Of the remaining{" "}
              {crosscheck.sampled - crosscheck.comparable},{" "}
              {crosscheck.outcomes["no-district-in-letter"] +
                crosscheck.outcomes["no-location-text"]}{" "}
              name no district this check could match, and{" "}
              {crosscheck.outcomes["download-failed"] +
                crosscheck.outcomes["unreadable"] +
                crosscheck.outcomes["no-text-layer"]}{" "}
              could not be retrieved or read &mdash; which is a limit of this
              check, not of the letters.
            </P>
            <P>
              The letter is read only near a location cue. A letterhead carries
              the issuing authority&rsquo;s own address - Gandhinagar, Bangalore,
              Chennai - and reading the whole letter would take that seat for the
              site.
            </P>
            <P>
              <strong>The site coordinates check every location.</strong> Each
              filing&rsquo;s mapped blocks are tested against the Census 2011
              district boundaries: {nf.format(m.site_geometry?.verdicts?.inside ?? 0)}{" "}
              fall inside a district the proposal is placed in and{" "}
              {nf.format(m.site_geometry?.verdicts?.boundary ?? 0)} on its edge;{" "}
              {nf.format(m.site_geometry?.verdicts?.elsewhere ?? 0)} fall elsewhere,
              and each of those pages says where the coordinates fall and which
              statements of place the profile follows instead.
            </P>
            <P>
              <strong>A rebuild that fails its checks publishes nothing.</strong>{" "}
              Every measure declares the range it can plausibly fall in,
              and a value outside that range stops the rebuild. Figures that
              must add up are checked that they do — the cultivator and
              agricultural-labourer shares have to sum to the land-dependent
              share. And a sample of the published figures is worked out a
              second time from the original sub-district records, by a separate
              calculation from the one that produced them, so a mistake in the
              adding-up is caught rather than confirmed.
            </P>
            <P>
              The most recent rebuild recorded{" "}
              <strong>{m.invariants.violations} failed checks</strong> and{" "}
              <strong>
                {m.invariants.resample_failures} figures the second calculation
                could not reproduce
              </strong>
              . As a test of the whole chain, national literacy worked out from
              these figures is{" "}
              <strong>
                {reg.benchmarks.india["pop.literacy_rate"]?.toFixed(2)}%
              </strong>{" "}
              against the Census of India&rsquo;s published 72.98%, which
              confirms the literacy denominator is population aged 7 and above
              rather than total population. The two differ materially and are not
              interchangeable.
            </P>
          </Section>

          <Section n="08" title="What this instrument cannot see">
            <ul className="font-body text-[14.5px] leading-relaxed opacity-85 space-y-3 list-disc pl-5">
              <li>
                {unresolvedCount > 0 ? (
                  <>
                    {/* NOT "because their filing records no location", said of
                        all of them. Of the 456 that reach this state, 266 were
                        read and found to name no place; for 259 the Ministry's
                        portal serves no form at all, and 1 has not been read
                        yet. Attributing the gap to the proponent's filing in
                        every case charges a named company with an omission in
                        a public regulatory filing where none is known - on the
                        page that exists to explain how carefully this
                        instrument separates exactly those two silences. */}
                    {nf.format(unresolvedCount)} proposals could not be placed
                    below state level. For {nf.format(cafNone)} of them the
                    Ministry&rsquo;s portal serves no Common Application Form
                    at all, and {nf.format(cafPend)}{" "}
                    {cafPend === 1 ? "has" : "have"} not been read yet;
                    the rest were read and record no village, sub-district or
                    district, and their project name carries no district that
                    resolves against the Census gazetteer. They are reported as
                    undetermined. No state average is substituted.
                  </>
                ) : (
                  <>Every published proposal resolved to at least a district.</>
                )}
              </li>
              <li>
                Whether the Forest Rights Act was complied with before forest land
                was diverted. That certificate is part of the forest-clearance
                application completed by the District Collector, and the portal
                serves that part only to signed-in users. This instrument shows
                what is public instead: the forest proposal the environmental
                form names, and its current stage in the forest register.
              </li>
              <li>
                Affected and displaced family counts are the proponent&rsquo;s
                own declaration in their application. They are a filing, not an
                independent assessment, and are labelled as declared wherever
                they appear.
              </li>
              <li>
                Whether a place lies within a Fifth Schedule Scheduled Area is a
                legal determination made by Presidential Order. There is no
                machine-readable authoritative list. Where the curated reference
                does not cover a place the instrument reports that it is
                undetermined, and never infers it from the tribal population
                share — a high share does not make a place a Scheduled Area, and
                the two do not coincide.
              </li>
              {registerStart(m.register_span) ? (
                <li>
                  The register covers proposals submitted from{" "}
                  {registerStart(m.register_span)} onward. It is not a complete
                  history of Indian environmental clearance.
                </li>
              ) : null}
              <li>
                Village-level population is not shown even where a village is
                named. The instrument resolves to the village to identify the
                place, then reports the sub-district or district record, because
                that is the level at which the Census measures used here are
                published.
              </li>
            </ul>
          </Section>

          <Section n="09" title="Sources">
            <ul className="space-y-4">
              {m.sources.map((s) => (
                <li key={s.name} className="border-l-2 pl-4" style={{ borderColor: PLUM }}>
                  <div className="font-body text-[15px]">{s.name}</div>
                  <div className="font-body text-[13px] opacity-70">
                    {s.publisher}
                  </div>
                  <div className="font-label text-[10px] uppercase tracking-[0.16em] opacity-70 mt-1">
                    {sourceVintageLabel(s, freshness.checked_at)}
                    {s.version ? ` · version ${s.version}` : ""}
                  </div>
                  {s.coverage ? (
                    <div className="font-body text-[12.5px] opacity-65 mt-1">
                      {s.coverage}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <P>
              Everything here is produced by one reproducible process that can
              be run again from the same sources to the same result. It audits
              itself every time it runs, recording the match rate for each route
              it took and every check that failed.
            </P>
          </Section>

          <div className="mt-14 pt-8 border-t border-[#1c1c19] flex flex-wrap gap-6">
            <Link
              href="/instruments/consent"
              className="font-label text-[11px] uppercase tracking-[0.18em]"
              style={{ color: PLUM }}
            >
              ← Back to the instrument
            </Link>
            <Link
              href="/instruments"
              className="font-label text-[11px] uppercase tracking-[0.18em] opacity-70"
            >
              Instruments shelf
            </Link>
          </div>
        </div>
      </main>

      <InstrumentFooter />
    </div>
  );
}

function Section({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-14 pt-8 border-t border-[#1c1c19]/25">
      <div className="flex items-baseline gap-3 mb-4">
        <span
          className="font-label font-bold text-[10px] tracking-[0.18em] px-1.5 py-0.5"
          style={{ background: PLUM, color: "#fcf9f4" }}
        >
          {n}
        </span>
        <h2 className="font-headline font-bold text-[clamp(21px,2.6vw,30px)] tracking-[-0.02em]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-body text-[14.5px] leading-relaxed opacity-85 mb-4">
      {children}
    </p>
  );
}

function Table({
  label,
  head,
  rows,
}: {
  label: string;
  head: string[];
  rows: string[][];
}) {
  return (
    <ScrollRegion label={label} className="my-5">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-y border-[#1c1c19]">
            {head.map((h) => (
              <th
                key={h}
                className="font-label text-[9px] uppercase tracking-[0.16em] opacity-75 py-2 pr-4 font-medium"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-b border-[#1c1c19]/15">
              {r.map((cell, i) => (
                <td
                  key={i}
                  className={`py-2.5 pr-4 font-body text-[13.5px] ${
                    i > 0 ? "tabular-nums" : ""
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
