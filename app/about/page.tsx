"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata = {
  title: "About",
  description: "About Whitespace India CSR: Quantifying the gap between where philanthropic money goes and where people need it most.",
  alternates: {
    canonical: "https://whitespaceindia-csr.vercel.app/about",
  },
};

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

function AnimatedBar({ width, color, delay = 0 }: { width: string; color: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  return (
    <div ref={ref} className="h-3 rounded-full bg-white/5 overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        initial={{ width: "0%" }}
        animate={inView ? { width } : { width: "0%" }}
        transition={{ duration: 1, delay, ease: [0.16, 1, 0.3, 1] }}
        style={{ background: color }}
      />
    </div>
  );
}

function ComparisonChart() {
  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6 md:p-8">
      <p className="text-xs text-[#64748B] uppercase tracking-wider font-semibold mb-6">
        The mismatch, illustrated
      </p>
      <div className="space-y-6">
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-white font-medium">Bihar</span>
            <span className="text-sm text-[#94A3B8]">Poverty rate ~33.8%</span>
          </div>
          <div className="flex gap-3 items-center">
            <div className="flex-1">
              <AnimatedBar width="33.8%" color="#EF4444" delay={0} />
              <p className="text-xs text-[#64748B] mt-1">Poverty headcount</p>
            </div>
            <div className="flex-1">
              <AnimatedBar width="8%" color="rgba(245,166,35,0.6)" delay={0.2} />
              <p className="text-xs text-[#64748B] mt-1">Relative CSR per person</p>
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-white font-medium">Maharashtra</span>
            <span className="text-sm text-[#94A3B8]">Poverty rate ~3.5%</span>
          </div>
          <div className="flex gap-3 items-center">
            <div className="flex-1">
              <AnimatedBar width="3.5%" color="#EF4444" delay={0.4} />
              <p className="text-xs text-[#64748B] mt-1">Poverty headcount</p>
            </div>
            <div className="flex-1">
              <AnimatedBar width="85%" color="#F5A623" delay={0.6} />
              <p className="text-xs text-[#64748B] mt-1">Relative CSR per person</p>
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs text-[#475569] mt-5 pt-4 border-t border-white/5">
        Bihar has nearly ten times the poverty rate but receives a fraction of the CSR per person. This tool quantifies that gap for every district.
      </p>
    </div>
  );
}

const DIMENSIONS = [
  {
    letter: "N",
    name: "Poverty Severity",
    desc: "MPI headcount ratio from NITI Aayog. What fraction of the district's population is multidimensionally poor.",
    weight: "40%",
    color: "#EF4444",
  },
  {
    letter: "G",
    name: "Funding Gap",
    desc: "How much less CSR per person the district receives compared to its population-tier median. Benchmarked against similar-sized districts.",
    weight: "40%",
    color: "#F5A623",
  },
  {
    letter: "U",
    name: "Persistence",
    desc: "What fraction of 2015-16 poverty remains in 2019-21. Districts where poverty has barely moved despite national progress.",
    weight: "20%",
    color: "#7C3AED",
  },
];

const PIPELINE_STEPS = [
  { label: "NITI Aayog MPI", sub: "583 districts" },
  { label: "MCA CSR Data", sub: "10 fiscal years" },
  { label: "Census 2011", sub: "Population baseline" },
];

export default function AboutPage() {
  return (
    <main className="bg-[#0B1526] min-h-screen">
      <Navbar />

      {/* Page header */}
      <section className="relative pt-32 pb-16 px-4 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/hero-bg.png')", opacity: 0.12 }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0B1526]/70 to-[#0B1526]" />
        <div className="relative max-w-4xl mx-auto">
          <h1 className="font-display text-5xl md:text-6xl text-white leading-tight mb-4">
            About This Project
          </h1>
          <p className="text-xl text-[#94A3B8] max-w-2xl leading-relaxed">
            Quantifying the gap between where philanthropic money goes and where people need it most.
          </p>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 pb-20">

        {/* The Problem - visual comparison */}
        <FadeIn>
          <section className="py-12">
            <h2 className="font-display text-2xl text-white mb-6">The Problem</h2>
            <p className="text-[#C8D3E0] text-lg leading-relaxed mb-8">
              CSR spending in India reached thirty-five thousand crore in FY2023-24. Most of that money flows to districts where corporate offices sit. The districts with the deepest poverty receive the least funding per person.
            </p>

            {/* Bihar vs Maharashtra comparison */}
            <ComparisonChart />
          </section>
        </FadeIn>

        {/* What the tool does */}
        <FadeIn>
          <section className="py-8">
            <h2 className="font-display text-2xl text-white mb-5">What This Tool Does</h2>
            <p className="text-[#C8D3E0] text-lg leading-relaxed">
              Whitespace India CSR ranks every Indian district by the gap between poverty and philanthropic funding. It produces a single composite score - the Philanthropic Opportunity Score - that tells you where capital is most absent relative to need. The simulator lets you adjust weights, filter by sector, and generate district-level research briefs.
            </p>
          </section>
        </FadeIn>

        {/* Data pipeline flow */}
        <FadeIn>
          <section className="py-8">
            <h2 className="font-display text-2xl text-white mb-6">Data Pipeline</h2>
            <div className="flex flex-col md:flex-row items-stretch gap-3">
              {/* Source cards */}
              {PIPELINE_STEPS.map((step, i) => (
                <div key={step.label} className="flex-1 flex flex-col md:flex-row items-center gap-3">
                  <div className="flex-1 w-full bg-white/[0.03] border border-white/[0.07] rounded-xl p-4 text-center">
                    <div className="text-sm text-white font-medium">{step.label}</div>
                    <div className="text-xs text-[#64748B] mt-0.5">{step.sub}</div>
                  </div>
                  {i < PIPELINE_STEPS.length - 1 && (
                    <svg className="w-5 h-5 text-[#475569] shrink-0 rotate-90 md:rotate-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  )}
                </div>
              ))}
              {/* Arrow to merge */}
              <svg className="w-5 h-5 text-[#475569] shrink-0 self-center rotate-90 md:rotate-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              {/* Output */}
              <div className="flex-1 bg-[#F5A623]/10 border border-[#F5A623]/20 rounded-xl p-4 text-center">
                <div className="text-sm text-[#F5A623] font-medium">Merge & Score</div>
                <div className="text-xs text-[#64748B] mt-0.5">583 district POS</div>
              </div>
            </div>
            <p className="text-sm text-[#64748B] mt-4 leading-relaxed">
              Districts are matched across datasets using fuzzy string matching, then grouped into three population tiers for like-for-like CSR benchmarking. Small rural districts are compared to other small districts, not to Mumbai.
            </p>
          </section>
        </FadeIn>

        {/* Three scoring dimensions */}
        <FadeIn>
          <section className="py-8">
            <h2 className="font-display text-2xl text-white mb-6">Three Scoring Dimensions</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {DIMENSIONS.map((dim) => (
                <div
                  key={dim.letter}
                  className="border border-white/[0.07] rounded-xl p-5 relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 w-10 h-0.5" style={{ background: dim.color }} />
                  <div className="flex items-center gap-3 mb-3">
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                      style={{ background: `${dim.color}15`, color: dim.color }}
                    >
                      {dim.letter}
                    </span>
                    <span className="text-xs text-[#64748B] font-medium">Weight: {dim.weight}</span>
                  </div>
                  <h3 className="text-white font-medium mb-2">{dim.name}</h3>
                  <p className="text-sm text-[#94A3B8] leading-relaxed">{dim.desc}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-[#64748B] mt-4 leading-relaxed">
              Each dimension is min-max normalized within its population tier, then combined: POS = (0.40 x N + 0.40 x G + 0.20 x U) x 100. Weights are adjustable in the simulator.
            </p>
          </section>
        </FadeIn>

        {/* Who this is for */}
        <FadeIn>
          <section className="py-8">
            <h2 className="font-display text-2xl text-white mb-5">Who This Is For</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { role: "Program Officers", context: "Deciding where to open a new grant window" },
                { role: "CSR Heads", context: "Reporting geographic strategy to the board" },
                { role: "Philanthropic Advisors", context: "Building investment cases for clients" },
                { role: "Researchers", context: "Studying CSR allocation and equity patterns" },
              ].map((item) => (
                <div key={item.role} className="flex gap-3 items-start bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
                  <svg className="w-4 h-4 text-[#F5A623] shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <div>
                    <span className="text-white text-sm font-medium">{item.role}</span>
                    <span className="text-sm text-[#64748B]"> - {item.context}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Key numbers */}
        <FadeIn>
          <section className="py-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { value: "583", label: "districts scored" },
                { value: "10", label: "years of CSR data" },
                { value: "49", label: "whitespace districts" },
                { value: "100%", label: "open public data" },
              ].map(({ value, label }) => (
                <div key={label} className="border border-white/[0.07] rounded-xl p-5 text-center">
                  <div className="font-display text-3xl font-bold text-[#F5A623] mb-1">
                    {value}
                  </div>
                  <div className="text-xs text-[#94A3B8] uppercase tracking-wider">{label}</div>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Data Acknowledgments */}
        <FadeIn>
          <section className="py-8 border-t border-white/10 mt-4">
            <h2 className="font-display text-2xl text-white mb-6">Data Sources</h2>
            <div className="space-y-3">
              {[
                {
                  tag: "Poverty",
                  text: "NITI Aayog National Multidimensional Poverty Index 2023, based on NFHS-5 (2019-21), using the Alkire-Foster method from OPHI, University of Oxford.",
                },
                {
                  tag: "CSR",
                  text: "Ministry of Corporate Affairs, Government of India, via Dataful.in (Dataset ID 1612). Ten fiscal years of district-level CSR spending.",
                },
                {
                  tag: "Population",
                  text: "Census of India 2011, Registrar General of India. Used for population-tier stratification.",
                },
              ].map((src) => (
                <div key={src.tag} className="flex gap-4 items-start border border-white/[0.06] rounded-xl p-5">
                  <span className="shrink-0 text-[#F5A623] font-semibold text-xs uppercase tracking-wider pt-0.5 w-20">
                    {src.tag}
                  </span>
                  <p className="text-sm text-[#94A3B8] leading-relaxed">{src.text}</p>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Contact */}
        <FadeIn>
          <section className="py-8 border-t border-white/10 mt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div>
                <h2 className="font-display text-2xl text-white mb-2">Get in Touch</h2>
                <p className="text-[#94A3B8]">
                  Questions about the methodology, data, or applying this for your foundation?
                </p>
              </div>
              <a
                href="https://www.linkedin.com/in/souhardsharma/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 bg-[#F5A623] text-[#0B1526] font-bold px-6 py-3 rounded-full hover:bg-[#FBBF24] transition-colors shrink-0"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
                Contact on LinkedIn
              </a>
            </div>
          </section>
        </FadeIn>

      </div>

      <Footer />
    </main>
  );
}
