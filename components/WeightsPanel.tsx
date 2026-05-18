"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { SECTORS } from "@/lib/csr/score";
import { WEIGHT_PRESETS } from "@/lib/csr/constants";
import type { VerticalConfig, ScoringDimension, WeightPreset } from "@/lib/verticals/types";

const DEFAULT_ACCENT = "#BD402C";

const DEFAULT_DIMENSIONS: ScoringDimension[] = [
  { key: "w_N", label: "Poverty Severity", shortLabel: "N", description: "Weight given to MPI headcount ratio", defaultWeight: 0.40, hintLow: "LOW", hintHigh: "HIGH" },
  { key: "w_G", label: "Funding Gap", shortLabel: "G", description: "Weight given to CSR under-funding vs tier median", defaultWeight: 0.40, hintLow: "FUNDED", hintHigh: "NEGLECTED" },
  { key: "w_U", label: "Persistent Poverty", shortLabel: "U", description: "Weight given to districts where poverty has not improved", defaultWeight: 0.20, hintLow: "IMPROVED", hintHigh: "STUCK" },
];

const DEFAULT_PRESETS: WeightPreset[] = WEIGHT_PRESETS.map((p) => ({
  name: p.name,
  weights: { w_N: p.w_N, w_G: p.w_G, w_U: p.w_U },
}));

interface Props {
  onWeightsChange: (weights: Record<string, number>) => void;
  onSectorChange: (sector: string) => void;
  onWhitespaceToggle: (on: boolean) => void;
  onReset?: () => void;
  weights?: Record<string, number>;
  vertical?: VerticalConfig;
}

function matchesPreset(w: Record<string, number>, presets: WeightPreset[]): string | null {
  for (const p of presets) {
    const keys = Object.keys(p.weights);
    const match = keys.every((k) => Math.abs((w[k] ?? 0) - p.weights[k]) < 0.015);
    if (match) return p.name;
  }
  return null;
}

