"use client";

/**
 * Filings over time, by quarter.
 *
 * WHY COLUMNS AND NOT A LINE
 * --------------------------
 * A count per quarter is a magnitude per discrete period, not a continuous
 * quantity sampled over time. A line would draw a slope between two quarters
 * and invite the reader to read a value off it that does not exist - there is
 * no such thing as the filing count halfway through March.
 *
 * BOTH EDGES OF THIS SERIES ARE ARTEFACTS, AND BOTH ARE MARKED
 * ------------------------------------------------------------
 * The RIGHT edge is an artefact of when we looked. The register is live and
 * this copy of it was read on a date; the quarter that date falls in holds
 * however many filings had happened by then, not however many the quarter will
 * end with. Drawn solid, every recent series appears to fall off a cliff.
 *
 * The LEFT edge is an artefact of what we have read, and it is the larger of
 * the two. Dates come from `fon`, the first step in the appraisal history, and
 * a proposal only has one once the process-history backfill has reached it.
 * That backfill runs newest-first, so the gap is not spread evenly over time -
 * it is almost entirely in the past. Measured over the register: 0% of 2022
 * filings carry a dated first step, 8.4% of 2023, 98.7% of 2024, ~100% after.
 * Drawn without a marker this series shows filings exploding from near zero in
 * 2023, which is a picture of our own reading order and not of the register.
 *
 * So coverage is measured per quarter against `registeredOn` - the register's
 * own submission date, which every row carries - and any quarter under
 * `coverageFloor` is hatched and counted in the note, the same treatment the
 * incomplete final quarter gets. A column that cannot be trusted looks
 * different from one that can, at both ends.
 *
 * WHY NOT JUST DRAW `registeredOn` INSTEAD
 * ----------------------------------------
 * Because it is a different fact. `dateOfSubmission` is the LATEST submission
 * and moves forward on re-submission; it disagrees with the first filing for a
 * third of the register, by up to eight months. It is the right denominator
 * for asking "how much of this period are we missing" and the wrong numerator
 * for "when was this filed", so it is used here for exactly the first and
 * never for the second.
 */

import { useMemo, useState } from "react";
import { RAMP } from "@/lib/instruments/choropleth";
import { quarterOf } from "@/lib/instruments/quarter";
import { gapSkewsOlder } from "@/lib/instruments/gap";

const INK = "#1c1c19";
const H = 130;

export interface Filing {
  /** ISO date of the first recorded filing, from the appraisal history. */
  filedOn: string | null;
  /**
   * The register's own submission date. Full coverage, and used ONLY to
   * measure how much of each quarter is missing from the drawn series.
   */
  registeredOn?: string | null;
}

interface Props {
  filings: Filing[];
  /** ISO timestamp the register was last read, from freshness.json. */
  readAt?: string | null;
  /** Below this share of a quarter's proposals dated, the column is hatched. */
  coverageFloor?: number;
  caption?: string;
}

const nf = new Intl.NumberFormat("en-IN");

