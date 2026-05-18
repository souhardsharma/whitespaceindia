"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { VerticalConfig } from "@/lib/verticals/types";

const DEFAULT_ACCENT = "#BD402C";
const DEFAULT_ACCENT_DEEP = "#9b2817";

export default function Navbar({ vertical }: { vertical?: VerticalConfig }) {
  const accent = vertical?.theme.accent ?? DEFAULT_ACCENT;
  const accentDeep = vertical?.theme.accentDeep ?? DEFAULT_ACCENT_DEEP;
  const verticalName = vertical?.name ?? "CSR";
  const verticalSlug = vertical?.slug ?? "csr";
  const methodologyHref = verticalSlug === "csr" ? "/methodology" : `/${verticalSlug}/methodology`;
  const aboutHref = verticalSlug === "csr" ? "/about" : `/${verticalSlug}/about`;
  const reportsHref = verticalSlug === "csr" ? "/reports" : `/${verticalSlug}/reports`;
  const simulatorHref = `/${verticalSlug}#simulator`;
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const handleSimulatorClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setMobileOpen(false);
    if (pathname === `/${verticalSlug}`) {
      document.getElementById("simulator")?.scrollIntoView({ behavior: "smooth" });
    } else {
      window.location.href = simulatorHref;
    }
  };

  const isActive = (path: string) => pathname === path;

  return (
    <motion.nav
      aria-label="Main navigation"
      initial={{ y: -64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-0 left-0 right-0 z-50 bg-[#fcf9f4] border-b border-[#1c1c19]"
    >
      <div className="flex justify-between items-center w-full px-6 md:px-10 py-5 max-w-full">
        <div className="flex items-center gap-10 md:gap-12">
          <div className="flex items-baseline gap-2 font-headline text-[#1c1c19]">
            <Link
              href="/"
              aria-label="Whitespace India home"
              className="flex items-baseline gap-2 hover:opacity-80 transition-opacity"
            >
              <Image
                src="/logo.svg"
                alt=""
                aria-hidden="true"
                width={34}
                height={34}
                priority
                className="w-[22px] h-[22px] md:w-[26px] md:h-[26px] shrink-0 self-baseline translate-y-[2px]"
              />
              <span className="font-headline font-bold text-[28px] md:text-[34px] leading-none tracking-[-0.02em]">
                Whitespace India
              </span>
            </Link>
            <Link
              href={`/${verticalSlug}`}
              aria-label={`${verticalName} home`}
              className="font-headline italic font-bold text-[22px] md:text-[26px] leading-none tracking-[-0.01em] transition-colors"
              style={{ color: accent }}
              onMouseEnter={e => (e.currentTarget.style.color = accentDeep)}
              onMouseLeave={e => (e.currentTarget.style.color = accent)}
            >
              {verticalName}
            </Link>
          </div>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8 lg:gap-10">
            <a
              href={simulatorHref}
              onClick={handleSimulatorClick}
              className="font-label text-[11px] uppercase tracking-[0.25em] text-[#1c1c19] transition-colors cursor-pointer"
              onMouseEnter={e => (e.currentTarget.style.color = accent)}
              onMouseLeave={e => (e.currentTarget.style.color = '#1c1c19')}
            >
              Simulator
            </a>
            <Link
              href={methodologyHref}
              className="font-label text-[11px] uppercase tracking-[0.25em] transition-colors text-[#1c1c19]"
              style={isActive(methodologyHref) ? { color: accent, borderBottom: `1px solid ${accent}`, paddingBottom: '2px' } : undefined}
              onMouseEnter={e => { if (!isActive(methodologyHref)) e.currentTarget.style.color = accent; }}
              onMouseLeave={e => { if (!isActive(methodologyHref)) e.currentTarget.style.color = '#1c1c19'; }}
            >
              Methodology
            </Link>
            <Link
              href={reportsHref}
              className="font-label text-[11px] uppercase tracking-[0.25em] transition-colors text-[#1c1c19]"
              style={isActive(reportsHref) ? { color: accent, borderBottom: `1px solid ${accent}`, paddingBottom: '2px' } : undefined}
              onMouseEnter={e => { if (!isActive(reportsHref)) e.currentTarget.style.color = accent; }}
              onMouseLeave={e => { if (!isActive(reportsHref)) e.currentTarget.style.color = '#1c1c19'; }}
            >
              Reports
            </Link>
            <Link
              href={aboutHref}
              className="font-label text-[11px] uppercase tracking-[0.25em] transition-colors text-[#1c1c19]"
              style={isActive(aboutHref) ? { color: accent, borderBottom: `1px solid ${accent}`, paddingBottom: '2px' } : undefined}
              onMouseEnter={e => { if (!isActive(aboutHref)) e.currentTarget.style.color = accent; }}
              onMouseLeave={e => { if (!isActive(aboutHref)) e.currentTarget.style.color = '#1c1c19'; }}
            >
              About
            </Link>
            <a
              href="https://www.linkedin.com/in/souhardsharma/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-label text-[11px] uppercase tracking-[0.25em] transition-colors"
              style={{ color: accent }}
              onMouseEnter={e => (e.currentTarget.style.color = accentDeep)}
              onMouseLeave={e => (e.currentTarget.style.color = accent)}
            >
              Contact
            </a>
          </div>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-[#1c1c19] p-1"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            {mobileOpen ? (
              <path d="M6 6l12 12M6 18L18 6" />
            ) : (
              <path d="M4 7h16M4 14h16M4 21h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-[#fcf9f4] border-t border-[#1c1c19] overflow-hidden"
          >
            <div className="px-6 py-6 flex flex-col gap-5">
              <a
                href={simulatorHref}
                onClick={handleSimulatorClick}
                className="font-label text-[11px] uppercase tracking-[0.25em] text-[#1c1c19] transition-colors"
                onMouseEnter={e => (e.currentTarget.style.color = accent)}
                onMouseLeave={e => (e.currentTarget.style.color = '#1c1c19')}
              >
                Simulator
              </a>
              <Link
                href={methodologyHref}
                onClick={() => setMobileOpen(false)}
                className="font-label text-[11px] uppercase tracking-[0.25em] text-[#1c1c19] transition-colors"
                onMouseEnter={e => (e.currentTarget.style.color = accent)}
                onMouseLeave={e => (e.currentTarget.style.color = '#1c1c19')}
              >
                Methodology
              </Link>
              <Link
                href={reportsHref}
                onClick={() => setMobileOpen(false)}
                className="font-label text-[11px] uppercase tracking-[0.25em] text-[#1c1c19] transition-colors"
                onMouseEnter={e => (e.currentTarget.style.color = accent)}
                onMouseLeave={e => (e.currentTarget.style.color = '#1c1c19')}
              >
                Reports
              </Link>
              <Link
                href={aboutHref}
                onClick={() => setMobileOpen(false)}
                className="font-label text-[11px] uppercase tracking-[0.25em] text-[#1c1c19] transition-colors"
                onMouseEnter={e => (e.currentTarget.style.color = accent)}
                onMouseLeave={e => (e.currentTarget.style.color = '#1c1c19')}
              >
                About
              </Link>
              <a
                href="https://www.linkedin.com/in/souhardsharma/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileOpen(false)}
                className="font-label text-[11px] uppercase tracking-[0.25em] transition-colors"
                style={{ color: accent }}
                onMouseEnter={e => (e.currentTarget.style.color = accentDeep)}
                onMouseLeave={e => (e.currentTarget.style.color = accent)}
              >
                Contact
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
