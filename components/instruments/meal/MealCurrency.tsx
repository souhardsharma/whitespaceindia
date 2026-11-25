/**
 * When the meal reporting system was last read, and for which day.
 *
 * Stated once, in the instrument's footer, beside every figure the pages
 * show. It names two dates because they differ by design: the nightly run
 * covers YESTERDAY, since schools file through the afternoon and a same-day
 * read shows a day that is still arriving.
 */
import freshnessJson from "@/public/data/instruments/meal-claims/freshness.json";
import { dayShort, nightNote, whenIST, type MealFreshness } from "@/lib/instruments/meal";

export default function MealCurrency({ className = "" }: { className?: string }) {
  const f = freshnessJson as MealFreshness;
  const when = whenIST(f.checked_at);

  if (!when) {
    return (
      <div className={`font-label text-[9px] uppercase tracking-[0.18em] ${className}`}>
        <span className="opacity-70">Time of last read of the meal reporting system unknown</span>
      </div>
    );
  }

  const note = nightNote(f);
  return (
    <div className={`font-label text-[9px] uppercase tracking-[0.18em] ${className}`}>
      <span className="opacity-70">Meal reporting system last read </span>
      <span className="opacity-80">{when} IST</span>
      {f.day ? <span className="opacity-80"> &middot; reports up to {dayShort(f.day)}</span> : null}
      <span className="opacity-80"> &middot; school tables are read as a sample</span>
      {note ? <span className="opacity-80"> &middot; {note}</span> : null}
    </div>
  );
}
