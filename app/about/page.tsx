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
          Poverty and CSR per person
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
              Share poor · 33.76%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <AnimatedBar width="100%" color="#BD402C" delay={0} />
              <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-3">
                Share poor
              </p>
            </div>
            <div>
              <AnimatedBar width="5%" color="#1c1c19" delay={0.2} />
              <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-3">
                CSR per person, relative
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
              Share poor · 7.81%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <AnimatedBar width="23%" color="#BD402C" delay={0.4} />
              <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-3">
                Share poor
              </p>
            </div>
            <div>
              <AnimatedBar width="100%" color="#1c1c19" delay={0.6} />
              <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-3">
                CSR per person, relative
              </p>
            </div>
          </div>
        </div>
      </div>
      <p className="font-body text-sm text-[#1c1c19]/70 italic mt-8 pt-5 border-t border-[#1c1c19] leading-relaxed">
        The share of Bihar&apos;s people who are multidimensionally poor is more than four times Maharashtra&apos;s (33.76% against 7.81% in 2019-21, by NITI Aayog&apos;s count), yet Maharashtra receives about {csrRatio} times as much CSR spending per person. The index measures the same gap for each district.
      </p>
    </div>
  );
}

const DIMENSIONS = [
  {
    letter: "N",
    name: "Poverty",
    desc: "The share of the district's people who were multidimensionally poor in 2019-21, which NITI Aayog calls the headcount ratio.",
    weight: "40%",
  },
  {
    letter: "G",
    name: "Funding gap",
    desc: "How far the district's CSR spending per person falls below the median for districts of similar population. A district at or above that median has a gap of zero.",
    weight: "40%",
  },
  {
    letter: "U",
    name: "Persistence",
    desc: "The 2019-21 headcount divided by the 2015-16 one, which gives the share of the earlier poverty still present. A district where poverty has not fallen scores 1 or more.",
    weight: "20%",
  },
];

