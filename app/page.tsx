"use client";

import { useState, useEffect, useMemo, useRef, useCallback, useTransition } from "react";
import { motion, useInView } from "framer-motion";
import dynamic from "next/dynamic";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import WeightsPanel from "@/components/WeightsPanel";
import SubscribeForm from "@/components/SubscribeForm";

const IndiaMap = dynamic(() => import("@/components/IndiaMap"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full flex items-center justify-center border border-[#1c1c19] bg-[#fcf9f4]"
      style={{ aspectRatio: "3/4", maxHeight: "500px" }}
    >
      <div className="w-8 h-8 border-2 border-[#BD402C] border-t-transparent animate-spin" />
    </div>
  ),
});
import RankingList from "@/components/RankingList";
import BriefModal from "@/components/BriefModal";
import Footer from "@/components/Footer";
import {
  District,
  Weights,
  DEFAULT_WEIGHTS,
  rankDistricts,
} from "@/lib/score";

function DataInsightCard({
  number,
  value,
  label,
  sub,
  delay = 0,
}: {
  number: string;
  value: string;
  label: string;
  sub: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
      className="relative p-8 md:p-10 bg-[#fcf9f4] border-[#1c1c19]"
    >
      <div className="flex items-start justify-between mb-6">
        <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C]">
          Finding {number}
        </span>
        <span className="font-headline text-6xl md:text-7xl leading-none text-[#1c1c19]/10">
          {number}
        </span>
      </div>
      <div className="font-label text-3xl md:text-4xl font-bold text-[#BD402C] tracking-tighter mb-3">
        {value}
      </div>
      <div className="h-px bg-[#1c1c19]/30 w-12 mb-4" />
      <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[#1c1c19] mb-3 font-bold">
        {label}
      </div>
      <div className="font-body text-sm text-[#1c1c19]/70 leading-relaxed">
        {sub}
      </div>
    </motion.div>
  );
}

