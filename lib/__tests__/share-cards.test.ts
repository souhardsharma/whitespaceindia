/**
 * Every share card a page names is a file that is served.
 *
 * A changed card gets a new filename so that scrapers caching by image URL
 * fetch it again. Renaming a card leaves every layout that named the old file
 * pointing at nothing, and a missing og:image fails silently: the page still
 * builds, and WhatsApp or LinkedIn simply show a bare link. Each section also
 * needs its own card, so a page from one section never previews as another.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CARD = /\/og\/[\w.-]+\.(?:jpg|png)/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

function cardsNamedIn(file: string): string[] {
  return readFileSync(file, "utf8").match(CARD) ?? [];
}

test("every share card named in app/ or lib/ exists in public/og", () => {
  const named = new Set([...sources("app"), ...sources("lib")].flatMap(cardsNamedIn));
  assert.ok(named.size >= 7, `found only ${named.size} cards; is the pattern stale?`);
  const missing = Array.from(named).filter((url) => !existsSync(join("public", url)));
  assert.deepEqual(missing, []);
});

test("each section previews with its own card", () => {
  const expected: Record<string, string> = {
    "app/layout.tsx": "/og/whitespace-india-2.jpg",
    "app/csr/layout.tsx": "/og/csr-index-2.jpg",
    "app/instruments/layout.tsx": "/og/instruments-3.jpg",
    "lib/instruments/metadata.ts": "/og/consent-2.jpg",
    "app/health/layout.tsx": "/og/health-2.jpg",
    "app/energy/layout.tsx": "/og/energy-2.jpg",
    "app/education/layout.tsx": "/og/education-2.jpg",
  };
  for (const [file, card] of Object.entries(expected)) {
    assert.deepEqual(Array.from(new Set(cardsNamedIn(file))), [card], file);
  }
});

test("share cards stay under WhatsApp's 300 KB preview limit", () => {
  for (const name of readdirSync("public/og")) {
    const kb = statSync(join("public/og", name)).size / 1024;
    assert.ok(kb < 300, `${name} is ${kb.toFixed(0)} KB`);
  }
});
