/**
 * The site's own description keeps up with the site.
 *
 * The landing page gained a fifth tile, Instruments. The root metadata that
 * search engines and link previews read from went on saying "Four research
 * initiatives across CSR, Health, Education, and Energy", so the live
 * instrument was absent from the site's own description. These tests tie the
 * two together: every landing tile must be named in the root description, which
 * may not state a count of sections. The title carries the project's theme, and
 * five section names would not fit in what a results page shows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layout = readFileSync("app/layout.tsx", "utf8");
const landing = readFileSync("app/page.tsx", "utf8");

/** The titles of the landing tiles, read from the VERTS array. */
function tileTitles(): string[] {
  const start = landing.indexOf("const VERTS");
  assert.ok(start >= 0, "app/page.tsx no longer declares VERTS");
  const end = landing.indexOf("\n];", start);
  const block = landing.slice(start, end);
  return Array.from(block.matchAll(/\btitle:\s*"([^"]+)"/g), (m) => m[1]);
}

test("the landing page still has its tiles", () => {
  assert.ok(tileTitles().length >= 5, `found ${tileTitles().length} tiles`);
});

test("every landing tile is named in the site's description", () => {
  const m = layout.match(/description:\s*"([^"]+)"/);
  assert.ok(m, "no description in app/layout.tsx");
  const description = m[1].replace(/\s+and\s+/g, ", ");
  const missing = tileTitles().filter((t) => !m[1].includes(t) && !description.includes(t));
  assert.deepEqual(missing, [], `description "${m[1]}" omits a tile`);
});

test("the site description does not count its sections", () => {
  const counted =
    /\b(two|three|four|five|six|seven|eight|nine|ten)\s+(research\s+)?(initiatives|sections|indexes|verticals)\b/i;
  assert.ok(!counted.test(layout), "a counted description goes stale when a section is added");
});
