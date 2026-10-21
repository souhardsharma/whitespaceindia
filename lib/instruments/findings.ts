/**
 * Tier 2: sentences, from deterministic templates.
 *
 * The plan set out four tiers. Tier 1 is computed values, which the fact layer
 * renders. Tier 3 is cited legal text. Tier 4 was an optional generated
 * narrative, declined deliberately. This is Tier 2, and until now it was
 * missing: the instrument showed two datasets side by side and left the reader
 * to notice what the combination meant.
 *
 * Every finding here is produced by a rule with an explicit threshold. The same
 * inputs always produce the same sentence. No model is involved, nothing is
 * ranked or scored, and each finding names the facts that triggered it so a
 * reader can check the reasoning rather than take the sentence on trust.
 *
 * THRESHOLDS AND WHERE THEY COME FROM. These are not arbitrary. Each is either
 * a national benchmark computed by this pipeline, or a figure with a stated
 * basis. A finding fires when a place is materially above or below the national
 * position, not when it crosses a number someone liked the look of.
 *
 * These are OBSERVATIONS, not conclusions. Nothing here says a project should
 * or should not proceed. The instrument describes; the reader decides.
 */

import type { DistrictRecord, Project } from "./types";
import type { LegalDetermination } from "@/components/instruments/ConsentScreen";
// Relative, not the @/ alias: this module is imported by node --test, which
// does not resolve tsconfig path aliases.
import measuresFile from "../../public/data/instruments/consent/measures.json" with { type: "json" };

export interface Finding {
  id: string;
  /** The observation, as a complete sentence. */
  text: string;
  /** Which measure ids or record fields produced it, for the reader to check. */
  basis: string[];
  /** How the threshold was set. */
  rule: string;
  kind: "population" | "livelihood" | "legal" | "declared";
}

/**
 * National benchmarks, computed by this pipeline from Census 2011 over summed
 * inputs. Kept here as constants so a rule can state what it is comparing to;
 * the live values are in measures.json and are shown beside every figure.
 */
/**
 * National benchmarks, READ FROM the published registry.
 *
 * These were hardcoded literals, and two of the five had already drifted from
 * measures.json - scShare 16.2 against a published 16.64, agLabourer 30.0
 * against 29.92 - with nothing comparing them. Neither was referenced, so
 * nothing rendered wrongly; but three others ARE referenced in the sentences
 * below, and a literal that happens to agree today is one nobody will notice
 * disagreeing tomorrow. 17 districts sit between 16.2 and 16.64 on SC share:
 * had that constant been used, each would have had its comparison flipped by a
 * number no gate was watching.
 *
 * The engineering reference states the rule these violated: values live in the data, their
 * definition and source live once in measures.json, and the interface joins
 * them at render. A benchmark is a value.
 *
 * The unused two are gone rather than joined - a constant no sentence quotes
 * is not a benchmark, it is a number waiting to be believed.
 */
const BENCHMARKS = ((measuresFile as unknown) as {
  benchmarks?: { india?: Record<string, number | null> };
}).benchmarks?.india ?? {};

function national(key: string, fallbackLabel: string): number {
  const v = BENCHMARKS[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    // A missing benchmark must not silently become 0, which would make every
    // district look far above the national figure.
    throw new Error(
      `findings.ts: no published national benchmark for ${key} (${fallbackLabel})`,
    );
  }
  return v;
}

const INDIA = {
  get stShare() {
    return national("pop.st_share", "Scheduled Tribe share");
  },
  get landDependent() {
    return national("work.land_dependent_share", "land-dependent share");
  },
  get literacy() {
    return national("pop.literacy_rate", "literacy rate");
  },
};

const nf = new Intl.NumberFormat("en-IN");

