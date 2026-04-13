"use client";

import { memo, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { District } from "@/lib/score";
import { SCORE_TIERS } from "@/lib/constants";

interface Props {
  districts: Array<District & { computed_pos: number; rank: number }>;
  onSelectDistrict: (district: District) => void;
  selectedLgdCode: string | null;
  isLoading: boolean;
}

function getTierColor(score: number): string {
  for (const tier of SCORE_TIERS) {
    if (score >= tier.min) return tier.color;
  }
  return "#64748B";
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onSelect}
      className={`p-3 rounded-xl cursor-pointer transition-colors flex-shrink-0 ${
        isSelected
          ? "bg-white/10 border-l-2 border-[#F5A623]"
          : "bg-white/5 hover:bg-white/[0.07] border-l-2 border-transparent"
      }`}
    >
      <div className="flex items-center gap-3">
        {district.rank <= 3 ? (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold"
            style={{
              background: district.rank === 1
                ? "linear-gradient(135deg, #F5A623, #FBBF24, #F97316)"
                : district.rank === 2
                ? "linear-gradient(135deg, #94A3B8, #CBD5E1, #94A3B8)"
                : "linear-gradient(135deg, #B45309, #D97706, #B45309)",
              color: "#0B1526",
              boxShadow: district.rank === 1
                ? "0 0 12px rgba(245,166,35,0.4)"
                : "none",
            }}
          >
            {district.rank}
          </div>
        ) : (
          <span className="text-lg font-bold w-8 text-right shrink-0 text-[#64748B]">
            {district.rank}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="font-semibold text-white text-sm block truncate">
                {district.district_name}
              </span>
              <span className="text-xs text-[#94A3B8]">{district.state_name}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {district.is_whitespace && (
                <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                  Neglected
                </span>
              )}
              <span
                className="text-xs font-bold px-2 py-1 rounded-full"
                style={{
                  backgroundColor: getTierColor(district.computed_pos) + "20",
                  color: getTierColor(district.computed_pos),
                }}
              >
                {district.computed_pos.toFixed(1)}
              </span>
            </div>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden relative">
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${district.computed_pos}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              style={{
                background: `linear-gradient(90deg, ${getTierColor(district.computed_pos)}90, ${getTierColor(district.computed_pos)})`,
                boxShadow: `0 0 6px ${getTierColor(district.computed_pos)}40`,
              }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
});

function SkeletonRow() {
  return (
    <div className="p-3 rounded-xl bg-white/5 animate-pulse flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-6 bg-white/10 rounded" />
        <div className="flex-1">
          <div className="h-4 bg-white/10 rounded w-2/3 mb-2" />
          <div className="h-3 bg-white/10 rounded w-1/3 mb-2" />
          <div className="h-1.5 bg-white/10 rounded-full" />
        </div>
      </div>
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

  // Build a stable key that changes whenever the ranking order actually changes.
  // This forces a clean remount of the list, avoiding AnimatePresence reconciliation bugs.
  const listKey = useMemo(() => {
    // Use the first 5 district codes + their scores to detect ranking changes
    const sig = districts
      .slice(0, 5)
      .map((d) => `${d.district_lgd_code}:${d.computed_pos.toFixed(1)}`)
      .join("|");
    return `${districts.length}-${sig}`;
  }, [districts]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (districts.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-[#94A3B8] text-sm">
          No districts match your filters. Try selecting &quot;All Sectors&quot; or
          adjusting weights.
        </p>
      </div>
    );
  }

  return (
    <div
      key={listKey}
      className="overflow-y-auto space-y-2 pr-1 scrollbar-thin"
      style={{ maxHeight: "370px" }}
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
