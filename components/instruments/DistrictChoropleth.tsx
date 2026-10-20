"use client";

/**
 * The national district map.
 *
 * WHY IT IS DRAWN THIS WAY
 * ------------------------
 * Colour is the only thing most readers take from a map, so every choice about
 * it is a claim about the data:
 *
 *  - SEQUENTIAL, one hue, five quantile bins. These measures are heavily
 *    skewed - a handful of districts hold most of the population - so equal
 *    intervals would put six hundred districts in the lightest bin and paint
 *    the country one colour.
 *  - "No data" is a HATCH, never a ramp step. "We have no number for this
 *    place" and "this place scored lowest" are different facts, and a reader
 *    cannot be asked to tell them apart by shade.
 *  - The Scheduled Area layer is an OUTLINE, not a second fill. It is a legal
 *    status, not a magnitude; giving it a hue would put it in competition with
 *    the measure for the one channel the reader is already using.
 *  - Every district is focusable and activates with Enter, so the map is
 *    navigable by keyboard and not only by pointer.
 *  - The table below is rendered from the same numbers. A reader who cannot
 *    use the map, or who wants the value rather than the shade, loses nothing.
 */

import ScrollRegion from "./ScrollRegion";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
// The shared record type. A private copy here was structurally identical, so
// the caller could only pass its own (also private) copy through a cast.
import type { DistrictRecord } from "@/lib/instruments/types";

/** One feature as react-simple-maps hands it back: the GeoJSON feature plus
 *  the stable key the library adds. */
type RsmGeography = Record<string, unknown> & {
  rsmKey: string;
  id?: number;
  properties?: { code?: number };
};
import {
  NO_DATA,
  quantileBins,
  colorFor,
  formatValue,
  type Bin,
} from "@/lib/instruments/choropleth";

const GEO_URL = "/geo/districts-2011.geojson";
const INK = "#1c1c19";
const PAPER = "#fcf9f4";


/** The part of a registry measure the map reads. */
export interface MeasureSpec {
  label: string;
  unit?: string;
  definition?: string;
  group?: string;
}

interface Props {
  districts: Record<string, DistrictRecord>;
  measures: Record<string, MeasureSpec>;
  /** censuscode to Scheduled Area status, for the outline overlay. */
  scheduled?: Record<string, string>;
  /**
   * Census codes that HAVE a district page.
   *
   * Only the 620 districts holding at least one proposal are generated, so
   * linking all 640 rows of this table produced 20 hrefs that 404 - Kohima,
   * Dimapur, Kinnaur and seventeen more, fourteen of them in the North East.
   * The sibling table on the same page already dropped zero-proposal rows;
   * this one linked them. The rows stay, because the measure is published for
   * every district and the map draws all 640; it is the LINK that is wrong.
   *
   * Omitted means "caller did not say", and every district stays linkable.
   */
  hasPage?: number[];
  /** Measure keys offered in the switcher, in order. */
  options: string[];
  initial?: string;
}

interface Hover {
  name: string;
  state: string;
  value: number | null;
  x: number;
  y: number;
}

