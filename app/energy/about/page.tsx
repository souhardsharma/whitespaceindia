"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ComingSoonOverlay from "@/components/ComingSoonOverlay";
import { energyConfig } from "@/lib/energy/config";

const cfg = energyConfig;
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

export default function EnergyAboutPage() {
  return (
    <ComingSoonOverlay active={cfg.comingSoon} verticalName={cfg.name} accentColor={accent}>
      <main className="bg-[#fcf9f4] min-h-screen">
        <Navbar vertical={cfg} />

        <section className="pt-32 md:pt-40 pb-16 md:pb-24 px-6 md:px-12 lg:px-16">
          <div className="max-w-4xl mx-auto">
            <FadeIn>
              <span className="font-label text-[11px] uppercase tracking-[0.3em] block mb-6" style={{ color: accent }}>About</span>
              <h1 className="font-headline text-5xl md:text-7xl headline-tight text-[#1c1c19] mb-10">
                Mapping India&apos;s <span className="italic font-light">energy divide.</span>
              </h1>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="border-t border-[#1c1c19] pt-10 grid grid-cols-1 md:grid-cols-12 gap-10">
                <div className="md:col-span-4">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/60">The Project</span>
                </div>
                <div className="md:col-span-8 font-body text-base text-[#1c1c19]/80 leading-relaxed space-y-6">
                  <p>Whitespace India Energy is a research initiative mapping energy access and transition gaps across Indian districts. Using government data from the Central Electricity Authority, Saubhagya scheme dashboards, and the Ministry of New and Renewable Energy, we score every district on three dimensions: supply deficit, access equity, and transition readiness.</p>
                  <p>The goal is to surface the districts where energy infrastructure investment would have the greatest impact — not through subjective assessment, but through transparent, reproducible scoring based on public records.</p>
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={0.2}>
              <div className="border-t border-[#1c1c19] pt-10 mt-16 grid grid-cols-1 md:grid-cols-12 gap-10">
                <div className="md:col-span-4">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/60">Data Sources</span>
                </div>
                <div className="md:col-span-8">
                  <ul className="space-y-4 font-body text-sm text-[#1c1c19]/80 leading-relaxed">
                    <li className="border-b border-[#1c1c19]/20 pb-4">Central Electricity Authority (CEA) — State-wise generation and capacity reports</li>
                    <li className="border-b border-[#1c1c19]/20 pb-4">Saubhagya Dashboard — Household electrification progress</li>
                    <li className="border-b border-[#1c1c19]/20 pb-4">Ministry of New and Renewable Energy (MNRE) — Renewable capacity and targets</li>
                    <li className="pb-4">Census of India 2011 — District population baselines</li>
                  </ul>
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
