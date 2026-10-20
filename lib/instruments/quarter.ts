/**
 * Which quarter a moment falls in, IST.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * It used to live inside FilingTimeline, a client component, and the test
 * that pins its behaviour reimplemented it - a copy of the same nine lines,
 * with a comment explaining that importing was awkward. The copy passed while
 * the real function was wrong: removing the IST shift from the component left
 * every one of those assertions green, because they were asserting about the
 * copy. A test that cannot fail when the shipped code breaks is not a test.
 *
 * THE RULE IT ENCODES
 * -------------------
 * `fon` arrives as a bare date the build has already converted to IST, so
 * reading it with UTC methods is exact and shifting it again would move a
 * 1 January filing into the previous year.
 *
 * `readAt` does NOT: it is a full UTC timestamp. The register is read at
 * 07:00 IST, which is 01:30 UTC the same day - but a read after 18:30 UTC on
 * the last day of a quarter is already the next quarter in India. Taking that
 * quarter in UTC would hatch the PREVIOUS, complete quarter and leave the
 * incomplete one solid: the marker that exists to stop a reader misreading a
 * partial column would be pointing at the wrong column.
 */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function quarterOf(iso: string, isTimestamp = false): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const t = isTimestamp ? new Date(d.getTime() + IST_OFFSET_MS) : d;
  return `${t.getUTCFullYear()}-Q${Math.floor(t.getUTCMonth() / 3) + 1}`;
}
