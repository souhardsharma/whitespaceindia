import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import { InstrumentFooter, InstrumentHeader } from "@/components/instruments/InstrumentChrome";
import { SECTION_HEADING, SMALL_LABEL, TD, TH } from "@/components/instruments/meal/parts";
import { AMS_HOST, MEAL_BASE, MEAL_DATA, MEAL_HOST, MEAL_OG, UDISE_HOST, count, monthLabel } from "@/lib/instruments/meal";
import { mealMeasures, mealMeta, mealStates } from "@/lib/instruments/mealServer";

/**
 * The files the pages are drawn from: static JSON and CSV, rebuilt nightly,
 * no key.
 *
 * The licence covers what this site adds (flags, counts of what was read,
 * the arrangement). The figures inside are the government sources', whose
 * publishers state no terms of reuse, so the page claims nothing over them
 * and carries no Dataset markup, which would have to name one licence for
 * the whole. LICENSE-DATA.md says the same.
 */

const PATH = `${MEAL_BASE}/data`;
const TITLE = "Data and terms | Meal Claims Check";
const DESCRIPTION =
  "The files Meal Claims Check publishes each night: every flag as CSV, State and district tables, flagged schools' months, the definition of every figure, and the terms for reusing them.";

export const metadata = pageMeta({ path: PATH, title: TITLE, description: DESCRIPTION, image: MEAL_OG });

const FILES: [string, string][] = [
  ["meta.json", "Counts, the thresholds of each test, the span of days read, the months published, and the measurements the thresholds were checked against."],
  ["freshness.json", "When the source was last read, the day it was read for, how many requests were sent and whether the read was complete."],
  ["measures.json", "The label, definition, formula and source of every figure shown."],
  ["states.json", "One row per State: schools listed, reporting and filing enrolment, tables read, flags, and the daily series."],
  ["state/<code>.json", "One State: its daily series, every district with its blocks and flagged schools, and the days it was shut while some schools reported."],
  ["history/<code>/<year>.json", "One State and one year: for each district, a row for every day its table was read. A row is the day, schools listed, schools that filed enrolment, enrolment filed, schools that reported and meals reported. The years each State has are listed in states.json as `history_years`."],
  ["roster/<code>-<district>.json", "Every school read in one district. `schools` rows are the school's key (code and shift), its name, its cluster's code, the enrolment it filed (null when none) and the meals it reported (null when no report). `clusters` gives each cluster's name, block, the date its latest table is for and how many dates have been read."],
  ["flags/<yyyy-mm>.csv", "Every flag on a school-day of that month, standing or not. The columns are below."],
  ["flags/recent.json", "Flags first seen in recent nights, each with the figures it rests on. `seen` points into `stamps`, the list of builds."],
  ["schools/<yyyy-mm>/<bucket>.json", "For each flagged school: the month day by day, the enrolment filed for each month of the year, its flags, and under `udise` its entry in UDISE+ where one has been read. The bucket is the school code modulo the `buckets` value in meta.json, two digits."],
  ["holidays.json", "Each State's holiday list as the system gives it: date and reason."],
  ["national.json", "The national system's totals. For each of the 36 States and Union Territories it holds the latest day read, the daily series and the latest district table. For States on both systems it sets the same day side by side. `read` is false until the national system has been read."],
  ["national/states.csv", "Every State-day read from the national system. Columns: date, state, schools, schools_reported, schools_on_holiday, enrolment, children_approved, enrolment_in_reporting_schools, meals."],
  ["national/districts-<yyyy-mm>.csv", "Every district-day read from the national system in that month. The columns are those of states.csv with district added and children_approved left out; the source gives that figure for States only."],
];

const COLUMNS: [string, string][] = [
  ["state, district, block, cluster", "Where the system lists the school."],
  ["school_code, shift", "The system's code for the school and the shift the report is for."],
  ["school_name", "The institution's name as the system writes it."],
  ["date", "The school-day the flag concerns."],
  ["flag", "over (meals above filed enrolment), closed (meals on a closed day) or spike (one-day spike)."],
  ["meals_reported", "Meals the school reported for the date, as first read."],
  ["enrolment_filed", "For over: the enrolment the school filed for the month."],
  ["usual_daily_count", "For spike: the median of the school's other serving days read."],
  ["closed_day_rule", "For closed: weekday (the school's own record) or holiday (the State's list)."],
  ["first_seen", "The date of the build in which the flag first appeared."],
  ["still_stands", "no when a later read of the same day no longer supports the flag."],
  ["meals_as_last_read", "On a flag that no longer stands: what the day reads now."],
];

