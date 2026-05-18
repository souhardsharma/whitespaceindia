"use client";

import { memo, useCallback } from "react";
import { District } from "@/lib/csr/score";
import type { VerticalConfig } from "@/lib/verticals/types";

const DEFAULT_ACCENT = "#BD402C";

interface Props {
  districts: Array<District & { computed_pos: number; rank: number }>;
  onSelectDistrict: (district: District) => void;
  selectedLgdCode: string | null;
  isLoading: boolean;
  vertical?: VerticalConfig;
}

type RankedDistrict = District & { computed_pos: number; rank: number };

const DistrictRow = memo(function DistrictRow({
  district,
  isSelected,
  onSelect,
  accent = DEFAULT_ACCENT,
}: {
  district: RankedDistrict;
  isSelected: boolean;
  onSelect: (district: RankedDistrict) => void;
  accent?: string;
}) {
  const handleClick = useCallback(() => onSelect(district), [onSelect, district]);

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className={`group cursor-pointer py-3 px-2 transition-colors duration-150 ${
        isSelected
          ? "bg-[#ebe8e3] border-l-2 pl-4"
          : "border-l-2 border-transparent hover:bg-[#f6f3ee] hover:border-[#1c1c19] hover:pl-4"
      }`}
      style={isSelected ? { borderLeftColor: accent } : undefined}
    >
      <div className="flex items-center justify-between border-b border-[#1c1c19] pb-3 gap-3">
        <div className="flex items-baseline gap-4 min-w-0 flex-1">
          <span className="font-label text-[10px] text-[#1c1c19]/30 tracking-widest shrink-0 w-7">
            {String(district.rank).padStart(2, "0")}
          </span>
          <h5 className="font-body font-bold text-sm text-[#1c1c19] truncate">
            {district.district_name}
          </h5>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {district.is_whitespace && (
            <span className="font-label text-[9px] uppercase tracking-widest px-2 py-0.5" style={{ color: accent, borderWidth: 1, borderStyle: 'solid', borderColor: accent }}>
              Neglected
            </span>
          )}
          <span className="font-label text-sm font-bold tracking-tighter tabular-nums" style={{ color: accent }}>
            {district.computed_pos.toFixed(1)}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2">
        <p className="font-label text-[10px] uppercase tracking-widest text-[#1c1c19]/50">
          {district.state_name}
          {district.pop_tier && <> · {district.pop_tier.replace(/\s*\(.*?\)/, "")}</>}
        </p>
        <div className="h-px bg-[#1c1c19]/30 flex-1 mx-3 max-w-[80px] relative overflow-hidden">
          <div
            className="absolute left-0"
            style={{
              width: `${district.computed_pos}%`,
              height: "2px",
              top: "-0.5px",
              transition: "width 250ms ease-out",
              willChange: "width",
              backgroundColor: accent,
            }}
          />
        </div>
      </div>
    </div>
  );
});

function SkeletonRow() {
  return (
    <div className="py-3 px-2 animate-pulse">
      <div className="flex items-center justify-between border-b border-[#1c1c19]/20 pb-3 gap-3">
        <div className="flex items-baseline gap-4 flex-1">
          <div className="w-7 h-3 bg-[#1c1c19]/10" />
          <div className="h-4 bg-[#1c1c19]/10 w-1/2" />
        </div>
        <div className="w-10 h-4 bg-[#1c1c19]/10" />
      </div>
      <div className="h-3 bg-[#1c1c19]/10 w-1/3 mt-2" />
    </div>
  );
}

export default function RankingList({
  districts,
  onSelectDistrict,
  selectedLgdCode,
  isLoading,
  vertical,
}: Props) {
  const accent = vertical?.theme.accent ?? DEFAULT_ACCENT;
  const handleSelect = useCallback(
    (d: District) => onSelectDistrict(d),
    [onSelectDistrict]
  );

  if (isLoading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (districts.length === 0) {
    return (
      <div className="text-center py-16 border-t border-[#1c1c19]">
        <p className="font-body text-sm text-[#1c1c19]/60 italic">
          No districts match your filters. Try selecting &quot;All Sectors&quot; or adjusting the weights.
        </p>
      </div>
    );
  }

  return (
    <div
      className="overflow-y-auto space-y-1 pr-2 scrollbar-thin"
      style={{ maxHeight: "420px", contain: "content" }}
    >
      {districts.map((d) => (
        <DistrictRow
          key={d.district_lgd_code}
          district={d}
          isSelected={selectedLgdCode === d.district_lgd_code}
          onSelect={handleSelect}
          accent={accent}
        />
      ))}
    </div>
  );
}
