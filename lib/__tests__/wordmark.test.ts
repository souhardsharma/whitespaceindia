/**
 * One drawing of the brand. The header once showed "White/space / INDIA" on the
 * landing and a plain "Whitespace India" with a lighter mark everywhere else,
 * because each surface kept its own copy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SURFACES = [
  "app/page.tsx",
  "components/Navbar.tsx",
  "components/Footer.tsx",
  "components/ComingSoonOverlay.tsx",
  "components/instruments/InstrumentChrome.tsx",
];

for (const path of SURFACES) {
  test(`${path} draws the brand with the shared Wordmark`, () => {
    const source = readFileSync(path, "utf-8");
    assert.match(source, /<Wordmark\b/);
    assert.doesNotMatch(source, /src="\/logo\.svg"/);
  });
}

test("public/logo.svg is the Wordmark's own mark", () => {
  const logo = readFileSync("public/logo.svg", "utf-8");
  const wordmark = readFileSync("components/Wordmark.tsx", "utf-8");
  for (const width of ["22", "32"]) {
    assert.ok(logo.includes(`stroke-width="${width}"`));
    assert.ok(wordmark.includes(`strokeWidth="${width}"`));
  }
  assert.ok(logo.includes('fill="#9b2817"') && wordmark.includes('fill="#9b2817"'));
});
