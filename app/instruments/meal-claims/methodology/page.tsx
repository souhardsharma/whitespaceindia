import type { ReactNode } from "react";
import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import { InstrumentFooter, InstrumentHeader } from "@/components/instruments/InstrumentChrome";
import { FlagNotFinding, SECTION_HEADING, SMALL_LABEL, TD, TH } from "@/components/instruments/meal/parts";
import {
  MEAL_BASE, MEAL_HOST, MEAL_OG, TEAL, count, dayLong, monthLabel, share, whenIST,
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
  "How Meal Claims Check reads the PM POSHAN daily reporting system, the three tests it applies to a school's own filings, how a closed day is decided, what is sampled, and everything it cannot verify.";

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
            What is read, what is compared with what, and where the
            instrument stops.
          </p>

          <Section id="duty" title="The duty behind it">
            <p>
              The midday meal is an entitlement under section 5 of the
              National Food Security Act, 2013. Rule 3 of the Mid-Day Meal
              Rules, 2015 (G.S.R. 743(E), made under section 39 of the Act)
              gives it to every child aged six to fourteen in classes I to
              VIII &ldquo;who enroll and attend the school&rdquo;, &ldquo;every
              day except on school holidays&rdquo;. Rule 2(e) counts madrasas
              and maqtabs supported under Sarva Shiksha Abhiyan as schools.
            </p>
            <p>
              So the rule ties a day&rsquo;s meals to the children enrolled
              and attending, and to days the school is open. A meal count
              above a school&rsquo;s enrolment, or on a day it is closed, is a
              report the rule does not provide for. Whether a State may
              lawfully count a meal given to a child who is not enrolled is
              not something this instrument has been able to establish.
            </p>
            <p>
              The scheme (PM POSHAN) is run by the Department of School
              Education &amp; Literacy, Ministry of Education. State education
              departments file the daily returns. The record is kept by the
              National Informatics Centre, Himachal Pradesh.
            </p>
          </Section>

          <Section id="source" title="The source">
            <p>
              The daily reporting system at{" "}
              <a href={MEAL_HOST} target="_blank" rel="noopener noreferrer">mdmhp.nic.in</a>{" "}
              holds the returns of {count(m.counts.states)} States and Union
              Territories: {count(m.counts.schools)} schools in{" "}
              {count(m.counts.districts)} districts. It publishes, without a
              login, a table for each State, district, block and cluster on
              any date, a table of every school in a cluster for a date, each
              school&rsquo;s day-by-day counts for the current month, the
              enrolment each school filed month by month, and each
              State&rsquo;s holiday list. The instrument reads only those
              tables. States not on this system are not covered.
            </p>
            <p>
              It always reads yesterday, never today: schools file through the
              afternoon. The two days before are read again each night because
              late returns move them.
            </p>
          </Section>

          <Section id="tests" title="The three tests">
            <Test measure={M.flag_over}>
              <p>
                Run only where the school has filed an enrolment above zero
                for the month. Where none is filed the system prints 0, and
                that 0 is treated as &ldquo;not filed&rdquo;, never as an
                enrolment. Any excess is flagged, because any excess is a
                contradiction; {M.flag_over_wide.label.toLowerCase()} is
                marked separately: {M.flag_over_wide.definition.toLowerCase()}
              </p>
              <p>
                A wrong enrolment filing is a likely cause. Each
                school&rsquo;s page therefore shows the enrolment it filed for
                every month of the year beside the flag.
              </p>
            </Test>
            <Test measure={M.flag_closed}>
              <p>
                The closed day is the school&rsquo;s own. A weekday counts as
                one the school does not serve when, on its other dates read,
                it reported meals on at most{" "}
                {share(T.offday_max_served_share, 1)} of the dates falling on
                that weekday (at least {count(T.offday_min_same_weekdays)} of
                them) and on at least {pct(T.offday_min_other_weekday_rate)} of
                the other dates. The flagged day is left out of that count, so
                a report cannot vouch for itself.
              </p>
              <p>
                Three kinds of date are left out as well, because they say
                nothing about a weekly rest: a date inside a run of{" "}
                {count(T.break_min_days)} or more days without a report (a
                vacation or a festival week), a date on the State&rsquo;s
                holiday list, and a date on which the State was shut on a
                weekday it is usually open. Counted, one festival week and
                one holiday made an off-day of an ordinary Tuesday.
              </p>
              <p>
                This is deliberate. Some schools, madrasas among them, rest on
                Friday and serve on Sunday. A test for &ldquo;meals on a
                Sunday&rdquo; would flag them every week for keeping their own
                lawful holiday, so the instrument has no such test and
                publishes no count of Sunday reports.
              </p>
              <p>
                The holiday rule uses the State&rsquo;s own list on the
                system, and only on a day when under{" "}
                {pct(T.state_shut_share)} of the State&rsquo;s schools
                reported. A date missing from a list is never treated as a
                working day.
              </p>
              <p>
                A school that keeps its own calendar may be open on a
                State holiday and serve a meal that day. The flag says only
                that the school reported on a date its State lists as a
                holiday; whether the school was open is for someone who can
                ask it.
              </p>
              <p>
                Closed-day flags reach the instrument two ways: by following a
                State&rsquo;s tables down to the schools that reported on a
                day the State was shut, and from the month of any school the
                sample has already opened. A school that reports on its own
                weekly holiday, on a day its State is open, is found only by
                the second.
              </p>
            </Test>
            <Test measure={M.flag_spike}>
              <p>
                Needs at least {count(T.spike_min_other_days)} other serving
                days read for the school. A spike is most often a typing slip.
                It is shown because the system accepted it and carries it in
                the totals it reports for the block, district and State.
              </p>
            </Test>
            <FlagNotFinding />
          </Section>

          <Section id="sample" title="What is sampled">
            <p>
              The system is shared by every State on it, so the instrument
              limits itself to a set number of pages a night, one at a time
              with a pause between them. On the last night that budget was{" "}
              {count(fresh.budget)} and {count(fresh.sent)} were asked
              {fresh.failed != null ? `, ${count(fresh.failed)} unanswered` : ""}.
              The budget rises by itself after a clean night up to a fixed
              ceiling and is halved after a refusal, failures or slower
              answers. A refusal ends the night&rsquo;s read at once.
            </p>
            <p>
              Every night reads the all-States table and every State&rsquo;s
              district table. What is left goes to school tables, cluster by
              cluster, choosing clusters by how long since each was read and
              how many of its schools have filed an enrolment. A school that a
              table flags, or whose count is far above its neighbours&rsquo;,
              has its month and its enrolment history read.
            </p>
            <p>
              So far {count(m.counts.tables_read)} school tables have been
              read, holding {count(m.counts.school_days_tested)} school-days
              that could be tested against enrolment. The counts on this site
              are counts of what has been read. They are not rates for a State
              or a district, and a school with no flag may not have been read.
            </p>
          </Section>

          <Section id="measured" title="What was measured first">
            <p>
              Before the thresholds were kept, {count(cal.tables_read)} school
              tables of {cal.states.map(name).join(" and ")} were read on{" "}
              {dayLong(cal.measured_on)}, for {count(cal.dates.length)} dates.
              Of {count(cal.school_days_tested)} school-days that could be
              tested, {count(cal.over)} were above filed enrolment (
              {share(cal.over, cal.school_days_tested)}),{" "}
              {count(cal.over_by_one_or_two)} of them by one or two meals and{" "}
              {count(cal.over_wide)} by a wide margin. That is why small
              excesses are shown but marked apart from wide ones. The run sent{" "}
              {count(cal.requests_sent)} requests, {count(cal.requests_failed)}{" "}
              failed, and the median answer took {cal.median_seconds} seconds.
            </p>
            <p>
              School tables answered for dates back to{" "}
              {dayLong(cal.school_history_from)} and were empty at{" "}
              {dayLong(cal.school_history_empty_at)}. A school&rsquo;s
              day-by-day month is served for the current month only, so the
              months this instrument has stored are the only public copy of
              them.
            </p>
          </Section>

          <Section id="life" title="A flag after it is raised">
            <p>
              A flag carries the date it was first seen. When a later read of
              the same school-day no longer supports it, because the school
              corrected its count or its enrolment, the flag is kept, marked
              as no longer standing, and shows the figure as last read. It
              leaves the counts. {count(m.counts.flags_no_longer_standing)}{" "}
              flags have ended that way so far.
            </p>
          </Section>

          <Section id="coverage" title="Where the enrolment test can run">
            <p>
              Only a school that has filed its enrolment can be tested
              against it. For {monthLabel(cal.enrolment_filed_month.month)},
              a month read after it had closed, the share of schools that had
              filed was:
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
              Fewer have filed in the middle of a month. In{" "}
              {count(filed.filter(([, p]) => p >= 85).length)} of these States
              and Union Territories at least 85% of schools had filed, so the
              test reaches nearly every school; in{" "}
              {count(filed.filter(([, p]) => p >= 45 && p < 85).length)} about
              half had; in the rest it reaches a minority. Rajasthan is on the
              system but files almost nothing. The current share for each
              State is on{" "}
              <Link href={`${MEAL_BASE}/states`}>the State list</Link>.
            </p>
          </Section>

          <Section id="blanks" title="Blanks and silences">
            <p>
              A day with no report is the system&rsquo;s or the State&rsquo;s
              silence. It is never read as schools not serving and it is
              never flagged.
            </p>
            <p>
              Over the year from {dayLong(year.from)} to {dayLong(year.to)},{" "}
              {count(year.dates_read)} dates were read: the States together
              had reports in {count(year.weeks_with_records)} of{" "}
              {count(year.weeks)} weeks. The system held no report for any
              State on {year.host_blanks.map(span).join(", or on ")}. The
              cause is not known, and it is not a yearly pattern: June 2024
              and June 2025 have reports.
            </p>
            {m.blank_ranges.length ? (
              <p>
                Among the days this instrument has itself read, no State
                reported on: {m.blank_ranges.map(span).join("; ")}.
              </p>
            ) : null}
            <p>
              Each State also goes quiet in its own vacations, and the system
              lists none of them. Stretches of silence measured in that year:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              {year.state_silences.map((s) => (
                <li key={s.st}>
                  {name(s.st)}: {s.span}
                  {s.vacation ? "" : " (silence measured; that it is a vacation is not verified)"}
                </li>
              ))}
            </ul>
          </Section>

          <Section id="unverified" title="Not verified">
            <ul className="list-disc pl-5 space-y-2">
              <li>Whether a meal count may lawfully include anyone who is not enrolled at the school.</li>
              <li>The weekly holiday of any individual school. It is inferred from the school&rsquo;s own reports and from nothing else.</li>
              <li>Whether the States&rsquo; holiday lists are complete. Several plainly are not, and none has been checked against the State&rsquo;s orders.</li>
              <li>How often schools report above enrolment over time. The instrument has read a sample over a short period.</li>
              <li>What the system&rsquo;s own internal exception report flags. It is behind a login and was not read.</li>
              <li>Why the system holds an attendance field that is empty for every school looked at, and whether filling it is a State&rsquo;s choice.</li>
              <li>The cause of the system-wide blanks above, and whether Lakshadweep&rsquo;s long silence is a vacation.</li>
              <li>School-level records before {dayLong(cal.school_history_from)}.</li>
              <li>How many nightly requests the system tolerates. The instrument starts low and stops at the first refusal.</li>
              <li>The terms on which the system&rsquo;s figures may be reused. Its publisher states none. See <Link href={`${MEAL_BASE}/data`}>data and terms</Link>.</li>
            </ul>
          </Section>

          <Section id="privacy" title="What is not read or kept">
            <p>
              Counts, codes, dates and the names of institutions only. The
              instrument never opens the system&rsquo;s pages that name a
              school&rsquo;s meal in-charge or principal, its user lists, its
              grievance pages or anything behind a login or a human check, and
              its reader refuses any address outside a fixed list. No page is
              kept whole, and anything shaped like a phone number or an e-mail
              address is removed from text before it is stored.
            </p>
          </Section>

          <Section id="related" title="Who checks this by hand">
            <p>
              The same comparisons are made by hand, late and school by
              school. Maharashtra&rsquo;s meal cell found schools claiming
              meals on an election holiday (Pune Mirror, 1 December 2019). An
              audit in Odisha found meals above attendance in 42 of 642
              schools (The New Indian Express, 2 April 2026). The Comptroller
              and Auditor General&rsquo;s Report 36 of 2015 audited the scheme
              nationally. None of these concerns a State on this system.
            </p>
            <p>
              The national system&rsquo;s published exception reports cover
              meals below enrolment and runs of days with no meals, not meals
              above enrolment or on a closed day. A March 2026 analysis of
              the holiday reasons States record nationally is{" "}
              <a href="https://medium.com/@dwivedimav/anything-interesting-about-the-mid-day-meals-57564d8981d4" target="_blank" rel="noopener noreferrer">
                on Medium
              </a>
              .
            </p>
          </Section>

          <Section id="check" title="Checking a flag yourself">
            <p>
              On{" "}
              <a href={MEAL_HOST} target="_blank" rel="noopener noreferrer">mdmhp.nic.in</a>,
              choose the State, the date, then the district, block and cluster
              named on the school&rsquo;s page. The cluster&rsquo;s table
              shows, for each school, whether it filed enrolment, the
              enrolment, and the meals reported that day. The system&rsquo;s
              date picker goes back one month.
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
