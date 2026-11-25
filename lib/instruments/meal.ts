/**
 * Meal Claims Check: the shapes of its published files, and the one wording
 * of each flag.
 *
 * WHY THIS EXISTS
 * ---------------
 * A flag is shown in four places (a school's page, its district's list, the
 * latest list, the CSV's column notes). Worded separately in each, "meals
 * above filed enrolment" drifts into "more meals than children", which is a
 * different and stronger claim: the instrument knows what a school FILED, not
 * how many children it has. Every surface takes its sentence from
 * `flagSentence()` so the claim stays the one the figures support, and no
 * surface can call a flag anything the others do not.
 */

/** Instrument 02's ink: a slate teal no index and no other instrument wears. */
export const TEAL = "#1d5c63";
export const TEAL_DEEP = "#12444a";

export const MEAL_BASE = "/instruments/meal-claims";
export const MEAL_DATA = "/data/instruments/meal-claims";
export const MEAL_OG = "/og/meal-claims-2.jpg";
export const MEAL_HOST = "https://mdmhp.nic.in";

export type FlagKind = "over" | "closed" | "spike";

export interface Flag {
  day: string;
  kind: FlagKind;
  meals: number;
  /** First build that held this flag, as a date. */
  first: string;
  /** False once a later read of the same day no longer supports it. */
  standing: boolean;
  /** What the day's count reads now, on a flag that no longer stands. */
  now?: number | null;
  enrolled?: number;
  excess?: number;
  wide?: boolean;
  usual?: number;
  days_compared?: number;
  rule?: "weekday" | "holiday";
  same_served?: number;
  same_days?: number;
  other_served?: number;
  other_days?: number;
  /** Dates on the same weekday left out of the count: holidays, breaks and days the State was shut. */
  same_set_aside?: string[];
  reason?: string;
}

/** A school's entry in UDISE+, the Ministry of Education's yearly register. */
export interface UdiseRecord {
  /** The academic year the entry is for, as UDISE+ writes it: "2025-26". */
  year: string | null;
  name: string | null;
  category: string | null;
  type: string | null;
  management: string | null;
  management_group: string | null;
  location: string | null;
  status: string | null;
  /** Below 1 is a pre-primary class. */
  low_class: number | null;
  high_class: number | null;
  textbooks_primary: number | null;
  textbooks_upper: number | null;
}

export const UDISE_HOST = "https://kys.udiseplus.gov.in";

