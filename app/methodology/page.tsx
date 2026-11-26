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
// The index's summary, built into the page so the page as served states the
// data's figures. Until it was, the served page gave typed fallbacks
// ("Score range 0-100", an older whitespace count, a 25th percentile of 13),
// none of which the data holds. The file is still read afterwards.
import csrMeta from "@/public/data/csr/meta.json";

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
  { name: "Balanced", N: 40, G: 40, U: 20, desc: "Need and the funding gap weighted equally" },
  { name: "Highest Need", N: 60, G: 25, U: 15, desc: "More weight on poverty" },
  { name: "Most Underfunded", N: 20, G: 65, U: 15, desc: "More weight on the funding gap" },
  { name: "Stuck Districts", N: 25, G: 30, U: 45, desc: "More weight on persistence" },
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
  const mpiDistricts = csrMeta.mpi_districts;
  const dropped = mpiDistricts - matched;
  const notRecorded = csrMeta.csr_not_recorded_count;
  const methods = csrMeta.population_method_counts;
  // districts drawn after 2011, each given the 2011 population of its area
  const carvedOut = methods.gazette_2011_table + methods.subdistrict_sum + methods.areal_allocation;
  return (
    <div className="border border-[#1c1c19] bg-[#fcf9f4]">
      {/* Frame header */}
      <div className="border-b border-[#1c1c19] px-6 md:px-8 py-5 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <span className="font-label text-[10px] md:text-[11px] uppercase tracking-[0.3em] text-[#BD402C] font-bold block">
            How the records were matched
          </span>
          <p className="font-body text-xs text-[#1c1c19]/65 mt-1.5 max-w-xl">
            The three sources come from different agencies, which spell district names differently and list districts as they stood in different years. We started from the MPI list, because a district can only be scored if it has a poverty figure, and attached CSR spending and Census population to each district on it.
          </p>
        </div>
        <span className="font-label text-[9px] md:text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/55 self-end">
          Census · MPI · CSR
        </span>
      </div>

      {/* Step 0: three sources -> one matched record */}
      <div className="px-6 md:px-8 py-6 md:py-8">
        <div className="grid grid-cols-3 border border-[#1c1c19]/30">
          {[
            { dataset: "Census 2011", source: "Registrar General of India", spelling: "Hugli", subline: "640 districts" },
            { dataset: "MPI 2023", source: "NITI Aayog (NFHS-5)", spelling: "Hugli (Hooghly)", subline: `${mpiDistricts} districts` },
            { dataset: "CSR / MCA", source: "Ministry of Corporate Affairs", spelling: "Hooghly", subline: `${csrMeta.csr_district_pairs} state and district pairs` },
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
            One matched district record
          </p>
          <p className="font-mono text-sm md:text-base text-[#1c1c19]">
            West Bengal / Hugli
          </p>
        </div>
      </div>

      <PipelineConnector />

      {/* Step 01: fuzzy match algorithm */}
      <PipelineStep number="01" title="Matching names within each state">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
          <div>
            <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 block mb-1">
              Method
            </span>
            <p className="font-mono text-base text-[#1c1c19]">rapidfuzz.fuzz.ratio</p>
          </div>
          <div>
            <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 block mb-1">
              Threshold
            </span>
            <p className="font-mono text-base text-[#1c1c19]">90% for CSR names, 80% for Census names</p>
            <p className="font-body text-xs text-[#1c1c19]/55 italic mt-1">
              A CSR name must also share its first word with the district&apos;s, so West Jaintia Hills cannot take East Jaintia Hills&apos; spending.
            </p>
          </div>
          <div>
            <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 block mb-1">
              Spellings checked by hand
            </span>
            <p className="font-mono text-base text-[#1c1c19]">Shravasti and Shrawasti</p>
            <p className="font-body text-xs text-[#1c1c19]/55 italic mt-1">
              Pairs too far apart for the matcher, and districts renamed since 2021, are listed in the code after a check against the filings&apos; own district list for the state.
            </p>
          </div>
          <div>
            <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 block mb-1">
              Scope
            </span>
            <p className="font-mono text-base text-[#1c1c19]">Within one state</p>
          </div>
        </div>

        {/* False-positive visualization: state scoping diagram */}
        <div className="mt-5 border border-[#1c1c19]/30 bg-white/40 p-4">
          <p className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 mb-3">
            Why matching stays within a state
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="border border-[#1c1c19]/40 bg-white p-3">
              <p className="font-label text-[9px] uppercase tracking-[0.2em] text-[#BD402C] font-bold mb-1">
                Himachal Pradesh
              </p>
              <p className="font-mono text-sm text-[#1c1c19]">Hamirpur</p>
              <p className="font-label text-[8px] uppercase tracking-[0.15em] text-[#1c1c19]/45 mt-1">
                Population about 454,000
              </p>
            </div>
            <div className="text-center">
              <p className="font-mono text-[#BD402C]/70 text-base">100%</p>
              <p className="font-label text-[8px] uppercase tracking-[0.2em] text-[#1c1c19]/55 mt-1">
                Identical names
              </p>
              <p className="font-label text-[8px] uppercase tracking-[0.2em] text-[#BD402C] font-bold mt-2">
                Different states
              </p>
              <p className="font-label text-[8px] uppercase tracking-[0.2em] text-[#1c1c19]/55 mt-1">
                so they were kept apart
              </p>
            </div>
            <div className="border border-[#1c1c19]/40 bg-white p-3">
              <p className="font-label text-[9px] uppercase tracking-[0.2em] text-[#BD402C] font-bold mb-1">
                Uttar Pradesh
              </p>
              <p className="font-mono text-sm text-[#1c1c19]">Hamirpur</p>
              <p className="font-label text-[8px] uppercase tracking-[0.15em] text-[#1c1c19]/45 mt-1">
                Population about 1.1 million, a different district
              </p>
            </div>
          </div>
        </div>
      </PipelineStep>

      <PipelineConnector />

      {/* Step 02: renames */}
      <PipelineStep number="02" title="Renamed districts">
        <div className="flex flex-wrap gap-2">
          {[
            "Gurgaon to Gurugram",
            "Mysore to Mysuru",
            "Allahabad to Prayagraj",
            "Belgaum to Belagavi",
            "Faizabad to Ayodhya",
            "Four Sikkim districts, 2021",
          ].map((p) => (
            <span
              key={p}
              className="font-mono text-[12px] text-[#1c1c19] border border-[#1c1c19]/40 px-3 py-1.5 bg-white/60"
            >
              {p}
            </span>
          ))}
          <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/55 px-2 py-1.5 self-center">
            and {methods.census_exact_rename - 9} more renamed or spelled differently
          </span>
        </div>
        <p className="font-body text-xs text-[#1c1c19]/60 italic mt-3">
          A district that was only renamed kept its 2011 boundary, so it keeps its Census 2011 population under the new name.
        </p>
      </PipelineStep>

      <PipelineConnector />

      {/* Step 03: districts drawn after 2011 get their own 2011 population */}
      <PipelineStep number="03" title="Districts created after 2011">
        <p className="font-body text-sm text-[#1c1c19]/75 leading-relaxed mb-4">
          Of the districts in the MPI list, {carvedOut} <span className="italic">did not exist in Census 2011</span>. They were carved out of older districts after the census was taken, so each was given the 2011 population of the area it now covers, and the district it came from kept the remainder.
        </p>

        {/* The split shown as one bar */}
        <div className="border border-[#1c1c19]/30 bg-white/40 p-5">
          <p className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 mb-4">
            Example: Palghar, carved out of Thane in Maharashtra in 2014
          </p>

          <div className="mb-3 flex items-baseline justify-between gap-2 flex-wrap">
            <span className="font-label text-[10px] uppercase tracking-[0.2em] text-[#1c1c19]/65">
              Thane in Census 2011
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
          <div className="flex h-12 border border-[#1c1c19]/40 overflow-hidden" aria-label="Bar showing Palghar as 27% and the rest of Thane as 73% of Thane's 2011 population">
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
                From the gazette or Census handbook
              </p>
            </div>
            <div style={{ width: `${thaneResidualPct}%` }} className="text-center px-1">
              <p className="font-label text-[9px] uppercase tracking-[0.2em] text-[#1c1c19] font-bold">
                Thane (remainder)
              </p>
              <p className="font-label text-[8px] uppercase tracking-[0.15em] text-[#1c1c19]/55 mt-0.5">
                Thane&apos;s 2011 total minus Palghar
              </p>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-[#1c1c19]/20 text-center">
            <span className="font-mono text-sm md:text-base text-[#1c1c19]">
              2,990,116 + 8,070,032 = 11,060,148
            </span>
            <span className="font-label text-[10px] uppercase tracking-[0.25em] text-[#BD402C] font-bold ml-3">
              the 2011 total
            </span>
            <p className="font-body text-xs text-[#1c1c19]/55 italic mt-2">
              Thane&apos;s figure is what remains once Palghar is taken out, so the two districts together count Thane&apos;s 2011 population once.
            </p>
          </div>
        </div>

        {/* Catalogue + coverage */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <p className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 mb-2">
              Where the figures come from
            </p>
            <p className="font-mono text-[12px] text-[#1c1c19] mb-2 break-all">
              scripts/csr/data/external/population_recast_2011.csv
            </p>
            <p className="font-body text-sm text-[#1c1c19]/70 leading-relaxed">
              This table in the project&apos;s code gives each new district its 2011 population and links each figure to its source. Of those figures, {methods.gazette_2011_table} come from a District Census Handbook, the state&apos;s gazette notification or a Wikipedia article citing one of them, and {methods.subdistrict_sum} are the Census 2011 totals of the sub-districts the new district took over. For the {methods.areal_allocation} where neither was available, the older district&apos;s population was divided in proportion to area.
            </p>
          </div>
          <div>
            <p className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19]/60 mb-2">
              Where it applied ({carvedOut} districts)
            </p>
            <ul className="font-body text-sm text-[#1c1c19]/75 leading-relaxed space-y-1">
              <li>Telangana, 2016: 21 new districts and the remainders of 9 older ones</li>
              <li>Paschim and Purba Bardhaman, split in 2017</li>
              <li>East and West Jaintia Hills, split in 2012</li>
              <li>Palghar, Kondagaon, Gariyaband and others</li>
            </ul>
          </div>
        </div>

        <div className="mt-5 border-l-2 border-[#BD402C] bg-[#BD402C]/5 px-4 py-3">
          <p className="font-label text-[10px] uppercase tracking-[0.25em] text-[#BD402C] font-bold mb-1">
            When a figure is missing
          </p>
          <p className="font-body text-sm text-[#1c1c19]/85 leading-relaxed">
            If a district created after 2011 has no row in the table, the build stops and names it, so no district is ever scored with the whole population of the district it came from.
          </p>
        </div>
      </PipelineStep>

      <PipelineConnector />

      {/* Step 04: invariants */}
      <PipelineStep number="04" title="Four checks, each of which stops the build if it fails">
        <div className="border border-[#1c1c19]/30 divide-y divide-[#1c1c19]/30">
          {[
            {
              name: "Per district",
              check: "New districts plus the remainder within 0.5% of the older district's Census 2011 population",
              guards: "Catches a wrong figure for one district",
            },
            {
              name: "Per state",
              check: "Matched population within 0.5% of the state's Census 2011 total, above or below",
              guards: "Catches a district counted twice, or one lost",
            },
            {
              name: "National",
              check: "Matched population within 0.5% of India's Census 2011 total, above or below",
              guards: "Catches double counting or lost districts across states",
            },
            {
              name: "CSR names",
              check: "No district's spending is credited twice, and no district without a match has a spelling in the filings that could be its own",
              guards: "Catches a district shown as receiving nothing because its name was missed",
            },
          ].map((inv) => (
            <div key={inv.name} className="grid grid-cols-12 gap-3 px-4 py-3 items-baseline">
              <div className="col-span-12 sm:col-span-3 flex items-center gap-2">
                <span className="text-[#BD402C] text-base font-bold" aria-hidden>{"✓"}</span>
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
              Districts scored
            </span>
            <p className="font-headline text-3xl md:text-4xl headline-tight text-[#1c1c19] mt-1">
              <span className="text-[#BD402C]">{matched}</span>{" "}
              <span className="text-[#1c1c19]/50">/ {mpiDistricts}</span>
              <span className="font-body font-normal text-base text-[#1c1c19]/70 ml-3">
                districts on the MPI list
              </span>
            </p>
          </div>
        </div>
        {/* Coverage bar */}
        <div className="flex h-3 border border-[#1c1c19]/40">
          <div className="bg-[#BD402C]" style={{ width: `${(matched / mpiDistricts) * 100}%` }} />
          <div className="bg-[#1c1c19]/15" style={{ width: `${(dropped / mpiDistricts) * 100}%` }} />
        </div>
        <div className="flex justify-between mt-2 font-label text-[9px] uppercase tracking-[0.2em] text-[#1c1c19]/60">
          <span>{matched} scored</span>
          <span>{dropped} left out</span>
        </div>
        <p className="font-body text-xs text-[#1c1c19]/60 italic mt-3">
          {dropped === 0
            ? "Every district on the MPI list has a Census population and is scored."
            : `${dropped} districts on the MPI list have no Census population and are not scored.`}{" "}
          The filings place no CSR spending in {notRecorded} of them between FY2021-22 and FY2023-24. Their recorded spending is ₹0, and the ranking marks them as having none on record.
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
  const [meta, setMeta] = useState<MetaData | null>(csrMeta as unknown as MetaData);

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

  // Every fallback is the built-in meta.json, so the page as served states
  // the data's figures even before the files are read again.
  const m0 = csrMeta;
  const totalDistricts = meta?.total_districts ?? m0.total_districts;
  const posMin = meta?.pos_range?.min ?? m0.pos_range.min;
  const posMax = meta?.pos_range?.max ?? m0.pos_range.max;
  const sectorPosMax = meta?.sector_pos_max ?? m0.sector_pos_max;
  const csrP25 = meta?.whitespace_thresholds?.csr_p25 ?? m0.whitespace_thresholds.csr_p25;
  const hrP75 = meta?.whitespace_thresholds?.hr_p75_pct ?? m0.whitespace_thresholds.hr_p75_pct;
  const wsCount = meta?.whitespace_count ?? m0.whitespace_count;
  const wsByState = meta?.whitespace_by_state ?? m0.whitespace_by_state;
  const popP33 = meta?.pop_tier_boundaries?.p33 ?? m0.pop_tier_boundaries.p33;
  const popP67 = meta?.pop_tier_boundaries?.p67 ?? m0.pop_tier_boundaries.p67;
  const meanCsr = meta?.national_mean_csr ?? m0.national_mean_csr;
  const medianCsr = meta?.national_median_csr_per_person ?? m0.national_median_csr_per_person;
  const uImputedCount = meta?.u_imputed_count ?? m0.u_imputed_count;
  const retStats = meta?.retention_ratio_stats ?? m0.retention_ratio_stats;
  const retMedian = retStats?.median ?? m0.retention_ratio_stats.median;
  const retP25 = retStats?.p25 ?? m0.retention_ratio_stats.p25;
  const retP75 = retStats?.p75 ?? m0.retention_ratio_stats.p75;
  const retStd = retStats?.std ?? m0.retention_ratio_stats.std;
  const totals = m0.csr_totals;
  const crore = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")} crore`;
  const tierMed = meta?.tier_medians ?? m0.tier_medians;
  const largeBelowMedium = (tierMed["Tier 3 (Large)"] ?? 0) < (tierMed["Tier 2 (Medium)"] ?? 0);

  // Where the whitespace districts are, from meta.json. States holding at
  // least a tenth of them are named with their counts; the rest are listed.
  const wsStateEntries = Object.entries(wsByState).sort((a, b) => b[1] - a[1]);
  const wsBig = wsStateEntries.filter(([, c]) => c >= wsCount / 10);
  const wsSmall = wsStateEntries.filter(([, c]) => c < wsCount / 10);
  const andJoin = (xs: string[]) =>
    xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  const wsBigPhrase = andJoin(wsBig.map(([st, c]) => `${c} in ${st}`));
  const wsSmallCount = wsSmall.reduce((a, [, c]) => a + c, 0);
  const wsPlaces = wsBig.length
    ? `: ${wsBigPhrase}${wsSmall.length ? `, and the other ${wsSmallCount} in ${andJoin(wsSmall.map(([st]) => st))}` : ""}`
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
                How we measure the gap between poverty and corporate social responsibility (CSR) funding in {totalDistricts} Indian districts, using three government datasets combined into one score.
              </p>
            </div>
            <div className="md:col-span-4 flex flex-col gap-6 md:mt-4">
              <div className="border-t border-[#1c1c19] pt-6">
                <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-3">
                  Districts scored
                </span>
                <div className="font-label text-3xl font-bold text-[#BD402C] tracking-tighter">
                  {totalDistricts}
                </div>
              </div>
              <div className="border-t border-[#1c1c19] pt-6">
                <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-3">
                  Score range
                </span>
                <div className="font-label text-3xl font-bold text-[#BD402C] tracking-tighter">
                  {posMin}–{posMax}
                </div>
                <p className="font-body text-[10px] uppercase tracking-[0.15em] text-[#1c1c19]/55 mt-3 leading-relaxed">
                  Across all sectors at the default weights. With one sector selected, scores can reach about {sectorPosMax}.
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
              title={<>What the score <span className="italic font-light">is for.</span></>}
            />
            <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#f6f3ee]">
              <p className="font-body text-base md:text-lg text-[#1c1c19]/85 leading-relaxed">
                The opportunity score measures where in India the gap between poverty and CSR funding is widest. It is meant as a first screen for companies and foundations choosing where to work, and it points them to the districts that most deserve closer study. The decision about where to spend stays with them.
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
              title={<>Six stages <span className="italic font-light">from source to score.</span></>}
              lead="Every record passes through six steps between the source files and the published ranking."
            />
            <div className="grid grid-cols-2 md:grid-cols-6 border border-[#1c1c19]">
              {[
                { step: "1", label: "Extract", detail: "Read the PDF, Excel and CSV sources" },
                { step: "2", label: "Clean", detail: "Set aside records with no district" },
                { step: "3", label: "Match", detail: "Line up district names across the sources" },
                { step: "4", label: "Tier", detail: "Group districts into three population tiers" },
                { step: "5", label: "Normalise", detail: "Rescale each measure to 0-1" },
                { step: "6", label: "Score", detail: "Add the weighted measures" },
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
              lead="Poverty figures come from NITI Aayog, CSR spending from the Ministry of Corporate Affairs and population from the Census of India."
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
                      , which is based on the fifth National Family Health Survey (NFHS-5, 2019-21). The index follows the Alkire-Foster method of Oxford&apos;s Poverty and Human Development Initiative (OPHI), which counts deprivations in health, education and standard of living. We took district headcount ratios for both survey rounds, 2015-16 and 2019-21, which cover {m0.mpi_districts} districts in 36 states and union territories.
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
                      , through{" "}
                      <a href="https://dataful.in/datasets/1612" target="_blank" rel="noopener noreferrer" className="text-[#BD402C] underline decoration-[#BD402C]/40 hover:decoration-[#BD402C]">
                        Dataful.in (Dataset 1612)
                      </a>
                      . The data covers ten financial years of CSR spending, FY2014-15 to FY2023-24, by district and sector, and the funding gap is calculated from the latest three (FY2021-24). About {totals.pan_india_pct.toFixed(1)}% of gross CSR spending over the ten years ({crore(totals.pan_india_csr_all_years_crore)} of {crore(totals.total_all_years_gross_crore)}) is recorded as &quot;Pan India&quot; or names no district, so it cannot be assigned to a district. Those records are left out, which is why the district CSR totals in this index are conservative.
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
                      population figures for 640 districts. The 2021 Census was postponed, so Census 2011 is still the most recent one India has published. Population is the denominator of every per-person figure and the basis of the population tiers. A district created after 2011 is given the 2011 population of the area it now covers, as section 04 explains.
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
              title={<>Matching <span className="italic font-light">the records.</span></>}
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
              title={<>Three <span className="italic font-light">measures.</span></>}
              lead="The score combines poverty (N), the funding gap (G) and persistence (U), which is how little poverty has fallen. Each is measured on its own, and their weighted sum is the score."
            />
            <div className="grid grid-cols-1 md:grid-cols-3 border border-[#1c1c19]">
              {[
                {
                  key: "N",
                  title: "Poverty",
                  weight: "40%",
                  text: "The MPI headcount ratio from NFHS-5, which is the share of a district's people who are poor on the index's health, education and living-standard indicators. A higher share means greater unmet need.",
                  bg: "bg-[#fcf9f4]",
                },
                {
                  key: "G",
                  title: "Funding gap",
                  weight: "40%",
                  text: "How far a district's CSR spending per person falls below the median for its population tier. A district above its tier median scores zero on this measure, since it already receives at least as much as comparable districts.",
                  bg: "bg-[#f6f3ee]",
                },
                {
                  key: "U",
                  title: "Persistence",
                  weight: "20%",
                  text: `The retention ratio, which is the share of the 2015-16 poverty rate still present in 2019-21. A value near one means poverty did not fall, and a value above one means it rose. ${uImputedCount} of ${totalDistricts} districts have no 2015-16 figure, mostly because they were created after 2011 and did not exist at the time of NFHS-4, and they are given the median retention ratio. That pulls their U score towards the middle, a cautious choice in an index meant to pick out unusual districts.`,
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
              title={<>Comparing districts <span className="italic font-light">of similar size.</span></>}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 border border-[#1c1c19]">
              <div className="p-8 md:p-10 border-b md:border-b-0 md:border-r border-[#1c1c19] bg-[#fcf9f4] space-y-5">
                <p className="font-body text-base text-[#1c1c19]/85 leading-relaxed">
                  CSR spending is concentrated in a few districts. The mean is roughly ₹{Math.round(meanCsr)} per person and the median ₹{Math.round(medianCsr)}, and the gap between the two comes from a few districts where companies have their head offices, such as New Delhi, Mumbai and Gurugram.
                </p>
                <p className="font-body text-base text-[#1c1c19]/85 leading-relaxed">
                  Measured against one national median, nearly every rural district would look underfunded. Districts are therefore split into three population tiers at the 33rd and 67th percentiles, and each is compared with the median CSR per person of its own tier. With one sector chosen, a tier&apos;s benchmark is the median among its districts that record any spending in that sector, because in most sectors the plain median of the two smaller tiers is zero. The gap is then the share of that benchmark a district lacks, from 0 for a district at or above it to 1 for a district with no spending in the sector.
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
                  Median CSR per person in each tier, ₹
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
                        formatter={(value) => [`₹${value}`, "Tier median"]}
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
                  Each tier has its own benchmark
                </p>
                {largeBelowMedium && (
                  <p className="font-body text-xs text-[#1c1c19]/60 italic mt-3 leading-relaxed">
                    Tier 3 (Large) has a lower median than Tier 2 (Medium). Large districts include very rural places with little corporate presence as well as commercial cities, and the tiers are drawn by population alone, so their medians need not rise in order.
                  </p>
                )}
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
              title={<>Rescaling and <span className="italic font-light">weighting.</span></>}
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
                  Each measure is rescaled from 0 to 1.
                </h3>
                <div className="h-px bg-[#1c1c19]/30 w-12 mb-4" />
                <p className="font-body text-sm text-[#1c1c19]/75 leading-relaxed">
                  Each measure is rescaled to run from 0 to 1 across all {totalDistricts} districts by the min-max method, one of the normalisation methods the OECD Handbook on Constructing Composite Indicators describes. Measures recorded in different units can then be added in proportion.
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
                  The measures are added with weights.
                </h3>
                <div className="border border-[#1c1c19] bg-[#fcf9f4] p-6 my-5">
                  <p className="font-headline italic text-base md:text-lg text-center text-[#BD402C]">
                    Score = (0.40 × N̂ + 0.40 × Ĝ + 0.20 × Û) × 100
                  </p>
                </div>
                <p className="font-body text-sm text-[#1c1c19]/75 leading-relaxed">
                  Here N̂ is poverty, Ĝ the funding gap and Û persistence, each after rescaling. The result is a score from 0 to 100, and you can change all three weights in the interactive simulator.
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
              title={<>Two equal weights <span className="italic font-light">and a smaller third.</span></>}
            />
            <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#fcf9f4] space-y-5 mb-8">
              <p className="font-body text-base text-[#1c1c19]/85 leading-relaxed">
                Need and the funding gap carry equal weight, 40% each, because both are necessary conditions for a whitespace district: a district counts as a genuine opportunity only when it is both poor and underfunded. A poor district that already receives enough CSR falls outside that definition, and a well-funded district with little poverty is a low priority.
              </p>
              <p className="font-body text-base text-[#1c1c19]/85 leading-relaxed">
                Persistence carries a lower weight, 20%, because the retention ratio rests on only two surveys, NFHS-4 and NFHS-5, taken five years apart. At district level its sampling variance is higher than that of the headcount ratio, which makes it the least precise of the three measures. The 20% is this index&apos;s own judgement, and the presets below show how the ranking moves when the weights change.
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
              title={<>How the <span className="italic font-light">scores are spread.</span></>}
            />
            <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#f6f3ee]">
              <div className="flex items-center justify-between mb-6">
                <p className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] font-bold">
                  Figure 03 · Distribution of scores
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
                Across all sectors at the default weights, scores run from {posMin} to {posMax}. With one sector selected, Ĝ reaches 1.0 wherever that sector received no funding, and scores can reach about {sectorPosMax}.
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
              title={<>Defining <span className="italic font-light">a whitespace district.</span></>}
            />
            <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#fcf9f4]">
              <p className="font-body text-base md:text-lg text-[#1c1c19]/85 leading-relaxed">
                A district is classed as a{" "}
                <span className="text-[#BD402C] font-bold">whitespace district</span>{" "}
                when it is in the bottom quarter of districts for CSR per person (₹{csrP25.toFixed(2)} per person or less) and in the top quarter for the MPI headcount ratio ({hrP75.toFixed(2)}% or more). These are the districts where need is greatest and funding smallest. The current data identifies{" "}
                <span className="text-[#BD402C] font-bold">{wsCount}</span>{" "}
                of them{wsPlaces}.
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
              title={<>The methods <span className="italic font-light">this follows.</span></>}
            />
            <div className="border border-[#1c1c19] p-8 md:p-10 bg-[#f6f3ee]">
              <p className="font-body text-base md:text-lg text-[#1c1c19]/85 leading-relaxed">
                The scoring method follows the{" "}
                <a href="https://www.oecd.org/en/publications/handbook-on-constructing-composite-indicators-methodology-and-user-guide_9789264043466-en.html" target="_blank" rel="noopener noreferrer" className="text-[#BD402C] underline decoration-[#BD402C]/40 hover:decoration-[#BD402C]">
                  OECD Handbook on Constructing Composite Indicators (Nardo et al., 2008)
                </a>
                , a widely used guide to building composite indexes. It sets out the steps this index takes, choosing the measures, rescaling them, weighting them and adding them, and it describes min-max rescaling and weighted addition among the methods for those steps, along with their weakness: a high value on one measure can make up for a low value on another.
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
            />
            <div className="border border-[#1c1c19]">
              {[
                "The score is a screening tool for deciding where to look, and it makes no claim about cause and effect. A high score shows where the gap between need and funding is widest; whether spending there will have an impact is a separate question.",
                `District CSR totals are conservative. About ${totals.pan_india_pct.toFixed(1)}% of gross CSR spending is recorded as Pan India or names no district, and cannot be assigned to a district. Where that money goes is not recorded, so a rural district that benefits from a national programme without being credited with it looks more underfunded than it is.`,
                `In ${m0.csr_not_recorded_count} districts the filings place no CSR spending at all between FY2021-22 and FY2023-24, so their recorded spending is ₹0. Money may still reach them through programmes filed under a neighbouring district or as Pan India.`,
                `Population figures come from Census 2011, eight years before the MPI survey began. A district carved out of another after 2011 takes the 2011 population of the area it now covers, so its figure is as old as every other district's, and a district that has grown fast since 2011 has a lower population on record than it has today, which raises its CSR per person.`,
                "The MPI figures describe conditions in 2019-21 (NFHS-5), and district poverty may have changed since the survey was taken.",
                `The persistence measure (U) uses the median retention ratio (${retMedian.toFixed(3)}; interquartile range ${retP25.toFixed(3)}–${retP75.toFixed(3)}; standard deviation ${retStd.toFixed(3)}) for the ${uImputedCount} of ${totalDistricts} districts with no 2015-16 figure. Most of them were carved out of older districts after Census 2011 and so are missing from NFHS-4, and their U values are therefore estimates.`,
                "The score leaves out government spending, private giving outside the Companies Act and international aid that reach these districts.",
                "The three measures are treated as independent. In practice poverty, the funding gap and persistence may be correlated, which would strengthen the signal for districts that score high on more than one.",
              ].map((text, i, all) => (
                <div
                  key={i}
                  className={`grid grid-cols-1 md:grid-cols-12 gap-6 p-6 md:p-8 ${
                    i % 2 === 1 ? "bg-[#f6f3ee]" : "bg-[#fcf9f4]"
                  } ${i < all.length - 1 ? "border-b border-[#1c1c19]" : ""}`}
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
