/**
 * The one public origin of the site.
 *
 * Two production hosts serve this deployment: the parent brand at
 * whitespaceindia.vercel.app and the CSR app's original host,
 * whitespaceindia-csr.vercel.app. Every page used to name the CSR host as its
 * canonical origin, so the parent landing declared itself a duplicate of the
 * CSR host's "/" - which serves the CSR app - and could never be indexed,
 * while "/" and "/csr" on the CSR host were one page at two URLs (Search
 * Console: "Duplicate, Google chose different canonical than user").
 *
 * The parent brand is the canonical origin. The legacy hosts redirect to it
 * (middleware.ts), and a NEXT_PUBLIC_SITE_URL that still names one of them is
 * read as the primary, so a stale environment value cannot reopen the split.
 * A different origin (a custom domain, later) is honoured as given.
 */

export const PRIMARY_ORIGIN = "https://whitespaceindia.vercel.app";

/** Hosts that redirect to the primary origin; "/" on them lands on /csr. */
export const LEGACY_CSR_HOSTS: ReadonlySet<string> = new Set([
  "whitespaceindia-csr.vercel.app",
  "csr.whitespaceindia.com",
]);

export function resolveSiteUrl(raw: string | undefined): string {
  if (!raw) return PRIMARY_ORIGIN;
  try {
    const url = new URL(raw);
    if (LEGACY_CSR_HOSTS.has(url.hostname.toLowerCase())) return PRIMARY_ORIGIN;
    return url.origin;
  } catch {
    return PRIMARY_ORIGIN;
  }
}

export const SITE_URL = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