export default function DistrictChoropleth({
  districts,
  measures,
  scheduled = {},
  hasPage,
  options,
  initial,
}: Props) {
  const [measureKey, setMeasureKey] = useState(initial ?? options[0]);
  const [showScheduled, setShowScheduled] = useState(true);
  // The boundary file, as the map library receives it. Typed rather than
  // `unknown` so it reaches <Geographies> without a cast.
  const [geo, setGeo] = useState<Record<string, unknown> | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // Fetched, not imported. The boundaries are 366 KB gzipped and only this
  // component needs them; a static import would put them in the bundle of
  // every page that so much as links here.
  useEffect(() => {
    let live = true;
    fetch(GEO_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (live) setGeo(d);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const spec = measures[measureKey];

  const { bins, byCode } = useMemo(() => {
    const index = new Map<number, DistrictRecord>();
    const values: number[] = [];
    for (const d of Object.values(districts)) {
      index.set(Number(d.censuscode), d);
      const v = d.values?.[measureKey];
      if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    return { bins: quantileBins(values), byCode: index };
  }, [districts, measureKey]);

  const rows = useMemo(
    () =>
      Object.values(districts)
        .map((d) => ({
          code: Number(d.censuscode),
          name: d.district_name,
          state: d.state_name,
          value: (d.values?.[measureKey] ?? null) as number | null,
          sa: scheduled[String(d.censuscode)] ?? "unknown",
        }))
        .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity)),
    [districts, measureKey, scheduled],
  );

  const linkable = useMemo(() => (hasPage ? new Set(hasPage) : null), [hasPage]);
  const canOpen = (code: number) => !linkable || linkable.has(code);

  const go = (code: number) => {
    if (!canOpen(code)) return;
    window.location.href = `/instruments/consent/district/${code}`;
  };

  // One stop in the tab order for the whole graphic, with the table named as
  // the way to move through it. A reader who tabs here is told what it is and
  // where to go next, rather than being dropped into 640 shapes.
  const mapLabel =
    `Map of ${rows.length} districts by ${spec?.label ?? measureKey}. ` +
    `Use the table below this map to move through the districts and open one.`;

  return (
    <section className="mb-16">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-5">
        <div>
          <h2 className="font-headline text-[26px] leading-tight">
            {spec?.label ?? measureKey}
          </h2>
          {spec?.definition ? (
            <p className="font-body text-[13px] leading-relaxed opacity-65 max-w-2xl mt-1">
              {spec.definition}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="font-label text-[9px] uppercase tracking-[0.2em] opacity-70 block mb-1">
              Measure
            </span>
            <select
              value={measureKey}
              onChange={(e) => setMeasureKey(e.target.value)}
              className="bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2 font-body text-[13.5px]"
            >
              {options.map((k) => (
                <option key={k} value={k}>
                  {measures[k]?.label ?? k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              checked={showScheduled}
              onChange={(e) => setShowScheduled(e.target.checked)}
            />
            <span className="font-body text-[13px]">Outline Scheduled Areas</span>
          </label>
        </div>
      </div>

      <div
        ref={wrap}
        className="relative border border-[#1c1c19] bg-[#fcf9f4]"
        tabIndex={0}
        role="group"
        aria-label={mapLabel}
      >
        {failed ? (
          <p className="font-body text-[13.5px] p-6 opacity-70">
            The district boundaries could not be loaded. Every number the map
            would have shown is in the table below.
          </p>
        ) : !geo ? (
          <p className="font-body text-[13px] p-6 opacity-70">
            Loading district boundaries&hellip;
          </p>
        ) : (
          <ComposableMap
            projection="geoMercator"
            // Measured, not guessed: at scale 900 the country filled 459 of
            // 760 units and sat with 300 units of empty canvas around it.
            projectionConfig={{ scale: 1320, center: [82.5, 22.4] }}
            width={760}
            height={820}
            style={{ width: "100%", height: "auto" }}
          >
            <defs>
              <pattern
                id="nodata-hatch"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" fill={NO_DATA} />
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="6"
                  stroke="#b9b2a6"
                  strokeWidth="1.4"
                />
              </pattern>
            </defs>
            <Geographies geography={geo}>
              {({ geographies }: { geographies: RsmGeography[] }) =>
                geographies.map((g) => {
                  const gg = g;
                  const code = Number(gg.properties?.code ?? gg.id);
                  const rec = byCode.get(code);
                  const value = (rec?.values?.[measureKey] ?? null) as
                    | number
                    | null;
                  const hasValue =
                    typeof value === "number" && Number.isFinite(value);
                  const sa = scheduled[String(code)];
                  const isScheduled = sa === "within" || sa === "partial";
                  const fill = hasValue
                    ? colorFor(value, bins)
                    : "url(#nodata-hatch)";
                  return (
                    <Geography
                      key={gg.rsmKey}
                      geography={g}
                      // NOT individually focusable. 640 tab stops is not
                      // "keyboard navigable" - it is 640 presses of Tab before
                      // a keyboard user can reach anything after the map, with
                      // no way to skip. The keyboard path is the table below,
                      // which carries the same numbers and is a list of real
                      // links. The shapes stay labelled for a screen reader
                      // reading the graphic, and clickable for a pointer.
                      //
                      // tabIndex={-1} is what actually achieves that, and it
                      // is NOT redundant. react-simple-maps hardcodes
                      // `tabIndex: "0"` on the path it renders
                      // (dist/index.es.js:520) and spreads caller props AFTER
                      // it, so the default is opt-OUT and saying nothing here
                      // meant the comment above described an intention the
                      // page did not implement: measured on the register page,
                      // 640 of 640 paths carried tabindex="0" and the document
                      // had 1,340 tab stops.
                      role="img"
                      tabIndex={-1}
                      aria-label={
                        `${rec?.district_name ?? code}, ${rec?.state_name ?? ""}. ` +
                        `${spec?.label ?? measureKey}: ${formatValue(value, spec?.unit)}` +
                        // Only when the overlay is on. role="img" names the
                        // GRAPHIC, and announcing an outline that is not drawn
                        // describes a different picture to the one on screen.
                        (showScheduled && isScheduled
                          ? ". Wholly or partly in a Scheduled Area"
                          : "")
                      }
                      onMouseEnter={(e: React.MouseEvent) => {
                        const b = wrap.current?.getBoundingClientRect();
                        setHover({
                          name: rec?.district_name ?? String(code),
                          state: rec?.state_name ?? "",
                          value,
                          x: e.clientX - (b?.left ?? 0),
                          y: e.clientY - (b?.top ?? 0),
                        });
                      }}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() =>
                        setHover({
                          name: rec?.district_name ?? String(code),
                          state: rec?.state_name ?? "",
                          value,
                          x: 12,
                          y: 12,
                        })
                      }
                      onBlur={() => setHover(null)}
                      onClick={() => go(code)}
                      style={{
                        default: {
                          fill,
                          stroke:
                            showScheduled && isScheduled
                              ? INK
                              : "rgba(28,28,25,0.22)",
                          strokeWidth: showScheduled && isScheduled ? 0.9 : 0.3,
                          outline: "none",
                        },
                        hover: {
                          fill,
                          stroke: INK,
                          strokeWidth: 1.2,
                          outline: "none",
                          // Only where the click goes somewhere. A pointer
                          // cursor is the standard promise that a shape is
                          // clickable, and go() silently returns for the 20
                          // districts with no page - so the map invited the
                          // click and swallowed it, which reads as broken
                          // rather than as "nothing is filed here".
                          cursor: canOpen(code) ? "pointer" : "default",
                        },
                        pressed: { fill, outline: "none" },
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ComposableMap>
        )}

        {hover ? (
          <div
            className="pointer-events-none absolute z-10 bg-[#1c1c19] text-[#fcf9f4] px-3 py-2"
            style={{
              // Against the wrapper's actual width. A hardcoded ceiling was
              // measured on one layout and pinned the tooltip halfway across
              // the map on any wider one.
              left: Math.min(
                hover.x + 12,
                Math.max((wrap.current?.clientWidth ?? 600) - 280, 8),
              ),
              top: hover.y + 12,
              maxWidth: 260,
            }}
          >
            <div className="font-label text-[9px] uppercase tracking-[0.18em] opacity-70">
              {hover.state}
            </div>
            <div className="font-body text-[13.5px] leading-snug">
              {hover.name}
            </div>
            <div className="font-body text-[13px] opacity-85">
              {spec?.label}: {formatValue(hover.value, spec?.unit)}
            </div>
          </div>
        ) : null}
      </div>

      <Legend bins={bins} unit={spec?.unit} showScheduled={showScheduled} />

      <details className="mt-6">
        <summary className="font-label text-[10px] uppercase tracking-[0.18em] cursor-pointer">
          The same numbers, as a table &mdash; and the way to reach a district
          by keyboard
        </summary>
        <ScrollRegion label={`${spec?.label ?? "Measure"} by district`} className="mt-3 max-h-[420px] overflow-auto border border-[#1c1c19]/25">
          <table className="w-full font-body text-[13px]">
            <caption className="sr-only">
              {spec?.label} by district, highest first. All {rows.length}{" "}
              districts, nothing truncated.
            </caption>
            <thead className="sticky top-0 bg-[#fcf9f4]">
              <tr className="border-b border-[#1c1c19]">
                <th scope="col" className="text-left px-3 py-2">
                  District
                </th>
                <th scope="col" className="text-left px-3 py-2">
                  State
                </th>
                <th scope="col" className="text-right px-3 py-2">
                  {spec?.label}
                </th>
                <th scope="col" className="text-left px-3 py-2">
                  Scheduled Area
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="border-b border-[#1c1c19]/12">
                  <td className="px-3 py-1.5">
                    {canOpen(r.code) ? (
                      <Link prefetch={false}
                        href={`/instruments/consent/district/${r.code}`}
                        className="underline underline-offset-2"
                      >
                        {r.name}
                      </Link>
                    ) : (
                      // No proposal has been filed here, so no page exists to
                      // open. The Census figures are real and the row stays.
                      <span title="No proposal has been filed here, so this district has no page">
                        {r.name}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 opacity-70">{r.state}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatValue(r.value, spec?.unit)}
                  </td>
                  <td className="px-3 py-1.5 opacity-70">
                    {r.sa === "within"
                      ? "Wholly"
                      : r.sa === "partial"
                      ? "Partly"
                      : r.sa === "outside"
                      ? "Outside"
                      : "Not determined"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </details>
    </section>
  );
}

function Legend({
  bins,
  unit,
  showScheduled,
}: {
  bins: Bin[];
  unit?: string;
  showScheduled: boolean;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-2">
        <span className="font-label text-[9px] uppercase tracking-[0.18em] opacity-70">
          Low
        </span>
        <div className="flex">
          {bins.map((b, i) => (
            <div key={i} className="flex flex-col items-center">
              {/* A 2px surface gap between fills, so adjacent steps read as
                  separate swatches rather than one continuous smear. */}
              {/* 36px below `sm`, 48px above. Five 48px swatches with their
                  end labels need 314px, and a 320px phone has 272px inside
                  the page padding, so the legend pushed the whole page into a
                  sideways scroll. 36px still clears the widest value label
                  ("98.6%") at this size. */}
              <div
                className="w-9 sm:w-12 h-3"
                style={{
                  background: b.color,
                  marginRight: i < bins.length - 1 ? 2 : 0,
                }}
              />
              <span className="font-body text-[10px] opacity-75 mt-1 tabular-nums">
                {formatValue(b.max, unit)}
              </span>
            </div>
          ))}
        </div>
        <span className="font-label text-[9px] uppercase tracking-[0.18em] opacity-70">
          High
        </span>
      </div>

      <div className="flex items-center gap-2">
        <svg width="18" height="12" aria-hidden="true">
          <rect width="18" height="12" fill={NO_DATA} />
          <line
            x1="0"
            y1="12"
            x2="18"
            y2="0"
            stroke="#b9b2a6"
            strokeWidth="1.4"
          />
        </svg>
        <span className="font-body text-[12px] opacity-70">
          No value recorded
        </span>
      </div>

      {showScheduled ? (
        <div className="flex items-center gap-2">
          <svg width="18" height="12" aria-hidden="true">
            <rect
              x="0.7"
              y="0.7"
              width="16.6"
              height="10.6"
              fill={PAPER}
              stroke={INK}
              strokeWidth="1.4"
            />
          </svg>
          <span className="font-body text-[12px] opacity-70">
            Wholly or partly in a Scheduled Area
          </span>
        </div>
      ) : null}
    </div>
  );
}