export default function WeightsPanel({
  onWeightsChange,
  onSectorChange,
  onWhitespaceToggle,
  onReset,
  weights: externalWeights,
  vertical,
}: Props) {
  const accent = vertical?.theme.accent ?? DEFAULT_ACCENT;
  const dimensions = vertical?.dimensions ?? DEFAULT_DIMENSIONS;
  const sectors = vertical?.sectors ?? [...SECTORS];
  const presets = vertical?.weightPresets ?? DEFAULT_PRESETS;
  const methodologyHref = vertical && vertical.slug !== "csr" ? `/${vertical.slug}/methodology` : "/methodology";

  const defaultPct = useMemo(() => {
    const pct: Record<string, number> = {};
    for (const d of dimensions) pct[d.key] = Math.round(d.defaultWeight * 100);
    return pct;
  }, [dimensions]);

  const [localPct, setLocalPct] = useState<Record<string, number>>(defaultPct);
  const [sector, setSector] = useState("All Sectors");
  const [whitespaceOnly, setWhitespaceOnly] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(presets[0]?.name ?? null);
  const [drafts, setDrafts] = useState<Record<string, string | null>>(() => {
    const d: Record<string, string | null> = {};
    for (const dim of dimensions) d[dim.key] = null;
    return d;
  });

  useEffect(() => {
    if (externalWeights) {
      const newPct: Record<string, number> = {};
      for (const d of dimensions) newPct[d.key] = Math.round((externalWeights[d.key] ?? 0) * 100);
      setLocalPct(newPct);
      setActivePreset(matchesPreset(externalWeights, presets));
    }
  }, [externalWeights, dimensions, presets]);

  const handleSliderChange = useCallback(
    (key: string, value: number) => {
      const clamped = Math.max(0, Math.min(100, value));
      const remaining = 100 - clamped;
      const others = dimensions.filter((d) => d.key !== key).map((d) => d.key);
      const otherSum = others.reduce((sum, k) => sum + (localPct[k] ?? 0), 0);

      const newPct: Record<string, number> = { ...localPct, [key]: clamped };
      if (otherSum > 0) {
        let assigned = 0;
        for (let i = 0; i < others.length; i++) {
          if (i === others.length - 1) {
            newPct[others[i]] = Math.max(0, remaining - assigned);
          } else {
            const share = Math.round(remaining * ((localPct[others[i]] ?? 0) / otherSum));
            newPct[others[i]] = Math.max(0, share);
            assigned += share;
          }
        }
      } else {
        const each = Math.floor(remaining / others.length);
        const leftover = remaining - each * others.length;
        for (let i = 0; i < others.length; i++) {
          newPct[others[i]] = each + (i === 0 ? leftover : 0);
        }
      }

      setLocalPct(newPct);
      const decimal: Record<string, number> = {};
      for (const k of Object.keys(newPct)) decimal[k] = newPct[k] / 100;
      onWeightsChange(decimal);
      setActivePreset(matchesPreset(decimal, presets));
    },
    [onWeightsChange, localPct, dimensions, presets]
  );

  const applyPreset = useCallback(
    (preset: WeightPreset) => {
      const newPct: Record<string, number> = {};
      for (const [k, v] of Object.entries(preset.weights)) newPct[k] = Math.round(v * 100);
      setLocalPct(newPct);
      setActivePreset(preset.name);
      onWeightsChange(preset.weights);
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
    setLocalPct(defaultPct);
    setSector("All Sectors");
    setWhitespaceOnly(false);
    setActivePreset(presets[0]?.name ?? null);
    const resetDrafts: Record<string, string | null> = {};
    for (const d of dimensions) resetDrafts[d.key] = null;
    setDrafts(resetDrafts);
    onReset?.();
  }, [onReset, defaultPct, dimensions, presets]);

  const commitDraft = useCallback(
    (key: string) => {
      const raw = drafts[key];
      setDrafts((d) => ({ ...d, [key]: null }));
      if (raw === null || raw === "") return;
      const parsed = parseInt(raw, 10);
      if (Number.isNaN(parsed)) return;
      const clamped = Math.max(0, Math.min(100, parsed));
      if (clamped === localPct[key]) return;
      handleSliderChange(key, clamped);
    },
    [drafts, localPct, handleSliderChange]
  );

  const total = Object.values(localPct).reduce((sum, v) => sum + v, 0);

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
            className="font-label text-[10px] uppercase tracking-[0.3em] font-bold mb-3 block"
            style={{ color: accent }}
          >
            Focus Sector
          </label>
          <div className="relative">
            <select
              id="sector-select"
              value={sector}
              onChange={(e) => handleSectorChange(e.target.value)}
              aria-label="Filter districts by sector"
              className="w-full bg-transparent text-[#1c1c19] border-0 border-b border-[#1c1c19] py-3 px-0 pr-8 font-body text-sm focus:ring-0 focus:outline-none appearance-none cursor-pointer"
            >
              {sectors.map((s) => (
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
            <label className="font-label text-[10px] uppercase tracking-[0.3em] font-bold" style={{ color: accent }}>
              Scoring Weights
            </label>
            {total !== 100 && (
              <span className="font-label text-[10px] uppercase tracking-widest" style={{ color: accent }}>
                Σ {total}%
              </span>
            )}
          </div>
          <div className="space-y-8">
            {dimensions.map((dim) => {
              const pct = localPct[dim.key] ?? 0;
              return (
                <div key={dim.key}>
                  <div className="flex justify-between items-baseline mb-3">
                    <span className="font-label text-[11px] uppercase tracking-[0.15em] text-[#1c1c19]">
                      {dim.label}
                    </span>
                    <span className="font-label text-sm font-bold tracking-tighter inline-flex items-baseline" style={{ color: accent }}>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={drafts[dim.key] ?? pct}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [dim.key]: e.target.value }))
                        }
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={() => commitDraft(dim.key)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          } else if (e.key === "Escape") {
                            setDrafts((d) => ({ ...d, [dim.key]: null }));
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        aria-label={`${dim.label} weight percentage`}
                        className="w-10 text-right bg-transparent border-0 border-b border-transparent focus:outline-none font-label text-sm font-bold tracking-tighter [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        style={{ color: accent, borderBottomColor: 'transparent' }}
                        onFocusCapture={(e) => { e.currentTarget.style.borderBottomColor = accent; }}
                        onBlurCapture={(e) => { e.currentTarget.style.borderBottomColor = 'transparent'; }}
                      />
                      <span aria-hidden>%</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={pct}
                    onChange={(e) => handleSliderChange(dim.key, Number(e.target.value))}
                    aria-label={`${dim.label} weight: ${pct}%`}
                    className="w-full"
                  />
                  {(dim.hintLow || dim.hintHigh) && (
                    <div className="flex justify-between mt-2 font-label text-[9px] tracking-[0.2em] text-[#1c1c19]/40">
                      <span>{dim.hintLow}</span>
                      <span>{dim.hintHigh}</span>
                    </div>
                  )}
                  <p className="font-body text-xs text-[#1c1c19]/60 mt-2 italic">
                    {dim.description}
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
            {presets.map((preset, idx) => {
              const isActive = activePreset === preset.name;
              return (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset)}
                  aria-label={`Apply ${preset.name} weight preset`}
                  aria-pressed={isActive}
                  className={`font-label text-[10px] uppercase tracking-[0.15em] px-3 py-3 flex-1 min-w-[50%] transition-colors ${idx % 2 === 1 ? "border-l border-[#1c1c19]" : ""
                    } ${idx >= 2 ? "border-t border-[#1c1c19]" : ""} ${isActive
                      ? "text-white"
                      : "bg-[#fcf9f4] text-[#1c1c19] hover:bg-[#f6f3ee]"
                    }`}
                  style={isActive ? { backgroundColor: accent } : undefined}
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
              style={{ background: whitespaceOnly ? accent : "transparent" }}
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
            href={methodologyHref}
            className="font-label text-[10px] uppercase tracking-[0.25em] text-[#1c1c19] transition-colors flex items-center justify-between gap-2"
            onMouseEnter={e => (e.currentTarget.style.color = accent)}
            onMouseLeave={e => (e.currentTarget.style.color = '#1c1c19')}
          >
            <span>Full Methodology</span>
            <span className="text-[10px]">→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
