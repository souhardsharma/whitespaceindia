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
      text: `Most people counted here in 2011 were Scheduled Tribe — ${st.toFixed(1)}%, against ${INDIA.stShare}% nationally.`,
      basis: ["pop.st_share"],
      rule: `fires when the Scheduled Tribe share is at least 50%, i.e. a majority of the population`,
      kind: "population",
    });
  } else if (st !== null && st !== undefined && st >= INDIA.stShare * 2) {
    out.push({
      id: "st.elevated",
      text: `The Scheduled Tribe share here, ${st.toFixed(1)}%, is more than double the national ${INDIA.stShare}%.`,
      basis: ["pop.st_share"],
      rule: "fires at twice the national Scheduled Tribe share",
      kind: "population",
    });
  }

  // ── Livelihood exposure ─────────────────────────────────────────────────
  if (land !== null && land !== undefined && land >= 75) {
    out.push({
      id: "land.dominant",
      text: `Three in four workers here derive their income directly from land — ${land.toFixed(0)}%, against ${INDIA.landDependent.toFixed(0)}% nationally. Land taken here is income taken.`,
      basis: ["work.land_dependent_share"],
      rule: "fires when cultivators and agricultural labourers together are at least 75% of workers",
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
      text: `${agLab.toFixed(0)}% of workers are agricultural labourers, who work land they do not own. Compensation for the land itself follows the title, so it does not reach them; the 2013 Act's rehabilitation and resettlement entitlements do, because section 3(c) counts a family whose livelihood depends on the land as an affected family. That distinction decides what this group can claim, and it only holds where the 2013 Act applies at all.`,
      basis: ["work.ag_labourer_share"],
      rule: "fires when agricultural labourers are at least 40% of workers, well above the national share",
      kind: "livelihood",
    });
  }

  if (lit !== null && lit !== undefined && lit <= 60) {
    out.push({
      id: "literacy.low",
      text: `Literacy was ${lit.toFixed(1)}% in 2011 against ${INDIA.literacy}% nationally, which bears on how a written consultation process actually reaches people.`,
      basis: ["pop.literacy_rate"],
      rule: "fires at or below 60% literacy, measured over population aged 7 and above",
      kind: "population",
    });
  }

  // ── Legal status ────────────────────────────────────────────────────────
  if (determination?.status === "within") {
    out.push({
      id: "legal.scheduled",
      text: `This district is a Fifth Schedule Scheduled Area. Prior consent of the Gram Sabha is a legal precondition for land acquisition here under RFCTLARR section 41(3) — consent, not consultation, and it applies even in cases of urgency.`,
      basis: ["legal_reference.determinations"],
      rule: "fires where a Presidential Order names the whole district",
      kind: "legal",
    });
  } else if (determination?.status === "partial") {
    out.push({
      id: "legal.partial",
      text: `Part of this district is a Fifth Schedule Scheduled Area. Whether a particular site falls inside it decides whether Gram Sabha consent is legally required, and that cannot be settled at district level.`,
      basis: ["legal_reference.determinations"],
      rule: "fires where a Presidential Order names only blocks, tehsils or villages within the district",
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
      text: `${nf.format(context!.proposals!)} clearance proposals sit in a district that is ${st.toFixed(0)}% Scheduled Tribe and where ${land.toFixed(0)}% of workers depend on land${
        (context?.categoryA ?? 0) > 0
          ? `, ${nf.format(context!.categoryA!)} of them Category A`
          : ""
      }.`,
      basis: ["pop.st_share", "work.land_dependent_share", "register.proposals"],
      rule: "fires where a majority-Scheduled-Tribe district with at least 70% land dependence also holds active proposals",
      kind: "declared",
    });
  }

  if ((context?.displaced ?? 0) > 0) {
    out.push({
      id: "declared.displacement",
      text: `Proponents filing here have declared ${nf.format(context!.displaced!)} families to be displaced. That is their own figure from their own applications, not an independent assessment.`,
      basis: ["register.declared_displaced"],
      rule: "fires when the declared displaced-family total across the district is above zero",
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
      // NOT "which engages the Second Schedule ... in full". That is a
      // statement about the law, made from a number on an environmental
      // clearance form, and the form does not establish it: the Second
      // Schedule attaches to acquisition UNDER the 2013 Act, and land bought
      // through private negotiation is outside it. The obligations panel on
      // this same page says "MAY APPLY" for exactly that reason, so the two
      // halves of one profile were making different claims about the same
      // proposal. What the filing does establish is the declaration.
      text: `The proponent has declared ${nf.format(d.displacedFamilies!)} families to be displaced by this project. Where land for it is acquired under the 2013 Act, that engages the Second Schedule rehabilitation and resettlement entitlements; where it is bought through private negotiation, it does not, and this filing does not say which.`,
      basis: ["declared.displacedFamilies"],
      rule: "fires when the application declares displaced families above zero",
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
      text: `The proponent has declared that this project involves forest land. Diverting forest land requires prior approval under the Forest (Conservation) Act 1980, and the recognition of forest rights under the Forest Rights Act 2006 is a step in that process rather than a parallel one. Whether either has been sought for this project is not recorded in this filing.`,
      basis: ["declared.forestLandHa"],
      rule: "fires when the application declares forest land above zero",
      kind: "declared",
    });
  }

  if (d.litigationPending === "YES") {
    out.push({
      id: "project.litigation",
      text: `The proponent has declared that litigation is pending in relation to this project.`,
      basis: ["declared.litigationPending"],
      rule: "fires when the application declares pending litigation",
      kind: "declared",
    });
  }

  if (d.violationInvolved === "YES") {
    out.push({
      id: "project.violation",
      text: `The proponent has declared that a violation is involved, meaning work began before the clearance it required was obtained.`,
      basis: ["declared.violationInvolved"],
      rule: "fires when the application declares a violation",
      kind: "declared",
    });
  }

  if (project.multiDistrictCount && project.multiDistrictCount > 1) {
    out.push({
      id: "project.linear",
      text: `The filing names sites in ${project.multiDistrictCount} districts. The profile below describes only the district holding the most of them.`,
      basis: ["district.allDistricts"],
      rule: "fires when the filing names more than one district",
      kind: "declared",
    });
  }

  if (district && determination?.status === "within") {
    out.push({
      id: "project.scheduled",
      text: `The site is in a Fifth Schedule Scheduled Area, where Gram Sabha consent is a precondition for acquisition rather than an outcome of consultation.`,
      basis: ["legal_reference.determinations"],
      rule: "fires where a Presidential Order names the whole district",
      kind: "legal",
    });
  }

  return out;
}
