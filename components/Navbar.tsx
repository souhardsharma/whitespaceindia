"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleSimulatorClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setMobileOpen(false);
    if (pathname === "/") {
      document.getElementById("simulator")?.scrollIntoView({ behavior: "smooth" });
    } else {
      // Use window.location for cross-page navigation with hash
      window.location.href = "/#simulator";
    }
  };

  return (
    <motion.nav
      aria-label="Main navigation"
      initial={{ y: -64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#0B1526]/90 backdrop-blur-md border-b border-white/10"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link
          href="/"
          className="font-display text-[#F5A623] text-xl md:text-2xl uppercase tracking-[0.15em] font-bold"
        >
          WHITESPACE INDIA <span className="text-white/60 font-normal">|</span> <span className="text-white text-sm md:text-base tracking-widest font-semibold">CSR</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8 text-sm">
          <a
            href={pathname === "/" ? "#simulator" : "/#simulator"}
            onClick={handleSimulatorClick}
            className="text-[#94A3B8] hover:text-white transition-colors cursor-pointer"
          >
            Simulator
          </a>
          <Link href="/methodology" className="text-[#94A3B8] hover:text-white transition-colors">
            Methodology
          </Link>
          <Link href="/reports" className="text-[#94A3B8] hover:text-white transition-colors">
            Reports
          </Link>
          <Link href="/about" className="text-[#94A3B8] hover:text-white transition-colors">
            About
          </Link>
          <a
            href="https://www.linkedin.com/in/souhardsharma/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#F5A623] hover:text-[#FBBF24] transition-colors font-medium"
          >
            Contact
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-white p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {mobileOpen ? (
              <path d="M6 6l12 12M6 18L18 6" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
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
            className="md:hidden bg-[#0B1526]/95 backdrop-blur-md border-t border-white/10 overflow-hidden"
          >
            <div className="px-4 py-4 flex flex-col gap-4">
              <a
                href={pathname === "/" ? "#simulator" : "/#simulator"}
                onClick={handleSimulatorClick}
                className="text-[#94A3B8] hover:text-white transition-colors"
              >
                Simulator
              </a>
              <Link href="/methodology" onClick={() => setMobileOpen(false)} className="text-[#94A3B8] hover:text-white transition-colors">
                Methodology
              </Link>
              <Link href="/reports" onClick={() => setMobileOpen(false)} className="text-[#94A3B8] hover:text-white transition-colors">
                Reports
              </Link>
              <Link href="/about" onClick={() => setMobileOpen(false)} className="text-[#94A3B8] hover:text-white transition-colors">
                About
              </Link>
              <a
                href="https://www.linkedin.com/in/souhardsharma/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMobileOpen(false)}
                className="text-[#F5A623] hover:text-[#FBBF24] transition-colors font-medium"
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
