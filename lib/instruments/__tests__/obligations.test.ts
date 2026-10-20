/**
 * The obligation logic decides, for each proposal, whether a statutory consent
 * requirement applies. Nothing exercised it, and a substring comparison
 * therefore told 13,433 projects inside Scheduled Areas that the Gram Sabha's
 * mandatory role under PESA s.4(k)/(l) "does not apply".
 *
 * Run with:  npm test
 * The runner takes a glob, so a new suite in this directory is picked up
 * with no change to package.json. (The pattern is not repeated here: it
 * contains a star-slash, which would close this comment.)
 * No test dependency: Node strips the types itself.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import {
  resolveDetermination,
  resolveSite,
  obligationDetermination,
} from "../determination.ts";
import { evaluateTrigger, groupObligations, obligationsFor, sortObligations } from "../obligations.ts";
import { findingsForDistrict } from "../findings.ts";
import measures from "../../../public/data/instruments/consent/measures.json" with { type: "json" };
import index from "../../../public/data/instruments/consent/index.json" with { type: "json" };
import legal from "../../../public/data/instruments/consent/legal_reference.json" with { type: "json" };
import type { Project } from "../types.ts";

/**
 * A proposal, with only the fields the trigger logic reads.
 *
 * The rest of Project is irrelevant here and enumerating it would bury what
 * each test is actually varying.
 */
function project(over: {
  sector?: string;
  category?: string | null;
  forestLandHa?: number | null;
  totalLandHa?: number | null;
  affectedFamilies?: number | null;
  displacedFamilies?: number | null;
  rnrInvolved?: string | null;
}): Project {
  return {
    sector: over.sector ?? "INFRA-1",
    category: over.category === undefined ? "A" : over.category,
    declared: {
      affectedFamilies: over.affectedFamilies ?? null,
      displacedFamilies: over.displacedFamilies ?? null,
      rnrInvolved: over.rnrInvolved ?? null,
      litigationPending: null,
      violationInvolved: null,
      totalLandHa: over.totalLandHa ?? null,
      forestLandHa: over.forestLandHa ?? null,
    },
  } as unknown as Project;
}

const within = { status: "within" } as never;
const partial = { status: "partial" } as never;
const outside = { status: "outside" } as never;

// The register's sector vocabulary, READ FROM index.json rather than copied.
// A hand-kept copy drifts silently: if PARIVESH relabels "Non-Coal Mining",
// the published vocabulary changes, mineralTrigger stops matching, and a test
// iterating a stale copy keeps passing while PESA s.4(k)/(l) is denied to
// every non-coal mining proposal in a Scheduled Area.
const SECTORS: string[] = index.sectors;

/** Kept only to document what the vocabulary looked like when this was written. */
const SECTORS_AT_TIME_OF_WRITING = [
  "Coal Mining", "INFRA-1", "INFRA-2", "Industrial Projects - 1",
  "Industrial Projects - 2", "Industrial Projects - 3", "Non-Coal Mining",
  "River Valley and Hydroelectric Projects", "Thermal Projects",
];

test("PESA reaches non-coal mining inside a Scheduled Area", () => {
  // THE regression, asserted against the shipped function.
  //
  // This test used to define its own `const isCoal = (s) => s === "Coal
  // Mining"` and assert on that, and the file never imported obligations.ts
  // at all - so restoring `sector.toLowerCase().includes("coal")` in the real
  // module left every test here green while the panel told 13,433 proposals
  // in Scheduled Areas that the Gram Sabha has no role.
  const verdict = evaluateTrigger(
    "scheduled_area_minor_minerals",
    project({ sector: "Non-Coal Mining" }),
    within,
  );
  assert.notEqual(
    verdict,
    "no",
    "non-coal mining is where minor minerals live - sand, stone, murram, " +
      "ordinary clay - and PESA s.4(k)/(l) reaches it",
  );
  assert.equal(verdict, "conditional");
});

test("coal is still excluded, and every sector routes exactly", () => {
  // Coal is a MAJOR mineral: PESA's minor-mineral provisions do not reach it.
  assert.equal(
    evaluateTrigger("scheduled_area_minor_minerals", project({ sector: "Coal Mining" }), within),
    "no",
  );
  // Every other published sector must answer "no" for the mineral trigger,
  // and none may be routed by resembling another's name.
  for (const sector of SECTORS) {
    const v = evaluateTrigger("scheduled_area_minor_minerals", project({ sector }), within);
    const expected =
      sector === "Non-Coal Mining" ? "conditional" : "no";
    assert.equal(v, expected, `${sector} routed to ${v}, expected ${expected}`);
  }
});

