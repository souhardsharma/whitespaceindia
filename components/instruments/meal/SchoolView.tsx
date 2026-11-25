"use client";

/**
 * One school: each month it holds a flag in, as the school filed it.
 *
 * WHY IT IS ASSEMBLED IN THE BROWSER
 * ----------------------------------
 * Schools with a flag number in the thousands and grow every night. One page
 * each would spend the site's 20,000-file allowance, which every tool here
 * shares, and a page rendered per request would put a crawler's appetite on
 * the one backend. So every school address is served the same static page,
 * which reads the school's code from the address and its months from the
 * bucket files the nightly run publishes. The page is not indexed: a search
 * result naming one school beside the word "flag" would say more than a flag
 * does.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { applyHead } from "@/lib/instruments/head";
import { SITE_URL } from "@/lib/site";
import {
  DayBars, FlagEntry, FlagNotFinding, SECTION_HEADING, SMALL_LABEL, TD, TH,
} from "@/components/instruments/meal/parts";
import {
  MEAL_BASE, MEAL_DATA, MEAL_HOST, UDISE_HOST, bucketOf, classRange, count, districtPath, monthLabel,
  schoolKey, schoolPath, udiseCode, whenIST, type MealMeta, type Measure, type School,
} from "@/lib/instruments/meal";

type Month = { month: string; school: School };
type Measures = Record<string, Measure>;
type View =
  | { state: "loading" }
  | { state: "missing"; key: string | null }
  | { state: "failed" }
  | { state: "ready"; key: string; months: Month[]; measures: Measures };

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function json<T>(path: string): Promise<T | null> {
  const res = await fetch(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return (await res.json()) as T;
}

/** Every published month that holds this school, newest first, and the registry of what each figure means. */
async function load(key: string): Promise<{ months: Month[]; measures: Measures }> {
  const [meta, measures] = await Promise.all([
    json<MealMeta>(`${MEAL_DATA}/meta.json`),
    json<Measures>(`${MEAL_DATA}/measures.json`),
  ]);
  if (!meta || !measures) throw new Error("meta.json or measures.json is missing");
  const bucket = bucketOf(key.split("-")[0], meta.buckets);
  const files = await Promise.all(meta.months.map(async (month) => {
    const schools = await json<Record<string, School>>(`${MEAL_DATA}/schools/${month}/${bucket}.json`);
    return schools?.[key] ? { month, school: schools[key] } : null;
  }));
  const months = files.filter((m): m is Month => m !== null).sort((a, b) => b.month.localeCompare(a.month));
  return { months, measures };
}

/** One line of the UDISE+ entry: the registry's label and definition beside the value. */
function RegisterRow({ measure, children }: { measure: Measure; children: React.ReactNode }) {
  return (
    <div className="py-3.5 border-b border-[#1c1c19]/15 grid grid-cols-1 md:grid-cols-12 gap-x-6 gap-y-1">
      <dt className="md:col-span-4 font-body text-[14px] font-semibold">{measure.label}</dt>
      <dd className="md:col-span-8 font-body text-[14px] leading-relaxed">
        <span className="tabular-nums">{children}</span>
        <span className="block text-[12.5px] opacity-65 mt-1">{measure.definition}</span>
      </dd>
    </div>
  );
}

/**
 * What the Ministry's register of schools says about this school. It is a
 * second filing, made once a year on a different system, and it is set
 * beside the meal reports without being tested against them: the two count
 * different things.
 */
