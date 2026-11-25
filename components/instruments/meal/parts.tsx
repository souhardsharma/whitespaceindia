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
    <p className={`font-body text-[13.5px] leading-relaxed border-l-4 pl-4 py-1 ${className}`} style={{ borderColor: TEAL }}>
      <strong className="font-semibold">A flag, not a finding.</strong>{" "}
      A flag marks two figures a school filed on the same government system
      that do not agree. A wrong enrolment filing, a typing slip or a meal
      served to children from another school can each produce one. It does not
      show that anything improper happened.
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