test("outside a Scheduled Area the mineral trigger cannot apply", () => {
  assert.equal(
    evaluateTrigger("scheduled_area_minor_minerals", project({ sector: "Non-Coal Mining" }), outside),
    "no",
  );
  assert.equal(
    evaluateTrigger("scheduled_area_minor_minerals", project({ sector: "Non-Coal Mining" }), partial),
    "conditional",
  );
});

test("an unknown Scheduled Area status is a gap, never a denial", () => {
  // "outside" used to be reached through an else, so any status the code did
  // not recognise became "does not apply" - the strongest negative claim the
  // panel makes - on data it had never seen.
  for (const unknown of [null, { status: "" }, { status: "pending_review" }]) {
    assert.equal(
      evaluateTrigger("scheduled_area", project({}), unknown as never),
      "not_determined",
      `status ${JSON.stringify(unknown)} must read as undetermined`,
    );
  }
  assert.equal(evaluateTrigger("scheduled_area", project({}), within), "yes");
  assert.equal(evaluateTrigger("scheduled_area", project({}), outside), "no");
});

test("category and forest triggers do not invent an answer", () => {
  assert.equal(evaluateTrigger("category_a_or_b1", project({ category: "A" }), null), "conditional");
  assert.equal(evaluateTrigger("category_a_or_b1", project({ category: "B1" }), null), "conditional");
  assert.equal(evaluateTrigger("category_a_or_b1", project({ category: "B2" }), null), "no");
  assert.equal(evaluateTrigger("category_a_or_b1", project({ category: null }), null), "not_determined");
  // An undeclared forest area is unknown, not zero.
  assert.equal(evaluateTrigger("forest_land", project({ forestLandHa: null }), null), "not_determined");
  // "No forest land" needs BOTH statements read: the land breakup's forest
  // area, and the form's forest cross-reference (links). A greenfield project
  // can hold no forest and seek hundreds of hectares through diversion, so a
  // zero in the breakup alone is not a "no".
  assert.equal(evaluateTrigger("forest_land", project({ forestLandHa: 0 }), null), "not_determined");
  assert.equal(evaluateTrigger("forest_land", { ...project({ forestLandHa: 0 }), links: 0 }, null), "no");
  assert.equal(
    evaluateTrigger("forest_land", { ...project({ forestLandHa: 0 }), links: { f: ["FP/X/1", null, 12, null, null] } }, null),
    "yes",
  );
  assert.equal(evaluateTrigger("forest_land", { ...project({ forestLandHa: 0 }), links: { a: 40 } }, null), "yes");
  assert.equal(evaluateTrigger("forest_land", project({ forestLandHa: 12.5 }), null), "yes");
  // A form that left the forest-clearance question BLANK has not said "no".
  assert.equal(
    evaluateTrigger("forest_land", { ...project({ forestLandHa: 0 }), links: { u: "fwepc" } }, null),
    "not_determined",
  );
  // Blank on OTHER questions only: forest was answered, and nothing declared.
  assert.equal(
    evaluateTrigger("forest_land", { ...project({ forestLandHa: 0 }), links: { u: "wc" } }, null),
    "no",
  );
});

test("a determination is taken over every district a filing names", () => {
  const D = {
    "1": { status: "outside", instrument: "x" },
    "2": { status: "within", instrument: "y" },
    "3": { status: "partial", instrument: "z" },
    "4": { status: "not_determined", instrument: "w" },
  } as never;

  // The case that was wrong: primary outside, another named district inside.
  const r = resolveDetermination(D, 1, [1, 2]);
  assert.equal(r.governing?.status, "within");
  assert.equal(r.mixed, true);
  assert.deepEqual(r.scheduledDistricts, [2]);

  // partial beats outside, and not_determined beats outside - not knowing is
  // not the same as knowing there is nothing.
  assert.equal(resolveDetermination(D, 1, [1, 3]).governing?.status, "partial");
  assert.equal(resolveDetermination(D, 1, [1, 4]).governing?.status,
    "not_determined");

  // Every named district outside before the project can be called outside.
  assert.equal(resolveDetermination(D, 1, [1]).governing?.status, "outside");

  // dall is published only for multi-district filings, so the primary must be
  // folded in or a single-district project resolves against nothing.
  assert.equal(resolveDetermination(D, 2, null).governing?.status, "within");
  assert.equal(resolveDetermination(D, 2, []).governing?.status, "within");
});