function Register({ school, measures, filed }: { school: School; measures: Measures; filed: string | null }) {
  const held = school.udise;
  if (!held) return null;
  const r = held.record;
  const asked = whenIST(held.read_at) ?? "an unknown date";
  if (!r) {
    return (
      <section className="mt-12 pt-8 border-t border-[#1c1c19]" aria-labelledby="udise-heading">
        <h2 id="udise-heading" className={`${SECTION_HEADING} mb-3`}>This school in UDISE+</h2>
        <p className="font-body text-[13.5px] leading-relaxed opacity-75 max-w-3xl">
          UDISE+, the Ministry of Education&rsquo;s register of schools, returned
          no school for the code {udiseCode(school.code)} when asked on {asked} IST.
          In Tripura and Himachal Pradesh, the two States checked by hand, the
          meal system lists a school under its UDISE code. Elsewhere, and for
          this school, the codes may differ.
        </p>
      </section>
    );
  }
  const kind = [r.category, r.type, r.management, r.location].filter(Boolean).join(" \u00b7 ");
  const classes = classRange(r.low_class, r.high_class);
  const books = r.textbooks_primary != null || r.textbooks_upper != null;
  return (
    <section className="mt-12 pt-8 border-t border-[#1c1c19]" aria-labelledby="udise-heading">
      <h2 id="udise-heading" className={`${SECTION_HEADING} mb-3`}>
        This school in UDISE+{r.year ? `, ${r.year}` : ""}
      </h2>
      <p className="font-body text-[13.5px] leading-relaxed opacity-75 mb-4 max-w-3xl">
        UDISE+ is the Ministry of Education&rsquo;s register of schools,
        where a school files its entry once a year, outside the meal system.
        This entry is listed as {r.name ?? "this school"}, code{" "}
        {udiseCode(school.code)}, and was read on {asked} IST. None of it is
        tested against the meal reports.
      </p>
      <dl className="max-w-4xl border-t border-[#1c1c19]/40">
        {classes ? <RegisterRow measure={measures.udise_classes}>{classes}</RegisterRow> : null}
        {kind ? <RegisterRow measure={measures.udise_category}>{kind}</RegisterRow> : null}
        {r.status ? <RegisterRow measure={measures.udise_status}>{r.status}</RegisterRow> : null}
        {books ? (
          <RegisterRow measure={measures.udise_textbooks}>
            {r.textbooks_primary != null ? `${count(r.textbooks_primary)} in classes I to V` : null}
            {r.textbooks_primary != null && r.textbooks_upper != null ? ", " : null}
            {r.textbooks_upper != null ? `${count(r.textbooks_upper)} in classes VI to VIII` : null}
            {filed ? <span className="block mt-1">{filed}</span> : null}
          </RegisterRow>
        ) : null}
      </dl>
      <p className="font-body text-[12.5px] leading-relaxed opacity-65 mt-4 max-w-3xl">
        The same entry can be opened at{" "}
        <a href={UDISE_HOST} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">kys.udiseplus.gov.in</a>{" "}
        by searching for the code.
      </p>
    </section>
  );
}

function daySeries(month: string, meals: (number | null)[]): [string, number | null][] {
  return meals.map((n, i) => [`${month}-${String(i + 1).padStart(2, "0")}`, n]);
}

