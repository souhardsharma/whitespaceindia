/**
 * Deciding which obligations attach to a given proposal.
 *
 * Each curated obligation carries a `triggerKey`. This module evaluates that key
 * against the proposal's own attributes and returns one of four answers:
 *
 *   "yes"            the trigger is established from the record
 *   "conditional"    the trigger depends on something the record does not settle
 *   "no"             the record positively establishes the trigger is absent
 *   "not_determined" the record does not say, and nothing here will guess
 *
 * The last one is the important one. Most consent obligations in Indian law turn
 * on whether the site is in a Fifth Schedule Scheduled Area, and that is a legal
 * determination made by Presidential Order which this instrument does not yet
 * hold. Returning "not_determined" is the honest answer. Returning "no" would
 * assert that the obligation does not apply, which is a much stronger claim than
 * the data supports and the more dangerous of the two errors.
 */

import type { Project } from "./types";

/**
 * What the obligation logic actually reads from a proposal, and nothing more.
 *
 * The functions below used to take a whole `Project`. The PDF export does not
 * have one - it builds a flat object for rendering - so it passed its own
 * shape through `as never`, which type-checked and then threw
 * `Cannot read properties of undefined (reading 'totalLandHa')` on every
 * export. Declaring the three fields that matter lets every caller be checked
 * by the compiler instead of by a 500 in production.
 */
export type ObligationSubject = Pick<Project, "category" | "sector" | "declared"> &
  Partial<Pick<Project, "links">>;
import type { LegalDetermination, Obligation } from "@/components/instruments/ConsentScreen";

export interface RawObligation {
  instrument: string;
  provision: string;
  requirement: string;
  trigger: string;
  triggerKey: string;
  kind: "statutory" | "standard";
  sourceUrl?: string;
  lastReviewed?: string;
  verified?: boolean;
  note?: string;
}

export interface LegalReference {
  last_reviewed: string;
  obligations: RawObligation[];
  determinations: Record<string, LegalDetermination>;
  notes: Record<string, unknown>;
  counts: { obligations: number; verified: number; determinations: number };
}

type Applies = Obligation["applies"];

/** Minor minerals under the MMDR Act: sand, stone, ordinary clay, murram, and
 *  building stone. Major minerals - coal, iron ore, bauxite, limestone - are
 *  NOT minor minerals, and PESA s.4(k)/(l) do not reach them. The register's
 *  sector field distinguishes coal mining from non-coal mining but does not
 *  distinguish minor from major within non-coal, so this can only ever be
 *  "conditional" from the data available. */
/** The register's sector vocabulary, matched exactly. It is a closed list of
 *  nine values published in index.json, so substring matching buys nothing and
 *  cost everything: "Non-Coal Mining".includes("coal") is TRUE, so every
 *  non-coal mining proposal was classified as coal - a major mineral - and
 *  PESA s.4(k)/(l) rendered "Does not apply" on 13,433 proposals in districts
 *  this instrument itself determines are inside a Scheduled Area. Non-coal
 *  mining is exactly where minor minerals live: sand, stone, murram, ordinary
 *  clay. The instrument was telling communities they had no statutory role in
 *  the one case where the statute gives them one. */
const COAL_SECTOR = "Coal Mining";
const NON_COAL_MINING_SECTOR = "Non-Coal Mining";

function mineralTrigger(p: Pick<Project, "sector">): Applies {
  // Coal is a MAJOR mineral, so PESA's minor-mineral provisions do not reach
  // it. Compared exactly, never as a substring.
  if (p.sector === COAL_SECTOR) return "no";
  // Non-coal mining contains both major minerals (iron ore, bauxite,
  // limestone) and minor ones. The register does not distinguish them, so the
  // honest answer is that it may apply and the reader must check the mineral.
  if (p.sector === NON_COAL_MINING_SECTOR) return "conditional";
  return "no";
}