/** The school's code as UDISE+ writes it: eleven digits. */
export function udiseCode(code: string): string {
  return code.padStart(11, "0");
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** A class as the Rules write it: 8 is "VIII". */
function classNumeral(n: number): string {
  return ROMAN[n - 1] ?? String(n);
}

/** "Class I to class VIII"; a class below 1 is pre-primary. */
export function classRange(low: number | null, high: number | null): string | null {
  if (low == null || high == null) return null;
  const from = low < 1 ? "Pre-primary" : `Class ${classNumeral(low)}`;
  return low === high ? from : `${from} to class ${classNumeral(high)}`;
}

export interface School {
  st: string;
  code: string;
  shift: string;
  name: string;
  dc: string;
  district: string;
  block: string;
  cluster: string;
  /** One count per day of the month, null where nothing was reported. */
  meals: (number | null)[] | null;
  meals_read_at: string | null;
  /** Twelve filed enrolments, January first, null where none was filed. */
  enrolment: (number | null)[] | null;
  enrolment_read_at: string | null;
  /** Absent or null until UDISE+ has been asked; `record` null when it holds no school under the code. */
  udise?: { read_at: string; record: UdiseRecord | null } | null;
  flags: Flag[];
}

/** [day, schools listed, schools that reported, meals reported] */
export type DayRow = [string, number, number, number];

export interface Tally {
  tables_read: number;
  /** Tables read before every school row was kept: tested and counted, with no school to list. */
  tables_unlisted: number;
  school_days_tested: number;
  over_in_tables: number;
  flag_over: number;
  flag_over_wide: number;
  flag_closed: number;
  flag_spike: number;
  schools_flagged: number;
}

export interface StateRow extends Tally {
  st: string;
  name: string;
  slug: string;
  day: string | null;
  schools: number | null;
  reported: number | null;
  meals: number | null;
  /** True for a State missing from the all-States table: its figures are the sum of its district table. */
  from_districts: boolean;
  enr_day: string | null;
  enr_filed: number | null;
  enr_schools: number | null;
  enrolled: number | null;
  districts: number;
  blocks: number;
  clusters: number;
  holidays_listed: number;
  holidays_read_at: string | null;
  series: DayRow[];
  /** Years for which `history/<st>/<year>.json` holds district tables. */
  history_years: number[];
  clusters_read: number;
  schools_read: number;
}

export interface FlaggedSchool {
  /** "<school code>-<shift>", the school's address on this site. */
  k: string;
  name: string;
  block: string;
  over: number;
  wide: number;
  closed: number;
  spike: number;
  last: Flag;
}

export interface BlockRow {
  bc: string;
  name: string;
  day: string | null;
  schools: number | null;
  enr_filed: number | null;
  enrolled: number | null;
  reported: number | null;
  meals: number | null;
}

export interface District extends Tally {
  dc: string;
  name: string;
  day: string | null;
  schools: number | null;
  enr_filed: number | null;
  enrolled: number | null;
  reported: number | null;
  meals: number | null;
  series: DayRow[];
  blocks: BlockRow[];
  flagged: FlaggedSchool[];
  clusters: number;
  clusters_read: number;
  schools_read: number;
}

/** `history/<st>/<year>.json`: every district table read in one year.
 *  A row is [day, schools, schools that filed enrolment, enrolment filed,
 *  schools that reported, meals]. */
export interface HistoryFile {
  st: string;
  year: number;
  districts: Record<string, [string, number, number | null, number | null, number, number][]>;
}

/** `roster/<st>-<dc>.json`: every school read in one district, as its
 *  cluster's latest table showed it. */
export interface RosterFile {
  st: string;
  dc: string;
  clusters: Record<string, { name: string; block: string; day: string; days: number }>;
  /** [school key, name, cluster code, enrolment filed, meals reported] */
  schools: [string, string, string, number | null, number | null][];
}

export interface ClosedDay {
  day: string;
  reported: number;
  meals: number;
  schools_found: number;
}

export interface StateFile {
  st: string;
  name: string;
  slug: string;
  series: DayRow[];
  districts: District[];
  closed_days: ClosedDay[];
}

export interface RecentRow extends Flag {
  /** Index into `stamps`: the build in which the flag first appeared. */
  seen: number;
  st: string;
  dc: string;
  district: string;
  k: string;
  name: string;
}

export interface Recent {
  stamps: string[];
  total: number;
  rows: RecentRow[];
}

/** What was measured once from a runner before the thresholds were kept, and
 *  the year of dates read while the source was being judged. */
export interface Calibration {
  measured_on: string;
  requests_sent: number;
  requests_failed: number;
  median_seconds: number;
  tables_read: number;
  school_days_tested: number;
  over: number;
  over_wide: number;
  over_by_one_or_two: number;
  states: string[];
  dates: string[];
  school_history_from: string;
  school_history_empty_at: string;
  year_read: {
    from: string;
    to: string;
    dates_read: number;
    weeks: number;
    weeks_with_records: number;
    host_blanks: [string, string][];
    state_silences: { st: string; span: string; vacation: boolean }[];
  };
  enrolment_filed_month: { month: string; pct: Record<string, number> };
}

export interface MealMeta {
  generated_at: string;
  calibration: Calibration;
  day: string;
  span: { first_day: string | null; last_day: string | null; days_read: number };
  first_night: string | null;
  nights: number;
  thresholds: Record<string, number>;
  buckets: number;
  months: string[];
  /** How many months of school files are kept; older flags stay in the CSVs. */
  months_kept: number;
  csv_months: string[];
  list_days: number;
  blank_ranges: [string, string][];
  history: {
    state_first_day: string | null;
    /** True once enough blank days older than it were read to call it the first. */
    state_floor_reached: boolean;
    state_days: number;
    district_first_day: string | null;
    district_tables: number;
  };
  counts: Tally & {
    clusters_read: number;
    schools_read: number;
    states: number;
    schools: number;
    districts: number;
    blocks: number;
    clusters: number;
    flags_no_longer_standing: number;
    /** Flagged schools looked up in UDISE+, and those it holds an entry for. */
    udise_asked: number;
    udise_found: number;
  };
  /** The most requests a night may send to the meal system, however clean the nights before. */
  budget_cap: number;
  /** The least a clean night adds to the next night's allowance. */
  budget_step: number;
}

export interface MealFreshness {
  checked_at?: string;
  day?: string;
  outcome?: "complete" | "partial" | "refused";
  complete?: boolean;
  district_tables?: number;
  budget?: number;
  sent?: number;
  failed?: number;
  median_s?: number;
  detail_owed?: number;
  next_budget?: number;
}

export interface Measure {
  label: string;
  definition: string;
  formula?: string;
  unit?: string;
  source: string;
}

export const FLAG_KINDS: Record<FlagKind, { label: string; short: string }> = {
  over: { label: "Days above filed enrolment", short: "Above enrolment" },
  closed: { label: "Meals on a closed day", short: "Closed day" },
  spike: { label: "One-day spike", short: "Spike" },
};

const nf = new Intl.NumberFormat("en-IN");

export function count(n: number | null | undefined): string {
  return n == null ? "not read" : nf.format(n);
}

/** A share to one decimal, or null when there is nothing to divide by. */
export function share(part: number | null | undefined, whole: number | null | undefined): string | null {
  if (part == null || !whole) return null;
  return `${(Math.round((part / whole) * 1000) / 10).toFixed(1)}%`;
}

/**
 * The latest day read on which a State was at work: at least `openShare` of
 * its schools reported. Yesterday can be a holiday, and a State's reporting
 * share on a holiday says nothing about how fully it reports.
 */
export function lastOpenDay(series: DayRow[], openShare: number): DayRow | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const [, schools, reported] = series[i];
    if (schools && reported / schools >= openShare) return series[i];
  }
  return null;
}

