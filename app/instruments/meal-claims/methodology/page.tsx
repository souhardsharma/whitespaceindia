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
  "The method behind Meal Claims Check: the sample it reads from the PM POSHAN daily reporting system each night, the thresholds of its three tests, the way a school's closed day is decided and what has not been verified.";

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

/** "on 14 May 2026" for one day, "from 5 June 2026 to 25 June 2026" for a run. */
function when([from, to]: [string, string]): string {
  return from === to ? `on ${dayLong(from)}` : `from ${dayLong(from)} to ${dayLong(to)}`;
}

function spans(ranges: [string, string][]): string {
  return [...ranges].sort((a, b) => a[0].localeCompare(b[0])).map(when).join(" or ");
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
            Each night the instrument reads a sample of school tables from the PM POSHAN daily reporting system and tests every school-day it can against the school&rsquo;s other figures and its State&rsquo;s holiday list. Each test is set out below with its thresholds, and so is what the system cannot show.
          </p>

          <Section id="duty" title="The law the tests rest on">
            <p>
              A midday meal at school is a legal entitlement, created by section 5 of
              the National Food Security Act, 2013. Rule 3 of the
              Mid-Day Meal Rules, 2015 (G.S.R. 743(E), made under section 39
              of the Act) says who receives it: every child aged six to
              fourteen in classes I to VIII &ldquo;who enroll and attend the
              school&rdquo;, &ldquo;every day except on school
              holidays&rdquo;. Under rule 2(e) a madrasa or maqtab supported
              under Sarva Shiksha Abhiyan is a school for this purpose.
            </p>
            <p>
              Rule 3 ties a day&rsquo;s meals to the children who enrol and
              attend, on the days the school is open. It says nothing about
              a count higher than the school&rsquo;s enrolment or a count on
              a day the school was closed. Whether a State may lawfully
              count a meal given to a child who is not enrolled could not be
              settled from the Act or the Rules, and the question is listed
              again under what is not verified.
            </p>
            <p>
              PM POSHAN, as the scheme is now called, belongs to the
              Department of School Education &amp; Literacy in the Ministry
              of Education. The daily returns are filed into a system kept by
              the Himachal Pradesh unit of the National Informatics Centre.
            </p>
          </Section>

          <Section id="source" title="Where the figures come from">
            <p>
              Nearly every figure in this instrument comes from the daily
              reporting system at{" "}
              <a href={MEAL_HOST} target="_blank" rel="noopener noreferrer">mdmhp.nic.in</a>.{" "}
              {count(m.counts.states)} States and Union Territories file on
              it, for {count(m.counts.schools)} schools in{" "}
              {count(m.counts.districts)} districts. Without a login it
              serves a table for each State, district, block and cluster,
              with a table of its schools under each cluster, for earlier
              dates as well as the current one, though its own date picker
              reaches back only a month. For a
              single school it also shows the current month day by day and
              the enrolment filed for each month of the year, and for each
              State a holiday list. The tests run on these tables, so a
              State that files on another system is not tested.
            </p>
            <p>
              The nightly run reads yesterday&rsquo;s tables, because
              schools keep filing through the afternoon and a table for
              today would be incomplete. Late returns go on changing the two
              days before yesterday as well, so the all-States table for
              those days is read again every night.
            </p>
            <p>
              The run also works backwards through earlier dates of the
              all-States table and the district tables, spending part of
              each night&rsquo;s requests on them.
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
              textbooks to. {count(m.counts.udise_asked)} schools have been
              looked up since they were first flagged, and UDISE+ held an
              entry for {count(m.counts.udise_found)}. These figures are printed on the school&rsquo;s page,
              and none of the three tests uses them.
            </p>
          </Section>

          <Section id="tests" title="The three tests">
            <Test measure={M.flag_over}>
              <p>
                The test runs only for a school that has filed an enrolment
                above zero for the month. Where a school has filed nothing
                the system prints 0, and that 0 is read as &ldquo;not
                filed&rdquo;. A single meal over the enrolment raises a
                flag, because the report and the filing then disagree. The
                flag is marked wide when the meals are at least{" "}
                {count(T.over_wide_ratio)} times the enrolment and at least{" "}
                {count(T.over_wide_min_excess)} more than it.
              </p>
              <p>
                The test cannot tell a wrong enrolment filing from an excess
                of meals, so each school&rsquo;s page prints the enrolment
                the school filed for every month of the year once its
                enrolment record has been read, and until then the figure
                from the cluster table.
              </p>
            </Test>
            <Test measure={M.flag_closed}>
              <p>
                Which day counts as closed is taken from the school&rsquo;s
                own record, with the flagged date left out because it is
                itself a served date on that weekday. A weekday is treated as
                the school&rsquo;s rest day when at least{" "}
                {count(T.offday_min_same_weekdays)} dates on that weekday
                have been read and the school reported meals on at most{" "}
                {pct(T.offday_max_served_share)} of them, provided it
                reported meals on at least{" "}
                {pct(T.offday_min_other_weekday_rate)} of the dates on other
                weekdays.
              </p>
              <p>
                Any date inside a run of {count(T.break_min_days)} or more
                days with no report from the school (a vacation or a
                festival week) is set aside before counting, because it shows
                nothing about a weekly rest. The State&rsquo;s listed holidays
                are set aside too, and so is any weekday the State normally
                works on which under {pct(T.state_shut_share)} of its schools
                reported. Before they were set aside, one
                festival week and one holiday were enough to make an ordinary
                Tuesday look like a school&rsquo;s rest day.
              </p>
              <p>
                The instrument has no test for Sunday meals and publishes no
                count of Sunday reports, because some schools, madrasas among
                them, rest on Friday and serve on Sunday, and a Sunday test
                would flag them every week for keeping their own lawful
                holiday.
              </p>
              <p>
                The holiday rule relies on the State&rsquo;s own list on the
                system, and applies only on a day when under{" "}
                {pct(T.state_shut_share)} of the State&rsquo;s schools
                reported. A date missing from the list is not taken as proof
                that schools were open.
              </p>
              <p>
                A school with its own calendar may be open on a State holiday
                and serve a meal that day. The flag records that the school
                reported on a date its State lists as a holiday; whether the
                school was open can be settled by asking it. Where UDISE+
                holds an entry for the school, its page shows the management
                and category recorded there, which can show whether it is a
                madrasa.
              </p>
              <p>
                On a day a State was shut, the run follows its tables down to
                the schools that reported anyway, and checks that day for
                every school whose month it has already read. A school that
                serves on its own rest day while its State is open can be
                found only from its own month, so it stays unflagged until
                that month is read.
              </p>
            </Test>
            <Test measure={M.flag_spike}>
              <p>
                At least {count(T.spike_min_other_days)} other serving days
                must have been read for the school. A typing slip can
                produce a spike, and the figure stays in the system as filed.
                In the one case checked by hand, a school in Anuppur reported
                8,674 meals on Sunday 1 November 2026, and the district&rsquo;s
                row on the system carried them.
              </p>
            </Test>
            <FlagNotFinding />
          </Section>

          <Section id="sample" title="How much is read each night">
            <p>
              All {count(m.counts.states)} States and Union Territories
              file into mdmhp.nic.in, so the nightly run counts the requests
              it sends there and sends them one at a time, with a pause in
              between. Last night&rsquo;s allowance was {count(fresh.budget)}{" "}
              and {count(fresh.sent)} were sent
              {fresh.failed != null ? `, ${count(fresh.failed)} of them unanswered` : ""}.
              After a clean night the allowance grows by half, or by{" "}
              {count(m.budget_step)} if that is more, up to{" "}
              {count(m.budget_cap)}. A refusal ends that night&rsquo;s
              reading on the spot and halves the next night&rsquo;s
              allowance. A night on which more than 2% of requests failed, or
              the median answer took more than 1.6 times as long as on earlier
              nights, also halves the next night&rsquo;s allowance.
            </p>
            <p>
              The all-States table and every State&rsquo;s district table
              come first every night, and the holiday lists once a week. What
              is left is shared between earlier dates, the days a State was
              shut, the lists of blocks and clusters, school tables and the
              months of the schools those tables named. Clusters are picked by how long ago
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
              tested against enrolment. The months of the schools those
              tables named are tested as well, and most flags above enrolment
              come from them. Flags and tested school-days count only what
              the sample has reached, so neither is a rate for a State or a
              district, and a school without a flag can be one the sample has
              not read.
            </p>
          </Section>

          <Section id="measured" title="The sample the thresholds were set on">
            <p>
              On {dayLong(cal.measured_on)}, when the thresholds were set,{" "}
              {count(cal.tables_read)} school tables from{" "}
              {cal.states.map(name).join(" and ")} were read for{" "}
              {count(cal.dates.length)} dates.{" "}
              {count(cal.school_days_tested)} school-days could be tested and{" "}
              {count(cal.over)} of them were above filed enrolment (
              {share(cal.over, cal.school_days_tested)}):{" "}
              {count(cal.over_by_one_or_two)} by one or two meals,{" "}
              {count(cal.over_wide)} by a wide margin and the rest in
              between. Because {count(cal.over_by_one_or_two)} of the{" "}
              {count(cal.over)} were that small, wide excesses are marked
              and shown apart from them. The run sent {count(cal.requests_sent)} requests, of
              which {count(cal.requests_failed)} failed, and the median
              answer took {cal.median_seconds} seconds.
            </p>
            <p>
              In those two States school tables answered for dates back to{" "}
              {dayLong(cal.school_history_from)} and were empty at{" "}
              {dayLong(cal.school_history_empty_at)}. The system serves a
              school&rsquo;s day-by-day month for the current month. An
              earlier month can be rebuilt from the cluster tables one date
              at a time, and this instrument keeps whole every month it has
              read.
            </p>
          </Section>

          <Section id="life" title="What happens to a flag later">
            <p>
              A school can correct its count or its enrolment after a flag
              is first seen, and a later reading of the same school-day may
              then no longer support the flag. Such a flag keeps the date it
              was first seen and stays on the school&rsquo;s page, marked as
              no longer standing and showing the figure as last read, and it
              drops out of every count. {count(m.counts.flags_no_longer_standing)} flags have
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
              At least 85% of schools had filed in{" "}
              {count(filed.filter(([, p]) => p >= 85).length)} of these
              States and Union Territories, where the test reaches nearly
              every school, and between 45% and 85% in{" "}
              {count(filed.filter(([, p]) => p >= 45 && p < 85).length)}.
              In the others it reaches a minority. Rajasthan is on the
              system but files almost no enrolment, and it does not appear in
              the table.{" "}
              <Link href={`${MEAL_BASE}/states`}>The State list</Link> gives
              each State&rsquo;s current share.
            </p>
          </Section>

          <Section id="blanks" title="Days with no reports">
            <p>
              Days without a report are not flagged, because the State may not have
              filed or the system may have been down.
            </p>
            <p>
              Between {dayLong(year.from)} and {dayLong(year.to)},{" "}
              {count(year.dates_read)} dates were read. Taken together the
              States had reports in {count(year.weeks_with_records)} of{" "}
              {count(year.weeks)} weeks. The system held no report from any
              State {spans(year.host_blanks)}. The cause of
              that gap is unknown, and it does not recur each year, since June 2024
              and June 2025 both have reports.
            </p>
            {m.blank_ranges.length ? (
              <p>
                Among the days this instrument has itself read, no State
                reported {spans(m.blank_ranges)}.
              </p>
            ) : null}
            <p>
              Several States stop reporting during vacations that their
              holiday lists leave out. These gaps were measured in that year:
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
              Every night it reads the State totals for the latest two days
              and the district totals for the latest day, because a
              day&rsquo;s returns can still be filed after the day has
              passed, and then works back through earlier days as its time
              allows. A day once read is kept after
              the source has dropped it.
            </p>
            <p>
              The system closes every connection from an address outside
              India, and the nightly run&rsquo;s server is outside India.
              Each night the run therefore builds a list of open relays in
              India and reads through those that pass a check against the
              system. It uses ten of them at a time and paces their requests
              together, so the system answers the same number of requests
              however many relays carry them. A relay that stops working is
              replaced, and the list is checked again every quarter of an
              hour while the national read lasts.
            </p>
            <p>
              Every request goes over TLS with the system&rsquo;s certificate
              checked, so a relay carries the page without being able to read
              or change it. The national read stops for the night at
              the system&rsquo;s first refusal, and on a night when no relay
              works the national tables keep their previous date while the
              school tests, which do not use them, run as usual.
            </p>
            <p>
              The daily reporting system at mdmhp.nic.in, which the tests
              are run on, has so far answered the run directly. If it stops
              answering altogether, the run asks it through one of the same
              relays, inside the same allowance of requests. A refusal from
              mdmhp.nic.in ends that night&rsquo;s reading there, and
              nothing is then sent through a relay.
            </p>
            <p>
              Each national table is added up and checked against its own
              TOTAL row. A table without that row is not stored, and one that
              does not add up is stored and marked as such.
            </p>
            <p>
              On 25 November 2026 the national system&rsquo;s returns for
              24 November were compared by hand with mdmhp.nic.in for the
              nine schools of one Tripura cluster. Eight had the same meal
              counts in both, though six of those eight showed a different
              enrolment, and the ninth was missing from the national system.
            </p>
          </Section>

          <Section id="others" title="Systems that are not read">
            <p>
              Jharkhand keeps its own system at mdm.jharkhand.gov.in, which gave
              the nightly run&rsquo;s server no answer on 25 November 2026 and
              is not read. Jharkhand&rsquo;s State and district
              totals come from the national system.
            </p>
            <p>
              UDISE+ publishes enrolment by class behind a search that requires a
              CAPTCHA. The instrument does not solve CAPTCHAs, so that
              enrolment is not used.
            </p>
          </Section>

          <Section id="unverified" title="Not verified">
            <ul className="list-disc pl-5 space-y-2">
              <li>Whether a meal count may lawfully include anyone who is not enrolled at the school.</li>
              <li>The weekly holiday of any individual school, which is inferred from the school&rsquo;s own reports.</li>
              <li>Whether the States&rsquo; holiday lists are complete: several plainly are not, and none has been checked against the State&rsquo;s orders.</li>
              <li>How often schools report above enrolment over time; the sample read so far covers a short period.</li>
              <li>What mdmhp.nic.in&rsquo;s internal exception report flags, since it is behind a login and was not read.</li>
              <li>Why the system has an attendance field that is empty for every school looked at, and whether filling it is left to each State.</li>
              <li>The cause of the days on which no State reported, and whether Lakshadweep&rsquo;s long gap is a vacation.</li>
              <li>School-level records before {dayLong(cal.school_history_from)} in the two States measured.</li>
              <li>Whether every State on the system lists schools under their UDISE codes, as Tripura and Himachal Pradesh do.</li>
              <li>How a school&rsquo;s UDISE+ entry, including the free-textbook count from its own yearly return, was checked before UDISE+ published it.</li>
              <li>How many requests a night the system tolerates; the run started low and stops at the first refusal.</li>
              <li>The terms for reusing the three sources&rsquo; figures, which none of their publishers states (see <Link href={`${MEAL_BASE}/data`}>data and terms</Link>).</li>
            </ul>
          </Section>

          <Section id="privacy" title="What is not read or kept">
            <p>
              The instrument keeps counts, codes, dates and the names of institutions.
              It stores nothing about any person. The reader works from a fixed list
              of addresses and refuses any other. That keeps it out of the
              pages that name a school&rsquo;s meal in-charge or principal,
              the user lists, the grievance pages, and everything behind a
              login or a human check. From a UDISE+ report card it keeps
              twelve fields about the school and discards the rest of the
              answer, teacher counts included, and no page is stored whole.
              Before any text is stored it is searched for anything shaped
              like a phone number or an e-mail address, and that is removed.
            </p>
          </Section>

          <Section id="related" title="The same checks, done by hand">
            <p>
              These comparisons have been made by hand before, one school
              at a time and long after the day. The Comptroller and
              Auditor General audited the scheme across the country in
              Report 36 of 2015. In Maharashtra the meal cell found schools
              claiming meals on an election holiday (Pune Mirror, 1 December
              2019), and in Odisha an audit found meals above attendance in
              42 of 642 schools (The New Indian Express, 2 April 2026);
              neither State files on this system.
            </p>
            <p>
              The national system&rsquo;s exception reports list schools
              serving below a set share of their enrolment and schools with
              runs of days without meals, and its menu has no report of
              meals above enrolment or of meals on a closed day. A March
              2026 post by dwivedimav{" "}
              <a href="https://medium.com/@dwivedimav/anything-interesting-about-the-mid-day-meals-57564d8981d4" target="_blank" rel="noopener noreferrer">
                on Medium
              </a>{" "}
              analyses the holiday reasons States record nationally.
            </p>
          </Section>

          <Section id="check" title="Checking a flag at the source">
            <p>
              On{" "}
              <a href={MEAL_HOST} target="_blank" rel="noopener noreferrer">mdmhp.nic.in</a>,
              choose the State and the date, then the district, block and
              cluster named on the school&rsquo;s page. The cluster&rsquo;s table
              lists each school with the enrolment it filed, if any, and the meals it
              reported that day. The date picker
              there reaches back one month, so an older day cannot be checked
              through it.
            </p>
            <p className="opacity-75">
              {whenIST(fresh.checked_at) ? `Figures on this site were last read ${whenIST(fresh.checked_at)} IST.` : "The time of the last read is not recorded."}
            </p>
          </Section>
        </div>
      </main>

      <InstrumentFooter instrument="meal-claims" />
    </div>
  );
}
