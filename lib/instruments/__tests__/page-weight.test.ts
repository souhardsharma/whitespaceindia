/**
 * What every proposal page carries is kept to what differs between proposals.
 *
 * A proposal page is rendered on demand, so each distinct one a crawler asks
 * for is a miss at the origin and its bytes count as Fast Origin Transfer. The
 * measure registry (73 KB, identical for every proposal) rode along as a prop
 * of the client component: in the HTML and again in every navigation payload,
 * 64% of the payload and 37% of the page. It now ships once, in the route's
 * cached script. This fails if a registry-sized constant goes back into the
 * bundle the server assembles.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync("lib/instruments/server.ts", "utf8");
const profile = readFileSync("components/instruments/ProjectProfile.tsx", "utf8");

test("the bundle the server assembles carries no measure registry", () => {
  const shape = server.slice(server.indexOf("export interface ProposalBundle"));
  const body = shape.slice(0, shape.indexOf("\n}\n"));
  assert.ok(body.includes("project: Project"), "ProposalBundle was not found; is the pattern stale?");
  assert.doesNotMatch(body, /\bregistry\b/);
});

test("the profile reads the registry from the published file, not from its props", () => {
  assert.match(
    profile,
    /import measuresFile from "@\/public\/data\/instruments\/consent\/measures\.json";/,
  );
  const unpacked = profile.match(/const \{([^}]*)\} = bundle;/);
  assert.ok(unpacked, "the profile no longer unpacks the bundle; is the pattern stale?");
  assert.doesNotMatch(unpacked[1], /\bregistry\b/);
});
