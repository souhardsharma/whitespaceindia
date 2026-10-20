"use client";

/**
 * The consent screen.
 *
 * This component carries the instrument's sharpest distinction, and the whole
 * design exists to keep two kinds of statement visually and semantically apart:
 *
 *   A SCREENING INDICATOR is computed from data. "62% of this district's
 *   population was enumerated as Scheduled Tribe in 2011" is a fact about a
 *   Census table. It suggests where to look. It decides nothing.
 *
 *   A LEGAL DETERMINATION is cited to an instrument, with a provision and a
 *   date it was last reviewed. "This block is a Fifth Schedule Scheduled Area
 *   under the Scheduled Areas (States of ...) Order, 2003" is a statement about
 *   the law.
 *
 * A high tribal population share does NOT make a place a Scheduled Area.
 * Scheduled Areas are declared by Presidential Order under paragraph 6 of the
 * Fifth Schedule, and the two do not coincide. Letting a computed proxy render
 * where a determination belongs would be the most consequential error this
 * instrument could make, so the two are drawn differently, labelled
 * differently, and the determination path can always return "not determined".
 *
 * "Not determined" is a real answer here, not a failure state. It means: the
 * curated legal reference does not cover this place, go and read the Order.
 */

import type { Fact } from "@/lib/instruments/types";
import { formatValue } from "@/lib/instruments/facts";
import { PLUM } from "./InstrumentChrome";
import { groupObligations } from "@/lib/instruments/obligations";

export interface LegalDetermination {
  status: "within" | "outside" | "partial" | "not_determined";
  instrument: string;
  provision?: string;
  citation?: string;
  sourceUrl?: string;
  lastReviewed?: string;
  note?: string;
}

export interface Obligation {
  instrument: string;
  provision: string;
  requirement: string;
  trigger: string;
  applies: "yes" | "conditional" | "no" | "not_determined";
  kind: "statutory" | "standard";
  sourceUrl?: string;
  lastReviewed?: string;
  verified?: boolean;
  /**
   * The hand-curated caveat on this obligation, where there is one.
   *
   * It was carried in the source file and in the PDF and dropped here, so the
   * screen and the download disagreed about the same obligation: a reader on
   * the page never saw "treat the position as contested", and a reader of the
   * PDF saw it but no applicability verdict. Each medium was missing what the
   * other had.
   */
  note?: string;
}