test("an unknown district never strengthens or invents a determination", () => {
  const D = { "1": { status: "outside", instrument: "x" } } as never;
  const r = resolveDetermination(D, 999, [999]);
  assert.equal(r.governing, null, "no district known: no determination");
  assert.equal(resolveDetermination(undefined, 1, [1]).governing, null);
});

test("a named sub-division settles a partial district, one way only", () => {
  const partial = {
    status: "partial",
    instrument: "C.O. 192",
    scheduledSubdistricts: [3264, 3265],
  } as never;

  // The whole point of transcribing the sub-divisions: a site inside one the
  // Order names in whole IS inside the Scheduled Area.
  const hit = resolveSite(partial, [3265, 9999]);
  assert.equal(hit.status, "within");
  assert.deepEqual(hit.via, [3265]);

  // A site elsewhere in the district settles NOTHING. The Order may reach it
  // through a revenue circle, a panchayat or a named village that the Census
  // sub-district frame does not carry - 37 transcribed names do not resolve
  // to a Census unit at all - so this must never become "outside".
  const miss = resolveSite(partial, [9999]);
  assert.equal(miss.status, "partial");
  assert.equal(miss.unsettled, true);
  assert.notEqual(miss.status, "outside");

  // No sub-district filed: still unsettled, never downgraded.
  assert.equal(resolveSite(partial, null).status, "partial");

  // A district that is not partial is returned untouched.
  const outside = { status: "outside", instrument: "x" } as never;
  assert.equal(resolveSite(outside, [3265]).status, "outside");
  const within = { status: "within", instrument: "x" } as never;
  assert.equal(resolveSite(within, []).status, "within");

  // A partial district with nothing transcribed cannot settle anything.
  const bare = { status: "partial", instrument: "x" } as never;
  assert.equal(resolveSite(bare, [3265]).status, "partial");
});

test("every trigger the reference publishes is exercised here", () => {
  // The suite drove four of eleven keys. The seven it never called include
  // the resettlement trigger and the two acquisition triggers, which carry the
  // same hazard the file was written for: an undeclared field read as a
  // denial rather than as unknown. This pins the list, so a new obligation
  // cannot be published without a case being added below.
  const published = new Set(
    (legal.obligations as { triggerKey: string }[]).map((o) => o.triggerKey),
  );
  const covered = new Set([
    "category_a_or_b1",
    "scheduled_area",
    "scheduled_area_minor_minerals",
    "forest_land",
    "resettlement_entitlement",
    "acquisition_any",
    "acquisition_private_or_ppp",
    "critical_wildlife_habitat",
    "equator_principles",
    "ifc_standards",
    "ilo_107",
  ]);
  const uncovered = Array.from(published).filter((k) => !covered.has(k));
  assert.deepEqual(uncovered, [], "trigger keys with no test below");
});

test("an undeclared displacement is unknown, never a denial", () => {
  // 351 published proposals declare none of the three fields. Reading that
  // silence as "does not apply" tells those communities the RFCTLARR Second
  // Schedule has nothing for them, on no evidence at all.
  assert.equal(
    evaluateTrigger("resettlement_entitlement", project({}), within),
    "not_determined",
  );
  // Declared involvement, in each of the three ways the form allows.
  for (const decl of [
    { displacedFamilies: 4 },
    { affectedFamilies: 9 },
    { rnrInvolved: "YES" },
  ]) {
    assert.equal(
      evaluateTrigger("resettlement_entitlement", project(decl), within),
      "conditional",
      // NOT "yes". The Schedule attaches through acquisition under the Act or
      // a s.2(3) purchase, and the register records neither; "Applies" was
      // published on a private redevelopment of land the proponent owned.
      `${JSON.stringify(decl)} makes the Second Schedule possible, not established`,
    );
  }
  // Only an explicit nil is a "no".
  assert.equal(
    evaluateTrigger(
      "resettlement_entitlement",
      project({ displacedFamilies: 0, affectedFamilies: 0, rnrInvolved: "NO" }),
      within,
    ),
    "no",
  );
});

