import { notFound } from "next/navigation";
import {
  InstrumentFooter,
  InstrumentHeader,
} from "@/components/instruments/InstrumentChrome";
import ProjectProfile from "@/components/instruments/ProjectProfile";
import NearbyProposals from "@/components/instruments/NearbyProposals";
import RecentActivity from "@/components/instruments/RecentActivity";
import StructuredData from "@/components/instruments/StructuredData";
import { pageLd, pageMeta } from "@/lib/instruments/metadata";
import { findProposal, proposalBundle, districts } from "@/lib/instruments/server";
import { stageLabel } from "@/lib/instruments/projects";
import { presentState } from "@/lib/instruments/place";
import meta from "@/public/data/instruments/consent/meta.json";
import stagesFile from "@/public/data/instruments/consent/stages.json";
import type { InstrumentMeta } from "@/lib/instruments/types";

/**
 * One proposal's profile, rendered on the server.
 *
 * There are ~91,000 proposals, so no page is built ahead of time. The first
 * request for a proposal renders it on the server from the published data and
 * the result is cached for a day - the register is read nightly, and a deploy
 * replaces the cache with the new data. An unknown id is a real 404.
 *
 * The page used to be rendered in the browser from 9.6 to 18 MB of JSON, and
 * sent "Loading the profile…" to anything without JavaScript - which is every
 * crawler, so no proposal could be found by searching for it. It is now
 * indexable where it has a place to describe; see generateMetadata.
 */

export const revalidate = 86400;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(
    (stagesFile as { statuses?: Record<string, { label?: string }> }).statuses ?? {},
  ).map(([k, v]) => [k, String(v?.label ?? k)]),
);

const INSTRUMENTS_TRAIL = { name: "Instruments", path: "/instruments" };
const CONSENT_TRAIL = { name: "People & Consent", path: "/instruments/consent" };

function shortName(name: string): string {
  // On a word boundary: these names run to hundreds of characters and a
  // mid-word cut reads as corruption.
  return name.length > 90 ? name.slice(0, 87).replace(/\s+\S*$/, "") + "…" : name;
}

export async function generateMetadata({ params }: { params: { proposalId: string } }) {
  const id = decodeURIComponent(params.proposalId);
  const found = findProposal(id);
  if (!found) {
    return pageMeta({
      path: `/instruments/consent/${encodeURIComponent(params.proposalId)}`,
      title: "Proposal not found — People & Consent",
      description: "No proposal with this number is in the register this instrument holds.",
      index: false,
    });
  }
  const p = found.project;
  const where = p.district != null ? districts()[String(p.district)] : null;
  const stage = stageLabel(p.appraisal?.statusKey, p.status, STAGE_LABELS);
  const description = [
    p.agency,
    p.sector,
    p.no,
    where ? `${where.district_name}, ${presentState(where.censuscode, where.state_name)}` : null,
    stage,
  ].filter(Boolean).join(" · ") +
    ". Who lives where this project would be built, and the consent obligations that attach.";
  return pageMeta({
    path: `/instruments/consent/${p.id}`,
    title: `${shortName(p.name || `Proposal ${p.no}`)} — People & Consent`,
    description,
    // Indexed where the page has a place to describe. A proposal that could
    // not be placed below state level carries no profile, so its page is thin
    // and is left out of search engines while staying followable.
    index: p.district != null,
  });
}

export default function ProposalPage({ params }: { params: { proposalId: string } }) {
  const id = decodeURIComponent(params.proposalId);
  const bundle = proposalBundle(id);
  if (!bundle) notFound();
  const p = bundle.project;

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData
        data={pageLd({
          path: `/instruments/consent/${p.id}`,
          name: p.name || `Proposal ${p.no}`,
          description: `${p.agency || "Proponent not recorded"} · ${p.sector} · ${p.no}`,
          trail: [INSTRUMENTS_TRAIL, CONSENT_TRAIL],
        })}
      />
      <InstrumentHeader crumb="People & Consent" crumbHref="/instruments/consent" />
      <main id="main-content" className="flex-1 px-6 md:px-12 py-10 md:py-14">
        <div className="max-w-6xl mx-auto">
          <ProjectProfile bundle={bundle} meta={meta as unknown as InstrumentMeta} />
          <RecentActivity proposalId={p.id} limit={30} />
          <NearbyProposals
            nearby={bundle.nearby}
            hasSite={p.site?.lat != null}
            labels={STAGE_LABELS}
          />
        </div>
      </main>
      <InstrumentFooter />
    </div>
  );
}
