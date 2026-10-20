/**
 * Recent movement in the register for one district or one proposal.
 *
 * Server-rendered from the change log (scripts/instruments/build_changes.py),
 * so it is dated by the regulator's own appraisal history. For a district the
 * newest events among every proposal that names it; for a proposal, its own
 * steps inside the log's window.
 */
import Link from "next/link";
import { changes, changesFile, type ChangeKind } from "@/lib/instruments/server";
import stagesFile from "@/public/data/instruments/consent/stages.json";
import { PLUM } from "./InstrumentChrome";

const LABELS: Record<string, string> = Object.fromEntries(
  Object.entries((stagesFile as { statuses?: Record<string, { label?: string }> }).statuses ?? {})
    .map(([k, v]) => [k, String(v?.label ?? k)]),
);
const KIND: Record<ChangeKind, string> = {
  filed: "Filed", query: "Details sought", moved: "Moved", decided: "Decided", closed: "Closed",
};

function fmt(d: string): string {
  return new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
}

export default function RecentActivity({
  district,
  proposalId,
  limit = 12,
}: {
  district?: number;
  proposalId?: string;
  limit?: number;
}) {
  const file = changesFile();
  if (!file) return null;
  const forProposal = proposalId != null;
  const { events, total } = changes({
    district: district ?? null,
    ids: forProposal ? new Set([proposalId]) : undefined,
    kinds: forProposal ? ["filed", "query", "moved", "decided", "closed"]
                       : ["filed", "query", "decided", "closed"],
    since: file.window.from,
    limit,
  });
  return (
    <section className="mt-10 mb-4" aria-labelledby={`activity-${district ?? proposalId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <h2
          id={`activity-${district ?? proposalId}`}
          className="font-headline font-bold text-[clamp(20px,2.4vw,28px)] tracking-[-0.02em]"
        >
          {forProposal ? "Its recent steps" : "Recent activity"}
        </h2>
        {!forProposal && district != null ? (
          <Link
            href={`/instruments/consent/latest?district=${district}&days=60`}
            className="font-label text-[10px] uppercase tracking-[0.16em] underline underline-offset-2"
          >
            All {total} in the last {file.window.days} days
          </Link>
        ) : null}
      </div>
      {events.length === 0 ? (
        <p className="font-body text-[13.5px] opacity-70">
          {forProposal
            ? `No step of this proposal is recorded between ${fmt(file.window.from)} and ${fmt(file.window.to)}.`
            : `Nothing filed, queried, decided or closed here between ${fmt(file.window.from)} and ${fmt(file.window.to)}.`}
        </p>
      ) : (
        <ol className="border-t border-[#1c1c19]/25">
          {events.map((e, i) => (
            <li key={`${e.proposal.id}-${e.kind}-${e.sk}-${e.date}-${i}`}
                className="border-b border-[#1c1c19]/10 py-2 grid grid-cols-1 md:grid-cols-12 gap-2 font-body text-[13px]">
              <span className="md:col-span-3 font-label text-[10.5px] uppercase tracking-[0.12em]">
                {fmt(e.date)} ·{" "}
                <span style={{ color: e.kind === "decided" ? PLUM : undefined }}>{KIND[e.kind]}</span>
              </span>
              <span className="md:col-span-4">{LABELS[e.sk] ?? e.sk}</span>
              <span className="md:col-span-5">
                {forProposal ? null : (
                  <Link href={`/instruments/consent/${e.proposal.id}`} className="underline underline-offset-2 break-words">
                    {e.proposal.name.length > 110 ? e.proposal.name.slice(0, 107).replace(/\s+\S*$/, "") + "…" : e.proposal.name}
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="font-body text-[11.5px] opacity-75 mt-2">{file.basis}</p>
    </section>
  );
}
