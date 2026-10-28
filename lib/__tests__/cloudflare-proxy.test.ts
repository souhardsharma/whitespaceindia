/**
 * The Cloudflare Pages proxy (scripts/cloudflare/proxy.mjs) in front of the
 * Node backend: the rate limits key on the caller Cloudflare saw, never on a
 * header the caller typed, and only the proxy holds the backend's key.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { backendRequest } from "../../scripts/cloudflare/proxy.mjs";
import { clientIp } from "../request-identity.ts";

const env = { BACKEND_ORIGIN: "https://backend.example", BACKEND_KEY: "k3y" };

function incoming(headers: Record<string, string>): Request {
  return new Request("https://whitespaceindia.pages.dev/api/instruments/consent/search?q=coal", { headers });
}

test("the backend sees the address Cloudflare connected from", () => {
  const out = backendRequest(incoming({ "cf-connecting-ip": "203.0.113.7" }), env);
  assert.equal(clientIp(out), "203.0.113.7");
});

test("address headers a caller sends are dropped, not passed on", () => {
  const out = backendRequest(
    incoming({
      "cf-connecting-ip": "203.0.113.7",
      "x-real-ip": "1.1.1.1",
      "x-vercel-forwarded-for": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3",
    }),
    env,
  );
  assert.equal(out.headers.get("x-vercel-forwarded-for"), null);
  assert.equal(out.headers.get("x-forwarded-for"), null);
  assert.equal(clientIp(out), "203.0.113.7");
});

test("the key is the proxy's own, whatever the caller sent", () => {
  const out = backendRequest(incoming({ "x-backend-key": "guess" }), env);
  assert.equal(out.headers.get("x-backend-key"), "k3y");
});

test("path and query reach the backend unchanged", () => {
  const out = backendRequest(incoming({}), env);
  assert.equal(out.url, "https://backend.example/api/instruments/consent/search?q=coal");
});
