"use client";

/**
 * How long clearance takes, as a distribution rather than an average.
 *
 * WHY PERCENTILES AND NOT A MEAN
 * ------------------------------
 * Time to decision is heavily right-skewed: a median of 135 days sits under a
 * maximum of 986. A mean would be dragged well above the typical case by a
 * tail of long-running proposals and would describe no proposal at all. The
 * published figures are p10, p25, median, p75, p90 - so this draws exactly
 * those, and never computes a statistic the data does not carry.
 *
 * THE FORM
 * --------
 * A box plot, horizontal: a track from p10 to p90, a filled span from p25 to
 * p75 where half the proposals sit, and a hard tick at the median. It is the
 * one form that answers "how long, typically, and how much does it vary" in a
 * single mark, and it does not pretend to a resolution the five published
 * numbers do not have.
 *
 * SMALL GROUPS ARE NOT DRAWN
 * --------------------------
 * The build publishes nothing for a group below `minGroup`, and this refuses
 * to draw one either. A median over eleven proposals looks exactly like a
 * median over eleven thousand once it is a mark on a track, and the reader has
 * no way to tell them apart - so the count travels with every row.
 */

import { RAMP } from "@/lib/instruments/choropleth";

const INK = "#1c1c19";

export interface Distribution {
  n: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max?: number;
}

interface Props {
  rows: { label: string; d: Distribution }[];
  /** Longest p90 across the rows, so every track shares one scale. */
  scaleMax?: number;
  /** Groups smaller than this are not drawn. */
  minGroup?: number;
  unitLabel?: string;
}

const nf = new Intl.NumberFormat("en-IN");

export default function DurationDistribution({
  rows,
  scaleMax,
  minGroup = 30,
  unitLabel = "days",
}: Props) {
  const drawable = rows.filter((r) => r.d && r.d.n >= minGroup);
  if (drawable.length === 0) {
    return (
      <p className="font-body text-[13px] opacity-75">
        No group here reaches {minGroup} decided proposals, which is the floor
        below which a distribution is not published.
      </p>
    );
  }

  // ONE scale across every row. Per-row scales would make a 60-day median and
  // a 600-day median draw identical marks in the same column.
  const ceiling =
    scaleMax ?? Math.max(...drawable.map((r) => r.d.p90 ?? r.d.median)) * 1.05;
  const pct = (v: number) => Math.max(0, Math.min(100, (v / ceiling) * 100));

  return (
    <div>
      <ul className="space-y-3">
        {drawable.map(({ label, d }) => {
          const aria =
            `${label}: median ${d.median} ${unitLabel}, ` +
            `half of ${nf.format(d.n)} proposals between ${d.p25} and ${d.p75}, ` +
            `middle 80% between ${d.p10} and ${d.p90} ${unitLabel} — one in ` +
            `ten is faster, one in ten slower, and the slowest are not shown`;
          return (
            <li key={label} role="img" aria-label={aria}>
              <div className="flex items-baseline justify-between gap-4 mb-1">
                <span className="font-body text-[13px] leading-snug">
                  {label}
                </span>
                <span className="font-label text-[12px] tabular-nums shrink-0">
                  <strong>{d.median}</strong>
                  <span className="opacity-70"> {unitLabel}</span>
                  <span className="opacity-65"> · n {nf.format(d.n)}</span>
                </span>
              </div>
              <div className="relative h-[14px]">
                {/* p10 to p90: the range most of the register falls in. */}
                <div
                  className="absolute top-[6px] h-[2px]"
                  style={{
                    left: `${pct(d.p10)}%`,
                    // Clamped, like the box below it. A negative width is
                    // silently dropped by the renderer, so a group whose
                    // percentiles arrived out of order would lose its range
                    // line and read as having no spread at all.
                    width: `${Math.max(pct(d.p90) - pct(d.p10), 0)}%`,
                    background: "rgba(28,28,25,0.35)",
                  }}
                />
                {/* p25 to p75: where half of them sit. */}
                <div
                  className="absolute top-[1px] h-[12px]"
                  style={{
                    left: `${pct(d.p25)}%`,
                    width: `${Math.max(pct(d.p75) - pct(d.p25), 0.6)}%`,
                    background: RAMP[1],
                  }}
                />
                {/* The median, 2px, in ink - a reference, not a series. */}
                <div
                  className="absolute -top-[1px] h-[16px] w-[2px]"
                  style={{ left: `calc(${pct(d.median)}% - 1px)`, background: INK }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-6 h-[12px]"
            style={{ background: RAMP[1] }}
          />
          <span className="font-body text-[12px] opacity-70">
            Middle half (p25&ndash;p75)
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-6 h-[2px]"
            style={{ background: "rgba(28,28,25,0.35)" }}
          />
          <span className="font-body text-[12px] opacity-70">
            p10&ndash;p90 &mdash; the middle 80%, so one in ten is faster and
            one in ten is slower
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-[2px] h-[14px]"
            style={{ background: INK }}
          />
          <span className="font-body text-[12px] opacity-70">Median</span>
        </span>
        <span className="font-body text-[12px] opacity-70 tabular-nums">
          scale 0&ndash;{Math.round(ceiling)} {unitLabel}
        </span>
      </div>
    </div>
  );
}
