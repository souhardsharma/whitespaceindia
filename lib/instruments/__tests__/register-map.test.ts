/**
 * The landing-page map draws the register index, and nothing else.
 *
 * A map is a stronger claim than a table: a reader takes the shade as the
 * number. These pin that every district the index holds is drawn with
 * exactly the index's counts, that only districts with a page are linked,
 * and that every option the map offers carries its own definition.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  REGISTER_MAP_MEASURES,
  REGISTER_MAP_OPTIONS,
  districtsWithAPage,
  registerMapDistricts,
  type RegisterRow,
} from "../registerMap.ts";

const rows: RegisterRow[] = JSON.parse(
  readFileSync("public/data/instruments/consent/register/districts.json", "utf8"),
);

test("every district in the index is drawn, with the index's own counts", () => {
  const drawn = registerMapDistricts(rows);
  assert.equal(Object.keys(drawn).length, rows.length);
  for (const r of rows) {
    const v = drawn[String(r.code)].values;
    assert.equal(v["register.proposals"], r.n, `proposals, district ${r.code}`);
    assert.equal(v["register.category_a"], r.nA, `category A, district ${r.code}`);
    assert.equal(v["register.displaced"], r.displaced, `displaced, district ${r.code}`);
  }
});

test("only districts holding a proposal are linked", () => {
  const linked = new Set(districtsWithAPage(rows));
  for (const r of rows) assert.equal(linked.has(r.code), r.n > 0, `district ${r.code}`);
});

test("every option the map offers is defined, as a count", () => {
  assert.ok(REGISTER_MAP_OPTIONS.length >= 1);
  for (const k of REGISTER_MAP_OPTIONS) {
    const spec = REGISTER_MAP_MEASURES[k];
    assert.ok(spec?.label && spec.definition, `${k} has a label and a definition`);
    assert.equal(spec.unit, "count");
  }
});
