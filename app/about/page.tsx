"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

interface AboutMeta {
  total_districts?: number;
  whitespace_count?: number;
  state_stats?: {
    bihar?: { csr_per_person_inr?: number };
    maharashtra?: { csr_per_person_inr?: number };
  };
}

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
    <div ref={ref} className="h-[2px] bg-[#1c1c19]/10 overflow-hidden">
      <motion.div
        className="h-full"
        initial={{ width: "0%" }}
        animate={inView ? { width } : { width: "0%" }}
        transition={{ duration: 1, delay, ease: [0.16, 1, 0.3, 1] }}
        style={{ background: color }}
      />
    </div>
  );
}

function ComparisonChart({ csrRatio }: { csrRatio: number }) {
  return (
    <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#f6f3ee]">
      <div className="flex items-center justify-between mb-8">
        <p className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C] font-bold">
          Key Finding // The Mismatch
        </p>
        <span className="font-label text-[10px] tracking-widest text-[#1c1c19]/40">
          Figure 01
        </span>
      </div>
      <div className="space-y-10">
        <div>
          <div className="flex items-baseline justify-between mb-4 border-b border-[#1c1c19] pb-3">
            <span className="font-headline text-2xl italic font-light text-[#1c1c19]">
              Bihar
            </span>
            <span className="font-label text-[11px] uppercase tracking-[0.2em] text-[#1c1c19]/60">
              Poverty Rate · 33.76%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <AnimatedBar width="100%" color="#BD402C" delay={0} />
              <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-3">
                Poverty Headcount
              </p>
            </div>
            <div>
              <AnimatedBar width="5%" color="#1c1c19" delay={0.2} />
              <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-3">
                Relative CSR / Person
              </p>
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-4 border-b border-[#1c1c19] pb-3">
            <span className="font-headline text-2xl italic font-light text-[#1c1c19]">
              Maharashtra
            </span>
            <span className="font-label text-[11px] uppercase tracking-[0.2em] text-[#1c1c19]/60">
              Poverty Rate · 7.81%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <AnimatedBar width="23%" color="#BD402C" delay={0.4} />
              <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-3">
                Poverty Headcount
              </p>
            </div>
            <div>
              <AnimatedBar width="100%" color="#1c1c19" delay={0.6} />
              <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-3">
                Relative CSR / Person
              </p>
            </div>
          </div>
        </div>
      </div>
      <p className="font-body text-sm text-[#1c1c19]/70 italic mt-8 pt-5 border-t border-[#1c1c19] leading-relaxed">
        Bihar&apos;s poverty rate is more than four times Maharashtra&apos;s (33.76% vs 7.81%), yet Maharashtra receives roughly {csrRatio} times more CSR per person. This tool quantifies that gap for every district.
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
  },
  {
    letter: "G",
    name: "Funding Gap",
    desc: "How much less CSR per person the district receives compared to its population-tier median. Benchmarked against similar-sized districts.",
    weight: "40%",
  },
  {
    letter: "U",
    name: "Persistence",
    desc: "What fraction of 2015-16 poverty remains in 2019-21. Districts where poverty has barely moved despite national progress.",
    weight: "20%",
  },
];

const PIPELINE_STEPS = [
  { label: "NITI Aayog MPI", sub: "653 districts extracted" },
  { label: "MCA CSR Data", sub: "10 fiscal years (via Dataful.in)" },
  { label: "Census 2011", sub: "Population baseline" },
];

function SectionHeader({ num, tag, title, lead }: { num: string; tag: string; title: React.ReactNode; lead?: string }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-10">
      <div className="md:col-span-3">
        <span className="font-label text-[11px] uppercase tracking-[0.3em] text-[#BD402C] block mb-4">
          {num} / {tag}
        </span>
        <div className="h-px bg-[#1c1c19] w-24" />
      </div>
      <div className="md:col-span-9">
        <h2 className="font-headline text-3xl md:text-5xl headline-tight text-[#1c1c19] mb-4">
          {title}
        </h2>
        {lead && (
          <p className="font-body text-base text-[#1c1c19]/75 leading-relaxed max-w-2xl">
            {lead}
          </p>
        )}
      </div>
    </div>
  );
}

