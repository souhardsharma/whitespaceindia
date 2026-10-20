"use client";

/**
 * How long this proposal has been with the authority, and what happened.
 *
 * WHAT THE TRACK ENCODES
 * ----------------------
 * One proposal, from its first recorded filing to its decision - or to today,
 * where it has not been decided. The arithmetic the register publishes is
 * `fon + dtd + dsu == don`, and the track is drawn to that identity rather
 * than to a separate calculation, so what a reader measures off the bar is the
 * same number the data states.
 *
 * THE DELISTED INTERVAL IS DRAWN DIFFERENTLY, ON PURPOSE
 * -----------------------------------------------------
 * 13% of decided proposals were auto-delisted mid-flight and revived. Nothing
 * is pending with the authority during that interval, so it is excluded from
 * the time to decision - and if it were drawn in the same fill as the rest,
 * the bar would say the case took longer than the register says it did.
 * It is a hatch: present, measurable, and visibly not the same thing.
 *
 * WHY NOT A STAGE-BY-STAGE TRACK
 * ------------------------------
 * Because the per-proposal data does not carry per-stage durations. The
 * appraisal file publishes phase spans as an AGGREGATE over the register, not
 * for each proposal, and drawing a stage breakdown here would mean inventing
 * boundaries the record does not contain. What each proposal does carry -
 * first filing, decision, days delisted, rounds of queries, and the step it
 * currently sits at - is what is drawn.
 */

import { RAMP } from "@/lib/instruments/choropleth";

const INK = "#1c1c19";

interface Props {
  /** First filing from the appraisal history, ISO date. */
  filedOn: string | null;
  /** Decision date, ISO. Null while the proposal is still open. */
  decidedOn: string | null;
  /** Days from first filing to decision, excluding days delisted. */
  daysToDecision: number | null;
  /** Days open, for a proposal not yet decided. */
  daysPending: number | null;
  /** Days the portal had the proposal delisted. */
  daysSuspended: number | null;
  /** Rounds of Essential or Additional Details sought. */
  queryRounds: number | null;
  /** Canonical key of the step it currently sits at. */
  currentStage: string | null;
  /** Human label for that step, from the stage registry. */
  currentStageLabel?: string | null;
}

const fmtDate = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }).format(new Date(iso))
    : null;

export default function AppraisalTimeline({
  filedOn,
  decidedOn,
  daysToDecision,
  daysPending,
  daysSuspended,
  queryRounds,
  currentStage,
  currentStageLabel,
}: Props) {
  const suspended = daysSuspended ?? 0;
  const active = daysToDecision ?? daysPending ?? null;

  if (!filedOn || active === null) {
    return (
      <div className="border border-dashed border-[#1c1c19]/30 p-4">
        <p className="font-body text-[13px] leading-relaxed opacity-70">
          {filedOn
            ? "This proposal carries a filing date but no decision and no open " +
              "interval that can be measured, so no duration is drawn. A " +
              "duration that cannot be reached from the dates beside it is " +
              "not published."
            : "This instrument holds no dated first step for this proposal, " +
              "so no duration is shown. That is a gap in what it holds, not " +
              "evidence about how the proposal was handled."}
        </p>
      </div>
    );
  }

  const total = active + suspended;
  // A proposal filed and decided on the same day has active 0 and suspended 0.
  // That is a real and interesting case - 85 of them in the register - and it
  // used to fall through the `total > 0` guard to 100%, drawing the longest
  // bar on the page directly beside the printed "0 days". The picture and the
  // number said opposite things, and the picture is the one a reader believes.
  // Zero gets a stub: visible, obviously minimal, and impossible to confuse
  // with a full track.
  const sameDay = total === 0;
  const activePct = sameDay ? 0 : (active / total) * 100;
  const suspendedPct = sameDay ? 0 : 100 - activePct;
  const decided = decidedOn !== null;

  const label =
    `Filed ${fmtDate(filedOn)}. ` +
    (sameDay && decided
      ? `Decided the same day, 0 days with the authority`
      : decided
      ? `Decided ${fmtDate(decidedOn)}, ${active} days with the authority`
      : `Open ${active} days`) +
    (suspended > 0 ? `, plus ${suspended} days delisted` : "") +
    (queryRounds ? `. ${queryRounds} round${queryRounds === 1 ? "" : "s"} of queries` : "");

  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h3 className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75">
          Time with the authority
        </h3>
        <span className="font-label text-[19px] font-bold tabular-nums leading-none">
          {active}
          <span className="text-[11px] font-medium opacity-70 ml-1">
            day{active === 1 ? "" : "s"}
          </span>
        </span>
      </div>

      <div role="img" aria-label={label}>
        <svg width="100%" height="16" style={{ display: "block" }}>
          <defs>
            <pattern
              id="delisted-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="#e8e4dd" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#b9b2a6" strokeWidth="1.4" />
            </pattern>
          </defs>
          {/* Time actually with the authority. A same-day decision gets a 4px
              stub rather than a proportion of nothing. */}
          <rect
            x="0"
            y="3"
            width={sameDay ? "4" : `${activePct}%`}
            height="10"
            fill={decided ? RAMP[3] : RAMP[1]}
            rx="0"
          />
          {suspendedPct > 0 ? (
            <>
              {/* A 2px surface gap, so the two intervals read as separate
                  things rather than one continuous bar. */}
              <rect
                x={`${activePct}%`}
                y="3"
                width="2"
                height="10"
                fill="#fcf9f4"
              />
              <rect
                x={`calc(${activePct}% + 2px)`}
                y="3"
                width={`calc(${suspendedPct}% - 2px)`}
                height="10"
                fill="url(#delisted-hatch)"
              />
            </>
          ) : null}
          {decided ? (
            // The decision tick sits at the end of the track - which for a
            // same-day decision is the end of the stub, not the far right.
            <rect
              x={sameDay ? "4" : "calc(100% - 2px)"}
              y="0"
              width="2"
              height="16"
              fill={INK}
            />
          ) : null}
        </svg>
      </div>

      <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 mt-2">
        <span className="font-body text-[12px] opacity-70">
          Filed {fmtDate(filedOn)}
        </span>
        <span className="font-body text-[12px] opacity-70">
          {decided
            ? `Decided ${fmtDate(decidedOn)}`
            : currentStageLabel || currentStage
            ? `Now at: ${currentStageLabel ?? currentStage}`
            : "Not yet decided"}
        </span>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-2 mt-3">
        {suspended > 0 ? (
          <div>
            <dt className="font-label text-[9px] uppercase tracking-[0.16em] opacity-70">
              Delisted by the portal, then revived
            </dt>
            <dd className="font-body text-[13px] tabular-nums">
              {suspended} day{suspended === 1 ? "" : "s"}
            </dd>
            {/* "Delisted" on its own reads as struck off for good, which is
                the opposite of what happened: the portal dropped the proposal
                automatically and it was later restored. Said plainly, because
                a reader could otherwise report that a live proposal had been
                thrown out. */}
            <dd className="font-body text-[11.5px] leading-relaxed opacity-70 max-w-[34ch] mt-1">
              Not counted above: nothing was pending with the authority while
              the proposal was off the portal.
            </dd>
          </div>
        ) : null}
        {queryRounds ? (
          <div>
            <dt className="font-label text-[9px] uppercase tracking-[0.16em] opacity-70">
              Rounds of queries
            </dt>
            <dd className="font-body text-[13px] tabular-nums">{queryRounds}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
