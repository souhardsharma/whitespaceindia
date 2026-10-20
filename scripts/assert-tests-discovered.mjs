/**
 * Fail if the test runner would find nothing.
 *
 * `npm test` globs its suites. Node's test runner treats a glob that matches
 * NO files as "nothing to do" and exits 0 - so deleting both suites, renaming
 * `__tests__`, or moving them under a directory the glob does not cover left
 * `npm test` printing "pass 0, fail 0" and CI green, with the PESA/coal,
 * determination, sub-division, choropleth and quarter gates all gone. The
 * previous form named the files literally and at least exited 1 when one went
 * missing; the glob traded that for discoverability and lost the guard.
 *
 * This restores it: the suites named below MUST be found, and the total must
 * not fall under their count. Adding a suite needs no change here; removing
 * or hiding one fails before a single test runs.
 */
import { globSync } from "node:fs";

/** Suites that must exist. Each guards a specific published claim. */
const REQUIRED = [
  "lib/instruments/__tests__/obligations.test.ts",
  "lib/instruments/__tests__/visuals.test.ts",
  "lib/instruments/__tests__/facts.test.ts",
  "lib/instruments/__tests__/vintage.test.ts",
  "lib/instruments/__tests__/site-metadata.test.ts",
  "lib/instruments/__tests__/register-map.test.ts",
  "lib/instruments/__tests__/location.test.ts",
  "lib/instruments/__tests__/place.test.ts",
  "lib/instruments/__tests__/links.test.ts",
  "lib/instruments/__tests__/csv.test.ts",
];

/** Must stay in step with the `test` script in package.json. */
const PATTERNS = [
  "lib/**/__tests__/*.test.ts",
  "components/**/__tests__/*.test.ts",
  "app/**/__tests__/*.test.ts",
];

const found = new Set(
  PATTERNS.flatMap((p) => globSync(p)).map((f) => f.split("\\").join("/")),
);

const missing = REQUIRED.filter((r) => !found.has(r));
const problems = [];

if (missing.length > 0) {
  problems.push(`required suite(s) not discovered: ${missing.join(", ")}`);
}
if (found.size < REQUIRED.length) {
  problems.push(
    `the test glob matched ${found.size} file(s); at least ${REQUIRED.length} are required`,
  );
}

if (problems.length > 0) {
  console.error("test discovery failed:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`  patterns: ${PATTERNS.join("  ")}`);
  console.error(
    "  A suite that is not discovered is a gate that is not running, and " +
      "the runner reports success either way.",
  );
  process.exit(1);
}

console.log(`test discovery ok: ${found.size} suite(s)`);
