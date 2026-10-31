/**
 * The /csr-spending pages' State list matches the data, each district lands in
 * exactly one State, and the ledger's filter keeps a row's rank.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CSR_STATES, stateSlug } from "../csr/states.ts";
import { filterLedger } from "../csr/ledger.ts";

const master = JSON.parse(readFileSync("public/data/csr/whitespace_master.json", "utf-8")) as Array<{
  state_name: string;
  total_csr_recent: number;
  total_population: number;
  district_csr_per_person: number;
}>;

test("the State list is exactly the States in the data", () => {
  const inData = [...new Set(master.map((d) => d.state_name))].sort();
  assert.deepEqual([...CSR_STATES].sort(), inData);
});

test("State slugs are unique and readable", () => {
  const slugs = CSR_STATES.map(stateSlug);
  assert.equal(new Set(slugs).size, CSR_STATES.length);
  assert.equal(stateSlug("Dadra & Nagar Haveli & Daman & Diu"), "dadra-and-nagar-haveli-and-daman-and-diu");
  assert.ok(!slugs.includes("whitespace-districts"));
});

test("spending is in crore and per-person figures are rupees: the summing in spending.ts holds", () => {
  for (const d of master.filter((row) => row.total_csr_recent > 0 && row.total_population > 0)) {
    const perPerson = (d.total_csr_recent * 1e7) / d.total_population;
    assert.ok(Math.abs(perPerson - d.district_csr_per_person) < 0.01 * Math.max(1, perPerson));
  }
});

test("the ledger's filter finds by district or State, and a row keeps its rank", () => {
  const rows = [
    { district_name: "Purnia", state_name: "Bihar", is_whitespace: true, rank: 2 },
    { district_name: "Pune", state_name: "Maharashtra", is_whitespace: false, rank: 600 },
  ];
  assert.deepEqual(filterLedger(rows, " bihar ", false).map((r) => r.rank), [2]);
  assert.deepEqual(filterLedger(rows, "pu", false).map((r) => r.rank), [2, 600]);
  assert.deepEqual(filterLedger(rows, "pu", true).map((r) => r.rank), [2]);
  assert.equal(filterLedger(rows, "", false).length, 2);
});
