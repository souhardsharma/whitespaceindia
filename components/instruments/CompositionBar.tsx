"use client";

/**
 * Part-to-whole: how a district's workers, or a register's filings, divide.
 *
 * A STACKED BAR, HORIZONTAL
 * -------------------------
 * The job is part-to-whole across a handful of named classes, which is a
 * stacked bar; horizontal because the class names are words, not codes, and a
 * vertical stack would either truncate them or turn them on their side.
 *
 * THE SERIES CAP IS REAL
 * ----------------------
 * Categorical hues are assigned in fixed order and never cycled, and past the
 * token ceiling a generated hue is indistinguishable from an existing one. So
 * this folds the tail into "Other" rather than inventing a colour, and says so
 * in the legend instead of quietly dropping it.
 *
 * WHAT IT REFUSES
 * ---------------
 * A segment whose parts do not sum to the whole. If the caller passes parts
 * that add to less than the total, the remainder is drawn explicitly as
 * "unaccounted" rather than silently rescaling the bar to 100% - a stacked bar
 * that always fills its track is a bar that cannot tell you something is
 * missing.
 */

const INK = "#1c1c19";

/**
 * Categorical hues, fixed order, never cycled.
 *
 * These are the first four slots of the validated default order, NOT hues
 * chosen to sit beside the instrument's plum. A hand-picked set was tried
 * first and failed three of the six checks - chroma floor, CVD separation at
 * 5.6 deltaE under deuteranopia, and the normal-vision floor at 12.7 - which
 * is to say two of its four classes were hard to tell apart for readers with
 * ordinary colour vision, never mind without it. These pass all six: worst
 * adjacent pair 9.1 deltaE protan, 22.9 normal.
 *
 * The order IS the safety mechanism, so it never changes, and a fifth class
 * folds into "Other" rather than taking a generated fifth hue - a generated
 * hue is indistinguishable from an existing one under CVD.
 *
 * Two of the four sit below 3:1 against the surface, which obligates visible
 * labels rather than colour alone. The legend below carries every class name
 * and its percentage, which is what discharges it.
 */
export const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
const OTHER = "#8a8577";
const UNACCOUNTED = "#d8d3c8";

export interface Part {
  label: string;
  value: number;
}

interface Props {
  parts: Part[];
  /** The whole these parts are part of. */
  total: number;
  /** What the whole is, for the accessible name: "workers", "proposals". */
  unitLabel: string;
  /** Classes beyond this fold into "Other". Never raise it past four. */
  maxClasses?: number;
  caption?: string;
}

const pct = (n: number, total: number) => (total > 0 ? (n / total) * 100 : 0);
const one = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-IN");

export default function CompositionBar({
  parts,
  total,
  unitLabel,
  maxClasses = CATEGORICAL.length,
  caption,
}: Props) {
  const usable = parts.filter((p) => Number.isFinite(p.value) && p.value > 0);
  if (total <= 0 || usable.length === 0) {
    return (
      <p className="font-body text-[13px] opacity-75">
        No composition is recorded for this place.
      </p>
    );
  }

  const sorted = [...usable].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, maxClasses);
  const tail = sorted.slice(maxClasses);
  const tailSum = tail.reduce((s, p) => s + p.value, 0);

  const segments = [
    ...head.map((p, i) => ({ ...p, color: CATEGORICAL[i] })),
    ...(tailSum > 0
      ? [{ label: `Other (${tail.length})`, value: tailSum, color: OTHER }]
      : []),
  ];

  const accounted = segments.reduce((s, p) => s + p.value, 0);
  const remainder = Math.max(0, total - accounted);
  if (remainder > 0) {
    segments.push({
      label: "Not accounted for",
      value: remainder,
      color: UNACCOUNTED,
    });
  }

  const label =
    `${whole.format(total)} ${unitLabel}: ` +
    segments
      .map((s) => `${s.label} ${one.format(pct(s.value, total))}%`)
      .join(", ");

  return (
    <div className="mb-5">
      {/* role="img" wraps ONLY the marks. It prunes its subtree from the
          accessibility tree, so the legend and the caption below - which are
          the whole explanation of what the segments mean - would reach nobody
          if they sat inside it. */}
      <div role="img" aria-label={label} className="flex h-4 w-full">
        {segments.map((s, i) => (
          <div
            key={s.label}
            style={{
              width: `${pct(s.value, total)}%`,
              background: s.color,
              // A 2px surface gap, so adjacent segments read as separate
              // classes rather than one continuous fill.
              marginRight: i < segments.length - 1 ? 2 : 0,
            }}
          />
        ))}
      </div>

      {/* A legend is always present for two or more classes, so identity is
          never carried by colour alone. */}
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block w-3 h-3 shrink-0"
              style={{ background: s.color }}
            />
            <span className="font-body text-[12px] opacity-75">
              {s.label}{" "}
              <span className="tabular-nums">
                {one.format(pct(s.value, total))}%
              </span>
            </span>
          </li>
        ))}
      </ul>

      {caption ? (
        <p className="font-body text-[12px] leading-relaxed opacity-70 mt-2">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