export default function AboutPage() {
  const [meta, setMeta] = useState<AboutMeta | null>(null);
  useEffect(() => {
    fetch("/data/meta.json")
      .then((r) => r.json())
      .then((m: AboutMeta) => setMeta(m))
      .catch(() => {});
  }, []);
  const totalDistricts = meta?.total_districts ?? 651;
  const whitespaceCount = meta?.whitespace_count ?? 44;
  const bh = meta?.state_stats?.bihar?.csr_per_person_inr;
  const mh = meta?.state_stats?.maharashtra?.csr_per_person_inr;
  const csrRatio = bh && mh && bh > 0 ? Math.round(mh / bh) : 20;
  return (
    <main id="main-content" className="bg-[#fcf9f4] min-h-screen">
      <Navbar />

      {/* Page header */}
      <section className="relative bg-[#fcf9f4] pt-32 md:pt-40 pb-16 md:pb-20 px-6 md:px-12 lg:px-16 border-b border-[#1c1c19]">
        <div className="max-w-7xl mx-auto">
          <div className="mb-10">
            <span className="font-label text-[10px] md:text-[11px] uppercase tracking-[0.4em] text-[#BD402C]">
              About This Project
            </span>
            <div className="h-px bg-[#1c1c19] mt-4 w-24" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
            <div className="md:col-span-8">
              <h1 className="font-headline text-5xl sm:text-6xl md:text-7xl lg:text-8xl headline-tight text-[#1c1c19]">
                About the<br />
                <span className="italic font-light">project.</span>
              </h1>
              <p className="mt-8 md:mt-10 max-w-2xl font-body text-lg md:text-xl leading-relaxed text-[#1c1c19]/90">
                Quantifying the gap between where philanthropic money goes and where people need it most.
              </p>
            </div>
            <div className="md:col-span-4 flex flex-col gap-6 md:mt-4">
              <div className="border-t border-[#1c1c19] pt-6">
                <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-3">
                  Status
                </span>
                <p className="font-body text-sm text-[#1c1c19]/70">
                  Open data. Reproducible methodology.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16 py-20 md:py-24 space-y-24">

        {/* The Problem */}
        <FadeIn>
          <section>
            <SectionHeader
              num="01"
              tag="The Problem"
              title={<>The <span className="italic font-light">mismatch.</span></>}
            />
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 items-start">
              <div className="md:col-span-5">
                <p className="font-body text-base md:text-lg text-[#1c1c19]/85 leading-relaxed">
                  CSR spending in India reached over twenty-one thousand crore rupees (district-attributable) in FY2023-24. Most of that money flows to districts where corporate offices sit. The districts with the deepest poverty receive the least funding per person.
                </p>
              </div>
              <div className="md:col-span-7">
                <ComparisonChart csrRatio={csrRatio} />
              </div>
            </div>
          </section>
        </FadeIn>

        {/* What the tool does */}
        <FadeIn>
          <section>
            <SectionHeader
              num="02"
              tag="The Tool"
              title={<>What this <span className="italic font-light">tool does.</span></>}
            />
            <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#f6f3ee]">
              <p className="font-body text-base md:text-lg text-[#1c1c19]/85 leading-relaxed">
                Whitespace India CSR ranks every Indian district by the gap between poverty and philanthropic funding. It produces a single composite score, the Philanthropic Opportunity Score, that tells you where capital is most absent relative to need. The simulator lets you adjust weights, filter by sector, and generate district-level research briefs.
              </p>
            </div>
          </section>
        </FadeIn>

        {/* Data pipeline flow */}
        <FadeIn>
          <section>
            <SectionHeader
              num="03"
              tag="The Pipeline"
              title={<>Three sources, <span className="italic font-light">one ledger.</span></>}
            />
            <div className="grid grid-cols-1 md:grid-cols-4 border border-[#1c1c19]">
              {PIPELINE_STEPS.map((step, i) => (
                <div
                  key={step.label}
                  className={`relative p-6 md:p-8 bg-[#fcf9f4] ${
                    i < PIPELINE_STEPS.length - 1
                      ? "border-b md:border-b-0 md:border-r border-[#1c1c19]"
                      : ""
                  } ${i % 2 === 1 ? "bg-[#f6f3ee]" : ""}`}
                >
                  <div className="flex items-start justify-between mb-5">
                    <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C]">
                      Source 0{i + 1}
                    </span>
                    <span className="font-headline text-4xl leading-none text-[#1c1c19]/10 italic font-light">
                      →
                    </span>
                  </div>
                  <p className="font-label text-[12px] uppercase tracking-[0.2em] text-[#1c1c19] font-bold mb-2">
                    {step.label}
                  </p>
                  <p className="font-body text-xs text-[#1c1c19]/60 italic">
                    {step.sub}
                  </p>
                </div>
              ))}
              <div className="p-6 md:p-8 bg-[#BD402C] text-white">
                <div className="flex items-start justify-between mb-5">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-white/70">
                    Output
                  </span>
                  <span className="font-headline text-4xl leading-none text-white/30 italic font-light">
                    =
                  </span>
                </div>
                <p className="font-label text-[12px] uppercase tracking-[0.2em] text-white font-bold mb-2">
                  Merge &amp; Score
                </p>
                <p className="font-body text-xs text-white/80 italic">
                  {totalDistricts} district POS
                </p>
              </div>
            </div>
            <p className="font-body text-sm text-[#1c1c19]/70 italic mt-6 leading-relaxed max-w-3xl">
              Districts are matched across datasets using fuzzy string matching, then grouped into three population tiers for like-for-like CSR benchmarking. Small rural districts are compared to other small districts, not to Mumbai.
            </p>
          </section>
        </FadeIn>

        {/* Three scoring dimensions */}
        <FadeIn>
          <section>
            <SectionHeader
              num="04"
              tag="Dimensions"
              title={<>The three <span className="italic font-light">axes.</span></>}
            />
            <div className="grid grid-cols-1 md:grid-cols-3 border border-[#1c1c19]">
              {DIMENSIONS.map((dim, i) => (
                <div
                  key={dim.letter}
                  className={`p-8 md:p-10 ${i % 2 === 1 ? "bg-[#f6f3ee]" : "bg-[#fcf9f4]"} ${
                    i < 2 ? "border-b md:border-b-0 md:border-r border-[#1c1c19]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-6">
                    <span className="font-headline text-7xl md:text-8xl leading-none italic font-light text-[#BD402C]">
                      {dim.letter}
                    </span>
                    <span className="font-label text-xl font-bold text-[#BD402C] tracking-tighter">
                      {dim.weight}
                    </span>
                  </div>
                  <h3 className="font-label text-[11px] uppercase tracking-[0.2em] text-[#1c1c19] font-bold mb-3">
                    {dim.name}
                  </h3>
                  <div className="h-px bg-[#1c1c19]/30 w-12 mb-4" />
                  <p className="font-body text-sm text-[#1c1c19]/70 leading-relaxed">
                    {dim.desc}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-6 border border-[#1c1c19] bg-[#fcf9f4] p-6">
              <p className="font-headline italic text-base md:text-lg text-center text-[#BD402C]">
                POS = (0.40 × N̂ + 0.40 × Ĝ + 0.20 × Û) × 100
              </p>
            </div>
            <p className="font-body text-sm text-[#1c1c19]/70 italic mt-4 leading-relaxed">
              Each dimension is min-max normalized within its population tier, then combined. Weights are adjustable in the simulator.
            </p>
          </section>
        </FadeIn>

        {/* Who this is for */}
        <FadeIn>
          <section>
            <SectionHeader
              num="05"
              tag="Audience"
              title={<>Who this <span className="italic font-light">is for.</span></>}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 border border-[#1c1c19]">
              {[
                { role: "Program Officers", context: "Deciding where to open a new grant window" },
                { role: "CSR Heads", context: "Reporting geographic strategy to the board" },
                { role: "Philanthropic Advisors", context: "Building investment cases for clients" },
                { role: "Researchers", context: "Studying CSR allocation and equity patterns" },
              ].map((item, i) => (
                <div
                  key={item.role}
                  className={`p-6 md:p-8 ${
                    i < 2 ? "border-b border-[#1c1c19]" : ""
                  } ${i % 2 === 0 ? "md:border-r border-[#1c1c19] bg-[#fcf9f4]" : "bg-[#f6f3ee]"}`}
                >
                  <div className="flex items-start gap-5">
                    <span className="font-headline text-4xl italic font-light text-[#BD402C]/30 leading-none">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="flex-1">
                      <p className="font-label text-[11px] uppercase tracking-[0.2em] text-[#1c1c19] font-bold mb-2">
                        {item.role}
                      </p>
                      <p className="font-body text-sm text-[#1c1c19]/70 leading-relaxed">
                        {item.context}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Key numbers */}
        <FadeIn>
          <section>
            <SectionHeader
              num="06"
              tag="Key Numbers"
              title={<>The <span className="italic font-light">ledger line.</span></>}
            />
            <div className="grid grid-cols-2 md:grid-cols-4 border border-[#1c1c19]">
              {[
                { value: String(totalDistricts), label: "Districts Scored" },
                { value: "10", label: "Years of CSR Data" },
                { value: String(whitespaceCount), label: "Whitespace Districts" },
                { value: "FY14-24", label: "CSR Data Coverage" },
              ].map(({ value, label }, i) => (
                <div
                  key={label}
                  className={`p-6 md:p-8 ${i % 2 === 1 ? "bg-[#f6f3ee]" : "bg-[#fcf9f4]"} ${
                    i < 2 ? "border-b md:border-b-0 border-[#1c1c19]" : ""
                  } ${i < 3 ? "md:border-r border-[#1c1c19]" : ""} ${
                    i === 0 ? "border-r border-[#1c1c19]" : ""
                  } ${i === 2 ? "border-r border-[#1c1c19]" : ""}`}
                >
                  <div className="font-label text-4xl md:text-5xl font-bold text-[#BD402C] tracking-tighter mb-3">
                    {value}
                  </div>
                  <div className="h-px bg-[#1c1c19]/30 w-8 mb-3" />
                  <div className="font-label text-[10px] uppercase tracking-[0.2em] text-[#1c1c19]/70">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Data Acknowledgments */}
        <FadeIn>
          <section>
            <SectionHeader
              num="07"
              tag="Sources"
              title={<>The <span className="italic font-light">citations.</span></>}
            />
            <div className="border border-[#1c1c19]">
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
              ].map((src, i) => (
                <div
                  key={src.tag}
                  className={`grid grid-cols-1 md:grid-cols-12 gap-6 p-6 md:p-8 ${
                    i % 2 === 1 ? "bg-[#f6f3ee]" : "bg-[#fcf9f4]"
                  } ${i < 2 ? "border-b border-[#1c1c19]" : ""}`}
                >
                  <div className="md:col-span-3">
                    <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C] font-bold">
                      {src.tag}
                    </span>
                  </div>
                  <p className="md:col-span-9 font-body text-sm md:text-base text-[#1c1c19]/80 leading-relaxed">
                    {src.text}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Contact */}
        <FadeIn>
          <section>
            <div className="border border-[#1c1c19] bg-[#1c1c19] p-8 md:p-12 text-[#fcf9f4]">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div>
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#fcf9f4]/60 block mb-4">
                    Contact
                  </span>
                  <h2 className="font-headline text-3xl md:text-4xl headline-tight mb-3">
                    Get in <span className="italic font-light">touch.</span>
                  </h2>
                  <p className="font-body text-sm md:text-base text-[#fcf9f4]/80 max-w-md leading-relaxed">
                    Questions about the methodology, data, or applying this for your foundation?
                  </p>
                </div>
                <a
                  href="https://www.linkedin.com/in/souhardsharma/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group bg-[#BD402C] text-white font-label uppercase tracking-[0.25em] text-[11px] py-5 px-8 flex justify-between items-center gap-8 hover:bg-[#fcf9f4] hover:text-[#1c1c19] transition-colors shrink-0 w-full sm:w-auto sm:min-w-[280px]"
                >
                  <span className="flex items-center gap-3">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                    LinkedIn
                  </span>
                  <svg width="16" height="10" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M0 6h22M16 1l5 5-5 5" />
                  </svg>
                </a>
              </div>
            </div>
          </section>
        </FadeIn>

      </div>

      <Footer />
    </main>
  );
}
