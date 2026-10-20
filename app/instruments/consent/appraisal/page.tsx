import Link from "next/link";
import StructuredData from "@/components/instruments/StructuredData";
import { pageMeta, pageLd } from "@/lib/instruments/metadata";
import {
  InstrumentFooter,
  InstrumentHeader,
  PLUM,
} from "@/components/instruments/InstrumentChrome";
import DurationDistribution, {
  type Distribution,
} from "@/components/instruments/DurationDistribution";
import appraisal from "@/public/data/instruments/consent/appraisal.json";
import meta from "@/public/data/instruments/consent/meta.json";

export const metadata = pageMeta({
  path: "/instruments/consent/appraisal",
  title: "How long clearance takes — People & Consent",
  description:
    "How long India's environmental clearances take, from first filing to decision, by sector, phase and outcome, measured from each proposal's appraisal history.",
});

const nf = new Intl.NumberFormat("en-IN");

const INSTRUMENTS_TRAIL = { name: "Instruments", path: "/instruments" };
const CONSENT_TRAIL = { name: "People & Consent", path: "/instruments/consent" };


/** The published register total, joined rather than typed. */
const REGISTER_TOTAL = (meta as { counts?: { proposals_published?: number } })
  .counts?.proposals_published ?? 0;

interface Group {
  n: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max?: number;
}

