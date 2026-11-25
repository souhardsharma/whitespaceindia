/**
 * What a filing's own evidence says about where a project is - worded once.
 *
 * An application form makes three separate statements of place: the place
 * codes on its plots (village, town, sub-district), the district it declares,
 * and the coordinates of its site. The pipeline reconciles them (see
 * scripts/instruments/location.py, adjudicate()) and publishes all three:
 * `district` (where the profile is placed), `declaredDistrict`, and
 * `site.fallsIn` with its verdict.
 *
 * This module turns those into the sentence a reader sees. It exists because
 * the sentence used to be a constant - "That is the location as filed with
 * the clearance application, not an inference" - printed even on a page whose
 * own title said "District: Mumbai City" while the profile described Mumbai
 * Suburban and the coordinates, drawn beside it, fell in Mumbai. A statement
 * about evidence has to be computed from the evidence.
 *
 * Three rules it keeps, each learned from a false sentence it once produced:
 *   - A statement cannot corroborate itself. A location placed FROM the
 *     declared district is not "agreed with" by the declared district; one
 *     placed by the coordinates is not confirmed by them.
 *   - `boundary` is not agreement. The coordinates lie on the district's
 *     edge, where they can confirm nothing; the pipeline counts it as
 *     undecidable and so does this.
 *   - Silence is named for what it is: no coordinates, coordinates at sea,
 *     coordinates on ground the boundary source does not map.
 *
 * The screen, the PDF export and the server-rendered page all call this, so
 * the three cannot word the same location differently.
 */

import type { ResolutionMethod } from "./types";

export interface LocationEvidenceInput {
  resolution: ResolutionMethod | string;
  district: number | null;
  allDistricts?: number[] | null;
  declaredDistrict: number | null;
  villageCount: number | null;
  verdict: string | null;
  fallsIn: number | null;
}

export interface LocationEvidence {
  /** Sentences, in reading order. */
  sentences: string[];
  /** The three statements of place disagree with no two in agreement. */
  contested: boolean;
  /** Whether the location may be stated without qualification. */
  firm: boolean;
}

type Names = Record<string, string>;

function nm(names: Names, code: number | null): string {
  if (code == null) return "an unnamed district";
  return names[String(code)] ?? `district ${code}`;
}

/**
 * What the coordinates say about THE PROFILED DISTRICT, as a clause.
 *
 * The pipeline's verdict is tested against every district the filing names:
 * `inside` means a block falls in one of them, not necessarily in the one
 * this profile describes. Read as agreement with the profile's district, it
 * told 533 pages that the coordinates "agree with that placement" while they
 * fell in another named district (2026-11-17; 1243990978 is placed in
 * Malkangiri with its only block in Koraput). Agreement is therefore `fallsIn`
 * equal to the profiled district; a block in another named district is said
 * to be exactly that.
 */
function coordinateClause(
  verdict: string | null,
  fallsIn: number | null,
  names: Names,
  here: string,
  district: number,
  multi: boolean,
): { text: string; agrees: boolean | null } {
  switch (verdict) {
    case "inside":
      if (fallsIn != null && fallsIn !== district) {
        return {
          text: `The coordinates of its site fall in ${nm(names, fallsIn)}, another district this filing names, not in ${here}.`,
          agrees: false,
        };
      }
      if (fallsIn == null && multi) {
        // Inside one of the named districts, but which one is not recorded.
        return {
          text: "The coordinates of its site fall inside one of the districts this filing names, but which one is not recorded.",
          agrees: null,
        };
      }
      return { text: `The coordinates of its site fall inside ${here}.`, agrees: true };
    case "boundary":
      return {
        text: multi
          ? "The coordinates of its site lie on the boundary of a district this filing names, so they neither confirm nor contradict the placement."
          : `The coordinates of its site lie on the boundary of ${here}, so they neither confirm nor contradict it.`,
        agrees: null,
      };
    case "elsewhere":
      return {
        text: `The coordinates of its site fall in ${nm(names, fallsIn)} instead.`,
        agrees: false,
      };
    case "offshore":
      return {
        text: "The coordinates of its site fall outside every district boundary, at sea, so they cannot be checked against the district.",
        agrees: null,
      };
    case "unmapped":
      return {
        text: "The coordinates of its site fall in an area the Census 2011 district map assigns to no district, such as the part of Jammu and Kashmir it marks as data not available, so they cannot be checked against the district.",
        agrees: null,
      };
    default:
      return { text: "The filing records no site coordinates to check it against.", agrees: null };
  }
}

