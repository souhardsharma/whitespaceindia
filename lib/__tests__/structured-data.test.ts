/**
 * Dataset markup names its coverage as a Place.
 *
 * Google's Dataset structured data reads `spatialCoverage` as a Place or text.
 * The CSR layout typed it "Country" and Search Console reported "Invalid
 * object type for field 'spatialCoverage'" on 2026-10-22. This fails if any
 * page types it as anything else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SPATIAL = /spatialCoverage:\s*\{\s*"@type":\s*"(\w+)"/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

test("every spatialCoverage in a page's structured data is a Place", () => {
  const typed: { file: string; type: string }[] = [];
  for (const file of sources("app")) {
    for (const m of readFileSync(file, "utf8").matchAll(SPATIAL)) {
      typed.push({ file, type: m[1] });
    }
  }
  assert.ok(typed.length >= 3, `found only ${typed.length} spatialCoverage blocks; is the pattern stale?`);
  assert.deepEqual(typed.filter((t) => t.type !== "Place"), []);
});