export default function SchoolView() {
  const key = schoolKey(usePathname() ?? "");
  const [view, setView] = useState<View>({ state: "loading" });

  useEffect(() => {
    if (!key) {
      setView({ state: "missing", key: null });
      return;
    }
    let live = true;
    load(key).then(
      (got) => live && setView(got.months.length ? { state: "ready", key, ...got } : { state: "missing", key }),
      () => live && setView({ state: "failed" }),
    );
    return () => { live = false; };
  }, [key]);

  useEffect(() => {
    if (view.state === "loading" || view.state === "failed") return;
    if (view.state === "missing") {
      return applyHead({
        title: "School not found | Meal Claims Check",
        description: "No school with a flag is published at this address.",
        path: view.key ? schoolPath(view.key) : `${MEAL_BASE}/view`,
        index: false,
      }, SITE_URL);
    }
    const s = view.months[0].school;
    return applyHead({
      title: `${s.name}, ${s.district}: midday meal reports | Meal Claims Check`,
      description: `The daily midday meal counts ${s.name} (${s.block}, ${s.district}) reported, set against the enrolment it filed, with each day on which the two disagree marked beside its figures.`,
      path: schoolPath(view.key),
      index: false,
    }, SITE_URL);
  }, [view]);

  if (view.state === "loading") {
    return <p className="font-body text-[14px] opacity-70" role="status">Reading the school&rsquo;s record&hellip;</p>;
  }
  if (view.state === "failed") {
    return (
      <p className="font-body text-[15px] leading-relaxed max-w-2xl" role="alert">
        The school&rsquo;s files could not be read just now. Reloading the page
        asks for them again.
      </p>
    );
  }
  if (view.state === "missing") {
    return (
      <div className="max-w-2xl">
        <h1 className="font-headline font-bold text-[clamp(28px,4vw,44px)] leading-[1.05] tracking-[-0.02em]">
          No flagged school at this address
        </h1>
        <p className="font-body text-[15px] leading-relaxed opacity-80 mt-5">
          A page is published only for a school that holds a flag in the
          months published. A school without a page has no flag
          on the tables read so far. School tables are read as a sample, so
          the school may not have been read at all.
        </p>
        <Link href={`${MEAL_BASE}/states`} className="inline-block mt-6 font-label text-[11px] uppercase tracking-[0.18em] underline underline-offset-4">
          Browse by State and district &rarr;
        </Link>
      </div>
    );
  }

  const s = view.months[0].school;
  const enrolment = view.months.find((m) => m.school.enrolment)?.school;
  const year = view.months[0].month.slice(0, 4);
  const registered = view.months.find((m) => m.school.udise)?.school ?? s;
  const latestFiled = view.months[0].school.enrolment?.[Number(view.months[0].month.slice(5)) - 1];
  const filedLine = latestFiled != null
    ? `On the meal system the school filed an enrolment of ${count(latestFiled)} for ${monthLabel(view.months[0].month)}.`
    : null;

  return (
    <article>
      <Link href={districtPath(s.st, s.dc)} prefetch={false} className={`${SMALL_LABEL} hover:opacity-100`}>
        &larr; {s.district}
      </Link>
      <h1 className="mt-4 font-headline font-bold text-[clamp(28px,4.4vw,52px)] leading-[1.02] tracking-[-0.03em] max-w-4xl">
        {s.name}
      </h1>
      <p className="mt-4 font-body text-[14px] opacity-75">
        {s.block} block, {s.district} &middot; cluster {s.cluster} &middot; school code {s.code}
        {s.shift !== "1" ? `, shift ${s.shift}` : ""}
      </p>
      <FlagNotFinding className="mt-7 max-w-3xl" />

      {view.months.map(({ month, school }) => {
        const filed = school.enrolment?.[Number(month.slice(5)) - 1] ?? null;
        // Before the school's own enrolment record is read, the figure a flag
        // rests on is the one its cluster table printed for the month.
        const inTable = school.enrolment ? null : school.flags.find((f) => f.enrolled != null && f.day.startsWith(month))?.enrolled ?? null;
        const flagged = new Set(school.flags.filter((f) => f.standing).map((f) => f.day));
        return (
          <section key={month} className="mt-12 pt-8 border-t border-[#1c1c19]" aria-labelledby={`m-${month}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 id={`m-${month}`} className="font-headline font-bold text-[26px] leading-none tracking-[-0.02em]">
                {monthLabel(month)}
              </h2>
              <p className="font-body text-[13.5px] opacity-80 tabular-nums">
                Enrolment filed for the month:{" "}
                <strong className="font-semibold">
                  {/* An enrolment history not read yet is not a school that filed nothing. */}
                  {filed != null ? count(filed) : school.enrolment ? "none filed" : inTable != null ? count(inTable) : "not read yet"}
                </strong>
                {inTable != null ? (
                  <span className="opacity-75"> as the cluster table showed it; the school&rsquo;s own enrolment record has not been read yet</span>
                ) : null}
              </p>
            </div>
            {school.meals ? (
              <div className="mt-6">
                <DayBars
                  series={daySeries(month, school.meals)}
                  flagged={flagged}
                  height={120}
                  label={`Meals ${school.name} reported on each day of ${monthLabel(month)}`}
                />
                <p className={`${SMALL_LABEL} mt-3 normal-case tracking-normal text-[12px] font-body`}>
                  The bars show the meals reported each day, as read on{" "}
                  {whenIST(school.meals_read_at) ?? "an unknown date"} IST.
                  Flagged days are dark, and a day with no bar has no report.
                </p>
              </div>
            ) : (
              <p className="font-body text-[13.5px] opacity-75 mt-5 max-w-3xl">
                The school&rsquo;s full month has not been read yet. The flags
                below come from the day&rsquo;s table of its cluster.
              </p>
            )}
            <ul className="mt-6 border-t border-[#1c1c19]/40">
              {school.flags.map((f) => <FlagEntry key={`${f.day}-${f.kind}`} flag={f} />)}
            </ul>
          </section>
        );
      })}

      {enrolment?.enrolment && enrolment.enrolment.every((n) => n == null) ? (
        <section className="mt-12 pt-8 border-t border-[#1c1c19]" aria-labelledby="enrolment-heading">
          <h2 id="enrolment-heading" className={`${SECTION_HEADING} mb-3`}>The enrolment this school filed, {year}</h2>
          <p className="font-body text-[13.5px] leading-relaxed opacity-70 max-w-3xl">
            The system holds no enrolment filing from this school for
            any month of {year}, as read on{" "}
            {whenIST(enrolment.enrolment_read_at) ?? "an unknown date"} IST, so
            its meal reports cannot be compared with enrolment.
          </p>
        </section>
      ) : enrolment?.enrolment ? (
        <section className="mt-12 pt-8 border-t border-[#1c1c19]" aria-labelledby="enrolment-heading">
          <h2 id="enrolment-heading" className={`${SECTION_HEADING} mb-3`}>The enrolment this school filed, {year}</h2>
          <p className="font-body text-[13.5px] leading-relaxed opacity-70 mb-5 max-w-3xl">
            A wrong enrolment filing can put a report above enrolment, so the
            year&rsquo;s filings are listed here, as read on{" "}
            {whenIST(enrolment.enrolment_read_at) ?? "an unknown date"} IST.
            If the figure drops sharply from one month to the next while the
            daily meals stay level, the filing is the likelier error.
          </p>
          <div className="overflow-x-auto">
            <table className="border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b border-[#1c1c19]">
                  {MONTH_NAMES.map((m) => <th key={m} className={`${TH} text-right`}>{m}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[#1c1c19]/15">
                  {enrolment.enrolment.map((n, i) => (
                    <td key={MONTH_NAMES[i]} className={`${TD} text-right`}>{n == null ? "–" : count(n)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <Register school={registered} measures={view.measures} filed={filedLine} />

      <section className="mt-12 pt-8 border-t border-[#1c1c19]" aria-labelledby="check-heading">
        <h2 id="check-heading" className={`${SECTION_HEADING} mb-3`}>Checking this against the source</h2>
        <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl">
          Every figure here is the school&rsquo;s own filing on the PM POSHAN
          daily reporting system at{" "}
          <a href={MEAL_HOST} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">mdmhp.nic.in</a>.
          To see it there, choose the State, then {s.district} district,{" "}
          {s.block} block and cluster {s.cluster}, and pick the date. The
          system shows a school&rsquo;s day-by-day month only for the current
          month, so an earlier month has to be checked one date at a time.
          A school may correct a figure after it was read, and when a later read
          no longer supports a flag, the flag is marked above as no longer
          standing.
        </p>
      </section>
    </article>
  );
}
