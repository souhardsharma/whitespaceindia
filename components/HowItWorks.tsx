"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";

const steps = [
  {
    number: "01",
    tag: "Input",
    title: "Choose Your Sector",
    text: "Pick a development sector (education, health, sanitation, or any of ten focus areas). When a sector is selected, only CSR spending in that sector is used to compute the funding gap (G). Districts with no activity in the chosen sector will show a maximum gap. Need (N) and Persistence (U) remain unchanged.",
  },
  {
    number: "02",
    tag: "Weighting",
    title: "Set Your Priorities",
    text: "Three weight sliders. Drag them to reflect what matters most to your foundation. Poverty severity, funding gap, persistence. Weight each to match your theory of change, or pick a preset.",
  },
  {
    number: "03",
    tag: "Output",
    title: "See Ranked Districts",
    text: "A live-ranked ledger of every scored district, ordered by philanthropic opportunity. Click any state on the map to filter down to that geography.",
  },
  {
    number: "04",
    tag: "Export",
    title: "Download a Brief",
    text: "Click any district to generate a research brief with key data, context, and gaps worth studying. Export as PDF.",
  },
];

export default function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="relative bg-[#fcf9f4] border-t border-[#1c1c19] py-20 md:py-28 px-6 md:px-12 lg:px-16">
      <div className="max-w-7xl mx-auto" ref={ref}>
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-16 md:mb-20"
        >
          <div className="md:col-span-3">
            <span className="font-label text-[11px] uppercase tracking-[0.3em] text-[#BD402C] block mb-4">
              01 / How It Works
            </span>
            <div className="h-px bg-[#1c1c19] w-24" />
          </div>
          <div className="md:col-span-9">
            <h2 className="font-headline text-4xl md:text-6xl lg:text-7xl headline-tight text-[#1c1c19] mb-6">
              From data <span className="italic font-light">to decision.</span>
            </h2>
            <p className="font-body text-base md:text-lg text-[#1c1c19]/75 leading-relaxed max-w-2xl">
              Four steps to surface your highest-opportunity district. No dashboards, no noise. Just evidence, ranked.
            </p>
          </div>
        </motion.div>

        {/* Steps grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 border border-[#1c1c19]">
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              className={`p-8 md:p-10 ${
                i % 2 === 0 ? "md:border-r" : ""
              } ${
                i < 2 ? "border-b" : ""
              } border-[#1c1c19] ${
                i === 0 || i === 3 ? "bg-[#fcf9f4]" : "bg-[#f6f3ee]"
              }`}
            >
              <div className="flex items-start justify-between mb-6">
                <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C]">
                  {step.tag}
                </span>
                <span className="font-headline text-6xl md:text-7xl leading-none text-[#1c1c19]/10">
                  {step.number}
                </span>
              </div>
              <h3 className="font-headline text-2xl md:text-3xl text-[#1c1c19] mb-4 headline-tight">
                {step.title}
              </h3>
              <div className="h-px bg-[#1c1c19]/30 w-12 mb-5" />
              <p className="font-body text-sm md:text-base text-[#1c1c19]/75 leading-relaxed">
                {step.text}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="flex justify-end mt-6"
        >
          <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/40">
            Precomputed scores · Updated April 2026
          </span>
        </motion.div>
      </div>
    </section>
  );
}
