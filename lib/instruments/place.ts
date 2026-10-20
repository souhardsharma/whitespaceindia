/**
 * A Census 2011 district, named for a reader in the present.
 *
 * Every profile here is in the Census 2011 frame, because that is the frame
 * the population data describes. But the States have moved since: Hyderabad
 * is in Telangana, not Andhra Pradesh; Leh is in the Union Territory of Ladakh;
 * Daman is in Dadra and Nagar Haveli and Daman and Diu. A page that heads
 * Hyderabad "Andhra Pradesh" is correct about 2011 and reads as an error in
 * 2026. So the present State is shown, and the 2011 one beside it where they
 * differ - never one silently in place of the other.
 *
 * District boundaries are NOT remapped: a 2011 district's population is the
 * 2011 district's, whatever districts have since been drawn inside it.
 */

/** Census 2011 district code -> the State or UT that holds it today, where
 *  that differs from its 2011 State. */
const PRESENT_STATE: Record<number, string> = {
  // Telangana, constituted 2 June 2014 (Andhra Pradesh Reorganisation Act 2014).
  532: "Telangana", 533: "Telangana", 534: "Telangana", 535: "Telangana",
  536: "Telangana", 537: "Telangana", 538: "Telangana", 539: "Telangana",
  540: "Telangana", 541: "Telangana",
  // Ladakh, a Union Territory from 31 October 2019 (J&K Reorganisation Act 2019).
  3: "Ladakh", 4: "Ladakh",
  // Merged 26 January 2020 (the DNH and DD (Merger of Union Territories) Act 2019).
  494: "Dadra and Nagar Haveli and Daman and Diu",
  495: "Dadra and Nagar Haveli and Daman and Diu",
  496: "Dadra and Nagar Haveli and Daman and Diu",
};

export function presentState(code: number | null | undefined, censusState: string): string {
  if (code != null && PRESENT_STATE[code]) return PRESENT_STATE[code];
  return censusState;
}

/**
 * A place name as a reader writes it. The Census and the register publish
 * names in capitals, sometimes with no space before a bracket, so "SANT RAVI
 * DAS NAGAR(BHADOHI)" becomes "Sant Ravi Das Nagar (Bhadohi)" and a merged
 * UT reads "Dadra and Nagar Haveli and Daman and Diu". Four page-local copies
 * once disagreed: three printed "Leh (ladakh)" and "And Daman And Diu".
 */
const LOWER = new Set(["and", "of"]);

export function titleCase(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/(\S)\(/g, "$1 (")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[a-z]+/g, (word, at: number, all: string) => {
      const prev = all[at - 1];
      const startsWord = at === 0 || /[\s(\-/&]/.test(prev);
      if (!startsWord) return word;
      if (at > 0 && prev === " " && LOWER.has(word)) return word;
      return word[0].toUpperCase() + word.slice(1);
    });
}

/**
 * "Telangana (Andhra Pradesh in Census 2011)" where the two differ, else the
 * State alone. `titleCase` is applied by callers that title-case names.
 */
export function stateLabel(code: number | null | undefined, censusState: string): string {
  const now = presentState(code, censusState);
  return now === censusState ? censusState : `${now} (${censusState} in Census 2011)`;
}
