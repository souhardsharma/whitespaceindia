"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ComingSoonOverlay from "@/components/ComingSoonOverlay";
import { educationConfig } from "@/lib/education/config";

const cfg = educationConfig;
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

export default function EducationAboutPage() {
  return (
    <ComingSoonOverlay active={cfg.comingSoon} verticalName={cfg.name} accentColor={accent}>
      <main id="main-content" className="bg-[#fcf9f4] min-h-screen">
        <Navbar vertical={cfg} />

        <section className="pt-32 md:pt-40 pb-16 md:pb-24 px-6 md:px-12 lg:px-16">
          <div className="max-w-4xl mx-auto">
            <FadeIn>
              <span className="font-label text-[11px] uppercase tracking-[0.3em] block mb-6" style={{ color: accent }}>About</span>
              <h1 className="font-headline text-5xl md:text-7xl headline-tight text-[#1c1c19] mb-10">
                Where schooling <span className="italic font-light">falls short.</span>
              </h1>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="border-t border-[#1c1c19] pt-10 grid grid-cols-1 md:grid-cols-12 gap-10">
                <div className="md:col-span-4">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/60">The project</span>
                </div>
                <div className="md:col-span-8 font-body text-base text-[#1c1c19]/80 leading-relaxed space-y-6">
                  <p>Whitespace India Education is a planned index of gaps in schooling across Indian districts. It will score each district on access to schools, on learning outcomes and on the adequacy of school buildings and services. The sources will be UDISE+, the National Achievement Survey and the Census, all published by the government, together with the ASER surveys run by Pratham, a non-governmental organisation. Until that data is in place, these pages run on placeholder figures.</p>
                  <p>The aim is to find the districts where education work would do the most good, with a score that anyone can reproduce from public records.</p>
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={0.2}>
              <div className="border-t border-[#1c1c19] pt-10 mt-16 grid grid-cols-1 md:grid-cols-12 gap-10">
                <div className="md:col-span-4">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/60">Planned sources</span>
                </div>
                <div className="md:col-span-8">
                  <ul className="space-y-4 font-body text-sm text-[#1c1c19]/80 leading-relaxed">
                    <li className="border-b border-[#1c1c19]/20 pb-4">UDISE+ (Unified District Information System for Education Plus), 2021-22</li>
                    <li className="border-b border-[#1c1c19]/20 pb-4">National Achievement Survey (NAS) 2021: learning outcomes by grade</li>
                    <li className="border-b border-[#1c1c19]/20 pb-4">ASER (Annual Status of Education Report), run by Pratham: reading and arithmetic levels</li>
                    <li className="pb-4">Census of India 2011: district populations</li>
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