function InsightSection({ whitespaceCount }: { whitespaceCount: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="relative bg-[#fcf9f4] border-t border-[#1c1c19] py-20 md:py-28 px-6 md:px-12 lg:px-16">
      <div className="max-w-7xl mx-auto" ref={ref}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-16"
        >
          <div className="md:col-span-3">
            <span className="font-label text-[11px] uppercase tracking-[0.3em] text-[#BD402C] block mb-4">
              03 / Findings
            </span>
            <div className="h-px bg-[#1c1c19] w-24" />
          </div>
          <div className="md:col-span-9">
            <h2 className="font-headline text-4xl md:text-6xl lg:text-7xl headline-tight text-[#1c1c19] mb-6">
              What the data <span className="italic font-light">reveals.</span>
            </h2>
            <p className="font-body text-base md:text-lg text-[#1c1c19]/75 leading-relaxed max-w-2xl">
              Three signals from the ledger. Each points to a different kind of gap, and a different lever for philanthropic capital.
            </p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 border border-[#1c1c19]">
          <div className="border-b md:border-b-0 md:border-r border-[#1c1c19]">
            <DataInsightCard
              number="01"
              value="₹1,29,660 Cr"
              label="Unattributable CSR"
              sub="Classified as Pan-India (FY2014-15 through FY2023-24). 60.7% of gross CSR, unattributable to any specific district."
              delay={0}
            />
          </div>
          <div className="border-b md:border-b-0 md:border-r border-[#1c1c19] bg-[#f6f3ee]">
            <DataInsightCard
              number="02"
              value="33.76%"
              label="Bihar Poverty Rate"
              sub="NITI Aayog MPI 2023 state-level headcount ratio (2019-21). Bihar receives ₹66 per person in CSR vs Maharashtra’s ₹1,436."
              delay={0.12}
            />
          </div>
          <div>
            <DataInsightCard
              number="03"
              value={String(whitespaceCount)}
              label="Neglected Districts"
              sub="High poverty meets low funding: the neglected districts awaiting capital."
              delay={0.24}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function BeyondSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section className="relative bg-[#f6f3ee] border-t border-[#1c1c19] py-20 md:py-24 px-6 md:px-12 lg:px-16">
      <div className="max-w-7xl mx-auto" ref={ref}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="grid grid-cols-1 md:grid-cols-12 gap-10 items-center border border-[#1c1c19] bg-[#fcf9f4]"
        >
          <div className="md:col-span-8 p-10 md:p-14 border-b md:border-b-0 md:border-r border-[#1c1c19]">
            <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C] block mb-6">
              What Comes Next
            </span>
            <motion.h2
              initial={{ opacity: 0, x: -12 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="font-headline text-3xl md:text-5xl headline-tight text-[#1c1c19] mb-6"
            >
              The same <span className="italic font-light">methodology</span> works anywhere there is public data.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="font-body text-base text-[#1c1c19]/75 leading-relaxed mb-6"
            >
              Education infrastructure gaps, health access disparities, and energy poverty are next in the investigation pipeline.
            </motion.p>
            <div className="flex flex-wrap gap-0 border border-[#1c1c19]">
              {["Education", "Health", "Energy"].map((v, i) => (
                <motion.span
                  key={v}
                  initial={{ opacity: 0, y: 6 }}
                  animate={inView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.4, delay: 0.3 + i * 0.08 }}
                  className={`font-label text-[10px] uppercase tracking-[0.2em] text-[#1c1c19] px-4 py-3 flex-1 text-center ${
                    i > 0 ? "border-l border-[#1c1c19]" : ""
                  }`}
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
            className="md:col-span-4 p-10 md:p-14 flex flex-col gap-6"
          >
            <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/60">
              Updates
            </span>
            <p className="font-body text-sm text-[#1c1c19]/80 leading-relaxed">
              Future research will apply this methodology to education, health, and energy infrastructure data.
            </p>
            <SubscribeForm variant="compact" source="landing" />
          </motion.div>
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
  const [isPending, startTransition] = useTransition();

  const simulatorRef = useRef<HTMLDivElement>(null);
  const simulatorInView = useInView(simulatorRef, { once: true, margin: "-100px" });

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

  const displayDistricts = useMemo(() => {
    if (!highlightedState) return rankedDistricts;
    const filtered = rankedDistricts.filter((d) => d.state_name === highlightedState);
    return filtered.map((d, i) => ({ ...d, rank: i + 1 }));
  }, [rankedDistricts, highlightedState]);

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
    startTransition(() => {
      setHighlightedState((prev) => (prev === stateName ? null : stateName));
    });
  }, []);

  const handleWeightsChange = useCallback((newWeights: Weights) => {
    startTransition(() => {
      setWeights(newWeights);
    });
  }, []);

  const handleSectorChange = useCallback((val: string) => {
    startTransition(() => {
      setSector(val);
    });
  }, []);

  const handleWhitespaceToggle = useCallback((val: boolean) => {
    startTransition(() => {
      setWhitespaceOnly(val);
    });
  }, []);

  const handleReset = useCallback(() => {
    startTransition(() => {
      setWeights(DEFAULT_WEIGHTS);
      setSector("All Sectors");
      setWhitespaceOnly(false);
      setHighlightedState(null);
    });
  }, []);

  const safeJsonLd = (obj: unknown): string =>
    JSON.stringify(obj).replace(/</g, '\\u003c');

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://whitespaceindia-csr.vercel.app";

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Whitespace India CSR",
    url: siteUrl,
    description:
      "Interactive tool ranking 569 Indian districts by philanthropic opportunity. Combines NITI Aayog MPI poverty data with CSR spending to find where philanthropic capital can create the most impact.",
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/#simulator`,
    },
  };

  const datasetSchema = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "India District Philanthropic Opportunity Scores",
    description:
      "Composite Philanthropic Opportunity Score (POS) for 569 Indian districts, derived from NITI Aayog MPI 2023 poverty data and MCA CSR spending data.",
    url: siteUrl,
    creator: {
      "@type": "Person",
      name: "Souhard Sharma",
      url: "https://www.linkedin.com/in/souhardsharma/",
      sameAs: ["https://www.linkedin.com/in/souhardsharma/"],
    },
    license: "https://creativecommons.org/licenses/by/4.0/",
    citation: [
      "National Multidimensional Poverty Index 2023 (NITI Aayog) - https://niti.gov.in/sites/default/files/2023-07/Final-MPI_7thJuly.pdf",
      "CSR District-Level Spending Data (Ministry of Corporate Affairs) - https://www.csr.gov.in/",
    ],
    temporalCoverage: "2014/2024",
    spatialCoverage: { "@type": "Place", name: "India" },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(websiteSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(datasetSchema) }}
      />
      <main id="main-content" className="bg-[#fcf9f4] min-h-screen">
        <Navbar />
        <Hero />
        <HowItWorks />

        <section
          id="simulator"
          className="relative bg-[#fcf9f4] border-t border-[#1c1c19] py-20 md:py-28 px-6 md:px-12 lg:px-16"
        >
          <div className="max-w-7xl mx-auto" ref={simulatorRef}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={simulatorInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.7 }}
              className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-16"
            >
              <div className="md:col-span-3">
                <span className="font-label text-[11px] uppercase tracking-[0.3em] text-[#BD402C] block mb-4">
                  02 / The Simulator
                </span>
                <div className="h-px bg-[#1c1c19] w-24" />
              </div>
              <div className="md:col-span-9">
                <h2 className="font-headline text-4xl md:text-6xl lg:text-7xl headline-tight text-[#1c1c19] mb-6">
                  Opportunity <span className="italic font-light">Simulator.</span>
                </h2>
                <p className="font-body text-base md:text-lg text-[#1c1c19]/75 leading-relaxed max-w-2xl">
                  Adjust weights, select a sector, and click any state to surface your highest-opportunity districts.
                </p>
                <p className="mt-4 font-label text-[10px] uppercase tracking-[0.2em] text-[#1c1c19]/60 max-w-2xl">
                  Source · NITI Aayog MPI 2023 · MCA CSR · Census 2011 · Briefs AI-assisted and require independent verification
                </p>
              </div>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 border border-[#1c1c19]">
              <motion.div
                initial={{ opacity: 0 }}
                animate={simulatorInView ? { opacity: 1 } : {}}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="lg:col-span-1 lg:border-r border-[#1c1c19]"
              >
                <WeightsPanel
                  onWeightsChange={handleWeightsChange}
                  onSectorChange={handleSectorChange}
                  onWhitespaceToggle={handleWhitespaceToggle}
                  onReset={handleReset}
                  weights={weights}
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={simulatorInView ? { opacity: 1 } : {}}
                transition={{ duration: 0.6, delay: 0.15 }}
                className="lg:col-span-2"
              >
                <div className="bg-[#fcf9f4] border-b border-[#1c1c19]">
                  <div className="px-6 py-5 border-b border-[#1c1c19] bg-[#f6f3ee] flex items-center justify-between">
                    <div>
                      <h3 className="font-label text-[11px] uppercase tracking-[0.3em] font-bold text-[#1c1c19]">
                        India · Territorial Atlas
                      </h3>
                      <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-2">
                        Click a state to filter rankings
                      </p>
                    </div>
                    <span className="font-label text-[10px] tracking-widest text-[#1c1c19]/40">
                      Figure 01
                    </span>
                  </div>
                  <div className="p-4 md:p-6">
                    <IndiaMap
                      districtScores={stateAverages}
                      onStateClick={handleStateClick}
                      highlightedState={highlightedState}
                    />
                  </div>
                </div>

                <div className="bg-[#fcf9f4]">
                  <div className="px-6 py-5 border-b border-[#1c1c19] bg-[#f6f3ee] flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-label text-[11px] uppercase tracking-[0.3em] font-bold text-[#1c1c19]">
                        District Ledger
                      </h3>
                      <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-2">
                        {displayDistricts.length} districts
                        {highlightedState && (
                          <>
                            {" "}· filter ·{" "}
                            <span className="text-[#BD402C]">{highlightedState}</span>
                          </>
                        )}
                      </p>
                    </div>
                    {highlightedState && (
                      <button
                        onClick={() => setHighlightedState(null)}
                        className="font-label text-[10px] uppercase tracking-[0.2em] border border-[#1c1c19] text-[#1c1c19] px-3 py-2 hover:bg-[#1c1c19] hover:text-[#fcf9f4] transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div
                    className={`p-6 transition-opacity duration-300 ${
                      isPending ? "opacity-40 select-none pointer-events-none" : "opacity-100"
                    }`}
                  >
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

        <InsightSection whitespaceCount={whitespaceCount} />

        <BeyondSection />

        <Footer />

        <BriefModal
          district={selectedDistrict}
          onClose={() => setSelectedDistrict(null)}
        />
      </main>
    </>
  );
}
