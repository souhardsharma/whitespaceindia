/**
 * Binning and colour for the district map.
 *
 * WHY THIS IS SEPARATE
 * --------------------
 * Which bin a district falls in decides what colour it is, and colour is the
 * only thing most readers will take from a map. That makes binning a claim
 * about the data, not a styling detail, so it is testable code rather than
 * something computed inline in a render.
 */

/**
 * Sequential ramp, one hue, light -> dark. Five steps.
 *
 * Validated with the dataviz validator against the light chart surface:
 * lightness monotone, adjacent dL >= 0.06, single hue (2 deg spread), and the
 * light end at 2.21:1 against the surface - so the lowest bin is never
 * mistaken for the page behind it. The hue is the instrument's own accent.
 *
 * NOT flipped for dark. The site is light-only (no darkMode in the Tailwind
 * config, no `dark:` classes anywhere); if that changes, a dark ramp has to be
 * re-stepped from #7a3b6b upward, because #4d1f46 sits at 1.33:1 on a dark
 * surface and would disappear into it.
 */
export const RAMP = ["#c9a0bf", "#ab74a0", "#8e5083", "#713468", "#4d1f46"];

/** Districts with no value for the chosen measure. A hatch, never a ramp step:
 *  "we have no number for this place" and "this place scored lowest" are
 *  different facts and must not share an encoding. */
export const NO_DATA = "#e8e4dd";

export interface Bin {
  min: number;
  max: number;
  color: string;
}

/**
 * Quantile bins over the values actually present.
 *
 * Quantile, not equal-interval: these measures are heavily skewed - a handful
 * of districts hold most of the population, and equal intervals would put 600
 * districts in the lightest bin and paint the country one colour. Quantile
 * spends the ramp where the districts are.
 *
 * Ties are not split across bins. Where many districts share a value - common
 * in count measures with a floor - a boundary is nudged rather than allowing
 * two districts with the SAME number to be drawn in different colours, which
 * is the one thing a reader would never expect.
 */
export function quantileBins(values: number[], steps = RAMP.length): Bin[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const edges: number[] = [];
  for (let i = 1; i < steps; i++) {
    const q = sorted[Math.floor((i / steps) * sorted.length)];
    if (edges.length === 0 || q > edges[edges.length - 1]) edges.push(q);
  }
  // The maximum closes the last bin - but ONLY if it is above the last edge.
  // Appending it unconditionally created a final bin whose min equalled its
  // max, and `colorFor` is upper-inclusive, so every value at that number was
  // already caught by the bin before it. The result was a legend swatch no
  // district could ever be drawn in: a colour the reader is invited to look
  // for on the map and will never find. It happens whenever the top of the
  // distribution is tied - a count measure where most districts sit at the
  // same high value - which is exactly the shape these measures have.
  const bounds = [sorted[0], ...edges];
  const top = sorted[sorted.length - 1];
  if (top > bounds[bounds.length - 1]) bounds.push(top);

  const bins: Bin[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    bins.push({
      min: bounds[i],
      max: bounds[i + 1],
      color: RAMP[Math.min(i, RAMP.length - 1)],
    });
  }

  // Everything collapsed to one bin: the values are tied hard enough that
  // quantiles cannot separate them, so the map has no variation to show. The
  // step is the MIDDLE of the ramp, not the lightest. A single-colour map in
  // RAMP[0] reads as "every district is low" and in RAMP[4] as "every district
  // is high", and both are claims the data has not made - the honest statement
  // is that this measure does not distinguish these districts, which the
  // legend's single swatch and its printed range say in words.
  if (bins.length === 1) {
    bins[0].color = RAMP[Math.floor(RAMP.length / 2)];
  }
  if (bins.length === 0) {
    return [{ min: sorted[0], max: top, color: RAMP[Math.floor(RAMP.length / 2)] }];
  }
  return bins;
}

/** The colour for one value, or NO_DATA when there is no number. */
export function colorFor(value: number | null | undefined, bins: Bin[]): string {
  if (value == null || !Number.isFinite(value) || bins.length === 0) {
    return NO_DATA;
  }
  for (let i = 0; i < bins.length; i++) {
    // Upper-inclusive on the last bin only, so the maximum is not left out.
    if (value <= bins[i].max || i === bins.length - 1) return bins[i].color;
  }
  return NO_DATA;
}

/** A number formatted the way its registry entry says it should be. */
export function formatValue(
  value: number | null | undefined,
  unit: string | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return "no data";
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "ratio") return value.toFixed(2);
  return new Intl.NumberFormat("en-IN").format(Math.round(value));
}