const PIPELINE_STEPS = [
  { label: "NITI Aayog MPI", sub: "Poverty data for 653 districts" },
  { label: "MCA CSR Data", sub: "Ten fiscal years of spending by district, via Dataful" },
  { label: "Census 2011", sub: "District population" },
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
    fetch("/data/csr/meta.json")
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
              CSR Opportunity Index
            </span>
            <div className="h-px bg-[#1c1c19] mt-4 w-24" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
            <div className="md:col-span-8">
              <h1 className="font-headline text-5xl sm:text-6xl md:text-7xl lg:text-8xl headline-tight text-[#1c1c19]">
                About the<br />
                <span className="italic font-light">index</span>
              </h1>
              <p className="mt-8 md:mt-10 max-w-2xl font-body text-lg md:text-xl leading-relaxed text-[#1c1c19]/90">
                Larger Indian companies must spend part of their profits on corporate social responsibility (CSR) and report where the money went. The index sets that reported spending against poverty in each district, to show where need is high and recorded spending is low.
              </p>
            </div>
            <div className="md:col-span-4 flex flex-col gap-6 md:mt-4">
              <div className="border-t border-[#1c1c19] pt-6">
                <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-3">
                  Status
                </span>
                <p className="font-body text-sm text-[#1c1c19]/70">
                  The data and code are published, and the scores can be rebuilt from them.
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
              title={<>Spending and <span className="italic font-light">need</span></>}
            />
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 items-start">
              <div className="md:col-span-5">
                <p className="font-body text-base md:text-lg text-[#1c1c19]/85 leading-relaxed">
                  Companies reported over twenty-one thousand crore rupees of CSR spending in FY2023-24 that can be traced to a named district, according to Ministry of Corporate Affairs filings. Further spending was filed as &quot;Pan India&quot; or named no district, so it cannot be placed. The traceable money is spread very unevenly between states, as the comparison of Bihar and Maharashtra shows.
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
              title={<>What the index <span className="italic font-light">does</span></>}
            />
            <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#f6f3ee]">
              <p className="font-body text-base md:text-lg text-[#1c1c19]/85 leading-relaxed">
                The CSR Opportunity Index ranks {totalDistricts} districts by how much poverty they carry against how little CSR spending they receive. Each district gets a score from 0 to 100, the Philanthropic Opportunity Score (POS), and a higher score means more poverty relative to recorded spending. The index also flags {whitespaceCount} whitespace districts, where CSR spending per person is in the bottom 25% of all districts and the share of people in poverty is in the top 25%. On the index page you can change the weights behind the score or recompute it for a single CSR sector, and download a research brief on any district.
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
              title={<>How the data is <span className="italic font-light">joined</span></>}
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
                  Joined and scored
                </p>
                <p className="font-body text-xs text-white/80 italic">
                  {totalDistricts} districts with a POS
                </p>
              </div>
            </div>
            <p className="font-body text-sm text-[#1c1c19]/70 italic mt-6 leading-relaxed max-w-3xl">
              We matched districts across the three datasets by name, allowing for differences in spelling where names did not agree exactly. Districts are then split into three equal groups by population, and each district&apos;s spending is compared with the median of its own group, so that small districts are measured against other small districts.
            </p>
          </section>
        </FadeIn>

        {/* Three scoring dimensions */}
        <FadeIn>
          <section>
            <SectionHeader
              num="04"
              tag="Dimensions"
              title={<>What the score <span className="italic font-light">measures</span></>}
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
              Each measure is rescaled to run from 0 to 1 across all {totalDistricts} districts (min-max normalisation, marked by the hat over each letter), then weighted and added. The letters stand for need, gap and unresolved poverty. For districts with no 2015-16 figure, persistence is set to the national median. The weights have default values, and you can change them on the index page.
            </p>
          </section>
        </FadeIn>

        {/* Who this is for */}
        <FadeIn>
          <section>
            <SectionHeader
              num="05"
              tag="Audience"
              title={<>Who it is <span className="italic font-light">for</span></>}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 border border-[#1c1c19]">
              {[
                { role: "Programme officers", context: "They can compare districts before deciding where a new grant round should go." },
                { role: "CSR heads", context: "They can show a board how the company's district spending lines up with poverty." },
                { role: "Philanthropy advisers", context: "They can set a client's giving against need in the districts it reaches." },
                { role: "Researchers", context: "They can study how CSR spending is spread across districts and states, using the published data." },
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
              title={<>Key <span className="italic font-light">numbers</span></>}
            />
            <div className="grid grid-cols-2 md:grid-cols-4 border border-[#1c1c19]">
              {[
                { value: String(totalDistricts), label: "Districts scored" },
                { value: "10", label: "Years of CSR data" },
                { value: String(whitespaceCount), label: "Whitespace districts" },
                { value: "FY14-24", label: "CSR data coverage" },
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
              title={<><span className="italic font-light">Sources</span></>}
            />
            <div className="border border-[#1c1c19]">
              {[
                {
                  tag: "Poverty",
                  text: "NITI Aayog, National Multidimensional Poverty Index 2023, based on NFHS-5 (2019-21) and computed with the Alkire-Foster method of the Oxford Poverty and Human Development Initiative (OPHI) at the University of Oxford.",
                },
                {
                  tag: "CSR",
                  text: "CSR filings to the Ministry of Corporate Affairs, Government of India, as compiled by Dataful.in (dataset ID 1612), with ten fiscal years of district-level spending.",
                },
                {
                  tag: "Population",
                  text: "Census of India 2011, Office of the Registrar General of India. District populations are the denominator of CSR per person and set each district's population group.",
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
                    Questions and <span className="italic font-light">corrections</span>
                  </h2>
                  <p className="font-body text-sm md:text-base text-[#fcf9f4]/80 max-w-md leading-relaxed">
                    Souhard Sharma built and maintains the index. You can reach him on LinkedIn about the method or the data, or about using the index in a foundation&apos;s work.
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
