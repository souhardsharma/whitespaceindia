/**
 * The CSR findings cards quote per-person spending. Typed into the page, the
 * figure drifted from the data (₹1,436 against meta.json's ₹1,446.93), so it
 * is read from meta.json and no card may type a rupee figure for it again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("the per-person comparison is not typed into the page or the config", () => {
  for (const file of ["app/csr/page.tsx", "lib/csr/config.ts"]) {
    const src = read(file);
    assert.doesNotMatch(src, /receives ₹\d/, `${file} types Bihar's figure`);
    assert.doesNotMatch(src, /against ₹\d/, `${file} types Maharashtra's figure`);
    assert.match(src, /BIHAR_VS_MAHARASHTRA/, `${file} must quote the figure from lib/csr/findings.ts`);
  }
});

test("the helper reads both States from meta.json", () => {
  const src = read("lib/csr/findings.ts");
  assert.match(src, /state_stats\.bihar\.csr_per_person_inr/);
  assert.match(src, /state_stats\.maharashtra\.csr_per_person_inr/);
  const meta = JSON.parse(read("public/data/csr/meta.json"));
  assert.equal(typeof meta.state_stats.bihar.csr_per_person_inr, "number");
  assert.equal(typeof meta.state_stats.maharashtra.csr_per_person_inr, "number");
});