export default function MealData() {
  const m = mealMeta();
  const M = mealMeasures();
  const states = mealStates();

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData
        data={pageLd({
          path: PATH, name: "Data and terms", description: DESCRIPTION,
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
            Data and terms
          </h1>
          <p className="mt-5 font-body text-[15px] leading-relaxed opacity-80 max-w-3xl">
            Each page of the instrument is drawn from the files listed here.
            They are rebuilt once a night and need no key. All paths below
            are under <code className="font-label text-[13px]">{MEAL_DATA}/</code>.
          </p>

          <section className="mt-12 pt-8 border-t border-[#1c1c19]" aria-labelledby="csv-heading">
            <h2 id="csv-heading" className={`${SECTION_HEADING} mb-4`}>Every flag, by month</h2>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 font-body text-[14px]">
              {[...m.csv_months].reverse().map((month) => (
                <li key={month}>
                  <a href={`${MEAL_DATA}/flags/${month}.csv`} className="underline underline-offset-4">
                    {monthLabel(month)} (CSV)
                  </a>
                </li>
              ))}
            </ul>
            <div className="overflow-x-auto mt-7">
              <table className="w-full min-w-[620px] max-w-4xl border-collapse">
                <thead>
                  <tr className="border-b border-[#1c1c19]">
                    <th className={TH}>Column</th>
                    <th className={TH}>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {COLUMNS.map(([col, what]) => (
                    <tr key={col} className="border-b border-[#1c1c19]/15">
                      <td className={`${TD} font-label text-[12.5px] whitespace-nowrap`}>{col}</td>
                      <td className={TD}>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-12 pt-8 border-t border-[#1c1c19]" aria-labelledby="files-heading">
            <h2 id="files-heading" className={`${SECTION_HEADING} mb-4`}>The files</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] max-w-4xl border-collapse">
                <thead>
                  <tr className="border-b border-[#1c1c19]">
                    <th className={TH}>File</th>
                    <th className={TH}>Holds</th>
                  </tr>
                </thead>
                <tbody>
                  {FILES.map(([file, what]) => (
                    <tr key={file} className="border-b border-[#1c1c19]/15">
                      <td className={`${TD} font-label text-[12.5px] whitespace-nowrap`}>
                        {file.includes("<") ? file : (
                          <a href={`${MEAL_DATA}/${file}`} className="underline underline-offset-4">{file}</a>
                        )}
                      </td>
                      <td className={TD}>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="font-body text-[13.5px] leading-relaxed opacity-80 mt-5 max-w-3xl">
              State codes: {states.map((s) => `${s.st} ${s.name}`).join(", ")}.
              School files are kept for the last {count(m.months.length)}{" "}
              {m.months.length === 1 ? "month" : "months"} read; the CSVs keep
              every month.
            </p>
          </section>

          <section className="mt-12 pt-8 border-t border-[#1c1c19]" aria-labelledby="measures-heading">
            <h2 id="measures-heading" className={`${SECTION_HEADING} mb-4`}>What each figure means</h2>
            <dl className="max-w-4xl">
              {Object.entries(M).map(([key, measure]) => (
                <div key={key} className="py-3.5 border-b border-[#1c1c19]/15 grid grid-cols-1 md:grid-cols-12 gap-x-6 gap-y-1">
                  <dt className="md:col-span-4 font-body text-[14px] font-semibold">
                    {measure.label}
                    <span className="block font-label text-[11px] font-normal opacity-60 mt-0.5">{key}</span>
                  </dt>
                  <dd className="md:col-span-8 font-body text-[13.5px] leading-relaxed">
                    {measure.definition}
                    {measure.formula ? <span className="block font-label text-[12px] opacity-75 mt-1">{measure.formula}</span> : null}
                    <span className="block text-[12px] opacity-60 mt-1">{measure.source}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="mt-12 pt-8 border-t border-[#1c1c19]" aria-labelledby="terms-heading">
            <h2 id="terms-heading" className={`${SECTION_HEADING} mb-4`}>Terms</h2>
            <div className="font-body text-[14.5px] leading-relaxed space-y-4 max-w-3xl">
              <p>
                The meal counts, enrolments, holiday lists and school names in
                these files come from the PM POSHAN daily reporting system at{" "}
                <a href={MEAL_HOST} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">mdmhp.nic.in</a>,
                where State education departments file them and anyone can
                read them without a login. The entries under{" "}
                <code className="font-label text-[13px]">udise</code> come
                from the Ministry of Education&rsquo;s school report card at{" "}
                <a href={UDISE_HOST} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">kys.udiseplus.gov.in</a>.
                The files under{" "}
                <code className="font-label text-[13px]">national</code> come
                from the Ministry&rsquo;s monitoring system at{" "}
                <a href={AMS_HOST} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">pmposhan-ams.education.gov.in</a>.
                None of the three sets out terms for reusing its figures. They
                are reproduced here as filed, with the source named, and this
                site claims no rights over them. If you reuse them, credit
                the system they came from.
              </p>
              <p>
                What this site adds is under{" "}
                <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer license" className="underline underline-offset-4">CC BY 4.0</a>:
                the flags, the counts of what has been read, and the way the
                files are put together. Credit Whitespace India and link to
                this page. A flag reused elsewhere should be described as it
                is here, as two filed figures that disagree. It is not a
                finding about a school. The code that produces the files is
                under AGPL-3.0-or-later.
              </p>
              <p>
                The files hold no personal data. They contain counts, codes,
                dates and the names of institutions. How they are made is on{" "}
                <Link href={`${MEAL_BASE}/methodology`} className="underline underline-offset-4">the methodology page</Link>.
              </p>
            </div>
          </section>
        </div>
      </main>

      <InstrumentFooter instrument="meal-claims" />
    </div>
  );
}
