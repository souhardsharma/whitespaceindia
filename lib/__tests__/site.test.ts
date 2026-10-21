/**
 * The canonical origin: one host, which a stale environment value naming the
 * legacy CSR host cannot move back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRIMARY_ORIGIN, LEGACY_CSR_HOSTS, resolveSiteUrl } from "../site.ts";

test("the middleware runs on every legacy host and on no other", () => {
  // The matcher's host pattern is a literal Next reads at build time; a host
  // added to LEGACY_CSR_HOSTS but not here would never be redirected.
  const src = readFileSync(new URL("../../middleware.ts", import.meta.url), "utf8");
  const m = /type: "host", value: "([^"]+)"/.exec(src);
  assert.ok(m, "middleware.ts has a host condition");
  const host = new RegExp(`^(?:${m[1].replace(/\\\\/g, "\\")})$`);
  for (const h of LEGACY_CSR_HOSTS) assert.ok(host.test(h), `${h} is matched`);
  assert.ok(!host.test(new URL(PRIMARY_ORIGIN).hostname), "the primary origin is not");
});

test("no configured URL means the primary origin", () => {
  assert.equal(resolveSiteUrl(undefined), PRIMARY_ORIGIN);
  assert.equal(resolveSiteUrl(""), PRIMARY_ORIGIN);
});

test("a configured legacy host still resolves to the primary origin", () => {
  assert.equal(resolveSiteUrl("https://whitespaceindia-csr.vercel.app"), PRIMARY_ORIGIN);
  assert.equal(resolveSiteUrl("https://csr.whitespaceindia.com/"), PRIMARY_ORIGIN);
});

test("another origin is honoured, without a trailing slash or path", () => {
  assert.equal(resolveSiteUrl("https://whitespaceindia.com/"), "https://whitespaceindia.com");
  assert.equal(resolveSiteUrl("https://whitespaceindia.com/csr"), "https://whitespaceindia.com");
});
