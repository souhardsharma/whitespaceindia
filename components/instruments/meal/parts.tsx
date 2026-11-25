/**
 * The small pieces every Meal Claims Check page is drawn from.
 *
 * No hooks: each is usable from a server page and from the school page that
 * assembles itself in the browser, so a flag reads the same in both.
 */
import {
  FLAG_KINDS, TEAL, count, dayShort, flagAfterword, flagSentence, weekday,
  type DayRow, type Flag, type Measure,
} from "@/lib/instruments/meal";
import { calendar, formatValue, segments, valueOf } from "@/lib/instruments/mealChart";

export const SECTION_HEADING = "font-label text-[11px] uppercase tracking-[0.24em] opacity-75";
export const SMALL_LABEL = "font-label text-[9px] uppercase tracking-[0.2em] opacity-70";
export const TH = "font-label text-[9px] uppercase tracking-[0.18em] opacity-70 font-normal text-left py-2.5 pr-4 align-bottom";
export const TD = "font-body text-[13.5px] py-2.5 pr-4 align-top tabular-nums";

export function Badge({ live = true }: { live?: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span
        className="font-label font-bold text-[11px] tracking-[0.2em] px-2 py-1"
        style={{ background: TEAL, color: "#fcf9f4" }}
      >
        02
      </span>
      <span className="font-label text-[10px] uppercase tracking-[0.22em]" style={{ color: TEAL }}>
        Instrument{live ? " · Live" : ""}
      </span>
    </div>
  );
}

/** A figure under the registry's own label for it, with the registry's
 *  definition a hover or a screen reader away. */
export function Stat({
  measure, value, note,
}: {
  measure: Measure;
  value: string;
  note?: string;
}) {
  return (
    <div>
      <dt className={SMALL_LABEL} title={measure.definition}>{measure.label}</dt>
      <dd
        className="font-label font-bold text-[clamp(22px,2.6vw,32px)] leading-none mt-1.5 tabular-nums"
        style={{ color: TEAL }}
      >
        {value}
      </dd>
      {note ? <dd className="font-body text-[12px] opacity-70 mt-1.5 leading-snug">{note}</dd> : null}
    </div>
  );
}

/** The sentence that travels with every list of flags. */
export function FlagNotFinding({ className = "" }: { className?: string }) {
  return (
    <p className={`font-body text-[13.5px] leading-relaxed border-y py-3 ${className}`} style={{ borderColor: TEAL }}>
      <strong className="font-semibold">A flag marks a school-day on which the
      school filed two figures on one government system that disagree.</strong>{" "}
      A wrong enrolment filing or a typing slip can be enough to cause one, as
      can meals served to children enrolled at another school, so what
      lies behind a flag is for the school&rsquo;s block office or an
      auditor to establish.
    </p>
  );
}

export function KindTag({ kind, wide }: { kind: Flag["kind"]; wide?: boolean }) {
  return (
    <span
      className="inline-block font-label text-[9px] uppercase tracking-[0.16em] px-1.5 py-0.5 border whitespace-nowrap"
      style={{ borderColor: TEAL, color: TEAL }}
    >
      {FLAG_KINDS[kind].short}{kind === "over" && wide ? " · wide" : ""}
    </span>
  );
}

