/**
 * CSV downloads come in parts a serverless function can return (4.5 MB cap),
 * and a cell a spreadsheet would execute is neutralised.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PART_ROWS, csvCell, partOf, partsFor } from "../csv.ts";

test("a part holds few enough rows to stay well under the response cap", () => {
  // The widest rows measured are ~380 bytes (sixty days of events, 14 MB
  // over ~37,000 rows); a part must fit 4.5 MB with room to spare.
  assert.ok(PART_ROWS * 380 < 3.5 * 1024 * 1024, `${PART_ROWS} rows`);
});

test("parts cover a selection exactly", () => {
  assert.equal(partsFor(0), 1);
  assert.equal(partsFor(PART_ROWS), 1);
  assert.equal(partsFor(PART_ROWS + 1), 2);
});

test("only a positive whole part number is a part", () => {
  const p = (s: string) => partOf(new URLSearchParams(s));
  assert.equal(p(""), 1);
  assert.equal(p("part=3"), 3);
  assert.equal(p("part=0"), 0);
  assert.equal(p("part=-1"), 0);
  assert.equal(p("part=2x"), 0);
});

test("a formula is never handed to a spreadsheet", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), `"'=HYPERLINK(1)"`);
  assert.equal(csvCell("-2"), `"'-2"`);
  assert.equal(csvCell('say "x"'), `"say ""x"""`);
  assert.equal(csvCell(null), `""`);
});
