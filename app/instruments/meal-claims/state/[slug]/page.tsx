import Link from "next/link";
import { notFound } from "next/navigation";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import { InstrumentFooter, InstrumentHeader } from "@/components/instruments/InstrumentChrome";
import {
  FlagNotFinding, SECTION_HEADING, SMALL_LABEL, Stat, TD, TH,
} from "@/components/instruments/meal/parts";
import SeriesChart from "@/components/instruments/meal/SeriesChart";
import {
  MEAL_BASE, MEAL_OG, count, counted, dayLong, dayShort, districtPath, lastOpenDay, monthLabel, share, statePath,
  whenIST,
} from "@/lib/instruments/meal";
import {
  mealHolidays, mealMeasures, mealMeta, mealState, mealStates, stateBySlug,
} from "@/lib/instruments/mealServer";

export const dynamicParams = false;

export function generateStaticParams() {
  return mealStates().map((s) => ({ slug: s.slug }));
}

type Props = { params: Promise<{ slug: string }> };

function describe(name: string) {
  return {
    title: `${name}: midday meal reports and flags by district | Meal Claims Check`,
    description: `Midday meal (PM POSHAN) daily reporting in ${name}: the schools listed, the share that report, the share that filed enrolment, and the schools in each district with a flag.`,
  };
}

export async function generateMetadata({ params }: Props) {
  const state = stateBySlug((await params).slug);
  if (!state) return {};
  return pageMeta({ path: statePath(state.slug), ...describe(state.name), image: MEAL_OG });
}

