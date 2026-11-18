/**
 * Whether the footer may say the register was read only in part.
 *
 * freshness.json carries two flags. `complete` is the whole night: it turns
 * false when any per-proposal pass (application forms, appraisal histories)
 * ran out of time, even after every register sector was read. Read by the
 * footer, it printed "read incompletely" under a full ten-sector sweep
 * (2026-11-17). `register_complete` is the register alone - every sector, a
 * full sweep - and is what a sentence about the register may rest on. A file
 * written before that field existed falls back to `complete`.
 */
export type Freshness = {
  checked_at?: string;
  complete?: boolean;
  register_complete?: boolean;
  sectors_unreachable?: number;
};

export function registerReadInPart(f: Freshness): boolean {
  if (f.checked_at == null) return false;
  const whole = typeof f.register_complete === "boolean" ? f.register_complete : f.complete;
  return whole === false;
}
