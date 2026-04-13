"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { SECTORS, Weights } from "@/lib/score";
import { WEIGHT_PRESETS } from "@/lib/constants";

interface Props {
  onWeightsChange: (weights: { w_N: number; w_G: number; w_U: number }) => void;
  onSectorChange: (sector: string) => void;
  onWhitespaceToggle: (on: boolean) => void;
  onReset?: () => void;
  weights?: Weights;
}

const SLIDER_COLORS: Record<string, string> = {
  w_N: "#F5A623",
  w_G: "#7C3AED",
  w_U: "#10B981",
};

function matchesPreset(w: { w_N: number; w_G: number; w_U: number }): string | null {
  for (const p of WEIGHT_PRESETS) {
    if (
      Math.abs(w.w_N - p.w_N) < 0.005 &&
      Math.abs(w.w_G - p.w_G) < 0.005 &&
      Math.abs(w.w_U - p.w_U) < 0.005
    ) {
      return p.name;
    }
  }
  return null;
}

export default function WeightsPanel({
  onWeightsChange,
  onSectorChange,
  onWhitespaceToggle,
  onReset,
  weights: externalWeights,
}: Props) {
  const [localPct, setLocalPct] = useState({ w_N: 40, w_G: 40, w_U: 20 });
  const [sector, setSector] = useState("All Sectors");
  const [whitespaceOnly, setWhitespaceOnly] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>("Balanced");

  // Sync local display when parent resets weights
  useEffect(() => {
    if (externalWeights) {
      const newPct = {
        w_N: Math.round(externalWeights.w_N * 100),
        w_G: Math.round(externalWeights.w_G * 100),
        w_U: Math.round(externalWeights.w_U * 100),
      };
      setLocalPct(newPct);
      setActivePreset(matchesPreset(externalWeights));
    }
  }, [externalWeights]);

  const handleSliderChange = useCallback(
    (key: "w_N" | "w_G" | "w_U", value: number) => {
      const clamped = Math.max(0, Math.min(100, value));
      const remaining = 100 - clamped;
      const others = (["w_N", "w_G", "w_U"] as const).filter((k) => k !== key);
      const each = Math.floor(remaining / 2);
      const extra = remaining - each * 2;
      const newPct = {
        [key]: clamped,
        [others[0]]: each + extra,
        [others[1]]: each,
      } as { w_N: number; w_G: number; w_U: number };
      setLocalPct(newPct);
      const decimal = {
        w_N: newPct.w_N / 100,
        w_G: newPct.w_G / 100,
        w_U: newPct.w_U / 100,
      };
      onWeightsChange(decimal);
      setActivePreset(matchesPreset(decimal));
    },
    [onWeightsChange]
  );

  const applyPreset = useCallback(
    (preset: (typeof WEIGHT_PRESETS)[number]) => {
      const newPct = {
        w_N: Math.round(preset.w_N * 100),
        w_G: Math.round(preset.w_G * 100),
        w_U: Math.round(preset.w_U * 100),
      };
      setLocalPct(newPct);
      setActivePreset(preset.name);
      onWeightsChange({ w_N: preset.w_N, w_G: preset.w_G, w_U: preset.w_U });
    },
    [onWeightsChange]
  );

  const handleSectorChange = useCallback(
    (val: string) => {
      setSector(val);
      onSectorChange(val);
    },
    [onSectorChange]
  );

  const handleWhitespaceToggle = useCallback(() => {
    setWhitespaceOnly((prev) => {
      const next = !prev;
      onWhitespaceToggle(next);
      return next;
    });
  }, [onWhitespaceToggle]);

  const handleReset = useCallback(() => {
    setLocalPct({ w_N: 40, w_G: 40, w_U: 20 });
    setSector("All Sectors");
    setWhitespaceOnly(false);
    setActivePreset("Balanced");
    onReset?.();
  }, [onReset]);

  const total = localPct.w_N + localPct.w_G + localPct.w_U;

  const sliders = [
    {
      key: "w_N" as const,
      label: "Poverty Severity",
      tooltip: "How much weight to give the MPI headcount ratio",
    },
    {
      key: "w_G" as const,
      label: "Funding Gap",
      tooltip: "How much weight to give CSR underfunding relative to population",
    },
    {
      key: "w_U" as const,
      label: "Persistent Poverty",
      tooltip: "How much weight to give districts where poverty has not improved",
    },
  ];

  return (
    <div className="bg-[#0D1B2E]/80 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
        <div>
          <h3 className="font-display text-base text-white font-semibold">Scoring Controls</h3>
          <p className="text-xs text-[#64748B] mt-0.5">Adjust weights to match your strategy</p>
        </div>
        <button
          onClick={handleReset}
          className="text-[10px] text-[#64748B] hover:text-[#F5A623] border border-white/10 hover:border-[#F5A623]/30 px-2.5 py-1 rounded-lg transition-colors uppercase tracking-wider font-semibold"
        >
          Reset all
        </button>
      </div>

      <div className="p-6 space-y-7">
        {/* Sector */}
        <div>
          <label
            htmlFor="sector-select"
            className="text-xs uppercase tracking-wider text-[#F5A623] font-semibold mb-2 block"
          >
            Focus Sector
          </label>
          <select
            id="sector-select"
            value={sector}
            onChange={(e) => handleSectorChange(e.target.value)}
            aria-label="Filter districts by CSR sector"
            className="w-full bg-[#1E293B] text-white border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:border-[#F5A623] focus:outline-none focus:ring-1 focus:ring-[#F5A623] transition-colors"
          >
            {SECTORS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Scoring Weights */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <label className="text-xs uppercase tracking-wider text-[#F5A623] font-semibold">
              Scoring Weights
            </label>
            {total !== 100 && (
              <span className="text-xs text-red-400">Sum: {total}%</span>
            )}
          </div>
          <div className="space-y-5">
            {sliders.map((slider) => {
              const color = SLIDER_COLORS[slider.key];
              const pct = localPct[slider.key];
              return (
                <div key={slider.key}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-white">{slider.label}</span>
                    <span
                      className="text-sm font-bold px-2 py-0.5 rounded-full"
                      style={{ background: `${color}20`, color }}
                    >
                      {pct}%
                    </span>
                  </div>
                  {/* Custom styled range */}
                  <div className="relative h-2 rounded-full bg-white/10">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-150"
                      style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}90, ${color})` }}
                    />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={pct}
                      onChange={(e) => handleSliderChange(slider.key, Number(e.target.value))}
                      aria-label={`${slider.label} weight: ${pct}%`}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 shadow-lg transition-all duration-150"
                      style={{
                        left: `calc(${pct}% - 8px)`,
                        borderColor: color,
                        background: "#0D1B2E",
                        boxShadow: `0 0 8px ${color}60`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-[#64748B] mt-1.5">{slider.tooltip}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Presets */}
        <div>
          <p className="text-xs uppercase tracking-wider text-[#64748B] font-semibold mb-3">Quick Presets</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Scoring weight presets">
            {WEIGHT_PRESETS.map((preset) => {
              const isActive = activePreset === preset.name;
              return (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset)}
                  aria-label={`Apply ${preset.name} weight preset`}
                  aria-pressed={isActive}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all duration-200 ${
                    isActive
                      ? "bg-[#F5A623] text-[#0B1526] border-[#F5A623] font-bold shadow-[0_0_12px_rgba(245,166,35,0.3)]"
                      : "border-[#F5A623]/30 text-[#F5A623] hover:bg-[#F5A623]/10 hover:border-[#F5A623]/60"
                  }`}
                >
                  {preset.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Whitespace Toggle */}
        <div className="border-t border-white/10 pt-5">
          <button
            onClick={handleWhitespaceToggle}
            aria-pressed={whitespaceOnly}
            aria-label={`Show neglected districts only: ${whitespaceOnly ? "on" : "off"}`}
            className="flex items-center justify-between w-full group"
          >
            <div className="text-left">
              <span className="text-sm font-medium text-white block">
                Neglected Districts Only
              </span>
              <span className="text-xs text-[#64748B] block mt-0.5">
                Bottom 25% CSR + Top 25% poverty
              </span>
            </div>
            <div
              className="w-12 h-6 rounded-full transition-colors relative shrink-0 ml-4"
              style={{ background: whitespaceOnly ? "#F5A623" : "rgba(255,255,255,0.1)" }}
            >
              <div
                className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform shadow-sm"
                style={{ transform: whitespaceOnly ? "translateX(26px)" : "translateX(2px)" }}
              />
            </div>
          </button>
        </div>

        {/* Methodology link */}
        <div className="border-t border-white/10 pt-4">
          <Link
            href="/methodology"
            className="text-xs text-[#64748B] hover:text-[#F5A623] transition-colors flex items-center gap-1"
          >
            OECD composite indicator methodology
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}
