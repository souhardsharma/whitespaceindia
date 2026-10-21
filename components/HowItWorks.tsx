"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import type { VerticalConfig } from "@/lib/verticals/types";

const DEFAULT_ACCENT = "#BD402C";

const defaultSteps = [
  {
    number: "01",
    tag: "Input",
    title: "Sector",
    text: "The index can be scored on all CSR spending or on one of ten sectors, such as education, health care or sanitation. With a sector chosen, the funding gap is calculated from that sector's spending alone, so a district with no spending in it gets the largest possible gap, while poverty and persistence stay as they are.",
  },
  {
    number: "02",
    tag: "Weighting",
    title: "Weights",
    text: "The score combines poverty, the funding gap and persistence, each with its own weight. You can move the sliders to weight them differently, or choose one of the presets.",
  },
  {
    number: "03",
    tag: "Output",
    title: "Ranking",
    text: "Every scored district is listed by its score, highest first, and the order updates as the weights change. Clicking a state on the map lists only that state's districts.",
  },
  {
    number: "04",
    tag: "Export",
    title: "Research brief",
    text: "Clicking a district opens a short research brief on it, which you can download as a PDF.",
  },
];

export default function HowItWorks({ vertical }: { vertical?: VerticalConfig }) {
  const accent = vertical?.theme.accent ?? DEFAULT_ACCENT;
  const steps = vertical?.howItWorksSteps ?? defaultSteps;
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
            <span className="font-label text-[11px] uppercase tracking-[0.3em] block mb-4" style={{ color: accent }}>
              01 / How It Works
            </span>
            <div className="h-px bg-[#1c1c19] w-24" />
          </div>
          <div className="md:col-span-9">
            <h2 className="font-headline text-4xl md:text-6xl lg:text-7xl headline-tight text-[#1c1c19] mb-6">
              How the index <span className="italic font-light">works</span>
            </h2>
            <p className="font-body text-base md:text-lg text-[#1c1c19]/75 leading-relaxed max-w-2xl">
              A district&apos;s score depends on the sector and the weights chosen in the first two steps, and the ranking and the research briefs follow from that score.
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
                <span className="font-label text-[10px] uppercase tracking-[0.3em]" style={{ color: accent }}>
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
            Scores are precomputed from the published data
          </span>
        </motion.div>
      </div>
    </section>
  );
}