/**
 * States listed on the system whose schools hardly file there: on no day
 * read did `shutShare` of them report. Their schools stay in the counts of
 * schools listed, and a share of all schools reporting is drawn without them.
 */
export function silentStates<T extends { series: DayRow[] }>(states: T[], shutShare: number): T[] {
  return states.filter((s) => s.series.length > 0 && s.series.every(([, schools, reported]) => !schools || reported / schools < shutShare));
}

/** The highest share of a State's schools that reported on any day read. */
export function bestShare(series: DayRow[]): string | null {
  const best = series.reduce<DayRow | null>(
    (top, row) => (row[1] && (!top || row[2] / row[1] > top[2] / top[1]) ? row : top), null);
  return best ? share(best[2], best[1]) : null;
}

/** "a school" or "3 schools": a count and its noun, in Indian digits. */
export function counted(n: number, noun: string, plural = `${noun}s`): string {
  return `${count(n)} ${n === 1 ? noun : plural}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

/** The parts of an ISO date, read as a calendar date and never through a
 *  time zone: "2026-11-01" is 1 November wherever the reader is. */
function parts(iso: string): { y: number; m: number; d: number; wd: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

export function weekday(iso: string): string {
  return WEEKDAYS[parts(iso).wd];
}

/** "Sun 1 Nov 2026" */
export function dayShort(iso: string): string {
  const p = parts(iso);
  return `${WEEKDAYS[p.wd].slice(0, 3)} ${p.d} ${MONTHS[p.m - 1].slice(0, 3)} ${p.y}`;
}

/** "Sunday 1 November 2026" */
export function dayLong(iso: string): string {
  const p = parts(iso);
  return `${WEEKDAYS[p.wd]} ${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** "24 November" */
function dayMonth(iso: string): string {
  const p = parts(iso);
  return `${p.d} ${MONTHS[p.m - 1]}`;
}

/** "November 2026" from "2026-11". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** A read time in IST, the time zone of the source and of its readers. */
export function whenIST(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  }).format(d);
}

