"use client";

/**
 * Renders Tier 2 findings.
 *
 * Each one is a sentence produced by a rule with a stated threshold, not a
 * generated paragraph. The rule that fired is shown on demand, so a reader can
 * check why a sentence appeared rather than trusting that it should have.
 */

import { useState } from "react";
import type { Finding } from "@/lib/instruments/findings";
import { PLUM } from "./InstrumentChrome";

export default function Findings({
  findings,
  title = "What the record shows",
}: {
  findings: Finding[];
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!findings.length) return null;

  return (
    <section className="mb-10" aria-labelledby="findings-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <h2
          id="findings-heading"
          className="font-headline font-bold text-[clamp(21px,2.6vw,30px)] tracking-[-0.02em]"
        >
          {title}
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="font-label text-[10px] uppercase tracking-[0.16em] opacity-70 hover:opacity-90 transition-opacity"
        >
          {open ? "Hide the rules" : "Show the rules"}
        </button>
      </div>

      <ul className="space-y-0 border-t border-[#1c1c19]/25">
        {findings.map((f) => (
          <li
            key={f.id}
            className="py-4 border-b border-[#1c1c19]/12 pl-4 relative"
          >
            <span
              className="absolute left-0 top-4 bottom-4 w-[3px]"
              style={{ background: PLUM }}
              aria-hidden="true"
            />
            <p className="font-body text-[15px] leading-relaxed">{f.text}</p>
            {open ? (
              <p className="font-body text-[11.5px] leading-relaxed opacity-70 mt-1.5">
                <span className="font-label text-[9px] uppercase tracking-[0.16em] mr-2">
                  Rule
                </span>
                {f.rule}
                <span className="font-label text-[9px] uppercase tracking-[0.16em] mx-2">
                  Measures used
                </span>
                {f.basis.join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="font-body text-[12.5px] leading-relaxed opacity-75 mt-3 max-w-3xl">
        Each of these observations appears when a fixed rule is met by the
        figures on this page, so the same figures always give the same
        sentences. None of them is a view on whether a project should go
        ahead.
      </p>
    </section>
  );
}
