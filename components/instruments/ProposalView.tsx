"use client";

/**
 * One proposal's page, assembled in the browser.
 *
 * Every /instruments/consent/<id> is answered by the same static file
 * (app/instruments/consent/view, through a rewrite in next.config.mjs), and
 * this reads the id from the address and loads the proposal from the static
 * files lib/instruments/bundle.ts describes. No request for a proposal runs a
 * function: on the Hobby plan, rendering ~92,000 of them on demand for
 * crawlers is what used up the month's origin transfer and paused the site.
 *
 * The page's title, description, canonical URL and robots rule are set here
 * once the proposal is known, because the static file is shared by all of
 * them. Search engines that render JavaScript read them as before; a proposal
 * that could not be placed below state level stays out of their index.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import ProjectProfile from "./ProjectProfile";
import NearbyProposals from "./NearbyProposals";
import ActivityList from "./ActivityList";
import StructuredData from "./StructuredData";
import { loadProposal, type ProposalView as View, type ReadJson } from "@/lib/instruments/bundle";
import { pageLd } from "@/lib/instruments/metadata";
import { stageLabel } from "@/lib/instruments/projects";
import { presentState } from "@/lib/instruments/place";
import { SITE_URL } from "@/lib/site";
import meta from "@/public/data/instruments/consent/meta.json";
import stagesFile from "@/public/data/instruments/consent/stages.json";
import type { InstrumentMeta } from "@/lib/instruments/types";

const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(
    (stagesFile as { statuses?: Record<string, { label?: string }> }).statuses ?? {},
  ).map(([k, v]) => [k, String(v?.label ?? k)]),
);

const INSTRUMENTS_TRAIL = { name: "Instruments", path: "/instruments" };
const CONSENT_TRAIL = { name: "People & Consent", path: "/instruments/consent" };
const STEPS_SHOWN = 30;

type State =
  | { phase: "loading" }
  | { phase: "missing"; id: string }
  | { phase: "failed"; id: string }
  | { phase: "ready"; view: View };

const read: ReadJson = async <T,>(path: string) => {
  const res = await fetch(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
};

function idFromPath(pathname: string): string {
  return /^\/instruments\/consent\/([^/]+)\/?$/.exec(pathname)?.[1] ?? "";
}

function shortName(name: string): string {
  // On a word boundary: these names run to hundreds of characters and a
  // mid-word cut reads as corruption.
  return name.length > 90 ? name.slice(0, 87).replace(/\s+\S*$/, "") + "…" : name;
}

interface Head { title: string; description: string; path: string; index: boolean }

function headFor(view: View): Head {
  const { project: p, district: where } = view.bundle;
  const stage = stageLabel(p.appraisal?.statusKey, p.status, STAGE_LABELS);
  const description = [
    p.agency,
    p.sector,
    p.no,
    where ? `${where.district_name}, ${presentState(where.censuscode, where.state_name)}` : null,
    stage,
  ].filter(Boolean).join(" · ") +
    ". The page reports who lives where this project would be built and which duties of consultation and consent apply there.";
  return {
    path: `/instruments/consent/${p.id}`,
    title: `${shortName(p.name || `Proposal ${p.no}`)} | People & Consent`,
    description,
    // Indexed where the page has a place to describe. A proposal that could
    // not be placed below state level carries no profile, so its page is thin
    // and is left out of search engines while staying followable.
    index: p.district != null,
  };
}

function missingHead(id: string): Head {
  return {
    path: `/instruments/consent/${encodeURIComponent(id)}`,
    title: "Proposal not found | People & Consent",
    description: "This proposal number is not in the copy of the environmental clearance register that People & Consent holds.",
    index: false,
  };
}

/** Sets the document's head for this proposal; returns what undoes it. */
function applyHead(head: Head): () => void {
  const previousTitle = document.title;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  const previousDescription = description?.content;
  document.title = head.title;
  if (description) description.content = head.description;
  // The layouts already write "index, follow"; a second robots tag would
  // leave the page saying both, so the one there is rewritten instead.
  const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  const previousRobots = robots?.content;
  const added: HTMLElement[] = [];
  const canonical = document.createElement("link");
  canonical.rel = "canonical";
  canonical.href = `${SITE_URL}${head.path}`;
  added.push(canonical);
  if (!head.index && robots) robots.content = "noindex, follow";
  if (!head.index && !robots) {
    const noindex = document.createElement("meta");
    noindex.name = "robots";
    noindex.content = "noindex, follow";
    added.push(noindex);
  }
  for (const el of added) document.head.appendChild(el);
  return () => {
    document.title = previousTitle;
    if (description && previousDescription != null) description.content = previousDescription;
    if (robots && previousRobots != null) robots.content = previousRobots;
    for (const el of added) el.remove();
  };
}

