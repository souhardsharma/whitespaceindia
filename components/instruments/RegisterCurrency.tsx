/**
 * When the register was last read, stated wherever a register-derived figure
 * is shown.
 *
 * WHY THIS EXISTS
 * ---------------
 * The source is live and the page said so - "Live register" - with nothing
 * behind the claim. A reader could not tell a figure read this morning from
 * one read three weeks ago, and the label asserted currency either way. A
 * dataset that looks current and is not is worse than one that admits its age,
 * because only the second lets a reader decide whether to trust it.
 *
 * It also carries whether the last check COVERED the whole register. The sync
 * holds its watermark when a sector fails or a backfill aborts, so a partial
 * night is a real and expected state; showing the timestamp without it would
 * put a confident date on an incomplete read.
 */
import freshnessJson from "@/public/data/instruments/consent/freshness.json";

type Freshness = {
  checked_at?: string;
  complete?: boolean;
  sectors_unreachable?: number;
};

const IST = "Asia/Kolkata";

function whenIST(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // IST, because the register is an Indian government source and its own
  // timestamps are read in IST. A reader here should not have to convert.
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST,
  }).format(d);
}

export default function RegisterCurrency({
  fallbackFetchedAt,
  className = "",
}: {
  /** meta.sources[].fetched for the register, used until a sync has run. */
  fallbackFetchedAt?: string;
  className?: string;
}) {
  const f = (freshnessJson ?? {}) as Freshness;
  const when = whenIST(f.checked_at) ?? whenIST(fallbackFetchedAt);

  // No date is itself a fact about the data, and the honest thing is to say
  // so. Returning null removed the whole statement, so a page with an unknown
  // read time looked exactly like a page that never made the claim - the
  // reader loses the currency line and never learns it was missing.
  if (!when) {
    return (
      <div className={`font-label text-[9px] uppercase tracking-[0.18em] ${className}`}>
        <span className="opacity-70">Register read time unavailable</span>
      </div>
    );
  }

  const partial = f.checked_at != null && f.complete === false;
  const unreachable = f.sectors_unreachable ?? 0;

  return (
    <div className={`font-label text-[9px] uppercase tracking-[0.18em] ${className}`}>
      <span className="opacity-70">Register read </span>
      <span className="opacity-80">{when} IST</span>
      {partial ? (
        <span className="opacity-80">
          {" "}&middot; partial check
          {unreachable > 0
            ? `, ${unreachable} sector${unreachable === 1 ? "" : "s"} unreachable`
            : ""}
        </span>
      ) : null}
    </div>
  );
}