test("acquisition triggers never deny on a silent land area", () => {
  // 1,082 proposals declare no land area. The register does not record the
  // tenure route either, so the honest answers are "unknown" and "may apply" -
  // never "does not apply".
  for (const key of ["acquisition_any", "acquisition_private_or_ppp"]) {
    assert.equal(
      evaluateTrigger(key, project({ totalLandHa: null }), within),
      "not_determined",
      `${key} on an undeclared area`,
    );
    assert.equal(
      evaluateTrigger(key, project({ totalLandHa: 12.5 }), within),
      "conditional",
      `${key} on a declared area`,
    );
  }
});

test("triggers the register cannot answer say so, on any input", () => {
  for (const key of [
    "critical_wildlife_habitat",
    "equator_principles",
    "ifc_standards",
    "ilo_107",
  ]) {
    for (const d of [within, outside, partial, null]) {
      const v = evaluateTrigger(key, project({ totalLandHa: 40 }), d as never);
      assert.notEqual(v, "no", `${key} must not deny; the register is silent`);
    }
  }
});

test("a sub-division that settles the site settles the obligations too", () => {
  // The library proved this and the product threw it away: resolveSite
  // narrowed a partly Scheduled district to "within" for the screen, while
  // the obligation panel kept evaluating "partial" and rendered PESA s.4(i)
  // as "may apply". 1,090 proposals showed both statements at once.
  const partialDet = { status: "partial", scheduledSubdistricts: [3265] } as never;
  const site = resolveSite(partialDet, [3265]);
  assert.equal(site.status, "within", "the site is settled by the named sub-division");

  // The SHIPPED rule, not a copy of it: this is the function ProjectProfile
  // calls, so deleting the narrowing there breaks this test.
  const settled = obligationDetermination(partialDet as never, site) as never;

  assert.equal(evaluateTrigger("scheduled_area", project({}), partialDet), "conditional");
  assert.equal(
    evaluateTrigger("scheduled_area", project({}), settled),
    "yes",
    "once the site is settled, the duty applies rather than may apply",
  );
});

test("the narrowing rule only ever settles, never weakens", () => {
  const site = { status: "within", via: [3265], unsettled: false } as never;
  // partial -> within, which is the whole point.
  assert.equal(
    (obligationDetermination({ status: "partial" }, site) as { status: string }).status,
    "within",
  );
  // Everything else is returned untouched, including an "outside" district a
  // site resolution must never be able to promote.
  for (const status of ["outside", "not_determined", "within"]) {
    assert.equal(
      (obligationDetermination({ status }, site) as { status: string }).status,
      status,
      `${status} must pass through unchanged`,
    );
  }
  const unsettled = { status: "partial", via: [], unsettled: true } as never;
  assert.equal(
    (obligationDetermination({ status: "partial" }, unsettled) as { status: string }).status,
    "partial",
    "an unsettled site leaves the district determination alone",
  );
  assert.equal(obligationDetermination(null, site), null);
});

