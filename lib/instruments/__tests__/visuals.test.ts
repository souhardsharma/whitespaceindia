/**
 * The arithmetic behind the marks.
 *
 * A chart is a claim, and a reader takes it faster and more completely than a
 * sentence - so a wrong mark is worse than a wrong paragraph. Everything here
 * decides what a reader sees: which colour a district gets, which quarter a
 * filing lands in, whether a bar is drawn at all.
 *
 * Run with:  npm test
 * The runner takes a glob, so a new suite in this directory is picked up
 * with no change to package.json. (The pattern is not repeated here: it
 * contains a star-slash, which would close this comment.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { quantileBins, colorFor, formatValue, RAMP, NO_DATA } from "../choropleth.ts";
import { quarterOf } from "../quarter.ts";
import { gapSkewsOlder } from "../gap.ts";

test("two districts with the same number always get the same colour", () => {
  // The one thing a reader would never expect is for two identical values to
  // be painted differently. Skewed data makes it easy: 500 districts on a
  // floor of zero put several quantile edges at the same number.
  const cases: Record<string, number[]> = {
    identical: Array(640).fill(0),
    single: [7],
    two: [1, 100],
    heavyTies: [...Array(500).fill(0), 10, 20, 30, 40, 50],
    negatives: [-50, -10, 0, 10, 50],
    spread: Array.from({ length: 640 }, (_, i) => i),
  };
  for (const [name, values] of Object.entries(cases)) {
    const bins = quantileBins(values);
    const seen = new Map<number, string>();
    for (const v of values) {
      const c = colorFor(v, bins);
      if (seen.has(v)) {
        assert.equal(seen.get(v), c, `${name}: value ${v} drawn two colours`);
      } else {
        seen.set(v, c);
      }
    }
  }
});

test("every bin colour comes from the validated ramp, and no value falls through", () => {
  const values = Array.from({ length: 640 }, (_, i) => i * 3);
  const bins = quantileBins(values);
  for (const b of bins) {
    assert.ok(RAMP.includes(b.color), `${b.color} is not a ramp step`);
  }
  for (const v of values) {
    assert.notEqual(
      colorFor(v, bins),
      NO_DATA,
      `${v} has a value but was drawn as no-data`,
    );
  }
  // The extremes specifically: the maximum must not fall past the last bin.
  assert.notEqual(colorFor(Math.max(...values), bins), NO_DATA);
  assert.notEqual(colorFor(Math.min(...values), bins), NO_DATA);
});

test("no data is never a ramp step", () => {
  const bins = quantileBins([1, 2, 3, 4, 5]);
  // "We have no number for this place" and "this place scored lowest" are
  // different facts; sharing an encoding would make them indistinguishable.
  for (const missing of [null, undefined, NaN, Infinity]) {
    assert.equal(colorFor(missing as never, bins), NO_DATA);
  }
  assert.ok(!RAMP.includes(NO_DATA), "no-data must sit outside the ramp");
});

test("every bin drawn in the legend is one some district can actually be", () => {
  // A bin whose min equals its max is unreachable: colorFor is upper-inclusive,
  // so the bin before it already caught every value at that number. The reader
  // is then shown a swatch in the legend and invited to hunt the map for a
  // colour that is not on it. It happens whenever the top of the distribution
  // is tied, which is the shape a count measure with a ceiling has.
  const cases: Record<string, number[]> = {
    tiedTop: [1, 2, 3, ...Array(500).fill(100)],
    tiedBottom: [...Array(500).fill(0), 10, 20, 30, 40, 50],
    identical: Array(640).fill(4),
    single: [7],
    two: [1, 100],
    spread: Array.from({ length: 640 }, (_, i) => i),
    negatives: [-50, -10, 0, 10, 50],
  };
  for (const [name, values] of Object.entries(cases)) {
    const bins = quantileBins(values);
    const used = new Set(values.map((v) => colorFor(v, bins)));
    for (const b of bins) {
      assert.ok(
        used.has(b.color),
        `${name}: bin ${b.min}..${b.max} (${b.color}) can never be drawn`,
      );
    }
    // And no colour appears twice, which would make the legend ambiguous.
    const colors = bins.map((b) => b.color);
    assert.equal(
      new Set(colors).size,
      colors.length,
      `${name}: two bins share a colour`,
    );
  }
});

test("a measure that cannot separate districts is not painted as 'all low'", () => {
  // When ties collapse everything into one bin the map has no variation to
  // show. Drawing that in the lightest step states "every district is low" and
  // in the darkest "every district is high"; neither is a claim the data made.
  const bins = quantileBins(Array(640).fill(99));
  assert.equal(bins.length, 1);
  assert.notEqual(bins[0].color, RAMP[0], "a flat map must not read as low");
  assert.notEqual(
    bins[0].color,
    RAMP[RAMP.length - 1],
    "a flat map must not read as high",
  );
  assert.ok(RAMP.includes(bins[0].color));
});

test("an empty measure draws nothing rather than a misleading everything", () => {
  const bins = quantileBins([]);
  assert.deepEqual(bins, []);
  assert.equal(colorFor(5, bins), NO_DATA);
});

test("a value is formatted the way its registry entry says", () => {
  assert.equal(formatValue(12.34, "percent"), "12.3%");
  assert.equal(formatValue(1.239, "ratio"), "1.24");
  assert.equal(formatValue(null, "count"), "no data");
  assert.equal(formatValue(NaN, "percent"), "no data");
  // Counts are whole and grouped INDIAN-style - lakh and crore, not thousands.
  //
  // This was `/^[\d,]+$/`, which accepts "1,234,567" and "1234567" just as
  // happily as "12,34,567": switching the formatter to en-US, or dropping
  // grouping altogether, passed. Every count on the instrument goes through
  // this one function - district proposal counts, populations, land areas - so
  // the assertion is the exact string an Indian reader expects.
  assert.equal(formatValue(1234567, "count"), "12,34,567");
  assert.equal(formatValue(100000, "count"), "1,00,000");
  assert.equal(formatValue(12345678, "count"), "1,23,45,678");
  // Rounded, never truncated, and never in exponential form.
  assert.equal(formatValue(1234.6, "count"), "1,235");
});

// ── The quarter a mark lands in ────────────────────────
// Imported, NOT reimplemented. These assertions used to run against a copy of
// quarterOf declared in this file, so deleting the IST shift from the shipped
// function left all of them passing.

test("a filing date is not shifted, a read timestamp is", () => {
  // `fon` is a bare date the build already converted to IST. Shifting it again
  // would move a 1 January filing into the previous year.
  assert.equal(quarterOf("2026-01-01"), "2026-Q1");
  assert.equal(quarterOf("2026-03-31"), "2026-Q1");
  assert.equal(quarterOf("2026-04-01"), "2026-Q2");

  // `readAt` is a full UTC timestamp. A read after 18:30 UTC on a quarter's
  // last day is already the next quarter in India - and getting this wrong
  // hatches the PREVIOUS, complete quarter while leaving the incomplete one
  // solid, which is the opposite of what the marker is for.
  assert.equal(quarterOf("2026-03-31T20:00:00+00:00", true), "2026-Q2");
  assert.equal(quarterOf("2026-06-30T19:00:00+00:00", true), "2026-Q3");
  // The ordinary case: the sync runs 01:30 UTC, which is 07:00 IST same day.
  assert.equal(quarterOf("2026-01-01T01:30:00+00:00", true), "2026-Q1");
});

test("an unparseable date yields nothing rather than a wrong quarter", () => {
  assert.equal(quarterOf("not a date"), null);
  assert.equal(quarterOf(""), null);
});

// -- Whether the gap may be called "overwhelmingly older" -------------------
// The timeline printed that sentence for every district with an undated row,
// without looking at one. On the page's own basis it holds in 541 of the 542
// districts that have both cohorts; in one - census code 638 - it does not,
// and that district has a single undated proposal whose register year matches
// the dated ones beside it. None skews newer.

test("a gap that really is older is described as older", () => {
  const rows = [
    { filedOn: "2025-02-01", registeredOn: "2025-02-01" },
    { filedOn: "2025-06-01", registeredOn: "2025-06-01" },
    { filedOn: null, registeredOn: "2019-03-01" },
    { filedOn: null, registeredOn: "2020-07-01" },
  ];
  assert.equal(gapSkewsOlder(rows), true);
});

test("one same-year undated row is not 'overwhelmingly older'", () => {
  // The exact shape of the district this was wrong in: a single undated
  // proposal from the same year as the dated ones.
  const rows = [
    { filedOn: "2023-04-01", registeredOn: "2023-04-01" },
    { filedOn: null, registeredOn: "2023-09-01" },
  ];
  assert.equal(gapSkewsOlder(rows), false);
});

test("a NEWER gap is never called older", () => {
  const rows = [
    { filedOn: "2018-01-01", registeredOn: "2018-01-01" },
    { filedOn: "2019-01-01", registeredOn: "2019-01-01" },
    { filedOn: null, registeredOn: "2026-01-01" },
  ];
  assert.equal(gapSkewsOlder(rows), false);
});

test("it withholds the claim when it cannot tell", () => {
  // No undated rows, no dated rows, and no usable register dates. False in
  // every case: withholding a characterisation beats inventing one.
  assert.equal(gapSkewsOlder([]), false);
  assert.equal(
    gapSkewsOlder([{ filedOn: "2024-01-01", registeredOn: "2024-01-01" }]),
    false,
  );
  assert.equal(gapSkewsOlder([{ filedOn: null, registeredOn: null }]), false);
  assert.equal(
    gapSkewsOlder([
      { filedOn: null, registeredOn: "not a date" },
      { filedOn: "2024-01-01", registeredOn: "2024-01-01" },
    ]),
    false,
  );
});

test("the median decides it, so one ancient filing does not license the claim", () => {
  // Mean would say older: (2009 + 2025*3)/4 sits below the dated mean. The
  // cohort is contemporary apart from one outlier, and the sentence is about
  // the cohort.
  const rows = [
    { filedOn: "2024-01-01", registeredOn: "2024-01-01" },
    { filedOn: "2024-06-01", registeredOn: "2024-06-01" },
    { filedOn: null, registeredOn: "2009-01-01" },
    { filedOn: null, registeredOn: "2025-01-01" },
    { filedOn: null, registeredOn: "2025-06-01" },
    { filedOn: null, registeredOn: "2025-09-01" },
  ];
  assert.equal(gapSkewsOlder(rows), false);
});