function times(n: number, noun: string): string {
  return `${nf.format(n)} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * What a flag says, in full, from its own figures and nothing else.
 *
 * Each sentence names the two filed figures that disagree. None says why:
 * the record does not hold a reason, so the page does not supply one.
 */
export function flagSentence(f: Flag): string {
  const meals = times(f.meals, "meal");
  if (f.kind === "over") {
    return `The school reported ${meals}. The enrolment it filed for the month is ${nf.format(f.enrolled ?? 0)}, so the report is ${nf.format(f.excess ?? 0)} above it.`;
  }
  if (f.kind === "spike") {
    return `The school reported ${meals}. Its usual daily count is ${nf.format(f.usual ?? 0)}, the median of the ${times(f.days_compared ?? 0, "other serving day")} read.`;
  }
  if (f.rule === "holiday") {
    const why = f.reason ? ` (${f.reason})` : "";
    return `The school reported ${meals} on a date its State's own list on this system marks as a holiday${why}, a day on which few of the State's schools reported. A school that keeps its own calendar may have been open.`;
  }
  const wd = weekday(f.day);
  const skipped = f.same_set_aside ?? [];
  const aside = skipped.length === 1
    ? ` The ${wd} left out was ${dayMonth(skipped[0])}.`
    : skipped.length
      ? ` The ${wd}s left out were ${skipped.slice(0, -1).map(dayMonth).join(", ")} and ${dayMonth(skipped[skipped.length - 1])}.`
      : "";
  return `The school reported ${meals} on a ${wd}. Its own record shows meals on ${nf.format(f.same_served ?? 0)} of the ${times(f.same_days ?? 0, `other ${wd}`)} read outside holidays, breaks and days its State was shut, and on ${nf.format(f.other_served ?? 0)} of ${times(f.other_days ?? 0, "day")} on other weekdays.${aside}`;
}

/** What became of a flag whose day was read again and no longer supports it. */
export function flagAfterword(f: Flag): string | null {
  if (f.standing) return null;
  return f.now == null
    ? "The day has been read again and shows no report now, so the flag no longer stands; it is kept as a record of what was first read."
    : `The day has been read again and now shows ${times(f.now, "meal")}, so the flag no longer stands; it is kept as a record of what was first read.`;
}

/** The figures of a flag as one short line, for a table cell. */
export function flagFigures(f: Flag): string {
  if (f.kind === "over") return `${nf.format(f.meals)} meals against a filed enrolment of ${nf.format(f.enrolled ?? 0)}`;
  if (f.kind === "spike") return `${nf.format(f.meals)} meals against a usual ${nf.format(f.usual ?? 0)}`;
  if (f.rule === "holiday") return `${nf.format(f.meals)} meals on a listed holiday`;
  return `${nf.format(f.meals)} meals on a ${weekday(f.day)}`;
}

export function statePath(slug: string): string {
  return `${MEAL_BASE}/state/${slug}`;
}

/** A district's address: its State's code and its own, "16-1605". */
export function districtCode(st: string, dc: string): string {
  return `${st}-${dc}`;
}

export function districtPath(st: string, dc: string): string {
  return `${MEAL_BASE}/district/${districtCode(st, dc)}`;
}

export function rosterPath(st: string, dc: string): string {
  return `${MEAL_DATA}/roster/${st}-${dc}.json`;
}

export function schoolPath(k: string): string {
  return `${MEAL_BASE}/school/${k}`;
}

/** The bucket file a school's months are published in. Must equal
 *  `bucket_of()` in scripts/meal_claims/build_data.py. */
export function bucketOf(code: string, buckets: number): string {
  return String(Number(code) % buckets).padStart(2, "0");
}

/** "<code>-<shift>" from an address, or null when it is not one. */
export function schoolKey(pathname: string): string | null {
  const m = /\/school\/(\d{1,14}-\d{1,2})\/?$/.exec(pathname);
  return m ? m[1] : null;
}

/**
 * What the footer may say about the last night.
 *
 * `partial` is not a fault: the instrument reads a sample by design, and a
 * night that ran out of its request budget still read the State and district
 * tables. Only a night that did not read every State's district table, or was
 * refused, is called incomplete.
 */
export function nightNote(f: MealFreshness): string | null {
  if (!f.checked_at) return null;
  if (f.outcome === "refused") return "the source refused part of the read";
  if (f.complete === false) return "read incompletely";
  return null;
}

/** The national PM POSHAN daily system, read at State and district level. */
export const AMS_HOST = "https://pmposhan-ams.education.gov.in";

export interface NationalFigures {
  schools: number | null;
  reported: number | null;
  holiday: number | null;
  enrolled: number | null;
  rep_enrolled: number | null;
  meals: number | null;
}

export interface NationalDistrict extends NationalFigures {
  name: string;
}

export interface NationalState extends NationalFigures {
  name: string;
  slug: string;
  /** The State's code on the meal reporting system, when it files there too. */
  st: string | null;
  approved: number | null;
  series: DayRow[];
  /** The latest day its district table was read for. */
  district_day: string | null;
  districts: NationalDistrict[];
  /** What the district table adds up to, when it is for the day read and
   *  disagrees with the State row; otherwise null. Absent in older files. */
  district_sum?: { schools: number; reported: number; meals: number } | null;
}

/** One State on one day, as each of the two systems holds it: schools, reported, meals. */
export interface NationalCompare {
  st: string;
  name: string;
  day: string;
  here: [number | null, number | null, number | null];
  national: [number | null, number | null, number | null];
}

export interface NationalFile {
  /** False until a night has read the national system. */
  read: boolean;
  day: string | null;
  first_day: string | null;
  days: number;
  night: { stamp: string; outcome: string; sent: number; tables: number } | null;
  /** How many days back the source's own date box goes. */
  window_days: number;
  read_at?: string | null;
  series: DayRow[];
  states: NationalState[];
  compare: NationalCompare[];
  district_months: string[];
}

export function sumOf(rows: NationalFigures[], key: keyof NationalFigures): number | null {
  const held = rows.map((r) => r[key]).filter((v): v is number => v != null);
  return held.length ? held.reduce((a, b) => a + b, 0) : null;
}
