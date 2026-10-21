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

export function linkedClearanceLines(
  links: LinkedClearances | 0 | null,
  forestRegister?: ForestRegisterEntry | null,
): { state: "unread" | "none" | "blank" | "declared"; lines: LinkLine[] } {
  if (links == null) return { state: "unread", lines: [] };
  if (links === 0) return { state: "none", lines: [] };
  const declaredKeys = Object.keys(links).filter((k) => k !== "u");
  // "blank" only when ALL five were left blank; {u: "fw"} answered three.
  if (!declaredKeys.length && "fwepc".split("").every((k) => (links.u ?? "").includes(k))) {
    return { state: "blank", lines: [] };
  }
  const lines: LinkLine[] = [];

  if (links.f || (links.a ?? 0) > 0) {
    const parts: string[] = [];
    if (links.f) {
      const [no, status, applied, diverted, approved] = links.f;
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
    }
    if ((links.a ?? 0) > 0) {
      // No unit: the form's land breakup carries none (see the register
      // page's land caveat), so the figure is given as filed.
      parts.push(
        (!links.f && (links.u ?? "").includes("f")
          ? "The form leaves blank whether forest clearance is involved, but its table of land use"
          : "The form's table of land use") +
          ` lists additional forest land sought, recorded as ${nf.format(links.a!)} without a unit.`,
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
    lines.push({
      label: "Forest clearance",
      text: parts.join(" "),
      note: "Before forest land is diverted, the rights of forest dwellers have to be settled under the Forest Rights Act, and a 2009 circular of the Ministry of Environment and Forests asks, in the circumstances it sets out, for the Gram Sabha's written consent to the diversion. The obligations section of this profile says how that bears on this proposal.",
    });
  }
  if (links.w) {
    const [pa, status, no] = links.w;
    lines.push({
      label: "Wildlife board",
      text:
        "The form says the project needs a recommendation from the National Board for Wildlife" +
        (pa ? `, for ${pa}` : "") + (no ? `, under proposal ${no}` : "") + "." +
        (status ? ` It gives the status as "${status}".` : ""),
    });
  }
  if (links.p || links.e) {
    lines.push({
      label: "Protected areas",
      text: [
        links.p ? "The form declares the site in or near a national park, sanctuary or other protected area." : "",
        links.e
          ? `${links.p ? "It also declares" : "The form declares"} the site within an eco-sensitive zone.`
          : "",
      ].filter(Boolean).join(" "),
    });
  }
  if (links.c) {
    lines.push({
      label: "Coastal regulation zone",
      text: "The form declares activity in a coastal regulation zone" +
        (links.c[1] ? ` (${links.c[1]})` : "") + ".",
    });
  }
  if (links.t && links.t.length) {
    lines.push({
      label: "How the land is held",
      text: "The form describes its land by type, ownership and acquisition status, in its own words: " +
        links.t.map((t) => t.filter(Boolean).join(", ")).join("; ") + ".",
      note: "How the land is obtained decides which resettlement and consent duties apply. Land acquired under the Right to Fair Compensation and Transparency in Land Acquisition, Rehabilitation and Resettlement Act, 2013 carries all of that Act's duties, while land a private company buys by negotiation carries its rehabilitation and resettlement duties only above an area the State government sets (section 2(3)).",
    });
  }
  // Forest is already said to be blank in the forest line when that line
  // exists only because of the land breakup; it is not repeated here.
  const forestLine = Boolean(links.f || (links.a ?? 0) > 0);
  const blank = (links.u ?? "").split("")
    .filter((k) => TOPIC_NAMES[k] && !(k === "f" && forestLine));
  if (blank.length) {
    lines.push({
      label: "Not answered",
      text: `The form leaves blank the questions on ${listWords(blank.map((k) => TOPIC_NAMES[k]))}, so for these the answer is unknown.`,
    });
    // What it answered and declared none of - said, so a partly blank form
    // is not read as wholly blank or wholly clear.
    const declaredTopic: Record<string, boolean> = {
      f: forestLine, w: Boolean(links.w), e: Boolean(links.e), p: Boolean(links.p), c: Boolean(links.c),
    };
    const no = "fwepc".split("").filter((k) => !(links.u ?? "").includes(k) && !declaredTopic[k]);
    if (no.length) {
      lines.push({
        label: "Answered, none declared",
        text: `The form answers the questions on ${listWords(no.map((k) => TOPIC_NAMES[k]))} and declares nothing under any of them.`,
      });
    }
  }
  return { state: "declared", lines };
}
