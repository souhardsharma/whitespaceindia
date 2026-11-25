/**
 * The other clearances a project needs, and how its land is held - worded
 * once, for the screen and the PDF alike.
 *
 * Everything here is the proponent's declaration on the environmental
 * clearance form (shard column `lk`), plus - for a forest proposal the form
 * names - the forest register's own record of it. An unread form (null) and a
 * form that declares nothing (0) are different silences and are worded
 * differently; see `lk` in the shard contract.
 */
import type { LinkedClearances } from "./types";

export interface ForestRegisterEntry {
  status: string;
  area: number | null;
  form: string | null;
  date: string | null;
  /** When the forest register was last read (ISO), so its status is dated. */
  readAt?: string | null;
}

/**
 * The forest proposal numbers in the form's free-typed field, normalised -
 * the same rule as fp_numbers() in build_data.py, which keys the published
 * forest register by it. A proponent types "FP/OR/ROAD/ 451983/2023" or two
 * numbers with a comma; matched exactly, half of them were never found.
 */
export function fpNumbers(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const part of text.toUpperCase().split(/[,;&]|\bAND\b/)) {
    const no = part.replace(/\s+/g, "");
    if (/^FP\/[A-Z0-9/._-]+$/.test(no) && !out.includes(no)) out.push(no);
  }
  return out;
}

const TOPIC_NAMES: Record<string, string> = {
  f: "forest clearance",
  w: "the wildlife board",
  e: "an eco-sensitive zone",
  p: "a protected area",
  c: "the coastal regulation zone",
};

function listWords(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function istDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric",
    timeZone: "Asia/Kolkata" });
}

export interface LinkLine {
  label: string;
  text: string;
  /** A consequence for the obligations, worded as a pointer, never a verdict. */
  note?: string;
}

const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export const LINKS_UNREAD =
  "We have not yet read this proposal's application form for its other clearances, so this page cannot yet say whether the project needs any.";

export const LINKS_NONE =
  "The form answers each question about other clearances and declares none of them. By its own account the project diverts no forest land, needs no recommendation from the National Board for Wildlife, and lies outside any eco-sensitive zone, protected area or coastal regulation zone. It gives no detail of how the land is held.";

export const LINKS_BLANK =
  "The form has been read, but it leaves every question about other clearances unanswered. Those questions cover forest clearance, the National Board for Wildlife, eco-sensitive zones, protected areas and the coastal regulation zone, and with the answers blank this page cannot say whether any of them applies.";


/**
 * What the form says about forest land, from its two statements of it: the
 * existing forest land in its table of land use (shard column `forest`) and
 * its answers on other clearances (`lk`).
 *
 *   proposal   it says forest clearance is needed (`lk.f`)
 *   sought     only the land breakup's additional forest land (`lk.a`)
 *   table      the table records forest land and the forest question was left
 *              blank, or the answers have not been read
 *   disagrees  the table records forest land, but the form answers the forest
 *              question and declares none, or its tenure table lists only
 *              non-forest land
 *   none       neither statement declares forest land
 *
 * `disagrees` is the form's own contradiction, and it is not resolved here:
 * 181 published forms record forest land in the table and answer every
 * clearance question with "no" (119067873 records 3.449 of forest land, 0 of
 * non-forest land, and "no" to forest clearance). The page names both
 * statements and says they disagree.
 */
export type ForestReading = "proposal" | "sought" | "table" | "disagrees" | "none";

export function forestReading(
  forestHa: number | null | undefined,
  links: LinkedClearances | 0 | null | undefined,
): ForestReading {
  if (links && links.f) return "proposal";
  const sought = Boolean(links && (links.a ?? 0) > 0);
  if (!((forestHa ?? 0) > 0)) return sought ? "sought" : "none";
  if (links == null) return "table";
  if (links === 0) return "disagrees";
  if (!sought && !(links.u ?? "").includes("f")) return "disagrees";
  if (tenureListsNoForest(links.t)) return "disagrees";
  return "table";
}

