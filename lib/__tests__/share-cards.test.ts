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
    "app/layout.tsx": "/og/whitespace-india-4.jpg",
    "app/csr/layout.tsx": "/og/csr-index-4.jpg",
    "app/instruments/layout.tsx": "/og/instruments-5.jpg",
    "lib/instruments/metadata.ts": "/og/consent-4.jpg",
    "app/health/layout.tsx": "/og/health-4.jpg",
    "app/energy/layout.tsx": "/og/energy-4.jpg",
    "app/education/layout.tsx": "/og/education-4.jpg",
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

test("a retired card name redirects to the card that replaced it", async () => {
  const { retiredCardRedirects } = await import("../../scripts/cloudflare/retired-cards.mjs");
  const cards = readdirSync("public/og");
  const lines: string[] = retiredCardRedirects(cards);
  const target = new Map(lines.map((line) => line.split(" ")).map(([from, to, code]) => {
    assert.equal(code, "301", from);
    return [from, to];
  }));
  // Googlebot asked for these a week after they were replaced (crawl stats, 2026-11).
  assert.equal(target.get("/og/consent-3.jpg"), "/og/consent-4.jpg");
  assert.equal(target.get("/og/csr-index-3.jpg"), "/og/csr-index-4.jpg");
  assert.equal(target.get("/og/instruments-4.jpg"), "/og/instruments-5.jpg");
  assert.equal(target.get("/og/brand.png"), "/og/whitespace-india-4.jpg");
  for (const [from, to] of target) {
    assert.ok(!existsSync(join("public", from)), `${from} is a served card and must not be redirected`);
    assert.ok(existsSync(join("public", to)), `${from} redirects to missing ${to}`);
  }
});