test("the profile actually feeds the narrowed determination to the panel", () => {
  // A WIRING check, and honest about being one: it reads source text rather
  // than behaviour, because this repo has no component-render harness. It
  // exists because the rule above can be perfectly correct and perfectly
  // tested while the component quietly passes the un-narrowed determination -
  // which is exactly what happened, on 1,090 proposals, for as long as the
  // property was proved only in this file.
  //
  // If a render harness is ever added, replace this with a real assertion on
  // what the panel renders.
  const src = readFileSync(
    new URL("../../../components/instruments/ProjectProfile.tsx", import.meta.url),
    "utf-8",
  );
  assert.match(
    src,
    /obligationDetermination\(/,
    "ProjectProfile must derive the obligation determination from the shared rule",
  );
  // A generous window: the call site carries a long explanatory comment
  // between the open paren and the argument.
  const call = src.slice(src.indexOf("obligationsFor("));
  assert.match(
    call.slice(0, 1400),
    /siteDetermination/,
    "obligationsFor must receive the site-narrowed determination",
  );
});

test("findings quote the published national benchmarks, not a stale copy", () => {
  // findings.ts held hardcoded literals, two of which had already drifted from
  // measures.json (SC share 16.2 vs 16.64; agricultural-labourer 30.0 vs
  // 29.92) with nothing comparing them. They now read from the registry. This
  // pins that: every benchmark a finding sentence quotes must resolve to the
  // published value, and a missing one must throw rather than default to 0 -
  // which would make every district read as far above the national figure.
  const india = (measures as { benchmarks?: { india?: Record<string, number | null> } })
    .benchmarks?.india ?? {};
  for (const key of [
    "pop.st_share",
    "work.land_dependent_share",
    "pop.literacy_rate",
  ]) {
    const v = india[key];
    assert.equal(
      typeof v,
      "number",
      `${key} must be published as a national benchmark; findings.ts quotes it`,
    );
  }

  // The sentences must carry the published number, not a literal.
  const st = india["pop.st_share"] as number;
  const found = findingsForDistrict(
    { values: { "pop.st_share": st * 2.5 } } as never,
    null,
    {},
  );
  const text = found.map((f) => f.text).join(" ");
  assert.ok(
    text.includes(String(st)),
    `a finding comparing to the national ST share must print ${st}; got: ${text.slice(0, 160)}`,
  );
});

// -- What the PDF export hands the obligation logic ------------------------
//
// The downloaded profile is the artefact a reader keeps and cites, and it used
// to print all fifteen obligations under "OBLIGATIONS THAT ATTACH" with no
// verdict at all - telling a reader that fifteen statutory duties attached to
// their proposal while the screen it came from said most did not.
//
// Wiring it to the shared function fixed that and broke the route: the export
// builds a FLAT project (`land`, `forest`, `displaced` at the top level,
// because that is what the document renders) and `evaluateTrigger` reads a
// `Project`, whose declared figures live under `declared`. The call was cast
// with `as never`, so it type-checked and then threw
// `Cannot read properties of undefined (reading 'totalLandHa')` on every
// single export. Nothing here exercised it, and the route has no test of its
// own, so the only signal was a 500.

test("the shape the PDF export builds satisfies every trigger", () => {
  // Exactly the object app/api/instruments/consent/export/route.ts assembles.
  const exportShape = {
    category: "A",
    sector: "Non-Coal Mining",
    declared: {
      totalLandHa: 12.5,
      forestLandHa: 0,
      affectedFamilies: 40,
      displacedFamilies: 5,
      rnrInvolved: "YES",
    },
  } as unknown as Project;

  const ref = legal as never;
  const det = { status: "within" } as never;

  // The failure was a throw, not a wrong answer, so the first assertion is
  // simply that it survives.
  const obligations = sortObligations(obligationsFor(ref, exportShape, det));
  assert.ok(obligations.length > 0, "no obligations produced");

  // Every one carries a verdict from the fixed vocabulary - a missing verdict
  // is what the document printed for a year.
  const allowed = new Set(["yes", "conditional", "no", "not_determined"]);
  for (const o of obligations) {
    assert.ok(
      allowed.has(o.applies),
      `${o.instrument}: verdict ${String(o.applies)}`,
    );
  }

  // And they are not all the same, which is the whole point of printing them:
  // a document where every duty "may apply" has told the reader nothing.
  assert.ok(
    new Set(obligations.map((o) => o.applies)).size > 1,
    "every obligation returned the same verdict",
  );
});

test("a project missing its declared block does not throw", () => {
  // The defensive half of the same lesson: `declared` is read directly, so an
  // absent one must be handled rather than crash a public endpoint.
  const bare = { category: "B2", sector: "Infrastructure" } as unknown as Project;
  assert.doesNotThrow(() => {
    for (const key of [
      "forest_land",
      "resettlement_entitlement",
      "acquisition_any",
      "acquisition_private_or_ppp",
    ]) {
      evaluateTrigger(key, bare, { status: "outside" } as never);
    }
  });
});


test("obligations group by answer, in reading order, and none is lost", () => {
  const items = [
    { applies: "no", id: 1 }, { applies: "yes", id: 2 },
    { applies: "not_determined", id: 3 }, { applies: "conditional", id: 4 },
    { applies: "no", id: 5 },
  ];
  const groups = groupObligations(items);
  assert.deepEqual(groups.map((g) => g.key), ["yes", "conditional", "not_determined", "no"]);
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), items.length);
  assert.deepEqual(groups[3].items.map((o) => o.id), [1, 5]);
});
