/**
 * The sentence a reader sees about where a project is.
 *
 * It was a constant: "That is the location as filed with the clearance
 * application, not an inference" - printed on a Malabar Hill redevelopment
 * whose own title said "District: Mumbai City", while the profile described
 * Mumbai Suburban and the coordinates, drawn beside it, fell in Mumbai. These
 * pin that the sentence is computed from the filing's three statements of
 * place and never asserts agreement the evidence does not show.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { locationEvidence } from "../location.ts";

const NAMES = { "518": "Mumbai Suburban", "519": "Mumbai", "170": "Banda", "171": "Chitrakoot", "535": "Medak", "537": "Rangareddy" };

const base = {
  resolution: "village",
  district: 518,
  allDistricts: null,
  declaredDistrict: 518,
  villageCount: 1,
  verdict: "inside",
  fallsIn: 518,
};

test("agreement is stated only when all three statements agree", () => {
  const e = locationEvidence(base, NAMES);
  assert.equal(e.contested, false);
  assert.equal(e.firm, true);
  assert.match(e.sentences.join(" "), /declares and the coordinates of its site both agree/);
});

test("the old constant never appears", () => {
  for (const verdict of ["inside", "elsewhere", "boundary", null]) {
    const text = locationEvidence({ ...base, verdict }, NAMES).sentences.join(" ");
    assert.doesNotMatch(text, /not an inference/);
  }
});

test("an adjudicated location says what overruled the codes", () => {
  const e = locationEvidence(
    { ...base, resolution: "adjudicated", district: 519, declaredDistrict: 519, fallsIn: 519, villageCount: 0 },
    NAMES,
  );
  assert.equal(e.firm, true);
  const text = e.sentences.join(" ");
  assert.match(text, /place codes .* point to another district/);
  assert.match(text, /both place the project in Mumbai/);
});

test("three-way disagreement is published as contested and names all three", () => {
  const e = locationEvidence(
    { ...base, district: 535, declaredDistrict: 518, verdict: "elsewhere", fallsIn: 537 },
    NAMES,
  );
  assert.equal(e.contested, true);
  assert.equal(e.firm, false);
  const text = e.sentences.join(" ");
  for (const n of ["Medak", "Mumbai Suburban", "Rangareddy"]) assert.match(text, new RegExp(n));
});

test("coordinates outvoted by codes and declaration are named, not called an error", () => {
  const e = locationEvidence(
    { ...base, district: 171, declaredDistrict: 171, verdict: "elsewhere", fallsIn: 170 },
    NAMES,
  );
  assert.equal(e.contested, false);
  const text = e.sentences.join(" ");
  assert.match(text, /fall in Banda instead/);
  assert.doesNotMatch(text, /error/);
});

test("a declaration that disagrees is named even when the coordinates agree", () => {
  const text = locationEvidence(
    { ...base, declaredDistrict: 519, verdict: "inside", fallsIn: 518 },
    NAMES,
  ).sentences.join(" ");
  assert.match(text, /declares, Mumbai, does not/);
  assert.doesNotMatch(text, /both agree/);
});

test("a location from the title alone is never firm", () => {
  const e = locationEvidence({ ...base, resolution: "project_name", declaredDistrict: null }, NAMES);
  assert.equal(e.firm, false);
  assert.match(e.sentences.join(" "), /indicative/);
});

test("no district, no claim", () => {
  const e = locationEvidence({ ...base, district: null }, NAMES);
  assert.equal(e.firm, false);
  assert.match(e.sentences[0], /smaller than its state/);
});

test("a location placed from the declared district is not corroborated by it", () => {
  const e = locationEvidence(
    { ...base, resolution: "lgd_district", verdict: "elsewhere", fallsIn: 519 },
    NAMES,
  );
  const text = e.sentences.join(" ");
  assert.doesNotMatch(text, /declares agrees|two statements against one/);
  assert.match(text, /one statement against one/);
  assert.equal(e.firm, false);
});

test("a boundary verdict is never presented as agreement", () => {
  const e = locationEvidence({ ...base, verdict: "boundary", declaredDistrict: null }, NAMES);
  const text = e.sentences.join(" ");
  assert.doesNotMatch(text, /agree\./);
  assert.match(text, /neither confirm nor contradict/);
  assert.equal(e.firm, false);
});

test("coordinates that chose a town's district do not also confirm it", () => {
  const e = locationEvidence(
    { ...base, resolution: "town_settled", district: 519, declaredDistrict: null, verdict: "inside", fallsIn: 519 },
    NAMES,
  );
  const text = e.sentences.join(" ");
  assert.match(text, /spans more than one district/);
  assert.match(text, /coordinates of its site place it in Mumbai/);
  assert.doesNotMatch(text, /agree\./);
});

test("a town placement the declaration contradicts is flagged, not firm", () => {
  const e = locationEvidence(
    { ...base, resolution: "town_settled", district: 519, declaredDistrict: 518, verdict: "inside", fallsIn: 519 },
    NAMES,
  );
  assert.equal(e.firm, false);
  assert.match(e.sentences.join(" "), /declares, Mumbai Suburban, does not agree/);
});

test("offshore coordinates are not described as missing", () => {
  const text = locationEvidence(
    { ...base, verdict: "offshore", fallsIn: null, declaredDistrict: null },
    NAMES,
  ).sentences.join(" ");
  assert.match(text, /outside every district boundary/);
  assert.doesNotMatch(text, /records no site coordinates/);
});

test("a disagreeing declaration without coordinates is not firm", () => {
  const e = locationEvidence(
    { ...base, declaredDistrict: 519, verdict: null, fallsIn: null },
    NAMES,
  );
  assert.equal(e.firm, false);
  assert.match(e.sentences.join(" "), /does not agree/);
});
