/**
 * A proposal page assembled in the browser shows what the register holds.
 *
 * Proposal pages read static files (scripts/instruments/proposal_pages.mjs)
 * through lib/instruments/bundle.ts, which must agree with the generator on
 * bucket counts and cell size: disagreeing, every page reads the wrong file
 * and reports a real proposal as "not found" while the build stays green.
 * The last test reads the generated files themselves (npm pretest builds them).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProposal, nearbyFrom, type ReadJson } from "../bundle.ts";
import type { Project } from "../types.ts";
import stages from "../../../public/data/instruments/consent/stages.json" with { type: "json" };

const site = (lat: number, lon: number) => ({ id: "1", site: { lat, lon } }) as unknown as Project;
const point = (order: number, id: string, lat: number, lon: number) =>
  [order, id, "s", lat, lon, `NO/${id}`, `Proposal ${id}`, "Mining", null] as
    [number, string, string, number, number, string, string, string, string | null];

test("nearby lists the nearest first, register order on ties, never the proposal itself", () => {
  const near = nearbyFrom([
    point(5, "far", 26.05, 75),      // ~5.6 km
    point(9, "tieLate", 26.01, 75),  // ~1.1 km
    point(2, "tieEarly", 25.99, 75), // ~1.1 km
    point(1, "1", 26, 75),           // itself
    point(3, "out", 26.2, 75),       // ~22 km
  ], site(26, 75));
  assert.deepEqual(near.items.map((n) => n.id), ["tieEarly", "tieLate", "far"]);
  assert.equal(near.total, 3);
  assert.equal(near.radiusKm, 10);
});

test("an id the register does not hold, or that is not a proposal number, is not found", async () => {
  const read: ReadJson = async () => null;
  for (const id of ["123", "abc", "", "1".repeat(13)]) {
    assert.equal(await loadProposal(id, read, stages), null);
  }
});

const VIEW = join("public", "view", "consent");
const DATA = join("public", "data", "instruments", "consent");

test("every sampled proposal is found in the files the build wrote, in the shard lookup names", {
  skip: existsSync(VIEW) ? false : "public/view not built (node scripts/instruments/proposal_pages.mjs)",
}, async () => {
  const read: ReadJson = async <T,>(path: string) => {
    const file = join("public", path);
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as T) : null;
  };
  const lookup = JSON.parse(readFileSync(join(DATA, "lookup.json"), "utf-8")) as Record<string, string>;
  const districts = JSON.parse(readFileSync(join(DATA, "districts.json"), "utf-8")) as Record<string, unknown>;
  const ids = Object.keys(lookup).filter((_, i) => i % 997 === 0);
  assert.ok(ids.length >= 50, `only ${ids.length} ids sampled`);
  for (const id of ids) {
    const view = await loadProposal(id, read, stages);
    assert.ok(view, `${id} not found`);
    assert.equal(view.bundle.project.id, id);
    assert.equal(view.bundle.stateSlug, lookup[id]);
    const kms = view.bundle.nearby.items.map((n) => n.km);
    assert.deepEqual(kms, [...kms].sort((a, b) => a - b), `${id}: nearby out of order`);
    assert.ok(kms.every((k) => k <= 10), `${id}: nearby beyond 10 km`);
    const placed = view.bundle.project.district;
    assert.deepEqual(view.bundle.district, placed != null ? districts[String(placed)] ?? null : null);
  }
});
