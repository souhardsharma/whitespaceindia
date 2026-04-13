"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";

const steps = [
  {
    number: "01",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    ),
    title: "Choose Your Sector",
    text: "Pick a development sector - education, health, sanitation, or any of ten focus areas. Rankings recalculate instantly using sector-specific CSR data.",
    accent: "#F5A623",
  },
  {
    number: "02",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M4 21V14" /><path d="M4 10V3" />
        <path d="M12 21V12" /><path d="M12 8V3" />
        <path d="M20 21V16" /><path d="M20 12V3" />
        <path d="M2 14h4" /><path d="M10 8h4" /><path d="M18 16h4" />
      </svg>
    ),
    title: "Set Your Priorities",
    text: "Three weight sliders. Drag them to reflect what matters most to your foundation. Poverty severity, funding gap, persistence - weight each to match your theory of change, or pick a preset.",
    accent: "#7C3AED",
  },
  {
    number: "03",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M3 3v18h18" /><path d="M7 16l4-8 4 5 5-6" />
      </svg>
    ),
    title: "See Ranked Districts",
    text: "A live-ranked list of every scored district, ordered by philanthropic opportunity. Click any state on the map to filter down to that geography.",
    accent: "#10B981",
  },
  {
    number: "04",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" />
      </svg>
    ),
    title: "Download a Brief",
    text: "Click any district to generate a research brief with key data, context, and entry points for philanthropic investment. Export as PDF.",
    accent: "#3B82F6",
  },
];

export default function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="relative py-28 overflow-hidden" style={{ background: "linear-gradient(180deg, #0B1526 0%, #0F1E35 50%, #0B1526 100%)" }}>
      {/* Background decoration */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle at 20% 50%, rgba(124,58,237,0.05) 0%, transparent 60%), radial-gradient(circle at 80% 50%, rgba(245,166,35,0.05) 0%, transparent 60%)",
        }}
      />

      <div className="max-w-6xl mx-auto px-4" ref={ref}>
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="text-center mb-20"
        >
          <p className="text-[#F5A623] text-xs font-semibold tracking-widest uppercase mb-4">
            How It Works
          </p>
          <h2 className="font-display text-4xl md:text-5xl text-white">
            From data to decision
          </h2>
          <p className="mt-4 text-[#94A3B8] text-lg max-w-xl mx-auto">
            Four steps to find your highest-opportunity district.
          </p>
        </motion.div>

        {/* Steps grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 40 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className="group relative rounded-2xl overflow-hidden border border-white/[0.08] hover:border-white/[0.15] transition-colors duration-300"
              style={{ background: `linear-gradient(135deg, ${step.accent}08, rgba(13,27,46,0.9))` }}
            >
              <div className="relative p-7 h-full">
                {/* Step number */}
                <div className="flex items-start justify-between mb-5">
                  <div
                    className="p-2.5 rounded-xl"
                    style={{ background: `${step.accent}15`, color: step.accent }}
                  >
                    {step.icon}
                  </div>
                  <span
                    className="font-display text-5xl font-bold opacity-10"
                    style={{ color: step.accent, lineHeight: 1 }}
                  >
                    {step.number}
                  </span>
                </div>

                <h3 className="font-display text-xl text-white mb-3">
                  {step.title}
                </h3>
                <p className="text-sm text-[#94A3B8] leading-relaxed">
                  {step.text}
                </p>

                {/* Bottom accent */}
                <div
                  className="absolute bottom-0 left-0 right-0 h-px"
                  style={{ background: `linear-gradient(90deg, transparent, ${step.accent}30, transparent)` }}
                />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
