/**
 * The Scheduled Area determination for a project, over every district it names.
 *
 * WHY THIS EXISTS
 * ---------------
 * A project is a set of places. The register gives a modal district (`dc`) and,
 * where a filing names more than one, the full set (`dall`). Reading the legal
 * determination from `dc` alone meant a project whose primary district is
 * outside every Order, but which also names a district this instrument itself
 * determines is inside one, published "Does not apply" for Gram Sabha consent
 * under RFCTLARR s.41(3) and PESA s.4(i). Measured over the published shards:
 * 224 proposals were in exactly that position.
 *
 * The geometric verdict already works this way - "a project is a set of places
 * and the verdict is satisfied by any one of them" - and the legal verdict has
 * to follow, because consent is owed to the community whose land is taken, not
 * to the district holding the largest share of the site.
 *
 * STRENGTH ORDER. `within` beats `partial` beats `not_determined` beats
 * `outside`. Deliberately asymmetric: it takes one scheduled district to raise
 * the answer, and every named district must be outside before the project can
 * be said to be outside. An unknown district ranks above `outside` for the
 * same reason - not knowing is not the same as knowing there is nothing.
 */
import type { LegalDetermination } from "@/components/instruments/ConsentScreen";

export type DeterminationStatus =
  | "within"
  | "partial"
  | "not_determined"
  | "outside";

/** The published determination, as ConsentScreen already defines it. Reusing
 *  that type rather than declaring a looser one keeps a single description of
 *  the shape - two would drift, and the looser of them would win at the call
 *  site by being assignable to nothing. */
export type Determination = LegalDetermination & {
  scheduledSubdistricts?: number[];
  namedWholly?: string[];
  unmatchedNames?: string[];
};

const STRENGTH: Record<string, number> = {
  within: 4,
  partial: 3,
  not_determined: 2,
  outside: 1,
};

export interface ResolvedDetermination {
  /** The determination that governs, from the strongest district named. */
  governing: Determination | null;
  /** The Census code the governing determination came from. */
  fromDistrict: number | null;
  /** True when the filing names districts whose determinations disagree. */
  mixed: boolean;
  /** Every named district that is within or partly within a Scheduled Area. */
  scheduledDistricts: number[];
}

export interface SiteResolution {
  /** "within" when a named sub-division settles it; otherwise unchanged. */
  status: string;
  /** The Census sub-district codes that settled it, if any. */
  via: number[];
  /** True when the district is partial and nothing settled the site. */
  unsettled: boolean;
}

/**
 * Narrow a `partial` district to a specific site, using the sub-divisions the
 * Order names IN WHOLE.
 *
 * A district named only in part cannot answer for a particular project. Where
 * the Order names a whole tehsil, taluka or block and the filing places the
 * project in it, it can. This is the only thing the 71 transcribed
 * sub-divisions are for, and without it they were published and read by
 * nothing.
 *
 * ONE-WAY. A match raises the answer to `within`. A non-match changes nothing
 * and must never lower it to `outside`: the Order may reach the site through a
 * revenue circle, a panchayat or a named village that the Census sub-district
 * frame does not carry, and 28 of the transcribed names do not resolve to a
 * Census unit at all.
 */
export function resolveSite(
  determination: Determination | null,
  subdistricts: number[] | null | undefined,
): SiteResolution {
  const status = String(determination?.status ?? "");
  if (status !== "partial") {
    return { status, via: [], unsettled: false };
  }
  const named = determination?.scheduledSubdistricts ?? [];
  const site = subdistricts ?? [];
  const via = site.filter((c) => named.includes(c));
  return via.length > 0
    ? { status: "within", via, unsettled: false }
    : { status: "partial", via: [], unsettled: true };
}

export function resolveDetermination(
  determinations: Record<string, Determination> | undefined,
  primary: number | null | undefined,
  all: number[] | null | undefined,
): ResolvedDetermination {
  const empty: ResolvedDetermination = {
    governing: null, fromDistrict: null, mixed: false, scheduledDistricts: [],
  };
  if (!determinations) return empty;

  // `dall` is published only when a filing names more than one district, so
  // the primary has to be folded in explicitly or a single-district project
  // would resolve against nothing.
  const codes = Array.from(
    new Set([...(all ?? []), ...(primary != null ? [primary] : [])]),
  ).filter((c) => c != null);
  if (codes.length === 0) return empty;

  let best: Determination | null = null;
  let bestCode: number | null = null;
  let bestRank = -1;
  const seen = new Set<string>();
  const scheduled: number[] = [];

  for (const code of codes) {
    const d = determinations[String(code)];
    if (!d) continue;
    const status = String(d.status ?? "");
    seen.add(status);
    if (status === "within" || status === "partial") scheduled.push(code);
    const rank = STRENGTH[status] ?? 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = d;
      bestCode = code;
    }
  }

  return {
    governing: best,
    fromDistrict: bestCode,
    mixed: seen.size > 1,
    scheduledDistricts: scheduled.sort((a, b) => a - b),
  };
}

/**
 * The determination the OBLIGATIONS are evaluated against.
 *
 * `resolveSite` settles a partly Scheduled district when the filing names a
 * sub-division the Presidential Order names in whole - the entire reason
 * those 71 sub-divisions were transcribed. That result reached the screen,
 * which told the reader "on the face of the Order, this site is inside the
 * Scheduled Area", and stopped there: the obligation panel below kept
 * evaluating the DISTRICT status and rendered PESA s.4(i) and RFCTLARR
 * s.41(3) as "may apply". Measured over the published register, 1,090
 * proposals showed both statements on one page.
 *
 * It lives here, beside resolveSite, rather than inline in the component,
 * because a rule proved in a test but applied in a component is a rule the
 * test cannot defend - which is how the contradiction survived.
 *
 * Only ever NARROWS: resolveSite returns "within" solely for a partial
 * district the site settles, so this cannot weaken a determination.
 */
export function obligationDetermination<T extends { status: string }>(
  determination: T | null,
  site: SiteResolution,
): T | null {
  if (!determination) return null;
  // ONLY partial. A site resolution settles a district the Order covers in
  // part; it must never promote one the Order does not cover at all, nor a
  // district whose status was never determined. Written as "anything not
  // already within", this would have turned an `outside` district into
  // `within` the moment a caller passed a settled site - which resolveSite
  // cannot produce today, but which nothing in the signature prevented.
  if (site.status !== "within" || determination.status !== "partial") {
    return determination;
  }
  return { ...determination, status: "within" };
}
