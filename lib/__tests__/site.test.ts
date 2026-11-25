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

// Vercel's redirect matching, as far as these rules use it: a `has` host regex
// over the whole host, then a source written as an anchored regular
// expression whose groups fill $1.. in the destination. Named parameters
// ("/:path*") are NOT modelled, and the test below refuses them: production
// once ran "/:path*", which matches neither "/" nor a path ending in "/", so
// the parent host's home page served the stub's text with a 200 and every
// trailing-slash address answered 404 (found live 2026-11-25), while an
// earlier version of this function, which assumed it matched, passed.
function redirectFor(host: string, path: string): string | null {
  for (const rule of vercel.redirects) {
    const cond = rule.has?.[0];
    if (cond && !new RegExp(`^(?:${cond.value})$`).test(host)) continue;
    const m = new RegExp(`^${rule.source}$`).exec(path);
    if (!m) continue;
    assert.equal(rule.permanent, true, "a moved host answers 308, which carries the old URL's standing");
    return rule.destination.replace(/\$(\d)/g, (_: string, i: string) => m[Number(i)] ?? "");
  }
  return null;
}

test("Vercel redirect sources are plain regular expressions, never named parameters", () => {
  for (const rule of vercel.redirects) {
    assert.doesNotMatch(rule.source, /:/, `${rule.source}: a named parameter does not match "/" or a trailing slash`);
    assert.doesNotMatch(rule.destination.replace(/^https:\/\//, ""), /:/, rule.destination);
  }
});

test("every path on every Vercel host is redirected, the root and trailing slashes included", () => {
  for (const host of ["whitespaceindia.vercel.app", ...LEGACY_CSR_HOSTS]) {
    for (const path of ["/", "/a", "/a/", "/a/b/c", "/a/b/c/", "/instruments/consent/123"]) {
      const to = redirectFor(host, path);
      assert.ok(to, `${host}${path} would be served by Vercel, not redirected`);
      assert.equal(new URL(to).origin, PRIMARY_ORIGIN);
    }
  }
});

// Search Console verifies a property by fetching this file from the host with a
// 200. Redirected with everything else, the two Vercel properties lost their
// verification, and without it a Change of Address to the live site cannot be
// filed. It is the only path Vercel serves itself.
const VERIFY_FILE = "googlec2c59ca60c194f86.html";

test("the Search Console verification file is served on Vercel, not redirected", () => {
  for (const host of ["whitespaceindia.vercel.app", "whitespaceindia-csr.vercel.app"]) {
    assert.equal(redirectFor(host, `/${VERIFY_FILE}`), null, `${host} must serve /${VERIFY_FILE}`);
    assert.ok(redirectFor(host, `/${VERIFY_FILE}x`), "only that exact name escapes the redirect");
    assert.ok(redirectFor(host, `/a/${VERIFY_FILE}`));
  }
  assert.match(vercel.buildCommand, new RegExp(`cp public/${VERIFY_FILE.replace(".", "\\.")} vercel-redirect-only/`));
  assert.equal(readFileSync(new URL(`../../public/${VERIFY_FILE}`, import.meta.url), "utf8").trim(), `google-site-verification: ${VERIFY_FILE}`);
});

test("a trailing slash is dropped in the same hop, as the live site would drop it", () => {
  assert.equal(redirectFor("whitespaceindia.vercel.app", "/csr-spending/maharashtra/"), `${PRIMARY_ORIGIN}/csr-spending/maharashtra`);
  assert.equal(redirectFor("whitespaceindia-csr.vercel.app", "/about/"), `${PRIMARY_ORIGIN}/about`);
});

test("Vercel builds nothing that can run: no framework, no install, no functions", () => {
  assert.equal(vercel.framework, null, "a framework build brings back the functions that paused the team");
  assert.equal(vercel.installCommand, "");
  for (const key of ["functions", "rewrites", "crons", "routes"]) {
    assert.equal(vercel[key], undefined, `${key} would give Vercel something to run`);
  }
});

// Every branch pushed to the repository used to deploy, and probe branches
// push dozens a day: on Hobby that is a daily deployment cap spent on pages
// nobody visits. Vercel deploys a branch when ANY matching rule is true, so
// "**" (minimatch: every branch, slashes included) false plus main true is
// main alone.
test("Vercel deploys main and no other branch", () => {
  const rules = vercel.git?.deploymentEnabled;
  assert.equal(typeof rules, "object", "without git.deploymentEnabled every branch push deploys");
  assert.equal(rules.main, true, "main must deploy: it carries the redirects");
  assert.equal(rules["**"], false, "every other branch is off");
  const on = Object.keys(rules).filter((k) => rules[k] === true);
  assert.deepEqual(on, ["main"], "a second true rule would let other branches deploy");
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
