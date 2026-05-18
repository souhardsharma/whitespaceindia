"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ComingSoonOverlay from "@/components/ComingSoonOverlay";
import { healthConfig } from "@/lib/health/config";

const cfg = healthConfig;
const accent = cfg.theme.accent;

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 24 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }} className={className}>
      {children}
    </motion.div>
  );
}

export default function HealthReportsPage() {
  return (
    <ComingSoonOverlay active={cfg.comingSoon} verticalName={cfg.name} accentColor={accent}>
      <main className="bg-[#fcf9f4] min-h-screen">
        <Navbar vertical={cfg} />

        <section className="pt-32 md:pt-40 pb-16 md:pb-24 px-6 md:px-12 lg:px-16">
          <div className="max-w-4xl mx-auto">
            <FadeIn>
              <span className="font-label text-[11px] uppercase tracking-[0.3em] block mb-6" style={{ color: accent }}>Reports</span>
              <h1 className="font-headline text-5xl md:text-7xl headline-tight text-[#1c1c19] mb-10">
                Health <span className="italic font-light">reports.</span>
              </h1>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="border-t border-[#1c1c19] pt-10">
                <p className="font-body text-base text-[#1c1c19]/80 leading-relaxed mb-10">
                  District-level health infrastructure reports will be available here once the Health vertical launches. Each report will include health access metrics, outcomes data, infrastructure gaps, and contextual analysis.
                </p>

                <div className="border border-[#1c1c19] bg-[#f6f3ee] p-8 md:p-12 text-center">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/60 block mb-4">No Reports Yet</span>
                  <h3 className="font-headline text-2xl md:text-3xl text-[#1c1c19] mb-4">
                    Reports are <span className="italic font-light">in progress.</span>
                  </h3>
                  <p className="font-body text-sm text-[#1c1c19]/60 italic">
                    Health district reports will be published when the vertical goes live.
                  </p>
                </div>
              </div>
            </FadeIn>
          </div>
        </section>

        <Footer vertical={cfg} />
      </main>
    </ComingSoonOverlay>
  );
}