export default function ProposalView() {
  // The address, not the rewritten file, names the proposal; the pathname is
  // a dependency so moving between proposals in the app reloads.
  const pathname = usePathname();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const id = idFromPath(window.location.pathname);
    let live = true;
    let undoHead: (() => void) | null = null;
    setState({ phase: "loading" });
    loadProposal(id, read, stagesFile)
      .then((view) => {
        if (!live) return;
        undoHead = applyHead(view ? headFor(view) : missingHead(id));
        setState(view ? { phase: "ready", view } : { phase: "missing", id });
      })
      .catch(() => {
        if (live) setState({ phase: "failed", id });
      });
    return () => {
      live = false;
      undoHead?.();
    };
  }, [pathname, attempt]);

  if (state.phase === "loading") {
    return (
      <>
        <p className="font-body text-[14px] opacity-70" role="status">Reading the proposal…</p>
        <noscript>
          <p className="font-body text-[14px] mt-4 max-w-2xl">
            This profile is assembled in your browser, so it needs JavaScript. The
            register it is built from can be downloaded from the{" "}
            <a href="/instruments/consent/data" className="underline underline-offset-2">data page</a>.
          </p>
        </noscript>
      </>
    );
  }
  if (state.phase === "missing") {
    return (
      <section className="max-w-2xl">
        <h1 className="font-headline font-bold text-[clamp(28px,4vw,44px)] tracking-[-0.02em] mb-3">
          Proposal not found
        </h1>
        <p className="font-body text-[15px] leading-relaxed opacity-80">
          The copy of the environmental clearance register that People &amp; Consent
          holds has no proposal numbered {state.id || "like this"}. It may have been
          delisted since, or the address may be mistyped.{" "}
          <Link href="/instruments/consent" className="underline underline-offset-2">Search the register</Link>.
        </p>
      </section>
    );
  }
  if (state.phase === "failed") {
    return (
      <section className="max-w-2xl" role="alert">
        <p className="font-body text-[15px] leading-relaxed">
          This proposal could not be loaded. The connection may have dropped.
        </p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="mt-3 font-label text-[11px] uppercase tracking-[0.16em] underline underline-offset-2"
        >
          Try again
        </button>
      </section>
    );
  }

  const { bundle, steps, changes } = state.view;
  const p = bundle.project;
  return (
    <>
      <StructuredData
        data={pageLd({
          path: `/instruments/consent/${p.id}`,
          name: p.name || `Proposal ${p.no}`,
          description: `${p.agency || "Proponent not recorded"} · ${p.sector} · ${p.no}`,
          trail: [INSTRUMENTS_TRAIL, CONSENT_TRAIL],
        })}
      />
      <ProjectProfile bundle={bundle} meta={meta as unknown as InstrumentMeta} />
      {changes ? (
        <ActivityList
          proposalId={p.id}
          events={steps.slice(0, STEPS_SHOWN).map(([kind, date, sk]) => ({
            kind, date, sk, proposal: { id: p.id, name: p.name },
          }))}
          total={steps.length}
          window={changes.window}
          basis={changes.basis}
        />
      ) : null}
      <NearbyProposals nearby={bundle.nearby} hasSite={p.site?.lat != null} labels={STAGE_LABELS} />
    </>
  );
}
