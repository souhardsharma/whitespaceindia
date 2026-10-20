/**
 * How old each source is, said the same way everywhere.
 *
 * Two statements about age used to be written into the pages by hand, and
 * both went wrong in the same way.
 *
 * The Census's age was typed as a word ("fourteen years ago") on one page
 * and calculated on another. The typed one was right for one year and wrong
 * for every year after.
 *
 * A source that updates was labelled "Live register" in four places, with no
 * date behind it. That asserted currency however old the copy was. It also
 * called the application form and the appraisal history a "register", which
 * they are not.
 *
 * Both rules live here now. Every surface reads its label from this module,
 * so the pages cannot disagree with each other or drift out of date.
 *
 * This module is pure (no file imports), so the test suite can exercise it
 * directly.
 */

/** The Census year every socio-economic figure describes. */
export const CENSUS_YEAR = 2011;

/**
 * Where the NEXT census stands, worded for the day the page is read.
 *
 * Census 2027 is conducted in two phases: houselisting, April to September
 * 2026, and the population count, February 2027 (Office of the Registrar
 * General and Census Commissioner; PIB, 2025-26). The sentence depends on the
 * date, so it is computed here rather than typed into a page, where it would
 * go wrong the month the count begins. Its figures are not published by any
 * date this function can know, so it never says they are.
 */
export const NEXT_CENSUS = { year: 2027, countMonth: "2027-02" } as const;

export function nextCensusNote(now: Date = new Date()): string {
  const ym = now.toISOString().slice(0, 7);
  if (ym < NEXT_CENSUS.countMonth) {
    return `Census ${NEXT_CENSUS.year} is under way, with its population count scheduled for February ${NEXT_CENSUS.year}, and none of its figures are published yet.`;
  }
  if (ym === NEXT_CENSUS.countMonth) {
    return `Census ${NEXT_CENSUS.year}'s population count is taking place this month; none of its figures are published yet.`;
  }
  return `Census ${NEXT_CENSUS.year}'s population count took place in February ${NEXT_CENSUS.year}; this instrument will use its figures once they are published at sub-district level.`;
}

/** Whole years since the Census, counted from the reader's current year. */
export function censusAge(now: Date = new Date()): number {
  return now.getUTCFullYear() - CENSUS_YEAR;
}

/**
 * The month and year the register's earliest submission falls in, from
 * `meta.register_span`. It is the limit that makes a search for an older
 * proposal find nothing, so it is stated from the data rather than typed as
 * a year that would go stale when the source's history grows. Returns null
 * when no span is published; a caller then says nothing rather than guessing.
 */
export function registerStart(
  span: { earliest?: string } | null | undefined,
): string | null {
  const iso = span?.earliest;
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** The register itself, whose read time is the one the sync records. */
export const REGISTER_SOURCE = "PARIVESH environmental clearance register";

type Source = { name: string; vintage: string; fetched?: string };

/**
 * A calendar date in IST. PARIVESH is an Indian government source, and its
 * readers should not have to convert. Returns null for a missing or
 * unparseable timestamp, never a wrong date.
 */
export function readDateIST(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

/**
 * The line that says how current a source is.
 *
 * A source that updates carries the date this copy of it was read. For the
 * register, that is the sync's own read time (`registerReadAt`, from
 * freshness.json), the same instant the footer states. The fetch stamp is
 * the fallback only, so the two never disagree. A fixed source carries the
 * year its data was collected.
 */
export function sourceVintageLabel(source: Source, registerReadAt?: string | null): string {
  if (source.vintage !== "live") return `Collected ${source.vintage}`;
  const at =
    source.name === REGISTER_SOURCE
      ? readDateIST(registerReadAt) ?? readDateIST(source.fetched)
      : readDateIST(source.fetched);
  // No date is itself a fact about this copy. Stating it keeps the reader
  // from mistaking an unknown read time for a current one.
  return at ? `Updating source · read ${at}` : "Updating source · read time unavailable";
}
