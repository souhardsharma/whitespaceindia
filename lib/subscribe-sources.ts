// Where a sign-up came from, and which Kit form it joins. SubscribeForm sends
// one of these as `source` and /api/subscribe accepts exactly these, so a page
// cannot carry a form the API turns away.
//
// Numeric form IDs used by Kit's /forms/:id/subscribe endpoint. The public
// embed UIDs (96285e43e0, 324b05edcf) are NOT accepted there - they are the
// numeric IDs found inside each embed script's submission URL.
// Reports form embed uid 96285e43e0 -> form id 9364278
// Landing form embed uid 324b05edcf -> form id 9364340
export const DEFAULT_FORM_ID_REPORTS = "9364278";
export const DEFAULT_FORM_ID_LANDING = "9364340";

// "reports" is the full form on /reports; every other source is the compact
// form on an index page, and joins the landing form with its page recorded in
// the subscriber's `source` field.
export const SUBSCRIBE_SOURCES = ["reports", "landing", "health", "energy", "education"] as const;
export type SubscribeSource = (typeof SUBSCRIBE_SOURCES)[number];

export function parseSource(value: unknown): SubscribeSource | null {
  return typeof value === "string" && (SUBSCRIBE_SOURCES as readonly string[]).includes(value)
    ? (value as SubscribeSource)
    : null;
}

export function kitFormId(source: SubscribeSource, env: Record<string, string | undefined> = process.env): string {
  return source === "reports"
    ? env.KIT_FORM_ID || DEFAULT_FORM_ID_REPORTS
    : env.KIT_FORM_ID_LANDING || DEFAULT_FORM_ID_LANDING;
}
