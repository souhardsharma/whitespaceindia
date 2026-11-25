import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import { InstrumentFooter, InstrumentHeader } from "@/components/instruments/InstrumentChrome";
import {
  Badge, FlagNotFinding, KindTag, SECTION_HEADING, SMALL_LABEL, Spark, Stat, TD, TH,
} from "@/components/instruments/meal/parts";
import SeriesChart from "@/components/instruments/meal/SeriesChart";
import {
  AMS_HOST, MEAL_BASE, MEAL_HOST, MEAL_OG, TEAL, UDISE_HOST, count, dayLong, dayShort, districtPath, flagFigures,
  lastOpenDay, schoolPath, share, statePath, whenIST, type DayRow,
} from "@/lib/instruments/meal";
import {
  mealFreshness, mealMeasures, mealMeta, mealRecent, mealStates,
} from "@/lib/instruments/mealServer";

export const metadata = pageMeta({
  path: MEAL_BASE,
  title: "Meal Claims Check: midday meal reports that disagree with other records on the same system",
  description:
    "Meal Claims Check reads the PM POSHAN daily reporting system used by 17 States and Union Territories. Each night it samples school tables and flags a school-day when the meals reported exceed the enrolment the school filed for the month or fall on a day it does not serve. A count far above the school's usual one is flagged as a spike, and every flag is printed with the figures it rests on.",
  image: MEAL_OG,
});

const INSTRUMENTS_TRAIL = { name: "Instruments", path: "/instruments" };

