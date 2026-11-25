import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import { InstrumentFooter, InstrumentHeader } from "@/components/instruments/InstrumentChrome";
import {
  Badge, FlagNotFinding, KindTag, SECTION_HEADING, SMALL_LABEL, Spark, Stat, TD, TH,
} from "@/components/instruments/meal/parts";
import SeriesChart from "@/components/instruments/meal/SeriesChart";
import {
  MEAL_BASE, MEAL_HOST, MEAL_OG, TEAL, count, dayLong, dayShort, districtPath, flagFigures,
  lastOpenDay, schoolPath, share, statePath, whenIST, type DayRow,
} from "@/lib/instruments/meal";
import {
  mealFreshness, mealMeasures, mealMeta, mealRecent, mealStates,
} from "@/lib/instruments/mealServer";

export const metadata = pageMeta({
  path: MEAL_BASE,
  title: "Meal Claims Check: midday meal reports that a school's own filings contradict",
  description:
    "Meal Claims Check reads India's PM POSHAN daily reporting system school by school and flags midday meal counts above the enrolment the school filed, meals reported on a day it does not serve, and one-day spikes. Every flag shows its figures.",
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
              Which schools reported serving more midday meals than the
              enrolment they filed, or reported meals on a day they do not
              serve?
            </p>

            <div className="mt-9 grid grid-cols-1 md:grid-cols-12 gap-8">
              <p className="md:col-span-7 font-body text-[15px] leading-relaxed opacity-80">
                The midday meal (PM POSHAN) is a legal entitlement of children
                in classes I to VIII who enrol and attend school.{" "}
                {count(c.states)} States and Union
                Territories file a daily return for it, school by school, into
                one government system kept by the National Informatics Centre
                in Himachal Pradesh. That system shows the meals each school
                reported for a day and the enrolment each school filed for the
                month, and it never sets one against the other. Meal Claims
                Check reads both, every night, and marks the school-days on
                which they disagree.
              </p>
              <div className="md:col-span-5 md:border-l md:border-[#1c1c19]/20 md:pl-8">
                <p className="font-body text-[14px] leading-relaxed opacity-70">
                  A flag is a contradiction between two figures a school filed
                  on the same system. It is not a finding, and the instrument
                  gives no score and ranks no one. What a flag means is for the
                  school, its block office and anyone auditing the scheme to
                  establish; each flag shows the figures it rests on so they
                  can.
                </p>
              </div>
            </div>

            <dl className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6 pt-8 border-t border-[#1c1c19]/20">
              <Stat measure={M.schools} value={count(c.schools)} />
              <Stat
                measure={M.reported}
                value={count(reported)}
                note={`${share(reported, listed) ?? "no share"} of schools listed, ${dayShort(m.day)}.${
                  shut ? ` In ${count(shut)} of ${count(onDay.length)} States under ${m.thresholds.state_shut_share * 100}% of schools reported that day.` : ""}`}
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
                  `Of these, ${count(c.flag_over_wide)} are above by a wide margin. Most of the rest are above by one or two meals, and a wrong enrolment filing is a likely cause, so each school's page shows the enrolment it filed month by month.`],
                ["closed", M.flag_closed, c.flag_closed,
                  "The closed day is each school's own, learned from its record: a school that rests on Fridays and serves on Sundays is not flagged for serving on a Sunday."],
                ["spike", M.flag_spike, c.flag_spike,
                  "A count many times a school's usual one is often a typing slip. It is shown because the system accepted it and it is in the totals the system reports."],
              ] as const).map(([kind, measure, n, note]) => (
                <div key={kind} className="border-t-2 pt-5" style={{ borderColor: TEAL }}>
                  <KindTag kind={kind} />
                  <div className="font-label font-bold text-[30px] leading-none mt-4 tabular-nums" style={{ color: TEAL }}>
                    {count(n)}
                  </div>
                  <div className={`${SMALL_LABEL} mt-1.5`}>{measure.label}, standing</div>
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
                {M.meals.definition} On {dayLong(m.day)} schools reported{" "}
                {count(meals)} meals. A day with no bar is a day on which the
                system holds no report: schools were closed, or the State or
                the system itself was silent. A missing day is never read as
                children going unfed, and it is never flagged.
              </p>
            </div>
            <div className="md:col-span-8">
              <SeriesChart
                series={series}
                label={`Reports from schools across all States on each of the last ${series.length} days read`}
                mealsLabel={M.meals.label}
                shareLabel={M.reported_pct.label}
                blanks={m.blank_ranges}
              />
            </div>
          </div>
        </section>

        <section className="px-6 md:px-12 py-12 md:py-16 border-b border-[#1c1c19]" aria-labelledby="states-heading">
          <div className="max-w-6xl mx-auto">
            <h2 id="states-heading" className={`${SECTION_HEADING} mb-3`}>Where each test can be run</h2>
            <p className="font-body text-[13.5px] leading-relaxed opacity-70 mb-6 max-w-3xl">
              Meals can be set against enrolment only where a school has filed
              its enrolment for the month, and the share that has differs
              widely by State. A State with few flags below may simply have
              few schools that can be tested. The reporting share is for each
              State&rsquo;s last working day read, dated where that is not{" "}
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
                    return (
                    <tr key={s.st} className="border-b border-[#1c1c19]/15">
                      <td className={TD}>
                        <Link href={statePath(s.slug)} className="underline underline-offset-4 decoration-[#1c1c19]/30 hover:decoration-[#1c1c19]">
                          {s.name}
                        </Link>
                      </td>
                      <td className={`${TD} text-right`}>{count(s.schools)}</td>
                      <td className={`${TD} text-right`}>
                        {open ? share(open[2], open[1]) : share(s.reported, s.schools) ?? "not read"}
                        {open && open[0] !== m.day ? <span className="opacity-60"> ({dayShort(open[0])})</span> : null}
                        {!open && s.series.length ? <span className="opacity-60"> (no working day in {count(s.series.length)} read)</span> : null}
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
                <h2 id="latest-heading" className={SECTION_HEADING}>Most recently flagged</h2>
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
                  School tables are read as a sample. The system is shared by
                  every State on it, so the instrument reads a limited number
                  of its pages each night ({count(fresh.sent)} on the last one)
                  and works through the schools in rotation. A school with no
                  flag may be a school that has not been read yet.
                </li>
                <li>
                  Every figure is what a school or its office filed. The
                  instrument cannot see how many meals were cooked or eaten,
                  and the system holds no attendance data to set them against.
                </li>
                <li>
                  Enrolment is filed by month and many schools file late or
                  not at all. A school that has not filed cannot be tested
                  against enrolment, and a school that filed a wrong figure
                  will be flagged for it.
                </li>
                <li>
                  The States&rsquo; holiday lists on the system are State-wide
                  and incomplete, and no list of vacations exists. A date
                  missing from a list is never treated as a working day, and a
                  school&rsquo;s own weekly holiday is learned from its record
                  alone.
                </li>
                <li>
                  The terms on which the system&rsquo;s figures may be reused
                  are not stated by its publisher. See{" "}
                  <Link href={`${MEAL_BASE}/data`} className="underline underline-offset-4">data and terms</Link>.
                </li>
              </ul>
            </div>
            <div className="md:col-span-5">
              <h2 className={`${SECTION_HEADING} mb-4`}>Source</h2>
              <div className={SMALL_LABEL}>
                Read {whenIST(fresh.checked_at) ?? "at an unknown time"} IST
              </div>
              <div className="font-body text-[13.5px] leading-snug mt-1">
                PM POSHAN daily meal reporting system (
                <a href={MEAL_HOST} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">mdmhp.nic.in</a>
                )
              </div>
              <div className="font-body text-[12px] opacity-75 mt-1">
                National Informatics Centre, Himachal Pradesh, for the
                Department of School Education &amp; Literacy, Ministry of
                Education. Returns are filed by the States&rsquo; education
                departments.
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
