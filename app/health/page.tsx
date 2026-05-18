"use client";

import { useState, useEffect, useMemo, useRef, useCallback, useTransition } from "react";
import { motion, useInView } from "framer-motion";
import dynamic from "next/dynamic";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import WeightsPanel from "@/components/WeightsPanel";
import SubscribeForm from "@/components/SubscribeForm";
import ComingSoonOverlay from "@/components/ComingSoonOverlay";
import { healthConfig } from "@/lib/health/config";
import { rankGenericDistricts } from "@/lib/verticals/score";
import type { GenericDistrict } from "@/lib/verticals/types";

const IndiaMap = dynamic(() => import("@/components/IndiaMap"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full flex items-center justify-center border border-[#1c1c19] bg-[#fcf9f4]"
      style={{ aspectRatio: "3/4", maxHeight: "500px" }}
    >
      <div className="w-8 h-8 border-2 border-t-transparent animate-spin" style={{ borderColor: healthConfig.theme.accent, borderTopColor: "transparent" }} />
    </div>
  ),
});
import RankingList from "@/components/RankingList";
import BriefModal from "@/components/BriefModal";
import Footer from "@/components/Footer";

const cfg = healthConfig;
const accent = cfg.theme.accent;

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
        <span className="font-label text-[10px] uppercase tracking-[0.3em]" style={{ color: accent }}>
          Finding {number}
        </span>
        <span className="font-headline text-6xl md:text-7xl leading-none text-[#1c1c19]/10">
          {number}
        </span>
      </div>
      <div className="font-label text-3xl md:text-4xl font-bold tracking-tighter mb-3" style={{ color: accent }}>
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

  const cards = cfg.findingsCards.map((c) =>
    c.value === "—" ? { ...c, value: String(whitespaceCount) } : c
  );

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
            <span className="font-label text-[11px] uppercase tracking-[0.3em] block mb-4" style={{ color: accent }}>
              03 / Findings
            </span>
            <div className="h-px bg-[#1c1c19] w-24" />
          </div>
          <div className="md:col-span-9">
            <h2 className="font-headline text-4xl md:text-6xl lg:text-7xl headline-tight text-[#1c1c19] mb-6">
              What the data <span className="italic font-light">reveals.</span>
            </h2>
            <p className="font-body text-base md:text-lg text-[#1c1c19]/75 leading-relaxed max-w-2xl">
              Three signals from the health ledger. Each points to a different kind of gap, and a different lever for intervention.
            </p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 border border-[#1c1c19]">
          {cards.map((card, i) => (
            <div
              key={card.number}
              className={`${i < cards.length - 1 ? "border-b md:border-b-0 md:border-r border-[#1c1c19]" : ""} ${i % 2 === 1 ? "bg-[#f6f3ee]" : ""}`}
            >
              <DataInsightCard
                number={card.number}
                value={card.value}
                label={card.label}
                sub={card.sub}
                delay={i * 0.12}
              />
            </div>
          ))}
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
            <span className="font-label text-[10px] uppercase tracking-[0.3em] block mb-6" style={{ color: accent }}>
              What Comes Next
            </span>
            <motion.h2
              initial={{ opacity: 0, x: -12 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="font-headline text-3xl md:text-5xl headline-tight text-[#1c1c19] mb-6"
            >
              The same <span className="italic font-light">methodology</span> works across every public dataset.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="font-body text-base text-[#1c1c19]/75 leading-relaxed mb-6"
            >
              CSR spending patterns, education infrastructure, and energy access are also under investigation.
            </motion.p>
            <div className="flex flex-wrap gap-0 border border-[#1c1c19]">
              {["CSR", "Education", "Energy"].map((v, i) => (
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
              We are building health infrastructure indices using NHM, SRS, and Rural Health Statistics data.
            </p>
            <SubscribeForm variant="compact" source="health" vertical={cfg} />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

export default function HealthPage() {
  const [districts, setDistricts] = useState<GenericDistrict[]>([]);
  const [sectorScores, setSectorScores] = useState<Record<string, Record<string, number>>>({});
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    const w: Record<string, number> = {};
    for (const d of cfg.dimensions) w[d.key] = d.defaultWeight;
    return w;
  });
  const [sector, setSector] = useState("All Sectors");
  const [whitespaceOnly, setWhitespaceOnly] = useState(false);
  const [selectedDistrict, setSelectedDistrict] = useState<(GenericDistrict & { computed_pos: number }) | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [highlightedState, setHighlightedState] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const simulatorRef = useRef<HTMLDivElement>(null);
  const simulatorInView = useInView(simulatorRef, { once: true, margin: "-100px" });

  useEffect(() => {
    Promise.all([
      fetch(`${cfg.dataPath}/whitespace_master.json`).then((r) => r.json()),
      fetch(`${cfg.dataPath}/sector_scores.json`).then((r) => r.json()),
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
        ? rankGenericDistricts(districts, weights, cfg, sectorScores, sector, whitespaceOnly)
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
    (d: GenericDistrict) => {
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
    startTransition(() => setWeights(newWeights));
  }, []);

  const handleSectorChange = useCallback((val: string) => {
    startTransition(() => setSector(val));
  }, []);

  const handleWhitespaceToggle = useCallback((val: boolean) => {
    startTransition(() => setWhitespaceOnly(val));
  }, []);

  const handleReset = useCallback(() => {
    startTransition(() => {
      const w: Record<string, number> = {};
      for (const d of cfg.dimensions) w[d.key] = d.defaultWeight;
      setWeights(w);
      setSector("All Sectors");
      setWhitespaceOnly(false);
      setHighlightedState(null);
    });
  }, []);

  return (
    <ComingSoonOverlay active={cfg.comingSoon} verticalName={cfg.name} accentColor={accent}>
      <main id="main-content" className="bg-[#fcf9f4] min-h-screen">
        <Navbar vertical={cfg} />
        <Hero vertical={cfg} />
        <HowItWorks vertical={cfg} />

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
                <span className="font-label text-[11px] uppercase tracking-[0.3em] block mb-4" style={{ color: accent }}>
                  02 / The Simulator
                </span>
                <div className="h-px bg-[#1c1c19] w-24" />
              </div>
              <div className="md:col-span-9">
                <h2 className="font-headline text-4xl md:text-6xl lg:text-7xl headline-tight text-[#1c1c19] mb-6">
                  Health <span className="italic font-light">Simulator.</span>
                </h2>
                <p className="font-body text-base md:text-lg text-[#1c1c19]/75 leading-relaxed max-w-2xl">
                  Adjust weights, select a health domain, and click any state to surface districts with the greatest intervention opportunity.
                </p>
                <p className="mt-4 font-label text-[10px] uppercase tracking-[0.2em] text-[#1c1c19]/60 max-w-2xl">
                  Source · NHM District Reports · SRS Bulletins · Rural Health Statistics 2021-22 · Census 2011
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
                  vertical={cfg}
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
                      vertical={cfg}
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
                            <span style={{ color: accent }}>{highlightedState}</span>
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
                      districts={displayDistricts as any}
                      onSelectDistrict={handleSelectDistrict as any}
                      selectedLgdCode={selectedDistrict?.district_lgd_code ?? null}
                      isLoading={isLoading}
                      vertical={cfg}
                    />
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        <InsightSection whitespaceCount={whitespaceCount} />
        <BeyondSection />
        <Footer vertical={cfg} />

        <BriefModal
          district={selectedDistrict as any}
          onClose={() => setSelectedDistrict(null)}
          vertical={cfg}
        />
      </main>
    </ComingSoonOverlay>
  );
}
