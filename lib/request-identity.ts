/**
 * Who a request is from, for origin checks and rate limiting.
 *
 * Shared because four routes need it and three of them had drifted into
 * slightly different, equally wrong copies of the same two helpers. It sits at
 * the root rather than under a vertical: every vertical's API needs it.
 *
 * TWO THINGS THE CLIENT CONTROLS AND MUST NOT BE TRUSTED WITH
 * ----------------------------------------------------------
 * `Origin` and `X-Forwarded-For` both arrive from the caller. A check that
 * reads them naively is not a check.
 */

/**
 * The caller's address, for rate limiting.
 *
 * NOT `x-forwarded-for.split(",")[0]`, which is what these routes used.
 * X-Forwarded-For is a list the caller can start: a client that sends
 * `X-Forwarded-For: 1.2.3.4` has its own address APPENDED, so the leftmost
 * entry is whatever the client typed. Keying a rate limiter on it means the
 * limit can be evaded with one header, and - worse - that an attacker can
 * exhaust the bucket of any address they choose to name.
 *
 * Platform headers first, because the platform sets them and strips any
 * client-supplied copy. `x-vercel-forwarded-for` and `x-real-ip` are both set
 * by Vercel's edge. Only if neither is present does this fall back to the
 * LAST entry of X-Forwarded-For, which is the one appended by the nearest
 * trusted proxy rather than the one the client chose.
 */
export function clientIp(req: Request): string {
  const platform =
    req.headers.get("x-vercel-forwarded-for") ??
    req.headers.get("x-real-ip");
  if (platform) return platform.trim();

  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "unknown";
}

/**
 * Every origin this deployment will accept a state-changing request from.
 *
 * The configured site URL, plus the three URLs Vercel gives a deployment of
 * itself. `localhost` is added only in development.
 */
function allowedOrigins(): string[] {
  const out: string[] = [];
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) out.push(site.replace(/\/+$/, ""));
  for (const v of [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
  ]) {
    if (v) out.push(`https://${v.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`);
  }
  if (!site && out.length === 0) {
    // The primary origin (lib/site.ts), so a deployment with no env configured
    // at all still works rather than refusing every request. Spelled out, not
    // imported: the node test runner loads this file without the @/ alias.
    out.push("https://whitespaceindia.pages.dev");
  }
  return out;
}

/**
 * Whether this request may perform a state-changing action.
 *
 * TWO HOLES THIS CLOSES, both of which accepted anyone:
 *
 *   `origin.endsWith(".vercel.app")` accepted EVERY deployment on the
 *   platform - every preview of every project belonging to every account -
 *   as if it were this site. It is a wildcard over a shared suffix, which is
 *   the same mistake as trusting `*.co.uk`.
 *
 *   `if (!origin) return true` accepted every request that simply omitted the
 *   header. Browsers send `Origin` on cross-origin requests AND on same-origin
 *   POST, so a missing header on a POST does not come from the site's own
 *   pages; it comes from something that chose not to send one. On a GET it is
 *   ordinary, so the absence is only refused where it matters.
 */
export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const method = (req.method || "GET").toUpperCase();

  if (!origin) {
    // A navigation, a curl, a feed reader. Harmless for a read; not something
    // to accept for a write.
    return method === "GET" || method === "HEAD";
  }
  if (allowedOrigins().includes(origin)) return true;
  // Same-origin: the page was served by this host. Covers every domain the
  // project answers on (aliases, custom domains) without a suffix wildcard;
  // a cross-site caller cannot make its Origin equal the Host it is posting to.
  const host = req.headers.get("host");
  if (host && origin === `https://${host}`) return true;
  if (
    process.env.NODE_ENV === "development" &&
    origin.startsWith("http://localhost:")
  ) {
    return true;
  }
  return false;
}