/** What every State's schools reported, day by day, for the chart. */
function allStates(series: DayRow[][]): DayRow[] {
  const days = new Map<string, DayRow>();
  for (const rows of series) {
    for (const [day, schools, reported, meals] of rows) {
      const t = days.get(day) ?? [day, 0, 0, 0];
      days.set(day, [day, t[1] + schools, t[2] + reported, t[3] + meals]);
    }
  }
  return [...days.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

export default function MealClaimsCheck() {
  const m = mealMeta();
  const M = mealMeasures();
  const states = mealStates();
  const fresh = mealFreshness();
  const recent = mealRecent();
  const c = m.counts;

  const onDay = states.filter((s) => s.day === m.day);
  const reported = onDay.reduce((n, s) => n + (s.reported ?? 0), 0);
  const listed = onDay.reduce((n, s) => n + (s.schools ?? 0), 0);
  const meals = onDay.reduce((n, s) => n + (s.meals ?? 0), 0);
  const series = allStates(states.map((s) => s.series));
  const shut = onDay.filter((s) => s.schools && (s.reported ?? 0) / s.schools < m.thresholds.state_shut_share).length;
  const newest = recent.rows.filter((r) => r.standing).slice(0, 8);

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData data={pageLd({ path: MEAL_BASE, name: "Meal Claims Check", description: metadata.description, trail: [INSTRUMENTS_TRAIL] })} />
      <InstrumentHeader crumb="Meal Claims Check" />

      <main id="main-content" className="flex-1">
        <section className="px-6 md:px-12 pt-14 md:pt-20 pb-10 border-b border-[#1c1c19]">
          <div className="max-w-6xl mx-auto">
            <Badge />
            <h1 className="font-headline font-bold text-[clamp(32px,5.4vw,64px)] leading-[1.0] tracking-[-0.03em] max-w-4xl">
              Meal Claims Check
            </h1>
            <p className="mt-5 font-headline italic text-[clamp(18px,2.2vw,27px)] leading-snug max-w-3xl opacity-90">
              Which schools reported more midday meals than the enrolment
              they filed, or reported meals on a day they do not serve?
            </p>

            <div className="mt-9 grid grid-cols-1 md:grid-cols-12 gap-8">
              <p className="md:col-span-7 font-body text-[15px] leading-relaxed opacity-80">
                Children in classes I to VIII who enrol and attend school are
                entitled by law to a midday meal (PM POSHAN). In{" "}
                {count(c.states)} States and Union Territories a daily return
                is filed for each school into one government system, kept by
                the National Informatics Centre in Himachal Pradesh, which
                shows the meals reported for each day beside the enrolment
                filed for the month. Each night Meal Claims Check reads a
                sample of these school tables and flags every school-day in
                them on which the meals exceed that enrolment. It also flags
                meals reported on a day the school does not serve, and a day
                whose count is far above the school&rsquo;s usual one.
              </p>
              <div className="md:col-span-5 md:border-l md:border-[#1c1c19]/20 md:pl-8">
                <p className="font-body text-[14px] leading-relaxed opacity-70">
                  Each flag is printed with the figures it rests on. Once
                  the run has read a flagged school&rsquo;s month, the
                  school&rsquo;s page shows it day by day beside the
                  enrolment filed for each month of the year, which is what
                  its block office would need to trace the flag.
                </p>
              </div>
            </div>

            <dl className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6 pt-8 border-t border-[#1c1c19]/20">
              <Stat measure={M.schools} value={count(c.schools)} />
              <Stat
                measure={M.reported}
                value={count(reported)}
                note={`${share(reported, listed) ? `${share(reported, listed)} of schools listed had reported for ${dayShort(m.day)} when the nightly run read that day.` : `The reporting share for ${dayShort(m.day)} cannot be worked out.`} Returns filed after the read are not counted.${
                  shut ? ` In ${count(shut)} of the ${count(onDay.length)} States, fewer than ${m.thresholds.state_shut_share * 100}% of schools reported that day.` : ""}`}
              />
              <Stat measure={M.school_days_tested} value={count(c.school_days_tested)} />
              <Stat measure={M.schools_flagged} value={count(c.schools_flagged)} />
            </dl>
          </div>
        </section>

        <section className="px-6 md:px-12 py-12 md:py-16 border-b border-[#1c1c19]" aria-labelledby="tests-heading">
          <div className="max-w-6xl mx-auto">
            <h2 id="tests-heading" className={`${SECTION_HEADING} mb-6`}>What is checked</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-10">
              {([
                ["over", M.flag_over, c.flag_over,
                  `${count(c.flag_over_wide)} of these are above by a wide margin. The thresholds were set on an earlier sample, in which ${count(m.calibration.over_by_one_or_two)} of the ${count(m.calibration.over)} excesses were of one or two meals. Because a wrong enrolment filing can put a report above enrolment, each school's page lists the enrolment it filed month by month.`],
                ["closed", M.flag_closed, c.flag_closed,
                  "The weekday rule finds each school's closed day from its own record, so a school that rests on Friday and serves on Sunday is not flagged for a Sunday meal. A Sunday on the State's holiday list can still be flagged."],
                ["spike", M.flag_spike, c.flag_spike,
                  "A typing slip can produce a spike. The figure still stands in the system as filed, and in the one case checked by hand it had been added to the district's total."],
              ] as const).map(([kind, measure, n, note]) => (
                <div key={kind} className="border-t-2 pt-5" style={{ borderColor: TEAL }}>
                  <KindTag kind={kind} />
                  <div className="font-label font-bold text-[30px] leading-none mt-4 tabular-nums" style={{ color: TEAL }}>
                    {count(n)}
                  </div>
                  <div className={`${SMALL_LABEL} mt-1.5`}>{measure.label}, still standing</div>
                  <p className="font-body text-[14px] leading-relaxed mt-4 opacity-85">{measure.definition}</p>
                  <p className="font-body text-[13px] leading-relaxed mt-3 opacity-70">{note}</p>
                </div>
              ))}
            </div>
            <FlagNotFinding className="mt-10 max-w-3xl" />
            <div className="flex flex-wrap gap-3 mt-8">
              {[
                [`${MEAL_BASE}/latest`, "Latest flags"],
                [`${MEAL_BASE}/states`, "By State and district"],
                [`${MEAL_BASE}/national`, "All India"],
                [`${MEAL_BASE}/methodology`, "How each test works"],
              ].map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className="tap-target font-label text-[11px] uppercase tracking-[0.18em] border px-4 py-2.5 transition-colors hover:bg-[#1d5c63] hover:text-[#fcf9f4]"
                  style={{ borderColor: TEAL }}
                >
                  {label} &rarr;
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 md:px-12 py-12 md:py-16 border-b border-[#1c1c19]" aria-labelledby="days-heading">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="md:col-span-4">
              <h2 id="days-heading" className={`${SECTION_HEADING} mb-3`}>What schools reported, day by day</h2>
              <p className="font-body text-[13.5px] leading-relaxed opacity-70">
                {M.meals.definition} On {dayLong(m.day)}, schools reported{" "}
                {count(meals)} meals. A day is left empty when it has not been
                read or no school reported on it, and an empty day raises no
                flag.
              </p>
            </div>
            <div className="md:col-span-8">
              <SeriesChart
                series={series}
                label={`Reports from schools in the ${count(c.states)} States and Union Territories on this system, on each of the last ${series.length} days read`}
                mealsLabel={M.meals.label}
                shareLabel={M.reported_pct.label}
                blanks={m.blank_ranges}
              />
            </div>
          </div>
        </section>

        <section className="px-6 md:px-12 py-12 md:py-16 border-b border-[#1c1c19]" aria-labelledby="states-heading">
          <div className="max-w-6xl mx-auto">
            <h2 id="states-heading" className={`${SECTION_HEADING} mb-3`}>Where the enrolment test can run</h2>
            <p className="font-body text-[13.5px] leading-relaxed opacity-70 mb-6 max-w-3xl">
              The enrolment test needs the school&rsquo;s enrolment for the
              month. The share of schools that have filed one, in the fifth
              column, varies widely between States, so a State with few
              flags may have few schools the test can reach. The reporting
              share in the third column is for each State&rsquo;s last
              working day read, with its date shown where that is not{" "}
              {dayShort(m.day)}.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr className="border-b border-[#1c1c19]">
                    <th className={TH}>State or Union Territory</th>
                    <th className={`${TH} text-right`}>{M.schools.label}</th>
                    <th className={`${TH} text-right`}>{M.reported_pct.label}</th>
                    <th className={TH}>Over the days read<span className="sr-only">: {M.reported_pct.label}</span></th>
                    <th className={`${TH} text-right`}>{M.enr_filed_pct.label}</th>
                    <th className={`${TH} text-right`}>{M.tables_read.label}</th>
                    <th className={`${TH} text-right`}>{M.schools_flagged.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {states.map((s) => {
                    const open = lastOpenDay(s.series, m.thresholds.state_open_share);
                    // No day reached the open share: the latest day any school reported, so
                    // a State whose few schools file every day does not read as none.
                    const some = open ? null : [...s.series].reverse().find((r) => r[2] > 0) ?? null;
                    return (
                    <tr key={s.st} className="border-b border-[#1c1c19]/15">
                      <td className={TD}>
                        <Link href={statePath(s.slug)} className="underline underline-offset-4 decoration-[#1c1c19]/30 hover:decoration-[#1c1c19]">
                          {s.name}
                        </Link>
                      </td>
                      <td className={`${TD} text-right`}>{count(s.schools)}</td>
                      <td className={`${TD} text-right`}>
                        {open ? share(open[2], open[1]) : some ? share(some[2], some[1]) : share(s.reported, s.schools) ?? "not read"}
                        {open && open[0] !== m.day ? <span className="opacity-60"> ({dayShort(open[0])})</span> : null}
                        {some ? (
                          <span className="opacity-60">
                            {" "}({dayShort(some[0])}; under {m.thresholds.state_open_share * 100}% on every one of {count(s.series.length)} days read)
                          </span>
                        ) : null}
                        {!open && !some && s.series.length ? <span className="opacity-60"> (none reported on any of {count(s.series.length)} days read)</span> : null}
                      </td>
                      <td className={TD}><Spark series={s.series} label={M.reported_pct.label} /></td>
                      <td className={`${TD} text-right`}>{share(s.enr_filed, s.enr_schools) ?? "not read"}</td>
                      <td className={`${TD} text-right`}>{count(s.tables_read)}</td>
                      <td className={`${TD} text-right`}>{count(s.schools_flagged)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {newest.length ? (
          <section className="px-6 md:px-12 py-12 md:py-16 border-b border-[#1c1c19]" aria-labelledby="latest-heading">
            <div className="max-w-6xl mx-auto">
              <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
                <h2 id="latest-heading" className={SECTION_HEADING}>Recent flags</h2>
                <Link
                  href={`${MEAL_BASE}/latest`}
                  className="font-label text-[11px] uppercase tracking-[0.18em] hover:underline underline-offset-4"
                  style={{ color: TEAL }}
                >
                  All latest flags &rarr;
                </Link>
              </div>
              <ul className="border-t border-[#1c1c19]">
                {newest.map((r) => (
                  <li key={`${r.k}-${r.day}-${r.kind}`} className="py-3.5 border-b border-[#1c1c19]/15 grid grid-cols-1 md:grid-cols-12 gap-x-6 gap-y-1 items-baseline">
                    <div className="md:col-span-5 font-body text-[14.5px] leading-snug">
                      <Link href={schoolPath(r.k)} prefetch={false} className="underline underline-offset-4 decoration-[#1c1c19]/30 hover:decoration-[#1c1c19]">
                        {r.name}
                      </Link>
                      <span className="block font-body text-[12px] opacity-70 mt-0.5">
                        <Link href={districtPath(r.st, r.dc)} prefetch={false} className="hover:underline underline-offset-4">
                          {r.district}
                        </Link>
                        , {states.find((s) => s.st === r.st)?.name}
                      </span>
                    </div>
                    <div className="md:col-span-2 font-label text-[12px] tabular-nums">{dayShort(r.day)}</div>
                    <div className="md:col-span-2"><KindTag kind={r.kind} wide={r.wide} /></div>
                    <div className="md:col-span-3 font-body text-[13.5px] tabular-nums">{flagFigures(r)}</div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <section className="px-6 md:px-12 py-12 border-[#1c1c19] bg-[#f6f3ee]">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="md:col-span-7">
              <h2 className={`${SECTION_HEADING} mb-4`}>Limits of the data</h2>
              <ul className="font-body text-[14px] leading-relaxed opacity-80 space-y-3 list-disc pl-4">
                <li>
                  All {count(c.states)} States and Union Territories file
                  into this one system, so the nightly run limits its
                  requests to it ({count(fresh.sent)} last night) and reads
                  school tables as a sample, working through the clusters in
                  turn. A school with no flag may not have been read yet.
                </li>
                <li>
                  Every figure is a filed return, so how many meals were
                  cooked or eaten cannot be seen from here,
                  and the system has no attendance figures to compare with.
                </li>
                <li>
                  Enrolment is filed by month, many schools file it late, and in Rajasthan almost none file it. A
                  school that has not filed cannot be tested against
                  enrolment, and a school that filed too low a figure is
                  flagged on every day its meals exceed it.
                </li>
                <li>
                  The holiday lists on the system cover whole States, and
                  several leave out the State&rsquo;s vacations, so a date
                  missing from a list is not taken as proof that schools
                  were open. The lists give no school&rsquo;s weekly rest,
                  which is worked out from the school&rsquo;s own record.
                </li>
                <li>
                  None of the three government sources states terms for
                  reusing its figures. This site&rsquo;s own work is under CC BY
                  4.0, and the{" "}
                  <Link href={`${MEAL_BASE}/data`} className="underline underline-offset-4">data page</Link>{" "}
                  sets out what that covers.
                </li>
              </ul>
            </div>
            <div className="md:col-span-5">
              <h2 className={`${SECTION_HEADING} mb-4`}>Sources</h2>
              <div className={SMALL_LABEL}>
                {whenIST(fresh.checked_at) ? `Read ${whenIST(fresh.checked_at)} IST` : "Time of the last read not recorded"}
              </div>
              <div className="font-body text-[13.5px] leading-snug mt-1">
                PM POSHAN daily meal reporting system (
                <a href={MEAL_HOST} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">mdmhp.nic.in</a>
                )
              </div>
              <div className="font-body text-[12px] opacity-75 mt-1">
                National Informatics Centre, Himachal Pradesh, for the
                Department of School Education &amp; Literacy, Ministry of
                Education. Daily returns are filed into it for each school.
              </div>
              <div className="font-body text-[13.5px] leading-snug mt-4">
                PM POSHAN Automated Monitoring System (
                <a href={AMS_HOST} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">pmposhan-ams.education.gov.in</a>
                )
              </div>
              <div className="font-body text-[12px] opacity-75 mt-1">
                Department of School Education &amp; Literacy, Ministry of
                Education. It holds daily returns for schools in every State
                and Union Territory. Its State totals are read for all 36,
                and its district totals for each State whose district table
                has been read.
              </div>
              <div className="font-body text-[13.5px] leading-snug mt-4">
                UDISE+ school report card (
                <a href={UDISE_HOST} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">kys.udiseplus.gov.in</a>
                )
              </div>
              <div className="font-body text-[12px] opacity-75 mt-1">
                UDISE+ is the Ministry of Education&rsquo;s yearly register
                of schools. Each flagged school&rsquo;s entry is read there
                for its classes and management and for its free-textbook
                counts.
              </div>
              <Link
                href={`${MEAL_BASE}/methodology`}
                className="inline-flex items-center gap-2 mt-6 font-label text-[11px] uppercase tracking-[0.18em] hover:gap-3 transition-all"
                style={{ color: TEAL }}
              >
                Full methodology <span aria-hidden="true">&rarr;</span>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <InstrumentFooter instrument="meal-claims" />
    </div>
  );
}
