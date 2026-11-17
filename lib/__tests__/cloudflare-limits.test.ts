/**
 * The Cloudflare Pages limits the assembled site is checked against. Each
 * guard must fire on a site that breaks it and stay quiet on one that does
 * not, because a deployment Pages refuses stops every tool's update at once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkLimits, countRedirects, countHeaderRules, LIMITS } from "../../scripts/cloudflare/limits.mjs";

const headersText = readFileSync(new URL("../../scripts/cloudflare/_headers", import.meta.url), "utf8");

function site(over: Record<string, unknown> = {}) {
  return {
    files: 10000,
    largest: [{ rel: "data/a.json", bytes: 1024 }],
    redirectsText: "/a /b 301\n/instruments/consent/1* /instruments/consent/view 200\n",
    headersText,
    routes: { include: ["/api/*"], exclude: ["/api/news"] },
    ...over,
  };
}

test("today's shape passes with no warnings", () => {
  const r = checkLimits(site());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("too many files fails, and 80% warns first", () => {
  assert.equal(checkLimits(site({ files: LIMITS.files + 1 })).errors.length, 1);
  const near = checkLimits(site({ files: 16500 }));
  assert.equal(near.errors.length, 0);
  assert.match(near.warnings[0], /files: 16500 of 20000/);
});

test("a file over 25 MiB fails; one over 20 MiB warns", () => {
  const big = checkLimits(site({ largest: [{ rel: "x.json", bytes: 26 * 1024 * 1024 }] }));
  assert.match(big.errors[0], /x\.json/);
  const near = checkLimits(site({ largest: [{ rel: "y.json", bytes: 21 * 1024 * 1024 }] }));
  assert.equal(near.errors.length, 0);
  assert.match(near.warnings[0], /y\.json/);
});

test("redirects are counted as Cloudflare counts them: a splat or placeholder is dynamic", () => {
  assert.deepEqual(countRedirects("# c\n/a /b\n/c/* /d 200\n/e/:id /f 301\n\n"), { staticCount: 1, dynamicCount: 2 });
  const many = Array.from({ length: 101 }, (_, i) => `/p${i}/* /q 200`).join("\n");
  assert.equal(checkLimits(site({ redirectsText: many })).errors.length, 1);
});

test("_headers rules and _routes.json rules are bounded", () => {
  assert.ok(countHeaderRules(headersText) > 0, "the real _headers file has rules");
  const headers = Array.from({ length: 101 }, (_, i) => `/p${i}\n  X-A: b`).join("\n");
  assert.equal(checkLimits(site({ headersText: headers })).errors.length, 1);
  const include = Array.from({ length: 101 }, (_, i) => `/r${i}/*`);
  assert.equal(checkLimits(site({ routes: { include, exclude: [] } })).errors.length, 1);
  const long = checkLimits(site({ routes: { include: ["/" + "a".repeat(120)], exclude: [] } }));
  assert.equal(long.errors.length, 1);
});