export default function FilingTimeline({
  filings,
  readAt,
  coverageFloor = 0.9,
  caption,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);

  // Whether THIS district's undated rows really do sit earlier than its dated
  // ones. The consequence clause below - that the early series undercounts -
  // follows from the gap being in the past, and in six districts it is not.
  const olderGap = useMemo(() => gapSkewsOlder(filings), [filings]);

  const { bars, max, incompleteKey, undated, thin } = useMemo(() => {
    const counts = new Map<string, number>();
    // Coverage is measured on the register's own date, which every row has.
    const cov = new Map<string, { dated: number; all: number }>();
    let missing = 0;

    for (const f of filings) {
      if (f.registeredOn) {
        const rq = quarterOf(f.registeredOn);
        if (rq) {
          const c = cov.get(rq) ?? { dated: 0, all: 0 };
          c.all += 1;
          if (f.filedOn) c.dated += 1;
          cov.set(rq, c);
        }
      }
      if (!f.filedOn) {
        missing += 1;
        continue;
      }
      const q = quarterOf(f.filedOn);
      if (q) counts.set(q, (counts.get(q) ?? 0) + 1);
    }

    const keys = Array.from(counts.keys()).sort();
    // Every quarter between the first and last, so a quarter with no filings
    // is a gap in the series and not a missing column the eye closes up.
    const filled: { key: string; n: number }[] = [];
    if (keys.length > 0) {
      const [fy, fq] = keys[0].split("-Q").map(Number);
      const [ly, lq] = keys[keys.length - 1].split("-Q").map(Number);
      for (let y = fy, q = fq; y < ly || (y === ly && q <= lq); ) {
        const k = `${y}-Q${q}`;
        filled.push({ key: k, n: counts.get(k) ?? 0 });
        q += 1;
        if (q > 4) {
          q = 1;
          y += 1;
        }
      }
    }

    // Quarters the backfill has not finished. Only meaningful where the
    // register actually places proposals in that quarter.
    const under = new Set<string>();
    // Array.from, not `for...of` over the Map directly: the build target does
    // not downlevel Map iteration and tsc rejects it.
    for (const [q, c] of Array.from(cov.entries())) {
      if (c.all === 0) continue;
      if (c.dated / c.all < coverageFloor) under.add(q);
    }

    return {
      bars: filled,
      max: Math.max(1, ...filled.map((b) => b.n)),
      incompleteKey: readAt ? quarterOf(readAt, true) : null,
      undated: missing,
      thin: under,
    };
  }, [filings, readAt, coverageFloor]);

  const total = filings.length;

  if (bars.length === 0) {
    return (
      <p className="font-body text-[13px] leading-relaxed opacity-75">
        {total > 0
          ? `This instrument does not yet hold a dated first filing for any ` +
            `of the ${nf.format(total)} proposals here, so there is no series ` +
            `to draw. That is a gap in what this instrument holds, not ` +
            `evidence that nothing was filed.`
          : "There are no proposals here to draw."}
      </p>
    );
  }

  const drawn = bars.reduce((s, b) => s + b.n, 0);
  const label =
    `${nf.format(drawn)} of ${nf.format(total)} filings placed across ` +
    `${bars.length} quarters, ${bars[0].key} to ${bars[bars.length - 1].key}` +
    (undated > 0
      ? `. This instrument does not yet hold a filing date for ` +
        `${nf.format(undated)} more, mostly older ones, so they are not in ` +
        `this series`
      : "") +
    ". " +
    bars
      .map(
        (b) =>
          `${b.key}: ${b.n}` +
          (thin.has(b.key) ? " (incomplete, few filing dates held yet)" : "") +
          (b.key === incompleteKey ? " (quarter incomplete)" : ""),
      )
      .join(", ");

  const marked = (key: string) => thin.has(key) || key === incompleteKey;

  // Counted over the columns actually DRAWN, not over every under-read quarter
  // the register knows about. A quarter can be under-read and still contribute
  // no column - nothing we have a date for landed in it - and saying "6
  // quarters" above three hatched marks asks the reader to find three that are
  // not there. The sentence describes the picture.
  //
  // A percentage is deliberately NOT quoted here. Coverage is measured over
  // the proposals the REGISTER dates to a quarter, while a column is keyed on
  // the quarter its FIRST FILING falls in, and those are different sets - a
  // column can stand at a quarter whose register-dated coverage is 0%, which
  // reads as a contradiction rather than a warning. The denominator that is
  // exactly right for this district is stated in full above: N of M.
  const thinShown = bars.filter((b) => thin.has(b.key));

  return (
    <div className="mb-5">
      <div role="group" aria-label={label}>
        <svg
          width="100%"
          viewBox={`0 0 ${Math.max(bars.length * 14, 100)} ${H}`}
          preserveAspectRatio="none"
          style={{ display: "block", height: H }}
        >
          <defs>
            <pattern
              id="partial-quarter"
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="5" height="5" fill="#e8e4dd" />
              <line x1="0" y1="0" x2="0" y2="5" stroke="#b9b2a6" strokeWidth="1.3" />
            </pattern>
          </defs>
          {bars.map((b, i) => {
            const h = (b.n / max) * (H - 18);
            return (
              <g key={b.key}>
                <rect
                  x={i * 14}
                  y={H - h - 14}
                  width={12}
                  height={Math.max(h, b.n > 0 ? 1.5 : 0)}
                  fill={marked(b.key) ? "url(#partial-quarter)" : RAMP[3]}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
                {/* A hit target larger than the mark, and reachable without a
                    pointer: the per-quarter count appeared nowhere else, so on
                    hover alone it did not exist for a keyboard or a screen
                    reader. Focusable, labelled, and it updates the same
                    readout the mouse does. */}
                <rect
                  x={i * 14}
                  y={0}
                  width={12}
                  height={H}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={
                    `${b.key}: ${b.n} filing${b.n === 1 ? "" : "s"}` +
                    (thin.has(b.key)
                      ? ", incomplete, few filing dates held yet"
                      : "") +
                    (b.key === incompleteKey ? ", quarter incomplete" : "")
                  }
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
          <line x1="0" y1={H - 14} x2="100%" y2={H - 14} stroke={INK} strokeWidth="1" />
        </svg>
      </div>

      <div className="flex justify-between mt-1">
        <span className="font-body text-[11px] opacity-70 tabular-nums">
          {bars[0].key}
        </span>
        <span className="font-body text-[12px] opacity-80 tabular-nums">
          {hover !== null
            ? `${bars[hover].key}: ${bars[hover].n} filing${
                bars[hover].n === 1 ? "" : "s"
              }${thin.has(bars[hover].key) ? " (incomplete)" : ""}${
                bars[hover].key === incompleteKey ? " (quarter incomplete)" : ""
              }`
            : ""}
        </span>
        <span className="font-body text-[11px] opacity-70 tabular-nums">
          {bars[bars.length - 1].key}
        </span>
      </div>

      {/* The denominator, always. A reader given a series and no total cannot
          tell a complete picture from a fifth of one. */}
      <p className="font-body text-[12px] leading-relaxed opacity-75 mt-2">
        {undated > 0 ? (
          <>
            Drawn from {nf.format(drawn)} of the {nf.format(total)} proposals
            here. This instrument does not yet hold a dated first filing for the
            other {nf.format(undated)}, so they are not on this timeline.{" "}
            {olderGap ? (
              <>
                They are overwhelmingly older proposals, which means the early
                part of this series counts far fewer than were actually filed
                then.{" "}
              </>
            ) : null}
            The missing dates are a gap in what this instrument holds, not
            evidence that the register lacks them.
          </>
        ) : (
          <>
            Drawn from all {nf.format(total)} proposals here, every one of which
            records a dated first filing.
          </>
        )}
      </p>

      {thin.size > 0 || (incompleteKey && bars.some((b) => b.key === incompleteKey)) ? (
        <p className="font-body text-[12px] leading-relaxed opacity-75 mt-1">
          Hatched columns are not comparable with solid ones.{" "}
          {thinShown.length > 0 ? (
            <>
              {thinShown.length === 1
                ? "One of them covers a period"
                : `${thinShown.length} of them cover periods`}{" "}
              for which this instrument holds few filing dates yet, so{" "}
              {thinShown.length === 1 ? "it counts" : "they count"} only the
              proposals it has one for and under-counts the rest.{" "}
            </>
          ) : null}
          {incompleteKey && bars.some((b) => b.key === incompleteKey)
            ? `${incompleteKey} was still running when the register was read, so it holds the filings made by that date and not the quarter's total.`
            : ""}
        </p>
      ) : null}

      {caption ? (
        <p className="font-body text-[12px] leading-relaxed opacity-70 mt-1">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