function tenureListsNoForest(t: LinkedClearances["t"]): boolean {
  return Boolean(t && t.length && t.every((row) => /^non/i.test((row[0] ?? "").trim())));
}

/** The figure as the profile header prints it, to three decimals. */
const tableNf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

/** The table's forest figure, with the unit the form leaves out left out. */
function forestTable(forestHa: number): string {
  return `its table of land use records ${tableNf.format(forestHa)} of existing forest land, with no unit given`;
}

/** The two statements of a form that disagrees with itself, as one passage. */
export function forestDisagreement(
  forestHa: number,
  links: LinkedClearances | 0,
): string {
  const answeredNo = links === 0 ||
    (!(links.u ?? "").includes("f") && !((links.a ?? 0) > 0));
  const other = answeredNo
    ? "its answer on forest clearance declares none"
    : "its account of how the land is held lists only non-forest land";
  return `The form disagrees with itself about forest land: ${forestTable(forestHa)}, while ${other}. The form does not say which statement is right.`;
}

function questions(keys: string[]): string {
  return `the question${keys.length === 1 ? "" : "s"} on ${listWords(keys.map((k) => TOPIC_NAMES[k]))}`;
}

/** Identical parcels said once, with how many the form lists. */
function tenureText(t: NonNullable<LinkedClearances["t"]>): string {
  const counts = new Map<string, number>();
  for (const row of t) {
    const said = row.filter(Boolean).join(", ");
    counts.set(said, (counts.get(said) ?? 0) + 1);
  }
  return [...counts].map(([said, n]) => (n > 1 ? `${said} (${n} entries)` : said)).join("; ");
}

const FOREST_NOTE =
  "Before forest land is diverted, the rights of forest dwellers have to be settled under the Forest Rights Act, and a 2009 circular of the Ministry of Environment and Forests asks, in the circumstances it sets out, for the Gram Sabha's written consent to the diversion. The obligations section of this profile says how that bears on this proposal.";

