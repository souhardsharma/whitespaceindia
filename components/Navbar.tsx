"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export default function Navbar() {
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
    if (pathname === "/") {
      document.getElementById("simulator")?.scrollIntoView({ behavior: "smooth" });
    } else {
      window.location.href = "/#simulator";
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
          <Link
            href="/"
            aria-label="Whitespace India CSR, home"
            className="flex items-baseline gap-2 font-headline text-[#1c1c19]"
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
            <span className="font-headline italic font-bold text-[22px] md:text-[26px] leading-none tracking-[-0.01em] text-[#BD402C]">
              CSR
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8 lg:gap-10">
            <a
              href={pathname === "/" ? "#simulator" : "/#simulator"}
              onClick={handleSimulatorClick}
              className="font-label text-[11px] uppercase tracking-[0.25em] text-[#1c1c19] hover:text-[#BD402C] transition-colors cursor-pointer"
            >
              Simulator
            </a>
            <Link
              href="/methodology"
              className={`font-label text-[11px] uppercase tracking-[0.25em] transition-colors ${
                isActive("/methodology")
                  ? "text-[#BD402C] border-b border-[#BD402C] pb-0.5"
                  : "text-[#1c1c19] hover:text-[#BD402C]"
              }`}
            >
              Methodology
            </Link>
            <Link
              href="/reports"
              className={`font-label text-[11px] uppercase tracking-[0.25em] transition-colors ${
                isActive("/reports")
                  ? "text-[#BD402C] border-b border-[#BD402C] pb-0.5"
                  : "text-[#1c1c19] hover:text-[#BD402C]"
              }`}
            >
              Reports
            </Link>
            <Link
              href="/about"
              className={`font-label text-[11px] uppercase tracking-[0.25em] transition-colors ${
                isActive("/about")
                  ? "text-[#BD402C] border-b border-[#BD402C] pb-0.5"
                  : "text-[#1c1c19] hover:text-[#BD402C]"
              }`}
            >
              About
            </Link>
            <a
              href="https://www.linkedin.com/in/souhardsharma/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-label text-[11px] uppercase tracking-[0.25em] text-[#BD402C] hover:text-[#9b2817] transition-colors"
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
                href={pathname === "/" ? "#simulator" : "/#simulator"}
                onClick={handleSimulatorClick}
                className="font-label text-[11px] uppercase tracking-[0.25em] text-[#1c1c19] hover:text-[#BD402C] transition-colors"
              >
                Simulator
              </a>
              <Link
                href="/methodology"
                onClick={() => setMobileOpen(false)}
                className="font-label text-[11px] uppercase tracking-[0.25em] text-[#1c1c19] hover:text-[#BD402C] transition-colors"
              >
                Methodology
              </Link>
              <Link
                href="/reports"
                onClick={() => setMobileOpen(false)}
                className="font-label text-[11px] uppercase tracking-[0.25em] text-[#1c1c19] hover:text-[#BD402C] transition-colors"
              >
                Reports
              </Link>
              <Link
                href="/about"
                onClick={() => setMobileOpen(false)}
                className="font-label text-[11px] uppercase tracking-[0.25em] text-[#1c1c19] hover:text-[#BD402C] transition-colors"
              >
                About
              </Link>
              <a
                href="https://www.linkedin.com/in/souhardsharma/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileOpen(false)}
                className="font-label text-[11px] uppercase tracking-[0.25em] text-[#BD402C] hover:text-[#9b2817] transition-colors"
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
