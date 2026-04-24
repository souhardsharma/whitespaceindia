"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function ReportsPage() {
  return (
    <main id="main-content" className="bg-[#fcf9f4] min-h-screen flex flex-col">
      <Navbar />

      <section className="relative flex-1 flex flex-col items-center justify-center px-6 md:px-12 lg:px-16 pt-32 md:pt-40 pb-24 md:pb-28 overflow-hidden">
        {/* Faint opaque background label */}
        <div
          aria-hidden
          className="absolute top-16 left-6 md:left-16 opacity-[0.04] select-none pointer-events-none"
        >
          <span className="font-label text-[8rem] md:text-[14rem] leading-none uppercase tracking-tighter text-[#1c1c19]">
            Reports
          </span>
        </div>

        <FadeIn className="relative z-10 w-full max-w-5xl flex flex-col items-center">
          {/* Monumental heading */}
          <div className="text-center mb-14 md:mb-16">
            <span className="font-label text-[10px] md:text-[11px] tracking-[0.5em] uppercase text-[#1c1c19]/70 mb-6 block">
              Reports
            </span>
            <h1 className="font-headline headline-tight text-[clamp(3.5rem,12vw,9rem)] leading-[0.9] text-[#1c1c19]">
              Reports &amp;<br />
              <span className="italic font-light">analysis.</span>
            </h1>
          </div>

          {/* Wireframe "Coming Soon" status card */}
          <div className="border border-[#1c1c19] px-12 md:px-16 py-8 md:py-10 mb-14 md:mb-16 flex flex-col items-center justify-center max-w-xs w-full bg-transparent">
            <span className="font-label text-[10px] md:text-[11px] uppercase tracking-[0.3em] text-[#1c1c19] mb-4">
              Access Status
            </span>
            <div className="h-px w-12 bg-[#1c1c19]" />
            <span className="font-label text-xl md:text-2xl font-bold uppercase tracking-tighter text-[#1c1c19] mt-4">
              Coming Soon
            </span>
          </div>

          {/* Brief editorial note */}
          <p className="font-body text-base md:text-lg text-[#1c1c19]/70 italic text-center max-w-xl leading-relaxed">
            In-depth district profiling, thematic studies, and funder analyses are in preparation. New reports will be published here as research is completed.
          </p>

          {/* Asymmetric anchor */}
          <div className="hidden lg:flex absolute bottom-6 right-12 flex-col items-end gap-2 text-right">
            <span className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/40">
              Built by
            </span>
            <span className="font-headline italic text-xl text-[#1c1c19]/70">
              Whitespace India
            </span>
          </div>
        </FadeIn>
      </section>

      <Footer />
    </main>
  );
}