export function linkedClearanceLines(
  links: LinkedClearances | 0 | null,
  forestRegister?: ForestRegisterEntry | null,
  forestHa?: number | null,
): { state: "unread" | "none" | "blank" | "declared"; lines: LinkLine[] } {
  if (links == null) return { state: "unread", lines: [] };
  const reading = forestReading(forestHa, links);
  const tableForest = (forestHa ?? 0) > 0;
  if (links === 0 && reading !== "disagrees") return { state: "none", lines: [] };
  // A form that answered every question "no" is read below as one with no
  // blanks and nothing declared, so the forest line can name its contradiction.
  const L: LinkedClearances = links === 0 ? {} : links;
  const declaredKeys = Object.keys(L).filter((k) => k !== "u");
  // "blank" only when ALL five were left blank; {u: "fw"} answered three.
  if (!declaredKeys.length && !tableForest && "fwepc".split("").every((k) => (L.u ?? "").includes(k))) {
    return { state: "blank", lines: [] };
  }
  const lines: LinkLine[] = [];

  const forestLine = Boolean(L.f || (L.a ?? 0) > 0 || tableForest);
  if (forestLine) {
    const parts: string[] = [];
    if (L.f) {
      const [no, status, applied, diverted, approved] = L.f;
      parts.push(
        "The form says the project needs forest clearance" +
          (no ? `, under forest proposal ${no}` : ", but it names no forest proposal") + ".",
      );
      if (status) parts.push(`It gives the status of that clearance as "${status}".`);
      const areas = [
        applied != null ? `${nf.format(applied)} ha applied for diversion` : null,
        diverted != null ? `${nf.format(diverted)} ha diverted` : null,
      ].filter((x): x is string => x !== null);
      if (areas.length) {
        parts.push(`It records ${areas.join(" and ")}` +
          (approved ? `, with approval dated ${approved}` : "") + ".");
      } else if (approved) {
        parts.push(`It dates the approval ${approved}.`);
      }
    } else if (reading === "disagrees") {
      parts.push(forestDisagreement(forestHa as number, links));
    } else if (tableForest) {
      parts.push((L.u ?? "").includes("f")
        ? `The form leaves blank whether forest clearance is involved, but ${forestTable(forestHa as number)}.`
        : `The form's table of land use records ${tableNf.format(forestHa as number)} of existing forest land, with no unit given.`);
    }
    if ((L.a ?? 0) > 0) {
      // No unit: the form's land breakup carries none (see the register
      // page's land caveat), so the figure is given as filed.
      const sought = `additional forest land sought, recorded as ${nf.format(L.a!)} without a unit.`;
      parts.push(
        L.f || tableForest
          ? `Its table of land use also lists ${sought}`
          : (L.u ?? "").includes("f")
            ? `The form leaves blank whether forest clearance is involved, but its table of land use lists ${sought}`
            : `The form's table of land use lists ${sought}`,
      );
    }
    if (forestRegister) {
      const read = istDate(forestRegister.readAt);
      parts.push(
        `The forest clearance register itself` + (read ? `, as read on ${read},` : "") +
          ` records it as "${forestRegister.status}"` +
          (forestRegister.area != null ? `, ${nf.format(forestRegister.area)} ha` : "") +
          (forestRegister.form ? ` (${forestRegister.form})` : "") + ".",
      );
    }
    lines.push({ label: "Forest clearance", text: parts.join(" "), note: FOREST_NOTE });
  }
  if (L.w) {
    const [pa, status, no] = L.w;
    lines.push({
      label: "Wildlife board",
      text:
        "The form says the project needs a recommendation from the National Board for Wildlife" +
        (pa ? `, for ${pa}` : "") + (no ? `, under proposal ${no}` : "") + "." +
        (status ? ` It gives the status as "${status}".` : ""),
    });
  }
  if (L.p || L.e) {
    lines.push({
      label: "Protected areas",
      text: [
        L.p ? "The form declares the site in or near a national park, sanctuary or other protected area." : "",
        L.e
          ? `${L.p ? "It also declares" : "The form declares"} the site within an eco-sensitive zone.`
          : "",
      ].filter(Boolean).join(" "),
    });
  }
  if (L.c) {
    lines.push({
      label: "Coastal regulation zone",
      text: "The form declares activity in a coastal regulation zone" +
        (L.c[1] ? ` (${L.c[1]})` : "") + ".",
    });
  }
  if (L.t && L.t.length) {
    lines.push({
      label: "How the land is held",
      text: "The form describes its land by type, ownership and acquisition status, in its own words: " +
        tenureText(L.t) + ".",
      note: "How the land is obtained decides which resettlement and consent duties apply. Land acquired under the Right to Fair Compensation and Transparency in Land Acquisition, Rehabilitation and Resettlement Act, 2013 carries all of that Act's duties, while land a private company buys by negotiation carries its rehabilitation and resettlement duties only above an area the State government sets (section 2(3)).",
    });
  }
  // Forest is already dealt with in the forest line when that line exists; it
  // is not repeated in either list below.
  const blank = (L.u ?? "").split("")
    .filter((k) => TOPIC_NAMES[k] && !(k === "f" && forestLine));
  if (blank.length) {
    lines.push({
      label: "Not answered",
      text: `The form leaves blank ${questions(blank)}, so for ${blank.length === 1 ? "it" : "these"} the answer is unknown.`,
    });
  }
  if (blank.length || reading === "disagrees") {
    // What it answered and declared none of - said, so a partly blank form
    // is not read as wholly blank or wholly clear.
    const declaredTopic: Record<string, boolean> = {
      f: forestLine, w: Boolean(L.w), e: Boolean(L.e), p: Boolean(L.p), c: Boolean(L.c),
    };
    const no = "fwepc".split("").filter((k) => !(L.u ?? "").includes(k) && !declaredTopic[k]);
    if (no.length) {
      lines.push({
        label: "Answered, none declared",
        text: `The form answers ${questions(no)} and declares nothing under ${no.length === 1 ? "it" : "any of them"}.` +
          (links === 0 ? " It gives no detail of how the land is held." : ""),
      });
    }
  }
  return { state: "declared", lines };
}
