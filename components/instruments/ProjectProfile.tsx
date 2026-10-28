"use client";

/**
 * The profile: one proposal in, one socio-economic and obligation profile out.
 *
 * Every state this page can be in is designed rather than left to fall through:
 *   - the proposal is not in this state's shard
 *   - the proposal exists but its location could not be determined
 *   - the location is known but SHRUG has no record for that place
 *   - the location spans several districts
 *   - the curated legal reference does not cover the place
 * None of them fall back to a plausible-looking default.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  DistrictRecord,
  Fact,
  InstrumentMeta,
  MeasureRegistry,
  Project,
  SubdistrictRecord,
} from "@/lib/instruments/types";
import { factsForGroup, placeName } from "@/lib/instruments/facts";
import {
  resolveDetermination,
  resolveSite,
  obligationDetermination,
  type Determination,
} from "@/lib/instruments/determination";
import AppraisalTimeline from "./AppraisalTimeline";
import SiteLocator, { type GeoFeature } from "./SiteLocator";
import stagesFile from "@/public/data/instruments/consent/stages.json";
import freshness from "@/public/data/instruments/consent/freshness.json";
import { sourceVintageLabel } from "@/lib/instruments/vintage";
import { stageLabel } from "@/lib/instruments/projects";
import type { ProposalBundle } from "@/lib/instruments/bundle";
import {
  obligationsFor,
  sortObligations,
  type LegalReference,
} from "@/lib/instruments/obligations";
import { FactGroup } from "./FactValue";
import Findings from "./Findings";
import { findingsForProject } from "@/lib/instruments/findings";
import ExportButton from "./ExportButton";
import {
  ConsentScreen,
  ObligationPanel,
  type LegalDetermination,
} from "./ConsentScreen";
import { PLUM } from "./InstrumentChrome";
import { locationEvidence } from "@/lib/instruments/location";
import { presentState, titleCase } from "@/lib/instruments/place";
import { FollowButton } from "./Watchlist";
import LinkedClearances from "./LinkedClearances";

const nf = new Intl.NumberFormat("en-IN");

/** Canonical stage key to its label, from the ONE stage registry. The register
 *  writes 83 spellings of 73 stages; a label typed here would be an 84th. */
const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(
    (stagesFile as { statuses?: Record<string, { label?: string }> })
      .statuses ?? {},
  ).map(([k, v]) => [k, String(v?.label ?? k)]),
);

/**
 * The profile, rendered from a bundle the SERVER assembled (see
 * lib/instruments/server.ts). It used to fetch the whole state shard and the
 * whole district and sub-district files in the browser - 9.6 to 18 MB of JSON
 * to show one proposal - and rendered "Loading the profile…" to anything
 * without JavaScript, crawlers included. Now the page arrives rendered, and
 * the only state kept here is the district / sub-district toggle.
 */