export function ConsentScreen({
  indicators,
  determination,
  placeLabel,
  siteSettled,
  governingDistrict,
}: {
  indicators: Fact[];
  determination: LegalDetermination | null;
  /** Sub-division names the Order names wholly that contain this site. */
  siteSettled?: string[];
  placeLabel: string;
  /**
   * The district this determination belongs to, when it is not the one
   * profiled above.
   *
   * A filing naming several districts is answered by the strongest
   * determination among them, because consent is owed wherever the site is
   * scheduled. On 322 proposals that answer comes from a district other than
   * the profiled one, and printing it under the profiled district's name made
   * it look like a statement about a place it is not about.
   */
  governingDistrict?: string | null;
}) {
  return (
    <section className="mb-12" aria-labelledby="consent-heading">
      <h2
        id="consent-heading"
        className="font-headline font-bold text-[clamp(22px,2.6vw,32px)] tracking-[-0.02em] mb-2"
      >
        Consent screening
      </h2>
      <p className="font-body text-[14px] leading-relaxed opacity-70 max-w-3xl mb-7">
        Two different kinds of statement appear below and they are not
        interchangeable. Indicators are computed from the Census. Determinations
        are statements about the law, cited to the instrument that makes them.
        A population share is never, by itself, a legal status.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── computed indicators ── */}
        <div className="border border-[#1c1c19]/25 p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 border border-[#1c1c19]" aria-hidden="true" />
            <h3 className="font-label text-[10px] uppercase tracking-[0.2em]">
              Screening indicators
            </h3>
          </div>
          <p className="font-body text-[12.5px] leading-relaxed opacity-75 mb-4">
            Computed from Census 2011 for {placeLabel}. These describe the
            population. They do not establish any legal status.
          </p>
          <dl className="space-y-3">
            {indicators.map((f) => (
              <div key={f.id} className="flex items-baseline justify-between gap-4">
                <dt className="font-body text-[13.5px] opacity-80">{f.label}</dt>
                <dd className="font-label font-bold text-[16px] tabular-nums shrink-0">
                  {f.value === null ? (
                    <span className="text-[12px] font-medium opacity-65">
                      not recorded
                    </span>
                  ) : (
                    formatValue(f.value, f.unit)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* ── legal determination ── */}
        <div
          className="border-2 p-5"
          style={{ borderColor: PLUM, background: "rgba(122,59,107,0.035)" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className="w-2.5 h-2.5"
              style={{ background: PLUM }}
              aria-hidden="true"
            />
            <h3
              className="font-label text-[10px] uppercase tracking-[0.2em]"
              style={{ color: PLUM }}
            >
              Legal determination
            </h3>
          </div>
          <p className="font-body text-[12.5px] leading-relaxed opacity-75 mb-4">
            Whether this place lies in a Fifth Schedule Scheduled Area, where
            community consent is a legal precondition rather than a consultation
            outcome.
            {governingDistrict ? (
              <>
                {" "}
                This filing names more than one district, and the determination
                below is the strongest of them — it is the determination for{" "}
                <strong>{governingDistrict}</strong>, not for the district
                profiled above. Consent is owed wherever the site is scheduled,
                so the stronger answer governs.
              </>
            ) : null}
          </p>

          {determination === null ? (
            <NotDetermined />
          ) : determination.status === "not_determined" ? (
            <NotDetermined note={determination.note} />
          ) : (
            <div>
              <p className="font-headline text-[19px] leading-snug mb-3">
                {determination.status === "within"
                  ? "Within a Fifth Schedule Scheduled Area"
                  : determination.status === "partial"
                  ? "Partly within a Fifth Schedule Scheduled Area"
                  : determination.status === "outside"
                  ? "Outside every Fifth Schedule Scheduled Area"
                  : /* An unrecognised status is a gap, not an answer. Reaching
                       "Not within" through an else meant any future status the
                       renderer did not know about would be published as a
                       negative determination. */
                    "Not determined"}
              </p>
              {determination.status === "outside" ? (
                <p className="font-body text-[13px] leading-relaxed opacity-75 mb-3">
                  This is a determination, not a gap: no Presidential Order
                  under paragraph 6 of the Fifth Schedule reaches this
                  district. The duties that turn on Scheduled Area status
                  therefore do not attach here &mdash; consultation with the
                  Gram Sabha under PESA s.4(i), its mandatory recommendation
                  for minor minerals under s.4(k) and s.4(l), and consent
                  under RFCTLARR s.41(3). Consent is RFCTLARR&rsquo;s
                  requirement; PESA&rsquo;s is consultation, and the two are
                  not the same duty. Other protections may still apply.
                </p>
              ) : null}
              {determination.status === "partial" && siteSettled?.length ? (
                <p className="font-body text-[13px] leading-relaxed opacity-75 mb-3">
                  The Order covers only part of this district — but it names{" "}
                  <strong>{siteSettled.join(", ")}</strong> in whole, and this
                  filing places the project there. On the face of the Order,
                  this site is inside the Scheduled Area.
                </p>
              ) : determination.status === "partial" ? (
                <p className="font-body text-[13px] leading-relaxed opacity-75 mb-3">
                  The Order covers only part of this district. Whether this
                  particular site falls inside it cannot be settled at district
                  level — check the blocks and villages the Order names. A
                  sub-division the Order reaches through a revenue circle or a
                  named village will not appear here, so this is not a finding
                  that the site is outside.
                </p>
              ) : null}
              <Citation d={determination} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function NotDetermined({ note }: { note?: string }) {
  return (
    <div>
      <p className="font-headline text-[19px] leading-snug mb-3">Not determined</p>
      <p className="font-body text-[13px] leading-relaxed opacity-75">
        {note ||
          "The curated legal reference does not cover this place. Scheduled Areas " +
            "are declared by Presidential Order under paragraph 6 of the Fifth " +
            "Schedule to the Constitution, and there is no machine-readable " +
            "authoritative list of them. Verify against the Order for this state " +
            "before relying on any answer."}
      </p>
      <p className="font-body text-[13px] leading-relaxed opacity-75 mt-3">
        This instrument will not infer the answer from the tribal population
        share. The two do not coincide, and treating one as the other is the
        error this panel exists to prevent.
      </p>
    </div>
  );
}

function Citation({ d }: { d: LegalDetermination }) {
  return (
    <dl className="font-body text-[12.5px] leading-relaxed space-y-1.5 border-t border-[#1c1c19]/15 pt-3">
      <div>
        <dt className="inline font-label text-[9px] uppercase tracking-[0.18em] opacity-70 mr-2">
          Instrument
        </dt>
        <dd className="inline">{d.instrument}</dd>
      </div>
      {d.provision ? (
        <div>
          <dt className="inline font-label text-[9px] uppercase tracking-[0.18em] opacity-70 mr-2">
            Provision
          </dt>
          <dd className="inline">{d.provision}</dd>
        </div>
      ) : null}
      {d.citation ? (
        <div>
          <dt className="inline font-label text-[9px] uppercase tracking-[0.18em] opacity-70 mr-2">
            Citation
          </dt>
          <dd className="inline">{d.citation}</dd>
        </div>
      ) : null}
      {/* The determination's OWN note, which carries the reason and - for the
          515 districts outside every Order - the protection that DOES apply
          instead: Article 371A in Nagaland, 371C in Manipur, the Sixth
          Schedule council in Karbi Anglong, ANPATR in the Andamans. This
          component rendered instrument, provision, citation, review date and
          source link, and dropped the note; the PDF export rendered it. The
          screen and the artefact a reader takes away were stating different
          things about the same district. */}
      {d.note ? (
        <div>
          <dt className="inline font-label text-[9px] uppercase tracking-[0.18em] opacity-70 mr-2">
            Basis
          </dt>
          <dd className="inline">{d.note}</dd>
        </div>
      ) : null}
      {d.lastReviewed ? (
        <div>
          <dt className="inline font-label text-[9px] uppercase tracking-[0.18em] opacity-70 mr-2">
            Last reviewed
          </dt>
          <dd className="inline">{d.lastReviewed}</dd>
        </div>
      ) : null}
      {d.sourceUrl ? (
        <div className="pt-1">
          {/* A dl may hold only dt/dd groups; a bare link here read as malformed. */}
          <dt className="sr-only">Source</dt>
          <dd>
            <a
              href={d.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-label text-[10px] uppercase tracking-[0.16em] underline underline-offset-2"
              style={{ color: PLUM }}
            >
              Source ↗
            </a>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** Statutory and standards obligations that attach to a project of this kind. */
export function ObligationPanel({
  obligations,
  unavailable,
  lastReviewed,
}: {
  obligations: Obligation[];
  unavailable?: boolean;
  lastReviewed?: string;
}) {
  return (
    <section className="mb-12" aria-labelledby="obligations-heading">
      <h2
        id="obligations-heading"
        className="font-headline font-bold text-[clamp(22px,2.6vw,32px)] tracking-[-0.02em] mb-2"
      >
        Obligations that attach
      </h2>
      <p className="font-body text-[14px] leading-relaxed opacity-70 max-w-3xl mb-2">
        Every entry below is hand-curated and cited to a provision, with the date
        it was last reviewed. None of it is generated, and none of it is inferred
        from the population data on this page.
      </p>
      <p className="font-body text-[13px] leading-relaxed opacity-75 max-w-3xl mb-6">
        Whether an obligation applies is decided from what this proposal&rsquo;s
        own filing establishes, together with the Scheduled Area determination
        for every district the filing names. &ldquo;Does not apply&rdquo; is
        said only where a Presidential Order, or the absence of one, settles
        that the place is outside — it is a determination, not an inference.
        Where the position is genuinely open, the answer is &ldquo;not
        determined&rdquo;, because the stronger claim is not one the record
        supports.
        {lastReviewed ? ` Reference last reviewed ${lastReviewed}.` : ""}
      </p>

      {unavailable || obligations.length === 0 ? (
        <div className="border border-dashed border-[#1c1c19]/30 p-6">
          <p className="font-headline text-[18px] mb-2">
            {unavailable
              ? "The obligations could not be loaded"
              : "No obligations are recorded for this proposal"}
          </p>
          <p className="font-body text-[13.5px] leading-relaxed opacity-70 max-w-2xl">
            {unavailable
              ? "The obligations that attach to this proposal are held by this instrument — this is a failure to reach them, not a finding that none apply. Reloading usually fixes it."
              : "Rather than show provisions that have not been checked against the bare Acts, this panel shows nothing. A wrong section number is worse than an admitted gap: it would be quoted, and it would be wrong."}
          </p>
        </div>
      ) : (
        <>
          {/* The answer first, as counts, so a reader sees at once how many
              duties bind this project before reading any of them. */}
          <p className="font-label text-[11px] uppercase tracking-[0.14em] mb-4">
            {groupObligations(obligations)
              .map((g) => `${g.items.length} ${g.label.toLowerCase()}`)
              .join(" · ")}
          </p>
          {groupObligations(obligations).map((g) =>
            g.items.length === 0 ? null : g.key === "no" ? (
              <details key={g.key} className="mt-6">
                <summary className="cursor-pointer font-label text-[11px] uppercase tracking-[0.16em] py-2">
                  {g.label} ({g.items.length}) — settled by the determination
                  above or by the proponent&rsquo;s own filing; shown for
                  completeness
                </summary>
                <ObligationList items={g.items} />
              </details>
            ) : (
              <div key={g.key} className="mt-6">
                <h3 className="font-label text-[11px] uppercase tracking-[0.16em] mb-2">
                  {g.label} ({g.items.length})
                </h3>
                <ObligationList items={g.items} />
              </div>
            ),
          )}
        </>
      )}
    </section>
  );
}

function ObligationList({ items }: { items: Obligation[] }) {
  return (
    <ul className="border-t border-[#1c1c19]/25">
      {items.map((o) => (
        <li
          key={`${o.instrument}-${o.provision}`}
          className="py-4 border-b border-[#1c1c19]/15 grid grid-cols-1 md:grid-cols-12 gap-3"
        >
          <div className="md:col-span-3">
            <p className="font-label text-[10px] uppercase tracking-[0.14em] opacity-70">
              {o.kind === "statutory" ? "Statute" : "Standard"}
            </p>
            <p className="font-body text-[13.5px] leading-snug mt-0.5">
              {o.instrument}
            </p>
            <p className="font-label text-[10px] tracking-[0.08em] opacity-75 mt-0.5">
              {o.provision}
            </p>
          </div>
          <div className="md:col-span-7">
            <p className="font-body text-[14px] leading-relaxed">
              {o.requirement}
            </p>
            <p className="font-body text-[12.5px] leading-relaxed opacity-75 mt-1">
              <span className="font-label text-[9px] uppercase tracking-[0.16em] mr-1.5">
                Triggered by
              </span>
              {o.trigger}
            </p>
          </div>
          <div className="md:col-span-2 md:text-right">
            {o.note ? (
              <p className="font-body text-[12px] leading-relaxed opacity-70 mt-1">
                <span className="font-label text-[9px] uppercase tracking-[0.16em] mr-1">
                  Note
                </span>
                {o.note}
              </p>
            ) : null}
            <AppliesBadge applies={o.applies} />
            {o.lastReviewed ? (
              <p className="font-label text-[9px] uppercase tracking-[0.14em] opacity-65 mt-1.5">
                reviewed {o.lastReviewed}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function AppliesBadge({ applies }: { applies: Obligation["applies"] }) {
  const label =
    applies === "yes"
      ? "Applies"
      : applies === "conditional"
      ? "May apply"
      : applies === "no"
      ? "Does not apply"
      : "Not determined";
  const style =
    applies === "yes"
      ? { background: PLUM, color: "#fcf9f4" }
      : applies === "conditional"
      ? { border: `1px solid ${PLUM}`, color: PLUM }
      : { border: "1px solid rgba(28,28,25,0.3)", opacity: 0.7 };
  return (
    <span
      className="inline-block font-label text-[9px] uppercase tracking-[0.16em] px-2 py-1"
      style={style}
    >
      {label}
    </span>
  );
}
