"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import WeightsPanel from "@/components/WeightsPanel";
import IndiaMap from "@/components/IndiaMap";
import RankingList from "@/components/RankingList";
import BriefModal from "@/components/BriefModal";
import Footer from "@/components/Footer";
import {
  District,
  Weights,
  DEFAULT_WEIGHTS,
  rankDistricts,
} from "@/lib/score";

/* Debounce removed - direct state for instant reactivity */

function DataInsightCard({
  value,
  label,
  sub,
  delay = 0,
  accent = "#F5A623",
}: {
  value: string;
  label: string;
  sub: string;
  delay?: number;
  accent?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
      className="relative bg-white/[0.03] border border-white/[0.07] rounded-2xl p-8 overflow-hidden hover:border-white/[0.15] transition-colors duration-300"
    >
      <div
        className="absolute top-0 left-0 w-12 h-1 rounded-br-full"
        style={{ background: accent }}
      />
      <div
        className="font-display text-4xl md:text-5xl font-bold mb-2"
        style={{ color: accent }}
      >
        {value}
      </div>
      <div className="text-white font-medium mb-1">{label}</div>
      <div className="text-sm text-[#64748B]">{sub}</div>
    </motion.div>
  );
}

function InsightSection({ whitespaceCount }: { whitespaceCount: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-16 px-4">
      <div className="max-w-5xl mx-auto" ref={ref}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-12"
        >
          <p className="text-[#F5A623] text-xs font-semibold tracking-widest uppercase mb-3">
            Key Findings
          </p>
          <h2 className="font-display text-3xl md:text-4xl text-white">
            What the data reveals
          </h2>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <DataInsightCard
            value="₹72,319 Cr"
            label="Invisible CSR"
            sub="classified as Pan India - unattributable to any specific district"
            delay={0}
            accent="#F5A623"
          />
          <DataInsightCard
            value="33.76%"
            label="Bihar Poverty Rate"
            sub="among India's highest, yet Bihar receives a fraction of Maharashtra's CSR per person"
            delay={0.12}
            accent="#7C3AED"
          />
          <DataInsightCard
            value={String(whitespaceCount)}
            label="Neglected Districts"
            sub="high poverty and low funding - the philanthropic whitespaces"
            delay={0.24}
            accent="#EF4444"
          />
        </div>
      </div>
    </section>
  );
}

function BeyondSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section className="py-14 px-4">
      <div className="max-w-5xl mx-auto" ref={ref}>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="border border-white/[0.08] rounded-2xl p-8 md:p-10 card-glow"
        >
          <div className="flex flex-col md:flex-row md:items-start gap-8">
            <div className="flex-1">
              <motion.h2
                initial={{ opacity: 0, x: -12 }}
                animate={inView ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="font-display text-2xl text-white mb-3"
              >
                Beyond CSR
              </motion.h2>
              <motion.p
                initial={{ opacity: 0 }}
                animate={inView ? { opacity: 1 } : {}}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="text-[#94A3B8] leading-relaxed mb-4"
              >
                The same methodology can surface whitespaces in other public-data domains. Education infrastructure gaps, health access disparities, and energy poverty are next.
              </motion.p>
              <div className="flex flex-wrap gap-2">
                {["Education", "Health", "Energy"].map((v, i) => (
                  <motion.span
                    key={v}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={inView ? { opacity: 1, scale: 1 } : {}}
                    transition={{ duration: 0.4, delay: 0.3 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                    className="text-xs text-[#64748B] border border-white/10 rounded-full px-3 py-1.5 hover:border-[#F5A623]/30 hover:text-[#F5A623] transition-all duration-300 cursor-default"
                  >
                    {v}
                  </motion.span>
                ))}
              </div>
            </div>
            <motion.div
              initial={{ opacity: 0, x: 12 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="shrink-0"
            >
              <a
                href="https://www.linkedin.com/in/souhardsharma/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 border border-[#F5A623]/40 text-[#F5A623] font-medium text-sm rounded-full px-5 py-2.5 hover:bg-[#F5A623]/10 hover:border-[#F5A623]/60 hover:shadow-[0_0_20px_rgba(245,166,35,0.15)] transition-all duration-300"
              >
                Follow updates
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </a>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export default function HomePage() {
  const [districts, setDistricts] = useState<District[]>([]);
  const [sectorScores, setSectorScores] = useState<
    Record<string, Record<string, number>>
  >({});
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [sector, setSector] = useState("All Sectors");
  const [whitespaceOnly, setWhitespaceOnly] = useState(false);
  const [selectedDistrict, setSelectedDistrict] = useState<
    (District & { computed_pos: number }) | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [highlightedState, setHighlightedState] = useState<string | null>(null);

  const simulatorRef = useRef<HTMLDivElement>(null);
  const simulatorInView = useInView(simulatorRef, { once: true, margin: "-100px" });

  // Load data on mount
  useEffect(() => {
    Promise.all([
      fetch("/data/whitespace_master.json").then((r) => r.json()),
      fetch("/data/sector_scores.json").then((r) => r.json()),
    ])
      .then(([d, s]) => {
        setDistricts(d);
        setSectorScores(s);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  const rankedDistricts = useMemo(
    () =>
      districts.length > 0
        ? rankDistricts(
            districts,
            weights,
            sector,
            sectorScores,
            whitespaceOnly
          )
        : [],
    [districts, weights, sector, sectorScores, whitespaceOnly]
  );

  // When a state filter is active, re-rank 1..N within that state
  const displayDistricts = useMemo(() => {
    if (!highlightedState) return rankedDistricts;
    const filtered = rankedDistricts.filter((d) => d.state_name === highlightedState);
    return filtered.map((d, i) => ({ ...d, rank: i + 1 }));
  }, [rankedDistricts, highlightedState]);

  // Compute state averages for the map
  const stateAverages = useMemo(() => {
    const map: Record<string, { sum: number; count: number }> = {};
    for (const d of rankedDistricts) {
      if (!map[d.state_name]) map[d.state_name] = { sum: 0, count: 0 };
      map[d.state_name].sum += d.computed_pos;
      map[d.state_name].count += 1;
    }
    const result: Record<string, number> = {};
    for (const [state, { sum, count }] of Object.entries(map)) {
      result[state] = sum / count;
    }
    return result;
  }, [rankedDistricts]);

  // Count whitespace districts
  const whitespaceCount = useMemo(
    () => districts.filter((d) => d.is_whitespace).length,
    [districts]
  );

  const handleSelectDistrict = useCallback(
    (d: District) => {
      const ranked = rankedDistricts.find(
        (r) => r.district_lgd_code === d.district_lgd_code
      );
      if (ranked) setSelectedDistrict(ranked);
    },
    [rankedDistricts]
  );

  const handleStateClick = useCallback((stateName: string) => {
    setHighlightedState((prev) => (prev === stateName ? null : stateName));
  }, []);

  const handleReset = useCallback(() => {
    setWeights(DEFAULT_WEIGHTS);
    setSector("All Sectors");
    setWhitespaceOnly(false);
    setHighlightedState(null);
  }, []);

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Whitespace India CSR",
    url: "https://whitespaceindia-csr.vercel.app",
    description:
      "Interactive tool ranking 583 Indian districts by philanthropic opportunity. Combines NITI Aayog MPI poverty data with CSR spending to find where philanthropic capital can create the most impact.",
    potentialAction: {
      "@type": "SearchAction",
      target: "https://whitespaceindia-csr.vercel.app/#simulator",
    },
  };

  const datasetSchema = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "India District Philanthropic Opportunity Scores",
    description:
      "Composite Philanthropic Opportunity Score (POS) for 583 Indian districts, derived from NITI Aayog MPI 2023 poverty data and MCA CSR spending data.",
    url: "https://whitespaceindia-csr.vercel.app",
    creator: { "@type": "Organization", name: "Whitespace India CSR" },
    citation: [
      {
        "@type": "Dataset",
        name: "National Multidimensional Poverty Index 2023",
        creator: { "@type": "Organization", name: "NITI Aayog" },
        url: "https://niti.gov.in/sites/default/files/2023-07/Final-MPI_7thJuly.pdf",
      },
      {
        "@type": "Dataset",
        name: "CSR District-Level Spending Data",
        creator: {
          "@type": "Organization",
          name: "Ministry of Corporate Affairs, Government of India",
        },
        url: "https://www.csr.gov.in/",
      },
    ],
    temporalCoverage: "2014/2024",
    spatialCoverage: { "@type": "Place", name: "India" },
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is the Philanthropic Opportunity Score?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The Philanthropic Opportunity Score (POS) is a composite index that ranks India's 583 districts by the gap between philanthropic need and existing funding. It combines three components: poverty severity (MPI headcount ratio from NITI Aayog), funding gap (how much less CSR per person a district receives vs. its population-tier median), and persistent poverty (what fraction of 2015-16 poverty remains in 2019-21). Districts are grouped into three population tiers for like-for-like CSR benchmarking. Default weights are 40% poverty severity, 40% funding gap, and 20% persistence, adjustable via the simulator's weight sliders.",
        },
      },
      {
        "@type": "Question",
        name: "What data does Whitespace India use?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Whitespace India uses three public datasets: (1) NITI Aayog's National Multidimensional Poverty Index 2023, based on the National Family Health Survey 5 (2019-21), covering district-level MPI headcount ratios for 583 districts; (2) Ministry of Corporate Affairs CSR spending data via the National CSR Portal, covering 10 fiscal years (FY2014-15 through FY2023-24); and (3) Census of India 2011 district population data.",
        },
      },
      {
        "@type": "Question",
        name: "Who is this tool for?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Whitespace India is built for foundation program officers, CSR heads, and philanthropic advisors who need evidence-based guidance on where to deploy capital for maximum impact. The adjustable weight sliders allow different organisations with different theories of change to generate rankings aligned with their priorities.",
        },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <main className="bg-[#0B1526] min-h-screen">
        <Navbar />
        <Hero />
        <HowItWorks />

        {/* Simulator Section */}
        <section id="simulator" className="relative py-20 px-4">
          {/* Subtle top gradient border */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#F5A623]/20 to-transparent" />

          <div className="max-w-7xl mx-auto" ref={simulatorRef}>
            {/* Section heading */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={simulatorInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.7 }}
              className="text-center mb-12"
            >
              <p className="text-[#F5A623] text-xs font-semibold tracking-widest uppercase mb-3">
                Interactive Tool
              </p>
              <h2 className="font-display text-4xl md:text-5xl text-white">
                Opportunity Simulator
              </h2>
              <p className="mt-3 text-[#94A3B8] max-w-xl mx-auto">
                Adjust weights, select a sector, and click any state to surface your highest-opportunity districts.
              </p>
              <p className="mt-2 text-xs text-[#64748B] max-w-lg mx-auto">
                All data sourced from NITI Aayog (MPI 2023), Ministry of Corporate Affairs (CSR), and Census 2011. Research briefs are AI-assisted and should be independently verified.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Weights Panel */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={simulatorInView ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="lg:col-span-1"
              >
                <WeightsPanel
                  onWeightsChange={setWeights}
                  onSectorChange={setSector}
                  onWhitespaceToggle={setWhitespaceOnly}
                  onReset={handleReset}
                  weights={weights}
                />
              </motion.div>

              {/* Map + Rankings */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={simulatorInView ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.15 }}
                className="lg:col-span-2 space-y-6"
              >
                {/* Map */}
                <div className="bg-[#0D1B2E]/80 backdrop-blur-md border border-white/10 rounded-2xl p-4 md:p-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display text-base text-white font-semibold">India Map</h3>
                    <span className="text-xs text-[#64748B]">Click a state to filter rankings</span>
                  </div>
                  <IndiaMap
                    districtScores={stateAverages}
                    onStateClick={handleStateClick}
                    highlightedState={highlightedState}
                  />
                </div>

                {/* Rankings */}
                <div className="bg-[#0D1B2E]/80 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                    <h3 className="font-display text-base text-white font-semibold">
                      District Rankings
                    </h3>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-[#64748B]">
                        {displayDistricts.length}{" "}
                        districts
                        {highlightedState && (
                          <>
                            {" "}in{" "}
                            <span className="text-[#F5A623]">{highlightedState}</span>
                          </>
                        )}
                      </span>
                      {highlightedState && (
                        <button
                          onClick={() => setHighlightedState(null)}
                          className="text-xs text-[#64748B] hover:text-[#F5A623] border border-white/10 px-2 py-1 rounded-lg transition-colors"
                        >
                          Clear state
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="p-4">
                    <RankingList
                      districts={displayDistricts}
                      onSelectDistrict={handleSelectDistrict}
                      selectedLgdCode={selectedDistrict?.district_lgd_code ?? null}
                      isLoading={isLoading}
                    />
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Data Insight Cards */}
        <InsightSection whitespaceCount={whitespaceCount} />

        {/* What's Next */}
        <BeyondSection />

        <Footer />

        {/* Brief Modal */}
        <BriefModal
          district={selectedDistrict}
          onClose={() => setSelectedDistrict(null)}
        />
      </main>
    </>
  );
}
