"use client";

/**
 * Header and footer for the /instruments namespace.
 *
 * The shared Navbar and Footer are index-shaped: both derive their links from a
 * VerticalConfig slug and fall back to CSR when none is given, so an instrument
 * page rendered with them would carry CSR's methodology, about and reports
 * navigation. Instruments are deliberately not verticals (no VerticalConfig, no
 * registry entry), so they get their own chrome instead of a config that lies
 * about what they are.
 *
 * Everything else is shared: the same fonts, the same ink and paper, the same
 * sharp corners, the same brace mark.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import RegisterCurrency from "@/components/instruments/RegisterCurrency";

// Instrument 01's colour. The shelf is not an instrument and must not wear
// one's colour, or the first instrument reads as the whole shelf: the shelf
// and the "Instruments" label take GRAPHITE, which no instrument will own.
export const PLUM = "#7a3b6b";
export const PLUM_DEEP = "#5f2c53";
export const GRAPHITE = "#3d3a34";

export function InstrumentHeader({
  crumb,
  crumbHref,
}: {
  crumb?: string;
  crumbHref?: string;
}) {
  return (
    <header className="sticky top-0 z-50 bg-[#fcf9f4] border-b border-[#1c1c19]">
      <nav
        aria-label="Instruments navigation"
        className="flex items-center justify-between gap-4 px-4 sm:px-6 md:px-10 py-4"
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <Link
            href="/"
            aria-label="Whitespace India home"
            className="flex items-baseline gap-2 hover:opacity-80 transition-opacity shrink-0"
          >
            <Image
              src="/logo.svg"
              alt=""
              aria-hidden="true"
              width={28}
              height={28}
              className="w-[22px] h-[22px] shrink-0 translate-y-[2px]"
            />
            <span className="font-headline font-bold text-[20px] sm:text-[22px] md:text-[26px] leading-none tracking-[-0.02em] text-[#1c1c19]">
              Whitespace India
            </span>
          </Link>
          <Link
            href="/instruments"
            className="font-headline italic font-bold text-[16px] sm:text-[17px] md:text-[20px] leading-none tracking-[-0.01em] shrink-0"
            style={{ color: GRAPHITE }}
          >
            Instruments
          </Link>
          {crumb ? (
            <span className="hidden sm:flex items-baseline gap-2 min-w-0">
              <span aria-hidden="true" className="font-label text-[13px] opacity-65">
                /
              </span>
              {crumbHref ? (
                <Link
                  href={crumbHref}
                  className="font-label text-[11px] uppercase tracking-[0.18em] text-[#1c1c19] opacity-70 hover:opacity-100 transition-opacity truncate"
                >
                  {crumb}
                </Link>
              ) : (
                <span className="font-label text-[11px] uppercase tracking-[0.18em] text-[#1c1c19] opacity-70 truncate">
                  {crumb}
                </span>
              )}
            </span>
          ) : null}
        </div>

        <Link
          // "/" is NOT a list of indexes and instruments on the host this
          // site actually deploys to: middleware.ts rewrites "/" to "/csr" for
          // the legacy CSR hosts, so this link dropped a reader who wanted the
          // other indexes into the CSR simulator, which lists neither. The
          // instruments shelf is the same on every host, and the label now
          // says what the destination is.
          href="/instruments"
          // Hidden below `sm`. On a 375px phone every item in this row is
          // shrink-0 and the row needs ~490px, so this link was drawn on top of
          // the "Instruments" link beside the wordmark - which goes to the same
          // place. Dropping the duplicate at that width removes the collision
          // without shrinking the brand, and the shelf stays one tap away.
          className="hidden sm:inline font-label text-[11px] uppercase tracking-[0.18em] text-[#1c1c19] opacity-70 hover:opacity-100 transition-opacity shrink-0"
        >
          All instruments
        </Link>
      </nav>
    </header>
  );
}

export function InstrumentFooter() {
  // Which of the four surfaces we are on, so the nav below does not offer the
  // page you are already reading as somewhere to go.
  const pathname = usePathname();

  return (
    <footer className="bg-[#fcf9f4] border-t border-[#1c1c19] px-6 md:px-12 py-12">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-end md:justify-between gap-8">
        <div>
          <div className="flex items-baseline gap-2 mb-3">
            <Image
              src="/logo.svg"
              alt=""
              aria-hidden="true"
              width={26}
              height={26}
              className="w-[20px] h-[20px] shrink-0 translate-y-[2px]"
            />
            <span className="font-headline font-bold text-[26px] leading-none tracking-[-0.02em] text-[#1c1c19]">
              Whitespace India
            </span>
          </div>
          <p className="font-body text-[14px] leading-relaxed text-[#1c1c19] opacity-70 max-w-md">
            Instruments are built from India&rsquo;s public records. Every figure
            they show carries its source and the year that source was collected.
          </p>
          {/* Here rather than on each page: every instrument surface shows
              register-derived figures, and a currency statement that lives in
              four places is one that eventually disagrees with itself. The
              clearance register is live, so "when was this read" is part of
              reading any number on it. */}
          <RegisterCurrency className="mt-4 text-[#1c1c19]" />
        </div>

        <div className="flex flex-col gap-2">
          <Link
            href="/instruments"
            className="font-label text-[11px] uppercase tracking-[0.18em] text-[#1c1c19] opacity-70 hover:opacity-100 transition-opacity"
          >
            Instruments shelf
          </Link>
          <Link
            href="/"
            className="font-label text-[11px] uppercase tracking-[0.18em] text-[#1c1c19] opacity-70 hover:opacity-100 transition-opacity"
          >
            Whitespace India
          </Link>
          <a
            href="https://github.com/souhardsharma/whitespaceindia"
            target="_blank"
            rel="noopener noreferrer"
            className="font-label text-[11px] uppercase tracking-[0.18em] text-[#1c1c19] opacity-70 hover:opacity-100 transition-opacity"
          >
            Source on GitHub
          </a>
        </div>
      </div>
      {/* Every surface of this instrument, from every surface of it.
          Placed here rather than page by page because the links that existed
          were one-directional and incomplete: methodology reached neither the
          register nor the appraisal page, those two could not reach each
          other, and the 620 district pages - the largest part of the
          instrument - could not reach the methodology that explains every
          number on them. One list in the shared chrome means adding a surface
          links it from all the others, instead of from whichever pages someone
          remembered to edit. */}
      <nav
        aria-label="People & Consent"
        className="max-w-6xl mx-auto mt-10 pt-6 border-t border-[#1c1c19]/15"
      >
        <span className="font-label text-[10px] uppercase tracking-[0.24em] text-[#1c1c19] opacity-65 block mb-3">
          People &amp; Consent
        </span>
        <ul className="flex flex-wrap gap-x-7 gap-y-2">
          {[
            ["/instruments/consent", "Search the register"],
            ["/instruments/consent/latest", "What moved"],
            ["/instruments/consent/register", "By district"],
            ["/instruments/consent/appraisal", "How long clearance takes"],
            ["/instruments/consent/data", "Data and API"],
            ["/instruments/consent/methodology", "Methodology"],
          ].map(([href, label]) => {
            // The current page is named but NOT a link. A screen-reader user
            // pulling the links list heard "By district" as somewhere to go,
            // activated it on /register, and nothing happened - the standard
            // reading of which is that the site is broken.
            const here = pathname === href;
            return (
            <li key={href}>
              {here ? (
                <span
                  aria-current="page"
                  className="font-body text-[13px] text-[#1c1c19] opacity-90 font-medium"
                >
                  {label} <span className="opacity-80">&mdash; you are here</span>
                </span>
              ) : (
              <Link
                href={href}
                className="font-body text-[13px] text-[#1c1c19] opacity-75 hover:opacity-100 underline underline-offset-4 decoration-[#1c1c19]/25 hover:decoration-[#1c1c19] transition-opacity"
              >
                {label}
              </Link>
              )}
            </li>
            );
          })}
        </ul>
      </nav>

      <div className="max-w-6xl mx-auto mt-8 pt-6 border-t border-[#1c1c19]/15">
        <span className="font-label text-[11px] uppercase tracking-[0.2em] text-[#1c1c19] opacity-70">
          &copy; {new Date().getFullYear()} Whitespace India
        </span>
      </div>
    </footer>
  );
}
