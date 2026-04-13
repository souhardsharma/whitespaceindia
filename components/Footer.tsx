"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";

export default function Footer() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <footer ref={ref} className="relative bg-[#0B1526] border-t border-white/10 pt-16 pb-10">
      {/* Top gradient accent */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#F5A623]/30 to-transparent" />

      <div className="max-w-6xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-12">
          {/* Column 1: Brand */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="font-display text-[#F5A623] text-2xl uppercase tracking-[0.15em] font-bold mb-1">
              WHITESPACE INDIA
            </div>
            <div className="text-white/50 text-xs tracking-[0.3em] uppercase font-semibold mb-4">CSR</div>
            <p className="text-sm text-[#64748B] leading-relaxed max-w-xs">
              An evidence-based tool for foundation leaders and program officers directing CSR
              strategy across India.
            </p>
            <a
              href="https://www.linkedin.com/in/souhardsharma/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-5 bg-[#F5A623] text-[#0B1526] font-semibold text-sm rounded-full px-5 py-2.5 hover:bg-[#FBBF24] hover:shadow-[0_0_20px_rgba(245,166,35,0.3)] transition-all duration-300 hover:scale-105"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              Contact Us
            </a>
          </motion.div>

          {/* Column 2: Data Sources */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          >
            <h4 className="text-xs uppercase tracking-wider text-[#94A3B8] font-semibold mb-4">
              Data Sources
            </h4>
            <ul className="space-y-2.5 text-sm text-[#64748B]">
              <li>
                <a
                  href="https://www.niti.gov.in/sites/default/files/2023-08/India-National-Multidimentional-Poverty-Index-2023.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#F5A623] transition-colors duration-300"
                >
                  NITI Aayog National MPI 2023
                </a>
              </li>
              <li>
                <a
                  href="https://dataful.in/datasets/1612"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#F5A623] transition-colors duration-300"
                >
                  MCA CSR Data via Dataful.in
                </a>
              </li>
              <li>
                <a
                  href="https://censusindia.gov.in"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#F5A623] transition-colors duration-300"
                >
                  Census of India 2011
                </a>
              </li>
            </ul>
          </motion.div>

          {/* Column 3: Navigation */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <h4 className="text-xs uppercase tracking-wider text-[#94A3B8] font-semibold mb-4">
              Explore
            </h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link href="/methodology" className="text-[#64748B] hover:text-[#F5A623] transition-colors duration-300">
                  Methodology
                </Link>
              </li>
              <li>
                <Link href="/about" className="text-[#64748B] hover:text-[#F5A623] transition-colors duration-300">
                  About
                </Link>
              </li>
              <li>
                <a
                  href="https://www.oecd.org/en/publications/handbook-on-constructing-composite-indicators-methodology-and-user-guide_9789264043466-en.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#64748B] hover:text-[#F5A623] transition-colors duration-300"
                >
                  OECD Handbook
                </a>
              </li>
            </ul>
            <h4 className="text-xs uppercase tracking-wider text-[#94A3B8] font-semibold mb-3 mt-6">
              Coming Soon
            </h4>
            <ul className="space-y-2 text-sm text-[#475569]">
              {["Education", "Health", "Energy"].map((item, i) => (
                <motion.li
                  key={item}
                  initial={{ opacity: 0, x: -12 }}
                  animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.4, delay: 0.35 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                >
                  {item}
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </div>

        {/* Bottom bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="border-t border-white/10 pt-6 flex flex-col sm:flex-row justify-between gap-3 text-xs text-[#475569]"
        >
          <span>Scoring follows OECD composite indicator methodology. All data from public government sources.</span>
          <span>Research briefs are AI-assisted and should be independently verified.</span>
        </motion.div>
      </div>
    </footer>
  );
}
