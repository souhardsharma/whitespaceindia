/**
 * Meal Claims Check: what a flag is allowed to say, and where a school lives.
 *
 * A flag is two filed figures that disagree. These tests fail if a surface
 * starts saying more than that, if the browser looks for a school in a
 * different bucket file than the pipeline wrote it to, or if a school page
 * becomes indexable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  bucketOf, dayShort, flagAfterword, flagFigures, flagSentence, nightNote, schoolKey, schoolPath,
  share, type Flag,
} from "../meal.ts";

const DATA = "public/data/instruments/meal-claims";
const base = { first: "2026-11-25", standing: true };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

test("an above-enrolment flag names the enrolment the school FILED", () => {
  const f: Flag = { ...base, day: "2026-11-08", kind: "over", meals: 70, enrolled: 23, excess: 47, wide: true };
  const s = flagSentence(f);
  assert.match(s, /reported 70 meals/);
  assert.match(s, /enrolment it filed for the month is 23/);
  assert.match(s, /47 above/);
  assert.doesNotMatch(s, /children/);
  assert.equal(flagFigures(f), "70 meals against a filed enrolment of 23");
});

test("a closed-day flag names the school's own weekday, whichever it is", () => {
  const friday: Flag = {
    ...base, day: "2026-11-13", kind: "closed", meals: 40, rule: "weekday",
    same_served: 0, same_days: 3, other_served: 18, other_days: 20,
  };
  const s = flagSentence(friday);
  assert.match(s, /on a Friday/);
  assert.match(s, /0 of the 3 other Fridays/);
  assert.doesNotMatch(s, /Sunday/);
});

test("a holiday flag rests on the State's list and says so", () => {
  const f: Flag = { ...base, day: "2026-11-01", kind: "closed", meals: 12, rule: "holiday", reason: "Gazetted" };
  assert.match(flagSentence(f), /its State's own list on this system marks as a holiday \(Gazetted\)/);
});

test("one meal is one meal", () => {
  const f: Flag = { ...base, day: "2026-11-02", kind: "over", meals: 1, enrolled: 0, excess: 1 };
  assert.match(flagSentence(f), /reported 1 meal\./);
});

test("a flag that no longer stands says what the day reads now", () => {
  const f: Flag = { ...base, day: "2026-11-01", kind: "spike", meals: 8674, usual: 20, days_compared: 14, standing: false, now: 24 };
  assert.match(flagAfterword(f) ?? "", /now shows 24 meals/);
  assert.equal(flagAfterword({ ...f, standing: true }), null);
});

test("no page of the instrument calls a flag anything stronger", () => {
  const files = [
    ...sources("app/instruments/meal-claims"), ...sources("components/instruments/meal"),
    "lib/instruments/meal.ts",
  ];
  assert.ok(files.length >= 10, `found only ${files.length} files`);
  for (const file of files) {
    // Comments explain the rule and may name the word; the copy may not.
    const copy = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(copy, /\b(fraud|scam|fake|bogus|ghost|siphon|embezzl|corrupt)/i, file);
  }
});

test("dates are calendar dates, whatever the reader's time zone", () => {
  assert.equal(dayShort("2026-11-01"), "Sun 1 Nov 2026");
  assert.equal(share(1, 3), "33.3%");
  assert.equal(share(1, 0), null);
});

test("a school address is a code and a shift, and nothing else", () => {
  assert.equal(schoolKey(schoolPath("16050718101-1")), "16050718101-1");
  assert.equal(schoolKey("/instruments/meal-claims/school/5061413601-1/"), "5061413601-1");
  assert.equal(schoolKey("/instruments/meal-claims/school/abc"), null);
  assert.equal(schoolKey("/instruments/meal-claims/view"), null);
});

test("the browser looks for a school in the bucket the pipeline wrote it to", () => {
  const meta = JSON.parse(readFileSync(join(DATA, "meta.json"), "utf8"));
  let schools = 0;
  for (const month of meta.months as string[]) {
    const dir = join(DATA, "schools", month);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const bucket = file.replace(/\.json$/, "");
      for (const [key, school] of Object.entries(JSON.parse(readFileSync(join(dir, file), "utf8")))) {
        const { code, shift } = school as { code: string; shift: string };
        assert.equal(key, `${code}-${shift}`);
        assert.equal(bucketOf(code, meta.buckets), bucket, `${key} in ${month}/${file}`);
        assert.equal(schoolKey(schoolPath(key)), key);
        schools++;
      }
    }
  }
  assert.ok(schools > 0, "no published school file was read");
});

test("the school page is never indexed and never in the sitemap", () => {
  const shell = readFileSync("app/instruments/meal-claims/view/page.tsx", "utf8");
  assert.match(shell, /robots: \{ index: false/);
  const view = readFileSync("components/instruments/meal/SchoolView.tsx", "utf8");
  assert.equal((view.match(/index: false/g) ?? []).length, (view.match(/applyHead\(/g) ?? []).length);
  assert.doesNotMatch(readFileSync("app/sitemap.ts", "utf8"), /schoolPath|meal-claims\/school/);
});

test("a night that ran out of budget is not called incomplete", () => {
  assert.equal(nightNote({ checked_at: "2026-11-25T01:00:00+00:00", outcome: "complete", complete: true }), null);
  assert.equal(nightNote({ checked_at: "2026-11-25T01:00:00+00:00", outcome: "refused" }), "the source refused part of the read");
});
