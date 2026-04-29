"use client";

import { useRef, useState, useEffect } from "react";
import { motion, useInView } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

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

interface MetaData {
  national_median_csr_per_person: number;
  tier_medians: Record<string, number>;
  total_districts: number;
  whitespace_thresholds?: { csr_p25: number; hr_p75_pct: number };
  whitespace_count?: number;
  whitespace_by_state?: Record<string, number>;
  pos_range?: { min: number; max: number };
  sector_pos_max?: number;
  pop_tier_boundaries?: { p33: number; p67: number };
  national_mean_csr?: number;
  median_retention_ratio?: number;
  national_hr_official_pct?: number;
  u_imputed_count?: number;
  retention_ratio_stats?: {
    median?: number; p25?: number; p75?: number; std?: number;
    n_observed?: number; n_imputed?: number;
  };
}

const WEIGHT_PRESETS = [
  { name: "Balanced", N: 40, G: 40, U: 20, desc: "Equal emphasis on need and gap" },
  { name: "Highest Need", N: 60, G: 25, U: 15, desc: "Prioritize poverty severity" },
  { name: "Most Underfunded", N: 20, G: 65, U: 15, desc: "Prioritize funding gap" },
  { name: "Stuck Districts", N: 25, G: 30, U: 45, desc: "Prioritize persistent poverty" },
];

const CHART_TOOLTIP_STYLE = {
  background: "#1c1c19",
  border: "1px solid #1c1c19",
  borderRadius: 0,
  fontSize: 11,
  color: "#fcf9f4",
  padding: "8px 12px",
  fontFamily: "var(--font-space-grotesk)",
};

function formatLakh(n: number): string {
  const lakh = n / 100000;
  return lakh >= 10 ? `${lakh.toFixed(1)} lakh` : `${lakh.toFixed(2)} lakh`;
}

