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

const NATIONAL_MPI_HEADCOUNT = 0.1496;

interface Props {
  district: (District & { computed_pos: number }) | null;
  onClose: () => void;
}

const CHART_TOOLTIP_STYLE = {
  background: "#1c1c19",
  border: "1px solid #1c1c19",
  borderRadius: 0,
  fontSize: 11,
  color: "#fcf9f4",
  padding: "8px 12px",
  fontFamily: "var(--font-space-grotesk)",
};

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
    <div className="border border-[#1c1c19] bg-[#f6f3ee] p-5">
      <p className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19] font-bold mb-4">
        {label}
      </p>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -10 }}
          barCategoryGap="30%"
        >
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
            itemStyle={{ color: "#fcf9f4" }}
            labelStyle={{ color: "#fcf9f4", fontWeight: 600, paddingBottom: 4 }}
            formatter={(value) => [`${Number(value).toLocaleString("en-IN")}${unit}`, ""]}
            cursor={{ fill: "rgba(28,28,25,0.05)" }}
          />
          <Bar dataKey="value" radius={[0, 0, 0, 0]} maxBarSize={46}>
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
    <div className="border border-[#1c1c19] bg-[#f6f3ee] p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19] font-bold">
          Poverty Trend
        </p>
        <span className="font-label text-[9px] uppercase tracking-widest text-[#BD402C]">
          {improved ? "Improving" : "Worsening"}
        </span>
      </div>
      <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mb-4">
        {districtName} · MPI Headcount
      </p>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="0" stroke="rgba(28,28,25,0.08)" />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 10, fill: "#1c1c19", fontFamily: "var(--font-space-grotesk)" }}
            axisLine={{ stroke: "#1c1c19" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: "#1c1c19", fontFamily: "var(--font-space-grotesk)" }}
            axisLine={false}
            tickLine={false}
            width={36}
            domain={[0, "auto"]}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            itemStyle={{ color: "#fcf9f4" }}
            labelStyle={{ color: "#fcf9f4", fontWeight: 600, paddingBottom: 4 }}
            formatter={(value) => [`${value}%`, "Headcount"]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={improved ? "#1c1c19" : "#BD402C"}
            strokeWidth={2}
            dot={{ r: 4, fill: improved ? "#1c1c19" : "#BD402C", strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const PROGRESS_MESSAGES = [
  "Analysing district data",
  "Preparing poverty profile",
  "Evaluating CSR funding gaps",
  "Generating research brief",
  "Building PDF report",
  "Finalizing download",
];

export default function BriefModal({ district, onClose }: Props) {
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [progressIdx, setProgressIdx] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const briefRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!district) return;

    const container = briefRef.current;
    if (!container) return;

    container.focus();

    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [district, onClose]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!loading) {
      setProgressIdx(0);
      return;
    }
    const timer = setInterval(() => {
      setProgressIdx((prev) => (prev + 1) % PROGRESS_MESSAGES.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    setPdfBlob(null);
    setLoading(false);
    setGenerated(false);
    setCooldown(0);
    setErrorMsg("");
  }, [district?.district_lgd_code]);

  const triggerDownload = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const filenameFor = (name: string) =>
    `${name.replace(/\s+/g, "-")}_brief.pdf`;

  const generateBrief = useCallback(async () => {
    if (!district) return;
    setLoading(true);
    setPdfBlob(null);
    setErrorMsg("");

    try {
      const res = await fetch("/api/brief", {
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
          pop_tier: district.pop_tier,
          tier_median_csr: district.tier_median_csr,
        }),
      });

      if (!res.ok) throw new Error("generation_failed");

      const blob = await res.blob();
      setPdfBlob(blob);
      setGenerated(true);
      setCooldown(30);

      triggerDownload(blob, filenameFor(district.district_name));
    } catch {
      setErrorMsg("Please try after some time.");
      setCooldown(15);
    } finally {
      setLoading(false);
    }
  }, [district, triggerDownload]);

  const formatCurrency = (val: number) =>
    "₹" + Math.round(val).toLocaleString("en-IN");

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
          <div className="absolute inset-0 bg-[#1c1c19]/85 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.3 }}
            className="relative max-w-3xl w-full max-h-[90vh] overflow-y-auto bg-[#fcf9f4] border border-[#1c1c19]"
            ref={briefRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Research brief for ${district.district_name}`}
            tabIndex={-1}
          >
            {/* Header bar */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 md:px-8 py-4 border-b border-[#1c1c19] bg-[#f6f3ee]">
              <div className="flex items-center gap-4">
                <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C] font-bold">
                  Research Brief
                </span>
                <span className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60">
                  District Profile
                </span>
              </div>
              <button
                onClick={onClose}
                className="text-[#1c1c19]/60 hover:text-[#BD402C] transition-colors"
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>

            <div className="p-6 md:p-10">
              {/* Header */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="mb-8 pb-6 border-b border-[#1c1c19]"
              >
                <p className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/60 mb-3">
                  {district.state_name}
                </p>
                <h2 className="font-headline text-4xl md:text-5xl headline-tight text-[#1c1c19] mb-5">
                  {district.district_name}
                </h2>
                <div className="flex flex-wrap items-center gap-3">
                  <motion.span
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: 0.2 }}
                    className="font-label text-xs uppercase tracking-[0.2em] bg-[#BD402C] text-white px-4 py-2"
                  >
                    POS · {district.computed_pos.toFixed(1)}/100
                  </motion.span>
                  {district.is_whitespace && (
                    <motion.span
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4, delay: 0.3 }}
                      className="font-label text-xs uppercase tracking-[0.2em] border border-[#BD402C] text-[#BD402C] px-4 py-2"
                    >
                      Neglected
                    </motion.span>
                  )}
                  {district.pop_tier && (
                    <motion.span
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4, delay: 0.35 }}
                      className="font-label text-xs uppercase tracking-[0.2em] border border-[#1c1c19] text-[#1c1c19] px-4 py-2"
                    >
                      {district.pop_tier.replace(/\s*\(.*?\)/, "")}
                    </motion.span>
                  )}
                </div>
              </motion.div>

              {/* Metrics */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="grid grid-cols-3 border border-[#1c1c19] mb-8"
              >
                {[
                  {
                    value: (district.headcount_ratio_2021 * 100).toFixed(1) + "%",
                    label: "MPI Poverty Rate",
                  },
                  {
                    value: formatCurrency(district.district_csr_per_person),
                    label: "CSR Per Person",
                  },
                  {
                    value: formatCurrency(district.tier_median_csr),
                    label: "Tier Median",
                  },
                ].map((metric, i) => (
                  <motion.div
                    key={metric.label}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.25 + i * 0.08 }}
                    className={`p-5 ${i % 2 === 1 ? "bg-[#f6f3ee]" : "bg-[#fcf9f4]"} ${i < 2 ? "border-r border-[#1c1c19]" : ""
                      }`}
                  >
                    <div className="font-label text-xl md:text-2xl font-bold text-[#BD402C] tracking-tighter mb-2">
                      {metric.value}
                    </div>
                    <div className="h-px bg-[#1c1c19]/30 w-6 mb-2" />
                    <div className="font-label text-[9px] uppercase tracking-[0.2em] text-[#1c1c19]/70">
                      {metric.label}
                    </div>
                  </motion.div>
                ))}
              </motion.div>

              {/* Comparison Charts */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6"
              >
                <MiniBarChart
                  label="MPI Poverty Rate · %"
                  unit="%"
                  data={[
                    {
                      name:
                        district.district_name.length > 10
                          ? district.district_name.slice(0, 10) + "."
                          : district.district_name,
                      value: +(district.headcount_ratio_2021 * 100).toFixed(1),
                      color: "#BD402C",
                    },
                    {
                      name: "National",
                      value: +(NATIONAL_MPI_HEADCOUNT * 100).toFixed(1),
                      color: "#1c1c19",
                    },
                  ]}
                />
                <MiniBarChart
                  label="CSR Per Person · ₹"
                  unit=""
                  data={[
                    {
                      name:
                        district.district_name.length > 10
                          ? district.district_name.slice(0, 10) + "."
                          : district.district_name,
                      value: Math.round(district.district_csr_per_person),
                      color:
                        district.district_csr_per_person < district.tier_median_csr
                          ? "#BD402C"
                          : "#1c1c19",
                    },
                    {
                      name: "Tier Med.",
                      value: Math.round(district.tier_median_csr),
                      color: "#9b2817",
                    },
                  ]}
                />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.35 }}
                className="mb-8"
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
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.4 }}
                  className="border-t border-[#1c1c19] pt-6"
                >
                  <p className="font-body text-sm text-[#1c1c19]/70 italic leading-relaxed mb-5">
                    Briefs use this district&apos;s data from NITI Aayog (MPI 2023), Ministry of Corporate Affairs (CSR data), and Census of India 2011. Narrative text is AI-generated and should be independently verified.
                  </p>
                  <button
                    onClick={generateBrief}
                    disabled={cooldown > 0}
                    className={`group w-full font-label uppercase tracking-[0.25em] text-[11px] py-5 px-8 flex justify-between items-center gap-6 transition-colors ${cooldown > 0
                      ? "bg-[#1c1c19]/30 text-[#fcf9f4] cursor-not-allowed"
                      : "bg-[#BD402C] text-white hover:bg-[#1c1c19]"
                      }`}
                  >
                    <span>
                      {cooldown > 0
                        ? `Please wait · ${cooldown}s`
                        : "Generate & Download Brief"}
                    </span>
                    <svg
                      width="18"
                      height="10"
                      viewBox="0 0 24 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M0 6h22M16 1l5 5-5 5" />
                    </svg>
                  </button>
                </motion.div>
              )}

              {/* Loading state */}
              {loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="border-t border-[#1c1c19] pt-10 pb-6 text-center"
                >
                  <div className="relative w-14 h-14 mx-auto mb-6">
                    <motion.div
                      className="absolute inset-0 border-2 border-[#BD402C]/20"
                      animate={{ opacity: [0.3, 0.7, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <motion.div
                      className="absolute inset-0 border-2 border-[#BD402C] border-t-transparent"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                    />
                  </div>

                  <AnimatePresence mode="wait">
                    <motion.p
                      key={progressIdx}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.3 }}
                      className="font-label text-[11px] uppercase tracking-[0.25em] text-[#1c1c19]"
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

                  <div className="mt-6 mx-auto max-w-xs h-px bg-[#1c1c19]/20 relative overflow-hidden">
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-[#BD402C]"
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 25, ease: "linear" }}
                      style={{ height: "2px", top: "-0.5px" }}
                    />
                  </div>
                </motion.div>
              )}

              {/* Error */}
              {errorMsg && !loading && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="border-t border-[#1c1c19] pt-8 text-center"
                >
                  <div className="inline-flex items-center justify-center w-12 h-12 border border-[#BD402C] mb-5">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#BD402C"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v4M12 16h.01" />
                    </svg>
                  </div>
                  <p className="font-body text-base text-[#1c1c19]/75 mb-6 italic">
                    {errorMsg}
                  </p>
                  <button
                    onClick={() => {
                      setErrorMsg("");
                      generateBrief();
                    }}
                    disabled={cooldown > 0}
                    className={`font-label text-[11px] uppercase tracking-[0.25em] py-3 px-8 transition-colors ${cooldown > 0
                      ? "bg-[#1c1c19]/20 text-[#1c1c19]/40 cursor-not-allowed"
                      : "bg-[#BD402C] text-white hover:bg-[#1c1c19]"
                      }`}
                  >
                    {cooldown > 0 ? `Retry in ${cooldown}s` : "Retry"}
                  </button>
                </motion.div>
              )}

              {/* Success */}
              {generated && pdfBlob && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  className="border-t border-[#1c1c19] pt-6"
                >
                  <div className="border border-[#1c1c19] bg-[#f6f3ee] p-8 text-center">
                    <div className="inline-flex items-center justify-center w-12 h-12 border border-[#1c1c19] mb-5">
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#BD402C"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C] block mb-3">
                      Download Complete
                    </span>
                    <h3 className="font-headline text-2xl md:text-3xl headline-tight text-[#1c1c19] mb-3">
                      Brief <span className="italic font-light">ready.</span>
                    </h3>
                    <p className="font-body text-sm text-[#1c1c19]/70 mb-6 italic">
                      Your PDF research brief has automatically downloaded.
                    </p>

                    <button
                      onClick={() => pdfBlob && triggerDownload(pdfBlob, filenameFor(district.district_name))}
                      className="group w-full border border-[#1c1c19] text-[#1c1c19] font-label uppercase tracking-[0.25em] text-[11px] py-4 px-6 flex justify-between items-center gap-6 hover:bg-[#1c1c19] hover:text-[#fcf9f4] transition-colors"
                    >
                      <span>Download PDF Again</span>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