export default async function MealState({ params }: Props) {
  const s = stateBySlug((await params).slug);
  if (!s) notFound();
  const M = mealMeasures();
  const meta = mealMeta();
  const open = lastOpenDay(s.series, meta.thresholds.state_open_share);
  const file = mealState(s.st);
  const holidays = mealHolidays()[s.st];
  // A date can be listed twice under two reasons; it is one date.
  const holidayDates = new Set(holidays?.days.map((d) => d.date)).size;
  const vacationDates = new Set(holidays?.days.filter((d) => /vacation/i.test(d.reason)).map((d) => d.date)).size;
  const path = statePath(s.slug);
  const flags = s.flag_over + s.flag_closed + s.flag_spike;

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData
        data={pageLd({
          path, name: s.name, description: describe(s.name).description, type: "CollectionPage",
          trail: [
            { name: "Instruments", path: "/instruments" },
            { name: "Meal Claims Check", path: MEAL_BASE },
            { name: "By State and district", path: `${MEAL_BASE}/states` },
          ],
        })}
      />
      <InstrumentHeader crumb="Meal Claims Check" crumbHref={MEAL_BASE} />

      <main id="main-content" className="flex-1">
        <section className="px-6 md:px-12 pt-12 md:pt-16 pb-10 border-b border-[#1c1c19]">
          <div className="max-w-6xl mx-auto">
            <Link href={`${MEAL_BASE}/states`} className={`${SMALL_LABEL} hover:opacity-100`}>
              &larr; All States
            </Link>
            <h1 className="mt-4 font-headline font-bold text-[clamp(30px,4.8vw,56px)] leading-[1.0] tracking-[-0.03em]">
              {s.name}
            </h1>
            <p className="mt-4 font-headline italic text-[clamp(17px,2vw,23px)] leading-snug max-w-3xl opacity-90">
              Midday meal reports as filed for its schools
              {s.day ? `, read for ${dayLong(s.day)}` : ""}
            </p>

            <dl className="mt-9 grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6 pt-8 border-t border-[#1c1c19]/20">
              <Stat measure={M.schools} value={count(s.schools)} />
              <Stat
                measure={M.reported_pct}
                value={share(s.reported, s.schools) ?? "not read"}
                note={`${count(s.reported)} schools, ${count(s.meals)} meals reported${
                  open && open[0] !== s.day
                    ? `. On ${dayShort(open[0])}, its last working day read, ${share(open[2], open[1])} reported`
                    : ""}`}
              />
              <Stat
                measure={M.enr_filed_pct}
                value={share(s.enr_filed, s.enr_schools) ?? "not read"}
                note={s.enr_day ? `enrolment for ${monthLabel(s.enr_day.slice(0, 7))}` : undefined}
              />
              <Stat
                measure={M.schools_flagged}
                value={count(s.schools_flagged)}
                note={`${counted(flags, "flag")}, from ${counted(s.tables_read, "school table")} and the months of the schools they named`}
              />
            </dl>
            <FlagNotFinding className="mt-9 max-w-3xl" />
          </div>
        </section>

        <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]" aria-labelledby="days-heading">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="md:col-span-4">
              <h2 id="days-heading" className={`${SECTION_HEADING} mb-3`}>Meals reported, day by day</h2>
              <p className="font-body text-[13.5px] leading-relaxed opacity-70">
                {M.meals.definition} A day is left empty when it has not been
                read or no school reported on it, and an empty day raises no
                flag.
              </p>
            </div>
            <div className="md:col-span-8">
              <SeriesChart
                series={file.series}
                label={`Reports from schools in ${s.name} on each of the last ${file.series.length} days read`}
                mealsLabel={M.meals.label}
                shareLabel={M.reported_pct.label}
                blanks={meta.blank_ranges}
              />
            </div>
          </div>
        </section>

        <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]" aria-labelledby="districts-heading">
          <div className="max-w-6xl mx-auto">
            <h2 id="districts-heading" className={`${SECTION_HEADING} mb-6`}>Districts</h2>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse">
                <thead>
                  <tr className="border-b border-[#1c1c19]">
                    <th className={TH}>District</th>
                    <th className={`${TH} text-right`}>{M.schools.label}</th>
                    <th className={`${TH} text-right`}>{M.reported_pct.label}</th>
                    <th className={`${TH} text-right`}>{M.meals.label}</th>
                    <th className={`${TH} text-right`}>{M.enr_filed_pct.label}</th>
                    <th className={`${TH} text-right`}>{M.school_days_tested.label}</th>
                    <th className={`${TH} text-right`}>{M.schools_flagged.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {file.districts.map((d) => (
                    <tr key={d.dc} className="border-b border-[#1c1c19]/15">
                      <td className={TD}>
                        <Link href={districtPath(s.st, d.dc)} prefetch={false} className="underline underline-offset-4 decoration-[#1c1c19]/30 hover:decoration-[#1c1c19]">
                          {d.name}
                        </Link>
                      </td>
                      <td className={`${TD} text-right`}>{count(d.schools)}</td>
                      <td className={`${TD} text-right`}>{share(d.reported, d.schools) ?? "not read"}</td>
                      <td className={`${TD} text-right`}>{count(d.meals)}</td>
                      <td className={`${TD} text-right`}>{share(d.enr_filed, d.schools) ?? "not read"}</td>
                      <td className={`${TD} text-right`}>{count(d.school_days_tested)}</td>
                      <td className={`${TD} text-right`}>{count(d.schools_flagged)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {file.closed_days.length ? (
          <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]" aria-labelledby="closed-heading">
            <div className="max-w-6xl mx-auto">
              <h2 id="closed-heading" className={`${SECTION_HEADING} mb-3`}>Days the State was shut and some schools reported</h2>
              <p className="font-body text-[13.5px] leading-relaxed opacity-70 mb-6 max-w-3xl">
                On these days almost none of the State&rsquo;s schools
                reported, and the nightly run looked for the ones that did.
                The last column counts the schools it traced. A traced
                school is flagged if its own record shows it does not
                normally serve on that weekday, or if the date is on the
                State&rsquo;s holiday list.
              </p>
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[520px] max-w-3xl border-collapse">
                  <thead>
                    <tr className="border-b border-[#1c1c19]">
                      <th className={TH}>Day</th>
                      <th className={`${TH} text-right`}>{M.reported.label}</th>
                      <th className={`${TH} text-right`}>{M.meals.label}</th>
                      <th className={`${TH} text-right`}>Reporting schools traced</th>
                    </tr>
                  </thead>
                  <tbody>
                    {file.closed_days.map((d) => (
                      <tr key={d.day} className="border-b border-[#1c1c19]/15">
                        <td className={TD}>{dayShort(d.day)}</td>
                        <td className={`${TD} text-right`}>{count(d.reported)}</td>
                        <td className={`${TD} text-right`}>{count(d.meals)}</td>
                        <td className={`${TD} text-right`}>{count(d.schools_found)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        <section className="px-6 md:px-12 py-10 bg-[#f6f3ee]">
          <div className="max-w-6xl mx-auto">
            <h2 className={`${SECTION_HEADING} mb-3`}>The State&rsquo;s holiday list</h2>
            <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl">
              {holidays?.read_at
                ? `The system lists ${count(holidayDates)} holiday dates for ${s.name}, as read on ${whenIST(holidays.read_at)} IST${
                    vacationDates ? `; ${count(vacationDates)} of them are marked as vacations` : ", none of them marked as a vacation"}.`
                : `The system's holiday list for ${s.name} has not been read.`}{" "}
              The list covers the whole State and gives no district or school
              holidays, and some States list far more dates than others, so
              a date missing from it is not taken as proof that schools were
              open.
            </p>
          </div>
        </section>
      </main>

      <InstrumentFooter instrument="meal-claims" />
    </div>
  );
}
