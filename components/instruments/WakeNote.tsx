"use client";

import { PLUM } from "./InstrumentChrome";

/**
 * What a reader is told when a request failed because the backend is asleep,
 * with the link that wakes it (lib/instruments/wake.ts). One wording for every
 * part of a page that asks the backend, so none of them reads a sleeping
 * service as "nothing new" or as a broken page.
 */
export default function WakeNote({
  href,
  what,
  className = "",
}: {
  /** wakeLink(): the same page on the backend, which sends the reader back. */
  href: string;
  /** What could not be done, as the start of a sentence: "Changes could not be checked". */
  what: string;
  className?: string;
}) {
  return (
    <div className={`font-body text-[13px] leading-relaxed ${className}`} role="status">
      <p className="opacity-80">
        {what}: the part of the site that reads the register on request is
        asleep. It sleeps when nobody has used it for a while and takes about a
        minute to wake. The link wakes it and brings you back to this page.
      </p>
      <a
        href={href}
        className="inline-block mt-1.5 font-label text-[11px] uppercase tracking-[0.08em] underline underline-offset-4"
        style={{ color: PLUM }}
      >
        Wake it
      </a>
    </div>
  );
}
