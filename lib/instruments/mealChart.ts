/**
 * Meal Claims Check: the arithmetic of its charts, kept apart from the drawing.
 *
 * WHY THIS EXISTS
 * ---------------
 * A chart can say something the figures do not. Joining a line across a day
 * with no report draws meals nobody filed, and a zero-height mark reads as
 * "nothing was served" when the source was only silent. Every chart of the
 * instrument takes its days, gaps, scale and summary from here, so a day
 * without a report is `null` from the first step to the last and no drawing
 * can turn it into a number.
 */
import { count, dayLong, dayShort, share, type DayRow } from "./meal.ts";

export type ChartMeasure = "meals" | "share";
export type ChartRange = "90d" | "12m" | "all";

/** One calendar day of a chart: its row, or null where the series holds none. */
export interface ChartDay {
  day: string;
  row: DayRow | null;
}

const RANGE_DAYS: Record<Exclude<ChartRange, "all">, number> = { "90d": 90, "12m": 365 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Every calendar day from the first row to the last, so that a date the
 *  series skips takes its place on the axis as a day without a row. */
export function calendar(series: DayRow[]): ChartDay[] {
  const rows = new Map(series.map((r) => [r[0], r]));
  const sorted = [...rows.keys()].sort();
  if (!sorted.length) return [];
  const days: ChartDay[] = [];
  for (let day = sorted[0]; day <= sorted[sorted.length - 1]; day = nextDay(day)) {
    days.push({ day, row: rows.get(day) ?? null });
  }
  return days;
}

/** A row holds a report when a school reported or a meal was counted. */
export function held(row: DayRow | null): row is DayRow {
  return row !== null && (row[2] > 0 || row[3] > 0);
}

/** What a day is drawn at, or null where there is nothing to draw: no row,
 *  no meals counted, or no school reporting. Never zero for a silent day. */
export function valueOf(row: DayRow | null, measure: ChartMeasure): number | null {
  if (!row) return null;
  if (measure === "meals") return row[3] > 0 ? row[3] : null;
  return row[1] > 0 && row[2] > 0 ? (row[2] / row[1]) * 100 : null;
}

export function formatValue(value: number, measure: ChartMeasure): string {
  return measure === "meals" ? count(Math.round(value)) : `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}

/** The ranges a series of `days` calendar days is long enough to offer. */
export function rangesFor(days: number): ChartRange[] {
  const ranges: ChartRange[] = [];
  if (days > RANGE_DAYS["90d"]) ranges.push("90d");
  if (days > RANGE_DAYS["12m"]) ranges.push("12m");
  ranges.push("all");
  return ranges;
}

/** Twelve months where the series reaches past them, otherwise all of it. */
export function defaultRange(days: number): ChartRange {
  return days > RANGE_DAYS["12m"] ? "12m" : "all";
}

/** The last days of the series that fall in the range. */
export function inRange(days: ChartDay[], range: ChartRange): ChartDay[] {
  return range === "all" ? days : days.slice(-RANGE_DAYS[range]);
}

/** Runs of consecutive days that hold a value, as [first, last] positions.
 *  A line or an area is drawn within a run and never from one to the next. */
export function segments(values: (number | null)[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  values.forEach((v, i) => {
    if (v !== null && start < 0) start = i;
    if (v === null && start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, values.length - 1]);
  return runs;
}

/**
 * The stepped outline of one run: flat across each day, in the units of a
 * drawing `width` wide whose baseline is at `base` and whose `top` value sits
 * at `ceiling`. `closed` drops both ends to the baseline, for a filled area.
 */
export function stepPath(
  values: (number | null)[], [first, last]: [number, number],
  box: { width: number; base: number; ceiling: number; top: number },
  closed: boolean,
): string {
  const x = (i: number) => +((i / values.length) * box.width).toFixed(2);
  const y = (v: number) => +(box.base - (v / box.top) * (box.base - box.ceiling)).toFixed(2);
  let path = closed ? `M${x(first)},${box.base}` : "";
  for (let i = first; i <= last; i++) {
    const level = y(values[i] ?? 0);
    path += `${path ? "L" : "M"}${x(i)},${level}L${x(i + 1)},${level}`;
  }
  return closed ? `${path}L${x(last + 1)},${box.base}Z` : path;
}

const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The value at the top of the drawing and the gridlines under it. Meals get
 *  three round steps that clear the highest day; a share is always of 100. */
export function yAxis(max: number, measure: ChartMeasure): { top: number; lines: number[] } {
  if (measure === "share") return { top: 100, lines: [50, 100] };
  if (max <= 3) return { top: 3, lines: [1, 2, 3] };
  const power = 10 ** Math.floor(Math.log10(max / 3));
  // Meals are whole: 1.5 is a step only from 15 upwards.
  const step = power * (STEPS.find((s) => s * power * 3 >= max && Number.isInteger(s * power)) ?? 10);
  return { top: step * 3, lines: [step, step * 2, step * 3] };
}

/** A tick at the first of each month in view, thinned evenly to `maxTicks`,
 *  with the year on the first tick and wherever it changes. */
export function monthTicks(days: string[], maxTicks: number): { index: number; label: string }[] {
  const starts = days.flatMap((day, index) => (day.endsWith("-01") ? [{ index, day }] : []));
  const every = Math.max(1, Math.ceil(starts.length / Math.max(1, maxTicks)));
  let year = "";
  return starts.filter((_, i) => i % every === 0).map(({ index, day }) => {
    const month = MONTHS[Number(day.slice(5, 7)) - 1];
    const label = day.slice(0, 4) === year ? month : `${month} ${day.slice(0, 4)}`;
    year = day.slice(0, 4);
    return { index, label };
  });
}

/** The parts of each blank range that fall on the days in view, as
 *  [first, last] positions, widest first. */
export function blankSpans(days: string[], blanks: [string, string][]): [number, number][] {
  if (!days.length) return [];
  const spans: [number, number][] = [];
  for (const [from, to] of blanks) {
    if (to < days[0] || from > days[days.length - 1]) continue;
    const first = days.findIndex((d) => d >= from);
    let last = days.length - 1;
    while (days[last] > to) last--;
    if (first >= 0 && last >= first) spans.push([first, last]);
  }
  return spans.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
}

/** One day in words: the figures filed for it, or that none are held. */
export function readout({ day, row }: ChartDay): string {
  if (!held(row)) return `${dayLong(day)}: no report held for this day`;
  const [, schools, reported, meals] = row;
  const of = share(reported, schools);
  return `${dayLong(day)}: ${count(reported)} of ${count(schools)} schools listed reported${
    of ? ` (${of})` : ""}, ${count(meals)} meals reported`;
}

/** The chart for a reader who cannot see it: its first day, its last day and
 *  its highest value with the date, under the registry's label. */
export function summary(days: ChartDay[], measure: ChartMeasure, label: string): string {
  if (!days.length) return `${label}: no days read.`;
  const at = (d: ChartDay) => {
    // A day some schools reported on with no meals counted is a filed zero,
    // which the drawing leaves empty and the sentence must not call silence.
    const text = held(d.row) ? formatValue(valueOf(d.row, measure) ?? 0, measure) : "no report held";
    return `${text} on ${dayShort(d.day)}`;
  };
  let highest: ChartDay | null = null;
  for (const d of days) {
    const v = valueOf(d.row, measure);
    if (v !== null && (highest === null || v > (valueOf(highest.row, measure) ?? 0))) highest = d;
  }
  const peak = highest ? ` Highest: ${at(highest)}.` : "";
  return `${label}, ${days.length} days. First day: ${at(days[0])}. Last day: ${at(days[days.length - 1])}.${peak}`;
}