function PipelineConnector() {
  return (
    <div className="flex justify-center py-1.5 border-y border-[#1c1c19]/15 bg-[#f6f3ee]/40">
      <svg width="14" height="20" viewBox="0 0 14 20" className="text-[#1c1c19]/45" aria-hidden>
        <path d="M7 0 V17 M2 12 L7 17 L12 12" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function PipelineStep({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <div className="px-6 md:px-8 py-6 grid grid-cols-12 gap-4 md:gap-6">
      <div className="col-span-12 md:col-span-3">
        <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C] font-bold block">
          Step {number}
        </span>
        <p className="font-label text-[11px] uppercase tracking-[0.2em] text-[#1c1c19] font-bold mt-1.5 leading-snug">
          {title}
        </p>
      </div>
      <div className="col-span-12 md:col-span-9">{children}</div>
    </div>
  );
}

function JoinPipeline({ totalDistricts }: { totalDistricts: number }) {
  // Palghar / Thane proportional split. 2,990,116 / 11,060,148 = 27.04%
  const palgharPct = (2990116 / 11060148) * 100;
  const thaneResidualPct = 100 - palgharPct;
  const matched = totalDistricts;
  const dropped = 653 - matched;

  return (
    <div className="border border-[#1c1c19] bg-[#fcf9f4]">
      {/* Frame header */}
      <div className="border-b border-[#1c1c19] px-6 md:px-8 py-5 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <span className="font-label text-[10px] md:text-[11px] uppercase tracking-[0.3em] text-[#BD402C] font-bold block">
            The Join Pipeline
          </span>
          <p className="font-body text-xs text-[#1c1c19]/65 mt-1.5 max-w-xl">
            Three independently maintained datasets, none of which agrees on district names or boundaries. The MPI is the spine; CSR and Census are joined onto it.
          </p>
        </div>
        <span className="font-label text-[9px] md:text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/55 self-end">
          MCA / NITI Aayog / RGI
        </span>
      </div>

      {/* Step 0: three sources -> one matched record */}
      <div className="px-6 md:px-8 py-6 md:py-8">
        <div className="grid grid-cols-3 border border-[#1c1c19]/30">
          {[
            { dataset: "Census 2011", source: "Registrar General of India", spelling: "Hooghly", subline: "640 districts" },
            { dataset: "MPI 2023", source: "NITI Aayog (NFHS-5)", spelling: "Hugli (Hooghly)", subline: "653 districts" },
            { dataset: "CSR / MCA", source: "Ministry of Corporate Affairs", spelling: "Hugli", subline: "663 (state, district) keys" },
          ].map((s, i) => (
            <div
              key={s.dataset}
              className={`p-4 md:p-5 ${i < 2 ? "border-r border-[#1c1c19]/30" : ""}`}
            >
              <p className="font-label text-[9px] uppercase tracking-[0.25em] text-[#BD402C] font-bold mb-1">
                {s.dataset}
              </p>
              <p className="font-label text-[8px] uppercase tracking-[0.2em] text-[#1c1c19]/45 mb-3">
                {s.source}
              </p>
              <p className="font-mono text-sm md:text-base text-[#1c1c19] mb-2 break-words">
                &quot;{s.spelling}&quot;
              </p>
              <p className="font-label text-[9px] uppercase tracking-[0.2em] text-[#1c1c19]/55">
                {s.subline}
              </p>
            </div>
          ))}
        </div>

        {/* Convergence diagram: 3 lines merging into 1 matched record */}
        <div className="mt-4 grid grid-cols-3">
          <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="w-full h-9 text-[#BD402C]/60">
            <path d="M16.6 0 V18 Q16.6 30 50 30 L100 30" stroke="currentColor" strokeWidth="0.6" fill="none" />
          </svg>
          <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="w-full h-9 text-[#BD402C]/60">
            <path d="M50 0 V30 M44 24 L50 30 L56 24" stroke="currentColor" strokeWidth="0.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="w-full h-9 text-[#BD402C]/60">
            <path d="M83.3 0 V18 Q83.3 30 50 30 L0 30" stroke="currentColor" strokeWidth="0.6" fill="none" />
          </svg>
        </div>

        <div className="mx-auto max-w-md border border-[#1c1c19] bg-white px-4 py-3 text-center">
          <p className="font-label text-[9px] uppercase tracking-[0.25em] text-[#1c1c19]/55 mb-1">
            One canonical district record
          </p>
          <p className="font-mono text-sm md:text-base text-[#1c1c19]">
            West Bengal / Hugli
          </p>
        </div>
      </div>

      <PipelineConnector />

      {/* Step 01: fuzzy match algorithm */}
      <PipelineStep number="01" title="State-scoped fuzzy match">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
          <div>
            <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 block mb-1">
              Algorithm
            </span>
            <p className="font-mono text-base text-[#1c1c19]">rapidfuzz.fuzz.ratio</p>
          </div>
          <div>
            <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 block mb-1">
              Threshold
            </span>
            <p className="font-mono text-base text-[#1c1c19]">{`>= 75% similarity`}</p>
            <p className="font-body text-xs text-[#1c1c19]/55 italic mt-1">
              Conservative, set low to maximize coverage.
            </p>
          </div>
          <div>
            <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 block mb-1">
              Caution band
            </span>
            <p className="font-mono text-base text-[#1c1c19]">75 to 90%</p>
            <p className="font-body text-xs text-[#1c1c19]/55 italic mt-1">
              Listed in the verification report for reviewer inspection.
            </p>
          </div>
          <div>
            <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 block mb-1">
              State scoping
            </span>
            <p className="font-mono text-base text-[#1c1c19]">match never crosses states</p>
          </div>
        </div>

        {/* False-positive visualization: state scoping diagram */}
        <div className="mt-5 border border-[#1c1c19]/30 bg-white/40 p-4">
          <p className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 mb-3">
            Why state scoping matters
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="border border-[#1c1c19]/40 bg-white p-3">
              <p className="font-label text-[9px] uppercase tracking-[0.2em] text-[#BD402C] font-bold mb-1">
                Himachal Pradesh
              </p>
              <p className="font-mono text-sm text-[#1c1c19]">Hamirpur</p>
              <p className="font-label text-[8px] uppercase tracking-[0.15em] text-[#1c1c19]/45 mt-1">
                pop ~454k
              </p>
            </div>
            <div className="text-center">
              <p className="font-mono text-[#BD402C]/70 text-base">|| 100% ||</p>
              <p className="font-label text-[8px] uppercase tracking-[0.2em] text-[#1c1c19]/55 mt-1">
                names identical
              </p>
              <p className="font-label text-[8px] uppercase tracking-[0.2em] text-[#BD402C] font-bold mt-2">
                BUT
              </p>
              <p className="font-label text-[8px] uppercase tracking-[0.2em] text-[#1c1c19]/55 mt-1">
                state border blocks the match
              </p>
            </div>
            <div className="border border-[#1c1c19]/40 bg-white p-3">
              <p className="font-label text-[9px] uppercase tracking-[0.2em] text-[#BD402C] font-bold mb-1">
                Uttar Pradesh
              </p>
              <p className="font-mono text-sm text-[#1c1c19]">Hamirpur</p>
              <p className="font-label text-[8px] uppercase tracking-[0.15em] text-[#1c1c19]/45 mt-1">
                pop ~1.1M (different district)
              </p>
            </div>
          </div>
        </div>
      </PipelineStep>

      <PipelineConnector />

      {/* Step 02: renames */}
      <PipelineStep number="02" title="Rename aliases (no boundary change)">
        <div className="flex flex-wrap gap-2">
          {[
            "Gurgaon to Gurugram",
            "Mysore to Mysuru",
            "Allahabad to Prayagraj",
            "Belgaum to Belagavi",
            "Faizabad to Ayodhya",
            "Sikkim 2021 (x4)",
          ].map((p) => (
            <span
              key={p}
              className="font-mono text-[12px] text-[#1c1c19] border border-[#1c1c19]/40 px-3 py-1.5 bg-white/60"
            >
              {p}
            </span>
          ))}
          <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/55 px-2 py-1.5 self-center">
            + 20 more
          </span>
        </div>
        <p className="font-body text-xs text-[#1c1c19]/60 italic mt-3">
          A pure rename keeps the Census 2011 population unchanged; only the district label is updated.
        </p>
      </PipelineStep>

      <PipelineConnector />

      {/* Step 03: post-2011 carve-out recast - the centerpiece */}
      <PipelineStep number="03" title="Post-2011 carve-out recast">
        <p className="font-body text-sm text-[#1c1c19]/75 leading-relaxed mb-4">
          Over fifty districts in the MPI list <span className="italic">did not exist in Census 2011</span>. They were carved from older parent districts after the census was taken, so the parent population must be split, never inherited whole.
        </p>

        {/* Conservation bar - the proportional split */}
        <div className="border border-[#1c1c19]/30 bg-white/40 p-5">
          <p className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 mb-4">
            Worked example: Maharashtra Thane, split into Palghar (2014) and a residual Thane
          </p>

          <div className="mb-3 flex items-baseline justify-between gap-2 flex-wrap">
            <span className="font-label text-[10px] uppercase tracking-[0.2em] text-[#1c1c19]/65">
              Census 2011 Thane (pre-carve-out)
            </span>
            <span className="font-mono text-base md:text-lg text-[#1c1c19]">11,060,148</span>
          </div>
          <div className="h-2.5 bg-[#1c1c19]/15 w-full mb-2" />

          <div className="flex justify-center my-2">
            <svg width="14" height="14" viewBox="0 0 14 14" className="text-[#BD402C]" aria-hidden>
              <path d="M7 0 V12 M2 7 L7 12 L12 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Proportional split bar */}
          <div className="flex h-12 border border-[#1c1c19]/40 overflow-hidden" aria-label="Conservation bar showing Palghar 27% and Thane residual 73% of original Thane">
            <div
              className="bg-[#BD402C] flex items-center justify-center min-w-0"
              style={{ width: `${palgharPct}%` }}
            >
              <span className="font-mono text-[11px] md:text-xs text-white px-1 truncate">2,990,116</span>
            </div>
            <div
              className="bg-[#1c1c19] flex items-center justify-center min-w-0"
              style={{ width: `${thaneResidualPct}%` }}
            >
              <span className="font-mono text-[11px] md:text-xs text-white px-1 truncate">8,070,032</span>
            </div>
          </div>
          <div className="flex mt-2">
            <div style={{ width: `${palgharPct}%` }} className="text-center px-1">
              <p className="font-label text-[9px] uppercase tracking-[0.2em] text-[#BD402C] font-bold">
                Palghar
              </p>
              <p className="font-label text-[8px] uppercase tracking-[0.15em] text-[#1c1c19]/55 mt-0.5">
                gazette / DCHB sourced
              </p>
            </div>
            <div style={{ width: `${thaneResidualPct}%` }} className="text-center px-1">
              <p className="font-label text-[9px] uppercase tracking-[0.2em] text-[#1c1c19] font-bold">
                Thane (residual)
              </p>
              <p className="font-label text-[8px] uppercase tracking-[0.15em] text-[#1c1c19]/55 mt-0.5">
                computed: parent minus child
              </p>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-[#1c1c19]/20 text-center">
            <span className="font-mono text-sm md:text-base text-[#1c1c19]">
              2,990,116 + 8,070,032 = 11,060,148
            </span>
            <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#BD402C] font-bold ml-3">
              conserved
            </span>
            <p className="font-body text-xs text-[#1c1c19]/55 italic mt-2">
              The residual is never the full pre-carve-out total, so Thane is not double-counted with Palghar.
            </p>
          </div>
        </div>

        {/* Catalogue + coverage */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <p className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 mb-2">
              Source-cited catalogue
            </p>
            <p className="font-mono text-[12px] text-[#1c1c19] mb-2 break-all">
              scripts/csr/data/external/population_recast_2011.csv
            </p>
            <p className="font-body text-sm text-[#1c1c19]/70 leading-relaxed">
              Each row carries a clickable URL pointing to a Census District Census Handbook (DCHB), the relevant state gazette notification, or a Wikipedia article that itself cites those primary sources.
            </p>
          </div>
          <div>
            <p className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 mb-2">
              Coverage (50+ districts)
            </p>
            <ul className="font-body text-sm text-[#1c1c19]/75 leading-relaxed space-y-1">
              <li>Telangana 2014 (21 children + 9 residual parents)</li>
              <li>Ladakh 2019</li>
              <li>Bardhaman split 2017 (Paschim + Purba)</li>
              <li>Jaintia Hills bifurcation 2012</li>
              <li>Palghar, Kondagaon, Gariyaband, and others</li>
            </ul>
          </div>
        </div>

        <div className="mt-5 border-l-2 border-[#BD402C] bg-[#BD402C]/5 px-4 py-3">
          <p className="font-label text-[10px] uppercase tracking-[0.25em] text-[#BD402C] font-bold mb-1">
            Hard fail (no silent fallback)
          </p>
          <p className="font-body text-sm text-[#1c1c19]/85 leading-relaxed">
            If any post-2011 district lacks a recast row, the pipeline aborts and names the missing district. There is no fallback to summing parent populations.
          </p>
        </div>
      </PipelineStep>

      <PipelineConnector />

      {/* Step 04: invariants */}
      <PipelineStep number="04" title="Three conservation invariants (fatal on violation)">
        <div className="border border-[#1c1c19]/30 divide-y divide-[#1c1c19]/30">
          {[
            {
              name: "Per parent",
              check: "sum of children + residual within 0.5% of Census parent total",
              guards: "catches a wrong recast number",
            },
            {
              name: "Per state",
              check: "matched population within minus 5% to plus 0.5% of Census state total",
              guards: "catches a state-level double-count",
            },
            {
              name: "National",
              check: "matched population at most Census 2011 total + 0.5%",
              guards: "catches an overall over-count",
            },
          ].map((inv) => (
            <div key={inv.name} className="grid grid-cols-12 gap-3 px-4 py-3 items-baseline">
              <div className="col-span-12 sm:col-span-3 flex items-center gap-2">
                <span className="text-[#BD402C] text-base font-bold">{"✓"}</span>
                <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19] font-bold">
                  {inv.name}
                </span>
              </div>
              <p className="col-span-12 sm:col-span-6 font-mono text-[12px] md:text-[13px] text-[#1c1c19]/85">
                {inv.check}
              </p>
              <p className="col-span-12 sm:col-span-3 font-body text-[11px] text-[#1c1c19]/55 italic">
                {inv.guards}
              </p>
            </div>
          ))}
        </div>
      </PipelineStep>

      <PipelineConnector />

      {/* Outcome */}
      <div className="px-6 md:px-8 py-6 md:py-8 border-t border-[#1c1c19] bg-[#f6f3ee]">
        <div className="flex items-baseline justify-between flex-wrap gap-4 mb-4">
          <div>
            <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C] font-bold">
              Coverage
            </span>
            <p className="font-headline text-3xl md:text-4xl headline-tight text-[#1c1c19] mt-1">
              <span className="text-[#BD402C]">{matched}</span>{" "}
              <span className="text-[#1c1c19]/50">/ 653</span>
              <span className="font-body font-normal text-base text-[#1c1c19]/70 ml-3">
                MPI districts scored
              </span>
            </p>
          </div>
        </div>
        {/* Coverage bar */}
        <div className="flex h-3 border border-[#1c1c19]/40">
          <div className="bg-[#BD402C]" style={{ width: `${(matched / 653) * 100}%` }} />
          <div className="bg-[#1c1c19]/15" style={{ width: `${(dropped / 653) * 100}%` }} />
        </div>
        <div className="flex justify-between mt-2 font-label text-[9px] uppercase tracking-[0.2em] text-[#1c1c19]/60">
          <span>{matched} matched and scored</span>
          <span>{dropped} unmatched</span>
        </div>
        <p className="font-body text-xs text-[#1c1c19]/60 italic mt-3">
          Unmatched districts lack a CSR record entirely or name-collide irrecoverably across parent states.
        </p>
      </div>
    </div>
  );
}

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

export default function MethodologyPage() {
  const [posDistribution, setPosDistribution] = useState<{ range: string; count: number }[]>([]);
  const [meta, setMeta] = useState<MetaData | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/data/csr/whitespace_master.json").then((r) => r.json()),
      fetch("/data/csr/meta.json").then((r) => r.json()),
    ]).then(([districts, metaData]: [{ POS: number }[], MetaData]) => {
      const buckets: Record<string, number> = {};
      const ranges = ["0-10", "10-20", "20-30", "30-40", "40-50", "50-60", "60-70", "70-80", "80-90", "90-100"];
      ranges.forEach((r) => (buckets[r] = 0));
      districts.forEach((d) => {
        const pos = d.POS ?? 0;
        const idx = Math.min(Math.floor(pos / 10), 9);
        buckets[ranges[idx]]++;
      });
      setPosDistribution(ranges.map((r) => ({ range: r, count: buckets[r] })));
      setMeta(metaData);
    }).catch(() => {});
  }, []);

  const tierData = meta ? [
    { name: "Tier 1 · Small", median: meta.tier_medians["Tier 1 (Small)"] ?? 0 },
    { name: "Tier 2 · Medium", median: meta.tier_medians["Tier 2 (Medium)"] ?? 0 },
    { name: "Tier 3 · Large", median: meta.tier_medians["Tier 3 (Large)"] ?? 0 },
  ] : [];

  const tierColors = ["#e0bfb9", "#BD402C", "#9b2817"];

  const totalDistricts = meta?.total_districts ?? 651;
  const posMin = meta?.pos_range?.min ?? 0;
  const posMax = meta?.pos_range?.max ?? 100;
  const sectorPosMax = meta?.sector_pos_max ?? posMax;
  const csrP25 = meta?.whitespace_thresholds?.csr_p25 ?? 13;
  const hrP75 = meta?.whitespace_thresholds?.hr_p75_pct ?? 21.1;
  const wsCount = meta?.whitespace_count ?? 44;
  const wsByState = meta?.whitespace_by_state ?? {};
  const popP33 = meta?.pop_tier_boundaries?.p33 ?? 1092256;
  const popP67 = meta?.pop_tier_boundaries?.p67 ?? 2265482;
  const meanCsr = meta?.national_mean_csr ?? 607;
  const medianCsr = meta?.national_median_csr_per_person ?? 100;
  const uImputedCount = meta?.u_imputed_count ?? 55;
  const retStats = meta?.retention_ratio_stats;
  const retMedian = retStats?.median ?? 0.555;
  const retP25 = retStats?.p25 ?? 0.442;
  const retP75 = retStats?.p75 ?? 0.674;
  const retStd = retStats?.std ?? 0.274;

  // Build the whitespace-state list dynamically from meta.json so the copy
  // never goes stale when the pipeline reruns.
  const wsStateEntries = Object.entries(wsByState).sort((a, b) => b[1] - a[1]);
  const wsTopThree = wsStateEntries.slice(0, 3);
  const wsRest = wsStateEntries.slice(3);
  const wsTopPhrase = wsTopThree
    .map(([s, c]) => `${s} (${c})`)
    .join(", ");
  const wsRestPhrase = wsRest.length
    ? `, with smaller numbers in ${wsRest.map(([s]) => s).join(", ")}`
    : "";

  return (
    <main id="main-content" className="bg-[#fcf9f4] min-h-screen">
      <Navbar />

      {/* Page header */}
      <section className="relative bg-[#fcf9f4] pt-32 md:pt-40 pb-16 md:pb-20 px-6 md:px-12 lg:px-16 border-b border-[#1c1c19]">
        <div className="max-w-7xl mx-auto">
          <div className="mb-10">
            <span className="font-label text-[10px] md:text-[11px] uppercase tracking-[0.4em] text-[#BD402C]">
              Methodology
            </span>
            <div className="h-px bg-[#1c1c19] mt-4 w-24" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
            <div className="md:col-span-8">
              <h1 className="font-headline text-5xl sm:text-6xl md:text-7xl lg:text-8xl headline-tight text-[#1c1c19]">
                Methodology<span className="italic font-light">.</span>
              </h1>
              <p className="mt-8 md:mt-10 max-w-2xl font-body text-lg md:text-xl leading-relaxed text-[#1c1c19]/90">
                How we measure the gap between poverty and philanthropic funding across {totalDistricts} Indian districts, using three government datasets and a composite scoring framework.
              </p>
            </div>
            <div className="md:col-span-4 flex flex-col gap-6 md:mt-4">
              <div className="border-t border-[#1c1c19] pt-6">
                <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-3">
                  Districts Scored
                </span>
                <div className="font-label text-3xl font-bold text-[#BD402C] tracking-tighter">
                  {totalDistricts}
                </div>
              </div>
              <div className="border-t border-[#1c1c19] pt-6">
                <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-3">
                  POS Range
                </span>
                <div className="font-label text-3xl font-bold text-[#BD402C] tracking-tighter">
                  {posMin}–{posMax}
                </div>
                <p className="font-body text-[10px] uppercase tracking-[0.15em] text-[#1c1c19]/55 mt-3 leading-relaxed">
                  All Sectors, default weights. Under a sector filter, scores can reach ~{sectorPosMax}.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16 py-20 md:py-24 space-y-24">

        {/* Objective */}
        <FadeIn>
          <section>
            <SectionHeader
              num="01"
              tag="Objective"
              title={<>The <span className="italic font-light">screening tool.</span></>}
            />
            <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#f6f3ee]">
              <p className="font-body text-base md:text-lg text-[#1c1c19]/85 leading-relaxed">
                The Philanthropic Opportunity Score (POS) quantifies where in India the gap between poverty and corporate social responsibility funding is widest. It is designed as a screening tool for CSR and philanthropic decision-makers who need district-level evidence to guide geographic strategy. The score does not prescribe investment decisions; it surfaces the districts where further due diligence is most warranted.
              </p>
            </div>
          </section>
        </FadeIn>

        {/* Data Pipeline Overview */}
        <FadeIn>
          <section>
            <SectionHeader
              num="02"
              tag="Pipeline"
              title={<>Six stages, <span className="italic font-light">end to end.</span></>}
              lead="From raw PDFs to a ranked ledger. Every record passes through six transforms before it earns a score."
            />
            <div className="grid grid-cols-2 md:grid-cols-6 border border-[#1c1c19]">
              {[
                { step: "1", label: "Extract", detail: "Parse PDF, Excel, and CSV sources" },
                { step: "2", label: "Clean", detail: "Exclude unattributable records" },
                { step: "3", label: "Match", detail: "Reconcile names across datasets" },
                { step: "4", label: "Tier", detail: "Group by population tertiles" },
                { step: "5", label: "Normalize", detail: "Min-max scale to 0-1" },
                { step: "6", label: "Score", detail: "Weighted aggregation" },
              ].map((s, i) => (
                <div
                  key={s.step}
                  className={`p-6 bg-[#fcf9f4] ${i < 3 ? "border-b md:border-b-0" : ""} ${
                    (i + 1) % 2 === 0 ? "border-l md:border-l border-[#1c1c19]" : ""
                  } ${i % 6 !== 5 ? "md:border-r" : ""} ${
                    i >= 3 ? "border-t md:border-t-0" : ""
                  } border-[#1c1c19] ${i % 2 === 1 ? "bg-[#f6f3ee]" : ""}`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C]">
                      Step
                    </span>
                    <span className="font-headline text-4xl leading-none text-[#1c1c19]/10">
                      {s.step}
                    </span>
                  </div>
                  <p className="font-label text-[11px] uppercase tracking-[0.2em] text-[#1c1c19] font-bold mb-2">
                    {s.label}
                  </p>
                  <p className="font-body text-xs text-[#1c1c19]/60 leading-relaxed">
                    {s.detail}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Data Sources */}
        <FadeIn>
          <section>
            <SectionHeader
              num="03"
              tag="Sources"
              title={<>Three <span className="italic font-light">public datasets.</span></>}
              lead="Poverty, spending, population. Each sourced from a government system of record."
            />
            <div className="border border-[#1c1c19]">
              {[
                {
                  tag: "Poverty",
                  body: (
                    <>
                      NITI Aayog{" "}
                      <a href="https://niti.gov.in/sites/default/files/2023-07/National-Multidimentional-Poverty-Index-2023-Final-17th-July.pdf" target="_blank" rel="noopener noreferrer" className="text-[#BD402C] underline decoration-[#BD402C]/40 hover:decoration-[#BD402C]">
                        National Multidimensional Poverty Index 2023
                      </a>
                      , based on the National Family Health Survey 5 (2019-21). This report uses the Alkire-Foster methodology from Oxford&apos;s OPHI to measure multidimensional poverty across health, education, and standard of living. District-level headcount ratios were extracted for both the 2015-16 and 2019-21 survey rounds, covering 653 districts across 36 states and union territories.
                    </>
                  ),
                  bg: "bg-[#fcf9f4]",
                },
                {
                  tag: "CSR",
                  body: (
                    <>
                      Ministry of Corporate Affairs{" "}
                      <a href="https://www.csr.gov.in/" target="_blank" rel="noopener noreferrer" className="text-[#BD402C] underline decoration-[#BD402C]/40 hover:decoration-[#BD402C]">
                        National CSR Portal
                      </a>
                      , via{" "}
                      <a href="https://dataful.in/datasets/1612" target="_blank" rel="noopener noreferrer" className="text-[#BD402C] underline decoration-[#BD402C]/40 hover:decoration-[#BD402C]">
                        Dataful.in (Dataset 1612)
                      </a>
                      . Ten fiscal years of CSR expenditure data (FY2014-15 through FY2023-24) at the district-sector level. The most recent three years (FY2021-24) feed the supply gap calculation. Approximately 60.7% of gross CSR spending (₹1,29,660 crore of ₹2,13,594 crore, FY2014-15 to FY2023-24) is classified as &quot;Pan India&quot; or lacks a district code and cannot be attributed to specific districts. These records are excluded entirely, which means district-level CSR totals are conservative.
                    </>
                  ),
                  bg: "bg-[#f6f3ee]",
                },
                {
                  tag: "Census",
                  body: (
                    <>
                      <a href="https://censusindia.gov.in/" target="_blank" rel="noopener noreferrer" className="text-[#BD402C] underline decoration-[#BD402C]/40 hover:decoration-[#BD402C]">
                        Census of India 2011
                      </a>{" "}
                      district-level population data covering 640 districts. This remains the most recent complete district census. The 2021 Census was postponed. Population figures serve as denominators for per capita calculations and as the basis for population-tier classification. Districts created after 2011 (through administrative reorganization) were matched to their parent district populations where possible.
                    </>
                  ),
                  bg: "bg-[#fcf9f4]",
                },
              ].map((src, i) => (
                <div
                  key={src.tag}
                  className={`grid grid-cols-1 md:grid-cols-12 gap-6 p-8 md:p-10 ${src.bg} ${
                    i < 2 ? "border-b border-[#1c1c19]" : ""
                  }`}
                >
                  <div className="md:col-span-3">
                    <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C] font-bold block mb-3">
                      {src.tag}
                    </span>
                    <span className="font-headline text-5xl md:text-6xl leading-none text-[#1c1c19]/10 block">
                      0{i + 1}
                    </span>
                  </div>
                  <p className="md:col-span-9 font-body text-base text-[#1c1c19]/80 leading-relaxed">
                    {src.body}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Data Integration */}
        <FadeIn>
          <section>
            <SectionHeader
              num="04"
              tag="Integration"
              title={<>Reconciling the <span className="italic font-light">joins.</span></>}
            />
            <JoinPipeline totalDistricts={totalDistricts} />
          </section>
        </FadeIn>

        {/* Three Components */}
        <FadeIn>
          <section>
            <SectionHeader
              num="05"
              tag="Dimensions"
              title={<>Three <span className="italic font-light">signals.</span></>}
              lead="N for need, G for gap, U for unmoved. Each one a separate test; together, the whitespace index."
            />
            <div className="grid grid-cols-1 md:grid-cols-3 border border-[#1c1c19]">
              {[
                {
                  key: "N",
                  title: "Poverty Severity",
                  weight: "40%",
                  text: "The MPI headcount ratio from NFHS-5, the share of a district's population that is multidimensionally poor across health, education, and standard of living indicators. Higher values indicate greater unmet need.",
                  bg: "bg-[#fcf9f4]",
                },
                {
                  key: "G",
                  title: "Funding Gap",
                  weight: "40%",
                  text: "How much less CSR per person a district receives compared to its population-tier median. A district receiving more than its tier median scores zero on this dimension. It is not underfunded relative to comparable peers.",
                  bg: "bg-[#f6f3ee]",
                },
                {
                  key: "U",
                  title: "Persistent Poverty",
                  weight: "20%",
                  text: `The retention ratio: what fraction of 2015-16 poverty persists in 2019-21. Values near one indicate no improvement. Values above one indicate poverty worsened. Districts without a 2015-16 baseline (${uImputedCount} of ${totalDistricts}, mostly post-2011 carve-outs that did not exist at NFHS-4) receive the median retention ratio as an imputation. This biases the U dimension toward the population mean for those districts, which is a conservative choice in an index designed to surface outliers.`,
                  bg: "bg-[#fcf9f4]",
                },
              ].map((comp, i) => (
                <div
                  key={comp.key}
                  className={`p-8 md:p-10 ${comp.bg} ${
                    i < 2 ? "border-b md:border-b-0 md:border-r border-[#1c1c19]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-6">
                    <span className="font-headline text-7xl md:text-8xl leading-none text-[#BD402C] italic font-light">
                      {comp.key}
                    </span>
                    <span className="font-label text-xl font-bold text-[#BD402C] tracking-tighter">
                      {comp.weight}
                    </span>
                  </div>
                  <h3 className="font-label text-[11px] uppercase tracking-[0.2em] text-[#1c1c19] font-bold mb-3">
                    {comp.title}
                  </h3>
                  <div className="h-px bg-[#1c1c19]/30 w-12 mb-4" />
                  <p className="font-body text-sm text-[#1c1c19]/70 leading-relaxed">
                    {comp.text}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Population-Tier Stratification */}
        <FadeIn>
          <section>
            <SectionHeader
              num="06"
              tag="Stratification"
              title={<>Compare like <span className="italic font-light">with like.</span></>}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 border border-[#1c1c19]">
              <div className="p-8 md:p-10 border-b md:border-b-0 md:border-r border-[#1c1c19] bg-[#fcf9f4] space-y-5">
                <p className="font-body text-base text-[#1c1c19]/85 leading-relaxed">
                  CSR spending across Indian districts is heavily right-skewed. The mean CSR density is roughly ₹{Math.round(meanCsr)} per person while the median is ₹{Math.round(medianCsr)}, a ratio that reflects a long right tail driven by corporate headquarters districts like Mumbai, Bengaluru, and Pune.
                </p>
                <p className="font-body text-base text-[#1c1c19]/85 leading-relaxed">
                  A single national median benchmark would flag nearly every rural district as underfunded. Instead, districts are split into three population tiers at the 33rd and 67th percentile boundaries. Each tier receives its own median CSR density as the benchmark.
                </p>
                <div className="border-t border-[#1c1c19] pt-5 space-y-3">
                  <div className="flex items-start gap-4">
                    <span className="font-label text-[11px] uppercase tracking-[0.15em] text-[#BD402C] font-bold w-24 shrink-0">
                      Tier 1
                    </span>
                    <span className="font-body text-sm text-[#1c1c19]/80">
                      Up to {formatLakh(popP33)}
                    </span>
                  </div>
                  <div className="flex items-start gap-4">
                    <span className="font-label text-[11px] uppercase tracking-[0.15em] text-[#BD402C] font-bold w-24 shrink-0">
                      Tier 2
                    </span>
                    <span className="font-body text-sm text-[#1c1c19]/80">
                      {formatLakh(popP33)} to {formatLakh(popP67)}
                    </span>
                  </div>
                  <div className="flex items-start gap-4">
                    <span className="font-label text-[11px] uppercase tracking-[0.15em] text-[#BD402C] font-bold w-24 shrink-0">
                      Tier 3
                    </span>
                    <span className="font-body text-sm text-[#1c1c19]/80">
                      Above {formatLakh(popP67)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="p-8 md:p-10 bg-[#f6f3ee]">
                <p className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] font-bold mb-2">
                  Figure 02
                </p>
                <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mb-6">
                  Tier Median CSR · ₹ per person
                </p>
                {tierData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={tierData} margin={{ top: 8, right: 8, bottom: 4, left: -10 }}>
                      <CartesianGrid strokeDasharray="0" stroke="rgba(28,28,25,0.08)" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10, fill: "#1c1c19", fontFamily: "var(--font-space-grotesk)" }}
                        axisLine={{ stroke: "#1c1c19" }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 9, fill: "#1c1c19", fontFamily: "var(--font-space-grotesk)" }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                      />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        labelStyle={{ color: "#fcf9f4", fontWeight: 600 }}
                        itemStyle={{ color: "#fcf9f4" }}
                        cursor={{ fill: "rgba(28,28,25,0.05)" }}
                        formatter={(value) => [`₹${value}`, "Tier Median"]}
                      />
                      <Bar dataKey="median" radius={[0, 0, 0, 0]} maxBarSize={60}>
                        {tierData.map((_, idx) => (
                          <Cell key={idx} fill={tierColors[idx]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[240px] flex items-center justify-center font-label text-xs uppercase tracking-widest text-[#1c1c19]/50">
                    Loading data...
                  </div>
                )}
                <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/50 mt-3 text-center">
                  Benchmark is tier-specific, not national
                </p>
                <p className="font-body text-xs text-[#1c1c19]/60 italic mt-3 leading-relaxed">
                  Note: Tier 3 (Large) has a lower median than Tier 2 (Medium). This non-monotonic pattern reflects the composition of large districts, which include heavily rural districts with minimal corporate presence alongside urban commercial centres. The tier boundaries are population percentiles, not CSR-ordered groupings.
                </p>
              </div>
            </div>
          </section>
        </FadeIn>

        {/* Normalization & Aggregation */}
        <FadeIn>
          <section>
            <SectionHeader
              num="07"
              tag="Aggregation"
              title={<>Normalize, <span className="italic font-light">weight, score.</span></>}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 border border-[#1c1c19]">
              <div className="p-8 md:p-10 border-b md:border-b-0 md:border-r border-[#1c1c19] bg-[#fcf9f4]">
                <div className="flex items-start justify-between mb-6">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C]">
                    Step 01
                  </span>
                  <span className="font-headline text-5xl leading-none text-[#1c1c19]/10">
                    i
                  </span>
                </div>
                <h3 className="font-headline text-2xl md:text-3xl text-[#1c1c19] mb-4 headline-tight">
                  Min-max normalize each component.
                </h3>
                <div className="h-px bg-[#1c1c19]/30 w-12 mb-4" />
                <p className="font-body text-sm text-[#1c1c19]/75 leading-relaxed">
                  Each raw component is scaled to a 0–1 range across all {totalDistricts} districts. This approach, recommended by the OECD Handbook on Constructing Composite Indicators, ensures components with different units and magnitudes contribute proportionally to the final score.
                </p>
              </div>
              <div className="p-8 md:p-10 bg-[#f6f3ee]">
                <div className="flex items-start justify-between mb-6">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C]">
                    Step 02
                  </span>
                  <span className="font-headline text-5xl leading-none text-[#1c1c19]/10">
                    ii
                  </span>
                </div>
                <h3 className="font-headline text-2xl md:text-3xl text-[#1c1c19] mb-4 headline-tight">
                  Weighted linear aggregation.
                </h3>
                <div className="border border-[#1c1c19] bg-[#fcf9f4] p-6 my-5">
                  <p className="font-headline italic text-base md:text-lg text-center text-[#BD402C]">
                    POS = (0.40 × N̂ + 0.40 × Ĝ + 0.20 × Û) × 100
                  </p>
                </div>
                <p className="font-body text-sm text-[#1c1c19]/75 leading-relaxed">
                  Where N̂ is normalized poverty severity, Ĝ is normalized funding gap, and Û is normalized poverty persistence. The result is a score from 0 to 100. Users can adjust all weights through the interactive simulator.
                </p>
              </div>
            </div>
          </section>
        </FadeIn>

        {/* Weight Justification */}
        <FadeIn>
          <section>
            <SectionHeader
              num="08"
              tag="Weighting"
              title={<>Equal partners, <span className="italic font-light">one junior.</span></>}
            />
            <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#fcf9f4] space-y-5 mb-8">
              <p className="font-body text-base text-[#1c1c19]/85 leading-relaxed">
                Need and Gap receive equal weight (40% each) because both are necessary conditions for philanthropic whitespace. A district must be both poor and underfunded to represent a genuine opportunity. A poor district receiving adequate CSR is not a whitespace; a well-funded district with low poverty is not a priority.
              </p>
              <p className="font-body text-base text-[#1c1c19]/85 leading-relaxed">
                Persistence receives lower weight (20%) because the retention ratio derives from only two time points (NFHS-4 and NFHS-5), spaced five years apart. District-level sampling variance is higher than for the headcount ratio itself, making this the least precise of the three signals. This weighting structure mirrors the approach used by the UNDP Human Development Index, where unequal weights reflect differential measurement reliability.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 border border-[#1c1c19]">
              {WEIGHT_PRESETS.map((preset, idx) => (
                <div
                  key={preset.name}
                  className={`p-6 ${idx % 2 === 1 ? "bg-[#f6f3ee]" : "bg-[#fcf9f4]"} ${
                    idx < WEIGHT_PRESETS.length - 1 ? "border-b md:border-b-0 md:border-r border-[#1c1c19]" : ""
                  }`}
                >
                  <p className="font-label text-[11px] uppercase tracking-[0.2em] text-[#1c1c19] font-bold mb-4">
                    {preset.name}
                  </p>
                  <div className="space-y-3 mb-4">
                    {[
                      { label: "N", value: preset.N },
                      { label: "G", value: preset.G },
                      { label: "U", value: preset.U },
                    ].map((w) => (
                      <div key={w.label} className="flex items-center gap-3">
                        <span className="font-label text-[10px] font-bold text-[#BD402C] w-3">
                          {w.label}
                        </span>
                        <div className="flex-1 h-px bg-[#1c1c19]/20 relative overflow-hidden">
                          <div
                            className="absolute inset-y-0 left-0 bg-[#BD402C]"
                            style={{ width: `${w.value}%`, height: "2px", top: "-0.5px" }}
                          />
                        </div>
                        <span className="font-label text-[10px] text-[#1c1c19]/70 w-8 text-right tabular-nums">
                          {w.value}%
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="font-body text-xs italic text-[#1c1c19]/60 leading-relaxed">
                    {preset.desc}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* POS Distribution */}
        <FadeIn>
          <section>
            <SectionHeader
              num="09"
              tag="Distribution"
              title={<>How the <span className="italic font-light">scores fall.</span></>}
            />
            <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#f6f3ee]">
              <div className="flex items-center justify-between mb-6">
                <p className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] font-bold">
                  Figure 03 · POS Distribution
                </p>
                <span className="font-label text-[10px] tracking-widest text-[#1c1c19]/50">
                  N = {totalDistricts}
                </span>
              </div>
              {posDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={posDistribution} margin={{ top: 8, right: 8, bottom: 4, left: -10 }}>
                    <CartesianGrid strokeDasharray="0" stroke="rgba(28,28,25,0.08)" vertical={false} />
                    <XAxis
                      dataKey="range"
                      tick={{ fontSize: 9, fill: "#1c1c19", fontFamily: "var(--font-space-grotesk)" }}
                      axisLine={{ stroke: "#1c1c19" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "#1c1c19", fontFamily: "var(--font-space-grotesk)" }}
                      axisLine={false}
                      tickLine={false}
                      width={35}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      labelStyle={{ color: "#fcf9f4", fontWeight: 600 }}
                      itemStyle={{ color: "#fcf9f4" }}
                      cursor={{ fill: "rgba(28,28,25,0.05)" }}
                      formatter={(value) => [`${value} districts`, "Count"]}
                    />
                    <Bar dataKey="count" radius={[0, 0, 0, 0]} maxBarSize={44}>
                      {posDistribution.map((_, idx) => (
                        <Cell key={idx} fill={idx < 3 ? "#f0ede8" : idx < 6 ? "#e0bfb9" : idx < 8 ? "#BD402C" : "#9b2817"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[260px] flex items-center justify-center font-label text-xs uppercase tracking-widest text-[#1c1c19]/50">
                  Loading distribution data...
                </div>
              )}
              <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-4 text-center">
                All Sectors, default weights: scores span {posMin}–{posMax}. Under a sector filter, unfunded sectors saturate Ĝ at 1.0 and scores can reach ~{sectorPosMax}.
              </p>
            </div>
          </section>
        </FadeIn>

        {/* Whitespace Classification */}
        <FadeIn>
          <section>
            <SectionHeader
              num="10"
              tag="Classification"
              title={<>Defining <span className="italic font-light">neglect.</span></>}
            />
            <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#fcf9f4]">
              <p className="font-body text-base md:text-lg text-[#1c1c19]/85 leading-relaxed">
                A district is flagged as{" "}
                <span className="text-[#BD402C] font-bold">neglected</span>{" "}
                when it falls simultaneously in the bottom 25th percentile of CSR per person (below ₹{Math.round(csrP25)} per person) and the top 25th percentile of MPI headcount ratio (above {hrP75}% poverty). These are districts where need is highest and funding lowest. The current dataset identifies{" "}
                <span className="text-[#BD402C] font-bold">{wsCount}</span>{" "}
                such districts{wsTopPhrase ? `, concentrated in ${wsTopPhrase}` : ""}{wsRestPhrase}.
              </p>
            </div>
          </section>
        </FadeIn>

        {/* Methodological Framework */}
        <FadeIn>
          <section>
            <SectionHeader
              num="11"
              tag="Precedent"
              title={<>Standing on the <span className="italic font-light">shoulders.</span></>}
            />
            <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#f6f3ee]">
              <p className="font-body text-base md:text-lg text-[#1c1c19]/85 leading-relaxed">
                The composite scoring approach follows the{" "}
                <a href="https://www.oecd.org/en/publications/handbook-on-constructing-composite-indicators-methodology-and-user-guide_9789264043466-en.html" target="_blank" rel="noopener noreferrer" className="text-[#BD402C] underline decoration-[#BD402C]/40 hover:decoration-[#BD402C]">
                  OECD Handbook on Constructing Composite Indicators (Nardo et al., 2008)
                </a>
                , the standard international reference for composite index construction. Min-max normalization and weighted linear aggregation follow the same design principles used by the UNDP Human Development Index and the Global Multidimensional Poverty Index itself.
              </p>
            </div>
          </section>
        </FadeIn>

        {/* Limitations */}
        <FadeIn>
          <section>
            <SectionHeader
              num="12"
              tag="Caveats"
              title={<>What the score <span className="italic font-light">cannot see.</span></>}
              lead="Every index has a blind spot. Here are seven we know about."
            />
            <div className="border border-[#1c1c19]">
              {[
                "This is a screening tool for geographic prioritization, not a causal model. A high score does not guarantee that investment will produce impact. It indicates where the gap between need and funding is widest.",
                "District-level CSR totals are conservative. Approximately 60.7% of gross CSR spending is classified as Pan India or lacks a district code and cannot be attributed to specific districts. This exclusion is not random: Pan-India programs disproportionately originate from districts housing corporate headquarters, meaning the funding gap is likely overstated for well-connected urban districts and understated for rural districts that may benefit from these programmes without receiving attribution.",
                `Population denominators are from Census 2011, over eight years before the MPI survey. Districts carved from parents after 2011 inherit the parent's full population (flagged \`population_imputed\`), which deflates per-capita CSR and inflates G for those districts. Fast-growing districts may also be 10–15% understated relative to current population.`,
                "MPI data reflects conditions in 2019-21 (NFHS-5). District-level poverty may have shifted in the years since data collection.",
                `The Unresolved component (U) imputes the median retention ratio (${retMedian.toFixed(3)}, IQR: ${retP25.toFixed(3)}–${retP75.toFixed(3)}, std: ${retStd.toFixed(3)}) for ${uImputedCount} of ${totalDistricts} districts that lack a 2015-16 baseline — predominantly districts carved from parent districts after Census 2011 (and therefore absent from NFHS-4). U values for imputed districts are estimates, not observations.`,
                "The score does not account for government spending beyond CSR, private philanthropy outside the Companies Act framework, or international development aid flowing to these districts.",
                "The three components are treated as independent dimensions. In practice, poverty severity, funding gaps, and poverty persistence may be correlated, which could amplify the signal for districts that score high on multiple dimensions.",
              ].map((text, i) => (
                <div
                  key={i}
                  className={`grid grid-cols-1 md:grid-cols-12 gap-6 p-6 md:p-8 ${
                    i % 2 === 1 ? "bg-[#f6f3ee]" : "bg-[#fcf9f4]"
                  } ${i < 6 ? "border-b border-[#1c1c19]" : ""}`}
                >
                  <div className="md:col-span-2">
                    <span className="font-headline text-4xl md:text-5xl leading-none text-[#BD402C]/30 italic font-light">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <p className="md:col-span-10 font-body text-sm md:text-base text-[#1c1c19]/80 leading-relaxed">
                    {text}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

      </div>

      <Footer />
    </main>
  );
}
