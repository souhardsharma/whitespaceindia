/**
 * The fact layer.
 *
 * Rule 1: no number reaches the interface as prose. Every figure is built here
 * from a value plus its measure definition, so it always arrives carrying its
 * source and vintage.
 *
 * Rule 2: a benchmark comparison renders only when it was computed from the
 * SAME measure id, and therefore the same definition and denominator, as the
 * value it judges. buildFact() is the only place that sets `sameDefinition`,
 * and FactValue refuses to draw a comparison when it is false. That makes the
 * denominator-mismatch class of error impossible to introduce from a component,
 * rather than something a reviewer has to catch.
 */

import type {
  DistrictRecord,
  Fact,
  Measure,
  MeasureRegistry,
  SubdistrictRecord,
} from "./types";

export type Scope = "india" | "state";

/**
 * Join one value to its definition.
 *
 * `benchmarkScope` is a request, not a guarantee. If the registry has no
 * benchmark for this exact measure id, no benchmark is attached and the caller
 * simply renders the value alone.
 */
export function buildFact(
  id: string,
  registry: MeasureRegistry,
  values: Record<string, number | null>,
  opts: { benchmarkScope?: Scope; stateName?: string } = {}
): Fact | null {
  const measure: Measure | undefined = registry.measures[id];
  if (!measure || measure.internal) return null;

  const fact: Fact = {
    id,
    value: values[id] ?? null,
    unit: measure.unit,
    kind: measure.kind,
    label: measure.label,
    definition: measure.definition,
    formula: measure.formula,
    source: measure.source,
    vintage: measure.vintage,
    caveats: measure.caveats,
  };

  const { benchmarkScope, stateName } = opts;
  if (!benchmarkScope) return fact;

  // Only rates and ratios are comparable across places. Benchmarking an
  // absolute count against a national total produces arithmetic that is
  // technically correct and semantically empty - "559x below India" for a
  // district's population says nothing except that India is large.
  if (measure.kind === "count") return fact;

  let benchValue: number | null | undefined;
  let label: string;
  if (benchmarkScope === "state" && stateName) {
    benchValue = registry.benchmarks.byState?.[stateName]?.[id];
    label = titleCase(stateName);
  } else {
    benchValue = registry.benchmarks.india?.[id];
    label = "India";
  }

  if (benchValue === null || benchValue === undefined) return fact;

  // The benchmark was produced by the pipeline from the same measure id, over
  // summed inputs rather than by averaging district rates. Averaging a set of
  // rates gives a different and wrong answer because each has its own
  // denominator.
  //
  // `sameDefinition` is a comparison, not an assumption: the pipeline records
  // the formula it computed each benchmark with, and the flag is true only
  // when that is the value's own formula, character for character. It was
  // once hard-coded true, which made both guards downstream unreachable. A
  // registry without recorded formulas yields false, and no comparison is
  // drawn - failing closed, as the rule requires.
  const benchFormula = registry.benchmarks.definitions?.[id];
  fact.benchmark = {
    scope: benchmarkScope,
    label,
    value: benchValue,
    sameDefinition: benchFormula !== undefined && benchFormula === measure.formula,
  };

  // How much of the country (or the state) the benchmark actually covers.
  // Attached only when it is not all of it: a coverage note on every figure
  // would be noise, and one on the single figure it applies to is the point.
  const rep = registry.benchmarks.districtsReporting;
  if (rep) {
    const total =
      benchmarkScope === "state" && stateName
        ? Math.max(
            0,
            ...Object.values(rep.byState?.[stateName] ?? { _: 0 }),
          )
        : rep.districtsTotal;
    const covered =
      benchmarkScope === "state" && stateName
        ? rep.byState?.[stateName]?.[id]
        : rep.india?.[id];
    if (
      typeof covered === "number" &&
      typeof total === "number" &&
      total > 0 &&
      covered < total
    ) {
      fact.benchmark.coverage = { districts: covered, total };
    }
  }
  return fact;
}

