/**
 * Where a district's missing filing dates actually sit in time.
 *
 * WHY THIS IS A FUNCTION AND NOT A SENTENCE
 * -----------------------------------------
 * The timeline tells a reader that the proposals it could not date "are
 * overwhelmingly older proposals, which means the early part of this series
 * counts far fewer than were actually filed then". That is a claim about a
 * specific district's undated cohort, and it was printed for every district
 * with a gap without looking at one of them.
 *
 * It is true of the register as a whole - the process-history backfill runs
 * newest-first, so 0% of 2022 filings carry a dated first step against ~100%
 * after 2024 - and, measured on the page's own basis (a proposal belongs to a
 * district when `dc` equals it or `dall` contains it), it is true in 541 of
 * the 542 districts holding both cohorts. In one, census code 638, it is not:
 * a single undated proposal whose register year matches the dated ones beside
 * it. Telling a reader that one 2025 proposal is "overwhelmingly older", and
 * that it makes the early series undercount, is a statement the data does not
 * support - in the one part of this page whose whole job is to say honestly
 * what is missing. No district has a gap that skews NEWER.
 *
 * One district is a small prize for a function and a test. The point is that
 * the sentence was published 542 times on the strength of a register-wide
 * average, and nothing in the page could tell whether it was true of the
 * district a reader was actually looking at.
 *
 * Every row carries `registeredOn` - the register's own submission date, which
 * has full coverage - whether or not its appraisal history has been read. So
 * the claim is checkable from the same array the chart is drawn from, and the
 * page makes it only where it holds.
 */

export interface GapRow {
  /** Null when this instrument holds no dated first filing for the row. */
  filedOn: string | null;
  /** The register's own submission date. Present for effectively every row. */
  registeredOn?: string | null;
}

function year(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.length < 4) return null;
  const n = Number(value.slice(0, 4));
  return Number.isInteger(n) ? n : null;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * True when the undated rows really do sit earlier than the dated ones.
 *
 * Median, not mean: these are year counts with a long tail at the old end, and
 * one 2009 filing should not license the claim for a cohort that is otherwise
 * contemporary.
 *
 * Returns false when it cannot tell - no undated rows, no dated rows, or no
 * usable register dates. False is the safe answer in every one of those cases,
 * because it withholds a characterisation rather than inventing one.
 */
export function gapSkewsOlder(rows: GapRow[]): boolean {
  const undated: number[] = [];
  const dated: number[] = [];
  for (const row of rows) {
    const y = year(row.registeredOn);
    if (y === null) continue;
    (row.filedOn ? dated : undated).push(y);
  }
  if (undated.length === 0 || dated.length === 0) return false;
  return median(undated) < median(dated);
}
