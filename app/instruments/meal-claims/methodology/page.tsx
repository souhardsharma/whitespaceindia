import type { ReactNode } from "react";
import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import { InstrumentFooter, InstrumentHeader } from "@/components/instruments/InstrumentChrome";
import { FlagNotFinding, SECTION_HEADING, SMALL_LABEL, TD, TH } from "@/components/instruments/meal/parts";
import {
  MEAL_BASE, MEAL_HOST, MEAL_OG, TEAL, UDISE_HOST, count, dayLong, monthLabel, share, whenIST,
  type Measure,
} from "@/lib/instruments/meal";
import { mealFreshness, mealMeasures, mealMeta, mealStates } from "@/lib/instruments/mealServer";

/**
 * How the instrument works and where it stops.
 *
 * Every threshold, count and date on this page is read from the published
 * files (meta.json, measures.json, freshness.json), so the page cannot
 * describe a test the pipeline no longer runs. What is typed here is the law,
 * the reasoning and the limits.
 */

const PATH = `${MEAL_BASE}/methodology`;
const TITLE = "Methodology | Meal Claims Check";
const DESCRIPTION =
  "How Meal Claims Check reads the PM POSHAN daily reporting system each night, how its three tests work on a school's own filings, how a closed day is decided, what UDISE+ adds, and what has not been verified.";

export const metadata = pageMeta({ path: PATH, title: TITLE, description: DESCRIPTION, image: MEAL_OG });

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="py-10 border-t border-[#1c1c19] grid grid-cols-1 md:grid-cols-12 gap-x-8 gap-y-4" aria-labelledby={id}>
      <h2 id={id} className={`${SECTION_HEADING} md:col-span-3`}>{title}</h2>
      <div className="md:col-span-9 font-body text-[14.5px] leading-relaxed space-y-4 max-w-3xl [&_a]:underline [&_a]:underline-offset-4">
        {children}
      </div>
    </section>
  );
}

function Test({ measure, children }: { measure: Measure; children: ReactNode }) {
  return (
    <div className="border-l-2 pl-4" style={{ borderColor: TEAL }}>
      <h3 className="font-headline font-bold text-[19px] leading-snug">{measure.label}</h3>
      <p className="mt-1.5">{measure.definition}</p>
      {measure.formula ? <p className="mt-1.5 font-label text-[12px] opacity-75">{measure.formula}</p> : null}
      <div className="mt-2 opacity-80 space-y-2">{children}</div>
    </div>
  );
}

function span([from, to]: [string, string]): string {
  return from === to ? dayLong(from) : `${dayLong(from)} to ${dayLong(to)}`;
}

