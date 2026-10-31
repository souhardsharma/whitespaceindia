/**
 * The canonical origin: one host, which a stale environment value naming a
 * host the site has moved away from cannot move back, and every old host
 * redirecting to it path for path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIMARY_ORIGIN, LEGACY_CSR_HOSTS, MOVED_HOSTS, resolveSiteUrl } from "../site.ts";
import { readFileSync } from "node:fs";

const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));

// Vercel's redirect matching, as far as these two rules use it: a `has` host
// regex over the whole host, then "/" exactly or "/:path*" for any path.
function redirectFor(host: string, path: string): string | null {
  for (const rule of vercel.redirects) {
    const cond = rule.has?.[0];
    if (cond && !new RegExp(`^(?:${cond.value})$`).test(host)) continue;
    if (rule.source === "/" && path !== "/") continue;
    assert.equal(rule.permanent, true, "a moved host answers 308, which carries the old URL's standing");
    return rule.destination.replace("/:path*", path === "/" ? "/" : path);
  }
  return null;
}

test("Vercel builds nothing that can run: no framework, no install, no functions", () => {
  assert.equal(vercel.framework, null, "a framework build brings back the functions that paused the team");
  assert.equal(vercel.installCommand, "");
  for (const key of ["functions", "rewrites", "crons", "routes"]) {
    assert.equal(vercel[key], undefined, `${key} would give Vercel something to run`);
  }
});

test("the legacy CSR hosts send / to the CSR app and the rest path for path", () => {
  for (const h of LEGACY_CSR_HOSTS) {
    assert.equal(redirectFor(h, "/"), `${PRIMARY_ORIGIN}/csr`);
    assert.equal(redirectFor(h, "/methodology"), `${PRIMARY_ORIGIN}/methodology`);
  }
});

test("the parent brand's Vercel host sends / to / and every path to its twin", () => {
  assert.equal(redirectFor("whitespaceindia.vercel.app", "/"), `${PRIMARY_ORIGIN}/`);
  assert.equal(
    redirectFor("whitespaceindia.vercel.app", "/instruments/consent/2789183"),
    `${PRIMARY_ORIGIN}/instruments/consent/2789183`,
  );
});

test("a path that looks like another host still lands on the primary origin", () => {
  const to = redirectFor("whitespaceindia.vercel.app", "//evil.example/x");
  assert.equal(new URL(to!).origin, PRIMARY_ORIGIN);
});

test("no configured URL means the primary origin", () => {
  assert.equal(resolveSiteUrl(undefined), PRIMARY_ORIGIN);
  assert.equal(resolveSiteUrl(""), PRIMARY_ORIGIN);
});

test("a configured host the site moved away from resolves to the primary origin", () => {
  for (const h of MOVED_HOSTS) assert.equal(resolveSiteUrl(`https://${h}/`), PRIMARY_ORIGIN, h);
  assert.equal(resolveSiteUrl("https://whitespaceindia-csr.vercel.app"), PRIMARY_ORIGIN);
});

test("another origin is honoured, without a trailing slash or path", () => {
  assert.equal(resolveSiteUrl("https://whitespaceindia.com/"), "https://whitespaceindia.com");
  assert.equal(resolveSiteUrl("https://whitespaceindia.com/csr"), "https://whitespaceindia.com");
});
