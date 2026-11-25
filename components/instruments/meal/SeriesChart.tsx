"use client";

/**
 * What schools reported day by day, over any span from weeks to years.
 *
 * The drawing is stretched to its box (the marks are plain rectangles and
 * stepped outlines, which survive that) and every word on it is HTML laid
 * over the box, so type keeps its size at every width. A day with no report
 * is an empty place on the axis in both drawings: bars leave it blank and
 * the area stops and starts again. All of that arithmetic is in
 * lib/instruments/mealChart.ts.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { SMALL_LABEL } from "@/components/instruments/meal/parts";
import { TEAL, dayShort, weekday, type DayRow } from "@/lib/instruments/meal";
import {
  blankSpans, calendar, defaultRange, formatValue, inRange, monthTicks, rangesFor, readout,
  segments, stepPath, summary, valueOf, yAxis, type ChartMeasure, type ChartRange,
} from "@/lib/instruments/mealChart";

const INK = "#1c1c19";
/** Above this many days a bar is too thin to read and the area is drawn. */
const BAR_DAYS = 120;
const BOX = { width: 1000, base: 100, ceiling: 14 };
const RANGE_LABELS: Record<ChartRange, string> = { "90d": "Last 90 days", "12m": "Last 12 months", all: "Everything" };
const BLANK_LABEL = "no reports on the system";
const BUTTON = "tap-target font-label text-[10px] uppercase tracking-[0.16em] border px-3 transition-colors";

function Choice({ pressed, onPress, children }: { pressed: boolean; onPress: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      className={BUTTON}
      style={{ borderColor: TEAL, background: pressed ? TEAL : "transparent", color: pressed ? "#fcf9f4" : INK }}
    >
      {children}
    </button>
  );
}

