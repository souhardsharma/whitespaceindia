// The sitemaps, served a second time from the Render backend's own host.
//
// Google never read a sitemap on whitespaceindia.pages.dev: every submission
// since 2026-10-29 reads "Couldn't fetch", 0 pages discovered, while the URL
// Inspection live test fetches the same file and robots.txt fetches succeed
// every day. The identical sitemaps on whitespaceindia.vercel.app were read
// within six days of submission (93,040 pages discovered, 26 Oct). Cloudflare
// Community reports the same pattern on many *.pages.dev hosts, and the shared
// pages.dev hostname refuses some clients with "error code: 1010" (Python's
// own user agent gets it on robots.txt here) - a platform-level protection
// this project has no setting for.
//
// Google accepts a sitemap on another host when the site's robots.txt names
// it (cross-submission), so pages.dev's robots.txt names this host's index as
// well as its own. Every page URL inside stays on pages.dev; only the index's
// own entries point here, so Google fetches the children from this host too.
// Everything else on this host still redirects to the public site.

export const BACKEND_ORIGIN = "https://whitespaceindia-backend.onrender.com";

const SITEMAP_PATH = /^\/(?:sitemap-index\.xml|sitemap\.xml|instruments\/consent\/sitemap\/\d{1,3}\.xml)$/;

/** Whether a request path (query ignored) is one of the published sitemaps. */
export function isSitemapPath(url) {
  const path = String(url || "").split("?")[0];
  return SITEMAP_PATH.test(path);
}

/**
 * The sitemap index as served from this host: each child sitemap's <loc>
 * moved from the public site to this host. Only `<loc>` entries that start
 * with the public origin are touched, and only in the index - the children
 * list page URLs, which must stay on the public site.
 */
export function rewriteIndex(body, site, here) {
  const from = `<loc>${site.replace(/\/$/, "")}/`;
  const to = `<loc>${here.replace(/\/$/, "")}/`;
  return String(body).split(from).join(to);
}

/**
 * This host's robots.txt. The sitemaps may be fetched; nothing else here is a
 * page (every other path redirects to the public site), so nothing else is
 * offered for crawling.
 */
export function backendRobots() {
  return [
    "User-agent: *",
    "Allow: /sitemap-index.xml",
    "Allow: /sitemap.xml",
    "Allow: /instruments/consent/sitemap/",
    "Disallow: /",
    "",
    `Sitemap: ${BACKEND_ORIGIN}/sitemap-index.xml`,
    "",
  ].join("\n");
}
