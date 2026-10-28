/**
 * The one public origin of the site.
 *
 * The site is served from Cloudflare Pages, with a Render backend for the
 * routes rendered per request (scripts/cloudflare/). It used to be served
 * from Vercel, at whitespaceindia.vercel.app and the CSR app's original host
 * whitespaceindia-csr.vercel.app, until the Hobby team was paused for usage
 * on 2026-10-27.
 *
 * Every other host the project has answered on now redirects here with a
 * permanent redirect to the same path: Vercel by next.config.mjs, the Render
 * backend by scripts/cloudflare/backend.mjs. "/" on the CSR app's old host
 * lands on /csr. A NEXT_PUBLIC_SITE_URL that still names one of those hosts
 * is read as the primary, so a stale environment value - Vercel's still names
 * its own host - cannot split the canonical again. Two origins once named
 * each other's pages ("Duplicate, Google chose different canonical than
 * user"), and the parent landing could never be indexed.
 *
 * A different origin (a custom domain, later) is honoured as given.
 */

export const PRIMARY_ORIGIN = "https://whitespaceindia.pages.dev";

/** Hosts whose "/" was the CSR app; it redirects to /csr on the primary. */
export const LEGACY_CSR_HOSTS: ReadonlySet<string> = new Set([
  "whitespaceindia-csr.vercel.app",
  "csr.whitespaceindia.com",
]);

/** Every host that redirects to the primary origin, path for path. */
export const MOVED_HOSTS: ReadonlySet<string> = new Set([
  "whitespaceindia.vercel.app",
  "whitespaceindia-backend.onrender.com",
  ...LEGACY_CSR_HOSTS,
]);

export function resolveSiteUrl(raw: string | undefined): string {
  if (!raw) return PRIMARY_ORIGIN;
  try {
    const url = new URL(raw);
    if (MOVED_HOSTS.has(url.hostname.toLowerCase())) return PRIMARY_ORIGIN;
    return url.origin;
  } catch {
    return PRIMARY_ORIGIN;
  }
}

export const SITE_URL = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
