/**
 * The canonical origin: one host, which a stale environment value naming the
 * legacy CSR host cannot move back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIMARY_ORIGIN, resolveSiteUrl } from "../site.ts";

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