export default function ProjectProfile({
  bundle,
  meta,
}: {
  bundle: ProposalBundle;
  meta: InstrumentMeta;
}) {
  const [scope, setScope] = useState<"district" | "subdistrict">("district");

  const place = useMemo(() => {
    if (scope === "subdistrict" && bundle.subdistricts.length === 1) {
      return bundle.subdistricts[0];
    }
    return bundle.district;
  }, [bundle, scope]);

  const { project, district, subdistricts, registry, districtNames,
          stateSlug: resolvedState } = bundle;
  const ref: LegalReference | null = bundle.legal.available ? bundle.legal : null;

  const stateName = district?.state_name ?? "";
  const facts = (group: string) =>
    place
      ? factsForGroup(group, registry, place.values, {
          benchmarkScope: "india",
          stateName,
        })
      : [];

  const indicators = place
    ? ["pop.st_share", "pop.sc_share", "work.land_dependent_share", "work.ag_labourer_share"]
        .map((id) =>
          factsForGroup("population", registry, place.values, {}).find((f) => f.id === id) ||
          factsForGroup("livelihood", registry, place.values, {}).find((f) => f.id === id)
        )
        // A type guard, not `.filter(Boolean)`: TypeScript cannot narrow
        // through Boolean, and the result was then cast `as never[]` at the
        // call site - which would have accepted an array of anything.
        .filter((f): f is Fact => f !== undefined)
    : [];

  // Over EVERY district the filing names, not just the modal one. Reading it
  // from the primary district alone published "Does not apply" for Gram Sabha
  // consent on 224 proposals that name a district this instrument itself
  // determines is inside a Scheduled Area. Consent is owed to the community
  // whose land is taken, not to the district holding the largest share of it.
  const resolved = resolveDetermination(
    ref?.determinations as Record<string, Determination> | undefined,
    district ? Number(district.censuscode) : null,
    project?.allDistricts ?? null,
  );
  const determination = resolved.governing;
  // WHICH district this determination belongs to.
  //
  // A filing that names several districts is answered by the strongest
  // determination among them - deliberately, because consent is owed wherever
  // the site is scheduled, and reading the primary district alone published
  // "Does not apply" for Gram Sabha consent on 224 proposals that name a
  // scheduled district. But on 322 proposals that answer comes from a district
  // OTHER than the one profiled above, and the page printed it under the
  // profiled district's name with nothing to say so. The determination is
  // right; whose it is has to be visible.
  const governingDistrict =
    resolved.fromDistrict != null &&
    district != null &&
    resolved.fromDistrict !== Number(district.censuscode)
      ? districtNames[String(resolved.fromDistrict)] ??
        `district ${resolved.fromDistrict}`
      : null;
  // Narrow a partial district to THIS site, where the Order names a whole
  // sub-division and the filing places the project in it. Without this the 71
  // transcribed sub-divisions were published and read by nothing.
  const site = resolveSite(determination, project?.subdistricts ?? null);
  // What the obligations are evaluated against: the district determination,
  // unless the filed sub-division settles it. The rule lives in the library
  // so a test can hold it; see obligationDetermination.
  const siteDetermination = obligationDetermination(determination, site);
  // The names, for the sentence on screen. A code tells the reader nothing;
  // the point is that the Order names THIS tehsil in whole.
  const settledNames = site.via
    .map((c) => subdistricts.find((sd) => Number(sd.code) === c))
    .filter(Boolean)
    .map((sd) => (sd as { name: string | null }).name)
    .filter((n): n is string => Boolean(n));

  return (
    <div>
      <ProjectHeader project={project} />

      <div className="mb-10 -mt-4 flex flex-wrap items-start gap-4">
        <ExportButton proposalId={project.id} stateSlug={resolvedState} />
        <FollowButton
          kind="proposal"
          id={project.id}
          name={project.name || project.no}
          sk={project.appraisal?.statusKey ?? null}
          upd={project.updatedOn}
        />
      </div>

      {project.district === null ? (
        <UnresolvedLocation project={project} />
      ) : !district ? (
        <Notice
          title="No Census record for this district"
          body="This proposal names a Census 2011 district that is missing from the population data we use, so there is no profile of its people to show. We leave the gap visible and do not borrow a neighbouring district's figures."
        />
      ) : (
        <>
          <LocationPanel
            names={districtNames}
            project={project}
            district={district}
            subdistricts={subdistricts}
            scope={scope}
            setScope={setScope}
          />

          <Findings
            findings={findingsForProject(project, district, determination)}
            title="What the record shows"
          />

          {/* Where the filed coordinates put it, against the district it
              names. The verdict is stated in words beneath, so the outline is
              corroboration a reader can check rather than a claim they have
              to take. */}
          <SiteLocator
            districts={
              project
                ? Array.from(
                    new Set([
                      ...(project.allDistricts ?? []),
                      ...(project.district != null ? [project.district] : []),
                    ]),
                  )
                : []
            }
            lat={project?.site?.lat ?? null}
            lon={project?.site?.lon ?? null}
            verdict={project?.site?.verdict ?? null}
            fallsIn={project?.site?.fallsIn ?? null}
            blocks={project?.site?.blocks ?? null}
            quality={project?.site?.quality ?? null}
            formStatus={project?.formStatus ?? null}
            resolution={project?.resolution ?? null}
            features={bundle.geo as GeoFeature[]}
          />

          {/* How long this has been with the authority. Published since
              Phase 1 and, until now, read by nothing. */}
          <AppraisalTimeline
            filedOn={project?.appraisal?.filedOn ?? null}
            decidedOn={project?.appraisal?.decidedOn ?? null}
            daysToDecision={project?.appraisal?.daysToDecision ?? null}
            daysPending={project?.appraisal?.daysPending ?? null}
            daysSuspended={project?.appraisal?.daysSuspended ?? null}
            queryRounds={project?.appraisal?.queryRounds ?? null}
            currentStage={project?.appraisal?.currentStage ?? null}
            currentStageLabel={
              project?.appraisal?.currentStage
                ? STAGE_LABELS[project.appraisal.currentStage] ?? null
                : null
            }
          />

          {bundle.appraisalContext ? (
            <AppraisalComparison c={bundle.appraisalContext} />
          ) : null}

          <ConsentScreen
            indicators={indicators}
            determination={determination}
            governingDistrict={governingDistrict}
            siteSettled={settledNames}
            placeLabel={place ? placeName(place) : ""}
          />

          <LinkedClearances links={project.links} forestRegister={bundle.forestRegister ?? null} />

          <ObligationPanel
            obligations={sortObligations(
              obligationsFor(
                ref,
                project,
                // The SITE-narrowed determination, not the district one.
                //
                // resolveSite settles a partly Scheduled district when the
                // filing names a sub-division the Order names in whole - the
                // entire point of transcribing those 71 sub-divisions. That
                // result reached the screen above, which says "on the face of
                // the Order, this site is inside the Scheduled Area", but not
                // this panel, which kept evaluating "partial" and rendered
                // PESA s.4(i) and RFCTLARR s.41(3) as "may apply". Measured:
                // 1,090 proposals whose two panels contradicted each other.
                //
                // resolveSite only ever narrows partial -> within, so this
                // cannot weaken a determination, only settle one.
                siteDetermination,
              )
            )}
            unavailable={!ref}
            lastReviewed={ref?.last_reviewed}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12">
            <FactGroup
              title="Population"
              intro={`Figures for ${place ? placeName(place) : ""} come from Census 2011 and are compared with India figures calculated the same way.`}
              facts={facts("population")}
              emphasise={["pop.total", "pop.st_share"]}
            />
            <FactGroup
              title="Work and livelihood"
              intro="These figures show what kind of work people do. Cultivators and agricultural labourers, together the land-dependent share, earn their living by working the land, so a project that takes land can also take their work."
              facts={facts("livelihood")}
              emphasise={["work.land_dependent_share"]}
            />
          </div>
          <FactGroup
            title="Village facilities"
            intro="Schools, health centres and other facilities come from the Census 2011 Village Directory, which covers villages only, so facilities in towns are left out."
            facts={facts("infrastructure")}
          />
          <FactGroup
            title="Household circumstances"
            intro="The Socio Economic and Caste Census 2011 records household land, income and work, which the population census does not. The figures here cover rural households only, because the dataset we draw them from publishes only its rural part."
            facts={facts("circumstances")}
          />
        </>
      )}

      <DataCurrency meta={meta} />
    </div>
  );
}