export default function AppraisalPage() {
  const a = appraisal as unknown as {
    minGroup: number;
    coverage: {
      proposals_summarised: number;
      with_duration: number;
      pending: number;
      /** Ended without a decision: returned, withdrawn or pulled back. */
      closed_without_decision?: number;
      decision_step_unmatched: number;
      suspended: { proposals: number; of_decided: number; days_excluded: number };
    };
    national: {
      environmentalClearance: Group;
      byDecision: Record<string, Group>;
    };
    byPhase: {
      note: string;
      overlapping_proposals: number;
      of_decided: number;
      phases: Record<string, Group>;
    };
    environmentalClearance: { bySector: Record<string, Group> };
    registry: Record<string, { label: string; definition: string; unit: string }>;
  };

  const ec = a.national.environmentalClearance;
  const bySector = Object.entries(a.environmentalClearance.bySector)
    .map(([label, d]) => ({ label, d: d as Distribution }))
    .sort((x, y) => y.d.median - x.d.median);
  const byPhase = Object.entries(a.byPhase.phases)
    .map(([label, d]) => ({
      label: label.charAt(0).toUpperCase() + label.slice(1),
      d: d as Distribution,
    }))
    .sort((x, y) => y.d.median - x.d.median);
  const byDecision = Object.entries(a.national.byDecision)
    .map(([label, d]) => ({
      label:
        label === "ec"
          ? "Environmental clearance"
          : label === "tor"
          ? "Terms of Reference"
          : label === "form9"
          ? "Form 9"
          : label,
      d: d as Distribution,
    }))
    .sort((x, y) => y.d.median - x.d.median);

  // ONE scale across all three charts on this page.
  //
  // DurationDistribution shares a scale across the rows it is given, which is
  // the guard that stops a 60-day median and a 600-day median drawing the same
  // mark. Applied per chart and not between them, it produced exactly the
  // failure it exists to prevent: the three sections fell back to their own
  // p90 ceilings - 329, 352 and 215 days, a 1.63x spread - so the "closed"
  // phase at a 64-day median drew its tick FURTHER RIGHT than "INFRA-1" at
  // 102 days one section above. Three charts of identical form stacked on one
  // page are an invitation to compare mark positions, and the positions were
  // encoding three different day-per-pixel rates.
  const spans = [...byDecision, ...bySector, ...byPhase]
    .filter((r) => r.d && r.d.n >= a.minGroup)
    .map((r) => r.d.p90 ?? r.d.median)
    .filter((v) => Number.isFinite(v));
  const scaleMax = spans.length > 0 ? Math.max(...spans) * 1.05 : undefined;

  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <StructuredData data={pageLd({ path: "/instruments/consent/appraisal", name: "How long clearance takes", description: metadata.description as string, trail: [INSTRUMENTS_TRAIL, CONSENT_TRAIL] })} />
      <InstrumentHeader crumb="People & Consent" crumbHref="/instruments/consent" />

      <main id="main-content" className="flex-1">
        <section className="px-6 md:px-12 pt-14 md:pt-18 pb-8 border-b border-[#1c1c19]">
          <div className="max-w-6xl mx-auto">
            <p
              className="font-label text-[11px] uppercase tracking-[0.24em] mb-4"
              style={{ color: PLUM }}
            >
              Time to decision
            </p>
            <h1 className="font-headline font-bold text-[clamp(28px,4.6vw,52px)] leading-[1.04] tracking-[-0.03em] max-w-4xl">
              How long clearance takes
            </h1>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-12 gap-8">
              <p className="md:col-span-7 font-body text-[15px] leading-relaxed opacity-80">
                Measured from the first step in the proposal&rsquo;s own
                appraisal history to the step at which the authority granted or
                refused what was applied for. Not from the register&rsquo;s
                submission date, which moves forward when a proposal is
                re-submitted and disagrees with the history for a third of the
                register.
              </p>
              <p className="md:col-span-5 font-body text-[13.5px] leading-relaxed opacity-70">
                Days on which the portal had a proposal delisted are subtracted:
                nothing is pending with the authority during them. Across the
                register that is{" "}
                {nf.format(a.coverage.suspended.days_excluded)} days, over{" "}
                {nf.format(a.coverage.suspended.proposals)} proposals.
              </p>
            </div>

            {/* These three describe ENVIRONMENTAL CLEARANCE decisions only -
                45,487 of the 57,303 decided proposals measured. Labelled
                "Decided proposals measured" and "Median days to decision",
                they read as register-wide, and "the median clearance decision
                takes 135 days" is a sentence a reader would publish from
                them. A Terms of Reference decision is a different question
                with different work behind it; the two are kept apart in the
                data and must be kept apart in the labels. */}
            <dl className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-6">
              <Stat
                label="Environmental clearances measured"
                value={nf.format(ec.n)}
              />
              <Stat
                label="Median days, environmental clearance"
                value={String(ec.median)}
              />
              <Stat
                label="Middle half, environmental clearance"
                value={`${ec.p25}–${ec.p75} days`}
              />
              <Stat
                label="All decided proposals measured"
                value={nf.format(a.coverage.with_duration)}
              />
            </dl>

            {/* finding: the page stated its method exhaustively and its
                coverage nowhere. Both figures below are read from the data. */}
            <p className="font-body text-[13px] leading-relaxed opacity-65 mt-6 max-w-3xl">
              These figures cover the{" "}
              {nf.format(a.coverage.proposals_summarised)} proposals for which
              this instrument holds a dated appraisal history &mdash;{" "}
              {((a.coverage.proposals_summarised / REGISTER_TOTAL) * 100).toFixed(0)}%
              of the register. Of those, {nf.format(a.coverage.with_duration)}{" "}
              have been decided, {nf.format(a.coverage.pending)} are still
              open, and {nf.format(a.coverage.closed_without_decision ?? 0)}{" "}
              closed without a decision &mdash; returned in their present form,
              withdrawn, or pulled back by the proponent &mdash; so they have
              no duration to a decision and are not waiting for one. Proposals
              without a dated history are not counted here, and they are
              overwhelmingly older filings.
            </p>
          </div>
        </section>

        <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]/20">
          <div className="max-w-6xl mx-auto">
            <h2 className="font-headline text-[26px] leading-tight mb-2">
              By what was decided
            </h2>
            <p className="font-body text-[13.5px] leading-relaxed opacity-70 max-w-3xl mb-6">
              A Terms of Reference decision and an environmental clearance are
              different questions with different work behind them, and blending
              them produces a figure that describes neither. They are kept
              apart.
            </p>
            <DurationDistribution
              rows={byDecision}
              minGroup={a.minGroup}
              scaleMax={scaleMax}
            />
          </div>
        </section>

        <section className="px-6 md:px-12 py-12 border-b border-[#1c1c19]/20">
          <div className="max-w-6xl mx-auto">
            <h2 className="font-headline text-[26px] leading-tight mb-2">
              By sector
            </h2>
            <p className="font-body text-[13.5px] leading-relaxed opacity-70 max-w-3xl mb-6">
              Environmental clearance only, so the comparison is like for like.
            </p>
            <DurationDistribution
              rows={bySector}
              minGroup={a.minGroup}
              scaleMax={scaleMax}
            />
          </div>
        </section>

        <section className="px-6 md:px-12 py-12">
          <div className="max-w-6xl mx-auto">
            <h2 className="font-headline text-[26px] leading-tight mb-2">
              By phase
            </h2>
            <p className="font-body text-[13.5px] leading-relaxed opacity-70 max-w-3xl mb-6">
              {a.byPhase.note} {nf.format(a.byPhase.overlapping_proposals)} of{" "}
              {nf.format(a.byPhase.of_decided)} decided proposals have at least
              two phases running at once, so reading these as consecutive
              stages of one timeline would overstate the total.
            </p>
            <DurationDistribution
              rows={byPhase}
              minGroup={a.minGroup}
              scaleMax={scaleMax}
            />

            <div className="mt-10 pt-6 border-t border-[#1c1c19]/20 max-w-3xl space-y-3">
              {Object.values(a.registry)
                .filter((r) => r.unit === "days")
                .slice(0, 3)
                .map((r) => (
                  <p
                    key={r.label}
                    className="font-body text-[13px] leading-relaxed opacity-70"
                  >
                    <span className="font-label text-[10px] uppercase tracking-[0.16em] opacity-70 mr-2">
                      {r.label}
                    </span>
                    {r.definition}
                  </p>
                ))}
              <p className="font-body text-[13px] leading-relaxed opacity-70">
                No distribution is published for a group below {a.minGroup}{" "}
                decided proposals.{" "}
                <Link
                  href="/instruments/consent/methodology"
                  className="underline underline-offset-2"
                  style={{ color: PLUM }}
                >
                  How this is measured
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>

      <InstrumentFooter />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-label text-[9px] uppercase tracking-[0.2em] opacity-70 leading-snug">
        {label}
      </dt>
      <dd
        className="font-label text-[26px] font-bold tabular-nums leading-none mt-1"
        style={{ color: PLUM }}
      >
        {value}
      </dd>
    </div>
  );
}
