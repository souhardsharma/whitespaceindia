/**
 * The origin check on the CSR forms: the site's own pages pass on any domain
 * the project answers on, and nothing else does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedOrigin } from "../request-identity.ts";

function post(origin: string | null, host: string): Request {
  const headers = new Headers({ host });
  if (origin) headers.set("origin", origin);
  return new Request(`https://${host}/api/subscribe`, { method: "POST", headers });
}

test("a page served by this host may post to it, on any alias", () => {
  assert.equal(isAllowedOrigin(post("https://csr.whitespaceindia.com", "csr.whitespaceindia.com")), true);
});

test("another site's origin is refused, including other vercel.app projects", () => {
  assert.equal(isAllowedOrigin(post("https://evil.vercel.app", "whitespaceindia-csr.vercel.app")), false);
});

test("a POST with no Origin is refused", () => {
  assert.equal(isAllowedOrigin(post(null, "whitespaceindia-csr.vercel.app")), false);
});