function ProjectHeader({ project: p }: { project: Project }) {
  const d = p.declared;
  return (
    <header className="mb-10 pb-8 border-b border-[#1c1c19]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <span
          className="font-label text-[10px] uppercase tracking-[0.16em] px-2 py-1"
          style={{ background: PLUM, color: "#fcf9f4" }}
        >
          {p.category ? `Category ${p.category}` : "No category recorded"}
        </span>
        <span className="font-label text-[10px] uppercase tracking-[0.16em] opacity-65">
          {stageLabel(p.appraisal?.statusKey, p.status, STAGE_LABELS)}
        </span>
        {p.authority ? (
          <span className="font-label text-[10px] uppercase tracking-[0.16em] opacity-70">
            {p.authority}
          </span>
        ) : null}
        <span className="font-label text-[10px] tracking-[0.08em] opacity-65">
          {p.no}
        </span>
      </div>

      <h1 className="font-headline font-bold text-[clamp(24px,3.4vw,42px)] leading-[1.08] tracking-[-0.025em] max-w-4xl">
        {p.name}
      </h1>

      <dl className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-5">
        <Meta label="Applicant" value={p.agency || "Not recorded"} />
        <Meta label="Sector" value={p.sector} />
        <Meta label="Submitted" value={p.date || "Not recorded"} />
        <Meta
          label="Land declared"
          value={d.totalLandHa != null ? nf.format(d.totalLandHa) : "Not declared"}
          hint={
            d.totalLandHa != null
              ? "The filing gives no unit for this figure."
              : undefined
          }
        />
      </dl>

      {(d.affectedFamilies ?? 0) > 0 ||
      (d.displacedFamilies ?? 0) > 0 ||
      d.rnrInvolved === "YES" ||
      d.litigationPending === "YES" ||
      d.violationInvolved === "YES" ? (
        <div
          className="mt-6 p-4 border-l-2"
          style={{ borderColor: PLUM, background: "rgba(122,59,107,0.04)" }}
        >
          <p className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 mb-2">
            Declared by the applicant on the form
          </p>
          <ul className="font-body text-[14px] leading-relaxed space-y-1">
            {(d.displacedFamilies ?? 0) > 0 ? (
              <li>{nf.format(d.displacedFamilies!)} families will be displaced.</li>
            ) : null}
            {(d.affectedFamilies ?? 0) > 0 ? (
              <li>{nf.format(d.affectedFamilies!)} families will be affected.</li>
            ) : null}
            {d.rnrInvolved === "YES" ? (
              <li>The project involves rehabilitation and resettlement.</li>
            ) : null}
            {d.litigationPending === "YES" ? <li>Litigation concerning the project is pending.</li> : null}
            {d.violationInvolved === "YES" ? (
              <li>The project is a violation case, meaning work began before the clearance it needed.</li>
            ) : null}
            {(d.forestLandHa ?? 0) > 0 ? (
              <li>
                The project involves forest land, recorded as{" "}
                {nf.format(d.forestLandHa!)}
                <span className="opacity-75"> with no unit given.</span>
              </li>
            ) : null}
          </ul>
          <p className="font-body text-[12px] leading-relaxed opacity-75 mt-2">
            These figures come from the applicant&rsquo;s own filing, and we
            have not checked them against any other record.
          </p>
        </div>
      ) : null}

      {p.certificateUrl ? (
        <a
          href={p.certificateUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-6 font-label text-[11px] uppercase tracking-[0.18em] underline underline-offset-4"
          style={{ color: PLUM }}
        >
          Read the signed clearance letter <span aria-hidden="true">↗</span>
        </a>
      ) : null}
    </header>
  );
}

function LocationPanel({
  project: p,
  names,
  district,
  subdistricts,
  scope,
  setScope,
}: {
  project: Project;
  names: Record<string, string>;
  district: DistrictRecord;
  subdistricts: SubdistrictRecord[];
  scope: "district" | "subdistrict";
  setScope: (s: "district" | "subdistrict") => void;
}) {
  const evidence = locationEvidence(
    {
      resolution: p.resolution,
      district: p.district,
      allDistricts: p.allDistricts,
      declaredDistrict: p.declaredDistrict,
      villageCount: p.villageCount,
      verdict: p.site?.verdict ?? null,
      fallsIn: p.site?.fallsIn ?? null,
    },
    names,
  );

  return (
    <section className="mb-10">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-3">
        <div>
          <p className="font-label text-[10px] uppercase tracking-[0.2em] opacity-70 mb-1">
            Area profiled
          </p>
          <h2 className="font-headline font-bold text-[clamp(22px,2.8vw,34px)] tracking-[-0.02em]">
            {titleCase(district.district_name)}
            <span className="opacity-65">, {titleCase(presentState(district.censuscode, district.state_name))}</span>
            {presentState(district.censuscode, district.state_name) !== district.state_name ? (
              <span className="block font-label text-[10px] uppercase tracking-[0.16em] opacity-80 mt-1">
                {titleCase(district.state_name)} in Census 2011
              </span>
            ) : null}
          </h2>
        </div>
        {subdistricts.length === 1 ? (
          <div className="flex border border-[#1c1c19]">
            {(["district", "subdistrict"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                // Which of the two is selected was carried by background
                // colour and nothing else, so a screen reader announced two
                // identical buttons and a reader who cannot distinguish the
                // plum from the paper saw no difference either.
                aria-pressed={scope === s}
                className="px-3 py-1.5 font-label text-[10px] uppercase tracking-[0.14em] transition-colors"
                style={
                  scope === s
                    ? { background: PLUM, color: "#fcf9f4" }
                    : { color: "#1c1c19" }
                }
              >
                {s === "district" ? "District" : "Sub-district"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <p className="font-body text-[13.5px] leading-relaxed opacity-70 max-w-3xl">
        {evidence.contested ? (
          <strong className="font-semibold">The location is uncertain. </strong>
        ) : null}
        {evidence.sentences.join(" ")}
        {p.allDistricts && p.allDistricts.length > 1 ? (
          <>
            {" "}
            The filing names {p.allDistricts.length} districts, and this profile
            describes the one where it names the most places. A project that
            runs across districts, such as a road or a pipeline, may affect
            people in each of them.
          </>
        ) : null}
        {scope === "subdistrict" && subdistricts[0] ? (
          <>
            {" "}
            The figures below are for the {titleCase(subdistricts[0].name || "")}{" "}
            sub-district, which describes the people living near the project
            more closely than figures for the whole district.
            {/* A tehsil that straddles a district boundary is one Census unit
                published once, so its figures cover ground outside the
                district named above. Saying nothing would let a reader take
                them for their own district's. 31 sub-districts are like this,
                all in Assam. */}
            {(subdistricts[0].districts?.length ?? 0) > 1 ? (
              <>
                {" "}
                This sub-district crosses a district boundary, so its figures
                cover the whole sub-district, including the parts that lie in
                the other {subdistricts[0].districts!.length - 1 === 1
                  ? "district"
                  : `${subdistricts[0].districts!.length - 1} districts`}.
              </>
            ) : null}
          </>
        ) : null}
      </p>
    </section>
  );
}

function UnresolvedLocation({ project: p }: { project: Project }) {
  return (
    <section className="mb-10 border border-dashed border-[#1c1c19]/35 p-6">
      <h2 className="font-headline font-bold text-[clamp(20px,2.4vw,28px)] tracking-[-0.02em] mb-3">
        Location not determined
      </h2>
      {/* Branch on whether a form was served at all.
          456 proposals reach this screen and only 266 of them were read and
          found to name no place. For 189 the Ministry's portal answers that it
          serves NO application form, and for 1 this instrument has not read
          the form yet. Saying "the applicant's form does not record a
          location" about all of them attributes an omission in a public
          regulatory filing to a named company for 190 proposals where no such
          omission is known. Not-yet-read, not-served and read-but-silent are
          three different facts. */}
      <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl">
        {p.formStatus === "none" ? (
          <>
            The PARIVESH portal of the Ministry of Environment, Forest and
            Climate Change serves no Common Application Form for this proposal,
            so we could read no filed location. The project&rsquo;s title names
            no district we can match to the Census 2011 list either, so the
            state is the most precise location available.
          </>
        ) : p.formStatus === "pend" ? (
          <>
            We have not yet read the Common Application Form for this
            proposal, and the project&rsquo;s title names no district we can
            match to the Census 2011 list, so for now the state is the most
            precise location available.
          </>
        ) : (
          <>
            This proposal&rsquo;s Common Application Form records no village,
            sub-district or district for the project site, and the
            project&rsquo;s title names no district we can match to the Census
            2011 list, so the state is the most precise location available.
          </>
        )}
      </p>
      <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl mt-3">
        No population profile is shown, because a state average would describe
        a far larger area than the project site and suggest a precision the
        record lacks.
      </p>
      {p.certificateUrl ? (
        <p className="font-body text-[13.5px] leading-relaxed opacity-70 mt-3">
          The signed clearance letter, linked above, may name the site in its
          text.
        </p>
      ) : null}
    </section>
  );
}

function DataCurrency({ meta }: { meta: InstrumentMeta }) {
  return (
    <section className="mt-14 pt-8 border-t border-[#1c1c19]">
      <h2 className="font-label text-[10px] uppercase tracking-[0.22em] opacity-70 mb-4">
        How current the data is
      </h2>
      <p className="font-body text-[13.5px] leading-relaxed opacity-75 max-w-3xl mb-5">
        {meta.vintage_warning}
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-4">
        {meta.sources.map((s) => (
          <li key={s.name}>
            <div className="font-label text-[9px] uppercase tracking-[0.18em] opacity-70">
              {sourceVintageLabel(s, freshness.checked_at)}
            </div>
            <div className="font-body text-[13px] leading-snug mt-0.5">{s.name}</div>
            <div className="font-body text-[11.5px] opacity-75">{s.publisher}</div>
          </li>
        ))}
      </ul>
      <Link
        href="/instruments/consent/methodology"
        className="inline-flex items-center gap-2 mt-6 font-label text-[11px] uppercase tracking-[0.18em]"
        style={{ color: PLUM }}
      >
        How the figures here were produced
      </Link>
    </section>
  );
}

function Meta({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="font-label text-[9px] uppercase tracking-[0.18em] opacity-70">
        {label}
      </dt>
      <dd className="font-body text-[14px] leading-snug mt-1">{value}</dd>
      {/*
        The Common Application Form records a land figure but no unit for it.
        Mining files in hectares, townships in square metres, and nothing in the
        record distinguishes them. Printing "ha" here would be a guess.
      */}
      {hint ? (
        <dd className="font-body text-[11px] leading-snug opacity-70 mt-0.5">
          {hint}
        </dd>
      ) : null}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-16 text-center border border-dashed border-[#1c1c19]/25">
      <p className="font-headline text-[22px] tracking-[-0.01em]">{title}</p>
      {body ? (
        <p className="font-body text-[14px] leading-relaxed opacity-65 mt-2 max-w-xl mx-auto px-6">
          {body}
        </p>
      ) : null}
    </div>
  );
}



/**
 * This decision's time against others', in days, for EC decisions only - the
 * groups appraisal.json publishes are EC-only, so nothing else is compared.
 */
function AppraisalComparison({ c }: { c: NonNullable<ProposalBundle["appraisalContext"]> }) {
  const rows = [
    c.sector ? { label: `${c.sector.name} proposals`, d: c.sector } : null,
    c.state ? { label: `proposals filed in ${titleCase(c.state.name)}`, d: c.state } : null,
    c.national ? { label: "proposals across India", d: c.national } : null,
  ].filter((r): r is { label: string; d: { n: number; p25: number; median: number; p75: number } } => r !== null);
  if (!rows.length) return null;
  return (
    <p className="font-body text-[13.5px] leading-relaxed opacity-80 max-w-3xl -mt-4 mb-10">
      This environmental clearance was decided in{" "}
      <strong>{nf.format(c.days)} days</strong>. For comparison, the middle
      half of environmental clearance decisions took{" "}
      {rows.map((r, i) => (
        <span key={r.label}>
          {i > 0 ? (i === rows.length - 1 ? " and " : ", ") : ""}
          {nf.format(r.d.p25)} to {nf.format(r.d.p75)} days for {r.label} (a
          median of {nf.format(r.d.median)} days across {nf.format(r.d.n)}{" "}
          decisions)
        </span>
      ))}
      . Each duration runs from first filing to decision and leaves out any
      time the portal had the proposal delisted.
    </p>
  );
}
