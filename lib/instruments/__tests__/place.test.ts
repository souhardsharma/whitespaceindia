/**
 * A Census 2011 district heads its page with the State that holds it today,
 * and says which State held it in 2011 where the two differ. Hyderabad was
 * headed "Andhra Pradesh" on every surface.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { presentState, stateLabel, titleCase } from "../place.ts";

test("districts whose State changed after 2011 carry today's State", () => {
  assert.equal(presentState(536, "Andhra Pradesh"), "Telangana"); // Hyderabad
  assert.equal(presentState(541, "Andhra Pradesh"), "Telangana"); // Khammam
  assert.equal(presentState(3, "Jammu & Kashmir"), "Ladakh"); // Leh
  assert.equal(presentState(495, "Daman & Diu"), "Dadra and Nagar Haveli and Daman and Diu");
});

test("districts whose State did not change are left alone", () => {
  assert.equal(presentState(545, "Andhra Pradesh"), "Andhra Pradesh"); // East Godavari
  assert.equal(presentState(10, "Jammu & Kashmir"), "Jammu & Kashmir"); // Srinagar
  assert.equal(presentState(null, "Rajasthan"), "Rajasthan");
});

test("the 2011 State is stated beside today's, never silently replaced", () => {
  assert.equal(stateLabel(536, "Andhra Pradesh"), "Telangana (Andhra Pradesh in Census 2011)");
  assert.equal(stateLabel(110, "Rajasthan"), "Rajasthan");
});

test("place names published in capitals read as a reader writes them", () => {
  assert.equal(titleCase("LEH (LADAKH)"), "Leh (Ladakh)");
  assert.equal(titleCase("SANT RAVI DAS NAGAR(BHADOHI)"), "Sant Ravi Das Nagar (Bhadohi)");
  assert.equal(titleCase("Dadra and Nagar Haveli and Daman and Diu"), "Dadra and Nagar Haveli and Daman and Diu");
  assert.equal(titleCase("ANDAMAN & NICOBAR ISLAND"), "Andaman & Nicobar Island");
  assert.equal(titleCase("NORTH & MIDDLE ANDAMAN"), "North & Middle Andaman");
  assert.equal(titleCase("PASCHIM BARDHAMAN"), "Paschim Bardhaman");
  assert.equal(titleCase("JAMMU & KASHMIR"), "Jammu & Kashmir");
  assert.equal(titleCase("of course"), "Of Course");
  assert.equal(titleCase(""), "");
});
