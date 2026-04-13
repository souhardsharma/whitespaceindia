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
  pos_range?: { min: number; max: number };
  pop_tier_boundaries?: { p33: number; p67: number };
  national_mean_csr?: number;
  median_retention_ratio?: number;
}

const WEIGHT_PRESETS = [
  { name: "Balanced", N: 40, G: 40, U: 20, desc: "Equal emphasis on need and gap" },
  { name: "Highest Need", N: 60, G: 25, U: 15, desc: "Prioritize poverty severity" },
  { name: "Most Underfunded", N: 25, G: 60, U: 15, desc: "Prioritize funding gap" },
  { name: "Stuck Districts", N: 25, G: 25, U: 50, desc: "Prioritize persistent poverty" },
];

const CHART_TOOLTIP_STYLE = {
  background: "#0D1B2E",
  border: "1px solid rgba(245,166,35,0.3)",
  borderRadius: 8,
  fontSize: 12,
  color: "#FFFFFF",
  padding: "8px 12px",
};

function formatLakh(n: number): string {
  const lakh = n / 100000;
  return lakh >= 10 ? `${lakh.toFixed(1)} lakh` : `${lakh.toFixed(2)} lakh`;
}

export default function MethodologyPage() {
  const [posDistribution, setPosDistribution] = useState<{ range: string; count: number }[]>([]);
  const [meta, setMeta] = useState<MetaData | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/data/whitespace_master.json").then((r) => r.json()),
      fetch("/data/meta.json").then((r) => r.json()),
    ]).then(([districts, metaData]: [{ POS: number }[], MetaData]) => {
      // Build POS distribution
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

  // Build tier chart data from meta.json
  const tierData = meta ? [
    { name: "Tier 1 (Small)", median: meta.tier_medians["Tier 1 (Small)"] ?? 0, color: "#3B82F6" },
    { name: "Tier 2 (Medium)", median: meta.tier_medians["Tier 2 (Medium)"] ?? 0, color: "#8B5CF6" },
    { name: "Tier 3 (Large)", median: meta.tier_medians["Tier 3 (Large)"] ?? 0, color: "#F5A623" },
  ] : [];

  const totalDistricts = meta?.total_districts ?? 583;
  const posMin = meta?.pos_range?.min ?? 0;
  const posMax = meta?.pos_range?.max ?? 100;
  const csrP25 = meta?.whitespace_thresholds?.csr_p25 ?? 40;
  const hrP75 = meta?.whitespace_thresholds?.hr_p75_pct ?? 21.5;
  const wsCount = meta?.whitespace_count ?? 49;
  const popP33 = meta?.pop_tier_boundaries?.p33 ?? 1066888;
  const popP67 = meta?.pop_tier_boundaries?.p67 ?? 2090922;
  const meanCsr = meta?.national_mean_csr ?? 678;
  const medianCsr = meta?.national_median_csr_per_person ?? 127;

  return (
    <main className="bg-[#0B1526] min-h-screen">
      <Navbar />

      {/* Page header */}
      <section className="relative pt-32 pb-20 px-4 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/methodology-bg.png')", opacity: 0.15 }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0B1526]/60 to-[#0B1526]" />
        <div className="relative max-w-4xl mx-auto">
          <h1 className="font-display text-5xl md:text-6xl text-white mb-6 leading-tight">
            Methodology
          </h1>
          <p className="text-[#94A3B8] text-lg max-w-2xl leading-relaxed">
            How we measure the gap between poverty and philanthropic funding across {totalDistricts} Indian districts, using three government datasets and a composite scoring framework.
          </p>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 py-16 space-y-20">

        {/* Objective */}
        <FadeIn>
          <section>
            <h2 className="font-display text-3xl text-white mb-6">Objective</h2>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <p className="text-[#C8D3E0] leading-relaxed">
                The Philanthropic Opportunity Score (POS) quantifies where in India the gap between poverty and corporate social responsibility funding is widest. It is designed as a screening tool for foundation program officers, CSR heads, and philanthropic advisors who need district-level evidence to guide geographic strategy. The score does not prescribe investment decisions - it surfaces the districts where further due diligence is most warranted.
              </p>
            </div>
          </section>
        </FadeIn>

        {/* Data Pipeline Overview */}
        <FadeIn>
          <section>
            <h2 className="font-display text-3xl text-white mb-8">Data Pipeline</h2>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {[
                { step: "1", label: "Extract", detail: "Parse PDF, Excel, and CSV sources", color: "#3B82F6" },
                { step: "2", label: "Clean", detail: "Exclude unattributable records", color: "#8B5CF6" },
                { step: "3", label: "Match", detail: "Reconcile names across datasets", color: "#EC4899" },
                { step: "4", label: "Tier", detail: "Group by population tertiles", color: "#F59E0B" },
                { step: "5", label: "Normalize", detail: "Min-max scale to 0-1", color: "#10B981" },
                { step: "6", label: "Score", detail: "Weighted aggregation", color: "#F5A623" },
              ].map((s, i) => (
                <div key={s.step} className="relative">
                  <div
                    className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 text-center h-full"
                    style={{ borderColor: `${s.color}30` }}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mx-auto mb-2"
                      style={{ background: `${s.color}20`, color: s.color }}
                    >
                      {s.step}
                    </div>
                    <p className="text-white text-sm font-semibold mb-1">{s.label}</p>
                    <p className="text-[#64748B] text-[10px] leading-tight">{s.detail}</p>
                  </div>
                  {i < 5 && (
                    <div className="hidden md:block absolute top-1/2 -right-2 text-[#475569] text-xs">&#8594;</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Data Sources */}
        <FadeIn>
          <section>
            <h2 className="font-display text-3xl text-white mb-8">Data Sources</h2>
            <div className="space-y-5">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-[#F5A623]/30 transition-colors">
                <div className="flex items-start gap-4">
                  <span className="shrink-0 text-[#F5A623] font-semibold text-xs uppercase tracking-widest pt-1 w-20">Poverty</span>
                  <p className="text-[#C8D3E0] leading-relaxed">
                    NITI Aayog{" "}
                    <a href="https://niti.gov.in/sites/default/files/2023-07/Final-MPI_7thJuly.pdf" target="_blank" rel="noopener noreferrer" className="text-[#F5A623] hover:underline">
                      National Multidimensional Poverty Index 2023
                    </a>
                    , based on the National Family Health Survey 5 (2019-21). This report uses the Alkire-Foster methodology from Oxford&apos;s OPHI to measure multidimensional poverty across health, education, and standard of living. District-level headcount ratios were extracted for both the 2015-16 and 2019-21 survey rounds, covering 656 districts across 36 states and union territories.
                  </p>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-[#F5A623]/30 transition-colors">
                <div className="flex items-start gap-4">
                  <span className="shrink-0 text-[#F5A623] font-semibold text-xs uppercase tracking-widest pt-1 w-20">CSR</span>
                  <p className="text-[#C8D3E0] leading-relaxed">
                    Ministry of Corporate Affairs{" "}
                    <a href="https://www.csr.gov.in/" target="_blank" rel="noopener noreferrer" className="text-[#F5A623] hover:underline">
                      National CSR Portal
                    </a>
                    , via{" "}
                    <a href="https://dataful.in/datasets/1612" target="_blank" rel="noopener noreferrer" className="text-[#F5A623] hover:underline">
                      Dataful.in (Dataset 1612)
                    </a>
                    . Ten fiscal years of CSR expenditure data (FY2014-15 through FY2023-24) at the district-sector level. The most recent three years (FY2021-24) feed the supply gap calculation. Approximately 34% of total CSR spending is classified as &quot;Pan India&quot; and cannot be attributed to specific districts - these records are excluded entirely, which means district-level CSR totals are conservative.
                  </p>
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-[#F5A623]/30 transition-colors">
                <div className="flex items-start gap-4">
                  <span className="shrink-0 text-[#F5A623] font-semibold text-xs uppercase tracking-widest pt-1 w-20">Census</span>
                  <p className="text-[#C8D3E0] leading-relaxed">
                    <a href="https://censusindia.gov.in/" target="_blank" rel="noopener noreferrer" className="text-[#F5A623] hover:underline">
                      Census of India 2011
                    </a>{" "}
                    district-level population data covering 640 districts. This remains the most recent complete district census - the 2021 Census was postponed. Population figures serve as denominators for per capita calculations and as the basis for population-tier classification. Districts created after 2011 (through administrative reorganization) were matched to their parent district populations where possible.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </FadeIn>

        {/* Data Integration */}
        <FadeIn>
          <section>
            <h2 className="font-display text-3xl text-white mb-6">Data Integration</h2>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
              <p className="text-[#C8D3E0] leading-relaxed">
                Matching districts across three independently maintained datasets presented a significant reconciliation challenge. District names are spelled inconsistently across sources - for example, &quot;Hooghly&quot; in the Census, &quot;Hugli (Hooghly)&quot; in the MPI, and &quot;Hugli&quot; in CSR records. Approximate string matching within each state was used to join records, with a minimum similarity threshold of 75%.
              </p>
              <p className="text-[#C8D3E0] leading-relaxed">
                State boundary changes required additional handling. Telangana (created 2014) and Ladakh (created 2019) did not exist in Census 2011, so districts in these states were mapped back to their parent states (Andhra Pradesh and Jammu & Kashmir respectively) for population matching. Of the 656 MPI districts, {totalDistricts} were successfully matched to both a Census population and CSR spending record. The remaining 70 - predominantly in Telangana, newer Uttar Pradesh districts, and smaller northeastern states - were excluded due to missing population denominators.
              </p>
            </div>
          </section>
        </FadeIn>

        {/* Three Components */}
        <FadeIn>
          <section>
            <h2 className="font-display text-3xl text-white mb-8">Three Scoring Dimensions</h2>
            <div className="grid gap-5 md:grid-cols-3">
              {[
                {
                  key: "N",
                  title: "Poverty Severity",
                  color: "#F5A623",
                  text: "The MPI headcount ratio from NFHS-5 - the share of a district's population that is multidimensionally poor across health, education, and standard of living indicators. Higher values indicate greater unmet need.",
                  weight: "40%",
                },
                {
                  key: "G",
                  title: "Funding Gap",
                  color: "#7C3AED",
                  text: "How much less CSR per person a district receives compared to its population-tier median. A district receiving more than its tier median scores zero on this dimension - it is not underfunded relative to comparable peers.",
                  weight: "40%",
                },
                {
                  key: "U",
                  title: "Persistent Poverty",
                  color: "#10B981",
                  text: "The retention ratio: what fraction of 2015-16 poverty persists in 2019-21. Values near one indicate no improvement. Values above one indicate poverty worsened. Districts without baseline data receive the median retention ratio.",
                  weight: "20%",
                },
              ].map((comp) => (
                <div
                  key={comp.key}
                  className="relative bg-white/5 border border-white/10 rounded-2xl p-6 overflow-hidden"
                  style={{ borderColor: `${comp.color}20` }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-mono font-bold text-sm px-3 py-1 rounded-full" style={{ background: `${comp.color}20`, color: comp.color }}>
                      {comp.key}
                    </span>
                    <span className="font-display text-sm font-bold" style={{ color: comp.color }}>
                      {comp.weight}
                    </span>
                  </div>
                  <h3 className="font-display text-lg text-white mb-2">{comp.title}</h3>
                  <p className="text-[#94A3B8] text-sm leading-relaxed">{comp.text}</p>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Population-Tier Stratification */}
        <FadeIn>
          <section>
            <h2 className="font-display text-3xl text-white mb-6">Population-Tier Stratification</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <p className="text-[#C8D3E0] leading-relaxed">
                  CSR spending across Indian districts is heavily right-skewed. The mean CSR density is roughly {Math.round(meanCsr)} rupees per person while the median is {Math.round(medianCsr)} - a ratio that reflects a long right tail driven by corporate headquarters districts like Mumbai, Bengaluru, and Pune.
                </p>
                <p className="text-[#C8D3E0] leading-relaxed">
                  A single national median benchmark would flag nearly every rural district as underfunded, confirming what is already known without adding discriminating signal. Instead, districts are split into three population tiers at the 33rd and 67th percentile boundaries. Each tier receives its own median CSR density as the benchmark, ensuring a small tribal district is compared to other small districts rather than metropolitan centers.
                </p>
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-[#3B82F6]" />
                    <span className="text-white text-sm">Tier 1 (Small): population up to {formatLakh(popP33)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-[#8B5CF6]" />
                    <span className="text-white text-sm">Tier 2 (Medium): {formatLakh(popP33)} to {formatLakh(popP67)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-[#F5A623]" />
                    <span className="text-white text-sm">Tier 3 (Large): above {formatLakh(popP67)}</span>
                  </div>
                </div>
              </div>
              <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
                <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider font-semibold mb-3">
                  Tier Median CSR Per Person (INR)
                </p>
                {tierData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={tierData} margin={{ top: 8, right: 8, bottom: 4, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10, fill: "#94A3B8" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 9, fill: "#94A3B8" }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                      />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        labelStyle={{ color: "#FFFFFF", fontWeight: 600 }}
                        itemStyle={{ color: "#FFFFFF" }}
                        formatter={(value) => [`INR ${value}`, "Tier Median"]}
                      />
                      <Bar dataKey="median" radius={[6, 6, 0, 0]} maxBarSize={50}>
                        {tierData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-[#94A3B8] text-sm">Loading data...</div>
                )}
                <p className="text-[10px] text-[#94A3B8] mt-2 text-center">
                  Each district&apos;s funding gap is measured against its own tier median
                </p>
              </div>
            </div>
          </section>
        </FadeIn>

        {/* Normalization & Aggregation */}
        <FadeIn>
          <section>
            <h2 className="font-display text-3xl text-white mb-8">Normalization & Aggregation</h2>
            <div className="space-y-6">
              <div className="flex gap-5">
                <span className="shrink-0 w-9 h-9 rounded-full text-sm font-bold flex items-center justify-center" style={{ background: "rgba(245,166,35,0.15)", color: "#F5A623" }}>1</span>
                <div className="flex-1">
                  <p className="text-white font-medium mb-2">Min-max normalize each component</p>
                  <p className="text-[#C8D3E0] leading-relaxed">
                    Each raw component is scaled to a 0-1 range across all {totalDistricts} districts. This approach, recommended by the OECD Handbook on Constructing Composite Indicators, ensures components with different units and magnitudes contribute proportionally to the final score.
                  </p>
                </div>
              </div>
              <div className="flex gap-5">
                <span className="shrink-0 w-9 h-9 rounded-full text-sm font-bold flex items-center justify-center" style={{ background: "rgba(245,166,35,0.15)", color: "#F5A623" }}>2</span>
                <div className="flex-1">
                  <p className="text-white font-medium mb-2">Weighted linear aggregation</p>
                  <div className="bg-[#060E1A] border border-[#F5A623]/25 rounded-xl p-6">
                    <p className="font-mono text-[#F5A623] text-lg text-center tracking-wide">
                      POS = (0.40 &times; N&#x0302; + 0.40 &times; G&#x0302; + 0.20 &times; U&#x0302;) &times; 100
                    </p>
                  </div>
                  <p className="text-[#64748B] text-sm mt-3">
                    Where N&#x0302; is normalized poverty severity, G&#x0302; is normalized funding gap, and U&#x0302; is normalized poverty persistence. The result is a score from 0 to 100. Users can adjust all weights through the interactive simulator.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </FadeIn>

        {/* Weight Justification */}
        <FadeIn>
          <section>
            <h2 className="font-display text-3xl text-white mb-6">Weight Justification</h2>
            <div className="space-y-5 mb-6">
              <p className="text-[#C8D3E0] leading-relaxed">
                Need and Gap receive equal weight (40% each) because both are necessary conditions for philanthropic whitespace. A district must be both poor and underfunded to represent a genuine opportunity. A poor district receiving adequate CSR is not a whitespace; a well-funded district with low poverty is not a priority.
              </p>
              <p className="text-[#C8D3E0] leading-relaxed">
                Persistence receives lower weight (20%) because the retention ratio derives from only two time points (NFHS-4 and NFHS-5), spaced five years apart. District-level sampling variance is higher than for the headcount ratio itself, making this the least precise of the three signals. This weighting structure mirrors the approach used by the UNDP Human Development Index, where unequal weights reflect differential measurement reliability.
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {WEIGHT_PRESETS.map((preset) => (
                <div key={preset.name} className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-4">
                  <p className="text-white text-sm font-semibold mb-3">{preset.name}</p>
                  <div className="space-y-2">
                    {[
                      { label: "N", value: preset.N, color: "#F5A623" },
                      { label: "G", value: preset.G, color: "#7C3AED" },
                      { label: "U", value: preset.U, color: "#10B981" },
                    ].map((w) => (
                      <div key={w.label} className="flex items-center gap-2">
                        <span className="text-[10px] font-mono w-3" style={{ color: w.color }}>{w.label}</span>
                        <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${w.value}%`, background: w.color }} />
                        </div>
                        <span className="text-[10px] text-[#94A3B8] w-7 text-right">{w.value}%</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#64748B] mt-2">{preset.desc}</p>
                </div>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* POS Distribution */}
        <FadeIn>
          <section>
            <h2 className="font-display text-3xl text-white mb-6">Score Distribution</h2>
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-5">
              <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider font-semibold mb-4">
                POS Distribution Across {totalDistricts} Districts
              </p>
              {posDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={posDistribution} margin={{ top: 8, right: 8, bottom: 4, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis
                      dataKey="range"
                      tick={{ fontSize: 9, fill: "#94A3B8" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "#94A3B8" }}
                      axisLine={false}
                      tickLine={false}
                      width={35}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      labelStyle={{ color: "#FFFFFF", fontWeight: 600 }}
                      itemStyle={{ color: "#FFFFFF" }}
                      formatter={(value) => [`${value} districts`, "Count"]}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={36}>
                      {posDistribution.map((_, idx) => (
                        <Cell key={idx} fill={idx < 3 ? "#1E3A5F" : idx < 6 ? "#7C3AED" : "#F5A623"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-[#94A3B8] text-sm">Loading distribution data...</div>
              )}
              <p className="text-[10px] text-[#94A3B8] mt-2 text-center">
                Scores range from {posMin} to {posMax} with default weights. Most districts cluster in the 10-40 range.
              </p>
            </div>
          </section>
        </FadeIn>

        {/* Whitespace Classification */}
        <FadeIn>
          <section>
            <h2 className="font-display text-3xl text-white mb-6">Whitespace Classification</h2>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <p className="text-[#C8D3E0] leading-relaxed">
                A district is flagged as{" "}
                <span className="text-[#F5A623] font-medium">neglected</span>{" "}
                when it falls simultaneously in the bottom 25th percentile of CSR per person (below INR {Math.round(csrP25)} per person) and the top 25th percentile of MPI headcount ratio (above {hrP75}% poverty). These are districts where need is highest and funding lowest - the core philanthropic whitespaces. The current dataset identifies {wsCount} such districts, concentrated in Bihar, Uttar Pradesh, Jharkhand, and Meghalaya.
              </p>
            </div>
          </section>
        </FadeIn>

        {/* Methodological Framework */}
        <FadeIn>
          <section>
            <h2 className="font-display text-3xl text-white mb-6">Methodological Framework</h2>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <p className="text-[#C8D3E0] leading-relaxed">
                The composite scoring approach follows the{" "}
                <a href="https://www.oecd.org/en/publications/handbook-on-constructing-composite-indicators-methodology-and-user-guide_9789264043466-en.html" target="_blank" rel="noopener noreferrer" className="text-[#F5A623] hover:underline">
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
            <h2 className="font-display text-3xl text-white mb-8">Limitations</h2>
            <ol className="space-y-3">
              {[
                "This is a screening tool for geographic prioritization, not a causal model. A high score does not guarantee that investment will produce impact - it indicates where the gap between need and funding is widest.",
                "District-level CSR totals are conservative. Approximately one-third of CSR spending is classified as Pan India and cannot be attributed to specific districts.",
                "Population denominators are from Census 2011. Some districts have been reorganized since then, and roughly seventy MPI districts could not be matched to Census populations.",
                "MPI data reflects conditions in 2019-21 (NFHS-5). District-level poverty may have shifted in the years since data collection.",
                "The score does not account for government spending beyond CSR, private philanthropy outside the Companies Act framework, or international development aid flowing to these districts.",
                "The three components are treated as independent dimensions. In practice, poverty severity, funding gaps, and poverty persistence may be correlated, which could amplify the signal for districts that score high on multiple dimensions.",
              ].map((text, i) => (
                <li key={i} className="flex gap-4 bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
                  <span className="shrink-0 font-display text-[#F5A623] font-bold">{i + 1}.</span>
                  <p className="text-[#94A3B8] text-sm leading-relaxed">{text}</p>
                </li>
              ))}
            </ol>
          </section>
        </FadeIn>

      </div>

      <Footer />
    </main>
  );
}
