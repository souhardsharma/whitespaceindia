/**
 * Run: node --test lib/__tests__/wake.test.ts
 *
 * What the search does when the backend is asleep. The proxy's side of this
 * is in cloudflare-proxy.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BackendAsleep, wakeLink, wakeOrigin } from "../instruments/wake.ts";

const RENDER = "https://whitespaceindia-backend.onrender.com";
const asleep = (headers: Record<string, string> = { "x-backend-wake": RENDER }) =>
  new Response("asleep", { status: 503, headers });

test("a 503 that names the backend's address is a sleeping backend", () => {
  assert.equal(wakeOrigin(asleep()), RENDER);
});

test("any other failure is not: no address, another status, or an address that is not a bare https origin", () => {
  assert.equal(wakeOrigin(asleep({})), null);
  assert.equal(wakeOrigin(new Response("{}", { status: 500, headers: { "x-backend-wake": RENDER } })), null);
  assert.equal(wakeOrigin(new Response("{}", { status: 200, headers: { "x-backend-wake": RENDER } })), null);
  for (const bad of ["http://insecure.example", "javascript:alert(1)", `${RENDER}/path`, `${RENDER}?x=1`, "//x.example"]) {
    assert.equal(wakeOrigin(asleep({ "x-backend-wake": bad })), null, bad);
  }
});

test("the link is the same page on the backend, which sends the reader back to it", () => {
  assert.equal(
    wakeLink(RENDER, { pathname: "/instruments/consent", search: "?q=coal" }),
    `${RENDER}/instruments/consent?q=coal`,
  );
  assert.equal(new BackendAsleep(RENDER).origin, RENDER);
});

test("every part of a page that asks the backend offers the link when it sleeps", () => {
  for (const name of ["Watchlist", "DistrictProposals", "ExportButton"]) {
    const src = readFileSync(new URL(`../../components/instruments/${name}.tsx`, import.meta.url), "utf8");
    assert.match(src, /wakeOrigin\(\w+\)/, name);
    assert.match(src, /wakeLink\(/, name);
    assert.match(src, /<WakeNote /, name);
    assert.doesNotMatch(src, /onrender\.com/, name);
  }
});

test("a district whose news could not be read is never reported as having nothing new", () => {
  const src = readFileSync(new URL("../../components/instruments/Watchlist.tsx", import.meta.url), "utf8");
  // The old code turned every failure into a count of 0, which renders "nothing new".
  assert.doesNotMatch(src, /\{ total: 0 \}/);
  assert.doesNotMatch(src, /\[c, 0\] as const/);
  assert.match(src, /n === null \?/);
});

test("the search offers the link, and types no backend address of its own", () => {
  const src = readFileSync(new URL("../../components/instruments/ProjectSearch.tsx", import.meta.url), "utf8");
  assert.match(src, /wakeOrigin\(res\)/);
  assert.match(src, /wakeLink\(/);
  assert.doesNotMatch(src, /onrender\.com/);
});
