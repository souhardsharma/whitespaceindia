/**
 * Meal Claims Check: what its charts may draw.
 *
 * A day with no report is a gap. These tests fail if a chart starts drawing
 * one as zero, joins a line across one, offers a range the series cannot
 * fill, or describes the wrong day as the highest.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankSpans, calendar, defaultRange, inRange, monthTicks, rangesFor, readout, segments, stepPath,
  summary, valueOf, yAxis,
} from "../mealChart.ts";
import type { DayRow } from "../meal.ts";

const SERIES: DayRow[] = [
  ["2026-10-30", 100, 90, 4000],
  ["2026-10-31", 100, 95, 4500],
  ["2026-11-01", 100, 0, 0],
  ["2026-11-03", 100, 80, 5200],
  ["2026-11-04", 100, 5, 0],
];

function run(first: string, length: number): DayRow[] {
  const [y, m, d] = first.split("-").map(Number);
  return Array.from({ length }, (_, i): DayRow => [
    new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10), 10, 9, 300 + i,
  ]);
}

test("a date the series skips takes its place as a day without a row", () => {
  const days = calendar(SERIES);
  assert.deepEqual(days.map((d) => d.day), [
    "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04",
  ]);
  assert.equal(days[3].row, null);
});

test("a day with no report is never drawn as zero", () => {
  const days = calendar(SERIES);
  assert.deepEqual(days.map((d) => valueOf(d.row, "meals")), [4000, 4500, null, null, 5200, null]);
  assert.deepEqual(days.map((d) => valueOf(d.row, "share")), [90, 95, null, null, 80, 5]);
  assert.match(readout(days[2]), /no report held for this day/);
  assert.match(readout(days[3]), /no report held for this day/);
  assert.equal(readout(days[0]), "Friday 30 October 2026: 90 of 100 schools listed reported (90.0%), 4,000 meals reported");
});

test("a line is drawn within a run of days and never across a gap", () => {
  const values = calendar(SERIES).map((d) => valueOf(d.row, "meals"));
  assert.deepEqual(segments(values), [[0, 1], [4, 4]]);
  assert.deepEqual(segments([null, null]), []);
  assert.deepEqual(segments([1, 2, 3]), [[0, 2]]);

  const box = { width: 600, base: 100, ceiling: 0, top: 6000 };
  const area = stepPath(values, [0, 1], box, true);
  assert.ok(area.startsWith("M0,100") && area.endsWith("L200,100Z"), area);
  assert.doesNotMatch(area, /L[3-6]\d\d,/, "the area stops where the run stops");
  assert.equal(stepPath(values, [4, 4], box, false), "M400,13.33L500,13.33");
});

test("only the ranges a series can fill are offered", () => {
  assert.deepEqual(rangesFor(47), ["all"]);
  assert.deepEqual(rangesFor(200), ["90d", "all"]);
  assert.deepEqual(rangesFor(1500), ["90d", "12m", "all"]);
  assert.equal(defaultRange(200), "all");
  assert.equal(defaultRange(1500), "12m");

  const days = calendar(run("2025-01-01", 500));
  assert.equal(inRange(days, "all").length, 500);
  const ninety = inRange(days, "90d");
  assert.equal(ninety.length, 90);
  assert.equal(ninety[89].day, days[499].day);
  assert.equal(inRange(days, "12m").length, 365);
});

test("ticks fall on the first of a month and name the year where it changes", () => {
  const days = calendar(run("2026-11-20", 80)).map((d) => d.day);
  assert.deepEqual(monthTicks(days, 6), [
    { index: 11, label: "Dec 2026" }, { index: 42, label: "Jan 2027" }, { index: 73, label: "Feb" },
  ]);
  const long = calendar(run("2025-01-01", 730)).map((d) => d.day);
  assert.ok(monthTicks(long, 4).length <= 4);
  assert.equal(monthTicks(long, 4)[0].label, "Jan 2025");
});

test("the scale clears the highest day in three round steps", () => {
  assert.deepEqual(yAxis(228736, "meals"), { top: 240000, lines: [80000, 160000, 240000] });
  assert.deepEqual(yAxis(2, "meals"), { top: 3, lines: [1, 2, 3] });
  assert.deepEqual(yAxis(97.9, "share"), { top: 100, lines: [50, 100] });
  for (const max of [4, 17, 999, 1000, 1001, 5200, 30000000]) {
    const { top, lines } = yAxis(max, "meals");
    assert.ok(top >= max && lines[0] < max, `${max} under ${top}`);
  }
});

test("a blank range is cut to the days in view", () => {
  const days = calendar(SERIES).map((d) => d.day);
  assert.deepEqual(blankSpans(days, [["2026-10-01", "2026-10-30"], ["2026-11-01", "2026-11-03"]]), [[2, 4], [0, 0]]);
  assert.deepEqual(blankSpans(days, [["2026-09-01", "2026-09-30"]]), []);
});

test("the summary names the first day, the last day and the true highest", () => {
  const days = calendar(SERIES);
  assert.equal(
    summary(days, "meals", "Meals reported served"),
    "Meals reported served, 6 days. First day: 4,000 on Fri 30 Oct 2026. Last day: 0 on Wed 4 Nov 2026. Highest: 5,200 on Tue 3 Nov 2026.",
  );
  assert.match(summary(days.slice(0, 3), "meals", "Meals reported served"), /Last day: no report held on Sun 1 Nov 2026\./);
  assert.match(summary(days, "share", "Share of schools reporting"), /Highest: 95\.0% on Sat 31 Oct 2026\./);
  assert.equal(summary([], "meals", "Meals reported served"), "Meals reported served: no days read.");
});
