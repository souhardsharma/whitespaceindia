import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import { InstrumentFooter, InstrumentHeader } from "@/components/instruments/InstrumentChrome";
import { SECTION_HEADING, Spark, Stat, TD, TH } from "@/components/instruments/meal/parts";
import SeriesChart from "@/components/instruments/meal/SeriesChart";
import {
  AMS_HOST, MEAL_BASE, MEAL_DATA, MEAL_HOST, MEAL_OG, count, dayLong, dayShort, monthLabel, share, statePath,
  sumOf, whenIST,
} from "@/lib/instruments/meal";
import type { NationalFigures } from "@/lib/instruments/meal";
import { mealMeasures, mealNational, mealStates } from "@/lib/instruments/mealServer";

const PATH = `${MEAL_BASE}/national`;

export const metadata = pageMeta({
  path: PATH,
  title: "Midday meal reporting in every State and UT | Meal Claims Check",
  description:
    "Daily PM POSHAN meal returns for all 36 States and Union Territories and their districts, as the Ministry of Education's national monitoring system holds them: schools listed, schools that reported, enrolment and meals.",
  image: MEAL_OG,
});

const TRAIL = [
  { name: "Instruments", path: "/instruments" },
  { name: "Meal Claims Check", path: MEAL_BASE },
];

const LINK = "underline underline-offset-4 decoration-[#1c1c19]/30 hover:decoration-[#1c1c19]";

function per100(f: NationalFigures): string {
  if (f.meals == null || f.rep_enrolled == null) return "not read";
  if (!f.rep_enrolled) return "no return";
  return (Math.round((f.meals / f.rep_enrolled) * 1000) / 10).toFixed(1);
}

function FigureCells({ f }: { f: NationalFigures }) {
  return (
    <>
      <td className={`${TD} text-right`}>{count(f.schools)}</td>
      <td className={`${TD} text-right`}>{share(f.reported, f.schools) ?? "not read"}</td>
      <td className={`${TD} text-right`}>{count(f.holiday)}</td>
      <td className={`${TD} text-right`}>{count(f.enrolled)}</td>
      <td className={`${TD} text-right`}>{count(f.meals)}</td>
      <td className={`${TD} text-right`}>{per100(f)}</td>
    </>
  );
}

