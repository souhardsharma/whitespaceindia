import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import { InstrumentFooter, InstrumentHeader } from "@/components/instruments/InstrumentChrome";
import { SECTION_HEADING, SMALL_LABEL, Spark, Stat, TD, TH } from "@/components/instruments/meal/parts";
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
    "Daily PM POSHAN meal returns for all 36 States and Union Territories, and for the districts of each State read so far, as the Ministry of Education's national monitoring system holds them: schools listed, schools that reported, enrolment and meals.",
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
  const mdm = mealStates();
  const pages = new Map(mdm.map((s) => [s.st, s.slug]));
  const all: NationalFigures = {
    schools: sumOf(nat.states, "schools"),
    reported: sumOf(nat.states, "reported"),
    holiday: sumOf(nat.states, "holiday"),
    enrolled: sumOf(nat.states, "enrolled"),
    rep_enrolled: sumOf(nat.states, "rep_enrolled"),
    meals: sumOf(nat.states, "meals"),
  };
  const withDistricts = nat.states.filter((s) => s.districts.length);
  const selfDisagree = nat.states.flatMap((s) => (s.district_sum ? [{ s, sum: s.district_sum }] : []));
  // Read before the day's late returns were in (ams_sync.SETTLED_AFTER_DAYS).
  const filling = Boolean(nat.day && nat.read_at
    && Date.parse(nat.read_at) < Date.parse(`${nat.day}T00:00:00+05:30`) + 3 * 86_400_000);
  const readAt = whenIST(nat.read_at);
  // On both systems, but with no row in the meal system's all-States table, which the comparison reads.
  const uncompared = mdm.filter((s) => s.from_districts && nat.states.some((n) => n.st === s.st)
    && !nat.compare.some((row) => row.st === s.st));

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
              This page shows that system&rsquo;s totals for each State and,
              as their tables are read, for each district. The school-by-school tests elsewhere in this
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
                    note={`${count(all.reported)} schools, for ${dayLong(nat.day)}${
                      filling ? ", read while that day's returns were still arriving" : ""}`}
                  />
                  <Stat measure={M.nat_meals} value={count(all.meals)} note={/\d/.test(per100(all)) ? `${per100(all)} per 100 children enrolled in the schools that reported` : per100(all) === "not read" ? "Not read yet" : "No reporting school's enrolment to divide by"} />
                  <Stat measure={M.nat_enrolled} value={count(all.enrolled)} note={`${count(all.holiday)} schools marked by the system as on holiday`} />
                </dl>
                <p className="mt-7 font-body text-[13px] leading-relaxed opacity-70 max-w-3xl">
                  These are the figures for {dayLong(nat.day)}
                  {readAt ? `, read on ${readAt} IST` : ""}. Schools can still file a
                  day&rsquo;s return after that day has passed, so the latest
                  two days are read again each night and their figures can
                  still rise.
                </p>
              </>
            ) : (
              <p className="mt-7 font-body text-[15px] leading-relaxed max-w-3xl border-l-2 pl-4" style={{ borderColor: "#1d5c63" }}>
                The national system has not been read yet. It answers only
                addresses in India, and the nightly run reaches it through
                relays in India that have to be checked afresh each night. The
                tables appear here after the first night on which one of those
                relays works.
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
                    The chart shows {M.nat_meals.label.toLowerCase()} on each
                    day, and the buttons above it switch to{" "}
                    {M.nat_reported_pct.label.toLowerCase()}. The source holds
                    the last {nat.window_days} days. This chart starts on{" "}
                    {nat.first_day ? dayShort(nat.first_day) : "the first day read"} and
                    keeps each day after the source has dropped it. A day is
                    left empty when it has not been read or when no school
                    reported on it.
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
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[860px] border-collapse">
                    <thead>
                      <tr className="border-b border-[#1c1c19]">
                        <th className={TH}>State or UT</th>
                        {figureHeads}
                        <th className={`${TH} text-right`}>Share reporting on each day read</th>
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
                  A State marked &ldquo;schools tested&rdquo; also files into
                  the system this instrument tests school by school.
                </p>
              </div>
            </section>

            {selfDisagree.length ? (
              <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]" aria-labelledby="disagree-heading">
                <div className="max-w-6xl mx-auto">
                  <h2 id="disagree-heading" className={`${SECTION_HEADING} mb-3`}>Where the State row and its districts differ</h2>
                  <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl mb-5">
                    For these States the national system&rsquo;s own district
                    table for {dayShort(nat.day)} adds up to figures that
                    differ from the State&rsquo;s row in the table above. The
                    State row is shown as the system printed it, and the
                    figures beside it are the district rows added up, with
                    neither adjusted. Where the system marks a State as on holiday,
                    its row has so far shown no returns, while its district
                    table counts the schools that did file one.
                  </p>
                  <div className="relative overflow-x-auto">
                    <table className="w-full min-w-[680px] border-collapse">
                      <thead>
                        <tr>
                          <th className={TH} rowSpan={2}>State or UT</th>
                          <th className={`${TH} text-right`} colSpan={3}>State row</th>
                          <th className={`${TH} text-right`} colSpan={3}>Its districts added up</th>
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
                        {selfDisagree.map(({ s, sum }) => (
                          <tr key={s.slug} className="border-b border-[#1c1c19]/15">
                            <td className={TD}><a className={LINK} href={`#${s.slug}`}>{s.name}</a></td>
                            {[s.schools, s.reported, s.meals, sum.schools, sum.reported, sum.meals].map((value, i) => (
                              <td key={i} className={`${TD} text-right`}>{value == null ? "blank" : count(value)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}

            {nat.compare.length ? (
              <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]" aria-labelledby="compare-heading">
                <div className="max-w-6xl mx-auto">
                  <h2 id="compare-heading" className={`${SECTION_HEADING} mb-3`}>The same day in both systems</h2>
                  <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl mb-5">
                    These States appear in both systems, and both were read
                    for {dayShort(nat.day)}. The two list slightly different
                    numbers of schools and were read at different hours, which
                    accounts for small differences. A larger one has no
                    explanation on this page.
                    {selfDisagree.length
                      ? " When the national system has marked a State as on holiday, it has so far printed the State's row with no returns. Where that State's districts counted any return, their totals are in the table of States whose row and districts differ."
                      : ""}
                    {uncompared.map((s) => ` ${s.name} is on both systems but has no row in the meal system's all-States table, which this comparison reads. Its figures there come only from its district table, so it is not compared.`).join("")}
                  </p>
                  <div className="relative overflow-x-auto">
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
                  Every State&rsquo;s district table is asked for each night,
                  and one whose read failed or ran out of time can be a day or
                  two older than the table above. Each State&rsquo;s table states the day it is for.{" "}
                  {withDistricts.length < nat.states.length
                    ? `${count(withDistricts.length)} of ${count(nat.states.length)} States and Union Territories have been read at district level so far.`
                    : ""}
                </p>
                {withDistricts.map((s) => (
                  <details key={s.slug} id={s.slug} className="border-t border-[#1c1c19]/30 group">
                    <summary className="tap-target cursor-pointer py-3.5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                      <span className="font-headline font-bold text-[20px] tracking-[-0.01em]">{s.name}</span>
                      <span className="font-body text-[13px] opacity-75 tabular-nums">
                        {count(s.districts.length)} {s.districts.length === 1 ? "district" : "districts"} &middot;{" "}
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
                  The counts here are totals the national system printed,
                  copied as they stood when read. The share reporting and the
                  meals per 100 enrolled are worked out from those counts. The
                  tests need each school&rsquo;s own figures, and this system
                  is read only to district level, so no flag comes from this
                  page.
                </p>
                <dl className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 max-w-5xl">
                  {[M.nat_schools, M.nat_reported, M.nat_reported_pct, M.nat_holiday, M.nat_enrolled, M.nat_meals, M.nat_meals_pct].map((measure) => (
                    <div key={measure.label}>
                      <dt className={SMALL_LABEL}>{measure.label}</dt>
                      <dd className="font-body text-[13.5px] leading-relaxed opacity-80 mt-1">{measure.definition}</dd>
                    </div>
                  ))}
                </dl>
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
