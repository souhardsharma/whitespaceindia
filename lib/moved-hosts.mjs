// The redirects Vercel answers with now that the site is served from
// Cloudflare Pages (lib/site.ts). Plain JS because next.config.mjs reads it;
// site.test.ts holds PRIMARY to PRIMARY_ORIGIN and the hosts to
// LEGACY_CSR_HOSTS.
//
// Vercel applies these in its routing layer, before any function or page, so
// a request to a Vercel host costs one edge request and no origin transfer -
// the meter that paused the team.
export const PRIMARY = "https://whitespaceindia.pages.dev";

// Regex for a `has` host condition, which Next matches against the whole host.
export const LEGACY_CSR_HOST_PATTERN = "whitespaceindia-csr\\.vercel\\.app|csr\\.whitespaceindia\\.com";

export function movedRedirects() {
  return [
    // The CSR app's old host served the CSR app at "/".
    {
      source: "/",
      has: [{ type: "host", value: LEGACY_CSR_HOST_PATTERN }],
      destination: `${PRIMARY}/csr`,
      permanent: true,
    },
    // Everything else, same path and query, on every host of the deployment.
    { source: "/:path*", destination: `${PRIMARY}/:path*`, permanent: true },
  ];
}