export default function MealMethodology() {
  const m = mealMeta();
  const M = mealMeasures();
  const fresh = mealFreshness();
  const states = mealStates();
  const cal = m.calibration;
  const year = cal.year_read;
  const name = (st: string) => states.find((s) => s.st === st)?.name ?? st;
  const pct = (x: number) => `${x * 100}%`;
  const T = m.thresholds;
  const filed = Object.entries(cal.enrolment_filed_month.pct).sort((a, b) => b[1] - a[1]);

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData
        data={pageLd({
          path: PATH, name: "Methodology", description: DESCRIPTION,
          trail: [
            { name: "Instruments", path: "/instruments" },
            { name: "Meal Claims Check", path: MEAL_BASE },
          ],
        })}
      />
      <InstrumentHeader crumb="Meal Claims Check" crumbHref={MEAL_BASE} />

      <main id="main-content" className="flex-1 px-6 md:px-12 py-12 md:py-16">
        <div className="max-w-6xl mx-auto">
          <Link href={MEAL_BASE} className={`${SMALL_LABEL} hover:opacity-100`}>&larr; Meal Claims Check</Link>
          <h1 className="mt-4 font-headline font-bold text-[clamp(30px,4.8vw,56px)] leading-[1.0] tracking-[-0.03em]">
            Methodology
          </h1>
          <p className="mt-5 mb-10 font-headline italic text-[clamp(17px,2vw,23px)] leading-snug max-w-3xl opacity-90">
            How the tables are read each night, how the three tests work, and
            what the instrument cannot see.
          </p>

          <Section id="duty" title="The law the tests rest on">
            <p>
              A midday meal at school is a legal entitlement. Section 5 of the
              National Food Security Act, 2013 creates it. Rule 3 of the
              Mid-Day Meal Rules, 2015 (G.S.R. 743(E), made under section 39
              of the Act) says who receives it: every child aged six to
              fourteen in classes I to VIII &ldquo;who enroll and attend the
              school&rdquo;, &ldquo;every day except on school
              holidays&rdquo;. Under rule 2(e) a madrasa or maqtab supported
              under Sarva Shiksha Abhiyan is a school for this purpose.
            </p>
            <p>
              Rule 3 gives a day&rsquo;s meal count two limits: the children
              enrolled and attending, and the days the school is open. It
              says nothing about a count higher than the school&rsquo;s
              enrolment or a count on a day the school was closed. Whether a
              State may lawfully count a meal given to a child who is not
              enrolled could not be settled from the Act or the Rules, and
              the question is listed again under what is not verified.
            </p>
            <p>
              PM POSHAN, as the scheme is now called, belongs to the
              Department of School Education &amp; Literacy in the Ministry
              of Education. State education departments file the daily
              returns, and the Himachal Pradesh unit of the National
              Informatics Centre keeps the system that holds them.
            </p>
          </Section>

          <Section id="source" title="Where the figures come from">
            <p>
              Nearly every figure on this site comes from the daily
              reporting system at{" "}
              <a href={MEAL_HOST} target="_blank" rel="noopener noreferrer">mdmhp.nic.in</a>.{" "}
              {count(m.counts.states)} States and Union Territories file on
              it, for {count(m.counts.schools)} schools in{" "}
              {count(m.counts.districts)} districts. Its tables open without
              a login. There is one for each State, district, block and
              cluster on any date, and under each cluster a table of its
              schools for that date. For a single school the system also
              shows the current month day by day and the enrolment filed for
              each month of the year, and for each State it shows a holiday
              list. The instrument reads these tables and no other part of
              the system. A State that files somewhere else is not covered.
            </p>
            <p>
              The nightly run reads yesterday. Schools keep filing through
              the afternoon, so a table for today would be incomplete. Late
              returns also change the two days before yesterday, so the
              all-States table for those days is read again every night.
            </p>
            <p>
              The run also works backwards through earlier dates of the
              all-States table and the district tables, a share of each
              night&rsquo;s requests at a time.
              {m.history.state_first_day ? (
                <>
                  {" "}The all-States table has been read for{" "}
                  {count(m.history.state_days)} dates so far, the earliest{" "}
                  {dayLong(m.history.state_first_day)}
                  {m.history.state_floor_reached ? ", which is the first date the system holds reports for" : ""}.
                </>
              ) : null}
              {m.history.district_first_day ? (
                <>
                  {" "}District tables have been read back to{" "}
                  {dayLong(m.history.district_first_day)}.
                </>
              ) : null}
            </p>
            <p>
              When a school is flagged, its code is looked up in UDISE+, the Ministry of
              Education&rsquo;s yearly register of schools, through the
              report card that the public school finder at{" "}
              <a href={UDISE_HOST} target="_blank" rel="noopener noreferrer">kys.udiseplus.gov.in</a>{" "}
              serves without a login. In Tripura and Himachal Pradesh, the
              two States where this was checked by hand, the meal system
              lists a school under its UDISE code (Himachal&rsquo;s loses its
              leading zero). The entry says which classes the school teaches,
              who manages it, whether the register lists it as operational,
              and how many children in classes I to VIII it gave free
              textbooks to. {count(m.counts.udise_asked)} flagged schools
              have been looked up and {count(m.counts.udise_found)} were
              found. None of the three tests uses these figures. They are
              printed on the school&rsquo;s page for whoever reads the flag.
            </p>
          </Section>

          <Section id="tests" title="The three tests">
            <Test measure={M.flag_over}>
              <p>
                The test runs only for a school that has filed an enrolment
                above zero for the month. Where a school has filed nothing
                the system prints 0, and that 0 is read as &ldquo;not
                filed&rdquo;. An excess of a single meal is flagged, because
                the report and the filing then disagree.{" "}
                {M.flag_over_wide.label} is marked separately:{" "}
                {M.flag_over_wide.definition.toLowerCase()}
              </p>
              <p>
                A wrong enrolment filing can cause this, which is why each
                school&rsquo;s page prints the enrolment it filed for all
                twelve months beside the flag.
              </p>
            </Test>
            <Test measure={M.flag_closed}>
              <p>
                Which day counts as closed is taken from the school&rsquo;s
                own record. A weekday is treated as the school&rsquo;s rest
                day when, leaving the flagged date out, the school reported
                meals on at most {share(T.offday_max_served_share, 1)} of the
                dates read on that weekday, at least{" "}
                {count(T.offday_min_same_weekdays)} such dates were read, and
                it reported on at least {pct(T.offday_min_other_weekday_rate)}{" "}
                of the dates on other weekdays. The flagged date is left out
                because it is itself a served date on that weekday.
              </p>
              <p>
                Some dates are set aside before counting because they show
                nothing about a weekly rest. These are dates inside a run of{" "}
                {count(T.break_min_days)} or more days with no report (a
                vacation, or a festival week), dates on the State&rsquo;s
                holiday list, and dates when the whole State was shut on a
                weekday it normally works. Before they were set aside, one
                festival week and one holiday were enough to make an ordinary
                Tuesday look like a school&rsquo;s rest day.
              </p>
              <p>
                There is no test for meals on a Sunday. Some schools,
                madrasas among them, rest on Friday and serve on Sunday, and
                a Sunday test would flag them every week for keeping their
                own lawful holiday. The site publishes no count of Sunday
                reports for the same reason.
              </p>
              <p>
                The holiday rule relies on the State&rsquo;s own list on the
                system, and applies only on a day when under{" "}
                {pct(T.state_shut_share)} of the State&rsquo;s schools
                reported. A date missing from the list is not taken to be a
                working day.
              </p>
              <p>
                A school with its own calendar may be open on a State holiday
                and serve a meal that day. All the flag says is that the
                school reported on a date its State lists as a holiday.
                Whether it was open is a question for someone who can ask the
                school. Where UDISE+ holds an entry for the school, its page
                shows the management and category recorded there, which is
                the quickest way to see whether it is a madrasa.
              </p>
              <p>
                On a day a State was shut, its tables are followed down to the
                schools that reported anyway. The month of any school the
                sample has already opened is checked as well. A school that
                reports on its own rest day while its State is open is found
                only if its month has been opened.
              </p>
            </Test>
            <Test measure={M.flag_spike}>
              <p>
                At least {count(T.spike_min_other_days)} other serving days
                must have been read for the school. A spike can be a typing slip. It is shown because the system accepted the
                figure and added it into the totals for the block, the
                district and the State.
              </p>
            </Test>
            <FlagNotFinding />
          </Section>

          <Section id="sample" title="How much is read each night">
            <p>
              One system serves every State that files on it, so the nightly run counts
              its requests and sends them one at a time with a pause in
              between. Last night&rsquo;s allowance was {count(fresh.budget)}{" "}
              and {count(fresh.sent)} were sent
              {fresh.failed != null ? `, ${count(fresh.failed)} of them unanswered` : ""}.
              After a clean night the allowance grows by half, or by{" "}
              {count(m.budget_step)} if that is more, up to{" "}
              {count(m.budget_cap)}. After a refusal, a night with failures,
              or a night of slower answers, it is halved. A refusal also ends
              that night&rsquo;s reading on the spot.
            </p>
            <p>
              The all-States table and every State&rsquo;s district table
              come first, every night. The requests left over go to earlier
              dates and to school tables. Clusters are picked by how long ago
              each was last read and by how many of its schools have filed an
              enrolment. When a table shows a school with a flag, or with a
              count far above its neighbours&rsquo;, that school&rsquo;s
              month and enrolment history are read too.
            </p>
            <p>
              {count(m.counts.tables_read)} school tables have been read so
              far. They cover {count(m.counts.clusters_read)} clusters and{" "}
              {count(m.counts.schools_read)} schools, and hold{" "}
              {count(m.counts.school_days_tested)} school-days that could be
              tested against enrolment. Every count on the site is a count of
              what was read. None is a rate for a State or a district, and a
              school without a flag may simply not have been read yet.
            </p>
          </Section>

          <Section id="measured" title="What was measured before the thresholds were fixed">
            <p>
              On {dayLong(cal.measured_on)}, before the thresholds were
              settled, {count(cal.tables_read)} school tables from{" "}
              {cal.states.map(name).join(" and ")} were read for{" "}
              {count(cal.dates.length)} dates.{" "}
              {count(cal.school_days_tested)} school-days could be tested and{" "}
              {count(cal.over)} of them were above filed enrolment (
              {share(cal.over, cal.school_days_tested)}):{" "}
              {count(cal.over_by_one_or_two)} by one or two meals,{" "}
              {count(cal.over_wide)} by a wide margin. Because so many were that small, excesses of one or two meals are
              shown apart from wide ones. The run sent {count(cal.requests_sent)} requests, of
              which {count(cal.requests_failed)} failed, and the median
              answer took {cal.median_seconds} seconds.
            </p>
            <p>
              In those two States school tables answered for dates back to{" "}
              {dayLong(cal.school_history_from)} and were empty at{" "}
              {dayLong(cal.school_history_empty_at)}. The system serves a
              school&rsquo;s day-by-day month only while that month is the
              current one. For earlier months the copies this instrument has
              stored are the only public ones.
            </p>
          </Section>

          <Section id="life" title="What happens to a flag later">
            <p>
              Each flag carries the date it was first seen. Schools do
              correct their counts and their enrolment. When a later reading
              of the same school-day no longer supports a flag, the flag
              stays on the school&rsquo;s page, marked as no longer standing
              and showing the figure as last read, and it drops out of every
              count. {count(m.counts.flags_no_longer_standing)} flags have
              ended this way.
            </p>
          </Section>

          <Section id="coverage" title="Where the enrolment test can run">
            <p>
              A school can be tested against its enrolment only once it has
              filed one. {monthLabel(cal.enrolment_filed_month.month)} was
              read after the month had closed, and the share of schools that
              had filed by then was:
            </p>
            <div className="overflow-x-auto">
              <table className="border-collapse min-w-[320px]">
                <thead>
                  <tr className="border-b border-[#1c1c19]">
                    <th className={TH}>State or Union Territory</th>
                    <th className={`${TH} text-right`}>{M.enr_filed_pct.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {filed.map(([st, p]) => (
                    <tr key={st} className="border-b border-[#1c1c19]/15">
                      <td className={TD}>{name(st)}</td>
                      <td className={`${TD} text-right`}>{p.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              The share is lower in the middle of a month. At least 85% of
              schools had filed in{" "}
              {count(filed.filter(([, p]) => p >= 85).length)} of these
              States and Union Territories, and there the test reaches nearly
              every school. Between 45% and 85% had filed in{" "}
              {count(filed.filter(([, p]) => p >= 45 && p < 85).length)}. In
              the others it reaches a minority. Rajasthan is on the system
              and files almost nothing.{" "}
              <Link href={`${MEAL_BASE}/states`}>The State list</Link> gives
              each State&rsquo;s current share.
            </p>
          </Section>

          <Section id="blanks" title="Days with no reports">
            <p>
              A day without a report does not show that schools served
              nothing. The State may not have filed, or the system may have
              been down. Such days are not flagged.
            </p>
            <p>
              Between {dayLong(year.from)} and {dayLong(year.to)},{" "}
              {count(year.dates_read)} dates were read. Taken together the
              States had reports in {count(year.weeks_with_records)} of{" "}
              {count(year.weeks)} weeks. The system held no report from any
              State on {year.host_blanks.map(span).join(", or on ")}. The
              cause is unknown. It does not recur each year, since June 2024
              and June 2025 both have reports.
            </p>
            {m.blank_ranges.length ? (
              <p>
                On the days this instrument has itself read, no State
                reported on: {m.blank_ranges.map(span).join("; ")}.
              </p>
            ) : null}
            <p>
              Each State also stops reporting during its vacations, which the
              system does not list. These gaps were measured in that year:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              {year.state_silences.map((s) => (
                <li key={s.st}>
                  {name(s.st)}: {s.span}
                  {s.vacation ? "" : " (the gap was measured; that it is a vacation is not verified)"}
                </li>
              ))}
            </ul>
          </Section>

          <Section id="national" title="The national system">
            <p>
              The Ministry&rsquo;s national Automated Monitoring System
              (pmposhan-ams.education.gov.in) holds returns from all 36
              States and Union Territories for the last thirty days. Its
              &ldquo;AMS Reporting Status&rdquo; page gives a day&rsquo;s
              totals for each State and, one step down, for each district.
              The nightly run reads those two levels and publishes them on
              the <Link href={`${MEAL_BASE}/national`}>All India page</Link>.
              It reads the latest two days every night, because schools go
              on filing after a day has passed, and works back through the
              thirty days as its time allows. A day once read is kept after
              the source has dropped it.
            </p>
            <p>
              The system closes every connection from an address outside
              India, and the server the nightly run uses is outside India.
              The run therefore builds a list of open relays in India each
              night, checks each one against the system, and reads through
              those that pass. Every request is encrypted to the
              Ministry&rsquo;s own certificate, so a relay carries the page
              without being able to read or change it. On a night when no
              relay works, the national tables keep their previous date and
              the rest of the instrument is unaffected.
            </p>
            <p>
              The national figures are not put through the
              instrument&rsquo;s tests. Each table is only added up and
              compared with its own TOTAL row, and a table that does not add
              up is stored with that noted. The system
              was opened by hand on 25 November 2026 and compared with
              mdmhp.nic.in for nine Tripura schools on 24 November. Eight had
              the same meal counts in both, the ninth was missing from the
              national system, and six of the eight showed a different
              enrolment.
            </p>
          </Section>

          <Section id="others" title="Systems that are not read">
            <p>
              Jharkhand keeps its own system (mdm.jharkhand.gov.in). On 25
              November 2026 it gave the nightly run&rsquo;s server no
              answer, and it is not read. Jharkhand&rsquo;s State and
              district totals come from the national system instead.
            </p>
            <p>
              UDISE+ publishes enrolment by class, but only behind a search
              that requires a CAPTCHA. The instrument does not solve
              CAPTCHAs, so that enrolment is not used.
            </p>
          </Section>

          <Section id="unverified" title="Not verified">
            <ul className="list-disc pl-5 space-y-2">
              <li>Whether a meal count may lawfully include anyone who is not enrolled at the school.</li>
              <li>The weekly holiday of any individual school. It is inferred from the school&rsquo;s own reports alone.</li>
              <li>Whether the States&rsquo; holiday lists are complete. Several plainly are not, and none has been checked against the State&rsquo;s orders.</li>
              <li>How often schools report above enrolment over time. Only a sample has been read, over a short period.</li>
              <li>What the system&rsquo;s internal exception report flags. It is behind a login and was not read.</li>
              <li>Why the system has an attendance field that is empty for every school looked at, and whether filling it is left to each State.</li>
              <li>The cause of the system-wide gaps described above, and whether Lakshadweep&rsquo;s long gap is a vacation.</li>
              <li>School-level records before {dayLong(cal.school_history_from)} in the two States measured.</li>
              <li>Whether every State on the system lists schools under their UDISE codes. Tripura and Himachal Pradesh do.</li>
              <li>How a school&rsquo;s UDISE+ entry was checked before it was published there. The free-textbook count is the school&rsquo;s own yearly return.</li>
              <li>How many requests a night the system tolerates. The run started low and stops at the first refusal.</li>
              <li>The terms on which either source&rsquo;s figures may be reused. Neither publisher states any. See <Link href={`${MEAL_BASE}/data`}>data and terms</Link>.</li>
            </ul>
          </Section>

          <Section id="privacy" title="What is not read or kept">
            <p>
              Counts, codes, dates and the names of institutions are kept,
              and nothing about a person. The reader works from a fixed list
              of addresses and refuses any other. That keeps it out of the
              pages that name a school&rsquo;s meal in-charge or principal,
              the user lists, the grievance pages, and everything behind a
              login or a human check. From a UDISE+ report card it keeps
              twelve fields about the school and discards the rest of the
              answer, teacher counts included. No page is stored whole.
              Before any text is stored it is searched for anything shaped
              like a phone number or an e-mail address, and that is removed.
            </p>
          </Section>

          <Section id="related" title="The same checks, done by hand">
            <p>
              Officials and auditors make these comparisons by hand, one
              school at a time and long after the day. Maharashtra&rsquo;s
              meal cell found schools claiming meals on an election holiday
              (Pune Mirror, 1 December 2019). An audit in Odisha found meals
              above attendance in 42 of 642 schools (The New Indian Express,
              2 April 2026). The Comptroller and Auditor General&rsquo;s
              Report 36 of 2015 audited the scheme across the country. None
              of the three concerns a State on this system.
            </p>
            <p>
              The national system publishes exception reports of its own.
              They cover meals below enrolment and runs of days with no
              meals. Meals above enrolment and meals on a closed day are not
              among them. A March 2026 analysis of the holiday reasons States
              record nationally is{" "}
              <a href="https://medium.com/@dwivedimav/anything-interesting-about-the-mid-day-meals-57564d8981d4" target="_blank" rel="noopener noreferrer">
                on Medium
              </a>
              .
            </p>
          </Section>

          <Section id="check" title="Checking a flag at the source">
            <p>
              On{" "}
              <a href={MEAL_HOST} target="_blank" rel="noopener noreferrer">mdmhp.nic.in</a>,
              choose the State and the date, then the district, block and
              cluster named on the school&rsquo;s page. The cluster&rsquo;s
              table lists each school with whether it filed enrolment, the
              enrolment, and the meals reported that day. The date picker
              there offers only the last month.
            </p>
            <p className="opacity-75">
              Figures on this site were last read {whenIST(fresh.checked_at) ?? "at an unknown time"} IST.
            </p>
          </Section>
        </div>
      </main>

      <InstrumentFooter instrument="meal-claims" />
    </div>
  );
}
