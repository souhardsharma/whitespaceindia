/**
 * The other clearances a project needs, and how its land is held - as the
 * environmental clearance form itself declares them.
 *
 * An environmental clearance is one of several. A mine on forest land also
 * needs forest clearance under the Forest (Conservation) Act, and that is where
 * the Forest Rights Act's Gram Sabha certificates are required; a project near
 * a sanctuary needs the National Board for Wildlife's recommendation; a coastal
 * one needs CRZ clearance. The EC form names each of these, with the other
 * proposal's number. Read together they show what the environmental clearance
 * alone does not: which other decisions, with which consent requirements,
 * stand between this project and the ground.
 *
 * The wording comes from lib/instruments/links.ts, which the PDF export uses
 * too, so the screen and the download cannot say different things.
 */
import type { LinkedClearances as Links } from "@/lib/instruments/types";
import {
  LINKS_BLANK,
  LINKS_NONE,
  LINKS_UNREAD,
  linkedClearanceLines,
  type ForestRegisterEntry,
} from "@/lib/instruments/links";

export type { ForestRegisterEntry };

export default function LinkedClearances({
  links,
  forestRegister,
}: {
  links: Links | 0 | null;
  forestRegister?: ForestRegisterEntry | null;
}) {
  const { state, lines } = linkedClearanceLines(links, forestRegister);
  return (
    <section className="mb-12" aria-labelledby="links-heading">
      <h2
        id="links-heading"
        className="font-headline font-bold text-[clamp(22px,2.6vw,32px)] tracking-[-0.02em] mb-2"
      >
        Other clearances and land tenure
      </h2>
      <p className="font-body text-[13.5px] leading-relaxed opacity-75 max-w-3xl mb-4">
        This section reports what the application form declares about the
        other clearances the project needs and about how its land is held. The
        applicant made these declarations, and we have not checked them against
        any other record.
      </p>
      {state === "unread" ? (
        <p className="font-body text-[14px] border border-dashed border-[#1c1c19]/30 p-5 opacity-80">
          {LINKS_UNREAD}
        </p>
      ) : state === "blank" ? (
        <p className="font-body text-[14px] border border-dashed border-[#1c1c19]/30 p-5 opacity-80">
          {LINKS_BLANK}
        </p>
      ) : state === "none" ? (
        <p className="font-body text-[14px] border border-[#1c1c19]/20 p-5">{LINKS_NONE}</p>
      ) : (
        <dl className="border-t border-[#1c1c19]/25">
          {lines.map((l) => (
            <div key={l.label} className="grid grid-cols-1 md:grid-cols-12 gap-2 py-3 border-b border-[#1c1c19]/10">
              <dt className="md:col-span-3 font-label text-[10px] uppercase tracking-[0.16em] opacity-75">
                {l.label}
              </dt>
              <dd className="md:col-span-9 font-body text-[14px] leading-relaxed">
                {l.text}
                {l.note ? (
                  <span className="block mt-1 text-[12.5px] opacity-70">{l.note}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
