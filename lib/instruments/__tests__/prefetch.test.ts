/**
 * Links into per-entity pages are never prefetched.
 *
 * Proposal and district pages are rendered on demand. A <Link> prefetches
 * its target as soon as it scrolls into view, so a page listing fifty
 * proposals asked the origin for fifty more renders, and a crawler that runs
 * JavaScript did that on every page it reached: 13 GB of origin transfer in
 * one day on 2026-10-20. This fails if a new list of such links prefetches.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ENTITY_HREF = /href=\{`\/instruments\/consent\/(district\/)?\$\{/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

test("every Link to a proposal or district page sets prefetch={false}", () => {
  const offenders: string[] = [];
  let checked = 0;
  for (const file of [...sources("app"), ...sources("components")]) {
    const src = readFileSync(file, "utf8");
    for (const tag of src.match(/<Link\b[^>]*>/g) ?? []) {
      if (!ENTITY_HREF.test(tag)) continue;
      checked++;
      if (!tag.includes("prefetch={false}")) offenders.push(file);
    }
  }
  assert.ok(checked >= 10, `found only ${checked} entity links; is the pattern stale?`);
  assert.deepEqual(offenders, []);
});
