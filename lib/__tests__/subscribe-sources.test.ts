/**
 * Every subscribe form a page carries names a source the API accepts. The
 * Health, Energy and Education forms once sent sources /api/subscribe did not
 * know, and every sign-up from them was answered "the form could not be read".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_FORM_ID_LANDING,
  DEFAULT_FORM_ID_REPORTS,
  kitFormId,
  parseSource,
} from "../subscribe-sources.ts";

function pages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return pages(p);
    return e.name === "page.tsx" ? [p] : [];
  });
}

test("every page's subscribe form names a source the API accepts", () => {
  const used = pages("app").flatMap((file) =>
    [...fs.readFileSync(file, "utf8").matchAll(/<SubscribeForm[^>]*\ssource="([^"]+)"/g)].map((m) => ({ file, source: m[1] })),
  );
  assert.ok(used.length >= 5, `found only ${used.length} forms`);
  for (const { file, source } of used) assert.equal(parseSource(source), source, `${file}: ${source}`);
});

test("the reports form joins the reports list and every other form the landing list", () => {
  assert.equal(kitFormId("reports", {}), DEFAULT_FORM_ID_REPORTS);
  for (const s of ["landing", "health", "energy", "education"] as const) {
    assert.equal(kitFormId(s, {}), DEFAULT_FORM_ID_LANDING);
  }
  assert.equal(kitFormId("health", { KIT_FORM_ID_LANDING: "7", KIT_FORM_ID: "8" }), "7");
  assert.equal(kitFormId("reports", { KIT_FORM_ID_LANDING: "7", KIT_FORM_ID: "8" }), "8");
});

test("anything else is refused", () => {
  for (const v of ["csr", "", "Reports", null, undefined, 3, ["reports"]]) assert.equal(parseSource(v), null);
});