export function findingsForDistrict(
  district: DistrictRecord,
  determination: LegalDetermination | null,
  context?: { proposals?: number; categoryA?: number; displaced?: number }
): Finding[] {
  const v = district.values;
  const out: Finding[] = [];
  const st = v["pop.st_share"];
  const land = v["work.land_dependent_share"];
  const agLab = v["work.ag_labourer_share"];
  const lit = v["pop.literacy_rate"];

  // ── Population composition ──────────────────────────────────────────────
  if (st !== null && st !== undefined && st >= 50) {
    out.push({
      id: "st.majority",
      text: `Half or more of the people counted here in 2011 were Scheduled Tribe: ${st.toFixed(1)}%, against ${INDIA.stShare}% nationally.`,
      basis: ["pop.st_share"],
      rule: "Shown when the Scheduled Tribe share is 50% or more.",
      kind: "population",
    });
  } else if (st !== null && st !== undefined && st >= INDIA.stShare * 2) {
    out.push({
      id: "st.elevated",
      text: `The Scheduled Tribe share here, ${st.toFixed(1)}%, is at least double the national figure of ${INDIA.stShare}%.`,
      basis: ["pop.st_share"],
      rule: "Shown when the Scheduled Tribe share is at least twice the national share.",
      kind: "population",
    });
  }

  // ── Livelihood exposure ─────────────────────────────────────────────────
  if (land !== null && land !== undefined && land >= 75) {
    out.push({
      id: "land.dominant",
      text: `Cultivators and agricultural labourers make up ${land.toFixed(0)}% of workers here, against ${INDIA.landDependent.toFixed(0)}% nationally, so at least three in four people who work here do so on the land.`,
      basis: ["work.land_dependent_share"],
      rule: "Shown when cultivators and agricultural labourers together are 75% of workers or more.",
      kind: "livelihood",
    });
  }

  if (agLab !== null && agLab !== undefined && agLab >= 40) {
    out.push({
      id: "aglabour.high",
      // The original said this group is "typically displaced from a
      // livelihood without being compensated for it", which is true of
      // COMPENSATION and false of the Act as a whole: section 3(c) of the
      // 2013 Act brings agricultural labourers and tenants whose livelihood
      // depends on the land within "affected family", and the Second Schedule
      // entitlements reach them. Saying otherwise understates what the law
      // provides to precisely the people this instrument exists to serve -
      // an error in the direction that reads as sympathetic, which is the
      // easiest kind to leave standing.
      text: `Agricultural labourers, who work other people's land for wages, make up ${agLab.toFixed(0)}% of workers here. Compensation for acquired land is paid to those who hold title to it, so it does not reach them. They can still claim the rehabilitation and resettlement entitlements of the Right to Fair Compensation and Transparency in Land Acquisition, Rehabilitation and Resettlement Act, 2013 (RFCTLARR), because its section 3(c) counts a family whose livelihood depends on the land as an affected family, wherever that Act governs how the land is obtained.`,
      basis: ["work.ag_labourer_share"],
      rule: "Shown when agricultural labourers are 40% of workers or more, well above their national share.",
      kind: "livelihood",
    });
  }

  if (lit !== null && lit !== undefined && lit <= 60) {
    out.push({
      id: "literacy.low",
      text: `Literacy was ${lit.toFixed(1)}% in 2011 against ${INDIA.literacy}% nationally, so notices and documents issued in writing during a consultation may reach fewer people here.`,
      basis: ["pop.literacy_rate"],
      rule: "Shown when literacy is 60% or lower, measured over the population aged 7 and above.",
      kind: "population",
    });
  }

  // ── Legal status ────────────────────────────────────────────────────────
  if (determination?.status === "within") {
    out.push({
      id: "legal.scheduled",
      text: `This district is a Fifth Schedule Scheduled Area. Under section 41(3) of the Right to Fair Compensation and Transparency in Land Acquisition, Rehabilitation and Resettlement Act, 2013 (RFCTLARR), land here can be acquired only with the prior consent of the Gram Sabha, and the requirement holds even when an acquisition is urgent.`,
      basis: ["legal_reference.determinations"],
      rule: "Shown where a Presidential Order names the whole district as a Scheduled Area.",
      kind: "legal",
    });
  } else if (determination?.status === "partial") {
    out.push({
      id: "legal.partial",
      text: `Part of this district is a Fifth Schedule Scheduled Area. Acquiring land for a project sited in that part needs the Gram Sabha's prior consent under section 41(3) of RFCTLARR, and the district-level record cannot settle whether a particular site lies there.`,
      basis: ["legal_reference.determinations"],
      rule: "Shown where a Presidential Order names only some blocks, tehsils or villages in the district.",
      kind: "legal",
    });
  }

  // ── The combination that matters most ───────────────────────────────────
  if (
    st !== null && st !== undefined && st >= 50 &&
    land !== null && land !== undefined && land >= 70 &&
    (context?.proposals ?? 0) > 0
  ) {
    out.push({
      id: "combined.exposure",
      text: `${nf.format(context!.proposals!)} clearance proposals name this district, where ${st.toFixed(0)}% of people are Scheduled Tribe and ${land.toFixed(0)}% of workers depend on the land${
        (context?.categoryA ?? 0) > 0
          ? `. ${nf.format(context!.categoryA!)} of those proposals are Category A, the class the central government appraises`
          : ""
      }.`,
      basis: ["pop.st_share", "work.land_dependent_share", "register.proposals"],
      rule: "Shown where the Scheduled Tribe share is 50% or more, at least 70% of workers depend on the land, and at least one proposal names the district.",
      kind: "declared",
    });
  }

  if ((context?.displaced ?? 0) > 0) {
    out.push({
      id: "declared.displacement",
      text: `Applicants for projects sited mainly in this district have declared ${nf.format(context!.displaced!)} families to be displaced. The figure comes from their applications, and we have not verified it.`,
      basis: ["register.declared_displaced"],
      rule: "Shown when the families declared displaced across the district's proposals number more than zero.",
      kind: "declared",
    });
  }

  return out;
}

