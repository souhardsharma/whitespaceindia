/**
 * A Census 2011 district heads its page with the State that holds it today,
 * and says which State held it in 2011 where the two differ. Hyderabad was
 * headed "Andhra Pradesh" on every surface.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { presentState, stateLabel } from "../place.ts";

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
