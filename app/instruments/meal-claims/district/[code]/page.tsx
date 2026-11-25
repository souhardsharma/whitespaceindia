import Link from "next/link";
import { notFound } from "next/navigation";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import { InstrumentFooter, InstrumentHeader } from "@/components/instruments/InstrumentChrome";
import {
  DayBars, FlagNotFinding, KindTag, SECTION_HEADING, SMALL_LABEL, Stat, TD, TH,
} from "@/components/instruments/meal/parts";
import Roster from "@/components/instruments/meal/Roster";
import SeriesChart from "@/components/instruments/meal/SeriesChart";
import {
  MEAL_BASE, MEAL_OG, count, dayLong, dayShort, districtCode, districtPath, flagFigures,
  schoolPath, share, statePath,
} from "@/lib/instruments/meal";
import { allDistricts, districtSeries, mealMeasures, mealMeta } from "@/lib/instruments/mealServer";

/**
 * One district: what its schools reported, block by block, and every school
 * in it that holds a flag.
 *
 * Blocks are sections of this page and not pages of their own. A block row is
 * six figures; 1,657 pages of six figures would spend the site's file budget
 * on nothing a reader could not see here.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return allDistricts().map(({ state, district }) => ({ code: districtCode(state.st, district.dc) }));
}

type Props = { params: Promise<{ code: string }> };

function find(code: string) {
  return allDistricts().find(({ state, district }) => districtCode(state.st, district.dc) === code);
}

function describe(district: string, state: string) {
  return {
    title: `${district}, ${state}: midday meal reports and flagged schools | Meal Claims Check`,
    description: `Midday meal (PM POSHAN) reporting in ${district} district, ${state}: schools reporting block by block, and each school whose meal reports exceed the enrolment it filed or fall on a day it does not serve.`,
  };
}

export async function generateMetadata({ params }: Props) {
  const hit = find((await params).code);
  if (!hit) return {};
  return pageMeta({
    path: districtPath(hit.state.st, hit.district.dc),
    ...describe(hit.district.name, hit.state.name),
    image: MEAL_OG,
  });
}

export default async function MealDistrict({ params }: Props) {
  const hit = find((await params).code);
  if (!hit) notFound();
  const { state: s, district: d } = hit;
  const M = mealMeasures();
  const path = districtPath(s.st, d.dc);
  const flags = d.flag_over + d.flag_closed + d.flag_spike;
  const series = districtSeries(s, d.dc);

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData
        data={pageLd({
          path, name: `${d.name}, ${s.name}`, description: describe(d.name, s.name).description,
          trail: [
            { name: "Instruments", path: "/instruments" },
            { name: "Meal Claims Check", path: MEAL_BASE },
            { name: s.name, path: statePath(s.slug) },
          ],
        })}
      />
      <InstrumentHeader crumb="Meal Claims Check" crumbHref={MEAL_BASE} />

      <main id="main-content" className="flex-1">
        <section className="px-6 md:px-12 pt-12 md:pt-16 pb-10 border-b border-[#1c1c19]">
          <div className="max-w-6xl mx-auto">
            <Link href={statePath(s.slug)} className={`${SMALL_LABEL} hover:opacity-100`}>
              &larr; {s.name}
            </Link>
            <h1 className="mt-4 font-headline font-bold text-[clamp(30px,4.8vw,56px)] leading-[1.0] tracking-[-0.03em]">
              {d.name}
            </h1>
            <p className="mt-4 font-headline italic text-[clamp(17px,2vw,23px)] leading-snug max-w-3xl opacity-90">
              Midday meal reports as filed by the district&rsquo;s schools
              {d.day ? `, read for ${dayLong(d.day)}` : ""}
            </p>

            <dl className="mt-9 grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6 pt-8 border-t border-[#1c1c19]/20">
              <Stat measure={M.schools} value={count(d.schools)} />
              <Stat
                measure={M.reported_pct}
                value={share(d.reported, d.schools) ?? "not read"}
                note={`${count(d.reported)} schools, ${count(d.meals)} meals reported`}
              />
              <Stat
                measure={M.enr_filed_pct}
                value={share(d.enr_filed, d.schools) ?? "not read"}
                note={`${count(d.enr_filed)} schools, ${count(d.enrolled)} children on their filings`}
              />
              <Stat
                measure={M.school_days_tested}
                value={count(d.school_days_tested)}
                note={`from ${count(d.tables_read)} school tables read`}
              />
            </dl>
          </div>
        </section>

        <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]" aria-labelledby="flagged-heading">
          <div className="max-w-6xl mx-auto">
            <h2 id="flagged-heading" className={`${SECTION_HEADING} mb-3`}>Schools with a flag</h2>
            {d.flagged.length ? (
              <>
                <p className="font-body text-[13.5px] leading-relaxed opacity-70 mb-5 max-w-3xl">
                  {count(d.flagged.length)} {d.flagged.length === 1 ? "school" : "schools"} in{" "}
                  {d.name} {d.flagged.length === 1 ? "holds" : "hold"} a flag on the figures as last read,{" "}
                  {count(flags)} school-days in all. A school&rsquo;s name
                  opens its month as filed, with each flag and the figures
                  behind it.
                </p>
                <FlagNotFinding className="mb-7 max-w-3xl" />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse">
                    <thead>
                      <tr className="border-b border-[#1c1c19]">
                        <th className={TH}>School</th>
                        <th className={TH}>Block</th>
                        <th className={`${TH} text-right`}>{M.flag_over.label}</th>
                        <th className={`${TH} text-right`}>{M.flag_closed.label}</th>
                        <th className={`${TH} text-right`}>{M.flag_spike.label}</th>
                        <th className={TH}>Most recent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.flagged.map((f) => (
                        <tr key={f.k} className="border-b border-[#1c1c19]/15">
                          <td className={TD}>
                            <Link href={schoolPath(f.k)} prefetch={false} className="underline underline-offset-4 decoration-[#1c1c19]/30 hover:decoration-[#1c1c19]">
                              {f.name}
                            </Link>
                          </td>
                          <td className={TD}>{f.block}</td>
                          <td className={`${TD} text-right`}>
                            {count(f.over)}
                            {f.wide ? <span className="opacity-60"> ({count(f.wide)} wide)</span> : null}
                          </td>
                          <td className={`${TD} text-right`}>{count(f.closed)}</td>
                          <td className={`${TD} text-right`}>{count(f.spike)}</td>
                          <td className={TD}>
                            <span className="block">{dayShort(f.last.day)} <KindTag kind={f.last.kind} wide={f.last.wide} /></span>
                            <span className="block text-[12.5px] opacity-75 mt-1">{flagFigures(f.last)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl">
                No school in {d.name} holds a flag on the tables read so far
                ({count(d.tables_read)} school tables,{" "}
                {count(d.school_days_tested)} school-days that could be
                tested against enrolment). School tables are read as a
                sample, and the schools outside it have not been checked.
              </p>
            )}
          </div>
        </section>

        {series.length > 1 ? (
          <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]" aria-labelledby="days-heading">
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8">
              <div className="md:col-span-4">
                <h2 id="days-heading" className={`${SECTION_HEADING} mb-3`}>Meals reported, day by day</h2>
                <p className="font-body text-[13.5px] leading-relaxed opacity-70">
                  {M.meals.definition} A day with no report is left empty and
                  is not flagged.
                </p>
              </div>
              <div className="md:col-span-8">
                {series.length >= 20 ? (
                  <SeriesChart
                    series={series}
                    label={`Reports from schools in ${d.name} on each of the ${series.length} days read`}
                    mealsLabel={M.meals.label}
                    shareLabel={M.reported_pct.label}
                    blanks={mealMeta().blank_ranges}
                  />
                ) : (
                  <DayBars series={series} height={120} label={`Meals reported in ${d.name} on each of the ${series.length} days read`} />
                )}
              </div>
            </div>
          </section>
        ) : null}

        {d.schools_read ? (
          <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]" aria-labelledby="schools-heading">
            <div className="max-w-6xl mx-auto">
              <h2 id="schools-heading" className={`${SECTION_HEADING} mb-3`}>Schools read</h2>
              <p className="font-body text-[13.5px] leading-relaxed opacity-70 mb-6 max-w-3xl">
                {count(d.schools_read)} schools in {count(d.clusters_read)} of
                the {count(d.clusters)} clusters listed for the district so
                far, each with the enrolment it had filed and the meals it
                reported on the date its cluster was last read. The other
                clusters have not been read yet. A flagged school&rsquo;s
                name opens its page.
              </p>
              <Roster
                st={s.st}
                dc={d.dc}
                total={d.schools_read}
                flagged={d.flagged.map((f) => f.k)}
                enrolledLabel={M.enrolled.label}
                mealsLabel={M.meals.label}
              />
            </div>
          </section>
        ) : null}

        <section className="px-6 md:px-12 py-12" aria-labelledby="blocks-heading">
          <div className="max-w-6xl mx-auto">
            <h2 id="blocks-heading" className={`${SECTION_HEADING} mb-6`}>Blocks</h2>
            {d.blocks.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse">
                  <thead>
                    <tr className="border-b border-[#1c1c19]">
                      <th className={TH}>Block</th>
                      <th className={`${TH} text-right`}>{M.schools.label}</th>
                      <th className={`${TH} text-right`}>{M.reported.label}</th>
                      <th className={`${TH} text-right`}>{M.meals.label}</th>
                      <th className={`${TH} text-right`}>{M.enr_filed.label}</th>
                      <th className={`${TH} text-right`}>{M.enrolled.label}</th>
                      <th className={TH}>Read for</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.blocks.map((b) => (
                      <tr key={b.bc} className="border-b border-[#1c1c19]/15">
                        <td className={TD}>{b.name}</td>
                        <td className={`${TD} text-right`}>{count(b.schools)}</td>
                        <td className={`${TD} text-right`}>{count(b.reported)}</td>
                        <td className={`${TD} text-right`}>{count(b.meals)}</td>
                        <td className={`${TD} text-right`}>{count(b.enr_filed)}</td>
                        <td className={`${TD} text-right`}>{count(b.enrolled)}</td>
                        <td className={TD}>{b.day ? dayShort(b.day) : "not read"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl">
                The block table for {d.name} has not been read yet. Block
                tables are read in turn, a few districts each night.
              </p>
            )}
          </div>
        </section>
      </main>

      <InstrumentFooter instrument="meal-claims" />
    </div>
  );
}