/** Findings for a single proposal, drawing on what its own filing declares. */
export function findingsForProject(
  project: Project,
  district: DistrictRecord | null,
  determination: LegalDetermination | null
): Finding[] {
  const out: Finding[] = [];
  const d = project.declared;

  if ((d.displacedFamilies ?? 0) > 0) {
    out.push({
      id: "project.displacement",
      // Conditional, as the obligations panel is ("MAY APPLY"): the Second
      // Schedule attaches to acquisition under the 2013 Act and, by s.2(3)
      // read with s.46, to a private company's purchase by negotiation above
      // the area the State prescribes. The form records neither the route nor
      // the area test, so the sentence states both routes and says the filing
      // settles neither.
      text: `The applicant has declared that ${nf.format(d.displacedFamilies!)} families will be displaced by this project. Those families are owed the rehabilitation and resettlement entitlements in the Second Schedule of RFCTLARR if the land is acquired under that Act, or if a private company buys it by negotiation above an area the State government sets (section 2(3)). The filing does not say how the land is being obtained.`,
      basis: ["declared.displacedFamilies"],
      rule: "Shown when the application declares more than zero displaced families.",
      kind: "declared",
    });
  }

  if ((d.forestLandHa ?? 0) > 0) {
    out.push({
      id: "project.forest",
      // "apply" was doing the work of a determination here too. Diversion of
      // forest land requires prior approval under the Forest (Conservation)
      // Act 1980, and the 2009 circular under it requires the Forest Rights
      // Act 2006 rights-recognition and Gram Sabha consent step first - but
      // whether either has been sought or completed is not on this form, and
      // the instrument does not know it.
      text: `The applicant has declared that this project involves forest land. Diverting forest land needs the central government's prior approval under the Forest (Conservation) Act, 1980, renamed the Van (Sanrakshan Evam Samvardhan) Adhiniyam in 2023, and settling forest rights under the Forest Rights Act, 2006 is one of the steps in that approval. The filing does not record whether either has been sought.`,
      basis: ["declared.forestLandHa"],
      rule: "Shown when the application declares any forest land.",
      kind: "declared",
    });
  }

  if (d.litigationPending === "YES") {
    out.push({
      id: "project.litigation",
      text: `The applicant has declared that litigation concerning this project is pending.`,
      basis: ["declared.litigationPending"],
      rule: "Shown when the application declares pending litigation.",
      kind: "declared",
    });
  }

  if (d.violationInvolved === "YES") {
    out.push({
      id: "project.violation",
      text: `The applicant has declared the project a violation case, which means work began before the clearance it needed was obtained.`,
      basis: ["declared.violationInvolved"],
      rule: "Shown when the application declares a violation.",
      kind: "declared",
    });
  }

  if (project.multiDistrictCount && project.multiDistrictCount > 1) {
    out.push({
      id: "project.linear",
      text: `The filing names sites in ${project.multiDistrictCount} districts, so the project may affect people in each of them, while the population profile below covers only the district with the most sites.`,
      basis: ["district.allDistricts"],
      rule: "Shown when the filing names more than one district.",
      kind: "declared",
    });
  }

  if (district && determination?.status === "within") {
    out.push({
      id: "project.scheduled",
      text: `The site is in a Fifth Schedule Scheduled Area, so acquiring land for it needs the prior consent of the Gram Sabha under section 41(3) of RFCTLARR.`,
      basis: ["legal_reference.determinations"],
      rule: "Shown where a Presidential Order names the whole district as a Scheduled Area.",
      kind: "legal",
    });
  }

  return out;
}
