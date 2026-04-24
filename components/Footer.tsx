"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useInView } from "framer-motion";

export default function Footer() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <footer
      ref={ref}
      className="relative bg-[#fcf9f4] border-t border-[#1c1c19] px-6 md:px-12 py-16"
    >
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-10 mb-14">
        {/* Brand column */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0, ease: [0.16, 1, 0.3, 1] }}
          className="md:col-span-5"
        >
          <div className="flex items-baseline gap-2 mb-4">
            <Image src="/logo.svg" alt="" aria-hidden="true" width={32} height={32} className="w-[24px] h-[24px] md:w-[26px] md:h-[26px] shrink-0 translate-y-[2px]" />
            <span className="font-headline font-bold text-[30px] md:text-[34px] leading-none tracking-[-0.02em] text-[#1c1c19]">
              Whitespace India
            </span>
            <span className="font-headline italic font-bold text-[22px] md:text-[26px] leading-none tracking-[-0.01em] text-[#BD402C]">
              CSR
            </span>
          </div>
          <p className="text-sm text-[#1c1c19]/70 leading-relaxed max-w-sm font-body">
            A research project mapping the gap between CSR spending and poverty across Indian districts. All data sourced from public government records.
          </p>
          <a
            href="https://www.linkedin.com/in/souhardsharma/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-3 mt-8 bg-[#BD402C] text-white px-7 py-4 font-label text-[11px] uppercase tracking-[0.25em] hover:bg-[#1c1c19] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
            Get in Touch
          </a>
        </motion.div>

        {/* Data Sources */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="md:col-span-3"
        >
          <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/50 block mb-5">
            Primary Sources
          </span>
          <ul className="space-y-3 text-sm text-[#1c1c19]/80 font-body">
            <li>
              <a
                href="https://niti.gov.in/sites/default/files/2023-07/National-Multidimentional-Poverty-Index-2023-Final-17th-July.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#BD402C] transition-colors border-b border-transparent hover:border-[#BD402C]"
              >
                NITI Aayog National MPI 2023
              </a>
            </li>
            <li>
              <a
                href="https://dataful.in/datasets/1612"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#BD402C] transition-colors border-b border-transparent hover:border-[#BD402C]"
              >
                MCA CSR Data via Dataful.in
              </a>
            </li>
            <li>
              <a
                href="https://censusindia.gov.in"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#BD402C] transition-colors border-b border-transparent hover:border-[#BD402C]"
              >
                Census of India 2011
              </a>
            </li>
          </ul>
        </motion.div>

        {/* Navigation */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="md:col-span-2"
        >
          <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/50 block mb-5">
            Sections
          </span>
          <ul className="space-y-3 text-sm font-body">
            <li>
              <Link href="/methodology" className="text-[#1c1c19]/80 hover:text-[#BD402C] transition-colors">
                Methodology
              </Link>
            </li>
            <li>
              <Link href="/about" className="text-[#1c1c19]/80 hover:text-[#BD402C] transition-colors">
                About
              </Link>
            </li>
            <li>
              <Link href="/reports" className="text-[#1c1c19]/80 hover:text-[#BD402C] transition-colors">
                Reports
              </Link>
            </li>
            <li>
              <a
                href="https://www.oecd.org/en/publications/handbook-on-constructing-composite-indicators-methodology-and-user-guide_9789264043466-en.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#1c1c19]/80 hover:text-[#BD402C] transition-colors"
              >
                OECD Handbook
              </a>
            </li>
          </ul>
        </motion.div>

      </div>

      {/* Metadata strip */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : {}}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="max-w-7xl mx-auto border-t border-[#1c1c19] pt-8 flex flex-col md:flex-row justify-between gap-6 items-start md:items-center"
      >
        <div className="flex flex-wrap gap-10">
          <div>
            <span className="font-label text-[9px] uppercase tracking-[0.3em] text-[#1c1c19]/60 block mb-1">
              Access
            </span>
            <span className="font-label text-[11px] uppercase tracking-[0.2em] text-[#1c1c19]">
              Open Data
            </span>
          </div>
          <div>
            <span className="font-label text-[9px] uppercase tracking-[0.3em] text-[#1c1c19]/60 block mb-1">
              License
            </span>
            <span className="font-label text-[11px] uppercase tracking-[0.2em] text-[#BD402C]">
              CC BY 4.0
            </span>
          </div>
          <div>
            <span className="font-label text-[9px] uppercase tracking-[0.3em] text-[#1c1c19]/60 block mb-1">
              Framework
            </span>
            <span className="font-label text-[11px] uppercase tracking-[0.2em] text-[#1c1c19]">
              OECD Composite
            </span>
          </div>
        </div>
        <span className="font-label text-[9px] uppercase tracking-[0.3em] text-[#1c1c19]/60">
          © {new Date().getFullYear()} Whitespace India
        </span>
      </motion.div>
    </footer>
  );
}
