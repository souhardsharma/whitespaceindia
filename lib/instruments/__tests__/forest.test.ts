/**
 * A form states forest land twice: the existing forest land in its table of
 * land use (shard `forest`) and its answers on other clearances (`lk`). Where
 * the two disagree the page names both and says so; where the form names a
 * forest proposal, the page never says the filing is silent about it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { forestReading, linkedClearanceLines, LINKS_NONE } from "../links.ts";
import { findingsForDistrict, findingsForProject } from "../findings.ts";
import { evaluateTrigger } from "../obligations.ts";
import type { DistrictRecord, LinkedClearances, Project } from "../types.ts";

function project(forestLandHa: number | null, links: LinkedClearances | 0 | null): Project {
  return {
    sector: "Non-Coal Mining",
    category: "B2",
    links,
    declared: {
      affectedFamilies: null, displacedFamilies: null, rnrInvolved: null,
      litigationPending: null, violationInvolved: null,
      totalLandHa: forestLandHa, forestLandHa,
    },
  } as unknown as Project;
}

const forestFinding = (p: Project) =>
  findingsForProject(p, null, null).find((f) => f.id === "project.forest");

test("a form naming a forest proposal is never said to be silent about it", () => {
  const p = project(139.38, { f: ["FP/AP/OTHERS/407446/2022", "Final Diversion Order Issued", null, 139.38, "2026-03-06"] });
  assert.equal(forestReading(139.38, p.links), "proposal");
  const f = forestFinding(p)!;
  assert.match(f.text, /FP\/AP\/OTHERS\/407446\/2022/);
  assert.match(f.text, /"Final Diversion Order Issued"/);
  assert.doesNotMatch(f.text, /does not record whether/);
});

test("forest land in the table beside a form that declares none is a disagreement", () => {
  // 119067873: 3.449 of forest land, 0 of non-forest land, and "no" to every
  // clearance question.
  const p = project(3.449, 0);
  assert.equal(forestReading(3.449, 0), "disagrees");
  const f = forestFinding(p)!;
  assert.match(f.text, /disagrees with itself/);
  assert.doesNotMatch(f.text, /has declared that this project involves forest land/);
  const r = linkedClearanceLines(0, null, 3.449);
  assert.equal(r.state, "declared");
  const text = r.lines.map((l) => l.text).join(" ");
  assert.match(text, /disagrees with itself/);
  assert.doesNotMatch(text, /diverts no forest land/);
  assert.match(r.lines.find((l) => l.label === "Answered, none declared")!.text, /wildlife board/);
  // Neither "yes" nor "no" is said about forest duties for such a form.
  assert.equal(evaluateTrigger("forest_land", p, null), "not_determined");
  // A form with no forest land in its table still reads as declaring none.
  assert.equal(linkedClearanceLines(0, null, 0).state, "none");
  assert.match(LINKS_NONE, /diverts no forest land/);
});

test("a tenure table of only non-forest land disagrees with forest land in the table", () => {
  const links: LinkedClearances = { u: "fwepc", t: [["Non-forest Land", "Privately owned land", "Acquired"]] };
  assert.equal(forestReading(12, links), "disagrees");
  const r = linkedClearanceLines(links, null, 12);
  assert.match(r.lines[0].text, /lists only non-forest land/);
});

test("forest land in the table with the forest question blank is said, never dropped", () => {
  // 3347078: 1,016.412 of forest land and every clearance question blank.
  const r = linkedClearanceLines({ u: "fwepc" }, null, 1016.412);
  assert.equal(r.state, "declared");
  const forest = r.lines.find((l) => l.label === "Forest clearance")!;
  assert.match(forest.text, /leaves blank whether forest clearance is involved, but its table of land use records 1,016\.412/);
  assert.doesNotMatch(forest.text, / ha\b/);
  const blank = r.lines.find((l) => l.label === "Not answered")!;
  assert.doesNotMatch(blank.text, /forest/);
  assert.equal(forestReading(1016.412, { u: "fwepc" }), "table");
  assert.match(forestFinding(project(1016.412, { u: "fwepc" }))!.text, /leaves blank the question/);
});

test("an answered forest question is never called blank", () => {
  // 2838537: forest land in the table, additional forest land in the land
  // breakup, and the forest question answered with no proposal.
  const p = project(2.5, { a: 0.0842 });
  assert.equal(forestReading(2.5, p.links), "table");
  const text = forestFinding(p)!.text;
  assert.doesNotMatch(text, /leaves blank/);
  assert.match(text, /answers that no forest clearance is involved, although its land breakup lists additional forest land/);
});

test("identical parcels are said once, with how many there are", () => {
  const row: [string, string, string] = ["Non-forest Land", "Privately owned land", "Acquired"];
  const r = linkedClearanceLines({ t: Array.from({ length: 15 }, () => row) });
  const held = r.lines.find((l) => l.label === "How the land is held")!;
  assert.match(held.text, /Non-forest Land, Privately owned land, Acquired \(15 entries\)\.$/);
});

test("one answered question is worded in the singular", () => {
  const r = linkedClearanceLines({ u: "wepc" });
  const no = r.lines.find((l) => l.label === "Answered, none declared")!;
  assert.equal(no.text, "The form answers the question on forest clearance and declares nothing under it.");
});

test("the section 41(3) consent duty is stated with its reach, never unconditionally", () => {
  const district = { values: {} } as unknown as DistrictRecord;
  const p = project(null, null);
  const scheduled = findingsForProject(p, district, { status: "within" } as never)
    .find((f) => f.id === "project.scheduled")!;
  assert.match(scheduled.text, /before a notification to acquire land for it issues under that Act or under any other Central or State Act/);
  assert.match(scheduled.text, /Fourth Schedule/);
  assert.match(scheduled.text, /section 4\(i\)/i);
  assert.doesNotMatch(scheduled.text, /so acquiring land for it needs/);
  const legal = findingsForDistrict(district, { status: "within" } as never)
    .find((f) => f.id === "legal.scheduled")!;
  assert.match(legal.text, /point different ways/);
});