export function evaluateTrigger(
  triggerKey: string,
  project: ObligationSubject,
  determination: LegalDetermination | null
): Applies {
  // Every status named explicitly. "outside" reached this through an else,
  // so any status the code did not know about - a value added later, a typo
  // in the data - became "does not apply", the strongest negative claim this
  // panel makes. An unrecognised status is a gap and must read as one.
  // READ DEFENSIVELY. This reaches straight into `project.declared`, and an
  // absent one threw `Cannot read properties of undefined` - which 500'd the
  // PDF export for every proposal when a caller passed a differently-shaped
  // object. A public endpoint must not crash on a malformed input; the honest
  // answer to "we cannot see the declaration" is that the position is not
  // determined, which is exactly what a null declaration already produces.
  const declared = project?.declared ?? {
    totalLandHa: null,
    forestLandHa: null,
    affectedFamilies: null,
    displacedFamilies: null,
    rnrInvolved: null,
    litigationPending: null,
    violationInvolved: null,
  };

  const status = determination?.status;
  const inScheduled: Applies =
    status === "within"
      ? "yes"
      : status === "partial"
      ? "conditional"
      : status === "outside"
      ? "no"
      : "not_determined";

  switch (triggerKey) {
    case "category_a_or_b1":
      // Established directly from the register. The exemption list in the
      // notification is narrower than the category rule, so a project that is
      // A or B1 but sits in an approved industrial estate is exempt; the
      // register does not record that, hence "conditional" rather than "yes".
      if (project.category === "A" || project.category === "B1") {
        return "conditional";
      }
      if (project.category === "B2") return "no";
      return "not_determined";

    case "scheduled_area":
      return inScheduled;

    case "scheduled_area_minor_minerals": {
      const mineral = mineralTrigger(project);
      if (mineral === "no") return "no";
      if (inScheduled === "no") return "no";
      if (inScheduled === "yes" && mineral === "conditional") return "conditional";
      return inScheduled === "not_determined" ? "not_determined" : "conditional";
    }

    case "forest_land": {
      // Forest land is established by EITHER of the form's statements: the
      // forest area in its land breakup, or its declaration that forest
      // clearance is involved (with the diversion proposal it names). The
      // breakup alone missed projects whose forest land sits only in the
      // diversion they seek. A "no" needs both to be read and neither to
      // declare forest - an unread cross-reference (links null) is unknown,
      // and so is a form that left the forest-clearance question BLANK
      // (`u` holds "f"): half the forms read leave it blank, and reading
      // that as "no" told readers the rules did not apply.
      const forest = declared.forestLandHa;
      const links = (project as ObligationSubject).links;
      const fcInvolved = links != null && links !== 0 &&
        (links.f != null || (links.a ?? 0) > 0);
      if ((forest ?? 0) > 0 || fcInvolved) return "yes";
      if (forest === null || links == null) return "not_determined";
      if (links !== 0 && (links.u ?? "").includes("f")) return "not_determined";
      return "no";
    }

    // The RFCTLARR Second Schedule. Declared displacement makes it possible,
    // never established: it attaches through acquisition under the Act, or a
    // private purchase above a State-prescribed limit (s.2(3)), and the
    // register records neither route. So a declared displacement is
    // "conditional" - "may apply" - and only an explicit nil is a "no".
    case "resettlement_entitlement": {
      const d = declared;
      if (
        d.displacedFamilies === null &&
        d.affectedFamilies === null &&
        d.rnrInvolved === null
      ) {
        return "not_determined";
      }
      if ((d.displacedFamilies ?? 0) > 0 || (d.affectedFamilies ?? 0) > 0) {
        return "conditional";
      }
      if (d.rnrInvolved === "YES") return "conditional";
      return "no";
    }

    case "acquisition_any":
    case "acquisition_private_or_ppp":
      // The clearance register records land area but not the tenure route by
      // which it was obtained. Land bought through private negotiation does not
      // engage the Act at all, and nothing in the filing distinguishes the two.
      return declared.totalLandHa ? "conditional" : "not_determined";

    case "critical_wildlife_habitat":
      // Whether a site lies in a notified critical wildlife habitat is not in
      // the register. It would need the protected-area notifications.
      return "not_determined";

    case "ilo_107":
      // India ratified C107 and it remains in force, so it binds the State
      // regardless of this project's particulars. It creates no directly
      // enforceable duty on a proponent, hence "conditional" rather than "yes".
      return "conditional";

    case "ifc_standards":
    case "equator_principles":
      // These bind through financing, and the clearance register records nothing
      // about how a project is funded. Returning "no" would assert the project
      // has no such lender, which nothing here establishes. The obligation is
      // listed so a reader knows to ask the question.
      return "not_determined";

    default:
      return "not_determined";
  }
}

export function obligationsFor(
  reference: LegalReference | null,
  project: ObligationSubject,
  determination: LegalDetermination | null
): Obligation[] {
  if (!reference) return [];
  return reference.obligations.map((o) => ({
    instrument: o.instrument,
    provision: o.provision,
    requirement: o.requirement,
    trigger: o.trigger,
    kind: o.kind,
    sourceUrl: o.sourceUrl,
    lastReviewed: o.lastReviewed,
    verified: o.verified,
    note: o.note,
    applies: evaluateTrigger(o.triggerKey, project, determination),
  }));
}

/** Order: what applies, then what might, then what is unsettled, then what does not. */
const RANK: Record<Applies, number> = {
  yes: 0,
  conditional: 1,
  not_determined: 2,
  no: 3,
};

/**
 * The four answers, in the order a reader should meet them, each with the
 * obligations that carry it. Every project used to receive the same fifteen
 * blocks in one undifferentiated column, so the two that bind it were found
 * by reading all fifteen. Groups with nothing in them are kept (with an empty
 * list) so a caller can say "none" rather than silently omit a heading.
 */
export const OBLIGATION_GROUPS: { key: Applies; label: string }[] = [
  { key: "yes", label: "Applies" },
  { key: "conditional", label: "May apply" },
  { key: "not_determined", label: "Not determined" },
  { key: "no", label: "Does not apply" },
];

export function groupObligations<T extends { applies: string }>(
  obligations: T[],
): { key: Applies; label: string; items: T[] }[] {
  return OBLIGATION_GROUPS.map((g) => ({
    ...g,
    items: obligations.filter((o) => o.applies === g.key),
  }));
}

export function sortObligations(obligations: Obligation[]): Obligation[] {
  return [...obligations].sort(
    (a, b) => RANK[a.applies] - RANK[b.applies]
  );
}
