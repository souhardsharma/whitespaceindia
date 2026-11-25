import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import { InstrumentFooter, InstrumentHeader } from "@/components/instruments/InstrumentChrome";
import LatestList from "@/components/instruments/meal/LatestList";
import { FlagNotFinding, SMALL_LABEL } from "@/components/instruments/meal/parts";
import { MEAL_BASE, MEAL_DATA, MEAL_OG, count, dayShort } from "@/lib/instruments/meal";
import { mealMeta, mealRecent, mealStates } from "@/lib/instruments/mealServer";

/**
 * What the last nights added.
 *
 * A flag is listed by the night it was first SEEN, not by the school-day it
 * concerns: the instrument reads a rotating sample, so tonight's read can
 * surface a contradiction on a date weeks back. Listing by school-day would
 * bury those under dates a returning reader has already looked at.
 */

const PATH = `${MEAL_BASE}/latest`;
const TITLE = "Latest flags | Meal Claims Check";
const DESCRIPTION =
  "Midday meal reports newly flagged in the last two weeks of nightly reading: meals above the enrolment a school filed, meals on a day it does not serve, and one-day spikes, each with its figures.";

export const metadata = pageMeta({ path: PATH, title: TITLE, description: DESCRIPTION, image: MEAL_OG });

const FIRST_ROWS = 60;

export default function MealLatest() {
  const recent = mealRecent();
  const meta = mealMeta();
  const states = mealStates();
  const csv = meta.csv_months[meta.csv_months.length - 1];

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData
        data={pageLd({
          path: PATH, name: "Latest flags", description: DESCRIPTION, type: "CollectionPage",
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
            Latest flags
          </h1>
          <p className="mt-5 font-body text-[15px] leading-relaxed opacity-80 max-w-3xl">
            {count(recent.total)} school-days were newly flagged in the last{" "}
            {count(recent.stamps.length)} {recent.stamps.length === 1 ? "night" : "nights"} of
            reading{recent.stamps.length ? `, since ${dayShort(recent.stamps[0])}` : ""}. A
            flag is listed by the night it was first seen, so a newly read
            table can add a flag on an earlier date. Reports above enrolment
            by a wide margin, closed-day reports and spikes come first.
            {recent.rows.length < recent.total
              ? ` The list holds the first ${count(recent.rows.length)}; the monthly files hold every one.`
              : ""}
          </p>
          <FlagNotFinding className="mt-7 max-w-3xl" />
          {csv ? (
            <p className="mt-6 font-body text-[13.5px] opacity-80">
              Every flag of a month, standing or not, as a file:{" "}
              <a href={`${MEAL_DATA}/flags/${csv}.csv`} className="underline underline-offset-4">{csv}.csv</a>
              {" · "}
              <Link href={`${MEAL_BASE}/data`} className="underline underline-offset-4">all files and columns</Link>
            </p>
          ) : null}

          <div className="mt-10">
            <LatestList
              initial={recent.rows.slice(0, FIRST_ROWS)}
              total={recent.total}
              stamps={recent.stamps}
              states={states.map((s) => [s.st, s.name])}
            />
          </div>
        </div>
      </main>

      <InstrumentFooter instrument="meal-claims" />
    </div>
  );
}
