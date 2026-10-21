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
      <div className="w-8 h-8 border-2 border-t-transparent animate-spin" style={{ borderColor: csrConfig.theme.accent, borderTopColor: 'transparent' }} />
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
} from "@/lib/csr/score";
import { csrConfig } from "@/lib/csr/config";
import { SITE_URL } from "@/lib/site";

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
              Findings from the <span className="italic font-light">index</span>
            </h2>
            <p className="font-body text-base md:text-lg text-[#1c1c19]/75 leading-relaxed max-w-2xl">
              The first finding concerns CSR spending that cannot be placed in any district, and the other two concern how unevenly the rest is shared between places.
            </p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 border border-[#1c1c19]">
          <div className="border-b md:border-b-0 md:border-r border-[#1c1c19]">
            <DataInsightCard
              number="01"
              value="₹1,29,660 Cr"
              label="CSR with no district"
              sub="Of all CSR spending filed between FY2014-15 and FY2023-24, 60.7% was recorded as Pan-India or named no district. The index cannot place that money in any district."
              delay={0}
            />
          </div>
          <div className="border-b md:border-b-0 md:border-r border-[#1c1c19] bg-[#f6f3ee]">
            <DataInsightCard
              number="02"
              value="33.76%"
              label="Bihar's poverty headcount"
              sub="The share of Bihar’s people in multidimensional poverty in 2019-21, from NITI Aayog’s MPI 2023. Bihar receives ₹66 of CSR spending per person, against ₹1,436 in Maharashtra."
              delay={0.12}
            />
          </div>
          <div>
            <DataInsightCard
              number="03"
              value={String(whitespaceCount)}
              label="Whitespace districts"
              sub="A whitespace district is one in the bottom 25% of all districts for CSR spending per person and the top 25% for the share of people in poverty."
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
              Other indexes
            </span>
            <motion.h2
              initial={{ opacity: 0, x: -12 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="font-headline text-3xl md:text-5xl headline-tight text-[#1c1c19] mb-6"
            >
              The same <span className="italic font-light">method</span> can be applied to other district data.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="font-body text-base text-[#1c1c19]/75 leading-relaxed mb-6"
            >
              Previews of indexes for health, energy and education are on this site. They run on placeholder numbers until real district data and a written method are in place.
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
              We send one short email when a new index or report is published.
            </p>
            <SubscribeForm variant="compact" source="landing" />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

interface HomeMeta {
  pos_range?: { min: number; max: number };
  sector_pos_max?: number;
}

export default function HomePage() {
  const [districts, setDistricts] = useState<District[]>([]);
  const [sectorScores, setSectorScores] = useState<
    Record<string, Record<string, number>>
  >({});
  const [meta, setMeta] = useState<HomeMeta | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({
    w_N: DEFAULT_WEIGHTS.w_N,
    w_G: DEFAULT_WEIGHTS.w_G,
    w_U: DEFAULT_WEIGHTS.w_U,
  });
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
      fetch("/data/csr/whitespace_master.json").then((r) => r.json()),
      fetch("/data/csr/sector_scores.json").then((r) => r.json()),
      fetch("/data/csr/meta.json").then((r) => r.json()),
    ])
      .then(([d, s, m]) => {
        setDistricts(d);
        setSectorScores(s);
        setMeta(m);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  const posMin = meta?.pos_range?.min ?? 0.0;
  const posMax = meta?.pos_range?.max ?? 81.2;
  const sectorPosMax = meta?.sector_pos_max ?? 85.5;

  const csrWeights: Weights = useMemo(() => ({
    w_N: weights.w_N ?? DEFAULT_WEIGHTS.w_N,
    w_G: weights.w_G ?? DEFAULT_WEIGHTS.w_G,
    w_U: weights.w_U ?? DEFAULT_WEIGHTS.w_U,
  }), [weights]);

  const rankedDistricts = useMemo(
    () =>
      districts.length > 0
        ? rankDistricts(
            districts,
            csrWeights,
            sector,
            sectorScores,
            whitespaceOnly
          )
        : [],
    [districts, csrWeights, sector, sectorScores, whitespaceOnly]
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

  const handleWeightsChange = useCallback((newWeights: Record<string, number>) => {
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
      setWeights({ w_N: DEFAULT_WEIGHTS.w_N, w_G: DEFAULT_WEIGHTS.w_G, w_U: DEFAULT_WEIGHTS.w_U });
      setSector("All Sectors");
      setWhitespaceOnly(false);
      setHighlightedState(null);
    });
  }, []);

  const safeJsonLd = (obj: unknown): string =>
    JSON.stringify(obj).replace(/</g, '\\u003c');

  const siteUrl = SITE_URL;

  const districtCount = districts.length || 651;

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "CSR Opportunity Index",
    url: siteUrl,
    description: `An interactive index that ranks ${districtCount} Indian districts by their poverty (NITI Aayog MPI 2023) against the CSR spending companies report there.`,
  };

  const datasetSchema = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "Philanthropic Opportunity Score (POS) for Indian districts",
    description: `A composite score for ${districtCount} Indian districts, calculated from NITI Aayog's MPI 2023 poverty data and Ministry of Corporate Affairs CSR spending data (via Dataful.in dataset 1612).`,
    url: siteUrl,
    creator: {
      "@type": "Person",
      name: "Souhard Sharma",
      url: "https://www.linkedin.com/in/souhardsharma/",
      sameAs: ["https://www.linkedin.com/in/souhardsharma/"],
    },
    license: "https://creativecommons.org/licenses/by/4.0/",
    citation: [
      "National Multidimensional Poverty Index 2023 (NITI Aayog), https://niti.gov.in/sites/default/files/2023-07/National-Multidimentional-Poverty-Index-2023-Final-17th-July.pdf",
      "CSR District-Level Spending Data (Ministry of Corporate Affairs), https://www.csr.gov.in/",
      "CSR District-Level Dataset via Dataful.in (Dataset 1612), https://dataful.in/datasets/1612",
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
        <Navbar vertical={csrConfig} />
        <Hero vertical={csrConfig} />
        <HowItWorks vertical={csrConfig} />

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
                  02 / The Index
                </span>
                <div className="h-px bg-[#1c1c19] w-24" />
              </div>
              <div className="md:col-span-9">
                <h2 className="font-headline text-4xl md:text-6xl lg:text-7xl headline-tight text-[#1c1c19] mb-6">
                  District <span className="italic font-light">rankings</span>
                </h2>
                <p className="font-body text-base md:text-lg text-[#1c1c19]/75 leading-relaxed max-w-2xl">
                  Districts at the top of the ranking combine high poverty with little recorded CSR spending. You can change the weights or score a single CSR sector, and clicking a state on the map lists only its districts.
                </p>
                <p className="mt-4 font-body text-xs md:text-sm text-[#1c1c19]/60 italic leading-relaxed max-w-2xl">
                  With the default weights and all sectors, scores run from {posMin} to {posMax}. Choosing a sector recalculates the funding gap from that sector&apos;s spending alone, and a district with no CSR spending in the sector gets the largest possible gap, so scores can reach about {sectorPosMax}.
                </p>
                <p className="mt-4 font-body text-xs md:text-sm text-[#1c1c19]/70 leading-relaxed max-w-2xl">
                  The text of each research brief is written by a language model from the district&apos;s figures, so it should be checked against them before it is quoted.
                </p>
                <p className="mt-4 font-label text-[10px] uppercase tracking-[0.2em] text-[#1c1c19]/60 max-w-2xl">
                  Source: NITI Aayog MPI 2023; Ministry of Corporate Affairs CSR filings via Dataful.in; Census 2011
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
                  vertical={csrConfig}
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
                        Average score by state
                      </h3>
                      <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-2">
                        Selecting a state lists only its districts
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
                      vertical={csrConfig}
                    />
                  </div>
                </div>

                <div className="bg-[#fcf9f4]">
                  <div className="px-6 py-5 border-b border-[#1c1c19] bg-[#f6f3ee] flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-label text-[11px] uppercase tracking-[0.3em] font-bold text-[#1c1c19]">
                        District ranking
                      </h3>
                      <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-2">
                        {displayDistricts.length} districts
                        {highlightedState && (
                          <>
                            {" "}in{" "}
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
                      vertical={csrConfig}
                    />
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        <InsightSection whitespaceCount={whitespaceCount} />

        <BeyondSection />

        <Footer vertical={csrConfig} />

        <BriefModal
          district={selectedDistrict}
          onClose={() => setSelectedDistrict(null)}
          vertical={csrConfig}
          sector={sector}
          weights={csrWeights}
        />
      </main>
    </>
  );
}
