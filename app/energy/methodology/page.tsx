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

export default function EnergyMethodologyPage() {
  return (
    <ComingSoonOverlay active={cfg.comingSoon} verticalName={cfg.name} accentColor={accent}>
      <main className="bg-[#fcf9f4] min-h-screen">
        <Navbar vertical={cfg} />

        <section className="pt-32 md:pt-40 pb-16 md:pb-24 px-6 md:px-12 lg:px-16">
          <div className="max-w-4xl mx-auto">
            <FadeIn>
              <span className="font-label text-[11px] uppercase tracking-[0.3em] block mb-6" style={{ color: accent }}>Methodology</span>
              <h1 className="font-headline text-5xl md:text-7xl headline-tight text-[#1c1c19] mb-10">
                How we score <span className="italic font-light">energy gaps.</span>
              </h1>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="border-t border-[#1c1c19] pt-10 grid grid-cols-1 md:grid-cols-12 gap-10">
                <div className="md:col-span-4">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/60">Scoring Framework</span>
                </div>
                <div className="md:col-span-8 font-body text-base text-[#1c1c19]/80 leading-relaxed space-y-6">
                  <p>The Energy Opportunity Score (EOS) is a composite index built on the OECD Handbook framework for constructing composite indicators. Three normalised dimensions — Supply Gap (S), Access Equity (A), and Transition Readiness (T) — are weighted and combined.</p>
                  <p className="font-label text-sm tracking-wide" style={{ color: accent }}>EOS = w<sub>S</sub> · S + w<sub>A</sub> · A + w<sub>T</sub> · T</p>
                  <p>Default weights: Supply 35%, Access 40%, Transition 25%. Users can adjust these in the simulator to match their intervention priorities.</p>
                </div>
              </div>
            </FadeIn>

            {cfg.dimensions.map((dim, i) => (
              <FadeIn key={dim.key} delay={0.15 + i * 0.05}>
                <div className="border-t border-[#1c1c19] pt-10 mt-16 grid grid-cols-1 md:grid-cols-12 gap-10">
                  <div className="md:col-span-4">
                    <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/60">Dimension {dim.shortLabel}</span>
                    <h3 className="font-headline text-2xl text-[#1c1c19] mt-2">{dim.label}</h3>
                  </div>
                  <div className="md:col-span-8 font-body text-base text-[#1c1c19]/80 leading-relaxed">
                    <p>{dim.description}</p>
                    <div className="mt-4 flex items-center gap-4">
                      <span className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/50">Default weight</span>
                      <span className="font-label text-sm font-bold" style={{ color: accent }}>{Math.round(dim.defaultWeight * 100)}%</span>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </section>

        <Footer vertical={cfg} />
      </main>
    </ComingSoonOverlay>
  );
}
