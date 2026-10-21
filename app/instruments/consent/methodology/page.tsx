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
 * The register, placement and check counts on this page are read from the
 * pipeline's own output, so they cannot drift out of step with the data. The
 * worked examples in sections 05 and 06 and the literacy benchmark in 07 are
 * typed, and the opening paragraph says so.
 */

export const metadata = pageMeta({
  path: "/instruments/consent/methodology",
  title: "Methodology | People & Consent",
  description:
    "How People & Consent places each environmental clearance proposal in a district, which Census measures it computes, which fields it leaves out and why, and where its evidence ends.",
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
            Methodology
          </p>
          <h1 className="font-headline font-bold text-[clamp(30px,5vw,56px)] leading-[1.03] tracking-[-0.03em]">
            How People &amp; Consent&rsquo;s figures were produced
          </h1>
          <p className="mt-6 font-body text-[16px] leading-relaxed opacity-80">
            The counts and rates on this page that describe the register,
            the placement of proposals and the checks are read from the data
            the instrument publishes, so they change whenever the data does.
            The worked examples from the Census and the legal citations are
            stated as fixed facts about those sources. The data was last
            rebuilt on {new Date(m.generated_at).toISOString().slice(0, 10)}.
          </p>

          <Section n="01" title="What the instrument does">
            <P>
              The instrument takes one proposal from India&rsquo;s
              environmental clearance register and assembles the public record
              about the place where it would be built. It asks who lives there
              and what the law requires of a project in that place, a question
              about one site that needs no comparison between districts, so the
              instrument gives no score or ranking and applies no weights.
            </P>
            <P>
              It holds {nf.format(c.proposals_published)} proposals, at every
              stage from filing to decision. A further{" "}
              {nf.format(c.register_records_excluded)} records are left out
              because the portal has delisted them. They carry no decision and
              appear in no count on this site.
            </P>
          </Section>

          <Section n="02" title="Establishing where a project is">
            <P>
              Every population figure on a profile depends on where the
              project is placed, so this section sets out the method in
              detail.
            </P>
            <P>
              The finest location the register&rsquo;s search API returns is
              a project&rsquo;s state. It has no district field, so the
              district is read from the application form each proponent
              files.
            </P>
            <P>
              That form, the Common Application Form, records the location
              the proponent declared, with district, sub-district, village and
              plot numbers. Reading it directly places{" "}
              <strong>{m.resolution_rate_pct}%</strong> of proposals in a
              district, and <strong>{m.subdistrict_rate_pct}%</strong> in a
              sub-district as well. The confidence given to each route in the
              table reflects how specific the statement it rests on is: a
              named village or sub-district is the most specific, a district
              named alone is less so, and a district inferred from the project
              name is the least.
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
                ["Not determined", m.resolution.method?.unresolved, "not applicable"],
              ].map(([label, n, conf]) => [
                String(label),
                nf.format(Number(n ?? 0)),
                `${((Number(n ?? 0) / c.proposals_published) * 100).toFixed(1)}%`,
                String(conf),
              ])}
            />
            <P>
              Two features of the form produce answers that look plausible
              and are wrong, which makes them harder to catch than an outright
              failure.
            </P>
            <P>
              <strong>The wrong district field.</strong> A Common Application
              Form carries three districts: the project&rsquo;s, the
              proponent&rsquo;s registered office, and the applicant&rsquo;s
              address. The last two are often a large city hundreds of
              kilometres from the site, so only the project&rsquo;s district is
              used here.
            </P>
            <P>
              <strong>Two code systems in one record.</strong> Within a single
              filing the village and sub-district codes are Census 2011
              identifiers while the district code is a Local Government Directory
              code. The two numbering systems differ, and treating them as one
              would join every record to the wrong place. The village code is
              preferred throughout because it is a Census identifier, and so it
              resolves correctly even for districts created after 2011. Morbi,
              created in 2013, resolves through its Morvi sub-district to its
              2011 parent, Rajkot, with no table of district changes needed.
            </P>
            <P>
              {nf.format(c.proposals_multi_district)} proposals name sites in
              more than one district, and most of them are linear projects
              such as highways, transmission lines and pipelines. Their profile
              describes the primary district, the one named by the most plots
              unless the reconciliation described next moves it, and states
              that the project spans other districts too.
            </P>
            <P>
              <strong>Three statements of place, reconciled.</strong> A filing
              states where a project is in three ways: the place codes on its
              plots, the district it declares and the coordinates of its site.
              The codes are preferred because they are the most specific, but a
              code can be wrong in a way the other two reveal. Where the
              declared district and the coordinates agree with each other
              against the codes, they decide, and{" "}
              {nf.format(m.resolution.adjudication?.adjudicated ?? 0)} proposals
              are placed that way. A town that spans more than one district,
              such as Greater Mumbai or Greater Hyderabad, carries one code for
              all of them, so the code alone cannot say which district a site
              is in. Where such a code was the only basis for a placement, the
              coordinates or the declared district decide (
              {nf.format(
                (m.resolution.adjudication?.town_by_coordinates ?? 0) +
                (m.resolution.adjudication?.town_by_declaration ?? 0))}{" "}
              proposals), and where neither can, the placement is published as
              provisional. Where no two of the three statements agree (
              {nf.format(m.resolution.adjudication?.contested ?? 0)} proposals),
              the proposal stays where its codes put it and its page describes
              the location as contested. Each profile states which of these
              routes it rests on.
            </P>
          </Section>

          <Section n="03" title="The population record">
            <P>
              Socio-economic figures come from the Census of India 2011,
              obtained through SHRUG, and are added up from sub-district rows
              to the level being shown. The instrument profiles {nf.format(c.districts)}{" "}
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
              Census {CENSUS_YEAR} is {age} years old, but it remains the most
              recent census for which complete sub-district figures exist.{" "}
              {nextCensusNote()} Each figure on the profiles states the year of
              its source beside it.
            </P>
          </Section>

          <Section n="04" title="Every measure, and what it means">
            <P>
              Each measure&rsquo;s definition, the formula that produces it,
              its source and the year of that source are kept in one registry,
              and the district files carry only the values. The interface joins
              the two when it draws a figure, which is how every number on the
              instrument can show where it came from.
            </P>
            <P>
              The same design guards against one kind of error. A benchmark
              and the value it is compared with must resolve to the same
              registry entry, so a rate is only ever compared with a benchmark
              computed over the same denominator. Where that check fails, the
              comparison is left out.
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
              Several fields in the source look usable and turn out to be
              unreliable. They are left out, and the reason for each is
              recorded here.
            </P>
            <ul className="font-body text-[14.5px] leading-relaxed opacity-85 space-y-3 list-disc pl-5">
              <li>
                <strong>Primary Health Centre counts.</strong> The Village
                Directory column sums to roughly 58,800 nationally against about
                24,000 actual centres in 2011, with 30,000 in a single
                sub-district, which shows the column is corrupt at this level
                of aggregation. The doctor vacancy rate, a ratio of two columns
                from the same family, is used instead because the ratio holds up
                whatever unit the counts were recorded in.
              </li>
              <li>
                <strong>Electricity, water and bus coverage.</strong> At
                sub-district level these are yes-or-no flags recording whether
                any village has the service, and 5,590 of 5,834 sub-districts
                read 1. With 96% answering yes nationally, the flag says nothing
                about how many people are covered, so it is left off the
                profiles.
              </li>
              <li>
                <strong>Counts that are zero across an entire state.</strong>{" "}
                Every one of Gujarat&rsquo;s 26 districts reports zero government
                middle schools while Jamnagar alone reports 1,217 primary
                schools. Gujarat&rsquo;s primary schools run to standard 8, so
                the state has no separate middle schools to count. Where a count
                is zero across a whole state but substantial nationally, the
                value is withheld, because a zero would tell readers that the
                schools do not exist.
              </li>
              <li>
                <strong>Doctor vacancy where the source contradicts itself.</strong>{" "}
                In some districts the Village Directory records more doctors in
                post than posts sanctioned, which yields impossible rates such
                as −466%. The rate is withheld in those districts and both raw
                counts remain visible.
              </li>
            </ul>
          </Section>

          <Section n="06" id="scheduled-areas" title="The legal reference, and its limits">
            <P>
              Each entry on statutes and standards was transcribed by hand
              from the provision it cites and checked against the primary
              source, and each stands independently of the population data.
              The reference holds{" "}
              <strong>{legal.counts.obligations} obligations</strong>, all{" "}
              {legal.counts.verified} of them verified against a primary
              source, and was last reviewed on {legal.last_reviewed}.
            </P>
            <P>
              Whether a place lies in a Scheduled Area under the Fifth Schedule
              is decided by Presidential Order under paragraph 6 of that
              Schedule. No authoritative list exists in machine-readable form.
              When checked in August 2026, the Ministry of Tribal Affairs page
              that once carried one returned an error (HTTP 404), and the
              Ministry of Panchayati Raj&rsquo;s state-wise page gives no Order
              citations and leaves its coverage columns empty. The Orders
              themselves were therefore read.
            </P>
            <Table
              label="Districts by Scheduled Area status"
              head={["Scheduled Area status", "Districts"]}
              rows={[
                ["Named in an Order as wholly scheduled",
                  String(legal.counts.determinations_by_status?.within ?? 0)],
                ["Named in an Order, but only in part",
                  String(legal.counts.determinations_by_status?.partial ?? 0)],
                ["Outside every Order, which is itself a determination",
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
              {answered} of the {answered + undetermined} districts have a
              determined status, reached in one of four ways. A district an
              Order names takes its status from that Order. Where an Order
              covers the State but omits the district, the omission settles
              it, because the Order lists every Scheduled Area in its State.
              Where no Presidential Order reaches the State, the district lies
              outside any Scheduled Area. In Assam, Meghalaya, Tripura and
              Mizoram, Article 244(1) settles the matter, because it applies
              the Fifth Schedule to Scheduled Areas in every State{" "}
              <em>other than</em> those four. The remaining {undetermined}{" "}
              {undetermined === 1 ? "district is" : "districts are"} published
              as not determined, for the reason given below.
            </P>
            <P>
              <strong>Districts drawn after an Order.</strong> Every Order
              defines its area by the territorial divisions that existed on its
              date, and drawing a new district later leaves the scheduled
              ground unchanged. A later district&rsquo;s status therefore
              follows from where its ground lay on that date. A district carved
              wholly from one the Order names in whole is wholly scheduled, as
              are Rayagada, Malkangiri and Nabarangapur, carved from Koraput,
              and Bijapur, Narayanpur, Alirajpur and Khunti. A district that
              takes in part of an area the Order names is partly scheduled, and
              one that takes in none of it is outside. Each such result is
              checked against the Ministry of Panchayati Raj&rsquo;s list of
              notified Fifth Schedule Areas, which names every district decided
              to be inside and none decided to be outside.
            </P>
            <P>
              <strong>Andhra Pradesh and Telangana</strong> are governed by
              the 1950 Orders C.O. 9 and C.O. 26, which schedule the agency
              tracts of the old Madras districts and villages of the old
              Hyderabad State, district by district. The districts they reach
              are partly scheduled: East Godavari, West Godavari,
              Visakhapatnam, Srikakulam and Vizianagaram in Andhra Pradesh, and
              Adilabad, Warangal, Khammam and Mahbubnagar in Telangana. The
              rest of both States is outside. The text of C.O. 9, the Andhra
              Pradesh High Court&rsquo;s list of the agency districts and the
              Ministry of Panchayati Raj&rsquo;s list all name the same
              set.
            </P>
            <P>
              {undetermined === 1
                ? "One district remains undetermined because two official sources conflict over it: the Order does not name it, while the Ministry of Panchayati Raj lists it."
                : `${undetermined} districts remain undetermined because two official sources conflict over them: the Order does not name them, while the Ministry of Panchayati Raj lists them.`}{" "}
              The note on each such district&rsquo;s page cites both. In a
              partly scheduled district, a site is placed inside the Scheduled
              Area when its filing puts it in a sub-division the Order names in
              whole. In every other case the district&rsquo;s status cannot
              settle the question, and the page says so.
            </P>
            <P>
              Two claims that circulate widely are corrected here. C.O. 192 of
              2003 is titled for Chhattisgarh, Jharkhand and Madhya Pradesh,
              and its schedule lists thirty areas in Chhattisgarh and Madhya
              Pradesh, while Jharkhand&rsquo;s areas are scheduled by C.O. 229
              of 2007. Odisha lies outside C.O. 192 and remains under C.O. 109
              of 1977. Rajasthan&rsquo;s C.O. 114 of 1981 was expressly
              rescinded by C.O. 270 of 2018, although the Ministry of Tribal
              Affairs&rsquo; own compendium, compiled before 2018, still lists
              the 1981 Order as operative.
            </P>
            <P>
              Sixth Schedule areas in Assam, Meghalaya, Tripura and Mizoram
              fall under a separate constitutional regime, administered through
              Autonomous District Councils, and the Panchayats (Extension to
              Scheduled Areas) Act, 1996 (PESA) does not apply to them. They
              carry their own label, distinct from both scheduled and
              unscheduled.
            </P>
          </Section>

          <Section n="07" title="Verification">
            <P>
              <strong>The location is checked against a second document.</strong>{" "}
              Everything on this instrument depends on knowing where each
              project is, and that knowledge comes from a single source, the
              form the proponent filled in. The placement is therefore tested
              against the regulator&rsquo;s signed clearance letter, a separate
              document written by a different party, which describes the site
              in prose.
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
              could not be retrieved or read. Those failures reflect the
              limits of the check itself, and they say nothing about the
              letters.
            </P>
            <P>
              Only the text near a location cue in the letter is read. A
              letterhead carries the issuing authority&rsquo;s own address, such
              as Gandhinagar, Bangalore or Chennai, and reading the whole letter
              would mistake that city for the site.
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
              Every measure declares the range it can plausibly fall in, and a
              value outside that range stops the rebuild. Figures that must add
              up are checked, so the cultivator and agricultural labourer
              shares have to sum to the land-dependent share. A sample of the
              published figures is also worked out a second time from the
              original sub-district records by a separate calculation, which
              catches a mistake in the first.
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
              against the Census of India&rsquo;s published 72.98%. The match
              is consistent with a literacy denominator of the population aged
              7 and above, which is the Census definition; computed over the
              total population, the rate would be materially lower.
            </P>
          </Section>

          <Section n="08" id="time-to-decision" title="Time to decision and the change log">
            <P>
              The time a proposal took to be decided is measured from the first
              step in its appraisal history, the dated record of steps the
              portal keeps for each proposal, to the step at which the
              authority granted or refused what was applied for. The
              register&rsquo;s own submission date is published beside it but
              never measured from, because it moves forward whenever a proposal
              is submitted again. Days on which the portal had a proposal
              automatically delisted are subtracted and published separately,
              so the first filing date plus the days to decision plus the days
              delisted equals the decision date on every decided proposal.
            </P>
            <P>
              The source timestamps are in UTC and are converted to India
              Standard Time before a date is taken. The change log dates each
              event by the same history: a filing or a decision by the end of
              its step, and a query, closure or other step by its start. Each
              event also records the build in which it first appeared, so a
              reader following the log can ask for everything that is new since
              a previous visit, including steps the portal recorded late.
            </P>
          </Section>

          <Section n="09" title="Limits of the evidence">
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
                    in any district. For {nf.format(cafNone)} of them the
                    Ministry&rsquo;s portal serves no Common Application Form
                    at all, and {nf.format(cafPend)}{" "}
                    {cafPend === 1 ? "has" : "have"} not been read yet. The
                    rest were read and record no village, sub-district or
                    district, and their project names contain no district that
                    matches the Census gazetteer. They are reported as
                    undetermined, and their profiles show no state averages in
                    place of district figures.
                  </>
                ) : (
                  <>Every published proposal resolved to at least a district.</>
                )}
              </li>
              <li>
                The record of whether the Forest Rights Act was complied with
                before forest land was diverted lies outside the public data.
                That certificate is part of the forest clearance application
                completed by the District Collector, and the portal serves that
                part only to signed-in users. The instrument shows the public
                part instead: the forest proposal the environmental form names
                and its current stage in the forest register.
              </li>
              <li>
                Counts of affected and displaced families are the figures each
                proponent declared in its application. They are the
                proponent&rsquo;s own statements, and the pages label them as
                declared wherever they appear.
              </li>
              <li>
                Whether a place lies within a Scheduled Area under the Fifth
                Schedule is a legal determination made by Presidential Order,
                and no authoritative list exists in machine-readable form. Where
                the transcribed Orders do not settle a place, the instrument
                reports its status as not determined. It never infers the status
                from the share of Scheduled Tribes in the population, because a
                Scheduled Area exists only where an Order creates one, and a
                place&rsquo;s tribal share does not decide whether it does.
              </li>
              {registerStart(m.register_span) ? (
                <li>
                  The register as this instrument reads it begins with
                  proposals submitted in {registerStart(m.register_span)}, so
                  it covers only the recent part of the history of
                  environmental clearance in India.
                </li>
              ) : null}
              <li>
                Population figures are shown for the sub-district or district
                even where a village is named. The village identifies the place,
                and the profile then reports the record for the sub-district or
                district, the level at which the Census measures used here are
                published.
              </li>
            </ul>
          </Section>

          <Section n="10" title="Sources">
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
              Everything here is produced by one process that can be run
              again from the same sources. Each run records the match rate for
              every placement route it used and every check that failed.
            </P>
          </Section>

          <div className="mt-14 pt-8 border-t border-[#1c1c19] flex flex-wrap gap-6">
            <Link
              href="/instruments/consent"
              className="font-label text-[11px] uppercase tracking-[0.18em]"
              style={{ color: PLUM }}
            >
              ← Back to People &amp; Consent
            </Link>
            <Link
              href="/instruments"
              className="font-label text-[11px] uppercase tracking-[0.18em] opacity-70"
            >
              All instruments
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
  id,
  title,
  children,
}: {
  n: string;
  /** Anchor for links from other pages. */
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-14 pt-8 border-t border-[#1c1c19]/25">
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
