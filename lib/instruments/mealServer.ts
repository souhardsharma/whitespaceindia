/**
 * SERVER ONLY. Reads Meal Claims Check's published files at build time.
 *
 * Every page of the instrument is static: it is rendered once per build from
 * the files the nightly run committed, and the school page assembles itself
 * in the browser from the same files. Nothing here runs per request, so the
 * instrument adds no load to the one backend the site shares.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  DayRow, District, HistoryFile, MealFreshness, MealMeta, Measure, NationalFile, Recent, StateFile, StateRow,
} from "@/lib/instruments/meal";

const DIR = join(process.cwd(), "public", "data", "instruments", "meal-claims");

/** A build draws several hundred pages from the same few files. */
const files = new Map<string, unknown>();

function read<T>(name: string): T {
  if (!files.has(name)) files.set(name, JSON.parse(readFileSync(join(DIR, name), "utf8")));
  return files.get(name) as T;
}

export const mealMeta = () => read<MealMeta>("meta.json");
export const mealFreshness = () => read<MealFreshness>("freshness.json");
export const mealMeasures = () => read<Record<string, Measure>>("measures.json");
export const mealStates = () => read<{ day: string; states: StateRow[] }>("states.json").states;
export const mealRecent = () => read<Recent>("flags/recent.json");
export const mealNational = () => read<NationalFile>("national.json");
export const mealState = (st: string) => read<StateFile>(`state/${st}.json`);

export type HolidayLists = Record<string, { days: { date: string; reason: string }[]; read_at: string | null }>;
export const mealHolidays = () => read<HolidayLists>("holidays.json");

/** Every day a district's table has been read for, oldest first. */
export function districtSeries(state: StateRow, dc: string): DayRow[] {
  return state.history_years.flatMap((year) =>
    (read<HistoryFile>(`history/${state.st}/${year}.json`).districts[dc] ?? [])
      .map(([day, schools, , , reported, meals]): DayRow => [day, schools, reported, meals]));
}

export function stateBySlug(slug: string): StateRow | undefined {
  return mealStates().find((s) => s.slug === slug);
}

/** Every district with the State it files under, for the district pages. */
export function allDistricts(): { state: StateRow; district: District }[] {
  return mealStates().flatMap((state) =>
    mealState(state.st).districts.map((district) => ({ state, district })));
}
