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

const colorScale = scaleLinear<string>()
  .domain([0, 25, 50, 75])
  .range(["#f0ede8", "#e0bfb9", "#BD402C", "#9b2817"])
  .clamp(true);

interface Props {
  districtScores: Record<string, number>;
  onStateClick?: (stateName: string) => void;
  highlightedState?: string | null;
}

interface TooltipData {
  name: string;
  score: number | null;
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

  const scoreLookup = useMemo(() => {
    const lookup: Record<string, number> = {};
    for (const [k, v] of Object.entries(districtScores)) {
      lookup[normalizeForMatch(k)] = v;
    }
    return lookup;
  }, [districtScores]);

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
      if (score === null) return "#f0ede8";
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
        score: score !== null ? Math.round(score) : null,
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
      className="relative w-full bg-[#fcf9f4]"
      style={{ aspectRatio: "3/4", maxHeight: "560px" }}
      role="img"
      aria-label="Map of India showing average Philanthropic Opportunity Scores by state"
    >
      {!geoData ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-[#BD402C] border-t-transparent animate-spin" />
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
                    fill={isSelected ? "#BD402C" : getStateFill(name)}
                    stroke={isSelected ? "#1c1c19" : isHovered ? "#1c1c19" : "#1c1c19"}
                    strokeWidth={isSelected ? 1.5 : isHovered ? 1.2 : 0.4}
                    onMouseEnter={(evt: React.MouseEvent<SVGPathElement>) =>
                      handleMouseEnter(geo, evt)
                    }
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    onClick={() => handleClick(geo)}
                    style={{
                      default: {
                        outline: "none",
                        transition: "all 0.2s ease",
                      },
                      hover: {
                        outline: "none",
                        filter: "brightness(0.92)",
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

      {/* Tooltip */}
      {tooltip && (() => {
        const containerW = containerRef.current?.offsetWidth ?? 600;
        const containerH = containerRef.current?.offsetHeight ?? 500;
        const flipX = tooltip.x > containerW - 200;
        const flipY = tooltip.y > containerH - 90;
        return (
          <div
            className="absolute z-50 pointer-events-none bg-[#1c1c19] text-[#fcf9f4] px-4 py-3 whitespace-nowrap"
            style={{
              left: flipX ? tooltip.x - 12 : tooltip.x + 12,
              top: flipY ? tooltip.y - 12 : tooltip.y + 12,
              transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`,
            }}
          >
            <div className="font-label text-[10px] uppercase tracking-[0.25em] text-[#fcf9f4]/60 mb-1">
              {tooltip.name}
            </div>
            <div className="font-label text-[11px] uppercase tracking-widest">
              Avg Score:{" "}
              <span className="text-[#BD402C] font-bold tracking-tighter">
                {tooltip.score !== null ? tooltip.score : "N/A"}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Coordinates */}
      <div className="absolute top-4 right-4 text-right pointer-events-none">
        <p className="font-label text-[9px] uppercase tracking-[0.3em] text-[#1c1c19]/40 mb-1">
          Coordinates
        </p>
        <p className="font-label text-[10px] tracking-widest text-[#1c1c19]/70">
          20.59° N, 78.96° E
        </p>
      </div>

      {/* Color legend */}
      <div className="absolute bottom-4 left-4 bg-[#fcf9f4] border border-[#1c1c19] p-4 w-52">
        <p className="font-label text-[9px] uppercase tracking-[0.3em] text-[#1c1c19] mb-3 font-bold">
          Avg Opportunity Score
        </p>
        <div
          className="h-2 w-full"
          style={{
            background: "linear-gradient(90deg, #f0ede8, #e0bfb9, #BD402C, #9b2817)",
          }}
        />
        <div className="flex justify-between mt-2 font-label text-[9px] tracking-widest text-[#1c1c19]/70">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>
    </div>
  );
}

export default memo(IndiaMap);
