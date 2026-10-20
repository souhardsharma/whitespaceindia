/**
 * How a value is described against its benchmark.
 *
 * A sex ratio of 910 against India's 942.6 once read "1.04x below India": a
 * 3.5% shortfall, 32.6 fewer females per 1,000 males, presented as near
 * parity. A multiplier is the wrong form for a ratio that sits near a fixed
 * point. These pin the form that replaced it - a difference in the measure's
 * own units, with the benchmark named - and the rules around it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildFact, compareToBenchmark, formatDifference } from "../facts.ts";
import type { Fact } from "../types.ts";

function fact(unit: Fact["unit"], value: number, benchmark: number, sameDefinition = true): Fact {
  return {
    id: "x",
    value,
    unit,
    kind: unit === "percent" ? "rate" : "ratio",
    label: "x",
    definition: "x",
    formula: "x",
    source: "x",
    vintage: "2011",
    benchmark: { scope: "india", label: "India", value: benchmark, sameDefinition },
  };
}

test("a ratio is compared by difference, never by multiplier", () => {
  const c = compareToBenchmark(fact("ratio", 910, 942.6));
  assert.ok(c);
  assert.equal(c.text, "32.6 below India's 942.6");
  assert.ok(!c.text.includes("×"), "no multiplier in the text");
});

test("a small ratio keeps the precision that shows its gap", () => {
  const c = compareToBenchmark(fact("ratio", 5.2, 4.87));
  assert.ok(c);
  assert.equal(c.text, "0.33 above India's 4.87");
});

test("a rate is still compared in percentage points", () => {
  const c = compareToBenchmark(fact("percent", 40.1, 27.2));
  assert.ok(c);
  assert.equal(c.text, "12.9 points above India");
});

test("a negligible difference reads as level", () => {
  const c = compareToBenchmark(fact("ratio", 942.62, 942.6));
  assert.ok(c);
  assert.equal(c.text, "level with India");
});

test("no comparison is drawn across different definitions", () => {
  assert.equal(compareToBenchmark(fact("ratio", 910, 942.6, false)), null);
});

/** A one-measure registry, with the benchmark's recorded formula as given. */
function registry(benchFormula: string | undefined) {
  return {
    measures: {
      "pop.literacy_rate": {
        label: "Literacy",
        unit: "percent",
        kind: "rate",
        definition: "Literates as a share of population aged 7 and above.",
        formula: "100 * lit / age7plus",
        source: "Census 2011",
        vintage: "2011",
        group: "population",
      },
    },
    groups: { population: "Who lives there" },
    benchmarks: {
      india: { "pop.literacy_rate": 72.98 },
      byState: {},
      ...(benchFormula === undefined
        ? {}
        : { definitions: { "pop.literacy_rate": benchFormula } }),
    },
  } as unknown as Parameters<typeof buildFact>[1];
}

test("a benchmark computed with the value's own formula may be compared", () => {
  const f = buildFact("pop.literacy_rate", registry("100 * lit / age7plus"),
    { "pop.literacy_rate": 64.5 }, { benchmarkScope: "india" });
  assert.equal(f?.benchmark?.sameDefinition, true);
  assert.ok(compareToBenchmark(f!));
});

test("a benchmark computed with a different formula is never compared", () => {
  // The denominator mismatch the plan exists to prevent: literacy over total
  // population rather than population aged 7+.
  const f = buildFact("pop.literacy_rate", registry("100 * lit / total"),
    { "pop.literacy_rate": 64.5 }, { benchmarkScope: "india" });
  assert.equal(f?.benchmark?.sameDefinition, false);
  assert.equal(compareToBenchmark(f!), null);
});

test("a benchmark with no recorded formula fails closed", () => {
  const f = buildFact("pop.literacy_rate", registry(undefined),
    { "pop.literacy_rate": 64.5 }, { benchmarkScope: "india" });
  assert.equal(f?.benchmark?.sameDefinition, false);
  assert.equal(compareToBenchmark(f!), null);
});

test("differences are formatted with Indian grouping", () => {
  assert.equal(formatDifference(12345.67), "12,345.7");
  assert.equal(formatDifference(0.5), "0.50");
});
