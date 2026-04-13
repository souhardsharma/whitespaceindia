"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { District } from "@/lib/score";

// National MPI headcount ratio (NFHS-5)
const NATIONAL_MPI_HEADCOUNT = 0.1496;

interface Props {
  district: (District & { computed_pos: number }) | null;
  onClose: () => void;
}

function MiniBarChart({
  data,
  unit,
  label,
}: {
  data: { name: string; value: number; color: string }[];
  unit: string;
  label: string;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
      <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider font-semibold mb-3">
        {label}
      </p>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -10 }}
          barCategoryGap="30%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: "#94A3B8" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: "#64748B" }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "#0D1B2E",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              fontSize: 12,
              color: "#fff",
            }}
            itemStyle={{ color: "#fff" }}
            labelStyle={{ color: "#94A3B8", fontWeight: 600, paddingBottom: 4 }}
            formatter={(value) => [`${Number(value).toLocaleString("en-IN")}${unit}`, ""]}
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={42}>
            {data.map((entry, idx) => (
              <Cell key={idx} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendChart({
  baseline,
  current,
  districtName,
}: {
  baseline: number | null;
  current: number;
  districtName: string;
}) {
  if (!baseline) return null;
  const data = [
    { period: "2015-16", value: +(baseline * 100).toFixed(1) },
    { period: "2019-21", value: +(current * 100).toFixed(1) },
  ];
  const improved = current < baseline;
  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
      <p className="text-[10px] text-[#94A3B8] uppercase tracking-wider font-semibold mb-1">
        Poverty Trend
      </p>
      <p className="text-[10px] text-[#64748B] mb-3">
        {districtName} MPI headcount ratio
      </p>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 10, fill: "#94A3B8" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: "#64748B" }}
            axisLine={false}
            tickLine={false}
            width={36}
            domain={[0, "auto"]}
          />
          <Tooltip
            contentStyle={{
              background: "#0D1B2E",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              fontSize: 12,
              color: "#fff",
            }}
            itemStyle={{ color: "#fff" }}
            labelStyle={{ color: "#94A3B8", fontWeight: 600, paddingBottom: 4 }}
            formatter={(value) => [`${value}%`, "Headcount"]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={improved ? "#22C55E" : "#EF4444"}
            strokeWidth={2.5}
            dot={{ r: 5, fill: improved ? "#22C55E" : "#EF4444", strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Loading progress messages ──────────────────────────────────────────
const PROGRESS_MESSAGES = [
  "Analysing district data",
  "Preparing poverty profile",
  "Evaluating CSR funding gaps",
  "Generating research brief",
  "Building PDF report",
  "Finalizing download",
];

export default function BriefModal({ district, onClose }: Props) {
  const [briefText, setBriefText] = useState("");
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [progressIdx, setProgressIdx] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const briefRef = useRef<HTMLDivElement>(null);

  // Close on ESC
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Cooldown timer after generation
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Cycle progress messages during loading
  useEffect(() => {
    if (!loading) { setProgressIdx(0); return; }
    const timer = setInterval(() => {
      setProgressIdx((prev) => (prev + 1) % PROGRESS_MESSAGES.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [loading]);

  // Reset state when district changes
  useEffect(() => {
    setBriefText("");
    setLoading(false);
    setGenerated(false);
    setCooldown(0);
    setErrorMsg("");
  }, [district?.district_lgd_code]);

  // Download PDF helper
  const downloadPdf = useCallback(async (text: string) => {
    if (!district || !text) return;
    try {
      const res = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          districtName: district.district_name,
          stateName: district.state_name,
          briefText: text,
          mpiData: {
            headcount_ratio_2021: district.headcount_ratio_2021,
            headcount_ratio_2016: district.headcount_ratio_2016 ?? district.headcount_ratio_2021,
            mpi_2021: district.mpi_2021,
          },
          csrData: {
            total_csr_recent: district.total_csr_recent,
            csr_per_person: district.district_csr_per_person,
            national_average: district.tier_median_csr,
          },
          pos: district.computed_pos,
        }),
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${district.district_name.replace(/\s+/g, "-")}_brief.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback to text download
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${district.district_name.replace(/\s+/g, "-")}_brief.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [district]);

  // Generate brief AND auto-download PDF
  const generateBrief = useCallback(async () => {
    if (!district) return;
    setLoading(true);
    setBriefText("");
    setErrorMsg("");

    try {
      const res = await fetch("/api/generate-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          district_name: district.district_name,
          state_name: district.state_name,
          headcount_ratio_2021: district.headcount_ratio_2021,
          headcount_ratio_2016: district.headcount_ratio_2016,
          district_csr_per_person: district.district_csr_per_person,
          total_csr_recent: district.total_csr_recent,
          total_population: district.total_population,
          mpi_2021: district.mpi_2021,
          computed_pos: district.computed_pos,
          is_whitespace: district.is_whitespace,
          pop_tier: district.pop_tier,
          tier_median_csr: district.tier_median_csr,
        }),
      });

      if (!res.ok) {
        throw new Error("generation_failed");
      }

      let text = "";
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setBriefText(text);
        }
      } else {
        text = await res.text();
        setBriefText(text);
      }

      setGenerated(true);
      setCooldown(30);

      // Auto-download PDF immediately after brief generation
      await downloadPdf(text);
    } catch {
      setErrorMsg("Please try after some time.");
      setCooldown(15);
    } finally {
      setLoading(false);
    }
  }, [district, downloadPdf]);

  const formatCurrency = (val: number) =>
    "\u20B9" + Math.round(val).toLocaleString("en-IN");

  return (
    <AnimatePresence>
      {district && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3 }}
            className="relative max-w-3xl w-full max-h-[90vh] overflow-y-auto bg-[#0D1B2E] backdrop-blur-md border border-white/10 rounded-2xl p-6 md:p-8"
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-[#94A3B8] hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>

            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="mb-6"
            >
              <p className="text-[#F5A623] text-xs font-semibold tracking-widest uppercase mb-2">
                Research Brief
              </p>
              <h2 className="font-display text-2xl md:text-3xl text-white mb-1">
                {district.district_name}
              </h2>
              <p className="text-[#94A3B8] mb-4">{district.state_name}</p>
              <div className="flex flex-wrap gap-2">
                <motion.span
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.2 }}
                  className="bg-[#F5A623] text-[#0B1526] font-bold text-sm px-4 py-1.5 rounded-full"
                >
                  Score: {district.computed_pos.toFixed(1)}/100
                </motion.span>
                {district.is_whitespace && (
                  <motion.span
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.3 }}
                    className="bg-red-500/20 text-red-400 border border-red-500/30 font-semibold text-sm px-4 py-1.5 rounded-full"
                  >
                    Neglected District
                  </motion.span>
                )}
              </div>
            </motion.div>

            {/* Metrics */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="grid grid-cols-3 gap-3 mb-6"
            >
              {[
                { value: (district.headcount_ratio_2021 * 100).toFixed(1) + "%", label: "MPI Poverty Rate" },
                { value: formatCurrency(district.district_csr_per_person), label: "CSR Per Person" },
                { value: formatCurrency(district.tier_median_csr), label: "Tier Median", isAccent: true },
              ].map((metric, i) => (
                <motion.div
                  key={metric.label}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.25 + i * 0.08 }}
                  className="bg-white/5 rounded-xl p-4 text-center hover:bg-white/[0.07] transition-colors duration-300"
                >
                  <div className={`text-xl font-bold ${metric.isAccent ? "text-[#F5A623]" : "text-white"}`}>
                    {metric.value}
                  </div>
                  <div className="text-xs text-[#94A3B8] mt-1">{metric.label}</div>
                </motion.div>
              ))}
            </motion.div>

            {/* Comparison Charts */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6"
            >
              <MiniBarChart
                label="MPI Poverty Rate (%)"
                unit="%"
                data={[
                  {
                    name: district.district_name.length > 10
                      ? district.district_name.slice(0, 10) + "."
                      : district.district_name,
                    value: +(district.headcount_ratio_2021 * 100).toFixed(1),
                    color: "#EF4444",
                  },
                  {
                    name: "National",
                    value: +(NATIONAL_MPI_HEADCOUNT * 100).toFixed(1),
                    color: "#64748B",
                  },
                ]}
              />
              <MiniBarChart
                label="CSR Per Person (INR)"
                unit=""
                data={[
                  {
                    name: district.district_name.length > 10
                      ? district.district_name.slice(0, 10) + "."
                      : district.district_name,
                    value: Math.round(district.district_csr_per_person),
                    color:
                      district.district_csr_per_person < district.tier_median_csr
                        ? "#EF4444"
                        : "#22C55E",
                  },
                  {
                    name: "Tier Med.",
                    value: Math.round(district.tier_median_csr),
                    color: "#F5A623",
                  },
                ]}
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.35 }}
              className="mb-6"
            >
              <TrendChart
                baseline={district.headcount_ratio_2016}
                current={district.headcount_ratio_2021}
                districtName={district.district_name}
              />
            </motion.div>

            {/* Brief generation */}
            {!generated && !loading && !errorMsg && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.4 }}
              >
                <p className="text-[11px] text-[#94A3B8]/80 mb-3 leading-relaxed">
                  Briefs are AI-generated using this district&apos;s actual data from NITI Aayog (MPI 2023), Ministry of Corporate Affairs (CSR data), and Census of India 2011. The narrative is machine-generated and should be independently verified. Clicking the button below will generate the brief and automatically download it as a PDF.
                </p>
                <button
                  onClick={generateBrief}
                  disabled={cooldown > 0}
                  className={`group relative w-full font-semibold py-3.5 rounded-xl transition-all duration-300 overflow-hidden ${
                    cooldown > 0
                      ? "bg-[#F5A623]/30 text-[#0B1526]/50 cursor-not-allowed"
                      : "bg-[#F5A623] text-[#0B1526] hover:shadow-[0_0_30px_rgba(245,166,35,0.4)] hover:scale-[1.02]"
                  }`}
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    {cooldown > 0
                      ? `Please wait ${cooldown}s`
                      : "Generate & Download Brief"}
                  </span>
                  {cooldown <= 0 && (
                    <div className="absolute inset-0 bg-gradient-to-r from-[#FBBF24] to-[#F97316] opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  )}
                </button>
              </motion.div>
            )}

            {/* Loading state with animated progress */}
            {loading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-10"
              >
                {/* Animated loader */}
                <div className="relative w-16 h-16 mx-auto mb-5">
                  <motion.div
                    className="absolute inset-0 border-2 border-[#F5A623]/20 rounded-full"
                    animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <motion.div
                    className="absolute inset-1 border-2 border-[#F5A623] border-t-transparent rounded-full"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                  />
                  <motion.div
                    className="absolute inset-3 border-2 border-[#7C3AED]/50 border-b-transparent rounded-full"
                    animate={{ rotate: -360 }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                  />
                </div>

                {/* Animated progress text */}
                <AnimatePresence mode="wait">
                  <motion.p
                    key={progressIdx}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3 }}
                    className="text-[#94A3B8] text-sm"
                  >
                    {PROGRESS_MESSAGES[progressIdx]}
                    <motion.span
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      ...
                    </motion.span>
                  </motion.p>
                </AnimatePresence>

                {/* Progress bar */}
                <div className="mt-4 mx-auto max-w-xs h-1 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-[#F5A623] to-[#7C3AED] rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 25, ease: "linear" }}
                  />
                </div>
              </motion.div>
            )}

            {/* Error message */}
            {errorMsg && !loading && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-8"
              >
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-500/10 mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                </div>
                <p className="text-[#94A3B8] text-base mb-4">{errorMsg}</p>
                <button
                  onClick={() => { setErrorMsg(""); generateBrief(); }}
                  disabled={cooldown > 0}
                  className={`font-semibold py-2.5 px-8 rounded-xl transition-all duration-300 ${
                    cooldown > 0
                      ? "bg-white/10 text-[#64748B] cursor-not-allowed"
                      : "bg-[#F5A623] text-[#0B1526] hover:bg-[#FBBF24]"
                  }`}
                >
                  {cooldown > 0 ? `Retry in ${cooldown}s` : "Retry"}
                </button>
              </motion.div>
            )}

            {/* Brief text display */}
            {briefText && (
              <motion.div
                ref={briefRef}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="mt-6"
              >
                {/* Brief content */}
                <div className="space-y-5">
                  {briefText.split(/\n\n+/).filter(Boolean).map((para, i) => {
                    const trimmed = para.trim();
                    // Detect **Section Heading** lines
                    const headingMatch = trimmed.match(/^\*\*(.+?)\*\*\s*$/);
                    if (headingMatch) {
                      return (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.4, delay: i * 0.05 }}
                          className="pt-2"
                        >
                          <div className="flex items-center gap-3 mb-1">
                            <div className="w-1 h-5 rounded-full bg-[#F5A623]" />
                            <h4 className="font-display text-white font-semibold text-base tracking-wide">
                              {headingMatch[1]}
                            </h4>
                          </div>
                        </motion.div>
                      );
                    }
                    // Inline bold: replace **text** with <strong>
                    const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
                    return (
                      <motion.p
                        key={i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: i * 0.05 }}
                        className="text-[#C8D3E0] text-sm leading-[1.9] font-light"
                      >
                        {parts.map((part, j) => {
                          const m = part.match(/^\*\*(.+)\*\*$/);
                          return m ? <strong key={j} className="text-white font-medium">{m[1]}</strong> : part;
                        })}
                      </motion.p>
                    );
                  })}
                </div>

                {/* Brief footer with sources */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.3 }}
                  className="mt-8 pt-6 border-t border-white/10 space-y-2 text-xs text-[#64748B]"
                >
                  <p className="font-semibold text-[#94A3B8] text-xs uppercase tracking-wider mb-3">Sources</p>
                  <p>
                    Poverty data:{" "}
                    <a href="https://www.niti.gov.in/sites/default/files/2023-08/India-National-Multidimentional-Poverty-Index-2023.pdf" target="_blank" rel="noopener noreferrer" className="text-[#F5A623] hover:underline">
                      NITI Aayog National MPI 2023 (NFHS-5, 2019-21)
                    </a>
                  </p>
                  <p>
                    CSR data:{" "}
                    <a href="https://dataful.in/datasets/1612" target="_blank" rel="noopener noreferrer" className="text-[#F5A623] hover:underline">
                      Ministry of Corporate Affairs, via Dataful.in (Dataset ID: 1612)
                    </a>
                  </p>
                  <p>
                    Population:{" "}
                    <a href="https://censusindia.gov.in" target="_blank" rel="noopener noreferrer" className="text-[#F5A623] hover:underline">
                      Census of India 2011
                    </a>
                  </p>
                  <p>
                    Scoring methodology:{" "}
                    <a href="https://www.oecd.org/en/publications/handbook-on-constructing-composite-indicators-methodology-and-user-guide_9789264043466-en.html" target="_blank" rel="noopener noreferrer" className="text-[#F5A623] hover:underline">
                      OECD Handbook on Constructing Composite Indicators (Nardo et al., 2008)
                    </a>
                  </p>
                  <p className="pt-2 text-[#94A3B8]/80 italic">
                    Brief text is generated using the Google Gemini API. All underlying data comes from the three public sources listed above and the Whitespace India scoring methodology.
                  </p>
                  <p className="pt-2">
                    Contact:{" "}
                    <a href="https://www.linkedin.com/in/souhardsharma/" target="_blank" rel="noopener noreferrer" className="text-[#F5A623] hover:underline">
                      linkedin.com/in/souhardsharma
                    </a>
                  </p>
                </motion.div>

                {/* Download PDF again button */}
                {generated && (
                  <motion.button
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4 }}
                    onClick={() => downloadPdf(briefText)}
                    className="mt-6 w-full border border-[#F5A623]/40 text-[#F5A623] font-semibold py-3 rounded-xl hover:bg-[#F5A623]/10 transition-all duration-300 hover:border-[#F5A623]/60 flex items-center justify-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download PDF Again
                  </motion.button>
                )}
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