/** One flag, in full: the day, the kind, the figures, and what became of it. */
export function FlagEntry({ flag }: { flag: Flag }) {
  const after = flagAfterword(flag);
  return (
    <li className={`py-4 border-b border-[#1c1c19]/15 ${flag.standing ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-label font-bold text-[13px] tabular-nums">{dayShort(flag.day)}</span>
        <KindTag kind={flag.kind} wide={flag.wide} />
        <span className={SMALL_LABEL}>first seen {dayShort(flag.first)}</span>
      </div>
      <p className="font-body text-[14px] leading-relaxed mt-2 max-w-3xl">{flagSentence(flag)}</p>
      {after ? <p className="font-body text-[13px] leading-relaxed mt-1.5 max-w-3xl italic">{after}</p> : null}
    </li>
  );
}

/**
 * Meals reported per day, as bars. A day with no report is drawn as a gap on
 * the baseline and never as a zero-height bar in ink: a blank is the source's
 * silence, not a count of nothing served.
 */
export function DayBars({
  series, flagged = new Set<string>(), height = 96, label,
}: {
  series: DayRow[] | [string, number | null][];
  flagged?: Set<string>;
  height?: number;
  label: string;
}) {
  const rows = series.map((r) => ({ day: r[0], meals: r.length === 4 ? r[3] : r[1] }));
  const max = Math.max(1, ...rows.map((r) => r.meals ?? 0));
  const w = 100 / Math.max(1, rows.length);
  // Bars rise one after another, and the last starts within 400 ms however
  // many there are, so the whole entrance is over in 900 ms.
  const stagger = Math.min(14, 400 / Math.max(1, rows.length));
  return (
    <figure>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        className="w-full block"
        style={{ height }}
      >
        <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} stroke="#1c1c19" strokeOpacity="0.35" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {rows.map((r, i) => {
          const h = r.meals ? Math.max(1.5, (r.meals / max) * (height - 6)) : 0;
          return h ? (
            <rect
              key={r.day}
              x={i * w + w * 0.12}
              y={height - 1 - h}
              width={w * 0.76}
              height={h}
              fill={flagged.has(r.day) ? "#1c1c19" : TEAL}
              fillOpacity={weekday(r.day) === "Sunday" && !flagged.has(r.day) ? 0.55 : 1}
              className="meal-bar"
              style={{ animationDelay: `${Math.round(i * stagger)}ms` }}
            >
              <title>{`${dayShort(r.day)}: ${count(r.meals)} meals reported`}</title>
            </rect>
          ) : null;
        })}
      </svg>
      {rows.length ? (
        <figcaption className={`${SMALL_LABEL} flex flex-wrap justify-between gap-x-4 gap-y-1 mt-1.5`}>
          <span>{dayShort(rows[0].day)}</span>
          <span>Paler bars are Sundays</span>
          <span>{dayShort(rows[rows.length - 1].day)}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}

const SPARK_W = 96;
const SPARK_H = 22;

/**
 * The share of listed schools that reported, day by day, small enough for a
 * table cell. The line stops at a day with no report and starts again after
 * it; a day standing alone between two gaps is a short dash.
 */
export function Spark({ series, label }: { series: DayRow[]; label: string }) {
  const days = calendar(series);
  const values = days.map((d) => valueOf(d.row, "share"));
  const runs = segments(values);
  // read, but no school reported on any day: that is not the same as unread
  if (!runs.length) return <span className="opacity-60">{series.length ? "none reported" : "not read"}</span>;
  const first = runs[0][0];
  const last = runs[runs.length - 1][1];
  const x = (i: number) => (days.length > 1 ? (i / (days.length - 1)) * SPARK_W : SPARK_W / 2);
  const y = (v: number) => SPARK_H - 1.5 - (v / 100) * (SPARK_H - 3);
  const point = (i: number) => `${x(i).toFixed(1)},${y(values[i] ?? 0).toFixed(1)}`;
  const path = runs.map(([a, b]) => (a === b
    ? `M${(x(a) - 1).toFixed(1)},${y(values[a] ?? 0).toFixed(1)}h2`
    : `M${Array.from({ length: b - a + 1 }, (_, k) => point(a + k)).join("L")}`)).join("");
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      width={SPARK_W}
      height={SPARK_H}
      role="img"
      aria-label={`${label}: ${formatValue(values[first] ?? 0, "share")} on ${dayShort(days[first].day)}, ${
        formatValue(values[last] ?? 0, "share")} on ${dayShort(days[last].day)}`}
      className="inline-block align-middle"
    >
      <line x1="0" x2={SPARK_W} y1={SPARK_H - 0.5} y2={SPARK_H - 0.5} stroke="#1c1c19" strokeOpacity="0.25" strokeWidth="1" />
      <path d={path} fill="none" stroke={TEAL} strokeWidth="1.25" strokeLinejoin="miter" />
    </svg>
  );
}
