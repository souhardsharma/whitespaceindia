"use client";

import { useState, useCallback, useMemo, memo, useEffect, useRef } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
} from "react-simple-maps";
import { scaleLinear } from "d3-scale";
import { feature } from "topojson-client";

const TOPO_URL = "/india-states.topojson";

function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+/g, " ")
    .trim();
}

// D3 linear color scale for continuous scoring
const colorScale = scaleLinear<string>()
  .domain([0, 25, 50, 75])
  .range(["#1a1f35", "#2d1f5e", "#8b3a3a", "#ef4444"])
  .clamp(true);

interface Props {
  districtScores: Record<string, number>;
  onStateClick?: (stateName: string) => void;
  highlightedState?: string | null;
}

interface TooltipData {
  name: string;
  score: number;
  x: number;
  y: number;
}

function IndiaMap({ districtScores, onStateClick, highlightedState }: Props) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [geoData, setGeoData] = useState<any>(null);

  useEffect(() => {
    fetch(TOPO_URL)
      .then((r) => r.json())
      .then((topo) => {
        const geo = feature(
          topo,
          topo.objects.states ?? topo.objects.districts ?? Object.values(topo.objects)[0]
        );
        setGeoData(geo);
      })
      .catch(console.error);
  }, []);

  // Build normalized lookup: normalized name -> score
  const scoreLookup = useMemo(() => {
    const lookup: Record<string, number> = {};
    for (const [k, v] of Object.entries(districtScores)) {
      lookup[normalizeForMatch(k)] = v;
    }
    return lookup;
  }, [districtScores]);

  // Build reverse map: normalized name -> original data name
  const dataNameLookup = useMemo(() => {
    const lookup: Record<string, string> = {};
    for (const k of Object.keys(districtScores)) {
      lookup[normalizeForMatch(k)] = k;
    }
    return lookup;
  }, [districtScores]);

  const getStateName = useCallback((geo: Record<string, unknown>): string => {
    const props = geo.properties as Record<string, unknown>;
    return (
      (props.st_nm as string) ||
      (props.ST_NM as string) ||
      (props.name as string) ||
      "Unknown"
    );
  }, []);

  const getStateScore = useCallback(
    (name: string): number | null => {
      const score = scoreLookup[normalizeForMatch(name)];
      return score !== undefined ? score : null;
    },
    [scoreLookup]
  );

  const getStateFill = useCallback(
    (name: string): string => {
      const score = getStateScore(name);
      if (score === null) return "#111827";
      return colorScale(score);
    },
    [getStateScore]
  );

  const getRelativePos = useCallback((evt: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: rect ? evt.clientX - rect.left : evt.clientX,
      y: rect ? evt.clientY - rect.top : evt.clientY,
    };
  }, []);

  const handleMouseEnter = useCallback(
    (geo: Record<string, unknown>, evt: React.MouseEvent) => {
      const name = getStateName(geo);
      setHoveredState(name);
      const score = getStateScore(name);
      const { x, y } = getRelativePos(evt);
      setTooltip({
        name,
        score: score !== null ? Math.round(score) : -1,
        x,
        y,
      });
    },
    [getStateName, getStateScore, getRelativePos]
  );

  const handleMouseMove = useCallback((evt: React.MouseEvent) => {
    const { x, y } = getRelativePos(evt);
    setTooltip((prev) =>
      prev ? { ...prev, x, y } : null
    );
  }, [getRelativePos]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    setHoveredState(null);
  }, []);

  const handleClick = useCallback(
    (geo: Record<string, unknown>) => {
      const topoName = getStateName(geo);
      const dataName = dataNameLookup[normalizeForMatch(topoName)] || topoName;
      onStateClick?.(dataName);
    },
    [onStateClick, dataNameLookup, getStateName]
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ aspectRatio: "3/4", maxHeight: "500px" }}
      role="img"
      aria-label="Map of India showing average Philanthropic Opportunity Scores by state"
    >
      {!geoData ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#F5A623] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ center: [82, 22], scale: 1000 }}
          width={600}
          height={750}
          style={{ width: "100%", height: "100%" }}
        >
          <Geographies geography={geoData}>
            {({ geographies }: { geographies: Record<string, unknown>[] }) =>
              geographies.map((geo) => {
                const name = getStateName(geo);
                const normName = normalizeForMatch(name);
                const isSelected =
                  highlightedState &&
                  normalizeForMatch(highlightedState) === normName;
                const isHovered = hoveredState === name;

                return (
                  <Geography
                    key={(geo as Record<string, unknown>).rsmKey as string}
                    geography={geo}
                    fill={isSelected ? "#F5A623" : getStateFill(name)}
                    stroke={isSelected ? "#FBBF24" : isHovered ? "#F5A623" : "#0B1526"}
                    strokeWidth={isSelected ? 2 : isHovered ? 1.5 : 0.5}
                    onMouseEnter={(evt: React.MouseEvent<SVGPathElement>) =>
                      handleMouseEnter(geo, evt)
                    }
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    onClick={() => handleClick(geo)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${name}: average score ${Math.round(getStateScore(name) ?? 0)}`}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleClick(geo);
                      }
                    }}
                    style={{
                      default: {
                        outline: "none",
                        transition: "all 0.3s ease",
                      },
                      hover: {
                        outline: "none",
                        filter: "brightness(1.3)",
                        cursor: "pointer",
                      },
                      pressed: { outline: "none" },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>
      )}

      {/* Tooltip - flip sides when near edges */}
      {tooltip && (() => {
        const containerW = containerRef.current?.offsetWidth ?? 600;
        const containerH = containerRef.current?.offsetHeight ?? 500;
        const flipX = tooltip.x > containerW - 180;
        const flipY = tooltip.y > containerH - 70;
        return (
          <div
            className="absolute z-50 pointer-events-none bg-[#0D1B2E] border border-[#F5A623]/30 rounded-lg px-3 py-2 text-sm shadow-xl backdrop-blur-sm whitespace-nowrap"
            style={{
              left: flipX ? tooltip.x - 14 : tooltip.x + 14,
              top: flipY ? tooltip.y - 14 : tooltip.y + 14,
              transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`,
            }}
          >
            <div className="font-semibold text-white text-xs">{tooltip.name}</div>
            <div className="text-[#94A3B8] text-xs mt-0.5">
              Avg Score:{" "}
              <span className="text-[#F5A623] font-bold">
                {tooltip.score >= 0 ? tooltip.score : "N/A"}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Color legend */}
      <div className="absolute bottom-2 left-2 bg-[#0B1526]/80 backdrop-blur-sm rounded-lg p-2.5 border border-white/5">
        <p className="text-[8px] text-[#64748B] uppercase tracking-wider font-semibold mb-1.5">
          Avg Opportunity Score
        </p>
        <div
          className="w-24 h-2 rounded-full mb-1"
          style={{
            background: "linear-gradient(90deg, #1a1f35, #2d1f5e, #8b3a3a, #ef4444)",
          }}
        />
        <div className="flex justify-between text-[8px] text-[#64748B]">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>
    </div>
  );
}

export default memo(IndiaMap);