export default function SeriesChart({
  series, label, mealsLabel, shareLabel, blanks = [], marked, height = 200,
}: {
  series: DayRow[];
  /** What the drawing is, for a reader who cannot see it. */
  label: string;
  /** The registry's labels for the two measures. */
  mealsLabel: string;
  shareLabel: string;
  /** Date ranges in which the whole system held no record. */
  blanks?: [string, string][];
  /** Days drawn in ink: flagged days. */
  marked?: Set<string>;
  height?: number;
}) {
  const all = useMemo(() => calendar(series), [series]);
  const [measure, setMeasure] = useState<ChartMeasure>("meals");
  const [range, setRange] = useState<ChartRange>(() => defaultRange(all.length));
  const [picked, setPicked] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  // The reveal plays with the first paint, and again at each change of view.
  const [plays, setPlays] = useState(1);
  const [armed, setArmed] = useState(false);
  const plot = useRef<HTMLDivElement>(null);

  const days = useMemo(() => inRange(all, range), [all, range]);
  const values = useMemo(() => days.map((d) => valueOf(d.row, measure)), [days, measure]);
  const dates = useMemo(() => days.map((d) => d.day), [days]);
  const ranges = rangesFor(all.length);

  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const sized = new ResizeObserver(() => setWidth(el.clientWidth));
    sized.observe(el);
    // A chart on screen has drawn itself in with the page. One still below
    // the screen is covered now and draws itself in as it arrives.
    if (el.getBoundingClientRect().top < window.innerHeight) return () => sized.disconnect();
    setArmed(true);
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      setArmed(false);
      setPlays((n) => n + 1);
      seen.disconnect();
    }, { threshold: 0.15 });
    seen.observe(el);
    return () => {
      sized.disconnect();
      seen.disconnect();
    };
  }, []);

  if (!days.length) return null;

  const n = days.length;
  const shown = Math.min(picked ?? n - 1, n - 1);
  const axis = yAxis(Math.max(0, ...values.map((v) => v ?? 0)), measure);
  const box = { ...BOX, top: axis.top };
  const yOf = (v: number) => BOX.base - (v / axis.top) * (BOX.base - BOX.ceiling);
  const slot = BOX.width / n;
  const bars = n <= BAR_DAYS;
  const runs = bars ? [] : segments(values);
  const ticks = monthTicks(dates, Math.min(12, Math.max(2, Math.floor(width / 76))));
  const spans = blankSpans(dates, blanks);
  const measureLabel = measure === "meals" ? mealsLabel : shareLabel;

  function view(change: () => void) {
    change();
    setPicked(null);
    setArmed(false);
    setPlays((p) => p + 1);
  }

  function pick(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    setPicked(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * n))));
  }

  function step(e: KeyboardEvent<HTMLDivElement>) {
    const to = { ArrowLeft: shown - 1, ArrowRight: shown + 1, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    setPicked(Math.min(n - 1, Math.max(0, to)));
  }

  return (
    <figure className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 mb-4">
        <div role="group" aria-label="Figure shown" className="flex flex-wrap gap-2">
          <Choice pressed={measure === "meals"} onPress={() => view(() => setMeasure("meals"))}>{mealsLabel}</Choice>
          <Choice pressed={measure === "share"} onPress={() => view(() => setMeasure("share"))}>{shareLabel}</Choice>
        </div>
        {ranges.length > 1 ? (
          <div role="group" aria-label="Span of days shown" className="flex flex-wrap gap-2">
            {ranges.map((r) => (
              <Choice key={r} pressed={range === r} onPress={() => view(() => setRange(r))}>{RANGE_LABELS[r]}</Choice>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={plot} className="relative w-full" style={{ height }}>
        <svg
          viewBox={`0 0 ${BOX.width} ${BOX.base}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${measureLabel}. ${label}.`}
          className="absolute inset-0 w-full h-full block"
        >
          {spans.map(([a, b]) => (
            <rect key={a} x={a * slot} y={BOX.ceiling} width={(b - a + 1) * slot} height={BOX.base - BOX.ceiling} fill={INK} fillOpacity="0.08" />
          ))}
          {axis.lines.map((v) => (
            <line key={v} x1="0" x2={BOX.width} y1={yOf(v)} y2={yOf(v)} stroke={INK} strokeOpacity="0.14" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1="0" x2={BOX.width} y1={BOX.base - 0.25} y2={BOX.base - 0.25} stroke={INK} strokeOpacity="0.35" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {ticks.map((t) => (
            <line key={t.index} x1={t.index * slot} x2={t.index * slot} y1={BOX.base - 3} y2={BOX.base} stroke={INK} strokeOpacity="0.35" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>

        <div
          key={plays}
          className={`absolute inset-0 ${armed ? "meal-reveal-armed" : "meal-reveal"}`}
          aria-hidden="true"
        >
          <svg viewBox={`0 0 ${BOX.width} ${BOX.base}`} preserveAspectRatio="none" className="w-full h-full block">
            {bars ? values.map((v, i) => (v === null ? null : (
              <rect
                key={dates[i]}
                x={i * slot + slot * 0.12}
                y={Math.min(yOf(v), BOX.base - 2)}
                width={slot * 0.76}
                height={BOX.base - 0.5 - Math.min(yOf(v), BOX.base - 2)}
                fill={marked?.has(dates[i]) ? INK : TEAL}
                fillOpacity={weekday(dates[i]) === "Sunday" && !marked?.has(dates[i]) ? 0.55 : 1}
              />
            ))) : (
              <>
                {runs.map((run) => (
                  <path key={run[0]} d={stepPath(values, run, box, true)} fill={TEAL} fillOpacity="0.28" />
                ))}
                {runs.map((run) => (
                  <path key={run[0]} d={stepPath(values, run, box, false)} fill="none" stroke={TEAL} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
                ))}
                {values.map((v, i) => (v !== null && marked?.has(dates[i]) ? (
                  <rect key={dates[i]} x={i * slot} y={yOf(v)} width={Math.max(slot, 1.5)} height={BOX.base - yOf(v)} fill={INK} />
                ) : null))}
              </>
            )}
          </svg>
        </div>

        <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
          {axis.lines.map((v) => (
            <span
              key={v}
              className="absolute left-0 -translate-y-full font-label text-[9px] tracking-[0.08em] tabular-nums pr-1 bg-[#fcf9f4] text-[#1c1c19]/70"
              style={{ top: `${yOf(v)}%` }}
            >
              {measure === "meals" ? formatValue(v, measure) : `${v}%`}
            </span>
          ))}
          {spans.length && ((spans[0][1] - spans[0][0] + 1) / n) * width >= 190 ? (
            <span
              className={`${SMALL_LABEL} absolute -translate-x-1/2 whitespace-nowrap`}
              style={{ left: `${((spans[0][0] + spans[0][1] + 1) / 2 / n) * 100}%`, top: `${BOX.ceiling + 4}%` }}
            >
              {BLANK_LABEL}
            </span>
          ) : null}
          {picked !== null ? (
            <span
              className="absolute top-0 bottom-0 w-px"
              style={{ left: `${((shown + 0.5) / n) * 100}%`, background: INK, opacity: 0.6 }}
            />
          ) : null}
        </div>

        <div
          role="slider"
          tabIndex={0}
          aria-label="Day to read out below the chart"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={shown}
          aria-valuetext={readout(days[shown])}
          onPointerDown={pick}
          onPointerMove={pick}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") setPicked(null); }}
          onKeyDown={step}
          className="absolute inset-0 cursor-crosshair focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1c1c19]"
          style={{ touchAction: "pan-y" }}
        />
      </div>

      <div aria-hidden="true" className={`${SMALL_LABEL} relative h-4 mt-1.5 overflow-hidden`}>
        {ticks.map((t) => (
          <span key={t.index} className="absolute top-0 whitespace-nowrap" style={{ left: `${(t.index / n) * 100}%` }}>
            {t.label}
          </span>
        ))}
      </div>

      <figcaption>
        <p className={`${SMALL_LABEL} flex flex-wrap justify-between gap-x-4 gap-y-1 mt-1`}>
          <span>{dayShort(dates[0])}</span>
          {bars && dates.some((d, i) => values[i] !== null && weekday(d) === "Sunday") ? <span>Paler bars are Sundays</span> : null}
          <span>{dayShort(dates[n - 1])}</span>
        </p>
        <p className="font-body text-[13px] leading-normal tabular-nums mt-3 pt-3 border-t border-[#1c1c19]/20 min-h-[4.5rem] sm:min-h-[3.25rem]">
          {readout(days[shown])}
        </p>
        <p className="sr-only">{summary(days, measure, measureLabel)}</p>
      </figcaption>
    </figure>
  );
}