/** Build every public measure in a group, in registry order. */
export function factsForGroup(
  group: string,
  registry: MeasureRegistry,
  values: Record<string, number | null>,
  opts: { benchmarkScope?: Scope; stateName?: string } = {}
): Fact[] {
  return Object.entries(registry.measures)
    .filter(([, m]) => m.group === group && !m.internal)
    .map(([id]) => buildFact(id, registry, values, opts))
    .filter((f): f is Fact => f !== null);
}

// ── Formatting ────────────────────────────────────────────────────────────
// Indian digit grouping throughout; this is an Indian dataset read by Indian
// users, and 1,20,83,77,599 is the correct rendering, not 1,208,377,599.

const intFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const oneDp = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const twoDp = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * A ratio, or a difference between two ratios, at a precision that shows the
 * gap. Sex ratios sit near 950, so one decimal carries it; household sizes
 * sit near 5 and differ in hundredths, so they need two.
 */
export function formatDifference(value: number): string {
  return Math.abs(value) >= 10 ? oneDp.format(value) : twoDp.format(value);
}

export function formatValue(value: number | null, unit: Fact["unit"]): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (unit) {
    case "percent":
      return `${oneDp.format(value)}%`;
    case "count":
      return intFmt.format(value);
    case "hectare":
      return `${value >= 100 ? intFmt.format(value) : twoDp.format(value)} ha`;
    case "inr":
      return `₹${intFmt.format(value)}`;
    case "ratio":
      return value >= 100 ? intFmt.format(value) : twoDp.format(value);
    default:
      return String(value);
  }
}

/**
 * How a value sits against its benchmark.
 *
 * Deliberately returns direction and magnitude only. It does not say whether
 * that is good or bad, because this instrument does not rank or score - a high
 * tribal population share is not a "worse" district, it is a district where a
 * different legal regime may apply.
 */
export function compareToBenchmark(fact: Fact): {
  delta: number;
  ratio: number;
  direction: "above" | "below" | "level";
  text: string;
} | null {
  if (!fact.benchmark || fact.value === null) return null;
  // Enforced here as well as in the component: two places to fail closed.
  if (!fact.benchmark.sameDefinition) return null;
  const { value } = fact;
  const b = fact.benchmark.value;
  if (b === 0) return null;

  const delta = value - b;
  const ratio = value / b;
  const direction = Math.abs(delta) < 0.05 ? "level" : delta > 0 ? "above" : "below";

  // The gap is stated as a DIFFERENCE, in the measure's own units, never as a
  // multiplier. A multiplier reads a ratio's shortfall as near-parity: a sex
  // ratio of 910 against India's 942.6 is 3.5% short and 32.6 fewer females
  // per 1,000 males, and "1.04x below India" says neither. Only rates and
  // ratios reach this point (buildFact attaches no benchmark to a count), and
  // for both the difference is the quantity a reader can check.
  let text: string;
  if (direction === "level") {
    text = `level with ${fact.benchmark.label}`;
  } else if (fact.unit === "percent") {
    text = `${oneDp.format(Math.abs(delta))} points ${direction} ${fact.benchmark.label}`;
  } else {
    text = `${formatDifference(Math.abs(delta))} ${direction} ${
      fact.benchmark.label
    }'s ${formatDifference(b)}`;
  }
  return { delta, ratio, direction, text };
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** A district or sub-district record, whichever the profile is showing. */
export type PlaceRecord = DistrictRecord | SubdistrictRecord;

export function placeName(place: PlaceRecord): string {
  if ("district_name" in place && "censuscode" in place) {
    return titleCase(place.district_name);
  }
  const sd = place as SubdistrictRecord;
  return titleCase(sd.name || sd.district_name || "Unknown");
}

export function placeStateName(place: PlaceRecord): string {
  return titleCase(place.state_name || "");
}
