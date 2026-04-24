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
      const otherSum = localPct[others[0]] + localPct[others[1]];
      let newPct: { w_N: number; w_G: number; w_U: number };
      if (otherSum > 0) {
        const r0 = Math.round(remaining * (localPct[others[0]] / otherSum));
        const r1 = remaining - r0;
        newPct = {
          [key]: clamped,
          [others[0]]: Math.max(0, r0),
          [others[1]]: Math.max(0, r1),
        } as { w_N: number; w_G: number; w_U: number };
      } else {
        const each = Math.floor(remaining / 2);
        newPct = {
          [key]: clamped,
          [others[0]]: each + (remaining - each * 2),
          [others[1]]: each,
        } as { w_N: number; w_G: number; w_U: number };
      }
      setLocalPct(newPct);
      const decimal = {
        w_N: newPct.w_N / 100,
        w_G: newPct.w_G / 100,
        w_U: newPct.w_U / 100,
      };
      onWeightsChange(decimal);
      setActivePreset(matchesPreset(decimal));
    },
    [onWeightsChange, localPct]
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
      tooltip: "Weight given to MPI headcount ratio",
      hint1: "LOW",
      hint2: "HIGH",
    },
    {
      key: "w_G" as const,
      label: "Funding Gap",
      tooltip: "Weight given to CSR under-funding vs tier median",
      hint1: "FUNDED",
      hint2: "NEGLECTED",
    },
    {
      key: "w_U" as const,
      label: "Persistent Poverty",
      tooltip: "Weight given to districts where poverty has not improved",
      hint1: "IMPROVED",
      hint2: "STUCK",
    },
  ];

  return (
    <div className="bg-[#fcf9f4] border border-[#1c1c19]">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[#1c1c19] bg-[#f6f3ee] flex items-center justify-between gap-4">
        <div>
          <h3 className="font-label text-[11px] uppercase tracking-[0.3em] font-bold text-[#1c1c19]">
            Scoring Controls
          </h3>
          <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/60 mt-2">
            Calibrate the Index
          </p>
        </div>
        <button
          onClick={handleReset}
          className="font-label text-[10px] uppercase tracking-[0.2em] border border-[#1c1c19] text-[#1c1c19] px-3 py-2 hover:bg-[#1c1c19] hover:text-[#fcf9f4] transition-colors"
        >
          Reset
        </button>
      </div>

      <div className="p-6 space-y-8">
        {/* Sector */}
        <div>
          <label
            htmlFor="sector-select"
            className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C] font-bold mb-3 block"
          >
            Focus Sector
          </label>
          <div className="relative">
            <select
              id="sector-select"
              value={sector}
              onChange={(e) => handleSectorChange(e.target.value)}
              aria-label="Filter districts by CSR sector"
              className="w-full bg-transparent text-[#1c1c19] border-0 border-b border-[#1c1c19] py-3 px-0 pr-8 font-body text-sm focus:ring-0 focus:outline-none appearance-none cursor-pointer"
            >
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="absolute right-0 top-1/2 -translate-y-1/2 font-label text-xs text-[#1c1c19]/60 pointer-events-none">
              ▾
            </span>
          </div>
        </div>

        {/* Scoring Weights */}
        <div className="pt-2">
          <div className="flex items-center justify-between mb-6">
            <label className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C] font-bold">
              Scoring Weights
            </label>
            {total !== 100 && (
              <span className="font-label text-[10px] uppercase tracking-widest text-[#BD402C]">
                Σ {total}%
              </span>
            )}
          </div>
          <div className="space-y-8">
            {sliders.map((slider) => {
              const pct = localPct[slider.key];
              return (
                <div key={slider.key}>
                  <div className="flex justify-between items-baseline mb-3">
                    <span className="font-label text-[11px] uppercase tracking-[0.15em] text-[#1c1c19]">
                      {slider.label}
                    </span>
                    <span className="font-label text-sm font-bold text-[#BD402C] tracking-tighter">
                      {pct}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={pct}
                    onChange={(e) => handleSliderChange(slider.key, Number(e.target.value))}
                    aria-label={`${slider.label} weight: ${pct}%`}
                    className="w-full"
                  />
                  <div className="flex justify-between mt-2 font-label text-[9px] tracking-[0.2em] text-[#1c1c19]/40">
                    <span>{slider.hint1}</span>
                    <span>{slider.hint2}</span>
                  </div>
                  <p className="font-body text-xs text-[#1c1c19]/60 mt-2 italic">
                    {slider.tooltip}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Presets */}
        <div className="pt-2">
          <p className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/60 font-bold mb-4">
            Quick Presets
          </p>
          <div className="flex flex-wrap gap-0 border border-[#1c1c19]" role="group" aria-label="Scoring weight presets">
            {WEIGHT_PRESETS.map((preset, idx) => {
              const isActive = activePreset === preset.name;
              return (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset)}
                  aria-label={`Apply ${preset.name} weight preset`}
                  aria-pressed={isActive}
                  className={`font-label text-[10px] uppercase tracking-[0.15em] px-3 py-3 flex-1 min-w-[50%] transition-colors ${idx % 2 === 1 ? "border-l border-[#1c1c19]" : ""
                    } ${idx >= 2 ? "border-t border-[#1c1c19]" : ""} ${isActive
                      ? "bg-[#BD402C] text-white"
                      : "bg-[#fcf9f4] text-[#1c1c19] hover:bg-[#f6f3ee]"
                    }`}
                >
                  {preset.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Whitespace Toggle */}
        <div className="border-t border-[#1c1c19] pt-6">
          <button
            onClick={handleWhitespaceToggle}
            aria-pressed={whitespaceOnly}
            aria-label={`Show neglected districts only: ${whitespaceOnly ? "on" : "off"}`}
            className="flex items-center justify-between w-full group gap-4"
          >
            <div className="text-left">
              <span className="font-label text-[11px] uppercase tracking-[0.15em] text-[#1c1c19] block">
                Neglected Only
              </span>
              <span className="font-body text-xs text-[#1c1c19]/60 block mt-1 italic">
                Bottom 25% CSR + Top 25% poverty
              </span>
            </div>
            <div
              className="w-14 h-6 relative shrink-0 border border-[#1c1c19]"
              style={{ background: whitespaceOnly ? "#BD402C" : "transparent" }}
            >
              <div
                className="w-5 h-5 absolute top-0 transition-transform"
                style={{
                  transform: whitespaceOnly ? "translateX(32px)" : "translateX(0px)",
                  background: whitespaceOnly ? "#fcf9f4" : "#1c1c19",
                }}
              />
            </div>
          </button>
        </div>

        {/* Methodology link */}
        <div className="border-t border-[#1c1c19] pt-5">
          <Link
            href="/methodology"
            className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19] hover:text-[#BD402C] transition-colors flex items-center justify-between gap-2"
          >
            <span>Full Methodology</span>
            <span className="text-[10px]">→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
