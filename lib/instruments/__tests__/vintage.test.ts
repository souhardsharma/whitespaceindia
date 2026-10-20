/**
 * How old each source is said to be.
 *
 * Two hand-written statements went stale. "Fourteen years ago" was typed
 * into one page while another calculated the Census's age. "Live register"
 * was written into four places with no date behind it, and was applied to
 * sources that are not the register. These pin the shared rule, and fail if
 * a page writes its own version again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  CENSUS_YEAR,
  REGISTER_SOURCE,
  censusAge,
  nextCensusNote,
  readDateIST,
  registerStart,
  sourceVintageLabel,
} from "../vintage.ts";

test("the Census age is counted, not written", () => {
  assert.equal(censusAge(new Date("2026-09-24T00:00:00Z")), 15);
  assert.equal(censusAge(new Date("2031-01-01T00:00:00Z")), 20);
  assert.equal(CENSUS_YEAR, 2011);
});

test("a fixed source carries the year it was collected", () => {
  assert.equal(sourceVintageLabel({ name: "Census", vintage: "2011" }), "Collected 2011");
});

test("the register carries the sync's read date, not its fetch stamp", () => {
  const label = sourceVintageLabel(
    { name: REGISTER_SOURCE, vintage: "live", fetched: "2026-08-01T00:00:00Z" },
    "2026-09-01T03:47:00Z",
  );
  assert.equal(label, "Updating source · read 1 September 2026");
});

test("another updating source carries its own date, never the register's", () => {
  const label = sourceVintageLabel(
    { name: "PARIVESH Common Application Form", vintage: "live", fetched: "2026-09-02T17:55:49Z" },
    "2026-09-01T03:47:00Z",
  );
  assert.equal(label, "Updating source · read 2 September 2026");
  assert.ok(!label.toLowerCase().includes("register"));
});

test("a read time is a date in IST, and 18:30 UTC is already the next day", () => {
  assert.equal(readDateIST("2026-09-01T18:45:00Z"), "2 September 2026");
});

test("an unknown read time is said, not hidden or guessed", () => {
  assert.equal(
    sourceVintageLabel({ name: REGISTER_SOURCE, vintage: "live" }, "not a date"),
    "Updating source · read time unavailable",
  );
  assert.equal(readDateIST(undefined), null);
});

/** Every shipped instrument source file. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") out.push(...sources(p));
    } else if (/\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const SHIPPED = [
  ...sources("app/instruments"),
  ...sources("components/instruments"),
  ...sources("lib/instruments"),
].filter((p) => !p.replace(/\\/g, "/").endsWith("lib/instruments/vintage.ts"));

test("no page labels a source's currency by itself", () => {
  const offenders = SHIPPED.filter((p) => /vintage\s*===\s*["']live["']/.test(readFileSync(p, "utf8")));
  assert.deepEqual(offenders, [], "use sourceVintageLabel() from lib/instruments/vintage.ts");
});

test("the register's start is read from its published span", () => {
  assert.equal(registerStart({ earliest: "2022-09-15" }), "September 2022");
  assert.equal(registerStart({ earliest: "2022-01-01" }), "January 2022");
});

test("no span means no claim about the register's start", () => {
  assert.equal(registerStart(null), null);
  assert.equal(registerStart({}), null);
  assert.equal(registerStart({ earliest: "15/09/2022" }), null);
});

test("no page types the register's first year", () => {
  const TYPED = /\b(from|since)\s+20\d\d\s+onward|\b20\d\d\s+onward/i;
  const offenders = SHIPPED.filter((p) => {
    const code = readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    return TYPED.test(code);
  });
  assert.deepEqual(offenders, [], "use registerStart(meta.register_span)");
});

test("no page spells out how old the Census is", () => {
  const WORD_AGE =
    /\b(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+years\s+(ago|old)\b/i;
  const offenders = SHIPPED.filter((p) => {
    // Comments may explain the history; rendered text may not repeat it.
    const code = readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    return WORD_AGE.test(code);
  });
  assert.deepEqual(offenders, [], "use censusAge() from lib/instruments/vintage.ts");
});


test("the next census is worded for the day the page is read", () => {
  assert.match(nextCensusNote(new Date("2026-09-25T00:00:00Z")), /under way.*February 2027/);
  assert.match(nextCensusNote(new Date("2027-02-10T00:00:00Z")), /taking place this month/);
  assert.match(nextCensusNote(new Date("2027-06-01T00:00:00Z")), /took place in February 2027/);
  for (const d of ["2026-09-25", "2027-02-10", "2028-01-01"]) {
    assert.doesNotMatch(nextCensusNote(new Date(`${d}T00:00:00Z`)), /figures are published(?! yet)/);
  }
});

test("no page types the next census's schedule", () => {
  const offenders = SHIPPED.filter((p) => {
    const code = readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    return /February\s+2027|Census\s+2027\s+is/.test(code);
  });
  assert.deepEqual(offenders, [], "use nextCensusNote() from lib/instruments/vintage.ts");
});
