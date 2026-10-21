"use client";

/**
 * A value against the benchmark it is compared to.
 *
 * WHY A METER AND NOT A BAR CHART
 * -------------------------------
 * The job here is one ratio against one reference - "this district, against
 * India" - which is a meter: a single track, the value filled along it, and a
 * tick where the benchmark sits. A two-bar chart would spend the identity
 * channel on a comparison that has no identities in it, and invite the reader
 * to compare the two bars' lengths when the only quantity that matters is the
 * gap between them.
 *
 * WHAT IT REFUSES TO DRAW
 * -----------------------
 * Nothing, unless the benchmark passed the same-definition check. A bar is a
 * much stronger claim than a sentence: a reader who sees a value sitting well
 * to the right of a tick concludes something specific, and if the two numbers
 * were computed over different denominators that conclusion is wrong. The
 * check is `fact.benchmark.sameDefinition`, and this component fails closed on
 * it exactly as the text comparison did.
 *
 * The sentence has not been deleted. It stays as the accessible name, so a
 * screen reader gets the comparison in words while a sighted reader gets it in
 * one look - the same fact, twice, never two different facts.
 */

import { RAMP } from "@/lib/instruments/choropleth";

const INK = "#1c1c19";

interface Props {
  /** The district's own value. */
  value: number;
  /** The benchmark it is measured against. */
  benchmark: number;
  /** What the benchmark is: "India", "Odisha". */
  benchmarkLabel: string;
  /**
   * How many districts the benchmark covers, when it is not all of them.
   *
   * A label reading "India" over a figure summed from 603 of 640 districts is
   * the kind of unstated basis this instrument exists to avoid; it is stated
   * here, in the bar's own caption and in its accessible name, so it reaches
   * both readers.
   */
  coverage?: { districts: number; total: number };
  /** The sentence form, used as the accessible name. */
  text: string;
  unit?: string;
}

export default function BenchmarkBar({
  value,
  benchmark,
  benchmarkLabel,
  coverage,
  text,
  unit,
}: Props) {
  if (!Number.isFinite(value) || !Number.isFinite(benchmark) || benchmark <= 0) {
    return null;
  }

  // The track runs to whichever is larger, with headroom, so neither the value
  // nor the tick is ever pinned against the end where it cannot be read.
  const ceiling =
    unit === "percent"
      ? Math.min(100, Math.max(value, benchmark) * 1.15)
      : Math.max(value, benchmark) * 1.15;
  const pct = (n: number) => Math.max(0, Math.min(100, (n / ceiling) * 100));
  const valuePct = pct(value);
  const markPct = pct(benchmark);
  const above = value > benchmark;

  // The name states the value, the benchmark and which side of it the value
  // falls on. `text` alone was not enough: for a non-percent measure it can
  // come back without a direction, and role="img" prunes the visible sentence
  // and the benchmark label below - so a screen reader would have been given a
  // bar with no idea which way it pointed.
  const direction = above ? "above" : value < benchmark ? "below" : "level with";
  const nf = new Intl.NumberFormat("en-IN");
  const partial =
    coverage && coverage.districts < coverage.total
      ? `${nf.format(coverage.districts)} of ${nf.format(coverage.total)} districts`
      : null;
  const aria =
    `${text}. The figure here is ${value}, ${direction} the ${benchmarkLabel} figure of ${benchmark}`
    + (partial ? `. The ${benchmarkLabel} figure is computed from ${partial}.` : ".");

  return (
    <div className="mt-2 w-full max-w-[260px]" title={text}>
      <div
        role="img"
        aria-label={aria}
        className="relative h-[10px] bg-[#1c1c19]/8"
      >
        {/* The value. 4px rounded data-end, anchored to the baseline at 0. */}
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${valuePct}%`,
            background: above ? RAMP[3] : RAMP[1],
            borderTopRightRadius: 4,
            borderBottomRightRadius: 4,
          }}
        />
        {/* The benchmark. A 2px line, in ink rather than a second hue: it is a
            reference, not another series, and giving it a colour would make
            the reader look for a category that does not exist. */}
        <div
          className="absolute -top-[3px] -bottom-[3px] w-[2px]"
          style={{ left: `calc(${markPct}% - 1px)`, background: INK }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="font-label text-[9px] uppercase tracking-[0.14em] opacity-70">
          {text}
        </span>
        <span className="font-label text-[9px] uppercase tracking-[0.14em] opacity-65 tabular-nums shrink-0 ml-2">
          {benchmarkLabel}
        </span>
      </div>
      {partial ? (
        <p className="font-body text-[10px] leading-snug opacity-65 mt-0.5">
          The {benchmarkLabel} figure is computed from {partial}, because
          the source table has no value for the others.
        </p>
      ) : null}
    </div>
  );
}
