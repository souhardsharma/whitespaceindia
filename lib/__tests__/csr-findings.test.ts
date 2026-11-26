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

/**
 * Counts the data holds were typed into the pages and drifted: /reports said 44
 * whitespace districts and /about served 44 while the data held 47, and every
 * layout said 651 districts after the index came to score all of NITI Aayog's.
 * The pages read them from meta.json (lib/csr/findings.ts) and type none.
 */
test("no CSR page types a count or share the data holds", () => {
  const files = [
    "app/layout.tsx", "app/page.tsx",
    "app/csr/layout.tsx", "app/csr/page.tsx",
    "app/about/layout.tsx", "app/about/page.tsx",
    "app/methodology/layout.tsx", "app/methodology/page.tsx",
    "app/reports/page.tsx",
    "app/csr-spending/page.tsx", "app/csr-spending/[state]/page.tsx", "app/csr-spending/whitespace-districts/page.tsx",
    "components/Hero.tsx", "components/CsrSpendingPage.tsx", "lib/csr/config.ts",
  ];
  const typed = [
    /\b(651|653|707)\b(?!\s*px)/, // district counts
    /\b(44|47|62)\s+whitespace/i, // whitespace counts
    /\b60\.\d%/, // the Pan India share
    /1,29,\d{3}/, // the Pan India total
    /\?\?\s*(651|653|44|20|55)\b/, // typed fallbacks
  ];
  for (const file of files) {
    const src = read(file);
    for (const re of typed) assert.doesNotMatch(src, re, `${file} types a figure (${re})`);
  }
});

test("the whitespace cut-offs are published to the precision the pages print", () => {
  const meta = JSON.parse(read("public/data/csr/meta.json"));
  const rows = JSON.parse(read("public/data/csr/whitespace_master.json")) as {
    district_csr_per_person: number; headcount_ratio_2021: number; is_whitespace: boolean; csr_recorded: boolean;
  }[];
  const { csr_p25, hr_p75_pct } = meta.whitespace_thresholds;
  const selected = rows.filter(
    (r) => r.district_csr_per_person <= csr_p25 && r.headcount_ratio_2021 * 100 >= hr_p75_pct,
  ).length;
  assert.equal(selected, meta.whitespace_count);
  assert.equal(rows.filter((r) => r.is_whitespace).length, meta.whitespace_count);
  assert.equal(rows.filter((r) => r.csr_recorded === false).length, meta.csr_not_recorded_count);
});

test("every district in NITI Aayog's index is scored and the population adds up to the Census", () => {
  const meta = JSON.parse(read("public/data/csr/meta.json"));
  assert.equal(meta.total_districts, meta.mpi_districts);
  assert.equal(meta.population_invariants.ok, true);
  assert.equal(meta.population_invariants.pipeline_national_total, meta.population_invariants.census_2011_national_reference);
});
