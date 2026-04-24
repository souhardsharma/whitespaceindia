"use client";

import { memo, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { District } from "@/lib/score";

interface Props {
  districts: Array<District & { computed_pos: number; rank: number }>;
  onSelectDistrict: (district: District) => void;
  selectedLgdCode: string | null;
  isLoading: boolean;
}

const DistrictRow = memo(function DistrictRow({
  district,
  isSelected,
  onSelect,
}: {
  district: District & { computed_pos: number; rank: number };
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <motion.div
      layout={false}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onSelect}
      className={`group cursor-pointer py-3 px-2 transition-colors ${
        isSelected
          ? "bg-[#ebe8e3] border-l-2 border-[#BD402C] pl-4"
          : "border-l-2 border-transparent hover:bg-[#f6f3ee] hover:border-[#1c1c19] hover:pl-4"
      }`}
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
            <span className="font-label text-[9px] uppercase tracking-widest text-[#BD402C] border border-[#BD402C] px-2 py-0.5">
              Neglected
            </span>
          )}
          <span className="font-label text-sm text-[#BD402C] font-bold tracking-tighter tabular-nums">
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
          <motion.div
            className="absolute inset-y-0 left-0 bg-[#BD402C]"
            initial={{ width: 0 }}
            animate={{ width: `${district.computed_pos}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            style={{ height: "2px", top: "-0.5px" }}
          />
        </div>
      </div>
    </motion.div>
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
}: Props) {
  const handleSelect = useCallback(
    (d: District) => onSelectDistrict(d),
    [onSelectDistrict]
  );

  const listKey = useMemo(() => {
    const sig = districts
      .slice(0, 5)
      .map((d) => `${d.district_lgd_code}:${d.computed_pos.toFixed(1)}`)
      .join("|");
    return `${districts.length}-${sig}`;
  }, [districts]);

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
      key={listKey}
      className="overflow-y-auto space-y-1 pr-2 scrollbar-thin"
      style={{ maxHeight: "420px" }}
    >
      {districts.map((d) => (
        <DistrictRow
          key={d.district_lgd_code}
          district={d}
          isSelected={selectedLgdCode === d.district_lgd_code}
          onSelect={() => handleSelect(d)}
        />
      ))}
    </div>
  );
}
