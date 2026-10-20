/**
 * The other clearances, as the form declares them. An unread form and a form
 * that declares nothing are different silences; a declared forest diversion
 * is reported with the proposal number and hectares the form gives, and the
 * forest register's own record beside it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LINKS_BLANK, LINKS_NONE, LINKS_UNREAD, fpNumbers, linkedClearanceLines } from "../links.ts";

test("an unread form is never worded as declaring nothing", () => {
  const r = linkedClearanceLines(null);
  assert.equal(r.state, "unread");
  assert.match(LINKS_UNREAD, /not a statement that there are none/);
  assert.doesNotMatch(LINKS_UNREAD, /declares no/);
});

test("a form that declares nothing says so", () => {
  const r = linkedClearanceLines(0);
  assert.equal(r.state, "none");
  assert.match(LINKS_NONE, /declares no forest diversion/);
});

test("a declared forest diversion carries its number, area and the register's record", () => {
  const r = linkedClearanceLines(
    { f: ["FP/MP/MIN/QRY/574244/2026", "Application Submitted", 965.858, null, null] },
    { status: "Pending at DFO", area: 965.86, form: "Form-A (Part-I)", date: "2026-05-01" },
  );
  assert.equal(r.state, "declared");
  const text = r.lines.map((l) => l.text).join(" ");
  assert.match(text, /FP\/MP\/MIN\/QRY\/574244\/2026/);
  assert.match(text, /965\.86 ha applied/);
  assert.match(text, /forest register itself records it as "Pending at DFO"/);
});

test("each declared part gets its own line, and only declared parts appear", () => {
  const r = linkedClearanceLines({ w: ["Kuno National Park", "Pending", null], c: [1, "CRZ-II"] });
  assert.deepEqual(r.lines.map((l) => l.label), ["Wildlife board", "Coastal regulation zone"]);
  assert.match(r.lines[0].text, /Kuno National Park/);
});

test("a form that left every question blank is not a form that declares none", () => {
  const r = linkedClearanceLines({ u: "fwepc" });
  assert.equal(r.state, "blank");
  assert.match(LINKS_BLANK, /not a declaration that none/);
  assert.doesNotMatch(LINKS_BLANK, /declares no /);
  // "none" is reserved for a form that ANSWERED each question.
  assert.match(LINKS_NONE, /answers each question/);
});

test("a question left blank beside declared ones is named, never dropped", () => {
  const r = linkedClearanceLines({ f: ["FP/X/1", null, 3, null, null], u: "wc" });
  assert.equal(r.state, "declared");
  const blank = r.lines.find((l) => l.label === "Not answered");
  assert.ok(blank, "a Not answered line");
  assert.match(blank!.text, /wildlife board/);
  assert.match(blank!.text, /coastal regulation zone/);
});

test("the land breakup's figure is never given a unit it does not have", () => {
  const r = linkedClearanceLines({ a: 40 });
  const forest = r.lines.find((l) => l.label === "Forest clearance")!;
  assert.doesNotMatch(forest.text, /40 ha/);
  assert.match(forest.text, /without a unit/);
});

test("the forest register's status is dated by when it was read", () => {
  const r = linkedClearanceLines({ f: ["FP/X/1", null, null, null, null] },
    { status: "Stage-I", area: 2, form: "A", date: null, readAt: "2026-09-24T20:47:35+00:00" });
  assert.match(r.lines[0].text, /as read on 25 Sept? 2026/);
});

test("forest proposal numbers are normalised as the build normalises them", () => {
  assert.deepEqual(fpNumbers("FP/OR/ROAD/ 451983/2023, fp/mh/min/1234/2020 and FP/X/1"),
    ["FP/OR/ROAD/451983/2023", "FP/MH/MIN/1234/2020", "FP/X/1"]);
  assert.deepEqual(fpNumbers("NA"), []);
  assert.deepEqual(fpNumbers(null), []);
});

test("forest land in the breakup with the forest question blank is said once, plainly", () => {
  const r = linkedClearanceLines({ a: 77.17, u: "fwepc" });
  const forest = r.lines.find((l) => l.label === "Forest clearance")!;
  assert.match(forest.text, /leaves blank whether forest clearance is involved/);
  const blank = r.lines.find((l) => l.label === "Not answered")!;
  assert.doesNotMatch(blank.text, /forest clearance/);
  assert.match(blank.text, /wildlife board/);
});

test("a partly blank form is neither wholly blank nor wholly clear", () => {
  const r = linkedClearanceLines({ u: "fw" });
  assert.equal(r.state, "declared");
  assert.match(r.lines.find((l) => l.label === "Not answered")!.text, /forest clearance and the wildlife board/);
  const no = r.lines.find((l) => l.label === "Answered, none declared")!;
  assert.match(no.text, /eco-sensitive zone, a protected area and the coastal regulation zone/);
});