export function locationEvidence(
  p: LocationEvidenceInput,
  names: Names,
): LocationEvidence {
  if (p.district == null) {
    return {
      sentences: [
        "Nothing in this filing identifies a place smaller than its state, so no district profile is shown.",
      ],
      contested: false,
      firm: false,
    };
  }

  const here = nm(names, p.district);
  const named = new Set<number>([p.district, ...(p.allDistricts ?? [])]);
  const declared = p.declaredDistrict;
  const coords = coordinateClause(p.verdict, p.fallsIn, names, here, p.district, named.size > 1);
  const out: string[] = [];

  switch (p.resolution) {
    case "adjudicated":
      // Two kinds of adjudication (location.py adjudicate()): the codes point
      // only elsewhere and the filing is moved to the one district the other
      // two agree on; or the codes name several districts, this one among
      // them, and the other two settle which. Only the first is "another".
      out.push(
        named.size > 1
          ? `The place codes on the application form name ${named.size} districts. The district the form declares and the coordinates of its site both place the project in ${here}, one of them, and because two of the filing's three statements of place agree, this profile follows them.`
          : `The place codes on the application form point to another district, but the district the form declares and the coordinates of its site both place the project in ${here}. Because two of the filing's three statements of place agree, this profile follows them.`,
      );
      return { sentences: out, contested: false, firm: true };

    case "project_name":
      out.push(
        "The district comes from the wording of the project's title. That is weaker evidence than a location filed on the form, so the placement is indicative only.",
      );
      return { sentences: out, contested: false, firm: false };

    case "town_settled": {
      // The code named a town spanning several districts, so it chose nothing.
      out.push(
        "The form names a town that spans more than one district, which does not by itself say which district the site is in.",
      );
      const byCoords = p.fallsIn != null && p.fallsIn === p.district &&
        (p.verdict === "inside" || p.verdict === "boundary");
      const byDeclared = declared != null && declared === p.district;
      if (byCoords && byDeclared) {
        out.push(`The coordinates of its site and the district the form declares both place it in ${here}.`);
        return { sentences: out, contested: false, firm: true };
      }
      if (byCoords) {
        out.push(
          `The coordinates of its site place it in ${here}` +
            (declared != null
              ? `; the district the form declares, ${nm(names, declared)}, does not agree.`
              : "; the form declares no district that can be compared."),
        );
        return { sentences: out, contested: declared != null, firm: declared == null };
      }
      if (byDeclared) {
        out.push(`The district the form declares places it in ${here}. ${coords.text}`);
        return { sentences: out, contested: coords.agrees === false, firm: coords.agrees !== false };
      }
      out.push(
        `Neither the coordinates nor the declared district settles which of those districts the site is in, so this profile uses ${here} provisionally.`,
      );
      return { sentences: out, contested: false, firm: false };
    }

    case "tie_settled": {
      // The codes name the same number of places in several districts, so
      // they choose none of them (location.py _settle_tie). The coordinates
      // chose, else the declaration, else the first by Census code.
      out.push(
        "Two or more of the districts the place codes on the application form name share the largest number of places, so the codes do not say which district the site is mainly in.",
      );
      const byCoords = p.fallsIn != null && p.fallsIn === p.district &&
        (p.verdict === "inside" || p.verdict === "boundary");
      const byDeclared = declared != null && declared === p.district;
      if (byCoords) {
        out.push(
          `The coordinates of its site fall in ${here}, so this profile describes ${here}` +
            (byDeclared ? ", which is also the district the form declares." : "."),
        );
        return { sentences: out, contested: false, firm: true };
      }
      if (byDeclared) {
        out.push(`The form declares ${here}, so this profile describes ${here}. ${coords.text}`);
        return { sentences: out, contested: false, firm: coords.agrees !== false };
      }
      out.push(
        `Neither the coordinates of its site nor the district the form declares settles which of them it is, so this profile describes ${here}, the first of them by Census code, provisionally. ${coords.text}`,
      );
      return { sentences: out, contested: false, firm: false };
    }

    case "lgd_district": {
      // The declaration IS the placement here; it cannot also corroborate it.
      out.push("The district comes from the one declared on the application form, which names no village or sub-district.");
      out.push(coords.text);
      if (coords.agrees === false) {
        out.push("That leaves one statement against one, and nothing in the filing settles the difference, so the location is uncertain.");
      }
      return { sentences: out, contested: false, firm: coords.agrees !== false };
    }

    case "village": {
      const n = p.villageCount ?? 0;
      out.push(
        n > 0
          ? `The district comes from the ${n === 1 ? "village or town" : `${n} villages or towns`} named on the application form.`
          : "The district comes from the village and town codes on the application form.",
      );
      break;
    }
    case "subdistrict":
      out.push("The district comes from the sub-district named on the application form.");
      break;
    default:
      out.push("How this location was established is not recorded.");
      return { sentences: out, contested: false, firm: false };
  }

  // Placed from the codes: the declaration and the coordinates are the two
  // independent checks on them.
  // Agreement is with the district THIS profile describes. A declaration of
  // another district the codes also name is not agreement with this one; it
  // used to be counted as such, and the page then said "both agree".
  const declaredHere = declared != null && declared === p.district;
  const declaredNamed = declared != null && named.has(declared);
  const contested =
    p.verdict === "elsewhere" &&
    declared != null &&
    !declaredNamed &&
    p.fallsIn != null &&
    declared !== p.fallsIn;
  if (contested) {
    out.push(
      `The filing contradicts itself. Its place codes point to ${here}, it declares ${nm(names, declared)}, and its site coordinates fall in ${nm(names, p.fallsIn)}. Because no two of the three agree, this profile keeps the most specific of them, the place codes, and the location is uncertain.`,
    );
    return { sentences: out, contested: true, firm: false };
  }

  const decl =
    declared == null
      ? "The form declares no district to compare."
      : declaredHere
        ? `The form also declares ${here}.`
        : declaredNamed
          ? `The district the form declares, ${nm(names, declared)}, is another district this filing names, not ${here}.`
          : `The district the form declares, ${nm(names, declared)}, does not agree.`;

  if (declaredHere && coords.agrees === true) {
    out.push("The district the form declares and the coordinates of its site both agree with that placement.");
    return { sentences: out, contested: false, firm: true };
  }
  if (declaredHere && coords.agrees === false) {
    const where =
      p.fallsIn != null && named.has(p.fallsIn)
        ? `${nm(names, p.fallsIn)}, another district this filing names,`
        : nm(names, p.fallsIn);
    out.push(
      `The form also declares ${here}. The coordinates of its site fall in ${where} instead, and with two statements against one, this profile keeps the district the codes and the declaration agree on.`,
    );
    return { sentences: out, contested: false, firm: true };
  }
  out.push(decl, coords.text);
  // Firm only if something independent agrees and nothing contradicts.
  const anyAgrees = declaredHere || coords.agrees === true;
  const anyDisagrees = (declared != null && !declaredHere) || coords.agrees === false;
  return { sentences: out, contested: false, firm: anyAgrees && !anyDisagrees };
}

/**
 * Which of a multi-district filing's districts the profile describes, as a
 * noun phrase, worded from how the location was established.
 *
 * Both the profile and the findings said "the one where it names the most
 * places" for every multi-district filing. That is how the codes choose
 * (village and sub-district routes), and false wherever something else chose:
 * an adjudication follows the declared district and the coordinates, and a
 * town code is settled by them, whatever the codes' count says.
 */
export function profiledDistrictPhrase(resolution: ResolutionMethod | string): string {
  switch (resolution) {
    case "village":
    case "subdistrict":
      return "the district where it names the most places";
    case "adjudicated":
      return "the district its declared district and site coordinates agree on";
    case "tie_settled":
      return "one of the districts where it names the most places, chosen as set out above";
    default:
      return "the district it is placed in, as set out above";
  }
}
