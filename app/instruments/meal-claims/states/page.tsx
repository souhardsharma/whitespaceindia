import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import { InstrumentFooter, InstrumentHeader } from "@/components/instruments/InstrumentChrome";
import { FlagNotFinding, SECTION_HEADING, TD, TH } from "@/components/instruments/meal/parts";
import {
  MEAL_BASE, MEAL_OG, count, dayShort, districtPath, lastOpenDay, share, statePath,
} from "@/lib/instruments/meal";
import { mealMeasures, mealMeta, mealState, mealStates } from "@/lib/instruments/mealServer";

const PATH = `${MEAL_BASE}/states`;

export const metadata = pageMeta({
  path: PATH,
  title: "Midday meal reporting by State and district | Meal Claims Check",
  description:
    "Every State, Union Territory and district on India's PM POSHAN daily meal reporting system: schools listed, the share reporting, the share that filed enrolment, and the schools whose meal reports their own filings contradict.",
  image: MEAL_OG,
});

const TRAIL = [
  { name: "Instruments", path: "/instruments" },
  { name: "Meal Claims Check", path: MEAL_BASE },
];

export default function MealStates() {
  const m = mealMeta();
  const M = mealMeasures();
  const states = mealStates();

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData data={pageLd({ path: PATH, name: "By State and district", description: metadata.description, trail: TRAIL, type: "CollectionPage" })} />
      <InstrumentHeader crumb="Meal Claims Check" crumbHref={MEAL_BASE} />

      <main id="main-content" className="flex-1">
        <section className="px-6 md:px-12 pt-12 md:pt-16 pb-10 border-b border-[#1c1c19]">
          <div className="max-w-6xl mx-auto">
            <h1 className="font-headline font-bold text-[clamp(28px,4.4vw,52px)] leading-[1.02] tracking-[-0.03em] max-w-4xl">
              Midday meal reporting, by State and district
            </h1>
            <p className="mt-5 font-body text-[15px] leading-relaxed opacity-80 max-w-3xl">
              {count(m.counts.states)} States and Union Territories file into
              the system, across {count(m.counts.districts)} districts. Each
              State&rsquo;s reporting share is for its last working day
              read; district rows show what the system held for the latest
              day read ({dayShort(m.day)}), which may be a holiday, and how much of
              the State this instrument has been able to test so far.
            </p>
            <FlagNotFinding className="mt-7 max-w-3xl" />
          </div>
        </section>

        {states.map((s) => {
          const file = mealState(s.st);
          const open = lastOpenDay(s.series, m.thresholds.state_open_share);
          return (
            <section key={s.st} id={s.slug} className="px-6 md:px-12 py-10 border-b border-[#1c1c19]/30" aria-labelledby={`${s.slug}-heading`}>
              <div className="max-w-6xl mx-auto">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 mb-4">
                  <h2 id={`${s.slug}-heading`} className="font-headline font-bold text-[26px] leading-none tracking-[-0.02em]">
                    <Link href={statePath(s.slug)} className="hover:underline underline-offset-4">{s.name}</Link>
                  </h2>
                  <p className="font-body text-[13px] opacity-75 tabular-nums">
                    {count(s.schools)} schools listed &middot;{" "}
                    {open ? share(open[2], open[1]) : share(s.reported, s.schools) ?? "no share"} reported
                    {open ? ` on ${dayShort(open[0])}` : s.day ? ` on ${dayShort(s.day)}` : ""} &middot;{" "}
                    {share(s.enr_filed, s.enr_schools) ?? "no share"} filed enrolment
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse">
                    <thead>
                      <tr className="border-b border-[#1c1c19]">
                        <th className={TH}>District</th>
                        <th className={`${TH} text-right`}>{M.schools.label}</th>
                        <th className={`${TH} text-right`}>{M.reported_pct.label}</th>
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
          );
        })}

        <section className="px-6 md:px-12 py-10 bg-[#f6f3ee]">
          <div className="max-w-6xl mx-auto">
            <h2 className={`${SECTION_HEADING} mb-3`}>Reading these tables</h2>
            <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl">
              {M.enr_filed_pct.definition} {M.school_days_tested.definition}{" "}
              A district with no school flagged and few school-days tested has
              not been cleared; it has not yet been read.
            </p>
          </div>
        </section>
      </main>

      <InstrumentFooter instrument="meal-claims" />
    </div>
  );
}