export default function MealNational() {
  const nat = mealNational();
  const M = mealMeasures();
  const pages = new Map(mealStates().map((s) => [s.st, s.slug]));
  const all: NationalFigures = {
    schools: sumOf(nat.states, "schools"),
    reported: sumOf(nat.states, "reported"),
    holiday: sumOf(nat.states, "holiday"),
    enrolled: sumOf(nat.states, "enrolled"),
    rep_enrolled: sumOf(nat.states, "rep_enrolled"),
    meals: sumOf(nat.states, "meals"),
  };
  const withDistricts = nat.states.filter((s) => s.districts.length);
  const readAt = whenIST(nat.read_at);

  const figureHeads = (
    <>
      <th className={`${TH} text-right`}>{M.nat_schools.label}</th>
      <th className={`${TH} text-right`}>{M.nat_reported_pct.label}</th>
      <th className={`${TH} text-right`}>{M.nat_holiday.label}</th>
      <th className={`${TH} text-right`}>{M.nat_enrolled.label}</th>
      <th className={`${TH} text-right`}>{M.nat_meals.label}</th>
      <th className={`${TH} text-right`}>{M.nat_meals_pct.label}</th>
    </>
  );

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData data={pageLd({ path: PATH, name: "All India", description: metadata.description, trail: TRAIL, type: "CollectionPage" })} />
      <InstrumentHeader crumb="Meal Claims Check" crumbHref={MEAL_BASE} />

      <main id="main-content" className="flex-1">
        <section className="px-6 md:px-12 pt-12 md:pt-16 pb-10 border-b border-[#1c1c19]">
          <div className="max-w-6xl mx-auto">
            <h1 className="font-headline font-bold text-[clamp(28px,4.4vw,52px)] leading-[1.02] tracking-[-0.03em] max-w-4xl">
              Midday meal reporting in every State and Union Territory
            </h1>
            <p className="mt-5 font-body text-[15px] leading-relaxed opacity-80 max-w-3xl">
              Each State sends its schools&rsquo; daily meal returns to the
              Ministry of Education&rsquo;s monitoring system at{" "}
              <a href={AMS_HOST} target="_blank" rel="noopener noreferrer" className={LINK}>pmposhan-ams.education.gov.in</a>.
              This page shows that system&rsquo;s totals for each State and
              each district. The school-by-school tests elsewhere in this
              instrument use a different system,{" "}
              <a href={MEAL_HOST} target="_blank" rel="noopener noreferrer" className={LINK}>mdmhp.nic.in</a>,
              which {count(pages.size)} States and Union Territories file
              into.
            </p>
            {nat.read && nat.day ? (
              <>
                <dl className="mt-9 grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6 pt-8 border-t border-[#1c1c19]/20">
                  <Stat measure={M.nat_schools} value={count(all.schools)} note={`in ${count(nat.states.length)} States and Union Territories`} />
                  <Stat
                    measure={M.nat_reported_pct}
                    value={share(all.reported, all.schools) ?? "not read"}
                    note={`${count(all.reported)} schools, for ${dayLong(nat.day)}`}
                  />
                  <Stat measure={M.nat_meals} value={count(all.meals)} note={`${per100(all)} per 100 children enrolled in the schools that reported`} />
                  <Stat measure={M.nat_enrolled} value={count(all.enrolled)} note={`${count(all.holiday)} schools were on holiday`} />
                </dl>
                <p className="mt-7 font-body text-[13px] leading-relaxed opacity-70 max-w-3xl">
                  These are the figures for {dayLong(nat.day)}
                  {readAt ? `, read on ${readAt}` : ""}. Schools go on filing
                  for a day after it has passed, so the latest two days are
                  read again each night and their figures can still rise.
                </p>
              </>
            ) : (
              <p className="mt-7 font-body text-[15px] leading-relaxed max-w-3xl border-l-2 pl-4" style={{ borderColor: "#1d5c63" }}>
                The national system has not been read yet. It answers only
                addresses in India, and the nightly run reaches it through
                Indian routes that have to be found afresh each night. The
                tables appear here after the first night on which one held.
              </p>
            )}
          </div>
        </section>

        {nat.read && nat.day ? (
          <>
            <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]" aria-labelledby="days-heading">
              <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8">
                <div className="md:col-span-4">
                  <h2 id="days-heading" className={`${SECTION_HEADING} mb-3`}>All India, day by day</h2>
                  <p className="font-body text-[13.5px] leading-relaxed opacity-70">
                    {M.nat_meals.definition} The source shows the last{" "}
                    {nat.window_days} days and nothing older. This chart
                    starts on {nat.first_day ? dayShort(nat.first_day) : "the first day read"} and
                    keeps each day after the source has dropped it. A day
                    with no bar has not been read.
                  </p>
                </div>
                <div className="md:col-span-8">
                  <SeriesChart
                    series={nat.series}
                    label={`Returns from schools across India on each of the last ${nat.series.length} days read`}
                    mealsLabel={M.nat_meals.label}
                    shareLabel={M.nat_reported_pct.label}
                  />
                </div>
              </div>
            </section>

            <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]" aria-labelledby="states-heading">
              <div className="max-w-6xl mx-auto">
                <h2 id="states-heading" className={`${SECTION_HEADING} mb-5`}>
                  Each State and Union Territory on {dayShort(nat.day)}
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] border-collapse">
                    <thead>
                      <tr className="border-b border-[#1c1c19]">
                        <th className={TH}>State or UT</th>
                        {figureHeads}
                        <th className={`${TH} text-right`}>Share reporting, days read</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nat.states.map((s) => {
                        const slug = s.st ? pages.get(s.st) : undefined;
                        return (
                          <tr key={s.slug} className="border-b border-[#1c1c19]/15">
                            <td className={TD}>
                              {s.districts.length ? <a href={`#${s.slug}`} className={LINK}>{s.name}</a> : s.name}
                              {slug ? (
                                <>
                                  {" "}
                                  <Link href={statePath(slug)} className="font-label text-[9px] uppercase tracking-[0.16em] opacity-70 hover:opacity-100 whitespace-nowrap">
                                    schools tested &rarr;
                                  </Link>
                                </>
                              ) : null}
                            </td>
                            <FigureCells f={s} />
                            <td className={`${TD} text-right`}>
                              <Spark series={s.series} label={`Share of schools reporting in ${s.name}`} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[#1c1c19]">
                        <td className={`${TD} font-bold`}>All India</td>
                        <FigureCells f={all} />
                        <td className={TD} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="mt-5 font-body text-[13px] leading-relaxed opacity-70 max-w-3xl">
                  {M.nat_holiday.definition} {M.nat_meals_pct.definition} A
                  State marked &ldquo;schools tested&rdquo; also files into
                  the system this instrument tests school by school.
                </p>
              </div>
            </section>

            {nat.compare.length ? (
              <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]" aria-labelledby="compare-heading">
                <div className="max-w-6xl mx-auto">
                  <h2 id="compare-heading" className={`${SECTION_HEADING} mb-3`}>The same day in both systems</h2>
                  <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl mb-5">
                    These States appear in both systems, and both were read
                    for {dayShort(nat.day)}. The two keep separate school
                    lists and were read at different hours, so small
                    differences are expected. A large one means the two
                    systems hold different returns for the State.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] border-collapse">
                      <thead>
                        <tr className="border-b border-[#1c1c19]">
                          <th className={TH} rowSpan={2}>State or UT</th>
                          <th className={`${TH} text-right`} colSpan={3}>mdmhp.nic.in</th>
                          <th className={`${TH} text-right`} colSpan={3}>pmposhan-ams.education.gov.in</th>
                        </tr>
                        <tr className="border-b border-[#1c1c19]">
                          {[0, 1].map((side) => (
                            [M.nat_schools.label, M.nat_reported.label, M.nat_meals.label].map((label) => (
                              <th key={`${side}-${label}`} className={`${TH} text-right`}>{label}</th>
                            ))
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {nat.compare.map((row) => (
                          <tr key={row.st} className="border-b border-[#1c1c19]/15">
                            <td className={TD}>{row.name}</td>
                            {[...row.here, ...row.national].map((value, i) => (
                              <td key={i} className={`${TD} text-right`}>{count(value)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]" aria-labelledby="districts-heading">
              <div className="max-w-6xl mx-auto">
                <h2 id="districts-heading" className={`${SECTION_HEADING} mb-3`}>Districts</h2>
                <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl mb-6">
                  District tables are read one State at a time, so a
                  State&rsquo;s table can be a day or two older than the
                  table above. Each says which day it is for.{" "}
                  {withDistricts.length < nat.states.length
                    ? `${count(withDistricts.length)} of ${count(nat.states.length)} States and Union Territories have been read at district level so far.`
                    : ""}
                </p>
                {withDistricts.map((s) => (
                  <details key={s.slug} id={s.slug} className="border-t border-[#1c1c19]/30 group">
                    <summary className="tap-target cursor-pointer py-3.5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                      <span className="font-headline font-bold text-[20px] tracking-[-0.01em]">{s.name}</span>
                      <span className="font-body text-[13px] opacity-75 tabular-nums">
                        {count(s.districts.length)} districts &middot;{" "}
                        {share(sumOf(s.districts, "reported"), sumOf(s.districts, "schools")) ?? "no share"} reported
                        {s.district_day ? ` on ${dayShort(s.district_day)}` : ""}
                      </span>
                    </summary>
                    <div className="overflow-x-auto pb-6">
                      <table className="w-full min-w-[760px] border-collapse">
                        <thead>
                          <tr className="border-b border-[#1c1c19]">
                            <th className={TH}>District</th>
                            {figureHeads}
                          </tr>
                        </thead>
                        <tbody>
                          {s.districts.map((d) => (
                            <tr key={d.name} className="border-b border-[#1c1c19]/15">
                              <td className={TD}>{d.name}</td>
                              <FigureCells f={d} />
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            </section>

            <section className="px-6 md:px-12 py-10 bg-[#f6f3ee]">
              <div className="max-w-6xl mx-auto">
                <h2 className={`${SECTION_HEADING} mb-3`}>Reading these tables</h2>
                <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl">
                  Every figure here is a total the national system printed,
                  copied as it stood when read. No test is run on them and
                  no flag is raised from them: the tests need a
                  school&rsquo;s own month, and only State and district
                  totals are read here. {M.nat_enrolled.definition}{" "}
                  {M.nat_reported.definition}
                </p>
                <p className="mt-4 font-body text-[14px] leading-relaxed opacity-80 max-w-3xl">
                  Every State-day read is in{" "}
                  <a href={`${MEAL_DATA}/national/states.csv`} className={LINK}>states.csv</a>
                  {nat.district_months.length ? (
                    <>
                      , and every district-day in one file a month:{" "}
                      {nat.district_months.map((month, i) => (
                        <span key={month}>
                          {i ? ", " : ""}
                          <a href={`${MEAL_DATA}/national/districts-${month}.csv`} className={LINK}>{monthLabel(month)}</a>
                        </span>
                      ))}
                    </>
                  ) : null}
                  . The <Link href={`${MEAL_BASE}/data`} className={LINK}>data page</Link> lists
                  the columns.
                </p>
              </div>
            </section>
          </>
        ) : null}
      </main>

      <InstrumentFooter instrument="meal-claims" />
    </div>
  );
}
